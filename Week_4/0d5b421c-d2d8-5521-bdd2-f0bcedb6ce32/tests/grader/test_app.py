from __future__ import annotations

import itertools
import json
import os
import random
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from datetime import time as clock_time
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, unquote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    KillBill,
    Mailpit,
    Postgres,
    Valkey,
    addresses,
    advance,
    check,
    click,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    select,
    shipped_packages,
    style,
    tap,
    text,
    unique,
)

LISBON = ZoneInfo("Europe/Lisbon")
HOLD_SECONDS = 300
OFFER_SECONDS = 900
SHORT_TIMER_SECONDS = 5
LIVE_SECONDS = 2
LIFT_SECONDS = 4
STATUS_RECOVERY_SECONDS = 10
OFFER_RECOVERY_SECONDS = 15
STATUS_CHECK_SECONDS = 30
MAIL_SECONDS = 10
LAPSE_MAIL_SECONDS = 12
HOLDS_PAUSED_SECONDS = 3
READ_SECONDS = 3
RELEASE_SECONDS = 30
BOOT_SECONDS = 60
STREAM_COUNT = 50
ABORT_COUNT = 10
BODY_LIMIT = 16384
STAGGER_MS = 70
TOUCH_PX = 44
BUTTON_INSET_PX = 16
EVENT_TYPES_KEYS = {"type", "date", "time", "table_ids", "party_size"}
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
SLACK_SECONDS = 1
BOOT_SLACK_SECONDS = 60
HTTP_TIMEOUT = 30
UI_TIMEOUT_MS = 15000
QUIET_SECONDS = 3
FRESH_DAYS = 40
MIN_SECRET_LENGTH = 12
KB_SUCCESS = "SUCCESS"
KILLBILL_PROXY_PORT = 18080
VALKEY_RELAY_PORT = 16379
JUNK_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
UNREACHABLE_DATABASE = "postgres://nobody:nothing@127.0.0.1:9/none"
FOREIGN_ORIGIN = "https://elsewhere.example"
UNKNOWN_REFERENCE = "SS-AAAAAA"
UNKNOWN_PATH = "/api/nothing-here"
BAD_DATE = "soon"
TYPED_EMAIL = "ana@example.com"
TYPED_PHONE = "912345678"
RUN_MANIFEST = Path("/app") / "run.json"
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
HOST_EMAIL = "host@saffronslate.example"
HOST_PASSWORD = "Hearth-and-Slate-2026"
HOLDS_BANNER = "Table holds are paused. Please try again in a few minutes."
DEPOSITS_BANNER = "Deposits are paused. Bookings that need a deposit can't be confirmed right now."
LIVE_PAUSED_BANNER = "Live updates are paused. The plan refreshes every 30 seconds."
PAYMENT_FAILED_COPY = "Your deposit didn't go through, so nothing was booked. Your table is still held."
CANCEL_DOWN_COPY = "We couldn't reach our payments system, so your booking is unchanged. Please try again shortly."
DEAD_MANAGE_COPY = "This booking link no longer works."
DEAD_OFFER_COPY = "This offer link no longer works."
SESSION_ENDED_COPY = "Your session has ended. Sign in again to continue."
ROOM_ORDER = ["Window Row", "Hearth", "Slate Room", "Bar Rail", "Courtyard", "Chef's Counter"]
ROOM_SEATS = {"Window Row": 10, "Hearth": 16, "Slate Room": 20, "Bar Rail": 4, "Courtyard": 8, "Chef's Counter": 6}
SEED_ORDER = "T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 C1 C2 C3".split()
TWO_TOPS = "T1 T2 T3 T13 T14 C1 C2 C3".split()

expect.set_options(timeout=UI_TIMEOUT_MS)

_DAY_CURSOR = itertools.count(random.randrange(27))


@pytest.fixture
def clock_url() -> str:
    return os.environ["APP_CLOCK_URL"]


@pytest.fixture
def short_url() -> str:
    return os.environ["APP_SHORT_URL"]


@pytest.fixture
def kb_down_url() -> str:
    return os.environ["APP_KILLBILL_DOWN_URL"]


@pytest.fixture
def valkey_down_url() -> str:
    return os.environ["APP_VALKEY_DOWN_URL"]


@pytest.fixture
def flap_url() -> str:
    return os.environ["APP_FLAP_URL"]


def parse_instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def lisbon(day: str, hhmm: str) -> datetime:
    hour, minute = hhmm.split(":")
    return datetime.combine(date.fromisoformat(day), clock_time(int(hour), int(minute)), LISBON)


def server_now(base: str) -> datetime:
    return parse_instant(get(base, "/api/status").json()["server_now"])


def set_clock(base: str, instant: datetime) -> None:
    response = httpx.put(f"{base}/api/clock", json={"now": instant.isoformat()}, timeout=HTTP_TIMEOUT)
    assert response.status_code == 200, f"PUT /api/clock answered {response.status_code}: {response.text}"


def evening(base: str, at: str = "16:00", day_of_month: int | None = None) -> str:
    day = server_now(base).astimezone(LISBON).date() + timedelta(days=FRESH_DAYS)
    while day_of_month is not None and day.day != day_of_month:
        day += timedelta(days=1)
    set_clock(base, lisbon(day.isoformat(), at))
    return day.isoformat()


def plus_days(day: str, days: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def when(day: str, hhmm: str) -> str:
    parsed = date.fromisoformat(day)
    return f"{parsed:%a} {parsed.day} {parsed:%b} at {hhmm}"


def day_label(day: str) -> str:
    parsed = date.fromisoformat(day)
    return f"{parsed:%a} {parsed.day} {parsed:%b}"


def tonight(base: str) -> str:
    return get(base, "/api/tonight").json()["date"]


def run_manifest() -> dict[str, str]:
    return json.loads(RUN_MANIFEST.read_text())


def host_path(hhmm: str, table: str | None = None) -> str:
    return f"/host?time={hhmm}" + (f"&table={table}" if table else "")


def host_floor(client: httpx.Client, hhmm: str) -> httpx.Response:
    return client.get(f"/api/host/floor?time={quote(hhmm)}")


def host_action(reference: str, action: str) -> str:
    return f"/api/host/bookings/{reference}/{action}"


def caption_start(room: str, covers: int, at: str) -> str:
    return f"{room} · {ROOM_SEATS[room]} seats · {covers} covers free at {at}"


def caption(room: str, covers: int, at: str, next_two: str) -> str:
    return f"{caption_start(room, covers, at)} · Next table for two tonight: {next_two}"


def get(base: str, path: str, **options: Any) -> httpx.Response:
    return httpx.get(f"{base}{path}", timeout=HTTP_TIMEOUT, **options)


def delete(base: str, path: str) -> httpx.Response:
    return httpx.delete(f"{base}{path}", timeout=HTTP_TIMEOUT)


def assert_error(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, f"expected {status} {code}, got {response.status_code}: {response.text}"
    body = response.json()
    assert set(body) == {"error"}, body
    assert body["error"]["code"] == code, body
    assert isinstance(body["error"]["message"], str) and body["error"]["message"], body
    if status != 422:
        assert "fields" not in body["error"], body
    return body["error"]


def poll(condition: Callable[[], Any], seconds: float, contract: str) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = condition()
        if value:
            return value
    pytest.fail(f"{contract} (waited {seconds} s)")


def stays(condition: Callable[[], None], seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        condition()


def await_status(base: str, seconds: float = STATUS_RECOVERY_SECONDS + SLACK_SECONDS, **expected: str) -> None:
    def matches() -> bool:
        body = get(base, "/api/status").json()
        return all(body[name] == value for name, value in expected.items())

    poll(matches, seconds, f"GET /api/status reports {expected}")


def plan_status(base: str, day: str, hhmm: str, party: int) -> dict[str, str]:
    response = get(base, f"/api/plan?date={day}&time={quote(hhmm)}&party={party}")
    assert response.status_code == 200, response.text
    body = response.json()
    statuses = {row["table_id"]: row["status"] for row in body["tables"]}
    statuses.update({row["pair_id"]: row["status"] for row in body["pairs"]})
    return statuses


def covers_at(base: str, day: str, hhmm: str, party: int = 2) -> dict[str, Any]:
    response = get(base, f"/api/availability?date={day}&party={party}")
    assert response.status_code == 200, response.text
    return next(row for row in response.json()["slots"] if row["time"] == hhmm)


def first_fit(base: str, day: str, hhmm: str, party: int) -> str | None:
    statuses = plan_status(base, day, hhmm, party)
    ids = [identifier for identifier, status in statuses.items() if status == "fits"]
    pairs = [identifier for identifier in ids if "+" in identifier]
    if party >= 7:
        return pairs[0] if pairs else None
    ordered = [table for table in SEED_ORDER if table in ids]
    return ordered[0] if ordered else None


def open_slot(base: str, party: int, hhmm: str = "20:00") -> tuple[str, str, str]:
    today = date.fromisoformat(tonight(base))
    for _ in range(27):
        day = (today + timedelta(days=3 + next(_DAY_CURSOR) % 27)).isoformat()
        table = first_fit(base, day, hhmm, party)
        if table:
            return day, hhmm, table
    pytest.fail(f"GET /api/plan offered no eligible table for a party of {party} on any date")


def place_hold(base: str, day: str, hhmm: str, party: int, table: str) -> httpx.Response:
    return post_json(base, "/api/holds", {"date": day, "time": hhmm, "party_size": party, "table_id": table})


def take_hold(base: str, day: str, hhmm: str, party: int, table: str) -> dict[str, Any]:
    response = place_hold(base, day, hhmm, party, table)
    assert response.status_code == 201, f"hold on {table} answered {response.status_code}: {response.text}"
    return response.json()


def guest(prefix: str = "guest") -> tuple[str, str]:
    first, second = unique(prefix)
    return (second, first) if "@" in first else (first, second)


def confirm(base: str, hold_id: str, name: str, email: str, accept: bool = False, key: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"name": name, "email": email}
    if accept:
        body["accept_deposit"] = True
    return post_json(base, f"/api/holds/{hold_id}/confirm", body, key or idempotency_key())


@dataclass
class Booked:
    reference: str
    token: str
    name: str
    email: str
    table: str
    booking: dict[str, Any]


def book(
    base: str, day: str, hhmm: str, party: int, table: str | None = None, on: str | None = None, prefix: str = "guest"
) -> Booked:
    chosen = table or first_fit(base, day, hhmm, party)
    assert chosen, f"no eligible table on {day} {hhmm} for {party}"
    hold = take_hold(base, day, hhmm, party, chosen)
    name, email = guest(prefix)
    response = confirm(on or base, hold["hold_id"], name, email, accept=hold["deposit_cents"] > 0)
    assert response.status_code == 201, f"confirm answered {response.status_code}: {response.text}"
    body = response.json()
    return Booked(body["booking"]["reference"], token_from(body["manage_url"]), name, email, chosen, body["booking"])


def token_from(url: str) -> str:
    return urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]


def join(base: str, day: str, party: int, earliest: str, latest: str, email: str | None = None) -> tuple[httpx.Response, str]:
    name, generated = guest("waiter")
    address = email or generated
    response = post_json(
        base,
        "/api/waitlist",
        {"date": day, "party_size": party, "earliest": earliest, "latest": latest, "name": name, "email": address},
    )
    return response, address


def host_client(base: str) -> httpx.Client:
    response = httpx.post(
        f"{base}/api/host/session", json={"email": HOST_EMAIL, "password": HOST_PASSWORD}, timeout=HTTP_TIMEOUT
    )
    assert response.status_code == 200, response.text
    cookie = response.headers["set-cookie"].split(";")[0]
    return httpx.Client(base_url=base, headers={"Cookie": cookie}, timeout=HTTP_TIMEOUT)


def walk_in(client: httpx.Client, table: str, party: int, key: str | None = None) -> httpx.Response:
    return client.post(
        "/api/host/walk-ins",
        json={"table_id": table, "party_size": party},
        headers={"Idempotency-Key": key or idempotency_key()},
    )


def inbox(mail: Mailpit, email: str, subject: str = "", settle: float = 0.2) -> list[dict[str, Any]]:
    found = []
    for message in mail.messages(settle=settle):
        recipients = [address.lower() for address in addresses(message["To"])]
        if email.lower() in recipients and message["Subject"].startswith(subject):
            found.append(message)
    return found


def await_mail(mail: Mailpit, email: str, subject: str, seconds: float = MAIL_SECONDS + SLACK_SECONDS) -> dict[str, Any]:
    found = poll(lambda: inbox(mail, email, subject), seconds, f"an email to {email} with subject {subject!r} arrives")
    return found[0]


def one_mail(mail: Mailpit, email: str, subject: str) -> dict[str, Any]:
    await_mail(mail, email, subject)
    found = inbox(mail, email, subject, settle=QUIET_SECONDS)
    assert len(found) == 1, f"expected exactly one {subject!r} email to {email}, found {len(found)}"
    return found[0]


def no_mail(mail: Mailpit, email: str, subject: str = "", seconds: float = QUIET_SECONDS) -> None:
    found = inbox(mail, email, subject, settle=seconds)
    assert not found, f"expected no {subject!r} email to {email}, found {[m['Subject'] for m in found]}"


def lines(message: dict[str, Any]) -> list[str]:
    return [line.strip() for line in text(message).splitlines()]


def offer_token(message: dict[str, Any]) -> str:
    match = re.search(r"/offer/(\S+)", text(message))
    assert match, f"offer email has no claim link: {text(message)}"
    return match.group(1)


def manage_token(message: dict[str, Any]) -> str:
    match = re.search(r"/manage/(\S+)", text(message))
    assert match, f"confirmation email has no manage link: {text(message)}"
    return match.group(1)


def kill_bill_transactions(killbill: KillBill, email: str, kind: str) -> list[dict[str, Any]]:
    account = killbill.account_by_key(email.lower())
    if account is None:
        return []
    return [
        transaction
        for payment in killbill.payments(account["accountId"])
        for transaction in payment["transactions"]
        if transaction["transactionType"] == kind and transaction["status"] == KB_SUCCESS
    ]


def amount_of(transaction: dict[str, Any]) -> Decimal:
    return Decimal(str(transaction["amount"]))


def offer_for(base: str, mail: Mailpit, day: str, hhmm: str, party: int, table: str) -> tuple[str, str, dict[str, Any]]:
    hold = take_hold(base, day, hhmm, party, table)
    response, email = join(base, day, party, hhmm, hhmm)
    assert response.status_code == 201, response.text
    assert delete(base, f"/api/holds/{hold['hold_id']}").status_code == 204
    token = offer_token(await_mail(mail, email, "A table is free: "))
    offer = get(base, f"/api/offers/{token}")
    assert offer.status_code == 200, offer.text
    return token, email, offer.json()


class KillBillProxy:

    def __init__(self) -> None:
        self.upstream = os.environ["KILLBILL_URL"].rstrip("/")
        self.fail_purchase = False
        self.gate: threading.Event | None = None
        self.gate_reached = threading.Event()
        self.purchases: list[str] = []
        self.server: ThreadingHTTPServer | None = None

    def start(self) -> None:
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.0"

            def log_message(self, *_: Any) -> None:
                return

            def forward(self) -> None:
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                wire = f"{self.path} {body.decode(errors='replace')}"
                is_post = self.command == "POST" and "/payments" in self.path
                is_purchase = is_post and "PURCHASE" in wire
                is_refund = is_post and ("/refunds" in self.path or "REFUND" in wire)
                if is_purchase:
                    proxy.purchases.append(wire)
                if is_purchase and proxy.fail_purchase:
                    answer = json.dumps(
                        {"transactions": [{"transactionType": "PURCHASE", "status": "PAYMENT_FAILURE"}]}
                    ).encode()
                    self.send_response(402)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(answer)))
                    self.end_headers()
                    self.wfile.write(answer)
                    return
                if (is_purchase or is_refund) and proxy.gate is not None:
                    proxy.gate_reached.set()
                    proxy.gate.wait(HTTP_TIMEOUT)
                headers = {k: v for k, v in self.headers.items() if k.lower() not in {"content-length", "connection"}}
                reply = httpx.request(
                    self.command, proxy.upstream + self.path, headers=headers, content=body, timeout=HTTP_TIMEOUT
                )
                self.send_response(reply.status_code)
                for name, value in reply.headers.items():
                    if name.lower() not in {"content-length", "content-encoding", "transfer-encoding", "connection"}:
                        self.send_header(name, value)
                self.send_header("Content-Length", str(len(reply.content)))
                self.end_headers()
                self.wfile.write(reply.content)

            do_GET = do_POST = do_PUT = do_DELETE = forward

        self.server = ThreadingHTTPServer(("127.0.0.1", KILLBILL_PROXY_PORT), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = None


class TcpRelay:

    def __init__(self, port: int, upstream: tuple[str, int], greeting: bytes = b"") -> None:
        self.port = port
        self.upstream = upstream
        self.greeting = greeting
        self.listener: socket.socket | None = None
        self.sockets: list[socket.socket] = []

    def start(self) -> None:
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", self.port))
        self.port = self.listener.getsockname()[1]
        self.listener.listen(128)
        threading.Thread(target=self._accept, args=(self.listener,), daemon=True).start()

    def _accept(self, listener: socket.socket) -> None:
        while True:
            try:
                client, _ = listener.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(client,), daemon=True).start()

    def _serve(self, client: socket.socket) -> None:
        try:
            server = socket.create_connection(self.upstream, timeout=HTTP_TIMEOUT)
            server.settimeout(None)
            if self.greeting:
                server.sendall(self.greeting)
                server.recv(256)
        except OSError:
            client.close()
            return
        self.sockets += [client, server]
        threading.Thread(target=self._pump, args=(client, server), daemon=True).start()
        self._pump(server, client)

    @staticmethod
    def _pump(source: socket.socket, target: socket.socket) -> None:
        try:
            while chunk := source.recv(65536):
                target.sendall(chunk)
        except OSError:
            pass
        for side in (source, target):
            try:
                side.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            side.close()

    def drop_connections(self) -> None:
        for connection in self.sockets:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.sockets = []

    def stop(self) -> None:
        if self.listener is not None:
            try:
                self.listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.listener.close()
            self.listener = None
        self.drop_connections()


def valkey_relay() -> TcpRelay:
    upstream = urlparse(os.environ.get("VALKEY_URL") or os.environ["VALKEY_OBSERVER_URL"])
    parts = [b"AUTH"]
    if upstream.username:
        parts.append(unquote(upstream.username).encode())
    if upstream.password:
        parts.append(unquote(upstream.password).encode())
    greeting = b""
    if len(parts) > 1:
        greeting = b"*%d\r\n" % len(parts) + b"".join(b"$%d\r\n%s\r\n" % (len(part), part) for part in parts)
    return TcpRelay(VALKEY_RELAY_PORT, (upstream.hostname or "127.0.0.1", upstream.port or 6379), greeting)


@contextmanager
def flap_services(base: str) -> Iterator[tuple[KillBillProxy, TcpRelay]]:
    proxy, relay = KillBillProxy(), valkey_relay()
    proxy.start()
    relay.start()
    try:
        await_status(base, holds="ok", deposits="ok")
        yield proxy, relay
    finally:
        proxy.stop()
        relay.stop()


class EventStream(threading.Thread):
    def __init__(self, url: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(daemon=True)
        self.url = url
        self.headers = headers or {}
        self.events: list[tuple[str, dict[str, Any], str]] = []
        self.connected = threading.Event()
        self.status = 0
        self.response: httpx.Response | None = None
        self.start()
        assert self.connected.wait(HTTP_TIMEOUT), f"{url} never answered"

    def run(self) -> None:
        timeout = httpx.Timeout(HTTP_TIMEOUT, read=None)
        try:
            with httpx.stream("GET", self.url, headers=self.headers, timeout=timeout) as response:
                self.response = response
                self.status = response.status_code
                self.connected.set()
                event_id, data = "", ""
                for line in response.iter_lines():
                    if line.startswith("id:"):
                        event_id = line[3:].strip()
                    elif line.startswith("data:"):
                        data = line[5:].strip()
                    elif not line and data:
                        self.events.append((event_id, json.loads(data), data))
                        data = ""
        except (httpx.HTTPError, RuntimeError, ValueError):
            self.connected.set()

    def close(self) -> None:
        if self.response is not None:
            self.response.close()


def open_raw_streams(base: str, day: str, count: int) -> list[socket.socket]:
    parsed = urlparse(base)
    request = (
        f"GET /api/floor/events?date={day} HTTP/1.1\r\nHost: {parsed.netloc}\r\nAccept: text/event-stream\r\n\r\n"
    ).encode()
    streams = []
    for _ in range(count):
        connection = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=HTTP_TIMEOUT)
        connection.sendall(request)
        streams.append(connection)
    return streams


def close_raw_streams(streams: list[socket.socket]) -> None:
    for connection in streams:
        try:
            connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        connection.close()


@contextmanager
def visit(browser: Browser, url: str, viewport: dict[str, int] = DESKTOP, **options: Any) -> Iterator[Page]:
    options.setdefault("timezone_id", "Europe/Lisbon")
    options.setdefault("locale", "en-US")
    context = browser.new_context(viewport=viewport, **options)
    page = context.new_page()
    try:
        page.goto(url)
        yield page
    finally:
        context.close()


@contextmanager
def paused(browser: Browser, url: str, **options: Any) -> Iterator[Page]:
    handle: Any = open_app(browser, url, **options)
    if hasattr(handle, "__enter__"):
        with handle as page:
            yield page
    else:
        page = next(handle)
        try:
            yield page
        finally:
            handle.close()


def pump(page: Page, ready: Callable[[], bool], what: str, step_ms: float = 4, seconds: float = 20) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if ready():
            return
        advance(page, step_ms)
    pytest.fail(f"{what} (paused-clock page, waited {seconds} s)")


def book_url(base: str, day: str, party: int, hhmm: str | None = None) -> str:
    return f"{base}/book?date={day}&party={party}" + (f"&time={quote(hhmm)}" if hhmm else "")


def query(page: Page) -> dict[str, str]:
    return {name: values[0] for name, values in parse_qs(urlparse(page.url).query).items()}


def await_query(page: Page, **expected: str) -> None:
    def matches() -> bool:
        current = query(page)
        return all(current.get(name) == value for name, value in expected.items())

    deadline = time.monotonic() + UI_TIMEOUT_MS / 1000
    while time.monotonic() < deadline:
        if matches():
            return
        page.wait_for_function("() => true")
    pytest.fail(f"booking URL carries {expected}; it is {page.url}")


def slot(page: Page, hhmm: str) -> Locator:
    return page.get_by_role("listbox", name="Times").get_by_role("option", name=re.compile(rf"^{hhmm}\b"))


def table_option(page: Page, table: str, status: str | None = None) -> Locator:
    tail = re.escape(status) + "$" if status else ""
    if "+" in table:
        first, second = table.split("+")
        pattern = rf"^Tables {first} and {second} joined,.*{tail}"
    else:
        pattern = rf"^Table {table},.*{tail}"
    return page.get_by_role("listbox", name="Tables").get_by_role("option", name=re.compile(pattern))


def floor_option(page: Page, table: str, label: str | None = None) -> Locator:
    tail = re.escape(label) + "$" if label else ""
    pattern = rf"^Table {table},.*{tail}"
    return page.get_by_role("listbox", name="Tonight's floor").get_by_role("option", name=re.compile(pattern))


def settings(page: Page, table: str | None = None) -> Locator:
    tail = rf", table {table}$" if table else ""
    return page.get_by_role("img", name=re.compile(rf"^Place setting \d+ of \d+{tail}"))


def setting(page: Page, k: int, n: int, table: str) -> Locator:
    return page.get_by_role("img", name=f"Place setting {k} of {n}, table {table}", exact=True)


def updates(page: Page) -> Locator:
    return page.get_by_role("status", name="Booking updates")


def banner(page: Page, copy: str) -> Locator:
    return page.get_by_role("alert").filter(has_text=copy)


def textbox(page: Page, name: str) -> Locator:
    return page.get_by_role("textbox", name=name, exact=True)


def has_focus(locator: Locator) -> bool:
    return locator.evaluate("e => e === document.activeElement || e.contains(document.activeElement)")


def tab_until(page: Page, locator: Locator, presses: int = 40) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        if has_focus(locator):
            return
    pytest.fail(f"Tab never reached {locator} in {presses} presses")


def hold_by_click(page: Page, table: str) -> dict[str, Any]:
    is_hold = lambda r: r.request.method == "POST" and urlparse(r.url).path == "/api/holds"
    with page.expect_response(is_hold) as info:
        click(table_option(page, table, "Fits your party"))
    assert info.value.status == 201, f"hold from the plan answered {info.value.status}"
    expect(table_option(page, table, "Held by you")).to_be_visible()
    return info.value.json()


def fill_details(page: Page, name: str, email: str) -> None:
    fill(textbox(page, "Name"), name)
    fill(textbox(page, "Email"), email)


def pay_name(amount: str) -> str:
    return f"Pay €{amount} and book"


def deposit_box(page: Page, amount: str) -> Locator:
    return page.get_by_role("checkbox", name=f"I accept the €{amount} deposit and the refund rule above")


def bar_value(bar: Locator) -> float:
    return bar.evaluate("e => Number(e.getAttribute('aria-valuenow') ?? e.value)")


def bar_max(bar: Locator) -> float:
    return bar.evaluate("e => Number(e.getAttribute('aria-valuemax') ?? e.max)")


def record_announcements(status: Locator) -> None:
    status.evaluate(
        """el => {
            window.__announced = [el.textContent];
            new MutationObserver(() => window.__announced.push(el.textContent))
                .observe(el, {subtree: true, childList: true, characterData: true});
        }"""
    )


def await_announced(page: Page, copy: str, seconds: float = LIVE_SECONDS + SLACK_SECONDS) -> None:
    page.wait_for_function(
        "copy => window.__announced.some(text => text.includes(copy))", arg=copy, timeout=seconds * 1000
    )


def sign_in(page: Page, password: str = HOST_PASSWORD) -> None:
    fill(textbox(page, "Email"), HOST_EMAIL)
    fill(page.get_by_label("Password"), password)
    click(page.get_by_role("button", name="Sign in"))


def host_url(base: str, path: str) -> str:
    return f"{base}/host/sign-in?next={quote(path, safe='')}"


@contextmanager
def host_page(browser: Browser, base: str, path: str = "/host", **options: Any) -> Iterator[Page]:
    with visit(browser, host_url(base, path), **options) as page:
        sign_in(page)
        page.wait_for_url(lambda url: urlparse(url).path == "/host")
        expect(page.get_by_role("listbox", name="Tonight's floor")).to_be_visible()
        record_announcements(page.get_by_role("status", name="Floor updates"))
        yield page


def box(locator: Locator) -> dict[str, float]:
    rect = locator.bounding_box()
    assert rect, f"{locator} has no box"
    return rect


def text_height(locator: Locator) -> float:
    """Height of the element's rendered text (its line boxes), not of the element's own box."""
    return locator.evaluate(
        "e => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().height; }"
    )


def listen(page: Page, seen: list[str]) -> None:

    def note(request: Any) -> None:
        parsed = urlparse(request.url)
        seen.append(f"{request.method} {parsed.path}" + (f"?{parsed.query}" if parsed.query else ""))

    page.on("request", note)


def plan_index(seen: list[str], day: str, hhmm: str, party: int) -> int | None:
    for index, entry in enumerate(seen):
        method, _, target = entry.partition(" ")
        parsed = urlparse(target)
        params = parse_qs(parsed.query)
        if (
            method == "GET"
            and parsed.path == "/api/plan"
            and params.get("date") == [day]
            and params.get("time") == [hhmm]
            and params.get("party") == [str(party)]
        ):
            return index
    return None


def asked_for(seen: list[str], path: str, day: str) -> bool:
    for entry in seen:
        method, _, target = entry.partition(" ")
        parsed = urlparse(target)
        if method == "GET" and parsed.path == path and parse_qs(parsed.query).get("date") == [day]:
            return True
    return False


def table_dialog(page: Page, table: str) -> Locator:
    return page.get_by_role("dialog", name=re.compile(rf"^Table {table}$"))


def test_health_answers_with_dependencies_down(app_url: str, kb_down_url: str, valkey_down_url: str) -> None:
    for base in (app_url, kb_down_url, valkey_down_url):
        response = get(base, "/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
    await_status(app_url, holds="ok", deposits="ok")
    await_status(kb_down_url, deposits="paused")
    await_status(valkey_down_url, holds="paused")


def test_boundary_same_origin_json_and_size(app_url: str) -> None:
    url = f"{app_url}/api/waitlist"
    plain = {"Content-Type": "application/json"}

    def send(content: bytes, **headers: str) -> httpx.Response:
        return httpx.post(url, content=content, headers={**plain, **headers}, timeout=HTTP_TIMEOUT)

    assert_error(send(b"{}", Origin=FOREIGN_ORIGIN), 403, "cross_origin")
    assert_error(send(b"{}", Origin=app_url), 422, "validation_failed")
    assert_error(httpx.post(url, content=b"a=1", headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT), 415, "unsupported_media_type")
    assert_error(send(b"{not json"), 400, "malformed_json")
    padding = BODY_LIMIT - len(json.dumps({"pad": ""}))
    at_limit = json.dumps({"pad": "x" * padding}).encode()
    assert len(at_limit) == BODY_LIMIT
    assert_error(send(at_limit), 422, "validation_failed")
    assert_error(send(json.dumps({"pad": "x" * (padding + 1)}).encode()), 413, "body_too_large")


def test_boundary_never_serves_source_or_credentials(app_url: str) -> None:
    probes = {
        "/run.json": "run-manifest-v1",
        "/package-lock.json": "lockfileVersion",
        "/package.json": "devDependencies",
        "/.env": "DATABASE_URL",
    }
    for path, marker in probes.items():
        assert marker not in get(app_url, path).text, f"{path} served its contents"
    page_html = get(app_url, "/").text
    assets = [path for path in re.findall(r'(?:src|href)="(/[^"]+)"', page_html) if path.endswith((".js", ".css"))]
    assert assets, "the home page references no built assets"
    bodies = [page_html, get(app_url, "/api/rules").text, get(app_url, "/api/status").text]
    for asset in assets:
        bodies.append(get(app_url, asset).text)
        served = get(app_url, f"{asset}.map")
        assert not served.headers.get("content-type", "").startswith("application/json"), f"{asset}.map served a source map"
    names = ["DATABASE_URL", "VALKEY_URL", "KILLBILL_URL", "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET"]
    secrets = [os.environ[name] for name in names if len(os.environ.get(name, "")) >= MIN_SECRET_LENGTH]
    for secret in secrets:
        assert all(secret not in body for body in bodies), "a configured credential reached the browser"


def test_boundary_instances_share_state(app_url: str, kb_down_url: str, mail: Mailpit) -> None:
    day, hhmm, table = open_slot(app_url, 2)
    hold = take_hold(app_url, day, hhmm, 2, table)
    assert plan_status(kb_down_url, day, hhmm, 2)[table] == "taken"
    assert_error(place_hold(kb_down_url, day, hhmm, 2, table), 409, "table_taken")
    name, email = guest()
    response = confirm(kb_down_url, hold["hold_id"], name, email)
    assert response.status_code == 201, response.text
    assert get(app_url, f"/api/manage/{token_from(response.json()['manage_url'])}").status_code == 200
    one_mail(mail, email, "Booking confirmed: ")


def test_boot_exits_without_postgres() -> None:
    manifest = run_manifest()
    with tempfile.NamedTemporaryFile("w+", suffix=".log") as log, socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        env = {**os.environ, "DATABASE_URL": UNREACHABLE_DATABASE, "APP_PUBLIC_PORT": str(port)}
        copy = subprocess.Popen(
            manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=log, start_new_session=True
        )
        try:
            status = copy.wait(timeout=BOOT_SECONDS + BOOT_SLACK_SECONDS)
        except subprocess.TimeoutExpired:
            os.killpg(copy.pid, signal.SIGKILL)
            log.seek(0)
            pytest.fail(f"serve never gave up on Postgres; log tail: {log.read()[-2000:]}")
        log.seek(0)
        assert status != 0, f"serve exited 0 without Postgres; log tail: {log.read()[-2000:]}"


def test_error_shape_and_precedence(clock_url: str) -> None:
    base = clock_url
    day = evening(base)
    confirm_path = f"/api/holds/{JUNK_TOKEN}/confirm"
    good_key = idempotency_key()
    oversized = json.dumps({"pad": "x" * BODY_LIMIT})
    json_type = {"Content-Type": "application/json"}

    assert_error(httpx.post(f"{base}{confirm_path}", content=oversized, headers={**json_type, "Origin": FOREIGN_ORIGIN, "Idempotency-Key": good_key}, timeout=HTTP_TIMEOUT), 413, "body_too_large")
    assert_error(post_json(base, confirm_path, {}, Origin=FOREIGN_ORIGIN), 400, "idempotency_key_required")
    assert_error(post_json(base, confirm_path, {}, good_key, Origin=FOREIGN_ORIGIN), 403, "cross_origin")
    assert_error(post_json(base, host_action(UNKNOWN_REFERENCE, "seat"), {}, Origin=FOREIGN_ORIGIN), 403, "cross_origin")
    assert_error(post_json(base, host_action(UNKNOWN_REFERENCE, "seat"), {}), 401, "unauthenticated")
    assert_error(post_json(base, confirm_path, {"name": ""}, good_key), 404, "not_found")
    assert_error(get(base, f"/api/manage/{JUNK_TOKEN}"), 404, "not_found")
    assert_error(get(base, UNKNOWN_PATH), 404, "not_found")

    invalid = assert_error(post_json(base, "/api/holds", {}), 422, "validation_failed")
    assert set(invalid["fields"]) == {"date", "time", "party_size", "table_id"}

    expired = take_hold(base, day, "18:00", 2, "T1")
    closed = take_hold(base, day, "18:00", 2, "T2")
    name, email = guest()
    assert confirm(base, closed["hold_id"], name, email).status_code == 201
    invalid_closed = post_json(base, f"/api/holds/{closed['hold_id']}/confirm", {"name": "", "email": email}, idempotency_key())
    assert_error(invalid_closed, 422, "validation_failed")
    assert_error(confirm(base, closed["hold_id"], name, email), 409, "hold_closed")
    set_clock(base, parse_instant(expired["expires_at"]))
    bad_body = post_json(base, f"/api/holds/{expired['hold_id']}/confirm", {"name": ""}, idempotency_key())
    assert_error(bad_body, 410, "hold_expired")


@pytest.mark.parametrize("viewport", [PHONE, TABLET, DESKTOP], ids=["phone", "tablet", "desktop"])
def test_wf_find_a_time_breakpoints(browser: Browser, app_url: str, viewport: dict[str, int]) -> None:
    day, hhmm, table = open_slot(app_url, 2)
    with visit(browser, book_url(app_url, day, 2, hhmm), viewport=viewport) as page:
        hold_by_click(page, table)
        find = box(page.get_by_role("region", name="Find a time"))
        floor = box(page.get_by_role("region", name="Floor plan"))
        yours = box(page.get_by_role("region", name="Your table"))
        width = viewport["width"]
        if viewport is PHONE:
            assert find["y"] < floor["y"] < yours["y"]
            assert all(region["width"] >= width * 0.8 for region in (find, floor, yours))
        elif viewport is TABLET:
            assert find["x"] + find["width"] <= floor["x"] + 1
            assert find["width"] < floor["width"]
            assert yours["y"] >= floor["y"] + floor["height"] - 1
            assert yours["x"] >= find["x"] + find["width"] - 1
        else:
            assert find["x"] + find["width"] <= floor["x"] + 1
            assert floor["x"] + floor["width"] <= yours["x"] + 1
            assert yours["x"] + yours["width"] <= width + 1
        layout(page)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_party_and_date_bounds(browser: Browser, app_url: str) -> None:
    today = tonight(app_url)
    last, beyond, before = plus_days(today, 30), plus_days(today, 31), plus_days(today, -1)
    for party, day in ((1, today), (8, today), (2, last)):
        assert get(app_url, f"/api/availability?date={day}&party={party}").status_code == 200
    for party, day, key in (
        (0, today, "party"),
        (9, today, "party"),
        ("many", today, "party"),
        (2, beyond, "date"),
        (2, before, "date"),
        (2, "tomorrow", "date"),
    ):
        response = get(app_url, f"/api/availability?date={day}&party={party}")
        assert key in assert_error(response, 422, "validation_failed")["fields"]
    both = assert_error(get(app_url, f"/api/availability?date={beyond}&party=9"), 422, "validation_failed")
    assert set(both["fields"]) == {"date", "party"}
    bad_hold = place_hold(app_url, beyond, "20:00", 9, "T1")
    assert set(assert_error(bad_hold, 422, "validation_failed")["fields"]) == {"date", "party_size"}
    with visit(browser, f"{app_url}/book") as page:
        date_input = page.get_by_label("Date", exact=True)
        expect(date_input).to_have_attribute("min", today)
        expect(date_input).to_have_attribute("max", last)
        group = page.get_by_role("radiogroup", name="Party size")
        expect(group.get_by_role("radio")).to_have_count(8)
        expect(group.get_by_role("radio", name="1 guest", exact=True)).to_be_visible()


def test_slots_and_booking_lead(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    expected = [f"{hour:02d}:{minute:02d}" for hour in range(18, 22) for minute in (0, 15, 30, 45)] + ["22:00"]
    set_clock(clock_url, lisbon(day, "18:59") + timedelta(seconds=50))
    body = get(clock_url, f"/api/availability?date={day}&party=2").json()
    assert [row["time"] for row in body["slots"]] == expected
    by_time = {row["time"]: row for row in body["slots"]}
    assert by_time["18:00"]["reason"] == "past" and by_time["18:45"]["reason"] == "past"
    assert by_time["19:00"]["reason"] == "too_late" and by_time["19:45"]["reason"] == "too_late"
    assert by_time["20:00"]["bookable"] is True and by_time["20:00"]["reason"] is None
    assert parse_instant(by_time["20:00"]["starts_at"]) == lisbon(day, "20:00")
    assert_error(place_hold(clock_url, day, "19:45", 2, "T1"), 409, "slot_not_bookable")
    assert take_hold(clock_url, day, "20:00", 2, "T1")["status"] == "live"
    with visit(browser, book_url(clock_url, day, 2)) as page:
        late = slot(page, "19:30")
        expect(late).to_have_accessible_name(re.compile("too late to book online"))
        expect(late).to_be_disabled()
        click_target = slot(page, "20:15")
        expect(click_target).to_be_enabled()
    later = plus_days(day, 2)
    for table, hhmm in (("T7+T8", "20:00"), ("T11+T12", "20:00")):
        take_hold(clock_url, later, hhmm, 7, table)
    with visit(browser, book_url(clock_url, later, 7)) as page:
        free = covers_at(clock_url, later, "20:00", 7)["covers_free"]
        expect(slot(page, "20:00")).to_have_accessible_name(f"20:00, {free} covers free, waitlist only")


def test_wf_find_a_time_new_york_guest(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 3)
    start = lisbon(day, "20:30")
    new_york = start.astimezone(ZoneInfo("America/New_York"))
    with visit(browser, book_url(clock_url, day, 4), timezone_id="America/New_York") as page:
        expect(slot(page, "20:30")).to_have_accessible_name(f"20:30 ({new_york:%H:%M} your time), 64 covers free")
        expect(slot(page, "20:30")).to_contain_text(f"{new_york:%H:%M} your time")
    tokyo = lisbon(day, "18:00").astimezone(ZoneInfo("Asia/Tokyo"))
    with visit(browser, book_url(clock_url, day, 4), timezone_id="Asia/Tokyo") as page:
        expect(slot(page, "18:00")).to_have_accessible_name(f"18:00 ({tokyo:%H:%M} {tokyo:%a} your time), 64 covers free")
    with visit(browser, book_url(clock_url, day, 4)) as page:
        expect(slot(page, "20:30")).not_to_contain_text("your time")


def test_wf_browse_rooms_shared_count(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    client = host_client(clock_url)

    def agree(page_home: Page, page_book: Page, page_host: Page, covers: int, window_row: int) -> None:
        figure = page_home.get_by_role("figure", name="Window Row")
        expect(figure).to_contain_text(caption_start("Window Row", window_row, "18:00"))
        expect(slot(page_book, "18:00")).to_have_accessible_name(f"18:00, {covers} covers free")
        expect(page_host.get_by_role("region", name="Tonight's covers")).to_contain_text(f"{covers} covers free at 18:00")
        expect(page_host.get_by_role("region", name="Tonight's covers")).to_contain_text(f"Window Row: {window_row} of 10 seats free")
        row = covers_at(clock_url, day, "18:00")
        rooms = {room["room_id"]: room["covers_free"] for room in row["rooms"]}
        assert row["covers_free"] == covers == sum(rooms.values()) and rooms["window-row"] == window_row
        floor = host_floor(client, "18:00").json()["totals"]
        assert floor["covers_free"] == covers
        tonight_rooms = {room["room_id"]: room for room in get(clock_url, "/api/tonight").json()["rooms"]}
        assert tonight_rooms["window-row"]["covers_free_at_next_slot"] == window_row

    with visit(browser, f"{clock_url}/") as home, visit(browser, book_url(clock_url, day, 2)) as guest_page:
        with host_page(browser, clock_url, host_path("18:00")) as host:
            agree(home, guest_page, host, 64, 10)
            take_hold(clock_url, day, "18:00", 2, "T1")
            agree(home, guest_page, host, 62, 8)
            booked = book(clock_url, day, "18:00", 2, "T2")
            agree(home, guest_page, host, 60, 6)
            assert post_json(clock_url, f"/api/manage/{booked.token}/cancel", {}, idempotency_key()).status_code == 200
            agree(home, guest_page, host, 62, 8)
            assert walk_in(client, "T3", 2).status_code == 201
            agree(home, guest_page, host, 60, 6)
    held_end = plus_days(day, 1)
    take_hold(clock_url, held_end, "20:00", 2, "T1")
    assert covers_at(clock_url, held_end, "21:30")["covers_free"] == 62
    assert covers_at(clock_url, held_end, "21:45")["covers_free"] == 64
    assert covers_at(clock_url, held_end, "19:45")["covers_free"] == 64


def test_slot_covers_match_room_sum(clock_url: str) -> None:
    day = plus_days(evening(clock_url), 2)
    before = covers_at(clock_url, day, "20:00")
    assert before["covers_free"] == sum(room["covers_free"] for room in before["rooms"]) == 64
    take_hold(clock_url, day, "20:00", 2, "T1")
    after = covers_at(clock_url, day, "20:00")
    assert after["covers_free"] == sum(room["covers_free"] for room in after["rooms"]) == 62
    rooms = {room["room_id"]: room["covers_free"] for room in after["rooms"]}
    assert rooms["window-row"] == 8


def test_table_fit_on_plan(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 2)
    eligible = {
        1: set(TWO_TOPS),
        2: set(TWO_TOPS),
        3: {"T4", "T5", "T6", "T7", "T8", "T11", "T12", "T15", "T16"},
        4: {"T4", "T5", "T6", "T7", "T8", "T11", "T12", "T15", "T16"},
        5: {"T9", "T10"},
        6: {"T9", "T10"},
        7: {"T7+T8", "T11+T12"},
        8: {"T7+T8", "T11+T12"},
    }
    for party, tables in eligible.items():
        statuses = plan_status(clock_url, day, "20:00", party)
        assert {key for key, status in statuses.items() if status == "fits"} == tables, f"party of {party}"
        assert {status for key, status in statuses.items() if key not in tables} <= {"not_for_party"}
    with visit(browser, book_url(clock_url, day, 2, "20:00")) as page:
        named, room, low, high, status = "T1", "Window Row", 1, 2, "Fits your party"
        expect(table_option(page, named, status)).to_have_accessible_name(
            f"Table {named}, {room}, {low} to {high} seats, {status}"
        )
        expect(table_option(page, "T9", "Not for your party")).to_be_visible()
        expect(page.get_by_role("listbox", name="Tables").get_by_role("option", name=re.compile("joined"))).to_have_count(0)
        for table in TWO_TOPS:
            take_hold(clock_url, day, "20:00", 2, table)
        page.reload()
        expect(table_option(page, "T1", "Taken")).to_be_visible()
        expect(table_option(page, "T4", "Fits your party")).to_be_visible()
        expect(table_option(page, "T7", "Not for your party")).to_be_visible()
    widened = plan_status(clock_url, day, "20:00", 2)
    assert {key for key, status in widened.items() if status == "fits"} == {"T4", "T5", "T6", "T11", "T12", "T15", "T16"}
    with visit(browser, book_url(clock_url, day, 8, "20:00")) as page:
        expect(table_option(page, "T7+T8", "Fits your party")).to_have_accessible_name(
            "Tables T7 and T8 joined, Hearth, 7 to 8 seats, Fits your party"
        )


def test_wf_find_a_time_url_back_forward(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 2)
    with visit(browser, book_url(clock_url, day, 2)) as page:
        click(slot(page, "19:00"))
        await_query(page, time="19:00", party="2", date=day)
        heading = page.get_by_role("heading", level=1)
        expect(heading).to_have_text(f"{day_label(day)} · 19:00 · 2 guests")
        click(slot(page, "20:00"))
        await_query(page, time="20:00")
        page.go_back()
        await_query(page, time="19:00")
        expect(heading).to_have_text(f"{day_label(day)} · 19:00 · 2 guests")
        expect(slot(page, "19:00")).to_have_attribute("aria-selected", "true")
        page.go_forward()
        await_query(page, time="20:00")
        check(page.get_by_role("radiogroup", name="Party size").get_by_role("radio", name="4 guests"))
        await_query(page, party="4", time="20:00")
        expect(heading).to_have_text(f"{day_label(day)} · 20:00 · 4 guests")
        page.go_back()
        await_query(page, party="2", time="20:00")
        expect(table_option(page, "T1", "Fits your party")).to_be_visible()
        hold = hold_by_click(page, "T1")
        await_query(page, party="2", time="20:00")
        requests: list[str] = []
        listen(page, requests)
        page.go_back()
        await_query(page, time="19:00")
        poll(
            lambda: get(clock_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "released",
            HTTP_TIMEOUT,
            "Back released the live hold",
        )
        expect(page.get_by_role("progressbar", name="Hold time remaining")).to_have_count(0)
        expect(settings(page)).to_have_count(0)
        expect(table_option(page, "T1", "Fits your party")).to_be_visible()
        poll(
            lambda: plan_index(requests, day, "19:00", 2) is not None,
            HTTP_TIMEOUT,
            "Back loads the plan for the restored choice",
        )
        restored = plan_index(requests, day, "19:00", 2)
        assert restored is not None
        assert requests.index(f"DELETE /api/holds/{hold['hold_id']}") < restored
        relaid = hold_by_click(page, "T1")
        page.reload()
        expect(table_option(page, "T1", "Fits your party")).to_be_visible()
        expect(settings(page)).to_have_count(0)
        poll(
            lambda: get(clock_url, f"/api/holds/{relaid['hold_id']}").json()["status"] == "released",
            HTTP_TIMEOUT,
            "unloading the page released its live hold",
        )


def test_booking_url_defaults(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url, at="20:00")
    with visit(browser, "about:blank") as page:
        page.goto(f"{clock_url}/book?party=11")
        await_query(page, party="2", date=day)
        assert "time" not in query(page)
        expect(page.get_by_role("radiogroup", name="Party size").get_by_role("radio", name="2 guests")).to_be_checked()
        expect(page.get_by_label("Date", exact=True)).to_have_value(day)
        expect(page.get_by_role("heading", level=1)).to_have_text(f"{day_label(day)} · 2 guests")
        page.go_back()
        poll(lambda: page.url == "about:blank", HTTP_TIMEOUT, "applying a default added no history entry")
        future = plus_days(day, 2)
        for path, expected_date in (
            (f"/book?date={future}&party=3&time=18:07", future),
            (f"/book?date={plus_days(day, 31)}&party=3", day),
            (f"/book?date={day}&party=3&time=18:00", day),
        ):
            page.goto(f"{clock_url}{path}")
            await_query(page, date=expected_date, party="3")
            dropped_by = time.monotonic() + UI_TIMEOUT_MS / 1000
            while "time" in query(page) and time.monotonic() < dropped_by:
                page.wait_for_function("() => true")
            assert "time" not in query(page), f"{path} kept an unusable time"
        page.goto(book_url(clock_url, future, 3, "20:00"))
        await_query(page, date=future, party="3", time="20:00")
        expect(slot(page, "20:00")).to_have_attribute("aria-selected", "true")


def test_changing_choice_while_holding(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 2)
    with visit(browser, book_url(clock_url, day, 2, "20:00")) as page:
        hold = hold_by_click(page, "T1")
        fill_details(page, "Ana Ferreira", TYPED_EMAIL)
        click(slot(page, "20:00"))
        expect(table_option(page, "T1", "Held by you")).to_be_visible()
        assert get(clock_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "live"

        page.route(
            f"**/api/holds/{hold['hold_id']}",
            lambda route: route.fulfill(
                status=503,
                json={"error": {"code": "holds_paused", "message": "Holds are paused."}},
            ),
        )
        before = page.evaluate("history.length")
        click(slot(page, "20:30"))
        expect(banner(page, HOLDS_BANNER)).to_be_visible()
        await_query(page, time="20:00")
        assert page.evaluate("history.length") == before
        expect(page.get_by_role("heading", level=1)).to_have_text(f"{day_label(day)} · 20:00 · 2 guests")
        expect(table_option(page, "T1", "Held by you")).to_be_visible()
        expect(page.get_by_text(re.compile(r"^Held for \d:\d\d$"))).to_be_visible()
        page.unroute(f"**/api/holds/{hold['hold_id']}")

        requests: list[str] = []
        listen(page, requests)
        click(slot(page, "20:30"))
        await_query(page, time="20:30")
        expect(updates(page)).to_contain_text("Table T1 released.")
        poll(
            lambda: plan_index(requests, day, "20:30", 2) is not None,
            HTTP_TIMEOUT,
            "the plan for the new choice was requested",
        )
        restored = plan_index(requests, day, "20:30", 2)
        assert restored is not None
        assert requests.index(f"DELETE /api/holds/{hold['hold_id']}") < restored
        assert get(clock_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "released"
        expect(page.get_by_role("progressbar", name="Hold time remaining")).to_have_count(0)
        expect(page.get_by_text(re.compile("Your hold on table"))).to_have_count(0)
        expect(page.get_by_role("button", name="Book table")).to_be_disabled()
        expect(textbox(page, "Name")).to_have_value("Ana Ferreira")
        expect(textbox(page, "Email")).to_have_value(TYPED_EMAIL)


def test_pinned_room_run(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/") as page:
        title = page.get_by_role("heading", level=1, name="SAFFRON & SLATE")
        expect(title).to_have_text("SAFFRON & SLATE")
        tops = [box(page.get_by_role("figure", name=room))["y"] for room in ROOM_ORDER]
        assert tops == sorted(tops), f"rooms out of published order: {tops}"
        assert len(set(tops)) == 6
        for room in ROOM_ORDER:
            expect(page.get_by_role("figure", name=room)).to_contain_text(f"{room} · {ROOM_SEATS[room]} seats")
        assert page.evaluate("document.documentElement.scrollHeight >= 6 * window.innerHeight")
        first = box(title)
        assert first["y"] < DESKTOP["height"] / 4
        font = float(style(title, "font-size")["font-size"].removesuffix("px"))
        assert text_height(title) < font * 1.7, "the title should sit on one line on desktop"
        page.evaluate("window.scrollTo(0, window.innerHeight * 3)")
        expect(page.get_by_role("figure", name="Bar Rail")).to_be_in_viewport()
        assert abs(box(title)["y"] - first["y"]) <= 1, "the title scrolled away"
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        link = page.get_by_role("link", name="Book a table")
        expect(link).to_be_in_viewport()
        assert box(link)["x"] > DESKTOP["width"] / 2
        expect(page.get_by_text("Pick the table, not just the time. We hold it for five minutes while you decide.")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        click(link)
        page.wait_for_url(lambda url: urlparse(url).path == "/book")
    with visit(browser, f"{app_url}/", viewport=PHONE) as page:
        title = page.get_by_role("heading", level=1, name="SAFFRON & SLATE")
        font = float(style(title, "font-size")["font-size"].removesuffix("px"))
        assert text_height(title) >= font * 1.5, "the title should sit on two lines on the phone"
        assert box(title)["width"] >= PHONE["width"] * 0.7
        link = page.get_by_role("link", name="Book a table")
        for scroll in (0, PHONE["height"] * 2):
            page.evaluate("y => window.scrollTo(0, y)", scroll)
            rect = box(link)
            assert abs(PHONE["width"] - (rect["x"] + rect["width"]) - BUTTON_INSET_PX) <= 1
            assert abs(PHONE["height"] - (rect["y"] + rect["height"]) - BUTTON_INSET_PX) <= 1


def test_live_captions_change_in_place(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    window_end = (lisbon(day, "18:00") + timedelta(minutes=90 + 15)).strftime("%H:%M")
    with visit(browser, f"{clock_url}/") as page:
        figure = page.get_by_role("figure", name="Bar Rail")
        expect(figure).to_contain_text(caption("Bar Rail", 4, "18:00", "18:00"))
        figure.scroll_into_view_if_needed()
        node = figure.element_handle()
        scroll = page.evaluate("window.scrollY")
        rect, title_rect = box(figure), box(page.get_by_role("heading", level=1))
        take_hold(clock_url, day, "18:00", 2, "T13")
        expect(figure).to_contain_text(
            caption("Bar Rail", 2, "18:00", "18:00"),
            timeout=(LIVE_SECONDS + SLACK_SECONDS) * 1000,
        )
        take_hold(clock_url, day, "18:00", 2, "T14")
        expect(figure).to_contain_text(
            caption("Bar Rail", 0, "18:00", window_end),
            timeout=(LIVE_SECONDS + SLACK_SECONDS) * 1000,
        )
        assert figure.evaluate("(e, kept) => e === kept", node), "the figure was re-created"
        assert page.evaluate("window.scrollY") == scroll
        assert abs(box(figure)["y"] - rect["y"]) <= 1
        assert abs(box(page.get_by_role("heading", level=1))["y"] - title_rect["y"]) <= 1
    tonight_body = get(clock_url, "/api/tonight").json()
    assert tonight_body["next_slot"] == "18:00"
    bar = next(room for room in tonight_body["rooms"] if room["room_id"] == "bar-rail")
    assert bar["covers_free_at_next_slot"] == 0 and bar["next_table_for_two"] == window_end
    set_clock(clock_url, lisbon(day, "21:30"))
    assert get(clock_url, "/api/tonight").json()["next_slot"] is None
    with visit(browser, f"{clock_url}/") as page:
        expect(page.get_by_role("figure", name="Bar Rail")).to_contain_text(
            f"Bar Rail · {ROOM_SEATS['Bar Rail']} seats · Online booking for tonight has closed"
        )


def test_wf_browse_rooms_live_caption_journey(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    with visit(browser, f"{clock_url}/") as page:
        figure = page.get_by_role("figure", name="Courtyard")
        expect(figure).to_contain_text(caption_start("Courtyard", 8, "18:00"))
        figure.scroll_into_view_if_needed()
        scroll = page.evaluate("window.scrollY")
        with visit(browser, book_url(clock_url, day, 3, "18:00")) as other:
            hold_by_click(other, "T15")
            expect(figure).to_contain_text(caption_start("Courtyard", 4, "18:00"), timeout=(LIVE_SECONDS + SLACK_SECONDS) * 1000)
            assert page.evaluate("window.scrollY") == scroll
        link = page.get_by_role("link", name="Book a table")
        link.scroll_into_view_if_needed()
        click(link)
        page.wait_for_url(lambda url: urlparse(url).path == "/book")
        expect(page.get_by_role("region", name="Find a time")).to_be_visible()


def test_wf_browse_rooms_phone_touch_reduced_motion(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    with visit(browser, f"{clock_url}/", viewport=PHONE, has_touch=True, reduced_motion="reduce") as page:
        for room in ROOM_ORDER:
            expect(page.get_by_role("figure", name=room)).to_contain_text(room)
        title = page.get_by_role("heading", level=1, name="SAFFRON & SLATE")
        assert box(title)["y"] >= 0
        page.evaluate("window.scrollTo(0, window.innerHeight * 2)")
        expect(title).not_to_be_in_viewport()
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        tap(page.get_by_role("link", name="Book a table"))
        page.wait_for_url(lambda url: urlparse(url).path == "/book")
        page.goto(book_url(clock_url, day, 2, "18:00"))
        with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path == "/api/holds") as info:
            tap(table_option(page, "T1", "Fits your party"))
        assert info.value.status == 201
        expect(setting(page, 2, 2, "T1")).to_be_attached()
        expect(page.get_by_text(re.compile(r"^Held for \d:\d\d$"))).to_be_visible()


def test_published_floor_and_rules(app_url: str, short_url: str) -> None:
    floor = get(app_url, "/api/floor").json()
    expected = {
        "window-row": ("Window Row", 10, {"T1": (1, 2), "T2": (1, 2), "T3": (1, 2), "T4": (2, 4)}),
        "hearth": ("Hearth", 16, {"T5": (2, 4), "T6": (2, 4), "T7": (3, 4), "T8": (3, 4)}),
        "slate-room": ("Slate Room", 20, {"T9": (4, 6), "T10": (5, 6), "T11": (2, 4), "T12": (2, 4)}),
        "bar-rail": ("Bar Rail", 4, {"T13": (1, 2), "T14": (1, 2)}),
        "courtyard": ("Courtyard", 8, {"T15": (2, 4), "T16": (2, 4)}),
        "chefs-counter": ("Chef's Counter", 6, {"C1": (1, 2), "C2": (1, 2), "C3": (1, 2)}),
    }
    assert [room["room_id"] for room in floor["rooms"]] == list(expected)
    for room in floor["rooms"]:
        name, seats, tables = expected[room["room_id"]]
        assert (room["name"], room["seats"]) == (name, seats)
        assert {t["table_id"]: (t["min_seats"], t["max_seats"]) for t in room["tables"]} == tables
    pairs = {pair["pair_id"]: pair for pair in floor["joinable_pairs"]}
    assert set(pairs) == {"T7+T8", "T11+T12"}
    assert pairs["T7+T8"]["tables"] == ["T7", "T8"] and pairs["T11+T12"]["tables"] == ["T11", "T12"]
    assert all((pair["min_seats"], pair["max_seats"]) == (7, 8) for pair in pairs.values())
    rules = get(app_url, "/api/rules").json()
    slot_times = [f"{hour:02d}:{minute:02d}" for hour in range(18, 22) for minute in (0, 15, 30, 45)] + ["22:00"]
    assert rules == {
        "timezone": "Europe/Lisbon",
        "slot_times": slot_times,
        "booking_lead_minutes": 60,
        "booking_horizon_days": 30,
        "hold_seconds": HOLD_SECONDS,
        "offer_seconds": OFFER_SECONDS,
        "turn_minutes": {"1-2": 90, "3-4": 105, "5-6": 120, "7-8": 150},
        "reset_minutes": 15,
        "deposit_cents_per_cover": 1500,
        "deposit_min_party": 5,
        "deposit_rooms": ["chefs-counter"],
        "refund_cutoff_hours": 24,
        "no_show_after_minutes": 15,
        "host_session_hours": 12,
    }
    short = get(short_url, "/api/rules").json()
    assert (short["hold_seconds"], short["offer_seconds"]) == (SHORT_TIMER_SECONDS, SHORT_TIMER_SECONDS)


def test_turn_windows_overlap_and_touch(clock_url: str) -> None:
    day = plus_days(evening(clock_url), 2)
    cases = [
        (2, "T1", "20:00", "21:45", "21:30", "18:15"),
        (4, "T4", "20:00", "22:00", "21:45", "18:00"),
        (6, "T9", "19:45", "22:00", "21:45", None),
        (8, "T7+T8", "18:00", "20:45", "20:30", None),
    ]
    for party, table, start, after, overlap, before in cases:
        take_hold(clock_url, day, start, party, table)
        assert_error(place_hold(clock_url, day, overlap, party, table), 409, "table_taken")
        take_hold(clock_url, day, after, party, table)
        if before:
            take_hold(clock_url, day, before, party, table)
    booked_day = plus_days(day, 1)
    booked = book(clock_url, booked_day, "20:00", 2, "T2")
    assert booked.table == "T2"
    assert_error(place_hold(clock_url, booked_day, "21:30", 2, "T2"), 409, "table_taken")
    assert_error(place_hold(clock_url, booked_day, "18:30", 2, "T2"), 409, "table_taken")
    take_hold(clock_url, booked_day, "21:45", 2, "T2")
    take_hold(clock_url, booked_day, "18:15", 2, "T2")
    pair_day = plus_days(day, 2)
    take_hold(clock_url, pair_day, "20:00", 7, "T7+T8")
    assert plan_status(clock_url, pair_day, "20:00", 4)["T7"] == "taken"
    assert plan_status(clock_url, pair_day, "20:00", 4)["T8"] == "taken"


def test_hold_refusal_codes(clock_url: str) -> None:
    day = plus_days(evening(clock_url), 2)
    take_hold(clock_url, day, "20:00", 2, "T1")
    assert_error(place_hold(clock_url, day, "20:00", 2, "T1"), 409, "table_taken")
    assert_error(place_hold(clock_url, day, "20:00", 5, "T1"), 409, "table_not_for_party")
    assert_error(place_hold(clock_url, day, "20:00", 2, "T9"), 409, "table_not_for_party")
    assert_error(place_hold(clock_url, day, "20:00", 2, "T4"), 409, "table_not_for_party")
    assert_error(place_hold(clock_url, day, "20:00", 7, "T9"), 409, "table_not_for_party")


def test_hold_sets_one_claim_per_covered_slot(clock_url: str, valkey: Valkey) -> None:
    day = plus_days(evening(clock_url), 2)
    hold = take_hold(clock_url, day, "20:00", 2, "T1")
    assert hold["status"] == "live" and hold["table_id"] == "T1" and hold["party_size"] == 2
    assert hold["deposit_cents"] == 0
    assert parse_instant(hold["expires_at"]) - parse_instant(hold["server_now"]) <= timedelta(seconds=HOLD_SECONDS)
    assert parse_instant(hold["expires_at"]) - parse_instant(hold["server_now"]) > timedelta(seconds=HOLD_SECONDS - 5)
    times = ["20:00", "20:15", "20:30", "20:45", "21:00", "21:15", "21:30"]
    expected = [f"clock:hold:T1:{day}T{hhmm}" for hhmm in times]
    assert valkey.keys(f"clock:hold:T1:{day}T*") == sorted(expected)
    for key in expected:
        assert valkey.command("GET", key) == hold["hold_id"]
        life = int(valkey.command("PTTL", key))
        assert 0 < life <= HOLD_SECONDS * 1000
    assert delete(clock_url, f"/api/holds/{hold['hold_id']}").status_code == 204
    assert valkey.keys(f"clock:hold:T1:{day}T*") == []

    pair = take_hold(clock_url, day, "22:00", 7, "T7+T8")
    next_day = plus_days(day, 1)
    for table in ("T7", "T8"):
        keys = valkey.keys(f"clock:hold:{table}:*")
        assert f"clock:hold:{table}:{day}T22:00" in keys
        assert f"clock:hold:{table}:{next_day}T00:30" in keys
        assert f"clock:hold:{table}:{next_day}T00:45" not in keys
    assert valkey.command("GET", f"clock:hold:T7:{next_day}T00:30") == pair["hold_id"]


def test_wf_hold_a_table_race(app_url: str, kb_down_url: str, valkey: Valkey) -> None:
    day, hhmm, table = open_slot(app_url, 2)
    bases = [app_url, kb_down_url] * 4
    with ThreadPoolExecutor(8) as pool:
        answers = list(pool.map(lambda base: place_hold(base, day, hhmm, 2, table), bases))
    winners = [answer for answer in answers if answer.status_code == 201]
    assert len(winners) == 1, [answer.status_code for answer in answers]
    for answer in answers:
        if answer.status_code != 201:
            assert_error(answer, 409, "table_taken")
    winner = winners[0].json()
    keys = valkey.keys(f"hold:{table}:{day}T*")
    assert keys and all(valkey.command("GET", key) == winner["hold_id"] for key in keys)
    assert plan_status(app_url, day, hhmm, 2)[table] == "taken"


def test_losing_pair_hold_leaves_no_key(clock_url: str, valkey: Valkey) -> None:
    day = plus_days(evening(clock_url), 2)
    single = take_hold(clock_url, day, "20:00", 4, "T8")
    t8_before = valkey.keys(f"clock:hold:T8:{day}T*")
    assert_error(place_hold(clock_url, day, "19:00", 7, "T7+T8"), 409, "table_taken")
    assert valkey.keys(f"clock:hold:T7:{day}T*") == []
    assert valkey.keys(f"clock:hold:T8:{day}T*") == t8_before
    assert all(valkey.command("GET", key) == single["hold_id"] for key in t8_before)
    with ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda _: place_hold(clock_url, day, "20:00", 7, "T11+T12"), range(6)))
    assert sorted(answer.status_code for answer in answers) == [201] + [409] * 5
    owner = next(answer for answer in answers if answer.status_code == 201).json()["hold_id"]
    for table in ("T11", "T12"):
        keys = valkey.keys(f"clock:hold:{table}:{day}T*")
        assert keys and all(valkey.command("GET", key) == owner for key in keys)


def test_offer_and_hold_race_on_freed_table(clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 2)
    first = take_hold(clock_url, day, "20:00", 2, "T1")
    response, email = join(clock_url, day, 2, "20:00", "20:00")
    assert response.status_code == 201
    with ThreadPoolExecutor(5) as pool:
        released = pool.submit(delete, clock_url, f"/api/holds/{first['hold_id']}")
        racers = [pool.submit(place_hold, clock_url, day, "20:00", 2, "T1") for _ in range(4)]
    assert released.result().status_code == 204
    answers = [racer.result() for racer in racers]
    wins = [answer for answer in answers if answer.status_code == 201]
    for answer in answers:
        if answer.status_code != 201:
            assert_error(answer, 409, "table_taken")
    offers = inbox(mail, email, "A table is free: ", settle=MAIL_SECONDS + SLACK_SECONDS)
    assert len(wins) + len(offers) == 1, f"{len(wins)} holds and {len(offers)} offers won one table"


def test_laying_the_table_waits_for_201(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 2)
    table, party = "T4", 4
    with paused(browser, book_url(clock_url, day, party, "20:00")) as page:
        option = table_option(page, table, "Fits your party")
        pump(page, lambda: option.count() == 1, f"table {table} is drawn as fitting", step_ms=50)
        parked: list[Any] = []
        page.route("**/api/holds", lambda route: parked.append(route))
        click(option)
        pump(page, lambda: bool(parked), "the hold request was sent", step_ms=50)
        advance(page, 500)
        expect(option).to_have_count(1)
        expect(settings(page)).to_have_count(0)
        expect(updates(page)).to_contain_text(f"Holding table {table}...")
        with page.expect_response("**/api/holds") as info:
            parked[0].continue_()
        assert info.value.status == 201
        images = settings(page, table)
        pump(page, lambda: images.count() >= 1, "the first place setting entered after the 201")
        margin = STAGGER_MS * 3 / 7
        elapsed = 0.0
        for k in range(2, party + 1):
            target = (k - 1) * STAGGER_MS - margin
            advance(page, target - elapsed)
            elapsed = target
            assert images.count() == k - 1, f"setting {k} entered before {(k - 1) * STAGGER_MS} ms"
            target = (k - 1) * STAGGER_MS + margin
            advance(page, target - elapsed)
            elapsed = target
            pump(page, lambda: images.count() >= k, f"setting {k} entered at {(k - 1) * STAGGER_MS} ms", step_ms=0)
        advance(page, 500)
        for k in range(1, party + 1):
            expect(setting(page, k, party, table)).to_be_attached()
        expect(table_option(page, table, "Held by you")).to_be_visible()
        expect(updates(page)).to_contain_text(f"Table {table} is held for you.")
        centres = []
        for k in range(1, party + 1):
            rect = box(setting(page, k, party, table))
            centres.append((rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2))
        middle_x = sum(point[0] for point in centres) / party
        middle_y = sum(point[1] for point in centres) / party
        assert centres[0][1] < middle_y, "setting 1 should sit at the top of the table"
        for (x1, y1), (x2, y2) in zip(centres, centres[1:]):
            assert (x1 - middle_x) * (y2 - middle_y) - (y1 - middle_y) * (x2 - middle_x) > 0, "settings run clockwise"
        bar = page.get_by_role("progressbar", name="Hold time remaining")
        assert bar_max(bar) == HOLD_SECONDS
        first_value = bar_value(bar)
        assert 0 < first_value <= HOLD_SECONDS
        countdown = page.get_by_text(re.compile(r"^Held for \d:\d\d$"))
        before = countdown.inner_text()
        assert re.fullmatch(r"Held for (5:00|4:\d\d)", before), before
        advance(page, 2000)
        assert countdown.inner_text() != before
        assert bar_value(bar) < first_value


def test_lost_race_turns_taken_without_settings(browser: Browser, app_url: str) -> None:
    day, hhmm, table = open_slot(app_url, 2)
    with visit(browser, book_url(app_url, day, 2, hhmm)) as page:
        expect(table_option(page, table, "Fits your party")).to_be_visible()
        page.route(
            "**/api/holds",
            lambda route: route.fulfill(status=409, json={"error": {"code": "table_taken", "message": "Taken."}}),
        )
        click(table_option(page, table, "Fits your party"))
        expect(updates(page)).to_contain_text(f"Table {table} was just taken. Pick another table.")
        expect(table_option(page, table, "Taken")).to_be_visible()
        expect(settings(page)).to_have_count(0)
        expect(page.get_by_role("progressbar", name="Hold time remaining")).to_have_count(0)


def test_wf_hold_a_table_device_clock_wrong(browser: Browser, clock_url: str, mail: Mailpit) -> None:
    day = evening(clock_url)
    token, _, _ = offer_for(clock_url, mail, plus_days(day, 2), "18:00", 2, "T1")
    for skew in (timedelta(hours=3), timedelta(hours=-3)):
        context = browser.new_context(viewport=DESKTOP, timezone_id="Europe/Lisbon", locale="en-US")
        page = context.new_page()
        try:
            page.clock.install(time=datetime.now().astimezone() + skew)
            target = plus_days(day, 3)
            page.goto(f"{clock_url}/book")
            expect(page.get_by_label("Date", exact=True)).to_have_value(day)
            expect(page.get_by_label("Date", exact=True)).to_have_attribute("min", day)
            page.goto(book_url(clock_url, day, 2))
            row = covers_at(clock_url, day, "18:00")
            assert row["bookable"] is True
            expect(slot(page, "18:00")).to_be_enabled()
            page.goto(book_url(clock_url, target, 2, "20:00"))
            table = "T2" if skew > timedelta(0) else "T3"
            hold_by_click(page, table)
            expect(page.get_by_text(re.compile(r"^Held for (5:00|4:\d\d)$"))).to_be_visible()
            page.goto(f"{clock_url}/offer/{token}")
            expect(page.get_by_text(re.compile(r"^Offer ends in (15:00|14:\d\d)$"))).to_be_visible()
            expect(page.get_by_role("button", name="Claim table")).to_be_enabled()
        finally:
            context.close()


def test_wf_book_a_table_hold_ends_while_typing(browser: Browser, short_url: str) -> None:
    day, hhmm, table = open_slot(short_url, 2)
    with visit(browser, book_url(short_url, day, 2, hhmm)) as page:
        hold = hold_by_click(page, table)
        granted = time.monotonic()
        fill(textbox(page, "Name"), "Ana Ferreira")
        fill(textbox(page, "Email"), TYPED_EMAIL)
        fill(textbox(page, "Phone (optional)"), TYPED_PHONE)
        life = (parse_instant(hold["expires_at"]) - parse_instant(hold["server_now"])).total_seconds()
        left = granted + life + LIFT_SECONDS + SLACK_SECONDS - time.monotonic()
        notice = f"Your hold on table {table} has ended."
        expect(page.get_by_role("region", name="Your table")).to_contain_text(notice, timeout=left * 1000)
        expect(updates(page)).to_contain_text(notice)
        expect(page.get_by_role("button", name="Book table")).to_be_disabled()
        expect(settings(page, table)).to_have_count(0, timeout=(LIFT_SECONDS + SLACK_SECONDS) * 1000)
        for label, value in (("Name", "Ana Ferreira"), ("Email", TYPED_EMAIL), ("Phone (optional)", TYPED_PHONE)):
            expect(textbox(page, label)).to_have_value(value)
        assert_error(confirm(short_url, hold["hold_id"], "Ana Ferreira", TYPED_EMAIL), 410, "hold_expired")
        assert get(short_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "expired"
        expect(table_option(page, table, "Fits your party")).to_be_visible()
        hold_by_click(page, table)
        expect(page.get_by_text(notice)).to_have_count(0)
        expect(textbox(page, "Name")).to_have_value("Ana Ferreira")
        expect(textbox(page, "Email")).to_have_value(TYPED_EMAIL)


def test_hold_expiry_edge_on_server_clock(clock_url: str, valkey: Valkey) -> None:
    day = plus_days(evening(clock_url), 2)
    early = take_hold(clock_url, day, "20:00", 2, "T1")
    set_clock(clock_url, parse_instant(early["expires_at"]) - timedelta(seconds=3))
    name, email = guest()
    assert confirm(clock_url, early["hold_id"], name, email).status_code == 201
    late = take_hold(clock_url, day, "20:00", 2, "T2")
    set_clock(clock_url, parse_instant(late["expires_at"]))
    assert_error(confirm(clock_url, late["hold_id"], name, email), 410, "hold_expired")
    poll(
        lambda: get(clock_url, f"/api/holds/{late['hold_id']}").json()["status"] == "expired"
        and valkey.keys(f"clock:hold:T2:{day}T*") == [],
        LIVE_SECONDS + SLACK_SECONDS,
        "the expired hold is marked expired and its claims are removed",
    )
    assert plan_status(clock_url, day, "20:00", 2)["T2"] == "fits"


def test_lift_off_runs_from_the_last_setting(browser: Browser, short_url: str) -> None:
    party = 3
    day, hhmm, table = open_slot(short_url, party)
    with paused(browser, book_url(short_url, day, party, hhmm)) as page:
        option = table_option(page, table, "Fits your party")
        pump(page, lambda: option.count() == 1, "the plan loaded", step_ms=50)
        click(option)
        images = settings(page, table)
        pump(page, lambda: images.count() == party, "all settings laid", step_ms=20)
        deadline = time.monotonic() + SHORT_TIMER_SECONDS + LIFT_SECONDS + SLACK_SECONDS
        seen: list[int] = []
        while time.monotonic() < deadline:
            advance(page, 5)
            names = [images.nth(i).get_attribute("aria-label") or "" for i in range(images.count())]
            present = sorted(int(m.group(1)) for m in (re.search(r"setting (\d+)", n) for n in names) if m)
            if present and present != list(range(1, len(present) + 1)):
                pytest.fail(f"settings left out of order; still present: {present}")
            if not seen or seen[-1] != images.count():
                seen.append(images.count())
            if images.count() == 0:
                break
        assert seen[-1] == 0, f"settings never lifted off; counts seen {seen}"
        assert seen == sorted(seen, reverse=True), seen


def test_release_frees_table_for_open_plans(browser: Browser, clock_url: str, valkey: Valkey) -> None:
    day = plus_days(evening(clock_url), 2)
    live_ms = (LIVE_SECONDS + SLACK_SECONDS) * 1000
    with visit(browser, book_url(clock_url, day, 2, "20:00")) as page, visit(browser, book_url(clock_url, day, 2, "20:00")) as other:
        hold = hold_by_click(page, "T1")
        expect(table_option(other, "T1", "Taken")).to_be_visible(timeout=live_ms)
        click(page.get_by_role("button", name="Release table"))
        expect(table_option(other, "T1", "Fits your party")).to_be_visible(timeout=live_ms)
        expect(updates(page)).to_contain_text("Table T1 released.")
        assert has_focus(page.get_by_role("listbox", name="Tables"))
        assert get(clock_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "released"
        assert valkey.keys(f"clock:hold:T1:{day}T*") == []
        expect(page.get_by_role("region", name="Your table")).to_be_visible()

        first = hold_by_click(page, "T1")
        hold_by_click(page, "T2")
        expect(table_option(other, "T1", "Fits your party")).to_be_visible(timeout=live_ms)
        expect(table_option(other, "T2", "Taken")).to_be_visible(timeout=live_ms)
        assert get(clock_url, f"/api/holds/{first['hold_id']}").json()["status"] == "released"
    hold = take_hold(clock_url, day, "20:00", 2, "T3")
    assert delete(clock_url, f"/api/holds/{hold['hold_id']}").status_code == 204
    assert delete(clock_url, f"/api/holds/{hold['hold_id']}").status_code == 204
    booked = take_hold(clock_url, day, "20:00", 2, "T13")
    name, email = guest()
    assert confirm(clock_url, booked["hold_id"], name, email).status_code == 201
    assert_error(delete(clock_url, f"/api/holds/{booked['hold_id']}"), 409, "hold_closed")
    expired = take_hold(clock_url, day, "20:00", 2, "T14")
    set_clock(clock_url, parse_instant(expired["expires_at"]))
    assert_error(delete(clock_url, f"/api/holds/{expired['hold_id']}"), 410, "hold_expired")


def test_wf_hold_a_table_refused_release(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 2)
    with visit(browser, book_url(clock_url, day, 2, "20:00")) as page:
        hold = hold_by_click(page, "T1")
        expect(setting(page, 2, 2, "T1")).to_be_attached()
        page.route(
            f"**/api/holds/{hold['hold_id']}",
            lambda route: route.fulfill(status=503, json={"error": {"code": "holds_paused", "message": "Paused."}}),
        )
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" else None)
        click(page.get_by_role("button", name="Release table"))
        expect(banner(page, HOLDS_BANNER)).to_be_visible()
        expect(table_option(page, "T1", "Held by you")).to_be_visible()
        expect(setting(page, 2, 2, "T1")).to_be_attached()
        countdown = page.get_by_text(re.compile(r"^Held for \d:\d\d$"))
        before = countdown.inner_text()
        expect(countdown).not_to_have_text(before)
        click(table_option(page, "T2", "Fits your party"))
        expect(table_option(page, "T1", "Held by you")).to_be_visible()
        assert not [url for url in posts if urlparse(url).path == "/api/holds"], "a new hold was requested"
        assert get(clock_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "live"
        assert plan_status(clock_url, day, "20:00", 2)["T1"] == "taken"


def test_holds_paused_on_every_table_action(
    browser: Browser, app_url: str, valkey_down_url: str, mail: Mailpit
) -> None:
    day, hhmm, table = open_slot(app_url, 2)
    hold = take_hold(app_url, day, hhmm, 2, table)
    name, email = guest()

    def timed(call: Callable[[], httpx.Response]) -> httpx.Response:
        started = time.monotonic()
        answer = call()
        assert time.monotonic() - started <= HOLDS_PAUSED_SECONDS + SLACK_SECONDS
        return answer

    assert_error(timed(lambda: place_hold(valkey_down_url, day, "18:00", 2, table)), 503, "holds_paused")
    assert_error(timed(lambda: delete(valkey_down_url, f"/api/holds/{hold['hold_id']}")), 503, "holds_paused")
    assert_error(timed(lambda: confirm(valkey_down_url, hold["hold_id"], name, email)), 503, "holds_paused")
    client = host_client(valkey_down_url)
    assert_error(timed(lambda: walk_in(client, "T16", 2)), 503, "holds_paused")
    assert get(app_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "live"
    no_mail(mail, email)
    assert delete(app_url, f"/api/holds/{hold['hold_id']}").status_code == 204

    offer_day, offer_time, offer_table = open_slot(app_url, 2)
    token, _, _ = offer_for(app_url, mail, offer_day, offer_time, 2, offer_table)
    claim = timed(lambda: post_json(valkey_down_url, f"/api/offers/{token}/claim", {}, idempotency_key()))
    assert_error(claim, 503, "holds_paused")
    assert get(app_url, f"/api/offers/{token}").json()["status"] == "offered"

    assert get(valkey_down_url, f"/api/plan?date={day}&time={quote(hhmm)}&party=2").status_code == 200
    with visit(browser, book_url(valkey_down_url, day, 2, hhmm)) as page:
        expect(banner(page, HOLDS_BANNER)).to_be_visible()
        fits = first_fit(valkey_down_url, day, hhmm, 2)
        assert fits
        click(table_option(page, fits, "Fits your party"))
        expect(table_option(page, fits, "Fits your party")).to_be_visible()
        expect(settings(page)).to_have_count(0)


def test_wf_book_a_table_keyboard_only(browser: Browser, clock_url: str, killbill: KillBill) -> None:
    today = evening(clock_url, day_of_month=10)
    next_day = plus_days(today, 1)
    name, email = guest("keys")
    with visit(browser, f"{clock_url}/book?date={today}&party=2") as page:
        group = page.get_by_role("radiogroup", name="Party size")
        tab_until(page, group)
        for _ in range(4):
            page.keyboard.press("ArrowRight")
        await_query(page, party="6")
        expect(group.get_by_role("radio", name="6 guests")).to_be_checked()
        date_input = page.get_by_label("Date", exact=True)
        tab_until(page, date_input)
        page.keyboard.press("Tab")
        page.keyboard.press("ArrowUp")
        await_query(page, date=next_day, party="6")
        times = page.get_by_role("listbox", name="Times")
        tab_until(page, times)
        page.keyboard.press("Home")
        page.keyboard.press("Enter")
        await_query(page, time="18:00")
        for _ in range(4):
            page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        await_query(page, time="19:00")
        floor = page.get_by_role("listbox", name="Tables")
        expect(table_option(page, "T9", "Fits your party")).to_be_visible()
        holds: list[str] = []
        page.on("request", lambda r: holds.append(r.url) if r.method == "POST" else None)
        tab_until(page, floor)
        page.keyboard.press("End")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        expect(table_option(page, "T1", "Not for your party")).to_be_visible()
        assert holds == [], "Enter on a table that does not fit sent a request"
        for _ in range(SEED_ORDER.index("T10")):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        expect(table_option(page, "T10", "Held by you")).to_be_visible()
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Release table")).to_be_focused()
        page.keyboard.press("Tab")
        expect(textbox(page, "Name")).to_be_focused()
        page.keyboard.type(name)
        page.keyboard.press("Tab")
        expect(textbox(page, "Email")).to_be_focused()
        page.keyboard.type(email)
        page.keyboard.press("Tab")
        expect(textbox(page, "Phone (optional)")).to_be_focused()
        page.keyboard.press("Tab")
        box_control = deposit_box(page, "90.00")
        expect(box_control).to_be_focused()
        page.keyboard.press("Space")
        expect(box_control).to_be_checked()
        page.keyboard.press("Tab")
        pay = page.get_by_role("button", name=pay_name("90.00"))
        expect(pay).to_be_focused()
        page.keyboard.press("Enter")
        heading = page.get_by_role("heading", level=1, name="You're booked")
        expect(heading).to_be_focused()
        cancel = page.get_by_role("button", name="Cancel booking")
        tab_until(page, cancel)
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name="Keep booking")).to_be_focused()
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Yes, cancel")).to_be_focused()
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", level=1, name="Booking cancelled")).to_be_focused()
    assert [amount_of(t) for t in kill_bill_transactions(killbill, email, "PURCHASE")] == [Decimal("90")]
    assert [amount_of(t) for t in kill_bill_transactions(killbill, email, "REFUND")] == [Decimal("90")]


def test_wf_book_a_table_happy_path(browser: Browser, clock_url: str, mail: Mailpit) -> None:
    today = evening(clock_url)
    day = plus_days(today, 3)
    name, email = guest("two")
    with visit(browser, f"{clock_url}/book") as page:
        check(page.get_by_role("radiogroup", name="Party size").get_by_role("radio", name="2 guests"))
        fill(page.get_by_label("Date", exact=True), day)
        await_query(page, date=day, party="2")
        click(slot(page, "20:30"))
        await_query(page, time="20:30")
        click(slot(page, "19:30"))
        await_query(page, time="19:30")
        page.go_back()
        await_query(page, time="20:30", party="2", date=day)
        expect(page.get_by_role("heading", level=1)).to_have_text(f"{day_label(day)} · 20:30 · 2 guests")
        hold_by_click(page, "T1")
        expect(updates(page)).to_contain_text("Table T1 is held for you.")
        expect(setting(page, 2, 2, "T1")).to_be_attached()
        expect(page.get_by_text(re.compile(r"^Held for \d:\d\d$"))).to_be_visible()
        expect(page.get_by_role("checkbox")).to_have_count(0)
        fill_details(page, name, email)
        click(page.get_by_role("button", name="Book table"))
        expect(page.get_by_role("heading", level=1, name="You're booked")).to_have_text("You're booked")
        expect(page.get_by_text("No deposit", exact=True)).to_be_visible()
        expect(page.get_by_text("Table T1, Window Row", exact=True)).to_be_visible()
        token = urlparse(page.url).path.rsplit("/", 1)[-1]
    message = one_mail(mail, email, "Booking confirmed: ")
    assert manage_token(message) == token
    body = get(clock_url, f"/api/manage/{token}").json()
    assert body["booking"]["table_id"] == "T1" and body["booking"]["status"] == "booked"
    assert body["booking"]["name"] == name and body["booking"]["party_size"] == 2
    assert body["booking"]["deposit"] == {"amount_cents": 0, "state": "none"}
    assert message["Subject"] == f"Booking confirmed: {body['booking']['reference']}"
    assert plan_status(clock_url, day, "20:30", 2)["T1"] == "taken"


def test_confirm_field_errors_are_published(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 3)
    with visit(browser, book_url(clock_url, day, 2, "20:30")) as page:
        hold = hold_by_click(page, "T1")
        fill(textbox(page, "Name"), " ")
        fill(textbox(page, "Email"), "nobody")
        click(page.get_by_role("button", name="Book table"))
        expect(page.get_by_text("Enter your name.").first).to_be_visible()
        expect(page.get_by_text("Enter an email address like name@example.com.").first).to_be_visible()
        expect(updates(page)).to_contain_text("Enter your name.")
        assert urlparse(page.url).path == "/book"
    bad = post_json(
        clock_url,
        f"/api/holds/{hold['hold_id']}/confirm",
        {"name": "", "email": "nobody", "phone": "9" * 33},
        idempotency_key(),
    )
    assert set(assert_error(bad, 422, "validation_failed")["fields"]) == {"name", "email", "phone"}
    assert get(clock_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "live"


def test_confirmation_email_contents(app_url: str, clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    plain = book(clock_url, day, "20:30", 2, "T1")
    message = one_mail(mail, plain.email, "Booking confirmed: ")
    assert message["Subject"] == f"Booking confirmed: {plain.reference}"
    assert addresses(message["From"]) == ["tables@saffronslate.example"]
    body = lines(message)
    assert f"Your table is booked for {when(day, '20:30')}, Lisbon time." in body
    assert "Party of 2" in body and "Table T1, Window Row" in body and "No deposit" in body
    link = next(line for line in body if line.startswith("Manage your booking: "))
    assert link.endswith(f"/manage/{plain.token}")
    paid = book(clock_url, day, "20:30", 6, "T9")
    body = lines(one_mail(mail, paid.email, "Booking confirmed: "))
    assert "Deposit paid: €90.00" in body and "Party of 6" in body and "Table T9, Slate Room" in body
    pair = book(clock_url, day, "20:30", 7, "T7+T8")
    assert "Table T7+T8, Hearth" in lines(one_mail(mail, pair.email, "Booking confirmed: "))


def test_wf_book_a_table_landing_and_back(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 3)
    name, email = guest("land")
    with visit(browser, book_url(clock_url, day, 2, "20:30")) as page:
        hold_by_click(page, "T1")
        fill_details(page, name, email)
        fill(textbox(page, "Phone (optional)"), TYPED_PHONE)
        with page.expect_response(lambda r: r.url.endswith("/confirm")) as info:
            click(page.get_by_role("button", name="Book table"))
        assert info.value.status == 201
        manage = info.value.json()["manage_url"]
        heading = page.get_by_role("heading", level=1, name="You're booked")
        expect(heading).to_be_focused()
        parsed = urlparse(page.url)
        assert parsed.path == urlparse(manage).path and parsed.path.startswith("/manage/")
        assert parsed.query == ""
        page.reload()
        expect(page.get_by_role("heading", level=1, name="You're booked")).to_be_visible()
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" else None)
        page.go_back()
        await_query(page, date=day, party="2", time="20:30")
        assert urlparse(page.url).path == "/book"
        expect(table_option(page, "T1", "Taken")).to_be_visible()
        expect(page.get_by_role("listbox", name="Tables").get_by_role("option", name=re.compile("Held by you"))).to_have_count(0)
        expect(page.get_by_role("progressbar", name="Hold time remaining")).to_have_count(0)
        expect(settings(page)).to_have_count(0)
        expect(page.get_by_role("region", name="Your table")).to_have_count(0)
        assert posts == [], f"Back sent {posts}"
        hold_by_click(page, "T2")
        expect(textbox(page, "Name")).to_have_value("")
        expect(textbox(page, "Email")).to_have_value("")
        expect(textbox(page, "Phone (optional)")).to_have_value("")


def test_idempotent_retry_after_payment_failure(flap_url: str, killbill: KillBill, mail: Mailpit) -> None:
    with flap_services(flap_url) as (proxy, _):
        day, hhmm, table = open_slot(flap_url, 6)
        hold = take_hold(flap_url, day, hhmm, 6, table)
        name, email = guest("retry")
        key = idempotency_key()
        proxy.fail_purchase = True
        assert_error(confirm(flap_url, hold["hold_id"], name, email, True, key), 402, "payment_failed")
        proxy.fail_purchase = False
        proxy.stop()
        assert_error(confirm(flap_url, hold["hold_id"], name, email, True, key), 503, "deposits_paused")
        proxy.start()
        first = confirm(flap_url, hold["hold_id"], name, email, True, key)
        assert first.status_code == 201, first.text
        reference = first.json()["booking"]["reference"]
        seen = {found for wire in proxy.purchases for found in re.findall(r"SS-[A-Z0-9]{6}", wire)}
        assert seen == {reference}, f"attempts used references {seen}"
        again = confirm(flap_url, hold["hold_id"], name, email, True, key)
        assert again.status_code == 201 and again.json() == first.json()
        assert len(kill_bill_transactions(killbill, email, "PURCHASE")) == 1
        one_mail(mail, email, "Booking confirmed: ")


def test_idempotency_on_all_keyed_actions(clock_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day = evening(clock_url)
    future = plus_days(day, 3)
    hold = take_hold(clock_url, future, "20:00", 6, "T9")
    name, email = guest("replay")
    path = f"/api/holds/{hold['hold_id']}/confirm"
    body = {"name": name, "email": email, "accept_deposit": True}
    assert_error(post_json(clock_url, path, body), 400, "idempotency_key_required")
    key = idempotency_key()
    first = post_json(clock_url, path, body, key)
    assert first.status_code == 201, first.text
    replay = post_json(clock_url, path, body, key)
    assert (replay.status_code, replay.json()) == (201, first.json())
    assert_error(post_json(clock_url, path, {**body, "name": "Someone Else"}, key), 409, "idempotency_conflict")
    assert_error(post_json(clock_url, path, body, idempotency_key()), 409, "hold_closed")

    token = token_from(first.json()["manage_url"])
    cancel_path = f"/api/manage/{token}/cancel"
    assert_error(post_json(clock_url, cancel_path, {}), 400, "idempotency_key_required")
    cancel_key = idempotency_key()
    cancelled = post_json(clock_url, cancel_path, {}, cancel_key)
    assert cancelled.status_code == 200, cancelled.text
    assert_error(get(clock_url, f"/api/manage/{token}"), 410, "link_expired")
    replayed = post_json(clock_url, cancel_path, {}, cancel_key)
    assert (replayed.status_code, replayed.json()) == (200, cancelled.json())
    assert_error(post_json(clock_url, cancel_path, {}, idempotency_key()), 410, "link_expired")
    assert len(kill_bill_transactions(killbill, email, "PURCHASE")) == 1
    assert len(kill_bill_transactions(killbill, email, "REFUND")) == 1
    one_mail(mail, email, "Booking confirmed: ")
    one_mail(mail, email, "Booking cancelled: ")

    token, offer_email, _ = offer_for(clock_url, mail, future, "18:00", 2, "T1")
    claim_path = f"/api/offers/{token}/claim"
    assert_error(post_json(clock_url, claim_path, {}), 400, "idempotency_key_required")
    claim_key = idempotency_key()
    claimed = post_json(clock_url, claim_path, {}, claim_key)
    assert claimed.status_code == 201, claimed.text
    replayed = post_json(clock_url, claim_path, {}, claim_key)
    assert (replayed.status_code, replayed.json()) == (201, claimed.json())
    assert_error(post_json(clock_url, claim_path, {}, idempotency_key()), 410, "offer_claimed")
    one_mail(mail, offer_email, "Booking confirmed: ")

    client = host_client(clock_url)
    assert_error(client.post("/api/host/walk-ins", json={"table_id": "T2", "party_size": 2}), 400, "idempotency_key_required")
    walk_key = idempotency_key()
    seated = walk_in(client, "T2", 2, walk_key)
    assert seated.status_code == 201, seated.text
    again = walk_in(client, "T2", 2, walk_key)
    assert (again.status_code, again.json()) == (201, seated.json())
    assert_error(walk_in(client, "T3", 2, walk_key), 409, "idempotency_conflict")
    listed = client.get("/api/host/bookings").json()["bookings"]
    assert sum(1 for row in listed if row["reference"] == seated.json()["booking"]["reference"]) == 1


def test_deposit_amount_everywhere(clock_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day = evening(clock_url)
    for party, table, cents in ((5, "T9", 7500), (6, "T10", 9000), (4, "T4", 0), (2, "C1", 3000), (1, "C2", 1500), (8, "T7+T8", 12000), (2, "T1", 0)):
        assert take_hold(clock_url, plus_days(day, 2), "20:00", party, table)["deposit_cents"] == cents
    booked = book(clock_url, day, "18:00", 2, "C1")
    assert booked.booking["deposit"] == {"amount_cents": 3000, "state": "paid"}
    charges = kill_bill_transactions(killbill, booked.email, "PURCHASE")
    assert [amount_of(charge) for charge in charges] == [Decimal("30")]
    assert charges[0]["currency"] == "EUR"
    assert "Deposit paid: €30.00" in lines(one_mail(mail, booked.email, "Booking confirmed: "))
    client = host_client(clock_url)
    row = next(item for item in client.get("/api/host/bookings").json()["bookings"] if item["reference"] == booked.reference)
    assert row["deposit"] == {"amount_cents": 3000, "state": "paid"}
    floor = host_floor(client, "18:00").json()
    assert next(t for t in floor["tables"] if t["table_id"] == "C1")["booking"]["deposit"]["amount_cents"] == 3000
    client.close()


def test_wf_book_with_deposit_happy_path(browser: Browser, clock_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day = evening(clock_url)
    name, email = guest("six")
    with visit(browser, book_url(clock_url, day, 6, "18:00")) as page:
        hold = hold_by_click(page, "T9")
        assert hold["deposit_cents"] == 9000
        expect(page.get_by_role("region", name="Your table")).to_contain_text(
            "A deposit of €90.00 is charged now: €15 for each guest. It is refunded in full if you cancel at "
            "least 24 hours before your table. After that it is kept."
        )
        fill_details(page, name, email)
        pay = page.get_by_role("button", name=pay_name("90.00"))
        click(pay)
        expect(page.get_by_text("Tick the box to accept the deposit.").first).to_be_visible()
        assert kill_bill_transactions(killbill, email, "PURCHASE") == []
        check(deposit_box(page, "90.00"))
        click(pay)
        expect(page.get_by_role("heading", level=1, name="You're booked")).to_be_visible()
        expect(page.get_by_text("Deposit €90.00 paid", exact=True)).to_be_visible()
        reference = get(clock_url, f"/api/manage/{urlparse(page.url).path.rsplit('/', 1)[-1]}").json()["booking"]["reference"]
    charges = kill_bill_transactions(killbill, email, "PURCHASE")
    assert [amount_of(charge) for charge in charges] == [Decimal("90")]
    assert charges[0]["currency"] == "EUR"
    assert "Deposit paid: €90.00" in lines(one_mail(mail, email, "Booking confirmed: "))
    with host_page(browser, clock_url, host_path("18:00")) as host:
        row = host.get_by_role("region", name="Tonight's bookings").get_by_role("listitem").filter(has_text=reference)
        expect(row).to_have_text(f"18:00 · {reference} · {name} · Party of 6 · Table T9 · Booked · Deposit €90.00 paid")


def test_deposit_booking_waits_for_kill_bill(flap_url: str, killbill: KillBill, mail: Mailpit) -> None:
    with flap_services(flap_url) as (proxy, _):
        day, hhmm, table = open_slot(flap_url, 6)
        hold = take_hold(flap_url, day, hhmm, 6, table)
        name, _ = guest("wait")
        email = f"Mixed.{uuid_tail()}@Example.com"
        proxy.gate = threading.Event()
        with ThreadPoolExecutor(1) as pool:
            pending = pool.submit(confirm, flap_url, hold["hold_id"], name, email, True)
            assert proxy.gate_reached.wait(HTTP_TIMEOUT), "confirm never asked Kill Bill for a PURCHASE"
            assert get(flap_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "live"
            no_mail(mail, email)
            assert not pending.done(), "confirm answered before Kill Bill recorded the payment"
            proxy.gate.set()
            answer = pending.result()
        assert answer.status_code == 201, answer.text
        booking = answer.json()["booking"]
        assert booking["deposit"] == {"amount_cents": 9000, "state": "paid"}
        reference = booking["reference"]
        assert re.fullmatch(r"SS-[A-Z0-9]{6}", reference)
        account = killbill.account_by_key(email.lower())
        assert account, "no Kill Bill account under the lowercased email"
        assert account["currency"] == "EUR" and account["name"] == name
        assert "external" in (killbill.default_plugin(account["accountId"]) or "").lower()
        payment = killbill.payment_by_key(reference)
        assert payment and payment["accountId"] == account["accountId"]
        purchase = [t for t in payment["transactions"] if t["transactionType"] == "PURCHASE"]
        assert len(purchase) == 1 and purchase[0]["status"] == KB_SUCCESS
        assert purchase[0]["transactionExternalKey"] == f"{reference}-deposit"
        assert amount_of(purchase[0]) == Decimal("90") and purchase[0]["currency"] == "EUR"


def uuid_tail() -> str:
    return guest("mixed")[1].split("@")[0]


def test_wf_book_with_deposit_failure_leaves_nothing(
    browser: Browser, flap_url: str, killbill: KillBill, mail: Mailpit
) -> None:
    with flap_services(flap_url) as (proxy, _):
        day, hhmm, table = open_slot(flap_url, 6)
        name, email = guest("fail")
        with visit(browser, book_url(flap_url, day, 6, hhmm)) as page:
            hold = hold_by_click(page, table)
            fill_details(page, name, email)
            check(deposit_box(page, "90.00"))
            proxy.fail_purchase = True
            with page.expect_response(lambda r: r.url.endswith("/confirm")) as info:
                click(page.get_by_role("button", name=pay_name("90.00")))
            assert info.value.status == 402
            assert info.value.json()["error"]["code"] == "payment_failed"
            expect(updates(page)).to_contain_text(PAYMENT_FAILED_COPY)
            expect(page.get_by_text(PAYMENT_FAILED_COPY).first).to_be_visible()
            expect(table_option(page, table, "Held by you")).to_be_visible()
            assert urlparse(page.url).path == "/book"
            status = get(flap_url, f"/api/holds/{hold['hold_id']}").json()["status"]
            assert status == "live"
            assert kill_bill_transactions(killbill, email, "PURCHASE") == []
            no_mail(mail, email)
            proxy.fail_purchase = False
            click(page.get_by_role("button", name=pay_name("90.00")))
            expect(page.get_by_role("heading", level=1, name="You're booked")).to_be_visible()
            token = urlparse(page.url).path.rsplit("/", 1)[-1]
        reference = get(flap_url, f"/api/manage/{token}").json()["booking"]["reference"]
        seen = {found for wire in proxy.purchases for found in re.findall(r"SS-[A-Z0-9]{6}", wire)}
        assert seen == {reference}, f"attempts used references {seen}"
        assert len(kill_bill_transactions(killbill, email, "PURCHASE")) == 1
        one_mail(mail, email, "Booking confirmed: ")


def test_wf_book_with_deposit_paused_then_paid(
    browser: Browser, flap_url: str, killbill: KillBill, mail: Mailpit
) -> None:
    with flap_services(flap_url) as (proxy, _):
        day, hhmm, table = open_slot(flap_url, 6)
        name, email = guest("paused")
        with visit(browser, book_url(flap_url, day, 6, hhmm)) as page:
            hold_by_click(page, table)
            fill_details(page, name, email)
            check(deposit_box(page, "90.00"))
            proxy.stop()
            pay = page.get_by_role("button", name=pay_name("90.00"))
            with page.expect_response(lambda r: r.url.endswith("/confirm")) as info:
                click(pay)
            assert info.value.status == 503
            assert info.value.json()["error"]["code"] == "deposits_paused"
            expect(banner(page, DEPOSITS_BANNER)).to_be_visible()
            expect(table_option(page, table, "Held by you")).to_be_visible()
            assert urlparse(page.url).path == "/book"
            no_mail(mail, email)
            proxy.start()
            await_status(flap_url, deposits="ok")
            click(pay)
            expect(page.get_by_role("heading", level=1, name="You're booked")).to_be_visible()
            expect(page.get_by_text("Deposit €90.00 paid", exact=True)).to_be_visible()
        assert len(kill_bill_transactions(killbill, email, "PURCHASE")) == 1
        one_mail(mail, email, "Booking confirmed: ")


def test_deposits_paused_instance(browser: Browser, app_url: str, kb_down_url: str, killbill: KillBill, mail: Mailpit) -> None:
    assert get(kb_down_url, "/api/status").json()["deposits"] == "paused"
    day, hhmm, table = open_slot(kb_down_url, 6)
    with visit(browser, book_url(kb_down_url, day, 6, hhmm)) as page:
        expect(banner(page, DEPOSITS_BANNER)).to_be_visible()
    hold = take_hold(kb_down_url, day, hhmm, 6, table)
    name, email = guest("kbdown")
    assert_error(confirm(kb_down_url, hold["hold_id"], name, email, True), 503, "deposits_paused")
    assert get(kb_down_url, f"/api/holds/{hold['hold_id']}").json()["status"] == "live"
    no_mail(mail, email)
    assert kill_bill_transactions(killbill, email, "PURCHASE") == []
    plain_day, plain_time, plain_table = open_slot(kb_down_url, 2)
    plain = book(kb_down_url, plain_day, plain_time, 2, plain_table)
    one_mail(mail, plain.email, "Booking confirmed: ")
    paid_day, paid_time, paid_table = open_slot(app_url, 6)
    paid = book(app_url, paid_day, paid_time, 6, paid_table)
    answer = post_json(kb_down_url, f"/api/manage/{paid.token}/cancel", {}, idempotency_key())
    assert_error(answer, 503, "deposits_paused")
    assert get(app_url, f"/api/manage/{paid.token}").json()["booking"]["status"] == "booked"
    assert kill_bill_transactions(killbill, paid.email, "REFUND") == []
    no_mail(mail, paid.email, "Booking cancelled: ")


def test_manage_link_is_a_capability(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    mine, other = book(clock_url, day, "18:00", 2, "T1"), book(clock_url, day, "18:00", 2, "T2")
    assert len(mine.token) >= 22 and re.fullmatch(r"[A-Za-z0-9_\-~.]+", mine.token)
    assert get(clock_url, f"/api/manage/{mine.token}").json()["booking"]["reference"] == mine.reference
    assert get(clock_url, f"/api/manage/{other.token}").json()["booking"]["reference"] == other.reference
    assert_error(get(clock_url, f"/api/manage/{mine.token[:-2]}zz"), 404, "not_found")
    assert_error(post_json(clock_url, f"/api/manage/{JUNK_TOKEN}/cancel", {}, idempotency_key()), 404, "not_found")
    assert mine.token not in mine.reference
    assert post_json(clock_url, f"/api/manage/{mine.token}/cancel", {}, idempotency_key()).status_code == 200
    assert_error(get(clock_url, f"/api/manage/{mine.token}"), 410, "link_expired")
    assert_error(post_json(clock_url, f"/api/manage/{mine.token}/cancel", {}, idempotency_key()), 410, "link_expired")
    assert get(clock_url, f"/api/manage/{other.token}").status_code == 200
    with visit(browser, f"{clock_url}/manage/{mine.token}") as page:
        expect(page.get_by_text(DEAD_MANAGE_COPY)).to_be_visible()
        expect(page.get_by_role("button", name="Cancel booking")).to_have_count(0)
    client = host_client(clock_url)
    assert client.post(f"/api/host/bookings/{other.reference}/seat", json={}).status_code == 200
    assert client.post(f"/api/host/bookings/{other.reference}/clear", json={}).status_code == 200
    assert_error(get(clock_url, f"/api/manage/{other.token}"), 410, "link_expired")
    late = book(clock_url, day, "18:00", 2, "T3")
    set_clock(clock_url, lisbon(day, "18:15"))
    assert client.post(f"/api/host/bookings/{late.reference}/no-show", json={}).status_code == 200
    assert_error(get(clock_url, f"/api/manage/{late.token}"), 410, "link_expired")
    client.close()


def test_wf_cancel_booking_refunded_journey(browser: Browser, clock_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    booked = book(clock_url, day, "20:00", 6, "T9")
    link = re.search(r"https?://\S+/manage/\S+", text(one_mail(mail, booked.email, "Booking confirmed: ")))
    assert link, "confirmation email has no absolute manage link"
    with visit(browser, f"{clock_url}/manage/{booked.token}") as page:
        expect(page.get_by_text(f"Reference {booked.reference}", exact=True)).to_be_visible()
        expect(page.get_by_text("Deposit €90.00 paid", exact=True)).to_be_visible()
        click(page.get_by_role("button", name="Cancel booking"))
        dialog = page.get_by_role("dialog", name="Cancel this booking")
        expect(dialog).to_contain_text("Cancelling now refunds your €90.00 deposit in full.")
        click(dialog.get_by_role("button", name="Yes, cancel"))
        expect(dialog).to_have_count(0)
        expect(page.get_by_role("heading", level=1, name="Booking cancelled")).to_be_focused()
        expect(updates(page)).to_contain_text("Booking cancelled. Your €90.00 deposit has been refunded.")
        expect(page.get_by_text("Refunded: €90.00", exact=True)).to_be_visible()
    refunds = kill_bill_transactions(killbill, booked.email, "REFUND")
    assert [amount_of(refund) for refund in refunds] == [Decimal("90")]
    one_mail(mail, booked.email, "Booking cancelled: ")
    assert_error(get(clock_url, f"/api/manage/{booked.token}"), 410, "link_expired")
    assert plan_status(clock_url, day, "20:00", 6)["T9"] == "fits"


def test_wf_cancel_booking_payments_down(browser: Browser, app_url: str, kb_down_url: str, killbill: KillBill) -> None:
    day, hhmm, table = open_slot(app_url, 6)
    booked = book(app_url, day, hhmm, 6, table)
    with visit(browser, f"{kb_down_url}/manage/{booked.token}") as page:
        click(page.get_by_role("button", name="Cancel booking"))
        dialog = page.get_by_role("dialog", name="Cancel this booking")
        yes = dialog.get_by_role("button", name="Yes, cancel")
        click(yes)
        expect(dialog.get_by_role("alert")).to_contain_text(CANCEL_DOWN_COPY)
        expect(dialog).to_be_visible()
        expect(yes).to_be_focused()
    assert get(app_url, f"/api/manage/{booked.token}").json()["booking"]["status"] == "booked"
    assert kill_bill_transactions(killbill, booked.email, "REFUND") == []


def test_refund_edge_at_24_hours(browser: Browser, clock_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 5)
    start = lisbon(day, "20:00")
    early, late = book(clock_url, day, "20:00", 6, "T9"), book(clock_url, day, "20:00", 6, "T10")
    assert parse_instant(early.booking["refund_cutoff"]) == start - timedelta(hours=24)
    set_clock(clock_url, start - timedelta(hours=24, seconds=5))
    assert get(clock_url, f"/api/manage/{early.token}").json()["refund_if_cancelled_now"] is True
    refunded = post_json(clock_url, f"/api/manage/{early.token}/cancel", {}, idempotency_key())
    assert refunded.status_code == 200, refunded.text
    assert refunded.json()["booking"]["status"] == "cancelled_refunded"
    assert refunded.json()["booking"]["deposit"] == {"amount_cents": 9000, "state": "refunded"}
    assert len(kill_bill_transactions(killbill, early.email, "REFUND")) == 1

    set_clock(clock_url, start - timedelta(hours=23, minutes=59, seconds=59))
    assert get(clock_url, f"/api/manage/{late.token}").json()["refund_if_cancelled_now"] is False
    with visit(browser, f"{clock_url}/manage/{late.token}") as page:
        click(page.get_by_role("button", name="Cancel booking"))
        dialog = page.get_by_role("dialog", name="Cancel this booking")
        expect(dialog).to_contain_text("Cancelling now keeps your €90.00 deposit.")
        click(dialog.get_by_role("button", name="Yes, cancel"))
        expect(page.get_by_role("heading", level=1, name="Booking cancelled")).to_be_focused()
        expect(updates(page)).to_contain_text("Booking cancelled. Your €90.00 deposit has been kept.")
        expect(page.get_by_text("Deposit kept: €90.00", exact=True)).to_be_visible()
    assert kill_bill_transactions(killbill, late.email, "REFUND") == []
    started = book(clock_url, plus_days(day, 1), "20:00", 2, "T1")
    set_clock(clock_url, lisbon(plus_days(day, 1), "20:00"))
    assert_error(post_json(clock_url, f"/api/manage/{started.token}/cancel", {}, idempotency_key()), 409, "slot_started")
    assert get(clock_url, f"/api/manage/{started.token}").json()["booking"]["status"] == "booked"
    assert "Your deposit" not in text(one_mail(mail, started.email, "Booking confirmed: "))


def test_refund_waits_for_kill_bill(flap_url: str, killbill: KillBill, mail: Mailpit) -> None:
    with flap_services(flap_url) as (proxy, _):
        day, hhmm, table = open_slot(flap_url, 6)
        booked = book(flap_url, day, hhmm, 6, table)
        proxy.gate = threading.Event()
        proxy.gate_reached.clear()
        with ThreadPoolExecutor(1) as pool:
            pending = pool.submit(post_json, flap_url, f"/api/manage/{booked.token}/cancel", {}, idempotency_key())
            assert proxy.gate_reached.wait(HTTP_TIMEOUT), "cancel never asked Kill Bill for a REFUND"
            assert get(flap_url, f"/api/manage/{booked.token}").json()["booking"]["status"] == "booked"
            no_mail(mail, booked.email, "Booking cancelled: ")
            assert not pending.done(), "cancel answered before Kill Bill recorded the refund"
            proxy.gate.set()
            answer = pending.result()
        assert answer.status_code == 200, answer.text
        assert answer.json()["booking"]["deposit"]["state"] == "refunded"
        payment = killbill.payment_by_key(booked.reference)
        assert payment
        refunds = [t for t in payment["transactions"] if t["transactionType"] == "REFUND"]
        assert len(refunds) == 1 and refunds[0]["status"] == KB_SUCCESS
        assert refunds[0]["transactionExternalKey"] == f"{booked.reference}-refund"
        assert amount_of(refunds[0]) == Decimal("90")


def test_cancellation_email_variants(clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 5)
    refunded, kept, free = (
        book(clock_url, day, "20:00", 6, "T9"),
        book(clock_url, day, "20:00", 6, "T10"),
        book(clock_url, day, "20:00", 2, "T1"),
    )
    key = idempotency_key()
    assert post_json(clock_url, f"/api/manage/{refunded.token}/cancel", {}, key).status_code == 200
    assert post_json(clock_url, f"/api/manage/{free.token}/cancel", {}, idempotency_key()).status_code == 200
    set_clock(clock_url, lisbon(day, "20:00") - timedelta(hours=2))
    assert post_json(clock_url, f"/api/manage/{kept.token}/cancel", {}, idempotency_key()).status_code == 200
    assert post_json(clock_url, f"/api/manage/{refunded.token}/cancel", {}, key).status_code == 200
    for booked, line in (
        (refunded, "Your deposit of €90.00 has been refunded."),
        (kept, "Your deposit of €90.00 has been kept under our 24-hour policy."),
        (free, "No deposit was taken."),
    ):
        message = one_mail(mail, booked.email, "Booking cancelled: ")
        assert message["Subject"] == f"Booking cancelled: {booked.reference}"
        assert line in lines(message)
        assert f"Your booking for {when(day, '20:00')} has been cancelled." in lines(message)


def test_join_waitlist_rules(clock_url: str) -> None:
    day = plus_days(evening(clock_url), 3)
    first, email_one = join(clock_url, day, 2, "18:00", "19:00")
    assert first.status_code == 201
    assert first.json()["status"] == "waiting" and first.json()["position"] == 1
    second, email_two = join(clock_url, day, 4, "20:00", "21:00")
    assert second.status_code == 201 and second.json()["position"] == 2
    repeat, _ = join(clock_url, day, 8, "18:00", "22:00", email=f"  {email_one.upper()} ")
    assert repeat.status_code == 200
    assert repeat.json() == {"entry_id": first.json()["entry_id"], "status": "waiting", "position": 1}
    assert join(clock_url, plus_days(day, 1), 2, "18:00", "19:00", email=email_two)[0].status_code == 201
    race_email = guest("race")[1]
    with ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda _: join(clock_url, day, 2, "18:00", "19:00", email=race_email)[0], range(6)))
    assert sorted(answer.status_code for answer in answers) == [200] * 5 + [201]
    assert len({answer.json()["entry_id"] for answer in answers}) == 1
    invalid = post_json(
        clock_url,
        "/api/waitlist",
        {"date": day, "party_size": 9, "earliest": "21:00", "latest": "18:00", "name": " ", "email": "nope"},
    )
    assert set(assert_error(invalid, 422, "validation_failed")["fields"]) == {"party_size", "latest", "name", "email"}


def test_wf_waitlist_offer_double_join_journey(browser: Browser, clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    for table in ("T9", "T10"):
        take_hold(clock_url, day, "20:00", 6, table)
    blocker = take_hold(clock_url, plus_days(day, 1), "20:00", 6, "T9")
    name, email = guest("double")
    with visit(browser, book_url(clock_url, plus_days(day, 1), 6, "20:00")) as page:
        link = page.get_by_role("link", name="Join the waitlist")
        expect(link).to_have_attribute("href", re.compile(r"/waitlist\?"))
        click(link)
        page.wait_for_url(lambda url: urlparse(url).path == "/waitlist")
        current = query(page)
        assert (current["date"], current["party"], current["earliest"], current["latest"]) == (plus_days(day, 1), "6", "20:00", "20:00")
        expect(page.get_by_role("radiogroup", name="Party size").get_by_role("radio", name="6 guests")).to_be_checked()
        expect(page.get_by_label("Date", exact=True)).to_have_value(plus_days(day, 1))
        expect(page.get_by_role("combobox", name="Earliest time")).to_contain_text("20:00")
        fill_details(page, name, email)
        button = page.get_by_role("button", name="Join the waitlist")
        posts: list[int] = []
        page.on("response", lambda r: posts.append(r.status) if urlparse(r.url).path == "/api/waitlist" else None)
        button.dblclick()
        status = updates(page)
        expect(status).to_contain_text(re.compile(r"You're on the waitlist at position 1\. We'll email you if a table frees up\."))
        assert all(code in (200, 201) for code in posts)
    repeat, _ = join(clock_url, plus_days(day, 1), 6, "20:00", "20:00", email=email)
    assert repeat.status_code == 200 and repeat.json()["position"] == 1
    assert delete(clock_url, f"/api/holds/{blocker['hold_id']}").status_code == 204
    await_mail(mail, email, "A table is free: ")
    assert len(inbox(mail, email, "A table is free: ", settle=QUIET_SECONDS)) == 1


def test_offers_follow_join_order(clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    book(clock_url, day, "21:00", 2, "T1")
    hold = take_hold(clock_url, day, "18:00", 2, "T1")
    too_big = join(clock_url, day, 6, "18:00", "19:00")[1]
    wrong_window = join(clock_url, day, 2, "21:00", "22:00")[1]
    chosen = join(clock_url, day, 2, "18:00", "19:00")[1]
    later = join(clock_url, day, 2, "18:00", "19:00")[1]
    assert delete(clock_url, f"/api/holds/{hold['hold_id']}").status_code == 204
    offer = get(clock_url, f"/api/offers/{offer_token(await_mail(mail, chosen, 'A table is free: '))}").json()
    assert (offer["table_id"], offer["time"], offer["party_size"]) == ("T1", "18:00", 2)
    for email in (too_big, wrong_window, later):
        no_mail(mail, email, "A table is free: ", seconds=QUIET_SECONDS)
    assert join(clock_url, day, 2, "18:00", "19:00", email=too_big)[0].json()["status"] == "waiting"
    assert plan_status(clock_url, day, "18:00", 2)["T1"] == "taken"
    pair_day = plus_days(day, 1)
    pair_hold = take_hold(clock_url, pair_day, "18:00", 4, "T8")
    party_of_seven = join(clock_url, pair_day, 7, "18:00", "18:00")[1]
    assert delete(clock_url, f"/api/holds/{pair_hold['hold_id']}").status_code == 204
    pair_mail = await_mail(mail, party_of_seven, "A table is free: ")
    assert "Table T7+T8, Hearth" in lines(pair_mail)
    assert get(clock_url, f"/api/offers/{offer_token(pair_mail)}").json()["table_id"] == "T7+T8"


def test_offer_email_and_link(clock_url: str, mail: Mailpit, valkey: Valkey) -> None:
    day = plus_days(evening(clock_url), 3)
    token, email, offer = offer_for(clock_url, mail, day, "20:00", 6, "T9")
    message = one_mail(mail, email, "A table is free: ")
    assert message["Subject"] == f"A table is free: {when(day, '20:00')}"
    body = lines(message)
    assert "Table T9, Slate Room" in body and "Party of 6" in body
    assert "Claiming charges a deposit of €90.00." in body
    expires = parse_instant(offer["expires_at"]).astimezone(LISBON)
    assert f"This offer ends at {expires:%H:%M:%S} Lisbon time." in body
    claim_line = next(line for line in body if line.startswith("Claim it here: "))
    assert claim_line.endswith(f"/offer/{token}")
    assert offer["status"] == "offered" and offer["deposit_cents"] == 9000 and offer["room"] == "Slate Room"
    life = parse_instant(offer["expires_at"]) - parse_instant(offer["server_now"])
    assert timedelta(seconds=OFFER_SECONDS - MAIL_SECONDS - 5) < life <= timedelta(seconds=OFFER_SECONDS)
    keys = valkey.keys(f"clock:hold:T9:{day}T*")
    assert keys and all(0 < int(valkey.command("PTTL", key)) <= OFFER_SECONDS * 1000 for key in keys)
    assert valkey.keys("clock:offer:*"), "an offer key under the prefix exists while the offer is live"
    plain_token, plain_email, _ = offer_for(clock_url, mail, day, "20:00", 2, "T1")
    assert not [line for line in lines(one_mail(mail, plain_email, "A table is free: ")) if line.startswith("Claiming charges")]
    assert plain_token != token
    assert get(clock_url, f"/api/offers/{plain_token}").json()["table_id"] == "T1"
    assert_error(get(clock_url, f"/api/offers/{JUNK_TOKEN}"), 404, "not_found")
    assert_error(post_json(clock_url, f"/api/offers/{JUNK_TOKEN}/claim", {}, idempotency_key()), 404, "not_found")


def test_wf_waitlist_claim_happy_path(browser: Browser, clock_url: str, mail: Mailpit) -> None:
    day = evening(clock_url)
    token, email, _ = offer_for(clock_url, mail, day, "18:00", 2, "T1")
    with host_page(browser, clock_url, "/host?time=18:00") as host:
        expect(floor_option(host, "T1", "Offered")).to_be_visible()
        with visit(browser, f"{clock_url}/offer/{token}") as page:
            expect(page.get_by_role("heading", level=1, name="A table is yours to claim")).to_be_visible()
            expect(page.get_by_text(re.compile(r"^Offer ends in (15:00|14:\d\d)$"))).to_be_visible()
            bar = page.get_by_role("progressbar", name="Offer time remaining")
            expect(bar).to_be_visible()
            assert bar_max(bar) == OFFER_SECONDS
            click(page.get_by_role("button", name="Claim table"))
            expect(page.get_by_role("heading", level=1, name="You're booked")).to_be_visible()
            path = urlparse(page.url).path
            assert path.startswith("/manage/")
        expect(floor_option(host, "T1", "Booked 18:00")).to_be_visible(timeout=(LIVE_SECONDS + SLACK_SECONDS) * 1000)
    body = get(clock_url, f"/api/manage/{path.rsplit('/', 1)[-1]}").json()["booking"]
    assert body["source"] == "waitlist" and body["status"] == "booked" and body["table_id"] == "T1"
    one_mail(mail, email, "Booking confirmed: ")


def test_wf_waitlist_claim_dead_links(browser: Browser, clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    token, _, _ = offer_for(clock_url, mail, day, "18:00", 2, "T1")
    assert post_json(clock_url, f"/api/offers/{token}/claim", {}, idempotency_key()).status_code == 201
    assert_error(get(clock_url, f"/api/offers/{token}"), 410, "offer_claimed")
    with visit(browser, f"{clock_url}/offer/{token}") as page:
        expect(page.get_by_text(DEAD_OFFER_COPY)).to_be_visible()
        expect(page.get_by_role("button", name="Claim table")).to_have_count(0)
    with visit(browser, f"{clock_url}/offer/{JUNK_TOKEN}") as page:
        expect(page.get_by_text(DEAD_OFFER_COPY)).to_be_visible()
    live, _, offer = offer_for(clock_url, mail, day, "18:00", 2, "T2")
    with visit(browser, f"{clock_url}/offer/{live}") as page:
        claim = page.get_by_role("button", name="Claim table")
        expect(claim).to_be_enabled()
        set_clock(clock_url, parse_instant(offer["expires_at"]))
        click(claim)
        expect(page.get_by_text("This offer has ended.").first).to_be_visible()
    assert_error(get(clock_url, f"/api/offers/{live}"), 410, "offer_expired")


def test_wf_waitlist_claim_parallel_claims(clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    token, email, _ = offer_for(clock_url, mail, day, "18:00", 2, "T1")
    with ThreadPoolExecutor(8) as pool:
        answers = list(pool.map(lambda _: post_json(clock_url, f"/api/offers/{token}/claim", {}, idempotency_key()), range(8)))
    winners = [answer for answer in answers if answer.status_code == 201]
    assert len(winners) == 1, [answer.status_code for answer in answers]
    for answer in answers:
        if answer.status_code != 201:
            assert_error(answer, 410, "offer_claimed")
    assert winners[0].json()["booking"]["source"] == "waitlist"
    one_mail(mail, email, "Booking confirmed: ")


def test_claim_edge_on_server_clock(clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    token, email, offer = offer_for(clock_url, mail, day, "18:00", 2, "T1")
    set_clock(clock_url, parse_instant(offer["expires_at"]) - timedelta(seconds=3))
    assert post_json(clock_url, f"/api/offers/{token}/claim", {}, idempotency_key()).status_code == 201
    late, late_email, late_offer = offer_for(clock_url, mail, day, "18:00", 2, "T2")
    set_clock(clock_url, parse_instant(late_offer["expires_at"]))
    assert_error(post_json(clock_url, f"/api/offers/{late}/claim", {}, idempotency_key()), 410, "offer_expired")
    no_mail(mail, late_email, "Booking confirmed: ")
    other, other_email, other_offer = offer_for(clock_url, mail, day, "18:00", 2, "T3")
    set_clock(clock_url, parse_instant(other_offer["expires_at"]) + timedelta(seconds=1))
    assert_error(post_json(clock_url, f"/api/offers/{other}/claim", {}, idempotency_key()), 410, "offer_expired")
    no_mail(mail, other_email, "Booking confirmed: ")
    assert inbox(mail, email, "Booking confirmed: ", settle=0.2) or await_mail(mail, email, "Booking confirmed: ")


def test_lapse_notifies_and_moves_to_next_entry(clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    hold = take_hold(clock_url, day, "18:00", 2, "T1")
    first = join(clock_url, day, 2, "18:00", "18:00")[1]
    second = join(clock_url, day, 2, "18:00", "18:00")[1]
    assert delete(clock_url, f"/api/holds/{hold['hold_id']}").status_code == 204
    first_token = offer_token(await_mail(mail, first, "A table is free: "))
    first_offer = get(clock_url, f"/api/offers/{first_token}").json()
    no_mail(mail, second, "A table is free: ")
    set_clock(clock_url, parse_instant(first_offer["expires_at"]))
    jumped = time.monotonic()
    poll(
        lambda: get(clock_url, f"/api/offers/{first_token}").status_code == 410,
        LIVE_SECONDS + SLACK_SECONDS,
        "the offer lapsed within two seconds of expires_at",
    )
    assert_error(get(clock_url, f"/api/offers/{first_token}"), 410, "offer_expired")
    lapsed = await_mail(mail, first, "Your table offer has lapsed", seconds=LAPSE_MAIL_SECONDS + SLACK_SECONDS)
    assert time.monotonic() - jumped <= LAPSE_MAIL_SECONDS + SLACK_SECONDS
    assert f"Your offer for {when(day, '18:00')} ended unclaimed." in lines(lapsed)
    next_token = offer_token(await_mail(mail, second, "A table is free: "))
    next_offer = get(clock_url, f"/api/offers/{next_token}").json()
    assert next_offer["table_id"] == "T1" and next_token != first_token
    assert parse_instant(next_offer["expires_at"]) > parse_instant(first_offer["expires_at"])
    assert join(clock_url, day, 2, "18:00", "18:00", email=first)[0].status_code == 201


def test_claim_racing_lapse_has_one_outcome(clock_url: str, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    token, email, offer = offer_for(clock_url, mail, day, "18:00", 2, "T1")
    set_clock(clock_url, parse_instant(offer["expires_at"]) - timedelta(milliseconds=100))
    with ThreadPoolExecutor(4) as pool:
        answers = list(pool.map(lambda _: post_json(clock_url, f"/api/offers/{token}/claim", {}, idempotency_key()), range(4)))
    codes = [answer.status_code for answer in answers]
    assert set(codes) <= {201, 410}, codes
    assert codes.count(201) <= 1, codes
    settled = MAIL_SECONDS + SLACK_SECONDS
    confirmations = inbox(mail, email, "Booking confirmed: ", settle=settled)
    lapses = inbox(mail, email, "Your table offer has lapsed", settle=QUIET_SECONDS)
    assert (len(confirmations), len(lapses)) == ((1, 0) if 201 in codes else (0, 1))


def test_claim_with_deposit_charges_once(clock_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    token, email, offer = offer_for(clock_url, mail, day, "20:00", 6, "T9")
    assert offer["deposit_cents"] == 9000
    with ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda _: post_json(clock_url, f"/api/offers/{token}/claim", {}, idempotency_key()), range(6)))
    winners = [answer for answer in answers if answer.status_code == 201]
    assert len(winners) == 1, [answer.status_code for answer in answers]
    booking = winners[0].json()["booking"]
    assert booking["deposit"] == {"amount_cents": 9000, "state": "paid"}
    charges = kill_bill_transactions(killbill, email, "PURCHASE")
    assert [amount_of(charge) for charge in charges] == [Decimal("90")]
    assert killbill.payment_by_key(booking["reference"])
    assert "Deposit paid: €90.00" in lines(one_mail(mail, email, "Booking confirmed: "))
    racing, racing_email, racing_offer = offer_for(clock_url, mail, day, "20:00", 6, "T10")
    set_clock(clock_url, parse_instant(racing_offer["expires_at"]) - timedelta(milliseconds=100))
    with ThreadPoolExecutor(4) as pool:
        raced = list(pool.map(lambda _: post_json(clock_url, f"/api/offers/{racing}/claim", {}, idempotency_key()), range(4)))
    won = sum(1 for answer in raced if answer.status_code == 201)
    assert won <= 1
    assert len(kill_bill_transactions(killbill, racing_email, "PURCHASE")) == won


def test_claim_failure_keeps_offer_live(app_url: str, kb_down_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day, hhmm, table = open_slot(app_url, 6)
    token, email, offer = offer_for(app_url, mail, day, hhmm, 6, table)
    key = idempotency_key()
    assert_error(post_json(kb_down_url, f"/api/offers/{token}/claim", {}, key), 503, "deposits_paused")
    after = get(app_url, f"/api/offers/{token}").json()
    assert after["status"] == "offered" and after["expires_at"] == offer["expires_at"]
    no_mail(mail, email, "Booking confirmed: ")
    claimed = post_json(app_url, f"/api/offers/{token}/claim", {}, key)
    assert claimed.status_code == 201, claimed.text
    assert len(kill_bill_transactions(killbill, email, "PURCHASE")) == 1


def test_host_session_and_every_endpoint_guarded(app_url: str, clock_url: str) -> None:
    bad = post_json(app_url, "/api/host/session", {"email": HOST_EMAIL, "password": "wrong-password"})
    assert_error(bad, 401, "invalid_credentials")
    set_clock(clock_url, server_now(clock_url))
    good = post_json(clock_url, "/api/host/session", {"email": HOST_EMAIL, "password": HOST_PASSWORD})
    assert good.status_code == 200, good.text
    assert good.json()["host"] == {"email": HOST_EMAIL, "name": "Inês Duarte"}
    now = server_now(clock_url)
    life = parse_instant(good.json()["expires_at"]) - now
    assert timedelta(hours=11, minutes=59) < life <= timedelta(hours=12)
    flags = re.sub(r"[-\s=]", "", good.headers["set-cookie"]).lower()
    for word in ("HTTP-only", "SameSite Strict"):
        assert re.sub(r"[-\s]", "", word).lower() in flags, f"session cookie lacks {word}"
    for method, path in (
        ("GET", "/api/host/floor"),
        ("GET", "/api/host/bookings"),
        ("GET", "/api/host/events"),
        ("POST", "/api/host/bookings/SS-AAAAAA/seat"),
        ("POST", "/api/host/bookings/SS-AAAAAA/clear"),
        ("POST", "/api/host/bookings/SS-AAAAAA/no-show"),
    ):
        answer = httpx.request(method, f"{app_url}{path}", timeout=HTTP_TIMEOUT, **({"json": {}} if method == "POST" else {}))
        assert_error(answer, 401, "unauthenticated")
    assert_error(post_json(app_url, "/api/host/walk-ins", {"table_id": "T1", "party_size": 2}, idempotency_key()), 401, "unauthenticated")
    client = host_client(app_url)
    assert client.get("/api/host/bookings").status_code == 200
    assert client.delete("/api/host/session").status_code == 204
    assert_error(client.get("/api/host/bookings"), 401, "unauthenticated")
    client.close()


def test_wf_host_service_sign_in_copy(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/host") as page:
        page.wait_for_url(lambda url: urlparse(url).path == "/host/sign-in")
        assert "ended" not in query(page) and query(page).get("next", "").startswith("/host")
        expect(page.get_by_role("status", name="Sign-in notice")).to_have_count(0)
        sign_in(page, password="wrong-password")
        expect(page.get_by_text("That email and password don't match.")).to_be_visible()
        assert urlparse(page.url).path == "/host/sign-in"
        sign_in(page)
        page.wait_for_url(lambda url: urlparse(url).path == "/host")
        today = tonight(app_url)
        expect(page.get_by_role("heading", level=1)).to_have_text(f"Tonight · {day_label(today)}")
        click(page.get_by_role("button", name="Sign out"))
        page.goto(f"{app_url}/host")
        page.wait_for_url(lambda url: urlparse(url).path == "/host/sign-in")
    for target in (f"{FOREIGN_ORIGIN}/host", f"{FOREIGN_ORIGIN}/host".removeprefix(urlparse(FOREIGN_ORIGIN).scheme + ":")):
        with visit(browser, f"{app_url}/host/sign-in?next={quote(target, safe='')}") as page:
            sign_in(page)
            page.wait_for_url(lambda url: urlparse(url).path == "/host" and same_origin(url, app_url))


def test_live_floor_shows_every_change(browser: Browser, clock_url: str, mail: Mailpit) -> None:
    day = evening(clock_url)
    live_ms = (LIVE_SECONDS + SLACK_SECONDS) * 1000
    client = host_client(clock_url)
    with host_page(browser, clock_url, host_path("18:00")) as host:
        navigations: list[str] = []
        host.on("framenavigated", lambda frame: navigations.append(frame.url))

        def shown(table: str, label: str, copy: str) -> None:
            await_announced(host, copy)
            expect(floor_option(host, table, label)).to_be_visible(timeout=live_ms)

        hold = take_hold(clock_url, day, "18:00", 2, "T1")
        shown("T1", "Held", "Table T1 held for 18:00.")
        expect(setting(host, 2, 2, "T1")).to_be_attached(timeout=live_ms)
        assert delete(clock_url, f"/api/holds/{hold['hold_id']}").status_code == 204
        shown("T1", "Free", "Hold on table T1 released.")
        seated = book(clock_url, day, "18:00", 2, "T2")
        shown("T2", "Booked 18:00", "Table T2 booked for 18:00, party of 2.")
        assert client.post(f"/api/host/bookings/{seated.reference}/seat", json={}).status_code == 200
        shown("T2", "Seated", "Table T2 seated.")
        assert client.post(f"/api/host/bookings/{seated.reference}/clear", json={}).status_code == 200
        shown("T2", "Free", "Table T2 cleared.")
        cancelled = book(clock_url, day, "18:00", 2, "T3")
        assert post_json(clock_url, f"/api/manage/{cancelled.token}/cancel", {}, idempotency_key()).status_code == 200
        shown("T3", "Free", f"Booking {cancelled.reference} at table T3 cancelled.")
        assert walk_in(client, "T4", 3).status_code == 201
        shown("T4", "Seated", "Walk-in seated at table T4, party of 3.")
        token, _, _ = offer_for(clock_url, mail, day, "18:00", 3, "T5")
        await_announced(host, "Table T5 offered to the waitlist for 18:00.", seconds=LIVE_SECONDS + MAIL_SECONDS)
        expect(floor_option(host, "T5", "Offered")).to_be_visible()
        assert post_json(clock_url, f"/api/offers/{token}/claim", {}, idempotency_key()).status_code == 201
        shown("T5", "Booked 18:00", "Waitlist offer for table T5 claimed.")
        _, _, offer = offer_for(clock_url, mail, day, "18:00", 3, "T6")
        no_show = book(clock_url, day, "18:00", 3, "T15")
        set_clock(clock_url, parse_instant(offer["expires_at"]))
        await_announced(host, "Waitlist offer for table T6 lapsed.", seconds=LIFT_SECONDS + SLACK_SECONDS)
        expect(floor_option(host, "T6", "Free")).to_be_visible(timeout=live_ms)
        set_clock(clock_url, lisbon(day, "18:15"))
        assert client.post(f"/api/host/bookings/{no_show.reference}/no-show", json={}).status_code == 200
        shown("T15", "Free", "Table T15 marked no-show.")
        assert not [url for url in navigations if urlparse(url).path != "/host"]
    client.close()


@pytest.mark.parametrize("viewport", [PHONE, TABLET, DESKTOP], ids=["phone", "tablet", "desktop"])
def test_host_floor_breakpoints(browser: Browser, clock_url: str, viewport: dict[str, int]) -> None:
    evening(clock_url)
    with host_page(browser, clock_url, host_path("18:00"), viewport=viewport) as page:
        covers = box(page.get_by_role("region", name="Tonight's covers"))
        floor = box(page.get_by_role("listbox", name="Tonight's floor"))
        bookings = box(page.get_by_role("region", name="Tonight's bookings"))
        width, height = viewport["width"], viewport["height"]
        if viewport is PHONE:
            assert covers["y"] < floor["y"] < bookings["y"]
        elif viewport is TABLET:
            assert covers["width"] >= width * 0.8
            assert covers["y"] + covers["height"] <= floor["y"] + 1
            assert floor["x"] + floor["width"] <= bookings["x"] + 1
        else:
            assert covers["x"] + covers["width"] <= floor["x"] + 1
            assert floor["x"] + floor["width"] <= bookings["x"] + 1
            assert bookings["x"] + bookings["width"] <= width + 1
        layout(page)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        click(floor_option(page, "C3"))
        dialog = table_dialog(page, "C3")
        expect(dialog).to_be_visible()
        rect = box(dialog)
        pinned = box(page.get_by_role("heading", level=1))
        assert rect["y"] >= pinned["y"] + pinned["height"] - 1
        assert rect["y"] + rect["height"] <= height + 1
        assert rect["x"] >= -1 and rect["x"] + rect["width"] <= width + 1
        scroll = page.evaluate("window.scrollY")
        # Wheel toward the side that still has room, so a page that does scroll behind the dialog is always caught.
        page.mouse.wheel(0, -500 if scroll > 0 else 500)
        expect(dialog).to_be_visible()
        assert page.evaluate("window.scrollY") == scroll, "the page behind the dialog scrolled"
        assert parse_qs(urlparse(page.url).query).get("table") == ["C3"]


def test_wf_host_floor_shared_totals(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    client = host_client(clock_url)
    with host_page(browser, clock_url, host_path("18:00")) as page:
        region = page.get_by_role("region", name="Tonight's covers")

        def totals(covers: int, window_row: int, courtyard: int) -> None:
            expect(region).to_contain_text(f"{covers} covers free at 18:00")
            expect(region).to_contain_text(f"Window Row: {window_row} of 10 seats free")
            expect(region).to_contain_text(f"Courtyard: {courtyard} of 8 seats free")
            api = host_floor(client, "18:00").json()["totals"]
            assert api["covers_free"] == covers == covers_at(clock_url, day, "18:00")["covers_free"]
            rooms = {room["room_id"]: room["covers_free"] for room in api["rooms"]}
            assert rooms["window-row"] == window_row and rooms["courtyard"] == courtyard
            assert sum(rooms.values()) == covers

        totals(64, 10, 8)
        take_hold(clock_url, day, "18:00", 2, "T1")
        totals(62, 8, 8)
        booked = book(clock_url, day, "18:00", 3, "T15")
        totals(58, 8, 4)
        assert post_json(clock_url, f"/api/manage/{booked.token}/cancel", {}, idempotency_key()).status_code == 200
        totals(62, 8, 8)
        assert walk_in(client, "T16", 4).status_code == 201
        totals(58, 8, 4)
    client.close()


def test_wf_host_floor_latest_showing_wins(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    book(clock_url, day, "18:00", 2, "T1")
    with host_page(browser, clock_url, host_path("18:00")) as page:
        region = page.get_by_role("region", name="Tonight's covers")
        expect(region).to_contain_text("62 covers free at 18:00")
        parked: list[Any] = []

        def park(route: Any) -> None:
            if parse_qs(urlparse(route.request.url).query).get("time") == ["18:30"]:
                parked.append(route)
            else:
                route.fallback()

        page.route("**/api/host/floor*", park)
        showing = page.get_by_role("combobox", name="Showing")
        select(showing, "18:30")
        poll(lambda: bool(parked) or page.evaluate("true") is None, 5, "the Showing change asked for 18:30")
        select(showing, "20:00")
        expect(region).to_contain_text("64 covers free at 20:00")
        expect(floor_option(page, "T1", "Free")).to_be_visible()
        try:
            parked[0].continue_()
        except Exception:
            pass

        def still_latest() -> None:
            expect(region).to_contain_text("64 covers free at 20:00")
            expect(floor_option(page, "T1", "Free")).to_be_visible()

        stays(still_latest, QUIET_SECONDS)
        assert parse_qs(urlparse(page.url).query).get("time")


def test_seat_and_clear_transitions(clock_url: str) -> None:
    day = evening(clock_url)
    client = host_client(clock_url)
    booked = book(clock_url, day, "18:00", 2, "T1")
    seat = f"/api/host/bookings/{booked.reference}/seat"
    clear = f"/api/host/bookings/{booked.reference}/clear"
    no_show = f"/api/host/bookings/{booked.reference}/no-show"
    assert_error(client.post(clear, json={}), 409, "invalid_transition")
    seated = client.post(seat, json={})
    assert seated.status_code == 200 and seated.json()["booking"]["status"] == "seated"
    floor = host_floor(client, "18:00").json()
    assert next(t for t in floor["tables"] if t["table_id"] == "T1")["status"] == "seated"
    assert_error(client.post(seat, json={}), 409, "invalid_transition")
    assert_error(client.post(no_show, json={}), 409, "invalid_transition")
    assert_error(post_json(clock_url, f"/api/manage/{booked.token}/cancel", {}, idempotency_key()), 409, "invalid_transition")
    assert_error(place_hold(clock_url, day, "18:15", 2, "T1"), 409, "table_taken")
    cleared = client.post(clear, json={})
    assert cleared.status_code == 200 and cleared.json()["booking"]["status"] == "completed"
    assert_error(client.post(clear, json={}), 409, "invalid_transition")
    assert_error(client.post(seat, json={}), 409, "invalid_transition")
    assert take_hold(clock_url, day, "18:15", 2, "T1")["status"] == "live"
    later = book(clock_url, plus_days(day, 2), "18:00", 2, "T1")
    assert_error(client.post(f"/api/host/bookings/{later.reference}/seat", json={}), 409, "not_tonight")
    assert_error(client.post(host_action(UNKNOWN_REFERENCE, "seat"), json={}), 404, "not_found")
    client.close()


def test_no_show_edge_keeps_deposit(clock_url: str, killbill: KillBill) -> None:
    day = evening(clock_url)
    client = host_client(clock_url)
    booked = book(clock_url, day, "18:00", 6, "T9")
    path = f"/api/host/bookings/{booked.reference}/no-show"
    assert_error(client.post(path, json={}), 409, "too_early")
    set_clock(clock_url, lisbon(day, "18:15") - timedelta(seconds=5))
    assert_error(client.post(path, json={}), 409, "too_early")
    assert client.get(f"/api/host/bookings").json()["bookings"][0]["status"] == "booked"
    set_clock(clock_url, lisbon(day, "18:15"))
    answer = client.post(path, json={})
    assert answer.status_code == 200, answer.text
    assert answer.json()["booking"]["status"] == "no_show"
    assert answer.json()["booking"]["deposit"] == {"amount_cents": 9000, "state": "retained"}
    assert kill_bill_transactions(killbill, booked.email, "REFUND") == []
    assert len(kill_bill_transactions(killbill, booked.email, "PURCHASE")) == 1
    assert_error(client.post(path, json={}), 409, "invalid_transition")
    floor = host_floor(client, "18:15").json()
    assert next(t for t in floor["tables"] if t["table_id"] == "T9")["status"] == "free"
    client.close()


def test_wf_host_service_run_the_evening(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    live_ms = (LIVE_SECONDS + SLACK_SECONDS) * 1000
    seated, missing = book(clock_url, day, "18:00", 2, "T1"), book(clock_url, day, "18:00", 2, "T2")
    client = host_client(clock_url)

    def status_of(reference: str) -> str:
        rows = client.get("/api/host/bookings").json()["bookings"]
        return next(row["status"] for row in rows if row["reference"] == reference)

    with host_page(browser, clock_url, host_path("18:00")) as page:
        region = page.get_by_role("region", name="Tonight's covers")
        showing = page.get_by_role("combobox", name="Showing")
        for hhmm in ("19:00", "20:00", "21:00", "18:00"):
            select(showing, hhmm)
        expect(region).to_contain_text("60 covers free at 18:00")
        expect(floor_option(page, "T1", "Booked 18:00")).to_be_visible()
        hold = take_hold(clock_url, day, "18:00", 2, "T3")
        expect(setting(page, 2, 2, "T3")).to_be_attached(timeout=live_ms)
        expect(floor_option(page, "T3", "Held")).to_be_visible(timeout=live_ms)
        await_announced(page, "Table T3 held for 18:00.")
        expect(region).to_contain_text("58 covers free at 18:00")
        set_clock(clock_url, parse_instant(hold["expires_at"]))
        expect(settings(page, "T3")).to_have_count(0, timeout=(LIFT_SECONDS + SLACK_SECONDS) * 1000)
        await_announced(page, "Hold on table T3 ended.", seconds=LIFT_SECONDS + SLACK_SECONDS)
        expect(floor_option(page, "T3", "Free")).to_be_visible()
        expect(region).to_contain_text("60 covers free at 18:00")

        click(floor_option(page, "T1"))
        dialog = table_dialog(page, "T1")
        click(dialog.get_by_role("button", name="Seat"))
        expect(floor_option(page, "T1", "Seated")).to_be_visible()
        assert status_of(seated.reference) == "seated"
        if dialog.count():
            expect(dialog.get_by_role("button", name="Clear table")).to_be_visible()
        else:
            click(floor_option(page, "T1"))
        click(dialog.get_by_role("button", name="Clear table"))
        expect(floor_option(page, "T1", "Free")).to_be_visible()
        expect(region).to_contain_text("62 covers free at 18:00")
        assert status_of(seated.reference) == "completed"
        row = page.get_by_role("region", name="Tonight's bookings").get_by_role("listitem").filter(has_text=seated.reference)
        expect(row).to_have_text(
            f"18:00 · {seated.reference} · {seated.name} · Party of 2 · Table T1 · Completed · No deposit"
        )
        if dialog.count():
            click(dialog.get_by_role("button", name="Close"))
        expect(dialog).to_have_count(0)

        set_clock(clock_url, lisbon(day, "18:15"))
        click(floor_option(page, "T2"))
        click(table_dialog(page, "T2").get_by_role("button", name="Mark no-show"))
        expect(floor_option(page, "T2", "Free")).to_be_visible()
        expect(region).to_contain_text("64 covers free at 18:00")
        assert status_of(missing.reference) == "no_show"
    client.close()


def test_wf_host_service_session_ended(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url, at="08:00")
    booked = book(clock_url, day, "20:30", 2, "T1")
    with host_page(browser, clock_url, host_path("20:30", "T1")) as page:
        dialog = table_dialog(page, "T1")
        expect(dialog).to_be_visible()
        seats: list[str] = []
        page.on("request", lambda r: seats.append(r.url) if r.method == "POST" and r.url.endswith("/seat") else None)
        set_clock(clock_url, lisbon(day, "20:01"))
        click(dialog.get_by_role("button", name="Seat"))
        page.wait_for_url(lambda url: urlparse(url).path == "/host/sign-in")
        current = query(page)
        assert current["ended"] == "1"
        target = urlparse(current["next"])
        assert target.path == "/host"
        assert parse_qs(target.query) == {"time": ["20:30"], "table": ["T1"]}
        expect(page.get_by_role("status", name="Sign-in notice")).to_have_text(SESSION_ENDED_COPY)
        sign_in(page)
        page.wait_for_url(lambda url: urlparse(url).path == "/host")
        expect(table_dialog(page, "T1")).to_be_visible()
        back = parse_qs(urlparse(page.url).query)
        assert back["time"] == ["20:30"] and back["table"] == ["T1"]
        expect(page.get_by_role("combobox", name="Showing")).to_be_visible()
        expect(page.get_by_role("region", name="Tonight's covers")).to_contain_text(f"covers free at {back['time'][0]}")
        assert len(seats) == 1, f"the interrupted Seat was sent {len(seats)} times"
    assert get(clock_url, f"/api/manage/{booked.token}").json()["booking"]["status"] == "booked"


def test_host_session_ends_on_server_clock(clock_url: str) -> None:
    day = evening(clock_url, at="08:00")
    signed = post_json(clock_url, "/api/host/session", {"email": HOST_EMAIL, "password": HOST_PASSWORD})
    assert signed.status_code == 200
    cookie = signed.headers["set-cookie"].split(";")[0]
    client = httpx.Client(base_url=clock_url, headers={"Cookie": cookie}, timeout=HTTP_TIMEOUT)
    ends = parse_instant(signed.json()["expires_at"])
    set_clock(clock_url, ends - timedelta(seconds=5))
    assert client.get("/api/host/bookings").status_code == 200
    set_clock(clock_url, ends)
    assert_error(client.get("/api/host/bookings"), 401, "unauthenticated")
    assert_error(client.post(host_action(UNKNOWN_REFERENCE, "seat"), json={}), 401, "unauthenticated")
    fresh = host_client(clock_url)
    assert fresh.get("/api/host/bookings").json()["date"] == day
    assert_error(client.get("/api/host/bookings"), 401, "unauthenticated")
    fresh.close()
    client.close()


def test_walk_in_rules(clock_url: str, killbill: KillBill, mail: Mailpit, valkey: Valkey) -> None:
    day = evening(clock_url, at="19:07")
    client = host_client(clock_url)
    before = covers_at(clock_url, day, "19:00")["covers_free"]
    answer = walk_in(client, "T1", 2)
    assert answer.status_code == 201, answer.text
    booking = answer.json()["booking"]
    assert re.fullmatch(r"SS-[A-Z0-9]{6}", booking["reference"])
    assert (booking["status"], booking["source"], booking["name"]) == ("seated", "walk_in", "Walk-in")
    assert (booking["date"], booking["time"]) == (day, "19:00")
    assert parse_instant(booking["starts_at"]) == lisbon(day, "19:00")
    assert booking["deposit"] == {"amount_cents": 0, "state": "none"} and booking["refund_cutoff"] is None
    assert covers_at(clock_url, day, "19:00")["covers_free"] == before - 2
    assert client.get("/api/host/floor").json()["totals"]["covers_free"] == before - 2
    assert valkey.keys(f"clock:hold:T1:{day}T*") == []
    assert_error(place_hold(clock_url, day, "20:30", 2, "T1"), 409, "table_taken")
    assert take_hold(clock_url, day, "20:45", 2, "T1")["status"] == "live"
    assert_error(walk_in(client, "T1", 2), 409, "table_taken")
    assert_error(walk_in(client, "T1", 5), 409, "table_not_for_party")
    assert_error(walk_in(client, "T9", 2), 409, "table_not_for_party")
    assert_error(walk_in(client, "T9", 7), 409, "table_not_for_party")
    invalid = walk_in(client, "T99", 9)
    assert set(assert_error(invalid, 422, "validation_failed")["fields"]) == {"table_id", "party_size"}
    wider = walk_in(client, "T4", 2)
    assert wider.status_code == 201, "eligibility must not refuse a walk-in"
    counter = walk_in(client, "C1", 2)
    assert counter.status_code == 201 and counter.json()["booking"]["deposit"]["amount_cents"] == 0
    joined = walk_in(client, "T7+T8", 7)
    assert joined.status_code == 201, joined.text
    references = [booking["reference"], counter.json()["booking"]["reference"]]
    for reference in references:
        assert killbill.payment_by_key(reference) is None
    sent = mail.messages(settle=QUIET_SECONDS)
    assert not [m for m in sent if any(reference in m["Subject"] or reference in text(m) for reference in references)]
    client.close()


def test_wf_walk_in_race_with_holds(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url, at="17:00")
    client = host_client(clock_url)
    with ThreadPoolExecutor(8) as pool:
        walkers = [pool.submit(walk_in, client, "T1", 2) for _ in range(4)]
        guests = [pool.submit(place_hold, clock_url, day, "18:15", 2, "T1") for _ in range(4)]
    walk_answers, hold_answers = [f.result() for f in walkers], [f.result() for f in guests]
    answers = walk_answers + hold_answers
    assert sum(1 for answer in answers if answer.status_code == 201) == 1, [a.status_code for a in answers]
    for answer in answers:
        if answer.status_code != 201:
            assert_error(answer, 409, "table_taken")
    walked = any(answer.status_code == 201 for answer in walk_answers)
    path = host_path("18:15" if not walked else "18:00")
    with host_page(browser, clock_url, path) as page:
        expect(floor_option(page, "T1", "Seated" if walked else "Held")).to_be_visible()
    client.close()


def test_wf_walk_in_phone_journey(browser: Browser, clock_url: str, mail: Mailpit) -> None:
    day = evening(clock_url)
    client = host_client(clock_url)

    def inside(page: Page, locator: Locator) -> None:
        rect = box(locator)
        assert rect["x"] >= -1 and rect["x"] + rect["width"] <= PHONE["width"] + 1, rect
        assert rect["y"] >= -1 and rect["y"] + rect["height"] <= PHONE["height"] + 1, rect
        hit = "e => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e === t || e.contains(t) || (t && t.contains(e)); }"
        assert locator.evaluate(hit), f"{locator} is covered where it is drawn"

    with visit(browser, book_url(clock_url, day, 2, "18:00"), viewport=PHONE, has_touch=True) as guest_page:
        expect(table_option(guest_page, "T1", "Fits your party")).to_be_visible()
        with host_page(browser, clock_url, host_path("18:00"), viewport=PHONE, has_touch=True) as page:
            tap(floor_option(page, "C3"))
            last = table_dialog(page, "C3")
            tap(last.get_by_role("button", name="Add walk-in"))
            inside(page, last)
            inside(page, last.get_by_role("combobox", name="Walk-in party size"))
            inside(page, last.get_by_role("button", name="Seat walk-in"))
            pinned = box(page.get_by_role("heading", level=1))
            assert box(last)["y"] >= pinned["y"] + pinned["height"] - 1
            tap(last.get_by_role("button", name="Close"))
            expect(last).to_have_count(0)

            tap(floor_option(page, "T1", "Free"))
            dialog = table_dialog(page, "T1")
            tap(dialog.get_by_role("button", name="Add walk-in"))
            size = dialog.get_by_role("combobox", name="Walk-in party size")
            inside(page, size)
            select(size, "2")
            seat = dialog.get_by_role("button", name="Seat walk-in")
            inside(page, seat)
            tap(seat)
            expect(floor_option(page, "T1", "Seated")).to_be_visible()
            await_announced(page, "Walk-in seated at table T1, party of 2.")
            expect(table_option(guest_page, "T1", "Taken")).to_be_visible(timeout=(LIVE_SECONDS + SLACK_SECONDS) * 1000)
    floor = host_floor(client, "18:00").json()
    row = next(t for t in floor["tables"] if t["table_id"] == "T1")
    assert row["status"] == "seated" and row["booking"]["source"] == "walk_in"
    assert row["booking"]["party_size"] == 2 and row["booking"]["name"] == "Walk-in"
    client.close()


def test_event_ids_replay_and_privacy(clock_url: str, kb_down_url: str, app_url: str, valkey: Valkey) -> None:
    day = plus_days(evening(clock_url), 2)
    stream = EventStream(f"{clock_url}/api/floor/events?date={day}")
    assert stream.status == 200
    secrets: list[str] = []
    for table in ("T1", "T2", "T3"):
        secrets.append(take_hold(clock_url, day, "20:00", 2, table)["hold_id"])
        deadline = time.monotonic() + LIVE_SECONDS + SLACK_SECONDS
        while time.monotonic() < deadline and not stream.events:
            pass
        if stream.events:
            break
    assert stream.events, "a hold produced no event on an open stream"
    base_count = len(stream.events)
    hold = take_hold(clock_url, day, "20:00", 2, "T13")
    assert delete(clock_url, f"/api/holds/{hold['hold_id']}").status_code == 204
    second = take_hold(clock_url, day, "20:00", 2, "T14")
    name, email = guest("events")
    confirmed = confirm(clock_url, second["hold_id"], name, email)
    assert confirmed.status_code == 201
    poll(lambda: len(stream.events) >= base_count + 4, LIVE_SECONDS + SLACK_SECONDS, "four more events reached the stream")
    stream.close()
    kinds = [event[1]["type"] for event in stream.events[base_count:]]
    assert kinds == ["hold.created", "hold.released", "hold.created", "booking.created"]
    token = token_from(confirmed.json()["manage_url"])
    forbidden = [name, email, confirmed.json()["booking"]["reference"], token, hold["hold_id"], second["hold_id"], *secrets]
    for event_id, payload, raw in stream.events:
        assert event_id, "every event carries an id"
        assert EVENT_TYPES_KEYS <= set(payload) and payload["date"] == day
        assert all(secret not in raw for secret in forbidden), f"private value in public event: {raw}"
    ids = [event[0] for event in stream.events]
    assert len(set(ids)) == len(ids)
    replay = EventStream(f"{clock_url}/api/floor/events?date={day}", {"Last-Event-ID": ids[0]})
    poll(lambda: len(replay.events) >= len(ids) - 1, READ_SECONDS + SLACK_SECONDS, "Last-Event-ID replayed the later events")
    replay.close()
    assert [event[0] for event in replay.events][: len(ids) - 1] == ids[1:]
    assert int(valkey.command("XLEN", f"clock:events:{day}")) >= len(ids)
    other_day = plus_days(day, 1)
    assert stream.events and all(event[1]["date"] == day for event in replay.events)
    quiet = EventStream(f"{clock_url}/api/floor/events?date={other_day}", {"Last-Event-ID": ids[0]})
    take_hold(clock_url, other_day, "20:00", 2, "T1")
    poll(lambda: bool(quiet.events), LIVE_SECONDS + SLACK_SECONDS, "the other date's stream received its own event")
    quiet.close()
    assert all(event[1]["date"] == other_day for event in quiet.events)
    assert_error(get(clock_url, f"/api/floor/events?date={BAD_DATE}"), 422, "validation_failed")
    shared_day, hhmm, table = open_slot(app_url, 2)
    shared = EventStream(f"{app_url}/api/floor/events?date={shared_day}")
    for candidate in (table, first_fit(app_url, shared_day, hhmm, 2)):
        if candidate and not shared.events:
            answer = place_hold(kb_down_url, shared_day, hhmm, 2, candidate)
            if answer.status_code == 201:
                poll(lambda: bool(shared.events), LIVE_SECONDS + SLACK_SECONDS, "an event from another instance reached this stream")
    shared.close()
    assert shared.events, "an event committed on another instance never arrived"


def test_host_stream_adds_detail(clock_url: str) -> None:
    day = evening(clock_url)
    client = host_client(clock_url)
    stream = EventStream(f"{clock_url}/api/host/events", {"Cookie": client.headers["Cookie"]})
    assert stream.status == 200
    booked = None
    for table in ("T1", "T2", "T3"):
        booked = book(clock_url, day, "18:00", 2, table)
        deadline = time.monotonic() + LIVE_SECONDS + SLACK_SECONDS
        while time.monotonic() < deadline:
            if any(e[1]["type"] == "booking.created" and e[1].get("reference") == booked.reference for e in stream.events):
                break
        else:
            continue
        break
    stream.close()
    assert booked
    event = next(e[1] for e in stream.events if e[1]["type"] == "booking.created" and e[1].get("reference") == booked.reference)
    assert event["name"] == booked.name
    assert "expires_at" in next(e[1] for e in stream.events if e[1]["type"] == "hold.created")
    client.close()


def test_open_page_reopens_dropped_stream(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 2)
    upstream = urlparse(clock_url)
    relay = TcpRelay(0, (upstream.hostname or "127.0.0.1", upstream.port or 80))
    relay.start()
    try:
        with visit(browser, book_url(f"http://127.0.0.1:{relay.port}", day, 2, "20:00")) as page:
            opened: list[float] = []
            page.on("request", lambda r: opened.append(time.monotonic()) if urlparse(r.url).path == "/api/floor/events" else None)
            expect(table_option(page, "T1", "Fits your party")).to_be_visible()
            take_hold(clock_url, day, "20:00", 2, "T1")
            expect(table_option(page, "T1", "Taken")).to_be_visible(timeout=(LIVE_SECONDS + SLACK_SECONDS) * 1000)
            opened.clear()
            relay.drop_connections()
            dropped = time.monotonic()
            take_hold(clock_url, day, "20:00", 2, "T2")
            poll(lambda: bool(opened) or page.evaluate("false"), LIVE_SECONDS + SLACK_SECONDS, "the page reopened its event stream")
            assert opened[0] - dropped <= LIVE_SECONDS + SLACK_SECONDS
            expect(table_option(page, "T2", "Taken")).to_be_visible(timeout=(LIVE_SECONDS + SLACK_SECONDS) * 1000)
            take_hold(clock_url, day, "20:00", 2, "T3")
            expect(table_option(page, "T3", "Taken")).to_be_visible(timeout=(LIVE_SECONDS + SLACK_SECONDS) * 1000)
    finally:
        relay.stop()


def test_wf_waitlist_offer_recovery(browser: Browser, flap_url: str, mail: Mailpit) -> None:
    with flap_services(flap_url) as (proxy, relay):
        day, hhmm, table = open_slot(flap_url, 2)
        booked = book(flap_url, day, hhmm, 2, table)
        response, email = join(flap_url, day, 2, hhmm, hhmm)
        assert response.status_code == 201
        with visit(browser, book_url(flap_url, day, 2, hhmm)) as page, host_page(browser, flap_url, "/host") as host:
            expect(table_option(page, table, "Taken")).to_be_visible()
            relay.stop()
            await_status(flap_url, holds="paused")
            started = time.monotonic()
            spare = first_fit(flap_url, day, hhmm, 2)
            assert spare
            assert_error(place_hold(flap_url, day, hhmm, 2, spare), 503, "holds_paused")
            assert time.monotonic() - started <= HOLDS_PAUSED_SECONDS + SLACK_SECONDS
            cancelled = post_json(flap_url, f"/api/manage/{booked.token}/cancel", {}, idempotency_key())
            assert cancelled.status_code == 200, cancelled.text
            no_mail(mail, email, "A table is free: ")
            wait_ms = (STATUS_CHECK_SECONDS + SLACK_SECONDS) * 1000
            expect(banner(page, HOLDS_BANNER)).to_be_visible(timeout=wait_ms)
            expect(banner(host, LIVE_PAUSED_BANNER)).to_be_visible(timeout=wait_ms)

            relay.start()
            returned = time.monotonic()
            await_status(flap_url, holds="ok")
            offer = await_mail(mail, email, "A table is free: ", seconds=OFFER_RECOVERY_SECONDS + SLACK_SECONDS)
            assert time.monotonic() - returned <= OFFER_RECOVERY_SECONDS + SLACK_SECONDS
            one_mail(mail, email, "A table is free: ")
            assert get(flap_url, f"/api/offers/{offer_token(offer)}").json()["table_id"] == table
            expect(banner(page, HOLDS_BANNER)).to_have_count(0, timeout=wait_ms)
            expect(banner(host, LIVE_PAUSED_BANNER)).to_have_count(0, timeout=wait_ms)
            poll(lambda: time.monotonic() - returned >= OFFER_RECOVERY_SECONDS, OFFER_RECOVERY_SECONDS + SLACK_SECONDS, "recovery window passed")
            take_hold(flap_url, day, hhmm, 2, spare)
            expect(table_option(page, spare, "Taken")).to_be_visible(timeout=(LIVE_SECONDS + SLACK_SECONDS) * 1000)
        assert post_json(flap_url, f"/api/offers/{offer_token(offer)}/claim", {}, idempotency_key()).status_code == 201

        proxy.stop()
        await_status(flap_url, deposits="paused")
        proxy.start()
        await_status(flap_url, deposits="ok")


def app_connections() -> int:
    rows = Postgres().rows(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user"
    )
    return int(rows[0]["n"])


def stuck_sessions() -> int:
    rows = Postgres().rows(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user "
        "AND state IN ('active', 'idle in transaction')"
    )
    return int(rows[0]["n"])


def valkey_clients(valkey: Valkey) -> int | None:
    try:
        match = re.search(r"connected_clients:(\d+)", str(valkey.command("INFO", "clients")))
    except Exception:
        return None
    return int(match.group(1)) if match else None


def test_streams_release_connections(app_url: str, valkey: Valkey) -> None:
    day = tonight(app_url)
    with ThreadPoolExecutor(10) as pool:
        list(pool.map(lambda _: get(app_url, f"/api/availability?date={day}&party=2"), range(10)))
    postgres_before, valkey_before = app_connections(), valkey_clients(valkey)
    for _ in range(ABORT_COUNT):
        close_raw_streams(open_raw_streams(app_url, day, 1))
    streams = open_raw_streams(app_url, day, STREAM_COUNT)
    assert get(app_url, "/api/health").status_code == 200
    close_raw_streams(streams)

    def released() -> bool:
        clients = valkey_clients(valkey)
        return (
            app_connections() <= postgres_before
            and stuck_sessions() == 0
            and (clients is None or valkey_before is None or clients <= valkey_before)
        )

    poll(released, RELEASE_SECONDS + SLACK_SECONDS, "app connections returned to their earlier level with no session active")
    assert get(app_url, f"/api/availability?date={day}&party=2").status_code == 200
    assert get(app_url, "/").status_code == 200


def test_fifty_streams_keep_reads_within_limit(browser: Browser, app_url: str) -> None:
    day, hhmm, table = open_slot(app_url, 2)
    streams = open_raw_streams(app_url, day, STREAM_COUNT)
    limit = READ_SECONDS + SLACK_SECONDS
    try:
        client = host_client(app_url)
        for call in (
            lambda: get(app_url, "/api/rules"),
            lambda: get(app_url, f"/api/availability?date={day}&party=2"),
            lambda: get(app_url, f"/api/plan?date={day}&time={quote(hhmm)}&party=2"),
            lambda: client.get("/api/host/floor"),
        ):
            started = time.monotonic()
            assert call().status_code == 200
            assert time.monotonic() - started <= limit
        client.close()
        with host_page(browser, app_url) as page:
            started = time.monotonic()
            page.goto(f"{app_url}/host")
            expect(floor_option(page, "T1")).to_be_visible(timeout=limit * 1000)
            assert time.monotonic() - started <= limit
            started = time.monotonic()
            page.goto(book_url(app_url, day, 2, hhmm))
            expect(table_option(page, table)).to_be_visible(timeout=limit * 1000)
            assert time.monotonic() - started <= limit
    finally:
        close_raw_streams(streams)


def test_wf_cross_cutting_dialog_focus(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 3)
    booked = book(clock_url, day, "20:00", 2, "T1")
    with visit(browser, f"{clock_url}/manage/{booked.token}") as page:
        opener = page.get_by_role("button", name="Cancel booking")
        click(opener)
        dialog = page.get_by_role("dialog", name="Cancel this booking")
        keep, yes = dialog.get_by_role("button", name="Keep booking"), dialog.get_by_role("button", name=re.compile("Yes, cancel|Cancelling"))
        expect(keep).to_be_focused()
        for key in ("Tab", "Shift+Tab"):
            for _ in range(5):
                page.keyboard.press(key)
                assert has_focus(dialog), f"{key} left the dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        click(opener)
        click(keep)
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        click(opener)
        parked: list[Any] = []
        page.route("**/cancel", lambda route: parked.append(route))
        click(yes)
        expect(dialog.get_by_role("button", name="Cancelling...")).to_be_visible()
        expect(yes).to_be_disabled()
        expect(keep).to_be_disabled()
        page.keyboard.press("Escape")
        expect(dialog).to_be_visible()
        poll(lambda: bool(parked) or page.evaluate("false"), 5, "the cancel request was sent")
        parked[0].continue_()
        expect(page.get_by_role("heading", level=1, name="Booking cancelled")).to_be_focused()
        expect(updates(page)).to_contain_text("Booking cancelled. No deposit was taken.")
    with host_page(browser, clock_url, host_path("18:00")) as host:
        option = floor_option(host, "T2")
        click(option)
        dialog = table_dialog(host, "T2")
        expect(dialog).to_be_visible()
        for key in ("Tab", "Shift+Tab"):
            for _ in range(5):
                host.keyboard.press(key)
                assert has_focus(dialog), f"{key} left the host dialog"
        host.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        assert has_focus(host.get_by_role("listbox", name="Tonight's floor"))
        assert "table" not in parse_qs(urlparse(host.url).query)


def test_reduced_motion_equivalents(browser: Browser, app_url: str, clock_url: str, short_url: str) -> None:
    with visit(browser, f"{app_url}/", reduced_motion="reduce") as page:
        title = page.get_by_role("heading", level=1, name="SAFFRON & SLATE")
        page.evaluate("window.scrollTo(0, window.innerHeight * 2)")
        expect(title).not_to_be_in_viewport()
        for room in ROOM_ORDER:
            expect(page.get_by_role("figure", name=room)).to_contain_text(room)
    day = plus_days(evening(clock_url), 3)
    party = 4
    with paused(browser, book_url(clock_url, day, party, "20:00"), reduced_motion="reduce") as page:
        option = table_option(page, "T4", "Fits your party")
        pump(page, lambda: option.count() == 1, "the plan loaded", step_ms=50)
        click(option)
        images = settings(page, "T4")
        pump(page, lambda: images.count() >= 1, "settings appeared after the 201", step_ms=1)
        assert images.count() == party, "settings must appear all at once"
        bar = page.get_by_role("progressbar", name="Hold time remaining")
        countdown = page.get_by_text(re.compile(r"^Held for \d:\d\d$"))
        pump(page, lambda: bar.count() == 1 and countdown.count() == 1, "ring and countdown shown", step_ms=1)
        first = bar_value(bar)
        previous = countdown.inner_text()
        for _ in range(14):
            advance(page, 1000)
            current = countdown.inner_text()
            assert current != previous, "the text countdown keeps updating every second"
            previous = current
            assert bar_value(bar) == first, "the progressbar holds between 15-second steps"
        advance(page, 2000)
        assert bar_value(bar) < first, "the progressbar moves on at its 15-second step"
    short_day, hhmm, table = open_slot(short_url, 3)
    with paused(browser, book_url(short_url, short_day, 3, hhmm), reduced_motion="reduce") as page:
        option = table_option(page, table, "Fits your party")
        pump(page, lambda: option.count() == 1, "the plan loaded", step_ms=50)
        click(option)
        images = settings(page, table)
        pump(page, lambda: images.count() == 3, "settings laid", step_ms=1)
        deadline = time.monotonic() + SHORT_TIMER_SECONDS + LIFT_SECONDS + SLACK_SECONDS
        while time.monotonic() < deadline and images.count():
            advance(page, 5)
            assert images.count() in (0, 3), "settings must leave all at once"
        assert images.count() == 0, "settings never left after the hold ended"


def test_wf_cross_cutting_touch_phone(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 3)
    take_hold(clock_url, day, "20:00", 2, "T2")
    with visit(browser, book_url(clock_url, day, 2, "20:00"), viewport=PHONE, has_touch=True) as page:
        plan = page.get_by_role("region", name="Floor plan")
        expect(table_option(page, "T1", "Fits your party")).to_be_visible()
        visible = plan.get_by_text("Fits your party", exact=True)
        assert visible.count() >= len(TWO_TOPS) - 1
        expect(visible.first).to_be_visible()
        expect(plan.get_by_text("Taken", exact=True).first).to_be_visible()
        expect(plan.get_by_text("Not for your party", exact=True).first).to_be_visible()
        for target in (slot(page, "20:00"), table_option(page, "T1"), table_option(page, "C3")):
            rect = box(target)
            assert rect["width"] >= TOUCH_PX and rect["height"] >= TOUCH_PX, f"{target} is {rect}"
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" else None)
        tap(table_option(page, "T9", "Not for your party"))
        expect(table_option(page, "T9", "Not for your party")).to_be_visible()
        assert posts == [], "tapping a table that does not fit sent a request"
        tap(table_option(page, "T1", "Fits your party"))
        expect(table_option(page, "T1", "Held by you")).to_be_visible()
        expect(plan.get_by_text("Held by you", exact=True).first).to_be_visible()
        for target in (page.get_by_role("button", name="Release table"), page.get_by_role("button", name="Book table")):
            rect = box(target)
            assert rect["width"] >= TOUCH_PX and rect["height"] >= TOUCH_PX, f"{target} is {rect}"
        layout(page)


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert all(isinstance(value, str) and value for value in manifest.values())
    assert manifest["_schema"] == "run-manifest-v1"


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert "Geist" in notices
    missing = [package.name for package in shipped_packages() if package.name not in notices]
    assert not missing, f"not in THIRD_PARTY_NOTICES.md: {missing}"


def test_if_licences_allowed() -> None:
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not refused, f"licences outside the allowlist: {refused}"


def test_if_no_other_datastore() -> None:
    other = {
        "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "kafkajs", "amqplib",
        "@aws-sdk/client-s3", "firebase", "firebase-admin", "@supabase/supabase-js", "bullmq", "memcached",
    }
    found = sorted(other & {package.name for package in shipped_packages()})
    assert not found, f"extra datastore clients shipped: {found}"


def test_if_no_third_party_requests(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/") as page:
        requested: list[str] = []
        page.on("request", lambda r: requested.append(r.url))
        for path in ("/", "/book", "/waitlist", "/host/sign-in"):
            page.goto(f"{app_url}{path}", wait_until="load")
            expect(page.get_by_role("heading", level=1).or_(page.get_by_role("button", name="Sign in")).first).to_be_visible()
        remote = [url for url in requested if url.startswith("http") and not same_origin(url, app_url)]
        assert not remote, f"third-party requests: {remote}"
        assert page.evaluate("document.fonts.ready.then(() => [...document.fonts].some(f => /geist/i.test(f.family)))")


def test_if_service_configuration_untouched(killbill: KillBill, valkey: Valkey) -> None:
    for path in Path("/app").glob("*compose*.y*ml"):
        content = path.read_text().lower()
        for service in ("postgres", "killbill", "mailpit", "valkey"):
            assert service in content, f"{path.name} no longer defines {service}"
    assert killbill.account_by_key(guest("config")[1]) is None
    assert isinstance(valkey.keys("no-such-prefix:*"), list)
    assert Postgres().rows("SELECT 1 AS one") == [{"one": 1}]


def test_waitlist_only_when_nothing_fits_a_party_of_two(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 4)
    for table in TWO_TOPS:
        take_hold(clock_url, day, "20:00", 2, table)
    for table in ("T4", "T5", "T6", "T11", "T12", "T15", "T16"):
        take_hold(clock_url, day, "20:00", 2, table)
    taken = covers_at(clock_url, day, "20:00")
    assert taken["eligible_tables"] == 0, taken
    assert taken["covers_free"] == 20, taken
    assert taken["bookable"] is True and taken["reason"] is None, taken
    free = covers_at(clock_url, day, "18:00")
    assert free["eligible_tables"] > 0, free
    assert free["covers_free"] == 64, free
    with visit(browser, book_url(clock_url, day, 2)) as page:
        expect(slot(page, "20:00")).to_have_accessible_name(
            f"20:00, {taken['covers_free']} covers free, waitlist only"
        )
        expect(slot(page, "18:00")).to_have_accessible_name(
            f"18:00, {free['covers_free']} covers free"
        )
        expect(page.get_by_role("link", name="Join the waitlist")).to_be_visible()


def test_waitlist_only_suffix_drops_when_a_pair_frees(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 5)
    held = [take_hold(clock_url, day, "20:00", 8, pair) for pair in ("T7+T8", "T11+T12")]
    taken = covers_at(clock_url, day, "20:00", 8)
    assert taken["eligible_tables"] == 0, taken
    with visit(browser, book_url(clock_url, day, 8)) as page:
        expect(slot(page, "20:00")).to_have_accessible_name(
            f"20:00, {taken['covers_free']} covers free, waitlist only"
        )
        assert delete(clock_url, f"/api/holds/{held[0]['hold_id']}").status_code == 204
        page.reload()
        freed = covers_at(clock_url, day, "20:00", 8)
        assert freed["eligible_tables"] > 0, freed
        expect(slot(page, "20:00")).to_have_accessible_name(f"20:00, {freed['covers_free']} covers free")


def test_waitlist_only_is_decided_per_party(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 6)
    for pair in ("T7+T8", "T11+T12"):
        take_hold(clock_url, day, "20:00", 7, pair)
    seven = covers_at(clock_url, day, "20:00", 7)
    two = covers_at(clock_url, day, "20:00", 2)
    assert seven["eligible_tables"] == 0 and two["eligible_tables"] > 0, (seven, two)
    assert seven["covers_free"] == two["covers_free"], (seven, two)
    with visit(browser, book_url(clock_url, day, 7)) as page:
        expect(slot(page, "20:00")).to_have_accessible_name(
            f"20:00, {seven['covers_free']} covers free, waitlist only"
        )
    with visit(browser, book_url(clock_url, day, 2)) as page:
        expect(slot(page, "20:00")).to_have_accessible_name(f"20:00, {two['covers_free']} covers free")


def test_booking_page_keeps_a_future_date_from_the_url(browser: Browser, clock_url: str) -> None:
    today = evening(clock_url, at="19:00")
    day = plus_days(today, 7)
    with visit(browser, book_url(clock_url, day, 4, "20:00")) as page:
        await_query(page, date=day, party="4", time="20:00")
        assert query(page)["date"] != today, f"the page fell back to today: {page.url}"
        expect(page.get_by_label("Date", exact=True)).to_have_value(day)
        expect(page.get_by_role("heading", level=1)).to_have_text(f"{day_label(day)} · 20:00 · 4 guests")
        expect(slot(page, "20:00")).to_have_attribute("aria-selected", "true")
        expect(table_option(page, "T4", "Fits your party")).to_be_visible()


def test_booking_page_keeps_the_last_allowed_date(browser: Browser, clock_url: str) -> None:
    today = evening(clock_url, at="19:00")
    last = plus_days(today, 30)
    with visit(browser, "about:blank") as page:
        page.goto(book_url(clock_url, last, 2))
        await_query(page, date=last, party="2")
        expect(page.get_by_label("Date", exact=True)).to_have_value(last)
        expect(page.get_by_role("heading", level=1)).to_have_text(f"{day_label(last)} · 2 guests")
        entries = page.evaluate("history.length")
        expect(slot(page, "20:00")).to_be_enabled()
        assert page.evaluate("history.length") == entries
        page.goto(book_url(clock_url, plus_days(today, 31), 2))
        await_query(page, date=today, party="2")
        expect(page.get_by_label("Date", exact=True)).to_have_value(today)


def test_booking_page_never_asks_for_today_on_a_future_url(browser: Browser, clock_url: str) -> None:
    today = evening(clock_url, at="19:00")
    day = plus_days(today, 9)
    with visit(browser, "about:blank") as page:
        seen: list[str] = []
        listen(page, seen)
        page.goto(book_url(clock_url, day, 2, "20:00"))
        expect(table_option(page, "T1", "Fits your party")).to_be_visible()
        poll(
            lambda: plan_index(seen, day, "20:00", 2) is not None,
            HTTP_TIMEOUT,
            "the plan for the URL's own date was requested",
        )
        poll(
            lambda: asked_for(seen, "/api/availability", day),
            HTTP_TIMEOUT,
            "the slot list for the URL's own date was requested",
        )
        page.reload()
        expect(table_option(page, "T1", "Fits your party")).to_be_visible()
        await_query(page, date=day, party="2", time="20:00")
        expect(page.get_by_label("Date", exact=True)).to_have_value(day)
        expect(slot(page, "20:00")).to_have_attribute("aria-selected", "true")


def window_row_option(table: str, status: str) -> str:
    return f"Table {table}, Window Row, 1 to 2 seats, {status}"


def test_plan_reads_taken_after_a_booking(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 7)
    booked = book(clock_url, day, "20:00", 2, "T1")
    assert booked.booking["table_id"] == "T1"
    statuses = plan_status(clock_url, day, "20:00", 2)
    assert [key for key, status in statuses.items() if status == "taken"] == ["T1"], statuses
    with visit(browser, book_url(clock_url, day, 2, "20:00")) as page:
        expect(table_option(page, "T1", "Taken")).to_have_accessible_name(window_row_option("T1", "Taken"))
        expect(table_option(page, "T2", "Fits your party")).to_have_accessible_name(
            window_row_option("T2", "Fits your party")
        )
        expect(settings(page, "T1")).to_have_count(0)


def test_plan_separates_taken_from_held_by_you(browser: Browser, clock_url: str) -> None:
    day = plus_days(evening(clock_url), 9)
    take_hold(clock_url, day, "20:00", 2, "T2")
    with visit(browser, book_url(clock_url, day, 2, "20:00")) as page:
        expect(table_option(page, "T2", "Taken")).to_have_accessible_name(window_row_option("T2", "Taken"))
        hold_by_click(page, "T1")
        expect(table_option(page, "T1", "Held by you")).to_have_accessible_name(
            window_row_option("T1", "Held by you")
        )
        expect(table_option(page, "T2", "Taken")).to_be_visible()
        expect(settings(page, "T2")).to_have_count(0)
    statuses = plan_status(clock_url, day, "20:00", 2)
    assert statuses["T1"] == "taken" and statuses["T2"] == "taken", statuses


def test_kill_bill_account_key_is_only_the_lowercased_email(clock_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 3)
    name, _ = guest("cased")
    email = f"Ana.{uuid_tail()}@Example.com"
    hold = take_hold(clock_url, day, "20:00", 6, "T9")
    assert hold["deposit_cents"] == 9000, hold
    answer = confirm(clock_url, hold["hold_id"], name, email, accept=True)
    assert answer.status_code == 201, answer.text
    reference = answer.json()["booking"]["reference"]
    account = killbill.account_by_key(email.lower())
    assert account, "no Kill Bill account under the lowercased email"
    assert account["currency"] == "EUR" and account["name"] == name, account
    assert account["externalKey"] == email.lower(), account
    searched = killbill.account(email)
    assert searched and searched["externalKey"] == email.lower(), searched
    assert searched["accountId"] == account["accountId"], (searched, account)
    payment = killbill.payment_by_key(reference)
    assert payment and payment["accountId"] == account["accountId"], payment
    assert "Deposit paid: €90.00" in lines(one_mail(mail, email, "Booking confirmed: "))


def test_mixed_case_addresses_share_one_kill_bill_account(clock_url: str, killbill: KillBill) -> None:
    day = plus_days(evening(clock_url), 3)
    name, _ = guest("twice")
    tail = uuid_tail()
    typed, lowered = f"Bea.{tail}@Example.com", f"bea.{tail}@example.com"
    assert typed.lower() == lowered, "the two addresses must differ only in case"
    references = []
    for email, table in ((typed, "T9"), (lowered, "T10")):
        hold = take_hold(clock_url, day, "20:00", 6, table)
        assert hold["deposit_cents"] == 9000, hold
        answer = confirm(clock_url, hold["hold_id"], name, email, accept=True)
        assert answer.status_code == 201, answer.text
        references.append(answer.json()["booking"]["reference"])
    account = killbill.account_by_key(lowered)
    assert account, "no Kill Bill account under the lowercased email"
    payments = killbill.payments(account["accountId"])
    assert len(payments) == 2, f"{len(payments)} payments: the two cases did not share one account"
    found = [killbill.payment_by_key(reference) for reference in references]
    assert all(found), f"a reference has no payment under its external key: {references}"
    assert {payment["paymentId"] for payment in found} == {payment["paymentId"] for payment in payments}
    charges = kill_bill_transactions(killbill, lowered, "PURCHASE")
    assert [amount_of(charge) for charge in charges] == [Decimal("90")] * 2


def test_losing_claims_never_reach_kill_bill(clock_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 10)
    token, email, offer = offer_for(clock_url, mail, day, "20:00", 6, "T9")
    assert offer["deposit_cents"] == 9000, offer
    with ThreadPoolExecutor(6) as pool:
        answers = list(
            pool.map(lambda _: post_json(clock_url, f"/api/offers/{token}/claim", {}, idempotency_key()), range(6))
        )
    winners = [answer for answer in answers if answer.status_code == 201]
    assert len(winners) == 1, [answer.status_code for answer in answers]
    for answer in answers:
        if answer.status_code != 201:
            assert_error(answer, 410, "offer_claimed")
    reference = winners[0].json()["booking"]["reference"]
    account = killbill.account_by_key(email.lower())
    assert account, "no Kill Bill account under the lowercased email"
    payments = killbill.payments(account["accountId"])
    assert len(payments) == 1, f"{len(payments)} payments after six racing claims"
    booked = killbill.payment_by_key(reference)
    assert booked and booked["paymentId"] == payments[0]["paymentId"], booked
    purchases = [t for t in payments[0]["transactions"] if t["transactionType"] == "PURCHASE"]
    assert len(purchases) == 1 and purchases[0]["status"] == KB_SUCCESS, purchases
    assert amount_of(purchases[0]) == Decimal("90")


def test_claim_after_the_winner_charges_nothing(clock_url: str, killbill: KillBill, mail: Mailpit) -> None:
    day = plus_days(evening(clock_url), 11)
    token, email, offer = offer_for(clock_url, mail, day, "20:00", 6, "T10")
    assert offer["deposit_cents"] == 9000, offer
    won = post_json(clock_url, f"/api/offers/{token}/claim", {}, idempotency_key())
    assert won.status_code == 201, won.text
    reference = won.json()["booking"]["reference"]
    assert_error(post_json(clock_url, f"/api/offers/{token}/claim", {}, idempotency_key()), 410, "offer_claimed")
    assert_error(get(clock_url, f"/api/offers/{token}"), 410, "offer_claimed")
    charges = kill_bill_transactions(killbill, email, "PURCHASE")
    assert [amount_of(charge) for charge in charges] == [Decimal("90")]
    account = killbill.account_by_key(email.lower())
    assert account and len(killbill.payments(account["accountId"])) == 1
    assert one_mail(mail, email, "Booking confirmed: ")["Subject"] == f"Booking confirmed: {reference}"


def test_floor_announces_a_hold_at_its_own_slot(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    live_ms = (LIVE_SECONDS + SLACK_SECONDS) * 1000
    with host_page(browser, clock_url, host_path("18:00")) as host:
        take_hold(clock_url, day, "18:30", 2, "T1")
        await_announced(host, "Table T1 held for 18:30.")
        said = [line for line in host.evaluate("window.__announced") if line]
        assert not [line for line in said if "Table T1 held for 18:00." in line], said
        expect(floor_option(host, "T1", "Free")).to_be_visible(timeout=live_ms)
        take_hold(clock_url, day, "18:00", 2, "T2")
        await_announced(host, "Table T2 held for 18:00.")
        expect(floor_option(host, "T2", "Held")).to_be_visible(timeout=live_ms)


def test_floor_tells_a_released_hold_from_an_ended_one(browser: Browser, clock_url: str) -> None:
    day = evening(clock_url)
    live_ms = (LIVE_SECONDS + SLACK_SECONDS) * 1000
    with host_page(browser, clock_url, host_path("18:00")) as host:
        released = take_hold(clock_url, day, "18:00", 2, "T1")
        await_announced(host, "Table T1 held for 18:00.")
        assert delete(clock_url, f"/api/holds/{released['hold_id']}").status_code == 204
        await_announced(host, "Hold on table T1 released.")
        expect(floor_option(host, "T1", "Free")).to_be_visible(timeout=live_ms)
        lapsing = take_hold(clock_url, day, "18:00", 2, "T2")
        await_announced(host, "Table T2 held for 18:00.")
        set_clock(clock_url, parse_instant(lapsing["expires_at"]))
        await_announced(host, "Hold on table T2 ended.", seconds=LIFT_SECONDS + SLACK_SECONDS)
        expect(floor_option(host, "T2", "Free")).to_be_visible(timeout=live_ms)
        said = [line for line in host.evaluate("window.__announced") if line]
        assert not [line for line in said if "Hold on table T2 released." in line], said
        assert not [line for line in said if "Hold on table T1 ended." in line], said


def waitlist_url(base: str, day: str, party: int) -> str:
    return f"{base}/waitlist?date={day}&party={party}&earliest=18:00&latest=22:00"


def waitlist_controls(page: Page) -> list[Locator]:
    return [
        page.get_by_role("radiogroup", name="Party size"),
        page.get_by_label("Date", exact=True),
        page.get_by_role("combobox", name="Earliest time"),
        page.get_by_role("combobox", name="Latest time"),
        textbox(page, "Name"),
        textbox(page, "Email"),
        page.get_by_role("button", name="Join the waitlist"),
    ]


def stacked_boxes(page: Page) -> list[dict[str, float]]:
    return sorted((box(control) for control in waitlist_controls(page)), key=lambda rect: rect["y"])


def pinned_summary(page: Page) -> dict[str, Any]:
    found = page.evaluate(
        """() => {
            const pinned = [...document.body.getElementsByTagName('*')].filter(node => {
                const rect = node.getBoundingClientRect();
                return ['sticky', 'fixed'].includes(getComputedStyle(node).position)
                    && rect.height > 0 && rect.width > 0 && (node.textContent ?? '').trim();
            });
            const top = pinned.sort((a, b) =>
                a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
            return top ? {...top.getBoundingClientRect().toJSON(), text: top.textContent.trim()} : null;
        }"""
    )
    assert found, "no pinned line with text: nothing stays at the top while the form scrolls under it"
    return found


def test_waitlist_form_is_one_column_at_every_width(browser: Browser, app_url: str) -> None:
    day = tonight(app_url)
    for viewport in (PHONE, TABLET, DESKTOP):
        with visit(browser, waitlist_url(app_url, day, 2), viewport=viewport) as page:
            boxes = stacked_boxes(page)
            for earlier, later in zip(boxes, boxes[1:]):
                assert later["y"] >= earlier["y"] + earlier["height"] - 1, f"two controls share a row at {viewport}"
            for rect in boxes:
                assert rect["x"] >= -1 and rect["x"] + rect["width"] <= viewport["width"] + 1, f"{rect} at {viewport}"
            layout(page)
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_waitlist_summary_line_stays_pinned(browser: Browser, app_url: str) -> None:
    day = tonight(app_url)
    for viewport in (PHONE, TABLET, DESKTOP):
        with visit(browser, waitlist_url(app_url, day, 2), viewport=viewport) as page:
            summary = pinned_summary(page)
            topmost = stacked_boxes(page)[0]
            assert summary["y"] + summary["height"] <= topmost["y"] + 1, (summary, topmost)
            page.evaluate("window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'})")
            after = pinned_summary(page)
            assert after["text"] == summary["text"], (after, summary)
            assert after["y"] >= -1 and after["y"] + after["height"] <= viewport["height"] + 1, after
            assert abs(after["y"] - summary["y"]) <= 1, "the pinned line scrolled away with the form"


def test_waitlist_controls_are_tappable_on_a_phone(browser: Browser, app_url: str) -> None:
    day = tonight(app_url)
    name, email = guest("tapper")
    with visit(browser, waitlist_url(app_url, day, 2), viewport=PHONE, has_touch=True) as page:
        for control in waitlist_controls(page):
            rect = box(control)
            assert rect["width"] >= TOUCH_PX and rect["height"] >= TOUCH_PX, f"{control} is {rect}"
        fill_details(page, name, email)
        button = page.get_by_role("button", name="Join the waitlist")
        drawn = box(button)
        landed = button.evaluate(
            "(element, point) => element === document.elementFromPoint(point.x, point.y)"
            " || element.contains(document.elementFromPoint(point.x, point.y))",
            {"x": drawn["x"] + drawn["width"] / 2, "y": drawn["y"] + drawn["height"] / 2},
        )
        assert landed, f"a tap at the centre of Join the waitlist lands on something else: {drawn}"
        tap(button)
        expect(updates(page)).to_contain_text(
            re.compile(r"You're on the waitlist at position \d+\. We'll email you if a table frees up\.")
        )
        layout(page)
    assert join(app_url, day, 2, "18:00", "22:00", email=email)[0].status_code == 200
