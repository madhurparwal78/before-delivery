from __future__ import annotations

import functools
import json
import math
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from html import unescape
from playwright.sync_api import Browser, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from conftest import (
    DEPLOYED_APP,
    Postgres,
    advance,
    axe,
    held,
    open_app,
    same_origin,
    settle,
    state_styles,
    tab_order,
    unique,
    until,
)


APP_DIR = Path("/app")
SEED_PASSWORD = "deku-demo-pw-2026"
HOST_EMAIL = "host@example.com"
GUEST_EMAIL = "guest@example.com"
GUEST2_EMAIL = "guest2@example.com"
SEED_MEMBERS = {HOST_EMAIL: "Noor Kapoor", GUEST_EMAIL: "Ravi Menon", GUEST2_EMAIL: "Lena Ortiz"}
ACCESS_CODE = "GLOW-2026"
PROBE_PASSWORD = "probe-pass-0001"
WRONG_PASSWORD = "probe-wrong-0001"

HTTP_TIMEOUT = 30
POLL_INTERVAL = 0.25
COPY_BOOT_DEADLINE = 90
RESPONSE_SLACK = 2
CLOCK_SLACK = timedelta(seconds=5)
COUNTDOWN_SLACK_SECONDS = 120
SCROLL_FRAME_MS = 100
CELEBRATION_SLACK_SECONDS = 5
VISIBLE_DEADLINE = 10
QUIESCE_SECONDS = 5
EXIT_FAKE_MS = 2000
EXIT_STEP_MS = 250
EXIT_DEADLINE = 15
LOCATION_REVEAL_MS = 3000
CONCURRENCY = 8
PAST_LEAD = timedelta(seconds=40)

OUTAGE_ANSWER_SECONDS = 10
OUTAGE_ONSET_SECONDS = 10
RECOVERY_SECONDS = 30
BOOT_READY_SECONDS = 30
RETRY_AFTER = "5"
BODY_LIMIT = 65536
NAME_MAX = 140
MEMBER_NAME_MAX = 80
PASSWORD_MIN = 8
CAPACITY_MAX = 10000
DESCRIPTION_MAX = 5000
MESSAGE_MAX = 1000
KEY_MAX = 64
LOCKOUT_WINDOW = 900
LOCKOUT_BURST = 12
LOCKOUT_LIMIT = 5
LOCKED_COUNT = 7
SHORT_WINDOW = 20
SEED_CAPACITY_RUNCLUB = 60
WORD_SWAP_MS = 2500
WORD_DWELL_MS = WORD_SWAP_MS // 2
CELEBRATION_MAX_MS = 3000
CONFETTI_MIN = 40
COVER_COUNT = 12
TOAST_LIMIT = 3
TOAST_WAIT_MS = 10000
QUEUE_DEPTH = 13
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
NARROW = (320, 812)

THEMES = ["amber", "harbor", "moss", "plum", "ember", "night"]
HERO_WORDS = ["Joyful", "Cozy", "Lively", "Bright"]
ORDINALS = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 11: "11th", 12: "12th", 13: "13th"}
CITIES = {"new-delhi": "New Delhi", "gurugram": "Gurugram", "noida": "Noida", "bengaluru": "Bengaluru", "mumbai": "Mumbai", "tokyo": "Tokyo"}
CATEGORY_SLUGS = ["family", "books", "games", "tech", "food-drink", "ai", "running", "arts-culture", "climate", "fitness", "wellness", "crypto"]
CATEGORY_NAMES = ["Family", "Books", "Games", "Tech", "Food & Drink", "AI", "Running", "Arts & Culture", "Climate", "Fitness", "Wellness", "Crypto"]
COMMUNITIES = {
    "chapterhouse": ("Chapterhouse Readers", "Mumbai", "Readings, swaps and zine days for slow readers."),
    "builders-guild": ("Builders Guild", "Noida", "Evening meetups for people who build software."),
    "trail-runners": ("Trail Runners Collective", "Bengaluru", "Easy-paced group runs around lakes and parks."),
    "maker-hub": ("Maker Hub", "New Delhi", "Hands-on workshops for makers of every age."),
}
SEED_EVENTS = {
    "gamenite": ("Founders Board Game Night", "amber", "Gurugram", "Rolling Dice Cafe", "First Floor, 14 Sector 29 Market", 3, "17:00", 3, "20:00", {"require_approval": True, "capacity": 40, "categories": ["games"]}),
    "streamup": ("Stream Processing Meetup", "harbor", "Noida", "Riverside Tech Park", "Tower B, 7 Sector 62", 5, "18:00", 5, "21:00", {"require_approval": True, "categories": ["tech"], "calendar": "builders-guild"}),
    "runclub7": ("Sunrise 5K Run Club", "moss", "Bengaluru", "Lakeside Gate 2", "11 Kensington Road", 2, "06:00", 2, "07:30", {"capacity": 60, "categories": ["running", "fitness"], "calendar": "trail-runners"}),
    "launchpt": ("Indie App Launch Party", "plum", "Mumbai", "Harbour Loft", "3rd Floor, 41 Colaba Causeway", 9, "19:00", 9, "23:00", {"visibility": "private", "require_approval": True, "categories": ["tech"]}),
    "fireworx": ("Riverside Fireworks Viewing", "night", "Tokyo", "Sumida Riverbank Zone C", "2-1 Mukojima Riverside Walk", 12, "19:00", 12, "21:00", {"visibility": "private", "registration_status": "code_only"}),
    "closedbf": ("Founders Breakfast Club", "ember", "New Delhi", "Lodhi Garden Cafe", "Shop 12, 5 Lodhi Road", 4, "08:00", 4, "10:00", {"registration_status": "closed", "categories": ["food-drink"]}),
    "poetwalk": ("Monsoon Poetry Walk", "harbor", "Mumbai", "Marine Drive Steps", "Steps 9, Netaji Subhash Road", -7, "17:00", -7, "19:00", {"categories": ["books"], "calendar": "chapterhouse"}),
    "potterya": ("Pottery Wheel Workshop", "ember", "New Delhi", "Clayroom Studio", "22 Hauz Khas Village", 6, "11:00", 6, "13:00", {"capacity": 2, "waitlist": True, "categories": ["arts-culture"], "calendar": "maker-hub"}),
    "designjm": ("Design Jam Saturday", "plum", "Bengaluru", "Courtyard Studio", "18 Wood Street, Ashok Nagar", 8, "10:00", 8, "17:00", {"require_approval": True, "categories": ["arts-culture"]}),
    "foodwalk": ("Old Delhi Food Walk", "amber", "New Delhi", "Chandni Chowk Gate 5", "Gate 5, Chandni Chowk Road", 3, "09:00", 3, "12:00", {"categories": ["food-drink"]}),
    "climatec": ("Climate Circle Meetup", "moss", "Mumbai", "Greenhouse Commons", "9 Linking Road, Bandra West", 10, "18:00", 10, "20:00", {"require_approval": True, "categories": ["climate"]}),
    "chessblt": ("Blitz Chess Afternoon", "amber", "Tokyo", "Asakusa Board Room", "1-4 Kaminarimon, Taito", 7, "14:00", 7, "17:00", {"categories": ["games"]}),
    "kidsartm": ("Family Art Morning", "harbor", "Noida", "Sector 18 Library", "Block C, Sector 18 Market", 5, "10:00", 5, "12:00", {"categories": ["family", "arts-culture"], "calendar": "maker-hub"}),
    "zinefest": ("Small Press Zine Fair", "plum", "Mumbai", "Bandra Warehouse", "27 Hill Road, Bandra West", 14, "11:00", 15, "19:00", {"categories": ["books", "arts-culture"], "calendar": "chapterhouse"}),
    "gardenfs": ("Monsoon Garden Festival", "moss", "Bengaluru", "Cubbon Park Bandstand", "Bandstand Lawn, Kasturba Road", 20, "10:00", 21, "18:00", {"categories": ["family", "wellness"]}),
}
SEED_DEFAULTS = {"visibility": "public", "require_approval": False, "capacity": None, "waitlist": False, "registration_status": "open", "calendar": None, "categories": []}
THEMED_EVENTS = {"amber": "gamenite", "harbor": "streamup", "moss": "runclub7", "plum": "designjm", "ember": "closedbf", "night": "fireworx"}
CARD_ACTIONS = ["Request to Join", "Register", "Join Waitlist", "Cancel Request", "Cancel Registration", "Leave Waitlist"]

OUTAGE_HEADING = "Mela is taking a short break"
OUTAGE_LINE = "We can't reach our data right now. Please try again in a moment."
OUTAGE_ALERT = "Mela is taking a short break. Your change was not saved. Please try again in a moment."
NOT_FOUND_HEADING = "We couldn't find that page"
NOT_FOUND_LINE = "The page or event you're looking for isn't here."
ADDRESS_HIDDEN = "Register to See Address"
ADDRESS_HIDDEN_LINE = "The exact address is shared with confirmed guests."
RANGE_MESSAGE = "Capacity must be a whole number from 1 to 10,000, or empty for unlimited"
UNKNOWN_FIELD = "Unknown field"
BODY_MESSAGE = "Expected a JSON object"
CANCEL_TOAST = "Registration cancelled"
GAMENITE = "gamenite"
GAMES_IN_GURUGRAM = f"{CATEGORY_NAMES[CATEGORY_SLUGS.index('games')]} in {CITIES['gurugram']}"
LOST_MESSAGE = "Lost answer message"
BUSY_JS = "(c) => c.getAttribute('aria-busy') === 'true'"
INVALID_JS = "(f) => f.getAttribute('aria-invalid') === 'true'"
ANY_INVALID_JS = "() => document.querySelector('[aria-invalid=\"true\"]') !== null"
NEXT_PROBES = ["//host", "/\\host", "%2F%2Fhost", "/%5Chost", "https://host/", "javascript:void(0)"]
ALLOWED_LICENCES = ["MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "PSF-2.0", "MPL-2.0", "LGPL-3.0"]
DATASTORE_STEMS = ["mongo", "mysql", "sqlite", "redis", "supabase", "firebase"]
DATABASE_STARTER_RE = re.compile(
    r"^\s*(sudo\s+)?(initdb\b|pg_ctl(cluster)?\b.*\bstart\b|postgres\s+-D\b|docker\s+run\b|"
    r"apt(-get)?\s+install\b.*\bpostgresql(-\d+)?(?![\w-])|mysqld\b|redis-server\b|mongod\b)"
)
HEREDOC_RE = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n.*?\n[ \t]*\1[ \t]*(?=\n|$)", re.S)
COMMAND_KEYS = ("command", "cmd")
QUOTED_RE = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")
LICENCE_PATTERNS = [
    r"\bMIT\b",
    r"\bBSD[- ]?2[- ]?Clause\b|\b2[- ]Clause BSD\b",
    r"\bBSD[- ]?3[- ]?Clause\b|\b3[- ]Clause BSD\b",
    r"\bApache(?:[- ]License)?[-, ]*(?:Version |v)?2(?:\.0)?\b",
    r"\bISC\b",
    r"\bPSF(?:[- ]?2(?:\.0)?)?\b|Python Software Foundation",
    r"\bMPL[- ]?2(?:\.0)?\b|Mozilla Public License[, ]*(?:Version |v)?2",
    r"\bLGPL[- ]?v?3|Lesser General Public License[, ]*(?:Version |v)?3",
]

DROP = object()
_PAUSE = threading.Event()


def norm(url: str) -> str:
    return url.rstrip("/")


def event_path(slug: str, tail: str = "") -> str:
    return f"/api/events/{slug}{tail}"


def follow_path(slug: str) -> str:
    return f"/api/calendars/{slug}/follow"


def meter_line(going: int, capacity: int) -> str:
    return f"{going} of {capacity} places taken"


def left_line(left: int) -> str:
    return "1 place left" if left == 1 else f"{left} places left"


def going_line(going: int) -> str:
    return f"{going} Going"


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def api(base: str, token: str | None = None) -> httpx.Client:
    headers = {"Origin": origin_of(base)}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.Client(base_url=base, headers=headers, timeout=HTTP_TIMEOUT, follow_redirects=False)


def identity(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    email = first if "@" in first else second
    name = second if email == first else first
    return name, email


@dataclass
class Member:
    base: str
    name: str
    email: str
    password: str
    token: str
    id: Any
    http: httpx.Client


def signup(base: str, prefix: str = "member", name: str | None = None) -> Member:
    generated, email = identity(prefix)
    with api(base) as client:
        response = client.post("/api/auth/signup", json={"name": name or generated, "email": email, "password": PROBE_PASSWORD})
    assert response.status_code == 201, response.text
    data = response.json()
    user = data["user"]
    return Member(base, user["name"], user["email"], PROBE_PASSWORD, data["token"], user["id"], api(base, data["token"]))


def signin(base: str, email: str, password: str = SEED_PASSWORD) -> Member:
    with api(base) as client:
        response = client.post("/api/auth/signin", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    data = response.json()
    user = data["user"]
    return Member(base, user["name"], user["email"], password, data["token"], user["id"], api(base, data["token"]))


@functools.cache
def pg() -> Postgres:
    return Postgres()


def lit(value: Any) -> str:
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def in_list(values) -> str:
    return ", ".join(lit(v) for v in values)


def registration(slug: str, email: str) -> dict | None:
    rows = pg().rows(
        "SELECT r.id, r.status, r.requested_at::text AS requested_at FROM registrations r "
        "JOIN events e ON e.id = r.event_id JOIN members m ON m.id = r.member_id "
        f"WHERE e.slug = {lit(slug)} AND m.email = {lit(email)}"
    )
    assert len(rows) <= 1, rows
    return rows[0] if rows else None


def status_of(slug: str, email: str) -> str | None:
    row = registration(slug, email)
    return row["status"] if row else None


def approved_count(slug: str) -> int:
    rows = pg().rows(
        "SELECT count(*) AS n FROM registrations r JOIN events e ON e.id = r.event_id "
        f"WHERE e.slug = {lit(slug)} AND r.status = 'approved'"
    )
    return int(rows[0]["n"])


def event_row(slug: str) -> dict:
    rows = pg().rows(f"SELECT to_jsonb(e) AS row FROM events e WHERE e.slug = {lit(slug)}")
    assert len(rows) == 1, rows
    return rows[0]["row"]


def events_named(name: str) -> int:
    return int(pg().rows(f"SELECT count(*) AS n FROM events WHERE name = {lit(name)}")[0]["n"])


def member_count(email: str) -> int:
    return int(pg().rows(f"SELECT count(*) AS n FROM members WHERE lower(email) = lower({lit(email)})")[0]["n"])


def follow_rows(email: str) -> int:
    rows = pg().rows(
        "SELECT count(*) AS n FROM follows f WHERE EXISTS (SELECT 1 FROM jsonb_each_text(to_jsonb(f)) kv "
        f"WHERE kv.key <> 'id' AND kv.value = (SELECT id::text FROM members WHERE email = {lit(email)}))"
    )
    return int(rows[0]["n"])


def sent_rows(table: str, email: str, slug: str) -> int:
    rows = pg().rows(
        f"SELECT count(*) AS n FROM {table} t JOIN members m ON m.id = t.member_id JOIN events e ON e.id = t.event_id "
        f"WHERE m.email = {lit(email)} AND e.slug = {lit(slug)}"
    )
    return int(rows[0]["n"])


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def instant(text: str) -> datetime:
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    assert value.tzinfo is not None, text
    return value


def make_event(host: Member, *, start: datetime | None = None, length: timedelta = timedelta(hours=2), days: float = 30, **fields) -> dict:
    begin = start or now_utc() + timedelta(days=days)
    tag = uuid.uuid4().hex[:10]
    body: dict[str, Any] = {
        "name": f"Probe Gathering {tag}",
        "start_at": begin.isoformat(),
        "end_at": (begin + length).isoformat(),
        "visibility": "private",
        "venue_name": f"Probe Hall {tag}",
        "street_address": f"{tag} Probe Lane",
        "city": "Noida",
    }
    body.update(fields)
    body = {k: v for k, v in body.items() if v is not DROP}
    response = host.http.post("/api/events", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def register(member: Member, slug: str, **body) -> httpx.Response:
    return member.http.post(f"/api/events/{slug}/register", json=body)


def cancel(member: Member, slug: str) -> httpx.Response:
    return member.http.delete(f"/api/events/{slug}/register")


def guest_id(host: Member, slug: str, email: str) -> Any:
    response = host.http.get(f"/api/events/{slug}/guests")
    assert response.status_code == 200, response.text
    for guest in response.json():
        if guest["email"] == email:
            return guest["id"]
    pytest.fail(f"{email} missing from the guest list of {slug}")


def decide(host: Member, slug: str, gid: Any, action: str) -> httpx.Response:
    return host.http.post(f"/api/events/{slug}/guests/{gid}", json={"action": action})


def event_as(member: Member | None, slug: str, base: str | None = None) -> dict:
    client = member.http if member else api(base)
    response = client.get(f"/api/events/{slug}")
    assert response.status_code == 200, response.text
    return response.json()


def counts_consistent(event: dict) -> None:
    if event["capacity"] is None:
        assert event["places_left"] is None
    else:
        assert event["going_count"] + event["places_left"] == event["capacity"], event


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call):
        barrier.wait()
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def poll(probe: Callable[[], Any], seconds: float, why: Callable[[], str] = lambda: "") -> Any:
    end = time.monotonic() + seconds
    while True:
        value = probe()
        if value:
            return value
        if time.monotonic() > end:
            pytest.fail(f"condition not met within {seconds}s {why()}")
        _PAUSE.wait(POLL_INTERVAL)


def wait_until(moment: datetime) -> None:
    poll(lambda: datetime.now(timezone.utc) >= moment, (moment - datetime.now(timezone.utc)).total_seconds() + RESPONSE_SLACK + 1)


def safe_get(base: str, path: str, token: str | None = None) -> httpx.Response | None:
    try:
        with api(base, token) as client:
            return client.get(path)
    except httpx.TransportError:
        return None


def assert_no_store(response: httpx.Response) -> None:
    cache = {t.strip().lower() for v in response.headers.get_list("Cache-Control") for t in v.split(",")}
    vary = {t.strip().lower() for v in response.headers.get_list("Vary") for t in v.split(",")}
    assert {"private", "no-store"} <= cache, (str(response.url), cache)
    assert {"cookie", "authorization"} <= vary, (str(response.url), vary)


def path_and_query(url: str) -> str:
    parts = urlsplit(url)
    return parts.path + (f"?{parts.query}" if parts.query else "")


def next_of(location: str) -> str:
    return parse_qs(urlsplit(location).query)["next"][0]


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@dataclass
class Copy:
    proc: subprocess.Popen
    log: Path
    url: str
    port: int

    def tail(self) -> str:
        try:
            return self.log.read_text(errors="replace")[-4000:]
        except OSError:
            return ""

    def stop(self) -> None:
        if self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
                self.proc.wait()


def start_copy(extra_env: dict[str, str]) -> Copy:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), **extra_env)
    handle = tempfile.NamedTemporaryFile(prefix="mela-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(["/bin/sh", "-c", manifest["serve"]], cwd=str(DEPLOYED_APP), env=env,
                            stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
    return Copy(proc, Path(handle.name), f"http://127.0.0.1:{port}", port)


def answer_from(copy: Copy, path: str, status: int, seconds: float, state: str | None = None) -> httpx.Response:
    def probe():
        assert copy.proc.poll() is None, f"copy exited:\n{copy.tail()}"
        response = safe_get(copy.url, path)
        if response is None or response.status_code != status:
            return None
        return response if state is None or response.json().get("status") == state else None

    return poll(probe, seconds, copy.tail)


def listens_on_every_interface(port: int) -> bool:
    hexport = f"{port:04X}"
    for table, anyaddr in (("/proc/net/tcp", "0" * 8), ("/proc/net/tcp6", "0" * 32)):
        try:
            lines = Path(table).read_text().splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            parts = line.split()
            address, local_port = parts[1].split(":")
            if local_port == hexport and parts[3] == "0A" and address == anyaddr:
                return True
    return False


class Relay:

    def __init__(self, host: str, port: int):
        self.upstream = (host, port)
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.sockets: list[socket.socket] = []
        self.lock = threading.Lock()

    def start(self) -> None:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", self.port))
        listener.listen(64)
        self.listener = listener
        threading.Thread(target=self._accept, args=(listener,), daemon=True).start()

    def _accept(self, listener: socket.socket) -> None:
        while True:
            try:
                inbound, _ = listener.accept()
            except OSError:
                return
            try:
                outbound = socket.create_connection(self.upstream, timeout=5)
                outbound.settimeout(None)
            except OSError:
                inbound.close()
                continue
            with self.lock:
                self.sockets += [inbound, outbound]
            for a, b in ((inbound, outbound), (outbound, inbound)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(source: socket.socket, sink: socket.socket) -> None:
        try:
            while data := source.recv(65536):
                sink.sendall(data)
        except OSError:
            pass
        for s in (source, sink):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def stop(self) -> None:
        listener, self.listener = self.listener, None
        if listener:
            try:
                listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            listener.close()
        with self.lock:
            for s in self.sockets:
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                s.close()
            self.sockets.clear()


def relayed(database_url: str, port: int) -> str:
    parts = urlsplit(database_url)
    userinfo = parts.netloc.rpartition("@")[0]
    netloc = f"{userinfo}@127.0.0.1:{port}" if userinfo else f"127.0.0.1:{port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def sign_in_page(page: Page, member: Member, base: str | None = None) -> None:
    target = base or member.base
    response = page.request.post(f"{target}/api/auth/signin", data={"email": member.email, "password": member.password},
                                 headers={"Origin": origin_of(target)})
    assert response.status == 200, response.text()


@contextmanager
def live(browser: Browser, url: str, *, member: Member | None = None, viewport: tuple[int, int] | None = None,
         js: bool = True, tz: str | None = None, on_page: Callable[[Page], None] | None = None,
         bypass_csp: bool = False) -> Iterator[Page]:
    options: dict[str, Any] = {}
    if bypass_csp:
        options["bypass_csp"] = True
    if viewport:
        options["viewport"] = {"width": viewport[0], "height": viewport[1]}
    if not js:
        options["java_script_enabled"] = False
    if tz:
        options["timezone_id"] = tz
    context = browser.new_context(**options)
    page = context.new_page()
    try:
        if member:
            sign_in_page(page, member, origin_of(url))
        if on_page:
            on_page(page)
        page.goto(url)
        yield page
    finally:
        context.close()


def card_of(page: Page):
    return page.get_by_role("region", name="Registration")


def notifications(page: Page):
    return page.get_by_role("status", name="Notifications")


def body_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def mark_page(page: Page) -> None:
    page.evaluate("() => { window.__melaProbe = true; }")


def still_same_document(page: Page) -> bool:
    return page.evaluate("() => window.__melaProbe === true")


def combobox_options(page: Page, box) -> list[str]:
    options = box.evaluate("(s) => s.options ? Array.from(s.options, o => o.text.trim()) : null")
    if options is None:
        box.click()
        options = [o.strip() for o in page.get_by_role("option").all_inner_texts()]
        page.keyboard.press("Escape")
    return options


def combobox_value(box) -> str:
    return box.evaluate("(s) => (s.options ? s.options[s.selectedIndex].text : s.innerText).trim()")


def any_visible(locator, seconds: float = VISIBLE_DEADLINE) -> None:
    poll(lambda: any(locator.nth(i).is_visible() for i in range(locator.count())), seconds, lambda: str(locator))


def visible_boxes(locator) -> list[dict]:
    any_visible(locator)
    return [locator.nth(i).bounding_box() for i in range(locator.count()) if locator.nth(i).is_visible()]


def visible_texts(locator) -> list[str]:
    any_visible(locator)
    return [locator.nth(i).inner_text() for i in range(locator.count()) if locator.nth(i).is_visible()]


def open_when_ready(page: Page, url: str, ready, seconds: float) -> None:
    def probe():
        if ready.count() and ready.first.is_visible():
            return True
        page.goto(url)
        return False

    poll(probe, seconds)


def press_until(action, done: Callable[[], bool], seconds: float) -> None:
    def probe():
        if done():
            return True
        if action.count() and action.is_visible() and action.is_enabled():
            action.click()
        return False

    poll(probe, seconds)


def page_client(member: Member) -> httpx.Client:
    client = httpx.Client(base_url=member.base, headers={"Origin": origin_of(member.base)}, timeout=HTTP_TIMEOUT, follow_redirects=False)
    response = client.post("/api/auth/signin", json={"email": member.email, "password": member.password})
    assert response.status_code == 200, response.text
    return client


def choose(page: Page, box, label: str) -> None:
    if box.evaluate("(s) => !!s.options"):
        box.select_option(label=label)
    else:
        box.click()
        page.get_by_role("option", name=label).click()


def reveal_location(page: Page, venue) -> None:
    if venue.is_visible():
        return
    page.get_by_text("Add Event Location").first.click()
    try:
        venue.wait_for(state="visible", timeout=LOCATION_REVEAL_MS)
    except PlaywrightTimeoutError:
        choose(page, page.get_by_role("combobox", name="Location type"), "Offline")
        venue.wait_for(state="visible")


QUIESCE_JS = """() => {
  for (const a of document.getAnimations()) {
    const t = a.effect && a.effect.getComputedTiming();
    if (t && Number.isFinite(t.endTime)) { try { a.finish(); } catch (e) {} }
  }
  return document.getAnimations().filter((a) => a.playState === 'running' && a.effect && Number.isFinite(a.effect.getComputedTiming().endTime)).length === 0;
}"""


def quiesce(page: Page) -> None:
    page.wait_for_load_state("networkidle")
    poll(lambda: page.evaluate(QUIESCE_JS), QUIESCE_SECONDS)


def no_sideways(page: Page) -> None:
    assert page.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth"), (page.url, page.viewport_size)


def at_most(page: Page, locator, limit: int) -> None:
    spent = [0]

    def probe():
        if locator.count() <= limit:
            return True
        if spent[0] < EXIT_FAKE_MS:
            advance(page, EXIT_STEP_MS)
            spent[0] += EXIT_STEP_MS
        return False

    poll(probe, EXIT_DEADLINE)


def gone(page: Page, locator) -> None:
    spent = [0]

    def probe():
        if spent[0] < EXIT_FAKE_MS:
            advance(page, EXIT_STEP_MS)
            spent[0] += EXIT_STEP_MS
        return locator.count() == 0

    poll(probe, EXIT_DEADLINE)


CELEBRATION_LAYERS_JS = """() => Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter((n) => {
    if (n.closest('header, main, footer') || n.querySelector('header, main, footer')) return false;
    if (n.parentElement && n.parentElement.closest('[aria-hidden="true"]')) return false;
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const canvas = n.tagName === 'CANVAS' || n.getElementsByTagName('canvas').length > 0;
    return canvas || n.getElementsByTagName('*').length >= %d;
  })""" % CONFETTI_MIN

CELEBRATION_JS = "() => (%s)().length" % CELEBRATION_LAYERS_JS

TILE_TEXT_JS = """(a) => {
  let n = a;
  while (n.parentElement && n.parentElement !== document.body && n.parentElement.querySelectorAll('a[href]').length <= 1) n = n.parentElement;
  return n.innerText;
}"""

CELEBRATION_SNAPSHOT_JS = "() => { window.__melaBefore = (%s)(); }" % CELEBRATION_LAYERS_JS

CELEBRATION_NODE_JS = """() => {
  const before = window.__melaBefore || [];
  const layer = (%s)().find(n => !before.includes(n));
  window.__melaLayer = layer;
  return layer ? {focus: layer.contains(document.activeElement), overflow: document.documentElement.scrollWidth > innerWidth} : null;
}""" % CELEBRATION_LAYERS_JS

CELEBRATION_GONE_JS = """() => {
  const l = window.__melaLayer;
  if (!l || !l.isConnected) return true;
  const s = getComputedStyle(l);
  return s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0;
}"""


def celebrations(page: Page) -> int:
    return page.evaluate(CELEBRATION_JS)


def test_wf_deployment_health(app_url):
    base = norm(app_url)
    seen = set()
    with api(base) as client:
        for _ in range(6):
            response = client.get("/api/health")
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["status"] == "ok"
            seen.add(body["started_at"])
    assert len(seen) == 1, seen
    started = instant(seen.pop())
    assert started.utcoffset() == timedelta(0)
    assert started <= datetime.now(timezone.utc) + CLOCK_SLACK
    down = norm(os.environ["APP_POSTGRES_DOWN_URL"])
    with api(down) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "unavailable"}
    copy = start_copy({"DATABASE_URL": relayed(os.environ["DATABASE_URL"], free_port())})
    try:
        booting = answer_from(copy, "/api/health", 200, COPY_BOOT_DEADLINE, "unavailable")
        assert booting.json() == {"status": "unavailable"}
        assert listens_on_every_interface(copy.port), copy.tail()
    finally:
        copy.stop()


def assert_seed_once() -> None:
    rows = pg().rows(f"SELECT email, name FROM members WHERE lower(email) IN ({in_list(SEED_MEMBERS)})")
    assert sorted((r["email"], r["name"]) for r in rows) == sorted(SEED_MEMBERS.items())
    rows = pg().rows(f"SELECT slug, count(*) AS n FROM events WHERE slug IN ({in_list(SEED_EVENTS)}) GROUP BY slug")
    assert {r["slug"]: int(r["n"]) for r in rows} == {slug: 1 for slug in SEED_EVENTS}
    assert int(pg().rows("SELECT count(*) AS n FROM calendars")[0]["n"]) == len(COMMUNITIES)
    rows = pg().rows(
        "SELECT e.slug, m.email, count(*) AS n FROM registrations r JOIN events e ON e.id = r.event_id "
        "JOIN members m ON m.id = r.member_id "
        f"WHERE e.slug IN ('gamenite', 'potterya') AND m.email IN ({in_list([GUEST_EMAIL, GUEST2_EMAIL])}) GROUP BY e.slug, m.email"
    )
    assert sorted((r["slug"], r["email"], int(r["n"])) for r in rows) == sorted(
        (slug, email, 1) for slug in ("gamenite", "potterya") for email in (GUEST_EMAIL, GUEST2_EMAIL))


def test_wf_deployment_seed(app_url):
    base = norm(app_url)
    assert_seed_once()
    host = signin(base, HOST_EMAIL)
    for email in SEED_MEMBERS:
        signin(base, email)
    seed_day = None
    for slug, (name, theme, city, venue, street, sday, stime, eday, etime, setup) in SEED_EVENTS.items():
        event = event_as(host, slug)
        expected = dict(SEED_DEFAULTS, **setup)
        assert event["name"] == name and event["theme"] == theme and event["city"] == city
        assert event["venue_name"] == venue and event["street_address"] == street
        assert event["location_type"] == "offline" and event["show_guest_list"] is True
        assert event["host"]["name"] == "Noor Kapoor"
        for key in ("visibility", "require_approval", "capacity", "waitlist", "registration_status", "calendar"):
            assert event[key] == expected[key], (slug, key, event[key])
        assert sorted(event["categories"]) == sorted(expected["categories"])
        zone = "Asia/Tokyo" if city == "Tokyo" else "Asia/Kolkata"
        assert event["timezone"] == zone
        start = instant(event["start_at"]).astimezone(ZoneInfo(zone))
        end = instant(event["end_at"]).astimezone(ZoneInfo(zone))
        if seed_day is None:
            seed_day = start.date() - timedelta(days=sday)
        assert start.date() == seed_day + timedelta(days=sday), slug
        assert end.date() == seed_day + timedelta(days=eday), slug
        assert start.strftime("%H:%M") == stime and end.strftime("%H:%M") == etime, slug
    with api(base) as client:
        calendars = {c["slug"]: c for c in client.get("/api/calendars").json()}
        discover = client.get("/api/discover").json()
    for slug, (name, city, description) in COMMUNITIES.items():
        assert (calendars[slug]["name"], calendars[slug]["city"], calendars[slug]["description"]) == (name, city, description)
    assert {p["slug"]: p["name"] for p in discover["places"]} == CITIES
    assert [c["slug"] for c in discover["categories"]] == CATEGORY_SLUGS
    assert [c["name"] for c in discover["categories"]] == CATEGORY_NAMES


def test_wf_deployment_twin_boot(app_url):
    copies = [start_copy({}), start_copy({})]
    try:
        for copy in copies:
            response = answer_from(copy, "/api/health", 200, COPY_BOOT_DEADLINE, "ok")
            assert response.json()["status"] == "ok"
        assert_seed_once()
    finally:
        for copy in copies:
            copy.stop()


def test_wf_deployment_outage_recovery(app_url, browser):
    base = norm(app_url)
    database_url = os.environ["DATABASE_URL"]
    upstream = urlsplit(database_url)
    relay = Relay(upstream.hostname, upstream.port or 5432)
    copy = start_copy({"DATABASE_URL": relayed(database_url, relay.port)})
    try:
        booting = answer_from(copy, "/api/health", 200, COPY_BOOT_DEADLINE, "unavailable")
        assert booting.json() == {"status": "unavailable"}
        relay.start()
        started = answer_from(copy, "/api/health", 200, BOOT_READY_SECONDS + RESPONSE_SLACK, "ok").json()["started_at"]

        host = signup(base, "outagehost")
        guest = signup(base, "outageguest")
        event = make_event(host, require_approval=True)
        slug = event["slug"]
        assert register(guest, slug).json()["status"] == "pending"
        with api(copy.url, host.token) as client:
            assert client.get("/api/me").status_code == 200

        with live(browser, f"{copy.url}/manage/{slug}", member=host) as page:
            expect(page.get_by_role("button", name=f"Approve {guest.name}")).to_be_visible()
            relay.stop()
            stopped = time.monotonic()
            while True:
                sent = time.monotonic()
                response = safe_get(copy.url, "/api/me", host.token)
                assert response is not None, "request failed at the network level"
                assert time.monotonic() - sent <= OUTAGE_ANSWER_SECONDS + RESPONSE_SLACK
                assert response.status_code in (200, 503), response.text
                if response.status_code == 503:
                    break
                assert sent - stopped <= OUTAGE_ONSET_SECONDS + RESPONSE_SLACK, "outage responses did not begin in time"
                _PAUSE.wait(POLL_INTERVAL)
            assert response.json() == {"error": "service_unavailable"}
            assert response.headers.get("Retry-After") == RETRY_AFTER

            outage = page.goto(f"{copy.url}/manage/{slug}")
            assert outage.status == 503
            expect(page.get_by_role("heading", level=1)).to_have_text(OUTAGE_HEADING)
            expect(page.get_by_text(OUTAGE_LINE)).to_be_visible()
            retry = page.get_by_role("link", name="Try Again")
            assert urlsplit(urljoin(page.url, retry.get_attribute("href"))).path == f"/manage/{slug}"
            expect(page.get_by_role("link", name="Sign In")).to_be_visible()
            for src in page.evaluate("() => Array.from(document.scripts, s => s.src).filter(Boolean)"):
                assert httpx.get(src, timeout=HTTP_TIMEOUT).status_code == 200, src

            relay.start()
            healthy = answer_from(copy, "/api/health", 200, RECOVERY_SECONDS + RESPONSE_SLACK, "ok")
            assert healthy.json()["started_at"] == started
            retry.click()
            approve = page.get_by_role("button", name=f"Approve {guest.name}")
            open_when_ready(page, f"{copy.url}/manage/{slug}", approve, RECOVERY_SECONDS + RESPONSE_SLACK)
            press_until(approve, lambda: status_of(slug, guest.email) == "approved", RECOVERY_SECONDS + RESPONSE_SLACK)
            expect(notifications(page)).to_contain_text(f"Approved {guest.name}")
        assert status_of(slug, guest.email) == "approved"

        def follows():
            with api(copy.url, guest.token) as client:
                response = client.put(follow_path("builders-guild"))
            return response if response.status_code == 200 else None

        followed = poll(follows, RECOVERY_SECONDS + RESPONSE_SLACK)
        assert followed.json()["following"] is True
        assert follow_rows(guest.email) == 1
    finally:
        relay.stop()
        copy.stop()


def test_wf_accounts_signup_api(app_url):
    base = norm(app_url)
    name, email = identity("signup")
    mixed = email.upper()
    with api(base) as client:
        refused = client.post("/api/auth/signup", json={"name": name, "email": email, "password": PROBE_PASSWORD, "is_host": True})
        assert refused.status_code == 422 and refused.json()["errors"]["is_host"] == UNKNOWN_FIELD
        assert member_count(email) == 0
        assert client.post("/api/auth/check", json={"email": email}).json() == {"exists": False}
        created = client.post("/api/auth/signup", json={"name": name, "email": mixed, "password": PROBE_PASSWORD})
        assert created.status_code == 201, created.text
        data = created.json()
        assert data["user"]["email"] == email and data["user"]["name"] == name and data["token"]
        cookie = ",".join(created.headers.get_list("set-cookie")).lower()
        assert "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie
        assert member_count(email) == 1
        rows = pg().rows(f"SELECT email FROM members WHERE lower(email) = {lit(email)}")
        assert rows == [{"email": email}]
        assert client.post("/api/auth/check", json={"email": mixed}).json() == {"exists": True}
        assert client.post("/api/auth/check", json={"email": "not-an-email"}).status_code == 422
        taken = client.post("/api/auth/signup", json={"name": name, "email": email.capitalize(), "password": PROBE_PASSWORD})
        assert taken.status_code == 409 and taken.json() == {"error": "email_taken"}
        assert member_count(email) == 1
    with api(base, data["token"]) as client:
        assert client.get("/api/me").json()["user"]["email"] == email
    twin_name, twin_email = identity("twin")
    with api(base) as client:
        twin = client.post("/api/auth/signup", json={"name": twin_name, "email": twin_email, "password": "p" * PASSWORD_MIN})
    assert twin.status_code == 201


def test_password_hashes(app_url):
    base = norm(app_url)
    first = signup(base, "samepass")
    other = signup(base, "samepass")
    name, email = identity("otherpass")
    with api(base) as client:
        third = client.post("/api/auth/signup", json={"name": name, "email": email, "password": WRONG_PASSWORD})
    assert third.status_code == 201, third.text
    emails = [first.email, other.email, third.json()["user"]["email"]]
    rows = pg().rows(f"SELECT email, to_jsonb(m) - 'id' - 'email' - 'name' AS rest FROM members m WHERE email IN ({in_list(emails)})")
    by_email = {r["email"]: r["rest"] for r in rows}
    a, b, c = (by_email[e] for e in emails)
    for rest in (a, b):
        assert all(PROBE_PASSWORD not in str(v) for v in rest.values())
    assert all(WRONG_PASSWORD not in str(v) for v in c.values())

    def is_time(value: str) -> bool:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            return True
        except ValueError:
            return False

    texts = [k for k, v in a.items() if isinstance(v, str) and not is_time(v)]
    same_for_one_password = [k for k in texts if a[k] == b.get(k) and a[k] != c.get(k)]
    assert not same_for_one_password, same_for_one_password
    assert any(a[k] != b.get(k) for k in texts)


SIGNUP_CASES = ["invalid-email", "short-password", "missing-name", "blank-name", "long-name"]


@pytest.mark.parametrize("case", SIGNUP_CASES, ids=SIGNUP_CASES)
def test_signup_validation(app_url, case):
    base = norm(app_url)
    name, email = identity("invalid")
    body = {"name": name, "email": email, "password": PROBE_PASSWORD}
    field = {"invalid-email": "email", "short-password": "password"}.get(case, "name")
    if case == "invalid-email":
        body["email"] = email.replace("@", "")
    elif case == "short-password":
        body["password"] = "p" * (PASSWORD_MIN - 1)
    elif case == "missing-name":
        del body["name"]
    elif case == "blank-name":
        body["name"] = "   "
    else:
        body["name"] = "n" * (MEMBER_NAME_MAX + 1)
    with api(base) as client:
        response = client.post("/api/auth/signup", json=body)
    assert response.status_code == 422, response.text
    assert field in response.json()["errors"]
    assert member_count(email) == 0
    assert member_count(email.replace("@", "")) == 0


def test_wf_accounts_signin_signout(app_url):
    base = norm(app_url)
    member = signup(base, "signout")
    stranger = identity("stranger")[1]
    with api(base) as client:
        wrong = client.post("/api/auth/signin", json={"email": member.email, "password": WRONG_PASSWORD})
        unknown = client.post("/api/auth/signin", json={"email": stranger, "password": WRONG_PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"error": "invalid_credentials"}
    with api(base) as cookie_client:
        signed = cookie_client.post("/api/auth/signin", json={"email": member.email, "password": member.password})
        assert signed.status_code == 200
        token = signed.json()["token"]
        jar = dict(cookie_client.cookies)
        assert jar
        assert cookie_client.get("/api/me").status_code == 200
        assert cookie_client.post("/api/auth/signout").status_code == 204
    replay = httpx.Client(base_url=base, cookies=jar, headers={"Origin": origin_of(base)}, timeout=HTTP_TIMEOUT)
    after = replay.get("/api/me")
    assert after.status_code == 401 and after.json() == {"error": "unauthenticated"}
    with api(base, token) as client:
        assert client.get("/api/me").status_code == 401


def test_wf_accounts_signin_screen(app_url, browser):
    base = norm(app_url)
    member = signup(base, "returning")
    with live(browser, f"{base}/signin") as page:
        expect(page.get_by_role("heading", name="Sign in to Mela")).to_be_visible()
        expect(page.get_by_text("Use your email to sign in or create an account.")).to_be_visible()
        email = page.get_by_role("textbox", name="Email")
        expect(email).to_have_attribute("placeholder", "you@email.com")
        mark_page(page)
        email.fill(member.email)
        page.get_by_role("button", name="Continue with Email").click()
        password = page.get_by_label("Password", exact=True)
        expect(password).to_be_visible()
        expect(page.get_by_role("textbox", name="Name")).to_have_count(0)
        assert still_same_document(page)
        password.fill(WRONG_PASSWORD)
        page.get_by_role("button", name="Sign In").click()
        expect(page.get_by_role("alert")).to_have_count(1)
        expect(page.get_by_role("alert")).to_contain_text("Incorrect email or password")
        password.fill(member.password)
        page.get_by_role("button", name="Sign In").click()
        page.wait_for_url(lambda u: urlsplit(u).path == "/home")
        expect(notifications(page)).to_contain_text(f"Signed in as {member.name}")
    name, address = identity("newcomer")
    with live(browser, f"{base}/signin?next=" + quote("/c/chapterhouse?x=1", safe="")) as page:
        page.get_by_role("textbox", name="Email").fill(address)
        page.get_by_role("button", name="Continue with Email").click()
        page.get_by_role("textbox", name="Name").fill(name)
        password = page.get_by_label("Password", exact=True)
        password.fill(PROBE_PASSWORD)
        expect(page.get_by_role("button", name="Create Account")).to_be_visible()
        password.press("Enter")
        page.wait_for_url(lambda u: path_and_query(u) == "/c/chapterhouse?x=1")
        expect(notifications(page)).to_contain_text(f"Welcome, {name.split()[0]}! Your account is ready.")
    assert member_count(address) == 1


def test_wf_accounts_unsafe_next(app_url, browser):
    base = norm(app_url)
    for value in NEXT_PROBES:
        name, address = identity("redirect")
        visited: list[str] = []

        def watch(page: Page) -> None:
            page.on("framenavigated", lambda frame: visited.append(frame.url) if frame == page.main_frame else None)

        with live(browser, f"{base}/signin?next=" + quote(value, safe=""), on_page=watch) as page:
            page.get_by_role("textbox", name="Email").fill(address)
            page.get_by_role("button", name="Continue with Email").click()
            page.get_by_role("textbox", name="Name").fill(name)
            page.get_by_label("Password", exact=True).fill(PROBE_PASSWORD)
            page.get_by_role("button", name="Create Account").click()
            page.wait_for_url(lambda u: urlsplit(u).path == "/home")
            assert same_origin(page.url, base), (value, page.url)
        assert all(same_origin(u, base) for u in visited if u.startswith("http")), (value, visited)
        assert member_count(address) == 1


def test_wf_accounts_outage_signup(app_url, browser):
    database_url = os.environ["DATABASE_URL"]
    upstream = urlsplit(database_url)
    relay = Relay(upstream.hostname, upstream.port or 5432)
    copy = start_copy({"DATABASE_URL": relayed(database_url, relay.port)})
    name, address = identity("outagesignup")
    try:
        answer_from(copy, "/api/health", 200, COPY_BOOT_DEADLINE, "unavailable")
        with api(copy.url) as client:
            refused = client.post("/api/auth/signup", json={"name": name, "email": address, "password": PROBE_PASSWORD})
        assert refused.status_code == 503 and refused.json() == {"error": "service_unavailable"}
        assert refused.headers.get("Retry-After") == RETRY_AFTER
        assert member_count(address) == 0
        with live(browser, f"{copy.url}/signin") as page:
            expect(page.get_by_role("heading", level=1)).to_have_text(OUTAGE_HEADING)
            retry = page.get_by_role("link", name="Try Again")
            assert urlsplit(urljoin(page.url, retry.get_attribute("href"))).path == "/signin"
            relay.start()
            started = answer_from(copy, "/api/health", 200, BOOT_READY_SECONDS + RESPONSE_SLACK, "ok").json()["started_at"]
            retry.click()
            page.wait_for_url(lambda u: urlsplit(u).path == "/signin")
            page.get_by_role("textbox", name="Email").fill(address)
            page.get_by_role("button", name="Continue with Email").click()
            page.get_by_role("textbox", name="Name").fill(name)
            page.get_by_label("Password", exact=True).fill(PROBE_PASSWORD)
            page.get_by_role("button", name="Create Account").click()
            page.wait_for_url(lambda u: urlsplit(u).path == "/home")
            assert same_origin(page.url, copy.url)
            me = page.request.get(f"{copy.url}/api/me")
            assert me.status == 200 and me.json()["user"]["email"] == address
        assert member_count(address) == 1
        assert answer_from(copy, "/api/health", 200, RESPONSE_SLACK + 1, "ok").json()["started_at"] == started
    finally:
        relay.stop()
        copy.stop()


def test_member_pages(app_url):
    base = norm(app_url)
    host = signup(base, "pages")
    slug = make_event(host)["slug"]
    targets = ["/home?tab=past", "/create", f"/manage/{slug}"]
    with api(base) as client:
        for target in targets:
            response = client.get(target)
            assert response.is_redirect, (target, response.status_code)
            location = response.headers["Location"]
            assert same_origin(urljoin(base + "/", location), base)
            assert urlsplit(location).path == "/signin"
            assert next_of(location) == target
    for target in targets:
        response = host.http.get(target)
        assert response.status_code == 200, (target, response.status_code)


def test_my_events(app_url, browser):
    base = norm(app_url)
    host = signup(base, "mehost")
    me = signup(base, "mine")
    filler = signup(base, "filler")
    cancelled = make_event(host, days=40)["slug"]
    going = make_event(host, days=41)["slug"]
    pending = make_event(host, days=42, require_approval=True)["slug"]
    waiting = make_event(host, days=43, capacity=1, waitlist=True)["slug"]
    declined = make_event(host, days=44, require_approval=True)["slug"]
    hosting = make_event(me, days=45)["slug"]
    assert register(me, going).json()["status"] == "approved"
    assert register(me, pending).json()["status"] == "pending"
    assert register(filler, waiting).json()["status"] == "approved"
    assert register(me, waiting).json()["status"] == "waitlisted"
    assert register(me, declined).json()["status"] == "pending"
    assert decide(host, declined, guest_id(host, declined, me.email), "decline").status_code == 200
    assert register(me, cancelled).status_code == 201 and cancel(me, cancelled).status_code == 200
    soon = now_utc() + PAST_LEAD
    past_going = make_event(host, start=soon, length=timedelta(seconds=4))["slug"]
    past_hosting = make_event(me, start=soon + timedelta(seconds=2), length=timedelta(seconds=6))["slug"]
    past_cancelled = make_event(host, start=soon, length=timedelta(seconds=4))["slug"]
    assert register(me, past_going).json()["status"] == "approved"
    assert register(me, past_cancelled).status_code == 201 and cancel(me, past_cancelled).status_code == 200
    ours = {cancelled, going, pending, waiting, declined, hosting, past_going, past_hosting, past_cancelled}
    expected_upcoming = [(going, "going"), (pending, "pending"), (waiting, "waitlist"), (declined, "declined"), (hosting, "hosting")]
    upcoming = me.http.get("/api/me/events", params={"tab": "upcoming"})
    assert upcoming.status_code == 200
    assert [(e["slug"], e["pill"]) for e in upcoming.json() if e["slug"] in ours and e["slug"] not in (past_going, past_hosting)] == expected_upcoming
    default = me.http.get("/api/me/events").json()
    assert [e["slug"] for e in default if e["slug"] in ours] == [e["slug"] for e in upcoming.json() if e["slug"] in ours]
    assert me.http.get("/api/me/events", params={"tab": "later"}).status_code == 422
    wait_until(soon + timedelta(seconds=10))
    past = me.http.get("/api/me/events", params={"tab": "past"}).json()
    assert [(e["slug"], e["pill"]) for e in past if e["slug"] in ours] == [(past_hosting, "hosting"), (past_going, "going")]
    names = {e["slug"]: e["name"] for e in upcoming.json() + past}
    with live(browser, f"{base}/home", member=me) as page:
        expect(page.get_by_role("tab", name="Upcoming")).to_be_visible()
        expect(page.get_by_text(names[hosting]).first).to_be_visible()
        text = body_text(page)
        positions = [text.index(names[slug]) for slug, _ in expected_upcoming]
        assert positions == sorted(positions)
        for pill in ("Going", "Pending", "Waitlist", "Declined", "Hosting"):
            assert pill in text
        page.get_by_role("tab", name="Past").click()
        expect(page.get_by_text(names[past_going]).first).to_be_visible()
        text = body_text(page)
        assert text.index(names[past_hosting]) < text.index(names[past_going])


def test_visitor_boundary(app_url):
    base = norm(app_url)
    host = signup(base, "boundary")
    guest = signup(base, "boundaryguest")
    slug = make_event(host, require_approval=True)["slug"]
    assert register(guest, slug).json()["status"] == "pending"
    gid = guest_id(host, slug, guest.email)
    before = event_row(slug)
    created_name = f"Visitor Event {uuid.uuid4().hex[:8]}"
    start = now_utc() + timedelta(days=30)
    calls = [
        ("GET", "/api/me", None), ("GET", "/api/me/events", None),
        ("POST", "/api/events", {"name": created_name, "start_at": start.isoformat(), "end_at": (start + timedelta(hours=1)).isoformat(), "city": "Noida"}),
        ("PATCH", f"/api/events/{slug}", {"name": "Visitor Rename"}),
        ("POST", f"/api/events/{slug}/register", {}), ("DELETE", f"/api/events/{slug}/register", None),
        ("GET", f"/api/events/{slug}/guests", None), ("POST", f"/api/events/{slug}/guests/{gid}", {"action": "approve"}),
        ("PUT", "/api/calendars/maker-hub/follow", None), ("DELETE", "/api/calendars/maker-hub/follow", None),
        ("POST", f"/api/events/{slug}/contact", {"message": "Hello from nowhere"}),
        ("POST", f"/api/events/{slug}/report", {"reason": "spam"}),
    ]
    for token in (None, "junk-token-0000"):
        with api(base, token) as client:
            for method, path, body in calls:
                response = client.request(method, path, json=body) if body is not None else client.request(method, path)
                assert response.status_code == 401, (method, path, response.status_code)
                assert response.json() == {"error": "unauthenticated"}
    assert events_named(created_name) == 0
    assert event_row(slug) == before
    assert status_of(slug, guest.email) == "pending"
    rows = pg().rows(f"SELECT count(*) AS n FROM registrations r JOIN events e ON e.id = r.event_id WHERE e.slug = {lit(slug)}")
    assert int(rows[0]["n"]) == 1
    for table in ("host_messages", "event_reports"):
        rows = pg().rows(f"SELECT count(*) AS n FROM {table} t JOIN events e ON e.id = t.event_id WHERE e.slug = {lit(slug)}")
        assert int(rows[0]["n"]) == 0


def test_wf_authorization_host_only(app_url):
    base = norm(app_url)
    host = signup(base, "owner")
    guest = signup(base, "applicant")
    other = signup(base, "intruder")
    slug = make_event(host, require_approval=True)["slug"]
    assert register(guest, slug).json()["status"] == "pending"
    gid = guest_id(host, slug, guest.email)
    before = event_row(slug)
    responses = [
        other.http.get(f"/api/events/{slug}/guests"),
        other.http.patch(f"/api/events/{slug}", json={"name": "Taken Over"}),
        other.http.patch(f"/api/events/{slug}", json={"registration_status": "closed"}),
        decide(other, slug, gid, "approve"),
        decide(other, slug, gid, "decline"),
    ]
    for response in responses:
        assert response.status_code == 404, response.text
        assert response.json() == {"error": "not_found"}
    assert other.http.get(f"/manage/{slug}").status_code == 404
    assert event_row(slug) == before
    assert status_of(slug, guest.email) == "pending"
    viewed = event_as(other, slug)
    assert viewed["is_host"] is False and guest.email not in json.dumps(viewed)
    listing = host.http.get(f"/api/events/{slug}/guests")
    assert listing.status_code == 200
    assert [(g["name"], g["email"], g["status"]) for g in listing.json()] == [(guest.name, guest.email, "pending")]


def test_wf_authorization_address_privacy(app_url, browser):
    base = norm(app_url)
    host = signup(base, "privhost")
    approved = signup(base, "privin")
    pending = signup(base, "privwait")
    outsider = signup(base, "privout")
    offline = make_event(host, require_approval=True, city="Mumbai")
    slug, street = offline["slug"], offline["street_address"]
    link = f"https://probe.invalid/room-{uuid.uuid4().hex[:8]}"
    virtual = make_event(host, location_type="virtual", virtual_link=link, street_address=DROP, venue_name=DROP)["slug"]
    assert register(pending, slug).json()["status"] == "pending"
    assert register(approved, slug).json()["status"] == "pending"
    assert decide(host, slug, guest_id(host, slug, approved.email), "approve").json()["status"] == "approved"
    assert register(approved, virtual).json()["status"] == "approved"

    for viewer in (None, outsider, pending):
        client = viewer.http if viewer else api(base)
        data = client.get(f"/api/events/{slug}")
        assert "street_address" not in data.json() and street not in data.text
        vdata = client.get(f"/api/events/{virtual}")
        assert "virtual_link" not in vdata.json() and link not in vdata.text
        pages = page_client(viewer) if viewer else api(base)
        html = pages.get(f"/{slug}").text
        assert street not in html and street not in unquote(html)
        assert ADDRESS_HIDDEN in html and ADDRESS_HIDDEN_LINE in html and "Mumbai" in html
        assert link not in pages.get(f"/{virtual}").text
    for text in (pending.http.get("/home").text, pending.http.get("/api/me/events").text):
        assert street not in text

    for viewer in (host, approved):
        assert event_as(viewer, slug)["street_address"] == street
        assert event_as(viewer, virtual)["virtual_link"] == link
        with live(browser, f"{base}/{slug}", member=viewer, js=False) as page:
            maps = page.get_by_role("link", name="Open in maps").first
            href = maps.get_attribute("href")
            assert href.startswith("geo:") and street in unquote(href.replace("+", " "))
            any_visible(page.get_by_text(street))

    assert decide(host, slug, guest_id(host, slug, approved.email), "remove").json()["status"] == "declined"
    after = event_as(approved, slug)
    assert "street_address" not in after and after["viewer_status"] == "declined"
    html = page_client(approved).get(f"/{slug}").text
    assert street not in html and street not in unquote(html)


STRICT_CASES = {
    "array-body": ("signup", b"[]", 422, "body"),
    "string-body": ("signup", b'"text"', 422, "body"),
    "number-body": ("signup", b"5", 422, "body"),
    "null-body": ("signup", b"null", 422, "body"),
    "invalid-json": ("signup", b"{", 422, "body"),
    "signup-id": ("signup", {"id": 1}, 422, "id"),
    "register-status": ("register", {"status": "approved"}, 422, "status"),
    "create-slug": ("create", {"slug": "probeslg"}, 422, "slug"),
    "create-host-id": ("create", {"host_id": 1}, 422, "host_id"),
    "capacity-string": ("create", {"capacity": "5"}, 422, "capacity"),
    "capacity-float": ("create", {"capacity": 5.5}, 422, "capacity"),
    "capacity-boolean": ("create", {"capacity": True}, 422, "capacity"),
    "approval-string": ("create", {"require_approval": "false"}, 422, "require_approval"),
    "approval-zero": ("create", {"require_approval": 0}, 422, "require_approval"),
    "categories-string": ("create", {"categories": "books"}, 422, "categories"),
    "patch-going-count": ("patch", {"going_count": 0}, 422, "going_count"),
    "follow-extra": ("follow", {"extra": 1}, 422, "extra"),
    "contact-array": ("contact", b"[]", 422, "body"),
    "contact-oversize": ("contact", "oversize", 413, None),
}


@pytest.mark.parametrize("case", list(STRICT_CASES), ids=list(STRICT_CASES))
def test_wf_authorization_strict_bodies(app_url, case):
    base = norm(app_url)
    kind, payload, status, field = STRICT_CASES[case]
    host = signup(base, "stricthost")
    member = signup(base, "strict")
    slug = make_event(host)["slug"]
    before = event_row(slug)
    name, email = identity("strictsignup")
    start = now_utc() + timedelta(days=30)
    event_name = f"Strict {uuid.uuid4().hex[:8]}"
    if kind == "signup":
        valid = {"name": name, "email": email, "password": PROBE_PASSWORD}
        client, method, path = api(base), "POST", "/api/auth/signup"
    elif kind == "register":
        valid, client, method, path = {}, member.http, "POST", f"/api/events/{slug}/register"
    elif kind == "create":
        valid = {"name": event_name, "start_at": start.isoformat(), "end_at": (start + timedelta(hours=1)).isoformat(), "city": "Noida"}
        client, method, path = member.http, "POST", "/api/events"
    elif kind == "patch":
        valid, client, method, path = {}, host.http, "PATCH", f"/api/events/{slug}"
    elif kind == "follow":
        valid, client, method, path = {}, member.http, "PUT", "/api/calendars/maker-hub/follow"
    else:
        valid, client, method, path = {"message": "Hello"}, member.http, "POST", f"/api/events/{slug}/contact"
    if payload == "oversize":
        content = json.dumps({"message": "m" * BODY_LIMIT}).encode()
    elif isinstance(payload, bytes):
        content = payload
    else:
        content = json.dumps(dict(valid, **payload)).encode()
    response = client.request(method, path, content=content, headers={"Content-Type": "application/json"})
    assert response.status_code == status, response.text
    if payload == "oversize":
        assert response.json() == {"error": "payload_too_large"}
    elif field == "body":
        assert response.json() == {"errors": {"body": BODY_MESSAGE}}
    else:
        assert response.json()["errors"][field] == UNKNOWN_FIELD or kind == "create" and field != "slug" and field != "host_id"
        assert field in response.json()["errors"]
    assert member_count(email) == 0
    assert events_named(event_name) == 0
    assert event_row(slug) == before
    assert registration(slug, member.email) is None
    assert follow_rows(member.email) == 0
    assert sent_rows("host_messages", member.email, slug) == 0
    if case == "contact-oversize":
        exact = json.dumps({"message": "m" * (BODY_LIMIT - len('{"message": ""}'))}).encode()
        assert len(exact) == BODY_LIMIT
        at_limit = member.http.post(f"/api/events/{slug}/contact", content=exact, headers={"Content-Type": "application/json"})
        assert at_limit.status_code == 422 and "message" in at_limit.json()["errors"]


def test_wf_authorization_foreign_guest(app_url):
    base = norm(app_url)
    host = signup(base, "twohost")
    first = signup(base, "firstguest")
    second = signup(base, "secondguest")
    a = make_event(host, require_approval=True)["slug"]
    b = make_event(host, require_approval=True)["slug"]
    assert register(first, a).json()["status"] == "pending"
    assert register(second, b).json()["status"] == "pending"
    foreign = registration(b, second.email)
    own = registration(a, first.email)
    for action in ("approve", "decline", "remove"):
        response = decide(host, a, foreign["id"], action)
        assert response.status_code == 404 and response.json() == {"error": "not_found"}
    assert registration(b, second.email) == foreign
    assert event_as(host, a)["going_count"] == 0 and event_as(host, b)["going_count"] == 0
    for raw in ["0", "-1", "abc", "1e3", f"00{own['id']}", "99999999999999999999"]:
        response = decide(host, a, raw, "approve")
        assert response.status_code == 404, (raw, response.status_code)
        assert response.headers["content-type"].startswith("application/json")
        assert response.json() == {"error": "not_found"}
    assert registration(a, first.email) == own
    assert decide(host, a, own["id"], "approve").json()["status"] == "approved"
    assert status_of(a, first.email) == "approved"


def test_wf_discovery_filters(app_url, browser):
    base = norm(app_url)
    host = signup(base, "filterhost")
    hidden = make_event(host, city="Gurugram", categories=["games"])["slug"]
    now = datetime.now(timezone.utc)
    with api(base) as client:
        both = client.get("/api/discover", params={"place": "gurugram", "category": "games"}).json()["events"]
        books = client.get("/api/discover", params={"category": "books"}).json()["events"]
        everything = client.get("/api/discover").json()["events"]
        assert client.get("/api/discover", params={"place": "atlantis"}).status_code == 404
        assert client.get("/api/discover", params={"category": "opera"}).status_code == 404
    assert "gamenite" in [e["slug"] for e in both]
    assert all(e["city"] == "Gurugram" and "games" in e["categories"] for e in both)
    assert "zinefest" in [e["slug"] for e in books] and all("books" in e["categories"] for e in books)
    assert len({e["city"] for e in everything}) > 1
    for listing in (both, books, everything):
        slugs = {e["slug"] for e in listing}
        assert not slugs & {"launchpt", "fireworx", "poetwalk", hidden}
        assert all(instant(e["end_at"]) > now for e in listing)
        starts = [instant(e["start_at"]) for e in listing]
        assert starts == sorted(starts)
    with live(browser, f"{base}/discover") as page:
        mark_page(page)
        page.get_by_role("link", name=re.compile(r"^Gurugram")).first.click()
        page.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("place") == ["gurugram"])
        expect(page.get_by_role("link", name="Founders Board Game Night").first).to_be_visible()
        page.get_by_role("link", name=re.compile(r"^Games")).first.click()
        page.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("category") == ["games"])
        assert parse_qs(urlsplit(page.url).query)["place"] == ["gurugram"]
        expect(page.get_by_text(GAMES_IN_GURUGRAM).first).to_be_visible()
        assert still_same_document(page)
        page.go_back()
        page.wait_for_url(lambda u: "category" not in parse_qs(urlsplit(u).query))
        expect(page.get_by_text(GAMES_IN_GURUGRAM)).to_have_count(0)
        page.goto(f"{base}/discover?category=books")
        expect(page.get_by_role("link", name="Small Press Zine Fair").first).to_be_visible()
        expect(page.get_by_text("Monsoon Poetry Walk")).to_have_count(0)
        page.goto(f"{base}/discover?place=tokyo&category=crypto")
        expect(page.get_by_text("No upcoming events here yet")).to_be_visible()
        see_all = page.get_by_role("link", name="See all cities")
        target = urlsplit(urljoin(page.url, see_all.get_attribute("href")))
        assert target.path == "/discover" and not target.query


def test_wf_discovery_counts(app_url, browser):
    base = norm(app_url)

    def snapshot():
        with api(base) as client:
            data = client.get("/api/discover").json()
        events = data["events"]
        for place in data["places"]:
            assert place["event_count"] == sum(1 for e in events if e["city"] == place["name"]), place
        for category in data["categories"]:
            assert category["event_count"] == sum(1 for e in events if category["slug"] in e["categories"]), category
        return {p["slug"]: p["event_count"] for p in data["places"]}, {c["slug"]: c["event_count"] for c in data["categories"]}, data

    places_before, categories_before, _ = snapshot()
    host = signup(base, "counthost")
    make_event(host, visibility="public", city="Noida", categories=["climate", "wellness"])
    make_event(host, visibility="private", city="Noida", categories=["climate", "wellness"])
    places_after, categories_after, data = snapshot()
    assert places_after == dict(places_before, noida=places_before["noida"] + 1)
    assert categories_after == dict(categories_before, climate=categories_before["climate"] + 1, wellness=categories_before["wellness"] + 1)
    with live(browser, f"{base}/discover") as page:
        expect(page.get_by_role("heading", name="Discover Events")).to_be_visible()
        expect(page.get_by_text("Find something to do near you, browse by what you love, or follow a community calendar.")).to_be_visible()
        tops = [page.get_by_role("heading", name=re.compile(rf"^{title}")).first.bounding_box()["y"]
                for title in ("Coming Up", "Browse by Category", "Community Calendars", "Events by City")]
        assert tops == sorted(tops)
        expect(page.get_by_role("tab", name="South & East Asia")).to_be_visible()
        expect(page.get_by_role("button", name="View All")).to_be_visible()
        for entry, is_city in [(c, False) for c in data["categories"]] + [(p, True) for p in data["places"]]:
            count = entry["event_count"]
            if count != 1:
                labels = [f"{count} Events"]
            elif is_city:
                labels = ["1 Events", "1 Event"]
            else:
                labels = ["1 Event"]
            pattern = re.compile(r"(?<!\d)(" + "|".join(re.escape(l) for l in labels) + r")\b")
            links = page.get_by_role("link", name=re.compile(rf"^{re.escape(entry['name'])}\b"))
            poll(lambda: any(pattern.search(links.nth(i).evaluate(TILE_TEXT_JS)) for i in range(links.count()) if links.nth(i).is_visible()),
                 VISIBLE_DEADLINE, lambda: entry["name"])
        for name, _, _ in COMMUNITIES.values():
            expect(page.get_by_role("button", name=f"Follow {name}").first).to_be_visible()


def test_wf_discovery_no_address_copies(app_url):
    base = norm(app_url)
    addresses = [row[4] for row in SEED_EVENTS.values()]
    pending = signup(base, "copies")
    assert register(pending, "gamenite").json()["status"] == "pending"
    public_paths = ["/", "/discover", "/discover?place=gurugram", "/api/discover", "/api/calendars", "/api/categories"] + [f"/c/{slug}" for slug in COMMUNITIES]
    with api(base) as client:
        for path in public_paths:
            text = client.get(path).text
            for address in addresses:
                assert address not in text, (path, address)
            for private in ("Indie App Launch Party", "Riverside Fireworks Viewing"):
                assert private not in text, (path, private)
        for slug in SEED_EVENTS:
            for path in (f"/{slug}", f"/api/events/{slug}"):
                text = client.get(path).text
                assert all(address not in text for address in addresses), path
    for path in ("/gamenite", "/api/events/gamenite", "/home", "/api/me/events"):
        text = pending.http.get(path).text
        assert all(address not in text for address in addresses), path


OUTAGE_PAGES = ["/", "/discover", "/runclub7", "/c/chapterhouse", "/signin"]


def test_wf_discovery_outage(app_url, browser):
    base = norm(app_url)
    down = norm(os.environ["APP_POSTGRES_DOWN_URL"])
    with api(down) as client:
        for path in OUTAGE_PAGES:
            started = time.monotonic()
            response = client.get(path)
            assert time.monotonic() - started <= OUTAGE_ANSWER_SECONDS + RESPONSE_SLACK
            assert response.status_code == 503, (path, response.status_code)
            assert OUTAGE_HEADING in response.text
        for method, path, body in (("GET", "/api/discover", None), ("GET", "/api/events/runclub7", None),
                                   ("POST", "/api/auth/signin", {"email": GUEST_EMAIL, "password": SEED_PASSWORD})):
            response = client.request(method, path, json=body) if body else client.request(method, path)
            assert response.status_code == 503
            assert response.json() == {"error": "service_unavailable"}
            assert response.headers.get("Retry-After") == RETRY_AFTER
    assets: list[str] = []
    for path in OUTAGE_PAGES:
        with live(browser, down + path, js=False) as page:
            expect(page.get_by_role("heading", level=1)).to_have_text(OUTAGE_HEADING)
            expect(page.get_by_text(OUTAGE_LINE)).to_be_visible()
            retry = page.get_by_role("link", name="Try Again")
            assert urlsplit(urljoin(page.url, retry.get_attribute("href"))).path == path
            expect(page.get_by_role("link", name="Skip to Content")).to_have_count(1)
            expect(page.get_by_role("link", name="Sign In")).to_be_visible()
            assets += page.evaluate("() => [...Array.from(document.scripts, s => s.src), ...Array.from(document.styleSheets, s => s.href)].filter(Boolean)")
    for asset in assets:
        assert httpx.get(asset, timeout=HTTP_TIMEOUT).status_code == 200, asset
    filtered = "/discover?place=gurugram&category=games"
    with live(browser, down + filtered, js=False) as page:
        expect(page.get_by_role("heading", level=1)).to_have_text(OUTAGE_HEADING)
        retry = page.get_by_role("link", name="Try Again")
        assert urlsplit(urljoin(page.url, retry.get_attribute("href"))).path == "/discover"
        expect(page.get_by_text(GAMES_IN_GURUGRAM)).to_have_count(0)
    with live(browser, base + filtered) as page:
        expect(page.get_by_text(GAMES_IN_GURUGRAM).first).to_be_visible()
        expect(page.get_by_role("link", name="Founders Board Game Night").first).to_be_visible()


def assert_card(page: Page, name: str, heading: str | None, bodies: list[str], actions: list[str]) -> None:
    expect(page.get_by_role("heading", level=1)).to_have_count(1)
    expect(page.get_by_role("heading", level=1)).to_have_text(name)
    card = card_of(page)
    if heading:
        expect(card.get_by_role("heading", name=heading)).to_be_visible()
    for body in bodies:
        expect(card).to_contain_text(body)
    for action in CARD_ACTIONS:
        expect(card.get_by_role("button", name=action, exact=True)).to_have_count(1 if action in actions else 0)
    for section in ("About Event", "Location", "Hosted By"):
        expect(page.get_by_text(section, exact=True).first).to_be_attached()


def days_since(end: datetime) -> int:
    return math.floor((datetime.now(timezone.utc) - end).total_seconds() / 86400)


def test_wf_event_page_card_states(app_url, browser):
    base = norm(app_url)
    host = signup(base, "cardhost")
    viewer = signup(base, "cardviewer")
    filler = signup(base, "cardfiller")
    full_closed = make_event(host, capacity=1)
    assert register(filler, full_closed["slug"]).json()["status"] == "approved"
    pending = make_event(host, require_approval=True)
    assert register(viewer, pending["slug"]).json()["status"] == "pending"
    approved = make_event(host)
    assert register(viewer, approved["slug"]).json()["status"] == "approved"
    assert host.http.patch(f"/api/events/{approved['slug']}", json={"registration_status": "closed"}).status_code == 200
    declined = make_event(host, require_approval=True)
    assert register(viewer, declined["slug"]).status_code == 201
    assert decide(host, declined["slug"], guest_id(host, declined["slug"], viewer.email), "decline").status_code == 200
    waitlisted = make_event(host, capacity=1, waitlist=True)
    assert register(filler, waitlisted["slug"]).json()["status"] == "approved"
    assert register(viewer, waitlisted["slug"]).json()["status"] == "waitlisted"
    poet_end = instant(event_as(None, "poetwalk", base)["end_at"])
    streets = {e["slug"]: e["street_address"] for e in (full_closed, pending, approved, declined, waitlisted)}
    streets.update({slug: row[4] for slug, row in SEED_EVENTS.items()})
    closed_body = "The host has stopped taking registrations for this event. You can still contact the host."
    visitor_cases = [
        ("gamenite", "Founders Board Game Night", "Approval Required", ["The host reviews every request before confirming a place.", "Save your place below."], ["Request to Join"]),
        ("runclub7", "Sunrise 5K Run Club", None, ["Save your place below."], ["Register"]),
        ("potterya", "Pottery Wheel Workshop", "Event Full", ["This event is at capacity. You can join the waitlist."], ["Join Waitlist"]),
        ("closedbf", "Founders Breakfast Club", "Registration Closed", [closed_body], []),
        ("fireworx", "Riverside Fireworks Viewing", "Access Code Needed", ["This event is open only to guests with an access code. Enter yours below to register."], []),
        (full_closed["slug"], full_closed["name"], "Event Full", ["This event is at capacity."], []),
        (approved["slug"], approved["name"], "Registration Closed", [closed_body], []),
    ]
    with live(browser, f"{base}/runclub7", js=False) as page:
        for slug, name, heading, bodies, actions in visitor_cases:
            page.goto(f"{base}/{slug}")
            assert_card(page, name, heading, bodies, actions)
            html = page.content()
            assert streets[slug] not in html and streets[slug] not in page.title()
            if slug == "fireworx":
                expect(card_of(page).get_by_role("button", name="I have an access code")).to_be_visible()
        page.goto(f"{base}/poetwalk")
        expected_days = {days_since(poet_end)}
        card_text = card_of(page).inner_text()
        expected_days.add(days_since(poet_end))
        lines = {"This event ended today." if d == 0 else "This event ended 1 day ago." if d == 1 else f"This event ended {d} days ago." for d in expected_days}
        assert "Past Event" in card_text and any(line in card_text for line in lines), card_text
    member_cases = [
        (pending, "Pending Approval", ["We will let you know when the host approves your registration."], ["Cancel Request"]),
        (approved, "You're In", [], ["Cancel Registration"]),
        (declined, "Registration Declined", ["The host was not able to approve your registration."], []),
        (waitlisted, "On the Waitlist", ["You will move up if a place opens.", f"You are {ORDINALS[1]} in line."], ["Leave Waitlist"]),
    ]
    with live(browser, f"{base}/{pending['slug']}", member=viewer, js=False) as page:
        for event, heading, bodies, actions in member_cases:
            page.goto(f"{base}/{event['slug']}")
            assert_card(page, event["name"], heading, bodies, actions)
            if heading == "You're In":
                any_visible(page.get_by_text(streets[event["slug"]]))
            else:
                assert streets[event["slug"]] not in page.content()
    with live(browser, f"{base}/{pending['slug']}", member=host, js=False) as page:
        manage = page.get_by_role("link", name="Manage Event")
        assert urlsplit(urljoin(page.url, manage.get_attribute("href"))).path == f"/manage/{pending['slug']}"
        for action in CARD_ACTIONS:
            expect(page.get_by_role("button", name=action, exact=True)).to_have_count(0)
    removed = decide(host, approved["slug"], guest_id(host, approved["slug"], viewer.email), "remove")
    assert removed.status_code == 200 and removed.json()["status"] == "declined"
    with live(browser, f"{base}/{approved['slug']}", member=viewer, js=False) as page:
        assert_card(page, approved["name"], "Registration Declined", ["The host was not able to approve your registration."], [])
        html = page.content()
        assert streets[approved["slug"]] not in html


def test_wf_event_page_dates(app_url, browser):
    base = norm(app_url)
    host = signup(base, "dates")
    event = make_event(host, start=datetime(2037, 10, 21, 17, 0, tzinfo=ZoneInfo("Asia/Tokyo")),
                       length=timedelta(hours=3), timezone="Asia/Tokyo", city="Tokyo")
    assert instant(event["start_at"]) == datetime(2037, 10, 21, 8, 0, tzinfo=timezone.utc)
    assert event["start_at"].endswith(("Z", "+00:00"))
    with live(browser, f"{base}/{event['slug']}", tz="UTC") as page:
        expect(page.get_by_text("Wednesday, October 21").first).to_be_visible()
        expect(page.get_by_text("5:00 PM - 8:00 PM").first).to_be_visible()
        text = body_text(page)
        assert re.search(r"\bOct\.?\s+21\b", text, re.I), text


DAYS_RE = re.compile(r"([1-9]\d*) (days?) (\d{2}) (hrs?) (\d{2}) min")
HMS_RE = re.compile(r"([1-9]\d*) (hrs?) (\d{2}) min (\d{2}) sec")


def test_wf_event_page_countdown_meter(app_url, browser):
    base = norm(app_url)
    host = signup(base, "meterhost")
    first = signup(base, "metera")
    member = signup(base, "meterm")
    waiter = signup(base, "meterw")
    far_start = now_utc() + timedelta(days=3, hours=4)
    capped = make_event(host, start=far_start, capacity=5)["slug"]
    assert register(first, capped).json()["status"] == "approved"
    counts_consistent(event_as(None, capped, base))
    with live(browser, f"{base}/{capped}", js=False) as page:
        text = page.get_by_role("timer", name="Starts in").inner_text()
        match = DAYS_RE.search(text)
        assert match, text
        assert (match.group(1) == "1") == (match.group(2) == "day")
        minutes = int(match.group(1)) * 1440 + int(match.group(3)) * 60 + int(match.group(5))
        assert abs(minutes - (far_start - datetime.now(timezone.utc)).total_seconds() / 60) <= 2
        expect(page.get_by_role("meter", name=meter_line(1, 5))).to_have_count(1)
        any_visible(page.get_by_text(left_line(4)))
    near_start = now_utc() + timedelta(hours=5, minutes=30)
    near = make_event(host, start=near_start)["slug"]
    with open_app(browser, f"{base}/{near}") as page:
        page.clock.pause_at(datetime.now(timezone.utc))
        page.reload()
        timer = page.get_by_role("timer", name="Starts in")
        seconds = []
        for _ in range(3):
            match = HMS_RE.search(timer.inner_text())
            assert match, timer.inner_text()
            seconds.append(int(match.group(1)) * 3600 + int(match.group(3)) * 60 + int(match.group(4)))
            advance(page, 1000)
        assert seconds[1] - seconds[2] == 1
        fake_now = datetime.fromtimestamp(page.evaluate("() => Date.now()") / 1000, timezone.utc)
        references = [(near_start - moment).total_seconds() for moment in (datetime.now(timezone.utc), fake_now)]
        assert min(abs(seconds[1] - r) for r in references) <= COUNTDOWN_SLACK_SECONDS
    full_open = make_event(host, capacity=1, waitlist=True)["slug"]
    full_closed = make_event(host, capacity=1)["slug"]
    unlimited = make_event(host)["slug"]
    for slug in (full_open, full_closed):
        assert register(first, slug).json()["status"] == "approved"
    with live(browser, f"{base}/{full_open}", js=False) as page:
        expect(page.get_by_role("meter", name=meter_line(1, 1))).to_have_count(1)
        any_visible(page.get_by_text("Full · waitlist open"))
        assert register(waiter, full_open).json()["status"] == "waitlisted"
        page.reload()
        any_visible(page.get_by_text(f"Full · {len([waiter])} waiting"))
        page.goto(f"{base}/{full_closed}")
        poll(lambda: re.search(r"(?<!Event )\bFull\b(?!\s*·)", re.sub(r"\s+", " ", page.evaluate("() => document.body.textContent"))),
             VISIBLE_DEADLINE)
        page.goto(f"{base}/{unlimited}")
        expect(page.get_by_role("meter")).to_have_count(0)
    with live(browser, f"{base}/{capped}", member=member) as page:
        mark_page(page)
        card_of(page).get_by_role("button", name="Register", exact=True).click()
        expect(page.get_by_role("meter", name=meter_line(2, 5))).to_have_count(1)
        any_visible(page.get_by_text(left_line(3)))
        any_visible(page.get_by_text(re.compile(rf"(?<!\d){going_line(2)}\b")))
        assert still_same_document(page)
    counts_consistent(event_as(member, capped))


def test_wf_event_page_narrow_layout(app_url, browser):
    base = norm(app_url)
    for viewport in VIEWPORTS[:2]:
        with live(browser, f"{base}/runclub7", viewport=viewport) as page:
            boxes = [visible_boxes(page.get_by_role("img", name=f"{SEED_EVENTS['runclub7'][0]} cover"))[0],
                     visible_boxes(page.get_by_role("heading", level=1))[0],
                     visible_boxes(card_of(page))[0],
                     visible_boxes(page.get_by_text("About Event", exact=True))[0],
                     visible_boxes(page.get_by_text("Location", exact=True))[-1],
                     visible_boxes(page.get_by_text("Hosted By", exact=True))[0]]
            tops = [box["y"] for box in boxes]
            assert tops == sorted(tops), (viewport, tops)


GAMENITE_STREET = SEED_EVENTS["gamenite"][4]


def test_wf_join_request_signup(app_url, browser):
    base = norm(app_url)
    name, address = identity("joiner")
    with live(browser, f"{base}/discover") as page:
        page.get_by_role("link", name=re.compile(r"^Gurugram")).first.click()
        page.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("place") == ["gurugram"])
        page.get_by_role("link", name=re.compile(r"^Games")).first.click()
        page.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("category") == ["games"])
        page.get_by_role("link", name="Founders Board Game Night").first.click()
        page.wait_for_url(lambda u: urlsplit(u).path == f"/{GAMENITE}")
        any_visible(page.get_by_text(ADDRESS_HIDDEN))
        any_visible(page.get_by_text("Gurugram"))
        card_of(page).get_by_role("button", name="Request to Join").click()
        page.wait_for_url(lambda u: urlsplit(u).path == "/signin")
        assert next_of(page.url) == f"/{GAMENITE}"
        page.get_by_role("textbox", name="Email").fill(address)
        page.get_by_role("button", name="Continue with Email").click()
        page.get_by_role("textbox", name="Name").fill(name)
        page.get_by_label("Password", exact=True).fill(PROBE_PASSWORD)
        page.get_by_role("button", name="Create Account").click()
        page.wait_for_url(lambda u: urlsplit(u).path == f"/{GAMENITE}")
        expect(card_of(page).get_by_role("heading", name="Pending Approval")).to_be_visible()

        assert GAMENITE_STREET not in page.content() and GAMENITE_STREET not in page.title()
        assert GAMENITE_STREET not in notifications(page).inner_text()
        page.goto(f"{base}/home")
        expect(page.get_by_text("Founders Board Game Night").first).to_be_visible()
        expect(page.get_by_text("Pending", exact=True).first).to_be_visible()
        assert GAMENITE_STREET not in page.content()
        injected = page.request.post(base + event_path(GAMENITE, "/register"), data={"status": "approved"}, headers={"Origin": base})
        assert injected.status == 422 and injected.json()["errors"]["status"] == UNKNOWN_FIELD
    assert status_of("gamenite", address) == "pending"


def test_wf_join_request_offsite_next(app_url, browser):
    base = norm(app_url)
    name, address = identity("offsite")
    visited: list[str] = []

    def watch(page: Page) -> None:
        page.on("framenavigated", lambda frame: visited.append(frame.url) if frame == page.main_frame else None)

    with live(browser, f"{base}/{GAMENITE}", on_page=watch) as page:
        card_of(page).get_by_role("button", name="Request to Join").click()
        page.wait_for_url(lambda u: urlsplit(u).path == "/signin")
        assert next_of(page.url) == f"/{GAMENITE}"
        page.goto(f"{base}/signin?next=" + quote(NEXT_PROBES[0], safe=""))
        page.get_by_role("textbox", name="Email").fill(address)
        page.get_by_role("button", name="Continue with Email").click()
        page.get_by_role("textbox", name="Name").fill(name)
        page.get_by_label("Password", exact=True).fill(PROBE_PASSWORD)
        page.get_by_role("button", name="Create Account").click()
        page.wait_for_url(lambda u: urlsplit(u).path == "/home")
        assert same_origin(page.url, base), page.url
        assert GAMENITE_STREET not in page.content()
    assert all(same_origin(u, base) for u in visited if u.startswith("http")), visited
    assert member_count(address) == 1


def test_wf_approval_host_decisions(app_url, browser):
    base = norm(app_url)
    host = signup(base, "decider")
    g1, g2, g3, g4 = (signup(base, f"decided{i}") for i in range(4))
    slug = make_event(host, require_approval=True, capacity=2, waitlist=True)["slug"]
    for guest in (g1, g2, g3, g4):
        assert register(guest, slug).json()["status"] == "pending"
    ids = {g.email: guest_id(host, slug, g.email) for g in (g1, g2, g3, g4)}
    for guest in (g1, g2):
        assert decide(host, slug, ids[guest.email], "approve").json()["status"] == "approved"
    full = decide(host, slug, ids[g3.email], "approve")
    assert full.status_code == 409 and full.json() == {"error": "event_full"}
    assert status_of(slug, g3.email) == "pending"
    with live(browser, f"{base}/manage/{slug}", member=host) as page:
        page.get_by_role("button", name=f"Approve {g3.name}").click()
        expect(page.get_by_text("Event is at capacity").first).to_be_visible()
        assert status_of(slug, g3.email) == "pending"
        page.get_by_role("button", name=f"Decline {g3.name}").click()
        expect(notifications(page)).to_contain_text(f"Declined {g3.name}")
    assert status_of(slug, g3.email) == "declined"
    refused = [(g1, "approve"), (g1, "decline"), (g3, "remove"), (g3, "approve"), (g4, "remove")]
    assert cancel(g4, slug).json()["status"] == "cancelled"
    refused += [(g4, "approve"), (g4, "decline")]
    for guest, action in refused:
        response = decide(host, slug, ids[guest.email], action)
        assert response.status_code == 409 and response.json() == {"error": "invalid_transition"}, (action, response.text)
    assert decide(host, slug, ids[g2.email], "promote").status_code == 422
    removed = decide(host, slug, ids[g1.email], "remove")
    assert removed.json()["status"] == "declined" and removed.json()["event"]["going_count"] == 1
    assert {g.email: status_of(slug, g.email) for g in (g1, g2, g3, g4)} == {
        g1.email: "declined", g2.email: "approved", g3.email: "declined", g4.email: "cancelled"}


def test_wf_approval_loss_of_access(app_url, browser):
    base = norm(app_url)
    host = signup(base, "losshost")
    guest = signup(base, "lossguest")
    filler = signup(base, "lossfill")
    waiter = signup(base, "losswait")
    event = make_event(host)
    slug, street = event["slug"], event["street_address"]
    assert register(guest, slug).json()["status"] == "approved"
    assert event_as(guest, slug)["street_address"] == street
    assert decide(host, slug, guest_id(host, slug, guest.email), "remove").status_code == 200
    after = event_as(guest, slug)
    assert "street_address" not in after and after["viewer_status"] == "declined"
    with live(browser, f"{base}/{slug}", member=guest, js=False) as page:
        expect(card_of(page).get_by_role("heading", name="Registration Declined")).to_be_visible()
        assert street not in page.content()
    undo = cancel(guest, slug)
    assert undo.status_code == 409 and undo.json() == {"error": "registration_declined", "status": "declined"}
    again = register(guest, slug)
    assert again.status_code == 200 and again.json()["status"] == "declined"
    assert status_of(slug, guest.email) == "declined"
    queue = make_event(host, capacity=1, waitlist=True)["slug"]
    assert register(filler, queue).json()["status"] == "approved"
    assert register(waiter, queue).json()["status"] == "waitlisted"
    assert decide(host, queue, guest_id(host, queue, waiter.email), "decline").json()["status"] == "declined"
    assert register(waiter, queue).json()["status"] == "declined"
    assert event_as(waiter, queue)["viewer_status"] == "declined"
    visitor = api(base)
    for client, path in [(visitor, f"/{slug}"), (visitor, f"/api/events/{slug}"), (visitor, "/home"), (visitor, f"/manage/{slug}"),
                         (guest.http, f"/{slug}"), (guest.http, f"/api/events/{slug}"), (guest.http, "/home"),
                         (guest.http, "/api/me"), (guest.http, "/api/me/events"),
                         (host.http, f"/manage/{slug}"), (host.http, f"/api/events/{slug}/guests")]:
        assert_no_store(client.get(path))


def test_wf_approval_foreign_guest(app_url, browser):
    base = norm(app_url)
    host = signup(base, "manyhost")
    local = signup(base, "localguest")
    away = signup(base, "awayguest")
    here = make_event(host, require_approval=True, capacity=2)
    there = make_event(host)
    here_slug, there_slug = here["slug"], there["slug"]
    assert register(local, here_slug).json()["status"] == "pending"
    assert register(away, there_slug).json()["status"] == "approved"
    foreign = registration(there_slug, away.email)
    going_here, going_there = event_as(host, here_slug)["going_count"], event_as(host, there_slug)["going_count"]
    gpath = event_path(here_slug, f"/guests/{foreign['id']}")
    with live(browser, f"{base}/manage/{here_slug}", member=host) as page:
        approve = page.get_by_role("button", name=f"Approve {local.name}")
        expect(approve).to_be_visible()
        expect(page.get_by_role("button", name=f"Remove {away.name}")).to_have_count(0)
        for action in ("approve", "decline", "remove"):
            response = page.request.post(base + gpath, data={"action": action}, headers={"Origin": base})
            assert response.status == 404, (action, response.status)
            assert response.json() == {"error": "not_found"}
        assert registration(there_slug, away.email) == foreign
        assert event_as(host, here_slug)["going_count"] == going_here
        assert event_as(host, there_slug)["going_count"] == going_there
        assert event_as(away, there_slug)["street_address"] == there["street_address"]
        approve.click()
        expect(notifications(page)).to_contain_text(f"Approved {local.name}")
    assert status_of(here_slug, local.email) == "approved"
    assert status_of(there_slug, away.email) == "approved"


def test_wf_approval_outage(app_url, browser):
    base = norm(app_url)
    database_url = os.environ["DATABASE_URL"]
    upstream = urlsplit(database_url)
    relay = Relay(upstream.hostname, upstream.port or 5432)
    relay.start()
    copy = start_copy({"DATABASE_URL": relayed(database_url, relay.port)})
    try:
        started = answer_from(copy, "/api/health", 200, COPY_BOOT_DEADLINE, "ok").json()["started_at"]
        host = signup(base, "brokenhost")
        guest = signup(base, "brokenguest")
        slug = make_event(host, require_approval=True)["slug"]
        assert register(guest, slug).json()["status"] == "pending"
        gid = guest_id(host, slug, guest.email)
        with live(browser, f"{copy.url}/manage/{slug}", member=host) as page:
            approve = page.get_by_role("button", name=f"Approve {guest.name}")
            expect(approve).to_be_visible()
            relay.stop()
            answer_from(copy, "/api/me", 503, OUTAGE_ONSET_SECONDS + RESPONSE_SLACK)
            approve.click()
            alert = page.get_by_role("alert").filter(has_text=OUTAGE_ALERT)
            expect(alert).to_be_visible(timeout=(OUTAGE_ANSWER_SECONDS + RESPONSE_SLACK) * 1000)
            expect(approve).to_be_enabled()
            with api(copy.url, host.token) as client:
                refused = client.post(event_path(slug, f"/guests/{gid}"), json={"action": "approve"})
            assert refused.status_code == 503 and refused.json() == {"error": "service_unavailable"}
            assert refused.headers.get("Retry-After") == RETRY_AFTER
            assert status_of(slug, guest.email) == "pending"
            relay.start()
            healthy = answer_from(copy, "/api/health", 200, RECOVERY_SECONDS + RESPONSE_SLACK, "ok")
            assert healthy.json()["started_at"] == started
            press_until(approve, lambda: status_of(slug, guest.email) == "approved", RECOVERY_SECONDS + RESPONSE_SLACK)
            expect(notifications(page)).to_contain_text(f"Approved {guest.name}")
        assert status_of(slug, guest.email) == "approved"
    finally:
        relay.stop()
        copy.stop()


def test_wf_capacity_concurrent_register(app_url):
    base = norm(app_url)
    host = signup(base, "racehost")
    early = signup(base, "raceearly")
    slug = make_event(host, capacity=4, waitlist=True)["slug"]
    assert register(early, slug).json()["status"] == "approved"
    racers = [signup(base, f"racer{i}") for i in range(CONCURRENCY)]
    responses = together([lambda m=m: api(base, m.token).post(f"/api/events/{slug}/register", json={}) for m in racers])
    assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
    approved = [r.json()["event"] for r in responses if r.json()["status"] == "approved"]
    waiting = [r.json()["event"] for r in responses if r.json()["status"] == "waitlisted"]
    assert sorted(e["places_left"] for e in approved) == [0, 1, 2]
    assert sorted(e["going_count"] for e in approved) == [2, 3, 4]
    k = CONCURRENCY - 3
    assert sorted(e["waitlist_count"] for e in waiting) == list(range(1, k + 1))
    assert sorted(e["viewer_waitlist_position"] for e in waiting) == list(range(1, k + 1))
    for r in responses:
        counts_consistent(r.json()["event"])
    assert approved_count(slug) == 4


def test_wf_capacity_concurrent_approve(app_url):
    base = norm(app_url)
    host = signup(base, "approvehost")
    slug = make_event(host, require_approval=True, capacity=2)["slug"]
    guests = [signup(base, f"asker{i}") for i in range(5)]
    for guest in guests:
        assert register(guest, slug).json()["status"] == "pending"
    ids = [guest_id(host, slug, g.email) for g in guests]
    responses = together([lambda gid=gid: api(base, host.token).post(f"/api/events/{slug}/guests/{gid}", json={"action": "approve"}) for gid in ids])
    wins = [r for r in responses if r.status_code == 200]
    losses = [r for r in responses if r.status_code == 409]
    assert len(wins) == 2 and len(losses) == 3
    assert all(r.json() == {"error": "event_full"} for r in losses)
    assert sorted(r.json()["event"]["going_count"] for r in wins) == [1, 2]
    assert approved_count(slug) == 2
    assert sorted(status_of(slug, g.email) for g in guests) == ["approved"] * 2 + ["pending"] * 3
    racers = [signup(base, f"lastplace{i}") for i in range(CONCURRENCY)]
    shut = make_event(host, capacity=2)["slug"]
    responses = together([lambda m=m: api(base, m.token).post(f"/api/events/{shut}/register", json={}) for m in racers])
    assert sorted(r.status_code for r in responses) == [201, 201] + [409] * (CONCURRENCY - 2)
    assert all(r.json() == {"error": "event_full"} for r in responses if r.status_code == 409)
    assert approved_count(shut) == 2
    assert sum(1 for m in racers if registration(shut, m.email) is not None) == 2


def test_wf_capacity_replay(app_url):
    base = norm(app_url)
    host = signup(base, "replayhost")
    member = signup(base, "replayer")
    slug = make_event(host)["slug"]
    first = register(member, slug)
    assert first.status_code == 201 and first.json()["status"] == "approved"
    row = registration(slug, member.email)
    repeat = register(member, slug)
    assert repeat.status_code == 200 and repeat.json()["status"] == "approved" and repeat.json()["promoted"] == []
    assert registration(slug, member.email)["id"] == row["id"]
    assert cancel(member, slug).json()["status"] == "cancelled"
    replay = cancel(member, slug)
    assert replay.status_code == 200 and replay.json()["status"] == "cancelled" and replay.json()["promoted"] == []
    renewed = register(member, slug)
    assert renewed.status_code == 201 and renewed.json()["status"] == "approved"
    assert registration(slug, member.email)["id"] == row["id"]
    racer = signup(base, "doubler")
    responses = together([lambda: api(base, racer.token).post(f"/api/events/{slug}/register", json={}) for _ in range(5)])
    assert sorted(r.status_code for r in responses) == [200, 200, 200, 200, 201]
    assert status_of(slug, racer.email) == "approved"


def test_wf_capacity_count_injection(app_url):
    base = norm(app_url)
    host = signup(base, "counthost")
    guest = signup(base, "countguest")
    slug = make_event(host, capacity=3)["slug"]
    assert register(guest, slug).json()["status"] == "approved"
    before = event_row(slug)
    patched = host.http.patch(f"/api/events/{slug}", json={"going_count": 0, "capacity": 3})
    assert patched.status_code == 422 and patched.json()["errors"]["going_count"] == UNKNOWN_FIELD
    assert event_row(slug) == before
    start = now_utc() + timedelta(days=30)
    name = f"Injected {uuid.uuid4().hex[:8]}"
    created = host.http.post("/api/events", json={"name": name, "start_at": start.isoformat(), "end_at": (start + timedelta(hours=1)).isoformat(),
                                                  "city": "Noida", "going_count": 5, "slug": "abcdefgh"})
    assert created.status_code == 422
    assert created.json()["errors"]["going_count"] == UNKNOWN_FIELD and created.json()["errors"]["slug"] == UNKNOWN_FIELD
    assert events_named(name) == 0
    event = event_as(host, slug)
    assert (event["going_count"], event["places_left"]) == (1, 2) and approved_count(slug) == 1


def test_wf_registration_outcomes(app_url, browser):
    base = norm(app_url)
    host = signup(base, "outcomehost")
    a, b, c, d, e = (signup(base, f"outcome{i}") for i in range(5))
    open_slug = make_event(host)["slug"]
    approval = make_event(host, require_approval=True)["slug"]
    full_wl = make_event(host, capacity=1, waitlist=True)["slug"]
    full = make_event(host, capacity=1)["slug"]
    assert register(a, open_slug).json()["status"] == "approved"
    assert register(b, approval).json()["status"] == "pending"
    assert register(a, full_wl).json()["status"] == "approved"
    assert register(c, full_wl).json()["status"] == "waitlisted"
    assert register(a, full).json()["status"] == "approved"
    refused = register(c, full)
    assert refused.status_code == 409 and refused.json() == {"error": "event_full"}
    assert registration(full, c.email) is None
    queue = make_event(host, require_approval=True, capacity=2, waitlist=True)["slug"]
    for guest in (a, b):
        register(guest, queue)
        assert decide(host, queue, guest_id(host, queue, guest.email), "approve").status_code == 200
    assert register(c, queue).json()["status"] == "waitlisted"
    assert cancel(a, queue).json()["promoted"] == []
    assert host.http.patch(f"/api/events/{queue}", json={"require_approval": False}).status_code == 200
    assert register(d, queue).json()["status"] == "waitlisted"
    assert status_of(queue, d.email) == "waitlisted" and status_of(queue, c.email) == "waitlisted"
    assert register(e, approval).json()["status"] == "pending"
    assert decide(host, approval, guest_id(host, approval, e.email), "decline").json()["status"] == "declined"
    seen = event_as(e, approval)
    assert seen["viewer_status"] == "declined" and "street_address" not in seen
    again = register(e, approval)
    assert again.status_code == 200 and again.json()["status"] == "declined"
    assert status_of(approval, e.email) == "declined"
    for member, slug, heading in ((a, open_slug, "You're In"), (b, approval, "Pending Approval"), (c, full_wl, "On the Waitlist"), (e, approval, "Registration Declined")):
        with live(browser, f"{base}/{slug}", member=member, js=False) as page:
            expect(card_of(page).get_by_role("heading", name=heading)).to_be_visible()


def test_wf_registration_live_card(app_url, browser):
    base = norm(app_url)
    member = signup(base, "runner")
    with live(browser, f"{base}/runclub7", member=member) as page:
        going = page.get_by_text(re.compile(r"\b\d+ Going\b"))
        n = int(re.search(r"(\d+) Going", visible_texts(going)[0]).group(1))
        mark_page(page)
        card = card_of(page)
        status = card.get_by_role("status", name="Registration status")
        assert status.evaluate("(s) => (s.getAttribute('aria-live') || 'polite') === 'polite'")
        card.get_by_role("button", name="Register", exact=True).click()
        expect(status).to_contain_text("You're In")
        any_visible(page.get_by_text(re.compile(rf"(?<!\d){n + 1} Going\b")))
        expect(page.get_by_role("meter", name=f"{n + 1} of {SEED_CAPACITY_RUNCLUB} places taken")).to_have_count(1)
        expect(notifications(page)).to_contain_text("Registered. See you there!")
        assert card.evaluate("(c) => c.contains(document.activeElement)")
        assert status_of("runclub7", member.email) == "approved"
        card.get_by_role("button", name="Cancel Registration").click()
        expect(status).to_contain_text("Save your place below.")
        any_visible(page.get_by_text(re.compile(rf"(?<!\d){n} Going\b")))
        expect(page.get_by_role("meter", name=f"{n} of {SEED_CAPACITY_RUNCLUB} places taken")).to_have_count(1)
        expect(notifications(page)).to_contain_text("Registration cancelled")
        assert card.evaluate("(c) => c.contains(document.activeElement)")
        assert still_same_document(page)
    assert status_of("runclub7", member.email) == "cancelled"


def test_wf_registration_double_press(app_url, browser):
    base = norm(app_url)
    host = signup(base, "presshost")
    member = signup(base, "presser")
    slug = make_event(host)["slug"]
    sent: list[str] = []

    def watch(page: Page) -> None:
        page.on("request", lambda r: sent.append(r.url) if r.method == "POST" and urlsplit(r.url).path == f"/api/events/{slug}/register" else None)

    with live(browser, f"{base}/{slug}", member=member, on_page=watch) as page:
        card = card_of(page)
        button = card.get_by_role("button", name="Register", exact=True)
        with held(page, f"**/api/events/{slug}/register") as hold:
            button.click()
            expect(button).to_be_disabled()
            assert card.evaluate(BUSY_JS)
            button.click(force=True, no_wait_after=True)
            hold.release()
        expect(card.get_by_role("heading", name="You're In")).to_be_visible()
    assert len(sent) == 1
    assert status_of(slug, member.email) == "approved"


def test_wf_waitlist_promotion(app_url):
    base = norm(app_url)
    host = signup(base, "promohost")
    a, b = signup(base, "promoa"), signup(base, "promob")
    waiters = [signup(base, f"promow{i}") for i in range(4)]
    slug = make_event(host, capacity=2, waitlist=True)["slug"]
    for guest in (a, b):
        assert register(guest, slug).json()["status"] == "approved"
    for i, w in enumerate(waiters, 1):
        assert register(w, slug).json()["event"]["viewer_waitlist_position"] == i
    left = cancel(a, slug).json()
    assert left["status"] == "cancelled"
    assert [(str(p["id"]), p["name"]) for p in left["promoted"]] == [(str(registration(slug, waiters[0].email)["id"]), waiters[0].name)]
    assert status_of(slug, waiters[0].email) == "approved" and status_of(slug, waiters[1].email) == "waitlisted"
    removed = decide(host, slug, guest_id(host, slug, b.email), "remove").json()
    assert removed["status"] == "declined" and [p["name"] for p in removed["promoted"]] == [waiters[1].name]
    raised = host.http.patch(f"/api/events/{slug}", json={"capacity": 3}).json()
    assert status_of(slug, waiters[2].email) == "approved" and status_of(slug, waiters[3].email) == "waitlisted"
    assert (raised["going_count"], raised["waitlist_count"]) == (3, 1)
    unlimited = host.http.patch(f"/api/events/{slug}", json={"capacity": None}).json()
    assert status_of(slug, waiters[3].email) == "approved"
    assert unlimited["places_left"] is None and unlimited["waitlist_count"] == 0
    held_slug = make_event(host, require_approval=True, capacity=1, waitlist=True)["slug"]
    register(a, held_slug)
    assert decide(host, held_slug, guest_id(host, held_slug, a.email), "approve").status_code == 200
    assert register(b, held_slug).json()["status"] == "waitlisted"
    assert cancel(a, held_slug).json()["promoted"] == []
    assert status_of(held_slug, b.email) == "waitlisted"
    assert decide(host, held_slug, guest_id(host, held_slug, b.email), "decline").json()["status"] == "declined"
    after = event_as(b, held_slug)
    assert after["viewer_status"] == "declined" and "street_address" not in after
    assert cancel(b, held_slug).status_code == 409
    assert status_of(held_slug, b.email) == "declined"


def test_wf_waitlist_move_up(app_url, browser):
    base = norm(app_url)
    host = signup(base, "moveuphost")
    holder = signup(base, "holder")
    newcomer = signup(base, "newcomer")
    event = make_event(host, capacity=1, waitlist=True)
    slug = event["slug"]
    assert register(holder, slug).json()["status"] == "approved"
    with live(browser, f"{base}/{slug}", member=newcomer) as page:
        card_of(page).get_by_role("button", name="Join Waitlist").click()
        expect(card_of(page)).to_contain_text(f"You are {ORDINALS[1]} in line.")
        expect(notifications(page)).to_contain_text("Added to the waitlist")
    with live(browser, f"{base}/{slug}", member=holder) as page:
        card_of(page).get_by_role("button", name="Cancel Registration").click()
        expect(notifications(page)).to_contain_text(f"{CANCEL_TOAST} · {newcomer.name} moved up from the waitlist")
    assert status_of(slug, newcomer.email) == "approved"
    with open_app(browser, f"{base}/{slug}") as page:
        baseline = celebrations(page)
        sign_in_page(page, newcomer, base)
        page.goto(f"{base}/{slug}")
        until(page, f"() => ({CELEBRATION_JS})() > {baseline}")
        expect(card_of(page).get_by_role("heading", name="You're In")).to_be_visible()
        expect(card_of(page)).to_contain_text("A place opened up, so you moved up from the waitlist.")
        any_visible(page.get_by_text(event["street_address"]))
        page.reload()
        advance(page, CELEBRATION_MAX_MS)
        assert celebrations(page) == baseline


def test_wf_waitlist_concurrent_cancel(app_url):
    base = norm(app_url)
    host = signup(base, "fairhost")
    holders = [signup(base, f"fairhold{i}") for i in range(4)]
    waiters = [signup(base, f"fairwait{i}") for i in range(4)]
    newcomers = [signup(base, f"fairnew{i}") for i in range(3)]
    slug = make_event(host, capacity=4, waitlist=True)["slug"]
    for m in holders:
        assert register(m, slug).json()["status"] == "approved"
    for m in waiters:
        assert register(m, slug).json()["status"] == "waitlisted"
    calls = [lambda m=m: api(base, m.token).delete(f"/api/events/{slug}/register") for m in holders[:3]]
    calls += [lambda m=m: api(base, m.token).post(f"/api/events/{slug}/register", json={}) for m in newcomers]
    responses = together(calls)
    promoted = [p["name"] for r in responses[:3] for p in r.json()["promoted"]]
    assert sorted(promoted) == sorted(w.name for w in waiters[:3])
    assert all(r.json()["status"] == "waitlisted" for r in responses[3:])
    final = {m.email: status_of(slug, m.email) for m in holders + waiters + newcomers}
    approved = {e for e, s in final.items() if s == "approved"}
    assert approved == {holders[3].email} | {w.email for w in waiters[:3]}
    assert final[waiters[3].email] == "waitlisted"
    assert approved_count(slug) == 4


def test_wf_waitlist_capacity_edits(app_url):
    base = norm(app_url)
    host = signup(base, "edithost")
    a, b, c, d = (signup(base, f"edit{i}") for i in range(4))
    w1, w2 = signup(base, "editw1"), signup(base, "editw2")
    slug = make_event(host, capacity=3, waitlist=True)["slug"]
    for m in (a, b):
        assert register(m, slug).json()["status"] == "approved"
    floor = host.http.patch(f"/api/events/{slug}", json={"capacity": 1})
    assert floor.status_code == 422
    assert floor.json()["errors"]["capacity"] == f"Capacity cannot be lower than the {len((a, b))} guests already going"
    for value in (0, CAPACITY_MAX + 1):
        refused = host.http.patch(f"/api/events/{slug}", json={"capacity": value})
        assert refused.status_code == 422 and refused.json()["errors"]["capacity"] == RANGE_MESSAGE
    typed = host.http.patch(f"/api/events/{slug}", json={"capacity": "5"})
    assert typed.status_code == 422 and "capacity" in typed.json()["errors"]
    assert event_as(host, slug)["capacity"] == 3 and approved_count(slug) == 2
    new_name = f"Renamed {uuid.uuid4().hex[:8]}"
    responses = together([lambda: api(base, host.token).patch(f"/api/events/{slug}", json={"name": new_name}),
                          lambda: api(base, host.token).patch(f"/api/events/{slug}", json={"capacity": 4})])
    assert all(r.status_code == 200 for r in responses)
    stored = event_as(host, slug)
    assert stored["name"] == new_name and stored["capacity"] == 4
    for m in (c, d):
        assert register(m, slug).json()["status"] == "approved"
    for m in (w1, w2):
        assert register(m, slug).json()["status"] == "waitlisted"
    assert cancel(w1, slug).json()["status"] == "cancelled"
    rejoined = register(w1, slug).json()
    assert rejoined["status"] == "waitlisted" and rejoined["event"]["viewer_waitlist_position"] == 2
    assert event_as(w2, slug)["viewer_waitlist_position"] == 1
    assert host.http.patch(f"/api/events/{slug}", json={"capacity": 5}).status_code == 200
    assert status_of(slug, w2.email) == "approved" and status_of(slug, w1.email) == "waitlisted"
    counts_consistent(event_as(host, slug))


def test_queue_positions(app_url, browser):
    base = norm(app_url)
    host = signup(base, "queuehost")
    filler = signup(base, "queuefill")
    slug = make_event(host, capacity=1, waitlist=True)["slug"]
    assert register(filler, slug).json()["status"] == "approved"
    waiters = []
    for i in range(1, QUEUE_DEPTH + 1):
        w = signup(base, f"queue{i}")
        response = register(w, slug).json()
        assert response["status"] == "waitlisted" and response["event"]["viewer_waitlist_position"] == i
        waiters.append(w)
    listing = host.http.get(f"/api/events/{slug}/guests", params={"status": "waitlisted"}).json()
    assert {g["email"]: g["waitlist_position"] for g in listing} == {w.email: i for i, w in enumerate(waiters, 1)}
    for position, word in ORDINALS.items():
        assert event_as(waiters[position - 1], slug)["viewer_waitlist_position"] == position
        with live(browser, f"{base}/{slug}", member=waiters[position - 1], js=False) as page:
            expect(card_of(page)).to_contain_text(f"You are {word} in line.")
    with live(browser, f"{base}/manage/{slug}", member=host) as page:
        status_box = page.get_by_role("combobox", name="Status")
        expect(status_box).to_be_visible()
        choose(page, status_box, "All")
        for word in ORDINALS.values():
            any_visible(page.get_by_text(f"{word} in line"))


def test_wf_registration_rules_refusals(app_url):
    base = norm(app_url)
    member = signup(base, "refused")
    host = signup(base, "selfhost")
    for slug, body, code in (("closedbf", {}, "registration_closed"), ("poetwalk", {}, "event_ended"),
                             ("fireworx", {}, "access_code_required"), ("fireworx", {"access_code": "glow-2026"}, "invalid_access_code")):
        response = register(member, slug, **body)
        assert response.status_code == 403 and response.json() == {"error": code}, (slug, response.text)
        assert registration(slug, member.email) is None
    injected = register(member, "fireworx", access_code=ACCESS_CODE, status="approved")
    assert injected.status_code == 422 and injected.json()["errors"]["status"] == UNKNOWN_FIELD
    assert registration("fireworx", member.email) is None
    own = make_event(host)["slug"]
    response = register(host, own)
    assert response.status_code == 409 and response.json() == {"error": "host_cannot_register"}
    assert registration(own, host.email) is None
    trimmed = signup(base, "trimmed")
    response = register(trimmed, "fireworx", access_code=f"  {ACCESS_CODE}  ")
    assert response.status_code == 201 and response.json()["status"] == "approved"


def test_wf_registration_rules_access_code_ui(app_url, browser):
    base = norm(app_url)
    member = signup(base, "codeui")
    with live(browser, f"{base}/", member=member) as page:
        page.get_by_role("link", name="firework shows").click()
        page.wait_for_url(lambda u: urlsplit(u).path == "/fireworx")
        card = card_of(page)
        expect(card.get_by_role("heading", name="Access Code Needed")).to_be_visible()
        card.get_by_role("button", name="I have an access code").click()
        field = card.get_by_role("textbox", name="Access code")
        expect(field).to_be_focused()
        field.fill("WRONG-0000")
        field.press("Enter")
        expect(card.get_by_text("That code is not valid")).to_be_visible()
        assert field.evaluate(INVALID_JS)
        described = field.evaluate("(f) => ['aria-describedby', 'aria-errormessage'].flatMap(a => (f.getAttribute(a) || '').split(' ')).filter(Boolean).map(i => document.getElementById(i)?.innerText || '').join(' ')")
        assert "That code is not valid" in described
        field.fill(ACCESS_CODE)
        card.get_by_role("button", name="Submit Code").click()
        expect(card.get_by_role("heading", name="You're In")).to_be_visible()
        any_visible(page.get_by_text(SEED_EVENTS["fireworx"][4]))
    assert status_of("fireworx", member.email) == "approved"


def test_wf_registration_rules_lockout(app_url):
    base = norm(app_url)
    env = {"MELA_ACCESS_CODE_WINDOW_SECONDS": str(SHORT_WINDOW)}
    copies = [start_copy(env), start_copy(env)]
    try:
        for copy in copies:
            answer_from(copy, "/api/health", 200, COPY_BOOT_DEADLINE, "ok")
        member = signup(base, "guesser")
        neighbour = signup(base, "neighbour")
        patient = signup(base, "patient")
        path = event_path("fireworx", "/register")
        calls = [lambda i=i: api(copies[i % 2].url, member.token).post(path, json={"access_code": f"WRONG-{i}"})
                 for i in range(LOCKOUT_BURST)]
        responses = together(calls)
        forbidden = [r for r in responses if r.status_code == 403]
        locked = [r for r in responses if r.status_code == 429]
        assert len(forbidden) == LOCKOUT_LIMIT and len(locked) == LOCKED_COUNT, [r.status_code for r in responses]
        assert all(r.json() == {"error": "invalid_access_code"} for r in forbidden)
        for r in locked:
            body = r.json()
            assert body["error"] == "too_many_attempts" and isinstance(body["retry_after"], int)
            assert 1 <= body["retry_after"] <= SHORT_WINDOW
            assert r.headers.get("Retry-After") == str(body["retry_after"])
        with api(copies[0].url, member.token) as client:
            assert client.post(path, json={"access_code": ACCESS_CODE}).status_code == 429
        assert registration("fireworx", member.email) is None
        with api(copies[1].url, neighbour.token) as client:
            assert client.post(path, json={"access_code": ACCESS_CODE}).status_code == 201
        for _ in range(LOCKOUT_LIMIT + 1):
            assert register(patient, "fireworx").json() == {"error": "access_code_required"}
        assert register(patient, "fireworx", access_code=ACCESS_CODE).status_code == 201

        def unlocked():
            with api(copies[0].url, member.token) as client:
                return client.post(path, json={"access_code": ACCESS_CODE}).status_code == 201

        poll(unlocked, SHORT_WINDOW + RESPONSE_SLACK * 5)
        assert status_of("fireworx", member.email) == "approved"
    finally:
        for copy in copies:
            copy.stop()


def test_wf_registration_rules_lockout_ui(app_url, browser):
    base = norm(app_url)
    member = signup(base, "lockedui")
    for i in range(LOCKOUT_LIMIT):
        assert register(member, "fireworx", access_code=f"WRONG-{i}").status_code == 403
    with live(browser, f"{base}/fireworx", member=member) as page:
        card = card_of(page)
        card.get_by_role("button", name="I have an access code").click()
        card.get_by_role("textbox", name="Access code").fill(ACCESS_CODE)
        card.get_by_role("button", name="Submit Code").click()
        expect(card.get_by_text(f"Too many attempts. Try again in {math.ceil(LOCKOUT_WINDOW / 60)} minutes.")).to_be_visible()
        expect(card.get_by_role("heading", name="Access Code Needed")).to_be_visible()
    assert registration("fireworx", member.email) is None


def test_wf_event_authoring_create_api(app_url, browser):
    base = norm(app_url)
    host = signup(base, "creator")
    hostile = f"<script>alert('{uuid.uuid4().hex[:6]}')</script> Night"
    start = datetime(2037, 11, 2, 18, 0, tzinfo=ZoneInfo("Asia/Kolkata"))
    body = {"name": hostile, "start_at": start.isoformat(), "end_at": (start + timedelta(hours=2)).isoformat(), "city": "Noida"}
    created = host.http.post("/api/events", json=body)
    assert created.status_code == 201, created.text
    event = created.json()
    assert len(event["slug"]) == 8
    defaults = {"description": "", "timezone": "Asia/Kolkata", "location_type": "offline", "visibility": "public",
                "require_approval": False, "capacity": None, "waitlist": False, "theme": "amber", "categories": [],
                "calendar": None, "show_guest_list": True, "registration_status": "open", "going_count": 0,
                "places_left": None, "waitlist_count": 0, "viewer_status": None, "is_host": True}
    for key, value in defaults.items():
        assert event[key] == value, key
    assert event["host"]["name"] == host.name
    assert instant(event["start_at"]) == start and event["start_at"].endswith(("Z", "+00:00"))
    rows = pg().rows(f"SELECT extract(epoch FROM start_at)::float AS s FROM events WHERE slug = {lit(event['slug'])}")
    assert rows[0]["s"] == start.timestamp()
    second = host.http.post("/api/events", json=body).json()
    assert second["slug"] != event["slug"]
    html = api(base).get(f"/{event['slug']}").text
    assert hostile not in html
    with live(browser, f"{base}/{event['slug']}") as page:
        expect(page.get_by_role("heading", level=1)).to_have_text(hostile)


VALIDATION_IDS = [
    "blank-name",
    "long-name",
    "end-before-start",
    "start-in-past",
    "unknown-timezone",
    "capacity-zero",
    "capacity-over",
    "virtual-plain-http",
    "unknown-theme",
    "three-categories",
    "unknown-category",
    "repeated-category",
    "calendar-not-followed",
    "long-description",
]

VALIDATION_CASES = {
    "blank-name": ("name", lambda now: {"name": "   "}),
    "long-name": ("name", lambda now: {"name": "N" * (NAME_MAX + 1)}),
    "end-before-start": (("end_at", "start_at"), lambda now: {"end_at": (now + timedelta(days=29)).isoformat()}),
    "start-in-past": ("start_at", lambda now: {"start_at": (now - timedelta(days=1)).isoformat()}),
    "unknown-timezone": ("timezone", lambda now: {"timezone": "Mars/Olympus"}),
    "capacity-zero": ("capacity", lambda now: {"capacity": 0}),
    "capacity-over": ("capacity", lambda now: {"capacity": CAPACITY_MAX + 1}),
    "virtual-plain-http": ("virtual_link", lambda now: {"location_type": "virtual", "virtual_link": "http://probe.invalid/room"}),
    "unknown-theme": ("theme", lambda now: {"theme": "neon"}),
    "three-categories": ("categories", lambda now: {"categories": ["books", "games", "tech"]}),
    "unknown-category": ("categories", lambda now: {"categories": ["opera"]}),
    "repeated-category": ("categories", lambda now: {"categories": ["books", "books"]}),
    "calendar-not-followed": ("calendar", lambda now: {"calendar": "maker-hub"}),
    "long-description": ("description", lambda now: {"description": "d" * (DESCRIPTION_MAX + 1)}),
}


@pytest.mark.parametrize("case", VALIDATION_IDS, ids=VALIDATION_IDS)
def test_event_validation(app_url, case):
    base = norm(app_url)
    field, build = VALIDATION_CASES[case]
    host = signup(base, "validator")
    existing = make_event(host)["slug"]
    before = event_row(existing)
    now = now_utc()
    name = f"Invalid {case} {uuid.uuid4().hex[:8]}"
    body = {"name": name, "start_at": (now + timedelta(days=30)).isoformat(), "end_at": (now + timedelta(days=30, hours=2)).isoformat(), "city": "Noida"}
    overrides = build(now)
    body.update(overrides)
    created = host.http.post("/api/events", json=body)
    fields = field if isinstance(field, tuple) else (field,)
    assert created.status_code == 422, created.text
    assert any(f in created.json()["errors"] for f in fields)
    if "capacity" in fields:
        assert created.json()["errors"]["capacity"] == RANGE_MESSAGE
    assert events_named(body["name"]) == 0
    patched = host.http.patch(f"/api/events/{existing}", json=overrides)
    assert patched.status_code == 422, patched.text
    assert any(f in patched.json()["errors"] for f in fields)
    assert event_row(existing) == before


def test_wf_event_authoring_create_form(app_url, browser):
    base = norm(app_url)
    host = signup(base, "former")
    name = f"Form Night {uuid.uuid4().hex[:8]}"
    street = f"{uuid.uuid4().hex[:8]} Form Street"
    with live(browser, f"{base}/create", member=host) as page:
        theme = page.get_by_role("combobox", name="Theme")
        first = combobox_value(theme).lower()
        assert first in THEMES
        seen = []
        for _ in THEMES:
            page.get_by_role("button", name="Shuffle Theme").click()
            seen.append(combobox_value(theme).lower())
        start = THEMES.index(first)
        assert seen == [THEMES[(start + i) % len(THEMES)] for i in range(1, len(THEMES) + 1)]
        assert "Personal Calendar" in combobox_options(page, page.get_by_role("combobox", name="Calendar"))
        assert {"Public", "Private"} <= set(combobox_options(page, page.get_by_role("combobox", name="Visibility")))
        zone = page.get_by_role("combobox", name="Time zone")
        assert "GMT+05:30 Kolkata" in combobox_value(zone)
        assert any("GMT+09:00 Tokyo" in o for o in combobox_options(page, zone))
        expect(page.get_by_role("textbox", name="Capacity")).to_have_attribute("placeholder", "Unlimited")
        expect(page.get_by_text("Free").first).to_be_visible()
        page.get_by_role("textbox", name="Event Name").fill(name)
        when = {label: page.get_by_role("textbox", name=label) for label in ("Start date", "Start time", "End date", "End time")}
        typed = {label: box.input_value() for label, box in when.items()}
        prefilled = all(typed.values())
        if prefilled:
            when["End date"].fill(typed["Start date"])
            when["End time"].fill(typed["Start time"])
        else:
            for label, value in (("Start date", "2037-11-02"), ("Start time", "18:00"), ("End date", "2037-11-02"), ("End time", "17:00")):
                when[label].fill(value)
        venue = page.get_by_role("textbox", name="Venue name")
        reveal_location(page, venue)
        venue.fill("Form Hall")
        page.get_by_role("textbox", name="Street address").fill(street)
        page.get_by_role("textbox", name="City", exact=True).fill("Noida")
        page.get_by_role("button", name="Create Event").click()
        poll(lambda: page.evaluate(ANY_INVALID_JS), VISIBLE_DEADLINE)
        assert urlsplit(page.url).path == "/create"
        expect(page.get_by_role("textbox", name="Event Name")).to_have_value(name)
        if prefilled:
            expect(when["Start date"]).to_have_value(typed["Start date"])
        assert events_named(name) == 0
        if prefilled:
            when["End date"].fill(typed["End date"])
            when["End time"].fill(typed["End time"])
        else:
            when["End time"].fill("21:00")
        page.get_by_role("switch", name="Require Approval").click()
        page.get_by_role("textbox", name="Capacity").fill("2")
        page.get_by_role("switch", name="Waitlist Enabled").click()
        page.get_by_role("button", name="Create Event").click()
        page.wait_for_url(lambda u: re.fullmatch(r"/[^/]{8}", urlsplit(u).path) is not None)
        expect(page.get_by_role("heading", level=1)).to_have_text(name)
        expect(notifications(page)).to_contain_text("Your event is live")
        slug = urlsplit(page.url).path[1:]
    event = event_as(host, slug)
    assert (event["require_approval"], event["capacity"], event["waitlist"], event["street_address"]) == (True, 2, True, street)
    if prefilled:
        assert instant(event["end_at"]) > instant(event["start_at"])
    else:
        assert instant(event["start_at"]) == datetime(2037, 11, 2, 12, 30, tzinfo=timezone.utc)
    assert events_named(name) == 1


def test_wf_event_authoring_edit(app_url, browser):
    base = norm(app_url)
    host = signup(base, "editor")
    pending, approved, late = signup(base, "editp"), signup(base, "edita"), signup(base, "editl")
    seed_host = signin(base, HOST_EMAIL)
    event = make_event(host, require_approval=True, capacity=5)
    slug = event["slug"]
    register(pending, slug)
    register(approved, slug)
    assert decide(host, slug, guest_id(host, slug, approved.email), "approve").status_code == 200
    before = event_row(slug)
    for key, value in (("slug", "hijacked"), ("host_id", 1), ("going_count", 9), ("access_code", "x")):
        response = host.http.patch(f"/api/events/{slug}", json={key: value})
        assert response.status_code == 422 and response.json()["errors"][key] == UNKNOWN_FIELD
    assert event_row(slug) == before
    renamed = f"Edited {uuid.uuid4().hex[:8]}"
    after = host.http.patch(f"/api/events/{slug}", json={"name": renamed}).json()
    for key in ("description", "capacity", "city", "street_address", "require_approval", "theme", "start_at"):
        assert after[key] == event[key], key
    other_name = f"Raced {uuid.uuid4().hex[:8]}"
    together([lambda: api(base, host.token).patch(f"/api/events/{slug}", json={"name": other_name}),
              lambda: api(base, host.token).patch(f"/api/events/{slug}", json={"capacity": 6})])
    stored = event_as(host, slug)
    assert (stored["name"], stored["capacity"]) == (other_name, 6)
    statuses = lambda: (status_of(slug, pending.email), status_of(slug, approved.email))
    assert host.http.patch(f"/api/events/{slug}", json={"registration_status": "closed"}).json()["registration_status"] == "closed"
    assert statuses() == ("pending", "approved")
    assert register(late, slug).json() == {"error": "registration_closed"}
    assert host.http.patch(f"/api/events/{slug}", json={"registration_status": "closed"}).status_code == 200
    bad = host.http.patch(f"/api/events/{slug}", json={"registration_status": "code_only"})
    assert bad.status_code == 422 and "registration_status" in bad.json()["errors"]
    assert host.http.patch(f"/api/events/{slug}", json={"registration_status": "open"}).json()["registration_status"] == "open"
    seeded = seed_host.http.patch(event_path("fireworx"), json={"registration_status": "open"})
    assert seeded.status_code == 422 and "registration_status" in seeded.json()["errors"]
    assert event_as(seed_host, "fireworx")["registration_status"] == "code_only"
    assert host.http.patch(f"/api/events/{slug}", json={"require_approval": False}).status_code == 200
    assert statuses() == ("pending", "approved")
    ui_name = f"Saved {uuid.uuid4().hex[:8]}"
    with live(browser, f"{base}/manage/{slug}", member=host) as page:
        name_box = page.get_by_role("textbox", name="Event Name")
        expect(name_box).to_be_visible()
        assert host.http.patch(f"/api/events/{slug}", json={"capacity": 7}).status_code == 200
        name_box.fill(ui_name)
        page.get_by_role("button", name="Save Changes").click()
        expect(notifications(page)).to_contain_text("Changes saved")
        page.get_by_role("button", name="Close Registration").click()
        expect(notifications(page)).to_contain_text("Registration closed")
        expect(page.get_by_role("button", name="Reopen Registration")).to_be_visible()
    assert event_row(slug)["name"] == ui_name
    assert event_as(host, slug)["capacity"] == 7
    assert event_as(host, slug)["registration_status"] == "closed"
    assert statuses() == ("pending", "approved")


def test_wf_event_authoring_address_edit(app_url):
    base = norm(app_url)
    host = signup(base, "mover")
    guest = signup(base, "moved")
    event = make_event(host)
    slug, old = event["slug"], event["street_address"]
    assert register(guest, slug).json()["status"] == "approved"
    new = f"{uuid.uuid4().hex[:8]} Relocated Road"
    assert host.http.patch(f"/api/events/{slug}", json={"street_address": new}).json()["street_address"] == new
    for viewer in (host, guest):
        data = viewer.http.get(f"/api/events/{slug}")
        assert data.json()["street_address"] == new and old not in data.text
        html = page_client(viewer).get(f"/{slug}").text
        assert new in html and old not in html
    html = api(base).get(f"/{slug}").text
    assert new not in html and old not in html


def calendar_followers(base: str, slug: str) -> int:
    with api(base) as client:
        return next(c["follower_count"] for c in client.get("/api/calendars").json() if c["slug"] == slug)


def test_wf_communities_follow_ui(app_url, browser):
    base = norm(app_url)
    member = signup(base, "follower")
    before = calendar_followers(base, "chapterhouse")
    community = COMMUNITIES["chapterhouse"][0]
    with live(browser, f"{base}/discover", member=member) as page:
        page.get_by_role("button", name=f"Follow {community}").first.click()
        expect(page.get_by_role("button", name=re.compile(r"^Following")).first).to_be_visible()
        expect(notifications(page)).to_contain_text(f"Following {community}")
        page.goto(f"{base}/c/chapterhouse")
        count = before + 1
        expect(page.get_by_text("1 Follower" if count == 1 else f"{count} Followers").first).to_be_visible()
        expect(page.get_by_role("button", name=f"Following {community}")).to_have_attribute("aria-pressed", "true")
    assert follow_rows(member.email) == 1


def test_follow_concurrent(app_url):
    base = norm(app_url)
    member = signup(base, "racefollow")
    before = calendar_followers(base, "trail-runners")
    responses = together([lambda: api(base, member.token).put(follow_path("trail-runners")) for _ in range(CONCURRENCY)])
    assert all(r.status_code == 200 and r.json()["following"] is True for r in responses)
    assert follow_rows(member.email) == 1
    assert calendar_followers(base, "trail-runners") == before + 1
    gone = member.http.delete(follow_path("trail-runners"))
    assert gone.json() == {"following": False, "follower_count": before}
    assert follow_rows(member.email) == 0
    again = member.http.put(follow_path("trail-runners"))
    assert again.json() == {"following": True, "follower_count": before + 1}
    assert follow_rows(member.email) == 1
    assert member.http.put(follow_path("no-such-calendar")).status_code == 404


def test_wf_communities_contact_report(app_url, browser):
    base = norm(app_url)
    member = signup(base, "contacter")
    contact = event_path("zinefest", "/contact")
    report = event_path("zinefest", "/report")
    assert member.http.post(contact, json={"message": "   "}).status_code == 422
    assert member.http.post(contact, json={"message": "m" * (MESSAGE_MAX + 1)}).status_code == 422
    assert sent_rows("host_messages", member.email, "zinefest") == 0
    for message in ("Hello host", "m" * MESSAGE_MAX):
        response = member.http.post(contact, json={"message": message})
        assert response.status_code == 201 and response.json()["id"]
    assert sent_rows("host_messages", member.email, "zinefest") == 2
    assert member.http.post(report, json={"reason": "bogus"}).status_code == 422
    assert member.http.post(report, json={"reason": "spam", "details": "d" * (MESSAGE_MAX + 1)}).status_code == 422
    assert sent_rows("event_reports", member.email, "zinefest") == 0
    assert member.http.post(report, json={"reason": "spam"}).status_code == 201
    assert member.http.post(report, json={"reason": "other", "details": "d" * MESSAGE_MAX}).status_code == 201
    assert sent_rows("event_reports", member.email, "zinefest") == 2
    with live(browser, f"{base}/zinefest", member=member) as page:
        for opener, first, names in (("Contact the Host", ("textbox", "Message"), {"Message", "Send", "Close"}),
                                     ("Report Event", ("combobox", "Reason"), {"Reason", "Details", "Send Report", "Close"})):
            link = page.get_by_role("link", name=opener)
            link.click()
            dialog = page.get_by_role("dialog", name=opener)
            expect(dialog).to_be_visible()
            expect(dialog.get_by_role(first[0], name=first[1])).to_be_focused()
            for key in ["Tab"] * (len(names) * 2) + ["Shift+Tab"] * len(names):
                page.keyboard.press(key)
                assert dialog.evaluate("(d) => d.contains(document.activeElement)"), key
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()
            expect(link).to_be_focused()
            link.click()
            dialog.get_by_role("button", name="Close").click()
            expect(dialog).to_be_hidden()
            expect(link).to_be_focused()
        link = page.get_by_role("link", name="Contact the Host")
        link.click()
        dialog = page.get_by_role("dialog", name="Contact the Host")
        dialog.get_by_role("textbox", name="Message").fill("See you at the fair")
        dialog.get_by_role("button", name="Send").click()
        expect(dialog).to_be_hidden()
        expect(link).to_be_focused()
        expect(notifications(page)).to_contain_text("Message sent to the host")
    assert sent_rows("host_messages", member.email, "zinefest") == 3


def test_wf_communities_idempotent_send(app_url):
    base = norm(app_url)
    member = signup(base, "idem")
    other = signup(base, "idemother")
    path = event_path("zinefest", "/contact")
    report = event_path("zinefest", "/report")
    key = uuid.uuid4().hex
    first = member.http.post(path, json={"message": "Hello once"}, headers={"Idempotency-Key": key})
    assert first.status_code == 201
    spaced = member.http.post(path, content=b'{ "message" :  "Hello once" }', headers={"Idempotency-Key": key, "Content-Type": "application/json"})
    assert spaced.status_code == 201 and spaced.json()["id"] == first.json()["id"]
    for body in ({"message": "Hello twice"}, {"message": ""}):
        reused = member.http.post(path, json=body, headers={"Idempotency-Key": key})
        assert reused.status_code == 422 and reused.json() == {"error": "idempotency_key_reused"}
    assert sent_rows("host_messages", member.email, "zinefest") == 1
    for bad in ("", "has space", "k" * (KEY_MAX + 1), "bad*key"):
        response = member.http.post(path, json={"message": "Hello"}, headers={"Idempotency-Key": bad})
        assert response.status_code == 422 and "idempotency_key" in response.json()["errors"]
    assert sent_rows("host_messages", member.email, "zinefest") == 1
    refused_key = uuid.uuid4().hex
    assert member.http.post(path, json={"message": "  "}, headers={"Idempotency-Key": refused_key}).status_code == 422
    assert member.http.post(path, json={"message": "Now valid"}, headers={"Idempotency-Key": refused_key}).status_code == 201
    assert other.http.post(path, json={"message": "Hello once"}, headers={"Idempotency-Key": key}).json()["id"] != first.json()["id"]
    assert member.http.post(report, json={"reason": "spam"}, headers={"Idempotency-Key": key}).status_code == 201
    assert member.http.post(event_path("gardenfs", "/contact"), json={"message": "Hello once"}, headers={"Idempotency-Key": key}).status_code == 201
    report_key = uuid.uuid4().hex
    r1 = member.http.post(report, json={"reason": "other", "details": "x"}, headers={"Idempotency-Key": report_key})
    r2 = member.http.post(report, json={"details": "x", "reason": "other"}, headers={"Idempotency-Key": report_key})
    assert r1.json()["id"] == r2.json()["id"]
    race_key = uuid.uuid4().hex
    before_race = sent_rows("host_messages", member.email, "zinefest")
    responses = together([lambda: api(base, member.token).post(path, json={"message": "Raced"}, headers={"Idempotency-Key": race_key}) for _ in range(CONCURRENCY)])
    assert all(r.status_code == 201 for r in responses)
    assert len({r.json()["id"] for r in responses}) == 1
    assert sent_rows("host_messages", member.email, "zinefest") == before_race + 1
    before = sent_rows("host_messages", member.email, "zinefest")
    member.http.post(path, json={"message": "No key"})
    member.http.post(path, json={"message": "No key"})
    assert sent_rows("host_messages", member.email, "zinefest") == before + 2


def test_contact_dialog_retry(app_url, browser):
    base = norm(app_url)
    member = signup(base, "retrier")
    keys: list[str] = []

    def handler(route):
        keys.append(route.request.headers.get("idempotency-key"))
        if len(keys) == 1:
            route.fetch()
            route.abort()
        else:
            route.continue_()

    with live(browser, f"{base}/zinefest", member=member) as page:
        page.route("**" + event_path("zinefest", "/contact"), handler)
        link = page.get_by_role("link", name="Contact the Host")
        link.click()
        dialog = page.get_by_role("dialog", name="Contact the Host")
        dialog.get_by_role("textbox", name="Message").fill(LOST_MESSAGE)
        dialog.get_by_role("button", name="Send").click()
        expect(dialog.get_by_role("alert")).to_contain_text(OUTAGE_ALERT)
        expect(dialog.get_by_role("textbox", name="Message")).to_have_value(LOST_MESSAGE)
        dialog.get_by_role("button", name="Send").click()
        expect(dialog).to_be_hidden()
        expect(notifications(page)).to_contain_text("Message sent to the host")
        assert sent_rows("host_messages", member.email, "zinefest") == 1
        link.click()
        dialog.get_by_role("textbox", name="Message").fill("Second opening")
        dialog.get_by_role("button", name="Send").click()
        expect(dialog).to_be_hidden()
    assert keys[0] and keys[0] == keys[1] and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", keys[0])
    assert keys[2] != keys[0]
    assert sent_rows("host_messages", member.email, "zinefest") == 2


PUBLIC_PAGES = ["/", "/discover", "/c/chapterhouse", "/runclub7", "/signin"]


def test_same_origin(app_url, browser):
    base = norm(app_url)
    for path in PUBLIC_PAGES + ["/fireworx"]:
        requests: list[tuple[str, str]] = []
        with live(browser, base + path, on_page=lambda p: p.on("request", lambda r: requests.append((r.url, r.resource_type)))) as page:
            page.wait_for_load_state("networkidle")
        assert any(kind == "script" and same_origin(u, base) for u, kind in requests), path
        foreign = [u for u, _ in requests if u.startswith(("http:", "https:", "ws:", "wss:")) and not same_origin(u, base)]
        assert not foreign, (path, foreign)


def test_landing_page(app_url, browser):
    base = norm(app_url)
    with live(browser, f"{base}/", js=False) as page:
        h1 = page.get_by_role("heading", level=1)
        for word in ("Joyful", "gatherings", "made simple"):
            expect(h1).to_contain_text(word)
        assert "From run clubs to launch parties and firework shows, Mela makes every event feel effortless." in body_text(page)
        for name, target in (("run clubs", "/runclub7"), ("launch parties", "/launchpt"), ("firework shows", "/fireworx"),
                             ("Create Your First Event", "/create"), ("Discover Events", "/discover")):
            link = page.get_by_role("link", name=name).first
            assert urlsplit(urljoin(page.url, link.get_attribute("href"))).path == target
        tops = [page.get_by_text(re.compile(rf"^{re.escape(t)}")).first.bounding_box()["y"]
                for t in ("Coming Up in", "Multi-Day Highlights", "Communities to Join", "Browse by Category", "Someone is saving you a seat.")]
        assert tops == sorted(tops)
        text = body_text(page)
        everything = page.evaluate("() => document.body.textContent")
        for expected in ["New Delhi"] + CATEGORY_NAMES:
            assert expected in text, expected
        assert any(SEED_EVENTS[slug][0] in text for slug in ("foodwalk", "potterya", "closedbf")), "no New Delhi event under Coming Up in"
        assert any(SEED_EVENTS[slug][0] in text for slug in ("zinefest", "gardenfs")), "no multi-day highlight"
        for city in CITIES.values():
            assert city in everything, city
        assert any(c[0] in text for c in COMMUNITIES.values())
    with live(browser, f"{base}/") as page:
        hovers = []
        for name in ("run clubs", "launch parties", "firework shows"):
            rest, hover = state_styles(page.get_by_role("link", name=name), "color")
            assert rest["color"] != hover["color"], name
            hovers.append(hover["color"])
        assert len(set(hovers)) == 3
        rest, hover = state_styles(page.get_by_role("main").get_by_role("link", name="Discover Events").first, "color", "background-color")
        assert rest != hover


SCROLLER_JS = """() => {
  const fits = (n) => n.scrollHeight > n.clientHeight + 1;
  let s = document.scrollingElement || document.documentElement;
  if (!fits(s)) {
    s = Array.from(document.body.getElementsByTagName('*')).find((n) => /(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY) && fits(n)) || s;
  }
  window.__melaScroller = s;
}"""
SCROLL_TO_JS = "(y) => { window.__melaScroller.scrollTo({top: y, behavior: 'instant'}); }"
SCATTER_JS = r"""() => {
  const pinned = (el) => { for (let n = el; n; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  const s = window.__melaScroller || document.scrollingElement || document.documentElement;
  const root = s === document.scrollingElement || s === document.documentElement;
  if (!window.__melaEls) window.__melaEls = Array.from(document.body.getElementsByTagName('*'));
  return window.__melaEls.map((el) => {
    if (!el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    let o = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      o *= parseFloat(cs.opacity);
      for (const m of (cs.filter || '').matchAll(/opacity\(([\d.]+)(%?)\)/g)) o *= m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    }
    const p = pinned(el);
    const moves = !p && (root || s.contains(el));
    return {x: r.left + r.width / 2 + (moves ? s.scrollLeft : 0), y: r.top + r.height / 2 + (moves ? s.scrollTop : 0), o, p};
  });
}"""
FRACTIONS = [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]

SHOWN_WORDS_JS = r"""(h1, words) => {
  const clipped = (s, r) => {
    const clip = s.clipPath || 'none';
    if (/^(circle|ellipse)\(\s*0(px|%)?[\s)]/.test(clip)) return true;
    const m = /^inset\(([^)]*)\)/.exec(clip);
    if (!m) return false;
    const v = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/);
    const t = v[0], rt = v[1] ?? t, b = v[2] ?? t, l = v[3] ?? rt;
    const px = (x, size) => x.endsWith('%') ? parseFloat(x) / 100 * size : parseFloat(x) || 0;
    return px(t, r.height) + px(b, r.height) >= r.height - 0.5 || px(l, r.width) + px(rt, r.width) >= r.width - 0.5;
  };
  const visible = (el, r) => {
    if (!r.width || !r.height) return false;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let op = 1;
    for (let a = el; a; a = a.parentElement) {
      const s = getComputedStyle(a), q = a.getBoundingClientRect();
      op *= parseFloat(s.opacity);
      if (s.display === 'none' || s.visibility === 'hidden' || clipped(s, q)) return false;
      if (a !== el && s.overflow !== 'visible' && (cx < q.left || cx > q.right || cy < q.top || cy > q.bottom)) return false;
      if (a === h1) break;
    }
    const s = getComputedStyle(el);
    const clear = /^rgba\(.*,\s*0\)$/.test(s.color) && s.backgroundImage === 'none';
    return op > 0.5 && !clear;
  };
  const shown = new Set();
  for (const el of h1.getElementsByTagName('*')) {
    const t = el.textContent.trim();
    if (words.includes(t) && visible(el, el.getBoundingClientRect())) shown.add(t);
  }
  const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim();
    if (!words.includes(t)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    if (visible(n.parentElement, range.getBoundingClientRect())) shown.add(t);
  }
  return [...shown];
}"""

CYCLE_JS = """(h, ms) => h.getAnimations({subtree: true}).forEach((a) => {
  if (a.effect && a.effect.getComputedTiming().iterations === Infinity) a.currentTime = (a.currentTime || 0) + ms;
})"""


def scatter(page: Page) -> tuple[tuple[float, float], list[list[dict | None]]]:
    page.set_viewport_size({"width": 1280, "height": 800})
    settle(page.get_by_role("main"))
    box = page.get_by_role("heading", level=1).bounding_box()
    center = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    height = page.evaluate("() => innerHeight")
    page.evaluate(SCROLLER_JS)
    samples = []
    for fraction in FRACTIONS:
        target = round(height * fraction)
        page.evaluate(SCROLL_TO_JS, target)
        advance(page, SCROLL_FRAME_MS)
        assert abs(page.evaluate("() => window.__melaScroller.scrollTop") - target) <= 1, "landing page is shorter than two screens"
        samples.append(page.evaluate(SCATTER_JS))
    return center, samples


def test_hero_motion(app_url, browser):
    base = norm(app_url)
    with open_app(browser, f"{base}/") as page:
        center, samples = scatter(page)
        dist = lambda s: math.hypot(s["x"] - center[0], s["y"] - center[1])
        items = [i for i in range(len(samples[0])) if all(s[i] for s in samples)]

        def scatters(i: int) -> bool:
            d = [dist(s[i]) for s in samples]
            return (d[4] - d[0] > 2
                    and all(b >= a - 0.5 for a, b in zip(d[:5], d[1:5]))
                    and all(b <= a + 0.5 for a, b in zip(d[4:], d[5:]))
                    and abs(d[-1] - d[0]) <= 0.5
                    and 0.3 <= (d[2] - d[0]) / (d[4] - d[0]) <= 0.7)

        movers = [i for i in items if scatters(i)]
        faders = [i for i in items if samples[0][i]["o"] >= 0.9 and 0.3 <= samples[4][i]["o"] <= 0.7]
        assert len(movers) >= COVER_COUNT and len(faders) >= COVER_COUNT
        page.evaluate(SCROLL_TO_JS, 0)
        h1 = page.get_by_role("heading", level=1)
        h1.evaluate(CYCLE_JS, WORD_DWELL_MS)
        seen = set()
        for _ in range(len(HERO_WORDS) + 1):
            settle(h1)
            seen |= set(h1.evaluate(SHOWN_WORDS_JS, HERO_WORDS))
            advance(page, WORD_SWAP_MS)
            h1.evaluate(CYCLE_JS, WORD_SWAP_MS)
        assert seen == set(HERO_WORDS)
    with open_app(browser, f"{base}/", reduced_motion="reduce") as page:
        _, samples = scatter(page)
        for a, b in zip(samples[0], samples[4]):
            if a and b and not a["p"]:
                assert abs(a["x"] - b["x"]) <= 0.5 and abs(a["y"] - b["y"]) <= 0.5 and abs(a["o"] - b["o"]) <= 0.01
        h1 = page.get_by_role("heading", level=1)
        h1.evaluate(CYCLE_JS, WORD_DWELL_MS)
        for _ in range(len(HERO_WORDS)):
            assert sorted(h1.evaluate(SHOWN_WORDS_JS, HERO_WORDS)) == ["Joyful"]
            advance(page, WORD_SWAP_MS)
            h1.evaluate(CYCLE_JS, WORD_SWAP_MS)


def test_toasts(app_url, browser):
    base = norm(app_url)
    member = signup(base, "toaster")
    with open_app(browser, f"{base}/c/maker-hub") as page:
        sign_in_page(page, member, base)
        page.goto(f"{base}/c/maker-hub")
        region = notifications(page)
        dismiss = region.get_by_role("button", name="Dismiss notification")
        hub = COMMUNITIES["maker-hub"][0]
        follow = page.get_by_role("button", name=re.compile(r"^Follow(ing)? Maker Hub$"))
        for i in range(4):
            label = f"Following {hub}" if i % 2 == 0 else f"Unfollowed {hub}"
            follow.click()
            until(page, "(t) => document.body.innerText.includes(t)", label)
            assert not region.evaluate("(r) => r.contains(document.activeElement)")
            at_most(page, dismiss, TOAST_LIMIT)
        hovered = dismiss.last
        hovered.hover()
        handle = hovered.element_handle()
        advance(page, TOAST_WAIT_MS)
        assert handle.evaluate("(b) => b.isConnected && b.getClientRects().length > 0")
        page.mouse.move(0, 0)
        advance(page, TOAST_WAIT_MS)
        gone(page, dismiss)
        follow.click()
        expect(dismiss).to_have_count(1)
        dismiss.first.click()
        gone(page, dismiss)
        follow.click()
        expect(dismiss).to_have_count(1)
        dismiss.first.focus()
        page.keyboard.press("Escape")
        gone(page, dismiss)


def test_celebration(app_url, browser):
    base = norm(app_url)
    host = signup(base, "partyhost")
    member = signup(base, "partier")
    calm = signup(base, "calm")
    slug = make_event(host)["slug"]
    other = make_event(host)["slug"]
    with open_app(browser, f"{base}/{slug}") as page:
        sign_in_page(page, member, base)
        page.goto(f"{base}/{slug}")
        baseline = celebrations(page)
        page.evaluate(CELEBRATION_SNAPSHOT_JS)
        page.get_by_role("button", name="Register", exact=True).click()
        until(page, f"() => ({CELEBRATION_JS})() > {baseline}")
        info = page.evaluate(CELEBRATION_NODE_JS)
        assert info and not info["focus"] and not info["overflow"]
        cancel_button = card_of(page).get_by_role("button", name="Cancel Registration")
        assert cancel_button.evaluate("(b) => { const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b === e || b.contains(e); }")
        advance(page, CELEBRATION_MAX_MS)
        until(page, CELEBRATION_GONE_JS, seconds=CELEBRATION_SLACK_SECONDS)
        page.reload()
        advance(page, CELEBRATION_MAX_MS)
        assert celebrations(page) == baseline
    with open_app(browser, f"{base}/{other}", reduced_motion="reduce") as page:
        sign_in_page(page, calm, base)
        page.goto(f"{base}/{other}")
        baseline = celebrations(page)
        page.get_by_role("button", name="Register", exact=True).click()
        until(page, "() => document.body.innerText.includes(\"You're In\")")
        advance(page, CELEBRATION_MAX_MS)
        assert celebrations(page) == baseline
    assert status_of(slug, member.email) == "approved" and status_of(other, calm.email) == "approved"


def test_global_chrome(app_url, browser):
    base = norm(app_url)
    for path in ("/", "/discover"):
        with live(browser, base + path) as page:
            expect(page.get_by_role("link", name="Sign In")).to_be_visible()
            expect(page.get_by_role("button", name="Account menu")).to_have_count(0)
    member = signup(base, "chrome", name="Asha Verma")
    with live(browser, f"{base}/home", member=member) as page:
        account = page.get_by_role("button", name="Account menu")
        expect(account).to_be_visible()
        poll(lambda: re.search(r"(?<![A-Za-z])A\s*V?(?![A-Za-z])", account.inner_text(), re.I), VISIBLE_DEADLINE)
        expect(page.get_by_role("link", name="Sign In")).to_have_count(0)
        account.focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu")
        expect(menu).to_be_visible()
        items = [menu.get_by_role("menuitem", name=n) for n in ("My Events", "Create Event", "Sign Out")]
        for item in items:
            expect(item).to_be_visible()
        page.keyboard.press("ArrowDown")
        assert any(item.evaluate("(e) => e === document.activeElement") for item in items)
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(account).to_be_focused()
        expect(page.get_by_role("tablist")).to_be_visible()
        expect(page.get_by_role("tab", name="Upcoming")).to_be_visible()
        expect(page.get_by_text("No Upcoming Events")).to_be_visible()
        main = page.get_by_role("main")
        expect(main.get_by_role("link", name="Create Event")).to_be_visible()
        expect(main.get_by_role("link", name="Discover Events")).to_be_visible()
        page.get_by_role("tab", name="Past").click()
        expect(page.get_by_text("No Past Events")).to_be_visible()


def test_accessible_public_pages(app_url, browser):
    base = norm(app_url)
    for path in PUBLIC_PAGES:
        with live(browser, base + path, bypass_csp=True) as page:
            quiesce(page)
            axe(page)


def test_accessible_themes(app_url, browser):
    base = norm(app_url)
    for theme, slug in THEMED_EVENTS.items():
        assert event_as(None, slug, base)["theme"] == theme
        with live(browser, f"{base}/{slug}", bypass_csp=True) as page:
            quiesce(page)
            axe(page)


def test_accessible_member_pages(app_url, browser):
    base = norm(app_url)
    host = signup(base, "a11yhost")
    guest = signup(base, "a11yguest")
    slug = make_event(host, capacity=3, waitlist=True)["slug"]
    register(guest, slug)
    for path in ("/home", "/create", f"/manage/{slug}", f"/{slug}"):
        with live(browser, base + path, member=host, bypass_csp=True) as page:
            quiesce(page)
            axe(page)


def test_skip_link(app_url, browser):
    base = norm(app_url)
    for path in PUBLIC_PAGES:
        with live(browser, base + path) as page:
            assert tab_order(page, 1)[0] == "Skip to Content"
            page.keyboard.press("Enter")
            assert page.get_by_role("main").evaluate("(m) => m === document.activeElement || m.contains(document.activeElement)")


def test_reflow(app_url, browser):
    base = norm(app_url)
    host = signup(base, "reflow")
    slug = make_event(host)["slug"]
    visitor_paths = PUBLIC_PAGES + ["/fireworx", "/pricing"]
    member_paths = ["/home", "/create", f"/manage/{slug}", f"/{slug}"]
    for viewport in [NARROW] + VIEWPORTS:
        for path in visitor_paths:
            with live(browser, base + path, viewport=viewport) as page:
                no_sideways(page)
        for path in member_paths:
            with live(browser, base + path, member=host, viewport=viewport) as page:
                no_sideways(page)


def test_not_found(app_url, browser):
    base = norm(app_url)
    with api(base) as client:
        for path in ("/no-such-page/deeper", "/no-such-event", "/c/no-such-community", "/pricing"):
            response = client.get(path)
            assert response.status_code == 404 and NOT_FOUND_HEADING in unescape(response.text), path
        for path in ("/run.json", "/.env", "/requirements.txt", "/app.py", "/.venv/pyvenv.cfg"):
            assert client.get(path).status_code == 404, path
        for path in ("/api/no-such-thing", "/api/events/no-such-event"):
            response = client.get(path)
            assert response.status_code == 404 and response.json() == {"error": "not_found"}
    with live(browser, f"{base}/pricing", js=False) as page:
        expect(page.get_by_role("heading", level=1)).to_have_text(NOT_FOUND_HEADING)
        expect(page.get_by_text(NOT_FOUND_LINE)).to_be_visible()


def test_not_found_back_link(app_url, browser):
    base = norm(app_url)
    with live(browser, f"{base}/no-such-event") as page:
        page.get_by_role("link", name="Back to Discover").click()
        page.wait_for_url(lambda u: urlsplit(u).path == "/discover")
        expect(page.get_by_role("heading", name="Discover Events")).to_be_visible()


def test_if_run_manifest():
    data = json.loads((APP_DIR / "run.json").read_text())
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[key], str) for key in ("install", "build", "serve"))
    serve = data["serve"]
    assert serve.strip()
    assert "flask run" not in serve
    assert not re.search(r"--(debug|reload)\b|\bFLASK_DEBUG=\s*['\"]?(1|true)|\b(debug|use_reloader|reload)\s*=\s*True\b", serve, re.I)
    assert not re.search(r"\b(nohup|setsid|disown)\b", serve)
    assert not serve.rstrip().endswith("&")


def test_if_user_readme():
    text = (APP_DIR / "USER_README.md").read_text()
    for email in SEED_MEMBERS:
        assert email in text
    assert SEED_PASSWORD in text


TREE_SCRIPT = r'''
import json, re, sys
from importlib import metadata
norm = lambda n: re.sub(r"[-_.]+", "-", n).lower()
seen, stack = {}, [(r[0], set(r[1])) for r in json.loads(sys.argv[1])]
while stack:
    name, extras = stack.pop()
    try:
        dist = metadata.distribution(name)
    except metadata.PackageNotFoundError:
        continue
    key = norm(dist.metadata["Name"])
    if key in seen and not extras:
        continue
    seen[key] = dist.metadata.get("License-Expression") or dist.metadata.get("License") or ""
    for req in dist.requires or []:
        marker = re.search(r"extra\s*==\s*['\"]([^'\"]+)['\"]", req)
        if marker and marker.group(1) not in extras:
            continue
        found = re.match(r"\s*([A-Za-z0-9._-]+)(\[([^\]]+)\])?", req)
        if found:
            stack.append((found.group(1), set((found.group(3) or "").replace(" ", "").split(",")) - {""}))
print(json.dumps(seen))
'''


def shipped_packages() -> dict[str, str]:
    roots = []
    requirements = APP_DIR / "requirements.txt"
    if requirements.exists():
        lines = [l.split("#")[0].strip() for l in requirements.read_text().splitlines()]
    else:
        import tomllib
        data = tomllib.loads((APP_DIR / "pyproject.toml").read_text())
        lines = list(data.get("project", {}).get("dependencies", []))
        for dep, spec in data.get("tool", {}).get("poetry", {}).get("dependencies", {}).items():
            if dep.lower() == "python":
                continue
            extras = spec.get("extras", []) if isinstance(spec, dict) else []
            lines.append(f"{dep}[{','.join(extras)}]" if extras else dep)
    for line in lines:
        found = re.match(r"([A-Za-z0-9._-]+)(\[([^\]]+)\])?", line)
        if found:
            roots.append((found.group(1), (found.group(3) or "").replace(" ", "").split(",") if found.group(3) else []))
    python = Path(DEPLOYED_APP) / ".venv" / "bin" / "python"
    out = subprocess.run([str(python), "-I", "-c", TREE_SCRIPT, json.dumps(roots)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_if_datastore_clients():
    packages = shipped_packages()
    assert "flask" in packages
    for name in packages:
        assert not any(stem in name for stem in DATASTORE_STEMS), name


def test_if_third_party_notices():
    text = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    lines = text.splitlines()
    normalized = [re.sub(r"[-_.]+", "-", l).lower() for l in lines]
    alpine = "Alpine.js"
    assert alpine.lower() in text.lower()
    names = list(shipped_packages()) + [re.sub(r"[-_.]+", "-", alpine).lower()]
    mentions = {name: [i for i, l in enumerate(normalized) if name in l] for name in names}
    patterns = LICENCE_PATTERNS + [re.escape(licence) for licence in ALLOWED_LICENCES]

    def section(name: str, i: int) -> str:
        later = [j for other, hits in mentions.items() if other != name and other not in name for j in hits if j > i]
        end = min(later) if later else len(lines)
        heading = next((lines[j] for j in range(i, -1, -1) if lines[j].lstrip().startswith("#")), "")
        return " ".join(lines[i:max(end, i + 1)]) + " " + heading

    for name in names:
        assert mentions[name], name
        assert any(any(re.search(p, section(name, i), re.I) for p in patterns) for i in mentions[name]), name


def test_if_pinned_dependencies():
    requirements = APP_DIR / "requirements.txt"
    if requirements.exists():
        lines = [l.strip() for l in requirements.read_text().splitlines() if l.strip() and not l.strip().startswith("#")]
        assert lines
        for line in lines:
            assert re.fullmatch(r"[A-Za-z0-9._-]+(\[[A-Za-z0-9,._-]+\])?==[^=\s;]+", line), line
    else:
        assert (APP_DIR / "pyproject.toml").exists()
        assert any((APP_DIR / lock).exists() for lock in ("uv.lock", "poetry.lock", "pdm.lock", "Pipfile.lock"))


def test_if_no_extra_services():
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.exists():
        return
    try:
        data = json.loads(trajectory.read_text(errors="replace"))
    except json.JSONDecodeError:
        return
    commands: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in COMMAND_KEYS and isinstance(value, str):
                    commands.append(value)
                elif key in COMMAND_KEYS and isinstance(value, list) and all(isinstance(v, str) for v in value):
                    commands.append(" ".join(value))
                else:
                    walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    for command in commands:
        command = HEREDOC_RE.sub("\n", command)
        command = QUOTED_RE.sub("''", command)
        for segment in re.split(r"\n|&&|\|\||;|\|", command):
            assert not DATABASE_STARTER_RE.search(segment), segment.strip()
