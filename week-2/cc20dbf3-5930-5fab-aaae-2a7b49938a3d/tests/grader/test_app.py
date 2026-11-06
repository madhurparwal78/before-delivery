from __future__ import annotations

import json
import os
import re
import struct
import subprocess
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    S3,
    KillBill,
    Mailpit,
    addresses,
    advance,
    animations,
    check,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    same_origin,
    select,
    settle,
    state_styles,
    style,
    tab_order,
    text,
    until,
)
import conftest


APP_DIR = Path("/app")
PASSWORD = "pegboard-2026"
SESSION_COOKIE = "shedline_session"
ZONE = ZoneInfo("America/New_York")
DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
HORIZON_DAYS = 27
MAX_SPAN_DAYS = 7
LANE_DAYS = 28
MAX_ACTIVE = 4
PAGE_DEFAULT = 20
PAGE_MAX = 50
JSON_LIMIT = 16384
UPLOAD_LIMIT = 5500000
STAGE_PHOTOS = 4
NOTE_MAX = 500
BACKGROUND_DELAY_S = 10
OUTAGE_GIVE_UP_S = 5
PROBE_AGE_S = 10
LANE_DROP_MAX_MS = 1500
DIALOG_OPEN_MS = 200
DIALOG_CLOSE_MS = 100
MIN_TARGET_PX = 44
VIEWPORTS = {
    "375": (375, 812),
    "768": (768, 1024),
    "1280": (1280, 800),
}

SPRING_CHECKOUT = "2026-03-05T15:00:00Z"
SPRING_DUE = "2026-03-07"
SPRING_LATE_RETURN = "2026-03-10T22:30:00Z"
SPRING_EARLY_RETURN = "2026-03-10T21:59:00Z"
JULY_CHECKOUT = "2026-07-01T14:00:00Z"
JULY_DUE = "2026-07-03"
JULY_RETURN = "2026-07-07T16:00:00Z"
AUG_CHECKOUT = "2026-08-27T14:00:00Z"
AUG_DUE = "2026-08-29"
SEP_RETURN = "2026-09-02T16:00:00Z"
RATE_CHANGE_FEE = 200
SPRING_LATE_DAYS = 3
SPRING_FEE = 150
SANDER_DAMAGE = 12000
SANDER_KEPT = 7500
SANDER_EXTRA = 4500
STALE_RETURN = "2026-03-10T16:00:00Z"
NO_SUCH_ITEM = "no-such-item"
UNKNOWN_API_PATH = "/api/no-such-endpoint"
DEVICE_FILE_NAME = "../../evil name.png"
INSPECTION_NOTE = "Handle split"
COOKIE_ATTRIBUTES = ("HttpOnly", "SameSite=Lax", "Path=/")
FORBIDDEN_STORES = ("SQLite", "Redis")

HTTP_TIMEOUT_S = 60
MAIL_SLACK_S = 20
MAIL_POLL_S = 0.5
MAIL_SETTLE_S = 3.0
PROBE_SLACK_S = 20
CLIENT_SLACK_S = 2
FRAME_MS = 16
IDLE_MS = 5000
UI_TIMEOUT_MS = 15000
POLL_MS = 250
TICK_MS = 250
BANNER_TICK_MS = 1000
TAB_BUDGET = 200
NPM_TIMEOUT_S = 300
FOREIGN_ORIGIN = "http://evil.example"
FOREIGN_ZONE = "Pacific/Kiritimati"

PEOPLE = {
    "usr-rosa": ("Rosa Lindqvist", "founder", "rosa@commonshed.example"),
    "usr-dev": ("Dev Okafor", "volunteer", "dev@commonshed.example"),
    "usr-ines": ("Ines Marchetti", "volunteer", "ines@commonshed.example"),
    "mem-hal": ("Hal Brennan", "member", "hal@members.example"),
    "mem-mina": ("Mina Castellanos", "member", "mina@members.example"),
    "mem-tobi": ("Tobi Adeyemi", "member", "tobi@members.example"),
    "mem-wren": ("Wren Kowalski", "member", "wren@members.example"),
    "mem-sol": ("Sol Navarro", "member", "sol@members.example"),
    "mem-juno": ("Juno Achterberg", "member", "juno@members.example"),
}
HOME = {"member": "/catalogue", "volunteer": "/counter", "founder": "/counter"}

ITEMS = {
    "tile-saw": ("7-inch wet tile saw", "Masonry", ("TS-1", "TS-2"), 5000, 18900),
    "pressure-washer": ("Electric pressure washer", "Cleaning", ("PW-1", "PW-2", "PW-3"), 4000, 24900),
    "carpet-cleaner": ("Carpet cleaner", "Cleaning", ("CC-1", "CC-2"), 6000, 32900),
    "floor-sander": ("Orbital floor sander", "Power tools", ("FS-1", "FS-2"), 7500, 89900),
    "laser-level": ("Self-levelling laser", "Measuring", ("LL-1",), 2500, 13900),
    "ext-ladder": ("24-foot extension ladder", "Ladders", ("LD-1",), 0, 21900),
    "drill-driver": ("Cordless drill driver", "Power tools", ("DR-1", "DR-2", "DR-3", "DR-4"), 0, 12900),
    "hedge-trimmer": ("Hedge trimmer", "Garden", ("HT-1", "HT-2"), 0, 9900),
    "post-hole-digger": ("Post hole digger", "Garden", ("PH-1",), 0, 4500),
    "stud-finder": ("Stud finder", "Hand tools", ("SF-1", "SF-2"), 0, 2499),
}

ITEM_KEYS = {"id", "name", "category", "deposit_cents", "replacement_cents", "unit_count", "units_free_today"}
UNIT_KEYS = {"id", "label", "lane_index"}
MEMBER_SPAN_KEYS = {"start_date", "end_date", "status", "back_on", "mine"}
HOLD_KEYS = {"id", "item", "unit", "member", "status", "start_date", "end_date", "ready_at", "pickup_deadline", "created_at"}
PHOTO_KEYS = {"id", "stage", "content_type", "size_bytes", "url"}
LOAN_KEYS = {
    "id", "item", "unit", "member", "hold_id", "status", "checked_out_at", "due_date", "due_at", "renewed_at",
    "returned_at", "on_time", "late_days", "deposit_cents", "replacement_cents", "inspection", "settlement", "photos",
}
SETTLEMENT_KEYS = {
    "loan_id", "deposit_cents", "released_cents", "damage_cents", "damage_from_deposit_cents", "extra_damage_cents",
    "late_days", "late_fee_cents", "total_charged_cents", "settled_at",
}
LEDGER_KEYS = {"id", "loan_id", "item", "kind", "amount_cents", "created_at"}
LIBRARY_KEYS = {
    "name", "time_zone", "open_days", "closed_dates", "opening_time", "closing_time", "late_fee_schedule",
    "late_fee_cents_per_day", "max_active_per_member", "pickup_window_seconds",
}

COPY = {
    "unauthenticated": "Sign in to continue.",
    "bad_credentials": "Email or password is wrong.",
    "forbidden": "Your role can't do that.",
    "not_found": "Not found.",
    "cross_origin": "Cross-site requests are refused.",
    "unsupported_media_type": "Send JSON, or a multipart form for photos.",
    "body_too_large": "Request body is too large.",
    "validation": "Check the highlighted fields.",
    "no_unit_free": "No unit is free for these dates.",
    "unit_busy": "That unit is busy on some of those days.",
    "hold_expired": "This hold's pickup window has closed.",
    "borrowing_paused": "Borrowing is paused while an item is overdue.",
    "borrowing_limit": "You can have at most 4 items held or out at once.",
    "renewal_used": "This loan has already been renewed once.",
    "idempotency_conflict": "That Idempotency-Key was used for a different request.",
    "request_in_progress": "That request is still being processed.",
    "photo_limit": "This stage already has 4 photos.",
    "unsupported_photo": "Photos must be JPEG, PNG or WebP.",
    "photo_too_large": "Photos can be at most 5,000,000 bytes.",
    "not_settled": "This loan isn't settled yet.",
    "photo_storage_unavailable": "Photo storage is offline. The loan is saved; add photos when it's back.",
}
BILLING_LEND = "Billing is offline, so items with a deposit can't be lent right now. Items without a deposit still lend."
BILLING_SETTLE = "Billing is offline, so this loan can't be settled yet. Try again with the same damage charge once billing is back."
FIELD = {
    "start_date": "Choose an open day from today, within the next 28 days.",
    "end_date": "Choose an open day on or after pickup, at most 7 days later.",
    "due_walk_in": "Choose an open day on or after checkout, at most 7 days later.",
    "due_renewal": "Choose an open day after the current due date, at most 7 days later.",
    "checked_out_at": "Checkout time can't be in the future.",
    "returned_at": "Return time must be after checkout and not in the future.",
    "outcome": "Choose OK or Damaged.",
    "note_damaged": "Describe the damage in up to 500 characters.",
    "note_ok": "Notes can be up to 500 characters.",
    "damage_ok": "An item inspected OK has no damage charge.",
    "damage": "Damage charge must be whole cents from $0.00 to the item's replacement value.",
    "idempotency_key": "Send an Idempotency-Key header of 1 to 100 characters.",
    "limit": "Choose a page size from 1 to 50.",
    "cursor": "This page link is out of date. Start from the first page.",
    "required": "Required.",
}
LEAK_TOKENS = ("ECONNREFUSED", "ETIMEDOUT", "Kill Bill", "killbill", "MinIO", "minio", "S3")

JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
EXTENSION = {"jpeg": "jpg", "png": "png", "webp": "webp"}


def origin_of(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


class Api:

    def __init__(self, base: str, person: str | None = None, cookie: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.origin = origin_of(self.base)
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)
        self.session = cookie
        if person is not None:
            r = self.http.post(
                "/api/session",
                json={"email": PEOPLE[person][2], "password": PASSWORD},
                headers={"Origin": self.origin},
            )
            assert r.status_code == 200, f"sign-in {person}: {r.status_code} {r.text}"
            self.session = r.cookies.get(SESSION_COOKIE)
            assert self.session, "no session cookie issued"

    def headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        out = {"Origin": self.origin}
        if self.session:
            out["Cookie"] = f"{SESSION_COOKIE}={self.session}"
        out.update(extra or {})
        return out

    def on(self, base: str) -> "Api":
        return Api(base, cookie=self.session)

    def get(self, path: str, **params: Any) -> httpx.Response:
        return self.http.get(path, params={k: v for k, v in params.items() if v is not None}, headers=self.headers())

    def ok(self, path: str, **params: Any) -> dict[str, Any]:
        r = self.get(path, **params)
        assert r.status_code == 200, f"GET {path}: {r.status_code} {r.text}"
        return r.json()

    def post(self, path: str, body: Any = None, key: str | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
        extra = dict(headers or {})
        if key is not None:
            extra["Idempotency-Key"] = key
        return self.http.post(path, json={} if body is None else body, headers=self.headers(extra))

    def raw(self, method: str, path: str, content: bytes, headers: dict[str, str]) -> httpx.Response:
        return self.http.request(method, path, content=content, headers=self.headers(headers))

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path, headers=self.headers())

    def upload(self, loan_id: str, data: bytes, filename: str = "condition.jpg", declared: str = "image/jpeg", field: str = "photo") -> httpx.Response:
        return self.http.post(f"/api/loans/{loan_id}/photos", files={field: (filename, data, declared)}, headers=self.headers())


def killbill_down() -> str:
    return os.environ["APP_KILLBILL_DOWN_URL"].rstrip("/")


def minio_down() -> str:
    return os.environ["APP_MINIO_DOWN_URL"].rstrip("/")


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def same_instant(value: str | None, expected: str) -> bool:
    return value is not None and value.endswith("Z") and instant(value) == instant(expected)


def iso_z(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local_at(day: date, hhmm: str) -> datetime:
    hour, minute = (int(part) for part in hhmm.split(":")[:2])
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZONE)


def local_time(value: str | datetime) -> str:
    moment = (instant(value) if isinstance(value, str) else value).astimezone(ZONE)
    return f"{moment:%a} {moment.day} {moment:%b} {moment.year}, {moment:%H:%M} {moment.tzname()}"


def local_time_options(value: str) -> set[str]:
    floor = instant(value).replace(second=0, microsecond=0)
    return {local_time(floor), local_time(floor + timedelta(minutes=1))}


def money(amount: int) -> str:
    return f"${amount // 100:,}.{amount % 100:02d}"


def cents(amount: Any) -> int:
    return int((Decimal(str(amount)) * 100).to_integral_value())


def transition(kind: str, status: str) -> str:
    return f"This {kind} is {status} and can't do that."


def record_name(item: str, lane: int) -> str:
    return f"{ITEMS[item][0]}, unit {ITEMS[item][2][lane]}"


def group_name(item: str, lane: int) -> str:
    return f"Unit {ITEMS[item][2][lane]}"


def unit_of(item: str, lane: int) -> str:
    return f"{item}-{lane + 1}"


def lanes_path(item: str) -> str:
    return f"/api/items/{item}/lanes"


def held_copy(lane: int, count: int, free: int) -> str:
    return f"Held unit {lane + 1} of {count}, {free} units still free for these dates"


def free_for_dates(free: int, count: int) -> re.Pattern[str]:
    return re.compile(rf"{free}\s*of {count} units free for these dates", re.I)


def photo_name(panel: str, n: int) -> str:
    return f"{panel} photo {n}"


def late_copy(days: int) -> str:
    return f"Checked in late: {days} late days."


def settled_copy(person: str) -> str:
    return f"Settled. Receipt queued for {PEOPLE[person][0]}."


def local_input(value: str) -> str:
    return instant(value).astimezone(ZONE).strftime("%Y-%m-%dT%H:%M")


def dollars(amount: int) -> str:
    return f"{amount // 100}.{amount % 100:02d}"


class Library:
    def __init__(self, api: Api) -> None:
        self.settings = api.ok("/api/library")
        self.open_days = set(self.settings["open_days"])
        self.closed = set(self.settings["closed_dates"])
        self.closing = self.settings["closing_time"]
        self.today = date.fromisoformat(api.ok("/api/items/tile-saw/lanes")["from"])

    def is_open(self, day: date) -> bool:
        return DAY_KEYS[day.weekday()] in self.open_days and day.isoformat() not in self.closed

    def open_on_or_after(self, day: date) -> date:
        while not self.is_open(day):
            day += timedelta(days=1)
        return day

    def open_after(self, day: date | str) -> date:
        start = date.fromisoformat(day) if isinstance(day, str) else day
        return self.open_on_or_after(start + timedelta(days=1))

    def opens(self, start: date, count: int) -> list[date]:
        out = [self.open_on_or_after(start)]
        while len(out) < count:
            out.append(self.open_after(out[-1]))
        return out

    def span(self, offset: int, nights: int = 1) -> tuple[str, str]:
        start = self.open_on_or_after(self.today + timedelta(days=offset))
        end = start
        for _ in range(nights):
            end = self.open_after(end)
        return start.isoformat(), end.isoformat()

    def next_open(self) -> str:
        return self.open_on_or_after(self.today + timedelta(days=1)).isoformat()

    def closing_instant(self, day: date | str) -> str:
        return iso_z(local_at(date.fromisoformat(day) if isinstance(day, str) else day, self.closing))

    def yesterday_at(self, hhmm: str) -> str:
        return iso_z(local_at(self.today - timedelta(days=1), hhmm))


def assert_error(r: httpx.Response, status: int, code: str, message: str | None = None, fields: dict[str, str] | None = None) -> None:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text}"
    body = r.json()
    assert list(body) == ["error"], body
    error = body["error"]
    assert error.get("code") == code, body
    assert set(error) == ({"code", "message", "fields"} if code == "validation" else {"code", "message"}), body
    assert error["message"] == (message if message is not None else COPY[code]), body
    for field, copy in (fields or {}).items():
        assert error["fields"].get(field) == copy, body


def pages(api: Api, path: str, field: str, **params: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cursor = None
    while True:
        body = api.ok(path, limit=PAGE_MAX, cursor=cursor, **params)
        out += body[field]
        cursor = body["next_cursor"]
        if cursor is None:
            return out


def clear_member(staff: Api, member_id: str) -> None:
    for status in ("requested", "ready"):
        for hold in pages(staff, "/api/holds", "holds", status=status):
            if hold["member"]["id"] == member_id:
                staff.post(f"/api/holds/{hold['id']}/cancel")
    for status in ("out", "overdue"):
        for loan in pages(staff, "/api/loans", "loans", status=status):
            if loan["member"]["id"] == member_id:
                staff.post(f"/api/loans/{loan['id']}/return")


def clear_item(staff: Api, item_id: str) -> None:
    for lane in staff.ok(f"/api/items/{item_id}/lanes")["lanes"]:
        for span in lane["spans"]:
            record = span["record"]
            if record["type"] == "hold":
                staff.post(f"/api/holds/{record['id']}/cancel")
            else:
                staff.post(f"/api/loans/{record['id']}/return")


def clear_all_holds(staff: Api) -> None:
    for status in ("requested", "ready"):
        for hold in pages(staff, "/api/holds", "holds", status=status):
            staff.post(f"/api/holds/{hold['id']}/cancel")


def prepare(staff: Api, members: list[str], items: list[str]) -> None:
    for member in members:
        clear_member(staff, member)
    for item in items:
        clear_item(staff, item)


def place_hold(member: Api, item: str, start: str | date, end: str | date, key: str | None = None) -> httpx.Response:
    body = {"item_id": item, "start_date": str(start), "end_date": str(end)}
    return member.post("/api/holds", body, key=key or idempotency_key())


def make_hold(member: Api, item: str, start: str | date, end: str | date) -> dict[str, Any]:
    r = place_hold(member, item, start, end)
    assert r.status_code == 201, r.text
    return r.json()["hold"]


def make_ready(staff: Api, hold_id: str) -> dict[str, Any]:
    r = staff.post(f"/api/holds/{hold_id}/ready")
    assert r.status_code == 200, r.text
    return r.json()["hold"]


def checkout(staff: Api, hold_id: str, key: str | None = None) -> httpx.Response:
    return staff.post("/api/loans", {"hold_id": hold_id}, key=key or idempotency_key())


def lend(staff: Api, member_id: str, unit_id: str, due: str | date, checked_out_at: str | None = None, key: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"member_id": member_id, "unit_id": unit_id, "due_date": str(due)}
    if checked_out_at is not None:
        body["checked_out_at"] = checked_out_at
    return staff.post("/api/loans", body, key=key or idempotency_key())


def make_loan(staff: Api, member_id: str, unit_id: str, due: str | date, checked_out_at: str | None = None) -> dict[str, Any]:
    r = lend(staff, member_id, unit_id, due, checked_out_at)
    assert r.status_code == 201, r.text
    return r.json()["loan"]


def check_in(staff: Api, loan_id: str, returned_at: str | None = None) -> dict[str, Any]:
    r = staff.post(f"/api/loans/{loan_id}/return", {} if returned_at is None else {"returned_at": returned_at})
    assert r.status_code == 200, r.text
    return r.json()["loan"]


def inspect_loan(staff: Api, loan_id: str, outcome: str = "ok", note: str = "") -> dict[str, Any]:
    r = staff.post(f"/api/loans/{loan_id}/inspection", {"outcome": outcome, "note": note})
    assert r.status_code == 200, r.text
    return r.json()["loan"]


def settle_loan(founder: Api, loan_id: str, damage: Any, key: str | None = None) -> httpx.Response:
    return founder.post(f"/api/loans/{loan_id}/settlement", {"damage_cents": damage}, key=key or idempotency_key())


def ledger(founder: Api, loan_id: str) -> list[dict[str, Any]]:
    return founder.ok("/api/ledger", loan_id=loan_id)["entries"]


def loans_for_hold(staff: Api, hold_id: str) -> list[dict[str, Any]]:
    return [loan for loan in pages(staff, "/api/loans", "loans") if loan["hold_id"] == hold_id]


def active_count(staff: Api, member_id: str) -> int:
    count = 0
    for status in ("requested", "ready"):
        count += sum(1 for h in pages(staff, "/api/holds", "holds", status=status) if h["member"]["id"] == member_id and h["status"] == status)
    for status in ("out", "overdue"):
        count += sum(1 for l in pages(staff, "/api/loans", "loans", status=status) if l["member"]["id"] == member_id)
    return count


def unsettled_deposits(staff: Api) -> int:
    return sum(loan["deposit_cents"] for loan in pages(staff, "/api/loans", "loans") if loan["status"] != "settled")


def free_today_from_lanes(staff: Api, item_id: str, today: date) -> int:
    lanes = staff.ok(f"/api/items/{item_id}/lanes")["lanes"]
    return sum(
        1 for lane in lanes
        if not any(date.fromisoformat(s["start_date"]) <= today <= date.fromisoformat(s["end_date"]) for s in lane["spans"])
    )


def wait_status(api: Api, field: str, value: str) -> dict[str, Any]:
    deadline = time.monotonic() + PROBE_AGE_S + PROBE_SLACK_S
    body = api.ok("/api/counter/status")
    while body[field] != value and time.monotonic() < deadline:
        body = api.ok("/api/counter/status")
    assert body[field] == value, body
    return body


def race(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def ensure_history(staff: Api, member_id: str, minimum: int) -> None:
    have = sum(1 for loan in pages(staff, "/api/loans", "loans") if loan["member"]["id"] == member_id)
    for i in range(max(0, minimum - have)):
        loan = make_loan(staff, member_id, "drill-driver-4", "2026-02-04", f"2026-02-03T15:{i % 60:02d}:{i // 60:02d}Z")
        check_in(staff, loan["id"], "2026-02-04T20:00:00Z")


def leaks(r: httpx.Response) -> list[str]:
    configured = [os.environ.get(name, "") for name in ("KILLBILL_URL", "S3_ENDPOINT")]
    hosts = [urlparse(value).netloc for value in configured if value]
    header_text = "\n".join(f"{k}: {v}" for k, v in r.headers.items() if k.lower() != "etag")
    found = []
    for token in (*LEAK_TOKENS, *[v for v in configured if v], *hosts):
        if token in r.text or token in header_text:
            found.append(token)
    return found


def kb_transactions(kb: KillBill, person: str) -> list[dict[str, Any]]:
    account = kb.account_by_key(f"shedline-{person}")
    if account is None:
        return []
    return [t for p in kb.payments(account["accountId"]) for t in (p.get("transactions") or [])]


def kb_payment_txs(kb: KillBill, key: str) -> list[dict[str, Any]]:
    payment = kb.payment_by_key(key)
    return [] if payment is None else list(payment.get("transactions") or [])


def of_type(txs: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [t for t in txs if t.get("transactionType") == kind]


def inbox(mail: Mailpit, person: str, subject: str, *, count: int = 1, seconds: float = BACKGROUND_DELAY_S + MAIL_SLACK_S) -> list[dict[str, Any]]:
    email = PEOPLE[person][2]

    def mine(settle_s: float) -> list[dict[str, Any]]:
        return [
            m for m in mail.messages(expected=0, settle=settle_s)
            if email in [a.lower() for a in addresses(m.get("To"))] and m.get("Subject") == subject
        ]

    deadline = time.monotonic() + seconds
    found = mine(MAIL_POLL_S)
    while len(found) < count and time.monotonic() < deadline:
        found = mine(MAIL_POLL_S)
    return mine(MAIL_SETTLE_S)


def from_desk(message: dict[str, Any]) -> bool:
    expected = mail_from_address().lower()
    return any(a and (a.lower() in expected or expected in a.lower()) for a in addresses(message.get("From")))


def receipt_lines(s: dict[str, Any]) -> list[str]:
    return [
        f"Deposit held: {money(s['deposit_cents'])}",
        f"Deposit released: {money(s['released_cents'])}",
        f"Damage charge: {money(s['damage_cents'])}",
        f"Charged beyond deposit: {money(s['extra_damage_cents'])}",
        f"Late fee: {money(s['late_fee_cents'])} ({s['late_days']} late days)",
        f"Total charged: {money(s['total_charged_cents'])}",
    ]


def assert_lines_in_order(body: str, lines: list[str]) -> None:
    positions = [body.find(line) for line in lines]
    assert all(p >= 0 for p in positions), (lines, body)
    assert positions == sorted(positions), (lines, body)


def png_bytes(side: int = 16) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    row = b"\x00" + b"\xd0\x5a\x10" * side
    header = struct.pack(">IIBBBBB", side, side, 8, 2, 0, 0, 0)
    return PNG_MAGIC + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(row * side)) + chunk(b"IEND", b"")


def photo_payload(kind: str, size: int = 0) -> bytes:
    bases = {
        "jpeg": JPEG_MAGIC + b"\xe0\x00\x10JFIF\x00\x01\x01",
        "png": png_bytes(),
        "webp": b"RIFF" + struct.pack("<I", 26) + b"WEBP" + b"VP8L" + struct.pack("<I", 14) + b"\x2f" + b"\x00" * 13,
        "svg": b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        "html": b"<!doctype html><html><body><script>alert(1)</script></body></html>",
        "pdf": b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
    }
    base = bases[kind]
    return base + b"\x00" * max(0, size - len(base))


def ui_sign_in(page: Page, base: str, person: str) -> None:
    page.goto(base.rstrip("/") + "/")
    fill(page.get_by_role("textbox", name="Email"), PEOPLE[person][2])
    fill(page.get_by_label("Password"), PASSWORD)
    click(page.get_by_role("button", name="Sign in"))
    page.wait_for_url(re.compile(re.escape(HOME[PEOPLE[person][1]]) + r"$"), timeout=UI_TIMEOUT_MS)


def soon(page: Page, check: Callable[[], None], seconds: float = UI_TIMEOUT_MS / 1000, tick: float = TICK_MS) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            check()
            return
        except AssertionError:
            if time.monotonic() >= deadline:
                raise
            advance(page, tick)


SCREEN_HEADINGS = {
    "/catalogue": "Catalogue",
    "/items/tile-saw": ITEMS["tile-saw"][0],
    "/my-loans": "My loans",
    "/counter": "Counter",
    "/ledger": "Deposit ledger",
}


def see_heading(page: Page, name: str) -> None:
    heading = page.get_by_role("heading", name=name).first
    soon(page, lambda: expect(heading).to_be_visible(timeout=POLL_MS))


OPTION_INDEX_JS = (
    "(el, needles) => Array.from(el.options).findIndex(o => needles.some(n => "
    "(o.label + ' ' + o.textContent + ' ' + o.value).toLowerCase().includes(n.toLowerCase())))"
)


def choose(page: Page, combo: Any, *needles: str) -> None:
    soon(page, lambda: expect(combo).to_be_attached(timeout=POLL_MS))
    if combo.evaluate("el => el.tagName") == "SELECT":
        def loaded() -> None:
            assert combo.evaluate(OPTION_INDEX_JS, list(needles)) >= 0, needles

        soon(page, loaded)
        index = combo.evaluate(OPTION_INDEX_JS, list(needles))
        select(combo, combo.evaluate("(e, i) => (e.options[i].label || e.options[i].text || '').trim()", index))
        return
    click(combo)
    if combo.evaluate("el => el.tagName === 'INPUT'"):
        fill(combo, needles[0])
    option = page.get_by_role("option").filter(has_text=re.compile("|".join(re.escape(n) for n in needles), re.I)).first
    soon(page, lambda: expect(option).to_be_visible(timeout=POLL_MS))
    click(option)


EFFECTIVE_OPACITY_JS = (
    "el => { let o = 1; for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); "
    "if (s.display === 'none' || s.visibility === 'hidden') return 0; o *= parseFloat(s.opacity); } return o; }"
)
REACHABLE_JS = (
    "el => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; "
    "if (r.width <= 0 || r.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false; "
    "const hit = document.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit)); }"
)


def shown(locator: Any) -> bool:
    return locator.is_visible() and locator.evaluate(EFFECTIVE_OPACITY_JS) > 0


def assert_collapsed(locator: Any) -> None:
    for i in range(locator.count()):
        item = locator.nth(i)
        assert not (shown(item) and item.evaluate(REACHABLE_JS)), i


def settlement_result(page: Page) -> Any:
    return page.get_by_role("status", name="Settlement result", include_hidden=True)


def is_hold_post(response: Any) -> bool:
    return response.request.method == "POST" and response.url.endswith("/api/holds")


def press_hold(page: Page, copy: str) -> int:
    with page.expect_response(is_hold_post, timeout=UI_TIMEOUT_MS) as info:
        click(page.get_by_role("button", name="Hold a unit"))
    result = page.get_by_role("status", name="Claim result")
    soon(page, lambda: expect(result).to_have_text(copy, timeout=POLL_MS))
    settle(page.get_by_role("region", name="Unit lanes"))
    return info.value.status


def inside(inner: dict[str, float], outer: dict[str, float]) -> bool:
    return (
        inner["x"] >= outer["x"] - 1 and inner["y"] >= outer["y"] - 1
        and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + 1
        and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + 1
    )


def numeral(region: Any) -> int:
    match = re.search(r"(\d+)\s*of\s+\d+\s+units free", region.inner_text(), re.I)
    assert match, region.inner_text()
    return int(match.group(1))


def file_png(name: str = "IMG_0001.png") -> dict[str, Any]:
    return {"name": name, "mimeType": "image/png", "buffer": png_bytes()}


@pytest.fixture
def staff(app_url: str) -> Api:
    return Api(app_url, "usr-rosa")


@pytest.fixture
def lib(staff: Api) -> Library:
    return Library(staff)


def test_health_on_every_copy(app_url: str) -> None:
    for base in (app_url, killbill_down(), minio_down()):
        r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, (base, r.text)
        assert r.json() == {"status": "ok"}


def test_sign_in_and_roles(app_url: str) -> None:
    origin = origin_of(app_url)
    r = httpx.post(
        app_url.rstrip("/") + "/api/session",
        json={"email": PEOPLE["mem-hal"][2], "password": PASSWORD},
        headers={"Origin": origin},
        timeout=HTTP_TIMEOUT_S,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"user": {"id": "mem-hal", "name": "Hal Brennan", "role": "member"}}
    cookie = "; ".join(r.headers.get_list("set-cookie")).lower()
    assert f"{SESSION_COOKIE}=" in cookie and all(attr.lower() in cookie for attr in COOKIE_ATTRIBUTES)

    for person, (name, role, _) in PEOPLE.items():
        assert Api(app_url, person).ok("/api/session") == {"user": {"id": person, "name": name, "role": role}}

    anon = Api(app_url)
    assert_error(anon.post("/api/session", {"email": PEOPLE["mem-hal"][2], "password": "not-the-password"}), 401, "bad_credentials")
    assert_error(anon.post("/api/session", {"email": "nobody@members.example", "password": PASSWORD}), 401, "bad_credentials")
    assert_error(anon.post("/api/session", {}), 422, "validation", fields={"email": FIELD["required"], "password": FIELD["required"]})
    assert_error(anon.get("/api/items"), 401, "unauthenticated")

    member = Api(app_url, "mem-hal")
    volunteer = Api(app_url, "usr-dev")
    founder = Api(app_url, "usr-rosa")
    for path in ("/api/members", "/api/ledger", "/api/counter/status"):
        assert_error(member.get(path), 403, "forbidden")
    assert_error(member.post("/api/loans", {"hold_id": "x"}, key=idempotency_key()), 403, "forbidden")
    assert_error(volunteer.get("/api/ledger"),403, "forbidden")
    assert_error(volunteer.post("/api/holds", {"item_id": "tile-saw", "start_date": "2026-01-06", "end_date": "2026-01-06"}, key=idempotency_key()), 403, "forbidden")
    members = volunteer.ok("/api/members")["members"]
    assert all(set(m) == {"id", "name"} for m in members)
    names = [m["name"] for m in members]
    assert names == sorted(names)
    ids = {m["id"] for m in members}
    assert {p for p, v in PEOPLE.items() if v[1] == "member"} <= ids
    assert not ids & {"usr-rosa", "usr-dev", "usr-ines"}
    assert set(volunteer.ok("/api/counter/status")) == {"billing", "photo_storage", "checked_at"}
    assert set(founder.ok("/api/ledger")) == {"entries", "deposits_held_cents"}
    out = member.delete("/api/session")
    assert out.status_code == 204, out.text
    assert SESSION_COOKIE in "; ".join(out.headers.get_list("set-cookie"))


def test_error_shape_and_precedence(app_url: str, lib: Library) -> None:
    anon = Api(app_url)
    hold_body = {"item_id": "tile-saw", "start_date": "2026-01-06", "end_date": "2026-01-06"}
    assert_error(anon.post("/api/holds", hold_body, key=idempotency_key(), headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    assert_error(anon.get(f"/api/loans/{uuid.uuid4()}"), 401, "unauthenticated")
    volunteer = Api(app_url, "usr-dev")
    assert_error(volunteer.post(f"/api/loans/{uuid.uuid4()}/settlement", {"damage_cents": 0}, key=idempotency_key()), 404, "not_found")
    member = Api(app_url, "mem-hal")
    assert_error(member.raw("POST", "/api/loans", b"hold", {"Content-Type": "text/plain", "Idempotency-Key": idempotency_key()}), 403, "forbidden")
    assert_error(member.raw("POST", "/api/holds", b"hold", {"Content-Type": "text/plain", "Idempotency-Key": idempotency_key()}), 415, "unsupported_media_type")
    start, end = lib.span(3, 1)
    open_body = {"item_id": NO_SUCH_ITEM, "start_date": start, "end_date": end}
    assert_error(member.post("/api/holds", open_body, key=idempotency_key()), 422, "validation", fields={"item_id": "No such item."})
    assert_error(member.post("/api/holds", {**open_body, "item_id": "tile-saw"}), 422, "validation", fields={"idempotency_key": FIELD["idempotency_key"]})
    assert_error(member.get(UNKNOWN_API_PATH), 404, "not_found")
    assert_error(member.get("/api/holds", limit=0), 422, "validation", fields={"limit": FIELD["limit"]})


def test_server_boundary(app_url: str, staff: Api, lib: Library) -> None:
    anon = Api(app_url)
    r = anon.post("/api/session", {"email": "a", "password": "b"}, headers={"Origin": FOREIGN_ORIGIN})
    assert_error(r, 403, "cross_origin")
    assert not any(k.lower().startswith("access-control-") for k in r.headers)
    assert_error(anon.raw("POST", "/api/session", b"email=a", {"Content-Type": "text/plain"}), 415, "unsupported_media_type")

    def body_of(size: int) -> bytes:
        overhead = len(json.dumps({"email": "", "password": "x"}, separators=(",", ":")).encode())
        return json.dumps({"email": "a" * (size - overhead), "password": "x"}, separators=(",", ":")).encode()

    at_limit = anon.raw("POST", "/api/session", body_of(JSON_LIMIT), {"Content-Type": "application/json"})
    assert at_limit.status_code in (401, 422), at_limit.text
    assert_error(anon.raw("POST", "/api/session", body_of(JSON_LIMIT + 1), {"Content-Type": "application/json"}), 413, "body_too_large")

    prepare(staff, ["mem-wren"], ["drill-driver"])
    loan = make_loan(staff, "mem-wren", "drill-driver-3", lib.next_open())
    try:
        try:
            big = staff.upload(loan["id"], photo_payload("jpeg", UPLOAD_LIMIT + 1))
            assert_error(big, 413, "body_too_large")
        except httpx.TransportError:
            pass
        assert staff.ok(f"/api/loans/{loan['id']}")["loan"]["photos"] == []
        assert S3().keys(f"loans/{loan['id']}/") == []
    finally:
        check_in(staff, loan["id"])

    secrets = [os.environ[k] for k in ("DATABASE_URL", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY") if os.environ.get(k)]
    for path in ("/.env", "/run.json", "/package.json", "/package-lock.json", "/src/"):
        r = anon.get(path)
        assert r.status_code == 404, (path, r.status_code)
        assert "run-manifest-v1" not in r.text
    for path in ("/%2e%2e/run.json", "/assets/%2e%2e/%2e%2e/run.json"):
        r = anon.get(path)
        assert "run-manifest-v1" not in r.text and '"_schema"' not in r.text
    page_html = anon.get("/catalogue")
    assert page_html.status_code == 200
    for secret in secrets:
        assert secret not in page_html.text
        assert secret not in staff.get("/api/library").text


TAP_ROLES = ("button", "link", "textbox", "combobox")


def assert_tap_targets(page: Page) -> None:
    for role in TAP_ROLES:
        for loc in page.get_by_role(role).all():
            if not loc.is_visible():
                continue
            box = loc.bounding_box()
            if box is None or box["width"] <= 1 or box["height"] <= 1:
                continue
            assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX, (role, loc.inner_text()[:40], box)


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layout(app_url: str, browser: Browser, staff: Api, lib: Library, viewport: str) -> None:
    width, height = VIEWPORTS[viewport]
    prepare(staff, ["mem-hal"], ["drill-driver"])
    loan = make_loan(staff, "mem-hal", "drill-driver-2", lib.next_open())
    try:
        with open_app(browser, app_url + "/") as page:
            page.set_viewport_size({"width": width, "height": height})
            expect(page.get_by_role("heading", name="Sign in")).to_be_visible(timeout=UI_TIMEOUT_MS)
            layout(page)
            assert_tap_targets(page)
        for person, paths in (("mem-hal", ["/catalogue", "/items/tile-saw", "/my-loans", f"/loans/{loan['id']}"]),
                              ("usr-rosa", ["/counter", "/ledger", f"/loans/{loan['id']}"])):
            with open_app(browser, app_url + "/") as page:
                page.set_viewport_size({"width": width, "height": height})
                ui_sign_in(page, app_url, person)
                for path in paths:
                    page.goto(app_url.rstrip("/") + path)
                    see_heading(page, SCREEN_HEADINGS.get(path, record_name("drill-driver", 1)))
                    layout(page)
                    assert_tap_targets(page)
                    if viewport == "375":
                        expect(page.get_by_role("button", name="Menu")).to_be_visible()
    finally:
        check_in(staff, loan["id"])


def focus_ring_ok(locator: Any) -> bool:
    rest, focus = state_styles(locator, "outline-style", "outline-width", "outline-offset", "box-shadow", state="focus")
    if focus["outline-style"] != "none" and focus["outline-width"] == "2px":
        return focus["outline-offset"] not in ("0px", "")
    return focus["box-shadow"] != rest["box-shadow"]


def inspected_loan(staff: Api, lib: Library, member: str, unit: str, outcome: str = "ok", note: str = "") -> dict[str, Any]:
    loan = make_loan(staff, member, unit, lib.next_open(), lib.yesterday_at("10:00"))
    check_in(staff, loan["id"], lib.yesterday_at("12:00"))
    return inspect_loan(staff, loan["id"], outcome, note)


def test_keyboard_and_focus(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-wren"], ["hedge-trimmer"])
    loan = inspected_loan(staff, lib, "mem-wren", "hedge-trimmer-1")
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        ui_sign_in(page, app_url, "mem-hal")
        expect(page.get_by_role("heading", name="Catalogue")).to_be_visible(timeout=UI_TIMEOUT_MS)
        nav = page.get_by_role("navigation", name="Main")
        targets = [
            page.get_by_role("link", name="Skip to content", include_hidden=True),
            nav.get_by_role("link", name="Catalogue"),
            nav.get_by_role("link", name="My loans"),
            page.get_by_role("article", name=ITEMS["tile-saw"][0]).get_by_role("link", name=ITEMS["tile-saw"][0]),
        ]
        handles = [t.first.element_handle(timeout=UI_TIMEOUT_MS) for t in targets]
        first_focus: dict[int, int] = {}
        for press in range(TAB_BUDGET):
            page.keyboard.press("Tab")
            hit = page.evaluate("(els) => els.indexOf(document.activeElement)", handles)
            if hit >= 0:
                first_focus.setdefault(hit, press)
            if len(first_focus) == len(targets):
                break
        assert first_focus.get(0) == 0, first_focus
        assert sorted(first_focus) == list(range(len(targets))), first_focus
        order = [first_focus[i] for i in range(len(targets))]
        assert order == sorted(order), first_focus
        assert focus_ring_ok(page.get_by_role("button", name="Sign out"))
        assert focus_ring_ok(page.get_by_role("link", name="7-inch wet tile saw"))
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-rosa")
        page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
        opener = page.get_by_role("button", name="Settle")
        click(opener)
        advance(page, DIALOG_OPEN_MS)
        dialog = page.get_by_role("dialog", name="Settle loan")
        expect(dialog).to_be_visible()
        charge = dialog.get_by_role("textbox", name="Damage charge")
        expect(charge).to_be_focused()
        expect(charge).to_have_value("0.00")
        handle = dialog.element_handle()
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert handle.evaluate("d => d.contains(document.activeElement)"), key
        page.keyboard.press("Escape")
        advance(page, DIALOG_CLOSE_MS * 2)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        click(opener)
        advance(page, DIALOG_OPEN_MS)
        click(dialog.get_by_role("button", name="Cancel"))
        advance(page, DIALOG_CLOSE_MS * 2)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
    assert staff.ok(f"/api/loans/{loan['id']}")["loan"]["status"] == "inspected"
    settle_loan(staff, loan["id"], 0)


INFINITE_JS = "() => document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity).length"


def test_motion_and_reduced_motion(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-juno"], ["tile-saw"])
    start, end = lib.span(12, 1)
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        ui_sign_in(page, app_url, "mem-juno")
        page.goto(app_url.rstrip("/") + "/items/tile-saw")
        fill(page.get_by_label("Pickup date"), start)
        fill(page.get_by_label("Return date"), end)
        availability = page.get_by_role("region", name="Availability")
        soon(page, lambda: expect(availability).to_contain_text(free_for_dates(2, 2), timeout=POLL_MS))
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/holds")) as info:
            click(page.get_by_role("button", name="Hold a unit"))
        assert info.value.status == 201
        advance(page, FRAME_MS)
        lanes = page.get_by_role("region", name="Unit lanes")
        group = lanes.get_by_role("group", name=group_name("tile-saw", 0))
        bar = group.get_by_role("img", name="Claim bar")
        expect(bar).to_be_visible(timeout=UI_TIMEOUT_MS)
        assert inside(bar.bounding_box(), group.bounding_box())
        expect(availability).to_contain_text(free_for_dates(1, 2), timeout=UI_TIMEOUT_MS)
        expect(page.get_by_role("status", name="Claim result")).to_have_text(held_copy(0, 2, 1), timeout=UI_TIMEOUT_MS)
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "mem-juno")
        for path in ("/catalogue", "/items/tile-saw", "/my-loans"):
            page.goto(app_url.rstrip("/") + path)
            see_heading(page, SCREEN_HEADINGS[path])
            advance(page, IDLE_MS)
            assert page.evaluate(INFINITE_JS) == 0, path
    clear_member(staff, "mem-juno")


def test_wf_cross_cutting_sign_in(app_url: str, browser: Browser) -> None:
    with open_app(browser, app_url + "/") as page:
        fill(page.get_by_role("textbox", name="Email"), PEOPLE["mem-hal"][2])
        fill(page.get_by_label("Password"), "not-the-password")
        click(page.get_by_role("button", name="Sign in"))
        form_status = page.get_by_role("status", name="Form status")
        soon(page, lambda: expect(form_status).to_have_text(COPY["bad_credentials"], timeout=POLL_MS))
        email = page.get_by_role("textbox", name="Email")
        soon(page, lambda: expect(email).to_be_focused(timeout=POLL_MS))
        ui_sign_in(page, app_url, "mem-hal")
        nav = page.get_by_role("navigation", name="Main")
        expect(nav.get_by_role("link", name="My loans")).to_be_visible()
        expect(nav.get_by_role("link", name="Counter")).to_have_count(0)
        expect(nav.get_by_role("link", name="Ledger")).to_have_count(0)
        page.goto(app_url.rstrip("/") + "/")
        page.wait_for_url(re.compile(re.escape(HOME["member"]) + "$"), timeout=UI_TIMEOUT_MS)
        click(page.get_by_role("button", name="Sign out"))
        expect(page.get_by_role("heading", name="Sign in")).to_be_visible(timeout=UI_TIMEOUT_MS)
        ui_sign_in(page, app_url, "usr-rosa")
        expect(nav.get_by_role("link", name="Counter")).to_be_visible()
        expect(nav.get_by_role("link", name="Ledger")).to_be_visible()


def test_wf_cross_cutting_menu(app_url: str, browser: Browser) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        ui_sign_in(page, app_url, "mem-hal")
        menu = page.get_by_role("button", name="Menu")
        expect(page.get_by_role("button", name="Menu", expanded=False)).to_be_visible()
        nav_link = page.get_by_role("link", name="My loans")
        soon(page, lambda: assert_collapsed(nav_link))
        click(menu)
        expect(page.get_by_role("button", name="Menu", expanded=True)).to_be_visible()
        expect(page.get_by_role("navigation", name="Main").get_by_role("link", name="My loans")).to_be_visible()
        page.keyboard.press("Escape")
        closed = page.get_by_role("button", name="Menu", expanded=False)
        soon(page, lambda: expect(closed).to_be_visible(timeout=POLL_MS))
        soon(page, lambda: expect(menu).to_be_focused(timeout=POLL_MS))


def test_catalogue_items(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-wren"], ["drill-driver"])
    member = Api(app_url, "mem-mina")
    items = member.ok("/api/items")["items"]
    assert [i["id"] for i in items] == list(ITEMS)
    for item in items:
        name, category, labels, deposit, replacement = ITEMS[item["id"]]
        assert set(item) == ITEM_KEYS
        assert (item["name"], item["category"], item["unit_count"], item["deposit_cents"], item["replacement_cents"]) == (name, category, len(labels), deposit, replacement)
        assert item["units_free_today"] == free_today_from_lanes(staff, item["id"], lib.today)
    assert member.ok("/api/items/tile-saw")["item"] == items[0]
    assert_error(member.get(f"/api/items/{NO_SUCH_ITEM}"), 404, "not_found")
    before = member.ok("/api/items/drill-driver")["item"]["units_free_today"]
    loan = make_loan(staff, "mem-wren", "drill-driver-1", lib.next_open())
    assert member.ok("/api/items/drill-driver")["item"]["units_free_today"] == before - 1
    check_in(staff, loan["id"])
    assert member.ok("/api/items/drill-driver")["item"]["units_free_today"] == before


def test_unit_lanes(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-mina", "mem-wren", "mem-sol"], ["drill-driver"])
    due = lib.next_open()
    start = lib.open_after(due)
    end = lib.open_after(start)
    hold = make_hold(Api(app_url, "mem-mina"), "drill-driver", start, end)
    out = make_loan(staff, "mem-wren", "drill-driver-2", due)
    overdue = make_loan(staff, "mem-sol", "drill-driver-3", SPRING_DUE, SPRING_CHECKOUT)
    try:
        body = staff.ok(lanes_path("drill-driver"))
        assert body["item_id"] == "drill-driver" and body["unit_count"] == 4
        assert body["from"] == lib.today.isoformat()
        assert body["to"] == (lib.today + timedelta(days=LANE_DAYS - 1)).isoformat()
        assert body["units_free"] is None
        assert [(l["lane_index"], l["unit_id"], l["label"]) for l in body["lanes"]] == [(i, f"drill-driver-{i + 1}", f"DR-{i + 1}") for i in range(4)]
        assert all(l["busy_for_range"] is None for l in body["lanes"])
        spans = {s["record"]["id"]: (l["lane_index"], s) for l in body["lanes"] for s in l["spans"]}
        lane, span = spans[hold["id"]]
        assert lane == 0 and (span["status"], span["start_date"], span["end_date"], span["back_on"]) == ("held", start.isoformat(), end.isoformat(), lib.open_after(end).isoformat())
        lane, span = spans[out["id"]]
        assert lane == 1 and (span["status"], span["start_date"], span["end_date"], span["back_on"]) == ("out", lib.today.isoformat(), due, lib.open_after(due).isoformat())
        lane, span = spans[overdue["id"]]
        assert lane == 2 and (span["status"], span["start_date"], span["end_date"], span["back_on"]) == ("overdue", "2026-03-05", lib.today.isoformat(), None)
        ranged = staff.ok(lanes_path("drill-driver"), start=start.isoformat(), end=end.isoformat())
        assert ranged["units_free"] == 3
        assert [l["busy_for_range"] for l in ranged["lanes"]] == [True, False, False, False]
        partial = staff.get(lanes_path("drill-driver"), start=start.isoformat())
        assert_error(partial, 422, "validation")
        assert set(partial.json()["error"]["fields"]) & {"start_date", "end_date"}
        bad = staff.get(lanes_path("drill-driver"), **{"from": "2026-02-30"})
        assert_error(bad, 422, "validation")
        assert "from" in bad.json()["error"]["fields"]
    finally:
        prepare(staff, ["mem-mina", "mem-wren", "mem-sol"], [])


def test_lane_fields_by_role(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-mina", "mem-hal"], ["hedge-trimmer"])
    mina, hal = Api(app_url, "mem-mina"), Api(app_url, "mem-hal")
    start, end = lib.span(4, 1)
    mine = make_hold(mina, "hedge-trimmer", start, end)
    theirs = make_hold(hal, "hedge-trimmer", start, end)
    try:
        assert set(mine) == HOLD_KEYS and set(mine["unit"]) == UNIT_KEYS
        assert mine["member"] == {"id": "mem-mina", "name": "Mina Castellanos"} and set(mine["item"]) == {"id", "name"}
        r = mina.get(lanes_path("hedge-trimmer"), start=start, end=end)
        assert r.status_code == 200
        for token in ("@members.example", "555-01", "Hal Brennan", "Mina Castellanos", "shedline-"):
            assert token not in r.text, token
        by_lane = {l["lane_index"]: l["spans"] for l in r.json()["lanes"]}
        for spans in by_lane.values():
            assert all(set(s) == MEMBER_SPAN_KEYS for s in spans)
        assert [s["mine"] for s in by_lane[mine["unit"]["lane_index"]] if s["start_date"] == start] == [True]
        assert [s["mine"] for s in by_lane[theirs["unit"]["lane_index"]] if s["start_date"] == start] == [False]
        staff_r = staff.get(lanes_path("hedge-trimmer"))
        for token in ("@members.example", "555-01"):
            assert token not in staff_r.text
        records = {s["record"]["id"]: s for l in staff_r.json()["lanes"] for s in l["spans"]}
        span = records[mine["id"]]
        assert set(span) == MEMBER_SPAN_KEYS | {"borrower", "record"}
        assert span["borrower"] == {"name": "Mina Castellanos"} and span["record"] == {"type": "hold", "id": mine["id"]}
        assert span["mine"] is False
    finally:
        prepare(staff, ["mem-mina", "mem-hal"], [])


def test_wf_browse_lanes_happy(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-mina", "mem-hal"], ["tile-saw"])
    start, end = lib.span(6, 1)
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "mem-hal")
        saw_name, _, saw_labels, saw_deposit, saw_replacement = ITEMS["tile-saw"]
        card = page.get_by_role("article", name=saw_name)
        expect(card).to_contain_text(f"{len(saw_labels)} of {len(saw_labels)} free today", timeout=UI_TIMEOUT_MS)
        expect(card).to_contain_text(f"Deposit {money(saw_deposit)}")
        expect(card).to_contain_text(f"Replacement {money(saw_replacement)}")
        make_hold(Api(app_url, "mem-mina"), "tile-saw", start, end)
        click(card.get_by_role("link", name="7-inch wet tile saw"))
        expect(page.get_by_role("heading", name="7-inch wet tile saw", level=1)).to_be_visible(timeout=UI_TIMEOUT_MS)
        lanes = page.get_by_role("region", name="Unit lanes")
        first, second = lanes.get_by_role("group", name=group_name("tile-saw", 0)), lanes.get_by_role("group", name=group_name("tile-saw", 1))
        expect(first).to_be_visible()
        assert first.bounding_box()["y"] < second.bounding_box()["y"]
        availability = page.get_by_role("region", name="Availability")
        expect(availability).to_contain_text(f"of {len(saw_labels)} units free today")
        fill(page.get_by_label("Pickup date"), start)
        fill(page.get_by_label("Return date"), end)
        soon(page, lambda: expect(availability).to_contain_text(free_for_dates(1, len(saw_labels)), timeout=POLL_MS))
        expect(first).to_contain_text("Held")
        expect(first).not_to_contain_text("Mina")
    assert staff.ok(lanes_path("tile-saw"), start=start, end=end)["units_free"] == 1
    clear_member(staff, "mem-mina")


def test_wf_browse_lanes_library_time(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-wren"], ["drill-driver"])
    late_evening = lib.yesterday_at("21:00")
    loan = make_loan(staff, "mem-wren", "drill-driver-1", lib.next_open(), late_evening)
    try:
        library_date = instant(late_evening).astimezone(ZONE).date()
        assert library_date == lib.today - timedelta(days=1)
        assert instant(late_evening).date() != library_date
        lanes = staff.ok(lanes_path("drill-driver"))
        assert lanes["from"] == lib.today.isoformat()
        span = next(s for l in lanes["lanes"] for s in l["spans"] if s["record"]["id"] == loan["id"])
        assert span["start_date"] == library_date.isoformat()
        assert span["status"] == "out"
        expected_closed = sum(1 for i in range(LANE_DAYS) if not lib.is_open(lib.today + timedelta(days=i)))
        context = browser.new_context(timezone_id=FOREIGN_ZONE, viewport={"width": 1280, "height": 800})
        try:
            page = context.new_page()
            ui_sign_in(page, app_url, "mem-wren")
            page.goto(app_url.rstrip("/") + "/items/drill-driver")
            own = page.get_by_role("region", name="Unit lanes").get_by_role("group", name=group_name("drill-driver", 0))
            expect(own).to_contain_text("Out", timeout=UI_TIMEOUT_MS)
            expect(own).to_contain_text("yours")
            group = page.get_by_role("region", name="Unit lanes").get_by_role("group", name=group_name("drill-driver", 1))
            expect(group).to_be_visible(timeout=UI_TIMEOUT_MS)
            word = re.compile(r"\bclosed\b", re.I)
            counts = (len(word.findall(group.aria_snapshot())), group.get_by_label(word).count(), group.get_by_text(word).count())
            assert expected_closed in counts, (counts, expected_closed)
        finally:
            context.close()
    finally:
        check_in(staff, loan["id"])


def test_first_free_lane(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-mina", "mem-hal", "mem-tobi"], ["pressure-washer"])
    days = lib.opens(lib.today + timedelta(days=3), 4)
    try:
        r1 = place_hold(Api(app_url, "mem-mina"), "pressure-washer", days[0], days[1])
        assert r1.status_code == 201, r1.text
        body = r1.json()
        assert set(body) == {"hold", "units_free", "unit_count"} and body["unit_count"] == 3 and body["units_free"] == 2
        hold = body["hold"]
        assert hold["unit"] == {"id": "pressure-washer-1", "label": "PW-1", "lane_index": 0}
        assert (hold["status"], hold["ready_at"], hold["pickup_deadline"]) == ("requested", None, None)
        assert (hold["start_date"], hold["end_date"]) == (days[0].isoformat(), days[1].isoformat())
        r2 = place_hold(Api(app_url, "mem-hal"), "pressure-washer", days[1], days[2]).json()
        assert r2["hold"]["unit"]["lane_index"] == 1 and r2["units_free"] == 1
        r3 = place_hold(Api(app_url, "mem-tobi"), "pressure-washer", days[2], days[3]).json()
        assert r3["hold"]["unit"]["lane_index"] == 0 and r3["units_free"] == 1
        assert staff.ok("/api/items/pressure-washer/lanes", start=days[2].isoformat(), end=days[3].isoformat())["units_free"] == 1
    finally:
        prepare(staff, ["mem-mina", "mem-hal", "mem-tobi"], [])


def test_hold_race_for_last_units(app_url: str, staff: Api, lib: Library) -> None:
    racers = ["mem-mina", "mem-hal", "mem-tobi", "mem-wren", "mem-juno"]
    prepare(staff, racers, ["pressure-washer"])
    start, end = lib.span(10, 1)
    clients = [Api(app_url, p) for p in racers]
    try:
        results = race([lambda c=c: place_hold(c, "pressure-washer", start, end) for c in clients])
        winners = [r.json() for r in results if r.status_code == 201]
        assert len(winners) == 3, [r.text for r in results]
        assert sorted(w["hold"]["unit"]["lane_index"] for w in winners) == [0, 1, 2]
        assert sorted(w["units_free"] for w in winners) == [0, 1, 2]
        for r in results:
            if r.status_code != 201:
                assert_error(r, 409, "no_unit_free")
        lanes = staff.ok("/api/items/pressure-washer/lanes", start=start, end=end)
        assert lanes["units_free"] == 0 and all(l["busy_for_range"] for l in lanes["lanes"])
        assert staff.ok("/api/items/pressure-washer")["item"]["units_free_today"] == free_today_from_lanes(staff, "pressure-washer", lib.today)
    finally:
        prepare(staff, racers, [])


def test_last_unit_one_winner(app_url: str, staff: Api, lib: Library) -> None:
    racers = ["mem-mina", "mem-hal", "mem-wren", "mem-juno"]
    prepare(staff, racers, ["laser-level"])
    start, end = lib.span(11, 1)
    clients = [Api(app_url, p) for p in racers]
    try:
        results = race([lambda c=c: place_hold(c, "laser-level", start, end) for c in clients])
        winners = [r for r in results if r.status_code == 201]
        assert len(winners) == 1, [r.text for r in results]
        for r in results:
            if r.status_code != 201:
                assert_error(r, 409, "no_unit_free")
        body = winners[0].json()
        assert body["hold"]["unit"]["id"] == unit_of("laser-level", 0) and body["units_free"] == 0
        created = [
            h for h in pages(staff, "/api/holds", "holds", status="requested")
            if h["item"]["id"] == "laser-level" and h["start_date"] == start and h["member"]["id"] in racers
        ]
        assert len(created) == 1
        assert staff.ok("/api/items/laser-level/lanes", start=start, end=end)["units_free"] == 0
    finally:
        prepare(staff, racers, [])


HOLD_DATE_CASES = {
    "before_today": "start_date",
    "past_horizon": "start_date",
    "monday_pickup": "start_date",
    "return_before_pickup": "end_date",
    "loan_too_long": "end_date",
    "monday_return": "end_date",
}


def hold_dates_for(case: str, lib: Library) -> tuple[date, date]:
    t = lib.today
    first_monday = next(t + timedelta(days=i) for i in range(1, 8) if (t + timedelta(days=i)).weekday() == 0)
    first_tuesday = first_monday + timedelta(days=1)
    if case == "before_today":
        return t - timedelta(days=1), lib.open_on_or_after(t + timedelta(days=1))
    if case == "past_horizon":
        start = lib.open_on_or_after(t + timedelta(days=HORIZON_DAYS + 1))
        return start, start
    if case == "monday_pickup":
        return first_monday, lib.open_after(first_monday)
    if case == "return_before_pickup":
        start = lib.open_on_or_after(t + timedelta(days=5))
        earlier = start - timedelta(days=1)
        while not lib.is_open(earlier):
            earlier -= timedelta(days=1)
        return start, earlier
    if case == "loan_too_long":
        start = lib.open_on_or_after(t + timedelta(days=1))
        return start, lib.open_on_or_after(start + timedelta(days=MAX_SPAN_DAYS + 1))
    return first_tuesday, first_tuesday + timedelta(days=6)


@pytest.mark.parametrize("case", list(HOLD_DATE_CASES), ids=list(HOLD_DATE_CASES))
def test_hold_dates(app_url: str, staff: Api, lib: Library, case: str) -> None:
    prepare(staff, ["mem-hal"], [])
    hal = Api(app_url, "mem-hal")
    start, end = hold_dates_for(case, lib)
    field = HOLD_DATE_CASES[case]
    r = place_hold(hal, "tile-saw", start, end)
    assert_error(r, 422, "validation", fields={field: FIELD[field]})
    assert active_count(staff, "mem-hal") == 0


def test_hold_replay(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-juno", "mem-hal"], ["carpet-cleaner"])
    juno, hal = Api(app_url, "mem-juno"), Api(app_url, "mem-hal")
    start, end = lib.span(6, 1)
    body = {"item_id": "carpet-cleaner", "start_date": start, "end_date": end}
    key = idempotency_key()
    try:
        first = juno.post("/api/holds", body, key=key)
        assert first.status_code == 201, first.text
        again = juno.post("/api/holds", body, key=key)
        assert again.status_code == 201 and again.json() == first.json()
        assert staff.ok("/api/items/carpet-cleaner/lanes", start=start, end=end)["units_free"] == 1
        assert_error(juno.post("/api/holds", {**body, "end_date": start}, key=key), 409, "idempotency_conflict")
        assert staff.ok("/api/items/carpet-cleaner/lanes", start=start, end=end)["units_free"] == 1
        assert_error(juno.post("/api/holds", body), 422, "validation", fields={"idempotency_key": FIELD["idempotency_key"]})
        assert_error(juno.post("/api/holds", body, key="k" * 101), 422, "validation", fields={"idempotency_key": FIELD["idempotency_key"]})
        retry_key = idempotency_key()
        assert_error(juno.post("/api/holds", {**body, "start_date": "not-a-date"}, key=retry_key), 422, "validation")
        other_start, other_end = lib.span(14, 1)
        later = juno.post("/api/holds", {**body, "start_date": other_start, "end_date": other_end}, key=retry_key)
        assert later.status_code == 201, later.text
        scoped = hal.post("/api/holds", {**body, "start_date": other_start, "end_date": other_end}, key=key)
        assert scoped.status_code == 201, scoped.text
        assert scoped.json()["hold"]["id"] != first.json()["hold"]["id"]
    finally:
        prepare(staff, ["mem-juno", "mem-hal"], [])


def test_lane_drop(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-mina", "mem-hal", "mem-tobi"], ["tile-saw"])
    start, end = lib.span(8, 1)
    make_hold(Api(app_url, "mem-mina"), "tile-saw", start, end)
    holds_glob = "**/api/holds"
    try:
        for person, expected in (("mem-hal", "TS-2"), ("mem-tobi", None)):
            with open_app(browser, app_url + "/") as page:
                ui_sign_in(page, app_url, person)
                page.goto(app_url.rstrip("/") + "/items/tile-saw")
                fill(page.get_by_label("Pickup date"), start)
                fill(page.get_by_label("Return date"), end)
                availability = page.get_by_role("region", name="Availability")
                lanes = page.get_by_role("region", name="Unit lanes")
                lane1 = lanes.get_by_role("group", name=group_name("tile-saw", 0))
                shown_before = 1 if expected else 0
                soon(page, lambda: expect(availability).to_contain_text(free_for_dates(shown_before, 2), timeout=POLL_MS))
                posts: list[Any] = []
                page.on("request", lambda req: posts.append(req) if req.method == "POST" and req.url.endswith("/api/holds") else None)
                with held(page, holds_glob) as gate:
                    click(page.get_by_role("button", name="Hold a unit"))
                    pending = page.get_by_role("button", name="Finding a free unit…")
                    expect(pending).to_be_visible()
                    pending.dispatch_event("click")
                    bar = page.get_by_role("img", name="Claim bar").first
                    expect(bar).to_be_visible()
                    bar_box, lane_box = bar.bounding_box(), lane1.bounding_box()
                    assert bar_box["y"] + bar_box["height"] / 2 <= lane_box["y"] + lane_box["height"] / 2
                    with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/holds")) as info:
                        gate.release()
                assert len(posts) == 1
                if expected:
                    response = info.value.json()
                    assert response["hold"]["unit"]["label"] == expected and response["units_free"] == 0
                    assert numeral(availability) == 1
                advance(page, LANE_DROP_MAX_MS)
                settle(lanes)
                if expected:
                    group = lanes.get_by_role("group", name=f"Unit {expected}")
                    settled = group.get_by_role("img", name="Claim bar")
                    expect(settled).to_be_visible()
                    assert inside(settled.bounding_box(), group.bounding_box())
                    expect(availability).to_contain_text(free_for_dates(0, 2))
                    expect(page.get_by_role("status", name="Claim result")).to_have_text(held_copy(1, 2, 0))
                else:
                    expect(page.get_by_role("status", name="Claim result")).to_have_text(COPY["no_unit_free"])
                    for label in ("TS-1", "TS-2"):
                        for b in lanes.get_by_role("group", name=f"Unit {label}").get_by_role("img", name="Claim bar").all():
                            assert not shown(b)
                    assert numeral(availability) == 0
    finally:
        prepare(staff, ["mem-mina", "mem-hal", "mem-tobi"], [])


def test_wf_reserve_unit_happy(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-hal"], ["tile-saw"])
    start, end = lib.span(9, 1)
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "mem-hal")
        click(page.get_by_role("article", name="7-inch wet tile saw").get_by_role("link", name="7-inch wet tile saw"))
        fill(page.get_by_label("Pickup date"), start)
        fill(page.get_by_label("Return date"), end)
        with page.expect_response(is_hold_post, timeout=UI_TIMEOUT_MS):
            page.get_by_label("Return date").press("Enter")
        claim_result = page.get_by_role("status", name="Claim result")
        soon(page, lambda: expect(claim_result).to_have_text(held_copy(0, 2, 1), timeout=POLL_MS))
        advance(page, LANE_DROP_MAX_MS)
        settle(page.get_by_role("region", name="Unit lanes"))
        assigned_bar = page.get_by_role("group", name=group_name("tile-saw", 0)).get_by_role("img", name="Claim bar")
        soon(page, lambda: expect(assigned_bar).to_be_visible(timeout=POLL_MS))
        page.goto(app_url.rstrip("/") + "/my-loans")
        row = page.get_by_role("region", name="Holds").get_by_role("listitem", name=re.compile("^" + re.escape(record_name("tile-saw", 0)))).filter(has_text="Requested")
        expect(row).to_have_count(1, timeout=UI_TIMEOUT_MS)
    holds = [h for h in pages(staff, "/api/holds", "holds", status="requested") if h["member"]["id"] == "mem-hal"]
    assert [(h["item"]["id"], h["unit"]["label"], h["start_date"], h["end_date"]) for h in holds] == [("tile-saw", "TS-1", start, end)]
    clear_member(staff, "mem-hal")


def test_wf_reserve_unit_refused(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-hal", "mem-mina"], ["laser-level"])
    start, end = lib.span(5, 1)
    make_hold(Api(app_url, "mem-mina"), "laser-level", start, end)
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "mem-hal")
        page.goto(app_url.rstrip("/") + "/items/laser-level")
        fill(page.get_by_label("Pickup date"), start)
        fill(page.get_by_label("Return date"), end)
        press_hold(page, COPY["no_unit_free"])
    assert active_count(staff, "mem-hal") == 0
    clear_member(staff, "mem-mina")


def test_hold_transitions(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-mina"], ["hedge-trimmer"])
    mina, volunteer = Api(app_url, "mem-mina"), Api(app_url, "usr-dev")
    start, end = lib.span(3, 1)
    loan_id = None
    try:
        h1 = make_hold(mina, "hedge-trimmer", start, end)
        assert_error(checkout(volunteer, h1["id"]), 409, "invalid_transition", transition("hold", "requested"))
        assert_error(mina.post(f"/api/holds/{h1['id']}/ready"), 403, "forbidden")
        ready = make_ready(volunteer, h1["id"])
        assert ready["status"] == "ready" and ready["ready_at"] and ready["pickup_deadline"]
        assert_error(volunteer.post(f"/api/holds/{h1['id']}/ready"), 409, "invalid_transition", transition("hold", "ready"))
        r = mina.post(f"/api/holds/{h1['id']}/cancel")
        assert r.status_code == 200 and r.json()["hold"]["status"] == "cancelled"
        assert_error(mina.post(f"/api/holds/{h1['id']}/cancel"), 409, "invalid_transition", transition("hold", "cancelled"))
        assert_error(volunteer.post(f"/api/holds/{h1['id']}/ready"), 409, "invalid_transition", transition("hold", "cancelled"))
        assert_error(checkout(volunteer, h1["id"]), 409, "invalid_transition", transition("hold", "cancelled"))
        h2 = make_hold(mina, "hedge-trimmer", start, end)
        assert volunteer.post(f"/api/holds/{h2['id']}/cancel").json()["hold"]["status"] == "cancelled"
        h3 = make_hold(mina, "hedge-trimmer", start, end)
        make_ready(volunteer, h3["id"])
        co = checkout(volunteer, h3["id"])
        assert co.status_code == 201, co.text
        loan_id = co.json()["loan"]["id"]
        assert staff.ok(f"/api/holds/{h3['id']}")["hold"]["status"] == "collected"
        assert_error(mina.post(f"/api/holds/{h3['id']}/cancel"), 409, "invalid_transition", transition("hold", "collected"))
        assert_error(volunteer.post(f"/api/holds/{h3['id']}/ready"), 409, "invalid_transition", transition("hold", "collected"))
        assert_error(checkout(volunteer, h3["id"]), 409, "invalid_transition", transition("hold", "collected"))
    finally:
        prepare(staff, ["mem-mina"], [])


def test_ready_notice_email(app_url: str, staff: Api, lib: Library, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-hal"], ["post-hole-digger"])
    hal = Api(app_url, "mem-hal")
    hold = make_hold(hal, "post-hole-digger", *lib.span(5, 0))
    try:
        ready = make_ready(staff, hold["id"])
        window = lib.settings["pickup_window_seconds"]
        assert instant(ready["pickup_deadline"]) - instant(ready["ready_at"]) == timedelta(seconds=window)
        messages = inbox(mail, "mem-hal", "Ready for pickup: Post hole digger, unit PH-1")
        assert len(messages) == 1
        assert from_desk(messages[0])
        assert any(f"Pick up by {t}." in text(messages[0]) for t in local_time_options(ready["pickup_deadline"])), text(messages[0])
        assert_error(staff.post(f"/api/holds/{hold['id']}/ready"), 409, "invalid_transition", transition("hold", "ready"))
        assert len(inbox(mail, "mem-hal", "Ready for pickup: Post hole digger, unit PH-1", count=2, seconds=BACKGROUND_DELAY_S)) == 1
    finally:
        clear_member(staff, "mem-hal")


def test_pickup_window_expiry(app_url: str, staff: Api, lib: Library, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-tobi"], ["post-hole-digger", "drill-driver"])
    tobi = Api(app_url, "mem-tobi")
    start, end = lib.span(2, 0)
    try:
        hold = make_hold(tobi, "post-hole-digger", start, end)
        for offset in (3, 4, 5):
            make_hold(tobi, "drill-driver", *lib.span(offset, 0))
        ready = make_ready(staff, hold["id"])
        assert_error(place_hold(tobi, "drill-driver", *lib.span(6, 0)), 409, "borrowing_limit")
        assert staff.ok("/api/items/post-hole-digger/lanes", start=start, end=end)["units_free"] == 0
        window = lib.settings["pickup_window_seconds"]
        lapsed = inbox(mail, "mem-tobi", "Hold lapsed: Post hole digger, unit PH-1", seconds=window + BACKGROUND_DELAY_S + MAIL_SLACK_S)
        assert len(lapsed) == 1
        assert any(
            f"Your pickup window closed at {t}. The unit is back on the shelf for other members." in text(lapsed[0])
            for t in local_time_options(ready["pickup_deadline"])
        ), text(lapsed[0])
        assert staff.ok(f"/api/holds/{hold['id']}")["hold"]["status"] == "expired"
        assert staff.ok("/api/items/post-hole-digger/lanes", start=start, end=end)["units_free"] == 1
        assert_error(checkout(staff, hold["id"]), 409, "hold_expired")
        assert place_hold(tobi, "drill-driver", *lib.span(6, 0)).status_code == 201
    finally:
        clear_member(staff, "mem-tobi")


def test_wf_pickup_window_ready(app_url: str, browser: Browser, staff: Api, lib: Library, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-hal"], ["hedge-trimmer"])
    clear_all_holds(staff)
    hold = make_hold(Api(app_url, "mem-hal"), "hedge-trimmer", *lib.span(3, 1))
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-dev")
        prep = page.get_by_role("region", name="Holds to prepare")
        expect(prep).to_contain_text("Hal Brennan", timeout=UI_TIMEOUT_MS)
        buttons = prep.get_by_role("button", name="Mark ready")
        expect(buttons).to_have_count(1)
        click(buttons)
        expect(page.get_by_role("status", name="Counter result")).to_have_text(f"Marked ready. Pickup notice queued for {PEOPLE['mem-hal'][0]}.", timeout=UI_TIMEOUT_MS)
        ready_region = page.get_by_role("region", name="Ready for pickup")
        expect(ready_region).to_contain_text("Hal Brennan")
        expect(ready_region.get_by_role("button", name="Check out")).to_have_count(1)
    stored = staff.ok(f"/api/holds/{hold['id']}")["hold"]
    assert stored["status"] == "ready"
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "mem-hal")
        page.goto(app_url.rstrip("/") + "/my-loans")
        row = page.get_by_role("region", name="Holds").get_by_role("listitem", name=re.compile("^" + re.escape(record_name("hedge-trimmer", 0)))).filter(has_text="Pick up by")
        expect(row).to_have_count(1, timeout=UI_TIMEOUT_MS)
        expect(row).to_contain_text("Ready")
        row_text = " ".join(row.inner_text().split()).lower()
        assert any(f"Pick up by {t}".lower() in row_text for t in local_time_options(stored["pickup_deadline"])), row_text
    assert len(inbox(mail, "mem-hal", f"Ready for pickup: {record_name('hedge-trimmer', 0)}")) == 1
    clear_member(staff, "mem-hal")


def test_wf_pickup_window_stale_row(app_url: str, browser: Browser, staff: Api, lib: Library, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-hal"], ["hedge-trimmer"])
    clear_all_holds(staff)
    hal = Api(app_url, "mem-hal")
    hold = make_hold(hal, "hedge-trimmer", *lib.span(3, 1))
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-dev")
        button = page.get_by_role("region", name="Holds to prepare").get_by_role("button", name="Mark ready")
        expect(button).to_have_count(1, timeout=UI_TIMEOUT_MS)
        assert hal.post(f"/api/holds/{hold['id']}/cancel").status_code == 200
        click(button)
        expect(page.get_by_role("status", name="Counter result")).to_have_text(transition("hold", "cancelled"), timeout=UI_TIMEOUT_MS)
    assert staff.ok(f"/api/holds/{hold['id']}")["hold"]["status"] == "cancelled"
    assert inbox(mail, "mem-hal", f"Ready for pickup: {record_name('hedge-trimmer', 0)}", seconds=BACKGROUND_DELAY_S) == []


def test_checkout_deposit_billing(app_url: str, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-hal"], ["tile-saw"])
    hal, volunteer = Api(app_url, "mem-hal"), Api(app_url, "usr-dev")
    start, end = lib.span(2, 1)
    hold = make_hold(hal, "tile-saw", start, end)
    make_ready(volunteer, hold["id"])
    key = idempotency_key()
    loan_id = None
    try:
        r = checkout(volunteer, hold["id"], key)
        assert r.status_code == 201, r.text
        assert set(r.json()) == {"loan"}
        loan = r.json()["loan"]
        loan_id = loan["id"]
        assert set(loan) == LOAN_KEYS
        assert (loan["status"], loan["due_date"], loan["hold_id"]) == ("out", end, hold["id"])
        assert same_instant(loan["due_at"], lib.closing_instant(end))
        deposit = ITEMS["tile-saw"][3]
        assert (loan["deposit_cents"], loan["replacement_cents"]) == (deposit, ITEMS["tile-saw"][4])
        assert loan["member"] == {"id": "mem-hal", "name": "Hal Brennan"} and loan["unit"]["label"] == "TS-1"
        assert all(loan[k] is None for k in ("renewed_at", "returned_at", "on_time", "late_days", "inspection", "settlement"))
        assert loan["photos"] == []
        assert instant(loan["checked_out_at"]).astimezone(ZONE).date() == lib.today
        assert staff.ok(f"/api/holds/{hold['id']}")["hold"]["status"] == "collected"
        replay = checkout(volunteer, hold["id"], key)
        assert replay.status_code == 201 and replay.json() == r.json()
        assert_error(volunteer.post("/api/loans", {"hold_id": hold["id"], "member_id": "mem-hal"}, key=key), 409, "idempotency_conflict")
        account = killbill.account_by_key("shedline-mem-hal")
        assert account is not None and account["currency"] == "USD" and account["name"] == "Hal Brennan"
        payment = killbill.payment_by_key(f"shedline-{loan_id}-deposit")
        assert payment is not None and payment["accountId"] == account["accountId"]
        txs = payment.get("transactions") or []
        assert len(txs) == 1 and txs[0]["transactionType"] == "PURCHASE"
        assert txs[0]["transactionExternalKey"] == f"shedline-{loan_id}-deposit-hold" and cents(txs[0]["amount"]) == deposit
        entries = ledger(staff, loan_id)
        assert len(entries) == 1 and set(entries[0]) == LEDGER_KEYS
        assert (entries[0]["kind"], entries[0]["amount_cents"], entries[0]["item"]) == ("deposit_hold", deposit, {"id": "tile-saw", "name": ITEMS["tile-saw"][0]})
        assert len(loans_for_hold(staff, hold["id"])) == 1
    finally:
        if loan_id:
            check_in(staff, loan_id)


def test_counter_checkout_replay(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-juno"], ["post-hole-digger"])
    juno, volunteer = Api(app_url, "mem-juno"), Api(app_url, "usr-ines")
    start, end = lib.span(2, 2)
    hold = make_hold(juno, "post-hole-digger", start, end)
    try:
        assert_error(checkout(volunteer, hold["id"]), 409, "invalid_transition", transition("hold", "requested"))
        make_ready(volunteer, hold["id"])
        key = idempotency_key()
        r = checkout(volunteer, hold["id"], key)
        assert r.status_code == 201, r.text
        loan = r.json()["loan"]
        assert (loan["status"], loan["hold_id"], loan["due_date"], loan["deposit_cents"]) == ("out", hold["id"], end, 0)
        assert same_instant(loan["due_at"], lib.closing_instant(end))
        assert loan["member"] == {"id": "mem-juno", "name": "Juno Achterberg"} and loan["unit"]["id"] == unit_of("post-hole-digger", 0)
        assert staff.ok(f"/api/holds/{hold['id']}")["hold"]["status"] == "collected"
        replay = checkout(volunteer, hold["id"], key)
        assert replay.status_code == 201 and replay.json() == r.json()
        assert len(loans_for_hold(staff, hold["id"])) == 1
        assert staff.ok(f"/api/loans/{loan['id']}")["loan"]["due_date"] == end
        assert ledger(staff, loan["id"]) == []
    finally:
        prepare(staff, ["mem-juno"], [])


def test_racing_checkouts(app_url: str, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-mina"], ["pressure-washer"])
    mina = Api(app_url, "mem-mina")
    start, end = lib.span(2, 1)
    try:
        hold = make_hold(mina, "pressure-washer", start, end)
        make_ready(staff, hold["id"])
        before = len(kb_transactions(killbill, "mem-mina"))
        counters = [Api(app_url, p) for p in ("usr-dev", "usr-ines", "usr-dev", "usr-ines")]
        results = race([lambda c=c: checkout(c, hold["id"]) for c in counters])
        winners = [r for r in results if r.status_code == 201]
        assert len(winners) == 1, [r.text for r in results]
        for r in results:
            if r.status_code != 201:
                assert_error(r, 409, "invalid_transition", transition("hold", "collected"))
        loan = winners[0].json()["loan"]
        assert len(kb_transactions(killbill, "mem-mina")) == before + 1
        assert len(of_type(kb_payment_txs(killbill, f"shedline-{loan['id']}-deposit"), "PURCHASE")) == 1
        assert [e["kind"] for e in ledger(staff, loan["id"])] == ["deposit_hold"]
        assert len(loans_for_hold(staff, hold["id"])) == 1

        second = make_hold(mina, "pressure-washer", start, end)
        make_ready(staff, second["id"])
        before = len(kb_transactions(killbill, "mem-mina"))
        dev = Api(app_url, "usr-dev")
        cancel_r, checkout_r = race([lambda: mina.post(f"/api/holds/{second['id']}/cancel"), lambda: checkout(dev, second["id"])])
        assert (cancel_r.status_code == 200) != (checkout_r.status_code == 201), (cancel_r.text, checkout_r.text)
        if checkout_r.status_code == 201:
            assert_error(cancel_r, 409, "invalid_transition", transition("hold", "collected"))
            assert len(kb_transactions(killbill, "mem-mina")) == before + 1
        else:
            assert_error(checkout_r, 409, "invalid_transition", transition("hold", "cancelled"))
            assert loans_for_hold(staff, second["id"]) == []
            assert len(kb_transactions(killbill, "mem-mina")) == before
    finally:
        prepare(staff, ["mem-mina"], [])


def test_wf_counter_checkout_happy(app_url: str, browser: Browser, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-hal"], ["tile-saw"])
    clear_all_holds(staff)
    start, end = lib.span(2, 1)
    hold = make_hold(Api(app_url, "mem-hal"), "tile-saw", start, end)
    make_ready(staff, hold["id"])
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-dev")
        button = page.get_by_role("region", name="Ready for pickup").get_by_role("button", name="Check out")
        expect(button).to_have_count(1, timeout=UI_TIMEOUT_MS)
        click(button)
        expect(page.get_by_role("status", name="Counter result")).to_have_text(
            f"Lent to Hal Brennan. Due {local_time(lib.closing_instant(end))}.", timeout=UI_TIMEOUT_MS)
        expect(page.get_by_role("region", name="Out on loan").get_by_role("link", name=record_name("tile-saw", 0))).to_be_visible()
    loans = loans_for_hold(staff, hold["id"])
    assert len(loans) == 1
    assert len(of_type(kb_payment_txs(killbill, f"shedline-{loans[0]['id']}-deposit"), "PURCHASE")) == 1
    check_in(staff, loans[0]["id"])


def test_wf_counter_checkout_two_devices(app_url: str, browser: Browser, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-hal"], ["tile-saw"])
    clear_all_holds(staff)
    start, end = lib.span(3, 1)
    hold = make_hold(Api(app_url, "mem-hal"), "tile-saw", start, end)
    make_ready(staff, hold["id"])
    before = len(kb_transactions(killbill, "mem-hal"))
    with open_app(browser, app_url + "/") as dev_page, open_app(browser, app_url + "/") as ines_page:
        ui_sign_in(dev_page, app_url, "usr-dev")
        ui_sign_in(ines_page, app_url, "usr-ines")
        buttons = [p.get_by_role("region", name="Ready for pickup").get_by_role("button", name="Check out") for p in (dev_page, ines_page)]
        for b in buttons:
            expect(b).to_have_count(1, timeout=UI_TIMEOUT_MS)
        click(buttons[0])
        click(buttons[1])
        lent = f"Lent to Hal Brennan. Due {local_time(lib.closing_instant(end))}."
        collected = transition("hold", "collected")
        either = re.compile("^(" + re.escape(lent) + "|" + re.escape(collected) + ")$")
        results = [p.get_by_role("status", name="Counter result") for p in (dev_page, ines_page)]
        for result in results:
            expect(result).to_have_text(either, timeout=UI_TIMEOUT_MS)
        assert sorted(r.inner_text().strip() for r in results) == sorted([lent, collected])
    loans = loans_for_hold(staff, hold["id"])
    assert len(loans) == 1
    assert len(kb_transactions(killbill, "mem-hal")) == before + 1
    check_in(staff, loans[0]["id"])


def test_walk_in_loans(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-wren", "mem-juno", "mem-sol"], ["ext-ladder", "hedge-trimmer"])
    volunteer = Api(app_url, "usr-dev")
    due = lib.next_open()
    try:
        loan = make_loan(volunteer, "mem-wren", "ext-ladder-1", due)
        assert (loan["status"], loan["due_date"]) == ("out", due) and not loan["hold_id"]
        assert same_instant(loan["due_at"], lib.closing_instant(due))
        assert instant(loan["checked_out_at"]).astimezone(ZONE).date() == lib.today
        assert_error(lend(volunteer, "mem-juno", "ext-ladder-1", due), 409, "unit_busy")
        assert active_count(staff, "mem-juno") == 0
        back = make_loan(volunteer, "mem-sol", "hedge-trimmer-2", SPRING_DUE, SPRING_CHECKOUT)
        assert back["status"] == "overdue" and same_instant(back["checked_out_at"], SPRING_CHECKOUT)
        check_in(staff, back["id"], SPRING_LATE_RETURN)
        assert_error(lend(volunteer, "mem-juno", "hedge-trimmer-1", due, "2099-03-05T15:00:00Z"), 422, "validation", fields={"checked_out_at": FIELD["checked_out_at"]})
        too_far = lib.open_on_or_after(lib.today + timedelta(days=MAX_SPAN_DAYS + 1))
        assert_error(lend(volunteer, "mem-juno", "hedge-trimmer-1", too_far), 422, "validation", fields={"due_date": FIELD["due_walk_in"]})
        assert_error(lend(volunteer, "mem-juno", "hedge-trimmer-1", "2026-03-04", SPRING_CHECKOUT), 422, "validation", fields={"due_date": FIELD["due_walk_in"]})
        assert_error(lend(volunteer, "mem-nobody", "hedge-trimmer-1", due), 422, "validation", fields={"member_id": "No such member."})
        assert_error(lend(volunteer, "mem-juno", "hedge-trimmer-9", due), 422, "validation", fields={"unit_id": "No such unit."})
        assert_error(lend(Api(app_url, "mem-wren"), "mem-wren", "hedge-trimmer-1", due), 403, "forbidden")
        assert active_count(staff, "mem-juno") == 0
    finally:
        prepare(staff, ["mem-wren", "mem-juno", "mem-sol"], [])


def test_due_reminder(app_url: str, staff: Api, lib: Library, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-juno", "mem-sol"], ["post-hole-digger", "hedge-trimmer"])
    try:
        loan = make_loan(staff, "mem-juno", "post-hole-digger-1", lib.open_on_or_after(lib.today + timedelta(days=2)))
        over = make_loan(staff, "mem-sol", "hedge-trimmer-1", SPRING_DUE, SPRING_CHECKOUT)
        due_text = local_time(loan["due_at"])
        messages = inbox(mail, "mem-juno", f"Due back {due_text}: Post hole digger, unit PH-1")
        assert len(messages) == 1 and from_desk(messages[0])
        assert f"Please return it by {due_text}, washed out and with batteries charged." in text(messages[0])
        assert inbox(mail, "mem-sol", f"Due back {local_time(over['due_at'])}: Hedge trimmer, unit HT-1", seconds=BACKGROUND_DELAY_S) == []
    finally:
        prepare(staff, ["mem-juno", "mem-sol"], [])


def test_renewal(app_url: str, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-wren", "mem-mina", "mem-sol"], ["ext-ladder", "hedge-trimmer"])
    wren, mina, volunteer = Api(app_url, "mem-wren"), Api(app_url, "mem-mina"), Api(app_url, "usr-dev")
    d1 = date.fromisoformat(lib.next_open())
    d2 = lib.open_after(d1)
    try:
        loan = make_loan(staff, "mem-wren", "ext-ladder-1", d1)
        url = f"/api/loans/{loan['id']}/renewal"
        monday = next(d1 + timedelta(days=i) for i in range(1, 8) if (d1 + timedelta(days=i)).weekday() == 0)
        for bad in (d1, monday, lib.open_on_or_after(d1 + timedelta(days=MAX_SPAN_DAYS + 1))):
            assert_error(wren.post(url, {"due_date": bad.isoformat()}, key=idempotency_key()), 422, "validation", fields={"due_date": FIELD["due_renewal"]})
        assert_error(mina.post(url, {"due_date": d2.isoformat()}, key=idempotency_key()), 404, "not_found")
        blocker = make_hold(mina, "ext-ladder", d2, d2)
        assert_error(wren.post(url, {"due_date": d2.isoformat()}, key=idempotency_key()), 409, "unit_busy")
        mina.post(f"/api/holds/{blocker['id']}/cancel")
        key = idempotency_key()
        r = wren.post(url, {"due_date": d2.isoformat()}, key=key)
        assert r.status_code == 200, r.text
        renewed = r.json()["loan"]
        assert (renewed["due_date"], renewed["status"]) == (d2.isoformat(), "out")
        assert same_instant(renewed["due_at"], lib.closing_instant(d2))
        assert renewed["renewed_at"] is not None
        assert wren.post(url, {"due_date": d2.isoformat()}, key=key).json() == r.json()
        assert_error(volunteer.post(url, {"due_date": lib.open_after(d2).isoformat()}, key=idempotency_key()), 409, "renewal_used")
        assert killbill.payment_by_key(f"shedline-{loan['id']}-deposit") is None and ledger(staff, loan["id"]) == []
        overdue = make_loan(staff, "mem-sol", "hedge-trimmer-1", SPRING_DUE, SPRING_CHECKOUT)
        assert_error(staff.post(f"/api/loans/{overdue['id']}/renewal", {"due_date": "2026-03-08"}, key=idempotency_key()), 409, "invalid_transition", transition("loan", "overdue"))
        check_in(staff, overdue["id"], SPRING_LATE_RETURN)
        check_in(staff, loan["id"])
        second = make_loan(staff, "mem-wren", "ext-ladder-1", d1)
        renew_r, hold_r = race([
            lambda: volunteer.post(f"/api/loans/{second['id']}/renewal", {"due_date": d2.isoformat()}, key=idempotency_key()),
            lambda: place_hold(mina, "ext-ladder", d2, d2),
        ])
        if renew_r.status_code == 200:
            assert_error(hold_r, 409, "no_unit_free")
        else:
            assert hold_r.status_code == 201, hold_r.text
            assert_error(renew_r, 409, "unit_busy")
    finally:
        prepare(staff, ["mem-wren", "mem-mina", "mem-sol"], [])


def test_reminder_per_due_time(app_url: str, staff: Api, lib: Library, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-juno"], ["post-hole-digger"])
    juno = Api(app_url, "mem-juno")
    d1 = lib.next_open()
    d2 = lib.open_after(d1).isoformat()
    try:
        loan = make_loan(staff, "mem-juno", "post-hole-digger-1", d1)
        old_subject = f"Due back {local_time(loan['due_at'])}: Post hole digger, unit PH-1"
        assert len(inbox(mail, "mem-juno", old_subject)) == 1
        r = juno.post(f"/api/loans/{loan['id']}/renewal", {"due_date": d2}, key=idempotency_key())
        assert r.status_code == 200, r.text
        new_due = r.json()["loan"]["due_at"]
        fresh = inbox(mail, "mem-juno", f"Due back {local_time(new_due)}: Post hole digger, unit PH-1")
        assert len(fresh) == 1
        assert f"Please return it by {local_time(new_due)}, washed out and with batteries charged." in text(fresh[0])
        assert len(inbox(mail, "mem-juno", old_subject, count=2, seconds=BACKGROUND_DELAY_S)) == 1
    finally:
        clear_member(staff, "mem-juno")


def test_wf_walk_in_reminders_paper_sheet(app_url: str, browser: Browser, staff: Api, lib: Library, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-wren"], ["ext-ladder"])
    yesterday = lib.today - timedelta(days=1)
    due = lib.next_open()
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-dev")
        walk_in = page.get_by_role("region", name="Walk-in loan")
        choose(page, walk_in.get_by_role("combobox", name="Member"), PEOPLE["mem-wren"][0], "mem-wren")
        choose(page, walk_in.get_by_role("combobox", name="Unit"), "LD-1", unit_of("ext-ladder", 0))
        fill(walk_in.get_by_label("Due date"), due)
        fill(walk_in.get_by_label("Checked out at"), f"{yesterday.isoformat()}T10:00")
        click(walk_in.get_by_role("button", name="Lend now"))
        counter_result = page.get_by_role("status", name="Counter result")
        lent = f"Lent to Wren Kowalski. Due {local_time(lib.closing_instant(due))}."
        soon(page, lambda: expect(counter_result).to_have_text(lent, timeout=POLL_MS))
        new_row = page.get_by_role("region", name="Out on loan").get_by_role("link", name=record_name("ext-ladder", 0))
        soon(page, lambda: expect(new_row).to_be_focused(timeout=POLL_MS))
    loans = [l for l in pages(staff, "/api/loans", "loans", status="out") if l["member"]["id"] == "mem-wren"]
    assert len(loans) == 1 and same_instant(loans[0]["checked_out_at"], lib.yesterday_at("10:00"))
    loan = loans[0]
    assert len(inbox(mail, "mem-wren", f"Due back {local_time(loan['due_at'])}: {record_name('ext-ladder', 0)}")) == 1
    new_due = lib.open_after(due)
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "mem-wren")
        page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
        fill(page.get_by_label("New due date"), new_due.isoformat())
        click(page.get_by_role("button", name="Renew"))
        renewal_result = page.get_by_role("status", name="Renewal result")
        renewed_copy = f"Renewed. Due {local_time(lib.closing_instant(new_due))}."
        soon(page, lambda: expect(renewal_result).to_have_text(renewed_copy, timeout=POLL_MS))
        expect(page.get_by_role("button", name="Renew")).to_have_count(0)
        expect(page.get_by_text("renewed")).not_to_have_count(0)
    stored = staff.ok(f"/api/loans/{loan['id']}")["loan"]
    assert stored["due_date"] == new_due.isoformat() and stored["renewed_at"]
    assert len(inbox(mail, "mem-wren", f"Due back {local_time(stored['due_at'])}: {record_name('ext-ladder', 0)}")) == 1
    check_in(staff, loan["id"])


def test_wf_walk_in_reminders_busy_renewal(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-wren", "mem-mina"], ["ext-ladder"])
    due = lib.next_open()
    target = lib.open_after(due)
    loan = make_loan(staff, "mem-wren", "ext-ladder-1", due)
    make_hold(Api(app_url, "mem-mina"), "ext-ladder", target, target)
    try:
        with open_app(browser, app_url + "/") as page:
            ui_sign_in(page, app_url, "mem-wren")
            page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
            fill(page.get_by_label("New due date"), target.isoformat())
            click(page.get_by_role("button", name="Renew"))
            expect(page.get_by_role("status", name="Renewal result")).to_have_text(COPY["unit_busy"], timeout=UI_TIMEOUT_MS)
            expect(page.get_by_role("button", name="Renew")).to_be_visible()
        stored = staff.ok(f"/api/loans/{loan['id']}")["loan"]
        assert stored["due_date"] == due and stored["renewed_at"] is None
    finally:
        prepare(staff, ["mem-wren", "mem-mina"], [])


PHOTO_CASES = {
    "jpeg": ("jpeg", 0, 201, ""),
    "png": ("png", 0, 201, ""),
    "webp": ("webp", 0, 201, ""),
    "at_size_limit": ("jpeg", 5000000, 201, ""),
    "over_size_limit": ("jpeg", 5000001, 413, "photo_too_large"),
    "svg_named_jpg": ("svg", 0, 415, "unsupported_photo"),
    "html": ("html", 0, 415, "unsupported_photo"),
    "pdf": ("pdf", 0, 415, "unsupported_photo"),
    "missing_field": ("", 0, 422, "validation"),
}


@pytest.mark.parametrize("case", list(PHOTO_CASES), ids=list(PHOTO_CASES))
def test_photo_type_and_size(app_url: str, staff: Api, lib: Library, case: str) -> None:
    kind, size, status, code = PHOTO_CASES[case]
    prepare(staff, ["mem-wren"], ["drill-driver"])
    loan = make_loan(staff, "mem-wren", "drill-driver-4", lib.next_open())
    volunteer, store = Api(app_url, "usr-dev"), S3()
    prefix = f"loans/{loan['id']}/"
    try:
        if not kind:
            r = volunteer.upload(loan["id"], png_bytes(), field="note")
        else:
            payload = photo_payload(kind, size)
            r = volunteer.upload(loan["id"], payload)
        if status == 201:
            assert r.status_code == 201, r.text
            photo = r.json()["photo"]
            assert set(r.json()) == {"photo"} and set(photo) == PHOTO_KEYS
            assert (photo["stage"], photo["size_bytes"], photo["url"]) == ("checkout", len(payload), f"/api/loans/{loan['id']}/photos/{photo['id']}")
            assert kind in photo["content_type"]
            download = volunteer.get(photo["url"])
            assert download.status_code == 200 and download.content == payload
            assert download.headers["content-type"].startswith(photo["content_type"])
            assert download.headers["content-disposition"].startswith("inline")
            assert download.headers["x-content-type-options"] == "nosniff"
            assert [part.strip() for part in download.headers["cache-control"].split(",")] == [part.strip() for part in "private, no-store".split(",")]
            assert store.keys(prefix) == [f"{prefix}checkout/{photo['id']}.{EXTENSION[kind]}"]
            assert store.get(store.keys(prefix)[0]) == payload
        else:
            assert_error(r, status, code, fields={"photo": FIELD["required"]} if code == "validation" else None)
            assert store.keys(prefix) == []
            assert staff.ok(f"/api/loans/{loan['id']}")["loan"]["photos"] == []
    finally:
        check_in(staff, loan["id"])


def test_photo_storage_key(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-wren"], ["drill-driver"])
    loan = make_loan(staff, "mem-wren", "drill-driver-4", lib.next_open())
    volunteer, store = Api(app_url, "usr-dev"), S3()
    prefix = f"loans/{loan['id']}/"
    try:
        r = volunteer.upload(loan["id"], png_bytes(), filename=DEVICE_FILE_NAME, declared="image/svg+xml")
        assert r.status_code == 201, r.text
        photo = r.json()["photo"]
        uuid.UUID(photo["id"])
        assert store.keys(prefix) == [f"{prefix}checkout/{photo['id']}.png"]
        device_stem = Path(DEVICE_FILE_NAME).stem
        assert device_stem not in r.text and device_stem not in staff.get(f"/api/loans/{loan['id']}").text
        check_in(staff, loan["id"])
        r2 = volunteer.upload(loan["id"], photo_payload("jpeg"), filename="IMG_0002.jpg")
        assert r2.status_code == 201 and r2.json()["photo"]["stage"] == "return"
        assert f"{prefix}return/{r2.json()['photo']['id']}.jpg" in store.keys(prefix)
        inspect_loan(staff, loan["id"])
        assert_error(volunteer.upload(loan["id"], png_bytes()), 409, "invalid_transition", transition("loan", "inspected"))
        assert len(store.keys(prefix)) == 2
        assert sorted(p["id"] for p in staff.ok(f"/api/loans/{loan['id']}")["loan"]["photos"]) == sorted([photo["id"], r2.json()["photo"]["id"]])
    finally:
        clear_member(staff, "mem-wren")


def test_photo_storage_outage(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-wren"], ["hedge-trimmer"])
    loan = make_loan(staff, "mem-wren", "hedge-trimmer-1", lib.next_open(), lib.yesterday_at("10:00"))
    store, prefix = S3(), f"loans/{loan['id']}/"
    first = staff.upload(loan["id"], png_bytes())
    assert first.status_code == 201, first.text
    down = staff.on(minio_down())
    try:
        assert wait_status(down, "photo_storage", "down")["photo_storage"] == "down"
        started = time.monotonic()
        r = down.upload(loan["id"], png_bytes())
        assert time.monotonic() - started <= OUTAGE_GIVE_UP_S + CLIENT_SLACK_S
        assert_error(r, 503, "photo_storage_unavailable")
        assert_error(down.get(first.json()["photo"]["url"]), 503, "photo_storage_unavailable")
        assert len(down.ok(f"/api/loans/{loan['id']}")["loan"]["photos"]) == 1
        assert len(store.keys(prefix)) == 1
        returned = down.post(f"/api/loans/{loan['id']}/return", {"returned_at": lib.yesterday_at("12:00")})
        assert returned.status_code == 200 and returned.json()["loan"]["status"] == "returned"
        inspected = down.post(f"/api/loans/{loan['id']}/inspection", {"outcome": "ok", "note": ""})
        assert inspected.status_code == 200 and inspected.json()["loan"]["status"] == "inspected"
    finally:
        clear_member(staff, "mem-wren")


def test_photo_cap_race(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-wren"], ["hedge-trimmer"])
    loan = make_loan(staff, "mem-wren", "hedge-trimmer-2", lib.next_open())
    store, prefix = S3(), f"loans/{loan['id']}/"
    try:
        for _ in range(2):
            assert staff.upload(loan["id"], png_bytes()).status_code == 201
        uploaders = [Api(app_url, p) for p in ("usr-dev", "usr-ines", "usr-dev", "usr-ines", "usr-rosa", "usr-rosa")]
        results = race([lambda u=u: u.upload(loan["id"], png_bytes()) for u in uploaders])
        assert sum(r.status_code == 201 for r in results) == STAGE_PHOTOS - 2, [r.text for r in results]
        for r in results:
            if r.status_code != 201:
                assert_error(r, 409, "photo_limit")
        photos = staff.ok(f"/api/loans/{loan['id']}")["loan"]["photos"]
        assert len(photos) == STAGE_PHOTOS
        assert sorted(store.keys(prefix)) == sorted(f"{prefix}checkout/{p['id']}.png" for p in photos)
    finally:
        check_in(staff, loan["id"])


def test_wf_condition_photos_capture(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-hal"], ["hedge-trimmer"])
    loan = make_loan(staff, "mem-hal", "hedge-trimmer-1", lib.next_open(), lib.yesterday_at("10:00"))
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-dev")
        page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
        result = page.get_by_role("status", name="Counter result")
        page.get_by_label("Condition photo").set_input_files(file_png())
        click(page.get_by_role("button", name="Add photo"))
        soon(page, lambda: expect(result).to_have_text("Photo saved.", timeout=POLL_MS))
        checkout_photo = page.get_by_role("region", name="Checkout photos").get_by_role("img", name=photo_name("Checkout", 1))
        soon(page, lambda: expect(checkout_photo).to_be_visible(timeout=POLL_MS))
        fill(page.get_by_label("Returned at"), f"{(lib.today - timedelta(days=1)).isoformat()}T12:00")
        click(page.get_by_role("button", name="Check in"))
        soon(page, lambda: expect(result).to_have_text("Checked in on time.", timeout=POLL_MS))
        page.get_by_label("Condition photo").set_input_files(file_png("IMG_0002.png"))
        click(page.get_by_role("button", name="Add photo"))
        return_photo = page.get_by_role("region", name="Return photos").get_by_role("img", name=photo_name("Return", 1))
        soon(page, lambda: expect(return_photo).to_be_visible(timeout=POLL_MS))
    prefix = f"loans/{loan['id']}/"
    keys = S3().keys(prefix)
    assert sum(k.startswith(f"{prefix}checkout/") for k in keys) == 1 and sum(k.startswith(f"{prefix}return/") for k in keys) == 1
    assert staff.ok(f"/api/loans/{loan['id']}")["loan"]["status"] == "returned"


def test_wf_condition_photos_owner_only(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-hal"], ["drill-driver"])
    loan = make_loan(staff, "mem-hal", "drill-driver-2", lib.next_open())
    try:
        with open_app(browser, app_url + "/") as page:
            ui_sign_in(page, app_url, "usr-ines")
            page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
            page.get_by_label("Condition photo").set_input_files(file_png())
            click(page.get_by_role("button", name="Add photo"))
            saved = page.get_by_role("status", name="Counter result")
            soon(page, lambda: expect(saved).to_have_text("Photo saved.", timeout=POLL_MS))
            checkout_photo = page.get_by_role("region", name="Checkout photos").get_by_role("img", name=photo_name("Checkout", 1))
            soon(page, lambda: expect(checkout_photo).to_be_visible(timeout=POLL_MS))
        photos = staff.ok(f"/api/loans/{loan['id']}")["loan"]["photos"]
        assert len(photos) == 1 and photos[0]["stage"] == "checkout"
        assert S3().keys(f"loans/{loan['id']}/") == [f"loans/{loan['id']}/checkout/{photos[0]['id']}.png"]
        hal, mina = Api(app_url, "mem-hal"), Api(app_url, "mem-mina")
        owned = hal.get(photos[0]["url"])
        assert owned.status_code == 200 and owned.content == png_bytes()
        missing = str(uuid.uuid4())
        theirs, nothing = mina.get(photos[0]["url"]), mina.get(f"/api/loans/{missing}/photos/{missing}")
        assert_error(theirs, 404, "not_found")
        assert theirs.json() == nothing.json()
        with open_app(browser, app_url + "/") as page:
            ui_sign_in(page, app_url, "mem-hal")
            page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
            expect(page.get_by_role("region", name="Checkout photos").get_by_role("img", name=photo_name("Checkout", 1))).to_be_visible(timeout=UI_TIMEOUT_MS)
        with open_app(browser, app_url + "/") as page:
            ui_sign_in(page, app_url, "mem-mina")
            page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
            expect(page.get_by_role("heading", name="Not found")).to_be_visible(timeout=UI_TIMEOUT_MS)
            expect(page.get_by_role("region", name="Checkout photos")).to_have_count(0)
    finally:
        check_in(staff, loan["id"])


def test_wf_condition_photos_outage(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-wren"], ["hedge-trimmer"])
    loan = make_loan(staff, "mem-wren", "hedge-trimmer-1", lib.next_open(), lib.yesterday_at("10:00"))
    assert staff.upload(loan["id"], png_bytes()).status_code == 201
    base = minio_down()
    with open_app(browser, base + "/") as page:
        ui_sign_in(page, base, "usr-dev")
        banner = page.get_by_role("status", name="Counter services")
        soon(page, lambda: expect(banner).to_contain_text("Photo storage offline — add photos later.", timeout=POLL_MS), PROBE_AGE_S + PROBE_SLACK_S, BANNER_TICK_MS)
        page.goto(f"{base}/loans/{loan['id']}")
        expect(page.get_by_role("region", name="Checkout photos")).to_contain_text("Photo unavailable", timeout=UI_TIMEOUT_MS)
        page.get_by_label("Condition photo").set_input_files(file_png())
        click(page.get_by_role("button", name="Add photo"))
        result = page.get_by_role("status", name="Counter result")
        soon(page, lambda: expect(result).to_have_text(COPY["photo_storage_unavailable"], timeout=POLL_MS))
        fill(page.get_by_label("Returned at"), f"{(lib.today - timedelta(days=1)).isoformat()}T12:00")
        click(page.get_by_role("button", name="Check in"))
        soon(page, lambda: expect(result).to_have_text("Checked in on time.", timeout=POLL_MS))
    stored = staff.ok(f"/api/loans/{loan['id']}")["loan"]
    assert stored["status"] == "returned" and len(stored["photos"]) == 1
    assert len(S3().keys(f"loans/{loan['id']}/")) == 1


DUE_CASES = {
    "sat_at_closing": ("2026-03-07", "2026-03-07T23:00:00Z", "2026-03-07T23:00:00Z", True, 0),
    "sat_after_closing": ("2026-03-07", "2026-03-07T23:00:00Z", "2026-03-07T23:00:01Z", False, 1),
    "dst_sun_at_closing": ("2026-03-08", "2026-03-08T22:00:00Z", "2026-03-08T22:00:00Z", True, 0),
    "dst_sun_after_closing": ("2026-03-08", "2026-03-08T22:00:00Z", "2026-03-08T22:00:01Z", False, 1),
}


@pytest.mark.parametrize("case", list(DUE_CASES), ids=list(DUE_CASES))
def test_due_at_closing_time(app_url: str, staff: Api, case: str) -> None:
    due, due_at, returned_at, on_time, late_days = DUE_CASES[case]
    prepare(staff, ["mem-sol"], ["hedge-trimmer"])
    loan = make_loan(staff, "mem-sol", "hedge-trimmer-1", due, SPRING_CHECKOUT)
    assert same_instant(loan["due_at"], due_at)
    back = check_in(staff, loan["id"], returned_at)
    assert same_instant(back["returned_at"], returned_at)
    assert (back["on_time"], back["late_days"]) == (on_time, late_days)


def test_return_and_inspection(app_url: str, staff: Api) -> None:
    prepare(staff, ["mem-sol"], ["hedge-trimmer"])
    sol, volunteer = Api(app_url, "mem-sol"), Api(app_url, "usr-dev")
    loan = make_loan(staff, "mem-sol", "hedge-trimmer-2", SPRING_DUE, SPRING_CHECKOUT)
    url = f"/api/loans/{loan['id']}"
    try:
        assert_error(volunteer.post(f"{url}/inspection", {"outcome": "ok", "note": ""}), 409, "invalid_transition", transition("loan", "overdue"))
        assert_error(sol.post(f"{url}/return"), 403, "forbidden")
        assert_error(volunteer.post(f"{url}/return", {"returned_at": "2026-03-05T14:00:00Z"}), 422, "validation", fields={"returned_at": FIELD["returned_at"]})
        assert_error(volunteer.post(f"{url}/return", {"returned_at": "2099-03-05T14:00:00Z"}), 422, "validation", fields={"returned_at": FIELD["returned_at"]})
        assert_error(place_hold(sol, "hedge-trimmer", "2099-01-06", "2099-01-06"), 422, "validation")
        back = check_in(volunteer, loan["id"], "2026-03-06T20:00:00Z")
        assert (back["status"], back["on_time"], back["late_days"]) == ("returned", True, 0)
        assert_error(volunteer.post(f"{url}/return"), 409, "invalid_transition", transition("loan", "returned"))
        assert_error(volunteer.post(f"{url}/inspection", {"outcome": "broken", "note": ""}), 422, "validation", fields={"outcome": FIELD["outcome"]})
        assert_error(volunteer.post(f"{url}/inspection", {"outcome": "damaged", "note": ""}), 422, "validation", fields={"note": FIELD["note_damaged"]})
        assert_error(volunteer.post(f"{url}/inspection", {"outcome": "ok", "note": "n" * (NOTE_MAX + 1)}), 422, "validation", fields={"note": FIELD["note_ok"]})
        assert_error(volunteer.post(f"{url}/inspection", {"outcome": "damaged", "note": "n" * (NOTE_MAX + 1)}), 422, "validation", fields={"note": FIELD["note_damaged"]})
        done = inspect_loan(volunteer, loan["id"], "damaged", "n" * NOTE_MAX)
        assert done["status"] == "inspected"
        assert set(done["inspection"]) == {"outcome", "note", "inspected_at"}
        assert (done["inspection"]["outcome"], done["inspection"]["note"]) == ("damaged", "n" * NOTE_MAX)
        assert_error(volunteer.post(f"{url}/inspection", {"outcome": "ok", "note": ""}), 409, "invalid_transition", transition("loan", "inspected"))
    finally:
        clear_member(staff, "mem-sol")


def test_one_check_in_race(app_url: str, staff: Api) -> None:
    prepare(staff, ["mem-sol"], ["hedge-trimmer"])
    loan = make_loan(staff, "mem-sol", "hedge-trimmer-1", SPRING_DUE, SPRING_CHECKOUT)
    url = f"/api/loans/{loan['id']}"
    clients = [Api(app_url, p) for p in ("usr-dev", "usr-ines", "usr-rosa", "usr-dev")]
    times = [f"2026-03-06T1{i}:00:00Z" for i in range(4)]
    results = race([lambda c=c, t=t: c.post(f"{url}/return", {"returned_at": t}) for c, t in zip(clients, times)])
    winners = [i for i, r in enumerate(results) if r.status_code == 200]
    assert len(winners) == 1, [r.text for r in results]
    for i, r in enumerate(results):
        if i not in winners:
            assert_error(r, 409, "invalid_transition", transition("loan", "returned"))
    assert same_instant(staff.ok(url)["loan"]["returned_at"], times[winners[0]])
    notes = [f"race note {i}" for i in range(4)]
    results = race([lambda c=c, n=n: c.post(f"{url}/inspection", {"outcome": "damaged", "note": n}) for c, n in zip(clients, notes)])
    winners = [i for i, r in enumerate(results) if r.status_code == 200]
    assert len(winners) == 1, [r.text for r in results]
    for i, r in enumerate(results):
        if i not in winners:
            assert_error(r, 409, "invalid_transition", transition("loan", "inspected"))
    assert staff.ok(url)["loan"]["inspection"]["note"] == notes[winners[0]]


def test_wf_check_in_inspection_happy(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-hal"], ["post-hole-digger"])
    loan = make_loan(staff, "mem-hal", "post-hole-digger-1", lib.next_open(), lib.yesterday_at("10:00"))
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-dev")
        page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
        result = page.get_by_role("status", name="Counter result")
        fill(page.get_by_label("Returned at"), f"{(lib.today - timedelta(days=1)).isoformat()}T12:00")
        click(page.get_by_role("button", name="Check in"))
        soon(page, lambda: expect(result).to_have_text("Checked in on time.", timeout=POLL_MS))
        page.get_by_label("Condition photo").set_input_files(file_png())
        click(page.get_by_role("button", name="Add photo"))
        return_photo = page.get_by_role("region", name="Return photos").get_by_role("img", name=photo_name("Return", 1))
        soon(page, lambda: expect(return_photo).to_be_visible(timeout=POLL_MS))
        condition = page.get_by_role("radiogroup", name="Condition")
        soon(page, lambda: expect(condition).to_be_visible(timeout=POLL_MS))
        check(condition.get_by_role("radio", name="Damaged"))
        fill(page.get_by_role("textbox", name="Inspection note"), INSPECTION_NOTE)
        click(page.get_by_role("button", name="Save inspection"))
        soon(page, lambda: expect(result).to_have_text("Inspection saved.", timeout=POLL_MS))
    stored = staff.ok(f"/api/loans/{loan['id']}")["loan"]
    assert (stored["status"], stored["on_time"]) == ("inspected", True)
    assert same_instant(stored["returned_at"], lib.yesterday_at("12:00"))
    assert (stored["inspection"]["outcome"], stored["inspection"]["note"]) == ("damaged", INSPECTION_NOTE)
    assert sum(k.startswith(f"loans/{loan['id']}/return/") for k in S3().keys(f"loans/{loan['id']}/")) == 1


def test_wf_check_in_inspection_late_and_stale(app_url: str, browser: Browser, staff: Api) -> None:
    prepare(staff, ["mem-sol"], ["hedge-trimmer"])
    loan = make_loan(staff, "mem-sol", "hedge-trimmer-2", SPRING_DUE, SPRING_CHECKOUT)
    with open_app(browser, app_url + "/") as dev_page, open_app(browser, app_url + "/") as ines_page:
        ui_sign_in(dev_page, app_url, "usr-dev")
        ui_sign_in(ines_page, app_url, "usr-ines")
        for p in (dev_page, ines_page):
            p.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
            expect(p.get_by_role("button", name="Check in")).to_be_visible(timeout=UI_TIMEOUT_MS)
        fill(dev_page.get_by_label("Returned at"), local_input(SPRING_LATE_RETURN))
        click(dev_page.get_by_role("button", name="Check in"))
        dev_result = dev_page.get_by_role("status", name="Counter result")
        soon(dev_page, lambda: expect(dev_result).to_have_text(late_copy(SPRING_LATE_DAYS), timeout=POLL_MS))
        fill(ines_page.get_by_label("Returned at"), local_input(STALE_RETURN))
        click(ines_page.get_by_role("button", name="Check in"))
        ines_result = ines_page.get_by_role("status", name="Counter result")
        soon(ines_page, lambda: expect(ines_result).to_have_text(transition("loan", "returned"), timeout=POLL_MS))
        condition = ines_page.get_by_role("radiogroup", name="Condition")
        soon(ines_page, lambda: expect(condition).to_be_visible(timeout=POLL_MS))
    stored = staff.ok(f"/api/loans/{loan['id']}")["loan"]
    assert same_instant(stored["returned_at"], SPRING_LATE_RETURN)
    assert (stored["late_days"], stored["on_time"]) == (SPRING_LATE_DAYS, False)


LATE_FEE_CASES = {
    "spring_after_closing": ("hedge-trimmer-1", SPRING_CHECKOUT, SPRING_DUE, SPRING_LATE_RETURN, 3, 150),
    "spring_before_closing": ("hedge-trimmer-1", SPRING_CHECKOUT, SPRING_DUE, SPRING_EARLY_RETURN, 2, 100),
    "rate_change": ("hedge-trimmer-1", "2026-08-27T14:00:00Z", "2026-08-29", "2026-09-02T16:00:00Z", 3, 200),
    "replacement_cap": ("stud-finder-1", "2026-09-01T14:00:00Z", "2026-09-01", "", 25, 2499),
}


LATE_FEE_IDS = ["spring_after_closing", "spring_before_closing", "rate_change", "replacement_cap"]


@pytest.mark.parametrize("case", LATE_FEE_IDS, ids=LATE_FEE_IDS)
def test_late_fee_examples(app_url: str, staff: Api, lib: Library, killbill: KillBill, mail: Mailpit, case: str) -> None:
    unit, checked_out, due, returned, late_days, fee = LATE_FEE_CASES[case]
    item_id = unit.rsplit("-", 1)[0]
    name, _, _, _, replacement = ITEMS[item_id]
    if not returned:
        days = lib.opens(date.fromisoformat(due), late_days + 1)
        returned = iso_z(local_at(days[-1], "12:00"))
    mail.clear()
    prepare(staff, ["mem-sol"], [item_id])
    loan = make_loan(staff, "mem-sol", unit, due, checked_out)
    back = check_in(staff, loan["id"], returned)
    assert back["late_days"] == late_days
    inspect_loan(staff, loan["id"])
    r = settle_loan(staff, loan["id"], 0)
    assert r.status_code == 201, r.text
    s = r.json()["settlement"]
    assert (s["late_days"], s["late_fee_cents"], s["total_charged_cents"]) == (late_days, fee, fee)
    assert s["late_fee_cents"] <= replacement
    txs = kb_payment_txs(killbill, f"shedline-{loan['id']}-late-fee")
    assert len(txs) == 1 and txs[0]["transactionType"] == "PURCHASE" and cents(txs[0]["amount"]) == fee
    assert txs[0]["transactionExternalKey"] == f"shedline-{loan['id']}-late-fee"
    assert [(e["kind"], e["amount_cents"]) for e in ledger(staff, loan["id"])] == [("late_fee", fee)]
    unit_label = ITEMS[item_id][2][int(unit.rsplit("-", 1)[1]) - 1]
    receipts = inbox(mail, "mem-sol", f"Settlement receipt: {name}, unit {unit_label}")
    assert len(receipts) == 1
    assert f"Late fee: {money(fee)} ({late_days} late days)" in text(receipts[0])
    assert f"Total charged: {money(fee)}" in text(receipts[0])


def test_closure_dates(app_url: str, staff: Api, lib: Library, mail: Mailpit) -> None:
    s = lib.settings
    assert set(s) == LIBRARY_KEYS
    assert s["closed_dates"] == ["2026-07-04", "2026-11-26", "2026-12-25", "2026-12-26"]
    assert s["open_days"] == ["tue", "wed", "thu", "fri", "sat", "sun"]
    assert (s["time_zone"], s["opening_time"][:5], s["closing_time"][:5], s["max_active_per_member"]) == ("America/New_York", "10:00", "18:00", MAX_ACTIVE)
    assert s["late_fee_schedule"] == [{"effective_from": "2026-01-06", "cents_per_day": 50}, {"effective_from": "2026-09-01", "cents_per_day": 100}]
    mail.clear()
    prepare(staff, ["mem-sol"], ["hedge-trimmer"])
    assert_error(lend(staff, "mem-sol", "hedge-trimmer-1", "2026-07-04", JULY_CHECKOUT), 422, "validation", fields={"due_date": FIELD["due_walk_in"]})
    loan = make_loan(staff, "mem-sol", "hedge-trimmer-1", JULY_DUE, JULY_CHECKOUT)
    assert check_in(staff, loan["id"], JULY_RETURN)["late_days"] == 2
    inspect_loan(staff, loan["id"])
    r = settle_loan(staff, loan["id"], 0)
    assert r.status_code == 201 and r.json()["settlement"]["late_fee_cents"] == 100
    receipt = staff.ok(f"/api/loans/{loan['id']}/receipt")["receipt"]
    assert receipt["late_days"] == 2 and receipt["late_fee_cents"] == 100
    messages = inbox(mail, "mem-sol", "Settlement receipt: Hedge trimmer, unit HT-1")
    assert len(messages) == 1 and "Late fee: $1.00 (2 late days)" in text(messages[0])


def founder_settles(page: Page, base: str, loan_id: str, damage: str) -> None:
    page.goto(f"{base.rstrip('/')}/loans/{loan_id}")
    click(page.get_by_role("button", name="Settle"))
    advance(page, DIALOG_OPEN_MS)
    dialog = page.get_by_role("dialog", name="Settle loan")
    fill(dialog.get_by_role("textbox", name="Damage charge"), damage)
    click(dialog.get_by_role("button", name="Confirm settlement"))


def test_wf_late_fees_rate_change(app_url: str, browser: Browser, staff: Api, killbill: KillBill, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-sol"], ["hedge-trimmer"])
    loan = make_loan(staff, "mem-sol", "hedge-trimmer-2", AUG_DUE, AUG_CHECKOUT)
    check_in(staff, loan["id"], SEP_RETURN)
    inspect_loan(staff, loan["id"])
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-rosa")
        founder_settles(page, app_url, loan["id"], "0.00")
        result = settlement_result(page)
        soon(page, lambda: expect(result).to_have_text(settled_copy("mem-sol"), timeout=POLL_MS))
        receipt = page.get_by_role("region", name="Receipt")
        soon(page, lambda: expect(receipt).to_contain_text("Late fee: $2.00 (3 late days)", timeout=POLL_MS))
        expect(receipt).to_contain_text(f"Total charged: {money(RATE_CHANGE_FEE)}")
    assert cents(kb_payment_txs(killbill, f"shedline-{loan['id']}-late-fee")[0]["amount"]) == RATE_CHANGE_FEE
    messages = inbox(mail, "mem-sol", f"Settlement receipt: {record_name('hedge-trimmer', 1)}")
    assert len(messages) == 1 and "Late fee: $2.00 (3 late days)" in text(messages[0])


def test_wf_late_fees_spring_clock_change(app_url: str, browser: Browser, staff: Api, killbill: KillBill) -> None:
    prepare(staff, ["mem-sol"], ["hedge-trimmer"])
    loan = make_loan(staff, "mem-sol", "hedge-trimmer-1", SPRING_DUE, SPRING_CHECKOUT)
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-dev")
        page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
        fill(page.get_by_label("Returned at"), local_input(SPRING_LATE_RETURN))
        click(page.get_by_role("button", name="Check in"))
        late_result = page.get_by_role("status", name="Counter result")
        soon(page, lambda: expect(late_result).to_have_text(late_copy(SPRING_LATE_DAYS), timeout=POLL_MS))
    inspect_loan(staff, loan["id"])
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-rosa")
        founder_settles(page, app_url, loan["id"], "0.00")
        receipt = page.get_by_role("region", name="Receipt")
        soon(page, lambda: expect(receipt).to_contain_text(f"Late fee: {money(SPRING_FEE)} ({SPRING_LATE_DAYS} late days)", timeout=POLL_MS))
    assert cents(kb_payment_txs(killbill, f"shedline-{loan['id']}-late-fee")[0]["amount"]) == SPRING_FEE


SPLIT_CASES = {
    "inspected_ok": ("ok", 0),
    "within_deposit": ("damaged", 3000),
    "whole_deposit": ("damaged", 7500),
}


@pytest.mark.parametrize("case", list(SPLIT_CASES), ids=list(SPLIT_CASES))
def test_settlement_split(app_url: str, staff: Api, lib: Library, case: str) -> None:
    outcome, damage = SPLIT_CASES[case]
    prepare(staff, ["mem-wren"], ["floor-sander"])
    deposit, replacement = ITEMS["floor-sander"][3], ITEMS["floor-sander"][4]
    loan = make_loan(staff, "mem-wren", "floor-sander-1", lib.next_open(), lib.yesterday_at("10:00"))
    check_in(staff, loan["id"], lib.yesterday_at("12:00"))
    assert_error(settle_loan(staff, loan["id"], 100), 409, "invalid_transition", transition("loan", "returned"))
    inspect_loan(staff, loan["id"], outcome, "Drum scored" if outcome == "damaged" else "")
    assert_error(settle_loan(staff, loan["id"], replacement + 1), 422, "validation", fields={"damage_cents": FIELD["damage_ok"] if outcome == "ok" else FIELD["damage"]})
    if outcome == "ok":
        assert_error(settle_loan(staff, loan["id"], 1), 422, "validation", fields={"damage_cents": FIELD["damage_ok"]})
    else:
        assert_error(settle_loan(staff, loan["id"], 12.5), 422, "validation", fields={"damage_cents": FIELD["damage"]})
    r = settle_loan(staff, loan["id"], damage)
    assert r.status_code == 201, r.text
    assert set(r.json()) == {"settlement", "loan"}
    s = r.json()["settlement"]
    assert set(s) == SETTLEMENT_KEYS
    kept = min(damage, deposit)
    assert (s["deposit_cents"], s["damage_cents"], s["damage_from_deposit_cents"], s["released_cents"], s["extra_damage_cents"]) == (deposit, damage, kept, deposit - kept, 0)
    assert s["released_cents"] + s["damage_from_deposit_cents"] == s["deposit_cents"]
    assert s["total_charged_cents"] == s["damage_cents"] + s["late_fee_cents"] and s["late_fee_cents"] == 0
    assert r.json()["loan"]["status"] == "settled" and r.json()["loan"]["settlement"] == s


def test_damage_beyond_deposit(app_url: str, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-wren"], ["floor-sander"])
    loan = inspected_loan(staff, lib, "mem-wren", "floor-sander-2", "damaged", "Drum ruined")
    r = settle_loan(staff, loan["id"], SANDER_DAMAGE)
    assert r.status_code == 201, r.text
    s = r.json()["settlement"]
    assert (s["released_cents"], s["damage_from_deposit_cents"], s["extra_damage_cents"], s["total_charged_cents"]) == (0, SANDER_KEPT, SANDER_EXTRA, SANDER_DAMAGE)
    deposit_txs = kb_payment_txs(killbill, f"shedline-{loan['id']}-deposit")
    assert [cents(t["amount"]) for t in of_type(deposit_txs, "PURCHASE")] == [SANDER_KEPT] and of_type(deposit_txs, "REFUND") == []
    extra = kb_payment_txs(killbill, f"shedline-{loan['id']}-extra-damage")
    assert len(extra) == 1 and extra[0]["transactionType"] == "PURCHASE" and cents(extra[0]["amount"]) == SANDER_EXTRA
    assert extra[0]["transactionExternalKey"] == f"shedline-{loan['id']}-extra-damage"
    entries = sorted((e["kind"], e["amount_cents"]) for e in ledger(staff, loan["id"]))
    assert entries == sorted([("deposit_hold", SANDER_KEPT), ("damage_charge", -SANDER_KEPT), ("extra_damage", SANDER_EXTRA)])


def test_settlement_billing_once(app_url: str, staff: Api, killbill: KillBill) -> None:
    prepare(staff, ["mem-hal"], ["tile-saw"])
    loan = make_loan(staff, "mem-hal", "tile-saw-1", SPRING_DUE, SPRING_CHECKOUT)
    check_in(staff, loan["id"], SPRING_LATE_RETURN)
    inspect_loan(staff, loan["id"], "damaged", "Cracked tray")
    key = idempotency_key()
    damage = 3000
    r = settle_loan(staff, loan["id"], damage, key)
    assert r.status_code == 201, r.text
    s = r.json()["settlement"]
    assert (s["released_cents"], s["late_fee_cents"]) == (5000 - damage, 150)
    deposit_txs = kb_payment_txs(killbill, f"shedline-{loan['id']}-deposit")
    purchases, refunds = of_type(deposit_txs, "PURCHASE"), of_type(deposit_txs, "REFUND")
    assert len(purchases) == 1 and len(refunds) == 1
    assert refunds[0]["transactionExternalKey"] == f"shedline-{loan['id']}-deposit-release"
    assert cents(refunds[0]["amount"]) == s["released_cents"]
    assert cents(purchases[0]["amount"]) - cents(refunds[0]["amount"]) == s["damage_from_deposit_cents"]
    late = kb_payment_txs(killbill, f"shedline-{loan['id']}-late-fee")
    assert len(late) == 1 and cents(late[0]["amount"]) == 150
    assert killbill.payment_by_key(f"shedline-{loan['id']}-extra-damage") is None
    count = len(kb_transactions(killbill, "mem-hal"))
    replay = settle_loan(staff, loan["id"], damage, key)
    assert replay.status_code == 201 and replay.json() == r.json()
    assert_error(settle_loan(staff, loan["id"], damage), 409, "invalid_transition", transition("loan", "settled"))
    all_txs = kb_transactions(killbill, "mem-hal")
    assert len(all_txs) == count
    keys = [t.get("transactionExternalKey") for t in all_txs if t.get("transactionExternalKey")]
    assert len(keys) == len(set(keys))


def test_settlement_receipt_email(app_url: str, staff: Api, lib: Library, killbill: KillBill, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-juno"], ["pressure-washer"])
    loan = inspected_loan(staff, lib, "mem-juno", "pressure-washer-1", "damaged", "Hose split")
    juno = Api(app_url, "mem-juno")
    assert_error(juno.get(f"/api/loans/{loan['id']}/receipt"), 409, "not_settled")
    r = settle_loan(staff, loan["id"], 1000)
    assert r.status_code == 201, r.text
    s = r.json()["settlement"]
    receipt = juno.ok(f"/api/loans/{loan['id']}/receipt")["receipt"]
    assert {k: receipt[k] for k in SETTLEMENT_KEYS} == s
    assert receipt["item"] == {"id": "pressure-washer", "name": "Electric pressure washer"} and receipt["unit"]["label"] == "PW-1"
    assert receipt["member"] == {"id": "mem-juno", "name": "Juno Achterberg"}
    refunds = of_type(kb_payment_txs(killbill, f"shedline-{loan['id']}-deposit"), "REFUND")
    assert [cents(t["amount"]) for t in refunds] == [s["released_cents"]]
    messages = inbox(mail, "mem-juno", "Settlement receipt: Electric pressure washer, unit PW-1")
    assert len(messages) == 1 and from_desk(messages[0])
    assert_lines_in_order(text(messages[0]), receipt_lines(s))


def test_deposit_ledger(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-tobi"], ["carpet-cleaner"])
    assert_error(Api(app_url, "usr-dev").get("/api/ledger"), 403, "forbidden")
    held_before = staff.ok("/api/ledger")["deposits_held_cents"]
    assert held_before == unsettled_deposits(staff)
    loan = make_loan(staff, "mem-tobi", "carpet-cleaner-2", lib.next_open(), lib.yesterday_at("10:00"))
    body = staff.ok("/api/ledger")
    assert body["deposits_held_cents"] == held_before + 6000 == unsettled_deposits(staff)
    created = [instant(e["created_at"]) for e in body["entries"]]
    assert created == sorted(created)
    check_in(staff, loan["id"], lib.yesterday_at("12:00"))
    inspect_loan(staff, loan["id"], "damaged", "Brush torn")
    assert settle_loan(staff, loan["id"], 1000).status_code == 201
    entries = ledger(staff, loan["id"])
    assert all(set(e) == LEDGER_KEYS and e["loan_id"] == loan["id"] for e in entries)
    assert sorted((e["kind"], e["amount_cents"]) for e in entries) == sorted([("deposit_hold", 6000), ("deposit_release", -5000), ("damage_charge", -1000)])
    assert sum(e["amount_cents"] for e in entries if e["kind"] in ("deposit_hold", "deposit_release", "damage_charge")) == 0
    assert staff.ok("/api/ledger")["deposits_held_cents"] == held_before == unsettled_deposits(staff)


def test_settlements_one_at_a_time(app_url: str, staff: Api, lib: Library, killbill: KillBill, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-hal"], ["laser-level"])
    loan = inspected_loan(staff, lib, "mem-hal", "laser-level-1", "damaged", "Lens chipped")
    founders = [Api(app_url, "usr-rosa") for _ in range(4)]
    results = race([lambda f=f: settle_loan(f, loan["id"], 500) for f in founders])
    assert sum(r.status_code == 201 for r in results) == 1, [r.text for r in results]
    for r in results:
        if r.status_code != 201:
            assert_error(r, 409, "invalid_transition", transition("loan", "settled"))
    assert len(of_type(kb_payment_txs(killbill, f"shedline-{loan['id']}-deposit"), "REFUND")) == 1
    kinds = sorted(e["kind"] for e in ledger(staff, loan["id"]))
    assert kinds == ["damage_charge", "deposit_hold", "deposit_release"]
    assert len(inbox(mail, "mem-hal", "Settlement receipt: Self-levelling laser, unit LL-1", count=2, seconds=BACKGROUND_DELAY_S + MAIL_SLACK_S)) == 1


def test_wf_settlement_dispute(app_url: str, browser: Browser, staff: Api, lib: Library, killbill: KillBill, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-hal"], ["tile-saw"])
    loan = make_loan(staff, "mem-hal", "tile-saw-1", lib.next_open(), lib.yesterday_at("10:00"))
    assert staff.upload(loan["id"], png_bytes()).status_code == 201
    check_in(staff, loan["id"], lib.yesterday_at("12:00"))
    assert staff.upload(loan["id"], png_bytes()).status_code == 201
    inspect_loan(staff, loan["id"], "damaged", "Chipped blade guard")
    damage = 3000
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        ui_sign_in(page, app_url, "usr-rosa")
        page.goto(f"{app_url.rstrip('/')}/loans/{loan['id']}")
        expect(page.get_by_role("heading", name=record_name("tile-saw", 0))).to_be_visible(timeout=UI_TIMEOUT_MS)
        before = page.get_by_role("region", name="Checkout photos")
        after = page.get_by_role("region", name="Return photos")
        expect(before.get_by_role("img", name=photo_name("Checkout", 1))).to_be_visible()
        expect(after.get_by_role("img", name=photo_name("Return", 1))).to_be_visible()
        b, a = before.bounding_box(), after.bounding_box()
        assert b["x"] + b["width"] <= a["x"] + 1 and abs(b["y"] - a["y"]) < b["height"] / 2
        click(page.get_by_role("button", name="Settle"))
        advance(page, DIALOG_OPEN_MS)
        dialog = page.get_by_role("dialog", name="Settle loan")
        expect(dialog).to_contain_text(f"Deposit held {money(ITEMS['tile-saw'][3])}")
        expect(dialog).to_contain_text(f"Replacement {money(ITEMS['tile-saw'][4])}")
        fill(dialog.get_by_role("textbox", name="Damage charge"), dollars(damage))
        click(dialog.get_by_role("button", name="Confirm settlement"))
        result = settlement_result(page)
        soon(page, lambda: expect(result).to_have_text(settled_copy("mem-hal"), timeout=POLL_MS))
        soon(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS))
        receipt = page.get_by_role("region", name="Receipt")
        soon(page, lambda: expect(receipt).to_be_focused(timeout=POLL_MS))
        s = staff.ok(f"/api/loans/{loan['id']}")["loan"]["settlement"]
        assert s["damage_cents"] == damage
        for line in receipt_lines(s):
            expect(receipt).to_contain_text(line)
    refunds = of_type(kb_payment_txs(killbill, f"shedline-{loan['id']}-deposit"), "REFUND")
    assert [cents(t["amount"]) for t in refunds] == [ITEMS["tile-saw"][3] - damage]
    messages = inbox(mail, "mem-hal", f"Settlement receipt: {record_name('tile-saw', 0)}")
    assert len(messages) == 1
    assert_lines_in_order(text(messages[0]), receipt_lines(s))


def test_wf_settlement_invalid_then_fixed(app_url: str, browser: Browser, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-wren"], ["floor-sander"])
    loan = inspected_loan(staff, lib, "mem-wren", "floor-sander-1", "damaged", "Drum ruined")
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-rosa")
        founder_settles(page, app_url, loan["id"], "999.00")
        dialog = page.get_by_role("dialog", name="Settle loan")
        result = settlement_result(page)
        soon(page, lambda: expect(result).to_have_text(COPY["validation"], timeout=POLL_MS))
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text(FIELD["damage"])
        assert staff.ok(f"/api/loans/{loan['id']}")["loan"]["status"] == "inspected"
        fill(dialog.get_by_role("textbox", name="Damage charge"), dollars(SANDER_DAMAGE))
        click(dialog.get_by_role("button", name="Confirm settlement"))
        receipt = page.get_by_role("region", name="Receipt")
        soon(page, lambda: expect(receipt).to_contain_text(f"Charged beyond deposit: {money(SANDER_EXTRA)}", timeout=POLL_MS))
    assert cents(kb_payment_txs(killbill, f"shedline-{loan['id']}-extra-damage")[0]["amount"]) == SANDER_EXTRA


def test_wf_settlement_ledger_screen(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-tobi"], ["carpet-cleaner"])
    loan = inspected_loan(staff, lib, "mem-tobi", "carpet-cleaner-1", "damaged", "Brush torn")
    assert settle_loan(staff, loan["id"], 1000).status_code == 201
    held_now = staff.ok("/api/ledger")["deposits_held_cents"]
    with open_app(browser, app_url + "/") as page:
        ui_sign_in(page, app_url, "usr-rosa")
        page.goto(app_url.rstrip("/") + "/ledger")
        expect(page.get_by_role("heading", name="Deposit ledger")).to_be_visible(timeout=UI_TIMEOUT_MS)
        expect(page.get_by_text(f"Deposits held now: {money(held_now)}")).to_be_visible()
        table = page.get_by_role("table", name="Deposit ledger")
        for column in ("Loan", "Item", "Kind", "Amount", "Recorded"):
            expect(table.get_by_role("columnheader", name=column)).to_be_visible()
        for kind in ("Deposit hold", "Deposit release", "Damage charge"):
            expect(table.get_by_role("row").filter(has_text="Carpet cleaner").filter(has_text=kind)).not_to_have_count(0)


def test_own_records_only(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-hal", "mem-mina"], ["hedge-trimmer", "drill-driver"])
    hal, mina = Api(app_url, "mem-hal"), Api(app_url, "mem-mina")
    try:
        hold = make_hold(hal, "drill-driver", *lib.span(4, 1))
        out = make_loan(staff, "mem-hal", "drill-driver-2", lib.next_open())
        past = make_loan(staff, "mem-hal", "hedge-trimmer-1", lib.next_open(), lib.yesterday_at("10:00"))
        photo = staff.upload(past["id"], png_bytes()).json()["photo"]
        check_in(staff, past["id"], lib.yesterday_at("12:00"))
        inspect_loan(staff, past["id"])
        assert settle_loan(staff, past["id"], 0).status_code == 201
        missing = str(uuid.uuid4())
        pairs = [
            (mina.get(f"/api/holds/{hold['id']}"), mina.get(f"/api/holds/{missing}")),
            (mina.get(f"/api/loans/{past['id']}"), mina.get(f"/api/loans/{missing}")),
            (mina.get(photo["url"]), mina.get(f"/api/loans/{missing}/photos/{missing}")),
            (mina.get(f"/api/loans/{past['id']}/receipt"), mina.get(f"/api/loans/{missing}/receipt")),
            (mina.post(f"/api/holds/{hold['id']}/cancel"), mina.post(f"/api/holds/{missing}/cancel")),
            (mina.post(f"/api/loans/{out['id']}/renewal", {"due_date": lib.open_after(out["due_date"]).isoformat()}, key=idempotency_key()),
             mina.post(f"/api/loans/{missing}/renewal", {"due_date": lib.open_after(out["due_date"]).isoformat()}, key=idempotency_key())),
        ]
        for theirs, nothing in pairs:
            assert_error(theirs, 404, "not_found")
            assert theirs.json() == nothing.json()
        assert staff.ok(f"/api/holds/{hold['id']}")["hold"]["status"] == "requested"
        assert all(h["member"]["id"] == "mem-mina" for h in pages(mina, "/api/holds", "holds"))
        assert all(l["member"]["id"] == "mem-mina" for l in pages(mina, "/api/loans", "loans"))
        mine = hal.get(f"/api/loans/{past['id']}")
        loan = mine.json()["loan"]
        assert set(loan) == LOAN_KEYS and set(loan["member"]) == {"id", "name"} and set(loan["unit"]) == UNIT_KEYS
        assert all(set(p) == PHOTO_KEYS for p in loan["photos"])
        assert set(hal.ok(f"/api/holds/{hold['id']}")["hold"]) == HOLD_KEYS
        for token in ("@members.example", "555-01", "shedline-mem"):
            assert token not in mine.text and token not in hal.get("/api/holds").text
    finally:
        prepare(staff, ["mem-hal", "mem-mina"], [])


def test_paged_history(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-juno"], ["drill-driver", "post-hole-digger"])
    juno = Api(app_url, "mem-juno")
    ensure_history(staff, "mem-juno", PAGE_DEFAULT + 1)
    first = juno.ok("/api/loans")
    assert len(first["loans"]) == PAGE_DEFAULT and first["next_cursor"]
    assert len(juno.ok("/api/loans", limit=PAGE_MAX)["loans"]) <= PAGE_MAX
    for bad in (0, PAGE_MAX + 1, "many"):
        assert_error(juno.get("/api/loans", limit=bad), 422, "validation", fields={"limit": FIELD["limit"]})
    assert_error(juno.get("/api/loans", cursor="not-a-cursor"), 422, "validation", fields={"cursor": FIELD["cursor"]})
    cursor = first["next_cursor"]
    tampered = ("Q" if cursor[0] in "Zz" else "Z") + cursor[1:]
    assert tampered != cursor
    assert_error(juno.get("/api/loans", cursor=tampered), 422, "validation", fields={"cursor": FIELD["cursor"]})

    seen: list[dict[str, Any]] = []
    body = juno.ok("/api/loans", limit=3)
    seen += body["loans"]
    fresh = make_loan(staff, "mem-juno", "post-hole-digger-1", lib.next_open())
    older = make_loan(staff, "mem-juno", "drill-driver-4", "2026-02-04", "2026-02-03T15:30:30Z")
    check_in(staff, older["id"], "2026-02-04T20:00:00Z")
    cursor = body["next_cursor"]
    while cursor:
        body = juno.ok("/api/loans", limit=3, cursor=cursor)
        seen += body["loans"]
        cursor = body["next_cursor"]
    ids = [l["id"] for l in seen]
    added = {fresh["id"], older["id"]}
    existing = {l["id"] for l in pages(juno, "/api/loans", "loans")} - added
    assert all(ids.count(i) == 1 for i in existing)
    assert all(ids.count(i) <= 1 for i in added)
    assert all(l["member"]["id"] == "mem-juno" for l in seen)
    times = [instant(l["checked_out_at"]) for l in seen if l["id"] not in added]
    assert times == sorted(times, reverse=True)
    staff_page = staff.ok("/api/loans", limit=2)
    assert all(l["member"]["id"] == "mem-juno" for l in juno.ok("/api/loans", cursor=staff_page["next_cursor"], limit=PAGE_MAX)["loans"])

    for day in lib.opens(lib.today + timedelta(days=2), 3):
        h = make_hold(juno, "drill-driver", day, day)
        juno.post(f"/api/holds/{h['id']}/cancel")
    seen_holds: list[str] = []
    body = juno.ok("/api/holds", limit=2)
    seen_holds += [h["id"] for h in body["holds"]]
    new_hold = make_hold(juno, "drill-driver", *lib.span(6, 0))
    cursor = body["next_cursor"]
    while cursor:
        body = juno.ok("/api/holds", limit=2, cursor=cursor)
        seen_holds += [h["id"] for h in body["holds"]]
        cursor = body["next_cursor"]
    existing_holds = {h["id"] for h in pages(juno, "/api/holds", "holds")} - {new_hold["id"]}
    assert all(seen_holds.count(i) == 1 for i in existing_holds)
    assert seen_holds.count(new_hold["id"]) <= 1
    clear_member(staff, "mem-juno")


def test_wf_member_records_history(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-juno", "mem-hal"], ["drill-driver", "hedge-trimmer"])
    ensure_history(staff, "mem-juno", PAGE_DEFAULT + 1)
    past = make_loan(staff, "mem-juno", "hedge-trimmer-1", lib.next_open(), lib.yesterday_at("10:00"))
    assert staff.upload(past["id"], png_bytes()).status_code == 201
    check_in(staff, past["id"], lib.yesterday_at("12:00"))
    inspect_loan(staff, past["id"])
    settlement = settle_loan(staff, past["id"], 0).json()["settlement"]
    hal_loan = make_loan(staff, "mem-hal", "drill-driver-2", lib.next_open())
    expected = {l["id"] for l in pages(Api(app_url, "mem-juno"), "/api/loans", "loans")}
    added = None
    try:
        with open_app(browser, app_url + "/") as page:
            ui_sign_in(page, app_url, "mem-juno")
            page.goto(app_url.rstrip("/") + "/my-loans")
            region = page.get_by_role("region", name="Loans")
            links = region.get_by_role("link", name=re.compile(r", unit "))
            expect(links).to_have_count(PAGE_DEFAULT, timeout=UI_TIMEOUT_MS)
            more = region.get_by_role("button", name="Show more loans")
            loans_status = page.get_by_role("status", name="My loans status")
            while more.count() > 0:
                before = links.count()
                click(more)
                expect(links).not_to_have_count(before, timeout=UI_TIMEOUT_MS)
                after = links.count()
                soon(page, lambda: expect(links.nth(before)).to_be_focused(timeout=POLL_MS))
                soon(page, lambda: expect(loans_status).to_have_text(f"Showing {after} loans.", timeout=POLL_MS))
                if added is None:
                    added = make_loan(staff, "mem-juno", "drill-driver-3", lib.next_open())
            ids = [(links.nth(i).get_attribute("href") or "").rstrip("/").rsplit("/", 1)[-1] for i in range(links.count())]
            assert len(ids) == len(set(ids))
            assert expected <= set(ids) and hal_loan["id"] not in ids
            click(links.nth(ids.index(past["id"])))
            expect(page.get_by_role("heading", name=record_name("hedge-trimmer", 0))).to_be_visible(timeout=UI_TIMEOUT_MS)
            expect(page.get_by_role("region", name="Checkout photos").get_by_role("img", name=photo_name("Checkout", 1))).to_be_visible()
            for line in receipt_lines(settlement):
                expect(page.get_by_role("region", name="Receipt")).to_contain_text(line)
            page.goto(f"{app_url.rstrip('/')}/loans/{hal_loan['id']}")
            expect(page.get_by_role("heading", name="Not found")).to_be_visible(timeout=UI_TIMEOUT_MS)
            foreign = page.evaluate("() => document.body.innerText")
            page.goto(f"{app_url.rstrip('/')}/loans/{uuid.uuid4()}")
            expect(page.get_by_role("heading", name="Not found")).to_be_visible(timeout=UI_TIMEOUT_MS)
            assert page.evaluate("() => document.body.innerText") == foreign
    finally:
        prepare(staff, ["mem-juno", "mem-hal"], [])


def test_wf_member_records_honest_cancel(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-hal"], ["hedge-trimmer", "drill-driver"])
    hal = Api(app_url, "mem-hal")
    ready = make_hold(hal, "hedge-trimmer", *lib.span(1, 1))
    make_ready(staff, ready["id"])
    spare = make_hold(hal, "drill-driver", *lib.span(3, 1))
    loan_id = None
    try:
        with open_app(browser, app_url + "/") as page:
            ui_sign_in(page, app_url, "mem-hal")
            page.goto(app_url.rstrip("/") + "/my-loans")
            holds = page.get_by_role("region", name="Holds")
            saws = holds.get_by_role("listitem", name=re.compile("^" + re.escape(record_name("hedge-trimmer", 0))))
            row = saws.filter(has_text="Pick up by")
            expect(row).to_have_count(1, timeout=UI_TIMEOUT_MS)
            cancelled_before = saws.filter(has_text="Cancelled").count()
            collected_before = saws.filter(has_text="Collected").count()
            co = checkout(staff, ready["id"])
            assert co.status_code == 201, co.text
            loan_id = co.json()["loan"]["id"]
            with held(page, "**/api/holds/*/cancel") as gate:
                click(row.get_by_role("button", name="Cancel hold"))
                expect(row.get_by_role("button", name="Cancelling…")).to_be_visible()
                expect(row).to_contain_text(re.compile("Ready", re.I))
                expect(saws.filter(has_text="Cancelled")).to_have_count(cancelled_before)
                gate.release()
            loans_status = page.get_by_role("status", name="My loans status")
            soon(page, lambda: expect(loans_status).to_have_text(transition("hold", "collected"), timeout=POLL_MS))
            soon(page, lambda: expect(saws.filter(has_text="Collected")).to_have_count(collected_before + 1, timeout=POLL_MS))
            expect(saws.filter(has_text="Cancelled")).to_have_count(cancelled_before)
            drills = holds.get_by_role("listitem", name=re.compile("^" + re.escape(f"{ITEMS['drill-driver'][0]}, unit ")))
            spare_row = drills.filter(has=page.get_by_role("button", name="Cancel hold"))
            expect(spare_row).to_have_count(1)
            drills_cancelled = drills.filter(has_text="Cancelled").count()
            click(spare_row.get_by_role("button", name="Cancel hold"))
            soon(page, lambda: expect(loans_status).to_have_text("Hold cancelled.", timeout=POLL_MS))
            soon(page, lambda: expect(drills.filter(has_text="Cancelled")).to_have_count(drills_cancelled + 1, timeout=POLL_MS))
        assert staff.ok(f"/api/holds/{ready['id']}")["hold"]["status"] == "collected"
        assert staff.ok(f"/api/holds/{spare['id']}")["hold"]["status"] == "cancelled"
    finally:
        clear_member(staff, "mem-hal")


def test_lending_while_billing_down(app_url: str, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-hal", "mem-wren"], ["tile-saw", "hedge-trimmer"])
    volunteer = Api(app_url, "usr-dev")
    down = volunteer.on(killbill_down())
    try:
        wait_status(down, "billing", "down")
        walk = lend(down, "mem-wren", "hedge-trimmer-1", lib.next_open())
        assert walk.status_code == 201 and walk.json()["loan"]["deposit_cents"] == 0, walk.text
        hold = make_hold(Api(app_url, "mem-hal"), "tile-saw", *lib.span(4, 1))
        ready = make_ready(staff, hold["id"])
        txs_before = len(kb_transactions(killbill, "mem-hal"))
        held_before = staff.ok("/api/ledger")["deposits_held_cents"]
        r = checkout(down, hold["id"])
        assert_error(r, 503, "billing_unavailable", BILLING_LEND)
        after = staff.ok(f"/api/holds/{hold['id']}")["hold"]
        assert (after["status"], after["pickup_deadline"]) == ("ready", ready["pickup_deadline"])
        assert loans_for_hold(staff, hold["id"]) == []
        assert_error(lend(down, "mem-hal", "tile-saw-2", lib.next_open()), 503, "billing_unavailable", BILLING_LEND)
        assert staff.ok("/api/ledger")["deposits_held_cents"] == held_before
        assert len(kb_transactions(killbill, "mem-hal")) == txs_before
        resumed = checkout(volunteer, hold["id"])
        assert resumed.status_code == 201, resumed.text
    finally:
        prepare(staff, ["mem-hal", "mem-wren"], [])


def test_settling_while_billing_down(app_url: str, staff: Api, lib: Library, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-tobi"], ["tile-saw", "hedge-trimmer"])
    down = staff.on(killbill_down())
    wait_status(down, "billing", "down")
    loan = inspected_loan(staff, lib, "mem-tobi", "tile-saw-2", "damaged", "Cracked tray")
    fixed = 1500
    assert_error(settle_loan(down, loan["id"], fixed), 503, "billing_unavailable", BILLING_SETTLE)
    stored = staff.ok(f"/api/loans/{loan['id']}")["loan"]
    assert stored["status"] == "inspected" and stored["settlement"] is None
    assert [e["kind"] for e in ledger(staff, loan["id"])] == ["deposit_hold"]
    assert inbox(mail, "mem-tobi", "Settlement receipt: 7-inch wet tile saw, unit TS-2") == []
    assert_error(settle_loan(staff, loan["id"], fixed + 1), 409, "settlement_mismatch",
                 f"An earlier attempt fixed this loan's damage charge at {money(fixed)}. Settle again with that amount.")
    ok = settle_loan(staff, loan["id"], fixed)
    assert ok.status_code == 201 and ok.json()["loan"]["status"] == "settled"
    free = inspected_loan(staff, lib, "mem-tobi", "hedge-trimmer-2")
    done = settle_loan(down, free["id"], 0)
    assert done.status_code == 201 and done.json()["loan"]["status"] == "settled", done.text


def test_retry_through_outage(app_url: str, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-mina"], ["tile-saw", "carpet-cleaner"])
    volunteer = Api(app_url, "usr-dev")
    down_volunteer, down_founder = volunteer.on(killbill_down()), staff.on(killbill_down())
    wait_status(down_volunteer, "billing", "down")
    try:
        hold = make_hold(Api(app_url, "mem-mina"), "tile-saw", *lib.span(3, 1))
        make_ready(staff, hold["id"])
        key = idempotency_key()
        refused = [checkout(down_volunteer, hold["id"], key) for _ in range(3)]
        for r in refused:
            assert_error(r, 503, "billing_unavailable", BILLING_LEND)
        ok = checkout(volunteer, hold["id"], key)
        assert ok.status_code == 201, ok.text
        assert checkout(volunteer, hold["id"], key).json() == ok.json()
        assert len(of_type(kb_payment_txs(killbill, f"shedline-{ok.json()['loan']['id']}-deposit"), "PURCHASE")) == 1
        loan = inspected_loan(staff, lib, "mem-mina", "carpet-cleaner-1", "damaged", "Brush torn")
        settle_key = idempotency_key()
        for _ in range(3):
            assert_error(settle_loan(down_founder, loan["id"], 1000, settle_key), 503, "billing_unavailable", BILLING_SETTLE)
        settled = settle_loan(staff, loan["id"], 1000, settle_key)
        assert settled.status_code == 201, settled.text
        assert settle_loan(staff, loan["id"], 1000, settle_key).json() == settled.json()
        assert len(of_type(kb_payment_txs(killbill, f"shedline-{loan['id']}-deposit"), "REFUND")) == 1
        assert sorted(e["kind"] for e in ledger(staff, loan["id"])) == ["damage_charge", "deposit_hold", "deposit_release"]
    finally:
        prepare(staff, ["mem-mina"], [])


def test_opaque_outage_answers(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-juno"], ["tile-saw", "hedge-trimmer"])
    kb_down, s3_down = staff.on(killbill_down()), staff.on(minio_down())
    start, end = lib.span(7, 1)

    def snapshot() -> tuple[Any, ...]:
        lanes = staff.ok("/api/items/tile-saw/lanes", start=start, end=end)
        return (lanes["units_free"], [l["spans"] for l in lanes["lanes"]],
                staff.ok("/api/items/tile-saw")["item"]["units_free_today"], staff.ok("/api/ledger")["deposits_held_cents"])

    answers: list[httpx.Response] = []
    try:
        before = snapshot()
        walk = lend(kb_down, "mem-juno", "tile-saw-1", lib.next_open())
        assert_error(walk, 503, "billing_unavailable", BILLING_LEND)
        answers.append(walk)
        assert snapshot() == before
        hold = make_hold(Api(app_url, "mem-juno"), "tile-saw", start, end)
        assert hold["unit"]["lane_index"] == 0
        make_ready(staff, hold["id"])
        before = snapshot()
        refused = checkout(kb_down, hold["id"])
        assert_error(refused, 503, "billing_unavailable", BILLING_LEND)
        answers.append(refused)
        assert snapshot() == before
        loan = make_loan(staff, "mem-juno", "hedge-trimmer-1", lib.next_open())
        upload = s3_down.upload(loan["id"], png_bytes())
        assert_error(upload, 503, "photo_storage_unavailable")
        answers.append(upload)
        for r in answers:
            assert leaks(r) == [], (r.text, leaks(r))
    finally:
        prepare(staff, ["mem-juno"], [])


def test_wf_billing_outage_counter(app_url: str, browser: Browser, staff: Api, lib: Library, killbill: KillBill) -> None:
    prepare(staff, ["mem-hal", "mem-wren"], ["tile-saw", "hedge-trimmer"])
    clear_all_holds(staff)
    blocked = make_hold(Api(app_url, "mem-hal"), "tile-saw", *lib.span(3, 1))
    blocked_ready = make_ready(staff, blocked["id"])
    start, end = lib.span(3, 1)
    free = make_hold(Api(app_url, "mem-wren"), "hedge-trimmer", start, end)
    make_ready(staff, free["id"])
    txs_before = len(kb_transactions(killbill, "mem-hal"))
    base = killbill_down()
    try:
        with open_app(browser, base + "/") as page:
            ui_sign_in(page, base, "usr-dev")
            banner = page.get_by_role("status", name="Counter services")
            soon(page, lambda: expect(banner).to_contain_text("Billing offline — deposit items are blocked. Items without a deposit still lend.", timeout=POLL_MS), PROBE_AGE_S + PROBE_SLACK_S, BANNER_TICK_MS)
            banner_text = banner.text_content() or ""
            assert not [t for t in LEAK_TOKENS if t in banner_text]
            ready_region = page.get_by_role("region", name="Ready for pickup")
            soon(page, lambda: expect(ready_region.get_by_text("Blocked: billing offline")).to_have_count(1, timeout=POLL_MS))
            buttons = ready_region.get_by_role("button", name="Check out")
            expect(buttons).to_have_count(2)
            states = [buttons.nth(i).is_disabled() for i in range(2)]
            assert sorted(states) == [False, True]
            click(buttons.nth(states.index(False)))
            expect(page.get_by_role("status", name="Counter result")).to_have_text(
                f"Lent to Wren Kowalski. Due {local_time(lib.closing_instant(end))}.", timeout=UI_TIMEOUT_MS)
        assert len(loans_for_hold(staff, free["id"])) == 1
        stored = staff.ok(f"/api/holds/{blocked['id']}")["hold"]
        assert (stored["status"], stored["pickup_deadline"]) == ("ready", blocked_ready["pickup_deadline"])
        assert len(kb_transactions(killbill, "mem-hal")) == txs_before
    finally:
        prepare(staff, ["mem-hal", "mem-wren"], [])


def test_wf_billing_outage_settlement(app_url: str, browser: Browser, staff: Api, lib: Library, mail: Mailpit) -> None:
    mail.clear()
    prepare(staff, ["mem-sol"], ["tile-saw"])
    loan = inspected_loan(staff, lib, "mem-sol", "tile-saw-1", "damaged", "Cracked tray")
    base = killbill_down()
    with open_app(browser, base + "/") as page:
        ui_sign_in(page, base, "usr-rosa")
        founder_settles(page, base, loan["id"], "10.00")
        result = settlement_result(page)
        soon(page, lambda: expect(result).to_have_text(BILLING_SETTLE, timeout=POLL_MS))
        dialog = page.get_by_role("dialog", name="Settle loan")
        expect(dialog).to_be_visible()
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/settlement"), timeout=UI_TIMEOUT_MS) as info:
            click(dialog.get_by_role("button", name="Confirm settlement"))
        assert info.value.status == 503
        soon(page, lambda: expect(result).to_have_text(BILLING_SETTLE, timeout=POLL_MS))
    assert staff.ok(f"/api/loans/{loan['id']}")["loan"]["status"] == "inspected"
    assert [e["kind"] for e in ledger(staff, loan["id"])] == ["deposit_hold"]
    assert inbox(mail, "mem-sol", "Settlement receipt: 7-inch wet tile saw, unit TS-1", seconds=BACKGROUND_DELAY_S) == []
    assert settle_loan(staff, loan["id"], 1000).status_code == 201


def test_borrowing_pause(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-sol"], ["post-hole-digger", "hedge-trimmer", "drill-driver"])
    sol = Api(app_url, "mem-sol")
    due = lib.open_on_or_after(lib.today + timedelta(days=2))
    try:
        out = make_loan(staff, "mem-sol", "post-hole-digger-1", due)
        waiting = make_hold(sol, "drill-driver", *lib.span(5, 1))
        overdue = make_loan(staff, "mem-sol", "hedge-trimmer-1", SPRING_DUE, SPRING_CHECKOUT)
        assert overdue["status"] == "overdue"
        assert_error(place_hold(sol, "drill-driver", *lib.span(6, 1)), 409, "borrowing_paused")
        assert_error(lend(staff, "mem-sol", "post-hole-digger-1", due), 409, "borrowing_paused")
        assert_error(sol.post(f"/api/loans/{out['id']}/renewal", {"due_date": lib.open_after(due).isoformat()}, key=idempotency_key()), 409, "borrowing_paused")
        assert staff.ok(f"/api/loans/{out['id']}")["loan"]["renewed_at"] is None
        make_ready(staff, waiting["id"])
        assert_error(checkout(staff, waiting["id"]), 409, "borrowing_paused")
        assert staff.ok(f"/api/holds/{waiting['id']}")["hold"]["status"] == "ready"
        assert active_count(staff, "mem-sol") == 3
        check_in(staff, overdue["id"], SPRING_LATE_RETURN)
        assert place_hold(sol, "drill-driver", *lib.span(6, 1)).status_code == 201
        assert checkout(staff, waiting["id"]).status_code == 201
    finally:
        clear_member(staff, "mem-sol")


def test_borrowing_limit(app_url: str, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-tobi"], ["drill-driver", "ext-ladder"])
    tobi = Api(app_url, "mem-tobi")
    days = lib.opens(lib.today + timedelta(days=2), 12)
    try:
        holds = [make_hold(tobi, "drill-driver", d, d) for d in days[:3]]
        walk = make_loan(staff, "mem-tobi", "ext-ladder-1", days[0])
        assert_error(place_hold(tobi, "drill-driver", days[3], days[3]), 409, "borrowing_limit")
        assert_error(lend(staff, "mem-tobi", "drill-driver-4", days[0]), 409, "borrowing_limit")
        tobi.post(f"/api/holds/{holds[0]['id']}/cancel")
        assert place_hold(tobi, "drill-driver", days[3], days[3]).status_code == 201
        assert_error(place_hold(tobi, "drill-driver", days[4], days[4]), 409, "borrowing_limit")
        check_in(staff, walk["id"])
        assert place_hold(tobi, "drill-driver", days[4], days[4]).status_code == 201
        for h in holds[1:]:
            tobi.post(f"/api/holds/{h['id']}/cancel")
        assert active_count(staff, "mem-tobi") == 2
        racers = [Api(app_url, "mem-tobi") for _ in range(6)]
        results = race([lambda c=c, d=d: place_hold(c, "drill-driver", d, d) for c, d in zip(racers, days[5:11])])
        assert sum(r.status_code == 201 for r in results) == MAX_ACTIVE - 2, [r.text for r in results]
        for r in results:
            if r.status_code != 201:
                assert_error(r, 409, "borrowing_limit")
        assert active_count(staff, "mem-tobi") == MAX_ACTIVE
    finally:
        clear_member(staff, "mem-tobi")


def test_wf_borrowing_pause_ui(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-sol"], ["laser-level", "drill-driver"])
    overdue = make_loan(staff, "mem-sol", "drill-driver-1", SPRING_DUE, SPRING_CHECKOUT)
    start, end = lib.span(4, 1)
    try:
        with open_app(browser, app_url + "/") as sol_page, open_app(browser, app_url + "/") as dev_page:
            ui_sign_in(sol_page, app_url, "mem-sol")
            sol_page.goto(app_url.rstrip("/") + "/items/laser-level")
            fill(sol_page.get_by_label("Pickup date"), start)
            fill(sol_page.get_by_label("Return date"), end)
            press_hold(sol_page, COPY["borrowing_paused"])
            bars = sol_page.get_by_role("img", name="Claim bar")

            def bar_gone() -> None:
                for bar in bars.all():
                    assert not shown(bar)

            soon(sol_page, bar_gone)
            ui_sign_in(dev_page, app_url, "usr-dev")
            walk_in = dev_page.get_by_role("region", name="Walk-in loan")
            counter_result = dev_page.get_by_role("status", name="Counter result")
            choose(dev_page, walk_in.get_by_role("combobox", name="Member"), PEOPLE["mem-sol"][0], "mem-sol")
            choose(dev_page, walk_in.get_by_role("combobox", name="Unit"), "LL-1", unit_of("laser-level", 0))
            fill(walk_in.get_by_label("Due date"), lib.next_open())
            click(walk_in.get_by_role("button", name="Lend now"))
            soon(dev_page, lambda: expect(counter_result).to_have_text(COPY["borrowing_paused"], timeout=POLL_MS))
            dev_page.goto(f"{app_url.rstrip('/')}/loans/{overdue['id']}")
            fill(dev_page.get_by_label("Returned at"), local_input(SPRING_LATE_RETURN))
            click(dev_page.get_by_role("button", name="Check in"))
            soon(dev_page, lambda: expect(counter_result).to_contain_text("Checked in late", timeout=POLL_MS))
            sol_page.reload()
            fill(sol_page.get_by_label("Pickup date"), start)
            fill(sol_page.get_by_label("Return date"), end)
            press_hold(sol_page, held_copy(0, 1, 0))
        holds = [h for h in pages(staff, "/api/holds", "holds", status="requested") if h["member"]["id"] == "mem-sol"]
        assert [h["item"]["id"] for h in holds] == ["laser-level"]
    finally:
        prepare(staff, ["mem-sol"], [])


def test_wf_borrowing_pause_limit_ui(app_url: str, browser: Browser, staff: Api, lib: Library) -> None:
    prepare(staff, ["mem-tobi"], ["drill-driver", "hedge-trimmer"])
    tobi = Api(app_url, "mem-tobi")
    for day in lib.opens(lib.today + timedelta(days=2), MAX_ACTIVE):
        make_hold(tobi, "drill-driver", day, day)
    start, end = lib.span(8, 1)
    try:
        with open_app(browser, app_url + "/") as page:
            ui_sign_in(page, app_url, "mem-tobi")
            page.goto(app_url.rstrip("/") + "/items/hedge-trimmer")
            fill(page.get_by_label("Pickup date"), start)
            fill(page.get_by_label("Return date"), end)
            for _ in range(2):
                assert press_hold(page, COPY["borrowing_limit"]) == 409
            assert active_count(staff, "mem-tobi") == MAX_ACTIVE
            page.goto(app_url.rstrip("/") + "/my-loans")
            row = page.get_by_role("region", name="Holds").get_by_role("listitem").filter(has=page.get_by_role("button", name="Cancel hold")).first
            click(row.get_by_role("button", name="Cancel hold"))
            loans_status = page.get_by_role("status", name="My loans status")
            soon(page, lambda: expect(loans_status).to_have_text("Hold cancelled.", timeout=POLL_MS))
            page.goto(app_url.rstrip("/") + "/items/hedge-trimmer")
            fill(page.get_by_label("Pickup date"), start)
            fill(page.get_by_label("Return date"), end)
            press_hold(page, held_copy(0, 2, 1))
        assert active_count(staff, "mem-tobi") == MAX_ACTIVE
    finally:
        clear_member(staff, "mem-tobi")


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}
FONTS = ("Archivo Black", "IBM Plex Sans", "IBM Plex Mono")


INSTALLED_DIR = Path(getattr(conftest, "DEPLOYED_APP", APP_DIR))


def npm_dir() -> Path:
    return APP_DIR if (APP_DIR / "node_modules").is_dir() else INSTALLED_DIR


def shipped_packages() -> dict[tuple[str, str], Any]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=npm_dir(), capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple[str, str], Any] = {}

    def walk(deps: dict[str, Any] | None) -> None:
        for name, node in (deps or {}).items():
            if node.get("missing") or not node.get("version"):
                continue
            found[(name, str(node.get("version", "")))] = node.get("license") or node.get("licenses")
            walk(node.get("dependencies"))

    walk(tree.get("dependencies"))
    return found


def licence_key(name: str) -> str:
    words = re.sub(r"[^a-z0-9]+", " ", name.lower()).split()
    return "".join(w for w in words if w not in ("the", "license", "licence", "version", "v"))


ALLOWED_KEYS = {licence_key(name) for name in ALLOWED_LICENCES}


def licence_ok(licence: Any) -> bool:
    if isinstance(licence, list):
        return any(licence_ok(part) for part in licence)
    if isinstance(licence, dict):
        licence = licence.get("type")
    if not isinstance(licence, str):
        return False
    expr = licence.strip().strip("()")
    if " OR " in expr:
        return any(licence_ok(part.strip()) for part in expr.split(" OR "))
    if " AND " in expr:
        return all(licence_ok(part.strip()) for part in expr.split(" AND "))
    return licence_key(expr) in ALLOWED_KEYS


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) for v in manifest.values())


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    missing = [f"{n}@{v}" for (n, v) in packages if n not in notices or v not in notices]
    assert missing == []
    for font in FONTS:
        assert font in notices


def test_if_licences() -> None:
    bad = [f"{n}@{v}: {lic}" for (n, v), lic in shipped_packages().items() if not licence_ok(lic)]
    assert bad == []


def test_if_no_extra_datastore() -> None:
    package = json.loads((APP_DIR / "package.json").read_text())
    names = {n.lower() for n in package.get("dependencies", {})}
    assert not [n for n in names if any(store.lower() in n for store in FORBIDDEN_STORES)]


def test_if_service_config_unchanged(app_url: str, killbill: KillBill) -> None:
    assert "desk@commonshed.example" in mail_from_address()
    assert killbill.account_by_key("shedline-no-such-member") is None
    S3().keys("loans/")
    assert httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_if_no_third_party_hosts(app_url: str, browser: Browser) -> None:
    for person, paths in (("mem-hal", ["/catalogue", "/items/tile-saw", "/my-loans"]), ("usr-rosa", ["/counter", "/ledger"])):
        with open_app(browser, app_url + "/") as page:
            urls: list[str] = []
            page.on("request", lambda req: urls.append(req.url))
            ui_sign_in(page, app_url, person)
            for path in paths:
                page.goto(app_url.rstrip("/") + path)
                see_heading(page, SCREEN_HEADINGS[path])
            foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
            assert foreign == []


def test_if_lockfile() -> None:
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    package = json.loads((APP_DIR / "package.json").read_text())
    assert lock.get("lockfileVersion")
    for dep in package.get("dependencies", {}):
        assert f"node_modules/{dep}" in lock.get("packages", {}), dep
    install = json.loads((APP_DIR / "run.json").read_text())["install"]
    assert "npm" in install
