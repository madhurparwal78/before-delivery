from __future__ import annotations

import base64
import importlib
import io
import json
import math
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
from contextlib import contextmanager, suppress
from html import unescape as html_unescape
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, localcontext
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page

import conftest
from conftest import (
    DEPLOYED_APP,
    advance,
    animations,
    camera,
    capture,
    changed,
    check as _kit_check,
    click as _kit_click,
    decode,
    difference,
    fill as _kit_fill,
    held,
    idempotency_key,
    layout,
    motion,
    open_app,
    post_json,
    scene_frames,
    select as _kit_select,
    session,
    tab_order,
    tap as _kit_tap,
    unique,
)


def _to_middle(locator: Locator, block: str = "center") -> None:
    locator.evaluate("(e, b) => e.scrollIntoView({block: b, inline: 'center', behavior: 'instant'})", block)


def _settled(locator: Locator, action: Callable[[Locator], Any], hold_clock: bool = False) -> Any:
    deadline = time.monotonic() + UI_WAIT_S
    while True:
        for block in ("center", "end", "start", "nearest"):
            _to_middle(locator, block)
            try:
                return action(locator)
            except AssertionError as error:
                if "obscured" not in str(error) or time.monotonic() > deadline:
                    raise
        if not hold_clock:
            advance(locator.page, STEP_MS)


def click(locator: Locator) -> None:
    _settled(locator, _kit_click)


def tap(locator: Locator) -> None:
    _settled(locator, _kit_tap)


def check(locator: Locator) -> None:
    _settled(locator, _kit_check)


def fill(locator: Locator, value: str) -> None:
    _settled(locator, lambda target: _kit_fill(target, value))


def select(locator: Locator, choice: str) -> None:
    _settled(locator, lambda target: _kit_select(target, choice))


def _kit(name: str, *modules: str) -> Any:
    for module in ("conftest", *modules):
        try:
            found = getattr(importlib.import_module(module), name, None)
        except ImportError:
            continue
        if found is not None:
            return found
    raise ImportError(f"the verifier kit does not provide {name}")


S3 = _kit("S3", "minio_client", "clients.minio", "services.minio", "minio")
PocketBase = _kit("PocketBase", "pocketbase_client", "clients.pocketbase", "services.pocketbase", "pocketbase")
addresses = _kit("addresses", "mailpit_client", "clients.mailpit", "services.mailpit", "mailpit")
_kit_mail_text = _kit("text", "mailpit_client", "clients.mailpit", "services.mailpit", "mailpit")


def mail_text(message: dict[str, Any]) -> str:
    text = _kit_mail_text(message)
    if text.strip():
        return text
    body = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", message.get("HTML") or "")
    body = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h[1-6])>", "\n", body)
    return html_unescape(re.sub(r"<[^>]+>", "", body))

HTTP_TIMEOUT_S = 120
UI_WAIT_S = 60
FRAME_MS = 100
MOTION_MS = 1
SETTLE_S = 10
SCOPE_ROUNDS = 3
DIALOG_TABS = 12
CATALOG_RETRY_S = 30
STEP_MS = 50
QUICK_MS = 500
POLL_S = 0.5
MAIL_WAIT_S = 45
MAIL_SETTLE_S = 2.0
BOOT_S = 240
TAB_LIMIT = 400
TAB_SWEEP = 40
TRAP_PRESSES = 15
PUBLISH_LEAD_S = 8
LATENCY_S = 1
DEVICE_TIME = datetime(2026, 11, 14, 18, 30, 5, tzinfo=timezone.utc)
FAR_DEVICE_TIME = datetime(2031, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
PAST_DEVICE_TIME = datetime(2020, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
DUNNING_TEST_S = 5
RECON_AMOUNT = 1234
RECON_REFUND = 234
PRICE_RISE = 150
SUMMARY = "A verifier-made timeline event about machine thought."
EVENT_YEAR = 1999
AUCKLAND = "Pacific/Auckland"
NEW_YORK = "America/New_York"
BAD_EMAIL = "not-an-email"
REASON = "Verifier check"
APPROVED_CARD = "4242 4242 4242 4242"
APPROVED_LAST4 = "4242"
BAD_LUHN_CARD = "4242 4242 4242 4241"
FOREIGN_ORIGIN = "http://elsewhere.invalid"
PRIVATE_PATHS = ["/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json", "/tsconfig.json", "/src/server.ts"]
SECRET_ENVS = ["POCKETBASE_ADMIN_PASSWORD", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY"]
OUTAGE_ENVS = ["APP_KILLBILL_DOWN_URL", "APP_MAILPIT_DOWN_URL", "APP_MINIO_DOWN_URL", "APP_POCKETBASE_DOWN_URL", "APP_SECOND_URL", "APP_DUNNING_URL"]
DATASTORE_PACKAGES = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "classic-level", "lowdb", "nedb", "@seald-io/nedb", "lmdb", "node-persist"}
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Zlib", "CC0-1.0", "OFL-1.1"}
FONTS = ["Instrument Serif", "Inter Tight", "JetBrains Mono"]

LISBON = ZoneInfo("Europe/Lisbon")
PASSWORD = "Halden-demo-2026"
INES = "ines@halden.test"
PRIYA = "priya@halden.test"
TOMAS = "tomas@halden.test"
MARTA = "marta@halden.test"
DECLINED_CARD = "4000 0000 0000 0002"
ONCE_CARD = "4000 0000 0000 0341"
CURRENCIES = ["EUR", "GBP", "USD", "JPY"]
SYMBOLS = {"EUR": "€", "GBP": "£", "USD": "$", "JPY": "¥"}
TICKET = {"EUR": 1200, "GBP": 1000, "USD": 1400, "JPY": 2000}
TIER_PRICES = {
    "Reader": {"EUR": 500, "GBP": 400, "USD": 600, "JPY": 800},
    "Fellow": {"EUR": 1200, "GBP": 1000, "USD": 1400, "JPY": 2000},
    "Patron": {"EUR": 3000, "GBP": 2600, "USD": 3500, "JPY": 5000},
}
DONATION_MIN = 100
DONATION_MAX = 500000
MAX_SEATS = 4
JSON_LIMIT = 65536
UPLOAD_LIMIT = 20000000
BOOKING_CLOSE = timedelta(minutes=30)
PUBLISH_DELAY_S = 5
MAIL_DELIVERY_S = 60
RECOVER_S = 60
DEBOUNCE_MS = 500
MORPH_MIN_MS = 500
MORPH_MAX_MS = 800
MORPH_SAMPLE_MS = 1200
MORPH_SAMPLES = 25
PLATE_HOLD_MS = 7000
SPRING_REST_MS = 4000
AT_ONCE_MS = 200
EPOCH_MS = 250
MAX_EPOCHS = 20
YAW_MIN = -60
YAW_MAX = 60
YAW_SPAN = 120
YAW_STEP = 3
WHEEL_NOTCH = 100
SWAY_MAX_DEG = 2
SWAY_BOUND = 2 * math.sin(math.radians(SWAY_MAX_DEG))
FRAME_INSET = 40
BASE_VIEWPOINTS = [-60, -40, -20, 0, 20, 40, 60]
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
COLUMNS = {"phone": 1, "tablet": 2, "desktop": 3}
DESKTOP = (1280, 800)
PHONE = (375, 812)
WINTER_LEAD = timedelta(days=21)
CHANGE_LEAD = timedelta(days=2)
EVENING = (18, 30)
REPEAT_HOUR = (1, 30)
CHAPTERS = {
    1: ("I", "Wheels That Count", 33),
    2: ("II", "The Algebra of Thought", -21),
    3: ("III", "Paper Machines", 12),
    4: ("IV", "The Thinking Nerve", -45),
    5: ("V", "The Imitation Game", 48),
    6: ("VI", "Rules of the Expert", -6),
    7: ("VII", "The Perceptron's Winter", 27),
    8: ("VIII", "Words Near Words", -33),
}

SPRING_SEED = json.loads('{"key":"spring","stiffness":{"min":50,"max":300,"step":10,"initial":170},"damping":{"min":2,"max":40,"step":1,"initial":26}}')
RULES_SEED = json.loads('{"key":"rules","specimens":[{"name":"Robin","legs":2,"wings":true,"feathers":true},{"name":"Sparrow","legs":2,"wings":true,"feathers":true},{"name":"Penguin","legs":2,"wings":true,"feathers":true},{"name":"Bat","legs":2,"wings":true,"feathers":false},{"name":"Beetle","legs":6,"wings":true,"feathers":false},{"name":"Ant","legs":6,"wings":false,"feathers":false},{"name":"Dragonfly","legs":6,"wings":true,"feathers":false},{"name":"Spider","legs":8,"wings":false,"feathers":false},{"name":"Scorpion","legs":8,"wings":false,"feathers":false},{"name":"Cat","legs":4,"wings":false,"feathers":false},{"name":"Whale","legs":0,"wings":false,"feathers":false},{"name":"Ostrich","legs":2,"wings":true,"feathers":true}],"rules":[{"attribute":"feathers","value":true,"label":"Bird"},{"attribute":"legs","value":6,"label":"Insect"},{"attribute":"legs","value":8,"label":"Arachnid"}],"attributes":{"legs":{"min":0,"max":8},"wings":[true,false],"feathers":[true,false]},"labels":["Bird","Insect","Arachnid","Mammal"],"new_rule":{"attribute":"legs","value":4,"label":"Mammal"},"max_rules":6}')
CLASSIFIER_SEED = json.loads('{"key":"classifier","grid":{"min":0,"max":10},"max_epochs":20,"training":[{"x":7,"y":8,"label":"signal"},{"x":8,"y":6,"label":"signal"},{"x":9,"y":9,"label":"signal"},{"x":6,"y":9,"label":"signal"},{"x":8,"y":8,"label":"signal"},{"x":9,"y":7,"label":"signal"},{"x":7,"y":6,"label":"signal"},{"x":6,"y":7,"label":"signal"},{"x":2,"y":3,"label":"noise"},{"x":3,"y":1,"label":"noise"},{"x":1,"y":2,"label":"noise"},{"x":4,"y":2,"label":"noise"},{"x":2,"y":5,"label":"noise"},{"x":3,"y":4,"label":"noise"},{"x":1,"y":4,"label":"noise"},{"x":5,"y":1,"label":"noise"}],"held_out":[{"x":8,"y":9,"label":"signal"},{"x":7,"y":7,"label":"signal"},{"x":5,"y":8,"label":"signal"},{"x":9,"y":5,"label":"signal"},{"x":2,"y":2,"label":"noise"},{"x":4,"y":3,"label":"noise"},{"x":3,"y":6,"label":"noise"},{"x":6,"y":4,"label":"noise"}]}')
NEIGHBOURS_SEED = json.loads('{"key":"neighbours","words":[{"word":"bank","vector":[2,2,0]},{"word":"river","vector":[0,4,1]},{"word":"shore","vector":[0,3,2]},{"word":"water","vector":[1,4,0]},{"word":"money","vector":[4,0,1]},{"word":"loan","vector":[4,1,0]},{"word":"vault","vector":[3,0,2]},{"word":"engine","vector":[0,0,5]},{"word":"gear","vector":[1,0,4]},{"word":"memory","vector":[2,1,3]}],"contexts":["river","money","engine"]}')

COPY = {
    "not_found_heading": "We couldn't find that room.",
    "empty_events": "No timeline events in this chapter yet.",
    "media_unavailable": "This media is unavailable right now.",
    "accounts_down": "Accounts are unavailable right now. You can keep exploring, but your path won't be saved until they're back.",
    "wrong_credentials": "Email or password is incorrect.",
    "name": "Enter your name.",
    "email": "Enter a valid email address.",
    "password": "Use 10 to 72 characters.",
    "email_taken": "An account with this email already exists.",
    "processing": "Processing payment, please wait.",
    "booked": "You're booked",
    "thanks": "Thank you for your donation",
    "lost_reply": "Connection lost. Press Donate again to finish safely.",
    "undone": "Your pending change was undone.",
    "retry_ok": "Payment received. Your membership is active.",
    "card_updated": "Card updated.",
    "cancelled_overdue": "Your membership has been cancelled.",
    "delayed": "Your receipt email is delayed. It will arrive once our mail service is back.",
    "booking_closed": "Booking for this session has closed.",
    "sold_out": "Not enough seats left for this session.",
    "card_declined": "Your card was declined. You have not been charged.",
    "already_member": "You're already a supporter. Change your plan instead.",
    "change_pending": "Undo your pending change before making another.",
    "payment_overdue": "Settle your overdue payment before changing your plan.",
    "nothing_pending": "There's no pending change to undo.",
    "nothing_due": "There's nothing to pay right now.",
    "not_a_member": "You don't have a supporter membership.",
    "card": "Enter a valid card number.",
    "seats": "Choose between 1 and 4 seats.",
    "amount_format": "Enter an amount such as 25.00, or a whole number for yen.",
    "billing_down": "Payments are unavailable right now. You have not been charged. Please try again shortly.",
    "prices_down": "Prices are unavailable right now.",
    "storage_purchase": "We can't issue tickets or receipts right now. You have not been charged. Please try again shortly.",
    "draft_saved": "Draft saved.",
    "not_editable": "Only drafts can be edited.",
    "lead_only": "Only the lead curator can schedule items.",
    "forbidden": "You can't change this item.",
    "after_now": "Choose a time after now.",
    "skipped": "That time doesn't exist in Lisbon because the clocks go forward. Choose another time.",
    "reason": "Give a reason of 3 to 500 characters.",
    "file_type": "This file type isn't accepted here.",
    "file_size": "Files must be 20,000,000 bytes or smaller.",
    "transcript": "Narration needs a transcript.",
    "storage_upload": "Media storage is unavailable right now. Your file was not uploaded.",
    "session_created": "Session created.",
    "not_cancellable": "This session can no longer be cancelled.",
    "fully_refunded": "This order is already fully refunded.",
    "price_conflict": "A later price change is already scheduled.",
    "after_today": "Choose a date after today.",
    "unauthenticated": "Please sign in.",
    "not_found": "We couldn't find that.",
    "forbidden_origin": "Request refused.",
    "key_required": "Missing idempotency key.",
    "key_conflict": "This request key was already used for a different request.",
    "too_large": "That request is too large.",
    "send_json": "Send JSON.",
    "validation": "Check the highlighted fields.",
    "no_webgl": "Your browser can't show the 3D scene, so here are its viewpoints.",
}

_tick = threading.Event()


class Api:
    def __init__(self, base: str, cookie: str | None = None) -> None:
        self.base = base.rstrip("/")
        self._cookie = cookie
        headers = {"Cookie": f"sl_session={cookie}"} if cookie else {}
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, follow_redirects=False, headers=headers)

    @property
    def cookie(self) -> str:
        if self._cookie:
            return self._cookie
        for item in self.http.cookies.jar:
            if item.name == "sl_session":
                return item.value
        raise AssertionError("no sl_session cookie was set")

    def at(self, base: str) -> "Api":
        return Api(base, self.cookie)

    def get(self, path: str, **params: Any) -> httpx.Response:
        return self.http.get(path, params=params or None)

    def send(self, method: str, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        headers: dict[str, str] = {}
        if key is not None:
            headers["Idempotency-Key"] = key
        if body is None:
            return self.http.request(method, path, headers=headers)
        headers["Content-Type"] = "application/json"
        return self.http.request(method, path, content=json.dumps(body), headers=headers)

    def post(self, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        return self.send("POST", path, {} if body is None else body, key)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.send("PUT", path, body)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.send("PATCH", path, body)

    def delete(self, path: str) -> httpx.Response:
        return self.send("DELETE", path)


@dataclass
class Person:
    api: Api
    user: dict
    name: str
    email: str

    @property
    def id(self) -> str:
        return self.user["id"]


def _ok(response: httpx.Response, status: int) -> Any:
    assert response.status_code == status, f"expected {status}, got {response.status_code}: {response.text[:800]}"
    return response.json() if response.content else None


def _err(response: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert response.status_code == status, f"expected {status} {code}, got {response.status_code}: {response.text[:800]}"
    error = response.json()["error"]
    assert error["code"] == code, error
    if message is not None:
        assert error["message"] == message, error
    if status == 422:
        assert isinstance(error.get("fields"), dict), error
    else:
        assert "fields" not in error, error
    return error


def _outage(env: str) -> str:
    value = os.environ.get(env)
    assert value, f"{env} is not set for this verifier run"
    return value.rstrip("/")


def _origin(base: str) -> str:
    parsed = urlparse(base)
    return f"{parsed.scheme}://{parsed.netloc}"


def _get_json(base: str, path: str, **params: Any) -> Any:
    return _ok(httpx.get(base.rstrip("/") + path, params=params or None, timeout=HTTP_TIMEOUT_S), 200)


def _chapter_api(number: int) -> str:
    return f"/api/chapters/{number}"


def _chapter_id(number: int) -> str:
    return f"chapter-{number}"


def _card(number: int) -> str:
    numeral, title, _ = CHAPTERS[number]
    return f"Chapter {numeral}: {title}"


def _ended(subscription: dict) -> bool:
    return str(subscription.get("state", "")).lower() == "cancelled"


def _names() -> tuple[str, str]:
    first, second = unique("visitor")
    return (second, first) if "@" in first else (first, second)


def _visitor(base: str) -> Person:
    name, email = _names()
    api = Api(base)
    body = _ok(api.post("/api/auth/register", {"name": name, "email": email, "password": PASSWORD}), 201)
    return Person(api, body["user"], name, email)


def _staff(base: str, email: str) -> Person:
    api = Api(base)
    body = _ok(api.post("/api/auth/login", {"email": email, "password": PASSWORD}), 200)
    return Person(api, body["user"], body["user"]["name"], email)


def _tag() -> str:
    return uuid.uuid4().hex[:8]


def _poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}")
        _tick.wait(POLL_S)


def _together(*calls: Callable[[], httpx.Response]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        futures = [pool.submit(run, call) for call in calls]
        return [future.result() for future in futures]


def _server_now(api: Api) -> datetime:
    return datetime.fromisoformat(_ok(api.get("/api/sessions"), 200)["server_time"])


def _lisbon(moment: datetime) -> datetime:
    return moment.astimezone(LISBON)


def _iso(moment: datetime) -> str:
    return _lisbon(moment).isoformat(timespec="seconds")


def _display(moment: datetime) -> str:
    local = _lisbon(moment)
    return f"{local:%a} {local.day} {local:%b} {local.year}, {local:%H:%M} Lisbon time"


def _date_pattern(day: date) -> str:
    return rf"0?{day.day} {day:%b} {day.year}"


def _last_sunday(year: int, month: int) -> date:
    end = date(year, month + 1, 1) - timedelta(days=1)
    return end - timedelta(days=(end.weekday() - 6) % 7)


def _next_day(api: Api, make: Callable[[int], date], lead: timedelta) -> date:
    today = _lisbon(_server_now(api)).date()
    year = today.year
    while make(year) < today + lead:
        year += 1
    return make(year)


def _winter_day(api: Api) -> date:
    return _next_day(api, lambda y: date(y, 1, 12), WINTER_LEAD)


def _spring_day(api: Api) -> date:
    return _next_day(api, lambda y: _last_sunday(y, 3), CHANGE_LEAD)


def _autumn_day(api: Api) -> date:
    return _next_day(api, lambda y: _last_sunday(y, 10), CHANGE_LEAD)


def _wall(day: date, hm: tuple[int, int]) -> datetime:
    return datetime(day.year, day.month, day.day, hm[0], hm[1], tzinfo=LISBON)


def _entry(day: date, hm: tuple[int, int]) -> str:
    return f"{day:%Y-%m-%d} {hm[0]:02d}:{hm[1]:02d}"


def _utc(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _winter(api: Api) -> str:
    return _iso(_wall(_winter_day(api), EVENING))


def _price(minor: int, currency: str) -> str:
    if currency == "JPY":
        return f"¥{minor:,}"
    return f"{SYMBOLS[currency]}{minor // 100:,}.{minor % 100:02d}"


def _minor(amount: Any, currency: str) -> int:
    value = Decimal(str(amount)) * (1 if currency == "JPY" else 100)
    assert value == value.to_integral_value(), amount
    return int(value)


def _sessions(api: Api) -> list[dict]:
    return _ok(api.get("/api/sessions"), 200)["sessions"]


def _session_state(api: Api, sid: str) -> dict:
    return next(s for s in _sessions(api) if s["id"] == sid)


def _new_session(manager: Person, title: str, starts: str, capacity: int, duration: int = 60) -> dict:
    body = {"title": title, "starts_at": starts, "duration_minutes": duration, "capacity": capacity}
    return _ok(manager.api.post("/api/manager/sessions", body), 201)["session"]


def _book(person: Person, sid: str, seats: int = 1, currency: str = "EUR", card: str = APPROVED_CARD, key: str | None = None) -> httpx.Response:
    body = {"seats": seats, "currency": currency, "card_number": card}
    return person.api.post(f"/api/sessions/{sid}/bookings", body, key or idempotency_key())


def _donate(person: Person, amount: int, currency: str = "EUR", card: str = APPROVED_CARD, note: str = "", key: str | None = None) -> httpx.Response:
    body = {"amount_minor": amount, "currency": currency, "card_number": card, "note": note}
    return person.api.post("/api/donations", body, key or idempotency_key())


def _catalog(api: Api) -> dict:
    seen: list[httpx.Response] = []

    def read() -> httpx.Response | None:
        seen.append(api.get("/api/catalog"))
        return seen[-1] if seen[-1].status_code != 503 else None

    try:
        response = _poll(read, CATALOG_RETRY_S, "the catalog without a transient 503")
    except AssertionError:
        response = seen[-1]
    return _ok(response, 200)


def _tiers(api: Api) -> dict[str, str]:
    return {tier["name"]: tier["tier"] for tier in _catalog(api)["tiers"]}


def _price_now(api: Api, tier_name: str, currency: str) -> int:
    return next(t for t in _catalog(api)["tiers"] if t["name"] == tier_name)["prices"][currency]


def _join(person: Person, tier_name: str, currency: str, card: str = APPROVED_CARD) -> httpx.Response:
    body = {"tier": _tiers(person.api)[tier_name], "currency": currency, "card_number": card}
    return person.api.post("/api/me/membership", body, idempotency_key())


def _change(person: Person, tier_name: str, api: Api | None = None, key: str | None = None) -> httpx.Response:
    client = api or person.api
    return client.post("/api/me/membership/change", {"tier": _tiers(person.api)[tier_name]}, key or idempotency_key())


def _membership(api: Api) -> dict | None:
    return _ok(api.get("/api/me/membership"), 200)["membership"]


def _orders(api: Api) -> list[dict]:
    return _ok(api.get("/api/me/orders"), 200)["orders"]


def _ledger(manager: Person, email: str, **filters: str) -> list[dict]:
    rows = _ok(manager.api.get("/api/manager/orders", **filters), 200)["orders"]
    return [row for row in rows if row["user_email"] == email]


def _audit(api: Api) -> list[dict]:
    return _ok(api.get("/api/manager/audit"), 200)["actions"]


def _kb_txns(kb: Any, email: str, kind: str = "PURCHASE") -> list[dict]:
    account = kb.account(email)
    if not account:
        return []
    found = []
    for payment in kb.payments(account["accountId"]):
        for txn in payment.get("transactions") or []:
            if txn.get("transactionType") == kind and txn.get("status") == "SUCCESS":
                currency = txn.get("currency") or payment["currency"]
                found.append({"minor": _minor(txn["amount"], currency), "currency": currency, "payment_id": payment["paymentId"]})
    return found


def _kb_invoices(kb: Any, email: str) -> list[dict]:
    account = kb.account(email)
    return kb.invoices(account["accountId"]) if account else []


def _kb_subs(kb: Any, email: str) -> list[dict]:
    account = kb.account(email)
    return kb.subscriptions(account["accountId"]) if account else []


def _kb_live_sub(kb: Any, email: str) -> dict:
    subs = [s for s in _kb_subs(kb, email) if not _ended(s)]
    assert len(subs) == 1, subs
    return subs[0]


def _mails(mail: Any, to: str, subject: str | None = None, minimum: int = 1, seconds: float = MAIL_WAIT_S, prefix: str | None = None) -> list[dict]:
    def mine(settle: float) -> list[dict]:
        found = []
        for message in mail.messages(0, settle):
            if to.lower() not in [a.lower() for a in addresses(message.get("To"))]:
                continue
            subj = message.get("Subject", "")
            if subject is not None and subj != subject:
                continue
            if prefix is not None and not subj.startswith(prefix):
                continue
            found.append(message)
        return found

    deadline = time.monotonic() + seconds
    while minimum and len(mine(POLL_S)) < minimum and time.monotonic() < deadline:
        pass
    return mine(MAIL_SETTLE_S)


def _pb(collection: str, uid: str) -> list[dict]:
    return PocketBase().records(collection, f'user = "{uid}"')


def _pdf_text(data: bytes) -> str:
    assert data.startswith(b"%PDF"), data[:20]
    for module in ("pypdf", "PyPDF2"):
        try:
            reader = importlib.import_module(module).PdfReader(io.BytesIO(data))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            continue
    try:
        from pdfminer.high_level import extract_text
        return extract_text(io.BytesIO(data))
    except ImportError:
        pass
    chunks: list[str] = []
    for match in re.finditer(rb"stream\r?\n(.*?)endstream", data, re.S):
        raw = match.group(1)
        try:
            raw = zlib.decompressobj().decompress(raw)
        except zlib.error:
            pass
        for literal in re.findall(rb"\(((?:\\.|[^\\)])*)\)", raw):
            chunks.append(literal.decode("latin-1"))
        for hexed in re.findall(rb"<([0-9A-Fa-f\s]+)>", raw):
            digits = re.sub(rb"\s", b"", hexed)
            if len(digits) % 2 == 0:
                chunks.append(bytes.fromhex(digits.decode()).decode("latin-1"))
    return "".join(chunks).replace("\x80", "€")


def _squash(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _receipt_pdf(number: str, bucket: str = "") -> str:
    return _pdf_text(S3(bucket).get(f"receipts/{number}.pdf") if bucket else S3().get(f"receipts/{number}.pdf"))


def _alignment(yaw: int, sight: int) -> int:
    d = abs(yaw - sight)
    return math.floor(Fraction(100 * (YAW_SPAN - d), YAW_SPAN) + Fraction(1, 2))


def _angle(value: int) -> str:
    return f"+{value}°" if value > 0 else f"{value}°"


def _viewpoints(sight: int) -> list[int]:
    nearest = min(BASE_VIEWPOINTS, key=lambda v: (abs(v - sight), abs(v)))
    return sorted(sight if v == nearest else v for v in BASE_VIEWPOINTS)


def _radio_name(view: int, sight: int) -> str:
    return f"Viewpoint {_angle(view)}, alignment {_alignment(view, sight)}%"


def _classify(rules: list[dict]) -> dict[str, str]:
    result = {}
    for specimen in RULES_SEED["specimens"]:
        label = "Unclassified"
        for rule in rules:
            if specimen[rule["attribute"]] == rule["value"]:
                label = rule["label"]
                break
        result[specimen["name"]] = label
    return result


def _points(seed: list[dict]) -> list[tuple[int, int, int]]:
    return [(p["x"], p["y"], 1 if p["label"] == "signal" else -1) for p in seed]


def _train(points: list[tuple[int, int, int]]) -> tuple[int, int, int, int]:
    w1 = w2 = b = epochs = 0
    for _ in range(MAX_EPOCHS):
        epochs += 1
        updates = 0
        for x, y, label in points:
            if label * (w1 * x + w2 * y + b) <= 0:
                w1, w2, b, updates = w1 + label * x, w2 + label * y, b + label, updates + 1
        if not updates:
            break
    return w1, w2, b, epochs


def _score(model: tuple[int, int, int, int]) -> tuple[str, dict[str, tuple[int, int]]]:
    w1, w2, b, _ = model
    counts = {"Actual signal": [0, 0], "Actual noise": [0, 0]}
    correct = 0
    for x, y, label in _points(CLASSIFIER_SEED["held_out"]):
        signal_ = w1 * x + w2 * y + b > 0
        counts["Actual signal" if label > 0 else "Actual noise"][0 if signal_ else 1] += 1
        correct += int(signal_ == (label > 0))
    accuracy = (Decimal(correct * 100) / Decimal(len(CLASSIFIER_SEED["held_out"]))).quantize(Decimal("0.1"), ROUND_HALF_UP)
    return str(accuracy), {k: (v[0], v[1]) for k, v in counts.items()}


def _neighbours(word: str, context: str | None) -> list[tuple[str, str]]:
    vectors = {w["word"]: w["vector"] for w in NEIGHBOURS_SEED["words"]}
    query = list(vectors[word])
    if context:
        query = [a + b for a, b in zip(query, vectors[context])]
    qq = sum(a * a for a in query)

    def dot(v: list[int]) -> int:
        return sum(a * b for a, b in zip(query, v))

    def key(w: str) -> tuple[Fraction, str]:
        d, vv = dot(vectors[w]), sum(a * a for a in vectors[w])
        return (-(1 if d >= 0 else -1) * Fraction(d * d, vv), w)

    ranked = sorted((w for w in vectors if w not in (word, context)), key=key)[:3]
    out = []
    with localcontext() as ctx:
        ctx.prec = 50
        for w in ranked:
            sim = Decimal(dot(vectors[w])) / (Decimal(qq) * Decimal(sum(a * a for a in vectors[w]))).sqrt()
            out.append((w, str(sim.quantize(Decimal("0.01"), ROUND_HALF_UP))))
    return out


def _neighbour_status(word: str, context: str | None) -> str:
    words = ", ".join(w for w, _ in _neighbours(word, context))
    return f"Nearest to {word} near {context}: {words}." if context else f"Nearest to {word}: {words}."


def _regime(k: int, c: int) -> str:
    if c * c < 4 * k:
        return "Spring is underdamped."
    return "Spring is critically damped." if c * c == 4 * k else "Spring is overdamped."


def _eventually(page: Page, check_: Callable[[], Any], what: str, seconds: float = UI_WAIT_S, step_ms: float = STEP_MS) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while True:
        try:
            result = check_()
            if result:
                return result
            last = result
        except Exception as error:
            last = error
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}; last: {last!r}")
        advance(page, step_ms)


def _rendered(loc: Locator) -> str:
    return loc.evaluate(
        "e => { const s = document.createElement('style'); s.textContent = '*{text-transform:none !important}';"
        " document.head.appendChild(s); try { return e.innerText; } finally { s.remove(); } }",
        timeout=QUICK_MS)


def _txt(loc: Locator) -> str:
    return " ".join(_rendered(loc).split())


def _shows(page: Page, loc: Locator, expected: str, seconds: float = UI_WAIT_S) -> None:
    seen: dict[str, Any] = {}

    def probe() -> bool:
        seen["text"] = _txt(loc)
        return seen["text"] == expected

    try:
        _eventually(page, probe, repr(expected), seconds)
    except AssertionError as error:
        raise AssertionError(f"expected {expected!r}, saw {seen.get('text')!r}") from error


def _includes(page: Page, loc: Locator, needle: str, seconds: float = UI_WAIT_S) -> None:
    seen: dict[str, Any] = {}

    def probe() -> bool:
        seen["text"] = _txt(loc)
        return needle in seen["text"]

    try:
        _eventually(page, probe, repr(needle), seconds)
    except AssertionError as error:
        raise AssertionError(f"expected {needle!r} within {seen.get('text')!r}") from error


def _visible(page: Page, loc: Locator, what: str, seconds: float = UI_WAIT_S) -> None:
    _eventually(page, lambda: loc.count() > 0 and loc.first.is_visible(), what, seconds)


def _gone(page: Page, loc: Locator, what: str) -> None:
    _eventually(page, lambda: loc.count() == 0 or not loc.first.is_visible(), what)


def _disabled(loc: Locator) -> bool:
    return loc.is_disabled(timeout=QUICK_MS) or loc.get_attribute("aria-disabled", timeout=QUICK_MS) == "true"


def _focused(loc: Locator) -> bool:
    return bool(loc.evaluate("e => e === document.activeElement", timeout=QUICK_MS))


def _holds_focus(loc: Locator) -> bool:
    return bool(loc.evaluate("e => e.contains(document.activeElement)", timeout=QUICK_MS))


def _field(scope: Any, name: str) -> Locator:
    box = scope.get_by_role("textbox", name=name, exact=True)
    return box if box.count() else scope.get_by_label(name, exact=True)


def _status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name, exact=True)


def _button(scope: Any, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def _dialog(page: Page, name: str) -> Locator:
    return page.get_by_role("dialog", name=name, exact=True)


def _choose(loc: Locator, *labels: str) -> None:
    last: Exception | None = None
    for label in labels:
        try:
            select(loc, label)
            return
        except Exception as error:
            last = error
    raise AssertionError(f"none of {labels} could be chosen: {last}")


def _combo_label(loc: Locator) -> str:
    return str(loc.evaluate("e => e.selectedOptions && e.selectedOptions.length ? e.selectedOptions[0].label : (e.value || e.textContent || '').trim()"))


def _tab_to(page: Page, target: Locator, back: bool = False, limit: int = TAB_LIMIT) -> None:
    for _ in range(limit):
        if target.count() and _focused(target):
            return
        page.keyboard.press("Shift+Tab" if back else "Tab")
    raise AssertionError("keyboard focus never reached the target control")


def _sign_cookie(page: Page, base: str, person: Person, path: str) -> None:
    page.context.add_cookies([{"name": "sl_session", "value": person.api.cookie, "url": base}])
    page.goto(base.rstrip("/") + path)


@contextmanager
def _device(browser: Browser, url: str, *, tz: str | None = None, at: datetime = DEVICE_TIME, viewport: tuple[int, int] = DESKTOP,
            reduced_motion: str = "no-preference", person: Person | None = None, base: str | None = None) -> Iterator[Page]:
    options: dict[str, Any] = {"viewport": {"width": viewport[0], "height": viewport[1]}, "reduced_motion": reduced_motion}
    if tz:
        options["timezone_id"] = tz
    context = browser.new_context(**options)
    try:
        if person:
            context.add_cookies([{"name": "sl_session", "value": person.api.cookie, "url": base or url}])
        page = context.new_page()
        page.clock.install(time=at)
        page.goto(url)
        page.clock.pause_at(at + timedelta(seconds=1))
        yield page
    finally:
        context.close()


def _signin_ui(page: Page, email: str) -> None:
    opener = _button(page, "Sign in").first
    _visible(page, opener, "Sign in button")
    click(opener)
    dialog = _dialog(page, "Sign in")
    _visible(page, dialog, "Sign in dialog")
    fill(_field(dialog, "Email"), email)
    fill(_field(dialog, "Password"), PASSWORD)
    click(_button(dialog, "Sign in"))
    _visible(page, page.get_by_role("link", name="Account", exact=True), "Account link")


def _scene(page: Page) -> Locator:
    return page.get_by_role("slider", name="Sightline", exact=True)


def _enter_chapter(page: Page, use_tap: bool = False) -> None:
    align = _button(page, "Align")
    _visible(page, align, "Align")
    (tap if use_tap else click)(align)
    enter = _button(page, "Enter chapter")
    _eventually(page, lambda: not _disabled(enter), "Enter chapter enabled")
    (tap if use_tap else click)(enter)


def _row(scope: Any, needle: str) -> Locator:
    return scope.get_by_role("row").filter(has_text=needle).first


def _row_last(row: Locator) -> str:
    return re.split(r"\s+", _rendered(row).strip())[-1]


def _row_ints(row: Locator) -> tuple[int, ...]:
    return tuple(int(n) for n in re.findall(r"\b\d+\b", _rendered(row)))


NEAREST_BUTTON = "(e, buttons) => { let depth = 0; for (let n = e; n; n = n.parentElement, depth++) { const i = buttons.findIndex(b => n.contains(b)); if (i >= 0) return [depth, i]; } return [1e9, -1]; }"


def _button_near(page: Page, text: str, name: str) -> Locator:
    buttons = _button(page, name)
    _visible(page, buttons, f"{name} buttons")
    _visible(page, page.get_by_text(text).first, text)
    handles = [b.element_handle() for b in buttons.all()]
    best = min(match.evaluate(NEAREST_BUTTON, handles) for match in page.get_by_text(text).all())
    assert best[1] >= 0, f"no {name} button near {text}"
    return buttons.nth(best[1])


def _sculpture_box(pluck: Locator) -> dict[str, float]:
    page = pluck.page
    stiffness = page.get_by_role("slider", name="Stiffness", exact=True).element_handle()
    status = _status(page, "Sculpture state").element_handle()
    return pluck.evaluate(
        "(b, [k, s]) => { let x = b; while (x.parentElement && !(x.contains(k) && x.contains(s))) x = x.parentElement;"
        " const area = n => { const r = n.getBoundingClientRect(); return r.width * r.height; };"
        " const controls = 'input, button, select, textarea, [role=slider], [role=status]';"
        " const art = [...x.querySelectorAll('canvas, svg')].filter(n => area(n) > 2500);"
        " const parts = art.length ? art : [...x.querySelectorAll('*')].filter(n => area(n) > 2500 && n.childElementCount"
        " && !n.textContent.trim() && !n.matches(controls) && !n.querySelector(controls));"
        " const t = parts.length ? parts.reduce((a, c) => area(a) >= area(c) ? a : c) : x;"
        " const r = t.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }",
        [stiffness, status])


def _region_shot(page: Page, box: dict[str, float]) -> Any:
    full = decode(base64.b64decode(session(page).send("Page.captureScreenshot", {"format": "png"})["data"]))
    scale = full.width / page.viewport_size["width"]
    left, top = max(0, int(box["x"] * scale)), max(0, int(box["y"] * scale))
    right, bottom = min(full.width, int((box["x"] + box["width"]) * scale)), min(full.height, int((box["y"] + box["height"]) * scale))
    assert right > left and bottom > top, f"region {box} is outside the viewport"
    rows = b"".join(full.rgb[(y * full.width + left) * 3:(y * full.width + right) * 3] for y in range(top, bottom))
    return type(full)(right - left, bottom - top, rows)


def _still(page: Page, box: dict[str, float]) -> None:
    last = [_region_shot(page, box)]

    def same() -> bool:
        now = _region_shot(page, box)
        equal = difference(last[0], now) == 0
        last[0] = now
        return equal

    _poll(same, SETTLE_S, "the region to come to rest")


def _touch_at(page: Page, x: float, y: float) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def _yaw(slider: Locator) -> tuple[int, int]:
    match = re.fullmatch(r"Yaw ([+-]?\d+)°, alignment (\d+)%", slider.get_attribute("aria-valuetext") or "")
    assert match, slider.get_attribute("aria-valuetext")
    return int(match.group(1)), int(match.group(2))


def _matrix_shift(before: list[list[float]], after: list[list[float]]) -> float:
    assert before and after, "the scene uploaded no camera or model matrices"
    return max(abs(a - b) for m1, m2 in zip(before, after) for a, b in zip(m1, m2))


def _png(seed: int = 0, size: int = 8) -> bytes:
    raw = b"".join(b"\x00" + bytes((x * 31 + y * 17 + seed) % 256 for x in range(size * 3)) for y in range(size))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def _mp3() -> bytes:
    frame = b"\xff\xfb\x90\x64" + bytes(413)
    return b"ID3\x04\x00\x00\x00\x00\x00\x00" + frame * 40


def _pdf(size: int) -> bytes:
    head = b"%PDF-1.4\n%"
    tail = b"\n%%EOF\n"
    return head + b"a" * (size - len(head) - len(tail)) + tail


def _upload(api: Api, item_id: str, kind: str, filename: str, data: bytes, content_type: str, transcript: str | None = None) -> httpx.Response:
    form = {"kind": kind, "item_id": item_id}
    if transcript is not None:
        form["transcript"] = transcript
    return api.http.post("/api/curator/media", data=form, files={"file": (filename, data, content_type)})


def _event(curator: Person, chapter: int, title: str, sources: tuple[str, ...] = ()) -> dict:
    body = {"chapter": chapter, "year": EVENT_YEAR, "title": title, "summary": SUMMARY, "source_ids": list(sources)}
    return _ok(curator.api.post("/api/curator/events", body), 201)["item"]


def _move(api: Api, item_id: str, to: str, publish_at: str | None = None, reason: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"to": to}
    if publish_at is not None:
        body["publish_at"] = publish_at
    if reason is not None:
        body["reason"] = reason
    return api.post(f"/api/curator/items/{item_id}/transitions", body)


def _item(api: Api, item_id: str) -> dict:
    return next(i for i in _ok(api.get("/api/curator/items"), 200)["items"] if i["id"] == item_id)


def _publish(owner: Person, lead: Person, item_id: str) -> datetime:
    if _item(owner.api, item_id)["status"] != "review":
        _ok(_move(owner.api, item_id, "review"), 200)
    at = _server_now(lead.api) + timedelta(seconds=PUBLISH_LEAD_S)
    _ok(_move(lead.api, item_id, "scheduled", publish_at=_iso(at)), 200)
    _poll(lambda: _item(owner.api, item_id)["status"] == "published", PUBLISH_LEAD_S + PUBLISH_DELAY_S + MAIL_SETTLE_S * 5, f"{item_id} published")
    return at


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Relay:
    def __init__(self, target: str) -> None:
        parsed = urlparse(target)
        self.target = (parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        self.port = _free_port()
        self.server: socket.socket | None = None

    def open(self) -> None:
        server = socket.socket()
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", self.port))
        server.listen()
        self.server = server
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while self.server:
            try:
                client, _ = self.server.accept()
                upstream = socket.create_connection(self.target)
            except OSError:
                return
            for src, dst in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pump, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        for sock in (src, dst):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def close(self) -> None:
        server, self.server = self.server, None
        if server:
            try:
                server.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            server.close()


@contextmanager
def _app_copy(overrides: dict[str, str]) -> Iterator[str]:
    port = _free_port()
    manifest = json.loads(Path(DEPLOYED_APP, "run.json").read_text())
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_bytes()[-4000:].decode(errors="replace")

    def healthy() -> bool:
        assert proc.poll() is None, f"app copy exited:\n{tail()}"
        try:
            return httpx.get(base + "/api/health", timeout=5).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        try:
            _poll(healthy, BOOT_S, "app copy health")
        except AssertionError as error:
            raise AssertionError(f"{error}\n{tail()}") from error
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=20)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def test_sightline_orbit_readout(browser: Browser, app_url: str) -> None:
    sight = CHAPTERS[1][2]
    with open_app(browser, app_url + "/chapters/1") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        slider, meter = _scene(page), page.get_by_role("meter", name="Alignment", exact=True)
        _visible(page, slider, "Sightline slider")
        assert slider.get_attribute("aria-valuemin") == "0" and slider.get_attribute("aria-valuemax") == "100"

        def at(yaw: int) -> None:
            a = _alignment(yaw, sight)
            _eventually(page, lambda: slider.get_attribute("aria-valuetext") == f"Yaw {_angle(yaw)}, alignment {a}%" and slider.get_attribute("aria-valuenow") == str(a), f"yaw {yaw}")
            _shows(page, meter, f"Alignment {a}%")

        at(YAW_MIN)
        frames = scene_frames(slider, steps=2)
        assert frames[-1]["draws"] > 0 and decode(frames[-1]["png"]).variance() > 0
        slider.focus()
        page.keyboard.press("ArrowRight")
        at(YAW_MIN + YAW_STEP)
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        at(YAW_MIN)
        advance(page, FRAME_MS)
        before = camera(page)
        page.keyboard.press("End")
        at(YAW_MAX)
        advance(page, FRAME_MS)
        assert _matrix_shift(before, camera(page)) > SWAY_BOUND
        page.keyboard.press("ArrowRight")
        at(YAW_MAX)
        page.keyboard.press("Home")
        at(YAW_MIN)
        box = slider.bounding_box()
        assert box
        y = box["y"] + box["height"] / 2
        page.mouse.move(box["x"] + box["width"] * 0.6, y)
        page.mouse.wheel(0, WHEEL_NOTCH)
        at(YAW_MIN + YAW_STEP)
        page.mouse.wheel(0, -WHEEL_NOTCH)
        at(YAW_MIN)
        start = box["x"] + box["width"] * 0.45
        page.mouse.move(start, y)
        page.mouse.down()
        page.mouse.move(start + box["width"] / 4, y, steps=10)
        page.mouse.up()
        target = YAW_MIN + YAW_SPAN // 4
        _eventually(page, lambda: abs(_yaw(slider)[0] - target) <= 1, "drag moved a quarter of 120°")
        yaw, shown = _yaw(slider)
        assert shown == _alignment(yaw, sight) and slider.get_attribute("aria-valuenow") == str(shown)


def test_sightline_resolution(browser: Browser, app_url: str) -> None:
    numeral, title, sight = CHAPTERS[4]
    with open_app(browser, app_url + "/chapters/4") as page:
        slider, meter, enter = _scene(page), page.get_by_role("meter", name="Alignment", exact=True), _button(page, "Enter chapter")
        _visible(page, slider, "slider")
        slider.focus()
        page.keyboard.press("Home")
        for _ in range((sight - YAW_MIN) // YAW_STEP - 1):
            page.keyboard.press("ArrowRight")
        _shows(page, meter, f"Alignment {_alignment(sight - YAW_STEP, sight)}%")
        assert _disabled(enter)
        page.keyboard.press("ArrowRight")
        _shows(page, meter, "Alignment 100%")
        _shows(page, _status(page, "Sightline status"), f"Chapter {numeral} resolved.")
        _eventually(page, lambda: not _disabled(enter), "Enter chapter enabled")
        heading = page.get_by_role("heading", level=1, name=title, exact=True)
        _visible(page, heading, "chapter heading")
        page.keyboard.press("End")
        advance(page, AT_ONCE_MS)
        _shows(page, meter, "Alignment 100%")
        assert not _disabled(enter)
    for n, via_key in ((8, False), (7, True)):
        numeral, _, _ = CHAPTERS[n]
        with open_app(browser, f"{app_url}/chapters/{n}") as page:
            _visible(page, _scene(page), "slider")
            if via_key:
                _scene(page).focus()
                page.keyboard.press("a")
            else:
                click(_button(page, "Align"))
            _shows(page, _status(page, "Sightline status"), f"Chapter {numeral} resolved.")
            _shows(page, page.get_by_role("meter", name="Alignment", exact=True), "Alignment 100%")


def test_wf_sightline_find(browser: Browser, app_url: str) -> None:
    person = _visitor(app_url)
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        _signin_ui(page, person.email)
        card = page.get_by_role("link", name=_card(4), exact=True)
        _visible(page, card, "chapter IV card")
        assert page.get_by_text("Resolved", exact=True).count() == 0
        _tab_to(page, card)
        page.keyboard.press("Enter")
        slider = _scene(page)
        _visible(page, slider, "slider")
        _tab_to(page, slider)
        page.keyboard.press("Home")
        for _ in range((CHAPTERS[4][2] - YAW_MIN) // YAW_STEP):
            page.keyboard.press("ArrowRight")
        enter = _button(page, "Enter chapter")
        _eventually(page, lambda: not _disabled(enter), "Enter chapter enabled")
        _tab_to(page, enter)
        page.keyboard.press("Enter")
        heading = page.get_by_role("heading", level=1, name=CHAPTERS[4][1], exact=True)
        _eventually(page, lambda: _focused(heading), "focus on the chapter heading")
        _poll(lambda: next(iter(_pb("saved_paths", person.id)), None), UI_WAIT_S, "saved path")
        _poll(lambda: _pb("saved_paths", person.id)[0]["resolved"] == [4], UI_WAIT_S, "resolved [4]")
        record = _pb("saved_paths", person.id)[0]
        assert record["last_chapter"] == 4 and record["last_exhibit"] == ""
        page.goto(app_url + "/")
        _visible(page, page.get_by_role("link", name=f"Continue at chapter {CHAPTERS[4][0]}", exact=True), "Continue link")
        mark = page.get_by_text("Resolved", exact=True)
        _visible(page, mark, "Resolved mark")
        assert mark.count() == 1
        links = {c[0]: page.get_by_role("link", name=f"Chapter {c[0]}: {c[1]}", exact=True).element_handle() for c in CHAPTERS.values()}
        held_by = mark.evaluate(
            "(m, links) => { const own = l => { let c = l; while (c.parentElement && !links.some(o => o !== l && c.parentElement.contains(o)))"
            " c = c.parentElement; return c; }; const r = m.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;"
            " return links.map(own).map(c => { const b = c.getBoundingClientRect();"
            " return c.contains(m) || (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom); }); }",
            list(links.values()))
        assert [n for n, hit in zip(links, held_by) if hit] == ["IV"], dict(zip(links, held_by))
        page.goto(app_url + "/account")
        _visible(page, page.get_by_role("link", name=f"Continue at chapter {CHAPTERS[4][0]}", exact=True), "Continue on account")
        page.goto(app_url + "/chapters/4")
        _eventually(page, lambda: not _disabled(_button(page, "Enter chapter")), "opens resolved")
    resolved = {c["number"]: c["resolved"] for c in _ok(person.api.get("/api/chapters"), 200)["chapters"]}
    assert resolved[4] is True and resolved[1] is False


def test_wf_sightline_phone_motion_off(browser: Browser, app_url: str) -> None:
    person = _visitor(app_url)
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        _sign_cookie(page, app_url, person, "/")
        for n in (6, 4, 7, 8):
            numeral, title, sight = CHAPTERS[n]
            page.goto(app_url + "/")
            link = page.get_by_role("link", name=f"Chapter {numeral}: {title}", exact=True)
            _visible(page, link, "card")
            tap(link)
            radio = page.get_by_role("radio", name=_radio_name(sight, sight), exact=True)
            _visible(page, radio, "sightline viewpoint")
            tap(radio)
            enter = _button(page, "Enter chapter")
            _eventually(page, lambda: not _disabled(enter), "Enter chapter enabled")
            tap(enter)
            if n == 6:
                tap(_button(page, "Add rule"))
                rules = RULES_SEED["rules"] + [RULES_SEED["new_rule"]]
                k = sum(v != "Unclassified" for v in _classify(rules).values())
                _shows(page, _status(page, "Rule results"), f"{k} of 12 specimens classified.")
            elif n == 4:
                stiffness = page.get_by_role("slider", name="Stiffness", exact=True)
                _visible(page, stiffness, "Stiffness")
                stiffness.scroll_into_view_if_needed()
                box = stiffness.bounding_box()
                _touch_at(page, box["x"] + 2, box["y"] + box["height"] / 2)
                _shows(page, _status(page, "Sculpture state"), "Spring is overdamped.")
                tap(_button(page, "Pluck"))
            elif n == 7:
                tap(_button(page, "Point 1, Signal, at 7, 8"))
                tap(_button(page, "Move point left"))
                pts = _points(CLASSIFIER_SEED["training"])
                pts[0] = (6, 8, 1)
                acc, _ = _score(_train(pts))
                _shows(page, _status(page, "Classifier results"), f"Held-out accuracy {acc}%.")
                tap(_button(page, "Train"))
                model = _train(pts)
                _shows(page, _status(page, "Classifier results"), f"Training finished. Held-out accuracy {_score(model)[0]}% after {model[3]} epochs.")
            else:
                ctx = page.get_by_role("combobox", name="Context", exact=True)
                tap(ctx)
                select(ctx, "money")
                _shows(page, _status(page, "Neighbour results"), _neighbour_status("bank", "money"))
            layout(page)
    path = _ok(person.api.get("/api/me/path"), 200)["path"]
    assert {4, 6, 7, 8} <= set(path["resolved"])
    assert set(_pb("saved_paths", person.id)[0]["resolved"]) >= {4, 6, 7, 8}


def test_still_viewpoints(browser: Browser, app_url: str) -> None:
    for n in CHAPTERS:
        assert _get_json(app_url, f"/api/chapters/{n}")["chapter"]["viewpoints"] == _viewpoints(CHAPTERS[n][2])
    numeral, title, sight = CHAPTERS[1]
    names = [_radio_name(v, sight) for v in _viewpoints(sight)]
    for mode in ("reduced", "switch", "no_webgl"):
        options: dict[str, Any] = {"reduced_motion": "reduce"} if mode == "reduced" else {"no_webgl": True} if mode == "no_webgl" else {}
        with open_app(browser, app_url + "/chapters/1", **options) as page:
            if mode == "switch":
                switch = page.get_by_role("switch", name="Motion", exact=True)
                _visible(page, switch, "Motion switch")
                click(switch)
            group = page.get_by_role("radiogroup", name="Viewpoints", exact=True)
            _visible(page, group, f"viewpoints ({mode})")
            radios = group.get_by_role("radio")
            assert radios.count() == len(BASE_VIEWPOINTS)
            for i, name in enumerate(names):
                assert radios.nth(i).evaluate("(e, other) => e === other", group.get_by_role("radio", name=name, exact=True).element_handle())
            assert _scene(page).count() == 0
            if mode == "no_webgl":
                _visible(page, page.get_by_text(COPY["no_webgl"], exact=True), "no-WebGL line")
            sight_radio = group.get_by_role("radio", name=names[_viewpoints(sight).index(sight)], exact=True)
            if mode == "reduced":
                click(_button(page, "Align"))
            elif mode == "switch":
                click(sight_radio)
            else:
                click(radios.nth(0))
                for _ in range(_viewpoints(sight).index(sight)):
                    page.keyboard.press("ArrowRight")
            _eventually(page, sight_radio.is_checked, "sightline radio checked")
            _shows(page, _status(page, "Sightline status"), f"Chapter {numeral} resolved.")
            _shows(page, page.get_by_role("meter", name="Alignment", exact=True), "Alignment 100%")
            _visible(page, page.get_by_role("heading", level=1, name=title, exact=True), "title heading")
            assert not _disabled(_button(page, "Enter chapter"))


MORPH_PROBE = """(() => {
  window.__morphs = [];
  const note = (kind, a) => {
    const effect = a.effect;
    if (!effect || !effect.getComputedTiming) return;
    const timing = effect.getComputedTiming();
    const target = effect.target;
    window.__morphs.push({kind, text: target ? (target.textContent || '').trim() : '', pseudo: effect.pseudoElement || '', end: Number.isFinite(timing.endTime) ? timing.endTime : 1e12});
  };
  const sweep = kind => document.getAnimations().forEach(a => note(kind, a));
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = animate.apply(this, args); note('waapi', a); return a; };
  for (const type of ['transitionrun', 'animationstart']) document.addEventListener(type, () => sweep(type), true);
  if (document.startViewTransition) {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => { const vt = start(...args); vt.ready.then(() => sweep('view-transition'), () => {}); return vt; };
  }
  window.addEventListener('pagereveal', e => { if (e.viewTransition) e.viewTransition.ready.then(() => sweep('view-transition'), () => {}); });
})();"""

NUMERAL_RECTS = """(text) => {
  window.__numeralIds = window.__numeralIds || new WeakMap();
  window.__numeralNext = window.__numeralNext || 0;
  const ids = window.__numeralIds;
  const out = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || node.data.trim() !== text || el.textContent.trim() !== text) continue;
    if (!ids.has(el)) ids.set(el, ++window.__numeralNext);
    const r = el.getBoundingClientRect();
    out[ids.get(el)] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  }
  return out;
}"""


def test_numeral_morph(browser: Browser, app_url: str) -> None:
    numeral = CHAPTERS[4][0]
    step = MORPH_SAMPLE_MS / MORPH_SAMPLES
    for reduced in (False, True):
        with open_app(browser, app_url + "/", reduced_motion="reduce" if reduced else "no-preference") as page:
            page.add_init_script(script=MORPH_PROBE)
            page.reload()
            link = page.get_by_role("link", name=_card(4), exact=True)
            _visible(page, link, "card")
            click(link)
            _eventually(page, lambda: urlparse(page.url).path == "/chapters/4", "chapter IV page", step_ms=0)
            page.wait_for_load_state("domcontentloaded")
            samples = []
            for _ in range(MORPH_SAMPLES + 1):
                samples.append(page.evaluate(NUMERAL_RECTS, numeral))
                advance(page, step)
            records = [r for r in page.evaluate("() => window.__morphs || []") if r["text"] == numeral or r["pseudo"].startswith("::view-transition")]
            longest = max((r["end"] for r in records), default=0)
            moving = [i for i in range(1, len(samples)) if any(k in samples[i - 1] and samples[i - 1][k] != v for k, v in samples[i].items())]
            if reduced:
                assert longest < MORPH_MIN_MS, records
                assert len(moving) < 3, f"numeral moved under reduced motion at steps {moving}"
                continue
            if MORPH_MIN_MS <= longest <= MORPH_MAX_MS:
                continue
            assert longest < MORPH_MIN_MS, f"numeral morph lasts {longest} ms"
            assert len(moving) >= 3, "the numeral did not morph into the header"
            assert MORPH_MIN_MS - step <= moving[-1] * step <= MORPH_MAX_MS + step, moving


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_scene_layout(browser: Browser, app_url: str, viewport: str) -> None:
    width, height = VIEWPORTS[viewport]
    with open_app(browser, app_url + "/chapters/1") as page:
        page.set_viewport_size({"width": width, "height": height})
        slider = _scene(page)
        _visible(page, slider, "scene")
        box = slider.bounding_box()
        if viewport == "desktop":
            assert box["x"] >= FRAME_INSET and width - (box["x"] + box["width"]) >= FRAME_INSET, box
        else:
            assert abs(box["x"]) <= 1 and abs(box["x"] + box["width"] - width) <= 1, box
        rail, sheet_button = page.get_by_role("navigation", name="Chapters", exact=True), _button(page, "Chapters")
        if viewport == "phone":
            _visible(page, sheet_button, "Chapters button")
            b = sheet_button.bounding_box()
            assert b["y"] > height / 2 and b["y"] + b["height"] <= height
            assert rail.count() == 0 or not rail.is_visible()
            click(sheet_button)
            sheet = _dialog(page, "Chapters")
            _visible(page, sheet, "Chapters sheet")
            for numeral, _, _ in CHAPTERS.values():
                assert sheet.get_by_role("link", name=f"Chapter {numeral}", exact=True).count() == 1
            assert sheet.get_by_role("link", name=f"Chapter {CHAPTERS[1][0]}", exact=True).get_attribute("aria-current")
            page.keyboard.press("Escape")
            _gone(page, sheet, "sheet closed")
        else:
            assert sheet_button.count() == 0
            _visible(page, rail, "rail")
            r = rail.bounding_box()
            assert rail.get_by_role("link", name=f"Chapter {CHAPTERS[1][0]}", exact=True).get_attribute("aria-current")
            if viewport == "tablet":
                assert r["width"] > r["height"] and r["y"] <= box["y"]
            else:
                assert r["height"] > r["width"] and r["x"] > width / 2 and abs(width - (r["x"] + r["width"])) <= FRAME_INSET
        layout(page)


def test_closed_panels_unavailable(browser: Browser, app_url: str) -> None:
    narration = _get_json(app_url, _chapter_api(1))["chapter"]["narration"] or {}
    snippet = " ".join((narration.get("transcript") or "").split()[:4])
    tiers = {"Reader", "Fellow", "Patron", "Join", "Sign in to join"}
    for viewport, (width, height) in VIEWPORTS.items():
        with open_app(browser, app_url + "/chapters/1") as page:
            page.set_viewport_size({"width": width, "height": height})
            transcript = _button(page, "Transcript")
            _visible(page, transcript, "Transcript button")
            assert transcript.get_attribute("aria-expanded") == "false"
            forbidden = set(tiers) | {"Email", "Password"}
            if viewport == "phone":
                assert page.get_by_role("navigation", name="Main", exact=True).count() == 0
                assert page.get_by_role("link", name="Timeline", exact=True).count() == 0
                forbidden |= {"Timeline", "Sources"} | {f"Chapter {c[0]}" for c in CHAPTERS.values()}
            names = set(tab_order(page, TAB_SWEEP))
            assert not names & forbidden, names & forbidden
            layout(page)
            click(_button(page, "Support"))
            _visible(page, _dialog(page, "Supporter plan"), "plan dialog")
            page.keyboard.press("Escape")
            assert page.get_by_role("radio", name="Patron", exact=True).count() == 0
            assert not set(tab_order(page, 5)) & tiers
            if snippet:
                shown = page.get_by_text(snippet)

                def copies() -> int:
                    return sum(shown.nth(i).is_visible() for i in range(shown.count()))

                collapsed = copies()
                click(transcript)
                _eventually(page, lambda: copies() > collapsed, "the transcript shown once opened")
                click(transcript)
                _eventually(page, lambda: transcript.get_attribute("aria-expanded") == "false" and copies() == collapsed,
                            "the transcript hidden again")


def test_rule_engine(browser: Browser, app_url: str) -> None:
    assert _get_json(app_url, "/api/exhibits/rules") == RULES_SEED
    with open_app(browser, app_url + "/chapters/6") as page:
        _enter_chapter(page)
        status, table = _status(page, "Rule results"), page.get_by_role("table", name="Specimens", exact=True)
        url = page.url
        rules = [dict(r) for r in RULES_SEED["rules"]]

        def verify() -> None:
            expected = _classify(rules)
            k = sum(v != "Unclassified" for v in expected.values())
            _shows(page, status, f"{k} of 12 specimens classified.")
            for name, label in expected.items():
                _eventually(page, lambda: _row_last(_row(table, name)).casefold() == label.casefold(), f"{name} → {label}")

        click(_button(page, "Add rule"))
        rules.append(dict(RULES_SEED["new_rule"]))
        verify()
        fill(page.get_by_role("group", name=f"Rule {len(rules)}", exact=True).get_by_role("spinbutton", name="Value", exact=True), "0")
        rules[3]["value"] = 0
        verify()
        first = page.get_by_role("group", name=f"Rule {1}", exact=True)
        select(first.get_by_role("combobox", name="Attribute", exact=True), "Wings")
        select(first.get_by_role("combobox", name="Value", exact=True), "Yes")
        rules[0] = {"attribute": "wings", "value": True, "label": "Bird"}
        verify()
        select(page.get_by_role("group", name=f"Rule {2}", exact=True).get_by_role("combobox", name="Label", exact=True), "Arachnid")
        rules[1]["label"] = "Arachnid"
        verify()
        click(_button(page, "Remove rule 4"))
        rules.pop(3)
        verify()
        add = _button(page, "Add rule")
        while len(rules) < RULES_SEED["max_rules"]:
            assert not _disabled(add)
            click(add)
            rules.append(dict(RULES_SEED["new_rule"]))
        verify()
        _eventually(page, lambda: _disabled(add), "Add rule disabled at six")
        assert page.url == url


def _confusion(page: Page, counts: dict[str, tuple[int, int]]) -> None:
    table = page.get_by_role("table", name="Confusion counts", exact=True)
    for row, values in counts.items():
        _eventually(page, lambda: _row_ints(_row(table, row))[-2:] == values, f"{row} {values}")


def test_classifier(browser: Browser, app_url: str) -> None:
    assert _get_json(app_url, "/api/exhibits/classifier") == CLASSIFIER_SEED
    points = _points(CLASSIFIER_SEED["training"])
    with open_app(browser, app_url + "/chapters/7") as page:
        _enter_chapter(page)
        status = _status(page, "Classifier results")
        click(_button(page, "Train"))
        model = _train(points)
        acc, counts = _score(model)
        _shows(page, status, f"Training finished. Held-out accuracy {acc}% after {model[3]} epochs.", seconds=UI_WAIT_S + model[3] * EPOCH_MS / 1000)
        _visible(page, page.get_by_text(f"Held-out accuracy {acc}%", exact=True), "accuracy text")
        _confusion(page, counts)
        point = _button(page, "Point 1, Signal, at 7, 8")
        click(point)
        _eventually(page, lambda: _button(page, "Point 1, Signal, at 7, 8").get_attribute("aria-pressed") == "true", "point selected")
        click(_button(page, "Move point left"))
        points[0] = (6, 8, 1)
        acc, counts = _score(_train(points))
        _shows(page, status, f"Held-out accuracy {acc}%.")
        _confusion(page, counts)
        moved = _button(page, "Point 1, Signal, at 6, 8")
        _visible(page, moved, "renamed point")
        moved.focus()
        page.keyboard.press("ArrowRight")
        points[0] = (7, 8, 1)
        _shows(page, status, f"Held-out accuracy {_score(_train(points))[0]}%.")
        click(_button(page, "Point 3, Signal, at 9, 9"))
        for _ in range(2):
            click(_button(page, "Move point right"))
        _visible(page, _button(page, "Point 3, Signal, at 10, 9"), "clamped at 10")


def test_neighbours(browser: Browser, app_url: str) -> None:
    assert _get_json(app_url, "/api/exhibits/neighbours") == NEIGHBOURS_SEED
    with open_app(browser, app_url + "/chapters/8") as page:
        _enter_chapter(page)
        word, ctx = page.get_by_role("combobox", name="Word", exact=True), page.get_by_role("combobox", name="Context", exact=True)
        table, status = page.get_by_role("table", name="Neighbours", exact=True), _status(page, "Neighbour results")
        for w, c in (("bank", None), ("bank", "river"), ("bank", "money"), ("engine", None), ("memory", "engine")):
            select(word, w)
            select(ctx, c or "None")
            _shows(page, status, _neighbour_status(w, c))
            rows = table.get_by_role("row")
            for i, (near, sim) in enumerate(_neighbours(w, c)):
                _eventually(page, lambda: near in _txt(rows.nth(rows.count() - 3 + i)) and sim in _txt(rows.nth(rows.count() - 3 + i)), f"{near} {sim}")


def test_spring_sculpture(browser: Browser, app_url: str) -> None:
    assert _get_json(app_url, "/api/exhibits/spring") == SPRING_SEED
    k, c = SPRING_SEED["stiffness"]["initial"], SPRING_SEED["damping"]["initial"]
    with open_app(browser, app_url + "/chapters/4") as page:
        _enter_chapter(page)
        status = _status(page, "Sculpture state")
        damping, stiffness = page.get_by_role("slider", name="Damping", exact=True), page.get_by_role("slider", name="Stiffness", exact=True)
        damping.focus()
        page.keyboard.press("ArrowRight")
        _shows(page, status, _regime(k, c + 1))
        for _ in range(7):
            page.keyboard.press("ArrowLeft")
        c -= 6
        _shows(page, status, _regime(k, c))
        stiffness.focus()
        for _ in range(7):
            page.keyboard.press("ArrowLeft")
        k -= 70
        _shows(page, status, _regime(k, c))
        assert _regime(k, c) == "Spring is critically damped."
        pause = _button(page, "Pause plates")
        if pause.count():
            click(pause)
        pluck = _button(page, "Pluck")
        _to_middle(pluck)
        advance(page, AT_ONCE_MS)
        box = _sculpture_box(pluck)
        rest = _region_shot(page, box)
        click(pluck)
        advance(page, EPOCH_MS)
        changed(rest, _region_shot(page, box))
        advance(page, SPRING_REST_MS)
        _still(page, box)
        settled = _region_shot(page, box)
        advance(page, EPOCH_MS * 2)
        assert difference(settled, _region_shot(page, box)) == 0, "sculpture still moving after 4 s"
    with open_app(browser, app_url + "/chapters/4", reduced_motion="reduce") as page:
        _enter_chapter(page)
        pluck = _button(page, "Pluck")
        _to_middle(pluck)
        box = _sculpture_box(pluck)
        click(pluck)
        advance(page, AT_ONCE_MS)
        first = _region_shot(page, box)
        advance(page, SPRING_REST_MS)
        assert difference(first, _region_shot(page, box)) == 0, "Pluck animated under reduced motion"


def test_wf_exhibits_keyboard(browser: Browser, app_url: str) -> None:
    person = _visitor(app_url)
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        _sign_cookie(page, app_url, person, "/")
        for n in (4, 6, 7, 8):
            page.goto(f"{app_url}/chapters/{n}")
            slider = _scene(page)
            _visible(page, slider, "slider")
            _tab_to(page, slider)
            page.keyboard.press("a")
            enter = _button(page, "Enter chapter")
            _eventually(page, lambda: not _disabled(enter), "resolved")
            _tab_to(page, enter)
            page.keyboard.press("Enter")
            if n == 4:
                damping = page.get_by_role("slider", name="Damping", exact=True)
                _tab_to(page, damping)
                page.keyboard.press("ArrowRight")
                _shows(page, _status(page, "Sculpture state"), "Spring is overdamped.")
                _tab_to(page, page.get_by_role("slider", name="Stiffness", exact=True), back=True)
                page.keyboard.press("End")
                _shows(page, _status(page, "Sculpture state"), _regime(SPRING_SEED["stiffness"]["max"], SPRING_SEED["damping"]["initial"] + 1))
                _tab_to(page, _button(page, "Pluck"))
                page.keyboard.press("Enter")
            elif n == 6:
                _tab_to(page, _button(page, "Add rule"))
                page.keyboard.press("Enter")
                rules = RULES_SEED["rules"] + [RULES_SEED["new_rule"]]
                _shows(page, _status(page, "Rule results"), f"{sum(v != 'Unclassified' for v in _classify(rules).values())} of 12 specimens classified.")
                value = page.get_by_role("group", name=f"Rule {len(rules)}", exact=True).get_by_role("spinbutton", name="Value", exact=True)
                _tab_to(page, value, back=True)
                page.keyboard.press("ArrowDown")
                rules[-1] = {**rules[-1], "value": 3}
                _shows(page, _status(page, "Rule results"), f"{sum(v != 'Unclassified' for v in _classify(rules).values())} of 12 specimens classified.")
            elif n == 7:
                point = _button(page, "Point 1, Signal, at 7, 8")
                _tab_to(page, point)
                page.keyboard.press("Enter")
                page.keyboard.press("ArrowLeft")
                pts = _points(CLASSIFIER_SEED["training"])
                pts[0] = (6, 8, 1)
                _shows(page, _status(page, "Classifier results"), f"Held-out accuracy {_score(_train(pts))[0]}%.")
                _tab_to(page, _button(page, "Train"))
                page.keyboard.press("Enter")
                model = _train(pts)
                _shows(page, _status(page, "Classifier results"), f"Training finished. Held-out accuracy {_score(model)[0]}% after {model[3]} epochs.")
            else:
                allowed = {_neighbour_status(w["word"], c) for w in NEIGHBOURS_SEED["words"] for c in [None, *NEIGHBOURS_SEED["contexts"]]}
                for name in ("Word", "Context"):
                    box = page.get_by_role("combobox", name=name, exact=True)
                    _tab_to(page, box)
                    before = _txt(_status(page, "Neighbour results")) if _status(page, "Neighbour results").count() else ""
                    page.keyboard.press("ArrowDown")
                    page.keyboard.press("Enter")
                    _eventually(page, lambda: _txt(_status(page, "Neighbour results")) in allowed and _txt(_status(page, "Neighbour results")) != before, f"{name} changed by keyboard")
    path = _ok(person.api.get("/api/me/path"), 200)["path"]
    assert {4, 6, 7, 8} <= set(path["resolved"]) and path["last_chapter"] == 8 and path["last_exhibit"] == "neighbours"


def test_wf_exhibits_signed_in_position(browser: Browser, app_url: str) -> None:
    person = _visitor(app_url)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/chapters/6")
        _enter_chapter(page)
        _poll(lambda: (_pb("saved_paths", person.id) or [{}])[0].get("last_chapter") == 6, UI_WAIT_S, "last chapter 6")
        assert _pb("saved_paths", person.id)[0]["last_exhibit"] == ""
        click(_button(page, "Add rule"))
        _poll(lambda: _pb("saved_paths", person.id)[0]["last_exhibit"] == "rules", UI_WAIT_S, "last exhibit rules")
        page.goto(app_url + "/chapters/3")
        click(_button(page, "Align"))
        _shows(page, _status(page, "Sightline status"), "Chapter III resolved.")
    path = _ok(person.api.get("/api/me/path"), 200)["path"]
    assert path["last_chapter"] == 6 and 3 not in path["resolved"]


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_columns(browser: Browser, app_url: str, viewport: str) -> None:
    width, height = VIEWPORTS[viewport]

    def check_grid(boxes: list[dict]) -> None:
        lefts = sorted({round(b["x"]) for b in boxes})
        assert len([x for i, x in enumerate(lefts) if i == 0 or x - lefts[i - 1] > 2]) == COLUMNS[viewport], lefts
        for a, b in zip(boxes, boxes[1:]):
            same_row = abs(a["y"] - b["y"]) <= 2
            assert (same_row and b["x"] > a["x"]) or (not same_row and b["y"] > a["y"]), (a, b)

    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": width, "height": height})
        links = [page.get_by_role("link", name=f"Chapter {c[0]}: {c[1]}", exact=True) for c in CHAPTERS.values()]
        _visible(page, links[-1], "cards")
        check_grid([link.bounding_box() for link in links])
        layout(page)
        events = _get_json(app_url, "/api/timeline")["events"][:6]
        page.goto(app_url + "/timeline")
        region = page.get_by_role("region", name="Search results", exact=True)
        titles = [region.get_by_text(e["title"], exact=True).first for e in events]
        _visible(page, titles[-1], "timeline cards")
        check_grid([t.bounding_box() for t in titles])
        layout(page)


def test_timeline_search_sources(browser: Browser, app_url: str) -> None:
    ines = _staff(app_url, INES)
    title = f"Draft only {_tag()}"
    _event(ines, 1, title, ("src-1",))
    events = _get_json(app_url, "/api/timeline")["events"]
    assert [(e["year"], e["title"]) for e in events] == sorted((e["year"], e["title"]) for e in events)
    assert title not in [e["title"] for e in events] and "ev-1958-perceptron" in [e["id"] for e in events]
    seven = _get_json(app_url, "/api/timeline", chapter=7)["events"]
    assert seven and all(e["chapter"] == 7 for e in seven)
    results = _get_json(app_url, "/api/search", q="perceptron")["results"]
    ids = [r["id"] for r in results]
    assert ids[0] == _chapter_id(7) and ids.index("ev-1958-perceptron") < ids.index("ev-1969-perceptrons-book")
    assert _get_json(app_url, f"/api/search?q={title.split()[-1]}")["results"] == []
    api = Api(app_url)
    for params, field in (({"q": "p"}, "q"), ({"q": "p" * 101}, "q"), ({"q": "perceptron", "chapter": "9"}, "chapter")):
        assert field in _err(api.get("/api/search", **params), 422, "validation_failed", COPY["validation"])["fields"]
    assert "chapter" in _err(api.get("/api/timeline", chapter="VII"), 422, "validation_failed")["fields"]
    sources = _get_json(app_url, "/api/sources")["sources"]
    numbers = [int(s["id"].split("-")[1]) for s in sources]
    assert numbers == sorted(numbers) and sources[0]["id"] == "src-1"
    by_id = {s["id"]: s for s in sources}
    assert "ev-1843-lovelace-notes" in by_id["src-1"]["cited_by"] and "ev-1958-perceptron" in by_id["src-6"]["cited_by"]
    with open_app(browser, app_url + "/timeline") as page:
        box = page.get_by_role("searchbox", name="Search the archive", exact=True)
        _visible(page, box, "search box")
        box.type("perceptron")
        advance(page, DEBOUNCE_MS)
        _shows(page, _status(page, "Search status"), f'{len(results)} results for "perceptron".')
        _includes(page, page.get_by_role("region", name="Search results", exact=True), "The limits, in print")
        page.goto(app_url + "/sources")
        _visible(page, page.get_by_text(by_id["src-6"]["citation"]), "citation")


def test_bookmarks(browser: Browser, app_url: str) -> None:
    a, b = _visitor(app_url), _visitor(app_url)
    first = _ok(a.api.post("/api/me/bookmarks", {"target_type": "chapter", "target_id": "chapter-4"}), 201)["bookmark"]
    again = _ok(a.api.post("/api/me/bookmarks", {"target_type": "chapter", "target_id": "chapter-4"}), 200)["bookmark"]
    assert again["id"] == first["id"] and first["title"] == CHAPTERS[4][1]
    event = _ok(a.api.post("/api/me/bookmarks", {"target_type": "event", "target_id": "ev-1958-perceptron"}), 201)["bookmark"]
    listed = _ok(a.api.get("/api/me/bookmarks"), 200)["bookmarks"]
    assert [x["id"] for x in listed] == [event["id"], first["id"]]
    assert {r["target_id"] for r in _pb("bookmarks", a.id)} == {"chapter-4", "ev-1958-perceptron"}
    _err(a.api.post("/api/me/bookmarks", {"target_type": "event", "target_id": f"ev-missing-{_tag()}"}), 404, "not_found")
    _err(b.api.delete(f"/api/me/bookmarks/{event['id']}"), 404, "not_found")
    assert _ok(a.api.delete(f"/api/me/bookmarks/{event['id']}"), 204) is None
    assert {r["target_id"] for r in _pb("bookmarks", a.id)} == {"chapter-4"}
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, b, "/chapters/4")
        toggle = _button(page, "Bookmark chapter")
        _visible(page, toggle, "Bookmark chapter")
        assert toggle.get_attribute("aria-pressed") == "false"
        click(toggle)
        _includes(page, _status(page, "Notices"), f"Bookmarked {CHAPTERS[4][1]}.")
        _eventually(page, lambda: toggle.get_attribute("aria-pressed") == "true", "pressed")
        _poll(lambda: [r["target_id"] for r in _pb("bookmarks", b.id)] == ["chapter-4"], UI_WAIT_S, "PocketBase bookmark")
        page.goto(app_url + "/account")
        _includes(page, page.get_by_role("region", name="Bookmarks", exact=True), CHAPTERS[4][1])
        page.goto(app_url + "/chapters/4")
        toggle = _button(page, "Bookmark chapter")
        _eventually(page, lambda: toggle.get_attribute("aria-pressed") == "true", "the saved bookmark shown pressed")
        click(toggle)
        _includes(page, _status(page, "Notices"), "Bookmark removed.")
        _poll(lambda: _pb("bookmarks", b.id) == [], UI_WAIT_S, "bookmark removed in PocketBase")


def test_withdrawn_disappears(browser: Browser, app_url: str) -> None:
    ines, priya, tomas = _staff(app_url, INES), _staff(app_url, PRIYA), _staff(app_url, TOMAS)
    visitor = _visitor(app_url)
    title = f"Withdrawn soon {_tag()}"
    item = _event(ines, 1, title, ("src-2",))
    media = _ok(_upload(ines.api, item["id"], "image", f"w-{_tag()}.png", _png(1), "image/png"), 201)["media"]
    _publish(ines, tomas, item["id"])
    _ok(visitor.api.post("/api/me/bookmarks", {"target_type": "event", "target_id": item["id"]}), 201)
    _ok(visitor.api.post("/api/me/bookmarks", {"target_type": "chapter", "target_id": "chapter-5"}), 201)
    _ok(visitor.api.post("/api/me/path/resolved", {"chapter": 5}), 200)
    assert visitor.api.get(f"/api/media/{media['id']}").status_code == 302
    _ok(_move(ines.api, item["id"], "withdrawn", reason=REASON), 200)
    assert item["id"] not in [e["id"] for e in _get_json(app_url, "/api/timeline")["events"]]
    assert _get_json(app_url, f"/api/search?q={title.split()[-1]}")["results"] == []
    assert item["id"] not in {i for s in _get_json(app_url, "/api/sources")["sources"] for i in s["cited_by"]}
    _err(visitor.api.get(f"/api/media/{media['id']}"), 404, "not_found")
    try:
        _ok(_move(priya.api, "chapter-5", "withdrawn", reason=REASON), 200)
        assert 5 not in [c["number"] for c in _get_json(app_url, "/api/chapters")["chapters"]]
        _err(Api(app_url).get(_chapter_api(5)), 404, "not_found")
        assert _chapter_id(5) not in [r["id"] for r in _get_json(app_url, "/api/search", q="Imitation")["results"]]
        marks = {x["target_id"] for x in _ok(visitor.api.get("/api/me/bookmarks"), 200)["bookmarks"]}
        assert not marks & {item["id"], _chapter_id(5)}
        assert 5 not in _ok(visitor.api.get("/api/me/path"), 200)["path"]["resolved"]
        assert 5 in _pb("saved_paths", visitor.id)[0]["resolved"]
        assert {_chapter_id(5), item["id"]} <= {r["target_id"] for r in _pb("bookmarks", visitor.id)}
        with open_app(browser, app_url + "/") as page:
            _visible(page, page.get_by_role("link", name=_card(4), exact=True), "index")
            assert page.get_by_role("link", name=_card(5), exact=True).count() == 0
            response = page.goto(app_url + "/chapters/5")
            assert response and response.status == 404
            _visible(page, page.get_by_role("heading", name=COPY["not_found_heading"], exact=True), "not-found heading")
            page.goto(app_url + "/chapters/4")
            rail = page.get_by_role("navigation", name="Chapters", exact=True)
            _visible(page, rail, "rail")
            assert rail.get_by_role("link", name=f"Chapter {CHAPTERS[5][0]}", exact=True).count() == 0
    finally:
        if _item(priya.api, "chapter-5")["status"] == "withdrawn":
            _ok(_move(priya.api, "chapter-5", "draft"), 200)
        _publish(priya, tomas, "chapter-5")
    assert 5 in _ok(visitor.api.get("/api/me/path"), 200)["path"]["resolved"]


def test_empty_and_not_found(browser: Browser, app_url: str) -> None:
    assert _get_json(app_url, "/api/timeline?chapter=8")["events"] == [], "chapter VIII must hold no published events"
    priya = _staff(app_url, PRIYA)
    with open_app(browser, app_url + "/timeline") as page:
        _choose(page.get_by_role("combobox", name="Chapter", exact=True), "Chapter VIII")
        _includes(page, page.get_by_role("region", name="Search results", exact=True), COPY["empty_events"])
        page.goto(app_url + "/chapters/8")
        _visible(page, page.get_by_text(COPY["empty_events"], exact=True), "chapter page empty copy")
        for path in ("/no-such-room", "/chapters/9"):
            response = page.goto(app_url + path)
            assert response and response.status == 404
            _visible(page, page.get_by_role("heading", name=COPY["not_found_heading"], exact=True), "not-found heading")
        _sign_cookie(page, app_url, priya, "/studio")
        _includes(page, page.get_by_role("region", name=f"Chapter {CHAPTERS[8][0]} events", exact=True), COPY["empty_events"])


def test_search_latest_wins(browser: Browser, app_url: str) -> None:
    count = len(_get_json(app_url, "/api/search?q=logic")["results"])
    expected = '1 result for "logic".' if count == 1 else f'{count} results for "logic".'
    stale: list[Any] = []
    with open_app(browser, app_url + "/timeline") as page:

        def handler(route: Any) -> None:
            if parse_qs(urlparse(route.request.url).query).get("q") == ["lo"]:
                stale.append(route)
            else:
                route.continue_()

        page.route(lambda url: urlparse(url).path == "/api/search", handler)
        settled: list[str] = []
        is_lo = lambda r: urlparse(r.url).path == "/api/search" and parse_qs(urlparse(r.url).query).get("q") == ["lo"]
        page.on("requestfinished", lambda r: settled.append("finished") if is_lo(r) else None)
        page.on("requestfailed", lambda r: settled.append("aborted") if is_lo(r) else None)
        box = page.get_by_role("searchbox", name="Search the archive", exact=True)
        _visible(page, box, "search box")
        box.type("lo")
        advance(page, DEBOUNCE_MS)
        _eventually(page, lambda: stale, "held stale request")
        box.type("gic")
        advance(page, DEBOUNCE_MS)
        status, region = _status(page, "Search status"), page.get_by_role("region", name="Search results", exact=True)
        _shows(page, status, expected)
        with suppress(Exception):
            stale[0].continue_()
        _eventually(page, lambda: settled, "superseded search finished or aborted")
        advance(page, DEBOUNCE_MS)
        _shows(page, status, expected)
        _includes(page, region, "Logic becomes algebra")
        assert "Notes that outgrow their source" not in _txt(region)


def test_search_in_address(browser: Browser, app_url: str) -> None:
    results = _get_json(app_url, "/api/search?q=perceptron&chapter=7")["results"]
    with open_app(browser, app_url + "/timeline?q=perceptron&chapter=7") as page:
        box, chapter = page.get_by_role("searchbox", name="Search the archive", exact=True), page.get_by_role("combobox", name="Chapter", exact=True)
        _eventually(page, lambda: box.input_value() == "perceptron", "query restored")
        assert _combo_label(chapter) == "Chapter VII"
        _shows(page, _status(page, "Search status"), f'{len(results)} results for "perceptron".')
        history = page.evaluate("() => history.length")
        _choose(chapter, "All chapters")
        _eventually(page, lambda: parse_qs(urlparse(page.url).query) == {"q": ["perceptron"]}, "chapter dropped")
        box.fill("")
        box.type("logic")
        advance(page, DEBOUNCE_MS)
        _eventually(page, lambda: parse_qs(urlparse(page.url).query) == {"q": ["logic"]}, "q=logic")
        box.fill("l")
        advance(page, DEBOUNCE_MS)
        _eventually(page, lambda: urlparse(page.url).query == "", "short query dropped")
        assert page.evaluate("() => history.length") == history
        assert _txt(_status(page, "Search status")) == ""


def test_wf_archive_search_share(browser: Browser, app_url: str) -> None:
    expected = [r["title"] for r in _get_json(app_url, "/api/search?q=perceptron&chapter=7")["results"]]
    with open_app(browser, app_url + "/timeline") as page:
        box = page.get_by_role("searchbox", name="Search the archive", exact=True)
        _visible(page, box, "search box")
        box.type("perceptron")
        advance(page, DEBOUNCE_MS)
        _choose(page.get_by_role("combobox", name="Chapter", exact=True), "Chapter VII")
        _eventually(page, lambda: parse_qs(urlparse(page.url).query) == {"q": ["perceptron"], "chapter": ["7"]}, "address")
        shared = page.url
        region = page.get_by_role("region", name="Search results", exact=True)
        for t in expected:
            _includes(page, region, t)
    with open_app(browser, shared) as friend:
        _shows(friend, _status(friend, "Search status"), f'{len(expected)} results for "perceptron".')
        for t in expected:
            _includes(friend, friend.get_by_role("region", name="Search results", exact=True), t)


def test_wf_archive_bookmark(browser: Browser, app_url: str) -> None:
    person = _visitor(app_url)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/timeline")
        toggle = _button(page, "Bookmark Logic becomes algebra")
        _visible(page, toggle, "event bookmark")
        click(toggle)
        _includes(page, _status(page, "Notices"), "Bookmarked Logic becomes algebra.")
        _eventually(page, lambda: toggle.get_attribute("aria-pressed") == "true", "pressed")
        _poll(lambda: [r["target_id"] for r in _pb("bookmarks", person.id)] == ["ev-1854-laws-of-thought"], UI_WAIT_S, "PocketBase")
        page.goto(app_url + "/account")
        _includes(page, page.get_by_role("region", name="Bookmarks", exact=True), "Logic becomes algebra")
        page.goto(app_url + "/timeline")
        click(_button(page, "Bookmark Logic becomes algebra"))
        _includes(page, _status(page, "Notices"), "Bookmark removed.")
    _poll(lambda: _pb("bookmarks", person.id) == [], UI_WAIT_S, "bookmark gone")


def test_register_and_signin(app_url: str) -> None:
    name, email = _names()
    api = Api(app_url)
    response = api.post("/api/auth/register", {"name": name, "email": email, "password": PASSWORD})
    user = _ok(response, 201)["user"]
    assert user["role"] == "visitor" and user["email"] == email and user["name"] == name
    cookie = " ".join(response.headers.get_list("set-cookie")).lower()
    for flag in ("sl_session", "HttpOnly", "SameSite=Lax"):
        assert flag.lower() in cookie, flag
    record = PocketBase().records("users", f'email = "{email}"')
    assert [r["id"] for r in record] == [user["id"]] and record[0]["role"] == "visitor"
    _err(Api(app_url).post("/api/auth/register", {"name": name, "email": email, "password": PASSWORD}), 409, "email_taken", COPY["email_taken"])
    fields = _err(Api(app_url).post("/api/auth/register", {"name": "", "email": "nope", "password": "short"}), 422, "validation_failed", COPY["validation"])["fields"]
    assert fields == {"name": COPY["name"], "email": COPY["email"], "password": COPY["password"]}
    _err(Api(app_url).post("/api/auth/login", {"email": email, "password": PASSWORD + "x"}), 401, "invalid_credentials", COPY["wrong_credentials"])
    me = _ok(api.get("/api/me"), 200)
    assert me["user"]["id"] == user["id"]
    assert _ok(api.post("/api/auth/logout"), 204) is None
    _err(api.get("/api/me"), 401, "unauthenticated", COPY["unauthenticated"])
    ines, marta = _staff(app_url, INES), _staff(app_url, MARTA)
    assert ines.user["role"] == "curator" and marta.user["role"] == "manager" and _staff(app_url, TOMAS).user["role"] == "lead_curator"
    _err(ines.api.get("/api/manager/orders"), 403, "forbidden", COPY["forbidden"])
    _ok(marta.api.get("/api/manager/orders"), 200)
    _err(marta.api.get("/api/curator/items"), 403, "forbidden")
    visitor = _staff(app_url, email)
    _err(visitor.api.get("/api/curator/items"), 403, "forbidden")


def test_motion_sound_preferences(browser: Browser, app_url: str) -> None:
    person = _visitor(app_url)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/chapters/2")
        motion_, sound = page.get_by_role("switch", name="Motion", exact=True), page.get_by_role("switch", name="Sound", exact=True)
        _visible(page, motion_, "Motion switch")
        assert motion_.is_checked() and not sound.is_checked()
        click(motion_)
        _visible(page, page.get_by_role("radiogroup", name="Viewpoints", exact=True), "still viewpoints at once")
        click(sound)
        _poll(lambda: [(r["motion"], r["sound"]) for r in _pb("preferences", person.id)] == [(False, True)], UI_WAIT_S, "PocketBase preferences")
        page.reload()
        _eventually(page, lambda: not motion_.is_checked() and sound.is_checked(), "persisted switches")
        _visible(page, page.get_by_role("radiogroup", name="Viewpoints", exact=True), "still mode after reload")
    assert _ok(person.api.get("/api/me"), 200)["preferences"] == {"motion": False, "sound": True}
    _err(person.api.put("/api/me/preferences", {"motion": "no", "sound": True}), 422, "validation_failed")


def test_me_request_scoped(app_url: str) -> None:
    a, b = _visitor(app_url), _visitor(app_url)
    plan = {a.email: (a, False, True, 1, "chapter-3"), b.email: (b, False, False, 2, "chapter-6")}
    defaults = {"motion": True, "sound": False}

    def first_writes(p: Person, mo: bool, so: bool, ch: int, target: str) -> None:
        _ok(p.api.at(app_url).put("/api/me/preferences", {"motion": mo, "sound": so}), 200)
        _ok(p.api.at(app_url).post("/api/me/path/resolved", {"chapter": ch}), 200)
        _ok(p.api.at(app_url).post("/api/me/bookmarks", {"target_type": "chapter", "target_id": target}), 201)

    def sign_in() -> None:
        _ok(Api(app_url).post("/api/auth/login", {"email": INES, "password": PASSWORD}), 200)

    with ThreadPoolExecutor(len(plan) + 2) as pool:
        lanes = [pool.submit(first_writes, *plan[email]) for email in plan] + [pool.submit(sign_in) for _ in range(2)]
        for lane in lanes:
            lane.result()
    calls: list[Callable[[], tuple[str, httpx.Response]]] = []
    for email, (p, mo, so, ch, target) in plan.items():
        for _ in range(6):
            calls.append(lambda p=p, mo=mo, so=so, e=email: (e, p.api.at(app_url).put("/api/me/preferences", {"motion": mo, "sound": so})))
            calls.append(lambda p=p, e=email: (e, p.api.at(app_url).get("/api/me")))
        calls.append(lambda p=p, ch=ch, e=email: (e, p.api.at(app_url).post("/api/me/path/resolved", {"chapter": ch})))
        calls.append(lambda p=p, t=target, e=email: (e, p.api.at(app_url).post("/api/me/bookmarks", {"target_type": "chapter", "target_id": t})))
    calls += [lambda: ("", Api(app_url).post("/api/auth/login", {"email": INES, "password": PASSWORD})) for _ in range(4)]
    for _ in range(SCOPE_ROUNDS):
        with ThreadPoolExecutor(len(calls)) as pool:
            results = list(pool.map(lambda f: f(), calls))
        for email, response in results:
            assert response.status_code < 300, response.text
            body = response.json() if response.content else {}
            if email and "user" in body:
                assert body["user"]["email"] == email
            if email and "preferences" in body:
                assert body["preferences"] in ({"motion": plan[email][1], "sound": plan[email][2]}, defaults), body
    for email, (p, mo, so, ch, target) in plan.items():
        assert [(r["motion"], r["sound"]) for r in _pb("preferences", p.id)] == [(mo, so)]
        assert _pb("saved_paths", p.id)[0]["resolved"] == [ch]
        assert [r["target_id"] for r in _pb("bookmarks", p.id)] == [target]
        assert _ok(p.api.get("/api/me/path"), 200)["path"]["resolved"] == [ch]


def test_accounts_outage(app_url: str) -> None:
    down = _outage("APP_POCKETBASE_DOWN_URL")
    person = _visitor(app_url)
    assert _get_json(down, "/api/health") == {"status": "ok"}
    assert len(_get_json(down, "/api/chapters")["chapters"]) >= len(CHAPTERS) - 1
    _ok(Api(down).get(_chapter_api(1)), 200)
    _err(Api(down).post("/api/auth/login", {"email": person.email, "password": PASSWORD}), 503, "accounts_unavailable", COPY["accounts_down"])
    name, email = _names()
    _err(Api(down).post("/api/auth/register", {"name": name, "email": email, "password": PASSWORD}), 503, "accounts_unavailable", COPY["accounts_down"])
    _err(person.api.at(down).post("/api/me/path/resolved", {"chapter": 2}), 503, "accounts_unavailable", COPY["accounts_down"])
    assert _pb("saved_paths", person.id) == []


def test_boot_accounts_down_recovers(app_url: str) -> None:
    relay = Relay(os.environ["POCKETBASE_URL"])
    try:
        with _app_copy({"POCKETBASE_URL": f"http://127.0.0.1:{relay.port}"}) as base:
            assert _get_json(base, "/api/health") == {"status": "ok"}
            _ok(Api(base).get("/api/chapters"), 200)
            _err(Api(base).post("/api/auth/login", {"email": INES, "password": PASSWORD}), 503, "accounts_unavailable", COPY["accounts_down"])
            relay.open()
            _poll(lambda: Api(base).post("/api/auth/login", {"email": INES, "password": PASSWORD}).status_code == 200, RECOVER_S + MAIL_SETTLE_S * 5, "accounts recovery")
    finally:
        relay.close()


def test_wf_accounts_register_ui(browser: Browser, app_url: str) -> None:
    name, email = _names()
    with open_app(browser, app_url + "/") as page:
        click(_button(page, "Sign in").first)
        click(_button(_dialog(page, "Sign in"), "Create an account"))
        dialog = _dialog(page, "Create an account")
        _visible(page, dialog, "register dialog")
        fill(_field(dialog, "Name"), name)
        fill(_field(dialog, "Email"), BAD_EMAIL)
        fill(_field(dialog, "Password"), PASSWORD)
        click(_button(dialog, "Create account"))
        link = dialog.get_by_role("alert").get_by_role("link", name=COPY["email"], exact=True)
        _visible(page, link, "error summary link")
        click(link)
        _eventually(page, lambda: _focused(_field(dialog, "Email")), "focus on email field")
        fill(_field(dialog, "Email"), email)
        click(_button(dialog, "Create account"))
        _visible(page, page.get_by_role("link", name="Account", exact=True), "signed in")
        _includes(page, page.get_by_role("banner"), name)
        click(_button(page, "Sign out"))
        _signin_ui(page, email)
        _includes(page, _status(page, "Notices"), f"Signed in as {name}.")
    record = PocketBase().records("users", f'email = "{email}"')
    assert len(record) == 1 and record[0]["name"] == name and record[0]["role"] == "visitor"


def test_wf_accounts_outage_ui(browser: Browser, app_url: str) -> None:
    down = _outage("APP_POCKETBASE_DOWN_URL")
    with open_app(browser, down + "/") as page:
        _visible(page, page.get_by_role("link", name=_card(1), exact=True), "index")
        click(_button(page, "Sign in").first)
        dialog = _dialog(page, "Sign in")
        fill(_field(dialog, "Email"), INES)
        fill(_field(dialog, "Password"), PASSWORD)
        click(_button(dialog, "Sign in"))
        _includes(page, dialog.get_by_role("alert"), COPY["accounts_down"])
        _includes(page, _status(page, "Service notice"), COPY["accounts_down"])
    _err(Api(down).post("/api/auth/login", {"email": INES, "password": PASSWORD}), 503, "accounts_unavailable")


def test_dialogs_keyboard(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/chapters/1") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        for opener_name, dialog_name in (("Sign in", "Sign in"), ("Support", "Supporter plan")):
            opener = _button(page, opener_name).first
            _visible(page, opener, opener_name)
            opener.focus()
            page.keyboard.press("Enter")
            dialog = _dialog(page, dialog_name)
            _visible(page, dialog, dialog_name)
            _eventually(page, lambda: _holds_focus(dialog), "focus moved into dialog")
            for key in ("Tab", "Shift+Tab"):
                for _ in range(TRAP_PRESSES):
                    page.keyboard.press(key)
                    assert _holds_focus(dialog), f"{key} left {dialog_name}"
            page.keyboard.press("Escape")
            _gone(page, dialog, f"{dialog_name} closed")
            _eventually(page, lambda: _focused(opener), "focus back on opener")
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        for name in ("Menu", "Chapters"):
            opener = _button(page, name)
            _visible(page, opener, name)
            opener.focus()
            page.keyboard.press("Enter")
            sheet = _dialog(page, name)
            _visible(page, sheet, f"{name} sheet")
            for _ in range(TRAP_PRESSES):
                page.keyboard.press("Tab")
                assert _holds_focus(sheet)
            page.keyboard.press("Escape")
            _gone(page, sheet, f"{name} closed")
            _eventually(page, lambda: _focused(opener), "focus back")


def test_sessions_server_status(browser: Browser, app_url: str) -> None:
    marta, buyer = _staff(app_url, MARTA), _visitor(app_url)
    now = _server_now(marta.api)
    on_sale = _new_session(marta, f"Open tour {_tag()}", _winter(marta.api), 2)
    closed = _new_session(marta, f"Closing tour {_tag()}", _iso(now + BOOKING_CLOSE - timedelta(minutes=1)), 3)
    assert on_sale["status"] == "on_sale" and closed["status"] == "closed"
    _ok(_book(buyer, on_sale["id"]), 201)
    assert _session_state(marta.api, on_sale["id"])["seats_left"] == 1
    for at in (FAR_DEVICE_TIME, PAST_DEVICE_TIME):
        with _device(browser, app_url + "/sessions", at=at) as page:
            open_card = page.get_by_role("article").filter(has_text=on_sale["title"])
            closed_card = page.get_by_role("article").filter(has_text=closed["title"])
            _visible(page, open_card, "on-sale card")
            for needle in ("On sale", "1 seat left", f"{_price(TICKET['EUR'], 'EUR')} a seat"):
                _includes(page, open_card, needle)
            assert _button(open_card, f"Book {on_sale['title']}").count() == 1
            for needle in ("Closed", "3 seats left"):
                _includes(page, closed_card, needle)
            assert _button(closed_card, f"Book {closed['title']}").count() == 0


def test_booking_closes(app_url: str, killbill: Any) -> None:
    marta, buyer = _staff(app_url, MARTA), _visitor(app_url)
    now = _server_now(marta.api)
    closed = _new_session(marta, f"Too late {_tag()}", _iso(now + BOOKING_CLOSE - timedelta(minutes=1)), 4)
    assert closed["status"] == "closed"
    assert datetime.fromisoformat(closed["booking_closes_at"]) == datetime.fromisoformat(closed["starts_at"]) - BOOKING_CLOSE
    _err(_book(buyer, closed["id"]), 409, "booking_closed", COPY["booking_closed"])
    assert _kb_txns(killbill, buyer.email) == []
    open_ = _new_session(marta, f"Just in time {_tag()}", _iso(now + BOOKING_CLOSE + timedelta(minutes=5)), 4)
    assert open_["status"] == "on_sale"
    _ok(_book(buyer, open_["id"]), 201)
    assert [t["minor"] for t in _kb_txns(killbill, buyer.email)] == [TICKET["EUR"]]


def test_last_seats_one_winner(app_url: str, killbill: Any) -> None:
    marta = _staff(app_url, MARTA)
    sess = _new_session(marta, f"Last seat {_tag()}", _winter(marta.api), 1)
    buyers = [_visitor(app_url) for _ in range(5)]
    results = _together(*[lambda p=p: _book(p, sess["id"]) for p in buyers])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409, 409]
    for person, response in zip(buyers, results):
        if response.status_code == 409:
            _err(response, 409, "sold_out", COPY["sold_out"])
            assert _kb_txns(killbill, person.email) == []
        else:
            assert [t["minor"] for t in _kb_txns(killbill, person.email)] == [TICKET["EUR"]]
    assert _session_state(marta.api, sess["id"])["seats_left"] == 0


def test_idempotency_rules(app_url: str, killbill: Any) -> None:
    marta, buyer, other = _staff(app_url, MARTA), _visitor(app_url), _visitor(app_url)
    sess = _new_session(marta, f"Idempotent {_tag()}", _winter(marta.api), 4)
    path, body = f"/api/sessions/{sess['id']}/bookings", {"seats": 1, "currency": "EUR", "card_number": APPROVED_CARD}
    tiers = _tiers(buyer.api)
    for p, b in ((path, body), ("/api/donations", {"amount_minor": DONATION_MIN, "currency": "EUR", "card_number": APPROVED_CARD}),
                 ("/api/me/membership", {"tier": tiers["Reader"], "currency": "EUR", "card_number": APPROVED_CARD}),
                 ("/api/me/membership/change", {"tier": tiers["Fellow"]}), ("/api/me/membership/cancel", {}),
                 ("/api/me/membership/undo", {}), ("/api/me/membership/retry", {})):
        _err(buyer.api.post(p, b), 400, "idempotency_key_required", COPY["key_required"])
    _err(marta.api.post(f"/api/manager/sessions/{sess['id']}/cancel", {"reason": REASON}), 400, "idempotency_key_required")
    key = idempotency_key()
    first = buyer.api.post(path, body, key)
    _ok(first, 201)
    replay = buyer.api.post(path, body, key)
    assert replay.status_code == 201 and replay.json() == first.json() and replay.headers.get("Idempotent-Replayed") == "true"
    _err(buyer.api.post(path, {**body, "seats": 2}, key), 409, "idempotency_conflict", COPY["key_conflict"])
    twin = idempotency_key()
    r1, r2 = _together(lambda: buyer.api.at(app_url).post(path, body, twin), lambda: buyer.api.at(_outage("APP_SECOND_URL")).post(path, body, twin))
    assert r1.status_code == r2.status_code == 201 and r1.json() == r2.json()
    assert [r.headers.get("Idempotent-Replayed") for r in (r1, r2)].count("true") == 1
    theirs = _ok(other.api.post(path, body, key), 201)
    assert theirs["booking"]["id"] != first.json()["booking"]["id"]
    assert len(_kb_txns(killbill, buyer.email)) == 2 and len(_kb_txns(killbill, other.email)) == 1
    ck = idempotency_key()
    c1 = marta.api.post(f"/api/manager/sessions/{sess['id']}/cancel", {"reason": REASON}, ck)
    _ok(c1, 200)
    c2 = marta.api.post(f"/api/manager/sessions/{sess['id']}/cancel", {"reason": REASON}, ck)
    assert c2.json() == c1.json() and c2.headers.get("Idempotent-Replayed") == "true"
    late = buyer.api.post(path, body, key)
    assert late.status_code == 201 and late.json() == first.json()
    donor, dk = _visitor(app_url), idempotency_key()
    donation = {"amount_minor": DONATION_MIN, "currency": "EUR", "card_number": APPROVED_CARD}
    _err(donor.api.at(_outage("APP_KILLBILL_DOWN_URL")).post("/api/donations", donation, dk), 503, "billing_unavailable")
    retried = donor.api.post("/api/donations", donation, dk)
    assert retried.status_code == 201 and retried.headers.get("Idempotent-Replayed") != "true"


def test_wf_booking_keyboard(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    marta, person = _staff(app_url, MARTA), _visitor(app_url)
    sess = _new_session(marta, f"Keys tour {_tag()}", _iso(_server_now(marta.api) + BOOKING_CLOSE * 2), 4)
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        opener = _button(page, "Sign in").first
        _visible(page, opener, "Sign in")
        _tab_to(page, opener)
        page.keyboard.press("Enter")
        dialog = _dialog(page, "Sign in")
        _eventually(page, lambda: _holds_focus(dialog), "focus inside Sign in")
        _tab_to(page, _field(dialog, "Email"))
        page.keyboard.type(person.email)
        _tab_to(page, _field(dialog, "Password"))
        page.keyboard.type(PASSWORD)
        _tab_to(page, _button(dialog, "Sign in"))
        page.keyboard.press("Enter")
        nav = page.get_by_role("navigation", name="Main", exact=True).get_by_role("link", name="Sessions", exact=True)
        _visible(page, nav, "Sessions link")
        _tab_to(page, nav)
        page.keyboard.press("Enter")
        book = _button(page, f"Book {sess['title']}")
        _visible(page, book, "Book button")
        _tab_to(page, book)
        page.keyboard.press("Enter")
        dialog = _dialog(page, "Book a guided session")
        seats = dialog.get_by_role("spinbutton", name="Seats", exact=True)
        _tab_to(page, seats)
        page.keyboard.press("ArrowUp")
        _eventually(page, lambda: seats.input_value() == "2", "two seats")
        _shows(page, _status(page, "Booking price"), f"{_price(2 * TICKET['EUR'], 'EUR')} for 2 seats")
        _tab_to(page, _field(dialog, "Card number"))
        page.keyboard.type(APPROVED_CARD)
        _tab_to(page, _button(dialog, "Pay and book"))
        page.keyboard.press("Enter")
        heading = dialog.get_by_role("heading", level=2, name=COPY["booked"], exact=True)
        _eventually(page, lambda: _focused(heading), "confirmation heading focused")
        _includes(page, dialog, f"{sess['title']}, {sess['starts_at_display']}. Ticket T-")
        _includes(page, _status(page, "Notices"), f"Booked 2 seats for {sess['title']}.")
        page.keyboard.press("Escape")
        _eventually(page, lambda: _focused(_button(page, f"Book {sess['title']}")), "focus back on Book")
    assert [(t["minor"], t["currency"]) for t in _kb_txns(killbill, person.email)] == [(2 * TICKET["EUR"], "EUR")]
    assert len(_mails(mail, person.email, prefix=f"Your ticket for {sess['title']} — receipt ")) == 1


def test_wf_booking_auckland_device(browser: Browser, app_url: str, mail: Any) -> None:
    marta, person = _staff(app_url, MARTA), _visitor(app_url)
    summer_at, winter_at = _wall(_spring_day(marta.api), EVENING), _wall(_winter_day(marta.api), EVENING)
    summer_iso, summer_display, winter_iso, winter_display = _iso(summer_at), _display(summer_at), _iso(winter_at), _display(winter_at)
    assert summer_iso.endswith("+01:00") and winter_iso.endswith("+00:00")
    summer = _new_session(marta, f"Clock change {_tag()}", _utc(summer_at), 4)
    winter = _new_session(marta, f"Winter night {_tag()}", winter_iso, 4)
    assert summer["starts_at"] == summer_iso and summer["starts_at_display"] == summer_display
    assert winter["starts_at"] == winter_iso and winter["starts_at_display"] == winter_display
    with _device(browser, app_url + "/sessions", tz=AUCKLAND, at=FAR_DEVICE_TIME, person=person, base=app_url) as page:
        _includes(page, page.get_by_role("article").filter(has_text=summer["title"]), summer_display)
        _includes(page, page.get_by_role("article").filter(has_text=winter["title"]), winter_display)
        click(_button(page, f"Book {summer['title']}"))
        dialog = _dialog(page, "Book a guided session")
        fill(_field(dialog, "Card number"), APPROVED_CARD)
        click(_button(dialog, "Pay and book"))
        _includes(page, dialog, f"{summer['title']}, {summer_display}. Ticket T-")
    order = _orders(person.api)[0]
    message = _mails(mail, person.email, subject=f"Your ticket for {summer['title']} — receipt {order['receipt_number']}")
    assert len(message) == 1 and summer_display in mail_text(message[0])
    assert _squash(summer_display) in _squash(_receipt_pdf(order["receipt_number"]))


def test_ticket_settlement(app_url: str, killbill: Any, mail: Any) -> None:
    marta, buyer = _staff(app_url, MARTA), _visitor(app_url)
    capacity = 2 + MAX_SEATS + 1
    sess = _new_session(marta, f"Settled tour {_tag()}", _winter(marta.api), capacity)
    body = _ok(_book(buyer, sess["id"], 2, "GBP"), 201)
    order = body["order"]
    assert (order["amount_minor"], order["currency"], order["kind"], order["card_last4"]) == (2 * TICKET["GBP"], "GBP", "ticket", APPROVED_LAST4)
    assert re.fullmatch(r"HRR-\d{6}", order["receipt_number"]) and re.fullmatch(r"T-[A-Z0-9]{8}", body["booking"]["ticket_code"])
    rows = _ledger(marta, buyer.email, currency="GBP")
    assert [r["receipt_number"] for r in rows] == [order["receipt_number"]]
    invoices = [i for i in _kb_invoices(killbill, buyer.email) if Decimal(str(i["amount"])) > 0]
    assert len(invoices) == 1 and _minor(invoices[0]["amount"], "GBP") == 2 * TICKET["GBP"]
    assert [it["description"] for it in invoices[0]["items"]] == [f"Guided session: {sess['title']} × 2"]
    txns = _kb_txns(killbill, buyer.email)
    assert [(t["minor"], t["currency"]) for t in txns] == [(2 * TICKET["GBP"], "GBP")]
    assert rows[0]["killbill_payment_id"] == txns[0]["payment_id"] and rows[0]["killbill_invoice_id"] == invoices[0]["invoiceId"]
    subject = f"Your ticket for {sess['title']} — receipt {order['receipt_number']}"
    assert len(_mails(mail, buyer.email, subject=subject)) == 1
    assert order["receipt_number"] in _receipt_pdf(order["receipt_number"])
    _err(_book(buyer, sess["id"], 1, "GBP", DECLINED_CARD), 402, "card_declined", COPY["card_declined"])
    assert _err(_book(buyer, sess["id"], 1, "GBP", BAD_LUHN_CARD), 422, "validation_failed")["fields"]["card_number"] == COPY["card"]
    assert _err(_book(buyer, sess["id"], MAX_SEATS + 1, "GBP"), 422, "validation_failed")["fields"]["seats"] == COPY["seats"]
    assert len(_kb_txns(killbill, buyer.email)) == 1 and len(_ledger(marta, buyer.email, currency="GBP")) == 1
    assert len(_orders(buyer.api)) == 1 and len(_mails(mail, buyer.email, prefix="Your ticket for")) == 1
    assert _session_state(marta.api, sess["id"])["seats_left"] == capacity - 2


def test_wf_settlement_receipt_download(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    marta, person = _staff(app_url, MARTA), _visitor(app_url)
    sess = _new_session(marta, f"Receipt tour {_tag()}", _winter(marta.api), 4)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/sessions")
        click(_button(page, f"Book {sess['title']}"))
        dialog = _dialog(page, "Book a guided session")
        fill(dialog.get_by_role("spinbutton", name="Seats", exact=True), "2")
        check(dialog.get_by_role("radio", name="GBP", exact=True))
        fill(_field(dialog, "Card number"), APPROVED_CARD)
        click(_button(dialog, "Pay and book"))
        _visible(page, dialog.get_by_role("heading", level=2, name=COPY["booked"], exact=True), "confirmation")
        receipt = _orders(person.api)[0]["receipt_number"]
        page.goto(app_url + "/account")
        link = page.get_by_role("table", name="Orders", exact=True).get_by_role("link", name=f"Receipt {receipt}", exact=True)
        _visible(page, link, "receipt link")
        pdf = page.request.get(app_url.rstrip("/") + link.get_attribute("href"))
        assert pdf.ok and pdf.headers["content-type"].startswith("application/pdf") and pdf.body().startswith(b"%PDF")
    assert [(t["minor"], t["currency"]) for t in _kb_txns(killbill, person.email)] == [(2 * TICKET["GBP"], "GBP")]
    assert len(_mails(mail, person.email, prefix=f"Your ticket for {sess['title']}")) == 1


def test_wf_settlement_mail_outage(browser: Browser, app_url: str, mail: Any) -> None:
    down = _outage("APP_MAILPIT_DOWN_URL")
    marta, person = _staff(app_url, MARTA), _visitor(app_url)
    sess = _new_session(marta, f"Quiet post {_tag()}", _winter(marta.api), 4)
    with open_app(browser, down + "/") as page:
        _sign_cookie(page, down, person, "/sessions")
        click(_button(page, f"Book {sess['title']}"))
        dialog = _dialog(page, "Book a guided session")
        fill(_field(dialog, "Card number"), APPROVED_CARD)
        click(_button(dialog, "Pay and book"))
        _visible(page, dialog.get_by_role("heading", level=2, name=COPY["booked"], exact=True), "confirmation")
        _includes(page, _status(page, "Service notice"), COPY["delayed"])
    order = _orders(person.api)[0]
    subject = f"Your ticket for {sess['title']} — receipt {order['receipt_number']}"
    assert len(_mails(mail, person.email, subject=subject, seconds=MAIL_DELIVERY_S + MAIL_WAIT_S)) == 1
    body = {"seats": 1, "currency": "EUR", "card_number": APPROVED_CARD}
    api_booking = _ok(person.api.at(down).post(f"/api/sessions/{sess['id']}/bookings", body, idempotency_key()), 201)
    assert api_booking["receipt_email"] == "delayed"


def test_outages_billing_storage(app_url: str, killbill: Any, mail: Any) -> None:
    kb_down, s3_down = _outage("APP_KILLBILL_DOWN_URL"), _outage("APP_MINIO_DOWN_URL")
    marta, person, ines = _staff(app_url, MARTA), _visitor(app_url), _staff(app_url, INES)
    sess = _new_session(marta, f"Outage tour {_tag()}", _winter(marta.api), 4)
    for base in (kb_down, s3_down):
        assert _get_json(base, "/api/health") == {"status": "ok"}
        _ok(Api(base).get(_chapter_api(1)), 200)
    _err(Api(kb_down).get("/api/catalog"), 503, "billing_unavailable")
    assert all("price_minor" not in s for s in _get_json(kb_down, "/api/sessions")["sessions"])
    remote = person.api.at(kb_down)
    _err(remote.post(f"/api/sessions/{sess['id']}/bookings", {"seats": 1, "currency": "EUR", "card_number": APPROVED_CARD}, idempotency_key()), 503, "billing_unavailable", COPY["billing_down"])
    _err(remote.post("/api/donations", {"amount_minor": DONATION_MIN, "currency": "EUR", "card_number": APPROVED_CARD}, idempotency_key()), 503, "billing_unavailable", COPY["billing_down"])
    _err(remote.post("/api/me/membership", {"tier": _tiers(person.api)["Reader"], "currency": "EUR", "card_number": APPROVED_CARD}, idempotency_key()), 503, "billing_unavailable", COPY["billing_down"])
    storage = person.api.at(s3_down)
    _err(storage.post(f"/api/sessions/{sess['id']}/bookings", {"seats": 1, "currency": "EUR", "card_number": APPROVED_CARD}, idempotency_key()), 503, "storage_unavailable", COPY["storage_purchase"])
    assert _kb_txns(killbill, person.email) == [] and _orders(person.api) == []
    assert _membership(person.api) is None and _session_state(marta.api, sess["id"])["seats_left"] == 4
    order = _ok(_donate(person, DONATION_MIN), 201)["order"]
    _err(storage.get(f"/api/orders/{order['id']}/receipt"), 503, "storage_unavailable", COPY["media_unavailable"])
    media_url = _get_json(app_url, _chapter_api(1))["chapter"]["narration"]["media_url"]
    _err(Api(s3_down).get(media_url), 503, "storage_unavailable", COPY["media_unavailable"])
    item = _event(ines, 2, f"Upload outage {_tag()}")
    _err(_upload(ines.api.at(s3_down), item["id"], "image", f"o-{_tag()}.png", _png(), "image/png"), 503, "storage_unavailable", COPY["storage_upload"])
    assert len(_mails(mail, person.email, prefix="Thank you for your donation")) == 1


def test_boot_storage_down_recovers(app_url: str) -> None:
    relay = Relay(os.environ["S3_ENDPOINT"])
    media_url = _get_json(app_url, _chapter_api(1))["chapter"]["narration"]["media_url"]
    try:
        with _app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}"}) as base:
            _ok(Api(base).get(_chapter_api(1)), 200)
            _err(Api(base).get(media_url), 503, "storage_unavailable", COPY["media_unavailable"])
            relay.open()
            _poll(lambda: Api(base).get(media_url).status_code == 302, RECOVER_S + MAIL_SETTLE_S * 5, "media recovery")
    finally:
        relay.close()


def test_wf_settlement_storage_outage(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    down = _outage("APP_MINIO_DOWN_URL")
    marta, person = _staff(app_url, MARTA), _visitor(app_url)
    sess = _new_session(marta, f"Storage tour {_tag()}", _winter(marta.api), 4)
    with open_app(browser, down + "/") as page:
        _sign_cookie(page, down, person, "/chapters/1")
        _visible(page, page.get_by_text(COPY["media_unavailable"]), "media copy")
        page.goto(down + "/sessions")
        click(_button(page, f"Book {sess['title']}"))
        dialog = _dialog(page, "Book a guided session")
        fill(_field(dialog, "Card number"), APPROVED_CARD)
        click(_button(dialog, "Pay and book"))
        _includes(page, dialog.get_by_role("alert"), COPY["storage_purchase"])
    assert _kb_txns(killbill, person.email) == [] and _orders(person.api) == []
    assert _mails(mail, person.email, minimum=0) == []


def test_donation_exact_minor(app_url: str, killbill: Any, mail: Any) -> None:
    marta = _staff(app_url, MARTA)
    for currency, amount in (("EUR", 2500), ("JPY", 2000)):
        person = _visitor(app_url)
        bounds = f"Enter an amount between {_price(DONATION_MIN, currency)} and {_price(DONATION_MAX, currency)}."
        for bad in (DONATION_MIN - 1, DONATION_MAX + 1):
            assert _err(_donate(person, bad, currency), 422, "validation_failed")["fields"]["amount_minor"] == bounds
        assert "note" in _err(_donate(person, amount, currency, note="n" * 501), 422, "validation_failed")["fields"]
        assert _kb_txns(killbill, person.email) == []
        order = _ok(_donate(person, amount, currency), 201)["order"]
        assert (order["amount_minor"], order["currency"], order["kind"]) == (amount, currency, "donation")
        assert [(t["minor"], t["currency"]) for t in _kb_txns(killbill, person.email)] == [(amount, currency)]
        invoices = [i for i in _kb_invoices(killbill, person.email) if Decimal(str(i["amount"])) > 0]
        assert [[it["description"] for it in i["items"]] for i in invoices] == [["Donation"]]
        assert [r["amount_minor"] for r in _ledger(marta, person.email, kind="donation")] == [amount]
        assert len(_mails(mail, person.email, subject=f"Thank you for your donation — receipt {order['receipt_number']}")) == 1
        assert _squash(_price(amount, currency)) in _squash(_receipt_pdf(order["receipt_number"]))
    edge = _visitor(app_url)
    for amount in (DONATION_MIN, DONATION_MAX):
        _ok(_donate(edge, amount), 201)
    assert sorted(t["minor"] for t in _kb_txns(killbill, edge.email)) == [DONATION_MIN, DONATION_MAX]


def test_private_receipts(app_url: str, killbill: Any, mail: Any) -> None:
    marta, other, person = _staff(app_url, MARTA), _visitor(app_url), _visitor(app_url)
    _ok(_donate(other, 2500, note="other note"), 201)
    note = f"Private note {_tag()}"
    order = _ok(_donate(person, 2500, note=note), 201)["order"]
    _ok(marta.api.post(f"/api/manager/orders/{order['id']}/notes", {"text": f"Manager note {_tag()}"}), 201)
    message = _mails(mail, person.email, subject=f"Thank you for your donation — receipt {order['receipt_number']}")[0]
    body = mail_text(message)
    pdf = _receipt_pdf(order["receipt_number"])
    day = _lisbon(datetime.fromisoformat(order["settled_at"])).date()
    account = killbill.account(person.email)
    invoice = _kb_invoices(killbill, person.email)[0]
    secrets = [note, other.name, other.email, "4242424242424242", APPROVED_CARD, account["accountId"], invoice["invoiceId"], _kb_txns(killbill, person.email)[0]["payment_id"]]
    for content in (body, pdf):
        flat = _squash(content)
        for needle in (person.name, order["receipt_number"], "Donation", _price(2500, "EUR"), "EUR", f"Card ending {APPROVED_LAST4}"):
            assert _squash(needle) in flat, needle
        assert re.search(_date_pattern(day), content), "receipt date"
        for secret in secrets:
            assert _squash(secret) not in flat, secret
    assert "/account" in body
    _err(other.api.get(f"/api/orders/{order['id']}/receipt"), 404, "not_found")
    assert marta.api.get(f"/api/orders/{order['id']}/receipt").status_code == 302


def test_donation_duplicates(app_url: str, killbill: Any, mail: Any) -> None:
    person, key = _visitor(app_url), idempotency_key()
    body = {"amount_minor": 2500, "currency": "EUR", "card_number": APPROVED_CARD, "note": ""}
    r1, r2 = _together(lambda: person.api.at(app_url).post("/api/donations", body, key), lambda: person.api.at(_outage("APP_SECOND_URL")).post("/api/donations", body, key))
    assert r1.status_code == r2.status_code == 201 and r1.json() == r2.json()
    assert [r.headers.get("Idempotent-Replayed") for r in (r1, r2)].count("true") == 1
    receipt = r1.json()["order"]["receipt_number"]
    assert _ok(person.api.post("/api/donations", body, key), 201)["order"]["receipt_number"] == receipt
    assert len(_kb_txns(killbill, person.email)) == 1 and len(_orders(person.api)) == 1
    assert len(_mails(mail, person.email, prefix="Thank you for your donation")) == 1
    assert S3().get(f"receipts/{receipt}.pdf").startswith(b"%PDF")


def _donate_ui(page: Page, amount: str, currency: str) -> Locator:
    form = page.get_by_role("form", name="Donate", exact=True)
    _visible(page, form, "Donate form")
    fill(_field(form, "Amount"), amount)
    check(form.get_by_role("radio", name=currency, exact=True))
    fill(_field(form, "Card number"), APPROVED_CARD)
    return form


def test_wf_donations_happy(browser: Browser, app_url: str, killbill: Any) -> None:
    person = _visitor(app_url)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/support")
        form = _donate_ui(page, "25", "EUR")
        click(_button(form, "Donate"))
        _visible(page, page.get_by_role("heading", level=2, name=COPY["thanks"], exact=True), "thank-you")
        _includes(page, _status(page, "Notices"), f"Donation of {_price(2500, 'EUR')} received.")
        receipt = _orders(person.api)[0]["receipt_number"]
        page.goto(app_url + "/account")
        link = page.get_by_role("link", name=f"Receipt {receipt}", exact=True)
        _visible(page, link, "receipt link")
        pdf = page.request.get(app_url.rstrip("/") + link.get_attribute("href"))
        assert pdf.ok and pdf.body().startswith(b"%PDF")
    assert [(t["minor"], t["currency"]) for t in _kb_txns(killbill, person.email)] == [(2500, "EUR")]


def test_wf_donations_lost_reply(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    person = _visitor(app_url)
    seen: list[dict] = []
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/support")

        def handler(route: Any) -> None:
            key = route.request.headers.get("idempotency-key")
            if not seen:
                seen.append({"key": key, "body": route.fetch().json()})
                route.abort("connectionreset")
            else:
                seen.append({"key": key})
                route.continue_()

        page.route(lambda url: urlparse(url).path == "/api/donations", handler)
        form = _donate_ui(page, "25", "EUR")
        click(_button(form, "Donate"))
        _includes(page, form.get_by_role("alert"), COPY["lost_reply"])
        assert _field(form, "Amount").input_value() == "25" and _field(form, "Card number").input_value() == APPROVED_CARD
        click(_button(form, "Donate"))
        _visible(page, page.get_by_role("heading", level=2, name=COPY["thanks"], exact=True), "thank-you")
    assert len(seen) == 2 and seen[0]["key"] and seen[0]["key"] == seen[1]["key"]
    orders = _orders(person.api)
    assert [o["receipt_number"] for o in orders] == [seen[0]["body"]["order"]["receipt_number"]]
    assert len(_kb_txns(killbill, person.email)) == 1 and len(_mails(mail, person.email, prefix="Thank you for your donation")) == 1


def test_wf_donations_jpy_format(browser: Browser, app_url: str, killbill: Any) -> None:
    person = _visitor(app_url)
    posts: list[str] = []
    with open_app(browser, app_url + "/") as page:
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and urlparse(r.url).path == "/api/donations" else None)
        _sign_cookie(page, app_url, person, "/support")
        form = _donate_ui(page, "25.5", "JPY")
        click(_button(form, "Donate"))
        _includes(page, form.get_by_role("alert"), COPY["amount_format"])
        assert posts == []
        fill(_field(form, "Amount"), "2000")
        with held(page, "**/api/donations") as gate:
            _button(form, "Donate").dblclick()
            _includes(page, _status(page, "Notices"), COPY["processing"])
            assert _disabled(_button(form, "Donate"))
            gate.release()
        _includes(page, _status(page, "Notices"), f"Donation of {_price(2000, 'JPY')} received.")
    assert len(posts) == 1
    assert [(t["minor"], t["currency"]) for t in _kb_txns(killbill, person.email)] == [(2000, "JPY")]


def test_catalog_prices(browser: Browser, app_url: str, killbill: Any) -> None:
    catalog = _get_json(app_url, "/api/catalog")
    assert catalog["currencies"] == CURRENCIES and catalog["ticket"]["prices"] == TICKET
    assert {t["name"]: t["prices"] for t in catalog["tiers"]} == TIER_PRICES
    assert catalog["donation"]["min_minor"] == {c: DONATION_MIN for c in CURRENCIES}
    assert catalog["donation"]["max_minor"] == {c: DONATION_MAX for c in CURRENCIES}
    person = _visitor(app_url)
    membership = _ok(_join(person, "Reader", "JPY"), 201)["membership"]
    assert membership["price_minor"] == TIER_PRICES["Reader"]["JPY"]
    paid = [i for i in _kb_invoices(killbill, person.email) if Decimal(str(i["amount"])) > 0]
    assert [(_minor(i["amount"], "JPY"), i["currency"]) for i in paid] == [(TIER_PRICES["Reader"]["JPY"], "JPY")]
    marta, buyer = _staff(app_url, MARTA), _visitor(app_url)
    sess = _new_session(marta, f"Price tour {_tag()}", _winter(marta.api), 4)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, buyer, "/sessions")
        _includes(page, page.get_by_role("article").filter(has_text=sess["title"]), f"{_price(TICKET['EUR'], 'EUR')} a seat")
        click(_button(page, f"Book {sess['title']}"))
        dialog = _dialog(page, "Book a guided session")
        fill(dialog.get_by_role("spinbutton", name="Seats", exact=True), "2")
        for currency in CURRENCIES:
            check(dialog.get_by_role("radio", name=currency, exact=True))
            _shows(page, _status(page, "Booking price"), f"{_price(2 * TICKET[currency], currency)} for 2 seats")
    assert _price(TICKET["JPY"], "JPY") == "¥2,000"


def test_join_plan(app_url: str, killbill: Any, mail: Any) -> None:
    person = _visitor(app_url)
    body = _ok(_join(person, "Fellow", "EUR"), 201)
    membership, order = body["membership"], body["order"]
    assert (membership["tier_name"], membership["status"], membership["currency"], membership["price_minor"]) == ("Fellow", "active", "EUR", TIER_PRICES["Fellow"]["EUR"])
    account = killbill.account(person.email)
    assert account["externalKey"] == person.id and account["currency"] == "EUR"
    sub = _kb_live_sub(killbill, person.email)
    assert sub["planName"] == "supporter-fellow-monthly" and membership["charged_through"] == str(sub["chargedThroughDate"])[:10]
    invoices = [i for i in _kb_invoices(killbill, person.email) if Decimal(str(i["amount"])) > 0]
    assert [(_minor(i["amount"], "EUR"), _minor(i["balance"], "EUR")) for i in invoices] == [(TIER_PRICES["Fellow"]["EUR"], 0)]
    assert [t["minor"] for t in _kb_txns(killbill, person.email)] == [order["amount_minor"]] == [TIER_PRICES["Fellow"]["EUR"]]
    assert len(_mails(mail, person.email, subject=f"Welcome, Fellow supporter — receipt {order['receipt_number']}")) == 1
    _err(_join(person, "Patron", "EUR"), 409, "already_member", COPY["already_member"])
    _err(_donate(person, DONATION_MIN, "GBP"), 409, "currency_locked", "Your supporter account pays in EUR. Choose EUR to continue.")
    marta = _staff(app_url, MARTA)
    sess = _new_session(marta, f"Locked tour {_tag()}", _winter(marta.api), 4)
    _err(_book(person, sess["id"], 1, "USD"), 409, "currency_locked", "Your supporter account pays in EUR. Choose EUR to continue.")
    late = _visitor(app_url)
    _err(_join(late, "Reader", "JPY", DECLINED_CARD), 402, "card_declined", COPY["card_declined"])
    _err(_join(late, "Reader", "EUR"), 409, "currency_locked", "Your supporter account pays in JPY. Choose JPY to continue.")
    assert len(_kb_txns(killbill, person.email)) == 1


def test_plan_price_live(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        click(_button(page, "Support"))
        dialog = _dialog(page, "Supporter plan")
        _visible(page, dialog, "plan dialog")
        url = page.url
        for tier, currency in (("Patron", "EUR"), ("Patron", "JPY"), ("Reader", "GBP"), ("Fellow", "USD")):
            check(dialog.get_by_role("radio", name=tier, exact=True))
            check(dialog.get_by_role("radio", name=currency, exact=True))
            _shows(page, _status(page, "Plan price"), f"{_price(TIER_PRICES[tier][currency], currency)} a month")
        assert page.url == url
        _visible(page, _button(dialog, "Sign in to join"), "Sign in to join")


def test_plan_dialog_survives_timers(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/chapters/1") as page:
        play = _button(page, "Play narration")
        _visible(page, play, "Play narration")
        click(play)
        _visible(page, _button(page, "Pause narration"), "narration playing")
        _visible(page, _button(page, "Pause plates"), "plates running")
        click(_button(page, "Support"))
        dialog = _dialog(page, "Supporter plan")
        check(dialog.get_by_role("radio", name="Patron", exact=True))
        check(dialog.get_by_role("radio", name="GBP", exact=True))
        expected = f"{_price(TIER_PRICES['Patron']['GBP'], 'GBP')} a month"
        _shows(page, _status(page, "Plan price"), expected)
        for _ in range(3):
            advance(page, PLATE_HOLD_MS)
        assert dialog.is_visible()
        assert dialog.get_by_role("radio", name="Patron", exact=True).is_checked() and dialog.get_by_role("radio", name="GBP", exact=True).is_checked()
        assert _txt(_status(page, "Plan price")) == expected
        page.keyboard.press("Escape")
        _settled(_button(page, "Support"), _kit_click, hold_clock=True)
        advance(page, PLATE_HOLD_MS)
        assert _dialog(page, "Supporter plan").is_visible()


def test_wf_plans_join_jpy(browser: Browser, app_url: str, killbill: Any) -> None:
    person = _visitor(app_url)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/support")
        click(_button(page, "Choose a plan"))
        dialog = _dialog(page, "Supporter plan")
        check(dialog.get_by_role("radio", name="Reader", exact=True))
        check(dialog.get_by_role("radio", name="JPY", exact=True))
        fill(_field(dialog, "Card number"), APPROVED_CARD)
        click(_button(dialog, "Join"))
        _includes(page, _status(page, "Notices"), "Welcome, Reader supporter.")
        page.goto(app_url + "/account")
        region = page.get_by_role("region", name="Membership", exact=True)
        _includes(page, region, "Active")
        _includes(page, region, f"Next payment {_price(TIER_PRICES['Reader']['JPY'], 'JPY')} on ")
    sub = _kb_live_sub(killbill, person.email)
    assert sub["planName"] == "supporter-reader-monthly"
    assert [t["minor"] for t in _kb_txns(killbill, person.email)] == [TIER_PRICES["Reader"]["JPY"]]


def test_wf_plans_billing_outage(browser: Browser, app_url: str, killbill: Any) -> None:
    down = _outage("APP_KILLBILL_DOWN_URL")
    person = _visitor(app_url)
    with open_app(browser, down + "/") as page:
        _sign_cookie(page, down, person, "/support")
        _visible(page, page.get_by_text(COPY["prices_down"]).first, "prices copy")
        click(_button(page, "Support"))
        dialog = _dialog(page, "Supporter plan")
        _includes(page, dialog, COPY["prices_down"])
        for name in ("Fellow", "EUR"):
            choice = dialog.get_by_role("radio", name=name, exact=True)
            if choice.count() and choice.is_enabled():
                choice.check()
        card, join = _field(dialog, "Card number"), _button(dialog, "Join")
        if card.count() and join.count() and card.is_enabled() and join.is_enabled():
            fill(card, APPROVED_CARD)
            click(join)
            _includes(page, dialog.get_by_role("alert"), COPY["billing_down"])
    assert killbill.account(person.email) is None and _membership(person.api) is None


def test_upgrade_immediate(app_url: str, killbill: Any, mail: Any) -> None:
    person = _visitor(app_url)
    _ok(_join(person, "Reader", "EUR"), 201)
    body = _ok(_change(person, "Patron"), 200)
    assert body["membership"]["tier_name"] == "Patron" and body["membership"]["status"] == "active"
    assert _kb_live_sub(killbill, person.email)["planName"] == "supporter-patron-monthly"
    order = body["order"]
    invoices = sorted((i for i in _kb_invoices(killbill, person.email) if Decimal(str(i["amount"])) > 0), key=lambda i: (str(i.get("invoiceDate")), int(i.get("invoiceNumber") or 0)))
    assert order["kind"] == "membership_upgrade" and order["amount_minor"] == _minor(invoices[-1]["amount"], "EUR")
    assert sorted(t["minor"] for t in _kb_txns(killbill, person.email)) == sorted([TIER_PRICES["Reader"]["EUR"], order["amount_minor"]])
    assert len(_mails(mail, person.email, subject=f"Your supporter upgrade — receipt {order['receipt_number']}")) == 1


def test_pending_downgrade_cancel(browser: Browser, app_url: str, killbill: Any) -> None:
    stranger = _visitor(app_url)
    _err(_change(stranger, "Fellow"), 409, "not_a_member", COPY["not_a_member"])
    person = _visitor(app_url)
    _ok(_join(person, "Patron", "EUR"), 201)
    _err(_change(person, "Patron"), 409, "same_tier", "You're already on the Patron tier.")
    _err(person.api.post("/api/me/membership/undo", {}, idempotency_key()), 409, "nothing_pending", COPY["nothing_pending"])
    m = _ok(_change(person, "Reader"), 200)["membership"]
    sub = _kb_live_sub(killbill, person.email)
    charged = str(sub["chargedThroughDate"])[:10]
    assert (m["tier_name"], m["status"]) == ("Patron", "pending_change") and sub["planName"] == "supporter-patron-monthly"
    assert m["pending"]["kind"] == "downgrade" and m["pending"]["effective_on"] == charged
    assert m["next_charge"] == {"on": charged, "amount_minor": TIER_PRICES["Reader"]["EUR"]}
    _err(_change(person, "Fellow"), 409, "change_pending", COPY["change_pending"])
    _err(person.api.post("/api/me/membership/cancel", {}, idempotency_key()), 409, "change_pending", COPY["change_pending"])
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/account")
        region = page.get_by_role("region", name="Membership", exact=True)
        _includes(page, region, "Pending change")
        _eventually(page, lambda: re.search(rf"Changes to Reader on {_date_pattern(date.fromisoformat(charged))}\.", _txt(region)), "pending line")
    m = _ok(person.api.post("/api/me/membership/undo", {}, idempotency_key()), 200)["membership"]
    assert m["status"] == "active" and m["pending"] is None and m["next_charge"]["amount_minor"] == TIER_PRICES["Patron"]["EUR"]
    m = _ok(person.api.post("/api/me/membership/cancel", {}, idempotency_key()), 200)["membership"]
    sub = _kb_live_sub(killbill, person.email)
    assert m["pending"] == {"kind": "cancel", "effective_on": str(sub["billingEndDate"])[:10]} and m["next_charge"] is None
    assert str(sub["billingEndDate"])[:10] == charged and m["tier_name"] == "Patron"
    _ok(person.api.post("/api/me/membership/undo", {}, idempotency_key()), 200)
    assert not _kb_live_sub(killbill, person.email).get("billingEndDate")


def test_simultaneous_plan_actions(app_url: str, killbill: Any) -> None:
    second = _outage("APP_SECOND_URL")
    person = _visitor(app_url)
    _ok(_join(person, "Fellow", "EUR"), 201)
    down, cancel = _together(lambda: _change(person, "Reader", person.api.at(app_url)), lambda: person.api.at(second).post("/api/me/membership/cancel", {}, idempotency_key()))
    assert sorted([down.status_code, cancel.status_code]) == [200, 409]
    _err(down if down.status_code == 409 else cancel, 409, "change_pending", COPY["change_pending"])
    pending = _membership(person.api)["pending"]
    has_end = bool(_kb_live_sub(killbill, person.email).get("billingEndDate"))
    assert pending["kind"] == ("cancel" if cancel.status_code == 200 else "downgrade") and has_end == (pending["kind"] == "cancel")
    u1, u2 = _together(lambda: person.api.at(app_url).post("/api/me/membership/undo", {}, idempotency_key()), lambda: person.api.at(second).post("/api/me/membership/undo", {}, idempotency_key()))
    assert sorted([u1.status_code, u2.status_code]) == [200, 409]
    _err(u1 if u1.status_code == 409 else u2, 409, "nothing_pending", COPY["nothing_pending"])
    before = len(_kb_txns(killbill, person.email))
    g1, g2 = _together(lambda: _change(person, "Patron", person.api.at(app_url)), lambda: _change(person, "Patron", person.api.at(second)))
    assert sorted([g1.status_code, g2.status_code]) == [200, 409]
    _err(g1 if g1.status_code == 409 else g2, 409, "same_tier", "You're already on the Patron tier.")
    assert len(_kb_txns(killbill, person.email)) == before + 1
    assert [o["kind"] for o in _orders(person.api)].count("membership_upgrade") == 1


def test_wf_membership_change_journey(browser: Browser, app_url: str, killbill: Any) -> None:
    person = _visitor(app_url)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/")
        dialog = _dialog(page, "Supporter plan")

        def act(tier: str, button: str, notice: str) -> None:
            click(_button(page, "Support"))
            _visible(page, dialog, "plan dialog")
            if tier:
                check(dialog.get_by_role("radio", name=tier, exact=True))
            click(_button(dialog, button))
            _eventually(page, lambda: re.search(notice, _txt(_status(page, "Notices"))), notice)
            page.keyboard.press("Escape")

        click(_button(page, "Support"))
        check(dialog.get_by_role("radio", name="Fellow", exact=True))
        check(dialog.get_by_role("radio", name="EUR", exact=True))
        fill(_field(dialog, "Card number"), APPROVED_CARD)
        click(_button(dialog, "Join"))
        _includes(page, _status(page, "Notices"), "Welcome, Fellow supporter.")
        page.keyboard.press("Escape")
        act("Patron", "Change plan", re.escape("You're now a Patron supporter."))
        act("Reader", "Change plan", r"Your change to Reader is pending until .+\.")
        page.goto(app_url + "/account")
        region = page.get_by_role("region", name="Membership", exact=True)
        _includes(page, region, "Pending change")
        _includes(page, region, "Changes to Reader on ")
        act("", "Undo pending change", re.escape(COPY["undone"]))
    m = _membership(person.api)
    assert (m["tier_name"], m["status"], m["pending"]) == ("Patron", "active", None)
    sub = _kb_live_sub(killbill, person.email)
    assert sub["planName"] == "supporter-patron-monthly" and not sub.get("billingEndDate")


def test_wf_membership_change_two_tabs(browser: Browser, app_url: str) -> None:
    person = _visitor(app_url)
    _ok(_join(person, "Fellow", "EUR"), 201)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/")
        click(_button(page, "Support"))
        dialog = _dialog(page, "Supporter plan")
        _visible(page, _button(dialog, "Change plan"), "member actions")
        _ok(person.api.post("/api/me/membership/cancel", {}, idempotency_key()), 200)
        check(dialog.get_by_role("radio", name="Reader", exact=True))
        click(_button(dialog, "Change plan"))
        _includes(page, dialog.get_by_role("alert"), COPY["change_pending"])
        _visible(page, _button(dialog, "Undo pending change"), "confirmed pending state")
        _eventually(page, lambda: dialog.get_by_role("radio", name="Fellow", exact=True).is_checked(), "confirmed tier")
    assert _membership(person.api)["pending"]["kind"] == "cancel"


def _overdue(base: str, person: Person | None = None) -> Person:
    person = person or _visitor(base)
    _ok(_join(person, "Reader", "EUR", ONCE_CARD), 201)
    _err(_change(person, "Fellow"), 402, "card_declined", COPY["card_declined"])
    return person


def test_declined_upgrade_overdue(app_url: str, killbill: Any, mail: Any) -> None:
    person = _overdue(app_url)
    assert _kb_live_sub(killbill, person.email)["planName"] == "supporter-fellow-monthly"
    unpaid = [i for i in _kb_invoices(killbill, person.email) if Decimal(str(i["balance"])) > 0]
    assert len(unpaid) == 1
    m = _membership(person.api)
    assert (m["tier_name"], m["status"], m["next_charge"]) == ("Fellow", "overdue", None)
    assert m["amount_due_minor"] == _minor(unpaid[0]["balance"], "EUR")
    assert len(_mails(mail, person.email, subject="Your supporter payment didn't go through")) == 1
    assert [o["kind"] for o in _orders(person.api)] == ["membership_join"] and len(_kb_txns(killbill, person.email)) == 1
    _err(_change(person, "Patron"), 409, "payment_overdue", COPY["payment_overdue"])
    _err(_join(person, "Patron", "EUR"), 409, "already_member")
    other = _visitor(app_url)
    _err(_join(other, "Fellow", "EUR", DECLINED_CARD), 402, "card_declined", COPY["card_declined"])
    assert all(_ended(s) for s in _kb_subs(killbill, other.email))
    assert _membership(other.api) is None and _kb_txns(killbill, other.email) == []


def test_dunning_schedule(app_url: str, killbill: Any, mail: Any) -> None:
    base = _outage("APP_DUNNING_URL")
    marta = _staff(base, MARTA)
    fellow = _tiers(marta.api)["Fellow"]
    t0 = _server_now(marta.api)
    person = _overdue(base)

    def retried() -> dict | None:
        rows = _ok(marta.api.get("/api/manager/dunning"), 200)["overdue"]
        return next((r for r in rows if r["user_email"] == person.email and r["attempts"] >= 2), None)

    row = _poll(retried, DUNNING_TEST_S * 4 + LATENCY_S, "the first automatic retry on the dunning list")
    assert (_server_now(marta.api) - t0).total_seconds() >= DUNNING_TEST_S - LATENCY_S, "retry 1 ran before its interval"
    assert row["tier"] in (fellow, "Fellow") and row["currency"] == "EUR"
    cancel = _mails(mail, person.email, subject="Your supporter membership has been cancelled", seconds=DUNNING_TEST_S * 3 + MAIL_DELIVERY_S)
    _poll(lambda: _membership(person.api)["status"] == "cancelled", DUNNING_TEST_S * 4 + LATENCY_S, "cancellation after retry 3")
    assert (_server_now(marta.api) - t0).total_seconds() >= DUNNING_TEST_S * 3 - LATENCY_S, "cancelled before retry 3 was due"
    first = _mails(mail, person.email, subject="Your supporter payment didn't go through")
    reminders = _mails(mail, person.email, subject="Reminder: your supporter payment is still due", minimum=2, seconds=MAIL_DELIVERY_S)
    assert len(cancel) == 1 and len(first) == 1 and len(reminders) == 2
    assert all(_ended(s) for s in _kb_subs(killbill, person.email))
    assert _membership(person.api)["status"] == "cancelled"
    assert person.email not in [r["user_email"] for r in _ok(marta.api.get("/api/manager/dunning"), 200)["overdue"]]


def test_overdue_settles_once(app_url: str, killbill: Any, mail: Any) -> None:
    second = _outage("APP_SECOND_URL")
    person = _overdue(app_url)
    _ok(person.api.put("/api/me/membership/card", {"card_number": APPROVED_CARD}), 200)
    shared, keys = idempotency_key(), [idempotency_key() for _ in range(3)]
    calls = [lambda: person.api.at(app_url).post("/api/me/membership/retry", {}, shared), lambda: person.api.at(second).post("/api/me/membership/retry", {}, shared)]
    calls += [lambda k=k, b=b: person.api.at(b).post("/api/me/membership/retry", {}, k) for k, b in zip(keys, (app_url, second, app_url))]
    results = _together(*calls)
    winners = {i for i, r in enumerate(results) if r.status_code == 200}
    winner_keys = {(shared if i < 2 else keys[i - 2]) for i in winners}
    assert len(winner_keys) == 1, [r.status_code for r in results]
    for i, response in enumerate(results):
        if i not in winners:
            _err(response, 409, "nothing_due", COPY["nothing_due"])
    win = results[min(winners)]
    replay = person.api.post("/api/me/membership/retry", {}, winner_keys.pop())
    assert replay.json() == win.json() and replay.headers.get("Idempotent-Replayed") == "true"
    _err(person.api.post("/api/me/membership/retry", {}, idempotency_key()), 409, "nothing_due")
    assert len(_kb_txns(killbill, person.email)) == 2
    assert all(Decimal(str(i["balance"])) == 0 for i in _kb_invoices(killbill, person.email))
    upgrades = [o for o in _orders(person.api) if o["kind"] == "membership_upgrade"]
    assert len(upgrades) == 1 and win.json()["order"]["receipt_number"] == upgrades[0]["receipt_number"]
    assert len(_mails(mail, person.email, prefix="Your supporter upgrade — receipt")) == 1
    assert S3().get(f"receipts/{upgrades[0]['receipt_number']}.pdf").startswith(b"%PDF")
    assert _membership(person.api)["status"] == "active"


def test_wf_overdue_journey(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    person = _overdue(app_url)
    due = _membership(person.api)["amount_due_minor"]
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/account")
        region = page.get_by_role("region", name="Membership", exact=True)
        _includes(page, region, "Overdue")
        _includes(page, region, f"Payment of {_price(due, 'EUR')} is overdue.")
        click(_button(region, "Update card"))
        dialog = _dialog(page, "Update card")
        fill(_field(dialog, "Card number"), APPROVED_CARD)
        click(_button(dialog, "Save card"))
        _includes(page, _status(page, "Notices"), COPY["card_updated"])
        click(_button(page.get_by_role("region", name="Membership", exact=True), "Retry payment"))
        _includes(page, _status(page, "Notices"), COPY["retry_ok"])
        _includes(page, page.get_by_role("region", name="Membership", exact=True), "Active")
    assert _membership(person.api)["status"] == "active" and _kb_live_sub(killbill, person.email)["planName"] == "supporter-fellow-monthly"
    assert len(_mails(mail, person.email, prefix="Your supporter upgrade — receipt")) == 1


def test_wf_overdue_cancel(browser: Browser, app_url: str, killbill: Any) -> None:
    marta = _staff(app_url, MARTA)
    person = _overdue(app_url)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/")
        click(_button(page, "Support"))
        click(_button(_dialog(page, "Supporter plan"), "Cancel membership"))
        _includes(page, _status(page, "Notices"), COPY["cancelled_overdue"])
    assert all(_ended(s) for s in _kb_subs(killbill, person.email))
    assert _membership(person.api)["status"] == "cancelled"
    assert person.email not in [r["user_email"] for r in _ok(marta.api.get("/api/manager/dunning"), 200)["overdue"]]


def test_editorial_lifecycle(app_url: str) -> None:
    ines, priya, tomas, marta = (_staff(app_url, e) for e in (INES, PRIYA, TOMAS, MARTA))
    item = _event(ines, 2, f"Lifecycle {_tag()}")
    assert item["status"] == "draft" and item["owner_email"] == INES
    _err(marta.api.post("/api/curator/events", {"chapter": 2, "year": EVENT_YEAR, "title": "Nope", "summary": SUMMARY, "source_ids": []}), 403, "forbidden")
    _err(_move(priya.api, item["id"], "review"), 403, "forbidden", COPY["forbidden"])
    _ok(_move(ines.api, item["id"], "review"), 200)
    _err(ines.api.patch(f"/api/curator/items/{item['id']}", {"title": "Edited title"}), 409, "not_editable", COPY["not_editable"])
    winter_at = _wall(_winter_day(tomas.api), EVENING)
    future = _utc(winter_at)
    _err(_move(ines.api, item["id"], "scheduled", publish_at=future), 403, "lead_only", COPY["lead_only"])
    _err(_move(ines.api, item["id"], "published"), 409, "illegal_transition", "That move isn't allowed from Review.")
    _err(_move(ines.api, item["id"], "withdrawn", reason=REASON), 409, "illegal_transition", "That move isn't allowed from Review.")
    past = _iso(_server_now(tomas.api) - timedelta(hours=1))
    assert _err(_move(tomas.api, item["id"], "scheduled", publish_at=past), 422, "validation_failed")["fields"]["publish_at"] == COPY["after_now"]
    assert "publish_at" in _err(_move(tomas.api, item["id"], "scheduled", publish_at="2027-03-30T18:30:00"), 422, "validation_failed")["fields"]
    scheduled = _ok(_move(tomas.api, item["id"], "scheduled", publish_at=future), 200)["item"]
    assert scheduled["status"] == "scheduled" and scheduled["publish_at"] == _iso(winter_at)
    _ok(_move(ines.api, item["id"], "draft"), 200)
    edited = f"Edited {_tag()}"
    assert _ok(ines.api.patch(f"/api/curator/items/{item['id']}", {"title": edited}), 200)["item"]["title"] == edited
    a, b = _together(lambda: _move(ines.api.at(app_url), item["id"], "review"), lambda: _move(tomas.api.at(_outage("APP_SECOND_URL")), item["id"], "review"))
    assert sorted([a.status_code, b.status_code]) == [200, 409]
    _err(a if a.status_code == 409 else b, 409, "illegal_transition", "That move isn't allowed from Review.")


def test_scheduled_publish_server_clock(browser: Browser, app_url: str) -> None:
    ines, tomas, marta = _staff(app_url, INES), _staff(app_url, TOMAS), _staff(app_url, MARTA)
    item = _event(ines, 3, f"Timed {_tag()}")
    _ok(_move(ines.api, item["id"], "review"), 200)
    at = _server_now(tomas.api) + timedelta(seconds=PUBLISH_LEAD_S)
    _ok(_move(tomas.api, item["id"], "scheduled", publish_at=_iso(at)), 200)
    assert item["id"] not in [e["id"] for e in _get_json(app_url, "/api/timeline?chapter=3")["events"]]
    seen = _poll(lambda: item["id"] in [e["id"] for e in _get_json(app_url, "/api/timeline?chapter=3")["events"]] and _server_now(tomas.api), PUBLISH_LEAD_S + PUBLISH_DELAY_S * 3, "publication")
    assert seen <= at + timedelta(seconds=PUBLISH_DELAY_S + POLL_S + LATENCY_S * 2)
    rows = [r for r in _audit(marta.api) if r["action"] == "published" and r["target_id"] == item["id"]]
    assert len(rows) == 1 and rows[0]["actor_email"] == "system"
    later = _event(ines, 3, f"Far off {_tag()}")
    _ok(_move(ines.api, later["id"], "review"), 200)
    _ok(_move(tomas.api, later["id"], "scheduled", publish_at=_winter(tomas.api)), 200)
    with _device(browser, app_url + "/studio", at=FAR_DEVICE_TIME, person=tomas, base=app_url) as page:
        _includes(page, _row(page.get_by_role("table", name="Items", exact=True), later["title"]), "Scheduled")
    with _device(browser, app_url + "/timeline?chapter=3", at=FAR_DEVICE_TIME) as page:
        _includes(page, page.get_by_role("region", name="Search results", exact=True), item["title"])
        assert later["title"] not in _txt(page.get_by_role("region", name="Search results", exact=True))


def test_curator_notices(app_url: str, mail: Any) -> None:
    ines, tomas = _staff(app_url, INES), _staff(app_url, TOMAS)
    title = f"Notice {_tag()}"
    item = _event(ines, 2, title)
    _ok(_move(ines.api, item["id"], "review"), 200)
    assert len(_mails(mail, TOMAS, subject=f"For review: {title}")) == 1
    _publish(ines, tomas, item["id"])
    _ok(_move(ines.api, item["id"], "withdrawn", reason=REASON), 200)
    assert len(_mails(mail, INES, subject=f"Withdrawn: {title}")) == 1
    assert len(_mails(mail, TOMAS, subject=f"For review: {title}")) == 1


def test_media_uploads(browser: Browser, app_url: str) -> None:
    ines, visitor, s3 = _staff(app_url, INES), _visitor(app_url), S3()
    item = _event(ines, 2, f"Media {_tag()}")
    tag = _tag()
    png = _png(2)
    media = _ok(_upload(ines.api, item["id"], "image", f"Plate Scan ({tag}).PNG", png, "image/png"), 201)["media"]
    assert media["key"] == f"media/{media['id']}/plate-scan--{tag}-.png" and media["bytes"] == len(png) and media["content_type"] == "image/png"
    assert s3.get(media["key"]) == png
    assert _err(_upload(ines.api, item["id"], "narration", f"n-{tag}.mp3", _mp3(), "audio/mpeg"), 422, "validation_failed")["fields"]["transcript"] == COPY["transcript"]
    narration = _ok(_upload(ines.api, item["id"], "narration", f"v-{tag}.mp3", _mp3(), "audio/mpeg", "A short narration."), 201)["media"]
    assert s3.get(narration["key"]) == _mp3()
    rejects = [("image", f"r1-{tag}.gif", b"GIF89a" + bytes(32), "image/gif", COPY["file_type"]),
               ("image", f"r2-{tag}.png", b"\xff\xd8\xff\xe0" + bytes(64), "image/png", COPY["file_type"]),
               ("scan", f"r3-{tag}.pdf", _pdf(UPLOAD_LIMIT + 1), "application/pdf", COPY["file_size"])]
    for kind, name, data, ctype, copy in rejects:
        assert _err(_upload(ines.api, item["id"], kind, name, data, ctype), 422, "validation_failed")["fields"]["file"] == copy
    _ok(_upload(ines.api, item["id"], "scan", f"edge-{tag}.pdf", _pdf(UPLOAD_LIMIT), "application/pdf"), 201)
    assert "kind" in _err(_upload(ines.api, item["id"], "video", f"k-{tag}.png", png, "image/png"), 422, "validation_failed")["fields"]
    _err(_upload(ines.api, f"ev-missing-{tag}", "image", f"m-{tag}.png", png, "image/png"), 404, "not_found")
    _err(_upload(visitor.api, item["id"], "image", f"v-{tag}.png", png, "image/png"), 403, "forbidden")
    keys = s3.keys("media/")
    assert not [k for k in keys if any(k.endswith(r[1]) for r in rejects)]
    name = f"scan-{tag}.png"
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, ines, "/studio")
        form = page.get_by_role("form", name="Upload media", exact=True)
        _visible(page, form, "upload form")
        _choose(form.get_by_role("combobox", name="Kind", exact=True), "Scan")
        _choose(form.get_by_role("combobox", name="Item", exact=True), item["title"], item["id"])
        form.get_by_label("File", exact=True).set_input_files({"name": name, "mimeType": "image/png", "buffer": png})
        with held(page, "**/api/curator/media") as gate:
            click(_button(form, "Upload"))
            _shows(page, _status(page, "Upload status"), f"Uploading {name}.")
            gate.release()
        _shows(page, _status(page, "Upload status"), f"Upload complete: {name}.")
    assert any(k.endswith(f"/{name}") for k in s3.keys("media/"))


def test_lisbon_wall_clock_entry(browser: Browser, app_url: str) -> None:
    tomas, marta = _staff(app_url, TOMAS), _staff(app_url, MARTA)
    spring, autumn, winter = _spring_day(tomas.api), _autumn_day(tomas.api), _winter_day(tomas.api)
    repeated, after_change = _wall(autumn, REPEAT_HOUR), _wall(spring + timedelta(days=2), EVENING)
    winter_at, spring_at = _wall(winter, EVENING), _wall(spring, EVENING)
    assert [_iso(m)[-6:] for m in (repeated, after_change, winter_at, spring_at)] == ["+01:00", "+01:00", "+00:00", "+01:00"]
    item = _event(tomas, 3, f"Wall clock {_tag()}")
    _ok(_move(tomas.api, item["id"], "review"), 200)
    assert _ok(_move(tomas.api, item["id"], "scheduled", publish_at=_utc(repeated)), 200)["item"]["publish_at"] == _iso(repeated)
    _ok(_move(tomas.api, item["id"], "draft"), 200)
    _ok(_move(tomas.api, item["id"], "review"), 200)
    sent: list[str] = []
    with _device(browser, app_url + "/studio", tz=NEW_YORK, person=tomas, base=app_url) as page:
        page.on("request", lambda r: sent.append(r.url) if r.method == "POST" else None)

        def schedule(entry: str) -> Locator:
            row = _row(page.get_by_role("table", name="Items", exact=True), item["title"])
            _visible(page, row, "item row")
            click(_button(row, "Schedule"))
            dialog = _dialog(page, "Schedule")
            fill(_field(dialog, "Publish at (Lisbon time)"), entry)
            return dialog

        dialog = schedule(_entry(spring, REPEAT_HOUR))
        click(_button(dialog, "Schedule"))
        _includes(page, dialog, COPY["skipped"])
        assert not [u for u in sent if "/transitions" in u]
        page.keyboard.press("Escape")
        for entry, expected in ((_entry(autumn, REPEAT_HOUR), _iso(repeated)), (_entry(after_change.date(), EVENING), _iso(after_change)), (_entry(winter, EVENING), _iso(winter_at))):
            dialog = schedule(entry)
            with page.expect_request(lambda r: r.method == "POST" and r.url.endswith(f"/api/curator/items/{item['id']}/transitions")) as info:
                click(_button(dialog, "Schedule"))
            assert info.value.post_data_json["publish_at"] == expected
            _poll(lambda: _item(tomas.api, item["id"])["status"] == "scheduled", UI_WAIT_S, "scheduled")
            _ok(_move(tomas.api, item["id"], "draft"), 200)
            _ok(_move(tomas.api, item["id"], "review"), 200)
            page.reload()
    title = f"DST session {_tag()}"
    with _device(browser, app_url + "/box-office", tz=NEW_YORK, person=marta, base=app_url) as page:
        form = page.get_by_role("form", name="New session", exact=True)
        _visible(page, form, "New session form")
        fill(_field(form, "Title"), title)
        fill(_field(form, "Starts at (Lisbon time)"), _entry(spring, REPEAT_HOUR))
        fill(form.get_by_role("spinbutton", name="Duration in minutes", exact=True), "60")
        fill(form.get_by_role("spinbutton", name="Capacity", exact=True), "4")
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/api/manager/sessions") else None)
        click(_button(form, "Create session"))
        _includes(page, form, COPY["skipped"])
        assert posts == []
        fill(_field(form, "Starts at (Lisbon time)"), _entry(spring, EVENING))
        with page.expect_request(lambda r: r.method == "POST" and r.url.endswith("/api/manager/sessions")) as info:
            click(_button(form, "Create session"))
        assert info.value.post_data_json["starts_at"] == _iso(spring_at)
    made = _poll(lambda: next((s for s in _sessions(marta.api) if s["title"] == title), None), UI_WAIT_S, "session created")
    assert made["starts_at_display"] == _display(spring_at)


def test_wf_curation_journey(browser: Browser, app_url: str, mail: Any) -> None:
    priya, tomas = _staff(app_url, PRIYA), _staff(app_url, TOMAS)
    title = f"Vectors {_tag()}"
    empty = _get_json(app_url, "/api/timeline?chapter=8")["events"] == []
    try:
        with _device(browser, app_url + "/studio", tz=NEW_YORK, person=priya, base=app_url) as page:
            if empty:
                _includes(page, page.get_by_role("region", name=f"Chapter {CHAPTERS[8][0]} events", exact=True), COPY["empty_events"])
            click(_button(page, "New event"))
            dialog = _dialog(page, "New timeline event")
            _choose(dialog.get_by_role("combobox", name="Chapter", exact=True), "Chapter VIII", "VIII", "8")
            fill(dialog.get_by_role("spinbutton", name="Year", exact=True), str(EVENT_YEAR))
            fill(_field(dialog, "Title"), title)
            fill(_field(dialog, "Summary"), SUMMARY)
            click(_button(dialog, "Save draft"))
            _includes(page, _status(page, "Notices"), COPY["draft_saved"])
            item_id = _poll(lambda: next((i["id"] for i in _ok(priya.api.get("/api/curator/items"), 200)["items"] if i["title"] == title), None), UI_WAIT_S, "draft item")
            form = page.get_by_role("form", name="Upload media", exact=True)
            _choose(form.get_by_role("combobox", name="Kind", exact=True), "Scan")
            _choose(form.get_by_role("combobox", name="Item", exact=True), title, item_id)
            form.get_by_label("File", exact=True).set_input_files({"name": f"scan-{item_id}.png", "mimeType": "image/png", "buffer": _png(3)})
            click(_button(form, "Upload"))
            _shows(page, _status(page, "Upload status"), f"Upload complete: scan-{item_id}.png.")
            click(_button(_row(page.get_by_role("table", name="Items", exact=True), title), "Send to review"))
            _includes(page, _status(page, "Notices"), "Moved to Review.")
        assert len(_mails(mail, TOMAS, subject=f"For review: {title}")) == 1
        at = _server_now(tomas.api) + timedelta(seconds=PUBLISH_LEAD_S * 2)
        with _device(browser, app_url + "/studio", tz=NEW_YORK, person=tomas, base=app_url) as page:
            click(_button(_row(page.get_by_role("table", name="Items", exact=True), title), "Schedule"))
            dialog = _dialog(page, "Schedule")
            fill(_field(dialog, "Publish at (Lisbon time)"), _lisbon(at).strftime("%Y-%m-%d %H:%M:%S"))
            click(_button(dialog, "Schedule"))
            _includes(page, _status(page, "Notices"), "Moved to Scheduled.")
        _poll(lambda: title in [e["title"] for e in _get_json(app_url, "/api/timeline?chapter=8")["events"]], PUBLISH_LEAD_S * 2 + PUBLISH_DELAY_S * 3, "live on timeline")
        with open_app(browser, app_url + "/timeline") as page:
            _includes(page, page.get_by_role("region", name="Search results", exact=True), title)
        with _device(browser, app_url + "/studio", person=priya, base=app_url) as page:
            click(_button(_row(page.get_by_role("table", name="Items", exact=True), title), "Withdraw"))
            dialog = _dialog(page, "Withdraw")
            fill(_field(dialog, "Reason"), REASON)
            click(_button(dialog, "Withdraw"))
            _includes(page, _status(page, "Notices"), "Moved to Withdrawn.")
        assert len(_mails(mail, PRIYA, subject=f"Withdrawn: {title}")) == 1
        assert title not in [e["title"] for e in _get_json(app_url, "/api/timeline")["events"]]
    finally:
        for it in _ok(priya.api.get("/api/curator/items"), 200)["items"]:
            if it["title"] == title and it["status"] == "published":
                _move(priya.api, it["id"], "withdrawn", reason=REASON)


def test_wf_curation_role_buttons(browser: Browser, app_url: str) -> None:
    ines, tomas = _staff(app_url, INES), _staff(app_url, TOMAS)
    item = _event(ines, 2, f"Buttons {_tag()}")
    _ok(_move(ines.api, item["id"], "review"), 200)
    for person, has_schedule in ((ines, False), (tomas, True)):
        with _device(browser, app_url + "/studio", person=person, base=app_url) as page:
            row = _row(page.get_by_role("table", name="Items", exact=True), item["title"])
            _visible(page, _button(row, "Return to draft"), "Return to draft")
            assert (_button(row, "Schedule").count() == 1) == has_schedule
            assert _button(row, "Withdraw").count() == 0 and _button(row, "Send to review").count() == 0
    assert _item(ines.api, item["id"])["status"] == "review"


def test_refunds_capped(app_url: str, killbill: Any, mail: Any) -> None:
    marta, buyer = _staff(app_url, MARTA), _visitor(app_url)
    sess = _new_session(marta, f"Refund tour {_tag()}", _winter(marta.api), 4)
    order = _ok(_book(buyer, sess["id"], 2), 201)["order"]
    path = f"/api/manager/orders/{order['id']}/refunds"
    _err(buyer.api.post(path, {"amount_minor": 1500, "reason": REASON}, idempotency_key()), 403, "forbidden")
    _err(marta.api.post(path, {"amount_minor": 1500, "reason": REASON}), 400, "idempotency_key_required", COPY["key_required"])
    assert _kb_txns(killbill, buyer.email, "REFUND") == []
    rk = idempotency_key()
    first = marta.api.post(path, {"amount_minor": 1500, "reason": REASON}, rk)
    body = _ok(first, 201)
    assert body["order"]["refunded_minor"] == 1500 and body["order"]["status"] == "partially_refunded"
    replay = marta.api.post(path, {"amount_minor": 1500, "reason": REASON}, rk)
    assert replay.status_code == 201 and replay.json() == body and replay.headers.get("Idempotent-Replayed") == "true"
    _err(marta.api.post(path, {"amount_minor": 1501, "reason": REASON}, rk), 409, "idempotency_conflict", COPY["key_conflict"])
    assert [t["minor"] for t in _kb_txns(killbill, buyer.email, "REFUND")] == [1500]
    assert _session_state(marta.api, sess["id"])["seats_left"] == 2
    over = _err(marta.api.post(path, {"amount_minor": 1000, "reason": REASON}, idempotency_key()), 422, "validation_failed", COPY["validation"])
    assert over["fields"]["amount_minor"] == f"Refund can't exceed {_price(900, 'EUR')}."
    assert _err(marta.api.post(path, {"amount_minor": 900, "reason": "ab"}, idempotency_key()), 422, "validation_failed")["fields"]["reason"] == COPY["reason"]
    assert len(_kb_txns(killbill, buyer.email, "REFUND")) == 1
    final = _ok(marta.api.post(path, {"amount_minor": 900, "reason": REASON}, idempotency_key()), 201)["order"]
    assert final["refunded_minor"] == 2 * TICKET["EUR"] and final["status"] == "refunded"
    assert _session_state(marta.api, sess["id"])["seats_left"] == 4
    _err(marta.api.post(path, {"amount_minor": 1, "reason": REASON}, idempotency_key()), 409, "fully_refunded", COPY["fully_refunded"])
    assert len(_mails(mail, buyer.email, subject=f"Your refund — receipt {order['receipt_number']}", minimum=2)) == 2
    second = _ok(_book(buyer, sess["id"], 1), 201)["order"]
    _err(marta.api.at(_outage("APP_KILLBILL_DOWN_URL")).post(f"/api/manager/orders/{second['id']}/refunds", {"amount_minor": 100, "reason": REASON}, idempotency_key()), 503, "billing_unavailable")
    row = next(o for o in _ledger(marta, buyer.email) if o["id"] == second["id"])
    assert row["refunded_minor"] == 0 and row["refunds"] == []
    assert len(_kb_txns(killbill, buyer.email, "REFUND")) == 2
    assert _mails(mail, buyer.email, subject=f"Your refund — receipt {second['receipt_number']}", minimum=0) == []


def test_session_cancellation(app_url: str, killbill: Any, mail: Any) -> None:
    marta = _staff(app_url, MARTA)
    sess = _new_session(marta, f"Cancelled tour {_tag()}", _winter(marta.api), 10)
    buyers = [(_visitor(app_url), seats, cur) for seats, cur in ((1, "EUR"), (2, "GBP"), (1, "USD"))]
    for person, seats, cur in buyers:
        _ok(_book(person, sess["id"], seats, cur), 201)
    body = _ok(marta.api.post(f"/api/manager/sessions/{sess['id']}/cancel", {"reason": REASON}, idempotency_key()), 200)
    assert body["refunds"] == 3 and body["session"]["status"] == "cancelled"
    for person, seats, cur in buyers:
        order = _orders(person.api)[0]
        assert order["refunded_minor"] == order["amount_minor"] == seats * TICKET[cur] and order["status"] == "refunded"
        assert [t["minor"] for t in _kb_txns(killbill, person.email, "REFUND")] == [seats * TICKET[cur]]
        assert len(_mails(mail, person.email, subject=f"Cancelled: {sess['title']} — full refund issued")) == 1
        assert _mails(mail, person.email, prefix="Your refund", minimum=0) == []
        row = _ledger(marta, person.email)[0]
        assert sum(r["amount_minor"] for r in row["refunds"]) == row["refunded_minor"]
    _err(marta.api.post(f"/api/manager/sessions/{sess['id']}/cancel", {"reason": REASON}, idempotency_key()), 409, "session_not_cancellable", COPY["not_cancellable"])
    late = buyers[0][0]
    _err(_book(late, sess["id"]), 409, "booking_closed", COPY["booking_closed"])
    assert len(_kb_txns(killbill, late.email)) == 1


def test_refund_seat_consistency(app_url: str, killbill: Any) -> None:
    second = _outage("APP_SECOND_URL")
    marta, buyer = _staff(app_url, MARTA), _visitor(app_url)
    sess = _new_session(marta, f"Race tour {_tag()}", _winter(marta.api), 3)
    order = _ok(_book(buyer, sess["id"], 2), 201)["order"]
    path, body = f"/api/manager/orders/{order['id']}/refunds", {"amount_minor": 1500, "reason": REASON}
    a, b = _together(lambda: marta.api.at(app_url).post(path, body, idempotency_key()), lambda: marta.api.at(second).post(path, body, idempotency_key()))
    assert sorted([a.status_code, b.status_code]) == [201, 422]
    assert _err(a if a.status_code == 422 else b, 422, "validation_failed")["fields"]["amount_minor"] == f"Refund can't exceed {_price(900, 'EUR')}."
    assert [t["minor"] for t in _kb_txns(killbill, buyer.email, "REFUND")] == [1500]
    racers = [(_visitor(app_url), 2), (_visitor(app_url), 1)]
    results = _together(lambda: marta.api.at(second).post(path, {"amount_minor": 900, "reason": REASON}, idempotency_key()), *[lambda p=p, s=s: _book(p, sess["id"], s) for p, s in racers])
    assert results[0].status_code == 201
    live = 0
    for (person, seats), response in zip(racers, results[1:]):
        if response.status_code == 201:
            live += seats
        else:
            _err(response, 409, "sold_out", COPY["sold_out"])
            assert _kb_txns(killbill, person.email) == []
    assert _session_state(marta.api, sess["id"])["seats_left"] == 3 - live
    row = next(o for o in _ledger(marta, buyer.email) if o["id"] == order["id"])
    assert row["refunded_minor"] == sum(r["amount_minor"] for r in row["refunds"]) == 2 * TICKET["EUR"]
    assert sum(t["minor"] for t in _kb_txns(killbill, buyer.email, "REFUND")) == 2 * TICKET["EUR"]


def test_wf_box_office_journey(browser: Browser, app_url: str, killbill: Any) -> None:
    marta, buyers = _staff(app_url, MARTA), [_visitor(app_url), _visitor(app_url)]
    title = f"Box office {_tag()}"
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        _sign_cookie(page, app_url, marta, "/box-office")
        form = page.get_by_role("form", name="New session", exact=True)
        fill(_field(form, "Title"), title)
        fill(_field(form, "Starts at (Lisbon time)"), _entry(_winter_day(marta.api), EVENING))
        fill(form.get_by_role("spinbutton", name="Duration in minutes", exact=True), "60")
        fill(form.get_by_role("spinbutton", name="Capacity", exact=True), "4")
        click(_button(form, "Create session"))
        _includes(page, _status(page, "Notices"), COPY["session_created"])
        sess = _poll(lambda: next((s for s in _sessions(marta.api) if s["title"] == title), None), UI_WAIT_S, "session")
        orders = [_ok(_book(p, sess["id"]), 201)["order"] for p in buyers]
        page.reload()
        row = _row(page.get_by_role("table", name="Ledger", exact=True), orders[0]["receipt_number"])
        click(_button(row, "Refund"))
        dialog = _dialog(page, "Refund")
        fill(_field(dialog, "Amount"), "5")
        fill(_field(dialog, "Reason"), REASON)
        click(_button(dialog, "Issue refund"))
        _includes(page, _status(page, "Notices"), f"Refund of {_price(500, 'EUR')} issued.")
        click(_button_near(page, title, "Cancel session"))
        dialog = _dialog(page, "Cancel session")
        fill(_field(dialog, "Reason"), REASON)
        click(_button(dialog, "Cancel session"))
        _includes(page, _status(page, "Notices"), "Session cancelled. 2 bookings refunded.")
        staff, code = page.get_by_role("table", name="Staff actions", exact=True), "session_cancelled"
        _eventually(page, lambda: any(n in _txt(staff).casefold() for n in (code, code.replace("_", " "))),
                    "Staff actions shows the cancellation")
    assert sum(t["minor"] for t in _kb_txns(killbill, buyers[0].email, "REFUND")) == TICKET["EUR"]
    actions = {(r["action"], r["target_id"]) for r in _audit(marta.api)}
    assert {("session_created", sess["id"]), ("session_cancelled", sess["id"])} <= actions
    order = next(o for o in _ok(marta.api.get("/api/manager/orders"), 200)["orders"] if o["id"] == orders[0]["id"])
    targets = {str(order["id"]), *(str(r["id"]) for r in order["refunds"])}
    assert any(a == "refund" and str(t) in targets for a, t in actions), actions


def test_wf_box_office_refund_errors(browser: Browser, app_url: str, killbill: Any) -> None:
    marta, buyer = _staff(app_url, MARTA), _visitor(app_url)
    sess = _new_session(marta, f"Cap tour {_tag()}", _winter(marta.api), 4)
    order = _ok(_book(buyer, sess["id"]), 201)["order"]
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, marta, "/box-office")
        click(_button(_row(page.get_by_role("table", name="Ledger", exact=True), order["receipt_number"]), "Refund"))
        dialog = _dialog(page, "Refund")
        fill(_field(dialog, "Reason"), REASON)
        fill(_field(dialog, "Amount"), "12,5")
        click(_button(dialog, "Issue refund"))
        _includes(page, dialog.get_by_role("alert"), COPY["amount_format"])
        fill(_field(dialog, "Amount"), "13")
        click(_button(dialog, "Issue refund"))
        _includes(page, dialog, f"Refund can't exceed {_price(TICKET['EUR'], 'EUR')}.")
    assert _kb_txns(killbill, buyer.email, "REFUND") == []


def _recon(manager: Person, month: str) -> dict[str, dict]:
    rows = _ok(manager.api.get("/api/manager/reconciliation", month=month), 200)["currencies"]
    assert [r["currency"] for r in rows] == CURRENCIES
    for r in rows:
        assert r["difference_minor"] == r["ledger_net_minor"] - r["killbill_net_minor"] and r["matched"] == (r["difference_minor"] == 0)
    return {r["currency"]: r for r in rows}


def test_reconciliation(app_url: str, killbill: Any) -> None:
    base = _outage("APP_DUNNING_URL")
    marta, donor = _staff(base, MARTA), _visitor(base)
    month = _lisbon(_server_now(marta.api)).strftime("%Y-%m")
    before = _recon(marta, month)["JPY"]
    order = _ok(_donate(donor, RECON_AMOUNT, "JPY"), 201)["order"]
    assert [t["minor"] for t in _kb_txns(killbill, donor.email)] == [RECON_AMOUNT]
    mid = _recon(marta, month)["JPY"]
    assert mid["ledger_net_minor"] - before["ledger_net_minor"] == RECON_AMOUNT == mid["killbill_net_minor"] - before["killbill_net_minor"]
    _ok(marta.api.post(f"/api/manager/orders/{order['id']}/refunds", {"amount_minor": RECON_REFUND, "reason": REASON}, idempotency_key()), 201)
    after = _recon(marta, month)["JPY"]
    assert after["ledger_net_minor"] - mid["ledger_net_minor"] == -RECON_REFUND == after["killbill_net_minor"] - mid["killbill_net_minor"]
    assert after["difference_minor"] == before["difference_minor"]
    assert "month" in _err(marta.api.get("/api/manager/reconciliation", month="2026-13"), 422, "validation_failed")["fields"]
    _err(donor.api.get("/api/manager/reconciliation", month=month), 403, "forbidden")


def test_price_change_effective(browser: Browser, app_url: str, killbill: Any) -> None:
    marta = _staff(app_url, MARTA)
    name, currency = "Reader", "EUR"
    old = _price_now(marta.api, name, currency)
    tier = _tiers(marta.api)[name]
    member = _visitor(app_url)
    charged = date.fromisoformat(_ok(_join(member, name, currency), 201)["membership"]["charged_through"])
    today = _lisbon(_server_now(marta.api)).date()
    e1, e2 = today + timedelta(days=2), charged + timedelta(days=15)
    assert e1 <= charged
    new = old + PRICE_RISE

    def post(eff: date, amount: int) -> httpx.Response:
        return marta.api.post("/api/manager/plan-prices", {"tier": tier, "currency": currency, "amount_minor": amount, "effective_on": eff.isoformat()})

    assert _err(post(today, new), 422, "validation_failed")["fields"]["effective_on"] == COPY["after_today"]
    assert _ok(post(e1, new), 201)["change"] == {"tier": tier, "currency": currency, "amount_minor": new, "effective_on": e1.isoformat()}
    assert _membership(member.api)["next_charge"] == {"on": charged.isoformat(), "amount_minor": new}
    _err(post(e1, new), 409, "price_change_conflict", COPY["price_conflict"])
    _ok(post(e2, new + PRICE_RISE), 201)
    assert _membership(member.api)["next_charge"]["amount_minor"] == new
    entry = next(t for t in _get_json(app_url, "/api/catalog")["tiers"] if t["name"] == name)
    assert entry["prices"][currency] == old and {c["effective_on"] for c in entry["scheduled_changes"]} >= {e1.isoformat(), e2.isoformat()}
    newcomer = _visitor(app_url)
    assert _ok(_join(newcomer, name, currency), 201)["membership"]["price_minor"] == old
    assert [t["minor"] for t in _kb_txns(killbill, newcomer.email)] == [old]
    pattern = rf"From {_date_pattern(e1)}: {re.escape(_price(new, currency))} a month"
    with open_app(browser, app_url + "/support") as page:
        _eventually(page, lambda: re.search(pattern, _txt(page.get_by_role("main"))), "scheduled change on Support")
        click(_button(page, "Choose a plan"))
        dialog = _dialog(page, "Supporter plan")
        check(dialog.get_by_role("radio", name=name, exact=True))
        check(dialog.get_by_role("radio", name=currency, exact=True))
        _eventually(page, lambda: re.search(pattern, _txt(dialog)), "scheduled change in dialog")


def test_staff_action_record(app_url: str) -> None:
    second = _outage("APP_SECOND_URL")
    ines, marta, tomas, donor = _staff(app_url, INES), _staff(app_url, MARTA), _staff(app_url, TOMAS), _visitor(app_url)
    item = _event(ines, 2, f"Audit {_tag()}")
    _ok(ines.api.at(second).patch(f"/api/curator/items/{item['id']}", {"title": f"Audited {_tag()}"}), 200)
    _ok(_move(ines.api, item["id"], "review"), 200)
    sess = _new_session(marta, f"Audit tour {_tag()}", _winter(marta.api), 2)
    order = _ok(_donate(donor, DONATION_MIN), 201)["order"]
    notes = _together(*[lambda b=b: marta.api.at(b).post(f"/api/manager/orders/{order['id']}/notes", {"text": "Audit note"}) for b in (app_url, second, app_url)])
    assert [n.status_code for n in notes] == [201, 201, 201]
    first = _audit(marta.api)

    def rows(action: str, target: str) -> list[dict]:
        return [r for r in first if r["action"] == action and r["target_id"] == target]

    for action, target, actor in (("item_created", item["id"], INES), ("item_edited", item["id"], INES), ("transition", item["id"], INES), ("session_created", sess["id"], MARTA)):
        found = rows(action, target)
        assert len(found) == 1 and found[0]["actor_email"] == actor, (action, found)
    assert rows("transition", item["id"])[0]["detail"]["from"] == "draft" and rows("transition", item["id"])[0]["detail"]["to"] == "review"
    assert len(rows("order_note", order["id"])) == 3
    assert {r["id"] for r in _audit(tomas.api)} >= {r["id"] for r in first if r["target_id"] in (item["id"], sess["id"])}
    later = {r["id"]: r for r in _audit(marta.api.at(second))}
    assert all(later[r["id"]] == r for r in first)
    _err(ines.api.get("/api/manager/audit"), 403, "forbidden")
    _err(donor.api.get("/api/manager/audit"), 403, "forbidden")


def test_wf_reconciliation_month_view(browser: Browser, app_url: str) -> None:
    marta = _staff(app_url, MARTA)
    month = _lisbon(_server_now(marta.api)).strftime("%Y-%m")
    rows = _recon(marta, month)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, marta, "/box-office")
        table = page.get_by_role("table", name="Reconciliation", exact=True)
        _visible(page, table, "reconciliation table")
        for currency, row in rows.items():
            expected = "Matched" if row["matched"] else f"Difference {_price(abs(row['difference_minor']), currency)}"
            _includes(page, _row(table, currency), expected)


def test_wf_reconciliation_price_change(browser: Browser, app_url: str) -> None:
    marta = _staff(app_url, MARTA)
    name, currency = "Reader", "GBP"
    old = _price_now(marta.api, name, currency)
    effective = _lisbon(_server_now(marta.api)).date() + timedelta(days=3)
    new = old + PRICE_RISE
    entry = str(new) if currency == "JPY" else f"{new // 100}.{new % 100:02d}"
    with _device(browser, app_url + "/box-office", at=FAR_DEVICE_TIME, person=marta, base=app_url) as page:
        form = page.get_by_role("form", name="Price change", exact=True)
        _visible(page, form, "price change form")
        select(form.get_by_role("combobox", name="Tier", exact=True), name)
        select(form.get_by_role("combobox", name="Currency", exact=True), currency)
        fill(_field(form, "New price"), entry)
        fill(_field(form, "Effective from"), effective.isoformat())
        click(_button(form, "Schedule price change"))
        _eventually(page, lambda: re.search(rf"New price scheduled from {_date_pattern(effective)}\.", _txt(_status(page, "Notices"))), "price change notice")
    tier = next(t for t in _get_json(app_url, "/api/catalog")["tiers"] if t["name"] == name)
    assert {"currency": currency, "amount_minor": new, "effective_on": effective.isoformat()} in tier["scheduled_changes"]
    assert any(r["action"] == "price_change" for r in _audit(marta.api))


def test_wf_cross_cutting_health_ui(browser: Browser, app_url: str) -> None:
    for base in [app_url.rstrip("/")] + [_outage(e) for e in OUTAGE_ENVS]:
        assert _get_json(base, "/api/health") == {"status": "ok"}, base
    with open_app(browser, app_url + "/") as page:
        for numeral, title, _ in CHAPTERS.values():
            _visible(page, page.get_by_role("link", name=f"Chapter {numeral}: {title}", exact=True), title)


def test_server_boundary(app_url: str) -> None:
    base = app_url.rstrip("/")
    body = {"amount_minor": DONATION_MIN, "currency": "EUR", "card_number": APPROVED_CARD}
    foreign = post_json(base, "/api/donations", body, idempotency_key(), Origin=FOREIGN_ORIGIN)
    _err(foreign, 403, "forbidden_origin", COPY["forbidden_origin"])
    assert not [h for h in foreign.headers if h.lower().startswith("access-control-")]
    _err(post_json(base, "/api/donations", body, idempotency_key(), Origin=_origin(base)), 401, "unauthenticated", COPY["unauthenticated"])
    plain = httpx.post(base + "/api/auth/login", content="email=x", headers={"Content-Type": "text/plain", "Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S)
    _err(plain, 415, "unsupported_media_type", COPY["send_json"])

    def padded(total: int) -> str:
        data = {"email": "nobody@halden.test", "password": PASSWORD, "pad": ""}
        data["pad"] = "a" * (total - len(json.dumps(data)))
        text_ = json.dumps(data)
        assert len(text_.encode()) == total
        return text_

    big = httpx.post(base + "/api/auth/login", content=padded(JSON_LIMIT + 1), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
    _err(big, 413, "payload_too_large", COPY["too_large"])
    edge = httpx.post(base + "/api/auth/login", content=padded(JSON_LIMIT), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
    assert edge.status_code not in (413, 415) and "error" in edge.json()
    _err(httpx.get(base + f"/api/no-such-thing-{_tag()}", timeout=HTTP_TIMEOUT_S), 404, "not_found", COPY["not_found"])
    for path in PRIVATE_PATHS:
        assert httpx.get(base + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    html = httpx.get(base + "/", timeout=HTTP_TIMEOUT_S).text
    served = [html] + [httpx.get(base + p, timeout=HTTP_TIMEOUT_S).text for p in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css|mjs))"', html)]
    for env in SECRET_ENVS:
        secret = os.environ.get(env, "")
        if len(secret) >= 6 and not secret.isalpha():
            assert not any(secret in s for s in served), env


def _plate_shown(plates: Locator) -> str:
    return plates.evaluate(
        "r => { const vis = n => { const b = n.getBoundingClientRect(), s = getComputedStyle(n);"
        " return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.5; };"
        " const media = [...r.querySelectorAll('img, image, canvas, svg')].filter(vis)"
        ".map(n => n.currentSrc || n.getAttribute('src') || n.getAttribute('href') || n.getAttribute('aria-label') || '');"
        " return (r.innerText || '').trim() + ' | ' + media.join(' '); }")


def test_wf_cross_cutting_reduced_motion(browser: Browser, app_url: str) -> None:
    for options in ({"reduced_motion": "reduce"}, {}):
        with open_app(browser, app_url + "/chapters/7", **options) as page:
            if not options:
                click(page.get_by_role("switch", name="Motion", exact=True))
            _visible(page, page.get_by_role("radiogroup", name="Viewpoints", exact=True), "still viewpoints")
            plates = page.get_by_role("region", name="Plates", exact=True)
            _to_middle(plates)
            with suppress(AssertionError):
                _poll(lambda: plates.evaluate("r => [...r.querySelectorAll('img')].filter(i => i.getClientRects().length).every(i => i.complete)"),
                      SETTLE_S, "the plate images loaded")
            _still(page, plates.bounding_box())
            shown = _plate_shown(plates)
            before = decode(capture(plates))
            advance(page, PLATE_HOLD_MS * 2)
            assert _plate_shown(plates) == shown and difference(before, decode(capture(plates))) == 0, "plates advanced on their own"
            moving = [a for a in animations(plates) if a["playState"] == "running" and a["duration"] > MOTION_MS]
            assert moving == [], moving
            click(_button(page, "Next plate"))
            advance(page, AT_ONCE_MS)
            _eventually(page, lambda: _plate_shown(plates) != shown, "Next plate shows another plate")
            _enter_chapter(page)
            click(_button(page, "Train"))
            model = _train(_points(CLASSIFIER_SEED["training"]))
            expected = f"Training finished. Held-out accuracy {_score(model)[0]}% after {model[3]} epochs."
            advance(page, AT_ONCE_MS)
            _eventually(page, lambda: _txt(_status(page, "Classifier results")) == expected, "train result at once", step_ms=0)


@pytest.mark.parametrize("viewport", ["phone", "tablet", "desktop"], ids=["phone", "tablet", "desktop"])
def test_label_below_scene(browser: Browser, app_url: str, viewport: str) -> None:
    size = {"phone": PHONE, "tablet": (768, 1024), "desktop": DESKTOP}[viewport]
    with open_app(browser, app_url + "/chapters/1") as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        scene, align = page.get_by_role("region", name="Sightline scene", exact=True), _button(page, "Align")
        _visible(page, scene, "Sightline scene")
        _visible(page, align, "Align")
        if viewport == "desktop":
            right = align.evaluate("e => e.getBoundingClientRect().right")
            assert right <= size[0] * 5 / 12, f"Align ends at {right}px, outside the left four columns"
            return
        art = scene.evaluate(
            "r => { const area = n => { const b = n.getBoundingClientRect(); return b.width * b.height; };"
            " const c = [...r.querySelectorAll('canvas')].filter(n => area(n) > 0).sort((a, b) => area(b) - area(a))[0]"
            " || r.querySelector('[role=radiogroup]');"
            " if (!c) return null; const b = c.getBoundingClientRect(); return b.top + b.height / 2 + window.scrollY; }")
        assert art is not None, "no scene canvas or still viewpoints"
        top = align.evaluate("e => e.getBoundingClientRect().top + window.scrollY")
        assert top > art, f"Align starts at {top}px, above the middle of the scene at {art}px: the label is not below it"


def test_search_status_while_pending(browser: Browser, app_url: str) -> None:
    n_lo, n_logic = (len(_get_json(app_url, f"/api/search?q={q}")["results"]) for q in ("lo", "logic"))
    assert n_lo != n_logic and n_lo > 1
    held: list[Any] = []
    with open_app(browser, app_url + "/timeline") as page:

        def handler(route: Any) -> None:
            if parse_qs(urlparse(route.request.url).query).get("q") == ["logic"]:
                held.append(route)
            else:
                route.continue_()

        page.route(lambda url: urlparse(url).path == "/api/search", handler)
        box, status = page.get_by_role("searchbox", name="Search the archive", exact=True), _status(page, "Search status")
        _visible(page, box, "search box")
        box.type("lo")
        advance(page, DEBOUNCE_MS)
        _shows(page, status, f'{n_lo} results for "lo".')
        box.type("gic")
        advance(page, DEBOUNCE_MS)
        _eventually(page, lambda: held, "the logic search held")
        advance(page, AT_ONCE_MS)
        assert _txt(status) != f'{n_lo} results for "logic".', "Search status names the new text with the old count"
        held[0].continue_()
        expected = '1 result for "logic".' if n_logic == 1 else f'{n_logic} results for "logic".'
        _shows(page, status, expected)


def test_create_account_dialog_focus(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        opener = _button(page, "Sign in").first
        _visible(page, opener, "Sign in")
        click(opener)
        click(_button(_dialog(page, "Sign in"), "Create an account"))
        dialog = _dialog(page, "Create an account")
        _eventually(page, lambda: _holds_focus(dialog), "focus inside Create an account")
        for key in ("Tab", "Shift+Tab"):
            for _ in range(DIALOG_TABS):
                page.keyboard.press(key)
                assert _holds_focus(dialog), f"{key} took focus out of Create an account"


def test_wf_booking_locked_currency_keyboard(browser: Browser, app_url: str) -> None:
    marta, person = _staff(app_url, MARTA), _visitor(app_url)
    _err(_join(person, "Reader", "JPY", DECLINED_CARD), 402, "card_declined")
    sess = _new_session(marta, f"Locked yen {_tag()}", _iso(_server_now(marta.api) + BOOKING_CLOSE * 2), 4)
    locked = "Your supporter account pays in JPY. Choose JPY to continue."
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/sessions")
        book = _button(page, f"Book {sess['title']}")
        _visible(page, book, "Book button")
        _tab_to(page, book)
        page.keyboard.press("Enter")
        dialog = _dialog(page, "Book a guided session")
        currency = dialog.get_by_role("radiogroup", name="Currency", exact=True)
        for code in ("EUR", "GBP", "USD"):
            _eventually(page, lambda code=code: currency.get_by_role("radio", name=code, exact=True).is_disabled(), f"{code} disabled")
        _includes(page, dialog, locked)
        yen = currency.get_by_role("radio", name="JPY", exact=True)
        _eventually(page, lambda: yen.is_checked() or yen.is_enabled(), "JPY available")
        if not yen.is_checked():
            _tab_to(page, yen)
            page.keyboard.press("Space")
        _eventually(page, lambda: yen.is_checked(), "JPY chosen")
        _tab_to(page, _field(dialog, "Card number"))
        page.keyboard.type(APPROVED_CARD)
        _tab_to(page, _button(dialog, "Pay and book"))
        page.keyboard.press("Enter")
        _includes(page, dialog, f"{sess['title']}, ")
    assert [o["currency"] for o in _orders(person.api)] == ["JPY"]


def test_membership_conflicts_first(app_url: str, killbill: Any) -> None:
    bad_card = "1234"
    member = _visitor(app_url)
    _ok(_join(member, "Reader", "EUR"), 201)
    body = {"tier": _tiers(member.api)["Patron"], "currency": "EUR", "card_number": bad_card}
    _err(member.api.post("/api/me/membership", body, idempotency_key()), 409, "already_member", COPY["already_member"])
    donor = _visitor(app_url)
    _ok(_donate(donor, DONATION_MIN, "GBP"), 201)
    body = {"tier": _tiers(donor.api)["Reader"], "currency": "EUR", "card_number": bad_card}
    _err(donor.api.post("/api/me/membership", body, idempotency_key()), 409, "currency_locked",
         "Your supporter account pays in GBP. Choose GBP to continue.")
    stranger = _visitor(app_url)
    _err(stranger.api.post("/api/me/membership/change", {"tier": "unknown-tier"}, idempotency_key()), 409, "not_a_member",
         COPY["not_a_member"])
    assert len(_kb_txns(killbill, member.email)) == 1 and len(_kb_txns(killbill, donor.email)) == 1
    assert _kb_txns(killbill, stranger.email) == []


def test_transition_refusals_first(app_url: str) -> None:
    ines, priya = _staff(app_url, INES), _staff(app_url, PRIYA)
    item = _event(ines, 2, f"Refusal order {_tag()}")
    later = _iso(_server_now(ines.api) + timedelta(days=1))
    _err(_move(ines.api, item["id"], "scheduled", publish_at=later), 403, "lead_only", COPY["lead_only"])
    _err(_move(priya.api, item["id"], "withdrawn", reason=REASON), 403, "forbidden", COPY["forbidden"])
    mine = next(i for i in _ok(ines.api.get("/api/curator/items"), 200)["items"] if i["id"] == item["id"])
    assert mine["status"] == "draft"


def test_reconciliation_server_month(browser: Browser, app_url: str) -> None:
    marta = _staff(app_url, MARTA)
    month = _lisbon(_server_now(marta.api))

    def names_month(text: str) -> bool:
        text = " ".join(text.split()).casefold()
        forms = (f"{month.year}-{month.month:02d}", f"{month.month:02d}/{month.year}", f"{month.month}/{month.year}",
                 f"{month.strftime('%B')} {month.year}".casefold(), f"{month.strftime('%b')} {month.year}".casefold())
        return any(form in text for form in forms)

    with _device(browser, app_url + "/box-office", at=FAR_DEVICE_TIME, person=marta, base=app_url) as page:
        box = page.get_by_role("combobox", name="Month", exact=True)
        _visible(page, box, "Month picker")
        _eventually(page, lambda: names_month(_combo_label(box)) or names_month(box.input_value()), "the server's month selected")


def test_manual_retry_counts_an_attempt(app_url: str) -> None:
    marta = _staff(app_url, MARTA)
    person = _overdue(app_url)

    def row() -> dict | None:
        return next((r for r in _ok(marta.api.get("/api/manager/dunning"), 200)["overdue"] if r["user_email"] == person.email), None)

    assert _poll(row, UI_WAIT_S, "the overdue supporter on the dunning list")["attempts"] == 1
    _err(person.api.post("/api/me/membership/retry", {}, idempotency_key()), 402, "card_declined", COPY["card_declined"])
    assert _poll(lambda: (r := row()) and r["attempts"] == 2 and r, UI_WAIT_S, "two declined attempts on the dunning list")


def test_cancel_during_billing_outage_changes_nothing(app_url: str) -> None:
    marta, buyer = _staff(app_url, MARTA), _visitor(app_url)
    sess = _new_session(marta, f"Outage cancel {_tag()}", _iso(_server_now(marta.api) + BOOKING_CLOSE * 2), 4)
    order = _ok(_book(buyer, sess["id"]), 201)["order"]
    down = _staff(_outage("APP_KILLBILL_DOWN_URL"), MARTA)
    _err(down.api.post(f"/api/manager/sessions/{sess['id']}/cancel", {"reason": REASON}, idempotency_key()), 503, "billing_unavailable")
    listed = next(s for s in _ok(marta.api.get("/api/sessions"), 200)["sessions"] if s["id"] == sess["id"])
    assert listed["status"] == "on_sale" and listed["seats_left"] == 3, listed
    assert next(o for o in _orders(buyer.api) if o["id"] == order["id"])["refunded_minor"] == 0
    done = _ok(marta.api.post(f"/api/manager/sessions/{sess['id']}/cancel", {"reason": REASON}, idempotency_key()), 200)
    assert done["refunds"] == 1 and done["session"]["status"] == "cancelled"


def test_plan_dialog_shows_confirmed_tier(browser: Browser, app_url: str) -> None:
    person = _visitor(app_url)
    _ok(_join(person, "Patron", "EUR"), 201)
    with open_app(browser, app_url + "/") as page:
        _sign_cookie(page, app_url, person, "/support")
        click(_button(page, "Support"))
        dialog = _dialog(page, "Supporter plan")
        tiers = dialog.get_by_role("radiogroup", name="Tier", exact=True)
        patron, reader = tiers.get_by_role("radio", name="Patron", exact=True), tiers.get_by_role("radio", name="Reader", exact=True)
        _eventually(page, lambda: patron.is_checked(), "the current tier checked")
        check(reader)
        click(_button(dialog, "Change plan"))
        _includes(page, _status(page, "Notices"), "Your change to Reader is pending until ")
        _eventually(page, lambda: patron.is_checked() and not reader.is_checked(), "the confirmed tier checked again")
        _visible(page, _button(dialog, "Undo pending change"), "Undo pending change")


def test_malformed_body_precedence(app_url: str) -> None:
    base = app_url.rstrip("/")

    def send(origin: str) -> tuple[int, str]:
        r = httpx.post(base + "/api/donations", content="{",
                       headers={"Content-Type": "application/json", "Idempotency-Key": idempotency_key(), "Origin": origin},
                       timeout=HTTP_TIMEOUT_S)
        try:
            return r.status_code, r.json()["error"]["code"]
        except (ValueError, KeyError, TypeError):
            return r.status_code, ""

    assert send(FOREIGN_ORIGIN) in {(403, "forbidden_origin"), (415, "unsupported_media_type")}
    assert send(_origin(base)) in {(401, "unauthenticated"), (415, "unsupported_media_type")}


def _shipped() -> dict[tuple[str, str], dict]:
    root = Path("/app") if Path("/app/node_modules").is_dir() else Path(DEPLOYED_APP)
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=root, capture_output=True, text=True, timeout=600)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple[str, str], dict] = {}

    def walk(deps: dict | None) -> None:
        for name, info in (deps or {}).items():
            if info.get("version") and not info.get("missing"):
                found[(name, info["version"])] = info
            walk(info.get("dependencies"))

    walk(tree.get("dependencies"))
    return found


def _licence(info: dict) -> str:
    value = info.get("license")
    if not value and info.get("path"):
        manifest = Path(info["path"], "package.json")
        value = json.loads(manifest.read_text()).get("license") if manifest.exists() else None
    if isinstance(value, dict):
        value = value.get("type")
    return str(value or "")


def _allowed(expression: str) -> bool:
    expr = expression.strip().strip("()")
    if " OR " in expr:
        return any(_allowed(p) for p in expr.split(" OR "))
    if " AND " in expr:
        return all(_allowed(p) for p in expr.split(" AND "))
    return expr.strip("() ") in LICENCES


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"} and manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) and v for v in manifest.values())


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{n}@{v}" for (n, v) in _shipped() if n not in notices or v not in notices]
    assert not missing, missing[:20]
    for font in FONTS:
        assert font in notices, font


def test_if_licences() -> None:
    bad = {f"{n}@{v}": _licence(i) for (n, v), i in _shipped().items() if not _allowed(_licence(i))}
    assert not bad, bad


def test_if_no_extra_datastore() -> None:
    assert not {n for (n, _) in _shipped()} & DATASTORE_PACKAGES
    files = [p for p in Path("/app").rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not files, files


def test_if_fonts_self_hosted(browser: Browser, app_url: str) -> None:
    fonts: list[str] = []
    with open_app(browser, app_url + "/") as page:
        page.on("request", lambda r: fonts.append(r.url) if r.resource_type == "font" else None)
        page.reload()
        _visible(page, page.get_by_role("link", name=_card(1), exact=True), "index")
        families = page.evaluate("() => [...document.fonts].map(f => f.family.replace(/[\"']/g, ''))")
    assert fonts and all(_origin(u) == _origin(app_url) for u in fonts), fonts
    for font in FONTS:
        assert font in families, font
    assert "OFL" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_services_unchanged(killbill: Any) -> None:
    killbill.account("nobody@halden.test")
    assert {"users", "saved_paths", "bookmarks", "preferences"} <= set(PocketBase().collections())
    examples = (".example", ".sample", ".template", ".dist")
    for env_file in [p for p in Path("/app").glob(".env*") if p.is_file() and not p.name.endswith(examples)]:
        for line in env_file.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() in os.environ and value:
                assert value.strip().strip('"') == os.environ[key.strip()], f"{env_file.name}: {key}"


def test_if_no_external_requests(browser: Browser, app_url: str) -> None:
    seen: list[str] = []
    with open_app(browser, app_url + "/") as page:
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/", "/chapters/4", "/timeline", "/sources", "/sessions", "/support"):
            page.goto(app_url.rstrip("/") + path)
            advance(page, PLATE_HOLD_MS)
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and _origin(u) != _origin(app_url) and "X-Amz-Signature" not in u]
    assert not foreign, foreign[:10]


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", ".git", "coverage", "public", ".next", "out"}
    files = [p for p in Path("/app").rglob("*") if p.is_file() and not skip & set(p.parts) and not p.name.startswith(".")]
    assert [p for p in files if p.suffix in (".ts", ".tsx")]
    js = [p for p in files if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and ".config." not in p.name]
    assert not js, js[:10]
