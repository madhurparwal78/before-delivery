from __future__ import annotations

import calendar
import importlib
import json
import os
import re
import signal
import socket
import statistics
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from datetime import date, datetime, timedelta, timezone
from datetime import time as dtime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

import conftest as kit
from conftest import (
    advance,
    capture,
    check,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    select,
    session,
    tab_order,
    unique,
)
KIT_MODULES = ("conftest", "mailpit", "kit.mailpit", "helpers.mailpit", "clients.mailpit")


def kit_helper(name: str) -> Callable[..., Any]:
    for module in KIT_MODULES:
        try:
            found = getattr(importlib.import_module(module), name, None)
        except ImportError:
            continue
        if found is not None:
            return found
    raise AssertionError(f"kit helper {name} is not available")


def addresses(field: Any) -> list[str]:
    return kit_helper("addresses")(field)


def text(message: dict[str, Any]) -> str:
    return kit_helper("text")(message)


def mail_from_address() -> str:
    return kit_helper("mail_from_address")()

APP_PORT = 4173
MAX_BODY = 65536
SCROLL_TRAVEL = 2400
YAW_EDGE = 12
GROUND_TOL = 16
SOLD_GROUND_MIN = 0.90
COVERED_GROUND_MAX = 0.20
SPAN_MARGIN = 0.20
LONG_MIN_MS = 480
LONG_MAX_MS = 720
MEDIUM_MIN_MS = 240
MEDIUM_MAX_MS = 400
PREF_MS = 500
CONTEXT_MS = 1000
SCENE_READY_S = 5
POLL_CATCHUP_MS = 7000
BANNER_S = 20
STATUS_S = 15
RECOVER_S = 15
BILLING_503_S = 6
STEPUP_S = 2
TIMING_SPREAD_MS = 150
TIMING_SAMPLES = 10
RATE_LIMIT = 3
RATE_WINDOW_S = 600
WRONG_BEFORE_LOCK = 4
HOLD_TTL_DEFAULT = 600
HOLD_TTL_MIN = 10
ONE_MINUTE_S = 60
RETRY_DELAYS = (5, 15, 45)
RETRY_SLACK_S = 4
MAX_ATTEMPTS = 4
FIRST_ATTEMPT_S = 2
MAIL_CHECK_S = 5
BAR_CENTS = 1100
SHIPPING_CENTS = 900
CREDIT_MIN = 100
CREDIT_MAX = 2500
CURE_MIN = 28
CURE_MAX = 60
BARS_MAX = 24
SEED_LIVE = "B-0412"
SEED_LIVE_BARS = 12
SEED_SCHEDULED = "B-0413"
SEED_SCHEDULED_BARS = 10
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
WIDE = 1024
HYPHENS = "----------"
NBSP = "\u00a0"
TIME_ZONE = "America/Toronto"
QC_ONE_TOTAL = 2300
QC_TWO_TOTAL = 3564
ON_ONE_TOTAL = 2260
TRIO_LIST = 3300
TRIO_DISCOUNT = 396
TRIO_QC_TOTAL = 3339
REFUND_FIRST = 1265
REFUND_FINAL = 2299
FIRST_GST = 55
FIRST_QST = 110
FINAL_GST = 100
FINAL_QST = 199
UI_CREDIT_CENTS = 2500
HOLD_LEFT = "10:00"
ORDER_RE = r"PDL-\d{6}"
SUB_RE = r"SUB-\d{6}"
RF_RE = r"RF-\d{6}"
CR_RE = r"CR-\d{6}"
CT_RE = r"CT-\d{6}"
BATCH_RE = r"B-\d{4}"
TIMER_RE = re.compile(r"^\d+:\d{2}$")
CORS_HEADER = "access-control-allow-origin"
INJECTED = "x@example.ca"

CAPTION = "Cut <c> of <N>"
COUNTS = "Cut <cut> · Available <a> · Held <h> · Sold <s>"
BAR_ITEMS = {"available": "Bar <k>: available", "held": "Bar <k>: held", "sold": "Bar <k>: sold"}
BAR_LETTERS = {"available": "A", "held": "H", "sold": "S"}
GO_CHECKOUT = "Go to checkout (<n>)"
HELD_ROW = "Bar <k> · <scent> · <batch>"
TIMER_NAME = "Hold time left for bar <k>"
RELEASE_NAME = "Release bar <k>"
REFUND_BAR = "Refund bar <k>"
PAY_NAME = "Pay <total>"
CART_COPY = {
    "en-CA": {"held": "Bar <k> is held for you. Time left: <left>.",
              "minute": "One minute left on your hold for bar <k>.",
              "ended": "Your hold on bar <k> ended. The bar is back in the drop.",
              "released": "Bar <k> released.",
              "total": "Total is now <total>."},
    "fr-CA": {"held": "Le pain <k> est réservé pour vous. Temps restant : <left>.",
              "total": "Le total est maintenant de <total>."},
}
ORDER_PLACED = "Order <order> placed"
SUB_HEADING = "Subscription <sub>"
SUB_STARTED = "Subscription started. Charged today: <amount>."
SKIPPED = "Your <date> delivery is skipped. Next bill date: <date>."
UNSKIPPED = "Skip undone. Next bill date: <date>."
SWAPPED = "Your Trio scent is now <scent>."
CADENCE_CHANGED = "From <date>, your Trio arrives <cadence lower-case label>."
PAUSED = "Paused. Nothing is billed after <date>."
RESUMED = "Resumed. Next bill date: <date>."
LOCKED = "This cycle is locked. Changes open again after <date>."
STALE_WITH = "Reconciliation is stale: Kill Bill could not be reached. Showing figures from <checked>."
STALE_NONE = "Reconciliation is stale: Kill Bill could not be reached. No earlier figures for this month."
LOAF_LOGGED = "Loaf <code> logged."
CUT_SAVED = "<code> cut into <N> bars."
OPENED = "<code> is on sale now."
REFUND_ISSUED = "Refund <rf> issued: <amount>."
REFUND_FAILED = "Kill Bill is unreachable. Refund <rf> is recorded as failed; nothing was paid back."
CREDIT_ADDED = "Credit <cr> added: <amount>."
FIGURE_ACCEPTED = "Kill Bill's figure of <amount> is now the shop record for <key>."
ORPHAN_REFUNDED = "Orphan payment <key> refunded: <amount>."
CONTACT_OK = "Thanks. Your reference is <ct>. We'll reply by email."
ORDER_BAR_LINE = "Bar <k> · <batch> · <scent>: <price>"
MAIL_LINES = {"subtotal": "Subtotal: <money>", "total": "Total: <money>",
              "charged": "Charged today: <money>", "trio": "Trio: <scent>",
              "cadence": "Cadence: <cadence label>", "amount": "Amount: <money>",
              "refunded": "Refunded: <money>", "topic": "Topic: <topic label>",
              "discount": "Subscribe-and-save (12%): -<money>"}

STAFF = {
    "maker": ("maker@paindelune.example", "lune-maker-2026"),
    "finance": ("finance@paindelune.example", "lune-finance-2026"),
    "packing": ("packing@paindelune.example", "lune-packing-2026"),
}

HTTP_TIMEOUT = 30
POLL_S = 0.25
MAIL_WAIT_S = 120
MAIL_SETTLE_S = 3
EXPECT_MS = 15000
LOAD_S = 30
PAGE_STEP_MS = 250
FRAME_STEP_MS = 10
FRAME_MS = 50
TIMING_LIMIT_MS = 3000
NETWORK_GRACE_S = 5
COPY_BOOT_S = 180
RETRY_WAIT_S = 120
RELAY_CONNECT_S = 5
SECRET_MIN_LEN = 8
SCHEDULE_AHEAD_MIN = 2
AUTO_OPEN_S = 240
LOCK_PROBE_HOURS = 2400
SHORT_WINDOW_S = 10
SHORT_TTL_S = 70
DRAIN_S = MAIL_CHECK_S + 2 * RETRY_SLACK_S

SHIP = {"name": "Ana Probe", "line1": "4521 rue Saint-Denis", "city": "Montreal",
        "province": "QC", "postal_code": "H2T 1S6"}
REASON = "Damaged in transit"
MESSAGE = "Bonjour, une question sur vos savons."
KILLBILL_DOWN = os.environ.get("APP_KILLBILL_DOWN_URL", "")
MAIL_DOWN = os.environ.get("APP_MAILPIT_DOWN_URL", "")

CHECK_FIELDS = "Check these fields."
CANT_SET = "This field can't be set."
SUB_BANNER = ("Subscription changes are paused: our billing system is unreachable. "
              "Nothing has been changed.")
DROP_BANNER = ("Checkout is paused: our payment system is unreachable. "
               "Held bars stay held until their timer ends.")
CHECKOUT_503 = "Checkout is paused: our payment system is unreachable."
RATE_COPY = "Too many codes were requested for this email. Wait a few minutes, then try again."
LOCK_COPY = "Too many incorrect codes. Wait a few minutes, then request a new code."
CODE_FIELD = "That code doesn't match or has expired. Request a new code."
NOT_FOUND_LINE = "That page or record doesn't exist, or it isn't yours."
FORBIDDEN_HOSTS = ["killbill", "postgres", "mailpit", "localhost", "127.0.0.1"]
UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
PAYMENT_CALL = re.compile(rb"POST [^ ]*/(?:payments|invoicePayments)(?:[?/ ])")
REFUND_CALL = re.compile(rb"POST [^ ]*/refunds(?:[? ])")


def money(cents: int) -> dict[str, Any]:
    return {"cents": cents, "currency": "CAD"}


def money_text(cents: int, locale: str = "en-CA") -> str:
    sign = "-" if cents < 0 else ""
    whole, part = divmod(abs(cents), 100)
    if locale == "fr-CA":
        return f"{sign}{whole:,}".replace(",", NBSP) + f",{part:02d}{NBSP}$"
    return f"{sign}${whole:,}.{part:02d}"


def french_spaces(value: str) -> str:
    return re.sub(r" (?=[:$%])", NBSP, value)


def fill_copy(template: str, **values: Any) -> str:
    for name, value in values.items():
        template = template.replace(f"<{name}>", str(value))
    return template


def copy_re(template: str, **values: str) -> re.Pattern[str]:
    parts = re.split(r"(<[^<>]+>)", template)
    rx = "".join(values.get(p[1:-1], ".+") if i % 2 else re.escape(p) for i, p in enumerate(parts))
    return re.compile(f"^{rx}$")


def bar_letters(*words: str) -> str:
    return "".join(BAR_LETTERS[w] for w in words)


def bar_item(k: int, word: str) -> str:
    return fill_copy(BAR_ITEMS[word], k=k)


def counts(cut: int, a: int, h: int, s: int) -> str:
    return fill_copy(COUNTS, cut=cut, a=a, h=h, s=s)


def cart_copy(event: str | None, k: int | None = None, total: int | None = None, locale: str = "en-CA") -> str:
    parts = []
    if event:
        parts.append(fill_copy(CART_COPY[locale][event], k=k, left=HOLD_LEFT))
    if total is not None:
        parts.append(fill_copy(CART_COPY[locale]["total"], total=money_text(total, locale)))
    joined = " ".join(parts)
    return french_spaces(joined) if locale == "fr-CA" else joined


def go_link(page: Any, n: int) -> Any:
    return page.get_by_role("link", name=fill_copy(GO_CHECKOUT, n=n), exact=True)


def release_button(page: Any, k: int) -> Any:
    return page.get_by_role("button", name=fill_copy(RELEASE_NAME, k=k), exact=True)


def pay_button(page: Any, cents: int) -> Any:
    return page.get_by_role("button", name=fill_copy(PAY_NAME, total=money_text(cents)), exact=True)


def utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso_ms(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def shift_months(anchor: date, months: int, day: int | None = None) -> date:
    year, month = divmod(anchor.month - 1 + months, 12)
    year += anchor.year
    month += 1
    return date(year, month, min(day or anchor.day, calendar.monthrange(year, month)[1]))


def eventually(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    expired = False
    while not expired:
        try:
            value = fn()
        except (AssertionError, httpx.HTTPError, KeyError) as exc:
            value, last = None, exc
        if value:
            return value
        expired = time.monotonic() > deadline
        if not expired:
            threading.Event().wait(POLL_S)
    raise AssertionError(f"{what}: not reached within {seconds}s ({last!r})")


def person(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    email = first if "@" in first else second
    name = second if email == first else first
    return name, email.lower()


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def error(r: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert r.status_code == status, f"{r.status_code} {r.text}"
    body = r.json()
    assert set(body) == {"error"}, body
    assert body["error"]["code"] == code, body
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    if code == "invalid":
        assert set(body["error"]) == {"code", "message", "fields"}
    else:
        assert set(body["error"]) == {"code", "message"}
    return body["error"]


def client(base: str, locale: str = "en-CA") -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, follow_redirects=False)
    c.cookies.set("pdl_locale", locale)
    return c


def clone(c: httpx.Client) -> httpx.Client:
    return httpx.Client(base_url=c.base_url, timeout=HTTP_TIMEOUT, cookies=c.cookies)


def staff(base: str, role: str, locale: str = "en-CA") -> httpx.Client:
    c = client(base, locale)
    email, password = STAFF[role]
    r = c.post("/api/staff/sign-in", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    assert r.json()["staff"]["role"] == role
    return c


def toronto_today(maker: httpx.Client) -> date:
    r = maker.get("/api/staff/packing")
    assert r.status_code == 200, r.text
    return date.fromisoformat(r.json()["date"])


def new_batch(base: str, bars: int = 6, state: str = "live", scent: str = "rose-clay") -> str:
    maker = staff(base, "maker")
    today = toronto_today(maker)
    r = maker.post("/api/staff/batches", json={"scent": scent, "poured_on": (today - timedelta(days=CURE_MIN)).isoformat(),
                                               "cure_days": CURE_MIN})
    assert r.status_code == 201, r.text
    code = r.json()["batch"]["code"]
    assert r.json()["batch"]["state"] == "poured"
    if state == "poured":
        return code
    r = maker.post(f"/api/staff/batches/{code}/cut", json={"bars": bars})
    assert r.status_code == 200 and r.json()["batch"]["state"] == "curing", r.text
    if state == "scheduled":
        r = maker.post(f"/api/staff/batches/{code}/schedule",
                       json={"drop_at_local": f"{(today + timedelta(days=1)).isoformat()}T10:00"})
        assert r.status_code == 200, r.text
    if state == "live":
        r = maker.post(f"/api/staff/batches/{code}/open", json={})
        assert r.status_code == 200 and r.json()["batch"]["state"] == "live", r.text
    return code


def public_batch(base: str, code: str) -> dict[str, Any]:
    r = httpx.get(f"{base}/api/batches/{code}", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def mails_to(mail: Any, email: str, subject: str | None = None) -> list[dict[str, Any]]:
    found = []
    for m in mail.messages(settle=0):
        if email.lower() in [a.lower() for a in addresses(m.get("To"))]:
            if subject is None or re.search(subject, m.get("Subject", "")):
                found.append(m)
    return found


def wait_mails(mail: Any, email: str, count: int, subject: str | None = None) -> list[dict[str, Any]]:
    return eventually(lambda: (lambda ms: ms if len(ms) >= count else None)(mails_to(mail, email, subject)),
                      MAIL_WAIT_S, f"{count} mail(s) to {email} matching {subject}")


def settled(mail: Any, email: str, subject: str | None = None) -> list[dict[str, Any]]:
    mail.messages(settle=MAIL_SETTLE_S)
    return mails_to(mail, email, subject)


CODE_SUBJECT = r"Pain de Lune"


def code_set(mail: Any, email: str) -> set[str]:
    out = set()
    for m in mails_to(mail, email, CODE_SUBJECT):
        hit = re.search(r"(\d{6})\s*$", m.get("Subject", ""))
        if hit:
            out.add(hit.group(1))
    return out


def new_code(mail: Any, email: str, before: set[str]) -> str:
    fresh = eventually(lambda: code_set(mail, email) - before, MAIL_WAIT_S, f"new code for {email}")
    return sorted(fresh)[0]


def verified(base: str, mail: Any, locale: str = "en-CA", email: str | None = None) -> tuple[httpx.Client, str]:
    c = client(base, locale)
    email = email or person("dp")[1]
    before = code_set(mail, email)
    r = c.post("/api/auth/code", json={"email": email, "purpose": "checkout"})
    assert r.status_code == 202 and r.json() == {"status": "sent"}, r.text
    code = new_code(mail, email, before)
    r = c.post("/api/auth/verify", json={"email": email, "code": code})
    assert r.status_code == 200, r.text
    assert r.json()["customer"]["email"] == email
    return c, email


def hold(c: httpx.Client, batch: str) -> httpx.Response:
    return c.post("/api/holds", json={"batch": batch})


def checkout(c: httpx.Client, holds: list[str], province: str = "QC", key: str | None = None,
             shipping: dict[str, Any] | None = None) -> httpx.Response:
    return c.post("/api/checkout", json={"holds": holds, "shipping": shipping or {**SHIP, "province": province}},
                  headers={"Idempotency-Key": key or idempotency_key()})


def buy(base: str, mail: Any, batch: str, bars: int = 1, province: str = "QC",
        buyer: tuple[httpx.Client, str] | None = None) -> tuple[httpx.Client, str, dict[str, Any]]:
    c, email = buyer or verified(base, mail)
    ids = []
    for _ in range(bars):
        r = hold(c, batch)
        assert r.status_code == 201, r.text
        ids.append(r.json()["hold"]["id"])
    r = checkout(c, ids, province)
    assert r.status_code == 201, r.text
    return c, email, r.json()["order"]


def start_trio(c: httpx.Client, scent: str = "oat-milk", cadence: str | None = "MONTHLY", province: str = "QC",
               key: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"scent": scent, "shipping": {**SHIP, "province": province}}
    if cadence is not None:
        body = {"scent": scent, "cadence": cadence, "shipping": body["shipping"]}
    return c.post("/api/subscriptions", json=body, headers={"Idempotency-Key": key or idempotency_key()})


def staff_record(c: httpx.Client, number: str) -> tuple[dict[str, Any], str]:
    kind = "orders" if number.startswith("PDL-") else "subscriptions"
    r = c.get(f"/api/staff/{kind}/{number}")
    assert r.status_code == 200, r.text
    return r.json(), r.headers["ETag"]


def refund(c: httpx.Client, order: str, bars: list[tuple[str, int]], etag: str | None, restock: bool = True,
           key: str | None = None) -> httpx.Response:
    headers = {"Idempotency-Key": key or idempotency_key()}
    if etag is not None:
        headers["If-Match"] = etag
    return c.post(f"/api/staff/orders/{order}/refunds",
                  json={"bars": [{"batch": b, "bar": k} for b, k in bars], "restock": restock, "reason": REASON},
                  headers=headers)


def credit(c: httpx.Client, target: str, cents: Any, etag: str | None, reason: str = REASON,
           key: str | None = None) -> httpx.Response:
    headers = {"Idempotency-Key": key or idempotency_key()}
    if etag is not None:
        headers["If-Match"] = etag
    return c.post("/api/staff/credits", json={"target": target, "amount_cents": cents, "reason": reason},
                  headers=headers)


def contact(c: httpx.Client, email: str, name: str = "Zoe Probe", topic: str = "other",
            message: str = MESSAGE) -> httpx.Response:
    return c.post("/api/contact", json={"name": name, "email": email, "topic": topic, "message": message})


def notice_by_key(c: httpx.Client, key: str) -> dict[str, Any] | None:
    r = c.get("/api/staff/notices")
    assert r.status_code == 200, r.text
    return next((n for n in r.json()["notices"] if n["key"] == key), None)


def recon_line(c: httpx.Client, key: str, month: str | None = None) -> tuple[dict[str, Any], dict[str, Any] | None]:
    r = c.get("/api/staff/reconciliation", params={"month": month} if month else None)
    assert r.status_code == 200, r.text
    body = r.json()
    return body, next((ln for ln in body["lines"] if ln["key"] == key), None)


def kb_cents(value: Any) -> int:
    return int(round(float(value) * 100))


def kb_refunds(payment: dict[str, Any]) -> list[dict[str, Any]]:
    return [t for t in payment.get("transactions", [])
            if t.get("transactionType") == "REFUND" and t.get("status") == "SUCCESS"]


def kb_target() -> tuple[str, int]:
    url = urlparse(os.environ["KILLBILL_URL"])
    return url.hostname or "127.0.0.1", url.port or 80


def kb_blocks(account_id: str) -> list[tuple[str, datetime]]:
    url = os.environ["KILLBILL_URL"].rstrip("/")
    r = httpx.get(f"{url}/1.0/kb/accounts/{account_id}/block", timeout=HTTP_TIMEOUT,
                  auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
                  headers={"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
                           "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
                           "Accept": "application/json"})
    assert r.status_code == 200, r.text
    out = []
    for b in r.json():
        if b.get("service") != "loafline":
            continue
        when = datetime.fromisoformat(str(b["effectiveDate"]).replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        out.append((b["stateName"], when))
    return out


def kb_item_totals(killbill: Any, account_id: str) -> tuple[dict[str, Any], dict[str, tuple[int, int]]]:
    for invoice in killbill.invoices(account_id):
        items = invoice.get("items", [])
        if not any(i.get("description") == "Shipping" for i in items):
            continue
        adjusted: dict[str, int] = {}
        for i in items:
            if i.get("itemType") == "ITEM_ADJ":
                adjusted[i["linkedInvoiceItemId"]] = adjusted.get(i["linkedInvoiceItemId"], 0) - kb_cents(i["amount"])
        totals = {i["description"]: (kb_cents(i["amount"]), adjusted.get(i["invoiceItemId"], 0))
                  for i in items if i.get("itemType") != "ITEM_ADJ"}
        return invoice, totals
    raise AssertionError("no drop-order invoice holding a Shipping item")


def smtp_target() -> tuple[str, int]:
    return os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])


class Relay:

    def __init__(self, target: tuple[str, int], up: bool) -> None:
        self.target = target
        self.up = up
        self.blackhole: re.Pattern[bytes] | None = None
        self.swallowed = 0
        self._conns: list[socket.socket] = []
        self._lock = threading.Lock()
        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind(("127.0.0.1", 0))
        self._server.listen(64)
        self.port = self._server.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def set_up(self, up: bool) -> None:
        self.up = up
        if not up:
            with self._lock:
                for s in self._conns:
                    with suppress(OSError):
                        s.shutdown(socket.SHUT_RDWR)
                    with suppress(OSError):
                        s.close()
                self._conns.clear()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self._server.accept()
            except OSError:
                return
            if not self.up:
                conn.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=RELAY_CONNECT_S)
                upstream.settimeout(None)
            except OSError:
                conn.close()
                continue
            with self._lock:
                self._conns += [conn, upstream]
            hole = threading.Event()
            threading.Thread(target=self._pump, args=(conn, upstream, hole, True), daemon=True).start()
            threading.Thread(target=self._pump, args=(upstream, conn, hole, False), daemon=True).start()

    def _pump(self, src: socket.socket, dst: socket.socket, hole: threading.Event, from_client: bool) -> None:
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                if from_client and self.blackhole is not None and self.blackhole.search(data):
                    hole.set()
                    self.swallowed += 1
                if not from_client and hole.is_set():
                    continue
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                with suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)

    def close(self) -> None:
        self.set_up(False)
        with suppress(OSError):
            self._server.shutdown(socket.SHUT_RDWR)
        self._server.close()


@contextmanager
def relay(target: tuple[str, int], up: bool) -> Iterator[Relay]:
    r = Relay(target, up)
    try:
        yield r
    finally:
        r.close()


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@contextmanager
def app_copy(**env: str) -> Iterator[str]:
    root = Path(getattr(kit, "DEPLOYED_APP", "/app"))
    manifest_path = root / "run.json" if (root / "run.json").exists() else Path("/app/run.json")
    serve = json.loads(manifest_path.read_text())["serve"]
    port = free_port()
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=str(root), stdout=log, stderr=subprocess.STDOUT,
                            env={**os.environ, "APP_PUBLIC_PORT": str(port), **env}, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text(errors="replace")[-4000:]

    def healthy() -> bool:
        if proc.poll() is not None:
            raise RuntimeError(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            return httpx.get(f"{base}/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        try:
            eventually(healthy, COPY_BOOT_S, "app copy health")
        except RuntimeError as exc:
            raise AssertionError(str(exc)) from exc
        except AssertionError as exc:
            raise AssertionError(f"{exc}\n{tail()}") from exc
        yield base
    finally:
        with suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            with suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
        log.close()


def admin_sql(sql: str) -> None:
    url = os.environ["DATABASE_URL"]
    for module in ("psycopg", "psycopg2"):
        try:
            driver = importlib.import_module(module)
        except ImportError:
            continue
        conn = driver.connect(url)
        conn.autocommit = True
        try:
            conn.cursor().execute(sql)
        finally:
            conn.close()
        return
    done = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr


@contextmanager
def scratch_db() -> Iterator[str]:
    name = f"loafline_scratch_{uuid.uuid4().hex[:12]}"
    admin_sql(f'CREATE DATABASE "{name}"')
    try:
        yield urlparse(os.environ["DATABASE_URL"])._replace(path=f"/{name}").geturl()
    finally:
        with suppress(Exception):
            admin_sql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@contextmanager
def isolated_copy(smtp_up: bool, **env: str) -> Iterator[tuple[str, Relay]]:
    with relay(smtp_target(), up=smtp_up) as smtp, scratch_db() as db, app_copy(
            SMTP_HOST="127.0.0.1", SMTP_PORT=str(smtp.port), DATABASE_URL=db, **env) as base:
        yield base, smtp


def follow_real_time(page: Page, check_fn: Callable[[], Any], seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    last = time.monotonic()
    expired = False
    while not expired:
        with suppress(Exception):
            if check_fn():
                return
        now = time.monotonic()
        expired = now > deadline
        if not expired:
            advance(page, max(1, int((now - last) * 1000)))
            last = now
            threading.Event().wait(POLL_S)
    raise AssertionError(f"{what}: not reached within {seconds}s")


@contextmanager
def browse(browser: Browser, base: str, path: str = "/", locale: str | None = "en-CA", **kw: Any) -> Iterator[Page]:
    made = open_app(browser, f"{base}/api/health", **kw)
    if hasattr(made, "__enter__"):
        with made as page:
            _arrive(page, base, path, locale)
            yield page
    else:
        page = next(made)
        try:
            _arrive(page, base, path, locale)
            yield page
        finally:
            with suppress(StopIteration):
                next(made)


def _arrive(page: Page, base: str, path: str, locale: str | None) -> None:
    if locale:
        page.context.add_cookies([{"name": "pdl_locale", "value": locale, "url": base}])
    page.goto(f"{base}{path}")


@contextmanager
def holding(page: Page, glob: str) -> Iterator[Any]:
    made = held(page, glob)
    if hasattr(made, "__enter__"):
        with made as gate:
            yield gate
    else:
        gate = next(made)
        try:
            yield gate
        finally:
            with suppress(StopIteration):
                next(made)


def adopt(page: Page, c: httpx.Client, base: str) -> None:
    page.context.add_cookies([{"name": k, "value": v, "url": base} for k, v in c.cookies.items()])


def staff_browser(page: Page, base: str, role: str) -> None:
    email, password = STAFF[role]
    r = page.request.post(f"{base}/api/staff/sign-in", data={"email": email, "password": password})
    assert r.status == 200, r.text()


def clear_of_pinned_loaf(locator: Any) -> None:
    locator.evaluate("e => e.scrollIntoView({block: 'end', inline: 'nearest', behavior: 'instant'})")


def expect_active_option(option: Any, what: str) -> None:
    expect(option).to_be_visible(timeout=EXPECT_MS)
    eventually(lambda: option.evaluate("""e => {
      if (document.activeElement === e) return true;
      const id = document.activeElement && document.activeElement.getAttribute('aria-activedescendant');
      return Boolean(id) && id === e.id;
    }"""), EXPECT_MS / 1000, f"{what} is the active option")


def fig(page: Page) -> Any:
    return page.get_by_role("figure", name="Loaf", exact=True)


def fattr(page: Page, name: str) -> str | None:
    return fig(page).get_attribute(name)


def scene(page: Page) -> dict[str, str]:
    return fig(page).evaluate(
        "el => Object.fromEntries([...el.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value]))")


def pump(page: Page, check_fn: Callable[[], Any], seconds: float, what: str, step_ms: int = PAGE_STEP_MS) -> Any:
    deadline = time.monotonic() + seconds
    expired = False
    while not expired:
        try:
            value = check_fn()
        except Exception:
            value = None
        if value:
            return value
        expired = time.monotonic() > deadline
        if not expired:
            advance(page, step_ms)
    raise AssertionError(f"{what}: not reached within {seconds}s")


def within_page(page: Page, page_ms: int, check_fn: Callable[[], Any], what: str) -> None:
    advanced = 0
    while advanced < page_ms:
        with suppress(Exception):
            if check_fn():
                return
        advance(page, PAGE_STEP_MS)
        advanced += PAGE_STEP_MS
    eventually(lambda: check_fn(), NETWORK_GRACE_S, what)


def scene_ready(page: Page, seconds: float = LOAD_S) -> str:
    return pump(page, lambda: fattr(page, "data-state") if fattr(page, "data-state") in ("ready", "fallback") else None,
                seconds, "scene ready")


def scroll_to(page: Page, y: int) -> None:
    page.evaluate("y => window.scrollTo({top: y, left: 0, behavior: 'instant'})", y)
    advance(page, FRAME_MS)


def scroll_y(page: Page) -> int:
    return page.evaluate("Math.floor(window.scrollY)")


def formula(scroll: int, bars: int) -> dict[str, str]:
    s = max(0, min(SCROLL_TRAVEL, scroll))
    p = (s * 1000 + 1200) // SCROLL_TRAVEL
    w = (s * bars) // 24
    return {"data-progress": f"{p // 1000}.{p % 1000:03d}", "data-wire": f"{w // 100}.{w % 100:02d}",
            "data-cut-step": str((s * bars) // SCROLL_TRAVEL)}


def assert_formula(page: Page, bars: int) -> None:
    got = scene(page)
    want = formula(scroll_y(page), bars)
    assert {k: got.get(k) for k in want} == want, (scroll_y(page), got)


def assert_cut_step(page: Page, bars: int) -> None:
    want = formula(scroll_y(page), bars)["data-cut-step"]
    assert fattr(page, "data-cut-step") == want, (scroll_y(page), fattr(page, "data-cut-step"), want)


def settle_scene(page: Page) -> None:
    pump(page, lambda: fattr(page, "data-animating") == "false", LOAD_S, "scene idle", step_ms=FRAME_MS)


def running_animations(page: Page) -> int:
    return page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length")


def ui_verify(page: Page, mail: Any, email: str) -> None:
    fill(page.get_by_role("textbox", name="Email", exact=True), email)
    before = code_set(mail, email)
    click(page.get_by_role("button", name="Send code"))
    code = new_code(mail, email, before)
    fill(page.get_by_role("textbox", name="Code", exact=True), code)
    click(page.get_by_role("button", name="Verify", exact=True))
    collapsed = page.get_by_text(f"Signed in as {email}")
    account = page.get_by_role("heading", name="Your account", level=1)
    expect(collapsed.or_(account).first).to_be_visible(timeout=EXPECT_MS)


def ui_address(page: Page, city: str = "Montreal", postal: str = "H2T 1S6") -> None:
    fill(page.get_by_role("textbox", name="Full name"), SHIP["name"])
    fill(page.get_by_role("textbox", name="Street address"), SHIP["line1"])
    fill(page.get_by_role("textbox", name="City"), city)
    fill(page.get_by_role("textbox", name="Postal code"), postal)


def cart_region(page: Page, name: str = "Cart updates") -> Any:
    return page.get_by_role("status", name=name, exact=True)


def studio_region(page: Page) -> Any:
    return page.get_by_role("status", name="Studio updates")


def png_rows(payload: bytes) -> tuple[int, int, list[bytes]]:
    assert payload[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, width, height, bpp = 8, b"", 0, 0, 0
    while pos < len(payload):
        length, kind = struct.unpack(">I4s", payload[pos:pos + 8])
        chunk = payload[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            assert depth == 8 and interlace == 0 and colour in (2, 6)
            bpp = 3 if colour == 2 else 4
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    raw = zlib.decompress(idat)
    stride = width * bpp
    rows: list[bytes] = []
    prev = bytearray(stride)
    i = 0
    for _ in range(height):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    return width, bpp, rows


def ground_rgb(page: Page) -> tuple[int, int, int]:
    return tuple(fig(page).evaluate("""el => {
        let colour = getComputedStyle(document.documentElement).backgroundColor;
        for (let n = el; n; n = n.parentElement) {
            const c = getComputedStyle(n).backgroundColor;
            if (c && c !== 'transparent' && !/rgba\\(\\s*0,\\s*0,\\s*0,\\s*0\\s*\\)/.test(c)) { colour = c; break; }
        }
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const g = cv.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, 1, 1);
        return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }"""))


def ground_share(row: bytes, bpp: int, x0: int, x1: int, ground: tuple[int, int, int]) -> float:
    width = x1 - x0
    lo, hi = int(x0 + width * SPAN_MARGIN), int(x1 - width * SPAN_MARGIN)
    hits = total = 0
    for x in range(lo, max(lo + 1, hi)):
        px = row[x * bpp:x * bpp + 3]
        total += 1
        if all(abs(px[k] - ground[k]) <= GROUND_TOL for k in range(3)):
            hits += 1
    return hits / total


def spans(page: Page) -> list[tuple[int, int]]:
    out = []
    for entry in (fattr(page, "data-bar-spans") or "").split(" "):
        x0, x1 = entry.split("-")
        out.append((int(x0), int(x1)))
    return out


def secret_values() -> list[str]:
    values = []
    for name in ("DATABASE_URL", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "SESSION_SECRET"):
        v = os.environ.get(name, "")
        if v and (name == "DATABASE_URL" or (len(v) >= SECRET_MIN_LEN and not v.isalpha())):
            values.append(v)
    db = urlparse(os.environ.get("DATABASE_URL", ""))
    if db.password and len(db.password) >= SECRET_MIN_LEN and not db.password.isalpha():
        values.append(db.password)
    return values


def test_health_answers_with_dependencies_down(app_url: str) -> None:
    for base in (app_url, KILLBILL_DOWN, MAIL_DOWN):
        assert base, "outage URL env var missing"
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, (base, r.text)
    with app_copy() as base:
        port = urlparse(base).port
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        lan = socket.gethostbyname(socket.gethostname())
        r = httpx.get(f"http://{lan}:{port}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_server_boundary_and_secrets(app_url: str, mail: Any) -> None:
    c = client(app_url)
    _, email = person("dp02")
    r = c.post("/api/contact", content=json.dumps({"name": "x"}), headers={"Content-Type": "text/plain"})
    error(r, 415, "unsupported_media_type")
    r = c.post("/api/checkout", content="{}", headers={"Content-Type": "text/plain", "Idempotency-Key": idempotency_key()})
    error(r, 415, "unsupported_media_type")
    base_body = {"name": "Zoe Probe", "email": email, "topic": "other", "message": ""}
    pad = MAX_BODY - len(json.dumps(base_body).encode())
    exact = json.dumps({**base_body, "message": "a" * pad}).encode()
    assert len(exact) == MAX_BODY
    r = c.post("/api/contact", content=exact, headers={"Content-Type": "application/json"})
    assert r.status_code == 422, r.text
    r = c.post("/api/contact", content=json.dumps({**base_body, "message": "a" * (pad + 1)}).encode(),
               headers={"Content-Type": "application/json"})
    error(r, 413, "payload_too_large")
    r = c.post("/api/contact", json={**base_body, "message": MESSAGE}, headers={"Origin": "http://elsewhere.example"})
    error(r, 403, "cross_origin")
    assert CORS_HEADER not in {k.lower() for k in r.headers}
    r = c.get("/api/drop", headers={"Origin": "http://elsewhere.example"})
    assert CORS_HEADER not in {k.lower() for k in r.headers}
    assert settled(mail, email) == []
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    r = c.post("/api/contact", json={**base_body, "message": MESSAGE}, headers={"Origin": origin})
    assert r.status_code == 201, r.text
    for path in ("/package.json", "/package-lock.json", "/run.json", "/.env", "/tsconfig.json",
                 "/node_modules/.package-lock.json", "/.git/config", "/src/server.ts", "/server/index.ts"):
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT).status_code == 404, path
    home = httpx.get(f"{app_url}/", timeout=HTTP_TIMEOUT)
    bodies = [home.text, str(dict(home.headers)), httpx.get(f"{app_url}/api/drop").text,
              httpx.get(f"{app_url}/api/status").text]
    assets = set(re.findall(r'(?:src|href)="(/[^"#?]+\.(?:js|mjs|css))', home.text))
    for asset in assets:
        r = httpx.get(f"{app_url}{asset}", timeout=HTTP_TIMEOUT)
        bodies.append(r.text)
        assert httpx.get(f"{app_url}{asset}.map", timeout=HTTP_TIMEOUT).status_code == 404, asset
    for secret in secret_values():
        for body in bodies:
            assert secret not in body


def test_error_shape_precedence_and_allowed_keys(app_url: str, mail: Any) -> None:
    c = client(app_url)
    error(c.get("/api/no-such-route"), 404, "not_found")
    error(c.delete("/api/health"), 405, "method_not_allowed")
    _, email = person("dp03")
    r = c.post("/api/contact", json={"name": "Zoe Probe", "email": "not-an-email", "topic": "other",
                                     "message": MESSAGE, "admin": True})
    err = error(r, 422, "invalid")
    assert err["message"] == CHECK_FIELDS
    assert err["fields"]["admin"] == CANT_SET
    assert err["fields"]["email"] == "Enter an email address like name@example.ca."
    assert list(err["fields"]) == sorted(err["fields"], key=lambda k: k.encode())
    fr = client(app_url, "fr-CA")
    r = fr.post("/api/contact", json={"name": "Zoe Probe", "email": email, "topic": "other", "message": MESSAGE,
                                      "reference": "CT-000001"})
    err = error(r, 422, "invalid")
    assert err["message"] == "Vérifiez ces champs."
    assert err["fields"] == {"reference": "Ce champ ne peut pas être défini."}
    assert settled(mail, email) == []
    r = client(app_url).post("/api/checkout", json={"holds": [], "total": money(0)},
                             headers={"Idempotency-Key": idempotency_key()})
    error(r, 401, "unauthenticated")
    r = client(app_url).post("/api/holds", json={"batch": SEED_LIVE, "bar": 1})
    err = error(r, 422, "invalid")
    assert err["fields"] == {"bar": CANT_SET}


def test_language_toggle_switches_in_place(browser: Browser, app_url: str) -> None:
    for width, height in VIEWPORTS:
        with browse(browser, app_url, f"/?batch={SEED_LIVE}", locale="en-CA") as page:
            page.set_viewport_size({"width": width, "height": height})
            scene_ready(page)
            page.evaluate("window.__dpNoReload = 1")
            before = fig(page).bounding_box()
            click(page.get_by_role("button", name="Français"))
            expect(page.get_by_role("button", name="English")).to_be_focused(timeout=EXPECT_MS)
            assert page.evaluate("document.documentElement.lang") == "fr-CA"
            assert page.evaluate("window.__dpNoReload") == 1
            assert {"name": "pdl_locale", "value": "fr-CA"}.items() <= next(
                ck for ck in page.context.cookies() if ck["name"] == "pdl_locale").items()
            expect(page.get_by_role("figure", name="Bloc")).to_be_visible()
            expect(page.get_by_role("radiogroup", name="Parfum")).to_be_visible()
            expect(page.get_by_role("navigation", name="Principal")).to_be_visible()
            expect(page.get_by_role("status", name="Décompte du lot")).to_contain_text("Coupés")
            advance(page, FRAME_MS)
            after = page.get_by_role("figure", name="Bloc").bounding_box()
            for k in ("x", "y", "width", "height"):
                assert abs(after[k] - before[k]) <= 1, (width, k, before, after)
            click(page.get_by_role("button", name="English"))
            expect(page.get_by_role("button", name="Français")).to_be_focused()
            assert page.evaluate("document.documentElement.lang") == "en-CA"


def test_three_viewports_without_sideways_scroll(browser: Browser, app_url: str) -> None:
    public = ["/", "/checkout", "/subscribe", "/account", "/contact", "/no-such-page"]
    studio = ["/studio/batches", "/studio/packing", "/studio/finance", "/studio/reconciliation",
              "/studio/audit", "/studio/notices"]
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "maker")
        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            for path in public + studio:
                page.goto(f"{app_url}{path}")
                advance(page, PAGE_STEP_MS)
                layout(page)
            page.goto(f"{app_url}/?batch={SEED_LIVE}")
            expect(page.get_by_role("status", name="Batch counts")).to_be_visible(timeout=EXPECT_MS)
            disclosure = page.get_by_role("button", name="Show bar list")
            if width < WIDE:
                expect(disclosure).to_have_attribute("aria-expanded", "false")
                expect(page.get_by_role("list", name="Bars in this batch")).to_be_hidden()
                click(disclosure)
                expect(disclosure).to_have_attribute("aria-expanded", "true")
                expect(disclosure).to_be_focused()
                expect(page.get_by_role("list", name="Bars in this batch")).to_be_visible()
                box = fig(page).bounding_box()
                assert abs(box["height"] - 0.56 * height) <= 2, box
            else:
                expect(disclosure).to_have_count(0)
                expect(page.get_by_role("list", name="Bars in this batch")).to_be_visible()
            layout(page)


def test_keyboard_focus_rules(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/") as page:
        for path in ("/", "/checkout", "/subscribe", "/account", "/contact", "/studio"):
            page.goto(f"{app_url}{path}")
            advance(page, PAGE_STEP_MS)
            assert tab_order(page, 1)[0] == "Skip to content", path
            page.keyboard.press("Enter")
            expect(page.get_by_role("heading", level=1)).to_be_focused(timeout=EXPECT_MS)
        page.goto(f"{app_url}/contact")
        click(page.get_by_role("button", name="Send message"))
        summary = page.get_by_role("alert", name="Check these fields")
        expect(summary).to_be_focused(timeout=EXPECT_MS)
        links = summary.get_by_role("link")
        expect(links).to_have_text(["Enter your full name.", "Enter an email address like name@example.ca.",
                                    "Choose a topic.", "Write a message of 10 to 2,000 characters."])
        expect(page.get_by_role("textbox", name="Name")).to_have_attribute("aria-invalid", "true")
        click(links.nth(1))
        expect(page.get_by_role("textbox", name="Email", exact=True)).to_be_focused()
        page.goto(f"{app_url}/subscribe")
        opener = page.get_by_role("button", name="Cadence", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        expect_active_option(page.get_by_role("option", name="Every month"), "Every month")
        page.keyboard.press("ArrowDown")
        expect_active_option(page.get_by_role("option", name="Every two months"), "Every two months")
        page.keyboard.press("Escape")
        expect(page.get_by_role("listbox", name="Cadence")).to_be_hidden()
        expect(opener).to_be_focused()
        expect(opener).to_contain_text("Choose…")
        page.keyboard.press("ArrowDown")
        expect_active_option(page.get_by_role("option", name="Every month"), "Every month")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        expect(page.get_by_role("listbox", name="Cadence")).to_be_hidden()
        expect(opener).to_be_focused()
        expect(opener).to_contain_text("Every two months")
    code = new_batch(app_url, state="poured")
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "maker")
        page.goto(f"{app_url}/studio/batches")
        opener = page.get_by_role("button", name=f"Withdraw {code}")
        click(opener)
        dialog = page.get_by_role("dialog", name=f"Withdraw {code}?")
        expect(dialog).to_be_visible(timeout=EXPECT_MS)
        for key in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            assert dialog.evaluate("d => d.contains(document.activeElement)"), key
            page.keyboard.press(key)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        click(opener)
        click(page.get_by_role("button", name="Yes, withdraw"))
        expect(page.get_by_role("heading", level=1)).to_be_focused(timeout=EXPECT_MS)
    batches = staff(app_url, "maker").get("/api/staff/batches").json()["batches"]
    assert next(b for b in batches if b["code"] == code)["state"] == "withdrawn"


def panel_height(button: Any) -> float:
    return button.evaluate("""b => {
      const panel = document.getElementById(b.getAttribute('aria-controls') || '');
      return panel ? panel.getBoundingClientRect().height : -1;
    }""")


def tip_duration(page: Page, y: int) -> int:
    page.evaluate("y => window.scrollTo({top: y, left: 0, behavior: 'instant'})", y)
    elapsed, started = 0, None
    while elapsed <= TIMING_LIMIT_MS:
        if fattr(page, "data-animating") == "true":
            started = elapsed if started is None else started
        elif started is not None:
            return elapsed - started
        advance(page, FRAME_STEP_MS)
        elapsed += FRAME_STEP_MS
    raise AssertionError("motion did not start and end")


def test_motion_durations_and_live_reduced_motion(browser: Browser, app_url: str) -> None:
    code = new_batch(app_url, bars=12)
    with browse(browser, app_url, f"/?batch={code}") as page:
        assert scene_ready(page) == "ready"
        expect(fig(page)).to_have_attribute("data-motion", "full")
        settle_scene(page)
        duration = tip_duration(page, 200)
        assert LONG_MIN_MS - FRAME_STEP_MS <= duration <= LONG_MAX_MS + FRAME_STEP_MS, duration
        duration = tip_duration(page, 0)
        assert LONG_MIN_MS - FRAME_STEP_MS <= duration <= LONG_MAX_MS + FRAME_STEP_MS, duration
        advance(page, TIMING_LIMIT_MS)
        assert fattr(page, "data-animating") == "false" and running_animations(page) == 0
        scroll_to(page, 200)
        advance(page, FRAME_STEP_MS * 10)
        assert fattr(page, "data-animating") == "true"
        page.emulate_media(reduced_motion="reduce")
        advance(page, PREF_MS)
        expect(fig(page)).to_have_attribute("data-motion", "reduced", timeout=NETWORK_GRACE_S * 1000)
        assert fattr(page, "data-animating") == "false" and running_animations(page) == 0
        assert fattr(page, "data-cut-step") == "1"
        scroll_to(page, 400)
        for _ in range(10):
            assert fattr(page, "data-animating") == "false"
            advance(page, FRAME_MS)
        assert fattr(page, "data-cut-step") == "2"
        page.emulate_media(reduced_motion="no-preference")
        advance(page, PREF_MS)
        expect(fig(page)).to_have_attribute("data-motion", "full", timeout=NETWORK_GRACE_S * 1000)
        duration = tip_duration(page, 600)
        assert LONG_MIN_MS - FRAME_STEP_MS <= duration <= LONG_MAX_MS + FRAME_STEP_MS, duration
        page.set_viewport_size({"width": 375, "height": 812})
        disclosure = page.get_by_role("button", name="Show bar list")
        clear_of_pinned_loaf(disclosure)
        page.evaluate("window.__dpStart = new Set(document.getAnimations())")
        click(disclosure)
        durations = disclosure.evaluate("""button => {
            const panel = document.getElementById(button.getAttribute('aria-controls') || '');
            if (!panel) return [];
            return document.getAnimations().filter(a => !window.__dpStart.has(a))
                .filter(a => { const t = a.effect && a.effect.target;
                    return t && t !== button && !t.contains(button) && (panel.contains(t) || t.contains(panel)); })
                .map(a => a.effect.getComputedTiming().duration).filter(d => typeof d === 'number' && d > 0); }""")
        if durations:
            for d in durations:
                assert MEDIUM_MIN_MS <= d <= MEDIUM_MAX_MS, durations
        else:
            advance(page, MEDIUM_MIN_MS // 2)
            midway = panel_height(disclosure)
            advance(page, MEDIUM_MAX_MS + FRAME_MS)
            settled = panel_height(disclosure)
            advance(page, FRAME_MS)
            assert abs(panel_height(disclosure) - settled) <= 1, "the disclosure moved past the medium band"
            assert 0 <= midway < settled - 1, f"the disclosure jumped open instead of moving: {midway} of {settled}"
    with browse(browser, app_url, f"/?batch={code}", reduced_motion="reduce") as page:
        scene_ready(page)
        expect(fig(page)).to_have_attribute("data-motion", "reduced")
        box = fig(page).bounding_box()
        page.mouse.move(box["x"] + box["width"] - 1, box["y"] + box["height"] / 2)
        for y in (200, 1200, 2400, 0):
            scroll_to(page, y)
            assert fattr(page, "data-animating") == "false"
            assert fattr(page, "data-yaw") == "0"
            assert_formula(page, 12)
        page.set_viewport_size({"width": 375, "height": 812})
        disclosure = page.get_by_role("button", name="Show bar list")
        clear_of_pinned_loaf(disclosure)
        click(disclosure)
        assert running_animations(page) == 0
        chip = page.get_by_role("radio", name="Lavender & Oat")
        clear_of_pinned_loaf(chip)
        click(chip)
        expect(fig(page)).to_have_attribute("data-batch", SEED_LIVE)
        expect(fig(page)).to_have_attribute("data-tint", "lilac")
        assert fattr(page, "data-animating") == "false"


def test_wire_follows_scroll_formula(browser: Browser, app_url: str) -> None:
    examples = [(0, "0.000", "0.00", "0"), (200, "0.083", "1.00", "1"), (1199, "0.500", "5.99", "5"),
                (1200, "0.500", "6.00", "6"), (2400, "1.000", "12.00", "12")]
    with browse(browser, app_url, f"/?batch={SEED_LIVE}") as page:
        scene_ready(page)
        for y, p, w, c in examples + list(reversed(examples)):
            scroll_to(page, y)
            got = scene(page)
            assert (got["data-progress"], got["data-wire"], got["data-cut-step"]) == (p, w, c), (y, got)
            expect(fig(page)).to_contain_text(fill_copy(CAPTION, c=c, N=SEED_LIVE_BARS))
        scroll_to(page, SCROLL_TRAVEL + 500)
        got = scene(page)
        assert (got["data-progress"], got["data-wire"], got["data-cut-step"]) == ("1.000", "12.00", "12")
        scroll_to(page, 0)
        page.get_by_role("heading", level=1).click()
        for key in ("PageDown", "Space", "ArrowDown", "End", "Home"):
            page.keyboard.press(key)
            advance(page, FRAME_MS)
            assert_formula(page, SEED_LIVE_BARS)
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        box = fig(page).bounding_box()
        cx, cy = int(box["x"] + box["width"] / 2), int(box["y"] + box["height"] / 2)
        for distance in (-700, -600, 400, -300, 900):
            cdp.send("Input.synthesizeScrollGesture", {"x": cx, "y": cy, "yDistance": distance,
                                                        "gestureSourceType": "touch", "speed": 1500})
            advance(page, FRAME_MS)
            assert_formula(page, SEED_LIVE_BARS)
            assert fattr(page, "data-yaw") == "0"


def test_bar_states_by_label(browser: Browser, app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=3)
    buy(app_url, mail, code)
    assert hold(client(app_url), code).status_code == 201
    words = {1: "sold", 2: "held", 3: "available"}
    with browse(browser, app_url, f"/?batch={code}") as page:
        scene_ready(page)
        expect(fig(page)).to_have_attribute("data-bars", bar_letters("sold", "held", "available"), timeout=EXPECT_MS)
        bar_list = page.get_by_role("list", name="Bars in this batch")
        items = bar_list.get_by_role("listitem")
        expect(items).to_have_count(3)
        for k, word in words.items():
            item = items.nth(k - 1)
            expect(item).to_contain_text(bar_item(k, word))
            label = item.get_by_text(re.compile(rf"\b{word}\b")).first
            expect(label).to_be_visible()
            assert label.bounding_box()["width"] > 2
        staff_browser(page, app_url, "maker")
        page.goto(f"{app_url}/studio/batches")
        marks = page.get_by_role("list", name=f"Bars of {code}").get_by_role("listitem")
        expect(marks).to_have_count(3, timeout=EXPECT_MS)
        for k, word in words.items():
            expect(marks.nth(k - 1)).to_contain_text(bar_item(k, word))
            expect(marks.nth(k - 1).get_by_text(re.compile(rf"\b{word}\b")).first).to_be_visible()


def test_scent_chips_and_deep_links(browser: Browser, app_url: str) -> None:
    keys = ["data-batch", "data-tint", "data-swirl-seed", "data-bars-total", "data-bars", "data-cut-step"]
    with browse(browser, app_url, f"/?batch={SEED_LIVE}") as page:
        scene_ready(page)
        scroll_to(page, 1200)
        assert fattr(page, "data-cut-step") == "6"
        click(page.get_by_role("radio", name="Smoked Birch"))
        advance(page, FRAME_MS)
        assert_cut_step(page, SEED_SCHEDULED_BARS)
        advance(page, MEDIUM_MAX_MS + FRAME_MS)
        assert_formula(page, SEED_SCHEDULED_BARS)
        got = scene(page)
        assert (got["data-batch"], got["data-tint"], got["data-swirl-seed"],
                got["data-bars-total"]) == (SEED_SCHEDULED, "ash", SEED_SCHEDULED, str(SEED_SCHEDULED_BARS))
        assert len(got["data-bars"]) == SEED_SCHEDULED_BARS
        assert f"batch={SEED_SCHEDULED}" in page.url
        expect(page.get_by_role("heading", level=1)).to_have_text("Smoked Birch")
        click(page.get_by_role("radio", name="Lavender & Oat"))
        expect(fig(page)).to_have_attribute("data-tint", "lilac")
        radios = page.get_by_role("radiogroup", name="Scent").get_by_role("radio")
        count = radios.count()
        first = next(i for i in range(count) if radios.nth(i).is_checked())
        page.keyboard.press("ArrowRight")
        advance(page, FRAME_MS)
        nxt = (first + 1) % count
        assert radios.nth(nxt).is_checked()
        keyed = {k: scene(page)[k] for k in keys}
        page.keyboard.press("ArrowLeft")
        advance(page, FRAME_MS)
        assert radios.nth(first).is_checked()
        if first == 0:
            page.keyboard.press("ArrowLeft")
            advance(page, FRAME_MS)
            assert radios.nth(count - 1).is_checked()
            page.keyboard.press("ArrowRight")
            advance(page, FRAME_MS)
            assert radios.nth(0).is_checked()
    with browse(browser, app_url, f"/?batch={SEED_LIVE}") as page:
        scene_ready(page)
        scroll_to(page, 1200)
        radios = page.get_by_role("radiogroup", name="Scent").get_by_role("radio")
        click(radios.nth(nxt))
        advance(page, FRAME_MS)
        assert {k: scene(page)[k] for k in keys} == keyed
    code14 = new_batch(app_url, bars=14)
    cases = [(SEED_LIVE, 3, 600, "3"), (SEED_SCHEDULED, 3, 720, "3"), (code14, 1, 172, "1"),
             (code14, 7, 1200, "7"), (code14, 13, 2229, "13"), (code14, 15, 0, "0")]
    with browse(browser, app_url, "/") as page:
        for code, k, y, step in cases:
            page.goto("about:blank")
            page.goto(f"{app_url}/?batch={code}#bar-{k}")
            scene_ready(page)
            pump(page, lambda: scroll_y(page) == y, LOAD_S, f"deep link {code} #{k}")
            advance(page, FRAME_MS)
            assert fattr(page, "data-batch") == code and fattr(page, "data-cut-step") == step
        drop = httpx.get(f"{app_url}/api/drop").json()["batches"]
        default = next((b["code"] for b in drop if b["state"] == "live"), drop[0]["code"])
        page.goto(f"{app_url}/?batch=B-9999")
        scene_ready(page)
        expect(fig(page)).to_have_attribute("data-batch", default)
        assert scroll_y(page) == 0


def test_scene_survives_context_loss(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, f"/?batch={SEED_LIVE}") as page:
        assert scene_ready(page) == "ready"
        canvas = page.get_by_role("img", name="Loaf cross-section")
        assert canvas.evaluate("""c => { const gl = c.getContext('webgl2') || c.getContext('webgl');
            window.__dpLose = gl && gl.getExtension('WEBGL_lose_context'); if (!window.__dpLose) return false;
            window.__dpLose.loseContext(); return true; }""")
        advance(page, CONTEXT_MS)
        expect(fig(page)).to_have_attribute("data-state", "lost", timeout=NETWORK_GRACE_S * 1000)
        expect(page.get_by_role("img", name="Loaf diagram")).to_be_visible()
        expect(page.get_by_role("img", name="Loaf cross-section")).to_have_count(0)
        scroll_to(page, 1200)
        assert fattr(page, "data-cut-step") == "6"
        page.evaluate("window.__dpLose.restoreContext()")
        advance(page, CONTEXT_MS)
        expect(fig(page)).to_have_attribute("data-state", "ready", timeout=NETWORK_GRACE_S * 1000)
        expect(page.get_by_role("img", name="Loaf diagram")).to_have_count(0)
        assert fattr(page, "data-cut-step") == "6"
    with browse(browser, app_url, f"/?batch={SEED_LIVE}", no_webgl=True) as page:
        assert scene_ready(page, SCENE_READY_S) == "fallback"
        expect(page.get_by_role("img", name="Loaf diagram")).to_be_visible()
        expect(fig(page)).to_contain_text(fill_copy(CAPTION, c=0, N=SEED_LIVE_BARS))


def check_pixels(page: Page, yaw_values: tuple[int, ...]) -> None:
    ground = ground_rgb(page)
    bars = fattr(page, "data-bars") or ""
    box = fig(page).bounding_box()
    for yaw in yaw_values:
        if yaw == 0:
            vp = page.viewport_size
            page.mouse.move(vp["width"] - 2, vp["height"] - 2)
        else:
            x = box["x"] + 1 if yaw < 0 else box["x"] + box["width"] - 1
            page.mouse.move(x, box["y"] + box["height"] / 2)
        pump(page, lambda: fattr(page, "data-yaw") == str(yaw), LOAD_S, f"yaw {yaw}", step_ms=FRAME_MS)
        settle_scene(page)
        y0, y1 = (int(v) for v in (fattr(page, "data-loaf-band") or "").split("-"))
        assert y0 < y1
        slots = spans(page)
        assert len(slots) == len(bars)
        for (a0, a1), (b0, b1) in zip(slots, slots[1:]):
            assert a1 - a0 >= 8 and b1 - b0 >= 8 and b0 >= a1 - 1, slots
        _, bpp, rows = png_rows(capture(fig(page)))
        row = rows[(y0 + y1) // 2]
        for status, (x0, x1) in zip(bars, slots):
            share = ground_share(row, bpp, x0, x1, ground)
            if status == "S":
                if yaw == 0:
                    assert share >= SOLD_GROUND_MIN, (yaw, bars, slots, share)
            else:
                assert share <= COVERED_GROUND_MAX, (yaw, status, share)


def test_loaf_pixels_match_stock(browser: Browser, app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=6)
    buy(app_url, mail, code, bars=2)
    assert hold(client(app_url), code).status_code == 201
    with browse(browser, app_url, f"/?batch={code}") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        assert scene_ready(page) == "ready"
        expect(fig(page)).to_have_attribute(
            "data-bars", bar_letters("sold", "sold", "held", "available", "available", "available"), timeout=EXPECT_MS)
        scroll_to(page, SCROLL_TRAVEL)
        pump(page, lambda: fattr(page, "data-cut-step") == "6", LOAD_S, "cut complete")
        check_pixels(page, (0, -YAW_EDGE, YAW_EDGE))
        page.goto(f"{app_url}/?batch={SEED_LIVE}")
        assert scene_ready(page) == "ready"
        scroll_to(page, SCROLL_TRAVEL)
        check_pixels(page, (0,))


def test_drop_counts_follow_server(browser: Browser, app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=4)
    with browse(browser, app_url, f"/?batch={code}") as page:
        strip = page.get_by_role("status", name="Batch counts")

        def matches(text_: str, bars: str) -> Callable[[], bool]:
            return lambda: " ".join(strip.inner_text().split()) == text_ and fattr(page, "data-bars") == bars

        expect(strip).to_have_text(counts(4, 4, 0, 0), timeout=EXPECT_MS)
        buyer, _ = verified(app_url, mail)
        h1 = hold(buyer, code).json()["hold"]["id"]
        within_page(page, POLL_CATCHUP_MS, matches(counts(4, 3, 1, 0),
                                                   bar_letters("held", "available", "available", "available")), "held")
        expect(page.get_by_role("list", name="Bars in this batch")).to_contain_text(bar_item(1, "held"))
        server = public_batch(app_url, code)
        assert (server["available"], server["held"], server["sold"]) == (3, 1, 0)
        assert checkout(buyer, [h1]).status_code == 201
        other = client(app_url)
        h2 = hold(other, code).json()["hold"]["id"]
        within_page(page, POLL_CATCHUP_MS, matches(counts(4, 2, 1, 1),
                                                   bar_letters("sold", "held", "available", "available")), "sold")
        assert other.delete(f"/api/holds/{h2}").status_code == 200
        within_page(page, POLL_CATCHUP_MS, matches(counts(4, 3, 0, 1),
                                                   bar_letters("sold", "available", "available", "available")),
                    "released")
        server = public_batch(app_url, code)
        assert server["available"] == server["bars_cut"] - server["sold"] - server["held"] == 3


def test_hold_rules(app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=3)
    a = client(app_url)
    r = hold(a, code)
    assert r.status_code == 201, r.text
    body = r.json()
    assert a.cookies.get("pdl_cart")
    h1 = body["hold"]
    assert (h1["batch"], h1["bar"], h1["status"], h1["amount"]) == (code, 1, "active", money(BAR_CENTS))
    assert (utc(h1["expires_at"]) - utc(h1["created_at"])).total_seconds() == HOLD_TTL_DEFAULT
    assert body["cart"]["province"] == "QC" and body["cart"]["total"] == money(QC_ONE_TOTAL)
    h2 = hold(a, code).json()["hold"]
    assert h2["bar"] == 2
    assert a.get("/api/cart").json()["total"] == money(QC_TWO_TOTAL)
    error(hold(a, code), 409, "hold_limit")
    b = client(app_url)
    assert hold(b, code).json()["hold"]["bar"] == 3
    error(hold(client(app_url), code), 409, "all_held")
    error(b.delete(f"/api/holds/{h1['id']}"), 404, "not_found")
    r = a.delete(f"/api/holds/{h1['id']}")
    assert r.status_code == 200 and r.json()["hold"]["status"] == "released"
    assert r.json()["hold"]["amount"] == money(BAR_CENTS)
    error(a.delete(f"/api/holds/{h1['id']}"), 409, "hold_not_active")
    assert hold(client(app_url), code).json()["hold"]["bar"] == 1
    err = error(client(app_url).post("/api/holds", json={}), 422, "invalid")
    assert err["fields"] == {"batch": "Choose a batch."}
    error(hold(client(app_url), "B-9999"), 404, "not_found")
    error(hold(client(app_url), new_batch(app_url, state="curing")), 404, "not_found")
    error(hold(client(app_url), new_batch(app_url, state="scheduled")), 409, "not_live")
    one = new_batch(app_url, bars=1)
    buy(app_url, mail, one)
    error(hold(client(app_url), one), 409, "sold_out")
    assert public_batch(app_url, one)["state"] == "sold_out"


def test_last_bar_goes_to_one_shopper(app_url: str) -> None:
    code = new_batch(app_url, bars=1)
    carts = [client(app_url) for _ in range(8)]
    results = together([lambda c=c: hold(c, code) for c in carts])
    assert sorted(r.status_code for r in results) == [201] + [409] * 7
    for r in results:
        if r.status_code == 409:
            assert r.json()["error"]["code"] in ("sold_out", "all_held")
    server = public_batch(app_url, code)
    assert (server["held"], server["available"], server["sold"]) == (1, 0, 0)


def test_hold_expiry_edge_on_server_clock(app_url: str, mail: Any, killbill: Any) -> None:
    with app_copy(HOLD_TTL_SECONDS=str(HOLD_TTL_MIN)) as base:
        code = new_batch(base, bars=1)
        c, email = verified(base, mail)
        r = hold(c, code)
        h = r.json()["hold"]
        edge = utc(h["expires_at"])
        assert (edge - utc(h["created_at"])).total_seconds() == HOLD_TTL_MIN
        cart = c.get("/api/cart").json()
        if utc(cart["server_now"]) < edge:
            assert [x["id"] for x in cart["holds"]] == [h["id"]]
        eventually(lambda: utc(c.get("/api/cart").json()["server_now"]) >= edge, HOLD_TTL_MIN * 3, "server past edge")
        error(checkout(c, [h["id"]]), 410, "hold_expired")
        assert killbill.account_by_key(email.lower()) is None
        server = public_batch(base, code)
        assert (server["available"], server["held"]) == (1, 0)
        assert c.get("/api/cart").json()["holds"] == []


def test_cart_updates_announced(browser: Browser, app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=3)
    with browse(browser, app_url, f"/?batch={code}") as page:
        button = page.get_by_role("button", name="Hold a bar")
        expect(button).to_be_enabled(timeout=EXPECT_MS)
        with holding(page, "**/api/holds") as gate:
            click(button)
            pending = page.get_by_role("button", name="Holding…")
            expect(pending).to_be_disabled(timeout=EXPECT_MS)
            expect(pending).to_have_attribute("aria-busy", "true")
            gate.release()
        expect(cart_region(page)).to_have_text("Bar 1 is held for you. Time left: 10:00. Total is now $23.00.",
                                               timeout=EXPECT_MS)
        click(page.get_by_role("button", name="Hold a bar"))
        expect(cart_region(page)).to_have_text(cart_copy("held", 2, QC_TWO_TOTAL), timeout=EXPECT_MS)
        click(page.get_by_role("button", name="Hold a bar"))
        expect(cart_region(page)).to_have_text("You can hold up to 2 bars from one batch.", timeout=EXPECT_MS)
        click(go_link(page, 2))
        expect(page.get_by_role("heading", name="Checkout", level=1)).to_be_visible(timeout=EXPECT_MS)
        click(release_button(page, 2))
        expect(cart_region(page)).to_have_text(cart_copy("released", 2, QC_ONE_TOTAL), timeout=EXPECT_MS)
    assert SHORT_TTL_S > ONE_MINUTE_S
    with app_copy(HOLD_TTL_SECONDS=str(SHORT_TTL_S)) as base:
        short = new_batch(base, bars=1)
        with browse(browser, base, f"/?batch={short}") as page:
            click(page.get_by_role("button", name="Hold a bar"))
            click(go_link(page, 1))
            expect(page.get_by_role("heading", name="Checkout", level=1)).to_be_visible(timeout=EXPECT_MS)
            region = cart_region(page)
            follow_real_time(page, lambda: region.inner_text().strip() == cart_copy("minute", 1),
                             SHORT_TTL_S, "one-minute mark")
            follow_real_time(page, lambda: region.inner_text().strip() == cart_copy("ended", 1, 0),
                             SHORT_TTL_S + NETWORK_GRACE_S, "hold ended")
        assert public_batch(base, short)["available"] == 1
    french = new_batch(app_url, bars=2)
    with browse(browser, app_url, f"/?batch={french}", locale="fr-CA") as page:
        click(page.get_by_role("button", name="Réserver un pain"))
        expect(cart_region(page, "Mises à jour du panier")).to_have_text(
            cart_copy("held", 1, QC_ONE_TOTAL, "fr-CA"), timeout=EXPECT_MS)
    for kind, expected in (("held", "Every bar is held right now. A bar comes back if a hold ends without payment."),
                           ("sold", "Sold out. The last bar is gone. You were not charged.")):
        one = new_batch(app_url, bars=1)
        with browse(browser, app_url, f"/?batch={one}") as page:
            expect(page.get_by_role("button", name="Hold a bar")).to_be_enabled(timeout=EXPECT_MS)
            if kind == "held":
                assert hold(client(app_url), one).status_code == 201
            else:
                buy(app_url, mail, one)
            click(page.get_by_role("button", name="Hold a bar"))
            expect(cart_region(page)).to_have_text(expected, timeout=EXPECT_MS)
            within_page(page, POLL_CATCHUP_MS, lambda: (
                page.get_by_role("button", name="All bars are held").is_disabled() if kind == "held"
                else page.get_by_text("Sold out", exact=True).is_visible()), "hold control state")


def test_stepup_same_answer_for_known_and_unknown(app_url: str, mail: Any) -> None:
    known = [verified(app_url, mail)[1] for _ in range(TIMING_SAMPLES // 2)]
    c = client(app_url)

    def timed(email: str) -> float:
        start = time.monotonic()
        r = c.post("/api/auth/code", json={"email": email, "purpose": "sign_in"})
        elapsed = time.monotonic() - start
        assert r.status_code == 202 and r.json() == {"status": "sent"}, r.text
        assert elapsed < STEPUP_S
        return elapsed * 1000

    known_ms = [timed(e) for e in known for _ in range(2)]
    unknown_ms = [timed(person("dp20u")[1]) for _ in range(TIMING_SAMPLES)]
    assert abs(statistics.median(known_ms) - statistics.median(unknown_ms)) <= TIMING_SPREAD_MS
    wrong_known = c.post("/api/auth/verify", json={"email": known[0], "code": "000000"})
    wrong_unknown = c.post("/api/auth/verify", json={"email": person("dp20x")[1], "code": "000000"})
    assert wrong_known.status_code == wrong_unknown.status_code == 422
    assert wrong_known.json() == wrong_unknown.json()
    assert wrong_known.json()["error"]["fields"] == {"code": CODE_FIELD}
    start = time.monotonic()
    r = client(MAIL_DOWN).post("/api/auth/code", json={"email": person("dp20m")[1], "purpose": "checkout"})
    assert r.status_code == 202 and r.json() == {"status": "sent"}
    assert time.monotonic() - start < STEPUP_S


def test_stepup_rate_limit(app_url: str, mail: Any) -> None:
    c = client(app_url)
    _, fresh = person("dp20r")
    _, known = verified(app_url, mail)
    for _ in range(RATE_LIMIT):
        assert c.post("/api/auth/code", json={"email": fresh, "purpose": "checkout"}).status_code == 202
    for _ in range(RATE_LIMIT - 1):
        assert c.post("/api/auth/code", json={"email": known, "purpose": "checkout"}).status_code == 202
    limited = [c.post("/api/auth/code", json={"email": e, "purpose": "checkout"}) for e in (fresh, known)]
    for r in limited:
        err = error(r, 429, "rate_limited")
        assert err["message"] == RATE_COPY
        assert 1 <= int(r.headers["Retry-After"]) <= RATE_WINDOW_S
    assert limited[0].json() == limited[1].json()
    assert len(settled(mail, fresh, CODE_SUBJECT)) == RATE_LIMIT
    with app_copy(STEPUP_RATE_WINDOW_SECONDS=str(SHORT_WINDOW_S)) as base:
        c2 = client(base)
        _, email = person("dp20w")
        for _ in range(RATE_LIMIT):
            assert c2.post("/api/auth/code", json={"email": email, "purpose": "checkout"}).status_code == 202
        r = c2.post("/api/auth/code", json={"email": email, "purpose": "checkout"})
        error(r, 429, "rate_limited")
        assert 1 <= int(r.headers["Retry-After"]) <= SHORT_WINDOW_S
        eventually(lambda: c2.post("/api/auth/code", json={"email": email, "purpose": "checkout"}).status_code == 202,
                   SHORT_WINDOW_S * 3, "window reopens")


def test_stepup_lockout(app_url: str, mail: Any) -> None:
    c = client(app_url)
    _, email = person("dp20l")
    before = code_set(mail, email)
    assert c.post("/api/auth/code", json={"email": email, "purpose": "sign_in"}).status_code == 202
    code = new_code(mail, email, before)
    wrong = f"{(int(code) + 1) % 1000000:06d}"
    for _ in range(WRONG_BEFORE_LOCK):
        err = error(c.post("/api/auth/verify", json={"email": email, "code": wrong}), 422, "invalid")
        assert err["fields"] == {"code": CODE_FIELD}
    error(c.post("/api/auth/verify", json={"email": email, "code": wrong}), 429, "stepup_locked")
    error(c.post("/api/auth/verify", json={"email": email, "code": code}), 429, "stepup_locked")
    r = c.post("/api/auth/code", json={"email": email, "purpose": "sign_in"})
    assert r.status_code == 202 and r.json() == {"status": "sent"}
    assert c.get("/api/account").status_code == 401


def test_other_customers_records_not_found(browser: Browser, app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=1)
    owner, _, order = buy(app_url, mail, code)
    r = start_trio(owner)
    assert r.status_code == 201, r.text
    sub = r.json()["subscription"]["number"]
    other, _ = verified(app_url, mail)
    for theirs, unknown in ((f"orders/{order['number']}", "orders/PDL-999999"),
                            (f"subscriptions/{sub}", "subscriptions/SUB-999999")):
        a, b = other.get(f"/api/account/{theirs}"), other.get(f"/api/account/{unknown}")
        assert a.status_code == b.status_code == 404 and a.json() == b.json()
        assert a.json()["error"]["code"] == "not_found"
    a = other.post(f"/api/account/subscriptions/{sub}/skip", json={})
    b = other.post("/api/account/subscriptions/SUB-999999/skip", json={})
    assert a.status_code == b.status_code == 404 and a.json() == b.json()
    assert owner.get(f"/api/account/subscriptions/{sub}").status_code == 200
    assert owner.get(f"/api/account/subscriptions/{sub}").json()["skipped_bill_date"] is None
    with browse(browser, app_url, "/") as page:
        adopt(page, other, app_url)
        for path in (f"/account/orders/{order['number']}", "/account/orders/PDL-999999",
                     f"/account/subscriptions/{sub}"):
            resp = page.goto(f"{app_url}{path}")
            assert resp.status == 404, path
            expect(page.get_by_role("heading", name="We couldn't find that", level=1)).to_be_visible(timeout=EXPECT_MS)
            expect(page.get_by_text(NOT_FOUND_LINE)).to_be_visible()


TOTAL_CASES = {
    "qc-one-bar": ("QC", 1, 2000, [("GST", "5%", 100), ("QST", "9.975%", 200)], 2300),
    "qc-two-bars": ("QC", 2, 3100, [("GST", "5%", 155), ("QST", "9.975%", 309)], 3564),
    "on-one-bar": ("ON", 1, 2000, [("HST", "13%", 260)], 2260),
}


@pytest.mark.parametrize("case", list(TOTAL_CASES), ids=list(TOTAL_CASES))
def test_drop_order_totals_and_killbill(app_url: str, mail: Any, killbill: Any, case: str) -> None:
    province, bars, pre_tax, taxes, total = TOTAL_CASES[case]
    code = new_batch(app_url, bars=bars)
    c, email = verified(app_url, mail)
    ids = [hold(c, code).json()["hold"]["id"] for _ in range(bars)]
    cart = c.get("/api/cart", params={"province": province}).json()
    expected_taxes = [{"code": t, "rate": rate, "amount": money(cents)} for t, rate, cents in taxes]
    assert cart["subtotal"] == money(bars * BAR_CENTS) and cart["shipping_fee"] == money(SHIPPING_CENTS)
    assert cart["taxes"] == expected_taxes and cart["total"] == money(total)
    err = error(c.get("/api/cart", params={"province": "ZZ"}), 422, "invalid")
    assert err["fields"] == {"province": "Choose a province or territory."}
    r = checkout(c, ids, province)
    assert r.status_code == 201, r.text
    order = r.json()["order"]
    assert order["subtotal"] == money(bars * BAR_CENTS) and order["shipping_fee"] == money(SHIPPING_CENTS)
    assert order["subtotal"]["cents"] + order["shipping_fee"]["cents"] == pre_tax
    assert order["taxes"] == expected_taxes and order["total"] == money(total)
    assert order["status"] == "paid" and order["fulfilment"] == "to_pack" and order["refunded"] == money(0)
    assert [(ln["batch"], ln["bar"]) for ln in order["lines"]] == [(code, k) for k in range(1, bars + 1)]
    account = killbill.account_by_key(email.lower())
    assert account and account["externalKey"] == email and account["currency"] == "CAD"
    assert account["timeZone"] == "America/Toronto"
    payment = killbill.payment_by_key(order["number"])
    assert payment and kb_cents(payment["purchasedAmount"]) == total
    purchases = [t for t in payment["transactions"] if t["transactionType"] == "PURCHASE"]
    assert len(purchases) == 1 and purchases[0]["transactionExternalKey"] == order["number"]
    invoice, items = kb_item_totals(killbill, account["accountId"])
    assert kb_cents(invoice["balance"]) == 0
    assert items["Shipping"][0] == SHIPPING_CENTS
    for k in range(1, bars + 1):
        assert items[f"Bar {k} · {code} · Rose Clay"][0] == BAR_CENTS
    for tax_code, _, cents in taxes:
        assert items[tax_code][0] == cents


def test_checkout_idempotency(app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=2)
    c, email = verified(app_url, mail)
    hid = hold(c, code).json()["hold"]["id"]
    key = idempotency_key()
    body = {"holds": [hid], "shipping": dict(SHIP)}
    error(c.post("/api/checkout", json=body), 400, "idempotency_key_required")
    error(c.post("/api/checkout", json=body, headers={"Idempotency-Key": "short"}), 400, "idempotency_key_invalid")
    first = c.post("/api/checkout", json=body, headers={"Idempotency-Key": key})
    assert first.status_code == 201, first.text
    reordered = {"shipping": dict(reversed(list(SHIP.items()))), "holds": [hid]}
    replay = clone(c).post("/api/checkout", json=reordered, headers={"Idempotency-Key": key})
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replayed") == "true"
    changed = c.post("/api/checkout", json={"holds": [hid], "shipping": {**SHIP, "province": "ON"}},
                     headers={"Idempotency-Key": key})
    error(changed, 409, "idempotency_key_reused")
    number = first.json()["order"]["number"]
    orders = c.get("/api/account").json()["orders"]
    assert [o["number"] for o in orders] == [number]
    account = killbill.account_by_key(email.lower())
    assert len([p for p in killbill.payments(account["accountId"])
                if p.get("paymentExternalKey", "").startswith("PDL-")]) == 1
    assert len(settled(mail, email, rf"^Order {number} confirmed$")) == 1
    assert public_batch(app_url, code)["sold"] == 1


def test_checkout_all_or_nothing(app_url: str, mail: Any, killbill: Any) -> None:
    base = KILLBILL_DOWN
    code = new_batch(base, bars=2)
    c, email = verified(base, mail)
    hid = hold(c, code).json()["hold"]["id"]
    start = time.monotonic()
    err = error(checkout(c, [hid]), 503, "billing_unavailable")
    assert time.monotonic() - start <= BILLING_503_S
    assert err["message"] == CHECKOUT_503
    r = c.post("/api/checkout", json={"holds": [hid], "total": money(1),
                                      "shipping": {**SHIP, "country": "CA"}},
               headers={"Idempotency-Key": idempotency_key()})
    err = error(r, 422, "invalid")
    assert err["fields"] == {"shipping.country": CANT_SET, "total": CANT_SET}
    cart = c.get("/api/cart").json()
    assert [h["id"] for h in cart["holds"]] == [hid] and cart["holds"][0]["status"] == "active"
    assert c.get("/api/account").json()["orders"] == []
    assert killbill.account_by_key(email.lower()) is None
    assert settled(mail, email, r"^Order ") == []
    server = public_batch(base, code)
    assert (server["held"], server["sold"]) == (1, 0)
    main_code = new_batch(app_url, bars=1)
    m, m_email = verified(app_url, mail)
    mid = hold(m, main_code).json()["hold"]["id"]
    bad = {**SHIP, "name": "Ana\nBcc: x@example.ca", "postal_code": "12345"}
    err = error(checkout(m, [mid], shipping=bad), 422, "invalid")
    assert err["fields"] == {"shipping.name": "Enter your full name.",
                             "shipping.postal_code": "Enter a Canadian postal code like H2T 1S6."}
    assert killbill.account_by_key(m_email.lower()) is None
    assert m.get("/api/cart").json()["holds"][0]["id"] == mid


def test_trio_price_matches_killbill(app_url: str, mail: Any, killbill: Any) -> None:
    c, email = verified(app_url, mail)
    for cadence in (None, "WEEKLY"):
        err = error(start_trio(c, cadence=cadence), 422, "invalid")
        assert err["fields"] == {"cadence": "Choose how often your Trio arrives."}
    assert killbill.account_by_key(email.lower()) is None
    cases = [("QC", [("GST", "5%", 145), ("QST", "9.975%", 290)], 3339, c),
             ("NS", [("HST", "14%", 407)], 3311, verified(app_url, mail)[0])]
    for province, taxes, total, cust in cases:
        r = start_trio(cust, province=province)
        assert r.status_code == 201, r.text
        body = r.json()
        sub = body["subscription"]
        assert sub["price"] == {"subtotal": money(3300), "discount": money(396), "pre_tax": money(2904),
                                "taxes": [{"code": t, "rate": rate, "amount": money(a)} for t, rate, a in taxes],
                                "total": money(total)}
        assert body["charged_today"] == money(total) and body["credit_applied"] == money(0)
        started = date.fromisoformat(sub["started_on"])
        assert sub["next_bill_date"] == shift_months(started, 1).isoformat()
        assert sub["state"] == "active" and sub["cadence"] == "MONTHLY" and sub["pending_cadence"] is None
        payment = killbill.payment_by_key(f"{sub['number']}-{sub['started_on']}")
        assert payment and kb_cents(payment["purchasedAmount"]) == total


def test_credit_covers_first_trio_invoice(app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=1)
    c, email, order = buy(app_url, mail, code)
    fin = staff(app_url, "finance")
    for cents in (2500, 2000):
        _, etag = staff_record(fin, order["number"])
        r = credit(fin, order["number"], cents, etag)
        assert r.status_code == 201 and r.json()["credit"]["status"] == "issued", r.text
    r = start_trio(c)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["credit_applied"] == money(TRIO_QC_TOTAL) and body["charged_today"] == money(0)
    sub = body["subscription"]
    assert killbill.payment_by_key(f"{sub['number']}-{sub['started_on']}") is None
    msg = wait_mails(mail, email, 1, rf"^Subscription {sub['number']} started$")[0]
    assert fill_copy(MAIL_LINES["charged"], money=money_text(0)) in text(msg).splitlines()


def test_one_trio_per_customer(app_url: str, mail: Any, killbill: Any) -> None:
    c, email = verified(app_url, mail)
    results = together([lambda cc=clone(c): start_trio(cc) for _ in range(5)])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409, 409]
    for r in results:
        if r.status_code == 409:
            error(r, 409, "subscription_exists")
    number = next(r for r in results if r.status_code == 201).json()["subscription"]["number"]
    subs = c.get("/api/account").json()["subscriptions"]
    assert [s["number"] for s in subs] == [number]
    account = killbill.account_by_key(email.lower())
    assert len([p for p in killbill.payments(account["accountId"])
                if p.get("paymentExternalKey", "").startswith("SUB-")]) == 1
    assert len(settled(mail, email, r"^Subscription SUB-\d{6} started$")) == 1
    error(start_trio(c), 409, "subscription_exists")
    r = c.post(f"/api/account/subscriptions/{number}/cancel", json={})
    assert r.status_code == 200 and r.json()["subscription"]["state"] == "cancelled", r.text
    r = start_trio(c)
    assert r.status_code == 201 and r.json()["subscription"]["number"] != number


def test_subscription_changes_fail_cleanly(app_url: str, mail: Any, killbill: Any) -> None:
    with relay(kb_target(), up=True) as kb, app_copy(KILLBILL_URL=f"http://127.0.0.1:{kb.port}") as base:
        c, email = verified(base, mail)
        r = start_trio(c)
        assert r.status_code == 201, r.text
        sub = r.json()["subscription"]
        path = f"/api/account/subscriptions/{sub['number']}"
        before = c.get(path).content
        aid = killbill.account_by_key(email.lower())["accountId"]
        kb.set_up(False)
        for action in ("skip", "pause", "cancel"):
            start = time.monotonic()
            err = error(c.post(f"{path}/{action}", json={}), 503, "billing_unavailable")
            assert err["message"] == SUB_BANNER and time.monotonic() - start <= BILLING_503_S
        err = error(c.patch(path, json={"cadence": "QUARTERLY"}), 503, "billing_unavailable")
        assert err["message"] == SUB_BANNER
        assert c.get(path).content == before
        assert kb_blocks(aid) == []
        assert "trio-quarterly" not in json.dumps(killbill.subscriptions(aid))
        kb.set_up(True)
        r = eventually(lambda: (lambda x: x if x.status_code == 200 else None)(c.post(f"{path}/skip", json={})),
                       RECOVER_S + STATUS_S, "skip after recovery")
        skipped = r.json()["subscription"]
        assert skipped["skipped_bill_date"] == sub["next_bill_date"]
        assert skipped["next_bill_date"] == shift_months(date.fromisoformat(sub["started_on"]), 2).isoformat()
        skip_at = toronto_utc(f"{sub['next_bill_date']}T00:00")
        clear_at = toronto_utc(f"{skipped['next_bill_date']}T00:00")
        names = kb_blocks(aid)
        assert ("TRIO_SKIP", skip_at) in names and ("TRIO_CLEAR", clear_at) in names, names
        r = c.post(f"{path}/unskip", json={})
        assert r.status_code == 200 and r.json()["subscription"]["next_bill_date"] == sub["next_bill_date"]
        assert ("TRIO_CLEAR", skip_at) in kb_blocks(aid)


def test_billing_outage_and_recovery(browser: Browser, app_url: str, mail: Any) -> None:
    base = KILLBILL_DOWN
    eventually(lambda: httpx.get(f"{base}/api/status").json()["billing"] == "down", STATUS_S, "billing down")
    c, _ = verified(base, mail)
    err = error(start_trio(c), 503, "billing_unavailable")
    assert err["message"] == SUB_BANNER
    rec = staff(base, "finance").get("/api/staff/reconciliation").json()
    assert rec["stale"] is True
    code = new_batch(base, bars=1)
    with browse(browser, base, f"/?batch={code}") as page:
        status = page.get_by_role("status", name="Service status")
        pump(page, lambda: status.inner_text().strip() == DROP_BANNER, BANNER_S, "drop banner")
        page.goto(f"{base}/subscribe")
        status = page.get_by_role("status", name="Service status")
        pump(page, lambda: status.inner_text().strip() == SUB_BANNER, BANNER_S, "subscribe banner")
        expect(page.get_by_role("button", name="Subscriptions paused")).to_be_disabled()
    with relay(kb_target(), up=False) as kb, app_copy(KILLBILL_URL=f"http://127.0.0.1:{kb.port}") as copy:
        eventually(lambda: httpx.get(f"{copy}/api/status").json()["billing"] == "down", STATUS_S, "copy billing down")
        code = new_batch(copy, bars=1)
        buyer, email = verified(copy, mail)
        hid = hold(buyer, code).json()["hold"]["id"]
        key = idempotency_key()
        error(checkout(buyer, [hid], key=key), 503, "billing_unavailable")
        assert buyer.get("/api/cart").json()["holds"][0]["id"] == hid
        kb.set_up(True)
        eventually(lambda: httpx.get(f"{copy}/api/status").json()["billing"] == "up", RECOVER_S + STATUS_S, "billing up")
        r = eventually(lambda: (lambda x: x if x.status_code == 201 else None)(checkout(buyer, [hid], key=key)),
                       RECOVER_S, "checkout after recovery")
        assert r.json()["order"]["total"] == money(2300)


def first_sunday_of_november(year: int) -> date:
    d = date(year, 11, 1)
    return d + timedelta(days=(6 - d.weekday()) % 7)


def second_sunday_of_march(year: int) -> date:
    d = date(year, 3, 1)
    return d + timedelta(days=(6 - d.weekday()) % 7 + 7)


def toronto_utc(local: str) -> datetime:
    return datetime.fromisoformat(local).replace(tzinfo=ZoneInfo(TIME_ZONE), fold=0).astimezone(timezone.utc)


def test_drop_times_in_toronto_time(browser: Browser, app_url: str) -> None:
    maker = staff(app_url, "maker")
    today = toronto_today(maker)
    year = today.year if first_sunday_of_november(today.year) > today else today.year + 1
    fall = first_sunday_of_november(year)
    spring_year = today.year if second_sunday_of_march(today.year) > today else today.year + 1
    gap = f"{second_sunday_of_march(spring_year).isoformat()}T02:30"
    code = new_batch(app_url, state="curing")
    path = f"/api/staff/batches/{code}/schedule"
    for local in (f"{fall.isoformat()}T01:30", f"{fall.isoformat()}T10:00"):
        r = maker.post(path, json={"drop_at_local": local})
        assert r.status_code == 200, r.text
        batch = r.json()["batch"]
        assert batch["state"] == "scheduled" and batch["drop_at_local"] == local
        assert batch["drop_at"] == iso_ms(toronto_utc(local))
    for value, message in ((gap, "That time doesn't exist in Toronto: clocks spring forward."),
                           ("tomorrow 10am", "Enter a date and time like 2026-11-07T10:00.")):
        err = error(maker.post(path, json={"drop_at_local": value}), 422, "invalid")
        assert err["fields"] == {"drop_at_local": message}
    past = error(maker.post(path, json={"drop_at_local": "2020-01-01T10:00"}), 422, "invalid")
    assert past["fields"]["drop_at_local"].startswith(
        ("Choose a time in the future.", "The drop can't be before the cure date, "))
    young = maker.post("/api/staff/batches", json={"scent": "wild-mint", "poured_on": today.isoformat(),
                                                   "cure_days": CURE_MAX}).json()["batch"]["code"]
    assert maker.post(f"/api/staff/batches/{young}/cut", json={"bars": 4}).status_code == 200
    err = error(maker.post(f"/api/staff/batches/{young}/schedule",
                           json={"drop_at_local": f"{(today + timedelta(days=1)).isoformat()}T10:00"}), 422, "invalid")
    assert err["fields"]["drop_at_local"].startswith("The drop can't be before the cure date, ")
    settings = maker.get("/api/staff/settings").json()
    assert settings["time_zone"] == "America/Toronto"
    assert re.fullmatch(r"\d{2}:\d{2}", settings["packing_cutoff_local"])
    err = error(maker.put("/api/staff/settings", json={"packing_cutoff_local": "2pm"}), 422, "invalid")
    assert err["fields"] == {"packing_cutoff_local": "Enter a time like 14:00."}
    r = maker.put("/api/staff/settings", json={"packing_cutoff_local": settings["packing_cutoff_local"]})
    assert r.status_code == 200 and r.json() == settings
    day = fall.day
    english = f"Sunday, November {day}, {year} at 10:00 (Toronto time)"
    french = f"dimanche {'1er' if day == 1 else day} novembre {year} à 10 h 00 (heure de Toronto)"
    for locale, region, expected in (("en-CA", "Drop time", english), ("fr-CA", "Heure de la vente", french)):
        with browse(browser, app_url, "/", locale=locale) as page:
            session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "Pacific/Auckland"})
            page.goto(f"{app_url}/?batch={code}")
            stamp = page.get_by_role("region", name=region).get_by_role("time")
            expect(stamp).to_have_text(expected, timeout=EXPECT_MS)
            assert utc(stamp.get_attribute("datetime")) == toronto_utc(f"{fall.isoformat()}T10:00")


def test_batch_board_matches_drop(browser: Browser, app_url: str) -> None:
    code = new_batch(app_url, bars=3)
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "maker")
        page.goto(f"{app_url}/studio/batches")
        row = page.get_by_role("table", name="Batches").get_by_role("row").filter(has_text=code)
        expect(row).to_contain_text("Live", timeout=EXPECT_MS)
        expect(row).to_contain_text("Rose Clay")
        marks = page.get_by_role("list", name=f"Bars of {code}").get_by_role("listitem")
        expect(marks).to_have_text(["Bar 1: available", "Bar 2: available", "Bar 3: available"])
        shopper = client(app_url)
        assert hold(shopper, code).status_code == 201
        within_page(page, POLL_CATCHUP_MS, lambda: marks.nth(0).inner_text().strip() == "Bar 1: held", "board hold")
        public = public_batch(app_url, code)
        staff_view = next(b for b in staff(app_url, "maker").get("/api/staff/batches").json()["batches"]
                          if b["code"] == code)
        for key in ("bars_cut", "available", "held", "sold", "bars", "state"):
            assert staff_view[key] == public[key]
        assert [h["bar"] for h in staff_view["holds"]] == [1]
        cells = row.inner_text()
        for value in (str(public["bars_cut"]), str(public["available"]), str(public["held"])):
            assert value in cells


def test_staff_roles_enforced(app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=1)
    _, _, order = buy(app_url, mail, code)
    number = order["number"]
    error(client(app_url).get("/api/staff/batches"), 401, "unauthenticated")
    packing = staff(app_url, "packing")
    for r in (packing.get("/api/staff/batches"), packing.get("/api/staff/settings"),
              packing.put("/api/staff/settings", json={"packing_cutoff_local": "14:00"}),
              packing.get("/api/staff/search", params={"q": number}), packing.get(f"/api/staff/orders/{number}"),
              packing.post(f"/api/staff/orders/{number}/refunds",
                           json={"bars": [{"batch": code, "bar": 1}], "restock": True, "reason": REASON}),
              packing.post("/api/staff/credits", json={"target": number, "amount_cents": CREDIT_MIN, "reason": REASON},
                           headers={"Idempotency-Key": idempotency_key(), "If-Match": '"1"'}),
              packing.get("/api/staff/reconciliation"), packing.get("/api/staff/audit"),
              packing.get("/api/staff/notices")):
        error(r, 403, "forbidden")
    assert packing.get("/api/staff/packing").status_code == 200
    finance = staff(app_url, "finance")
    for r in (finance.get("/api/staff/batches"), finance.get("/api/staff/settings"),
              finance.get("/api/staff/packing"), finance.post(f"/api/staff/orders/{number}/ship", json={}),
              finance.get(f"/api/staff/batches/{code}/movements"),
              finance.post("/api/staff/batches", json={"scent": "wild-mint", "poured_on": "2020-01-01",
                                                       "cure_days": CURE_MIN})):
        error(r, 403, "forbidden")
    for path in ("/api/staff/audit", "/api/staff/notices", "/api/staff/reconciliation"):
        assert finance.get(path).status_code == 200
    assert finance.get("/api/staff/search", params={"q": number}).status_code == 200
    maker = staff(app_url, "maker")
    for path in ("/api/staff/batches", "/api/staff/packing", "/api/staff/audit", f"/api/staff/orders/{number}"):
        assert maker.get(path).status_code == 200, path
    detail, _ = staff_record(maker, number)
    assert detail["version"] == 1 and detail["fulfilment"] == "to_pack" and detail["refunds"] == []
    assert kb_refunds(killbill.payment_by_key(number)) == []


def test_one_shipment_wins(app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=4)
    _, _, order = buy(app_url, mail, code)
    maker = staff(app_url, "maker")
    before, _ = staff_record(maker, order["number"])
    packers = [staff(app_url, "packing") for _ in range(6)]
    results = together([lambda p=p: p.post(f"/api/staff/orders/{order['number']}/ship", json={}) for p in packers])
    assert sorted(r.status_code for r in results) == [200] + [409] * 5
    for r in results:
        if r.status_code == 409:
            error(r, 409, "already_shipped")
        else:
            assert r.json()["order"]["fulfilment"] == "shipped"
    after, _ = staff_record(maker, order["number"])
    assert after["version"] == before["version"] + 1 and after["fulfilment"] == "shipped"
    _, _, second = buy(app_url, mail, code)
    _, etag = staff_record(maker, second["number"])
    packer, fin = staff(app_url, "packing"), staff(app_url, "finance")
    bar = second["lines"][0]["bar"]
    ship, ref = together([lambda: packer.post(f"/api/staff/orders/{second['number']}/ship", json={}),
                          lambda: refund(fin, second["number"], [(code, bar)], etag)])
    payment = killbill.payment_by_key(second["number"])
    if ship.status_code == 200:
        error(ref, 412, "stale_version")
        assert kb_refunds(payment) == []
    else:
        assert ref.status_code == 201, ref.text
        error(ship, 409, "order_refunded")
        assert len(kb_refunds(payment)) == 1
    final, _ = staff_record(maker, second["number"])
    assert not (final["fulfilment"] == "shipped" and final["status"] == "refunded")


def test_refund_allocation(app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=4)
    _, email, order = buy(app_url, mail, code, bars=2)
    number = order["number"]
    fin, maker = staff(app_url, "finance"), staff(app_url, "maker")
    _, etag = staff_record(fin, number)
    error(refund(fin, number, [(code, 1)], None), 428, "precondition_required")
    err = error(refund(fin, number, [], etag), 422, "invalid")
    assert err["fields"] == {"bars": "Choose at least one bar from this order."}
    r = refund(fin, number, [(code, 1)], etag)
    assert r.status_code == 201, r.text
    first = r.json()["refund"]
    assert first["status"] == "issued" and first["amount"] == money(REFUND_FIRST) and first["restock"] is True
    assert first["allocation"] == {"bars": money(1100), "shipping": money(0),
                                   "taxes": [{"code": "GST", "rate": "5%", "amount": money(FIRST_GST)},
                                             {"code": "QST", "rate": "9.975%", "amount": money(FIRST_QST)}]}
    assert r.json()["order"]["status"] == "partially_refunded"
    movements = maker.get(f"/api/staff/batches/{code}/movements").json()["movements"]
    assert {"kind": "restock", "bars": [1], "ref": first["number"]}.items() <= movements[-1].items()
    assert public_batch(app_url, code)["bars"][0]["status"] == "available"
    aid = killbill.payment_by_key(number)["accountId"]
    _, items = kb_item_totals(killbill, aid)
    assert items[f"Bar 1 · {code} · Rose Clay"] == (1100, 1100) and items[f"Bar 2 · {code} · Rose Clay"][1] == 0
    assert items["Shipping"][1] == 0 and items["GST"][1] == FIRST_GST and items["QST"][1] == FIRST_QST
    _, etag = staff_record(maker, number)
    error(refund(maker, number, [(code, 1)], etag), 409, "already_refunded")
    _, etag = staff_record(maker, number)
    r = refund(maker, number, [(code, 2)], etag, restock=False)
    assert r.status_code == 201, r.text
    final = r.json()["refund"]
    assert final["amount"] == money(REFUND_FINAL)
    assert final["allocation"] == {"bars": money(1100), "shipping": money(900),
                                   "taxes": [{"code": "GST", "rate": "5%", "amount": money(FINAL_GST)},
                                             {"code": "QST", "rate": "9.975%", "amount": money(FINAL_QST)}]}
    assert r.json()["order"]["status"] == "refunded" and r.json()["order"]["refunded"] == money(QC_TWO_TOTAL)
    assert public_batch(app_url, code)["bars"][1]["status"] == "sold"
    invoice, items = kb_item_totals(killbill, aid)
    assert kb_cents(invoice["balance"]) == 0
    for desc, (amount, adjusted) in items.items():
        assert adjusted == amount, (desc, amount, adjusted)
    assert items["Shipping"] == (900, 900) and items["GST"] == (155, 155) and items["QST"] == (309, 309)
    payment = killbill.payment_by_key(number)
    assert sorted(kb_cents(t["amount"]) for t in kb_refunds(payment)) == [REFUND_FIRST, REFUND_FINAL]
    writers = killbill.writers(payment["accountId"], payment["paymentId"])
    assert STAFF["finance"][0] in writers and STAFF["maker"][0] in writers
    notices = wait_mails(mail, email, 2, rf"^Refund RF-\d{{6}} for order {number}$")
    bodies = sorted(text(m) for m in settled(mail, email, rf"^Refund RF-\d{{6}} for order {number}$"))
    assert len(bodies) == 2 and len(notices) >= 2
    for cents in (REFUND_FIRST, REFUND_FINAL):
        assert any(fill_copy(MAIL_LINES["refunded"], money=money_text(cents)) in b.splitlines() for b in bodies)
    wcode = new_batch(app_url, bars=2)
    _, _, worder = buy(app_url, mail, wcode)
    assert maker.post(f"/api/staff/batches/{wcode}/withdraw", json={}).status_code == 200
    _, etag = staff_record(fin, worder["number"])
    err = error(refund(fin, worder["number"], [(wcode, 1)], etag), 422, "invalid")
    assert err["fields"] == {"restock": "This batch was withdrawn; its bars can't go back on sale."}


def test_goodwill_credits_cap(app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=1)
    c, email, order = buy(app_url, mail, code)
    sub = start_trio(c).json()["subscription"]["number"]
    fin = staff(app_url, "finance")
    record, etag = staff_record(fin, order["number"])
    for bad in (CREDIT_MIN - 1, CREDIT_MAX + 1, 10.5, "25"):
        err = error(credit(fin, order["number"], bad, etag), 422, "invalid")
        assert err["fields"] == {"amount_cents": "Enter an amount from $1.00 to $25.00."}
    err = error(credit(fin, order["number"], CREDIT_MIN, etag, reason="ok"), 422, "invalid")
    assert err["fields"] == {"reason": "Give a reason of 3 to 500 characters."}
    assert staff_record(fin, order["number"])[0]["version"] == record["version"]
    assert settled(mail, email, r"^Credit CR-") == []
    error(credit(fin, "PDL-999999", CREDIT_MIN, '"1"'), 404, "not_found")
    r = credit(fin, order["number"], CREDIT_MAX, etag)
    assert r.status_code == 201, r.text
    cr = r.json()["credit"]
    assert (cr["target"], cr["status"], cr["amount"]) == (order["number"], "issued", money(CREDIT_MAX))
    assert cr["killbill_ref"]
    kb_account = killbill.account_by_key(email.lower())
    credit_items = [i for inv in killbill.invoices(kb_account["accountId"]) for i in inv.get("items", [])
                    if i.get("description") == f"Goodwill {cr['number']}"]
    assert credit_items and abs(kb_cents(credit_items[0]["amount"])) == CREDIT_MAX
    msg = wait_mails(mail, email, 1, rf"^Credit {cr['number']} added to your account$")[0]
    assert fill_copy(MAIL_LINES["amount"], money=money_text(CREDIT_MAX)) in text(msg).splitlines()
    _, setag = staff_record(fin, sub)
    r = credit(fin, sub, CREDIT_MIN, setag)
    assert r.status_code == 201, r.text
    sub_credit = r.json()["credit"]
    detail, _ = staff_record(fin, sub)
    assert [x["number"] for x in detail["credits"]] == [sub_credit["number"]]
    assert detail["email"] == email


def test_money_actions_refuse_stale_views(app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=2)
    _, _, order = buy(app_url, mail, code, bars=2)
    number = order["number"]
    fin_a, fin_b = staff(app_url, "finance"), staff(app_url, "finance")
    _, etag = staff_record(fin_a, number)
    results = together([lambda: refund(fin_a, number, [(code, 1)], etag),
                        lambda: refund(fin_b, number, [(code, 2)], etag)])
    assert sorted(r.status_code for r in results) == [201, 412]
    error(next(r for r in results if r.status_code == 412), 412, "stale_version")
    assert len(kb_refunds(killbill.payment_by_key(number))) == 1
    _, etag = staff_record(fin_a, number)
    results = together([lambda: credit(fin_a, number, CREDIT_MIN, etag),
                        lambda: credit(fin_b, number, CREDIT_MIN, etag)])
    assert sorted(r.status_code for r in results) == [201, 412]
    detail, _ = staff_record(fin_a, number)
    assert len(detail["credits"]) == 1 and len([x for x in detail["refunds"] if x["status"] == "issued"]) == 1


def test_finance_audit_append_only(app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=2)
    _, _, order = buy(app_url, mail, code, bars=2)
    number = order["number"]
    fin = staff(app_url, "finance")
    _, etag = staff_record(fin, number)
    rf = refund(fin, number, [(code, 1)], etag).json()["refund"]
    _, etag = staff_record(fin, number)
    cr = credit(fin, number, CREDIT_MIN, etag).json()["credit"]
    entries = [e for e in fin.get("/api/staff/audit").json()["entries"] if e["target"] == number]
    assert len(entries) == 2
    by_action = {e["action"]: e for e in entries}
    for action, record in (("refund", rf), ("credit", cr)):
        e = by_action[action]
        assert (e["actor"], e["role"], e["reason"], e["outcome"]) == (STAFF["finance"][0], "finance", REASON, "issued")
        assert e["amount"] == record["amount"] and e["killbill_ref"] == record["killbill_ref"]
    assert entries[0]["id"] == by_action["credit"]["id"]
    entry_id = by_action["refund"]["id"]
    snapshot = json.dumps(by_action["refund"], sort_keys=True)
    for role in STAFF:
        s = staff(app_url, role)
        for method in ("PUT", "PATCH", "DELETE"):
            r = s.request(method, f"/api/staff/audit/{entry_id}", json={} if method != "DELETE" else None)
            error(r, 405, "audit_immutable")
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            r = s.request(method, "/api/staff/audit", json={} if method != "DELETE" else None)
            error(r, 405, "audit_immutable")
    again = next(e for e in fin.get("/api/staff/audit").json()["entries"] if e["id"] == entry_id)
    assert json.dumps(again, sort_keys=True) == snapshot


def make_orphan(base: str, kb: Relay, mail: Any, killbill: Any) -> tuple[httpx.Client, str, str, str]:
    code = new_batch(base, bars=1)
    c, email = verified(base, mail)
    hid = hold(c, code).json()["hold"]["id"]
    kb.blackhole = PAYMENT_CALL
    err = error(checkout(c, [hid]), 503, "billing_unavailable")
    assert err["message"] == CHECKOUT_503
    kb.blackhole = None
    assert kb.swallowed >= 1
    account = eventually(lambda: killbill.account_by_key(email.lower()), MAIL_WAIT_S, "orphan account")
    payment = eventually(lambda: next((p for p in killbill.payments(account["accountId"])
                                       if kb_cents(p.get("purchasedAmount", 0)) > 0), None),
                         MAIL_WAIT_S, "orphan payment")
    assert c.get("/api/cart").json()["holds"][0]["id"] == hid
    assert c.get("/api/account").json()["orders"] == []
    return c, hid, payment["paymentId"], payment["paymentExternalKey"]


def test_orphan_payment_found_and_refunded(app_url: str, mail: Any, killbill: Any) -> None:
    with relay(kb_target(), up=True) as kb, app_copy(KILLBILL_URL=f"http://127.0.0.1:{kb.port}") as base:
        c, hid, pid, orphan_key = make_orphan(base, kb, mail, killbill)
        fin = staff(base, "finance")
        key = f"payment:{pid}"
        rec, line = recon_line(fin, key)
        assert line == {"key": key, "kind": "payment", "shop": None, "killbill": money(QC_ONE_TOTAL),
                        "status": "kb_only"}
        r = fin.post("/api/staff/reconciliation/refund-orphan", json={"month": rec["month"], "key": key})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["refund"]["amount"] == money(QC_ONE_TOTAL) and body["refund"]["killbill_ref"]
        assert body["line"] == {"key": key, "kind": "payment", "shop": None, "killbill": money(0), "status": "refunded"}
        audit = body["audit"]
        assert (audit["action"], audit["target"], audit["reason"]) == ("orphan_refund", pid, "Orphan payment")
        assert audit["amount"] == money(QC_ONE_TOTAL) and audit["killbill_ref"] == body["refund"]["killbill_ref"]
        error(fin.post("/api/staff/reconciliation/refund-orphan", json={"month": rec["month"], "key": key}),
              409, "line_not_orphan")
        payment = killbill.payment_by_key(orphan_key)
        assert sum(kb_cents(t["amount"]) for t in kb_refunds(payment)) == QC_ONE_TOTAL
        r = checkout(c, [hid])
        assert r.status_code == 201, r.text
        assert r.json()["order"]["number"] != orphan_key


def test_notice_retry_schedule_and_single_resend(app_url: str) -> None:
    with isolated_copy(smtp_up=False) as (base, _):
        notice_retry_schedule(base)


def notice_retry_schedule(base: str) -> None:
    _, email = person("dp45")
    r = contact(client(base), email)
    assert r.status_code == 201, r.text
    key = f"contact.{r.json()['reference']}"
    fin = staff(base, "finance")
    notice = eventually(lambda: (lambda n: n if n and n["status"] == "failed" else None)(notice_by_key(fin, key)),
                        RETRY_WAIT_S, "notice failed")
    attempts = [utc(a["at"]) for a in notice["attempts"]]
    assert len(attempts) == MAX_ATTEMPTS and all(a["outcome"] == "failed" for a in notice["attempts"])
    assert (attempts[0] - utc(notice["enqueued_at"])).total_seconds() <= FIRST_ATTEMPT_S
    for gap, delay in zip([(b - a).total_seconds() for a, b in zip(attempts, attempts[1:])], RETRY_DELAYS):
        assert delay <= gap <= delay + RETRY_SLACK_S, (gap, delay)
    clients = [staff(base, "finance") for _ in range(5)]
    results = together([lambda s=s: s.post(f"/api/staff/notices/{notice['number']}/resend", json={})
                        for s in clients])
    assert sorted(x.status_code for x in results) == [200, 409, 409, 409, 409]
    for x in results:
        if x.status_code == 409:
            error(x, 409, "notice_not_failed")
    fresh = next(x for x in results if x.status_code == 200).json()["notice"]
    assert (fresh["number"], fresh["key"], fresh["status"]) == (notice["number"], key, "queued")
    assert utc(fresh["enqueued_at"]) > utc(notice["enqueued_at"])
    again = eventually(lambda: (lambda n: n if len(n["attempts"]) >= 2 else None)(notice_by_key(fin, key)),
                       RETRY_WAIT_S, "second schedule")
    gap = (utc(again["attempts"][1]["at"]) - utc(again["attempts"][0]["at"])).total_seconds()
    assert RETRY_DELAYS[0] <= gap <= RETRY_DELAYS[0] + RETRY_SLACK_S


def test_emails_carry_only_public_identifiers(app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=1)
    c, email, order = buy(app_url, mail, code)
    name = f"Zoé Probe {email.split('@')[0][-6:]}"
    ref = contact(c, email, name=name).json()["reference"]
    msgs = wait_mails(mail, email, 3)
    msgs = settled(mail, email)
    account = killbill.account_by_key(email.lower())
    payment = killbill.payment_by_key(order["number"])
    forbidden = FORBIDDEN_HOSTS + ["://", "www.", account["accountId"], payment["paymentId"]] + secret_values()
    forbidden += [v for v in c.cookies.values() if len(v) >= SECRET_MIN_LEN]
    keys = {f"order.{order['number']}", f"contact.{ref}"}
    seen = set()
    for m in msgs:
        body, subject = text(m), m.get("Subject", "")
        for bad in forbidden:
            assert bad not in body and bad not in subject, (bad, subject)
        assert not UUID_RE.search(body) and not UUID_RE.search(subject)
        assert name not in subject
        assert [t.get("Name", "") for t in m["To"]] == [""] and addresses(m["To"]) == [email]
        assert addresses(m["From"]) == [mail_from_address()]
        assert m["From"].get("Name") == "Pain de Lune"
        assert not m.get("Attachments")
        assert HYPHENS in body.splitlines()
        assert m["MessageID"].endswith("@paindelune.example")
        seen.add(m["MessageID"].removesuffix("@paindelune.example").strip("<"))
    assert keys <= seen
    reply = next(m for m in msgs if m["Subject"] == f"We received your message {ref}")
    assert f"Thanks, {name}. We reply within two business days." in text(reply).splitlines()


def test_wf_cross_cutting_french_journey(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/contact", locale="fr-CA") as page:
        nav = page.get_by_role("navigation", name="Principal")
        for link in ("Vente", "S'abonner", "Compte", "Contact"):
            expect(nav.get_by_role("link", name=link)).to_be_visible(timeout=EXPECT_MS)
        expect(page.get_by_role("button", name="English")).to_be_visible()
        click(page.get_by_role("button", name="Envoyer le message"))
        summary = page.get_by_role("alert", name="Vérifiez ces champs")
        expect(summary).to_be_focused(timeout=EXPECT_MS)
        expect(summary.get_by_role("link")).to_have_text(
            ["Entrez votre nom complet.", "Entrez une adresse courriel comme nom@exemple.ca.", "Choisissez un sujet.",
             f"Écrivez un message de 10 à 2{NBSP}000 caractères."])
    r = client(app_url, "fr-CA").get("/api/cart", params={"province": "ZZ"})
    err = error(r, 422, "invalid")
    assert err["fields"] == {"province": "Choisissez une province ou un territoire."}


def test_wf_cross_cutting_not_found_bilingual(browser: Browser, app_url: str) -> None:
    for locale, heading, line in (("en-CA", "We couldn't find that", NOT_FOUND_LINE),
                                  ("fr-CA", "Introuvable", "Cette page ou ce dossier n'existe pas, ou ne vous appartient pas.")):
        with browse(browser, app_url, "/", locale=locale) as page:
            resp = page.goto(f"{app_url}/nowhere-here")
            assert resp.status == 404
            expect(page.get_by_role("heading", name=heading, level=1)).to_be_visible(timeout=EXPECT_MS)
            expect(page.get_by_text(line)).to_be_visible()
            main_links = page.get_by_role("main").get_by_role("link")
            assert any(urlparse(main_links.nth(i).get_attribute("href") or "").path in ("/", "")
                       for i in range(main_links.count()))


def test_wf_drop_scene_desktop_scrub(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, f"/?batch={SEED_LIVE}") as page:
        scene_ready(page)
        forward = list(range(0, SCROLL_TRAVEL + 1, 150))
        values = []
        for y in forward + list(reversed(forward)):
            scroll_to(page, y)
            assert_formula(page, SEED_LIVE_BARS)
            values.append(float(fattr(page, "data-wire") or "0"))
        half = len(forward)
        assert values[:half] == sorted(values[:half]) and values[half:] == sorted(values[half:], reverse=True)
        assert values[half - 1] == float(SEED_LIVE_BARS)
        scroll_to(page, 600)
        click(page.get_by_role("radio", name="Smoked Birch"))
        expect(fig(page)).to_have_attribute("data-batch", SEED_SCHEDULED)
        assert_cut_step(page, SEED_SCHEDULED_BARS)
        advance(page, MEDIUM_MAX_MS + FRAME_MS)
        assert_formula(page, SEED_SCHEDULED_BARS)
        expect(page.get_by_role("region", name="Batch")).to_contain_text(f"{SEED_SCHEDULED_BARS} bars cut")


def test_wf_drop_scene_phone_touch_reduced(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, f"/?batch={SEED_LIVE}") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        scene_ready(page)
        layout(page)
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        box = fig(page).bounding_box()
        cx, cy = int(box["x"] + box["width"] / 2), int(box["y"] + box["height"] / 2)
        cdp.send("Input.synthesizeScrollGesture", {"x": cx, "y": cy, "yDistance": -500,
                                                    "gestureSourceType": "touch", "speed": 1500})
        advance(page, FRAME_MS)
        assert_formula(page, SEED_LIVE_BARS)
        assert fattr(page, "data-yaw") == "0"
        page.emulate_media(reduced_motion="reduce")
        advance(page, PREF_MS)
        expect(fig(page)).to_have_attribute("data-motion", "reduced", timeout=NETWORK_GRACE_S * 1000)
        scroll_to(page, SCROLL_TRAVEL)
        assert fattr(page, "data-animating") == "false" and fattr(page, "data-cut-step") == str(SEED_LIVE_BARS)
        cdp.send("Input.synthesizeScrollGesture", {"x": cx, "y": cy, "yDistance": 400,
                                                    "gestureSourceType": "touch", "speed": 1500})
        advance(page, FRAME_MS)
        assert_formula(page, SEED_LIVE_BARS)
        assert fattr(page, "data-animating") == "false" and fattr(page, "data-yaw") == "0"
        page.emulate_media(reduced_motion="no-preference")
        advance(page, PREF_MS)
        expect(fig(page)).to_have_attribute("data-motion", "full", timeout=NETWORK_GRACE_S * 1000)


def test_wf_holds_hold_and_release(browser: Browser, app_url: str) -> None:
    code = new_batch(app_url, bars=3)
    with browse(browser, app_url, f"/?batch={code}") as page:
        button = page.get_by_role("button", name="Hold a bar")
        click(button)
        expect(go_link(page, 1)).to_be_visible(timeout=EXPECT_MS)
        expect(page.get_by_role("button", name="Hold a bar")).to_be_focused()
        click(page.get_by_role("button", name="Hold a bar"))
        click(go_link(page, 2))
        expect(page.get_by_role("heading", name="Checkout", level=1)).to_be_visible(timeout=EXPECT_MS)
        rows = page.get_by_role("region", name="Your held bars")
        expect(rows).to_contain_text(fill_copy(HELD_ROW, k=1, scent="Rose Clay", batch=code))
        expect(rows).to_contain_text(fill_copy(HELD_ROW, k=2, scent="Rose Clay", batch=code))
        expect(page.get_by_role("timer", name=fill_copy(TIMER_NAME, k=1))).to_have_text(TIMER_RE)
        click(release_button(page, 1))
        expect(release_button(page, 2)).to_be_focused(timeout=EXPECT_MS)
        click(release_button(page, 2))
        expect(page.get_by_role("link", name="Back to the drop")).to_be_focused(timeout=EXPECT_MS)
        expect(page.get_by_role("button", name="No bars held")).to_be_disabled()
    server = public_batch(app_url, code)
    assert (server["available"], server["held"]) == (3, 0)


def test_wf_holds_last_bar_two_shoppers(browser: Browser, app_url: str) -> None:
    code = new_batch(app_url, bars=1)
    with browse(browser, app_url, f"/?batch={code}") as first, browse(browser, app_url, f"/?batch={code}") as second:
        expect(first.get_by_role("button", name="Hold a bar")).to_be_enabled(timeout=EXPECT_MS)
        expect(second.get_by_role("button", name="Hold a bar")).to_be_enabled(timeout=EXPECT_MS)
        click(first.get_by_role("button", name="Hold a bar"))
        expect(cart_region(first)).to_have_text("Bar 1 is held for you. Time left: 10:00. Total is now $23.00.",
                                                timeout=EXPECT_MS)
        click(second.get_by_role("button", name="Hold a bar"))
        expect(cart_region(second)).to_have_text(
            "Every bar is held right now. A bar comes back if a hold ends without payment.", timeout=EXPECT_MS)
        expect(second.get_by_role("link", name=copy_re(GO_CHECKOUT))).to_have_count(0)
    server = public_batch(app_url, code)
    assert (server["held"], server["available"]) == (1, 0)


def test_wf_account_access_sign_in(browser: Browser, app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=1)
    _, email, order = buy(app_url, mail, code)
    other_code = new_batch(app_url, bars=1)
    _, _, other = buy(app_url, mail, other_code)
    with browse(browser, app_url, "/account") as page:
        expect(page.get_by_role("heading", name="Sign in", level=1)).to_be_visible(timeout=EXPECT_MS)
        ui_verify(page, mail, email)
        expect(page.get_by_role("heading", name="Your account", level=1)).to_be_visible(timeout=EXPECT_MS)
        orders = page.get_by_role("list", name="Orders")
        expect(orders.get_by_role("link", name=order["number"])).to_be_visible()
        expect(orders.get_by_role("link", name=other["number"])).to_have_count(0)
        click(orders.get_by_role("link", name=order["number"]))
        expect(page.get_by_role("heading", name=f"Order {order['number']}", level=1)).to_be_visible(timeout=EXPECT_MS)
        page.goto(f"{app_url}/account")
        click(page.get_by_role("button", name="Sign out"))
        expect(page.get_by_role("heading", name="Sign in", level=1)).to_be_visible(timeout=EXPECT_MS)
        r = page.request.get(f"{app_url}/api/account")
        assert r.status == 401


def test_wf_account_access_lockout_alert(browser: Browser, app_url: str, mail: Any) -> None:
    _, email = person("wfacl")
    with browse(browser, app_url, "/account") as page:
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        before = code_set(mail, email)
        click(page.get_by_role("button", name="Send code"))
        code = new_code(mail, email, before)
        wrong = f"{(int(code) + 1) % 1000000:06d}"
        box = page.get_by_role("textbox", name="Code", exact=True)
        for _ in range(WRONG_BEFORE_LOCK):
            fill(box, wrong)
            box.press("Enter")
            expect(page.get_by_text(CODE_FIELD).first).to_be_visible(timeout=EXPECT_MS)
        fill(box, wrong)
        click(page.get_by_role("button", name="Verify"))
        alert = page.get_by_role("alert", name="Too many incorrect codes")
        expect(alert).to_be_focused(timeout=EXPECT_MS)
        expect(alert).to_contain_text(LOCK_COPY)
    error(client(app_url).post("/api/auth/verify", json={"email": email, "code": code}), 429, "stepup_locked")


def test_wf_account_access_rate_limited_alert(browser: Browser, app_url: str, mail: Any) -> None:
    _, email = person("wfacr")
    with browse(browser, app_url, "/account") as page:
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        for n in range(1, RATE_LIMIT + 1):
            click(page.get_by_role("button", name="Send code"))
            wait_mails(mail, email, n, CODE_SUBJECT)
        click(page.get_by_role("button", name="Send code"))
        alert = page.get_by_role("alert", name="Too many code requests")
        expect(alert).to_be_focused(timeout=EXPECT_MS)
        expect(alert).to_contain_text(RATE_COPY)
    assert len(settled(mail, email, CODE_SUBJECT)) == RATE_LIMIT


def test_wf_checkout_happy(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=2)
    _, email = person("wfco")
    with browse(browser, app_url, f"/?batch={code}") as page:
        click(page.get_by_role("button", name="Hold a bar"))
        click(go_link(page, 1))
        expect(page.get_by_role("heading", name="Checkout", level=1)).to_be_visible(timeout=EXPECT_MS)
        expect(page.get_by_role("button", name="Verify your email first")).to_be_disabled()
        expect(page.get_by_role("region", name="Order total")).to_contain_text("$23.00")
        ui_verify(page, mail, email)
        expect(page.get_by_role("textbox", name="Full name")).to_be_focused()
        ui_address(page)
        click(pay_button(page, QC_ONE_TOTAL))
        heading = page.get_by_role("heading", name=copy_re(ORDER_PLACED, order=ORDER_RE), level=1)
        expect(heading).to_be_visible(timeout=EXPECT_MS)
        number = re.search(r"PDL-\d{6}", heading.inner_text()).group(0)
        expect(page.get_by_text(f"We'll email your confirmation to {email}.")).to_be_visible()
        assert f"/checkout/placed/{number}" in page.url
    msgs = wait_mails(mail, email, 1, rf"^Order {number} confirmed$")
    assert len(settled(mail, email, rf"^Order {number} confirmed$")) == 1
    lines = text(msgs[0]).splitlines()
    for line in (f"Order: {number}",
                 fill_copy(ORDER_BAR_LINE, k=1, batch=code, scent="Rose Clay", price=money_text(BAR_CENTS)),
                 fill_copy(MAIL_LINES["subtotal"], money=money_text(BAR_CENTS)),
                 "Shipping: $9.00", "GST (5%): $1.00", "QST (9.975%): $2.00", "Total: $23.00", HYPHENS,
                 f"Commande{NBSP}: {number}"):
        assert line in lines, line
    payment = killbill.payment_by_key(number)
    assert payment and kb_cents(payment["purchasedAmount"]) == QC_ONE_TOTAL
    assert "loafline" in killbill.writers(payment["accountId"], payment["paymentId"])


def test_wf_checkout_invalid_address(browser: Browser, app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=1)
    _, email = person("wfci")
    with browse(browser, app_url, f"/?batch={code}") as page:
        click(page.get_by_role("button", name="Hold a bar"))
        click(go_link(page, 1))
        ui_verify(page, mail, email)
        ui_address(page, city="", postal="12345")
        click(pay_button(page, QC_ONE_TOTAL))
        summary = page.get_by_role("alert", name="Check these fields")
        expect(summary).to_be_focused(timeout=EXPECT_MS)
        expect(summary.get_by_role("link")).to_have_text(
            ["Enter your city.", "Enter a Canadian postal code like H2T 1S6."])
        expect(page.get_by_role("textbox", name="City")).to_have_attribute("aria-invalid", "true")
        click(summary.get_by_role("link", name="Enter your city."))
        expect(page.get_by_role("textbox", name="City")).to_be_focused()
        fill(page.get_by_role("textbox", name="City"), "Toronto")
        fill(page.get_by_role("textbox", name="Postal code"), "M5V 2T6")
        select(page.get_by_role("combobox", name="Province"), "Ontario")
        click(pay_button(page, ON_ONE_TOTAL))
        expect(page.get_by_role("heading", name=copy_re(ORDER_PLACED, order=ORDER_RE), level=1)).to_be_visible(
            timeout=EXPECT_MS)
        adopt_back = page.request.get(f"{app_url}/api/account").json()
    assert [o["total"] for o in adopt_back["orders"]] == [money(ON_ONE_TOTAL)]


def test_wf_checkout_billing_paused(browser: Browser, mail: Any, killbill: Any) -> None:
    base = KILLBILL_DOWN
    code = new_batch(base, bars=1)
    _, email = person("wfcp")
    with browse(browser, base, f"/?batch={code}") as page:
        click(page.get_by_role("button", name="Hold a bar"))
        click(go_link(page, 1))
        ui_verify(page, mail, email)
        ui_address(page)
        status = page.get_by_role("status", name="Service status")
        pump(page, lambda: status.inner_text().strip() == DROP_BANNER, BANNER_S, "checkout banner")
        expect(page.get_by_role("button", name="Checkout paused")).to_be_disabled()
        cart = page.request.get(f"{base}/api/cart").json()
    assert len(cart["holds"]) == 1
    assert killbill.account_by_key(email.lower()) is None


def ui_subscribe(page: Page, mail: Any, email: str, scent: str = "Oat Milk", cadence: str = "Every month") -> None:
    check(page.get_by_role("radiogroup", name="Trio scent").get_by_role("radio", name=scent))
    click(page.get_by_role("button", name="Cadence", exact=True))
    click(page.get_by_role("option", name=cadence))
    ui_verify(page, mail, email)
    ui_address(page)


def test_wf_subscribe_happy(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    _, email = person("wfsh")
    with browse(browser, app_url, "/subscribe") as page:
        expect(page.get_by_role("heading", name="Trio subscription", level=1)).to_be_visible(timeout=EXPECT_MS)
        ui_subscribe(page, mail, email)
        price = page.get_by_role("region", name="Trio price")
        expect(price).to_contain_text("-$3.96")
        expect(price).to_contain_text("$33.39")
        click(page.get_by_role("button", name="Start subscription"))
        heading = page.get_by_role("heading", name=copy_re(SUB_HEADING, sub=SUB_RE), level=1)
        expect(heading).to_be_visible(timeout=EXPECT_MS)
        number = re.search(r"SUB-\d{6}", heading.inner_text()).group(0)
        assert f"/account/subscriptions/{number}" in page.url
        expect(page.get_by_role("status", name="Account updates")).to_have_text(
            fill_copy(SUB_STARTED, amount=money_text(TRIO_QC_TOTAL)), timeout=EXPECT_MS)
        sub = page.request.get(f"{app_url}/api/account/subscriptions/{number}").json()
    msg = wait_mails(mail, email, 1, rf"^Subscription {number} started$")[0]
    assert len(settled(mail, email, rf"^Subscription {number} started$")) == 1
    lines = text(msg).splitlines()
    for line in (f"Subscription: {number}", fill_copy(MAIL_LINES["trio"], scent="Oat Milk"),
                 fill_copy(MAIL_LINES["cadence"], **{"cadence label": "Every month"}),
                 fill_copy(MAIL_LINES["subtotal"], money=money_text(TRIO_LIST)),
                 fill_copy(MAIL_LINES["discount"], money=money_text(TRIO_DISCOUNT)),
                 fill_copy(MAIL_LINES["total"], money=money_text(TRIO_QC_TOTAL)),
                 fill_copy(MAIL_LINES["charged"], money=money_text(TRIO_QC_TOTAL)),
                 f"Next bill date: {sub['next_bill_date']}", HYPHENS):
        assert line in lines, line
    payment = killbill.payment_by_key(f"{number}-{sub['started_on']}")
    assert payment and kb_cents(payment["purchasedAmount"]) == TRIO_QC_TOTAL


def test_wf_subscribe_two_tabs(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    _, email = person("wfst")
    with browse(browser, app_url, "/subscribe") as page:
        ui_subscribe(page, mail, email)
        second = page.context.new_page()
        second.goto(f"{app_url}/subscribe")
        check(second.get_by_role("radiogroup", name="Trio scent").get_by_role("radio", name="Oat Milk"))
        click(second.get_by_role("button", name="Cadence", exact=True))
        click(second.get_by_role("option", name="Every month"))
        ui_address(second)
        page.get_by_role("button", name="Start subscription").click(no_wait_after=True)
        second.get_by_role("button", name="Start subscription").click(no_wait_after=True)
        started = [tab.get_by_role("heading", name=copy_re(SUB_HEADING, sub=SUB_RE), level=1) for tab in (page, second)]
        eventually(lambda: any(h.first.is_visible() for h in started), EXPECT_MS / 1000,
                   "a started-subscription heading in either tab")
        account = page.request.get(f"{app_url}/api/account").json()
    assert len(account["subscriptions"]) == 1
    kb_account = killbill.account_by_key(email.lower())
    assert len([p for p in killbill.payments(kb_account["accountId"])
                if p.get("paymentExternalKey", "").startswith("SUB-")]) == 1
    assert len(settled(mail, email, r"^Subscription SUB-\d{6} started$")) == 1


def test_wf_manage_subscription_changes(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    c, email = verified(app_url, mail)
    sub = start_trio(c).json()["subscription"]
    number = sub["number"]
    aid = killbill.account_by_key(email.lower())["accountId"]
    path = f"/api/account/subscriptions/{number}"
    before = c.get(path).content
    err = error(c.patch(path, json={"state": "cancelled"}), 422, "invalid")
    assert err["fields"] == {"state": CANT_SET}
    error(c.patch(path, json={"next_bill_date": "2026-12-01"}), 422, "invalid")
    assert c.get(path).content == before
    err = error(c.patch(path, json={"cadence": "MONTHLY"}), 422, "invalid")
    assert err["fields"] == {"cadence": "That is already your cadence."}
    started = date.fromisoformat(sub["started_on"])
    updates = None
    with browse(browser, app_url, "/") as page:
        adopt(page, c, app_url)
        page.goto(f"{app_url}/account/subscriptions/{number}")
        updates = page.get_by_role("status", name="Account updates")
        click(page.get_by_role("button", name="Skip next delivery"))
        expect(page.get_by_role("button", name="Undo skip")).to_be_focused(timeout=EXPECT_MS)
        expect(updates).to_have_text(copy_re(SKIPPED))
        now = c.get(path).json()
        assert now["skipped_bill_date"] == sub["next_bill_date"]
        assert now["next_bill_date"] == shift_months(started, 2).isoformat()
        click(page.get_by_role("button", name="Undo skip"))
        expect(page.get_by_role("button", name="Skip next delivery")).to_be_focused(timeout=EXPECT_MS)
        expect(updates).to_have_text(copy_re(UNSKIPPED))
        assert c.get(path).json()["next_bill_date"] == sub["next_bill_date"]
        check(page.get_by_role("radiogroup", name="Trio scent").get_by_role("radio", name="Cedar & Sage"))
        click(page.get_by_role("button", name="Swap scent"))
        expect(updates).to_have_text(fill_copy(SWAPPED, scent="Cedar & Sage"), timeout=EXPECT_MS)
        now = c.get(path).json()
        assert now["scent"] == "cedar-sage" and now["price"] == sub["price"]
        click(page.get_by_role("button", name="Cadence", exact=True))
        click(page.get_by_role("option", name="Every three months"))
        expect(updates).to_have_text(copy_re(CADENCE_CHANGED, **{"cadence lower-case label": re.escape("every three months")}),
                                     timeout=EXPECT_MS)
        now = c.get(path).json()
        assert (now["cadence"], now["pending_cadence"]) == ("MONTHLY", "QUARTERLY")
        assert "trio-quarterly" in json.dumps(killbill.subscriptions(aid))
        click(page.get_by_role("button", name="Pause", exact=True))
        expect(updates).to_have_text(copy_re(PAUSED), timeout=EXPECT_MS)
        now = c.get(path).json()
        assert (now["state"], now["next_bill_date"], now["paused_from"]) == ("paused", None, sub["next_bill_date"])
        assert ("TRIO_PAUSE", toronto_utc(f"{sub['next_bill_date']}T00:00")) in kb_blocks(aid)
        expect(page.get_by_role("region", name="Next bill date")).to_contain_text("Paused")
        error(c.post(f"{path}/cancel", json={}), 409, "invalid_transition")
        click(page.get_by_role("button", name="Resume"))
        expect(updates).to_have_text(copy_re(RESUMED), timeout=EXPECT_MS)
        assert c.get(path).json()["next_bill_date"] == sub["next_bill_date"]
        opener = page.get_by_role("button", name="Cancel subscription")
        click(opener)
        dialog = page.get_by_role("dialog", name="Cancel subscription?")
        expect(dialog).to_be_visible(timeout=EXPECT_MS)
        assert dialog.evaluate("d => d.contains(document.activeElement)")
        click(dialog.get_by_role("button", name="Keep it"))
        expect(opener).to_be_focused()
        click(opener)
        click(page.get_by_role("button", name="Yes, cancel"))
        expect(updates).to_have_text("Cancelled. Your last delivery is the one already paid.", timeout=EXPECT_MS)
        expect(page.get_by_role("heading", level=1)).to_be_focused()
    assert c.get(path).json()["state"] == "cancelled"
    ends = [str(s.get("billingEndDate", ""))[:10] for s in killbill.subscriptions(aid)]
    assert sub["next_bill_date"] in ends, ends
    error(c.post(f"{path}/resume", json={}), 409, "invalid_transition")


def test_wf_manage_subscription_locked(browser: Browser, app_url: str, mail: Any) -> None:
    with app_copy(SUBSCRIPTION_LOCK_HOURS=str(LOCK_PROBE_HOURS)) as base:
        c, _ = verified(base, mail)
        sub = start_trio(c).json()["subscription"]
        path = f"/api/account/subscriptions/{sub['number']}"
        midnight = datetime.combine(date.fromisoformat(sub["next_bill_date"]), dtime(0), tzinfo=ZoneInfo(TIME_ZONE))
        assert utc(sub["locks_at"]) == midnight.astimezone(timezone.utc) - timedelta(hours=LOCK_PROBE_HOURS)
        assert sub["locked"] is True
        before = c.get(path).content
        for action in ("skip", "pause", "cancel"):
            err = error(c.post(f"{path}/{action}", json={}), 409, "cycle_locked")
            assert copy_re(LOCKED).match(err["message"])
        error(c.patch(path, json={"scent": "cedar-sage"}), 409, "cycle_locked")
        assert c.get(path).content == before
        with browse(browser, base, "/") as page:
            adopt(page, c, base)
            page.goto(f"{base}/account/subscriptions/{sub['number']}")
            click(page.get_by_role("button", name="Skip next delivery"))
            expect(page.get_by_role("status", name="Account updates")).to_have_text(
                copy_re(LOCKED), timeout=EXPECT_MS)
        assert c.get(path).content == before


def test_wf_maker_log_cut_open(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/studio") as page:
        fill(page.get_by_role("textbox", name="Email", exact=True), STAFF["maker"][0])
        fill(page.get_by_role("textbox", name="Password"), STAFF["maker"][1])
        click(page.get_by_role("button", name="Sign in"))
        studio_nav = page.get_by_role("navigation", name="Studio")
        expect(studio_nav).to_be_visible(timeout=EXPECT_MS)
        click(studio_nav.get_by_role("link", name="Batches"))
        today = date.fromisoformat(page.request.get(f"{app_url}/api/staff/packing").json()["date"])
        form = page.get_by_role("region", name="Log a loaf")
        select(form.get_by_role("combobox", name="Scent"), "Rose Clay")
        fill(form.get_by_role("textbox", name="Pour date"), (today - timedelta(days=CURE_MIN)).isoformat())
        fill(form.get_by_role("spinbutton", name="Cure days"), str(CURE_MIN))
        click(form.get_by_role("button", name="Log loaf"))
        updates = studio_region(page)
        expect(updates).to_have_text(copy_re(LOAF_LOGGED, code=BATCH_RE), timeout=EXPECT_MS)
        code = re.search(BATCH_RE, updates.inner_text()).group(0)
        click(page.get_by_role("button", name=f"Cut {code}"))
        dialog = page.get_by_role("dialog", name=f"Cut {code}")
        fill(dialog.get_by_role("spinbutton", name="Bars cut"), "6")
        click(dialog.get_by_role("button", name="Save cut"))
        expect(updates).to_have_text(fill_copy(CUT_SAVED, code=code, N=6), timeout=EXPECT_MS)
        click(page.get_by_role("button", name=f"Open now {code}"))
        expect(updates).to_have_text(fill_copy(OPENED, code=code), timeout=EXPECT_MS)
        row = page.get_by_role("table", name="Batches").get_by_role("row").filter(has_text=code)
        expect(row).to_contain_text("Live")
    batch = public_batch(app_url, code)
    assert (batch["state"], batch["bars_cut"], batch["available"], batch["scent"]) == ("live", 6, 6, "rose-clay")
    movements = staff(app_url, "maker").get(f"/api/staff/batches/{code}/movements").json()["movements"]
    assert [(m["kind"], m["bars"]) for m in movements] == [("cut", [1, 2, 3, 4, 5, 6])]


def test_wf_maker_rules_and_withdraw(browser: Browser, app_url: str) -> None:
    maker = staff(app_url, "maker")
    today = toronto_today(maker)
    for body, field, message in (
            ({"scent": "wild-mint", "poured_on": today.isoformat(), "cure_days": CURE_MIN - 1}, "cure_days",
             "Cure time is 28 to 60 days."),
            ({"scent": "wild-mint", "poured_on": (today + timedelta(days=1)).isoformat(), "cure_days": CURE_MIN},
             "poured_on", "The pour date can't be in the future.")):
        assert error(maker.post("/api/staff/batches", json=body), 422, "invalid")["fields"] == {field: message}
    young = maker.post("/api/staff/batches", json={"scent": "wild-mint", "poured_on": today.isoformat(),
                                                   "cure_days": CURE_MIN}).json()["batch"]["code"]
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "maker")
        page.goto(f"{app_url}/studio/batches")
        click(page.get_by_role("button", name=f"Cut {young}"))
        dialog = page.get_by_role("dialog", name=f"Cut {young}")
        fill(dialog.get_by_role("spinbutton", name="Bars cut"), str(BARS_MAX + 1))
        click(dialog.get_by_role("button", name="Save cut"))
        expect(dialog.get_by_text("Enter a bar count from 1 to 24.").first).to_be_visible(timeout=EXPECT_MS)
    assert maker.post(f"/api/staff/batches/{young}/cut", json={"bars": 4}).status_code == 200
    err = error(maker.post(f"/api/staff/batches/{young}/open", json={}), 422, "invalid")
    assert err["fields"]["drop_at_local"].startswith("This batch is still curing until ")
    code = new_batch(app_url, bars=3)
    shopper = client(app_url)
    assert hold(shopper, code).status_code == 201
    r = maker.post(f"/api/staff/batches/{code}/withdraw", json={})
    assert r.status_code == 200 and r.json()["batch"]["state"] == "withdrawn"
    assert shopper.get("/api/cart").json()["holds"] == []
    err = error(maker.post(f"/api/staff/batches/{code}/open", json={}), 409, "invalid_transition")
    assert err["message"] == "A batch in state withdrawn can't open."
    fr = staff(app_url, "maker", "fr-CA")
    err = error(fr.post(f"/api/staff/batches/{code}/open", json={}), 409, "invalid_transition")
    assert err["message"] == "Un lot à l'état retiré ne peut pas ouvrir."
    timed = new_batch(app_url, state="curing")
    now = utc(httpx.get(f"{app_url}/api/drop").json()["server_now"]).astimezone(ZoneInfo(TIME_ZONE))
    local = (now + timedelta(minutes=SCHEDULE_AHEAD_MIN)).strftime("%Y-%m-%dT%H:%M")
    assert maker.post(f"/api/staff/batches/{timed}/schedule", json={"drop_at_local": local}).status_code == 200
    eventually(lambda: public_batch(app_url, timed)["state"] == "live", AUTO_OPEN_S, "automatic opening")


def expected_ship_on(placed_at: str, cutoff: str) -> date:
    t = utc(placed_at).astimezone(ZoneInfo(TIME_ZONE))
    hh, mm = (int(x) for x in cutoff.split(":"))
    day = t.date()
    if day.weekday() < 5 and (t.hour, t.minute, t.second, t.microsecond) < (hh, mm, 0, 0):
        return day
    day += timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def has_money(value: Any) -> bool:
    if isinstance(value, dict):
        return "cents" in value or any(has_money(v) for v in value.values())
    if isinstance(value, list):
        return any(has_money(v) for v in value)
    return False


def test_wf_packing_pack_today(browser: Browser, app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=3)
    _, _, order = buy(app_url, mail, code)
    _, _, refunded = buy(app_url, mail, code)
    maker = staff(app_url, "maker")
    cutoff = maker.get("/api/staff/settings").json()["packing_cutoff_local"]
    assert order["ship_on"] == expected_ship_on(order["placed_at"], cutoff).isoformat()
    fin = staff(app_url, "finance")
    _, etag = staff_record(fin, refunded["number"])
    assert refund(fin, refunded["number"], [(code, refunded["lines"][0]["bar"])], etag).status_code == 201
    packer = staff(app_url, "packing")
    listing = packer.get("/api/staff/packing").json()
    assert listing["cutoff_local"] == cutoff
    numbers = [o["number"] for o in listing["orders"]]
    assert refunded["number"] not in numbers
    error(packer.post(f"/api/staff/orders/{refunded['number']}/ship", json={}), 409, "order_refunded")
    assert not has_money(listing)
    assert [(o["ship_on"], o["number"]) for o in listing["orders"]] == sorted(
        (o["ship_on"], o["number"]) for o in listing["orders"])
    due = order["ship_on"] <= listing["date"]
    assert (order["number"] in numbers) == due
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "packing")
        page.goto(f"{app_url}/studio/packing")
        expect(page.get_by_role("heading", name="Pack today", level=1)).to_be_visible(timeout=EXPECT_MS)
        table = page.get_by_role("table", name="Orders to pack")
        row = table.get_by_role("row").filter(has_text=order["number"])
        if due:
            expect(row).to_contain_text(SHIP["name"])
            assert "$" not in row.inner_text()
            click(page.get_by_role("button", name=f"Mark {order['number']} shipped"))
            expect(studio_region(page)).to_have_text(f"{order['number']} marked shipped.", timeout=EXPECT_MS)
        else:
            expect(row).to_have_count(0)
            assert packer.post(f"/api/staff/orders/{order['number']}/ship", json={}).status_code == 200
    error(packer.post(f"/api/staff/orders/{order['number']}/ship", json={}), 409, "already_shipped")
    assert order["number"] not in [o["number"] for o in packer.get("/api/staff/packing").json()["orders"]]


def test_wf_packing_role_limits(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "packing")
        page.goto(f"{app_url}/studio")
        nav = page.get_by_role("navigation", name="Studio")
        expect(nav.get_by_role("link")).to_have_text(["Packing"], timeout=EXPECT_MS)
        for path in ("/api/staff/reconciliation", "/api/staff/audit", "/api/staff/search?q=PDL-000001"):
            r = page.request.get(f"{app_url}{path}")
            assert r.status == 403 and r.json()["error"]["code"] == "forbidden"
        assert page.request.get(f"{app_url}/api/staff/packing").status == 200


def open_order_in_finance(page: Page, base: str, number: str) -> None:
    page.goto(f"{base}/studio/finance")
    box = page.get_by_role("searchbox", name="Find order or subscription")
    fill(box, number)
    box.press("Enter")
    expect(page.get_by_role("table", name=f"Refunds of {number}")).to_be_visible(timeout=EXPECT_MS)


def test_wf_finance_refund_and_credit(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    code = new_batch(app_url, bars=2)
    _, email, order = buy(app_url, mail, code, bars=2)
    number = order["number"]
    packer = staff(app_url, "packing")
    error(packer.post(f"/api/staff/orders/{number}/refunds",
                      json={"bars": [{"batch": code, "bar": 1}], "restock": True, "reason": REASON},
                      headers={"Idempotency-Key": idempotency_key(), "If-Match": '"1"'}), 403, "forbidden")
    error(packer.post("/api/staff/credits", json={"target": number, "amount_cents": CREDIT_MAX, "reason": REASON},
                      headers={"Idempotency-Key": idempotency_key(), "If-Match": '"1"'}), 403, "forbidden")
    assert kb_refunds(killbill.payment_by_key(number)) == []
    untouched, _ = staff_record(staff(app_url, "finance"), number)
    assert untouched["version"] == 1 and untouched["refunds"] == [] and untouched["credits"] == []
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "finance")
        open_order_in_finance(page, app_url, number)
        check(page.get_by_role("checkbox", name=fill_copy(REFUND_BAR, k=1)))
        check(page.get_by_role("checkbox", name="Return bars to stock"))
        fill(page.get_by_role("textbox", name="Refund reason"), REASON)
        click(page.get_by_role("button", name="Issue refund"))
        expect(studio_region(page)).to_have_text(
            copy_re(REFUND_ISSUED, rf=RF_RE, amount=re.escape(money_text(REFUND_FIRST))),
                                                 timeout=EXPECT_MS)
        expect(page.get_by_role("table", name=f"Refunds of {number}")).to_contain_text("$12.65")
        fill(page.get_by_role("textbox", name="Credit amount"), money_text(UI_CREDIT_CENTS).lstrip("$"))
        fill(page.get_by_role("textbox", name="Credit reason"), REASON)
        click(page.get_by_role("button", name="Add credit"))
        expect(studio_region(page)).to_have_text(
            copy_re(CREDIT_ADDED, cr=CR_RE, amount=re.escape(money_text(UI_CREDIT_CENTS))), timeout=EXPECT_MS)
        page.goto(f"{app_url}/studio/audit")
        expect(page.get_by_role("table", name="Finance audit")).to_contain_text(number, timeout=EXPECT_MS)
    assert [kb_cents(t["amount"]) for t in kb_refunds(killbill.payment_by_key(number))] == [REFUND_FIRST]
    wait_mails(mail, email, 1, rf"^Refund RF-\d{{6}} for order {number}$")
    wait_mails(mail, email, 1, r"^Credit CR-\d{6} added to your account$")
    detail, _ = staff_record(staff(app_url, "finance"), number)
    assert [c["amount"] for c in detail["credits"]] == [money(UI_CREDIT_CENTS)]
    assert [r["amount"] for r in detail["refunds"]] == [money(REFUND_FIRST)]
    assert public_batch(app_url, code)["bars"][0]["status"] == "available"


def test_wf_finance_stale_view(browser: Browser, app_url: str, mail: Any) -> None:
    code = new_batch(app_url, bars=2)
    _, _, order = buy(app_url, mail, code, bars=2)
    number = order["number"]
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "finance")
        open_order_in_finance(page, app_url, number)
        second = page.context.new_page()
        open_order_in_finance(second, app_url, number)
        check(page.get_by_role("checkbox", name=fill_copy(REFUND_BAR, k=1)))
        fill(page.get_by_role("textbox", name="Refund reason"), REASON)
        click(page.get_by_role("button", name="Issue refund"))
        expect(studio_region(page)).to_have_text(copy_re(REFUND_ISSUED, rf=RF_RE), timeout=EXPECT_MS)
        fill(second.get_by_role("textbox", name="Credit amount"), money_text(UI_CREDIT_CENTS).lstrip("$"))
        fill(second.get_by_role("textbox", name="Credit reason"), REASON)
        click(second.get_by_role("button", name="Add credit"))
        expect(studio_region(second)).to_have_text("Someone else changed this record. Reload it and try again.",
                                                   timeout=EXPECT_MS)
    detail, _ = staff_record(staff(app_url, "finance"), number)
    assert detail["credits"] == []


def test_wf_reconciliation_accept_mismatch(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    with relay(kb_target(), up=True) as kb, app_copy(KILLBILL_URL=f"http://127.0.0.1:{kb.port}") as base:
        code = new_batch(base, bars=4)
        _, _, order = buy(base, mail, code, bars=2)
        _, _, matched = buy(base, mail, code)
        fin = staff(base, "finance")
        _, etag = staff_record(fin, order["number"])
        kb.blackhole = REFUND_CALL
        err = error(refund(fin, order["number"], [(code, 1)], etag), 503, "billing_unavailable")
        assert copy_re(REFUND_FAILED, rf=RF_RE).match(err["message"])
        kb.blackhole = None
    key, other = f"order:{order['number']}", f"order:{matched['number']}"
    month = utc(order["placed_at"]).astimezone(ZoneInfo(TIME_ZONE)).strftime("%Y-%m")
    fin = staff(app_url, "finance")
    error(fin.get("/api/staff/reconciliation", params={"month": "2026-13"}), 422, "invalid")
    rec, line = eventually(lambda: (lambda b: b if b[1] and b[1]["status"] == "mismatch" else None)(
        recon_line(fin, key, month)), MAIL_WAIT_S, "mismatch line")
    assert rec["month"] == month and line["shop"] == money(QC_TWO_TOTAL)
    assert line["killbill"] == money(QC_TWO_TOTAL - REFUND_FIRST)
    assert recon_line(fin, other, month)[1]["status"] == "match"
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "finance")
        page.goto(f"{app_url}/studio/reconciliation")
        fill(page.get_by_role("textbox", name="Month"), month)
        table = page.get_by_role("table", name="Reconciliation lines")
        expect(table).to_contain_text(other, timeout=EXPECT_MS)
        switch = page.get_by_role("switch", name="Only mismatches")
        click(switch)
        expect(switch).to_be_focused()
        expect(switch).to_be_checked()
        expect(table.get_by_role("row").filter(has_text=other)).to_have_count(0)
        click(page.get_by_role("button", name=f"Accept Kill Bill figure for {key}"))
        expect(studio_region(page)).to_have_text(
            fill_copy(FIGURE_ACCEPTED, amount=money_text(QC_TWO_TOTAL - REFUND_FIRST), key=key),
                                                 timeout=EXPECT_MS)
    _, line = recon_line(fin, key, month)
    assert line["status"] == "accepted" and line["shop"] == money(QC_TWO_TOTAL - REFUND_FIRST)
    entry = next(e for e in fin.get("/api/staff/audit").json()["entries"]
                 if e["action"] == "reconciliation_accept" and e["target"] == key)
    assert entry["amount"] == money(-REFUND_FIRST) and entry["reason"] == "Accepted Kill Bill figure"
    assert entry["actor"] == STAFF["finance"][0]
    error(fin.post("/api/staff/reconciliation/accept", json={"month": month, "key": key}), 409, "line_not_mismatched")


def test_wf_reconciliation_orphan_refund(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    with relay(kb_target(), up=True) as kb, app_copy(KILLBILL_URL=f"http://127.0.0.1:{kb.port}") as base:
        _, _, pid, orphan_key = make_orphan(base, kb, mail, killbill)
    key = f"payment:{pid}"
    with browse(browser, app_url, "/") as page:
        staff_browser(page, app_url, "finance")
        page.goto(f"{app_url}/studio/reconciliation")
        click(page.get_by_role("button", name=f"Refund orphan payment {key}"))
        expect(studio_region(page)).to_have_text(
            fill_copy(ORPHAN_REFUNDED, key=key, amount=money_text(QC_ONE_TOTAL)), timeout=EXPECT_MS)
    _, line = recon_line(staff(app_url, "finance"), key)
    assert line["status"] == "refunded" and line["killbill"] == money(0)
    assert sum(kb_cents(t["amount"]) for t in kb_refunds(killbill.payment_by_key(orphan_key))) == QC_ONE_TOTAL


def test_wf_reconciliation_stale_banner(browser: Browser, app_url: str) -> None:
    with relay(kb_target(), up=False) as kb, app_copy(KILLBILL_URL=f"http://127.0.0.1:{kb.port}") as base:
        fin = staff(base, "finance")
        rec = fin.get("/api/staff/reconciliation").json()
        assert rec["stale"] is True
        with browse(browser, base, "/") as page:
            staff_browser(page, base, "finance")
            page.goto(f"{base}/studio/reconciliation")
            status = page.get_by_role("status", name="Reconciliation status")
            expect(status).to_have_text(
                re.compile(f"{copy_re(STALE_WITH).pattern}|{copy_re(STALE_NONE).pattern}"), timeout=EXPECT_MS)
            kb.set_up(True)
            fresh = eventually(lambda: (lambda b: b if b["stale"] is False else None)(
                fin.get("/api/staff/reconciliation").json()), RECOVER_S + STATUS_S, "fresh reconciliation")
            assert fresh["checked_at"]
            page.reload()
            expect(page.get_by_role("status", name="Reconciliation status")).to_have_text("", timeout=EXPECT_MS)


def test_wf_notices_resend_failed(browser: Browser) -> None:
    with isolated_copy(smtp_up=False) as (base, _):
        notices_resend_failed(browser, base)


def notices_resend_failed(browser: Browser, base: str) -> None:
    _, email = person("wfnr")
    ref = contact(client(base), email).json()["reference"]
    fin = staff(base, "finance")
    notice = eventually(lambda: (lambda n: n if n and n["status"] == "failed" else None)(
        notice_by_key(fin, f"contact.{ref}")), RETRY_WAIT_S, "notice failed")
    with browse(browser, base, "/") as page:
        staff_browser(page, base, "finance")
        page.goto(f"{base}/studio/notices")
        table = page.get_by_role("table", name="Notices")
        expect(table.get_by_role("row").filter(has_text=notice["number"])).to_contain_text("mail server unreachable",
                                                                                         timeout=EXPECT_MS)
        click(page.get_by_role("button", name=f"Resend {notice['number']}"))
        expect(studio_region(page)).to_have_text(f"{notice['number']} queued again.", timeout=EXPECT_MS)
    assert notice_by_key(fin, f"contact.{ref}")["status"] in ("queued", "retrying")


def mailpit_time(value: str) -> datetime:
    return datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", value.replace("Z", "+00:00")))


def arrival_times(mail: Any) -> dict[str, datetime]:
    listed = mail.client.get("/api/v1/messages", params={"limit": 200}).json()["messages"]
    return {m["ID"]: mailpit_time(m["Created"]) for m in listed}


def test_wf_notices_backlog_drain(browser: Browser, mail: Any) -> None:
    with isolated_copy(smtp_up=False) as (base, smtp):
        emails = [person(f"wfnd{i}")[1] for i in range(3)]
        refs = []
        with browse(browser, base, "/contact") as page:
            for email in emails:
                page.goto(f"{base}/contact")
                fill(page.get_by_role("textbox", name="Name"), "Zoe Probe")
                fill(page.get_by_role("textbox", name="Email", exact=True), email)
                select(page.get_by_role("combobox", name="Topic"), "Something else")
                fill(page.get_by_role("textbox", name="Message"), MESSAGE)
                click(page.get_by_role("button", name="Send message"))
                status = page.get_by_role("status", name="Contact status")
                expect(status).to_have_text(copy_re(CONTACT_OK, ct=CT_RE),
                                            timeout=EXPECT_MS)
                refs.append(re.search(CT_RE, status.inner_text()).group(0))
        burst = [person(f"wfnb{i}")[1] for i in range(4)]
        results = together([lambda e=e: contact(client(base), e) for e in burst])
        assert all(r.status_code == 201 for r in results), [r.text for r in results]
        refs += [r.json()["reference"] for r in results]
        emails += burst
        fin = staff(base, "finance")
        deep = len(RETRY_DELAYS)
        for ref in refs:
            eventually(lambda r=ref: (n := notice_by_key(fin, f"contact.{r}")) and len(n["attempts"]) >= deep,
                       RETRY_WAIT_S, f"third attempt {ref}")
        waiting = [notice_by_key(fin, f"contact.{r}") for r in refs]
        assert all(n["status"] == "retrying" and len(n["attempts"]) == deep for n in waiting), waiting
        recovered = time.monotonic()
        smtp.set_up(True)
        for email in emails:
            wait_mails(mail, email, 1)
        assert time.monotonic() - recovered <= DRAIN_S
        got = [settled(mail, e) for e in emails]
        assert [len(g) for g in got] == [1] * len(emails)
        for ref, (m,) in zip(refs, got):
            assert m["MessageID"].strip("<>") == f"contact.{ref}@paindelune.example"
        notices = {r: notice_by_key(fin, f"contact.{r}") for r in refs}
        expected = sorted(refs, key=lambda r: (utc(notices[r]["enqueued_at"]), notices[r]["number"]))
        landed = arrival_times(mail)
        arrived = {ref: landed[m["ID"]] for ref, (m,) in zip(refs, got)}
        sent_at = {}
        for ref, n in notices.items():
            assert n["status"] == "sent"
            sent_at[ref] = utc(next(a["at"] for a in n["attempts"] if a["outcome"] == "sent"))
        for earlier, later in zip(expected, expected[1:]):
            assert arrived[earlier] <= arrived[later], (earlier, later, arrived)
            assert sent_at[earlier] <= sent_at[later], (earlier, later, sent_at)


def test_wf_contact_happy(browser: Browser, app_url: str, mail: Any) -> None:
    _, email = person("wfch")
    with browse(browser, app_url, "/contact") as page:
        select_box = page.get_by_role("combobox", name="Topic")
        expect(select_box).to_contain_text("Choose a topic")
        fill(page.get_by_role("textbox", name="Name"), "Zoe Probe")
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        select(select_box, "Order question")
        fill(page.get_by_role("textbox", name="Message"), MESSAGE)
        click(page.get_by_role("button", name="Send message"))
        status = page.get_by_role("status", name="Contact status")
        expect(status).to_have_text(copy_re(CONTACT_OK, ct=CT_RE),
                                    timeout=EXPECT_MS)
        ref = re.search(r"CT-\d{6}", status.inner_text()).group(0)
    msg = wait_mails(mail, email, 1, rf"^We received your message {ref}$")[0]
    assert len(settled(mail, email)) == 1
    lines = text(msg).splitlines()
    for line in (f"Reference: {ref}", fill_copy(MAIL_LINES["topic"], **{"topic label": "Order question"}), HYPHENS,
                 f"Référence{NBSP}: {ref}"):
        assert line in lines, line


def test_wf_contact_invalid(browser: Browser, app_url: str, mail: Any) -> None:
    _, email = person("wfci")
    c = client(app_url)
    for body, field, message in (
            ({"name": "Zoe\r\nBcc: x@example.ca", "email": email}, "name", "Enter your full name."),
            ({"name": "Zoe Probe", "email": f"{email}\nCc: x@example.ca"}, "email",
             "Enter an email address like name@example.ca."),
            ({"name": "Zoe Probe", "email": f"Ana <{email}>"}, "email",
             "Enter an email address like name@example.ca."),
            ({"name": "Zoe\u0007Probe", "email": email}, "name", "Enter your full name.")):
        r = c.post("/api/contact", json={**body, "topic": "other", "message": MESSAGE})
        assert error(r, 422, "invalid")["fields"] == {field: message}
    with browse(browser, app_url, "/contact") as page:
        fill(page.get_by_role("textbox", name="Name"), "Zoe Probe")
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_role("textbox", name="Message"), MESSAGE)
        click(page.get_by_role("button", name="Send message"))
        summary = page.get_by_role("alert", name="Check these fields")
        expect(summary).to_be_focused(timeout=EXPECT_MS)
        expect(summary.get_by_role("link")).to_have_text(["Choose a topic."])
        expect(page.get_by_role("combobox", name="Topic")).to_have_attribute("aria-invalid", "true")
    assert settled(mail, email) == []
    assert settled(mail, INJECTED) == []


def test_wf_contact_mail_briefly_down(browser: Browser, mail: Any) -> None:
    with isolated_copy(smtp_up=False) as (base, smtp):
        eventually(lambda: httpx.get(f"{base}/api/status").json()["mail"] == "down", STATUS_S, "mail down")
        _, email = person("wfcd")
        with browse(browser, base, "/contact") as page:
            fill(page.get_by_role("textbox", name="Name"), "Zoe Probe")
            fill(page.get_by_role("textbox", name="Email", exact=True), email)
            select(page.get_by_role("combobox", name="Topic"), "Subscription")
            fill(page.get_by_role("textbox", name="Message"), MESSAGE)
            click(page.get_by_role("button", name="Send message"))
            status = page.get_by_role("status", name="Contact status")
            expect(status).to_have_text(copy_re(CONTACT_OK, ct=CT_RE),
                                        timeout=EXPECT_MS)
            ref = re.search(r"CT-\d{6}", status.inner_text()).group(0)
        smtp.set_up(True)
        wait_mails(mail, email, 1, rf"^We received your message {ref}$")
        assert len(settled(mail, email)) == 1
        eventually(lambda: httpx.get(f"{base}/api/status").json()["mail"] == "up", STATUS_S, "mail up")


APP_ROOT = Path("/app")
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "BlueOak-1.0.0"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "out", ".next", ".vite", "coverage", ".turbo"}


def shipped_packages() -> dict[str, Any]:
    lock = json.loads((APP_ROOT / "package-lock.json").read_text())
    out: dict[str, Any] = {}
    for path, meta in lock.get("packages", {}).items():
        if not path or meta.get("dev") or meta.get("devOptional") or meta.get("link"):
            continue
        out[meta.get("name") or path.split("node_modules/")[-1]] = meta.get("license")
    return out


def licence_ok(value: Any) -> bool:
    if isinstance(value, dict):
        value = value.get("type")
    if not isinstance(value, str):
        return False
    expr = value.replace("(", " ").replace(")", " ")
    if " OR " in expr:
        return any(part.strip() in ALLOWED_LICENCES for part in expr.split(" OR "))
    return all(part.strip() in ALLOWED_LICENCES for part in expr.split(" AND "))


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name in shipped_packages() if name not in notices]
    assert not missing, missing
    for font in ("Fraunces", "Instrument Sans"):
        assert font in notices


def test_if_licences_allowed() -> None:
    bad = {name: lic for name, lic in shipped_packages().items() if not licence_ok(lic)}
    assert not bad, bad
    assert "OFL" in (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_postgres_only() -> None:
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "level", "lokijs",
              "mongodb", "mongoose", "@libsql/client"}
    assert not banned & set(shipped_packages())
    for root, dirs, files in os.walk(APP_ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            assert not f.endswith((".sqlite", ".sqlite3", ".db")), os.path.join(root, f)


def test_if_service_config_untouched() -> None:
    composes = [p for p in APP_ROOT.rglob("*compose*.y*ml") if not SKIP_DIRS & set(p.parts)]
    if not composes:
        return
    if (APP_ROOT / ".git").exists():
        first = subprocess.run(["git", "-C", str(APP_ROOT), "rev-list", "--max-parents=0", "HEAD"],
                               capture_output=True, text=True).stdout.split()
        rel = [str(p.relative_to(APP_ROOT)) for p in composes]
        if first:
            diff = subprocess.run(["git", "-C", str(APP_ROOT), "diff", "--name-only", first[0], "--", *rel],
                                  capture_output=True, text=True).stdout.strip()
            assert diff == "", diff
        status = subprocess.run(["git", "-C", str(APP_ROOT), "status", "--porcelain", "--", *rel],
                                capture_output=True, text=True).stdout.strip()
        assert status == "", status


def test_if_typescript_source() -> None:
    offenders = []
    for root, dirs, files in os.walk(APP_ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith((".js", ".mjs", ".cjs", ".jsx")) and not re.search(r"(config|rc)\b|^\.", f):
                offenders.append(os.path.join(root, f))
    assert not offenders, offenders
