from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import secrets
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

import conftest
from conftest import (
    addresses,
    advance,
    axe,
    capture,
    changed,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    select,
    settle,
    text,
    unique,
)


CHICAGO = ZoneInfo("America/Chicago")
PASSWORD = "kitchen-demo-2026"
OPERATOR = "operator@larderrow.test"
J_OWNER = "owner@juniperrye.test"
J_COOK = "cook@juniperrye.test"
L_OWNER = "owner@lanterntacos.test"
L_COOK = "cook@lanterntacos.test"
S_OWNER = "owner@saltgrasspies.test"
F_OWNER = "owner@fennelferment.test"
J, L, S, F = "juniper-rye", "lantern-street", "saltgrass-pies", "fennel-ferment"
NAMES = {J: "Juniper & Rye Catering", L: "Lantern Street Tacos", S: "Saltgrass Pies", F: "Fennel Ferment Co."}
KITCHEN = "Larder Row Kitchen"
USERS = [
    (OPERATOR, "Dana Whitcomb", "operator", None),
    (J_OWNER, "Imani Brooks", "owner", J),
    (J_COOK, "Priya Castellanos", "cook", J),
    (L_OWNER, "Rafael Quintero", "owner", L),
    (L_COOK, "Teo Abernathy", "cook", L),
    (S_OWNER, "Hollis Grant", "owner", S),
]
STATIONS = {
    "hot-line-1": ("Hot Line 1", "hot_line", 3200),
    "hot-line-2": ("Hot Line 2", "hot_line", 3200),
    "bake-deck": ("Bake Deck", "bake_deck", 2800),
    "cold-prep-a": ("Cold-Prep Bench A", "cold_prep", 1800),
    "cold-prep-b": ("Cold-Prep Bench B", "cold_prep", 1800),
}
STATION_IDS = list(STATIONS)
SHELVES = ["W-1", "W-2", "W-3", "W-4"]
SHELF_RATE = 4500
PACKS = {"10h": ("10-hour pack", 600, 29000), "25h": ("25-hour pack", 1500, 68750)}
TAX_PERCENT = "8.25"
KIND_LABELS = {
    "certificate_of_insurance": "Certificate of insurance",
    "food_handler_card": "Food handler card",
    "health_permit": "Health permit",
}
SEED_FREE_HOURS = 48
SEED_LATE_PERCENT = 50
HOUR = 60
DAY_MINUTES = 1440
STEP = 15
MIN_LEN = 60
MAX_LEN = 480
MAX_WEEKS = 12
BOOK_AHEAD_DAYS = 365
DIAL_PAST_DAYS = 30
BUFFER = 30
GRACE = 10
HOLDOVER_MAX = 240
FREE_WINDOW_MAX = 168
PERCENT_MAX = 100
NOTES_MAX = 500
REASON_MAX = 500
HOLDER_MAX = 120
KEY_MAX = 100
FILE_CAP = 5_000_000
UPLOAD_CAP = 5_100_000
JSON_CAP = 65_536
SEARCH_CAP = 200
REMINDER_LEAD = 14
LINK_MIN = 10
LINK_MAX = 604_800
LINK_DAY = 86_400
SWEEP_DEFAULT_S = 60
FAR_DAYS = 8
ACK_MS = 100
SETTLE_MS = 500
TIME_OPTIONS = DAY_MINUTES // STEP + 1
LEDGER_REASONS = {"opening_balance", "pack_purchase", "booking", "cancellation_return", "fee_refund"}
LINE_ORDER = ["station_time", "holdover", "late_fee", "storage"]

USER_KEYS = {"id", "name", "email", "role", "tenant_id"}
TENANT_KEYS = {"id", "business_name", "status", "owner_name", "owner_email", "required_documents", "shelves", "hour_balance_minutes"}
STATION_KEYS = {"id", "name", "kind", "hourly_rate_cents"}
OP_BLOCK_KEYS = {"kind", "booking_id", "ref", "hold_ref", "status", "start_minute", "end_minute", "tenant_id", "tenant_name", "notes", "contact_email", "expires_at"}
OWN_BLOCK_KEYS = OP_BLOCK_KEYS - {"contact_email"}
ANON_BLOCK_KEYS = {"kind", "start_minute", "end_minute"}
BOOKING_KEYS = {"id", "ref", "hold_ref", "tenant_id", "station_id", "date", "start_local", "end_local", "start", "end", "elapsed_minutes", "status", "pay_with", "amount_cents", "policy", "notes", "checked_in_at", "checked_out_at", "holdover", "cancellation", "created_at"}
DOCUMENT_KEYS = {"id", "tenant_id", "kind", "holder_name", "expires_on", "status", "valid", "file_name", "content_type", "size_bytes", "uploaded_at", "reviewed_at", "rejection_reason"}
INVOICE_KEYS = {"id", "number", "tenant_id", "period", "status", "lines", "subtotal_cents", "tax_rate_percent", "tax_cents", "total_cents", "issued_at", "paid_at"}
INSPECT_KEYS = {"kitchen_name", "business_name", "expires_at", "documents"}
INSPECT_DOC_KEYS = {"id", "kind", "holder_name", "expires_on", "file_url"}
TENANT_CSV_HEADER = ["ref", "station", "date", "start", "end", "status", "payment", "amount", "notes"]
OPERATOR_CSV_HEADER = ["tenant", "ref", "station", "date", "start", "end", "status", "payment", "amount", "notes", "contact_email"]


HTTP_TIMEOUT = 60
POLL_S = 0.5
MAIL_DEADLINE = 2 * SWEEP_DEFAULT_S + 30
MAIL_SETTLE_S = 3
SWEEP_SETTLE_S = SWEEP_DEFAULT_S + 15
BOOT_DEADLINE = 180
STOP_DEADLINE = 15
LOG_TAIL = 4000
RELAY_CHUNK = 65536
SLOT_DAYS = 60
UI_DEADLINE = 40
QUICK_MS = 300
TICK_MS = 100
TTL_PROBE_S = 15
EXPIRY_WAIT_S = 90
NPM_TIMEOUT = 300
EXPORT_ATTEMPTS = 60
ARC_FROM = 480
ARC_TO = 900
ARC_MOVE_STEPS = 4
LATE_PROBE = 33
PAST_YEAR_FROM = 1971
PAST_YEARS = 50
UNKNOWN_API = "/api/no-such-route-"
TOKYO = "Asia/Tokyo"
DESKTOP = {"width": 1280, "height": 800}
VIEWPORTS = {
    "375x812": {"width": 375, "height": 812},
    "768x1024": {"width": 768, "height": 1024},
    "1280x800": {"width": 1280, "height": 800},
}
UPLOAD_CASES = ["pdf_named_txt", "jpeg", "png", "svg_named_png", "html_named_pdf", "zip_archive", "exact_cap", "over_cap"]

RNG = secrets.SystemRandom()
_tick = threading.Event()


def wait_for(probe: Callable[[], Any], seconds: float, message: str | Callable[[], str]) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = probe()
        if value:
            return value
        if time.monotonic() >= deadline:
            raise AssertionError(message() if callable(message) else message)
        _tick.wait(POLL_S)


def token(prefix: str) -> str:
    return re.sub(r"[^a-z0-9]", "", unique(prefix)[0].lower())


def past_period() -> str:
    past_period.handed_out = getattr(past_period, "handed_out", 0) + 1
    n = past_period.handed_out - 1
    return f"{PAST_YEAR_FROM + (n // 12) % PAST_YEARS}-{1 + n % 12:02d}"


def hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def hmm(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}"


def dollars(cents: int) -> str:
    return f"${cents // 100}.{cents % 100:02d}"


def half_up(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def tax_of(subtotal: int) -> int:
    return half_up(Decimal(subtotal) * Decimal(TAX_PERCENT) / 100)


def local_instant(d: date, minute: int) -> datetime:
    if minute >= DAY_MINUTES:
        d, minute = d + timedelta(days=1), minute - DAY_MINUTES
    return datetime(d.year, d.month, d.day, minute // 60, minute % 60, tzinfo=CHICAGO)


def real_minutes(d: date, start: int, end: int) -> int:
    a = local_instant(d, start).astimezone(timezone.utc)
    b = local_instant(d, end).astimezone(timezone.utc)
    return int((b - a).total_seconds() // 60)


def dst_day(d: date) -> bool:
    return local_instant(d, 0).utcoffset() != local_instant(d, 23 * 60).utcoffset()


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value)


def client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)


def login(base: str, email: str) -> httpx.Client:
    c = client(base)
    r = c.post("/api/session", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, f"sign-in {email}: {r.status_code} {r.text}"
    return c


def server_time(c: httpx.Client) -> datetime:
    return parsedate_to_datetime(c.get("/api/health").headers["date"])


def refused(r: httpx.Response, status: int, code: str) -> dict:
    where = f"{r.request.method} {r.request.url}"
    assert r.status_code == status, f"{where}: expected {status} {code}, got {r.status_code} {r.text[:400]}"
    body = r.json()
    assert set(body) == {"error"}, f"{where}: {body}"
    error = body["error"]
    assert error["code"] == code, f"{where}: {error}"
    assert isinstance(error["message"], str) and error["message"], error
    assert isinstance(error["details"], dict), error
    return error


def dial(c: httpx.Client, d: date | None = None) -> dict:
    r = c.get("/api/dial", params={"date": d.isoformat()} if d else None)
    assert r.status_code == 200, r.text
    return r.json()


def today_of(c: httpx.Client) -> date:
    return date.fromisoformat(dial(c)["today"])


def now_step(c: httpx.Client) -> tuple[date, int]:
    data = dial(c)
    return date.fromisoformat(data["today"]), data["now_minute"] // STEP * STEP


def station_blocks(c: httpx.Client, d: date, station: str) -> list[dict]:
    return next(s["blocks"] for s in dial(c, d)["stations"] if s["id"] == station)


class Slots:
    def __init__(self, op: httpx.Client) -> None:
        self.op = op
        self.cache: dict[date, dict[str, list[tuple[int, int]]]] = {}

    def intervals(self, d: date, station: str) -> list[tuple[int, int]]:
        if d not in self.cache:
            self.cache[d] = {
                s["id"]: [(b["start_minute"], b["end_minute"]) for b in s["blocks"]] for s in dial(self.op, d)["stations"]
            }
        return self.cache[d][station]

    def free(self, station: str, d: date, start: int, end: int) -> bool:
        return all(end + BUFFER <= s or start >= e + BUFFER for s, e in self.intervals(d, station))

    def free_at(self, station: str, d: date, minute: int) -> bool:
        return not any(s <= minute < e for s, e in self.intervals(d, station))


def doc_edge(op: httpx.Client, tenant: str) -> date:
    t = op.get(f"/api/tenants/{tenant}").json()
    dates = [v["expires_on"] for v in t["required_documents"].values()]
    assert all(dates), f"{tenant} lacks a required document: {t}"
    return min(date.fromisoformat(x) for x in dates)


def span(op: httpx.Client, tenant: str, after_days: int, before_days: int | None = None) -> tuple[date, date]:
    today = today_of(op)
    last = min(doc_edge(op, tenant), today + timedelta(days=BOOK_AHEAD_DAYS))
    if before_days is not None:
        last = min(last, today + timedelta(days=before_days))
    first = today + timedelta(days=after_days)
    assert first <= last, f"{tenant} has no bookable days between {first} and {last}"
    return first, last


def find_slot(
    op: httpx.Client,
    first: date,
    last: date,
    length: int,
    *,
    weeks: int = 1,
    stations: list[str] | None = None,
    starts: Any = None,
    free_at: tuple[int, ...] = (),
) -> tuple[str, date, int]:
    slots = Slots(op)
    days = [first + timedelta(days=n) for n in range((last - first).days + 1)]
    RNG.shuffle(days)
    for d in days[:SLOT_DAYS]:
        occurrences = [d + timedelta(days=7 * k) for k in range(weeks)]
        if occurrences[-1] > last or any(dst_day(x) for x in occurrences):
            continue
        names = list(stations or STATION_IDS)
        RNG.shuffle(names)
        options = list(starts) if starts is not None else list(range(0, DAY_MINUTES - length + 1, STEP))
        RNG.shuffle(options)
        for st in names:
            if not all(slots.free_at(st, d, m) for m in free_at):
                continue
            for s in options:
                if s + length <= DAY_MINUTES and all(slots.free(st, x, s, s + length) for x in occurrences):
                    return st, d, s
    pytest.fail(f"no free {length}-minute slot x{weeks} between {first} and {last}")


def place(c: httpx.Client, station: str, d: date, start: int, end: int, *, weeks: int = 1, notes: str = "", tenant: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"station_id": station, "date": d.isoformat(), "start_local": hhmm(start), "end_local": hhmm(end), "weeks": weeks, "notes": notes}
    if tenant:
        body["tenant_id"] = tenant
    return c.post("/api/holds", json=body)


def hold(c: httpx.Client, *args: Any, **kwargs: Any) -> dict:
    r = place(c, *args, **kwargs)
    assert r.status_code == 201, r.text
    return r.json()


def confirm(c: httpx.Client, ref: str, pay: str = "account", key: str | None = None) -> httpx.Response:
    return c.post(f"/api/holds/{ref}/confirm", json={"pay_with": pay}, headers={"Idempotency-Key": key or idempotency_key()})


def book(c: httpx.Client, *args: Any, pay: str = "account", **kwargs: Any) -> list[dict]:
    h = hold(c, *args, **kwargs)
    r = confirm(c, h["ref"], pay)
    assert r.status_code == 200, r.text
    return r.json()["bookings"]


def release(c: httpx.Client, ref: str) -> None:
    c.delete(f"/api/holds/{ref}")


def cancel_all(c: httpx.Client, bookings: list[dict]) -> None:
    for b in bookings:
        c.post(f"/api/bookings/{b['id']}/cancel", json={})


def booking(c: httpx.Client, booking_id: str) -> dict:
    r = c.get(f"/api/bookings/{booking_id}")
    assert r.status_code == 200, r.text
    return r.json()


def book_today(op: httpx.Client, owner: httpx.Client) -> tuple[dict, str] | None:
    for _ in range(2):
        today, step = now_step(op)
        if step + MIN_LEN > DAY_MINUTES:
            return None
        slots = Slots(op)
        for st in STATION_IDS:
            if not slots.free(st, today, step, step + MIN_LEN):
                continue
            r = place(owner, st, today, step, step + MIN_LEN)
            if r.status_code == 201:
                c = confirm(owner, r.json()["ref"])
                assert c.status_code == 200, c.text
                return c.json()["bookings"][0], st
    pytest.fail("no station is free for an hour from the current kitchen step")


def ledger(c: httpx.Client, tenant: str | None = None) -> dict:
    r = c.get("/api/hour-ledger", params={"tenant_id": tenant} if tenant else None)
    assert r.status_code == 200, r.text
    return r.json()


def buy(c: httpx.Client, pack: str = "10h", key: str | None = None) -> httpx.Response:
    return c.post("/api/hour-packs/purchase", json={"pack_id": pack}, headers={"Idempotency-Key": key or idempotency_key()})


def ensure_hours(owner: httpx.Client, minutes: int) -> None:
    balance = ledger(owner)["balance_minutes"]
    while balance < minutes:
        r = buy(owner)
        assert r.status_code == 201, r.text
        balance = r.json()["balance_minutes"]


def policy_now(c: httpx.Client) -> dict:
    return c.get("/api/cancellation-policy").json()["current"]


def save_policy(op: httpx.Client, free_hours: int, late_percent: int) -> dict:
    current = policy_now(op)
    r = op.put("/api/cancellation-policy", json={"free_window_hours": free_hours, "late_fee_percent": late_percent, "based_on_version": current["version"]})
    assert r.status_code == 201, r.text
    return r.json()


def issue(op: httpx.Client, tenant: str, period: str) -> httpx.Response:
    return op.post("/api/invoices", json={"tenant_id": tenant, "period": period})


def invoices_for(c: httpx.Client, tenant: str, period: str) -> list[dict]:
    return [i for i in c.get("/api/invoices", params={"tenant_id": tenant}).json()["invoices"] if i["period"] == period]


def multipart(fields: dict[str, str], file_name: str | None, data: bytes | None, ctype: str) -> tuple[bytes, str]:
    boundary = "----stationkeeper" + secrets.token_hex(12)
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
    if file_name is not None and data is not None:
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\nContent-Type: {ctype}\r\n\r\n'
        parts.append(head.encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def upload(c: httpx.Client, kind: str, expires_on: date, data: bytes | None, *, file_name: str | None = "document.pdf", ctype: str = "application/pdf", holder: str | None = None, tenant: str | None = None) -> httpx.Response:
    fields = {"kind": kind, "expires_on": expires_on.isoformat()}
    if holder is not None:
        fields["holder_name"] = holder
    if tenant is not None:
        fields["tenant_id"] = tenant
    body, ct = multipart(fields, file_name, data, ctype)
    return c.post("/api/documents", content=body, headers={"Content-Type": ct})


def pdf(marker: str) -> bytes:
    return b"%PDF-1.4\n%" + marker.encode() + b"\n%%EOF\n"


def documents(c: httpx.Client, tenant: str | None = None) -> list[dict]:
    r = c.get("/api/documents", params={"tenant_id": tenant} if tenant else None)
    assert r.status_code == 200, r.text
    return r.json()["documents"]


def approved_doc(op: httpx.Client, owner: httpx.Client, kind: str, expires_on: date, holder: str | None = None, tenant: str | None = None) -> dict:
    c = op if tenant else owner
    r = upload(c, kind, expires_on, pdf(token("doc")), holder=holder, tenant=tenant)
    assert r.status_code == 201, r.text
    a = op.post(f"/api/documents/{r.json()['id']}/approve", json={})
    assert a.status_code == 200, a.text
    return a.json()


@pytest.fixture(scope="module")
def bucket() -> Any:
    return conftest.S3()


def mail_key(m: dict) -> str:
    return str(m.get("ID") or m.get("MessageID") or json.dumps(m, sort_keys=True, default=str))


def inbox(mail: Any, settle: float = 0) -> list[dict]:
    return mail.messages(0, settle=settle)


def seen(mail: Any) -> set[str]:
    return {mail_key(m) for m in inbox(mail)}


def matching(messages: list[dict], to: str, subject: str, contains: tuple[str, ...] = (), since: set[str] | frozenset = frozenset()) -> list[dict]:
    return [
        m for m in messages
        if m.get("Subject") == subject and to in addresses(m.get("To")) and mail_key(m) not in since and all(s in text(m) for s in contains)
    ]


def await_mail(mail: Any, to: str, subject: str, *, contains: tuple[str, ...] = (), since: set[str] | frozenset = frozenset(), seconds: float = MAIL_DEADLINE) -> list[dict]:
    return wait_for(lambda: matching(inbox(mail), to, subject, contains, since), seconds, f"no email {subject!r} to {to}")


def settled(mail: Any, to: str, subject: str, *, since: set[str] | frozenset = frozenset(), settle: float = MAIL_SETTLE_S) -> list[dict]:
    return matching(inbox(mail, settle), to, subject, since=since)


def kb_transactions(killbill: Any, tenant: str, predicate: Callable[[str], bool]) -> list[dict]:
    account = killbill.account_by_key(tenant)
    if not account:
        return []
    found = []
    for payment in killbill.payments(account["accountId"]):
        for tx in payment.get("transactions") or []:
            if predicate(str(tx.get("transactionExternalKey") or "")):
                found.append(tx)
    return found


def kb_cents(tx: dict) -> int:
    return half_up(Decimal(str(tx["amount"])) * 100)


def kb_items(killbill: Any, tenant: str) -> list[dict]:
    account = killbill.account_by_key(tenant)
    if not account:
        return []
    headers = {
        "X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
        "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
        "Accept": "application/json",
    }
    auth = (os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"])
    items: list[dict] = []
    with httpx.Client(base_url=os.environ["KILLBILL_URL"].rstrip("/"), headers=headers, auth=auth, timeout=HTTP_TIMEOUT) as kb:
        listed = kb.get(f"/1.0/kb/accounts/{account['accountId']}/invoices", params={"withItems": "true", "includeInvoiceComponents": "true"})
        assert listed.status_code == 200, listed.text
        for invoice in listed.json():
            found = invoice.get("items")
            if not found:
                full = kb.get(f"/1.0/kb/invoices/{invoice['invoiceId']}")
                assert full.status_code == 200, full.text
                found = full.json().get("items") or []
            items += [i for i in found if i.get("itemType") != "CBA_ADJ"]
    return items


def item_cents(item: dict) -> int:
    return abs(half_up(Decimal(str(item["amount"])) * 100))


def kb_described(killbill: Any, tenant: str, description: str) -> list[dict]:
    return [i for i in kb_items(killbill, tenant) if i.get("description") == description]


def kb_net(killbill: Any, tenant: str, description: str) -> int:
    items = kb_items(killbill, tenant)
    made = sum(1 for i in items if i.get("description") == description)
    reversed_ = sum(1 for i in items if i.get("description") == f"Reversal: {description}")
    return made - reversed_


def _drop(s: socket.socket) -> None:
    try:
        s.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    s.close()


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.up = False
        self.lock = threading.Lock()
        self.open: list[socket.socket] = []
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(128)
        self.port = self.server.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self) -> None:
        while True:
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            if not self.up:
                _drop(conn)
                continue
            threading.Thread(target=self._bridge, args=(conn,), daemon=True).start()

    def _bridge(self, conn: socket.socket) -> None:
        try:
            upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
        except OSError:
            _drop(conn)
            return
        upstream.settimeout(None)
        with self.lock:
            self.open += [conn, upstream]
        for a, b in ((conn, upstream), (upstream, conn)):
            threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(a: socket.socket, b: socket.socket) -> None:
        try:
            while data := a.recv(RELAY_CHUNK):
                b.sendall(data)
        except OSError:
            pass
        finally:
            _drop(a)
            _drop(b)

    def set(self, up: bool) -> None:
        self.up = up
        if not up:
            with self.lock:
                sockets, self.open = self.open, []
            for s in sockets:
                _drop(s)

    def close(self) -> None:
        self.set(False)
        _drop(self.server)


def endpoint(url: str) -> tuple[str, int]:
    p = urlsplit(url)
    return str(p.hostname), p.port or (443 if p.scheme == "https" else 80)


def via(url: str, relay: Relay) -> str:
    p = urlsplit(url)
    return urlunsplit((p.scheme, f"127.0.0.1:{relay.port}", p.path, p.query, p.fragment))


@contextmanager
def app_copy(env: dict[str, str]) -> Iterator[str]:
    deployed = Path(conftest.DEPLOYED_APP)
    manifest = json.loads((deployed / "run.json").read_text())
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    log = tempfile.NamedTemporaryFile("w+b", prefix="stationkeeper-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(
        manifest["serve"], shell=True, cwd=deployed, env={**os.environ, **env, "APP_PUBLIC_PORT": str(port)},
        stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
    )
    url = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_bytes()[-LOG_TAIL:].decode(errors="replace")

    def healthy() -> bool:
        if proc.poll() is not None:
            raise AssertionError(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            return httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        wait_for(healthy, BOOT_DEADLINE, lambda: f"app copy never answered health:\n{tail()}")
        yield url
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=STOP_DEADLINE)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        except ProcessLookupError:
            pass
        log.close()


@pytest.fixture(scope="module")
def relayed() -> Iterator[SimpleNamespace]:
    kb = Relay(*endpoint(os.environ["KILLBILL_URL"]))
    s3 = Relay(*endpoint(os.environ["S3_ENDPOINT"]))
    smtp = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    env = {
        "KILLBILL_URL": via(os.environ["KILLBILL_URL"], kb),
        "S3_ENDPOINT": via(os.environ["S3_ENDPOINT"], s3),
        "SMTP_HOST": "127.0.0.1",
        "SMTP_PORT": str(smtp.port),
    }
    try:
        with app_copy(env) as url:
            boot = httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT)
            booted = boot.status_code == 200 and boot.json() == {"status": "ok"}
            for r in (kb, s3, smtp):
                r.set(True)
            yield SimpleNamespace(url=url, kb=kb, s3=s3, smtp=smtp, booted_while_down=booted)
    finally:
        for r in (kb, s3, smtp):
            r.close()


@pytest.fixture(scope="module")
def short_hold_app() -> Iterator[str]:
    with app_copy({"HOLD_TTL_SECONDS": str(TTL_PROBE_S)}) as url:
        yield url


@contextmanager
def ui(browser: Browser, url: str, *, reduced: bool = False, size: dict | None = None) -> Iterator[Page]:
    with open_app(browser, url, reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size(size or DESKTOP)
        yield page


def eventually(page: Page, assertion: Callable[[], None], seconds: float = UI_DEADLINE) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            assertion()
            return
        except AssertionError:
            if time.monotonic() >= deadline:
                raise
        advance(page, TICK_MS)


def shows(page: Page, loc: Locator, seconds: float = UI_DEADLINE) -> None:
    eventually(page, lambda: expect(loc).to_be_visible(timeout=QUICK_MS), seconds)


def says(page: Page, loc: Locator, pattern: str | re.Pattern, seconds: float = UI_DEADLINE) -> None:
    eventually(page, lambda: expect(loc).to_contain_text(pattern, timeout=QUICK_MS), seconds)


def activity(page: Page) -> Locator:
    return page.get_by_role("status", name="Activity")


def problem(page: Page) -> Locator:
    return page.get_by_role("alert", name="Problem")


def slider(page: Page) -> Locator:
    return page.get_by_role("slider", name="Service dial")


def nav_to(page: Page, name: str) -> None:
    nav = page.get_by_role("navigation", name="Main")
    if not nav.get_by_role("link", name=name, exact=True).is_visible():
        click(page.get_by_role("button", name="Menu"))
    click(nav.get_by_role("link", name=name, exact=True))


def ui_signin(page: Page, base: str, email: str) -> None:
    page.goto(base + "/signin")
    shows(page, page.get_by_role("button", name="Sign in"))
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password", exact=True), PASSWORD)
    click(page.get_by_role("button", name="Sign in"))
    shows(page, slider(page))


def ui_day(page: Page, d: date) -> None:
    fill(page.get_by_label("Day", exact=True), d.isoformat())
    eventually(page, lambda: expect(page.get_by_label("Day", exact=True)).to_have_value(d.isoformat(), timeout=QUICK_MS))


def ui_minute(page: Page, minute: int) -> None:
    dial_slider = slider(page)
    dial_slider.focus()
    page.keyboard.press("Home")
    for _ in range(minute // 60):
        page.keyboard.press("PageUp")
    for _ in range(minute % 60 // STEP):
        page.keyboard.press("ArrowRight")
    eventually(page, lambda: expect(dial_slider).to_have_attribute("aria-valuenow", str(minute), timeout=QUICK_MS))


def tile(page: Page, station: str, state: str) -> Locator:
    name = f"{STATIONS[station][0]}, {state}"
    return page.get_by_role("group", name="Floor plan").get_by_role("button", name=name, exact=True)


def any_tile(page: Page, station: str) -> Locator:
    name = re.compile(rf"^{re.escape(STATIONS[station][0])}, ")
    return page.get_by_role("group", name="Floor plan").get_by_role("button", name=name)


def select_free(page: Page, station: str) -> None:
    t = tile(page, station, "free")
    shows(page, t)
    click(t)
    eventually(page, lambda: expect(t).to_have_attribute("aria-pressed", "true", timeout=QUICK_MS))


def hold_region(page: Page) -> Locator:
    return page.get_by_role("region", name=re.compile(r"^Hold SK-\d+$"))


def ui_hold_by_form(page: Page, station: str) -> str:
    select_free(page, station)
    click(page.get_by_role("button", name="Hold this station"))
    dlg = page.get_by_role("dialog", name="Place hold")
    shows(page, dlg)
    click(dlg.get_by_role("button", name="Place hold"))
    shows(page, hold_region(page))
    says(page, activity(page), re.compile(r"Hold SK-\d+ placed\."))
    return re.search(r"Hold (SK-\d+) placed", activity(page).inner_text()).group(1)


def focused(loc: Locator) -> bool:
    return loc.count() == 1 and bool(loc.evaluate("el => el === document.activeElement"))


def tab_to(page: Page, loc: Locator, limit: int = 80) -> None:
    for _ in range(limit):
        if focused(loc):
            return
        page.keyboard.press("Tab")
        advance(page, TICK_MS)
    raise AssertionError(f"Tab never reached {loc}")


def own_hold(c: httpx.Client, d: date, station: str, start: int, end: int) -> dict | None:
    return next((b for b in station_blocks(c, d, station) if b["kind"] == "hold" and b["start_minute"] == start and b["end_minute"] == end), None)


def test_health_and_serve_manifest(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    with app_copy({}) as url:
        r = httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert login(url, OPERATOR).get("/api/session").json()["user"]["email"] == OPERATOR


def test_sign_in_and_session(app_url):
    for email, name, role, tenant in USERS:
        c = client(app_url)
        r = c.post("/api/session", json={"email": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        assert set(r.json()) == {"user"}
        user = r.json()["user"]
        assert set(user) == USER_KEYS
        assert (user["email"], user["name"], user["role"], user["tenant_id"]) == (email, name, role, tenant)
        cookie = " ".join(r.headers.get_list("set-cookie")).lower()
        assert "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie, cookie
        assert c.get("/api/session").json()["user"]["id"] == user["id"]
        assert c.delete("/api/session").status_code == 204
        refused(c.get("/api/session"), 401, "unauthenticated")
    anon = client(app_url)
    refused(anon.post("/api/session", json={"email": J_OWNER, "password": PASSWORD + "x"}), 401, "invalid_credentials")
    refused(anon.post("/api/session", json={"email": token("nobody") + "@larderrow.test", "password": PASSWORD}), 401, "invalid_credentials")
    refused(anon.get("/api/session"), 401, "unauthenticated")


def test_role_matrix(app_url):
    op, jo, jc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    h = hold(jo, st, d, s, s + MIN_LEN)
    bid = h["bookings"][0]["id"]
    w3_before = next(x for x in op.get("/api/shelves").json()["shelves"] if x["id"] == "W-3")["tenant_id"]
    policy_before = policy_now(op)["version"]
    try:
        cases = [
            (jc, "POST", f"/api/bookings/{bid}/cancel", {}, None),
            (jo, "POST", f"/api/bookings/{bid}/no-show", {}, None),
            (jo, "POST", f"/api/bookings/{bid}/refund-fee", {}, None),
            (jc, "GET", "/api/hour-packs", None, None),
            (jc, "GET", "/api/hour-ledger", None, None),
            (jc, "GET", "/api/documents", None, None),
            (jc, "GET", "/api/invoices", None, None),
            (jc, "GET", "/api/shelves", None, None),
            (jo, "PUT", "/api/cancellation-policy", {"free_window_hours": 1, "late_fee_percent": 1, "based_on_version": policy_before}, None),
            (jo, "POST", "/api/invoices", {"tenant_id": J, "period": past_period()}, None),
            (jo, "PUT", f"/api/shelves/{SHELVES[2]}", {"tenant_id": J}, None),
            (jo, "POST", f"/api/tenants/{J}/activate", {}, None),
            (jo, "POST", f"/api/tenants/{J}/offboard", {}, None),
            (jo, "POST", f"/api/tenants/{J}/inspection-link", {"expires_in_seconds": LINK_DAY}, None),
            (op, "POST", "/api/hour-packs/purchase", {"pack_id": "10h"}, idempotency_key()),
        ]
        for c, method, path, body, key in cases:
            headers = {"Idempotency-Key": key} if key else {}
            r = c.request(method, path, json=body, headers=headers) if body is not None else c.request(method, path, headers=headers)
            refused(r, 403, "forbidden")
        assert jo.get(f"/api/holds/{h['ref']}").status_code == 200
        assert booking(jo, bid)["status"] == "held"
        assert next(x for x in op.get("/api/shelves").json()["shelves"] if x["id"] == "W-3")["tenant_id"] == w3_before
        assert policy_now(op)["version"] == policy_before
        assert jc.get("/api/dial").status_code == 200
        assert jc.get("/api/cancellation-policy").status_code == 200
        assert [t["id"] for t in jc.get("/api/tenants").json()["tenants"]] == [J]
        assert jo.get("/api/hour-packs").status_code == 200
        assert {J, L, S, F} <= {t["id"] for t in op.get("/api/tenants").json()["tenants"]}
    finally:
        release(jo, h["ref"])


def test_error_shape_and_precedence(app_url):
    op, jo, jc, anon = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK), client(app_url)
    refused(jo.get(UNKNOWN_API + token("probe")), 404, "not_found")
    refused(anon.put("/api/health", json={}), 405, "method_not_allowed")
    refused(anon.get(f"/api/bookings/{uuid.uuid4()}"), 401, "unauthenticated")
    l_doc = documents(op, L)[0]["id"]
    j_doc = documents(op, J)[0]["id"]
    refused(jc.get(f"/api/documents/{l_doc}"), 404, "not_found")
    refused(jc.get(f"/api/documents/{j_doc}"), 403, "forbidden")
    refused(jo.put("/api/cancellation-policy", json={}), 403, "forbidden")
    refused(op.post("/api/hour-packs/purchase", json={"pack_id": "10h"}), 403, "forbidden")
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    h = hold(jo, st, d, s, s + MIN_LEN)
    try:
        refused(jo.post(f"/api/holds/{h['ref']}/confirm", json={"pay_with": "bogus"}), 400, "idempotency_key_required")
        refused(jo.post("/api/holds", content=b"{}", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
        e = refused(place(jo, st, d, s, s + MIN_LEN // 2), 422, "validation_failed")
        assert e["details"] and all(isinstance(v, str) and v for v in e["details"].values())
        e = refused(place(jo, st, d, s + MIN_LEN, s), 422, "validation_failed")
        assert "end_local" in e["details"]
    finally:
        release(jo, h["ref"])


def test_server_boundary(app_url, bucket):
    jo = login(app_url, J_OWNER)
    bad = "http://elsewhere.invalid"
    cred = {"email": J_OWNER, "password": PASSWORD}
    refused(httpx.post(app_url + "/api/session", json=cred, headers={"Origin": bad}, timeout=HTTP_TIMEOUT), 403, "cross_origin")
    refused(httpx.delete(app_url + "/api/session", headers={"Origin": bad}, timeout=HTTP_TIMEOUT), 403, "cross_origin")
    p = urlsplit(app_url)
    same = f"{p.scheme}://{p.netloc}"
    assert httpx.post(app_url + "/api/session", json=cred, headers={"Origin": same}, timeout=HTTP_TIMEOUT).status_code == 200

    def body_of(size: int) -> bytes:
        payload = {"station_id": "hot-line-1", "date": "2000-01-01", "start_local": "10:00", "end_local": "11:00", "notes": ""}
        payload["notes"] = "x" * (size - len(json.dumps(payload).encode()))
        raw = json.dumps(payload).encode()
        assert len(raw) == size
        return raw

    headers = {"Content-Type": "application/json"}
    refused(jo.post("/api/holds", content=body_of(JSON_CAP), headers=headers), 422, "validation_failed")
    refused(jo.post("/api/holds", content=body_of(JSON_CAP + 1), headers=headers), 413, "body_too_large")
    holder = "Holder " + token("big")
    prefix = f"tenants/{J}/documents/"
    before = set(bucket.keys(prefix))
    big = b"%PDF-" + b"0" * (UPLOAD_CAP - len(b"%PDF-"))
    refused(upload(jo, "food_handler_card", today_of(jo) + timedelta(days=300), big, holder=holder), 413, "file_too_large")
    assert set(bucket.keys(prefix)) == before
    assert not [x for x in documents(jo) if x["holder_name"] == holder]
    for path in ["/run.json", "/package-lock.json", "/.env", "/.gitignore"]:
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT).status_code == 404, path


def test_billing_outage_scope(app_url, killbill):
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    r = httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    jo_down = login(down, J_OWNER)
    dial(jo_down)
    ensure_hours(jo, MIN_LEN)
    before = ledger(jo)["balance_minutes"]
    packs_before = len(kb_transactions(killbill, J, lambda k: k.startswith("pack-")))
    refused(buy(jo_down), 503, "billing_unavailable")
    assert ledger(jo)["balance_minutes"] == before
    assert len(kb_transactions(killbill, J, lambda k: k.startswith("pack-"))) == packs_before
    first, last = span(op, J, FAR_DAYS)
    st, d, s = find_slot(op, first, last, MIN_LEN)
    h = hold(jo_down, st, d, s, s + MIN_LEN)
    c = confirm(jo_down, h["ref"], "hour_pack")
    assert c.status_code == 200, c.text
    pack_booking = c.json()["bookings"][0]
    assert pack_booking["status"] == "confirmed"
    x = jo_down.post(f"/api/bookings/{pack_booking['id']}/cancel", json={})
    assert x.status_code == 200 and x.json()["status"] == "cancelled", x.text
    st, d, s = find_slot(op, first, last, MIN_LEN)
    account = book(jo, st, d, s, s + MIN_LEN)[0]
    try:
        refused(jo_down.post(f"/api/bookings/{account['id']}/cancel", json={}), 503, "billing_unavailable")
        assert booking(jo, account["id"])["status"] == "confirmed"
    finally:
        cancel_all(jo, [account])


def test_storage_outage_scope(app_url, bucket):
    down = os.environ["APP_MINIO_DOWN_URL"]
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    jo_down, op_down = login(down, J_OWNER), login(down, OPERATOR)
    assert httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    dial(jo_down)
    assert jo_down.get("/api/bookings").status_code == 200
    assert documents(jo_down)
    doc = next(x for x in documents(jo) if x["status"] == "approved")
    refused(jo_down.get(f"/api/documents/{doc['id']}/file"), 503, "storage_unavailable")
    assert jo.get(f"/api/documents/{doc['id']}/file").status_code == 200
    inv = issue(op, J, past_period())
    assert inv.status_code == 201, inv.text
    refused(op_down.get(f"/api/invoices/{inv.json()['id']}/pdf"), 503, "storage_unavailable")
    link = op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_DAY}).json()
    tok = link["url"].rsplit("/", 1)[1]
    try:
        listing = httpx.get(f"{down}/api/inspect/{tok}", timeout=HTTP_TIMEOUT)
        assert listing.status_code == 200 and listing.json()["documents"], listing.text
        first = listing.json()["documents"][0]["id"]
        refused(httpx.get(f"{down}/api/inspect/{tok}/documents/{first}/file", timeout=HTTP_TIMEOUT), 503, "storage_unavailable")
    finally:
        op.delete(f"/api/tenants/{L}/inspection-link")


def test_recovery_without_restart(relayed, app_url, mail):
    assert relayed.booted_while_down, "the copy did not answer health while Kill Bill and MinIO were down at boot"
    op, main = login(app_url, OPERATOR), login(app_url, J_OWNER)
    jo = login(relayed.url, J_OWNER)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    h = hold(jo, st, d, s, s + MIN_LEN)
    key = idempotency_key()
    doc = next(x for x in documents(main) if x["status"] == "approved")
    file_path = f"/api/documents/{doc['id']}/file"
    expected = main.get(file_path).content
    made: list[dict] = []
    try:
        relayed.kb.set(False)
        relayed.s3.set(False)
        refused(confirm(jo, h["ref"], key=key), 503, "billing_unavailable")
        assert booking(main, h["bookings"][0]["id"])["status"] == "held"
        refused(jo.get(file_path), 503, "storage_unavailable")
        relayed.kb.set(True)
        relayed.s3.set(True)
        c = confirm(jo, h["ref"], key=key)
        assert c.status_code == 200, c.text
        made += c.json()["bookings"]
        assert all(b["status"] == "confirmed" for b in made)
        f = jo.get(file_path)
        assert f.status_code == 200 and f.content == expected
        await_mail(mail, J_OWNER, f"Stationkeeper: booking {h['ref']} confirmed")
    finally:
        for r in (relayed.kb, relayed.s3, relayed.smtp):
            r.set(True)
        cancel_all(main, made)
        release(jo, h["ref"])


def test_dial_day(app_url):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    data = dial(op)
    assert set(data) == {"date", "today", "now_minute", "time_zone", "skipped", "repeated", "stations"}
    assert data["time_zone"] == "America/Chicago" and data["date"] == data["today"]
    assert isinstance(data["now_minute"], int) and 0 <= data["now_minute"] < DAY_MINUTES
    by_id = {s["id"]: s for s in data["stations"]}
    assert set(by_id) == set(STATION_IDS)
    for sid, (name, kind, rate) in STATIONS.items():
        s = by_id[sid]
        assert set(s) == STATION_KEYS | {"blocks"}
        assert (s["name"], s["kind"], s["hourly_rate_cents"]) == (name, kind, rate)
        starts = [b["start_minute"] for b in s["blocks"]]
        assert starts == sorted(starts)
        assert all(0 <= b["start_minute"] < b["end_minute"] <= DAY_MINUTES for b in s["blocks"])
    today = date.fromisoformat(data["today"])
    refused(op.get("/api/dial", params={"date": (today + timedelta(days=BOOK_AHEAD_DAYS + 1)).isoformat()}), 422, "validation_failed")
    refused(op.get("/api/dial", params={"date": (today - timedelta(days=DIAL_PAST_DAYS + 1)).isoformat()}), 422, "validation_failed")
    assert dial(op, today + timedelta(days=BOOK_AHEAD_DAYS))["now_minute"] is None
    assert dial(op, today - timedelta(days=DIAL_PAST_DAYS))["now_minute"] is None
    first, last = span(op, J, FAR_DAYS)
    st, d, s = find_slot(op, first, last, 2 * MIN_LEN)
    a = hold(jo, st, d, s, s + MIN_LEN)
    b = hold(jo, st, d, s + MIN_LEN, s + 2 * MIN_LEN)
    late_st, late_d, late_s = find_slot(op, first, last, MIN_LEN, starts=[DAY_MINUTES - MIN_LEN])
    late = hold(jo, late_st, late_d, late_s, DAY_MINUTES)
    try:
        blocks = station_blocks(op, d, st)
        holds = [x for x in blocks if x["kind"] == "hold" and x["hold_ref"] in (a["ref"], b["ref"])]
        assert sorted((x["start_minute"], x["end_minute"]) for x in holds) == [(s, s + MIN_LEN), (s + MIN_LEN, s + 2 * MIN_LEN)]
        cleaning = [(x["start_minute"], x["end_minute"]) for x in blocks if x["kind"] == "cleaning"]
        assert (s + 2 * MIN_LEN, s + 2 * MIN_LEN + BUFFER) in cleaning
        assert not [c for c in cleaning if c[0] == s + MIN_LEN]
        assert all(x["end_minute"] <= DAY_MINUTES for x in station_blocks(op, late_d, late_st))
        release(jo, b["ref"])
        assert not [x for x in station_blocks(op, d, st) if x.get("hold_ref") == b["ref"]]
        confirmed = confirm(jo, a["ref"])
        assert confirmed.status_code == 200, confirmed.text
        assert [x for x in station_blocks(op, d, st) if x["kind"] == "booking" and x.get("hold_ref") == a["ref"]]
        cancel_all(jo, confirmed.json()["bookings"])
        assert not [x for x in station_blocks(op, d, st) if x.get("hold_ref") == a["ref"]]
    finally:
        for h in (a, b, late):
            release(jo, h["ref"])


def test_tenant_dial_projection(app_url):
    op, jo, lo = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, L_OWNER)
    first, last = span(op, L, 1)
    st, d, s = find_slot(op, first, min(last, span(op, J, 1)[1]), MIN_LEN)
    notes = "secret " + token("proj")
    h = hold(jo, st, d, s, s + MIN_LEN, notes=notes)
    try:
        r = lo.get("/api/dial", params={"date": d.isoformat()})
        assert notes not in r.text and NAMES[J] not in r.text and J_OWNER not in r.text
        blocks = next(x for x in r.json()["stations"] if x["id"] == st)["blocks"]
        theirs = [b for b in blocks if b["start_minute"] == s and b["end_minute"] == s + MIN_LEN]
        assert theirs and set(theirs[0]) == ANON_BLOCK_KEYS and theirs[0]["kind"] == "booked"
        clean = [b for b in blocks if b["kind"] == "cleaning" and b["start_minute"] == s + MIN_LEN]
        assert clean and set(clean[0]) == ANON_BLOCK_KEYS
        own = next(b for b in station_blocks(jo, d, st) if b.get("hold_ref") == h["ref"])
        assert set(own) == OWN_BLOCK_KEYS and own["notes"] == notes and own["expires_at"] and own["tenant_name"] == NAMES[J]
        full = next(b for b in station_blocks(op, d, st) if b.get("hold_ref") == h["ref"])
        assert set(full) == OP_BLOCK_KEYS and full["contact_email"] == J_OWNER and full["notes"] == notes
    finally:
        release(jo, h["ref"])


def test_kitchen_time_zone(app_url, browser):
    op = login(app_url, OPERATOR)
    r = op.get("/api/dial")
    kitchen = parsedate_to_datetime(r.headers["date"]).astimezone(CHICAGO)
    body = r.json()
    assert body["today"] == kitchen.date().isoformat()
    minute = kitchen.hour * 60 + kitchen.minute
    assert abs(body["now_minute"] - minute) <= 1 or abs(body["now_minute"] - minute) == DAY_MINUTES - 1
    context = browser.new_context(timezone_id=TOKYO, viewport=DESKTOP)
    try:
        page = context.new_page()
        page.goto(app_url + "/signin")
        page.get_by_role("textbox", name="Email").fill(J_OWNER)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        expect(slider(page)).to_be_visible(timeout=UI_DEADLINE * 1000)
        clock = page.get_by_text(re.compile(r"Kitchen time \d\d:\d\d"))
        expect(clock).to_be_visible()
        hh, mm = re.search(r"Kitchen time (\d\d):(\d\d)", clock.inner_text()).groups()
        shown = int(hh) * 60 + int(mm)
        now = server_time(op).astimezone(CHICAGO)
        current = now.hour * 60 + now.minute
        assert min(abs(shown - current), DAY_MINUTES - abs(shown - current)) <= 1, (shown, current)
        expect(page.get_by_label("Day", exact=True)).to_have_value(now.date().isoformat())
        value = int(slider(page).get_attribute("aria-valuenow"))
        assert value % STEP == 0 and 0 <= current - value <= STEP, (value, current)
    finally:
        context.close()


def test_dial_keyboard_and_wheel(app_url, browser):
    op = login(app_url, OPERATOR)
    d = today_of(op) + timedelta(days=FAR_DAYS)

    def open_count(minute: int) -> int:
        probe = min(minute, DAY_MINUTES - 1)
        return sum(1 for s in dial(op, d)["stations"] if not any(b["start_minute"] <= probe < b["end_minute"] for b in s["blocks"]))

    with ui(browser, app_url) as page:
        ui_signin(page, app_url, J_OWNER)
        ui_day(page, d)
        dial_slider = slider(page)
        expect(dial_slider).to_have_attribute("aria-valuemin", "0")
        expect(dial_slider).to_have_attribute("aria-valuemax", str(DAY_MINUTES))
        dial_slider.focus()

        def at(value: int) -> None:
            text_value = f"{hhmm(value)}, {open_count(value)} of {len(STATION_IDS)} open"
            eventually(page, lambda: expect(dial_slider).to_have_attribute("aria-valuenow", str(value), timeout=QUICK_MS))
            eventually(page, lambda: expect(dial_slider).to_have_attribute("aria-valuetext", text_value, timeout=QUICK_MS))

        page.keyboard.press("Home"); at(0)
        page.keyboard.press("ArrowLeft"); at(0)
        for _ in range(10):
            page.keyboard.press("PageUp")
        at(10 * HOUR)
        page.keyboard.press("ArrowRight"); at(10 * HOUR + STEP)
        page.keyboard.press("ArrowUp"); at(10 * HOUR + 2 * STEP)
        page.keyboard.press("ArrowDown"); at(10 * HOUR + STEP)
        page.keyboard.press("ArrowLeft"); at(10 * HOUR)
        page.keyboard.press("PageDown"); at(9 * HOUR)
        page.keyboard.press("End"); at(DAY_MINUTES)
        page.keyboard.press("ArrowRight"); at(DAY_MINUTES)
        ui_minute(page, 9 * HOUR)
        box = page.get_by_role("group", name="Floor plan").bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.wheel(0, 100)
        at(9 * HOUR + STEP)
        page.mouse.wheel(0, -100)
        at(9 * HOUR)


def test_station_states_by_pattern_and_label(app_url, browser):
    op, jo, lo = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, L_OWNER)
    first, last = span(op, L, 1)
    last = min(last, span(op, J, 1)[1])
    found = None
    for _ in range(SLOT_DAYS):
        a, d, m = find_slot(op, first, last, MIN_LEN)
        slots = Slots(op)
        others = [x for x in STATION_IDS if x != a and slots.free(x, d, m, m + MIN_LEN)]
        if len(others) >= 2:
            found = (a, others[0], others[1], d, m)
            break
    assert found, "no day with three free stations"
    a, b, c, d, m = found
    mine = hold(jo, a, d, m, m + MIN_LEN)
    theirs = hold(lo, b, d, m, m + MIN_LEN)
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, m)
            held_tile = tile(page, a, f"held by {NAMES[J]}")
            booked_tile = tile(page, b, "booked")
            free_tile = tile(page, c, "free")
            for t, label in ((held_tile, "Held"), (booked_tile, "Booked"), (free_tile, "Free")):
                shows(page, t)
                expect(t).to_contain_text(label)
                expect(t).to_have_attribute("aria-pressed", re.compile("^(true|false)$"))
            shots = {"held": decode(capture(held_tile)), "booked": decode(capture(booked_tile)), "free": decode(capture(free_tile))}
            ui_minute(page, m + MIN_LEN)
            clean_tile = tile(page, a, "cleaning")
            shows(page, clean_tile)
            expect(clean_tile).to_contain_text("Cleaning")
            shots["cleaning"] = decode(capture(clean_tile))
            names = list(shots)
            for i, x in enumerate(names):
                for y in names[i + 1:]:
                    if (shots[x].width, shots[x].height) == (shots[y].width, shots[y].height):
                        changed(shots[x], shots[y])
            changed(shots["held"], shots["cleaning"])
    finally:
        release(jo, mine["ref"])
        release(lo, theirs["ref"])


def test_place_and_release_hold(app_url):
    op, jo, jc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK)
    today = today_of(op)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MAX_LEN, starts=range(0, DAY_MINUTES - MAX_LEN + 1, STEP))
    bad = [
        place(jo, st, d, s, s + MIN_LEN - STEP),
        place(jo, st, d, s, s + MAX_LEN + STEP) if s + MAX_LEN + STEP <= DAY_MINUTES else place(jo, st, d, s, s),
        jo.post("/api/holds", json={"station_id": st, "date": d.isoformat(), "start_local": hhmm(s)[:3] + "10", "end_local": hhmm(s + MIN_LEN)}),
        place(jo, st, d, s, s),
        place(jo, st, today + timedelta(days=BOOK_AHEAD_DAYS + 1), s, s + MIN_LEN),
        place(jo, st, today - timedelta(days=1), s, s + MIN_LEN),
        place(jo, st, d, s, s + MIN_LEN, weeks=0),
        place(jo, st, d, s, s + MIN_LEN, weeks=MAX_WEEKS + 1),
        place(jo, st, d, s, s + MIN_LEN, notes="n" * (NOTES_MAX + 1)),
        place(op, st, d, s, s + MIN_LEN),
    ]
    for r in bad:
        e = refused(r, 422, "validation_failed")
        assert e["details"], e
    longest = hold(jo, st, d, s, s + MAX_LEN)
    release(jo, longest["ref"])
    h = hold(jo, st, d, s, s + MIN_LEN, notes="ok")
    assert set(h) == {"ref", "tenant_id", "station_id", "weeks", "expires_at", "bookings"}
    n = re.fullmatch(r"SK-(\d+)", h["ref"])
    assert n and int(n.group(1)) > 1002
    assert (h["tenant_id"], h["station_id"], h["weeks"]) == (J, st, 1)
    [b] = h["bookings"]
    assert set(b) == BOOKING_KEYS
    assert b["ref"] == h["ref"] + "-1" and b["status"] == "held" and b["pay_with"] is None and b["policy"] is None and b["amount_cents"] is None
    assert (b["date"], b["start_local"], b["end_local"], b["elapsed_minutes"]) == (d.isoformat(), hhmm(s), hhmm(s + MIN_LEN), MIN_LEN)
    assert jo.get(f"/api/holds/{h['ref']}").json()["ref"] == h["ref"]
    assert jo.delete(f"/api/holds/{h['ref']}").status_code == 204
    refused(jo.get(f"/api/holds/{h['ref']}"), 404, "not_found")
    again = hold(jc, st, d, s, s + MIN_LEN)
    assert jc.delete(f"/api/holds/{again['ref']}").status_code == 204
    lst, ld, ls = find_slot(op, *span(op, L, 1), MIN_LEN)
    for_l = hold(op, lst, ld, ls, ls + MIN_LEN, tenant=L)
    assert for_l["tenant_id"] == L
    assert op.delete(f"/api/holds/{for_l['ref']}").status_code == 204
    now_day, step = now_step(op)
    if step >= STEP and step + MIN_LEN <= DAY_MINUTES:
        refused(place(jo, st, now_day, step - STEP, step - STEP + MIN_LEN), 422, "validation_failed")
        at_step = place(jo, st, now_day, step, step + MIN_LEN)
        if now_step(op) == (now_day, step):
            assert at_step.status_code in (201, 409), at_step.text
        if at_step.status_code == 201:
            release(jo, at_step.json()["ref"])


def test_cleaning_buffer(app_url):
    op, jo, lo, lc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, L_OWNER), login(app_url, L_COOK)
    first, last = span(op, L, 1)
    st, d, a = find_slot(op, first, min(last, span(op, J, 1)[1]), 5 * HOUR)
    theirs = hold(lo, st, d, a + 2 * HOUR, a + 3 * HOUR)
    made: list[tuple[httpx.Client, str]] = [(lo, theirs["ref"])]
    try:
        e = refused(place(jo, st, d, a + 3 * HOUR + STEP, a + 4 * HOUR + STEP), 409, "slot_taken")
        assert e["details"]["dates"] == [d.isoformat()]
        refused(place(jo, st, d, a + 15, a + 2 * HOUR - STEP), 409, "slot_taken")
        after = hold(jo, st, d, a + 3 * HOUR + BUFFER, a + 4 * HOUR + BUFFER)
        release(jo, after["ref"])
        before = hold(jo, st, d, a, a + 2 * HOUR - BUFFER)
        release(jo, before["ref"])
        touching = hold(lc, st, d, a + 3 * HOUR, a + 4 * HOUR)
        made.append((lc, touching["ref"]))
    finally:
        for c, ref in made:
            release(c, ref)


def test_one_winner_per_slot(app_url):
    op = login(app_url, OPERATOR)
    users = [login(app_url, e) for e in (J_OWNER, J_COOK, L_OWNER, L_COOK)] + [op]
    first, last = span(op, L, 1)
    st, d, a = find_slot(op, first, min(last, span(op, J, 1)[1]), 2 * HOUR)
    offsets = [0, STEP, 2 * STEP, 3 * STEP, 0]
    barrier = threading.Barrier(len(users))
    results: list[httpx.Response | None] = [None] * len(users)

    def fire(i: int) -> None:
        barrier.wait()
        tenant = J if users[i] is op else None
        results[i] = place(users[i], st, d, a + offsets[i], a + offsets[i] + MIN_LEN, tenant=tenant)

    threads = [threading.Thread(target=fire, args=(i,)) for i in range(len(users))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_TIMEOUT)
    winners = [(i, r) for i, r in enumerate(results) if r is not None and r.status_code == 201]
    try:
        assert len(winners) == 1, [r.status_code if r else None for r in results]
        for i, r in enumerate(results):
            if i != winners[0][0]:
                refused(r, 409, "slot_taken")
        holds = [b for b in station_blocks(op, d, st) if b["kind"] == "hold" and a <= b["start_minute"] < a + 2 * HOUR]
        assert len(holds) == 1
    finally:
        for i, r in winners:
            release(users[i], r.json()["ref"])


def test_hold_expiry_edge(short_hold_app, app_url):
    op = login(app_url, OPERATOR)
    jo, jc = login(short_hold_app, J_OWNER), login(short_hold_app, J_COOK)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    r = place(jo, st, d, s, s + MIN_LEN)
    assert r.status_code == 201, r.text
    created = parsedate_to_datetime(r.headers["date"])
    expires = instant(r.json()["expires_at"])
    ref = r.json()["ref"]
    assert created < expires <= created + timedelta(seconds=TTL_PROBE_S + 1)
    assert jo.get(f"/api/holds/{ref}").status_code == 200
    wait_for(lambda: server_time(jo) > expires, EXPIRY_WAIT_S, "server clock never passed expires_at")
    refused(jo.get(f"/api/holds/{ref}"), 404, "not_found")
    refused(confirm(jo, ref), 410, "hold_expired")
    refused(login(app_url, J_OWNER).get(f"/api/holds/{ref}"), 404, "not_found")
    again = hold(jc, st, d, s, s + MIN_LEN)
    release(jc, again["ref"])


def test_confirm_account_booking(app_url, mail, killbill):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    policy = policy_now(jo)
    length = MIN_LEN + STEP
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), length, weeks=2)
    h = hold(jo, st, d, s, s + length, weeks=2)
    r = confirm(jo, h["ref"])
    assert r.status_code == 200, r.text
    body = r.json()
    try:
        assert body["ref"] == h["ref"] and len(body["bookings"]) == 2
        for i, b in enumerate(body["bookings"]):
            assert b["status"] == "confirmed" and b["pay_with"] == "account"
            assert b["amount_cents"] == length * STATIONS[st][2] // HOUR
            assert b["policy"] == {"version": policy["version"], "free_window_hours": policy["free_window_hours"], "late_fee_percent": policy["late_fee_percent"]}
            assert b["date"] == (d + timedelta(days=7 * i)).isoformat()
            assert booking(jo, b["id"])["status"] == "confirmed"
        account = killbill.account_by_key(J)
        assert account and account["name"] == NAMES[J] and account["currency"] == "USD"
        for b in body["bookings"]:
            [charge] = kb_described(killbill, J, f"Station time {b['ref']}")
            assert item_cents(charge) == b["amount_cents"]
    finally:
        cancel_all(jo, body["bookings"])


def test_booking_confirmation_email(app_url, mail):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    policy = policy_now(jo)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN, weeks=2)
    h = hold(jo, st, d, s, s + MIN_LEN, weeks=2)
    r = confirm(jo, h["ref"])
    assert r.status_code == 200, r.text
    made = r.json()["bookings"]
    try:
        subject = f"Stationkeeper: booking {h['ref']} confirmed"
        await_mail(mail, J_OWNER, subject)
        [message] = settled(mail, J_OWNER, subject)
        assert addresses(message.get("To")) == [J_OWNER]
        assert mail_from_address() in str(message.get("From")) or "bookings@larderrow.test" in json.dumps(message.get("From"))
        content = text(message)
        for b in made:
            assert b["ref"] in content and b["date"] in content
        assert STATIONS[st][0] in content and hhmm(s) in content and hhmm(s + MIN_LEN) in content
        assert str(policy["free_window_hours"]) in content and str(policy["late_fee_percent"]) in content
        assert NAMES[L] not in content and L_OWNER not in content
    finally:
        cancel_all(jo, made)


def test_repeat_safe_confirm(app_url, mail):
    op, jo, jc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK)
    ensure_hours(jo, 2 * MIN_LEN)
    first, last = span(op, J, FAR_DAYS)
    st, d, s = find_slot(op, first, last, MIN_LEN)
    h = hold(jo, st, d, s, s + MIN_LEN)
    made: list[dict] = []
    try:
        refused(jc.post(f"/api/holds/{h['ref']}/confirm", json={"pay_with": "hour_pack"}), 400, "idempotency_key_required")
        refused(confirm(jc, h["ref"], "hour_pack", key="k" * (KEY_MAX + 1)), 400, "idempotency_key_required")
        before = ledger(jo)["balance_minutes"]
        key = idempotency_key()
        first_r = confirm(jc, h["ref"], "hour_pack", key)
        assert first_r.status_code == 200, first_r.text
        made += first_r.json()["bookings"]
        replay = confirm(jc, h["ref"], "hour_pack", key)
        assert replay.status_code == 200 and replay.json() == first_r.json()
        refused(confirm(jc, h["ref"], "account", key), 409, "idempotency_conflict")
        refused(confirm(jc, h["ref"], "hour_pack"), 409, "invalid_transition")
        bid = made[0]["id"]
        entries = [e for e in ledger(jo)["entries"] if e["booking_id"] == bid]
        assert len(entries) == 2 and ledger(jo)["balance_minutes"] == before - MIN_LEN
        subject = f"Stationkeeper: booking {h['ref']} confirmed"
        await_mail(mail, J_OWNER, subject)
        assert len(settled(mail, J_OWNER, subject)) == 1
        st2, d2, s2 = find_slot(op, first, last, MIN_LEN)
        h2 = hold(jo, st2, d2, s2, s2 + MIN_LEN)
        key2 = idempotency_key()
        out: list[httpx.Response] = []
        barrier = threading.Barrier(2)

        def go() -> None:
            barrier.wait()
            out.append(confirm(jc, h2["ref"], "hour_pack", key2))

        threads = [threading.Thread(target=go) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(HTTP_TIMEOUT)
        assert [r.status_code for r in out] == [200, 200] and out[0].json() == out[1].json()
        made += out[0].json()["bookings"]
        assert len([e for e in ledger(jo)["entries"] if e["booking_id"] == out[0].json()["bookings"][0]["id"]]) == 2
        subject2 = f"Stationkeeper: booking {h2['ref']} confirmed"
        await_mail(mail, J_OWNER, subject2)
        assert len(settled(mail, J_OWNER, subject2)) == 1
    finally:
        cancel_all(jo, made)


def test_confirm_all_or_nothing(app_url, relayed, mail, killbill):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    down = login(os.environ["APP_KILLBILL_DOWN_URL"], J_OWNER)
    rj = login(relayed.url, J_OWNER)
    first, last = span(op, J, FAR_DAYS)
    ensure_hours(jo, MIN_LEN)
    holds = [hold(jo, *(lambda x: (x[0], x[1], x[2], x[2] + MIN_LEN))(find_slot(op, first, last, MIN_LEN))) for _ in range(3)]
    made: list[dict] = []
    try:
        refused(confirm(down, holds[0]["ref"]), 503, "billing_unavailable")
        relayed.smtp.set(False)
        key = idempotency_key()
        refused(confirm(rj, holds[1]["ref"], "account", key), 503, "mail_unavailable")
        balance = ledger(jo)["balance_minutes"]
        refused(confirm(rj, holds[2]["ref"], "hour_pack"), 503, "mail_unavailable")
        assert ledger(jo)["balance_minutes"] == balance
        for h in holds:
            assert jo.get(f"/api/holds/{h['ref']}").status_code == 200
            assert booking(jo, h["bookings"][0]["id"])["status"] == "held"
            assert not [e for e in ledger(jo)["entries"] if e["booking_id"] == h["bookings"][0]["id"]]
        for h in holds:
            assert not settled(mail, J_OWNER, f"Stationkeeper: booking {h['ref']} confirmed")
            desc = f"Station time {h['bookings'][0]['ref']}"
            wait_for(lambda: kb_net(killbill, J, desc) == 0, MAIL_DEADLINE, f"{desc} is still charged after a refused confirm")
        relayed.smtp.set(True)
        ok = confirm(rj, holds[1]["ref"], "account", key)
        assert ok.status_code == 200, ok.text
        made += ok.json()["bookings"]
        subject = f"Stationkeeper: booking {holds[1]['ref']} confirmed"
        await_mail(mail, J_OWNER, subject)
        assert len(settled(mail, J_OWNER, subject)) == 1
        assert kb_net(killbill, J, f"Station time {holds[1]['bookings'][0]['ref']}") == 1
    finally:
        relayed.smtp.set(True)
        cancel_all(jo, made)
        for h in holds:
            release(jo, h["ref"])


def test_weekly_repeats(app_url):
    op, jo, jc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK)
    first, last = span(op, J, FAR_DAYS)
    st, d, s = find_slot(op, first, last, MIN_LEN, weeks=3)
    blocker = hold(jc, st, d + timedelta(days=7), s, s + MIN_LEN)
    try:
        e = refused(place(jo, st, d, s, s + MIN_LEN, weeks=3), 409, "slot_taken")
        assert e["details"]["dates"] == [(d + timedelta(days=7)).isoformat()]
        assert own_hold(op, d, st, s, s + MIN_LEN) is None
    finally:
        release(jc, blocker["ref"])
    h = hold(jo, st, d, s, s + MIN_LEN, weeks=3)
    try:
        assert h["weeks"] == 3
        assert [b["ref"] for b in h["bookings"]] == [f"{h['ref']}-{k}" for k in (1, 2, 3)]
        assert [b["date"] for b in h["bookings"]] == [(d + timedelta(days=7 * k)).isoformat() for k in range(3)]
        assert all((b["start_local"], b["end_local"]) == (hhmm(s), hhmm(s + MIN_LEN)) for b in h["bookings"])
    finally:
        release(jo, h["ref"])
    st2, d2, s2 = find_slot(op, first, last, MIN_LEN, weeks=3)
    barrier = threading.Barrier(2)
    out: dict[str, httpx.Response] = {}

    def series() -> None:
        barrier.wait()
        out["series"] = place(jo, st2, d2, s2, s2 + MIN_LEN, weeks=3)

    def single() -> None:
        barrier.wait()
        out["single"] = place(jc, st2, d2 + timedelta(days=14), s2, s2 + MIN_LEN)

    threads = [threading.Thread(target=series), threading.Thread(target=single)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_TIMEOUT)
    try:
        assert sorted(r.status_code for r in out.values()) == [201, 409]
        loser = next(r for r in out.values() if r.status_code == 409)
        refused(loser, 409, "slot_taken")
    finally:
        for name, r in out.items():
            if r.status_code == 201:
                release(jo if name == "series" else jc, r.json()["ref"])


def dst_changes(first: date, last: date) -> list[tuple[date, str]]:
    found = []
    d = first
    while d <= last:
        if dst_day(d):
            spring = local_instant(d, 23 * 60).utcoffset() > local_instant(d, 0).utcoffset()
            found.append((d, "spring" if spring else "fall"))
        d += timedelta(days=1)
    return found


def test_dst_wall_clock(app_url):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    today = today_of(op)
    first, last = span(op, J, 1)
    changes = [(t, k) for t, k in dst_changes(first + timedelta(days=7), last)]
    assert changes, f"no clock change between {first} and {last}"
    t, kind = changes[0]
    start = t - timedelta(days=7)
    assert start > today
    weeks = 3 if t + timedelta(days=7) <= last else 2
    assert weeks <= MAX_WEEKS
    s, e = 5 * HOUR, 9 * HOUR
    slots = Slots(op)
    dates = [start + timedelta(days=7 * k) for k in range(weeks)]
    st = next((x for x in STATION_IDS if all(slots.free(x, dd, s, e) for dd in dates)), None)
    assert st, "no station free for the weekly 05:00 series"
    made = []
    try:
        h = hold(jo, st, start, s, e, weeks=weeks)
        made.append(h["ref"])
        for b, dd in zip(h["bookings"], dates):
            expected = local_instant(dd, s)
            got = instant(b["start"])
            assert got == expected and got.utcoffset() == expected.utcoffset(), (b["start"], expected)
            assert (b["start_local"], b["end_local"]) == ("05:00", "09:00")
            assert b["elapsed_minutes"] == real_minutes(dd, s, e)
        day = dial(op, t)
        if kind == "spring":
            assert day["skipped"] == [2 * HOUR, 3 * HOUR] and day["repeated"] is None
            e1 = refused(place(jo, st, t, 2 * HOUR + 2 * STEP, 4 * HOUR), 422, "validation_failed")
            assert "start_local" in e1["details"]
            e2 = refused(place(jo, st, t, HOUR, 2 * HOUR + 2 * STEP), 422, "validation_failed")
            assert "end_local" in e2["details"]
            refused(place(jo, st, t - timedelta(days=7), 2 * HOUR + 2 * STEP, 4 * HOUR, weeks=2), 422, "validation_failed")
            span_st = next((x for x in STATION_IDS if Slots(op).free(x, t, HOUR, 4 * HOUR)), None)
            if span_st:
                sp = hold(jo, span_st, t, HOUR, 4 * HOUR)
                made.append(sp["ref"])
                assert sp["bookings"][0]["elapsed_minutes"] == real_minutes(t, HOUR, 4 * HOUR)
        else:
            assert day["repeated"] == [HOUR, 2 * HOUR] and day["skipped"] is None
            rep_st = next((x for x in STATION_IDS if Slots(op).free(x, t, HOUR + 2 * STEP, 3 * HOUR)), None)
            if rep_st:
                rp = hold(jo, rep_st, t, HOUR + 2 * STEP, 3 * HOUR)
                made.append(rp["ref"])
                got = instant(rp["bookings"][0]["start"])
                assert got.utcoffset() == local_instant(t - timedelta(days=1), 0).utcoffset()
        before = dial(op, t - timedelta(days=1))
        assert before["skipped"] is None and before["repeated"] is None
    finally:
        for ref in made:
            release(jo, ref)


def test_check_in_and_no_show(app_url):
    op, jo, jc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK)
    future = book(jo, *(lambda x: (x[0], x[1], x[2], x[2] + MIN_LEN))(find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)))[0]
    try:
        refused(jc.post(f"/api/bookings/{future['id']}/check-in", json={}), 409, "outside_check_in_window")
        refused(op.post(f"/api/bookings/{future['id']}/no-show", json={}), 409, "not_started")
        assert booking(jo, future["id"])["status"] == "confirmed"
    finally:
        cancel_all(jo, [future])
    got = book_today(op, jo)
    if got is None:
        return
    gone, gone_station = got
    r = op.post(f"/api/bookings/{gone['id']}/no-show", json={})
    assert r.status_code == 200 and r.json()["status"] == "no_show", r.text
    refused(jc.post(f"/api/bookings/{gone['id']}/check-in", json={}), 409, "invalid_transition")
    assert not [b for b in station_blocks(op, date.fromisoformat(gone["date"]), gone_station) if b.get("booking_id") == gone["id"]]
    lc = login(app_url, L_COOK)
    got = book_today(op, jo)
    if got is None:
        return
    b, _ = got
    refused(lc.post(f"/api/bookings/{b['id']}/check-in", json={}), 404, "not_found")
    assert booking(jo, b["id"])["status"] == "confirmed"
    r = jc.post(f"/api/bookings/{b['id']}/check-in", json={})
    assert r.status_code == 200 and r.json()["status"] == "checked_in" and r.json()["checked_in_at"], r.text
    refused(lc.post(f"/api/bookings/{b['id']}/check-out", json={"holdover_minutes": 0}), 404, "not_found")
    refused(jc.post(f"/api/bookings/{b['id']}/check-in", json={}), 409, "invalid_transition")
    assert booking(jo, b["id"])["status"] == "checked_in"


def test_holdover_at_check_out(app_url, killbill, mail):
    op, jo, jc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK)
    got = book_today(op, jo)
    if got is None:
        fst, fd, fs = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
        future = book(jo, fst, fd, fs, fs + MIN_LEN)[0]
        try:
            refused(jc.post(f"/api/bookings/{future['id']}/check-out", json={"holdover_minutes": HOLDOVER_MAX + 1}), 422, "validation_failed")
            refused(jc.post(f"/api/bookings/{future['id']}/check-out", json={"holdover_minutes": 22}), 409, "invalid_transition")
            assert booking(jo, future["id"])["holdover"] is None
            assert not kb_described(killbill, J, f"Hold-over {future['ref']}")
        finally:
            cancel_all(jo, [future])
        return
    b, st = got
    refused(jc.post(f"/api/bookings/{b['id']}/check-out", json={"holdover_minutes": 0}), 409, "invalid_transition")
    r = jc.post(f"/api/bookings/{b['id']}/check-in", json={})
    assert r.status_code == 200, r.text
    for bad in (HOLDOVER_MAX + 1, -1, 22.5):
        refused(jc.post(f"/api/bookings/{b['id']}/check-out", json={"holdover_minutes": bad}), 422, "validation_failed")
    assert booking(jo, b["id"])["status"] == "checked_in"
    r = jc.post(f"/api/bookings/{b['id']}/check-out", json={"holdover_minutes": 22})
    assert r.status_code == 200, r.text
    rate = STATIONS[st][2]
    expected = {"reported_minutes": 22, "billed_minutes": 30, "amount_cents": 30 * rate // HOUR}
    out = r.json()
    assert out["status"] == "completed" and out["checked_out_at"] and out["holdover"] == expected
    refused(jc.post(f"/api/bookings/{b['id']}/check-out", json={"holdover_minutes": GRACE}), 409, "invalid_transition")
    assert booking(jo, b["id"])["holdover"] == expected
    [charge] = kb_described(killbill, J, f"Hold-over {b['ref']}")
    assert item_cents(charge) == expected["amount_cents"]
    subject = f"Stationkeeper: hold-over recorded on {b['ref']}"
    await_mail(mail, J_OWNER, subject)
    [notice] = settled(mail, J_OWNER, subject)
    assert addresses(notice.get("To")) == [J_OWNER]
    assert "22" in text(notice) and "30" in text(notice)


def test_policy_versions(app_url):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    first, last = span(op, J, FAR_DAYS + 2)
    made: list[dict] = []
    try:
        state = op.get("/api/cancellation-policy").json()
        history = state["history"]
        assert history[0] == state["current"] and [p["version"] for p in history] == sorted((p["version"] for p in history), reverse=True)
        old = state["current"]
        st, d, s = find_slot(op, first, last, MIN_LEN)
        older = book(jo, st, d, s, s + MIN_LEN)[0]
        made.append(older)
        assert older["policy"]["version"] == old["version"]
        refused(op.put("/api/cancellation-policy", json={"free_window_hours": FREE_WINDOW_MAX + 1, "late_fee_percent": 1, "based_on_version": old["version"]}), 422, "validation_failed")
        refused(op.put("/api/cancellation-policy", json={"free_window_hours": 1, "late_fee_percent": PERCENT_MAX + 1, "based_on_version": old["version"]}), 422, "validation_failed")
        r = op.put("/api/cancellation-policy", json={"free_window_hours": 24, "late_fee_percent": 75, "based_on_version": old["version"]})
        assert r.status_code == 201, r.text
        new = r.json()
        assert set(new) == {"version", "free_window_hours", "late_fee_percent", "effective_at"}
        assert (new["version"], new["free_window_hours"], new["late_fee_percent"]) == (old["version"] + 1, 24, 75)
        e = refused(op.put("/api/cancellation-policy", json={"free_window_hours": 1, "late_fee_percent": 1, "based_on_version": old["version"]}), 412, "stale_version")
        assert e["details"]["current_version"] == new["version"]
        assert booking(jo, older["id"])["policy"] == {"version": old["version"], "free_window_hours": old["free_window_hours"], "late_fee_percent": old["late_fee_percent"]}
        st, d, s = find_slot(op, first, last, MIN_LEN)
        newer = book(jo, st, d, s, s + MIN_LEN)[0]
        made.append(newer)
        assert newer["policy"] == {"version": new["version"], "free_window_hours": 24, "late_fee_percent": 75}
        assert {old["version"], new["version"]} <= {p["version"] for p in jo.get("/api/cancellation-policy").json()["history"]}
    finally:
        save_policy(op, SEED_FREE_HOURS, SEED_LATE_PERCENT)
        cancel_all(jo, made)


def test_cancellation_charges_and_refunds(app_url, killbill):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    length = MIN_LEN + STEP
    ensure_hours(jo, 2 * length)
    save_policy(op, FREE_WINDOW_MAX, LATE_PROBE)
    try:
        near = span(op, J, 2, 6)
        far = span(op, J, FAR_DAYS)
        slot = lambda w: (lambda x: (x[0], x[1], x[2], x[2] + length))(find_slot(op, *w, length))
        late_acct = book(jo, *slot(near))[0]
        free_acct = book(jo, *slot(far))[0]
        late_pack = book(jo, *slot(near), pay="hour_pack")[0]
        free_pack = book(jo, *slot(far), pay="hour_pack")[0]
        r = jo.post(f"/api/bookings/{late_acct['id']}/cancel", json={})
        assert r.status_code == 200 and r.json()["status"] == "cancelled", r.text
        fee = half_up(Decimal(late_acct["amount_cents"]) * LATE_PROBE / 100)
        c = r.json()["cancellation"]
        assert c["late"] is True and c["fee_cents"] == fee and c["fee_refunded"] is False and r.json()["policy"]["late_fee_percent"] == LATE_PROBE
        c = jo.post(f"/api/bookings/{free_acct['id']}/cancel", json={}).json()["cancellation"]
        assert c["late"] is False and not c["fee_cents"]
        kept = half_up(Decimal(late_pack["elapsed_minutes"]) * LATE_PROBE / 100)
        c = jo.post(f"/api/bookings/{late_pack['id']}/cancel", json={}).json()["cancellation"]
        assert c["late"] is True and c["fee_minutes"] == kept
        c = jo.post(f"/api/bookings/{free_pack['id']}/cancel", json={}).json()["cancellation"]
        assert c["late"] is False
        refused(jo.post(f"/api/bookings/{late_acct['id']}/cancel", json={}), 409, "invalid_transition")
        r = op.post(f"/api/bookings/{late_acct['id']}/refund-fee", json={})
        assert r.status_code == 200 and r.json()["cancellation"]["fee_refunded"] is True, r.text
        refused(op.post(f"/api/bookings/{late_acct['id']}/refund-fee", json={}), 409, "invalid_transition")
        refused(op.post(f"/api/bookings/{free_acct['id']}/refund-fee", json={}), 409, "invalid_transition")
        r = op.post(f"/api/bookings/{late_pack['id']}/refund-fee", json={})
        assert r.status_code == 200 and r.json()["cancellation"]["fee_refunded"] is True, r.text
        entries = ledger(jo)["entries"]

        def pack_side(bid: str, reason: str) -> list[int]:
            return [e["minutes"] for e in entries if e["booking_id"] == bid and e["reason"] == reason and e["account"] == "tenant_pack"]

        assert pack_side(late_pack["id"], "cancellation_return") == [late_pack["elapsed_minutes"] - kept]
        assert pack_side(late_pack["id"], "fee_refund") == [kept]
        assert pack_side(free_pack["id"], "cancellation_return") == [free_pack["elapsed_minutes"]]
        for b in (late_acct, free_acct):
            [credit] = kb_described(killbill, J, f"Cancellation credit {b['ref']}")
            assert item_cents(credit) == b["amount_cents"]
        [fee_charge] = kb_described(killbill, J, f"Late cancellation fee {late_acct['ref']}")
        assert item_cents(fee_charge) == fee
        assert not kb_described(killbill, J, f"Late cancellation fee {free_acct['ref']}")
        [refund] = kb_described(killbill, J, f"Fee refund {late_acct['ref']}")
        assert item_cents(refund) == fee
        for b in (late_pack, free_pack):
            assert not kb_described(killbill, J, f"Cancellation credit {b['ref']}")
            assert not kb_described(killbill, J, f"Fee refund {b['ref']}")
    finally:
        save_policy(op, SEED_FREE_HOURS, SEED_LATE_PERCENT)


def test_buy_hour_pack(app_url, killbill, relayed):
    jo = login(app_url, J_OWNER)
    packs = {p["id"]: p for p in jo.get("/api/hour-packs").json()["packs"]}
    for pid, (name, minutes, price) in PACKS.items():
        assert packs[pid] == {"id": pid, "name": name, "minutes": minutes, "price_cents": price}
    refused(jo.post("/api/hour-packs/purchase", json={"pack_id": "10h"}), 400, "idempotency_key_required")
    before = ledger(jo)
    key = idempotency_key()
    r = buy(jo, "10h", key)
    assert r.status_code == 201, r.text
    body = r.json()
    assert set(body) == {"purchase_id", "pack_id", "minutes", "price_cents", "balance_minutes"}
    assert (body["pack_id"], body["minutes"], body["price_cents"], body["balance_minutes"]) == ("10h", PACKS["10h"][1], PACKS["10h"][2], before["balance_minutes"] + PACKS["10h"][1])
    [tx] = kb_transactions(killbill, J, lambda k: k == f"pack-{body['purchase_id']}")
    assert tx["transactionType"] == "PURCHASE" and kb_cents(tx) == PACKS["10h"][2]
    replay = buy(jo, "10h", key)
    assert replay.status_code == 201 and replay.json() == body
    refused(buy(jo, "25h", key), 409, "idempotency_conflict")
    after = ledger(jo)
    assert after["balance_minutes"] == body["balance_minutes"]
    assert len(kb_transactions(killbill, J, lambda k: k == f"pack-{body['purchase_id']}")) == 1
    new = [e for e in after["entries"] if e["id"] not in {x["id"] for x in before["entries"]}]
    assert len(new) == 2 and {e["movement_id"] for e in new} == {new[0]["movement_id"]}
    assert sorted((e["account"], e["minutes"]) for e in new) == [("kitchen_hours", -PACKS["10h"][1]), ("tenant_pack", PACKS["10h"][1])]
    assert all(e["reason"] == "pack_purchase" for e in new)
    rj = login(relayed.url, J_OWNER)
    retry_key = idempotency_key()
    held_balance = ledger(jo)["balance_minutes"]
    packs_before = len(kb_transactions(killbill, J, lambda k: k.startswith("pack-")))
    try:
        relayed.kb.set(False)
        refused(buy(rj, "10h", retry_key), 503, "billing_unavailable")
        assert ledger(jo)["balance_minutes"] == held_balance
        assert len(kb_transactions(killbill, J, lambda k: k.startswith("pack-"))) == packs_before
        relayed.kb.set(True)
        again = buy(rj, "10h", retry_key)
        assert again.status_code == 201, again.text
        assert len(kb_transactions(killbill, J, lambda k: k == f"pack-{again.json()['purchase_id']}")) == 1
        assert ledger(jo)["balance_minutes"] == held_balance + PACKS["10h"][1]
    finally:
        relayed.kb.set(True)


def test_hour_ledger_pairs_and_concurrency(app_url):
    op, jo, jc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK)
    book_ref = jo.get("/api/bookings", params={"q": "SK-1002-1"}).json()["bookings"]
    data = ledger(jo)
    assert data["tenant_id"] == J
    movements: dict[str, list[dict]] = {}
    for e in data["entries"]:
        movements.setdefault(e["movement_id"], []).append(e)
        assert e["reason"] in LEDGER_REASONS
    for pair in movements.values():
        assert len(pair) == 2 and {e["account"] for e in pair} == {"tenant_pack", "kitchen_hours"} and pair[0]["minutes"] == -pair[1]["minutes"]
    assert data["balance_minutes"] == sum(e["minutes"] for e in data["entries"] if e["account"] == "tenant_pack") >= 0
    assert any(e["reason"] == "opening_balance" and e["minutes"] == PACKS["10h"][1] and e["account"] == "tenant_pack" for e in data["entries"])
    if book_ref:
        assert any(e["booking_id"] == book_ref[0]["id"] and e["minutes"] == -4 * HOUR and e["account"] == "tenant_pack" for e in data["entries"])
    assert ledger(op, J)["balance_minutes"] == data["balance_minutes"]
    ensure_hours(jo, MIN_LEN)
    balance = ledger(jo)["balance_minutes"]
    choice = next(((ln, w) for w in range(1, MAX_WEEKS + 1) for ln in range(MIN_LEN, MAX_LEN + 1, STEP) if balance / 2 < ln * w <= balance), None)
    assert choice, f"Juniper & Rye's balance {balance} is too large for a racing-confirm probe"
    ln, w = choice
    first, last = span(op, J, FAR_DAYS)
    h1 = hold(jo, *(lambda x: (x[0], x[1], x[2], x[2] + ln))(find_slot(op, first, last, ln, weeks=w)), weeks=w)
    h2 = hold(jo, *(lambda x: (x[0], x[1], x[2], x[2] + ln))(find_slot(op, first, last, ln, weeks=w)), weeks=w)
    barrier = threading.Barrier(2)
    out: dict[str, httpx.Response] = {}

    def go(c: httpx.Client, h: dict) -> None:
        barrier.wait()
        out[h["ref"]] = confirm(c, h["ref"], "hour_pack")

    threads = [threading.Thread(target=go, args=(jo, h1)), threading.Thread(target=go, args=(jc, h2))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_TIMEOUT)
    try:
        assert sorted(r.status_code for r in out.values()) == [200, 409], {k: r.text for k, r in out.items()}
        loser_ref = next(k for k, r in out.items() if r.status_code == 409)
        refused(out[loser_ref], 409, "insufficient_hours")
        after = ledger(jo)
        assert after["balance_minutes"] == balance - ln * w >= 0
        loser = h1 if loser_ref == h1["ref"] else h2
        assert not [e for e in after["entries"] if e["booking_id"] in {b["id"] for b in loser["bookings"]}]
    finally:
        release(jo, h1["ref"])
        release(jo, h2["ref"])


def test_pay_with_hour_pack(app_url):
    op, jo, lo = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, L_OWNER)
    length = MIN_LEN + 2 * STEP
    ensure_hours(jo, 2 * length)
    before = ledger(jo)["balance_minutes"]
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), length, weeks=2)
    h = hold(jo, st, d, s, s + length, weeks=2)
    r = confirm(jo, h["ref"], "hour_pack")
    assert r.status_code == 200, r.text
    made = r.json()["bookings"]
    try:
        assert all(b["pay_with"] == "hour_pack" and b["amount_cents"] is None for b in made)
        after = ledger(jo)
        assert after["balance_minutes"] == before - 2 * length
        for b in made:
            mine = [e for e in after["entries"] if e["booking_id"] == b["id"]]
            assert sorted((e["account"], e["minutes"]) for e in mine) == [("kitchen_hours", length), ("tenant_pack", -length)]
            assert all(e["reason"] == "booking" for e in mine)
        l_balance = ledger(lo)["balance_minutes"]
        assert l_balance < MIN_LEN, "Lantern Street Tacos unexpectedly holds pack hours"
        lst, ld, ls = find_slot(op, *span(op, L, 1), MIN_LEN)
        lh = hold(lo, lst, ld, ls, ls + MIN_LEN)
        try:
            e = refused(confirm(lo, lh["ref"], "hour_pack"), 409, "insufficient_hours")
            assert e["details"] == {"needed_minutes": lh["bookings"][0]["elapsed_minutes"], "balance_minutes": l_balance}
            assert booking(lo, lh["bookings"][0]["id"])["status"] == "held"
        finally:
            release(lo, lh["ref"])
    finally:
        cancel_all(jo, made)


def test_upload_document(app_url, bucket, relayed):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    today = today_of(op)
    data = pdf(token("upl"))
    r = upload(jo, "certificate_of_insurance", today + timedelta(days=300), data, file_name="../../outside/co\x07i.pdf")
    assert r.status_code == 201, r.text
    doc = r.json()
    assert set(doc) == DOCUMENT_KEYS
    assert (doc["tenant_id"], doc["kind"], doc["status"], doc["expires_on"], doc["file_name"], doc["size_bytes"], doc["content_type"]) == (
        J, "certificate_of_insurance", "pending_review", (today + timedelta(days=300)).isoformat(), "coi.pdf", len(data), "application/pdf")
    key = f"tenants/{J}/documents/{doc['id']}.pdf"
    assert key in bucket.keys(f"tenants/{J}/documents/") and bucket.get(key) == data
    f = jo.get(f"/api/documents/{doc['id']}/file")
    assert f.status_code == 200 and f.content == data and f.headers["content-type"].startswith("application/pdf")
    assert f'attachment; filename="{doc["file_name"]}"' in f.headers["content-disposition"]
    assert doc["id"] in {x["id"] for x in documents(jo)}
    refused(upload(jo, "food_handler_card", today + timedelta(days=300), data), 422, "validation_failed")
    refused(upload(jo, "food_handler_card", today + timedelta(days=300), data, holder="h" * (HOLDER_MAX + 1)), 422, "validation_failed")
    refused(upload(jo, "health_permit", today - timedelta(days=1), data), 422, "validation_failed")
    refused(upload(jo, "health_permit", today + timedelta(days=300), b""), 422, "validation_failed")
    refused(upload(jo, "health_permit", today + timedelta(days=300), None, file_name=None), 422, "validation_failed")
    r = upload(op, "health_permit", today + timedelta(days=300), data, tenant=L)
    assert r.status_code == 201 and r.json()["tenant_id"] == L, r.text
    assert f"tenants/{L}/documents/{r.json()['id']}.pdf" in bucket.keys(f"tenants/{L}/documents/")
    rj = login(relayed.url, J_OWNER)
    prefix = f"tenants/{J}/documents/"
    holder = "Holder " + token("rec")
    retry = pdf(holder)
    keys_before = set(bucket.keys(prefix))
    try:
        relayed.s3.set(False)
        refused(upload(rj, "food_handler_card", today + timedelta(days=300), retry, holder=holder), 503, "storage_unavailable")
        assert set(bucket.keys(prefix)) == keys_before
        assert not [x for x in documents(jo) if x["holder_name"] == holder]
        relayed.s3.set(True)
        u = upload(rj, "food_handler_card", today + timedelta(days=300), retry, holder=holder)
        assert u.status_code == 201, u.text
        assert bucket.get(f"{prefix}{u.json()['id']}.pdf") == retry
    finally:
        relayed.s3.set(True)


UPLOAD_BODIES: dict[str, tuple[bytes, str, str, Any]] = {
    "pdf_named_txt": (b"%PDF-1.4\nnotes", "notes.txt", "text/plain", "pdf"),
    "jpeg": (b"\xff\xd8\xff\xe0card", "card.jpeg", "image/jpeg", "jpg"),
    "png": (b"\x89PNG\r\n\x1a\ncard", "card.png", "image/png", "png"),
    "svg_named_png": (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "card.png", "image/png", 415),
    "html_named_pdf": (b"<!doctype html><html><body>card</body></html>", "card.pdf", "application/pdf", 415),
    "zip_archive": (b"PK\x03\x04card", "card.pdf", "application/pdf", 415),
    "exact_cap": (b"%PDF-" + b"0" * (FILE_CAP - len(b"%PDF-")), "cap.pdf", "application/pdf", "pdf"),
    "over_cap": (b"%PDF-" + b"0" * (FILE_CAP + 1 - len(b"%PDF-")), "over.pdf", "application/pdf", 413),
}


@pytest.mark.parametrize("case", UPLOAD_CASES, ids=UPLOAD_CASES)
def test_upload_content_rules(app_url, bucket, case):
    jo = login(app_url, J_OWNER)
    data, name, ctype, outcome = UPLOAD_BODIES[case]
    holder = "Holder " + token(case)
    prefix = f"tenants/{J}/documents/"
    before = set(bucket.keys(prefix))
    r = upload(jo, "food_handler_card", today_of(jo) + timedelta(days=300), data, file_name=name, ctype=ctype, holder=holder)
    if isinstance(outcome, str):
        assert r.status_code == 201, r.text
        key = f"{prefix}{r.json()['id']}.{outcome}"
        assert key in bucket.keys(prefix) and bucket.get(key) == data
        assert r.json()["size_bytes"] == len(data)
        assert jo.get(f"/api/documents/{r.json()['id']}/file").headers["content-type"].split(";")[0] == r.json()["content_type"]
    else:
        refused(r, outcome, "unsupported_file_type" if outcome == 415 else "file_too_large")
        assert set(bucket.keys(prefix)) == before
        assert not [x for x in documents(jo) if x["holder_name"] == holder]


def test_documents_stay_with_tenant(app_url):
    jo, lo = login(app_url, J_OWNER), login(app_url, L_OWNER)
    j_doc = documents(jo)[0]["id"]
    unknown = refused(lo.get(f"/api/documents/{uuid.uuid4()}"), 404, "not_found")
    assert refused(lo.get(f"/api/documents/{j_doc}"), 404, "not_found") == unknown
    refused(lo.get(f"/api/documents/{j_doc}/file"), 404, "not_found")
    refused(lo.post(f"/api/documents/{j_doc}/approve", json={}), 404, "not_found")
    assert all(x["tenant_id"] == L for x in documents(lo))
    assert j_doc not in {x["id"] for x in documents(lo)}


def test_review_documents(app_url, mail, relayed):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    rop = login(relayed.url, OPERATOR)
    since = seen(mail)
    expires = today_of(op) + timedelta(days=200)
    ok = upload(jo, "food_handler_card", expires, pdf(token("rev")), holder="Holder " + token("rev")).json()
    no = upload(jo, "food_handler_card", expires, pdf(token("rej")), holder="Holder " + token("rej")).json()
    try:
        relayed.s3.set(False)
        refused(rop.post(f"/api/documents/{ok['id']}/approve", json={}), 503, "storage_unavailable")
        assert jo.get(f"/api/documents/{ok['id']}").json()["status"] == "pending_review"
    finally:
        relayed.s3.set(True)
    r = rop.post(f"/api/documents/{ok['id']}/approve", json={})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["reviewed_at"] and r.json()["valid"] is True
    refused(op.post(f"/api/documents/{ok['id']}/approve", json={}), 409, "invalid_transition")
    refused(op.post(f"/api/documents/{ok['id']}/reject", json={"reason": "late"}), 409, "invalid_transition")
    refused(op.post(f"/api/documents/{no['id']}/reject", json={}), 422, "validation_failed")
    refused(op.post(f"/api/documents/{no['id']}/reject", json={"reason": ""}), 422, "validation_failed")
    refused(op.post(f"/api/documents/{no['id']}/reject", json={"reason": "r" * (REASON_MAX + 1)}), 422, "validation_failed")
    reason = "Blurred photo " + token("why")
    r = op.post(f"/api/documents/{no['id']}/reject", json={"reason": reason})
    assert r.status_code == 200 and r.json()["status"] == "rejected" and r.json()["rejection_reason"] == reason, r.text
    await_mail(mail, J_OWNER, "Stationkeeper: Food handler card approved", since=since)
    await_mail(mail, J_OWNER, "Stationkeeper: Food handler card needs attention", contains=(reason,), since=since)


def test_document_validity_edge(app_url):
    op, lo = login(app_url, OPERATOR), login(app_url, L_OWNER)
    today = today_of(op)
    for d in documents(op):
        if d["status"] == "approved":
            assert d["valid"] == (date.fromisoformat(d["expires_on"]) >= today), d
    for t in op.get("/api/tenants").json()["tenants"]:
        assert set(t) == TENANT_KEYS
        if t["status"] in ("active", "suspended"):
            all_valid = all(v["valid"] for v in t["required_documents"].values())
            assert (t["status"] == "active") == all_valid, t
    tenant = op.get(f"/api/tenants/{L}").json()
    edge = doc_edge(op, L)
    binding = {k for k, v in tenant["required_documents"].items() if v["expires_on"] == edge.isoformat()}
    assert edge < today + timedelta(days=BOOK_AHEAD_DAYS)
    slots = Slots(op)
    st = next(x for x in STATION_IDS if slots.free(x, edge, DAY_MINUTES - HOUR, DAY_MINUTES))
    h = hold(lo, st, edge, DAY_MINUTES - HOUR, DAY_MINUTES)
    release(lo, h["ref"])
    e = refused(place(lo, st, edge + timedelta(days=1), 10 * HOUR, 11 * HOUR), 409, "document_expires_before_booking")
    assert binding <= set(e["details"]["kinds"]) and e["details"]["dates"]


def test_expiry_reminders(app_url, mail):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    today = today_of(op)
    since = seen(mail)
    inside = today + timedelta(days=REMINDER_LEAD)
    outside = today + timedelta(days=REMINDER_LEAD + 1)
    approved_doc(op, jo, "food_handler_card", inside, holder="Holder " + token("in"))
    approved_doc(op, jo, "food_handler_card", outside, holder="Holder " + token("out"))
    subject = f"Stationkeeper: Food handler card expires on {inside.isoformat()}"
    await_mail(mail, J_OWNER, subject, since=since)
    first_batch = len(matching(inbox(mail, SWEEP_SETTLE_S), J_OWNER, subject, since=since))
    assert first_batch >= 1
    messages = inbox(mail, SWEEP_SETTLE_S)
    assert len(matching(messages, J_OWNER, subject, since=since)) == first_batch, "the reminder was sent again on a later sweep"
    assert not matching(messages, J_OWNER, f"Stationkeeper: Food handler card expires on {outside.isoformat()}", since=since)


def test_tenant_lifecycle(app_url):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    refused(op.post(f"/api/tenants/{J}/activate", json={}), 409, "invalid_transition")
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    h = hold(jo, st, d, s, s + MIN_LEN)
    try:
        refused(op.post(f"/api/tenants/{J}/offboard", json={}), 409, "open_bookings")
        assert op.get(f"/api/tenants/{J}").json()["status"] == "active"
    finally:
        release(jo, h["ref"])
    if op.get(f"/api/tenants/{S}").json()["status"] == "suspended":
        refused(op.post(f"/api/tenants/{S}/activate", json={}), 409, "invalid_transition")
    today = today_of(op)
    status = op.get(f"/api/tenants/{F}").json()["status"]
    if status == "applied":
        refused(op.post(f"/api/tenants/{F}/activate", json={}), 409, "invalid_transition")
        r = upload(op, "certificate_of_insurance", today + timedelta(days=300), pdf(token("fen")), tenant=F)
        assert r.status_code == 201, r.text
        status = op.get(f"/api/tenants/{F}").json()["status"]
        assert status == "documents_review"
    if status == "documents_review":
        tenant = op.get(f"/api/tenants/{F}").json()
        missing = {k for k, v in tenant["required_documents"].items() if not v["valid"]}
        if missing:
            e = refused(op.post(f"/api/tenants/{F}/activate", json={}), 409, "documents_incomplete")
            assert set(e["details"]["missing"]) == missing
        for kind in missing:
            approved_doc(op, op, kind, today + timedelta(days=300), holder="Holder " + token("fen") if kind == "food_handler_card" else None, tenant=F)
        r = op.post(f"/api/tenants/{F}/activate", json={})
        assert r.status_code == 200 and r.json()["status"] == "active", r.text
        status = "active"
    if status in ("active", "suspended"):
        fo = login(app_url, F_OWNER)
        r = op.post(f"/api/tenants/{F}/offboard", json={})
        assert r.status_code == 200 and r.json()["status"] == "offboarded", r.text
        refused(fo.get("/api/session"), 401, "unauthenticated")
        status = "offboarded"
    assert status == "offboarded"
    refused(client(app_url).post("/api/session", json={"email": F_OWNER, "password": PASSWORD}), 403, "tenant_offboarded")
    refused(op.post(f"/api/tenants/{F}/activate", json={}), 409, "invalid_transition")
    refused(op.post(f"/api/tenants/{F}/offboard", json={}), 409, "invalid_transition")


def test_issue_inspection_link(app_url):
    op = login(app_url, OPERATOR)
    refused(op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_MIN - 1}), 422, "validation_failed")
    refused(op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_MAX + 1}), 422, "validation_failed")
    widest = op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_MAX})
    assert widest.status_code == 201, widest.text
    r = op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_DAY})
    assert r.status_code == 201, r.text
    try:
        body = r.json()
        assert set(body) == {"url", "expires_at"}
        assert re.fullmatch(r"/inspect/[A-Za-z0-9_-]{32,}", body["url"])
        issued = parsedate_to_datetime(r.headers["date"])
        delta = (instant(body["expires_at"]) - issued).total_seconds()
        assert LINK_DAY - 1 <= delta <= LINK_DAY + 1, delta
        assert op.get(f"/api/tenants/{L}/inspection-link").json() == body
        old = widest.json()["url"].rsplit("/", 1)[1]
        refused(httpx.get(f"{app_url}/api/inspect/{old}", timeout=HTTP_TIMEOUT), 410, "link_expired")
        fresh = body["url"].rsplit("/", 1)[1]
        assert httpx.get(f"{app_url}/api/inspect/{fresh}", timeout=HTTP_TIMEOUT).status_code == 200
    finally:
        op.delete(f"/api/tenants/{L}/inspection-link")


def inspector_expected(op: httpx.Client, tenant: str) -> set[str]:
    today = today_of(op)
    good = [x for x in documents(op, tenant) if x["status"] == "approved" and date.fromisoformat(x["expires_on"]) >= today]
    expected = set()
    for kind in ("certificate_of_insurance", "health_permit"):
        pool = [x for x in good if x["kind"] == kind]
        if pool:
            expected.add(max(pool, key=lambda x: x["expires_on"])["id"])
    for holder in {x["holder_name"] for x in good if x["kind"] == "food_handler_card"}:
        pool = [x for x in good if x["kind"] == "food_handler_card" and x["holder_name"] == holder]
        expected.add(max(pool, key=lambda x: x["expires_on"])["id"])
    return expected


def test_inspector_view(app_url, bucket):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    pending = upload(op, "certificate_of_insurance", today_of(op) + timedelta(days=500), pdf(token("pend")), tenant=L).json()
    link = op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_DAY}).json()
    tok = link["url"].rsplit("/", 1)[1]
    try:
        anon = client(app_url)
        r = anon.get(f"/api/inspect/{tok}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == INSPECT_KEYS
        assert (body["kitchen_name"], body["business_name"]) == (KITCHEN, NAMES[L])
        assert {d["id"] for d in body["documents"]} == inspector_expected(op, L)
        assert L_OWNER not in r.text and NAMES[J] not in r.text and pending["id"] not in r.text
        for d in body["documents"]:
            assert set(d) == INSPECT_DOC_KEYS
            f = anon.get(d["file_url"])
            assert f.status_code == 200
            keys = [k for k in bucket.keys(f"tenants/{L}/documents/{d['id']}.")]
            assert keys and f.content == bucket.get(keys[0])
        refused(anon.get(f"/api/inspect/{tok}/documents/{pending['id']}/file"), 404, "not_found")
        refused(anon.get(f"/api/inspect/{tok}/documents/{documents(jo)[0]['id']}/file"), 404, "not_found")
    finally:
        op.delete(f"/api/tenants/{L}/inspection-link")


def test_inspection_link_dead_states(app_url):
    op, anon = login(app_url, OPERATOR), client(app_url)
    link = op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_DAY}).json()
    tok = link["url"].rsplit("/", 1)[1]
    doc_id = anon.get(f"/api/inspect/{tok}").json()["documents"][0]["id"]
    for method in ("POST", "PUT", "DELETE", "PATCH"):
        for path in (f"/api/inspect/{tok}", f"/api/inspect/{tok}/documents/{doc_id}/file"):
            r = anon.request(method, path, json={})
            refused(r, 405, "read_only")
            assert r.headers.get("allow", "").replace(" ", "") == "GET"
    assert anon.get(f"/api/inspect/{tok}").status_code == 200
    assert op.delete(f"/api/tenants/{L}/inspection-link").status_code == 204
    refused(anon.get(f"/api/inspect/{tok}"), 410, "link_expired")
    refused(anon.get(f"/api/inspect/{tok}/documents/{doc_id}/file"), 410, "link_expired")
    refused(op.delete(f"/api/tenants/{L}/inspection-link"), 404, "not_found")
    refused(op.get(f"/api/tenants/{L}/inspection-link"), 404, "not_found")
    refused(anon.get(f"/api/inspect/{secrets.token_urlsafe(32)}"), 404, "not_found")
    short = op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_MIN}).json()
    stok = short["url"].rsplit("/", 1)[1]
    assert anon.get(f"/api/inspect/{stok}").status_code == 200
    wait_for(lambda: server_time(anon) > instant(short["expires_at"]), EXPIRY_WAIT_S, "server clock never passed the link expiry")
    refused(anon.get(f"/api/inspect/{stok}"), 410, "link_expired")


def test_storage_shelves(app_url):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    shelves = {s["id"]: s for s in op.get("/api/shelves").json()["shelves"]}
    for sid in SHELVES:
        s = shelves[sid]
        assert set(s) == {"id", "name", "monthly_rate_cents", "tenant_id", "tenant_name"}
        assert (s["name"], s["monthly_rate_cents"]) == (f"Walk-in shelf {sid}", SHELF_RATE)
    own = jo.get("/api/shelves").json()["shelves"]
    assert own and all(s["tenant_id"] == J for s in own)
    refused(op.put(f"/api/shelves/{SHELVES[3]}", json={"tenant_id": F}), 409, "tenant_not_active")
    try:
        r = op.put(f"/api/shelves/{SHELVES[2]}", json={"tenant_id": J})
        assert r.status_code == 200 and r.json()["tenant_id"] == J, r.text
        j_shelves = [s for s in op.get("/api/shelves").json()["shelves"] if s["tenant_id"] == J]
        period = past_period()
        inv = issue(op, J, period)
        assert inv.status_code == 201, inv.text
        body = inv.json()
        assert set(body) == INVOICE_KEYS
        assert [l["kind"] for l in body["lines"]] == ["storage"] * len(j_shelves)
        assert all(l["amount_cents"] == SHELF_RATE for l in body["lines"])
        subtotal = SHELF_RATE * len(j_shelves)
        assert (body["subtotal_cents"], body["tax_cents"], body["total_cents"]) == (subtotal, tax_of(subtotal), subtotal + tax_of(subtotal))
        assert body["tax_rate_percent"] == TAX_PERCENT and body["status"] == "issued"
        yyyymm = period.replace("-", "")
        assert body["number"] == f"INV-{yyyymm}-0001"
        refused(issue(op, J, period), 409, "nothing_to_invoice")
        assert [s for s in op.get("/api/shelves").json()["shelves"] if s["tenant_id"] == L]
        other = issue(op, L, period)
        assert other.status_code == 201 and other.json()["number"] == f"INV-{yyyymm}-0002", other.text
        freed = op.put(f"/api/shelves/{SHELVES[2]}", json={"tenant_id": None})
        assert freed.status_code == 200 and freed.json()["tenant_id"] is None
    finally:
        op.put(f"/api/shelves/{SHELVES[2]}", json={"tenant_id": None})


def test_invoice_gathers_items(app_url):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    today = today_of(op)
    period = today.strftime("%Y-%m")
    save_policy(op, FREE_WINDOW_MAX, LATE_PROBE)
    try:
        today_booking = book_today(op, jo)
        gone = today_booking[0] if today_booking else None
        if gone:
            assert op.post(f"/api/bookings/{gone['id']}/no-show", json={}).status_code == 200
        st, d, s = find_slot(op, *span(op, J, 2, 6), MIN_LEN + STEP)
        late = book(jo, st, d, s, s + MIN_LEN + STEP)[0]
        cancelled = jo.post(f"/api/bookings/{late['id']}/cancel", json={}).json()
        fee = cancelled["cancellation"]["fee_cents"]
        assert fee > 0
        r = issue(op, J, period)
        assert r.status_code == 201, r.text
        inv = r.json()
        lines = {(l["kind"], l["booking_ref"]): l["amount_cents"] for l in inv["lines"]}
        if gone:
            assert lines[("station_time", gone["ref"])] == gone["amount_cents"]
        assert lines[("late_fee", late["ref"])] == fee
        order = [LINE_ORDER.index(l["kind"]) for l in inv["lines"]]
        assert order == sorted(order)
        assert inv["subtotal_cents"] == sum(l["amount_cents"] for l in inv["lines"])
        assert inv["tax_cents"] == tax_of(inv["subtotal_cents"]) and inv["total_cents"] == inv["subtotal_cents"] + inv["tax_cents"]
        assert inv["period"] == period and re.fullmatch(rf"INV-{period.replace('-', '')}-\d{{4}}", inv["number"])
        again = issue(op, J, period)
        if again.status_code == 201:
            assert not {l["booking_ref"] for l in again.json()["lines"]} & ({late["ref"]} | ({gone["ref"]} if gone else set()))
        else:
            refused(again, 409, "nothing_to_invoice")
        refused(op.post(f"/api/bookings/{late['id']}/refund-fee", json={}), 409, "fee_invoiced")
        future = (today.replace(day=28) + timedelta(days=5)).strftime("%Y-%m")
        refused(issue(op, J, future), 422, "validation_failed")
        refused(issue(op, F, past_period()), 409, "nothing_to_invoice")
    finally:
        save_policy(op, SEED_FREE_HOURS, SEED_LATE_PERCENT)


def test_invoice_issue_atomic(app_url, bucket, mail, killbill):
    op = login(app_url, OPERATOR)
    since = seen(mail)
    period = past_period()
    yyyymm = period.replace("-", "")
    prefix = f"invoices/{J}/"
    j_shelves = [s["id"] for s in op.get("/api/shelves").json()["shelves"] if s["tenant_id"] == J]
    assert j_shelves
    refused(issue(login(os.environ["APP_MINIO_DOWN_URL"], OPERATOR), J, period), 503, "storage_unavailable")
    refused(issue(login(os.environ["APP_KILLBILL_DOWN_URL"], OPERATOR), J, period), 503, "billing_unavailable")
    assert not invoices_for(op, J, period)
    assert not [k for k in bucket.keys(prefix) if f"INV-{yyyymm}-" in k]
    for sid in j_shelves:
        desc = f"Storage shelf {sid} {period}"
        wait_for(lambda: kb_net(killbill, J, desc) == 0, MAIL_DEADLINE, f"{desc} is still standing after a failed issue")
    r = issue(op, J, period)
    assert r.status_code == 201, r.text
    inv = r.json()
    key = f"{prefix}{inv['number']}.pdf"
    stored = bucket.get(key)
    assert stored.startswith(b"%PDF-")
    p = op.get(f"/api/invoices/{inv['id']}/pdf")
    assert p.status_code == 200 and p.headers["content-type"].startswith("application/pdf") and p.content == stored
    assert len([l for l in inv["lines"] if l["kind"] == "storage"]) == len(j_shelves)
    for sid in j_shelves:
        desc = f"Storage shelf {sid} {period}"
        assert kb_net(killbill, J, desc) == 1
        assert all(item_cents(c) == SHELF_RATE for c in kb_described(killbill, J, desc))
    assert inv["tax_cents"] > 0
    tax_desc = f"Sales tax {inv['number']}"
    assert kb_net(killbill, J, tax_desc) == 1
    assert all(item_cents(c) == inv["tax_cents"] for c in kb_described(killbill, J, tax_desc))
    notice = await_mail(mail, J_OWNER, f"Stationkeeper: invoice {inv['number']} is ready", since=since)[0]
    total = f"{inv['total_cents'] // 100}.{inv['total_cents'] % 100:02d}"
    assert total in text(notice)
    stray = [m for m in inbox(mail) if mail_key(m) not in since and str(m.get("Subject", "")).startswith(f"Stationkeeper: invoice INV-{yyyymm}-") and inv["number"] not in str(m.get("Subject"))]
    assert not stray


def test_pay_invoice(app_url, killbill, mail):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    since = seen(mail)
    inv = issue(op, J, past_period()).json()
    path = f"/api/invoices/{inv['id']}/pay"
    keyname = f"invoice-{inv['number']}"
    down = login(os.environ["APP_KILLBILL_DOWN_URL"], J_OWNER)
    refused(down.post(path, json={}, headers={"Idempotency-Key": idempotency_key()}), 503, "billing_unavailable")
    assert jo.get(f"/api/invoices/{inv['id']}").json()["status"] == "issued"
    assert not kb_transactions(killbill, J, lambda k: k == keyname)
    refused(jo.post(path, json={}), 400, "idempotency_key_required")
    key = idempotency_key()
    r = jo.post(path, json={}, headers={"Idempotency-Key": key})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paid" and r.json()["paid_at"]
    replay = jo.post(path, json={}, headers={"Idempotency-Key": key})
    assert replay.status_code == 200 and replay.json() == r.json()
    [tx] = kb_transactions(killbill, J, lambda k: k == keyname)
    assert tx["transactionType"] == "PURCHASE" and kb_cents(tx) == inv["total_cents"]
    refused(jo.post(path, json={}, headers={"Idempotency-Key": idempotency_key()}), 409, "invoice_paid")
    assert len(kb_transactions(killbill, J, lambda k: k == keyname)) == 1
    subject = f"Stationkeeper: receipt for invoice {inv['number']}"
    receipt = await_mail(mail, J_OWNER, subject, since=since)[0]
    assert addresses(receipt.get("To")) == [J_OWNER]


def test_booking_search_scope(app_url):
    op, jo, lo = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, L_OWNER)
    tok = token("srch")
    first, last = span(op, J, FAR_DAYS)
    slot = lambda w: (lambda x: (x[0], x[1], x[2], x[2] + MIN_LEN))(find_slot(op, *w, MIN_LEN))
    mine = book(jo, *slot((first, last)), notes=f"{tok} jr") + book(jo, *slot((first, last)), notes=f"{tok} jr")
    lst, ld, ls, le = slot(span(op, L, 1))
    theirs = book(lo, lst, ld, ls, le, notes=f"{tok} ls")
    pending = hold(jo, *slot((first, last)), notes=f"{tok} held")
    q = lambda c, **p: c.get("/api/bookings", params=p).json()["bookings"]
    try:
        found = q(jo, q=tok)
        assert {b["ref"] for b in found} == {b["ref"] for b in mine} and all(set(b) == BOOKING_KEYS and b["tenant_id"] == J for b in found)
        assert {b["ref"] for b in q(jo, q=tok.upper())} == {b["ref"] for b in mine}
        assert {b["ref"] for b in q(lo, q=tok)} == {theirs[0]["ref"]}
        everyone = q(op, q=tok)
        assert {b["ref"] for b in everyone} == {b["ref"] for b in mine + theirs} and all(b["tenant_name"] for b in everyone)
        narrow = {"from": ld.isoformat(), "to": ld.isoformat(), "station_id": lst}
        assert theirs[0]["ref"] in {b["ref"] for b in q(op, q=NAMES[L], **narrow)}
        assert theirs[0]["ref"] not in {b["ref"] for b in q(jo, q=NAMES[L], **narrow)}
        jo.post(f"/api/bookings/{mine[0]['id']}/cancel", json={})
        assert {b["ref"] for b in q(jo, q=tok, status="cancelled")} == {mine[0]["ref"]}
        assert {b["ref"] for b in q(jo, q=tok, station_id=mine[1]["station_id"])} >= {mine[1]["ref"]}
        assert len(q(op)) <= SEARCH_CAP
    finally:
        release(jo, pending["ref"])
        cancel_all(jo, mine)


def test_booking_export(app_url):
    op, jo, lo = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, L_OWNER)
    tok = token("csv")
    first, last = span(op, J, FAR_DAYS)
    made: list[dict] = []
    for _ in range(EXPORT_ATTEMPTS):
        if len(made) > SEARCH_CAP:
            break
        st, d, s = find_slot(op, first, last, MIN_LEN, weeks=MAX_WEEKS, starts=range(3 * HOUR, 6 * HOUR, STEP))
        r = place(jo, st, d, s, s + MIN_LEN, weeks=MAX_WEEKS, notes=f"{tok} run")
        if r.status_code != 201:
            continue
        c = confirm(jo, r.json()["ref"])
        assert c.status_code == 200, c.text
        made += c.json()["bookings"]
    assert len(made) > SEARCH_CAP
    ensure_hours(jo, MIN_LEN)
    made += book(jo, *(lambda x: (x[0], x[1], x[2], x[2] + MIN_LEN))(find_slot(op, first, last, MIN_LEN)), notes=f"{tok} pack", pay="hour_pack")
    today = today_of(op)
    r = jo.get("/api/bookings/export", params={"q": tok})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    name = f"bookings-{(today - timedelta(days=DIAL_PAST_DAYS)).isoformat()}-to-{(today + timedelta(days=BOOK_AHEAD_DAYS)).isoformat()}.csv"
    disposition = r.headers["content-disposition"]
    assert "attachment" in disposition and f'filename="{name}"' in disposition
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0] == TENANT_CSV_HEADER
    by_ref = {row[1]: dict(zip(rows[0], row)) for row in rows[1:] if row}
    by_ref = {dict(zip(rows[0], row))["ref"]: dict(zip(rows[0], row)) for row in rows[1:] if row}
    assert set(by_ref) == {b["ref"] for b in made}
    for b in made:
        row = by_ref[b["ref"]]
        expected = "" if b["pay_with"] == "hour_pack" else f"{b['amount_cents'] // 100}.{b['amount_cents'] % 100:02d}"
        assert row["amount"].lstrip("$") == expected and row["notes"] == b["notes"]
    search = jo.get("/api/bookings", params={"q": tok}).json()["bookings"]
    assert len(search) == SEARCH_CAP
    inside = {b["ref"] for b in search}
    starts = {b["ref"]: instant(b["start"]) for b in made}
    assert inside <= set(by_ref)
    assert max(starts[x] for x in inside) <= min(starts[x] for x in set(by_ref) - inside)
    rows = list(csv.reader(io.StringIO(op.get("/api/bookings/export", params={"q": tok}).text)))
    assert rows[0] == OPERATOR_CSV_HEADER and len([x for x in rows[1:] if x]) == len(made)
    assert all(dict(zip(rows[0], x))["tenant"] == NAMES[J] and dict(zip(rows[0], x))["contact_email"] == J_OWNER for x in rows[1:] if x)
    rows = [x for x in csv.reader(io.StringIO(lo.get("/api/bookings/export", params={"q": tok}).text)) if x]
    assert rows == [TENANT_CSV_HEADER]


def test_cross_tenant_ids(app_url):
    op, jo, lo = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, L_OWNER)
    first, last = span(op, J, FAR_DAYS)
    st, d, s = find_slot(op, first, last, MIN_LEN)
    b = book(jo, st, d, s, s + MIN_LEN)[0]
    st, d, s = find_slot(op, first, last, MIN_LEN)
    h = hold(jo, st, d, s, s + MIN_LEN)
    inv = issue(op, J, past_period()).json()
    try:
        unknown = refused(lo.get(f"/api/bookings/{uuid.uuid4()}"), 404, "not_found")
        assert refused(lo.get(f"/api/bookings/{b['id']}"), 404, "not_found") == unknown
        refused(lo.post(f"/api/bookings/{b['id']}/cancel", json={}), 404, "not_found")
        refused(lo.get(f"/api/holds/{h['ref']}"), 404, "not_found")
        refused(lo.delete(f"/api/holds/{h['ref']}"), 404, "not_found")
        refused(confirm(lo, h["ref"]), 404, "not_found")
        refused(lo.get(f"/api/invoices/{inv['id']}"), 404, "not_found")
        refused(lo.get(f"/api/invoices/{inv['id']}/pdf"), 404, "not_found")
        refused(lo.post(f"/api/invoices/{inv['id']}/pay", json={}, headers={"Idempotency-Key": idempotency_key()}), 404, "not_found")
        assert booking(jo, b["id"])["status"] == "confirmed"
        assert jo.get(f"/api/holds/{h['ref']}").status_code == 200
        assert jo.get(f"/api/invoices/{inv['id']}").json()["status"] == "issued"
        assert booking(op, b["id"])["tenant_name"] == NAMES[J]
    finally:
        release(jo, h["ref"])
        cancel_all(jo, [b])


MOTION_RECORDER = """
(tiles) => {
  const record = { t0: null, items: [] };
  window.__stationkeeperMotion = record;
  const tileOf = (el) => tiles.findIndex((t) => t === el || t.contains(el));
  const note = (anim, el) => {
    if (anim.__stationkeeper) return;
    anim.__stationkeeper = true;
    const timing = anim.effect ? anim.effect.getComputedTiming() : {};
    const end = Number(timing.endTime);
    record.items.push({ tile: tileOf(el), at: record.t0 === null ? 0 : document.timeline.currentTime - record.t0,
      delay: Number(timing.delay) || 0, end: Number.isFinite(end) ? end : -1 });
  };
  document.addEventListener('keydown', () => { record.t0 = document.timeline.currentTime; record.items = []; }, true);
  for (const type of ['transitionrun', 'animationstart']) {
    document.addEventListener(type, (event) => {
      const el = event.target;
      if (el instanceof Element) for (const anim of el.getAnimations()) note(anim, el);
    }, true);
  }
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const anim = original.apply(this, args); note(anim, this); return anim; };
}
"""


def states_at(op: httpx.Client, d: date, minute: int) -> dict[str, str]:
    probe = min(minute, DAY_MINUTES - 1)
    out = {}
    for s in dial(op, d)["stations"]:
        cover = [b for b in s["blocks"] if b["start_minute"] <= probe < b["end_minute"]]
        out[s["id"]] = cover[0]["kind"] if cover else "free"
    return out


def motion_setup(app_url: str) -> tuple[httpx.Client, httpx.Client, dict, str, date, int]:
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN, starts=range(2 * HOUR, 20 * HOUR, STEP))
    return op, jo, hold(jo, st, d, s, s + MIN_LEN), st, d, s


def install_recorder(page: Page) -> None:
    handles = [any_tile(page, sid).element_handle() for sid in STATION_IDS]
    page.evaluate(MOTION_RECORDER, handles)


def motion_items(page: Page) -> list[dict]:
    return page.evaluate("() => window.__stationkeeperMotion.items")


def differs(a: Any, b: Any) -> bool:
    return difference(a, b) > 0


def dial_look(page: Page) -> tuple[dict, Any]:
    return slider(page).bounding_box(), decode(capture(slider(page)))


def dial_moved(page: Page, before: tuple[dict, Any]) -> bool:
    box, img = dial_look(page)
    old = before[0]
    return (round(box["x"]), round(box["y"])) != (round(old["x"]), round(old["y"])) or differs(before[1], img)


def rest(page: Page) -> None:
    advance(page, SETTLE_MS)
    settle(slider(page))
    settle(page.get_by_role("group", name="Floor plan"))


def test_dial_motion(app_url, browser):
    op, jo, h, st, d, s = motion_setup(app_url)
    changed_ids = {sid for sid, kind in states_at(op, d, s).items() if kind != states_at(op, d, s - STEP)[sid]}
    assert st in changed_ids
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, L_OWNER)
            ui_day(page, d)
            ui_minute(page, s - STEP)
            rest(page)
            dial_before = dial_look(page)
            tile_before = decode(capture(any_tile(page, st)))
            install_recorder(page)
            slider(page).focus()
            page.keyboard.press("ArrowRight")
            advance(page, ACK_MS)
            expect(slider(page)).to_have_attribute("aria-valuenow", str(s), timeout=QUICK_MS)
            assert dial_moved(page, dial_before), "the handle and spoke had not started to move within 0.1 s"
            advance(page, SETTLE_MS - ACK_MS)
            settle(slider(page))
            settle(page.get_by_role("group", name="Floor plan"))
            expect(tile(page, st, "booked")).to_be_visible(timeout=QUICK_MS)
            tile_settled = decode(capture(any_tile(page, st)))
            changed(tile_before, tile_settled)
            dial_settled = dial_look(page)
            advance(page, SETTLE_MS)
            assert not differs(tile_settled, decode(capture(any_tile(page, st)))), "the changed tile was still moving after 0.5 s"
            items = motion_items(page)
            for idx, sid in enumerate(STATION_IDS):
                if sid not in changed_ids:
                    assert not [i for i in items if i["tile"] == idx and i["end"] > 0], f"unchanged tile {sid} moved"
            assert all(i["at"] <= SETTLE_MS and i["end"] <= SETTLE_MS for i in items if i["end"] >= 0), items
            page.keyboard.press("ArrowLeft")
            advance(page, ACK_MS)
            expect(slider(page)).to_have_attribute("aria-valuenow", str(s - STEP), timeout=QUICK_MS)
            assert dial_moved(page, dial_settled), "scrubbing back did not move the dial"
    finally:
        release(jo, h["ref"])


def test_reduced_motion(app_url, browser):
    op, jo, h, st, d, s = motion_setup(app_url)
    release(jo, h["ref"])
    try:
        with ui(browser, app_url, reduced=True) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            listbox = page.get_by_role("listbox", name="Time")
            shows(page, listbox)
            options = listbox.get_by_role("option")
            expect(options).to_have_count(TIME_OPTIONS)
            expect(options.first).to_have_text("00:00")
            expect(options.last).to_have_text("24:00")
            click(listbox.get_by_role("option", name=hhmm(s), exact=True))
            eventually(page, lambda: expect(slider(page)).to_have_attribute("aria-valuenow", str(s), timeout=QUICK_MS))
            select_free(page, st)
            click(page.get_by_role("button", name="Hold this station"))
            dlg = page.get_by_role("dialog", name="Place hold")
            shows(page, dlg)
            select(dlg.get_by_role("combobox", name="Start"), hhmm(s))
            select(dlg.get_by_role("combobox", name="End"), hhmm(s + MIN_LEN))
            with held(page, "**/api/holds") as gate:
                click(dlg.get_by_role("button", name="Place hold"))
                shows(page, page.get_by_text("Working…"))
                gate.release()
            shows(page, hold_region(page))
            mine = wait_for(lambda: own_hold(jo, d, st, s, s + MIN_LEN), UI_DEADLINE, "the select-placed hold is not on the server")
            h = {"ref": mine["hold_ref"]}
            ui_minute(page, s - STEP)
            install_recorder(page)
            slider(page).focus()
            page.keyboard.press("ArrowRight")
            advance(page, ACK_MS)
            expect(slider(page)).to_have_attribute("aria-valuenow", str(s), timeout=QUICK_MS)
            expect(tile(page, st, f"held by {NAMES[J]}")).to_be_visible(timeout=QUICK_MS)
            assert not [i for i in motion_items(page) if i["tile"] >= 0 and i["end"] > ACK_MS], "a tile animated past a tenth of a second under reduced motion"
    finally:
        release(jo, h["ref"])


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layout(app_url, browser, viewport):
    size = VIEWPORTS[viewport]
    op = login(app_url, OPERATOR)
    link = op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_DAY}).json()
    try:
        with ui(browser, app_url, size=size) as page:
            ui_signin(page, app_url, OPERATOR)
            plan = page.get_by_role("group", name="Floor plan")
            rail = page.get_by_role("region", name="Selected instant")
            shows(page, rail)
            p, r = plan.bounding_box(), rail.bounding_box()
            assert p["x"] >= 0 and p["x"] + p["width"] <= size["width"]
            menu = page.get_by_role("button", name="Menu")
            nav_link = page.get_by_role("navigation", name="Main").get_by_role("link", name="Bookings", exact=True)
            if size["width"] == VIEWPORTS["1280x800"]["width"]:
                assert p["x"] + p["width"] / 2 < size["width"] * 2 / 3 <= r["x"] + r["width"] / 2
                assert r["y"] < size["height"] and p["y"] + p["height"] <= size["height"]
                expect(menu).to_be_hidden()
                expect(nav_link).to_be_visible()
            else:
                assert r["y"] >= p["y"] + p["height"]
                if size["width"] == VIEWPORTS["375x812"]["width"]:
                    expect(nav_link).to_be_hidden()
                    click(menu)
                    shows(page, nav_link)
                else:
                    expect(menu).to_be_hidden()
                    expect(nav_link).to_be_visible()
            layout(page)
            for path in ("/bookings", "/documents", "/billing", "/tenants", "/settings"):
                page.goto(app_url + path)
                eventually(page, lambda: expect(page.get_by_role("button", name="Sign out")).to_be_visible(timeout=QUICK_MS) if size["width"] > VIEWPORTS["375x812"]["width"] else expect(menu).to_be_visible(timeout=QUICK_MS))
                layout(page)
            page.goto(app_url + link["url"])
            shows(page, page.get_by_role("heading", name=NAMES[L], level=1))
            layout(page)
    finally:
        op.delete(f"/api/tenants/{L}/inspection-link")


def test_wf_dial_reading_operator(app_url, browser):
    op, lo = login(app_url, OPERATOR), login(app_url, L_OWNER)
    st, d, s = find_slot(op, *span(op, L, 1), MIN_LEN)
    notes = "Prep " + token("op")
    h = hold(lo, st, d, s, s + MIN_LEN, notes=notes)
    try:
        assert next(b for b in station_blocks(op, d, st) if b.get("hold_ref") == h["ref"])["contact_email"] == L_OWNER
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, OPERATOR)
            ui_day(page, d)
            ui_minute(page, s)
            t = tile(page, st, f"held by {NAMES[L]}")
            shows(page, t)
            click(t)
            eventually(page, lambda: expect(t).to_have_attribute("aria-pressed", "true", timeout=QUICK_MS))
            rail = page.get_by_role("region", name="Selected instant")
            for value in (NAMES[L], L_OWNER, notes):
                says(page, rail, value)
            ui_minute(page, s + MIN_LEN)
            shows(page, tile(page, st, "cleaning"))
            says(page, rail, "Cleaning")
            n = sum(1 for k in states_at(op, d, s + MIN_LEN).values() if k == "free")
            eventually(page, lambda: expect(slider(page)).to_have_attribute("aria-valuetext", f"{hhmm(s + MIN_LEN)}, {n} of {len(STATION_IDS)} open", timeout=QUICK_MS))
    finally:
        release(lo, h["ref"])


def test_wf_dial_reading_tenant_view(app_url, browser):
    op, lo = login(app_url, OPERATOR), login(app_url, L_OWNER)
    st, d, s = find_slot(op, *span(op, L, 1), MIN_LEN)
    notes = "Hidden " + token("tv")
    h = hold(lo, st, d, s, s + MIN_LEN, notes=notes)
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, s)
            t = tile(page, st, "booked")
            shows(page, t)
            expect(t).to_contain_text("Booked")
            click(t)
            rail = page.get_by_role("region", name="Selected instant")
            says(page, rail, f"until {hhmm(s + MIN_LEN)}")
            body = page.locator("body").inner_text()
            assert NAMES[L] not in body and L_OWNER not in body and notes not in body
        assert set(next(b for b in station_blocks(login(app_url, J_OWNER), d, st) if b["start_minute"] == s)) == ANON_BLOCK_KEYS
    finally:
        release(lo, h["ref"])


def test_wf_dial_reading_timezone(app_url, browser):
    op = login(app_url, OPERATOR)
    context = browser.new_context(timezone_id=TOKYO, viewport=DESKTOP)
    try:
        page = context.new_page()
        page.goto(app_url + "/signin")
        page.get_by_role("textbox", name="Email").fill(OPERATOR)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        expect(slider(page)).to_be_visible(timeout=UI_DEADLINE * 1000)
        kitchen_today = server_time(op).astimezone(CHICAGO).date().isoformat()
        expect(page.get_by_label("Day", exact=True)).to_have_value(kitchen_today)
        assert dial(op)["today"] == kitchen_today
    finally:
        context.close()


def ring(page: Page) -> tuple[float, float, float]:
    plan = page.get_by_role("group", name="Floor plan").bounding_box()
    box = slider(page).bounding_box()
    if box["width"] < plan["width"]:
        cx, cy = plan["x"] + plan["width"] / 2, plan["y"] + plan["height"] / 2
        hx, hy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        return cx, cy, math.hypot(hx - cx, hy - cy)
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    outer = min(box["width"], box["height"]) / 2
    found = slider(page).evaluate(
        """(el, p) => {
            const hits = [];
            for (const deg of [30, 120, 210, 300]) {
                const a = deg * Math.PI / 180;
                let fallback = 0;
                for (let r = p.outer - 1; r > p.outer * 0.25; r -= 1) {
                    const node = document.elementFromPoint(p.cx + r * Math.sin(a), p.cy - r * Math.cos(a));
                    if (!node) continue;
                    if (node !== el && el.contains(node)) { hits.push(r); fallback = 0; break; }
                    if (node === el && !fallback) fallback = r;
                }
                if (fallback) hits.push(fallback);
            }
            return hits;
        }""",
        {"cx": cx, "cy": cy, "outer": outer})
    if found:
        return cx, cy, sorted(found)[len(found) // 2]
    inner = math.hypot(plan["width"], plan["height"]) / 2
    return cx, cy, (inner + outer) / 2


def at_angle(geometry: tuple[float, float, float], minute: int) -> tuple[float, float]:
    cx, cy, r = geometry
    a = math.radians(minute / 4)
    return cx + r * math.sin(a), cy - r * math.cos(a)


def draw_arc(page: Page, geometry: tuple[float, float, float], start: int, end: int) -> None:
    page.mouse.move(*at_angle(geometry, start))
    page.mouse.down()
    for m in range(start + STEP, end + 1, STEP):
        page.mouse.move(*at_angle(geometry, m), steps=ARC_MOVE_STEPS)
    page.mouse.up()


def test_wf_place_hold_arc(app_url, browser):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN, starts=range(ARC_FROM, ARC_TO, STEP), free_at=(0,))
    placed = None
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, 0)
            select_free(page, st)
            draw_arc(page, ring(page), s, s + MIN_LEN)
            shows(page, hold_region(page))
            placed = wait_for(lambda: own_hold(jo, d, st, s, s + MIN_LEN), UI_DEADLINE, "the drawn arc is not a server hold")
            assert placed["tenant_id"] == J
    finally:
        if placed:
            release(jo, placed["hold_ref"])


def test_wf_place_hold_arc_conflict(app_url, browser):
    op, jo, jc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN + BUFFER, starts=range(ARC_FROM, ARC_TO, STEP), free_at=(0,))
    blocker = hold(jc, st, d, s + BUFFER, s + MIN_LEN + BUFFER)
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, 0)
            select_free(page, st)
            draw_arc(page, ring(page), s, s + MIN_LEN)
            says(page, problem(page), f"{STATIONS[st][0]} isn't free for that whole time, including cleaning. Pick another gap.")
        assert own_hold(op, d, st, s, s + MIN_LEN) is None
    finally:
        release(jc, blocker["ref"])


def test_wf_place_hold_form(app_url, browser):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    policy = policy_now(jo)
    with ui(browser, app_url) as page:
        ui_signin(page, app_url, J_OWNER)
        ui_day(page, d)
        ui_minute(page, s)
        ref = ui_hold_by_form(page, st)
        try:
            region = page.get_by_role("region", name=f"Hold {ref}")
            expect(region.get_by_role("timer", name="Hold time left")).to_contain_text(re.compile(r"Expires in \d+:\d\d"))
            group = region.get_by_role("radiogroup", name="Pay with")
            expect(group.get_by_role("radio", name="Account")).to_be_checked()
            expect(group.get_by_role("radio", name="Hour pack")).to_be_visible()
            expect(region).to_contain_text(f"Cancellation: free until {policy['free_window_hours']} hours before start, then {policy['late_fee_percent']}% charge (policy v{policy['version']})")
            hold_body = jo.get(f"/api/holds/{ref}").json()
            assert (hold_body["station_id"], hold_body["bookings"][0]["start_local"], hold_body["bookings"][0]["end_local"]) == (st, hhmm(s), hhmm(s + MIN_LEN))
            click(region.get_by_role("button", name="Release hold"))
            says(page, activity(page), f"Hold {ref} released.")
            wait_for(lambda: jo.get(f"/api/holds/{ref}").status_code == 404, UI_DEADLINE, "the released hold is still live")
        finally:
            release(jo, ref)


def ui_confirm(page: Page, ref: str, pay: str = "Account") -> None:
    region = page.get_by_role("region", name=f"Hold {ref}")
    if pay != "Account":
        radio = region.get_by_role("radio", name=pay)
        if not radio.is_checked():
            radio.check(force=True)
        expect(radio).to_be_checked()
    click(region.get_by_role("button", name="Confirm booking"))


def test_wf_confirm_booking_happy(app_url, browser, mail, killbill):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    ref = None
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, s)
            ref = ui_hold_by_form(page, st)
            ui_confirm(page, ref)
            says(page, activity(page), f"Booked. Confirmation for {ref} was emailed to {J_OWNER}.")
            shows(page, tile(page, st, f"booked by {NAMES[J]}"))
            nav_to(page, "Bookings")
            fill(page.get_by_role("searchbox", name="Search bookings"), f"{ref}-1")
            table = page.get_by_role("table", name="Bookings")
            says(page, table, f"{ref}-1")
            expect(table).to_contain_text("Confirmed")
        [b] = jo.get("/api/bookings", params={"q": f"{ref}-1"}).json()["bookings"]
        assert b["status"] == "confirmed" and b["station_id"] == st and b["start_local"] == hhmm(s)
        await_mail(mail, J_OWNER, f"Stationkeeper: booking {ref} confirmed")
        assert killbill.account_by_key(J)
        cancel_all(jo, [b])
    finally:
        if ref:
            release(jo, ref)


def test_wf_confirm_booking_billing_outage(app_url, browser, mail):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    ref = None
    try:
        with ui(browser, down) as page:
            ui_signin(page, down, J_OWNER)
            ui_day(page, d)
            ui_minute(page, s)
            ref = ui_hold_by_form(page, st)
            ui_confirm(page, ref)
            says(page, problem(page), "Billing is unreachable. Nothing was booked or charged, and your hold is kept until it expires.")
            expect(page.get_by_role("region", name=f"Hold {ref}")).to_be_visible()
        body = jo.get(f"/api/holds/{ref}")
        assert body.status_code == 200 and body.json()["bookings"][0]["status"] == "held"
        assert not settled(mail, J_OWNER, f"Stationkeeper: booking {ref} confirmed")
    finally:
        if ref:
            release(jo, ref)


def ui_weekly(page: Page, station: str, weeks_label: str) -> str:
    select_free(page, station)
    click(page.get_by_role("button", name="Hold this station"))
    dlg = page.get_by_role("dialog", name="Place hold")
    shows(page, dlg)
    select(dlg.get_by_role("combobox", name="Repeat weekly"), weeks_label)
    click(dlg.get_by_role("button", name="Place hold"))
    says(page, activity(page), re.compile(r"Hold SK-\d+ placed\."))
    return re.search(r"Hold (SK-\d+) placed", activity(page).inner_text()).group(1)


def test_wf_recurring_bookings_weekly(app_url, browser):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN, weeks=2)
    ref = None
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, s)
            ref = ui_weekly(page, st, "2 weeks")
            ui_confirm(page, ref)
            says(page, activity(page), f"Booked. Confirmation for {ref} was emailed to {J_OWNER}.")
        found = sorted(jo.get("/api/bookings", params={"q": ref}).json()["bookings"], key=lambda b: b["date"])
        assert [b["date"] for b in found] == [d.isoformat(), (d + timedelta(days=7)).isoformat()]
        assert all(b["status"] == "confirmed" and b["start_local"] == hhmm(s) and b["end_local"] == hhmm(s + MIN_LEN) for b in found)
        cancel_all(jo, found)
    finally:
        if ref:
            release(jo, ref)


def test_wf_recurring_bookings_dst(app_url, browser):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    first, last = span(op, J, FAR_DAYS)
    changes = [t for t, _ in dst_changes(first + timedelta(days=7), last)]
    assert changes, "no clock change inside the booking window"
    t = changes[0]
    d = t - timedelta(days=7)
    s = 5 * HOUR
    slots = Slots(op)
    st = next((x for x in STATION_IDS if slots.free(x, d, s, s + MIN_LEN) and slots.free(x, t, s, s + MIN_LEN)), None)
    assert st, "no station free for the DST series"
    ref = None
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, s)
            ref = ui_weekly(page, st, "2 weeks")
        bookings = jo.get(f"/api/holds/{ref}").json()["bookings"]
        for b, day in zip(bookings, (d, t)):
            got = instant(b["start"])
            assert b["start_local"] == "05:00" and got == local_instant(day, s) and got.utcoffset() == local_instant(day, s).utcoffset()
        assert instant(bookings[0]["start"]).utcoffset() != instant(bookings[1]["start"]).utcoffset()
    finally:
        if ref:
            release(jo, ref)


def open_checkout(page: Page, ref: str) -> Locator:
    dlg = page.get_by_role("dialog", name=f"Check out {ref}")
    if not dlg.is_visible():
        click(page.get_by_role("button", name=f"Check out {ref}"))
        shows(page, dlg)
    return dlg


def test_wf_check_in_out_cook_journey(app_url, browser, mail):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    got = book_today(op, jo)
    if got is None:
        fst, fd, fs = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
        future = book(jo, fst, fd, fs, fs + MIN_LEN)[0]
        try:
            with ui(browser, app_url) as page:
                ui_signin(page, app_url, J_COOK)
                nav_to(page, "Bookings")
                fill(page.get_by_role("searchbox", name="Search bookings"), future["ref"])
                table = page.get_by_role("table", name="Bookings")
                says(page, table, future["ref"])
                expect(table).to_contain_text("Confirmed")
            assert booking(jo, future["id"])["status"] == "confirmed"
        finally:
            cancel_all(jo, [future])
        return
    b, st = got
    rate = STATIONS[st][2]
    with ui(browser, app_url) as page:
        ui_signin(page, app_url, J_COOK)
        nav_to(page, "Bookings")
        says(page, page.get_by_role("table", name="Bookings"), b["ref"])
        click(page.get_by_role("button", name=f"Check in {b['ref']}"))
        says(page, activity(page), re.compile(rf"Checked in to {re.escape(STATIONS[st][0])} at \d\d:\d\d\."))
        dlg = open_checkout(page, b["ref"])
        fill(dlg.get_by_role("spinbutton", name="Minutes past booked end"), "11")
        click(dlg.get_by_role("button", name="Check out"))
        says(page, activity(page), f"Checked out. Hold-over billed: 15 min ({dollars(15 * rate // HOUR)}).")
        says(page, page.get_by_role("table", name="Bookings"), "Completed")
    stored = booking(jo, b["id"])
    assert stored["status"] == "completed" and stored["holdover"] == {"reported_minutes": 11, "billed_minutes": 15, "amount_cents": 15 * rate // HOUR}
    await_mail(mail, J_OWNER, f"Stationkeeper: hold-over recorded on {b['ref']}")


def test_wf_check_in_out_outage(app_url, browser, relayed, mail, killbill):
    op = login(app_url, OPERATOR)
    rj = login(relayed.url, J_OWNER)
    got = book_today(op, rj)
    if got is None:
        fst, fd, fs = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
        future = book(rj, fst, fd, fs, fs + MIN_LEN)[0]
        try:
            refused(login(app_url, J_COOK).post(f"/api/bookings/{future['id']}/check-out", json={"holdover_minutes": 16}), 409, "invalid_transition")
            assert booking(op, future["id"])["holdover"] is None
            assert not kb_described(killbill, J, f"Hold-over {future['ref']}")
        finally:
            cancel_all(rj, [future])
        return
    b, _ = got
    assert login(app_url, J_COOK).post(f"/api/bookings/{b['id']}/check-in", json={}).status_code == 200
    subject = f"Stationkeeper: hold-over recorded on {b['ref']}"
    try:
        with ui(browser, relayed.url) as page:
            ui_signin(page, relayed.url, J_COOK)
            nav_to(page, "Bookings")
            says(page, page.get_by_role("table", name="Bookings"), b["ref"])
            relayed.kb.set(False)
            dlg = open_checkout(page, b["ref"])
            fill(dlg.get_by_role("spinbutton", name="Minutes past booked end"), "16")
            click(dlg.get_by_role("button", name="Check out"))
            says(page, problem(page), "Billing is unreachable. Nothing was charged; try again in a moment.")
            assert booking(op, b["id"])["status"] == "checked_in" and booking(op, b["id"])["holdover"] is None
            relayed.kb.set(True)
            relayed.smtp.set(False)
            dlg = open_checkout(page, b["ref"])
            fill(dlg.get_by_role("spinbutton", name="Minutes past booked end"), "16")
            click(dlg.get_by_role("button", name="Check out"))
            says(page, problem(page), "Email is unreachable. Nothing was recorded; try again in a moment.")
            assert booking(op, b["id"])["status"] == "checked_in" and booking(op, b["id"])["holdover"] is None
            relayed.smtp.set(True)
            dlg = open_checkout(page, b["ref"])
            fill(dlg.get_by_role("spinbutton", name="Minutes past booked end"), str(GRACE))
            click(dlg.get_by_role("button", name="Check out"))
            says(page, activity(page), "Checked out. No hold-over billed.")
        done = booking(op, b["id"])
        assert done["status"] == "completed" and done["holdover"]["reported_minutes"] == GRACE and done["holdover"]["billed_minutes"] == 0
        assert not settled(mail, J_OWNER, subject, settle=MAIL_SETTLE_S)
        desc = f"Hold-over {b['ref']}"
        wait_for(lambda: kb_net(killbill, J, desc) == 0, MAIL_DEADLINE, f"{desc} is still charged after refused check-outs")
    finally:
        for r in (relayed.kb, relayed.s3, relayed.smtp):
            r.set(True)


def test_wf_cancellation_policy_policy_change(app_url, browser):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    base_late = 40
    strict_late = 80
    old = save_policy(op, FREE_WINDOW_MAX, base_late)
    try:
        st, d, s = find_slot(op, *span(op, J, 2, 6), MIN_LEN)
        b = book(jo, st, d, s, s + MIN_LEN)[0]
        assert b["policy"]["version"] == old["version"]
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, OPERATOR)
            nav_to(page, "Settings")
            form = page.get_by_role("form", name="Cancellation policy")
            shows(page, form)
            fill(form.get_by_role("spinbutton", name="Free cancellation window (hours)"), str(FREE_WINDOW_MAX))
            fill(form.get_by_role("spinbutton", name="Late cancellation charge (%)"), str(strict_late))
            click(form.get_by_role("button", name="Save policy"))
            says(page, activity(page), f"Policy version {old['version'] + 1} applies to bookings confirmed from now on. Existing bookings keep their terms.")
            says(page, page.get_by_role("table", name="Policy history"), str(old["version"] + 1))
        assert policy_now(op)["late_fee_percent"] == strict_late
        fee = half_up(Decimal(b["amount_cents"]) * base_late / 100)
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            nav_to(page, "Bookings")
            fill(page.get_by_role("searchbox", name="Search bookings"), b["ref"])
            advance(page, SETTLE_MS)
            click(page.get_by_role("button", name=f"Cancel {b['ref']}"))
            dlg = page.get_by_role("dialog", name=f"Cancel booking {b['ref']}")
            shows(page, dlg)
            click(dlg.get_by_role("button", name="Cancel booking"))
            says(page, activity(page), f"Booking {b['ref']} cancelled. Late cancellation charge: {dollars(fee)}.")
        done = booking(jo, b["id"])
        assert done["policy"]["version"] == old["version"] and done["cancellation"]["fee_cents"] == fee
    finally:
        save_policy(op, SEED_FREE_HOURS, SEED_LATE_PERCENT)


def test_wf_cancellation_policy_stale(app_url, browser):
    op = login(app_url, OPERATOR)
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, OPERATOR)
            nav_to(page, "Settings")
            form = page.get_by_role("form", name="Cancellation policy")
            shows(page, form)
            newer = save_policy(op, SEED_FREE_HOURS, SEED_LATE_PERCENT)
            fill(form.get_by_role("spinbutton", name="Late cancellation charge (%)"), str(LATE_PROBE))
            click(form.get_by_role("button", name="Save policy"))
            says(page, problem(page), f"The policy changed since you opened it. Reload to see version {newer['version']}.")
        assert policy_now(op)["version"] == newer["version"]
    finally:
        save_policy(op, SEED_FREE_HOURS, SEED_LATE_PERCENT)


def test_wf_hour_packs_buy(app_url, browser, killbill):
    jo = login(app_url, J_OWNER)
    before = ledger(jo)["balance_minutes"]
    payments = len(kb_transactions(killbill, J, lambda k: k.startswith("pack-")))
    with ui(browser, app_url) as page:
        ui_signin(page, app_url, J_OWNER)
        nav_to(page, "Billing")
        region = page.get_by_role("region", name="Hour pack")
        says(page, region, f"Balance {hmm(before)}")
        click(region.get_by_role("button", name=f"Buy {PACKS['10h'][0]}"))
        says(page, activity(page), f"{PACKS['10h'][0]} added. Balance: {hmm(before + PACKS['10h'][1])}.")
        expect(page.get_by_role("table", name="Hour ledger")).to_be_visible()
    assert ledger(jo)["balance_minutes"] == before + PACKS["10h"][1]
    assert len(kb_transactions(killbill, J, lambda k: k.startswith("pack-"))) == payments + 1


def test_wf_hour_packs_pay_with_pack(app_url, browser):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    ensure_hours(jo, MIN_LEN)
    before = ledger(jo)["balance_minutes"]
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    ref = None
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, s)
            ref = ui_hold_by_form(page, st)
            ui_confirm(page, ref, "Hour pack")
            says(page, activity(page), f"Booked. Confirmation for {ref} was emailed to {J_OWNER}.")
        [b] = jo.get("/api/bookings", params={"q": ref}).json()["bookings"]
        assert b["pay_with"] == "hour_pack" and ledger(jo)["balance_minutes"] == before - b["elapsed_minutes"]
        cancel_all(jo, [b])
    finally:
        if ref:
            release(jo, ref)


def ui_upload(page: Page, kind_label: str, expires: date, name: str, data: bytes, mime: str, holder: str | None = None) -> None:
    form = page.get_by_role("form", name="Upload document")
    shows(page, form)
    select(form.get_by_role("combobox", name="Document type"), kind_label)
    fill(form.get_by_label("Expiry date", exact=True), expires.isoformat())
    if holder:
        fill(form.get_by_role("textbox", name="Name on card"), holder)
    form.get_by_label("Document file", exact=True).set_input_files({"name": name, "mimeType": mime, "buffer": data})
    click(form.get_by_role("button", name="Upload document"))


def test_wf_document_upload_happy(app_url, browser, bucket):
    jo = login(app_url, J_OWNER)
    expires = today_of(jo) + timedelta(days=300 + secrets.randbelow(60))
    data = pdf(token("wfup"))
    before = {x["id"] for x in documents(jo)}
    with ui(browser, app_url) as page:
        ui_signin(page, app_url, J_OWNER)
        nav_to(page, "Documents")
        ui_upload(page, "Certificate of insurance", expires, "renewal.pdf", data, "application/pdf")
        says(page, activity(page), "Certificate of insurance uploaded. The kitchen will review it.")
        table = page.get_by_role("table", name="Documents")
        says(page, table, expires.isoformat())
        expect(table).to_contain_text("Awaiting review")
    [doc] = [x for x in documents(jo) if x["id"] not in before]
    assert doc["status"] == "pending_review" and doc["expires_on"] == expires.isoformat()
    assert bucket.get(f"tenants/{J}/documents/{doc['id']}.pdf") == data


def test_wf_document_upload_wrong_type(app_url, browser, bucket):
    jo = login(app_url, J_OWNER)
    prefix = f"tenants/{J}/documents/"
    before, keys = {x["id"] for x in documents(jo)}, set(bucket.keys(prefix))
    with ui(browser, app_url) as page:
        ui_signin(page, app_url, J_OWNER)
        nav_to(page, "Documents")
        ui_upload(page, "Health permit", today_of(jo) + timedelta(days=300), "permit.pdf", UPLOAD_BODIES["svg_named_png"][0], "application/pdf")
        says(page, problem(page), "Only PDF, JPEG or PNG files are accepted. This file is not one of them.")
    assert {x["id"] for x in documents(jo)} == before and set(bucket.keys(prefix)) == keys


def test_wf_compliance_review_reinstatement(app_url, browser, mail):
    op, so = login(app_url, OPERATOR), login(app_url, S_OWNER)
    since = seen(mail)
    was = op.get(f"/api/tenants/{S}").json()["status"]
    today = today_of(op)
    if was == "suspended":
        refused(place(so, "hot-line-1", today + timedelta(days=1), 10 * HOUR, 11 * HOUR), 409, "tenant_not_active")
    expires = today + timedelta(days=300 + secrets.randbelow(60))
    with ui(browser, app_url) as page:
        ui_signin(page, app_url, S_OWNER)
        nav_to(page, "Documents")
        if was == "suspended":
            shows(page, page.get_by_text("Suspended", exact=True).first)
        ui_upload(page, "Certificate of insurance", expires, "renewed.pdf", pdf(token("salt")), "application/pdf")
        says(page, activity(page), "Certificate of insurance uploaded. The kitchen will review it.")
    with ui(browser, app_url) as page:
        ui_signin(page, app_url, OPERATOR)
        nav_to(page, "Documents")
        click(page.get_by_role("button", name=f"Approve Certificate of insurance for {NAMES[S]}, expires {expires.isoformat()}"))
        says(page, activity(page), f"Certificate of insurance for {NAMES[S]} approved. The owner's email is queued.")
    tenant = op.get(f"/api/tenants/{S}").json()
    assert tenant["status"] == "active" and tenant["required_documents"]["certificate_of_insurance"]["valid"] is True
    await_mail(mail, S_OWNER, "Stationkeeper: Certificate of insurance approved", since=since)
    st, d, s = find_slot(op, *span(op, S, 1), MIN_LEN)
    h = hold(so, st, d, s, s + MIN_LEN)
    release(so, h["ref"])


def test_wf_compliance_review_reject(app_url, browser, mail):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    since = seen(mail)
    expires = today_of(op) + timedelta(days=400 + secrets.randbelow(200))
    doc = upload(jo, "food_handler_card", expires, pdf(token("wfrej")), holder="Holder " + token("wfrej")).json()
    reason = "Unreadable scan " + token("why")
    with ui(browser, app_url) as page:
        ui_signin(page, app_url, OPERATOR)
        nav_to(page, "Documents")
        click(page.get_by_role("button", name=f"Reject Food handler card for {NAMES[J]}, expires {expires.isoformat()}"))
        dlg = page.get_by_role("dialog", name="Reject document")
        shows(page, dlg)
        fill(dlg.get_by_role("textbox", name="Reason"), reason)
        click(dlg.get_by_role("button", name="Send rejection"))
        says(page, activity(page), f"Food handler card for {NAMES[J]} rejected. The owner's email is queued.")
    stored = jo.get(f"/api/documents/{doc['id']}").json()
    assert stored["status"] == "rejected" and stored["rejection_reason"] == reason
    await_mail(mail, J_OWNER, "Stationkeeper: Food handler card needs attention", contains=(reason,), since=since)


def test_wf_inspection_links_issue_revoke(app_url, browser):
    op = login(app_url, OPERATOR)
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, OPERATOR)
            nav_to(page, "Tenants")
            click(page.get_by_role("button", name=f"Inspection link for {NAMES[L]}"))
            dlg = page.get_by_role("dialog", name=f"Inspection link for {NAMES[L]}")
            shows(page, dlg)
            select(dlg.get_by_role("combobox", name="Link lasts"), "24 hours")
            click(dlg.get_by_role("button", name="Issue link"))
            says(page, activity(page), re.compile(r"Link issued\. It expires \d{4}-\d\d-\d\d \d\d:\d\d kitchen time\. Any earlier link for this tenant no longer works\."))
            value = dlg.get_by_role("textbox", name="Link").input_value()
            path = "/inspect/" + value.split("/inspect/", 1)[1]
            assert op.get(f"/api/tenants/{L}/inspection-link").json()["url"] == path
            with ui(browser, app_url + path) as inspector:
                shows(inspector, inspector.get_by_role("heading", name=NAMES[L], level=1))
                expect(inspector.get_by_text(f"Current documents at {KITCHEN}")).to_be_visible()
                expect(inspector.get_by_role("list", name="Current documents")).to_be_visible()
                click(dlg.get_by_role("button", name="Revoke link"))
                says(page, activity(page), "Link revoked.")
                inspector.reload()
                shows(inspector, inspector.get_by_role("heading", name="This inspection link is no longer valid", level=1))
        refused(client(app_url).get(f"/api/inspect/{path.rsplit('/', 1)[1]}"), 410, "link_expired")
    finally:
        op.delete(f"/api/tenants/{L}/inspection-link")


def test_wf_inspection_links_inspector_view(app_url, browser):
    op = login(app_url, OPERATOR)
    link = op.post(f"/api/tenants/{L}/inspection-link", json={"expires_in_seconds": LINK_DAY}).json()
    expected = inspector_expected(op, L)
    docs = {d["id"]: d for d in documents(op, L)}
    try:
        with ui(browser, app_url + link["url"]) as page:
            listing = page.get_by_role("list", name="Current documents")
            shows(page, listing)
            for doc_id in expected:
                d = docs[doc_id]
                label = f"Open {KIND_LABELS[d['kind']]}" + (f", {d['holder_name']}" if d["kind"] == "food_handler_card" else "")
                expect(listing.get_by_role("link", name=label, exact=True)).to_be_visible()
            local = instant(link["expires_at"]).astimezone(CHICAGO).strftime("%Y-%m-%d %H:%M")
            expect(page.get_by_text(f"This link expires {local} kitchen time.")).to_be_visible()
            assert L_OWNER not in page.locator("body").inner_text()
    finally:
        op.delete(f"/api/tenants/{L}/inspection-link")


def test_wf_invoicing_month_end(app_url, browser, bucket, killbill, mail):
    op = login(app_url, OPERATOR)
    since = seen(mail)
    period = past_period()
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, OPERATOR)
            nav_to(page, "Tenants")
            shelf_name = f"Walk-in shelf {SHELVES[3]}"
            select(page.get_by_role("combobox", name=f"Tenant for {shelf_name}"), NAMES[L])
            says(page, activity(page), f"{shelf_name} assigned to {NAMES[L]}.")
            assert next(s for s in op.get("/api/shelves").json()["shelves"] if s["id"] == SHELVES[3])["tenant_id"] == L
            nav_to(page, "Billing")
            select(page.get_by_role("combobox", name="Tenant"), NAMES[L])
            fill(page.get_by_label("Invoice month", exact=True), period)
            click(page.get_by_role("button", name="Issue invoice"))
            says(page, activity(page), re.compile(rf"Invoice INV-{period.replace('-', '')}-\d{{4}} issued\. Its email notice is queued for {re.escape(NAMES[L])}\."))
            number = re.search(r"Invoice (INV-\d{6}-\d{4}) issued", activity(page).inner_text()).group(1)
        [inv] = invoices_for(op, L, period)
        assert inv["number"] == number and len([l for l in inv["lines"] if l["kind"] == "storage"]) >= 2
        stored = bucket.get(f"invoices/{L}/{number}.pdf")
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, L_OWNER)
            nav_to(page, "Billing")
            link = page.get_by_role("link", name=f"Download PDF {number}")
            shows(page, link)
            with page.expect_download() as download:
                click(link)
            assert Path(download.value.path()).read_bytes() == stored
            click(page.get_by_role("button", name=f"Pay invoice {number}"))
            says(page, activity(page), f"Invoice {number} paid. A receipt is queued for {L_OWNER}.")
            says(page, page.get_by_role("table", name="Invoices"), "Paid")
        assert op.get(f"/api/invoices/{inv['id']}").json()["status"] == "paid"
        [tx] = kb_transactions(killbill, L, lambda k: k == f"invoice-{number}")
        assert kb_cents(tx) == inv["total_cents"]
        await_mail(mail, L_OWNER, f"Stationkeeper: receipt for invoice {number}", since=since)
        await_mail(mail, L_OWNER, f"Stationkeeper: invoice {number} is ready", since=since)
    finally:
        op.put(f"/api/shelves/{SHELVES[3]}", json={"tenant_id": None})


def test_wf_invoicing_storage_outage(app_url, browser):
    down = os.environ["APP_MINIO_DOWN_URL"]
    op = login(app_url, OPERATOR)
    period = past_period()
    with ui(browser, down) as page:
        ui_signin(page, down, OPERATOR)
        nav_to(page, "Billing")
        select(page.get_by_role("combobox", name="Tenant"), NAMES[J])
        fill(page.get_by_label("Invoice month", exact=True), period)
        click(page.get_by_role("button", name="Issue invoice"))
        says(page, problem(page), "Document storage is unreachable. No invoice was issued; try again in a moment.")
    assert not invoices_for(op, J, period)


def search_fixture(app_url: str) -> tuple[httpx.Client, httpx.Client, str, list[dict], list[dict]]:
    op, jo, lo = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, L_OWNER)
    tok = token("ui")
    slot = lambda w: (lambda x: (x[0], x[1], x[2], x[2] + MIN_LEN))(find_slot(op, *w, MIN_LEN))
    mine = book(jo, *slot(span(op, J, FAR_DAYS)), notes=f"{tok} jr") + book(jo, *slot(span(op, J, FAR_DAYS)), notes=f"{tok} jr")
    theirs = book(lo, *slot(span(op, L, 1)), notes=f"{tok} ls")
    return jo, lo, tok, mine, theirs


def test_wf_bookings_search_export_search(app_url, browser):
    jo, lo, tok, mine, theirs = search_fixture(app_url)
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            nav_to(page, "Bookings")
            fill(page.get_by_role("searchbox", name="Search bookings"), tok)
            table = page.get_by_role("table", name="Bookings")
            for b in mine:
                says(page, table, b["ref"])
            expect(table).not_to_contain_text(theirs[0]["ref"])
        assert {b["ref"] for b in jo.get("/api/bookings", params={"q": tok}).json()["bookings"]} == {b["ref"] for b in mine}
    finally:
        cancel_all(jo, mine)
        cancel_all(lo, theirs)


def test_wf_bookings_search_export_export(app_url, browser):
    jo, lo, tok, mine, theirs = search_fixture(app_url)
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            nav_to(page, "Bookings")
            fill(page.get_by_role("searchbox", name="Search bookings"), tok)
            says(page, page.get_by_role("table", name="Bookings"), mine[0]["ref"])
            with page.expect_download() as download:
                click(page.get_by_role("button", name="Export CSV"))
            says(page, activity(page), "Export downloaded.")
            rows = [x for x in csv.reader(io.StringIO(Path(download.value.path()).read_text())) if x]
        assert rows[0] == TENANT_CSV_HEADER
        assert {dict(zip(rows[0], x))["ref"] for x in rows[1:]} == {b["ref"] for b in mine}
    finally:
        cancel_all(jo, mine)
        cancel_all(lo, theirs)


def test_wf_keyboard_booking_keyboard(app_url, browser, mail):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    target = today_of(op) + timedelta(days=FAR_DAYS)
    slots = Slots(op)
    st, s = next(((x, m) for m in range(8 * HOUR, 18 * HOUR, HOUR) for x in STATION_IDS if slots.free(x, target, m, m + MIN_LEN)), (None, None))
    assert st, "no free hour on the keyboard day"
    with ui(browser, app_url) as page:
        ui_signin(page, app_url, J_COOK)
        next_day = page.get_by_role("button", name="Next day")
        tab_to(page, next_day)
        for _ in range(FAR_DAYS):
            page.keyboard.press("Enter")
        eventually(page, lambda: expect(page.get_by_label("Day", exact=True)).to_have_value(target.isoformat(), timeout=QUICK_MS))
        tab_to(page, slider(page))
        page.keyboard.press("Home")
        for _ in range(s // HOUR):
            page.keyboard.press("PageUp")
        eventually(page, lambda: expect(slider(page)).to_have_attribute("aria-valuenow", str(s), timeout=QUICK_MS))
        station = tile(page, st, "free")
        tab_to(page, station)
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(station).to_have_attribute("aria-pressed", "true", timeout=QUICK_MS))
        expect(station).to_contain_text("Free")
        tab_to(page, page.get_by_role("button", name="Hold this station"))
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Place hold")
        shows(page, dlg)
        tab_to(page, dlg.get_by_role("button", name="Place hold"))
        page.keyboard.press("Enter")
        shows(page, hold_region(page))
        says(page, activity(page), re.compile(r"Hold SK-\d+ placed\."))
        ref = re.search(r"Hold (SK-\d+) placed", activity(page).inner_text()).group(1)
        tab_to(page, page.get_by_role("button", name="Confirm booking"))
        page.keyboard.press("Enter")
        page.keyboard.press("Enter")
        says(page, activity(page), f"Booked. Confirmation for {ref} was emailed to {J_OWNER}.")
    subject = f"Stationkeeper: booking {ref} confirmed"
    await_mail(mail, J_OWNER, subject)
    assert len(settled(mail, J_OWNER, subject)) == 1
    [b] = jo.get("/api/bookings", params={"q": ref}).json()["bookings"]
    assert (b["status"], b["station_id"], b["date"], b["start_local"]) == ("confirmed", st, target.isoformat(), hhmm(s))
    cancel_all(jo, [b])


def test_wf_keyboard_booking_dialog_focus(app_url, browser):
    op, jo = login(app_url, OPERATOR), login(app_url, J_OWNER)
    st, d, s = find_slot(op, *span(op, J, FAR_DAYS), MIN_LEN)
    b = book(jo, st, d, s, s + MIN_LEN)[0]

    def trap(page: Page, opener: Locator, dlg: Locator, first: Locator | None) -> None:
        opener.focus()
        page.keyboard.press("Enter")
        shows(page, dlg)
        inside = lambda: bool(dlg.evaluate("d => d.contains(document.activeElement)"))
        eventually(page, lambda: expect(first).to_be_focused(timeout=QUICK_MS) if first is not None else None)
        assert inside()
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert inside(), f"focus left the dialog after {key}"
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dlg).to_be_hidden(timeout=QUICK_MS))
        eventually(page, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))

    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, max(s - 2 * HOUR, 0))
            free = next(x for x in STATION_IDS if states_at(op, d, max(s - 2 * HOUR, 0))[x] == "free")
            select_free(page, free)
            dlg = page.get_by_role("dialog", name="Place hold")
            trap(page, page.get_by_role("button", name="Hold this station"), dlg, dlg.get_by_role("combobox", name="Start"))
            nav_to(page, "Bookings")
            fill(page.get_by_role("searchbox", name="Search bookings"), b["ref"])
            opener = page.get_by_role("button", name=f"Cancel {b['ref']}")
            shows(page, opener)
            trap(page, opener, page.get_by_role("dialog", name=f"Cancel booking {b['ref']}"), None)
        assert booking(jo, b["id"])["status"] == "confirmed"
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, OPERATOR)
            nav_to(page, "Tenants")
            opener = page.get_by_role("button", name=f"Inspection link for {NAMES[L]}")
            shows(page, opener)
            dlg = page.get_by_role("dialog", name=f"Inspection link for {NAMES[L]}")
            trap(page, opener, dlg, dlg.get_by_role("combobox", name="Link lasts"))
    finally:
        cancel_all(jo, [b])


def test_wf_cross_cutting_signin(app_url, browser):
    with ui(browser, app_url) as page:
        page.goto(app_url + "/bookings")
        shows(page, page.get_by_role("button", name="Sign in"))
        fill(page.get_by_role("textbox", name="Email"), J_OWNER)
        fill(page.get_by_label("Password", exact=True), PASSWORD + "x")
        click(page.get_by_role("button", name="Sign in"))
        says(page, problem(page), "That email and password don't match an account.")
        menus = {
            OPERATOR: ["Dial", "Bookings", "Documents", "Billing", "Tenants", "Settings"],
            J_OWNER: ["Dial", "Bookings", "Documents", "Billing"],
            J_COOK: ["Dial", "Bookings"],
        }
        for email, links in menus.items():
            ui_signin(page, app_url, email)
            nav = page.get_by_role("navigation", name="Main")
            for name in ["Dial", "Bookings", "Documents", "Billing", "Tenants", "Settings"]:
                expect(nav.get_by_role("link", name=name, exact=True)).to_have_count(1 if name in links else 0)
            if email != OPERATOR:
                page.goto(app_url + "/settings")
                shows(page, slider(page))
                expect(page.get_by_role("form", name="Cancellation policy")).to_have_count(0)
            click(page.get_by_role("button", name="Sign out"))
            shows(page, page.get_by_role("button", name="Sign in"))


def test_wf_cross_cutting_feedback(app_url, browser):
    op, jo, jc = login(app_url, OPERATOR), login(app_url, J_OWNER), login(app_url, J_COOK)
    first, last = span(op, J, FAR_DAYS)
    st, d, a = find_slot(op, first, last, 3 * HOUR)
    blocker = hold(jc, st, d, a + HOUR, a + 2 * HOUR)
    ref = None
    try:
        with ui(browser, app_url) as page:
            ui_signin(page, app_url, J_OWNER)
            ui_day(page, d)
            ui_minute(page, a + BUFFER)
            select_free(page, st)
            click(page.get_by_role("button", name="Hold this station"))
            dlg = page.get_by_role("dialog", name="Place hold")
            shows(page, dlg)
            click(dlg.get_by_role("button", name="Place hold"))
            says(page, problem(page), f"{STATIONS[st][0]} isn't free for that whole time, including cleaning. Pick another gap.")
            release(jc, blocker["ref"])
            other, od, os_ = find_slot(op, first, last, MIN_LEN)
            if dlg.is_visible():
                page.keyboard.press("Escape")
            ui_day(page, od)
            ui_minute(page, os_)
            select_free(page, other)
            click(page.get_by_role("button", name="Hold this station"))
            shows(page, dlg)
            with held(page, "**/api/holds") as gate:
                click(dlg.get_by_role("button", name="Place hold"))
                says(page, activity(page), "Placing hold…")
                gate.release()
            says(page, activity(page), re.compile(r"Hold SK-\d+ placed\. It expires at \d\d:\d\d:\d\d\."))
            ref = re.search(r"Hold (SK-\d+) placed", activity(page).inner_text()).group(1)
            click(page.get_by_role("region", name=f"Hold {ref}").get_by_role("button", name="Release hold"))
            says(page, activity(page), f"Hold {ref} released.")
        assert jo.get(f"/api/holds/{ref}").status_code == 404
    finally:
        release(jc, blocker["ref"])
        if ref:
            release(jo, ref)


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
FORBIDDEN_STORES = ("SQLite", "Redis")


def shipped_packages() -> dict[tuple[str, str], dict]:
    cwd = "/app" if Path("/app/node_modules").is_dir() else str(conftest.DEPLOYED_APP)
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd, capture_output=True, text=True, timeout=NPM_TIMEOUT)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple[str, str], dict] = {}

    def walk(deps: dict | None) -> None:
        for name, info in (deps or {}).items():
            key = (name, str(info.get("version")))
            if key not in found:
                found[key] = info
                walk(info.get("dependencies"))

    walk(tree.get("dependencies"))
    return found


def licence_ok(value: Any) -> bool:
    if isinstance(value, dict):
        value = value.get("type")
    if not isinstance(value, str):
        return False
    spdx = value.strip("() ")
    if " OR " in spdx:
        return any(licence_ok(x) for x in spdx.split(" OR "))
    if " AND " in spdx:
        return all(licence_ok(x) for x in spdx.split(" AND "))
    return spdx in ALLOWED_LICENCES


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    assert packages
    missing = sorted({name for name, _ in packages if name not in notices})
    assert not missing, missing
    for font in ("Bricolage Grotesque", "Public Sans"):
        assert font in notices


def test_if_licences():
    bad = {f"{n}@{v}": info.get("license") for (n, v), info in shipped_packages().items() if not licence_ok(info.get("license"))}
    assert not bad, bad


def test_if_datastores():
    names = {name.lower() for name, _ in shipped_packages()}
    assert not [n for n in names if any(s.lower() in n for s in FORBIDDEN_STORES)]


def test_if_service_definitions(bucket):
    assert conftest.Postgres().tables()
    for tenant in (J, L, S):
        assert bucket.keys(f"tenants/{tenant}/documents/"), tenant


def test_if_typescript_only():
    skip = {"node_modules", ".git", "dist", "build", "out", ".next", "coverage"}
    ts, js = [], []
    for root, dirs, files in os.walk("/app"):
        dirs[:] = [x for x in dirs if x not in skip]
        for f in files:
            if f.endswith((".ts", ".tsx")):
                ts.append(f)
            elif f.endswith((".js", ".jsx", ".mjs", ".cjs")) and "config" not in f and "rc" not in f:
                js.append(os.path.join(root, f))
    assert ts and not js, js
