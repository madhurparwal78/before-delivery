from __future__ import annotations

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
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from datetime import time as dtime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

import conftest as kit
from conftest import (
    advance,
    check,
    click,
    fill,
    held,
    open_app,
    same_origin,
    select,
    session,
    settle,
    state_styles,
    style,
)


PASSWORD = "frost-line-2026"
KESTREL = "Kestrel Refrigeration Co."
CHICAGO_NAME = "America/Chicago"
NEW_YORK_NAME = "America/New_York"
CHICAGO = ZoneInfo(CHICAGO_NAME)
NEW_YORK = ZoneInfo(NEW_YORK_NAME)
SECRET_GATE = "4471#"
SEED = {
    "dana": "dana@kestrel.example",
    "rui": "rui@kestrel.example",
    "sam": "sam@kestrel.example",
    "priya": "priya@kestrel.example",
    "marco": "marco@kestrel.example",
    "jo": "jo@kestrel.example",
    "lee": "lee@halvard.example",
    "ari": "ari@halvard.example",
}

SEND_LIMIT = 20
SEND_WINDOW_S = 60
TEXT_LIMIT = 4000
PHOTO_BYTES_LIMIT = 10_000_000
PHOTO_COUNT_LIMIT = 4
FILENAME_MAX = 100
THUMB_MAX = 320
PIN_LIMIT = 3
PAGE_CAP = 100
RECEIPT_IDS_MAX = 100
Q_MAX = 200
Q_WORDS = 8
SNIPPET_MAX = 160
SEARCH_BUDGET_S = 2
PIXEL_REFUSAL_S = 2
NAME_MAX = 80
PASSWORD_MIN = 12
PASSWORD_MAX = 128
EVENT_DELAY_S = 2
FIRE_DELAY_S = 10
DIGEST_DELAY_S = 10
DIGEST_HOUR = 7
HEALTH_S = 30
QUEUE_RETRY_S = 30
QUEUE_CLEAR_S = 60
OUTAGE_DELETE_S = 2
SEND_TIMEOUT_MS = 15_000
PAUSED_NOTICE_MS = 5_000
READ_DWELL_MS = 1_000
EDIT_MENU_SLACK_S = 2
JSON_LIMIT = 64_000
MULTIPART_LIMIT = 41_000_000
TEXT_MIN_PX = 16
HIT_MIN = 44
INK_BAR_MIN = 4
UNREAD_WEIGHT = 600
READ_WEIGHT = 400
TRAVEL_MIN_MS = 200
TRAVEL_MAX_MS = 334
SNAP_MAX_MS = 20
DETAIL_TABLET_MIN = 0.55
DETAIL_TABLET_MAX = 0.8
DETAIL_MOBILE_MIN = 0.95
VIEWPORTS = {"mobile": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}


SHORT_WINDOW_S = 45
BROWSER_SKEW_H = 3
BROWSER_ZONE = "Asia/Tokyo"
SCHEDULE_LEAD_S = 20
MENTION_AGE_S = 10
DIGEST_LEAD_S = 150
DIGEST_WINDOW_S = 60
ANCHOR_ADVANCE_MS = 5_000
SCRUB_MID_MS = 100
EDGE_SLACK = 1
EVENT_SLACK_S = 3
MAIL_WAIT_S = 30
MAIL_SETTLE_S = 5
UI_WAIT_S = 20
POLL_MS = 500
SOON_S = 30
MIN_STEP_MS = 50
POLL_INTERVAL_S = 0.25
HTTP_TIMEOUT_S = 60
STARTUP_S = 180
HISTORY_PAGES = 200
NPM_TIMEOUT_S = 300
DST_SCAN_DAYS = 400

ERR = {
    "payload_too_large": "That request is larger than Rimewire accepts.",
    "unsupported_media_type": "Send JSON, or a form with photos.",
    "unauthenticated": "Your session has ended. Sign in again.",
    "invalid_credentials": "Email or password is incorrect.",
    "not_found": "That was not found.",
    "forbidden": "Your role cannot do that here.",
    "cross_origin": "Requests must come from Rimewire itself.",
    "broadcast_only": "Only dispatch, crew leads and operations post here. Reply in a thread instead.",
    "client_message_id_conflict": "That send id was already used for a different message.",
    "message_deleted": "That message was deleted.",
    "rate_limited": "You are sending faster than Rimewire accepts. Wait a moment, then use Retry send.",
    "stale_version": "Someone saved a newer version.",
    "edit_window_closed": "This message can no longer be edited.",
    "already_pinned": "That message is already pinned.",
    "pin_limit": "This channel has reached its pin limit. Unpin one first.",
    "schedule_not_pending": "This post has already gone out or was cancelled.",
    "email_taken": "That email cannot be invited.",
    "cannot_deactivate_self": "You cannot deactivate yourself.",
    "validation": "Check the highlighted fields.",
    "storage_unavailable": "Photo storage is unreachable. Text-only messages still send; try the photos again shortly.",
    "internal_error": "Something went wrong on our side. Try again.",
}

COPY = {
    "unaccepted": "This field cannot be set here.",
    "email": "Enter an email address.",
    "password_signin": "Enter your password.",
    "password_join": "Use 12 to 128 characters.",
    "name_empty": "Enter a name.",
    "name_control": "Names cannot contain line breaks or control characters.",
    "name_long": "Use at most 80 characters.",
    "role": "Pick a role.",
    "text_empty": "Write a message or attach a photo.",
    "text_long": "This message is over the length limit.",
    "client_message_id": "Sending needs a client message id in UUID form.",
    "thread_root_id": "Reply to a top-level message in this channel.",
    "quoted_message_id": "Quote a message from this channel.",
    "files_count": "That is more photos than one message can carry.",
    "expected_version": "Editing needs the version you started from.",
    "date_time": "Pick a date and a time.",
    "repeat": "Choose no repeat or weekly.",
    "q_short": "Search for at least 2 characters.",
    "q_long": "Search for at most 200 characters.",
    "q_words": "Search for at most 8 words.",
    "limit": "Use a whole number of 1 or more.",
    "before": "That page link is no longer valid.",
    "message_ids": "Send between 1 and 100 message ids.",
    "state": "Use delivered or read.",
    "user_id": "Pick a person.",
}


def wrong_type(name: str) -> str:
    return f"{name} is not a JPEG, PNG or WebP photo."


def too_large(name: str) -> str:
    return f"{name} is over the photo size limit."


def too_many_pixels(name: str) -> str:
    return f"{name} is over the 40-megapixel limit."


def passed_in(zone: str) -> str:
    return f"That time has already passed in {zone}."


def unread_link(name: str, n: int) -> str:
    return f"{name}, {n} unread"


def saved_as(k: int) -> str:
    return f"Edit saved as version {k}."


def lost_access(channel: str) -> str:
    return f"You no longer have access to #{channel}."


def view_replies(n: int) -> str:
    return f"View {n} replies"


def at_handle(handle: str) -> str:
    return f"@{handle}"


COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax")
FORBIDDEN_STORES = ("SQLite", "Redis")
WRONG_PASSWORD = "wrong-password"
FOCUS_PROPS = ("outline-style", "outline-width", "box-shadow")


def touch_screen(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    return cdp


def _touch(cdp: Any, kind: str, points: list[dict]) -> None:
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})


def touch_start(cdp: Any, x: float, y: float) -> None:
    _touch(cdp, "touchStart", [{"x": x, "y": y, "id": 1}])


def touch_move(cdp: Any, x: float, y: float) -> None:
    _touch(cdp, "touchMove", [{"x": x, "y": y, "id": 1}])


def touch_end(cdp: Any) -> None:
    _touch(cdp, "touchEnd", [])


def browser_zone(page: Page, zone: str) -> None:
    session(page).send("Emulation.setTimezoneOverride", {"timezoneId": zone})


_pause = threading.Event()


def breathe() -> None:
    _pause.wait(POLL_INTERVAL_S)


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    end = time.monotonic() + seconds
    while True:
        try:
            value = fn()
        except (httpx.HTTPError, KeyError):
            value = None
        if value:
            return value
        if time.monotonic() > end:
            raise AssertionError(f"timed out waiting for {what}")
        breathe()


def soon(check_: Callable[[], Any], *pages: Page, seconds: float = SOON_S) -> Any:
    end = time.monotonic() + seconds
    last = time.monotonic()
    while True:
        try:
            return check_()
        except (AssertionError, PlaywrightError):
            if time.monotonic() > end:
                raise
        now = time.monotonic()
        step = max((now - last) * 1000, MIN_STEP_MS)
        last = now
        for p in pages:
            advance(p, step)


def together(fns: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(fns))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(max_workers=len(fns)) as pool:
        futures = [pool.submit(run, fn) for fn in fns]
        return [f.result() for f in futures]


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def when(moment: datetime, zone: ZoneInfo) -> str:
    local = moment.astimezone(zone)
    return f"{local:%a} {local.day} {local:%b}, {local:%H:%M} {local.tzname()}"


def business_date(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b}"


def transitions(zone: ZoneInfo, after: datetime) -> list[tuple[date, bool]]:
    start = after.astimezone(zone).date()
    out = []
    for i in range(1, DST_SCAN_DAYS):
        day = start + timedelta(days=i)
        before = datetime.combine(day - timedelta(days=1), dtime(12), tzinfo=zone).utcoffset()
        now = datetime.combine(day, dtime(12), tzinfo=zone).utcoffset()
        if before != now:
            out.append((day, now > before))
    return out


def api(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)


def clone(c: httpx.Client) -> httpx.Client:
    other = api(str(c.base_url).rstrip("/"))
    for k, v in c.cookies.items():
        other.cookies.set(k, v)
    return other


def signin(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    c = api(base)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, (email, r.status_code, r.text)
    return c


def me(c: httpx.Client) -> dict:
    r = c.get("/api/me")
    assert r.status_code == 200, r.text
    return r.json()["user"]


def health(base: str) -> dict:
    return httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json()


def server_now(base: str) -> datetime:
    return parsedate_to_datetime(httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).headers["date"])


def host_now(base: str) -> datetime:
    return server_now(base) - timedelta(seconds=int(os.environ.get("APP_CLOCK_OFFSET_SECONDS") or "0"))


def assert_error(resp: httpx.Response, status: int, code: str, field: str | None = None, copy: str | None = None) -> dict:
    assert resp.status_code == status, (resp.status_code, resp.text)
    assert resp.headers.get("content-type", "").startswith("application/json"), resp.headers.get("content-type")
    body = resp.json()
    assert body["error"] == code, body
    assert isinstance(body["message"], str)
    if code in ERR:
        assert body["message"] == ERR[code], body
    if field is not None:
        assert field in body["errors"], body
        if copy is not None:
            assert body["errors"][field] == copy, body
    return body


def channel_id(c: httpx.Client, name: str) -> str:
    for ch in c.get("/api/channels").json()["channels"]:
        if ch["name"] == name:
            return ch["id"]
    raise AssertionError(f"no channel {name}")


def unread(c: httpx.Client, name: str) -> int:
    return next(ch["unread_count"] for ch in c.get("/api/channels").json()["channels"] if ch["name"] == name)


def send(c: httpx.Client, cid: str, text: str, cmid: str | None = None, **extra: Any) -> httpx.Response:
    body = {"client_message_id": cmid or str(uuid.uuid4()), "text": text, **extra}
    return c.post(f"/api/channels/{cid}/messages", json=body)


def post(c: httpx.Client, cid: str, text: str, **extra: Any) -> dict:
    r = send(c, cid, text, **extra)
    assert r.status_code == 201, r.text
    return r.json()["message"]


def send_photos(c: httpx.Client, cid: str, text: str, files: list[tuple[str, bytes, str]], cmid: str | None = None, **extra: Any) -> httpx.Response:
    data = {"client_message_id": cmid or str(uuid.uuid4()), "text": text, **extra}
    parts = [("file", (name, payload, ctype)) for name, payload, ctype in files]
    return c.post(f"/api/channels/{cid}/messages", data=data, files=parts)


def edit(c: httpx.Client, mid: str, text: str, expected: Any) -> httpx.Response:
    return c.patch(f"/api/messages/{mid}", json={"text": text, "expected_version": expected})


def receipts(c: httpx.Client, ids: list[str], state: str) -> httpx.Response:
    return c.post("/api/receipts", json={"message_ids": ids, "state": state})


def add_member(c: httpx.Client, cid: str, uid: str) -> httpx.Response:
    return c.post(f"/api/channels/{cid}/members", json={"user_id": uid})


def search(c: httpx.Client, q: str, **params: Any) -> dict:
    r = c.get("/api/search", params={"q": q, **params})
    assert r.status_code == 200, r.text
    return r.json()


def versions_of(c: httpx.Client, mid: str) -> list[dict]:
    return c.get(f"/api/messages/{mid}/versions").json()["versions"]


def history_entry(c: httpx.Client, cid: str, mid: str) -> dict | None:
    cursor = None
    for _ in range(HISTORY_PAGES):
        params: dict[str, Any] = {"limit": PAGE_CAP}
        if cursor:
            params["before"] = cursor
        body = c.get(f"/api/channels/{cid}/messages", params=params).json()
        for m in body["messages"]:
            if m["id"] == mid:
                return m
        cursor = body["next_cursor"]
        if not cursor:
            return None
    return None


def unpin_all(c: httpx.Client, cid: str) -> None:
    for pid in c.get(f"/api/channels/{cid}").json()["channel"]["pinned_message_ids"]:
        c.delete(f"/api/channels/{cid}/pins/{pid}")


def schedule(c: httpx.Client, cid: str, text: str, day: date | str, at: str, repeat: str = "none") -> httpx.Response:
    return c.post(f"/api/channels/{cid}/scheduled", json={"text": text, "local_date": str(day), "local_time": at, "repeat": repeat})


def scheduled(c: httpx.Client, cid: str, sid: str) -> dict:
    return next(s for s in c.get(f"/api/channels/{cid}/scheduled").json()["scheduled"] if s["id"] == sid)


def recipients_of(m: dict) -> list[str]:
    return [a.lower() for f in ("To", "Cc", "Bcc") for a in kit.addresses(m.get(f) or [])]


def mail_to(mail: Any, address: str, subject: str | None = None, count: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict]:
    end = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages(0, 0) if address.lower() in recipients_of(m) and (subject is None or m.get("Subject", "").startswith(subject))]
        if len(found) >= count or time.monotonic() > end:
            return found
        breathe()


def mail_date(m: dict) -> datetime:
    return iso(m["Date"])


def digest_lines(m: dict) -> list[str]:
    return [line.strip() for line in kit.text(m).splitlines() if line.strip().startswith("#")]


def invite_token(mail: Any, email: str) -> str:
    found = mail_to(mail, email, subject="Join ", seconds=MAIL_WAIT_S)
    assert found, f"no invite email to {email}"
    match = re.search(r"/join/([A-Za-z0-9_\-.~%]+)", kit.text(found[0]))
    assert match, kit.text(found[0])
    return match.group(1)


def digest_offset(now: datetime, zone: ZoneInfo, days: int) -> tuple[datetime, int]:
    day = now.astimezone(zone).date() + timedelta(days=days)
    target = datetime.combine(day, dtime(DIGEST_HOUR), tzinfo=zone)
    return target, int((target - timedelta(seconds=DIGEST_LEAD_S) - now).total_seconds())


@dataclass
class Person:
    c: httpx.Client
    id: str
    name: str
    email: str
    password: str
    handle: str

    def on(self, base: str) -> httpx.Client:
        return signin(base, self.email, self.password)


def fresh(app_url: str, mail: Any, role: str, channels: list[str] | tuple[str, ...] = (), workspace: str = "kestrel") -> Person:
    inviter = signin(app_url, SEED["lee"] if workspace == "halvard" else SEED["jo"])
    tag = uuid.uuid4().hex[:8]
    name = f"Fresh {role.split('_')[0].title()} {tag}"
    email = f"{role.replace('_', '-')}-{tag}@{workspace}.example"
    password = f"frost-line-{tag}"
    r = inviter.post("/api/workspace/members", json={"name": name, "email": email, "role": role})
    assert r.status_code == 201, r.text
    token = invite_token(mail, email)
    c = api(app_url)
    accepted = c.post(f"/api/invites/{token}/accept", json={"password": password})
    assert accepted.status_code == 200, accepted.text
    user = accepted.json()["user"]
    for ch in channels:
        assert add_member(inviter, channel_id(inviter, ch), user["id"]).status_code == 201
    return Person(c, user["id"], name, email, password, user["handle"])


class Stream:
    def __init__(self, base: str, client: httpx.Client, last: Any = None, query_id: Any = None) -> None:
        self.events: list[dict] = []
        self.status: int | None = None
        self.body = b""
        self.ready = threading.Event()
        self.done = threading.Event()
        headers = {"Accept": "text/event-stream"}
        if last is not None:
            headers["Last-Event-ID"] = str(last)
        params = {} if query_id is None else {"last_event_id": str(query_id)}
        self.http = httpx.Client(base_url=base, timeout=httpx.Timeout(HTTP_TIMEOUT_S, read=None))
        for k, v in client.cookies.items():
            self.http.cookies.set(k, v)
        threading.Thread(target=self._run, args=(headers, params), daemon=True).start()
        self.ready.wait(HTTP_TIMEOUT_S)

    def _run(self, headers: dict, params: dict) -> None:
        try:
            with self.http.stream("GET", "/api/events", headers=headers, params=params) as r:
                self.status = r.status_code
                if r.status_code != 200:
                    self.body = r.read()
                    return
                self.ready.set()
                current: dict[str, str] = {}
                for line in r.iter_lines():
                    if line == "":
                        if "event" in current or "data" in current:
                            self.events.append({
                                "id": int(current["id"]) if current.get("id", "").isdigit() else None,
                                "event": current.get("event", "message"),
                                "data": json.loads(current["data"]) if current.get("data") else None,
                            })
                        current = {}
                    elif not line.startswith(":"):
                        key, _, value = line.partition(":")
                        value = value[1:] if value.startswith(" ") else value
                        current[key] = current[key] + "\n" + value if key == "data" and key in current else value
        except (httpx.HTTPError, ValueError, RuntimeError):
            return
        finally:
            self.ready.set()
            self.done.set()

    def matching(self, pred: Callable[[dict], bool]) -> list[dict]:
        return [e for e in list(self.events) if pred(e)]

    def wait(self, pred: Callable[[dict], bool], seconds: float, what: str) -> dict:
        return poll(lambda: next(iter(self.matching(pred)), None), seconds, what)

    def close(self) -> None:
        self.http.close()


def about(e: dict, mid: str) -> bool:
    data = e.get("data") or {}
    return data.get("message_id") == mid or (data.get("message") or {}).get("id") == mid


def in_channel(e: dict, cid: str) -> bool:
    data = e.get("data") or {}
    return cid in (data.get("channel_id"), (data.get("message") or {}).get("channel_id"), (data.get("channel") or {}).get("id"))


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def serve_copy(**overrides: Any) -> Iterator[str]:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ)
    env["APP_PUBLIC_PORT"] = str(port)
    env["APP_PUBLIC_URL"] = base
    for key, value in overrides.items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = str(value)
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile(prefix="rimewire-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=kit.DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-4000:]

    def up() -> bool:
        if proc.poll() is not None:
            raise AssertionError(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            return httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        try:
            poll(up, STARTUP_S, "app copy to serve")
        except AssertionError as err:
            raise AssertionError(f"{err}\n{tail()}") from err
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.upstream = (host, port)
        self.port = free_port()
        self.sock: socket.socket | None = None

    def open(self) -> None:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen()
        self.sock = s
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while self.sock is not None:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._join, args=(conn,), daemon=True).start()

    def _join(self, conn: socket.socket) -> None:
        try:
            up = socket.create_connection(self.upstream, timeout=HTTP_TIMEOUT_S)
        except OSError:
            conn.close()
            return
        for a, b in ((conn, up), (up, conn)):
            threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while chunk := src.recv(65536):
                dst.sendall(chunk)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def close(self) -> None:
        if self.sock is not None:
            sock, self.sock = self.sock, None
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()


def storage_relay() -> Relay:
    endpoint = urlparse(os.environ["S3_ENDPOINT"])
    return Relay(endpoint.hostname or "127.0.0.1", endpoint.port or (443 if endpoint.scheme == "https" else 80))


def mail_relay() -> Relay:
    return Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))


def _exif(orientation: int | None, owner: str | None) -> bytes:
    entries: list[bytes] = []
    extra = b""
    count = (1 if orientation else 0) + (2 if owner else 0)
    ifd_end = 8 + 2 + 12 * count + 4
    if orientation:
        entries.append(struct.pack(">HHIHH", 0x0112, 3, 1, orientation, 0))
    if owner:
        artist = owner.encode() + b"\x00"
        if len(artist) % 2:
            artist += b"\x00"
        entries.append(struct.pack(">HHII", 0x013B, 2, len(owner) + 1, ifd_end))
        gps_at = ifd_end + len(artist)
        entries.append(struct.pack(">HHII", 0x8825, 4, 1, gps_at))
        rational_at = gps_at + 2 + 2 * 12 + 4
        gps = struct.pack(">H", 2) + struct.pack(">HHI", 1, 2, 2) + b"N\x00\x00\x00"
        gps += struct.pack(">HHII", 2, 5, 3, rational_at) + struct.pack(">I", 0)
        extra = artist + gps + struct.pack(">6I", 41, 1, 52, 1, 7, 1)
    tiff = b"MM\x00\x2a\x00\x00\x00\x08" + struct.pack(">H", count) + b"".join(entries) + struct.pack(">I", 0) + extra
    payload = b"Exif\x00\x00" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


def _jpeg(w: int, h: int, app1: bytes = b"") -> bytes:
    dqt = b"\xff\xdb" + struct.pack(">H", 67) + b"\x00" + bytes([1] * 64)
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, h, w, 1) + bytes([1, 0x11, 0])
    dht_dc = b"\xff\xc4" + struct.pack(">H", 20) + b"\x00" + bytes([1] + [0] * 15) + b"\x00"
    dht_ac = b"\xff\xc4" + struct.pack(">H", 20) + b"\x10" + bytes([1] + [0] * 15) + b"\x00"
    sos = b"\xff\xda" + struct.pack(">HB", 8, 1) + bytes([1, 0x00, 0, 63, 0])
    bits = ((w + 7) // 8) * ((h + 7) // 8) * 2
    data = bytearray((bits + 7) // 8)
    pad = len(data) * 8 - bits
    if pad:
        data[-1] = (1 << pad) - 1
    return b"\xff\xd8" + app1 + dqt + sof + dht_dc + dht_ac + sos + bytes(data) + b"\xff\xd9"


def _chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def _png(w: int, h: int) -> bytes:
    raw = b"".join(b"\x00" + b"\x80" * w for _ in range(h))
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + _chunk(b"IDAT", zlib.compress(raw)) + _chunk(b"IEND", b"")


def png_header(w: int, h: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + _chunk(b"IDAT", zlib.compress(b"\x00")) + _chunk(b"IEND", b"")


def photo(w: int = 640, h: int = 480, orientation: int | None = None, owner: str | None = None, fmt: str = "JPEG") -> bytes:
    if fmt == "PNG":
        return _png(w, h)
    return _jpeg(w, h, _exif(orientation, owner) if orientation or owner else b"")


def image_size(data: bytes) -> tuple[int, int]:
    if data.startswith(b"\x89PNG"):
        return struct.unpack(">II", data[16:24])
    i = 2
    while i < len(data):
        marker = data[i + 1]
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + length
    raise AssertionError("no image header")


def clean(data: bytes, owner: str) -> None:
    assert owner.encode() not in data, "owner or serial survived"
    assert b"Exif\x00\x00" not in data and b"eXIf" not in data, "EXIF survived"
    assert b"http://ns.adobe.com/xap" not in data, "XMP survived"


EXE = b"MZ\x90\x00" + b"\x00" * 56 + struct.pack("<I", 64) + b"PE\x00\x00" + b"\x4c\x01" + b"\x00" * 200
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


BAR_JS = """el => {
  const out = [parseFloat(getComputedStyle(el).borderLeftWidth) || 0];
  for (const p of ['::before', '::after']) {
    const s = getComputedStyle(el, p);
    if (s.content !== 'none' && s.content !== 'normal') out.push(parseFloat(s.width) || 0);
  }
  const shadow = getComputedStyle(el).boxShadow;
  if (shadow.includes('inset')) { const m = /(-?\\d+(?:\\.\\d+)?)px/.exec(shadow); if (m) out.push(Math.abs(parseFloat(m[1]))); }
  const box = el.getBoundingClientRect();
  for (const c of el.querySelectorAll('*')) {
    const r = c.getBoundingClientRect(); const bg = getComputedStyle(c).backgroundColor;
    if (r.width >= 1 && r.width <= 16 && Math.abs(r.left - box.left) <= 2 && r.height >= box.height / 2 && bg !== 'rgba(0, 0, 0, 0)') out.push(r.width);
  }
  return Math.max(...out);
}"""

WEIGHT_JS = """(el, name) => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let best = 0;
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.includes(name)) best = Math.max(best, parseInt(getComputedStyle(walker.currentNode.parentElement).fontWeight));
  }
  return best;
}"""

TAGS_JS = "el => [...el.querySelectorAll('*')].map(e => e.tagName)"

SCROLLS_JS = """el => {
  const out = [window.scrollX, window.scrollY];
  for (let e = el; e; e = e.parentElement) out.push(e.scrollTop, e.scrollLeft);
  el.querySelectorAll('*').forEach(e => { if (e.scrollHeight > e.clientHeight) out.push(e.scrollTop); });
  return out;
}"""

SCRUB_ANIMS_JS = """targets => {
  window.__scrub = targets;
  window.__anims = [];
  const inside = t => t && window.__scrub.some(r => r === t || r.contains(t));
  const push = (t, d) => { const n = Number(d); if (inside(t) && !Number.isNaN(n)) window.__anims.push(n); };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (k, o) { const a = original.call(this, k, o); push(this, a.effect.getComputedTiming().duration); return a; };
  const grab = e => { for (const a of e.target.getAnimations()) push(e.target, a.effect.getComputedTiming().duration); };
  document.addEventListener('transitionrun', grab, true);
  document.addEventListener('animationstart', grab, true);
}"""

SNAPSHOT_JS = """els => JSON.stringify(els.map(el => [el, ...el.querySelectorAll('*')].map(e => {
  const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
  return [Math.round(r.left), Math.round(r.top), s.opacity, s.transform, (e.textContent || '').trim()];
})))"""

LISTEN_JS = """(el, name) => {
  window.__said = window.__said || {};
  const log = window.__said[name] = window.__said[name] || [];
  const take = () => { const t = el.textContent.trim(); if (t && log[log.length - 1] !== t) log.push(t); };
  take();
  new MutationObserver(take).observe(el, {subtree: true, childList: true, characterData: true});
}"""

AXE_RUN_JS = """options => {
  const result = {done: false, error: null, violations: []};
  Object.defineProperty(window, '__VERIFIER_AXE_RESULT__', {value: () => structuredClone(result), configurable: true});
  axe.run(document, options).then(value => {
    result.violations = value.violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target)}));
    result.done = true;
  }, error => { result.error = String(error); result.done = true; });
}"""

HIT_JS = """el => {
  const sizes = [];
  const box = e => { const r = e.getBoundingClientRect(); sizes.push([r.width, r.height]); };
  box(el);
  for (const p of ['::before', '::after']) {
    const s = getComputedStyle(el, p);
    if (s.content !== 'none' && s.content !== 'normal') sizes.push([parseFloat(s.width) || 0, parseFloat(s.height) || 0]);
  }
  let up = el.parentElement, levels = 2;
  while (up && levels-- > 0 && up !== document.body && up.children.length === 1) { box(up); up = up.parentElement; }
  return [Math.max(...sizes.map(s => s[0])), Math.max(...sizes.map(s => s[1]))];
}"""

CONTRAST_RULE = "color-contrast"
AXE_CONTRAST = {"runOnly": {"type": "rule", "values": [CONTRAST_RULE]}}


def axe_result(page: Page) -> dict:
    status = page.evaluate("window.__VERIFIER_AXE_RESULT__()")
    assert status["done"], "axe audit did not settle under controlled time"
    assert status["error"] is None, status["error"]
    return status


def axe_contrast(page: Page) -> None:
    page.add_script_tag(path=str(kit.AXE))
    page.evaluate(AXE_RUN_JS, AXE_CONTRAST)
    status = soon(lambda: axe_result(page), page)
    assert not status["violations"], f"contrast violations: {status['violations']}"


@contextmanager
def shell(browser: Browser, base: str, client: httpx.Client, path: str, size: tuple[int, int] = VIEWPORTS["desktop"], reduced: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, base + "/api/health", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        page.context.add_cookies([{"name": k, "value": v, "url": base} for k, v in client.cookies.items()])
        page.goto(base + path)
        yield page


def see(loc: Locator) -> None:
    expect(loc).to_be_visible(timeout=POLL_MS)


def gone(loc: Locator) -> None:
    expect(loc).to_be_hidden(timeout=POLL_MS)


def notices(page: Page) -> Locator:
    return page.get_by_role("status", name="Notices")


def details(page: Page) -> Locator:
    return page.get_by_role("complementary", name="Details")


def members_of(channel: str) -> str:
    return f"Members of {channel}"


def remove_named(label: str) -> str:
    return f"Remove {label}"


def article(page: Page, text: str) -> Locator:
    return page.get_by_role("region", name="Messages").get_by_role("article").filter(has_text=text)


def compose(page: Page, text: str) -> None:
    fill(page.get_by_role("textbox", name="Message", exact=True), text)
    click(page.get_by_role("button", name="Send", exact=True))


def attach(page: Page, files: list[dict]) -> None:
    with page.expect_file_chooser() as chooser:
        click(page.get_by_role("button", name="Attach photos", exact=True).first)
    chooser.value.set_files(files)


def choose(page: Page, art: Locator, action: str) -> None:
    soon(lambda: see(art.get_by_role("button", name="Message actions")), page)
    click(art.get_by_role("button", name="Message actions"))
    item = page.get_by_role("menuitem", name=action, exact=True)
    soon(lambda: see(item), page)
    click(item)


def listen(page: Page, name: str) -> None:
    region = page.get_by_role("status", name=name)
    soon(lambda: expect(region).to_have_count(1, timeout=POLL_MS), page)
    region.evaluate(LISTEN_JS, name)


def said(page: Page, name: str) -> list[str]:
    return page.evaluate("name => (window.__said || {})[name] || []", name)


def heard(page: Page, name: str, text: str) -> None:
    log = said(page, name)
    assert any(text in s for s in log), (text, log)


def storage_copy(page: Page, art: Locator) -> None:
    if art.get_by_text(ERR["storage_unavailable"]).count():
        return
    heard(page, "Upload progress", ERR["storage_unavailable"])


def assert_said_any(page: Page, options: list[str]) -> None:
    log = said(page, "Notices")
    assert any(o in s for o in options for s in log), log


def refusal_anywhere(page: Page, reason: str, region: str = "Upload progress") -> None:
    log = said(page, region)
    assert any(reason in s for s in log) or page.get_by_text(reason).count() > 0, (reason, log)


def shown(loc: Locator) -> None:
    assert any(loc.nth(i).is_visible() for i in range(loc.count())), "no visible match"


def handle_value(slider: Locator) -> float:
    return float(slider.get_attribute("aria-valuenow") or "nan")


def value_near(slider: Locator, target: float, slack: float = EDGE_SLACK) -> None:
    assert handle_value(slider) == pytest.approx(target, abs=slack), slider.get_attribute("aria-valuenow")


def hit_area(loc: Locator) -> tuple[float, float]:
    width, height = loc.evaluate(HIT_JS)
    return width, height


def on_screen(page: Page, loc: Locator) -> bool:
    if loc.count() == 0 or not loc.first.is_visible():
        return False
    box = loc.first.bounding_box()
    width = page.viewport_size["width"]
    return box is not None and box["x"] < width - 1 and box["x"] + box["width"] > 1


def no_h_scroll(page: Page) -> None:
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"


def placed(page: Page, loc: Locator, shown: bool) -> None:
    if loc.count():
        settle(loc.first)
    assert on_screen(page, loc) == shown


def test_signin_workspace(app_url: str, mail: Any) -> None:
    c = api(app_url)
    r = c.post("/api/session", json={"email": SEED["rui"], "password": PASSWORD})
    assert r.status_code == 200, r.text
    user, ws = r.json()["user"], r.json()["workspace"]
    assert (user["email"], user["handle"], user["role"], user["status"]) == (SEED["rui"], "rui", "field_technician", "active")
    assert ws["name"] == KESTREL and ws["time_zone"] == CHICAGO_NAME
    cookie = r.headers.get("set-cookie", "").lower()
    assert all(flag.lower() in cookie for flag in COOKIE_FLAGS)
    assert me(c)["id"] == user["id"]
    names = {ch["name"] for ch in c.get("/api/channels").json()["channels"]}
    assert names == {"shift-bulletins", "crew-main", "install-team", "weekend-emergency", "site-store-114"}
    lee = signin(app_url, SEED["lee"])
    hal = channel_id(lee, "halvard-crew")
    assert_error(c.get(f"/api/channels/{hal}"), 404, "not_found")
    assert_error(c.get(f"/api/channels/{hal}/messages"), 404, "not_found")
    hal_msg = search(lee, "door heater swap")["results"][0]["message_id"]
    assert_error(c.get(f"/api/messages/{hal_msg}"), 404, "not_found")
    assert search(c, "door heater swap")["total"] == 0
    assert_error(api(app_url).post("/api/session", json={"email": SEED["rui"], "password": WRONG_PASSWORD}), 401, "invalid_credentials")
    stranger = "nobody@kestrel.example"
    assert_error(api(app_url).post("/api/session", json={"email": stranger, "password": PASSWORD}), 401, "invalid_credentials")
    assert_error(api(app_url).post("/api/session", json={"password": PASSWORD}), 422, "validation", "email", COPY["email"])
    assert_error(api(app_url).post("/api/session", json={"email": SEED["rui"]}), 422, "validation", "password", COPY["password_signin"])
    tag = uuid.uuid4().hex[:8]
    invited = f"pending-{tag}@kestrel.example"
    assert signin(app_url, SEED["jo"]).post("/api/workspace/members", json={"name": f"Pending {tag}", "email": invited, "role": "crew_lead"}).status_code == 201
    assert_error(api(app_url).post("/api/session", json={"email": invited, "password": PASSWORD}), 401, "invalid_credentials")
    assert c.delete("/api/session").status_code == 204
    assert_error(c.get("/api/me"), 401, "unauthenticated")


def test_workspace_people_picker(app_url: str, mail: Any, browser: Browser) -> None:
    jo = signin(app_url, SEED["jo"])
    lee = signin(app_url, SEED["lee"])
    p = fresh(app_url, mail, "field_technician")
    people = jo.get("/api/workspace/members").json()["members"]
    emails = {u["email"] for u in people}
    assert p.email in emails and SEED["dana"] in emails
    assert SEED["lee"] not in emails and SEED["ari"] not in emails
    halvard = lee.get("/api/workspace/members").json()["members"]
    assert p.id not in {u["id"] for u in halvard} and me(jo)["id"] not in {u["id"] for u in halvard}
    ari_id = next(u["id"] for u in halvard if u["handle"] == "ari")
    assert jo.get("/api/workspace/members", params={"q": "Ari"}).json()["members"] == []
    assert p.id in {u["id"] for u in jo.get("/api/workspace/members", params={"q": p.name[:10]}).json()["members"]}
    install = channel_id(jo, "install-team")
    assert_error(add_member(jo, install, ari_id), 404, "not_found")
    assert ari_id not in {m["user"]["id"] for m in jo.get(f"/api/channels/{install}").json()["members"]}
    with shell(browser, app_url, jo, f"/c/{install}") as page:
        soon(lambda: see(page.get_by_role("button", name="Members")), page)
        click(page.get_by_role("button", name="Members"))
        dialog = page.get_by_role("dialog", name=members_of("install-team"))
        box = dialog.get_by_role("combobox", name="Add a person")
        soon(lambda: see(box), page)
        click(box)
        soon(lambda: expect(page.get_by_role("option", name=f"{p.name} ({p.email})")).to_have_count(1, timeout=POLL_MS), page)
        expect(page.get_by_role("option", name=f"Ari Novak ({SEED['ari']})")).to_have_count(0)
        expect(page.get_by_role("option", name=f"Lee Moreau ({SEED['lee']})")).to_have_count(0)
        expect(page.get_by_role("option", name=f"Dana Okafor ({SEED['dana']})")).to_have_count(0)
        page.keyboard.press("Escape")
        page.keyboard.press("Escape")
        soon(lambda: gone(dialog), page)
        click(page.get_by_role("button", name="Workspace people"))
        people_dialog = page.get_by_role("dialog", name="Workspace people")
        soon(lambda: see(people_dialog.get_by_text(p.name).first), page)
        expect(people_dialog.get_by_text("Lee Moreau")).to_have_count(0)
        expect(people_dialog.get_by_text("Ari Novak")).to_have_count(0)


def test_invite_email(app_url: str, mail: Any) -> None:
    jo = signin(app_url, SEED["jo"])
    tag = uuid.uuid4().hex[:8]
    name = f"Zoë Núñez {tag}"
    email = f"zoe-{tag}@kestrel.example"
    r = jo.post("/api/workspace/members", json={"name": f"  {name}  ", "email": email, "role": "field_technician"})
    assert r.status_code == 201, r.text
    member = r.json()["member"]
    assert (member["name"], member["email"], member["role"], member["status"]) == (name, email, "field_technician", "invited")
    assert r.json()["invite_email"] == "sent"
    found = mail_to(mail, email)
    assert len(found) == 1
    assert len(mail_to(mail, email, count=2, seconds=MAIL_SETTLE_S)) == 1
    m = found[0]
    assert [t["Name"] for t in m["To"]] == [name]
    assert kit.addresses(m["To"]) == [email]
    assert m["Subject"] == f"Join {KESTREL} on Rimewire"
    assert kit.addresses(m["From"]) == [kit.mail_from_address()]
    assert not m.get("Cc") and not m.get("Bcc")
    body = kit.text(m)
    assert name in body and "Jo Adeyemi" in body and re.search(r"/join/\S+", body)

    spy = f"spy-{tag}@kestrel.example"
    refused = [
        ("   ", COPY["name_empty"]),
        (f"Evil {tag}\r\nBcc: {spy}", COPY["name_control"]),
        (f"Evil {tag}\nSubject: Free", COPY["name_control"]),
        (f"Bell\x07{tag}", COPY["name_control"]),
        ("n" * (NAME_MAX + 1), COPY["name_long"]),
    ]
    bad_emails = []
    for i, (bad, copy) in enumerate(refused):
        addr = f"refused-{i}-{tag}@kestrel.example"
        bad_emails.append(addr)
        assert_error(jo.post("/api/workspace/members", json={"name": bad, "email": addr, "role": "crew_lead"}), 422, "validation", "name", copy)
        assert jo.get("/api/workspace/members", params={"q": addr}).json()["members"] == []
    exact = f"Exact {tag} ".ljust(NAME_MAX, "x")
    ok = jo.post("/api/workspace/members", json={"name": exact, "email": f"exact-{tag}@kestrel.example", "role": "crew_lead"})
    assert ok.status_code == 201 and ok.json()["member"]["name"] == exact
    assert_error(jo.post("/api/workspace/members", json={"name": "Bad Email", "email": "not-an-email", "role": "crew_lead"}), 422, "validation", "email", COPY["email"])
    assert_error(jo.post("/api/workspace/members", json={"name": "Bad Role", "email": f"role-{tag}@kestrel.example", "role": "chef"}), 422, "validation", "role", COPY["role"])
    assert_error(signin(app_url, SEED["dana"]).post("/api/workspace/members", json={"name": "No", "email": f"dana-inv-{tag}@kestrel.example", "role": "crew_lead"}), 403, "forbidden")
    assert_error(jo.post("/api/workspace/members", json={"name": "Dup", "email": SEED["dana"], "role": "crew_lead"}), 409, "email_taken")
    assert mail_to(mail, f"exact-{tag}@kestrel.example")
    for addr in bad_emails + [spy, f"role-{tag}@kestrel.example", f"dana-inv-{tag}@kestrel.example"]:
        assert mail_to(mail, addr, seconds=0) == [], addr


def test_invite_mail_outage(app_url: str, mail: Any) -> None:
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    poll(lambda: health(down)["services"]["mail"] == "down", HEALTH_S + EVENT_SLACK_S, "mail down on the outage instance")
    jo = signin(down, SEED["jo"])
    tag = uuid.uuid4().hex[:8]
    email = f"queued-{tag}@kestrel.example"
    r = jo.post("/api/workspace/members", json={"name": f"Queued {tag}", "email": email, "role": "field_technician"})
    assert r.status_code == 201, r.text
    assert r.json()["invite_email"] == "queued" and r.json()["member"]["status"] == "invited"
    saved = signin(app_url, SEED["jo"]).get("/api/workspace/members", params={"q": email}).json()["members"]
    assert [m["email"] for m in saved] == [email]
    assert jo.get("/api/channels").status_code == 200

    relay = mail_relay()
    try:
        with serve_copy(SMTP_HOST="127.0.0.1", SMTP_PORT=relay.port) as copy:
            poll(lambda: health(copy)["services"]["mail"] == "down", HEALTH_S + EVENT_SLACK_S, "copy reports mail down")
            later = f"later-{tag}@kestrel.example"
            r = signin(copy, SEED["jo"]).post("/api/workspace/members", json={"name": f"Later {tag}", "email": later, "role": "crew_lead"})
            assert r.status_code == 201 and r.json()["invite_email"] == "queued"
            relay.open()
            found = mail_to(mail, later, seconds=QUEUE_RETRY_S * 2 + MAIL_WAIT_S)
            assert len(found) == 1
            assert len(mail_to(mail, later, count=2, seconds=QUEUE_RETRY_S + MAIL_SETTLE_S)) == 1
            poll(lambda: health(copy)["services"]["mail"] == "up", HEALTH_S + EVENT_SLACK_S, "copy reports mail up")
    finally:
        relay.close()


def test_join_from_invite(app_url: str, mail: Any, browser: Browser) -> None:
    jo = signin(app_url, SEED["jo"])
    tag = uuid.uuid4().hex[:8]
    name = f"Join Test {tag}"
    email = f"join-{tag}@kestrel.example"
    assert jo.post("/api/workspace/members", json={"name": name, "email": email, "role": "crew_lead"}).status_code == 201
    token = invite_token(mail, email)
    pub = api(app_url)
    info = pub.get(f"/api/invites/{token}")
    assert info.status_code == 200
    assert (info.json()["workspace_name"], info.json()["name"], info.json()["email"]) == (KESTREL, name, email)
    assert_error(pub.post(f"/api/invites/{token}/accept", json={"password": "p" * (PASSWORD_MIN - 1)}), 422, "validation", "password", COPY["password_join"])
    assert_error(pub.post(f"/api/invites/{token}/accept", json={"password": "p" * (PASSWORD_MAX + 1)}), 422, "validation", "password", COPY["password_join"])
    password = "p" * PASSWORD_MIN
    r = pub.post(f"/api/invites/{token}/accept", json={"password": password})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["status"] == "active" and r.json()["workspace"]["name"] == KESTREL
    assert me(pub)["email"] == email
    assert pub.get("/api/channels").json()["channels"] == []
    assert_error(api(app_url).post(f"/api/invites/{token}/accept", json={"password": "q" * PASSWORD_MIN}), 404, "not_found")
    assert_error(api(app_url).get(f"/api/invites/{token}"), 404, "not_found")
    assert_error(api(app_url).get(f"/api/invites/{uuid.uuid4().hex}"), 404, "not_found")
    assert me(signin(app_url, email, password))["status"] == "active"
    with open_app(browser, f"{app_url}/join/{token}") as page:
        soon(lambda: see(page.get_by_text("This invite link is not valid. Ask your operations manager for a new one.")), page)


def test_deactivate_ends_access(app_url: str, mail: Any) -> None:
    p = fresh(app_url, mail, "field_technician", ["crew-main"])
    jo = signin(app_url, SEED["jo"])
    crew = channel_id(jo, "crew-main")
    second = p.on(app_url)
    stream = Stream(app_url, p.c)
    assert stream.status == 200
    assert_error(signin(app_url, SEED["dana"]).delete(f"/api/workspace/members/{p.id}"), 403, "forbidden")
    assert_error(jo.delete(f"/api/workspace/members/{me(jo)['id']}"), 409, "cannot_deactivate_self")
    assert me(p.c)["status"] == "active"
    r = jo.delete(f"/api/workspace/members/{p.id}")
    assert r.status_code == 200 and r.json()["member"]["status"] == "deactivated"
    assert_error(p.c.get("/api/me"), 401, "unauthenticated")
    assert_error(send(second, crew, "still here"), 401, "unauthenticated")
    stream.wait(lambda e: e["event"] == "session.ended", EVENT_DELAY_S + EVENT_SLACK_S, "session.ended")
    assert stream.done.wait(EVENT_DELAY_S + EVENT_SLACK_S), "stream stayed open"
    again = Stream(app_url, p.c)
    assert again.status == 401 and json.loads(again.body)["error"] == "unauthenticated"
    assert_error(api(app_url).post("/api/session", json={"email": p.email, "password": p.password}), 401, "invalid_credentials")
    assert p.id not in {m["user"]["id"] for m in jo.get(f"/api/channels/{crew}").json()["members"]}


def test_wf_crew_onboarding_happy(app_url: str, mail: Any, browser: Browser) -> None:
    jo = signin(app_url, SEED["jo"])
    crew = channel_id(jo, "crew-main")
    tag = uuid.uuid4().hex[:8]
    name = f"Zoë Núñez {tag}"
    email = f"zoe-wf-{tag}@kestrel.example"
    password = f"frost-line-{tag}"
    with shell(browser, app_url, jo, f"/c/{crew}") as page:
        soon(lambda: see(page.get_by_role("button", name="Invite technician")), page)
        click(page.get_by_role("button", name="Invite technician"))
        dialog = page.get_by_role("dialog", name="Invite technician")
        fill(dialog.get_by_role("textbox", name="Name"), name)
        fill(dialog.get_by_role("textbox", name="Email"), email)
        select(dialog.get_by_role("combobox", name="Role"), "Field technician")
        click(dialog.get_by_role("button", name="Send invite"))
        soon(lambda: expect(notices(page)).to_contain_text(f"Invite emailed to {email}.", timeout=POLL_MS), page)
        found = mail_to(mail, email)
        assert len(found) == 1 and [t["Name"] for t in found[0]["To"]] == [name]
        token = invite_token(mail, email)
        with open_app(browser, f"{app_url}/join/{token}") as joiner:
            soon(lambda: see(joiner.get_by_text(name).first), joiner)
            see(joiner.get_by_text(email).first)
            fill(joiner.get_by_label("New password"), password)
            click(joiner.get_by_role("button", name="Set password and join"))
            soon(lambda: expect(notices(joiner)).to_contain_text(f"Password set. Welcome to {KESTREL}.", timeout=POLL_MS), joiner)
            soon(lambda: see(joiner.get_by_role("navigation", name="Channels")), joiner)
            zoe = signin(app_url, email, password)
            zoe_id = me(zoe)["id"]
            click(page.get_by_role("button", name="Members"))
            members = page.get_by_role("dialog", name=members_of("crew-main"))
            select(members.get_by_role("combobox", name="Add a person"), f"{name} ({email})")
            click(members.get_by_role("button", name="Add to channel"))
            soon(lambda: expect(notices(page)).to_contain_text(f"{name} added to #crew-main.", timeout=POLL_MS), page)
            link = joiner.get_by_role("navigation", name="Channels").get_by_role("link", name=re.compile(r"^crew-main"))
            soon(lambda: see(link), joiner)
            click(link)
            compose(joiner, f"Zoë on site {tag}")
            own = article(joiner, tag)
            chip = own.get_by_text("Sent", exact=True).or_(own.get_by_text("Delivered", exact=True)).or_(own.get_by_text(re.compile(r"Read\s*·\s*\d+")))
            soon(lambda: see(chip.first), joiner)
    assert zoe_id in {m["user"]["id"] for m in jo.get(f"/api/channels/{crew}").json()["members"]}
    rows = search(jo, f"Zoë on site {tag}")
    assert rows["total"] == 1 and rows["results"][0]["author_name"] == name
    assert zoe.get(f"/api/channels/{crew}/messages").status_code == 200


def test_wf_crew_onboarding_mail_outage(app_url: str, browser: Browser) -> None:
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    jo = signin(down, SEED["jo"])
    crew = channel_id(jo, "crew-main")
    tag = uuid.uuid4().hex[:8]
    email = f"queued-ui-{tag}@kestrel.example"
    with shell(browser, down, jo, f"/c/{crew}") as page:
        soon(lambda: see(page.get_by_role("button", name="Invite technician")), page)
        click(page.get_by_role("button", name="Invite technician"))
        dialog = page.get_by_role("dialog", name="Invite technician")
        fill(dialog.get_by_role("textbox", name="Name"), f"Queued UI {tag}")
        fill(dialog.get_by_role("textbox", name="Email"), email)
        select(dialog.get_by_role("combobox", name="Role"), "Crew lead")
        click(dialog.get_by_role("button", name="Send invite"))
        soon(lambda: expect(notices(page)).to_contain_text(f"Invite saved. The email to {email} is queued until mail is reachable.", timeout=POLL_MS), page)
    saved = signin(app_url, SEED["jo"]).get("/api/workspace/members", params={"q": email}).json()["members"]
    assert [(m["email"], m["status"], m["role"]) for m in saved] == [(email, "invited", "crew_lead")]


def test_wf_crew_onboarding_bad_name(app_url: str, mail: Any, browser: Browser) -> None:
    jo = signin(app_url, SEED["jo"])
    crew = channel_id(jo, "crew-main")
    tag = uuid.uuid4().hex[:8]
    email = f"fixed-{tag}@kestrel.example"
    name = f"Zoë Núñez {tag}"
    with shell(browser, app_url, jo, f"/c/{crew}") as page:
        soon(lambda: see(page.get_by_role("button", name="Invite technician")), page)
        click(page.get_by_role("button", name="Invite technician"))
        dialog = page.get_by_role("dialog", name="Invite technician")
        fill(dialog.get_by_role("textbox", name="Name"), f"Bell\x07{tag}")
        fill(dialog.get_by_role("textbox", name="Email"), email)
        select(dialog.get_by_role("combobox", name="Role"), "Field technician")
        click(dialog.get_by_role("button", name="Send invite"))
        soon(lambda: see(dialog.get_by_role("heading", name="Check the highlighted fields.")), page)
        see(dialog.get_by_role("link", name=COPY["name_control"]))
        assert jo.get("/api/workspace/members", params={"q": email}).json()["members"] == []
        fill(dialog.get_by_role("textbox", name="Name"), name)
        click(dialog.get_by_role("button", name="Send invite"))
        soon(lambda: expect(notices(page)).to_contain_text(f"Invite emailed to {email}.", timeout=POLL_MS), page)
    found = mail_to(mail, email)
    assert len(found) == 1 and [t["Name"] for t in found[0]["To"]] == [name]
    assert len(mail_to(mail, email, count=2, seconds=MAIL_SETTLE_S)) == 1


def test_post_message_and_delivery_records(app_url: str, mail: Any) -> None:
    author = fresh(app_url, mail, "dispatcher", ["install-team", "site-store-114"])
    fresh(app_url, mail, "field_technician", ["install-team"])
    cid = channel_id(author.c, "install-team")
    other = channel_id(author.c, "site-store-114")
    members = author.c.get(f"/api/channels/{cid}").json()["members"]
    tag = uuid.uuid4().hex[:8]
    cmid = str(uuid.uuid4())
    r = send(author.c, cid, f"   Compressor amps 14.2 {tag}   ", cmid)
    assert r.status_code == 201 and r.headers.get("Rimewire-Replay") is None
    m = r.json()["message"]
    assert m["text"] == f"Compressor amps 14.2 {tag}" and m["client_message_id"] == cmid
    assert m["version"] == 1 and m["edited"] is False and m["deleted"] is False
    assert m["author"]["id"] == author.id and m["channel_id"] == cid
    assert m["thread_root_id"] is None and m["quote"] is None and m["attachments"] == []
    assert m["recipient_count"] == len(members) - 1 and m["delivered_count"] == 0 and m["read_count"] == 0
    rec = author.c.get(f"/api/messages/{m['id']}/receipts").json()
    ids = [x["user"]["id"] for x in rec["recipients"]]
    assert sorted(ids) == sorted({x["user"]["id"] for x in members} - {author.id})
    assert all(x["delivered_at"] is None and x["reads"] == [] for x in rec["recipients"])
    assert history_entry(author.c, cid, m["id"]) is not None

    bad = str(uuid.uuid4())
    assert_error(author.c.post(f"/api/channels/{cid}/messages", json={"text": "no id"}), 422, "validation", "client_message_id", COPY["client_message_id"])
    assert_error(send(author.c, cid, "x", "not-a-uuid"), 422, "validation", "client_message_id", COPY["client_message_id"])
    assert_error(send(author.c, cid, "   ", bad), 422, "validation", "text", COPY["text_empty"])
    assert_error(send(author.c, cid, "a" * (TEXT_LIMIT + 1), bad), 422, "validation", "text", COPY["text_long"])
    foreign = post(author.c, other, f"Other channel {tag}")
    assert_error(send(author.c, cid, "reply", bad, thread_root_id=foreign["id"]), 422, "validation", "thread_root_id", COPY["thread_root_id"])
    assert_error(send(author.c, cid, "reply", bad, thread_root_id=str(uuid.uuid4())), 422, "validation", "thread_root_id", COPY["thread_root_id"])
    assert_error(send(author.c, cid, "quote", bad, quoted_message_id=foreign["id"]), 422, "validation", "quoted_message_id", COPY["quoted_message_id"])
    r = send(author.c, cid, "a" * TEXT_LIMIT, bad)
    assert r.status_code == 201 and r.headers.get("Rimewire-Replay") is None
    sam = signin(app_url, SEED["sam"])
    assert_error(send(sam, cid, "not a member"), 404, "not_found")


def test_retried_sends_replay_and_conflict(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    tag = uuid.uuid4().hex[:8]
    cmid = str(uuid.uuid4())
    first = send(t.c, cid, f"Suction 62 psig {tag}", cmid)
    assert first.status_code == 201
    stored = first.json()["message"]
    again = send(t.c, cid, f"Suction 62 psig {tag}", cmid)
    assert again.status_code == 201 and again.headers.get("Rimewire-Replay") == "true"
    assert again.json()["message"]["id"] == stored["id"] and again.json()["message"]["sent_at"] == stored["sent_at"]
    assert_error(send(t.c, cid, f"Suction 64 psig {tag}", cmid), 409, "client_message_id_conflict")
    assert_error(send(t.c, cid, f"Suction 62 psig {tag}", cmid, thread_root_id=stored["id"]), 409, "client_message_id_conflict")
    assert search(t.c, tag)["total"] == 1
    rec = t.c.get(f"/api/messages/{stored['id']}/receipts").json()
    assert len(rec["recipients"]) == len({x["user"]["id"] for x in rec["recipients"]}) == stored["recipient_count"]

    burst_id = str(uuid.uuid4())
    words = [f"Burst {tag}x"] * 4 + [f"Burst {tag}y"] * 4
    results = together([lambda w=w: send(clone(t.c), cid, w, burst_id) for w in words])
    statuses = [r.status_code for r in results]
    assert 500 not in statuses, statuses
    wins = [r for r in results if r.status_code == 201 and r.headers.get("Rimewire-Replay") != "true"]
    assert len(wins) == 1, statuses
    kept = wins[0].json()["message"]["text"]
    for w, r in zip(words, results):
        if r is wins[0]:
            continue
        if w == kept:
            assert r.status_code == 201 and r.headers.get("Rimewire-Replay") == "true"
        else:
            assert_error(r, 409, "client_message_id_conflict")
    assert search(t.c, f"Burst {tag}")["total"] == 1

    failed = str(uuid.uuid4())
    assert send(t.c, cid, "", failed).status_code == 422
    r = send(t.c, cid, f"After failure {tag}", failed)
    assert r.status_code == 201 and r.headers.get("Rimewire-Replay") != "true"
    assert t.c.delete(f"/api/messages/{r.json()['message']['id']}").status_code == 204
    assert_error(send(t.c, cid, f"After failure {tag}", failed), 410, "message_deleted")


def test_broadcast_posting_rule(app_url: str, mail: Any, browser: Browser) -> None:
    tech = fresh(app_url, mail, "field_technician", ["shift-bulletins"])
    lead = fresh(app_url, mail, "crew_lead", ["shift-bulletins"])
    cid = channel_id(tech.c, "shift-bulletins")
    tag = uuid.uuid4().hex[:8]
    assert_error(send(tech.c, cid, f"Top-level from tech {tag}"), 403, "broadcast_only")
    assert search(lead.c, f"Top-level from tech {tag}")["total"] == 0
    root = post(lead.c, cid, f"Bulletin {tag}")
    reply = post(tech.c, cid, f"Ack in thread {tag}", thread_root_id=root["id"])
    assert reply["thread_root_id"] == root["id"]
    with shell(browser, app_url, tech.c, f"/c/{cid}") as page:
        soon(lambda: see(page.get_by_text("Replies only — open a thread to respond.")), page)
        expect(page.get_by_role("textbox", name="Message", exact=True)).to_have_count(0)
    with shell(browser, app_url, lead.c, f"/c/{cid}") as page:
        soon(lambda: see(page.get_by_role("textbox", name="Message", exact=True)), page)


def test_delivery_chips(app_url: str, mail: Any, browser: Browser) -> None:
    sender = fresh(app_url, mail, "field_technician", ["install-team"])
    reader = fresh(app_url, mail, "field_technician", ["install-team"])
    cid = channel_id(sender.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    with shell(browser, app_url, sender.c, f"/c/{cid}") as page:
        soon(lambda: see(page.get_by_role("region", name="Messages")), page)
        art = article(page, tag)
        with held(page, "**/api/channels/*/messages") as gate:
            compose(page, f"Suction 62 psig {tag}")
            soon(lambda: see(art.get_by_text("Pending", exact=True)), page)
            expect(art.get_by_text("Sent", exact=True)).to_have_count(0)
            gate.release()
        soon(lambda: see(art.get_by_text("Sent", exact=True)), page)
        expect(art.get_by_text("Delivered", exact=True)).to_have_count(0)
        with shell(browser, app_url, reader.c, f"/c/{cid}") as rpage:
            soon(lambda: see(article(rpage, tag)), rpage)
            soon(lambda: see(art.get_by_text("Delivered", exact=True).or_(art.get_by_text(re.compile(r"Read\s*·\s*1")))), page, rpage)
            advance(rpage, READ_DWELL_MS)
            soon(lambda: see(art.get_by_text(re.compile(r"Read\s*·\s*1"))), page, rpage)
        mid = search(sender.c, tag)["results"][0]["message_id"]
        stored = sender.c.get(f"/api/messages/{mid}").json()["message"]
        assert stored["delivered_count"] == 1 and stored["read_count"] == 1

        page.route("**/api/channels/*/messages", lambda route: route.fulfill(status=503, body="down"))
        compose(page, f"Discharge 240 psig {tag}b")
        broken = article(page, f"{tag}b")
        soon(lambda: see(broken.get_by_text("Failed", exact=True)), page)
        see(broken.get_by_role("button", name="Retry send"))
        see(broken.get_by_role("button", name="Discard"))
        expect(broken.get_by_text("Sent", exact=True)).to_have_count(0)
        page.unroute("**/api/channels/*/messages")
        click(broken.get_by_role("button", name="Retry send"))
        soon(lambda: see(broken.get_by_text("Sent", exact=True)), page)
        assert search(sender.c, f"{tag}b")["total"] == 1

        body = json.dumps({"error": "rate_limited", "message": ERR["rate_limited"]})
        page.route("**/api/channels/*/messages", lambda route: route.fulfill(status=429, body=body, headers={"Retry-After": "5", "Content-Type": "application/json; charset=utf-8"}))
        compose(page, f"Liquid line {tag}c")
        limited = article(page, f"{tag}c")
        soon(lambda: see(limited.get_by_text("Failed", exact=True)), page)
        see(limited.get_by_text(ERR["rate_limited"]))
        page.unroute("**/api/channels/*/messages")
        click(limited.get_by_role("button", name="Discard"))
        soon(lambda: gone(limited), page)
        assert search(sender.c, f"{tag}c")["total"] == 0


def test_delivery_announcements(app_url: str, mail: Any, browser: Browser) -> None:
    sender = fresh(app_url, mail, "field_technician", ["install-team"])
    reader = fresh(app_url, mail, "field_technician", ["install-team"])
    cid = channel_id(sender.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    with shell(browser, app_url, sender.c, f"/c/{cid}") as page:
        messages = page.get_by_role("region", name="Messages")
        soon(lambda: see(messages), page)
        assert messages.get_attribute("aria-live") in (None, "off")
        listen(page, "Delivery updates")
        compose(page, f"Suction 62 psig {tag}")
        soon(lambda: heard(page, "Delivery updates", "Message sent."), page)
        with shell(browser, app_url, reader.c, f"/c/{cid}") as rpage:
            soon(lambda: see(article(rpage, tag)), rpage)
            advance(rpage, READ_DWELL_MS)
            soon(lambda: heard(page, "Delivery updates", "Message read by 1."), page, rpage)

        page.route("**/api/channels/*/messages", lambda route: route.fulfill(status=503, body="down"))
        compose(page, f"Discharge 240 psig {tag}b")
        soon(lambda: heard(page, "Delivery updates", "Message failed to send. Use Retry send."), page)
        page.unroute("**/api/channels/*/messages")
        click(article(page, f"{tag}b").get_by_role("button", name="Discard"))

        body = json.dumps({"error": "rate_limited", "message": ERR["rate_limited"]})
        page.route("**/api/channels/*/messages", lambda route: route.fulfill(status=429, body=body, headers={"Retry-After": "5", "Content-Type": "application/json; charset=utf-8"}))
        compose(page, f"Liquid line {tag}c")
        soon(lambda: heard(page, "Delivery updates", f"Message failed to send: {ERR['rate_limited']}"), page)
        page.unroute("**/api/channels/*/messages")
        click(article(page, f"{tag}c").get_by_role("button", name="Discard"))
    assert search(sender.c, f"Suction 62 psig {tag}")["total"] == 1


def test_rate_limit_rolling_minute(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["crew-main"])
    cid = channel_id(t.c, "crew-main")
    tag = uuid.uuid4().hex[:8]
    ids = [str(uuid.uuid4()) for _ in range(SEND_LIMIT + 5)]
    results = together([lambda n=n, i=i: send(clone(t.c), cid, f"Flood {tag} {n}", i) for n, i in enumerate(ids)])
    statuses = [r.status_code for r in results]
    assert statuses.count(201) == SEND_LIMIT and statuses.count(429) == 5, statuses
    for r in results:
        if r.status_code == 429:
            assert_error(r, 429, "rate_limited")
            assert 1 <= int(r.headers["Retry-After"]) <= SEND_WINDOW_S
    stored = [(i, r) for i, r in zip(ids, results) if r.status_code == 201]
    i0, r0 = stored[0]
    replay = send(t.c, cid, r0.json()["message"]["text"], i0)
    assert replay.status_code == 201 and replay.headers.get("Rimewire-Replay") == "true"
    assert_error(send(t.c, cid, f"One more {tag}"), 429, "rate_limited")
    assert search(t.c, f"Flood {tag}")["total"] == SEND_LIMIT
    assert t.c.delete(f"/api/messages/{r0.json()['message']['id']}").status_code == 204
    assert send(t.c, cid, f"Freed {tag}").status_code == 201
    assert_error(send(t.c, cid, f"Over again {tag}"), 429, "rate_limited")


def test_wf_basement_send_happy(app_url: str, mail: Any, browser: Browser) -> None:
    dana = fresh(app_url, mail, "dispatcher", ["install-team"])
    rui = fresh(app_url, mail, "field_technician", ["install-team"])
    cid = channel_id(rui.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    target = post(dana.c, cid, f"Target superheat 8°F {tag}t")
    captured: dict[str, Any] = {}

    def gate(route: Any) -> None:
        if "route" not in captured:
            captured["route"] = route
            captured["body"] = route.request.post_data
        else:
            route.continue_()

    with shell(browser, app_url, dana.c, f"/c/{cid}") as dpage, shell(browser, app_url, rui.c, f"/c/{cid}") as page:
        soon(lambda: see(article(page, f"{tag}t")), page)
        page.route("**/api/channels/*/messages", gate)
        compose(page, f"Reading 11°F {tag}r")
        mine = article(page, f"{tag}r")
        soon(lambda: see(mine.get_by_text("Pending", exact=True)), page)
        advance(page, SEND_TIMEOUT_MS)
        soon(lambda: see(mine.get_by_text("Failed", exact=True)), page)
        see(mine.get_by_role("button", name="Retry send"))
        page.route("**/api/events*", lambda route: route.abort())
        page.context.set_offline(True)
        advance(page, PAUSED_NOTICE_MS)
        soon(lambda: expect(notices(page)).to_contain_text("Live updates paused. Reconnecting.", timeout=POLL_MS), page)
        post(dana.c, cid, f"Dana reply {tag}d")
        assert edit(dana.c, target["id"], f"Target superheat 10°F {tag}t", 1).status_code == 200
        page.context.set_offline(False)
        late = clone(rui.c)
        body = json.loads(captured["body"])
        with ThreadPoolExecutor(max_workers=1) as pool:
            lands = pool.submit(lambda: late.post(f"/api/channels/{cid}/messages", json=body))
            click(mine.get_by_role("button", name="Retry send"))
            assert lands.result().status_code == 201
        captured["route"].abort()
        page.unroute("**/api/events*")
        soon(lambda: expect(notices(page)).to_contain_text("Live updates resumed.", timeout=POLL_MS), page)
        soon(lambda: see(mine.get_by_text(re.compile(r"Read\s*·\s*1"))), page, dpage)
        soon(lambda: expect(article(page, f"{tag}d")).to_have_count(1, timeout=POLL_MS), page)
        soon(lambda: see(article(page, f"{tag}t").get_by_text("Target superheat 10°F", exact=False)), page)
        expect(article(page, f"{tag}r")).to_have_count(1)
        expect(article(dpage, f"{tag}r")).to_have_count(1)
        page.reload()
        soon(lambda: expect(article(page, f"{tag}r")).to_have_count(1, timeout=POLL_MS), page)
        expect(article(page, f"{tag}d")).to_have_count(1)
        see(article(page, f"{tag}t").get_by_text("Target superheat 10°F", exact=False))
    assert search(dana.c, f"Reading 11°F {tag}r")["total"] == 1
    mid = search(dana.c, f"{tag}r")["results"][0]["message_id"]
    rec = dana.c.get(f"/api/messages/{mid}/receipts").json()
    assert len({x["user"]["id"] for x in rec["recipients"]}) == len(rec["recipients"])


def test_wf_basement_send_failed_discard(app_url: str, mail: Any, browser: Browser) -> None:
    rui = fresh(app_url, mail, "field_technician", ["install-team"])
    cid = channel_id(rui.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    body = json.dumps({"error": "rate_limited", "message": ERR["rate_limited"]})
    with shell(browser, app_url, rui.c, f"/c/{cid}") as page:
        soon(lambda: see(page.get_by_role("textbox", name="Message", exact=True)), page)
        page.route("**/api/channels/*/messages", lambda route: route.fulfill(status=429, body=body, headers={"Retry-After": "7", "Content-Type": "application/json; charset=utf-8"}))
        compose(page, f"Flooded {tag}a")
        art = article(page, f"{tag}a")
        soon(lambda: see(art.get_by_text("Failed", exact=True)), page)
        expect(art.get_by_text("Sent", exact=True)).to_have_count(0)
        click(art.get_by_role("button", name="Discard"))
        soon(lambda: gone(art), page)
        page.unroute("**/api/channels/*/messages")
        compose(page, f"Recovered {tag}b")
        soon(lambda: see(article(page, f"{tag}b").get_by_text("Sent", exact=True)), page)
    assert search(rui.c, f"{tag}a")["total"] == 0
    assert search(rui.c, f"{tag}b")["total"] == 1


def test_photo_storage_clean(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    ws = t.c.get("/api/me").json()["workspace"]["id"]
    s3 = kit.S3()
    owner = f"SN{uuid.uuid4().hex[:10]}"
    side = photo(800, 400, orientation=6, owner=owner)
    r = send_photos(t.c, cid, "Suction gauge", [("suction.jpg", side, "image/jpeg")])
    assert r.status_code == 201, r.text
    m = r.json()["message"]
    att = m["attachments"][0]
    assert (att["width"], att["height"]) == (400, 800) and att["content_type"] == "image/jpeg"
    base = f"attachments/{ws}/{m['id']}/{att['id']}/"
    assert sorted(s3.keys(base)) == [base + "original", base + "thumb.jpg"]
    original = s3.get(base + "original")
    thumb = s3.get(base + "thumb.jpg")
    clean(original, owner)
    clean(thumb, owner)
    assert image_size(original) == (400, 800) and att["bytes"] == len(original)
    tw, th = image_size(thumb)
    assert max(tw, th) <= THUMB_MAX and th > tw
    got = t.c.get(att["url"])
    assert got.status_code == 200 and got.content == original
    assert got.headers["cache-control"] == "private, no-store" and got.headers["x-content-type-options"] == "nosniff"
    small = t.c.get(att["thumb_url"])
    assert small.status_code == 200 and small.headers["content-type"].startswith("image/jpeg") and small.content == thumb

    failed = str(uuid.uuid4())
    good = photo(320, 240)
    before_fail = set(s3.keys(f"attachments/{ws}/"))
    assert send_photos(t.c, cid, "", [("a.jpg", good, "image/jpeg"), ("gauges.jpg", EXE, "image/jpeg")], failed).status_code == 422
    assert set(s3.keys(f"attachments/{ws}/")) == before_fail
    r = send_photos(t.c, cid, "", [("a.jpg", good, "image/jpeg")], failed)
    assert r.status_code == 201 and r.headers.get("Rimewire-Replay") != "true"

    before = set(s3.keys(f"attachments/{ws}/"))
    race = str(uuid.uuid4())
    shot = photo(640, 480, owner=owner)
    results = together([lambda: send_photos(clone(t.c), cid, "Race", [("race.jpg", shot, "image/jpeg")], race) for _ in range(4)])
    assert 500 not in [x.status_code for x in results]
    wins = [x for x in results if x.status_code == 201 and x.headers.get("Rimewire-Replay") != "true"]
    assert len(wins) == 1 and all(x.status_code == 201 for x in results)
    winner = wins[0].json()["message"]["id"]
    prefix = f"attachments/{ws}/{winner}/"
    poll(lambda: all(k.startswith(prefix) for k in set(s3.keys(f"attachments/{ws}/")) - before), QUEUE_CLEAR_S, "losing photo objects removed")
    assert len(s3.keys(prefix)) == 2
    assert search(t.c, "race.jpg")["total"] >= 1


def test_photo_acceptance_order(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    good = photo(320, 240)
    bomb = png_header(20_000, 20_000)
    big = good + b"\x00" * (PHOTO_BYTES_LIMIT + 1 - len(good))
    big_bomb = bomb + b"\x00" * (PHOTO_BYTES_LIMIT + 1 - len(bomb))
    cases = [
        ([("gauges.jpg", EXE, "image/jpeg")], wrong_type("gauges.jpg")),
        ([("chart.svg", SVG, "image/svg+xml")], wrong_type("chart.svg")),
        ([("broken.jpg", good[:60], "image/jpeg")], wrong_type("broken.jpg")),
        ([("big.jpg", big, "image/jpeg")], too_large("big.jpg")),
        ([("bigbomb.png", big_bomb, "image/png")], too_large("bigbomb.png")),
        ([("ok.jpg", good, "image/jpeg"), ("gauges.jpg", EXE, "image/jpeg"), ("huge.png", bomb, "image/png")], wrong_type("gauges.jpg")),
        ([("huge.png", bomb, "image/png"), ("gauges.jpg", EXE, "image/jpeg")], too_many_pixels("huge.png")),
        ([(f"p{i}.jpg", good, "image/jpeg") for i in range(PHOTO_COUNT_LIMIT)] + [("gauges.jpg", EXE, "image/jpeg")], COPY["files_count"]),
    ]
    for files, copy in cases:
        cmid = str(uuid.uuid4())
        started = time.monotonic()
        r = send_photos(t.c, cid, "Gauge set", files, cmid)
        body = assert_error(r, 422, "validation", "files", copy)
        assert list(body["errors"]) == ["files"]
        if copy == too_many_pixels("huge.png"):
            assert time.monotonic() - started < PIXEL_REFUSAL_S
        retry = send(t.c, cid, "retry as text", cmid)
        assert retry.status_code == 201 and retry.headers.get("Rimewire-Replay") != "true"
    raw = "../../etc/gauge reading #2.jpg"
    r = send_photos(t.c, cid, "", [(raw, good, "image/jpeg")])
    assert r.status_code == 201, r.text
    assert r.json()["message"]["attachments"][0]["filename"] == re.sub(r"[^A-Za-z0-9._-]", "_", raw.rsplit("/", 1)[-1])
    long_name = "n" * (FILENAME_MAX + 20) + ".jpg"
    r = send_photos(t.c, cid, "", [(long_name, good, "image/jpeg")])
    assert r.json()["message"]["attachments"][0]["filename"] == long_name[:FILENAME_MAX]
    png = photo(200, 100, fmt="PNG")
    r = send_photos(t.c, cid, "", [("plate.jpg", png, "image/jpeg")])
    assert r.status_code == 201, r.text
    stored_png = r.json()["message"]["attachments"][0]
    assert stored_png["content_type"] != "image/jpeg"
    fetched = t.c.get(stored_png["url"])
    assert fetched.content[:8] == png[:8] and fetched.headers["content-type"].startswith(stored_png["content_type"])


def test_photos_follow_membership(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    viewer = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    r = send_photos(t.c, cid, "Nameplate", [("plate.jpg", photo(), "image/jpeg")])
    att = r.json()["message"]["attachments"][0]
    sam = signin(app_url, SEED["sam"])
    lee = signin(app_url, SEED["lee"])
    for url in (att["url"], att["thumb_url"]):
        assert viewer.c.get(url).status_code == 200
        assert_error(sam.get(url), 404, "not_found")
        assert_error(lee.get(url), 404, "not_found")
    assert_error(lee.get(f"/api/channels/{cid}/gallery"), 404, "not_found")
    assert_error(t.c.get(f"/api/attachments/{uuid.uuid4()}"), 404, "not_found")
    jo = signin(app_url, SEED["jo"])
    assert jo.delete(f"/api/channels/{cid}/members/{viewer.id}").status_code == 204
    assert_error(viewer.c.get(att["url"]), 404, "not_found")
    assert_error(viewer.c.get(att["thumb_url"]), 404, "not_found")


def test_storage_outage_and_recovery(app_url: str, mail: Any) -> None:
    down = os.environ["APP_MINIO_DOWN_URL"]
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    existing = send_photos(t.c, cid, "Before outage", [("before.jpg", photo(), "image/jpeg")]).json()["message"]["attachments"][0]
    poll(lambda: health(down)["services"]["storage"] == "down", HEALTH_S + EVENT_SLACK_S, "storage down on the outage instance")
    dc = t.on(down)
    tag = uuid.uuid4().hex[:8]
    assert post(dc, cid, f"Text in outage {tag}")["text"] == f"Text in outage {tag}"
    cmid = str(uuid.uuid4())
    assert_error(send_photos(dc, cid, f"Photo in outage {tag}", [("g.jpg", photo(), "image/jpeg")], cmid), 503, "storage_unavailable")
    assert search(t.c, f"Photo in outage {tag}")["total"] == 0
    assert_error(dc.get(existing["url"]), 503, "storage_unavailable")
    assert_error(dc.get(existing["thumb_url"]), 503, "storage_unavailable")
    assert dc.get(f"/api/channels/{cid}/messages").status_code == 200

    relay = storage_relay()
    try:
        with serve_copy(S3_ENDPOINT=f"http://127.0.0.1:{relay.port}") as copy:
            poll(lambda: health(copy)["services"]["storage"] == "down", HEALTH_S + EVENT_SLACK_S, "copy reports storage down")
            cc = t.on(copy)
            again = str(uuid.uuid4())
            assert_error(send_photos(cc, cid, f"Boot outage {tag}", [("b.jpg", photo(), "image/jpeg")], again), 503, "storage_unavailable")
            assert search(cc, f"Boot outage {tag}")["total"] == 0
            relay.open()
            r = send_photos(cc, cid, f"Boot outage {tag}", [("b.jpg", photo(), "image/jpeg")], again)
            assert r.status_code == 201 and r.headers.get("Rimewire-Replay") != "true", r.text
            att = r.json()["message"]["attachments"][0]
            assert cc.get(att["url"]).status_code == 200
            poll(lambda: health(copy)["services"]["storage"] == "up", HEALTH_S + EVENT_SLACK_S, "copy reports storage up")
    finally:
        relay.close()


def test_upload_progress_announced(app_url: str, mail: Any, browser: Browser) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    tag = uuid.uuid4().hex[:8]
    with shell(browser, app_url, t.c, f"/c/{cid}") as page:
        listen(page, "Upload progress")
        attach(page, [
            {"name": "suction.jpg", "mimeType": "image/jpeg", "buffer": photo(1200, 900)},
            {"name": "discharge.jpg", "mimeType": "image/jpeg", "buffer": photo(900, 1200)},
            {"name": "gauges.jpg", "mimeType": "image/jpeg", "buffer": EXE},
        ])
        soon(lambda: heard(page, "Upload progress", wrong_type("gauges.jpg")), page)
        expect(page.get_by_role("list", name="Photos to send").get_by_role("listitem")).to_have_count(2)
        fill(page.get_by_role("textbox", name="Message", exact=True), f"Gauges {tag}")
        with held(page, "**/api/channels/*/messages") as gate:
            click(page.get_by_role("button", name="Send", exact=True))
            soon(lambda: see(page.get_by_role("progressbar", name="Upload progress")), page)
            gate.release()
        soon(lambda: see(article(page, f"Gauges {tag}").get_by_text("Sent", exact=True)), page)
        soon(lambda: heard(page, "Upload progress", "2 photos sent."), page)
        steps = [s for s in said(page, "Upload progress") if s.startswith("Uploading")]
        values = []
        for s in steps:
            match = re.fullmatch(r"Uploading 2 photos: (25|50|75|100)%\.", s)
            assert match, s
            values.append(int(match.group(1)))
        assert values and values == sorted(values) and values[-1] == 100, said(page, "Upload progress")
    m = search(t.c, f"Gauges {tag}")["results"][0]
    assert len(t.c.get(f"/api/messages/{m['message_id']}").json()["message"]["attachments"]) == 2


def test_wf_gauge_photos_happy(app_url: str, mail: Any, browser: Browser) -> None:
    rui = fresh(app_url, mail, "field_technician", ["site-store-114"])
    priya = fresh(app_url, mail, "crew_lead", ["site-store-114"])
    cid = channel_id(rui.c, "site-store-114")
    tag = uuid.uuid4().hex[:8]
    owner = f"SN{tag}"
    names = [f"suction-{tag}.jpg", f"discharge-{tag}.jpg"]
    with shell(browser, app_url, rui.c, f"/c/{cid}") as page:
        listen(page, "Upload progress")
        attach(page, [
            {"name": names[0], "mimeType": "image/jpeg", "buffer": photo(800, 400, orientation=6, owner=owner)},
            {"name": names[1], "mimeType": "image/jpeg", "buffer": photo(800, 400, orientation=6, owner=owner)},
            {"name": "gauges.jpg", "mimeType": "image/jpeg", "buffer": EXE},
        ])
        soon(lambda: shown(page.get_by_text(wrong_type("gauges.jpg"))), page)
        heard(page, "Upload progress", wrong_type("gauges.jpg"))
        tray = page.get_by_role("list", name="Photos to send")
        expect(tray.get_by_role("listitem")).to_have_count(2)
        expect(tray.get_by_role("button", name=remove_named("gauges.jpg"))).to_have_count(0)
        compose(page, f"Gauges {tag}")
        art = article(page, f"Gauges {tag}")
        for n in names:
            soon(lambda n=n: see(art.get_by_role("img", name=n)), page)
        attach(page, [{"name": f"huge-{tag}.png", "mimeType": "image/png", "buffer": png_header(20_000, 20_000)}])
        compose(page, f"Huge {tag}")
        failed = article(page, f"Huge {tag}")
        soon(lambda: see(failed.get_by_text("Failed", exact=True)), page)
        soon(lambda: refusal_anywhere(page, too_many_pixels(f"huge-{tag}.png")), page)
        click(failed.get_by_role("button", name="Discard"))
    with shell(browser, app_url, priya.c, f"/c/{cid}") as page:
        soon(lambda: see(page.get_by_role("button", name="Photos", exact=True)), page)
        click(page.get_by_role("button", name="Photos", exact=True))
        gallery = details(page).get_by_role("list", name="Photos", exact=True).get_by_role("listitem")
        soon(lambda: see(gallery.first), page)
        pattern = re.compile(rf"^Photo ({re.escape(names[0])}|{re.escape(names[1])}) by {re.escape(rui.name)}$")
        for i in range(2):
            expect(gallery.nth(i).get_by_role("link", name=pattern)).to_have_count(1)
    mid = search(priya.c, f"Gauges {tag}")["results"][0]["message_id"]
    ws = priya.c.get("/api/me").json()["workspace"]["id"]
    s3 = kit.S3()
    for att in priya.c.get(f"/api/messages/{mid}").json()["message"]["attachments"]:
        keys = s3.keys(f"attachments/{ws}/{mid}/{att['id']}/")
        assert len(keys) == 2
        for k in keys:
            clean(s3.get(k), owner)
        assert att["height"] > att["width"]
    assert search(priya.c, f"Huge {tag}")["total"] == 0


def test_wf_gauge_photos_storage_outage(app_url: str, mail: Any, browser: Browser) -> None:
    down = os.environ["APP_MINIO_DOWN_URL"]
    rui = fresh(app_url, mail, "field_technician", ["site-store-114"])
    dc = rui.on(down)
    cid = channel_id(dc, "site-store-114")
    tag = uuid.uuid4().hex[:8]
    with shell(browser, down, dc, f"/c/{cid}") as page:
        listen(page, "Upload progress")
        attach(page, [{"name": "suction.jpg", "mimeType": "image/jpeg", "buffer": photo()}])
        compose(page, f"Photo down {tag}")
        art = article(page, f"Photo down {tag}")
        soon(lambda: see(art.get_by_text("Failed", exact=True)), page)
        soon(lambda: storage_copy(page, art), page)
        click(art.get_by_role("button", name="Discard"))
        compose(page, f"Text still flows {tag}")
        soon(lambda: see(article(page, f"Text still flows {tag}").get_by_text("Sent", exact=True)), page)
    assert search(rui.c, f"Photo down {tag}")["total"] == 0
    assert search(rui.c, f"Text still flows {tag}")["total"] == 1


def test_cursor_paging_stable(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "crew_lead", ["install-team"])
    cid = channel_id(t.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    root = post(t.c, cid, f"Thread root {tag}")
    replies = [post(t.c, cid, f"Reply {tag} {i}", thread_root_id=root["id"]) for i in range(7)]
    expected = [r["id"] for r in reversed(replies)]
    seen: list[str] = []
    page = t.c.get(f"/api/messages/{root['id']}/thread", params={"limit": 3}).json()
    assert page["root"]["id"] == root["id"] and len(page["replies"]) == 3
    seen += [m["id"] for m in page["replies"]]
    post(t.c, cid, f"Late reply {tag}", thread_root_id=root["id"])
    doomed = expected[4]
    assert t.c.delete(f"/api/messages/{doomed}").status_code == 204
    while page["next_cursor"]:
        page = t.c.get(f"/api/messages/{root['id']}/thread", params={"limit": 3, "before": page["next_cursor"]}).json()
        seen += [m["id"] for m in page["replies"]]
    assert seen == [i for i in expected if i != doomed]

    found: list[str] = []
    cursor = None
    history = [post(t.c, cid, f"History {tag} {i}") for i in range(4)]
    wanted = {h["id"] for h in history}
    for _ in range(HISTORY_PAGES):
        params: dict[str, Any] = {"limit": 2}
        if cursor:
            params["before"] = cursor
        body = t.c.get(f"/api/channels/{cid}/messages", params=params).json()
        assert len(body["messages"]) <= 2
        found += [m["id"] for m in body["messages"]]
        if len(found) == 2:
            post(t.c, cid, f"Newer {tag}")
        cursor = body["next_cursor"]
        if not cursor or wanted <= set(found):
            break
    assert len(found) == len(set(found))
    assert [i for i in found if i in wanted] == [h["id"] for h in reversed(history)]
    assert not ({r["id"] for r in replies} & set(found))

    body = search(t.c, f"History {tag}", limit=3)
    pages = list(body["results"])
    assert body["total"] == 4 and len(pages) == 3
    body = search(t.c, f"History {tag}", limit=3, before=body["next_cursor"])
    pages += body["results"]
    assert body["next_cursor"] is None
    assert [r["message_id"] for r in pages] == [h["id"] for h in reversed(history)]

    for bad in ("0", "-1", "abc", "1.5"):
        assert_error(t.c.get(f"/api/channels/{cid}/messages", params={"limit": bad}), 422, "validation", "limit", COPY["limit"])
    assert_error(t.c.get(f"/api/channels/{cid}/messages", params={"before": "garbage"}), 422, "validation", "before", COPY["before"])
    big = t.c.get(f"/api/channels/{cid}/messages", params={"limit": PAGE_CAP * 10})
    assert big.status_code == 200 and len(big.json()["messages"]) <= PAGE_CAP


def test_event_stream_and_resume(app_url: str, mail: Any) -> None:
    a = fresh(app_url, mail, "crew_lead", ["install-team"])
    b = fresh(app_url, mail, "crew_lead", ["install-team"])
    cid = channel_id(a.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    live = Stream(app_url, a.c)
    lee = Stream(app_url, signin(app_url, SEED["lee"]))
    wait = EVENT_DELAY_S + EVENT_SLACK_S
    mb = post(b.c, cid, f"From B {tag}")
    live.wait(lambda e: e["event"] == "message.created" and about(e, mb["id"]), wait, "message.created")
    live.wait(lambda e: e["event"] == "channel.updated" and e["data"]["channel"]["id"] == cid and "unread_count" in e["data"]["channel"], wait, "channel.updated")
    ma = post(a.c, cid, f"From A {tag}")
    assert receipts(b.c, [ma["id"]], "read").status_code == 200
    live.wait(lambda e: e["event"] == "receipts.updated" and e["data"]["message_id"] == ma["id"] and e["data"]["read_count"] >= 1, wait, "receipts.updated")
    assert edit(b.c, mb["id"], f"From B edited {tag}", 1).status_code == 200
    live.wait(lambda e: e["event"] == "message.updated" and about(e, mb["id"]) and e["data"]["message"]["version"] == 2, wait, "message.updated")
    assert b.c.delete(f"/api/messages/{mb['id']}").status_code == 204
    live.wait(lambda e: e["event"] == "message.deleted" and e["data"]["message_id"] == mb["id"], wait, "message.deleted")
    ids = [e["id"] for e in live.events]
    assert all(i is not None for i in ids) and ids == sorted(ids) and len(set(ids)) == len(ids)
    assert not lee.matching(lambda e: about(e, mb["id"]) or about(e, ma["id"]))
    last = ids[-1]
    live.close()
    lee.close()

    mc = post(b.c, cid, f"Missed C {tag}")
    md = post(b.c, cid, f"Missed D {tag}")
    assert edit(b.c, mc["id"], f"Missed C edited {tag}", 1).status_code == 200
    resumed = Stream(app_url, a.c, last)
    upd = resumed.wait(lambda e: e["event"] == "message.updated" and about(e, mc["id"]), wait, "replayed edit")
    created_c = resumed.wait(lambda e: e["event"] == "message.created" and about(e, mc["id"]), wait, "replayed C")
    created_d = resumed.wait(lambda e: e["event"] == "message.created" and about(e, md["id"]), wait, "replayed D")
    assert created_c["id"] < created_d["id"] < upd["id"]
    late = post(b.c, cid, f"Live E {tag}")
    resumed.wait(lambda e: e["event"] == "message.created" and about(e, late["id"]), wait, "live after replay")
    got = [e["id"] for e in resumed.events]
    assert got == sorted(got) and len(set(got)) == len(got)
    assert len(resumed.matching(lambda e: e["event"] == "message.created" and about(e, mc["id"]))) == 1
    assert not resumed.matching(lambda e: e["event"] == "stream.reset")
    resumed.close()

    by_query = Stream(app_url, a.c, query_id=last)
    by_query.wait(lambda e: e["event"] == "message.created" and about(e, mc["id"]), wait, "query resume")
    by_query.close()
    header_wins = Stream(app_url, a.c, last, query_id="junk")
    header_wins.wait(lambda e: e["event"] == "message.created" and about(e, mc["id"]), wait, "header resume")
    assert not header_wins.matching(lambda e: e["event"] == "stream.reset")
    header_wins.close()
    for bad in ("not-a-number", str(last + 10**12)):
        reset = Stream(app_url, a.c, bad)
        reset.wait(lambda e: True, wait, "first event")
        assert reset.events[0]["event"] == "stream.reset"
        reset.close()


def test_receipts_recording(app_url: str, mail: Any) -> None:
    author = fresh(app_url, mail, "dispatcher", ["install-team"])
    r1 = fresh(app_url, mail, "field_technician", ["install-team"])
    r2 = fresh(app_url, mail, "field_technician", ["install-team"])
    cid = channel_id(author.c, "install-team")
    m = post(author.c, cid, f"Bulletin {uuid.uuid4().hex[:8]}")
    assert receipts(r1.c, [m["id"]], "delivered").json()["updated"] == 1
    assert receipts(r1.c, [m["id"]], "delivered").json()["updated"] == 0
    assert receipts(r1.c, [m["id"]], "read").json()["updated"] == 1
    assert receipts(r1.c, [m["id"]], "read").json()["updated"] == 0
    assert edit(author.c, m["id"], "Bulletin corrected", 1).status_code == 200
    assert receipts(r1.c, [m["id"]], "read").json()["updated"] == 1
    assert receipts(r2.c, [m["id"]], "read").json()["updated"] == 1
    assert receipts(author.c, [m["id"]], "read").json()["updated"] == 0
    rec = {x["user"]["id"]: x for x in author.c.get(f"/api/messages/{m['id']}/receipts").json()["recipients"]}
    assert author.id not in rec
    assert rec[r1.id]["delivered_at"] and sorted(x["version"] for x in rec[r1.id]["reads"]) == [1, 2]
    assert rec[r2.id]["delivered_at"] and [x["version"] for x in rec[r2.id]["reads"]] == [2]
    stored = author.c.get(f"/api/messages/{m['id']}").json()["message"]
    assert stored["delivered_count"] == 2 and stored["read_count"] == 2
    assert_error(receipts(r1.c, [m["id"]], "seen"), 422, "validation", "state", COPY["state"])
    assert_error(receipts(r1.c, [], "read"), 422, "validation", "message_ids", COPY["message_ids"])
    assert_error(receipts(r1.c, [m["id"]] * (RECEIPT_IDS_MAX + 1), "read"), 422, "validation", "message_ids", COPY["message_ids"])
    assert_error(receipts(r1.c, ["x"], "read"), 422, "validation")
    assert_error(receipts(r1.c, [str(uuid.uuid4())], "read"), 404, "not_found")
    dropped = post(author.c, cid, "to delete")
    assert author.c.delete(f"/api/messages/{dropped['id']}").status_code == 204
    assert_error(receipts(r1.c, [dropped["id"]], "read"), 404, "not_found")


def test_derived_counts_and_badges(app_url: str, mail: Any) -> None:
    a = fresh(app_url, mail, "dispatcher", ["install-team"])
    b = fresh(app_url, mail, "field_technician", ["install-team"])
    c3 = fresh(app_url, mail, "field_technician", ["install-team"])
    cid = channel_id(a.c, "install-team")
    u0 = unread(b.c, "install-team")
    m1 = post(a.c, cid, "Count one")
    m2 = post(a.c, cid, "Count two")
    r1 = post(a.c, cid, "Count reply", thread_root_id=m1["id"])
    assert unread(b.c, "install-team") == u0 + 3
    receipts(b.c, [m1["id"]], "read")
    assert unread(b.c, "install-team") == u0 + 2
    assert a.c.delete(f"/api/messages/{m2['id']}").status_code == 204
    assert unread(b.c, "install-team") == u0 + 1
    post(b.c, cid, "Own message")
    assert unread(b.c, "install-team") == u0 + 1
    receipts(b.c, [r1["id"]], "read")
    assert unread(b.c, "install-team") == u0
    receipts(c3.c, [m1["id"]], "read")
    before = a.c.get(f"/api/messages/{m1['id']}").json()["message"]
    assert before["read_count"] == 2 and before["delivered_count"] == 2
    jo = signin(app_url, SEED["jo"])
    assert jo.delete(f"/api/channels/{cid}/members/{c3.id}").status_code == 204
    after = a.c.get(f"/api/messages/{m1['id']}").json()["message"]
    assert after["recipient_count"] == before["recipient_count"] - 1
    assert after["read_count"] == 1 and after["delivered_count"] == 1
    assert add_member(jo, cid, c3.id).status_code == 201
    readded = a.c.get(f"/api/messages/{m1['id']}").json()["message"]
    assert readded["recipient_count"] == after["recipient_count"] and readded["read_count"] == 1
    assert unread(c3.c, "install-team") == 0


def test_wf_broadcast_acknowledge_happy(app_url: str, mail: Any, browser: Browser) -> None:
    dana = fresh(app_url, mail, "dispatcher", ["shift-bulletins"])
    techs = [fresh(app_url, mail, "field_technician", ["shift-bulletins", "crew-main"]) for _ in range(2)]
    cid = channel_id(dana.c, "shift-bulletins")
    crew = channel_id(techs[0].c, "crew-main")
    tag = uuid.uuid4().hex[:8]
    with shell(browser, app_url, dana.c, f"/c/{cid}") as dpage:
        soon(lambda: see(dpage.get_by_role("textbox", name="Message", exact=True)), dpage)
        compose(dpage, f"Shift bulletin {tag}")
        chip = article(dpage, tag)
        soon(lambda: see(chip.get_by_text("Sent", exact=True)), dpage)
        for n, tech in enumerate(techs, start=1):
            with shell(browser, app_url, tech.c, f"/c/{crew}") as page:
                rail = page.get_by_role("navigation", name="Channels")
                soon(lambda: see(rail.get_by_role("link", name=unread_link("shift-bulletins", 1), exact=True)), page)
                click(rail.get_by_role("link", name=unread_link("shift-bulletins", 1), exact=True))
                soon(lambda: see(article(page, tag)), page)
                advance(page, READ_DWELL_MS)
                soon(lambda: see(rail.get_by_role("link", name="shift-bulletins", exact=True)), page)
                soon(lambda n=n: see(chip.get_by_text(re.compile(rf"Read\s*·\s*{n}"))), dpage, page)
    mid = search(dana.c, tag)["results"][0]["message_id"]
    assert dana.c.get(f"/api/messages/{mid}").json()["message"]["read_count"] == 2
    assert all(unread(t.c, "shift-bulletins") == 0 for t in techs)


def test_wf_broadcast_acknowledge_resync(app_url: str, mail: Any, browser: Browser) -> None:
    dana = fresh(app_url, mail, "dispatcher", ["shift-bulletins"])
    tech = fresh(app_url, mail, "field_technician", ["shift-bulletins", "crew-main"])
    cid = channel_id(dana.c, "shift-bulletins")
    crew = channel_id(tech.c, "crew-main")
    tag = uuid.uuid4().hex[:8]
    with shell(browser, app_url, tech.c, f"/c/{crew}") as page:
        rail = page.get_by_role("navigation", name="Channels")
        soon(lambda: see(rail.get_by_role("link", name="shift-bulletins", exact=True)), page)
        page.context.set_offline(True)
        advance(page, PAUSED_NOTICE_MS)
        post(dana.c, cid, f"Offline one {tag}")
        post(dana.c, cid, f"Offline two {tag}")
        page.context.set_offline(False)
        soon(lambda: see(rail.get_by_role("link", name=unread_link("shift-bulletins", 2), exact=True)), page)
        page.reload()
        soon(lambda: see(page.get_by_role("navigation", name="Channels").get_by_role("link", name=unread_link("shift-bulletins", 2), exact=True)), page)
    assert unread(tech.c, "shift-bulletins") == 2


def test_contrast_and_non_colour_state(app_url: str, mail: Any, browser: Browser) -> None:
    u = fresh(app_url, mail, "field_technician", ["install-team", "crew-main", "shift-bulletins"])
    dana = signin(app_url, SEED["dana"])
    crew = channel_id(u.c, "crew-main")
    post(dana, channel_id(dana, "install-team"), f"Badge {uuid.uuid4().hex[:8]}")
    with shell(browser, app_url, u.c, f"/c/{crew}") as page:
        rail = page.get_by_role("navigation", name="Channels")
        current = rail.get_by_role("link", name="crew-main", exact=True)
        soon(lambda: see(current), page)
        expect(current).to_have_attribute("aria-current", "page")
        assert current.evaluate(BAR_JS) >= INK_BAR_MIN
        badge = rail.get_by_role("link", name=unread_link("install-team", 1), exact=True)
        soon(lambda: see(badge), page)
        see(badge.get_by_text("1", exact=True))
        assert badge.evaluate(WEIGHT_JS, "install-team") >= UNREAD_WEIGHT
        quiet = rail.get_by_role("link", name="shift-bulletins", exact=True)
        assert quiet.evaluate(WEIGHT_JS, "shift-bulletins") == READ_WEIGHT
        for w, h in VIEWPORTS.values():
            page.set_viewport_size({"width": w, "height": h})
            axe_contrast(page)
    with open_app(browser, app_url + "/") as page:
        soon(lambda: see(page.get_by_role("button", name="Sign in")), page)
        fill(page.get_by_label("Email"), u.email)
        fill(page.get_by_label("Password"), u.password)
        with held(page, "**/api/session") as gate:
            click(page.get_by_role("button", name="Sign in"))
            pending = page.get_by_role("button", name="Signing in…")
            soon(lambda: see(pending), page)
            expect(pending).to_be_disabled()
            axe_contrast(page)
            gate.release()


def test_edit_versions_and_stale(app_url: str, mail: Any) -> None:
    d = fresh(app_url, mail, "dispatcher", ["shift-bulletins"])
    leads = [fresh(app_url, mail, "crew_lead", ["shift-bulletins"]) for _ in range(2)]
    cid = channel_id(d.c, "shift-bulletins")
    first, second = "RTU-3 locked out", "RTU-3 locked and tagged"
    m = post(d.c, cid, first)
    r = edit(leads[0].c, m["id"], second, 1)
    assert r.status_code == 200 and r.json()["message"]["version"] == 2 and r.json()["message"]["edited"] is True
    stale = assert_error(edit(leads[1].c, m["id"], "Other wording", 1), 412, "stale_version")
    assert stale["current"]["version"] == 2 and stale["current"]["text"] == second
    assert stale["current"]["edited_by"]["id"] == leads[0].id and stale["current"]["edited_by"]["name"] == leads[0].name
    assert stale["current"]["edited_at"]
    assert_error(leads[1].c.patch(f"/api/messages/{m['id']}", json={"text": "x"}), 422, "validation", "expected_version", COPY["expected_version"])
    assert_error(edit(leads[1].c, m["id"], "x", "two"), 422, "validation", "expected_version", COPY["expected_version"])
    results = together([lambda i=i: edit(clone(leads[i % 2].c), m["id"], f"Race {i}", 2) for i in range(6)])
    assert sorted(x.status_code for x in results) == [200] + [412] * 5
    versions = versions_of(d.c, m["id"])
    assert [v["version"] for v in versions] == [1, 2, 3]
    assert versions[0]["text"] == first and versions[1]["text"] == second
    winner = next(x for x in results if x.status_code == 200).json()["message"]["text"]
    assert versions[2]["text"] == winner


def test_edit_permissions_and_window(app_url: str, mail: Any) -> None:
    tech = fresh(app_url, mail, "field_technician", ["install-team"])
    other = fresh(app_url, mail, "field_technician", ["install-team"])
    lead = fresh(app_url, mail, "crew_lead", ["install-team"])
    disp = fresh(app_url, mail, "dispatcher", ["install-team"])
    with serve_copy(EDIT_WINDOW_SECONDS=SHORT_WINDOW_S) as copy:
        tc, oc, lc, dc = tech.on(copy), other.on(copy), lead.on(copy), disp.on(copy)
        jo = signin(copy, SEED["jo"])
        cid = channel_id(tc, "install-team")
        unpin_all(lc, cid)
        m = post(tc, cid, "Superheat 12°F")
        assert iso(m["editable_until"]) - iso(m["sent_at"]) == timedelta(seconds=SHORT_WINDOW_S)
        assert_error(edit(oc, m["id"], "nope", 1), 403, "forbidden")
        for n, c in enumerate((tc, lc, dc, jo), start=1):
            assert edit(c, m["id"], f"Superheat {n}", n).status_code == 200
        closes = iso(m["editable_until"])
        poll(lambda: server_now(copy) >= closes, SHORT_WINDOW_S + HEALTH_S, "edit window to close")
        assert_error(edit(lc, m["id"], "late", 1), 412, "stale_version")
        assert_error(edit(lc, m["id"], "late", 5), 409, "edit_window_closed")
        assert lc.post(f"/api/channels/{cid}/pins", json={"message_id": m["id"]}).status_code == 201
        assert lc.delete(f"/api/channels/{cid}/pins/{m['id']}").status_code == 204
        assert len(versions_of(tc, m["id"])) == 5


def test_pins_limit_and_races(app_url: str, mail: Any) -> None:
    lead = fresh(app_url, mail, "crew_lead", ["install-team"])
    lead2 = fresh(app_url, mail, "crew_lead", ["install-team"])
    tech = fresh(app_url, mail, "field_technician", ["install-team", "crew-main"])
    cid = channel_id(lead.c, "install-team")
    unpin_all(lead.c, cid)
    msgs = [post(lead.c, cid, f"Notice {i}") for i in range(6)]

    def pin(c: httpx.Client, mid: str) -> httpx.Response:
        return c.post(f"/api/channels/{cid}/pins", json={"message_id": mid})

    assert_error(pin(tech.c, msgs[0]["id"]), 403, "forbidden")
    r = pin(lead.c, msgs[0]["id"])
    assert r.status_code == 201 and r.json()["pinned_message_ids"] == [msgs[0]["id"]]
    pinned_by = lead.c.get(f"/api/messages/{msgs[0]['id']}").json()["message"]["pinned_by"]
    assert pinned_by["id"] == lead.id and pinned_by["name"] == lead.name
    results = together([lambda m=m: pin(clone(lead.c), m["id"]) for m in msgs[1:5]])
    assert sorted(x.status_code for x in results) == [201, 201, 409, 409]
    for x in results:
        if x.status_code == 409:
            assert_error(x, 409, "pin_limit")
    assert len(lead.c.get(f"/api/channels/{cid}").json()["channel"]["pinned_message_ids"]) == PIN_LIMIT
    assert_error(pin(lead.c, msgs[0]["id"]), 409, "already_pinned")
    assert lead.c.delete(f"/api/channels/{cid}/pins/{msgs[0]['id']}").status_code == 204
    assert_error(lead.c.delete(f"/api/channels/{cid}/pins/{msgs[0]['id']}"), 404, "not_found")
    results = together([lambda c=c: pin(clone(c), msgs[5]["id"]) for c in (lead.c, lead2.c, lead.c, lead2.c)])
    assert sorted(x.status_code for x in results) == [201, 409, 409, 409]
    assert all(x.json()["error"] == "already_pinned" for x in results if x.status_code == 409)
    other = post(tech.c, channel_id(tech.c, "crew-main"), "Elsewhere")
    assert_error(pin(lead.c, other["id"]), 404, "not_found")
    assert_error(pin(lead.c, "nope"), 422, "validation")
    pinned = lead.c.get(f"/api/channels/{cid}").json()["channel"]["pinned_message_ids"]
    assert msgs[5]["id"] in pinned and len(pinned) == PIN_LIMIT
    assert tech.c.get(f"/api/channels/{cid}").json()["channel"]["pinned_message_ids"] == pinned
    assert lead.c.delete(f"/api/messages/{msgs[5]['id']}").status_code == 204
    assert msgs[5]["id"] not in lead.c.get(f"/api/channels/{cid}").json()["channel"]["pinned_message_ids"]
    unpin_all(lead.c, cid)


def test_edit_conflict_dialog(app_url: str, mail: Any, browser: Browser) -> None:
    p = fresh(app_url, mail, "crew_lead", ["install-team"])
    other = fresh(app_url, mail, "crew_lead", ["install-team"])
    cid = channel_id(p.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    m = post(p.c, cid, f"Lockout notice {tag}")
    with shell(browser, app_url, p.c, f"/c/{cid}") as page:
        art = article(page, tag)
        soon(lambda: see(art), page)
        choose(page, art, "Edit")
        dialog = page.get_by_role("dialog", name="Edit message")
        box = dialog.get_by_role("textbox", name="Message text")
        fill(box, f"Priya draft {tag}")
        assert edit(other.c, m["id"], f"Marco wording {tag}", 1).status_code == 200
        click(dialog.get_by_role("button", name="Save edit"))
        newer = dialog.get_by_role("region", name="Newer version")
        soon(lambda: see(newer), page)
        see(newer.get_by_text(f"Marco wording {tag}"))
        see(newer.get_by_text(f"Saved by {other.name}", exact=False))
        expect(box).to_have_value(f"Priya draft {tag}")
        soon(lambda: expect(notices(page)).to_contain_text("Someone saved a newer version. Your draft is still here.", timeout=POLL_MS), page)
        click(dialog.get_by_role("button", name="Use newer text"))
        expect(box).to_have_value(f"Marco wording {tag}")
        fill(box, f"Priya final {tag}")
        over = dialog.get_by_role("button", name="Save over it")
        click(over if over.count() else dialog.get_by_role("button", name="Save edit"))
        soon(lambda: expect(notices(page)).to_contain_text(saved_as(3), timeout=POLL_MS), page)
    assert [v["text"] for v in versions_of(p.c, m["id"])] == [f"Lockout notice {tag}", f"Marco wording {tag}", f"Priya final {tag}"]


def test_wf_pinned_correction_conflict(app_url: str, mail: Any, browser: Browser) -> None:
    disp = fresh(app_url, mail, "dispatcher", ["shift-bulletins"])
    leads = [fresh(app_url, mail, "crew_lead", ["shift-bulletins"]) for _ in range(2)]
    cid = channel_id(disp.c, "shift-bulletins")
    unpin_all(disp.c, cid)
    tag = uuid.uuid4().hex[:8]
    m = post(disp.c, cid, f"RTU-3 lockout {tag}")
    assert disp.c.post(f"/api/channels/{cid}/pins", json={"message_id": m["id"]}).status_code == 201
    with shell(browser, app_url, leads[0].c, f"/c/{cid}") as p1, shell(browser, app_url, leads[1].c, f"/c/{cid}") as p2:
        boxes = []
        for n, page in enumerate((p1, p2)):
            pinned = page.get_by_role("region", name="Pinned")
            soon(lambda pinned=pinned, page=page: see(pinned.get_by_text(f"RTU-3 lockout {tag}")), page)
            see(pinned.get_by_text(f"Pinned by {disp.name}"))
            choose(page, article(page, tag), "Edit")
            box = page.get_by_role("dialog", name="Edit message").get_by_role("textbox", name="Message text")
            fill(box, f"Wording {n} {tag}")
            boxes.append(box)
        with held(p1, "**/api/messages/*") as g1, held(p2, "**/api/messages/*") as g2:
            click(p1.get_by_role("dialog", name="Edit message").get_by_role("button", name="Save edit"))
            click(p2.get_by_role("dialog", name="Edit message").get_by_role("button", name="Save edit"))
            g1.release()
            g2.release()

        def two_versions() -> list[dict] | None:
            v = versions_of(disp.c, m["id"])
            return v if len(v) >= 2 else None

        versions = poll(two_versions, UI_WAIT_S, "a winning save")
        winner = 0 if versions[1]["edited_by"]["id"] == leads[0].id else 1
        loser_page = (p1, p2)[1 - winner]
        dialog = loser_page.get_by_role("dialog", name="Edit message")
        soon(lambda: see(dialog.get_by_role("region", name="Newer version")), loser_page)
        see(dialog.get_by_text(f"Saved by {leads[winner].name}", exact=False))
        expect(boxes[1 - winner]).to_have_value(f"Wording {1 - winner} {tag}")
        click(dialog.get_by_role("button", name="Save over it"))
        soon(lambda: expect(notices(loser_page)).to_contain_text(saved_as(3), timeout=POLL_MS), loser_page)
    texts = [v["text"] for v in versions_of(disp.c, m["id"])]
    assert texts == [f"RTU-3 lockout {tag}", f"Wording {winner} {tag}", f"Wording {1 - winner} {tag}"]
    unpin_all(disp.c, cid)


def test_wf_pinned_correction_pin_limit(app_url: str, mail: Any, browser: Browser) -> None:
    disp = fresh(app_url, mail, "dispatcher", ["shift-bulletins"])
    leads = [fresh(app_url, mail, "crew_lead", ["shift-bulletins"]) for _ in range(2)]
    cid = channel_id(disp.c, "shift-bulletins")
    unpin_all(disp.c, cid)
    tag = uuid.uuid4().hex[:8]
    for word in ("A", "Z"):
        pre = post(disp.c, cid, f"Notice {word} {tag}")
        assert disp.c.post(f"/api/channels/{cid}/pins", json={"message_id": pre["id"]}).status_code == 201
    post(disp.c, cid, f"Notice B {tag}")
    post(disp.c, cid, f"Notice C {tag}")
    with shell(browser, app_url, leads[0].c, f"/c/{cid}") as p1, shell(browser, app_url, leads[1].c, f"/c/{cid}") as p2:
        for page in (p1, p2):
            soon(lambda page=page: see(article(page, f"Notice C {tag}")), page)
            listen(page, "Notices")
        with held(p1, "**/api/channels/*/pins") as g1, held(p2, "**/api/channels/*/pins") as g2:
            choose(p1, article(p1, f"Notice B {tag}"), "Pin")
            choose(p2, article(p2, f"Notice C {tag}"), "Pin")
            g1.release()
            g2.release()
        outcomes = []
        for page in (p1, p2):
            soon(lambda page=page: assert_said_any(page, ["Pinned.", ERR["pin_limit"]]), page)
            outcomes.append("Pinned." if any("Pinned." in s for s in said(page, "Notices")) else "limit")
        assert sorted(outcomes) == ["Pinned.", "limit"]
        soon(lambda: expect(p1.get_by_role("region", name="Pinned").get_by_text(re.compile(rf"Notice [ABCZ] {tag}"))).to_have_count(PIN_LIMIT, timeout=POLL_MS), p1)
    assert len(disp.c.get(f"/api/channels/{cid}").json()["channel"]["pinned_message_ids"]) == PIN_LIMIT
    unpin_all(disp.c, cid)


def test_wf_pinned_correction_window_closed(app_url: str, mail: Any, browser: Browser) -> None:
    lead = fresh(app_url, mail, "crew_lead", ["install-team"])
    tag = uuid.uuid4().hex[:8]
    with serve_copy(EDIT_WINDOW_SECONDS=SHORT_WINDOW_S) as copy:
        lc = lead.on(copy)
        cid = channel_id(lc, "install-team")
        m = post(lc, cid, f"RTU-3 tagged out {tag}")
        closes = iso(m["editable_until"])
        with shell(browser, copy, lc, f"/c/{cid}") as page:
            page.clock.set_system_time(server_now(copy) - timedelta(hours=BROWSER_SKEW_H))
            page.reload()
            art = article(page, tag)
            soon(lambda: see(art), page)
            choose(page, art, "Edit")
            dialog = page.get_by_role("dialog", name="Edit message")
            box = dialog.get_by_role("textbox", name="Message text")
            fill(box, f"Marco late draft {tag}")
            poll(lambda: server_now(copy) >= closes, SHORT_WINDOW_S + HEALTH_S, "edit window to close")
            click(dialog.get_by_role("button", name="Save edit"))
            soon(lambda: shown(dialog.get_by_text(ERR["edit_window_closed"])), page)
            expect(box).to_have_value(f"Marco late draft {tag}")
            expect(dialog.get_by_role("button", name="Save edit")).to_have_count(0)
            expect(dialog.get_by_role("button", name="Save over it")).to_have_count(0)
            click(dialog.get_by_role("button", name="Cancel"))
            soon(lambda: gone(dialog), page)
            click(art.get_by_role("button", name="Message actions"))
            soon(lambda: see(page.get_by_role("menuitem", name="Pin", exact=True)), page)
            soon(lambda: expect(page.get_by_role("menuitem", name="Edit", exact=True)).to_have_count(0, timeout=POLL_MS), page, seconds=EDIT_MENU_SLACK_S + EVENT_SLACK_S)
        assert len(versions_of(lc, m["id"])) == 1


def test_thread_replies(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["install-team", "crew-main"])
    cid = channel_id(t.c, "install-team")
    root = post(t.c, cid, "Root")
    replies = [post(t.c, cid, f"Reply {i}", thread_root_id=root["id"]) for i in range(3)]
    assert t.c.get(f"/api/messages/{root['id']}").json()["message"]["reply_count"] == 3
    thread = t.c.get(f"/api/messages/{root['id']}/thread").json()
    assert thread["root"]["id"] == root["id"]
    assert [r["id"] for r in thread["replies"]] == [r["id"] for r in reversed(replies)]
    assert all(r["thread_root_id"] == root["id"] for r in thread["replies"])
    assert_error(send(t.c, cid, "nested", thread_root_id=replies[0]["id"]), 422, "validation", "thread_root_id", COPY["thread_root_id"])
    elsewhere = post(t.c, channel_id(t.c, "crew-main"), "Other root")
    assert_error(send(t.c, cid, "cross", thread_root_id=elsewhere["id"]), 422, "validation", "thread_root_id", COPY["thread_root_id"])
    assert history_entry(t.c, cid, replies[0]["id"]) is None


def test_quotes_current_text_and_placeholder(app_url: str, mail: Any) -> None:
    d = fresh(app_url, mail, "dispatcher", ["site-store-114"])
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(d.c, "site-store-114")
    orig = post(d.c, cid, "Target superheat 8°F")
    reply = post(t.c, cid, "Set to 8", quoted_message_id=orig["id"])
    q = reply["quote"]
    assert (q["message_id"], q["author_name"], q["text"], q["edited"], q["deleted"]) == (orig["id"], d.name, "Target superheat 8°F", False, False)
    assert edit(d.c, orig["id"], "Target superheat 10°F", 1).status_code == 200
    q = t.c.get(f"/api/messages/{reply['id']}").json()["message"]["quote"]
    assert q["text"] == "Target superheat 10°F" and q["edited"] is True and q["message_id"] == orig["id"]
    assert d.c.delete(f"/api/messages/{orig['id']}").status_code == 204
    q = t.c.get(f"/api/messages/{reply['id']}").json()["message"]["quote"]
    assert q["message_id"] == orig["id"] and q["deleted"] is True and "text" not in q


def test_version_history(app_url: str, mail: Any) -> None:
    d = fresh(app_url, mail, "dispatcher", ["site-store-114"])
    lead = fresh(app_url, mail, "crew_lead", ["site-store-114"])
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(d.c, "site-store-114")
    m = post(d.c, cid, "v1 text")
    assert edit(lead.c, m["id"], "v2 text", 1).status_code == 200
    assert edit(d.c, m["id"], "v3 text", 2).status_code == 200
    versions = versions_of(t.c, m["id"])
    assert [(v["version"], v["text"], v["edited_by"]["id"]) for v in versions] == [(1, "v1 text", d.id), (2, "v2 text", lead.id), (3, "v3 text", d.id)]
    times = [iso(v["created_at"]) for v in versions]
    assert times == sorted(times) and times[0] == iso(m["sent_at"])
    assert_error(signin(app_url, SEED["sam"]).get(f"/api/messages/{m['id']}/versions"), 404, "not_found")


def test_accepted_fields_only(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    other = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    first, fixed = "Superheat 8", "Superheat 10"
    q = post(other.c, cid, "Quoted reading")
    m = post(t.c, cid, first, quoted_message_id=q["id"])
    body = assert_error(t.c.patch(f"/api/messages/{m['id']}", json={"text": fixed, "expected_version": 1, "author_id": other.id, "quoted_message_id": str(uuid.uuid4())}), 422, "validation")
    assert body["errors"] == {"author_id": COPY["unaccepted"], "quoted_message_id": COPY["unaccepted"]}
    assert_error(t.c.patch(f"/api/messages/{m['id']}", json={"text": "x", "expected_version": 1, "sent_at": "2020-01-01T00:00:00Z"}), 422, "validation", "sent_at", COPY["unaccepted"])
    same = t.c.get(f"/api/messages/{m['id']}").json()["message"]
    assert same["version"] == 1 and same["text"] == first and len(versions_of(t.c, m["id"])) == 1
    edited = edit(t.c, m["id"], fixed, 1).json()["message"]
    for key in ("author", "sent_at", "editable_until", "thread_root_id", "attachments"):
        assert edited[key] == m[key], key
    assert edited["quote"]["message_id"] == q["id"]
    assert_error(t.c.patch(f"/api/messages/{m['id']}", json={"text": "x", "expected_version": 1, "author_id": other.id}), 412, "stale_version")
    cmid = str(uuid.uuid4())
    assert_error(send(t.c, cid, "With extra", cmid, author_id=other.id), 422, "validation", "author_id", COPY["unaccepted"])
    r = send(t.c, cid, "With extra", cmid)
    assert r.status_code == 201 and r.headers.get("Rimewire-Replay") != "true"
    assert r.json()["message"]["author"]["id"] == t.id
    replay = send(t.c, cid, "With extra", cmid, pinned=True)
    assert replay.status_code == 201 and replay.headers.get("Rimewire-Replay") == "true"
    assert_error(send_photos(t.c, cid, "x", [("a.jpg", photo(), "image/jpeg")], pinned="true"), 422, "validation", "pinned", COPY["unaccepted"])


def test_plain_text_and_safe_links(app_url: str, mail: Any, browser: Browser) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    lead = fresh(app_url, mail, "crew_lead", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    unpin_all(lead.c, cid)
    tag = uuid.uuid4().hex[:8]
    script = "javascript:alert(1)"
    chart_host = "pt.example"
    stray_host = "no.example"
    tail = "\nline two"
    upper = f"HTTPS://{chart_host}/chart.pdf"
    paren = f"https://{chart_host}/a_(b)"
    words = f"{tag} <b>x</b> [y](z) {script} www.example.com {upper}). ({paren}) xhttps://{stray_host} https://{tail}"
    m = post(t.c, cid, words)
    assert lead.c.post(f"/api/channels/{cid}/pins", json={"message_id": m["id"]}).status_code == 201
    hrefs = {upper, paren}
    with shell(browser, app_url, t.c, f"/c/{cid}") as page:
        art = article(page, tag)
        soon(lambda: see(art), page)
        links = art.get_by_role("link")
        assert {links.nth(i).get_attribute("href") for i in range(links.count())} == hrefs
        for i in range(links.count()):
            assert links.nth(i).get_attribute("target") == "_blank"
            assert {"noopener", "noreferrer"} <= set((links.nth(i).get_attribute("rel") or "").split())
        see(art.get_by_text("<b>x</b>", exact=False))
        see(art.get_by_text(script, exact=False))
        holder = art.get_by_text(re.compile(tag)).first
        assert set(holder.evaluate(TAGS_JS)) <= {"A", "BR"}
        assert tail in holder.inner_text()
        pinned = page.get_by_role("region", name="Pinned")
        soon(lambda: see(pinned.get_by_text("<b>x</b>", exact=False)), page)
        expect(pinned.get_by_role("link", name=re.compile(re.escape(stray_host)))).to_have_count(0)
        choose(page, art, "Version history")
        versions = details(page).get_by_role("list", name="Versions")
        soon(lambda: see(versions.get_by_text("<b>x</b>", exact=False)), page)
        box = page.get_by_role("searchbox", name="Search messages")
        fill(box, tag)
        box.press("Enter")
        soon(lambda: see(details(page).get_by_role("heading", level=2, name="Search results")), page)
        soon(lambda: see(details(page).get_by_text(tag, exact=False).first), page)
        for href in hrefs:
            expect(details(page).get_by_role("link", name=href, exact=True)).to_have_count(0)
    unpin_all(lead.c, cid)


def test_wf_quoted_replies_happy(app_url: str, mail: Any, browser: Browser) -> None:
    dana = fresh(app_url, mail, "dispatcher", ["site-store-114"])
    rui = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(rui.c, "site-store-114")
    tag = uuid.uuid4().hex[:8]
    orig = post(dana.c, cid, f"Target superheat 8°F {tag}")
    chart = "https://pt.example/r404a-chart"
    with shell(browser, app_url, rui.c, f"/c/{cid}") as page:
        art = article(page, f"Target superheat 8°F {tag}")
        soon(lambda: see(art), page)
        choose(page, art, "Quote")
        see(page.get_by_role("button", name="Remove quote"))
        compose(page, f"Set it {tag}r")
        reply = article(page, f"Set it {tag}r")
        soon(lambda: see(reply.get_by_text("Sent", exact=True)), page)
        assert edit(dana.c, orig["id"], f"Target superheat 10°F {tag} see {chart}", 1).status_code == 200
        soon(lambda: see(reply.get_by_text("Target superheat 10°F", exact=False)), page)
        see(reply.get_by_text("Edited", exact=True))
        link = reply.get_by_role("link", name=chart)
        expect(link).to_have_attribute("href", chart)
        expect(link).to_have_attribute("target", "_blank")
        choose(page, article(page, f"Target superheat 10°F {tag}").first, "Version history")
        items = details(page).get_by_role("list", name="Versions").get_by_role("listitem")
        soon(lambda: expect(items).to_have_count(2, timeout=POLL_MS), page)
        see(items.first.get_by_text(f"Target superheat 8°F {tag}", exact=False))
    stored = search(rui.c, f"Set it {tag}r")["results"][0]
    quote = rui.c.get(f"/api/messages/{stored['message_id']}").json()["message"]["quote"]
    assert quote["message_id"] == orig["id"] and quote["edited"] is True and quote["author_name"] == dana.name
    after = rui.c.get(f"/api/messages/{orig['id']}").json()["message"]
    assert after["sent_at"] == orig["sent_at"] and after["author"]["id"] == dana.id


def test_wf_quoted_replies_thread(app_url: str, mail: Any, browser: Browser) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    tag = uuid.uuid4().hex[:8]
    root = post(t.c, cid, f"Thread root {tag}")
    with shell(browser, app_url, t.c, f"/c/{cid}") as page:
        art = article(page, f"Thread root {tag}")
        soon(lambda: see(art), page)
        choose(page, art, "Reply in thread")
        soon(lambda: see(details(page).get_by_role("heading", level=2, name="Thread")), page)
        assert parse_qs(urlparse(page.url).query)["thread"] == [root["id"]]
        fill(details(page).get_by_role("textbox", name="Reply"), f"In thread {tag}")
        click(details(page).get_by_role("button", name="Send reply"))
        soon(lambda: see(art.get_by_role("button", name=view_replies(1))), page)
    assert t.c.get(f"/api/messages/{root['id']}").json()["message"]["reply_count"] == 1


def test_receipts_endpoint(app_url: str, mail: Any) -> None:
    d = fresh(app_url, mail, "dispatcher", ["install-team"])
    t = fresh(app_url, mail, "field_technician", ["install-team"])
    t2 = fresh(app_url, mail, "field_technician", ["install-team"])
    lead = fresh(app_url, mail, "crew_lead", ["install-team"])
    cid = channel_id(d.c, "install-team")
    m = post(d.c, cid, "Bulletin v1")
    receipts(t.c, [m["id"]], "delivered")
    receipts(t.c, [m["id"]], "read")
    edit(d.c, m["id"], "Bulletin v2", 1)
    receipts(t2.c, [m["id"]], "read")
    body = lead.c.get(f"/api/messages/{m['id']}/receipts").json()
    assert body["message_id"] == m["id"] and body["sent_at"] == m["sent_at"] and body["as_of"]
    assert [(v["version"], v["text"]) for v in body["versions"]] == [(1, "Bulletin v1"), (2, "Bulletin v2")]
    rows = {r["user"]["id"]: r for r in body["recipients"]}
    assert [x["version"] for x in rows[t.id]["reads"]] == [1] and [x["version"] for x in rows[t2.id]["reads"]] == [2]
    assert rows[lead.id]["delivered_at"] is None and rows[lead.id]["reads"] == []
    assert body["read_count"] == 2 and body["delivered_count"] == 2 and body["recipient_count"] == len(rows)
    jo = signin(app_url, SEED["jo"])
    assert jo.delete(f"/api/channels/{cid}/members/{t2.id}").status_code == 204
    dropped = lead.c.get(f"/api/messages/{m['id']}/receipts").json()
    assert t2.id not in {r["user"]["id"] for r in dropped["recipients"]}
    assert dropped["recipient_count"] == body["recipient_count"] - 1
    assert dropped["read_count"] == 1 and dropped["delivered_count"] == 1
    assert d.c.get(f"/api/messages/{m['id']}/receipts").status_code == 200
    assert signin(app_url, SEED["jo"]).get(f"/api/messages/{m['id']}/receipts").status_code == 200
    assert_error(t.c.get(f"/api/messages/{m['id']}/receipts"), 403, "forbidden")
    own = post(t.c, cid, "My reading")
    assert t.c.get(f"/api/messages/{own['id']}/receipts").status_code == 200
    assert_error(signin(app_url, SEED["sam"]).get(f"/api/messages/{m['id']}/receipts"), 404, "not_found")


def scrub_setup(app_url: str, mail: Any) -> tuple[Person, list[Person], str, dict, int]:
    d = fresh(app_url, mail, "dispatcher", ["install-team"])
    readers = [fresh(app_url, mail, "field_technician", ["install-team"]) for _ in range(3)]
    cid = channel_id(d.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    m = post(d.c, cid, f"Bulletin v1 {tag}")
    receipts(readers[0].c, [m["id"]], "read")
    assert edit(d.c, m["id"], f"Bulletin v2 {tag}", 1).status_code == 200
    receipts(readers[1].c, [m["id"]], "read")
    total = d.c.get(f"/api/messages/{m['id']}").json()["message"]["recipient_count"]
    return d, readers, cid, {**m, "tag": tag}, total


def open_receipts(page: Page, tag: str) -> Locator:
    art = article(page, f"Bulletin v2 {tag}")
    soon(lambda: see(art), page)
    choose(page, art, "Receipts")
    slider = page.get_by_role("slider", name="Receipts time")
    soon(lambda: see(slider), page)
    return slider


def jump_to_right_end(page: Page, c: httpx.Client, mid: str) -> None:
    track = c.get(f"/api/messages/{mid}/receipts").json()
    paused = datetime.fromtimestamp(page.evaluate("Date.now()") / 1000, timezone.utc)
    page.clock.pause_at(max(paused, iso(track["as_of"]), iso(track["sent_at"])) + timedelta(seconds=1))


def test_receipts_scrubber_keys_and_anchor(app_url: str, mail: Any, browser: Browser) -> None:
    d, readers, cid, m, total = scrub_setup(app_url, mail)
    a, b, c = readers
    with shell(browser, app_url, d.c, f"/c/{cid}") as page:
        slider = open_receipts(page, m["tag"])
        jump_to_right_end(page, d.c, m["id"])
        soon(lambda: expect(slider).to_have_attribute("aria-valuetext", re.compile(rf"— 2 of {total} read, version 2$"), timeout=POLL_MS), page)
        assert handle_value(slider) == pytest.approx(100)
        see(details(page).get_by_text(f"2 of {total} read"))
        read_lane = details(page).get_by_role("list", name="Read")
        see(read_lane.get_by_role("listitem").filter(has_text=a.name).get_by_text("read v1"))
        slider.focus()
        slider.press("Home")
        soon(lambda: expect(slider).to_have_attribute("aria-valuetext", re.compile(rf"— 0 of {total} read, version 1$"), timeout=POLL_MS), page)
        assert handle_value(slider) == pytest.approx(0)
        version = page.get_by_role("region", name="Version at selected time")
        soon(lambda: see(version.get_by_text(f"Bulletin v1 {m['tag']}")), page)
        see(version.get_by_text("v1", exact=True))
        slider.press("ArrowRight")
        assert handle_value(slider) == pytest.approx(1, abs=0.5)
        slider.press("Shift+ArrowRight")
        assert handle_value(slider) == pytest.approx(11, abs=0.5)
        slider.press("ArrowLeft")
        assert handle_value(slider) == pytest.approx(10, abs=0.5)
        click(details(page).get_by_role("button", name="Show event list"))
        events = details(page).get_by_role("listbox", name="Edit and read events")
        click(events.get_by_role("option", name=re.compile(rf"· {re.escape(a.name)} read v1$")))
        soon(lambda: expect(slider).to_have_attribute("aria-valuetext", re.compile(rf"— 1 of {total} read, version 1$"), timeout=POLL_MS), page)
        expect(read_lane.get_by_role("listitem").filter(has_text=a.name).get_by_text("read v1")).to_have_count(0)
        click(events.get_by_role("option", name=re.compile(rf"· v2 edit by {re.escape(d.name)}$")))
        soon(lambda: expect(slider).to_have_attribute("aria-valuetext", re.compile(rf"— 1 of {total} read, version 2$"), timeout=POLL_MS), page)
        see(read_lane.get_by_role("listitem").filter(has_text=a.name).get_by_text("read v1"))
        see(details(page).get_by_role("list", name="Not yet").get_by_role("listitem").filter(has_text=b.name))
        soon(lambda: see(version.get_by_text(f"Bulletin v2 {m['tag']}")), page)
        anchored_text = slider.get_attribute("aria-valuetext")
        anchored_at = handle_value(slider)
        receipts(c.c, [m["id"]], "read")
        soon(lambda: see(events.get_by_role("option", name=re.compile(rf"· {re.escape(c.name)} read v2$"))), page)
        advance(page, ANCHOR_ADVANCE_MS)
        expect(slider).to_have_attribute("aria-valuetext", anchored_text)
        assert handle_value(slider) < anchored_at
        slider.press("End")
        soon(lambda: expect(slider).to_have_attribute("aria-valuetext", re.compile(rf"— 3 of {total} read, version 2$"), timeout=POLL_MS), page)


def test_wf_read_by_version_touch(app_url: str, mail: Any, browser: Browser) -> None:
    d, _, cid, m, _ = scrub_setup(app_url, mail)
    w, h = VIEWPORTS["mobile"]
    with shell(browser, app_url, d.c, f"/c/{cid}", size=(w, h)) as page:
        cdp = touch_screen(page)
        slider = open_receipts(page, m["tag"])
        settle(details(page))
        box = slider.bounding_box()
        hit_w, hit_h = hit_area(slider)
        assert hit_w >= HIT_MIN and hit_h >= HIT_MIN, (hit_w, hit_h)
        before = details(page).evaluate(SCROLLS_JS)
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        below = y + h / 8
        touch_start(cdp, x, y)
        for i in range(1, 9):
            touch_move(cdp, x - (x - 1) * i / 8, y + (below - y) * i / 8)
        soon(lambda: value_near(slider, 0), page)
        for i in range(1, 9):
            touch_move(cdp, 1 + (w - 2) * i / 8, below)
        soon(lambda: value_near(slider, 100), page)
        touch_end(cdp)
        dragged = slider.get_attribute("aria-valuetext")
        assert details(page).evaluate(SCROLLS_JS) == before
        slider.focus()
        slider.press("Home")
        slider.press("End")
        expect(slider).to_have_attribute("aria-valuetext", dragged)


def scrub_parts(page: Page) -> list[Locator]:
    panel = details(page)
    return [
        page.get_by_role("region", name="Version at selected time"),
        panel.get_by_role("list", name="Read"),
        panel.get_by_role("list", name="Not yet"),
        panel.get_by_text(re.compile(r"^\d+ of \d+ read$")).first,
    ]


def scrub_handles(page: Page) -> list[Any]:
    return [p.element_handle() for p in scrub_parts(page) if p.count()]


def scrub_state(page: Page) -> str:
    return page.evaluate(SNAPSHOT_JS, scrub_handles(page))


def test_scrubber_motion_and_reduced_motion(app_url: str, mail: Any, browser: Browser) -> None:
    d, _, cid, m, _ = scrub_setup(app_url, mail)
    for reduced in ("no-preference", "reduce"):
        with shell(browser, app_url, d.c, f"/c/{cid}", reduced=reduced) as page:
            slider = open_receipts(page, m["tag"])
            settle(details(page))
            events = details(page).get_by_role("listbox", name="Edit and read events")
            if reduced == "reduce":
                see(events)
            else:
                expect(events).to_be_hidden()
            page.evaluate(SCRUB_ANIMS_JS, scrub_handles(page))
            slider.focus()
            slider.press("Home")
            advance(page, SCRUB_MID_MS)
            mid = scrub_state(page)
            advance(page, TRAVEL_MAX_MS * 3)
            soon(lambda: see(page.get_by_role("region", name="Version at selected time").get_by_text("v1", exact=True)), page)
            settle(details(page))
            end = scrub_state(page)
            durations = page.evaluate("() => window.__anims")
            if reduced == "reduce":
                assert all(x <= SNAP_MAX_MS for x in durations), durations
                assert mid == end, "scrubber state still moving under reduced motion"
            else:
                assert any(TRAVEL_MIN_MS <= x < TRAVEL_MAX_MS for x in durations) or mid != end, durations


def test_wf_read_by_version_happy(app_url: str, mail: Any, browser: Browser) -> None:
    d, readers, cid, m, total = scrub_setup(app_url, mail)
    rui = readers[0]
    with shell(browser, app_url, d.c, f"/c/{cid}") as page:
        slider = open_receipts(page, m["tag"])
        read_lane = details(page).get_by_role("list", name="Read")
        rui_item = read_lane.get_by_role("listitem").filter(has_text=rui.name)
        see(rui_item.get_by_text("read v1"))
        see(details(page).get_by_role("list", name="Not yet").get_by_role("listitem").filter(has_text=readers[2].name))
        receipts(rui.c, [m["id"]], "read")
        soon(lambda: expect(rui_item.get_by_text("read v1")).to_have_count(0, timeout=POLL_MS), page, seconds=EVENT_DELAY_S + EVENT_SLACK_S + UI_WAIT_S)
        assert handle_value(slider) == pytest.approx(100)
        expect(slider).to_have_attribute("aria-valuetext", re.compile(rf"— 2 of {total} read, version 2$"))
    rows = {r["user"]["id"]: r for r in d.c.get(f"/api/messages/{m['id']}/receipts").json()["recipients"]}
    assert sorted(x["version"] for x in rows[rui.id]["reads"]) == [1, 2]


def test_schedule_in_business_time(app_url: str, mail: Any) -> None:
    d = fresh(app_url, mail, "dispatcher", ["install-team"])
    lead = fresh(app_url, mail, "crew_lead", ["install-team"])
    tech = fresh(app_url, mail, "field_technician", ["install-team"])
    cid = channel_id(d.c, "install-team")
    now = server_now(app_url)
    target = datetime.combine((now + timedelta(days=3)).astimezone(CHICAGO).date(), dtime(6, 30), tzinfo=CHICAGO)
    r = schedule(d.c, cid, "Start of shift", target.date(), "06:30")
    assert r.status_code == 201, r.text
    s = r.json()["scheduled"]
    assert s["state"] == "scheduled" and s["repeat"] == "none" and s["time_zone"] == CHICAGO_NAME
    assert s["local_date"] == target.date().isoformat() and s["local_time"].startswith("06:30")
    assert iso(s["next_fire_at"]) == target
    local = datetime.fromisoformat(s["next_fire_local"])
    assert local == target and local.utcoffset() == target.utcoffset() and (local.hour, local.minute) == (6, 30)
    assert [datetime.fromisoformat(x) for x in s["upcoming_local"]] == [target]
    past = (now - timedelta(hours=2)).astimezone(CHICAGO)
    assert_error(schedule(d.c, cid, "Late", past.date(), f"{past:%H:%M}"), 422, "validation", "local_time", passed_in(CHICAGO_NAME))
    assert_error(schedule(d.c, cid, "Bad", target.date(), "25:99"), 422, "validation", "local_time", COPY["date_time"])
    assert_error(schedule(d.c, cid, "Bad", "2026-13-40", "06:30"), 422, "validation", "local_date", COPY["date_time"])
    assert_error(schedule(d.c, cid, "Bad", target.date(), "06:30", "daily"), 422, "validation", "repeat", COPY["repeat"])
    assert_error(schedule(lead.c, cid, "No", target.date(), "06:30"), 403, "forbidden")
    assert_error(schedule(tech.c, cid, "No", target.date(), "06:30"), 403, "forbidden")
    assert d.c.delete(f"/api/scheduled/{s['id']}").status_code == 200


def test_weekly_posts_across_clock_changes(app_url: str, mail: Any) -> None:
    d = fresh(app_url, mail, "dispatcher", ["install-team"])
    cid = channel_id(d.c, "install-team")
    now = server_now(app_url)
    changes = transitions(CHICAGO, now + timedelta(days=9))
    spring = next(day for day, forward in changes if forward)
    fall = next(day for day, forward in changes if not forward)
    gap = schedule(d.c, cid, "Gap", spring, "02:30").json()["scheduled"]
    expected_gap = datetime.combine(spring, dtime(3, 30), tzinfo=CHICAGO)
    assert iso(gap["next_fire_at"]) == expected_gap
    local = datetime.fromisoformat(gap["next_fire_local"])
    assert (local.hour, local.minute) == (3, 30) and local.utcoffset() == expected_gap.utcoffset()
    overlap = schedule(d.c, cid, "Overlap", fall, "01:30").json()["scheduled"]
    assert iso(overlap["next_fire_at"]) == datetime.combine(fall, dtime(1, 30), tzinfo=CHICAGO).replace(fold=0).astimezone(timezone.utc)
    change = changes[0][0]
    monday = change - timedelta(days=(change.weekday() % 7) or 7)
    weekly = schedule(d.c, cid, "Weekly", monday, "06:30", "weekly").json()["scheduled"]
    upcoming = [datetime.fromisoformat(x) for x in weekly["upcoming_local"]]
    assert [u.date() for u in upcoming] == [monday + timedelta(days=7 * i) for i in range(3)]
    assert all((u.hour, u.minute, u.weekday()) == (6, 30, 0) for u in upcoming)
    assert upcoming[0].utcoffset() != upcoming[1].utcoffset()
    assert [u.utcoffset() for u in upcoming] == [datetime.combine(u.date(), dtime(6, 30), tzinfo=CHICAGO).utcoffset() for u in upcoming]
    for s in (gap, overlap, weekly):
        assert d.c.delete(f"/api/scheduled/{s['id']}").status_code == 200

    tag = uuid.uuid4().hex[:8]
    due = (server_now(app_url) + timedelta(seconds=SCHEDULE_LEAD_S)).astimezone(CHICAGO).replace(microsecond=0)
    s = schedule(d.c, cid, f"Weekly fire {tag}", due.date(), f"{due:%H:%M:%S}", "weekly").json()["scheduled"]
    poll(lambda: scheduled(d.c, cid, s["id"])["fired_count"] >= 1, SCHEDULE_LEAD_S + FIRE_DELAY_S + HEALTH_S, "weekly occurrence to fire")
    back = poll(lambda: (lambda x: x if x["state"] == "scheduled" else None)(scheduled(d.c, cid, s["id"])), FIRE_DELAY_S, "back to scheduled")
    assert back["fired_count"] == 1
    assert datetime.fromisoformat(back["next_fire_local"]) == datetime.combine(due.date() + timedelta(days=7), due.time(), tzinfo=CHICAGO)
    end = time.monotonic() + FIRE_DELAY_S
    while time.monotonic() < end:
        assert search(d.c, f"Weekly fire {tag}")["total"] == 1
        breathe()
    assert d.c.delete(f"/api/scheduled/{s['id']}").status_code == 200


def test_scheduled_post_fires_once(app_url: str, mail: Any) -> None:
    d = fresh(app_url, mail, "dispatcher", ["install-team"])
    d2 = fresh(app_url, mail, "dispatcher", ["install-team"])
    lead = fresh(app_url, mail, "crew_lead", ["install-team"])
    tech = fresh(app_url, mail, "field_technician", ["install-team"])
    cid = channel_id(d.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    due = (server_now(app_url) + timedelta(seconds=SCHEDULE_LEAD_S)).astimezone(CHICAGO).replace(microsecond=0)
    s = schedule(d.c, cid, f"One-off {tag}", due.date(), f"{due:%H:%M:%S}").json()["scheduled"]
    assert search(d.c, f"One-off {tag}")["total"] == 0
    done = poll(lambda: (lambda x: x if x["state"] == "sent" else None)(scheduled(d.c, cid, s["id"])), SCHEDULE_LEAD_S + FIRE_DELAY_S + HEALTH_S, "one-off sent")
    assert done["fired_count"] == 1 and done["upcoming_local"] == []
    msg = d.c.get(f"/api/messages/{done['last_message_id']}").json()["message"]
    assert msg["text"] == f"One-off {tag}" and msg["author"]["id"] == d.id
    assert timedelta(0) <= iso(msg["sent_at"]) - due <= timedelta(seconds=FIRE_DELAY_S)
    end = time.monotonic() + FIRE_DELAY_S
    while time.monotonic() < end:
        assert search(d.c, f"One-off {tag}")["total"] == 1
        breathe()
    assert_error(d.c.delete(f"/api/scheduled/{s['id']}"), 409, "schedule_not_pending")
    later = (due + timedelta(days=2)).date()
    p = schedule(d.c, cid, f"Cancel me {tag}", later, "06:30").json()["scheduled"]
    assert_error(lead.c.delete(f"/api/scheduled/{p['id']}"), 403, "forbidden")
    assert_error(tech.c.delete(f"/api/scheduled/{p['id']}"), 403, "forbidden")
    r = d2.c.delete(f"/api/scheduled/{p['id']}")
    assert r.status_code == 200 and r.json()["scheduled"]["state"] == "cancelled" and r.json()["scheduled"]["upcoming_local"] == []
    assert_error(d.c.delete(f"/api/scheduled/{p['id']}"), 409, "schedule_not_pending")


def test_wf_start_of_shift_schedule_happy(app_url: str, mail: Any, browser: Browser) -> None:
    dana = fresh(app_url, mail, "dispatcher", ["shift-bulletins"])
    host = host_now(app_url)
    change = transitions(CHICAGO, host + timedelta(days=10))[0][0]
    monday = change - timedelta(days=(change.weekday() % 7) or 7)
    clock = datetime.combine(monday - timedelta(days=2), dtime(12), tzinfo=CHICAGO)
    offset = int((clock - host).total_seconds())
    occurrences = [datetime.combine(monday + timedelta(days=7 * i), dtime(6, 30), tzinfo=CHICAGO) for i in range(3)]
    tag = uuid.uuid4().hex[:8]
    with serve_copy(APP_CLOCK_OFFSET_SECONDS=offset) as copy:
        dc = dana.on(copy)
        cid = channel_id(dc, "shift-bulletins")
        with shell(browser, copy, dc, f"/c/{cid}") as page:
            browser_zone(page, BROWSER_ZONE)
            page.reload()
            soon(lambda: see(page.get_by_role("button", name="Schedule post")), page)
            click(page.get_by_role("button", name="Schedule post"))
            dialog = page.get_by_role("dialog", name="Schedule post")
            fill(dialog.get_by_role("textbox", name="Post text"), f"Start of shift {tag}")
            fill(dialog.get_by_label("Date"), monday.isoformat())
            fill(dialog.get_by_label("Time"), "06:30")
            check(dialog.get_by_role("checkbox", name="Repeat weekly"))
            see(dialog.get_by_text(f"Times are in {CHICAGO_NAME}"))
            click(dialog.get_by_role("button", name="Schedule"))
            soon(lambda: expect(notices(page)).to_contain_text(f"Scheduled for {when(occurrences[0], CHICAGO)}.", timeout=POLL_MS), page)
            click(page.get_by_role("button", name="Scheduled posts"))
            item = details(page).get_by_role("list", name="Scheduled posts").get_by_role("listitem").filter(has_text=tag)
            soon(lambda: see(item), page)
            see(item.get_by_text("Scheduled", exact=True))
            expect(item.get_by_role("list", name="Upcoming").get_by_role("listitem")).to_have_text([when(o, CHICAGO) for o in occurrences])
        posts = [s for s in dc.get(f"/api/channels/{cid}/scheduled").json()["scheduled"] if tag in s["text"]]
        assert len(posts) == 1 and posts[0]["repeat"] == "weekly"
        assert [datetime.fromisoformat(x) for x in posts[0]["upcoming_local"]] == occurrences
        assert iso(posts[0]["next_fire_at"]) == occurrences[0]
        assert dc.delete(f"/api/scheduled/{posts[0]['id']}").status_code == 200


def test_wf_start_of_shift_schedule_past_time(app_url: str, mail: Any, browser: Browser) -> None:
    dana = fresh(app_url, mail, "dispatcher", ["shift-bulletins"])
    cid = channel_id(dana.c, "shift-bulletins")
    past = (server_now(app_url) - timedelta(hours=2)).astimezone(CHICAGO)
    tag = uuid.uuid4().hex[:8]
    with shell(browser, app_url, dana.c, f"/c/{cid}") as page:
        soon(lambda: see(page.get_by_role("button", name="Schedule post")), page)
        click(page.get_by_role("button", name="Schedule post"))
        dialog = page.get_by_role("dialog", name="Schedule post")
        fill(dialog.get_by_role("textbox", name="Post text"), f"Too late {tag}")
        fill(dialog.get_by_label("Date"), past.date().isoformat())
        fill(dialog.get_by_label("Time"), f"{past:%H:%M}")
        click(dialog.get_by_role("button", name="Schedule"))
        soon(lambda: see(dialog.get_by_role("heading", name="Check the highlighted fields.")), page)
        see(dialog.get_by_role("link", name=passed_in(CHICAGO_NAME)))
    assert not [s for s in dana.c.get(f"/api/channels/{cid}/scheduled").json()["scheduled"] if tag in s["text"]]


def test_delete_removes_everywhere(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    r_ = fresh(app_url, mail, "field_technician", ["site-store-114"])
    p = fresh(app_url, mail, "crew_lead", ["site-store-114"])
    q = fresh(app_url, mail, "crew_lead", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    unpin_all(p.c, cid)
    ws = t.c.get("/api/me").json()["workspace"]["id"]
    tag = uuid.uuid4().hex[:8]
    stream = Stream(app_url, r_.c)
    pm = send_photos(t.c, cid, f"Receipt {tag}", [(f"{tag}_receipt.jpg", photo(), "image/jpeg")]).json()["message"]
    att = pm["attachments"][0]
    qm = post(r_.c, cid, "Wrong channel?", quoted_message_id=pm["id"])
    u = unread(r_.c, "site-store-114")
    assert_error(r_.c.delete(f"/api/messages/{pm['id']}"), 403, "forbidden")
    results = together([lambda c=c: clone(c).delete(f"/api/messages/{pm['id']}") for c in (p.c, q.c, t.c)])
    assert sorted(x.status_code for x in results) == [204, 404, 404]
    for x in results:
        if x.status_code == 404:
            assert_error(x, 404, "not_found")
    for path in (f"/api/messages/{pm['id']}", att["url"], att["thumb_url"], f"/api/messages/{pm['id']}/receipts", f"/api/messages/{pm['id']}/versions"):
        assert_error(r_.c.get(path), 404, "not_found")
    assert att["id"] not in {g["attachment_id"] for g in r_.c.get(f"/api/channels/{cid}/gallery", params={"limit": PAGE_CAP}).json()["photos"]}
    assert search(r_.c, f"Receipt {tag}")["total"] == 0 and search(r_.c, f"{tag}_receipt")["total"] == 0
    quote = r_.c.get(f"/api/messages/{qm['id']}").json()["message"]["quote"]
    assert quote["message_id"] == pm["id"] and quote["deleted"] is True
    assert unread(r_.c, "site-store-114") == u - 1
    assert kit.S3().keys(f"attachments/{ws}/{pm['id']}/") == []
    sentinel = post(t.c, cid, f"Sentinel {tag}")
    stream.wait(lambda e: e["event"] == "message.created" and about(e, sentinel["id"]), EVENT_DELAY_S + EVENT_SLACK_S, "sentinel")
    assert len(stream.matching(lambda e: e["event"] == "message.deleted" and e["data"]["message_id"] == pm["id"])) == 1
    stream.close()

    root = post(t.c, cid, f"Root with reply {tag}")
    post(r_.c, cid, "Reply", thread_root_id=root["id"])
    lonely = post(t.c, cid, f"Root alone {tag}")
    assert t.c.delete(f"/api/messages/{root['id']}").status_code == 204
    assert t.c.delete(f"/api/messages/{lonely['id']}").status_code == 204
    holder = history_entry(r_.c, cid, root["id"])
    assert holder is not None and holder["deleted"] is True and holder["reply_count"] == 1 and "text" not in holder
    assert history_entry(r_.c, cid, lonely["id"]) is None
    thread = r_.c.get(f"/api/messages/{root['id']}/thread").json()
    assert thread["root"]["deleted"] is True and len(thread["replies"]) == 1

    m = post(t.c, cid, "Race edit")
    d_, e_ = together([lambda: clone(p.c).delete(f"/api/messages/{m['id']}"), lambda: edit(clone(t.c), m["id"], "edited", 1)])
    assert d_.status_code == 204 and e_.status_code in (200, 404)
    assert t.c.get(f"/api/messages/{m['id']}/versions").status_code == 404
    m = post(t.c, cid, "Race pin")
    d_, pin = together([lambda: clone(p.c).delete(f"/api/messages/{m['id']}"), lambda: clone(q.c).post(f"/api/channels/{cid}/pins", json={"message_id": m["id"]})])
    assert d_.status_code == 204 and pin.status_code in (201, 404)
    assert m["id"] not in t.c.get(f"/api/channels/{cid}").json()["channel"]["pinned_message_ids"]
    m = post(t.c, cid, "Race root")
    d_, rep = together([lambda: clone(p.c).delete(f"/api/messages/{m['id']}"), lambda: send(clone(r_.c), cid, "racing reply", thread_root_id=m["id"])])
    assert d_.status_code == 204 and rep.status_code in (201, 422)
    placeholder = history_entry(t.c, cid, m["id"])
    if rep.status_code == 201:
        assert placeholder is not None and placeholder["deleted"] is True and placeholder["reply_count"] == 1
    else:
        assert_error(rep, 422, "validation", "thread_root_id", COPY["thread_root_id"])
        assert placeholder is None
    m = post(t.c, cid, "Race quote")
    d_, qt = together([lambda: clone(p.c).delete(f"/api/messages/{m['id']}"), lambda: send(clone(r_.c), cid, "racing quote", quoted_message_id=m["id"])])
    assert d_.status_code == 204 and qt.status_code in (201, 422)
    if qt.status_code == 201:
        raced = r_.c.get(f"/api/messages/{qt.json()['message']['id']}").json()["message"]["quote"]
        assert raced["message_id"] == m["id"] and raced["deleted"] is True
    else:
        assert_error(qt, 422, "validation", "quoted_message_id", COPY["quoted_message_id"])


def test_delete_during_storage_outage_and_restart(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    lead = fresh(app_url, mail, "crew_lead", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    ws = t.c.get("/api/me").json()["workspace"]["id"]
    pm = send_photos(t.c, cid, "Mis-posted", [("receipt.jpg", photo(), "image/jpeg")]).json()["message"]
    att = pm["attachments"][0]
    prefix = f"attachments/{ws}/{pm['id']}/"
    s3 = kit.S3()
    assert len(s3.keys(prefix)) == 2
    relay = storage_relay()
    try:
        with serve_copy(S3_ENDPOINT=f"http://127.0.0.1:{relay.port}") as copy:
            lc = lead.on(copy)
            started = time.monotonic()
            assert lc.delete(f"/api/messages/{pm['id']}").status_code == 204
            assert time.monotonic() - started < OUTAGE_DELETE_S
            assert_error(lc.get(att["url"]), 404, "not_found")
            assert_error(lc.get(att["thumb_url"]), 404, "not_found")
        assert_error(t.c.get(att["url"]), 404, "not_found")
        relay.open()
        with serve_copy(S3_ENDPOINT=f"http://127.0.0.1:{relay.port}"):
            poll(lambda: s3.keys(prefix) == [], QUEUE_CLEAR_S + QUEUE_RETRY_S, "queued objects removed")
    finally:
        relay.close()


def test_channel_gallery(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    first = send_photos(t.c, cid, "", [("one.jpg", photo(), "image/jpeg"), ("two.jpg", photo(400, 800), "image/jpeg")]).json()["message"]
    second = send_photos(t.c, cid, "", [("three.jpg", photo(), "image/jpeg")]).json()["message"]
    mine = {a["id"] for a in first["attachments"] + second["attachments"]}
    seen: list[dict] = []
    cursor = None
    for _ in range(HISTORY_PAGES):
        params: dict[str, Any] = {"limit": 1}
        if cursor:
            params["before"] = cursor
        body = t.c.get(f"/api/channels/{cid}/gallery", params=params).json()
        assert len(body["photos"]) <= 1
        seen += body["photos"]
        cursor = body["next_cursor"]
        if not cursor or mine <= {p["attachment_id"] for p in seen}:
            break
    ids = [p["attachment_id"] for p in seen]
    assert len(ids) == len(set(ids))
    rows = [p for p in seen if p["attachment_id"] in mine]
    assert len(rows) == 3
    assert [p["attachment_id"] for p in rows] == [p["attachment_id"] for p in sorted(rows, key=lambda p: (iso(p["uploaded_at"]), p["attachment_id"].lower()), reverse=True)]
    assert rows[0]["message_id"] == second["id"]
    for p in rows:
        assert p["uploaded_by"]["id"] == t.id and p["uploaded_by"]["name"] == t.name and p["content_type"] == "image/jpeg"
        thumb = t.c.get(p["thumb_url"])
        assert thumb.status_code == 200 and thumb.headers["content-type"].startswith("image/jpeg")
    assert_error(signin(app_url, SEED["sam"]).get(f"/api/channels/{cid}/gallery"), 404, "not_found")


def test_wf_photo_removal_happy(app_url: str, mail: Any, browser: Browser) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    leads = [fresh(app_url, mail, "crew_lead", ["site-store-114"]) for _ in range(2)]
    cid = channel_id(t.c, "site-store-114")
    ws = t.c.get("/api/me").json()["workspace"]["id"]
    tag = uuid.uuid4().hex[:8]
    pm = send_photos(t.c, cid, f"Customer receipt {tag}", [(f"{tag}_receipt.jpg", photo(), "image/jpeg")]).json()["message"]
    att = pm["attachments"][0]
    relay = storage_relay()
    try:
        with serve_copy(S3_ENDPOINT=f"http://127.0.0.1:{relay.port}") as copy:
            clients = [lead.on(copy) for lead in leads]
            with shell(browser, copy, clients[0], f"/c/{cid}") as p1, shell(browser, copy, clients[1], f"/c/{cid}") as p2:
                for page in (p1, p2):
                    soon(lambda page=page: see(article(page, tag)), page)
                    listen(page, "Notices")
                    choose(page, article(page, tag), "Delete")
                    soon(lambda page=page: see(page.get_by_role("dialog", name="Delete this message?")), page)
                with held(p1, "**/api/messages/*") as g1, held(p2, "**/api/messages/*") as g2:
                    click(p1.get_by_role("dialog", name="Delete this message?").get_by_role("button", name="Delete for everyone"))
                    click(p2.get_by_role("dialog", name="Delete this message?").get_by_role("button", name="Delete for everyone"))
                    g1.release()
                    g2.release()
                for page in (p1, p2):
                    soon(lambda page=page: assert_said_any(page, ["Message deleted.", ERR["not_found"]]), page)
                outcomes = sorted("deleted" if any("Message deleted." in s for s in said(page, "Notices")) else "not found" for page in (p1, p2))
                assert outcomes == ["deleted", "not found"]
                for page in (p1, p2):
                    soon(lambda page=page: expect(article(page, tag)).to_have_count(0, timeout=POLL_MS), page)
            assert_error(clients[0].get(att["url"]), 404, "not_found")
        assert search(t.c, f"Customer receipt {tag}")["total"] == 0
        assert att["id"] not in {g["attachment_id"] for g in t.c.get(f"/api/channels/{cid}/gallery", params={"limit": PAGE_CAP}).json()["photos"]}
        relay.open()
        poll(lambda: kit.S3().keys(f"attachments/{ws}/{pm['id']}/") == [], QUEUE_CLEAR_S + QUEUE_RETRY_S, "objects removed after storage returns")
    finally:
        relay.close()


def test_wf_photo_removal_storage_up(app_url: str, mail: Any, browser: Browser) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    lead = fresh(app_url, mail, "crew_lead", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    ws = t.c.get("/api/me").json()["workspace"]["id"]
    tag = uuid.uuid4().hex[:8]
    pm = send_photos(t.c, cid, f"Wrong job {tag}", [(f"{tag}.jpg", photo(), "image/jpeg")]).json()["message"]
    with shell(browser, app_url, lead.c, f"/c/{cid}") as page:
        soon(lambda: see(page.get_by_role("button", name="Photos", exact=True)), page)
        click(page.get_by_role("button", name="Photos", exact=True))
        link = details(page).get_by_role("link", name=f"Photo {tag}.jpg by {t.name}")
        soon(lambda: see(link), page)
        choose(page, article(page, tag), "Delete")
        click(page.get_by_role("dialog", name="Delete this message?").get_by_role("button", name="Delete for everyone"))
        soon(lambda: expect(notices(page)).to_contain_text("Message deleted.", timeout=POLL_MS), page)
        soon(lambda: expect(link).to_have_count(0, timeout=POLL_MS), page)
    assert_error(t.c.get(pm["attachments"][0]["url"]), 404, "not_found")
    assert kit.S3().keys(f"attachments/{ws}/{pm['id']}/") == []


def test_search_literal_scope(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114", "install-team"])
    cid = channel_id(t.c, "site-store-114")
    install = channel_id(t.c, "install-team")
    tag = uuid.uuid4().hex[:8]
    a = post(t.c, cid, f"Walk-in {tag} part 4_1Z")
    post(t.c, cid, f"Walk-in {tag} part 401Z")
    post(t.c, cid, f"{tag} 8% charge")
    post(t.c, cid, f"{tag} 80 charge")
    post(t.c, cid, f"{tag} back\\slash")
    jo = signin(app_url, SEED["jo"])
    lee = signin(app_url, SEED["lee"])

    def timed(c: httpx.Client, q: str) -> dict:
        started = time.monotonic()
        body = search(c, q)
        assert time.monotonic() - started < SEARCH_BUDGET_S
        return body

    assert timed(jo, f"{tag} 4_1")["total"] == 1
    assert timed(jo, f"{tag} 8%")["total"] == 1
    assert timed(jo, f"{tag} back\\")["total"] == 1
    assert timed(jo, f"{tag.upper()} WALK-IN")["total"] == 2
    assert timed(jo, f"{tag} walk-in 401z")["total"] == 1
    assert timed(jo, f"{tag} {tag} 4_1")["total"] == 1
    row = timed(jo, f"{tag} 4_1")["results"][0]
    assert row["kind"] == "message" and row["message_id"] == a["id"]
    assert row["channel"]["id"] == cid and row["channel"]["name"] == "site-store-114"
    assert row["author_name"] == t.name and row["thread_root_id"] is None
    edit(t.c, a["id"], f"Walk-in {tag} part 9_9Z", 1)
    assert timed(jo, f"{tag} 4_1")["total"] == 0 and timed(jo, f"{tag} 9_9")["total"] == 1
    pic = send_photos(t.c, cid, "", [(f"{tag}_nameplate.jpg", photo(), "image/jpeg")]).json()["message"]
    prow = timed(jo, f"{tag}_nameplate")
    assert prow["total"] == 1 and prow["results"][0]["kind"] == "photo" and prow["results"][0]["attachment_id"] == pic["attachments"][0]["id"]
    post(t.c, cid, f"{tag} " + "evaporator " * 40)
    assert len(timed(jo, f"{tag} evaporator")["results"][0]["snippet"]) <= SNIPPET_MAX
    assert timed(signin(app_url, SEED["sam"]), f"{tag} walk-in")["total"] == 0
    post(lee, channel_id(lee, "halvard-crew"), f"Walk-in {tag} halvard")
    assert timed(jo, f"{tag} walk-in")["total"] == 2
    assert timed(lee, f"{tag} walk-in")["total"] == 1
    post(t.c, install, f"{tag} install only")
    assert timed(t.c, f"{tag} install")["total"] == 1
    assert jo.delete(f"/api/channels/{install}/members/{t.id}").status_code == 204
    assert timed(t.c, f"{tag} install")["total"] == 0

    def refused(q: str, copy: str) -> None:
        assert_error(jo.get("/api/search", params={"q": q}), 422, "validation", "q", copy)

    refused(" a ", COPY["q_short"])
    refused("x" * (Q_MAX + 1), COPY["q_long"])
    refused(" ".join(["w"] * (Q_WORDS + 1)), COPY["q_words"])
    refused(" ".join(["ww"] * (Q_MAX // 2)), COPY["q_long"])
    assert timed(jo, "x" * Q_MAX)["total"] == 0
    assert timed(jo, " ".join([tag] * Q_WORDS))["total"] >= 1
    assert timed(jo, "%_\\" * (Q_MAX // 3))["total"] == 0


def test_shell_url_state(app_url: str, mail: Any, browser: Browser) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    tag = uuid.uuid4().hex[:8]
    root = post(t.c, cid, f"Store 114 walk-in {tag} compressor")
    post(t.c, cid, f"{tag} reply in thread", thread_root_id=root["id"])
    jo = signin(app_url, SEED["jo"])
    crew = channel_id(jo, "crew-main")
    halvard = channel_id(signin(app_url, SEED["lee"]), "halvard-crew")
    with shell(browser, app_url, jo, f"/c/{crew}") as page:
        box = page.get_by_role("searchbox", name="Search messages")
        soon(lambda: see(box), page)
        fill(box, tag)
        box.press("Enter")
        soon(lambda: see(details(page).get_by_role("heading", level=2, name="Search results")), page)
        assert urlparse(page.url).path == f"/c/{crew}" and parse_qs(urlparse(page.url).query)["q"] == [tag]
        soon(lambda: expect(notices(page)).to_contain_text(f"2 results for “{tag}”.", timeout=POLL_MS), page)
        click(details(page).get_by_text(f"{tag} reply in thread"))
        soon(lambda: see(details(page).get_by_role("heading", level=2, name="Thread")), page)
        assert urlparse(page.url).path == f"/c/{cid}" and parse_qs(urlparse(page.url).query)["thread"] == [root["id"]]
        page.go_back()
        soon(lambda: see(details(page).get_by_role("heading", level=2, name="Search results")), page)
        soon(lambda: see(details(page).get_by_text(f"{tag} reply in thread")), page)
        see(details(page).get_by_text(f"Store 114 walk-in {tag} compressor"))
        page.reload()
        soon(lambda: see(details(page).get_by_role("heading", level=2, name="Search results")), page)
        soon(lambda: see(details(page).get_by_text(f"{tag} reply in thread")), page)
        page.goto(f"{app_url}/c/{cid}?q=a")
        soon(lambda: see(page.get_by_text(COPY["q_short"])), page)
        expect(page.get_by_role("searchbox", name="Search messages")).to_have_value("a")
        expect(details(page)).to_have_count(0)
        for foreign in (halvard, str(uuid.uuid4())):
            page.goto(f"{app_url}/c/{foreign}")
            soon(lambda: expect(notices(page)).to_contain_text(ERR["not_found"], timeout=POLL_MS), page)
            expect(page.get_by_role("region", name="Messages").get_by_role("article")).to_have_count(0)
        page.goto(f"{app_url}/c/{cid}?thread={uuid.uuid4()}")
        soon(lambda: see(details(page).get_by_text(ERR["not_found"])), page)
    with open_app(browser, f"{app_url}/c/{cid}?thread={root['id']}") as page:
        soon(lambda: see(page.get_by_role("heading", level=1, name="Rimewire")), page)
        fill(page.get_by_label("Email"), SEED["jo"])
        fill(page.get_by_label("Password"), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        soon(lambda: see(details(page).get_by_role("heading", level=2, name="Thread")), page)
        assert parse_qs(urlparse(page.url).query)["thread"] == [root["id"]]


def test_wf_site_search_happy(app_url: str, mail: Any, browser: Browser) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    tag = uuid.uuid4().hex[:8]
    m = post(t.c, cid, f"Store 114 walk-in {tag} WIC-2 iced")
    lee = signin(app_url, SEED["lee"])
    post(lee, channel_id(lee, "halvard-crew"), f"Store 114 walk-in {tag} halvard")
    jo = signin(app_url, SEED["jo"])
    query = f"Store 114 walk-in {tag}"
    with shell(browser, app_url, jo, f"/c/{channel_id(jo, 'crew-main')}") as page:
        box = page.get_by_role("searchbox", name="Search messages")
        soon(lambda: see(box), page)
        fill(box, query)
        box.press("Enter")
        soon(lambda: expect(notices(page)).to_contain_text(f"1 result for “{query}”.", timeout=POLL_MS), page)
        expect(details(page).get_by_text(f"{tag} halvard")).to_have_count(0)
        click(details(page).get_by_text(f"{tag} WIC-2 iced", exact=False))
        soon(lambda: expect(page.get_by_role("heading", level=1, name="site-store-114")).to_be_visible(timeout=POLL_MS), page)
        soon(lambda: expect(article(page, f"{tag} WIC-2")).to_be_focused(timeout=POLL_MS), page)
        page.go_back()
        soon(lambda: see(details(page).get_by_text(f"{tag} WIC-2 iced", exact=False)), page)
        page.reload()
        soon(lambda: see(details(page).get_by_text(f"{tag} WIC-2 iced", exact=False)), page)
        assert parse_qs(urlparse(page.url).query)["q"] == [query]
    hits = search(jo, query)
    assert hits["total"] == 1 and hits["results"][0]["message_id"] == m["id"]


def test_wf_site_search_foreign_link(app_url: str, mail: Any, browser: Browser) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    cid = channel_id(t.c, "site-store-114")
    tag = uuid.uuid4().hex[:8]
    post(t.c, cid, f"TXV {tag}4_1 fitted")
    post(t.c, cid, f"TXV {tag}401 spare")
    jo = signin(app_url, SEED["jo"])
    halvard = channel_id(signin(app_url, SEED["lee"]), "halvard-crew")
    with shell(browser, app_url, jo, f"/c/{cid}") as page:
        box = page.get_by_role("searchbox", name="Search messages")
        soon(lambda: see(box), page)
        fill(box, f"{tag}4_1")
        box.press("Enter")
        soon(lambda: expect(notices(page)).to_contain_text(f"1 result for “{tag}4_1”.", timeout=POLL_MS), page)
        expect(details(page).get_by_text(f"{tag}401 spare", exact=False)).to_have_count(0)
        page.goto(f"{app_url}/c/{halvard}")
        soon(lambda: see(page.get_by_text(ERR["not_found"]).first), page)
        expect(page.get_by_text("Store 114 walk-in door heater")).to_have_count(0)
    assert search(jo, f"{tag}4_1")["total"] == 1


def test_channel_membership_manage(app_url: str, mail: Any) -> None:
    jo = signin(app_url, SEED["jo"])
    dana = signin(app_url, SEED["dana"])
    p = fresh(app_url, mail, "field_technician")
    cid = channel_id(jo, "install-team")
    r = add_member(jo, cid, p.id)
    assert r.status_code == 201 and r.json()["member"]["user"]["id"] == p.id and r.json()["member"]["joined_at"]
    assert p.c.get(f"/api/channels/{cid}/messages").status_code == 200
    dup = assert_error(add_member(jo, cid, p.id), 409, "already_member")
    assert dup["message"] == f"{p.name} is already in this channel."
    other = fresh(app_url, mail, "field_technician")
    assert_error(add_member(dana, cid, other.id), 403, "forbidden")
    assert_error(add_member(jo, cid, str(uuid.uuid4())), 404, "not_found")
    assert_error(add_member(jo, cid, "nobody"), 422, "validation", "user_id", COPY["user_id"])
    inactive = fresh(app_url, mail, "field_technician")
    assert jo.delete(f"/api/workspace/members/{inactive.id}").status_code == 200
    assert_error(add_member(jo, cid, inactive.id), 404, "not_found")
    assert_error(add_member(signin(app_url, SEED["lee"]), cid, other.id), 404, "not_found")
    assert_error(dana.delete(f"/api/channels/{cid}/members/{p.id}"), 403, "forbidden")
    assert jo.delete(f"/api/channels/{cid}/members/{p.id}").status_code == 204
    assert_error(jo.delete(f"/api/channels/{cid}/members/{p.id}"), 404, "not_found")
    ids = {m["user"]["id"] for m in jo.get(f"/api/channels/{cid}").json()["members"]}
    assert p.id not in ids and other.id not in ids and inactive.id not in ids


def test_removal_applies_next_request(app_url: str, mail: Any) -> None:
    s = fresh(app_url, mail, "field_technician", ["weekend-emergency", "crew-main"])
    d = fresh(app_url, mail, "dispatcher", ["weekend-emergency", "crew-main"])
    jo = signin(app_url, SEED["jo"])
    cid = channel_id(jo, "weekend-emergency")
    crew = channel_id(jo, "crew-main")
    wait = EVENT_DELAY_S + EVENT_SLACK_S
    stream = Stream(app_url, s.c)
    m0 = post(d.c, cid, "Before removal")
    pic = send_photos(d.c, cid, "Gate photo", [("gate.jpg", photo(), "image/jpeg")]).json()["message"]["attachments"][0]
    assert s.c.get(pic["url"]).status_code == 200
    e0 = stream.wait(lambda e: e["event"] == "message.created" and about(e, m0["id"]), wait, "pre-removal event")["id"]
    joined = {m["user"]["id"]: m["joined_at"] for m in jo.get(f"/api/channels/{cid}").json()["members"]}[s.id]
    assert jo.delete(f"/api/channels/{cid}/members/{s.id}").status_code == 204
    for path in (f"/api/channels/{cid}/messages", f"/api/channels/{cid}", f"/api/channels/{cid}/gallery", f"/api/messages/{m0['id']}", pic["url"], pic["thumb_url"]):
        assert_error(s.c.get(path), 404, "not_found")
    assert_error(send(s.c, cid, "still here?"), 404, "not_found")
    assert cid not in {c["id"] for c in s.c.get("/api/channels").json()["channels"]}
    revoked = stream.wait(lambda e: e["event"] == "channel.revoked" and e["data"]["channel_id"] == cid, wait, "channel.revoked")
    post(d.c, cid, "After removal")
    edit(d.c, m0["id"], "Edited after removal", 1)
    mx = post(d.c, crew, "Elsewhere")
    stream.wait(lambda e: about(e, mx["id"]), wait, "unrelated event")
    assert not stream.matching(lambda e: e["id"] is not None and e["id"] > revoked["id"] and in_channel(e, cid))
    stream.close()
    resumed = Stream(app_url, s.c, e0)
    resumed.wait(lambda e: about(e, mx["id"]), wait, "replayed unrelated event")
    assert len(resumed.matching(lambda e: e["event"] == "channel.revoked" and e["data"]["channel_id"] == cid)) == 1
    assert not resumed.matching(lambda e: e["event"] != "channel.revoked" and in_channel(e, cid))
    assert add_member(jo, cid, s.id).status_code == 201
    resumed.wait(lambda e: e["event"] == "channel.added" and e["data"]["channel"]["id"] == cid, wait, "channel.added")
    resumed.close()
    rejoined = {m["user"]["id"]: m["joined_at"] for m in jo.get(f"/api/channels/{cid}").json()["members"]}[s.id]
    assert iso(rejoined) > iso(joined)


def test_email_projection(app_url: str, mail: Any) -> None:
    sam = signin(app_url, SEED["sam"])
    dana = signin(app_url, SEED["dana"])
    crew = channel_id(sam, "crew-main")
    for viewer in (sam, dana):
        own = me(viewer)["id"]
        for m in viewer.get(f"/api/channels/{crew}").json()["members"]:
            assert ("email" in m["user"]) == (m["user"]["id"] == own)
        for u in viewer.get("/api/workspace/members").json()["members"]:
            assert ("email" in u) == (u["id"] == own)
    assert sam.get("/api/workspace/members", params={"q": "dana@"}).json()["members"] == []
    jo = signin(app_url, SEED["jo"])
    assert all("email" in m["user"] for m in jo.get(f"/api/channels/{crew}").json()["members"])
    assert [u["email"] for u in jo.get("/api/workspace/members", params={"q": "dana@"}).json()["members"]] == [SEED["dana"]]
    assert me(sam)["email"] == SEED["sam"]
    t = fresh(app_url, mail, "field_technician", ["crew-main"])
    stream = Stream(app_url, t.c)
    p = fresh(app_url, mail, "field_technician")
    r = add_member(jo, crew, p.id)
    assert r.json()["member"]["user"]["email"] == p.email
    m = post(dana, crew, "Projection check")
    stream.wait(lambda e: about(e, m["id"]), EVENT_DELAY_S + EVENT_SLACK_S, "message event")
    blob = json.dumps([e["data"] for e in stream.events])
    for address in (p.email, SEED["dana"], SEED["jo"]):
        assert address not in blob
    stream.close()


def test_wf_channel_offboarding_happy(app_url: str, mail: Any, browser: Browser) -> None:
    sam = fresh(app_url, mail, "field_technician", ["weekend-emergency", "crew-main"])
    jo = signin(app_url, SEED["jo"])
    cid = channel_id(jo, "weekend-emergency")
    with shell(browser, app_url, sam.c, f"/c/{cid}") as spage, shell(browser, app_url, jo, f"/c/{cid}") as jpage:
        rail = spage.get_by_role("navigation", name="Channels")
        soon(lambda: see(rail.get_by_role("link", name=re.compile(r"^weekend-emergency"))), spage)
        soon(lambda: see(jpage.get_by_role("button", name="Members")), jpage)
        click(jpage.get_by_role("button", name="Members"))
        dialog = jpage.get_by_role("dialog", name=members_of("weekend-emergency"))
        click(dialog.get_by_role("button", name=f"Remove {sam.name}"))
        soon(lambda: expect(notices(jpage)).to_contain_text(f"{sam.name} removed from #weekend-emergency.", timeout=POLL_MS), jpage)
        soon(lambda: see(spage.get_by_text(lost_access("weekend-emergency")).first), spage)
        soon(lambda: expect(rail.get_by_role("link", name=re.compile(r"^weekend-emergency"))).to_have_count(0, timeout=POLL_MS), spage)
        assert_error(sam.c.get(f"/api/channels/{cid}/messages"), 404, "not_found")
        select(dialog.get_by_role("combobox", name="Add a person"), f"{sam.name} ({sam.email})")
        click(dialog.get_by_role("button", name="Add to channel"))
        soon(lambda: see(rail.get_by_role("link", name=re.compile(r"^weekend-emergency"))), spage)
    assert sam.c.get(f"/api/channels/{cid}/messages").status_code == 200


def test_wf_channel_offboarding_member_list(app_url: str, browser: Browser) -> None:
    sam = signin(app_url, SEED["sam"])
    crew = channel_id(sam, "crew-main")
    with shell(browser, app_url, sam, f"/c/{crew}") as page:
        soon(lambda: see(page.get_by_role("button", name="Members")), page)
        click(page.get_by_role("button", name="Members"))
        items = page.get_by_role("dialog", name=members_of("crew-main")).get_by_role("list", name="Current members")
        soon(lambda: see(items.get_by_text(at_handle("dana"))), page)
        see(items.get_by_text("Dana Okafor"))
        expect(items.get_by_text(SEED["dana"])).to_have_count(0)
        expect(items.get_by_text(SEED["jo"])).to_have_count(0)
    with shell(browser, app_url, signin(app_url, SEED["jo"]), f"/c/{crew}") as page:
        soon(lambda: see(page.get_by_role("button", name="Members")), page)
        click(page.get_by_role("button", name="Members"))
        items = page.get_by_role("dialog", name=members_of("crew-main")).get_by_role("list", name="Current members")
        soon(lambda: see(items.get_by_text(SEED["dana"])), page)


def test_morning_digest(app_url: str, mail: Any) -> None:
    j = fresh(app_url, mail, "field_technician", ["crew-main", "weekend-emergency", "install-team"])
    a = fresh(app_url, mail, "crew_lead", ["crew-main", "weekend-emergency", "install-team"])
    target, offset = digest_offset(host_now(app_url), CHICAGO, 1)
    tag = uuid.uuid4().hex[:8]
    mk = {k: f"{tag}{k}" for k in "abcdefghijk"}
    with serve_copy(APP_CLOCK_OFFSET_SECONDS=offset, MENTION_UNANSWERED_SECONDS=MENTION_AGE_S, DIGEST_INTERVAL_SECONDS=None) as copy:
        jc, ac, jo = j.on(copy), a.on(copy), signin(copy, SEED["jo"])
        crew, wkd, inst = (channel_id(ac, n) for n in ("crew-main", "weekend-emergency", "install-team"))
        h = j.handle
        m1 = post(ac, crew, f"@{h}, check RTU-3 {mk['a']}")
        m8 = post(ac, wkd, f"@{h} gate code {SECRET_GATE} {mk['h']}")
        post(ac, inst, f"@{h} install {mk['i']}")
        assert jo.delete(f"/api/channels/{inst}/members/{j.id}").status_code == 204
        assert jc.get("/api/me").status_code == 200
        edit(ac, m1["id"], f"@{h}, check RTU-4 {mk['a']}", 1)
        assert server_now(copy) < target - timedelta(seconds=MENTION_AGE_S), "setup overran 07:00"
        found = mail_to(mail, j.email, subject="Rimewire:", seconds=DIGEST_LEAD_S + DIGEST_DELAY_S + MAIL_WAIT_S)
        assert len(found) == 1
        assert len(mail_to(mail, j.email, subject="Rimewire:", count=2, seconds=DIGEST_DELAY_S)) == 1
        m = found[0]
        assert target <= mail_date(m) <= target + timedelta(seconds=DIGEST_DELAY_S)
        assert m["Subject"] == f"Rimewire: 2 unanswered mentions for {business_date(target.date())}"
        lines = digest_lines(m)
        assert len(lines) == 2, lines
        prefix = f"#crew-main · {a.name} · {when(iso(m1['sent_at']), CHICAGO)}"
        assert any(line.startswith(prefix) for line in lines), (prefix, lines)
        assert f"#weekend-emergency · {a.name} · {when(iso(m8['sent_at']), CHICAGO)} — private channel, open Rimewire to read it." in lines
        body = kit.text(m)
        assert f"check RTU-4 {mk['a']}" in body and "RTU-3" not in body
        assert SECRET_GATE not in body and mk["h"] not in body
        assert mk["i"] not in body
        assert f"{copy}/" in body


def test_mention_answers_derived(app_url: str, mail: Any) -> None:
    j = fresh(app_url, mail, "field_technician", ["crew-main"])
    a = fresh(app_url, mail, "crew_lead", ["crew-main"])
    tag = uuid.uuid4().hex[:8]
    mk = {k: f"{tag}{k}" for k in "abcdefgjkt"}
    with serve_copy(MENTION_UNANSWERED_SECONDS=MENTION_AGE_S, DIGEST_INTERVAL_SECONDS=DIGEST_WINDOW_S) as copy:
        now = server_now(copy).timestamp()
        window = datetime.fromtimestamp(now - now % DIGEST_WINDOW_S + DIGEST_WINDOW_S, tz=timezone.utc)
        poll(lambda: server_now(copy) >= window + timedelta(seconds=DIGEST_DELAY_S + EVENT_SLACK_S), DIGEST_WINDOW_S + DIGEST_DELAY_S + EVENT_SLACK_S + MAIL_WAIT_S, "a fresh digest window")
        jc, ac = j.on(copy), a.on(copy)
        crew = channel_id(ac, "crew-main")
        h = j.handle
        post(ac, crew, f"@{h}, check RTU-3 {mk['a']}")
        post(ac, crew, f"Ping x@{h} {mk['b']}")
        post(ac, crew, f"@{h}zz {mk['c']}")
        post(ac, crew, f"Done @{h.upper()}. {mk['d']}")
        answered = post(ac, crew, f"@{h} answered {mk['e']}")
        post(jc, crew, "On it", thread_root_id=answered["id"])
        undone = post(ac, crew, f"@{h} deleted answer {mk['f']}")
        oops = post(jc, crew, "Sent by mistake", thread_root_id=undone["id"])
        assert jc.delete(f"/api/messages/{oops['id']}").status_code == 204
        post(ac, crew, f"@{h} top-level answer {mk['g']}")
        post(jc, crew, "Answering at top level")
        post(ac, crew, f"@{h} and again @{h} {mk['t']}")
        later = post(ac, crew, f"nothing yet {mk['j']}")
        assert edit(ac, later["id"], f"@{h} now {mk['j']}", 1).status_code == 200
        post(jc, crew, f"@{h} self {mk['k']}")
        assert server_now(copy) < window + timedelta(seconds=DIGEST_WINDOW_S - MENTION_AGE_S), "setup overran the window"
        found = mail_to(mail, j.email, subject="Rimewire:", seconds=DIGEST_WINDOW_S + DIGEST_DELAY_S + MAIL_WAIT_S)
        assert len(found) == 1
        m = found[0]
        lines = digest_lines(m)
        assert len(lines) == 5, lines
        assert m["Subject"].startswith("Rimewire: 5 unanswered mentions for ")
        body = kit.text(m)
        for k in "adfgt":
            assert mk[k] in body, k
        for k in "bcejk":
            assert mk[k] not in body, k


def test_wf_missed_mention_digest_mail_outage(app_url: str, mail: Any, browser: Browser) -> None:
    j = fresh(app_url, mail, "field_technician", ["crew-main"])
    a = fresh(app_url, mail, "crew_lead", ["crew-main"])
    target, offset = digest_offset(host_now(app_url), CHICAGO, 2)
    tag = uuid.uuid4().hex[:8]
    relay = mail_relay()
    env = {"APP_CLOCK_OFFSET_SECONDS": offset, "MENTION_UNANSWERED_SECONDS": MENTION_AGE_S, "DIGEST_INTERVAL_SECONDS": None, "SMTP_HOST": "127.0.0.1", "SMTP_PORT": relay.port}
    try:
        with serve_copy(**env) as copy:
            ac = a.on(copy)
            crew = channel_id(ac, "crew-main")
            with shell(browser, copy, ac, f"/c/{crew}") as page:
                soon(lambda: see(page.get_by_role("textbox", name="Message", exact=True)), page)
                compose(page, f"@{j.handle} check the walk-in {tag}")
                soon(lambda: see(article(page, tag).get_by_text("Sent", exact=True)), page)
            poll(lambda: server_now(copy) >= target + timedelta(seconds=DIGEST_DELAY_S + EVENT_SLACK_S), DIGEST_LEAD_S + DIGEST_DELAY_S + MAIL_WAIT_S, "07:00 to pass")
            poll(lambda: health(copy)["services"]["mail"] == "down", HEALTH_S + EVENT_SLACK_S, "mail down")
            assert ac.get("/api/me").status_code == 200
            relay.open()
            found = mail_to(mail, j.email, subject="Rimewire:", seconds=QUEUE_RETRY_S * 2 + DIGEST_DELAY_S)
            assert len(found) == 1
            assert found[0]["Subject"] == f"Rimewire: 1 unanswered mention for {business_date(target.date())}"
            lines = digest_lines(found[0])
            assert len(lines) == 1 and lines[0].startswith(f"#crew-main · {a.name} · "), lines
            assert tag in kit.text(found[0])
        with serve_copy(**env):
            assert len(mail_to(mail, j.email, subject="Rimewire:", count=2, seconds=QUEUE_RETRY_S + DIGEST_DELAY_S)) == 1
    finally:
        relay.close()


def test_wf_missed_mention_digest_happy(app_url: str, mail: Any, browser: Browser) -> None:
    lee2 = fresh(app_url, mail, "ops_manager", ["halvard-crew"], workspace="halvard")
    ari2 = fresh(app_url, mail, "field_technician", ["halvard-crew"], workspace="halvard")
    jo3 = fresh(app_url, mail, "ops_manager", ["crew-main", "weekend-emergency"])
    marco3 = fresh(app_url, mail, "crew_lead", ["crew-main"])
    dana3 = fresh(app_url, mail, "dispatcher", ["weekend-emergency"])
    tag = uuid.uuid4().hex[:8]
    ny_target, ny_offset = digest_offset(host_now(app_url), NEW_YORK, 3)
    with serve_copy(APP_CLOCK_OFFSET_SECONDS=ny_offset, MENTION_UNANSWERED_SECONDS=MENTION_AGE_S, DIGEST_INTERVAL_SECONDS=None) as copy:
        ac = ari2.on(copy)
        hm = post(ac, channel_id(ac, "halvard-crew"), f"@{lee2.handle} door heater {tag}")
        found = mail_to(mail, lee2.email, subject="Rimewire:", seconds=DIGEST_LEAD_S + DIGEST_DELAY_S + MAIL_WAIT_S)
        assert len(found) == 1
        assert ny_target <= mail_date(found[0]) <= ny_target + timedelta(seconds=DIGEST_DELAY_S)
        assert found[0]["Subject"] == f"Rimewire: 1 unanswered mention for {business_date(ny_target.date())}"
        prefix = f"#halvard-crew · {ari2.name} · {when(iso(hm['sent_at']), NEW_YORK)}"
        assert any(line.startswith(prefix) for line in digest_lines(found[0]))
    chi_target, chi_offset = digest_offset(host_now(app_url), CHICAGO, 3)
    with serve_copy(APP_CLOCK_OFFSET_SECONDS=chi_offset, MENTION_UNANSWERED_SECONDS=MENTION_AGE_S, DIGEST_INTERVAL_SECONDS=None) as copy:
        mc, jc, dc = marco3.on(copy), jo3.on(copy), dana3.on(copy)
        crew, wkd = channel_id(mc, "crew-main"), channel_id(dc, "weekend-emergency")
        post(mc, crew, f"@{jo3.handle} first {tag}1")
        m2 = post(mc, crew, f"@{jo3.handle} second {tag}2")
        m3 = post(mc, crew, f"@{jo3.handle} third {tag}3")
        with shell(browser, copy, jc, f"/c/{crew}") as page:
            art = article(page, f"first {tag}1")
            soon(lambda: see(art), page)
            choose(page, art, "Reply in thread")
            soon(lambda: see(details(page).get_by_role("textbox", name="Reply")), page)
            fill(details(page).get_by_role("textbox", name="Reply"), "Handled")
            click(details(page).get_by_role("button", name="Send reply"))
            soon(lambda: see(art.get_by_role("button", name=view_replies(1))), page)
        oops = post(jc, crew, "Mistake", thread_root_id=m2["id"])
        assert jc.delete(f"/api/messages/{oops['id']}").status_code == 204
        post(jc, crew, "About the third at top level")
        m4 = post(dc, wkd, f"@{jo3.handle} gate code {SECRET_GATE} {tag}4")
        found = mail_to(mail, jo3.email, subject="Rimewire:", seconds=DIGEST_LEAD_S + DIGEST_DELAY_S + MAIL_WAIT_S)
        assert len(found) == 1
        m = found[0]
        assert chi_target <= mail_date(m) <= chi_target + timedelta(seconds=DIGEST_DELAY_S)
        assert m["Subject"] == f"Rimewire: 3 unanswered mentions for {business_date(chi_target.date())}"
        lines = digest_lines(m)
        assert len(lines) == 3, lines
        for msg in (m2, m3):
            prefix = f"#crew-main · {marco3.name} · {when(iso(msg['sent_at']), CHICAGO)}"
            assert any(line.startswith(prefix) for line in lines), (prefix, lines)
        assert f"#weekend-emergency · {dana3.name} · {when(iso(m4['sent_at']), CHICAGO)} — private channel, open Rimewire to read it." in lines
        body = kit.text(m)
        assert SECRET_GATE not in body and f"first {tag}1" not in body and f"{copy}/" in body


def test_manifest_port_and_health(app_url: str) -> None:
    assert health(app_url) == {"status": "ok", "services": {"database": "up", "storage": "up", "mail": "up"}}
    with serve_copy() as copy:
        body = health(copy)
        assert body["status"] == "ok" and set(body["services"]) == {"database", "storage", "mail"}
        root = httpx.get(copy + "/", timeout=HTTP_TIMEOUT_S)
        assert root.status_code == 200 and root.headers["content-type"].startswith("text/html")
        shell_page = httpx.get(f"{copy}/c/{uuid.uuid4()}", timeout=HTTP_TIMEOUT_S)
        assert shell_page.status_code == 200 and shell_page.headers["content-type"].startswith("text/html")


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layout(app_url: str, browser: Browser, viewport: str) -> None:
    jo = signin(app_url, SEED["jo"])
    cid = channel_id(jo, "crew-main")
    tag = uuid.uuid4().hex[:8]
    post(jo, cid, f"Layout check {tag}")
    w, h = VIEWPORTS[viewport]
    with shell(browser, app_url, jo, f"/c/{cid}", size=(w, h)) as page:
        art = article(page, tag)
        soon(lambda: see(art), page)
        no_h_scroll(page)
        assert float(style(art.get_by_text(f"Layout check {tag}"), "font-size")["font-size"].rstrip("px")) >= TEXT_MIN_PX
        rail = page.get_by_role("navigation", name="Channels")
        messages = page.get_by_role("region", name="Messages")
        if viewport == "mobile":
            see(page.get_by_role("button", name="Channels"))
            placed(page, rail, False)
            click(page.get_by_role("button", name="Channels"))
            soon(lambda: placed(page, rail, True), page)
            page.keyboard.press("Escape")
            soon(lambda: placed(page, rail, False), page)
        else:
            placed(page, rail, True)
            expect(page.get_by_role("button", name="Channels")).to_be_hidden()
            assert rail.bounding_box()["x"] + rail.bounding_box()["width"] <= messages.bounding_box()["x"] + 1
        assert not on_screen(page, details(page))
        click(page.get_by_role("button", name="Photos", exact=True))
        soon(lambda: see(details(page)), page)
        settle(details(page))
        box = details(page).bounding_box()
        if viewport == "desktop":
            assert messages.bounding_box()["x"] + messages.bounding_box()["width"] <= box["x"] + 1
        elif viewport == "tablet":
            assert DETAIL_TABLET_MIN * w <= box["width"] <= DETAIL_TABLET_MAX * w and abs(box["x"] + box["width"] - w) <= 2
        else:
            assert box["width"] >= DETAIL_MOBILE_MIN * w
            see(details(page).get_by_role("button", name="Close details"))
        no_h_scroll(page)


def test_error_shape_and_precedence(app_url: str) -> None:
    evil = {"Origin": "http://evil.example"}
    big = json.dumps({"email": "x" * JSON_LIMIT, "password": "y"})
    oversized = httpx.post(app_url + "/api/session", content=big, headers={"Content-Type": "text/plain", **evil})
    assert oversized.status_code in (413, 415), (oversized.status_code, oversized.text)
    assert_error(oversized, oversized.status_code, "payload_too_large" if oversized.status_code == 413 else "unsupported_media_type")
    assert_error(httpx.post(app_url + "/api/session", content="hi", headers={"Content-Type": "text/plain", **evil}), 415, "unsupported_media_type")
    assert_error(httpx.post(f"{app_url}/api/channels/{uuid.uuid4()}/messages", json={}, headers=evil), 403, "cross_origin")
    assert_error(httpx.get(f"{app_url}/api/channels/{uuid.uuid4()}"), 401, "unauthenticated")
    sam = signin(app_url, SEED["sam"])
    jo = signin(app_url, SEED["jo"])
    target = next(r["message_id"] for r in search(jo, "target superheat")["results"] if r["channel"]["name"] == "site-store-114")
    assert_error(sam.delete(f"/api/messages/{target}"), 404, "not_found")
    crew_msg = next(r["message_id"] for r in search(jo, "spare TXV kit")["results"] if r["channel"]["name"] == "crew-main")
    assert_error(sam.patch(f"/api/messages/{crew_msg}", json={"text": "", "expected_version": "x", "extra": 1}), 403, "forbidden")
    assert_error(jo.post("/api/workspace/members", json={"name": "Dup", "email": SEED["dana"], "role": "chef"}), 409, "email_taken")
    down = os.environ["APP_MINIO_DOWN_URL"]
    dc = signin(down, SEED["dana"])
    cid = channel_id(dc, "site-store-114")
    r = dc.post(f"/api/channels/{cid}/messages", data={"client_message_id": "", "text": "x"}, files=[("file", ("a.jpg", photo(), "image/jpeg"))])
    assert_error(r, 422, "validation", "client_message_id", COPY["client_message_id"])


def test_server_boundary(app_url: str) -> None:
    dana = signin(app_url, SEED["dana"])
    cid = channel_id(dana, "install-team")
    host = urlparse(app_url)
    tag = uuid.uuid4().hex[:8]
    r = dana.post(f"/api/channels/{cid}/messages", json={"client_message_id": str(uuid.uuid4()), "text": f"Forged {tag}"}, headers={"Origin": f"http://{host.hostname}:{(host.port or 80) + 1}"})
    assert_error(r, 403, "cross_origin")
    assert search(dana, f"Forged {tag}")["total"] == 0
    assert api(app_url).post("/api/session", json={"email": SEED["dana"], "password": PASSWORD}, headers={"Origin": f"https://{host.netloc}"}).status_code == 200
    for resp in (httpx.get(app_url + "/api/health", headers={"Origin": "http://evil.example"}), httpx.options(app_url + "/api/session", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})):
        assert not any(k.lower().startswith("access-control-") for k in resp.headers)
    base = json.dumps({"client_message_id": str(uuid.uuid4()), "text": "Padded", "pad": ""})
    exact = base.replace('"pad": ""', '"pad": "' + "p" * (JSON_LIMIT - len(base)) + '"')
    assert len(exact.encode()) == JSON_LIMIT
    assert dana.post(f"/api/channels/{cid}/messages", content=exact, headers={"Content-Type": "application/json"}).status_code == 422
    over = exact.replace('"pad": "', '"pad": "p', 1)
    assert_error(dana.post(f"/api/channels/{cid}/messages", content=over, headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    blob = b"\x00" * (MULTIPART_LIMIT + 1)
    assert_error(dana.post(f"/api/channels/{cid}/messages", data={"client_message_id": str(uuid.uuid4()), "text": "big"}, files=[("file", ("big.jpg", blob, "image/jpeg"))]), 413, "payload_too_large")
    assert_error(dana.post(f"/api/channels/{cid}/messages", content="plain", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    m = post(dana, cid, "Patch me")
    assert_error(dana.patch(f"/api/messages/{m['id']}", data={"text": "x"}, files=[("file", ("a.jpg", b"x", "image/jpeg"))]), 415, "unsupported_media_type")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts", "/dist/server.js", "/server.js.map"):
        assert httpx.get(app_url + path).status_code == 404, path


def test_wf_crew_onboarding_signin(app_url: str, browser: Browser) -> None:
    crew = channel_id(signin(app_url, SEED["priya"]), "crew-main")
    with open_app(browser, f"{app_url}/c/{crew}") as page:
        soon(lambda: see(page.get_by_role("heading", level=1, name="Rimewire")), page)
        fill(page.get_by_label("Email"), SEED["priya"])
        fill(page.get_by_label("Password"), WRONG_PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        soon(lambda: see(page.get_by_text(ERR["invalid_credentials"]).first), page)
        fill(page.get_by_label("Password"), PASSWORD)
        with held(page, "**/api/session") as gate:
            click(page.get_by_role("button", name="Sign in"))
            soon(lambda: expect(page.get_by_role("button", name="Signing in…")).to_be_disabled(timeout=POLL_MS), page)
            gate.release()
        soon(lambda: see(page.get_by_role("heading", level=1, name="crew-main")), page)
        assert urlparse(page.url).path == f"/c/{crew}"
        c = api(app_url)
        for ck in page.context.cookies():
            c.cookies.set(ck["name"], ck["value"])
        assert c.get("/api/me").status_code == 200
        click(page.get_by_role("button", name="Sign out"))
        soon(lambda: see(page.get_by_role("heading", level=1, name="Rimewire")), page)
        assert_error(c.get("/api/me"), 401, "unauthenticated")


def test_wf_cross_cutting_keyboard(app_url: str, browser: Browser) -> None:
    jo = signin(app_url, SEED["jo"])
    crew = channel_id(jo, "crew-main")
    with shell(browser, app_url, jo, f"/c/{crew}") as page:
        soon(lambda: see(page.get_by_role("heading", level=1, name="crew-main")), page)
        page.evaluate("() => { const a = document.activeElement; if (a instanceof HTMLElement) a.blur();"
                      " document.body.tabIndex = -1; document.body.focus(); }")
        for stop in ["Skip to messages", "Search messages", "Sign out"]:
            page.keyboard.press("Tab")
            expect(page.locator(":focus")).to_have_accessible_name(stop)
        page.keyboard.press("Tab")
        expect(page.locator(":focus")).to_have_accessible_name(re.compile(r"^crew-main"))
        members = page.get_by_role("button", name="Members")
        rest, focused = state_styles(members, *FOCUS_PROPS, state="focus")
        assert rest != focused
        members.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=members_of("crew-main"))
        soon(lambda: see(dialog), page)
        soon(lambda: expect(dialog.get_by_role("combobox", name="Add a person")).to_be_focused(timeout=POLL_MS), page)
        page.keyboard.press("Escape")
        soon(lambda: gone(dialog), page)
        soon(lambda: expect(members).to_be_focused(timeout=POLL_MS), page)
        photos = page.get_by_role("button", name="Photos", exact=True)
        photos.focus()
        page.keyboard.press("Enter")
        soon(lambda: see(details(page)), page)
        page.keyboard.press("Escape")
        soon(lambda: expect(details(page)).to_be_hidden(timeout=POLL_MS), page)
        soon(lambda: expect(photos).to_be_focused(timeout=POLL_MS), page)


ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "Unlicense", "OFL-1.1", "LGPL-3.0-or-later"}


def manifest() -> dict:
    return json.loads(Path("/app/run.json").read_text())


def shipped() -> dict[tuple[str, str], Any]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd="/app", capture_output=True, text=True, timeout=NPM_TIMEOUT_S).stdout
    found: dict[tuple[str, str], Any] = {}

    def walk(deps: dict | None) -> None:
        for name, info in (deps or {}).items():
            key = (name, info.get("version", ""))
            if key[1] and key not in found:
                lic = info.get("license")
                pkg = Path(info.get("path") or "/nonexistent") / "package.json"
                if lic is None and pkg.exists():
                    lic = json.loads(pkg.read_text()).get("license")
                found[key] = lic.get("type") if isinstance(lic, dict) else lic
                walk(info.get("dependencies"))

    walk(json.loads(out).get("dependencies"))
    return found


def licence_ok(expr: str | None) -> bool:
    if not expr:
        return False
    parts = expr.replace("(", " ").replace(")", " ")
    if " OR " in parts:
        return any(licence_ok(p.strip()) for p in parts.split(" OR "))
    return all(p.strip() in ALLOWED for p in parts.split(" AND "))


def test_if_run_manifest() -> None:
    m = manifest()
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices_text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{n}@{v}" for n, v in shipped() if n not in notices_text or v not in notices_text]
    assert not missing, missing
    for font in ("Barlow Condensed", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices_text


def test_if_allowed_licences() -> None:
    bad = {f"{n}@{v}": lic for (n, v), lic in shipped().items() if not licence_ok(lic)}
    assert not bad, bad


def test_if_no_extra_datastore() -> None:
    pkg = json.loads(Path("/app/package.json").read_text())
    names = {**pkg.get("dependencies", {}), **pkg.get("optionalDependencies", {})}
    assert not [n for n in names if any(store.lower() in n.lower() for store in FORBIDDEN_STORES)]


def test_if_same_origin_assets(app_url: str, browser: Browser) -> None:
    jo = signin(app_url, SEED["jo"])
    urls: list[str] = []
    with shell(browser, app_url, jo, f"/c/{channel_id(jo, 'crew-main')}") as page:
        page.on("request", lambda req: urls.append(req.url))
        page.reload()
        soon(lambda: see(page.get_by_role("heading", level=1, name="crew-main")), page)
    foreign = [u for u in urls if u.startswith("http") and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_service_config_untouched() -> None:
    commands = " ".join(manifest()[k] for k in ("install", "build", "serve"))
    for name in ("DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM"):
        assert f"{name}=" not in commands


def test_if_lockfile_used() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    assert lock["name"] == json.loads(Path("/app/package.json").read_text())["name"]
    assert "npm ci" in manifest()["install"]


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", ".git", "coverage", "public", "scripts"}
    offenders = []
    for path in Path("/app").rglob("*"):
        if skip & set(path.relative_to("/app").parts) or not path.is_file():
            continue
        if path.suffix in {".js", ".jsx", ".mjs", ".cjs"} and ".config." not in path.name and not path.name.startswith("."):
            offenders.append(str(path))
    assert not offenders, offenders


BAD_REF = {"control": "%00", "shapeless": "not-a-uuid", "absent": None}


def refs() -> list[str]:
    return [lit if lit is not None else str(uuid.uuid4()) for lit in BAD_REF.values()]


def nowhere(c: httpx.Client, method: str, path: str, body: Any = None) -> None:
    resp = c.request(method, path, json=body)
    assert resp.status_code < 500, (method, path, resp.status_code, resp.text[:200])
    assert_error(resp, 404, "not_found")


def test_error_shape_holds_for_unresolvable_ids(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "dispatcher", ["install-team"])
    for ref in refs():
        nowhere(t.c, "GET", f"/api/channels/{ref}")
        nowhere(t.c, "GET", f"/api/channels/{ref}/messages")
        nowhere(t.c, "GET", f"/api/channels/{ref}/gallery")
        nowhere(t.c, "GET", f"/api/channels/{ref}/scheduled")
        nowhere(t.c, "POST", f"/api/channels/{ref}/messages", {"text": "x", "client_message_id": str(uuid.uuid4())})
        nowhere(t.c, "GET", f"/api/messages/{ref}")
        nowhere(t.c, "PATCH", f"/api/messages/{ref}", {"text": "y", "version": 1})
        nowhere(t.c, "DELETE", f"/api/messages/{ref}")


def test_photo_urls_answer_not_found_for_unresolvable_ids(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "field_technician", ["site-store-114"])
    for ref in refs():
        nowhere(t.c, "GET", f"/api/attachments/{ref}")
        nowhere(t.c, "GET", f"/api/attachments/{ref}/thumb")


def test_membership_routes_answer_not_found_for_unresolvable_people(app_url: str, mail: Any) -> None:
    jo = signin(app_url, SEED["jo"])
    cid = channel_id(jo, "install-team")
    for ref in refs():
        nowhere(jo, "DELETE", f"/api/workspace/members/{ref}")
        nowhere(jo, "DELETE", f"/api/channels/{cid}/members/{ref}")


def test_pinning_answers_not_found_for_unresolvable_ids(app_url: str, mail: Any) -> None:
    lead = signin(app_url, SEED["priya"])
    cid = channel_id(lead, "shift-bulletins")
    for ref in refs():
        nowhere(lead, "POST", f"/api/channels/{ref}/pins", {"message_id": str(uuid.uuid4())})
        nowhere(lead, "DELETE", f"/api/channels/{cid}/pins/{ref}")


def test_receipts_answer_not_found_for_unresolvable_messages(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "dispatcher", ["install-team"])
    for ref in refs():
        nowhere(t.c, "GET", f"/api/messages/{ref}/receipts")


def test_thread_and_versions_answer_not_found_for_unresolvable_messages(app_url: str, mail: Any) -> None:
    t = fresh(app_url, mail, "dispatcher", ["install-team"])
    for ref in refs():
        nowhere(t.c, "GET", f"/api/messages/{ref}/thread")
        nowhere(t.c, "GET", f"/api/messages/{ref}/versions")
