from __future__ import annotations

import concurrent.futures as cf
import contextlib
import hashlib
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
import uuid
from datetime import date, datetime, timedelta
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    S3,
    KillBill,
    Mailpit,
    addresses,
    advance,
    axe,
    center,
    check,
    click,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    tab_order,
    tap,
    text,
    unique,
)


HTTP_TIMEOUT = 60.0
UI_WAIT = 30.0
MAIL_WAIT = 120.0
MAIL_SETTLE = 4.0
EXPIRY_WAIT = 60.0
COPY_BOOT = 300.0
REFRESH_SLACK = 8.0
BOUNDARY_MARGIN = 20
LATE_MARGIN = 2
POLL_LIMIT = 400

OWNER_EMAIL = "owner@stationhouse.test"
OWNER_PASSWORD = "owner-pass-2026"
OWNER_NAME = "Imani Ferro"
LEAD_EMAIL = "lead@stationhouse.test"
LEAD_PASSWORD = "lead-pass-2026"
LEAD_NAME = "Theo Park"
TENANT_PASSWORD = "tenant-pass-2026"
DANA_EMAIL = "dana@brightfork.test"
NEW_PASSWORD = "cook-pass-2026-verifier"
WRONG_PASSWORD = "wrong-password-xx"
EVIL_ORIGIN = "https://evil.test"

DRAFT_FILE = "draft.pdf"
RESUME_FILE = "resume.pdf"
OTHER_FILE = "secret-name.pdf"
NOTE_TRANSITIONS = "Hob wiped"
NOTE_KEYBOARD = "Floors mopped"
NOTE_JOURNEY = "Degreased the range"
RECOVERY_BUSINESS = "Recovery Bakery"
RECOVERY_CONTACT = "Rae Bloom"
BAD_EMAIL = "not-an-email"
SHORT_PASSWORD = "short"

WAITING_LABEL = "Waiting for review"
APPROVED_LABEL = "Approved"
EMAIL_ERROR = "Enter a valid email address."
SHORT_ERROR = "Use at least 10 characters."

CLEANUP_MINUTES = 30
HALF_HOUR = 30
DEFAULT_SPAN = ("09:00", "12:00")
MIN_BOOKING = 120
HORIZON_DAYS = 60
CHECKIN_LEAD = 30
EXTRUSION_PX = 96
BAR_UNITS = 160
SMALL_PACK = 10
PRICE_CENTS = {10: 26000, 20: 48000, 40: 88000}
REFUND_EXAMPLE_CENTS = 19500
REFUND_EXAMPLE_MINUTES = 450
FILE_LIMIT = 5_000_000
UPLOAD_LIMIT = 6_000_000
JSON_LIMIT = 65_536
MIN_LIMIT_DOLLARS = 1_000_000
CLAIM_LIMIT = 10
CLAIM_WINDOW = 60
SIGNIN_FAILURES = 5
SIGNIN_WINDOW_DEFAULT = 900
REFRESH_SECONDS = 10
FLOOR_VISIBLE = 12
DOOR_REFRESH = 15
DOOR_VISIBLE = 17
FLIP_MS = 420
BAR_MS = 600
BAR_STAGGER_MS = 40
COOLER_CELLS = 36
HOUR_NUMERALS = 19
TAP_TARGET = 44
NOTE_MAX = 500
OPEN_MINUTE = 5 * 60
CLOSE_MINUTE = 23 * 60
DOOR_EARLIEST = OPEN_MINUTE - CHECKIN_LEAD + 5
DOOR_LATEST = 19 * 60 + 25
VIEWPORTS = {"wide": (1280, 800), "medium": (768, 1024), "narrow": (375, 812)}

SEED_STATIONS = ("range-1", "range-2", "range-3", "prep-a", "prep-b", "mixer-60", "mixer-20", "shelf-1", "shelf-2", "shelf-3")
GRID = {"range-1": (0, 0), "range-2": (1, 0), "range-3": (2, 0), "prep-a": (0, 1), "prep-b": (1, 1), "mixer-60": (2, 1), "mixer-20": (3, 1), "shelf-1": (0, 2), "shelf-2": (1, 2), "shelf-3": (2, 2)}
PNG_SIG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
JPEG_SIG = bytes([0xFF, 0xD8, 0xFF])
CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
JSON_CT = {"Content-Type": "application/json"}
DASH = "–"


def P(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def hm(moment: datetime) -> str:
    return moment.strftime("%H:%M")


def clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def minute_of(hhmm: str) -> int:
    hour, minute = (int(x) for x in hhmm.split(":"))
    return hour * 60 + minute


def dre(day: date) -> str:
    return rf"{day:%a} 0?{day.day} {day:%b} {day.year}"


def dur(minutes: int) -> str:
    if minutes == 0:
        return "0 min"
    hours, rest = divmod(minutes, 60)
    if hours == 0:
        return f"{rest} min"
    return f"{hours} h" if rest == 0 else f"{hours} h {rest}"


def half_up(numerator: int, denominator: int) -> int:
    return int(Fraction(numerator, denominator) + Fraction(1, 2))


def extrusion(station: dict, span: int) -> int:
    return half_up(station["occupiedMinutes"] * EXTRUSION_PX, span)


def station_label(station: dict, span: int) -> str:
    return "full" if station["freeMinutes"] == 0 else f"{dur(station['freeMinutes'])} free of {dur(span)}"


def money(cents: int) -> str:
    return f"${cents // 100}.{cents % 100:02d}"


def pack_heading(hours: int, number: int = 1) -> str:
    return f"{hours}-hour pack #{number}"


def refund_button(hours: int) -> str:
    return f"Refund {hours}-hour pack"


def status_line(label: str) -> str:
    return f"Status: {label}"


def at(zone: ZoneInfo, day: date, hhmm: str) -> datetime:
    hour, minute = (int(x) for x in hhmm.split(":"))
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone)


def half_hours() -> list[str]:
    return [clock(OPEN_MINUTE + HALF_HOUR * i) for i in range(COOLER_CELLS)]


def session_token(response: httpx.Response) -> str | None:
    for value in response.headers.get_list("set-cookie"):
        match = re.match(r"\s*sh_session=([^;]*)", value)
        if match and match.group(1):
            return match.group(1)
    return None


class Api:
    def __init__(self, base: str, token: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        self.token = token
        self.user: dict[str, Any] = {}
        self.email = ""
        self.password = ""
        self.business = ""
        self.contact = ""

    @property
    def tenant_id(self) -> str:
        return self.user["tenant"]["id"]

    def clone(self, base: str | None = None) -> "Api":
        other = Api(base or self.base, self.token)
        other.user, other.email, other.password = self.user, self.email, self.password
        other.business, other.contact = self.business, self.contact
        return other

    def call(self, method: str, path: str, body: Any = None, *, key: str | None = None, headers: dict | None = None,
             files: Any = None, data: Any = None, content: bytes | None = None) -> httpx.Response:
        sent = dict(headers or {})
        if self.token and "Cookie" not in sent:
            sent["Cookie"] = f"sh_session={self.token}"
        if key is not None:
            sent["Idempotency-Key"] = key
        if files is not None or data is not None:
            return self.http.request(method, path, headers=sent, files=files, data=data)
        if content is not None:
            return self.http.request(method, path, headers=sent, content=content)
        if body is not None:
            return self.http.request(method, path, headers=sent, json=body)
        return self.http.request(method, path, headers=sent)

    def ok(self, method: str, path: str, body: Any = None, **kw: Any) -> Any:
        response = self.call(method, path, body, **kw)
        assert 200 <= response.status_code < 300, f"{method} {path} answered {response.status_code}: {response.text[:400]}"
        return response.json() if response.content else None

    def me(self) -> dict:
        return self.ok("GET", "/api/me")


def expect_error(response: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert response.status_code == status, f"expected {status} {code}, got {response.status_code}: {response.text[:400]}"
    body = response.json()
    assert body.get("error") == code, body
    allowed = {"error", "message", "fields"} if code == "validation_failed" else {"error", "message"}
    assert set(body) <= allowed and isinstance(body.get("message"), str) and body["message"], body
    if message is not None:
        assert body["message"] == message, body
    return body


def sign_in(base: str, email: str, password: str) -> Api:
    api = Api(base)
    response = api.call("POST", "/api/session", {"email": email, "password": password})
    assert response.status_code == 200, f"sign-in for {email} answered {response.status_code}: {response.text[:300]}"
    api.token = session_token(response)
    assert api.token, "POST /api/session set no sh_session cookie"
    api.user, api.email, api.password = response.json()["user"], email, password
    return api


def owner(base: str) -> Api:
    return sign_in(base, OWNER_EMAIL, OWNER_PASSWORD)


def lead(base: str) -> Api:
    return sign_in(base, LEAD_EMAIL, LEAD_PASSWORD)


def kitchen(base: str) -> dict:
    response = httpx.get(f"{base.rstrip('/')}/api/kitchen", timeout=HTTP_TIMEOUT)
    assert response.status_code == 200, response.text[:300]
    return response.json()


def kitchen_today(base: str) -> date:
    return date.fromisoformat(kitchen(base)["today"])


def env_url(name: str) -> str:
    value = os.environ.get(name)
    assert value, f"{name} is not set; the spec publishes it for an outage instance"
    return value.rstrip("/")


def pdf_bytes(size: int = 3000) -> bytes:
    return b"%PDF-1.7\n" + os.urandom(size) + b"\n%%EOF\r\n"


def upload(api: Api, kind: str, expires: date, data: bytes | None = None, *, limit: int = MIN_LIMIT_DOLLARS,
           insured: str = "true", name: str = "document.pdf", ctype: str = "application/pdf",
           extra: dict | None = None) -> httpx.Response:
    fields = {"kind": kind, "expiresOn": expires.isoformat()}
    if kind == "insurance_certificate":
        fields.update(perOccurrenceLimit=str(limit), additionalInsured=insured)
    fields.update(extra or {})
    return api.call("POST", "/api/documents", files={"file": (name, data if data is not None else pdf_bytes(), ctype)}, data=fields)


def new_tenant(base: str, *, docs: bool = True, approve: bool = True, ins_days: int = 200, food_days: int = 200,
               contact: str | None = None, packs: int = 0) -> Api:
    first, second = unique("cook")
    email = first if "@" in first else second
    tag = uuid.uuid4().hex[:8]
    api = Api(base)
    api.contact = contact or f"Cook {tag}"
    api.business = f"Verifier {tag} Kitchen"
    response = api.call("POST", "/api/tenants/apply", {"businessName": api.business, "contactName": api.contact, "email": email, "password": NEW_PASSWORD})
    assert response.status_code == 201, f"apply answered {response.status_code}: {response.text[:300]}"
    api.token, api.user, api.email, api.password = session_token(response), response.json()["user"], email, NEW_PASSWORD
    today = kitchen_today(base)
    if docs:
        assert upload(api, "insurance_certificate", today + timedelta(days=ins_days)).status_code == 201
        assert upload(api, "food_handler_card", today + timedelta(days=food_days)).status_code == 201
        if approve:
            owner(base).ok("POST", f"/api/tenants/{api.tenant_id}/approve")
    for _ in range(packs):
        buy(api, SMALL_PACK)
    return api


def buy(api: Api, hours: int = SMALL_PACK, key: str | None = None) -> dict:
    if hours != SMALL_PACK:
        api.ok("POST", "/api/session/confirm", {"password": api.password})
    response = api.call("POST", "/api/packs", {"hours": hours}, key=key or idempotency_key())
    assert response.status_code == 201, f"purchase answered {response.status_code}: {response.text[:300]}"
    return response.json()


def pack_detail(api: Api, pack_id: str) -> dict:
    return api.ok("GET", f"/api/packs/{pack_id}")


def assert_ledger(detail: dict) -> None:
    groups: dict[str, list[dict]] = {}
    for entry in detail["entries"]:
        groups.setdefault(entry["movementId"], []).append(entry)
    for movement, entries in groups.items():
        assert len(entries) == 2, f"movement {movement} has {len(entries)} entries; expected a pair"
        assert {e["side"] for e in entries} == {"pack", "kitchen"}
        assert sum(e["minutes"] for e in entries) == 0 and entries[0]["movement"] == entries[1]["movement"]
    assert detail["balanceMinutes"] == sum(e["minutes"] for e in detail["entries"] if e["side"] == "pack")
    assert detail["balanceMinutes"] >= 0


def movements(detail: dict, kind: str, booking_id: str | None = None) -> list[dict]:
    return [e for e in detail["entries"] if e["movement"] == kind and e["side"] == "pack" and (booking_id is None or e["bookingId"] == booking_id)]


class Slot:
    def __init__(self, day: date, station: dict, shelf: dict | None, start: datetime, end: datetime) -> None:
        self.day, self.station, self.shelf, self.start, self.end = day, station, shelf, start, end

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)

    def body(self, *, paired: bool = False, station: str | None = None, start: datetime | None = None,
             end: datetime | None = None) -> dict:
        body = {"stationId": station or self.station["id"], "start": (start or self.start).isoformat(), "end": (end or self.end).isoformat()}
        if paired:
            body["shelfId"] = self.shelf["id"]
        return body


def interval_free(station: dict, start: datetime, guard_end: datetime) -> bool:
    return all(not (P(iv["start"]) < guard_end and start < P(iv["bufferEnd"])) for iv in station["intervals"])


def find_slot(api: Api, *, minutes: int = MIN_BOOKING, kinds: tuple[str, ...] = ("range", "prep_table", "mixer"),
              shelf: bool = False, days: tuple[int, int] = (2, 57), starts: list[str] | None = None,
              extra_free: int = 0, avoid: set[date] | None = None) -> Slot:
    info = kitchen(api.base)
    zone, today = ZoneInfo(info["timeZone"]), date.fromisoformat(info["today"])
    rng = random.Random(uuid.uuid4().int)
    for _ in range(60):
        day = today + timedelta(days=rng.randint(*days))
        if avoid and day in avoid:
            continue
        stations = api.ok("GET", f"/api/floor?date={day.isoformat()}")["stations"]
        main = [s for s in stations if s["kind"] in kinds]
        shelves = [s for s in stations if s["kind"] == "cooler_shelf"]
        rng.shuffle(main)
        rng.shuffle(shelves)
        options = list(starts or half_hours())
        rng.shuffle(options)
        for hhmm in options:
            start = at(zone, day, hhmm)
            end = start + timedelta(minutes=minutes)
            if end + timedelta(minutes=extra_free) > at(zone, day, clock(CLOSE_MINUTE)):
                continue
            guard = end + timedelta(minutes=CLEANUP_MINUTES + extra_free)
            for station in main:
                if not interval_free(station, start, guard):
                    continue
                partner = None
                if shelf:
                    partner = next((s for s in shelves if s["id"] != station["id"] and interval_free(s, start, guard)), None)
                    if partner is None:
                        continue
                return Slot(day, station, partner, start, end)
    pytest.fail("no free station window on any sampled kitchen date; expected room inside the 60-day horizon")


def claim(api: Api, body: dict, key: str | None = None) -> httpx.Response:
    return api.call("POST", "/api/bookings", body, key=key or idempotency_key())


def hold(api: Api, *, paired: bool = False, **kw: Any) -> tuple[dict, Slot]:
    for _ in range(6):
        slot = find_slot(api, shelf=paired, **kw)
        response = claim(api, slot.body(paired=paired))
        if response.status_code == 201:
            return response.json(), slot
        expect_error(response, 409, "slot_taken")
    pytest.fail("every sampled free window was taken before the claim; expected a held booking")


def confirmed(api: Api, **kw: Any) -> tuple[dict, Slot]:
    booking, slot = hold(api, **kw)
    return api.ok("POST", f"/api/bookings/{booking['id']}/confirm"), slot


def next_half_hour(base: str) -> tuple[dict, datetime, datetime]:
    deadline = time.monotonic() + 3 * BOUNDARY_MARGIN
    while time.monotonic() < deadline:
        info = kitchen(base)
        now = P(info["now"])
        floor_minute = now.replace(second=0, microsecond=0)
        boundary = floor_minute - timedelta(minutes=floor_minute.minute % HALF_HOUR) + timedelta(minutes=HALF_HOUR)
        if (boundary - now).total_seconds() >= BOUNDARY_MARGIN:
            return info, now, boundary
        threading.Event().wait(0.25)
    pytest.fail("kitchen now stayed in the last seconds before a half hour")


def door_base(app_url: str) -> str:
    best: tuple[int, str] | None = None
    candidates = [app_url] + [os.environ[n].rstrip("/") for n in ("APP_MAILPIT_DOWN_ISOLATED_URL", "APP_OFFSET_ZONE_URL", "APP_SHORT_URL") if os.environ.get(n)]
    for base in candidates:
        now = P(kitchen(base)["now"])
        minute = now.hour * 60 + now.minute
        if not DOOR_EARLIEST <= minute <= DOOR_LATEST:
            continue
        floor_minute = now.replace(second=0, microsecond=0)
        boundary = floor_minute - timedelta(minutes=floor_minute.minute % HALF_HOUR) + timedelta(minutes=HALF_HOUR)
        stations = lead(base).ok("GET", f"/api/floor?date={boundary.date().isoformat()}")["stations"]
        guard = boundary + timedelta(minutes=MIN_BOOKING + CLEANUP_MINUTES)
        free = sum(interval_free(s, boundary, guard) for s in stations)
        if best is None or free > best[0]:
            best = (free, base)
    if best is None or best[0] == 0:
        pytest.fail("no instance is inside its check-in hours with a free station")
    return best[1]


def door_booking(api: Api, *, later: int = 0, confirm: bool = True, any_time: bool = False) -> dict:
    offsets = range(later, later + 1) if not any_time else range(later, 2 * (CLOSE_MINUTE - OPEN_MINUTE) // HALF_HOUR)
    for _ in range(4):
        _, _, boundary = next_half_hour(api.base)
        for step in offsets:
            start = boundary + timedelta(minutes=HALF_HOUR * step)
            end = start + timedelta(minutes=MIN_BOOKING)
            if end.hour * 60 + end.minute > CLOSE_MINUTE or end.date() != start.date():
                break
            stations = api.ok("GET", f"/api/floor?date={start.date().isoformat()}")["stations"]
            free = [s for s in stations if interval_free(s, start, end + timedelta(minutes=CLEANUP_MINUTES))]
            random.shuffle(free)
            for station in free:
                response = claim(api, {"stationId": station["id"], "start": start.isoformat(), "end": end.isoformat()})
                if response.status_code == 201:
                    booking = response.json()
                    return api.ok("POST", f"/api/bookings/{booking['id']}/confirm") if confirm else booking
                expect_error(response, 409, "slot_taken")
    pytest.fail("no station free from the next half hour today; expected room for a door booking")

def release_door_stations(api: Api, bookings: list[dict]) -> None:
    for booking in bookings:
        api.call("POST", f"/api/bookings/{booking['id']}/cancel")


def late_slot(api: Api, minutes: int = MIN_BOOKING) -> Slot:
    info = kitchen(api.base)
    now, zone, today = P(info["now"]), ZoneInfo(info["timeZone"]), date.fromisoformat(info["today"])
    starts = []
    for hhmm in half_hours():
        same_day = at(zone, today, hhmm)
        if same_day > now + timedelta(minutes=LATE_MARGIN):
            starts.append(same_day)
        if same_day < now - timedelta(minutes=LATE_MARGIN):
            starts.append(at(zone, today + timedelta(days=1), hhmm))
    random.shuffle(starts)
    floors: dict[date, list[dict]] = {}
    for start in starts:
        end = start + timedelta(minutes=minutes)
        if end > at(zone, start.date(), clock(CLOSE_MINUTE)):
            continue
        if start.date() not in floors:
            floors[start.date()] = api.ok("GET", f"/api/floor?date={start.date().isoformat()}")["stations"]
        for station in floors[start.date()]:
            if interval_free(station, start, end + timedelta(minutes=CLEANUP_MINUTES)):
                return Slot(start.date(), station, None, start, end)
    pytest.fail("no free span past its cutoff today or tomorrow")


def late_confirmed(api: Api, minutes: int = MIN_BOOKING) -> dict:
    for _ in range(4):
        slot = late_slot(api, minutes)
        response = claim(api, slot.body())
        if response.status_code == 201:
            return api.ok("POST", f"/api/bookings/{response.json()['id']}/confirm")
        expect_error(response, 409, "slot_taken")
    pytest.fail("late span kept being taken")


def wait_server_past(base: str, moment: datetime, what: str) -> None:
    deadline = time.monotonic() + EXPIRY_WAIT
    while time.monotonic() < deadline:
        if P(kitchen(base)["now"]) >= moment:
            return
    pytest.fail(f"server clock never passed {what}")


def fire(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], Any]) -> Any:
        barrier.wait(timeout=60)
        return call()

    with cf.ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def inbox(mail: Mailpit, email: str, subject: str | None = None, settle: float = 0.2) -> list[dict]:
    found = []
    for message in mail.messages(0, settle=settle):
        if email.lower() in [a.lower() for a in addresses(message.get("To"))]:
            if subject is None or re.fullmatch(subject, message.get("Subject") or ""):
                found.append(message)
    return found


def await_mail(mail: Mailpit, email: str, subject: str | None = None, count: int = 1, seconds: float = MAIL_WAIT) -> list[dict]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if len(inbox(mail, email, subject)) >= count:
            break
    else:
        pytest.fail(f"Mailpit never received {count} message(s) to {email} matching {subject!r}")
    final = inbox(mail, email, subject, settle=MAIL_SETTLE)
    assert len(final) == count, f"expected exactly {count} message(s) matching {subject!r}, found {len(final)}"
    return final


def kb_state(killbill: KillBill, tenant: Api) -> tuple[list[dict], list[dict], dict | None]:
    account = killbill.account_by_key(f"stationhouse-{tenant.tenant_id}")
    if not account:
        return [], [], None
    invoices = [i for i in killbill.invoices(account["accountId"]) if str(i.get("status", "")).upper() != "VOID" and float(i.get("amount") or 0) > 0]
    transactions = [t for p in killbill.payments(account["accountId"]) for t in p.get("transactions", [])]
    return invoices, transactions, account


def kb_tx(transactions: list[dict], kind: str) -> list[dict]:
    return [t for t in transactions if t.get("transactionType") == kind and t.get("status") == "SUCCESS"]


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.enabled = True
        self.closed = False
        self.live: list[socket.socket] = []
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(64)
        self.port = self.server.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self.closed:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            if not self.enabled:
                client.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=10)
            except OSError:
                client.close()
                continue
            self.live += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(source: socket.socket, sink: socket.socket) -> None:
        try:
            while chunk := source.recv(65536):
                sink.sendall(chunk)
        except OSError:
            pass
        with contextlib.suppress(OSError):
            sink.shutdown(socket.SHUT_RDWR)

    def switch(self, on: bool) -> None:
        self.enabled = on
        if not on:
            for sock in self.live:
                with contextlib.suppress(OSError):
                    sock.shutdown(socket.SHUT_RDWR)
                    sock.close()
            self.live = []

    def close(self) -> None:
        self.closed = True
        self.switch(False)
        with contextlib.suppress(OSError):
            self.server.shutdown(socket.SHUT_RDWR)
        self.server.close()


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    manifest = json.loads(Path("/app/run.json").read_text())
    port = free_port()
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=str(DEPLOYED_APP), env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text()[-3000:]

    try:
        deadline = time.monotonic() + COPY_BOOT
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"extra app process exited with {proc.returncode}:\n{tail()}")
            with contextlib.suppress(httpx.HTTPError):
                if httpx.get(f"{base}/api/health", timeout=2).status_code == 200:
                    break
        else:
            pytest.fail(f"extra app process never answered /api/health:\n{tail()}")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=30)
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)


WATCH_JS = r"""
(() => {
  if (window.__shWatch) return;
  window.__shWatch = true;
  window.__ann = []; window.__anims = []; window.__csp = []; window.__forbidSeen = false;
  const nameOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label) return label.trim();
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return ids.map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
  };
  let last = '';
  const tick = () => {
    const region = [...document.querySelectorAll('[role="status"],output,[aria-live]')].find((el) => nameOf(el) === 'Kitchen updates');
    const now = region ? region.textContent.replace(/\s+/g, ' ').trim() : '';
    if (now !== last) { window.__ann.push(now); last = now; }
    if (window.__forbid && document.body && document.body.textContent.includes(window.__forbid)) window.__forbidSeen = true;
  };
  const record = (anim) => {
    try {
      const effect = anim.effect; const timing = effect ? effect.getTiming() : {};
      window.__anims.push({ el: effect && effect.target, keyframes: JSON.stringify(effect ? effect.getKeyframes() : []),
        duration: Number(timing.duration) || 0, delay: Number(timing.delay) || 0, t: document.timeline.currentTime });
    } catch (e) { /* ignore */ }
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = animate.apply(this, args); record(a); return a; };
  const play = Animation.prototype.play;
  Animation.prototype.play = function (...args) { record(this); return play.apply(this, args); };
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective));
  const start = () => { new MutationObserver(tick).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true }); tick(); };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
})();
"""


@contextlib.contextmanager
def ui(browser: Browser, base: str, path: str = "/signin", **options: Any) -> Iterator[Page]:
    opened = open_app(browser, base.rstrip("/") + path, **options)
    if hasattr(opened, "__enter__"):
        with opened as page:
            page.add_init_script(WATCH_JS)
            page.evaluate(WATCH_JS)
            yield page
    else:
        page = next(opened)
        try:
            page.add_init_script(WATCH_JS)
            page.evaluate(WATCH_JS)
            yield page
        finally:
            opened.close()


def wait_for(page: Page, condition: Callable[[], bool], what: str, seconds: float = UI_WAIT) -> None:
    deadline = time.monotonic() + seconds
    last = time.monotonic()
    while time.monotonic() < deadline:
        try:
            if condition():
                return
        except PlaywrightError:
            pass
        now = time.monotonic()
        advance(page, max(1.0, (now - last) * 1000))
        last = now
    pytest.fail(f"expected {what} within {seconds:.0f}s")


def hold_for(page: Page, seconds: float, invariant: Callable[[], bool], what: str) -> None:
    end = time.monotonic() + seconds
    last = time.monotonic()
    while time.monotonic() < end:
        assert invariant(), f"{what} stopped holding"
        now = time.monotonic()
        advance(page, max(1.0, (now - last) * 1000))
        last = now
    assert invariant(), f"{what} stopped holding"


def shown(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def attr(loc: Locator, name: str) -> str | None:
    return loc.first.get_attribute(name, timeout=2000) if loc.count() else None


def txt(loc: Locator) -> str:
    return loc.first.inner_text(timeout=2000) if loc.count() else ""


def focused(loc: Locator) -> bool:
    return loc.count() > 0 and bool(loc.first.evaluate("el => el === document.activeElement"))


def active_name(page: Page) -> str:
    return page.evaluate("() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.textContent || '').trim() : '' }")


def shown_copy(page: Page, copy: str | re.Pattern) -> bool:
    loc = page.get_by_text(copy)
    for i in range(min(loc.count(), 25)):
        element = loc.nth(i)
        if element.is_visible() and element.evaluate("el => !el.closest('[role=status],output,[aria-live]')"):
            return True
    return False


def announced(page: Page, copy: str | re.Pattern) -> int:
    pattern = copy if isinstance(copy, re.Pattern) else re.compile(re.escape(copy))
    total = previous = 0
    for value in page.evaluate("() => window.__ann || []"):
        count = len(pattern.findall(value))
        if count > previous:
            total += count - previous
        previous = count
    return total


def recorded_animations(loc: Locator) -> list[dict]:
    return loc.first.evaluate("el => (window.__anims || []).filter(a => a.el === el).map(a => ({keyframes: a.keyframes, duration: a.duration, delay: a.delay, t: a.t}))")


def described_by(loc: Locator) -> str:
    return loc.first.evaluate("el => (el.getAttribute('aria-describedby')||'').split(/\\s+/).map(i => (document.getElementById(i)||{}).textContent||'').join(' ').trim() || el.getAttribute('aria-description') || ''")


def query(page: Page) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(page.url).query).items()}


def path_of(page: Page) -> str:
    return urlparse(page.url).path


def heading(page: Page, name: str | re.Pattern) -> Locator:
    return page.get_by_role("heading", name=name, level=1, exact=isinstance(name, str))


def wait_heading(page: Page, name: str | re.Pattern, seconds: float = UI_WAIT) -> Locator:
    loc = heading(page, name)
    wait_for(page, lambda: shown(loc), f'level-one heading "{name}"', seconds)
    return loc


def ui_sign_in(page: Page, email: str, password: str) -> None:
    form = page.get_by_role("form", name="Sign in")
    wait_for(page, lambda: shown(form), 'form "Sign in"')
    fill(form.get_by_role("textbox", name="Email"), email)
    fill(form.get_by_label("Password", exact=True), password)
    click(form.get_by_role("button", name="Sign in"))


def ui_session(page: Page, api: Api) -> None:
    ui_sign_in(page, api.email, api.password)
    wait_for(page, lambda: path_of(page) not in ("/signin", "/"), "sign-in to leave /signin")


def page_token(page: Page) -> str:
    for cookie in page.context.cookies():
        if cookie["name"] == "sh_session":
            return cookie["value"]
    pytest.fail("the page holds no sh_session cookie")


def nav(page: Page) -> Locator:
    return page.get_by_role("navigation", name="Main")


def floor_plan(page: Page) -> Locator:
    return page.get_by_role("region", name="Floor plan")


def station(page: Page, sid: str) -> Locator:
    return floor_plan(page).locator(f'[data-station-id="{sid}"]')


def slab(page: Page) -> Locator:
    return page.get_by_role("button", name=re.compile(r"^Slab "))


def tickets(page: Page) -> Locator:
    return page.get_by_role("region", name="Your tickets")


def ticket(page: Page, booking: dict) -> Locator:
    start, end = P(booking["start"]), P(booking["end"])
    name = re.compile(rf"^{re.escape(booking['stationName'])} {dre(start.date())} {hm(start)}{DASH}{hm(end)}$")
    return tickets(page).get_by_role("article", name=name)


def door_card(page: Page, business: str, booking: dict) -> Locator:
    start, end = P(booking["start"]), P(booking["end"])
    name = f"{business} {booking['stationName']} {hm(start)}{DASH}{hm(end)}"
    return page.get_by_role("region", name="Door list").get_by_role("article", name=name, exact=True)


def open_board(page: Page, api: Api, day: date, frm: str, to: str) -> dict:
    page.goto(f"{api.base}/board?date={day.isoformat()}&from={frm}&to={to}")
    return wait_stack(page, api, day, frm, to)


def wait_stack(page: Page, api: Api, day: date, frm: str, to: str, seconds: float = UI_WAIT) -> dict:
    floor = api.ok("GET", f"/api/floor?date={day.isoformat()}&from={frm}&to={to}")
    zone = ZoneInfo(kitchen(api.base)["timeZone"])
    span = int((at(zone, day, to) - at(zone, day, frm)).total_seconds() // 60)
    want = {s["id"]: str(extrusion(s, span)) for s in floor["stations"]}
    wait_for(page, lambda: all(attr(station(page, sid), "data-extrusion") == value for sid, value in want.items()),
             f"station data-extrusion for {day} {frm}-{to} to match GET /api/floor", seconds)
    return floor


def drag(page: Page, source: Locator, target: Locator) -> None:
    sx, sy = center(source)
    tx, ty = center(target)
    page.mouse.move(sx, sy)
    page.mouse.down()
    for step in range(1, 13):
        page.mouse.move(sx + (tx - sx) * step / 12, sy + (ty - sy) * step / 12)
    page.mouse.up()


def tenant_bookings(api: Api) -> list[dict]:
    return api.ok("GET", "/api/bookings")["bookings"]


class Gate:

    def __init__(self, page: Page, glob: str, method: str = "POST", match: Callable[[str], bool] | None = None) -> None:
        self.routes: list[Any] = []
        self.active = True

        def handler(route: Any) -> None:
            request = route.request
            if self.active and request.method == method and (match is None or match(request.url)):
                self.routes.append(route)
            else:
                route.continue_()

        page.route(glob, handler)

    def release(self) -> None:
        self.active = False
        for route in self.routes:
            route.continue_()
        self.routes = []


def test_health_and_app_page(app_url: str) -> None:
    response = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert response.status_code == 200 and response.json() == {"status": "ok"}
    app_page = httpx.get(f"{app_url}/signin", timeout=HTTP_TIMEOUT)
    assert app_page.status_code == 200 and app_page.content
    for path in ("/apply", "/board", "/packs", "/documents", "/tenants", "/report", f"/receipt/{uuid.uuid4()}"):
        page = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert page.status_code == 200 and page.content == app_page.content, path


def test_server_boundary(app_url: str) -> None:
    probe_email = f"limit-{uuid.uuid4().hex[:8]}@stationhouse.test"
    big = json.dumps({"email": probe_email, "password": "p" * JSON_LIMIT}).encode()
    expect_error(httpx.post(f"{app_url}/api/session", content=big, headers=JSON_CT), 413, "payload_too_large")
    skeleton = len(json.dumps({"email": probe_email, "password": ""}).encode())
    exact = json.dumps({"email": probe_email, "password": "p" * (JSON_LIMIT - skeleton)}).encode()
    assert len(exact) == JSON_LIMIT
    assert httpx.post(f"{app_url}/api/session", content=exact, headers=JSON_CT).status_code != 413
    expect_error(httpx.post(f"{app_url}/api/session", content=b"email=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    tenant = new_tenant(app_url, docs=False)
    huge = upload(tenant, "food_handler_card", kitchen_today(app_url) + timedelta(days=30), b"%PDF-" + bytes(UPLOAD_LIMIT))
    expect_error(huge, 413, "payload_too_large")
    for path in ("/.env", "/run.json", "/package.json", "/package-lock.json", "/node_modules/", "/node_modules/.package-lock.json"):
        assert httpx.get(app_url + path).status_code == 404, path
    html = httpx.get(f"{app_url}/board").text
    assets = sorted(set(re.findall(r'(?:src|href)="(/[^"]+)"', html)))
    secrets = [os.environ.get(n, "") for n in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    db_password = urlparse(os.environ.get("DATABASE_URL", "")).password or ""
    secrets = [s for s in secrets + [db_password] if len(s) >= 6 and s.lower() != "password"]
    for asset in [""] + assets:
        body = httpx.get(app_url + (asset or "/board")).text
        for secret in secrets:
            assert secret not in body, f"a service credential is served in {asset or '/board'}"
    for name in ("APP_KILLBILL_DOWN_URL", "APP_MINIO_DOWN_URL", "APP_MAILPIT_DOWN_URL"):
        assert httpx.get(f"{env_url(name)}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_error_shape_and_precedence(app_url: str) -> None:
    anon = Api(app_url)
    tenant = new_tenant(app_url, docs=False)
    big = json.dumps({"stationId": "x" * (JSON_LIMIT + 1)}).encode()
    expect_error(anon.call("POST", "/api/bookings", content=big, headers={**JSON_CT, "Origin": EVIL_ORIGIN}), 413, "payload_too_large")
    expect_error(anon.call("POST", "/api/bookings", content=b"{}", headers={"Content-Type": "text/plain", "Origin": EVIL_ORIGIN}), 415, "unsupported_media_type")
    expect_error(anon.call("POST", "/api/bookings", {}, headers={"Origin": EVIL_ORIGIN}), 403, "cross_origin")
    expect_error(anon.call("POST", "/api/bookings", content=b"{not json", headers=JSON_CT), 401, "unauthenticated")
    expect_error(tenant.call("POST", "/api/bookings", content=b"{not json", headers=JSON_CT, key=idempotency_key()), 400, "malformed_body", "The request body could not be read.")
    expect_error(tenant.call("POST", "/api/bookings", {"stationId": "range-1"}), 400, "idempotency_key_required")
    shift = lead(app_url)
    expect_error(shift.call("GET", f"/api/packs/{uuid.uuid4()}"), 404, "not_found")
    expect_error(shift.call("POST", "/api/packs", {"hours": 7}, key=idempotency_key()), 403, "forbidden")
    body = expect_error(claim(tenant, {"stationId": "nowhere", "start": "soon", "end": "later"}), 422, "validation_failed")
    assert {"stationId", "start", "end"} <= set(body["fields"])
    slot = find_slot(tenant)
    expect_error(claim(tenant, slot.body()), 409, "tenant_not_approved")


def test_responsive_layout(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    first, slot = confirmed(tenant, starts=[DEFAULT_SPAN[0]])
    second = None
    for _ in range(6):
        stations = tenant.ok("GET", f"/api/floor?date={slot.day}")["stations"]
        free = [s for s in stations if s["kind"] != "cooler_shelf" and interval_free(s, slot.start, slot.end + timedelta(minutes=CLEANUP_MINUTES))]
        if free:
            response = claim(tenant, slot.body(station=free[0]["id"]))
            if response.status_code == 201:
                second = tenant.ok("POST", f"/api/bookings/{response.json()['id']}/confirm")
                break
    assert second, "could not book a second station on the same span"
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        for label, (width, height) in VIEWPORTS.items():
            page.set_viewport_size({"width": width, "height": height})
            open_board(page, tenant, slot.day, hm(slot.start), hm(slot.end))
            wait_for(page, lambda: shown(ticket(page, first)) and shown(ticket(page, second)), "both ticket cards")
            layout(page)
            cards = [ticket(page, first).bounding_box(), ticket(page, second).bounding_box()]
            plan = floor_plan(page).bounding_box()
            rail = page.get_by_role("group", name="Hour rail").bounding_box()
            menu = page.get_by_role("button", name="Menu")
            if label == "wide":
                assert menu.count() == 0 and shown(nav(page))
                column = tickets(page).bounding_box()
                assert column["x"] + column["width"] <= plan["x"] + 1, "ticket column overlaps the floor plan"
                assert rail["y"] + rail["height"] <= height + 1, "hour rail is below the fold"
            elif label == "medium":
                assert menu.count() == 0 and shown(nav(page))
                assert abs(cards[0]["y"] - cards[1]["y"]) <= 1 and abs(cards[0]["x"] - cards[1]["x"]) > 1, "cards are not two per row"
                assert max(c["y"] + c["height"] for c in cards) <= plan["y"] + 1, "cards do not sit above the plan"
            else:
                assert shown(menu)
                assert abs(cards[0]["x"] - cards[1]["x"]) <= 1, "cards do not stack one per row"
                assert min(c["y"] for c in cards) >= rail["y"] + rail["height"] - 1, "cards do not sit under the rail"
        page.set_viewport_size({"width": VIEWPORTS["narrow"][0], "height": VIEWPORTS["narrow"][1]})
        for path, name in (("/packs", "Hour packs"), ("/documents", "Your documents")):
            page.goto(app_url + path)
            wait_heading(page, name)
            layout(page)


def test_accessible_controls_tab_order(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url)
    day = kitchen_today(app_url) + timedelta(days=5)
    with ui(browser, app_url) as page:
        session(page).send("Page.setBypassCSP", {"enabled": True})
        page.reload()
        form = page.get_by_role("form", name="Sign in")
        wait_for(page, lambda: shown(form), 'form "Sign in"')
        for role, name in (("textbox", "Email"), ("button", "Sign in")):
            assert shown(form.get_by_role(role, name=name))
        assert shown(form.get_by_label("Password", exact=True))
        assert shown(page.get_by_role("link", name="Apply for a station"))
        assert page.get_by_role("status", name="Kitchen updates").count() == 1
        axe(page)
        page.goto(f"{app_url}/apply")
        apply_form = page.get_by_role("form", name="Apply")
        wait_for(page, lambda: shown(apply_form), 'form "Apply"')
        for name in ("Business name", "Contact name", "Email"):
            assert shown(apply_form.get_by_role("textbox", name=name))
        assert shown(apply_form.get_by_role("button", name="Send application"))
        axe(page)
        page.goto(f"{app_url}/signin")
        ui_session(page, tenant)
        floor = open_board(page, tenant, day, *DEFAULT_SPAN)
        names = {s["id"]: s["name"] for s in floor["stations"]}
        order = tab_order(page, 40)
        assert "Board" in order, f"Tab never reached the Board link: {order}"
        start = order.index("Board")
        expected = ["Board", "Hour packs", "Documents", "Sign out", "Previous day", "Next day", "Today", "Span start", "Span end", f"Slab {DEFAULT_SPAN[0]}{DASH}{DEFAULT_SPAN[1]}"]
        assert order[start:start + len(expected)] == expected, order
        stations_seen = order[start + len(expected):start + len(expected) + len(SEED_STATIONS)]
        assert [n.split(",")[0] for n in stations_seen] == [names[s] for s in SEED_STATIONS], stations_seen
        for loc in [station(page, s) for s in SEED_STATIONS] + [page.get_by_role("button", name=n) for n in ("Previous day", "Next day", "Today", "Sign out")]:
            box = loc.bounding_box()
            assert box["width"] >= TAP_TARGET - 0.5 and box["height"] >= TAP_TARGET - 0.5, f"target under 44 px: {box}"
        axe(page)


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    frm = clock(minute_of(DEFAULT_SPAN[1]) - MIN_BOOKING)
    to = DEFAULT_SPAN[1]
    slot = find_slot(tenant, starts=[frm])
    with ui(browser, app_url, reduced_motion="reduce") as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        slab(page).focus()
        page.keyboard.press("Space")
        target = page.locator('[data-drop-target="true"]')
        wait_for(page, lambda: target.count() == 1, "a keyboard drop target")
        sid = attr(target, "data-station-id")
        page.keyboard.press("Enter")
        held = re.compile(rf"Held .+ {frm}{DASH}{to}\. Confirm within \d+ seconds\.")
        wait_for(page, lambda: announced(page, held) == 1, "the Claim success copy in Kitchen updates")
        assert attr(station(page, sid), "data-extrusion") == str(EXTRUSION_PX)
        moving = [a for a in recorded_animations(station(page, sid)) if a["duration"] > 0]
        assert moving == [], f"station block animated under reduced motion: {moving}"
    boss = owner(app_url)
    with ui(browser, app_url, reduced_motion="reduce") as page:
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_for(page, lambda: path_of(page) == "/board", "owner landing on /board")
        report = boss.ok("GET", f"/api/reports/daily?date={slot.day}")
        page.goto(f"{app_url}/report?date={slot.day}")
        bars = page.get_by_role("figure", name="Usage by station").locator("[data-station-id]")
        wait_for(page, lambda: bars.count() == len(report["stations"]), "one usage bar per station")
        top = max(s["bookedMinutes"] for s in report["stations"])
        for i, row in enumerate(report["stations"]):
            want = half_up(BAR_UNITS * row["bookedMinutes"], top) if top else 0
            assert attr(bars.nth(i), "data-height") == str(want)
            assert [a for a in recorded_animations(bars.nth(i)) if a["duration"] > 0] == [], "bar grew under reduced motion"


def test_signin_and_sessions(browser: Browser, app_url: str) -> None:
    other = env_url("APP_KILLBILL_DOWN_URL")
    for email, password, role in ((OWNER_EMAIL, OWNER_PASSWORD, "owner"), (LEAD_EMAIL, LEAD_PASSWORD, "shift_lead"), (DANA_EMAIL, TENANT_PASSWORD, "tenant")):
        response = Api(app_url).call("POST", "/api/session", {"email": email, "password": password})
        assert response.status_code == 200 and response.json()["user"]["role"] == role
        cookie = next(v for v in response.headers.get_list("set-cookie") if v.strip().startswith("sh_session="))
        assert "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
        assert Api(other, session_token(response)).me()["email"] == email
    applied = new_tenant(app_url, docs=False)
    again = sign_in(app_url, applied.email, applied.password)
    assert again.user["tenant"]["status"] == "applied"
    assert again.call("DELETE", "/api/session").status_code == 204
    expect_error(Api(other, again.token).call("GET", "/api/me"), 401, "unauthenticated")
    for email, password, links in ((OWNER_EMAIL, OWNER_PASSWORD, ["Board", "Tenants", "Report"]), (LEAD_EMAIL, LEAD_PASSWORD, ["Board"]), (applied.email, applied.password, ["Board", "Hour packs", "Documents"])):
        with ui(browser, app_url) as page:
            ui_sign_in(page, email, password)
            wait_for(page, lambda: shown(nav(page)), 'navigation "Main"')
            assert [t.strip() for t in nav(page).get_by_role("link").all_inner_texts()] == links


def test_collapsed_menu(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url) as page:
        page.set_viewport_size({"width": VIEWPORTS["narrow"][0], "height": VIEWPORTS["narrow"][1]})
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        menu = page.get_by_role("button", name="Menu")
        wait_for(page, lambda: shown(menu), 'button "Menu"')
        assert attr(menu, "aria-expanded") == "false" and attr(menu, "aria-controls")
        assert nav(page).count() == 0 and page.get_by_role("button", name="Sign out").count() == 0
        order = tab_order(page, 15)
        assert "Sign out" not in order and "Board" not in order, order
        click(menu)
        wait_for(page, lambda: attr(menu, "aria-expanded") == "true" and active_name(page) == "Board", "menu open with focus on its first link")
        page.keyboard.press("Escape")
        wait_for(page, lambda: attr(menu, "aria-expanded") == "false" and focused(menu), "menu closed with focus on Menu")
        assert nav(page).count() == 0
        page.set_viewport_size({"width": 600, "height": 900})
        wait_for(page, lambda: menu.count() == 0 and shown(nav(page)) and shown(page.get_by_role("button", name="Sign out")), "navigation shown at 600 px")
        page.set_viewport_size({"width": 599, "height": 900})
        wait_for(page, lambda: shown(menu) and nav(page).count() == 0, "Menu back at 599 px")


def test_security_headers(browser: Browser, app_url: str) -> None:
    html = httpx.get(f"{app_url}/board").text
    asset = (re.findall(r'src="(/[^"]+)"', html) or ["/board"])[0]
    staff = lead(app_url)
    for path in ("/signin", "/board", asset, "/api/health", "/api/me", f"/api/nope-{uuid.uuid4().hex[:6]}"):
        response = httpx.get(app_url + path, headers={"Origin": EVIL_ORIGIN})
        assert response.headers.get("Content-Security-Policy") == CSP, path
        assert response.headers.get("X-Content-Type-Options") == "nosniff", path
        assert response.headers.get("Referrer-Policy") == "same-origin", path
        assert response.headers.get("Cross-Origin-Opener-Policy") == "same-origin", path
        assert not any(h.lower().startswith("access-control-") for h in response.headers), path
    today = kitchen_today(app_url)
    expect_error(staff.call("GET", f"/api/door?date={today}", headers={"Origin": EVIL_ORIGIN}), 403, "cross_origin")
    expect_error(owner(app_url).call("GET", f"/api/reports/daily?date={today}", headers={"Origin": "null"}), 403, "cross_origin")
    assert staff.call("GET", f"/api/door?date={today}", headers={"Origin": app_url}).status_code == 200
    tenant = new_tenant(app_url)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, today + timedelta(days=4), *DEFAULT_SPAN)
        for path, name in (("/packs", "Hour packs"), ("/documents", "Your documents")):
            page.goto(app_url + path)
            wait_heading(page, name)
        assert page.evaluate("() => window.__csp") == [], "the browser reported Content-Security-Policy violations"


NAME_CASES = {"carriage_return": "\r", "line_feed": "\n", "tab": "\t", "nul": "\x00", "delete": "\x7f", "c1_control": "\x85"}


@pytest.mark.parametrize("case", list(NAME_CASES), ids=list(NAME_CASES))
def test_apply_control_characters(app_url: str, case: str) -> None:
    first, second = unique("apply")
    email = first if "@" in first else second
    anon = Api(app_url)
    bad = {"businessName": f"Bad{NAME_CASES[case]}Name", "contactName": f"Ann{NAME_CASES[case]}Lee", "email": email, "password": NEW_PASSWORD}
    body = expect_error(anon.call("POST", "/api/tenants/apply", bad), 422, "validation_failed")
    for field in ("businessName", "contactName"):
        assert body["fields"][field] == "Use letters, numbers and punctuation only."
    assert session_token(anon.call("POST", "/api/tenants/apply", {**bad, "contactName": "x"})) is None
    good = anon.call("POST", "/api/tenants/apply", {"businessName": "Clean Name Co", "contactName": "Ann Lee", "email": email, "password": NEW_PASSWORD})
    assert good.status_code == 201, "the refused application wrote an account"
    user = good.json()["user"]
    assert user["role"] == "tenant" and user["tenant"]["status"] == "applied" and session_token(good)


def suspended_tenant(app_url: str) -> tuple[str, Api, dict]:
    for base in (env_url("APP_SHORT_URL"), env_url("APP_OFFSET_ZONE_URL"), env_url("APP_MAILPIT_DOWN_ISOLATED_URL"), app_url):
        for row in owner(base).ok("GET", "/api/tenants")["tenants"]:
            if row["status"] == "suspended":
                response = Api(base).call("POST", "/api/session", {"email": row["email"], "password": TENANT_PASSWORD})
                if response.status_code == 200:
                    return base, sign_in(base, row["email"], TENANT_PASSWORD), row
    pytest.fail("no seeded suspended tenant on any instance")


def test_onboarding_states(app_url: str) -> None:
    tenant = new_tenant(app_url, docs=False)
    boss = owner(app_url)
    today = kitchen_today(app_url)
    expect_error(boss.call("POST", f"/api/tenants/{tenant.tenant_id}/approve"), 409, "invalid_transition")
    assert upload(tenant, "insurance_certificate", today + timedelta(days=90)).status_code == 201
    assert tenant.me()["tenant"]["status"] == "applied"
    assert upload(tenant, "food_handler_card", today + timedelta(days=90)).status_code == 201
    assert tenant.me()["tenant"]["status"] == "documents_pending"
    assert boss.ok("POST", f"/api/tenants/{tenant.tenant_id}/approve")["status"] == "approved"
    expect_error(boss.call("POST", f"/api/tenants/{tenant.tenant_id}/approve"), 409, "invalid_transition")
    base, cook, row = suspended_tenant(app_url)
    expect_error(owner(base).call("POST", f"/api/tenants/{row['id']}/approve"), 409, "invalid_transition")
    expect_error(claim(cook, find_slot(cook).body()), 409, "tenant_not_approved")
    today = kitchen_today(base)
    renewed = []
    for kind, field in (("insurance_certificate", "insuranceExpiresOn"), ("food_handler_card", "foodHandlerExpiresOn")):
        if row[field] is None or date.fromisoformat(row[field]) < today:
            assert upload(cook, kind, today + timedelta(days=200)).status_code == 201
            renewed.append(kind)
    assert cook.me()["tenant"]["status"] == "approved"
    docs = cook.ok("GET", "/api/documents")["documents"]
    for kind in renewed:
        mine = [d for d in docs if d["kind"] == kind]
        assert [d["coverState"] for d in mine if d["current"]] == ["ok"]
        assert all(d["coverState"] == "superseded" for d in mine if not d["current"]) and len(mine) >= 2


def test_wf_onboarding_approval(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, approve=False)
    with ui(browser, app_url) as tpage:
        ui_session(tpage, tenant)
        tpage.goto(f"{app_url}/documents")
        wait_for(tpage, lambda: shown(tpage.get_by_text(status_line(WAITING_LABEL), exact=True)), "Waiting for review status")
        with ui(browser, app_url) as opage:
            ui_sign_in(opage, OWNER_EMAIL, OWNER_PASSWORD)
            wait_heading(opage, "Board")
            click(nav(opage).get_by_role("link", name="Tenants"))
            table = opage.get_by_role("table", name="Tenants")
            link = table.get_by_role("link", name=tenant.business, exact=True)
            wait_for(opage, lambda: shown(link), "the tenant's row")
            click(link)
            name = wait_heading(opage, tenant.business)
            docs = opage.get_by_role("region", name="Documents")
            wait_for(opage, lambda: docs.get_by_role("link", name="Open").count() == 2, "two Open links")
            click(opage.get_by_role("button", name=f"Approve {tenant.business}"))
            wait_for(opage, lambda: focused(name) and opage.get_by_role("button", name=f"Approve {tenant.business}").count() == 0, "focus on the business heading")
            assert path_of(opage) == f"/tenants/{tenant.tenant_id}"
            assert announced(opage, f"{tenant.business} approved.") == 1
            opage.go_back()
            row = table.get_by_role("row").filter(has=opage.get_by_role("link", name=tenant.business, exact=True))
            wait_for(opage, lambda: APPROVED_LABEL in txt(row), "Approved in the Tenants table")
        wait_for(tpage, lambda: shown(tpage.get_by_text(status_line(APPROVED_LABEL), exact=True)), "Approved on Documents", FLOOR_VISIBLE + REFRESH_SLACK)
        assert announced(tpage, f"Status changed: {APPROVED_LABEL}.") == 1
    assert tenant.me()["tenant"]["status"] == "approved"


def test_wf_onboarding_apply_recovery(browser: Browser, app_url: str) -> None:
    first, second = unique("apply")
    email = first if "@" in first else second
    with ui(browser, app_url, "/apply") as page:
        form = page.get_by_role("form", name="Apply")
        wait_for(page, lambda: shown(form), 'form "Apply"')
        fill(form.get_by_role("textbox", name="Business name"), RECOVERY_BUSINESS)
        fill(form.get_by_role("textbox", name="Contact name"), RECOVERY_CONTACT)
        fill(form.get_by_role("textbox", name="Email"), BAD_EMAIL)
        fill(form.get_by_label("Password", exact=True), SHORT_PASSWORD)
        url, length = page.url, page.evaluate("() => history.length")
        click(form.get_by_role("button", name="Send application"))
        group = page.get_by_role("group", name="Check these fields")
        wait_for(page, lambda: shown(group), 'group "Check these fields"')
        links = group.get_by_role("link")
        assert links.all_inner_texts() == [f"Email: {EMAIL_ERROR}", f"Password: {SHORT_ERROR}"]
        assert announced(page, "2 fields need attention.") == 1
        click(links.nth(0))
        wait_for(page, lambda: focused(form.get_by_role("textbox", name="Email")), "focus on Email")
        assert page.url == url and page.evaluate("() => history.length") == length
        assert form.get_by_label("Password", exact=True).input_value() == SHORT_PASSWORD
        assert form.get_by_role("textbox", name="Business name").input_value() == RECOVERY_BUSINESS
        fill(form.get_by_role("textbox", name="Email"), email)
        fill(form.get_by_label("Password", exact=True), NEW_PASSWORD)
        click(form.get_by_role("button", name="Send application"))
        wait_heading(page, "Your documents")
    with ui(browser, app_url, "/packs") as page:
        wait_for(page, lambda: query(page).get("next") == "/packs", "Sign in with next=/packs")
        ui_sign_in(page, email, WRONG_PASSWORD)
        wait_for(page, lambda: announced(page, "That email and password don't match an account.") == 1, "wrong credentials copy")
        assert query(page).get("next") == "/packs"
        ui_sign_in(page, email, NEW_PASSWORD)
        wait_heading(page, "Hour packs")
        assert path_of(page) == "/packs"


def test_wf_onboarding_landing(browser: Browser, app_url: str) -> None:
    first, second = unique("land")
    email = first if "@" in first else second
    with ui(browser, app_url) as page:
        click(page.get_by_role("link", name="Apply for a station"))
        form = page.get_by_role("form", name="Apply")
        wait_for(page, lambda: shown(form), 'form "Apply"')
        fill(form.get_by_role("textbox", name="Business name"), "Landing Co")
        fill(form.get_by_role("textbox", name="Contact name"), "Lan Ding")
        fill(form.get_by_role("textbox", name="Email"), email)
        fill(form.get_by_label("Password", exact=True), NEW_PASSWORD)
        click(form.get_by_role("button", name="Send application"))
        docs = wait_heading(page, "Your documents")
        wait_for(page, lambda: focused(docs) and path_of(page) == "/documents", "focus on Your documents")
        page.go_back()
        wait_for(page, lambda: path_of(page) != "/documents", "Back to leave Documents")
        assert path_of(page) != "/apply" and page.get_by_role("form", name="Apply").count() == 0
        page.goto(f"{app_url}/packs")
        wait_heading(page, "Hour packs")
        click(page.get_by_role("button", name="Sign out"))
        box = page.get_by_role("textbox", name="Email")
        wait_for(page, lambda: path_of(page) == "/signin" and focused(box), "Sign in with focus on Email")
        assert "next" not in query(page)
        page.go_back()
        wait_heading(page, "Sign in to Stationhouse")
        assert page.get_by_role("region", name="Hour packs").count() == 0
        ui_sign_in(page, email, NEW_PASSWORD)
        wait_for(page, lambda: path_of(page) == "/board", "sign-in landing on /board after Back")
        page.goto(f"{app_url}/packs")
        wait_heading(page, "Hour packs")
        Api(app_url, page_token(page)).call("DELETE", "/api/session")
        wait_for(page, lambda: path_of(page) == "/signin" and query(page).get("next") == "/packs", "401 landing on /signin?next=/packs", FLOOR_VISIBLE + REFRESH_SLACK)
        wait_for(page, lambda: focused(page.get_by_role("textbox", name="Email")), "focus on Email after 401")
        assert announced(page, "Your session ended. Sign in again.") >= 1


def test_signin_limit(app_url: str) -> None:
    known = new_tenant(app_url, docs=False)
    first, second = unique("ghost")
    ghost = first if "@" in first else second
    other = env_url("APP_KILLBILL_DOWN_URL")
    bodies = {}
    for email in (known.email, ghost):
        for i in range(SIGNIN_FAILURES):
            shown_email = f"  {email.upper()} " if i % 2 else email
            response = Api(app_url).call("POST", "/api/session", {"email": shown_email, "password": WRONG_PASSWORD})
            bodies.setdefault(email, expect_error(response, 401, "invalid_credentials"))
        for base in (app_url, other):
            response = Api(base).call("POST", "/api/session", {"email": email, "password": known.password})
            body = expect_error(response, 429, "too_many_attempts", "Too many sign-in attempts for that email. Try again in a few minutes.")
            assert 1 <= int(response.headers["Retry-After"]) <= SIGNIN_WINDOW_DEFAULT
            bodies[email + "429"] = body
    assert bodies[known.email] == bodies[ghost] and bodies[known.email + "429"] == bodies[ghost + "429"]
    assert Api(app_url).call("POST", "/api/session", {"email": DANA_EMAIL, "password": TENANT_PASSWORD}).status_code == 200
    short = env_url("APP_SHORT_URL")
    cook = new_tenant(short, docs=False)
    for _ in range(SIGNIN_FAILURES - 1):
        expect_error(Api(short).call("POST", "/api/session", {"email": cook.email, "password": WRONG_PASSWORD}), 401, "invalid_credentials")
    sign_in(short, cook.email, cook.password)
    for _ in range(SIGNIN_FAILURES - 1):
        expect_error(Api(short).call("POST", "/api/session", {"email": cook.email, "password": WRONG_PASSWORD}), 401, "invalid_credentials")
    expect_error(Api(short).call("POST", "/api/session", {"email": cook.email, "password": WRONG_PASSWORD}), 401, "invalid_credentials")
    locked = Api(short).call("POST", "/api/session", {"email": cook.email, "password": cook.password})
    expect_error(locked, 429, "too_many_attempts")
    until_free = P(kitchen(short)["now"]) + timedelta(seconds=int(locked.headers["Retry-After"]))
    wait_server_past(short, until_free, "the sign-in Retry-After")
    sign_in(short, cook.email, cook.password)


UPLOAD_CASES = {"svg_named_png": ("file", None), "html_named_pdf": ("file", None), "short_png": ("file", None), "over_size_limit": ("file", None),
                "past_expiry": ("expiresOn", None), "limit_below_minimum": ("perOccurrenceLimit", None), "not_additional_insured": ("additionalInsured", None),
                "exact_size_limit": (None, "pdf"), "jpeg_signature": (None, "jpg"), "limit_at_minimum": (None, "pdf")}


@pytest.mark.parametrize("case", list(UPLOAD_CASES), ids=list(UPLOAD_CASES))
def test_upload_checks(app_url: str, case: str) -> None:
    tenant = new_tenant(app_url, docs=False)
    today = kitchen_today(app_url)
    data, name, ctype, expires, limit, insured = pdf_bytes(), "certificate.pdf", "application/pdf", today + timedelta(days=90), MIN_LIMIT_DOLLARS, "true"
    if case == "svg_named_png":
        data, name, ctype = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "card.png", "image/png"
    elif case == "html_named_pdf":
        data = b"<html><script>alert(1)</script></html>"
    elif case == "short_png":
        data, name, ctype = PNG_SIG[:7], "card.png", "image/png"
    elif case == "over_size_limit":
        data = b"%PDF-" + bytes(FILE_LIMIT - 4)
    elif case == "exact_size_limit":
        data = b"%PDF-" + bytes(FILE_LIMIT - 5)
    elif case == "jpeg_signature":
        data, name, ctype = JPEG_SIG + os.urandom(400), "card.txt", "text/plain"
    elif case == "past_expiry":
        expires = today - timedelta(days=1)
    elif case == "limit_below_minimum":
        limit = MIN_LIMIT_DOLLARS - 1
    elif case == "not_additional_insured":
        insured = "false"
    prefix = f"tenants/{tenant.tenant_id}/"
    before = S3().keys(prefix)
    response = upload(tenant, "insurance_certificate", expires, data, limit=limit, insured=insured, name=name, ctype=ctype)
    field, ext = UPLOAD_CASES[case]
    if field:
        body = expect_error(response, 422, "validation_failed")
        assert field in body["fields"]
        assert tenant.ok("GET", "/api/documents")["documents"] == []
        assert S3().keys(prefix) == before
    else:
        assert response.status_code == 201, response.text[:300]
        doc = response.json()
        assert doc["sizeBytes"] == len(data) and doc["sha256"] == hashlib.sha256(data).hexdigest()
        assert S3().keys(prefix) == [f"{prefix}documents/{doc['id']}.{ext}"]


def test_private_document_files(app_url: str) -> None:
    tenant, other = new_tenant(app_url, docs=False), new_tenant(app_url, docs=False)
    today = kitchen_today(app_url)
    png = PNG_SIG + os.urandom(300)
    doc = upload(tenant, "food_handler_card", today + timedelta(days=60), png, name="card.png", ctype="image/png").json()
    jpg = JPEG_SIG + os.urandom(300)
    doc2 = upload(tenant, "food_handler_card", today + timedelta(days=61), jpg, name="card.jpeg", ctype="image/jpeg").json()
    keys = sorted(S3().keys(f"tenants/{tenant.tenant_id}/documents/"))
    assert keys == sorted([f"tenants/{tenant.tenant_id}/documents/{doc['id']}.png", f"tenants/{tenant.tenant_id}/documents/{doc2['id']}.jpg"])
    for reader in (tenant, owner(app_url)):
        response = reader.call("GET", f"/api/documents/{doc['id']}/file")
        assert response.status_code == 200 and response.content == png
        assert response.headers["Content-Type"] == doc["contentType"] and int(response.headers["Content-Length"]) == len(png)
        assert response.headers["Content-Disposition"] == f'inline; filename="food_handler_card-{doc["id"]}.png"'
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Content-Security-Policy"] == "sandbox"
        assert response.headers["Cache-Control"] == "private, no-store"
    expect_error(other.call("GET", f"/api/documents/{doc['id']}/file"), 404, "not_found")
    expect_error(lead(app_url).call("GET", f"/api/documents/{doc['id']}/file"), 403, "forbidden")
    expect_error(Api(app_url).call("GET", f"/api/documents/{doc['id']}/file"), 401, "unauthenticated")


def test_documents_byte_identical(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, docs=False)
    today = kitchen_today(app_url)
    data = b"%PDF-1.4\n" + bytes(range(256)) * 8 + b"\x00\r\n--boundary\r\nContent-Disposition: form-data\r\n" + os.urandom(2000) + b"\r\n"
    old = upload(tenant, "insurance_certificate", today + timedelta(days=30), data).json()
    sha = hashlib.sha256(data).hexdigest()
    assert old["sha256"] == sha and old["sizeBytes"] == len(data) and old["hasFile"] is True
    old_key = f"tenants/{tenant.tenant_id}/documents/{old['id']}.pdf"
    assert S3().get(old_key) == data
    new = upload(tenant, "insurance_certificate", today + timedelta(days=300), pdf_bytes()).json()
    assert new["id"] != old["id"]
    again = tenant.ok("GET", f"/api/documents/{old['id']}")
    assert again["coverState"] == "superseded" and again["sha256"] == sha
    assert S3().get(old_key) == data
    for reader in (tenant, owner(app_url)):
        assert reader.call("GET", f"/api/documents/{old['id']}/file").content == data
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        page.goto(f"{app_url}/documents")
        table = page.get_by_role("table", name="Documents on file")
        wait_for(page, lambda: sha[:12] in txt(table) and "Superseded" in txt(table), "fingerprint and Superseded in the table")


def fill_upload(page: Page, kind_label: str, expires: date, name: str, mime: str, data: bytes, *, limit: int | None = None, insured: bool = False) -> Locator:
    form = page.get_by_role("form", name="Upload document")
    wait_for(page, lambda: shown(form), 'form "Upload document"')
    check(form.get_by_role("radio", name=kind_label))
    fill(form.get_by_label("Expires on"), expires.isoformat())
    if limit is not None:
        fill(form.get_by_label("Per-occurrence limit (dollars)"), str(limit))
    if insured:
        check(form.get_by_role("checkbox", name="Names Halfsheet Commissary as additional insured"))
    form.get_by_label("File", exact=True).set_input_files(files=[{"name": name, "mimeType": mime, "buffer": data}])
    return form


def chosen_file(form: Locator) -> str:
    return form.get_by_label("File", exact=True).evaluate("el => el.files && el.files[0] ? el.files[0].name : ''")


def test_wf_documents_upload(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, docs=False)
    today = kitchen_today(app_url)
    ins, card = pdf_bytes(), PNG_SIG + os.urandom(600)
    ins_day, card_day = today + timedelta(days=150), today + timedelta(days=160)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        page.goto(f"{app_url}/documents")
        wait_heading(page, "Your documents")
        form = fill_upload(page, "Certificate of insurance", ins_day, "coi.pdf", "application/pdf", ins, limit=MIN_LIMIT_DOLLARS, insured=True)
        click(form.get_by_role("button", name="Upload"))
        wait_for(page, lambda: shown_copy(page, re.compile(rf"Uploaded\. Certificate of insurance on file through {dre(ins_day)}\.")), "insurance upload success copy")
        form = fill_upload(page, "Food-handler card", card_day, "card.png", "image/png", card)
        click(form.get_by_role("button", name="Upload"))
        wait_for(page, lambda: shown_copy(page, re.compile(rf"Uploaded\. Food-handler card on file through {dre(card_day)}\.")), "card upload success copy")
        table = page.get_by_role("table", name="Documents on file")
        wait_for(page, lambda: table.get_by_role("link", name="Open").count() == 2, "two Open links")
        content = txt(table)
        for blob, day in ((ins, ins_day), (card, card_day)):
            assert hashlib.sha256(blob).hexdigest()[:12] in content
            assert re.search(rf"({day.isoformat()}|{dre(day)})", content), f"expiry {day} not shown"
        assert content.count("Valid") >= 2
        wait_for(page, lambda: shown(page.get_by_text(status_line(WAITING_LABEL), exact=True)), "status Waiting for review")
    docs = tenant.ok("GET", "/api/documents")["documents"]
    assert sorted(d["sha256"] for d in docs) == sorted(hashlib.sha256(b).hexdigest() for b in (ins, card))
    for doc in docs:
        ext = "png" if doc["kind"] == "food_handler_card" else "pdf"
        assert S3().get(f"tenants/{tenant.tenant_id}/documents/{doc['id']}.{ext}") == (card if ext == "png" else ins)


@pytest.mark.timeout(1200)
def test_wf_documents_storage_outage(browser: Browser, app_url: str) -> None:
    down = env_url("APP_MINIO_DOWN_URL")
    tenant = new_tenant(app_url, docs=False)
    today = kitchen_today(app_url)
    copy = "Document storage is unreachable. Nothing was saved; try again shortly."
    with ui(browser, down) as page:
        ui_session(page, tenant)
        page.goto(f"{down}/documents")
        form = fill_upload(page, "Food-handler card", today + timedelta(days=40), "card.pdf", "application/pdf", pdf_bytes())
        click(form.get_by_role("button", name="Upload"))
        wait_for(page, lambda: shown_copy(page, copy) and announced(page, copy) == 1, "storage-down copy")
    assert tenant.ok("GET", "/api/documents")["documents"] == [] and S3().keys(f"tenants/{tenant.tenant_id}/") == []
    stored = upload(tenant, "food_handler_card", today + timedelta(days=41), pdf_bytes()).json()
    expect_error(tenant.clone(down).call("GET", f"/api/documents/{stored['id']}/file"), 503, "storage_unavailable", "Previews are unavailable while document storage is unreachable.")
    target = urlparse(os.environ["S3_ENDPOINT"])
    relay = Relay(target.hostname, target.port or (443 if target.scheme == "https" else 80))
    try:
        with app_copy({"S3_ENDPOINT": f"{target.scheme}://127.0.0.1:{relay.port}"}) as copy_base:
            cook = tenant.clone(copy_base)
            relay.switch(False)
            expect_error(upload(cook, "insurance_certificate", today + timedelta(days=50)), 503, "storage_unavailable", copy)
            expect_error(cook.call("GET", f"/api/documents/{stored['id']}/file"), 503, "storage_unavailable")
            relay.switch(True)
            data = pdf_bytes()
            response = upload(cook, "insurance_certificate", today + timedelta(days=50), data)
            assert response.status_code == 201, "uploads did not recover once storage returned"
            assert cook.call("GET", f"/api/documents/{response.json()['id']}/file").content == data
    finally:
        relay.close()


def test_documents_form_survives_refresh(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, docs=False)
    today = kitchen_today(app_url)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        page.goto(f"{app_url}/documents")
        wait_heading(page, "Your documents")
        form = fill_upload(page, "Certificate of insurance", today + timedelta(days=30), DRAFT_FILE, "application/pdf", pdf_bytes(), limit=MIN_LIMIT_DOLLARS - 1, insured=True)
        click(form.get_by_role("button", name="Upload"))
        error = "Coverage is below the kitchen's minimum per occurrence."
        wait_for(page, lambda: shown_copy(page, error), "limit field error")
        limit = form.get_by_label("Per-occurrence limit (dollars)")
        limit.focus()
        assert upload(tenant, "insurance_certificate", today + timedelta(days=200)).status_code == 201
        assert upload(tenant, "food_handler_card", today + timedelta(days=200)).status_code == 201
        wait_for(page, lambda: shown(page.get_by_text(status_line(WAITING_LABEL), exact=True)), "status refresh", FLOOR_VISIBLE + REFRESH_SLACK)
        hold_for(page, REFRESH_SECONDS + 2, lambda: True, "second refresh")
        assert announced(page, f"Status changed: {WAITING_LABEL}.") == 1
        assert form.get_by_role("radio", name="Certificate of insurance").is_checked()
        assert form.get_by_label("Expires on").input_value() == (today + timedelta(days=30)).isoformat()
        assert limit.input_value() == str(MIN_LIMIT_DOLLARS - 1) and focused(limit)
        assert form.get_by_role("checkbox", name="Names Halfsheet Commissary as additional insured").is_checked()
        assert chosen_file(form) == DRAFT_FILE and shown_copy(page, error)


def test_interrupted_upload_resumes(browser: Browser, app_url: str) -> None:
    tenant, other = new_tenant(app_url, docs=False), new_tenant(app_url, docs=False)
    today = kitchen_today(app_url)
    data = pdf_bytes()
    with ui(browser, app_url) as page:
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/api/documents") else None)
        ui_session(page, tenant)
        page.goto(f"{app_url}/documents")
        form = fill_upload(page, "Certificate of insurance", today + timedelta(days=33), RESUME_FILE, "application/pdf", data, limit=MIN_LIMIT_DOLLARS, insured=True)
        Api(app_url, page_token(page)).call("DELETE", "/api/session")
        wait_for(page, lambda: path_of(page) == "/signin", "401 landing on Sign in", FLOOR_VISIBLE + REFRESH_SLACK)
        ui_sign_in(page, tenant.email, tenant.password)
        restored = "Your upload wasn't sent. Check it and press Upload."
        wait_for(page, lambda: path_of(page) == "/documents" and shown_copy(page, restored), "restored draft on /documents")
        assert announced(page, restored) == 1 and posts == []
        assert form.get_by_role("radio", name="Certificate of insurance").is_checked()
        assert form.get_by_label("Expires on").input_value() == (today + timedelta(days=33)).isoformat()
        assert form.get_by_label("Per-occurrence limit (dollars)").input_value() == str(MIN_LIMIT_DOLLARS)
        assert chosen_file(form) == RESUME_FILE
        click(form.get_by_role("button", name="Upload"))
        wait_for(page, lambda: len(tenant.ok("GET", "/api/documents")["documents"]) == 1, "one stored document")
        assert len(posts) == 1 and tenant.ok("GET", "/api/documents")["documents"][0]["sha256"] == hashlib.sha256(data).hexdigest()
        form = fill_upload(page, "Food-handler card", today + timedelta(days=34), OTHER_FILE, "application/pdf", pdf_bytes())
        Api(app_url, page_token(page)).call("DELETE", "/api/session")
        wait_for(page, lambda: path_of(page) == "/signin", "second 401 landing", FLOOR_VISIBLE + REFRESH_SLACK)
        ui_sign_in(page, other.email, other.password)
        wait_heading(page, "Your documents")
        assert chosen_file(form) == "" and form.get_by_label("Expires on").input_value() == ""
        assert OTHER_FILE not in page.content() and not shown_copy(page, restored)


def test_errors_reveal_nothing(app_url: str) -> None:
    tenant = new_tenant(app_url, docs=False, packs=0)
    today = kitchen_today(app_url)
    doc = upload(tenant, "food_handler_card", today + timedelta(days=20)).json()
    storage = tenant.clone(env_url("APP_MINIO_DOWN_URL"))
    billing = tenant.clone(env_url("APP_KILLBILL_DOWN_URL"))
    collected = [
        expect_error(upload(storage, "food_handler_card", today + timedelta(days=21)), 503, "storage_unavailable", "Document storage is unreachable. Nothing was saved; try again shortly."),
        expect_error(storage.call("GET", f"/api/documents/{doc['id']}/file"), 503, "storage_unavailable", "Previews are unavailable while document storage is unreachable."),
        expect_error(billing.call("POST", "/api/packs", {"hours": SMALL_PACK}, key=idempotency_key()), 503, "billing_unavailable", "Billing is unreachable. Nothing was charged."),
        expect_error(tenant.call("POST", "/api/session/confirm", content=b"{\"password\":", headers=JSON_CT), 400, "malformed_body", "The request body could not be read."),
        expect_error(tenant.call("POST", "/api/documents", content=b"--wrong\r\nnot a part", headers={"Content-Type": "multipart/form-data; boundary=right"}), 400, "malformed_body", "The request body could not be read."),
    ]
    responses = [tenant.call("GET", f"/api/documents/{uuid.uuid4()}"), tenant.call("GET", "/api/floor?date=2026-02-30")]
    collected += [r.json() for r in responses]
    hosts = [urlparse(os.environ.get(n, "")).hostname or "" for n in ("S3_ENDPOINT", "KILLBILL_URL", "DATABASE_URL")] + [os.environ.get("SMTP_HOST", "")]
    secrets = [os.environ.get(n, "") for n in ("S3_BUCKET", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET")]
    forbidden = ["ECONNREFUSED", "ENOTFOUND", "NoSuchKey", "S3", "AWS", "killbill", "postgres", "SQL", "tenants/", "127.0.0.1:9", ".ts:", "node_modules"]
    forbidden += [h for h in hosts if len(h) > 3] + [s for s in secrets if len(s) >= 4]
    blob = json.dumps(collected).lower() + json.dumps([dict(r.headers) for r in responses]).lower()
    for token in forbidden:
        assert token.lower() not in blob, f"an error leaked {token!r}"


def test_api_no_store(app_url: str) -> None:
    tenant = new_tenant(app_url, docs=False)
    for response in (httpx.get(f"{app_url}/api/health"), httpx.get(f"{app_url}/api/kitchen"), httpx.get(f"{app_url}/api/me"),
                     tenant.call("GET", "/api/me"), tenant.call("GET", f"/api/bookings/{uuid.uuid4()}"),
                     tenant.call("POST", "/api/bookings", {"x": 1}, key=idempotency_key())):
        assert "no-store" in response.headers.get("Cache-Control", ""), response.request.url


def test_purchase_billed_in_killbill(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    tenant = new_tenant(app_url)
    pack = buy(tenant, SMALL_PACK)
    invoices, transactions, account = kb_state(killbill, tenant)
    assert account["name"] == tenant.business and account["email"] == tenant.email and account["currency"] == "USD"
    assert len(invoices) == 1 and pack["invoiceId"] == invoices[0]["invoiceId"]
    assert float(invoices[0]["amount"]) == PRICE_CENTS[SMALL_PACK] / 100 and float(invoices[0]["balance"]) == 0
    assert [i["description"] for i in invoices[0]["items"]] == [f"Stationhouse {SMALL_PACK}-hour pack"]
    assert [float(t["amount"]) for t in kb_tx(transactions, "PURCHASE")] == [PRICE_CENTS[SMALL_PACK] / 100]
    await_mail(mail, tenant.email, rf"Receipt: {SMALL_PACK}-hour pack")
    down = tenant.clone(env_url("APP_KILLBILL_DOWN_URL"))
    expect_error(down.call("POST", "/api/packs", {"hours": SMALL_PACK}, key=idempotency_key()), 503, "billing_unavailable")
    assert [p["id"] for p in tenant.ok("GET", "/api/packs")["packs"]] == [pack["id"]]
    assert len(kb_state(killbill, tenant)[0]) == 1
    assert len(inbox(mail, tenant.email, r"Receipt: .*", settle=MAIL_SETTLE)) == 1


def test_purchase_retry_charges_once(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    tenant = new_tenant(app_url)
    key = idempotency_key()
    answers = [tenant.call("POST", "/api/packs", {"hours": SMALL_PACK}, key=key) for _ in range(3)]
    assert [a.status_code for a in answers] == [201, 201, 201]
    assert len({a.json()["id"] for a in answers}) == 1
    packs = tenant.ok("GET", "/api/packs")["packs"]
    assert len(packs) == 1
    assert len(movements(pack_detail(tenant, packs[0]["id"]), "purchase")) == 1
    invoices, transactions, _ = kb_state(killbill, tenant)
    assert len(invoices) == 1 and len(kb_tx(transactions, "PURCHASE")) == 1
    await_mail(mail, tenant.email, rf"Receipt: {SMALL_PACK}-hour pack", count=1)


def test_ledger_pairs(app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    booking, slot = confirmed(tenant)
    target = find_slot(tenant, minutes=slot.minutes + 60, avoid={slot.day})
    moved = tenant.call("POST", f"/api/bookings/{booking['id']}/move", target.body(), key=idempotency_key())
    assert moved.status_code == 200, moved.text[:300]
    tenant.ok("POST", f"/api/bookings/{booking['id']}/cancel")
    detail = pack_detail(tenant, booking["packId"])
    assert_ledger(detail)
    kinds = sorted({e["movement"] for e in detail["entries"]})
    assert kinds == ["booking_debit", "cancellation_credit", "move_adjustment", "purchase"]
    assert detail["balanceMinutes"] == SMALL_PACK * 60


def test_pack_receipt_email(app_url: str, mail: Mailpit) -> None:
    tenant = new_tenant(app_url)
    pack = buy(tenant, SMALL_PACK)
    message = await_mail(mail, tenant.email, rf"Receipt: {SMALL_PACK}-hour pack")[0]
    body = text(message)
    purchased = P(pack["purchasedAt"])
    zone = kitchen(app_url)["timeZone"]
    for line in (f"Hours added: {SMALL_PACK} h", f"Amount: {money(PRICE_CENTS[SMALL_PACK])}", f"Invoice: {pack['invoiceId']}"):
        assert line in body, line
    assert re.search(rf"Purchased: {dre(purchased.date())} {hm(purchased)} {re.escape(zone)}", body)
    assert [a.lower() for a in addresses(message.get("To"))] == [tenant.email.lower()]


def test_wf_hour_packs_buy(browser: Browser, app_url: str, killbill: KillBill) -> None:
    hours = 20
    tenant, second = new_tenant(app_url), new_tenant(app_url)
    with ui(browser, app_url) as page:
        keys: list[str] = []
        page.on("request", lambda r: keys.append(r.headers.get("idempotency-key", "")) if r.method == "POST" and r.url.endswith("/api/packs") else None)
        ui_session(page, tenant)
        page.goto(f"{app_url}/packs")
        wait_heading(page, "Hour packs")
        click(page.get_by_role("button", name=f"Buy {hours}-hour pack"))
        dialog = page.get_by_role("dialog", name="Confirm your password")
        wait_for(page, lambda: shown(dialog) and focused(dialog.get_by_label("Password", exact=True)), "password dialog with focus on Password")
        fill(dialog.get_by_label("Password", exact=True), tenant.password)
        click(dialog.get_by_role("button", name="Confirm"))
        head = page.get_by_role("heading", name=pack_heading(hours))
        wait_for(page, lambda: shown(head), "the new pack panel")
        assert shown(page.get_by_text(f"{dur(hours * 60)} left of {dur(hours * 60)}"))
        pack = tenant.ok("GET", "/api/packs")["packs"][0]
        ledger = page.get_by_role("table", name=re.compile(rf"^Ledger {re.escape(pack_heading(hours))} {dre(P(pack['purchasedAt']).date())}$"))
        assert "Purchase" in txt(ledger)
        assert announced(page, f"Pack added: {hours} hours. Receipt on its way to {tenant.email}.") == 1
        assert len(keys) == 2 and keys[0] == keys[1]
        click(page.get_by_role("button", name="Sign out"))
        ui_sign_in(page, second.email, second.password)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/packs")
        wait_heading(page, "Hour packs")
        assert page.get_by_role("heading", name=pack_heading(hours)).count() == 0
    invoices, _, _ = kb_state(killbill, tenant)
    assert len(invoices) == 1 and float(invoices[0]["amount"]) == PRICE_CENTS[hours] / 100


def test_wf_hour_packs_retry(browser: Browser, app_url: str, killbill: KillBill) -> None:
    tenant = new_tenant(app_url)
    with ui(browser, app_url) as page:
        sent: list[tuple[str, str]] = []
        page.on("request", lambda r: sent.append((r.headers.get("idempotency-key", ""), r.post_data or "")) if r.method == "POST" and r.url.endswith("/api/packs") else None)
        ui_session(page, tenant)
        page.goto(f"{app_url}/packs")
        wait_heading(page, "Hour packs")
        gate = Gate(page, "**/api/packs")
        ten = page.get_by_role("button", name=f"Buy {SMALL_PACK}-hour pack")
        click(ten)
        ten.dblclick(force=True)
        page.get_by_role("button", name="Buy 40-hour pack").click(force=True)
        wait_for(page, lambda: len(gate.routes) == 1 and attr(ten, "aria-disabled") == "true", "one pending purchase")
        assert len(sent) == 1 and focused(ten)
        route = gate.routes.pop()
        gate.active = False
        route.fetch()
        route.abort()
        failure = "Couldn't reach the kitchen. Press the same button again to finish this purchase; you won't be charged twice."
        wait_for(page, lambda: shown_copy(page, failure) and shown(page.get_by_text("Retry purchase")), "network-failure copy and tag")
        assert attr(page.get_by_role("button", name="Buy 20-hour pack"), "aria-disabled") == "true"
        click(ten)
        wait_for(page, lambda: shown(page.get_by_role("heading", name=pack_heading(SMALL_PACK))), "the pack after the resend")
        assert len(sent) == 2 and sent[0] == sent[1]
    assert len(tenant.ok("GET", "/api/packs")["packs"]) == 1
    assert len(kb_state(killbill, tenant)[0]) == 1


def test_purchase_attempt_survives(browser: Browser, app_url: str, killbill: KillBill) -> None:
    tenant = new_tenant(app_url)
    with ui(browser, app_url) as page:
        keys: list[str] = []
        page.on("request", lambda r: keys.append(r.headers.get("idempotency-key", "")) if r.method == "POST" and r.url.endswith("/api/packs") else None)
        ui_session(page, tenant)
        page.goto(f"{app_url}/packs")
        wait_heading(page, "Hour packs")
        page.route("**/api/packs", lambda route: route.abort() if route.request.method == "POST" else route.continue_())
        click(page.get_by_role("button", name=f"Buy {SMALL_PACK}-hour pack"))
        wait_for(page, lambda: shown(page.get_by_text("Retry purchase")), "Retry purchase tag")
        hold_for(page, 2 * REFRESH_SECONDS + 2, lambda: shown(page.get_by_text("Retry purchase")), "tag through packs refreshes")
        page.reload()
        resume = f"Your last purchase didn't finish. Press Buy {SMALL_PACK}-hour pack again to finish it; you won't be charged twice."
        wait_for(page, lambda: shown_copy(page, resume) and shown(page.get_by_text("Retry purchase")), "resume copy after reload")
        assert announced(page, resume) == 1
        for other in ("Buy 20-hour pack", "Buy 40-hour pack"):
            assert attr(page.get_by_role("button", name=other), "aria-disabled") == "true"
        hold_for(page, REFRESH_SECONDS + 2, lambda: shown_copy(page, resume), "resume copy through a refresh")
        page.unroute("**/api/packs")
        click(page.get_by_role("button", name=f"Buy {SMALL_PACK}-hour pack"))
        wait_for(page, lambda: shown(page.get_by_role("heading", name=pack_heading(SMALL_PACK))), "pack after resuming")
        assert len(set(keys)) == 1 and len(keys) >= 2
    assert len(kb_state(killbill, tenant)[0]) == 1


def test_purchase_announced_once(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        page.goto(f"{app_url}/packs")
        wait_heading(page, "Hour packs")
        click(page.get_by_role("button", name="Buy 40-hour pack"))
        dialog = page.get_by_role("dialog", name="Confirm your password")
        wait_for(page, lambda: shown(dialog), "password dialog")
        fill(dialog.get_by_label("Password", exact=True), tenant.password)
        click(dialog.get_by_role("button", name="Confirm"))
        success = f"Pack added: 40 hours. Receipt on its way to {tenant.email}."
        wait_for(page, lambda: announced(page, success) == 1, "one success announcement")
        hold_for(page, 2 * REFRESH_SECONDS + 2, lambda: announced(page, success) == 1 and shown_copy(page, success), "single announcement through refreshes")
        assert announced(page, "Recording payment…") == 0


def test_pack_receipt_delivery_shown(browser: Browser, app_url: str, mail: Mailpit) -> None:
    isolated = env_url("APP_MAILPIT_DOWN_ISOLATED_URL")
    cook = new_tenant(isolated)
    with ui(browser, isolated) as page:
        ui_session(page, cook)
        page.goto(f"{isolated}/packs")
        click(page.get_by_role("button", name=f"Buy {SMALL_PACK}-hour pack"))
        wait_for(page, lambda: shown(page.get_by_text("Receipt email: Queued")), "Queued receipt line")
        hold_for(page, FLOOR_VISIBLE, lambda: page.get_by_text("Receipt email: Sent").count() == 0, "Queued while mail is down")
    assert cook.ok("GET", "/api/packs")["packs"][0]["receiptEmail"] == {"status": "queued", "sentAt": None}
    down = env_url("APP_MAILPIT_DOWN_URL")
    tenant = new_tenant(app_url)
    with ui(browser, down) as page:
        ui_session(page, tenant)
        page.goto(f"{down}/packs")
        page.evaluate("() => { window.__stay = true }")
        click(page.get_by_role("button", name=f"Buy {SMALL_PACK}-hour pack"))
        success = f"Pack added: {SMALL_PACK} hours. Receipt on its way to {tenant.email}."
        wait_for(page, lambda: shown_copy(page, success), "buy success copy")
        receipt = tenant.ok("GET", "/api/packs")["packs"][0]
        wait_for(page, lambda: shown(page.get_by_text(re.compile(r"Receipt email: Sent \w{3} \d{1,2} \w{3} \d{4} \d{2}:\d{2}"))), "Sent receipt line", MAIL_WAIT)
        assert page.evaluate("() => window.__stay === true") and shown_copy(page, success)
    sent = tenant.ok("GET", f"/api/packs/{receipt['id']}")["receiptEmail"]
    assert sent["status"] == "sent" and sent["sentAt"]
    await_mail(mail, tenant.email, rf"Receipt: {SMALL_PACK}-hour pack")


def test_purchase_replays_stored(app_url: str, killbill: KillBill) -> None:
    tenant = new_tenant(app_url)
    key = idempotency_key()
    first = tenant.call("POST", "/api/packs", {"hours": SMALL_PACK}, key=key)
    assert first.status_code == 201
    replay = tenant.clone(env_url("APP_KILLBILL_DOWN_URL")).call("POST", "/api/packs", {"hours": SMALL_PACK}, key=key)
    assert replay.status_code == 201 and replay.content == first.content and replay.headers.get("Idempotent-Replay") == "true"
    boss = owner(app_url)
    boss.ok("POST", "/api/session/confirm", {"password": OWNER_PASSWORD})
    pack = first.json()
    boss.ok("POST", f"/api/packs/{pack['id']}/refund", {"expectedCents": PRICE_CENTS[SMALL_PACK]})
    after = tenant.call("POST", "/api/packs", {"hours": SMALL_PACK}, key=key)
    assert after.content == first.content and after.json()["status"] == "active"
    before = len(kb_tx(kb_state(killbill, tenant)[1], "PURCHASE"))
    race_key = idempotency_key()
    answers = fire([lambda: tenant.clone().call("POST", "/api/packs", {"hours": SMALL_PACK}, key=race_key) for _ in range(6)])
    assert all(a.status_code in (201, 409) for a in answers) and any(a.status_code == 201 for a in answers)
    assert all(a.json()["error"] == "idempotency_in_progress" for a in answers if a.status_code == 409)
    assert len({a.json()["id"] for a in answers if a.status_code == 201}) == 1
    invoices, transactions, _ = kb_state(killbill, tenant)
    assert len(kb_tx(transactions, "PURCHASE")) == before + 1
    expect_error(tenant.call("POST", "/api/packs", {"hours": 40}, key=race_key), 409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.")
    assert len(kb_state(killbill, tenant)[0]) == len(invoices)


def test_money_actions_reauth(app_url: str, killbill: KillBill) -> None:
    tenant = new_tenant(app_url)
    expect_error(tenant.call("POST", "/api/packs", {"hours": 20}, key=idempotency_key()), 403, "reauth_required", "Confirm your password to continue.")
    assert kb_state(killbill, tenant)[0] == []
    assert tenant.call("POST", "/api/packs", {"hours": SMALL_PACK}, key=idempotency_key()).status_code == 201
    expect_error(tenant.call("POST", "/api/session/confirm", {"password": WRONG_PASSWORD}), 401, "invalid_credentials", "That password doesn't match your account.")
    assert tenant.call("POST", "/api/session/confirm", {"password": tenant.password}).status_code == 204
    assert tenant.call("POST", "/api/packs", {"hours": 20}, key=idempotency_key()).status_code == 201
    pack = tenant.ok("GET", "/api/packs")["packs"][0]
    boss = owner(app_url)
    expect_error(boss.call("POST", f"/api/packs/{pack['id']}/refund", {"expectedCents": PRICE_CENTS[SMALL_PACK]}), 403, "reauth_required")
    assert pack_detail(boss, pack["id"])["status"] == "active"
    short = env_url("APP_SHORT_URL")
    cook = new_tenant(short)
    assert cook.call("POST", "/api/session/confirm", {"password": cook.password}).status_code == 204
    expect_error(cook.call("POST", "/api/packs", {"hours": 20, "probe": 1}, key=idempotency_key()), 422, "validation_failed")
    deadline = time.monotonic() + EXPIRY_WAIT
    while time.monotonic() < deadline:
        response = cook.call("POST", "/api/packs", {"hours": 20, "probe": 1}, key=idempotency_key())
        if response.status_code == 403:
            expect_error(response, 403, "reauth_required")
            break
    else:
        pytest.fail("password confirmation never expired on the short-timer instance")


def test_prorated_refund_amount(app_url: str, killbill: KillBill) -> None:
    tenant = new_tenant(app_url, packs=1)
    booking = late_confirmed(tenant, minutes=SMALL_PACK * 60 - REFUND_EXAMPLE_MINUTES)
    tenant.ok("POST", f"/api/bookings/{booking['id']}/cancel")
    boss = owner(app_url)
    before = pack_detail(boss, booking["packId"])
    assert before["balanceMinutes"] == REFUND_EXAMPLE_MINUTES and before["refundableCents"] == REFUND_EXAMPLE_CENTS
    boss.ok("POST", "/api/session/confirm", {"password": OWNER_PASSWORD})
    after = boss.ok("POST", f"/api/packs/{booking['packId']}/refund", {"expectedCents": REFUND_EXAMPLE_CENTS})
    assert after["status"] == "refunded" and after["refundedCents"] == REFUND_EXAMPLE_CENTS
    assert after["balanceMinutes"] == 0 and after["refundableCents"] == 0
    assert [e["minutes"] for e in movements(after, "refund")] == [-REFUND_EXAMPLE_MINUTES]
    refunds = kb_tx(kb_state(killbill, tenant)[1], "REFUND")
    assert [(float(t["amount"]), t.get("transactionExternalKey")) for t in refunds] == [(REFUND_EXAMPLE_CENTS / 100, f"stationhouse-refund-{booking['packId']}")]


def test_claim_holds_station(app_url: str) -> None:
    tenant, rival = new_tenant(app_url, packs=1), new_tenant(app_url, packs=1)
    slot = find_slot(tenant, shelf=True, extra_free=MIN_BOOKING + CLEANUP_MINUTES)
    booking = claim(tenant, slot.body(paired=True)).json()
    assert booking["status"] == "held" and booking["shelfId"] == slot.shelf["id"]
    assert P(booking["bufferEnd"]) == slot.end + timedelta(minutes=CLEANUP_MINUTES)
    stations = {s["id"]: s for s in rival.ok("GET", f"/api/floor?date={slot.day}")["stations"]}
    for sid in (slot.station["id"], slot.shelf["id"]):
        seen = [iv for iv in stations[sid]["intervals"] if P(iv["start"]) == slot.start]
        assert len(seen) == 1 and seen[0]["mine"] is False and P(seen[0]["bufferEnd"]) == slot.end + timedelta(minutes=CLEANUP_MINUTES)
    in_buffer = slot.end
    expect_error(claim(rival, slot.body(start=in_buffer, end=in_buffer + timedelta(minutes=MIN_BOOKING))), 409, "slot_taken")
    expect_error(claim(rival, slot.body(station=slot.shelf["id"])), 409, "slot_taken")
    after = slot.end + timedelta(minutes=CLEANUP_MINUTES)
    assert claim(rival, slot.body(start=after, end=after + timedelta(minutes=MIN_BOOKING))).status_code == 201


def test_one_winner_per_window(app_url: str) -> None:
    first, second = new_tenant(app_url, packs=1), new_tenant(app_url, packs=1)
    slot = find_slot(first, shelf=True, extra_free=60)
    shapes = [slot.body(), slot.body(paired=True), slot.body(start=slot.start + timedelta(minutes=HALF_HOUR), end=slot.end + timedelta(minutes=HALF_HOUR)),
              slot.body(start=slot.start + timedelta(minutes=2 * HALF_HOUR), end=slot.end + timedelta(minutes=2 * HALF_HOUR))]
    calls = [(lambda who=who, body=body: claim(who.clone(), body)) for who in (first, second) for body in shapes]
    answers = fire(calls)
    assert sorted(a.status_code for a in answers) == [201] + [409] * 7, [a.status_code for a in answers]
    assert all(a.json()["error"] == "slot_taken" for a in answers if a.status_code == 409)


def test_wf_claims_hold_expiry(browser: Browser, app_url: str) -> None:
    short = env_url("APP_SHORT_URL")
    tenant = new_tenant(short, packs=1)
    frm = DEFAULT_SPAN[1]
    to = clock(minute_of(frm) + MIN_BOOKING)
    slot = find_slot(tenant, starts=[frm])
    with ui(browser, short) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        slab(page).focus()
        page.keyboard.press("Space")
        wait_for(page, lambda: page.locator('[data-drop-target="true"]').count() == 1, "drop target")
        page.keyboard.press("Enter")
        wait_for(page, lambda: len(tenant_bookings(tenant)) == 1, "the held booking")
        booking = tenant_bookings(tenant)[0]
        card = ticket(page, booking)
        wait_for(page, lambda: "Held" in txt(card), "Held card")
        wait_server_past(short, P(booking["holdExpiresAt"]), "the hold expiry")
        wait_for(page, lambda: "Hold expired" in txt(card) and card.get_by_role("button", name="Confirm booking").count() == 0, "Hold expired card")
    after = tenant.ok("GET", f"/api/bookings/{booking['id']}")
    assert after["status"] == "cancelled" and after["cancelReason"] == "hold_expired"
    pack = tenant.ok("GET", f"/api/packs/{booking['packId']}")
    assert pack["heldMinutes"] == 0 and pack["availableMinutes"] == pack["balanceMinutes"]
    stations = {s["id"]: s for s in tenant.ok("GET", f"/api/floor?date={slot.day}")["stations"]}
    assert all(P(iv["start"]) != P(booking["start"]) for iv in stations[booking["stationId"]]["intervals"])


def test_confirm_debits_reserved_pack(app_url: str) -> None:
    small_minutes, big_minutes = 240, 480
    tenant = new_tenant(app_url, packs=2)
    packs = tenant.ok("GET", "/api/packs")["packs"]
    small, _ = hold(tenant, minutes=small_minutes)
    big, _ = hold(tenant, minutes=big_minutes)
    assert small["packId"] == packs[0]["id"] and big["packId"] == packs[1]["id"]
    done = tenant.ok("POST", f"/api/bookings/{big['id']}/confirm")
    assert done["status"] == "confirmed" and done["debitedMinutes"] == big_minutes
    detail = pack_detail(tenant, packs[1]["id"])
    assert_ledger(detail)
    assert [e["minutes"] for e in movements(detail, "booking_debit", big["id"])] == [-big_minutes]
    assert detail["balanceMinutes"] == SMALL_PACK * 60 - big_minutes
    assert pack_detail(tenant, packs[0]["id"])["heldMinutes"] == small_minutes
    assert upload(tenant, "insurance_certificate", kitchen_today(app_url)).status_code == 201
    expect_error(tenant.call("POST", f"/api/bookings/{small['id']}/confirm"), 409, "documents_not_valid")
    assert tenant.ok("GET", f"/api/bookings/{small['id']}")["status"] == "held"
    assert movements(pack_detail(tenant, packs[0]["id"]), "booking_debit") == []


def test_booking_emails_content(app_url: str, mail: Mailpit) -> None:
    tenant = new_tenant(app_url, packs=1)
    booking, slot = confirmed(tenant)
    zone = kitchen(app_url)["timeZone"]
    subject = rf"Booking confirmed: {re.escape(slot.station['name'])} on {dre(slot.day)}"
    body = text(await_mail(mail, tenant.email, subject)[0])
    for pattern in (rf"Station: {re.escape(slot.station['name'])}", r"Shelf: none", rf"Starts: {dre(slot.day)} {hm(slot.start)} {re.escape(zone)}",
                    rf"Ends: {dre(slot.day)} {hm(slot.end)} {re.escape(zone)}", rf"Hours debited: {dur(MIN_BOOKING)}",
                    rf"Pack balance: {dur(SMALL_PACK * 60 - MIN_BOOKING)}", rf"Booking reference: {booking['id']}"):
        assert re.search(pattern, body), pattern
    target = find_slot(tenant, avoid={slot.day})
    tenant.ok("POST", f"/api/bookings/{booking['id']}/move", target.body(), key=idempotency_key())
    moved = text(await_mail(mail, tenant.email, rf"Booking moved: {re.escape(target.station['name'])} on {dre(target.day)}")[0])
    assert re.search(rf"Was: {dre(slot.day)} {hm(slot.start)}{DASH}{hm(slot.end)} {re.escape(slot.station['name'])}", moved)
    assert re.search(rf"Starts: {dre(target.day)} {hm(target.start)}", moved)


def test_holds_reserve_pack_hours(app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    slots: list[Slot] = []
    for _ in range(6):
        slots.append(find_slot(tenant, avoid={s.day for s in slots}))
    answers = fire([(lambda s=s: claim(tenant.clone(), s.body())) for s in slots])
    assert sorted(a.status_code for a in answers) == [201] * 5 + [409]
    assert [a.json()["error"] for a in answers if a.status_code == 409] == ["insufficient_hours"]
    pack = tenant.ok("GET", "/api/packs")["packs"][0]
    assert pack["heldMinutes"] == SMALL_PACK * 60 and pack["availableMinutes"] == 0
    tenant.ok("POST", f"/api/bookings/{next(a.json()['id'] for a in answers if a.status_code == 201)}/cancel")
    pack = tenant.ok("GET", "/api/packs")["packs"][0]
    assert pack["heldMinutes"] == SMALL_PACK * 60 - MIN_BOOKING and pack["availableMinutes"] == MIN_BOOKING
    rival = new_tenant(app_url, packs=1)
    target = rival.ok("GET", "/api/packs")["packs"][0]
    boss = owner(app_url)
    boss.ok("POST", "/api/session/confirm", {"password": OWNER_PASSWORD})
    rival_slots: list[Slot] = []
    for _ in range(3):
        rival_slots.append(find_slot(rival, avoid={s.day for s in rival_slots}))
    calls = [lambda: boss.clone().call("POST", f"/api/packs/{target['id']}/refund", {"expectedCents": PRICE_CENTS[SMALL_PACK]})]
    calls += [(lambda s=s: claim(rival.clone(), s.body())) for s in rival_slots]
    refund, *claims = fire(calls)
    if refund.status_code == 200:
        assert all(c.status_code == 409 and c.json()["error"] == "insufficient_hours" for c in claims)
    else:
        expect_error(refund, 409, "pack_in_use")
        assert any(c.status_code == 201 and c.json()["packId"] == target["id"] for c in claims)
    detail = pack_detail(boss, target["id"])
    live = [b for b in tenant_bookings(rival) if b["packId"] == target["id"] and b["status"] in ("held", "confirmed", "checked_in")]
    assert not (detail["status"] == "refunded" and live)


def test_mail_queued_with_action(app_url: str, mail: Mailpit) -> None:
    tenant = new_tenant(app_url, packs=1)
    held, _ = hold(tenant)
    down = tenant.clone(env_url("APP_MAILPIT_DOWN_URL"))
    response = down.call("POST", f"/api/bookings/{held['id']}/confirm")
    assert response.status_code == 200 and response.json()["emails"][0]["status"] == "queued"
    expect_error(down.call("POST", f"/api/bookings/{held['id']}/move", {"stationId": "nowhere"}, key=idempotency_key()), 422, "validation_failed")
    messages = await_mail(mail, tenant.email, r"Booking confirmed: .*")
    assert re.fullmatch(r"<?queue-.+@stationhouse\.test>?", messages[0].get("MessageID") or ""), messages[0].get("MessageID")
    assert len(inbox(mail, tenant.email, settle=MAIL_SETTLE)) == 2


def test_wf_claims_station_with_shelf(browser: Browser, app_url: str) -> None:
    tenant, rival = new_tenant(app_url, packs=1), new_tenant(app_url, packs=1)
    frm, to = DEFAULT_SPAN
    span = minute_of(to) - minute_of(frm)
    slot = find_slot(tenant, shelf=True, starts=[frm], minutes=span)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        click(station(page, slot.station["id"]))
        dialog = page.get_by_role("dialog", name=slot.station["name"])
        wait_for(page, lambda: shown(dialog), "station dialog")
        select(dialog.get_by_role("combobox", name="Walk-in shelf"), f"{slot.shelf['name']}, {dur(span)} free of {dur(span)}")
        click(dialog.get_by_role("button", name=f"Claim {slot.station['name']} and {slot.shelf['name']} {frm}{DASH}{to}"))
        wait_for(page, lambda: len(tenant_bookings(tenant)) == 1, "the paired hold")
        booking = tenant_bookings(tenant)[0]
        card = ticket(page, booking)
        wait_for(page, lambda: f"+ {slot.shelf['name']}" in txt(card), "card with the shelf line")
        for sid in (slot.station["id"], slot.shelf["id"]):
            assert attr(station(page, sid), "data-extrusion") == str(EXTRUSION_PX)
        assert tenant.ok("GET", f"/api/packs/{booking['packId']}")["heldMinutes"] == 2 * span
        click(card.get_by_role("button", name="Confirm booking"))
        wait_for(page, lambda: "Confirmed" in txt(card), "Confirmed card")
    done = tenant.ok("GET", f"/api/bookings/{booking['id']}")
    assert done["shelfId"] == slot.shelf["id"] and done["debitedMinutes"] == 2 * span
    other = find_slot(rival, shelf=True)
    assert claim(tenant, other.body(station=other.shelf["id"])).status_code == 201
    expect_error(claim(rival, other.body(paired=True)), 409, "slot_taken")
    stations = {s["id"]: s for s in rival.ok("GET", f"/api/floor?date={other.day}")["stations"]}
    assert interval_free(stations[other.station["id"]], other.start, other.end)


def test_confirm_concurrent_once(app_url: str, mail: Mailpit) -> None:
    tenant = new_tenant(app_url, packs=1)
    held, _ = hold(tenant)
    answers = fire([(lambda: tenant.clone().call("POST", f"/api/bookings/{held['id']}/confirm")) for _ in range(6)])
    assert [a.status_code for a in answers] == [200] * 6 and {a.json()["status"] for a in answers} == {"confirmed"}
    assert len(movements(pack_detail(tenant, held["packId"]), "booking_debit", held["id"])) == 1
    await_mail(mail, tenant.email, r"Booking confirmed: .*", count=1)
    short = env_url("APP_SHORT_URL")
    cook = new_tenant(short, packs=1)
    lapsing, _ = hold(cook)
    keeper, _ = hold(cook)
    cook.ok("POST", f"/api/bookings/{keeper['id']}/confirm")
    wait_server_past(short, max(P(lapsing["holdExpiresAt"]), P(keeper["holdExpiresAt"])), "both hold expiries")
    expect_error(cook.call("POST", f"/api/bookings/{lapsing['id']}/confirm"), 409, "hold_expired")
    assert movements(pack_detail(cook, lapsing["packId"]), "booking_debit", lapsing["id"]) == []
    again = cook.ok("POST", f"/api/bookings/{keeper['id']}/confirm")
    assert again["status"] == "confirmed" and len(movements(pack_detail(cook, keeper["packId"]), "booking_debit", keeper["id"])) == 1


def test_email_addressing(app_url: str, mail: Mailpit) -> None:
    contact = f'Zoë "Quill", Ltd {uuid.uuid4().hex[:4]}'
    tenant = new_tenant(app_url, contact=contact)
    buy(tenant, SMALL_PACK)
    message = await_mail(mail, tenant.email, rf"Receipt: {SMALL_PACK}-hour pack")[0]
    to = message["To"]
    assert len(to) == 1 and to[0]["Name"] == contact and to[0]["Address"].lower() == tenant.email.lower()
    assert not message.get("Cc") and not message.get("Bcc")
    assert all(a.lower() == mail_from_address().lower() for a in addresses(message.get("ReplyTo")))


def test_hold_edge(app_url: str) -> None:
    short = env_url("APP_SHORT_URL")
    first, rival = new_tenant(short, packs=1), new_tenant(short, packs=1)
    held, slot = hold(first)
    expect_error(claim(rival, slot.body()), 409, "slot_taken")
    fillers = []
    for _ in range(4):
        fillers.append(claim(first, find_slot(first, avoid={slot.day}).body()).json())
    expect_error(claim(first, find_slot(first, avoid={slot.day}).body()), 409, "insufficient_hours")
    wait_server_past(short, max(P(b["holdExpiresAt"]) for b in [held] + fillers), "the hold expiry")
    won = claim(rival, slot.body())
    assert won.status_code == 201 and won.json()["status"] == "held"
    assert claim(first, find_slot(first, avoid={slot.day}).body()).status_code == 201
    assert first.ok("GET", f"/api/bookings/{held['id']}")["cancelReason"] == "hold_expired"


def test_held_countdown_server_clock(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    info = kitchen(app_url)
    frm = clock(minute_of(DEFAULT_SPAN[1]) + 2 * HALF_HOUR)
    to = clock(minute_of(frm) + MIN_BOOKING)
    slot = find_slot(tenant, starts=[frm])
    with ui(browser, app_url) as page:
        page.clock.pause_at(P(info["now"]) + timedelta(hours=7))
        ui_session(page, tenant)
        page.goto(f"{app_url}/board")
        wait_for(page, lambda: query(page).get("date") == kitchen(app_url)["today"], "default date = kitchen today")
        now = P(kitchen(app_url)["now"])
        kitchen_clock = re.compile(rf"Kitchen time ({hm(now)}|{hm(now + timedelta(minutes=1))}) · {re.escape(info['timeZone'])}")
        wait_for(page, lambda: shown(page.get_by_text(kitchen_clock)), "kitchen clock text")
        open_board(page, tenant, slot.day, frm, to)
        slab(page).focus()
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        wait_for(page, lambda: len(tenant_bookings(tenant)) == 1, "held booking")
        card = ticket(page, tenant_bookings(tenant)[0])
        wait_for(page, lambda: re.search(r"Held · (\d+) s left", txt(card)) is not None, "held countdown")
        seconds = int(re.search(r"Held · (\d+) s left", txt(card)).group(1))
        assert info["holdSeconds"] - REFRESH_SLACK <= seconds <= info["holdSeconds"]


def test_pending_confirm_outranks_countdown(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    frm = clock(minute_of(DEFAULT_SPAN[1]) - MIN_BOOKING + 2 * HALF_HOUR)
    to = clock(minute_of(frm) + MIN_BOOKING)
    slot = find_slot(tenant, starts=[frm])
    info = kitchen(app_url)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        slab(page).focus()
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        wait_for(page, lambda: len(tenant_bookings(tenant)) == 1, "held booking")
        booking = tenant_bookings(tenant)[0]
        card = ticket(page, booking)
        wait_for(page, lambda: "Held" in txt(card), "Held card")
        gate = Gate(page, "**/api/bookings/*/confirm")
        click(card.get_by_role("button", name="Confirm booking"))
        wait_for(page, lambda: len(gate.routes) == 1, "pending confirm")
        advance(page, (info["holdSeconds"] + 5) * 1000)
        assert "Confirming…" in txt(card) and "Hold expired" not in txt(card)
        gate.release()
        wait_for(page, lambda: "Confirmed" in txt(card), "Confirmed after the answer")
    assert tenant.ok("GET", f"/api/bookings/{booking['id']}")["status"] == "confirmed"


def test_one_move_per_booking(app_url: str, mail: Mailpit) -> None:
    big_minutes, too_big, smaller_minutes = 480, 660, 360
    tenant, rival = new_tenant(app_url, packs=2), new_tenant(app_url, packs=1)
    big, slot = confirmed(tenant, minutes=big_minutes)
    target = find_slot(tenant, minutes=too_big, avoid={slot.day})
    expect_error(tenant.call("POST", f"/api/bookings/{big['id']}/move", target.body(), key=idempotency_key()), 409, "insufficient_hours")
    smaller = find_slot(tenant, minutes=smaller_minutes, avoid={slot.day})
    moved = tenant.ok("POST", f"/api/bookings/{big['id']}/move", smaller.body(), key=idempotency_key())
    assert moved["moveCount"] == 1 and moved["debitedMinutes"] == smaller_minutes and moved["stationId"] == smaller.station["id"]
    assert [e["minutes"] for e in movements(pack_detail(tenant, big["packId"]), "move_adjustment", big["id"])] == [big_minutes - smaller_minutes]
    assert claim(rival, slot.body(end=slot.start + timedelta(minutes=MIN_BOOKING))).status_code == 201
    expect_error(tenant.call("POST", f"/api/bookings/{big['id']}/move", find_slot(tenant).body(), key=idempotency_key()), 409, "move_limit_reached")
    await_mail(mail, tenant.email, r"Booking moved: .*")
    late = late_confirmed(tenant)
    expect_error(tenant.call("POST", f"/api/bookings/{late['id']}/move", find_slot(tenant).body(), key=idempotency_key()), 409, "past_cutoff")
    racer, old = confirmed(tenant)
    contested = find_slot(tenant, avoid={old.day})
    move, grab = fire([lambda: tenant.clone().call("POST", f"/api/bookings/{racer['id']}/move", contested.body(), key=idempotency_key()),
                       lambda: claim(rival.clone(), contested.body())])
    assert {move.status_code, grab.status_code} <= {200, 201, 409} and (move.status_code == 200) != (grab.status_code == 201)
    still = tenant.ok("GET", f"/api/bookings/{racer['id']}")
    if move.status_code == 409:
        expect_error(move, 409, "slot_taken")
        assert P(still["start"]) == old.start and still["stationId"] == old.station["id"]


def test_booking_email_delivery_lines(browser: Browser, app_url: str) -> None:
    isolated = env_url("APP_MAILPIT_DOWN_ISOLATED_URL")
    cook = new_tenant(isolated, packs=1)
    booking, slot = confirmed(cook)
    cook.ok("POST", f"/api/bookings/{booking['id']}/move", find_slot(cook, avoid={slot.day}).body(), key=idempotency_key())
    assert [(e["kind"], e["status"], e["sentAt"]) for e in cook.ok("GET", f"/api/bookings/{booking['id']}")["emails"]] == [("booking_confirmed", "queued", None), ("booking_moved", "queued", None)]
    with ui(browser, isolated) as page:
        ui_session(page, cook)
        page.goto(f"{isolated}/receipt/{booking['id']}")
        wait_heading(page, "Booking receipt")
        wait_for(page, lambda: "Move email: Queued" in page.evaluate("() => document.body.innerText"), "both email lines")
        body = page.evaluate("() => document.body.innerText")
        assert body.index("Confirmation email: Queued") < body.index("Move email: Queued")
    down = env_url("APP_MAILPIT_DOWN_URL")
    tenant = new_tenant(app_url, packs=1)
    held, _ = hold(tenant)
    tenant.clone(down).ok("POST", f"/api/bookings/{held['id']}/confirm")
    with ui(browser, down) as page:
        ui_session(page, tenant)
        page.goto(f"{down}/receipt/{held['id']}")
        wait_heading(page, "Booking receipt")
        wait_for(page, lambda: "Confirmation email:" in page.evaluate("() => document.body.innerText"), "receipt record drawn")
        first_seen_queued = "Confirmation email: Queued" in page.evaluate("() => document.body.innerText")
        page.evaluate("() => { window.__stay = true }")
        wait_for(page, lambda: re.search(r"Confirmation email: Sent \w{3} \d{1,2} \w{3} \d{4} \d{2}:\d{2}", page.evaluate("() => document.body.innerText")) is not None, "Sent line", MAIL_WAIT)
        assert page.evaluate("() => window.__stay === true")
        assert announced(page, "Confirmation email sent.") == (1 if first_seen_queued else 0)


SHAPE_CASES = {"unknown_station": "stationId", "unknown_shelf": "shelfId", "shelf_on_shelf": "shelfId", "too_short": "end",
               "off_half_hour": "start", "no_offset": "start", "before_open": "start", "past_close": "end",
               "two_days": "end", "started": "start", "beyond_horizon": "start"}


@pytest.mark.parametrize("case", list(SHAPE_CASES), ids=list(SHAPE_CASES))
def test_booking_shape_rules(app_url: str, case: str) -> None:
    tenant = new_tenant(app_url, docs=False)
    info = kitchen(app_url)
    zone, today = ZoneInfo(info["timeZone"]), date.fromisoformat(info["today"])
    day = today + timedelta(days=10)
    start, end = at(zone, day, DEFAULT_SPAN[0]), at(zone, day, DEFAULT_SPAN[0]) + timedelta(minutes=MIN_BOOKING)
    body = {"stationId": "range-1", "start": start.isoformat(), "end": end.isoformat()}
    if case == "unknown_station":
        body["stationId"] = "range-99"
    elif case == "unknown_shelf":
        body["shelfId"] = "shelf-99"
    elif case == "shelf_on_shelf":
        body.update(stationId="shelf-1", shelfId="shelf-2")
    elif case == "too_short":
        body["end"] = (start + timedelta(minutes=MIN_BOOKING - HALF_HOUR)).isoformat()
    elif case == "off_half_hour":
        body["start"] = (start + timedelta(minutes=15)).isoformat()
    elif case == "no_offset":
        body["start"] = start.replace(tzinfo=None).isoformat()
    elif case == "before_open":
        early = at(zone, day, clock(OPEN_MINUTE - HALF_HOUR))
        body.update(start=early.isoformat(), end=(early + timedelta(minutes=MIN_BOOKING)).isoformat())
    elif case == "past_close":
        late = at(zone, day, clock(CLOSE_MINUTE - MIN_BOOKING + HALF_HOUR))
        body.update(start=late.isoformat(), end=(late + timedelta(minutes=MIN_BOOKING)).isoformat())
    elif case == "two_days":
        body["end"] = (start + timedelta(days=1)).isoformat()
    elif case == "started":
        body.update(start=(start - timedelta(days=11)).isoformat(), end=(end - timedelta(days=11)).isoformat())
    elif case == "beyond_horizon":
        far = today + timedelta(days=HORIZON_DAYS + 1)
        body.update(start=at(zone, far, DEFAULT_SPAN[0]).isoformat(), end=(at(zone, far, DEFAULT_SPAN[0]) + timedelta(minutes=MIN_BOOKING)).isoformat())
    result = expect_error(claim(tenant, body), 422, "validation_failed")
    assert SHAPE_CASES[case] in result["fields"], result
    assert tenant_bookings(tenant) == []


def test_kitchen_time_zone(app_url: str, mail: Mailpit) -> None:
    base = env_url("APP_OFFSET_ZONE_URL")
    tenant = new_tenant(base, packs=1)
    info = kitchen(base)
    assert info["timeZone"] == "Asia/Kolkata"
    zone = ZoneInfo(info["timeZone"])
    opening = clock(OPEN_MINUTE)
    slot = find_slot(tenant, starts=[opening])
    expect_error(claim(tenant, slot.body(start=slot.start - timedelta(minutes=HALF_HOUR))), 422, "validation_failed")
    expect_error(claim(tenant, slot.body(start=slot.start + timedelta(minutes=15))), 422, "validation_failed")
    utc_body = {"stationId": slot.station["id"], "start": slot.start.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"), "end": slot.end.astimezone(ZoneInfo("UTC")).isoformat()}
    held = claim(tenant, utc_body).json()
    assert held["start"].endswith("+05:30") and hm(P(held["start"])) == opening
    booking = tenant.ok("POST", f"/api/bookings/{held['id']}/confirm")
    assert P(booking["cutoffAt"]) == at(zone, slot.day - timedelta(days=1), opening)
    assert any(e["bookingId"] == held["id"] for e in lead(base).ok("GET", f"/api/door?date={slot.day}")["entries"])
    report = owner(base).ok("GET", f"/api/reports/daily?date={slot.day}")
    assert any(t["tenantId"] == tenant.tenant_id and t["bookedMinutes"] == MIN_BOOKING for t in report["tenants"])
    body = text(await_mail(mail, tenant.email, r"Booking confirmed: .*")[0])
    assert re.search(rf"Starts: {dre(slot.day)} {opening} Asia/Kolkata", body)


def test_document_cover_edge(app_url: str) -> None:
    cover_days = 6
    tenant = new_tenant(app_url, packs=1, ins_days=cover_days)
    edge = find_slot(tenant, days=(cover_days, cover_days))
    assert claim(tenant, edge.body()).status_code == 201
    later = find_slot(tenant, days=(cover_days + 1, cover_days + 1))
    expect_error(claim(tenant, later.body()), 409, "documents_not_valid")


BODY_CASES = {"claim": "status", "apply": "role", "upload_part": "owner", "food_card_limit": "perOccurrenceLimit", "refund": "note", "session": "remember"}


@pytest.mark.parametrize("case", list(BODY_CASES), ids=list(BODY_CASES))
def test_only_published_fields(app_url: str, case: str, killbill: KillBill) -> None:
    unaccepted = "This field is not accepted."
    field = BODY_CASES[case]
    if case == "claim":
        tenant = new_tenant(app_url, packs=1)
        slot = find_slot(tenant)
        body = expect_error(claim(tenant, {**slot.body(), "status": "confirmed", "tenantId": tenant.tenant_id, "packId": "x"}), 422, "validation_failed")
        assert all(body["fields"][k] == unaccepted for k in ("status", "tenantId", "packId"))
        assert tenant_bookings(tenant) == []
    elif case == "apply":
        first, second = unique("role")
        email = first if "@" in first else second
        payload = {"businessName": "Role Co", "contactName": "Ro Le", "email": email, "password": NEW_PASSWORD, "role": "owner"}
        assert expect_error(Api(app_url).call("POST", "/api/tenants/apply", payload), 422, "validation_failed")["fields"]["role"] == unaccepted
        payload.pop("role")
        assert Api(app_url).call("POST", "/api/tenants/apply", payload).status_code == 201
    elif case in ("upload_part", "food_card_limit"):
        tenant = new_tenant(app_url, docs=False)
        extra = {"owner": "x"} if case == "upload_part" else {"perOccurrenceLimit": str(MIN_LIMIT_DOLLARS)}
        response = upload(tenant, "food_handler_card", kitchen_today(app_url) + timedelta(days=30), extra=extra)
        assert expect_error(response, 422, "validation_failed")["fields"][field] == unaccepted
        assert tenant.ok("GET", "/api/documents")["documents"] == [] and S3().keys(f"tenants/{tenant.tenant_id}/") == []
    elif case == "refund":
        tenant = new_tenant(app_url)
        pack = buy(tenant)
        boss = owner(app_url)
        boss.ok("POST", "/api/session/confirm", {"password": OWNER_PASSWORD})
        response = boss.call("POST", f"/api/packs/{pack['id']}/refund", {"expectedCents": PRICE_CENTS[SMALL_PACK], "note": "x"})
        assert expect_error(response, 422, "validation_failed")["fields"]["note"] == unaccepted
        assert pack_detail(boss, pack["id"])["status"] == "active" and kb_tx(kb_state(killbill, tenant)[1], "REFUND") == []
    else:
        response = Api(app_url).call("POST", "/api/session", {"email": DANA_EMAIL, "password": TENANT_PASSWORD, "remember": True})
        assert expect_error(response, 422, "validation_failed")["fields"]["remember"] == unaccepted
        assert session_token(response) is None


def test_wf_booking_rules_refusal(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1, ins_days=3)
    day = kitchen_today(app_url) + timedelta(days=5)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        floor = open_board(page, tenant, day, *DEFAULT_SPAN)
        before = {s["id"]: attr(station(page, s["id"]), "data-extrusion") for s in floor["stations"]}
        slab(page).focus()
        page.keyboard.press("Space")
        wait_for(page, lambda: page.locator('[data-drop-target="true"]').count() == 1, "drop target")
        page.keyboard.press("Enter")
        copy = re.compile(rf"Your documents don't cover {dre(day)}\. Upload a renewal to book that day\.")
        wait_for(page, lambda: shown_copy(page, copy) and announced(page, copy) == 1, "documents refusal copy")
        assert attr(slab(page), "aria-pressed") == "false" and focused(slab(page))
        assert {sid: attr(station(page, sid), "data-extrusion") for sid in before} == before
        assert tickets(page).get_by_role("article").count() == 0
        assert floor_plan(page).get_by_role("button", name=re.compile("just taken")).count() == 0
    assert tenant_bookings(tenant) == []


def test_wf_booking_rules_span_hint(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    booking, _ = confirmed(tenant)
    info = kitchen(app_url)
    today = date.fromisoformat(info["today"])
    frm = DEFAULT_SPAN[0]
    two_h = clock(minute_of(frm) + MIN_BOOKING)
    short_to = clock(minute_of(frm) + 2 * HALF_HOUR)
    with ui(browser, app_url) as page:
        page.clock.pause_at(P(info["now"]) + timedelta(days=4))
        ui_session(page, tenant)
        cases = ((today - timedelta(days=1), frm, two_h, "That span has already started. Pick a later span."),
                 (today + timedelta(days=HORIZON_DAYS + 1), frm, two_h, "Bookings open up to 60 days ahead. Pick an earlier date."),
                 (today + timedelta(days=HORIZON_DAYS), frm, short_to, "Pick a span of at least 2 h"))
        for day, a, b, hint in cases:
            page.goto(f"{app_url}/board?date={day}&from={a}&to={b}")
            wait_for(page, lambda: shown_copy(page, hint) and slab(page).is_disabled(), f"hint {hint!r} with the slab disabled")
            move = ticket(page, booking).get_by_role("button", name="Move booking")
            assert move.is_disabled()
            click(station(page, "range-1"))
            dialog = page.get_by_role("dialog", name="Range 1")
            wait_for(page, lambda: shown(dialog), "station dialog")
            assert dialog.get_by_role("button", name=re.compile(r"^Claim ")).is_disabled()
            page.keyboard.press("Escape")
        page.goto(f"{app_url}/board?date={today + timedelta(days=HORIZON_DAYS)}&from={frm}&to={two_h}")
        wait_stack(page, tenant, today + timedelta(days=HORIZON_DAYS), frm, two_h)
        assert not slab(page).is_disabled()
    floor = tenant.ok("GET", f"/api/floor?date={today + timedelta(days=HORIZON_DAYS + 1)}&from={frm}&to={two_h}")
    assert floor["spanStatus"] == "beyond_horizon"


def test_shape_messages_verbatim(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    info = kitchen(app_url)
    zone, day = ZoneInfo(info["timeZone"]), date.fromisoformat(info["today"]) + timedelta(days=9)
    off_grid = at(zone, day, DEFAULT_SPAN[0]) + timedelta(minutes=MIN_BOOKING + 15)
    body = {"stationId": "range-99", "shelfId": "range-2", "start": "tomorrow", "end": off_grid.isoformat()}
    fields = expect_error(claim(tenant, body), 422, "validation_failed")["fields"]
    assert fields == {"stationId": "Pick a station on the floor plan.", "shelfId": "Pick a walk-in shelf to pair with a range, prep table or mixer.",
                      "start": "Use an ISO 8601 time with a UTC offset.", "end": "Use a time on the hour or half hour."}
    early = at(zone, day, clock(OPEN_MINUTE - HALF_HOUR))
    short = {"stationId": "range-1", "start": early.isoformat(), "end": (early + timedelta(minutes=2 * HALF_HOUR)).isoformat()}
    assert expect_error(claim(tenant, short), 422, "validation_failed")["fields"] == {"start": "Book between 05:00 and 23:00 on one day.", "end": "Bookings last at least 2 h."}
    booking, slot = confirmed(tenant)
    same = expect_error(tenant.call("POST", f"/api/bookings/{booking['id']}/move", slot.body(), key=idempotency_key()), 422, "validation_failed")
    assert same["fields"] == {"start": "Pick a different station or span."}
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, day, *DEFAULT_SPAN)
        payload = {"error": "validation_failed", "message": "Check the fields.", "fields": {"end": "Bookings last at least 2 h.", "start": "That span has already started. Pick a later span."}}
        page.route("**/api/bookings", lambda r: r.fulfill(status=422, content_type="application/json", body=json.dumps(payload)) if r.request.method == "POST" else r.continue_())
        slab(page).focus()
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        copy = "That span has already started. Pick a later span."
        wait_for(page, lambda: shown_copy(page, copy) and announced(page, copy) == 1, "first-field sentence on the Board")
        assert not shown_copy(page, "Bookings last at least 2 h.")


def test_refusal_copy_outlives_refresh(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url)
    frm, to = DEFAULT_SPAN
    span = minute_of(to) - minute_of(frm)
    slot = find_slot(tenant, shelf=True, starts=[frm], minutes=span)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        click(station(page, slot.station["id"]))
        dialog = page.get_by_role("dialog", name=slot.station["name"])
        wait_for(page, lambda: shown(dialog), "station dialog")
        select(dialog.get_by_role("combobox", name="Walk-in shelf"), f"{slot.shelf['name']}, {dur(span)} free of {dur(span)}")
        button = dialog.get_by_role("button", name=f"Claim {slot.station['name']} and {slot.shelf['name']} {frm}{DASH}{to}")
        click(button)
        copy = f"No single pack has {dur(2 * span)} available. Buy a pack or release a hold to book this span."
        wait_for(page, lambda: shown_copy(page, copy), "hours refusal copy")
        hold_for(page, 2 * REFRESH_SECONDS + 3, lambda: shown(dialog) and shown(button) and focused(button) and shown_copy(page, copy), "refusal copy, shelf and focus")
        assert announced(page, copy) == 1
        page.keyboard.press("Escape")
        end = page.get_by_role("slider", name="Span end")
        end.focus()
        page.keyboard.press("ArrowRight")
        wait_for(page, lambda: not shown_copy(page, copy), "copy removed after a span change")


def test_claim_rate_limit(app_url: str) -> None:
    tenant, other = new_tenant(app_url, docs=False), new_tenant(app_url, docs=False)
    bad = {"stationId": "range-1", "start": "x", "end": "y"}
    alt = tenant.clone(env_url("APP_KILLBILL_DOWN_URL"))
    for i in range(CLAIM_LIMIT):
        expect_error(claim(alt if i % 2 else tenant, bad), 422, "validation_failed")
    limited = claim(tenant, bad)
    expect_error(limited, 429, "rate_limited", "Too many claims in the last minute. Try again shortly.")
    assert 1 <= int(limited.headers["Retry-After"]) <= CLAIM_WINDOW
    answers = fire([(lambda: claim(other.clone(), bad)) for _ in range(CLAIM_LIMIT + 5)])
    assert sum(a.status_code != 429 for a in answers) == CLAIM_LIMIT
    assert tenant_bookings(tenant) == [] and tenant_bookings(other) == []


def test_hour_rail_span(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url)
    day = kitchen_today(app_url) + timedelta(days=3)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, day, *DEFAULT_SPAN)
        start, end = page.get_by_role("slider", name="Span start"), page.get_by_role("slider", name="Span end")
        length = page.evaluate("() => history.length")
        start.focus()
        base = minute_of(DEFAULT_SPAN[0])
        for key, want in (("ArrowRight", base + HALF_HOUR), ("ArrowLeft", base), ("ArrowDown", base - HALF_HOUR), ("ArrowUp", base), ("Home", OPEN_MINUTE)):
            page.keyboard.press(key)
            wait_for(page, lambda: attr(start, "aria-valuetext") == clock(want) and query(page).get("from") == clock(want), f"Span start {clock(want)} after {key}")
        end.focus()
        page.keyboard.press("End")
        wait_for(page, lambda: attr(end, "aria-valuetext") == clock(CLOSE_MINUTE), "Span end at closing")
        start.focus()
        page.keyboard.press("End")
        wait_for(page, lambda: attr(start, "aria-valuetext") == clock(CLOSE_MINUTE - HALF_HOUR), "start kept half an hour before end")
        assert page.evaluate("() => history.length") == length
        rail = page.get_by_role("group", name="Hour rail")
        assert len([n for n in range(5, 24) if rail.get_by_text(f"{n:02d}", exact=True).count()]) == HOUR_NUMERALS
        scroll = page.evaluate("() => window.scrollY")
        a, b = OPEN_MINUTE + 2 * HALF_HOUR, OPEN_MINUTE + 6 * HALF_HOUR
        drag(page, rail.get_by_text(clock(a)[:2], exact=True).first, rail.get_by_text(clock(b)[:2], exact=True).first)
        wait_for(page, lambda: attr(start, "aria-valuetext") == clock(a) and attr(end, "aria-valuetext") == clock(b), "dragged span")
        assert page.evaluate("() => window.scrollY") == scroll


def test_station_stack_heights(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    booking, slot = confirmed(tenant, starts=[DEFAULT_SPAN[0]], extra_free=180)
    zone = ZoneInfo(kitchen(app_url)["timeZone"])
    base = minute_of(DEFAULT_SPAN[0])
    spans = ((base + 2 * HALF_HOUR, base + 7 * HALF_HOUR), (base, base + MIN_BOOKING), (base + 4 * HALF_HOUR, base + 10 * HALF_HOUR))
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        for lo, hi in spans:
            frm, to = clock(lo), clock(hi)
            floor = open_board(page, tenant, slot.day, frm, to)
            span = int((at(zone, slot.day, to) - at(zone, slot.day, frm)).total_seconds() // 60)
            mine = next(s for s in floor["stations"] if s["id"] == slot.station["id"])
            state = "free" if mine["occupiedMinutes"] == 0 else ("full" if mine["freeMinutes"] == 0 else "partial")
            assert attr(station(page, mine["id"]), "data-state") == state
            label = page.get_by_role("button", name=f"{mine['name']}, {station_label(mine, span)}", exact=True)
            assert label.count() == 1, f"label {station_label(mine, span)} missing"


def test_wf_station_stack_drag_claim(browser: Browser, app_url: str, mail: Mailpit) -> None:
    tenant = new_tenant(app_url, packs=1)
    frm, to = DEFAULT_SPAN
    slot = find_slot(tenant, starts=[frm], minutes=minute_of(to) - minute_of(frm))
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        target = station(page, slot.station["id"])
        drag(page, slab(page), target)
        wait_for(page, lambda: len(tenant_bookings(tenant)) == 1, "a held booking after the drop")
        booking = tenant_bookings(tenant)[0]
        assert booking["stationId"] == slot.station["id"] and booking["status"] == "held"
        card = ticket(page, booking)
        wait_for(page, lambda: "Held" in txt(card) and attr(target, "data-extrusion") == str(EXTRUSION_PX), "Held card and a full block")
        assert page.get_by_role("button", name=f"{slot.station['name']}, full", exact=True).count() == 1
        click(card.get_by_role("button", name="Confirm booking"))
        wait_for(page, lambda: "Confirmed" in txt(card) and "Free cancellation until" in txt(card), "Confirmed card")
        other = next(s for s in SEED_STATIONS if s != slot.station["id"])
        tap(station(page, other))
        wait_for(page, lambda: page.get_by_role("dialog").count() == 1, "station dialog after a tap")
    assert tenant.ok("GET", f"/api/bookings/{booking['id']}")["status"] == "confirmed"
    await_mail(mail, tenant.email, r"Booking confirmed: .*")


def test_just_taken_retract(browser: Browser, app_url: str) -> None:
    tenant, rival = new_tenant(app_url, packs=1), new_tenant(app_url, packs=1)
    frm, to = DEFAULT_SPAN
    slot = find_slot(tenant, starts=[frm], minutes=minute_of(to) - minute_of(frm))
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        assert claim(rival, slot.body()).status_code == 201
        drag(page, slab(page), station(page, slot.station["id"]))
        taken = page.get_by_role("button", name=re.compile(rf"^{re.escape(slot.station['name'])}, just taken"))
        wait_for(page, lambda: taken.count() == 1, "just taken label")
        wait_for(page, lambda: attr(station(page, slot.station["id"]), "data-extrusion") == str(EXTRUSION_PX), "block at its true height")
        assert announced(page, f"Just taken. Someone else claimed {slot.station['name']} for that span.") == 1
        assert tickets(page).get_by_role("article").count() == 0 and attr(slab(page), "aria-pressed") == "false"
        assert rival.business not in page.evaluate("() => document.body.innerText")
    assert tenant_bookings(tenant) == []


def test_wf_station_stack_keyboard(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    frm = clock(minute_of(DEFAULT_SPAN[1]) + 6 * HALF_HOUR)
    to = clock(minute_of(frm) + MIN_BOOKING)
    slot = find_slot(tenant, starts=[frm])
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        floor = open_board(page, tenant, slot.day, frm, to)
        by_id = {s["id"]: s for s in floor["stations"]}
        first_free = next((s for s in SEED_STATIONS if attr(station(page, s), "data-state") == "free"), SEED_STATIONS[0])
        slab(page).focus()
        page.keyboard.press("Space")
        target = page.locator('[data-drop-target="true"]')
        wait_for(page, lambda: attr(slab(page), "aria-pressed") == "true" and attr(target, "data-station-id") == first_free, "slab lifted on the first free station")
        assert announced(page, "Slab lifted. Arrow keys pick a station, Enter claims, Escape puts it back.") == 1
        col, row = GRID[first_free]
        right = next((s for s, g in GRID.items() if g == (col + 1, row)), first_free)
        page.keyboard.press("ArrowRight")
        wait_for(page, lambda: attr(target, "data-station-id") == right, "target moved right")
        assert announced(page, f"{by_id[right]['name']}: {station_label(by_id[right], MIN_BOOKING)}") >= 1
        page.keyboard.press("Escape")
        wait_for(page, lambda: attr(slab(page), "aria-pressed") == "false" and target.count() == 0, "slab returned")
        assert announced(page, "Slab returned. Nothing claimed.") == 1 and tenant_bookings(tenant) == []
        page.keyboard.press("Enter")
        wait_for(page, lambda: attr(target, "data-station-id") == first_free, "lift again")
        page.keyboard.press("Space")
        wait_for(page, lambda: len(tenant_bookings(tenant)) == 1, "claimed booking")
        booking = tenant_bookings(tenant)[0]
        assert booking["stationId"] == first_free
        wait_for(page, lambda: focused(ticket(page, booking)), "focus on the new ticket card")


def test_latest_span_wins(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    base = minute_of(DEFAULT_SPAN[0])
    _, slot = confirmed(tenant, starts=[clock(base - 4 * HALF_HOUR)], minutes=5 * HALF_HOUR)
    skipped = clock(base + HALF_HOUR)
    final = clock(base + 2 * HALF_HOUR)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, *DEFAULT_SPAN)
        gate = Gate(page, "**/api/floor*", method="GET", match=lambda u: f"from={quote(skipped)}" in u or f"from={skipped}" in u)
        start = page.get_by_role("slider", name="Span start")
        start.focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        wait_stack(page, tenant, slot.day, final, DEFAULT_SPAN[1])
        gate.release()
        hold_for(page, 3, lambda: attr(station(page, slot.station["id"]), "data-extrusion") == "0", "stack for the final span")
        assert query(page).get("from") == final and attr(start, "aria-valuetext") == final
        assert not shown_copy(page, "Floor plan couldn't refresh. Showing the last known stack.")


def test_refreshes_keep_state(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    frm, to = DEFAULT_SPAN
    span = minute_of(to) - minute_of(frm)
    slot = find_slot(tenant, shelf=True, starts=[frm], minutes=span)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        slab(page).focus()
        page.keyboard.press("Space")
        target = page.locator('[data-drop-target="true"]')
        wait_for(page, lambda: target.count() == 1, "drop target")
        page.keyboard.press("ArrowDown")
        where = attr(target, "data-station-id")
        hold_for(page, 2 * REFRESH_SECONDS + 2, lambda: attr(slab(page), "aria-pressed") == "true" and attr(target, "data-station-id") == where and focused(slab(page)), "lifted slab")
        page.keyboard.press("Escape")
        click(station(page, slot.station["id"]))
        dialog = page.get_by_role("dialog", name=slot.station["name"])
        wait_for(page, lambda: shown(dialog), "station dialog")
        select(dialog.get_by_role("combobox", name="Walk-in shelf"), f"{slot.shelf['name']}, {dur(span)} free of {dur(span)}")
        button = dialog.get_by_role("button", name=f"Claim {slot.station['name']} and {slot.shelf['name']} {frm}{DASH}{to}")
        button.focus()
        hold_for(page, 2 * REFRESH_SECONDS + 2, lambda: shown(dialog) and shown(button) and focused(button), "open dialog with its shelf")


def test_wf_station_stack_move(browser: Browser, app_url: str, mail: Mailpit) -> None:
    tenant = new_tenant(app_url, packs=1)
    booking, slot = confirmed(tenant)
    frm = clock(minute_of(DEFAULT_SPAN[1]) + 4 * HALF_HOUR)
    to = clock(minute_of(frm) + MIN_BOOKING)
    target = find_slot(tenant, starts=[frm], avoid={slot.day})
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, target.day, frm, to)
        card = ticket(page, booking)
        wait_for(page, lambda: shown(card), "movable card on another date")
        move = card.get_by_role("button", name="Move booking")
        move.focus()
        page.keyboard.press("Enter")
        drop = page.locator('[data-drop-target="true"]')
        wait_for(page, lambda: attr(move, "aria-pressed") == "true" and drop.count() == 1, "Move booking lifted")
        assert announced(page, f"Moving {slot.station['name']} {hm(slot.start)}{DASH}{hm(slot.end)}. Arrow keys pick a station, Enter moves, Escape puts it back.") == 1
        sid = attr(drop, "data-station-id")
        page.keyboard.press("Enter")
        wait_for(page, lambda: tenant.ok("GET", f"/api/bookings/{booking['id']}")["moveCount"] == 1, "the move")
        moved = tenant.ok("GET", f"/api/bookings/{booking['id']}")
        assert moved["stationId"] == sid and P(moved["start"]) == target.start
        wait_for(page, lambda: focused(ticket(page, moved)) and attr(station(page, sid), "data-extrusion") == str(EXTRUSION_PX), "renamed card with focus and risen block")
    old = {s["id"]: s for s in tenant.ok("GET", f"/api/floor?date={slot.day}")["stations"]}[slot.station["id"]]
    assert interval_free(old, slot.start, slot.end)
    await_mail(mail, tenant.email, rf"Booking moved: .* on {dre(target.day)}")


def test_cooler_strip(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    frm = DEFAULT_SPAN[0]
    to = clock(minute_of(frm) + MIN_BOOKING)
    slot = find_slot(tenant, kinds=("cooler_shelf",), starts=[frm])
    assert claim(tenant, slot.body()).status_code == 201
    floor = tenant.ok("GET", f"/api/floor?date={slot.day}&from={frm}&to={to}")
    shelves = [s for s in floor["stations"] if s["kind"] == "cooler_shelf"]
    zone = ZoneInfo(kitchen(app_url)["timeZone"])
    assert [r["time"] for r in floor["coolerFree"]] == half_hours()
    for row in floor["coolerFree"]:
        lo = at(zone, slot.day, row["time"])
        assert row["freeShelves"] == sum(interval_free(s, lo, lo + timedelta(minutes=HALF_HOUR)) for s in shelves), row
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        cells = page.get_by_role("group", name="Hour rail").locator("[data-cooler-free]")
        assert cells.count() == COOLER_CELLS
        for i, row in enumerate(floor["coolerFree"]):
            assert attr(cells.nth(i), "data-cooler-time") == row["time"] and attr(cells.nth(i), "data-cooler-free") == str(row["freeShelves"])
        full = sum(s["freeMinutes"] == MIN_BOOKING for s in shelves)
        assert shown(page.get_by_text(f"Cooler: {full} of {len(shelves)} shelves free all span"))
    short = env_url("APP_SHORT_URL")
    cook = new_tenant(short, packs=1)
    held, s2 = hold(cook, kinds=("cooler_shelf",), starts=[frm])
    busy = cook.ok("GET", f"/api/floor?date={s2.day}")["coolerFree"]
    wait_server_past(short, P(held["holdExpiresAt"]), "the shelf hold expiry")
    freed = cook.ok("GET", f"/api/floor?date={s2.day}")["coolerFree"]
    assert next(r for r in freed if r["time"] == frm)["freeShelves"] == next(r for r in busy if r["time"] == frm)["freeShelves"] + 1


def test_cancel_cutoff_credit(app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    booking, _ = confirmed(tenant)
    assert booking["cancelCreditMinutes"] == booking["debitedMinutes"] == MIN_BOOKING
    answers = fire([(lambda: tenant.clone().call("POST", f"/api/bookings/{booking['id']}/cancel")) for _ in range(5)])
    assert sorted(a.status_code for a in answers) == [200] + [409] * 4
    assert all(a.json()["error"] == "invalid_transition" for a in answers if a.status_code == 409)
    detail = pack_detail(tenant, booking["packId"])
    assert_ledger(detail)
    assert [e["minutes"] for e in movements(detail, "cancellation_credit", booking["id"])] == [MIN_BOOKING]
    done = tenant.ok("GET", f"/api/bookings/{booking['id']}")
    assert done["refundedMinutes"] == MIN_BOOKING and done["cancelReason"] == "tenant" and detail["balanceMinutes"] == SMALL_PACK * 60
    late = late_confirmed(tenant)
    assert late["cancelCreditMinutes"] == 0
    tenant.ok("POST", f"/api/bookings/{late['id']}/cancel")
    assert movements(pack_detail(tenant, late["packId"]), "cancellation_credit", late["id"]) == []


def test_wf_cancellation_cancel(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    frm, to = DEFAULT_SPAN
    span = minute_of(to) - minute_of(frm)
    booking, slot = confirmed(tenant, starts=[frm], minutes=span)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        card = ticket(page, booking)
        wait_for(page, lambda: re.search(rf"Free cancellation until {dre(P(booking['cutoffAt']).date())} {hm(P(booking['cutoffAt']))}", txt(card)) is not None, "cancellation line")
        click(card.get_by_role("button", name="Cancel booking"))
        step = page.get_by_role("group", name="Cancel this booking?")
        wait_for(page, lambda: shown(step), "cancel step")
        click(step.get_by_role("button", name="Yes, cancel"))
        wait_for(page, lambda: "Cancelled" in txt(card) and shown_copy(page, f"Cancelled. {dur(span)} returned to your pack."), "Cancelled card and copy")
        wait_for(page, lambda: attr(station(page, slot.station["id"]), "data-state") == "free", "station free again")
    done = tenant.ok("GET", f"/api/bookings/{booking['id']}")
    assert done["status"] == "cancelled" and done["cancelReason"] == "tenant"
    assert tenant.ok("GET", f"/api/packs/{booking['packId']}")["balanceMinutes"] == SMALL_PACK * 60


def test_wf_cancellation_keyboard(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    frm, to = DEFAULT_SPAN
    span = minute_of(to) - minute_of(frm)
    booking, slot = confirmed(tenant, starts=[frm], minutes=span)
    with ui(browser, app_url) as page:
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/cancel") else None)
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        card = ticket(page, booking)
        cancel = card.get_by_role("button", name="Cancel booking")
        wait_for(page, lambda: shown(cancel), "Cancel booking")
        step = page.get_by_role("group", name="Cancel this booking?")
        for close_key in ("Enter", "Escape"):
            cancel.focus()
            page.keyboard.press("Enter")
            wait_for(page, lambda: focused(step.get_by_role("button", name="Keep it")), "focus on Keep it")
            assert described_by(step) == f"You'll get {dur(span)} back."
            page.keyboard.press(close_key)
            wait_for(page, lambda: focused(cancel) and step.count() == 0, f"step closed by {close_key}")
        assert posts == []
        cancel.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("Tab")
        assert focused(step.get_by_role("button", name="Yes, cancel"))
        page.keyboard.press("Enter")
        wait_for(page, lambda: "Cancelled" in txt(card) and focused(card), "Cancelled card with focus")
        assert len(posts) == 1


def test_honest_cards(browser: Browser, app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    booking = door_booking(tenant)
    start, end = P(booking["start"]), P(booking["end"])
    with ui(browser, base) as page:
        ui_session(page, tenant)
        open_board(page, tenant, start.date(), hm(start), hm(end))
        card = ticket(page, booking)
        wait_for(page, lambda: "Confirmed" in txt(card), "Confirmed card")
        lead(base).ok("POST", f"/api/bookings/{booking['id']}/check-in")
        gate = Gate(page, "**/api/bookings/*/cancel")
        click(card.get_by_role("button", name="Cancel booking"))
        click(page.get_by_role("group", name="Cancel this booking?").get_by_role("button", name="Yes, cancel"))
        wait_for(page, lambda: len(gate.routes) == 1, "pending cancel")
        assert "Cancelled" not in txt(card)
        gate.release()
        wait_for(page, lambda: "Checked in" in txt(card) and shown_copy(page, "This booking can no longer be cancelled."), "re-read Checked in card")
        assert card.get_by_role("button", name="Cancel booking").count() == 0 and focused(card)
    assert tenant.ok("GET", f"/api/bookings/{booking['id']}")["status"] == "checked_in"


def test_cancel_credit_server_decides(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    future, _ = confirmed(tenant)
    late = late_confirmed(tenant)
    info = kitchen(app_url)
    with ui(browser, app_url) as page:
        page.clock.pause_at(P(info["now"]) + timedelta(days=3))
        ui_session(page, tenant)
        page.goto(f"{app_url}/board?date={info['today']}&from={DEFAULT_SPAN[0]}&to={DEFAULT_SPAN[1]}")
        cut = P(future["cutoffAt"])
        wait_for(page, lambda: re.search(rf"Free cancellation until {dre(cut.date())} {hm(cut)}", txt(ticket(page, future))) is not None, "future cancellation line")
        wait_for(page, lambda: "Past cutoff — cancelling returns no hours" in txt(ticket(page, late)), "late cancellation line")
        for booking, words in ((future, f"You'll get {dur(MIN_BOOKING)} back."), (late, "No hours will be returned.")):
            click(ticket(page, booking).get_by_role("button", name="Cancel booking"))
            wait_for(page, lambda: shown(page.get_by_role("group", name="Cancel this booking?")), "cancel step")
            assert words in txt(ticket(page, booking))
            page.keyboard.press("Escape")
    assert tenant.ok("GET", f"/api/bookings/{late['id']}")["cancelCreditMinutes"] == 0


def test_door_list_clearance(browser: Browser, app_url: str) -> None:
    cleared, lapsing = new_tenant(app_url, packs=1), new_tenant(app_url, packs=1)
    ok, slot = confirmed(cleared, days=(8, 20))
    offset = slot.day.toordinal() - kitchen_today(app_url).toordinal()
    bad, _ = confirmed(lapsing, days=(offset, offset))
    assert upload(lapsing, "insurance_certificate", kitchen_today(app_url)).status_code == 201
    entries = {e["bookingId"]: e for e in lead(app_url).ok("GET", f"/api/door?date={slot.day}")["entries"]}
    assert entries[ok["id"]]["cleared"] is True and entries[ok["id"]]["tenantName"] == cleared.business and entries[ok["id"]]["reason"] is None
    assert entries[bad["id"]]["cleared"] is False and entries[bad["id"]]["reason"] == "insurance_lapsed"
    with ui(browser, app_url) as page:
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/board?date={slot.day}")
        wait_for(page, lambda: "Not cleared — certificate of insurance lapsed" in txt(door_card(page, lapsing.business, bad)), "Not cleared card")
        assert "Cleared" in txt(door_card(page, cleared.business, ok))


def test_door_transitions(app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    now_booking = door_booking(tenant)
    future, _ = confirmed(tenant)
    staff = lead(base)
    expect_error(staff.call("POST", f"/api/bookings/{future['id']}/check-in"), 409, "outside_check_in_window")
    expect_error(staff.call("POST", f"/api/bookings/{future['id']}/no-show"), 409, "too_early")
    expect_error(staff.call("POST", f"/api/bookings/{now_booking['id']}/no-show"), 409, "too_early")
    expect_error(staff.call("POST", f"/api/bookings/{now_booking['id']}/check-out", {"cleanupDone": False}), 422, "validation_failed")
    expect_error(staff.call("POST", f"/api/bookings/{now_booking['id']}/check-out", {"cleanupDone": True, "note": ""}), 409, "invalid_transition")
    entry = next(e for e in staff.ok("GET", f"/api/door?date={P(now_booking['start']).date()}")["entries"] if e["bookingId"] == now_booking["id"])
    assert entry["actions"] == ["check_in"] and P(entry["checkInOpensAt"]) == P(now_booking["start"]) - timedelta(minutes=CHECKIN_LEAD)
    assert staff.ok("POST", f"/api/bookings/{now_booking['id']}/check-in")["status"] == "checked_in"
    for action in ("check-in", "no-show"):
        expect_error(staff.call("POST", f"/api/bookings/{now_booking['id']}/{action}"), 409, "invalid_transition")
    expect_error(tenant.call("POST", f"/api/bookings/{now_booking['id']}/cancel"), 409, "invalid_transition")
    done = staff.ok("POST", f"/api/bookings/{now_booking['id']}/check-out", {"cleanupDone": True, "note": NOTE_TRANSITIONS})
    assert done["status"] == "completed" and done["cleanupNote"] == NOTE_TRANSITIONS


def test_wf_door_shift_lead(browser: Browser, app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    booking = door_booking(tenant)
    with ui(browser, base) as page:
        page.set_viewport_size({"width": VIEWPORTS["narrow"][0], "height": VIEWPORTS["narrow"][1]})
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        card = door_card(page, tenant.business, booking)
        wait_for(page, lambda: "Booked" in txt(card) and "Cleared" in txt(card), "Booked, Cleared door card")
        click(card.get_by_role("button", name="Check in"))
        wait_for(page, lambda: re.search(rf"In \d{{2}}:\d{{2}} · {LEAD_NAME}", txt(card)) is not None and "Checked in" in txt(card), "checked-in card")
        wait_for(page, lambda: card.evaluate("e => e.getAnimations({subtree: true}).every(a => a.playState !== 'running')"), "door card turn finished")
        click(card.get_by_role("button", name="Check out"))
        dialog = page.get_by_role("dialog", name="Check out")
        wait_for(page, lambda: shown(dialog), "Check out dialog")
        check(dialog.get_by_role("checkbox", name="Station cleaned and sanitised"))
        fill(dialog.get_by_role("textbox", name="Cleanup note"), NOTE_JOURNEY)
        click(dialog.get_by_role("button", name="Log cleanup and check out"))
        wait_for(page, lambda: "Completed" in txt(card) and re.search(rf"Out \d{{2}}:\d{{2}} · {LEAD_NAME} · cleaned", txt(card)) is not None, "Completed card")
    done = lead(base).ok("GET", f"/api/bookings/{booking['id']}")
    assert [(e["action"], e["by"]) for e in done["doorLog"]] == [("check_in", LEAD_NAME), ("check_out", LEAD_NAME)]
    assert done["status"] == "completed" and done["cleanupNote"] == NOTE_JOURNEY


def test_door_log_once(app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    booking = door_booking(tenant)
    staff, boss = lead(base), owner(base)
    calls = [(lambda who=who: who.clone().call("POST", f"/api/bookings/{booking['id']}/check-in")) for who in [staff] * 5 + [boss] * 5]
    answers = fire(calls)
    assert sorted(a.status_code for a in answers) == [200] + [409] * 9
    assert all(a.json()["error"] == "invalid_transition" for a in answers if a.status_code == 409)
    winner = LEAD_NAME if answers.index(next(a for a in answers if a.status_code == 200)) < 5 else OWNER_NAME
    log = staff.ok("GET", f"/api/bookings/{booking['id']}")["doorLog"]
    assert [(e["action"], e["by"]) for e in log] == [("check_in", winner)]
    staff.ok("POST", f"/api/bookings/{booking['id']}/check-out", {"cleanupDone": True, "note": ""})
    after = staff.ok("GET", f"/api/bookings/{booking['id']}")["doorLog"]
    assert after[0] == log[0] and [e["action"] for e in after] == ["check_in", "check_out"] and after[1]["by"] == LEAD_NAME
    assert "doorLog" not in tenant.ok("GET", f"/api/bookings/{booking['id']}")


def test_door_actions_server_clock(browser: Browser, app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    open_now, later = door_booking(tenant), door_booking(tenant, later=2)
    info = kitchen(base)
    with ui(browser, base) as page:
        page.clock.pause_at(P(info["now"]) + timedelta(hours=5))
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        wait_for(page, lambda: shown(door_card(page, tenant.business, later)), "later door card")
        entries = {e["bookingId"]: e for e in lead(base).ok("GET", "/api/door")["entries"]}
        labels = {"check_in": "Check in", "check_out": "Check out", "no_show": "Mark no-show"}
        for booking in (open_now, later):
            card = door_card(page, tenant.business, booking)
            shown_buttons = [n for n in labels.values() if card.get_by_role("button", name=n).count()]
            assert shown_buttons == [labels[a] for a in entries[booking["id"]]["actions"]]
        assert entries[later["id"]]["actions"] == []
        assert f"Check-in opens {hm(P(entries[later['id']]['checkInOpensAt']))}" in txt(door_card(page, tenant.business, later))
    release_door_stations(tenant, [open_now, later])


def test_wf_door_keyboard(browser: Browser, app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    booking = door_booking(tenant)
    with ui(browser, base) as page:
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        card = door_card(page, tenant.business, booking)
        wait_for(page, lambda: shown(card.get_by_role("button", name="Check in")), "Check in button")
        card.focus()
        page.keyboard.press("Tab")
        assert focused(card.get_by_role("button", name="Check in"))
        page.keyboard.press("Enter")
        wait_for(page, lambda: focused(card) and "Checked in" in txt(card), "focus on the checked-in card")
        card.get_by_role("button", name="Check out").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Check out")
        box = dialog.get_by_role("checkbox", name="Station cleaned and sanitised")
        wait_for(page, lambda: focused(box), "focus on the cleanup box")
        assert tab_order(page, 4) == ["Cleanup note", "Log cleanup and check out", "Close", "Station cleaned and sanitised"]
        page.keyboard.press("Shift+Tab")
        assert focused(dialog.get_by_role("button", name="Close"))
        dialog.get_by_role("button", name="Log cleanup and check out").focus()
        page.keyboard.press("Enter")
        error = "Confirm the station was cleaned and sanitised."
        wait_for(page, lambda: focused(box) and error in described_by(box), "linked cleanup-box error")
        page.keyboard.press("Space")
        page.keyboard.press("Tab")
        page.keyboard.type(NOTE_KEYBOARD)
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        wait_for(page, lambda: focused(card) and "Completed" in txt(card), "focus on the Completed card")
    assert lead(base).ok("GET", f"/api/bookings/{booking['id']}")["cleanupNote"] == NOTE_KEYBOARD


def test_door_announcements(browser: Browser, app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    booking = door_booking(tenant)
    today = date.fromisoformat(kitchen(base)["today"])
    with ui(browser, base) as page:
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        summary = re.compile(rf"Door list for {dre(today)}: (\d+) bookings?, (\d+) cleared\.")
        wait_for(page, lambda: announced(page, summary) == 1, "today's door summary")
        entries = lead(base).ok("GET", "/api/door")["entries"]
        found = summary.findall(page.evaluate("() => window.__ann.join(' ')"))[-1]
        assert int(found[0]) in (len(entries), len(entries) - 1) and int(found[1]) <= int(found[0])
        owner(base).ok("POST", f"/api/bookings/{booking['id']}/check-in")
        start, end = P(booking["start"]), P(booking["end"])
        change = f"{tenant.business} {booking['stationName']} {hm(start)}{DASH}{hm(end)}: Checked in."
        wait_for(page, lambda: announced(page, change) == 1, "door change announcement", DOOR_VISIBLE + REFRESH_SLACK)
        hold_for(page, DOOR_REFRESH + 2, lambda: announced(page, change) == 1 and announced(page, summary) == 1, "single announcements")


def test_door_pending_outlasts_refresh(browser: Browser, app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    booking = door_booking(tenant)
    with ui(browser, base) as page:
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        card = door_card(page, tenant.business, booking)
        wait_for(page, lambda: shown(card.get_by_role("button", name="Check in")), "Check in")
        gate = Gate(page, "**/api/bookings/*/check-in")
        click(card.get_by_role("button", name="Check in"))
        wait_for(page, lambda: len(gate.routes) == 1, "pending check-in")
        route = gate.routes.pop()
        answer = route.fetch()
        hold_for(page, DOOR_REFRESH + 3, lambda: "Checking in…" in txt(card) and card.get_by_role("button", name="Check in").is_disabled(), "pending copy through the refresh")
        route.fulfill(response=answer)
        wait_for(page, lambda: "Checked in" in txt(card) and "Checking in…" not in txt(card), "card after its own answer")
        start, end = P(booking["start"]), P(booking["end"])
        assert announced(page, f"{tenant.business} checked in at {booking['stationName']}.") == 1
        assert announced(page, f"{tenant.business} {booking['stationName']} {hm(start)}{DASH}{hm(end)}: Checked in.") == 0


def test_door_card_turns_over(browser: Browser, app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    booking = door_booking(tenant)
    with ui(browser, base) as page:
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        card = door_card(page, tenant.business, booking)
        wait_for(page, lambda: attr(card, "data-face") == "front", "card on its front face")
        gate = Gate(page, "**/api/bookings/*/check-in")
        click(card.get_by_role("button", name="Check in"))
        wait_for(page, lambda: len(gate.routes) == 1, "pending check-in")
        assert recorded_animations(card) == [] and attr(card, "data-face") == "front"
        gate.release()
        wait_for(page, lambda: attr(card, "data-face") == "back", "data-face back after the turn")
        turns = [a for a in recorded_animations(card) if a["duration"] > 0]
        assert len({a["t"] for a in turns}) == 1 and turns[0]["duration"] == FLIP_MS and "180" in turns[0]["keyframes"]
        lead(base).ok("POST", f"/api/bookings/{booking['id']}/check-out", {"cleanupDone": True, "note": ""})
        before = len(recorded_animations(card))
        click(card.get_by_role("button", name="Check out"))
        dialog = page.get_by_role("dialog", name="Check out")
        check(dialog.get_by_role("checkbox", name="Station cleaned and sanitised"))
        click(dialog.get_by_role("button", name="Log cleanup and check out"))
        wait_for(page, lambda: "Completed" in txt(card) and dialog.count() == 0, "refused check-out re-read")
        assert len(recorded_animations(card)) == before and attr(card, "data-face") == "back"
    other = door_booking(new_tenant(base, packs=1))
    with ui(browser, base, reduced_motion="reduce") as page:
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        name = next(e["tenantName"] for e in lead(base).ok("GET", "/api/door")["entries"] if e["bookingId"] == other["id"])
        card = door_card(page, name, other)
        wait_for(page, lambda: shown(card.get_by_role("button", name="Check in")), "Check in")
        click(card.get_by_role("button", name="Check in"))
        wait_for(page, lambda: attr(card, "data-face") == "back", "immediate face change")
        assert [a for a in recorded_animations(card) if a["duration"] > 0] == []


def test_door_layout_bands(browser: Browser, app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    first, second = door_booking(tenant, any_time=True), door_booking(tenant, any_time=True)
    with ui(browser, base) as page:
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        for label, (width, height) in VIEWPORTS.items():
            page.set_viewport_size({"width": width, "height": height})
            cards = [door_card(page, tenant.business, b) for b in (first, second)]
            wait_for(page, lambda: all(shown(c) for c in cards), "both door cards")
            layout(page)
            boxes = [c.bounding_box() for c in cards]
            plan = floor_plan(page).bounding_box()
            rail = page.get_by_role("group", name="Hour rail").bounding_box()
            menu = page.get_by_role("button", name="Menu")
            assert all("Cleared" in txt(c) for c in cards)
            if label == "wide":
                column = page.get_by_role("region", name="Door list").bounding_box()
                assert menu.count() == 0 and column["x"] + column["width"] <= plan["x"] + 1
            elif label == "medium":
                assert menu.count() == 0
                articles = page.get_by_role("region", name="Door list").get_by_role("article")
                grid = [articles.nth(i).bounding_box() for i in range(articles.count())]
                assert any(abs(a["y"] - b["y"]) <= 1 and abs(a["x"] - b["x"]) > 1 for a, b in zip(grid, grid[1:])), "no two consecutive cards share a row"
                assert max(b["y"] + b["height"] for b in grid) <= plan["y"] + 1
            else:
                assert shown(menu)
                assert abs(boxes[0]["x"] - boxes[1]["x"]) <= 1
                assert min(b["y"] for b in boxes) >= rail["y"] + rail["height"] - 1
    release_door_stations(tenant, [first, second])


def test_door_phone_menu(browser: Browser, app_url: str) -> None:
    base = door_base(app_url)
    tenant = new_tenant(base, packs=1)
    booking = door_booking(tenant, any_time=True)
    with ui(browser, base) as page:
        page.set_viewport_size({"width": VIEWPORTS["narrow"][0], "height": VIEWPORTS["narrow"][1]})
        ui_sign_in(page, LEAD_EMAIL, LEAD_PASSWORD)
        wait_heading(page, "Board")
        card = door_card(page, tenant.business, booking)
        wait_for(page, lambda: shown(card) and "Cleared" in txt(card), "cleared door card on a phone")
        menu = page.get_by_role("button", name="Menu")
        assert attr(menu, "aria-expanded") == "false" and nav(page).count() == 0
        order = tab_order(page, 12)
        assert "Sign out" not in order and "Board" not in order, order
        click(menu)
        wait_for(page, lambda: attr(menu, "aria-expanded") == "true" and shown(nav(page)), "menu open")
        assert [t.strip() for t in nav(page).get_by_role("link").all_inner_texts()] == ["Board"]
        assert shown(page.get_by_role("button", name="Sign out"))
    release_door_stations(tenant, [booking])


def test_refund_races_claims(app_url: str, killbill: KillBill) -> None:
    rival = new_tenant(app_url, packs=1)
    target = rival.ok("GET", "/api/packs")["packs"][0]
    boss = owner(app_url)
    boss.ok("POST", "/api/session/confirm", {"password": OWNER_PASSWORD})
    slots: list[Slot] = []
    for _ in range(3):
        slots.append(find_slot(rival, avoid={s.day for s in slots}))
    calls = [lambda: boss.clone().call("POST", f"/api/packs/{target['id']}/refund", {"expectedCents": PRICE_CENTS[SMALL_PACK]})]
    calls += [(lambda s=s: claim(rival.clone(), s.body())) for s in slots]
    refund, *claims = fire(calls)
    refunds = kb_tx(kb_state(killbill, rival)[1], "REFUND")
    if refund.status_code == 200:
        assert all(c.status_code == 409 and c.json()["error"] == "insufficient_hours" for c in claims)
        assert len(refunds) == 1 and pack_detail(boss, target["id"])["status"] == "refunded"
    else:
        expect_error(refund, 409, "pack_in_use")
        assert refunds == []
        assert any(c.status_code == 201 and c.json()["packId"] == target["id"] for c in claims)
        assert pack_detail(boss, target["id"])["status"] == "active"


def test_role_table(app_url: str) -> None:
    a, b = new_tenant(app_url, packs=1), new_tenant(app_url, packs=1)
    a_booking, _ = confirmed(a)
    b_booking, _ = confirmed(b)
    a_pack = a.ok("GET", "/api/packs")["packs"][0]["id"]
    doc = a.ok("GET", "/api/documents")["documents"][0]["id"]
    today = kitchen_today(app_url)
    staff, boss, anon = lead(app_url), owner(app_url), Api(app_url)
    slot_body = find_slot(a).body()
    matrix = [
        (a, "GET", f"/api/door?date={today}", None, 403), (a, "POST", f"/api/bookings/{a_booking['id']}/check-in", None, 403),
        (a, "POST", f"/api/bookings/{b_booking['id']}/check-in", None, 404), (a, "POST", f"/api/packs/{a_pack}/refund", {"expectedCents": 0}, 403),
        (a, "GET", "/api/tenants", None, 403), (a, "GET", f"/api/tenants/{a.tenant_id}", None, 403), (a, "GET", f"/api/tenants/{b.tenant_id}", None, 404),
        (a, "GET", f"/api/reports/daily?date={today}", None, 403),
        (staff, "GET", f"/api/packs/{a_pack}", None, 403), (staff, "GET", f"/api/packs/{uuid.uuid4()}", None, 404), (staff, "GET", "/api/packs", None, 403),
        (staff, "GET", f"/api/documents/{doc}", None, 403), (staff, "GET", "/api/tenants", None, 403), (staff, "GET", f"/api/reports/daily?date={today}", None, 403),
        (staff, "POST", f"/api/bookings/{a_booking['id']}/cancel", None, 403), (staff, "GET", f"/api/door?date={today}", None, 200),
        (staff, "GET", f"/api/bookings/{a_booking['id']}", None, 200),
        (boss, "GET", "/api/packs", None, 403), (boss, "GET", f"/api/packs/{a_pack}", None, 200), (boss, "POST", f"/api/bookings/{a_booking['id']}/confirm", None, 403),
        (boss, "GET", f"/api/bookings/{uuid.uuid4()}", None, 404), (boss, "GET", "/api/tenants", None, 200), (boss, "GET", f"/api/door?date={today}", None, 200),
        (anon, "GET", "/api/me", None, 401), (anon, "GET", "/api/kitchen", None, 200), (anon, "GET", f"/api/floor?date={today}", None, 401),
    ]
    for who, method, path, body, status in matrix:
        response = who.call(method, path, body)
        assert response.status_code == status, f"{who.email or 'anon'} {method} {path}: {response.status_code}"
    for who in (staff, boss):
        expect_error(who.call("POST", "/api/bookings", slot_body, key=idempotency_key()), 403, "forbidden")
    expect_error(staff.call("POST", "/api/packs", {"hours": SMALL_PACK}, key=idempotency_key()), 403, "forbidden")
    expect_error(upload(boss, "food_handler_card", today + timedelta(days=9)), 403, "forbidden")


TENANT_BOOKING_KEYS = {"id", "stationId", "stationName", "shelfId", "shelfName", "start", "end", "bufferEnd", "status", "holdExpiresAt", "packId", "debitedMinutes",
                       "refundedMinutes", "cancelReason", "createdAt", "cutoffAt", "cancelCreditMinutes", "moveCount", "movable", "emails"}


def test_role_shaped_responses(app_url: str) -> None:
    a, b = new_tenant(app_url, packs=1), new_tenant(app_url)
    booking, slot = confirmed(a)
    assert set(b.me()) == {"id", "role", "email", "displayName", "tenant"}
    assert set(b.me()["tenant"]) == {"id", "businessName", "status", "suspendedReason"}
    raw = b.call("GET", f"/api/floor?date={slot.day}&from={hm(slot.start)}&to={hm(slot.end)}")
    floor = raw.json()
    for st in floor["stations"]:
        assert set(st) == {"id", "name", "kind", "cleanupMinutes", "col", "row", "intervals", "occupiedMinutes", "bufferMinutes", "freeMinutes"}
        assert all(set(iv) == {"start", "end", "bufferEnd", "mine"} for iv in st["intervals"])
    assert booking["id"] not in raw.text and a.business not in raw.text and a.email not in raw.text
    assert set(booking) == TENANT_BOOKING_KEYS
    staff = lead(app_url)
    assert set(staff.ok("GET", f"/api/bookings/{booking['id']}")) == TENANT_BOOKING_KEYS | {"tenantId", "tenantName", "doorLog", "cleanupNote"}
    staff_floor = staff.ok("GET", f"/api/floor?date={slot.day}")["stations"]
    assert all(set(iv) == {"start", "end", "bufferEnd", "bookingId", "status", "tenantId", "tenantName"} for st in staff_floor for iv in st["intervals"])
    entry = next(e for e in staff.ok("GET", f"/api/door?date={slot.day}")["entries"] if e["bookingId"] == booking["id"])
    assert set(entry) == {"bookingId", "tenantId", "tenantName", "stationId", "stationName", "shelfId", "shelfName", "start", "end", "status", "cleared",
                          "reason", "checkInOpensAt", "actions", "doorLog", "cleanupNote"}


def test_other_tenants_hidden(app_url: str) -> None:
    a, b = new_tenant(app_url, packs=1), new_tenant(app_url)
    booking, _ = confirmed(a)
    doc = upload(a, "food_handler_card", kitchen_today(app_url) + timedelta(days=99)).json()
    for path in (f"/api/documents/{doc['id']}", f"/api/documents/{doc['id']}/file", f"/api/bookings/{booking['id']}", f"/api/packs/{booking['packId']}",
                 f"/api/tenants/{a.tenant_id}", f"/api/documents?tenantId={a.tenant_id}"):
        expect_error(b.call("GET", path), 404, "not_found")
    expect_error(b.call("POST", f"/api/bookings/{booking['id']}/cancel"), 404, "not_found")
    assert a.ok("GET", f"/api/bookings/{booking['id']}")["status"] == "confirmed"


def test_wf_privacy_receipt(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    frm, to = DEFAULT_SPAN
    span = minute_of(to) - minute_of(frm)
    booking, slot = confirmed(tenant, starts=[frm], minutes=span)
    with ui(browser, app_url) as page:
        ui_session(page, tenant)
        open_board(page, tenant, slot.day, frm, to)
        click(ticket(page, booking).get_by_role("link", name="Receipt"))
        wait_heading(page, "Booking receipt")
        assert path_of(page) == f"/receipt/{booking['id']}"
        wait_for(page, lambda: "Confirmation email:" in page.evaluate("() => document.body.innerText"), "receipt record drawn")
        body = page.evaluate("() => document.body.innerText")
        for piece in (slot.station["name"], "None", frm, to, dur(span), "Confirmed", booking["id"], "Confirmation email:"):
            assert piece in body, piece
        assert re.search(dre(slot.day), body)
    with ui(browser, app_url, f"/receipt/{booking['id']}") as page:
        wait_for(page, lambda: path_of(page) == "/signin" and query(page).get("next") == f"/receipt/{booking['id']}", "Sign in with next")
        ui_sign_in(page, tenant.email, tenant.password)
        wait_heading(page, "Booking receipt")
        assert path_of(page) == f"/receipt/{booking['id']}"


def test_keys_belong_to_caller(app_url: str) -> None:
    a, b = new_tenant(app_url, packs=1), new_tenant(app_url, packs=1)
    key = idempotency_key()
    slot = find_slot(a)
    first = claim(a, slot.body(), key=key)
    assert first.status_code == 201
    other = claim(b, find_slot(b, avoid={slot.day}).body(), key=key)
    assert other.status_code == 201 and "Idempotent-Replay" not in other.headers and other.json()["id"] != first.json()["id"]
    again = sign_in(app_url, a.email, a.password)
    replay = claim(again, slot.body(), key=key)
    assert replay.status_code == 201 and replay.content == first.content and replay.headers.get("Idempotent-Replay") == "true"
    pack = again.call("POST", "/api/packs", {"hours": SMALL_PACK}, key=key)
    assert pack.status_code == 201 and pack.json()["hours"] == SMALL_PACK and "Idempotent-Replay" not in pack.headers


NEXT_CASES = {"backslash": "/\\evil.test", "encoded_slashes": "/%2F%2Fevil.test", "protocol_relative": "//evil.test", "absolute": "https://evil.test/board",
              "encoded_tab": "/packs%09evil.test", "uppercase_path": "/Packs", "other_role_screen": "/tenants", "other_tenant_receipt": "", "own_screen": "/packs"}


@pytest.mark.parametrize("case", list(NEXT_CASES), ids=list(NEXT_CASES))
def test_signin_next_rules(browser: Browser, app_url: str, case: str) -> None:
    tenant = new_tenant(app_url)
    raw = NEXT_CASES[case]
    forbid = "evil.test"
    if case == "other_tenant_receipt":
        rival = new_tenant(app_url, packs=1)
        booking, _ = confirmed(rival)
        raw, forbid = f"/receipt/{booking['id']}", booking["id"]
    foreign: list[str] = []
    with ui(browser, app_url, f"/signin?next={raw}") as page:
        page.on("request", lambda r: foreign.append(r.url) if not same_origin(r.url, app_url) and not r.url.startswith("data:") else None)
        page.evaluate("f => { window.__forbid = f }", forbid)
        ui_sign_in(page, tenant.email, tenant.password)
        want = "/packs" if case == "own_screen" else "/board"
        wait_for(page, lambda: path_of(page) == want, f"landing on {want}")
        wait_heading(page, "Hour packs" if want == "/packs" else "Board")
        assert foreign == []
        if case != "own_screen":
            assert forbid not in page.content() and not page.evaluate("() => window.__forbidSeen")


def test_wf_privacy_tenant_switch(browser: Browser, app_url: str, killbill: KillBill) -> None:
    first, second = new_tenant(app_url), new_tenant(app_url)
    buy(first, SMALL_PACK)
    with ui(browser, app_url) as page:
        keys: list[str] = []
        page.on("request", lambda r: keys.append(r.headers.get("idempotency-key", "")) if r.method == "POST" and r.url.endswith("/api/packs") else None)
        ui_session(page, first)
        page.goto(f"{app_url}/packs")
        wait_for(page, lambda: shown(page.get_by_role("heading", name=pack_heading(SMALL_PACK))), "first tenant's pack")
        page.route("**/api/packs", lambda r: r.abort() if r.request.method == "POST" else r.continue_())
        click(page.get_by_role("button", name=f"Buy {SMALL_PACK}-hour pack"))
        wait_for(page, lambda: shown(page.get_by_text("Retry purchase")), "open attempt")
        page.unroute("**/api/packs")
        click(page.get_by_role("button", name="Sign out"))
        ui_sign_in(page, second.email, second.password)
        wait_heading(page, "Board")
        click(nav(page).get_by_role("link", name="Hour packs"))
        wait_heading(page, "Hour packs")
        assert page.get_by_role("heading", name=pack_heading(SMALL_PACK)).count() == 0 and page.get_by_text("Retry purchase").count() == 0
        click(page.get_by_role("button", name=f"Buy {SMALL_PACK}-hour pack"))
        wait_for(page, lambda: shown(page.get_by_role("heading", name=pack_heading(SMALL_PACK))), "second tenant's new pack")
        assert len(keys) == 2 and keys[0] != keys[1]
    assert len(kb_state(killbill, first)[0]) == 1 and len(kb_state(killbill, second)[0]) == 1


def test_late_answers_ignored(browser: Browser, app_url: str) -> None:
    first, second = new_tenant(app_url), new_tenant(app_url)
    with ui(browser, app_url) as page:
        ui_session(page, first)
        page.goto(f"{app_url}/packs")
        wait_heading(page, "Hour packs")
        gate = Gate(page, "**/api/packs", method="GET")
        wait_for(page, lambda: len(gate.routes) >= 1, "a held packs refresh", FLOOR_VISIBLE + REFRESH_SLACK)
        gate.active = False
        click(page.get_by_role("button", name="Sign out"))
        ui_sign_in(page, second.email, second.password)
        wait_heading(page, "Board")
        gate.release()
        hold_for(page, 3, lambda: path_of(page) == "/board", "second tenant staying on the Board")
        assert announced(page, "Your session ended. Sign in again.") == 0


def test_cross_site_refused(app_url: str, killbill: KillBill) -> None:
    tenant = new_tenant(app_url, packs=1)
    booking, _ = confirmed(tenant)
    invoices = len(kb_state(killbill, tenant)[0])
    cases = ({"Origin": "null"}, {"Origin": EVIL_ORIGIN}, {"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site"}, {"Sec-Fetch-Site": "none"})
    message = "This request came from another site."
    for headers in cases:
        response = Api(app_url).call("POST", "/api/session", {"email": tenant.email, "password": tenant.password}, headers=headers)
        expect_error(response, 403, "cross_origin", message)
        assert session_token(response) is None
        for _ in range(SIGNIN_FAILURES + 1):
            expect_error(Api(app_url).call("POST", "/api/session", {"email": tenant.email, "password": WRONG_PASSWORD}, headers=headers), 403, "cross_origin")
        expect_error(tenant.call("POST", f"/api/bookings/{booking['id']}/cancel", headers=headers), 403, "cross_origin")
        expect_error(tenant.call("POST", "/api/packs", {"hours": SMALL_PACK}, key=idempotency_key(), headers=headers), 403, "cross_origin")
        expect_error(tenant.call("DELETE", "/api/session", headers=headers), 403, "cross_origin")
        expect_error(tenant.call("POST", "/api/session/confirm", {"password": tenant.password}, headers=headers), 403, "cross_origin")
    sign_in(app_url, tenant.email, tenant.password)
    assert tenant.me()["email"] == tenant.email
    assert tenant.ok("GET", f"/api/bookings/{booking['id']}")["status"] == "confirmed"
    assert len(tenant.ok("GET", "/api/packs")["packs"]) == 1 and len(kb_state(killbill, tenant)[0]) == invoices
    assert tenant.call("POST", "/api/session/confirm", {"password": tenant.password}, headers={"Origin": app_url, "Sec-Fetch-Site": "same-origin"}).status_code == 204


def test_back_after_tenant_switch(browser: Browser, app_url: str) -> None:
    first, second = new_tenant(app_url, packs=1), new_tenant(app_url)
    booking, _ = confirmed(first)
    with ui(browser, app_url) as page:
        ui_session(page, first)
        page.goto(f"{app_url}/board")
        wait_heading(page, "Board")
        click(nav(page).get_by_role("link", name="Hour packs"))
        wait_for(page, lambda: shown(page.get_by_role("heading", name=pack_heading(SMALL_PACK))), "first tenant's pack")
        page.evaluate("id => history.pushState({}, '', '/receipt/' + id)", booking["id"])
        page.evaluate("() => dispatchEvent(new PopStateEvent('popstate'))")
        wait_heading(page, "Booking receipt")
        click(nav(page).get_by_role("link", name="Board"))
        wait_heading(page, "Board")
        click(page.get_by_role("button", name="Sign out"))
        ui_sign_in(page, second.email, second.password)
        wait_heading(page, "Board")
        page.evaluate("f => { window.__forbid = f; window.__forbidSeen = false }", booking["id"])
        page.go_back()
        board = heading(page, "Board")
        wait_for(page, lambda: path_of(page) == "/board" and focused(board), "receipt entry replaced with the Board")
        assert not page.evaluate("() => window.__forbidSeen")
        page.go_back()
        wait_for(page, lambda: path_of(page) in ("/packs", "/board"), "previous entry")
        if path_of(page) == "/packs":
            wait_heading(page, "Hour packs")
            hold_for(page, 2, lambda: page.get_by_role("heading", name=pack_heading(SMALL_PACK)).count() == 0, "no first-tenant pack")


def test_wf_owner_ops_refund(browser: Browser, app_url: str, killbill: KillBill) -> None:
    tenant = new_tenant(app_url, packs=1)
    late = late_confirmed(tenant, minutes=SMALL_PACK * 60 - REFUND_EXAMPLE_MINUTES)
    tenant.ok("POST", f"/api/bookings/{late['id']}/cancel")
    with ui(browser, app_url) as page:
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/tenants/{tenant.tenant_id}")
        packs = page.get_by_role("region", name="Packs")
        wait_for(page, lambda: f"Refundable now {money(REFUND_EXAMPLE_CENTS)}" in txt(packs), "refundable amount")
        click(packs.get_by_role("button", name=refund_button(SMALL_PACK)))
        dialog = page.get_by_role("dialog", name="Confirm your password")
        wait_for(page, lambda: shown(dialog), "password dialog")
        fill(dialog.get_by_label("Password", exact=True), OWNER_PASSWORD)
        click(dialog.get_by_role("button", name="Confirm"))
        head = packs.get_by_role("heading", name=pack_heading(SMALL_PACK))
        copy = f"Refunded {money(REFUND_EXAMPLE_CENTS)} to {tenant.business}."
        wait_for(page, lambda: focused(head) and announced(page, copy) == 1, "refund success with focus on the pack heading")
        assert f"Refunded {money(REFUND_EXAMPLE_CENTS)}" in txt(packs)
    detail = pack_detail(tenant, late["packId"])
    assert detail["status"] == "refunded" and detail["balanceMinutes"] == 0
    assert_ledger(detail)
    assert len(kb_tx(kb_state(killbill, tenant)[1], "REFUND")) == 1
    other = buy(tenant, SMALL_PACK)
    boss = owner(app_url)
    boss.ok("POST", "/api/session/confirm", {"password": OWNER_PASSWORD})
    answers = fire([(lambda: boss.clone().call("POST", f"/api/packs/{other['id']}/refund", {"expectedCents": PRICE_CENTS[SMALL_PACK]})) for _ in range(5)])
    assert sorted(a.status_code for a in answers) == [200] + [409] * 4
    assert all(a.json()["error"] == "invalid_transition" for a in answers if a.status_code == 409)
    refunds = [t for t in kb_tx(kb_state(killbill, tenant)[1], "REFUND") if t.get("transactionExternalKey") == f"stationhouse-refund-{other['id']}"]
    assert len(refunds) == 1


def test_wf_owner_ops_report(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=2)
    paired, slot = confirmed(tenant, paired=True)
    boss = owner(app_url)
    report = boss.ok("GET", f"/api/reports/daily?date={slot.day}")
    rows = {r["stationId"]: r for r in report["stations"]}
    assert [r["stationId"] for r in report["stations"]] == list(SEED_STATIONS)
    assert rows[slot.station["id"]]["bookedMinutes"] >= MIN_BOOKING and rows[slot.shelf["id"]]["bookedMinutes"] >= MIN_BOOKING
    mine = next(t for t in report["tenants"] if t["tenantId"] == tenant.tenant_id)
    assert mine["bookedMinutes"] == 2 * MIN_BOOKING and mine["bookingCount"] == 1
    assert report["totalBookedMinutes"] == sum(r["bookedMinutes"] for r in report["stations"]) == sum(t["bookedMinutes"] for t in report["tenants"])
    with ui(browser, app_url) as page:
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/report?date={slot.day}")
        wait_for(page, lambda: shown(page.get_by_text(f"Total booked {dur(report['totalBookedMinutes'])}")), "report total")
        prev = page.get_by_role("button", name="Previous day")
        prev.focus()
        scroll = page.evaluate("() => window.scrollY")
        stations = tenant.ok("GET", f"/api/floor?date={slot.day}")["stations"]
        free = next(s for s in stations if s["kind"] != "cooler_shelf" and interval_free(s, slot.start, slot.end + timedelta(minutes=CLEANUP_MINUTES)))
        extra = claim(tenant, slot.body(station=free["id"])).json()
        tenant.ok("POST", f"/api/bookings/{extra['id']}/confirm")
        total = boss.ok("GET", f"/api/reports/daily?date={slot.day}")["totalBookedMinutes"]
        update = re.compile(rf"Daily usage for {dre(slot.day)} updated: Total booked {re.escape(dur(total))}\.")
        wait_for(page, lambda: shown(page.get_by_text(f"Total booked {dur(total)}")) and announced(page, update) == 1, "in-place report update", FLOOR_VISIBLE + REFRESH_SLACK)
        assert focused(prev) and page.evaluate("() => window.scrollY") == scroll and query(page)["date"] == slot.day.isoformat()


def test_screens_in_url(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url)
    day = kitchen_today(app_url) + timedelta(days=6)
    frm = clock(minute_of(DEFAULT_SPAN[0]) + 2 * HALF_HOUR)
    to = clock(minute_of(DEFAULT_SPAN[1]) + 2 * HALF_HOUR)
    off_grid = clock(minute_of(frm) + 15)
    with ui(browser, app_url, f"/board?date={day}&from={frm}&to={to}") as page:
        wait_for(page, lambda: query(page).get("next") == f"/board?date={day}&from={frm}&to={to}", "next carrying the deep link")
        ui_sign_in(page, tenant.email, tenant.password)
        wait_for(page, lambda: path_of(page) == "/board" and query(page).get("from") == frm, "deep link restored")
        page.reload()
        start = page.get_by_role("slider", name="Span start")
        wait_for(page, lambda: attr(start, "aria-valuetext") == frm and attr(page.get_by_role("slider", name="Span end"), "aria-valuetext") == to, "span after reload")
        click(page.get_by_role("button", name="Next day"))
        wait_for(page, lambda: query(page).get("date") == (day + timedelta(days=1)).isoformat(), "Next day in the URL")
        page.go_back()
        group = page.get_by_role("group", name="Kitchen date")
        wait_for(page, lambda: query(page).get("date") == day.isoformat() and re.search(dre(day), txt(group)) is not None, "Back restoring the date")
        length = page.evaluate("() => history.length")
        page.goto(f"{app_url}/board?date={day}&from={off_grid}&to={to}")
        wait_for(page, lambda: query(page).get("from") == DEFAULT_SPAN[0] and query(page).get("to") == DEFAULT_SPAN[1] and query(page).get("date") == day.isoformat(), "invalid span falling back to the default span")
        page.go_back()
        wait_for(page, lambda: query(page).get("from") == frm and query(page).get("date") == day.isoformat(), "Back skipping the fallback (no extra history entry)")
        page.goto(f"{app_url}/tenants")
        wait_for(page, lambda: path_of(page) == "/board", "tenant redirected from an owner screen")


def test_refund_amount_changed(browser: Browser, app_url: str, killbill: KillBill) -> None:
    tenant = new_tenant(app_url, packs=1)
    booking, _ = confirmed(tenant, minutes=SMALL_PACK * 60 - REFUND_EXAMPLE_MINUTES)
    boss = owner(app_url)
    boss.ok("POST", "/api/session/confirm", {"password": OWNER_PASSWORD})
    with ui(browser, app_url) as page:
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/tenants/{tenant.tenant_id}")
        packs = page.get_by_role("region", name="Packs")
        wait_for(page, lambda: f"Refundable now {money(REFUND_EXAMPLE_CENTS)}" in txt(packs), "pre-cancel amount")
        tenant.ok("POST", f"/api/bookings/{booking['id']}/cancel")
        button = packs.get_by_role("button", name=refund_button(SMALL_PACK))
        click(button)
        dialog = page.get_by_role("dialog", name="Confirm your password")
        wait_for(page, lambda: shown(dialog), "password dialog")
        fill(dialog.get_by_label("Password", exact=True), OWNER_PASSWORD)
        click(dialog.get_by_role("button", name="Confirm"))
        changed_copy = f"The refundable amount changed to {money(PRICE_CENTS[SMALL_PACK])}. Check it and press Refund again."
        wait_for(page, lambda: shown_copy(page, changed_copy) and f"Refundable now {money(PRICE_CENTS[SMALL_PACK])}" in txt(packs), "new amount after 412")
        assert announced(page, changed_copy) == 1 and focused(button)
        assert kb_tx(kb_state(killbill, tenant)[1], "REFUND") == [] and pack_detail(boss, booking["packId"])["status"] == "active"
        click(button)
        wait_for(page, lambda: pack_detail(boss, booking["packId"])["status"] == "refunded", "refund after the second press")
    expect_error(boss.call("POST", f"/api/packs/{buy(tenant)['id']}/refund", {"expectedCents": 1}), 412, "refund_amount_changed")
    assert [float(t["amount"]) for t in kb_tx(kb_state(killbill, tenant)[1], "REFUND")] == [PRICE_CENTS[SMALL_PACK] / 100]


def test_report_matches_url(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=1)
    _, slot = confirmed(tenant, minutes=minute_of(DEFAULT_SPAN[1]) - minute_of(DEFAULT_SPAN[0]))
    boss = owner(app_url)
    report = boss.ok("GET", f"/api/reports/daily?date={slot.day}")
    with ui(browser, app_url) as page:
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/report?date={slot.day}")
        total = f"Total booked {dur(report['totalBookedMinutes'])}"
        wait_for(page, lambda: shown(page.get_by_text(total)), "first date's total")
        nxt = (slot.day + timedelta(days=1)).isoformat()
        gate = Gate(page, "**/api/reports/daily*", method="GET", match=lambda u: nxt in u)
        click(page.get_by_role("button", name="Next day"))
        wait_for(page, lambda: len(gate.routes) >= 1, "held next-day report")
        page.go_back()
        wait_for(page, lambda: query(page).get("date") == slot.day.isoformat(), "Back to the first date")
        gate.release()
        bars = page.get_by_role("figure", name="Usage by station").locator("[data-station-id]")
        minutes = str(next(r["bookedMinutes"] for r in report["stations"] if r["stationId"] == slot.station["id"]))
        hold_for(page, 3, lambda: shown(page.get_by_text(total)) and attr(bars.nth(SEED_STATIONS.index(slot.station["id"])), "data-minutes") == minutes, "first date's figures")
        assert not shown_copy(page, "Couldn't reach the kitchen. Nothing changed; try again.")


def test_report_and_refund_announced_once(browser: Browser, app_url: str) -> None:
    boss = owner(app_url)
    day = kitchen_today(app_url) + timedelta(days=12)
    with ui(browser, app_url) as page:
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/report?date={day}")
        settled = re.compile(rf"Daily usage for {dre(day)}: Total booked [^.]+\.")
        wait_for(page, lambda: announced(page, settled) == 1, "first date announced")
        skipped = day + timedelta(days=1)
        click(page.get_by_role("button", name="Next day"))
        click(page.get_by_role("button", name="Next day"))
        final = day + timedelta(days=2)
        wait_for(page, lambda: announced(page, re.compile(rf"Daily usage for {dre(final)}: Total booked")) == 1, "final date announced")
        hold_for(page, 2, lambda: True, "settle")
        assert announced(page, re.compile(rf"Daily usage for {dre(skipped)}:")) <= 1 and announced(page, settled) == 1
    down = env_url("APP_KILLBILL_DOWN_URL")
    tenant = new_tenant(app_url)
    buy(tenant)
    with ui(browser, down) as page:
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{down}/tenants/{tenant.tenant_id}")
        button = page.get_by_role("button", name=refund_button(SMALL_PACK))
        wait_for(page, lambda: shown(button), "Refund button")
        click(button)
        dialog = page.get_by_role("dialog", name="Confirm your password")
        wait_for(page, lambda: shown(dialog), "password dialog")
        fill(dialog.get_by_label("Password", exact=True), OWNER_PASSWORD)
        click(dialog.get_by_role("button", name="Confirm"))
        copy = "Billing is unreachable. No refund was issued."
        wait_for(page, lambda: announced(page, copy) == 1 and focused(button), "billing-down copy with focus on Refund")
    assert pack_detail(boss, tenant.ok("GET", "/api/packs")["packs"][0]["id"])["status"] == "active"


def test_report_dates_kitchen_clock(browser: Browser, app_url: str) -> None:
    info = kitchen(app_url)
    today = date.fromisoformat(info["today"])
    with ui(browser, app_url) as page:
        page.clock.pause_at(P(info["now"]) + timedelta(days=4, hours=9))
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/report")
        wait_for(page, lambda: query(page).get("date") == today.isoformat(), "default report date")
        length = page.evaluate("() => history.length")
        page.goto(f"{app_url}/report?date=2026-02-30")
        wait_for(page, lambda: query(page).get("date") == today.isoformat(), "fallback for an invalid date")
        assert page.evaluate("() => history.length") == length + 1
        click(page.get_by_role("button", name="Next day"))
        wait_for(page, lambda: query(page).get("date") == (today + timedelta(days=1)).isoformat(), "Next day")
        click(page.get_by_role("button", name="Previous day"))
        click(page.get_by_role("button", name="Previous day"))
        wait_for(page, lambda: query(page).get("date") == (today - timedelta(days=1)).isoformat(), "Previous day twice")
        click(page.get_by_role("button", name="Today"))
        wait_for(page, lambda: query(page).get("date") == today.isoformat(), "Today")


def test_isometric_usage_bars(browser: Browser, app_url: str) -> None:
    tenant = new_tenant(app_url, packs=2)
    _, slot = confirmed(tenant, minutes=360)
    boss = owner(app_url)
    with ui(browser, app_url) as page:
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/report?date={slot.day}")
        report = boss.ok("GET", f"/api/reports/daily?date={slot.day}")
        figure = page.get_by_role("figure", name="Usage by station")
        bars = figure.locator("[data-station-id]")
        wait_for(page, lambda: bars.count() == len(SEED_STATIONS) and attr(bars.nth(0), "data-minutes") is not None, "ten bars")
        top = max(r["bookedMinutes"] for r in report["stations"])
        description = "; ".join(f"{r['stationName']}: {dur(r['bookedMinutes'])}" for r in report["stations"])
        assert described_by(figure) == description
        delays = []
        for i, row in enumerate(report["stations"]):
            bar = bars.nth(i)
            assert attr(bar, "data-station-id") == SEED_STATIONS[i] and attr(bar, "data-minutes") == str(row["bookedMinutes"])
            assert attr(bar, "data-height") == str(half_up(BAR_UNITS * row["bookedMinutes"], top) if top else 0)
            grown = [a for a in recorded_animations(bar) if a["duration"] == BAR_MS]
            assert grown, f"bar {SEED_STATIONS[i]} had no 600 ms Web Animation"
            delays.append(grown[0]["delay"] + (grown[0]["t"] or 0))
        steps = [b - a for a, b in zip(delays, delays[1:])]
        assert all(abs(s - BAR_STAGGER_MS) <= BAR_STAGGER_MS / 2 for s in steps), steps


def test_wf_expiry_notices_notice(browser: Browser, mail: Mailpit) -> None:
    short = env_url("APP_SHORT_URL")
    tenant = new_tenant(short, ins_days=0, food_days=7)
    info = kitchen(short)
    today = date.fromisoformat(info["today"])
    zone = re.escape(info["timeZone"])
    today_mail = text(await_mail(mail, tenant.email, r"Your certificate of insurance expires today")[0])
    assert re.search(rf"Expires: {dre(today)} at 23:59 {zone}", today_mail)
    assert re.search(rf"Bookings after {dre(today)} will be refused until a renewed document is on file\.", today_mail)
    week = today + timedelta(days=7)
    week_mail = text(await_mail(mail, tenant.email, r"Your food-handler card expires in 7 days")[0])
    assert re.search(rf"Expires: {dre(week)} at 23:59 {zone}", week_mail)
    with ui(browser, short) as page:
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{short}/tenants/{tenant.tenant_id}")
        docs = page.get_by_role("region", name="Documents")
        wait_for(page, lambda: re.search(r"Expires-today notice: Sent .+ \d{2}:\d{2}", txt(docs)) and re.search(r"7-day notice: Sent .+ \d{2}:\d{2}", txt(docs)), "Sent notice lines", FLOOR_VISIBLE + REFRESH_SLACK)


@pytest.mark.timeout(1200)
def test_notice_claimed_once(app_url: str, mail: Mailpit) -> None:
    tenant = new_tenant(app_url, ins_days=0, food_days=3)
    await_mail(mail, tenant.email, r"Your certificate of insurance expires today", count=1)
    assert upload(tenant, "insurance_certificate", kitchen_today(app_url) + timedelta(days=7)).status_code == 201
    await_mail(mail, tenant.email, r"Your certificate of insurance expires in 7 days", count=1)
    with app_copy({"EXPIRY_SWEEP_SECONDS": "1"}):
        await_mail(mail, tenant.email, r"Your certificate of insurance expires today", count=1, seconds=10)
    assert inbox(mail, tenant.email, r"Your food-handler card expires .*", settle=MAIL_SETTLE) == []
    docs = tenant.ok("GET", "/api/documents")["documents"]
    food = next(d for d in docs if d["kind"] == "food_handler_card")
    assert food["notices"] == []
    old = next(d for d in docs if d["kind"] == "insurance_certificate" and not d["current"])
    assert [n["point"] for n in old["notices"]] == ["today"]


def test_emails_only_own_facts(mail: Mailpit) -> None:
    short = env_url("APP_SHORT_URL")
    tenant, other = new_tenant(short, packs=1), new_tenant(short, ins_days=0)
    held, _ = hold(tenant)
    tenant.ok("POST", f"/api/bookings/{held['id']}/confirm")
    assert upload(tenant, "insurance_certificate", kitchen_today(short)).status_code == 201
    await_mail(mail, tenant.email, r"Your certificate of insurance expires today")
    await_mail(mail, tenant.email, r"Booking confirmed: .*")
    messages = inbox(mail, tenant.email, settle=MAIL_SETTLE)
    doc_ids = [d["id"] for d in tenant.ok("GET", "/api/documents")["documents"]]
    endpoint = urlparse(os.environ.get("S3_ENDPOINT", "")).hostname or "s3-endpoint"
    banned = ["http://", "https://", "www.", "tenants/", os.environ.get("S3_BUCKET", "bucket"), endpoint, "X-Amz-", other.email, other.contact, other.business] + doc_ids
    for message in messages:
        assert not message.get("Attachments")
        content = (message.get("Subject") or "") + text(message) + (message.get("HTML") or "")
        for token in banned:
            assert token.lower() not in content.lower(), f"{message.get('Subject')} contains {token!r}"


def test_notice_status_follows_mail(app_url: str) -> None:
    isolated = env_url("APP_MAILPIT_DOWN_ISOLATED_URL")
    tenant = new_tenant(isolated, ins_days=0)
    deadline = time.monotonic() + EXPIRY_WAIT
    notices: list[dict] = []
    while time.monotonic() < deadline:
        notices = [n for d in tenant.ok("GET", "/api/documents")["documents"] for n in d["notices"]]
        if notices:
            break
    else:
        pytest.fail("the sweep never claimed the expires-today point")
    assert notices == [{"point": "today", "status": "queued", "sentAt": None}]
    detail = owner(isolated).ok("GET", f"/api/tenants/{tenant.tenant_id}")
    assert [n["status"] for d in detail["documents"] for n in d["notices"]] == ["queued"]
    short = env_url("APP_SHORT_URL")
    cook = new_tenant(short, ins_days=0)
    deadline = time.monotonic() + MAIL_WAIT
    while time.monotonic() < deadline:
        sent = [n for d in cook.ok("GET", "/api/documents")["documents"] for n in d["notices"] if n["status"] == "sent"]
        if sent:
            assert sent[0]["point"] == "today" and P(sent[0]["sentAt"])
            break
    else:
        pytest.fail("notice never read sent with mail reachable")


def test_wf_expiry_notices_detail(browser: Browser, app_url: str) -> None:
    soon_days = 5
    tenant = new_tenant(app_url, ins_days=soon_days, food_days=0, packs=2)
    today = kitchen_today(app_url)
    upload(tenant, "food_handler_card", today, PNG_SIG + os.urandom(200), name="c.png", ctype="image/png")
    info = kitchen(app_url)
    with ui(browser, app_url) as page:
        page.clock.pause_at(P(info["now"]) + timedelta(days=3))
        files: list[str] = []
        page.on("request", lambda r: files.append(r.url) if r.url.endswith("/file") else None)
        ui_sign_in(page, OWNER_EMAIL, OWNER_PASSWORD)
        wait_heading(page, "Board")
        page.goto(f"{app_url}/tenants/{tenant.tenant_id}")
        docs, packs = page.get_by_role("region", name="Documents"), page.get_by_role("region", name="Packs")
        wait_for(page, lambda: f"Expires in {soon_days} days" in txt(docs) and "Expires today" in txt(docs) and "Superseded" in txt(docs), "server cover labels")
        states = {d["coverState"] for d in owner(app_url).ok("GET", f"/api/tenants/{tenant.tenant_id}")["documents"]}
        assert states == {"expires_soon", "expires_today", "superseded"}
        wait_for(page, lambda: f"Refundable now {money(PRICE_CENTS[SMALL_PACK])}" in txt(packs), "refundable amount")
        headings = packs.get_by_role("heading", name=re.compile(rf"^{SMALL_PACK}-hour pack #\d+$"))
        wait_for(page, lambda: headings.count() == 2, "two pack headings")
        first_number = int(re.search(r"#(\d+)$", headings.first.inner_text().strip()).group(1))
        assert first_number in (1, 2), first_number
        refund = packs.get_by_role("button", name=refund_button(SMALL_PACK)).first
        refund.focus()
        before_files, scroll = len(files), page.evaluate("() => window.scrollY")
        other_index = 1 if first_number == 1 else 0
        second = tenant.ok("GET", "/api/packs")["packs"][other_index]
        boss = owner(app_url)
        boss.ok("POST", "/api/session/confirm", {"password": OWNER_PASSWORD})
        boss.ok("POST", f"/api/packs/{second['id']}/refund", {"expectedCents": PRICE_CENTS[SMALL_PACK]})
        refunded = f"Refunded {money(PRICE_CENTS[SMALL_PACK])}"
        wait_for(page, lambda: refunded in txt(packs) and packs.get_by_role("button", name=refund_button(SMALL_PACK)).count() == 1,
                 "in-place refunded amount", FLOOR_VISIBLE + REFRESH_SLACK)
        assert focused(refund) and page.evaluate("() => window.scrollY") == scroll and len(files) == before_files


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in manifest.values())


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == [], f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"
    for asset in ("Archivo Narrow", "IBM Plex Sans", "IBM Plex Mono", "Lucide"):
        assert asset in notices, asset


def test_if_licences() -> None:
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert bad == [], bad


def test_if_no_extra_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "bull", "bullmq", "bee-queue", "kue", "nedb", "lowdb", "level", "memcached"}
    assert sorted(p.name for p in shipped_packages() if p.name in banned) == []


def test_if_services_unchanged(killbill: KillBill, mail: Mailpit) -> None:
    assert killbill.account_by_key(f"stationhouse-{uuid.uuid4()}") is None
    assert isinstance(mail.messages(0, settle=0), list)
    assert isinstance(S3().keys("tenants/"), list)


def test_if_typescript_strict() -> None:
    configs = [p for p in Path("/app").rglob("tsconfig*.json") if "node_modules" not in p.parts]
    assert configs, "no tsconfig found"
    texts = [c.read_text() for c in configs]
    assert any(re.search(r'"strict"\s*:\s*true', t) for t in texts)
    assert not any(re.search(r'"strict"\s*:\s*false', t) for t in texts)
