from __future__ import annotations

import base64
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urljoin, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    DEPLOYED_APP,
    Mailpit,
    Postgres,
    addresses,
    advance,
    animations,
    capture,
    center,
    changed,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    post_json,
    same_origin,
    select,
    session,
    settle,
    state_styles,
    text,
    unique,
)


APP_DIR = Path("/app")
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
VIEWPORTS = [PHONE, TABLET, DESKTOP]

SETTLE_MS = 100
TITLE_MS = 2000
ROLL_MS = 1000
FLOWER_MS = 1000

GATE_S = 10
BREATH_IN_MS = 4000
BREATH_HOLD_MS = 7000
BREATH_OUT_MS = 8000
BREATH_TOTAL_MS = 57_000
ROUNDS = 3
RING_PX = 2
TARGET_PX = 44
HOUR_MINUTES = 60
BODY_MAX = 16_384
LINK_LIFE = timedelta(minutes=15)
SESSION_S = 2_592_000
SESSION_LIFE = timedelta(days=30)
IDEMPOTENCY_LIFE = timedelta(hours=24)
SAVES_PER_HOUR = 3
SIGNINS_PER_HOUR = 5
RATE_WINDOW_S = 60 * 60
LATE_LIMIT = timedelta(minutes=60)
COUNTER_MAX = 4096
COUNTER_START = 0.18
COUNTER_SPAN = 0.64
CAPTION_TWO_AT = 0.40
DIAL_MAX = 100
DIAL_MIN = 5
CLOCK_SHARE_S = 1
HEALTH_S = 1
OUTBOX_RETRY_S = 15

HTTP_TIMEOUT_S = 10
UI_WAIT_S = 30
STEP_MS = 100
MAIL_WAIT_S = 30
MAIL_SETTLE_S = 1.5
NONE_SETTLE_S = 3
OUTBOX_WAIT_S = 4 * OUTBOX_RETRY_S
BOOT_S = 120
POLL_S = 0.2
WHEEL_S = 5
MAX_TABS = 120
RECHECK_MS = 60_000
NPM_TIMEOUT_S = 300
MEDIA_WAIT_S = 20
SEEK_STEP_S = 5
FILM_S = 40
CLOCK_SLACK_S = 20
LETTER_SLACK_PX = 1
HOVER_ROW_PX = 24
TRACE_SLACK_PX = 2
PHASE_SLACK_MS = 1000
TAP_GRID_PX = 80

GATE = "Stillhour"
BEGIN = "Begin the hour"
SILENCE = "Begin in silence"
TITLE = "Give your last hour a shape."
CHAPTERS = [
    "The hour nobody plans.",
    "Put the screen to bed.",
    "Breathe in for four, hold for seven, out for eight.",
    "Build your hour.",
    "One still hour.",
    "Plan your Stillhour.",
]
CH_BREATHE = CHAPTERS[2]
CH_BUILD = CHAPTERS[3]
PLANNER = CHAPTERS[5]
SETTLE_LINE = "Let the day settle."
CITY_CAPTIONS = ["The offices close.", "The kitchens go quiet.", "One window left."]
CATALOGUE = [
    ("dim-lamps", "Dim the lamps", 10),
    ("warm-shower", "Warm shower", 15),
    ("paper-not-pixels", "Paper, not pixels", 15),
    ("tomorrow-list", "Tomorrow list", 5),
    ("slow-stretch", "Slow stretch", 10),
    ("breathe", "Breathe", 5),
]
DEFAULT_RITUALS = [{"id": "dim-lamps", "minutes": 10}, {"id": "breathe", "minutes": 5}]

CONFIRM = "Confirm your Stillhour"
SIGNIN = "Your Stillhour sign-in link"
REMINDER = "Your Stillhour starts at "
LINK_LINE = "This link works once, for 15 minutes."

SAVED_COPY = "Check your inbox. We sent a link to confirm your hour."
QUEUED_COPY = (
    "Your hour is saved as a draft. The confirmation email is delayed and will arrive "
    "as soon as our mail service is back."
)
UNAVAILABLE = "Saving is unavailable right now. Your choices are still on this page; try again in a minute."
RESTING = "Tonight, people everywhere are keeping a Stillhour."
SIGNIN_SENT = "If that address has a Stillhour, a sign-in link is on its way. It works once, for 15 minutes."
CONFLICT_COPY = "This plan changed somewhere else. Here is the latest version; your edits were not saved."

ERRORS = {
    "invalid_json": (400, "The request body is not valid JSON."),
    "idempotency_key_required": (400, "Send an Idempotency-Key header of 8 to 64 characters."),
    "signed_out": (401, "Sign in to manage your hour."),
    "cross_origin": (403, "This request did not come from Stillhour."),
    "not_found": (404, "Nothing is here."),
    "no_plan": (404, "There is no confirmed hour for this address."),
    "link_unknown": (404, "We do not recognise this link."),
    "method_not_allowed": (405, "This method is not allowed here."),
    "idempotency_conflict": (409, "This Idempotency-Key was already used with a different hour."),
    "version_conflict": (409, "This hour changed since you loaded it."),
    "link_used": (410, "This link has already been used."),
    "link_expired": (410, "This link has expired."),
    "too_large": (413, "The request is larger than 16,384 bytes."),
    "unsupported_media_type": (415, "Send the request body as JSON."),
    "invalid": (422, "Some details need another look."),
    "version_required": (428, "Send the version you are editing in an If-Match header."),
    "rate_limited": (429, "Too many requests for this address. Try again later."),
    "unavailable": (503, UNAVAILABLE),
}
FIELD_MESSAGES = {
    "email": "Enter an email address, like name@example.com.",
    "bedtime": "Choose a bedtime on a five-minute step, like 22:30.",
    "time_zone": "Choose a time zone from the list.",
    "rituals": "Choose between one and six rituals, 5 to 30 minutes each, 60 minutes at most in total.",
    "note": "Keep your note to 280 characters.",
    "reminders": "Choose on or paused.",
    "token": "Paste the full link from your email.",
    "now": "Send an ISO 8601 date and time with a time zone.",
}
NOT_ACCEPTED = "This field is not accepted."
PLAN_KEYS = {
    "id", "email", "bedtime", "time_zone", "rituals", "total_minutes", "note",
    "reminders", "version", "starts_at_local", "next_reminder_at", "share_url",
}
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
SHARE_PATH = re.compile(r"^/p/[A-Za-z0-9_.~-]{22,}$")
TOKEN_RE = re.compile(r"/signin\?token=([^\s<>\"')\]]*[^\s<>\"')\].,;:!?])")

GRAPHEME_UNIT = "\U0001F468\u200D\U0001F469\u200D\U0001F467\u200D\U0001F466\U0001F1F3\U0001F1FF" + "e\u0301"
BAD_EMAIL = "name.example.com"
FOREIGN_ORIGIN = "http://elsewhere.example"
UNKNOWN_TOKEN = "zz-not-a-real-token-000000"
ASSET_GLOB = "**/*.{woff2,woff,ttf,otf,mp3,ogg,oga,opus,m4a,aac,wav,flac,weba,webm,jpg,jpeg,png,webp,avif,gif,svg,ktx2,basis,hdr,exr}*"
GATE_FILE = re.compile(r"\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|weba)$", re.I)
HELD_FILE = re.compile(r"\.(woff2|woff|ttf|otf|mp3|ogg|oga|opus|m4a|aac|wav|flac|weba|webm|jpg|jpeg|png|webp|avif|gif|svg|ktx2|basis|hdr|exr)$", re.I)
TS_SUFFIXES = {".ts", ".tsx", ".mts", ".cts"}
FAR_ZONE = "Pacific/Kiritimati"
LEAK_WORDS = ["syntaxerror", "node_modules", "at object.", "select ", "insert into", "express", "fastify", "nodemailer", "postgres"]
DATASTORE_PACKAGES = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "@redis/client", "level", "leveldown", "lowdb", "nedb", "lokijs", "mongodb", "mongoose", "mysql", "mysql2", "@libsql/client", "@electric-sql/pglite"}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}

T_IDEM = "2026-11-12T09:00:00.000Z"
T_LINKS = "2026-11-12T10:00:00.000Z"
T_VERIFY = "2026-11-13T10:00:00.000Z"
T_LIMITS = "2026-11-14T10:00:00.000Z"
T_DELETE = "2026-11-16T12:00:00.000Z"
T_REMIND = "2026-11-18T12:00:00.000Z"
T_NIGHTS = "2026-11-20T12:00:00.000Z"
T_BEGIN = "2026-11-24T13:30:00.000Z"
T_READ = "2026-11-10T12:00:00.000Z"
T_LOCAL = "2026-11-01T06:00:00.000Z"
T_CLOCK = "2026-11-10T12:00:00.000Z"
T_LINK_UI = "2026-11-15T10:00:00.000Z"
T_SIGNIN_EDGE = "2026-11-15T14:00:00.000Z"
T_EDIT = "2026-11-11T09:00:00.000Z"

TOKYO = "Asia/Tokyo"
LONDON = "Europe/London"
TOKYO_START = "22:00"
READ_NIGHT = "2026-11-10"
REMIND_NIGHT = "2026-11-18"
LOCAL_NIGHT = "2026-11-01"
NIGHTS = ["2026-11-20", "2026-11-21", "2026-11-22"]
BEGIN_NIGHTS = ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]
CLOCK_NIGHTS = ["2026-11-10", "2026-11-11"]
DELETE_NIGHTS = ["2026-11-16", "2026-11-17"]
NOTE_VERIFY = "Keep the lamp low"
NOTE_READ = "Socks on"
NOTE_PRIVATE = "Private note under the lamp"
NOTE_TABS = "Tea first"
NOTE_KEPT = "Kept"
NOTE_SECRET = "Secret moon note"
NOTE_PARTNER = "Moon tea"

DST_CASES = {
    "spring-forward": {"bedtime": "03:30", "confirm": "2027-03-14T05:00:00.000Z", "due": "2027-03-14T07:00:00.000Z", "start": "03:00", "later": "2027-03-14T07:30:00.000Z"},
    "fall-back": {"bedtime": "02:30", "confirm": "2026-11-01T03:30:00.000Z", "due": "2026-11-01T05:30:00.000Z", "start": "01:30", "later": "2026-11-01T06:30:00.000Z"},
}

PLAN_RULE_CASES = {
    "bedtime-off-step": ({"bedtime": "22:32"}, [], ["bedtime"]),
    "bedtime-out-of-range": ({"bedtime": "24:00"}, [], ["bedtime"]),
    "bedtime-null": ({"bedtime": None}, [], ["bedtime"]),
    "zone-offset": ({"time_zone": "+02:00"}, [], ["time_zone"]),
    "zone-unknown": ({"time_zone": "Mars/Olympus"}, [], ["time_zone"]),
    "rituals-empty": ({"rituals": []}, [], ["rituals"]),
    "ritual-unknown": ({"rituals": [{"id": "doom-scroll", "minutes": 10}]}, [], ["rituals"]),
    "ritual-repeated": ({"rituals": [{"id": "breathe", "minutes": 5}, {"id": "breathe", "minutes": 5}]}, [], ["rituals"]),
    "ritual-minutes-off-step": ({"rituals": [{"id": "breathe", "minutes": 7}]}, [], ["rituals"]),
    "ritual-minutes-too-many": ({"rituals": [{"id": "breathe", "minutes": 35}]}, [], ["rituals"]),
    "ritual-total-over": ({"rituals": [{"id": "warm-shower", "minutes": 30}, {"id": "paper-not-pixels", "minutes": 30}, {"id": "breathe", "minutes": 5}]}, [], ["rituals"]),
    "ritual-extra-key": ({"rituals": [{"id": "breathe", "minutes": 5, "title": "Breathe"}]}, [], ["rituals"]),
    "rituals-total-sixty": ({"rituals": [{"id": "dim-lamps", "minutes": 10}, {"id": "warm-shower", "minutes": 15}, {"id": "paper-not-pixels", "minutes": 15}, {"id": "tomorrow-list", "minutes": 5}, {"id": "slow-stretch", "minutes": 10}, {"id": "breathe", "minutes": 5}]}, [], []),
    "note-wrong-type": ({"note": 42}, [], ["note"]),
    "email-invalid": ({"email": BAD_EMAIL}, [], ["email"]),
    "email-missing": ({}, ["email"], ["email"]),
    "time-zone-missing": ({}, ["time_zone"], ["time_zone"]),
    "extra-reminders": ({"reminders": "on"}, [], ["reminders"]),
    "extra-version": ({"version": 1}, [], ["version"]),
    "several-fields": ({"bedtime": "7pm", "time_zone": "+02:00", "status": "confirmed"}, [], ["bedtime", "time_zone", "status"]),
}

PLAN_RULE_IDS = [
    "bedtime-off-step",
    "bedtime-out-of-range",
    "bedtime-null",
    "zone-offset",
    "zone-unknown",
    "rituals-empty",
    "ritual-unknown",
    "ritual-repeated",
    "ritual-minutes-off-step",
    "ritual-minutes-too-many",
    "ritual-total-over",
    "ritual-extra-key",
    "rituals-total-sixty",
    "note-wrong-type",
    "email-invalid",
    "email-missing",
    "time-zone-missing",
    "extra-reminders",
    "extra-version",
    "several-fields",
]

NOTE_CASES = {
    "note-280-plain": ("plain", 280, 202),
    "note-281-plain": ("plain", 281, 422),
    "note-280-graphemes": ("graphemes", 280, 202),
    "note-281-graphemes": ("graphemes", 281, 422),
    "body-16384-bytes": ("body", 16_384, 202),
    "body-16385-bytes": ("body", 16_385, 413),
}

ERROR_CASES = {
    "unknown-api-path": ("GET", "/api/no-such-route", None, None, "not_found"),
    "unknown-path-before-method": ("DELETE", "/api/no-such-route", None, None, "not_found"),
    "wrong-method": ("GET", "/api/plans", None, None, "method_not_allowed"),
    "wrong-method-on-tonight": ("POST", "/api/tonight", "application/json", "{}", "method_not_allowed"),
    "non-json-body": ("POST", "/api/session/request", "text/plain", "hello", "unsupported_media_type"),
    "media-type-before-size": ("POST", "/api/session/request", "text/plain", "oversize", "unsupported_media_type"),
    "malformed-json": ("POST", "/api/session/request", "application/json", "{", "invalid_json"),
    "size-before-malformed": ("POST", "/api/session/request", "application/json", "oversize", "too_large"),
}


def parse_iso(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def iso(moment: datetime) -> str:
    moment = moment.astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def at(stamp: str, **delta: float) -> str:
    return iso(parse_iso(stamp) + timedelta(**delta))


def local_due(day: str, hhmm: str, zone: str) -> str:
    return iso(datetime.fromisoformat(f"{day}T{hhmm}").replace(tzinfo=ZoneInfo(zone)))


def same_instant(value: Any, expected: str) -> bool:
    return isinstance(value, str) and bool(ISO_UTC.match(value)) and parse_iso(value) == parse_iso(expected)


def start_of(bedtime: str) -> str:
    hours, minutes = map(int, bedtime.split(":"))
    total = (hours * HOUR_MINUTES + minutes - HOUR_MINUTES) % (24 * HOUR_MINUTES)
    return f"{total // HOUR_MINUTES:02d}:{total % HOUR_MINUTES:02d}"


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def plan_body(email: str, **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "email": email, "bedtime": "22:30", "time_zone": "Europe/London",
        "rituals": DEFAULT_RITUALS, "note": "",
    }
    body.update(over)
    return body


def assert_error(r: httpx.Response, code: str, fields: dict[str, str] | None = None) -> dict[str, Any]:
    status, message = ERRORS[code]
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code}: {r.text}"
    assert r.headers.get("content-type", "").startswith("application/json")
    body = r.json()
    assert set(body) == {"error"}, body
    error = body["error"]
    assert error["code"] == code and error["message"] == message, error
    if fields is not None:
        assert error.get("fields") == fields, error
    elif status != 422:
        assert "fields" not in error, error
    return error


def inbox(mail: Mailpit, email: str, subject: str | None = None, expected: int = 0,
          seconds: float = MAIL_WAIT_S, settle_s: float = MAIL_SETTLE_S) -> list[dict[str, Any]]:
    def mine() -> list[dict[str, Any]]:
        found = []
        for message in mail.messages(settle=settle_s):
            if email.lower() not in [a.lower() for a in addresses(message.get("To"))]:
                continue
            if subject is not None and not str(message.get("Subject", "")).startswith(subject):
                continue
            found.append(message)
        return found

    deadline = time.monotonic() + seconds
    found = mine()
    while len(found) < expected and time.monotonic() < deadline:
        found = mine()
    return found


def nothing_for(mail: Mailpit, email: str, subject: str | None = None) -> None:
    assert inbox(mail, email, subject, settle_s=NONE_SETTLE_S) == []


def content(message: dict[str, Any]) -> str:
    return f"{text(message)} {message.get('HTML') or ''}"


def sender_address() -> str:
    found = re.search(r"[^\s<>\"]+@[^\s<>\"]+", mail_from_address())
    assert found, mail_from_address()
    return found.group(0).lower()


def next_token(mail: Mailpit, email: str, subject: str, seen: set[str], seconds: float = MAIL_WAIT_S) -> str:
    deadline = time.monotonic() + seconds
    while True:
        for message in inbox(mail, email, subject, seconds=0):
            for token in TOKEN_RE.findall(content(message)):
                if token not in seen:
                    seen.add(token)
                    return token
        if time.monotonic() > deadline:
            raise AssertionError(f"no new {subject!r} link for {email}")


def save(base: str, body: Any, key: str | None = None, **headers: str) -> httpx.Response:
    return post_json(base, "/api/plans", body, key or idempotency_key(), **headers)


def ask_link(base: str, email: str) -> httpx.Response:
    return post_json(base, "/api/session/request", {"email": email})


def verify(base: str, token: Any) -> httpx.Response:
    return httpx.post(f"{base}/api/session/verify", json={"token": token}, timeout=HTTP_TIMEOUT_S)


def draft(base: str, mail: Mailpit, email: str, seen: set[str], **over: Any) -> str:
    r = save(base, plan_body(email, **over))
    assert r.status_code == 202, r.text
    return next_token(mail, email, CONFIRM, seen)


def keeper(base: str, mail: Mailpit, **over: Any) -> tuple[str, httpx.Client, set[str]]:
    _, email = unique("keeper")
    email = email.lower()
    seen: set[str] = set()
    token = draft(base, mail, email, seen, **over)
    client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    r = client.post("/api/session/verify", json={"token": token})
    assert r.status_code == 200, r.text
    return email, client, seen


def me(client: httpx.Client) -> dict[str, Any]:
    r = client.get("/api/me/plan")
    assert r.status_code == 200, r.text
    return r.json()["plan"]


def patch(client: httpx.Client, body: Any, version: Any) -> httpx.Response:
    return client.patch("/api/me/plan", json=body, headers={"If-Match": str(version)})


def forget(client: httpx.Client) -> None:
    client.delete("/api/me")


def keeping(base: str) -> int:
    r = httpx.get(f"{base}/api/tonight", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"keeping"}
    return r.json()["keeping"]


def live_copy(count: int) -> str:
    if count == 1:
        return "1 person is keeping a Stillhour tonight"
    return f"{count:,} people are keeping a Stillhour tonight"


@contextmanager
def app_clock(base: str) -> Iterator[Callable[[str], str]]:
    def put(stamp: str) -> str:
        r = httpx.put(f"{base}/api/test/clock", json={"now": stamp}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, r.text
        assert r.json() == {"now": stamp}
        return stamp

    try:
        yield put
    finally:
        httpx.delete(f"{base}/api/test/clock", timeout=HTTP_TIMEOUT_S)


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@contextmanager
def app_copy(**env_over: str | None) -> Iterator[tuple[str, subprocess.Popen]]:
    port = free_port()
    env = dict(os.environ, APP_PUBLIC_PORT=str(port))
    for name, value in env_over.items():
        if value is None:
            env.pop(name, None)
        else:
            env[name] = value
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text(errors="replace")[-4000:]

    try:
        deadline = time.monotonic() + BOOT_S
        while True:
            if proc.poll() is not None:
                raise AssertionError(f"app copy exited with {proc.returncode}:\n{tail()}")
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", port)) == 0:
                    break
            if time.monotonic() > deadline:
                raise AssertionError(f"app copy never listened on {port}:\n{tail()}")
            try:
                proc.wait(timeout=POLL_S)
            except subprocess.TimeoutExpired:
                pass
        yield base, proc
        assert proc.poll() is None, f"app copy exited during the test:\n{tail()}"
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.port = free_port()
        self.server: socket.socket | None = None
        self.links: list[socket.socket] = []

    def open(self) -> None:
        server = socket.socket()
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", self.port))
        server.listen(32)
        self.server = server
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        assert self.server is not None
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            upstream = socket.create_connection(self.target)
            self.links += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for end in (a, b):
                try:
                    end.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def close(self) -> None:
        if self.server is not None:
            try:
                self.server.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.server.close()
        for link in self.links:
            try:
                link.close()
            except OSError:
                pass


def words(loc: Locator) -> str:
    return " ".join(" ".join(loc.all_inner_texts()).split())


def poll(page: Page, check: Callable[[], Any], seconds: float = UI_WAIT_S,
         why: str | Callable[[], str] = "condition never held") -> None:
    deadline = time.monotonic() + seconds
    while not check():
        if time.monotonic() > deadline:
            raise AssertionError(why() if callable(why) else why)
        advance(page, STEP_MS)


def wait_real(check: Callable[[], Any], seconds: float, why: str) -> None:
    deadline = time.monotonic() + seconds
    while not check():
        if time.monotonic() > deadline:
            raise AssertionError(why)


def steady(page: Page, read: Callable[[], Any]) -> Any:
    last = read()
    deadline = time.monotonic() + UI_WAIT_S
    while True:
        advance(page, STEP_MS)
        now = read()
        if now == last or time.monotonic() > deadline:
            return now
        last = now


def says(page: Page, loc: Locator, copy: str, seconds: float = UI_WAIT_S) -> None:
    poll(page, lambda: words(loc) == copy, seconds, lambda: f"expected {copy!r}, got {words(loc)!r}")


def shows(page: Page, loc: Locator, copy: str, seconds: float = UI_WAIT_S) -> None:
    poll(page, lambda: copy in words(loc), seconds, lambda: f"{copy!r} not in {words(loc)!r}")


SIGNED_IN_COPIES = ("You are signed in.", "Your Stillhour is confirmed. Reminders are on.")


def signed_in(page: Page, status: Locator) -> None:
    poll(page, lambda: words(status) in SIGNED_IN_COPIES,
         why=lambda: f"expected a signed-in copy, got {words(status)!r}")


def visible_count(loc: Locator) -> int:
    return sum(1 for item in loc.all() if item.is_visible())


PSEUDO_TEXT_JS = """e => {
    const out = [];
    const generated = (el, pseudo) => {
        const c = getComputedStyle(el, pseudo).content;
        if (!c || c === 'none' || c === 'normal') return '';
        const m = /^"([\\s\\S]*)"$/.exec(c);
        return m ? m[1] : '';
    };
    const walk = n => {
        if (n.nodeType === 3) { out.push(n.data); return; }
        if (n.nodeType !== 1) return;
        if (getComputedStyle(n).display === 'none') return;
        out.push(generated(n, '::before'));
        for (const c of n.childNodes) walk(c);
        out.push(generated(n, '::after'));
    };
    walk(e);
    return out.join(' ');
}"""


def squeezed(value: str) -> str:
    return re.sub(r"\s+", "", value)


def rendered_items(lst: Locator) -> list[str]:
    return [squeezed(item.evaluate(PSEUDO_TEXT_JS)) for item in lst.get_by_role("listitem").all()]


def focused(loc: Locator) -> bool:
    return loc.count() == 1 and bool(loc.evaluate("e => e === document.activeElement"))


def holds_focus(loc: Locator) -> bool:
    return loc.count() == 1 and bool(loc.evaluate("e => e.contains(document.activeElement)"))


def press(page: Page, loc: Locator, key: str = "Enter") -> None:
    loc.focus()
    page.keyboard.press(key)


def role(page: Page, kind: str, name: str, **extra: Any) -> Locator:
    return page.get_by_role(kind, name=name, exact=True, **extra)


def region(page: Page, name: str) -> Locator:
    return role(page, "region", name)


FADED_JS = """e => {
    for (let n = e; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) <= 0.01) return true;
    }
    return false;
}"""


def gate_gone(page: Page) -> bool:
    try:
        return all(not g.is_visible() or bool(g.evaluate(FADED_JS)) for g in role(page, "dialog", GATE).all())
    except PlaywrightError:
        return True


def begin(page: Page, choice: str = SILENCE) -> None:
    button = role(page, "button", choice)
    poll(page, button.is_visible, UI_WAIT_S, f"the gate never offered {choice!r}")
    press(page, button)
    poll(page, lambda: gate_gone(page), UI_WAIT_S, "the gate never closed")


@contextmanager
def story(browser: Browser, url: str, viewport: dict[str, int], motion: Any = "no-preference") -> Iterator[Page]:
    with open_app(browser, f"{origin_of(url)}/privacy", reduced_motion=motion) as page:
        page.set_viewport_size(viewport)
        page.goto(url)
        yield page


SCROLLER = """() => {
    const doc = document.scrollingElement || document.documentElement;
    let best = doc, room = doc.scrollHeight - doc.clientHeight;
    for (const el of document.querySelectorAll('body, body *')) {
        if (!/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)) continue;
        const r = el.scrollHeight - el.clientHeight;
        if (r > room + 1) { best = el; room = r; }
    }
    return best;
}"""


def scroll_to(page: Page, y: float) -> None:
    page.evaluate("y => { const s = (" + SCROLLER + ")(); s.scrollTo({top: y, left: 0, behavior: 'instant'}); }", y)
    advance(page, SETTLE_MS)


def scroll_pos(page: Page) -> float:
    return page.evaluate("(" + SCROLLER + ")().scrollTop")


def max_scroll(page: Page) -> int:
    return page.evaluate("(() => { const s = (" + SCROLLER + ")(); return s.scrollHeight - s.clientHeight; })()")


def view_height(page: Page) -> int:
    return page.evaluate("window.innerHeight")


def abs_top(loc: Locator) -> float:
    return loc.evaluate("e => { const s = (" + SCROLLER + ")();"
                        " const doc = s === document.scrollingElement || s === document.documentElement;"
                        " const base = doc ? 0 : s.getBoundingClientRect().top;"
                        " return e.getBoundingClientRect().top - base + s.scrollTop; }")


def rect(loc: Locator) -> dict[str, float]:
    return loc.evaluate("e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }")


def into_view(page: Page, loc: Locator) -> None:
    loc.evaluate("e => e.scrollIntoView({block: 'center', behavior: 'instant'})")
    advance(page, SETTLE_MS)


def shot(page: Page):
    data = session(page).send("Page.captureScreenshot", {"format": "png"})
    return decode(base64.b64decode(data["data"]))


def spin_value(loc: Locator) -> int:
    now = loc.get_attribute("aria-valuenow")
    return int(float(now)) if now else int(loc.input_value())


RANGE_JS = """e => {
    const now = e.getAttribute('aria-valuenow');
    if (now !== null) return parseFloat(now);
    if (e.tagName === 'PROGRESS') return e.position < 0 ? null : e.value * 100 / e.max;
    if ('value' in e && e.value !== '') return Number(e.value);
    return null;
}"""


def range_value(loc: Locator) -> float | None:
    return loc.evaluate(RANGE_JS)


CHOSEN_JS = """e => {
    if (e.tagName === 'SELECT') return e.selectedOptions.length ? e.selectedOptions[0].textContent : '';
    if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') return e.value;
    return e.textContent || '';
}"""


def chosen(loc: Locator) -> str:
    return " ".join((loc.evaluate(CHOSEN_JS) or "").split())


LETTERS_JS = """e => {
    const box = e.getBoundingClientRect();
    const out = [];
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < node.data.length; i++) {
            if (!node.data[i].trim()) continue;
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            out.push([r.left - box.left, r.top - box.top, r.width, r.height]);
        }
    }
    return out;
}"""

PAINTED_JS = """e => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && s.clipPath === 'none' && (s.clip === 'auto' || s.clip === '')
        && s.opacity !== '0' && s.visibility !== 'hidden';
}"""


def letters(loc: Locator) -> list[list[float]]:
    return loc.evaluate(LETTERS_JS)


def letter_shift(a: list[list[float]], b: list[list[float]]) -> float:
    if len(a) != len(b):
        return float("inf")
    return sum(abs(p - q) for ra, rb in zip(a, b) for p, q in zip(ra, rb))


CAPTION_JS = """(e, captions) => {
    const length = (v, size) => v.endsWith('%') ? parseFloat(v) * size / 100 : (parseFloat(v) || 0);
    const kept = (s, r) => {
        const c = s.clipPath;
        if (!c || c === 'none') return 1;
        if (r.width <= 0 || r.height <= 0) return 0;
        const inner = c.slice(c.indexOf('(') + 1, c.lastIndexOf(')'));
        if (c.startsWith('inset(')) {
            const v = inner.split(' round ')[0].trim().split(/\\s+/);
            const [t, rt = t, b = t, l = rt] = v;
            const w = r.width - length(l, r.width) - length(rt, r.width);
            const h = r.height - length(t, r.height) - length(b, r.height);
            return Math.max(0, w / r.width) * Math.max(0, h / r.height);
        }
        if (c.startsWith('polygon(')) {
            const pts = inner.replace(/^\\s*(nonzero|evenodd)\\s*,/, '').split(',')
                .map(p => p.trim().split(/\\s+/)).map(([x, y]) => [length(x || '0', r.width), length(y || '0', r.height)]);
            let area = 0;
            for (let i = 0; i < pts.length; i++) {
                const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
                area += x1 * y2 - x2 * y1;
            }
            return Math.min(1, Math.abs(area) / 2 / (r.width * r.height));
        }
        if (c.startsWith('circle(') || c.startsWith('ellipse(')) {
            const v = inner.split(' at ')[0].trim().split(/\\s+/).filter(Boolean);
            if (!v.length || v.some(x => isNaN(parseFloat(x)))) return 1;
            const round = c.startsWith('circle(');
            const rx = round ? length(v[0], Math.hypot(r.width, r.height) / Math.SQRT2) : length(v[0], r.width);
            const ry = round ? rx : length(v[1] || v[0], r.height);
            return Math.min(1, Math.PI * rx * ry / (r.width * r.height));
        }
        return 1;
    };
    const alpha = col => {
        const m = /rgba?\\(([^)]*)\\)/.exec(col || '');
        if (!m) return 1;
        const p = m[1].split(/[\\s,\\/]+/).filter(Boolean);
        return p.length >= 4 ? parseFloat(p[3]) * (p[3].endsWith('%') ? 0.01 : 1) : 1;
    };
    const faded = s => {
        let f = 1;
        for (const m of (s.filter || '').matchAll(/opacity\\(([\\d.]+)(%?)\\)/g)) f *= parseFloat(m[1]) * (m[2] ? 0.01 : 1);
        return f;
    };
    const weight = el => {
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return 0;
        let vl = Math.max(r.left, 0), vt = Math.max(r.top, 0);
        let vr = Math.min(r.right, window.innerWidth), vb = Math.min(r.bottom, window.innerHeight);
        for (let n = el.parentElement; n; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
            const b = n.getBoundingClientRect();
            vl = Math.max(vl, b.left); vt = Math.max(vt, b.top);
            vr = Math.min(vr, b.right); vb = Math.min(vb, b.bottom);
        }
        let w = Math.max(0, vr - vl) * Math.max(0, vb - vt) / (r.width * r.height);
        const own = getComputedStyle(el);
        w *= alpha(own.webkitTextFillColor || own.color);
        for (let n = el; n; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.display === 'none' || s.visibility === 'hidden') return 0;
            w *= parseFloat(s.opacity) * faded(s) * kept(s, n.getBoundingClientRect());
        }
        return w;
    };
    const norm = t => (t || '').replace(/\\s+/g, ' ').trim();
    let best = '', top = 0;
    for (const caption of captions) {
        const holders = [e, ...e.querySelectorAll('*')].filter(el => norm(el.textContent).includes(caption)
            && ![...el.children].some(c => norm(c.textContent).includes(caption)));
        for (const el of holders) {
            const w = weight(el);
            if (w > top) { top = w; best = caption; }
        }
    }
    return {best, top};
}"""


def city_reading(city: Locator) -> tuple[int, str] | None:
    settle(city)
    spoken = city.aria_snapshot()
    joined = re.sub(r"(?<=[\d,])\s+(?=[\d,])", "", words(city))
    counter = re.compile(r"(\d[\d,]*) windows? lit")
    source = next((t for t in (spoken, joined) if counter.search(t)), None)
    if source is None:
        return None
    match = counter.search(source)
    assert match is not None
    count = int(match.group(1).replace(",", ""))
    if count == 1:
        assert "1 window lit" in source, source
    present = [c for c in CITY_CAPTIONS if c in spoken]
    if len(present) == 1:
        return count, present[0]
    found = city.evaluate(CAPTION_JS, CITY_CAPTIONS)
    if not found["best"] or found["top"] <= 0:
        return None
    return count, found["best"]


VISIBLE_TEXT_JS = """e => {
    const clips = el => {
        const out = [];
        for (let n = el; n; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) <= 0.01) return null;
            if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || (s.clipPath && s.clipPath !== 'none')) {
                out.push(n.getBoundingClientRect());
            }
        }
        return out;
    };
    const parts = [];
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const boxes = node.parentElement ? clips(node.parentElement) : null;
        if (!boxes) continue;
        let kept = '';
        for (let i = 0; i < node.data.length; i++) {
            const ch = node.data[i];
            if (!ch.trim()) { kept += ' '; continue; }
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            if (boxes.every(b => cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom)) kept += ch;
        }
        parts.push(kept);
    }
    return parts.join(' ');
}"""


def city_scan(page: Page, city: Locator, positions: list[int]) -> dict[int, tuple[int, str]]:
    readings = {}
    for y in positions:
        scroll_to(page, y)
        reading = city_reading(city)
        if reading is not None:
            readings[y] = reading
    return readings


CLIP_JS = """e => {
    const v = e.querySelector('video');
    const running = e.getAnimations({subtree: true}).filter(a => a.playState === 'running'
        && a.effect && a.effect.getComputedTiming().iterations === Infinity).length;
    return {video: v ? {t: v.currentTime, paused: v.paused, err: v.error ? v.error.code : 0} : null, running};
}"""


def clip(loc: Locator) -> dict[str, Any]:
    return loc.evaluate(CLIP_JS)


REVEAL_JS = """() => {
    const marks = window.__stillhourReveal = {count: 0};
    const hero = n => {
        const el = n && (n.nodeType === 1 ? n : n.parentElement);
        return !!el && !!el.closest('h1, [role="heading"][aria-level="1"]') && !el.closest('dialog, [role="dialog"]');
    };
    for (const type of ['animationstart', 'transitionrun']) {
        document.addEventListener(type, e => { if (hero(e.target)) marks.count += 1; }, true);
    }
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
        if (hero(this)) marks.count += 1;
        return animate.apply(this, args);
    };
    new MutationObserver(list => {
        for (const m of list) if (m.type === 'attributes' && hero(m.target)) marks.count += 1;
    }).observe(document.body, {subtree: true, attributes: true});
}"""

RING_JS = """e => {
    const sig = el => {
        if (!el) return '';
        const parts = [];
        for (const pseudo of [null, '::before', '::after']) {
            const s = getComputedStyle(el, pseudo);
            parts.push([s.content, s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopWidth,
                        s.borderTopStyle, s.borderTopColor, s.opacity].join('|'));
        }
        return parts.join('#');
    };
    const related = [e, e.previousElementSibling, e.nextElementSibling, ...(e.labels ? [...e.labels] : [])];
    for (let p = e.parentElement, i = 0; p && i < 3; p = p.parentElement, i++) related.push(p);
    return related.map(sig).join('@');
}"""

FOCUS_JS = """() => {
    const e = document.activeElement;
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return {body: e === document.body, w: r.width, h: r.height, hidden: s.visibility === 'hidden',
            button: e.tagName === 'BUTTON' || e.getAttribute('role') === 'button'};
}"""


def rituals_in(url: str) -> str | None:
    values = parse_qs(urlsplit(url).query).get("rituals")
    return values[0] if values else None


def planner_state(page: Page) -> dict[str, int]:
    state = {}
    for _, title, _ in CATALOGUE:
        if role(page, "checkbox", title).is_checked():
            state[title] = spin_value(role(page, "spinbutton", f"{title} minutes"))
    return state


def browser_sign_in(page: Page, base: str, mail: Mailpit, email: str, seen: set[str]) -> None:
    assert ask_link(base, email).status_code == 202
    token = next_token(mail, email, SIGNIN, seen)
    page.goto(f"{base}/signin?token={token}")
    signed_in(page, role(page, "status", "Link status"))
    page.goto(f"{base}/manage")
    poll(page, lambda: page.get_by_text(f"Signed in as {email}").count() > 0, why="editor never showed the address")


def fill_planner(page: Page, email: str, bedtime: str = "22:30", zone: str = "Europe/London", note: str | None = None) -> None:
    fill(role(page, "textbox", "Email"), email)
    select(role(page, "combobox", "Time zone"), zone)
    select(role(page, "combobox", "Bedtime"), bedtime)
    if note is not None:
        fill(role(page, "textbox", "A note for tonight"), note)


def track_posts(page: Page, path: str) -> list[Any]:
    posts: list[Any] = []
    page.on("request", lambda r: posts.append(r) if r.method == "POST" and urlsplit(r.url).path == path else None)
    return posts


def position_of(slider: Locator) -> int | None:
    match = re.match(r"^(\d+):(\d{2}) of 0:40$", slider.get_attribute("aria-valuetext") or "")
    return int(match.group(1)) * 60 + int(match.group(2)) if match else None


def elapsed(slider: Locator) -> int:
    seconds = position_of(slider)
    assert seconds is not None, slider.get_attribute("aria-valuetext")
    return seconds


MEDIA_JS = """e => {
    const v = e.querySelector('video');
    return v ? {d: v.duration, t: v.currentTime, paused: v.paused, ready: v.readyState,
                err: v.error ? v.error.code : 0, ns: v.networkState} : null;
}"""


def media(loc: Locator) -> dict[str, Any] | None:
    return loc.evaluate(MEDIA_JS)


def unplayable(film: Locator) -> bool:
    state = media(film) or {}
    return bool(state.get("err")) or state.get("ns") == 3


def off_screen(page: Page, loc: Locator) -> bool:
    box = rect(loc)
    return box["y"] + box["h"] <= 0 or box["y"] >= view_height(page)


def test_wf_story_gate_keyboard(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        with held(page, ASSET_GLOB) as hold:
            gate_files: list[str] = []
            held_files: list[str] = []
            page.on("request", lambda r: gate_files.append(r.url) if GATE_FILE.search(urlsplit(r.url).path) else None)
            page.on("request", lambda r: held_files.append(r.url) if HELD_FILE.search(urlsplit(r.url).path) else None)
            page.reload(wait_until="commit")
            gate = role(page, "dialog", GATE)
            bar = role(page, "progressbar", "Gathering the evening")
            begin_button = role(page, "button", BEGIN)
            poll(page, lambda: begin_button.is_visible() or (bool(held_files) and bar.is_visible()),
                 why="the gate neither showed its progress nor finished")
            advance(page, ROLL_MS)
            if gate_files:
                value = range_value(bar)
                assert value is not None and 0 <= value < 100, f"progress reached {value} with audio still loading"
                assert not begin_button.is_visible(), "the gate offered its buttons with audio still loading"
                assert "Gathering the evening" in words(gate)
                assert re.search(r"\b\d{1,3}%", words(gate)), words(gate)
            page.mouse.move(DESKTOP["width"] / 2, DESKTOP["height"] / 2)
            page.mouse.wheel(0, DESKTOP["height"])
            for key in ("End", "PageDown", "Space", "ArrowDown"):
                page.keyboard.press(key)
            advance(page, SETTLE_MS)
            assert scroll_pos(page) == 0
            hold.release()
            poll(page, begin_button.is_visible, GATE_S, "buttons never appeared after loading")
            assert role(page, "button", SILENCE).is_visible()
            if bar.count():
                assert range_value(bar) == 100
            poll(page, lambda: focused(begin_button), why="focus did not move to Begin the hour")
            page.keyboard.press("Enter")
            heading = role(page, "heading", TITLE, level=1)
            poll(page, lambda: gate_gone(page) and focused(heading), why="focus did not move to the hero heading")
            page.mouse.wheel(0, DESKTOP["height"])
            poll(page, lambda: scroll_pos(page) > 0, why="scrolling stayed locked after the gate")


def test_hero_title_reveal(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        button = role(page, "button", SILENCE)
        poll(page, button.is_visible, UI_WAIT_S, "the gate never offered its buttons")
        page.evaluate(REVEAL_JS)
        press(page, button)
        heading = role(page, "heading", TITLE, level=1)
        poll(page, lambda: heading.count() == 1 and gate_gone(page),
             why="the hero title is missing after the gate")
        moving = bool(animations(heading))
        early = decode(capture(heading))
        advance(page, TITLE_MS)
        settle(heading)
        late = decode(capture(heading))
        revealed = page.evaluate("window.__stillhourReveal.count") > 0
        assert revealed or moving or difference(early, late) > 0, "the title did not reveal after the gate"
        assert heading.count() == 1, "the title lost its full accessible name"


AUDIO_FAIL_JS = """() => {
    window.__stillhourAudioFailed = 0;
    const media = window.__stillhourMedia = new Set();
    const isVideo = el => typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement;
    const watch = el => {
        if (!el || isVideo(el) || media.has(el)) return el;
        media.add(el);
        el.addEventListener('error', () => { window.__stillhourAudioFailed += 1; });
        return el;
    };
    const ctor = window.BaseAudioContext || window.AudioContext;
    if (ctor && ctor.prototype.decodeAudioData) {
        const decode = ctor.prototype.decodeAudioData;
        ctor.prototype.decodeAudioData = function (data, ok, fail) {
            const p = decode.call(this, data, ok, e => { window.__stillhourAudioFailed += 1; if (fail) fail(e); });
            if (p && p.catch) p.catch(() => {});
            return p;
        };
    }
    for (const C of [window.AudioContext, window.webkitAudioContext]) {
        if (C && C.prototype.createMediaElementSource) {
            const make = C.prototype.createMediaElementSource;
            C.prototype.createMediaElementSource = function (el) { watch(el); return make.call(this, el); };
        }
    }
    if (window.HTMLMediaElement) {
        const proto = HTMLMediaElement.prototype;
        const play = proto.play;
        proto.play = function (...args) {
            watch(this);
            const p = play.apply(this, args);
            if (p && p.catch) p.catch(e => {
                if (!isVideo(this) && (this.error || (e && e.name === 'NotSupportedError'))) window.__stillhourAudioFailed += 1;
            });
            return p;
        };
        const load = proto.load;
        proto.load = function (...args) { watch(this); return load.apply(this, args); };
    }
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (name, ...rest) {
        const el = create.call(this, name, ...rest);
        if (/^audio$/i.test(String(name))) watch(el);
        return el;
    };
    if (window.Audio) {
        const A = window.Audio;
        window.Audio = function (...args) { return watch(new A(...args)); };
        window.Audio.prototype = A.prototype;
    }
    document.addEventListener('error', e => {
        if (window.HTMLMediaElement && e.target instanceof HTMLMediaElement && !isVideo(e.target)) window.__stillhourAudioFailed += 1;
    }, true);
}"""


def test_sound_switch(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        failed_audio: list[str] = []
        page.on("response", lambda r: failed_audio.append(r.url)
                if GATE_FILE.search(urlsplit(r.url).path) and r.status >= 400 else None)
        page.on("requestfailed", lambda r: failed_audio.append(r.url)
                if GATE_FILE.search(urlsplit(r.url).path) else None)
        page.add_init_script(script=f"({AUDIO_FAIL_JS})()")
        page.reload()

        def audio_failed() -> bool:
            return bool(failed_audio) or bool(page.evaluate(
                "(window.__stillhourAudioFailed || 0)"
                " + [...(window.__stillhourMedia || []), ...document.querySelectorAll('audio')].filter(e => e.error).length"))

        begin(page, BEGIN)
        sound = role(page, "switch", "Sound")
        poll(page, lambda: sound.is_checked() or audio_failed(),
             why="Begin the hour did not turn the Sound switch on")
        audible = sound.is_checked()
        if not audible:
            assert audio_failed(), "Begin the hour left sound off although every audio file loaded"
        if audible:
            press(page, sound, "Space")
            poll(page, lambda: not sound.is_checked(), why="Space did not turn sound off")
            press(page, sound, "Enter")
            poll(page, sound.is_checked, why="Enter did not turn sound on")
            press(page, sound, "Space")
            poll(page, lambda: not sound.is_checked())
        else:
            page.reload()
            begin(page, SILENCE)
        assert not role(page, "switch", "Sound").is_checked()
        page.reload()
        silence = role(page, "button", SILENCE)
        poll(page, lambda: silence.is_visible() and focused(silence), why="remembered off did not focus Begin in silence")
        page.keyboard.press("Enter")
        poll(page, lambda: gate_gone(page), why="the gate never closed")
        assert not role(page, "switch", "Sound").is_checked()
        if audible:
            page.reload()
            begin(page, BEGIN)
            poll(page, role(page, "switch", "Sound").is_checked,
                 why="after a reload Begin the hour did not turn the Sound switch on")
            page.reload()
            start = role(page, "button", BEGIN)
            poll(page, lambda: start.is_visible() and focused(start), why="remembered on did not focus Begin the hour")


def test_wf_story_scroll_clock(browser: Browser, app_url: str) -> None:
    for viewport, motion in ((DESKTOP, "no-preference"), (PHONE, "reduce")):
        with story(browser, app_url, viewport, motion) as page:
            begin(page)
            clock = role(page, "timer", "Story clock")

            def reads(fraction_minutes: int, y: int) -> None:
                scroll_to(page, y)
                expected = f"21:{fraction_minutes:02d}" if fraction_minutes < 60 else "22:00"

                def matches() -> bool:
                    for source in (words(clock), clock.aria_snapshot()):
                        times = re.findall(r"\b\d{2}:\d{2}\b", source)
                        if times and set(times) == {expected}:
                            return True
                    return False

                poll(page, matches, UI_WAIT_S, lambda: f"{motion} at y={y}: {words(clock)!r} != {expected!r}")

            top = max_scroll(page)
            assert top > HOUR_MINUTES

            def middle(minute: int) -> int:
                return round(top * (minute + 0.5) / HOUR_MINUTES)

            plan = [
                (0, 0),
                (9, middle(9)),
                (10, middle(10)),
                (30, middle(30)),
                (59, middle(59)),
                (60, top),
            ]
            for minutes, y in plan:
                reads(minutes, y)
            for minutes, y in reversed(plan):
                reads(minutes, y)


def test_city_window_counter(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        city = region(page, "The city at night")
        top = max_scroll(page)
        step = max(1, view_height(page) // 4)
        positions = list(range(0, top, step)) + [top]
        forward = city_scan(page, city, positions)
        backward = city_scan(page, city, list(reversed(positions)))
        assert backward == forward, "scrolling back did not restore the same counter and captions"
        ordered = [forward[y] for y in positions if y in forward]
        assert ordered, "the window counter was never shown"
        assert ordered[0] == (COUNTER_MAX, CITY_CAPTIONS[0]), ordered
        assert ordered[-1] == (1, CITY_CAPTIONS[2]), ordered
        counts = [c for c, _ in ordered]
        assert all(a >= b for a, b in zip(counts, counts[1:])), counts
        steps = [CITY_CAPTIONS.index(c) for _, c in ordered]
        assert all(a <= b for a, b in zip(steps, steps[1:])), steps
        assert len({c for c in counts if 1 < c < COUNTER_MAX}) >= 2, "the counter never scrubbed between its ends"
        at_caption_two = COUNTER_MAX - (COUNTER_MAX - 1) * (CAPTION_TWO_AT - COUNTER_START) / COUNTER_SPAN
        for count, caption in ordered:
            if count > at_caption_two + 0.5:
                assert caption == CITY_CAPTIONS[0], (count, caption)
            elif 1 < count < at_caption_two - 0.5:
                assert caption == CITY_CAPTIONS[1], (count, caption)
            if caption == CITY_CAPTIONS[2]:
                assert count == 1


def test_scroll_tied_chapters(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        meter = role(page, "meter", "Screen brightness")
        top = max_scroll(page)
        positions = list(range(0, top, view_height(page) // 4)) + [top]

        def dial() -> int:
            value = range_value(meter)
            assert value is not None, "the brightness meter has no value"
            return int(round(value))

        forward = []
        for y in positions:
            scroll_to(page, y)
            forward.append(dial())
        backward = []
        for y in reversed(positions):
            scroll_to(page, y)
            backward.append(dial())
        backward.reverse()
        assert forward[0] == DIAL_MAX and forward[-1] == DIAL_MIN, forward
        assert all(a >= b for a, b in zip(forward, forward[1:])), forward
        assert backward == forward
        middle = [v for v in forward if DIAL_MIN < v < DIAL_MAX]
        assert len(set(middle)) >= 2, "the dial never scrubbed"
        scroll_to(page, positions[forward.index(middle[0])])
        assert f"{dial()}%" in words(region(page, CHAPTERS[1]))

        candidates = page.get_by_text(SETTLE_LINE, exact=True).all()
        assert candidates, "settle line missing"
        line = max(candidates, key=lambda c: c.evaluate("e => e.getElementsByTagName('*').length"))
        scroll_to(page, 0)
        settled_y = min(abs_top(region(page, CH_BUILD)), max_scroll(page))
        later_y = min(settled_y + view_height(page) // 2, max_scroll(page))
        painted = bool(line.evaluate(PAINTED_JS))

        def look(y: float) -> tuple[list[list[float]], Any]:
            scroll_to(page, y)
            return letters(line), shot(page)

        settled, settled_shot = look(settled_y)
        later, _ = look(later_y)
        if painted:
            shifts: dict[int, float] = {}
            for y in range(0, int(settled_y), max(1, view_height(page) // 4)):
                scroll_to(page, y)
                shifts[y] = letter_shift(letters(line), settled)
            assert shifts, "the settle line sits at the top of the page"
            scattered_y = max(shifts, key=lambda y: shifts[y])
            assert shifts[scattered_y] > LETTER_SLACK_PX, "settle-line letters were in place before their window"
            assert letter_shift(settled, later) <= LETTER_SLACK_PX, "settle-line letters did not stay in place"
            look(settled_y)
            risen, _ = look(scattered_y)
            assert letter_shift(risen, settled) > LETTER_SLACK_PX, "settle-line letters did not rise again on the way up"
        else:
            scattered_y = max(0, abs_top(line) - view_height(page))
            _, scattered_shot = look(scattered_y)
            _, settled_shot = look(settled_y)
            _, risen_shot = look(scattered_y)
            changed(scattered_shot, settled_shot)
            changed(settled_shot, risen_shot)

        scroll_to(page, 0)
        breathe = region(page, CH_BREATHE)
        flowers_y = abs_top(breathe) + rect(breathe)["h"]
        scroll_to(page, flowers_y)
        before = shot(page)
        for row in range(0, DESKTOP["height"], HOVER_ROW_PX):
            page.mouse.move(0, row)
            page.mouse.move(DESKTOP["width"] - 1, row, steps=DESKTOP["width"] // HOVER_ROW_PX)
            advance(page, SETTLE_MS)
        advance(page, FLOWER_MS)
        if difference(before, shot(page)) == 0:
            resting = scroll_pos(page)
            for row in range(DESKTOP["height"] // 8, DESKTOP["height"], TAP_GRID_PX):
                for col in range(TAP_GRID_PX // 2, DESKTOP["width"], TAP_GRID_PX):
                    inert = page.evaluate(
                        "([x, y]) => { const e = document.elementFromPoint(x, y);"
                        " return !e || !e.closest('a, button, input, select, textarea, label, [role], [tabindex]'); }",
                        [col, row])
                    if inert:
                        page.touchscreen.tap(col, row)
                advance(page, SETTLE_MS)
            if scroll_pos(page) != resting:
                scroll_to(page, resting)
            advance(page, FLOWER_MS)
        assert difference(before, shot(page)) > 0, "no moonflower closed under the pointer or a tap"


def test_goodnight_footer(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        footer = page.get_by_role("contentinfo")
        assert footer.count() == 1
        assert "Goodnight." in words(footer)
        manage = footer.get_by_role("link", name="Manage my hour", exact=True)
        privacy = footer.get_by_role("link", name="Privacy", exact=True)
        assert urlsplit(manage.get_attribute("href") or "").path == "/manage"
        assert urlsplit(privacy.get_attribute("href") or "").path == "/privacy"
        lit_y = max(0, min(abs_top(footer) - view_height(page) // 2, max_scroll(page) - view_height(page) // 2))
        scroll_to(page, lit_y)
        lit = shot(page)
        scroll_to(page, max_scroll(page))
        out = shot(page)
        changed(lit, out)
        scroll_to(page, lit_y)
        changed(out, shot(page))


def test_wf_story_live_count(browser: Browser, app_url: str, mail: Mailpit) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        before = keeping(app_url)
        begin(page)
        band = region(page, "Tonight in numbers")
        into_view(page, band)
        advance(page, ROLL_MS)
        settle(band)
        numerals = (r"\b6\s*0\s*minutes", r"\b0\s*6\s*rituals", r"\b0\s*1\s*bedtime")

        def readings() -> tuple[str, str, str]:
            shown = words(band)
            spoken = " ".join(re.sub(r'[-:"]|\btext\b', " ", band.aria_snapshot()).split())
            visible = " ".join(band.evaluate(VISIBLE_TEXT_JS).split())
            return shown, spoken, visible

        poll(page, lambda: all(any(re.search(n, t) for t in readings()) for n in numerals),
             why=lambda: f"numerals not shown: {readings()}")
        shows(page, band, live_copy(before))
        _, client, _ = keeper(app_url, mail)
        assert keeping(app_url) == before + 1
        page.reload()
        begin(page)
        shows(page, region(page, "Tonight in numbers"), live_copy(before + 1))
        forget(client)
        assert keeping(app_url) == before


def test_wf_story_database_down(browser: Browser) -> None:
    down = os.environ["APP_POSTGRES_DOWN_URL"]
    with open_app(browser, down) as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        assert role(page, "heading", TITLE, level=1).count() == 1
        for chapter in CHAPTERS:
            assert region(page, chapter).count() == 1, chapter
        band = region(page, "Tonight in numbers")
        into_view(page, band)
        shows(page, band, RESTING)


def test_wf_practice_and_film_breathing(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        chapter = region(page, CH_BREATHE)
        guide = role(page, "status", "Breathing guide")
        start = role(page, "button", "Breathe with me")
        stop = role(page, "button", "Stop")
        assert BREATH_IN_MS + BREATH_HOLD_MS + BREATH_OUT_MS == BREATH_TOTAL_MS // ROUNDS
        fake = [0.0]

        def reach(check: Callable[[], bool], why: Callable[[], str]) -> tuple[float, float]:
            deadline = time.monotonic() + UI_WAIT_S
            while not check():
                if time.monotonic() > deadline:
                    raise AssertionError(why())
                advance(page, STEP_MS)
                fake[0] += STEP_MS
            return fake[0], time.monotonic() * 1000

        into_view(page, start)
        press(page, start)
        poll(page, lambda: focused(stop), why="the button was not renamed Stop with focus kept")
        phases = (("Breathe in", BREATH_IN_MS), ("Hold", BREATH_HOLD_MS), ("Breathe out", BREATH_OUT_MS))
        stamps: list[tuple[int, tuple[float, float]]] = []
        for round_no in range(1, ROUNDS + 1):
            for phase, length in phases:
                mark = reach(lambda p=phase, r=round_no: p in words(guide) and f"Round {r} of 3" in words(chapter),
                             lambda p=phase, r=round_no: f"round {r}: {p!r} never announced, got {words(guide)!r}")
                stamps.append((length, mark))
        done = reach(lambda: "Three rounds done. Notice how you feel." in words(guide),
                     lambda: f"the run never finished: {words(guide)!r}")
        marks = [mark for _, mark in stamps] + [done]
        for (length, _), a, b in zip(stamps, marks, marks[1:]):
            spans = (b[0] - a[0], b[1] - a[1])
            assert max(spans) >= length - PHASE_SLACK_MS, f"phase of {length} ms ended early: {spans}"
            assert min(spans) <= length + PHASE_SLACK_MS, f"phase of {length} ms ran late: {spans}"
        assert focused(start), "focus left the button when the run ended"
        press(page, start)
        reach(lambda: "Hold" in words(guide), lambda: f"the second run never reached Hold: {words(guide)!r}")
        press(page, stop, "Space")
        poll(page, lambda: focused(start), why="Stop did not return the button to Breathe with me")
        assert "Breathing stopped." in words(guide)
        advance(page, BREATH_TOTAL_MS)
        assert "Breathing stopped." in words(guide)
        assert stop.count() == 0


def test_wf_practice_and_film_film_keyboard(browser: Browser, app_url: str) -> None:
    with story(browser, app_url, PHONE, "reduce") as page:
        begin(page)
        opener = role(page, "button", "Play the film")
        into_view(page, opener)
        press(page, opener)
        film = role(page, "dialog", "One still hour")
        poll(page, film.is_visible, why="film dialog did not open")
        play = film.get_by_role("button", name="Play", exact=True)
        poll(page, lambda: focused(play), why="focus did not move to Play")
        status = role(page, "status", "Film status")
        advance(page, ROLL_MS)
        assert words(status) != "Playing" and play.count() == 1, "the film started under reduced motion"
        seek = film.get_by_role("slider", name="Seek", exact=True)
        poll(page, lambda: position_of(seek) == 0 or unplayable(film), MEDIA_WAIT_S,
             "seek did not start at the beginning of the film")
        advance(page, ROLL_MS)
        assert position_of(seek) == 0 or unplayable(film), "the film advanced under reduced motion"
        captions = film.get_by_role("button", name="Captions", exact=True)
        mute = film.get_by_role("button", name="Mute", exact=True)
        assert captions.get_attribute("aria-pressed") == "false"
        mute_steps = [("m", mute, "true", "Muted"), ("m", mute, "false", "Sound on")]
        if mute.get_attribute("aria-pressed") == "true":
            mute_steps.reverse()
        for key, control, pressed, copy in [
            ("c", captions, "true", "Captions on"),
            ("c", captions, "false", "Captions off"),
            *mute_steps,
        ]:
            page.keyboard.press(key)
            says(page, status, copy)
            assert control.get_attribute("aria-pressed") == pressed
        page.keyboard.press("k")
        poll(page, lambda: words(status) == "Playing" or unplayable(film), MEDIA_WAIT_S,
             lambda: f"K did not play the film: {words(status)!r}")
        if not unplayable(film):
            assert film.get_by_role("button", name="Pause", exact=True).count() == 1
            page.keyboard.press("k")
            says(page, status, "Paused")
            assert film.get_by_role("button", name="Play", exact=True).count() == 1
            poll(page, lambda: (media(film) or {"ready": 1})["ready"] >= 1, MEDIA_WAIT_S, "the film's metadata never loaded")
            stopped = seek.get_attribute("aria-valuetext")
            advance(page, ROLL_MS)
            assert seek.get_attribute("aria-valuetext") == stopped, "the film kept playing after Pause"
            expected = elapsed(seek)
            for key, step in (("ArrowRight", SEEK_STEP_S), ("ArrowRight", SEEK_STEP_S), ("ArrowLeft", -SEEK_STEP_S)):
                expected = min(max(expected + step, 0), FILM_S)
                page.keyboard.press(key)
                poll(page, lambda v=expected: position_of(seek) == v, why=f"{key} did not seek to {expected} seconds")
        assert film.get_by_role("button", name="Full screen", exact=True).count() == 1
        assert film.get_by_role("button", name="Close", exact=True).count() == 1
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert holds_focus(film), f"{key} moved focus out of the film dialog"
        page.keyboard.press("Escape")
        poll(page, lambda: not film.is_visible() and focused(opener), why="Escape did not close and refocus Play the film")


def test_wf_build_hour_toggle_cards(browser: Browser, app_url: str) -> None:
    with story(browser, app_url, TABLET) as page:
        begin(page)
        updates = role(page, "status", "Ritual updates")
        total = 0
        for _, title, minutes in CATALOGUE:
            add = role(page, "button", f"Add {title} to my hour")
            assert add.get_attribute("aria-pressed") == "false"
            press(page, add, "Space")
            total += minutes
            remove = role(page, "button", f"Remove {title} from my hour")
            poll(page, lambda r=remove: r.count() == 1 and not page.evaluate("document.activeElement === document.body"),
                 why=f"{title}: toggle not renamed or focus lost to the body")
            assert remove.get_attribute("aria-pressed") == "true"
            says(page, updates, f"{title} added. {total} of 60 minutes planned.")
            assert role(page, "checkbox", title).is_checked()
            assert spin_value(role(page, "spinbutton", f"{title} minutes")) == minutes
        assert total == HOUR_MINUTES
        press(page, role(page, "button", "Remove Tomorrow list from my hour"), "Space")
        says(page, updates, "Tomorrow list removed. 55 of 60 minutes planned.")
        assert not role(page, "checkbox", "Tomorrow list").is_checked()
        assert role(page, "spinbutton", "Tomorrow list minutes").is_disabled()
        press(page, role(page, "spinbutton", "Breathe minutes"), "ArrowUp")
        poll(page, lambda: spin_value(role(page, "spinbutton", "Breathe minutes")) == 10)
        add_list = role(page, "button", "Add Tomorrow list to my hour")
        press(page, add_list, "Space")
        says(page, updates, "There is no room for Tomorrow list. Your hour already has 60 of 60 minutes.")
        assert add_list.get_attribute("aria-pressed") == "false"
        assert not role(page, "checkbox", "Tomorrow list").is_checked()
        stretch = role(page, "spinbutton", "Slow stretch minutes")
        press(page, stretch, "ArrowUp")
        advance(page, SETTLE_MS)
        assert spin_value(stretch) == 10, "a minutes change past 60 was accepted"
        press(page, role(page, "checkbox", "Warm shower"), "Space")
        poll(page, lambda: role(page, "button", "Add Warm shower to my hour").get_attribute("aria-pressed") == "false",
             why="unchecking the planner box did not update the card")


def test_ritual_cards(browser: Browser, app_url: str) -> None:
    with story(browser, app_url, TABLET) as page:
        begin(page)
        for _, title, minutes in CATALOGUE:
            card = role(page, "group", title)
            assert card.count() == 1, title
            label = words(card)
            assert title in label and f"{minutes} min" in label, label
        card = role(page, "group", CATALOGUE[0][1])
        into_view(page, card)
        found: dict[str, Any] = {}

        def playing(after: float) -> bool:
            state = clip(card)
            video = state["video"]
            if video and video["err"]:
                found["kind"] = "undecodable"
                return True
            if video and not video["paused"] and video["t"] > after:
                found["kind"] = "video"
                return True
            if state["running"]:
                found["kind"] = "animation"
                return True
            frame = decode(capture(card))
            moved = "frame" in found and difference(found["frame"], frame) > 0
            found["frame"] = frame
            if moved:
                found["kind"] = "pixels"
            return moved

        poll(page, lambda: playing(-1), MEDIA_WAIT_S, "the card's clip never played on screen")
        kind = found["kind"]
        if kind in ("video", "animation"):
            scroll_to(page, 0)
            assert off_screen(page, card)
            if kind == "video":
                poll(page, lambda: (clip(card)["video"] or {"paused": True})["paused"],
                     why="the card's clip kept playing off screen")
                stopped = (clip(card)["video"] or {"t": -1})["t"]
            else:
                poll(page, lambda: not clip(card)["running"], why="the card's clip kept running off screen")
                stopped = -1
            into_view(page, card)
            found.pop("frame", None)
            poll(page, lambda: playing(stopped), MEDIA_WAIT_S, "the card's clip did not resume on screen")


def test_wf_build_hour_address(browser: Browser, app_url: str) -> None:
    start = "/?rituals=dim-lamps:10,breathe:5"
    with story(browser, app_url + start, TABLET) as page:
        begin(page)
        assert planner_state(page) == {"Dim the lamps": 10, "Breathe": 5}
        assert role(page, "button", "Remove Breathe from my hour").get_attribute("aria-pressed") == "true"
        history = page.evaluate("history.length")
        press(page, role(page, "button", "Add Warm shower to my hour"), "Space")
        poll(page, lambda: rituals_in(page.url) == "dim-lamps:10,breathe:5,warm-shower:15", why=lambda: page.url)
        press(page, role(page, "spinbutton", "Breathe minutes"), "ArrowUp")
        chosen = "dim-lamps:10,breathe:10,warm-shower:15"
        poll(page, lambda: rituals_in(page.url) == chosen, why=lambda: page.url)
        assert page.evaluate("history.length") == history
        expected = {"Dim the lamps": 10, "Breathe": 10, "Warm shower": 15}
        page.reload()
        begin(page)
        assert planner_state(page) == expected
        privacy = page.get_by_role("contentinfo").get_by_role("link", name="Privacy", exact=True)
        into_view(page, privacy)
        press(page, privacy)
        page.wait_for_url("**/privacy")
        page.go_back()
        back_silence = role(page, "button", SILENCE)
        back_title = role(page, "heading", TITLE, level=1)
        poll(page, lambda: back_silence.is_visible() or (back_title.count() == 1 and gate_gone(page)),
             why="after Back the gate neither offered its buttons nor was absent")
        if back_silence.is_visible():
            begin(page)
        poll(page, lambda: planner_state(page) == expected, why="Back did not restore the rituals")
        assert rituals_in(page.url) == chosen
        for _, title, _ in CATALOGUE:
            remove = role(page, "button", f"Remove {title} from my hour")
            if remove.count():
                press(page, remove, "Space")
        poll(page, lambda: rituals_in(page.url) is None, why=lambda: f"rituals parameter kept with nothing chosen: {page.url}")
    with story(browser, f"{app_url}/?rituals={chosen}", TABLET) as other:
        begin(other)
        assert planner_state(other) == expected, "another browser did not restore the shared address"
    messy = "/?rituals=dim-lamps:10,bogus:5,dim-lamps:5,breathe:7,warm-shower:30,paper-not-pixels:30"
    cleanings = {
        "dim-lamps:10,warm-shower:30": {"Dim the lamps": 10, "Warm shower": 30},
        "warm-shower:30,paper-not-pixels:30": {"Warm shower": 30, "Paper, not pixels": 30},
    }
    with story(browser, app_url + messy, TABLET) as cleaned:
        begin(cleaned)
        poll(cleaned, lambda: rituals_in(cleaned.url) in cleanings, why=lambda: cleaned.url)
        assert planner_state(cleaned) == cleanings[rituals_in(cleaned.url) or ""]


def test_wf_build_hour_wide_and_narrow(browser: Browser, app_url: str) -> None:
    for viewport, motion, pinned in ((DESKTOP, "no-preference", True), (TABLET, "no-preference", False), (DESKTOP, "reduce", False)):
        with story(browser, app_url, viewport, motion) as page:
            begin(page)
            heading = role(page, "heading", CH_BUILD, level=2)
            card = role(page, "group", "Breathe")
            first = role(page, "group", "Dim the lamps")
            start = abs_top(region(page, CH_BUILD))
            step = view_height(page) // 2
            positions = [y for y in (start + i * step for i in range(8)) if y <= max_scroll(page)]
            assert len(positions) >= 3

            def sample() -> list[tuple[int, int, int]]:
                out = []
                for y in positions:
                    scroll_to(page, y)
                    out.append(steady(page, lambda: (round(rect(heading)["y"]), round(rect(card)["x"]), round(rect(card)["y"]))))
                return out

            def close(a: tuple[int, int, int], b: tuple[int, int, int]) -> bool:
                return all(abs(p - q) <= TRACE_SLACK_PX for p, q in zip(a, b))

            forward = sample()
            positions.reverse()
            backward = list(reversed(sample()))
            positions.reverse()
            assert all(close(a, b) for a, b in zip(backward, forward)), f"{viewport} {motion}: reverse scroll did not retrace"
            pairs = list(zip(forward, forward[1:]))
            if pinned:
                assert any(abs(a[0] - b[0]) <= TRACE_SLACK_PX and b[1] < a[1] - TRACE_SLACK_PX for a, b in pairs), \
                    f"no pinned sideways travel: {forward}"
                assert forward[-1][1] < forward[0][1]
                assert all(b[1] <= a[1] + TRACE_SLACK_PX for a, b in pairs), forward
                scroll_to(page, start)
                press(page, role(page, "button", "Add Dim the lamps to my hour"), "Tab")
                target = role(page, "button", "Add Breathe to my hour")
                for _ in range(MAX_TABS):
                    if focused(target):
                        break
                    page.keyboard.press("Tab")
                assert focused(target)
                poll(page, lambda: (lambda r: r["x"] >= 0 and r["y"] >= 0 and r["x"] + r["w"] <= viewport["width"]
                                    and r["y"] + r["h"] <= viewport["height"])(rect(card)),
                     why="focused card was not scrolled fully on screen")
            else:
                assert all(abs(a[0] - b[0]) > TRACE_SLACK_PX for a, b in pairs), f"heading pinned: {forward}"
                xs = [x for _, x, _ in forward]
                assert max(xs) - min(xs) <= TRACE_SLACK_PX, f"cards moved sideways: {forward}"
                assert rect(first)["y"] < rect(card)["y"], "cards are not stacked vertically"


def test_wf_save_hour_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    _, email = unique("visitor")
    email = email.lower()
    with open_app(browser, app_url + "/?rituals=dim-lamps:10,breathe:5") as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        fill_planner(page, email, bedtime="00:30")
        posts = track_posts(page, "/api/plans")
        status = role(page, "status", "Planner status")
        button = role(page, "button", "Save my hour")
        with held(page, "**/api/plans") as hold:
            into_view(page, button)
            x, y = center(button)
            page.mouse.dblclick(x, y)
            says(page, status, "Saving your hour…")
            assert button.is_disabled()
            poll(page, lambda: len(posts) >= 1)
            advance(page, ROLL_MS)
            assert len(posts) == 1, "the second click sent a second save"
            hold.release()
            says(page, status, SAVED_COPY)
        assert len(posts) == 1
        key = posts[0].headers.get("idempotency-key", "")
        assert 8 <= len(key) <= 64
    messages = inbox(mail, email, CONFIRM, expected=1)
    assert len(messages) == 1
    body = content(messages[0])
    assert "00:30" in body and "Europe/London" in body and ("Dim the lamps" in body or "dim-lamps" in body)


def test_planner_summary(browser: Browser, app_url: str) -> None:
    _, email = unique("summary")
    with open_app(browser, app_url + "/?rituals=dim-lamps:10,breathe:5") as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        planner = region(page, PLANNER)
        assert "23:00" in chosen(role(page, "combobox", "Bedtime"))
        shows(page, planner, "15 of 60 minutes planned.")
        fill_planner(page, email, bedtime="00:30")
        shows(page, planner, "Your hour starts at 23:30 and ends at 00:30, Europe/London time.")
        select(role(page, "combobox", "Time zone"), "Asia/Tokyo")
        shows(page, planner, "Your hour starts at 23:30 and ends at 00:30, Asia/Tokyo time.")
        press(page, role(page, "checkbox", "Warm shower"), "Space")
        shows(page, planner, "30 of 60 minutes planned.")
        fill(role(page, "textbox", "A note for tonight"), "Lamps low \U0001F1F3\U0001F1FF")
        shows(page, planner, "11 of 280 characters")


def test_wf_save_hour_dropped_connection(browser: Browser, app_url: str, mail: Mailpit) -> None:
    _, email = unique("dropped")
    email = email.lower()
    keys: list[str | None] = []

    def drop_first(route: Any) -> None:
        keys.append(route.request.headers.get("idempotency-key"))
        if len(keys) == 1:
            route.fetch()
            route.abort("connectionreset")
        else:
            route.continue_()

    with open_app(browser, app_url + "/?rituals=dim-lamps:10") as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        page.route("**/api/plans", drop_first)
        fill_planner(page, email)
        button = role(page, "button", "Save my hour")
        into_view(page, button)
        press(page, button)
        says(page, role(page, "status", "Planner status"), SAVED_COPY)
    assert len(keys) >= 2 and len(set(keys)) == 1, keys
    assert len(inbox(mail, email, CONFIRM, expected=1)) == 1


def test_wf_save_hour_invalid_fields(browser: Browser, app_url: str, mail: Mailpit) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        posts = track_posts(page, "/api/plans")
        email_box = role(page, "textbox", "Email")
        fill(email_box, BAD_EMAIL)
        button = role(page, "button", "Save my hour")
        into_view(page, button)
        press(page, button)
        alert = page.get_by_role("alert").filter(has=role(page, "heading", "Check your hour"))
        poll(page, alert.is_visible, why="no Check your hour alert")
        poll(page, lambda: holds_focus(alert), why="the alert did not receive focus")
        says(page, role(page, "status", "Planner status"), "Some details need another look.")
        planner = region(page, PLANNER)
        assert FIELD_MESSAGES["email"] in words(planner)
        assert FIELD_MESSAGES["rituals"] in words(planner)
        assert email_box.evaluate("e => e.getAttribute('aria-invalid') === 'true' || (e.validity !== undefined && !e.validity.valid)"), \
            "the email field was not marked invalid"
        assert alert.get_by_role("link", name="Rituals", exact=True).count() == 1
        press(page, alert.get_by_role("link", name="Email", exact=True))
        poll(page, lambda: focused(email_box), why="the Email link did not move focus to the field")
        advance(page, ROLL_MS)
        assert posts == []
    nothing_for(mail, BAD_EMAIL)


def test_save_endpoint(app_url: str, mail: Mailpit) -> None:
    _, email = unique("planner")
    email = email.lower()
    first = save(app_url, plan_body(email.upper()))
    assert first.status_code == 202, first.text
    assert first.headers["content-type"].startswith("application/json")
    assert first.json() == {"status": "confirmation_sent"}
    token = next_token(mail, email, CONFIRM, set())
    client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    stored = client.post("/api/session/verify", json={"token": token})
    assert stored.status_code == 200 and stored.json()["confirmed"] is True, f"no draft was stored: {stored.text}"
    plan = me(client)
    assert plan["email"] == email and plan["bedtime"] == "22:30" and plan["time_zone"] == "Europe/London"
    assert [r["id"] for r in plan["rituals"]] == [r["id"] for r in DEFAULT_RITUALS]
    again = save(app_url, plan_body(email, bedtime="23:00"))
    _, stranger = unique("planner")
    fresh = save(app_url, plan_body(stranger.lower()))
    assert again.status_code == fresh.status_code == 202
    assert again.json() == fresh.json() == first.json()
    forget(client)


def test_confirmation_email(app_url: str, mail: Mailpit) -> None:
    _, email = unique("confirmmail")
    email = email.lower()
    assert save(app_url, plan_body(email)).status_code == 202
    messages = inbox(mail, email, CONFIRM, expected=1)
    assert len(messages) == 1
    message = messages[0]
    assert [a.lower() for a in addresses(message.get("From"))] == [sender_address()]
    body = content(message)
    assert re.search(r"https?://[^\s/\"]+/signin\?token=", body), body
    assert LINK_LINE in body and "22:30" in body and "Europe/London" in body
    assert "Dim the lamps" in body or "dim-lamps" in body
    assert save(app_url, plan_body(email, bedtime="23:00")).status_code == 202
    second = inbox(mail, email, CONFIRM, expected=2)
    assert len(second) == 2
    per_message = [set(TOKEN_RE.findall(content(m))) for m in second]
    assert all(per_message), "a confirmation email carries no /signin token link"
    assert not per_message[0] & per_message[1], "each draft needs its own one-time link"


@pytest.mark.parametrize("case_id", PLAN_RULE_IDS, ids=PLAN_RULE_IDS)
def test_plan_rules(app_url: str, mail: Mailpit, case_id: str) -> None:
    over, dropped, failing = PLAN_RULE_CASES[case_id]
    _, email = unique("rules")
    email = email.lower()
    body = plan_body(email)
    body.update(over)
    for key in dropped:
        body.pop(key)
    r = save(app_url, body)
    if not failing:
        assert r.status_code == 202, r.text
        return
    expected = {f: FIELD_MESSAGES.get(f, NOT_ACCEPTED) if f in FIELD_MESSAGES and f != "reminders" else NOT_ACCEPTED for f in failing}
    assert_error(r, "invalid", expected)
    nothing_for(mail, body.get("email", email) if isinstance(body.get("email"), str) else email)


@pytest.mark.parametrize("case_id", list(NOTE_CASES), ids=list(NOTE_CASES))
def test_note_and_body_limits(app_url: str, mail: Mailpit, case_id: str) -> None:
    kind, size, status = NOTE_CASES[case_id]
    _, email = unique("limits")
    email = email.lower()
    if kind == "body":
        raw = json.dumps(plan_body(email), separators=(",", ":")).encode()
        payload = raw[:-1] + b" " * (size - len(raw)) + b"}"
        assert len(payload) == size
        r = httpx.post(f"{app_url}/api/plans", content=payload, timeout=HTTP_TIMEOUT_S,
                       headers={"Content-Type": "application/json", "Idempotency-Key": idempotency_key()})
    else:
        if kind == "plain":
            note = "a" * size
        else:
            units, rest = divmod(size, 3)
            note = GRAPHEME_UNIT * units + "a" * rest
        r = save(app_url, plan_body(email, note=note))
    if status == 202:
        assert r.status_code == 202, r.text
        return
    if status == 413:
        assert_error(r, "too_large")
    else:
        assert_error(r, "invalid", {"note": FIELD_MESSAGES["note"]})
    nothing_for(mail, email)


def test_idempotent_saves(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_IDEM)
        _, email = unique("idem")
        email = email.lower()
        body = plan_body(email)
        key = idempotency_key()
        first = save(app_url, body, key)
        assert first.status_code == 202
        reordered = dict(reversed(list(body.items())))
        replay = save(app_url, reordered, key)
        assert (replay.status_code, replay.json()) == (202, first.json())
        conflict = save(app_url, dict(body, bedtime="21:00"), key)
        assert_error(conflict, "idempotency_conflict")
        assert len(inbox(mail, email, CONFIRM, expected=1)) == 1
        for headers in ({}, {"Idempotency-Key": "short"}, {"Idempotency-Key": "k" * 65}):
            r = httpx.post(f"{app_url}/api/plans", json=body, headers=headers, timeout=HTTP_TIMEOUT_S)
            assert_error(r, "idempotency_key_required")
        for _ in range(SAVES_PER_HOUR - 1):
            assert save(app_url, body).status_code == 202, "replays counted towards the rate limit"
        put(at(T_IDEM, hours=24, milliseconds=-1))
        late = save(app_url, body, key)
        assert (late.status_code, late.json()) == (202, first.json())
        assert len(inbox(mail, email, CONFIRM, expected=SAVES_PER_HOUR)) == SAVES_PER_HOUR
        put(iso(parse_iso(T_IDEM) + IDEMPOTENCY_LIFE))
        assert save(app_url, body, key).status_code == 202
        assert len(inbox(mail, email, CONFIRM, expected=SAVES_PER_HOUR + 1)) == SAVES_PER_HOUR + 1
        _, racer = unique("race")
        racer = racer.lower()
        race_key = idempotency_key()
        race_body = plan_body(racer)
        with ThreadPoolExecutor(max_workers=5) as pool:
            answers = list(pool.map(lambda _: save(app_url, race_body, race_key), range(5)))
        assert {(a.status_code, json.dumps(a.json(), sort_keys=True)) for a in answers} == {(202, json.dumps(answers[0].json(), sort_keys=True))}
        assert len(inbox(mail, racer, CONFIRM, expected=1)) == 1


def test_link_lifetime(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_LINKS)
        _, a = unique("linka")
        _, b = unique("linkb")
        a, b = a.lower(), b.lower()
        seen: set[str] = set()
        token_a = draft(app_url, mail, a, seen)
        token_b = draft(app_url, mail, b, seen)
        assert ask_link(app_url, b).status_code == 202
        sign_b = next_token(mail, b, SIGNIN, seen)
        put(iso(parse_iso(T_LINKS) + LINK_LIFE - timedelta(milliseconds=1)))
        assert verify(app_url, token_a).status_code == 200
        assert_error(verify(app_url, token_a), "link_used")
        assert verify(app_url, token_b).status_code == 200, "a later link cancelled an older one"
        put(iso(parse_iso(T_LINKS) + LINK_LIFE))
        assert_error(verify(app_url, sign_b), "link_expired")
        put(at(T_LINKS, minutes=20))
        assert_error(verify(app_url, token_a), "link_used")
        assert_error(verify(app_url, UNKNOWN_TOKEN), "link_unknown")
        for bad in (None, 5):
            assert_error(verify(app_url, bad), "invalid", {"token": FIELD_MESSAGES["token"]})
        empty = verify(app_url, "")
        if empty.status_code == ERRORS["link_unknown"][0]:
            assert_error(empty, "link_unknown")
        else:
            assert_error(empty, "invalid", {"token": FIELD_MESSAGES["token"]})


def test_link_verification(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_VERIFY)
        _, email = unique("verify")
        email = email.lower()
        seen: set[str] = set()
        token = draft(app_url, mail, email, seen, note=NOTE_VERIFY)
        first = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        r = first.post("/api/session/verify", json={"token": token})
        assert r.status_code == 200 and r.json() == {"signed_in": True, "email": email, "confirmed": True}
        plan = me(first)
        assert plan["reminders"] == "on" and plan["version"] == 1 and plan["bedtime"] == "22:30"
        assert plan["note"] == NOTE_VERIFY
        share_url = first.post("/api/me/share").json()["share"]["url"]
        token2 = draft(app_url, mail, email, seen, bedtime="23:30")
        second = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        assert second.post("/api/session/verify", json={"token": token2}).json()["confirmed"] is True
        replaced = me(second)
        assert replaced["id"] == plan["id"] and replaced["version"] == 2
        assert replaced["bedtime"] == "23:30" and replaced["share_url"] == share_url and replaced["reminders"] == "on"
        assert ask_link(app_url, email).status_code == 202
        third = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        signed = third.post("/api/session/verify", json={"token": next_token(mail, email, SIGNIN, seen)})
        assert signed.json() == {"signed_in": True, "email": email, "confirmed": True}
        _, waiting = unique("waiting")
        waiting = waiting.lower()
        other_seen: set[str] = set()
        draft(app_url, mail, waiting, other_seen)
        assert ask_link(app_url, waiting).status_code == 202
        drafty = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        answer = drafty.post("/api/session/verify", json={"token": next_token(mail, waiting, SIGNIN, other_seen)})
        assert answer.json() == {"signed_in": True, "email": waiting, "confirmed": False}
        assert_error(drafty.get("/api/me/plan"), "no_plan")
        forget(third)


def test_session_cookie(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_VERIFY)
        _, email = unique("cookie")
        email = email.lower()
        seen: set[str] = set()
        token = draft(app_url, mail, email, seen)
        first = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        r = first.post("/api/session/verify", json={"token": token})
        assert r.status_code == 200, r.text
        cookie = next(c for c in r.headers.get_list("set-cookie") if c.startswith("stillhour_session="))
        lowered = cookie.lower()
        for attribute in ("httponly", "samesite=lax", "path=/", f"max-age={SESSION_S}"):
            assert attribute in lowered, cookie
        assert me(first)["email"] == email
        anonymous = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        assert_error(anonymous.get("/api/me/plan"), "signed_out")
        assert_error(anonymous.patch("/api/me/plan", json={"bedtime": "21:00"}, headers={"If-Match": "1"}), "signed_out")
        assert_error(anonymous.post("/api/me/share"), "signed_out")
        assert_error(anonymous.delete("/api/me"), "signed_out")
        assert ask_link(app_url, email).status_code == 202
        later = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        assert later.post("/api/session/verify", json={"token": next_token(mail, email, SIGNIN, seen)}).status_code == 200
        old = first.cookies.get("stillhour_session")
        ended = first.post("/api/session/end")
        assert ended.status_code == 204
        assert any(c.startswith("stillhour_session=") for c in ended.headers.get_list("set-cookie"))
        assert_error(httpx.get(f"{app_url}/api/me/plan", cookies={"stillhour_session": old}, timeout=HTTP_TIMEOUT_S), "signed_out")
        assert httpx.post(f"{app_url}/api/session/end", timeout=HTTP_TIMEOUT_S).status_code == 204
        put(iso(parse_iso(T_VERIFY) + SESSION_LIFE - timedelta(minutes=1)))
        assert later.get("/api/me/plan").status_code == 200
        put(iso(parse_iso(T_VERIFY) + SESSION_LIFE + timedelta(minutes=1)))
        assert_error(later.get("/api/me/plan"), "signed_out")


def test_live_count(app_url: str, mail: Mailpit) -> None:
    before = keeping(app_url)
    _, client, _ = keeper(app_url, mail)
    assert keeping(app_url) == before + 1
    _, stray = unique("draftonly")
    draft(app_url, mail, stray.lower(), set())
    assert keeping(app_url) == before + 1
    plan = me(client)
    assert patch(client, {"reminders": "paused"}, plan["version"]).status_code == 200
    assert keeping(app_url) == before
    assert patch(client, {"reminders": "on"}, plan["version"] + 1).status_code == 200
    assert keeping(app_url) == before + 1
    assert client.delete("/api/me").status_code == 204
    assert keeping(app_url) == before


def test_wf_confirm_hour_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    _, email = unique("confirm")
    email = email.lower()
    token = draft(app_url, mail, email, set())
    before = keeping(app_url)
    with open_app(browser, f"{app_url}/signin?token={token}") as page:
        page.set_viewport_size(DESKTOP)
        poll(page, lambda: role(page, "heading", "Your Stillhour link", level=1).count() == 1,
             why="the sign-in page heading is missing")
        says(page, role(page, "status", "Link status"), "Your Stillhour is confirmed. Reminders are on.")
        assert keeping(app_url) == before + 1
        press(page, role(page, "link", "Manage my hour").first)
        page.wait_for_url("**/manage")
        poll(page, lambda: page.get_by_text(f"Signed in as {email}").count() > 0, why="editor not shown")
        line = re.compile(r"Next reminder: [A-Z][a-z]+ \d{1,2} [A-Z][a-z]+ at 21:30 \(Europe/London\)")
        poll(page, lambda: page.get_by_text(line).count() > 0, why="next reminder line missing")
        assert "22:30" in chosen(role(page, "combobox", "Bedtime"))
        plan = page.request.get(f"{app_url}/api/me/plan")
        assert plan.status == 200 and plan.json()["plan"]["reminders"] == "on"
        page.goto(f"{app_url}/signin?token={token}")
        says(page, role(page, "status", "Link status"), "This link has already been used. Ask for a new one on Manage my hour.")
        page.request.delete(f"{app_url}/api/me")


def test_wf_confirm_hour_bad_links(browser: Browser, app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_LINK_UI)
        _, email = unique("expired")
        email = email.lower()
        seen: set[str] = set()
        token = draft(app_url, mail, email, seen)
        put(iso(parse_iso(T_LINK_UI) + LINK_LIFE))
        with open_app(browser, f"{app_url}/privacy") as page:
            posts = track_posts(page, "/api/session/verify")
            status = role(page, "status", "Link status")
            with held(page, "**/api/session/verify") as hold:
                page.goto(f"{app_url}/signin?token={token}")
                says(page, status, "Checking your link…")
                hold.release()
            says(page, status, "This link has expired. Ask for a new one on Manage my hour.")
            advance(page, RECHECK_MS)
            assert len(posts) == 1, "the link was checked more than once"
            page.goto(f"{app_url}/signin?token={UNKNOWN_TOKEN}")
            says(page, status, "We do not recognise this link.")
            page.goto(f"{app_url}/signin")
            says(page, status, "We do not recognise this link.")
            assert page.request.get(f"{app_url}/api/me/plan").status == 401
            fresh = draft(app_url, mail, email, seen)
            page.goto(f"{app_url}/signin?token={fresh}")
            says(page, status, "Your Stillhour is confirmed. Reminders are on.")
            press(page, role(page, "link", "Manage my hour").first)
            page.wait_for_url("**/manage")
            poll(page, lambda: page.get_by_text(f"Signed in as {email}").count() > 0,
                 why="the editor was not shown after confirming")
            assert "22:30" in chosen(role(page, "combobox", "Bedtime"))
            page.request.delete(f"{app_url}/api/me")


def test_wf_sign_in_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email, client, seen = keeper(app_url, mail)
    with open_app(browser, app_url + "/manage") as page:
        page.set_viewport_size(DESKTOP)
        poll(page, lambda: role(page, "heading", "Manage my hour", level=1).count() == 1,
             why="the Manage my hour heading is missing")
        status = role(page, "status", "Sign-in status")
        fill(role(page, "textbox", "Email"), BAD_EMAIL)
        press(page, role(page, "button", "Send me a sign-in link"))
        says(page, status, FIELD_MESSAGES["email"])
        fill(role(page, "textbox", "Email"), email)
        with held(page, "**/api/session/request") as hold:
            press(page, role(page, "button", "Send me a sign-in link"))
            says(page, status, "Sending your link…")
            hold.release()
        says(page, status, SIGNIN_SENT)
        token = next_token(mail, email, SIGNIN, seen)
        page.goto(f"{app_url}/signin?token={token}")
        signed_in(page, role(page, "status", "Link status"))
        press(page, role(page, "link", "Manage my hour").first)
        page.wait_for_url("**/manage")
        poll(page, lambda: role(page, "button", "Save changes").count() == 1, why="editor not reached")
        assert page.get_by_text(f"Signed in as {email}").count() > 0
        plan = page.request.get(f"{app_url}/api/me/plan")
        assert plan.status == 200 and plan.json()["plan"]["email"] == email
    forget(client)


def test_wf_sign_in_expired_link(browser: Browser, app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_SIGNIN_EDGE)
        email, client, seen = keeper(app_url, mail)
        try:
            assert ask_link(app_url, email).status_code == 202
            early = next_token(mail, email, SIGNIN, seen)
            assert ask_link(app_url, email).status_code == 202
            late = next_token(mail, email, SIGNIN, seen)
            put(iso(parse_iso(T_SIGNIN_EDGE) + LINK_LIFE - timedelta(milliseconds=1)))
            with open_app(browser, f"{app_url}/signin?token={early}") as page:
                page.set_viewport_size(DESKTOP)
                signed_in(page, role(page, "status", "Link status"))
                press(page, role(page, "link", "Manage my hour").first)
                page.wait_for_url("**/manage")
                poll(page, lambda: role(page, "button", "Save changes").count() == 1, why="editor not reached")
            put(iso(parse_iso(T_SIGNIN_EDGE) + LINK_LIFE))
            with open_app(browser, f"{app_url}/signin?token={late}") as other:
                says(other, role(other, "status", "Link status"),
                     "This link has expired. Ask for a new one on Manage my hour.")
                assert other.request.get(f"{app_url}/api/me/plan").status == 401
        finally:
            forget(client)


def test_wf_sign_in_rate_limited(browser: Browser, app_url: str) -> None:
    with app_clock(app_url) as put:
        put(T_LIMITS)
        _, email = unique("busy")
        for _ in range(SIGNINS_PER_HOUR):
            assert ask_link(app_url, email).status_code == 202
        with open_app(browser, app_url + "/manage") as page:
            fill(role(page, "textbox", "Email"), email)
            press(page, role(page, "button", "Send me a sign-in link"))
            says(page, role(page, "status", "Sign-in status"),
                 f"That address has asked for five links in the last hour. Try again in {RATE_WINDOW_S // 60} minutes.")


def test_same_reply_for_every_address(app_url: str, mail: Mailpit) -> None:
    known, client, _ = keeper(app_url, mail)
    _, waiting = unique("waiting")
    waiting = waiting.lower()
    draft(app_url, mail, waiting, set())
    _, stranger = unique("stranger")
    stranger = stranger.lower()
    replies = [ask_link(app_url, e) for e in (known, waiting, stranger)]
    for r in replies:
        assert r.status_code == 202 and r.json() == {"status": "link_sent"}
    shapes = [{k.lower(): v for k, v in r.headers.items() if k.lower() != "date"} for r in replies]
    assert shapes[0] == shapes[1] == shapes[2], shapes
    assert len(inbox(mail, known, SIGNIN, expected=1)) == 1
    assert len(inbox(mail, waiting, SIGNIN, expected=1)) == 1
    nothing_for(mail, stranger)
    assert_error(ask_link(app_url, BAD_EMAIL), "invalid", {"email": FIELD_MESSAGES["email"]})
    forget(client)


def test_hourly_link_limits(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_LIMITS)
        known, client, _ = keeper(app_url, mail)
        _, unknown = unique("stranger")
        unknown = unknown.lower()
        refusals = {}
        for email in (known, unknown):
            for _ in range(SIGNINS_PER_HOUR):
                assert ask_link(app_url, email).status_code == 202
            r = ask_link(app_url, email)
            assert_error(r, "rate_limited")
            assert r.headers["retry-after"] == str(RATE_WINDOW_S)
            refusals[email] = r.json()
        assert refusals[known] == refusals[unknown]
        assert len(inbox(mail, known, SIGNIN, expected=SIGNINS_PER_HOUR)) == SIGNINS_PER_HOUR
        nothing_for(mail, unknown)
        _, saver = unique("saver")
        saver = saver.lower()
        for _ in range(SAVES_PER_HOUR):
            assert save(app_url, plan_body(saver)).status_code == 202
        r = save(app_url, plan_body(saver))
        assert_error(r, "rate_limited")
        assert r.headers["retry-after"] == str(RATE_WINDOW_S)
        assert len(inbox(mail, saver, CONFIRM, expected=SAVES_PER_HOUR)) == SAVES_PER_HOUR
        for _ in range(SAVES_PER_HOUR - 1):
            assert save(app_url, plan_body(known)).status_code == 202
        assert_error(save(app_url, plan_body(known)), "rate_limited")
        put(at(T_LIMITS, minutes=30))
        r = ask_link(app_url, unknown)
        assert_error(r, "rate_limited")
        assert r.headers["retry-after"] == str(RATE_WINDOW_S - 30 * 60)
        put(at(T_LIMITS, minutes=60, seconds=1))
        assert ask_link(app_url, unknown).status_code == 202
        forget(client)


def test_read_my_hour(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_READ)
        rituals = [{"id": "slow-stretch", "minutes": 15}, {"id": "dim-lamps", "minutes": 10}]
        email, client, _ = keeper(app_url, mail, bedtime="00:30", rituals=rituals, note=NOTE_READ)
        plan = me(client)
        assert set(plan) == PLAN_KEYS
        assert isinstance(plan["id"], str) and plan["id"]
        assert plan["email"] == email and plan["bedtime"] == "00:30" and plan["time_zone"] == "Europe/London"
        assert plan["rituals"] == [
            {"id": "slow-stretch", "title": "Slow stretch", "minutes": 15},
            {"id": "dim-lamps", "title": "Dim the lamps", "minutes": 10},
        ]
        assert plan["total_minutes"] == sum(r["minutes"] for r in rituals) and plan["note"] == NOTE_READ
        assert plan["reminders"] == "on" and plan["version"] == 1
        assert plan["starts_at_local"] == "23:30"
        assert same_instant(plan["next_reminder_at"], local_due(READ_NIGHT, start_of("00:30"), LONDON)), plan["next_reminder_at"]
        assert plan["share_url"] is None
        url = client.post("/api/me/share").json()["share"]["url"]
        assert SHARE_PATH.match(me(client)["share_url"]) and me(client)["share_url"] == url
        forget(client)


def test_editable_fields_only(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_EDIT)
        email, client, _ = keeper(app_url, mail, note="Tea first")
        try:
            plan = me(client)
            for key, value in (("email", "other@example.com"), ("version", 9), ("id", "x"), ("confirmed", False), ("share_url", "/p/x"), ("status", "paused")):
                r = patch(client, {key: value, "note": "changed"}, plan["version"])
                assert_error(r, "invalid", {key: NOT_ACCEPTED})
                assert me(client) == plan, f"{key} refusal changed the hour"
            error = assert_error(patch(client, {}, plan["version"]), "invalid")
            assert "fields" not in error
            bare = client.patch("/api/me/plan", headers={"If-Match": str(plan["version"])})
            assert "fields" not in assert_error(bare, "invalid")
            for body, field in (({"bedtime": None}, "bedtime"), ({"reminders": "maybe"}, "reminders"),
                                ({"note": GRAPHEME_UNIT * 93 + "ab"}, "note"),
                                ({"rituals": [{"id": "warm-shower", "minutes": 30}, {"id": "paper-not-pixels", "minutes": 30}, {"id": "breathe", "minutes": 5}]}, "rituals")):
                assert_error(patch(client, body, plan["version"]), "invalid", {field: FIELD_MESSAGES[field]})
            assert me(client) == plan
            ok = patch(client, {"note": GRAPHEME_UNIT * 93 + "a"}, plan["version"])
            assert ok.status_code == 200 and ok.json()["plan"]["version"] == plan["version"] + 1
            replaced = patch(client, {"rituals": [{"id": "warm-shower", "minutes": 15}]}, plan["version"] + 1).json()["plan"]
            assert replaced["rituals"] == [{"id": "warm-shower", "title": "Warm shower", "minutes": 15}] and replaced["total_minutes"] == 15
            moved = patch(client, {"bedtime": "21:00"}, replaced["version"]).json()["plan"]
            assert moved["bedtime"] == "21:00" and moved["email"] == email and moved["time_zone"] == "Europe/London"
            same = patch(client, {"bedtime": "21:00"}, moved["version"]).json()["plan"]
            assert same["version"] == moved["version"] + 1
        finally:
            forget(client)


def test_stale_edits_refused(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_EDIT)
        stale_edits(app_url, mail)


def stale_edits(app_url: str, mail: Mailpit) -> None:
    _, client, _ = keeper(app_url, mail)
    assert_error(client.patch("/api/me/plan", json={"bedtime": "21:00"}), "version_required")
    assert_error(client.patch("/api/me/plan", json={"bedtime": "nope"}), "version_required")
    fresh = patch(client, {"bedtime": "21:30"}, '"1"')
    assert fresh.status_code == 200 and fresh.json()["plan"]["version"] == 2
    for stale in ("1", "abc"):
        error = assert_error(patch(client, {"note": "stale"}, stale), "version_conflict")
        assert error["current"]["version"] == 2 and error["current"]["bedtime"] == "21:30"
    assert me(client)["note"] == ""
    bedtimes = ["20:00", "20:05", "20:10", "20:15", "20:20", "20:25"]
    with ThreadPoolExecutor(max_workers=len(bedtimes)) as pool:
        answers = list(pool.map(lambda b: patch(client, {"bedtime": b}, 2), bedtimes))
    winners = [a for a in answers if a.status_code == 200]
    assert len(winners) == 1, [a.status_code for a in answers]
    won = winners[0].json()["plan"]
    for loser in answers:
        if loser is not winners[0]:
            assert_error(loser, "version_conflict")["current"] == won
    assert me(client) == won
    forget(client)


def test_wf_edit_hour_two_tabs(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email, client, seen = keeper(app_url, mail, note=NOTE_TABS)
    with open_app(browser, app_url + "/manage") as first:
        first.set_viewport_size(DESKTOP)
        browser_sign_in(first, app_url, mail, email, seen)
        second = first.context.new_page()
        second.goto(app_url + "/manage")
        poll(second, lambda: role(second, "button", "Save changes").count() == 1)
        select(role(first, "combobox", "Bedtime"), "22:00")
        press(first, role(first, "button", "Save changes"))
        says(first, role(first, "status", "Manage status"), "Your hour is saved.")
        fill(role(second, "textbox", "A note for tonight"), "Late tea")
        press(second, role(second, "button", "Save changes"))
        says(second, role(second, "status", "Manage status"), CONFLICT_COPY)
        poll(second, lambda: "22:00" in chosen(role(second, "combobox", "Bedtime"))
             and chosen(role(second, "textbox", "A note for tonight")) == NOTE_TABS,
             why="the stale tab was not filled with the latest hour")
    plan = me(client)
    assert plan["bedtime"] == "22:00" and plan["note"] == NOTE_TABS and plan["version"] == 2
    forget(client)


def test_wf_edit_hour_reminders_switch(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email, client, seen = keeper(app_url, mail)
    with open_app(browser, app_url + "/manage") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, app_url, mail, email, seen)
        reminders = role(page, "switch", "Reminders")
        status = role(page, "status", "Manage status")
        inflight: set[Any] = set()
        page.on("request", lambda r: inflight.add(r) if urlsplit(r.url).path.startswith("/api/me") else None)
        page.on("requestfinished", lambda r: inflight.discard(r))
        page.on("requestfailed", lambda r: inflight.discard(r))
        assert reminders.is_checked()
        press(page, reminders, "Space")
        says(page, status, "Reminders are paused.")
        assert not reminders.is_checked() and me(client)["reminders"] == "paused"
        advance(page, ROLL_MS)
        poll(page, lambda: not inflight and reminders.is_enabled(), why="the editor never finished reloading the hour")
        press(page, reminders, "Space")
        says(page, status, "Reminders are on.")
        assert me(client)["reminders"] == "on"
        press(page, role(page, "button", "Sign out"))
        says(page, status, "You are signed out.")
        assert role(page, "button", "Send me a sign-in link").count() == 1
        assert page.request.get(f"{app_url}/api/me/plan").status == 401
    forget(client)


def test_wf_reminders_confirm_then_remind(browser: Browser, app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_REMIND)
        _, email = unique("tokyo")
        email = email.lower()
        token = draft(app_url, mail, email, set(), bedtime="23:00", time_zone=TOKYO,
                      rituals=[{"id": "dim-lamps", "minutes": 10}, {"id": "warm-shower", "minutes": 15}], note=NOTE_SECRET)
        due = local_due(REMIND_NIGHT, TOKYO_START, TOKYO)
        with open_app(browser, f"{app_url}/signin?token={token}") as page:
            says(page, role(page, "status", "Link status"), "Your Stillhour is confirmed. Reminders are on.")
            put(at(due, seconds=-1))
            nothing_for(mail, email, REMINDER)
            put(due)
            messages = inbox(mail, email, REMINDER, expected=1)
            assert [m["Subject"] for m in messages] == ["Your Stillhour starts at 22:00"]
            body = content(messages[0])
            assert "23:00" in body and "/manage" in body
            assert ("Dim the lamps" in body or "dim-lamps" in body) and ("Warm shower" in body or "warm-shower" in body)
            assert NOTE_SECRET not in body
            put(at(due, minutes=20))
            assert len(inbox(mail, email, REMINDER, settle_s=NONE_SETTLE_S)) == 1
            page.request.delete(f"{app_url}/api/me")


@pytest.mark.parametrize("case_id", list(DST_CASES), ids=list(DST_CASES))
def test_clock_change_nights(app_url: str, mail: Mailpit, case_id: str) -> None:
    case = DST_CASES[case_id]
    with app_clock(app_url) as put:
        put(case["confirm"])
        email, client, _ = keeper(app_url, mail, bedtime=case["bedtime"], time_zone="America/New_York")
        try:
            assert same_instant(me(client)["next_reminder_at"], case["due"])
            put(at(case["due"], minutes=-1))
            nothing_for(mail, email, REMINDER)
            put(case["due"])
            messages = inbox(mail, email, REMINDER, expected=1)
            assert [m["Subject"] for m in messages] == [f"{REMINDER}{case['start']}"]
            put(case["later"])
            assert len(inbox(mail, email, REMINDER, settle_s=NONE_SETTLE_S)) == 1
            assert parse_iso(me(client)["next_reminder_at"]) > parse_iso(case["later"])
        finally:
            forget(client)


def test_one_reminder_per_night(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_NIGHTS)
        email, client, _ = keeper(app_url, mail, bedtime="23:00", time_zone=TOKYO)
        try:
            first, second, third = (local_due(day, TOKYO_START, TOKYO) for day in NIGHTS)
            put(first)
            assert len(inbox(mail, email, REMINDER, expected=1)) == 1
            put(at(first, minutes=30))
            assert len(inbox(mail, email, REMINDER, settle_s=NONE_SETTLE_S)) == 1
            put(iso(parse_iso(second) + LATE_LIMIT + timedelta(minutes=1)))
            assert len(inbox(mail, email, REMINDER, settle_s=NONE_SETTLE_S)) == 1
            assert same_instant(me(client)["next_reminder_at"], third)
            put(iso(parse_iso(third) + LATE_LIMIT))
            assert len(inbox(mail, email, REMINDER, expected=2)) == 2
            put(at(third, minutes=90))
            assert len(inbox(mail, email, REMINDER, settle_s=NONE_SETTLE_S)) == 2
        finally:
            forget(client)


def test_when_reminders_begin(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_BEGIN)
        email, client, _ = keeper(app_url, mail, bedtime="23:00", time_zone=TOKYO)
        try:
            missed, first, paused_night, resumed = (local_due(day, TOKYO_START, TOKYO) for day in BEGIN_NIGHTS)
            assert same_instant(me(client)["next_reminder_at"], first)
            put(at(missed, minutes=40))
            nothing_for(mail, email, REMINDER)
            put(first)
            assert len(inbox(mail, email, REMINDER, expected=1)) == 1
            put(at(first, minutes=10))
            plan = me(client)
            plan = patch(client, {"reminders": "paused"}, plan["version"]).json()["plan"]
            assert plan["next_reminder_at"] is None
            put(paused_night)
            assert len(inbox(mail, email, REMINDER, settle_s=NONE_SETTLE_S)) == 1
            put(at(paused_night, minutes=20))
            plan = patch(client, {"reminders": "on"}, plan["version"]).json()["plan"]
            assert same_instant(plan["next_reminder_at"], resumed)
            put(at(paused_night, minutes=30))
            assert len(inbox(mail, email, REMINDER, settle_s=NONE_SETTLE_S)) == 1
            put(at(resumed, hours=-1))
            plan = patch(client, {"bedtime": "23:30"}, plan["version"]).json()["plan"]
            moved = local_due(BEGIN_NIGHTS[3], start_of("23:30"), TOKYO)
            assert same_instant(plan["next_reminder_at"], moved)
            put(moved)
            messages = inbox(mail, email, REMINDER, expected=2)
            assert sorted(m["Subject"] for m in messages) == [f"{REMINDER}{TOKYO_START}", f"{REMINDER}{start_of('23:30')}"]
        finally:
            forget(client)


def test_wf_reminders_next_reminder_local(browser: Browser, app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_LOCAL)
        email, client, seen = keeper(app_url, mail, bedtime="23:00", time_zone=TOKYO)
        try:
            due = local_due(LOCAL_NIGHT, TOKYO_START, TOKYO)
            assert same_instant(me(client)["next_reminder_at"], due)
            local = parse_iso(due).astimezone(ZoneInfo(TOKYO))
            expected_line = f"Next reminder: {local:%A} {local.day} {local:%B} at {local:%H:%M} ({TOKYO})"
            with open_app(browser, app_url + "/privacy") as page:
                page.set_viewport_size(DESKTOP)
                cdp = session(page)
                cdp.send("Emulation.setTimezoneOverride", {"timezoneId": FAR_ZONE})
                browser_sign_in(page, app_url, mail, email, seen)
                line = page.get_by_text(expected_line)
                poll(page, lambda: line.count() > 0, why="next reminder not shown in the hour's zone")
                press(page, role(page, "switch", "Reminders"), "Space")
                poll(page, lambda: visible_count(page.get_by_text("Next reminder:")) == 0
                     and visible_count(page.get_by_text("Reminders are paused.")) > 0, why="paused line missing")
                assert me(client)["next_reminder_at"] is None
        finally:
            forget(client)


def test_test_clock(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        r = httpx.put(f"{app_url}/api/test/clock", json={"now": "2026-11-10T21:00:00+09:00"}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"now": T_CLOCK}
        for bad in ("2026-11-10T12:00:00", "tomorrow evening"):
            r = httpx.put(f"{app_url}/api/test/clock", json={"now": bad}, timeout=HTTP_TIMEOUT_S)
            assert_error(r, "invalid", {"now": FIELD_MESSAGES["now"]})
        put(T_CLOCK)
        email, client, _ = keeper(app_url, mail, bedtime="23:00", time_zone="Asia/Tokyo")
        put(local_due(CLOCK_NIGHTS[0], TOKYO_START, TOKYO))
        assert same_instant(me(client)["next_reminder_at"], local_due(CLOCK_NIGHTS[1], TOKYO_START, TOKYO)), "the due reminder had not run before the answer"
        forget(client)
        with app_copy(STILLHOUR_TEST_CLOCK="1") as (other, _):
            probes: list[str] = []

            def stamped_on_shared_clock() -> bool:
                _, probe = unique("clock")
                for _ in range(SIGNINS_PER_HOUR):
                    if ask_link(other, probe).status_code != 202:
                        return False
                refused = ask_link(app_url, probe)
                probes.append(probe)
                return refused.status_code == 429 and refused.headers.get("retry-after") == str(RATE_WINDOW_S)

            wait_real(stamped_on_shared_clock, CLOCK_SHARE_S + CLOCK_SLACK_S,
                      "the other instance never counted requests on the shared clock")
            probe = probes[-1]
            put("2026-11-10T13:30:00.000Z")
            wait_real(lambda: ask_link(other, probe).headers.get("retry-after") == str(RATE_WINDOW_S - 30 * 60),
                      CLOCK_SHARE_S + CLOCK_SLACK_S, "the other instance did not use the new clock within 1 second")
    assert httpx.delete(f"{app_url}/api/test/clock", timeout=HTTP_TIMEOUT_S).status_code == 204
    with app_copy(STILLHOUR_TEST_CLOCK=None) as (plain, _):
        assert_error(httpx.put(f"{plain}/api/test/clock", json={"now": T_CLOCK}, timeout=HTTP_TIMEOUT_S), "not_found")
        assert_error(httpx.delete(f"{plain}/api/test/clock", timeout=HTTP_TIMEOUT_S), "not_found")


def test_share_links(app_url: str, mail: Mailpit) -> None:
    _, client, _ = keeper(app_url, mail)

    def share_status(url: str) -> int:
        return httpx.get(f"{app_url}/api/share/{url.split('/p/')[1]}", timeout=HTTP_TIMEOUT_S).status_code

    made = client.post("/api/me/share")
    assert made.status_code == 201
    first = made.json()["share"]
    assert SHARE_PATH.match(first["url"]) and ISO_UTC.match(first["created_at"])
    assert share_status(first["url"]) == 200
    second = client.post("/api/me/share").json()["share"]["url"]
    assert second != first["url"]
    assert_error(httpx.get(f"{app_url}/api/share/{first['url'].split('/p/')[1]}", timeout=HTTP_TIMEOUT_S), "not_found")
    assert share_status(second) == 200 and me(client)["share_url"] == second
    plan = me(client)
    patch(client, {"reminders": "paused"}, plan["version"])
    assert share_status(second) == 200
    assert client.delete("/api/me/share").status_code == 204
    assert share_status(second) == 404 and me(client)["share_url"] is None
    assert client.delete("/api/me/share").status_code == 204
    third = client.post("/api/me/share").json()["share"]["url"]
    assert share_status(third) == 200 and share_status(first["url"]) == 404 and share_status(second) == 404
    _, waiting = unique("waiting")
    waiting = waiting.lower()
    seen: set[str] = set()
    draft(app_url, mail, waiting, seen)
    ask_link(app_url, waiting)
    drafty = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    drafty.post("/api/session/verify", json={"token": next_token(mail, waiting, SIGNIN, seen)})
    assert_error(drafty.post("/api/me/share"), "no_plan")
    assert_error(drafty.delete("/api/me/share"), "no_plan")
    forget(client)


def test_shared_hour_private(app_url: str, mail: Mailpit) -> None:
    email, client, _ = keeper(app_url, mail, note=NOTE_PRIVATE)
    url = client.post("/api/me/share").json()["share"]["url"]
    address = f"{app_url}/api/share/{url.split('/p/')[1]}"
    r = httpx.get(address, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200
    assert r.json() == {"plan": {"bedtime": "22:30", "time_zone": "Europe/London", "rituals": [
        {"id": "dim-lamps", "title": "Dim the lamps", "minutes": 10},
        {"id": "breathe", "title": "Breathe", "minutes": 5},
    ], "total_minutes": 15}}
    assert email not in r.text and NOTE_PRIVATE not in r.text
    version = me(client)["version"]
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert_error(httpx.request(method, address, json={"bedtime": "20:00"}, timeout=HTTP_TIMEOUT_S), "method_not_allowed")
    assert httpx.get(address, timeout=HTTP_TIMEOUT_S).json() == r.json()
    assert me(client)["version"] == version
    forget(client)


def test_wf_share_partner_view(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email, client, seen = keeper(app_url, mail, note=NOTE_PARTNER)
    titles = {ritual_id: title for ritual_id, title, _ in CATALOGUE}
    expected_items = [f"{titles[r['id']]} · {r['minutes']} min" for r in DEFAULT_RITUALS]
    total = sum(r["minutes"] for r in DEFAULT_RITUALS)
    winding = f"Winding down from {start_of('22:30')} for bed at 22:30, {LONDON} time."
    with open_app(browser, app_url + "/manage") as page:
        page.set_viewport_size(DESKTOP)
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin_of(app_url))
        browser_sign_in(page, app_url, mail, email, seen)
        status = role(page, "status", "Manage status")
        press(page, role(page, "button", "Create a share link"))
        says(page, status, "Your share link is ready.")
        box = role(page, "textbox", "Share link")
        share_url = me(client)["share_url"]
        poll(page, lambda: chosen(box).startswith("http") and chosen(box).endswith(share_url),
             why=lambda: f"share box holds {chosen(box)!r}")
        address = chosen(box)
        poll(page, lambda: role(page, "button", "Make a new share link").count() == 1,
             why="the create button was not renamed Make a new share link")
        press(page, role(page, "button", "Copy link"))
        says(page, status, "Link copied.")
        assert page.evaluate("navigator.clipboard.readText()") == address
        with open_app(browser, f"{app_url}{share_url}") as partner:
            heading = role(partner, "heading", "A shared Stillhour", level=1)
            poll(partner, lambda: heading.count() == 1, why="shared hour not shown")
            rituals_list = partner.get_by_role("list", name="Rituals")
            wanted = sorted(squeezed(item) for item in expected_items)
            poll(partner, lambda: sorted(rendered_items(rituals_list)) == wanted,
                 why=lambda: f"shared rituals {rendered_items(rituals_list)!r} != {expected_items!r}")
            page_text = partner.content()
            assert winding in " ".join(partner.evaluate("document.body.innerText").split())
            assert partner.get_by_text(f"{total} minutes in all").count() > 0
            assert email not in page_text and NOTE_PARTNER not in page_text
            assert partner.get_by_role("textbox").count() == 0
            press(page, role(page, "button", "Turn off sharing"))
            says(page, status, "Sharing is off. The old link no longer works.")
            poll(page, lambda: chosen(box) == "", why="the share box was not emptied")
            partner.reload()
            gone = role(partner, "heading", "This shared hour is no longer available.", level=1)
            poll(partner, lambda: gone.count() == 1, why="partner still sees the hour")
        assert_error(httpx.get(f"{app_url}/api/share/{share_url.split('/p/')[1]}", timeout=HTTP_TIMEOUT_S), "not_found")
    forget(client)


def test_wf_share_regenerate(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email, client, seen = keeper(app_url, mail)
    with open_app(browser, app_url + "/manage") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, app_url, mail, email, seen)
        press(page, role(page, "button", "Create a share link"))
        box = role(page, "textbox", "Share link")
        poll(page, lambda: "/p/" in chosen(box))
        old = chosen(box)
        press(page, role(page, "button", "Make a new share link"))
        poll(page, lambda: "/p/" in chosen(box) and chosen(box) != old, why="no new share link")
        new = chosen(box)
        for address, heading in ((old, "This shared hour is no longer available."), (new, "A shared Stillhour")):
            path = urlsplit(address).path
            with open_app(browser, f"{app_url}{path}") as partner:
                poll(partner, lambda h=heading: role(partner, "heading", h, level=1).count() == 1, why=f"{path}: {heading!r} missing")
        assert me(client)["share_url"] == urlsplit(new).path
    forget(client)


def test_wf_delete_everything_nothing_left(app_url: str, mail: Mailpit) -> None:
    with app_clock(app_url) as put:
        put(T_DELETE)
        before = keeping(app_url)
        _, email = unique("deleter")
        email = email.lower()
        seen: set[str] = set()
        confirm_token = draft(app_url, mail, email, seen, bedtime="23:00", time_zone="Asia/Tokyo")
        client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        assert client.post("/api/session/verify", json={"token": confirm_token}).status_code == 200
        assert keeping(app_url) == before + 1
        share = client.post("/api/me/share").json()["share"]["url"].split("/p/")[1]
        ask_link(app_url, email)
        other = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        assert other.post("/api/session/verify", json={"token": next_token(mail, email, SIGNIN, seen)}).status_code == 200
        ask_link(app_url, email)
        unused = next_token(mail, email, SIGNIN, seen)
        pending = draft(app_url, mail, email, seen, bedtime="21:00")
        old_cookie = client.cookies.get("stillhour_session")
        gone = client.delete("/api/me")
        assert gone.status_code == 204
        assert any(c.startswith("stillhour_session=") for c in gone.headers.get_list("set-cookie"))
        assert keeping(app_url) == before
        assert_error(httpx.get(f"{app_url}/api/me/plan", cookies={"stillhour_session": old_cookie}, timeout=HTTP_TIMEOUT_S), "signed_out")
        assert_error(other.get("/api/me/plan"), "signed_out")
        for token in (confirm_token, unused, pending):
            assert_error(verify(app_url, token), "link_unknown")
        assert_error(httpx.get(f"{app_url}/api/share/{share}", timeout=HTTP_TIMEOUT_S), "not_found")
        for day in DELETE_NIGHTS:
            put(local_due(day, TOKYO_START, TOKYO))
        nothing_for(mail, email, REMINDER)
        fresh = draft(app_url, mail, email, seen)
        again = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        assert again.post("/api/session/verify", json={"token": fresh}).status_code == 200
        plan = me(again)
        assert plan["version"] == 1 and plan["share_url"] is None
        forget(again)


def test_wf_delete_everything_dialog(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email, client, seen = keeper(app_url, mail)
    with open_app(browser, app_url + "/manage") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, app_url, mail, email, seen)
        opener = role(page, "button", "Delete everything")
        dialog = role(page, "dialog", "Delete everything")
        box = role(page, "textbox", "Type DELETE to confirm")
        confirm = role(page, "button", "Delete my hour for good")
        press(page, opener)
        poll(page, lambda: dialog.is_visible() and focused(box), why="dialog did not open with focus in the box")
        assert "This removes your hour, your reminders and any share link. It cannot be undone." in words(dialog)
        assert confirm.is_disabled()
        page.keyboard.press("Escape")
        poll(page, lambda: not dialog.is_visible() and focused(opener), why="Escape did not return focus")
        assert me(client)["email"] == email
        press(page, opener)
        poll(page, lambda: focused(box))
        fill(box, "delete")
        assert confirm.is_disabled()
        fill(box, "DELETE")
        assert confirm.is_enabled()
        for _ in range(6):
            page.keyboard.press("Tab")
            assert holds_focus(dialog), "Tab escaped the delete dialog"
        press(page, confirm)
        says(page, role(page, "status", "Manage status"), "Everything is deleted. You will not get another reminder.")
        assert role(page, "button", "Send me a sign-in link").count() == 1
        poll(page, lambda: focused(role(page, "heading", "Manage my hour", level=1)), why="focus not on the heading")
        assert page.request.get(f"{app_url}/api/me/plan").status == 401
    assert_error(client.get("/api/me/plan"), "signed_out")


def test_database_outage(app_url: str, mail: Mailpit) -> None:
    down = os.environ["APP_POSTGRES_DOWN_URL"]
    health = httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT_S)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert httpx.get(f"{down}/", timeout=HTTP_TIMEOUT_S).status_code == 200
    _, email = unique("outage")
    email = email.lower()
    for r in (
        httpx.get(f"{down}/api/tonight", timeout=HTTP_TIMEOUT_S),
        save(down, plan_body(email)),
        ask_link(down, email),
        verify(down, UNKNOWN_TOKEN),
        httpx.get(f"{down}/api/me/plan", timeout=HTTP_TIMEOUT_S),
        httpx.post(f"{down}/api/me/share", timeout=HTTP_TIMEOUT_S),
        httpx.get(f"{down}/api/share/{UNKNOWN_TOKEN}", timeout=HTTP_TIMEOUT_S),
    ):
        assert_error(r, "unavailable")
    nothing_for(mail, email)
    database = urlsplit(os.environ["DATABASE_URL"])
    relay = Relay(database.hostname or "127.0.0.1", database.port or 5432)
    netloc = database.netloc.rsplit("@", 1)
    host = f"127.0.0.1:{relay.port}"
    relayed = urlunsplit(database._replace(netloc=f"{netloc[0]}@{host}" if len(netloc) == 2 else host))
    try:
        with app_copy(DATABASE_URL=relayed) as (copy, proc):
            assert httpx.get(f"{copy}/api/health", timeout=HEALTH_S).status_code == 200
            _, later = unique("recover")
            later = later.lower()
            assert_error(save(copy, plan_body(later)), "unavailable")
            relay.open()
            r = save(copy, plan_body(later))
            assert r.status_code == 202, f"first save after the database returned: {r.status_code} {r.text}"
            assert proc.poll() is None
            assert len(inbox(mail, later, CONFIRM, expected=1)) == 1
    finally:
        relay.close()


def test_wf_outages_mail_down(browser: Browser, app_url: str, mail: Mailpit) -> None:
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    _, email = unique("queued")
    email = email.lower()
    with open_app(browser, down + "/?rituals=dim-lamps:10") as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        posts = track_posts(page, "/api/plans")
        fill_planner(page, email)
        button = role(page, "button", "Save my hour")
        into_view(page, button)
        x, y = center(button)
        page.mouse.dblclick(x, y)
        says(page, role(page, "status", "Planner status"), QUEUED_COPY)
        assert len(posts) == 1
    _, other = unique("queued")
    other = other.lower()
    r = save(down, plan_body(other))
    assert r.status_code == 202 and r.json() == {"status": "confirmation_queued"}
    link = ask_link(down, email)
    assert link.status_code == 202 and link.json() == {"status": "link_sent"}
    confirmations = inbox(mail, email, CONFIRM, expected=1, seconds=OUTBOX_WAIT_S)
    assert len(confirmations) == 1
    assert len(inbox(mail, other, CONFIRM, expected=1, seconds=OUTBOX_WAIT_S)) == 1
    assert len(inbox(mail, email, SIGNIN, expected=1, seconds=OUTBOX_WAIT_S)) == 1
    token = TOKEN_RE.findall(content(confirmations[0]))[0]
    answer = verify(app_url, token)
    assert answer.status_code == 200 and answer.json()["confirmed"] is True
    assert len(inbox(mail, email, CONFIRM, settle_s=NONE_SETTLE_S)) == 1


def test_wf_outages_planner_db_down(browser: Browser) -> None:
    down = os.environ["APP_POSTGRES_DOWN_URL"]
    _, email = unique("dbdown")
    with open_app(browser, down + "/?rituals=dim-lamps:10,breathe:5") as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        fill_planner(page, email, note=NOTE_KEPT)
        button = role(page, "button", "Save my hour")
        into_view(page, button)
        press(page, button)
        says(page, role(page, "status", "Planner status"), UNAVAILABLE)
        assert chosen(role(page, "textbox", "Email")) == email
        assert "22:30" in chosen(role(page, "combobox", "Bedtime"))
        assert "Europe/London" in chosen(role(page, "combobox", "Time zone"))
        assert chosen(role(page, "textbox", "A note for tonight")) == NOTE_KEPT
        assert planner_state(page) == {"Dim the lamps": 10, "Breathe": 5}
        assert rituals_in(page.url) == "dim-lamps:10,breathe:5"


def test_health_and_manifest(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert urlsplit(app_url).port in {4173, int(os.environ.get("APP_PUBLIC_PORT", "4173"))}
    dead = free_port()
    database = urlsplit(os.environ["DATABASE_URL"])
    netloc = database.netloc.rsplit("@", 1)
    host = f"127.0.0.1:{dead}"
    unreachable = urlunsplit(database._replace(netloc=f"{netloc[0]}@{host}" if len(netloc) == 2 else host))
    with app_copy(DATABASE_URL=unreachable, SMTP_HOST="127.0.0.1", SMTP_PORT=str(dead)) as (copy, _):
        quick = httpx.get(f"{copy}/api/health", timeout=HEALTH_S)
        assert quick.status_code == 200 and quick.json() == {"status": "ok"}
        assert httpx.get(f"{copy}/", timeout=HTTP_TIMEOUT_S).status_code == 200


@pytest.mark.parametrize("case_id", list(ERROR_CASES), ids=list(ERROR_CASES))
def test_request_limits_and_error_shape(app_url: str, case_id: str) -> None:
    method, path, content_type, payload, code = ERROR_CASES[case_id]
    headers = {"Content-Type": content_type} if content_type else {}
    content: bytes | None = None
    if payload == "oversize":
        content = b"{" + b" " * BODY_MAX
    elif payload is not None:
        content = payload.encode()
    r = httpx.request(method, f"{app_url}{path}", content=content, headers=headers, timeout=HTTP_TIMEOUT_S)
    assert_error(r, code)


def test_same_origin_and_private(browser: Browser, app_url: str, mail: Mailpit) -> None:
    _, email = unique("origin")
    email = email.lower()
    assert_error(save(app_url, plan_body(email), Origin=FOREIGN_ORIGIN), "cross_origin")
    nothing_for(mail, email)
    assert save(app_url, plan_body(email), Origin=origin_of(app_url)).status_code == 202
    for method, path in (("PATCH", "/api/me/plan"), ("DELETE", "/api/me"), ("PUT", "/api/test/clock"), ("POST", "/api/session/end")):
        r = httpx.request(method, f"{app_url}{path}", json={}, headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S)
        assert_error(r, "cross_origin")
    for path in ("/.env", "/package.json", "/run.json", "/package-lock.json", "/tsconfig.json"):
        r = httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 404, path
        assert "DATABASE_URL" not in r.text
    page = httpx.get(f"{app_url}/no-such-page", timeout=HTTP_TIMEOUT_S)
    assert page.status_code == 404
    with open_app(browser, f"{app_url}/no-such-page") as shown:
        poll(shown, lambda: shown.get_by_text("This page is not here.").count() > 0, why="the not-here page text is missing")
        hrefs = [link.get_attribute("href") or "" for link in shown.get_by_role("link").all()]
        targets = [urlsplit(urljoin(shown.url, href)).path for href in hrefs]
        assert "/" in targets, f"no link home: {targets}"
    samples = [
        page,
        httpx.post(f"{app_url}/api/session/request", content=b"{", headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S),
        httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S),
        verify(app_url, UNKNOWN_TOKEN),
    ]
    for r in samples:
        exposed = (r.text if r.headers.get("content-type", "").startswith("application/json") else "").lower()
        exposed += " " + " ".join(f"{k}: {v}" for k, v in r.headers.items()).lower()
        for word in LEAK_WORDS:
            assert word not in exposed, f"{r.request.url} leaks {word!r}"


def test_wf_cross_cutting_keyboard(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        milestones = [("link", "Stillhour"), ("switch", "Sound"), ("button", "Breathe with me"),
                      ("button", "Add Dim the lamps to my hour"), ("button", "Play the film"), ("textbox", "Email"),
                      ("button", "Save my hour"), ("link", "Manage my hour"), ("link", "Privacy")]
        rings = {"Sound": role(page, "switch", "Sound"), "Breathe with me": role(page, "button", "Breathe with me"),
                 "Save my hour": role(page, "button", "Save my hour"), "Manage my hour": role(page, "link", "Manage my hour")}
        start = role(page, "link", "Stillhour")
        for _ in range(MAX_TABS):
            if focused(start):
                break
            page.keyboard.press("Shift+Tab")
            advance(page, SETTLE_MS)
        assert focused(start), "Shift+Tab from the hero never reached the Stillhour link"
        reached = {"Stillhour": 0}
        ring_at_focus: dict[str, Any] = {}
        for presses in range(1, MAX_TABS + 1):
            page.keyboard.press("Tab")
            advance(page, SETTLE_MS)
            info = page.evaluate(FOCUS_JS)
            assert not info["body"], "focus fell back to the page body"
            assert info["w"] > 0 and info["h"] > 0 and not info["hidden"], f"focus on a hidden element: {info}"
            if info["button"]:
                assert info["h"] >= TARGET_PX, f"button box below 44 px tall: {info}"
            for kind, name in milestones:
                if name not in reached and focused(role(page, kind, name)):
                    reached[name] = presses
                    if name in rings:
                        ring_at_focus[name] = rings[name].evaluate(RING_JS)
            if "Privacy" in reached:
                break
        missing = [name for _, name in milestones if name not in reached]
        assert not missing, f"Tab never reached {missing}"
        order = [reached[name] for _, name in milestones]
        assert order == sorted(order), reached
        for name, control in rings.items():
            rest_pseudo = control.evaluate(RING_JS)
            rest, focus = state_styles(control, "outline-style", "outline-width", "box-shadow", "border-top-width",
                                       "border-top-style", "border-top-color", state="focus")
            outline = focus["outline-style"] not in ("none", "") and float(focus["outline-width"].rstrip("px") or 0) >= RING_PX
            shadow = focus["box-shadow"] not in ("none", "") and focus["box-shadow"] != rest["box-shadow"]
            border = any(focus[p] != rest[p] for p in ("border-top-width", "border-top-style", "border-top-color"))
            pseudo = ring_at_focus.get(name, rest_pseudo) != rest_pseudo
            assert outline or shadow or border or pseudo, (name, focus, rest)


def test_announced_results(browser: Browser, app_url: str) -> None:
    with story(browser, app_url, TABLET) as page:
        begin(page)
        for name in ("Breathing guide", "Ritual updates", "Planner status"):
            assert role(page, "status", name).count() == 1, name
        updates = role(page, "status", "Ritual updates")
        press(page, role(page, "button", "Add Dim the lamps to my hour"), "Space")
        says(page, updates, "Dim the lamps added. 10 of 60 minutes planned.")
        press(page, role(page, "button", "Add Breathe to my hour"), "Space")
        says(page, updates, "Breathe added. 15 of 60 minutes planned.")
        page.goto(app_url + "/manage")
        poll(page, lambda: role(page, "status", "Sign-in status").count() == 1, why="Sign-in status region missing")
        page.goto(app_url + "/signin")
        poll(page, lambda: role(page, "status", "Link status").count() == 1, why="Link status region missing")


def test_wf_cross_cutting_viewports(browser: Browser, app_url: str) -> None:
    for viewport in VIEWPORTS:
        with story(browser, app_url, viewport) as page:
            begin(page)
            for chapter in CHAPTERS:
                assert region(page, chapter).count() == 1, (viewport, chapter)
            controls = [role(page, "timer", "Story clock"), role(page, "switch", "Sound"),
                        role(page, "button", "Breathe with me"), role(page, "button", "Play the film"),
                        role(page, "textbox", "Email"), role(page, "button", "Save my hour"),
                        role(page, "link", "Manage my hour"), role(page, "link", "Privacy")]
            for control in controls:
                assert control.count() == 1
                into_view(page, control)
                box = rect(control)
                assert box["x"] >= 0 and box["x"] + box["w"] <= viewport["width"], (viewport, box)
            lefts = set()
            for _, title, _ in CATALOGUE:
                card = role(page, "group", title)
                into_view(page, card)
                settle(card)
                lefts.add(steady(page, lambda c=card: round(rect(c)["x"])))
            if viewport == PHONE:
                assert len(lefts) == 1, lefts
            if viewport == TABLET:
                assert len(lefts) == 2, lefts
            for y in (0, max_scroll(page) // 2, max_scroll(page)):
                scroll_to(page, y)
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), (viewport, y)
                if viewport != DESKTOP:
                    layout(page)
            for path in ("/manage", "/privacy"):
                page.goto(app_url + path)
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), (viewport, path)
                layout(page)


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        begin(page)
        heading = role(page, "heading", TITLE, level=1)
        first = letters(heading)
        assert first, "the hero title has no letters"
        advance(page, TITLE_MS)
        assert letter_shift(first, letters(heading)) <= LETTER_SLACK_PX, "title letters moved under reduced motion"
        assert page.evaluate("[(" + SCROLLER + ")(), document.documentElement]"
                             ".every(e => getComputedStyle(e).scrollBehavior !== 'smooth')")
        page.mouse.move(DESKTOP["width"] / 2, DESKTOP["height"] / 2)

        def unlocked() -> bool:
            page.mouse.wheel(0, DESKTOP["height"])
            return scroll_pos(page) > 0

        poll(page, unlocked, why="scrolling never unlocked after the gate")
        scroll_to(page, 0)
        page.mouse.wheel(0, DESKTOP["height"])
        wait_real(lambda: scroll_pos(page) >= DESKTOP["height"], WHEEL_S,
                  "the wheel scroll was held back by page smoothing")
        city = region(page, "The city at night")
        top = max_scroll(page)
        positions = list(range(0, top, max(1, view_height(page) // 4))) + [top]
        forward = city_scan(page, city, positions)
        ordered = [forward[y] for y in positions if y in forward]
        assert ordered and ordered[0] == (COUNTER_MAX, CITY_CAPTIONS[0]) and ordered[-1] == (1, CITY_CAPTIONS[2]), ordered
        assert city_scan(page, city, list(reversed(positions))) == forward, "the counter did not follow scroll back"


def shipped_packages() -> dict[tuple[str, str], dict[str, Any]]:
    cwd = APP_DIR if (APP_DIR / "node_modules").is_dir() else Path(DEPLOYED_APP)
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd,
                         capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
    tree = json.loads(out.stdout)
    found: dict[tuple[str, str], dict[str, Any]] = {}

    def walk(node: dict[str, Any]) -> None:
        for name, dep in (node.get("dependencies") or {}).items():
            if "version" not in dep:
                continue
            key = (name, str(dep.get("version")))
            if key not in found:
                found[key] = dep
                walk(dep)

    walk(tree)
    return found


def licence_of(dep: dict[str, Any]) -> str:
    value = dep.get("license")
    if value is None and dep.get("path"):
        manifest = json.loads((Path(dep["path"]) / "package.json").read_text())
        value = manifest.get("license") or manifest.get("licenses")
    if isinstance(value, dict):
        value = value.get("type")
    if isinstance(value, list):
        value = " OR ".join(v.get("type", "") if isinstance(v, dict) else str(v) for v in value)
    return str(value or "")


LICENCE_ALIASES = {
    "mit": "MIT", "mitlicense": "MIT", "expat": "MIT",
    "isc": "ISC", "isclicense": "ISC",
    "apache20": "Apache-2.0", "apache2": "Apache-2.0", "apachev2": "Apache-2.0", "apachev20": "Apache-2.0",
    "apachelicense20": "Apache-2.0", "apachelicensev20": "Apache-2.0", "apachelicenseversion20": "Apache-2.0",
    "bsd2clause": "BSD-2-Clause", "bsd2": "BSD-2-Clause", "simplifiedbsd": "BSD-2-Clause", "freebsd": "BSD-2-Clause",
    "bsd3clause": "BSD-3-Clause", "bsd3": "BSD-3-Clause", "newbsd": "BSD-3-Clause", "modifiedbsd": "BSD-3-Clause",
    "revisedbsd": "BSD-3-Clause",
    "0bsd": "0BSD", "zerobsd": "0BSD", "bsdzeroclause": "0BSD",
}
UNCLEAR_LICENCES = {"", "bsd", "apache", "custom"}
LICENCE_TEXTS = [
    r"Permission is hereby granted, free of charge",
    r"Apache License,? Version 2\.0",
    r"Permission to use, copy, modify, and/or distribute this software for any purpose",
    r"Redistribution and use in source and binary forms",
]


def licence_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def allowed(expression: str) -> bool:
    expression = expression.strip().strip("()").strip()
    if re.search(r"\s+OR\s+", expression, re.I):
        return any(allowed(part) for part in re.split(r"\s+OR\s+", expression, flags=re.I))
    if re.search(r"\s+AND\s+", expression, re.I):
        return all(allowed(part) for part in re.split(r"\s+AND\s+", expression, flags=re.I))
    return expression in ALLOWED_LICENCES or LICENCE_ALIASES.get(licence_key(expression)) in ALLOWED_LICENCES


def licence_file_allowed(dep: dict[str, Any]) -> bool:
    if not dep.get("path") or not Path(dep["path"]).is_dir():
        return False
    for path in Path(dep["path"]).iterdir():
        if not path.is_file() or not path.name.upper().startswith(("LICENSE", "LICENCE", "COPYING")):
            continue
        body = " ".join(path.read_text(errors="replace").split())
        if re.search(r"advertising materials", body, re.I):
            continue
        if any(re.search(pattern, body, re.I) for pattern in LICENCE_TEXTS):
            return True
    return False


def licence_ok(dep: dict[str, Any]) -> bool:
    declared = licence_of(dep)
    if allowed(declared):
        return True
    unclear = licence_key(declared) in UNCLEAR_LICENCES or "seelicen" in licence_key(declared)
    return unclear and licence_file_allowed(dep)


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({name for name, _ in shipped_packages() if name not in notices})
    assert not missing, f"packages missing from notices: {missing}"
    flat = re.sub(r"[\s_\-]+", "", notices.lower())
    for font in ("Fraunces", "Hanken Grotesk"):
        assert re.sub(r"[\s_\-]+", "", font.lower()) in flat, font


def test_if_licences() -> None:
    bad = sorted(f"{n}@{v}: {licence_of(d)!r}" for (n, v), d in shipped_packages().items() if not licence_ok(d))
    assert not bad, bad
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    assert re.search(r"open\s*font\s*licen[cs]e|\bOFL\b", notices, re.I), "the fonts' SIL Open Font License is not named"


def test_if_postgres_only() -> None:
    names = {name for name, _ in shipped_packages()}
    assert not names & DATASTORE_PACKAGES, names & DATASTORE_PACKAGES
    for comm in Path("/proc").glob("[0-9]*/comm"):
        try:
            name = comm.read_text().strip()
        except OSError:
            continue
        assert name not in {"redis-server", "mongod", "mysqld", "memcached"}, name


def test_if_service_config_untouched(app_url: str) -> None:
    user = urlsplit(os.environ["DATABASE_URL"]).username
    rows = Postgres().rows(f"SELECT rolsuper FROM pg_roles WHERE rolname = '{user}'")
    assert rows and rows[0]["rolsuper"] is False
    assert httpx.get(f"{app_url}/api/tonight", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        page.reload()
        begin(page)
        scroll_to(page, max_scroll(page))
        opener = role(page, "button", "Play the film")
        into_view(page, opener)
        press(page, opener)
        advance(page, ROLL_MS)
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, origin_of(app_url))]
        assert not foreign, foreign


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", ".git", "public", "coverage", ".next", "out", ".vite",
            "scripts", "tools", "bin"}

    def authored_ts(p: Path) -> bool:
        return p.is_file() and p.suffix in TS_SUFFIXES and not re.search(r"\.d\.[mc]?ts$", p.name)

    javascript = []
    typescript = 0
    for path in APP_DIR.rglob("*"):
        if skip & set(path.relative_to(APP_DIR).parts) or not path.is_file():
            continue
        if authored_ts(path):
            typescript += 1
        elif path.parent == APP_DIR:
            continue
        elif path.suffix in {".js", ".jsx", ".mjs", ".cjs"} and ".config." not in path.name and not path.name.startswith("."):
            siblings = [p for p in path.parent.iterdir() if authored_ts(p)]
            stem = path.name.rsplit(".", 1)[0]
            compiled = any(p.name.rsplit(".", 1)[0] == stem for p in siblings) or (path.parent / f"{stem}.d.ts").exists()
            if siblings and not compiled:
                javascript.append(str(path))
    assert typescript > 0
    assert not javascript, javascript
