from __future__ import annotations

import concurrent.futures
import contextlib
import csv
import dataclasses
import hashlib
import html.parser
import http.client
import io
import json
import os
import random
import re
import signal
import socket
import statistics
import subprocess
import tempfile
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    DEPLOYED_APP,
    Postgres,
    advance,
    axe,
    capture,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    same_origin,
    select,
    session,
    state_styles,
    unique,
)


PASSWORD = "deku-demo-pw-2026"
ORGANISER_EMAIL = "organiser@example.com"
SEEDED_ACCOUNTS = {
    "organiser@example.com": ("Outpost Organiser", "organiser"),
    "attendee@example.com": ("Avery Stone", "attendee"),
    "attendee2@example.com": ("Rowan Pike", "attendee"),
    "attendee3@example.com": ("Quinn Hale", "attendee"),
}
VENUE = ZoneInfo("America/Halifax")
UTC = timezone.utc
DAY_DATES = {1: (2026, 10, 31), 2: (2026, 11, 1)}
DAY_DATE_TEXT = {1: "2026-10-31", 2: "2026-11-01"}
VENUE_LINES = {
    1: "All times are Port Ashby time (ADT, UTC−3).",
    2: "All times are Port Ashby time (AST, UTC−4).",
}
DAY_TABS = {1: "Day 1 - Sat, Oct 31", 2: "Day 2 - Sun, Nov 1"}
SUNSET = "Sat, 31 Oct 2026 16:00:00 GMT"
DEFAULT_CLOSES_AT = "2026-10-31T16:00:00Z"

LONG_HOLD_SECONDS = 900
SHORT_HOLD_SECONDS = 2
BODY_LIMIT_BYTES = 10240
SEARCH_MAX_CHARS = 2048
BIO_MAX_CHARS = 2000
NAME_MAX_CHARS = 80
PASSWORD_MAX_CHARS = 200
PASSWORD_MIN_CHARS = 8
GUESS_MAX = 100000000
CAPACITY_MAX = 500
ROSTER_LIMIT_MAX = 100
THROTTLE_FAILURES = 5
THROTTLE_DEFAULT_WINDOW_S = 900
TIMING_SAMPLES = 7
SEARCH_BUDGET_S = 0.5
TRANSPORT_MARGIN_S = 0.1
W1_PARENS = 1000
W2_REPEATS = 400
W3_BACKSLASHES = 2047
ICS_LINE_OCTETS = 75
LIVE_REFRESH_MS = 5000
RESTORE_MS = 2000
SCROLL_TOLERANCE_PX = 50
TARGET_MIN_PX = 44
RECOVERY_S = 30
ROSTER_JOURNEY_RESERVED = 52
FILTER_MOTION_MAX_MS = 350
MENU_MOTION_MAX_MS = 334
STILL_DIFF = 0.15
PIXEL_NOISE = 0.05
VIEWPORTS = [(320, 812), (375, 812), (768, 1024), (1280, 800)]

JSON_TYPE = "application/json; charset=utf-8"
NAV_LINKS = ["Overview", "Experiences", "TPS Record", "Agenda", "Speakers", "Sponsors"]
BANNER_LINK = "Keel Outpost starts this week. Final seats →"
STATEMENT = "The next $5 trillion in transactions won't be human."

FIELD_COPY = {
    "name": "Enter a name of 1 to 80 characters.",
    "email": "Enter a valid email address.",
    "password": "Use at least 8 characters.",
    "signin_password": "Enter your password.",
    "guess": "Enter a whole number from 1 to 100,000,000.",
    "capacity": "Enter a whole number from 1 to 500.",
    "bio": "Use at most 2,000 characters.",
    "search": "Use at most 2,048 characters.",
    "limit": "Enter a whole number from 1 to 100.",
    "cursor": "Start again from the first page.",
}

STAGES = {
    "summit-stage": ("Summit Stage", "Keynotes and product reveals from industry leading voices"),
    "signal-stage": ("Signal Stage", "Demos, AMAs, and in-depth convos with ecosystem builders"),
    "ai-builder-lab": ("AI Builder Lab", "Hands-on AI workshops to learn, apply, and build something real"),
    "the-arena": ("The Arena", "Showcasing the latest DeFi developments and breakthroughs"),
}
STAGE_ORDER = list(STAGES)
FORMATS = {"demo-qa": "Demo + Q&A", "fireside": "Fireside", "game": "Game", "keynote": "Keynote",
           "panel": "Panel", "workshop": "Workshop"}


@dataclasses.dataclass(frozen=True)
class Seed:
    id: str
    day: int
    start: str
    end: str
    title: str
    speakers: tuple
    stage: str | None
    location: str | None
    format: str | None
    capacity: int | None


SEED = [Seed(*row) for row in [
    ("d1-book-signing", 1, "10:00", "11:00", "The Long Ledger: Book Signing", (("Inès Okafor", "Northgate Press"),), None, "Foyer", None, None),
    ("d1-doors-open", 1, "11:00", "11:00", "Doors Open: Come Early to Get First Dibs on Doorbusters", (), None, "Lobby", None, None),
    ("d1-campus-to-protocol", 1, "11:00", "11:30", "From Campus to Protocol: How to Get Hired in Open Finance", (("Mara Velasquez", "Tidewater Labs"), ("Theo Brandt", "Student Ledger Society")), "ai-builder-lab", None, "panel", None),
    ("d1-clone-your-writing-voice", 1, "11:30", "12:00", "Clone Your Writing Voice", (("Ravi Menon", "Keel Foundation"),), "ai-builder-lab", None, "workshop", 2),
    ("d1-chat-to-trade", 1, "11:30", "12:00", "From Chat Prompt to Live Trade: An Agent in Real Time", (("Lena Hart", "Quayside"),), "signal-stage", None, "demo-qa", None),
    ("d1-hottest-takes", 1, "11:30", "12:45", "Trading Competition: Battle of the Hottest Takes", (("Sam Ortiz", "Lantern"),), "the-arena", None, "game", 40),
    ("d1-zero-to-funded", 1, "12:00", "12:30", "From Zero to Funded Agent in Minutes", (("Pavel Ivanov", "Quayside"),), "ai-builder-lab", None, "workshop", 30),
    ("d1-welcome", 1, "13:00", "13:05", "Welcome to Keel Outpost 2026", (("Jo Kimura", "Keel Outpost"),), "summit-stage", None, None, None),
    ("d1-machine-economy", 1, "13:05", "13:30", "The Machine Economy Won't Wait", (("Dana Whitfield", "Tidewater Labs"),), "summit-stage", None, "keynote", None),
    ("d1-who-writes-rules", 1, "15:10", "15:35", "Who Writes the Rules?", (("Omar Haddad", "Harbor Group"), ("Clare Dunn", "Tidewater Labs")), "summit-stage", None, "fireside", None),
    ("d1-never-forgets", 1, "15:30", "16:30", "Build an Agent That Never Forgets", (("Mara Velasquez", "Tidewater Labs"),), "ai-builder-lab", None, "workshop", 30),
    ("d1-happy-hour", 1, "17:00", "19:00", "Community Happy Hour", (), None, "Community Avenue", None, None),
    ("d2-agent-wallet", 2, "11:00", "11:30", "Craft Your Own Agent Wallet", (("Bea Arnaud", "Café Arcfold"),), "ai-builder-lab", None, "workshop", 30),
    ("d2-llm-showdown", 2, "11:30", "12:00", "An LLM Showdown: Predict the Winner", (("Dan Loh", "Tidewater Labs"),), "the-arena", None, "game", 40),
    ("d2-music-app", 2, "11:30", "12:30", "Spin Up Your Own Music App", (("Ben Li", "Reedwork"),), "ai-builder-lab", None, "workshop", 30),
    ("d2-quality-factor", 2, "12:00", "12:25", "Beyond Market Cap: A Quality Factor for Digital Assets", (("Jamie Cole", "Longview Research"),), "the-arena", None, "keynote", None),
    ("d2-future-intelligence", 2, "13:05", "13:25", "The Future of Intelligence", (("Ruth Sato", "Recurse"), ("Kevin Bloom", "Tidewater Labs")), "summit-stage", None, "fireside", None),
    ("d2-growing-ecosystem", 2, "13:55", "14:15", "Growing the Builder Ecosystem", (("Ivo Lind", "Comma Ventures"), ("Jamal Khan", "Keel Foundation")), "summit-stage", None, "fireside", None),
]]
BY_ID = {s.id: s for s in SEED}


def _stage_rank(s: Seed) -> int:
    return STAGE_ORDER.index(s.stage) if s.stage else len(STAGE_ORDER)


AGENDA_ORDER = [s.id for s in sorted(SEED, key=lambda s: (s.day, s.start, _stage_rank(s), s.id))]
DAY_IDS = {d: [i for i in AGENDA_ORDER if BY_ID[i].day == d] for d in (1, 2)}
RESERVABLE = [s.id for s in SEED if s.capacity is not None]

CLONE, CLONE_T = "d1-clone-your-writing-voice", "Clone Your Writing Voice"
HOTTEST, HOTTEST_T = "d1-hottest-takes", "Trading Competition: Battle of the Hottest Takes"
ZERO, ZERO_T = "d1-zero-to-funded", "From Zero to Funded Agent in Minutes"
NEVER, NEVER_T = "d1-never-forgets", "Build an Agent That Never Forgets"
WALLET, WALLET_T = "d2-agent-wallet", "Craft Your Own Agent Wallet"
LLM, LLM_T = "d2-llm-showdown", "An LLM Showdown: Predict the Winner"
MUSIC, MUSIC_T = "d2-music-app", "Spin Up Your Own Music App"
WELCOME = "d1-welcome"

V1_MANIFEST = """object account id,name,email,role
object auth token,account
object cancelled seats_left
object error error,message
object guess value,created_at
object guess_created guess
object leader rank,display_name,value,distance
object my_agenda reserved,waitlisted,saved
object organiser_row id,title,day,starts_at,ends_at,capacity,reserved,seats_left,waitlisted
object record status,closes_at,guess_count,my_guess,final_figure,revealed_at,leaderboard
object reservation id,session_id,created_at
object reservation_created reservation,seats_left
object reveal status,final_figure,revealed_at,leaderboard
object roster_row name,email,reserved_at
object saved saved
object session id,day,date,starts_at,ends_at,starts_at_utc,ends_at_utc,title,speakers,stage,stage_name,location,format,format_label,description,capacity,seats_left,waitlist_count,reserved_by_me,saved_by_me,waitlist_position
object signed_out signed_out
object speaker name,company,sessions
object speaker_ref name,company
object stage slug,name,description
object waitlist session_id,position,created_at
object waitlist_joined waitlist
object waitlist_left waitlisted
route DELETE /sessions/{id}/reservation
route DELETE /sessions/{id}/save
route DELETE /sessions/{id}/waitlist
route GET /agenda.ics
route GET /me
route GET /me/agenda
route GET /organiser/sessions
route GET /organiser/sessions/{id}/roster
route GET /organiser/sessions/{id}/roster.csv
route GET /record
route GET /sessions
route GET /sessions/{id}
route GET /speakers
route GET /stages
route PATCH /organiser/sessions/{id}
route POST /auth/login
route POST /auth/logout
route POST /auth/signup
route POST /organiser/record/reveal
route POST /record/guesses
route POST /sessions/{id}/reservation
route POST /sessions/{id}/waitlist
route PUT /sessions/{id}/save
"""

V2_MANIFEST = """object account id,name,email,role
object auth token,account
object cancelled seats
object error error
object error_detail code,message
object guess value,created_at
object guess_created guess
object hold session_id,held_until,seconds_remaining
object leader rank,display_name,value,distance
object my_agenda reserved,held,waitlisted,saved
object organiser_row id,title,day,start_local,end_local,seats,waitlisted
object record status,closes_at,guess_count,my_guess,final_figure,revealed_at,leaderboard
object released held
object reservation id,session_id,created_at
object reservation_created reservation,seats
object reveal status,final_figure,revealed_at,leaderboard
object roster_row name,email,reserved_at
object saved saved
object seats capacity,reserved,held,left
object session id,day,date,start_local,end_local,start_instant,end_instant,title,speakers,stage,stage_name,location,format,format_label,description,seats,waitlist_count,reserved_by_me,saved_by_me,waitlist_position,my_hold
object signed_out signed_out
object speaker slug,name,company,sessions,bio,bio_html
object speaker_ref name,company
object stage slug,name,description
object waitlist session_id,position,created_at
object waitlist_joined waitlist
object waitlist_left waitlisted
route DELETE /sessions/{id}/hold
route DELETE /sessions/{id}/reservation
route DELETE /sessions/{id}/save
route DELETE /sessions/{id}/waitlist
route GET /agenda.ics
route GET /me
route GET /me/agenda
route GET /me/holds
route GET /organiser/sessions
route GET /organiser/sessions/{id}/roster
route GET /organiser/sessions/{id}/roster.csv
route GET /record
route GET /sessions
route GET /sessions/{id}
route GET /speakers
route GET /stages
route PATCH /organiser/sessions/{id}
route POST /auth/login
route POST /auth/logout
route POST /auth/signup
route POST /organiser/record/reveal
route POST /record/guesses
route POST /sessions/{id}/claim
route POST /sessions/{id}/reservation
route POST /sessions/{id}/waitlist
route PUT /organiser/speakers/{slug}/bio
route PUT /sessions/{id}/save
"""


def _objects(manifest: str) -> dict[str, list[str]]:
    out = {}
    for line in manifest.splitlines():
        kind, name, *rest = line.split(" ")
        if kind == "object":
            out[name] = rest[0].split(",")
    return out


V1_OBJECTS = _objects(V1_MANIFEST)
V2_OBJECTS = _objects(V2_MANIFEST)
V2_ONLY_KEYS = {k for keys in V2_OBJECTS.values() for k in keys} - {k for keys in V1_OBJECTS.values() for k in keys}


HTTP_TIMEOUT_S = 60.0
BOOT_S = 120.0
STOP_S = 15.0
POLL_S = 0.25
DB_WAIT_S = 90.0
UI_WAIT_S = 25.0
UI_STEP_MS = 100
CUTOFF_LEAD_S = 60
CONTEST_OPEN_DAYS = 2
MAX_ROSTER_PAGES = 20
POSTGRES_PORT = 5432
RELAY_CHUNK = 65536
HOLD_AT_TOLERANCE_S = 1.0

NEW_PASSWORD = "harbour-quay-pass"
WRONG_PASSWORD = "not-the-right-one"
BROWSER_ZONE = "Asia/Tokyo"
UNKNOWN_SESSION = "no-such-session"
UNKNOWN_PAGE = "/no-such-page"
UNKNOWN_ROUTE = "/nope"
BAD_ENCODING = "/api/v2/sessions/%E0%A4%A"
BAD_EMAIL = "not-an-email"
SHORT_PASSWORD = "short"

HTTP = httpx.Client(timeout=HTTP_TIMEOUT_S)
ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
_NONE = object()
_PG: list[Any] = []
_TOKENS: dict[str, str] = {}


def pg() -> Any:
    if not _PG:
        _PG.append(Postgres())
    return _PG[0]


@dataclasses.dataclass
class Person:
    name: str
    email: str
    token: str
    id: Any


@dataclasses.dataclass
class RawResp:
    status_code: int
    headers: httpx.Headers
    content: bytes

    def json(self) -> Any:
        return json.loads(self.content)

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", "replace")


def names(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    return (b, a) if "@" in a else (a, b)


def send(base: str, method: str, path: str, token: str | None = None, body: Any = _NONE,
         headers: dict[str, str] | None = None, client: httpx.Client | None = None) -> httpx.Response:
    h = dict(headers or {})
    if token:
        h["Authorization"] = "Bearer " + token
    kwargs: dict[str, Any] = {}
    if body is not _NONE:
        kwargs["content"] = json.dumps(body, ensure_ascii=False).encode()
        h.setdefault("Content-Type", "application/json")
    return (client or HTTP).request(method, base + path, headers=h, **kwargs)


def get(base: str, path: str, token: str | None = None, **kw: Any) -> httpx.Response:
    return send(base, "GET", path, token, **kw)


def raw(base: str, method: str, target: str, headers: dict[str, str] | None = None, body: bytes | None = None) -> RawResp:
    u = urlparse(base)
    conn = http.client.HTTPConnection(u.hostname, u.port, timeout=HTTP_TIMEOUT_S)
    try:
        conn.request(method, target, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        return RawResp(resp.status, httpx.Headers(resp.getheaders()), data)
    finally:
        conn.close()


def media_type(r: Any) -> str:
    parts = [p.strip() for p in (r.headers.get("Content-Type") or "").lower().split(";")]
    return "; ".join(p for p in parts if p)


def is_json(r: Any) -> bool:
    return media_type(r) == JSON_TYPE


def v2_error(r: Any, status: int, code: str) -> dict:
    assert r.status_code == status, (r.status_code, r.text)
    assert is_json(r), r.headers.get("content-type")
    body = r.json()
    assert set(body) == {"error"} and isinstance(body["error"], dict), body
    assert body["error"]["code"] == code, body
    assert isinstance(body["error"]["message"], str) and body["error"]["message"], body
    assert set(body["error"]) <= {"code", "message", "fields", "conflicts_with", "reserved"}, body
    return body["error"]


def v1_error(r: Any, status: int, code: str) -> dict:
    assert r.status_code == status, (r.status_code, r.text)
    assert is_json(r), r.headers.get("content-type")
    body = r.json()
    assert body.get("error") == code, body
    assert isinstance(body.get("message"), str) and body["message"], body
    assert set(body) <= {"error", "message", "fields", "conflicts_with", "reserved"}, body
    return body


def error_of(r: Any, version: str, status: int, code: str) -> dict:
    return v2_error(r, status, code) if version == "v2" else v1_error(r, status, code)


def signup(base: str, prefix: str = "attendee", name: str | None = None) -> Person:
    generated, email = names(prefix)
    r = send(base, "POST", "/api/v2/auth/signup",
             body={"name": name if name is not None else generated, "email": email, "password": NEW_PASSWORD})
    assert r.status_code == 201, r.text
    data = r.json()
    return Person(data["account"]["name"], data["account"]["email"], data["token"], data["account"]["id"])


def login(base: str, email: str, password: str, version: str = "v2", client: httpx.Client | None = None) -> httpx.Response:
    return send(base, "POST", f"/api/{version}/auth/login", body={"email": email, "password": password}, client=client)


def organiser(base: str) -> str:
    if "org" not in _TOKENS:
        r = login(base, ORGANISER_EMAIL, PASSWORD)
        assert r.status_code == 200, r.text
        _TOKENS["org"] = r.json()["token"]
    return _TOKENS["org"]


def sess(base: str, sid: str, token: str | None = None, version: str = "v2") -> dict:
    r = get(base, f"/api/{version}/sessions/{sid}", token)
    assert r.status_code == 200, r.text
    return r.json()


def organiser_row(base: str, sid: str, version: str = "v2") -> dict:
    r = get(base, f"/api/{version}/organiser/sessions", organiser(base))
    assert r.status_code == 200, r.text
    return next(row for row in r.json() if row["id"] == sid)


def set_capacity(base: str, sid: str, capacity: Any, version: str = "v2") -> httpx.Response:
    return send(base, "PATCH", f"/api/{version}/organiser/sessions/{sid}", organiser(base), body={"capacity": capacity})


def open_seats(base: str, sid: str, n: int) -> dict:
    for _ in range(10):
        row = organiser_row(base, sid)
        seats = row["seats"]
        if seats["left"] == n:
            return row
        target = seats["reserved"] + seats["held"] + n
        assert 1 <= target <= CAPACITY_MAX, row
        set_capacity(base, sid, target)
    raise AssertionError(f"could not open {n} seats in {sid}: {organiser_row(base, sid)}")


def reserve(base: str, p: Person, sid: str, version: str = "v2", key: str | None = None,
            client: httpx.Client | None = None) -> httpx.Response:
    headers = {"Idempotency-Key": key} if key is not None else None
    return send(base, "POST", f"/api/{version}/sessions/{sid}/reservation", p.token, headers=headers, client=client)


def act(base: str, p: Person, method: str, sid: str, what: str, version: str = "v2",
        client: httpx.Client | None = None) -> httpx.Response:
    return send(base, method, f"/api/{version}/sessions/{sid}/{what}", p.token, client=client)


def holds_of(base: str, p: Person) -> list[dict]:
    r = get(base, "/api/v2/me/holds", p.token)
    assert r.status_code == 200, r.text
    return r.json()


class Crowd:
    def __init__(self, base: str):
        self.base = base
        self.people: list[Person] = []

    def new(self, prefix: str = "attendee", name: str | None = None) -> Person:
        p = signup(self.base, prefix, name)
        self.people.append(p)
        return p

    def many(self, n: int, prefix: str = "attendee") -> list[Person]:
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            out = list(pool.map(lambda _: signup(self.base, prefix), range(n)))
        self.people.extend(out)
        return out

    def occupy(self, sid: str) -> list[Person]:
        left = sess(self.base, sid)["seats"]["left"]
        fillers = [self.new("filler") for _ in range(left)]
        for f in fillers:
            assert reserve(self.base, f, sid).status_code == 201
        return fillers

    def cleanup(self, sids: list[str]) -> None:
        for what in ("waitlist", "hold", "reservation"):
            for p in self.people:
                for sid in sids:
                    with contextlib.suppress(httpx.HTTPError):
                        send(self.base, "DELETE", f"/api/v2/sessions/{sid}/{what}", p.token)


def race(calls: list[Callable[[httpx.Client], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[httpx.Client], Any]) -> Any:
        with httpx.Client(timeout=HTTP_TIMEOUT_S) as client:
            barrier.wait()
            return call(client)

    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def rows_with(table: str, *values: Any) -> list[dict]:
    wanted = [str(v) for v in values]
    out = []
    for row in pg().rows(f"select * from {table}"):
        cells = {str(v) for v in row.values()}
        if all(w in cells for w in wanted):
            out.append(row)
    return out


def seat_events(sid: str, account_ids: list[Any]) -> list[dict]:
    ids = {str(a) for a in account_ids}
    rows = pg().rows(f"select id, account_id, kind, at from seat_events where session_id = '{sid}' order by id")
    return [r for r in rows if str(r["account_id"]) in ids]


def db_now() -> float:
    return float(pg().rows("select extract(epoch from now()) as e")[0]["e"])


def wait_db_past(instant: str, seconds: float = DB_WAIT_S) -> None:
    assert ISO_Z.match(instant), instant
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if pg().rows(f"select now() >= '{instant}'::timestamptz as past")[0]["past"]:
            return
    raise AssertionError(f"database clock never passed {instant}")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso_z(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def venue_utc(day: int, hhmm: str) -> datetime:
    y, m, d = DAY_DATES[day]
    h, mi = map(int, hhmm.split(":"))
    return datetime(y, m, d, h, mi, tzinfo=VENUE).astimezone(UTC)


def venue_clock(instant: str) -> str:
    dt = parse_iso(instant).astimezone(VENUE)
    return f"{dt.hour % 12 or 12}:{dt:%M} {dt:%p}"


def venue_cutoff(instant: str) -> str:
    dt = parse_iso(instant).astimezone(VENUE)
    return f"{dt:%a}, {dt:%b} {dt.day}, {venue_clock(instant)}"


def twelve(hhmm: str) -> str:
    h, m = map(int, hhmm.split(":"))
    return f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def slug_of(name: str) -> str:
    return re.sub(r"[^0-9a-z]+", "-", fold(name)).strip("-")


def display_name(name: str) -> str:
    words = name.split()
    return words[0] if len(words) == 1 else f"{words[0]} {words[-1][0]}."


def ics_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def calendar(raw_bytes: bytes) -> tuple[list[str], list[dict[str, str]]]:
    assert raw_bytes.endswith(b"\r\n")
    physical = raw_bytes[:-2].split(b"\r\n")
    for line in physical:
        assert len(line) <= ICS_LINE_OCTETS, line
        assert b"\n" not in line and b"\r" not in line, line
        line.decode("utf-8")
    logical: list[bytes] = []
    for line in physical:
        if line.startswith(b" "):
            logical[-1] += line[1:]
        else:
            logical.append(line)
    lines = [x.decode("utf-8") for x in logical]
    events: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in lines:
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT":
            assert current is not None
            events.append(current)
            current = None
        elif current is not None:
            name, _, value = line.partition(":")
            current[name] = value
    return lines, events


def compact(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%SZ")


def expected_event(sid: str) -> dict[str, str]:
    s = BY_ID[sid]
    where = STAGES[s.stage][0] if s.stage else s.location
    return {
        "UID": f"{sid}@keel-outpost",
        "DTSTART": compact(venue_utc(s.day, s.start)),
        "DTEND": compact(venue_utc(s.day, s.end)),
        "SUMMARY": ics_text(s.title),
        "LOCATION": ics_text(where) + "\\, Harbour Quay Hall\\, Port Ashby",
    }


def path_query(url: str) -> str:
    u = urlparse(url)
    return u.path + (("?" + u.query) if u.query else "")


def api(version: str, route: str, **query: str) -> str:
    prefix = "/api/" + version if version else "/api"
    return prefix + route + ("?" + urlencode(query) if query else "")


def board(**query: str) -> str:
    return "/agenda" + ("?" + urlencode(query) if query else "")


def time_range(sid: str) -> str:
    s = BY_ID[sid]
    return twelve(s.start) if s.start == s.end else f"{twelve(s.start)} - {twelve(s.end)}"


def contest_record(base: str, token: str | None = None, version: str = "v2") -> httpx.Response:
    return get(base, api(version, "/record"), token)


def submit_guess(base: str, token: str, value: Any, version: str = "v2",
                 client: httpx.Client | None = None) -> httpx.Response:
    return send(base, "POST", api(version, "/record/guesses"), token, body={"value": value}, client=client)


def reveal_figure(base: str, figure: Any, version: str = "v2", client: httpx.Client | None = None) -> httpx.Response:
    return send(base, "POST", api(version, "/organiser/record/reveal"), organiser(base),
                body={"final_figure": figure}, client=client)


def speakers_list(base: str, version: str = "v2") -> list[dict]:
    r = get(base, api(version, "/speakers"))
    assert r.status_code == 200, r.text
    return r.json()


def hold_periods(sid: str, account_id: Any) -> list[float]:
    rows = pg().rows(f"select account_id, extract(epoch from held_until - held_from) as s from holds where session_id = '{sid}'")
    return [float(r["s"]) for r in rows if str(r["account_id"]) == str(account_id)]


def count_rows(table: str) -> int:
    return int(pg().rows(f"select count(*) as n from {table}")[0]["n"])


def eventually(page: Page, condition: Callable[[], bool], *, seconds: float = UI_WAIT_S,
               budget_ms: int | None = None, message: str = "") -> int:
    start = time.monotonic()
    advanced = 0
    while True:
        try:
            if condition():
                return advanced
        except PlaywrightError:
            pass
        if time.monotonic() - start > seconds:
            raise AssertionError(f"condition not met within {seconds}s ({advanced} ms page time) {message}")
        if budget_ms is None or advanced < budget_ms:
            advance(page, UI_STEP_MS)
            advanced += UI_STEP_MS


def text(loc: Locator) -> str:
    return " ".join((loc.text_content() or "").split())


def focused(loc: Locator) -> bool:
    return bool(loc.count()) and loc.first.evaluate("e => e === document.activeElement")


def body_focused(page: Page) -> bool:
    return page.evaluate("() => !document.activeElement || document.activeElement === document.body")


def loaded(page: Page) -> None:
    eventually(page, lambda: page.get_by_role("contentinfo").count() > 0
               and page.get_by_text("Loading", exact=True).count() == 0)


def btn(page: Page | Locator, name: str) -> Locator:
    return page.get_by_role("button", name=name, exact=True)


def status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name, exact=True)


def board_titles(page: Page) -> list[str]:
    lst = page.get_by_role("list", name="Sessions", exact=True)
    return [" ".join(t.split()) for t in lst.get_by_role("heading", level=3).all_inner_texts()]


def board_row(page: Page, title: str) -> Locator:
    lst = page.get_by_role("list", name="Sessions", exact=True)
    return lst.get_by_role("listitem").filter(has=page.get_by_role("heading", name=title, exact=True))


def combo_label(loc: Locator) -> str:
    return loc.evaluate(
        "e => (e.selectedOptions && e.selectedOptions.length ? e.selectedOptions[0].textContent"
        " : (e.value || e.textContent || '')).trim()")


def elsewhere(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTimezoneOverride", {"timezoneId": BROWSER_ZONE})
    page.reload()
    assert page.evaluate("Intl.DateTimeFormat().resolvedOptions().timeZone") == BROWSER_ZONE
    return cdp


def ui_signin(page: Page, base: str, email: str, password: str) -> None:
    page.goto(base + "/signin")
    fill(page.get_by_role("textbox", name="Email", exact=True), email)
    fill(page.get_by_label("Password", exact=True), password)
    click(btn(page, "Sign in"))
    eventually(page, lambda: urlparse(page.url).path == "/agenda", message="sign-in did not land on /agenda")
    eventually(page, lambda: btn(page, "Sign out").count() == 1)


def row_numbers(row: Locator) -> list[str]:
    cells = [" ".join(t.split()) for t in row.get_by_role("cell").all_inner_texts()]
    return [c for c in cells if c.isdigit()]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    assert url, "the verifier environment must provide DATABASE_URL to start app copies"
    return url


@dataclasses.dataclass
class Copy:
    base: str
    proc: subprocess.Popen
    log: str

    def tail(self) -> str:
        return Path(self.log).read_text(errors="replace")[-4000:]

    def health(self) -> int | None:
        try:
            return HTTP.get(self.base + "/api/health", timeout=5).status_code
        except httpx.TransportError:
            return None

    def wait(self, statuses: set[int], seconds: float = BOOT_S) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.health() in statuses:
                return
            try:
                self.proc.wait(timeout=POLL_S)
            except subprocess.TimeoutExpired:
                continue
            raise AssertionError(f"app copy exited with {self.proc.returncode}:\n{self.tail()}")
        raise AssertionError(f"app copy never answered health {statuses}:\n{self.tail()}")

    def stop(self) -> None:
        if self.proc.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=STOP_S)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(self.proc.pid, signal.SIGKILL)
                self.proc.wait()


def start_copy(database: str | None = None, **env: str) -> Copy:
    manifest = Path(DEPLOYED_APP) / "run.json"
    serve = json.loads(manifest.read_text())["serve"]
    port = free_port()
    log = tempfile.NamedTemporaryFile("w", suffix=".log", delete=False)
    environment = dict(os.environ)
    environment.update({
        "DATABASE_URL": database or database_url(),
        "APP_PUBLIC_PORT": str(port),
        "CONTEST_CLOSES_AT": os.environ.get("CONTEST_CLOSES_AT", DEFAULT_CLOSES_AT),
    })
    environment.update(env)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=environment, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    return Copy(f"http://127.0.0.1:{port}", proc, log.name)


@contextlib.contextmanager
def app_copy(database: str | None = None, wait: str | None = "healthy", **env: str) -> Iterator[Copy]:
    copy = start_copy(database, **env)
    try:
        if wait == "healthy":
            copy.wait({200})
        elif wait == "listening":
            copy.wait({200, 503})
        yield copy
    finally:
        copy.stop()


class Relay:

    def __init__(self, port: int, upstream: tuple[str, int]):
        self.port = port
        self.upstream = upstream
        self.listener: socket.socket | None = None
        self.sockets: list[socket.socket] = []

    def start(self) -> None:
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", self.port))
        self.listener.listen()
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        assert self.listener is not None
        while True:
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            try:
                server = socket.create_connection(self.upstream)
            except OSError:
                client.close()
                continue
            self.sockets += [client, server]
            for a, b in ((client, server), (server, client)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(RELAY_CHUNK):
                dst.sendall(data)
        except OSError:
            pass
        finally:
            with contextlib.suppress(OSError):
                dst.shutdown(socket.SHUT_WR)

    def stop(self) -> None:
        if self.listener is not None:
            with contextlib.suppress(OSError):
                self.listener.shutdown(socket.SHUT_RDWR)
            self.listener.close()
        for s in self.sockets:
            with contextlib.suppress(OSError):
                s.close()


@pytest.fixture(scope="module")
def stage() -> Iterator[str]:
    with app_copy(HOLD_SECONDS=str(LONG_HOLD_SECONDS)) as copy:
        yield copy.base


@pytest.fixture(scope="module")
def peer() -> Iterator[str]:
    with app_copy(HOLD_SECONDS=str(SHORT_HOLD_SECONDS)) as copy:
        yield copy.base


@pytest.fixture(scope="module")
def contest() -> Iterator[str]:
    closes = (int(db_now()) // 60 + 1) * 60 + int(timedelta(days=CONTEST_OPEN_DAYS).total_seconds())
    with app_copy(CONTEST_CLOSES_AT=iso_z(closes), HOLD_SECONDS=str(LONG_HOLD_SECONDS)) as copy:
        yield copy.base


def test_signup_ignores_role_and_refuses_bad_input(app_url: str) -> None:
    name, email = names("signup")
    r = send(app_url, "POST", api("v2", "/auth/signup"), body={
        "name": name, "email": email.upper(), "password": NEW_PASSWORD, "role": "organiser", "id": 1})
    assert r.status_code == 201, r.text
    account = r.json()["account"]
    assert account["role"] == "attendee" and account["email"] == email.lower() and account["name"] == name
    me = get(app_url, api("v2", "/me"), r.json()["token"])
    assert me.status_code == 200 and me.json()["role"] == "attendee"
    stored = rows_with("accounts", email.lower())
    assert len(stored) == 1 and "organiser" not in {str(v) for v in stored[0].values()}

    taken = send(app_url, "POST", api("v2", "/auth/signup"), body={"name": name, "email": email.lower(), "password": NEW_PASSWORD})
    v2_error(taken, 409, "email_taken")
    taken_v1 = send(app_url, "POST", api("v1", "/auth/signup"), body={"name": name, "email": email.title(), "password": NEW_PASSWORD})
    v1_error(taken_v1, 409, "email_taken")
    assert len(rows_with("accounts", email.lower())) == 1

    def bad(field: str, **override: Any) -> None:
        n, e = names("badsignup")
        body = {"name": n, "email": e, "password": NEW_PASSWORD, **override}
        res = send(app_url, "POST", api("v2", "/auth/signup"), body=body)
        err = v2_error(res, 422, "invalid")
        assert field in err["fields"], err
        probe = body["email"] if isinstance(body["email"], str) else e
        assert rows_with("accounts", probe.lower()) == [] and rows_with("accounts", e.lower()) == []

    bad("name", name="")
    bad("name", name="   ")
    bad("name", name="Line\nBreak")
    bad("name", name="x" * (NAME_MAX_CHARS + 1))
    bad("email", email="no-at-sign.example")
    bad("email", email="two@@signs.example")
    bad("email", email="@missing-local.example")
    bad("email", email="nodot@localhost")
    bad("password", password="x" * (PASSWORD_MIN_CHARS - 1))
    bad("password", password="x" * (PASSWORD_MAX_CHARS + 1))


def test_token_survives_restart_until_logout(app_url: str) -> None:
    p = signup(app_url, "token")
    r = login(app_url, p.email, NEW_PASSWORD)
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert set(r.json()) == {"token", "account"} and r.json()["account"]["email"] == p.email
    with app_copy() as first:
        assert get(first.base, api("v2", "/me"), token).json()["email"] == p.email
    with app_copy() as restarted:
        me = get(restarted.base, api("v2", "/me"), token)
        assert me.status_code == 200 and me.json()["email"] == p.email
        out = send(restarted.base, "POST", api("v2", "/auth/logout"), token)
        assert out.status_code == 200 and out.json() == {"signed_out": True}
    v2_error(get(app_url, api("v2", "/me"), token), 401, "unauthenticated")
    v1_error(get(app_url, api("v1", "/me"), token), 401, "unauthenticated")
    v2_error(send(app_url, "POST", api("v2", "/auth/logout"), token), 401, "unauthenticated")
    assert get(app_url, api("v2", "/me"), p.token).status_code == 200


NEXT_CASES = {
    "filtered-board": ("next=%2Fagenda%3Fday%3D1%26stage%3Dai-builder-lab%26format%3Dworkshop",
                       "/agenda?day=1&stage=ai-builder-lab&format=workshop"),
    "protocol-relative": ("next=%2F%2Fevil.example%2Fx", "/agenda"),
    "encoded-slashes": ("next=%2F%2Fevil.example", "/agenda"),
    "backslash": ("next=%2F%5Cevil.example", "/agenda"),
    "absolute": ("next=https%3A%2F%2Fevil.example", "/agenda"),
    "javascript": ("next=javascript%3Aalert%281%29", "/agenda"),
    "empty": ("next=", "/agenda"),
    "missing": ("", "/agenda"),
}


@pytest.mark.parametrize("case", ["filtered-board", "protocol-relative", "encoded-slashes", "backslash", "absolute",
                                  "javascript", "empty", "missing"],
                         ids=["filtered-board", "protocol-relative", "encoded-slashes", "backslash", "absolute",
                              "javascript", "empty", "missing"])
def test_safe_next_redirect(browser: Browser, app_url: str, case: str) -> None:
    query, expected = NEXT_CASES[case]
    suffix = ("?" + query) if query else ""
    p = signup(app_url, "next")
    with open_app(browser, f"{app_url}/signin{suffix}") as page:
        fill(page.get_by_role("textbox", name="Email", exact=True), p.email)
        fill(page.get_by_label("Password", exact=True), NEW_PASSWORD)
        click(btn(page, "Sign in"))
        eventually(page, lambda: btn(page, "Sign out").count() == 1)
        eventually(page, lambda: path_query(page.url) == expected, message=page.url)
        assert same_origin(page.url, app_url)
    name, email = names("nextsignup")
    with open_app(browser, f"{app_url}/signup{suffix}") as page:
        fill(page.get_by_role("textbox", name="Name", exact=True), name)
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_label("Password", exact=True), NEW_PASSWORD)
        click(btn(page, "Create account"))
        eventually(page, lambda: btn(page, "Sign out").count() == 1)
        eventually(page, lambda: path_query(page.url) == expected, message=page.url)
        assert same_origin(page.url, app_url)
    assert len(rows_with("accounts", email.lower())) == 1


def test_signin_throttle_shared_across_instances(app_url: str) -> None:
    p = signup(app_url, "throttle")
    window = int(os.environ.get("SIGNIN_THROTTLE_WINDOW_SECONDS", THROTTLE_DEFAULT_WINDOW_S))
    with app_copy() as other:
        for _ in range(3):
            v2_error(login(app_url, p.email, WRONG_PASSWORD), 401, "invalid_credentials")
        for _ in range(THROTTLE_FAILURES - 3):
            v2_error(login(other.base, p.email.upper(), WRONG_PASSWORD), 401, "invalid_credentials")
        limited = login(app_url, p.email, NEW_PASSWORD)
        v2_error(limited, 429, "rate_limited")
        retry = limited.headers.get("Retry-After", "")
        assert retry.isdigit() and 1 <= int(retry) <= window, retry
        limited_v1 = login(other.base, p.email, NEW_PASSWORD, version="v1")
        v1_error(limited_v1, 429, "rate_limited")
        assert limited_v1.headers.get("Retry-After", "").isdigit()
    fresh = signup(app_url, "notthrottled")
    assert login(app_url, fresh.email, NEW_PASSWORD).status_code == 200


def test_signin_does_not_disclose_accounts(app_url: str) -> None:
    for version in ("v1", "v2"):
        known = signup(app_url, "disclose")
        unknown = names("ghost")[1]
        a = login(app_url, known.email, WRONG_PASSWORD, version)
        b = login(app_url, unknown, WRONG_PASSWORD, version)
        error_of(a, version, 401, "invalid_credentials")
        assert b.status_code == 401 and a.content == b.content
        assert {k.lower() for k in a.headers.keys()} == {k.lower() for k in b.headers.keys()}

    knowns = [signup(app_url, "timing") for _ in range(TIMING_SAMPLES)]
    wrong_times: list[float] = []
    unknown_times: list[float] = []
    for k in knowns:
        t0 = time.perf_counter()
        login(app_url, k.email, WRONG_PASSWORD)
        wrong_times.append(time.perf_counter() - t0)
        t0 = time.perf_counter()
        login(app_url, names("ghosttime")[1], WRONG_PASSWORD)
        unknown_times.append(time.perf_counter() - t0)
    assert statistics.median(unknown_times) >= 0.5 * statistics.median(wrong_times), (unknown_times, wrong_times)

    known = signup(app_url, "throttlesame")
    unknown = names("ghostthrottle")[1]
    for _ in range(THROTTLE_FAILURES):
        login(app_url, known.email, WRONG_PASSWORD)
        login(app_url, unknown, WRONG_PASSWORD)
    a = login(app_url, known.email, WRONG_PASSWORD)
    b = login(app_url, unknown, WRONG_PASSWORD)
    v2_error(a, 429, "rate_limited")
    assert b.status_code == 429 and a.content == b.content
    assert a.headers.get("Retry-After", "").isdigit() and b.headers.get("Retry-After", "").isdigit()


def test_wf_accounts_journey(browser: Browser, app_url: str) -> None:
    board = "/agenda?day=1&stage=ai-builder-lab&format=workshop"
    name, email = names("journey")
    with open_app(browser, app_url + board) as page:
        loaded(page)
        click(btn(page, f"Reserve seat for {CLONE_T}"))
        eventually(page, lambda: urlparse(page.url).path == "/signin")
        assert parse_qs(urlparse(page.url).query)["next"] == [board]
        click(page.get_by_role("link", name="Create an account", exact=True))
        eventually(page, lambda: urlparse(page.url).path == "/signup")
        fill(page.get_by_role("textbox", name="Name", exact=True), name)
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_label("Password", exact=True), NEW_PASSWORD)
        click(btn(page, "Create account"))
        eventually(page, lambda: path_query(page.url) == board, message=page.url)
        eventually(page, lambda: btn(page, "Sign out").count() == 1
                   and page.get_by_role("link", name="My Agenda", exact=True).count() == 1)
        assert page.get_by_text(name, exact=True).count() >= 1
        stored = rows_with("accounts", email.lower())
        assert len(stored) == 1 and "attendee" in {str(v) for v in stored[0].values()}

        click(btn(page, "Sign out"))
        eventually(page, lambda: page.get_by_role("link", name="Sign in", exact=True).count() == 1)
        eventually(page, lambda: text(status(page, "Account messages")) == "You are signed out.")
        click(page.get_by_role("link", name="Sign in", exact=True))
        eventually(page, lambda: urlparse(page.url).path == "/signin")
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_label("Password", exact=True), NEW_PASSWORD)
        click(btn(page, "Sign in"))
        eventually(page, lambda: btn(page, "Sign out").count() == 1)
        eventually(page, lambda: text(status(page, "Account messages")) == f"Welcome back, {name}.")
    assert login(app_url, email, NEW_PASSWORD).json()["account"]["role"] == "attendee"


def test_wf_accounts_wrong_password(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "mistype")
    unknown = names("ghostui")[1]
    seen = []
    with open_app(browser, app_url + "/signin") as page:
        email_box = page.get_by_role("textbox", name="Email", exact=True)
        password_box = page.get_by_label("Password", exact=True)
        for email in (p.email, unknown):
            fill(email_box, email)
            fill(password_box, WRONG_PASSWORD)
            with page.expect_response(lambda resp: "/auth/login" in resp.url):
                click(btn(page, "Sign in"))
            eventually(page, lambda: text(status(page, "Account messages")) == "Email or password is incorrect.")
            seen.append(text(status(page, "Account messages")))
            assert page.get_by_role("heading", name="There is a problem", exact=True).count() == 0
            assert email_box.input_value() == email and password_box.input_value() == WRONG_PASSWORD
            assert email_box.get_attribute("aria-invalid") != "true"
            assert password_box.get_attribute("aria-invalid") != "true"
        assert seen[0] == seen[1]
        fill(email_box, p.email)
        fill(password_box, NEW_PASSWORD)
        click(btn(page, "Sign in"))
        eventually(page, lambda: btn(page, "Sign out").count() == 1)
        assert urlparse(page.url).path == "/agenda"
    assert rows_with("accounts", unknown.lower()) == []


def test_agenda_listing_order_and_filters(app_url: str) -> None:
    def ids(path: str) -> list[str]:
        r = get(app_url, path)
        assert r.status_code == 200, r.text
        return [s["id"] for s in r.json()]

    assert ids(api("v2", "/sessions")) == AGENDA_ORDER and len(AGENDA_ORDER) == 18
    assert ids(api("v1", "/sessions")) == AGENDA_ORDER
    assert ids(api("", "/sessions", day="all")) == AGENDA_ORDER
    assert ids(api("v2", "/sessions", day="1")) == DAY_IDS[1]
    assert ids(api("v2", "/sessions", day="2")) == DAY_IDS[2]
    assert ids(api("v2", "/sessions", stage="summit-stage")) == [i for i in AGENDA_ORDER if BY_ID[i].stage == "summit-stage"]
    assert ids(api("v1", "/sessions", format="fireside", stage="all")) == [i for i in AGENDA_ORDER if BY_ID[i].format == "fireside"]
    assert ids(api("v2", "/sessions", day="1", stage="ai-builder-lab", format="workshop")) == [CLONE, ZERO, NEVER]
    assert ids(api("v1", "/sessions", day="2", stage="ai-builder-lab", format="workshop")) == [WALLET, MUSIC]
    for key, value in (("day", "3"), ("stage", "main-hall"), ("format", "talk")):
        v2_error(get(app_url, api("v2", "/sessions", **{key: value})), 400, "invalid_filter")
        v1_error(get(app_url, api("v1", "/sessions", **{key: value})), 400, "invalid_filter")
    first = get(app_url, f"/api/v2/sessions/{CLONE}").json()
    assert first["title"] == CLONE_T and first["stage"] == "ai-builder-lab" and first["format_label"] == "Workshop"
    assert first["date"] == DAY_DATE_TEXT[1] and first["stage_name"] == "AI Builder Lab"


def test_wf_agenda_empty_filter(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/agenda?day=1&stage=ai-builder-lab&format=workshop") as page:
        eventually(page, lambda: board_titles(page) == [CLONE_T, ZERO_T, NEVER_T])
        assert text(status(page, "Agenda results")) == f"{len([CLONE, ZERO, NEVER])} sessions"
        assert page.get_by_role("link", name="Download Agenda", exact=True).count() == 1
        page.goto(app_url + board(day="2", stage="summit-stage", format="workshop"))
        eventually(page, lambda: page.get_by_text("No sessions match these filters.", exact=True).count() == 1)
        assert btn(page, "Clear filters").count() == 1
        assert page.get_by_role("link", name="Download Agenda", exact=True).count() == 0
        click(btn(page, "Clear filters"))
        eventually(page, lambda: path_query(page.url) == board(day="2"))
        expected = [BY_ID[i].title for i in DAY_IDS[2]]
        eventually(page, lambda: board_titles(page) == expected)
        assert text(status(page, "Agenda results")) == f"{len(expected)} sessions"
        assert combo_label(page.get_by_role("combobox", name="Stage", exact=True)) == "All"
        assert page.get_by_role("searchbox", name="Search sessions", exact=True).input_value() == ""
    listed = [s["title"] for s in get(app_url, api("v2", "/sessions", day="2")).json()]
    assert listed == expected


def test_wf_agenda_address_history(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/agenda?day=1") as page:
        loaded(page)
        start = page.evaluate("history.length")
        stage_box = page.get_by_role("combobox", name="Stage", exact=True)
        format_box = page.get_by_role("combobox", name="Format", exact=True)
        search = page.get_by_role("searchbox", name="Search sessions", exact=True)
        select(stage_box, "AI Builder Lab")
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab")
        select(format_box, "Workshop")
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab&format=workshop")
        fill(search, "agent")
        search.press("Enter")
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab&format=workshop&q=agent")
        eventually(page, lambda: text(status(page, "Agenda results")) == "2 sessions")
        assert page.evaluate("history.length") == start + 3
        page.reload()
        eventually(page, lambda: board_titles(page) == [ZERO_T, NEVER_T])
        assert combo_label(stage_box) == "AI Builder Lab" and combo_label(format_box) == "Workshop"
        assert search.input_value() == "agent"
        page.go_back()
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab&format=workshop")
        eventually(page, lambda: board_titles(page) == [CLONE_T, ZERO_T, NEVER_T])
        page.go_back()
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab")
        ai_day1 = [BY_ID[i].title for i in DAY_IDS[1] if BY_ID[i].stage == "ai-builder-lab"]
        eventually(page, lambda: board_titles(page) == ai_day1)
        assert combo_label(format_box) == "All"
        page.goto(app_url + "/agenda?day=1&stage=bogus&format=bogus")
        eventually(page, lambda: len(board_titles(page)) == len(DAY_IDS[1]))
        assert combo_label(stage_box) == "All" and combo_label(format_box) == "All"


def test_venue_time_in_other_zone(browser: Browser, app_url: str, contest: str) -> None:
    with open_app(browser, app_url + "/agenda?day=1") as page:
        cdp = elsewhere(page)
        eventually(page, lambda: board_row(page, CLONE_T).count() == 1)
        assert time_range(CLONE) in text(board_row(page, CLONE_T))
        doors = text(board_row(page, BY_ID["d1-doors-open"].title))
        assert time_range("d1-doors-open") in doors and time_range("d1-doors-open") + " - " not in doors
        page.goto(app_url + board(day="2"))
        eventually(page, lambda: board_row(page, WALLET_T).count() == 1)
        assert time_range(WALLET) in text(board_row(page, WALLET_T))
        page.goto(app_url + f"/sessions/{WALLET}")
        details = page.get_by_role("table", name="Session details", exact=True)
        eventually(page, lambda: "Sun, Nov 1, 11:00 AM" in text(details))
        assert f"Sun, Nov 1, {twelve(BY_ID[WALLET].end)}" in text(details)
        assert page.get_by_text(VENUE_LINES[2], exact=True).count() >= 1
        del cdp
    closes_at = contest_record(contest).json()["closes_at"]
    with open_app(browser, contest + "/record") as page:
        cdp = elsewhere(page)
        line = f"Guessing closes {venue_cutoff(closes_at)} Port Ashby time."
        eventually(page, lambda: page.get_by_text(line, exact=True).count() == 1, message=line)
        del cdp


def test_instants_follow_zone_rules(browser: Browser, app_url: str) -> None:
    v2 = {s["id"]: s for s in get(app_url, "/api/v2/sessions").json()}
    v1 = {s["id"]: s for s in get(app_url, "/api/v1/sessions").json()}
    for sid, seed in BY_ID.items():
        start, end = venue_utc(seed.day, seed.start), venue_utc(seed.day, seed.end)
        assert v2[sid]["start_instant"] == iso_z(start.timestamp()) and v2[sid]["end_instant"] == iso_z(end.timestamp())
        assert v1[sid]["starts_at_utc"] == iso_z(start.timestamp()) and v1[sid]["ends_at_utc"] == iso_z(end.timestamp())
        assert v2[sid]["start_local"] == seed.start and v1[sid]["starts_at"] == seed.start
        offset = (start.replace(tzinfo=None) - datetime(*DAY_DATES[seed.day], *map(int, seed.start.split(":")))).total_seconds()
        assert offset == (3 if seed.day == 1 else 4) * 3600
    assert v2[CLONE]["start_instant"] == "2026-10-31T14:30:00Z" and v2[CLONE]["end_instant"] == "2026-10-31T15:00:00Z"
    assert v2[WALLET]["start_instant"] == "2026-11-01T15:00:00Z" and v2[WALLET]["end_instant"] == "2026-11-01T15:30:00Z"
    with open_app(browser, app_url + "/agenda?day=1") as page:
        for day in (1, 2):
            page.goto(f"{app_url}/agenda?day={day}")
            eventually(page, lambda: page.get_by_text(VENUE_LINES[day], exact=True).count() == 1)
            assert page.get_by_text(VENUE_LINES[3 - day], exact=True).count() == 0
        page.goto(f"{app_url}/sessions/{MUSIC}")
        eventually(page, lambda: page.get_by_text(VENUE_LINES[2], exact=True).count() == 1)


def test_calendar_file_strict(app_url: str) -> None:
    def fetch(version: str, **query: str) -> httpx.Response:
        r = get(app_url, api(version, "/agenda.ics", **query))
        assert r.status_code == 200, r.text
        assert media_type(r) == "text/calendar; charset=utf-8"
        assert r.headers["Content-Disposition"] == 'attachment; filename="keel-outpost-agenda.ics"'
        return r

    workshops = {"stage": "ai-builder-lab", "format": "workshop"}
    r = fetch("v2", day="1", **workshops)
    lines, events = calendar(r.content)
    assert "VCALENDAR" in lines[0] and "VCALENDAR" in lines[-1] and lines[0] != lines[-1]
    assert sum("VCALENDAR" in line for line in lines) == 2
    assert "VERSION:2.0" in lines and "PRODID:-//Keel Outpost//Agenda//EN" in lines
    assert [e["UID"] for e in events] == [f"{i}@keel-outpost" for i in (CLONE, ZERO, NEVER)]
    for event, sid in zip(events, (CLONE, ZERO, NEVER)):
        for key, value in expected_event(sid).items():
            assert event[key] == value, (sid, key, event)
        assert re.fullmatch(r"\d{8}T\d{6}Z", event["DTSTAMP"])
    assert events[0]["DTSTART"] == "20261031T143000Z"
    assert events[0]["LOCATION"] == "AI Builder Lab\\, Harbour Quay Hall\\, Port Ashby"
    _, day2 = calendar(fetch("v2", day="2", **workshops).content)
    assert day2[0]["DTSTART"] == "20261101T150000Z"
    _, everything = calendar(fetch("v2").content)
    assert [e["UID"] for e in everything] == [f"{i}@keel-outpost" for i in AGENDA_ORDER]
    for event, sid in zip(everything, AGENDA_ORDER):
        assert {k: event[k] for k in expected_event(sid)} == expected_event(sid)
    doors = everything[AGENDA_ORDER.index("d1-doors-open")]
    assert doors["DTEND"] == doors["DTSTART"]
    _, searched = calendar(fetch("v2", q="agent").content)
    assert [e["UID"].split("@")[0] for e in searched] == ["d1-chat-to-trade", ZERO, NEVER, WALLET]
    _, ignored = calendar(fetch("v1", q="agent").content)
    assert len(ignored) == len(AGENDA_ORDER)
    stamp = re.compile(rb"DTSTAMP:\d{8}T\d{6}Z")
    a = fetch("v1", day="1").content
    b = fetch("v2", day="1").content
    assert stamp.sub(b"", a) == stamp.sub(b"", b)
    empty = {"day": "2", "stage": "summit-stage", "format": "workshop"}
    v2_error(get(app_url, api("v2", "/agenda.ics", **empty)), 404, "no_sessions")
    v1_error(get(app_url, api("v1", "/agenda.ics", **empty)), 404, "no_sessions")


def expected_speakers() -> list[tuple[str, str, list[str]]]:
    out: dict[str, tuple[str, list[str]]] = {}
    for sid in AGENDA_ORDER:
        for name, company in BY_ID[sid].speakers:
            out.setdefault(name, (company, []))[1].append(sid)
    return [(n, c, s) for n, (c, s) in out.items()]


def test_speakers_in_order(browser: Browser, app_url: str) -> None:
    expected = expected_speakers()
    assert len(expected) == 19
    v2 = speakers_list(app_url)
    assert [(s["name"], s["company"], s["sessions"]) for s in v2] == expected
    assert [s["slug"] for s in v2] == [slug_of(n) for n, _, _ in expected]
    assert v2[0]["slug"] == "ines-okafor"
    mara = next(s for s in v2 if s["slug"] == "mara-velasquez")
    assert mara["sessions"] == ["d1-campus-to-protocol", NEVER]
    mara_url = "https://example.com/mara"
    assert "<em>" + "Tidewater Labs" + "</em>" in mara["bio_html"]
    assert f'<a href="{mara_url}">{mara_url}</a>' in mara["bio_html"]
    v1 = speakers_list(app_url, "v1")
    assert [set(s) for s in v1] == [set(V1_OBJECTS["speaker"])] * len(expected)
    with open_app(browser, app_url + "/speakers") as page:
        wall = page.get_by_role("list", name="Speakers", exact=True)
        eventually(page, lambda: wall.get_by_role("listitem").count() == len(expected))
        items = wall.get_by_role("listitem")
        for i, (name, company, _) in enumerate(expected):
            assert name in text(items.nth(i)) and company in text(items.nth(i))
        mara_tile = items.nth([n for n, _, _ in expected].index("Mara Velasquez"))
        assert "<em>" + "Tidewater Labs" + "</em>" in mara_tile.inner_html()
        items.nth(0).hover()
        link = items.nth(0).get_by_role("link", name=BY_ID["d1-book-signing"].title, exact=True)
        eventually(page, lambda: link.is_visible())
        assert link.get_attribute("href").endswith("/sessions/" + "d1-book-signing")


BIO_PAIRS = {
    "p01": ("***foo***", "<em><strong>foo</strong></em>"),
    "p02": ('a*"foo"*', "a*&quot;foo&quot;*"),
    "p03": ("foo*bar*baz", "foo<em>bar</em>baz"),
    "p04": ("foo_bar_baz", "foo_bar_baz"),
    "p05": ("_foo_bar", "_foo_bar"),
    "p06": ("**foo*bar**", "<strong>foo*bar</strong>"),
    "p07": ("**foo*", "*<em>foo</em>"),
    "p08": ("*foo**bar*", "<em>foo**bar</em>"),
    "p09": ("`` a ` b ``", "<code>a ` b</code>"),
    "p10": ("[docs](https://example.com/a_(b))", '<a href="https://example.com/a_(b)">docs</a>'),
    "p11": ("[docs](https://example.com/a)b)", '<a href="https://example.com/a">docs</a>b)'),
    "p12": ("[x](javascript:alert(1)) [y](//evil.example/a) [z](data:text/html,hi)",
            "[x](javascript:alert(1)) [y](//evil.example/a) [z](data:text/html,hi)"),
    "p13": ("<https://example.com/q?a=1&b=2>",
            '<a href="https://example.com/q?a=1&amp;b=2">https://example.com/q?a=1&amp;b=2</a>'),
    "p14": ("<b>bold</b> &lt; <img src=x onerror=alert(1)>",
            "&lt;b&gt;bold&lt;/b&gt; &amp;lt; &lt;img src=x onerror=alert(1)&gt;"),
    "p15": ("line one  \nline two\\\nline three", "line one<br>\nline two<br>\nline three"),
}


@pytest.mark.parametrize("case", ["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10", "p11",
                                  "p12", "p13", "p14", "p15"],
                         ids=["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10", "p11",
                              "p12", "p13", "p14", "p15"])
def test_bio_rendering_pairs(app_url: str, case: str) -> None:
    bio, expected = BIO_PAIRS[case]
    slug = slug_of("Ivo Lind")
    try:
        r = send(app_url, "PUT", f"/api/v2/organiser/speakers/{slug}/bio", organiser(app_url), body={"bio": bio})
        assert r.status_code == 200, r.text
        assert r.json()["bio"] == bio and r.json()["bio_html"] == expected
        listed = next(s for s in speakers_list(app_url) if s["slug"] == slug)
        assert listed["bio_html"] == expected
    finally:
        send(app_url, "PUT", f"/api/v2/organiser/speakers/{slug}/bio", organiser(app_url), body={"bio": ""})


class _Tags(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, list[tuple[str, str | None]]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append((tag, attrs))


HOSTILE_BIOS = [
    "<script>alert(1)</script>",
    '<img src=x onerror="window.__bioInjected=1">',
    "[x](javascript:window.__bioInjected=2)",
    "[x](JAVASCRIPT:alert(1))",
    "<javascript:alert(1)>",
    "[x](data:text/html,hi)",
    '[x](https://a.example/" onclick="alert(1))',
    '<https://a.example/"onmouseover="alert(1)>',
    "**[a](https://ok.example)**<iframe src=x>",
    "`<b>code</b>`",
    "&#60;script&#62;",
    "[a](//evil.example)",
    "[a](HTTPS://ok.example/x)",
    "[[a](https://ok.example)](https://two.example)",
]


def test_bio_cannot_inject_markup(browser: Browser, app_url: str) -> None:
    slug = slug_of("Kevin Bloom")
    org = organiser(app_url)
    try:
        for bio in HOSTILE_BIOS:
            r = send(app_url, "PUT", f"/api/v2/organiser/speakers/{slug}/bio", org, body={"bio": bio})
            assert r.status_code == 200, r.text
            parser = _Tags()
            parser.feed(r.json()["bio_html"])
            for tag, attrs in parser.tags:
                assert tag in {"em", "strong", "code", "br", "a"}, (bio, tag)
                assert all(name == "href" for name, _ in attrs), (bio, attrs)
                for _, value in attrs:
                    assert (value or "").lower().startswith(("http://", "https://")), (bio, value)
        send(app_url, "PUT", f"/api/v2/organiser/speakers/{slug}/bio", org,
             body={"bio": HOSTILE_BIOS[1] + " " + HOSTILE_BIOS[2]})
        with open_app(browser, app_url + "/speakers") as page:
            tile = page.get_by_role("list", name="Speakers", exact=True).get_by_role("listitem").filter(has_text="Kevin Bloom")
            eventually(page, lambda: tile.count() == 1)
            tile.hover()
            assert page.evaluate("() => window.__bioInjected === undefined")
            hrefs = tile.get_by_role("link").evaluate_all("els => els.map(e => e.getAttribute('href') || '')")
            assert all(not h.lower().startswith(("javascript:", "data:")) for h in hrefs), hrefs
    finally:
        send(app_url, "PUT", f"/api/v2/organiser/speakers/{slug}/bio", org, body={"bio": ""})


SEARCH_CASES = {
    "agent": ("agent", ["d1-chat-to-trade", ZERO, NEVER, WALLET]),
    "agent-minus-wallet": ("agent -wallet", ["d1-chat-to-trade", ZERO, NEVER]),
    "phrase-tidewater": ('"tidewater labs"', ["d1-campus-to-protocol", "d1-machine-economy", "d1-who-writes-rules", NEVER, LLM, "d2-future-intelligence"]),
    "and-operator": ("tidewater AND agent", [NEVER]),
    "or-accent": ("quayside OR café", ["d1-chat-to-trade", ZERO, WALLET]),
    "precedence": ("agent OR ledger AND keel", ["d1-chat-to-trade", ZERO, NEVER, WALLET]),
    "group-negation": ("(agent OR ledger) -tidewater", ["d1-book-signing", "d1-chat-to-trade", ZERO, WALLET]),
    "apostrophe-phrase": ('"won\'t wait"', ["d1-machine-economy"]),
    "lowercase-and": ("and", ["d1-campus-to-protocol"]),
    "caps-cafe": ("CAFE", [WALLET]),
    "plain-cafe": ("cafe", [WALLET]),
    "accent-cafe": ("Café", [WALLET]),
    "caps-accent-cafe": ("CAFÉ", [WALLET]),
}


@pytest.mark.parametrize("case", ["agent", "agent-minus-wallet", "phrase-tidewater", "and-operator", "or-accent",
                                  "precedence", "group-negation", "apostrophe-phrase", "lowercase-and", "caps-cafe",
                                  "plain-cafe", "accent-cafe", "caps-accent-cafe"],
                         ids=["agent", "agent-minus-wallet", "phrase-tidewater", "and-operator", "or-accent",
                              "precedence", "group-negation", "apostrophe-phrase", "lowercase-and", "caps-cafe",
                              "plain-cafe", "accent-cafe", "caps-accent-cafe"])
def test_search_grammar(app_url: str, case: str) -> None:
    q, expected = SEARCH_CASES[case]
    r = HTTP.get(app_url + "/api/v2/sessions", params={"q": q})
    assert r.status_code == 200, r.text
    assert [s["id"] for s in r.json()] == expected
    day1 = HTTP.get(app_url + "/api/v2/sessions", params={"q": q, "day": "1"}).json()
    assert [s["id"] for s in day1] == [i for i in expected if BY_ID[i].day == 1]
    lab = HTTP.get(app_url + "/api/v2/sessions", params={"q": q, "stage": "ai-builder-lab"}).json()
    assert [s["id"] for s in lab] == [i for i in expected if BY_ID[i].stage == "ai-builder-lab"]


MALFORMED = {
    "open-phrase": ('"tidewater labs', SEARCH_CASES["phrase-tidewater"][1]),
    "open-group": ("(agent OR ledger", ["d1-book-signing", "d1-campus-to-protocol", "d1-chat-to-trade", ZERO, NEVER, WALLET]),
    "trailing-or": ("agent OR", SEARCH_CASES["agent"][1]),
    "leading-or": ("OR agent", SEARCH_CASES["agent"][1]),
    "stray-close": ("agent)", SEARCH_CASES["agent"][1]),
    "double-operator": ("ledger AND OR keel", ["d1-book-signing", "d1-campus-to-protocol", CLONE, WELCOME, "d2-growing-ecosystem"]),
    "lone-minus": ("-", AGENDA_ORDER),
    "empty-pieces": ('agent () -""', SEARCH_CASES["agent"][1]),
}


@pytest.mark.parametrize("case", ["open-phrase", "open-group", "trailing-or", "leading-or", "stray-close",
                                  "double-operator", "lone-minus", "empty-pieces"],
                         ids=["open-phrase", "open-group", "trailing-or", "leading-or", "stray-close",
                              "double-operator", "lone-minus", "empty-pieces"])
def test_malformed_search_recovers(app_url: str, case: str) -> None:
    q, expected = MALFORMED[case]
    r = HTTP.get(app_url + "/api/v2/sessions", params={"q": q})
    assert r.status_code == 200, r.text
    assert [s["id"] for s in r.json()] == expected


def test_search_time_budget(app_url: str) -> None:
    w1 = "(" * W1_PARENS + "a" + ")" * W1_PARENS
    w2 = "a OR " * W2_REPEATS + "a"
    w3 = '"' + "\\" * W3_BACKSLASHES
    mixed = ('-("a\\" OR (b AND -' * SEARCH_MAX_CHARS)[:SEARCH_MAX_CHARS]
    with httpx.Client(timeout=HTTP_TIMEOUT_S) as client:
        assert client.get(app_url + "/api/v2/sessions").status_code == 200
        for q, expected in ((w1, AGENDA_ORDER), (w2, AGENDA_ORDER), (w3, []), (mixed, None), ("é" * SEARCH_MAX_CHARS, None)):
            assert len(q) <= SEARCH_MAX_CHARS
            request = client.build_request("GET", app_url + "/api/v2/sessions", params={"q": q})
            t0 = time.perf_counter()
            r = client.send(request)
            elapsed = time.perf_counter() - t0
            assert r.status_code == 200, r.text[:200]
            assert elapsed < SEARCH_BUDGET_S + TRANSPORT_MARGIN_S, (len(q), elapsed)
            if expected is not None:
                assert [s["id"] for s in r.json()] == expected
    err = v2_error(HTTP.get(app_url + "/api/v2/sessions", params={"q": "a" * (SEARCH_MAX_CHARS + 1)}), 422, "invalid")
    assert err["fields"]["q"] == FIELD_COPY["search"]


def test_wf_agenda_browse(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + board(day="2")) as page:
        cdp = elsewhere(page)
        loaded(page)
        click(page.get_by_role("tab", name=DAY_TABS[1], exact=True))
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1")
        select(page.get_by_role("combobox", name="Stage", exact=True), "AI Builder Lab")
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab")
        select(page.get_by_role("combobox", name="Format", exact=True), "Workshop")
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab&format=workshop")
        search = page.get_by_role("searchbox", name="Search sessions", exact=True)
        fill(search, "agent")
        search.press("Enter")
        eventually(page, lambda: text(status(page, "Agenda results")) == "2 sessions")
        assert path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab&format=workshop&q=agent"
        assert time_range(ZERO) in text(board_row(page, ZERO_T))
        fill(search, "")
        search.press("Enter")
        eventually(page, lambda: text(status(page, "Agenda results")) == "3 sessions")
        assert path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab&format=workshop"
        with page.expect_download() as info:
            click(page.get_by_role("link", name="Download Agenda", exact=True))
        _, events = calendar(Path(info.value.path()).read_bytes())
        api_ids = [s["id"] for s in get(app_url, api("v2", "/sessions", day="1", stage="ai-builder-lab",
                                                     format="workshop")).json()]
        assert [e["UID"] for e in events] == [f"{i}@keel-outpost" for i in api_ids] == [f"{i}@keel-outpost" for i in (CLONE, ZERO, NEVER)]
        click(page.get_by_role("tab", name=DAY_TABS[2], exact=True))
        eventually(page, lambda: path_query(page.url) == board(day="2", stage="ai-builder-lab", format="workshop"))
        eventually(page, lambda: board_titles(page) == [WALLET_T, MUSIC_T])
        assert text(status(page, "Agenda results")) == "2 sessions"
        assert page.get_by_text(VENUE_LINES[2], exact=True).count() == 1
        assert time_range(WALLET) in text(board_row(page, WALLET_T))
        with page.expect_download() as info:
            click(page.get_by_role("link", name="Download Agenda", exact=True))
        _, day2 = calendar(Path(info.value.path()).read_bytes())
        assert [e["DTSTART"] for e in day2] == [expected_event(WALLET)["DTSTART"], expected_event(MUSIC)["DTSTART"]]
        assert day2[0]["DTSTART"] == "20261101T150000Z"
        page.go_back()
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab&format=workshop")
        eventually(page, lambda: text(status(page, "Agenda results")) == "3 sessions")
        page.go_back()
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1&stage=ai-builder-lab&format=workshop&q=agent")
        eventually(page, lambda: text(status(page, "Agenda results")) == "2 sessions")
        del cdp


def test_saving_and_my_agenda(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "saver")
    for _ in range(2):
        r = act(app_url, p, "PUT", WELCOME, "save")
        assert r.status_code == 200 and r.json() == {"saved": True}
    assert len(rows_with("saved_sessions", p.id, WELCOME)) == 1
    for _ in range(2):
        r = act(app_url, p, "DELETE", WELCOME, "save")
        assert r.status_code == 200 and r.json() == {"saved": False}
    assert rows_with("saved_sessions", p.id, WELCOME) == []
    for sid in ("d2-quality-factor", "d1-happy-hour", WELCOME):
        assert act(app_url, p, "PUT", sid, "save").status_code == 200
    agenda = get(app_url, api("v2", "/me/agenda"), p.token).json()
    assert set(agenda) == set(V2_OBJECTS["my_agenda"])
    assert [s["id"] for s in agenda["saved"]] == [WELCOME, "d1-happy-hour", "d2-quality-factor"]
    assert agenda["reserved"] == agenda["held"] == agenda["waitlisted"] == []
    with open_app(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, p.email, NEW_PASSWORD)
        page.goto(app_url + "/my-agenda")
        eventually(page, lambda: page.get_by_role("heading", name="My Agenda", level=1, exact=True).count() == 1)
        heads = [page.get_by_role("heading", name=h, level=2, exact=True)
                 for h in ("Reserved seats", "Seats held for you", "Waitlist", "Saved sessions")]
        eventually(page, lambda: all(h.count() == 1 for h in heads))
        ys = [h.bounding_box()["y"] for h in heads]
        assert ys == sorted(ys)
        for line in ("You have not reserved any seats yet.", "No seats are being held for you.", "You are not on any waitlist."):
            assert page.get_by_text(line, exact=True).count() == 1
        for sid in (WELCOME, "d1-happy-hour", "d2-quality-factor"):
            assert page.get_by_text(BY_ID[sid].title, exact=True).count() >= 1
    with open_app(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, ORGANISER_EMAIL, PASSWORD)
        page.goto(app_url + "/my-agenda")
        copy = page.get_by_text("My Agenda is for attendees. Use the organiser page instead.", exact=False)
        eventually(page, lambda: copy.count() >= 1)
        assert page.get_by_role("heading", name="Reserved seats", exact=True).count() == 0
        hrefs = page.get_by_role("link").evaluate_all("els => els.map(e => e.getAttribute('href'))")
        assert any((h or "").rstrip("/").endswith("/organiser") for h in hrefs)


def test_booking_refusals_in_order(app_url: str) -> None:
    crowd = Crowd(app_url)
    org = organiser(app_url)
    org_id = get(app_url, api("v2", "/me"), org).json()["id"]
    try:
        v2_error(send(app_url, "POST", f"/api/v2/sessions/{NEVER}/reservation"), 401, "unauthenticated")
        v1_error(send(app_url, "POST", f"/api/v1/sessions/{NEVER}/reservation"), 401, "unauthenticated")
        v2_error(send(app_url, "POST", f"/api/v2/sessions/{UNKNOWN_SESSION}/reservation"), 401, "unauthenticated")
        for what, method in (("reservation", "POST"), ("waitlist", "POST"), ("claim", "POST"), ("save", "PUT")):
            v2_error(send(app_url, method, f"/api/v2/sessions/{NEVER}/{what}", org), 403, "forbidden")
        v2_error(send(app_url, "POST", f"/api/v2/sessions/{UNKNOWN_SESSION}/reservation", org), 403, "forbidden")
        v2_error(submit_guess(app_url, org, 5), 403, "forbidden")
        p, q = crowd.new("refusals"), crowd.new("refusals")
        v2_error(reserve(app_url, p, UNKNOWN_SESSION), 404, "not_found")
        v2_error(reserve(app_url, p, WELCOME), 409, "not_reservable")
        v1_error(reserve(app_url, p, WELCOME, "v1"), 409, "not_reservable")
        v2_error(act(app_url, p, "POST", WELCOME, "waitlist"), 409, "not_reservable")
        open_seats(app_url, NEVER, 1)
        assert reserve(app_url, p, NEVER).status_code == 201
        v2_error(reserve(app_url, p, NEVER), 409, "already_reserved")
        v2_error(act(app_url, p, "POST", NEVER, "waitlist"), 409, "already_reserved")
        v2_error(act(app_url, p, "POST", NEVER, "claim"), 409, "already_reserved")
        v2_error(act(app_url, p, "DELETE", NEVER, "hold"), 409, "no_hold")
        v2_error(act(app_url, q, "POST", NEVER, "claim"), 409, "no_hold")
        v2_error(act(app_url, q, "DELETE", NEVER, "hold"), 409, "no_hold")
        v2_error(act(app_url, q, "DELETE", NEVER, "reservation"), 409, "no_reservation")
        v2_error(act(app_url, q, "DELETE", NEVER, "waitlist"), 409, "not_waitlisted")
        v1_error(act(app_url, q, "DELETE", NEVER, "waitlist", "v1"), 409, "not_waitlisted")
        assert len(rows_with("reservations", p.id, NEVER)) == 1
        for table in ("reservations", "waitlist_entries", "holds", "saved_sessions"):
            assert rows_with(table, q.id) == [] and rows_with(table, org_id) == []
    finally:
        crowd.cleanup([NEVER])


def test_overlap_refused_touching_allowed(stage: str) -> None:
    crowd = Crowd(stage)
    sids = [HOTTEST, ZERO, CLONE]
    try:
        a = crowd.new("overlap")
        open_seats(stage, HOTTEST, 1)
        assert reserve(stage, a, HOTTEST).status_code == 201
        open_seats(stage, ZERO, 1)
        assert v2_error(reserve(stage, a, ZERO), 409, "time_conflict")["conflicts_with"] == HOTTEST
        assert v1_error(reserve(stage, a, ZERO, "v1"), 409, "time_conflict")["conflicts_with"] == HOTTEST
        crowd.occupy(ZERO)
        assert v2_error(reserve(stage, a, ZERO), 409, "time_conflict")["conflicts_with"] == HOTTEST
        assert rows_with("reservations", a.id, ZERO) == []
        assert act(stage, a, "DELETE", HOTTEST, "reservation").status_code == 200
        open_seats(stage, CLONE, 1)
        open_seats(stage, ZERO, 1)
        assert reserve(stage, a, CLONE).status_code == 201
        assert reserve(stage, a, ZERO).status_code == 201
        assert len(rows_with("reservations", a.id, CLONE)) == 1 and len(rows_with("reservations", a.id, ZERO)) == 1
        b, h = crowd.new("holdoverlap"), crowd.new("holder")
        open_seats(stage, HOTTEST, 1)
        assert reserve(stage, h, HOTTEST).status_code == 201
        assert act(stage, b, "POST", HOTTEST, "waitlist").status_code == 201
        assert act(stage, h, "DELETE", HOTTEST, "reservation").status_code == 200
        assert sess(stage, HOTTEST, b.token)["my_hold"] is not None
        open_seats(stage, CLONE, 1)
        assert v2_error(reserve(stage, b, CLONE), 409, "time_conflict")["conflicts_with"] == HOTTEST
        assert rows_with("reservations", b.id, CLONE) == []
    finally:
        crowd.cleanup(sids)


def test_last_seat_race(app_url: str) -> None:
    crowd = Crowd(app_url)
    try:
        racers = crowd.many(8, "lastseat")
        open_seats(app_url, MUSIC, 1)
        results = race([lambda c, p=p: reserve(app_url, p, MUSIC, client=c) for p in racers])
        assert sorted(r.status_code for r in results) == [201] + [409] * 7
        for r in results:
            if r.status_code == 409:
                v2_error(r, 409, "session_full")
        assert sum(len(rows_with("reservations", p.id, MUSIC)) for p in racers) == 1
        assert sess(app_url, MUSIC)["seats"]["left"] == 0
        dup = crowd.new("duplicate")
        open_seats(app_url, WALLET, 2)
        results = race([lambda c: reserve(app_url, dup, WALLET, client=c) for _ in range(6)])
        assert {r.status_code for r in results} <= {201, 409} and any(r.status_code == 201 for r in results)
        for r in results:
            if r.status_code == 409:
                v2_error(r, 409, "already_reserved")
        assert len(rows_with("reservations", dup.id, WALLET)) == 1
    finally:
        crowd.cleanup([MUSIC, WALLET])


def test_counts_from_stored_rows(stage: str) -> None:
    crowd = Crowd(stage)
    try:
        open_seats(stage, LLM, 1)
        f = crowd.occupy(LLM)[0]
        base = sess(stage, LLM)["waitlist_count"]
        ws = [crowd.new("count") for _ in range(3)]
        for i, w in enumerate(ws):
            assert act(stage, w, "POST", LLM, "waitlist").json()["waitlist"]["position"] == base + i + 1

        def agree() -> dict:
            s = sess(stage, LLM)
            assert s["waitlist_count"] == len(rows_with("waitlist_entries", LLM))
            assert s["seats"]["reserved"] == len(rows_with("reservations", LLM))
            assert s["seats"]["left"] == s["seats"]["capacity"] - s["seats"]["reserved"] - s["seats"]["held"]
            assert sess(stage, LLM, version="v1")["seats_left"] == s["seats"]["left"]
            assert organiser_row(stage, LLM, "v1")["reserved"] == s["seats"]["reserved"] + s["seats"]["held"]
            return s

        before = agree()
        assert act(stage, ws[0], "DELETE", LLM, "waitlist").status_code == 200
        assert sess(stage, LLM, ws[1].token)["waitlist_position"] == base + 1
        assert sess(stage, LLM, ws[2].token, "v1")["waitlist_position"] == base + 2
        assert act(stage, f, "DELETE", LLM, "reservation").status_code == 200
        after = agree()
        assert after["seats"]["held"] == before["seats"]["held"] + 1
        assert after["seats"]["reserved"] == before["seats"]["reserved"] - 1
        assert sess(stage, LLM, ws[2].token)["waitlist_position"] == base + 1
    finally:
        crowd.cleanup([LLM])


def test_idempotent_reservation_replay(app_url: str, peer: str) -> None:
    crowd = Crowd(app_url)
    try:
        p = crowd.new("idem")
        open_seats(app_url, NEVER, 1)
        key = idempotency_key()
        first = reserve(app_url, p, NEVER, key=key)
        assert first.status_code == 201, first.text
        for base in (app_url, peer):
            again = reserve(base, p, NEVER, key=key)
            assert again.status_code == 201 and again.content == first.content
        assert len(rows_with("reservations", p.id, NEVER)) == 1
        assert act(app_url, p, "DELETE", NEVER, "reservation").status_code == 200
        replay = reserve(app_url, p, NEVER, key=key)
        assert replay.status_code == 201 and replay.content == first.content
        assert rows_with("reservations", p.id, NEVER) == []
        open_seats(app_url, CLONE, 1)
        v2_error(reserve(app_url, p, CLONE, key=key), 422, "idempotency_key_reused")
        v1_error(reserve(app_url, p, NEVER, "v1", key=key), 422, "idempotency_key_reused")
        assert rows_with("reservations", p.id, CLONE) == []
        for bad in ("", "x" * 256, "has space"):
            v2_error(reserve(app_url, p, CLONE, key=bad), 400, "invalid")
        open_seats(app_url, WALLET, 1)
        crowd.occupy(WALLET)
        retry = idempotency_key()
        v2_error(reserve(app_url, p, WALLET, key=retry), 409, "session_full")
        open_seats(app_url, WALLET, 1)
        assert reserve(app_url, p, WALLET, key=retry).status_code == 201
        q = crowd.new("idemrace")
        open_seats(app_url, MUSIC, 1)
        shared = idempotency_key()
        results = race([lambda c: reserve(app_url, q, MUSIC, key=shared, client=c) for _ in range(6)])
        wins = [r for r in results if r.status_code == 201]
        assert wins and len({r.content for r in wins}) == 1
        for r in results:
            if r.status_code != 201:
                v2_error(r, 409, "request_in_progress")
        assert len(rows_with("reservations", q.id, MUSIC)) == 1
    finally:
        crowd.cleanup([NEVER, CLONE, WALLET, MUSIC])


def test_waitlist_join_position_leave(app_url: str) -> None:
    crowd = Crowd(app_url)
    try:
        open_seats(app_url, WALLET, 1)
        f = crowd.occupy(WALLET)[0]
        base = sess(app_url, WALLET)["waitlist_count"]
        a = crowd.new("waiter")
        r = act(app_url, a, "POST", WALLET, "waitlist")
        assert r.status_code == 201
        joined = r.json()["waitlist"]
        assert joined["session_id"] == WALLET and joined["position"] == base + 1
        assert sess(app_url, WALLET, a.token)["waitlist_position"] == base + 1
        assert sess(app_url, WALLET, a.token, "v1")["waitlist_position"] == base + 1
        v2_error(act(app_url, a, "POST", WALLET, "waitlist"), 409, "already_waitlisted")
        v2_error(act(app_url, f, "POST", WALLET, "waitlist"), 409, "already_reserved")
        left = act(app_url, a, "DELETE", WALLET, "waitlist")
        assert left.status_code == 200 and left.json() == {"waitlisted": False}
        v2_error(act(app_url, a, "DELETE", WALLET, "waitlist"), 409, "not_waitlisted")
        assert rows_with("waitlist_entries", a.id, WALLET) == []
        open_seats(app_url, LLM, 1)
        assert reserve(app_url, a, LLM).status_code == 201
        open_seats(app_url, MUSIC, 1)
        assert v2_error(act(app_url, a, "POST", MUSIC, "waitlist"), 409, "time_conflict")["conflicts_with"] == LLM
        b = crowd.new("waiter")
        v2_error(act(app_url, b, "POST", MUSIC, "waitlist"), 409, "seats_available")
        crowd.occupy(MUSIC)
        crowd.occupy(LLM)
        assert act(app_url, b, "POST", MUSIC, "waitlist").status_code == 201
        assert act(app_url, b, "POST", LLM, "waitlist").status_code == 201
    finally:
        crowd.cleanup([WALLET, LLM, MUSIC])


def test_freed_seat_held_for_oldest_waiter(stage: str) -> None:
    crowd = Crowd(stage)
    try:
        open_seats(stage, ZERO, 1)
        h = crowd.occupy(ZERO)[0]
        a, b, c = crowd.new("oldest"), crowd.new("next"), crowd.new("racer")
        for w in (a, b):
            assert act(stage, w, "POST", ZERO, "waitlist").status_code == 201
        b_pos = sess(stage, ZERO, b.token)["waitlist_position"]
        cancel, racer = race([lambda cl: act(stage, h, "DELETE", ZERO, "reservation", client=cl),
                              lambda cl: reserve(stage, c, ZERO, client=cl)])
        assert cancel.status_code == 200
        v2_error(racer, 409, "session_full")
        view = sess(stage, ZERO, a.token)
        hold = view["my_hold"]
        assert hold["session_id"] == ZERO and 0 < hold["seconds_remaining"] <= LONG_HOLD_SECONDS
        assert view["waitlist_position"] is None and view["seats"]["left"] == 0
        assert [x["session_id"] for x in holds_of(stage, a)] == [ZERO]
        assert rows_with("reservations", a.id, ZERO) == [] and rows_with("waitlist_entries", a.id, ZERO) == []
        assert sess(stage, ZERO, b.token)["waitlist_position"] == b_pos - 1
        assert hold_periods(ZERO, a.id) == [LONG_HOLD_SECONDS]
        row = organiser_row(stage, ZERO)
        raised = set_capacity(stage, ZERO, row["seats"]["capacity"] + 1)
        assert raised.status_code == 200 and raised.json()["seats"]["held"] == row["seats"]["held"] + 1
        assert sess(stage, ZERO, b.token)["my_hold"] is not None
        assert rows_with("reservations", b.id, ZERO) == []
    finally:
        crowd.cleanup([ZERO])


def test_promotion_cascade_across_sessions(stage: str) -> None:
    crowd = Crowd(stage)
    sids = [CLONE, HOTTEST, ZERO]
    try:
        open_seats(stage, CLONE, 2)
        d, b = crowd.new("d"), crowd.new("b")
        assert reserve(stage, d, CLONE).status_code == 201 and reserve(stage, b, CLONE).status_code == 201
        a, c = crowd.new("a"), crowd.new("c")
        assert act(stage, a, "POST", CLONE, "waitlist").status_code == 201
        open_seats(stage, HOTTEST, 1)
        assert reserve(stage, a, HOTTEST).status_code == 201
        assert act(stage, c, "POST", CLONE, "waitlist").status_code == 201
        before = sess(stage, CLONE)["seats"]
        assert act(stage, d, "DELETE", CLONE, "reservation").status_code == 200
        after = sess(stage, CLONE, a.token)
        assert sess(stage, CLONE, c.token)["my_hold"] is not None and after["my_hold"] is None
        assert after["waitlist_position"] is not None
        assert (after["seats"]["reserved"], after["seats"]["held"], after["seats"]["left"]) == (
            before["reserved"] - 1, before["held"] + 1, 0)
        set_capacity(stage, CLONE, after["seats"]["capacity"] + 1)
        assert sess(stage, CLONE, a.token)["seats"]["left"] == 1
        open_seats(stage, ZERO, 1)
        crowd.occupy(ZERO)
        assert act(stage, a, "POST", ZERO, "waitlist").status_code == 201
        set_capacity(stage, ZERO, organiser_row(stage, ZERO)["seats"]["capacity"] + 1)
        assert sess(stage, ZERO)["seats"]["left"] == 1
        assert act(stage, a, "DELETE", HOTTEST, "reservation").status_code == 200
        held_ids = [h["session_id"] for h in holds_of(stage, a)]
        assert sorted(held_ids) == sorted([CLONE, ZERO])
        for sid in (CLONE, ZERO):
            view = sess(stage, sid, a.token)
            assert view["waitlist_position"] is None and view["seats"]["left"] == 0

        e = crowd.new("e")
        for sid in (CLONE, HOTTEST):
            open_seats(stage, sid, 1)
            crowd.occupy(sid)
            assert act(stage, e, "POST", sid, "waitlist").status_code == 201
        set_capacity(stage, HOTTEST, organiser_row(stage, HOTTEST)["seats"]["capacity"] + 1)
        assert [h["session_id"] for h in holds_of(stage, e)] == [HOTTEST]
        set_capacity(stage, CLONE, organiser_row(stage, CLONE)["seats"]["capacity"] + 1)
        assert [h["session_id"] for h in holds_of(stage, e)] == [HOTTEST]
        assert sess(stage, CLONE)["seats"]["left"] == 1
        assert act(stage, e, "DELETE", HOTTEST, "hold").status_code == 200
        assert [h["session_id"] for h in holds_of(stage, e)] == [CLONE]

        mob = crowd.many(6, "mob")
        calls: list[Callable[[httpx.Client], Any]] = []
        for i, m in enumerate(mob):
            sid = sids[i % 3]
            calls += [lambda cl, m=m, sid=sid: reserve(stage, m, sid, client=cl),
                      lambda cl, m=m, sid=sid: act(stage, m, "POST", sid, "waitlist", client=cl),
                      lambda cl, m=m, sid=sid: act(stage, m, "DELETE", sid, "reservation", client=cl)]
        calls += [lambda cl, sid=sid: send(stage, "PATCH", f"/api/v2/organiser/sessions/{sid}", organiser(stage),
                                           body={"capacity": organiser_row(stage, sid)["seats"]["capacity"] + 1}, client=cl)
                  for sid in sids]
        calls += [lambda cl: act(stage, b, "DELETE", CLONE, "reservation", client=cl),
                  lambda cl: act(stage, c, "POST", CLONE, "claim", client=cl)]
        for r in race(calls):
            assert r.status_code < 500, r.text
            assert is_json(r)
        for sid in sids:
            seats = sess(stage, sid)["seats"]
            assert seats["reserved"] + seats["held"] <= seats["capacity"] and seats["left"] >= 0
    finally:
        crowd.cleanup(sids)


def test_claim_and_release_hold(stage: str, peer: str) -> None:
    crowd = Crowd(stage)
    late = Crowd(peer)
    try:
        open_seats(stage, NEVER, 1)
        h = crowd.occupy(NEVER)[0]
        a, b, c = crowd.new("claimer"), crowd.new("releaser"), crowd.new("reserver")
        for w in (a, b, c):
            assert act(stage, w, "POST", NEVER, "waitlist").status_code == 201
        assert act(stage, h, "DELETE", NEVER, "reservation").status_code == 200
        claimed = act(stage, a, "POST", NEVER, "claim")
        assert claimed.status_code == 201
        assert set(claimed.json()) == {"reservation", "seats"} and claimed.json()["reservation"]["session_id"] == NEVER
        assert len(rows_with("reservations", a.id, NEVER)) == 1 and holds_of(stage, a) == []
        v2_error(act(stage, a, "POST", NEVER, "claim"), 409, "already_reserved")
        v2_error(act(stage, a, "DELETE", NEVER, "hold"), 409, "no_hold")
        assert act(stage, a, "DELETE", NEVER, "reservation").status_code == 200
        assert sess(stage, NEVER, b.token)["my_hold"] is not None
        released = act(stage, b, "DELETE", NEVER, "hold")
        assert released.status_code == 200 and released.json() == {"held": False}
        v2_error(act(stage, b, "DELETE", NEVER, "hold"), 409, "no_hold")
        assert holds_of(stage, b) == [] and sess(stage, NEVER, b.token)["waitlist_position"] is None
        assert sess(stage, NEVER, c.token)["my_hold"] is not None
        assert reserve(stage, c, NEVER).status_code == 201
        assert len(rows_with("reservations", c.id, NEVER)) == 1

        open_seats(peer, MUSIC, 1)
        h2 = late.occupy(MUSIC)[0]
        d = late.new("expiring")
        assert act(peer, d, "POST", MUSIC, "waitlist").status_code == 201
        assert act(peer, h2, "DELETE", MUSIC, "reservation").status_code == 200
        hold = holds_of(peer, d)[0]
        wait_db_past(hold["held_until"])
        v2_error(act(peer, d, "POST", MUSIC, "claim"), 409, "hold_expired")
        v2_error(act(peer, d, "DELETE", MUSIC, "hold"), 409, "hold_expired")
        assert rows_with("reservations", d.id, MUSIC) == []
    finally:
        crowd.cleanup([NEVER])
        late.cleanup([MUSIC])


def test_hold_ends_on_db_clock_without_process() -> None:
    with app_copy(HOLD_SECONDS=str(SHORT_HOLD_SECONDS)) as first:
        crowd = Crowd(first.base)
        open_seats(first.base, LLM, 1)
        h = crowd.occupy(LLM)[0]
        a, b = crowd.new("sleeper"), crowd.new("heir")
        for w in (a, b):
            assert act(first.base, w, "POST", LLM, "waitlist").status_code == 201
        assert act(first.base, h, "DELETE", LLM, "reservation").status_code == 200
        held_until = holds_of(first.base, a)[0]["held_until"]
    wait_db_past(held_until)
    assert [e for e in seat_events(LLM, [a.id]) if e["kind"] == "expired"] == []
    with app_copy(HOLD_SECONDS=str(SHORT_HOLD_SECONDS)) as second:
        crowd.base = second.base
        try:
            assert sess(second.base, LLM, b.token)["my_hold"] is not None
            expired = [e for e in seat_events(LLM, [a.id]) if e["kind"] == "expired"]
            assert len(expired) == 1
            assert abs((parse_iso(expired[0]["at"]) - parse_iso(held_until)).total_seconds()) <= HOLD_AT_TOLERANCE_S
            assert [e["kind"] for e in seat_events(LLM, [b.id])] == ["promoted"]
        finally:
            crowd.cleanup([LLM])


def test_ended_holds_walk_waitlist_once(peer: str) -> None:
    with app_copy(HOLD_SECONDS=str(SHORT_HOLD_SECONDS)) as twin:
        crowd = Crowd(peer)
        try:
            open_seats(peer, WALLET, 1)
            h = crowd.occupy(WALLET)[0]
            ws = [crowd.new("walker") for _ in range(4)]
            for w in ws:
                assert act(peer, w, "POST", WALLET, "waitlist").status_code == 201
            assert act(peer, h, "DELETE", WALLET, "reservation").status_code == 200
            for w in ws:
                hold = holds_of(peer, w)
                assert [x["session_id"] for x in hold] == [WALLET]
                wait_db_past(hold[0]["held_until"])
                bases = [peer, twin.base] * 4
                for r in race([lambda cl, base=base: get(base, f"/api/v2/sessions/{WALLET}", client=cl) for base in bases]):
                    assert r.status_code == 200
            events = [(str(e["account_id"]), e["kind"]) for e in seat_events(WALLET, [w.id for w in ws])]
            assert events == [(str(w.id), k) for w in ws for k in ("promoted", "expired")]
            assert all(rows_with("reservations", w.id, WALLET) == [] for w in ws)
        finally:
            crowd.cleanup([WALLET])


def test_seat_event_log(stage: str) -> None:
    crowd = Crowd(stage)
    try:
        open_seats(stage, ZERO, 1)
        h = crowd.occupy(ZERO)[0]
        a, b = crowd.new("logged"), crowd.new("logged")
        for w in (a, b):
            assert act(stage, w, "POST", ZERO, "waitlist").status_code == 201
        assert act(stage, h, "DELETE", ZERO, "reservation").status_code == 200
        assert act(stage, a, "POST", ZERO, "claim").status_code == 201
        assert act(stage, a, "DELETE", ZERO, "reservation").status_code == 200
        assert act(stage, b, "DELETE", ZERO, "hold").status_code == 200
        events = seat_events(ZERO, [a.id, b.id])
        assert [(str(e["account_id"]), e["kind"]) for e in events] == [
            (str(a.id), "promoted"), (str(a.id), "claimed"), (str(b.id), "promoted"), (str(b.id), "surrendered")]
        assert [e["id"] for e in events] == sorted(e["id"] for e in events)
        ats = [parse_iso(e["at"]) for e in events]
        assert ats == sorted(ats)
    finally:
        crowd.cleanup([ZERO])


def test_wf_booking_keyboard_focus(browser: Browser, stage: str) -> None:
    crowd = Crowd(stage)
    try:
        p = crowd.new("keys")
        open_seats(stage, NEVER, 1)
        with open_app(browser, stage + "/signin") as page:
            ui_signin(page, stage, p.email, NEW_PASSWORD)
            page.goto(stage + "/agenda?day=1&stage=ai-builder-lab&format=workshop")
            reserve_btn = btn(page, f"Reserve seat for {NEVER_T}")
            eventually(page, lambda: reserve_btn.count() == 1)
            reserve_btn.focus()
            with held(page, "**" + api("v2", f"/sessions/{NEVER}/reservation")) as gate:
                page.keyboard.press("Enter")
                eventually(page, lambda: reserve_btn.get_attribute("aria-disabled") == "true")
                assert focused(reserve_btn) and reserve_btn.get_attribute("disabled") is None
                assert text(status(page, "Booking messages")) == "Reserving seat…"
                page.keyboard.press("Enter")
                gate.release()
            cancel = btn(page, f"Cancel reservation for {NEVER_T}")
            eventually(page, lambda: focused(cancel))
            assert text(status(page, "Booking messages")) == "Seat reserved."
            assert len(rows_with("reservations", p.id, NEVER)) == 1
            page.keyboard.press("Enter")
            eventually(page, lambda: text(status(page, "Booking messages")) == "Reservation cancelled. Your seat has been released.")
            eventually(page, lambda: focused(reserve_btn) or focused(btn(page, f"Join waitlist for {NEVER_T}")))
            assert not body_focused(page)
            save = btn(page, f"Save {NEVER_T}")
            save.focus()
            page.keyboard.press("Space")
            eventually(page, lambda: focused(btn(page, f"Saved {NEVER_T}")))
            assert text(status(page, "Booking messages")) == "Saved to My Agenda."
            open_seats(stage, NEVER, 1)
            crowd.occupy(NEVER)
            page.reload()
            join = btn(page, f"Join waitlist for {NEVER_T}")
            eventually(page, lambda: join.count() == 1)
            join.focus()
            page.keyboard.press("Enter")
            eventually(page, lambda: focused(btn(page, f"Leave waitlist for {NEVER_T}")))
            position = sess(stage, NEVER, p.token)["waitlist_position"]
            assert text(status(page, "Booking messages")) == f"You joined the waitlist. You are number {position}."
            assert act(stage, p, "DELETE", NEVER, "waitlist").status_code == 200
            assert act(stage, p, "PUT", WELCOME, "save").status_code == 200
            page.goto(stage + "/my-agenda")
            welcome_t = BY_ID[WELCOME].title
            first = btn(page, f"Saved {welcome_t}")
            eventually(page, lambda: first.count() == 1)
            first.focus()
            page.keyboard.press("Enter")
            never_row = page.get_by_role("listitem").filter(has_text=NEVER_T)
            eventually(page, lambda: never_row.count() == 1 and never_row.evaluate(
                "i => i.contains(document.activeElement) && (document.activeElement.tagName === 'BUTTON'"
                " || document.activeElement.getAttribute('role') === 'button')"))
            last = btn(page, f"Saved {NEVER_T}")
            last.focus()
            page.keyboard.press("Enter")
            eventually(page, lambda: focused(page.get_by_text("Nothing saved yet. Browse the agenda.", exact=True)))
            assert rows_with("saved_sessions", p.id) == []
    finally:
        crowd.cleanup([NEVER])


def test_wf_booking_reserve_journey(browser: Browser, stage: str) -> None:
    crowd = Crowd(stage)
    board = stage + "/agenda?day=1&stage=ai-builder-lab&format=workshop"
    try:
        p = crowd.new("reserver")
        open_seats(stage, CLONE, 1)
        open_seats(stage, ZERO, 1)
        h = crowd.occupy(ZERO)[0]
        with open_app(browser, stage + "/signin") as tab_a, open_app(browser, stage + "/signin") as tab_b:
            for tab in (tab_a, tab_b):
                ui_signin(tab, stage, p.email, NEW_PASSWORD)
                tab.goto(board)
            cdp = elsewhere(tab_a)
            reserve_btn = btn(tab_a, f"Reserve seat for {CLONE_T}")
            eventually(tab_a, lambda: reserve_btn.count() == 1)
            reserve_btn.focus()
            tab_a.keyboard.press("Enter")
            eventually(tab_a, lambda: focused(btn(tab_a, f"Cancel reservation for {CLONE_T}")))
            eventually(tab_b, lambda: btn(tab_b, f"Cancel reservation for {CLONE_T}").count() == 1, budget_ms=LIVE_REFRESH_MS)
            join = btn(tab_a, f"Join waitlist for {ZERO_T}")
            eventually(tab_a, lambda: join.count() == 1)
            click(join)
            eventually(tab_a, lambda: btn(tab_a, f"Leave waitlist for {ZERO_T}").count() == 1)
            position = sess(stage, ZERO, p.token)["waitlist_position"]
            assert text(status(tab_a, "Booking messages")) == f"You joined the waitlist. You are number {position}."
            assert act(stage, h, "DELETE", ZERO, "reservation").status_code == 200
            line = f"Seat held for you until {venue_clock(holds_of(stage, p)[0]['held_until'])}"
            eventually(tab_a, lambda: line in text(board_row(tab_a, ZERO_T)), budget_ms=LIVE_REFRESH_MS, message=line)
            click(btn(tab_a, f"Claim seat for {ZERO_T}"))
            eventually(tab_a, lambda: focused(btn(tab_a, f"Cancel reservation for {ZERO_T}")))
            assert text(status(tab_a, "Booking messages")) == "Seat claimed. It is yours."
            tab_a.goto(stage + "/my-agenda")
            eventually(tab_a, lambda: btn(tab_a, f"Cancel reservation for {ZERO_T}").count() == 1
                       and btn(tab_a, f"Cancel reservation for {CLONE_T}").count() == 1)
            assert tab_a.get_by_text("No seats are being held for you.", exact=True).count() == 1
            del cdp
        assert len(rows_with("reservations", p.id, CLONE)) == 1 and len(rows_with("reservations", p.id, ZERO)) == 1
    finally:
        crowd.cleanup([CLONE, ZERO])


def test_wf_booking_conflict_journey(browser: Browser, stage: str) -> None:
    crowd = Crowd(stage)
    try:
        p = crowd.new("conflict")
        open_seats(stage, HOTTEST, 1)
        assert reserve(stage, p, HOTTEST).status_code == 201
        open_seats(stage, CLONE, 1)
        crowd.occupy(CLONE)
        assert act(stage, p, "POST", CLONE, "waitlist").status_code == 201
        set_capacity(stage, CLONE, organiser_row(stage, CLONE)["seats"]["capacity"] + 1)
        assert sess(stage, CLONE, p.token)["seats"]["left"] == 1
        open_seats(stage, ZERO, 1)
        refusal = f'You already hold a seat in "{HOTTEST_T}" at that time.'
        with open_app(browser, stage + "/signin") as page:
            ui_signin(page, stage, p.email, NEW_PASSWORD)
            page.goto(stage + "/agenda?day=1")
            reserve_btn = btn(page, f"Reserve seat for {ZERO_T}")
            eventually(page, lambda: reserve_btn.count() == 1)
            reserve_btn.focus()
            page.keyboard.press("Enter")
            row = board_row(page, ZERO_T)
            eventually(page, lambda: refusal in text(row))
            assert text(status(page, "Booking messages")) == refusal
            link = row.get_by_role("link", name=HOTTEST_T, exact=True)
            assert link.get_attribute("href").endswith(f"/sessions/{HOTTEST}")
            assert focused(reserve_btn)
            page.keyboard.press("Tab")
            assert focused(link)
            assert rows_with("reservations", p.id, ZERO) == []
            click(btn(page, f"Cancel reservation for {HOTTEST_T}"))
            claim = btn(page, f"Claim seat for {CLONE_T}")
            eventually(page, lambda: claim.count() == 1)
            assert sess(stage, CLONE, p.token)["my_hold"] is not None
            assert rows_with("waitlist_entries", p.id, CLONE) == []
            click(claim)
            eventually(page, lambda: focused(btn(page, f"Cancel reservation for {CLONE_T}")))
        assert len(rows_with("reservations", p.id, CLONE)) == 1
    finally:
        crowd.cleanup([HOTTEST, CLONE, ZERO])


ORGANISER_ROUTES = [
    ("GET", "/organiser/sessions", None, True),
    ("GET", f"/organiser/sessions/{NEVER}/roster", None, True),
    ("GET", f"/organiser/sessions/{NEVER}/roster.csv", None, True),
    ("PATCH", f"/organiser/sessions/{NEVER}", {"capacity": 1}, True),
    ("PUT", "/organiser/speakers/jamal-khan/bio", {"bio": "taken over"}, False),
    ("POST", "/organiser/record/reveal", {"final_figure": 1}, True),
]


def test_organiser_only_actions(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "notorg")
    cap = organiser_row(app_url, NEVER)["seats"]["capacity"]
    bio = next(s for s in speakers_list(app_url) if s["slug"] == slug_of("Jamal Khan"))["bio"]
    before = contest_record(app_url).json()
    for method, path, body, in_v1 in ORGANISER_ROUTES:
        for version in (("v1", "v2") if in_v1 else ("v2",)):
            kw = {} if body is None else {"body": body}
            error_of(send(app_url, method, f"/api/{version}{path}", p.token, **kw), version, 403, "forbidden")
            error_of(send(app_url, method, f"/api/{version}{path}", None, **kw), version, 401, "unauthenticated")
    assert organiser_row(app_url, NEVER)["seats"]["capacity"] == cap
    assert next(s for s in speakers_list(app_url) if s["slug"] == slug_of("Jamal Khan"))["bio"] == bio
    after = contest_record(app_url).json()
    assert (after["status"], after["final_figure"]) == (before["status"], before["final_figure"])
    with open_app(browser, app_url + "/organiser") as page:
        eventually(page, lambda: urlparse(page.url).path == "/signin")
        assert parse_qs(urlparse(page.url).query)["next"] == ["/organiser"]
        ui_signin(page, app_url, p.email, NEW_PASSWORD)
        page.goto(app_url + "/organiser")
        eventually(page, lambda: page.get_by_text("This page is for the organiser only.", exact=True).count() >= 1)
        assert page.get_by_role("table", name="Reservable sessions", exact=True).count() == 0
        assert btn(page, "Reveal result").count() == 0


def test_reservable_sessions_table(browser: Browser, app_url: str) -> None:
    rows = get(app_url, api("v2", "/organiser/sessions"), organiser(app_url)).json()
    assert sorted(r["id"] for r in rows) == sorted(RESERVABLE)
    for r in rows:
        seed = BY_ID[r["id"]]
        assert (r["title"], r["day"], r["start_local"], r["end_local"]) == (seed.title, seed.day, seed.start, seed.end)
        s = r["seats"]
        assert s["left"] == s["capacity"] - s["reserved"] - s["held"]
        assert sess(app_url, r["id"])["seats"] == s
    v1 = {r["id"]: r for r in get(app_url, api("v1", "/organiser/sessions"), organiser(app_url)).json()}
    for r in rows:
        assert set(v1[r["id"]]) == set(V1_OBJECTS["organiser_row"])
        assert v1[r["id"]]["reserved"] == r["seats"]["reserved"] + r["seats"]["held"]
        assert v1[r["id"]]["seats_left"] == r["seats"]["left"]
    with open_app(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, ORGANISER_EMAIL, PASSWORD)
        page.goto(app_url + "/organiser")
        table = page.get_by_role("table", name="Reservable sessions", exact=True)
        eventually(page, lambda: table.count() == 1)
        headers = [" ".join(h.split()) for h in table.get_by_role("columnheader").all_inner_texts()]
        assert headers == ["Title", "Day", "Time", "Capacity", "Reserved", "Held", "Seats left", "Waitlisted"]
        for r in rows:
            row = table.get_by_role("row").filter(has_text=r["title"])
            eventually(page, lambda row=row: row.count() == 1)
            s = r["seats"]
            assert row_numbers(row)[-5:] == [str(x) for x in (s["capacity"], s["reserved"], s["held"], s["left"], r["waitlisted"])]
            assert btn(row, f"View roster for {r['title']}").count() == 1


def test_paged_roster_stable(stage: str) -> None:
    crowd = Crowd(stage)
    org = organiser(stage)
    try:
        open_seats(stage, NEVER, 7)
        ps = [crowd.new("roster") for _ in range(7)]
        for p in ps:
            assert reserve(stage, p, NEVER).status_code == 201
        w = crowd.new("rosterwait")
        assert act(stage, w, "POST", NEVER, "waitlist").status_code == 201

        def walk(prefix: str, limit: int, between: Callable[[], None] | None = None) -> list[dict]:
            url = f"{prefix}/organiser/sessions/{NEVER}/roster?limit={limit}"
            pattern = re.compile(rf'^<({re.escape(prefix)}/organiser/sessions/{NEVER}/roster\?limit={limit}&cursor=[^>]+)>; rel="next"$')
            out: list[dict] = []
            first = True
            for _ in range(MAX_ROSTER_PAGES * 5):
                r = get(stage, url, org)
                assert r.status_code == 200, r.text
                page_rows = r.json()
                assert len(page_rows) <= limit and all(set(x) == {"name", "email", "reserved_at"} for x in page_rows)
                out += page_rows
                link = r.headers.get("Link")
                if first and between:
                    between()
                first = False
                if not link:
                    return out
                m = pattern.match(link)
                assert m, link
                url = m.group(1)
            raise AssertionError("roster never ended")

        def churn() -> None:
            assert act(stage, ps[1], "DELETE", NEVER, "reservation").status_code == 200
            assert act(stage, w, "POST", NEVER, "claim").status_code == 201
            assert act(stage, ps[5], "DELETE", NEVER, "reservation").status_code == 200

        seen = [r["email"] for r in walk("/api/v2", 3, churn)]
        assert len(seen) == len(set(seen))
        ours = [e for e in seen if e in {p.email for p in ps} | {w.email}]
        throughout = [ps[i].email for i in (0, 2, 3, 4, 6)]
        assert [e for e in ours if e in throughout] == throughout
        assert ps[5].email not in seen and ours[-1] == w.email
        for prefix in ("/api/v1", "/api"):
            emails = [r["email"] for r in walk(prefix, 2)]
            assert len(emails) == len(set(emails)) and all(e in emails for e in throughout)
        roster = f"/organiser/sessions/{NEVER}/roster"
        first = get(stage, api("v2", roster, limit="1"), org)
        cursor = parse_qs(urlparse(first.headers["Link"][1:].split(">")[0]).query)["cursor"][0]
        assert get(stage, api("v1", roster, limit="1", cursor=cursor), org).status_code == 200
        for bad in ("0", str(ROSTER_LIMIT_MAX + 1), "abc", "2.5"):
            err = v2_error(get(stage, api("v2", roster, limit=bad), org), 422, "invalid")
            assert err["fields"]["limit"] == FIELD_COPY["limit"]
        err = v2_error(get(stage, api("v2", roster, cursor="garbage"), org), 422, "invalid")
        assert err["fields"]["cursor"] == FIELD_COPY["cursor"]
        err = v2_error(get(stage, api("v2", f"/organiser/sessions/{ZERO}/roster", cursor=cursor), org), 422, "invalid")
        assert err["fields"]["cursor"] == FIELD_COPY["cursor"]
        v2_error(get(stage, api("v2", f"/organiser/sessions/{WELCOME}/roster"), org), 409, "not_reservable")
    finally:
        crowd.cleanup([NEVER])


def test_capacity_bounds_and_raise(stage: str) -> None:
    crowd = Crowd(stage)
    try:
        open_seats(stage, MUSIC, 1)
        crowd.occupy(MUSIC)
        row = organiser_row(stage, MUSIC)
        count = row["seats"]["reserved"] + row["seats"]["held"]
        for bad in (0, CAPACITY_MAX + 1, "5", 2.5, None):
            err = v2_error(set_capacity(stage, MUSIC, bad), 422, "invalid")
            assert err["fields"]["capacity"] == FIELD_COPY["capacity"]
        v2_error(set_capacity(stage, WELCOME, 5), 409, "not_reservable")
        if count > 1:
            err = v2_error(set_capacity(stage, MUSIC, count - 1), 409, "below_reserved")
            assert err["reserved"] == count and str(count) in err["message"]
            body = v1_error(set_capacity(stage, MUSIC, count - 1, "v1"), 409, "below_reserved")
            assert body["reserved"] == count
        assert organiser_row(stage, MUSIC)["seats"]["capacity"] == row["seats"]["capacity"]
        ws = [crowd.new("raise") for _ in range(2)]
        for w in ws:
            assert act(stage, w, "POST", MUSIC, "waitlist").status_code == 201
        before = organiser_row(stage, MUSIC)
        r = set_capacity(stage, MUSIC, before["seats"]["capacity"] + 2)
        assert r.status_code == 200
        after = r.json()
        assert after["seats"]["held"] == before["seats"]["held"] + 2
        assert after["waitlisted"] == before["waitlisted"] - 2 and after["seats"]["left"] == 0
        assert all(sess(stage, MUSIC, w.token)["my_hold"] is not None for w in ws)
        row = organiser_row(stage, MUSIC)
        if row["seats"]["reserved"] + row["seats"]["held"] <= CAPACITY_MAX:
            assert set_capacity(stage, MUSIC, CAPACITY_MAX).json()["seats"]["capacity"] == CAPACITY_MAX
    finally:
        crowd.cleanup([MUSIC])


def test_capacity_races_reservations(app_url: str) -> None:
    crowd = Crowd(app_url)
    try:
        racers = crowd.many(10, "caprace")
        row = open_seats(app_url, LLM, 6)
        base = row["seats"]["reserved"] + row["seats"]["held"]
        calls = [lambda c, p=p: reserve(app_url, p, LLM, client=c) for p in racers]
        calls += [lambda c, k=k: send(app_url, "PATCH", f"/api/v2/organiser/sessions/{LLM}", organiser(app_url),
                                      body={"capacity": base + k}, client=c) for k in range(1, 6)]
        results = race(calls)
        for r in results[:10]:
            assert r.status_code == 201 or v2_error(r, 409, "session_full")
        for k, r in zip(range(1, 6), results[10:]):
            if r.status_code != 200:
                err = v2_error(r, 409, "below_reserved")
                assert err["reserved"] > base + k and str(err["reserved"]) in err["message"]
        seats = sess(app_url, LLM)["seats"]
        assert seats["reserved"] + seats["held"] <= seats["capacity"] and seats["left"] >= 0
        assert len(rows_with("reservations", LLM)) == seats["reserved"]
    finally:
        crowd.cleanup([LLM])


CSV_NAMES = ['=HYPERLINK("http://x","y")', "+SUM(1)", "-2+3", "@cmd", "\tTabbed", "Lee, Jr.", 'Say "hi"']


def test_roster_csv_neutralised(app_url: str) -> None:
    crowd = Crowd(app_url)
    try:
        open_seats(app_url, NEVER, len(CSV_NAMES))
        people = [crowd.new("csv", name=n) for n in CSV_NAMES]
        for p in people:
            assert reserve(app_url, p, NEVER).status_code == 201
        r = get(app_url, api("v2", f"/organiser/sessions/{NEVER}/roster.csv"), organiser(app_url))
        assert r.status_code == 200
        assert media_type(r) == "text/csv; charset=utf-8"
        assert r.headers["Content-Disposition"] == f'attachment; filename="roster-{NEVER}.csv"'
        assert r.content.count(b"\n") == r.content.count(b"\r\n") and r.content.endswith(b"\r\n")
        quoted = '"' + CSV_NAMES[6].replace('"', '""') + '"'
        assert quoted.encode() in r.content
        table = list(csv.reader(io.StringIO(r.content.decode("utf-8"), newline="")))
        assert table[0] == ["name", "email", "reserved_at"]
        body = table[1:]
        assert all(len(row) == 3 for row in body)
        assert len(body) == sess(app_url, NEVER)["seats"]["reserved"]
        by_email = {row[1]: row for row in body}
        for p, original in zip(people, CSV_NAMES):
            cell = by_email[p.email][0]
            assert cell == ("'" + original if original[0] in ("=", "+", "-", "@", "\t") else original), (original, cell)
        assert by_email[people[0].email][0] == "'=HYPERLINK(\"http://x\",\"y\")"
        order = [row[1] for row in body if row[1] in {p.email for p in people}]
        assert order == [p.email for p in people]
    finally:
        crowd.cleanup([NEVER])


def test_bio_editing(browser: Browser, app_url: str) -> None:
    slug = slug_of("Jamal Khan")
    org = organiser(app_url)
    path = api("v2", f"/organiser/speakers/{slug}/bio")
    try:
        r = send(app_url, "PUT", path, org, body={"bio": "foo*bar*baz"})
        assert r.status_code == 200
        assert {k: r.json()[k] for k in ("slug", "name", "company", "bio", "bio_html")} == {
            "slug": slug, "name": "Jamal Khan", "company": "Keel Foundation", "bio": "foo*bar*baz", "bio_html": "foo<em>bar</em>baz"}
        assert next(s for s in speakers_list(app_url) if s["slug"] == slug)["bio_html"] == "foo<em>bar</em>baz"
        assert set(next(s for s in speakers_list(app_url, "v1") if s["name"] == "Jamal Khan")) == set(V1_OBJECTS["speaker"])
        with open_app(browser, app_url + "/speakers") as page:
            tile = page.get_by_role("list", name="Speakers", exact=True).get_by_role("listitem").filter(has_text="Jamal Khan")
            eventually(page, lambda: "foo<em>bar</em>baz" in tile.inner_html())
            page.goto(app_url + "/sessions/" + "d2-growing-ecosystem")
            eventually(page, lambda: "foo<em>bar</em>baz" in page.content())
        for ok in ("a" * BIO_MAX_CHARS, "é" * BIO_MAX_CHARS, ""):
            assert send(app_url, "PUT", path, org, body={"bio": ok}).status_code == 200
        for bad in ("a" * (BIO_MAX_CHARS + 1), 123):
            err = v2_error(send(app_url, "PUT", path, org, body={"bio": bad}), 422, "invalid")
            assert err["fields"]["bio"] == FIELD_COPY["bio"]
        v2_error(send(app_url, "PUT", api("v2", f"/organiser/speakers/{UNKNOWN_SESSION}/bio"), org, body={"bio": ""}),
                 404, "not_found")
    finally:
        send(app_url, "PUT", path, org, body={"bio": ""})


def test_wf_organiser_journey(browser: Browser, stage: str) -> None:
    crowd = Crowd(stage)
    try:
        open_seats(stage, NEVER, ROSTER_JOURNEY_RESERVED)
        people = crowd.many(ROSTER_JOURNEY_RESERVED, "door")
        for p in people:
            assert reserve(stage, p, NEVER).status_code == 201
        waiters = [crowd.new("doorwait") for _ in range(2)]
        for w in waiters:
            assert act(stage, w, "POST", NEVER, "waitlist").status_code == 201
        before = organiser_row(stage, NEVER)
        total = before["seats"]["reserved"]
        with open_app(browser, stage + "/signin") as page:
            ui_signin(page, stage, ORGANISER_EMAIL, PASSWORD)
            page.goto(stage + "/organiser")
            view = btn(page, f"View roster for {NEVER_T}")
            eventually(page, lambda: view.count() == 1)
            click(view)
            region = page.get_by_role("region", name=f"Roster for {NEVER_T}", exact=True)
            rows = region.get_by_role("table").first.get_by_role("row")
            eventually(page, lambda: rows.count() > 1)
            more = btn(region, "Show more reserved attendees")
            for _ in range(MAX_ROSTER_PAGES):
                if more.count() == 0:
                    break
                count = rows.count()
                click(more)
                eventually(page, lambda count=count: rows.count() > count or more.count() == 0)
            assert more.count() == 0 and rows.count() - 1 == total
            shown = text(region)
            assert all(p.email in shown for p in people)
            with page.expect_download() as info:
                click(btn(region, f"Download roster for {NEVER_T}"))
            assert info.value.suggested_filename == f"roster-{NEVER}.csv"
            data = list(csv.reader(io.StringIO(Path(info.value.path()).read_text(), newline="")))
            assert len(data) - 1 == total
            fill(region.get_by_role("textbox", name="Capacity", exact=True), str(before["seats"]["capacity"] + 2))
            click(btn(region, "Save capacity"))
            eventually(page, lambda: text(status(page, "Organiser messages")) == "Capacity saved.")
            table_row = page.get_by_role("table", name="Reservable sessions", exact=True).get_by_role("row").filter(has_text=NEVER_T)
            want = [str(before["seats"]["held"] + 2), "0", str(before["waitlisted"] - 2)]
            eventually(page, lambda: row_numbers(table_row)[-3:] == want, budget_ms=LIVE_REFRESH_MS)
        after = organiser_row(stage, NEVER)
        assert after["seats"]["held"] == before["seats"]["held"] + 2 and after["seats"]["left"] == 0
        assert all(sess(stage, NEVER, w.token)["my_hold"] is not None for w in waiters)
    finally:
        crowd.cleanup([NEVER])


def test_wf_organiser_capacity_refusal(browser: Browser, app_url: str) -> None:
    crowd = Crowd(app_url)
    try:
        open_seats(app_url, MUSIC, 2)
        crowd.occupy(MUSIC)
        row = organiser_row(app_url, MUSIC)
        count = row["seats"]["reserved"] + row["seats"]["held"]
        with open_app(browser, app_url + "/signin") as page:
            ui_signin(page, app_url, ORGANISER_EMAIL, PASSWORD)
            page.goto(app_url + "/organiser")
            view = btn(page, f"View roster for {MUSIC_T}")
            eventually(page, lambda: view.count() == 1)
            click(view)
            region = page.get_by_role("region", name=f"Roster for {MUSIC_T}", exact=True)
            box = region.get_by_role("textbox", name="Capacity", exact=True)
            fill(box, "0")
            click(btn(region, "Save capacity"))
            summary = page.get_by_role("alert").filter(has=page.get_by_role("heading", name="There is a problem", exact=True))
            eventually(page, lambda: summary.get_by_role("link", name=FIELD_COPY["capacity"], exact=True).count() == 1)
            assert box.input_value() == "0" and box.get_attribute("aria-invalid") == "true"
            fill(box, str(count - 1))
            click(btn(region, "Save capacity"))
            copy = f"Capacity cannot be lower than the {count} seats already reserved or held."
            eventually(page, lambda: text(status(page, "Organiser messages")) == copy)
        assert organiser_row(app_url, MUSIC)["seats"]["capacity"] == row["seats"]["capacity"]
    finally:
        crowd.cleanup([MUSIC])


def test_one_private_guess(contest: str) -> None:
    assert contest_record(contest).json()["status"] == "open"
    p, q = signup(contest, "guesser"), signup(contest, "peeker")
    values = [100001 + i for i in range(6)]
    results = race([lambda c, v=v: submit_guess(contest, p.token, v, client=c) for v in values])
    wins = [r for r in results if r.status_code == 201]
    assert len(wins) == 1
    for r in results:
        if r.status_code != 201:
            v2_error(r, 409, "already_guessed")
    won = wins[0].json()["guess"]["value"]
    assert len(rows_with("guesses", p.id)) == 1
    mine = contest_record(contest, p.token).json()
    assert mine["my_guess"]["value"] == won and mine["leaderboard"] == []
    theirs = contest_record(contest, q.token)
    assert theirs.json()["my_guess"] is None and str(won) not in theirs.text and theirs.json()["guess_count"] >= 1
    for bad in (0, GUESS_MAX + 1, 2.5, "7", None):
        err = v2_error(submit_guess(contest, q.token, bad), 422, "invalid")
        assert "value" in err["fields"]
    assert rows_with("guesses", q.id) == []
    for edge in (1, GUESS_MAX):
        r = submit_guess(contest, signup(contest, "edge").token, edge)
        assert r.status_code == 201 and r.json()["guess"]["value"] == edge


def test_guessing_cutoff_on_db_clock(browser: Browser) -> None:
    closes = iso_z(int(db_now()) + CUTOFF_LEAD_S)
    with app_copy(CONTEST_CLOSES_AT=closes) as copy:
        opening = contest_record(copy.base).json()
        assert opening["status"] == "open" and parse_iso(opening["closes_at"]) == parse_iso(closes)
        p, q = signup(copy.base, "beforecut"), signup(copy.base, "aftercut")
        value = 2000000
        r = submit_guess(copy.base, p.token, value)
        assert r.status_code == 201 and parse_iso(r.json()["guess"]["created_at"]) < parse_iso(closes)
        wait_db_past(closes)
        v2_error(submit_guess(copy.base, q.token, value), 409, "contest_closed")
        v1_error(submit_guess(copy.base, q.token, value, "v1"), 409, "contest_closed")
        assert rows_with("guesses", q.id) == []
        assert contest_record(copy.base).json()["status"] == "closed"
        assert contest_record(copy.base, version="v1").json()["status"] == "closed"
        with open_app(browser, copy.base + "/signin") as page:
            ui_signin(page, copy.base, p.email, NEW_PASSWORD)
            page.goto(copy.base + "/record")
            eventually(page, lambda: page.get_by_text("Guessing has closed. The result is coming soon.", exact=True).count() == 1)
            assert page.get_by_text(f"Your guess: {value:,} TPS", exact=True).count() == 1
            assert page.get_by_role("textbox", name="Your guess", exact=True).count() == 0


def test_wf_contest_invalid_guess(browser: Browser, contest: str) -> None:
    p = signup(contest, "fixer")
    with open_app(browser, contest + "/signin") as page:
        ui_signin(page, contest, p.email, NEW_PASSWORD)
        page.goto(contest + "/record")
        box = page.get_by_role("textbox", name="Your guess", exact=True)
        eventually(page, lambda: box.count() == 1)
        fill(box, "0")
        click(btn(page, "Submit your guess"))
        summary = page.get_by_role("alert").filter(has=page.get_by_role("heading", name="There is a problem", exact=True))
        link = summary.get_by_role("link", name=FIELD_COPY["guess"], exact=True)
        eventually(page, lambda: link.count() == 1)
        assert box.input_value() == "0" and box.get_attribute("aria-invalid") == "true"
        assert rows_with("guesses", p.id) == []
        click(link)
        eventually(page, lambda: focused(box))
        fill(box, "6000000")
        click(btn(page, "Submit your guess"))
        eventually(page, lambda: page.get_by_text("Your guess: 6,000,000 TPS", exact=True).count() == 1)
    assert contest_record(contest, p.token).json()["my_guess"]["value"] == 6000000
    assert len(rows_with("guesses", p.id)) == 1


_REVEAL: dict[str, Any] = {}


def reveal_once(browser: Browser, contest: str, extra: list[tuple[Person, int]] | None = None) -> dict[str, Any]:
    if _REVEAL:
        return _REVEAL
    base_figure = random.randrange(50000000, 90000000)
    figures = [base_figure + i * 20000 for i in range(5)]
    ours: list[tuple[Person, int]] = list(extra or [])
    for f in figures:
        for v in (f - 10, f + 10):
            g = signup(contest, "Pair Guesser")
            assert send(contest, "POST", "/api/v2/record/guesses", g.token, body={"value": v}).status_code == 201
            ours.append((g, v))
    late = [signup(contest, "Late Guesser") for _ in range(3)]
    with open_app(browser, contest + "/signin") as org_page:
        ui_signin(org_page, contest, ORGANISER_EMAIL, PASSWORD)
        org_page.goto(contest + "/organiser")
        fill(org_page.get_by_role("textbox", name="Final figure", exact=True), str(figures[0]))
        calls = [lambda c, f=f: send(contest, "POST", "/api/v2/organiser/record/reveal", organiser(contest),
                                     body={"final_figure": f}, client=c) for f in figures[1:]]
        calls += [lambda c, g=g, k=k: send(contest, "POST", "/api/v2/record/guesses", g.token,
                                           body={"value": base_figure + 1000000 + k}, client=c) for k, g in enumerate(late)]
        barrier = threading.Barrier(len(calls) + 1)

        def run(call: Callable[[httpx.Client], Any]) -> Any:
            with httpx.Client(timeout=HTTP_TIMEOUT_S) as client:
                barrier.wait()
                return call(client)

        with held(org_page, "**/organiser/record/reveal") as gate:
            click(btn(org_page, "Reveal result"))
            with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
                futures = [pool.submit(run, call) for call in calls]
                barrier.wait()
                gate.release()
                results = [f.result() for f in futures]
        eventually(org_page, lambda: text(status(org_page, "Organiser messages")) in
                   {"Result revealed.", "The result has already been revealed."})
        ui_won = text(status(org_page, "Organiser messages")) == "Result revealed."
    reveals, guesses = results[:4], results[4:]
    api_wins = [f for f, r in zip(figures[1:], reveals) if r.status_code == 200]
    winner = figures[0] if ui_won else (api_wins[0] if api_wins else None)
    for g, r in zip(late, guesses):
        if r.status_code == 201:
            ours.append((g, r.json()["guess"]["value"]))
    _REVEAL.update(figures=figures, reveals=reveals, ui_won=ui_won, api_wins=api_wins, winner=winner,
                   late=list(zip(late, guesses)), ours=ours)
    return _REVEAL


def expected_leaders(state: dict[str, Any]) -> list[dict[str, Any]]:
    winner = state["winner"]
    ranked = sorted(enumerate(state["ours"]), key=lambda iv: (abs(iv[1][1] - winner), iv[0]))[:3]
    return [{"rank": i + 1, "display_name": display_name(person.name), "value": v, "distance": abs(v - winner)}
            for i, (_, (person, v)) in enumerate(ranked)]


def test_wf_contest_journey(browser: Browser, contest: str) -> None:
    assert contest_record(contest).json()["status"] == "open"
    p = signup(contest, "Contest Player")
    mine = random.randrange(50000000, 90000000)
    with open_app(browser, contest + "/signin") as page:
        cdp = elsewhere(page)
        ui_signin(page, contest, p.email, NEW_PASSWORD)
        page.goto(contest + "/record")
        cutoff = venue_cutoff(contest_record(contest).json()["closes_at"])
        eventually(page, lambda: page.get_by_text(f"Guessing closes {cutoff} Port Ashby time.", exact=True).count() == 1)
        fill(page.get_by_role("textbox", name="Your guess", exact=True), str(mine))
        click(btn(page, "Submit your guess"))
        eventually(page, lambda: page.get_by_text(f"Your guess: {mine:,} TPS", exact=True).count() == 1)
        assert text(status(page, "Contest messages")) == "Guess received. Good luck."
        assert page.get_by_role("textbox", name="Your guess", exact=True).count() == 0
        assert len(rows_with("guesses", p.id)) == 1
        state = reveal_once(browser, contest, [(p, mine)])
        winner = state["winner"]
        assert winner is not None
        eventually(page, lambda: page.get_by_text(f"Final figure: {winner:,} TPS", exact=True).count() == 1,
                   budget_ms=LIVE_REFRESH_MS)
        table_rows = page.get_by_role("table", name="Closest guesses", exact=True).get_by_role("row")
        assert table_rows.count() == 4
        for i, leader in enumerate(expected_leaders(state), start=1):
            assert leader["display_name"] in text(table_rows.nth(i))
        assert page.get_by_text(f"Your guess: {mine:,} TPS", exact=True).count() == 1
        del cdp
    assert contest_record(contest, p.token).json()["my_guess"]["value"] == mine


def test_reveal_once_ranked(browser: Browser, contest: str) -> None:
    state = reveal_once(browser, contest)
    winner = state["winner"]
    assert winner is not None
    revealed = contest_record(contest).json()
    assert revealed["status"] == "revealed" and revealed["final_figure"] == winner
    leaders = expected_leaders(state)
    assert revealed["leaderboard"] == leaders
    assert [x["value"] for x in revealed["leaderboard"][:2]] == [winner - 10, winner + 10]
    v1 = contest_record(contest, version="v1").json()
    assert v1["status"] == "revealed" and v1["final_figure"] == winner and v1["leaderboard"] == leaders
    v2_error(reveal_figure(contest, winner + 1), 409, "already_revealed")
    v1_error(reveal_figure(contest, winner + 2, "v1"), 409, "already_revealed")
    assert contest_record(contest).json()["final_figure"] == winner


def test_reveal_races_late_guesses(browser: Browser, contest: str) -> None:
    state = reveal_once(browser, contest)
    for r in state["reveals"]:
        if r.status_code != 200:
            v2_error(r, 409, "already_revealed")
    assert len(state["api_wins"]) + int(state["ui_won"]) == 1
    revealed = contest_record(contest).json()
    assert revealed["final_figure"] == state["winner"]
    revealed_at = parse_iso(revealed["revealed_at"])
    for g, r in state["late"]:
        own = contest_record(contest, g.token).json()["my_guess"]
        if r.status_code == 201:
            assert own is not None and parse_iso(own["created_at"]) < revealed_at
        else:
            v2_error(r, 409, "contest_closed")
            assert own is None and rows_with("guesses", g.id) == []


def test_wf_pages_not_found(browser: Browser, app_url: str) -> None:
    assert HTTP.get(app_url + f"/sessions/{UNKNOWN_SESSION}").status_code == 200
    for path in (UNKNOWN_PAGE, "/API/sessions", "/Api/v2/sessions"):
        r = HTTP.get(app_url + path)
        assert r.status_code == 404 and media_type(r).startswith("text/html")
    v2_error(get(app_url, f"/api/v2/sessions/{UNKNOWN_SESSION}"), 404, "not_found")
    for path, copy in ((f"/sessions/{UNKNOWN_SESSION}", "We could not find that session."),
                       (UNKNOWN_PAGE, "We could not find that page.")):
        with open_app(browser, app_url + path) as page:
            eventually(page, lambda copy=copy: page.get_by_text(copy).count() >= 1)
            assert page.get_by_role("navigation", name="Main", exact=True).count() == 1
            assert page.get_by_role("contentinfo").count() == 1
            hrefs = page.get_by_role("link").evaluate_all("els => els.map(e => e.getAttribute('href'))")
            assert sum(1 for h in hrefs if (h or "").split("?")[0] in ("/agenda", app_url + "/agenda")) >= 2


def test_wf_pages_form_errors(browser: Browser, app_url: str) -> None:
    name, email = names("formfix")
    with open_app(browser, app_url + "/signup") as page:
        name_box = page.get_by_role("textbox", name="Name", exact=True)
        email_box = page.get_by_role("textbox", name="Email", exact=True)
        password_box = page.get_by_label("Password", exact=True)
        fill(email_box, BAD_EMAIL)
        fill(password_box, SHORT_PASSWORD)
        click(btn(page, "Create account"))
        summary = page.get_by_role("alert").filter(has=page.get_by_role("heading", name="There is a problem", exact=True))
        eventually(page, lambda: summary.count() == 1)
        for msg in (FIELD_COPY["name"], FIELD_COPY["email"], FIELD_COPY["password"]):
            assert summary.get_by_role("link", name=msg, exact=True).count() == 1
            assert page.get_by_text(msg, exact=True).count() >= 2
        eventually(page, lambda: summary.evaluate("a => a.contains(document.activeElement)"))
        for box in (name_box, email_box, password_box):
            assert box.get_attribute("aria-invalid") == "true"
        assert email_box.input_value() == BAD_EMAIL and password_box.input_value() == SHORT_PASSWORD
        click(summary.get_by_role("link", name=FIELD_COPY["email"], exact=True))
        eventually(page, lambda: focused(email_box))
        assert rows_with("accounts", BAD_EMAIL) == []
        fill(name_box, name)
        fill(email_box, ORGANISER_EMAIL)
        fill(password_box, NEW_PASSWORD)
        click(btn(page, "Create account"))
        eventually(page, lambda: summary.get_by_role("link", name="An account with this email already exists.", exact=True).count() == 1)
        assert len(rows_with("accounts", ORGANISER_EMAIL)) == 1
        fill(email_box, email)
        click(btn(page, "Create account"))
        eventually(page, lambda: btn(page, "Sign out").count() == 1)
    assert len(rows_with("accounts", email.lower())) == 1
    with open_app(browser, app_url + "/signin") as page:
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        click(btn(page, "Sign in"))
        summary = page.get_by_role("alert").filter(has=page.get_by_role("heading", name="There is a problem", exact=True))
        eventually(page, lambda: summary.get_by_role("link", name=FIELD_COPY["signin_password"], exact=True).count() == 1)


LEAK_MARKERS = re.compile(r"(<html|Traceback|node_modules|\bat \S+ \(|\.ts:\d+|/app/|SELECT |INSERT |ERROR:)", re.I)


def test_api_errors_opaque(app_url: str) -> None:
    org = organiser(app_url)
    pad_body = lambda size: (lambda base: base[:-1] + b',"pad":"' + b"x" * (size - len(base) - 9) + b'"}')(
        json.dumps({"name": "Pad Person", "email": names("pad")[1], "password": NEW_PASSWORD}).encode())
    js = {"Content-Type": "application/json"}
    cases = [
        ("v2", raw(app_url, "POST", "/api/v2/auth/signup", js, b"{not json"), 400, "invalid"),
        ("v1", raw(app_url, "POST", "/api/v1/auth/signup", js, b"{not json"), 400, "invalid"),
        ("v1", raw(app_url, "POST", "/api/auth/signup", js, b"{not json"), 400, "invalid"),
        ("v2", raw(app_url, "POST", "/api/v2/auth/signup", js, pad_body(BODY_LIMIT_BYTES + 1)), 413, "payload_too_large"),
        ("v2", raw(app_url, "POST", "/api/v2/auth/login", {"Content-Type": "text/plain"}, b"x" * (BODY_LIMIT_BYTES + 1)), 413, "payload_too_large"),
        ("v2", raw(app_url, "POST", "/api/v2/auth/login", {"Content-Type": "text/plain"}, b"x"), 415, "unsupported_media_type"),
        ("v2", raw(app_url, "GET", "/api/v2/sessions/%E0%A4%A"), 400, "invalid"),
        ("v2", raw(app_url, "GET", "/api/v2/nothing-here"), 404, "not_found"),
        ("v1", raw(app_url, "GET", "/api/nothing-here"), 404, "not_found"),
        ("v2", raw(app_url, "POST", "/api/v2/record/guesses", js, b"{bad"), 400, "invalid"),
        ("v2", raw(app_url, "POST", f"/api/v2/sessions/{NEVER}/reservation", js, b"x" * (BODY_LIMIT_BYTES + 1)), 413, "payload_too_large"),
        ("v2", raw(app_url, "GET", "/api/v2/sessions?day=x"), 400, "invalid_filter"),
        ("v2", raw(app_url, "PATCH", f"/api/v2/organiser/sessions/{NEVER}", {**js, "Authorization": "Bearer " + org}, b'{"capacity":"x"}'), 422, "invalid"),
        ("v2", raw(app_url, "GET", "/api/v2/me", {"Authorization": "Bearer junk"}), 401, "unauthenticated"),
    ]
    for version, r, status_code, code in cases:
        err = error_of(r, version, status_code, code)
        assert not LEAK_MARKERS.search(r.text), r.text
        if status_code == 422:
            assert isinstance(err["fields"], dict) and err["fields"]
    exact = raw(app_url, "POST", "/api/v2/auth/signup", js, pad_body(BODY_LIMIT_BYTES))
    assert exact.status_code == 201, exact.text
    attendee = signup(app_url, "opaqueforbid")
    capacity = organiser_row(app_url, NEVER)["seats"]["capacity"]
    for version in ("v1", "v2"):
        r = raw(app_url, "PATCH", f"/api/{version}/organiser/sessions/{NEVER}",
                {**js, "Authorization": "Bearer " + attendee.token}, b'{"capacity":1}')
        error_of(r, version, 403, "forbidden")
        assert not LEAK_MARKERS.search(r.text), r.text
        assert attendee.email not in r.text
    assert organiser_row(app_url, NEVER)["seats"]["capacity"] == capacity


def test_only_published_surface(app_url: str) -> None:
    v1_unknown = ["/api/test/reset", "/api/seed", "/api/debug", "/api/docs", "/api/openapi.json", "/api/metrics",
                  "/api/users", "/api/accounts", "/api/Sessions", "/api/V2/sessions", "/api", "/api/v1", "/api/v2",
                  "/api/v3/sessions", "/api/v1/health", "/api/me/holds", f"/api/v1/sessions/{WELCOME}/claim"]
    for path in v1_unknown:
        v1_error(raw(app_url, "GET", path), 404, "not_found")
    for path in ("/api/v2/sessions/", "/api/v2/_contract"):
        v2_error(raw(app_url, "GET", path), 404, "not_found")
    allows = [("v2", "/sessions", {"GET", "HEAD"}), ("v2", f"/sessions/{NEVER}/reservation", {"POST", "DELETE"}),
              ("v2", f"/sessions/{NEVER}/save", {"PUT", "DELETE"}), ("v2", f"/organiser/sessions/{NEVER}", {"PATCH"}),
              ("v2", f"/sessions/{NEVER}/claim", {"POST"}), ("v1", "/stages", {"GET", "HEAD"})]
    for version, route, methods in allows:
        r = raw(app_url, "OPTIONS", api(version, route))
        error_of(r, version, 405, "method_not_allowed")
        assert {m.strip() for m in r.headers["Allow"].split(",")} == methods
    r = raw(app_url, "DELETE", api("v2", "/stages"))
    v2_error(r, 405, "method_not_allowed")
    assert {m.strip() for m in r.headers["Allow"].split(",")} == {"GET", "HEAD"}
    head = raw(app_url, "HEAD", api("v2", f"/sessions/{CLONE}"))
    assert head.status_code == 200 and head.content == b""
    index = HTTP.get(app_url + "/")
    responses = [index, HTTP.get(app_url + api("v2", "/sessions")), HTTP.get(app_url + api("v2", UNKNOWN_ROUTE))]
    for asset in sorted(set(re.findall(r'(/assets/[^"\'\s>]+\.(?:js|css))', index.text))):
        a = HTTP.get(app_url + asset)
        assert a.status_code == 200 and "sourceMappingURL" not in a.text
        assert HTTP.get(app_url + asset + ".map").status_code == 404
        responses.append(a)
    for r in responses:
        assert "X-Powered-By" not in r.headers
        assert not re.search(r"\d", r.headers.get("Server", ""))
    missing = HTTP.get(app_url + "/assets/does-not-exist.js")
    assert missing.status_code == 404 and missing.text != index.text
    for path in ("/package.json", "/package-lock.json", "/run.json", "/.env", "/src/server.ts", "/tsconfig.json"):
        r = HTTP.get(app_url + path)
        assert r.status_code == 404 and '"_schema"' not in r.text


def test_two_versions_same_data(app_url: str) -> None:
    crowd = Crowd(app_url)
    org = organiser(app_url)
    try:
        p = crowd.new("versions")
        stamp = re.compile(rb"DTSTAMP:\d{8}T\d{6}Z")
        for path, token in (("/stages", None), ("/sessions", p.token), (f"/sessions/{CLONE}", p.token), ("/speakers", None),
                            ("/record", p.token), ("/agenda.ics", None), ("/me", p.token), ("/me/agenda", p.token),
                            ("/organiser/sessions", org), (f"/organiser/sessions/{NEVER}/roster", org),
                            (f"/organiser/sessions/{NEVER}/roster.csv", org)):
            a, b, c = (get(app_url, f"{prefix}{path}", token) for prefix in ("/api/v1", "/api", "/api/v2"))
            assert a.status_code == b.status_code == c.status_code == 200, path
            assert stamp.sub(b"", a.content) == stamp.sub(b"", b.content), path
        assert act(app_url, p, "PUT", CLONE, "save", "v1").json() == {"saved": True}
        assert sess(app_url, CLONE, p.token)["saved_by_me"] is True
        assert act(app_url, p, "DELETE", CLONE, "save").json() == {"saved": False}
        assert sess(app_url, CLONE, p.token, "v1")["saved_by_me"] is False
        open_seats(app_url, NEVER, 1)
        r = reserve(app_url, p, NEVER, "v1")
        assert r.status_code == 201 and set(r.json()) == set(V1_OBJECTS["reservation_created"])
        v2 = sess(app_url, NEVER, p.token)
        v1 = sess(app_url, NEVER, p.token, "v1")
        assert v2["reserved_by_me"] is True and v1["reserved_by_me"] is True and v1["seats_left"] == v2["seats"]["left"]
        alias = send(app_url, "POST", api("", "/auth/signup"),
                     body={"name": "Alias Person", "email": names("alias")[1], "password": NEW_PASSWORD})
        assert alias.status_code == 201 and set(alias.json()) == {"token", "account"}
        assert get(app_url, api("v2", "/me"), alias.json()["token"]).status_code == 200
    finally:
        crowd.cleanup([NEVER])


def walk_keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in walk_keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in walk_keys(v)}
    return set()


def test_frozen_v1_contract(stage: str) -> None:
    crowd = Crowd(stage)
    org = organiser(stage)
    try:
        open_seats(stage, MUSIC, 1)
        h = crowd.occupy(MUSIC)[0]
        a = crowd.new("frozen")
        assert act(stage, a, "POST", MUSIC, "waitlist", "v1").json()["waitlist"]["session_id"] == MUSIC
        assert act(stage, h, "DELETE", MUSIC, "reservation", "v1").status_code == 200
        v1 = sess(stage, MUSIC, a.token, "v1")
        v2 = sess(stage, MUSIC, a.token)
        assert v2["my_hold"] is not None
        assert v1["reserved_by_me"] is False and v1["waitlist_position"] is None and v1["seats_left"] == v2["seats"]["left"]
        assert organiser_row(stage, MUSIC, "v1")["reserved"] == v2["seats"]["reserved"] + v2["seats"]["held"]
        agenda = get(stage, api("v1", "/me/agenda"), a.token).json()
        assert set(agenda) == set(V1_OBJECTS["my_agenda"])
        assert MUSIC not in {s["id"] for group in agenda.values() for s in group}
        shapes = {f"/sessions/{MUSIC}": "session", "/me": "account", "/record": "record", "/me/agenda": "my_agenda"}
        for path, obj in shapes.items():
            assert set(get(stage, f"/api/v1{path}", a.token).json()) == set(V1_OBJECTS[obj])
        for path, obj, token, seeded in (("/speakers", "speaker", None, True), ("/stages", "stage", None, True),
                                         ("/sessions", "session", a.token, True),
                                         ("/organiser/sessions", "organiser_row", org, True),
                                         (f"/organiser/sessions/{MUSIC}/roster", "roster_row", org, False)):
            body = get(stage, f"/api/v1{path}", token).json()
            assert isinstance(body, list) and (body or not seeded)
            assert all(set(x) == set(V1_OBJECTS[obj]) for x in body)
            assert not walk_keys(body) & V2_ONLY_KEYS
        for path in ("/sessions", "/me/agenda", "/record"):
            assert not walk_keys(get(stage, f"/api/v1{path}", a.token).json()) & V2_ONLY_KEYS
            first, second = get(stage, f"/api/v1{path}", a.token), get(stage, f"/api/v1{path}", a.token)
            assert first.content == second.content
        assert set(v1_error(get(stage, api("v1", "/me")), 401, "unauthenticated")) == set(V1_OBJECTS["error"])
        for r in (get(stage, api("v1", "/stages")), get(stage, api("", "/stages")), get(stage, api("v1", "/me")),
                  raw(stage, "HEAD", api("v1", "/sessions")), raw(stage, "OPTIONS", api("v1", "/sessions"))):
            assert r.headers.get("Deprecation") == "true" and r.headers.get("Sunset") == SUNSET
        for r in (get(stage, api("v2", "/stages")), get(stage, "/api/health"), get(stage, "/api/_contract")):
            assert "Deprecation" not in r.headers and "Sunset" not in r.headers
    finally:
        crowd.cleanup([MUSIC])


def test_contract_digests(app_url: str) -> None:
    r = get(app_url, "/api/_contract")
    assert r.status_code == 200 and is_json(r)
    assert r.json() == {"v1": hashlib.sha256(V1_MANIFEST.encode()).hexdigest(),
                        "v2": hashlib.sha256(V2_MANIFEST.encode()).hexdigest()}


PAGE_ROUTES = ["/", "/agenda", f"/sessions/{CLONE}", f"/sessions/{UNKNOWN_SESSION}", "/my-agenda", "/speakers",
               "/record", "/organiser", "/signin", "/signup"]


def test_deploy_health_and_routes(browser: Browser, app_url: str) -> None:
    h = get(app_url, "/api/health")
    assert h.status_code == 200 and h.json() == {"status": "ok"} and is_json(h)
    for route in PAGE_ROUTES:
        r = HTTP.get(app_url + route)
        assert r.status_code == 200 and media_type(r).startswith("text/html"), route
    requested: list[str] = []
    with open_app(browser, app_url + "/") as page:
        page.context.on("request", lambda req: requested.append(req.url))
        for route in ("/", "/agenda?day=1", "/speakers", "/record", "/signin"):
            page.goto(app_url + route)
            loaded(page)
    foreign = [u for u in requested if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert requested and foreign == []


def test_stored_state_survives_restart(app_url: str) -> None:
    crowd = Crowd(app_url)
    try:
        p = crowd.new("durable")
        assert act(app_url, p, "PUT", WELCOME, "save").status_code == 200
        open_seats(app_url, WALLET, 1)
        assert reserve(app_url, p, WALLET).status_code == 201
        assert len(rows_with("saved_sessions", p.id, WELCOME)) == 1
        assert len(rows_with("reservations", p.id, WALLET)) == 1
        with app_copy() as copy:
            agenda = get(copy.base, api("v2", "/me/agenda"), p.token).json()
            assert [s["id"] for s in agenda["reserved"]] == [WALLET]
            assert [s["id"] for s in agenda["saved"]] == [WELCOME]
            v2_error(get(copy.base, api("v2", "/organiser/sessions"), p.token), 403, "forbidden")
            assert get(copy.base, api("v2", "/organiser/sessions"), organiser(app_url)).status_code == 200
    finally:
        crowd.cleanup([WALLET])


SEED_COUNTS = {"accounts": 4, "stages": 4, "sessions": 18, "speakers": 19, "session_speakers": 20,
               "reservations": 1, "holds": 0, "seat_events": 0, "saved_sessions": 0, "waitlist_entries": 0,
               "guesses": 0, "contest": 1}
SEEDED_BIOS = {
    "mara-velasquez": "Leads agent memory research at *Tidewater Labs*. Notes: <https://example.com/mara>",
    "ravi-menon": "Writes **every day**; ships on Fridays.",
}


def psql_admin(sql: str) -> None:
    out = subprocess.run(["psql", database_url(), "-X", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True, check=False)
    assert out.returncode == 0, out.stderr


def scratch_rows(url: str, sql: str) -> list[dict]:
    out = subprocess.run(["psql", url, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
                          f"select coalesce(json_agg(t), '[]'::json) from ({sql}) t"],
                         capture_output=True, text=True, check=False)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip())


def scratch_with(url: str, table: str, *values: Any) -> list[dict]:
    wanted = [str(v) for v in values]
    return [row for row in scratch_rows(url, f"select * from {table}")
            if all(w in {str(v) for v in row.values()} for w in wanted)]


def check_fresh_seed(url: str, base: str) -> None:
    for table, count in SEED_COUNTS.items():
        n = scratch_rows(url, f"select count(*) as n from {table}")[0]["n"]
        assert int(n) == count, (table, n)
    quinn = None
    for email, (name, role) in SEEDED_ACCOUNTS.items():
        rows = scratch_with(url, "accounts", email)
        assert len(rows) == 1 and role in {str(v) for v in rows[0].values()}, email
        r = login(base, email, PASSWORD)
        assert r.status_code == 200 and r.json()["account"]["role"] == role and r.json()["account"]["name"] == name
        if name == "Quinn Hale":
            quinn = r.json()["account"]["id"]
    assert len(scratch_with(url, "reservations", quinn, CLONE)) == 1
    bios = {r["slug"]: r["bio"] for r in scratch_rows(url, "select slug, name, company, bio from speakers")}
    assert sorted(bios) == sorted(slug_of(n) for n, _, _ in expected_speakers())
    assert all(bio == SEEDED_BIOS.get(slug, "") for slug, bio in bios.items()), bios
    sessions = get(base, "/api/v2/sessions").json()
    assert [(s["id"], s["title"]) for s in sessions] == [(i, BY_ID[i].title) for i in AGENDA_ORDER]
    assert [s["seats"]["capacity"] if s["seats"] else None for s in sessions] == [BY_ID[i].capacity for i in AGENDA_ORDER]
    stages = get(base, api("v2", "/stages")).json()
    assert [(s["slug"], s["name"], s["description"]) for s in stages] == [(k, *v) for k, v in STAGES.items()]
    record = get(base, api("v2", "/record")).json()
    assert record["final_figure"] is None and record["revealed_at"] is None and record["guess_count"] == 0


def test_wf_platform_concurrent_boot(browser: Browser) -> None:
    scratch = "keel_boot_" + os.urandom(6).hex()
    psql_admin(f'create database "{scratch}"')
    real = urlsplit(database_url())
    url = urlunsplit(real._replace(path="/" + scratch))
    copies: list[Copy] = []
    try:
        copies = [start_copy(database=url) for _ in range(3)]
        for copy in copies:
            copy.wait({200})
        assert all(copy.proc.poll() is None for copy in copies), [c.tail() for c in copies]
        check_fresh_seed(url, copies[1].base)
        with open_app(browser, copies[0].base + "/agenda?day=1") as page:
            eventually(page, lambda: text(status(page, "Agenda results")) == f"{len(DAY_IDS[1])} sessions")
        for copy in copies:
            copy.stop()
        with app_copy(database=url) as again:
            check_fresh_seed(url, again.base)
    finally:
        for copy in copies:
            copy.stop()
        psql_admin(f'drop database if exists "{scratch}" with (force)')


def test_wf_platform_db_outage_recovery(browser: Browser) -> None:
    down = os.environ["APP_POSTGRES_DOWN_URL"].rstrip("/")
    h = get(down, "/api/health")
    assert h.status_code == 503 and h.json() == {"status": "starting"} and "Deprecation" not in h.headers
    assert get(down, "/api/_contract").status_code == 200
    v2_error(get(down, "/api/v2/sessions"), 503, "unavailable")
    r = get(down, "/api/v1/sessions")
    v1_error(r, 503, "unavailable")
    assert r.headers.get("Deprecation") == "true"
    assert raw(down, "HEAD", "/api/v2/sessions").status_code == 503
    big = raw(down, "POST", api("v2", "/auth/login"), {"Content-Type": "application/json"}, b"x" * (BODY_LIMIT_BYTES + 1))
    v2_error(big, 503, "unavailable")
    v2_error(raw(down, "GET", api("v2", UNKNOWN_ROUTE)), 404, "not_found")
    v2_error(raw(down, "OPTIONS", "/api/v2/sessions"), 405, "method_not_allowed")
    v2_error(raw(down, "GET", BAD_ENCODING), 400, "invalid")
    page_resp = HTTP.get(down + "/agenda")
    assert page_resp.status_code == 503 and media_type(page_resp).startswith("text/html")
    assert "Keel Outpost is starting. Try again in a moment." in page_resp.text
    real = urlsplit(database_url())
    relay_port = free_port()
    userinfo = real.netloc.rpartition("@")[0]
    relayed = urlunsplit(real._replace(netloc=(userinfo + "@" if userinfo else "") + f"127.0.0.1:{relay_port}"))
    relay = Relay(relay_port, (real.hostname or "127.0.0.1", real.port or POSTGRES_PORT))
    with app_copy(database=relayed, wait="listening") as copy:
        try:
            assert get(copy.base, "/api/health").json() == {"status": "starting"}
            relay.start()
            started = time.monotonic()
            copy.wait({200}, seconds=RECOVERY_S + BOOT_S / 4)
            assert time.monotonic() - started <= RECOVERY_S + POLL_S * 8, copy.tail()
            assert get(copy.base, "/api/v2/sessions").status_code == 200
            with open_app(browser, copy.base + "/agenda?day=1") as page:
                eventually(page, lambda: len(board_titles(page)) == len(DAY_IDS[1]))
        finally:
            copy.stop()
            relay.stop()


A11Y_ROUTES = ["/", "/agenda?day=1", f"/sessions/{CLONE}", "/speakers", "/record", "/signin", "/signup", UNKNOWN_PAGE]


FOOTER_COPY = ("Keel Outpost 2026 · October 31 - November 1 · Harbour Quay Hall, Port Ashby. "
               "Questions about the programme: programme@example.com")


def test_wf_experience_chrome(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        loaded(page)
        banner = page.get_by_role("link", name=BANNER_LINK, exact=True)
        eventually(page, lambda: banner.count() == 1)
        assert (banner.get_attribute("href") or "").split("?")[0] in ("/agenda", app_url + "/agenda")
        nav = page.get_by_role("navigation", name="Main", exact=True)
        assert nav.count() == 1
        assert all(nav.get_by_role("link", name=n, exact=True).count() == 1 for n in NAV_LINKS)
        assert FOOTER_COPY in text(page.get_by_role("contentinfo"))
        assert page.get_by_role("link", name="Sign in", exact=True).count() == 1
        heads = [page.get_by_role("heading", name="Keel Outpost 2026", level=1, exact=True),
                 page.get_by_role("heading", name=STATEMENT, level=2, exact=True),
                 page.get_by_role("heading", name="Experiences", exact=True),
                 page.get_by_role("heading", name="Agenda", exact=True)]
        assert all(h.count() == 1 for h in heads)
        ys = [h.bounding_box()["y"] for h in heads]
        assert ys == sorted(ys), ys
        for slug, (stage_name, _) in STAGES.items():
            link = page.get_by_role("link", name=stage_name, exact=True)
            assert link.count() >= 1
            hrefs = link.evaluate_all("els => els.map(e => e.getAttribute('href') || '')")
            assert any(path_query(h if "://" in h else app_url + h) == f"/agenda?stage={slug}" for h in hrefs), hrefs
        teaser = page.get_by_role("link", name="Call the number", exact=True)
        assert (teaser.get_attribute("href") or "").endswith("/record")
        assert page.get_by_role("link", name="See the full agenda", exact=True).count() == 1
        assert page.get_by_role("link", name="Sign up to reserve", exact=True).count() == 1


def test_accessibility(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        for route in A11Y_ROUTES:
            page.goto(app_url + route)
            loaded(page)
            axe(page)
        page.goto(app_url + "/agenda?day=1")
        loaded(page)
        tab1 = page.get_by_role("tab", name=DAY_TABS[1], exact=True)
        tab2 = page.get_by_role("tab", name=DAY_TABS[2], exact=True)
        tab1.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: tab2.get_attribute("aria-selected") == "true" and focused(tab2))
        assert parse_qs(urlparse(page.url).query).get("day") == ["2"]
        page.keyboard.press("Home")
        eventually(page, lambda: tab1.get_attribute("aria-selected") == "true" and focused(tab1))
        page.keyboard.press("End")
        eventually(page, lambda: tab2.get_attribute("aria-selected") == "true")
        page.keyboard.press("Tab")
        assert page.evaluate("() => document.activeElement.getAttribute('role')") != "tab"
        rest, focus = state_styles(page.get_by_role("link", name="Sign in", exact=True),
                                   "outline-style", "outline-width", "outline-offset", "box-shadow", state="focus")
        assert focus != rest and (focus["outline-style"] != "none" or focus["box-shadow"] != "none")
        page.goto(app_url + "/agenda?day=1")
        loaded(page)
        targets = [tab1, tab2, page.get_by_role("combobox", name="Stage", exact=True),
                   page.get_by_role("combobox", name="Format", exact=True),
                   page.get_by_role("searchbox", name="Search sessions", exact=True),
                   btn(page, f"Reserve seat for {CLONE_T}"),
                   board_row(page, CLONE_T).get_by_role("link", name=CLONE_T, exact=True)]
        for t in targets:
            box = t.bounding_box()
            assert box and box["width"] >= TARGET_MIN_PX and box["height"] >= TARGET_MIN_PX, box
        page.set_viewport_size({"width": 768, "height": 1024})
        menu = btn(page, "Menu")
        eventually(page, lambda: menu.is_visible())
        click(menu)
        dialog = page.get_by_role("dialog", name="Menu", exact=True)
        eventually(page, lambda: focused(btn(page, "Close menu")))
        assert menu.get_attribute("aria-expanded") == "true"
        for _ in range(len(NAV_LINKS) * 2):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        eventually(page, lambda: dialog.count() == 0 or not dialog.is_visible())
        assert focused(menu) and menu.get_attribute("aria-expanded") == "false"


def test_live_regions_and_loading(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/agenda?day=1") as page:
        results = status(page, "Agenda results")
        eventually(page, lambda: text(results) == f"{len(DAY_IDS[1])} sessions")
        assert results.get_attribute("aria-live") in (None, "polite")
        select(page.get_by_role("combobox", name="Stage", exact=True), "AI Builder Lab")
        lab = [i for i in DAY_IDS[1] if BY_ID[i].stage == "ai-builder-lab"]
        eventually(page, lambda: text(results) == f"{len(lab)} sessions")
        page.goto(app_url + board(day="1", q='"won\'t wait"'))
        eventually(page, lambda: text(status(page, "Agenda results")) == "1 session")
        for route, glob, ready in (("/speakers", "**" + api("v2", "/speakers") + "*",
                                    lambda: page.get_by_role("list", name="Speakers", exact=True).count() == 1),
                                   (board(day="2"), "**" + api("v2", "/sessions") + "*",
                                    lambda: len(board_titles(page)) == len(DAY_IDS[2])),
                                   ("/record", "**" + api("v2", "/record") + "*",
                                    lambda: page.get_by_role("heading", name="Call the number", exact=True).count() >= 1)):
            with held(page, glob) as gate:
                page.goto(app_url + route)
                eventually(page, lambda: page.get_by_text("Loading", exact=True).count() >= 1)
                gate.release()
            eventually(page, ready)
            assert page.get_by_text("Loading", exact=True).count() == 0


def test_narrow_layouts(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            for route in A11Y_ROUTES:
                page.goto(app_url + route)
                loaded(page)
                layout(page)
            page.goto(app_url + "/agenda?day=1")
            loaded(page)
            if width <= 375:
                assert text(page.get_by_role("tab", name=DAY_TABS[1], exact=True)) == "Day 1"
                assert text(page.get_by_role("tab", name=DAY_TABS[2], exact=True)) == "Day 2"
            elif width == 768:
                assert btn(page, "Menu").is_visible()
                assert not page.get_by_role("link", name="Overview", exact=True).first.is_visible()
            else:
                nav = page.get_by_role("navigation", name="Main", exact=True)
                assert all(nav.get_by_role("link", name=n, exact=True).is_visible() for n in NAV_LINKS)
                assert btn(page, "Menu").count() == 0 or not btn(page, "Menu").is_visible()


MOTION_PROBE = """() => {
  window.__motion = [];
  const rec = e => { for (const a of e.target.getAnimations()) window.__motion.push(Number(a.effect.getComputedTiming().endTime) || 0); };
  document.addEventListener('transitionrun', rec, true);
  document.addEventListener('animationstart', rec, true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const a = original.apply(this, args);
    window.__motion.push(Number(a.effect.getComputedTiming().endTime) || 0);
    return a;
  };
}"""


def stagger_shots(page: Page) -> list[Any]:
    heading = page.get_by_role("heading", name=STATEMENT, level=2, exact=True)
    eventually(page, lambda: heading.count() == 1)
    page.evaluate("window.scrollTo(0, 0)")
    box = heading.bounding_box()
    vh = page.viewport_size["height"]
    top = box["y"] + page.evaluate("window.scrollY")
    enter, centre = max(0, top - vh), max(0, top + box["height"] / 2 - vh / 2)
    positions = [enter + (centre - enter) * i / 4 for i in range(5)]
    shots = []
    for y in positions + positions[::-1]:
        page.evaluate("y => window.scrollTo(0, y)", y)
        advance(page, UI_STEP_MS)
        shots.append(decode(capture(heading)))
    return shots


def test_motion_and_reduced_motion(browser: Browser, app_url: str) -> None:
    for mode in ("no-preference", "reduce"):
        with open_app(browser, app_url + "/agenda?day=1", reduced_motion=mode) as page:
            loaded(page)
            page.evaluate(MOTION_PROBE)
            select(page.get_by_role("combobox", name="Format", exact=True), "Workshop")
            eventually(page, lambda: len(board_titles(page)) == len([i for i in DAY_IDS[1] if BY_ID[i].format == "workshop"]))
            moves = page.evaluate("window.__motion")
            if mode == "reduce":
                assert max(moves, default=0) == 0, moves
            else:
                assert moves and max(moves) <= FILTER_MOTION_MAX_MS, moves
            page.set_viewport_size({"width": 768, "height": 1024})
            page.evaluate("window.__motion = []")
            click(btn(page, "Menu"))
            eventually(page, lambda: page.get_by_role("dialog", name="Menu", exact=True).count() == 1)
            moves = page.evaluate("window.__motion")
            if mode == "reduce":
                assert max(moves, default=0) == 0, moves
            else:
                assert moves and max(moves) < MENU_MOTION_MAX_MS, moves
        with open_app(browser, app_url + "/", reduced_motion=mode) as page:
            page.set_viewport_size({"width": 1280, "height": 800})
            shots = stagger_shots(page)
            centre = shots[4]
            forward = [difference(s, centre) for s in shots[:5]]
            backward = [difference(s, centre) for s in shots[5:]][::-1]
            if mode == "reduce":
                assert max(forward + backward) < STILL_DIFF, forward
            else:
                assert forward[0] > forward[-1]
                assert all(a >= b - PIXEL_NOISE for a, b in zip(forward, forward[1:])), forward
                assert all(abs(f - b) < PIXEL_NOISE for f, b in zip(forward, backward)), (forward, backward)


def test_wf_experience_two_tabs(browser: Browser, stage: str) -> None:
    crowd = Crowd(stage)
    board = stage + "/agenda?day=1&stage=ai-builder-lab&format=workshop"
    try:
        p = crowd.new("twotabs")
        open_seats(stage, NEVER, 2)
        with open_app(browser, stage + "/signin") as tab_a, open_app(browser, stage + "/signin") as tab_b:
            for tab in (tab_a, tab_b):
                ui_signin(tab, stage, p.email, NEW_PASSWORD)
                tab.goto(board)
                eventually(tab, lambda tab=tab: btn(tab, f"Reserve seat for {NEVER_T}").count() == 1)
            search = tab_b.get_by_role("searchbox", name="Search sessions", exact=True)
            search.focus()
            click(btn(tab_a, f"Reserve seat for {NEVER_T}"))
            eventually(tab_a, lambda: btn(tab_a, f"Cancel reservation for {NEVER_T}").count() == 1)
            seats = sess(stage, NEVER, p.token)["seats"]
            line = f"{seats['left']} of {seats['capacity']} seats left"
            eventually(tab_b, lambda: btn(tab_b, f"Cancel reservation for {NEVER_T}").count() == 1
                       and line in text(board_row(tab_b, NEVER_T)), budget_ms=LIVE_REFRESH_MS)
            assert "Seat reserved." not in text(status(tab_b, "Booking messages"))
            assert focused(search)
        assert sess(stage, NEVER, p.token)["reserved_by_me"] is True
    finally:
        crowd.cleanup([NEVER])


def test_wf_experience_back_from_session(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/agenda?day=1") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        results = status(page, "Agenda results")
        eventually(page, lambda: text(results) == f"{len(DAY_IDS[1])} sessions")
        y1 = page.evaluate("y => { window.scrollTo(0, y); return window.scrollY; }", 600)
        select(page.get_by_role("combobox", name="Format", exact=True), "Workshop")
        workshops = [i for i in DAY_IDS[1] if BY_ID[i].format == "workshop"]
        eventually(page, lambda: text(results) == f"{len(workshops)} sessions")
        y2 = page.evaluate("() => { window.scrollTo(0, 0); return window.scrollY; }")
        page.go_back()
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1" and text(results) == f"{len(DAY_IDS[1])} sessions"
                   and abs(page.evaluate("window.scrollY") - y1) <= SCROLL_TOLERANCE_PX, budget_ms=RESTORE_MS)
        page.go_forward()
        eventually(page, lambda: path_query(page.url) == board(day="1", format="workshop")
                   and abs(page.evaluate("window.scrollY") - y2) <= SCROLL_TOLERANCE_PX, budget_ms=RESTORE_MS)
        page.go_back()
        eventually(page, lambda: text(results) == f"{len(DAY_IDS[1])} sessions")
        link = board_row(page, NEVER_T).get_by_role("link", name=NEVER_T, exact=True)
        link.scroll_into_view_if_needed()
        y3 = page.evaluate("window.scrollY")
        click(link)
        eventually(page, lambda: urlparse(page.url).path == f"/sessions/{NEVER}")
        page.go_back()
        eventually(page, lambda: path_query(page.url) == "/agenda?day=1" and focused(link)
                   and text(results) == f"{len(DAY_IDS[1])} sessions"
                   and abs(page.evaluate("window.scrollY") - y3) <= SCROLL_TOLERANCE_PX, budget_ms=RESTORE_MS)


def test_wf_experience_unsaved_bio(browser: Browser, app_url: str) -> None:
    slug = slug_of("Omar Haddad")
    draft = "Ships *fast*"
    try:
        with open_app(browser, app_url + "/signin") as page:
            ui_signin(page, app_url, ORGANISER_EMAIL, PASSWORD)
            page.goto(app_url + "/organiser")
            panel = page.get_by_role("region", name="Speaker bios", exact=True)
            picker = panel.get_by_role("combobox", name="Speaker", exact=True)
            eventually(page, lambda: picker.count() == 1)
            select(picker, "Omar Haddad")
            bio = panel.get_by_role("textbox", name="Bio", exact=True)
            fill(bio, draft)
            select(picker, "Clare Dunn")
            dialog = page.get_by_role("dialog", name="Discard unsaved bio?", exact=True)
            eventually(page, lambda: dialog.count() == 1)
            speaker = BY_ID["d1-who-writes-rules"].speakers[0][0]
            assert f"Your changes to {speaker}'s bio are not saved." in text(dialog)
            eventually(page, lambda: focused(btn(dialog, "Keep editing")))
            page.keyboard.press("Escape")
            eventually(page, lambda: dialog.count() == 0 and focused(bio))
            assert bio.input_value() == draft and combo_label(picker) == "Omar Haddad"
            click(page.get_by_role("link", name=BANNER_LINK, exact=True))
            eventually(page, lambda: dialog.count() == 1)
            click(btn(dialog, "Keep editing"))
            eventually(page, lambda: dialog.count() == 0)
            assert urlparse(page.url).path == "/organiser" and bio.input_value() == draft
            click(btn(panel, "Save bio"))
            eventually(page, lambda: text(status(page, "Organiser messages")) == "Bio saved.")
            preview = panel.get_by_role("region", name="Bio preview", exact=True)
            rendered = next(s for s in speakers_list(app_url) if s["slug"] == slug)["bio_html"]
            assert rendered.count("<em>") == 1
            eventually(page, lambda: rendered in preview.inner_html())
            select(picker, "Clare Dunn")
            eventually(page, lambda: combo_label(picker) == "Clare Dunn")
            assert dialog.count() == 0
        assert next(s for s in speakers_list(app_url) if s["slug"] == slug)["bio"] == draft
    finally:
        send(app_url, "PUT", f"/api/v2/organiser/speakers/{slug}/bio", organiser(app_url), body={"bio": ""})


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
LICENCE_PHRASES = {"MIT": "permission is hereby granted, free of charge",
                   "ISC": "permission to use, copy, modify, and/or distribute",
                   "Apache-2.0": "apache license",
                   "BSD-3-Clause": "neither the name of the copyright holder",
                   "BSD-2-Clause": "redistributions in binary form must reproduce"}


def production_packages() -> list[tuple[str, Any]]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd="/app",
                         capture_output=True, text=True, check=False)
    tree = json.loads(out.stdout or "{}")
    found: list[tuple[str, Any]] = []

    def walk(deps: dict) -> None:
        for name, node in (deps or {}).items():
            licence = node.get("license")
            root = Path(node.get("path") or Path("/app/node_modules") / name)
            if licence is None and (root / "package.json").exists():
                meta = json.loads((root / "package.json").read_text())
                licence = meta.get("license") or meta.get("licenses")
            if licence is None and root.is_dir():
                for candidate in ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "license", "license.md"):
                    found_file = root / candidate
                    if found_file.exists():
                        body = found_file.read_text(errors="ignore").lower()
                        licence = next((s for s, phrase in LICENCE_PHRASES.items() if phrase in body), None)
                        break
            found.append((name, licence))
            walk(node.get("dependencies", {}))

    walk(tree.get("dependencies", {}))
    return found


OUT_OF_SCOPE = re.compile(r"ticket|checkout|payment|newsletter|subscribe|live chat|"
                          r"comment|rating|review|cookie|analytics", re.IGNORECASE)
SCOPE_ROUTES = ["/", "/agenda", f"/sessions/{CLONE}", "/speakers"]


def test_product_scope_absent(browser: Browser, app_url: str) -> None:
    titles = [s.title for s in SEED]
    requested: list[str] = []
    with open_app(browser, app_url + SCOPE_ROUTES[0]) as page:
        page.context.on("request", lambda req: requested.append(req.url))
        for route in SCOPE_ROUTES:
            page.goto(app_url + route)
            loaded(page)
            names = page.get_by_role("button").all_inner_texts() + page.get_by_role("link").all_inner_texts()
            offending = sorted({n.strip() for n in names
                                if OUT_OF_SCOPE.search(n) and not any(t in n for t in titles)})
            assert offending == [], (route, offending)
    foreign = [u for u in requested if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert requested and foreign == []


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_user_readme() -> None:
    readme = Path("/app/USER_README.md").read_text()
    assert PASSWORD in readme
    for email, (_, role) in SEEDED_ACCOUNTS.items():
        assert email in readme and role in readme


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert "jsc2012e039800" in notices and "Inter" in notices and "SIL Open Font License" in notices
    missing = sorted({name for name, _ in production_packages() if name not in notices})
    assert missing == []


def test_if_licence_allowlist() -> None:
    bad = []
    for name, licence in production_packages():
        if isinstance(licence, dict):
            licence = licence.get("type")
        if isinstance(licence, list):
            licence = " OR ".join(str(x.get("type") if isinstance(x, dict) else x) for x in licence)
        ids = [t for t in re.split(r"[()\s]+|\bOR\b|\bAND\b", str(licence or "")) if t]
        if not ids or not all(t in ALLOWED_LICENCES for t in ids):
            bad.append((name, licence))
    assert bad == []


FORBIDDEN_CLIENTS = {"redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3",
                     "@aws-sdk/client-s3", "minio", "nodemailer", "amqplib", "kafkajs", "bullmq", "memcached",
                     "firebase", "firebase-admin", "@sendgrid/mail", "passport-google-oauth20", "@auth0/auth0-spa-js"}


def test_if_no_second_service_client() -> None:
    pkg = json.loads(Path("/app/package.json").read_text())
    declared = {name for group in pkg.values() if isinstance(group, dict) for name in group}
    assert declared & FORBIDDEN_CLIENTS == set()


def test_if_lockfile_committed() -> None:
    lock_text = Path("/app/package-lock.json").read_text()
    assert isinstance(json.loads(lock_text), dict)
    shipped = {name for name, _ in production_packages()}
    assert shipped and sorted(n for n in shipped if "node_modules/" + n not in lock_text) == []


TS_SUFFIXES = (".ts", ".tsx")
JS_SUFFIXES = (".js", ".mjs", ".cjs", ".jsx")


def test_if_typescript_sources() -> None:
    skip = {"node_modules", ".git", "dist", "build"}
    stray, ts = [], 0
    for path in Path("/app").rglob("*"):
        if any(part in skip for part in path.relative_to("/app").parts) or not path.is_file():
            continue
        if path.suffix in TS_SUFFIXES:
            ts += 1
        if path.suffix in JS_SUFFIXES and "config" not in path.name:
            stray.append(str(path))
    assert ts > 0 and stray == []
