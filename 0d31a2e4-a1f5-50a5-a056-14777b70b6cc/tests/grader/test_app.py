from __future__ import annotations

import base64
import colorsys
import hashlib
import importlib
import json
import os
import re
import secrets
import shutil
import signal
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import time
import zlib
import contextlib
from datetime import datetime
from contextlib import ExitStack
from urllib.parse import unquote, urlsplit
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

import pytest
from urllib.parse import parse_qs, quote, urlparse

import httpx
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

import conftest
from conftest import (
    advance,
    capture,
    changed,
    decode,
    difference,
    held,
    layout,
    open_app,
    same_origin,
    seek_rects,
    session,
    state_styles,
    style,
    unique,
)

HTTP_TIMEOUT_S = 30
POLL_S = 0.25
EXPECT_MS = 250
FRAME_MS = 16
API_WAIT_S = 20
UI_WAIT_S = 20
MAIL_WAIT_S = 30
MAIL_SETTLE_S = 0.2
BOOT_WAIT_S = 240
HTML_MEDIA = "text/html"
SEAT_SLACK_S = 3
RESPONSE_SLACK_S = 5
CLOSE_CODE = 1012
PG_RETRY_S = 2
PG_PORT = 5432
LONG_LIVED_S = 2
SETTLE_BUDGET_S = 2
NET_LOG_ENV = "PC_VERIFIER_NET_LOG"
EDGE_BUTTONS = 9
LATE_BUTTONS = 6
HELD_PUSHES = ("party", "lobby")
HELD_READS = ("**/api/party", "**/api/lobbies/**")
PROBE_SETTLE_TICKS = 3
TIMING_TOL_S = 1
RATE_SPAN_S = 5
TICK_RATE_TOL = 0.1
FILL_WAIT_S = 240
FILL_BATCH_MAX = 24
HOLD_S = 2
FALL_SEEDS = (11, 12, 13)
SAMPLE_STEP_MS = 32
BOB_STEP_MS = 100
LOUD_GAIN = 0.5
SILENT_GAIN = 0.0
TIE_SEEDS = 6
SAMPLE_EVERY = 100
BEAN_PIXEL_FLOOR = 12
FOREIGN_ORIGIN = "http://evil.example"
UNKNOWN_ID = 2147483000
SIM_IDS = [9000001, 9000002, 9000003, 9000004, 9000005]
OVERSIZE_ID = 99999999999
SIGNUP_RACERS = 4
RACE_PAIRS = 6
CHAT_BURST = 8
LINK_RACERS = 6
LINK_RACES = 3
ISSUE_RACERS = 4
INVITE_RACE_PAIRS = 6
STAMP_S = 0.001

SESSION_COOKIE = "pc_session"
SEED_PASSWORD = "Bounce-Seed-2026"
SEED_DOMAIN = "wobblewell.test"
MAIL_FROM = "no-reply@wobblewell.test"
VERIFY_SUBJECT = "Verify your Pratfall Cup email"
RESET_SUBJECT = "Reset your Pratfall Cup password"
EXPIRY_LINE = "This link expires in 30 minutes."
HUES = [30, 40, 50, 60, 185, 200, 215, 230, 250, 270, 290, 310]
HUE_TOLERANCE = 12
SPACED_HUES = (30, 60, 185, 215, 250, 290)
FRESH_OFFSET_MIN = 25
EXPIRED_OFFSET_MIN = 35
MAIL_DECIDE_S = 5
SEAT_WAIT_S = 2
LOBBY_SIZE = 12
COUNTDOWN_S = 10
PENDING_S = 5
PRESENCE_OFFLINE_S = 15
PRESENCE_LAG_S = 2
INVITE_LAG_S = 1
HEARTBEAT_MS = 5000
BODY_LIMIT = 16 * 1024
SIM_BODY_LIMIT = 256 * 1024
MAX_INPUTS = 6000
MAX_SEED = 4294967295
INPUT_WINDOW = 10
TICKS_PER_S = 20
RUN_SPEED = 8
DIVE_SPEED = 12
DIVE_TICKS = 12
JUMP_SPEED = 10
GRAVITY = 30
FALL_Y = -5
FALLING_TICKS = 20
ALIVE_AGAIN_TICKS = 40
SPAWN_X = (3, 1, -1, -3)
SPAWN_Z = (-2, -4, -6)
SPAWN_RING_M = 8
CLEAR_RUN_M = 10
RACE_FINISH_S = 40
FINAL_FINISH_S = 30
RACE_LENGTH_M = (100, 140)
FINAL_LENGTH_M = (60, 80)
ROUNDS = {
    1: ("race", "Wobble Dash", "Race", 60),
    2: ("survival", "Sweeper Spin", "Survival", 45),
    3: ("final", "Crown Climb", "Final", 60),
}
KIND_LIMIT_S = {"race": 60, "survival": 45, "final": 60}
SLOT_LABEL = {"race": "Slots left", "survival": "Falls to go", "final": "Slots left"}
BODY_MAX = 500
RATE_COUNT = 5
RATE_WINDOW_S = 5
HISTORY = 50
MATCH_HISTORY = 20
CHAT_LAG_S = 1
VOICE_LAG_S = 1
PAGE_STEP = 20
LANE_MAX_MS = 200
GLIDE_MIN_MS = 100
GLIDE_MAX_MS = 200
CAMERA_MIN_MS = 400
CAMERA_MAX_MS = 600
BOB_MIN_MS = 1500
BOB_MAX_MS = 2500
SMALL_MS = (80, 300)
PANEL_MS = (150, 400)
LARGE_MS = (300, 750)
BOB_TRAVEL_PX = (1, 5)
BANNER_SHOWN_MS = 2000
BANNER_GONE_MS = 4500
MOVE_PX = 1
SIDE_FALL_S = 5
BOB_SPAN_MS = 3 * BOB_MAX_MS
GLIDE_PROBE_MS = 48
FLIGHT_EARLY_MS = 96
FLIGHT_MID_MS = 304
FLIGHT_SETTLED_MS = 900
TILE_SETTLE_MS = 500
FAMILIES = ("Bricolage Grotesque", "Atkinson Hyperlegible")
TAP_MIN_PX = 44
SEED_MATCH_START = "2026-10-25T19:00:00.000Z"
SEED_MATCH_END = "2026-10-25T19:06:00.000Z"
SEED_SEEDS = {1: 20261026, 2: 4242, 3: 777}
SEED_MATCH = 1
PIP = "pip_bounce"
LULA = "lula_leap"
MAX_BUTTONS = 63
HTTP_ONLY = "HttpOnly"
SAME_SITE = "SameSite=Lax"
SLOTS_LABELS = re.compile("|".join(sorted(map(re.escape, set(SLOT_LABEL.values())))))
WIDE = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"}
FONT_LICENCE = "OFL-1.1"
FONT_LICENCE_NAMED = re.compile(re.escape(FONT_LICENCE) + r"|SIL Open Font Licen[cs]e,?\s*(Version\s*)?1\.1", re.I)
IN_PLAY = {"alive", "falling", "respawning"}
BEAN_STATES = {"alive", "falling", "respawning", "qualified", "eliminated"}
PRESENCE = {"offline", "online", "in_party", "in_match"}
PRESENCE_WORDS = {"offline": "Offline", "online": "Online", "in_party": "In a party", "in_match": "In a match"}
YOU_SUFFIX = " (you)"
MATCH_WAIT_S = 3 * (PENDING_S + 60) + 60
ROUND_WAIT_S = PENDING_S + 60 + 30
TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
POSITION = re.compile(r"^-?\d+\.\d{3}$")


def _helper(name: str) -> Any:
    if hasattr(conftest, name):
        return getattr(conftest, name)
    for module in ("postgres_client", "mailpit_client", "postgres", "mailpit", "clients", "services"):
        try:
            loaded = importlib.import_module(module)
        except ImportError:
            continue
        if hasattr(loaded, name):
            return getattr(loaded, name)
    raise AssertionError(f"verifier helper {name} is not importable")


def poll(check: Callable[[], Any], seconds: float, what: str, pause: float = POLL_S) -> Any:
    deadline = time.monotonic() + seconds
    gate = threading.Event()
    last = "no attempt"
    while True:
        try:
            value = check()
        except (AssertionError, httpx.HTTPError, PlaywrightError) as error:
            value, last = None, f"{type(error).__name__}: {error}"
        else:
            if value is not None and value is not False:
                return value
            last = f"returned {value!r}"
        if time.monotonic() >= deadline:
            raise AssertionError(f"timed out after {seconds:.1f}s waiting for {what}: {last}")
        gate.wait(pause)


def enter(stack: ExitStack, managed: Any) -> Any:
    if hasattr(managed, "__enter__"):
        return stack.enter_context(managed)
    value = next(managed)
    stack.callback(lambda: next(managed, None))
    return value


def fire_together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))
    out: list[Any] = [None] * len(calls)

    def run(index: int, call: Callable[[], Any]) -> None:
        barrier.wait()
        out[index] = call()

    threads = [threading.Thread(target=run, args=(i, c)) for i, c in enumerate(calls)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(HTTP_TIMEOUT_S * 2)
    assert all(o is not None for o in out), "a concurrent request never returned"
    return out


def hue_of(user_id: int) -> int:
    return HUES[(user_id * 5) % 12]


def slots_for(kind: str, starters: int) -> int:
    if kind == "race":
        return (6 * starters + 9) // 10
    if kind == "survival":
        return (starters + 1) // 2
    return 1


def outage_url() -> str:
    value = os.environ.get("APP_MAILPIT_DOWN_URL", "")
    assert value, "APP_MAILPIT_DOWN_URL is not set for the mailpit-down outage"
    return value.rstrip("/")


def stored_anywhere(needle: str) -> int:
    pg = _helper("Postgres")()
    tables = pg.rows(
        "select table_schema as s, table_name as t from information_schema.tables "
        "where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')"
    )
    if not tables:
        return 0
    literal = "'" + needle.replace("'", "''") + "'"
    parts = []
    for table in tables:
        schema = str(table["s"]).replace('"', '""')
        name = str(table["t"]).replace('"', '""')
        parts.append(f'select count(*)::int as n from "{schema}"."{name}" as r where strpos(r::text, {literal}) > 0')
    return sum(int(row["n"]) for row in pg.rows(" union all ".join(parts)))


def request(base: str, method: str, path: str, body: Any = None, cookie: str = "", raw: bytes | None = None,
            headers: dict[str, str] | None = None, timeout: float = HTTP_TIMEOUT_S) -> httpx.Response:
    sent = dict(headers or {})
    if cookie:
        sent["Cookie"] = f"{SESSION_COOKIE}={cookie}"
    content = raw
    if body is not None:
        content = json.dumps(body, separators=(",", ":")).encode()
        sent.setdefault("Content-Type", "application/json")
    return httpx.request(method, base.rstrip("/") + path, content=content, headers=sent, timeout=timeout)


def error_code(response: httpx.Response) -> str:
    body = response.json()
    assert set(body) >= {"error"} and {"code", "message"} <= set(body["error"]), response.text
    return body["error"]["code"]


def expect_error(response: httpx.Response, status: int, code: str) -> dict:
    assert response.status_code == status, f"{response.status_code} {response.text}"
    assert error_code(response) == code, response.text
    return response.json()["error"]


def session_cookie(response: httpx.Response) -> str:
    value = response.cookies.get(SESSION_COOKIE)
    if value:
        return value
    for header in response.headers.get_list("set-cookie"):
        if header.startswith(SESSION_COOKIE + "="):
            return header.split(";", 1)[0].split("=", 1)[1]
    raise AssertionError(f"no {SESSION_COOKIE} cookie in {response.headers}")


def identity() -> tuple[str, str]:
    parts = unique("pc")
    salt = secrets.token_hex(4)
    mailbox = next((part for part in parts if "@" in part), None)
    if mailbox is None:
        mailbox = re.sub(r"[^a-z0-9]", "", parts[0].lower()) + salt + "@players.test"
    handle = "p" + hashlib.sha1((mailbox + salt).encode()).hexdigest()[:15]
    return mailbox.lower(), handle


def fresh_password() -> str:
    return "Pc-" + secrets.token_hex(8)


@dataclass
class Player:
    base: str
    email: str
    handle: str
    password: str
    id: int = 0
    cookie: str = ""

    def call(self, method: str, path: str, body: Any = None, base: str | None = None) -> httpx.Response:
        return request(base or self.base, method, path, body, cookie=self.cookie)

    def get(self, path: str, base: str | None = None) -> httpx.Response:
        return self.call("GET", path, base=base)

    def post(self, path: str, body: Any = None, base: str | None = None) -> httpx.Response:
        return self.call("POST", path, {} if body is None else body, base=base)

    def delete(self, path: str) -> httpx.Response:
        return self.call("DELETE", path)


_PLAYERS: dict[int, Player] = {}


def mail_for(mail: Any, address: str, subject: str) -> list[dict]:
    found = []
    for message in mail.messages(0, MAIL_SETTLE_S):
        targets = [a.lower() for a in _helper("addresses")(message.get("To"))]
        if address.lower() in targets and message.get("Subject") == subject:
            found.append(message)
    return found


def link_tokens(messages: list[dict], kind: str) -> list[str]:
    tokens: list[str] = []
    for message in messages:
        for query in re.findall(rf"/{re.escape(kind)}\?([^\s\"'<>]+)", _helper("text")(message)):
            for token in parse_qs(query.replace("&amp;", "&")).get("token", []):
                if token not in tokens:
                    tokens.append(token)
    return tokens


def new_token(mail: Any, address: str, subject: str, kind: str, known: tuple[str, ...] = ()) -> str:
    def check() -> str:
        fresh = [t for t in link_tokens(mail_for(mail, address, subject), kind) if t not in known]
        assert fresh, f"no new {kind} link for {address}"
        return fresh[0]

    return poll(check, MAIL_WAIT_S, f"{kind} mail to {address}")


def signup(base: str, mail: Any = None, verify: bool = True) -> Player:
    email_address, handle = identity()
    player = Player(base, email_address, handle, fresh_password())
    response = request(base, "POST", "/api/auth/signup",
                       {"email": email_address, "handle": handle, "password": player.password})
    assert response.status_code == 201, response.text
    player.id = response.json()["user"]["id"]
    player.cookie = session_cookie(response)
    _PLAYERS[player.id] = player
    if verify:
        token = new_token(mail, email_address, VERIFY_SUBJECT, "verify")
        verified = request(base, "POST", "/api/auth/verify", {"token": token})
        assert verified.status_code == 200, verified.text
    return player


def players(base: str, mail: Any, count: int) -> list[Player]:
    made = [signup(base, verify=False) for _ in range(count)]

    def check() -> dict[str, str]:
        messages = mail.messages(0, MAIL_SETTLE_S)
        tokens = {}
        for player in made:
            mine = [m for m in messages
                    if player.email in [a.lower() for a in _helper("addresses")(m.get("To"))]
                    and m.get("Subject") == VERIFY_SUBJECT]
            found = link_tokens(mine, "verify")
            assert found, f"no verification mail for {player.email}"
            tokens[player.email] = found[0]
        return tokens

    tokens = poll(check, MAIL_WAIT_S, "verification mails")
    for player in made:
        response = request(base, "POST", "/api/auth/verify", {"token": tokens[player.email]})
        assert response.status_code == 200, response.text
    return made


def login(base: str, email_address: str, password: str) -> httpx.Response:
    return request(base, "POST", "/api/auth/login", {"email": email_address, "password": password})


def seeded(base: str, handle: str) -> Player:
    response = login(base, f"{handle}@{SEED_DOMAIN}", SEED_PASSWORD)
    assert response.status_code == 200, response.text
    return Player(base, f"{handle}@{SEED_DOMAIN}", handle, SEED_PASSWORD,
                  response.json()["user"]["id"], session_cookie(response))


def befriend(a: Player, b: Player) -> None:
    response = a.post("/api/friends/requests", {"handle": b.handle})
    assert response.status_code in (200, 201), response.text
    if "friendship" in response.json():
        return
    accepted = b.post(f"/api/friends/requests/{response.json()['request']['id']}/accept")
    assert accepted.status_code == 200, accepted.text


def invite_and_join(leader: Player, member: Player) -> dict:
    response = leader.post("/api/party/invites", {"userId": member.id})
    assert response.status_code in (200, 201), response.text
    joined = member.post(f"/api/party/invites/{response.json()['invite']['id']}/accept")
    assert joined.status_code == 200, joined.text
    return joined.json()["party"]


def form_party(leader: Player, members: list[Player]) -> dict:
    party: dict = {}
    for member in members:
        befriend(leader, member)
        party = invite_and_join(leader, member)
    return party


def party_of(player: Player) -> dict:
    response = player.get("/api/party")
    assert response.status_code == 200, response.text
    return response.json()["party"]


def member_ids(party: dict) -> set[int]:
    return {m["user"]["id"] for m in party["members"]}


def friends_of(player: Player) -> dict:
    response = player.get("/api/friends")
    assert response.status_code == 200, response.text
    return response.json()


def presence_of(viewer: Player, user_id: int) -> str | None:
    for entry in friends_of(viewer)["friends"]:
        if entry["user"]["id"] == user_id:
            return entry["presence"]
    return None


def finish_matches(group: list[Player]) -> None:
    match_ids: set[int] = set()
    for player in group:
        try:
            party = party_of(player)
        except (AssertionError, httpx.HTTPError, KeyError, ValueError):
            continue
        if party["state"] == "in_match" and party.get("matchId"):
            match_ids.add(party["matchId"])
    for match_id in match_ids:
        viewer = group[0]

        def done(match_id: int = match_id) -> bool:
            match = match_json(viewer, match_id)
            if match["state"] == "finished":
                return True
            for user in match["participants"]:
                player = _PLAYERS.get(user["id"])
                if player is not None:
                    player.post(f"/api/matches/{match_id}/forfeit")
            return False

        try:
            poll(done, MATCH_WAIT_S, f"match {match_id} finished during cleanup", pause=1)
        except AssertionError:
            continue


def release(group: list[Player]) -> None:
    finish_matches(group)
    for player in group:
        for _ in range(3):
            try:
                party = party_of(player)
                solo = len(party["members"]) == 1
                leads = party["leaderId"] == player.id
                if party["state"] == "queued" and leads:
                    player.post("/api/party/queue/cancel")
                elif party["state"] == "in_lobby" and leads:
                    player.post("/api/lobby/leave")
                elif not solo and party["state"] != "in_match":
                    player.post("/api/party/leave")
                else:
                    break
            except (AssertionError, httpx.HTTPError, KeyError, ValueError):
                break


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def lobby_json(viewer: Player, lobby_id: int) -> dict:
    response = viewer.get(f"/api/lobbies/{lobby_id}")
    assert response.status_code == 200, response.text
    return response.json()["lobby"]


def seat_ids(lobby: dict) -> list[int]:
    return [seat["userId"] for seat in lobby["seats"]]


def seated(player: Player) -> dict | None:
    party = party_of(player)
    return party if party["state"] == "in_lobby" and party["lobbyId"] else None


def queue_seated(player: Player, base: str | None = None) -> dict:
    response = player.post("/api/party/queue", base=base)
    assert response.status_code == 202, response.text
    return poll(lambda: seated(player), SEAT_WAIT_S + SEAT_SLACK_S, f"{player.handle} seated")


def match_started(player: Player) -> int:
    def check() -> int | None:
        party = party_of(player)
        return party["matchId"] if party["state"] == "in_match" and party["matchId"] else None

    return poll(check, COUNTDOWN_S + SEAT_SLACK_S + RESPONSE_SLACK_S, "match start")


def match_json(viewer: Player, match_id: int) -> dict:
    response = viewer.get(f"/api/matches/{match_id}")
    assert response.status_code == 200, response.text
    return response.json()["match"]


def wait_round(viewer: Player, match_id: int, n: int, states: set[str], seconds: float) -> dict:
    def check() -> dict | None:
        for rnd in match_json(viewer, match_id)["rounds"]:
            if rnd["n"] == n and rnd["state"] in states:
                return rnd
        return None

    return poll(check, seconds, f"round {n} in {states}")


def wait_finished(viewer: Player, match_id: int, seconds: float = MATCH_WAIT_S) -> dict:
    return poll(lambda: (m := match_json(viewer, match_id))["state"] == "finished" and m, seconds, "match finished")


def frames(viewer: Player, match_id: int, n: int, tick: Any) -> httpx.Response:
    return viewer.get(f"/api/matches/{match_id}/rounds/{n}/frames?tick={tick}")


def frame_json(viewer: Player, match_id: int, n: int, tick: int) -> dict:
    response = frames(viewer, match_id, n, tick)
    assert response.status_code == 200, response.text
    return response.json()


def inputs_json(viewer: Player, match_id: int, n: int) -> dict:
    response = viewer.get(f"/api/matches/{match_id}/rounds/{n}/inputs")
    assert response.status_code == 200, response.text
    return response.json()


_SIM_SESSIONS: dict[str, str] = {}


def sim_session(base: str) -> str:
    if base not in _SIM_SESSIONS:
        _SIM_SESSIONS[base] = signup(base, verify=False).cookie
    return _SIM_SESSIONS[base]


def simulate(base: str, body: dict) -> dict:
    response = request(base, "POST", "/api/simulate", body, cookie=sim_session(base))
    assert response.status_code == 200, response.text
    return response.json()


def same_position(a: dict, b: dict) -> bool:
    return all(abs(float(a[k]) - float(b[k])) < 0.0005 for k in "xyz")


WIRE_JS = """
(cfg) => new Promise((resolve) => {
  const w = window;
  w.__log = []; w.__plan = cfg.plan; w.__sent = {}; w.__latest = {}; w.__closed = null; w.__probes = []; w.__probeLog = [];
  const ws = new WebSocket(cfg.url);
  w.__ws = ws;
  ws.onopen = () => { ws.send(JSON.stringify({type: 'heartbeat'})); resolve('open'); };
  ws.onclose = (event) => { w.__closed = event.code; resolve('closed'); };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'tick') {
      const key = message.matchId + ':' + message.round;
      w.__latest[key] = Math.max(w.__latest[key] ?? -1, message.tick);
      for (const probe of w.__probes.splice(0)) {
        if (probe.matchId !== message.matchId || probe.round !== message.round) { w.__probes.push(probe); continue; }
        const stamp = message.tick + probe.offset;
        ws.send(JSON.stringify({type: 'input', matchId: message.matchId, round: message.round, tick: stamp, buttons: probe.buttons}));
        w.__probeLog.push({id: probe.id, base: message.tick, stamp});
      }
      const buttons = w.__plan[String(message.round)];
      if (buttons !== undefined && !w.__sent[key]) {
        w.__sent[key] = true;
        ws.send(JSON.stringify({type: 'input', matchId: message.matchId, round: message.round, tick: message.tick, buttons}));
      }
      if (!cfg.record) return;
    }
    message.__at = performance.now();
    w.__log.push(message);
  };
  setInterval(() => { if (ws.readyState === 1 && !w.__mute) ws.send(JSON.stringify({type: 'heartbeat'})); }, cfg.beat);
})
"""


def ws_url(base: str) -> str:
    parsed = urlparse(base)
    return ("wss" if parsed.scheme == "https" else "ws") + "://" + parsed.netloc + "/ws"


@dataclass
class Wire:
    page: Page
    player: Player

    def send(self, message: dict) -> None:
        self.page.evaluate("m => window.__ws.send(JSON.stringify(m))", message)

    def log(self, kind: str) -> list[dict]:
        return self.page.evaluate("k => window.__log.filter(m => m.type === k)", kind)

    def latest(self, match_id: int, n: int) -> int:
        return int(self.page.evaluate("k => window.__latest[k] ?? -1", f"{match_id}:{n}"))

    def wait(self, script: str, arg: Any, seconds: float = API_WAIT_S) -> None:
        self.page.wait_for_function(script, arg=arg, timeout=seconds * 1000)

    def wait_tick(self, match_id: int, n: int, at_least: int, seconds: float = ROUND_WAIT_S) -> int:
        self.wait("([k, x]) => (window.__latest[k] ?? -1) >= x", [f"{match_id}:{n}", at_least], seconds)
        return self.latest(match_id, n)

    def close(self) -> None:
        self.page.evaluate("() => window.__ws.close()")

    def silence(self) -> None:
        self.page.evaluate("() => { window.__mute = true; window.__ws.send(JSON.stringify({type: 'heartbeat'})); }")


def open_wire(stack: ExitStack, browser: Browser, app_url: str, player: Player,
              plan: dict[int, int] | None = None, record: bool = False) -> Wire:
    context = browser.new_context()
    stack.callback(context.close)
    context.add_cookies([{"name": SESSION_COOKIE, "value": player.cookie, "url": app_url}])
    page = context.new_page()
    page.goto(app_url + "/api/health")
    state = page.evaluate(WIRE_JS, {"url": ws_url(app_url), "plan": {str(k): v for k, v in (plan or {}).items()},
                                    "beat": HEARTBEAT_MS, "record": record})
    assert state == "open", f"WebSocket for {player.handle} closed: {page.evaluate('window.__closed')}"
    return Wire(page, player)


def open_seats_before(viewer: Player, lobby_id: int) -> int:
    free = 0
    for older in range(1, lobby_id):
        response = viewer.get(f"/api/lobbies/{older}")
        if response.status_code != 200:
            continue
        lobby = response.json()["lobby"]
        if lobby["state"] == "filling":
            free += lobby["size"] - len(lobby["seats"])
    return free


def fill_lobby(stack: ExitStack, browser: Browser | None, app_url: str, mail: Any, viewer: Player, lobby_id: int,
               upto: int = LOBBY_SIZE, plan: dict[int, int] | None = None) -> list[tuple[Player, Wire | None]]:
    added: list[tuple[Player, Wire | None]] = []
    deadline = time.monotonic() + FILL_WAIT_S
    while True:
        lobby = lobby_json(viewer, lobby_id)
        free = upto - len(lobby["seats"])
        if free <= 0 or lobby["state"] != "filling":
            return added
        assert time.monotonic() < deadline, f"lobby {lobby_id} never reached {upto} seats"
        needed = free + open_seats_before(viewer, lobby_id)
        batch = players(app_url, mail, min(needed, FILL_BATCH_MAX))
        stack.callback(release, batch)
        for filler in batch:
            if len(lobby_json(viewer, lobby_id)["seats"]) >= upto:
                break
            wire = open_wire(stack, browser, app_url, filler, plan) if browser is not None else None
            if queue_seated(filler)["lobbyId"] == lobby_id:
                added.append((filler, wire))


def fill_spaced(stack: ExitStack, app_url: str, mail: Any, viewer: Player, lobby_id: int) -> list[Player]:
    added: list[Player] = []
    deadline = time.monotonic() + FILL_WAIT_S
    while True:
        lobby = lobby_json(viewer, lobby_id)
        if len(lobby["seats"]) >= LOBBY_SIZE or lobby["state"] != "filling":
            return added
        assert time.monotonic() < deadline, f"lobby {lobby_id} never filled"
        batch = players(app_url, mail, LOBBY_SIZE)
        stack.callback(release, batch)
        for filler in (p for p in batch if hue_of(p.id) in SPACED_HUES):
            if len(lobby_json(viewer, lobby_id)["seats"]) >= LOBBY_SIZE:
                break
            if queue_seated(filler)["lobbyId"] == lobby_id:
                added.append(filler)


_LIVE: list[Page] = []
_MARKS: dict[int, float] = {}


def _forget(page: Page) -> None:
    if page in _LIVE:
        _LIVE.remove(page)


def tick_pages() -> None:
    now = time.monotonic()
    for page in list(_LIVE):
        if page.is_closed():
            _LIVE.remove(page)
            continue
        elapsed = (now - _MARKS.get(id(page), now)) * 1000
        _MARKS[id(page)] = now
        page.clock.run_for(max(1, round(elapsed)))


def ui(check: Callable[[], Any], seconds: float, what: str) -> Any:
    def step() -> Any:
        tick_pages()
        return check()

    return poll(step, seconds, what, pause=POLL_S / 2)


_INFLIGHT: dict[int, dict[Any, float]] = {}


def network_quiet(page: Page) -> None:
    def quiet() -> bool:
        now = time.monotonic()
        return page.evaluate("0") == 0 and not [r for r, t in list(_INFLIGHT.get(id(page), {}).items()) if now - t < LONG_LIVED_S]
    with contextlib.suppress(AssertionError):
        poll(quiet, SETTLE_BUDGET_S, "page requests to settle", pause=POLL_S / 5)


def within_fake(page: Page, check: Callable[[], Any], budget_ms: float, what: str) -> float:
    spent = 0.0
    while True:
        network_quiet(page)
        try:
            check()
            return spent
        except (AssertionError, PlaywrightError) as error:
            if spent >= budget_ms:
                raise AssertionError(f"{what} not shown within {budget_ms} ms of page time: {error}") from error
        advance(page, FRAME_MS)
        spent += FRAME_MS


def browse(stack: ExitStack, browser: Browser, url: str, viewport: tuple[int, int] = WIDE,
           reduced: str = "no-preference") -> Page:
    page = enter(stack, open_app(browser, url, reduced_motion=reduced))
    page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
    pending: dict[Any, float] = {}
    _INFLIGHT[id(page)] = pending
    page.on("request", lambda request: pending.__setitem__(request, time.monotonic()))
    page.on("requestfinished", lambda request: pending.pop(request, None))
    page.on("requestfailed", lambda request: pending.pop(request, None))
    _LIVE.append(page)
    _MARKS[id(page)] = time.monotonic()
    stack.callback(_forget, page)
    return page


def as_player(stack: ExitStack, browser: Browser, app_url: str, player: Player, path: str = "/",
              viewport: tuple[int, int] = WIDE, reduced: str = "no-preference", mic: bool = False,
              init: str | None = None) -> Page:
    page = browse(stack, browser, app_url + "/signin", viewport, reduced)
    page.context.add_cookies([{"name": SESSION_COOKIE, "value": player.cookie, "url": app_url}])
    if mic:
        page.context.grant_permissions(["microphone"], origin=app_url)
    if init:
        page.add_init_script(init)
    page.goto(app_url + path)
    return page


def role(scope: Page | Locator, kind: str, name: str | re.Pattern[str], exact: bool = True) -> Locator:
    if isinstance(name, re.Pattern):
        return scope.get_by_role(kind, name=name)
    return scope.get_by_role(kind, name=name, exact=exact)


def notices(page: Page) -> Locator:
    return role(page, "status", "Notices")


def record_notices(page: Page) -> None:
    notices(page).evaluate("""el => { window.__notices = []; new MutationObserver(() => window.__notices.push(el.textContent))
        .observe(el, {childList: true, characterData: true, subtree: true}); }""")


def heard(page: Page, copy: str) -> Callable[[], bool]:
    return lambda: copy in (notices(page).text_content(timeout=EXPECT_MS) or "") or \
        any(copy in (text or "") for text in page.evaluate("window.__notices || []"))


def check_pending(stack: ExitStack, page: Page, button: Locator, url_glob: str, copy: str | None = None) -> None:
    target = button.element_handle(timeout=UI_WAIT_S * 1000)
    gate = enter(stack, held(page, url_glob))
    target.click()

    def busy() -> bool:
        state = target.evaluate("""el => ({off: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
            busy: el.getAttribute('aria-busy'), text: el.textContent || ''})""")
        assert state["off"] and state["busy"] == "true", state
        assert copy is None or copy in state["text"], state
        return True

    ui(busy, UI_WAIT_S, f"pending state while {url_glob} is held")
    gate.release()


def holds(check: Callable[[], bool], seconds: float, what: str) -> None:
    end = time.monotonic() + seconds
    broken: list[str] = []

    def step() -> bool:
        tick_pages()
        try:
            ok = bool(check())
        except (AssertionError, PlaywrightError, KeyError) as error:
            ok, note = False, str(error)
        else:
            note = "returned false"
        if not ok:
            broken.append(note)
        return time.monotonic() >= end

    poll(step, seconds + RESPONSE_SLACK_S, what)
    assert not broken, f"{what} failed on {len(broken)} samples: {broken[:3]}"


def sees(locator: Locator, copy: str) -> Callable[[], bool]:
    def check() -> bool:
        expect(locator).to_contain_text(copy, timeout=EXPECT_MS)
        return True

    return check


def visible(locator: Locator) -> Callable[[], bool]:
    def check() -> bool:
        expect(locator).to_be_visible(timeout=EXPECT_MS)
        return True

    return check


def gone(locator: Locator) -> Callable[[], bool]:
    def check() -> bool:
        expect(locator).to_have_count(0, timeout=EXPECT_MS)
        return True

    return check


def rows(list_locator: Locator) -> list[dict]:
    return list_locator.get_by_role("listitem").evaluate_all(
        "els => els.map(e => Object.assign({text: e.innerText || e.textContent || ''}, e.dataset))")


def row_ids(list_locator: Locator) -> list[int]:
    return [int(r["userId"]) for r in rows(list_locator) if r.get("userId")]


def with_attr(locator: Locator, name: str, value: Any) -> Locator:
    return locator.and_(locator.page.locator(f'[{name}="{value}"]'))


def focus_inside(container: Locator) -> bool:
    return bool(container.evaluate("el => el.contains(document.activeElement)"))


def is_focused(locator: Locator) -> bool:
    return bool(locator.evaluate("el => el === document.activeElement"))


def slider_state(slider: Locator) -> dict:
    return slider.evaluate("""el => ({
        now: Number(el.getAttribute('aria-valuenow') ?? el.value),
        min: Number(el.getAttribute('aria-valuemin') ?? el.min),
        max: Number(el.getAttribute('aria-valuemax') ?? el.max),
        text: el.getAttribute('aria-valuetext')})""")


def slots_attr(page: Page) -> Locator:
    return page.get_by_text(SLOTS_LABELS).first


def slots_value(page: Page) -> int:
    return int(slots_attr(page).evaluate(
        "el => (el.closest('[data-slots-left]') || el.querySelector('[data-slots-left]')).getAttribute('data-slots-left')"))


def slots_box(page: Page) -> dict:
    return slots_attr(page).evaluate(
        "el => { const r = (el.closest('[data-slots-left]') || el.querySelector('[data-slots-left]')).getBoundingClientRect();"
        " return {x: r.x, y: r.y, width: r.width, height: r.height}; }")


def boxes_overlap(a: dict | None, b: dict | None) -> bool:
    if not a or not b:
        return False
    return not (a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"]
                or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])


def png_rows(data: bytes) -> list[list[tuple[int, int, int]]]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "capture is not a PNG"
    pos, idat, width, height, colour = 8, b"", 0, 0, 0
    while pos < len(data):
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        kind, chunk = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + size]
        pos += 12 + size
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", chunk[:10])
            assert depth == 8 and chunk[12] == 0, "unsupported PNG layout"
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    channels = {2: 3, 6: 4}[colour]
    raw, stride = zlib.decompress(idat), width * channels
    previous, offset, out = bytearray(stride), 0, []
    for _ in range(height):
        kind, line = raw[offset], bytearray(raw[offset + 1:offset + 1 + stride])
        offset += 1 + stride
        for i in range(stride):
            left = line[i - channels] if i >= channels else 0
            up = previous[i]
            corner = previous[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + left) & 255
            elif kind == 2:
                line[i] = (line[i] + up) & 255
            elif kind == 3:
                line[i] = (line[i] + (left + up) // 2) & 255
            elif kind == 4:
                guess = left + up - corner
                pa, pb, pc = abs(guess - left), abs(guess - up), abs(guess - corner)
                line[i] = (line[i] + (left if pa <= pb and pa <= pc else up if pb <= pc else corner)) & 255
        out.append([(line[i], line[i + 1], line[i + 2]) for i in range(0, stride, channels * 2)])
        previous = line
    return out


def png_pixels(data: bytes) -> list[tuple[int, int, int]]:
    return [pixel for line in png_rows(data) for pixel in line]


def hue_pixels(pixels: list[tuple[int, int, int]], hue: int) -> int:
    count = 0
    for r, g, b in pixels:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s >= 0.35 and v >= 0.35 and min(abs(h * 360 - hue), 360 - abs(h * 360 - hue)) <= HUE_TOLERANCE:
            count += 1
    return count


def bean_hues(container: Locator) -> list[str]:
    return container.evaluate("el => [...el.querySelectorAll('[data-hue]')].map(e => e.dataset.hue)")


PROFILE_PROBE_ID = 5
PROFILE_BEAN = """() => {
  const outside = (e) => !e.closest('[role=complementary], [role=dialog]');
  const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const beans = [...document.querySelectorAll('[data-hue]')].filter((e) => outside(e) && (e.matches('svg') || e.querySelector('svg')));
  const bean = beans.sort((x, y) => area(y) - area(x))[0];  // the profile's large bean, wherever the page nests it
  if (!bean) return null;
  bean.scrollIntoView({block: 'center', inline: 'center'});
  const r = bean.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const hues = [bean, ...bean.querySelectorAll('[data-hue]')].map((e) => e.getAttribute('data-hue')).filter((h) => h !== null);
  return {hues, box: {x: r.x, y: r.y, width: r.width, height: r.height}};
}"""


def noticed(page: Page) -> Callable[[], bool]:
    return lambda: bool((notices(page).inner_text(timeout=EXPECT_MS) or "").strip())


def check_svg_bean(container: Locator, hue: int, what: str) -> bool:
    found = bean_hues(container)
    assert found and set(found) == {str(hue)}, f"{what}: data-hue values {found}, expected {hue}"
    matching = hue_pixels(png_pixels(capture(container)), hue)
    assert matching >= BEAN_PIXEL_FLOOR, f"{what}: only {matching} px in hue {hue}"
    return True


MOTION_PAUSER = """
() => {
  const w = window; w.__motion = []; w.__seen = new WeakSet();
  const keep = (a) => {
    const t = a.effect && a.effect.getComputedTiming();
    if (!t || t.iterations === Infinity || w.__seen.has(a)) return;
    w.__seen.add(a); a.pause();
    w.__motion.push({target: a.effect.target, duration: Number(t.duration) || 0});
  };
  const grab = (e) => { for (const a of e.target.getAnimations()) keep(a); };
  document.addEventListener('transitionrun', grab, true);
  document.addEventListener('animationstart', grab, true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (keys, options) { const a = original.call(this, keys, options); keep(a); return a; };
}
"""

FINITE_MOTION = """
(arg) => {
  const w = window; w.__motion = w.__motion || []; w.__seen = w.__seen || new WeakSet();
  const inside = (el) => !!el && (arg.root.contains(el) || (arg.ancestors && el.contains(arg.root)));
  for (const a of document.getAnimations()) {
    const t = a.effect && a.effect.getComputedTiming();
    if (!t || t.iterations === Infinity || w.__seen.has(a) || !inside(a.effect.target) || t.progress === null) continue;
    w.__seen.add(a); a.pause();
    w.__motion.push({target: a.effect.target, duration: Number(t.duration) || 0});
  }
  return w.__motion.filter(m => m.duration > 0 && inside(m.target));
}
"""

FINISH_MOTION = """
() => {
  for (const a of document.getAnimations()) {
    const t = a.effect && a.effect.getComputedTiming();
    if (t && t.iterations !== Infinity && a.playState === 'paused') a.finish();
  }
  window.__motion = [];
}
"""

LOOP_ANIMATIONS = """
() => document.getAnimations().filter(a => a.effect && a.effect.target
  && a.effect.getComputedTiming().iterations === Infinity && a.playState === 'running')
"""


def finish_motion(page: Page) -> None:
    page.evaluate(FINISH_MOTION)


def finite_motion(page: Page, root: Any, ancestors: bool = False) -> list[tuple[float, Any]]:
    found = page.evaluate_handle(FINITE_MOTION, {"root": root, "ancestors": ancestors})
    out = []
    for item in found.get_properties().values():
        target = item.get_property("target").as_element()
        if target is not None:
            out.append((float(item.get_property("duration").json_value()), target))
    return out


def travel(handle: Any, axes: tuple[str, ...] = ("x", "y", "width", "height")) -> float:
    rects = seek_rects(handle)
    if not rects:
        return 0.0
    return max(max(r.get(k, 0.0) for r in rects) - min(r.get(k, 0.0) for r in rects) for k in axes)


RENDER_JS = """
(root) => [root, ...root.querySelectorAll('*')].slice(0, 300).map((e) => {
  const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
  return {box: [r.x, r.y, r.width, r.height],
          paint: [c.opacity, c.color, c.backgroundColor, c.borderColor, c.boxShadow, c.outlineColor, c.fill, c.stroke].join('|')};
})
"""


def rendered_motion(page: Page, root: Any, span_ms: float, jitter: float) -> tuple[list[float], list[float]]:
    samples: list[tuple[float, list[dict]]] = []
    spent = 0.0
    while spent <= span_ms:
        samples.append((spent, root.evaluate(RENDER_JS)))
        advance(page, SAMPLE_STEP_MS)
        spent += SAMPLE_STEP_MS
    final = samples[-1][1]

    def displaced(state: list[dict]) -> bool:
        return len(state) != len(final) or any(abs(p - q) > jitter for s, f in zip(state, final)
                                               for p, q in zip(s["box"], f["box"]))

    def repainted(state: list[dict]) -> bool:
        return len(state) != len(final) or any(s["paint"] != f["paint"] for s, f in zip(state, final))

    return [t for t, s in samples if displaced(s)], [t for t, s in samples if repainted(s)]


def check_motion(page: Page, root: Any, reduced: bool, band: tuple[int, int], what: str,
                 ancestors: bool = False, must_move: bool = True, jitter: float = MOVE_PX) -> None:
    found = finite_motion(page, root, ancestors)
    moving = [d for d, target in found if travel(target) >= MOVE_PX]
    timed = [d for d, target in found if band[0] <= d <= band[1] and (not must_move or travel(target) >= MOVE_PX)]
    finish_motion(page)
    displaced, repainted = rendered_motion(page, root, 2 * band[1], jitter)
    if reduced:
        assert not moving, f"{what} still moves under reduced motion: {moving}"
        assert len(displaced) <= 1, f"{what} moves across {len(displaced)} rendered frames under reduced motion"
        return
    if timed:
        return
    changing = displaced if must_move else sorted(set(displaced) | set(repainted))
    assert len(changing) >= 2, \
        f"{what}: no motion within {band} ms (declarative {[d for d, _ in found]}, rendered {changing})"
    lasted = changing[-1] + SAMPLE_STEP_MS
    assert band[0] - SAMPLE_STEP_MS <= lasted <= band[1] + SAMPLE_STEP_MS, f"{what}: rendered change lasts {lasted} ms"


def appear(page: Page, check: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> None:
    def step() -> bool:
        try:
            if check():
                return True
        except (AssertionError, PlaywrightError):
            pass
        advance(page, FRAME_MS)
        return False

    poll(step, seconds, what, pause=POLL_S / 5)


def check_bob(page: Page, members: Locator, reduced: bool) -> None:
    root = members.element_handle()
    loops = bob_loops(page)
    if reduced:
        assert loops == [], f"loops run under reduced motion: {len(loops)}"
    elif loops:
        assert len(loops) >= 2, "party beans do not bob"
        for loop in loops:
            assert loop["target"] is not None and loop["target"].evaluate("(el, root) => root.contains(el)", root), \
                "something outside the party beans loops"
            assert BOB_MIN_MS <= loop["duration"] <= BOB_MAX_MS, loop["duration"]
            rise = travel(loop["target"], ("y",))
            assert BOB_TRAVEL_PX[0] <= rise <= BOB_TRAVEL_PX[1], f"bob travel {rise}px"
        assert len({round(loop["progress"], 3) for loop in loops}) > 1, "beans bob in phase"
        return
    samples = []
    for _ in range(int(BOB_SPAN_MS / BOB_STEP_MS) + 1):
        samples.append(members.evaluate(
            "el => [...el.querySelectorAll('[data-hue]')].map(e => e.getBoundingClientRect().y)"))
        advance(page, BOB_STEP_MS)
    tracks = [list(track) for track in zip(*samples)]
    assert tracks, "the party card has no SVG bean with data-hue"
    if reduced:
        assert all(max(t) - min(t) < MOVE_PX for t in tracks), "party beans move under reduced motion"
        return
    for track in tracks:
        rise = max(track) - min(track)
        assert BOB_TRAVEL_PX[0] <= rise <= BOB_TRAVEL_PX[1], f"bob travel {rise}px"
        middle = (max(track) + min(track)) / 2
        ups = [i for i in range(1, len(track)) if track[i - 1] < middle <= track[i]]
        assert len(ups) >= 2, "a party bean never completes a bob cycle"
        period = (ups[-1] - ups[0]) / (len(ups) - 1) * BOB_STEP_MS
        assert BOB_MIN_MS - BOB_STEP_MS <= period <= BOB_MAX_MS + BOB_STEP_MS, f"bob period {period} ms"
    shapes = {tuple(round(y - min(track), 1) for y in track) for track in tracks}
    assert len(shapes) > 1, "beans bob in phase"


def after_motion(page: Page, check: Callable[[], Any]) -> Callable[[], Any]:
    def step() -> Any:
        finish_motion(page)
        return check()

    return step


def bob_loops(page: Page) -> list[dict]:
    found = page.evaluate_handle(LOOP_ANIMATIONS)
    loops = []
    for animation in found.get_properties().values():
        timing = animation.evaluate("""a => ({duration: Number(a.effect.getComputedTiming().duration) || 0,
            progress: a.effect.getComputedTiming().progress})""")
        timing["target"] = animation.evaluate_handle("a => a.effect.target").as_element()
        loops.append(timing)
    return loops


def banner_gone(page: Page) -> Callable[[], bool]:
    banner = role(page, "alert", "Round result")

    def check() -> bool:
        if banner.count() == 0 or not banner.first.is_visible():
            return True
        return float(style(banner.first, "opacity")["opacity"]) < 0.05

    return check


CLOCK_SHIM = """
const offset = Number(process.env.PC_VERIFIER_CLOCK_OFFSET_MS || 0);
const RealDate = Date;
class ShiftedDate extends RealDate {
  constructor(...args) { if (args.length === 0) { super(RealDate.now() + offset); } else { super(...args); } }
  static now() { return RealDate.now() + offset; }
}
globalThis.Date = ShiftedDate;
const netLog = process.env.PC_VERIFIER_NET_LOG;
if (netLog) {
  const fs = require('fs');
  const net = require('net');
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let o = args[0];
    if (Array.isArray(o)) o = o[0];
    let host = 'localhost';
    if (o && typeof o === 'object') host = o.path ? 'unix-socket' : (o.host || 'localhost');
    else if (typeof args[1] === 'string') host = args[1];
    try { fs.appendFileSync(netLog, String(host) + '\\n'); } catch (e) {}
    return connect.apply(this, args);
  };
}
"""


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def clone_deployed(stack: ExitStack) -> Path:
    source = Path(str(_helper("DEPLOYED_APP")))
    target = Path(tempfile.mkdtemp(prefix="pc-clone-")) / "app"
    shutil.copytree(source, target, symlinks=True)
    stack.callback(shutil.rmtree, target.parent, True)
    return target


def start_copy(stack: ExitStack, offset_minutes: int, root: Path | None = None, env_extra: dict[str, str] | None = None,
               ready: bool = True) -> str:
    deployed = root or Path(str(_helper("DEPLOYED_APP")))
    manifest_path = deployed / "run.json" if (deployed / "run.json").exists() else Path("/app/run.json")
    serve = json.loads(manifest_path.read_text())["serve"]
    workdir = Path(tempfile.mkdtemp(prefix="pc-copy-"))
    shim = workdir / "clock.cjs"
    shim.write_text(CLOCK_SHIM)
    port = free_port()
    env = dict(os.environ)
    env["APP_PUBLIC_PORT"] = str(port)
    env["PC_VERIFIER_CLOCK_OFFSET_MS"] = str(offset_minutes * 60 * 1000)
    env["NODE_OPTIONS"] = (env.get("NODE_OPTIONS", "") + f" --require {shim}").strip()
    env.update(env_extra or {})
    log_path = workdir / "serve.log"
    log = open(log_path, "wb")
    process = subprocess.Popen(serve, shell=True, cwd=str(deployed), env=env, stdout=log,
                               stderr=subprocess.STDOUT, start_new_session=True)

    def stop() -> None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        log.close()

    stack.callback(stop)
    base = f"http://127.0.0.1:{port}"

    def healthy() -> bool:
        if process.poll() is not None:
            tail = log_path.read_text(errors="replace")[-4000:]
            raise RuntimeError(f"app copy exited with {process.returncode}:\n{tail}")
        with contextlib.suppress(httpx.HTTPError):
            return request(base, "GET", "/api/health").status_code == 200 if ready else True
        return False

    try:
        poll(healthy, BOOT_WAIT_S, "app copy health")
    except AssertionError as error:
        raise AssertionError(f"{error}\n{log_path.read_text(errors='replace')[-4000:]}") from error
    return base


def ws_close_code(base: str, origin: str | None, cookie: str | None) -> int:
    parsed = urlparse(base)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    raw = socket.create_connection((parsed.hostname, port), timeout=HTTP_TIMEOUT_S)
    sock: Any = ssl.create_default_context().wrap_socket(raw, server_hostname=parsed.hostname) \
        if parsed.scheme == "https" else raw
    try:
        key = base64.b64encode(os.urandom(16)).decode()
        lines = [f"GET /ws HTTP/1.1", f"Host: {parsed.netloc}", "Upgrade: websocket", "Connection: Upgrade",
                 f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13"]
        if origin:
            lines.append(f"Origin: {origin}")
        if cookie:
            lines.append(f"Cookie: {SESSION_COOKIE}={cookie}")
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        buffer = b""
        while b"\r\n\r\n" not in buffer:
            chunk = sock.recv(4096)
            assert chunk, "socket closed before the upgrade answer"
            buffer += chunk
        head, buffer = buffer.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0].decode()
        assert " 101 " in status + " ", f"upgrade refused at HTTP level: {status}"

        def take(count: int) -> bytes:
            nonlocal buffer
            while len(buffer) < count:
                chunk = sock.recv(4096)
                assert chunk, "socket closed without a close frame"
                buffer += chunk
            out, buffer = buffer[:count], buffer[count:]
            return out

        while True:
            first, second = take(2)
            length = second & 0x7F
            if length == 126:
                length = struct.unpack(">H", take(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", take(8))[0]
            payload = take(length)
            if first & 0x0F == 0x8:
                return struct.unpack(">H", payload[:2])[0]
    finally:
        sock.close()


def check_frame_rules(frame: dict, results: list[dict], kind: str, slots: int) -> None:
    tick, last, beans = frame["tick"], frame["lastTick"], frame["beans"]
    by_id = {r["userId"]: r for r in results}
    assert [b["rank"] for b in beans] == list(range(1, len(beans) + 1))
    assert sorted(b["userId"] for b in beans) == sorted(by_id), "frame does not hold one bean per starter"
    for bean in beans:
        assert bean["state"] in BEAN_STATES
        assert bean["hue"] == hue_of(bean["userId"])
        result = by_id[bean["userId"]]
        qualified = result["outcome"] == "qualified" and result["finishTick"] <= tick
        assert (bean["state"] == "qualified") == qualified, (tick, bean, result)
        expected_finish = result["finishTick"] if qualified else None
        assert bean["finishTick"] == expected_finish, (tick, bean)
        out = result["outcome"] == "eliminated" and result["eliminatedTick"] <= tick
        assert (bean["state"] == "eliminated") == out, (tick, bean, result)
    groups = {"qualified": [], "play": [], "out": []}
    for bean in beans:
        groups["qualified" if bean["state"] == "qualified" else "play" if bean["state"] in IN_PLAY else "out"].append(bean)
    assert beans == groups["qualified"] + groups["play"] + groups["out"], f"rank groups out of order at {tick}"
    finish = [(by_id[b["userId"]]["finishTick"], b["userId"]) for b in groups["qualified"]]
    assert finish == sorted(finish)
    for first, second in zip(groups["play"], groups["play"][1:]):
        if kind == "survival":
            assert first["userId"] < second["userId"]
        else:
            assert first["z"] >= second["z"], f"in-play beans not by z at {tick}"
            if first["z"] == second["z"] and tick == 0:
                assert first["userId"] < second["userId"], "spawn-row z tie not broken by ascending id"
    for first, second in zip(groups["out"], groups["out"][1:]):
        t1, t2 = by_id[first["userId"]]["eliminatedTick"], by_id[second["userId"]]["eliminatedTick"]
        assert t1 >= t2, f"eliminated beans not by elimination tick at {tick}"
        if t1 == t2 and kind == "survival":
            assert first["userId"] < second["userId"], f"same-tick survival eliminations not by id at {tick}"
        elif t1 == t2:
            assert first["z"] >= second["z"], f"same-tick eliminations not by z at {tick}"
    if kind == "survival":
        expected_left = max(sum(1 for b in beans if b["state"] == "alive") - slots, 0)
    else:
        expected_left = slots - len(groups["qualified"])
    assert frame["slotsLeft"] == expected_left, (tick, frame["slotsLeft"], expected_left)
    if tick == last and groups["qualified"]:
        lowest = groups["qualified"][-1]["rank"]
        for bean in beans:
            marker = "last_slot" if bean["rank"] == lowest else "first_out" if bean["rank"] == lowest + 1 else None
            assert bean["marker"] == marker, (bean, marker)
    elif tick != last:
        assert all(b["marker"] is None for b in beans)


def check_results(sim: dict, kind: str, starters: list[int]) -> None:
    results, last, slots = sim["results"], sim["lastTick"], sim["slots"]
    assert slots == slots_for(kind, len(starters))
    assert sorted(r["userId"] for r in results) == sorted(starters)
    qualified = [r for r in results if r["outcome"] == "qualified"]
    for r in results:
        if r["outcome"] == "qualified":
            assert r["eliminatedTick"] is None and isinstance(r["finishTick"], int)
        else:
            assert r["finishTick"] is None and isinstance(r["eliminatedTick"], int) and r["eliminatedTick"] <= last
    if kind != "survival":
        assert len(qualified) <= slots
        if len(qualified) == slots:
            assert last == max(r["finishTick"] for r in qualified)
    else:
        assert all(r["finishTick"] == last for r in qualified)
    assert last <= KIND_LIMIT_S[kind] * TICKS_PER_S


def test_signup_sends_verification_link(app_url, mail):
    email_address, handle = identity()
    password = fresh_password()
    response = request(app_url, "POST", "/api/auth/signup",
                       {"email": email_address.upper(), "handle": handle, "password": password})
    assert response.status_code == 201, response.text
    body = response.json()
    user = body["user"]
    assert body["verificationEmail"] == "sent"
    assert user["email"] == email_address and user["handle"] == handle and user["emailVerified"] is False
    assert isinstance(user["id"], int) and user["id"] > 0 and user["hue"] == hue_of(user["id"])
    me = request(app_url, "GET", "/api/me", cookie=session_cookie(response))
    assert me.status_code == 200 and me.json()["user"]["id"] == user["id"]

    message = poll(lambda: mail_for(mail, email_address, VERIFY_SUBJECT), MAIL_WAIT_S, "verification mail")[0]
    assert MAIL_FROM in [a.lower() for a in _helper("addresses")(message.get("From"))]
    content = _helper("text")(message)
    assert "/verify?token=" in content and EXPIRY_LINE in content
    assert stored_anywhere(email_address) > 0
    assert stored_anywhere(password) == 0, "the plain password is stored in PostgreSQL"

    rejected = []
    cases = [
        ({"email": "not-an-email"}, "email", "Enter a valid email address."),
        ({"handle": "Bad Handle!"}, "handle", "Use 3 to 20 lowercase letters, digits or underscores."),
        ({"handle": "ab"}, "handle", "Use 3 to 20 lowercase letters, digits or underscores."),
        ({"password": "short"}, "password", "Use 10 to 128 characters."),
        ({"password": "x" * 129}, "password", "Use 10 to 128 characters."),
    ]
    for override, field, copy in cases:
        fresh_email, fresh_handle = identity()
        candidate = {"email": fresh_email, "handle": fresh_handle, "password": fresh_password()} | override
        rejected.append(candidate["email"])
        error = expect_error(request(app_url, "POST", "/api/auth/signup", candidate), 422, "validation_failed")
        assert error["fields"][field] == copy, error
    other_email, other_handle = identity()
    expect_error(request(app_url, "POST", "/api/auth/signup",
                         {"email": email_address.upper(), "handle": other_handle, "password": fresh_password()}),
                 409, "email_taken")
    expect_error(request(app_url, "POST", "/api/auth/signup",
                         {"email": other_email, "handle": handle, "password": fresh_password()}), 409, "handle_taken")
    rejected.append(other_email)
    for address in rejected:
        assert mail_for(mail, address, VERIFY_SUBJECT) == [], f"mail sent for rejected sign-up {address}"

    shared_email, shared_handle = identity()[0], identity()[1]
    for field, code, make in (
            ("email", "email_taken", lambda: {"email": shared_email, "handle": identity()[1], "password": fresh_password()}),
            ("handle", "handle_taken", lambda: {"email": identity()[0], "handle": shared_handle, "password": fresh_password()})):
        bodies = [make() for _ in range(SIGNUP_RACERS)]
        raced = fire_together([lambda body=body: request(app_url, "POST", "/api/auth/signup", body) for body in bodies])
        statuses = sorted(r.status_code for r in raced)
        assert statuses == [201] + [409] * (SIGNUP_RACERS - 1), f"concurrent sign-ups sharing a {field}: {[r.text for r in raced]}"
        assert {error_code(r) for r in raced if r.status_code == 409} == {code}


def test_links_single_use_and_replaced(app_url, mail):
    player = signup(app_url, verify=False)
    first = new_token(mail, player.email, VERIFY_SUBJECT, "verify")
    resent = player.post("/api/auth/verification/resend")
    assert resent.status_code == 202 and resent.json() == {"verificationEmail": "sent"}
    second = new_token(mail, player.email, VERIFY_SUBJECT, "verify", (first,))
    expect_error(request(app_url, "POST", "/api/auth/verify", {"token": first}), 410, "link_invalid")
    ok = request(app_url, "POST", "/api/auth/verify", {"token": second})
    assert ok.status_code == 200 and ok.json()["user"]["emailVerified"] is True
    expect_error(request(app_url, "POST", "/api/auth/verify", {"token": second}), 410, "link_invalid")
    expect_error(request(app_url, "POST", "/api/auth/verify", {"token": "never-issued-" + secrets.token_hex(8)}),
                 410, "link_invalid")
    expect_error(player.post("/api/auth/verification/resend"), 409, "already_verified")

    for _ in range(2):
        assert request(app_url, "POST", "/api/auth/password-reset", {"email": player.email}).status_code == 202
    resets = poll(lambda: len(t := link_tokens(mail_for(mail, player.email, RESET_SUBJECT), "reset-password")) >= 2 and t,
                  MAIL_WAIT_S, "two reset mails")
    statuses = []
    for token in resets[:2]:
        statuses.append(request(app_url, "POST", "/api/auth/password-reset/confirm",
                                {"token": token, "password": fresh_password()}))
    codes = sorted((r.status_code, r.json().get("error", {}).get("code", "")) for r in statuses)
    assert codes == [(200, ""), (410, "link_invalid")], codes
    used = resets[0] if statuses[0].status_code == 200 else resets[1]
    expect_error(request(app_url, "POST", "/api/auth/password-reset/confirm",
                         {"token": used, "password": fresh_password()}), 410, "link_invalid")

    for _ in range(LINK_RACES):
        racer = signup(app_url, verify=False)
        token = new_token(mail, racer.email, VERIFY_SUBJECT, "verify")
        raced = fire_together([lambda: request(app_url, "POST", "/api/auth/verify", {"token": token})
                               for _ in range(LINK_RACERS)])
        assert sorted(r.status_code for r in raced) == [200] + [410] * (LINK_RACERS - 1), [r.text for r in raced]
        assert {error_code(r) for r in raced if r.status_code == 410} == {"link_invalid"}
        assert request(app_url, "POST", "/api/auth/password-reset", {"email": racer.email}).status_code == 202
        token = new_token(mail, racer.email, RESET_SUBJECT, "reset-password")
        raced = fire_together([lambda: request(app_url, "POST", "/api/auth/password-reset/confirm",
                                               {"token": token, "password": fresh_password()})
                               for _ in range(LINK_RACERS)])
        assert sorted(r.status_code for r in raced) == [200] + [410] * (LINK_RACERS - 1), [r.text for r in raced]
        assert {error_code(r) for r in raced if r.status_code == 410} == {"link_invalid"}

    issued = signup(app_url, verify=False)
    first = new_token(mail, issued.email, VERIFY_SUBJECT, "verify")
    fire_together([lambda: issued.post("/api/auth/verification/resend") for _ in range(ISSUE_RACERS)])
    links = poll(lambda: len(t := link_tokens(mail_for(mail, issued.email, VERIFY_SUBJECT), "verify")) > ISSUE_RACERS and t,
                 MAIL_WAIT_S, "every verification link issued at once")
    assert first in links
    worked = [t for t in links if request(app_url, "POST", "/api/auth/verify", {"token": t}).status_code == 200]
    assert len(worked) == 1, f"{len(worked)} of {len(links)} verification links issued at once still work"
    fire_together([lambda: request(app_url, "POST", "/api/auth/password-reset", {"email": issued.email})
                   for _ in range(ISSUE_RACERS)])
    links = poll(lambda: len(t := link_tokens(mail_for(mail, issued.email, RESET_SUBJECT), "reset-password")) >= ISSUE_RACERS
                 and t, MAIL_WAIT_S, "every reset link issued at once")
    worked = [t for t in links if request(app_url, "POST", "/api/auth/password-reset/confirm",
                                          {"token": t, "password": fresh_password()}).status_code == 200]
    assert len(worked) == 1, f"{len(worked)} of {len(links)} reset links issued at once still work"


def test_links_expire_on_server_process_clock(app_url, mail):
    with ExitStack() as stack:
        late = start_copy(stack, EXPIRED_OFFSET_MIN)
        soon = start_copy(stack, FRESH_OFFSET_MIN)
        def issue() -> tuple[Player, str, str]:
            who = signup(app_url, verify=False)
            verify = new_token(mail, who.email, VERIFY_SUBJECT, "verify")
            assert request(app_url, "POST", "/api/auth/password-reset", {"email": who.email}).status_code == 202
            return who, verify, new_token(mail, who.email, RESET_SUBJECT, "reset-password")

        _, stale_verify, stale_reset = issue()
        expect_error(request(late, "POST", "/api/auth/verify", {"token": stale_verify}), 410, "link_expired")
        expect_error(request(late, "POST", "/api/auth/password-reset/confirm",
                             {"token": stale_reset, "password": fresh_password()}), 410, "link_expired")
        player, verify_token, reset_token = issue()
        ok = request(soon, "POST", "/api/auth/verify", {"token": verify_token})
        assert ok.status_code == 200 and ok.json()["user"]["emailVerified"] is True, ok.text
        new_password = fresh_password()
        changed_password = request(soon, "POST", "/api/auth/password-reset/confirm",
                                   {"token": reset_token, "password": new_password})
        assert changed_password.status_code == 200 and changed_password.json() == {"status": "password_changed"}
        assert login(app_url, player.email, new_password).status_code == 200


def test_unverified_accounts_are_gated(app_url, mail):
    player = signup(app_url, verify=False)
    gated = [
        ("GET", "/api/friends", None), ("POST", "/api/friends/requests", {"handle": PIP}),
        ("POST", "/api/blocks", {"userId": 1}), ("GET", "/api/party", None),
        ("POST", "/api/party/queue", {}), ("POST", "/api/party/invites", {"userId": 1}),
        ("GET", "/api/party/messages", None), ("POST", "/api/party/messages", {"body": "hi"}),
        ("POST", "/api/dms/1/messages", {"body": "hi"}), ("GET", "/api/lobbies/1", None),
    ]
    for method, path, body in gated:
        expect_error(player.call(method, path, body), 403, "email_unverified")
    pip = seeded(app_url, PIP)
    assert all(r["from"]["id"] != player.id for r in friends_of(pip)["incoming"])
    assert player.get("/api/me").status_code == 200
    assert player.get(f"/api/matches/{SEED_MATCH}").status_code == 200
    assert player.get(f"/api/users/{PIP}").status_code == 200
    lark = login(app_url, f"late_lark@{SEED_DOMAIN}", SEED_PASSWORD)
    assert lark.status_code == 200 and lark.json()["user"]["emailVerified"] is False
    expect_error(request(app_url, "GET", "/api/friends", cookie=session_cookie(lark)), 403, "email_unverified")
    token = new_token(mail, player.email, VERIFY_SUBJECT, "verify")
    assert request(app_url, "POST", "/api/auth/verify", {"token": token}).status_code == 200
    assert player.get("/api/friends").status_code == 200


def test_sign_in_cookie_and_sign_out(app_url, mail, browser):
    player = signup(app_url, verify=False)
    expect_error(login(app_url, player.email, "Wrong-" + player.password), 401, "invalid_credentials")
    expect_error(login(app_url, "nobody-" + player.email, player.password), 401, "invalid_credentials")
    expect_error(request(app_url, "GET", "/api/me"), 401, "unauthenticated")
    first = login(app_url, player.email.upper(), player.password)
    assert first.status_code == 200 and first.json()["user"]["id"] == player.id
    header = next(h for h in first.headers.get_list("set-cookie") if h.startswith(SESSION_COOKIE + "="))
    assert HTTP_ONLY.lower() in header.lower() and SAME_SITE.lower() in header.lower(), header
    second = login(app_url, player.email, player.password)
    cookie_one, cookie_two = session_cookie(first), session_cookie(second)
    me = request(app_url, "GET", "/api/me", cookie=cookie_one)
    assert me.status_code == 200 and set(me.json()["user"]) >= {"id", "handle", "hue", "email", "emailVerified"}
    out = request(app_url, "POST", "/api/auth/logout", {}, cookie=cookie_one)
    assert out.status_code == 204
    assert any(h.startswith(SESSION_COOKIE + "=") for h in out.headers.get_list("set-cookie"))
    expect_error(request(app_url, "GET", "/api/me", cookie=cookie_one), 401, "unauthenticated")
    assert request(app_url, "GET", "/api/me", cookie=cookie_two).status_code == 200

    lead, member = players(app_url, mail, 2)
    form_party(lead, [member])
    with ExitStack() as stack:
        stack.callback(release, [lead, member])
        page = as_player(stack, browser, app_url, member)
        identity_line = page.get_by_text(f"Signed in as {member.handle}", exact=True)
        ui(visible(identity_line), UI_WAIT_S, "signed-in identity in the top bar")
        party_rows = role(page, "list", "In your party").get_by_role("listitem")
        mine = with_attr(party_rows, "data-user-id", member.id)
        theirs = with_attr(party_rows, "data-user-id", lead.id)
        ui(sees(mine, member.handle + YOU_SUFFIX), UI_WAIT_S, "own party row marked (you)")
        ui(visible(theirs), UI_WAIT_S, "leader's party row")
        assert YOU_SUFFIX.strip() not in theirs.inner_text(), theirs.inner_text()
        role(page, "button", "Sign out").click()
        ui(lambda: urlparse(page.url).path == "/signin", UI_WAIT_S, "signed out to /signin")
        ui(gone(identity_line), UI_WAIT_S, "identity gone after sign-out")


def test_password_reset_flow(app_url, mail):
    player = signup(app_url, verify=False)
    ghost, _ = identity()
    known = request(app_url, "POST", "/api/auth/password-reset", {"email": player.email})
    unknown = request(app_url, "POST", "/api/auth/password-reset", {"email": ghost})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json() == {"status": "accepted"}
    error = expect_error(request(app_url, "POST", "/api/auth/password-reset", {"email": "nope"}), 422, "validation_failed")
    assert error["fields"]["email"] == "Enter a valid email address."
    message = poll(lambda: mail_for(mail, player.email, RESET_SUBJECT), MAIL_WAIT_S, "reset mail")[0]
    assert MAIL_FROM in [a.lower() for a in _helper("addresses")(message.get("From"))]
    assert EXPIRY_LINE in _helper("text")(message)
    token = link_tokens([message], "reset-password")[0]
    assert mail_for(mail, ghost, RESET_SUBJECT) == []
    weak = request(app_url, "POST", "/api/auth/password-reset/confirm", {"token": token, "password": "short"})
    assert expect_error(weak, 422, "validation_failed")["fields"]["password"] == "Use 10 to 128 characters."
    new_password = fresh_password()
    done = request(app_url, "POST", "/api/auth/password-reset/confirm",
                   {"token": token, "password": new_password})
    assert done.status_code == 200 and done.json() == {"status": "password_changed"}
    expect_error(player.get("/api/me"), 401, "unauthenticated")
    expect_error(login(app_url, player.email, player.password), 401, "invalid_credentials")
    assert login(app_url, player.email, new_password).status_code == 200
    expect_error(request(app_url, "POST", "/api/auth/password-reset/confirm",
                         {"token": token, "password": fresh_password()}), 410, "link_invalid")


def test_mail_outage_signup_resend_and_reset(app_url, mail):
    down = outage_url()
    slow = MAIL_DECIDE_S + RESPONSE_SLACK_S
    email_address, handle = identity()
    password = fresh_password()
    created = request(down, "POST", "/api/auth/signup",
                      {"email": email_address, "handle": handle, "password": password}, timeout=slow)
    assert created.status_code == 201, created.text
    assert created.json()["verificationEmail"] == "failed"
    assert created.json()["user"]["emailVerified"] is False
    cookie = session_cookie(created)
    expect_error(request(down, "POST", "/api/auth/verification/resend", {}, cookie=cookie, timeout=slow),
                 503, "mail_unavailable")
    ghost, _ = identity()
    verified = signup(app_url, mail)
    for address in (email_address, ghost, verified.email):
        expect_error(request(down, "POST", "/api/auth/password-reset", {"email": address}, timeout=slow),
                     503, "mail_unavailable")
    assert mail_for(mail, email_address, VERIFY_SUBJECT) == []
    assert mail_for(mail, verified.email, RESET_SUBJECT) == []
    back = login(app_url, email_address, password)
    assert back.status_code == 200
    player = Player(app_url, email_address, handle, password, back.json()["user"]["id"], session_cookie(back))
    resent = player.post("/api/auth/verification/resend")
    assert resent.status_code == 202 and resent.json() == {"verificationEmail": "sent"}
    token = new_token(mail, email_address, VERIFY_SUBJECT, "verify")
    ok = request(app_url, "POST", "/api/auth/verify", {"token": token})
    assert ok.status_code == 200 and ok.json()["user"]["emailVerified"] is True


def test_wf_account_signup_verify(app_url, mail, browser):
    with ExitStack() as stack:
        page = browse(stack, browser, app_url + "/signup")
        email_address, handle = identity()
        page.get_by_label("Email", exact=True).fill(email_address)
        page.get_by_label("Handle", exact=True).fill(handle)
        page.get_by_label("Password", exact=True).fill(fresh_password())
        role(page, "button", "Create account").click()
        ui(noticed(page), UI_WAIT_S, "created")
        ui(sees(role(page, "region", "Verify your email"), "Verify your email to add friends and find matches."),
           UI_WAIT_S, "banner")
        token = new_token(mail, email_address, VERIFY_SUBJECT, "verify")
        page.goto(f"{app_url}/verify?token={quote(token, safe='')}")
        ui(sees(role(page, "region", "Verification"), "Email verified. You can add friends and play."),
           UI_WAIT_S, "verified copy")
        page.goto(app_url + "/")
        ui(visible(role(page, "textbox", "Add friend by handle")), UI_WAIT_S, "rail")
        ui(gone(role(page, "region", "Verify your email")), UI_WAIT_S, "banner gone")
        me = page.request.get(app_url + "/api/me")
        assert me.status == 200 and me.json()["user"]["emailVerified"] is True


def test_wf_account_fix_taken_handle(app_url, mail, browser):
    taken = signup(app_url, verify=False)
    with ExitStack() as stack:
        page = browse(stack, browser, app_url + "/signup")
        email_address, handle = identity()
        password = fresh_password()
        page.get_by_label("Email", exact=True).fill(email_address)
        page.get_by_label("Handle", exact=True).fill(taken.handle)
        page.get_by_label("Password", exact=True).fill(password)
        role(page, "button", "Create account").click()
        ui(noticed(page), UI_WAIT_S, "field notice")
        page.get_by_label("Handle", exact=True).fill(handle)
        role(page, "button", "Create account").click()
        ui(noticed(page), UI_WAIT_S, "ok")
        signed_in = poll(lambda: (r := login(app_url, email_address, password)).status_code == 200 and r,
                         UI_WAIT_S, "account created")
    assert signed_in.json()["user"]["handle"] == handle


def test_wf_account_mail_outage(app_url, mail, browser):
    down = outage_url()
    email_address, handle = identity()
    password = fresh_password()
    with ExitStack() as stack:
        page = browse(stack, browser, down + "/signup")
        page.get_by_label("Email", exact=True).fill(email_address)
        page.get_by_label("Handle", exact=True).fill(handle)
        page.get_by_label("Password", exact=True).fill(password)
        role(page, "button", "Create account").click()
        ui(noticed(page),
           UI_WAIT_S, "failed copy")
        role(page, "button", "Resend verification email").click()
        ui(noticed(page), UI_WAIT_S, "mail down copy")
        healthy = browse(stack, browser, app_url + "/signin")
        healthy.get_by_label("Email", exact=True).fill(email_address)
        healthy.get_by_label("Password", exact=True).fill(password)
        role(healthy, "button", "Sign in").click()
        ui(visible(role(healthy, "button", "Resend verification email")), UI_WAIT_S, "banner")
        role(healthy, "button", "Resend verification email").click()
        ui(noticed(healthy), UI_WAIT_S, "sent copy")
    assert new_token(mail, email_address, VERIFY_SUBJECT, "verify")


def test_wf_account_reset_password(app_url, mail, browser):
    player = signup(app_url, mail)
    used = link_tokens(mail_for(mail, player.email, VERIFY_SUBJECT), "verify")[0]
    new_password = fresh_password()
    with ExitStack() as stack:
        page = browse(stack, browser, f"{app_url}/verify?token={quote(used, safe='')}")
        ui(sees(role(page, "region", "Verification"), "This link has already been used or replaced by a newer one."),
           UI_WAIT_S, "used copy")
        page.goto(app_url + "/signin")
        role(page, "link", "Forgot password?").click()
        page.get_by_label("Email", exact=True).fill(player.email)
        role(page, "button", "Send reset link").click()
        ui(noticed(page), UI_WAIT_S, "reset copy")
        token = new_token(mail, player.email, RESET_SUBJECT, "reset-password")
        page.goto(f"{app_url}/reset-password?token={quote(token, safe='')}")
        page.get_by_label("New password", exact=True).fill(new_password)
        role(page, "button", "Set new password").click()
        ui(noticed(page), UI_WAIT_S, "changed copy")
    assert login(app_url, player.email, new_password).status_code == 200


def test_friend_requests_lifecycle(app_url, mail):
    a, b, c = players(app_url, mail, 3)
    sent = a.post("/api/friends/requests", {"handle": b.handle})
    assert sent.status_code == 201, sent.text
    req = sent.json()["request"]
    assert req["status"] == "pending" and req["to"]["id"] == b.id and TS.match(req["sentAt"])
    replay = a.post("/api/friends/requests", {"handle": b.handle})
    assert replay.status_code == 200 and replay.json()["request"]["id"] == req["id"]
    assert [r["id"] for r in friends_of(b)["incoming"] if r["from"]["id"] == a.id] == [req["id"]]
    assert [r["id"] for r in friends_of(a)["outgoing"] if r["to"]["id"] == b.id] == [req["id"]]
    expect_error(a.post(f"/api/friends/requests/{req['id']}/accept"), 404, "request_not_found")
    expect_error(c.delete(f"/api/friends/requests/{req['id']}"), 404, "request_not_found")
    accepted = b.post(f"/api/friends/requests/{req['id']}/accept")
    assert accepted.status_code == 200 and accepted.json()["friendship"]["status"] == "accepted"
    assert accepted.json()["friendship"]["user"]["id"] == a.id
    expect_error(b.post(f"/api/friends/requests/{req['id']}/accept"), 404, "request_not_found")
    expect_error(a.post("/api/friends/requests", {"handle": b.handle}), 409, "already_friends")
    assert expect_error(a.post("/api/friends/requests", {"handle": a.handle}), 422, "validation_failed")["fields"]["handle"]
    expect_error(a.post("/api/friends/requests", {"handle": "nobody_" + secrets.token_hex(4)}), 404, "user_not_found")
    declined = c.post("/api/friends/requests", {"handle": a.handle}).json()["request"]["id"]
    assert a.post(f"/api/friends/requests/{declined}/decline").status_code == 204
    expect_error(a.post(f"/api/friends/requests/{declined}/accept"), 404, "request_not_found")
    assert all(r["to"]["id"] != a.id for r in friends_of(c)["outgoing"])
    withdrawn = c.post("/api/friends/requests", {"handle": b.handle}).json()["request"]["id"]
    assert c.delete(f"/api/friends/requests/{withdrawn}").status_code == 204
    expect_error(b.post(f"/api/friends/requests/{withdrawn}/accept"), 404, "request_not_found")
    assert a.delete(f"/api/friends/{b.id}").status_code == 204
    assert all(f["user"]["id"] != a.id for f in friends_of(b)["friends"])
    expect_error(a.delete(f"/api/friends/{b.id}"), 404, "not_friends")
    expect_error(a.post(f"/api/friends/requests/{OVERSIZE_ID}/accept"), 404, "request_not_found")
    expect_error(a.post(f"/api/friends/requests/{OVERSIZE_ID}/decline"), 404, "request_not_found")
    expect_error(a.delete(f"/api/friends/requests/{OVERSIZE_ID}"), 404, "request_not_found")
    expect_error(a.delete(f"/api/friends/{OVERSIZE_ID}"), 404, "not_friends")


def test_requests_racing_a_block(app_url, mail):
    crowd = players(app_url, mail, 4 * RACE_PAIRS)
    for i in range(RACE_PAIRS):
        x, y, u, v = crowd[4 * i:4 * i + 4]
        asked, blocked = fire_together([lambda x=x, y=y: x.post("/api/friends/requests", {"handle": y.handle}),
                                        lambda x=x, y=y: y.post("/api/blocks", {"userId": x.id})])
        assert blocked.status_code == 201, blocked.text
        assert asked.status_code == 201 or error_code(asked) == "blocked", asked.text
        assert all(r["to"]["id"] != y.id for r in friends_of(x)["outgoing"]), "a request racing a block stayed pending"
        assert all(r["from"]["id"] != x.id for r in friends_of(y)["incoming"]), "a request racing a block stayed pending"
        pending = u.post("/api/friends/requests", {"handle": v.handle})
        assert pending.status_code == 201, pending.text
        accepted, blocked = fire_together(
            [lambda v=v, rid=pending.json()["request"]["id"]: v.post(f"/api/friends/requests/{rid}/accept"),
             lambda u=u, v=v: u.post("/api/blocks", {"userId": v.id})])
        assert blocked.status_code == 201, blocked.text
        assert accepted.status_code == 200 or error_code(accepted) == "request_not_found", accepted.text
        assert all(f["user"]["id"] != v.id for f in friends_of(u)["friends"]), "an accept racing a block left a friendship"
        assert all(f["user"]["id"] != u.id for f in friends_of(v)["friends"]), "an accept racing a block left a friendship"
        assert u.get(f"/api/users/{v.handle}").json()["friendship"] == "blocked"


def test_crossed_requests_merge(app_url, mail):
    crowd = players(app_url, mail, 10)
    for a, b in zip(crowd[0::2], crowd[1::2]):
        out = fire_together([lambda a=a, b=b: a.post("/api/friends/requests", {"handle": b.handle}),
                             lambda a=a, b=b: b.post("/api/friends/requests", {"handle": a.handle})])
        assert sorted(r.status_code for r in out) == [200, 201], [r.text for r in out]
        merged = next(r for r in out if r.status_code == 200).json()
        assert merged["friendship"]["status"] == "accepted"
        for me, other in ((a, b), (b, a)):
            view = friends_of(me)
            assert [f["user"]["id"] for f in view["friends"] if f["user"]["id"] == other.id] == [other.id]
            assert all(r["from"]["id"] != other.id for r in view["incoming"])
            assert all(r["to"]["id"] != other.id for r in view["outgoing"])


def test_presence_from_heartbeats_and_party(app_url, mail, browser):
    a, b, c, d = players(app_url, mail, 4)
    befriend(a, b)
    befriend(a, c)
    with ExitStack() as stack:
        stack.callback(release, [a, b, c, d])
        assert presence_of(b, a.id) == "offline"
        rail = as_player(stack, browser, app_url, b)
        row = with_attr(role(rail, "list", "Friends").get_by_role("listitem"), "data-user-id", a.id)

        def worded(presence: str) -> Callable[[], bool]:
            def check() -> bool:
                assert row.get_attribute("data-presence", timeout=EXPECT_MS) == presence
                spoken = row.aria_snapshot(timeout=EXPECT_MS)
                assert PRESENCE_WORDS[presence] in spoken, spoken
                assert not [w for p, w in PRESENCE_WORDS.items() if p != presence and w in spoken], spoken
                return True
            return check

        ui(worded("offline"), UI_WAIT_S, "Offline word in the rail row")
        watcher = open_wire(stack, browser, app_url, b)
        subject = open_wire(stack, browser, app_url, a)
        poll(lambda: presence_of(b, a.id) == "online", PRESENCE_LAG_S + RESPONSE_SLACK_S, "online")
        watcher.wait("id => window.__log.some(m => m.type === 'presence' && m.userId === id && m.presence === 'online')", a.id)
        ui(worded("online"), PRESENCE_LAG_S + RESPONSE_SLACK_S, "Online word in the rail row")
        invite_and_join(c, a)
        poll(lambda: presence_of(b, a.id) == "in_party", PRESENCE_LAG_S + RESPONSE_SLACK_S, "in_party")
        watcher.wait("id => window.__log.some(m => m.type === 'presence' && m.userId === id && m.presence === 'in_party')", a.id)
        ui(worded("in_party"), PRESENCE_LAG_S + RESPONSE_SLACK_S, "In a party word in the rail row")
        assert b.get(f"/api/users/{a.handle}").json()["presence"] == "in_party"
        assert d.get(f"/api/users/{a.handle}").json()["presence"] is None
        assert a.get(f"/api/users/{a.handle}").json()["presence"] is None, "own profile view is not a friend's view"
        assert a.post("/api/party/leave").status_code == 200
        poll(lambda: presence_of(b, a.id) == "online", PRESENCE_LAG_S + RESPONSE_SLACK_S, "online again")
        queue_seated(a)
        assert presence_of(b, a.id) == "in_party"
        assert a.post("/api/lobby/leave").status_code == 200
        poll(lambda: presence_of(b, a.id) == "online", PRESENCE_LAG_S + RESPONSE_SLACK_S, "online after the lobby")
        subject.silence()
        quiet = time.monotonic()
        grace = quiet + PRESENCE_OFFLINE_S - RESPONSE_SLACK_S
        seen: list[str | None] = []
        poll(lambda: seen.append(presence_of(b, a.id)) or time.monotonic() >= grace,
             PRESENCE_OFFLINE_S, "heartbeat grace period")
        assert "offline" not in seen, f"offline before {PRESENCE_OFFLINE_S} s without a heartbeat: {seen}"
        remaining = quiet + PRESENCE_OFFLINE_S + PRESENCE_LAG_S + RESPONSE_SLACK_S - time.monotonic()
        poll(lambda: presence_of(b, a.id) == "offline", max(remaining, 1.0),
             "offline once heartbeats stop on an open socket")
        assert all(p in PRESENCE for p in [f["presence"] for f in friends_of(b)["friends"]])


def test_wf_friends_add_accept_presence(app_url, mail, browser):
    a, b, c = players(app_url, mail, 3)
    befriend(a, c)
    with ExitStack() as stack:
        stack.callback(release, [a, b, c])
        page_a = as_player(stack, browser, app_url, a)
        page_b = as_player(stack, browser, app_url, b)
        field = role(page_a, "textbox", "Add friend by handle")
        ui(visible(field), UI_WAIT_S, "rail")
        field.fill(b.handle)
        field.press("Enter")
        ui(noticed(page_a), UI_WAIT_S, "sent")
        accept = role(page_b, "button", f"Accept {a.handle}")
        ui(visible(accept), UI_WAIT_S, "incoming request")
        accept.click()
        ui(noticed(page_b), UI_WAIT_S, "merge copy")
        row_b = with_attr(role(page_b, "list", "Friends").get_by_role("listitem"), "data-user-id", a.id)
        row_a = with_attr(role(page_a, "list", "Friends").get_by_role("listitem"), "data-user-id", b.id)
        ui(lambda: row_a.get_attribute("data-presence", timeout=EXPECT_MS) == "online", UI_WAIT_S, "a sees b online")
        ui(lambda: row_b.get_attribute("data-presence", timeout=EXPECT_MS) == "online", UI_WAIT_S, "b sees a online")
        invite_and_join(c, a)
        ui(lambda: row_b.get_attribute("data-presence", timeout=EXPECT_MS) == "in_party",
           PRESENCE_LAG_S + RESPONSE_SLACK_S, "b sees a in_party")
        page_a.close()
        ui(lambda: row_b.get_attribute("data-presence", timeout=EXPECT_MS) == "offline",
           PRESENCE_OFFLINE_S + PRESENCE_LAG_S + RESPONSE_SLACK_S, "b sees a offline")
    assert presence_of(b, a.id) == "offline"


def test_wf_friends_unknown_handle_recovery(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    missing = "nobody_" + secrets.token_hex(4)
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, a)
        field = role(page, "textbox", "Add friend by handle")
        ui(visible(field), UI_WAIT_S, "rail")
        field.fill(missing)
        role(page, "button", "Send request").click()
        ui(noticed(page), UI_WAIT_S, "unknown handle refused")
        field.fill(b.handle)
        role(page, "button", "Send request").click()
        ui(noticed(page), UI_WAIT_S, "sent copy")
        poll(lambda: any(r["from"]["id"] == a.id for r in friends_of(b)["incoming"]), UI_WAIT_S, "request reaches b")


def test_wf_friends_decline_and_withdraw(app_url, mail, browser):
    a, b, c = players(app_url, mail, 3)
    assert a.post("/api/friends/requests", {"handle": b.handle}).status_code == 201
    assert a.post("/api/friends/requests", {"handle": c.handle}).status_code == 201
    with ExitStack() as stack:
        page_b = as_player(stack, browser, app_url, b)
        page_a = as_player(stack, browser, app_url, a)
        ui(visible(role(page_b, "button", f"Decline {a.handle}")), UI_WAIT_S, "decline button")
        role(page_b, "button", f"Decline {a.handle}").click()
        ui(noticed(page_b), UI_WAIT_S, "declined")
        ui(visible(role(page_a, "button", f"Withdraw request to {c.handle}")), UI_WAIT_S, "withdraw button")
        role(page_a, "button", f"Withdraw request to {c.handle}").click()
        ui(noticed(page_a), UI_WAIT_S, "withdrawn")
    assert friends_of(a)["outgoing"] == []


def test_blocking_cuts_every_link(app_url, mail, browser):
    a, b, c, d = players(app_url, mail, 4)
    befriend(a, b)
    befriend(a, c)
    with ExitStack() as stack:
        stack.callback(release, [a, b, c, d])
        wire_b = open_wire(stack, browser, app_url, b)
        wire_c = open_wire(stack, browser, app_url, c)
        wire_a = open_wire(stack, browser, app_url, a)
        wire_b.wait("id => window.__log.some(m => m.type === 'presence' && m.userId === id)", a.id,
                    PRESENCE_LAG_S + RESPONSE_SLACK_S)
        assert a.post("/api/party/invites", {"userId": b.id}).status_code == 201
        assert b.post("/api/party/invites", {"userId": a.id}).status_code == 201
        assert d.post("/api/friends/requests", {"handle": a.handle}).status_code == 201
        blocked = a.post("/api/blocks", {"userId": b.id})
        marks = {w.player.id: w.page.evaluate("() => window.__log.length") for w in (wire_a, wire_b)}
        assert blocked.status_code == 201 and blocked.json()["blocked"]["id"] == b.id
        assert a.post("/api/blocks", {"userId": b.id}).status_code == 200
        assert a.post("/api/blocks", {"userId": d.id}).status_code == 201
        assert expect_error(a.post("/api/blocks", {"userId": a.id}), 422, "validation_failed")["fields"]["userId"]
        expect_error(a.post("/api/blocks", {"userId": UNKNOWN_ID}), 404, "user_not_found")
        expect_error(a.post("/api/blocks", {"userId": OVERSIZE_ID}), 404, "user_not_found")
        expect_error(a.delete(f"/api/blocks/{OVERSIZE_ID}"), 404, "not_blocked")
        view_a, view_b = friends_of(a), friends_of(b)
        assert b.id not in [f["user"]["id"] for f in view_a["friends"]] and c.id in [f["user"]["id"] for f in view_a["friends"]]
        assert a.id not in [f["user"]["id"] for f in view_b["friends"]]
        assert b.id in [u["id"] for u in view_a["blocked"]]
        assert all(r["from"]["id"] != d.id for r in view_a["incoming"])
        assert all(r["to"]["id"] != a.id for r in friends_of(d)["outgoing"])
        incoming_b = b.get("/api/party").json()["invites"]["incoming"]
        incoming_a = a.get("/api/party").json()["invites"]["incoming"]
        assert all(i["from"]["id"] != a.id for i in incoming_b) and all(i["from"]["id"] != b.id for i in incoming_a)
        for me, other in ((a, b), (b, a)):
            expect_error(me.post(f"/api/dms/{other.id}/messages", {"body": "hi"}), 403, "blocked")
            expect_error(me.post("/api/friends/requests", {"handle": other.handle}), 403, "blocked")
            expect_error(me.post("/api/party/invites", {"userId": other.id}), 403, "not_friends")
        assert a.get(f"/api/users/{b.handle}").json()["friendship"] == "blocked"
        profile = b.get(f"/api/users/{a.handle}").json()
        assert profile["friendship"] == "blocked_by" and profile["presence"] is None

        def leaked(wire: Wire, uid: int) -> int:
            return int(wire.page.evaluate(
                "([m, id]) => window.__log.slice(m).filter(x => x.type === 'presence' && x.userId === id"
                " && x.presence === 'in_party').length", [marks[wire.player.id], uid]))

        invite = c.post("/api/party/invites", {"userId": a.id})
        assert invite.status_code == 201, invite.text
        assert a.post(f"/api/party/invites/{invite.json()['invite']['id']}/accept").status_code == 200
        wire_c.wait("id => window.__log.some(m => m.type === 'presence' && m.userId === id && m.presence === 'in_party')",
                    a.id, PRESENCE_LAG_S + RESPONSE_SLACK_S)
        queue_seated(b)
        holds(lambda: leaked(wire_b, a.id) == 0 and leaked(wire_a, b.id) == 0, PRESENCE_LAG_S + RESPONSE_SLACK_S,
              "no presence event crosses the block")
        assert b.post("/api/lobby/leave").status_code == 200
        assert a.post("/api/party/leave").status_code == 200
        assert a.delete(f"/api/blocks/{b.id}").status_code == 204
        expect_error(a.delete(f"/api/blocks/{b.id}"), 404, "not_blocked")
        assert a.get(f"/api/users/{b.handle}").json()["friendship"] == "none"
        expect_error(a.post(f"/api/dms/{b.id}/messages", {"body": "hi"}), 403, "not_friends")
        assert a.post("/api/friends/requests", {"handle": b.handle}).status_code == 201


def invite_race_left_pending(inviter: Player, invitee: Player, blocker: Player, blocked: Player) -> bool:
    fire_together([lambda: inviter.post("/api/party/invites", {"userId": invitee.id}),
                   lambda: blocker.post("/api/blocks", {"userId": blocked.id})])
    incoming = invitee.get("/api/party").json()["invites"]["incoming"]
    outgoing = inviter.get("/api/party").json()["invites"]["outgoing"]
    return any(i["from"]["id"] == inviter.id for i in incoming) or any(i["to"]["id"] == invitee.id for i in outgoing)


def test_invites_racing_a_block(app_url, mail):
    crowd = players(app_url, mail, 2 * INVITE_RACE_PAIRS)
    with ExitStack() as stack:
        stack.callback(release, crowd)
        for inviter, invitee in zip(crowd[0::2], crowd[1::2]):
            befriend(inviter, invitee)
            assert not invite_race_left_pending(inviter, invitee, invitee, inviter), "an invite racing a block stayed pending"


def test_block_clears_open_invite_views(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    befriend(a, b)
    with ExitStack() as stack:
        stack.callback(release, [a, b])
        assert a.post("/api/party/invites", {"userId": b.id}).status_code == 201
        assert b.post("/api/party/invites", {"userId": a.id}).status_code == 201
        stage_a = as_player(stack, browser, app_url, a)
        stage_b = as_player(stack, browser, app_url, b)
        join_a = role(stage_a, "button", f"Join {b.handle}'s party")
        join_b = role(stage_b, "button", f"Join {a.handle}'s party")
        ui(visible(join_a), UI_WAIT_S, "a's stage shows b's invite")
        ui(visible(join_b), UI_WAIT_S, "b's stage shows a's invite")
        assert a.post("/api/blocks", {"userId": b.id}).status_code == 201
        for stage, join in ((stage_a, join_a), (stage_b, join_b)):
            ui(gone(join), INVITE_LAG_S + RESPONSE_SLACK_S, "the cancelled invite leaves the open stage")
            ui(gone(role(stage, "region", "Party invites")), INVITE_LAG_S + RESPONSE_SLACK_S,
               "no Party invites region once no invite is open")


def test_wf_safety_block_from_profile(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    befriend(a, b)
    with ExitStack() as stack:
        page_b = as_player(stack, browser, app_url, b)
        rail_b = with_attr(role(page_b, "list", "Friends").get_by_role("listitem"), "data-user-id", a.id)
        ui(visible(rail_b), UI_WAIT_S, "friend row on b")
        page_a = as_player(stack, browser, app_url, a, f"/u/{b.handle}")
        role(page_a, "button", f"Block {b.handle}").click()
        ui(noticed(page_a), UI_WAIT_S, "blocked copy")
        ui(visible(role(page_a, "button", f"Unblock {b.handle}")), UI_WAIT_S, "unblock offered")
        page_a.goto(app_url + "/")
        ui(visible(role(page_a, "textbox", "Add friend by handle")), UI_WAIT_S, "shell")
        ui(gone(with_attr(role(page_a, "list", "Friends").get_by_role("listitem"), "data-user-id", b.id)), UI_WAIT_S, "a rail")
        ui(gone(rail_b), UI_WAIT_S, "b rail drops a")
    expect_error(b.post(f"/api/dms/{a.id}/messages", {"body": "hi"}), 403, "blocked")


def test_wf_safety_unblock(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    befriend(a, b)
    assert a.post("/api/blocks", {"userId": b.id}).status_code == 201
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, a, f"/u/{b.handle}")
        ui(visible(role(page, "button", f"Unblock {b.handle}")), UI_WAIT_S, "unblock")
        role(page, "button", f"Unblock {b.handle}").click()
        ui(noticed(page), UI_WAIT_S, "unblocked copy")
        ui(visible(role(page, "button", "Add friend")), UI_WAIT_S, "add friend")
    assert a.get(f"/api/users/{b.handle}").json()["friendship"] == "none"


def test_party_invites_and_cap(app_url, mail):
    crew = players(app_url, mail, 8)
    leader, f1, f2, f3, f4, f5, f6, stranger = crew
    with ExitStack() as stack:
        stack.callback(release, crew)
        for friend in (f1, f2, f3, f4, f5, f6):
            befriend(leader, friend)
        first = leader.post("/api/party/invites", {"userId": f1.id})
        assert first.status_code == 201 and first.json()["invite"]["to"]["id"] == f1.id
        again = leader.post("/api/party/invites", {"userId": f1.id})
        assert again.status_code == 200 and again.json()["invite"]["id"] == first.json()["invite"]["id"]
        expect_error(leader.post("/api/party/invites", {"userId": stranger.id}), 403, "not_friends")
        party = f1.post(f"/api/party/invites/{first.json()['invite']['id']}/accept").json()["party"]
        assert member_ids(party) == {leader.id, f1.id} and party["leaderId"] == leader.id
        expect_error(f1.post("/api/party/invites", {"userId": f2.id}), 403, "not_leader")
        expect_error(leader.post("/api/party/invites", {"userId": f1.id}), 409, "already_in_party")
        nope = leader.post("/api/party/invites", {"userId": f6.id}).json()["invite"]["id"]
        assert f6.post(f"/api/party/invites/{nope}/decline").status_code == 204
        expect_error(f6.post(f"/api/party/invites/{nope}/accept"), 404, "invite_not_found")
        expect_error(f6.post(f"/api/party/invites/{OVERSIZE_ID}/accept"), 404, "invite_not_found")
        expect_error(f6.post(f"/api/party/invites/{OVERSIZE_ID}/decline"), 404, "invite_not_found")
        invite_and_join(leader, f2)
        third = leader.post("/api/party/invites", {"userId": f3.id}).json()["invite"]["id"]
        fourth = leader.post("/api/party/invites", {"userId": f4.id}).json()["invite"]["id"]
        assert len(f3.post(f"/api/party/invites/{third}/accept").json()["party"]["members"]) == 4
        expect_error(f4.post(f"/api/party/invites/{fourth}/accept"), 409, "party_full")
        expect_error(leader.post("/api/party/invites", {"userId": f5.id}), 409, "party_full")
        assert f3.post("/api/party/leave").status_code == 200
        queue_seated(leader)
        expect_error(f4.post(f"/api/party/invites/{fourth}/accept"), 409, "party_busy")
        expect_error(leader.post("/api/party/invites", {"userId": f5.id}), 409, "party_busy")
        assert leader.post("/api/lobby/leave").status_code == 200
        joined = f4.post(f"/api/party/invites/{fourth}/accept")
        assert joined.status_code == 200 and member_ids(joined.json()["party"]) == {leader.id, f1.id, f2.id, f4.id}


def test_invites_racing_the_inviters_block(app_url, mail):
    crowd = players(app_url, mail, 2 * INVITE_RACE_PAIRS)
    with ExitStack() as stack:
        stack.callback(release, crowd)
        for inviter, invitee in zip(crowd[0::2], crowd[1::2]):
            befriend(inviter, invitee)
            assert not invite_race_left_pending(inviter, invitee, inviter, invitee), "an invite racing the inviter's block stayed pending"


def test_party_leader_succession(app_url, mail, browser):
    leader, a, b, c, d = players(app_url, mail, 5)
    with ExitStack() as stack:
        stack.callback(release, [leader, a, b, c, d])
        befriend(leader, d)
        assert leader.post("/api/party/invites", {"userId": d.id}).status_code == 201
        form_party(leader, [a, b, c])
        assert any(i["from"]["id"] == leader.id for i in d.get("/api/party").json()["invites"]["incoming"])
        stage = as_player(stack, browser, app_url, d)
        join = role(stage, "button", f"Join {leader.handle}'s party")
        ui(visible(join), UI_WAIT_S, "the invitee's stage shows the invite")
        expect_error(a.post("/api/party/queue"), 403, "not_leader")
        expect_error(a.post("/api/party/queue/cancel"), 403, "not_leader")
        expect_error(a.post("/api/party/leader", {"userId": b.id}), 403, "not_leader")
        assert expect_error(leader.post("/api/party/leader", {"userId": d.id}), 422, "validation_failed")["fields"]["userId"]
        assert expect_error(leader.post("/api/party/leader", {"userId": OVERSIZE_ID}), 422, "validation_failed")["fields"]["userId"]
        handed = leader.post("/api/party/leader", {"userId": b.id})
        assert handed.status_code == 200 and handed.json()["party"]["leaderId"] == b.id
        assert all(i["from"]["id"] != leader.id for i in d.get("/api/party").json()["invites"]["incoming"])
        ui(gone(join), INVITE_LAG_S + RESPONSE_SLACK_S, "the invite cancelled by the hand-over leaves the open stage")
        solo = b.post("/api/party/leave").json()["party"]
        assert member_ids(solo) == {b.id} and solo["leaderId"] == b.id and solo["state"] == "idle"
        party = party_of(a)
        assert member_ids(party) == {leader.id, a.id, c.id} and party["leaderId"] == leader.id
        assert leader.post("/api/party/leave").status_code == 200
        party = party_of(c)
        assert member_ids(party) == {a.id, c.id} and party["leaderId"] == a.id
        assert a.post("/api/party/leave").status_code == 200
        assert party_of(c)["leaderId"] == c.id
        expect_error(c.post("/api/party/leave"), 409, "already_solo")


def test_wf_party_four_browsers(app_url, mail, browser):
    crew = players(app_url, mail, 4)
    leader, members = crew[0], crew[1:]
    for member in members:
        befriend(leader, member)
    with ExitStack() as stack:
        stack.callback(release, crew)
        pages = {p.id: as_player(stack, browser, app_url, p) for p in crew}
        lead_page = pages[leader.id]
        for member in members:
            button = role(lead_page, "button", f"Invite {member.handle} to party")
            ui(visible(button), UI_WAIT_S, "invite button")
            button.click()
            ui(noticed(lead_page), UI_WAIT_S, "invite copy")
            join = role(pages[member.id], "button", f"Join {leader.handle}'s party")
            ui(visible(join), INVITE_LAG_S + UI_WAIT_S, "invite shown")
            join.click()
            ui(noticed(pages[member.id]), UI_WAIT_S, "joined")
        everyone = {p.id for p in crew}
        for page in pages.values():
            ui(lambda page=page: set(row_ids(role(page, "list", "In your party"))) == everyone, UI_WAIT_S, "rail group")
            ui(lambda page=page: set(row_ids(role(page, "list", "Party members"))) == everyone, UI_WAIT_S, "stage group")
            leaders = [r for r in rows(role(page, "list", "Party members")) if r.get("leader") == "true"]
            assert [int(r["userId"]) for r in leaders] == [leader.id] and "Leader" in leaders[0]["text"]
        role(lead_page, "button", "Leave party").click()
        heir = members[0]
        for member in members:
            page = pages[member.id]
            ui(lambda page=page: [int(r["userId"]) for r in rows(role(page, "list", "Party members"))
                                  if r.get("leader") == "true"] == [heir.id], UI_WAIT_S, "leader moved")
            ui(noticed(page), UI_WAIT_S, "succession copy")
        assert party_of(members[1])["leaderId"] == heir.id


def test_wf_party_hand_over(app_url, mail, browser):
    leader, member = players(app_url, mail, 2)
    form_party(leader, [member])
    with ExitStack() as stack:
        stack.callback(release, [leader, member])
        page_l = as_player(stack, browser, app_url, leader)
        page_m = as_player(stack, browser, app_url, member)
        ui(sees(role(page_m, "region", "Party"), f"Waiting for {leader.handle} to start a match"), UI_WAIT_S, "waiting")
        role(page_l, "button", f"Make {member.handle} leader").click()
        for page in (page_l, page_m):
            ui(lambda page=page: [int(r["userId"]) for r in rows(role(page, "list", "Party members"))
                                  if r.get("leader") == "true"] == [member.id], UI_WAIT_S, "badge")
            ui(noticed(page), UI_WAIT_S, "copy")
        assert party_of(leader)["leaderId"] == member.id
def test_queue_cancel_state_machine(app_url, mail):
    leader, member = players(app_url, mail, 2)
    with ExitStack() as stack:
        stack.callback(release, [leader, member])
        form_party(leader, [member])
        expect_error(member.post("/api/party/queue"), 403, "not_leader")
        assert expect_error(leader.post("/api/party/queue/cancel"), 409, "invalid_transition")["state"] == "idle"
        assert expect_error(leader.post("/api/lobby/leave"), 409, "invalid_transition")["state"] == "idle"
        queued = leader.post("/api/party/queue")
        assert queued.status_code == 202 and queued.json()["party"]["state"] == "queued"
        assert expect_error(leader.post("/api/party/queue"), 409, "invalid_transition")["state"] in ("queued", "in_lobby")
        expect_error(member.post("/api/party/queue/cancel"), 403, "not_leader")
        cancel = leader.post("/api/party/queue/cancel")
        if cancel.status_code == 200:
            assert cancel.json()["party"]["state"] == "idle"
            holds(lambda: party_of(leader)["state"] == "idle", SEAT_WAIT_S + SEAT_SLACK_S,
                  "a cancelled party stays unseated")
        else:
            assert expect_error(cancel, 409, "invalid_transition")["state"] == "in_lobby"
            poll(lambda: seated(leader), API_WAIT_S, "the placement that beat the cancel")
            assert leader.post("/api/lobby/leave").status_code == 200
        party = queue_seated(leader)
        lobby = lobby_json(leader, party["lobbyId"])
        mine = [s for s in lobby["seats"] if s["userId"] in (leader.id, member.id)]
        assert len(mine) == 2 and {s["partyId"] for s in mine} == {party["id"]}
        assert expect_error(leader.post("/api/party/queue/cancel"), 409, "invalid_transition")["state"] == "in_lobby"
        expect_error(member.post("/api/lobby/leave"), 403, "not_leader")
        left = leader.post("/api/lobby/leave")
        assert left.status_code == 200 and left.json()["party"]["state"] == "idle"
        assert not {leader.id, member.id} & set(seat_ids(lobby_json(leader, party["lobbyId"])))
        assert expect_error(leader.post("/api/lobby/leave"), 409, "invalid_transition")["state"] == "idle"
        assert leader.post("/api/party/queue").status_code == 202
        assert member.post("/api/party/leave").status_code == 200
        assert party_of(leader)["state"] in ("idle", "in_lobby")
        assert party_of(member)["state"] == "idle"


def test_concurrent_seating_never_splits_or_overfills(app_url, mail):
    down = outage_url()
    with ExitStack() as stack:
        anchor = players(app_url, mail, 1)[0]
        stack.callback(release, [anchor])
        lobby_id = queue_seated(anchor)["lobbyId"]
        fill_lobby(stack, None, app_url, mail, anchor, lobby_id, upto=LOBBY_SIZE - 3)
        sizes = [2, 2, 2, 4, 3, 1]
        crews = [players(app_url, mail, size) for size in sizes]
        for crew in crews:
            stack.callback(release, crew)
            if len(crew) > 1:
                form_party(crew[0], crew[1:])
        bases = [app_url if i % 2 == 0 else down for i in range(len(crews))]
        out = fire_together([lambda c=c, b=b: c[0].post("/api/party/queue", base=b) for c, b in zip(crews, bases)])
        assert all(r.status_code == 202 for r in out), [r.text for r in out]
        def placed(crew: list[Player]) -> tuple[dict, dict, list[int]] | None:
            party = party_of(crew[0])
            if party["state"] == "in_lobby" and party["lobbyId"]:
                lobby = lobby_json(anchor, party["lobbyId"])
                return party, lobby, seat_ids(lobby)
            if party["state"] == "in_match" and party["matchId"]:
                match = match_json(anchor, party["matchId"])
                return party, lobby_json(anchor, match["lobbyId"]), [u["id"] for u in match["participants"]]
            return None

        seen: dict[int, tuple[dict, list[int]]] = {}
        for crew in crews:
            party, lobby, holders = poll(lambda c=crew: placed(c), SEAT_WAIT_S + SEAT_SLACK_S, "racing party placed")
            ids = {p.id for p in crew}
            assert ids <= set(holders), f"party {party['id']} split: {sorted(ids)} against {holders}"
            mine = [s for s in lobby["seats"] if s["userId"] in ids]
            assert not mine or (len(mine) == len(crew) and {s["partyId"] for s in mine} == {party["id"]}), mine
            seen[lobby["id"]] = (lobby, holders)
        anchor_lobby = lobby_json(anchor, lobby_id)
        seen.setdefault(lobby_id, (anchor_lobby, seat_ids(anchor_lobby)))
        for lobby, holders in seen.values():
            assert lobby["size"] == LOBBY_SIZE and len(holders) <= LOBBY_SIZE and len(lobby["seats"]) <= LOBBY_SIZE
            assert len(set(holders)) == len(holders)

        deadline = time.monotonic() + FILL_WAIT_S
        while True:
            base = players(app_url, mail, 1)[0]
            stack.callback(release, [base])
            older = queue_seated(base)["lobbyId"]
            roomy = lobby_json(base, older)
            if roomy["state"] == "filling" and len(roomy["seats"]) <= LOBBY_SIZE - 3:
                break
            assert time.monotonic() < deadline, "no filling lobby with three free seats appeared within the provisioning deadline"
        fill_lobby(stack, None, app_url, mail, base, older, upto=LOBBY_SIZE - 2)
        settled = lobby_json(base, older)
        assert settled["state"] == "filling" and len(settled["seats"]) == LOBBY_SIZE - 2, settled
        quad = players(app_url, mail, 4)
        stack.callback(release, quad)
        form_party(quad[0], quad[1:])
        newer = queue_seated(quad[0])["lobbyId"]
        assert newer != older, "a party of 4 was seated into a lobby with 2 free seats"
        solo = players(app_url, mail, 1)[0]
        stack.callback(release, [solo])
        assert queue_seated(solo)["lobbyId"] == older, "a party of one skipped the oldest lobby with a free seat (L507)"

        first, second = players(app_url, mail, 2)
        stack.callback(release, [first, second])
        assert first.post("/api/party/queue").status_code == 202
        assert second.post("/api/party/queue").status_code == 202
        spots = []
        for solo in (first, second):
            party = poll(lambda s=solo: (p := party_of(s))["state"] in ("in_lobby", "in_match") and p, SEAT_WAIT_S + SEAT_SLACK_S, "solo seated")
            lobby = lobby_json(anchor, party["lobbyId"])
            spots.append((lobby, next(s for s in lobby["seats"] if s["userId"] == solo.id)))
        (lobby_a, seat_a), (lobby_b, seat_b) = spots
        if lobby_a["id"] == lobby_b["id"]:
            assert instant(seat_a["seatedAt"]) <= instant(seat_b["seatedAt"]), f"seated out of queue order: {seat_a} then {seat_b}"
        else:
            assert len(lobby_json(anchor, lobby_a["id"])["seats"]) == LOBBY_SIZE, "the second solo skipped a filling lobby with a free seat"
            assert len({s["seat"] for s in lobby["seats"]}) == len(lobby["seats"])


def test_lobby_countdown_cancel_restart_and_start(app_url, mail):
    with ExitStack() as stack:
        anchor = players(app_url, mail, 1)[0]
        stack.callback(release, [anchor])
        lobby_id = queue_seated(anchor)["lobbyId"]
        fill_lobby(stack, None, app_url, mail, anchor, lobby_id, upto=LOBBY_SIZE - 1)
        lobby = lobby_json(anchor, lobby_id)
        assert lobby["state"] == "filling" and lobby["countdownEndsAt"] is None and lobby["matchId"] is None
        added = fill_lobby(stack, None, app_url, mail, anchor, lobby_id)

        def countdown() -> dict | None:
            body = anchor.get(f"/api/lobbies/{lobby_id}").json()["lobby"]
            return body if body["state"] == "countdown" and body["countdownEndsAt"] else None

        body = poll(countdown, API_WAIT_S, "countdown")
        assert len(body["seats"]) == LOBBY_SIZE
        first_end = body["countdownEndsAt"]
        leaver = added[-1][0]
        assert leaver.post("/api/lobby/leave").status_code == 200
        reopened = lobby_json(anchor, lobby_id)
        assert reopened["state"] == "filling" and reopened["countdownEndsAt"] is None
        assert leaver.id not in seat_ids(reopened) and len(reopened["seats"]) == LOBBY_SIZE - 1
        fill_lobby(stack, None, app_url, mail, anchor, lobby_id)
        body = poll(countdown, API_WAIT_S, "restarted countdown")
        restarted = time.monotonic()
        assert body["countdownEndsAt"] > first_end
        seated_ids = set(seat_ids(body))
        match_id = match_started(anchor)
        counted = time.monotonic() - restarted
        assert COUNTDOWN_S - 2 * TIMING_TOL_S <= counted <= COUNTDOWN_S + RESPONSE_SLACK_S, \
            f"the restarted countdown lasted about {counted:.1f} s on the verifier's clock (L514)"
        started = lobby_json(anchor, lobby_id)
        assert started["state"] == "running" and started["matchId"] == match_id
        match = match_json(anchor, match_id)
        assert match["state"] == "running" and match["lobbyId"] == lobby_id and match["name"] == f"Cup #{match_id}"
        assert {u["id"] for u in match["participants"]} == seated_ids


def test_wf_matchmaking_find_match_lobby(app_url, mail, browser):
    leader, member = players(app_url, mail, 2)
    form_party(leader, [member])
    with ExitStack() as stack:
        stack.callback(release, [leader, member])
        page_l = as_player(stack, browser, app_url, leader)
        page_m = as_player(stack, browser, app_url, member)
        find = role(page_l, "button", "Find a match")
        ui(visible(find), UI_WAIT_S, "find button")
        find.click()
        lobby_id = poll(lambda: seated(leader), SEAT_WAIT_S + SEAT_SLACK_S, "seated")["lobbyId"]
        for page in (page_l, page_m):
            ui(visible(role(page, "region", "Lobby")), UI_WAIT_S, "lobby view")
            ui(sees(role(page, "status", "Seats"), " of 12 seated"), UI_WAIT_S, "seat count")
            ui(lambda page=page: len(rows(role(page, "list", "Seats"))) == LOBBY_SIZE
               and {leader.id, member.id} <= set(row_ids(role(page, "list", "Seats"))), UI_WAIT_S, "seats")
        added = fill_lobby(stack, None, app_url, mail, leader, lobby_id)
        for page in (page_l, page_m):
            ui(sees(role(page, "timer", "Countdown"), "Starting in "), UI_WAIT_S, "countdown")
            expect(role(page, "region", "Lobby")).to_have_attribute("data-state", "countdown")
        assert added[-1][0].post("/api/lobby/leave").status_code == 200
        for page in (page_l, page_m):
            ui(noticed(page), UI_WAIT_S, "cancel copy")
            ui(gone(role(page, "timer", "Countdown")), UI_WAIT_S, "timer gone")
            expect(role(page, "region", "Lobby")).to_have_attribute("data-state", "filling")
    assert lobby_json(leader, lobby_id)["state"] == "filling"


def test_wf_matchmaking_leave_lobby(app_url, mail, browser):
    leader, member = players(app_url, mail, 2)
    form_party(leader, [member])
    with ExitStack() as stack:
        stack.callback(release, [leader, member])
        page_l = as_player(stack, browser, app_url, leader)
        page_m = as_player(stack, browser, app_url, member)
        lobby_id = queue_seated(leader)["lobbyId"]
        ui(visible(role(page_l, "button", "Leave lobby")), UI_WAIT_S, "leave lobby")
        role(page_l, "button", "Leave lobby").click()
        ui(noticed(page_l), UI_WAIT_S, "left copy")
        ui(visible(role(page_l, "button", "Find a match")), UI_WAIT_S, "party view")
        ui(visible(role(page_m, "region", "Party")), UI_WAIT_S, "member party view")
    assert party_of(leader)["state"] == "idle"
    assert not {leader.id, member.id} & set(seat_ids(lobby_json(leader, lobby_id)))


def sim_body(kind: str, seed: int, starters: list[int], inputs: list[dict], tick: int | None = None,
             forfeits: list[dict] | None = None) -> dict:
    body: dict = {"kind": kind, "seed": seed, "starters": starters, "inputs": inputs}
    if tick is not None:
        body["tick"] = tick
    if forfeits is not None:
        body["forfeits"] = forfeits
    return body


def sim_frame(base: str, kind: str, seed: int, starters: list[int], inputs: list[dict], tick: int) -> dict:
    return simulate(base, sim_body(kind, seed, starters, inputs, tick))["frame"]


def bean(frame: dict, user_id: int) -> dict:
    return next(b for b in frame["beans"] if b["userId"] == user_id)


def race_fall(base: str, seed: int) -> tuple[Callable[[int], dict], int]:
    one = [SIM_IDS[0]]
    veer = [{"tick": 0, "userId": SIM_IDS[0], "buttons": 8}]
    cache: dict[int, dict] = {}

    def state_at(t: int) -> dict:
        if t not in cache:
            cache[t] = bean(sim_frame(base, "race", seed, one, veer, t), SIM_IDS[0])
        return cache[t]

    first = next((t for t in range(1, SIDE_FALL_S * TICKS_PER_S + 1) if state_at(t)["state"] == "falling"), None)
    assert first is not None, f"seed {seed}: a lone bean holding right never falls within {SIDE_FALL_S} s"
    assert state_at(first - 1)["state"] == "alive"
    return state_at, first


def test_simulation_physics_rules(app_url):
    one = [SIM_IDS[0]]
    held_forward = [{"tick": 0, "userId": SIM_IDS[0], "buttons": 1}]
    spawn = sim_frame(app_url, "race", 11, list(reversed(SIM_IDS)), [], 0)
    for index, uid in enumerate(SIM_IDS):
        b = bean(spawn, uid)
        assert b["state"] == "alive" and b["handle"] is None
        assert abs(b["x"] - SPAWN_X[index % 4]) < 0.0005 and abs(b["z"] - SPAWN_Z[index // 4]) < 0.0005
    ring = sim_frame(app_url, "survival", 11, SIM_IDS[:4], [], 0)["beans"]
    cx = sum(b["x"] for b in ring) / 4
    cz = sum(b["z"] for b in ring) / 4
    ordered = sorted(ring, key=lambda b: b["userId"])
    for b in ordered:
        assert abs(((b["x"] - cx) ** 2 + (b["z"] - cz) ** 2) ** 0.5 - SPAWN_RING_M) < 0.002
    chords = [((p["x"] - q["x"]) ** 2 + (p["z"] - q["z"]) ** 2) ** 0.5 for p, q in zip(ordered, ordered[1:] + ordered[:1])]
    assert max(chords) - min(chords) < 0.003
    step = RUN_SPEED / TICKS_PER_S
    clear_ticks = int(CLEAR_RUN_M / step)
    for t in (1, 5, clear_ticks):
        b = bean(sim_frame(app_url, "race", 11, one, held_forward, t), SIM_IDS[0])
        assert abs(b["z"] - (SPAWN_Z[0] + step * t)) < 0.0011 and abs(b["x"] - SPAWN_X[0]) < 0.0005
    diagonal = bean(sim_frame(app_url, "race", 11, one, [{"tick": 0, "userId": SIM_IDS[0], "buttons": 5}], 5), SIM_IDS[0])
    leg = 5 * step / 2 ** 0.5
    assert abs(diagonal["z"] - SPAWN_Z[0] - leg) < 0.002 and abs(diagonal["x"] - SPAWN_X[0] - leg) < 0.002
    for buttons in (3, 12):
        still = bean(sim_frame(app_url, "race", 11, one, [{"tick": 0, "userId": SIM_IDS[0], "buttons": buttons}], 5), SIM_IDS[0])
        assert abs(still["z"] - SPAWN_Z[0]) < 0.0005 and abs(still["x"] - SPAWN_X[0]) < 0.0005
    jump = [{"tick": 0, "userId": SIM_IDS[0], "buttons": 17}, {"tick": 2, "userId": SIM_IDS[0], "buttons": 4}]
    heights = [bean(sim_frame(app_url, "race", 11, one, jump, t), SIM_IDS[0]) for t in range(0, 20)]
    floor = heights[0]["y"]
    peak = max(h["y"] for h in heights) - floor
    apex = JUMP_SPEED ** 2 / (2 * GRAVITY)
    assert abs(peak - apex) <= JUMP_SPEED / TICKS_PER_S, f"peak {peak}"
    landing = next(t for t in range(1, 20) if heights[t]["y"] <= floor + 0.0005)
    air = 2 * JUMP_SPEED / GRAVITY * TICKS_PER_S
    assert int(air) - 1 <= landing <= int(air) + 2, landing
    for t in range(2, landing):
        assert abs(heights[t]["x"] - SPAWN_X[0]) < 0.0005 and abs(heights[t]["z"] - heights[t - 1]["z"] - step) < 0.0011
    dive = [{"tick": 0, "userId": SIM_IDS[0], "buttons": 32}]
    d1 = bean(sim_frame(app_url, "race", 11, one, dive, 1), SIM_IDS[0])
    assert abs(d1["z"] - SPAWN_Z[0] - DIVE_SPEED / TICKS_PER_S) < 0.0011 and d1["y"] > floor
    d12 = bean(sim_frame(app_url, "race", 11, one, dive, DIVE_TICKS), SIM_IDS[0])
    assert d12["z"] - SPAWN_Z[0] > DIVE_TICKS * step
    side = bean(sim_frame(app_url, "race", 11, one, [{"tick": 0, "userId": SIM_IDS[0], "buttons": 36}], 1), SIM_IDS[0])
    assert abs(side["x"] - SPAWN_X[0] - DIVE_SPEED / TICKS_PER_S) < 0.0011 and abs(side["z"] - SPAWN_Z[0]) < 0.0005

    for kind, limit_s, (low, high) in (("race", RACE_FINISH_S, RACE_LENGTH_M), ("final", FINAL_FINISH_S, FINAL_LENGTH_M)):
        for seed in (1, 2, 3):
            result = simulate(app_url, sim_body(kind, seed, one, held_forward))
            [entry] = result["results"]
            assert entry["outcome"] == "qualified" and entry["finishTick"] < limit_s * TICKS_PER_S
            assert result["lastTick"] == entry["finishTick"]
            at = bean(sim_frame(app_url, kind, seed, one, held_forward, entry["finishTick"]), SIM_IDS[0])
            before = bean(sim_frame(app_url, kind, seed, one, held_forward, entry["finishTick"] - 1), SIM_IDS[0])
            assert at["z"] >= low and before["z"] < high and at["state"] == "qualified"

    four = SIM_IDS[:4]
    for seed in FALL_SEEDS:
        survival = simulate(app_url, sim_body("survival", seed, four, []))
        assert survival["lastTick"] <= KIND_LIMIT_S["survival"] * TICKS_PER_S
        limit_tick = KIND_LIMIT_S["survival"] * TICKS_PER_S
        for out in (r for r in survival["results"] if r["outcome"] == "eliminated"):
            at = bean(sim_frame(app_url, "survival", seed, four, [], out["eliminatedTick"]), out["userId"])
            assert at["state"] == "eliminated", (seed, out)
            if out["eliminatedTick"] >= limit_tick:
                continue
            before = bean(sim_frame(app_url, "survival", seed, four, [], out["eliminatedTick"] - 1), out["userId"])
            assert at["y"] < FALL_Y and before["state"] == "alive", (seed, out)

    for seed in FALL_SEEDS:
        state_at, first = race_fall(app_url, seed)
        assert state_at(first)["y"] < FALL_Y and state_at(first - 1)["y"] >= FALL_Y
        mid_fall, end_fall = state_at(first + FALLING_TICKS // 2), state_at(first + FALLING_TICKS - 1)
        assert mid_fall["state"] == end_fall["state"] == "falling"
        assert end_fall["y"] < mid_fall["y"] < state_at(first)["y"], "gravity stops while falling"
        respawn = [state_at(first + t) for t in (FALLING_TICKS, (FALLING_TICKS + ALIVE_AGAIN_TICKS) // 2,
                                                 ALIVE_AGAIN_TICKS - 1)]
        for frozen in respawn:
            assert frozen["state"] == "respawning" and abs(frozen["x"]) < 0.0005 and abs(frozen["y"]) < 0.0005
            assert abs(frozen["z"] - respawn[0]["z"]) < 0.0005
        assert state_at(first + ALIVE_AGAIN_TICKS)["state"] == "alive"


def test_simulation_deterministic_and_matches_stored_rounds(app_url):
    viewer = signup(app_url, verify=False)
    forward = [{"tick": 0, "userId": u, "buttons": 1} for u in SIM_IDS]
    last_tick = simulate(app_url, sim_body("race", 99, SIM_IDS, forward))["lastTick"]
    body = sim_body("race", 99, SIM_IDS, forward, min(300, last_tick))
    assert simulate(app_url, body) == simulate(app_url, body)
    match = match_json(viewer, 1)
    for rnd in match["rounds"]:
        assert rnd["seed"] == SEED_SEEDS[rnd["n"]] and rnd["state"] == "resolved"
        exported = inputs_json(viewer, 1, rnd["n"])
        keys = [(i["tick"], i["userId"]) for i in exported["inputs"]]
        assert keys == sorted(keys) and len(keys) == len(set(keys))
        sim = simulate(app_url, sim_body(exported["kind"], exported["seed"], exported["starters"], exported["inputs"],
                                         forfeits=exported["forfeits"]))
        assert sim["slots"] == rnd["slots"] and sim["lastTick"] == rnd["lastTick"]
        key = lambda r: r["userId"]
        assert sorted(sim["results"], key=key) == sorted(rnd["results"], key=key)
        for tick in (0, rnd["lastTick"] // 2, rnd["lastTick"]):
            stored = frame_json(viewer, 1, rnd["n"], tick)
            again = simulate(app_url, sim_body(exported["kind"], exported["seed"], exported["starters"],
                                               exported["inputs"], tick, exported["forfeits"]))["frame"]
            assert stored["beans"] == again["beans"] and stored["slotsLeft"] == again["slotsLeft"]
    race_inputs = inputs_json(viewer, 1, 1)["inputs"]
    assert {(i["userId"], i["buttons"]) for i in race_inputs if i["tick"] == 0} == {(u, 1) for u in range(1, 11)}
    assert not [i for i in race_inputs if i["userId"] in (11, 12)]
    assert inputs_json(viewer, 1, 2)["inputs"] == []
    bad = [
        {"seed": -1}, {"seed": MAX_SEED + 1}, {"starters": []}, {"starters": list(range(1, 14))},
        {"starters": [SIM_IDS[0], SIM_IDS[0]]},
        {"inputs": [{"tick": 0, "userId": UNKNOWN_ID, "buttons": 1}]},
        {"inputs": [{"tick": 0, "userId": SIM_IDS[0], "buttons": MAX_BUTTONS + 1}]},
        {"inputs": [{"tick": 0, "userId": SIM_IDS[0], "buttons": 1}] * 2},
        {"inputs": [{"tick": KIND_LIMIT_S["race"] * TICKS_PER_S + 1, "userId": SIM_IDS[0], "buttons": 1}]},
        {"forfeits": [{"tick": 0, "userId": SIM_IDS[0]}]},
        {"forfeits": [{"tick": 1, "userId": SIM_IDS[0]}, {"tick": 2, "userId": SIM_IDS[0]}]},
        {"tick": KIND_LIMIT_S["race"] * TICKS_PER_S + 1},
    ]
    for override in bad:
        candidate = sim_body("race", 5, SIM_IDS[:2], []) | override
        assert request(app_url, "POST", "/api/simulate", candidate, cookie=sim_session(app_url)).status_code == 422, override
    starters = list(range(1, 13))
    big = [{"tick": t, "userId": u, "buttons": 1} for t in range(MAX_INPUTS // 12) for u in starters]
    payload = sim_body("race", 5, starters, big, 0)
    assert BODY_LIMIT < len(json.dumps(payload, separators=(",", ":"))) < SIM_BODY_LIMIT
    assert request(app_url, "POST", "/api/simulate", payload, cookie=sim_session(app_url)).status_code == 200
    extra = big + [{"tick": MAX_INPUTS // 12, "userId": 1, "buttons": 1}]
    assert request(app_url, "POST", "/api/simulate", sim_body("race", 5, starters, extra, 0), cookie=sim_session(app_url)).status_code == 422


def test_qualification_and_ranking_rules(app_url):
    viewer = signup(app_url, verify=False)
    for kind in ("race", "survival", "final"):
        for count in (1, 2, 3, 5, 7, 12):
            starters = list(range(9100001, 9100001 + count))
            assert simulate(app_url, sim_body(kind, 3, starters, [], 0))["slots"] == slots_for(kind, count)
    for rnd in match_json(viewer, 1)["rounds"]:
        assert rnd["slots"] == slots_for(rnd["kind"], len(rnd["starters"]))
    trio = SIM_IDS[:3]
    forward = [{"tick": 0, "userId": u, "buttons": 1} for u in trio]
    spawn = simulate(app_url, sim_body("race", 3, SIM_IDS, [], 0))
    check_frame_rules(spawn["frame"], spawn["results"], "race", spawn["slots"])
    assert [b["userId"] for b in spawn["frame"]["beans"]] == SIM_IDS, "spawn-row z ties must rank by ascending id"
    for seed in range(1, TIE_SEEDS + 1):
        sim = simulate(app_url, sim_body("race", seed, trio, forward))
        check_results(sim, "race", trio)
        for t in (sim["lastTick"] // 2, sim["lastTick"]):
            check_frame_rules(sim_frame(app_url, "race", seed, trio, forward, t), sim["results"], "race", sim["slots"])
    four = SIM_IDS[:4]
    for seed in (1, 2, 3, 4):
        sim = simulate(app_url, sim_body("survival", seed, four, []))
        check_results(sim, "survival", four)
        last_tick = sim["lastTick"]
        at = sim_frame(app_url, "survival", seed, four, [], last_tick)
        check_frame_rules(at, sim["results"], "survival", sim["slots"])
        if last_tick < KIND_LIMIT_S["survival"] * TICKS_PER_S and last_tick > 0:
            before = sim_frame(app_url, "survival", seed, four, [], last_tick - 1)
            alive_before = [b["userId"] for b in before["beans"] if b["state"] == "alive"]
            fallers = sorted(u for u in alive_before if bean(at, u)["y"] < FALL_Y)
            keep = len(alive_before) - len(fallers)
            spare = max(sim["slots"] - keep, 0)
            survivors = sorted(set(alive_before) - set(fallers)) + fallers[:spare]
            assert sorted(r["userId"] for r in sim["results"] if r["outcome"] == "qualified") == sorted(survivors)
        for t in (0, last_tick // 2):
            check_frame_rules(sim_frame(app_url, "survival", seed, four, [], t), sim["results"], "survival", sim["slots"])
    final = simulate(app_url, sim_body("final", 8, trio, forward))
    check_results(final, "final", trio)
    assert sum(r["outcome"] == "qualified" for r in final["results"]) <= 1
    rows_at = [0, final["lastTick"] // 2, final["lastTick"]]
    for t in rows_at:
        check_frame_rules(sim_frame(app_url, "final", 8, trio, forward, t), final["results"], "final", 1)
    forfeit = simulate(app_url, sim_body("race", 8, trio, forward, forfeits=[{"tick": 30, "userId": trio[0]}]))
    gone_bean = next(r for r in forfeit["results"] if r["userId"] == trio[0])
    assert gone_bean["outcome"] == "eliminated" and gone_bean["eliminatedTick"] == 30
    f30 = bean(simulate(app_url, sim_body("race", 8, trio, forward, 30, [{"tick": 30, "userId": trio[0]}]))["frame"], trio[0])
    f29 = bean(simulate(app_url, sim_body("race", 8, trio, forward, 29, [{"tick": 30, "userId": trio[0]}]))["frame"], trio[0])
    assert f30["state"] == "eliminated" and f29["state"] == "alive" and same_position(f30, f29)


def test_wf_simulation_photo_finish_matches_resim(app_url, browser):
    viewer = signup(app_url, verify=False)
    rnd = match_json(viewer, 1)["rounds"][-1]
    exported = inputs_json(viewer, 1, rnd["n"])
    expected = simulate(app_url, sim_body(exported["kind"], exported["seed"], exported["starters"], exported["inputs"],
                                          rnd["lastTick"], exported["forfeits"]))["frame"]
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, viewer, f"/matches/1/rounds/{rnd['n']}")
        slider = role(page, "slider", "Playhead")
        ui(visible(slider), UI_WAIT_S, "playhead")
        slider.press("End")
        ui(lambda: lanes_match(page, expected | {"tick": rnd["lastTick"]}) or True, UI_WAIT_S, "lanes at last tick")


def test_wf_simulation_survival_deep_link(app_url, browser):
    viewer = signup(app_url, verify=False)
    rounds = match_json(viewer, 1)["rounds"]
    rnd = next((r for r in rounds if r["kind"] == "survival"), None)
    if rnd is None:
        assert len([r for r in rounds[0]["results"] if r["outcome"] == "qualified"]) <= 1, "a race with qualifiers but no survival round"
        rnd = rounds[0]
    tick = rnd["lastTick"] // 2
    exported = inputs_json(viewer, 1, rnd["n"])
    expected = simulate(app_url, sim_body(rnd["kind"], exported["seed"], exported["starters"], exported["inputs"],
                                          tick, exported["forfeits"]))["frame"]
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, viewer, f"/matches/1/rounds/{rnd['n']}?tick={tick}")
        ui(lambda: lanes_match(page, expected) or True, UI_WAIT_S, "lanes")
        ui(sees(slots_attr(page), SLOT_LABEL[rnd["kind"]]), UI_WAIT_S, "slots label")
        ui(sees(role(page, "status", "Frame"), f"Tick {tick} of {rnd['lastTick']}, {expected['slotsLeft']} {SLOT_LABEL[rnd['kind']].lower()}"),
           UI_WAIT_S, "frame status")


def lanes_match(page: Page, frame: dict) -> None:
    got = rows(role(page, "list", "Lanes"))
    expected = frame["beans"]
    assert [int(r["userId"]) for r in got] == [b["userId"] for b in expected], "lane order"
    for row, b in zip(got, expected):
        assert int(row["tick"]) == frame["tick"]
        for axis in "xyz":
            assert POSITION.match(row[axis]), row[axis]
            assert abs(float(row[axis]) - b[axis]) < 0.0005, (axis, row, b)
        assert int(row["rank"]) == b["rank"] and row["state"] == b["state"] and int(row["hue"]) == b["hue"]
        assert (row.get("marker") or None) == b["marker"]
        if b["marker"] == "last_slot":
            assert "Last slot" in row["text"]
        if b["marker"] == "first_out":
            assert "First out" in row["text"]
def test_live_match_rounds_inputs_and_replay(app_url, mail, browser):
    with ExitStack() as stack:
        crew = players(app_url, mail, 4)
        stack.callback(release, crew)
        leader, runner, switcher, quitter = crew
        form_party(leader, crew[1:])
        plan = {1: 1, 3: 1}
        recorder = open_wire(stack, browser, app_url, leader, plan, record=True)
        wires = {p.id: open_wire(stack, browser, app_url, p, plan) for p in crew[1:]}
        lobby_id = queue_seated(leader)["lobbyId"]
        fillers = fill_lobby(stack, browser, app_url, mail, leader, lobby_id, plan=plan)
        seats = set(seat_ids(lobby_json(leader, lobby_id)))
        match_id = match_started(leader)
        poll(lambda: presence_of(runner, leader.id) == "in_match", PRESENCE_LAG_S + RESPONSE_SLACK_S, "in_match")
        assert match_id not in [m["id"] for m in runner.get(f"/api/users/{leader.handle}").json()["matches"]]
        wait_round(leader, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        expect_error(frames(leader, match_id, 1, 0), 409, "round_not_resolved")
        expect_error(leader.get(f"/api/matches/{match_id}/rounds/1/inputs"), 409, "round_not_resolved")

        quit_wire = wires[quitter.id]
        latest = quit_wire.wait_tick(match_id, 1, 6 * INPUT_WINDOW)
        probes = [(latest, MAX_BUTTONS + 1, "invalid"), (latest + 5 * INPUT_WINDOW, 1, "early"),
                  (latest - 5 * INPUT_WINDOW, 1, "late")]
        for stamp, buttons, reason in probes:
            quit_wire.send({"type": "input", "matchId": match_id, "round": 1, "tick": stamp, "buttons": buttons})
            quit_wire.wait("([t, r]) => window.__log.some(m => m.type === 'input_rejected' && m.tick === t && m.reason === r)",
                           [stamp, reason])
        stamps: list[int] = []

        def probe(offset: int, buttons: int, attempt: int) -> dict:
            pid = f"{offset}:{attempt}"
            quit_wire.page.evaluate("p => window.__probes.push(p)", {"id": pid, "matchId": match_id, "round": 1,
                                                                    "offset": offset, "buttons": buttons})
            quit_wire.wait("i => window.__probeLog.some(e => e.id === i)", pid)
            sent = quit_wire.page.evaluate("i => window.__probeLog.find(e => e.id === i)", pid)
            stamps.append(sent["stamp"])
            quit_wire.wait_tick(match_id, 1, sent["base"] + PROBE_SETTLE_TICKS)
            sent["rejected"] = next((m["reason"] for m in quit_wire.log("input_rejected") if m.get("tick") == sent["stamp"]), None)
            return sent

        edge = probe(INPUT_WINDOW, EDGE_BUTTONS, 0)
        assert edge["rejected"] in (None, "late"), f"an input stamped k+10 was rejected {edge['rejected']}: {edge}"
        too_late = probe(-INPUT_WINDOW - 1, LATE_BUTTONS, 0)
        quit_wire.wait("t => window.__log.some(m => m.type === 'input_rejected' && m.tick === t && m.reason === 'late')",
                       too_late["stamp"])
        quit_wire.wait_tick(match_id, 1, max(stamps) + 1)
        switch_wire = wires[switcher.id]
        stamp = switch_wire.latest(match_id, 1) - INPUT_WINDOW // 2
        switch_wire.page.evaluate("""([mid, t]) => {
            window.__ws.send(JSON.stringify({type: 'input', matchId: mid, round: 1, tick: t, buttons: 1}));
            window.__ws.send(JSON.stringify({type: 'input', matchId: mid, round: 1, tick: t, buttons: 17}));
        }""", [match_id, stamp])
        forfeited = quitter.post(f"/api/matches/{match_id}/forfeit")
        assert forfeited.status_code == 200 and forfeited.json() == {"result": {"outcome": "eliminated"}}
        expect_error(quitter.post(f"/api/matches/{match_id}/forfeit"), 409, "invalid_transition")
        after = quit_wire.latest(match_id, 1)
        quit_wire.send({"type": "input", "matchId": match_id, "round": 1, "tick": after, "buttons": 1})
        quit_wire.wait("t => window.__log.some(m => m.type === 'input_rejected' && m.tick === t && m.reason === 'not_playing')", after)

        final = wait_finished(leader, match_id)
        rounds = final["rounds"]
        assert [r["n"] for r in rounds] == list(range(1, len(rounds) + 1)) and rounds[0]["kind"] == "race"
        assert set(rounds[0]["starters"]) == seats and {u["id"] for u in final["participants"]} == seats
        seen = {}
        for message in recorder.log("round"):
            if message["matchId"] == match_id:
                seen.setdefault(message["round"]["n"], []).append(message["round"]["state"])
        for rnd in rounds:
            kind, name, _, _ = ROUNDS[rnd["n"]]
            assert rnd["kind"] == kind and rnd["name"] == name and rnd["state"] == "resolved"
            assert rnd["slots"] == slots_for(kind, len(rnd["starters"])) and isinstance(rnd["lastTick"], int)
            states = [s for i, s in enumerate(seen.get(rnd["n"], [])) if i == 0 or s != seen[rnd["n"]][i - 1]]
            assert [s for s in states if s in ("pending", "running", "resolved")] == ["pending", "running", "resolved"], states
            check_results({"results": rnd["results"], "lastTick": rnd["lastTick"], "slots": rnd["slots"]}, kind, rnd["starters"])
        for previous, following in zip(rounds, rounds[1:]):
            assert set(following["starters"]) == {r["userId"] for r in previous["results"] if r["outcome"] == "qualified"}
        winners = [r["userId"] for r in rounds[-1]["results"] if r["outcome"] == "qualified"]
        if rounds[-1]["kind"] == "final" or len(winners) <= 1:
            assert final["winnerId"] == (winners[0] if winners else None)
        else:
            raise AssertionError(f"match stopped after round {rounds[-1]['n']} with {len(winners)} qualifiers")
        assert final["name"] == f"Cup #{match_id}" and TS.match(final["finishedAt"])
        assert lobby_json(leader, lobby_id)["state"] == "finished"
        for member in crew:
            party = party_of(member)
            assert party["state"] == "idle" and member_ids(party) == {p.id for p in crew}
        for filler, _ in fillers:
            assert party_of(filler)["state"] == "idle"

        for rnd in rounds:
            exported = inputs_json(leader, match_id, rnd["n"])
            keys = [(i["tick"], i["userId"]) for i in exported["inputs"]]
            assert keys == sorted(keys) and len(keys) == len(set(keys))
            assert all(i["userId"] in rnd["starters"] and 0 <= i["buttons"] <= MAX_BUTTONS for i in exported["inputs"])
            sim = simulate(app_url, sim_body(rnd["kind"], rnd["seed"], rnd["starters"], exported["inputs"],
                                             forfeits=exported["forfeits"]))
            assert sim["lastTick"] == rnd["lastTick"] and sim["slots"] == rnd["slots"]
            assert sorted(sim["results"], key=lambda r: r["userId"]) == sorted(rnd["results"], key=lambda r: r["userId"])
        race = inputs_json(leader, match_id, 1)
        mine = lambda uid: [i for i in race["inputs"] if i["userId"] == uid]
        assert any(i["buttons"] == 1 for i in mine(runner.id)) and any(i["buttons"] == 1 for i in mine(leader.id))
        late = [i for i in mine(switcher.id) if i["tick"] >= stamp]
        assert late and late[-1]["buttons"] == 17, late
        assert all(i["tick"] < late[-1]["tick"] for i in late if i["buttons"] == 1), "an input replaced at the same effective tick survived"
        [quit_event] = [f for f in race["forfeits"] if f["userId"] == quitter.id]
        assert all(i["buttons"] != MAX_BUTTONS + 1 and i["tick"] < quit_event["tick"] for i in mine(quitter.id))
        stored = [i["tick"] for i in mine(quitter.id) if i["buttons"] == EDGE_BUTTONS]
        edge_verdict = next((m["reason"] for m in quit_wire.log("input_rejected") if m.get("tick") == edge["stamp"]), None)
        assert edge_verdict in (None, "late"), f"an input stamped k+10 was rejected {edge_verdict}"
        if edge_verdict is None:
            assert len(stored) == 1 and edge["stamp"] <= stored[0] <= edge["stamp"] + INPUT_WINDOW, \
                f"the accepted k+10 input must be stored once at max(T, L) within [T, T+10] (L589): {stored}"
        else:
            assert stored == [], f"a rejected input was stored: {stored}"
        at = bean(frame_json(leader, match_id, 1, quit_event["tick"]), quitter.id)
        before = bean(frame_json(leader, match_id, 1, quit_event["tick"] - 1), quitter.id)
        assert at["state"] == "eliminated" and before["state"] in IN_PLAY and same_position(at, before)
        broadcast = {m["tick"]: m["beans"] for m in recorder.log("tick") if m["matchId"] == match_id and m["round"] == 1}
        sample = sorted({t for t in broadcast if t % SAMPLE_EVERY == 0} | {rounds[0]["lastTick"]} & set(broadcast))
        assert sample, "no live ticks were recorded"
        for tick in sample:
            replay = {b["userId"]: b for b in frame_json(leader, match_id, 1, tick)["beans"]}
            for live in broadcast[tick]:
                assert same_position(live, replay[live["userId"]]) and live["state"] == replay[live["userId"]]["state"], tick

        arrivals = {}
        for message in recorder.log("round"):
            if message["matchId"] == match_id and message["round"]["n"] == 1:
                arrivals.setdefault(message["round"]["state"], message["__at"])
        pending_s = (arrivals["running"] - arrivals["pending"]) / 1000
        assert abs(pending_s - PENDING_S) <= TIMING_TOL_S, f"round 1 was pending {pending_s:.2f} s (L531)"
        ticked = sorted((m["tick"], m["__at"]) for m in recorder.log("tick") if m["matchId"] == match_id and m["round"] == 1)
        (t0, a0), (t1, a1) = ticked[0], ticked[-1]
        assert (a1 - a0) / 1000 >= RATE_SPAN_S, f"too few live ticks to time: {t1 - t0}"
        rate = (t1 - t0) / ((a1 - a0) / 1000)
        assert abs(rate - TICKS_PER_S) <= TICKS_PER_S * TICK_RATE_TOL, f"live ticks arrive at {rate:.1f} per second (L539)"

        other = start_copy(stack, 0)
        fresh = leader.get(f"/api/matches/{match_id}", base=other)
        assert fresh.status_code == 200 and fresh.json()["match"]["rounds"] == rounds, "a fresh server process reads a different match record"
        for rnd in rounds:
            path = f"/api/matches/{match_id}/rounds/{rnd['n']}"
            assert leader.get(f"{path}/inputs", base=other).json() == inputs_json(leader, match_id, rnd["n"])
            for tick in (0, rnd["lastTick"] // 2, rnd["lastTick"]):
                assert leader.get(f"{path}/frames?tick={tick}", base=other).json() == frame_json(leader, match_id, rnd["n"], tick)


def standings_rows(page: Page) -> list[dict]:
    return rows(role(page, "list", "Live standings"))


def wait_buttons(page: Page, value: int) -> None:
    expect(role(page, "region", "Match")).to_have_attribute("data-buttons", str(value), timeout=UI_WAIT_S * 1000)


def pass_ticks(page: Page, count: int = 2) -> None:
    region = role(page, "region", "Match")
    start = int(region.get_attribute("data-tick") or 0)
    ui(lambda: int(region.get_attribute("data-tick", timeout=EXPECT_MS) or 0) >= start + count, UI_WAIT_S, "ticks")


def follow_to(page: Page, uid: int) -> None:
    region = role(page, "region", "Match")
    for _ in range(LOBBY_SIZE + 1):
        current = region.get_attribute("data-following-user-id", timeout=EXPECT_MS)
        if current == str(uid):
            return
        role(page, "button", "Next player").click()
        ui(lambda current=current: region.get_attribute("data-following-user-id", timeout=EXPECT_MS) != current,
           UI_WAIT_S, "next player")
    raise AssertionError(f"Next player never reached {uid}")


def test_play_controls_and_spectating(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    form_party(a, [b])
    with ExitStack() as stack:
        stack.callback(release, [a, b])
        page_a = as_player(stack, browser, app_url, a)
        page_b = as_player(stack, browser, app_url, b, viewport=TABLET)
        lobby_id = queue_seated(a)["lobbyId"]
        fill_lobby(stack, browser, app_url, mail, a, lobby_id, plan={})
        match_id = match_started(a)
        wait_round(a, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        for page in (page_a, page_b):
            ui(lambda page=page: int(role(page, "region", "Match").get_attribute("data-tick", timeout=EXPECT_MS) or 0) > 0,
               UI_WAIT_S, "match ticks")
        role(page_a, "img", "3D course view").click()
        steps = [("down", "KeyW", 1), ("down", "KeyA", 5), ("up", "KeyW", 4), ("up", "KeyA", 0), ("down", "ArrowUp", 1),
                 ("down", "ArrowRight", 9), ("up", "ArrowUp", 8), ("up", "ArrowRight", 0), ("down", "KeyS", 2),
                 ("up", "KeyS", 0), ("down", "KeyD", 8), ("up", "KeyD", 0), ("down", "ArrowDown", 2), ("up", "ArrowDown", 0),
                 ("down", "ArrowLeft", 4), ("up", "ArrowLeft", 0), ("down", "Space", 16), ("up", "Space", 0),
                 ("down", "Shift", 32), ("up", "Shift", 0)]
        for action, key, value in steps:
            getattr(page_a.keyboard, action)(key)
            wait_buttons(page_a, value)
            pass_ticks(page_a)

        touch = role(page_b, "group", "Touch controls")
        ui(visible(touch), UI_WAIT_S, "touch controls")
        stick = role(touch, "group", "Move stick")
        guarded = [slots_box(page_b), role(page_b, "timer", "Round clock").bounding_box()]
        for control in (stick, role(touch, "button", "Jump"), role(touch, "button", "Dive")):
            assert not any(boxes_overlap(control.bounding_box(), g) for g in guarded), "touch control covers the HUD"
        cdp = session(page_b)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})

        def touch_at(kind: str, x: float, y: float, ident: int = 1) -> None:
            points = [] if kind == "touchEnd" else [{"x": x, "y": y, "id": ident}]
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

        box = stick.bounding_box()
        cx, cy, radius = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, min(box["width"], box["height"]) / 2
        region_b = role(page_b, "region", "Match")
        read = lambda: int(region_b.get_attribute("data-buttons") or 0)
        touch_at("touchStart", cx, cy)
        wait_buttons(page_b, 0)
        directions = {}
        for name, (dx, dy) in {"up": (0, -0.7), "right": (0.7, 0), "down": (0, 0.7), "left": (-0.7, 0),
                               "up_left": (-0.5, -0.5)}.items():
            touch_at("touchMove", cx + dx * radius, cy + dy * radius)
            ui(lambda: read() != directions.get("last", -1), UI_WAIT_S, f"stick {name}")
            directions[name] = directions["last"] = read()
            pass_ticks(page_b)
        assert {directions[k] for k in ("up", "right", "down", "left")} == {1, 2, 4, 8}
        assert directions["up"] | directions["down"] == 3 and directions["left"] | directions["right"] == 12
        assert directions["up_left"] == directions["up"] | directions["left"]
        touch_at("touchMove", cx + 0.1 * radius, cy)
        wait_buttons(page_b, 0)
        touch_at("touchEnd", 0, 0)
        for name, value in (("Jump", 16), ("Dive", 32)):
            jb = role(touch, "button", name).bounding_box()
            touch_at("touchStart", jb["x"] + jb["width"] / 2, jb["y"] + jb["height"] / 2, 2)
            wait_buttons(page_b, value)
            pass_ticks(page_b)
            touch_at("touchEnd", 0, 0, 2)
            wait_buttons(page_b, 0)

        wait_round(a, match_id, 1, {"resolved"}, ROUND_WAIT_S)
        race = inputs_json(a, match_id, 1)
        stored = lambda uid: {i["buttons"] for i in race["inputs"] if i["userId"] == uid}
        assert {1, 5, 4, 9, 8, 2, 16, 32} <= stored(a.id), stored(a.id)
        assert {directions["up"], directions["right"], directions["up_left"], 16, 32} <= stored(b.id), stored(b.id)


def test_spectating_follows_party_friend(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    form_party(a, [b])
    with ExitStack() as stack:
        stack.callback(release, [a, b])
        page_a = as_player(stack, browser, app_url, a)
        page_b = as_player(stack, browser, app_url, b)
        lobby_id = queue_seated(a)["lobbyId"]
        fill_lobby(stack, browser, app_url, mail, a, lobby_id, plan={})
        match_id = match_started(a)
        wait_round(a, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        following = lambda page: role(page, "region", "Match").get_attribute("data-following-user-id", timeout=EXPECT_MS)
        for page, me in ((page_a, a), (page_b, b)):
            ui(lambda page=page: int(role(page, "region", "Match").get_attribute("data-tick", timeout=EXPECT_MS) or 0) > 0,
               UI_WAIT_S, "match ticks")
            ui(lambda page=page, me=me: following(page) == str(me.id), UI_WAIT_S, "own bean followed")
        role(page_b, "button", "Forfeit").click()
        ui(sees(role(page_b, "status", "Spectating"), f"Spectating {a.handle}"), UI_WAIT_S, "spectating a")
        assert following(page_b) == str(a.id)
        in_play = lambda page: [r["userId"] for r in sorted(standings_rows(page), key=lambda r: int(r["rank"]))
                                if r["state"] in IN_PLAY]
        order = in_play(page_b)
        role(page_b, "button", "Next player").click()
        ui(lambda: following(page_b) == order[(order.index(str(a.id)) + 1) % len(order)], UI_WAIT_S, "next player")
        role(page_b, "button", "Previous player").click()
        ui(lambda: following(page_b) == str(a.id), UI_WAIT_S, "previous player")
        other = int(next(u for u in in_play(page_b) if u != str(a.id)))
        follow_to(page_b, other)
        follow_to(page_b, a.id)
        role(page_a, "button", "Forfeit").click()
        for page in (page_a, page_b):
            ui(lambda page=page: following(page) == in_play(page)[0], UI_WAIT_S, "rank-1 bean followed")
        wait_round(a, match_id, 1, {"resolved"}, ROUND_WAIT_S)
        for page in (page_a, page_b):
            ui(lambda page=page: role(page, "region", "Match").count() == 0 or (following(page) or "") == "",
               UI_WAIT_S, "overview")
            ui(gone(role(page, "status", "Spectating")), UI_WAIT_S, "no spectating status")
    assert {f["userId"] for f in inputs_json(a, match_id, 1)["forfeits"]} >= {a.id, b.id}


def test_match_round_flow_returns_parties(app_url, mail):
    with ExitStack() as stack:
        crew = players(app_url, mail, 3)
        stack.callback(release, crew)
        leader = crew[0]
        form_party(leader, crew[1:])
        lobby_id = queue_seated(leader)["lobbyId"]
        fillers = [f for f, _ in fill_lobby(stack, None, app_url, mail, leader, lobby_id)]
        match_id = match_started(leader)
        opening = next(r for r in match_json(leader, match_id)["rounds"] if r["n"] == 1)
        assert opening["kind"] == "race" and opening["name"] == ROUNDS[1][1]
        assert opening["state"] in ("pending", "running") and isinstance(opening["seed"], int)
        assert 0 <= opening["seed"] <= MAX_SEED
        if opening["state"] == "pending":
            assert opening["lastTick"] is None and opening["results"] == []
        assert opening["slots"] == slots_for("race", LOBBY_SIZE)
        running = wait_round(leader, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        assert running["seed"] == opening["seed"] and running["lastTick"] is None
        for player in crew + fillers:
            assert player.post(f"/api/matches/{match_id}/forfeit").status_code == 200
        final = wait_finished(leader, match_id)
        assert final["winnerId"] is None and final["name"] == f"Cup #{match_id}"
        first = next(r for r in final["rounds"] if r["n"] == 1)
        assert first["state"] == "resolved" and isinstance(first["lastTick"], int)
        assert len(first["results"]) == LOBBY_SIZE and all(r["outcome"] == "eliminated" for r in first["results"])
        assert all(r["state"] == "resolved" for r in final["rounds"])
        assert lobby_json(leader, lobby_id)["state"] == "finished"
        for member in crew:
            party = party_of(member)
            assert party["state"] == "idle" and member_ids(party) == {p.id for p in crew}
            assert party["leaderId"] == leader.id
        for filler in fillers:
            assert party_of(filler)["state"] == "idle"


def test_wf_live_match_full_cup(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    form_party(a, [b])
    with ExitStack() as stack:
        stack.callback(release, [a, b])
        page_a = as_player(stack, browser, app_url, a)
        page_b = as_player(stack, browser, app_url, b)
        lobby_id = queue_seated(a)["lobbyId"]
        fillers = fill_lobby(stack, None, app_url, mail, a, lobby_id)
        match_id = match_started(a)
        wait_round(a, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        for filler, _ in fillers:
            assert filler.post(f"/api/matches/{match_id}/forfeit").status_code == 200
        for page in (page_a, page_b):
            ui(visible(role(page, "img", "3D course view")), UI_WAIT_S, "course")
            ui(lambda page=page: len(standings_rows(page)) == LOBBY_SIZE, UI_WAIT_S, "standings")
            ui(sees(role(page, "status", "Round"), "Wobble Dash · Race"), UI_WAIT_S, "round name")
        role(page_a, "img", "3D course view").click()
        page_a.keyboard.down("KeyW")
        ui(visible(role(page_b, "button", "Forfeit")), UI_WAIT_S, "forfeit button")
        role(page_b, "button", "Forfeit").click()
        outcomes = ("Qualified!", "Eliminated", "You won Pratfall Cup!")
        banners: dict[int, set[str]] = {a.id: set(), b.id: set()}
        watching: set[str] = set()

        def observe_cup() -> bool:
            for player, page in ((a, page_a), (b, page_b)):
                alert = role(page, "alert", "Round result")
                if alert.count():
                    shown = alert.first.inner_text(timeout=EXPECT_MS)
                    banners[player.id].update(o for o in outcomes if o in shown)
            spectating = role(page_b, "status", "Spectating")
            if spectating.count():
                watching.add(spectating.first.inner_text(timeout=EXPECT_MS))
            return match_json(a, match_id)["state"] == "finished"

        ui(observe_cup, MATCH_WAIT_S, "cup finished")
        page_a.keyboard.up("KeyW")
        final = match_json(a, match_id)
        assert "Eliminated" in banners[b.id], banners
        assert banners[a.id], f"no round-result banner for the player still in play: {banners}"
        assert any(f"Spectating {a.handle}" in w for w in watching), watching
        for page in (page_a, page_b):
            results = role(page, "region", "Results")
            ui(visible(results), UI_WAIT_S, "results view")
            expect(role(results, "heading", f"Cup #{match_id} results")).to_be_visible()
            expect(role(results, "list", "Final standings")).to_be_visible()
            for rnd in final["rounds"]:
                expect(role(results, "link", f"Photo-finish: {rnd['name']}")).to_be_visible()
            role(results, "button", "Back to party").click()
            ui(lambda page=page: set(row_ids(role(page, "list", "Party members"))) == {a.id, b.id}, UI_WAIT_S, "party view")
        party = party_of(a)
        assert party["state"] == "idle" and member_ids(party) == {a.id, b.id}


def test_wf_live_match_everyone_forfeits(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    form_party(a, [b])
    with ExitStack() as stack:
        stack.callback(release, [a, b])
        page = as_player(stack, browser, app_url, a)
        lobby_id = queue_seated(a)["lobbyId"]
        fillers = fill_lobby(stack, None, app_url, mail, a, lobby_id)
        match_id = match_started(a)
        wait_round(a, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        ui(visible(role(page, "button", "Forfeit")), UI_WAIT_S, "forfeit button")
        role(page, "button", "Forfeit").click()
        ui(noticed(page), UI_WAIT_S, "forfeit copy")
        for player in [b] + [f for f, _ in fillers]:
            player.post(f"/api/matches/{match_id}/forfeit")
        final = wait_finished(a, match_id)
        ui(noticed(page), UI_WAIT_S, "match over copy")
        ui(visible(role(page, "region", "Results")), UI_WAIT_S, "results")
        assert final["winnerId"] is None
        party = party_of(a)
        assert party["state"] == "idle" and member_ids(party) == {a.id, b.id}


def test_party_chat_and_direct_messages(app_url, mail, browser):
    a, b, c, d, e, f = players(app_url, mail, 6)
    with ExitStack() as stack:
        stack.callback(release, [a, b, c, d, e, f])
        party = form_party(a, [b])
        befriend(a, c)
        wire = open_wire(stack, browser, app_url, b)
        token = "chat" + secrets.token_hex(6)
        sent = a.post("/api/party/messages", {"body": f"  {token}  "})
        assert sent.status_code == 201, sent.text
        message = sent.json()["message"]
        assert message["body"] == token and message["channel"] == "party" and message["partyId"] == party["id"]
        assert message["fromUserId"] == a.id and TS.match(message["sentAt"])
        wire.wait("id => window.__log.some(m => m.type === 'chat' && m.message.id === id)", message["id"],
                  CHAT_LAG_S + RESPONSE_SLACK_S)
        history = b.get("/api/party/messages").json()["messages"]
        assert history[-1]["id"] == message["id"] and [m["sentAt"] for m in history] == sorted(m["sentAt"] for m in history)
        for body in ("   ", "x" * (BODY_MAX + 1)):
            error = expect_error(a.post("/api/party/messages", {"body": body}), 422, "validation_failed")
            assert error["fields"]["body"] == "Messages are 1 to 500 characters."
        assert a.post("/api/party/messages", {"body": "x" * BODY_MAX}).status_code == 201
        dm_token = "dm" + secrets.token_hex(6)
        dm = a.post(f"/api/dms/{c.id}/messages", {"body": dm_token})
        assert dm.status_code == 201 and dm.json()["message"]["channel"] == "dm" and dm.json()["message"]["toUserId"] == c.id
        assert dm_token in [m["body"] for m in c.get(f"/api/dms/{a.id}/messages").json()["messages"]]
        expect_error(a.post(f"/api/dms/{d.id}/messages", {"body": "hi"}), 403, "not_friends")
        expect_error(a.post(f"/api/dms/{OVERSIZE_ID}/messages", {"body": "hi"}), 403, "not_friends")
        assert stored_anywhere(token) > 0 and stored_anywhere(dm_token) > 0
        assert b.post("/api/party/leave").status_code == 200
        assert message["id"] not in [m["id"] for m in b.get("/api/party/messages").json()["messages"]]

        befriend(e, f)
        burst = [e.post("/api/party/messages", {"body": f"r{i}"}) for i in range(3)]
        burst += [e.post(f"/api/dms/{f.id}/messages", {"body": f"d{i}"}) for i in range(2)]
        limited = e.post(f"/api/dms/{f.id}/messages", {"body": "one too many"})
        assert [r.status_code for r in burst] == [201] * RATE_COUNT
        accepted = [r.json()["message"]["sentAt"] for r in burst]
        if limited.status_code == 201:
            accepted.append(limited.json()["message"]["sentAt"])
        else:
            expect_error(limited, 429, "rate_limited")
            assert limited.headers.get("retry-after", "").isdigit()
        within_cap(accepted)

        group = players(app_url, mail, 4)
        stack.callback(release, group)
        form_party(group[0], group[1:])
        ids = []
        for i in range(HISTORY + 2):
            sender = group[i % 4]
            ids.append(poll(lambda s=sender, i=i: (r := s.post("/api/party/messages", {"body": f"h{i}"})).status_code == 201
                            and r.json()["message"]["id"], API_WAIT_S, "message accepted"))
        kept = group[0].get("/api/party/messages").json()["messages"]
        assert [m["id"] for m in kept] == ids[-HISTORY:]


def within_cap(stamps: list[str]) -> None:
    ordered = sorted(instant(s) for s in stamps)
    for i in range(len(ordered) - RATE_COUNT):
        gap = (ordered[i + RATE_COUNT] - ordered[i]).total_seconds()
        assert gap >= RATE_WINDOW_S - STAMP_S, f"{RATE_COUNT + 1} messages accepted within {gap:.3f} s"


def test_chat_rate_limit_holds_under_concurrency(app_url, mail):
    g = signup(app_url, mail)
    with ExitStack() as stack:
        stack.callback(release, [g])
        raced = fire_together([lambda i=i: g.post("/api/party/messages", {"body": f"q{i}"}) for i in range(CHAT_BURST)])
        assert all(r.status_code in (201, 429) for r in raced), [r.text for r in raced]
        winners = [r for r in raced if r.status_code == 201]
        assert len(winners) >= RATE_COUNT, [r.status_code for r in raced]
        assert {error_code(r) for r in raced if r.status_code == 429} <= {"rate_limited"}
        within_cap([r.json()["message"]["sentAt"] for r in winners])
        stored = g.get("/api/party/messages").json()["messages"]
        assert len(stored) == len(winners), "the concurrent burst stored a message it rejected"
        within_cap([m["sentAt"] for m in stored])


def voice_rows(page: Page) -> dict[int, dict]:
    return {int(r["userId"]): r for r in rows(role(page, "list", "Voice")) if r.get("userId")}


VOICE_SPY = """
(() => {
  const w = window; w.__pcs = []; w.__media = []; w.__sources = [];
  const Real = w.RTCPeerConnection;
  if (Real) {
    const Spy = function (...args) { const pc = new Real(...args); w.__pcs.push(pc); return pc; };
    Spy.prototype = Real.prototype;
    Object.setPrototypeOf(Spy, Real);
    w.RTCPeerConnection = Spy;
  }
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  if (desc && desc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {configurable: true, get: desc.get,
      set(value) { if (value) w.__media.push(this); desc.set.call(this, value); }});
  }
  const Ctx = w.AudioContext;
  if (Ctx) {
    const make = Ctx.prototype.createMediaStreamSource;
    Ctx.prototype.createMediaStreamSource = function (stream) { w.__sources.push(stream); return make.call(this, stream); };
  }
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia && Ctx) {
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = async (constraints) => {
      if (w.__gate) await w.__gate;
      if (w.__deny) throw new DOMException('Permission denied', 'NotAllowedError');
      const captured = await real(constraints);
      if (!constraints || !constraints.audio) return captured;
      const ctx = new Ctx(); ctx.resume();
      const tone = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = __LEVEL__;
      const out = ctx.createMediaStreamDestination();
      tone.connect(gain).connect(out); tone.start();
      captured.getAudioTracks().forEach((t) => t.stop());
      return out.stream;
    };
  }
})();
"""

VOICE_PROBE = """
async () => {
  const w = window;
  const pcs = (w.__pcs || []).filter((pc) => pc.connectionState !== 'closed');
  const out = {connected: 0, received: 0, senders: [], playing: false};
  const remote = new Set();
  for (const pc of pcs) {
    if (pc.connectionState === 'connected' || ['connected', 'completed'].includes(pc.iceConnectionState)) out.connected += 1;
    const stats = await pc.getStats();
    stats.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') out.received += r.packetsReceived || 0; });
    for (const s of pc.getSenders()) {
      if (s.track && s.track.kind !== 'audio') continue;
      out.senders.push(!!s.track && s.track.enabled && s.track.readyState === 'live');
    }
    for (const r of pc.getReceivers()) if (r.track && r.track.kind === 'audio') remote.add(r.track.id);
  }
  const hasRemote = (s) => !!s && typeof s.getAudioTracks === 'function' && s.getAudioTracks().some((t) => remote.has(t.id));
  out.playing = (w.__media || []).some((m) => hasRemote(m.srcObject) && !m.paused) || (w.__sources || []).some(hasRemote);
  return out;
}
"""


def voice_spy(level: float) -> str:
    return VOICE_SPY.replace("__LEVEL__", repr(level))


def voice_probe(page: Page) -> dict:
    return page.evaluate(VOICE_PROBE)


def sending(page: Page) -> bool:
    return any(voice_probe(page)["senders"])


def delivered(page: Page) -> bool:
    state = voice_probe(page)
    return state["connected"] >= 1 and state["received"] > 0 and state["playing"]


def tile_flag(page: Page, uid: int, flag: str) -> str | None:
    return voice_rows(page).get(uid, {}).get(flag)


def test_voice_signalling_and_tiles(app_url, mail, browser):
    a, b, c, e = players(app_url, mail, 4)
    form_party(a, [b, c])
    with ExitStack() as stack:
        stack.callback(release, [a, b, c, e])
        page_a = as_player(stack, browser, app_url, a, mic=True, init=voice_spy(LOUD_GAIN))
        page_b = as_player(stack, browser, app_url, b, mic=True, init=voice_spy(SILENT_GAIN))
        for page in (page_a, page_b):
            ui(visible(role(page, "button", "Join voice")), UI_WAIT_S, "join voice")
            role(page, "button", "Join voice").click()
            ui(visible(role(page, "button", "Leave voice")), UI_WAIT_S, "in voice")
        for page in (page_a, page_b):
            ui(lambda page=page: all(tile_flag(page, u, "connected") == "true" for u in (a.id, b.id)),
               UI_WAIT_S, "peers connected")
            ui(lambda page=page: delivered(page), UI_WAIT_S, "audio delivered and played")
        flowing = voice_probe(page_b)["received"]
        ui(lambda: voice_probe(page_b)["received"] > flowing, UI_WAIT_S, "audio keeps arriving")
        ui(lambda: sending(page_a) and sending(page_b), UI_WAIT_S, "outgoing tracks enabled")
        ui(lambda: tile_flag(page_a, a.id, "speaking") == "true" == tile_flag(page_b, a.id, "speaking"),
           VOICE_LAG_S + UI_WAIT_S, "the loud microphone speaks")
        holds(lambda: tile_flag(page_a, b.id, "speaking") == "false" == tile_flag(page_b, b.id, "speaking"),
              HOLD_S, "the silent microphone never speaks")
        mute = role(page_a, "button", "Mute")
        mute.click()
        expect(mute).to_have_attribute("aria-pressed", "true")
        expect(with_attr(role(page_a, "list", "Voice").get_by_role("listitem"), "data-user-id", a.id)).to_have_attribute(
            "data-muted", "true", timeout=EXPECT_MS * 4)
        ui(lambda: not sending(page_a), UI_WAIT_S, "outgoing track disabled while muted")
        ui(lambda: tile_flag(page_b, a.id, "muted") == "true", VOICE_LAG_S + RESPONSE_SLACK_S, "b sees a muted")
        holds(lambda: not sending(page_a)
              and tile_flag(page_a, a.id, "speaking") == "false" == tile_flag(page_b, a.id, "speaking"),
              HOLD_S, "muted never speaks")
        mute.click()
        ui(lambda: sending(page_a) and tile_flag(page_b, a.id, "muted") == "false",
           VOICE_LAG_S + RESPONSE_SLACK_S, "unmuted")
        switch = role(page_a, "switch", "Push to talk")
        switch.click()
        ui(sees(role(page_a, "region", "Voice"), "Hold V to talk"), UI_WAIT_S, "hint")
        page_a.evaluate("() => document.activeElement && document.activeElement.blur()")
        holds(lambda: not sending(page_a) and tile_flag(page_b, a.id, "speaking") == "false", HOLD_S, "silent without V")
        page_a.keyboard.down("v")
        ui(lambda: sending(page_a) and tile_flag(page_b, a.id, "speaking") == "true",
           VOICE_LAG_S + UI_WAIT_S, "holding V transmits")
        page_a.keyboard.up("v")
        ui(lambda: not sending(page_a) and tile_flag(page_b, a.id, "speaking") == "false",
           VOICE_LAG_S + UI_WAIT_S, "releasing V stops")
        role(page_a, "textbox", "Message party").focus()
        page_a.keyboard.down("v")
        holds(lambda: not sending(page_a), HOLD_S, "V ignored in a text field")
        page_a.keyboard.up("v")
        stranger = open_wire(stack, browser, app_url, e)
        outsider = open_wire(stack, browser, app_url, c)
        for wire in (stranger, outsider):
            wire.send({"type": "voice_signal", "to": a.id, "data": {"probe": True}})
            wire.wait("() => window.__log.some(m => m.type === 'error' && m.code === 'not_in_voice')", None)


def voice_tile(page: Page, uid: int) -> Locator:
    return with_attr(role(page, "list", "Voice").get_by_role("listitem"), "data-user-id", uid)


def steady_tile(page: Page, uid: int) -> Any:
    shots: list[Any] = []

    def check() -> bool:
        advance(page, TILE_SETTLE_MS)
        shot = decode(capture(voice_tile(page, uid)))
        same = bool(shots) and difference(shots[-1], shot) == 0
        shots.append(shot)
        return same

    ui(check, UI_WAIT_S, "voice tile at rest")
    return shots[-1]


def test_wf_comms_chat_and_voice(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    form_party(a, [b])
    hello, reply = "hello " + secrets.token_hex(4), "reply " + secrets.token_hex(4)
    with ExitStack() as stack:
        stack.callback(release, [a, b])
        page_a = as_player(stack, browser, app_url, a, mic=True, init=voice_spy(LOUD_GAIN))
        page_b = as_player(stack, browser, app_url, b, mic=True, init=voice_spy(LOUD_GAIN))
        for page, words, other in ((page_a, hello, page_b), (page_b, reply, page_a)):
            role(page, "textbox", "Message party").fill(words)
            role(page, "button", "Send").first.click()
            ui(sees(role(other, "log", "Party chat"), words), CHAT_LAG_S + UI_WAIT_S, "message delivered")
        for page in (page_a, page_b):
            ui(visible(role(page, "button", "Join voice")), UI_WAIT_S, "join voice")
            role(page, "button", "Join voice").click()
        for page, other in ((page_a, b), (page_b, a)):
            ui(visible(voice_tile(page, other.id)), UI_WAIT_S, "the other member's tile")
        before = steady_tile(page_a, b.id)
        role(page_b, "button", "Mute").click()
        ui(lambda: difference(before, decode(capture(voice_tile(page_a, b.id)))) > 0,
           VOICE_LAG_S + UI_WAIT_S, "a sees b's tile change on mute")
        role(page_a, "switch", "Push to talk").click()
        page_a.evaluate("() => document.activeElement && document.activeElement.blur()")
        before = steady_tile(page_b, a.id)
        page_a.keyboard.down("v")
        ui(lambda: difference(before, decode(capture(voice_tile(page_b, a.id)))) > 0,
           VOICE_LAG_S + UI_WAIT_S, "b sees a's tile change while V is held")
        page_a.keyboard.up("v")
        bodies = [m["body"] for m in a.get("/api/party/messages").json()["messages"]]
        assert hello in bodies and reply in bodies


def test_wf_comms_direct_message(app_url, mail, browser):
    a, b, c = players(app_url, mail, 3)
    befriend(a, b)
    form_party(c, [b])
    words = "dm " + secrets.token_hex(4)
    lines = ["party " + secrets.token_hex(4) for _ in range(3)]
    with ExitStack() as stack:
        stack.callback(release, [a, b, c])
        page_a = as_player(stack, browser, app_url, a)
        page_b = as_player(stack, browser, app_url, b)
        tab = lambda name: role(page_b, "tab", name)
        ui(visible(tab("Party chat")), UI_WAIT_S, "dock tabs")
        tab("Party chat").click()
        assert c.post("/api/party/messages", {"body": lines[0]}).status_code == 201
        ui(sees(role(page_b, "log", "Party chat"), lines[0]), CHAT_LAG_S + UI_WAIT_S, "party message on screen")
        assert tab("Party chat").count() == 1, "a message read on screen counted as unread"
        tab("Messages").click()
        for line in lines[1:]:
            assert c.post("/api/party/messages", {"body": line}).status_code == 201
        ui(visible(tab("Party chat (2 unread)")), CHAT_LAG_S + UI_WAIT_S, "two unread party messages in the tab name")
        assert b.post("/api/party/messages", {"body": "own " + secrets.token_hex(4)}).status_code == 201
        holds(lambda: tab("Party chat (2 unread)").count() == 1, CHAT_LAG_S + 1, "own message never unread")
        tab("Party chat (2 unread)").click()
        ui(visible(tab("Party chat")), UI_WAIT_S, "unread cleared once the log is on screen")
        ui(sees(role(page_b, "log", "Party chat"), lines[2]), UI_WAIT_S, "unread messages in the log")
        ui(visible(tab("Messages")), UI_WAIT_S, "no unread direct messages yet")
        ui(visible(role(page_a, "button", f"Message {b.handle}")), UI_WAIT_S, "message button")
        role(page_a, "button", f"Message {b.handle}").click()
        role(page_a, "textbox", f"Message {b.handle}").fill(words)
        role(page_a, "textbox", f"Message {b.handle}").press("Enter")
        ui(visible(tab("Messages (1 unread)")), CHAT_LAG_S + UI_WAIT_S, "one unread direct message in the tab name")
        role(page_b, "button", f"Message {a.handle}").click()
        ui(sees(role(page_b, "log", f"Messages with {a.handle}"), words), CHAT_LAG_S + UI_WAIT_S, "dm shown")
        ui(visible(tab("Messages")), UI_WAIT_S, "unread cleared once the DM log is open")
        page_a.reload()
        ui(visible(role(page_a, "tab", "Messages")), UI_WAIT_S, "messages tab after reload")
        role(page_a, "tab", "Messages").click()
        ui(sees(role(page_a, "list", "Conversations"), b.handle), UI_WAIT_S, "conversation kept after reload")
    assert words in [m["body"] for m in b.get(f"/api/dms/{a.id}/messages").json()["messages"]]
def test_profiles_list_finished_matches(app_url, browser):
    viewer = signup(app_url, verify=False)
    match = match_json(viewer, 1)
    assert match["name"] == "Cup #1" and match["state"] == "finished"
    assert match["startedAt"] == SEED_MATCH_START and match["finishedAt"] == SEED_MATCH_END
    assert {u["id"] for u in match["participants"]} == set(range(1, 13))
    out_round = {}
    for rnd in match["rounds"]:
        for r in rnd["results"]:
            if r["outcome"] == "eliminated":
                out_round[r["userId"]] = rnd
    handles = {u["id"]: u["handle"] for u in match["participants"]}
    for uid, handle in handles.items():
        profile = viewer.get(f"/api/users/{handle}").json()
        entries = profile["matches"]
        assert len(entries) <= MATCH_HISTORY
        assert [(m["finishedAt"], m["id"]) for m in entries] == sorted(((m["finishedAt"], m["id"]) for m in entries), reverse=True)
        [cup] = [m for m in entries if m["id"] == 1]
        if uid == match["winnerId"]:
            assert cup["outcome"] == "winner" and cup["round"] is None
        else:
            assert cup["outcome"] == "eliminated" and cup["round"] == out_round[uid]["n"]
        won = sum(m["outcome"] == "winner" for m in entries)
        if len(entries) < MATCH_HISTORY:
            assert (profile["played"], profile["wins"]) == (len(entries), won), profile
        else:
            assert profile["played"] >= len(entries) and profile["wins"] >= won, profile
    assert SEED_MATCH not in [m["id"] for m in viewer.get(f"/api/users/{LULA}").json()["matches"]]
    expect_error(viewer.get("/api/users/nobody_" + secrets.token_hex(4)), 404, "user_not_found")
    expect_error(viewer.get(f"/api/matches/{OVERSIZE_ID}"), 404, "match_not_found")
    pip = viewer.get(f"/api/users/{PIP}").json()
    placement = "Winner" if match["winnerId"] == 1 else f"Out in {out_round[1]['name']}"

    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, viewer, f"/u/{PIP}")
        history = role(page, "list", "Match history")
        ui(visible(role(history, "link", "Cup #1")), UI_WAIT_S, "history")
        expect(history).to_contain_text(placement)
        assert pip["user"]["id"] == 1
        ui(counted(page, pip["played"], pip["wins"]), UI_WAIT_S, "profile counts")


def counted(page: Page, played: int, wins: int) -> Callable[[], bool]:
    def check() -> bool:
        for label, value in (("Matches played", played), ("Wins", wins)):
            expect(page.get_by_text(re.compile(rf"\b{label}: {value}(?!\d)")).first).to_be_visible(timeout=EXPECT_MS)
        return True
    return check


def test_your_profile_link_and_counts(app_url, mail, browser):
    me = signup(app_url, mail)
    own = me.get(f"/api/users/{me.handle}").json()
    assert (own["played"], own["wins"]) == (0, 0), own
    with ExitStack() as stack:
        mine = as_player(stack, browser, app_url, me)
        link = role(mine, "link", "Your profile")
        ui(visible(link), UI_WAIT_S, "Your profile link in the rail")
        link.click()
        ui(visible(role(mine, "heading", me.handle)), UI_WAIT_S, "own profile")
        assert urlparse(mine.url).path == f"/u/{me.handle}"
        ui(counted(mine, 0, 0), UI_WAIT_S, "own profile counts")


def test_frames_api_matches_resimulation(app_url):
    viewer = signup(app_url, verify=False)
    for rnd in match_json(viewer, 1)["rounds"]:
        exported = inputs_json(viewer, 1, rnd["n"])
        for tick in (0, rnd["lastTick"] // 3, rnd["lastTick"]):
            frame = frame_json(viewer, 1, rnd["n"], tick)
            assert frame["matchId"] == 1 and frame["round"] == rnd["n"] and frame["kind"] == rnd["kind"]
            assert frame["tick"] == tick and frame["lastTick"] == rnd["lastTick"] and frame["slots"] == rnd["slots"]
            assert sorted(b["userId"] for b in frame["beans"]) == sorted(rnd["starters"])
            for b in frame["beans"]:
                assert {"userId", "handle", "hue", "x", "y", "z", "state", "rank", "finishTick", "marker"} <= set(b)
                assert b["handle"] is not None
            if tick == 0:
                assert all(b["state"] == "alive" for b in frame["beans"])
            check_frame_rules(frame, rnd["results"], rnd["kind"], rnd["slots"])
            sim = simulate(app_url, sim_body(rnd["kind"], rnd["seed"], rnd["starters"], exported["inputs"], tick,
                                             exported["forfeits"]))["frame"]
            assert [(b["userId"], b["x"], b["y"], b["z"], b["state"], b["rank"]) for b in sim["beans"]] == \
                   [(b["userId"], b["x"], b["y"], b["z"], b["state"], b["rank"]) for b in frame["beans"]]
        last = rnd["lastTick"]
        for bad in (-1, last + 1, "abc", ""):
            expect_error(frames(viewer, 1, rnd["n"], bad), 422, "tick_out_of_range")
        expect_error(viewer.get(f"/api/matches/{SEED_MATCH}/rounds/{rnd['n']}/frames"), 422, "tick_out_of_range")
    expect_error(frames(viewer, 1, 4, 0), 404, "round_not_found")
    assert frames(viewer, UNKNOWN_ID, 1, 0).status_code == 404
    expect_error(frames(viewer, OVERSIZE_ID, 1, 0), 404, "round_not_found")
    expect_error(request(app_url, "GET", f"/api/matches/{SEED_MATCH}/rounds/1/frames?tick=0"), 401, "unauthenticated")


def frame_shown(page: Page, frame: dict, kind: str) -> Callable[[], None]:
    def check() -> None:
        state = slider_state(role(page, "slider", "Playhead"))
        assert state["now"] == frame["tick"] and state["min"] == 0 and state["max"] == frame["lastTick"]
        assert state["text"] == f"Tick {frame['tick']} of {frame['lastTick']}"
        expect(role(page, "status", "Frame")).to_contain_text(
            f"Tick {frame['tick']} of {frame['lastTick']}, {frame['slotsLeft']} {SLOT_LABEL[kind].lower()}", timeout=EXPECT_MS)
        lanes_match(page, frame)
        assert slots_value(page) == frame["slotsLeft"]
        assert parse_qs(urlparse(page.url).query).get("tick") == [str(frame["tick"])]
        return True

    return check


def test_photo_finish_lane_list_and_playhead(app_url, browser):
    viewer = signup(app_url, verify=False)
    rnd = match_json(viewer, 1)["rounds"][0]
    last = rnd["lastTick"]
    cache: dict[int, dict] = {}
    frame = lambda t: cache.setdefault(t, frame_json(viewer, 1, 1, t))
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, viewer, "/matches/1/rounds/1?tick=0")
        slider = role(page, "slider", "Playhead")
        ui(frame_shown(page, frame(0), "race"), UI_WAIT_S, "tick 0")
        depth = page.evaluate("history.length")
        expected = 0
        for key in ["ArrowRight", "PageUp", "PageDown", "ArrowLeft", "ArrowLeft", "End", "ArrowRight", "ArrowLeft", "Home"]:
            moves = {"ArrowRight": 1, "ArrowLeft": -1, "PageUp": PAGE_STEP, "PageDown": -PAGE_STEP}
            expected = last if key == "End" else 0 if key == "Home" else min(max(expected + moves[key], 0), last)
            slider.press(key)
            within_fake(page, frame_shown(page, frame(expected), "race"), LANE_MAX_MS, f"{key} to tick {expected}")
        assert page.evaluate("history.length") == depth
        end_rows = rows(role(page, "list", "Lanes"))
        slider.press("End")
        within_fake(page, frame_shown(page, frame(last), "race"), LANE_MAX_MS, "end")
        stored = {b["marker"] for b in frame(last)["beans"] if b.get("marker")}
        assert {r.get("marker") for r in rows(role(page, "list", "Lanes")) if r.get("marker")} == stored
        assert end_rows
        box = slider.bounding_box()
        y = box["y"] + box["height"] / 2
        page.mouse.move(box["x"] + box["width"] - 2, y)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 0.37, y, steps=8)
        page.mouse.up()
        dragged = int(slider_state(slider)["now"])
        assert 0 < dragged < last
        within_fake(page, frame_shown(page, frame(dragged), "race"), LANE_MAX_MS, "after drag")
        advance(page, 1000)
        snapshot = lambda: (rows(role(page, "list", "Lanes")), role(page, "status", "Frame").inner_text(),
                            slots_value(page),
                            role(page, "region", "Photo-finish").get_attribute("data-camera"),
                            role(page, "region", "Photo-finish").get_attribute("data-beans"))
        by_drag = snapshot()
        slider.press("Home")
        for _ in range(dragged // PAGE_STEP):
            slider.press("PageUp")
        for _ in range(dragged % PAGE_STEP):
            slider.press("ArrowRight")
        within_fake(page, frame_shown(page, frame(dragged), "race"), LANE_MAX_MS, "keyboard to dragged tick")
        advance(page, 1000)
        assert snapshot() == by_drag
        page.mouse.click(box["x"] + box["width"] * 0.8, y)
        clicked = int(slider_state(slider)["now"])
        assert clicked > dragged
        within_fake(page, frame_shown(page, frame(clicked), "race"), LANE_MAX_MS, "track click")


def test_photo_finish_motion(app_url, browser):
    viewer = signup(app_url, verify=False)
    rnd = match_json(viewer, 1)["rounds"][0]
    last = frame_json(viewer, 1, 1, rnd["lastTick"])
    zero = frame_json(viewer, 1, 1, 0)
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, viewer, "/matches/1/rounds/1?tick=0")
        region = role(page, "region", "Photo-finish")
        slider = role(page, "slider", "Playhead")
        ui(lambda: lanes_match(page, zero) or True, UI_WAIT_S, "tick 0")
        advance(page, 1000)
        before = decode(capture(role(page, "img", "3D photo-finish view")))
        slider.press("End")
        within_fake(page, lambda: expect(region).to_have_attribute("data-camera", "moving", timeout=EXPECT_MS),
                    LANE_MAX_MS, "camera starts")
        starts = {"camera": 0.0, "beans": 0.0 if region.get_attribute("data-beans") == "moving" else None}
        ends: dict[str, float | None] = {"camera": None, "beans": None}
        view = role(page, "img", "3D photo-finish view")
        shots: dict[float, Any] = {}
        spent = 0.0
        while spent <= CAMERA_MAX_MS * 2 and None in ends.values():
            network_quiet(page)
            if spent in (FLIGHT_EARLY_MS, FLIGHT_MID_MS):
                shots[spent] = decode(capture(view))
            for key in ("camera", "beans"):
                value = region.get_attribute(f"data-{key}")
                if value == "moving" and starts[key] is None:
                    starts[key] = spent
                if value == "still" and starts[key] is not None and ends[key] is None:
                    ends[key] = spent
            lanes = rows(role(page, "list", "Lanes"))
            if lanes and int(lanes[0]["tick"]) == last["tick"]:
                assert slots_value(page) == last["slotsLeft"]
            advance(page, FRAME_MS)
            spent += FRAME_MS
        assert starts["beans"] is not None and ends["beans"] is not None and ends["camera"] is not None
        assert set(shots) == {FLIGHT_EARLY_MS, FLIGHT_MID_MS}, "the camera settled before the mid-flight samples"
        advance(page, max(FLIGHT_SETTLED_MS - spent, FRAME_MS))
        settled = decode(capture(view))
        advance(page, FLIGHT_MID_MS)
        later = decode(capture(view))
        travelling = difference(shots[FLIGHT_MID_MS], settled)
        assert difference(shots[FLIGHT_EARLY_MS], shots[FLIGHT_MID_MS]) > 0 and travelling > 0, \
            "the replay camera cuts instead of flying"
        assert difference(settled, later) < travelling, "the replay keeps moving after the flight"
        glide = ends["beans"] - starts["beans"]
        flight = ends["camera"] - starts["camera"]
        assert GLIDE_MIN_MS - FRAME_MS <= glide <= GLIDE_MAX_MS + FRAME_MS, glide
        assert CAMERA_MIN_MS - FRAME_MS <= flight <= CAMERA_MAX_MS + FRAME_MS, flight
        lanes_match(page, last)
        assert slots_value(page) == last["slotsLeft"]
        changed(before, decode(capture(role(page, "img", "3D photo-finish view"))))
        previous = frame_json(viewer, 1, 1, rnd["lastTick"] - 1)
        slider.press("ArrowLeft")
        within_fake(page, lambda: lanes_match(page, previous), LANE_MAX_MS, "step back")
        slider.press("Home")
        advance(page, FLIGHT_SETTLED_MS)
        resting = decode(capture(view))
        slider.press("ArrowRight")
        advance(page, GLIDE_PROBE_MS)
        gliding = decode(capture(view))
        advance(page, FLIGHT_SETTLED_MS)
        arrived = decode(capture(view))
        assert difference(resting, gliding) > 0 and difference(gliding, arrived) > 0, \
            "beans cut to the next tick instead of gliding"

        calm = as_player(stack, browser, app_url, viewer, "/matches/1/rounds/1?tick=0", reduced="reduce")
        calm_region = role(calm, "region", "Photo-finish")
        ui(visible(calm_region), UI_WAIT_S, "reduced page")
        calm_region.evaluate("""el => { window.__seen = []; new MutationObserver(() => window.__seen.push(
            el.getAttribute('data-camera'), el.getAttribute('data-beans'))).observe(el, {attributes: true}); }""")
        calm_slider = role(calm, "slider", "Playhead")
        for key in ("End", "Home", "PageUp", "ArrowRight"):
            calm_slider.press(key)
            for _ in range(8):
                advance(calm, FRAME_MS * 4)
                assert "moving" not in [calm_region.get_attribute("data-camera"), calm_region.get_attribute("data-beans")]
        assert "moving" not in calm.evaluate("window.__seen")
        table = role(calm, "table", "Photo-finish frame")
        ui(visible(table), UI_WAIT_S, "frame table")
        assert table.evaluate("t => !!t.closest('[aria-live=\"polite\"], [role=\"status\"], [role=\"log\"]')")
        for header in ("Rank", "Player", "X", "Y", "Z", "State"):
            expect(table.get_by_role("columnheader", name=header, exact=True)).to_be_visible()
        current = frame_json(viewer, 1, 1, PAGE_STEP + 1)
        top = current["beans"][0]
        ui(sees(table, f"{top['x']:.3f}"), UI_WAIT_S, "table carries the tick")
        expect(table).to_contain_text(top["handle"])


def test_wf_photo_finish_rival_profile(app_url, browser):
    viewer = signup(app_url, verify=False)
    rnd = match_json(viewer, 1)["rounds"][0]
    decided = frame_json(viewer, 1, 1, rnd["lastTick"])
    last_slot = next((b for b in decided["beans"] if b["marker"] == "last_slot"), None)
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, viewer, f"/u/{PIP}")
        ui(visible(role(page, "heading", PIP)), UI_WAIT_S, "profile")
        role(role(page, "list", "Match history"), "link", "Cup #1").click()
        ui(visible(role(page, "heading", "Cup #1")), UI_WAIT_S, "summary")
        role(page, "link", f"Photo-finish: {rnd['name']}").click()
        slider = role(page, "slider", "Playhead")
        ui(visible(slider), UI_WAIT_S, "photo-finish")
        slider.press("End")
        ui(sees(role(page, "status", "Frame"), f"Tick {rnd['lastTick']} of {rnd['lastTick']}"), UI_WAIT_S, "deciding tick")
        if last_slot is not None:
            marked = with_attr(role(page, "list", "Lanes").get_by_role("listitem"), "data-marker", "last_slot")
            ui(sees(marked, "Last slot"), UI_WAIT_S, "last slot row")
            assert marked.get_attribute("data-user-id") == str(last_slot["userId"])
        assert urlparse(page.url).path == f"/matches/{SEED_MATCH}/rounds/{rnd['n']}"


def test_wf_photo_finish_deep_link(app_url, browser):
    viewer = signup(app_url, verify=False)
    rnd = match_json(viewer, 1)["rounds"][0]
    tick = rnd["lastTick"] // 2
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, viewer, f"/matches/1/rounds/1?tick={tick}")
        ui(sees(role(page, "status", "Frame"), f"Tick {tick} of {rnd['lastTick']}"), UI_WAIT_S, "deep-linked tick shown")


class GatedRelay:

    def __init__(self, host: str, port: int):
        self.target, self.opened = (host, port), threading.Event()
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(64)
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            if not self.opened.is_set():
                client.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
            except OSError:
                client.close()
                continue
            upstream.settimeout(None)
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        with contextlib.suppress(OSError):
            while (data := a.recv(65536)):
                b.sendall(data)
        for sock in (a, b):
            with contextlib.suppress(OSError):
                sock.close()

    def close(self) -> None:
        with contextlib.suppress(OSError):
            self.listener.close()


@pytest.fixture
def empty_database() -> Iterator[str]:
    url = urlsplit(os.environ["DATABASE_URL"])
    fresh = f"pc_cold_{secrets.token_hex(4)}"
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGHOST": url.hostname or "", "PGPORT": str(url.port or PG_PORT),
           "PGUSER": unquote(url.username or ""), "PGPASSWORD": unquote(url.password or ""), "PGDATABASE": url.path.lstrip("/")}
    psql = ["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c"]
    made = subprocess.run(psql + [f'CREATE DATABASE "{fresh}"'], env=env, capture_output=True, text=True, timeout=HTTP_TIMEOUT_S)
    if made.returncode:
        raise RuntimeError(f"verifier infrastructure: cannot create the cold-start database: {made.stderr}")
    try:
        yield url._replace(path="/" + fresh).geturl()
    finally:
        subprocess.run(psql + [f'DROP DATABASE IF EXISTS "{fresh}" WITH (FORCE)'], env=env, capture_output=True, timeout=HTTP_TIMEOUT_S)


def cold_start(stack: ExitStack, database_url: str) -> None:
    url = urlsplit(database_url)
    relay = GatedRelay(url.hostname or "", url.port or PG_PORT)
    stack.callback(relay.close)
    netloc = url.netloc.rsplit("@", 1)[0] + f"@127.0.0.1:{relay.port}"
    base = start_copy(stack, 0, env_extra={"DATABASE_URL": url._replace(netloc=netloc).geturl()}, ready=False)
    for _ in range(2):
        poll(lambda: request(base, "GET", "/api/health").status_code == 503, API_WAIT_S, "health while the database is down")
        assert request(base, "GET", "/api/health").json() == {"status": "starting"}
    relay.opened.set()
    poll(lambda: request(base, "GET", "/api/health").status_code == 200, PG_RETRY_S + API_WAIT_S, "recovery after the database answers")
    assert request(base, "GET", "/api/health").json() == {"status": "ok"}
    poll(lambda: login(base, f"{PIP}@{SEED_DOMAIN}", SEED_PASSWORD).status_code == 200, API_WAIT_S,
         "serving seeds the empty database")


def test_server_boundary(app_url, mail, empty_database):
    health = request(app_url, "GET", "/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    expect_error(request(app_url, "GET", "/api/no-such-endpoint"), 404, "not_found")
    padded = {"email": "a@b.test", "password": "x" * 10, "pad": "x" * (BODY_LIMIT + 1024)}
    expect_error(request(app_url, "POST", "/api/auth/login", padded), 413, "payload_too_large")
    huge = sim_body("race", 1, [1], []) | {"pad": "x" * (SIM_BODY_LIMIT + 1024)}
    expect_error(request(app_url, "POST", "/api/simulate", huge, cookie=sim_session(app_url)), 413, "payload_too_large")
    expect_error(request(app_url, "POST", "/api/auth/login", raw=b"email=a", headers={"Content-Type": "text/plain"}),
                 415, "unsupported_media_type")
    foreign = request(app_url, "POST", "/api/auth/login", {"email": "a@b.test", "password": "x" * 10},
                      headers={"Origin": FOREIGN_ORIGIN})
    expect_error(foreign, 403, "bad_origin")
    own = urlparse(app_url)
    same = request(app_url, "POST", "/api/auth/login", {"email": "a@b.test", "password": "x" * 10},
                   headers={"Origin": f"{own.scheme}://{own.netloc}"})
    expect_error(same, 401, "invalid_credentials")
    for response in (foreign, request(app_url, "GET", "/api/health", headers={"Origin": FOREIGN_ORIGIN}),
                     request(app_url, "OPTIONS", "/api/auth/login", headers={"Origin": FOREIGN_ORIGIN})):
        assert not any(h.lower().startswith("access-control-") for h in response.headers)
    player = signup(app_url, verify=False)
    assert ws_close_code(app_url, None, None) == 4401
    assert ws_close_code(app_url, FOREIGN_ORIGIN, player.cookie) == 4403
    for path in ("/package.json", "/package-lock.json", "/run.json", "/.env", "/node_modules/three/package.json", "/src/main.ts", "/server/index.ts", "/assets/app.js.map"):
        assert request(app_url, "GET", path).status_code == 404, path
    shell = request(app_url, "GET", "/some/client/route")
    root = request(app_url, "GET", "/")
    assert shell.status_code == 200 and shell.text == root.text
    secrets_found = []
    database = os.environ.get("DATABASE_URL", "")
    candidates = [v for v in (database, urlparse(database).password if database else None) if v and len(v) >= 4]
    bodies = [shell.text, health.text]
    for src in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', shell.text):
        bodies.append(request(app_url, "GET", src).text)
    for body in bodies:
        secrets_found += [c for c in candidates if c in body]
    assert not secrets_found, "a credential leaked into a response"
    with ExitStack() as stack:
        cold_start(stack, empty_database)


def answer(page: Page, glob: str, status: int, code: str, method: str = "POST", body: dict | None = None) -> None:
    payload = body if body is not None else {"error": {"code": code, "message": "probe"}}

    used = {"done": False}

    def handle(route: Any) -> None:
        if used["done"] or route.request.method != method:
            route.fallback()
            return
        used["done"] = True
        route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))
    page.route(glob, handle)


def pretend(page: Page, glob: str, body: dict) -> Callable[[], None]:
    def handle(route: Any) -> None:
        if route.request.method != "GET":
            route.fallback()
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    page.route(glob, handle)
    return lambda: page.unroute(glob, handle)


def test_feedback_states_outcomes(app_url, mail, browser):
    a, b, c = players(app_url, mail, 3)
    befriend(a, b)
    befriend(a, c)
    with ExitStack() as stack:
        stack.callback(release, [a, b, c])
        anon = browse(stack, browser, app_url + "/signup")
        for email_address, handle, field, copy in ((a.email, "fresh_" + secrets.token_hex(3), "Email", "That email already has an account."),
                                                   (f"new_{secrets.token_hex(4)}@{SEED_DOMAIN}", a.handle, "Handle", "That handle is taken.")):
            anon.goto(app_url + "/signup")
            anon.get_by_label("Email", exact=True).fill(email_address)
            anon.get_by_label("Handle", exact=True).fill(handle)
            anon.get_by_label("Password", exact=True).fill(fresh_password())
            role(anon, "button", "Create account").click()
            ui(sees(notices(anon), "Check the highlighted fields."), UI_WAIT_S, f"{field} field notice")
            expect(anon.get_by_label(field, exact=True)).to_have_accessible_description(re.compile(re.escape(copy)), timeout=UI_WAIT_S * 1000)

        down = outage_url()
        outage = browse(stack, browser, down + "/signup")
        outage.get_by_label("Email", exact=True).fill(f"cut_{secrets.token_hex(4)}@{SEED_DOMAIN}")
        outage.get_by_label("Handle", exact=True).fill("cut_" + secrets.token_hex(3))
        outage.get_by_label("Password", exact=True).fill(fresh_password())
        role(outage, "button", "Create account").click()
        ui(sees(notices(outage), "Account created, but we couldn't send your verification email. Resend it once mail is back."), UI_WAIT_S, "mail-down sign-up")
        resend = role(role(outage, "region", "Verify your email"), "button", "Resend verification email")
        ui(visible(resend), UI_WAIT_S, "resend")
        resend.click()
        ui(sees(notices(outage), "Mail is down right now. Try again in a minute."), UI_WAIT_S, "mail-down resend")

        unverified = signup(app_url, verify=False)
        gate = as_player(stack, browser, app_url, unverified)
        ui(visible(role(gate, "complementary", "Friends")), UI_WAIT_S, "rail")
        field, send = role(gate, "textbox", "Add friend by handle"), role(gate, "button", "Send request")
        if field.is_visible() and field.is_editable():
            field.fill(b.handle)
            if send.is_visible() and send.is_enabled():
                send.click()
                ui(sees(notices(gate), "Verify your email first."), UI_WAIT_S, "unverified rejection")
        answer(gate, "**/api/auth/verification/resend", 409, "already_verified")
        role(role(gate, "region", "Verify your email"), "button", "Resend verification email").click()
        ui(sees(notices(gate), "Your email is already verified."), UI_WAIT_S, "already verified")

        late = start_copy(stack, EXPIRED_OFFSET_MIN)
        lapsed = signup(app_url, verify=False)
        token = new_token(mail, lapsed.email, VERIFY_SUBJECT, "verify")
        link = browse(stack, browser, f"{late}/verify?token={token}")
        ui(lambda: "This link has expired. Request a new one." in link.inner_text("body"), UI_WAIT_S, "expired link copy")

        page = as_player(stack, browser, app_url, a)
        field = role(page, "textbox", "Add friend by handle")
        ui(visible(field), UI_WAIT_S, "rail")
        missing = "nobody_" + secrets.token_hex(4)
        field.fill(missing)
        role(page, "button", "Send request").click()
        ui(sees(notices(page), f"No player called {missing}."), UI_WAIT_S, "unknown handle")
        for status, code, copy in ((500, "internal", "Something went wrong. Try again."),
                                   (409, "probe_unlisted", "That can't be done right now.")):
            answer(page, "**/api/friends/requests", status, code)
            field.fill(missing)
            role(page, "button", "Send request").click()
            ui(sees(notices(page), copy), UI_WAIT_S, copy)

        for verb in ("accept", "decline"):
            asker = players(app_url, mail, 1)[0]
            stack.callback(release, [asker])
            assert asker.post("/api/friends/requests", {"handle": a.handle}).status_code == 201
            page.reload()
            button = role(page, "button", f"{verb.capitalize()} {asker.handle}")
            ui(visible(button), UI_WAIT_S, f"{verb} button")
            answer(page, f"**/api/friends/requests/*/{verb}", 404, "request_not_found")
            button.click()
            ui(sees(notices(page), "That request is no longer open."), UI_WAIT_S, f"closed request on {verb}")

        for friend, status, code, copy in ((b, 403, "not_friends", "You can only invite friends."),
                                           (c, 403, "not_leader", "Only the party leader can do that.")):
            page.reload()
            invite_button = role(page, "button", f"Invite {friend.handle} to party")
            ui(visible(invite_button), UI_WAIT_S, "invite button")
            answer(page, "**/api/party/invites", status, code)
            invite_button.click()
            ui(sees(notices(page), copy), UI_WAIT_S, copy)

        guest = as_player(stack, browser, app_url, b)
        for verb, status, code, copy in (("accept", 409, "party_busy", "That party is busy right now. Try again after its search or match."),
                                         ("accept", 404, "invite_not_found", "That invite is no longer open."),
                                         ("decline", 404, "invite_not_found", "That invite is no longer open.")):
            host = players(app_url, mail, 1)[0]
            stack.callback(release, [host])
            befriend(host, b)
            assert host.post("/api/party/invites", {"userId": b.id}).status_code in (200, 201)
            guest.reload()
            control = role(guest, "button", f"Join {host.handle}'s party" if verb == "accept" else f"Decline invite from {host.handle}")
            ui(visible(control), UI_WAIT_S, "invite shown")
            answer(guest, f"**/api/party/invites/*/{verb}", status, code)
            control.click()
            ui(sees(notices(guest), copy), UI_WAIT_S, copy)

        role(page, "button", f"Message {c.handle}").click()
        box = role(page, "textbox", f"Message {c.handle}")
        ui(visible(box), UI_WAIT_S, "direct message box")
        box.fill("probe")
        answer(page, f"**/api/dms/{c.id}/messages", 403, "blocked")
        sends = page.get_by_role("button", name="Send", exact=True)
        next(sends.nth(i) for i in reversed(range(sends.count())) if sends.nth(i).is_visible()).click()
        ui(sees(notices(page), "You can't message this player."), UI_WAIT_S, "blocked message")

        live: dict[str, Any] = {}

        def socket_route(ws: Any) -> None:
            server = ws.connect_to_server()
            server.on_message(lambda message: ws.send(message))
            ws.on_message(lambda message: server.send(message))
            live["ws"] = ws

        def push(party: dict) -> None:
            live["ws"].send(json.dumps({"type": "party", "party": party}))

        page.route_web_socket("**/ws", socket_route)
        page.reload()
        ui(lambda: "ws" in live, API_WAIT_S, "page socket")
        find = role(page, "button", "Find a match")
        ui(visible(find), UI_WAIT_S, "find a match")
        answer(page, "**/api/party/queue", 409, "invalid_transition")
        find.click()
        ui(sees(notices(page), "Your party is already searching or playing."), UI_WAIT_S, "already searching")
        idle = party_of(a)
        read = a.get("/api/party").json()
        queued = {**idle, "state": "queued", "queuedAt": idle.get("queuedAt") or "2026-01-01T00:00:00.000Z"}
        undo = pretend(page, "**/api/party", {**read, "party": queued})
        answer(page, "**/api/party/queue", 202, "", body={"party": queued})
        find.click()
        push(queued)
        cancel = role(page, "button", "Cancel search")
        ui(visible(cancel), UI_WAIT_S, "cancel search")
        undo()
        record_notices(page)
        cancel.click()
        ui(heard(page, "Your party isn't searching any more."), UI_WAIT_S, "not searching")
        live.clear()
        page.reload()
        ui(lambda: "ws" in live, API_WAIT_S, "page socket again")
        undo = pretend(page, "**/api/party", {**read, "party": queued})
        answer(page, "**/api/party/queue", 202, "", body={"party": queued})
        role(page, "button", "Find a match").click()
        push(queued)
        ui(visible(role(page, "button", "Cancel search")), UI_WAIT_S, "cancel search again")
        undo()
        answer(page, "**/api/party/queue/cancel", 200, "", body={"party": idle})
        role(page, "button", "Cancel search").click()
        ui(sees(notices(page), "Search cancelled."), UI_WAIT_S, "search cancelled")
        live.clear()
        page.reload()
        ui(lambda: "ws" in live, API_WAIT_S, "page socket for the drop")

        region = notices(page)
        ui(lambda: region.count() > 0, UI_WAIT_S, "notices")
        record_notices(page)
        live.pop("ws").close(code=CLOSE_CODE, reason="probe")
        ui(heard(page, "Reconnecting…"), UI_WAIT_S, "reconnecting")
        ui(sees(notices(page), "Back online."), UI_WAIT_S + PG_RETRY_S, "back online")

        lobby_id = queue_seated(a)["lobbyId"]
        added = fill_lobby(stack, None, app_url, mail, a, lobby_id)
        ui(visible(role(page, "timer", "Countdown")), UI_WAIT_S, "countdown")
        assert added[-1][0].post("/api/lobby/leave").status_code == 200
        ui(sees(notices(page), "A player left. Countdown cancelled — waiting for players."), UI_WAIT_S, "countdown cancelled")
        fill_lobby(stack, None, app_url, mail, a, lobby_id)
        match_id = match_started(a)
        wait_round(a, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        forfeit = role(page, "button", "Forfeit")
        ui(visible(forfeit), UI_WAIT_S, "forfeit button")
        forfeit.click()
        ui(sees(notices(page), "You forfeited this round."), UI_WAIT_S, "forfeit copy")
        for filler, _ in added:
            with contextlib.suppress(Exception):
                filler.post(f"/api/matches/{match_id}/forfeit")
        wait_finished(a, match_id)
        ui(sees(notices(page), f"Cup #{match_id} is over. You're back with your party."), UI_WAIT_S, "match over")


def test_responsive_layout(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    befriend(a, b)
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, a)
        for size in (PHONE, TABLET, WIDE):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            for path in ("/", "/u/pip_bounce", "/matches/1", "/matches/1/rounds/1"):
                page.goto(app_url + path)
                ui(lambda page=page: notices(page).count() > 0, UI_WAIT_S, f"{path} at {size}")
                layout(page)
        page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
        page.goto(app_url + "/")
        rail, dock, stage = role(page, "complementary", "Friends"), role(page, "complementary", "Party dock"), role(page, "region", "Party")
        ui(visible(dock), UI_WAIT_S, "dock")
        r, s, d = rail.bounding_box(), stage.bounding_box(), dock.bounding_box()
        assert r["x"] + r["width"] <= s["x"] + 1 and s["x"] + s["width"] <= d["x"] + 1
        collapse = role(page, "button", "Collapse dock")
        expect(collapse).to_have_attribute("aria-expanded", "true")
        collapse.click()
        expand = role(page, "button", "Expand dock")
        ui(lambda: expand.get_attribute("aria-expanded", timeout=EXPECT_MS) == "false", UI_WAIT_S, "collapsed")
        advance(page, 1000)
        strip = dock.bounding_box() if dock.is_visible() else expand.bounding_box()
        assert strip["x"] > d["x"] + 1 and strip["width"] < d["width"], "the dock did not shrink to a strip"
        page.reload()
        ui(visible(role(page, "button", "Expand dock")), UI_WAIT_S, "remembered")
        role(page, "button", "Expand dock").click()
        page.set_viewport_size({"width": TABLET[0], "height": TABLET[1]})
        ui(visible(role(page, "complementary", "Friends")), UI_WAIT_S, "rail at 768")
        ui(gone(role(page, "complementary", "Party dock")), UI_WAIT_S, "dock hidden at 768")
        role(page, "button", "Party dock").click()
        ui(visible(role(page, "dialog", "Party dock")), UI_WAIT_S, "dock dialog")
        page.keyboard.press("Escape")
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        ui(visible(role(page, "button", "Friends")), UI_WAIT_S, "friends button")
        role(page, "button", "Friends").click()
        dialog = role(page, "dialog", "Friends")
        ui(visible(dialog), UI_WAIT_S, "friends dialog")
        advance(page, 1000)
        assert dialog.bounding_box()["width"] >= PHONE[0] - 1
        page.keyboard.press("Escape")
        page.goto(app_url + "/matches/1/rounds/1")
        lanes, slider = role(page, "list", "Lanes"), role(page, "slider", "Playhead")
        ui(visible(lanes), UI_WAIT_S, "lanes at 375")
        assert lanes.bounding_box()["y"] >= slider.bounding_box()["y"] + slider.bounding_box()["height"] - 1
        page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
        advance(page, 1000)
        view, lane_box = role(page, "img", "3D photo-finish view").bounding_box(), lanes.bounding_box()
        assert lane_box["x"] >= view["x"] + view["width"] - 1 or lane_box["x"] + lane_box["width"] <= view["x"] + 1
        anon = browse(stack, browser, app_url + "/signin", PHONE)
        ui(visible(role(anon, "button", "Sign in")), UI_WAIT_S, "sign in page")
        layout(anon)
BRIEF_AXE_RULES = ("aria-allowed-attr", "aria-command-name", "aria-dialog-name",
                   "aria-input-field-name", "aria-required-attr", "aria-required-children", "aria-required-parent",
                   "aria-roles", "aria-toggle-field-name", "aria-valid-attr", "aria-valid-attr-value", "button-name",
                   "color-contrast", "image-alt", "input-button-name", "label", "link-name", "role-img-alt",
                   "select-name", "svg-img-alt")


def axe(page: Page) -> None:
    page.add_script_tag(path=str(conftest.AXE))
    page.evaluate(
        """options => {
          const result={done:false,error:null,violations:[]};
          Object.defineProperty(window,'__VERIFIER_AXE_RESULT__',{value:()=>structuredClone(result),configurable:true});
          axe.run(document,options).then(value=>{
            result.violations=value.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));result.done=true;
          },error=>{result.error=String(error);result.done=true});
        }""",
        {"runOnly": {"type": "rule", "values": list(BRIEF_AXE_RULES)}},
    )
    for _ in range(625):
        status = page.evaluate("window.__VERIFIER_AXE_RESULT__()")
        if status["done"]:
            assert status["error"] is None, status["error"]
            assert not status["violations"], f"WCAG violations: {status['violations']}"
            return
        advance(page, 16)
    raise AssertionError("axe audit did not settle under controlled time")


def focus_names(page: Page, presses: int) -> list[str]:
    names = []
    for _ in range(presses):
        page.keyboard.press("Tab")
        names.append(page.evaluate("""() => { const e = document.activeElement; if (!e || e === document.body) return '';
          const by = (e.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)
            .map(id => document.getElementById(id)?.textContent || '').join(' ');
          return (by.trim() || e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.innerText || e.title
            || e.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim(); }"""))
    return names


def test_keyboard_and_screen_reader_access(app_url, mail, browser):
    me, mate, pal, asker, host = players(app_url, mail, 5)
    with ExitStack() as stack:
        stack.callback(release, [me, mate, pal, asker, host])
        form_party(me, [mate])
        befriend(me, pal)
        befriend(host, me)
        assert host.post("/api/party/invites", {"userId": me.id}).status_code == 201
        assert asker.post("/api/friends/requests", {"handle": me.handle}).status_code == 201
        wanted_friend, shunned = players(app_url, mail, 2)
        stack.callback(release, [wanted_friend, shunned])
        assert me.post("/api/friends/requests", {"handle": wanted_friend.handle}).status_code == 201
        assert me.post("/api/blocks", {"userId": shunned.id}).status_code in (200, 201)
        anon = browse(stack, browser, app_url + "/signup")
        account_pages = {
            "/signup": [("label", "Email"), ("label", "Handle"), ("label", "Password"), ("button", "Create account")],
            "/signin": [("label", "Email"), ("label", "Password"), ("button", "Sign in"), ("link", "Forgot password?")],
            "/forgot-password": [("label", "Email"), ("button", "Send reset link")],
            "/reset-password?token=probe": [("label", "New password"), ("button", "Set new password")],
            "/verify?token=probe": [("region", "Verification")],
        }
        for path, wanted in account_pages.items():
            anon.goto(app_url + path)
            for kind, name in wanted:
                target = anon.get_by_label(name, exact=True) if kind == "label" else role(anon, kind, name)
                ui(visible(target), UI_WAIT_S, f"{kind} {name} on {path}")
            ui(lambda: notices(anon).count() > 0, UI_WAIT_S, f"status Notices present on {path}")
            axe(anon)
        unverified = signup(app_url, verify=False)
        gate_page = as_player(stack, browser, app_url, unverified)
        ui(visible(role(role(gate_page, "region", "Verify your email"), "button", "Resend verification email")),
           UI_WAIT_S, "banner")
        page = as_player(stack, browser, app_url, me, mic=True)
        shell = [("button", "Sign out"), ("complementary", "Friends"), ("heading", "Friends"), ("list", "In your party"),
                 ("list", "Friends"), ("textbox", "Add friend by handle"), ("button", "Send request"), ("list", "Requests"),
                 ("button", f"Accept {asker.handle}"), ("button", f"Decline {asker.handle}"),
                 ("button", f"Withdraw request to {wanted_friend.handle}"),
                 ("button", f"Invite {pal.handle} to party"), ("button", f"Message {pal.handle}"), ("link", pal.handle),
                 ("region", "Party invites"), ("button", f"Join {host.handle}'s party"),
                 ("button", f"Decline invite from {host.handle}"), ("region", "Party"), ("list", "Party members"),
                 ("button", "Find a match"), ("button", f"Make {mate.handle} leader"), ("button", "Leave party"),
                 ("complementary", "Party dock"), ("button", "Collapse dock"), ("tablist", None), ("tab", "Party chat"),
                 ("tab", "Messages"), ("log", "Party chat"), ("textbox", "Message party"), ("region", "Voice"),
                 ("button", "Join voice")]
        for kind, name in shell:
            target = page.get_by_role(kind) if name is None else role(page, kind, name)
            ui(visible(target.first), UI_WAIT_S, f"{kind} {name}")
        axe(page)
        for name in ("Sign out", "Send request", "Find a match", "Collapse dock", "Join voice"):
            box = role(page, "button", name).bounding_box()
            assert box["width"] >= TAP_MIN_PX and box["height"] >= TAP_MIN_PX, name
        adder = role(page, "textbox", "Add friend by handle")
        adder.fill(pal.handle)
        names = focus_names(page, 120)
        start = names.index("Sign out")
        names = names[start:] + names[:start]
        sequence = ["Sign out", "Add friend by handle", "Send request", f"Invite {pal.handle} to party",
                    "Find a match", "Collapse dock", "Message party", "Join voice"]
        positions = [names.index(n) for n in sequence]
        assert positions == sorted(positions), names
        adder.focus()
        rest, focused = state_styles(role(page, "button", "Send request"), "outline-style", "outline-width",
                                     "outline-color", "box-shadow", state="focus")
        assert rest != focused and (focused["outline-style"] != "none" or focused["box-shadow"] != "none")
        adder.fill("")
        toggle = role(page, "button", "Collapse dock")
        toggle.focus()
        page.keyboard.press("Enter")
        ui(lambda: is_focused(role(page, "button", "Expand dock")), UI_WAIT_S, "focus stays on toggle")
        page.keyboard.press("Enter")
        ui(lambda: is_focused(role(page, "button", "Collapse dock")), UI_WAIT_S, "focus stays on toggle after expanding")
        role(page, "tab", "Messages").click()
        ui(lambda: role(page, "list", "Conversations").count() > 0, UI_WAIT_S, "conversations")
        role(page, "button", f"Message {pal.handle}").click()
        ui(visible(role(page, "log", f"Messages with {pal.handle}")), UI_WAIT_S, "dm log")
        expect(role(page, "textbox", f"Message {pal.handle}")).to_be_visible()
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        for opener_name, dialog_name, closer in (("Friends", "Friends", "Escape"), ("Party dock", "Party dock", "Close")):
            opener = role(page, "button", opener_name)
            ui(visible(opener), UI_WAIT_S, opener_name)
            opener.click()
            dialog = role(page, "dialog", dialog_name)
            ui(lambda: focus_inside(dialog), UI_WAIT_S, f"{dialog_name} focused")
            for _ in range(15):
                page.keyboard.press("Tab")
                assert focus_inside(dialog), f"focus escaped {dialog_name}"
            if closer == "Escape":
                page.keyboard.press("Escape")
            else:
                role(dialog, "button", "Close").click()
            ui(gone(dialog), UI_WAIT_S, f"{dialog_name} closed")
            assert is_focused(opener)
        page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
        for path, wanted in {f"/u/{pal.handle}": [("heading", pal.handle), ("button", f"Remove {pal.handle} from friends"),
                                                  ("button", f"Block {pal.handle}"), ("list", "Match history")],
                             f"/u/{asker.handle}": [("heading", asker.handle)],
                             f"/u/{shunned.handle}": [("button", f"Unblock {shunned.handle}")],
                             "/matches/1": [("heading", "Cup #1"), ("link", "Photo-finish: Wobble Dash")],
                             "/matches/1/rounds/1": [("region", "Photo-finish"), ("img", "3D photo-finish view"),
                                                     ("slider", "Playhead"), ("status", "Frame"), ("list", "Lanes")]}.items():
            page.goto(app_url + path)
            for kind, name in wanted:
                target = role(page, kind, name)
                ui((lambda t=target: t.count() > 0) if kind == "list" else visible(target), UI_WAIT_S, f"{kind} {name} on {path}")
            axe(page)

        def present(scope: Page, wanted: list[tuple[str, str]], where: str) -> None:
            for kind, name in wanted:
                ui(visible(role(scope, kind, name)), UI_WAIT_S, f"{kind} {name} ({where})")

        page.goto(app_url + "/")
        role(page, "button", "Join voice").click()
        present(page, [("button", "Leave voice"), ("button", "Mute"), ("switch", "Push to talk"), ("list", "Voice")], "joined voice")
        axe(page)
        role(page, "button", "Leave voice").click()
        calm = as_player(stack, browser, app_url, me, "/matches/1/rounds/1", reduced="reduce")
        present(calm, [("slider", "Playhead"), ("table", "Photo-finish frame")], "reduced motion")
        axe(calm)

        held_pushes: list[str] = []
        held_reads: list[Any] = []
        hold = {"on": False}

        def socket_route(ws: Any) -> None:
            server = ws.connect_to_server()

            def from_server(message: Any) -> None:
                with contextlib.suppress(ValueError, TypeError, AttributeError):
                    data = json.loads(message)
                    queued_push = data.get("type") == "party" and (data.get("party") or {}).get("state") == "queued"
                    if hold["on"] and data.get("type") in HELD_PUSHES and not queued_push:
                        held_pushes.append(message)
                        return
                ws.send(message)
            server.on_message(from_server)
            ws.on_message(lambda message: server.send(message))

        queued: dict[str, Any] = {}
        party_reads: list[Any] = []

        def answer_party(route: Any) -> None:
            real = route.fetch()
            route.fulfill(status=real.status, content_type="application/json", body=json.dumps({**real.json(), "party": queued}))

        def queue_route(route: Any) -> None:
            response = route.fetch()
            with contextlib.suppress(ValueError, TypeError, AttributeError):
                queued.update(response.json().get("party") or {})
            route.fulfill(response=response)
            if hold["on"] and queued:
                while party_reads:
                    answer_party(party_reads.pop())

        def read_route(route: Any) -> None:
            if hold["on"] and route.request.method == "GET":
                if urlsplit(route.request.url).path.endswith("/api/party") and queued:
                    answer_party(route)
                elif urlsplit(route.request.url).path.endswith("/api/party"):
                    party_reads.append(route)
                else:
                    held_reads.append(route)
            else:
                route.continue_()

        page.route_web_socket("**/ws", socket_route)
        page.route("**/api/party/queue", queue_route)
        for pattern in HELD_READS:
            page.route(pattern, read_route)
        page.reload()
        ui(visible(role(page, "button", "Find a match")), UI_WAIT_S, "party view before queueing")
        hold["on"] = True
        role(page, "button", "Find a match").click()
        present(page, [("button", "Cancel search")], "queued")
        hold["on"] = False
        for route in held_reads + party_reads:
            route.continue_()
        page.reload()
        lobby_id = poll(lambda: party_of(me).get("lobbyId"), SEAT_WAIT_S + API_WAIT_S, "party seated")
        present(page, [("region", "Lobby"), ("status", "Seats"), ("list", "Seats"), ("button", "Leave lobby"),
                       ("button", "Leave party")], "lobby")
        axe(page)
        fill_lobby(stack, None, app_url, mail, me, lobby_id)
        present(page, [("timer", "Countdown")], "countdown")
        match_id = match_started(me)
        wait_round(me, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        present(page, [("region", "Match"), ("img", "3D course view"), ("status", "Round"), ("timer", "Round clock"),
                       ("list", "Live standings"), ("button", "Forfeit")], "match")
        axe(page)
        touch = as_player(stack, browser, app_url, mate, "/", viewport=PHONE)
        present(touch, [("group", "Touch controls"), ("group", "Move stick"), ("button", "Jump"), ("button", "Dive")], "touch match")
        role(page, "button", "Forfeit").click()
        present(page, [("alert", "Round result"), ("status", "Spectating"), ("button", "Previous player"),
                       ("button", "Next player")], "spectating")
        advance(page, BANNER_GONE_MS)
        ui(after_motion(page, banner_gone(page)), UI_WAIT_S, "round result banner faded")
        axe(page)
        role(touch, "button", "Forfeit").click()
        wait_finished(me, match_id)
        played = [ROUNDS[r["n"]][1] for r in match_json(me, match_id)["rounds"]]
        present(page, [("region", "Results"), ("heading", f"Cup #{match_id} results"), ("list", "Final standings")]
                + [("link", f"Photo-finish: {name}") for name in played], "results")
        axe(page)


def test_bean_hue_everywhere(app_url, mail, browser):
    viewer = signup(app_url, verify=False)
    handles = ["pip_bounce", "juniper_jolt", "marlo_tumble", "sunny_skid", "otto_wobble", "rue_flop", "kit_kaboom",
               "bea_boing", "nico_noodle", "tamsin_trip", "wren_whoops", "ivo_splat", "lula_leap", "dex_dash",
               "cleo_clatter", "fen_fumble", "late_lark"]
    for index, handle in enumerate(handles, start=1):
        user = viewer.get(f"/api/users/{handle}").json()["user"]
        assert user["id"] == index and user["hue"] == hue_of(index)
    a, b, c = players(app_url, mail, 3)
    form_party(a, [b])
    befriend(a, c)
    assert a.get(f"/api/users/{c.handle}").json()["user"]["hue"] == hue_of(c.id)
    with ExitStack() as stack:
        stack.callback(release, [a, b, c])
        page = as_player(stack, browser, app_url, a, mic=True)
        row = with_attr(role(page, "list", "Friends").get_by_role("listitem"), "data-user-id", c.id)
        ui(visible(row), UI_WAIT_S, "friend row")
        ui(lambda: check_svg_bean(row, hue_of(c.id), "rail bean"), UI_WAIT_S, "rail bean")
        for member in (a, b):
            card = with_attr(role(page, "list", "Party members").get_by_role("listitem"), "data-user-id", member.id)
            ui(visible(card), UI_WAIT_S, "party card row")
            ui(lambda card=card, member=member: check_svg_bean(card, hue_of(member.id), "party card bean"),
               UI_WAIT_S, "party card bean")
            group = with_attr(role(page, "list", "In your party").get_by_role("listitem"), "data-user-id", member.id)
            ui(visible(group), UI_WAIT_S, "rail party row")
            ui(lambda group=group, member=member: check_svg_bean(group, hue_of(member.id), "rail party bean"),
               UI_WAIT_S, "rail party bean")
        assert a.post("/api/party/messages", {"body": "hue check"}).status_code == 201
        chat = role(page, "log", "Party chat")
        ui(visible(chat), UI_WAIT_S, "party chat")
        ui(lambda: check_svg_bean(chat, hue_of(a.id), "chat sender bean"), UI_WAIT_S, "chat sender bean")
        assert c.post(f"/api/dms/{a.id}/messages", {"body": "hue check"}).status_code == 201
        role(page, "tab", re.compile(r"^Messages( \(\d+ unread\))?$")).click()
        role(page, "button", f"Message {c.handle}").click()
        dm_log = role(page, "log", f"Messages with {c.handle}")
        ui(visible(dm_log), UI_WAIT_S, "direct messages")
        ui(lambda: check_svg_bean(dm_log, hue_of(c.id), "direct message sender bean"), UI_WAIT_S, "dm sender bean")
        role(page, "tab", "Party chat").click()
        ui(visible(role(page, "button", "Join voice")), UI_WAIT_S, "join voice")
        role(page, "button", "Join voice").click()
        tile = with_attr(role(page, "list", "Voice").get_by_role("listitem"), "data-user-id", a.id)
        ui(visible(tile), UI_WAIT_S, "own voice tile")
        ui(lambda: check_svg_bean(tile, hue_of(a.id), "voice tile bean"), UI_WAIT_S, "voice tile bean")
        role(page, "button", "Leave voice").click()
        stranger = handles[PROFILE_PROBE_ID - 1]
        page.goto(f"{app_url}/u/{stranger}")
        ui(visible(role(page, "heading", stranger)), UI_WAIT_S, "profile")
        ui(lambda: page.evaluate(PROFILE_BEAN) is not None, UI_WAIT_S, "profile bean outside the rail, dock and lists")
        found = page.evaluate(PROFILE_BEAN)
        assert found["hues"] and set(found["hues"]) == {str(hue_of(PROFILE_PROBE_ID))}, f"profile bean data-hue {found['hues']}"
        shot = page.screenshot(clip=found["box"])
        assert hue_pixels(png_pixels(shot), hue_of(PROFILE_PROBE_ID)) >= BEAN_PIXEL_FLOOR, "profile bean body is not in its hue"
        page.goto(app_url + "/matches/1/rounds/1?tick=0")
        start = frame_json(viewer, 1, 1, 0)
        ui(lambda: lanes_match(page, start) or True, UI_WAIT_S, "lanes")
        for lane in rows(role(page, "list", "Lanes")):
            assert int(lane["hue"]) == hue_of(int(lane["userId"]))
        for uid in (1, 2, 3):
            lane_row = with_attr(role(page, "list", "Lanes").get_by_role("listitem"), "data-user-id", uid)
            ui(lambda lane_row=lane_row, uid=uid: check_svg_bean(lane_row, hue_of(uid), "lane bean"), UI_WAIT_S, "lane bean")
        page.goto(app_url + "/")
        lobby_id = queue_seated(a)["lobbyId"]
        seated = fill_spaced(stack, app_url, mail, a, lobby_id)
        for p in [a, b] + seated[:2]:
            seat = with_attr(role(page, "list", "Seats").get_by_role("listitem"), "data-user-id", p.id)
            ui(visible(seat), UI_WAIT_S, "lobby seat")
            ui(lambda seat=seat, p=p: check_svg_bean(seat, hue_of(p.id), "lobby seat bean"), UI_WAIT_S, "lobby seat bean")
        match_id = match_started(a)
        wait_round(a, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        region = role(page, "region", "Match")
        ui(lambda: int(region.get_attribute("data-tick", timeout=EXPECT_MS) or 0) > 0, UI_WAIT_S, "match ticks")
        ui(lambda: len(standings_rows(page)) == LOBBY_SIZE, UI_WAIT_S, "standings")
        for standing in standings_rows(page):
            assert int(standing["hue"]) == hue_of(int(standing["userId"])), standing
        for p in (a, b):
            live_row = with_attr(role(page, "list", "Live standings").get_by_role("listitem"), "data-user-id", p.id)
            ui(lambda live_row=live_row, p=p: check_svg_bean(live_row, hue_of(p.id), "standings bean"), UI_WAIT_S, "standings bean")
        role(page, "button", "Forfeit").click()


def test_interface_motion(app_url, mail, browser):
    a, b, c = players(app_url, mail, 3)
    form_party(a, [b])
    befriend(a, c)
    befriend(b, c)
    with ExitStack() as stack:
        stack.callback(release, [a, b, c])
        modes = [(as_player(stack, browser, app_url, a), False, a),
                 (as_player(stack, browser, app_url, b, reduced="reduce"), True, b)]
        for page, reduced, _ in modes:
            members = role(page, "list", "Party members")
            ui(lambda members=members: len(rows(members)) == 2, UI_WAIT_S, "party card")
            advance(page, 500)
            check_bob(page, members, reduced)
        for page, _, _ in modes:
            page.evaluate(MOTION_PAUSER)

        presence_rows = []
        for page, reduced, _ in modes:
            row = with_attr(role(page, "list", "Friends").get_by_role("listitem"), "data-user-id", c.id)
            ui(visible(row), UI_WAIT_S, "friend row")
            finish_motion(page)
            presence_rows.append((page, reduced, row, row.element_handle()))
        open_wire(stack, browser, app_url, c)
        for page, reduced, row, handle in presence_rows:
            appear(page, lambda row=row: row.get_attribute("data-presence", timeout=EXPECT_MS) == "online",
                   "online dot", PRESENCE_LAG_S + UI_WAIT_S)
            check_motion(page, handle, reduced, SMALL_MS, "presence dot", must_move=False)

        for page, reduced, _ in modes:
            dock = role(page, "complementary", "Party dock")
            ui(visible(dock), UI_WAIT_S, "dock")
            finish_motion(page)
            handle = dock.element_handle()
            role(page, "button", "Collapse dock").click()
            check_motion(page, handle, reduced, PANEL_MS, "dock collapse", ancestors=True, must_move=False)
            ui(after_motion(page, lambda page=page: role(page, "button", "Expand dock").get_attribute(
                "aria-expanded", timeout=EXPECT_MS) == "false"), UI_WAIT_S, "collapsed")
            role(page, "button", "Expand dock").click()
            ui(after_motion(page, visible(role(page, "button", "Collapse dock"))), UI_WAIT_S, "expanded")

        for page, reduced, _ in modes:
            page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
            opener = role(page, "button", "Friends")
            ui(visible(opener), UI_WAIT_S, "friends button")
            finish_motion(page)
            opener.click()
            dialog = role(page, "dialog", "Friends")
            appear(page, lambda dialog=dialog: dialog.count() > 0, "friends panel")
            check_motion(page, dialog.element_handle(), reduced, PANEL_MS, "friends panel")
            page.keyboard.press("Escape")
            ui(after_motion(page, gone(dialog)), UI_WAIT_S, "panel closed")
            page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})

        lobby_id = queue_seated(a)["lobbyId"]
        seat_lists = []
        for page, _, _ in modes:
            seats = role(page, "list", "Seats")
            ui(lambda seats=seats: {a.id, b.id} <= set(row_ids(seats)), UI_WAIT_S, "party seated")
            finish_motion(page)
            seat_lists.append(seats.element_handle())
        current = len(lobby_json(a, lobby_id)["seats"])
        arrivals = fill_lobby(stack, None, app_url, mail, a, lobby_id, upto=current + 1)
        assert arrivals, "no newcomer reached the lobby"
        newcomer = arrivals[-1][0]
        for (page, reduced, _), handle in zip(modes, seat_lists):
            appear(page, lambda page=page: newcomer.id in row_ids(role(page, "list", "Seats")), "newcomer seated")
            check_motion(page, handle, reduced, LARGE_MS, "seat fill", jitter=BOB_TRAVEL_PX[1])

        fill_lobby(stack, None, app_url, mail, a, lobby_id)
        match_id = match_started(a)
        wait_round(a, match_id, 1, {"running"}, PENDING_S + API_WAIT_S)
        for page, reduced, _ in modes:
            forfeit = role(page, "button", "Forfeit")
            ui(visible(forfeit), UI_WAIT_S, "forfeit button")
            finish_motion(page)
            forfeit.click()
            banner = role(page, "alert", "Round result")
            appear(page, lambda banner=banner: banner.count() > 0, "result banner")
            handle = banner.element_handle()
            shown_at = float(page.evaluate("() => performance.now()"))
            check_motion(page, handle, reduced, SMALL_MS, "result banner")
            spent = float(page.evaluate("() => performance.now()")) - shown_at
            advance(page, max(BANNER_SHOWN_MS - spent, FRAME_MS))
            expect(banner).to_be_visible(timeout=EXPECT_MS)
            advance(page, BANNER_GONE_MS - BANNER_SHOWN_MS)
            ui(after_motion(page, banner_gone(page)), UI_WAIT_S, "banner faded")


def test_feedback_states_account(app_url, mail, browser):
    player = signup(app_url, mail)
    fresh_email, fresh_handle = identity()
    fresh_pw = fresh_password()
    new_pw = fresh_password()
    with ExitStack() as stack:
        page = browse(stack, browser, app_url + "/signin")
        page.get_by_label("Email", exact=True).fill(player.email)
        page.get_by_label("Password", exact=True).fill("Wrong-" + player.password)
        role(page, "button", "Sign in").click()
        ui(sees(notices(page), "Email or password is wrong."), UI_WAIT_S, "bad credentials")
        page.get_by_label("Password", exact=True).fill(player.password)
        check_pending(stack, page, role(page, "button", "Sign in"), "**/api/auth/login", "Signing in…")
        ui(visible(role(page, "button", "Sign out")), UI_WAIT_S, "app shell")

        joining = browse(stack, browser, app_url + "/signup")
        joining.get_by_label("Email", exact=True).fill("not-an-email")
        joining.get_by_label("Handle", exact=True).fill(fresh_handle)
        joining.get_by_label("Password", exact=True).fill(fresh_pw)
        role(joining, "button", "Create account").click()
        ui(sees(notices(joining), "Check the highlighted fields."), UI_WAIT_S, "field notice")
        expect(joining.get_by_label("Email", exact=True)).to_have_accessible_description(
            re.compile(re.escape("Enter a valid email address.")), timeout=UI_WAIT_S * 1000)
        joining.get_by_label("Email", exact=True).fill(fresh_email)
        check_pending(stack, joining, role(joining, "button", "Create account"), "**/api/auth/signup", "Creating account…")
        ui(sees(notices(joining), f"Account created. Check {fresh_email} for your verification link."), UI_WAIT_S,
           "created copy")
        first = new_token(mail, fresh_email, VERIFY_SUBJECT, "verify")
        joining.goto(app_url + "/")
        resend = role(joining, "button", "Resend verification email")
        ui(visible(resend), UI_WAIT_S, "banner")
        check_pending(stack, joining, resend, "**/api/auth/verification/resend", "Sending…")
        ui(sees(notices(joining), f"Verification email sent to {fresh_email}."), UI_WAIT_S, "resent copy")
        token = new_token(mail, fresh_email, VERIFY_SUBJECT, "verify", (first,))
        checking = enter(stack, held(joining, "**/api/auth/verify"))
        joining.goto(f"{app_url}/verify?token={quote(token, safe='')}")
        ui(visible(joining.get_by_text("Checking your link…").first), UI_WAIT_S, "verify pending copy")
        checking.release()
        ui(sees(role(joining, "region", "Verification"), "Email verified. You can add friends and play."),
           UI_WAIT_S, "verified copy")

        forgot = browse(stack, browser, app_url + "/forgot-password")
        forgot.get_by_label("Email", exact=True).fill(player.email)
        check_pending(stack, forgot, role(forgot, "button", "Send reset link"), "**/api/auth/password-reset", "Sending…")
        ui(sees(notices(forgot), "If that email has an account, a reset link is on its way."), UI_WAIT_S, "reset copy")
        reset = new_token(mail, player.email, RESET_SUBJECT, "reset-password")
        forgot.goto(f"{app_url}/reset-password?token={quote(reset, safe='')}")
        new_field = forgot.get_by_label("New password", exact=True)
        new_field.fill("short")
        role(forgot, "button", "Set new password").click()
        ui(sees(notices(forgot), "Check the highlighted fields."), UI_WAIT_S, "password field notice")
        expect(new_field).to_have_accessible_description(re.compile(re.escape("Use 10 to 128 characters.")),
                                                         timeout=UI_WAIT_S * 1000)
        new_field.fill(new_pw)
        check_pending(stack, forgot, role(forgot, "button", "Set new password"), "**/api/auth/password-reset/confirm",
                      "Saving…")
        ui(sees(notices(forgot), "Password changed. Sign in with your new password."), UI_WAIT_S, "changed copy")
    assert login(app_url, player.email, new_pw).status_code == 200
    created = login(app_url, fresh_email, fresh_pw)
    assert created.status_code == 200 and created.json()["user"]["emailVerified"] is True


def test_feedback_states_friends(app_url, mail, browser):
    me, mate, asker, refused, outgoing, blocker, rival, leaving = players(app_url, mail, 8)
    befriend(me, rival)
    befriend(me, leaving)
    assert asker.post("/api/friends/requests", {"handle": me.handle}).status_code == 201
    assert refused.post("/api/friends/requests", {"handle": me.handle}).status_code == 201
    assert me.post("/api/friends/requests", {"handle": outgoing.handle}).status_code == 201
    assert blocker.post("/api/blocks", {"userId": me.id}).status_code == 201
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, me)
        field = role(page, "textbox", "Add friend by handle")
        ui(visible(field), UI_WAIT_S, "rail")
        field.fill(mate.handle)
        check_pending(stack, page, role(page, "button", "Send request"), "**/api/friends/requests", "Sending…")
        ui(sees(notices(page), f"Friend request sent to {mate.handle}."), UI_WAIT_S, "sent copy")
        field.fill(me.handle)
        role(page, "button", "Send request").click()
        ui(sees(notices(page), "Check the highlighted fields."), UI_WAIT_S, "field error notice")
        expect(field).to_have_accessible_description(re.compile(re.escape("You can't add yourself.")), timeout=UI_WAIT_S * 1000)
        for handle, copy in ((rival.handle, f"You're already friends with {rival.handle}."),
                             (blocker.handle, "You can't add this player.")):
            field.fill(handle)
            role(page, "button", "Send request").click()
            ui(sees(notices(page), copy), UI_WAIT_S, copy)
        accept = role(page, "button", f"Accept {asker.handle}")
        ui(visible(accept), UI_WAIT_S, "accept button")
        check_pending(stack, page, accept, "**/api/friends/requests/*/accept")
        ui(sees(notices(page), f"You and {asker.handle} are now friends."), UI_WAIT_S, "accepted copy")
        decline = role(page, "button", f"Decline {refused.handle}")
        ui(visible(decline), UI_WAIT_S, "decline button")
        check_pending(stack, page, decline, "**/api/friends/requests/*/decline")
        ui(sees(notices(page), "Request declined."), UI_WAIT_S, "declined copy")
        withdraw = role(page, "button", f"Withdraw request to {outgoing.handle}")
        ui(visible(withdraw), UI_WAIT_S, "withdraw button")
        check_pending(stack, page, withdraw, "**/api/friends/requests/*")
        ui(sees(notices(page), "Request withdrawn."), UI_WAIT_S, "withdrawn copy")
        page.goto(f"{app_url}/u/{leaving.handle}")
        remove = role(page, "button", f"Remove {leaving.handle} from friends")
        ui(visible(remove), UI_WAIT_S, "remove button")
        check_pending(stack, page, remove, "**/api/friends/*")
        ui(sees(notices(page), f"{leaving.handle} removed from friends."), UI_WAIT_S, "removed copy")
        page.goto(f"{app_url}/u/{rival.handle}")
        block = role(page, "button", f"Block {rival.handle}")
        ui(visible(block), UI_WAIT_S, "block button")
        check_pending(stack, page, block, "**/api/blocks")
        ui(sees(notices(page), f"{rival.handle} is blocked."), UI_WAIT_S, "blocked copy")
        unblock = role(page, "button", f"Unblock {rival.handle}")
        ui(visible(unblock), UI_WAIT_S, "unblock button")
        check_pending(stack, page, unblock, "**/api/blocks/*")
        ui(sees(notices(page), f"{rival.handle} is unblocked."), UI_WAIT_S, "unblocked copy")
    view = friends_of(me)
    assert asker.id in [f["user"]["id"] for f in view["friends"]]
    assert not {leaving.id, rival.id} & {f["user"]["id"] for f in view["friends"]}
    assert all(r["from"]["id"] != refused.id for r in view["incoming"])
    assert all(r["to"]["id"] != outgoing.id for r in view["outgoing"])
    assert any(r["from"]["id"] == me.id for r in friends_of(mate)["incoming"])


def test_feedback_states_party_and_comms(app_url, mail, browser):
    me, mate, shy, host, x1, x2, x3, late = crew = players(app_url, mail, 8)
    befriend(me, mate)
    befriend(me, shy)
    befriend(host, late)
    assert host.post("/api/party/invites", {"userId": late.id}).status_code == 201
    form_party(host, [x1, x2, x3])
    with ExitStack() as stack:
        stack.callback(release, crew)
        page = as_player(stack, browser, app_url, me, mic=True, init=voice_spy(LOUD_GAIN))
        mate_page = as_player(stack, browser, app_url, mate)
        shy_page = as_player(stack, browser, app_url, shy)
        late_page = as_player(stack, browser, app_url, late)
        invite = role(page, "button", f"Invite {mate.handle} to party")
        ui(visible(invite), UI_WAIT_S, "invite button")
        check_pending(stack, page, invite, "**/api/party/invites")
        ui(sees(notices(page), f"Invite sent to {mate.handle}."), UI_WAIT_S, "invite copy")
        join = role(mate_page, "button", f"Join {me.handle}'s party")
        ui(visible(join), INVITE_LAG_S + UI_WAIT_S, "invite shown")
        check_pending(stack, mate_page, join, "**/api/party/invites/*/accept")
        ui(sees(notices(mate_page), f"You joined {me.handle}'s party."), UI_WAIT_S, "joined copy")
        role(page, "button", f"Invite {shy.handle} to party").click()
        ui(sees(notices(page), f"Invite sent to {shy.handle}."), UI_WAIT_S, "second invite copy")
        decline = role(shy_page, "button", f"Decline invite from {me.handle}")
        ui(visible(decline), INVITE_LAG_S + UI_WAIT_S, "decline invite button")
        check_pending(stack, shy_page, decline, "**/api/party/invites/*/decline")
        ui(sees(notices(shy_page), "Invite declined."), UI_WAIT_S, "declined copy")
        full = role(late_page, "button", f"Join {host.handle}'s party")
        ui(visible(full), UI_WAIT_S, "stale invite")
        full.click()
        ui(sees(notices(late_page), "That party is full."), UI_WAIT_S, "full copy")

        check_pending(stack, page, role(page, "button", "Find a match"), "**/api/party/queue", "Finding a match…")
        ui(sees(notices(page), "Seated in a lobby."), SEAT_WAIT_S + UI_WAIT_S, "seated copy")
        leave_lobby = role(page, "button", "Leave lobby")
        ui(visible(leave_lobby), UI_WAIT_S, "leave lobby button")
        check_pending(stack, page, leave_lobby, "**/api/lobby/leave")
        ui(sees(notices(page), "You left the lobby."), UI_WAIT_S, "left lobby copy")

        box = role(page, "textbox", "Message party")
        ui(visible(box), UI_WAIT_S, "chat box")
        box.fill("   ")
        box.press("Enter")
        ui(sees(notices(page), "Check the highlighted fields."), UI_WAIT_S, "chat field notice")
        expect(box).to_have_accessible_description(re.compile(re.escape("Messages are 1 to 500 characters.")),
                                                   timeout=UI_WAIT_S * 1000)
        words = "pending " + secrets.token_hex(4)
        box.fill(words)
        check_pending(stack, page, role(page, "button", "Send").first, "**/api/party/messages")
        ui(sees(role(page, "log", "Party chat"), words), UI_WAIT_S, "message in log")
        for _ in range(RATE_COUNT + 1):
            if me.post("/api/party/messages", {"body": "burst"}).status_code == 429:
                break
        box.fill("one more")
        role(page, "button", "Send").first.click()
        ui(sees(notices(page), "Slow down — you can send again in a few seconds."), RATE_WINDOW_S, "rate copy")

        page.evaluate("() => { window.__deny = true; }")
        role(page, "button", "Join voice").click()
        ui(sees(notices(page), "Microphone blocked. Allow microphone access to talk."), UI_WAIT_S, "mic blocked copy")
        page.evaluate("() => { window.__deny = false; window.__gate = new Promise((r) => { window.__open = r; }); }")
        target = role(page, "button", "Join voice").element_handle(timeout=UI_WAIT_S * 1000)
        target.click()
        ui(lambda: target.evaluate("""el => (el.disabled === true || el.getAttribute('aria-disabled') === 'true')
            && el.getAttribute('aria-busy') === 'true' && (el.textContent || '').includes('Connecting…')"""),
           UI_WAIT_S, "connecting pending state")
        page.evaluate("() => window.__open()")
        ui(sees(notices(page), "You joined voice."), UI_WAIT_S, "joined voice copy")

        hand = role(page, "button", f"Make {mate.handle} leader")
        ui(visible(hand), UI_WAIT_S, "hand-over button")
        check_pending(stack, page, hand, "**/api/party/leader")
        for viewer in (page, mate_page):
            ui(sees(notices(viewer), f"{mate.handle} is now party leader."), UI_WAIT_S, "leader copy")
        leave = role(page, "button", "Leave party")
        ui(visible(leave), UI_WAIT_S, "leave party button")
        check_pending(stack, page, leave, "**/api/party/leave")
        ui(sees(notices(page), "You left the party."), UI_WAIT_S, "left party copy")
    assert member_ids(party_of(me)) == {me.id}
    assert party_of(mate)["leaderId"] == mate.id
    assert member_ids(party_of(late)) == {late.id}


def test_wf_cross_cutting_narrow_shell(app_url, mail, browser):
    a, b = players(app_url, mail, 2)
    words = "phone " + secrets.token_hex(4)
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, a, viewport=PHONE)
        role(page, "button", "Friends").click()
        dialog = role(page, "dialog", "Friends")
        ui(visible(dialog), UI_WAIT_S, "friends panel")
        role(dialog, "textbox", "Add friend by handle").fill(b.handle)
        role(dialog, "button", "Send request").click()
        ui(sees(notices(page), f"Friend request sent to {b.handle}."), UI_WAIT_S, "sent")
        page.keyboard.press("Escape")
        role(page, "button", "Party dock").click()
        dock = role(page, "dialog", "Party dock")
        ui(visible(dock), UI_WAIT_S, "dock panel")
        role(dock, "textbox", "Message party").fill(words)
        role(dock, "button", "Send").first.click()
        ui(sees(role(dock, "log", "Party chat"), words), UI_WAIT_S, "chat")
        layout(page)
    assert any(r["from"]["id"] == a.id for r in friends_of(b)["incoming"])
    assert words in [m["body"] for m in a.get("/api/party/messages").json()["messages"]]


def test_wf_cross_cutting_keyboard_sign_in(app_url, mail, browser):
    player = signup(app_url, mail)
    with ExitStack() as stack:
        page = browse(stack, browser, app_url + "/signin")
        email_field = page.get_by_label("Email", exact=True)
        ui(visible(email_field), UI_WAIT_S, "form")
        email_field.focus()
        page.keyboard.type(player.email)
        page.keyboard.press("Tab")
        page.keyboard.type(player.password)
        page.keyboard.press("Enter")
        ui(visible(role(page, "button", "Sign out")), UI_WAIT_S, "signed in")
        assert page.request.get(app_url + "/api/me").json()["user"]["id"] == player.id


APP = Path("/app")
FONT_EXT = (".woff2", ".woff", ".ttf", ".otf")


def shipped_packages() -> list[tuple[str, str, str]]:
    deployed = Path(str(_helper("DEPLOYED_APP")))
    lock_path = APP / "package-lock.json" if (APP / "package-lock.json").exists() else deployed / "package-lock.json"
    lock = json.loads(lock_path.read_text())
    shipped = []
    for key, entry in lock.get("packages", {}).items():
        if not key or entry.get("dev") or entry.get("link"):
            continue
        if entry.get("optional") and not any((root / key).is_dir() for root in (deployed, APP)):
            continue
        licence = entry.get("license")
        for root in (deployed, APP):
            manifest = root / key / "package.json"
            if not licence and manifest.exists():
                licence = json.loads(manifest.read_text()).get("license")
        if isinstance(licence, dict):
            licence = licence.get("type")
        shipped.append((key.split("node_modules/")[-1], entry.get("version", ""), str(licence or "")))
    return shipped


def notice_entries(text: str) -> list[tuple[str, str, str]]:
    items: list[tuple[int, list[str]]] = []
    sections: list[list[str]] = [[]]
    for line in text.splitlines():
        heading = line.lstrip().startswith("#")
        if heading:
            sections.append([])
        nested = bool(items and items[-1][1] and re.match(r"[ \t]+\S", line))
        if heading or not line.strip() or (re.match(r"([-*+] |\d+[.)] |\|)", line) and not nested) or not items:
            items.append((len(sections) - 1, []))
        if line.strip():
            items[-1][1].append(line)
            sections[-1].append(line)
    return [("\n".join(lines), sections[at][0] if sections[at] else "", "\n".join(sections[at]))
            for at, lines in items if lines]


def noted(entries: list[tuple[str, str, str]], names: Callable[[str], bool]) -> list[str]:
    return [entry for entry, _, _ in entries if names(entry)] + \
           list(dict.fromkeys(section for _, heading, section in entries if names(heading)))


TEST_PARTS = {"test", "tests", "__tests__", "e2e", "scripts"}


def app_files(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    found = []
    for path in root.rglob("*"):
        if "node_modules" in path.parts or ".git" in path.parts:
            continue
        if path.is_file() and path.suffix.lower() in suffixes:
            found.append(path)
    return found


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices(app_url, browser):
    notices_text = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    entries = notice_entries(notices_text)
    missing = []
    for name, version, licence in shipped_packages():
        named = re.compile(rf"(?<![\w@/-]){re.escape(name)}(?![\w/-])")
        forms = {licence, licence.replace("(", "").replace(")", "")}
        if not any(version in e and (any(f in e for f in forms) if licence else True)
                   for e in noted(entries, lambda text: bool(named.search(text)))):
            missing.append(f"{name}@{version} ({licence or 'no licence found'})")
    assert not missing, f"packages missing name, version or licence in notices: {missing[:20]}"
    roots = [APP, Path(str(_helper("DEPLOYED_APP")))]
    fonts = {p.name for root in roots if root.exists() for p in app_files(root, FONT_EXT)}
    unlisted = []
    for font in sorted(fonts):
        stems = {font, re.sub(r"[-.][A-Za-z0-9_]{6,}(?=\.)", "", font), re.sub(r"[-.][A-Za-z0-9_-]{8}(?=\.\w+$)", "", font)}
        hits = noted(entries, lambda text: any(stem in text for stem in stems))
        squashed = re.sub(r"[^a-z0-9]", "", font.lower())
        named = [f for f in FAMILIES if re.sub(r"[^a-z0-9]", "", f.lower()) in squashed]
        if not any(FONT_LICENCE_NAMED.search(l) and all(f.lower() in l.lower() for f in named) for l in hits):
            unlisted.append(font)
    assert not unlisted, f"fonts missing a file and family line in notices: {unlisted}"
    with ExitStack() as stack:
        root = clone_deployed(stack)
        pruned = subprocess.run("npm prune --omit=dev --offline --no-audit --no-fund", shell=True, cwd=str(root),
                                capture_output=True, text=True, timeout=BOOT_WAIT_S)
        assert pruned.returncode == 0, pruned.stdout[-2000:] + pruned.stderr[-2000:]
        base = start_copy(stack, 0, root)
        health = request(base, "GET", "/api/health")
        assert health.status_code == 200 and health.json() == {"status": "ok"}
        for path in ("/", "/signin", f"/u/{PIP}", "/matches/1/rounds/1"):
            served = request(base, "GET", path)
            assert served.status_code == 200 and HTML_MEDIA in served.headers.get("content-type", ""), path
            for asset in re.findall(r'(?:src|href)="(/[^"]+)"', served.text):
                assert request(base, "GET", asset).status_code == 200, asset
        pruned_pip, main_pip = seeded(base, PIP), seeded(app_url, PIP)
        for rnd in match_json(main_pip, 1)["rounds"]:
            assert frame_json(pruned_pip, 1, rnd["n"], rnd["lastTick"])["beans"] == \
                   frame_json(main_pip, 1, rnd["n"], rnd["lastTick"])["beans"]
        anon = browse(stack, browser, base + "/signin")
        ui(visible(role(anon, "button", "Sign in")), UI_WAIT_S, "pruned sign-in page")
        replay = as_player(stack, browser, base, pruned_pip, "/matches/1/rounds/1")
        ui(visible(role(replay, "slider", "Playhead")), UI_WAIT_S, "pruned photo-finish")
        ui(visible(role(replay, "list", "Lanes")), UI_WAIT_S, "pruned lane list")


def test_if_licence_allowlists():
    bad = []
    for name, version, licence in shipped_packages():
        expression = licence.replace("(", "").replace(")", "")
        options = [opt.split(" AND ") for opt in expression.split(" OR ")]
        if not any(all(term.strip() in LICENCES for term in option) for option in options):
            bad.append(f"{name}@{version}: {licence}")
    assert not bad, f"licences outside the allowlist: {bad}"
    notices_text = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    font_named = lambda text: "font" in text.lower() or any(ext in text.lower() for ext in FONT_EXT) or \
        any(f.lower() in text.lower() for f in FAMILIES)
    unlicensed = [entry for entry, heading, section in notice_entries(notices_text)
                  if any(ext in entry.lower() for ext in FONT_EXT) and not FONT_LICENCE_NAMED.search(entry)
                  and not (font_named(heading) and FONT_LICENCE_NAMED.search(section))]
    assert not unlicensed, unlicensed


def test_if_postgres_only_datastore(app_url, mail):
    assert _helper("Postgres")().tables(), "no tables in PostgreSQL"
    deployed = Path(str(_helper("DEPLOYED_APP")))
    file_dbs = []
    for root in (APP, deployed):
        for folder, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in {"node_modules", ".git"}]
            for name in files:
                path = Path(folder) / name
                try:
                    with open(path, "rb") as handle:
                        if handle.read(16) == b"SQLite format 3\x00":
                            file_dbs.append(str(path))
                except OSError:
                    continue
    assert not file_dbs, file_dbs
    daemons = ("redis-server", "mongod", "mysqld", "mariadbd", "memcached", "minio", "valkey-server")
    running = []
    for cmdline in Path("/proc").glob("[0-9]*/cmdline"):
        try:
            words = cmdline.read_bytes().replace(b"\0", b" ").decode(errors="ignore").split()
        except OSError:
            continue
        if words and Path(words[0]).name in daemons:
            running.append(words[0])
    assert not running, running
    with ExitStack() as stack:
        copy = start_copy(stack, 0, clone_deployed(stack))
        a, b = players(app_url, mail, 2)
        befriend(a, b)
        words = "kept " + secrets.token_hex(4)
        assert a.post(f"/api/dms/{b.id}/messages", {"body": words}).status_code == 201
        assert stored_anywhere(words) > 0 and stored_anywhere(a.email) > 0
        back = login(copy, a.email, a.password)
        assert back.status_code == 200, back.text
        cookie = session_cookie(back)
        history = request(copy, "GET", f"/api/dms/{b.id}/messages", cookie=cookie)
        assert words in [m["body"] for m in history.json()["messages"]]
        for rnd in match_json(a, 1)["rounds"]:
            there = request(copy, "GET", f"/api/matches/1/rounds/{rnd['n']}/frames?tick={rnd['lastTick']}", cookie=cookie)
            assert there.status_code == 200 and there.json()["beans"] == frame_json(a, 1, rnd["n"], rnd["lastTick"])["beans"]
    package = json.loads((APP / "package.json").read_text())
    deps = set(package.get("dependencies", {})) | set(package.get("optionalDependencies", {}))
    forbidden = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "mysql", "mysql2", "lowdb",
                 "level", "nedb", "lokijs", "keyv", "memcached", "minio", "@aws-sdk/client-s3"}
    assert not deps & forbidden, deps & forbidden
    assert not app_files(APP, (".mp4", ".webm", ".mkv", ".avi", ".sqlite", ".sqlite3", ".db"))


def test_if_self_hosted_and_no_stun(app_url, browser, mail, monkeypatch):
    viewer = signup(app_url, verify=False)
    with ExitStack() as stack:
        page = as_player(stack, browser, app_url, viewer, "/signin")
        foreign: list[str] = []
        page.on("request", lambda r: foreign.append(r.url)
                if not (r.url.startswith(("data:", "blob:")) or same_origin(r.url, app_url)) else None)
        for path in ("/", "/u/pip_bounce", "/matches/1/rounds/1"):
            page.goto(app_url + path)
            ui(lambda: notices(page).count() > 0, UI_WAIT_S, path)
            advance(page, 2000)
        assert not foreign, foreign
    log = Path(tempfile.mkdtemp(prefix="pc-net-")) / "hosts.log"
    monkeypatch.setenv(NET_LOG_ENV, str(log))
    with ExitStack() as stack:
        base = start_copy(stack, 0)
        newcomer = signup(base, mail)
        request(base, "POST", "/api/auth/password-reset", {"email": newcomer.email})
        for path in ("/", "/signin", "/u/pip_bounce", "/matches/1/rounds/1", "/api/health"):
            request(base, "GET", path)
        frame_json(seeded(base, PIP), 1, 1, 0)
    hosts = set(log.read_text().split()) if log.exists() else set()
    allowed = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "unix-socket"}
    for name in (urlsplit(os.environ.get("DATABASE_URL", "")).hostname, os.environ.get("PGHOST"),
                 os.environ.get("SMTP_HOST"), urlsplit(os.environ.get("MAILPIT_URL", "")).hostname):
        if name:
            allowed.add(name)
            with contextlib.suppress(OSError):
                allowed |= {info[4][0] for info in socket.getaddrinfo(name, None)}
    assert hosts, "the app copy opened no outbound connection, not even to PostgreSQL"
    assert hosts <= allowed, f"the server contacted hosts beyond its configured services: {sorted(hosts - allowed)}"
    deployed = Path(str(_helper("DEPLOYED_APP")))
    for path in app_files(deployed, (".js", ".mjs", ".cjs", ".ts", ".html")):
        assert not re.search(r"\b(stun|turns?):[A-Za-z0-9.\-]+", path.read_text(errors="ignore")), path


OUT_SETTING = re.compile(
    r"""\boutDir\s*[:=]\s*['"]([^'"]+)['"]|--out-?[dD]ir[= ]+['"]?([^\s'"]+)|--outfile[= ]+['"]?([^\s'"]+)""")


DEFAULT_OUT = {"vite": "dist", "webpack": "dist", "parcel": "dist"}
ROOT_SETTING = re.compile(r"""\broot\s*:\s*['"]([^'"]+)['"]""")
TS_EXT = (".ts", ".tsx", ".mts", ".cts")


def build_outputs(root: Path, compiler_outs: set[Path]) -> tuple[set[Path], set[Path]]:
    folders, files = set(compiler_outs), set()
    manifest = root / "package.json"
    scripts = [str(v) for v in json.loads(manifest.read_text()).get("scripts", {}).values()] if manifest.exists() else []
    configs = [(root / name).read_text(errors="ignore") for name in os.listdir(root)
               if re.search(r"\.config\.[cm]?[jt]s$", name)]
    for text in scripts + configs:
        for match in OUT_SETTING.finditer(text):
            folder, file = match.group(1) or match.group(2), match.group(3)
            if folder:
                folders.add((root / folder).resolve())
            if file:
                files.add((root / file).resolve())
    for tool, folder in DEFAULT_OUT.items():
        if any(re.search(rf"\b{tool}\b", text) for text in scripts):
            folders.add((root / folder).resolve())
            for text in configs:
                for match in ROOT_SETTING.finditer(text):
                    folders.add((root / match.group(1) / folder).resolve())
    return folders, files


def walk_code(root: Path, suffixes: tuple[str, ...], folders: set[Path], files: set[Path]) -> list[Path]:
    found = []
    for folder, dirs, names in os.walk(root):
        here = Path(folder)
        dirs[:] = [d for d in dirs if d not in {"node_modules", ".git", "coverage"}
                   and (here / d).resolve() not in folders]
        if set(here.relative_to(root).parts) & TEST_PARTS:
            continue
        for name in names:
            path = here / name
            if (name.endswith(suffixes) and not re.search(r"\.d\.[cm]?ts$", name)
                    and not re.search(r"\.(config|test|spec)\.", name) and path.resolve() not in files):
                found.append(path)
    return found


def compiled(path: Path) -> bool:
    if any(path.with_suffix(ext).exists() for ext in (".ts", ".tsx", ".mts", ".cts")):
        return True
    return "sourceMappingURL=" in path.read_text(errors="ignore")[-2000:]


def test_if_strict_typescript():
    deployed = Path(str(_helper("DEPLOYED_APP"))).resolve()
    app_root = APP.resolve()
    tsc = deployed / "node_modules" / ".bin" / "tsc"
    assert tsc.exists(), "typescript is not installed for the build"
    configs: list[Path] = []
    for folder, dirs, names in os.walk(deployed):
        dirs[:] = [d for d in dirs if d not in {"node_modules", ".git"}]
        configs += [Path(folder) / n for n in names if re.fullmatch(r"tsconfig(?:\.[\w-]+)?\.json", n)]
    assert configs, "no tsconfig project"
    covered: set[Path] = set()
    outs: set[Path] = set()
    strict: list[tuple[Path, set[Path]]] = []
    for config in configs:
        shown = subprocess.run([str(tsc), "-p", str(config), "--showConfig"], cwd=str(config.parent),
                               capture_output=True, text=True, timeout=BOOT_WAIT_S)
        if shown.returncode != 0:
            continue
        resolved = json.loads(shown.stdout)
        options = resolved.get("compilerOptions", {})
        for key in ("outDir", "declarationDir"):
            if isinstance(options.get(key), str):
                outs.add((config.parent / options[key]).resolve())
        files = {(config.parent / f).resolve() for f in resolved.get("files", [])}
        if files and options.get("strict") is True:
            covered |= files
            strict.append((config, files))
    folders, generated = build_outputs(deployed, outs)
    sources = {p.resolve() for p in walk_code(deployed, TS_EXT, folders, generated)}
    assert sources, "no TypeScript source"
    uncovered = sorted(str(p.relative_to(deployed)) for p in sources if p not in covered)
    assert not uncovered, f"TypeScript outside every strict project: {uncovered[:20]}"

    mirrored = {app_root / o.relative_to(deployed) for o in outs if o.is_relative_to(deployed)}
    app_folders, app_generated = build_outputs(app_root, mirrored)
    plain = [p for p in walk_code(app_root, (".js", ".jsx", ".mjs", ".cjs"), app_folders, app_generated)
             if not compiled(p)]
    assert not plain, f"JavaScript source files: {[str(p) for p in plain[:20]]}"

    with ExitStack() as stack:
        clone = clone_deployed(stack).resolve()
        clone_tsc = clone / "node_modules" / ".bin" / "tsc"
        failures = []
        for config, files in strict:
            if not files & sources:
                continue
            target = clone / config.relative_to(deployed)
            run = subprocess.run([str(clone_tsc), "-p", str(target), "--pretty", "false"], cwd=str(target.parent),
                                 capture_output=True, text=True, timeout=BOOT_WAIT_S)
            if run.returncode != 0:
                failures.append(f"{config.relative_to(deployed)} exited {run.returncode}: "
                                f"{(run.stdout + run.stderr)[-1500:]}")
        assert not failures, f"production TypeScript projects fail to compile: {failures}"


def test_if_service_config_untouched(app_url):
    assert _helper("Postgres")().tables(), "the provided PostgreSQL no longer accepts the provided credentials"
    assert isinstance(_helper("Mailpit")().messages(), list), "the provided Mailpit no longer answers"
    health = request(app_url, "GET", "/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}

