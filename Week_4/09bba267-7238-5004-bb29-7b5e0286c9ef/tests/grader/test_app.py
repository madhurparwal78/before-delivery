from __future__ import annotations

import contextlib
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
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    addresses,
    advance,
    center,
    click as kit_click,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    same_origin,
    licence_allowed,
    session,
    shipped_packages as kit_shipped_packages,
    tab_order,
    tap,
    text,
    unique,
)


PASSCODE = "brass-rail-1897"
FUTURE_START = "2027-02-12T20:00"
FUTURE_LABEL = "Fri 12 Feb 2027, 8:00 PM CST"
EARLIER_START = "2027-02-12T19:00"
LATE_START = "2027-11-07T01:30"
LATE_UTC = "2027-11-07T06:30:00Z"
LATE_LABEL = "Sun 7 Nov 2027, 1:30 AM CDT"
SPRING_GAP_START = "2027-03-14T02:30"
VENUE_TZ = ZoneInfo("America/Chicago")
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NOON = 12

SEED = [
    ("lantern-and-tide", "Lantern & Tide", "2027-02-13T02:00:00Z", "Fri 12 Feb 2027, 8:00 PM CST"),
    ("ostrava-strings", "Ostrava Strings", "2027-03-15T00:30:00Z", "Sun 14 Mar 2027, 7:30 PM CDT"),
    ("fen-and-lark", "Fen & Lark", "2027-05-22T02:00:00Z", "Fri 21 May 2027, 9:00 PM CDT"),
    ("marrow-quartet-late-set", "Marrow Quartet: The Late Set", "2027-11-07T06:30:00Z", "Sun 7 Nov 2027, 1:30 AM CDT"),
]

A_RESERVE, B_RESERVE, C_RESERVE = "A Reserve", "B Reserve", "C Reserve"
A_FACE = 6800
B_FACE = 4500
C_FACE = 2900
FRONT_PAIR = "Front Pair"
FRONT_FACE = 9500
STALLS = "Stalls"
TWO_B_TOTAL = 9736
ONE_FRONT_TOTAL = 10268
A_TO_B_REFUND = 2449
ORDER_FEE = 150
FEE_RATE = 650
FEE_SCALE = 10000
FACE_MIN = 100
FACE_MAX = 100000
MAX_SEATS = 8
TITLE_MAX = 120
NAME_MAX = 80
EMAIL_MAX = 254
KEY_MAX = 100
BODY_LIMIT = 16384
SECTION_NAMES = {"ST": "Stalls", "CI": "Circle", "BA": "Balcony"}
SECTION_ORDER = ["ST", "CI", "BA"]
ROW_COUNT = {"ST": 16, "CI": 8, "BA": 6}
SEATS_PER_ROW = 30
TOTAL_SEATS = 900
ANGLE_LIMIT = 90
DIST_MIN = 2.0
DIST_MAX = 38.0
CENTRE_SEAT = 15

LIVE_UPDATE_S = 2
LIVE_DEADLINE_S = LIVE_UPDATE_S + 2
PAYMENT_DEADLINE_S = 12
READY_DEADLINE_S = 10
GRID_DEADLINE_S = 5
OFFER_EMAIL_S = 5
MAIL_RETRY_S = 10
WEDGE_TOTAL_MS = 750
FRAME_MS = 16
GEOMETRY_PX = 2
TOUCH_PX = 44
SEAT_MIN_PX = 24
SHEET_MAX_FRACTION = 0.4
RAIL_MIN_PX = 320
RAIL_MAX_PX = 400
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}

SEAT_TAKEN_NOTICE = "Someone else got there first. We kept the rest of your selection."
SALES_CLOSED_COPY = "Sales for this performance have closed."
HOLD_ENDED = "Your hold ended and the seats were released."
PAID = "Payment confirmed. Your tickets are issued."
DECLINED = "Your payment was declined. Your seats were released."
PAUSED = "Payments are paused right now. Your seats stay held until your hold ends. Please try again shortly."
CHECK_DETAILS = "Check these details."
OFFER_DECLINED = "Offer declined. The seat goes to the next person waiting."
OFFER_ENDED_HEADING = "This offer has ended"
NOT_FOUND = "We couldn't find that page"
NAME_MSG = "Enter your full name."
EMAIL_MSG = "Enter an email address like name@example.com."
SEATS_MSG = "Choose between 1 and 8 different seats that are on sale for this performance."
LIMIT_MSG = "You can hold up to 8 seats for a performance."
SLOW_PROVIDER_S = 8
PENDING_SEEN_S = 4
EDGE_HOLD_S = 3
EXPIRY_MARGIN_S = 1
KEY_MSG = "Send an Idempotency-Key header of 1 to 100 visible characters."
NEW_SEAT_MSG = "Choose a different seat that is on sale for this performance."
TICKETS_MSG = "Choose one or more different tickets from this order."
TITLE_MSG = "Enter a title of 1 to 120 characters."
START_FORMAT_MSG = "Enter the start as YYYY-MM-DDTHH:MM."
NO_SUCH_TIME_MSG = "That time does not occur in Chicago on that date."
FUTURE_MSG = "The start must be in the future."
TIER_COUNT_MSG = "Add between 1 and 6 tiers."
TIER_MSG = "Each tier needs a name, a face value from $1.00 to $1,000.00 and at least one seat that no other tier uses."

HTTP_TIMEOUT_S = 30
POLL_S = 0.25
EXPECT_STEP_MS = 250
STEP_MS = 25
SETTLE_MS = 1000
MAIL_DEADLINE_S = 30
RETRY_DEADLINE_S = MAIL_RETRY_S * 4
SHORT_HOLD_S = 5
SHORT_OFFER_S = 8
EXPIRY_SLACK_S = 10
SALES_CLOSE_WAIT_S = 150
COPY_BOOT_S = 120
TAB_PRESSES = 40
COUNTDOWN_SLACK_S = 2
SECRET_MIN_LEN = 12
SKEWED_DEVICE_TIME = datetime(2031, 6, 1, 3, 0, tzinfo=timezone.utc)
FOREIGN_ORIGIN = "http://elsewhere.example:8443"
HOLDS_GLOB = "**/api/performances/*/holds"
CHECKOUT_GLOB = "**/api/performances/*/checkout"
REFUNDS_GLOB = "**/api/orders/*/refunds"
DECLINE_STATUS = "PAYMENT_FAILURE"

_PAUSE = threading.Event()


def seat_fee(face: int) -> int:
    return (face * FEE_RATE + FEE_SCALE // 2) // FEE_SCALE


def money(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def label(seat_id: str) -> str:
    section, row, number = seat_id.split("-")
    return f"{SECTION_NAMES[section]} row {row} seat {number}"


def seat_order(seat_id: str) -> tuple[int, str, int]:
    section, row, number = seat_id.split("-")
    return SECTION_ORDER.index(section), row, int(number)


def labels(*seat_ids: str) -> str:
    return ", ".join(label(s) for s in sorted(seat_ids, key=seat_order))


def tier_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def instant(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def venue_label(utc: datetime) -> str:
    local = utc.astimezone(VENUE_TZ)
    hour = local.hour % NOON or NOON
    half = "AM" if local.hour < NOON else "PM"
    return (f"{WEEKDAYS[local.weekday()]} {local.day} {MONTHS[local.month - 1]} {local.year}, "
            f"{hour}:{local.minute:02d} {half} {local.tzname()}")


def offer_expiry_text(utc: datetime) -> str:
    local = utc.astimezone(VENUE_TZ)
    hour = local.hour % NOON or NOON
    half = "AM" if local.hour < NOON else "PM"
    return (f"{hour}:{local.minute:02d}:{local.second:02d} {half} {local.tzname()} on "
            f"{WEEKDAYS[local.weekday()]} {local.day} {MONTHS[local.month - 1]} {local.year}")


def local_start(utc: datetime) -> str:
    return utc.astimezone(VENUE_TZ).strftime("%Y-%m-%dT%H:%M")


def mss(value: str) -> int:
    minutes, seconds = value.strip().split(":")
    return int(minutes) * 60 + int(seconds)


def tier(name: str, face: int, rows: list[str] | None = None, seats: list[str] | None = None) -> dict:
    return {"name": name, "faceCents": face, "rows": list(rows or []), "seats": list(seats or [])}


def standard_layout() -> list[dict]:
    return [
        tier(A_RESERVE, A_FACE, rows=["ST-A", "ST-B"]),
        tier(B_RESERVE, B_FACE, rows=["ST-C", "CI-A"]),
        tier(C_RESERVE, C_FACE, rows=["BA-A"]),
    ]


def poll(probe: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
        _PAUSE.wait(POLL_S)
    value = probe()
    assert value, f"no {what} within {seconds} s"
    return value


def eventually(page: Page, check: Callable[[], None], seconds: float = LIVE_DEADLINE_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            check()
            return
        except AssertionError:
            advance(page, EXPECT_STEP_MS)
    check()


def observe_for(page: Page, seconds: float) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        advance(page, EXPECT_STEP_MS)
        _PAUSE.wait(POLL_S)


def cookie_expired(options: dict[str, str]) -> bool:
    age = options.get("max-age", "")
    if re.fullmatch(r"-?\d+", age):
        return int(age) <= 0
    if options.get("expires"):
        try:
            when = parsedate_to_datetime(options["expires"])
        except (TypeError, ValueError):
            return False
        return (when if when.tzinfo else when.replace(tzinfo=timezone.utc)) <= datetime.now(timezone.utc)
    return False


def same_fan(base: str, b: "Client") -> "Client":
    c = Client(base, b.cookies)
    c.name, c.email = b.name, b.email
    return c


class Client:

    def __init__(self, base: str, cookies: dict[str, str] | None = None) -> None:
        self.base = base.rstrip("/")
        self.cookies = dict(cookies or {})
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)
        self.name, self.email = unique("fan")

    def request(self, method: str, path: str, body: Any = None, key: str | None = None,
                headers: dict[str, str] | None = None, raw: bytes | None = None) -> httpx.Response:
        sent = dict(headers or {})
        if self.cookies:
            sent["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        if key is not None:
            sent["Idempotency-Key"] = key
        content = raw
        if body is not None:
            content = json.dumps(body).encode()
        if content is not None:
            sent.setdefault("Content-Type", "application/json")
        response = self.http.request(method, path, content=content, headers=sent)
        self.http.cookies.clear()
        for header in response.headers.get_list("set-cookie"):
            pair, *attributes = header.split(";")
            name, _, value = pair.partition("=")
            options = {k.strip().lower(): v.strip() for k, _, v in (a.partition("=") for a in attributes)}
            if not value.strip() or cookie_expired(options):
                self.cookies.pop(name.strip(), None)
            else:
                self.cookies[name.strip()] = value.strip()
        return response

    def get(self, path: str) -> httpx.Response:
        return self.request("GET", path)

    def post(self, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        return self.request("POST", path, {} if body is None else body, key)

    def delete(self, path: str) -> httpx.Response:
        return self.request("DELETE", path)


def owner(base: str) -> Client:
    client = Client(base)
    response = client.post("/api/owner/session", {"passcode": PASSCODE})
    assert response.status_code == 204, response.text
    return client


def publish(base: str, tiers: list[dict], start: str = FUTURE_START, title: str | None = None) -> dict:
    title = title or f"Seatwise {unique('show')[0]}"
    response = owner(base).post("/api/owner/performances", {"title": title, "startsLocal": start, "tiers": tiers})
    assert response.status_code == 201, response.text
    return response.json()["performance"]


def hold(b: Client, pid: str, *seat_ids: str) -> httpx.Response:
    return b.post(f"/api/performances/{pid}/holds", {"seatIds": list(seat_ids)})


def must_hold(b: Client, pid: str, *seat_ids: str) -> dict:
    response = hold(b, pid, *seat_ids)
    assert response.status_code == 200, response.text
    return response.json()


def cart(b: Client, pid: str) -> dict:
    response = b.get(f"/api/performances/{pid}/cart")
    assert response.status_code == 200, response.text
    return response.json()


def checkout(b: Client, pid: str, key: str | None = "", name: str | None = None,
             email: str | None = None) -> httpx.Response:
    key = idempotency_key() if key == "" else key
    return b.post(f"/api/performances/{pid}/checkout",
                  {"name": b.name if name is None else name, "email": b.email if email is None else email}, key)


def buy(b: Client, pid: str, *seat_ids: str) -> dict:
    must_hold(b, pid, *seat_ids)
    response = checkout(b, pid)
    assert response.status_code == 201, response.text
    return response.json()["order"]


def seats(b: Client, pid: str) -> dict[str, dict]:
    response = b.get(f"/api/performances/{pid}/seats")
    assert response.status_code == 200, response.text
    return {s["id"]: s for s in response.json()["seats"]}


def performance(b: Client, pid: str) -> dict:
    response = b.get(f"/api/performances/{pid}")
    assert response.status_code == 200, response.text
    return response.json()


def remaining(b: Client, pid: str) -> dict[str, int]:
    return {t["id"]: t["remaining"] for t in performance(b, pid)["tiers"]}


def owner_tiers(base: str, pid: str) -> dict[str, dict]:
    response = owner(base).get("/api/owner/performances")
    assert response.status_code == 200, response.text
    found = next(p for p in response.json()["performances"] if p["id"] == pid)
    return {t["id"]: t for t in found["tiers"]}


def join(b: Client, pid: str, tid: str, name: str | None = None, email: str | None = None) -> httpx.Response:
    return b.post(f"/api/performances/{pid}/tiers/{tid}/waitlist",
                  {"name": b.name if name is None else name, "email": b.email if email is None else email})


def entry(b: Client, pid: str) -> dict:
    response = b.get("/api/waitlist")
    assert response.status_code == 200, response.text
    return next(e for e in response.json()["entries"] if e["performanceId"] == pid)


def order(b: Client, oid: str) -> dict:
    response = b.get(f"/api/orders/{oid}")
    assert response.status_code == 200, response.text
    return response.json()


def exchange(b: Client, ticket_id: str, new_seat: str, key: str | None = "") -> httpx.Response:
    return b.post(f"/api/tickets/{ticket_id}/exchange", {"newSeatId": new_seat},
                  idempotency_key() if key == "" else key)


def refund(b: Client, oid: str, ticket_ids: list[str], key: str | None = "") -> httpx.Response:
    return b.post(f"/api/orders/{oid}/refunds", {"ticketIds": ticket_ids},
                  idempotency_key() if key == "" else key)


def accept(b: Client, token: str, key: str | None = "") -> httpx.Response:
    return b.post(f"/api/offers/{token}/accept", {}, idempotency_key() if key == "" else key)


def ticket_for(order_body: dict, seat_id: str) -> dict:
    return next(t for t in order_body["tickets"] if t["seatId"] == seat_id)


def server_now(base: str) -> datetime:
    response = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
    return parsedate_to_datetime(response.headers["date"]).astimezone(timezone.utc)


def error_of(response: httpx.Response) -> str:
    return response.json().get("error")


def field_of(response: httpx.Response, field: str) -> str:
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"] == "validation", body
    return body["fields"][field]


def env_url(name: str) -> str:
    value = os.environ.get(name)
    assert value, f"{name} is not set for the verifier"
    return value.rstrip("/")


def kb_cents(amount: Any) -> int:
    return round(float(amount) * 100)


def kb_tx(payment: dict, kind: str) -> list[dict]:
    return [t for t in payment.get("transactions") or []
            if t.get("transactionType") == kind and t.get("status") == "SUCCESS"]


def kb_payments(killbill: Any, email: str) -> list[dict]:
    account = killbill.account_by_key(email.lower())
    return killbill.payments(account["accountId"]) if account else []


def kb_refunded(killbill: Any, email: str) -> int:
    return sum(kb_cents(t["amount"]) for p in kb_payments(killbill, email) for t in kb_tx(p, "REFUND"))


def inbox(mail: Any, email: str, subject: str | None = None) -> list[dict]:
    return [m for m in mail.messages()
            if email.lower() in {a.lower() for a in addresses(m.get("To"))}
            and (subject is None or m.get("Subject") == subject)]


def await_mail(mail: Any, email: str, subject: str, count: int = 1, seconds: float = MAIL_DEADLINE_S) -> list[dict]:
    poll(lambda: len(inbox(mail, email, subject)) >= count, seconds, f"{count} message(s) '{subject}' to {email}")
    found = inbox(mail, email, subject)
    assert len(found) == count, [m.get("Subject") for m in found]
    return found


def outbox_for(base: str, email: str) -> list[dict]:
    response = owner(base).get("/api/owner/outbox")
    assert response.status_code == 200, response.text
    return [m for m in response.json()["messages"] if email.lower() in str(m["to"]).lower()]


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@contextlib.contextmanager
def declining_killbill() -> Iterator[str]:

    class Handler(BaseHTTPRequestHandler):
        def answer(self) -> None:
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            body = json.dumps({"transactions": [{"transactionType": "PURCHASE", "status": DECLINE_STATUS}]}).encode()
            self.send_response(402)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        do_GET = do_POST = do_PUT = do_DELETE = answer

        def log_message(self, *args: Any) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.socket.shutdown(socket.SHUT_RDWR)
        server.server_close()


@contextlib.contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    root = Path(DEPLOYED_APP)
    serve = json.loads((root / "run.json").read_text())["serve"]
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base, **overrides}
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)

    def tail() -> str:
        log.flush()
        return Path(log.name).read_bytes()[-4000:].decode(errors="replace")

    def healthy() -> bool:
        assert proc.poll() is None, f"app copy exited with {proc.returncode}:\n{tail()}"
        try:
            return httpx.get(base + "/api/health", timeout=POLL_S * 8).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        try:
            poll(healthy, COPY_BOOT_S, "healthy app copy")
        except AssertionError as error:
            raise AssertionError(f"{error}\n{tail()}") from error
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        log.close()


@contextlib.contextmanager
def browse(browser: Browser, url: str, viewport: dict | None = None, reduced: bool = False) -> Iterator[Page]:
    with open_app(browser, url, reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size(viewport or DESKTOP)
        if (viewport or DESKTOP) != DESKTOP:
            page.reload()
        yield page


def map_url(base: str, pid: str, section: str = "ST", seat: str = "ST-A-15", tier_choice: str = "all") -> str:
    return f"{base}/p/{pid}?section={section}&seat={seat}&tier={tier_choice}"


def address(page: Page) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(page.url).query).items()}


def cell(page: Page, seat_id: str):
    return page.get_by_role("gridcell", name=re.compile("^" + re.escape(label(seat_id)) + ","))


WEDGE_ATTRS_JS = """() => { const w = document.querySelector('[data-sightline]'); if (!w) return null;
  return {seat: w.getAttribute('data-seat'), angle: w.getAttribute('data-angle'),
          distance: w.getAttribute('data-distance'), state: w.getAttribute('data-state')}; }"""


def wedge(page: Page) -> dict[str, Any]:
    return page.evaluate(WEDGE_ATTRS_JS) or {}


def status(page: Page):
    return page.get_by_role("status", name="Box office updates")


ZONE_ALIASES = {"Asia/Kolkata": {"Asia/Kolkata", "Asia/Calcutta"}}


def notice(page: Page):
    return page.get_by_role("region", name="Notice")


def cart_region(page: Page):
    return page.get_by_role("region", name="Cart")


def selected_line(page: Page):
    return page.get_by_text(re.compile(r"^\d+ selected$"))


def n_selected(n: int) -> str:
    return f"{n} selected"


def left_text(n: int) -> str:
    return f"{n} left"


def place_text(n: int) -> str:
    return f"Place {n}"


def ready(page: Page) -> None:
    grid = page.get_by_role("grid", name="Seat map")
    deadline = time.monotonic() + GRID_DEADLINE_S + READY_DEADLINE_S
    while time.monotonic() < deadline:
        if grid.is_visible() and str(wedge(page).get("seat") or "").strip():
            return
        advance(page, FRAME_MS)
    assert grid.is_visible(), "no seat map grid shown"
    assert str(wedge(page).get("seat") or "").strip(), "no Sightline wedge drawn"


WATCH_JS = """(region) => {
  window.__seatwiseAnnouncements = [];
  let last = region.textContent.trim();
  new MutationObserver(() => {
    const now = region.textContent.trim();
    if (now && now !== last) {
      const added = last && now.startsWith(last) ? now.slice(last.length).trim() : now;
      if (added) window.__seatwiseAnnouncements.push(added);
    }
    last = now;
  }).observe(region, {subtree: true, childList: true, characterData: true});
}"""


def watch(page: Page) -> None:
    status(page).evaluate(WATCH_JS)


def announced(page: Page) -> list[str]:
    return page.evaluate("() => window.__seatwiseAnnouncements || []")


def expect_announced(page: Page, copy: str, seconds: float = LIVE_DEADLINE_S) -> None:
    def check() -> None:
        assert copy in announced(page), f"{copy!r} not announced; got {announced(page)!r}"
    eventually(page, check, seconds)


def expect_announced_once(page: Page, copy: str, seconds: float = LIVE_DEADLINE_S) -> None:
    expect_announced(page, copy, seconds)
    observe_for(page, LIVE_UPDATE_S)
    assert announced(page).count(copy) == 1, announced(page)


def page_post(page: Page, base: str, path: str, body: Any, key: str | None = None):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Idempotency-Key"] = key
    return page.request.post(base + path, data=json.dumps(body), headers=headers)


def page_hold(page: Page, base: str, pid: str, *seat_ids: str) -> None:
    response = page_post(page, base, f"/api/performances/{pid}/holds", {"seatIds": list(seat_ids)})
    assert response.status == 200, response.text()


def page_buy(page: Page, base: str, pid: str, name: str, email: str, *seat_ids: str) -> dict:
    page_hold(page, base, pid, *seat_ids)
    response = page_post(page, base, f"/api/performances/{pid}/checkout", {"name": name, "email": email},
                         idempotency_key())
    assert response.status == 201, response.text()
    return response.json()["order"]


def page_cart(page: Page, base: str, pid: str) -> dict:
    response = page.request.get(f"{base}/api/performances/{pid}/cart")
    assert response.status == 200, response.text()
    return response.json()


def page_seats(page: Page, base: str, pid: str) -> dict[str, dict]:
    response = page.request.get(f"{base}/api/performances/{pid}/seats")
    return {s["id"]: s for s in response.json()["seats"]}


def tab_until_focused(page: Page, locator: Any) -> None:
    for _ in range(TAB_PRESSES):
        page.keyboard.press("Tab")
        if locator.evaluate("(el) => el === document.activeElement"):
            return
    raise AssertionError("Tab never reached the expected control")


def box(locator: Any) -> dict[str, float]:
    found = locator.bounding_box()
    assert found, "element has no box"
    return found


FRAME_JS = """(cart) => { const stage = document.querySelector('[data-stage]'); if (!stage) return null;
  const drawing = stage.ownerSVGElement || stage;
  const rect = (el) => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; };
  for (let el = drawing.parentElement; el && !el.contains(cart); el = el.parentElement) {
    const s = getComputedStyle(el);
    if (/(auto|scroll|hidden|clip)/.test(s.overflowX + ' ' + s.overflowY)) return rect(el);
  }
  return rect(drawing); }"""


def frame_box(page: Page) -> dict[str, float]:
    found = page.evaluate(FRAME_JS, cart_region(page).element_handle())
    assert found, "no stage band drawn"
    return found


def map_box(page: Page) -> dict[str, float]:
    found = page.evaluate(
        "() => { const el = document.querySelector('[data-stage]'); if (!el) return null;"
        " const r = (el.ownerSVGElement || el).getBoundingClientRect();"
        " return {x: r.x, y: r.y, width: r.width, height: r.height}; }")
    assert found, "no stage band drawn"
    return found


def sign_in_owner_ui(page: Page) -> None:
    fill(page.get_by_role("textbox", name="Passcode"), PASSCODE)
    click(page.get_by_role("button", name="Sign in"))
    expect(page.get_by_role("heading", name="Performances")).to_be_visible()


def pay_in_dialog(page: Page, name: str, email: str) -> None:
    dialog = page.get_by_role("dialog", name="Checkout")
    fill(dialog.get_by_role("textbox", name="Full name"), name)
    fill(dialog.get_by_role("textbox", name="Email"), email)
    click(dialog.get_by_role("button", name=re.compile(r"^Pay \$")))


def pointer_click_disabled(locator: Any) -> None:
    expect(locator).to_be_visible()
    locator.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    box = locator.bounding_box()
    assert box is not None
    locator.page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def confirmed_order_id(page: Page, container: Any) -> str:
    heading = container.get_by_role("heading", name="You're in")
    eventually(page, lambda: expect(heading).to_be_visible(timeout=EXPECT_STEP_MS), PAYMENT_DEADLINE_S)
    line = container.get_by_text(re.compile(r"^Order (?![Ff]ee$|[Rr]eceipt$|[Tt]otal$)\S+$")).first
    return line.inner_text().strip().split(" ", 1)[1]


def row_numbers(table: Any, tier_name: str) -> list[int]:
    row = table.get_by_role("row").filter(has_text=tier_name)
    values = [v.strip() for v in row.get_by_role("cell").all_inner_texts()]
    return [int(v) for v in values[-5:]]


GEOMETRY_JS = """() => {
  const wedge = document.querySelector('[data-sightline]');
  const stage = document.querySelector('[data-stage]');
  if (!wedge || !stage) return null;
  const screen = (el, p) => { const m = el.getScreenCTM(); return {x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f}; };
  const shape = (part) => { const el = wedge.querySelector(`[data-part="${part}"]`); if (!el) return null;
    return el instanceof SVGGeometryElement ? el : el.querySelector('line, path, polyline, polygon, rect'); };
  const outline = (el, n) => { const length = el.getTotalLength();
    return Array.from({length: n + 1}, (_, i) => screen(el, el.getPointAtLength(length * i / n))); };
  const s = stage.getBoundingClientRect();
  const parts = {};
  for (const part of ['left-edge', 'right-edge', 'fill']) { const el = shape(part); parts[part] = el ? outline(el, part === 'fill' ? 120 : 1) : null; }
  const fillEl = shape('fill');
  const fb = fillEl ? fillEl.getBoundingClientRect() : null;
  return {fillBox: fb ? {left: fb.left, right: fb.right, top: fb.top, bottom: fb.bottom} : null,
          seat: wedge.getAttribute('data-seat'), angle: wedge.getAttribute('data-angle'),
          distance: wedge.getAttribute('data-distance'), state: wedge.getAttribute('data-state'),
          left: {x: s.left, y: s.bottom}, right: {x: s.right, y: s.bottom}, parts};
}"""


def _near(p: dict, q: tuple[float, float]) -> bool:
    return math.dist((p["x"], p["y"]), q) <= GEOMETRY_PX


def check_wedge_at(page: Page, seat_id: str) -> None:
    g = page.evaluate(GEOMETRY_JS)
    assert g and g["seat"] == seat_id, g
    b = box(cell(page, seat_id))
    centre = (b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    lip_left = (g["left"]["x"], g["left"]["y"])
    lip_right = (g["right"]["x"], g["right"]["y"])
    for part, corner in (("left-edge", lip_left), ("right-edge", lip_right)):
        points = g["parts"][part]
        assert points, f"no {part}"
        start, end = points[0], points[-1]
        assert (_near(start, centre) and _near(end, corner)) or (_near(end, centre) and _near(start, corner)), (
            part, start, end, centre, corner)
    fill = g["fillBox"]
    assert fill, "no fill"
    corners = [centre, lip_left, lip_right]
    for low, high, i in (("left", "right", 0), ("top", "bottom", 1)):
        assert abs(fill[low] - min(c[i] for c in corners)) <= GEOMETRY_PX, (low, fill, corners)
        assert abs(fill[high] - max(c[i] for c in corners)) <= GEOMETRY_PX, (high, fill, corners)


def choose_tier_by_keys(page: Page, tier_name: str) -> None:
    page.get_by_role("radio", checked=True).focus()
    for _ in range(MAX_SEATS):
        if page.get_by_role("radio", name=tier_name).is_checked():
            break
        page.keyboard.press("ArrowDown")
        expect(page.get_by_role("radio", checked=True)).to_be_focused()
    expect(page.get_by_role("radio", name=tier_name)).to_be_checked()


def keyboard_hold(page: Page, seat_id: str) -> None:
    if not cell(page, seat_id).evaluate("(el) => el === document.activeElement"):
        tab_until_focused(page, cell(page, seat_id))
    page.keyboard.press("Space")
    expect(cell(page, seat_id)).to_have_attribute("aria-selected", "true")
    tab_until_focused(page, page.get_by_role("button", name="Hold selected seats"))
    page.keyboard.press("Enter")
    expect(cart_region(page)).to_contain_text(label(seat_id))


def phone_stack(page: Page) -> None:
    assert box(cart_region(page))["y"] >= frame_box(page)["y"] + frame_box(page)["height"] - GEOMETRY_PX
    layout(page)


def touch_targets(page: Page) -> None:
    for role in ("button", "link", "tab", "radio", "textbox", "checkbox", "combobox"):
        items = page.get_by_role(role)
        for i in range(items.count()):
            b = items.nth(i).bounding_box()
            if b is None or b["width"] <= 2 or b["height"] <= 2:
                continue
            assert b["width"] >= TOUCH_PX - 1 and b["height"] >= TOUCH_PX - 1, (role, i, b)


def buyer_of(page: Page, base: str) -> "Client":
    return Client(base, {c["name"]: c["value"] for c in page.context.cookies() if c["name"] == "seatwise_buyer"})


def limit_race(base: str, cookies: dict[str, str], pid: str, first: list[str], second: list[str]) -> list[httpx.Response]:
    out: list[httpx.Response | None] = [None, None]
    barrier = threading.Barrier(2)

    def go(i: int, ids: list[str]) -> None:
        barrier.wait()
        out[i] = hold(Client(base, cookies), pid, *ids)

    threads = [threading.Thread(target=go, args=(0, first)), threading.Thread(target=go, args=(1, second))]
    [t.start() for t in threads]
    [t.join() for t in threads]
    return [r for r in out if r is not None]


def click(locator: Any) -> None:
    eventually(locator.page, lambda: center(locator))
    kit_click(locator)


click_settled = click


def settled_wedge(page: Page, seat_id: str) -> None:

    def check() -> None:
        g = page.evaluate(GEOMETRY_JS)
        assert g and g["seat"], g
        if g["seat"] != seat_id:
            assert cell(page, g["seat"]).evaluate("e => e.matches(':hover') || !!e.querySelector(':hover')"), g["seat"]
        check_wedge_at(page, g["seat"])

    eventually(page, check)


def in_background(call: Callable[[], httpx.Response]) -> tuple[threading.Thread, dict]:
    out: dict = {}
    worker = threading.Thread(target=lambda: out.update(response=call()))
    worker.start()
    return worker, out


def order_where(b: Client, status: str) -> dict:
    return poll(lambda: next((o for o in b.get("/api/orders").json()["orders"] if o["status"] == status), None),
                PENDING_SEEN_S, f"an order {status}")


@contextlib.contextmanager
def gated_killbill(decline: bool = False) -> Iterator[tuple[str, threading.Event]]:
    upstream = os.environ["KILLBILL_URL"].rstrip("/")
    gate = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def relay(self) -> None:
            size = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(size) if size else b""
            if self.command == "POST" and "/payments" in self.path.split("?", 1)[0]:
                gate.wait(SLOW_PROVIDER_S)
                if decline:
                    out = json.dumps({"transactions": [{"transactionType": "PURCHASE", "status": DECLINE_STATUS}]}).encode()
                    self.send_response(402)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(out)))
                    self.end_headers()
                    self.wfile.write(out)
                    return
            skip = {"host", "content-length", "connection", "accept-encoding", "transfer-encoding"}
            headers = {k: v for k, v in self.headers.items() if k.lower() not in skip}
            answer = httpx.request(self.command, upstream + self.path, content=body or None, headers=headers,
                                   timeout=HTTP_TIMEOUT_S)
            self.send_response(answer.status_code)
            for k, v in answer.headers.items():
                if k.lower() not in {"content-length", "transfer-encoding", "connection", "content-encoding"}:
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(answer.content)))
            self.end_headers()
            self.wfile.write(answer.content)

        do_GET = do_POST = do_PUT = do_DELETE = relay

        def log_message(self, *args: Any) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", gate
    finally:
        gate.set()
        server.shutdown()
        server.socket.shutdown(socket.SHUT_RDWR)
        server.server_close()


def rail_stays_in_view(page: Page) -> None:
    page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
    rail = box(cart_region(page))
    assert rail["y"] >= -GEOMETRY_PX and rail["y"] < DESKTOP["height"], rail


def readout_angle(page: Page) -> int:
    found = re.search(r"([-−+]?\d+)° off centre", page.get_by_role("group", name="Sightline").inner_text())
    assert found, page.get_by_role("group", name="Sightline").inner_text()
    return int(found.group(1).replace("−", "-").replace("+", ""))


def check_readout(page: Page, seat: dict) -> None:
    group = page.get_by_role("group", name="Sightline")
    deg = seat["offCentreDeg"]
    sign = r"[-−]" if deg < 0 else r"(?<![-−\d])\+?"
    expect(group).to_contain_text(re.compile(sign + str(abs(deg)) + "° off centre"), timeout=EXPECT_STEP_MS)
    expect(group).to_contain_text(re.compile(r"(?<![\d.])" + re.escape(f"{seat['stageDistanceM']:.1f}") + " m to stage"),
                                  timeout=EXPECT_STEP_MS)


def check_wedge_attributes(page: Page, seat: dict, state: str) -> None:
    w = wedge(page)
    assert w.get("seat") == seat["id"], w
    assert w.get("angle") == str(seat["offCentreDeg"]), w
    assert w.get("distance") == f"{seat['stageDistanceM']:.1f}", w
    assert w.get("state") == state, w


MOTION_JS = """(state) => {
  const now = performance.now();
  state = state || {t0: now, log: {}, sig: {}};
  const wedge = document.querySelector('[data-sightline]');
  if (!wedge) return state;
  const partOf = (el) => {
    if (!el || !wedge.contains(el)) return null;
    const p = el.closest('[data-part]');
    return p && wedge.contains(p) ? p.getAttribute('data-part') : 'wedge';
  };
  const record = (part, start, end) => { (state.log[part] = state.log[part] || []).push([start - state.t0, end - state.t0]); };
  for (const a of document.getAnimations()) {
    if (a.__seatwiseSeen) continue;
    const part = partOf(a.effect && a.effect.target);
    if (!part) continue;
    a.__seatwiseSeen = true;
    const t = a.effect.getComputedTiming();
    const elapsed = Number(a.currentTime || 0);
    const end = Number.isFinite(t.endTime) ? t.endTime : 1e9;
    record(part, now + (t.delay || 0) - elapsed, now + end - elapsed);
    try { a.finish(); } catch (e) {}
  }
  const look = (el) => {
    const cs = getComputedStyle(el);
    const geo = el instanceof SVGGeometryElement ? el : el.querySelector('line, path, polyline, polygon');
    const gs = geo ? getComputedStyle(geo) : null;
    return JSON.stringify([cs.opacity, cs.strokeDashoffset, cs.strokeDasharray, cs.transform, cs.visibility, cs.clipPath,
      geo ? ['d', 'points', 'x1', 'y1', 'x2', 'y2', 'transform', 'opacity', 'stroke-dashoffset'].map((n) => geo.getAttribute(n)) : null,
      gs ? [gs.strokeDashoffset, gs.opacity, gs.transform] : null]);
  };
  const targets = [['wedge', wedge]];
  for (const part of ['left-edge', 'right-edge', 'fill']) { const el = wedge.querySelector(`[data-part="${part}"]`); if (el) targets.push([part, el]); }
  for (const [part, el] of targets) {
    const sig = look(el);
    if (state.sig[part] !== undefined && state.sig[part] !== sig) record(part, now, now);
    state.sig[part] = sig;
  }
  return state;
}"""


def motion_log(page: Page, total_ms: int, state: dict | None = None) -> dict:
    state = page.evaluate(MOTION_JS, state)
    elapsed = 0
    while elapsed < total_ms:
        page.clock.run_for(STEP_MS)
        elapsed += STEP_MS
        state = page.evaluate(MOTION_JS, state)
    return state


def long_motions(state: dict, before: dict | None = None) -> list[tuple[str, float, float]]:
    seen = {part: len(v) for part, v in ((before or {}).get("log") or {}).items()}
    return [(part, s, e) for part, v in state["log"].items() for s, e in v[seen.get(part, 0):] if e - s > FRAME_MS]


def spans(state: dict) -> dict[str, tuple[float, float]]:
    return {part: (min(s for s, _ in v), max(e for _, e in v)) for part, v in state["log"].items() if v}


def test_wf_browse_programme_listing(browser: Browser, app_url: str) -> None:
    early = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"])], start=EARLIER_START)
    later = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"]), tier(B_RESERVE, B_FACE, rows=["CI-A"])])
    with browse(browser, app_url + "/") as page:
        expect(page.get_by_role("heading", name="Programme")).to_be_visible()
        first = page.get_by_role("article", name=early["title"])
        second = page.get_by_role("article", name=later["title"])
        expect(first).to_contain_text(venue_label(instant(early["startsAt"])))
        expect(second).to_contain_text(FUTURE_LABEL)
        for copy in (FRONT_PAIR, money(FRONT_FACE), left_text(1), B_RESERVE, money(B_FACE), f"{SEATS_PER_ROW} left"):
            expect(second).to_contain_text(copy)
        expect(first).to_contain_text(f"{SEATS_PER_ROW} left")
        assert box(first)["y"] < box(second)["y"], "performances are not in start order"
        click(page.get_by_role("link", name=f"Choose seats for {later['title']}"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(rf"/p/{re.escape(later['id'])}\?"), timeout=EXPECT_STEP_MS))
        ready(page)
        assert urlsplit(page.url).path == f"/p/{later['id']}"
        assert address(page) == {"section": "ST", "seat": "ST-A-15", "tier": "all"}
    with browse(browser, app_url + "/", viewport=PHONE) as phone:
        expect(phone.get_by_role("article", name=later["title"])).to_contain_text(left_text(1))
        layout(phone)
        touch_targets(phone)
    listing = Client(app_url).get("/api/performances").json()["performances"]
    ids = [p["id"] for p in listing]
    assert ids.index(early["id"]) < ids.index(later["id"])


def test_wf_browse_programme_sold_out(browser: Browser, app_url: str) -> None:
    perf = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15", "ST-A-16"])])
    pid = perf["id"]
    rival = Client(app_url)
    with browse(browser, app_url + "/") as page:
        article = page.get_by_role("article", name=perf["title"])
        expect(article).to_contain_text(left_text(2))
        must_hold(rival, pid, "ST-A-15")
        eventually(page, lambda: expect(article).to_contain_text(left_text(1), timeout=EXPECT_STEP_MS))
        must_hold(rival, pid, "ST-A-16")
        eventually(page, lambda: expect(article).to_contain_text("Sold out", timeout=EXPECT_STEP_MS))
        assert remaining(rival, pid)["front-pair"] == 0
        assert rival.delete(f"/api/performances/{pid}/holds/ST-A-16").status_code == 200
        eventually(page, lambda: expect(article).to_contain_text(left_text(1), timeout=EXPECT_STEP_MS))
        expect(article).not_to_contain_text("Sold out")
        with gated_killbill(decline=True) as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
            d = Client(slow)
            must_hold(d, pid, "ST-A-16")
            eventually(page, lambda: expect(article).to_contain_text("Sold out", timeout=EXPECT_STEP_MS))
            worker, out = in_background(lambda: checkout(same_fan(slow, d), pid))
            order_where(d, "pending_payment")
            expect(article).to_contain_text("Sold out")
            gate.set()
            worker.join()
            assert out["response"].status_code == 402, out["response"].text
            eventually(page, lambda: expect(article).to_contain_text(left_text(1), timeout=EXPECT_STEP_MS))
        click(article.get_by_role("link", name="Choose seats"))
        ready(page)
        page.mouse.move(0, 0)
        touch_targets(page)
        choose_tier_by_keys(page, FRONT_PAIR)
        tab_until_focused(page, cell(page, "ST-A-15"))
        page.keyboard.press("ArrowRight")
        expect(cell(page, "ST-A-16")).to_be_focused()
        settled_wedge(page, "ST-A-16")
        rail_stays_in_view(page)
        keyboard_hold(page, "ST-A-16")
        assert remaining(rival, pid)["front-pair"] == 0
    states = seats(Client(app_url), pid)
    assert remaining(rival, pid)["front-pair"] == sum(1 for s in states.values() if s["tierId"] == "front-pair" and s["state"] == "on_sale")


def test_venue_labels_any_time_zone(browser: Browser, app_url: str) -> None:
    listing = {p["id"]: p for p in Client(app_url).get("/api/performances").json()["performances"]}
    for pid, title, starts_at, label_text in SEED:
        assert listing[pid]["title"] == title
        assert listing[pid]["startsAt"] == starts_at
        assert listing[pid]["startsAtVenue"] == label_text
    with browse(browser, app_url + "/") as page:
        for zone in ("Pacific/Auckland", "Asia/Kolkata"):
            session(page).send("Emulation.setTimezoneOverride", {"timezoneId": zone})
            page.goto(app_url + "/")
            assert page.evaluate("() => Intl.DateTimeFormat().resolvedOptions().timeZone") in ZONE_ALIASES.get(zone, {zone})
            for _, title, _, label_text in SEED:
                expect(page.get_by_role("article", name=title)).to_contain_text(label_text)
            page.goto(map_url(app_url, "marrow-quartet-late-set"))
            expect(page.get_by_role("heading", level=1)).to_have_text(SEED[3][1])
            expect(page.get_by_text(LATE_LABEL).first).to_be_visible()


def test_publish_resolves_fall_back_night(app_url: str) -> None:
    seeded = performance(Client(app_url), "marrow-quartet-late-set")
    assert seeded["startsAt"] == LATE_UTC and seeded["startsAtVenue"] == LATE_LABEL
    late = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"])], start=LATE_START)
    assert late["startsAt"] == LATE_UTC
    assert late["startsAtVenue"] == LATE_LABEL
    title = f"Seatwise {unique('gap')[0]}"
    response = owner(app_url).post("/api/owner/performances", {
        "title": title, "startsLocal": SPRING_GAP_START, "tiers": [tier(A_RESERVE, A_FACE, rows=["ST-A"])]})
    assert field_of(response, "startsLocal") == NO_SUCH_TIME_MSG
    titles = [p["title"] for p in Client(app_url).get("/api/performances").json()["performances"]]
    assert title not in titles


def test_wf_pick_seats_keyboard_hold(browser: Browser, app_url: str) -> None:
    perf = publish(app_url, standard_layout())
    pid = perf["id"]
    rival = Client(app_url)
    must_hold(rival, pid, "ST-A-14")
    with browse(browser, app_url + "/") as page:
        click(page.get_by_role("link", name=f"Choose seats for {perf['title']}"))
        ready(page)
        watch(page)
        expect(page.get_by_role("heading", level=1)).to_have_text(perf["title"])
        expect(page.get_by_text(FUTURE_LABEL).first).to_be_visible()
        expect(page.get_by_role("tablist", name="Sections")).to_be_visible()
        expect(page.get_by_role("radiogroup", name="Price tier")).to_be_visible()
        stage = map_box(page)
        assert stage["width"] > 0 and stage["height"] > 0, stage
        expect(page.get_by_role("group", name="Sightline")).to_be_visible()
        expect(notice(page)).to_be_attached()
        expect(cart_region(page).get_by_role("heading", name="Cart")).to_be_visible()
        expect(cart_region(page)).to_contain_text("No seats held.")
        expect(cell(page, "ST-A-14")).to_have_accessible_name(f"{label('ST-A-14')}, {A_RESERVE}, {money(A_FACE)}, Taken")
        expect(cell(page, "ST-A-16")).to_have_accessible_name(f"{label('ST-A-16')}, {A_RESERVE}, {money(A_FACE)}, On sale")
        tab_until_focused(page, cell(page, "ST-A-15"))
        page.keyboard.press("ArrowRight")
        expect(cell(page, "ST-A-16")).to_be_focused()
        page.keyboard.press("PageDown")
        expect(page.get_by_role("tab", name="Circle")).to_have_attribute("aria-selected", "true")
        expect(cell(page, "CI-A-15")).to_be_focused()
        page.get_by_role("radio", checked=True).focus()
        for _ in range(MAX_SEATS):
            if page.get_by_role("radio", name=B_RESERVE).is_checked():
                break
            page.keyboard.press("ArrowDown")
        expect(page.get_by_role("radio", name=B_RESERVE)).to_be_checked()
        tab_until_focused(page, cell(page, "CI-A-15"))
        expect(page.get_by_role("group", name="Sightline")).to_contain_text("m to stage")
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        expect(page.get_by_text(n_selected(2))).to_be_visible()
        hold_button = page.get_by_role("button", name="Hold selected seats")
        tab_until_focused(page, hold_button)
        page.keyboard.press("Enter")
        held_copy = f"Held {labels('CI-A-15', 'CI-A-16')}."
        expect_announced_once(page, held_copy)
        region = cart_region(page)
        for seat_id in ("CI-A-15", "CI-A-16"):
            expect(region.get_by_role("button", name=f"Release {label(seat_id)}")).to_be_visible()
        for copy in ("Face value", "Seat fees", "Order fee", "Total", money(TWO_B_TOTAL), money(ORDER_FEE), money(seat_fee(B_FACE))):
            expect(region).to_contain_text(copy)
        expect(page.get_by_role("timer", name="Hold time left")).to_have_text(re.compile(r"^\d+:\d\d$"))
        expect(page.get_by_role("button", name="Checkout")).to_be_visible()
        api_cart = page_cart(page, app_url, pid)
        assert [line["seatId"] for line in api_cart["seats"]] == ["CI-A-15", "CI-A-16"]
        assert api_cart["totalCents"] == TWO_B_TOTAL
    assert seats(rival, pid)["CI-A-15"]["state"] == "held"


def test_wf_pick_seats_phone_touch(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with browse(browser, map_url(app_url, pid), viewport=PHONE) as page:
        ready(page)
        watch(page)
        tap(cell(page, "ST-A-3"))
        tap(cell(page, "ST-A-4"))
        expect(page.get_by_text(n_selected(2))).to_be_visible()
        tap(page.get_by_role("button", name="Hold selected seats"))
        expect_announced_once(page, f"Held {labels('ST-A-3', 'ST-A-4')}.")
        assert box(cart_region(page))["y"] >= frame_box(page)["y"] + frame_box(page)["height"] - GEOMETRY_PX
        layout(page)
        assert [line["seatId"] for line in page_cart(page, app_url, pid)["seats"]] == ["ST-A-3", "ST-A-4"]


def test_seat_map_keyboard_grid(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    must_hold(Client(app_url), pid, "ST-A-14")
    with browse(browser, map_url(app_url, pid)) as page:
        ready(page)
        assert page.get_by_role("gridcell").evaluate_all("(cells) => cells.filter((c) => c.tabIndex === 0).length") == 1
        names = tab_order(page, TAB_PRESSES)
        hits = [i for i, n in enumerate(names) if n.startswith(label("ST-A-15") + ",")]
        assert hits and hits[0] + 1 < len(names), names
        assert not re.match(r"^(Stalls|Circle|Balcony) row ", names[hits[0] + 1]), names

        def at(seat_id: str) -> None:
            expect(cell(page, seat_id)).to_be_focused()

        cell(page, "ST-A-15").focus()
        steps = [("ArrowLeft", "ST-A-14"), ("Space", "ST-A-14")]
        for key, seat_id in steps:
            page.keyboard.press(key)
            at(seat_id)
        expect(cell(page, "ST-A-14")).not_to_have_attribute("aria-selected", "true")
        page.keyboard.press("ArrowRight")
        at("ST-A-15")
        page.keyboard.press("Space")
        expect(cell(page, "ST-A-15")).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Enter")
        expect(cell(page, "ST-A-15")).not_to_have_attribute("aria-selected", "true")
        page.keyboard.press("Enter")
        expect(cell(page, "ST-A-15")).to_have_attribute("aria-selected", "true")
        for key, seat_id in [("Home", "ST-A-1"), ("ArrowLeft", "ST-A-1"), ("End", "ST-A-30"), ("ArrowRight", "ST-A-30"),
                             ("ArrowUp", "ST-A-30"), ("ArrowDown", "ST-B-30"), ("ArrowUp", "ST-A-30"),
                             ("Control+End", "ST-P-30"), ("ArrowDown", "ST-P-30"), ("Control+Home", "ST-A-1"),
                             ("PageUp", "ST-A-1")]:
            page.keyboard.press(key)
            at(seat_id)
        expect(page.get_by_role("tab", name="Stalls")).to_have_attribute("aria-selected", "true")
        page.keyboard.press("PageDown")
        expect(page.get_by_role("tab", name="Circle")).to_have_attribute("aria-selected", "true")
        at("CI-A-15")
        page.keyboard.press("PageDown")
        expect(page.get_by_role("tab", name="Balcony")).to_have_attribute("aria-selected", "true")
        at("BA-A-15")
        page.keyboard.press("PageDown")
        expect(page.get_by_role("tab", name="Balcony")).to_have_attribute("aria-selected", "true")
        at("BA-A-15")
        page.keyboard.press("PageUp")
        at("CI-A-15")
        expect(page.get_by_text(n_selected(1))).to_be_visible()
        assert page.get_by_role("gridcell").evaluate_all("(cells) => cells.filter((c) => c.tabIndex === 0).length") == 1


def test_price_tier_radio_group(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    seat_tiers = {"ST-A-15": A_RESERVE, "ST-C-15": B_RESERVE}
    with browse(browser, map_url(app_url, pid)) as page:
        ready(page)
        for seat_id in seat_tiers:
            click(cell(page, seat_id))
        expect(page.get_by_text(n_selected(2))).to_be_visible()
        all_tiers = page.get_by_role("radio", name="All tiers")
        expect(all_tiers).to_be_checked()
        all_tiers.focus()
        page.keyboard.press("ArrowDown")
        expect(all_tiers).not_to_be_checked()
        expect(page.get_by_role("radio", checked=True)).to_be_focused()
        chosen = next(n for n in (A_RESERVE, B_RESERVE, C_RESERVE) if page.get_by_role("radio", name=n).is_checked())
        kept = [s for s, n in seat_tiers.items() if n == chosen]
        expect(page.get_by_text(n_selected(len(kept)))).to_be_visible()
        for seat_id, name in seat_tiers.items():
            if name == chosen:
                expect(cell(page, seat_id)).to_have_attribute("aria-selected", "true")
            else:
                expect(cell(page, seat_id)).to_have_attribute("aria-disabled", "true")
                expect(cell(page, seat_id)).not_to_have_attribute("aria-selected", "true")
        for _ in range(MAX_SEATS):
            if page.get_by_role("radio", name=B_RESERVE).is_checked():
                break
            page.keyboard.press("ArrowDown")
            expect(page.get_by_role("radio", checked=True)).to_be_focused()
        expect(page.get_by_role("radio", name=B_RESERVE)).to_be_checked()
        expect(cell(page, "ST-A-15")).to_have_attribute("aria-disabled", "true")
        expect(cell(page, "ST-A-15")).not_to_have_attribute("aria-selected", "true")
        click(cell(page, "ST-C-16"))
        expect(cell(page, "ST-C-16")).to_have_attribute("aria-selected", "true")
        pointer_click_disabled(cell(page, "ST-A-16"))
        expect(cell(page, "ST-A-16")).not_to_have_attribute("aria-selected", "true")
        expect(cell(page, "ST-A-16")).to_have_attribute("aria-disabled", "true")
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"tier=b-reserve"), timeout=EXPECT_STEP_MS))


def test_address_keeps_place(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with browse(browser, map_url(app_url, pid, "CI", "CI-A-12", "b-reserve")) as page:
        ready(page)

        def place(p: Page, seat_id: str) -> None:
            expect(p.get_by_role("tab", name="Circle")).to_have_attribute("aria-selected", "true")
            expect(p.get_by_role("radio", name=B_RESERVE)).to_be_checked()

            def drawn() -> None:
                assert wedge(p).get("seat") == seat_id, wedge(p)

            eventually(p, drawn)

        place(page, "CI-A-12")
        before = page.evaluate("() => history.length")
        cell(page, "CI-A-12").focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"seat=CI-A-13"), timeout=EXPECT_STEP_MS))
        assert address(page) == {"section": "CI", "seat": "CI-A-13", "tier": "b-reserve"}
        assert page.evaluate("() => history.length") == before
        page.keyboard.press("Space")
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        release = f"Release {label('CI-A-13')}"
        expect(cart_region(page).get_by_role("button", name=release)).to_be_visible()
        page.mouse.move(0, 0)
        page.reload()
        ready(page)
        place(page, "CI-A-13")
        expect(cart_region(page).get_by_role("button", name=release)).to_be_visible()
        second = page.context.new_page()
        second.goto(page.url)
        ready(second)
        place(second, "CI-A-13")
        expect(cart_region(second).get_by_role("button", name=release)).to_be_visible()
        click(page.get_by_role("navigation", name="Box office").get_by_role("link", name="My tickets"))
        expect(page.get_by_role("heading", name="My tickets")).to_be_visible()
        page.go_back()
        ready(page)
        place(page, "CI-A-13")
        assert address(page) == {"section": "CI", "seat": "CI-A-13", "tier": "b-reserve"}


def test_sightline_wedge_geometry(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    viewer = Client(app_url)
    api = seats(viewer, pid)
    with browse(browser, map_url(app_url, pid), reduced=True) as page:
        ready(page)
        for viewport in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(viewport)
            cell(page, "ST-A-15").focus()
            for key, seat_id in (("Home", "ST-A-1"), ("End", "ST-A-30"), ("ArrowDown", "ST-B-30")):
                page.keyboard.press(key)
                eventually(page, lambda s=seat_id: (check_wedge_attributes(page, api[s], "on_sale"), check_wedge_at(page, s)))
            page.keyboard.press("ArrowUp")
        cell(page, "ST-B-7").hover()
        eventually(page, lambda: (check_wedge_attributes(page, api["ST-B-7"], "on_sale"), check_wedge_at(page, "ST-B-7")))
        page.mouse.move(1, 1)
        eventually(page, lambda: check_wedge_at(page, "ST-A-30"))


def test_sightline_readout_matches_seat_api(browser: Browser, app_url: str) -> None:
    viewer = Client(app_url)
    pid = publish(app_url, standard_layout())["id"]
    api = seats(viewer, pid)
    seed = seats(viewer, "lantern-and-tide")
    assert len(api) == TOTAL_SEATS
    for seat_id, seat in api.items():
        assert seat["offCentreDeg"] == seed[seat_id]["offCentreDeg"]
        assert seat["stageDistanceM"] == seed[seat_id]["stageDistanceM"]
        deg, dist = seat["offCentreDeg"], seat["stageDistanceM"]
        assert isinstance(deg, int) and -ANGLE_LIMIT <= deg <= ANGLE_LIMIT
        assert (deg <= 0) if seat["number"] <= CENTRE_SEAT else (deg >= 0), seat
        assert DIST_MIN <= dist <= DIST_MAX and round(dist, 1) == dist, seat
    for section, rows in ROW_COUNT.items():
        letters = [chr(ord("A") + i) for i in range(rows)]
        for row in letters:
            left = [abs(api[f"{section}-{row}-{n}"]["offCentreDeg"]) for n in range(CENTRE_SEAT, 0, -1)]
            right = [abs(api[f"{section}-{row}-{n}"]["offCentreDeg"]) for n in range(CENTRE_SEAT + 1, SEATS_PER_ROW + 1)]
            assert left == sorted(left) and right == sorted(right), (section, row)
        for near, far in zip(letters, letters[1:]):
            for n in range(1, SEATS_PER_ROW + 1):
                assert api[f"{section}-{far}-{n}"]["stageDistanceM"] > api[f"{section}-{near}-{n}"]["stageDistanceM"]
    by_section = {s: [x["stageDistanceM"] for x in api.values() if x["section"] == s] for s in SECTION_ORDER}
    assert min(by_section["CI"]) > max(by_section["ST"]) and min(by_section["BA"]) > max(by_section["CI"])
    with browse(browser, map_url(app_url, pid), reduced=True) as page:
        ready(page)
        cell(page, "ST-A-15").focus()
        for key, seat_id in (("Home", "ST-A-1"), ("End", "ST-A-30"), ("ArrowDown", "ST-B-30"), ("PageDown", "CI-A-15")):
            page.keyboard.press(key)
            eventually(page, lambda s=seat_id: (check_wedge_attributes(page, api[s], "on_sale"), check_readout(page, api[s])))


def test_sightline_wedge_states(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"]), tier(FRONT_PAIR, FRONT_FACE, seats=["ST-B-15"])])
    pid = pid["id"]
    rival, rival2 = Client(app_url), Client(app_url)
    must_hold(rival, pid, "ST-A-7")
    must_hold(rival2, pid, "ST-B-15")
    name, email = unique("viewer")
    with browse(browser, app_url + "/", reduced=True) as page:
        page_buy(page, app_url, pid, name, email, "ST-A-5")
        page_hold(page, app_url, pid, "ST-A-6")
        joined = page_post(page, app_url, f"/api/performances/{pid}/tiers/front-pair/waitlist", {"name": name, "email": email})
        assert joined.status == 201, joined.text()
        assert rival2.delete(f"/api/performances/{pid}/holds/ST-B-15").status_code == 200
        api = page_seats(page, app_url, pid)
        cases = [
            ("ST-A-9", "on_sale", "On sale", None),
            ("ST-A-6", "held_by_you", "Held by you", "Held by you"),
            ("ST-A-5", "yours", "Your ticket", "Your ticket"),
            ("ST-B-15", "offered_to_you", "Offered to you", "Offered to you"),
            ("ST-A-7", "taken", "Taken", "Taken"),
        ]
        for seat_id, state, word, line in cases:
            page.goto(map_url(app_url, pid, seat=seat_id))
            ready(page)
            tier_name = FRONT_PAIR if seat_id == "ST-B-15" else A_RESERVE
            face = FRONT_FACE if seat_id == "ST-B-15" else A_FACE
            expect(cell(page, seat_id)).to_have_accessible_name(f"{label(seat_id)}, {tier_name}, {money(face)}, {word}")
            eventually(page, lambda s=seat_id, st=state: check_wedge_attributes(page, api[s], st))
            if line:
                expect(page.get_by_role("group", name="Sightline")).to_contain_text(line)
                expect(cell(page, seat_id)).to_have_attribute("aria-disabled", "true")
            else:
                expect(page.get_by_role("group", name="Sightline")).not_to_contain_text("Taken")
        page.goto(map_url(app_url, pid, seat="ST-C-1"))
        ready(page)
        expect(cell(page, "ST-C-1")).to_have_accessible_name(f"{label('ST-C-1')}, Not on sale")
        expect(cell(page, "ST-C-1")).to_have_attribute("aria-disabled", "true")
        eventually(page, lambda: check_wedge_attributes(page, api["ST-C-1"], "not_on_sale"))
        expect(page.get_by_role("group", name="Sightline")).to_contain_text("Not on sale")
        page.goto(map_url(app_url, pid, seat="ST-A-9"))
        ready(page)
        cell(page, "ST-A-9").focus()
        page.keyboard.press("Space")
        expect(cell(page, "ST-A-9")).to_have_accessible_name(f"{label('ST-A-9')}, {A_RESERVE}, {money(A_FACE)}, Selected")
        expect(cell(page, "ST-A-9")).to_have_attribute("aria-selected", "true")
        eventually(page, lambda: check_wedge_attributes(page, api["ST-A-9"], "selected"))


APPEAR_JS = """(() => {
  window.__wedgeLog = [];
  const partOf = (el) => {
    const w = el && el.closest && el.closest('[data-sightline]');
    if (!w) return null;
    const p = el.closest('[data-part]');
    return p && w.contains(p) ? p.getAttribute('data-part') : 'wedge';
  };
  const note = (a, el) => {
    const part = partOf(el);
    if (!part || !a || a.__wedgeSeen || !a.effect) return;
    a.__wedgeSeen = true;
    const t = a.effect.getComputedTiming();
    const now = Number(document.timeline.currentTime || 0);
    const elapsed = Number(a.currentTime || 0);
    const end = Number.isFinite(t.endTime) ? t.endTime : 1e9;
    window.__wedgeLog.push({part, start: now + (t.delay || 0) - elapsed, end: now + end - elapsed});
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); note(a, this); return a; };
  for (const type of ['transitionrun', 'animationstart']) {
    document.addEventListener(type, (e) => { for (const a of e.target.getAnimations()) note(a, e.target); }, true);
  }
})();"""
WEDGE_PARTS = ("left-edge", "right-edge", "fill")


def css_spans(entries: list[dict]) -> dict[str, tuple[float, float]]:
    if not entries:
        return {}
    t0 = min(e["start"] for e in entries)
    out: dict[str, tuple[float, float]] = {}
    for e in entries:
        s, f = out.get(e["part"], (math.inf, -math.inf))
        out[e["part"]] = (min(s, e["start"] - t0), max(f, e["end"] - t0))
    return out


def wedge_log(page: Page) -> list[dict]:
    return page.evaluate("() => window.__wedgeLog || []")


def test_sightline_motion_sequence(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    api = seats(Client(app_url), pid)
    with browse(browser, app_url + "/") as page:
        page.add_init_script(APPEAR_JS)
        page.goto(map_url(app_url, pid))
        expect(page.get_by_role("grid", name="Seat map")).to_be_visible()
        clocked = spans(motion_log(page, SETTLE_MS))
        logged = css_spans(wedge_log(page))
        appear = logged if all(p in logged for p in WEDGE_PARTS) else clocked
        ready(page)
        for part in WEDGE_PARTS:
            assert part in appear, f"{part} did not animate: {appear}"
        assert appear["left-edge"][0] <= appear["right-edge"][0] + 1 <= appear["fill"][0] + 2, appear
        assert appear["left-edge"][1] <= appear["right-edge"][1] + 1 <= appear["fill"][1] + 2, appear
        assert max(end for _, end in appear.values()) <= WEDGE_TOTAL_MS + STEP_MS, appear
        assert max(end for _, end in appear.values()) > FRAME_MS, "the wedge appeared instantly"
        check_wedge_at(page, "ST-A-15")
        old = api["ST-A-15"]["offCentreDeg"]
        new = api["ST-A-1"]["offCentreDeg"]
        cell(page, "ST-A-15").focus()
        before = len(wedge_log(page))
        page.keyboard.press("Home")
        attrs = wedge(page)
        assert attrs.get("angle") == str(new), attrs
        assert attrs.get("distance") == f"{api['ST-A-1']['stageDistanceM']:.1f}", attrs
        state = page.evaluate(MOTION_JS, None)
        page.clock.run_for(STEP_MS)
        midway = readout_angle(page)
        assert min(old, new) <= midway <= max(old, new) and midway != new, (old, midway, new)
        glide_clock = spans(motion_log(page, SETTLE_MS, state))
        glide = css_spans(wedge_log(page)[before:]) or glide_clock
        assert glide, "moving to another seat produced no motion"
        assert max(end for _, end in glide.values()) <= WEDGE_TOTAL_MS + STEP_MS, glide
        check_wedge_at(page, "ST-A-1")
        check_readout(page, api["ST-A-1"])


def test_reduced_motion_wedge(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    api = seats(Client(app_url), pid)
    with browse(browser, map_url(app_url, pid), reduced=True) as page:
        ready(page)
        watch(page)
        page.clock.run_for(FRAME_MS)
        first = page.evaluate(MOTION_JS, None)
        assert not long_motions(first), first["log"]
        check_wedge_at(page, "ST-A-15")
        check_readout(page, api["ST-A-15"])
        cell(page, "ST-A-15").focus()
        page.keyboard.press("Home")
        page.clock.run_for(FRAME_MS)
        moved = page.evaluate(MOTION_JS, first)
        assert not long_motions(moved, first), moved["log"]
        check_wedge_at(page, "ST-A-1")
        check_readout(page, api["ST-A-1"])
        page.keyboard.press("Space")
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        expect_announced(page, f"Held {label('ST-A-1')}.")
        click(page.get_by_role("button", name="Checkout"))
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog).to_be_visible()
        running = dialog.evaluate(
            "(d) => document.getAnimations().filter((a) => { const t = a.effect && a.effect.target;"
            " const timing = a.effect && a.effect.getComputedTiming();"
            " return t && (d.contains(t) || t.contains(d)) && timing && timing.activeDuration > " + str(FRAME_MS) + "; }).length")
        assert running == 0, "the dialog fades under reduced motion"


def test_published_breakpoints(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with browse(browser, map_url(app_url, pid), viewport=PHONE) as page:
        page_hold(page, app_url, pid, "ST-A-1", "ST-A-2")
        page.reload()
        ready(page)
        layout(page)
        order = [page.get_by_role("heading", level=1), page.get_by_role("tablist", name="Sections"),
                 page.get_by_role("radiogroup", name="Price tier")]
        tops = [box(x)["y"] for x in order] + [map_box(page)["y"], box(page.get_by_role("group", name="Sightline"))["y"],
                                                box(selected_line(page))["y"], box(cart_region(page))["y"]]
        assert tops == sorted(tops), tops
        frame = frame_box(page)
        assert box(cart_region(page))["y"] >= frame["y"] + frame["height"] - GEOMETRY_PX

        page.set_viewport_size(TABLET)
        page.reload()
        ready(page)
        layout(page)
        width = page.evaluate("() => document.documentElement.clientWidth")
        sheet = box(cart_region(page))
        assert abs(sheet["y"] + sheet["height"] - TABLET["height"]) <= GEOMETRY_PX, sheet
        assert sheet["x"] <= GEOMETRY_PX and sheet["width"] >= width - GEOMETRY_PX, sheet
        assert sheet["height"] <= TABLET["height"] * SHEET_MAX_FRACTION + 1, sheet
        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        sheet = box(cart_region(page))
        assert abs(sheet["y"] + sheet["height"] - TABLET["height"]) <= GEOMETRY_PX, sheet
        line = box(selected_line(page))
        assert line["y"] + line["height"] <= sheet["y"] + GEOMETRY_PX, (line, sheet)

        page.set_viewport_size(DESKTOP)
        page.reload()
        ready(page)
        page.evaluate("() => window.scrollTo(0, 0)")
        layout(page)
        rail = box(cart_region(page))
        left_column = max(box(page.get_by_role("group", name="Sightline"))["x"] + box(page.get_by_role("group", name="Sightline"))["width"],
                          box(selected_line(page))["x"] + box(selected_line(page))["width"])
        assert rail["x"] >= left_column - GEOMETRY_PX, (rail, left_column)
        assert RAIL_MIN_PX <= rail["width"] <= RAIL_MAX_PX, rail
        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        rail = box(cart_region(page))
        assert rail["y"] >= -GEOMETRY_PX and rail["y"] < DESKTOP["height"], rail


def test_phone_touch_targets_and_panning(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    sizes = "(cells) => cells.map((c) => { const r = c.getBoundingClientRect(); return Math.min(r.width, r.height); })"
    with browse(browser, map_url(app_url, pid), viewport=PHONE) as page:
        ready(page)
        assert min(page.get_by_role("gridcell").evaluate_all(sizes)) >= TOUCH_PX
        cell(page, "ST-A-15").focus()
        page.keyboard.press("End")
        expect(cell(page, "ST-A-30")).to_be_focused()
        eventually(page, lambda: expect(cell(page, "ST-A-30")).to_be_in_viewport(timeout=EXPECT_STEP_MS))
        far = box(cell(page, "ST-A-30"))
        assert far["x"] >= 0 and far["x"] + far["width"] <= PHONE["width"], far
        assert page.evaluate("() => window.scrollX") == 0
        layout(page)
        tap(cell(page, "ST-A-30"))
        expect(cell(page, "ST-A-30")).to_have_attribute("aria-selected", "true")
        for viewport in (TABLET, DESKTOP):
            page.set_viewport_size(viewport)
            assert min(page.get_by_role("gridcell").evaluate_all(sizes)) >= SEAT_MIN_PX


def test_hold_seats_api(app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    b, c, viewer = Client(app_url), Client(app_url), Client(app_url)
    first = must_hold(b, pid, "ST-A-1", "ST-A-2")
    assert first["held"] == ["ST-A-1", "ST-A-2"] and first["taken"] == []
    body = first["cart"]
    assert body["performanceId"] == pid
    assert [line["seatId"] for line in body["seats"]] == ["ST-A-1", "ST-A-2"]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body["expiresAt"])
    assert isinstance(body["secondsLeft"], int) and body["secondsLeft"] > 0
    expires = body["expiresAt"]
    second = must_hold(b, pid, "ST-A-2", "ST-A-3")
    assert second["held"] == ["ST-A-3"] and second["taken"] == []
    assert second["cart"]["expiresAt"] == expires
    must_hold(b, pid, *[f"ST-A-{n}" for n in range(4, 9)])
    assert len(cart(b, pid)["seats"]) == MAX_SEATS
    assert field_of(hold(b, pid, "ST-A-9"), "seatIds") == LIMIT_MSG
    nine = [f"ST-B-{n}" for n in range(1, MAX_SEATS + 2)]
    assert field_of(hold(c, pid, *nine), "seatIds") in (SEATS_MSG, LIMIT_MSG)
    for bad in ([], ["ST-B-20", "ST-B-20"], ["ST-Z-99"], ["BA-F-30"]):
        assert field_of(hold(c, pid, *bad), "seatIds") == SEATS_MSG
    states = seats(viewer, pid)
    assert all(states[s]["state"] == "on_sale" for s in nine + ["ST-B-20", "ST-A-9"])
    eight = must_hold(c, pid, *[f"ST-B-{n}" for n in range(1, MAX_SEATS + 1)])
    assert len(eight["held"]) == MAX_SEATS
    mine = seats(b, pid)["ST-A-1"]
    assert mine["state"] == "held" and mine["mine"] is True
    assert seats(viewer, pid)["ST-A-1"]["mine"] is False
    empty = cart(viewer, pid)
    assert empty["seats"] == [] and empty["totalCents"] == 0
    assert empty["expiresAt"] is None and empty["secondsLeft"] is None
    assert remaining(viewer, pid)["a-reserve"] == 2 * SEATS_PER_ROW - 2 * MAX_SEATS


def test_one_winner_per_seat(app_url: str) -> None:
    copies = [app_url, env_url("APP_KILLBILL_DOWN_URL"), env_url("APP_MAIL_DOWN_URL")]
    pid = publish(app_url, standard_layout())["id"]
    for round_number, contested in enumerate(("ST-A-15", "ST-A-16", "ST-A-17")):
        buyers = [Client(copies[i % len(copies)]) for i in range(MAX_SEATS)]
        barrier = threading.Barrier(len(buyers))
        results: list[httpx.Response | None] = [None] * len(buyers)

        def attempt(i: int) -> None:
            own = f"ST-B-{round_number * MAX_SEATS + i + 1}"
            seat_ids = [contested, own] if i % 2 else [contested]
            barrier.wait()
            results[i] = hold(buyers[i], pid, *seat_ids)

        threads = [threading.Thread(target=attempt, args=(i,)) for i in range(len(buyers))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        winners = [r for r in results if r.status_code == 200 and contested in r.json()["held"]]
        assert len(winners) == 1, [r.text for r in results]
        for i, r in enumerate(results):
            if r in winners:
                continue
            if i % 2:
                assert r.status_code == 200, r.text
                assert r.json()["taken"] == [contested] and contested not in r.json()["held"]
            else:
                assert r.status_code == 409, r.text
                assert r.json()["error"] == "seats_taken" and r.json()["taken"] == [contested]
        assert seats(Client(app_url), pid)[contested]["state"] == "held"
        assert sum(1 for b in buyers if contested in [x["seatId"] for x in cart(b, pid)["seats"]]) == 1


def test_release_held_seat(app_url: str, mail: Any) -> None:
    front = f"ST-B-{CENTRE_SEAT}"
    pid = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"]), tier(FRONT_PAIR, FRONT_FACE, seats=[front])])["id"]
    b, other, waiting = Client(app_url), Client(app_url), Client(app_url)
    must_hold(b, pid, "ST-A-1", "ST-A-2")
    assert remaining(other, pid)["a-reserve"] == SEATS_PER_ROW - 2
    released = b.delete(f"/api/performances/{pid}/holds/ST-A-2")
    assert released.status_code == 200, released.text
    body = released.json()["cart"]
    assert [line["seatId"] for line in body["seats"]] == ["ST-A-1"]
    assert body["faceCents"] == A_FACE and body["seatFeesCents"] == seat_fee(A_FACE)
    assert body["orderFeeCents"] == ORDER_FEE and body["totalCents"] == A_FACE + seat_fee(A_FACE) + ORDER_FEE
    assert seats(other, pid)["ST-A-2"]["state"] == "on_sale"
    assert remaining(other, pid)["a-reserve"] == SEATS_PER_ROW - 1
    assert b.delete(f"/api/performances/{pid}/holds/ST-A-2").status_code == 404
    assert other.delete(f"/api/performances/{pid}/holds/ST-A-1").status_code == 404
    assert seats(other, pid)["ST-A-1"]["state"] == "held"
    must_hold(b, pid, front)
    assert join(waiting, pid, "front-pair").status_code == 201
    assert b.delete(f"/api/performances/{pid}/holds/{front}").status_code == 200
    assert seats(other, pid)[front]["state"] == "offered"
    got = entry(waiting, pid)
    assert got["status"] == "offered" and got["offer"]["seatId"] == front
    assert remaining(other, pid)["front-pair"] == 0
    last = b.delete(f"/api/performances/{pid}/holds/ST-A-1").json()["cart"]
    assert last["seats"] == [] and last["totalCents"] == 0 and last["expiresAt"] is None


def test_wf_hold_seats_last_seat_contest(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15", "ST-A-16"])])["id"]
    contested, other = "ST-A-15", "ST-A-16"
    with browse(browser, map_url(app_url, pid)) as a, browse(browser, map_url(app_url, pid), viewport=PHONE) as b:
        ready(a)
        ready(b)
        phone_stack(b)
        click(cell(a, contested))
        settled_wedge(a, contested)
        click(cell(b, contested))
        click(cell(b, other))
        with held(a, HOLDS_GLOB) as gate_a, held(b, HOLDS_GLOB) as gate_b:
            click_settled(a.get_by_role("button", name="Hold selected seats"))
            click_settled(b.get_by_role("button", name="Hold selected seats"))
            expect(a.get_by_role("button", name="Holding seats")).to_be_disabled()
            gate_a.release()
            gate_b.release()
        poll(lambda: all(seats(Client(app_url), pid)[s]["state"] == "held" for s in (contested, other)),
             LIVE_DEADLINE_S, "both holds committed")
        a_seats = [x["seatId"] for x in page_cart(a, app_url, pid)["seats"]]
        b_seats = [x["seatId"] for x in page_cart(b, app_url, pid)["seats"]]
        if contested in a_seats:
            loser, winner = b, a
            assert b_seats == [other]
            copy = f"Held {label(other)}. Taken by another buyer: {label(contested)}."
        else:
            loser, winner = a, b
            assert a_seats == [] and b_seats == [contested, other]
            copy = f"Taken by another buyer: {label(contested)}."
        eventually(loser, lambda: expect(status(loser)).to_contain_text(copy, timeout=EXPECT_STEP_MS))
        expect(notice(loser)).to_have_text(SEAT_TAKEN_NOTICE)
        eventually(loser, lambda: expect(cell(loser, contested)).to_have_accessible_name(re.compile(r", Taken$"), timeout=EXPECT_STEP_MS))
        eventually(winner, lambda: expect(cell(winner, contested)).to_have_accessible_name(re.compile(r", Held by you$"), timeout=EXPECT_STEP_MS))
    assert seats(Client(app_url), pid)[contested]["state"] == "held"
    paying = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"])])["id"]
    with gated_killbill() as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
        f = Client(slow)
        must_hold(f, paying, "ST-A-15")
        worker, out = in_background(lambda: checkout(same_fan(slow, f), paying))
        order_where(f, "pending_payment")
        rival = hold(Client(app_url), paying, "ST-A-15")
        assert rival.status_code == 409 and error_of(rival) == "seats_taken", rival.text
        assert seats(Client(app_url), paying)["ST-A-15"]["state"] == "held"
        gate.set()
        worker.join()
        assert out["response"].status_code == 201, out["response"].text
    assert seats(Client(app_url), paying)["ST-A-15"]["state"] == "sold"


def test_wf_hold_seats_wrong_device_clock(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with browse(browser, app_url + "/") as page:
        page.clock.set_system_time(SKEWED_DEVICE_TIME)
        page.goto(map_url(app_url, pid))
        ready(page)
        choose_tier_by_keys(page, A_RESERVE)
        click(cell(page, "ST-A-1"))
        settled_wedge(page, "ST-A-1")
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        timer = page.get_by_role("timer", name="Hold time left")
        expect(timer).to_have_text(re.compile(r"^\d+:\d\d$"))
        server_left = page_cart(page, app_url, pid)["secondsLeft"]
        assert abs(mss(timer.inner_text()) - server_left) <= COUNTDOWN_SLACK_S
        expect(cart_region(page).get_by_role("button", name=f"Release {label('ST-A-1')}")).to_be_visible()
        assert seats(Client(app_url), pid)["ST-A-1"]["state"] == "held"
        raced = limit_race(app_url, buyer_of(page, app_url).cookies, pid, ["ST-A-2", "ST-A-3", "ST-A-4", "ST-A-5"],
                           ["ST-A-6", "ST-A-7", "ST-A-8", "ST-A-9"])
        assert sorted(r.status_code for r in raced) == [200, 422], [r.text for r in raced]
        assert field_of(next(r for r in raced if r.status_code == 422), "seatIds") == LIMIT_MSG


def test_wf_hold_seats_release_ui(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with browse(browser, map_url(app_url, pid)) as page:
        ready(page)
        click(cell(page, "ST-A-1"))
        click(cell(page, "ST-A-2"))
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        region = cart_region(page)
        expect(region).to_contain_text(money(2 * (A_FACE + seat_fee(A_FACE)) + ORDER_FEE))
        watch(page)
        click(region.get_by_role("button", name=f"Release {label('ST-A-2')}"))
        expect_announced_once(page, f"Released {label('ST-A-2')}.")
        expect(region).to_contain_text(money(A_FACE + seat_fee(A_FACE) + ORDER_FEE))
        expect(region.get_by_role("button", name=f"Release {label('ST-A-2')}")).to_have_count(0)
    assert seats(Client(app_url), pid)["ST-A-2"]["state"] == "on_sale"


def test_cart_in_whole_cents(browser: Browser, app_url: str) -> None:
    faces = {A_RESERVE: FACE_MIN, B_RESERVE: B_FACE, C_RESERVE: C_FACE, FRONT_PAIR: FRONT_FACE, STALLS: FACE_MAX}
    layout_tiers = [tier(name, face, seats=[f"ST-A-{i + 1}"]) for i, (name, face) in enumerate(faces.items())]
    pid = publish(app_url, layout_tiers)["id"]
    with browse(browser, map_url(app_url, pid)) as page:
        page_hold(page, app_url, pid, *[f"ST-A-{i + 1}" for i in range(len(faces))])
        body = page_cart(page, app_url, pid)
        for line, (name, face) in zip(body["seats"], faces.items()):
            assert line["tierName"] == name and line["faceCents"] == face
            assert line["seatFeeCents"] == seat_fee(face)
        assert body["faceCents"] == sum(faces.values())
        assert body["seatFeesCents"] == sum(seat_fee(f) for f in faces.values())
        assert body["orderFeeCents"] == ORDER_FEE
        total = body["faceCents"] + body["seatFeesCents"] + ORDER_FEE
        assert body["totalCents"] == total
        page.reload()
        ready(page)
        region = cart_region(page)
        for face in faces.values():
            expect(region).to_contain_text(money(face))
            expect(region).to_contain_text(money(seat_fee(face)))
        expect(region).to_contain_text(money(total))
        click(page.get_by_role("button", name="Checkout"))
        expect(page.get_by_role("dialog", name="Checkout").get_by_role("button", name=f"Pay {money(total)}")).to_be_visible()


def test_checkout_dialog_keyboard(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("keys")
    with browse(browser, map_url(app_url, pid)) as page:
        page_hold(page, app_url, pid, "ST-A-1")
        page.reload()
        ready(page)
        opener = page.get_by_role("button", name="Checkout")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog.get_by_role("textbox", name="Full name")).to_be_focused()
        inside = "(d) => d.contains(document.activeElement)"
        for key in ["Tab"] * MAX_SEATS * 2 + ["Shift+Tab"] * MAX_SEATS * 2:
            page.keyboard.press(key)
            assert dialog.evaluate(inside), f"focus left the dialog after {key}"
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        eventually(page, lambda: expect(opener).to_be_focused(timeout=EXPECT_STEP_MS))
        click(opener)
        fill(dialog.get_by_role("textbox", name="Email"), "not-an-email")
        dialog.get_by_role("textbox", name="Email").press("Enter")
        expect(dialog.get_by_role("heading", name="Check these details")).to_be_visible()
        click(dialog.get_by_role("link", name=NAME_MSG))
        expect(dialog.get_by_role("textbox", name="Full name")).to_be_focused()
        click(dialog.get_by_role("link", name=EMAIL_MSG))
        expect(dialog.get_by_role("textbox", name="Email")).to_be_focused()
        fill(dialog.get_by_role("textbox", name="Full name"), name)
        fill(dialog.get_by_role("textbox", name="Email"), email)
        with held(page, CHECKOUT_GLOB) as gate:
            click(dialog.get_by_role("button", name=re.compile(r"^Pay \$")))
            expect(dialog.get_by_role("button", name="Confirming payment")).to_be_disabled()
            page.keyboard.press("Escape")
            expect(dialog).to_be_visible()
            gate.release()
        confirmed_order_id(page, dialog)
        click(dialog.get_by_role("button", name="Close"))
        eventually(page, lambda: expect(page.get_by_role("heading", name="Cart")).to_be_focused(timeout=EXPECT_STEP_MS))


def test_checkout_idempotent_replay(app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    other_pid = publish(app_url, standard_layout())["id"]
    b = Client(app_url)
    must_hold(b, pid, "ST-A-1")
    for bad in (None, "x" * (KEY_MAX + 1), "has space"):
        assert field_of(checkout(b, pid, key=bad), "idempotencyKey") == KEY_MSG
    key = idempotency_key()
    first = checkout(b, pid, key=key)
    assert first.status_code == 201, first.text
    again = checkout(b, pid, key=key)
    assert again.status_code == 201 and again.json() == first.json()
    assert error_of(checkout(b, pid, key=key, name=b.name + " Jr")) == "idempotency_conflict"
    must_hold(b, other_pid, "ST-A-1")
    conflict = checkout(b, other_pid, key=key)
    assert conflict.status_code == 409 and error_of(conflict) == "idempotency_conflict"
    shared = idempotency_key()
    results: list[httpx.Response | None] = [None, None]
    barrier = threading.Barrier(2)

    def go(i: int) -> None:
        barrier.wait()
        results[i] = checkout(same_fan(app_url, b), other_pid, key=shared)

    threads = [threading.Thread(target=go, args=(i,)) for i in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert all(r.status_code == 201 for r in results), [r.text for r in results]
    assert results[0].json() == results[1].json()
    first_id, second_id = first.json()["order"]["id"], results[0].json()["order"]["id"]
    assert first_id != second_id
    keys = sorted(p["paymentExternalKey"] for p in kb_payments(killbill, b.email))
    assert keys == sorted([first_id, second_id])
    assert len(b.get("/api/orders").json()["orders"]) == 2


def test_issue_only_on_confirmed_payment(app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    b = Client(app_url)
    local, _, domain = b.email.partition("@")
    mixed = local.upper() + "@" + domain
    must_hold(b, pid, "ST-A-1", "CI-A-1")
    response = checkout(b, pid, email=mixed)
    assert response.status_code == 201, response.text
    body = response.json()["order"]
    total = A_FACE + seat_fee(A_FACE) + B_FACE + seat_fee(B_FACE) + ORDER_FEE
    assert body["status"] == "paid" and body["totalCents"] == total and body["netPaidCents"] == total
    assert all(t["status"] == "issued" for t in body["tickets"]) and len(body["tickets"]) == 2
    assert body["receipt"] in ("queued", "sent")
    account = killbill.account_by_key(mixed.lower())
    assert account and account["currency"] == "USD" and account["name"] == b.name
    assert killbill.default_plugin(account["accountId"])
    payment = killbill.payment_by_key(body["id"])
    purchases = kb_tx(payment, "PURCHASE")
    assert len(purchases) == 1 and kb_cents(purchases[0]["amount"]) == total
    assert purchases[0]["transactionExternalKey"] == f"{body['id']}-purchase"
    state = seats(b, pid)
    assert state["ST-A-1"]["state"] == "sold" and state["ST-A-1"]["mine"] is True


def test_confirmation_outlives_hold_timer(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("late")
    with browse(browser, map_url(app_url, pid), viewport=PHONE) as page:
        page_hold(page, app_url, pid, "ST-A-1")
        left = page_cart(page, app_url, pid)["secondsLeft"]
        page.reload()
        ready(page)
        watch(page)
        click(page.get_by_role("button", name="Checkout"))
        pay_in_dialog(page, name, email)
        dialog = page.get_by_role("dialog", name="Checkout")
        oid = confirmed_order_id(page, dialog)
        expect_announced(page, PAID)
        frame = box(dialog)
        assert frame["x"] <= GEOMETRY_PX and frame["y"] <= GEOMETRY_PX, frame
        assert frame["width"] >= PHONE["width"] - GEOMETRY_PX and frame["height"] >= PHONE["height"] - GEOMETRY_PX, frame
        touch_targets(page)
        receipt = dialog.get_by_role("region", name="Receipt").inner_text()
        advance(page, (left + COUNTDOWN_SLACK_S) * 1000)
        observe_for(page, LIVE_UPDATE_S)
        expect(dialog.get_by_role("heading", name="You're in")).to_be_visible()
        expect(dialog.get_by_text(f"Order {oid}", exact=True).first).to_be_visible()
        assert dialog.get_by_role("region", name="Receipt").inner_text() == receipt
        assert announced(page) == [PAID]
        expect(page.get_by_role("region", name="Notice", include_hidden=True)).not_to_have_text(HOLD_ENDED)


def test_declined_payment_releases_seats(browser: Browser, app_url: str, mail: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with declining_killbill() as kb_url, app_copy({"KILLBILL_URL": kb_url}) as base:
        b = Client(base)
        must_hold(b, pid, "CI-A-1", "CI-A-2")
        key = idempotency_key()
        r = checkout(b, pid, key=key)
        assert r.status_code == 402 and error_of(r) == "payment_declined"
        again = checkout(b, pid, key=key)
        assert again.status_code == 402 and again.json() == r.json()
        viewer = Client(app_url)
        state = seats(viewer, pid)
        assert state["CI-A-1"]["state"] == "on_sale" and state["CI-A-2"]["state"] == "on_sale"
        assert cart(b, pid)["seats"] == []
        assert b.get("/api/orders").json()["orders"] == []
        mine = [o for o in owner(app_url).get("/api/owner/orders").json()["orders"] if o["email"] == b.email]
        assert len(mine) == 1 and mine[0]["status"] == "cancelled" and mine[0]["receipt"] is None
        assert not any(t["status"] == "issued" for t in mine[0]["tickets"])
        name, email = unique("declined")
        with browse(browser, map_url(base, pid, "CI", "CI-A-3")) as page:
            ready(page)
            click(cell(page, "CI-A-3"))
            click_settled(page.get_by_role("button", name="Hold selected seats"))
            click(page.get_by_role("button", name="Checkout"))
            watch(page)
            pay_in_dialog(page, name, email)
            dialog = page.get_by_role("dialog", name="Checkout")
            expect(dialog.get_by_role("region", name="Payment notice")).to_have_text(DECLINED)
            expect_announced_once(page, DECLINED)
        assert seats(viewer, pid)["CI-A-3"]["state"] == "on_sale"
        assert inbox(mail, b.email) == [] and inbox(mail, email) == []


def test_wf_checkout_pay_keyboard(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("payer")
    with browse(browser, map_url(app_url, pid, "CI", "CI-A-1")) as page:
        ready(page)
        choose_tier_by_keys(page, B_RESERVE)
        settled_wedge(page, "CI-A-1")
        cell(page, "CI-A-1").focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        page.get_by_role("button", name="Hold selected seats").focus()
        page.keyboard.press("Enter")
        checkout_button = page.get_by_role("button", name="Checkout")
        expect(checkout_button).to_be_visible()
        watch(page)
        checkout_button.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog.get_by_role("textbox", name="Full name")).to_be_focused()
        expect(dialog.get_by_role("timer", name="Hold time left")).to_be_visible()
        touch_targets(page)
        page.keyboard.type(name)
        dialog.get_by_role("textbox", name="Email").focus()
        page.keyboard.type(email)
        page.keyboard.press("Enter")
        oid = confirmed_order_id(page, dialog)
        receipt = dialog.get_by_role("region", name="Receipt")
        for copy in (money(2 * B_FACE), money(2 * seat_fee(B_FACE)), money(ORDER_FEE), money(TWO_B_TOTAL)):
            expect(receipt).to_contain_text(copy)
        expect(dialog.get_by_text(f"A receipt is on its way to {email}.")).to_be_visible()
        expect_announced_once(page, PAID)
        click(dialog.get_by_role("button", name="View my tickets"))
        article = page.get_by_role("article", name=f"Order {oid}")
        expect(article).to_contain_text("Issued")
        cookies = buyer_of(page, app_url).cookies
    raced = limit_race(app_url, cookies, pid, ["ST-A-1", "ST-A-2", "ST-A-3", "ST-A-4"], ["ST-A-5", "ST-A-6", "ST-A-7", "ST-A-8"])
    assert sorted(r.status_code for r in raced) == [200, 422], [r.text for r in raced]
    assert field_of(next(r for r in raced if r.status_code == 422), "seatIds") == LIMIT_MSG
    same = Client(app_url, cookies)
    assert len(same.get(f"/api/performances/{pid}/cart").json()["seats"]) == 4
    assert hold(same, pid, "ST-B-1", "ST-B-2").status_code == 200
    assert field_of(hold(same, pid, "ST-B-3"), "seatIds") == LIMIT_MSG
    payment = killbill.payment_by_key(oid)
    assert [kb_cents(t["amount"]) for t in kb_tx(payment, "PURCHASE")] == [TWO_B_TOTAL]
    await_mail(mail, email, f"Your Halyard Hall tickets: order {oid}")
    slow_name, slow_email = unique("slowpay")
    local, _, domain = slow_email.partition("@")
    mixed = local.upper() + "@" + domain
    with gated_killbill() as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
        with browse(browser, slow + "/tickets") as tickets:
            expect(tickets.get_by_role("heading", name="My tickets")).to_be_visible()
            expect(tickets.get_by_text("No tickets yet.")).to_be_visible()
            buyer = buyer_of(tickets, slow)
            assert buyer.cookies.get("seatwise_buyer"), buyer.cookies
            must_hold(buyer, pid, "BA-A-1")
            worker, out = in_background(lambda: checkout(same_fan(slow, buyer), pid, name=slow_name, email=mixed))
            pending = order_where(buyer, "pending_payment")
            assert [t["status"] for t in pending["tickets"]] == ["payment_pending"]
            assert pending["receipt"] is None
            article = tickets.get_by_role("article", name=f"Order {pending['id']}")
            eventually(tickets, lambda: expect(article).to_contain_text("Payment pending", timeout=EXPECT_STEP_MS))
            assert seats(Client(app_url), pid)["BA-A-1"]["state"] == "held"
            gate.set()
            worker.join()
            assert out["response"].status_code == 201, out["response"].text
            eventually(tickets, lambda: expect(article).to_contain_text("Issued", timeout=EXPECT_STEP_MS))
    assert seats(Client(app_url), pid)["BA-A-1"]["state"] == "sold"
    account = killbill.account_by_key(mixed.lower())
    assert account and account["name"] == slow_name and account["currency"] == "USD", account


def test_wf_checkout_fix_field_errors(browser: Browser, app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("fixer")
    with browse(browser, map_url(app_url, pid)) as page:
        page_hold(page, app_url, pid, "ST-A-2")
        page.reload()
        ready(page)
        watch(page)
        click(page.get_by_role("button", name="Checkout"))
        dialog = page.get_by_role("dialog", name="Checkout")
        fill(dialog.get_by_role("textbox", name="Email"), "nobody")
        click(dialog.get_by_role("button", name=re.compile(r"^Pay \$")))
        expect(dialog.get_by_role("link", name=NAME_MSG)).to_be_visible()
        expect(dialog.get_by_role("link", name=EMAIL_MSG)).to_be_visible()
        expect_announced(page, CHECK_DETAILS)
        assert killbill.account_by_key(email.lower()) is None
        pay_in_dialog(page, name, email)
        oid = confirmed_order_id(page, dialog)
    assert [p["paymentExternalKey"] for p in kb_payments(killbill, email)] == [oid]


def test_checkout_payments_unavailable(app_url: str, killbill: Any, mail: Any) -> None:
    down = env_url("APP_KILLBILL_DOWN_URL")
    pid = publish(app_url, standard_layout())["id"]
    b = Client(down)
    before = must_hold(b, pid, "ST-A-1")["cart"]["expiresAt"]
    key = idempotency_key()
    r = checkout(b, pid, key=key)
    assert r.status_code == 503 and r.json() == {"error": "payments_unavailable"}
    after = cart(b, pid)
    assert [x["seatId"] for x in after["seats"]] == ["ST-A-1"] and after["expiresAt"] == before
    assert checkout(b, pid, key=key).status_code == 503
    assert killbill.account_by_key(b.email.lower()) is None
    retried = checkout(same_fan(app_url, b), pid, key=key)
    assert retried.status_code == 201, retried.text
    assert inbox(mail, b.email, f"Your Halyard Hall tickets: order {retried.json()['order']['id']}") != [] or \
        await_mail(mail, b.email, f"Your Halyard Hall tickets: order {retried.json()['order']['id']}")


def test_no_oversell_payments_paused(app_url: str) -> None:
    down = env_url("APP_KILLBILL_DOWN_URL")
    pid = publish(app_url, standard_layout())["id"]
    viewer = Client(app_url)
    b = Client(down)
    must_hold(b, pid, "ST-A-1", "ST-A-2")
    left = remaining(viewer, pid)
    assert checkout(b, pid).status_code == 503
    assert remaining(viewer, pid) == left
    state = seats(viewer, pid)
    assert state["ST-A-1"]["state"] == "held" and state["ST-A-2"]["state"] == "held"
    assert owner_tiers(app_url, pid)["a-reserve"]["sold"] == 0
    assert b.get("/api/orders").json()["orders"] == []
    mine = [o for o in owner(app_url).get("/api/owner/orders").json()["orders"] if o["email"] == b.email]
    assert all(o["status"] == "cancelled" and not o["killbillPaymentIds"] for o in mine) and mine
    with declining_killbill() as kb_url, app_copy({"KILLBILL_URL": kb_url}) as base:
        d = Client(base)
        must_hold(d, pid, "ST-A-3")
        declined = checkout(d, pid)
        assert declined.status_code == 402 and error_of(declined) == "payment_declined"
    state = seats(viewer, pid)
    assert state["ST-A-3"]["state"] == "on_sale"
    assert state["ST-A-1"]["state"] == "held" and state["ST-A-2"]["state"] == "held"
    with gated_killbill() as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
        s = Client(slow)
        must_hold(s, pid, "ST-A-4")
        worker, out = in_background(lambda: checkout(same_fan(slow, s), pid))
        order_where(s, "pending_payment")
        assert seats(viewer, pid)["ST-A-4"]["state"] == "held"
        assert owner_tiers(app_url, pid)["a-reserve"]["sold"] == 0
        gate.set()
        worker.join()
        assert out["response"].status_code == 201, out["response"].text
    assert owner_tiers(app_url, pid)["a-reserve"]["sold"] == 1


def test_wf_payments_paused_banner(browser: Browser, app_url: str) -> None:
    down = env_url("APP_KILLBILL_DOWN_URL")
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("paused")
    with browse(browser, map_url(down, pid)) as page:
        ready(page)
        click(cell(page, "ST-A-3"))
        settled_wedge(page, "ST-A-3")
        rail_stays_in_view(page)
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        click(page.get_by_role("button", name="Checkout"))
        watch(page)
        pay_in_dialog(page, name, email)
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog.get_by_role("region", name="Payment notice")).to_have_text(PAUSED)
        expect_announced_once(page, PAUSED)
        assert [x["seatId"] for x in page_cart(page, down, pid)["seats"]] == ["ST-A-3"]
    assert seats(Client(app_url), pid)["ST-A-3"]["state"] == "held"


def test_wf_payments_paused_then_recovered(browser: Browser, app_url: str, killbill: Any) -> None:
    down = env_url("APP_KILLBILL_DOWN_URL")
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("retry")
    with browse(browser, map_url(down, pid)) as page:
        ready(page)
        click(cell(page, "ST-A-4"))
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        click(page.get_by_role("button", name="Checkout"))
        pay_in_dialog(page, name, email)
        expect(page.get_by_role("region", name="Payment notice")).to_have_text(PAUSED)
        buyer = next(c for c in page.context.cookies() if c["name"] == "seatwise_buyer")
        page.context.add_cookies([{"name": "seatwise_buyer", "value": buyer["value"], "url": app_url}])
        page.goto(map_url(app_url, pid))
        ready(page)
        click(page.get_by_role("button", name="Checkout"))
        pay_in_dialog(page, name, email)
        oid = confirmed_order_id(page, page.get_by_role("dialog", name="Checkout"))
    assert [p["paymentExternalKey"] for p in kb_payments(killbill, email)] == [oid]
    mine = [o for o in owner(app_url).get("/api/owner/orders").json()["orders"] if o["email"] == email]
    assert sorted(o["status"] for o in mine) == ["cancelled", "paid"]


def test_hold_expires_on_server(app_url: str) -> None:
    short = env_url("APP_SHORT_URL")
    pid = publish(short, [tier(A_RESERVE, A_FACE, rows=["ST-A"])])["id"]
    b, viewer = Client(short), Client(short)
    body = must_hold(b, pid, "ST-A-1", "ST-A-2")["cart"]
    assert 0 < body["secondsLeft"] <= SHORT_HOLD_S
    expires = instant(body["expiresAt"])

    def ended() -> bool:
        r = b.get(f"/api/performances/{pid}/cart")
        now = parsedate_to_datetime(r.headers["date"])
        if r.json()["seats"]:
            assert now <= expires, "hold still counted after its expiry instant"
            return False
        assert now >= expires - timedelta(seconds=1), "hold released before its expiry instant"
        return True

    poll(ended, SHORT_HOLD_S + EXPIRY_SLACK_S, "hold expiry")
    state = seats(viewer, pid)
    assert state["ST-A-1"]["state"] == "on_sale" and state["ST-A-2"]["state"] == "on_sale"
    assert remaining(viewer, pid)["a-reserve"] == SEATS_PER_ROW
    assert must_hold(viewer, pid, "ST-A-1")["held"] == ["ST-A-1"]


def test_countdown_follows_server(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with browse(browser, app_url + "/") as page:
        page.clock.set_system_time(SKEWED_DEVICE_TIME)
        page.goto(map_url(app_url, pid))
        ready(page)
        choose_tier_by_keys(page, A_RESERVE)
        click(cell(page, "ST-A-1"))
        settled_wedge(page, "ST-A-1")
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        timer = page.get_by_role("timer", name="Hold time left")
        expect(timer).to_have_text(re.compile(r"^\d+:\d\d$"))
        server_left = page_cart(page, app_url, pid)["secondsLeft"]
        shown = mss(timer.inner_text())
        assert abs(shown - server_left) <= COUNTDOWN_SLACK_S
        advance(page, 3000)
        ticked = mss(timer.inner_text())
        latest = page_cart(page, app_url, pid)["secondsLeft"]
        assert abs(ticked - (shown - 3)) <= 1 or abs(ticked - latest) <= COUNTDOWN_SLACK_S, (shown, ticked, latest)
        advance(page, (shown + COUNTDOWN_SLACK_S) * 1000)
        eventually(page, lambda: expect(timer).to_have_text(re.compile(r"^(?!0:00$)\d+:\d\d$"), timeout=EXPECT_STEP_MS))
        expect(cart_region(page).get_by_role("button", name=f"Release {label('ST-A-1')}")).to_be_visible()
        expect(notice(page)).not_to_have_text(HOLD_ENDED)
    assert seats(Client(app_url), pid)["ST-A-1"]["state"] == "held"


def test_hold_ended_notice(browser: Browser, app_url: str) -> None:
    short = env_url("APP_SHORT_URL")
    pid = publish(short, [tier(A_RESERVE, A_FACE, rows=["ST-A"])])["id"]
    with browse(browser, map_url(short, pid)) as page:
        second = page.context.new_page()
        second.goto(page.url)
        for p in (page, second):
            ready(p)
            watch(p)
        choose_tier_by_keys(page, A_RESERVE)
        click(cell(page, "ST-A-1"))
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        for p in (page, second):
            eventually(p, lambda q=p: expect(notice(q)).to_have_text(HOLD_ENDED, timeout=EXPECT_STEP_MS),
                       SHORT_HOLD_S + EXPIRY_SLACK_S)
            expect(cart_region(p)).to_contain_text("No seats held.")
        observe_for(page, LIVE_UPDATE_S)
        for p in (page, second):
            assert announced(p).count(HOLD_ENDED) == 1, announced(p)


def test_wf_hold_expiry_walk_away(browser: Browser, app_url: str) -> None:
    short = env_url("APP_SHORT_URL")
    pid = publish(short, [tier(A_RESERVE, A_FACE, rows=["ST-A"])])["id"]
    with browse(browser, map_url(short, pid)) as page, browse(browser, map_url(short, pid), viewport=PHONE) as other:
        ready(page)
        ready(other)
        phone_stack(other)
        click(cell(page, "ST-A-5"))
        settled_wedge(page, "ST-A-5")
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        eventually(other, lambda: expect(cell(other, "ST-A-5")).to_have_accessible_name(re.compile(r", Taken$"), timeout=EXPECT_STEP_MS))
        assert remaining(Client(short), pid)["a-reserve"] == SEATS_PER_ROW - 1
        eventually(page, lambda: expect(notice(page)).to_have_text(HOLD_ENDED, timeout=EXPECT_STEP_MS), SHORT_HOLD_S + EXPIRY_SLACK_S)
        eventually(other, lambda: expect(cell(other, "ST-A-5")).to_have_accessible_name(re.compile(r", On sale$"), timeout=EXPECT_STEP_MS))
    assert remaining(Client(short), pid)["a-reserve"] == SEATS_PER_ROW
    edge = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"])])["id"]
    with gated_killbill() as (kb, gate), app_copy({"KILLBILL_URL": kb, "HOLD_SECONDS": str(EDGE_HOLD_S)}) as slow:
        f = Client(slow)
        must_hold(f, edge, "ST-A-9")
        expires = time.monotonic() + EDGE_HOLD_S
        worker, out = in_background(lambda: checkout(same_fan(slow, f), edge))
        order_where(f, "pending_payment")
        poll(lambda: time.monotonic() > expires + EXPIRY_MARGIN_S, EDGE_HOLD_S + EXPIRY_MARGIN_S + 1, "the hold's expiry instant")
        assert seats(Client(app_url), edge)["ST-A-9"]["state"] == "held"
        assert remaining(Client(app_url), edge)["a-reserve"] == SEATS_PER_ROW - 1
        gate.set()
        worker.join()
        assert out["response"].status_code == 201, out["response"].text
    assert seats(Client(app_url), edge)["ST-A-9"]["state"] == "sold"


def test_wf_hold_expiry_to_waitlist(browser: Browser, app_url: str, mail: Any) -> None:
    short = env_url("APP_SHORT_URL")
    perf = publish(short, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"])])
    pid = perf["id"]
    waiting = Client(short)
    with browse(browser, map_url(short, pid)) as page:
        ready(page)
        click(cell(page, "ST-A-15"))
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        expect(page.get_by_role("timer", name="Hold time left")).to_be_visible()
        assert join(waiting, pid, "front-pair").status_code == 201
        eventually(page, lambda: expect(notice(page)).to_have_text(HOLD_ENDED, timeout=EXPECT_STEP_MS), SHORT_HOLD_S + EXPIRY_SLACK_S)
    poll(lambda: entry(waiting, pid)["status"] == "offered", OFFER_EMAIL_S + EXPIRY_SLACK_S, "offer to the waiting fan")
    assert seats(waiting, pid)["ST-A-15"]["state"] == "offered"
    await_mail(mail, waiting.email, f"A seat is offered to you: {perf['title']}", seconds=OFFER_EMAIL_S + MAIL_DEADLINE_S)


def test_taken_seats_change_in_place(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"]), tier(FRONT_PAIR, FRONT_FACE, seats=["ST-B-15"])])["id"]
    rival, waiter = Client(app_url), Client(app_url)
    with browse(browser, map_url(app_url, pid)) as page:
        ready(page)

        def word(seat_id: str, state_word: str) -> None:
            eventually(page, lambda: expect(cell(page, seat_id)).to_have_accessible_name(
                re.compile(", " + state_word + "$"), timeout=EXPECT_STEP_MS))

        must_hold(rival, pid, "ST-B-15")
        word("ST-B-15", "Taken")
        assert join(waiter, pid, "front-pair").status_code == 201
        assert rival.delete(f"/api/performances/{pid}/holds/ST-B-15").status_code == 200
        observe_for(page, LIVE_UPDATE_S)
        word("ST-B-15", "Taken")
        token = entry(waiter, pid)["offer"]["token"]
        assert waiter.post(f"/api/offers/{token}/decline").status_code == 200
        word("ST-B-15", "On sale")
        buy(rival, pid, "ST-A-9")
        word("ST-A-9", "Taken")
        expect(cell(page, "ST-A-9")).to_have_attribute("aria-disabled", "true")


def test_selected_seat_lost_while_choosing(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with browse(browser, map_url(app_url, pid)) as page:
        ready(page)
        click(cell(page, "ST-A-3"))
        click(cell(page, "ST-A-4"))
        watch(page)
        must_hold(Client(app_url), pid, "ST-A-3")
        expect_announced_once(page, f"Taken by another buyer: {label('ST-A-3')}.")
        expect(page.get_by_text(n_selected(1))).to_be_visible()
        expect(cell(page, "ST-A-3")).not_to_have_attribute("aria-selected", "true")
        expect(cell(page, "ST-A-4")).to_have_attribute("aria-selected", "true")
        expect(notice(page)).to_have_text(SEAT_TAKEN_NOTICE)


def test_one_announcement_per_result(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"]), tier(FRONT_PAIR, FRONT_FACE, seats=["ST-B-15"])])["id"]
    rival = Client(app_url)
    must_hold(rival, pid, "ST-B-15")
    name, email = unique("listener")
    with browse(browser, map_url(app_url, pid)) as seat_map:
        ready(seat_map)
        tickets = seat_map.context.new_page()
        tickets.goto(app_url + "/tickets")
        expect(tickets.get_by_role("heading", name="My tickets")).to_be_visible()
        for p in (seat_map, tickets):
            watch(p)
        click(cell(seat_map, "ST-A-2"))
        click_settled(seat_map.get_by_role("button", name="Hold selected seats"))
        expect_announced_once(seat_map, f"Held {label('ST-A-2')}.")
        click(cart_region(seat_map).get_by_role("button", name=f"Release {label('ST-A-2')}"))
        expect_announced_once(seat_map, f"Released {label('ST-A-2')}.")
        assert announced(tickets) == []
        joined = page_post(seat_map, app_url, f"/api/performances/{pid}/tiers/front-pair/waitlist", {"name": name, "email": email})
        assert joined.status == 201
        assert rival.delete(f"/api/performances/{pid}/holds/ST-B-15").status_code == 200
        arrival = f"A seat is offered to you: {label('ST-B-15')}."
        for p in (seat_map, tickets):
            expect_announced(p, arrival)
        observe_for(seat_map, LIVE_UPDATE_S)
        for p in (seat_map, tickets):
            assert announced(p).count(arrival) == 1, announced(p)
        expect(tickets.get_by_role("region", name="Waitlist").get_by_role("link", name="View offer")).to_be_visible()
        offer_page = seat_map.context.new_page()
        offer_page.goto(app_url + urlsplit(tickets.get_by_role("link", name="View offer").get_attribute("href")).path)
        expect(offer_page.get_by_role("heading", name="A seat for you")).to_be_visible()
        watch(offer_page)
        before = [len(announced(seat_map)), len(announced(tickets))]
        click(offer_page.get_by_role("button", name="Decline offer"))
        expect(offer_page.get_by_role("heading", name=OFFER_ENDED_HEADING)).to_be_visible()
        observe_for(offer_page, LIVE_UPDATE_S)
        assert announced(offer_page) == [OFFER_DECLINED]
        assert [len(announced(seat_map)), len(announced(tickets))] == before


def test_wf_live_map_two_browsers(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with browse(browser, map_url(app_url, pid)) as x, browse(browser, map_url(app_url, pid), viewport=PHONE) as y:
        ready(x)
        ready(y)
        phone_stack(y)
        click(cell(x, "ST-A-6"))
        settled_wedge(x, "ST-A-6")
        click_settled(x.get_by_role("button", name="Hold selected seats"))
        eventually(y, lambda: expect(cell(y, "ST-A-6")).to_have_accessible_name(re.compile(r", Taken$"), timeout=EXPECT_STEP_MS))
        left = 2 * SEATS_PER_ROW - 1
        eventually(y, lambda: expect(y.get_by_role("radiogroup", name="Price tier")).to_contain_text(f"{left} left", timeout=EXPECT_STEP_MS))
        buyers = [Client(app_url), Client(app_url)]
        barrier = threading.Barrier(2)
        out: list[httpx.Response | None] = [None, None]

        def go(i: int) -> None:
            barrier.wait()
            out[i] = hold(buyers[i], pid, "ST-A-7")

        threads = [threading.Thread(target=go, args=(i,)) for i in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert sorted(r.status_code for r in out) == [200, 409], [r.text for r in out]
        for p in (x, y):
            eventually(p, lambda q=p: expect(cell(q, "ST-A-7")).to_have_accessible_name(re.compile(r", Taken$"), timeout=EXPECT_STEP_MS))
        with gated_killbill(decline=True) as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
            f = Client(slow)
            must_hold(f, pid, "ST-A-20")
            eventually(y, lambda: expect(cell(y, "ST-A-20")).to_have_accessible_name(re.compile(r", Taken$"), timeout=EXPECT_STEP_MS))
            worker, out = in_background(lambda: checkout(same_fan(slow, f), pid))
            order_where(f, "pending_payment")
            expect(cell(y, "ST-A-20")).to_have_accessible_name(re.compile(r", Taken$"))
            gate.set()
            worker.join()
            assert out["response"].status_code == 402 and error_of(out["response"]) == "payment_declined", out["response"].text
            eventually(y, lambda: expect(cell(y, "ST-A-20")).to_have_accessible_name(re.compile(r", On sale$"), timeout=EXPECT_STEP_MS))
    assert remaining(Client(app_url), pid)["a-reserve"] == 2 * SEATS_PER_ROW - 2


def test_wf_live_map_selection_lost(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    with browse(browser, map_url(app_url, pid)) as mine, browse(browser, map_url(app_url, pid)) as rival:
        ready(mine)
        ready(rival)
        choose_tier_by_keys(mine, A_RESERVE)
        click(cell(mine, "ST-B-3"))
        settled_wedge(mine, "ST-B-3")
        watch(mine)
        click(cell(rival, "ST-B-3"))
        click_settled(rival.get_by_role("button", name="Hold selected seats"))
        expect_announced_once(mine, f"Taken by another buyer: {label('ST-B-3')}.")
        expect(cell(mine, "ST-B-3")).not_to_have_attribute("aria-selected", "true")
        expect(notice(mine)).to_have_text(SEAT_TAKEN_NOTICE)
    assert seats(Client(app_url), pid)["ST-B-3"]["state"] == "held"


def test_my_tickets_live_in_every_tab(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("tabs")
    with browse(browser, app_url + "/tickets") as actor:
        tabs = [actor.context.new_page(), actor.context.new_page()]
        for t in tabs:
            t.goto(app_url + "/tickets")
            expect(t.get_by_role("heading", name="My tickets")).to_be_visible()
        placed = page_buy(actor, app_url, pid, name, email, "ST-A-1", "ST-A-2")
        oid = placed["id"]
        for t in tabs:
            eventually(t, lambda q=t: expect(q.get_by_role("article", name=f"Order {oid}")).to_contain_text("Issued", timeout=EXPECT_STEP_MS))
        first, second = ticket_for(placed, "ST-A-1"), ticket_for(placed, "ST-A-2")
        assert page_post(actor, app_url, f"/api/orders/{oid}/refunds", {"ticketIds": [first["id"]]}, idempotency_key()).status == 200
        moved = page_post(actor, app_url, f"/api/tickets/{second['id']}/exchange", {"newSeatId": "ST-A-9"}, idempotency_key())
        assert moved.status == 200, moved.text()
        for t in tabs:
            art = t.get_by_role("article", name=f"Order {oid}")
            eventually(t, lambda a=art: expect(a.get_by_role("listitem").filter(has_text=label("ST-A-1"))).to_contain_text("Refunded", timeout=EXPECT_STEP_MS))
            eventually(t, lambda a=art: expect(a).to_contain_text(label("ST-A-9"), timeout=EXPECT_STEP_MS))


def test_ticket_status_provider_confirmed(browser: Browser, app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("status")
    with browse(browser, app_url + "/tickets") as page:
        placed = page_buy(page, app_url, pid, name, email, "ST-A-1", "ST-A-2")
        down = Client(env_url("APP_KILLBILL_DOWN_URL"),
                      {c["name"]: c["value"] for c in page.context.cookies() if c["name"] == "seatwise_buyer"})
        r = refund(down, placed["id"], [ticket_for(placed, "ST-A-2")["id"]])
        assert r.status_code == 503 and error_of(r) == "payments_unavailable"
        page.reload()
        art = page.get_by_role("article", name=f"Order {placed['id']}")
        item = art.get_by_role("listitem").filter(has_text=label("ST-A-1"))
        expect(item).to_contain_text("Issued")
        expect(art.get_by_role("listitem").filter(has_text=label("ST-A-2"))).to_contain_text("Issued")
        assert kb_refunded(killbill, email) == 0
        click(art.get_by_role("button", name=f"Refund {label('ST-A-1')}"))
        dialog = page.get_by_role("dialog", name="Refund ticket")
        with held(page, REFUNDS_GLOB) as gate:
            click(dialog.get_by_role("button", name="Confirm refund"))
            expect(dialog.get_by_role("button", name="Confirming refund")).to_be_disabled()
            behind = page.get_by_role("article", name=f"Order {placed['id']}", include_hidden=True)
            pending = behind.get_by_role("listitem", include_hidden=True).filter(has_text=label("ST-A-1"))
            expect(pending).to_contain_text("Refund pending")
            expect(pending).not_to_contain_text("Refunded")
            assert kb_refunded(killbill, email) == 0
            gate.release()
        eventually(page, lambda: expect(pending).to_contain_text("Refunded", timeout=EXPECT_STEP_MS))
    assert kb_refunded(killbill, email) == A_FACE + seat_fee(A_FACE)


def test_wf_my_tickets_after_purchase(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"]), tier(FRONT_PAIR, FRONT_FACE, seats=["ST-B-15"])])["id"]
    must_hold(Client(app_url), pid, "ST-B-15")
    name, email = unique("owner-of-tickets")
    with browse(browser, app_url + "/tickets") as page:
        expect(page.get_by_text("No tickets yet.")).to_be_visible()
        older = page_buy(page, app_url, pid, name, email, "ST-A-1")
        newer = page_buy(page, app_url, pid, name, email, "ST-A-2")
        assert page_post(page, app_url, f"/api/performances/{pid}/tiers/front-pair/waitlist", {"name": name, "email": email}).status == 201
        page.reload()
        old_art = page.get_by_role("article", name=f"Order {older['id']}")
        new_art = page.get_by_role("article", name=f"Order {newer['id']}")
        assert box(new_art)["y"] < box(old_art)["y"]
        item = old_art.get_by_role("listitem").filter(has_text=label("ST-A-1"))
        for copy in (A_RESERVE, money(A_FACE), money(seat_fee(A_FACE)), "Issued"):
            expect(item).to_contain_text(copy)
        expect(old_art).to_contain_text(FUTURE_LABEL)
        expect(old_art.get_by_role("button", name=f"Refund {label('ST-A-1')}")).to_be_visible()
        expect(page.get_by_role("region", name="Waitlist")).to_contain_text(place_text(1))
        ticket_id = older["tickets"][0]["id"]
        click(old_art.get_by_role("button", name=f"Exchange {label('ST-A-1')}"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(rf"/p/{re.escape(pid)}\?.*exchange={re.escape(ticket_id)}"), timeout=EXPECT_STEP_MS))
        ready(page)
        page.reload()
        ready(page)
        expect(page.get_by_role("button", name="Exchange to this seat")).to_be_visible()
    orders = Client(app_url).get("/api/orders").json()["orders"]
    assert orders == []


def test_wf_my_tickets_refunded_has_no_actions(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("mixed")
    with browse(browser, app_url + "/tickets") as page:
        placed = page_buy(page, app_url, pid, name, email, "ST-A-1", "ST-A-2")
        r = page_post(page, app_url, f"/api/orders/{placed['id']}/refunds", {"ticketIds": [ticket_for(placed, "ST-A-1")["id"]]}, idempotency_key())
        assert r.status == 200
        page.reload()
        art = page.get_by_role("article", name=f"Order {placed['id']}")
        expect(art.get_by_role("listitem").filter(has_text=label("ST-A-1"))).to_contain_text("Refunded")
        expect(art.get_by_role("button", name=f"Refund {label('ST-A-1')}")).to_have_count(0)
        expect(art.get_by_role("button", name=f"Exchange {label('ST-A-1')}")).to_have_count(0)
        expect(art.get_by_role("button", name=f"Exchange {label('ST-A-2')}")).to_be_visible()
        api = page.request.get(f"{app_url}/api/orders/{placed['id']}").json()
        assert ticket_for(api, "ST-A-1")["status"] == "refunded" and api["status"] == "partially_refunded"


def test_exchange_difference_to_the_cent(app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    b, viewer = Client(app_url), Client(app_url)
    placed = buy(b, pid, "ST-A-1")
    oid, tid = placed["id"], placed["tickets"][0]["id"]
    total = A_FACE + seat_fee(A_FACE) + ORDER_FEE
    down = exchange(b, tid, "ST-C-5")
    assert down.status_code == 200, down.text
    assert down.json()["differenceCents"] == -A_TO_B_REFUND
    assert ticket_for(down.json()["order"], "ST-C-5")["status"] == "issued"
    assert down.json()["order"]["netPaidCents"] == total - A_TO_B_REFUND
    assert sum(kb_cents(t["amount"]) for t in kb_tx(killbill.payment_by_key(oid), "REFUND")) == A_TO_B_REFUND
    state = seats(viewer, pid)
    assert state["ST-A-1"]["state"] == "on_sale" and state["ST-C-5"]["state"] == "sold"
    up = exchange(b, tid, "ST-A-2")
    assert up.status_code == 200 and up.json()["differenceCents"] == A_TO_B_REFUND
    topup = killbill.payment_by_key(f"{oid}-exchange-1")
    assert [kb_cents(t["amount"]) for t in kb_tx(topup, "PURCHASE")] == [A_TO_B_REFUND]
    assert up.json()["order"]["netPaidCents"] == total
    key = idempotency_key()
    level = exchange(b, tid, "ST-A-3", key=key)
    assert level.status_code == 200 and level.json()["differenceCents"] == 0
    assert exchange(b, tid, "ST-A-3", key=key).json() == level.json()
    assert killbill.payment_by_key(f"{oid}-exchange-2") is None
    assert len(kb_payments(killbill, b.email)) == 2
    own = exchange(b, tid, "ST-A-3")
    assert (own.status_code == 409 and own.json().get("error") == "seats_taken" and own.json().get("taken") == ["ST-A-3"]) or \
        field_of(own, "newSeatId") == NEW_SEAT_MSG, own.text
    assert field_of(exchange(b, tid, "BA-F-30"), "newSeatId") == NEW_SEAT_MSG
    must_hold(viewer, pid, "ST-A-10")
    taken = exchange(b, tid, "ST-A-10")
    assert taken.status_code == 409 and taken.json()["error"] == "seats_taken" and taken.json()["taken"] == ["ST-A-10"]

    assert exchange(Client(app_url), tid, "ST-A-11").status_code == 404
    assert field_of(exchange(b, tid, "ST-A-11", key=None), "idempotencyKey") == KEY_MSG
    assert ticket_for(order(b, oid), "ST-A-3")["status"] == "issued"
    assert remaining(viewer, pid)["a-reserve"] == 2 * SEATS_PER_ROW - 2
    assert remaining(viewer, pid)["b-reserve"] == 2 * SEATS_PER_ROW
    c = Client(app_url)
    low = buy(c, pid, "ST-C-6")
    with declining_killbill() as kb_url, app_copy({"KILLBILL_URL": kb_url}) as base:
        r = exchange(same_fan(base, c), ticket_for(low, "ST-C-6")["id"], "ST-A-12")
        assert r.status_code == 402 and error_of(r) == "payment_declined"
    assert ticket_for(order(c, low["id"]), "ST-C-6")["status"] == "issued"
    assert seats(viewer, pid)["ST-A-12"]["state"] == "on_sale"
    h = Client(app_url)
    swap = buy(h, pid, "ST-C-7")
    swap_ticket = ticket_for(swap, "ST-C-7")["id"]
    with gated_killbill(decline=True) as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
        worker, out = in_background(lambda: exchange(same_fan(slow, h), swap_ticket, "ST-A-13"))
        poll(lambda: ticket_for(order(h, swap["id"]), "ST-C-7")["status"] == "exchange_pending", PENDING_SEEN_S, "exchange pending")
        state = seats(viewer, pid)
        assert state["ST-A-13"]["state"] == "held" and state["ST-C-7"]["state"] == "sold", (state["ST-A-13"], state["ST-C-7"])
        gate.set()
        worker.join()
        assert out["response"].status_code == 402 and error_of(out["response"]) == "payment_declined", out["response"].text
    assert ticket_for(order(h, swap["id"]), "ST-C-7")["status"] == "issued"
    assert seats(viewer, pid)["ST-A-13"]["state"] == "on_sale"


def test_change_window_and_sales_close(app_url: str, killbill: Any) -> None:
    now = server_now(app_url)
    near = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"])], start=local_start(now + timedelta(hours=3)))
    assert near["salesOpen"] is True and near["changesOpen"] is False
    b = Client(app_url)
    placed = buy(b, near["id"], "ST-A-1")
    tid = placed["tickets"][0]["id"]
    for r in (exchange(b, tid, "ST-A-2"), refund(b, placed["id"], [tid])):
        assert r.status_code == 409 and error_of(r) == "changes_closed"
    assert ticket_for(order(b, placed["id"]), "ST-A-1")["status"] == "issued"
    assert kb_refunded(killbill, b.email) == 0
    start = (server_now(app_url) + timedelta(seconds=80)).replace(second=0)
    closing = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"]), tier(A_RESERVE, A_FACE, rows=["ST-B"])],
                      start=local_start(start))
    pid = closing["id"]
    holder, late, waiter = Client(app_url), Client(app_url), Client(app_url)
    must_hold(holder, pid, "ST-A-15")
    poll(lambda: performance(holder, pid)["salesOpen"] is False, SALES_CLOSE_WAIT_S, "sales to close")
    for r in (hold(late, pid, "ST-B-1"), checkout(holder, pid), join(waiter, pid, "front-pair")):
        assert r.status_code == 409 and error_of(r) == "sales_closed", r.text
    assert performance(holder, pid)["changesOpen"] is False
    assert killbill.account_by_key(holder.email.lower()) is None


def test_wf_exchange_downward_ui(browser: Browser, app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("downgrade")
    with browse(browser, app_url + "/tickets") as page:
        placed = page_buy(page, app_url, pid, name, email, "ST-A-1")
        watcher = page.context.new_page()
        watcher.goto(app_url + "/tickets")
        page.reload()
        click(page.get_by_role("button", name=f"Exchange {label('ST-A-1')}"))
        ready(page)
        choose_tier_by_keys(page, B_RESERVE)
        click(cell(page, "ST-C-5"))
        settled_wedge(page, "ST-C-5")
        watch(page)
        click_settled(page.get_by_role("button", name="Exchange to this seat"))
        dialog = page.get_by_role("dialog", name="Confirm exchange")
        expect(dialog).to_contain_text(f"We refund {money(A_TO_B_REFUND)}")
        expect(dialog).to_contain_text(label("ST-A-1"))
        expect(dialog).to_contain_text(label("ST-C-5"))
        click(dialog.get_by_role("button", name="Confirm exchange"))
        expect_announced_once(page, f"Exchange confirmed. Your new seat is {label('ST-C-5')}.", PAYMENT_DEADLINE_S)
        eventually(watcher, lambda: expect(watcher.get_by_role("article", name=f"Order {placed['id']}")).to_contain_text(label("ST-C-5"), timeout=EXPECT_STEP_MS))
    assert sum(kb_cents(t["amount"]) for t in kb_tx(killbill.payment_by_key(placed["id"]), "REFUND")) == A_TO_B_REFUND
    assert seats(Client(app_url), pid)["ST-A-1"]["state"] == "on_sale"


def test_wf_exchange_upward_ui(browser: Browser, app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("upgrade")
    with browse(browser, app_url + "/tickets", viewport=PHONE) as page:
        placed = page_buy(page, app_url, pid, name, email, "ST-C-5")
        page.reload()
        layout(page)
        touch_targets(page)
        click(page.get_by_role("button", name=f"Exchange {label('ST-C-5')}"))
        ready(page)
        click(cell(page, "ST-A-1"))
        settled_wedge(page, "ST-A-1")
        click_settled(page.get_by_role("button", name="Exchange to this seat"))
        dialog = page.get_by_role("dialog", name="Confirm exchange")
        expect(dialog).to_contain_text(f"You pay {money(A_TO_B_REFUND)}")
        click(dialog.get_by_role("button", name="Confirm exchange"))
        eventually(page, lambda: expect(status(page)).to_contain_text(f"Exchange confirmed. Your new seat is {label('ST-A-1')}.", timeout=EXPECT_STEP_MS), PAYMENT_DEADLINE_S)
    topup = killbill.payment_by_key(f"{placed['id']}-exchange-1")
    assert [kb_cents(t["amount"]) for t in kb_tx(topup, "PURCHASE")] == [A_TO_B_REFUND]
    state = seats(Client(app_url), pid)
    assert state["ST-C-5"]["state"] == "on_sale" and state["ST-A-1"]["state"] == "sold"


def test_refund_amounts_and_order_fee(app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    b, viewer = Client(app_url), Client(app_url)
    placed = buy(b, pid, "ST-C-1", "ST-C-2")
    oid = placed["id"]
    t1, t2 = ticket_for(placed, "ST-C-1")["id"], ticket_for(placed, "ST-C-2")["id"]
    each = B_FACE + seat_fee(B_FACE)
    first = refund(b, oid, [t1])
    assert first.status_code == 200 and first.json()["refundCents"] == each
    assert first.json()["order"]["status"] == "partially_refunded"
    assert first.json()["order"]["netPaidCents"] == TWO_B_TOTAL - each
    assert seats(viewer, pid)["ST-C-1"]["state"] == "on_sale"
    second = refund(b, oid, [t2])
    assert second.json()["refundCents"] == each + ORDER_FEE
    assert second.json()["order"]["status"] == "refunded" and second.json()["order"]["netPaidCents"] == 0
    for r in (refund(b, oid, [t1]), exchange(b, t1, "ST-C-9")):
        assert r.status_code == 409 and error_of(r) == "ticket_not_issued"
    third = buy(b, pid, "ST-C-3")
    other = buy(b, pid, "ST-C-4")
    t3 = third["tickets"][0]["id"]
    for ids in ([], [t3, t3], [other["tickets"][0]["id"]]):
        assert field_of(refund(b, third["id"], ids), "ticketIds") == TICKETS_MSG
    assert refund(Client(app_url), third["id"], [t3]).status_code == 404
    assert remaining(viewer, pid)["b-reserve"] == 2 * SEATS_PER_ROW - 2
    f = Client(app_url)
    six = buy(f, pid, "ST-C-11", "ST-C-12", "ST-C-13", "ST-C-14", "ST-C-15", "ST-C-16")
    assert field_of(hold(f, pid, "ST-C-21", "ST-C-22", "ST-C-23"), "seatIds") == LIMIT_MSG
    assert refund(f, six["id"], [ticket_for(six, "ST-C-11")["id"]]).status_code == 200
    assert hold(f, pid, "ST-C-21", "ST-C-22", "ST-C-23").status_code == 200
    g = Client(app_url)
    kept = buy(g, pid, "ST-C-25")
    kept_ticket = ticket_for(kept, "ST-C-25")["id"]
    with gated_killbill() as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
        worker, out = in_background(lambda: refund(same_fan(slow, g), kept["id"], [kept_ticket]))
        poll(lambda: ticket_for(order(g, kept["id"]), "ST-C-25")["status"] == "refund_pending", PENDING_SEEN_S, "refund pending")
        assert seats(viewer, pid)["ST-C-25"]["state"] == "sold"
        gate.set()
        worker.join()
        assert out["response"].status_code == 200, out["response"].text
    assert ticket_for(order(g, kept["id"]), "ST-C-25")["status"] == "refunded"
    assert seats(viewer, pid)["ST-C-25"]["state"] == "on_sale"


def test_refund_recorded_in_killbill(app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    b = Client(app_url)
    placed = buy(b, pid, "ST-C-1", "ST-C-2")
    oid = placed["id"]
    t1, t2 = ticket_for(placed, "ST-C-1")["id"], ticket_for(placed, "ST-C-2")["id"]
    assert exchange(b, t1, "ST-A-1").json()["differenceCents"] == A_TO_B_REFUND
    r = refund(b, oid, [t1])
    assert r.status_code == 200 and r.json()["refundCents"] == A_FACE + seat_fee(A_FACE)
    topup = killbill.payment_by_key(f"{oid}-exchange-1")
    main = killbill.payment_by_key(oid)
    assert sum(kb_cents(t["amount"]) for t in kb_tx(topup, "REFUND")) == A_TO_B_REFUND
    assert sum(kb_cents(t["amount"]) for t in kb_tx(main, "REFUND")) == A_FACE + seat_fee(A_FACE) - A_TO_B_REFUND
    before = kb_refunded(killbill, b.email)
    down = same_fan(env_url("APP_KILLBILL_DOWN_URL"), b)
    for resp in (refund(down, oid, [t2]), exchange(down, t2, "ST-A-2")):
        assert resp.status_code == 503 and error_of(resp) == "payments_unavailable"
    after = order(b, oid)
    assert ticket_for(after, "ST-C-2")["status"] == "issued"
    assert seats(b, pid)["ST-A-2"]["state"] == "on_sale"
    assert kb_refunded(killbill, b.email) == before


def test_wf_refund_whole_order_ui(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("refunder")
    with browse(browser, app_url + "/tickets") as page:
        placed = page_buy(page, app_url, pid, name, email, "ST-A-1")
        page.reload()
        with browse(browser, map_url(app_url, pid, seat="ST-A-1")) as other:
            ready(other)
            eventually(other, lambda: expect(cell(other, "ST-A-1")).to_have_accessible_name(re.compile(r", Taken$"), timeout=EXPECT_STEP_MS))
            watch(page)
            touch_targets(page)
            page.get_by_role("button", name=f"Refund {label('ST-A-1')}").focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Refund ticket")
            amount = A_FACE + seat_fee(A_FACE) + ORDER_FEE
            expect(dialog).to_contain_text(f"Refund {money(amount)}")
            expect(dialog).to_contain_text("Includes the order fee")
            touch_targets(page)
            dialog.get_by_role("button", name="Confirm refund").focus()
            page.keyboard.press("Enter")
            expect_announced_once(page, f"Refund confirmed: {money(amount)}.", PAYMENT_DEADLINE_S)
            expect(page.get_by_role("article", name=f"Order {placed['id']}").get_by_role("listitem")).to_contain_text("Refunded")
            eventually(other, lambda: expect(cell(other, "ST-A-1")).to_have_accessible_name(re.compile(r", On sale$"), timeout=EXPECT_STEP_MS))
            choose_tier_by_keys(other, A_RESERVE)
            click(cell(other, "ST-A-1"))
            settled_wedge(other, "ST-A-1")
    assert kb_refunded(killbill, email) == amount
    await_mail(mail, email, f"Your refund: order {placed['id']}")


def test_wf_refund_partial_ui(browser: Browser, app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("partial")
    with browse(browser, app_url + "/tickets") as page:
        page_buy(page, app_url, pid, name, email, "ST-C-1", "ST-C-2")
        page.reload()
        click(page.get_by_role("button", name=f"Refund {label('ST-C-1')}"))
        dialog = page.get_by_role("dialog", name="Refund ticket")
        amount = B_FACE + seat_fee(B_FACE)
        expect(dialog).to_contain_text(f"Refund {money(amount)}")
        expect(dialog).not_to_contain_text("Includes the order fee")
        click(dialog.get_by_role("button", name="Confirm refund"))
        eventually(page, lambda: expect(status(page)).to_contain_text(f"Refund confirmed: {money(amount)}.", timeout=EXPECT_STEP_MS), PAYMENT_DEADLINE_S)
    assert kb_refunded(killbill, email) == amount


def test_join_sold_out_waitlist(app_url: str) -> None:
    pid = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15", "ST-A-16"]), tier(A_RESERVE, A_FACE, rows=["ST-B"])])["id"]
    w1, w2, dup = Client(app_url), Client(app_url), Client(app_url)
    early = join(w1, pid, "front-pair")
    assert early.status_code == 409 and error_of(early) == "tier_not_sold_out"
    must_hold(Client(app_url), pid, "ST-A-15", "ST-A-16")
    first = join(w1, pid, "front-pair")
    assert first.status_code == 201, first.text
    got = first.json()["entry"]
    assert got["tierId"] == "front-pair" and got["tierName"] == FRONT_PAIR
    assert got["position"] == 1 and got["status"] == "waiting" and got["offer"] is None
    assert join(w2, pid, "front-pair").json()["entry"]["position"] == 2
    again = join(dup, pid, "front-pair", email=w1.email.upper())
    assert again.status_code == 409 and error_of(again) == "already_waiting"
    assert error_of(join(w1, pid, "a-reserve")) == "tier_not_sold_out"
    bad_cases = [("name", "   ", None, NAME_MSG), ("name", "n" * (NAME_MAX + 1), None, NAME_MSG),
                 ("email", None, "no-at-sign", EMAIL_MSG), ("email", None, "a@" + "b" * EMAIL_MAX + ".example", EMAIL_MSG)]
    for field, name, email, message in bad_cases:
        assert field_of(join(Client(app_url), pid, "front-pair", name=name, email=email), field) == message
    assert entry(w1, pid)["position"] == 1 and entry(w2, pid)["position"] == 2
    assert owner_tiers(app_url, pid)["front-pair"]["waitlistLength"] == 2
    assert join(w1, pid, "no-such-tier").status_code == 404


def test_offers_in_join_order(app_url: str) -> None:
    short = env_url("APP_SHORT_URL")
    pid = publish(short, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15", "ST-A-16"])])["id"]
    must_hold(Client(short), pid, "ST-A-15", "ST-A-16")
    w1, w2, w3, viewer = Client(short), Client(short), Client(short), Client(short)
    for w in (w1, w2, w3):
        assert join(w, pid, "front-pair").status_code == 201
    poll(lambda: entry(w1, pid)["status"] == "offered" and entry(w2, pid)["status"] == "offered",
         SHORT_HOLD_S + EXPIRY_SLACK_S, "offers to the first two entries")
    o1, o2 = entry(w1, pid)["offer"], entry(w2, pid)["offer"]
    assert {o1["seatId"], o2["seatId"]} == {"ST-A-15", "ST-A-16"} and o1["status"] == "open"
    assert entry(w3, pid)["status"] == "waiting" and entry(w3, pid)["position"] == 1
    assert {s["state"] for i, s in seats(viewer, pid).items() if i in ("ST-A-15", "ST-A-16")} == {"offered"}
    declined = w1.post(f"/api/offers/{o1['token']}/decline")
    assert declined.status_code == 200 and declined.json()["offer"]["status"] == "declined"
    assert entry(w1, pid)["status"] == "declined"
    poll(lambda: entry(w3, pid)["status"] == "offered", OFFER_EMAIL_S + EXPIRY_SLACK_S, "offer passed to the third entry")
    o3 = entry(w3, pid)["offer"]
    assert o3["seatId"] == o1["seatId"]
    assert accept(w3, o3["token"]).status_code == 201
    poll(lambda: entry(w2, pid)["status"] == "expired", SHORT_OFFER_S + EXPIRY_SLACK_S, "second offer to expire")
    assert entry(w2, pid)["offer"]["status"] == "expired"
    poll(lambda: seats(viewer, pid)[o2["seatId"]]["state"] == "on_sale", EXPIRY_SLACK_S, "expired seat back on sale")
    assert seats(viewer, pid)[o1["seatId"]]["state"] == "sold"


def test_offer_window_edges(app_url: str, killbill: Any) -> None:
    short = env_url("APP_SHORT_URL")

    def offered() -> tuple[str, Client]:
        pid = publish(short, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"])])["id"]
        must_hold(Client(short), pid, "ST-A-15")
        w = Client(short)
        assert join(w, pid, "front-pair").status_code == 201
        poll(lambda: entry(w, pid)["status"] == "offered", SHORT_HOLD_S + EXPIRY_SLACK_S, "offer")
        return entry(w, pid)["offer"]["token"], w

    token, w1 = offered()
    key = idempotency_key()
    first = accept(w1, token, key=key)
    assert first.status_code == 201, first.text
    assert accept(w1, token, key=key).json() == first.json()
    for r in (accept(w1, token), w1.post(f"/api/offers/{token}/decline")):
        assert r.status_code == 409 and error_of(r) == "offer_closed"
    token2, w2 = offered()
    poll(lambda: w2.get(f"/api/offers/{token2}").json()["offer"]["status"] == "expired",
         SHORT_OFFER_S + EXPIRY_SLACK_S, "offer expiry")
    for r in (accept(w2, token2), w2.post(f"/api/offers/{token2}/decline")):
        assert r.status_code == 410 and error_of(r) == "offer_expired"
    assert killbill.account_by_key(w2.email.lower()) is None
    pid3 = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"])])["id"]
    holder = Client(app_url)
    must_hold(holder, pid3, "ST-A-15")
    w3 = Client(app_url)
    assert join(w3, pid3, "front-pair").status_code == 201
    assert holder.delete(f"/api/performances/{pid3}/holds/ST-A-15").status_code == 200
    poll(lambda: entry(w3, pid3)["status"] == "offered", LIVE_DEADLINE_S, "offer")
    with declining_killbill() as kb_url, app_copy({"KILLBILL_URL": kb_url}) as base:
        r = accept(same_fan(base, w3), entry(w3, pid3)["offer"]["token"])
        assert r.status_code == 402 and error_of(r) == "payment_declined"
    pid4 = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"])])["id"]
    holder4 = Client(app_url)
    must_hold(holder4, pid4, "ST-A-15")
    w4 = Client(app_url)
    assert join(w4, pid4, "front-pair").status_code == 201
    assert holder4.delete(f"/api/performances/{pid4}/holds/ST-A-15").status_code == 200
    poll(lambda: entry(w4, pid4)["status"] == "offered", LIVE_DEADLINE_S, "offer")
    token4 = entry(w4, pid4)["offer"]["token"]
    with gated_killbill() as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
        worker, out = in_background(lambda: accept(same_fan(slow, w4), token4))
        pending = order_where(w4, "pending_payment")
        assert [t["status"] for t in pending["tickets"]] == ["payment_pending"]
        assert seats(Client(app_url), pid4)["ST-A-15"]["state"] != "sold"
        gate.set()
        worker.join()
        assert out["response"].status_code == 201, out["response"].text
    assert seats(Client(app_url), pid4)["ST-A-15"]["state"] == "sold"
    account = killbill.account_by_key(w4.email.lower())
    assert account and account["name"] == w4.name and account["currency"] == "USD", account


def test_waitlist_offer_email(app_url: str, mail: Any) -> None:
    perf = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15", "ST-A-16"])])
    pid = perf["id"]
    holder, w1, w2 = Client(app_url), Client(app_url), Client(app_url)
    must_hold(holder, pid, "ST-A-15", "ST-A-16")
    for w in (w1, w2):
        assert join(w, pid, "front-pair").status_code == 201
    subject = f"A seat is offered to you: {perf['title']}"
    assert holder.delete(f"/api/performances/{pid}/holds/ST-A-15").status_code == 200
    message = await_mail(mail, w1.email, subject)[0]
    assert inbox(mail, w2.email, subject) == []
    offer = entry(w1, pid)["offer"]
    body = text(message)
    for copy in (label("ST-A-15"), perf["title"], FUTURE_LABEL, f"Total {money(ONE_FRONT_TOTAL)}",
                 f"Accept by {offer_expiry_text(instant(offer['expiresAt']))}"):
        assert copy in body, (copy, body)
    assert re.search(r"https?://\S+/offers/" + re.escape(offer["token"]), body), body
    assert mail_from_address() in addresses(message.get("From"))
    assert holder.delete(f"/api/performances/{pid}/holds/ST-A-16").status_code == 200
    assert label("ST-A-16") in text(await_mail(mail, w2.email, subject)[0])
    assert len(inbox(mail, w1.email, subject)) == 1


def test_wf_waitlist_join_and_accept(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    perf = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"])])
    pid = perf["id"]
    holder = Client(app_url)
    must_hold(holder, pid, "ST-A-15")
    name, email = unique("waiter")
    with browse(browser, app_url + "/") as page:
        page.clock.set_system_time(SKEWED_DEVICE_TIME)
        page.goto(map_url(app_url, pid))
        ready(page)
        rail_stays_in_view(page)
        watch(page)
        click(page.get_by_role("button", name=f"Join the waitlist for {FRONT_PAIR}"))
        dialog = page.get_by_role("dialog", name="Join the waitlist")
        fill(dialog.get_by_role("textbox", name="Full name"), name)
        fill(dialog.get_by_role("textbox", name="Email"), email)
        click(dialog.get_by_role("button", name="Join waitlist"))
        expect_announced_once(page, f"You're on the waitlist for {FRONT_PAIR}. Your place is 1.")
        page.goto(app_url + "/tickets")
        expect(page.get_by_role("region", name="Waitlist")).to_contain_text(place_text(1))
        watch(page)
        assert holder.delete(f"/api/performances/{pid}/holds/ST-A-15").status_code == 200
        expect_announced(page, f"A seat is offered to you: {label('ST-A-15')}.")
        click(page.get_by_role("region", name="Waitlist").get_by_role("link", name="View offer"))
        expect(page.get_by_role("heading", name="A seat for you")).to_be_visible()
        expect(page.get_by_text(label("ST-A-15")).first).to_be_visible()
        timer = page.get_by_role("timer", name="Offer time left")
        token = urlsplit(page.url).path.rsplit("/", 1)[1]
        server_left = page.request.get(f"{app_url}/api/offers/{token}").json()["offer"]["secondsLeft"]
        assert abs(mss(timer.inner_text()) - server_left) <= COUNTDOWN_SLACK_S
        watch(page)
        click(page.get_by_role("button", name=f"Accept and pay {money(ONE_FRONT_TOTAL)}"))
        oid = confirmed_order_id(page, page)
        expect(page.get_by_role("region", name="Receipt")).to_contain_text(money(ONE_FRONT_TOTAL))
        expect_announced(page, PAID)
    assert [kb_cents(t["amount"]) for t in kb_tx(killbill.payment_by_key(oid), "PURCHASE")] == [ONE_FRONT_TOTAL]
    await_mail(mail, email, f"Your Halyard Hall tickets: order {oid}")
    assert seats(holder, pid)["ST-A-15"]["state"] == "sold"


def test_wf_waitlist_decline(browser: Browser, app_url: str, mail: Any) -> None:
    perf = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"])])
    pid = perf["id"]
    holder, w2 = Client(app_url), Client(app_url)
    must_hold(holder, pid, "ST-A-15")
    name, email = unique("decliner")
    with browse(browser, app_url + "/") as page:
        r = page_post(page, app_url, f"/api/performances/{pid}/tiers/front-pair/waitlist", {"name": name, "email": email})
        assert r.status == 201
        assert join(w2, pid, "front-pair").status_code == 201
        assert holder.delete(f"/api/performances/{pid}/holds/ST-A-15").status_code == 200
        entries = page.request.get(f"{app_url}/api/waitlist").json()["entries"]
        token = next(e for e in entries if e["performanceId"] == pid)["offer"]["token"]
        page.goto(f"{app_url}/offers/{token}")
        expect(page.get_by_role("heading", name="A seat for you")).to_be_visible()
        watch(page)
        click(page.get_by_role("button", name="Decline offer"))
        expect(page.get_by_role("heading", name=OFFER_ENDED_HEADING)).to_be_visible()
        observe_for(page, LIVE_UPDATE_S)
        assert announced(page) == [OFFER_DECLINED]
    await_mail(mail, w2.email, f"A seat is offered to you: {perf['title']}", seconds=OFFER_EMAIL_S + MAIL_DEADLINE_S)
    assert entry(w2, pid)["status"] == "offered"


def test_owner_session_required(browser: Browser, app_url: str) -> None:
    title = f"Seatwise {unique('unauth')[0]}"
    anon, fan = Client(app_url), Client(app_url)
    fan.get("/api/performances")
    for c in (anon, fan):
        for path in ("/api/owner/performances", "/api/owner/orders", "/api/owner/outbox"):
            r = c.get(path)
            assert r.status_code == 401 and r.json() == {"error": "unauthorized"}
        r = c.post("/api/owner/performances", {"title": title, "startsLocal": FUTURE_START, "tiers": [tier(A_RESERVE, A_FACE, rows=["ST-A"])]})
        assert r.status_code == 401
    assert title not in [p["title"] for p in anon.get("/api/performances").json()["performances"]]
    wrong = anon.post("/api/owner/session", {"passcode": PASSCODE + "x"})
    assert wrong.status_code == 401 and error_of(wrong) == "unauthorized"
    ok = anon.post("/api/owner/session", {"passcode": PASSCODE})
    assert ok.status_code == 204
    cookie = next(h for h in ok.headers.get_list("set-cookie") if h.startswith("seatwise_owner="))
    assert "HttpOnly".lower() in cookie.lower()
    assert anon.get("/api/owner/orders").status_code == 200
    assert anon.delete("/api/owner/session").status_code == 204
    assert anon.get("/api/owner/orders").status_code == 401
    with browse(browser, app_url + "/owner") as page:
        expect(page.get_by_role("textbox", name="Passcode")).to_be_visible()
        expect(page.get_by_role("heading", name="Performances")).to_have_count(0)


def test_publish_validation(app_url: str) -> None:
    o = owner(app_url)
    good = [tier(A_RESERVE, A_FACE, rows=["ST-A"])]

    def attempt(title: str, start: str, tiers: list[dict]) -> httpx.Response:
        return o.post("/api/owner/performances", {"title": title, "startsLocal": start, "tiers": tiers})

    cases = [
        ("title", "", FUTURE_START, good, TITLE_MSG),
        ("title", "t" * (TITLE_MAX + 1), FUTURE_START, good, TITLE_MSG),
        ("startsLocal", None, "2027/02/12 20:00", good, START_FORMAT_MSG),
        ("startsLocal", None, "2020-01-01T10:00", good, FUTURE_MSG),
        ("tiers", None, FUTURE_START, [], TIER_COUNT_MSG),
        ("tiers", None, FUTURE_START, [tier(f"Tier {i}", A_FACE, seats=[f"ST-A-{i + 1}"]) for i in range(7)], TIER_COUNT_MSG),
        ("tiers", None, FUTURE_START, [tier(A_RESERVE, FACE_MIN - 1, rows=["ST-A"])], TIER_MSG),
        ("tiers", None, FUTURE_START, [tier(A_RESERVE, FACE_MAX + 1, rows=["ST-A"])], TIER_MSG),
        ("tiers", None, FUTURE_START, [tier(A_RESERVE, A_FACE, rows=["ST-A"]), tier(B_RESERVE, B_FACE, seats=["ST-A-3"])], TIER_MSG),
        ("tiers", None, FUTURE_START, [tier(A_RESERVE, A_FACE, rows=["ST-A"]), tier("a reserve", B_FACE, rows=["ST-B"])], TIER_MSG),
        ("tiers", None, FUTURE_START, [tier(A_RESERVE, A_FACE)], TIER_MSG),
        ("tiers", None, FUTURE_START, [tier("", A_FACE, rows=["ST-A"])], TIER_MSG),
        ("tiers", None, FUTURE_START, [tier(A_RESERVE, A_FACE, rows=["ST-Z"])], TIER_MSG),
    ]
    for field, title, start, tiers, message in cases:
        title = f"Seatwise {unique('bad')[0]}" if title is None else title
        assert field_of(attempt(title, start, tiers), field) == message, (field, start)
        if title:
            assert title not in [p["title"] for p in Client(app_url).get("/api/performances").json()["performances"]]
    long_title = f"Seatwise {unique('long')[0]}".ljust(TITLE_MAX, "x")
    six = [tier(f"Rear  Circle! {i}", FACE_MIN if i == 0 else FACE_MAX, rows=[f"BA-{chr(ord('A') + i)}"]) for i in range(5)]
    six.append(tier(FRONT_PAIR, FRONT_FACE, rows=["ST-B"], seats=["ST-A-15", "ST-A-16"]))
    r = attempt(long_title, FUTURE_START, six)
    assert r.status_code == 201, r.text
    perf = r.json()["performance"]
    assert re.fullmatch(r"[a-z0-9-]+", perf["id"]) and perf["title"] == long_title
    assert perf["startsAtVenue"] == FUTURE_LABEL
    assert [t["id"] for t in perf["tiers"]] == [tier_id(t["name"]) for t in six]
    assert {t["id"]: t["remaining"] for t in perf["tiers"]}["front-pair"] == SEATS_PER_ROW + 2
    state = seats(Client(app_url), perf["id"])
    assert state["ST-A-15"]["tierId"] == "front-pair" and state["ST-B-30"]["tierId"] == "front-pair"
    assert state["ST-A-1"]["tierId"] is None and state["ST-A-1"]["state"] == "not_on_sale"


def test_seats_remaining_from_seat_states(app_url: str) -> None:
    pid = publish(app_url, [tier(A_RESERVE, A_FACE, rows=["ST-A"]), tier(FRONT_PAIR, FRONT_FACE, seats=["ST-B-15"])])["id"]
    b, viewer, x, w = Client(app_url), Client(app_url), Client(app_url), Client(app_url)

    def check(on_sale_a: int) -> None:
        state = seats(viewer, pid)
        counts = {tid: {k: sum(1 for s in state.values() if s["tierId"] == tid and s["state"] == k)
                        for k in ("on_sale", "held", "sold", "offered")} for tid in ("a-reserve", "front-pair")}
        assert remaining(viewer, pid) == {tid: c["on_sale"] for tid, c in counts.items()}
        listed = next(p for p in viewer.get("/api/performances").json()["performances"] if p["id"] == pid)
        assert {t["id"]: t["remaining"] for t in listed["tiers"]} == remaining(viewer, pid)
        for tid, t in owner_tiers(app_url, pid).items():
            assert (t["onSale"], t["held"], t["sold"], t["offered"]) == tuple(counts[tid].values())
        assert counts["a-reserve"]["on_sale"] == on_sale_a

    check(SEATS_PER_ROW)
    must_hold(b, pid, "ST-A-1", "ST-A-2", "ST-A-3")
    check(SEATS_PER_ROW - 3)
    b.delete(f"/api/performances/{pid}/holds/ST-A-3")
    check(SEATS_PER_ROW - 2)
    r = checkout(b, pid)
    assert r.status_code == 201
    placed = r.json()["order"]
    check(SEATS_PER_ROW - 2)
    assert refund(b, placed["id"], [ticket_for(placed, "ST-A-1")["id"]]).status_code == 200
    check(SEATS_PER_ROW - 1)
    assert exchange(b, ticket_for(placed, "ST-A-2")["id"], "ST-A-20").status_code == 200
    check(SEATS_PER_ROW - 1)
    must_hold(x, pid, "ST-B-15")
    assert join(w, pid, "front-pair").status_code == 201
    assert owner_tiers(app_url, pid)["front-pair"]["waitlistLength"] == 1
    x.delete(f"/api/performances/{pid}/holds/ST-B-15")
    check(SEATS_PER_ROW - 1)
    assert owner_tiers(app_url, pid)["front-pair"]["offered"] == 1
    assert owner_tiers(app_url, pid)["front-pair"]["waitlistLength"] == 0


def test_order_reconciliation(browser: Browser, app_url: str, killbill: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    b = Client(app_url)
    placed = buy(b, pid, "ST-A-1")
    down = same_fan(env_url("APP_KILLBILL_DOWN_URL"), b)
    must_hold(down, pid, "ST-A-2")
    assert checkout(down, pid).status_code == 503
    orders = [o for o in owner(app_url).get("/api/owner/orders").json()["orders"] if o["email"] == b.email]
    paid = next(o for o in orders if o["id"] == placed["id"])
    cancelled = next(o for o in orders if o["id"] != placed["id"])
    account = killbill.account_by_key(b.email.lower())
    payment = killbill.payment_by_key(placed["id"])
    assert paid["status"] == "paid" and paid["totalCents"] == A_FACE + seat_fee(A_FACE) + ORDER_FEE
    assert paid["killbillAccountId"] == account["accountId"]
    assert paid["killbillPaymentIds"] == [payment["paymentId"]]
    assert paid["receipt"] in ("queued", "sent")
    assert cancelled["status"] == "cancelled" and cancelled["killbillPaymentIds"] == []
    for o in orders:
        if any(t["status"] == "issued" for t in o["tickets"]):
            assert o["receipt"] in ("queued", "sent")
            assert all(kb_tx(killbill.payment_by_key(o["id"]), "PURCHASE") for _ in [0])
    with browse(browser, app_url + "/owner") as page:
        sign_in_owner_ui(page)
        click(page.get_by_role("link", name="Orders"))
        row = page.get_by_role("table", name="Orders").get_by_role("row").filter(has_text=placed["id"])
        expect(row).to_contain_text(payment["paymentId"])
        expect(row).to_contain_text(money(paid["totalCents"]))


def test_wf_owner_publish_and_watch(browser: Browser, app_url: str) -> None:
    title = f"Late Set {unique('owner')[0]}"
    with browse(browser, app_url + "/owner") as page:
        sign_in_owner_ui(page)
        click(page.get_by_role("link", name="Publish performance"))
        watch(page)
        touch_targets(page)
        fill(page.get_by_role("textbox", name="Title"), title)
        fill(page.get_by_role("textbox", name="Start (venue time)"), LATE_START)
        first = page.get_by_role("group", name=f"Tier {1}")
        fill(first.get_by_role("textbox", name="Tier name"), A_RESERVE)
        fill(first.get_by_role("textbox", name="Face value in dollars"), money(A_FACE)[1:])
        fill(first.get_by_role("textbox", name="Rows and seats"), "ST-A, ST-B-1")
        click(page.get_by_role("button", name="Add tier"))
        second = page.get_by_role("group", name=f"Tier {2}")
        fill(second.get_by_role("textbox", name="Tier name"), B_RESERVE)
        fill(second.get_by_role("textbox", name="Face value in dollars"), money(B_FACE)[1:])
        fill(second.get_by_role("textbox", name="Rows and seats"), "CI-A")
        click(page.get_by_role("button", name="Publish"))
        expect_announced_once(page, f"Published {title}.")
        perf = next(p for p in owner(app_url).get("/api/owner/performances").json()["performances"] if p["title"] == title)
        assert perf["startsAt"] == LATE_UTC and perf["startsAtVenue"] == LATE_LABEL
        assert {t["id"]: t["onSale"] for t in perf["tiers"]} == {"a-reserve": SEATS_PER_ROW + 1, "b-reserve": SEATS_PER_ROW}
        page.goto(app_url + "/owner")
        table = page.get_by_role("table", name=title)
        expect(table).to_be_visible()
        expect(page.get_by_text(LATE_LABEL).first).to_be_visible()
        assert row_numbers(table, A_RESERVE) == [SEATS_PER_ROW + 1, 0, 0, 0, 0]
        must_hold(Client(app_url), perf["id"], "ST-A-1", "ST-A-2")
        eventually(page, lambda: (_ for _ in ()).throw(AssertionError("stale")) if row_numbers(table, A_RESERVE) != [SEATS_PER_ROW - 1, 2, 0, 0, 0] else None)
        with browse(browser, map_url(app_url, perf["id"], section="CI", seat="CI-A-15")) as fan:
            ready(fan)
            choose_tier_by_keys(fan, B_RESERVE)
            settled_wedge(fan, "CI-A-15")
            rail_stays_in_view(fan)
            keyboard_hold(fan, "CI-A-15")
        eventually(page, lambda: (_ for _ in ()).throw(AssertionError("stale")) if row_numbers(table, B_RESERVE) != [SEATS_PER_ROW - 1, 1, 0, 0, 0] else None)
        with gated_killbill() as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
            f = Client(slow)
            must_hold(f, perf["id"], "CI-A-1")
            worker, out = in_background(lambda: checkout(same_fan(slow, f), perf["id"]))
            order_where(f, "pending_payment")
            eventually(page, lambda: (_ for _ in ()).throw(AssertionError("stale")) if row_numbers(table, B_RESERVE) != [SEATS_PER_ROW - 2, 2, 0, 0, 0] else None)
            gate.set()
            worker.join()
            assert out["response"].status_code == 201, out["response"].text
        eventually(page, lambda: (_ for _ in ()).throw(AssertionError("stale")) if row_numbers(table, B_RESERVE) != [SEATS_PER_ROW - 2, 1, 1, 0, 0] else None)
    assert owner_tiers(app_url, perf["id"])["a-reserve"]["held"] == 2


def test_wf_owner_orders_outbox(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    b = Client(app_url)
    placed = buy(b, pid, "ST-A-1")
    payment = killbill.payment_by_key(placed["id"])
    await_mail(mail, b.email, f"Your Halyard Hall tickets: order {placed['id']}")
    with browse(browser, app_url + "/owner") as page:
        sign_in_owner_ui(page)
        click(page.get_by_role("link", name="Orders"))
        expect(page.get_by_role("table", name="Orders").get_by_role("row").filter(has_text=placed["id"])).to_contain_text(payment["paymentId"])
        page.goto(app_url + "/owner/outbox")
        row = page.get_by_role("table", name="Outbox").get_by_role("row").filter(has_text=b.email)
        eventually(page, lambda: expect(row).to_contain_text("Sent", timeout=EXPECT_STEP_MS), MAIL_DEADLINE_S)
        page.set_viewport_size(PHONE)
        for path in ("/owner", "/owner/orders", "/owner/outbox"):
            page.goto(app_url + path)
            expect(page.get_by_role("table").first).to_be_visible()
            layout(page)
            touch_targets(page)


def test_wf_owner_sign_in_failure(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url + "/owner") as page:
        watch(page)
        fill(page.get_by_role("textbox", name="Passcode"), PASSCODE + "-wrong")
        click(page.get_by_role("button", name="Sign in"))
        expect_announced_once(page, "That passcode is not right.")
        assert page.request.get(app_url + "/api/owner/orders").status == 401
        fill(page.get_by_role("textbox", name="Passcode"), PASSCODE)
        click(page.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("heading", name="Performances")).to_be_visible()
        assert page.request.get(app_url + "/api/owner/orders").status == 200
        click(page.get_by_role("button", name="Sign out"))
        expect(page.get_by_role("textbox", name="Passcode")).to_be_visible()
        assert page.request.get(app_url + "/api/owner/orders").status == 401


def test_order_receipt_email(app_url: str, mail: Any) -> None:
    perf = publish(app_url, standard_layout())
    b = Client(app_url)
    must_hold(b, perf["id"], "ST-A-1", "CI-A-2")
    key = idempotency_key()
    placed = checkout(b, perf["id"], key=key).json()["order"]
    assert checkout(b, perf["id"], key=key).json()["order"]["id"] == placed["id"]
    total = A_FACE + seat_fee(A_FACE) + B_FACE + seat_fee(B_FACE) + ORDER_FEE
    message = await_mail(mail, b.email, f"Your Halyard Hall tickets: order {placed['id']}")[0]
    assert mail_from_address() in addresses(message.get("From"))
    body = text(message)
    for copy in (f"Order {placed['id']}", perf["title"], FUTURE_LABEL,
                 f"{label('ST-A-1')} ({A_RESERVE}): face {money(A_FACE)}, fee {money(seat_fee(A_FACE))}",
                 f"{label('CI-A-2')} ({B_RESERVE}): face {money(B_FACE)}, fee {money(seat_fee(B_FACE))}",
                 f"Order fee {money(ORDER_FEE)}", f"Total {money(total)}"):
        assert copy in body, (copy, body)
    assert len(inbox(mail, b.email)) == 1


def test_exchange_and_refund_emails(app_url: str, mail: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    b = Client(app_url)
    placed = buy(b, pid, "ST-A-1")
    oid, tid = placed["id"], placed["tickets"][0]["id"]
    for new in ("CI-A-1", "ST-A-2", "ST-A-3"):
        assert exchange(b, tid, new).status_code == 200
    swaps = await_mail(mail, b.email, f"Your seat exchange: order {oid}", count=3)
    bodies = [text(m) for m in swaps]
    expected = {f"Refunded {money(A_TO_B_REFUND)}": ("ST-A-1", "CI-A-1"),
                f"Charged {money(A_TO_B_REFUND)}": ("CI-A-1", "ST-A-2"), "No price difference": ("ST-A-2", "ST-A-3")}
    for line, (old, new) in expected.items():
        match = [x for x in bodies if line in x]
        assert len(match) == 1, (line, bodies)
        assert f"From {label(old)}" in match[0] and f"To {label(new)}" in match[0]
    assert refund(b, oid, [tid]).status_code == 200
    body = text(await_mail(mail, b.email, f"Your refund: order {oid}")[0])
    for copy in (label("ST-A-3"), "Order fee refunded", f"Refunded {money(A_FACE + seat_fee(A_FACE) + ORDER_FEE)}"):
        assert copy in body, body
    two = buy(b, pid, "ST-B-1", "ST-B-2")
    assert refund(b, two["id"], [two["tickets"][0]["id"]]).status_code == 200
    partial = text(await_mail(mail, b.email, f"Your refund: order {two['id']}")[0])
    assert "Order fee refunded" not in partial and f"Refunded {money(A_FACE + seat_fee(A_FACE))}" in partial


def test_receipts_survive_mail_outage(app_url: str, killbill: Any, mail: Any) -> None:
    down = env_url("APP_MAIL_DOWN_URL")
    pid = publish(app_url, standard_layout())["id"]
    b = Client(down)
    placed = buy(b, pid, "ST-A-1")
    assert placed["status"] == "paid" and placed["tickets"][0]["status"] == "issued"
    assert kb_tx(killbill.payment_by_key(placed["id"]), "PURCHASE")
    subject = f"Your Halyard Hall tickets: order {placed['id']}"
    await_mail(mail, b.email, subject, seconds=RETRY_DEADLINE_S)
    poll(lambda: [m["status"] for m in outbox_for(app_url, b.email)] == ["sent"], RETRY_DEADLINE_S, "outbox sent")
    poll(lambda: False if len(inbox(mail, b.email, subject)) != 1 else True, MAIL_RETRY_S, "single receipt")
    assert len(inbox(mail, b.email, subject)) == 1


def test_owner_outbox_matches_mailpit(browser: Browser, app_url: str, mail: Any) -> None:
    pid = publish(app_url, standard_layout())["id"]
    b = Client(app_url)
    placed = buy(b, pid, "ST-A-1")
    assert refund(b, placed["id"], [placed["tickets"][0]["id"]]).status_code == 200
    subjects = {f"Your Halyard Hall tickets: order {placed['id']}": "receipt", f"Your refund: order {placed['id']}": "refund"}
    for subject in subjects:
        await_mail(mail, b.email, subject)
    poll(lambda: len(outbox_for(app_url, b.email)) == 2 and all(m["status"] == "sent" for m in outbox_for(app_url, b.email)),
         MAIL_DEADLINE_S, "outbox sent")
    listed = {m["subject"]: m["kind"] for m in outbox_for(app_url, b.email)}
    assert listed == subjects
    assert {m["Subject"] for m in inbox(mail, b.email)} == set(subjects)
    with browse(browser, app_url + "/owner") as page:
        sign_in_owner_ui(page)
        click(page.get_by_role("link", name="Outbox"))
        rows = page.get_by_role("table", name="Outbox").get_by_role("row").filter(has_text=b.email)
        expect(rows).to_have_count(2)
        for subject in subjects:
            expect(rows.filter(has_text=subject)).to_contain_text("Sent")


def test_wf_mail_receipt_ui(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    pid = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"])])["id"]
    name, email = unique("mailer")
    with browse(browser, map_url(app_url, pid)) as page:
        ready(page)
        choose_tier_by_keys(page, FRONT_PAIR)
        click(cell(page, "ST-A-15"))
        settled_wedge(page, "ST-A-15")
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        click(page.get_by_role("button", name="Checkout"))
        pay_in_dialog(page, name, email)
        dialog = page.get_by_role("dialog", name="Checkout")
        oid = confirmed_order_id(page, dialog)
        expect(dialog.get_by_role("region", name="Receipt")).to_contain_text(money(ONE_FRONT_TOTAL))
    assert [kb_cents(t["amount"]) for t in kb_tx(killbill.payment_by_key(oid), "PURCHASE")] == [ONE_FRONT_TOTAL]
    body = text(await_mail(mail, email, f"Your Halyard Hall tickets: order {oid}")[0])
    assert f"Total {money(ONE_FRONT_TOTAL)}" in body
    late = publish(app_url, [tier(FRONT_PAIR, FRONT_FACE, seats=["ST-A-15"])])["id"]
    late_name, late_email = unique("latemail")
    local, _, domain = late_email.partition("@")
    mixed = local.upper() + "@" + domain
    with gated_killbill() as (kb, gate), app_copy({"KILLBILL_URL": kb}) as slow:
        f = Client(slow)
        must_hold(f, late, "ST-A-15")
        worker, out = in_background(lambda: checkout(same_fan(slow, f), late, name=late_name, email=mixed))
        pending = order_where(f, "pending_payment")
        assert pending["receipt"] is None and inbox(mail, late_email) == []
        gate.set()
        worker.join()
        assert out["response"].status_code == 201, out["response"].text
        late_oid = out["response"].json()["order"]["id"]
        await_mail(mail, late_email, f"Your Halyard Hall tickets: order {late_oid}")
    account = killbill.account_by_key(mixed.lower())
    assert account and account["name"] == late_name and account["currency"] == "USD", account


def test_wf_mail_outage_ui(browser: Browser, app_url: str, mail: Any) -> None:
    down = env_url("APP_MAIL_DOWN_URL")
    pid = publish(app_url, standard_layout())["id"]
    name, email = unique("outage")
    with browse(browser, map_url(down, pid), viewport=PHONE) as page:
        ready(page)
        phone_stack(page)
        click(cell(page, "ST-A-8"))
        settled_wedge(page, "ST-A-8")
        click_settled(page.get_by_role("button", name="Hold selected seats"))
        click(page.get_by_role("button", name="Checkout"))
        pay_in_dialog(page, name, email)
        oid = confirmed_order_id(page, page.get_by_role("dialog", name="Checkout"))
        page.goto(app_url + "/owner")
        sign_in_owner_ui(page)
        click(page.get_by_role("link", name="Outbox"))
        row = page.get_by_role("table", name="Outbox").get_by_role("row").filter(has_text=email)
        eventually(page, lambda: expect(row).to_contain_text("Sent", timeout=EXPECT_STEP_MS), RETRY_DEADLINE_S)
    await_mail(mail, email, f"Your Halyard Hall tickets: order {oid}")


def test_health_and_seeded_service(app_url: str) -> None:
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["content-type"].startswith("application/json")
    ids = [p["id"] for p in Client(app_url).get("/api/performances").json()["performances"]]
    assert all(pid in ids for pid, *_ in SEED)
    pid = publish(app_url, standard_layout())["id"]
    fan = Client(app_url)
    assert fan.get(f"/api/performances/{pid}/cart").status_code == 200
    raced = limit_race(app_url, dict(fan.cookies), pid, [f"ST-A-{n}" for n in range(1, 6)], [f"ST-A-{n}" for n in range(6, 11)])
    assert sorted(r.status_code for r in raced) == [200, 422], [r.text for r in raced]
    assert field_of(next(r for r in raced if r.status_code == 422), "seatIds") == LIMIT_MSG
    assert len(fan.get(f"/api/performances/{pid}/cart").json()["seats"]) == 5


def test_server_boundary(browser: Browser, app_url: str) -> None:
    pid = publish(app_url, standard_layout())["id"]
    c = Client(app_url)
    holds = f"/api/performances/{pid}/holds"
    parts = urlsplit(app_url)
    own_origin = f"{parts.scheme}://{parts.netloc}"
    for method, body in (("POST", {"seatIds": ["ST-A-1"]}), ("GET", None)):
        r = c.request(method, holds if method == "POST" else "/api/performances", body, headers={"Origin": FOREIGN_ORIGIN})
        assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    assert seats(c, pid)["ST-A-1"]["state"] == "on_sale"
    ok = c.request("POST", holds, {"seatIds": ["ST-A-1"]}, headers={"Origin": own_origin})
    assert ok.status_code == 200, ok.text
    assert not [h for h in ok.headers if h.lower().startswith("access-control-")], dict(ok.headers)
    base = json.dumps({"seatIds": ["ST-A-2"], "note": ""})
    exact = json.dumps({"seatIds": ["ST-A-2"], "note": "x" * (BODY_LIMIT - len(base))}).encode()
    assert len(exact) == BODY_LIMIT
    assert c.request("POST", holds, raw=exact).status_code in (200, 422)
    over = json.dumps({"seatIds": ["ST-A-3"], "note": "x" * (BODY_LIMIT - len(base) + 1)}).encode()
    for path in (holds, "/api/owner/performances"):
        r = Client(app_url).request("POST", path, raw=over)
        assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}
    assert seats(c, pid)["ST-A-3"]["state"] == "on_sale"
    r = c.request("POST", holds, raw=b'{"seatIds":["ST-A-4"]}', headers={"Content-Type": "text/plain"})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}
    for path in (holds, "/api/owner/performances"):
        r = Client(app_url).request("POST", path, raw=b'{"seatIds": [')
        assert r.status_code == 400 and r.json() == {"error": "bad_json"}
    secrets = [v for k in ("DATABASE_URL", "KILLBILL_URL", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY")
               if (v := os.environ.get(k)) and len(v) >= SECRET_MIN_LEN]
    for path in ("/.env", "/run.json", "/package.json", "/.git/config", "/src/server.ts"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 404, path
        assert not any(s in r.text for s in secrets)
    served = []
    for path in ("/", "/tickets", "/owner", f"/p/{pid}"):
        html = httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).text
        served.append(html)
        for ref in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', html):
            served.append(httpx.get(app_url + ref, timeout=HTTP_TIMEOUT_S).text)
    served.append(c.get("/api/performances").text)
    assert not any(s in blob for s in secrets for blob in served)
    with browse(browser, app_url + "/.env") as page:
        for path in ("/.env", "/p/no-such-show", "/offers/no-such-token", "/nowhere"):
            page.goto(app_url + path)
            expect(page.get_by_role("heading", name=NOT_FOUND)).to_be_visible()
    for name in ("APP_KILLBILL_DOWN_URL", "APP_MAIL_DOWN_URL"):
        other = env_url(name)
        assert httpx.get(other + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
        assert Client(other).get("/api/performances").status_code == 200
    phone_pid = publish(app_url, standard_layout())["id"]
    with browse(browser, map_url(app_url, phone_pid), viewport=PHONE) as phone:
        ready(phone)
        phone_stack(phone)
        touch_targets(phone)


APP_ROOT = Path("/app")
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "out", ".vite", "coverage"}


def shipped_packages() -> dict[tuple[str, str], dict]:
    return {(p.name, p.version): {"license": p.licence} for p in kit_shipped_packages()}


def source_files() -> Iterator[Path]:
    for path in APP_ROOT.rglob("*"):
        if path.is_file() and not SKIP_DIRS.intersection(path.relative_to(APP_ROOT).parts):
            yield path


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for step in ("install", "build", "serve"):
        assert isinstance(manifest[step], str) and manifest[step].strip()


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{n}@{v}" for n, v in shipped_packages() if n not in notices or v not in notices]
    assert not missing, missing
    for font in ("Fraunces", "Public Sans"):
        assert font in notices


def test_if_licences_allowed() -> None:
    bad = [(name, version, info["license"]) for (name, version), info in shipped_packages().items()
           if not licence_allowed(info["license"], ALLOWED_LICENCES)]
    assert not bad, bad


def test_if_postgres_only() -> None:
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "lowdb", "nedb", "lmdb", "pouchdb", "@libsql/client"}
    assert not banned.intersection(n for n, _ in shipped_packages())
    files = [p for p in source_files() if p.suffix in (".sqlite", ".sqlite3", ".db", ".rdb")]
    assert not files, files


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    seen: list[str] = []
    with browse(browser, app_url + "/") as page:
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/", "/p/lantern-and-tide", "/tickets", "/owner"):
            page.goto(app_url + path)
            page.wait_for_load_state("load")
            observe_for(page, LIVE_UPDATE_S)
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_service_definitions_unchanged() -> None:
    defs = [p for p in source_files() if re.search(r"(^|-)compose[^/]*\.ya?ml$", p.name) or ".devcontainer" in p.parts]
    if (APP_ROOT / ".git").exists():
        for path in defs:
            rel = str(path.relative_to(APP_ROOT))
            log = subprocess.run(["git", "-C", str(APP_ROOT), "log", "--format=%H", "--", rel], capture_output=True, text=True)
            dirty = subprocess.run(["git", "-C", str(APP_ROOT), "status", "--porcelain", "--", rel], capture_output=True, text=True)
            assert len(log.stdout.split()) <= 1 and not dirty.stdout.strip(), rel
        return
    trajectory = Path("/logs/agent/trajectory.json")
    calls = trajectory.read_text() if trajectory.exists() else ""
    for path in defs:
        writes = re.findall(r'"(?:Write|Edit|MultiEdit|write_file|edit_file)"[^{}]{0,400}' + re.escape(path.name), calls)
        assert not writes, path


def test_if_typescript_sources() -> None:
    files = list(source_files())
    assert any(p.suffix in (".ts", ".tsx") for p in files)
    plain = [p for p in files if p.suffix in (".js", ".jsx", ".mjs", ".cjs")
             and not re.search(r"(\.config\.|^\.[\w-]+rc\.)", p.name)]
    assert not plain, plain
