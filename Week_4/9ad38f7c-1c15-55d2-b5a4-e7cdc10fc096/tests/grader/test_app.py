from __future__ import annotations

import base64
import contextlib
import functools
import hashlib
import json
import math
import os
import queue
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from importlib import metadata
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlsplit, urlunsplit
from xml.etree import ElementTree

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, TimeoutError as PlaywrightTimeout, expect

from conftest import (
    DEPLOYED_APP,
    advance,
    axe,
    click,
    decode,
    difference,
    fill,
    held,
    layout,
    open_app,
    same_origin,
    scroll_samples,
    seek_rects,
    session,
    state_styles,
    style,
    tab_order,
    unique,
)

try:
    from conftest import Postgres
except ImportError:
    from postgres import Postgres


APP_ROOT = Path("/app")
HTTP_TIMEOUT = 15
UI_WAIT_SECONDS = 15
EXPECT_SECONDS = 5  # infra: Playwright expect()/action default timeout (5000 ms) the bare waits used
STEP_MS = 500
BOOT_SECONDS = 90
SETTLE_MS = 1000

LIVE_UI_SECONDS = 2
STREAM_SECONDS = 2
OUTAGE_SECONDS = 5
RECOVERY_SECONDS = 5
JSON_SECONDS = 1
BODY_LIMIT = 16384
MAX_DEPTH = 32
TEAM_CAP = 20
WRONG_FLAG_LIMIT = 5
FLAG_LOCK_SECONDS = 60
SIGN_IN_LIMIT = 10
DEFAULT_SIGN_IN_LOCK = 900
SHORT_LOCK_SECONDS = 3
DEFAULT_LIMIT = 5
LIMIT_CAP = 50
FEED_SIZE = 10
EMAIL_MIN = 3
EMAIL_MAX = 254
NAME_MAX = 40
PASSWORD_MIN = 8
PASSWORD_MAX = 128
BCRYPT_BYTES = 72
SLUG_MAX = 64
ID_MAX = 9223372036854775807
WEBINAR_TICKETS = 2
CHALLENGES_TOTAL = 5
HOUR_SECONDS = 3600
MINUTE_SECONDS = 60
POP_MAX_MS = 333
ENTER_MAX_MS = 500
DOT_MIN_MS = 2500
DOT_MAX_MS = 4500
MIN_DOTS = 20
TAIL_MS = 250
TOUCH_MIN = 44
SHOW_ALL_PAGES = 7
SUBPIXEL = 2

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
LAPTOP = {"width": 1280, "height": 800}
NARROW = {"width": 320, "height": 812}

FAR_ZONE = "Pacific/Kiritimati"
WRONG_FLAG = "flag{not_the_answer}"
SEED_PASSWORD = "deku-demo-pw-2026"
WEBINAR_FLAG = "flag{comfort_zone_exit}"
EVENT_NAME = "Strange & Unusual Activity"
OUTAGE_COPY = "The event server is not answering. Try again in a moment."
FILM_PATH = "/assets/moths-drawn-to-park-lights-246f8064.webm"
SOUND_PATH = "/assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg"
FILM_SHA = "dbccae98058fd49ed2e4541c367a17a6a33401cf4dc3300123c0c2056ce9a60c"
SOUND_SHA = "ec2a2a610ad3dcc36ecc1ea7d7e1b4f58255026434bd357e5edd446b3fe3bcc7"
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
DRIVER_TEXT = re.compile(r"traceback|psycopg|asyncpg|sqlalchemy|postgres|select |syntax error|/app/|\.py\b|exception", re.I)

EVENT = {
    "name": "Strange & Unusual Activity",
    "start": "2026-10-22T16:00:00Z",
    "end": "2026-10-26T23:59:00Z",
    "calendar_title": "Strange & Unusual Activity, a NightWard Downtime CTF",
    "calendar_description": "Five days, eight scenarios, one haunted network. Join any day between Thursday 22 and Monday 26 October.",
}

SCENARIOS = [
    {"number": 1, "slug": "repossessed", "title": "Repossessed", "kind": "soc-sim", "points": 500, "flag": "flag{nine_alerts_one_build}",
     "description": "It's 9:14 on a Thursday at Gravelight Studios, and Marketing has just opened a press kit that wasn't meant for them. You're the SOC on shift. Triage nine alerts, separate real threats from noise, and write up what you find before the unreleased game build walks out the door."},
    {"number": 2, "slug": "quiet-as-the-grave", "title": "Quiet As The Grave", "kind": "th-sim", "points": 500, "flag": "flag{hypothesis_held}",
     "description": "A week after the breach, the crew that took Gravelight's game build is back, and this time it's quiet. You have a threat intel memo and a hypothesis, but no confirmed alerts. Hunt through the logs, rebuild the attack stage by stage, and prove how far they got."},
    {"number": 3, "slug": "deadmen-tell-no-logs", "title": "Deadmen Tell No Logs", "kind": "tabletop", "points": 500, "flag": "flag{irregularities_logged}",
     "description": "As your team pushes toward a deadline the whole studio has been building towards, a handful of small, easily dismissed irregularities begin to surface in the background."},
    {"number": 4, "slug": "handbook-for-the-recently-compromised", "title": "Handbook For The Recently Compromised", "kind": "challenge", "points": 60, "flag": "flag{timeline_rebuilt}",
     "description": "A Windows workstation has been flagged for suspicious activity, and its event logs are ready for review. Follow the sequence of events, identify the processes involved, and build a clear timeline of the incident."},
    {"number": 5, "slug": "the-waiting-room", "title": "The Waiting Room", "kind": "challenge", "points": 80, "flag": "flag{payment_run_traced}",
     "description": "Maren received a supplier email about an upcoming payment run. After opening an attachment, her workstation contacted an unfamiliar service. Reconstruct the execution chain and determine what left the workstation."},
    {"number": 6, "slug": "day-o", "title": "Day-O", "kind": "challenge", "points": 90, "flag": "flag{payload_unpacked}",
     "description": "Soraya opened a document review package, but the preview froze and the application stopped responding. Examine the running processes and uncover the hidden payload."},
    {"number": 7, "slug": "strange-and-unusual-activity", "title": "Strange & Unusual Activity", "kind": "challenge", "points": 100, "flag": "flag{dns_whispers}",
     "description": "A threat intelligence lead suggests a workstation is communicating with an attacker, but no security alerts have fired. You have a day of connection and DNS logs in a log search console. Identify the workstation involved and establish how much data left."},
    {"number": 8, "slug": "dead-endpoint", "title": "Dead Endpoint", "kind": "challenge", "points": 120, "flag": "flag{gallery_restored}",
     "description": "Staff arrived to find their internal photo gallery unusable and its images unreadable. Reconstruct how the application was compromised and find a way to recover the affected images."},
]
BY_SLUG = {s["slug"]: s for s in SCENARIOS}
FLAG = {s["slug"]: s["flag"] for s in SCENARIOS}
KIND_LABEL = {"soc-sim": "SOC Sim Scenario", "th-sim": "Threat Hunting Sim Scenario", "tabletop": "Tabletop Exercise", "challenge": "Challenge"}

SEED_TEAMS = [
    ("Cold Ledger", "COLDLEDG", "coldledger@example.com", "Mara Quill", "2026-10-22T16:02:00Z", (1, 2, 3, 4, 5, 6, 7, 8), "2026-10-23T07:30:00Z", 1950),
    ("Grey Static", "GREYSTAT", "sasha@example.com", "Sasha Reyes", "2026-10-22T16:05:00Z", (1, 2, 3, 4, 5, 6, 7, 8), "2026-10-23T09:00:00Z", 1950),
    ("Quiet Hours", "QUIETHRS", "quiethours@example.com", "Noor Ashby", "2026-10-22T16:08:00Z", (1, 2, 3, 7, 8), "2026-10-23T08:00:00Z", 1720),
    ("Bone Orchard", "BONEORCH", "boneorchard@example.com", "Ilya Brandt", "2026-10-22T16:11:00Z", (1, 2, 5), "2026-10-22T21:00:00Z", 1080),
    ("Null Harbor", "NULLHARB", "nullharbor@example.com", "Dana Okafor", "2026-10-22T16:14:00Z", (1, 2, 4), "2026-10-22T20:00:00Z", 1060),
    ("Pale Signal", "PALESIGN", "palesignal@example.com", "Kit Moreau", "2026-10-22T16:17:00Z", (1, 3), "2026-10-22T18:00:00Z", 1000),
    ("Attic Lights", "ATTICLIT", "atticlights@example.com", "June Haldane", "2026-10-22T16:20:00Z", (1, 3), "2026-10-22T19:00:00Z", 1000),
    ("Lantern Watch", "LANTERN1", "captain@example.com", "Rowan Vale", "2026-10-22T16:23:00Z", (1, 4), "2026-10-22T18:00:00Z", 560),
    ("Moth Light", "MOTHLITE", "mothlight@example.com", "Ezra Pike", "2026-10-22T16:26:00Z", (2,), "2026-10-22T16:30:00Z", 500),
    ("Crypt Keys", "CRYPTKEY", "cryptkeys@example.com", "Lena Sorel", "2026-10-22T16:29:00Z", (2,), "2026-10-22T22:00:00Z", 500),
    ("Static Choir", "STATICCH", "staticchoir@example.com", "Omar Fenn", "2026-10-22T16:32:00Z", (4, 5, 6), "2026-10-23T01:00:00Z", 230),
    ("Grave Shift", "GRAVESHF", "graveshift@example.com", "Pia Lund", "2026-10-22T16:35:00Z", (8,), "2026-10-22T23:00:00Z", 120),
    ("Night Ledger", "NIGHTLDG", "nightledger@example.com", "Cal Rook", "2026-10-22T16:38:00Z", (6,), "2026-10-22T17:30:00Z", 90),
    ("Hollow Port", "HOLLOWPT", "hollowport@example.com", "Bea Strand", "2026-10-22T16:41:00Z", (4,), "2026-10-22T18:30:00Z", 60),
    ("Dust Index", "DUSTINDX", "dustindex@example.com", "Ivo Lark", "2026-10-22T16:44:00Z", (), None, 0),
    ("Last Lamp", "LASTLAMP", "lastlamp@example.com", "Rhea Doyle", "2026-10-22T16:47:00Z", (), None, 0),
]
GREY_EXTRA = 19
NULL_EXTRA = 18
SEED_USERS = {t[2]: t[3] for t in SEED_TEAMS}
SEED_USERS["teammate@example.com"] = "Imani Frost"
SEED_USERS.update({f"greystatic{i:02d}@example.com": f"Grey Static Player {i:02d}" for i in range(1, GREY_EXTRA + 1)})
SEED_USERS.update({f"nullharbor{i:02d}@example.com": f"Null Harbor Player {i:02d}" for i in range(1, NULL_EXTRA + 1)})
SEED_USERS["solo@example.com"] = "Theo Marsh"
SEED_USER_COUNT = 55
SEED_MEMBERSHIPS = 54
SEED_SOLVES = 41
SEED_SCENARIOS = 8
TEAMMATE_JOINED = "2026-10-22T16:50:00Z"

FAQ_QUESTIONS = [
    "What is Strange & Unusual Activity?", "When does it run?", "How long does it take?",
    "How can I prepare for the simulators?", "How much does it cost?", "How does scoring work?",
    "How do raffle tickets work?", "How is the winner decided?", "What can we win?", "Do I get a certificate?",
    "Who is it for?", "Do I need a team?", "How big can a team be?", "Can I be in more than one team?",
    "Can colleagues from other companies or regions join my team?", "Will my company's name be on the leaderboard?",
    "When are winners announced?",
]
HEADER_ITEMS = ["Learn", "Practice", "Compete", "AI Upskilling", "Education", "Business", "Pricing", "Downtime", "Certifications"]
FOOTER_LINKS = [
    "Hands-on labs", "For Business", "For Education", "Competitive Hacking", "Certifications",
    "About Us", "Newsroom", "Blog", "Glossary", "Work at NightWard", "Careers in Cyber", "Swag Shop", "Community",
    "Privacy Policy", "Terms of Use", "AI Terms of Use", "Acceptable Use Policy", "Cookie Policy",
    "Contact Us", "Affiliates", "Student Discount",
]
PLATFORM_PAGES = ["/hacktivities", "/aisecurity", "/classrooms", "/pricing", "/business", "/certifications", "/about", "/glossary", "/cyber-security-careers", "/community"]
PERK_LINES = ["Junior to manager, anyone can join!", "Put your defensive skills to the test", "Win prizes worth over $40,000", "Earn an official proof of your skill set"]
QUOTES = str.maketrans({"\u2019": "'", "\u2018": "'", "\u201c": '"', "\u201d": '"', "\u00a0": " "})
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def auth(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def get(base: str, path: str, token: str | None = None, params: dict | None = None) -> httpx.Response:
    return httpx.get(base + path, headers=auth(token), params=params, timeout=HTTP_TIMEOUT)


def post(base: str, path: str, body: Any = None, token: str | None = None) -> httpx.Response:
    if body is None:
        return httpx.post(base + path, headers=auth(token), timeout=HTTP_TIMEOUT)
    return httpx.post(base + path, content=json.dumps(body).encode(), timeout=HTTP_TIMEOUT,
                      headers={"Content-Type": "application/json", **auth(token)})


def raw(base: str, method: str, path: str, content: bytes | None = None, **headers: str) -> httpx.Response:
    return httpx.request(method, base + path, content=content, headers=headers, timeout=HTTP_TIMEOUT)


def ok(r: httpx.Response, status: int = 200) -> Any:
    assert r.status_code == status, (r.status_code, r.text[:500])
    return r.json() if r.content else None


def refused(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, (r.status_code, r.text[:500])
    assert r.headers.get("content-type", "").startswith("application/json"), r.headers.get("content-type")
    body = r.json()
    assert body["error"] == code, body
    assert not DRIVER_TEXT.search(r.text), r.text
    return body


def together(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], Any]) -> Any:
        barrier.wait()
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def iso_epoch(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def utc_texts(value: str) -> list[str]:
    moment = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    clock = f"{moment.hour:02d}:{moment.minute:02d} UTC"
    month = MONTHS[moment.month - 1]
    return [f"{moment.day} {month} {moment.year}, {clock}", f"{moment.day:02d} {month} {moment.year}, {clock}"]


@dataclass
class Player:
    email: str
    password: str
    name: str
    id: int
    token: str


def fresh(prefix: str) -> tuple[str, str]:
    token = hashlib.sha1("|".join(unique(prefix)).encode()).hexdigest()[:12]
    return f"{prefix}-{token}@example.com", f"{prefix} {token}"


def team_name() -> str:
    _, tag = fresh("t")
    return f"T {tag.split()[-1]}"


def signup(base: str, prefix: str, name: str | None = None, password: str | None = None) -> Player:
    email, tag = fresh(prefix)
    password = password or f"{tag.split()[-1]}-pw-2026"
    r = post(base, "/api/auth/signup", {"email": email, "display_name": name or tag, "password": password})
    body = ok(r, 201)
    return Player(email, password, body["user"]["display_name"], body["user"]["id"], body["token"])


def crew(base: str, n: int, prefix: str) -> list[Player]:
    return [signup(base, f"{prefix}{i}") for i in range(n)]


def login(base: str, email: str, password: str) -> httpx.Response:
    return post(base, "/api/auth/login", {"email": email, "password": password})


def make_team(base: str, p: Player, name: str | None = None) -> dict:
    return ok(post(base, "/api/teams", {"name": name or team_name()}, p.token), 201)["team"]


def join(base: str, p: Player, code: str) -> httpx.Response:
    return post(base, "/api/teams/join", {"invite_code": code}, p.token)


def squad(base: str, n: int, prefix: str) -> tuple[dict, list[Player]]:
    players = crew(base, n, prefix)
    team = make_team(base, players[0])
    for p in players[1:]:
        ok(join(base, p, team["invite_code"]))
    return team, players


def submit(base: str, p: Player, slug: str, flag: str) -> httpx.Response:
    return post(base, f"/api/scenarios/{slug}/flag", {"flag": flag}, p.token)


def solve(base: str, p: Player, slug: str) -> dict:
    body = ok(submit(base, p, slug, FLAG[slug]))
    assert body["correct"] is True, body
    return body


def me(base: str, p: Player) -> dict:
    return ok(get(base, "/api/me", p.token))


def mine(base: str, p: Player) -> dict:
    return ok(get(base, "/api/teams/mine", p.token))


def remove(base: str, cap: Player, user_id: Any) -> httpx.Response:
    return post(base, f"/api/teams/mine/members/{user_id}/remove", None, cap.token)


def leave(base: str, p: Player) -> httpx.Response:
    return post(base, "/api/teams/leave", None, p.token)


def rotate(base: str, p: Player) -> httpx.Response:
    return post(base, "/api/teams/mine/invite-code", None, p.token)


def finished_team(base: str, p: Player) -> dict:
    team = make_team(base, p)
    for s in SCENARIOS:
        solve(base, p, s["slug"])
    return team


def all_entries(base: str) -> list[dict]:
    out, number = [], 1
    while True:
        body = ok(get(base, "/api/leaderboard", params={"page": number, "limit": LIMIT_CAP}))
        out += body["entries"]
        if number >= body["pages"]:
            return out
        number += 1


def entry_for(base: str, team_id: int) -> dict:
    return next(e for e in all_entries(base) if e["team_id"] == team_id)


@functools.cache
def pg() -> Postgres:
    return Postgres()


def q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def count(where: str) -> int:
    return int(pg().rows(f"select count(*)::int as n from {where}")[0]["n"])


def team_row(team_id: int) -> dict:
    return pg().rows(f"select id, name, invite_code, captain_id from teams where id = {int(team_id)}")[0]


def member_ids(team_id: int) -> set[int]:
    return {r["user_id"] for r in pg().rows(f"select user_id from memberships where team_id = {int(team_id)}")}


def as_json(value: Any) -> dict:
    return json.loads(value) if isinstance(value, str) else value


class Stream:
    def __init__(self, base: str, token: str | None = None) -> None:
        self.base, self.token = base, token
        self.events: queue.Queue = queue.Queue()
        self.ready = threading.Event()
        self.status: int | None = None
        self.response: httpx.Response | None = None

    def __enter__(self) -> "Stream":
        threading.Thread(target=self._run, daemon=True).start()
        assert self.ready.wait(HTTP_TIMEOUT), "stream never answered"
        return self

    def _run(self) -> None:
        try:
            with httpx.stream("GET", self.base + "/api/stream", headers=auth(self.token),
                              timeout=httpx.Timeout(HTTP_TIMEOUT, read=None)) as r:
                self.response, self.status = r, r.status_code
                self.content_type = r.headers.get("content-type", "")
                self.ready.set()
                name, data = "message", []
                for line in r.iter_lines():
                    if line == "":
                        if data:
                            self.events.put((name, "\n".join(data)))
                        name, data = "message", []
                    elif line.startswith(":"):
                        self.events.put((":", line))
                    else:
                        field, _, value = line.partition(":")
                        value = value[1:] if value.startswith(" ") else value
                        if field == "event":
                            name = value
                        elif field == "data":
                            data.append(value)
        except (httpx.HTTPError, RuntimeError):
            pass
        finally:
            self.ready.set()
            self.events.put(None)

    def wait(self, predicate: Callable[[str, str], bool], seconds: float) -> tuple[str, str]:
        deadline = time.monotonic() + seconds
        while (left := deadline - time.monotonic()) > 0:
            try:
                item = self.events.get(timeout=left)
            except queue.Empty:
                break
            if item is None:
                break
            if predicate(*item):
                return item
        raise AssertionError(f"no matching stream event within {seconds}s")

    def wait_closed(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while (left := deadline - time.monotonic()) > 0:
            try:
                if self.events.get(timeout=left) is None:
                    return
            except queue.Empty:
                break
        raise AssertionError(f"stream still open after {seconds}s")

    def __exit__(self, *exc: Any) -> None:
        if self.response is not None:
            with contextlib.suppress(Exception):
                self.response.close()


def score_for(team_id: int) -> Callable[[str, str], bool]:
    return lambda name, data: name == "score" and json.loads(data)["team_id"] == team_id


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def db_target() -> tuple[str, int]:
    parts = urlsplit(os.environ["DATABASE_URL"])
    return parts.hostname or "127.0.0.1", parts.port or 5432


def through(port: int) -> str:
    parts = urlsplit(os.environ["DATABASE_URL"])
    userinfo = parts.netloc.rpartition("@")[0]
    netloc = f"{userinfo}@127.0.0.1:{port}" if userinfo else f"127.0.0.1:{port}"
    return urlunsplit(parts._replace(netloc=netloc))


def pipe(source: socket.socket, sink: socket.socket) -> None:
    try:
        while chunk := source.recv(65536):
            sink.sendall(chunk)
    except OSError:
        pass
    for s in (source, sink):
        with contextlib.suppress(OSError):
            s.shutdown(socket.SHUT_RDWR)


class Relay:

    def __init__(self) -> None:
        self.target = db_target()
        self.port = free_port()
        self.server: socket.socket | None = None
        self.links: list[socket.socket] = []
        self.lock = threading.Lock()

    def open(self) -> None:
        server = socket.socket()
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", self.port))
        server.listen(64)
        self.server = server
        threading.Thread(target=self._accept, args=(server,), daemon=True).start()

    def _accept(self, server: socket.socket) -> None:
        while True:
            try:
                client, _ = server.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.links += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=pipe, args=(a, b), daemon=True).start()

    def cut(self) -> None:
        if self.server is not None:
            with contextlib.suppress(OSError):
                self.server.shutdown(socket.SHUT_RDWR)
            self.server.close()
            self.server = None
        with self.lock:
            links, self.links = self.links, []
        for s in links:
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)
            s.close()


class Instance:

    def __init__(self, database_url: str, **env: str) -> None:
        self.database_url, self.env = database_url, env

    def __enter__(self) -> "Instance":
        manifest = json.loads(Path(DEPLOYED_APP, "run.json").read_text())
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
        env = {**os.environ, "APP_PUBLIC_PORT": str(self.port), "DATABASE_URL": self.database_url, **self.env}
        self.process = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env,
                                        stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
        return self

    def tail(self) -> str:
        self.log.flush()
        return Path(self.log.name).read_bytes()[-4000:].decode(errors="replace")

    def alive(self) -> None:
        assert self.process.poll() is None, f"instance exited:\n{self.tail()}"

    def health(self) -> httpx.Response | None:
        try:
            return httpx.get(self.url + "/api/health", timeout=HTTP_TIMEOUT)
        except httpx.HTTPError:
            return None

    def wait_health(self, status: int, seconds: float) -> httpx.Response:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.alive()
            r = self.health()
            if r is not None and r.status_code == status:
                return r
        raise AssertionError(f"health never answered {status}:\n{self.tail()}")

    def __exit__(self, *exc: Any) -> None:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(self.process.pid, signal.SIGTERM)
        try:
            self.process.wait(HTTP_TIMEOUT)
        except subprocess.TimeoutExpired:
            os.killpg(self.process.pid, signal.SIGKILL)
        self.log.close()


@pytest.fixture(scope="module")
def peer() -> Iterator[str]:
    with Instance(os.environ["DATABASE_URL"]) as instance:
        instance.wait_health(200, BOOT_SECONDS)
        yield instance.url


@contextlib.contextmanager
def visit(browser: Browser, url: str, **options: Any) -> Iterator[Page]:
    with open_app(browser, url, **options) as page:
        page.clock.resume()
        yield page


def page_text(page: Page) -> str:
    return re.sub(r"\s+", " ", page.evaluate("() => document.body.innerText").translate(QUOTES))


def assert_copy(page: Page, *copy: str) -> None:
    """Every line of copy is on the page, allowing UI_WAIT_SECONDS for content the page fills in after load."""
    deadline = time.monotonic() + UI_WAIT_SECONDS
    while True:
        text = page_text(page).casefold()
        missing = [line for line in copy if line.casefold() not in text]
        if not missing or time.monotonic() > deadline:
            break
        page.wait_for_timeout(200)
    assert not missing, missing[0]


def status_region(page: Page, name: str) -> Any:
    return page.get_by_role("status", name=name)


def eventually(page: Page, attempt: Callable[[], None], seconds: float = UI_WAIT_SECONDS) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            attempt()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise


def ready(locator: Locator, seconds: float = EXPECT_SECONDS) -> Locator:
    """The locator once it is visible and enabled, retried through eventually(): `ready(x).focus()`."""
    eventually(locator.page, lambda: (expect(locator).to_be_visible(timeout=STEP_MS),
                                      expect(locator).to_be_enabled(timeout=STEP_MS)), seconds)
    return locator


def holds(page: Page, script: str, arg: Any = None, seconds: float = UI_WAIT_SECONDS) -> None:
    """page.wait_for_function(script, arg) retried through eventually() in short tries until the deadline."""
    def attempt() -> None:
        try:
            page.wait_for_function(script, arg=arg, timeout=STEP_MS)
        except PlaywrightTimeout as error:
            raise AssertionError(f"condition never held: {script}") from error

    eventually(page, attempt, seconds)


def ui_login(page: Page, base: str, p: Player, redirect: str) -> None:
    page.goto(f"{base}/login?redirect={quote(redirect, safe='')}")
    fill(page.get_by_role("textbox", name="Email"), p.email)
    fill(page.get_by_label("Password", exact=True), p.password)
    click(page.get_by_role("button", name="Log in", exact=True))
    target = urlsplit(redirect).path
    page.wait_for_url(lambda u: urlsplit(u).path == target, timeout=UI_WAIT_SECONDS * 1000)


def box(locator: Any) -> dict[str, float]:
    found = locator.bounding_box()
    assert found, locator
    return found


def same_row(a: dict, b: dict) -> bool:
    return abs(a["y"] - b["y"]) <= SUBPIXEL


def word(scope: Any, text: str) -> Any:
    return scope.get_by_text(re.compile(rf"^[\s\u2713\u2714]*{re.escape(text)}$")).first


TICK_JS = """(el, word) => {
  const textNode = root => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) if (n.data.includes(word)) return n; return null; };
  for (let host = el, depth = 0; host && depth < 3; host = host.parentElement, depth++) {
    const t = textNode(host); if (!t) continue;
    const marks = [...host.getElementsByTagName('*')].filter(m => m.getAttribute('aria-hidden') === 'true'
      && !m.contains(t) && (m.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (!marks.length) continue;
    const mark = marks[marks.length - 1];
    const r = document.createRange(); r.setStartAfter(mark); r.setEnd(t, t.data.indexOf(word));
    const glyph = mark.tagName.toLowerCase() === 'svg' || mark.getElementsByTagName('svg').length > 0 || mark.textContent.trim() !== '';
    if (r.toString().trim() === '' && glyph) return true;
  }
  return false;
}"""


def ticked(locator: Any, text: str) -> bool:
    return locator.evaluate(TICK_JS, text)


HOLD_ANIMATIONS = """() => {
  window.__held = [];
  const hold = e => { for (const a of e.target.getAnimations()) if (!window.__held.includes(a)) { a.pause(); window.__held.push(a); } };
  document.addEventListener('animationstart', hold, true);
  document.addEventListener('transitionrun', hold, true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); a.pause(); window.__held.push(a); return a; };
}"""

INFINITE_JS = """() => document.getAnimations().filter(a => a.playState === 'running' && a.effect
  && a.effect.getComputedTiming().iterations === Infinity).map(a => {
    const t = a.effect.target;
    return {text: t ? t.textContent.trim() : '', hidden: !!(t && t.closest('[aria-hidden="true"]'))};
  })"""

ENTERING_JS = """() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target
  && a.effect.getComputedTiming().iterations !== Infinity
  && a.effect.target.getBoundingClientRect().top < innerHeight && a.effect.target.getBoundingClientRect().bottom > 0)
  .map(a => ({ms: a.effect.getComputedTiming().activeDuration,
    moves: a.transitionProperty ? ['transform', 'translate', 'all'].includes(a.transitionProperty)
      : a.effect.getKeyframes().some(k => 'transform' in k || 'translate' in k)}))"""

VIDEO_JS = """() => { const v = document.getElementsByTagName('video')[0]; const t = v.getElementsByTagName('track')[0];
  const s = v.getElementsByTagName('source')[0];
  return {muted: v.muted, loop: v.loop, inline: v.playsInline, poster: v.poster, paused: v.paused,
    src: v.currentSrc || v.src || (s ? s.src : ''), kind: t && t.kind, lang: t && t.srclang, label: t && t.label, track: t && t.src}; }"""


def svg_texts(payload: bytes) -> tuple[Any, list[str]]:
    root = ElementTree.fromstring(payload)
    assert root.tag.rsplit("}", 1)[-1] == "svg", root.tag
    texts = []
    for el in root.iter():
        for value in (el.text, el.tail):
            if value and value.strip():
                texts.append(value.strip())
    return root, texts


def ics_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def check_calendar(payload: bytes, event: dict) -> str:
    assert payload.endswith(b"\r\n")
    lines = payload.split(b"\r\n")[:-1]
    for line in lines:
        assert b"\n" not in line and b"\r" not in line, line
        assert len(line) <= 75, line
    unfolded: list[bytes] = []
    for line in lines:
        if line.startswith(b" "):
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)
    text = [line.decode("utf-8") for line in unfolded]
    for line in text:
        assert re.match(r"^[A-Za-z0-9-]+(;[^:]*)?:", line), line
    assert text[0] == "BEGIN:VCALENDAR" and text[-1] == "END:VCALENDAR"
    assert text.count("BEGIN:VCALENDAR") == 1 and text.count("BEGIN:VEVENT") == 1 and text.count("END:VEVENT") == 1
    assert "VERSION:2.0" in text and any(line.startswith("PRODID:") for line in text)
    body = text[text.index("BEGIN:VEVENT") + 1:text.index("END:VEVENT")]
    props = {line.split(":", 1)[0].split(";", 1)[0]: line.split(":", 1)[1] for line in body}
    assert "DTSTART:20261022T160000Z" in body and "DTEND:20261026T235900Z" in body
    assert re.fullmatch(r"\d{8}T\d{6}Z", props["DTSTAMP"])
    assert props["UID"].strip()
    assert props["SUMMARY"] == ics_escape(event["calendar_title"])
    assert props["DESCRIPTION"] == ics_escape(event["calendar_description"])
    assert "\\," in props["DESCRIPTION"]
    return props["UID"]


def test_deployment_one_origin(browser: Browser, app_url: str, peer: str) -> None:
    page_r = httpx.get(f"{app_url}/downtime", timeout=HTTP_TIMEOUT)
    assert page_r.status_code == 200 and "text/html" in page_r.headers.get("content-type", "")
    assert ok(get(app_url, "/api/health")) == {"status": "ok"}
    assert ok(get(app_url, "/api/event"))["name"] == EVENT_NAME
    cors = httpx.get(f"{app_url}/api/event", headers={"Origin": "http://elsewhere.example"}, timeout=HTTP_TIMEOUT)
    assert "access-control-allow-origin" not in cors.headers
    port = urlsplit(peer).port
    address = socket.gethostbyname(socket.gethostname())
    assert ok(httpx.get(f"http://{address}:{port}/api/health", timeout=HTTP_TIMEOUT)) == {"status": "ok"}
    with visit(browser, f"{app_url}/downtime") as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        eventually(page, lambda: expect(page.get_by_role("table", name="Live Leaderboard")).to_be_visible(timeout=STEP_MS), UI_WAIT_SECONDS)
        api_calls = [u for u in seen if urlsplit(u).path.startswith("/api/")]
        assert api_calls and all(same_origin(u, app_url) for u in api_calls), api_calls


def test_health_readiness(app_url: str) -> None:
    for _ in range(2):
        assert ok(get(app_url, "/api/health")) == {"status": "ok"}
    down = os.environ["APP_POSTGRES_DOWN_URL"].rstrip("/")
    for _ in range(2):
        refused(get(down, "/api/health"), 503, "starting")
    relay = Relay()
    try:
        with Instance(through(relay.port)) as instance:
            first = None
            deadline = time.monotonic() + BOOT_SECONDS
            while first is None and time.monotonic() < deadline:
                instance.alive()
                first = instance.health()
            assert first is not None, instance.tail()
            for _ in range(3):
                refused(instance.health(), 503, "starting")
            relay.open()
            assert instance.wait_health(200, BOOT_SECONDS).json() == {"status": "ok"}
            relay.cut()
            answer = instance.wait_health(503, OUTAGE_SECONDS)
            refused(answer, 503, "unavailable")
            instance.alive()
    finally:
        relay.cut()


def test_outage_from_start(app_url: str) -> None:
    down = os.environ["APP_POSTGRES_DOWN_URL"].rstrip("/")
    email, tag = fresh("down")
    junk = "junk-session-token"
    calls = [
        lambda: get(down, "/api/event"),
        lambda: get(down, "/api/scenarios"),
        lambda: get(down, "/api/scenarios/repossessed"),
        lambda: get(down, "/api/leaderboard"),
        lambda: get(down, "/api/event/calendar.ics"),
        lambda: get(down, "/api/me", junk),
        lambda: get(down, "/api/teams/mine", junk),
        lambda: post(down, "/api/auth/signup", {"email": email, "display_name": tag, "password": "down-pw-2026"}),
        lambda: post(down, "/api/auth/login", {"email": email, "password": "down-pw-2026"}),
        lambda: post(down, "/api/scenarios/day-o/flag", {"flag": WRONG_FLAG}, junk),
        lambda: post(down, "/api/teams/leave", None, junk),
    ]
    for call in calls:
        started = time.monotonic()
        r = call()
        assert time.monotonic() - started <= OUTAGE_SECONDS
        refused(r, 503, "unavailable")
    started = time.monotonic()
    with httpx.stream("GET", f"{down}/api/stream", timeout=HTTP_TIMEOUT) as r:
        assert r.status_code == 503
        assert json.loads(r.read())["error"] == "unavailable"
    assert time.monotonic() - started <= OUTAGE_SECONDS
    assert get(down, "/api/health").status_code == 503
    assert count(f"users where email = {q(email)}") == 0


def test_outage_midrun_and_recovery(app_url: str) -> None:
    relay = Relay()
    relay.open()
    try:
        with Instance(through(relay.port)) as instance:
            instance.wait_health(200, BOOT_SECONDS)
            p = signup(instance.url, "midrun")
            team = make_team(instance.url, p)
            with Stream(instance.url) as stream:
                assert stream.status == 200
                relay.cut()
                for call in (lambda: get(instance.url, "/api/me", p.token),
                             lambda: get(instance.url, "/api/leaderboard"),
                             lambda: submit(instance.url, p, "day-o", WRONG_FLAG)):
                    started = time.monotonic()
                    r = call()
                    assert time.monotonic() - started <= OUTAGE_SECONDS
                    refused(r, 503, "unavailable")
                stream.wait_closed(OUTAGE_SECONDS)
            instance.alive()
            relay.open()
            back = time.monotonic()
            while (r := get(instance.url, "/api/me", p.token)).status_code != 200:
                assert time.monotonic() - back <= RECOVERY_SECONDS, r.text
            assert r.json()["user"]["id"] == p.id
            ok(get(instance.url, "/api/leaderboard"))
            with Stream(instance.url) as stream:
                assert stream.status == 200
                assert time.monotonic() - back <= RECOVERY_SECONDS
                solve(instance.url, p, "day-o")
                stream.wait(score_for(team["id"]), STREAM_SECONDS)
            instance.alive()
    finally:
        relay.cut()


def test_seed_written_once(app_url: str) -> None:
    cap = signup(app_url, "seed")
    team = make_team(app_url, cap)
    rotated = ok(rotate(app_url, cap))["invite_code"]
    with contextlib.ExitStack() as stack:
        first = stack.enter_context(Instance(os.environ["DATABASE_URL"]))
        second = stack.enter_context(Instance(os.environ["DATABASE_URL"]))
        first.wait_health(200, BOOT_SECONDS)
        second.wait_health(200, BOOT_SECONDS)
    assert team_row(team["id"])["invite_code"] == rotated
    assert pg().rows(f"select display_name from users where id = {cap.id}") == [{"display_name": cap.name}]
    emails = ", ".join(q(e) for e in SEED_USERS)
    users = pg().rows(f"select email, display_name from users where email in ({emails})")
    assert len(users) == SEED_USER_COUNT and {u["email"]: u["display_name"] for u in users} == SEED_USERS
    assert count(f"memberships m join users u on u.id = m.user_id where u.email in ({emails})") == SEED_MEMBERSHIPS
    assert count(f"completions c join users u on u.id = c.user_id where u.email in ({emails})") == SEED_SOLVES
    assert count(f"completions c join users u on u.id = c.user_id join team_solves ts on ts.user_id = c.user_id "
                 f"and ts.scenario_slug = c.scenario_slug and ts.created_at = c.created_at where u.email in ({emails})") == SEED_SOLVES
    assert count(f"webinar_claims w join users u on u.id = w.user_id where u.email in ({emails})") == 0
    names = ", ".join(q(t[0]) for t in SEED_TEAMS)
    rows = pg().rows(f"select t.name, t.invite_code, extract(epoch from t.created_at)::float8 as created, u.email as captain "
                     f"from teams t left join users u on u.id = t.captain_id where t.name in ({names})")
    assert len(rows) == len(SEED_TEAMS)
    teams = {r["name"]: r for r in rows}
    total_solves = 0
    for name, code, captain, _, created, solved, last, points in SEED_TEAMS:
        row = teams[name]
        assert (row["invite_code"], row["captain"], row["created"]) == (code, captain, iso_epoch(created)), name
        solves = pg().rows(f"select ts.scenario_slug, extract(epoch from ts.created_at)::float8 as at, u.email from team_solves ts "
                           f"join teams t on t.id = ts.team_id join users u on u.id = ts.user_id where t.name = {q(name)} order by ts.created_at")
        expected = [(SCENARIOS[n - 1]["slug"], iso_epoch(last) - (len(solved) - 1 - i) * HOUR_SECONDS, captain)
                    for i, n in enumerate(solved)]
        assert [(s["scenario_slug"], s["at"], s["email"]) for s in solves] == expected, name
        assert sum(SCENARIOS[n - 1]["points"] for n in solved) == points
        total_solves += len(solved)
        joined = pg().rows(f"select extract(epoch from m.joined_at)::float8 as at from memberships m join users u on u.id = m.user_id where u.email = {q(captain)}")
        assert joined == [{"at": iso_epoch(created)}], name
    assert total_solves == SEED_SOLVES
    grey = pg().rows("select u.email, extract(epoch from m.joined_at)::float8 as at from memberships m join users u on u.id = m.user_id "
                     "join teams t on t.id = m.team_id where t.name = 'Grey Static' and u.email like 'greystatic%' order by u.email")
    assert [g["at"] for g in grey] == [iso_epoch(SEED_TEAMS[1][4]) + i * MINUTE_SECONDS for i in range(1, GREY_EXTRA + 1)]
    mate = pg().rows("select extract(epoch from m.joined_at)::float8 as at from memberships m join users u on u.id = m.user_id where u.email = 'teammate@example.com'")
    assert mate == [{"at": iso_epoch(TEAMMATE_JOINED)}]
    assert count("memberships m join users u on u.id = m.user_id where u.email = 'solo@example.com'") == 0
    assert count("scenarios") == SEED_SCENARIOS


def test_shared_state_across_instances(app_url: str, peer: str) -> None:
    tables = {t.split(".")[-1] for t in pg().tables()}
    assert {"users", "login_attempts", "teams", "memberships", "scenarios", "completions", "team_solves", "flag_attempts", "webinar_claims"} <= tables
    team, (p,) = squad(app_url, 1, "shared")
    assert ok(get(peer, "/api/me", p.token))["user"]["id"] == p.id
    for _ in range(WRONG_FLAG_LIMIT):
        assert ok(submit(app_url, p, "day-o", WRONG_FLAG))["correct"] is False
    refused(submit(peer, p, "day-o", FLAG["day-o"]), 429, "too_many_attempts")
    for _ in range(SIGN_IN_LIMIT):
        refused(login(app_url, p.email, p.password + "-wrong"), 401, "invalid_credentials")
    refused(login(peer, p.email, p.password), 429, "too_many_attempts")
    solve(app_url, p, "dead-endpoint")
    room = mine(peer, p)
    assert room["score"] == BY_SLUG["dead-endpoint"]["points"]
    assert next(s for s in room["scenarios"] if s["slug"] == "dead-endpoint")["team_solved"] is True
    assert count(f"team_solves where team_id = {team['id']} and scenario_slug = 'dead-endpoint'") == 1


def test_signup(app_url: str) -> None:
    email, tag = fresh("signup")
    r = post(app_url, "/api/auth/signup", {"email": f"  {email.upper()} ", "display_name": f"  {tag} ", "password": "signup-pw-2026"})
    body = ok(r, 201)
    assert "no-store" in r.headers.get("cache-control", "")
    assert set(body["user"]) == {"id", "email", "display_name"} and isinstance(body["user"]["id"], int)
    assert body["user"]["email"] == email and body["user"]["display_name"] == tag
    assert ok(get(app_url, "/api/me", body["token"]))["user"]["id"] == body["user"]["id"]
    assert pg().rows(f"select email, display_name from users where lower(email) = {q(email)}") == [{"email": email, "display_name": tag}]
    refused(post(app_url, "/api/auth/signup", {"email": email.title(), "display_name": "Other", "password": "other-pw-2026"}), 409, "email_taken")
    assert pg().rows(f"select display_name from users where lower(email) = {q(email)}") == [{"display_name": tag}]
    for field, change in (("email", {"email": "no-at-sign"}), ("display_name", {"display_name": "   "}),
                          ("password", {"password": 12345678}), ("email", {"email": None})):
        other, other_tag = fresh("signup-bad")
        payload = {"email": other, "display_name": other_tag, "password": "signup-pw-2026", **change}
        if payload["email"] is None:
            del payload["email"]
        assert field in refused(post(app_url, "/api/auth/signup", payload), 400, "validation")["fields"]
        assert count(f"users where email = {q(other)}") == 0


def long_email(length: int) -> str:
    email, _ = fresh("len")
    local = email.split("@")[0]
    return f"{local}@" + "d" * (length - len(local) - 1 - len(".com")) + ".com"


def test_account_field_limits(app_url: str) -> None:
    accepted = [("display_name", "\U0001F987" * NAME_MAX), ("email", long_email(EMAIL_MAX)),
                ("password", "\U0001F987" * PASSWORD_MAX), ("password", "p" * PASSWORD_MIN)]
    rejected = [("display_name", "\U0001F987" * (NAME_MAX + 1)), ("display_name", "moth\u202ename"), ("display_name", "moth\u0007"),
                ("display_name", "moth\u0085"), ("display_name", "moth\u2066x"), ("display_name", "\u061cmoth"),
                ("display_name", "moth\u200e"), ("email", long_email(EMAIL_MAX + 1)), ("email", "a@@b.example"),
                ("email", "moth@nodot"), ("email", "mo th@x.example"), ("email", "a@"),
                ("password", "\U0001F987" * (PASSWORD_MAX + 1)), ("password", "p" * (PASSWORD_MIN - 1)),
                ("password", "pass\u0000word")]
    for field, value in accepted:
        email, tag = fresh("limit-ok")
        payload = {"email": email, "display_name": tag, "password": "limit-pw-2026", field: value}
        body = ok(post(app_url, "/api/auth/signup", payload), 201)
        if field != "password":
            assert body["user"][field] == value
        assert ok(login(app_url, payload["email"], payload["password"]))["user"]["id"] == body["user"]["id"]
    for field, value in rejected:
        email, tag = fresh("limit-bad")
        payload = {"email": email, "display_name": tag, "password": "limit-pw-2026", field: value}
        assert field in refused(post(app_url, "/api/auth/signup", payload), 400, "validation")["fields"], (field, value)
        assert count(f"users where email = {q(payload['email'].strip().lower())}") == 0


def test_passwords_exact_and_hidden(app_url: str) -> None:
    head = "m" * BCRYPT_BYTES
    secret = head + "-first"
    p = signup(app_url, "pw", password=secret)
    refused(login(app_url, p.email, head + "-other"), 401, "invalid_credentials")
    signed = login(app_url, p.email, secret)
    ok(signed)
    spaced = signup(app_url, "pw-space", password="  spaced-pw-2026  ")
    refused(login(app_url, spaced.email, "spaced-pw-2026"), 401, "invalid_credentials")
    ok(login(app_url, spaced.email, "  spaced-pw-2026  "))
    twin = signup(app_url, "pw-twin", password=secret)
    rows = [as_json(r["row"]) for r in pg().rows(f"select row_to_json(u) as row from users u where u.id in ({p.id}, {twin.id}) order by u.id")]
    stored = [json.dumps(r) for r in rows]
    for text in stored:
        assert secret not in text and hashlib.sha256(secret.encode()).hexdigest() not in text
    extra = set(rows[0]) - {"id", "email", "display_name", "created_at"}
    assert [k for k in extra if rows[0][k] != rows[1][k]], rows
    hashes = [str(rows[0][k]) for k in extra if rows[0][k]]
    for r in (signed, get(app_url, "/api/me", p.token)):
        assert secret not in r.text and not any(h in r.text for h in hashes if len(h) > 8)


def test_signup_race(app_url: str, peer: str) -> None:
    email, tag = fresh("race")
    variants = [email, email.upper(), f"  {email} ", email.title(), f"\t{email.upper()}", email.capitalize()]
    calls = [functools.partial(post, (app_url, peer)[i % 2], "/api/auth/signup",
                               {"email": v, "display_name": f"{tag} {i}", "password": f"race-pw-{i}-2026"})
             for i, v in enumerate(variants)]
    results = together(*calls)
    winners = [i for i, r in enumerate(results) if r.status_code == 201]
    assert len(winners) == 1, [(r.status_code, r.text[:200]) for r in results]
    for i, r in enumerate(results):
        if i not in winners:
            refused(r, 409, "email_taken")
            assert "token" not in r.text
    win = winners[0]
    assert pg().rows(f"select display_name from users where lower(email) = {q(email)}") == [{"display_name": f"{tag} {win}"}]
    assert ok(get(peer, "/api/me", results[win].json()["token"]))["user"]["email"] == email
    ok(login(app_url, email, f"race-pw-{win}-2026"))
    for i in range(len(variants)):
        if i != win:
            refused(login(app_url, email, f"race-pw-{i}-2026"), 401, "invalid_credentials")


def test_login_logout(app_url: str, peer: str) -> None:
    p = signup(app_url, "login")
    r = login(app_url, f" {p.email.upper()} ", p.password)
    body = ok(r)
    assert set(body) >= {"token", "user"} and body["user"]["id"] == p.id
    assert "no-store" in r.headers.get("cache-control", "")
    wrong = login(app_url, p.email, p.password + "-wrong")
    unknown = login(app_url, fresh("nobody")[0], p.password)
    refused(wrong, 401, "invalid_credentials")
    refused(unknown, 401, "invalid_credentials")
    assert wrong.json() == unknown.json()
    token = body["token"]
    assert ok(get(peer, "/api/me", token))["user"]["id"] == p.id
    assert post(app_url, "/api/auth/logout", None, token).status_code == 204
    refused(get(app_url, "/api/me", token), 401, "unauthenticated")
    refused(get(peer, "/api/me", token), 401, "unauthenticated")
    assert ok(get(peer, "/api/me", p.token))["user"]["id"] == p.id


def throttle_shape(r: httpx.Response) -> tuple:
    return r.status_code, r.json(), sorted(k for k in r.headers if k not in ("date", "content-length")), "retry-after" in r.headers


def test_sign_in_throttle(app_url: str) -> None:
    p = signup(app_url, "throttle")
    bystander = signup(app_url, "throttle-by")
    for _ in range(SIGN_IN_LIMIT - 1):
        refused(login(app_url, p.email, p.password + "-wrong"), 401, "invalid_credentials")
    ok(login(app_url, p.email, p.password))
    known = [login(app_url, p.email, p.password + "-wrong") for _ in range(SIGN_IN_LIMIT)]
    for r in known:
        refused(r, 401, "invalid_credentials")
    locked = login(app_url, p.email, p.password + "-wrong")
    refused(locked, 429, "too_many_attempts")
    assert 1 <= int(locked.headers["retry-after"]) <= DEFAULT_SIGN_IN_LOCK
    refused(login(app_url, p.email, p.password), 429, "too_many_attempts")
    refused(post(app_url, "/api/auth/login", {"email": p.email, "password": "   "}), 400, "validation")
    assert count(f"login_attempts where email = {q(p.email)}") == 2 * SIGN_IN_LIMIT
    assert count(f"login_attempts where email = {q(p.email)} and succeeded") == 1
    ghost = fresh("ghost")[0]
    unknown = [login(app_url, ghost.upper(), p.password) for _ in range(SIGN_IN_LIMIT)]
    ghost_locked = login(app_url, ghost, p.password)
    refused(ghost_locked, 429, "too_many_attempts")
    assert throttle_shape(unknown[0]) == throttle_shape(known[0])
    assert throttle_shape(ghost_locked) == throttle_shape(locked)
    assert count(f"login_attempts where email = {q(ghost)}") == SIGN_IN_LIMIT
    ok(login(app_url, bystander.email, bystander.password))


def test_sign_in_throttle_burst(app_url: str, peer: str) -> None:
    p = signup(app_url, "burst")
    burst = SIGN_IN_LIMIT + 6
    results = together(*[functools.partial(login, (app_url, peer)[i % 2], p.email, p.password + "-wrong") for i in range(burst)])
    statuses = sorted(r.status_code for r in results)
    assert statuses.count(401) == SIGN_IN_LIMIT and statuses.count(429) == burst - SIGN_IN_LIMIT, statuses
    assert count(f"login_attempts where email = {q(p.email)}") == SIGN_IN_LIMIT


def test_sign_in_lock_expires(app_url: str) -> None:
    with Instance(os.environ["DATABASE_URL"], SIGN_IN_LOCK_SECONDS=str(SHORT_LOCK_SECONDS)) as instance:
        instance.wait_health(200, BOOT_SECONDS)
        p = signup(instance.url, "lockout")
        for _ in range(SIGN_IN_LIMIT):
            refused(login(instance.url, p.email, p.password + "-wrong"), 401, "invalid_credentials")
        tenth = time.monotonic()
        r = login(instance.url, p.email, p.password + "-wrong")
        refused(r, 429, "too_many_attempts")
        assert 1 <= int(r.headers["retry-after"]) <= SHORT_LOCK_SECONDS
        while (r := login(instance.url, p.email, p.password + "-wrong")).status_code == 429:
            assert time.monotonic() - tenth <= SHORT_LOCK_SECONDS + OUTAGE_SECONDS, r.text
        refused(r, 401, "invalid_credentials")
        assert time.monotonic() - tenth >= SHORT_LOCK_SECONDS - 1
        for _ in range(SIGN_IN_LIMIT - 1):
            refused(login(instance.url, p.email, p.password + "-wrong"), 401, "invalid_credentials")
        refused(login(instance.url, p.email, p.password), 429, "too_many_attempts")


def test_return_address(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "return")
    accepted = {"/downtime?board=2#webinar": ("/downtime", "board=2", "webinar"), "/glossary#top": ("/glossary", "", "top")}
    rejected = ["https://evil.example/glossary", "/" + "/evil.example/glossary", "/\\evil.example/glossary", "/glossary\\x",
                "javascript:alert(1)", "/glossary two", "\\\\evil.example", "glossary", "/glossary\x85", "/downtime\x9b"]
    for value, (path, query, fragment) in accepted.items():
        with visit(browser, f"{app_url}/downtime") as page:
            ui_login(page, app_url, p, value)
            parts = urlsplit(page.url)
            assert same_origin(page.url, app_url) and (parts.path, parts.query, parts.fragment) == (path, query, fragment)
    for value in rejected:
        with visit(browser, f"{app_url}/downtime") as page:
            page.goto(f"{app_url}/login?redirect={quote(value, safe='')}")
            fill(page.get_by_role("textbox", name="Email"), p.email)
            fill(page.get_by_label("Password", exact=True), p.password)
            click(page.get_by_role("button", name="Log in", exact=True))
            page.wait_for_url(lambda u: same_origin(u, app_url) and urlsplit(u).path == "/downtime", timeout=UI_WAIT_SECONDS * 1000)
    email, tag = fresh("return-up")
    with visit(browser, f"{app_url}/signup?redirect={quote('/glossary?x=1#top', safe='')}") as page:
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_role("textbox", name="Display name"), tag)
        fill(page.get_by_label("Password", exact=True), "return-pw-2026")
        click(page.get_by_role("button", name="Create account"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/glossary", timeout=UI_WAIT_SECONDS * 1000)
        assert urlsplit(page.url).query == "x=1" and urlsplit(page.url).fragment == "top"


def test_signed_out_refused(app_url: str) -> None:
    junk = "junk-session-token"
    calls = [
        lambda t: get(app_url, "/api/me", t), lambda t: get(app_url, "/api/teams/mine", t),
        lambda t: get(app_url, "/api/me/certificate", t), lambda t: get(app_url, "/api/me/certificate/image", t),
        lambda t: post(app_url, "/api/auth/logout", None, t), lambda t: post(app_url, "/api/teams/leave", None, t),
        lambda t: post(app_url, "/api/teams/mine/invite-code", None, t), lambda t: post(app_url, "/api/teams/mine/members/1/remove", None, t),
        lambda t: post(app_url, "/api/teams", {"name": team_name()}, t), lambda t: post(app_url, "/api/teams/join", {"invite_code": "COLDLEDG"}, t),
        lambda t: post(app_url, "/api/scenarios/day-o/flag", {"flag": FLAG["day-o"]}, t), lambda t: post(app_url, "/api/webinar/flag", {"flag": WEBINAR_FLAG}, t),
    ]
    for call in calls:
        for token in (None, junk):
            refused(call(token), 401, "unauthenticated")
    p = signup(app_url, "cache")
    for path in ("/api/me", "/api/teams/mine", "/api/leaderboard", "/api/event", "/api/scenarios"):
        r = get(app_url, path, p.token)
        assert "no-store" in r.headers.get("cache-control", ""), path
    other = signup(app_url, "cache-other")
    team = make_team(app_url, other)
    make_team(app_url, p)
    assert mine(app_url, p)["team"]["id"] != team["id"]


def test_captain_only(app_url: str) -> None:
    team, (cap, member, third) = squad(app_url, 3, "captain")
    outsider_team, (outsider,) = squad(app_url, 1, "captain-out")
    refused(remove(app_url, member, third.id), 403, "not_captain")
    refused(rotate(app_url, member), 403, "not_captain")
    refused(remove(app_url, member, "9" * 25), 403, "not_captain")
    refused(remove(app_url, cap, outsider.id), 404, "not_a_member")
    refused(remove(app_url, cap, 999999999), 404, "not_a_member")
    refused(remove(app_url, cap, cap.id), 409, "captain_cannot_remove_self")
    assert member_ids(team["id"]) == {cap.id, member.id, third.id}
    assert member_ids(outsider_team["id"]) == {outsider.id}
    assert team_row(team["id"])["invite_code"] == team["invite_code"]
    assert team_row(team["id"])["captain_id"] == cap.id


def test_field_projection(app_url: str) -> None:
    team, (cap, member) = squad(app_url, 2, "project")
    r = get(app_url, "/api/teams/mine", member.token)
    body = r.json()
    assert set(body["team"]) == {"id", "name", "invite_code", "captain_id"}
    for m in body["members"]:
        assert set(m) == {"user_id", "display_name", "joined_at", "is_captain", "tickets"}
    assert "email" not in r.text and cap.email not in r.text and member.email not in r.text
    with Stream(app_url) as stream:
        solve(app_url, member, "day-o")
        _, data = stream.wait(score_for(team["id"]), STREAM_SECONDS)
        assert set(json.loads(data)) == {"team_id", "team_name", "scenario_slug", "points", "team_score"}
        new_code = ok(rotate(app_url, cap))["invite_code"]
        _, data = stream.wait(lambda n, d: n == "team" and json.loads(d).get("team_id") == team["id"], STREAM_SECONDS)
        assert json.loads(data) == {"team_id": team["id"]}
    board = get(app_url, "/api/leaderboard", params={"include_feed": 1, "limit": LIMIT_CAP})
    for e in board.json()["entries"]:
        assert set(e) == {"rank", "team_id", "team_name", "soc_sim", "th_sim", "tabletop", "challenges_solved", "challenges_total", "points"}
    for item in board.json()["feed"]:
        assert set(item) == {"team_name", "scenario_title", "points", "created_at"}
    for text in (board.text, data):
        assert new_code not in text and team["invite_code"] not in text and member.email not in text and "user_id" not in text


def test_captaincy_races(app_url: str, peer: str) -> None:
    team, (cap, other) = squad(app_url, 2, "race-two")
    results = together(lambda: leave(app_url, cap), lambda: leave(peer, other))
    assert [r.status_code for r in results] == [204, 204]
    assert team_row(team["id"])["captain_id"] is None and member_ids(team["id"]) == set()
    team, (cap, first, third) = squad(app_url, 3, "race-three")
    results = together(lambda: leave(app_url, cap), lambda: leave(peer, first))
    assert [r.status_code for r in results] == [204, 204]
    assert team_row(team["id"])["captain_id"] == third.id and member_ids(team["id"]) == {third.id}
    assert mine(peer, third)["team"]["captain_id"] == third.id
    team, (cap, member) = squad(app_url, 2, "race-remove")
    removal, departure = together(lambda: remove(app_url, cap, member.id), lambda: leave(peer, member))
    code = team_row(team["id"])["invite_code"]
    if removal.status_code == 204:
        refused(departure, 409, "not_in_team")
        assert code != team["invite_code"]
    else:
        refused(removal, 404, "not_a_member")
        assert departure.status_code == 204 and code == team["invite_code"]
    assert member_ids(team["id"]) == {cap.id} and team_row(team["id"])["captain_id"] == cap.id
    team, (cap,) = squad(app_url, 1, "race-empty")
    assert leave(app_url, cap).status_code == 204
    joiners = crew(app_url, 3, "race-join")
    results = together(*[functools.partial(join, base, j, team["invite_code"]) for j, base in zip(joiners, (app_url, peer, app_url))])
    assert [r.status_code for r in results] == [200, 200, 200]
    captain_id = team_row(team["id"])["captain_id"]
    assert captain_id in {j.id for j in joiners}
    for j in joiners:
        assert [m["user_id"] for m in mine(app_url, j)["members"] if m["is_captain"]] == [captain_id]


def test_create_team(app_url: str) -> None:
    p, q1, q2, other = crew(app_url, 4, "create")
    name = team_name()
    r = post(app_url, "/api/teams", {"name": f"  {name}  "}, p.token)
    team = ok(r, 201)["team"]
    assert set(team) == {"id", "name", "invite_code", "captain_id"} and team["name"] == name and team["captain_id"] == p.id
    assert re.fullmatch(r"[A-Z0-9]{8}", team["invite_code"])
    assert me(app_url, p)["team"] == {"id": team["id"], "name": name, "invite_code": team["invite_code"], "is_captain": True}
    assert team_row(team["id"])["captain_id"] == p.id and member_ids(team["id"]) == {p.id}
    refused(post(app_url, "/api/teams", {"name": name.lower()}, other.token), 409, "name_taken")
    refused(post(app_url, "/api/teams", {"name": team_name()}, p.token), 409, "already_in_team")
    for bad in ("ab", "x" * 25, "bad!name", "caf\u00e9 team", "   "):
        assert "name" in refused(post(app_url, "/api/teams", {"name": bad}, other.token), 400, "validation")["fields"]
    assert me(app_url, other)["team"] is None
    ok(post(app_url, "/api/teams", {"name": "a-_" + team_name()[-21:]}, other.token), 201)
    contested = team_name()
    results = together(lambda: post(app_url, "/api/teams", {"name": contested}, q1.token),
                       lambda: post(app_url, "/api/teams", {"name": contested.upper()}, q2.token))
    statuses = sorted(r.status_code for r in results)
    assert statuses == [201, 409], statuses
    refused(next(r for r in results if r.status_code == 409), 409, "name_taken")
    assert count(f"teams where lower(name) = {q(contested.lower())}") == 1


def test_join_by_code(app_url: str) -> None:
    team, (cap,) = squad(app_url, 1, "join")
    joiner, late, other_cap = crew(app_url, 3, "join-p")
    body = ok(join(app_url, joiner, f" {team['invite_code'].lower()} "))
    assert body["team"]["id"] == team["id"] and set(body["team"]) == {"id", "name", "invite_code", "captain_id"}
    assert member_ids(team["id"]) == {cap.id, joiner.id}
    other = make_team(app_url, other_cap)
    refused(join(app_url, joiner, other["invite_code"]), 409, "already_in_team")
    refused(join(app_url, late, "QZQZ0909"), 404, "unknown_invite_code")
    assert "invite_code" in refused(join(app_url, late, "   "), 400, "validation")["fields"]
    old = team["invite_code"]
    ok(rotate(app_url, cap))
    refused(join(app_url, late, old), 404, "unknown_invite_code")
    assert me(app_url, late)["team"] is None and member_ids(other["id"]) == {other_cap.id}


def test_team_cap(app_url: str) -> None:
    team, members = squad(app_url, TEAM_CAP - 1, "cap")
    racers = crew(app_url, 4, "cap-race")
    results = together(*[functools.partial(join, app_url, r, team["invite_code"]) for r in racers])
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409]
    for r in results:
        if r.status_code == 409:
            refused(r, 409, "team_full")
    assert len(member_ids(team["id"])) == TEAM_CAP
    late = signup(app_url, "cap-late")
    refused(join(app_url, late, team["invite_code"]), 409, "team_full")
    assert len(member_ids(team["id"])) == TEAM_CAP and me(app_url, late)["team"] is None


def test_team_room_data(app_url: str) -> None:
    team, (cap, a, b) = squad(app_url, 3, "room")
    ok(post(app_url, "/api/webinar/flag", {"flag": WEBINAR_FLAG}, a.token))
    solve(app_url, a, "day-o")
    assert ok(submit(app_url, b, "dead-endpoint", WRONG_FLAG))["correct"] is False
    body = mine(app_url, b)
    assert set(body) == {"team", "members", "score", "scenarios"}
    assert body["team"]["id"] == team["id"] and body["team"]["captain_id"] == cap.id
    members = body["members"]
    assert [m["user_id"] for m in members] == [cap.id, a.id, b.id]
    assert all(ISO_RE.match(m["joined_at"]) for m in members)
    joined = [iso_epoch(m["joined_at"]) for m in members]
    assert joined == sorted(joined)
    assert {m["user_id"]: m["tickets"] for m in members} == {cap.id: 0, a.id: 1 + WEBINAR_TICKETS, b.id: 0}
    assert [m["is_captain"] for m in members] == [True, False, False]
    assert [m["display_name"] for m in members] == [cap.name, a.name, b.name]
    assert body["score"] == BY_SLUG["day-o"]["points"]
    states = body["scenarios"]
    assert [s["slug"] for s in states] == [s["slug"] for s in SCENARIOS]
    by = {s["slug"]: s for s in states}
    assert by["day-o"] == {"slug": "day-o", "team_solved": True, "solved_by_me": False, "attempted_by_me": False}
    assert by["dead-endpoint"]["attempted_by_me"] is True and by["dead-endpoint"]["team_solved"] is False
    assert next(s for s in mine(app_url, a)["scenarios"] if s["slug"] == "day-o")["solved_by_me"] is True
    loner = signup(app_url, "room-loner")
    refused(get(app_url, "/api/teams/mine", loner.token), 404, "not_in_team")


def test_leaving_team(app_url: str) -> None:
    team, (cap, first, second) = squad(app_url, 3, "leave")
    solve(app_url, cap, "repossessed")
    assert leave(app_url, cap).status_code == 204
    assert team_row(team["id"])["captain_id"] == first.id
    room = mine(app_url, second)
    assert room["score"] == BY_SLUG["repossessed"]["points"] and room["team"]["captain_id"] == first.id
    assert [m["user_id"] for m in room["members"] if m["is_captain"]] == [first.id]
    status = me(app_url, cap)
    assert status["team"] is None and status["tickets"] == 1 and status["completions"] == ["repossessed"]
    fresh_team = make_team(app_url, cap)
    body = ok(submit(app_url, cap, "repossessed", FLAG["repossessed"]))
    assert body["correct"] is True and body["already_completed"] is True
    assert body["team_points_awarded"] == 0 and body["ticket_awarded"] is False
    assert mine(app_url, cap)["score"] == 0
    assert count(f"team_solves where team_id = {fresh_team['id']}") == 0
    assert entry_for(app_url, team["id"])["points"] == BY_SLUG["repossessed"]["points"]


def test_invite_rotation(app_url: str) -> None:
    team, (cap, member, stayer) = squad(app_url, 3, "rotate")
    outsider, second, third = crew(app_url, 3, "rotate-out")
    old = team["invite_code"]
    new = ok(rotate(app_url, cap))
    assert set(new) == {"invite_code"} and new["invite_code"] != old and re.fullmatch(r"[A-Z0-9]{8}", new["invite_code"])
    assert team_row(team["id"])["invite_code"] == new["invite_code"]
    refused(join(app_url, outsider, old), 404, "unknown_invite_code")
    assert remove(app_url, cap, member.id).status_code == 204
    after_removal = team_row(team["id"])["invite_code"]
    assert after_removal != new["invite_code"]
    refused(join(app_url, second, new["invite_code"]), 404, "unknown_invite_code")
    refused(join(app_url, member, new["invite_code"]), 404, "unknown_invite_code")
    assert leave(app_url, stayer).status_code == 204
    assert team_row(team["id"])["invite_code"] == after_removal
    ok(join(app_url, third, after_removal.lower()))
    assert member_ids(team["id"]) == {cap.id, third.id}


def test_removal_immediate(app_url: str, peer: str) -> None:
    team, (cap, member) = squad(app_url, 2, "removed")
    solve(app_url, member, "day-o")
    assert remove(app_url, cap, member.id).status_code == 204
    assert ok(get(peer, "/api/me", member.token))["team"] is None
    refused(get(peer, "/api/teams/mine", member.token), 404, "not_in_team")
    refused(submit(app_url, member, "dead-endpoint", FLAG["dead-endpoint"]), 409, "no_team")
    status = me(app_url, member)
    assert status["tickets"] == 1 and status["completions"] == ["day-o"]
    assert mine(app_url, cap)["score"] == BY_SLUG["day-o"]["points"]
    assert count(f"completions where user_id = {member.id}") == 1
    assert count(f"flag_attempts where user_id = {member.id} and scenario_slug = 'dead-endpoint'") == 0
    make_team(app_url, member)
    assert me(app_url, member)["team"]["is_captain"] is True


def test_emptied_team(app_url: str) -> None:
    team, (cap,) = squad(app_url, 1, "empty")
    solve(app_url, cap, "the-waiting-room")
    assert leave(app_url, cap).status_code == 204
    assert team_row(team["id"])["captain_id"] is None and member_ids(team["id"]) == set()
    entry = entry_for(app_url, team["id"])
    assert entry["points"] == BY_SLUG["the-waiting-room"]["points"] and entry["team_name"] == team["name"]
    newcomer, rival = crew(app_url, 2, "empty-p")
    refused(post(app_url, "/api/teams", {"name": team["name"].upper()}, rival.token), 409, "name_taken")
    body = ok(join(app_url, newcomer, team["invite_code"]))
    assert body["team"]["captain_id"] == newcomer.id
    assert me(app_url, newcomer)["team"]["is_captain"] is True and team_row(team["id"])["captain_id"] == newcomer.id


def test_flag_matching(app_url: str) -> None:
    team, (p,) = squad(app_url, 1, "match")
    wrong_case = ok(submit(app_url, p, "repossessed", FLAG["repossessed"].upper()))
    assert wrong_case["correct"] is False
    for s in SCENARIOS:
        body = ok(submit(app_url, p, s["slug"], f"  {s['flag']}\t"))
        assert body["correct"] is True and body["already_completed"] is False, s["slug"]
    assert mine(app_url, p)["score"] == sum(s["points"] for s in SCENARIOS)
    before = count(f"flag_attempts where user_id = {p.id}")
    assert "flag" in refused(submit(app_url, p, "day-o", "   "), 400, "validation")["fields"]
    assert "flag" in refused(submit(app_url, p, "no-such-scenario", ""), 400, "validation")["fields"]
    refused(submit(app_url, p, "no-such-scenario", FLAG["day-o"]), 404, "unknown_scenario")
    assert count(f"flag_attempts where user_id = {p.id}") == before
    loner = signup(app_url, "match-loner")
    refused(submit(app_url, loner, "day-o", FLAG["day-o"]), 409, "no_team")
    assert count(f"flag_attempts where user_id = {loner.id}") == 0 and count(f"completions where user_id = {loner.id}") == 0


def test_team_credit_once(app_url: str) -> None:
    team, (p, mate) = squad(app_url, 2, "credit")
    wrong = ok(submit(app_url, p, "dead-endpoint", WRONG_FLAG))
    assert wrong["correct"] is False and wrong["team_points_awarded"] == 0 and wrong["ticket_awarded"] is False
    body = solve(app_url, p, "dead-endpoint")
    points = BY_SLUG["dead-endpoint"]["points"]
    assert set(body) == {"correct", "already_completed", "team_points_awarded", "ticket_awarded", "team_score", "tickets"}
    assert body == {"correct": True, "already_completed": False, "team_points_awarded": points,
                    "ticket_awarded": True, "team_score": points, "tickets": 1}
    rows = pg().rows(f"select user_id from team_solves where team_id = {team['id']} and scenario_slug = 'dead-endpoint'")
    assert rows == [{"user_id": p.id}]
    assert count(f"flag_attempts where user_id = {p.id} and correct") == 1
    assert count(f"flag_attempts where user_id = {p.id} and not correct") == 1


def test_personal_tickets(app_url: str) -> None:
    team, (p, mate) = squad(app_url, 2, "tickets")
    solve(app_url, p, "handbook-for-the-recently-compromised")
    later = solve(app_url, mate, "handbook-for-the-recently-compromised")
    points = BY_SLUG["handbook-for-the-recently-compromised"]["points"]
    assert later["team_points_awarded"] == 0 and later["ticket_awarded"] is True and later["team_score"] == points and later["tickets"] == 1
    before = count(f"flag_attempts where user_id = {p.id}")
    repeat = ok(submit(app_url, p, "handbook-for-the-recently-compromised", FLAG["handbook-for-the-recently-compromised"]))
    assert repeat["correct"] is True and repeat["already_completed"] is True
    assert repeat["team_points_awarded"] == 0 and repeat["ticket_awarded"] is False and repeat["tickets"] == 1
    assert count(f"flag_attempts where user_id = {p.id}") == before
    assert count(f"completions where scenario_slug = 'handbook-for-the-recently-compromised' and user_id in ({p.id}, {mate.id})") == 2
    assert count(f"team_solves where team_id = {team['id']}") == 1
    assert {m["user_id"]: m["tickets"] for m in mine(app_url, p)["members"]} == {p.id: 1, mate.id: 1}


def test_simultaneous_solves(app_url: str, peer: str) -> None:
    team, (p, mate) = squad(app_url, 2, "simul")
    slug = "strange-and-unusual-activity"
    results = together(lambda: submit(app_url, p, slug, FLAG[slug]), lambda: submit(peer, mate, slug, FLAG[slug]))
    bodies = [ok(r) for r in results]
    assert sum(b["team_points_awarded"] for b in bodies) == BY_SLUG[slug]["points"]
    assert all(b["ticket_awarded"] is True for b in bodies)
    assert count(f"team_solves where team_id = {team['id']} and scenario_slug = {q(slug)}") == 1
    assert count(f"completions where scenario_slug = {q(slug)} and user_id = {p.id}") == 1
    assert count(f"completions where scenario_slug = {q(slug)} and user_id = {mate.id}") == 1
    results = together(lambda: submit(app_url, p, "day-o", FLAG["day-o"]), lambda: submit(peer, p, "day-o", FLAG["day-o"]))
    bodies = [ok(r) for r in results]
    assert sorted(b["already_completed"] for b in bodies) == [False, True]
    assert count(f"completions where scenario_slug = 'day-o' and user_id = {p.id}") == 1
    assert count(f"flag_attempts where scenario_slug = 'day-o' and user_id = {p.id} and correct") == 1
    assert mine(app_url, p)["score"] == BY_SLUG[slug]["points"] + BY_SLUG["day-o"]["points"]


def test_wrong_flag_lock(app_url: str, peer: str) -> None:
    team, (p, mate) = squad(app_url, 2, "lock")
    for _ in range(WRONG_FLAG_LIMIT - 1):
        assert ok(submit(app_url, p, "the-waiting-room", WRONG_FLAG))["correct"] is False
    solve(app_url, p, "the-waiting-room")
    for _ in range(WRONG_FLAG_LIMIT - 1):
        assert ok(submit(app_url, p, "the-waiting-room", WRONG_FLAG))["correct"] is False
    for _ in range(WRONG_FLAG_LIMIT):
        assert ok(submit(app_url, p, "day-o", WRONG_FLAG))["correct"] is False
    fifth = time.monotonic()
    locked = submit(app_url, p, "day-o", FLAG["day-o"])
    refused(locked, 429, "too_many_attempts")
    other = submit(peer, p, "day-o", WRONG_FLAG)
    refused(other, 429, "too_many_attempts")
    left = [int(r.headers["retry-after"]) for r in (locked, other)]
    assert all(1 <= v <= FLAG_LOCK_SECONDS for v in left) and abs(left[0] - left[1]) <= 1
    assert ok(submit(app_url, mate, "day-o", WRONG_FLAG))["correct"] is False
    assert ok(submit(app_url, p, "dead-endpoint", WRONG_FLAG))["correct"] is False
    assert leave(app_url, p).status_code == 204
    refused(submit(app_url, p, "day-o", WRONG_FLAG), 409, "no_team")
    make_team(app_url, p)
    refused(submit(peer, p, "day-o", FLAG["day-o"]), 429, "too_many_attempts")
    assert count(f"flag_attempts where user_id = {p.id} and scenario_slug = 'day-o'") == WRONG_FLAG_LIMIT
    while (r := submit(app_url, p, "day-o", WRONG_FLAG)).status_code == 429:
        assert time.monotonic() - fifth <= FLAG_LOCK_SECONDS + OUTAGE_SECONDS, r.text
    assert time.monotonic() - fifth >= FLAG_LOCK_SECONDS - 1
    assert ok(r)["correct"] is False
    for _ in range(WRONG_FLAG_LIMIT - 1):
        assert ok(submit(app_url, p, "day-o", WRONG_FLAG))["correct"] is False
    refused(submit(app_url, p, "day-o", WRONG_FLAG), 429, "too_many_attempts")


def test_wrong_flag_burst(app_url: str, peer: str) -> None:
    team, (p,) = squad(app_url, 1, "lock-burst")
    burst = WRONG_FLAG_LIMIT + 4
    results = together(*[functools.partial(submit, (app_url, peer)[i % 2], p, "quiet-as-the-grave", WRONG_FLAG) for i in range(burst)])
    assert sorted(r.status_code for r in results) == [200] * WRONG_FLAG_LIMIT + [429] * (burst - WRONG_FLAG_LIMIT)
    assert all(r.json()["correct"] is False for r in results if r.status_code == 200)
    assert count(f"flag_attempts where user_id = {p.id} and scenario_slug = 'quiet-as-the-grave'") == WRONG_FLAG_LIMIT


def test_solved_ticks(browser: Browser, app_url: str) -> None:
    team, (p, mate) = squad(app_url, 2, "ticks")
    solve(app_url, p, "repossessed")
    solve(app_url, p, "deadmen-tell-no-logs")
    assert ok(submit(app_url, mate, "day-o", WRONG_FLAG))["correct"] is False
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, mate, "/downtime/scenarios/quiet-as-the-grave")
        page.evaluate(HOLD_ANIMATIONS)
        fill(page.get_by_role("textbox", name="Flag"), FLAG["quiet-as-the-grave"])
        click(page.get_by_role("button", name="Submit flag"))
        badge = word(page, "Solved")
        eventually(page, lambda: expect(badge).to_be_attached(timeout=STEP_MS), UI_WAIT_SECONDS)
        assert ticked(badge, "Solved")
        animated = badge.evaluate_handle("el => { for (let n = el; n; n = n.parentElement) if (n.getAnimations().length) return n; return el; }")
        end_ms = animated.evaluate("n => Math.max(0, ...n.getAnimations().map(a => a.effect.getComputedTiming().endTime))")
        assert 0 < end_ms <= POP_MAX_MS, end_ms
        widths = [r["w"] for r in seek_rects(animated)]
        assert widths[-1] > 0 and max(widths) > widths[-1] + 0.5, widths
        page.goto(f"{app_url}/downtime/team")
        eventually(page, lambda: expect(word(page, "Solved by the team")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert ticked(word(page, "Solved by the team"), "Solved by the team")
        assert ticked(word(page, "Solved by me"), "Solved by me")
        assert not ticked(word(page, "Attempted"), "Attempted")
        assert not ticked(word(page, "Not attempted"), "Not attempted")
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, p, "/downtime/team")
        eventually(page, lambda: expect(word(page, "Solved by me")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert ticked(word(page, "Solved by me"), "Solved by me")
        rank = entry_for(app_url, team["id"])["rank"]
        page.goto(f"{app_url}/downtime?board={math.ceil(rank / DEFAULT_LIMIT)}")
        row = page.get_by_role("table", name="Live Leaderboard").get_by_role("row").filter(has_text=team["name"])
        eventually(page, lambda: expect(row).to_have_count(1, timeout=STEP_MS), UI_WAIT_SECONDS)
        assert ticked(word(row, "Passed"), "Passed") and ticked(word(row, "Completed"), "Completed")


def test_derived_scores(app_url: str) -> None:
    listed = ok(get(app_url, "/api/scenarios"))["scenarios"]
    assert {s["slug"]: s["points"] for s in listed} == {s["slug"]: s["points"] for s in SCENARIOS}
    team, (cap, a, b) = squad(app_url, 3, "derive")
    solve(app_url, a, "day-o")
    solve(app_url, b, "dead-endpoint")
    solve(app_url, cap, "day-o")
    ok(post(app_url, "/api/webinar/flag", {"flag": WEBINAR_FLAG}, b.token))
    assert leave(app_url, a).status_code == 204
    assert remove(app_url, cap, b.id).status_code == 204

    def stored_score(team_id: int) -> int:
        return pg().rows(f"select coalesce(sum(s.points), 0)::int as n from team_solves ts join scenarios s on s.slug = ts.scenario_slug where ts.team_id = {team_id}")[0]["n"]

    def stored_tickets(user_id: int) -> int:
        return count(f"completions where user_id = {user_id}") + WEBINAR_TICKETS * count(f"webinar_claims where user_id = {user_id}")

    expected = BY_SLUG["day-o"]["points"] + BY_SLUG["dead-endpoint"]["points"]
    assert stored_score(team["id"]) == expected == mine(app_url, cap)["score"] == entry_for(app_url, team["id"])["points"]
    for p in (cap, a, b):
        assert me(app_url, p)["tickets"] == stored_tickets(p.id)
    assert me(app_url, b)["tickets"] == 1 + WEBINAR_TICKETS
    seeded = {e["team_name"]: e["points"] for e in all_entries(app_url)}
    for name, *_, points in SEED_TEAMS:
        assert seeded[name] == points, name


def test_webinar_bonus(app_url: str) -> None:
    loner = signup(app_url, "webinar")
    refused(post(app_url, "/api/webinar/flag", {"flag": WRONG_FLAG}, loner.token), 422, "wrong_flag")
    assert "flag" in refused(post(app_url, "/api/webinar/flag", {"flag": " "}, loner.token), 400, "validation")["fields"]
    assert count(f"webinar_claims where user_id = {loner.id}") == 0
    body = ok(post(app_url, "/api/webinar/flag", {"flag": f" {WEBINAR_FLAG} "}, loner.token))
    assert body == {"claimed": True, "tickets": WEBINAR_TICKETS}
    refused(post(app_url, "/api/webinar/flag", {"flag": WEBINAR_FLAG}, loner.token), 409, "already_claimed")
    status = me(app_url, loner)
    assert status["tickets"] == WEBINAR_TICKETS and status["webinar_claimed"] is True
    assert count(f"webinar_claims where user_id = {loner.id}") == 1
    team, (p,) = squad(app_url, 1, "webinar-team")
    solve(app_url, p, "day-o")
    assert ok(post(app_url, "/api/webinar/flag", {"flag": WEBINAR_FLAG}, p.token))["tickets"] == 1 + WEBINAR_TICKETS
    assert mine(app_url, p)["score"] == BY_SLUG["day-o"]["points"]


def test_leaderboard_ranking(app_url: str) -> None:
    older, newer, zero, worded = crew(app_url, 4, "rank")
    team_a = make_team(app_url, older)
    team_b = make_team(app_url, newer)
    team_z = make_team(app_url, zero)
    team_w = make_team(app_url, worded)
    solve(app_url, newer, "day-o")
    solve(app_url, older, "day-o")
    for slug in ("repossessed", "deadmen-tell-no-logs", "dead-endpoint"):
        solve(app_url, worded, slug)
    assert leave(app_url, zero).status_code == 204
    ranking = all_entries(app_url)
    assert [e["rank"] for e in ranking] == list(range(1, len(ranking) + 1))
    points = [e["points"] for e in ranking]
    assert points == sorted(points, reverse=True)
    pos = {e["team_name"]: e["rank"] for e in ranking}
    by_id = {e["team_id"]: e for e in ranking}
    assert by_id[team_a["id"]]["points"] == by_id[team_b["id"]]["points"] == BY_SLUG["day-o"]["points"]
    assert by_id[team_b["id"]]["rank"] < by_id[team_a["id"]]["rank"]
    for first, second in (("Cold Ledger", "Grey Static"), ("Pale Signal", "Attic Lights"), ("Moth Light", "Crypt Keys"), ("Dust Index", "Last Lamp")):
        assert pos[first] < pos[second], (first, second)
    assert by_id[team_z["id"]]["points"] == 0 and by_id[team_z["id"]]["rank"] > pos["Last Lamp"]
    assert all(e["points"] == 0 for e in ranking if e["rank"] > by_id[team_z["id"]]["rank"] - 1 and e["rank"] >= pos["Dust Index"])
    w = by_id[team_w["id"]]
    assert (w["soc_sim"], w["th_sim"], w["tabletop"]) == ("Passed", "Not passed", "Completed")
    assert w["challenges_solved"] == 1 and w["challenges_total"] == CHALLENGES_TOTAL
    assert w["points"] == sum(BY_SLUG[s]["points"] for s in ("repossessed", "deadmen-tell-no-logs", "dead-endpoint"))
    cold = next(e for e in ranking if e["team_name"] == "Cold Ledger")
    assert (cold["soc_sim"], cold["th_sim"], cold["tabletop"], cold["challenges_solved"]) == ("Passed", "Passed", "Completed", CHALLENGES_TOTAL)


def test_leaderboard_pages(app_url: str) -> None:
    first = ok(get(app_url, "/api/leaderboard"))
    assert set(first) == {"entries", "total", "page", "limit", "pages", "server_time", "feed"}
    assert first["page"] == 1 and first["limit"] == DEFAULT_LIMIT and first["feed"] is None
    assert first["total"] == count("teams") and first["pages"] == math.ceil(first["total"] / DEFAULT_LIMIT)
    assert [e["rank"] for e in first["entries"]] == list(range(1, DEFAULT_LIMIT + 1))
    second = ok(get(app_url, "/api/leaderboard", params={"page": 2}))
    wide = ok(get(app_url, "/api/leaderboard", params={"limit": 2 * DEFAULT_LIMIT}))
    assert [e["rank"] for e in second["entries"]] == list(range(DEFAULT_LIMIT + 1, 2 * DEFAULT_LIMIT + 1))
    assert [e["team_id"] for e in second["entries"]] == [e["team_id"] for e in wide["entries"][DEFAULT_LIMIT:]]
    capped = ok(get(app_url, "/api/leaderboard", params={"limit": LIMIT_CAP + 10}))
    assert capped["limit"] == LIMIT_CAP and len(capped["entries"]) == min(LIMIT_CAP, capped["total"])
    past = ok(get(app_url, "/api/leaderboard", params={"page": first["pages"] + 1}))
    assert past["entries"] == [] and past["total"] == first["total"] and past["pages"] == first["pages"]
    assert ISO_RE.match(first["server_time"])
    for params in ({"page": "0"}, {"page": "-1"}, {"page": "01"}, {"page": "abc"}, {"page": "\u0661"}, {"page": "\uff12"},
                   {"page": "1\u0000"}, {"limit": "0"}, {"limit": "+5"}, {"page": str(ID_MAX + 1)}, {"include_feed": "2"},
                   {"include_feed": "true"}):
        refused(get(app_url, "/api/leaderboard", params=params), 400, "validation")
    ok(get(app_url, "/api/leaderboard", params={"page": str(ID_MAX), "include_feed": "0"}))


def test_feed_and_stream(app_url: str, peer: str) -> None:
    team, (p,) = squad(app_url, 1, "feed")
    with Stream(app_url) as here, Stream(peer) as there:
        assert here.status == 200 and here.content_type.startswith("text/event-stream")
        solve(app_url, p, "the-waiting-room")
        for stream in (here, there):
            _, data = stream.wait(score_for(team["id"]), STREAM_SECONDS)
            assert json.loads(data) == {"team_id": team["id"], "team_name": team["name"], "scenario_slug": "the-waiting-room",
                                        "points": BY_SLUG["the-waiting-room"]["points"], "team_score": BY_SLUG["the-waiting-room"]["points"]}
        solve(peer, p, "dead-endpoint")
        for stream in (here, there):
            _, data = stream.wait(score_for(team["id"]), STREAM_SECONDS)
            assert json.loads(data)["team_score"] == BY_SLUG["the-waiting-room"]["points"] + BY_SLUG["dead-endpoint"]["points"]
    feed = ok(get(app_url, "/api/leaderboard", params={"include_feed": 1}))["feed"]
    assert len(feed) <= FEED_SIZE
    times = [iso_epoch(item["created_at"]) for item in feed]
    assert times == sorted(times, reverse=True)
    ours = [(item["scenario_title"], item["points"]) for item in feed if item["team_name"] == team["name"]]
    assert ours == [("Dead Endpoint", BY_SLUG["dead-endpoint"]["points"]), ("The Waiting Room", BY_SLUG["the-waiting-room"]["points"])]


def test_board_address(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/downtime") as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url) if urlsplit(r.url).path == "/api/leaderboard" else None)
        pages = ok(get(app_url, "/api/leaderboard"))["pages"]
        assert pages >= 3
        nav = page.get_by_role("navigation", name="Leaderboard pages")
        table = page.get_by_role("table", name="Live Leaderboard")

        def shows(n: int) -> None:
            eventually(page, lambda: expect(nav.get_by_role("button", name=str(n), exact=True)).to_have_attribute("aria-current", "page", timeout=STEP_MS), UI_WAIT_SECONDS)
            for e in ok(get(app_url, "/api/leaderboard", params={"page": n}))["entries"]:
                eventually(page, lambda e=e: expect(table.get_by_role("row").filter(has_text=e["team_name"])).to_have_count(1, timeout=STEP_MS), EXPECT_SECONDS)

        def board() -> list[str] | None:
            return parse_qs(urlsplit(page.url).query).get("board")

        page.goto(f"{app_url}/downtime?keep=1#webinar")
        shows(1)
        page.evaluate("() => { window.__stay = true; }")
        start = page.evaluate("() => history.length")
        click(nav.get_by_role("button", name="Next"))
        page.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("board") == ["2"])
        click(nav.get_by_role("button", name="Next"))
        page.wait_for_url(lambda u: urlsplit(u).query.endswith("board=3"))
        shows(3)
        assert page.evaluate("() => history.length") == start + 2
        assert parse_qs(urlsplit(page.url).query)["keep"] == ["1"] and urlsplit(page.url).fragment == "webinar"
        page.evaluate("() => { window.__focus = document.activeElement; }")
        page.go_back()
        page.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("board") == ["2"])
        shows(2)
        assert page.evaluate("() => window.__stay === true && document.activeElement === window.__focus")
        page.go_forward()
        page.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("board") == ["3"])
        shows(3)
        page.reload()
        shows(3)
        click(nav.get_by_role("button", name="Previous"))
        page.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("board") == ["2"])
        click(nav.get_by_role("button", name="Previous"))
        page.wait_for_url(lambda u: "board" not in parse_qs(urlsplit(u).query))
        shows(1)
        for value in ("0", "abc", "07", "-1", "\uff12", "\u0663", "1"):
            page.goto(f"{app_url}/downtime")
            base_length = page.evaluate("() => history.length")
            page.goto(f"{app_url}/downtime?board={quote(value)}")
            page.wait_for_url(lambda u: "board" not in parse_qs(urlsplit(u).query), timeout=UI_WAIT_SECONDS * 1000)
            shows(1)
            assert page.evaluate("() => history.length") == base_length + 1, value
        page.goto(f"{app_url}/downtime")
        base_length = page.evaluate("() => history.length")
        page.goto(f"{app_url}/downtime?board={pages + 5}")
        page.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("board") == [str(pages)], timeout=UI_WAIT_SECONDS * 1000)
        shows(pages)
        assert page.evaluate("() => history.length") == base_length + 1
        for url in seen:
            sent = parse_qs(urlsplit(url).query).get("page", ["1"])[0]
            assert re.fullmatch(r"[1-9][0-9]*", sent), url
    with visit(browser, f"{app_url}/downtime?board=2") as other:
        eventually(other, lambda: expect(other.get_by_role("navigation", name="Leaderboard pages").get_by_role("button", name="2", exact=True)).to_have_attribute("aria-current", "page", timeout=STEP_MS), EXPECT_SECONDS)


def test_certificate_rule(app_url: str) -> None:
    p = signup(app_url, "cert")
    team = finished_team(app_url, p)
    last = pg().rows(f"select extract(epoch from max(created_at))::float8 as t from team_solves where team_id = {team['id']}")[0]["t"]
    cert = ok(get(app_url, "/api/me/certificate", p.token))
    assert set(cert) == {"display_name", "team_name", "event_name", "issued_on"} and ISO_RE.match(cert["issued_on"])
    assert abs(iso_epoch(cert["issued_on"]) - last) < 1
    assert ok(get(app_url, "/api/me/certificate", p.token))["issued_on"] == cert["issued_on"]
    late = signup(app_url, "cert-late")
    ok(join(app_url, late, team["invite_code"]))
    assert ok(get(app_url, "/api/me/certificate", late.token))["issued_on"] == cert["issued_on"]
    image = get(app_url, "/api/me/certificate/image", late.token)
    assert image.status_code == 200 and image.content, (image.status_code, image.text[:200])
    assert leave(app_url, late).status_code == 204
    refused(get(app_url, "/api/me/certificate", late.token), 403, "not_complete")
    refused(get(app_url, "/api/me/certificate/image", late.token), 403, "not_complete")
    unfinished = signup(app_url, "cert-un")
    make_team(app_url, unfinished)
    for s in SCENARIOS[:-1]:
        solve(app_url, unfinished, s["slug"])
    refused(get(app_url, "/api/me/certificate", unfinished.token), 403, "not_complete")
    cold = ok(login(app_url, "coldledger@example.com", SEED_PASSWORD))["token"]
    assert ok(get(app_url, "/api/me/certificate", cold))["issued_on"] == "2026-10-23T07:30:00Z"


def test_certificate_contents(app_url: str) -> None:
    name = 'Ada & <Moth> "Q"'
    p = signup(app_url, "svg", name=name)
    team = finished_team(app_url, p)
    r = get(app_url, "/api/me/certificate", p.token)
    cert = ok(r)
    assert cert["display_name"] == name and cert["team_name"] == team["name"] and cert["event_name"] == EVENT_NAME
    image = get(app_url, "/api/me/certificate/image", p.token)
    assert image.status_code == 200 and image.headers.get("content-type", "").startswith("image/svg+xml")
    root, texts = svg_texts(image.content)
    for value in (name, team["name"], EVENT_NAME, "Certificate of completion", "22 to 26 October 2026"):
        assert value in texts, (value, texts)
    issued = [cert["issued_on"], *utc_texts(cert["issued_on"])]
    assert any(v in t for t in texts for v in issued), texts
    allowed = {name, team["name"], EVENT_NAME, "Certificate of completion", "22 to 26 October 2026"}
    for t in texts:
        assert t in allowed or any(v in t for v in issued), t
    for el in root.iter():
        assert el.tag.rsplit("}", 1)[-1].lower() not in {"script", "foreignobject", "iframe"}, el.tag
        for attr, value in el.attrib.items():
            local = attr.rsplit("}", 1)[-1].lower()
            assert not local.startswith("on"), attr
            if local == "href":
                assert value.startswith("#"), value
            assert "Moth" not in value and team["name"] not in value, (attr, value)
    for text in (image.text, r.text):
        assert p.email not in text and team["invite_code"] not in text
    assert str(p.id) not in texts and "id" not in cert


def test_event_and_calendar(app_url: str) -> None:
    event = ok(get(app_url, "/api/event"))
    assert set(event) == {"name", "start", "end", "live_windows", "calendar_title", "calendar_description", "certificate_enabled", "server_time"}
    for key, value in EVENT.items():
        assert event[key] == value, key
    assert event["live_windows"] == [{"start": EVENT["start"], "end": EVENT["end"]}]
    assert event["certificate_enabled"] is True and ISO_RE.match(event["server_time"])
    first = get(app_url, "/api/event/calendar.ics")
    assert first.status_code == 200
    assert first.headers["content-type"].replace(" ", "").lower() == "text/calendar; charset=utf-8".replace(" ", "")
    assert "downtime.ics" in first.headers.get("content-disposition", "")
    uid = check_calendar(first.content, event)
    assert check_calendar(get(app_url, "/api/event/calendar.ics").content, event) == uid


def test_scenarios_and_flag_secrecy(app_url: str) -> None:
    r = get(app_url, "/api/scenarios")
    listed = ok(r)["scenarios"]
    expected = [{k: s[k] for k in ("slug", "number", "title", "kind", "points", "description")} for s in SCENARIOS]
    assert listed == expected
    bodies = [r.text]
    for s in SCENARIOS:
        detail = get(app_url, f"/api/scenarios/{s['slug']}")
        body = ok(detail)
        assert body == {"scenario": expected[s["number"] - 1], "team_solved": False, "solved_by_me": False, "attempted_by_me": False}
        bodies.append(detail.text)
    team, (p,) = squad(app_url, 1, "secret")
    bodies += [solve(app_url, p, "day-o").__repr__(), get(app_url, "/api/teams/mine", p.token).text, get(app_url, "/api/me", p.token).text]
    for body in bodies:
        for flag in FLAG.values():
            assert flag not in body
    stored = {r["slug"]: r["flag_sha256"] for r in pg().rows("select slug, flag_sha256 from scenarios")}
    assert stored == {s["slug"]: hashlib.sha256(s["flag"].encode()).hexdigest() for s in SCENARIOS}
    marker = "flag{secret_probe_value}"
    submit(app_url, p, "dead-endpoint", marker)
    dump = json.dumps(pg().rows("select row_to_json(s) as row from scenarios s") +
                      pg().rows(f"select row_to_json(f) as row from flag_attempts f where f.user_id = {p.id}"))
    assert marker not in dump and not any(flag in dump for flag in FLAG.values())


def test_published_surface(app_url: str) -> None:
    for path in ("/api/nope", "/api/teams/xyz/abc", "/api/scenarios/repossessed/flag/extra", "/api", "/api/debug", "/api/reset", "/api/admin", "/api/teams/mine/members/1"):
        r = raw(app_url, "GET", path)
        refused(r, 404, "not_found")
    r = raw(app_url, "DELETE", "/api/scenarios")
    refused(r, 405, "method_not_allowed")
    assert set(m.strip() for m in r.headers["allow"].split(",")) <= {"GET", "HEAD"} and "GET" in r.headers["allow"]
    r = raw(app_url, "GET", "/api/teams/join")
    refused(r, 405, "method_not_allowed")
    assert [m.strip() for m in r.headers["allow"].split(",")] == ["POST"]
    refused(raw(app_url, "PUT", "/api/auth/login", b"{}", **{"Content-Type": "application/json"}), 405, "method_not_allowed")
    email, tag = fresh("surface")
    body = json.dumps({"email": email, "display_name": tag, "password": "surface-pw-2026"}).encode()
    for content_type in (None, "text/plain", "application/json; charset=iso-8859-1", "application/x-www-form-urlencoded"):
        headers = {"Content-Type": content_type} if content_type else {}
        refused(raw(app_url, "POST", "/api/auth/signup", body, **headers), 415, "unsupported_media_type")
    assert count(f"users where email = {q(email)}") == 0
    ok(raw(app_url, "POST", "/api/auth/signup", body, **{"Content-Type": "application/json; charset=utf-8"}), 201)
    padding_email = fresh("surface-pad")[0]
    skeleton = json.dumps({"email": padding_email, "password": ""})
    exact = json.dumps({"email": padding_email, "password": "x" * (BODY_LIMIT - len(skeleton))}).encode()
    assert len(exact) == BODY_LIMIT
    refused(raw(app_url, "POST", "/api/auth/login", exact, **{"Content-Type": "application/json"}), 401, "invalid_credentials")
    over = json.dumps({"email": padding_email, "password": "x" * (BODY_LIMIT + 1 - len(skeleton))}).encode()
    refused(raw(app_url, "POST", "/api/auth/login", over, **{"Content-Type": "application/json"}), 413, "payload_too_large")
    refused(raw(app_url, "POST", "/api/auth/login", over, **{"Content-Type": "text/plain"}), 413, "payload_too_large")


def test_strict_json(app_url: str) -> None:
    email, tag = fresh("strict")
    head = f'"email":"{email}","display_name":"{tag}","password":"strict-pw-2026"'
    nested_ok = "[" * (MAX_DEPTH - 1) + "]" * (MAX_DEPTH - 1)
    nested_bad = "[" * MAX_DEPTH + "]" * MAX_DEPTH
    cases = [
        ("{" + head + ',"x":NaN}').encode(), ("{" + head + ',"x":Infinity}').encode(), ("{" + head + ',"x":-Infinity}').encode(),
        ("{" + head + ',"x":{"a":1,"a":2}}').encode(), ("{" + head + f',"email":"{email}"' + "}").encode(),
        ("{" + head + ',"x":"\\ud800"}').encode(), b"{" + head.encode() + b',"x":"\xff\xfe"}',
        ("[{" + head + "}]").encode(), f'"{email}"'.encode(), b"null", ("{" + head).encode(),
        ("{" + head + ',"x":' + nested_bad + "}").encode(),
    ]
    for payload in cases:
        started = time.monotonic()
        r = raw(app_url, "POST", "/api/auth/signup", payload, **{"Content-Type": "application/json"})
        assert time.monotonic() - started <= JSON_SECONDS, payload[:60]
        refused(r, 400, "invalid_json")
    assert count(f"users where email = {q(email)}") == 0
    r = raw(app_url, "POST", "/api/auth/signup", ("{" + head + ',"x":' + nested_ok + "}").encode(), **{"Content-Type": "application/json"})
    assert r.status_code != 400 or r.json()["error"] != "invalid_json", r.text


def test_opaque_errors(app_url: str) -> None:
    team, (cap,) = squad(app_url, 1, "opaque")
    for bad_id in ("\u0663", "\uff13", "\u00b2", "+1", "-1", "01", str(ID_MAX + 1), "9" * 40, "1.0", "abc", "%00"):
        refused(remove(app_url, cap, quote(bad_id) if bad_id != "%00" else bad_id), 404, "not_a_member")
    refused(remove(app_url, cap, ID_MAX), 404, "not_a_member")
    for slug in ("a" * (SLUG_MAX + 1), quote("r\u00e9po"), "%00", "repossessed%00", "REPOSSESSED"):
        refused(get(app_url, f"/api/scenarios/{slug}"), 404, "unknown_scenario")
        refused(submit(app_url, cap, slug, FLAG["repossessed"]), 404, "unknown_scenario")
    for params in ({"page": "\u0000"}, {"limit": "\u0661"}, {"include_feed": "\u0000"}):
        refused(get(app_url, "/api/leaderboard", params=params), 400, "validation")
    email, tag = fresh("opaque-nul")
    for path, payload, field, token in (
        ("/api/auth/signup", {"email": email + "\u0000", "display_name": tag, "password": "opaque-pw-2026"}, "email", None),
        ("/api/auth/signup", {"email": email, "display_name": tag + "\u0000", "password": "opaque-pw-2026"}, "display_name", None),
        ("/api/auth/login", {"email": email, "password": "opaque\u0000pw"}, "password", None),
        ("/api/scenarios/day-o/flag", {"flag": "flag{\u0000}"}, "flag", cap.token),
        ("/api/teams/join", {"invite_code": "COLD\u0000LEDG"}, "invite_code", cap.token),
        ("/api/webinar/flag", {"flag": "\u0000"}, "flag", cap.token),
    ):
        r = post(app_url, path, payload, token)
        if path == "/api/teams/join":
            refused(r, 409, "already_in_team")
        else:
            assert field in refused(r, 400, "validation")["fields"], path
    assert count(f"users where email = {q(email)}") == 0 and count(f"login_attempts where email = {q(email)}") == 0
    assert count(f"flag_attempts where user_id = {cap.id}") == 0


def test_hero_and_event_bar(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}/downtime") as page:
        page.set_viewport_size(LAPTOP)
        h1 = page.get_by_role("heading", level=1)
        eventually(page, lambda: expect(h1).to_have_count(1, timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate("() => document.getElementsByTagName('h1').length") == 1
        eventually(page, lambda: expect(h1).to_have_accessible_name("It's Downtime!", timeout=STEP_MS), EXPECT_SECONDS)
        struck = h1.get_by_role("deletion", include_hidden=True)
        eventually(page, lambda: expect(struck).to_have_count(1, timeout=STEP_MS), EXPECT_SECONDS)
        assert struck.text_content().strip().upper() == "SHOW"
        assert struck.evaluate("el => !!el.closest('[aria-hidden=\"true\"]')")
        assert "DOWN" in (h1.text_content() or "").upper()
        dots = page.evaluate("""([lo, hi]) => document.getAnimations().filter(a => a.effect && a.effect.target && a.playState === 'running'
            && a.effect.getComputedTiming().iterations === Infinity && a.effect.getComputedTiming().duration >= lo
            && a.effect.getComputedTiming().duration <= hi && a.effect.target.getBoundingClientRect().top < innerHeight)
            .map(a => ({d: a.effect.getComputedTiming().duration, delay: a.effect.getTiming().delay,
              hidden: !!a.effect.target.closest('[aria-hidden="true"]')}))""", [DOT_MIN_MS, DOT_MAX_MS])
        dots = [d for d in dots if d["hidden"]]
        assert len(dots) >= MIN_DOTS, dots
        assert all((a["d"], a["delay"]) != (b["d"], b["delay"]) for a, b in zip(dots, dots[1:])), dots
        canvas = page.evaluate("""() => { const c = document.getElementsByTagName('canvas')[0]; const r = c.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {hidden: !!c.closest('[aria-hidden="true"]'), takes: hit === c, w: r.width}; }""")
        assert canvas["hidden"] and not canvas["takes"] and canvas["w"] > 0
        title = box(h1)

        def tail_pixels() -> Any:
            data = page.evaluate("() => document.getElementsByTagName('canvas')[0].toDataURL('image/png')")
            return decode(base64.b64decode(data.split(",", 1)[1]))

        page.mouse.move(title["x"] + 5, title["y"] + 5)
        advance(page, 2 * TAIL_MS)
        before = tail_pixels()
        page.mouse.move(title["x"] + title["width"] - 5, title["y"] + title["height"] - 5)
        advance(page, 2 * TAIL_MS)
        assert difference(before, tail_pixels()) > 0
        bar_any = page.get_by_role("region", name="Event bar", include_hidden=True)
        expect(bar_any).to_have_count(0)
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        advance(page, SETTLE_MS)
        bar = page.get_by_role("region", name="Event bar")
        expect(bar).to_be_visible()
        expect(bar).to_contain_text("It's Downtime!")
        expect(bar.get_by_role("link", name="Join event")).to_be_visible()
        expect(bar.get_by_role("button", name="Create a team")).to_be_visible()
        expect(bar.get_by_role("button", name=re.compile(r"^Sound (off|on)$"))).to_be_visible()
        page.evaluate("() => window.scrollTo(0, 0)")
        advance(page, SETTLE_MS)
        expect(bar_any).to_have_count(0)


def test_event_page_sections(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/downtime") as page:
        assert_copy(page,
                    "Strange & Unusual Activity Detected",
                    "Congratulations, you've been assigned the case! A crew called Velvet Moth has crashed a game studio's network, swiped the unreleased build and moved in. The help desk has filed it under \"paranormal\".",
                    "The event is open from Thursday 22 to Monday 26 October. No waiting room, no taking a number, join the challenge at any time and play at your own pace.",
                    "Leaderboard prizes go to the top-scoring teams, while raffle prizes are drawn from individual tickets: you earn one for every challenge you complete, wherever your team ranks.",
                    "Alert Triaging", "Digital Forensics", "Threat Hunting", "Malware Analysis",
                    "Thursday 22nd to Monday 26th October 2026", "Starts 4:00 PM UTC · Ends 11:59 PM UTC",
                    "Register an account on NightWard", "Tell your manager and colleagues",
                    "Choose any one day between Thursday 22nd and Monday 26th October", "Complete in a few hours, or spread it across the 5 days!",
                    "Can't wait? Add it to your calendar and assemble the crew.",
                    "Real-world Simulators", "Rewards", "Certificate", *PERK_LINES,
                    "Form your team", "Nobody likes checking the attic alone!",
                    "Prizes go to the teams at the top of the leaderboard, and because every challenge tests a different skill set, well-rounded professional teams have the advantage. Solo players can enter as a team of one.",
                    "Raffle tickets are individual: you earn one for every challenge you complete, wherever your team ranks.",
                    "1,384+ security teams already signed up", "What are you waiting for?",
                    "Dig up your team's capability gaps before something darker does",
                    "Breach Range Simulator", "Tailored CTFs", "Tabletops & Simulators", "FAQs")
        text = page_text(page).casefold()
        order = ["Strange & Unusual Activity Detected", "Real-world Simulators", "Form your team", "Things are about to get strange",
                 "Invite your manager to our exclusive webinar", "Live Leaderboard", "1,384+ security teams already signed up",
                 "Dig up your team's capability gaps", "FAQs"]
        positions = [text.index(o.casefold()) for o in order]
        assert positions == sorted(positions), order
        assert page.get_by_role("link", name="Join for FREE").count() >= 1
        eventually(page, lambda: expect(page.get_by_role("main").get_by_role("button", name="Create a team").first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("button", name="Join an existing team")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        for path in ("/business",):
            assert page.evaluate("(p) => [...document.links].filter(a => new URL(a.href).pathname === p).length", path) >= 3
        click(page.get_by_role("button", name="View prizes"))
        dialog = page.get_by_role("dialog", name="Prizes")
        eventually(page, lambda: expect(dialog).to_contain_text("Over $40,000 in prizes", timeout=STEP_MS), EXPECT_SECONDS)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        for question in FAQ_QUESTIONS:
            eventually(page, lambda question=question: expect(page.get_by_role("button", name=question, exact=True)).to_have_attribute("aria-expanded", "false", timeout=STEP_MS), EXPECT_SECONDS)
        winner = page.get_by_role("button", name="How is the winner decided?", exact=True)
        click(winner)
        eventually(page, lambda: expect(winner).to_have_attribute("aria-expanded", "true", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text("The team with the highest score when the event closes on Monday 26 October wins.", exact=False)).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert_copy(page, "If two teams tie, the one that completed first ranks higher. There are no first-blood bonuses.")
        click(winner)
        eventually(page, lambda: expect(winner).to_have_attribute("aria-expanded", "false", timeout=STEP_MS), EXPECT_SECONDS)


def test_briefing_film(browser: Browser, app_url: str) -> None:
    film = httpx.get(app_url + FILM_PATH, timeout=HTTP_TIMEOUT)
    sound = httpx.get(app_url + SOUND_PATH, timeout=HTTP_TIMEOUT)
    assert film.status_code == 200 and hashlib.sha256(film.content).hexdigest() == FILM_SHA
    assert sound.status_code == 200 and hashlib.sha256(sound.content).hexdigest() == SOUND_SHA
    vtt = httpx.get(f"{app_url}/media/briefing.vtt", timeout=HTTP_TIMEOUT)
    assert vtt.status_code == 200 and vtt.headers["content-type"].startswith("text/vtt")
    assert vtt.text.lstrip("\ufeff").startswith("WEBVTT")
    blocks = [b.strip().splitlines() for b in re.split(r"\r?\n\r?\n", vtt.text.strip())[1:] if "-->" in b]
    cues = [" ".join(line for line in b[[i for i, line in enumerate(b) if "-->" in line][0] + 1:]) for b in blocks]
    assert cues == ["Moths circle the lamps after dark.", "Something on the studio network is drawn to the light too.",
                    "Find out what it is before the build walks out the door."]
    with visit(browser, f"{app_url}/downtime") as page:
        pause = page.get_by_role("button", name="Pause briefing")
        pause.scroll_into_view_if_needed()
        facts = page.evaluate(VIDEO_JS)
        assert facts["muted"] and facts["loop"] and facts["inline"] and facts["poster"]
        assert urlsplit(facts["src"]).path == FILM_PATH
        assert (facts["kind"], facts["lang"], facts["label"]) == ("captions", "en", "English")
        assert urlsplit(facts["track"]).path == "/media/briefing.vtt"
        holds(page, "() => !document.getElementsByTagName('video')[0].paused", seconds=UI_WAIT_SECONDS)
        click(pause)
        play = page.get_by_role("button", name="Play briefing")
        eventually(page, lambda: expect(play).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate(VIDEO_JS)["paused"] is True
        click(play)
        holds(page, "() => !document.getElementsByTagName('video')[0].paused", seconds=UI_WAIT_SECONDS)
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        holds(page, "() => document.getElementsByTagName('video')[0].paused", seconds=UI_WAIT_SECONDS)


SOUND_PROBE = """
window.__sound = {plays: 0, sources: 0, oscillators: 0};
const play = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function (...a) { if (!(this instanceof HTMLVideoElement)) window.__sound.plays++; return play.apply(this, a); };
if (window.AudioBufferSourceNode) { const s = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { window.__sound.sources++; return s.apply(this, a); }; }
if (window.OscillatorNode) { const o = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) { window.__sound.oscillators++; return o.apply(this, a); }; }
"""


def test_sound(browser: Browser, app_url: str) -> None:
    team, (p,) = squad(app_url, 1, "sound")
    with visit(browser, f"{app_url}/downtime") as page:
        page.context.add_init_script(SOUND_PROBE)
        fetched: list[str] = []
        page.on("request", lambda r: fetched.append(r.url) if urlsplit(r.url).path == SOUND_PATH else None)
        page.reload()
        toggle = page.get_by_role("banner").get_by_role("button", name="Sound off")
        eventually(page, lambda: expect(toggle).to_have_attribute("aria-pressed", "false", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("table", name="Live Leaderboard")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert fetched == [] and page.evaluate("() => window.__sound.plays + window.__sound.sources") == 0
        with page.expect_request(lambda r: urlsplit(r.url).path == SOUND_PATH):
            click(toggle)
        on = page.get_by_role("banner").get_by_role("button", name="Sound on")
        eventually(page, lambda: expect(on).to_have_attribute("aria-pressed", "true", timeout=STEP_MS), EXPECT_SECONDS)
        holds(page, "() => window.__sound.plays + window.__sound.sources > 0", seconds=UI_WAIT_SECONDS)
        page.reload()
        eventually(page, lambda: expect(page.get_by_role("banner").get_by_role("button", name="Sound on")).to_have_attribute("aria-pressed", "true", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("table", name="Live Leaderboard")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate("() => window.__sound.plays + window.__sound.sources") == 0
        page.keyboard.press("Shift")
        holds(page, "() => window.__sound.plays + window.__sound.sources > 0", seconds=UI_WAIT_SECONDS)
        click(page.get_by_role("banner").get_by_role("button", name="Sound on"))
        eventually(page, lambda: expect(page.get_by_role("banner").get_by_role("button", name="Sound off")).to_have_attribute("aria-pressed", "false", timeout=STEP_MS), EXPECT_SECONDS)
        ui_login(page, app_url, p, "/downtime/scenarios/day-o")
        region = status_region(page, "Flag result")
        field = page.get_by_role("textbox", name="Flag")
        fill(field, WRONG_FLAG)
        click(page.get_by_role("button", name="Submit flag"))
        eventually(page, lambda: expect(region).to_contain_text("That flag is not right", timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate("() => window.__sound.oscillators") == 0
        click(page.get_by_role("banner").get_by_role("button", name="Sound off"))
        eventually(page, lambda: expect(page.get_by_role("banner").get_by_role("button", name="Sound on")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        fill(field, WRONG_FLAG + "x")
        click(page.get_by_role("button", name="Submit flag"))
        holds(page, "() => window.__sound.oscillators > 0", seconds=UI_WAIT_SECONDS)
        buzz = page.evaluate("() => window.__sound.oscillators")
        fill(field, FLAG["day-o"])
        click(page.get_by_role("button", name="Submit flag"))
        eventually(page, lambda: expect(region).to_contain_text("Solved!", timeout=STEP_MS), EXPECT_SECONDS)
        holds(page, "(n) => window.__sound.oscillators > n", arg=buzz, seconds=UI_WAIT_SECONDS)


def trail_link(page: Page, s: dict) -> Any:
    for candidate in page.get_by_role("link", name=s["title"], exact=True).all():
        if urlsplit(candidate.get_attribute("href") or "").path == f"/downtime/scenarios/{s['slug']}":
            return candidate
    raise AssertionError(f"no trail link for {s['slug']}")


def test_scenario_trail(browser: Browser, app_url: str) -> None:
    team, (p,) = squad(app_url, 1, "trail")
    solve(app_url, p, "day-o")
    with visit(browser, f"{app_url}/downtime") as page:
        page.set_viewport_size(LAPTOP)
        assert_copy(page, "Things are about to get strange. Here's what's waiting for you inside the SOC",
                    "Every room is a mission. Every mission builds a skill.", "Complete all and go from padawan to cyber operative.",
                    *KIND_LABEL.values(), *(s["description"] for s in SCENARIOS))
        links = [trail_link(page, s) for s in SCENARIOS]
        boxes = [box(link) for link in links]
        assert [b["y"] for b in boxes] == sorted(b["y"] for b in boxes)
        middle = LAPTOP["width"] / 2
        sides = [b["x"] + b["width"] / 2 > middle for b in boxes]
        assert all(a != b for a, b in zip(sides, sides[1:])), sides
        orbs = [page.get_by_text(f"{s['number']:02d}", exact=True).last for s in SCENARIOS]
        scroll_y = page.evaluate("() => window.scrollY")
        top = int(boxes[0]["y"] + scroll_y - LAPTOP["height"])
        bottom = int(boxes[-1]["y"] + scroll_y)
        forward = [max(0, top + (bottom - top) * i // 7) for i in range(8)]
        path = forward + forward[::-1]
        lit = []
        for orb in orbs:
            samples = scroll_samples(page, orb, path, "color", "background-color", "box-shadow")
            lit.append([s != samples[0] for s in samples])
        for flags in lit:
            down, up = flags[:len(forward)], flags[len(forward):]
            assert not down[0] and down[-1], flags
            assert down == sorted(down) and up == sorted(up, reverse=True) and not up[-1], flags
        totals = [sum(flags[i] for flags in lit) for i in range(len(forward))]
        assert totals == sorted(totals) and any(0 < t < len(SCENARIOS) for t in totals), totals
        page.goto(f"{app_url}/downtime")
        ui_login(page, app_url, p, "/downtime")
        eventually(page, lambda: expect(word(page, "Solved by me")).to_be_attached(timeout=STEP_MS), UI_WAIT_SECONDS)
        assert ticked(word(page, "Solved by me"), "Solved by me")
        assert not ticked(word(page, "Not attempted"), "Not attempted")
        assert page.get_by_text(re.compile(r"^\s*Not attempted$")).count() >= len(SCENARIOS) - 1
        page.set_viewport_size(PHONE)
        orb_boxes = [box(o) for o in orbs]
        link_boxes = [box(trail_link(page, s)) for s in SCENARIOS]
        assert max(b["x"] for b in orb_boxes) - min(b["x"] for b in orb_boxes) <= SUBPIXEL
        assert all(o["x"] + o["width"] <= l["x"] + SUBPIXEL for o, l in zip(orb_boxes, link_boxes))
        layout(page)


def test_global_chrome(browser: Browser, app_url: str) -> None:
    allowed = {"/downtime", "/", *PLATFORM_PAGES}
    with visit(browser, f"{app_url}/downtime") as page:
        assert tab_order(page, 1) == ["Skip to main content"]
        banner, footer = page.get_by_role("banner"), page.get_by_role("contentinfo")
        for item in HEADER_ITEMS:
            link = banner.get_by_role("link", name=item, exact=True)
            eventually(page, lambda: expect(link).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
            assert urlsplit(link.get_attribute("href") or "").path in allowed, item
        eventually(page, lambda: expect(banner.get_by_role("link", name="Log In", exact=True)).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(banner.get_by_role("link", name="Join for FREE", exact=True)).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(banner.get_by_role("button", name="Sound off")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        for name in FOOTER_LINKS:
            link = footer.get_by_role("link", name=name, exact=True)
            eventually(page, lambda: expect(link).to_have_count(1, timeout=STEP_MS), EXPECT_SECONDS)
            assert urlsplit(link.get_attribute("href") or "").path in allowed, name
        assert_copy(page, "We're a gamified, hands-on cyber security training platform that you can access through your browser.")
        assert "ISO27001" in (footer.inner_html() or "")
        hrefs = banner.evaluate("b => [...b.getElementsByTagName('a')].map(a => a.href)") + \
            footer.evaluate("f => [...f.getElementsByTagName('a')].map(a => a.href)")
        for href in set(hrefs):
            assert same_origin(href, app_url), href
            assert httpx.get(href, timeout=HTTP_TIMEOUT).status_code == 200, href
        page.set_viewport_size(PHONE)
        menu = page.get_by_role("button", name="Menu")
        eventually(page, lambda: expect(menu).to_have_attribute("aria-expanded", "false", timeout=STEP_MS), EXPECT_SECONDS)
        click(menu)
        eventually(page, lambda: expect(menu).to_have_attribute("aria-expanded", "true", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(banner.get_by_role("link", name="Downtime", exact=True)).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(menu).to_have_attribute("aria-expanded", "false", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(menu).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)
        page.set_viewport_size(LAPTOP)
        eventually(page, lambda: expect(page.get_by_role("button", name="Menu")).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        response = page.goto(f"{app_url}/")
        assert response and response.status == 200
        eventually(page, lambda: expect(page.get_by_role("heading", name="Anyone can learn cyber security with NightWard")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert_copy(page, "Hands-on cyber security training through real-world scenarios")
        eventually(page, lambda: expect(page.get_by_role("main").get_by_role("link", name="Join for FREE")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate("() => [...document.getElementsByTagName('main')[0].getElementsByTagName('a')].some(a => new URL(a.href).pathname === '/downtime')")
        for path in PLATFORM_PAGES:
            response = page.goto(app_url + path)
            assert response and response.status == 200, path
            eventually(page, lambda: expect(page.get_by_role("main").get_by_role("heading").first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
            assert page.evaluate("() => [...document.getElementsByTagName('main')[0].getElementsByTagName('a')].some(a => new URL(a.href).pathname === '/downtime')"), path
            if path == "/community":
                assert_copy(page, "Connect with 8+ million learners online or in person")
    missing = httpx.get(f"{app_url}/downtime-no-such-room", timeout=HTTP_TIMEOUT)
    assert missing.status_code == 404 and "text/html" in missing.headers.get("content-type", "")


def test_consent(browser: Browser, app_url: str) -> None:
    panel_copy = "We use cookies to ensure you get the best user experience. For more information see our cookie policy."
    analytics = re.compile(r"_ga|_gid|analytic|amplitude|mixpanel|_fbp|segment|hotjar|visitor", re.I)
    with visit(browser, f"{app_url}/downtime") as page:
        eventually(page, lambda: expect(page.get_by_text(panel_copy)).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert not [c for c in page.context.cookies() if analytics.search(c["name"])]
        click(page.get_by_role("button", name="Allow All"))
        eventually(page, lambda: expect(page.get_by_text(panel_copy)).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        page.reload()
        eventually(page, lambda: expect(page.get_by_role("table", name="Live Leaderboard")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(panel_copy)).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        stored = page.evaluate("() => Object.keys(localStorage).concat(Object.keys(sessionStorage))")
        assert not [k for k in stored if analytics.search(k)], stored
        assert not [c for c in page.context.cookies() if analytics.search(c["name"])]
    with visit(browser, f"{app_url}/downtime") as page:
        click(page.get_by_role("button", name="Cookie Settings"))
        dialog = page.get_by_role("dialog", name="Cookie settings")
        click(dialog.get_by_role("button", name="Essential only"))
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(panel_copy)).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        page.reload()
        eventually(page, lambda: expect(page.get_by_role("table", name="Live Leaderboard")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(panel_copy)).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    first = SCENARIOS[0]
    with visit(browser, f"{app_url}/downtime") as page:
        page.set_viewport_size(LAPTOP)
        loops = page.evaluate(INFINITE_JS)
        assert loops
        assert all(l["hidden"] for l in loops if not l["text"]), loops
        orb = page.get_by_text("01", exact=True).last
        link_y = box(trail_link(page, first))["y"] + page.evaluate("() => window.scrollY")
        lit_style = scroll_samples(page, orb, [int(link_y + LAPTOP["height"])], "color", "background-color", "box-shadow")[0]
        page.evaluate("() => window.scrollTo(0, 0)")
        page.get_by_role("heading", name="FAQs").scroll_into_view_if_needed()
        deadline = time.monotonic() + 1
        entering = page.evaluate(ENTERING_JS)
        while not any(e["moves"] for e in entering) and time.monotonic() < deadline:
            time.sleep(0.05)
            entering = page.evaluate(ENTERING_JS)
        rising = [e for e in entering if e["moves"]]
        assert rising and all(e["ms"] < ENTER_MAX_MS for e in rising), entering
    with visit(browser, f"{app_url}/downtime", reduced_motion="reduce") as page:
        page.set_viewport_size(LAPTOP)
        assert page.evaluate(INFINITE_JS) == []
        h1 = page.get_by_role("heading", level=1)
        down = h1.get_by_text(re.compile(r"^\s*down\s*$", re.I))
        eventually(page, lambda: expect(down).to_have_count(1, timeout=STEP_MS), EXPECT_SECONDS)
        assert style(down, "opacity")["opacity"] == "1"
        assert page.evaluate("() => document.getElementsByTagName('h1')[0].getAnimations({subtree: true}).filter(a => a.playState === 'running').length") == 0
        orbs = [page.get_by_text(f"{s['number']:02d}", exact=True).last for s in SCENARIOS]
        for orb in orbs:
            samples = scroll_samples(page, orb, [0, int(page.evaluate("() => document.body.scrollHeight"))], "color", "background-color", "box-shadow")
            assert samples[0] == samples[1] == lit_style, samples
        page.evaluate("() => window.scrollTo(0, 0)")
        page.get_by_role("button", name=re.compile(r"^(Play|Pause) briefing$")).scroll_into_view_if_needed()
        eventually(page, lambda: expect(page.get_by_role("button", name="Play briefing")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate(VIDEO_JS)["paused"] is True
        page.get_by_role("heading", name="FAQs").scroll_into_view_if_needed()
        assert [e for e in page.evaluate(ENTERING_JS) if e["moves"]] == []
        assert page.evaluate(INFINITE_JS) == []


def test_accessibility(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "a11y")
    with visit(browser, f"{app_url}/downtime") as page:
        for path in ("/downtime", "/signup", "/login", "/", "/community", "/downtime/scenarios/repossessed"):
            page.goto(app_url + path)
            axe(page)
        ui_login(page, app_url, p, "/downtime/team")
        eventually(page, lambda: expect(page.get_by_role("button", name="Join an existing team")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        axe(page)
        page.goto(f"{app_url}/downtime")
        page.set_viewport_size(LAPTOP)
        for control in (page.get_by_role("link", name="Join event").first, page.get_by_role("button", name="View prizes"),
                        page.get_by_role("button", name=FAQ_QUESTIONS[0], exact=True)):
            _, focused = state_styles(control, "outline-style", "outline-width", state="focus")
            assert focused["outline-style"] not in ("none", "") and float(focused["outline-width"].rstrip("px") or 0) > 0, focused
        for button in page.get_by_role("button").all():
            if button.is_visible():
                b = box(button)
                assert b["width"] >= TOUCH_MIN - 0.5 and b["height"] >= TOUCH_MIN - 0.5, (button.get_attribute("aria-label") or button.inner_text(), b)
        opener = page.get_by_role("button", name="View prizes")
        click(opener)
        dialog = page.get_by_role("dialog", name="Prizes")
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), key
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)


def test_responsive_layout(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/downtime") as page:
        perks = [page.get_by_text(line, exact=True).first for line in PERK_LINES]
        faq = [page.get_by_role("button", name=q_, exact=True) for q_ in FAQ_QUESTIONS]
        for viewport in (NARROW, PHONE, TABLET, LAPTOP):
            page.set_viewport_size(viewport)
            layout(page)
        page.set_viewport_size(LAPTOP)
        boxes = [box(p_) for p_ in perks]
        assert all(same_row(boxes[0], b) for b in boxes), boxes
        assert len({round(box(b)["x"]) for b in faq}) == 2
        table, feed = box(page.get_by_role("table", name="Live Leaderboard")), box(page.get_by_role("list", name="Activity feed"))
        assert feed["x"] >= table["x"] + table["width"] - 1 or table["x"] >= feed["x"] + feed["width"] - 1
        page.set_viewport_size(TABLET)
        boxes = [box(p_) for p_ in perks]
        assert same_row(boxes[0], boxes[1]) and same_row(boxes[2], boxes[3]) and not same_row(boxes[0], boxes[2])
        assert len({round(box(b)["x"]) for b in faq}) == 1
        page.set_viewport_size(PHONE)
        page.evaluate("() => window.scrollTo(0, 0)")
        boxes = [box(p_) for p_ in perks]
        assert len({round(b["x"]) for b in boxes}) == 1
        join_box = box(page.get_by_role("link", name="Join event").first)
        create_box = box(page.get_by_role("button", name="Create a team").first)
        assert not same_row(join_box, create_box)
        assert abs(join_box["width"] - create_box["width"]) <= 1 and join_box["width"] > PHONE["width"] / 2
        eventually(page, lambda: expect(page.get_by_role("button", name="Menu")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)


def test_wf_deployment_peer_board(browser: Browser, app_url: str, peer: str) -> None:
    expected = ok(get(app_url, "/api/leaderboard"))["entries"]
    with visit(browser, f"{peer}/downtime") as page:
        table = page.get_by_role("table", name="Live Leaderboard")
        for e in expected:
            eventually(page, lambda e=e: expect(table.get_by_role("row").filter(has_text=e["team_name"])).to_have_count(1, timeout=STEP_MS), UI_WAIT_SECONDS)
    assert [e["team_id"] for e in ok(get(peer, "/api/leaderboard"))["entries"]] == [e["team_id"] for e in expected]


def test_wf_deployment_outage(browser: Browser) -> None:
    down = os.environ["APP_POSTGRES_DOWN_URL"].rstrip("/")
    with visit(browser, f"{down}/downtime") as page:
        eventually(page, lambda: expect(page.get_by_role("heading", level=1)).to_be_visible(timeout=STEP_MS), UI_WAIT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(OUTAGE_COPY).first).to_be_visible(timeout=STEP_MS), UI_WAIT_SECONDS)
    refused(get(down, "/api/leaderboard"), 503, "unavailable")


def test_wf_accounts_signup_return(browser: Browser, app_url: str) -> None:
    email, tag = fresh("wf-signup")
    with visit(browser, f"{app_url}/downtime") as page:
        click(page.get_by_role("link", name="Join event").first)
        page.wait_for_url(lambda u: urlsplit(u).path == "/signup")
        assert parse_qs(urlsplit(page.url).query).get("redirect") == ["/downtime"]
        cross = page.get_by_role("main").get_by_role("link", name="Log in", exact=True)
        assert parse_qs(urlsplit(cross.get_attribute("href") or "").query).get("redirect") == ["/downtime"]
        click(page.get_by_role("button", name="Create account"))
        summary = status_region(page, "Account messages")
        eventually(page, lambda: expect(summary).to_contain_text("Fix the highlighted fields:", timeout=STEP_MS), EXPECT_SECONDS)
        link = summary.get_by_role("link").first
        eventually(page, lambda: expect(link).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        click(link)
        assert page.evaluate("() => document.activeElement && document.activeElement.tagName") in ("INPUT", "TEXTAREA")
        fill(page.get_by_role("textbox", name="Email"), "not-an-email")
        fill(page.get_by_role("textbox", name="Display name"), tag[:NAME_MAX])
        fill(page.get_by_label("Password", exact=True), "short")
        click(page.get_by_role("button", name="Create account"))
        eventually(page, lambda: expect(page.get_by_text("Enter a valid email").first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text("Password must be 8 to 128 characters").first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_label("Password", exact=True), "wf-signup-pw-2026")
        click(page.get_by_role("button", name="Create account"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime", timeout=UI_WAIT_SECONDS * 1000)
        eventually(page, lambda: expect(page.get_by_role("banner").get_by_role("button", name="Log out")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("banner").get_by_text(tag[:NAME_MAX])).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
    assert count(f"users where email = {q(email)}") == 1


def test_wf_accounts_login_errors(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "wf-login")
    with visit(browser, f"{app_url}/login?redirect=%2Fdowntime%23webinar") as page:
        cross = page.get_by_role("main").get_by_role("link", name="Create account")
        assert parse_qs(urlsplit(cross.get_attribute("href") or "").query).get("redirect") == ["/downtime#webinar"]
        fill(page.get_by_role("textbox", name="Email"), p.email)
        fill(page.get_by_label("Password", exact=True), p.password + "-wrong")
        region = status_region(page, "Account messages")
        with held(page, "**/api/auth/login") as gate:
            click(page.get_by_role("button", name="Log in", exact=True))
            eventually(page, lambda: expect(region).to_contain_text("Signing in\u2026", timeout=STEP_MS), EXPECT_SECONDS)
            eventually(page, lambda: expect(page.get_by_role("button", name="Log in", exact=True)).to_be_disabled(timeout=STEP_MS), EXPECT_SECONDS)
            gate.release()
        eventually(page, lambda: expect(region).to_contain_text("Email or password is incorrect.", timeout=STEP_MS), EXPECT_SECONDS)
        fill(page.get_by_label("Password", exact=True), p.password)
        click(page.get_by_role("button", name="Log in", exact=True))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime" and urlsplit(u).fragment == "webinar")
    assert count(f"login_attempts where email = {q(p.email)} and succeeded") == 1


def test_wf_accounts_logout(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "wf-logout")
    with visit(browser, f"{app_url}/downtime") as page:
        captured: dict[str, str] = {}

        def keep_token(route: Any) -> None:
            response = route.fetch()
            captured["token"] = response.json()["token"]
            route.fulfill(response=response)

        page.route("**/api/auth/login", keep_token)
        ui_login(page, app_url, p, "/glossary")
        token = captured["token"]
        assert ok(get(app_url, "/api/me", token))["user"]["id"] == p.id
        click(page.get_by_role("banner").get_by_role("button", name="Log out"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime")
        eventually(page, lambda: expect(page.get_by_role("banner").get_by_role("link", name="Log In")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
    refused(get(app_url, "/api/me", token), 401, "unauthenticated")


def test_wf_access_captain_remove(browser: Browser, app_url: str) -> None:
    team, (cap, member) = squad(app_url, 2, "wf-remove")
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, cap, "/downtime/team")
        opener = page.get_by_role("button", name=f"Remove {member.name}")
        click(opener)
        dialog = page.get_by_role("dialog", name="Remove member")
        eventually(page, lambda: expect(dialog).to_contain_text(member.name, timeout=STEP_MS), EXPECT_SECONDS)
        click(dialog.get_by_role("button", name="Cancel"))
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)
        click(opener)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(opener).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)
        assert member_ids(team["id"]) == {cap.id, member.id}
        click(opener)
        click(page.get_by_role("dialog", name="Remove member").get_by_role("button", name="Remove", exact=True))
        messages = status_region(page, "Team messages")
        eventually(page, lambda: expect(messages).to_contain_text(f"{member.name} was removed", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(opener).to_have_count(0, timeout=STEP_MS), EXPECT_SECONDS)
        new_code = team_row(team["id"])["invite_code"]
        assert new_code != team["invite_code"]
        eventually(page, lambda: expect(page.get_by_text(new_code).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        rotate_button = page.get_by_role("button", name="New invite code")
        eventually(page, lambda: expect(rotate_button).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)
        click(rotate_button)
        eventually(page, lambda: expect(messages).to_contain_text("New invite code issued", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(team_row(team["id"])["invite_code"]).first).to_be_visible(timeout=STEP_MS))
    assert team_row(team["id"])["invite_code"] != new_code
    refused(get(app_url, "/api/teams/mine", member.token), 404, "not_in_team")


def test_wf_access_member_view(browser: Browser, app_url: str) -> None:
    team, (cap, member, third) = squad(app_url, 3, "wf-member")
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, member, "/downtime/team")
        eventually(page, lambda: expect(page.get_by_text("Captain", exact=True).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(third.name).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("button", name=re.compile(r"^Remove "))).to_have_count(0, timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("button", name="New invite code")).to_have_count(0, timeout=STEP_MS), EXPECT_SECONDS)
    assert member_ids(team["id"]) == {cap.id, member.id, third.id}


def test_wf_teams_create_join(browser: Browser, app_url: str) -> None:
    cap, colleague = crew(app_url, 2, "wf-team")
    name = team_name()
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, cap, "/downtime#registration")
        click(page.locator("#registration").get_by_role("button", name="Create a team"))
        dialog = page.get_by_role("dialog", name="Create a team")
        fill(dialog.get_by_role("textbox", name="Team name"), name)
        click(dialog.get_by_role("button", name="Create team"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime/team", timeout=UI_WAIT_SECONDS * 1000)
        team = me(app_url, cap)["team"]
        assert team["name"] == name and team["is_captain"] is True
        eventually(page, lambda: expect(page.get_by_text(name).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(team["invite_code"]).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("button", name="Copy code")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text("Captain", exact=True).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        zone = session(page)
        zone.send("Emulation.setTimezoneOverride", {"timezoneId": FAR_ZONE})
        page.reload()
        assert page.evaluate("() => Intl.DateTimeFormat().resolvedOptions().timeZone") == FAR_ZONE
        eventually(page, lambda: expect(page.get_by_text(name).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        page.evaluate("() => { window.__stay = true; }")
        with visit(browser, f"{app_url}/downtime") as other:
            ui_login(other, app_url, colleague, "/downtime")
            click(other.get_by_role("button", name="Join an existing team"))
            join_dialog = other.get_by_role("dialog", name="Join an existing team")
            fill(join_dialog.get_by_role("textbox", name="Invite code"), team["invite_code"].lower())
            click(join_dialog.get_by_role("button", name="Join team"))
            other.wait_for_url(lambda u: urlsplit(u).path == "/downtime/team", timeout=UI_WAIT_SECONDS * 1000)
            eventually(other, lambda: expect(other.get_by_text(name).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(colleague.name).first).to_be_visible(timeout=STEP_MS), LIVE_UI_SECONDS)
        for m in mine(app_url, cap)["members"]:
            variants = "|".join(re.escape(t) for t in utc_texts(m["joined_at"]))
            eventually(page, lambda: expect(page.get_by_text(re.compile(f"Joined ({variants})")).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        solve(app_url, colleague, "day-o")
        solve(app_url, colleague, "the-waiting-room")
        score = BY_SLUG["day-o"]["points"] + BY_SLUG["the-waiting-room"]["points"]
        eventually(page, lambda: expect(page.get_by_text(re.compile(rf"\b{score}\b")).first).to_be_visible(timeout=STEP_MS), LIVE_UI_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(re.compile(r"^[\s\u2713\u2714]*Solved by the team$"))).to_have_count(2, timeout=STEP_MS), LIVE_UI_SECONDS)
        assert page.evaluate("() => window.__stay") is True
    assert member_ids(team["id"]) == {cap.id, colleague.id}


def test_wf_teams_join_errors(browser: Browser, app_url: str) -> None:
    cap, p = crew(app_url, 2, "wf-join")
    team = make_team(app_url, cap)
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, p, "/downtime#registration")
        click(page.locator("#registration").get_by_role("button", name="Create a team"))
        create = page.get_by_role("dialog", name="Create a team")
        fill(create.get_by_role("textbox", name="Team name"), "ab")
        click(create.get_by_role("button", name="Create team"))
        eventually(page, lambda: expect(status_region(page, "Team messages")).to_contain_text("Team names are 3 to 24 letters, digits, spaces, hyphens or underscores", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(create.get_by_role("textbox", name="Team name")).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)
        fill(create.get_by_role("textbox", name="Team name"), team["name"].lower())
        click(create.get_by_role("button", name="Create team"))
        eventually(page, lambda: expect(status_region(page, "Team messages")).to_contain_text("That team name is taken", timeout=STEP_MS), EXPECT_SECONDS)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(create).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        click(page.get_by_role("button", name="Join an existing team"))
        dialog = page.get_by_role("dialog", name="Join an existing team")
        field = dialog.get_by_role("textbox", name="Invite code")
        click(dialog.get_by_role("button", name="Join team"))
        eventually(page, lambda: expect(status_region(page, "Team messages")).to_contain_text("Enter an invite code", timeout=STEP_MS), EXPECT_SECONDS)
        fill(field, "QZQZ0909")
        with held(page, "**/api/teams/join") as gate:
            click(dialog.get_by_role("button", name="Join team"))
            eventually(page, lambda: expect(status_region(page, "Team messages")).to_contain_text("Joining team\u2026", timeout=STEP_MS), EXPECT_SECONDS)
            eventually(page, lambda: expect(dialog.get_by_role("button", name="Join team")).to_be_disabled(timeout=STEP_MS), EXPECT_SECONDS)
            gate.release()
        eventually(page, lambda: expect(status_region(page, "Team messages")).to_contain_text("That invite code does not match a team", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(field).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)
        fill(field, team["invite_code"])
        click(dialog.get_by_role("button", name="Join team"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime/team", timeout=UI_WAIT_SECONDS * 1000)
    assert member_ids(team["id"]) == {cap.id, p.id}


def test_wf_teams_leave(browser: Browser, app_url: str) -> None:
    team, (cap, leaver, removed) = squad(app_url, 3, "wf-leave")
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, leaver, "/downtime/team")
        click(page.get_by_role("button", name="Leave team"))
        click(page.get_by_role("dialog", name="Leave team").get_by_role("button", name="Leave", exact=True))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime" and urlsplit(u).fragment == "registration")
    assert me(app_url, leaver)["team"] is None
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, removed, "/downtime/team")
        eventually(page, lambda: expect(page.get_by_text(team["name"]).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert remove(app_url, cap, removed.id).status_code == 204
        eventually(page, lambda: expect(status_region(page, "Team messages")).to_contain_text("You are no longer in this team", timeout=STEP_MS), LIVE_UI_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("button", name="Create a team").last).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("button", name="Join an existing team")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)


def test_wf_flags_solve(browser: Browser, app_url: str) -> None:
    team, (p,) = squad(app_url, 1, "wf-flag")
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, p, "/downtime/scenarios/repossessed")
        s = BY_SLUG["repossessed"]
        eventually(page, lambda: expect(page.get_by_role("heading", name=s["title"]).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert_copy(page, KIND_LABEL[s["kind"]], s["description"], str(s["points"]), "Not attempted")
        field = page.get_by_role("textbox", name="Flag")
        region = status_region(page, "Flag result")
        fill(field, WRONG_FLAG)
        with held(page, "**/api/scenarios/repossessed/flag") as gate:
            click(page.get_by_role("button", name="Submit flag"))
            eventually(page, lambda: expect(region).to_contain_text("Checking flag\u2026", timeout=STEP_MS), EXPECT_SECONDS)
            eventually(page, lambda: expect(page.get_by_role("button", name="Submit flag")).to_be_disabled(timeout=STEP_MS), EXPECT_SECONDS)
            gate.release()
        eventually(page, lambda: expect(region).to_contain_text("That flag is not right", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(field).to_have_value(WRONG_FLAG, timeout=STEP_MS), EXPECT_SECONDS)
        fill(field, s["flag"])
        click(page.get_by_role("button", name="Submit flag"))
        eventually(page, lambda: expect(region).to_contain_text(f"Solved! +{s['points']} for your team and +1 raffle ticket", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(word(page, "Solved")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        fill(field, s["flag"])
        click(page.get_by_role("button", name="Submit flag"))
        eventually(page, lambda: expect(region).to_contain_text("Already completed", timeout=STEP_MS), EXPECT_SECONDS)
    assert count(f"team_solves where team_id = {team['id']} and scenario_slug = 'repossessed'") == 1


def test_wf_flags_refusals(browser: Browser, app_url: str) -> None:
    loner = signup(app_url, "wf-loner")
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, loner, "/downtime/scenarios/day-o")
        fill(page.get_by_role("textbox", name="Flag"), FLAG["day-o"])
        click(page.get_by_role("button", name="Submit flag"))
        eventually(page, lambda: expect(status_region(page, "Flag result")).to_contain_text("Join or create a team first", timeout=STEP_MS), EXPECT_SECONDS)
    assert count(f"flag_attempts where user_id = {loner.id}") == 0
    team, (p,) = squad(app_url, 1, "wf-locked")
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, p, "/downtime/scenarios/day-o")
        region = status_region(page, "Flag result")
        click(page.get_by_role("button", name="Submit flag"))
        eventually(page, lambda: expect(region).to_contain_text("Enter a flag", timeout=STEP_MS), EXPECT_SECONDS)
        assert count(f"flag_attempts where user_id = {p.id}") == 0
        for _ in range(WRONG_FLAG_LIMIT):
            submit(app_url, p, "day-o", WRONG_FLAG)
        fill(page.get_by_role("textbox", name="Flag"), FLAG["day-o"])
        click(page.get_by_role("button", name="Submit flag"))
        eventually(page, lambda: expect(region).to_contain_text("Too many wrong flags. Try again in a minute.", timeout=STEP_MS), EXPECT_SECONDS)
    assert count(f"flag_attempts where user_id = {p.id}") == WRONG_FLAG_LIMIT


def test_wf_scoring_live_board(browser: Browser, app_url: str) -> None:
    team, (p,) = squad(app_url, 1, "wf-live")
    with visit(browser, f"{app_url}/downtime?board=2") as page:
        table = page.get_by_role("table", name="Live Leaderboard")
        for column in ("Rank", "Team", "SOC Simulator", "TH Simulator", "Tabletop", "Challenges", "Points"):
            eventually(page, lambda column=column: expect(table.get_by_role("columnheader", name=column)).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        feed = page.get_by_role("list", name="Activity feed")
        eventually(page, lambda: expect(feed).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("navigation", name="Leaderboard pages").get_by_role("button", name="2", exact=True)).to_have_attribute("aria-current", "page", timeout=STEP_MS), EXPECT_SECONDS)
        length = page.evaluate("() => history.length")
        url = page.url
        title = BY_SLUG["quiet-as-the-grave"]["title"]
        solve(app_url, p, "quiet-as-the-grave")
        line = f"{team['name']} solved {title}"
        eventually(page, lambda: expect(feed).to_contain_text(line, timeout=STEP_MS), LIVE_UI_SECONDS)
        eventually(page, lambda: expect(status_region(page, "Leaderboard updates")).to_contain_text(line, timeout=STEP_MS), EXPECT_SECONDS)
        expected = ok(get(app_url, "/api/leaderboard", params={"page": 2}))["entries"]
        for e in expected:
            eventually(page, lambda e=e: expect(table.get_by_role("row").filter(has_text=e["team_name"])).to_have_count(1, timeout=STEP_MS), LIVE_UI_SECONDS)
        assert page.url == url and page.evaluate("() => history.length") == length
        page.set_viewport_size(PHONE)
        for column in ("SOC Simulator", "TH Simulator", "Tabletop"):
            eventually(page, lambda column=column: expect(table.get_by_role("columnheader", name=column)).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        for column in ("Rank", "Team", "Challenges", "Points"):
            eventually(page, lambda column=column: expect(table.get_by_role("columnheader", name=column)).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
    assert entry_for(app_url, team["id"])["points"] == BY_SLUG["quiet-as-the-grave"]["points"]


def page_labels(current: int, pages: int) -> list[str]:
    if pages <= SHOW_ALL_PAGES:
        return [str(n) for n in range(1, pages + 1)]
    shown = sorted({1, pages, current - 1, current, current + 1} & set(range(1, pages + 1)))
    labels, previous = [], 0
    for n in shown:
        gap = n - previous - 1
        if gap >= 2:
            labels.append("\u2026")
        elif gap == 1:
            labels.append(str(n - 1))
        labels.append(str(n))
        previous = n
    return labels


def nav_labels(nav: Any) -> list[str]:
    text = re.sub(r"\d+ of \d+ available pages", "", nav.inner_text())
    return re.findall(r"\d+|\u2026", text)


def test_wf_scoring_board_paging(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/downtime") as page:
        nav = page.get_by_role("navigation", name="Leaderboard pages")
        pages = ok(get(app_url, "/api/leaderboard"))["pages"]
        eventually(page, lambda: expect(nav.get_by_role("button", name="Previous")).to_be_disabled(timeout=STEP_MS), EXPECT_SECONDS)
        assert nav_labels(nav) == page_labels(1, pages)
        assert f"1 of {pages} available pages" in page_text(page)
        page.goto(f"{app_url}/downtime?board={pages}")
        eventually(page, lambda: expect(nav.get_by_role("button", name=str(pages), exact=True)).to_have_attribute("aria-current", "page", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(nav.get_by_role("button", name="Next")).to_be_disabled(timeout=STEP_MS), EXPECT_SECONDS)
        assert nav_labels(nav) == page_labels(pages, pages)
        assert f"{pages} of {pages} available pages" in page_text(page)


def test_wf_certificate_collect(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "wf-cert")
    team = finished_team(app_url, p)
    issued = ok(get(app_url, "/api/me/certificate", p.token))["issued_on"]
    with visit(browser, f"{app_url}/downtime") as page:
        zone = session(page)
        zone.send("Emulation.setTimezoneOverride", {"timezoneId": FAR_ZONE})
        ui_login(page, app_url, p, "/downtime/team")
        click(page.get_by_role("link", name="Collect your certificate"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime/certificate")
        eventually(page, lambda: expect(page.get_by_role("button", name="Download certificate")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert_copy(page, "Certificate of completion", p.name, team["name"], EVENT_NAME, "22 to 26 October 2026")
        text = page_text(page)
        assert any(f"Completed {t}" in text for t in utc_texts(issued)), text
        with page.expect_download() as download:
            click(page.get_by_role("button", name="Download certificate"))
        _, texts = svg_texts(Path(download.value.path()).read_bytes())
        assert p.name in texts and team["name"] in texts


def test_wf_certificate_download_pending(browser: Browser, app_url: str) -> None:
    # Feedback states: while an action is pending, its button is disabled (here, Download certificate).
    p = signup(app_url, "wf-cert-pending")
    team = finished_team(app_url, p)
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, p, "/downtime/certificate")
        button = page.get_by_role("button", name="Download certificate")
        eventually(page, lambda: expect(button).to_be_enabled(timeout=STEP_MS), EXPECT_SECONDS)
        with page.expect_download() as download:
            with held(page, "**/api/me/certificate/image") as gate:
                click(button)
                eventually(page, lambda: expect(button).to_be_disabled(timeout=STEP_MS), EXPECT_SECONDS)
                gate.release()
        eventually(page, lambda: expect(button).to_be_enabled(timeout=STEP_MS), EXPECT_SECONDS)
        _, texts = svg_texts(Path(download.value.path()).read_bytes())
        assert p.name in texts and team["name"] in texts

def test_wf_certificate_not_complete(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "wf-cert-not")
    make_team(app_url, p)
    for s in SCENARIOS[:5]:
        solve(app_url, p, s["slug"])
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, p, "/downtime/certificate")
        region = status_region(page, "Certificate status")
        eventually(page, lambda: expect(region).to_contain_text("Your team has not completed the event yet", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(region).to_contain_text("3 scenarios to go", timeout=STEP_MS), EXPECT_SECONDS)
        for s in SCENARIOS[5:7]:
            solve(app_url, p, s["slug"])
        page.reload()
        eventually(page, lambda: expect(status_region(page, "Certificate status")).to_contain_text("1 scenario to go", timeout=STEP_MS), EXPECT_SECONDS)
    refused(get(app_url, "/api/me/certificate", p.token), 403, "not_complete")


def test_wf_event_data_calendar(browser: Browser, app_url: str) -> None:
    event = ok(get(app_url, "/api/event"))
    with visit(browser, f"{app_url}/downtime") as page:
        with page.expect_download() as download:
            click(page.get_by_role("link", name="Add to calendar"))
        assert download.value.suggested_filename == "downtime.ics"
        check_calendar(Path(download.value.path()).read_bytes(), event)


def test_wf_event_data_scenario_page(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/downtime") as page:
        bodies: list[str] = []

        def keep(r: Any) -> None:
            if urlsplit(r.url).path.startswith("/api/") and "stream" not in r.url:
                with contextlib.suppress(PlaywrightError):
                    bodies.append(r.text())

        page.on("response", keep)
        click(trail_link(page, BY_SLUG["day-o"]))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime/scenarios/day-o")
        facts = ok(get(app_url, "/api/scenarios/day-o"))["scenario"]
        eventually(page, lambda: expect(page.get_by_role("heading", name=facts["title"]).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert_copy(page, facts["description"])
        for body in bodies:
            for flag in FLAG.values():
                assert flag not in body


def test_wf_event_page_hero(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "wf-hero")
    with visit(browser, f"{app_url}/downtime") as page:
        assert (page.get_by_role("link", name="Join event").first.get_attribute("href") or "").endswith("/signup?redirect=%2Fdowntime")
        assert (page.get_by_role("link", name="Log in to submit flag").get_attribute("href") or "").endswith("/login?redirect=%2Fdowntime%23webinar")
        click(page.get_by_role("button", name="Join an existing team"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/login")
        assert parse_qs(urlsplit(page.url).query).get("redirect") == ["/downtime#registration"]
        fill(page.get_by_role("textbox", name="Email"), p.email)
        fill(page.get_by_label("Password", exact=True), p.password)
        click(page.get_by_role("button", name="Log in", exact=True))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime" and urlsplit(u).fragment == "registration")
        click(page.locator("#registration").get_by_role("button", name="Create a team"))
        eventually(page, lambda: expect(page.get_by_role("dialog", name="Create a team")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
    assert me(app_url, p)["team"] is None


def test_wf_event_page_webinar(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "wf-webinar")
    with visit(browser, f"{app_url}/downtime") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        ui_login(page, app_url, p, "/downtime#webinar")
        assert_copy(page, "FREE LIVE WEBINAR FOR MANAGERS", "Share the webinar with your manager")
        click(page.get_by_role("button", name="Copy link"))
        region = status_region(page, "Webinar messages")
        eventually(page, lambda: expect(region).to_contain_text("Link copied", timeout=STEP_MS), EXPECT_SECONDS)
        copied = page.evaluate("() => navigator.clipboard.readText()")
        assert same_origin(copied, app_url) and copied.endswith("/downtime#webinar"), copied
        field = page.get_by_role("textbox", name="Webinar flag")
        fill(field, WRONG_FLAG)
        click(page.get_by_role("button", name="Claim tickets"))
        eventually(page, lambda: expect(region).to_contain_text("That flag is not right", timeout=STEP_MS), EXPECT_SECONDS)
        fill(field, WEBINAR_FLAG)
        click(page.get_by_role("button", name="Claim tickets"))
        eventually(page, lambda: expect(region).to_contain_text("+2 raffle tickets claimed", timeout=STEP_MS), EXPECT_SECONDS)
        fill(field, WEBINAR_FLAG)
        click(page.get_by_role("button", name="Claim tickets"))
        eventually(page, lambda: expect(region).to_contain_text("Already claimed", timeout=STEP_MS), EXPECT_SECONDS)
    assert count(f"webinar_claims where user_id = {p.id}") == 1 and me(app_url, p)["tickets"] == WEBINAR_TICKETS


def test_wf_cross_cutting_keyboard(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/downtime") as page:
        opener = page.get_by_role("button", name="View prizes")
        ready(opener).focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Prizes")
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)
        question = page.get_by_role("button", name=FAQ_QUESTIONS[0], exact=True)
        ready(question).focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(question).to_have_attribute("aria-expanded", "true", timeout=STEP_MS), EXPECT_SECONDS)
        page.keyboard.press(" ")
        eventually(page, lambda: expect(question).to_have_attribute("aria-expanded", "false", timeout=STEP_MS), EXPECT_SECONDS)


def test_wf_cross_cutting_not_found(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/no-such-page-moth") as page:
        assert page.evaluate("() => [...document.links].some(a => new URL(a.href).pathname === '/downtime')")
        page.evaluate("() => [...document.links].find(a => new URL(a.href).pathname === '/downtime').click()")
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime")
        eventually(page, lambda: expect(page.get_by_role("heading", level=1)).to_have_accessible_name("It's Downtime!", timeout=STEP_MS), EXPECT_SECONDS)


def canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def shipped_packages() -> list[metadata.Distribution]:
    site = next(Path(DEPLOYED_APP, ".venv", "lib").glob("python3*/site-packages"))
    pkgs = [d for d in metadata.distributions(path=[str(site)])
            if canonical(d.metadata["Name"]) not in {"pip", "setuptools", "wheel"}]
    assert pkgs, f"no installed packages listed under {site}"
    return pkgs


def notices() -> str:
    return (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip(), key
    assert ".venv" in manifest["install"] and ".venv" in manifest["serve"]
    assert Path(DEPLOYED_APP, ".venv").is_dir()


def test_if_user_readme() -> None:
    text = (APP_ROOT / "USER_README.md").read_text()
    for needle in ("captain@example.com", SEED_PASSWORD, "SIGN_IN_LOCK_SECONDS"):
        assert needle in text, needle


def test_if_empty_dirs() -> None:
    for name in (".browser_screenshots", ".downloads"):
        path = APP_ROOT / name
        assert path.is_dir() and not any(path.iterdir()), name


def test_if_notices() -> None:
    text = notices()
    flat = canonical(text)
    for dist in shipped_packages():
        assert canonical(dist.metadata["Name"]) in flat, dist.metadata["Name"]
        assert dist.version in text, (dist.metadata["Name"], dist.version)


def test_if_licences() -> None:
    allowed = ("MIT", "BSD", "Apache", "ISC", "PSF", "Python Software Foundation", "MPL-2.0",
               "Mozilla Public License 2.0", "OFL")
    for dist in shipped_packages():
        fields = [dist.metadata.get("License-Expression") or "", dist.metadata.get("License") or ""]
        fields += [c for c in dist.metadata.get_all("Classifier") or [] if c.startswith("License ::")]
        assert any(token in " ".join(fields) for token in allowed), (dist.metadata["Name"], fields)


def test_if_single_datastore() -> None:
    others = {"redis-server", "memcached", "mongod", "rabbitmq-server", "mysqld", "etcd", "kafka"}
    for comm in Path("/proc").glob("[0-9]*/comm"):
        with contextlib.suppress(OSError):
            assert comm.read_text().strip() not in others, comm.read_text()
    for path in Path(DEPLOYED_APP).rglob("*"):
        if ".venv" not in path.parts and path.suffix in {".sqlite", ".sqlite3", ".db"}:
            raise AssertionError(f"local datastore file {path}")


def test_if_media_untouched() -> None:
    known = {FILM_SHA, SOUND_SHA}
    found = {hashlib.sha256(p.read_bytes()).hexdigest() for p in (APP_ROOT / "assets").iterdir()
             if p.is_file() and p.suffix in {".webm", ".ogg"}}
    assert found == known, found
    media = {".webm", ".ogg", ".mp4", ".mp3", ".wav", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}
    for path in APP_ROOT.rglob("*"):
        if path.is_file() and path.suffix.lower() in media and not {".venv", "node_modules", ".git"} & set(path.parts):
            assert hashlib.sha256(path.read_bytes()).hexdigest() in known, path


def test_if_no_analytics() -> None:
    rows = pg().rows("select table_name, column_name from information_schema.columns "
                     "where table_schema not in ('pg_catalog', 'information_schema')")
    marker = re.compile(r"analytic|tracking|visitor_id|client_id|fingerprint", re.I)
    assert not [r for r in rows if marker.search(r["column_name"]) or marker.search(r["table_name"])]


def test_if_out_of_scope(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/downtime") as page:
        for path in ("/downtime", "/login", "/signup"):
            page.goto(f"{app_url}{path}")
            links = page.evaluate("() => [...document.links].map(a => a.href)")
            assert all(same_origin(href, app_url) for href in links if href.startswith("http")), links
            eventually(page, lambda: expect(page.get_by_role("searchbox")).to_have_count(0, timeout=STEP_MS), EXPECT_SECONDS)


def test_if_no_volumes() -> None:
    for name in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"):
        path = APP_ROOT / name
        if path.exists():
            text = path.read_text()
            for key in ("volumes:", "container_name:", "networks:"):
                assert key not in text, (name, key)


def test_query_bounds(app_url: str) -> None:
    for params, limit in (
        ({"page": str(ID_MAX)}, DEFAULT_LIMIT),
        ({"page": str(ID_MAX), "limit": str(LIMIT_CAP)}, LIMIT_CAP),
        ({"page": str(2**62)}, DEFAULT_LIMIT),
        ({"page": str(ID_MAX - 1), "limit": str(ID_MAX)}, LIMIT_CAP),
        ({"page": str(ID_MAX), "include_feed": "1"}, DEFAULT_LIMIT),
        ({"limit": str(ID_MAX)}, LIMIT_CAP),
    ):
        body = ok(get(app_url, "/api/leaderboard", params=params))
        assert body["limit"] == limit and body["pages"] == -(-body["total"] // limit), (params, body)
        if "page" in params:
            assert body["entries"] == [], params
        else:
            assert len(body["entries"]) == min(body["total"], LIMIT_CAP), params


def test_wf_flags_scenario_steps(browser: Browser, app_url: str) -> None:
    team, (p, mate) = squad(app_url, 2, "wf-steps")
    first, second, third = SCENARIOS[0], SCENARIOS[1], SCENARIOS[2]
    solve(app_url, mate, second["slug"])
    assert ok(submit(app_url, p, third["slug"], WRONG_FLAG))["correct"] is False
    badge = re.compile(r"^[\s✓✔]*Solved$")
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, p, f"/downtime/scenarios/{first['slug']}")
        steps = page.get_by_role("navigation", name="Scenario steps")
        previous = steps.get_by_role("button", name="Previous scenario", exact=True)
        following = steps.get_by_role("button", name="Next scenario", exact=True)
        title = page.get_by_role("heading", level=1)
        field = page.get_by_role("textbox", name="Flag")
        region = status_region(page, "Flag result")
        eventually(page, lambda: expect(title).to_have_text(first["title"], timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(previous).to_be_disabled(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(following).to_be_enabled(timeout=STEP_MS), EXPECT_SECONDS)
        fill(field, WRONG_FLAG)
        click(page.get_by_role("button", name="Submit flag"))
        eventually(page, lambda: expect(region).to_contain_text("That flag is not right", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(field).to_have_value(WRONG_FLAG, timeout=STEP_MS), EXPECT_SECONDS)
        page.evaluate("() => { window.__stay = true; }")
        start = page.evaluate("() => history.length")
        click(following)
        page.wait_for_url(lambda u: urlsplit(u).path == f"/downtime/scenarios/{second['slug']}")
        eventually(page, lambda: expect(title).to_have_text(second["title"], timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(word(page, "Solved by the team")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(badge).locator("visible=true")).to_have_count(1, timeout=STEP_MS), EXPECT_SECONDS)
        assert_copy(page, KIND_LABEL[second["kind"]], second["description"])
        assert first["description"].casefold() not in page_text(page).casefold()
        eventually(page, lambda: expect(field).to_have_value("", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(region).to_have_text("", timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(following).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate("() => history.length") == start + 1
        click(following)
        page.wait_for_url(lambda u: urlsplit(u).path == f"/downtime/scenarios/{third['slug']}")
        eventually(page, lambda: expect(title).to_have_text(third["title"], timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(word(page, "Attempted")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(badge).locator("visible=true")).to_have_count(0, timeout=STEP_MS), EXPECT_SECONDS)
        assert_copy(page, KIND_LABEL[third["kind"]], third["description"])
        assert page.evaluate("() => history.length") == start + 2
        fill(field, FLAG[third["slug"]])
        click(page.get_by_role("button", name="Submit flag"))
        eventually(page, lambda: expect(region).to_contain_text(f"Solved! +{third['points']} for your team and +1 raffle ticket", timeout=STEP_MS), EXPECT_SECONDS)
        assert third["slug"] in me(app_url, p)["completions"]
        assert second["slug"] not in me(app_url, p)["completions"]
        page.evaluate("() => { window.__focus = document.activeElement; }")
        page.go_back()
        page.wait_for_url(lambda u: urlsplit(u).path == f"/downtime/scenarios/{second['slug']}")
        eventually(page, lambda: expect(title).to_have_text(second["title"], timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(word(page, "Solved by the team")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate("() => window.__stay === true && document.activeElement === window.__focus")
        page.go_forward()
        page.wait_for_url(lambda u: urlsplit(u).path == f"/downtime/scenarios/{third['slug']}")
        eventually(page, lambda: expect(title).to_have_text(third["title"], timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(word(page, "Solved by me")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(badge).locator("visible=true")).to_have_count(1, timeout=STEP_MS), EXPECT_SECONDS)
        page.go_back()
        page.go_back()
        page.wait_for_url(lambda u: urlsplit(u).path == f"/downtime/scenarios/{first['slug']}")
        eventually(page, lambda: expect(title).to_have_text(first["title"], timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(word(page, "Attempted")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(previous).to_be_disabled(timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate("() => window.__stay === true && document.activeElement === window.__focus")


def test_wf_teams_invite_link(browser: Browser, app_url: str) -> None:
    team, (cap,) = squad(app_url, 1, "wf-invite")
    joiner, guest = crew(app_url, 2, "wf-invitee")
    code = team["invite_code"]
    dialog_name = "Join an existing team"

    def address(page: Page) -> tuple[dict[str, list[str]], str]:
        parts = urlsplit(page.url)
        return parse_qs(parts.query, keep_blank_values=True), parts.fragment

    with visit(browser, f"{app_url}/downtime") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        ui_login(page, app_url, cap, "/downtime/team")
        eventually(page, lambda: expect(page.get_by_text(code, exact=True).first).to_be_visible(timeout=STEP_MS), UI_WAIT_SECONDS)
        click(page.get_by_role("button", name="Copy invite link"))
        eventually(page, lambda: expect(status_region(page, "Team messages")).to_contain_text("Invite link copied", timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate("() => navigator.clipboard.readText()") == f"{app_url}/downtime?join={code}#registration"
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, joiner, "/downtime")
        for value in ("ABC1234", "ABCD12345", "ABCD-123", "ＡBCD1234", ""):
            page.goto(f"{app_url}/downtime?keep=1&join={quote(value)}#webinar")
            page.wait_for_url(lambda u: "join" not in parse_qs(urlsplit(u).query, keep_blank_values=True))
            assert address(page) == ({"keep": ["1"]}, "webinar") and urlsplit(page.url).path == "/downtime", value
            page.wait_for_load_state("load")
            page.evaluate("() => new Promise(done => setTimeout(done, 1000))")
            eventually(page, lambda: expect(page.get_by_role("dialog", name=dialog_name)).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
            assert urlsplit(page.url).path == "/downtime", value
        start = page.evaluate("() => history.length")
        page.goto(f"{app_url}/downtime?keep=1&join={code.lower()}#webinar")
        dialog = page.get_by_role("dialog", name=dialog_name)
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=STEP_MS), UI_WAIT_SECONDS)
        field = dialog.get_by_role("textbox", name="Invite code")
        eventually(page, lambda: expect(field).to_have_value(code, timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(field).to_be_focused(timeout=STEP_MS), EXPECT_SECONDS)
        assert address(page) == ({"keep": ["1"]}, "webinar")
        assert page.evaluate("() => history.length") == start + 1
        assert me(app_url, joiner)["team"] is None
        click(dialog.get_by_role("button", name="Join team"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/downtime/team", timeout=UI_WAIT_SECONDS * 1000)
    assert me(app_url, joiner)["team"]["id"] == team["id"]
    with visit(browser, f"{app_url}/downtime?join={code.lower()}#registration") as page:
        page.wait_for_url(lambda u: urlsplit(u).path == "/login", timeout=UI_WAIT_SECONDS * 1000)
        assert parse_qs(urlsplit(page.url).query).get("redirect") == [f"/downtime?join={code}#registration"]
        fill(page.get_by_role("textbox", name="Email"), guest.email)
        fill(page.get_by_label("Password", exact=True), guest.password)
        click(page.get_by_role("button", name="Log in", exact=True))
        dialog = page.get_by_role("dialog", name=dialog_name)
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=STEP_MS), UI_WAIT_SECONDS)
        eventually(page, lambda: expect(dialog.get_by_role("textbox", name="Invite code")).to_have_value(code, timeout=STEP_MS), EXPECT_SECONDS)
        assert urlsplit(page.url).path == "/downtime" and address(page) == ({}, "registration")
    assert me(app_url, guest)["team"] is None


def test_wf_accounts_signed_in_pages(browser: Browser, app_url: str) -> None:
    p = signup(app_url, "wf-signed-in")
    with visit(browser, f"{app_url}/downtime") as page:
        captured: dict[str, str] = {}

        def keep_token(route: Any) -> None:
            response = route.fetch()
            captured["token"] = response.json()["token"]
            route.fulfill(response=response)

        page.route("**/api/auth/login", keep_token)
        ui_login(page, app_url, p, "/downtime")
        for path, redirect, lands in (
            ("/login", "/downtime#webinar", ("/downtime", "", "webinar")),
            ("/signup", "/glossary?x=1#top", ("/glossary", "x=1", "top")),
            ("/login", "//evil.example/x", ("/downtime", "", "")),
            ("/signup", None, ("/downtime", "", "")),
        ):
            start = page.evaluate("() => history.length")
            page.goto(f"{app_url}{path}" + (f"?redirect={quote(redirect, safe='')}" if redirect else ""))
            page.wait_for_url(lambda u: urlsplit(u).path == lands[0], timeout=UI_WAIT_SECONDS * 1000)
            parts = urlsplit(page.url)
            assert (parts.path, parts.query, parts.fragment) == lands, (path, redirect, page.url)
            assert page.evaluate("() => history.length") == start + 1, (path, redirect)
        ok(post(app_url, "/api/auth/logout", None, captured["token"]), 204)
        page.goto(f"{app_url}/login?redirect=%2Fglossary")
        page.wait_for_load_state("load")
        page.evaluate("() => new Promise(done => setTimeout(done, 1000))")
        assert urlsplit(page.url).path == "/login"
        eventually(page, lambda: expect(page.get_by_role("button", name="Log in", exact=True)).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        eventually(page, lambda: expect(page.get_by_role("banner").get_by_role("link", name="Log In")).to_be_visible(timeout=STEP_MS), UI_WAIT_SECONDS)
        page.goto(f"{app_url}/signup")
        eventually(page, lambda: expect(page.get_by_role("button", name="Create account")).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert urlsplit(page.url).path == "/signup"


def test_wf_certificate_live(browser: Browser, app_url: str) -> None:
    team, (cap, member) = squad(app_url, 2, "wf-cert-live")
    for s in SCENARIOS:
        solve(app_url, cap, s["slug"])
    with visit(browser, f"{app_url}/downtime") as page:
        ui_login(page, app_url, member, "/downtime/certificate")
        download = page.get_by_role("button", name="Download certificate")
        region = status_region(page, "Certificate status")
        eventually(page, lambda: expect(download).to_be_visible(timeout=STEP_MS), UI_WAIT_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(member.name).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        page.evaluate("() => { window.__stay = true; }")
        assert remove(app_url, cap, member.id).status_code == 204
        eventually(page, lambda: expect(region).to_contain_text("Your team has not completed the event yet", timeout=STEP_MS), LIVE_UI_SECONDS)
        eventually(page, lambda: expect(download).to_be_hidden(timeout=STEP_MS), EXPECT_SECONDS)
        code = ok(get(app_url, "/api/teams/mine", cap.token))["team"]["invite_code"]
        ok(join(app_url, member, code))
        eventually(page, lambda: expect(download).to_be_visible(timeout=STEP_MS), LIVE_UI_SECONDS)
        eventually(page, lambda: expect(page.get_by_text(team["name"]).first).to_be_visible(timeout=STEP_MS), EXPECT_SECONDS)
        assert page.evaluate("() => window.__stay === true")
