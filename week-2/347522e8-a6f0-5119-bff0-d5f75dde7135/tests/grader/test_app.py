from __future__ import annotations

import json
import math
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
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from datetime import time as clock_time
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urljoin, urlparse, urlunparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    settle,
    shipped_packages,
    tab_order,
    text,
    unique,
)
from conftest import select as choose

PASSWORD = "Railside-demo-26"
OPERATOR_EMAIL = "marisol@brigadebench.example"
SHIFT_EMAIL = "dev@brigadebench.example"
INES_EMAIL = "ines@fennelstreet.example"
FENNEL = "Fennel Street Catering"
KITCHEN_NAME = "Brigade & Bench Commissary"
KITCHEN_ADDRESS = "1187 West Larkin Avenue, Chicago, IL 60622"
KITCHEN_ZONE = ZoneInfo("America/Chicago")
UTC = timezone.utc

CONV1, CONV2, DECK, MIXER, PREP = "Convection oven 1", "Convection oven 2", "Deck oven", "60-quart mixer", "Prep table 3"
STATION_NAMES = {"convection-1": CONV1, "convection-2": CONV2, "deck-oven": DECK, "mixer-60": MIXER, "prep-3": PREP}
KIND_LABEL = {"coi": "certificate of insurance", "food_handler_card": "food-handler card", "business_licence": "business licence"}
PACK_HOURS = (10, 20, 40)
PACK_NAMES = {n: f"{n}-hour pack" for n in PACK_HOURS}
CONV1_ID, CONV2_ID, DECK_ID, MIXER_ID, PREP_ID = "convection-1", "convection-2", "deck-oven", "mixer-60", "prep-3"
CONV_BUFFER = 30
DECK_BUFFER = 45
CONV_OVERAGE_USD = "48.00"
SESSION_COOKIE = "rs_session"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax", "Path=/")
PROBE_TOKEN = "anything"
PROBE_SHELF = "Shelf 4"
PROBE_UPLOAD_NAME = "../../a/b/ev..il.pdf"
PROBE_BAD_DATE = "nope"
URL_GLOB = "**"
SET_COOKIE = "set-cookie"
FOCUS_EVENT_JS = "() => window.dispatchEvent(new Event('focus'))"
HISTORY_LENGTH_JS = "() => history.length"
ACTIVE_ELEMENT_JS = "() => document.activeElement"
SAME_ELEMENT_JS = "h => h === document.activeElement"
CLIPBOARD_READ_JS = "() => navigator.clipboard.readText()"
CLIPBOARD_PERMISSIONS = ["clipboard-read", "clipboard-write"]
PACK_20_USD = "540.00"
WREN_OPENING_MINUTES = 1200

HOLD_TTL_SECONDS = 600
EXPIRY_RECORD_SECONDS = 5
REFRESH_MS = 15_000
PACK_CHECK_MS = 15_000
PACKS_LIMIT_S = 3
KILLBILL_TIMEOUT_S = 5
RENTER_READ_LIMIT_S = 3
JSON_LIMIT = 65_536
MULTIPART_LIMIT = 5_100_000
FILE_LIMIT = 5_000_000
NAME_MAX = 120
PHONE_MIN = 7
PHONE_MAX = 30
PASSWORD_MIN = 10
ORIGINAL_NAME_MAX = 120
LINK_LABEL_MAX = 80
LINK_MIN_SECONDS = 30
LINK_MAX_SECONDS = 2_592_000
ONE_DAY_SECONDS = 86_400
SEVEN_DAY_SECONDS = 604_800
EXPIRING_WINDOW_DAYS = 14
CUTOFF_DAYS = 2
MAX_AHEAD_DAYS = 366
TSCONFIG_EXTENDS_DEPTH = 16
SLOT_MINUTES = 15
OFF_PEAK_FROM = 22
OFF_PEAK_UNTIL = 6
STEP_PX = 12
PHONE_CELL_PX = 44
MIN_TARGET_PX = 44
GRID_CELLS = 96
STATEMENT_KEY = r"renters/{rid}/statements/{month}-[^/]+\.pdf"

APPLICATION_RECEIVED = "Application received. Upload your three documents to move to review."
DUPLICATE_EMAIL = "That email already has an account."
OUTAGE_COPY = "Pack purchases are unavailable right now. You can still book with the hours you already own."
AVAILABLE_AGAIN = "Pack purchases are available again."
CONFIRMED_COPY = "Booking confirmed. A confirmation email is on its way."
TAKEN_COPY = "That time is taken."
PLACING_COPY = "Placing hold…"
LOST_REMOVED = "Another renter claimed this time first. Your ticket was removed."
DEAD_LINK_HEADING = "This link is no longer active"
DEAD_LINK_BODY = "Ask the kitchen operator for a new link."

DESKTOP = (1280, 800)
PUBLISHED_SIZES = ((375, 812, "phone"), (768, 1024, "tablet"), (1280, 800, "desktop"))
EDGE_HEIGHT = 900
LAYOUT_SIZES = ((375, 812, "phone"), (767, EDGE_HEIGHT, "phone"), (768, 1024, "tablet"), (1199, EDGE_HEIGHT, "tablet"), (1200, EDGE_HEIGHT, "desktop"), (1280, 800, "desktop"))

HTTP_TIMEOUT_S = 30
UI_TIMEOUT_MS = 15_000
POLL_INTERVAL_S = 0.25
MAIL_WAIT_S = 90
MAIL_SETTLE_S = 0.5
DUPLICATE_WINDOW_S = 6
SCAN_WINDOW_S = 12
CLOCK_SLACK_S = 1.5
PX_TOLERANCE = 2
COLUMN_TOLERANCE_PX = 8
TAB_LIMIT = 60
TAB_WRAP_PRESSES = 10
FINDER_TRIES = 120
FIRST_OFFSET = 3
LAST_OFFSET = 300
COPY_BOOT_S = 180
COPY_STOP_S = 20
HEALTH_PROBE_S = 2
LOG_TAIL_BYTES = 4000
RELAY_CHUNK = 16_384
MIN_SECRET_LEN = 8
CLAIMANTS = 6
FRESH_EXPIRY_DAYS = 200
LICENCE_DAYS = 365
EXPIRING_PROBE_DAYS = 10
PROBE_PHONE = "312-555-0142"
UNKNOWN_ID = "00000000-0000-4000-8000-000000000000"
CROSS_ORIGIN = "http://cross-origin.example"
SKEWED_DEVICE_TIME = datetime(2031, 3, 9, 3, 30, tzinfo=UTC)
EARLY_DEVICE_TIME = datetime(2020, 1, 6, 9, 0, tzinfo=UTC)
PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 64
ISO_MS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

expect.set_options(timeout=UI_TIMEOUT_MS)


def poll(check: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        pause.wait(POLL_INTERVAL_S)
    result = check()
    if not result:
        pytest.fail(f"timed out after {seconds}s waiting for {what}")
    return result


def outage_url(env: str) -> str:
    url = os.environ.get(env)
    assert url, f"{env} is not set for this verifier"
    return url.rstrip("/")


def names(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    email = second if "@" in second else first if "@" in first else ""
    raw = first if email == second else second
    tag = (re.sub(r"[^A-Za-z0-9]", "", raw)[-10:] or "probe").lower()
    return tag, (email or f"{tag}@railside-probe.example").lower()


def client(base: str, cookies: httpx.Cookies | None = None) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S, follow_redirects=False, cookies=cookies)


def body(response: httpx.Response, status: int) -> Any:
    assert response.status_code == status, (
        f"{response.request.method} {response.request.url} answered {response.status_code}: {response.text[:800]}"
    )
    if status == 204 or not response.content:
        return None
    return response.json()


def error(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    data = body(response, status)
    assert data["error"] == code, data
    return data


def sign_in(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    api = client(base)
    body(api.post("/api/session", json={"email": email, "password": password}), 200)
    return api


def operator(base: str) -> httpx.Client:
    return sign_in(base, OPERATOR_EMAIL)


def kitchen_today(api: httpx.Client) -> date:
    return date.fromisoformat(body(api.get("/api/stations"), 200)["date"])


def server_now(api: httpx.Client) -> datetime:
    return parse_instant(body(api.get("/api/stations"), 200)["server_now"])


def parse_instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def instant(day: date, hhmm: str) -> datetime:
    if hhmm == "24:00":
        return datetime.combine(day + timedelta(days=1), clock_time(0), tzinfo=KITCHEN_ZONE).astimezone(UTC)
    hour, minute = (int(part) for part in hhmm.split(":"))
    return datetime.combine(day, clock_time(hour, minute), tzinfo=KITCHEN_ZONE).astimezone(UTC)


def zone_on(day: date, hhmm: str = "12:00") -> str:
    return instant(day, hhmm).astimezone(KITCHEN_ZONE).tzname() or ""


def local_stamp(value: str) -> str:
    local = parse_instant(value).astimezone(KITCHEN_ZONE)
    return f"{local:%Y-%m-%d %H:%M} {local.tzname()}"


def day_line(day: date) -> str:
    return f"{day.strftime('%A')} {day.isoformat()} · {zone_on(day)}"


def hours(minutes: int | Fraction) -> str:
    value = (Decimal(minutes.numerator) / Decimal(minutes.denominator) if isinstance(minutes, Fraction) else Decimal(minutes)) / Decimal(60)
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def hours_re(value: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![0-9.]){re.escape(value)} h")


def price(day: date, start: str, end: str, weight: int, off_peak_percent: int) -> int:
    moment = instant(day, start).astimezone(UTC)
    stop = instant(day, end).astimezone(UTC)
    total = Fraction(0)
    while moment < stop:
        local = moment.astimezone(KITCHEN_ZONE)
        rate = off_peak_percent if (local.hour >= OFF_PEAK_FROM or local.hour < OFF_PEAK_UNTIL) else 100
        total += Fraction(SLOT_MINUTES * weight * rate, 100)
        moment += timedelta(minutes=SLOT_MINUTES)
    return math.ceil(total)


def dst_changes(today: date) -> tuple[date | None, date | None]:
    found: dict[str, date] = {}
    for n in range(1, MAX_AHEAD_DAYS + 1):
        day = today + timedelta(days=n)
        before = instant(day, "00:00").astimezone(KITCHEN_ZONE).utcoffset()
        after = instant(day, "04:00").astimezone(KITCHEN_ZONE).utcoffset()
        assert before is not None and after is not None
        if after > before:
            found.setdefault("spring", day)
        if after < before:
            found.setdefault("autumn", day)
    return found.get("spring"), found.get("autumn")


@dataclass
class Renter:
    api: httpx.Client
    id: str
    email: str
    business: str
    contact: str
    phone: str
    password: str


def apply_renter(base: str, prefix: str = "renter") -> Renter:
    tag, email = names(prefix)
    renter = Renter(client(base), "", email, f"Test Pantry {tag}", f"Cook {tag}", PROBE_PHONE, f"Probe-pass-{tag}")
    data = body(renter.api.post("/api/applications", json={
        "business_name": renter.business, "contact_name": renter.contact, "email": email,
        "phone": renter.phone, "password": renter.password,
    }), 201)
    renter.id = str(data["renter"]["id"])
    return renter


def upload(api: httpx.Client, rid: str, kind: str, expires_on: str | None, content: bytes = PDF_BYTES,
           filename: str = "scan.pdf", content_type: str = "application/pdf") -> httpx.Response:
    fields = {"kind": kind}
    if expires_on is not None:
        fields["expires_on"] = expires_on
    return api.post(f"/api/renters/{rid}/documents", data=fields, files={"file": (filename, content, content_type)})


def review(op: httpx.Client, document_id: Any, decision: str = "approve") -> httpx.Response:
    return op.post(f"/api/documents/{document_id}/review", json={"decision": decision})


def grant(op: httpx.Client, rid: str, minutes: int) -> None:
    body(op.post(f"/api/renters/{rid}/adjustments", json={"minutes": minutes, "reason": "verifier hours"}), 201)


def active_renter(base: str, minutes: int = 0, coi_days: int = FRESH_EXPIRY_DAYS, card_days: int = FRESH_EXPIRY_DAYS) -> Renter:
    renter = apply_renter(base)
    op = operator(base)
    today = kitchen_today(op)
    for kind, days in (("coi", coi_days), ("food_handler_card", card_days), ("business_licence", LICENCE_DAYS)):
        document = body(upload(renter.api, renter.id, kind, (today + timedelta(days=days)).isoformat()), 201)["document"]
        body(review(op, document["id"]), 200)
    body(op.post(f"/api/renters/{renter.id}/transitions", json={"to": "active"}), 200)
    if minutes:
        grant(op, renter.id, minutes)
    return renter


def renter_view(api: httpx.Client, rid: str) -> dict[str, Any]:
    return body(api.get(f"/api/renters/{rid}"), 200)["renter"]


def ledger(api: httpx.Client, rid: str) -> dict[str, Any]:
    return body(api.get(f"/api/renters/{rid}/ledger"), 200)


def seeded_renter(op: httpx.Client, business: str) -> dict[str, Any]:
    rows = body(op.get("/api/renters"), 200)["renters"]
    match = [row for row in rows if row["business_name"] == business]
    assert len(match) == 1, f"seeded renter {business} missing"
    return renter_view(op, str(match[0]["id"]))


def book(api: httpx.Client, station: str, day: date, start: str, end: str, repeat: int | None = None) -> httpx.Response:
    payload: dict[str, Any] = {"station_id": station, "date": day.isoformat(), "start": start, "end": end}
    if repeat is not None:
        payload["repeat_weeks"] = repeat
    return api.post("/api/bookings", json=payload)


def act(api: httpx.Client, booking_id: Any, action: str, payload: dict[str, Any] | None = None) -> httpx.Response:
    return api.post(f"/api/bookings/{booking_id}/{action}", json=payload or {})


def booking_of(api: httpx.Client, booking_id: Any) -> dict[str, Any]:
    return body(api.get(f"/api/bookings/{booking_id}"), 200)["booking"]


def own_bookings(api: httpx.Client, day: date) -> list[dict[str, Any]]:
    return body(api.get("/api/bookings", params={"date": day.isoformat()}), 200)["bookings"]


def release_all(api: httpx.Client, booking_ids: list[Any]) -> None:
    for booking_id in booking_ids:
        act(api, booking_id, "release")


def station_blocks(api: httpx.Client, day: date) -> dict[str, list[dict[str, Any]]]:
    data = body(api.get("/api/stations", params={"date": day.isoformat()}), 200)
    return {station["id"]: station["blocks"] for station in data["stations"]}


def free_days(api: httpx.Client, station: str, weeks: int = 1) -> list[date]:
    today = kitchen_today(api)
    rng = random.Random()
    for _ in range(FINDER_TRIES):
        first = today + timedelta(days=rng.randint(FIRST_OFFSET, LAST_OFFSET))
        days = [first + timedelta(weeks=n) for n in range(weeks)]
        if all(not station_blocks(api, day)[station] for day in days):
            return days
    raise AssertionError(f"no free day found for {station}")


def empty_board_day(api: httpx.Client) -> date:
    today = kitchen_today(api)
    rng = random.Random()
    for _ in range(FINDER_TRIES):
        day = today + timedelta(days=rng.randint(FIRST_OFFSET, LAST_OFFSET))
        if all(not blocks for blocks in station_blocks(api, day).values()):
            return day
    raise AssertionError("no empty board day found")


def idle_station(api: httpx.Client, days: list[date], among: tuple[str, ...]) -> str:
    for station in among:
        if all(not station_blocks(api, day)[station] for day in days):
            return station
    raise AssertionError(f"none of {among} is free on {days}")


def movements(data: dict[str, Any], rid: str) -> dict[Any, list[dict[str, Any]]]:
    grouped: dict[Any, list[dict[str, Any]]] = {}
    for entry in data["entries"]:
        grouped.setdefault(entry["movement_id"], []).append(entry)
    for movement_id, pair in grouped.items():
        debits = [e for e in pair if e["direction"] == "debit"]
        credits = [e for e in pair if e["direction"] == "credit"]
        assert len(pair) == 2 and len(debits) == 1 and len(credits) == 1, (movement_id, pair)
        assert debits[0]["minutes"] == credits[0]["minutes"] > 0, pair
        assert debits[0]["account"] != credits[0]["account"], pair
    available, held_account = f"renter:{rid}:available", f"renter:{rid}:held"

    def total(account: str) -> int:
        return sum(e["minutes"] if e["direction"] == "credit" else -e["minutes"] for e in data["entries"] if e["account"] == account)

    assert total(available) == data["balance_minutes"], data
    assert total(held_account) == data["held_minutes"], data
    return grouped


def movement_kinds(data: dict[str, Any], rid: str) -> list[str]:
    seen: list[str] = []
    for pair in movements(data, rid).values():
        seen.append(pair[0]["kind"])
    return seen


def pair_of(data: dict[str, Any], rid: str, kind: str) -> tuple[dict[str, Any], dict[str, Any]]:
    for pair in movements(data, rid).values():
        if pair[0]["kind"] == kind:
            debit = next(e for e in pair if e["direction"] == "debit")
            credit = next(e for e in pair if e["direction"] == "credit")
            return debit, credit
    raise AssertionError(f"no {kind} movement in {data['entries']}")


def mails_to(mail: Any, to: str, subject: str, settle_s: float = MAIL_SETTLE_S) -> list[dict[str, Any]]:
    found = []
    for message in mail.messages(settle=settle_s):
        recipients = [address.lower() for address in addresses(message.get("To"))]
        if to.lower() in recipients and message.get("Subject") == subject:
            found.append(message)
    return found


def await_mail(mail: Any, to: str, subject: str, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    return poll(lambda: mails_to(mail, to, subject), seconds, f"mail {subject!r} to {to}")


def series_mails(mail: Any, to: str, station: str, days: list[date], settle_s: float = MAIL_SETTLE_S) -> list[dict[str, Any]]:
    subjects = {f"Booking confirmed: {station} on {d.isoformat()}" for d in days}
    found = []
    for message in mail.messages(settle=settle_s):
        recipients = [address.lower() for address in addresses(message.get("To"))]
        if to.lower() in recipients and message.get("Subject") in subjects:
            found.append(message)
    return found


def await_series_mail(mail: Any, to: str, station: str, days: list[date]) -> list[dict[str, Any]]:
    return poll(lambda: series_mails(mail, to, station, days), MAIL_WAIT_S, f"series confirmation to {to}")


def purchase_payments(killbill: Any, rid: str) -> list[dict[str, Any]]:
    account = killbill.account_by_key(f"renter-{rid}")
    if account is None:
        return []
    return [p for p in killbill.payments(account["accountId"])
            if any(t.get("transactionType") == "PURCHASE" for t in p.get("transactions", []))]


def invoice_items(killbill: Any, rid: str) -> list[dict[str, Any]]:
    account = killbill.account_by_key(f"renter-{rid}")
    assert account is not None, "renter has no Kill Bill account"
    items: list[dict[str, Any]] = []
    for invoice in killbill.invoices(account["accountId"]):
        items.extend(invoice.get("items", []))
    return items


@contextmanager
def browser_page(browser: Browser, base: str, email: str | None = None, password: str = PASSWORD, *, path: str | None = None,
                 size: tuple[int, int] = DESKTOP, reduced: bool = True, device_time: datetime | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if device_time is not None:
            page.clock.set_system_time(device_time)
        if email is not None:
            response = page.request.post(base + "/api/session", data={"email": email, "password": password})
            assert response.status == 200, response.text()
        if path is not None or email is not None:
            page.goto(base + (path or "/"))
        yield page


def sign_in_ui(page: Page, email: str, password: str = PASSWORD) -> None:
    form = page.get_by_role("form", name="Sign in", exact=True)
    fill(form.get_by_role("textbox", name="Email", exact=True), email)
    fill(form.get_by_label("Password", exact=True), password)
    click(form.get_by_role("button", name="Sign in", exact=True))


def open_board(page: Page, base: str, day: date) -> None:
    page.goto(f"{base}/board?date={day.isoformat()}")
    expect(page.get_by_role("grid", name=f"{CONV1} schedule", exact=True)).to_be_visible()
    page.wait_for_load_state("networkidle")


def cell(page: Page, station: str, hhmm: str) -> Locator:
    grid = page.get_by_role("grid", name=f"{station} schedule", exact=True)
    return grid.get_by_role("gridcell", name=f"{station} {hhmm}", exact=True)


def docket(page: Page) -> Locator:
    return page.get_by_role("complementary", name="Docket", exact=True)


def balance_status(page: Page) -> Locator:
    return docket(page).get_by_role("status", name="Hour balance", exact=True)


def announcer(page: Page) -> Locator:
    return page.get_by_role("status", name="Sweep announcer", exact=True)


def booking_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Booking status", exact=True)


def is_focused(locator: Locator) -> bool:
    return bool(locator.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"))


def focus_cell(page: Page, station: str, hhmm: str) -> None:
    start = cell(page, station, "06:00")
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if is_focused(start):
            break
    else:
        raise AssertionError(f"Tab never reached {station} 06:00")
    hour, minute = (int(part) for part in hhmm.split(":"))
    steps = (hour * 60 + minute - 6 * 60) // SLOT_MINUTES
    for _ in range(abs(steps)):
        page.keyboard.press("ArrowRight" if steps > 0 else "ArrowLeft")
    expect(cell(page, station, hhmm)).to_be_focused()


def shift_right(page: Page, presses: int) -> None:
    for _ in range(presses):
        page.keyboard.press("Shift+ArrowRight")


def mark_point(page: Page, station: str, hhmm: str) -> tuple[float, float]:
    box = cell(page, station, hhmm).bounding_box()
    assert box is not None
    return box["x"] + 1, box["y"] + box["height"] / 2


def box_of(locator: Locator) -> dict[str, float]:
    box = locator.bounding_box()
    assert box is not None, "element has no box"
    return box


def no_enabled_confirm(page: Page) -> None:
    confirm = docket(page).get_by_role("button", name="Confirm booking", exact=True)
    assert confirm.count() == 0 or confirm.is_disabled()


def column_count(boxes: list[dict[str, float]]) -> int:
    columns: list[list[float]] = []
    for box in boxes:
        left, right = box["x"], box["x"] + box["width"]
        for column in columns:
            overlap = min(right, column[1]) - max(left, column[0])
            if overlap > min(right - left, column[1] - column[0]) / 2:
                column[0], column[1] = min(left, column[0]), max(right, column[1])
                break
        else:
            columns.append([left, right])
    return len(columns)


def countdown_seconds(timer: Locator) -> int:
    value = (timer.text_content() or "").strip()
    match = re.fullmatch(r"(\d\d):(\d\d)", value)
    assert match, f"countdown reads {value!r}"
    return int(match.group(1)) * 60 + int(match.group(2))


def plus(hhmm: str, minutes: int) -> str:
    hour, minute = (int(part) for part in hhmm.split(":"))
    total = hour * 60 + minute + minutes
    return f"{total // 60:02d}:{total % 60:02d}"


def draft_ticket(page: Page, start: str, end: str) -> Locator:
    return page.get_by_role("img", name=f"Draft ticket {start} to {end}", exact=True)


def booked_ticket(page: Page, start: str, end: str) -> Locator:
    return page.get_by_role("img", name=f"Booked {start} to {end}", exact=True)


def buffer_tail(page: Page, until: str) -> Locator:
    return page.get_by_role("img", name=f"Buffer until {until}", exact=True)


def maintenance_block(page: Page, start: str, end: str) -> Locator:
    return page.get_by_role("img", name=f"Maintenance {start} to {end}", exact=True)


def step_copy(station: str, start: str, end: str, minutes: int, buffer_minutes: int) -> str:
    return f"{station}, {start} to {end}, {hours(minutes)} hours, buffer until {plus(end, buffer_minutes)}."


def stop_copy(end: str, reason: str) -> str:
    return f"Can't extend past {end}: {reason}."


def weeks_label(count: int) -> str:
    return f"× {count} weeks"


class Relay:

    def __init__(self, target: tuple[str, int]) -> None:
        self.target = target
        self.forwarding = False
        self.lock = threading.Lock()
        self.sockets: list[socket.socket] = []
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(64)
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self.listener.accept()
            except OSError:
                return
            with self.lock:
                self.sockets.append(conn)
                forwarding = self.forwarding
            if forwarding:
                threading.Thread(target=self._bridge, args=(conn,), daemon=True).start()

    def _bridge(self, conn: socket.socket) -> None:
        try:
            upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
        except OSError:
            conn.close()
            return
        upstream.settimeout(None)
        with self.lock:
            self.sockets.append(upstream)

        def pump(source: socket.socket, sink: socket.socket) -> None:
            try:
                while chunk := source.recv(RELAY_CHUNK):
                    sink.sendall(chunk)
            except OSError:
                pass
            finally:
                for end in (source, sink):
                    try:
                        end.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass

        threading.Thread(target=pump, args=(conn, upstream), daemon=True).start()
        pump(upstream, conn)

    def set_forwarding(self, on: bool) -> None:
        with self.lock:
            self.forwarding = on
            stale, self.sockets = self.sockets, []
        for sock in stale:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()

    def stop(self) -> None:
        try:
            self.listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.listener.close()
        self.set_forwarding(False)


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    manifest = json.loads(Path("/app/run.json").read_text())
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    process = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                               stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_bytes()[-LOG_TAIL_BYTES:].decode(errors="replace")

    try:
        deadline = time.monotonic() + COPY_BOOT_S
        healthy = False
        while not healthy and time.monotonic() < deadline:
            try:
                healthy = httpx.get(base + "/api/health", timeout=HEALTH_PROBE_S).status_code == 200
            except httpx.HTTPError:
                healthy = False
            if healthy:
                break
            try:
                process.wait(timeout=POLL_INTERVAL_S)
                raise AssertionError(f"app copy exited with {process.returncode}:\n{tail()}")
            except subprocess.TimeoutExpired:
                pass
        if not healthy:
            pytest.fail(f"app copy never answered GET /api/health with 200 within {COPY_BOOT_S}s:\n{tail()}")
        yield base
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=COPY_STOP_S)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        log.close()


def short_url() -> str:
    return outage_url("APP_SHORT_URL")


def billing_down_url() -> str:
    return outage_url("APP_KILLBILL_DOWN_URL")


def mail_down_url() -> str:
    return outage_url("APP_MAILPIT_DOWN_URL")


def pdf_payload(name: str = "scan.pdf") -> dict[str, Any]:
    return {"name": name, "mimeType": "application/pdf", "buffer": PDF_BYTES}


DOC_PLAN = (("coi", FRESH_EXPIRY_DAYS), ("food_handler_card", FRESH_EXPIRY_DAYS), ("business_licence", LICENCE_DAYS))


def test_wf_onboarding_apply_to_active(browser: Browser, app_url: str) -> None:
    tag, email = names("apply")
    business, password = f"Test Pantry {tag}", f"Probe-pass-{tag}"
    op = operator(app_url)
    today = kitchen_today(op)
    with browser_page(browser, app_url, path="/apply") as page:
        form = page.get_by_role("form", name="Apply", exact=True)
        fill(form.get_by_role("textbox", name="Business name", exact=True), business)
        fill(form.get_by_role("textbox", name="Your name", exact=True), f"Cook {tag}")
        fill(form.get_by_role("textbox", name="Email", exact=True), email)
        fill(form.get_by_role("textbox", name="Phone", exact=True), PROBE_PHONE)
        fill(form.get_by_label("Password", exact=True), password)
        click(form.get_by_role("button", name="Submit application", exact=True))
        expect(page).to_have_url(re.compile(r"/kitchen$"))
        expect(page.get_by_role("heading", name="My kitchen", exact=True)).to_be_focused()
        expect(page.get_by_role("status", name="Application status", exact=True)).to_have_text(APPLICATION_RECEIVED)
        me = page.request.get(app_url + "/api/me").json()["user"]
        assert me["role"] == "renter" and me["renter_status"] == "applied", me
        rid = str(me["renter_id"])
        documents = page.get_by_role("region", name="Documents", exact=True)
        for kind, days in DOC_PLAN:
            label = KIND_LABEL[kind]
            choose(documents.get_by_role("combobox", name="Document type", exact=True), label)
            fill(documents.get_by_role("textbox", name="Expiry date", exact=True), (today + timedelta(days=days)).isoformat())
            documents.get_by_label("Scan file", exact=True).set_input_files(files=[pdf_payload()])
            click(documents.get_by_role("button", name="Upload document", exact=True))
            expect(page.get_by_role("status", name="Upload status", exact=True)).to_have_text(f"{label} uploaded. It's waiting for review.")
            expect(documents.get_by_role("link", name=f"View {label}", exact=True)).to_be_visible()
        expect(documents.get_by_text("Waiting for review", exact=True)).to_have_count(3)
        assert page.request.get(app_url + "/api/me").json()["user"]["renter_status"] == "documents_review"
    keys = S3().keys(f"renters/{rid}/documents/")
    assert len(keys) == 3 and all(re.fullmatch(rf"renters/{re.escape(rid)}/documents/[^/]+\.pdf", k) for k in keys), keys
    with browser_page(browser, app_url) as page:
        sign_in_ui(page, OPERATOR_EMAIL)
        expect(page).to_have_url(re.compile(r"/operator$"))
        click(page.get_by_role("table", name="Renters", exact=True).get_by_role("button", name=f"Review {business}", exact=True))
        dialog = page.get_by_role("dialog", name=f"Review {business}", exact=True)
        status = page.get_by_role("status", name="Operator status", exact=True)
        for kind, _ in DOC_PLAN:
            label = KIND_LABEL[kind]
            click(dialog.get_by_role("button", name=f"Approve {label}", exact=True))
            expect(status).to_have_text(f"{label} approved.")
        click(dialog.get_by_role("button", name="Activate renter", exact=True))
        expect(status).to_have_text("Renter activated.")
    assert renter_view(op, rid)["status"] == "active"
    with browser_page(browser, app_url) as page:
        sign_in_ui(page, email, password)
        expect(page).to_have_url(re.compile(rf"/board\?date={today.isoformat()}$"))
        expect(docket(page)).to_contain_text("Compliance: current")


def test_wf_onboarding_invalid_application(browser: Browser, app_url: str) -> None:
    existing = apply_renter(app_url)
    tag, email = names("retry")
    with browser_page(browser, app_url, path="/apply") as page:
        form = page.get_by_role("form", name="Apply", exact=True)
        fill(form.get_by_role("textbox", name="Business name", exact=True), f"Test Pantry {tag}")
        fill(form.get_by_role("textbox", name="Your name", exact=True), f"Cook {tag}")
        fill(form.get_by_role("textbox", name="Email", exact=True), existing.email)
        fill(form.get_by_role("textbox", name="Phone", exact=True), PROBE_PHONE)
        fill(form.get_by_label("Password", exact=True), f"Probe-pass-{tag}")
        click(form.get_by_role("button", name="Submit application", exact=True))
        expect(form.get_by_text(DUPLICATE_EMAIL, exact=True)).to_be_visible()
        expect(page).to_have_url(re.compile(r"/apply$"))
        fill(form.get_by_role("textbox", name="Email", exact=True), email)
        click(form.get_by_role("button", name="Submit application", exact=True))
        expect(page).to_have_url(re.compile(r"/kitchen$"))
    assert body(sign_in(app_url, email, f"Probe-pass-{tag}").get("/api/me"), 200)["user"]["renter_status"] == "applied"

    tag2, email2 = names("api-apply")
    good = {"business_name": f"Test Pantry {tag2}", "contact_name": f"Cook {tag2}", "email": email2,
            "phone": PROBE_PHONE, "password": f"Probe-pass-{tag2}"}
    anon = client(app_url)
    response = anon.post("/api/applications", json=good)
    data = body(response, 201)
    assert data["renter"]["status"] == "applied" and data["user"]["email"] == email2
    cookies = [c for c in response.headers.get_list(SET_COOKIE) if c.startswith(f"{SESSION_COOKIE}=")]
    assert cookies, response.headers
    lowered = cookies[0].lower()
    assert all(flag.lower() in lowered for flag in COOKIE_FLAGS)
    assert body(anon.get("/api/me"), 200)["user"]["renter_status"] == "applied"
    bad = [("business_name", ""), ("business_name", "x" * (NAME_MAX + 1)), ("contact_name", ""),
           ("contact_name", "x" * (NAME_MAX + 1)), ("phone", "1" * (PHONE_MIN - 1)), ("phone", "1" * (PHONE_MAX + 1)),
           ("password", "p" * (PASSWORD_MIN - 1))]
    for field, value in bad:
        tag3, email3 = names("bad-apply")
        payload = {**good, "email": email3, field: value}
        data = error(client(app_url).post("/api/applications", json=payload), 422, "validation")
        assert data["errors"].get(field), (field, data)
        error(client(app_url).post("/api/session", json={"email": email3, "password": payload["password"]}), 401, "invalid_credentials")
    data = error(client(app_url).post("/api/applications", json={**good, "email": existing.email}), 422, "validation")
    assert data["errors"]["email"] == DUPLICATE_EMAIL


def test_upload_content_checks(app_url: str) -> None:
    renter = apply_renter(app_url)
    today = kitchen_today(renter.api)
    future = (today + timedelta(days=FRESH_EXPIRY_DAYS)).isoformat()
    store = S3()
    prefix = f"renters/{renter.id}/documents/"
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    rejected = [
        ("coi", future, svg, "scan.svg", "image/svg+xml", 415, "unsupported_type", None),
        ("coi", future, b'<svg xmlns="http://www.w3.org/2000/svg"/>', "scan.pdf", "application/pdf", 415, "unsupported_type", None),
        ("coi", future, b"<html><body>scan</body></html>", "scan.pdf", "application/pdf", 415, "unsupported_type", None),
        ("coi", future, b"PK\x03\x04" + b"\x00" * 64, "scan.pdf", "application/pdf", 415, "unsupported_type", None),
        ("coi", future, b"%PDF-" + b"0" * (FILE_LIMIT + 1 - 5), "scan.pdf", "application/pdf", 413, "file_too_large", None),
        ("coi", future, b"%PDF-" + b"0" * (MULTIPART_LIMIT + 1), "scan.pdf", "application/pdf", 413, "payload_too_large", None),
        ("coi", future, b"", "scan.pdf", "application/pdf", 422, "validation", "file"),
        ("passport", future, PDF_BYTES, "scan.pdf", "application/pdf", 422, "validation", "kind"),
        ("coi", None, PDF_BYTES, "scan.pdf", "application/pdf", 422, "validation", "expires_on"),
        ("coi", (today - timedelta(days=1)).isoformat(), PDF_BYTES, "scan.pdf", "application/pdf", 422, "validation", "expires_on"),
    ]
    for kind, expires, content, filename, ctype, status, code, field in rejected:
        data = error(upload(renter.api, renter.id, kind, expires, content, filename, ctype), status, code)
        if field:
            assert data["errors"].get(field), data
    assert store.keys(prefix) == []
    assert body(renter.api.get("/api/me"), 200)["user"]["renter_status"] == "applied"

    exact = b"%PDF-" + b"0" * (FILE_LIMIT - 5)
    pdf = body(upload(renter.api, renter.id, "coi", future, exact, PROBE_UPLOAD_NAME, "image/png"), 201)["document"]
    assert pdf["status"] == "pending_review" and pdf["kind"] == "coi" and pdf["expires_on"] == future
    assert pdf["size_bytes"] == FILE_LIMIT and pdf["original_name"] == PROBE_UPLOAD_NAME.rsplit("/", 1)[-1].replace("..", ""), pdf
    pdf_key = f"{prefix}{pdf['id']}.pdf"
    assert store.keys(prefix) == [pdf_key] and store.get(pdf_key) == exact
    png = body(upload(renter.api, renter.id, "business_licence", None, PNG_BYTES, "y" * (ORIGINAL_NAME_MAX + 30) + ".pdf", "application/pdf"), 201)["document"]
    assert len(png["original_name"]) == ORIGINAL_NAME_MAX and "/" not in png["original_name"]
    assert store.get(f"{prefix}{png['id']}.png") == PNG_BYTES
    assert body(renter.api.get("/api/me"), 200)["user"]["renter_status"] == "applied"
    jpg = body(upload(renter.api, renter.id, "food_handler_card", future, JPEG_BYTES, "card.png", "image/png"), 201)["document"]
    assert store.get(f"{prefix}{jpg['id']}.jpg") == JPEG_BYTES
    assert sorted(store.keys(prefix)) == sorted([pdf_key, f"{prefix}{png['id']}.png", f"{prefix}{jpg['id']}.jpg"])
    assert body(renter.api.get("/api/me"), 200)["user"]["renter_status"] == "documents_review"


def test_renter_and_document_transitions(app_url: str) -> None:
    op = operator(app_url)
    renter = apply_renter(app_url)
    today = kitchen_today(op)
    future = (today + timedelta(days=FRESH_EXPIRY_DAYS)).isoformat()
    data = error(op.post(f"/api/renters/{renter.id}/transitions", json={"to": "active"}), 409, "invalid_transition")
    assert data["from"] == "applied" and data["to"] == "active"
    docs = {}
    for kind in ("coi", "food_handler_card"):
        docs[kind] = body(upload(renter.api, renter.id, kind, future), 201)["document"]
    assert renter_view(op, renter.id)["status"] == "applied"
    docs["business_licence"] = body(upload(renter.api, renter.id, "business_licence", None), 201)["document"]
    assert renter_view(op, renter.id)["status"] == "documents_review"
    error(op.post(f"/api/renters/{renter.id}/transitions", json={"to": "active"}), 409, "documents_incomplete")
    error(review(renter.api, docs["coi"]["id"]), 403, "forbidden")
    for document in docs.values():
        reviewed = body(review(op, document["id"]), 200)
        assert reviewed["document"]["status"] == "approved"
    data = error(review(op, docs["coi"]["id"], "reject"), 409, "invalid_transition")
    assert data["from"] == "approved"
    rejected = body(upload(renter.api, renter.id, "coi", future), 201)["document"]
    assert body(review(op, rejected["id"], "reject"), 200)["document"]["status"] == "rejected"
    error(review(op, rejected["id"]), 409, "invalid_transition")
    for target in ("suspended", "applied", "documents_review"):
        data = error(op.post(f"/api/renters/{renter.id}/transitions", json={"to": target}), 409, "invalid_transition")
        assert data["from"] == "documents_review" and data["to"] == target
    assert body(op.post(f"/api/renters/{renter.id}/transitions", json={"to": "active"}), 200)["renter"]["status"] == "active"
    data = error(op.post(f"/api/renters/{renter.id}/transitions", json={"to": "suspended"}), 409, "invalid_transition")
    assert data["from"] == "active"
    grant(op, renter.id, 600)
    day = free_days(renter.api, "convection-2")[0]
    hold = body(book(renter.api, "convection-2", day, "09:00", "10:00"), 201)["bookings"][0]
    error(op.post(f"/api/renters/{renter.id}/transitions", json={"to": "offboarded"}), 409, "has_future_bookings")
    assert renter_view(op, renter.id)["status"] == "active"
    body(act(renter.api, hold["id"], "release"), 200)
    assert body(op.post(f"/api/renters/{renter.id}/transitions", json={"to": "offboarded"}), 200)["renter"]["status"] == "offboarded"
    data = error(op.post(f"/api/renters/{renter.id}/transitions", json={"to": "active"}), 409, "invalid_transition")
    assert data["from"] == "offboarded"
    error(upload(renter.api, renter.id, "coi", future), 409, "renter_offboarded")
    error(book(renter.api, "convection-2", day, "09:00", "10:00"), 409, "renter_not_active")


def test_object_level_authorization(app_url: str) -> None:
    owner = active_renter(app_url, minutes=600)
    other = active_renter(app_url, minutes=600)
    day = free_days(owner.api, "convection-2")[0]
    hold = body(book(owner.api, "convection-2", day, "09:00", "10:00"), 201)["bookings"][0]
    document = body(owner.api.get(f"/api/renters/{owner.id}/documents"), 200)["documents"][0]
    month = kitchen_today(owner.api).strftime("%Y-%m")
    statement = body(owner.api.post(f"/api/renters/{owner.id}/statements", json={"month": month}), 201)["statement"]
    theirs = {"renter": owner.id, "booking": hold["id"], "document": document["id"], "statement": statement["id"]}
    unknown = {key: UNKNOWN_ID for key in theirs}
    routes = [
        ("GET", "/api/renters/{renter}", None), ("GET", "/api/renters/{renter}/ledger", None),
        ("GET", "/api/renters/{renter}/documents", None), ("GET", "/api/renters/{renter}/statements", None),
        ("POST", "/api/renters/{renter}/statements", {"month": month}),
        ("GET", "/api/documents/{document}", None), ("GET", "/api/documents/{document}/file", None),
        ("GET", "/api/bookings/{booking}", None), ("POST", "/api/bookings/{booking}/confirm", {}),
        ("POST", "/api/bookings/{booking}/release", {}), ("POST", "/api/bookings/{booking}/cancel", {}),
        ("GET", "/api/statements/{statement}/file", None),
    ]
    for method, path, payload in routes:
        foreign = other.api.request(method, path.format(**theirs), json=payload)
        missing = other.api.request(method, path.format(**unknown), json=payload)
        assert foreign.status_code == missing.status_code == 404, (path, foreign.text, missing.text)
        assert foreign.json() == missing.json() == {"error": "not_found"}, path
    foreign_upload = upload(other.api, owner.id, "coi", (kitchen_today(other.api) + timedelta(days=FRESH_EXPIRY_DAYS)).isoformat())
    error(foreign_upload, 404, "not_found")
    assert booking_of(owner.api, hold["id"])["status"] == "hold"
    assert len(body(owner.api.get(f"/api/renters/{owner.id}/statements"), 200)["statements"]) == 1
    assert len(body(owner.api.get(f"/api/renters/{owner.id}/documents"), 200)["documents"]) == 3
    body(act(owner.api, hold["id"], "release"), 200)


def test_sign_in_roles_and_precedence(app_url: str) -> None:
    for email, role in ((OPERATOR_EMAIL, "operator"), (SHIFT_EMAIL, "shift_lead")):
        user = body(sign_in(app_url, email).get("/api/me"), 200)["user"]
        assert user["role"] == role and user["renter_status"] is None and user["email"] == email
    renter = active_renter(app_url)
    user = body(renter.api.get("/api/me"), 200)["user"]
    assert user["role"] == "renter" and str(user["renter_id"]) == renter.id and user["renter_status"] == "active"
    applied = apply_renter(app_url)
    assert body(sign_in(app_url, applied.email, applied.password).get("/api/me"), 200)["user"]["renter_status"] == "applied"
    anon = client(app_url)
    error(anon.post("/api/session", json={"email": OPERATOR_EMAIL, "password": PASSWORD + "x"}), 401, "invalid_credentials")
    error(anon.get("/api/me"), 401, "unauthenticated")
    error(anon.post("/api/session", content=b"email", headers={"content-type": "text/plain"}), 415, "unsupported_media_type")
    settings = {"effective_from": "2027-01-01", "hour_weight": 1, "off_peak_percent": 50, "overage_usd_per_hour": "48.00", "buffer_minutes": 30}
    oversized = b'{"pad":"' + b"x" * JSON_LIMIT + b'"}'
    error(anon.post("/api/stations/oven-9/settings", content=oversized, headers={"content-type": "application/json", "origin": CROSS_ORIGIN}), 413, "payload_too_large")
    error(anon.post("/api/stations/oven-9/settings", json=settings, headers={"origin": CROSS_ORIGIN}), 403, "cross_origin")
    error(anon.post(f"/api/share/{PROBE_TOKEN}", content=b"x", headers={"content-type": "text/plain"}), 405, "read_only")
    error(anon.post("/api/stations/oven-9/settings", json=settings), 401, "unauthenticated")
    error(renter.api.post("/api/stations/oven-9/settings", json=settings), 404, "not_found")
    error(renter.api.post(f"/api/stations/{CONV1_ID}/settings", json=settings), 403, "forbidden")
    error(renter.api.post("/api/stations/oven-9/maintenance", json={}), 404, "not_found")
    error(renter.api.post(f"/api/stations/{CONV1_ID}/maintenance", json={}), 403, "forbidden")
    error(renter.api.get("/api/renters"), 403, "forbidden")
    shift = sign_in(app_url, SHIFT_EMAIL)
    error(shift.post(f"/api/stations/{CONV1_ID}/settings", json=settings), 403, "forbidden")
    assert isinstance(body(shift.get("/api/renters"), 200)["renters"], list)
    error(shift.post("/api/bookings", json={}), 403, "forbidden")
    error(operator(app_url).post("/api/purchases", json={"pack_id": "pack-10"}), 403, "forbidden")
    body(renter.api.delete("/api/session"), 204)
    error(renter.api.get("/api/me"), 401, "unauthenticated")


def test_landing_routes_per_role(browser: Browser, app_url: str) -> None:
    today = kitchen_today(operator(app_url)).isoformat()
    renter = active_renter(app_url)
    applied = apply_renter(app_url)
    with browser_page(browser, app_url) as page:
        page.goto(app_url + "/board")
        expect(page).to_have_url(re.compile(r"/$"))
        sign_in_ui(page, OPERATOR_EMAIL)
        expect(page).to_have_url(re.compile(r"/operator$"))
        expect(page.get_by_role("heading", name="Operator", exact=True)).to_be_visible()
        page.goto(app_url + "/kitchen")
        expect(page).to_have_url(re.compile(r"/operator$"))
        page.goto(app_url + "/")
        expect(page).to_have_url(re.compile(r"/operator$"))
        click(page.get_by_role("button", name="Sign out", exact=True))
        expect(page).to_have_url(re.compile(r"/$"))
        expect(page.get_by_role("textbox", name="Email", exact=True)).to_be_focused()
        sign_in_ui(page, SHIFT_EMAIL)
        expect(page).to_have_url(re.compile(rf"/shift\?date={today}$"))
        page.goto(app_url + "/operator")
        expect(page).to_have_url(re.compile(r"/shift(\?date=\d{4}-\d{2}-\d{2})?$"))
        click(page.get_by_role("button", name="Sign out", exact=True))
        sign_in_ui(page, renter.email, renter.password)
        expect(page).to_have_url(re.compile(rf"/board\?date={today}$"))
        page.goto(app_url + "/shift")
        expect(page).to_have_url(re.compile(r"/board(\?date=\d{4}-\d{2}-\d{2})?$"))
        click(page.get_by_role("button", name="Sign out", exact=True))
        sign_in_ui(page, applied.email, applied.password)
        expect(page).to_have_url(re.compile(r"/kitchen$"))
        page.goto(app_url + "/")
        expect(page).to_have_url(re.compile(r"/kitchen$"))


def test_wf_pack_purchase_happy(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    renter = active_renter(app_url, minutes=60)
    with browser_page(browser, app_url, renter.email, renter.password, path="/kitchen") as page:
        packs = page.get_by_role("region", name="Hour packs", exact=True)
        buy = packs.get_by_role("button", name="Buy 20-hour pack", exact=True)
        expect(buy).to_be_enabled()
        purchase_status = page.get_by_role("status", name="Purchase status", exact=True)
        with held(page, f"{URL_GLOB}/api/purchases") as gate:
            click(buy)
            expect(purchase_status).to_have_text("Processing purchase…")
            expect(buy).to_be_disabled()
            gate.release()
        bought, total = PACK_HOURS[1] * 60, 60 + PACK_HOURS[1] * 60
        expect(purchase_status).to_have_text(f"Paid. {hours(bought)} hours added to your balance. Your receipt is on its way.")
        expect(packs.get_by_role("status", name="Hour balance", exact=True)).to_contain_text(hours_re(hours(total)))
        last = page.get_by_role("table", name="Hour ledger", exact=True).get_by_role("row").last
        expect(last).to_contain_text("Pack purchase")
        expect(last).to_contain_text(f"+{hours(bought)}")
        expect(last).to_contain_text(hours(total))
        expect(buy).to_be_enabled()
    data = ledger(renter.api, renter.id)
    assert data["balance_minutes"] == 21 * 60 and movement_kinds(data, renter.id).count("pack_purchase") == 1
    payments = purchase_payments(killbill, renter.id)
    assert len(payments) == 1
    purchase = next(t for t in payments[0]["transactions"] if t.get("transactionType") == "PURCHASE")
    assert Decimal(str(purchase["amount"])) == Decimal(PACK_20_USD) and purchase.get("currency") == "USD"
    receipt = await_mail(mail, renter.email, f"Receipt for your {PACK_NAMES[20]}")
    assert len(receipt) == 1 and mail_from_address() in addresses(receipt[0].get("From"))
    assert payments[0]["paymentId"] in text(receipt[0]) and PACK_20_USD in text(receipt[0])


def test_wf_pack_purchase_empty_states(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url)
    day = empty_board_day(renter.api)
    with browser_page(browser, app_url, renter.email, renter.password, path="/kitchen") as page:
        expect(page.get_by_text("No hour movements yet.", exact=True)).to_be_visible()
        expect(page.get_by_role("region", name="Statements", exact=True)).to_contain_text("No statements yet.")
        open_board(page, app_url, day)
        expect(page.get_by_role("region", name="Rails", exact=True).get_by_text("No bookings on this day.", exact=True)).to_have_count(1)
    with browser_page(browser, app_url, SHIFT_EMAIL, path=f"/shift?date={day.isoformat()}") as page:
        expect(page.get_by_text("No bookings on this day.", exact=True)).to_be_visible()
    base = short_url()
    with browser_page(browser, base, OPERATOR_EMAIL, path="/operator") as page:
        expect(page.get_by_role("region", name="Compliance links", exact=True)).to_contain_text("No compliance links yet.")
    assert ledger(renter.api, renter.id)["entries"] == []


def test_purchase_idempotency(app_url: str, mail: Any, killbill: Any) -> None:
    renter = active_renter(app_url)
    key = idempotency_key()
    headers = {"Idempotency-Key": key}
    first = renter.api.post("/api/purchases", json={"pack_id": "pack-10"}, headers=headers)
    original = body(first, 201)
    assert original["balance_minutes"] == 10 * 60 and original["purchase"]["pack_id"] == "pack-10"
    clients = [client(app_url, renter.api.cookies) for _ in range(3)]
    with ThreadPoolExecutor(len(clients)) as pool:
        replays = list(pool.map(lambda c: c.post("/api/purchases", json={"pack_id": "pack-10"}, headers=headers), clients))
    for replay in replays:
        assert body(replay, 201) == original
    error(renter.api.post("/api/purchases", json={"pack_id": "pack-20"}, headers=headers), 409, "idempotency_conflict")
    for bad in ({}, {"Idempotency-Key": "bad key!"}, {"Idempotency-Key": "k" * 65}):
        data = error(renter.api.post("/api/purchases", json={"pack_id": "pack-10"}, headers=bad), 422, "validation")
        assert data["errors"].get("idempotency_key")
    data = error(renter.api.post("/api/purchases", json={"pack_id": "pack-9"}, headers={"Idempotency-Key": idempotency_key()}), 422, "validation")
    assert data["errors"].get("pack_id")
    applied = apply_renter(app_url)
    error(applied.api.post("/api/purchases", json={"pack_id": "pack-10"}, headers={"Idempotency-Key": idempotency_key()}), 409, "renter_not_active")
    assert len(purchase_payments(killbill, renter.id)) == 1
    assert killbill.payment_by_key(f"purchase-{renter.id}-{key}") is not None
    data = ledger(renter.api, renter.id)
    assert movement_kinds(data, renter.id).count("pack_purchase") == 1 and data["balance_minutes"] == 10 * 60
    await_mail(mail, renter.email, "Receipt for your 10-hour pack")
    assert len(mails_to(mail, renter.email, "Receipt for your 10-hour pack", DUPLICATE_WINDOW_S)) == 1
    other = active_renter(app_url)
    second = body(other.api.post("/api/purchases", json={"pack_id": "pack-10"}, headers=headers), 201)
    assert second["purchase"]["id"] != original["purchase"]["id"]
    assert killbill.payment_by_key(f"purchase-{other.id}-{key}") is not None


def test_purchase_all_or_nothing_billing_down(app_url: str, mail: Any, killbill: Any) -> None:
    renter = active_renter(app_url, minutes=60)
    before = ledger(renter.api, renter.id)
    down = sign_in(billing_down_url(), renter.email, renter.password)
    key = idempotency_key()
    started = time.monotonic()
    error(down.post("/api/purchases", json={"pack_id": "pack-20"}, headers={"Idempotency-Key": key}), 503, "billing_unavailable")
    assert time.monotonic() - started <= KILLBILL_TIMEOUT_S + CLOCK_SLACK_S
    assert ledger(renter.api, renter.id)["entries"] == before["entries"]
    assert killbill.payment_by_key(f"purchase-{renter.id}-{key}") is None and purchase_payments(killbill, renter.id) == []
    assert mails_to(mail, renter.email, "Receipt for your 20-hour pack", DUPLICATE_WINDOW_S) == []
    data = body(renter.api.post("/api/purchases", json={"pack_id": "pack-20"}, headers={"Idempotency-Key": key}), 201)
    assert data["balance_minutes"] == 21 * 60
    assert len(purchase_payments(killbill, renter.id)) == 1
    assert len(await_mail(mail, renter.email, "Receipt for your 20-hour pack")) == 1


def test_ledger_pairs_and_balances(app_url: str) -> None:
    op = operator(app_url)
    renter = active_renter(app_url, minutes=600)
    body(op.post(f"/api/renters/{renter.id}/adjustments", json={"minutes": -60, "reason": "correction"}), 201)
    day = free_days(renter.api, "mixer-60")[0]
    first = body(book(renter.api, "mixer-60", day, "10:00", "11:00"), 201)["bookings"][0]
    body(act(renter.api, first["id"], "release"), 200)
    second = body(book(renter.api, "mixer-60", day, "13:00", "14:00"), 201)["bookings"][0]
    body(act(renter.api, second["id"], "confirm"), 200)
    data = ledger(renter.api, renter.id)
    kinds = movement_kinds(data, renter.id)
    assert kinds == ["adjustment", "adjustment", "booking_hold", "hold_release", "booking_hold"], kinds
    assert data["balance_minutes"] == 600 - 60 - 60 and data["held_minutes"] == 60
    debit, credit = pair_of(data, renter.id, "hold_release")
    assert debit["account"] == f"renter:{renter.id}:held" and credit["account"] == f"renter:{renter.id}:available"
    view = renter_view(op, renter.id)
    assert view["balance_minutes"] == data["balance_minutes"] and view["held_minutes"] == data["held_minutes"]
    data = error(op.post(f"/api/renters/{renter.id}/adjustments", json={"minutes": -24000, "reason": "too much"}), 409, "insufficient_hours")
    assert data["balance_minutes"] == 480 and data["needed_minutes"] == 24000
    for minutes, reason in ((0, "zero"), (7, "off step"), (24015, "too big"), (60, ""), (60, "r" * 201)):
        error(op.post(f"/api/renters/{renter.id}/adjustments", json={"minutes": minutes, "reason": reason}), 422, "validation")
    assert len(ledger(op, renter.id)["entries"]) == 10
    body(act(renter.api, second["id"], "cancel"), 200)
    movements(ledger(renter.api, renter.id), renter.id)


def test_wf_billing_outage_book_with_owned_hours(browser: Browser, app_url: str) -> None:
    down = billing_down_url()
    renter = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "convection-1")[0]
    with browser_page(browser, down, renter.email, renter.password, path="/kitchen") as page:
        packs = page.get_by_role("region", name="Hour packs", exact=True)
        for n in PACK_HOURS:
            expect(packs.get_by_role("button", name=f"Buy {n}-hour pack", exact=True)).to_be_disabled()
        expect(packs).to_contain_text(OUTAGE_COPY)
        expect(page.get_by_role("status", name="Purchase status", exact=True)).to_have_text(OUTAGE_COPY)
        open_board(page, down, day)
        focus_cell(page, CONV1, "10:00")
        shift_right(page, 4)
        expect(draft_ticket(page, "10:00", "11:00")).to_be_visible()
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name=f"Hold {CONV1} 10:00 to 11:00", exact=True)).to_be_visible()
        expect(docket(page).get_by_role("button", name="Confirm booking", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        expect(booking_status(page)).to_have_text(CONFIRMED_COPY)
    error(sign_in(down, renter.email, renter.password).post("/api/purchases", json={"pack_id": "pack-10"},
                                                           headers={"Idempotency-Key": idempotency_key()}), 503, "billing_unavailable")
    rows = own_bookings(renter.api, day)
    assert [(b["status"], b["start"], b["end"]) for b in rows] == [("confirmed", "10:00", "11:00")]
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 540


def test_wf_billing_outage_recovery(browser: Browser, mail: Any, killbill: Any) -> None:
    original = urlparse(os.environ["KILLBILL_URL"])
    target = (original.hostname or "", original.port or (443 if original.scheme == "https" else 80))
    relay = Relay(target)
    try:
        with app_copy({"KILLBILL_URL": f"http://127.0.0.1:{relay.port}{original.path}"}) as base:
            renter = active_renter(base)
            key = idempotency_key()
            started = time.monotonic()
            assert body(renter.api.get("/api/packs"), 200)["purchases_available"] is False
            assert time.monotonic() - started <= PACKS_LIMIT_S + CLOCK_SLACK_S
            started = time.monotonic()
            error(renter.api.post("/api/purchases", json={"pack_id": "pack-10"}, headers={"Idempotency-Key": key}), 503, "billing_unavailable")
            assert time.monotonic() - started <= KILLBILL_TIMEOUT_S + CLOCK_SLACK_S
            with browser_page(browser, base, renter.email, renter.password, path="/kitchen") as page:
                packs = page.get_by_role("region", name="Hour packs", exact=True)
                buttons = [packs.get_by_role("button", name=f"Buy {n}-hour pack", exact=True) for n in PACK_HOURS]
                status = page.get_by_role("status", name="Purchase status", exact=True)
                for button in buttons:
                    expect(button).to_be_disabled()
                expect(status).to_have_text(OUTAGE_COPY)
                relay.set_forwarding(True)
                advance(page, PACK_CHECK_MS)
                for button in buttons:
                    expect(button).to_be_enabled()
                expect(status).to_have_text(AVAILABLE_AGAIN)
                expect(packs).not_to_contain_text(OUTAGE_COPY)
                relay.set_forwarding(False)
                page.evaluate(FOCUS_EVENT_JS)
                for button in buttons:
                    expect(button).to_be_disabled()
                relay.set_forwarding(True)
                page.evaluate(FOCUS_EVENT_JS)
                for button in buttons:
                    expect(button).to_be_enabled()
            assert purchase_payments(killbill, renter.id) == []
            assert body(renter.api.post("/api/purchases", json={"pack_id": "pack-10"}, headers={"Idempotency-Key": key}), 201)["balance_minutes"] == 600
            assert len(purchase_payments(killbill, renter.id)) == 1
            assert killbill.payment_by_key(f"purchase-{renter.id}-{key}") is not None
            assert len(await_mail(mail, renter.email, "Receipt for your 10-hour pack")) == 1
    finally:
        relay.stop()


def test_billing_recovers_without_restart(mail: Any, killbill: Any) -> None:
    original = urlparse(os.environ["KILLBILL_URL"])
    target = (original.hostname or "", original.port or (443 if original.scheme == "https" else 80))
    relay = Relay(target)
    try:
        with app_copy({"KILLBILL_URL": f"http://127.0.0.1:{relay.port}{original.path}"}) as base:
            renter = active_renter(base)
            key = idempotency_key()
            for _ in range(2):
                started = time.monotonic()
                assert body(renter.api.get("/api/packs"), 200)["purchases_available"] is False
                assert time.monotonic() - started <= PACKS_LIMIT_S + CLOCK_SLACK_S
                started = time.monotonic()
                error(renter.api.post("/api/purchases", json={"pack_id": "pack-10"}, headers={"Idempotency-Key": key}), 503, "billing_unavailable")
                assert time.monotonic() - started <= KILLBILL_TIMEOUT_S + CLOCK_SLACK_S
            assert purchase_payments(killbill, renter.id) == []
            assert killbill.payment_by_key(f"purchase-{renter.id}-{key}") is None
            assert ledger(renter.api, renter.id)["entries"] == []
            relay.set_forwarding(True)
            assert body(renter.api.get("/api/packs"), 200)["purchases_available"] is True
            first = body(renter.api.post("/api/purchases", json={"pack_id": "pack-10"}, headers={"Idempotency-Key": key}), 201)
            assert first["balance_minutes"] == 600
            assert len(purchase_payments(killbill, renter.id)) == 1
            assert killbill.payment_by_key(f"purchase-{renter.id}-{key}") is not None
            relay.set_forwarding(False)
            started = time.monotonic()
            assert body(renter.api.get("/api/packs"), 200)["purchases_available"] is False
            assert time.monotonic() - started <= PACKS_LIMIT_S + CLOCK_SLACK_S
            relay.set_forwarding(True)
            assert body(renter.api.get("/api/packs"), 200)["purchases_available"] is True
            assert body(renter.api.post("/api/purchases", json={"pack_id": "pack-10"}, headers={"Idempotency-Key": key}), 201) == first
            assert len(purchase_payments(killbill, renter.id)) == 1
            data = ledger(renter.api, renter.id)
            assert data["balance_minutes"] == 600 and movement_kinds(data, renter.id).count("pack_purchase") == 1
            await_mail(mail, renter.email, "Receipt for your 10-hour pack")
            assert len(mails_to(mail, renter.email, "Receipt for your 10-hour pack", DUPLICATE_WINDOW_S)) == 1
    finally:
        relay.stop()


def test_wf_station_sweep_pointer(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=WREN_OPENING_MINUTES)
    neighbour = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "deck-oven")[0]
    theirs = body(book(neighbour.api, "deck-oven", day, "14:00", "15:00"), 201)["bookings"][0]
    try:
        with browser_page(browser, app_url, renter.email, renter.password) as page:
            open_board(page, app_url, day)
            expect(booked_ticket(page, "14:00", "15:00")).to_be_visible()
            expect(balance_status(page)).to_contain_text(hours_re("20.00"))
            x, y = mark_point(page, DECK, "14:30")
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.up()
            expect(announcer(page)).to_have_text(TAKEN_COPY)
            expect(page.get_by_role("img", name=re.compile(r"^Draft ticket "))).to_have_count(0)
            x, y = mark_point(page, DECK, "10:00")
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(*mark_point(page, DECK, "12:00"), steps=8)
            draft = draft_ticket(page, "10:00", "12:00")
            expect(draft).to_contain_text(hours_re("4.00"))
            expect(buffer_tail(page, plus("12:00", DECK_BUFFER))).to_be_visible()
            expect(announcer(page)).to_have_text(step_copy(DECK, "10:00", "12:00", 240, DECK_BUFFER))
            expect(balance_status(page)).to_contain_text(hours_re("16.00"))
            settle(draft)
            ticket = box_of(draft)
            span = mark_point(page, DECK, "12:00")[0] - mark_point(page, DECK, "10:00")[0]
            assert abs(ticket["height"] - 8 * STEP_PX) <= PX_TOLERANCE and abs(ticket["width"] - span) <= PX_TOLERANCE, ticket
            page.mouse.move(*mark_point(page, DECK, "11:00"), steps=4)
            expect(draft_ticket(page, "10:00", "11:00")).to_contain_text(hours_re("2.00"))
            page.mouse.move(*mark_point(page, DECK, "17:00"), steps=12)
            expect(draft_ticket(page, "10:00", "13:15")).to_be_visible()
            expect(announcer(page)).to_have_text(stop_copy("13:15", f"another booking starts at {plus('13:15', DECK_BUFFER)}"))
            expect(page.get_by_role("img", name="Conflict notch", exact=True)).to_be_visible()
            page.mouse.move(*mark_point(page, DECK, "12:00"), steps=6)
            expect(draft).to_be_visible()
            page.mouse.up()
            hold = page.get_by_role("button", name=f"Hold {DECK} 10:00 to 12:00", exact=True)
            expect(hold).to_contain_text("HOLD")
            expect(docket(page).get_by_role("timer", name="Hold countdown", exact=True)).to_be_visible()
            expect(docket(page)).to_contain_text(f"Pending −{hours(240)} h")
            expect(docket(page)).to_contain_text(f"Hold {DECK} {day.isoformat()} 10:00–12:00")
            expect(balance_status(page)).to_contain_text(hours_re("16.00"))
            expect(announcer(page)).to_have_text(f"Hold placed on {DECK} 10:00 to 12:00. Confirm before the countdown ends.")
        rows = own_bookings(renter.api, day)
        assert [(b["status"], b["start"], b["end"], b["minutes_debited"]) for b in rows] == [("hold", "10:00", "12:00", 240)]
        view = renter_view(renter.api, renter.id)
        assert view["balance_minutes"] == WREN_OPENING_MINUTES - 240 and view["held_minutes"] == 240
        release_all(renter.api, [rows[0]["id"]])
    finally:
        release_all(neighbour.api, [theirs["id"]])


def test_wf_station_sweep_keyboard(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=WREN_OPENING_MINUTES)
    neighbour = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "deck-oven")[0]
    theirs = body(book(neighbour.api, "deck-oven", day, "12:30", "13:00"), 201)["bookings"][0]
    with browser_page(browser, app_url, renter.email, renter.password) as page:
        open_board(page, app_url, day)
        expect(booked_ticket(page, "12:30", "13:00")).to_be_visible()
        focus_cell(page, DECK, "06:00")
        page.keyboard.press("End")
        expect(cell(page, DECK, "23:45")).to_be_focused()
        page.keyboard.press("Home")
        expect(cell(page, DECK, "00:00")).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(cell(page, MIXER, "00:00")).to_be_focused()
        page.keyboard.press("ArrowUp")
        expect(cell(page, DECK, "00:00")).to_be_focused()
        for _ in range(40):
            page.keyboard.press("ArrowRight")
        expect(cell(page, DECK, "10:00")).to_be_focused()
        shift_right(page, 1)
        expect(announcer(page)).to_have_text(step_copy(DECK, "10:00", "10:15", 30, DECK_BUFFER))
        shift_right(page, 6)
        expect(draft_ticket(page, "10:00", "11:45")).to_contain_text(hours_re("3.50"))
        expect(announcer(page)).to_have_text(step_copy(DECK, "10:00", "11:45", 210, DECK_BUFFER))
        shift_right(page, 1)
        expect(announcer(page)).to_have_text(stop_copy("11:45", f"another booking starts at {plus('11:45', DECK_BUFFER)}"))
        expect(draft_ticket(page, "10:00", "11:45")).to_be_visible()
        expect(page.get_by_role("img", name="Conflict notch", exact=True)).to_be_visible()
        page.keyboard.press("Shift+ArrowLeft")
        expect(announcer(page)).to_have_text(step_copy(DECK, "10:00", "11:30", 180, DECK_BUFFER))
        page.keyboard.press("Escape")
        expect(page.get_by_role("img", name=re.compile(r"^Draft ticket "))).to_have_count(0)
        expect(cell(page, DECK, "10:00")).to_be_focused()
        shift_right(page, 4)
        expect(draft_ticket(page, "10:00", "11:00")).to_contain_text(hours_re("2.00"))
        page.keyboard.press("Enter")
        confirm = docket(page).get_by_role("button", name="Confirm booking", exact=True)
        expect(confirm).to_be_focused()
        page.keyboard.press("Enter")
        expect(booking_status(page)).to_have_text(CONFIRMED_COPY)
        ticket = page.get_by_role("button", name=f"Booking {DECK} 10:00 to 11:00", exact=True)
        expect(ticket).to_be_focused()
        page.keyboard.press("Enter")
        cancel = docket(page).get_by_role("button", name="Cancel booking", exact=True)
        for _ in range(TAB_LIMIT):
            if is_focused(cancel):
                break
            page.keyboard.press("Tab")
        expect(cancel).to_be_focused()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("alertdialog", name="Cancel booking", exact=True)
        expect(dialog).to_be_visible()
        assert is_focused(dialog)
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TAB_WRAP_PRESSES):
                page.keyboard.press(key)
                assert is_focused(dialog), f"{key} left the Cancel booking dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(cancel).to_be_focused()
    rows = own_bookings(renter.api, day)
    assert [(b["status"], b["start"], b["end"], b["minutes_debited"]) for b in rows] == [("confirmed", "10:00", "11:00", 120)]
    release_all(neighbour.api, [theirs["id"]])


def test_station_board_contents(browser: Browser, app_url: str) -> None:
    viewer = active_renter(app_url, minutes=600)
    other = active_renter(app_url, minutes=600)
    shift = sign_in(app_url, SHIFT_EMAIL)
    day = empty_board_day(viewer.api)
    theirs = body(book(other.api, "deck-oven", day, "14:00", "15:00"), 201)["bookings"][0]
    block = body(shift.post(f"/api/stations/{PREP_ID}/maintenance", json={"date": day.isoformat(), "start": "16:00", "end": "17:00", "reason": "probe repair"}), 201)["block"]
    try:
        data = body(viewer.api.get("/api/stations", params={"date": day.isoformat()}), 200)
        assert data["date"] == day.isoformat() and data["time_zone"] == "America/Chicago" and ISO_MS.match(data["server_now"])
        assert {s["id"]: s["name"] for s in data["stations"]} == STATION_NAMES
        deck = next(s for s in data["stations"] if s["id"] == "deck-oven")["blocks"]
        assert len(deck) == 1 and deck[0]["kind"] == "hold" and deck[0]["mine"] is False
        assert deck[0]["booking_id"] is None and deck[0]["renter_business_name"] is None
        staff_deck = next(s for s in body(shift.get("/api/stations", params={"date": day.isoformat()}), 200)["stations"] if s["id"] == "deck-oven")["blocks"]
        assert staff_deck[0]["renter_business_name"] == other.business
        with browser_page(browser, app_url, viewer.email, viewer.password) as page:
            open_board(page, app_url, day)
            for name in STATION_NAMES.values():
                expect(page.get_by_role("grid", name=f"{name} schedule", exact=True)).to_be_visible()
            expect(page.get_by_role("grid", name=f"{CONV1} schedule", exact=True).get_by_role("gridcell")).to_have_count(GRID_CELLS)
            expect(cell(page, CONV1, "00:00")).to_have_count(1)
            expect(cell(page, CONV1, "23:45")).to_have_count(1)
            expect(booked_ticket(page, "14:00", "15:00")).to_contain_text("Booked")
            expect(buffer_tail(page, plus("15:00", DECK_BUFFER))).to_be_visible()
            expect(maintenance_block(page, "16:00", "17:00")).to_contain_text("Maintenance")
            expect(balance_status(page)).to_contain_text(hours_re("10.00"))
            expect(docket(page)).to_contain_text("Compliance: current")
            late = body(book(other.api, "convection-2", day, "08:00", "09:00"), 201)["bookings"][0]
            expect(booked_ticket(page, "08:00", "09:00")).to_have_count(0)
            advance(page, REFRESH_MS)
            expect(booked_ticket(page, "08:00", "09:00")).to_be_visible()
        with browser_page(browser, app_url, SHIFT_EMAIL) as page:
            open_board(page, app_url, day)
            expect(page.get_by_role("button", name=f"{other.business} {DECK} 14:00 to 15:00", exact=True)).to_contain_text(other.business)
            expect(docket(page).get_by_role("status", name="Hour balance", exact=True)).to_have_count(0)
        release_all(other.api, [late["id"]])
    finally:
        release_all(other.api, [theirs["id"]])
        shift.delete(f"/api/maintenance/{block['id']}")


def test_booking_validation_and_holds(app_url: str) -> None:
    renter = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "prep-3")[0]
    today = kitchen_today(renter.api)
    invalid = [
        ({"date": day.isoformat(), "start": "10:00", "end": "11:00"}, ("station_id",)),
        ({"station_id": "oven-9", "date": day.isoformat(), "start": "10:00", "end": "11:00"}, ("station_id",)),
        ({"station_id": "prep-3", "date": "not-a-date", "start": "10:00", "end": "11:00"}, ("date",)),
        ({"station_id": "prep-3", "date": day.isoformat(), "start": "10:07", "end": "11:00"}, ("start",)),
        ({"station_id": "prep-3", "date": day.isoformat(), "start": "10:00", "end": "09:00"}, ("end",)),
        ({"station_id": "prep-3", "date": day.isoformat(), "start": "10:00", "end": "16:15"}, ("end",)),
        ({"station_id": "prep-3", "date": day.isoformat(), "start": "23:00", "end": "24:15"}, ("end",)),
        ({"station_id": "prep-3", "date": day.isoformat(), "start": "10:00", "end": "11:00", "repeat_weeks": 13}, ("repeat_weeks",)),
        ({"station_id": "prep-3", "date": day.isoformat(), "start": "10:00", "end": "11:00", "repeat_weeks": 0}, ("repeat_weeks",)),
        ({"station_id": "prep-3", "date": (today + timedelta(days=MAX_AHEAD_DAYS + 1)).isoformat(), "start": "10:00", "end": "11:00"}, ("date",)),
        ({"station_id": "prep-3", "date": (today - timedelta(days=1)).isoformat(), "start": "10:00", "end": "11:00"}, ("date", "start")),
    ]
    for payload, keys in invalid:
        data = error(renter.api.post("/api/bookings", json=payload), 422, "validation")
        assert any(data["errors"].get(k) for k in keys), (payload, data)
    assert own_bookings(renter.api, day) == []
    created = body(book(renter.api, "prep-3", day, "10:00", "16:00"), 201)
    hold = created["bookings"][0]
    assert hold["status"] == "hold" and hold["minutes_debited"] == 360 and hold["station_id"] == "prep-3"
    assert abs((parse_instant(hold["hold_expires_at"]) - parse_instant(hold["created_at"])).total_seconds() - HOLD_TTL_SECONDS) <= CLOCK_SLACK_S
    view = renter_view(renter.api, renter.id)
    assert view["balance_minutes"] == 240 and view["held_minutes"] == 360
    blocks = station_blocks(renter.api, day)["prep-3"]
    assert [(b["kind"], b["mine"], b["start"], b["end"]) for b in blocks] == [("hold", True, "10:00", "16:00")]
    data = error(book(renter.api, "prep-3", day, "17:00", "22:00"), 409, "insufficient_hours")
    assert data["balance_minutes"] == 240 and data["needed_minutes"] == 300
    assert len(own_bookings(renter.api, day)) == 1
    applied = apply_renter(app_url)
    error(book(applied.api, "prep-3", day, "17:00", "17:30"), 409, "renter_not_active")
    error(book(applied.api, "prep-3", day, "17:07", "17:30"), 409, "renter_not_active")
    release_all(renter.api, [hold["id"]])
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 600


def test_slot_conflict_with_buffers(app_url: str) -> None:
    renter = active_renter(app_url, minutes=1200)
    rival = active_renter(app_url, minutes=600)
    shift = sign_in(app_url, SHIFT_EMAIL)
    day = free_days(renter.api, "convection-1")[0]
    theirs = body(book(rival.api, "convection-1", day, "10:00", "11:00"), 201)["bookings"][0]
    block = body(shift.post(f"/api/stations/{CONV1_ID}/maintenance", json={"date": day.isoformat(), "start": "14:00", "end": "15:00", "reason": "probe"}), 201)["block"]
    mine: list[Any] = []
    try:
        data = error(book(renter.api, "convection-1", day, "11:00", "11:30"), 409, "slot_conflict")
        assert data["blocked_by"] == "buffer" and data["legal_end"] is None and data["date"] == day.isoformat()
        data = error(book(renter.api, "convection-1", day, "09:00", "10:00"), 409, "slot_conflict")
        assert (data["blocked_by"], data["blocked_at"], data["legal_end"]) == ("booking", "10:00", "09:30")
        data = error(book(renter.api, "convection-1", day, "13:00", "14:00"), 409, "slot_conflict")
        assert (data["blocked_by"], data["blocked_at"], data["legal_end"]) == ("maintenance", "14:00", "13:30")
        mine.append(body(book(renter.api, "convection-1", day, "11:30", "12:00"), 201)["bookings"][0]["id"])
        mine.append(body(book(renter.api, "convection-1", day, "09:00", "09:30"), 201)["bookings"][0]["id"])
        mine.append(body(book(renter.api, "convection-1", day, "15:00", "16:00"), 201)["bookings"][0]["id"])
        assert renter_view(renter.api, renter.id)["balance_minutes"] == 1200 - 30 - 30 - 60
    finally:
        release_all(renter.api, mine)
        release_all(rival.api, [theirs["id"]])
        shift.delete(f"/api/maintenance/{block['id']}")


def test_off_peak_pricing(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=1200)
    day = free_days(renter.api, "convection-1")[0]
    for start, end, expected in (("21:00", "23:00", 90), ("21:45", "22:15", 23)):
        hold = body(book(renter.api, "convection-1", day, start, end), 201)["bookings"][0]
        assert hold["minutes_debited"] == expected == price(day, start, end, 1, 50)
        assert renter_view(renter.api, renter.id)["balance_minutes"] == 1200 - expected
        release_all(renter.api, [hold["id"]])
    deck_day = free_days(renter.api, "deck-oven")[0]
    hold = body(book(renter.api, "deck-oven", deck_day, "05:00", "07:00"), 201)["bookings"][0]
    assert hold["minutes_debited"] == 180
    release_all(renter.api, [hold["id"]])
    with browser_page(browser, app_url, renter.email, renter.password) as page:
        open_board(page, app_url, day)
        focus_cell(page, CONV1, "21:45")
        shift_right(page, 2)
        expect(draft_ticket(page, "21:45", "22:15")).to_contain_text(hours_re("0.38"))
        expect(announcer(page)).to_have_text(f"{CONV1}, 21:45 to 22:15, 0.38 hours, buffer until 22:45.")
        expect(balance_status(page)).to_contain_text(hours_re(hours(1200 - 23)))
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name=f"Hold {CONV1} 21:45 to 22:15", exact=True)).to_be_visible()
    rows = own_bookings(renter.api, day)
    assert [(b["start"], b["minutes_debited"]) for b in rows if b["status"] == "hold"] == [("21:45", 23)]
    release_all(renter.api, [b["id"] for b in rows])


def test_responsive_layout_bands(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "convection-1")[0]
    tol = PX_TOLERANCE
    with browser_page(browser, app_url, renter.email, renter.password) as page:
        for width, height, band in LAYOUT_SIZES:
            page.set_viewport_size({"width": width, "height": height})
            open_board(page, app_url, day)
            layout(page)
            region = page.get_by_role("region", name="Rails", exact=True)
            rails, dock = box_of(region), box_of(docket(page))
            first, six, last = box_of(cell(page, CONV1, "00:00")), box_of(cell(page, CONV1, "06:00")), box_of(cell(page, CONV1, "23:45"))
            scroll_width, client_width = region.evaluate("e => [e.scrollWidth, e.clientWidth]")
            menu = page.get_by_role("button", name="Menu", exact=True)
            assert six["height"] >= MIN_TARGET_PX - tol, (width, six)
            if band == "phone":
                expect(menu).to_be_visible()
                assert abs(six["width"] - PHONE_CELL_PX) <= tol and scroll_width > client_width + 1, (width, six)
                assert six["x"] >= rails["x"] - tol and six["x"] + six["width"] <= rails["x"] + rails["width"] + tol
                assert first["x"] + first["width"] <= rails["x"] + tol
                assert dock["y"] >= rails["y"] + rails["height"] - tol
            else:
                expect(menu).to_have_count(0)
                assert scroll_width <= client_width + 1 and last["x"] + last["width"] <= rails["x"] + rails["width"] + tol
                assert first["x"] >= rails["x"] - tol
                if band == "tablet":
                    assert dock["y"] >= rails["y"] + rails["height"] - tol and rails["width"] >= dock["width"] - tol
                else:
                    assert dock["x"] >= rails["x"] + rails["width"] - tol and dock["y"] < rails["y"] + rails["height"]
                    assert rails["width"] > 2 * dock["width"]
            targets = ["Sign out", "Previous day", "Today", "Next day"] + (["Menu"] if band == "phone" else [])
            for name in targets:
                target = box_of(page.get_by_role("button", name=name, exact=True))
                assert target["width"] >= MIN_TARGET_PX - tol and target["height"] >= MIN_TARGET_PX - tol, (width, name, target)
        for width, height, band in PUBLISHED_SIZES:
            page.set_viewport_size({"width": width, "height": height})
            page.goto(app_url + "/kitchen")
            expect(page.get_by_role("heading", name="My kitchen", exact=True)).to_be_visible()
            layout(page)
            packs = box_of(page.get_by_role("region", name="Hour packs", exact=True))
            documents = box_of(page.get_by_role("region", name="Documents", exact=True))
            statements = box_of(page.get_by_role("region", name="Statements", exact=True))
            if band == "phone":
                assert packs["y"] < documents["y"] < statements["y"] and column_count([packs, documents, statements]) == 1
            else:
                ledger_box = box_of(page.get_by_role("table", name="Hour ledger", exact=True))
                assert column_count([packs, ledger_box, documents]) == (3 if band == "desktop" else 2)
    with browser_page(browser, app_url, OPERATOR_EMAIL) as page:
        for width, height, band in PUBLISHED_SIZES:
            page.set_viewport_size({"width": width, "height": height})
            page.goto(app_url + "/operator")
            expect(page.get_by_role("heading", name="Operator", exact=True)).to_be_visible()
            layout(page)
            if band == "phone":
                continue
            sections = [box_of(page.get_by_role("table", name="Renters", exact=True)), box_of(page.get_by_role("table", name="Stations", exact=True)),
                        box_of(page.get_by_role("region", name="Compliance links", exact=True)), box_of(page.get_by_role("table", name="Notifications", exact=True))]
            if band == "desktop":
                assert column_count(sections) == 2
            else:
                assert column_count(sections) == 1 and [s["y"] for s in sections] == sorted(s["y"] for s in sections)


def test_hold_expiry_on_server(mail: Any) -> None:
    base = short_url()
    renter = active_renter(base, minutes=600)
    day = free_days(renter.api, "convection-2")[0]
    created = body(book(renter.api, "convection-2", day, "10:00", "11:00"), 201)
    hold = created["bookings"][0]
    assert ISO_MS.match(hold["hold_expires_at"]) and ISO_MS.match(created["server_now"])
    expires = parse_instant(hold["hold_expires_at"])
    assert parse_instant(created["server_now"]) < expires
    assert [b["id"] for b in body(renter.api.get("/api/bookings", params={"status": "hold"}), 200)["bookings"]] == [hold["id"]]
    live = body(book(renter.api, "convection-2", day, "13:00", "14:00"), 201)["bookings"][0]
    assert [b["status"] for b in body(act(renter.api, live["id"], "confirm"), 200)["bookings"]] == ["confirmed"]
    wait = (expires - parse_instant(created["server_now"])).total_seconds() + EXPIRY_RECORD_SECONDS + MAIL_WAIT_S
    subject = f"Your hold on {CONV2} has expired"
    await_mail(mail, renter.email, subject, wait)
    view = body(renter.api.get(f"/api/bookings/{hold['id']}"), 200)
    assert view["booking"]["status"] == "expired" and parse_instant(view["server_now"]) >= expires
    error(act(renter.api, hold["id"], "confirm"), 409, "hold_expired")
    error(act(renter.api, hold["id"], "release"), 409, "hold_expired")
    assert body(renter.api.get("/api/bookings", params={"status": "hold"}), 200)["bookings"] == []
    data = ledger(renter.api, renter.id)
    assert data["balance_minutes"] == 540 and data["held_minutes"] == 60
    debit, credit = pair_of(data, renter.id, "hold_release")
    recorded = parse_instant(credit["created_at"])
    assert expires <= recorded <= expires + timedelta(seconds=EXPIRY_RECORD_SECONDS + CLOCK_SLACK_S), (expires, recorded)
    again = body(book(renter.api, "convection-2", day, "10:00", "11:00"), 201)["bookings"][0]
    release_all(renter.api, [again["id"]])
    assert len(mails_to(mail, renter.email, subject, DUPLICATE_WINDOW_S)) == 1


def test_wf_hold_lifecycle_confirm(browser: Browser, app_url: str, mail: Any) -> None:
    renter = active_renter(app_url, minutes=WREN_OPENING_MINUTES)
    day = free_days(renter.api, "deck-oven")[0]
    line = f"Hold {DECK} {day.isoformat()} 10:00–12:00"
    with browser_page(browser, app_url, renter.email, renter.password, reduced=False, device_time=SKEWED_DEVICE_TIME) as page:
        open_board(page, app_url, day)
        focus_cell(page, DECK, "10:00")
        shift_right(page, 8)
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name=f"Hold {DECK} 10:00 to 12:00", exact=True)).to_be_visible()
        timer = docket(page).get_by_role("timer", name="Hold countdown", exact=True)
        expect(timer).to_have_text(re.compile(r"^\d\d:\d\d$"))
        assert 0 < countdown_seconds(timer) <= HOLD_TTL_SECONDS
        click(page.get_by_role("button", name="Next day", exact=True))
        expect(page).to_have_url(re.compile(rf"date={(day + timedelta(days=1)).isoformat()}$"))
        expect(docket(page)).to_contain_text(line)
        assert 0 < countdown_seconds(timer) <= HOLD_TTL_SECONDS
        page.reload()
        expect(docket(page)).to_contain_text(line)
        expect(timer).to_have_text(re.compile(r"^\d\d:\d\d$"))
        assert 0 < countdown_seconds(timer) <= HOLD_TTL_SECONDS
        expect(docket(page).get_by_role("button", name="Confirm booking", exact=True)).to_be_enabled()
        click(page.get_by_role("button", name="Previous day", exact=True))
        expect(page).to_have_url(re.compile(rf"date={day.isoformat()}$"))
        click(docket(page).get_by_role("button", name="Confirm booking", exact=True))
        expect(booking_status(page)).to_have_text(CONFIRMED_COPY)
        expect(page.get_by_role("button", name=f"Booking {DECK} 10:00 to 12:00", exact=True)).to_be_focused()
        advance(page, REFRESH_MS)
        page.wait_for_load_state("networkidle")
        expect(booking_status(page)).to_have_text(CONFIRMED_COPY)
        expect(timer).to_have_count(0)
        expect(docket(page)).not_to_contain_text(line)
    rows = own_bookings(renter.api, day)
    assert [(b["status"], b["start"], b["end"]) for b in rows] == [("confirmed", "10:00", "12:00")]
    subject = f"Booking confirmed: {DECK} on {day.isoformat()}"
    message = await_mail(mail, renter.email, subject)[0]
    assert f"10:00–12:00 {zone_on(day, '10:00')}" in text(message)
    assert f"Sanitation buffer: {DECK_BUFFER} minutes, until {plus('12:00', DECK_BUFFER)}" in text(message)
    assert len(mails_to(mail, renter.email, subject, DUPLICATE_WINDOW_S)) == 1


def test_wf_hold_lifecycle_release(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "convection-2")[0]
    hold = body(book(renter.api, "convection-2", day, "10:00", "11:00"), 201)["bookings"][0]
    line = f"Hold {CONV2} {day.isoformat()} 10:00–11:00"
    with browser_page(browser, app_url, renter.email, renter.password) as page:
        open_board(page, app_url, day + timedelta(days=1))
        expect(docket(page)).to_contain_text(line)
        expect(docket(page).get_by_role("timer", name="Hold countdown", exact=True)).to_be_visible()
        click(docket(page).get_by_role("button", name="Release hold", exact=True))
        expect(booking_status(page)).to_have_text(f"Hold released. {hours(hold['minutes_debited'])} hours returned to your balance.")
        expect(page.get_by_role("heading", name="Board", exact=True)).to_be_focused()
        expect(balance_status(page)).to_contain_text(hours_re("10.00"))
        page.reload()
        expect(page.get_by_role("grid", name=f"{CONV1} schedule", exact=True)).to_be_visible()
        expect(docket(page)).not_to_contain_text(line)
        expect(docket(page).get_by_role("timer", name="Hold countdown", exact=True)).to_have_count(0)
    assert booking_of(renter.api, hold["id"])["status"] == "expired"
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 600


def test_one_winner_per_slot(app_url: str) -> None:
    renters = [active_renter(app_url, minutes=600) for _ in range(CLAIMANTS)]
    day = free_days(renters[0].api, "convection-2")[0]
    starts = [f"{13 + (15 * n) // 60:02d}:{(15 * n) % 60:02d}" for n in range(CLAIMANTS)]
    barrier = threading.Barrier(CLAIMANTS)

    def claim(n: int) -> httpx.Response:
        barrier.wait()
        return book(renters[n].api, "convection-2", day, starts[n], "15:00")

    with ThreadPoolExecutor(CLAIMANTS) as pool:
        results = list(pool.map(claim, range(CLAIMANTS)))
    winners = [n for n, r in enumerate(results) if r.status_code == 201]
    assert len(winners) == 1, [r.status_code for r in results]
    win = winners[0]
    win_start = instant(day, starts[win])
    for n, response in enumerate(results):
        if n == win:
            continue
        data = error(response, 409, "slot_conflict")
        assert data["blocked_by"] == "booking" and data["blocked_at"] == starts[win]
        mine = instant(day, starts[n])
        legal = win_start - timedelta(minutes=30)
        expected = f"{legal.astimezone(KITCHEN_ZONE):%H:%M}" if mine < win_start and legal - mine >= timedelta(minutes=SLOT_MINUTES) else None
        assert data["legal_end"] == expected, (starts[n], data)
        assert renter_view(renters[n].api, renters[n].id)["balance_minutes"] == 600
    holds = [b for b in station_blocks(renters[0].api, day)["convection-2"] if b["kind"] == "hold"]
    assert len(holds) == 1
    release_all(renters[win].api, [results[win].json()["bookings"][0]["id"]])


def test_wf_concurrent_claims_two_boards(browser: Browser, app_url: str) -> None:
    first = active_renter(app_url, minutes=600)
    second = active_renter(app_url, minutes=600)
    day = free_days(first.api, "deck-oven")[0]
    with ExitStack() as stack:
        pages = []
        for renter in (first, second):
            page = stack.enter_context(browser_page(browser, app_url, renter.email, renter.password))
            open_board(page, app_url, day)
            focus_cell(page, DECK, "10:00")
            shift_right(page, 4)
            expect(draft_ticket(page, "10:00", "11:00")).to_be_visible()
            pages.append(page)
        gates = [stack.enter_context(held(page, f"{URL_GLOB}/api/bookings")) for page in pages]
        for page in pages:
            page.keyboard.press("Enter")
            expect(announcer(page)).to_have_text(PLACING_COPY)
        for gate in gates:
            gate.release()

        def outcome(page: Page) -> bool | None:
            if page.get_by_role("button", name=f"Hold {DECK} 10:00 to 11:00", exact=True).count():
                return True
            if (announcer(page).text_content() or "").strip() == LOST_REMOVED:
                return False
            return None

        poll(lambda: all(outcome(p) is not None for p in pages), UI_TIMEOUT_MS / 1000, "both claims to settle")
        assert sorted(bool(outcome(p)) for p in pages) == [False, True]
        loser = next(p for p in pages if outcome(p) is False)
        expect(loser.get_by_role("img", name=re.compile(r"^Draft ticket "))).to_have_count(0)
        expect(balance_status(loser)).to_contain_text(hours_re("10.00"))
    held_rows = [b for r in (first, second) for b in own_bookings(r.api, day) if b["status"] == "hold"]
    assert len(held_rows) == 1
    for renter in (first, second):
        release_all(renter.api, [b["id"] for b in own_bookings(renter.api, day)])


def test_wf_concurrent_claims_shrink(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=WREN_OPENING_MINUTES)
    rival = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "deck-oven")[0]
    with browser_page(browser, app_url, renter.email, renter.password) as page:
        open_board(page, app_url, day)
        focus_cell(page, DECK, "10:00")
        shift_right(page, 8)
        with held(page, f"{URL_GLOB}/api/bookings") as gate:
            page.keyboard.press("Enter")
            expect(announcer(page)).to_have_text(PLACING_COPY)
            expect(draft_ticket(page, "10:00", "12:00")).to_be_visible()
            expect(page.get_by_role("button", name=re.compile(rf"^Hold {DECK} "))).to_have_count(0)
            expect(docket(page).get_by_role("timer", name="Hold countdown", exact=True)).to_have_count(0)
            expect(docket(page)).not_to_contain_text("Pending −")
            no_enabled_confirm(page)
            expect(balance_status(page)).to_contain_text(hours_re("16.00"))
            theirs = body(book(rival.api, "deck-oven", day, "11:00", "11:15"), 201)["bookings"][0]
            gate.release()
        legal_end = plus("11:00", -DECK_BUFFER)
        expect(announcer(page)).to_have_text(f"Another renter claimed this time first. Your ticket now ends at {legal_end}.")
        shrunk = draft_ticket(page, "10:00", legal_end)
        expect(shrunk).to_be_visible()
        expect(page.get_by_role("button", name=re.compile(rf"^Hold {DECK} "))).to_have_count(0)
        expect(balance_status(page)).to_contain_text(hours_re("20.00"))
        click(shrunk)
        expect(page.get_by_role("button", name=f"Hold {DECK} 10:00 to 10:15", exact=True)).to_be_visible()
    rows = [b for b in own_bookings(renter.api, day) if b["status"] == "hold"]
    assert [(b["start"], b["end"], b["minutes_debited"]) for b in rows] == [("10:00", "10:15", 30)]
    assert renter_view(renter.api, renter.id)["balance_minutes"] == WREN_OPENING_MINUTES - 30
    release_all(renter.api, [b["id"] for b in rows])
    release_all(rival.api, [theirs["id"]])


def test_cancellation_cutoff(app_url: str) -> None:
    renter = active_renter(app_url, minutes=1200)
    today = kitchen_today(renter.api)
    day = free_days(renter.api, "convection-1")[0]
    booking = body(book(renter.api, "convection-1", day, "10:00", "11:00"), 201)["bookings"][0]
    assert ISO_MS.match(booking["cancellation_cutoff_at"])
    assert parse_instant(booking["cancellation_cutoff_at"]) == instant(day - timedelta(days=CUTOFF_DAYS), "10:00")
    error(act(renter.api, booking["id"], "cancel"), 409, "invalid_transition")
    body(act(renter.api, booking["id"], "confirm"), 200)
    data = body(act(renter.api, booking["id"], "cancel"), 200)
    assert data["outcome"] == "credited" and data["minutes"] == 60 and data["booking"]["status"] == "cancelled"
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 1200
    debit, credit = pair_of(ledger(renter.api, renter.id), renter.id, "cancellation_credit")
    assert debit["minutes"] == 60 and credit["account"] == f"renter:{renter.id}:available"
    error(act(renter.api, booking["id"], "cancel"), 409, "invalid_transition")
    tomorrow = today + timedelta(days=1)
    station = idle_station(renter.api, [tomorrow], ("convection-1", "convection-2", "mixer-60", "prep-3"))
    late = body(book(renter.api, station, tomorrow, "20:00", "21:00"), 201)["bookings"][0]
    body(act(renter.api, late["id"], "confirm"), 200)
    data = body(act(renter.api, late["id"], "cancel"), 200)
    assert data["outcome"] == "forfeited" and data["minutes"] == late["minutes_debited"]
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 1200 - late["minutes_debited"]
    debit, credit = pair_of(ledger(renter.api, renter.id), renter.id, "cancellation_forfeit")
    assert credit["account"] == "kitchen:forfeited"
    spring, autumn = dst_changes(today)
    monday = next(c + timedelta(days=1) for c in (autumn, spring) if c and c + timedelta(days=1) <= today + timedelta(days=MAX_AHEAD_DAYS))
    station = idle_station(renter.api, [monday], ("convection-1", "convection-2", "mixer-60", "prep-3"))
    hold = body(book(renter.api, station, monday, "10:00", "11:00"), 201)["bookings"][0]
    cutoff = parse_instant(hold["cancellation_cutoff_at"])
    assert cutoff == instant(monday - timedelta(days=CUTOFF_DAYS), "10:00")
    assert f"{cutoff.astimezone(KITCHEN_ZONE):%H:%M}" == "10:00"
    release_all(renter.api, [hold["id"]])


def test_wf_cancellation_from_docket(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "convection-1")[0]
    booking = body(book(renter.api, "convection-1", day, "10:00", "11:00"), 201)["bookings"][0]
    body(act(renter.api, booking["id"], "confirm"), 200)
    with browser_page(browser, app_url, renter.email, renter.password) as page:
        open_board(page, app_url, day)
        ticket = page.get_by_role("button", name=f"Booking {CONV1} 10:00 to 11:00", exact=True)
        click(ticket)
        click(docket(page).get_by_role("button", name="Cancel booking", exact=True))
        dialog = page.get_by_role("alertdialog", name="Cancel booking", exact=True)
        returns = f"Cancelling now returns {hours(booking['minutes_debited'])} hours."
        expect(dialog).to_contain_text(returns)
        focused = page.evaluate_handle(ACTIVE_ELEMENT_JS)
        advance(page, REFRESH_MS)
        page.wait_for_load_state("networkidle")
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text(returns)
        assert page.evaluate(SAME_ELEMENT_JS, focused)
        click(dialog.get_by_role("button", name="Yes, cancel", exact=True))
        expect(dialog).to_have_count(0)
        expect(ticket).to_have_count(0)
        expect(booking_status(page)).to_have_text(f"Booking cancelled. {hours(booking['minutes_debited'])} hours returned to your balance.")
        expect(balance_status(page)).to_contain_text(hours_re("10.00"))
        expect(cell(page, CONV1, "10:00")).to_be_focused()
    assert booking_of(renter.api, booking["id"])["status"] == "cancelled"
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 600


def test_wf_cancellation_forfeit_ui(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=600)
    tomorrow = kitchen_today(renter.api) + timedelta(days=1)
    station = idle_station(renter.api, [tomorrow], ("convection-1", "convection-2", "mixer-60", "prep-3"))
    booking = body(book(renter.api, station, tomorrow, "20:00", "21:00"), 201)["bookings"][0]
    body(act(renter.api, booking["id"], "confirm"), 200)
    name = STATION_NAMES[station]
    with browser_page(browser, app_url, renter.email, renter.password, device_time=EARLY_DEVICE_TIME) as page:
        open_board(page, app_url, tomorrow)
        click(page.get_by_role("button", name=f"Booking {name} 20:00 to 21:00", exact=True))
        click(docket(page).get_by_role("button", name="Cancel booking", exact=True))
        dialog = page.get_by_role("alertdialog", name="Cancel booking", exact=True)
        expect(dialog).to_contain_text(f"Cancelling now forfeits {hours(booking['minutes_debited'])} hours.")
        click(dialog.get_by_role("button", name="Yes, cancel", exact=True))
        expect(booking_status(page)).to_have_text(f"Booking cancelled. {hours(booking['minutes_debited'])} hours were forfeited because it was within 48 hours of the start.")
    assert booking_of(renter.api, booking["id"])["status"] == "cancelled"
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 540


def test_weekly_series(app_url: str, mail: Any) -> None:
    renter = active_renter(app_url, minutes=1200)
    rival = active_renter(app_url, minutes=600)
    days = free_days(renter.api, "mixer-60", weeks=3)
    series = body(book(renter.api, "mixer-60", days[0], "10:00", "11:00", repeat=3), 201)["bookings"]
    assert [b["date"] for b in series] == [d.isoformat() for d in days]
    assert {b["series_id"] for b in series} != {None} and len({b["series_id"] for b in series}) == 1
    assert len({b["hold_expires_at"] for b in series}) == 1 and all(b["start"] == "10:00" and b["status"] == "hold" for b in series)
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 1200 - 180
    confirmed = body(act(renter.api, series[1]["id"], "confirm"), 200)["bookings"]
    assert sorted(b["status"] for b in confirmed) == ["confirmed"] * 3
    message = await_series_mail(mail, renter.email, MIXER, days)
    assert all(d.isoformat() in text(message[0]) for d in days)
    assert len(series_mails(mail, renter.email, MIXER, days, DUPLICATE_WINDOW_S)) == 1
    pair_days = free_days(renter.api, "prep-3", weeks=2)
    theirs = body(book(rival.api, "prep-3", pair_days[1], "10:30", "11:00"), 201)["bookings"][0]
    data = error(book(renter.api, "prep-3", pair_days[0], "10:00", "11:00", repeat=2), 409, "slot_conflict")
    assert (data["date"], data["blocked_by"], data["blocked_at"], data["legal_end"]) == (pair_days[1].isoformat(), "booking", "10:30", "10:15")
    assert own_bookings(renter.api, pair_days[0]) == []
    deck_days = free_days(renter.api, "deck-oven", weeks=2)
    data = error(book(renter.api, "deck-oven", deck_days[0], "10:00", "16:00", repeat=2), 409, "insufficient_hours")
    remaining = 1200 - 3 * 60
    assert data["needed_minutes"] == 2 * price(deck_days[0], "10:00", "16:00", 2, 50) and data["balance_minutes"] == remaining
    assert own_bookings(renter.api, deck_days[0]) == [] and own_bookings(renter.api, deck_days[1]) == []
    release_days = free_days(renter.api, "convection-2", weeks=2)
    pair = body(book(renter.api, "convection-2", release_days[0], "10:00", "11:00", repeat=2), 201)["bookings"]
    released = body(act(renter.api, pair[0]["id"], "release"), 200)["bookings"]
    assert sorted(b["status"] for b in released) == ["expired", "expired"]
    assert renter_view(renter.api, renter.id)["balance_minutes"] == remaining
    release_all(rival.api, [theirs["id"]])


def test_dst_wall_clock(app_url: str) -> None:
    renter = active_renter(app_url, minutes=WREN_OPENING_MINUTES)
    today = kitchen_today(renter.api)
    spring, autumn = dst_changes(today)
    made: list[Any] = []
    assert spring or autumn, "no daylight-saving change within the booking window"
    try:
        if autumn:
            autumn_checks(renter, autumn, made)
        if spring:
            spring_checks(renter, spring, made)
        last = today + timedelta(days=MAX_AHEAD_DAYS)
        candidates = [c for c in (autumn, spring) if c and c - timedelta(days=5) > today and c + timedelta(days=2) <= last]
        if not candidates:
            return
        change = candidates[0]
        tuesday = change - timedelta(days=5)
        weeks = [tuesday, tuesday + timedelta(weeks=1)]
        station = idle_station(renter.api, weeks, ("convection-1", "convection-2"))
        series = body(book(renter.api, station, tuesday, "05:00", "07:00", repeat=2), 201)["bookings"]
        made.extend(b["id"] for b in series)
        for booking, week in zip(series, weeks):
            assert booking["start"] == "05:00" and parse_instant(booking["starts_at"]) == instant(week, "05:00")
            assert booking["minutes_debited"] == price(week, "05:00", "07:00", 1, 50)
        gap = parse_instant(series[1]["starts_at"]) - parse_instant(series[0]["starts_at"])
        assert gap != timedelta(weeks=1) and abs(gap - timedelta(weeks=1)) == timedelta(hours=1)
    finally:
        release_all(renter.api, made)


def autumn_checks(renter: Renter, autumn: date, made: list[Any]) -> None:
    oven = idle_station(renter.api, [autumn], ("convection-1", "convection-2"))
    hold = body(book(renter.api, oven, autumn, "00:00", "04:00"), 201)["bookings"][0]
    made.append(hold["id"])
    assert hold["minutes_debited"] == 150
    start, end = parse_instant(hold["starts_at"]), parse_instant(hold["ends_at"])
    assert start == instant(autumn, "00:00") and end == instant(autumn, "04:00") and (end - start) == timedelta(minutes=300)
    release_all(renter.api, [made.pop()])
    flat = idle_station(renter.api, [autumn], ("mixer-60", "prep-3"))
    hold = body(book(renter.api, flat, autumn, "00:00", "04:00"), 201)["bookings"][0]
    made.append(hold["id"])
    assert hold["minutes_debited"] == 300
    release_all(renter.api, [made.pop()])
    hold = body(book(renter.api, oven, autumn, "01:15", "01:30"), 201)["bookings"][0]
    made.append(hold["id"])
    assert parse_instant(hold["starts_at"]) == instant(autumn, "01:15") and parse_instant(hold["starts_at"]).astimezone(KITCHEN_ZONE).tzname() == "CDT"
    release_all(renter.api, [made.pop()])


def spring_checks(renter: Renter, spring: date, made: list[Any]) -> None:
    oven_spring = idle_station(renter.api, [spring], ("convection-1", "convection-2"))
    message = f"That time does not exist on {spring.isoformat()} in the kitchen's time zone."
    assert error(book(renter.api, oven_spring, spring, "02:30", "03:30"), 422, "validation")["errors"]["start"] == message
    assert error(book(renter.api, oven_spring, spring, "01:00", "02:15"), 422, "validation")["errors"]["end"] == message
    hold = body(book(renter.api, oven_spring, spring, "01:00", "04:00"), 201)["bookings"][0]
    made.append(hold["id"])
    assert hold["minutes_debited"] == price(spring, "01:00", "04:00", 1, 50)
    release_all(renter.api, [made.pop()])


def test_wf_recurring_repeat_reprices(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=300)
    days = free_days(renter.api, "convection-1", weeks=3)
    with browser_page(browser, app_url, renter.email, renter.password) as page:
        open_board(page, app_url, days[0])
        focus_cell(page, CONV1, "10:00")
        shift_right(page, 8)
        expect(draft_ticket(page, "10:00", "12:00")).to_contain_text(hours_re("2.00"))
        expect(balance_status(page)).to_contain_text(hours_re("3.00"))
        repeat = docket(page).get_by_role("spinbutton", name="Repeat weekly for", exact=True)
        expect(repeat).to_have_value("1")
        fill(repeat, "3")
        draft = draft_ticket(page, "10:00", "11:30")
        expect(draft).to_contain_text(weeks_label(3))
        expect(draft).to_contain_text(hours_re("4.50"))
        expect(announcer(page)).to_have_text(stop_copy("11:30", f"your balance covers {hours(300)} hours"))
        expect(balance_status(page)).to_contain_text(hours_re("0.50"))
        fill(repeat, "2")
        expect(draft).to_contain_text(weeks_label(2))
        expect(draft).to_contain_text(hours_re("3.00"))
        expect(announcer(page)).to_have_text(f"{CONV1}, 10:00 to 11:30, 3.00 hours, buffer until 12:00.")
        expect(balance_status(page)).to_contain_text(hours_re("2.00"))
        expect(page).to_have_url(re.compile(rf"date={days[0].isoformat()}$"))
        cell(page, CONV1, "10:00").focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name=f"Hold {CONV1} 10:00 to 11:30", exact=True)).to_be_visible()
    rows = [b for d in days[:2] for b in own_bookings(renter.api, d)]
    assert [(b["status"], b["start"], b["end"], b["minutes_debited"]) for b in rows] == [("hold", "10:00", "11:30", 90)] * 2
    assert own_bookings(renter.api, days[2]) == []
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 120
    release_all(renter.api, [rows[0]["id"]])


def test_wf_recurring_series_confirm(browser: Browser, app_url: str, mail: Any) -> None:
    renter = active_renter(app_url, minutes=600)
    days = free_days(renter.api, "convection-2", weeks=2)
    with browser_page(browser, app_url, renter.email, renter.password) as page:
        open_board(page, app_url, days[0])
        focus_cell(page, CONV2, "10:00")
        shift_right(page, 4)
        fill(docket(page).get_by_role("spinbutton", name="Repeat weekly for", exact=True), "2")
        draft = draft_ticket(page, "10:00", "11:00")
        expect(draft).to_contain_text(weeks_label(2))
        expect(draft).to_contain_text(hours_re("2.00"))
        cell(page, CONV2, "10:00").focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name=f"Hold {CONV2} 10:00 to 11:00", exact=True)).to_be_visible()
        click(docket(page).get_by_role("button", name="Confirm booking", exact=True))
        expect(booking_status(page)).to_have_text(CONFIRMED_COPY)
    rows = [b for d in days for b in own_bookings(renter.api, d)]
    assert [b["status"] for b in rows] == ["confirmed", "confirmed"] and len({b["series_id"] for b in rows}) == 1
    message = text(await_series_mail(mail, renter.email, CONV2, days)[0])
    assert all(d.isoformat() in message for d in days)
    assert f"10:00–11:00 {zone_on(days[0], '10:00')}" in message and f"Sanitation buffer: {CONV_BUFFER} minutes, until {plus('11:00', CONV_BUFFER)}" in message
    assert len(series_mails(mail, renter.email, CONV2, days, DUPLICATE_WINDOW_S)) == 1


def test_wf_checkout_shift_sheet(browser: Browser, app_url: str, killbill: Any) -> None:
    renter = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "convection-2")[0]
    booking = body(book(renter.api, "convection-2", day, "14:00", "15:00"), 201)["bookings"][0]
    body(act(renter.api, booking["id"], "confirm"), 200)
    with browser_page(browser, app_url, SHIFT_EMAIL, path=f"/shift?date={day.isoformat()}") as page:
        sheet = page.get_by_role("table", name="Usage sheet", exact=True)
        row = sheet.get_by_role("row").filter(has_text=renter.business)
        expect(row).to_contain_text("Confirmed")
        status = page.get_by_role("status", name="Shift status", exact=True)
        click(page.get_by_role("button", name=f"Check in {renter.business}", exact=True))
        dialog = page.get_by_role("dialog", name="Check in", exact=True)
        start_box = dialog.get_by_role("textbox", name="Actual start", exact=True)
        expect(start_box).to_have_value(re.compile(r"^\d\d:(00|15|30|45)$"))
        actual_start = "14:00"
        fill(start_box, actual_start)
        click(dialog.get_by_role("button", name="Record check-in", exact=True))
        expect(status).to_have_text(f"Checked in at {actual_start}.")
        expect(row).to_contain_text("Checked in")
        click(page.get_by_role("button", name=f"Check out {renter.business}", exact=True))
        dialog = page.get_by_role("dialog", name="Check out", exact=True)
        fill(dialog.get_by_role("textbox", name="Actual end", exact=True), "15:30")
        click(dialog.get_by_role("button", name="Record check-out", exact=True))
        units = 2
        usd = (units * Decimal(CONV_OVERAGE_USD) / 4).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        expect(status).to_have_text(f"Checked out. Overage: {units} × 15 minutes, ${usd}.")
        expect(row).to_contain_text("Completed")
    done = booking_of(renter.api, booking["id"])
    assert (done["status"], done["actual_start"], done["actual_end"], done["overage_units"], done["overage_usd"]) == ("completed", "14:00", "15:30", 2, "24.00")
    items = [i for i in invoice_items(killbill, renter.id) if i.get("description") == f"Overage: {CONV2} {day.isoformat()}, 2 × 15 min"]
    assert len(items) == 1 and Decimal(str(items[0]["amount"])) == Decimal("24.00")


def test_overage_and_checkout_rules(app_url: str, killbill: Any) -> None:
    renter = active_renter(app_url, minutes=600)
    shift, down = sign_in(app_url, SHIFT_EMAIL), sign_in(billing_down_url(), SHIFT_EMAIL)
    late_day = free_days(renter.api, "convection-1")[0]
    early_day = free_days(renter.api, "convection-2")[0]
    late = body(book(renter.api, "convection-1", late_day, "10:00", "11:00"), 201)["bookings"][0]
    error(shift.post(f"/api/bookings/{late['id']}/check-in", json={"actual_start": "10:00"}), 409, "invalid_transition")
    body(act(renter.api, late["id"], "confirm"), 200)
    error(shift.post(f"/api/bookings/{late['id']}/check-out", json={"actual_end": "11:00"}), 409, "invalid_transition")
    error(shift.post(f"/api/bookings/{late['id']}/check-in", json={"actual_start": "10:07"}), 422, "validation")
    body(down.post(f"/api/bookings/{late['id']}/check-in", json={"actual_start": "10:00"}), 200)
    error(shift.post(f"/api/bookings/{late['id']}/check-out", json={"actual_end": "10:00"}), 422, "validation")
    error(down.post(f"/api/bookings/{late['id']}/check-out", json={"actual_end": "11:45"}), 503, "billing_unavailable")
    unchanged = booking_of(renter.api, late["id"])
    assert unchanged["status"] == "checked_in" and unchanged["actual_end"] is None
    done = body(shift.post(f"/api/bookings/{late['id']}/check-out", json={"actual_end": "11:45"}), 200)["booking"]
    rate = Decimal(done["overage_usd_per_hour"])
    expected = (3 * rate / 4).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    assert done["status"] == "completed" and done["overage_units"] == 3 and Decimal(done["overage_usd"]) == expected
    error(shift.post(f"/api/bookings/{late['id']}/check-out", json={"actual_end": "12:00"}), 409, "invalid_transition")
    charges = [i for i in invoice_items(killbill, renter.id) if i.get("description") == f"Overage: {CONV1} {late_day.isoformat()}, 3 × 15 min"]
    assert len(charges) == 1 and Decimal(str(charges[0]["amount"])) == expected
    early = body(book(renter.api, "convection-2", early_day, "10:00", "11:00"), 201)["bookings"][0]
    body(act(renter.api, early["id"], "confirm"), 200)
    body(down.post(f"/api/bookings/{early['id']}/check-in", json={"actual_start": "10:00"}), 200)
    done = body(down.post(f"/api/bookings/{early['id']}/check-out", json={"actual_end": "10:30"}), 200)["booking"]
    assert done["status"] == "completed" and done["overage_units"] == 0 and done["overage_usd"] == "0.00"
    data = ledger(renter.api, renter.id)
    assert data["balance_minutes"] == 480 and data["held_minutes"] == 0
    assert movement_kinds(data, renter.id).count("checkout") == 2
    _, credit = pair_of(data, renter.id, "checkout")
    assert credit["account"] == "kitchen:consumed" and credit["minutes"] == 60


def test_usage_sheet_day(app_url: str) -> None:
    shift = sign_in(app_url, SHIFT_EMAIL)
    default = body(shift.get("/api/usage-sheet"), 200)
    stations = body(shift.get("/api/stations"), 200)
    assert default["date"] == stations["date"] and default["time_zone"] == "America/Chicago"
    assert parse_instant(default["server_now"]).astimezone(KITCHEN_ZONE).date().isoformat() == default["date"]
    renter = active_renter(app_url, minutes=1200)
    day = empty_board_day(renter.api)
    for station, start, end in (("deck-oven", "11:00", "12:00"), ("convection-1", "11:00", "12:00"), ("prep-3", "09:00", "10:00")):
        booking = body(book(renter.api, station, day, start, end), 201)["bookings"][0]
        body(act(renter.api, booking["id"], "confirm"), 200)
    pending = body(book(renter.api, "mixer-60", day, "08:00", "09:00"), 201)["bookings"][0]
    sheet = body(shift.get("/api/usage-sheet", params={"date": day.isoformat()}), 200)
    rows = [r for r in sheet["rows"] if r["renter_business_name"] == renter.business]
    assert [(r["station_name"], r["start"], r["status"]) for r in rows] == [(PREP, "09:00", "confirmed"), (CONV1, "11:00", "confirmed"), (DECK, "11:00", "confirmed")]
    error(shift.get("/api/usage-sheet", params={"date": "not-a-date"}), 422, "validation")
    error(renter.api.get("/api/usage-sheet"), 403, "forbidden")
    release_all(renter.api, [pending["id"]])


def test_effective_dated_settings() -> None:
    base = short_url()
    op = operator(base)
    today = kitchen_today(op)
    renter = active_renter(base, minutes=3000)
    current = next(s for s in body(op.get("/api/stations"), 200)["stations"] if s["id"] == "prep-3")
    day = free_days(renter.api, "prep-3")[0]
    before = body(book(renter.api, "prep-3", day, "10:00", "11:00"), 201)["bookings"][0]
    assert before["hour_weight"] == current["hour_weight"] and before["buffer_minutes"] == current["buffer_minutes"]
    new = {"effective_from": today.isoformat(), "hour_weight": 2 if current["hour_weight"] != 2 else 3,
           "off_peak_percent": 80 if current["off_peak_percent"] != 80 else 90,
           "overage_usd_per_hour": "61.00" if current["overage_usd_per_hour"] != "61.00" else "62.00",
           "buffer_minutes": 45 if current["buffer_minutes"] != 45 else 30}
    saved = body(op.post(f"/api/stations/{PREP_ID}/settings", json=new), 201)["settings"]
    assert saved["station_id"] == "prep-3" and saved["hour_weight"] == new["hour_weight"]
    after = body(book(renter.api, "prep-3", day, "13:00", "14:00"), 201)["bookings"][0]
    assert (after["hour_weight"], after["off_peak_percent"], after["overage_usd_per_hour"], after["buffer_minutes"]) == (
        new["hour_weight"], new["off_peak_percent"], new["overage_usd_per_hour"], new["buffer_minutes"])
    assert after["minutes_debited"] == 60 * new["hour_weight"]
    kept = booking_of(renter.api, before["id"])
    assert (kept["hour_weight"], kept["buffer_minutes"], kept["minutes_debited"], kept["overage_usd_per_hour"]) == (
        before["hour_weight"], before["buffer_minutes"], before["minutes_debited"], before["overage_usd_per_hour"])
    later = (today + timedelta(days=5)).isoformat()
    future = {**new, "effective_from": later, "hour_weight": 1 if new["hour_weight"] != 1 else 3}
    body(op.post(f"/api/stations/{PREP_ID}/settings", json=future), 201)
    body(op.post(f"/api/stations/{PREP_ID}/settings", json={**future, "buffer_minutes": 60}), 201)
    station = next(s for s in body(op.get("/api/stations"), 200)["stations"] if s["id"] == "prep-3")
    assert station["hour_weight"] == new["hour_weight"] and station["buffer_minutes"] == new["buffer_minutes"]
    upcoming = [r for r in station["upcoming_settings"] if r["effective_from"] == later]
    assert len(upcoming) == 1 and upcoming[0]["buffer_minutes"] == 60 and upcoming[0]["hour_weight"] == future["hour_weight"]
    for field, value in (("effective_from", (today - timedelta(days=1)).isoformat()), ("hour_weight", 4), ("off_peak_percent", 55),
                         ("overage_usd_per_hour", "500.01"), ("buffer_minutes", 20), ("buffer_minutes", 135)):
        data = error(op.post(f"/api/stations/{PREP_ID}/settings", json={**new, field: value}), 422, "validation")
        assert data["errors"].get(field), (field, data)
    error(sign_in(base, SHIFT_EMAIL).post(f"/api/stations/{PREP_ID}/settings", json=new), 403, "forbidden")
    error(op.post("/api/stations/oven-9/settings", json=new), 404, "not_found")
    release_all(renter.api, [before["id"], after["id"]])


def test_wf_checkout_day_in_address(browser: Browser, app_url: str) -> None:
    today = kitchen_today(operator(app_url))
    later = today + timedelta(days=9)

    def heading(day: date) -> str:
        return f"Usage sheet for {day.strftime('%A')} {day.day} {day.strftime('%B')} {day.year}"

    with browser_page(browser, app_url, SHIFT_EMAIL, device_time=SKEWED_DEVICE_TIME) as page:
        expect(page).to_have_url(re.compile(rf"/shift\?date={today.isoformat()}$"))
        expect(page.get_by_role("heading", name=heading(today), exact=True)).to_be_visible()
        length = page.evaluate(HISTORY_LENGTH_JS)
        page.goto(f"{app_url}/shift?date={PROBE_BAD_DATE}")
        expect(page).to_have_url(re.compile(rf"/shift\?date={today.isoformat()}$"))
        assert page.evaluate(HISTORY_LENGTH_JS) == length + 1
        fill(page.get_by_role("textbox", name="Sheet date", exact=True), later.isoformat())
        expect(page).to_have_url(re.compile(rf"/shift\?date={later.isoformat()}$"))
        expect(page.get_by_role("heading", name=heading(later), exact=True)).to_be_visible()
        page.go_back()
        expect(page.get_by_role("heading", name=heading(today), exact=True)).to_be_visible()
        page.go_forward()
        expect(page.get_by_role("heading", name=heading(later), exact=True)).to_be_visible()
        page.reload()
        expect(page.get_by_role("heading", name=heading(later), exact=True)).to_be_visible()
        page.goto(app_url + "/board")
        expect(page).to_have_url(re.compile(rf"/board\?date={today.isoformat()}$"))
        expect(page.get_by_text(day_line(today), exact=True)).to_be_visible()
        click(page.get_by_role("button", name="Next day", exact=True))
        tomorrow = today + timedelta(days=1)
        expect(page).to_have_url(re.compile(rf"date={tomorrow.isoformat()}$"))
        expect(page.get_by_text(day_line(tomorrow), exact=True)).to_be_visible()
        page.go_back()
        expect(page).to_have_url(re.compile(rf"date={today.isoformat()}$"))
        page.go_forward()
        expect(page.get_by_text(day_line(tomorrow), exact=True)).to_be_visible()
        page.reload()
        expect(page.get_by_text(day_line(tomorrow), exact=True)).to_be_visible()
        click(page.get_by_role("button", name="Today", exact=True))
        expect(page).to_have_url(re.compile(rf"date={today.isoformat()}$"))
    assert body(sign_in(app_url, SHIFT_EMAIL).get("/api/usage-sheet"), 200)["date"] == today.isoformat()


def test_phone_navigation_collapsed(browser: Browser, app_url: str) -> None:
    with browser_page(browser, app_url, SHIFT_EMAIL, size=(375, 812)) as page:
        expect(page).to_have_url(re.compile(r"/shift\?date="))
        for width in (375, 767):
            page.set_viewport_size({"width": width, "height": 812})
            menu = page.get_by_role("button", name="Menu", exact=True)
            expect(menu).to_have_attribute("aria-expanded", "false")
            expect(page.get_by_role("link", name="Shift", exact=True)).to_have_count(0)
            expect(page.get_by_role("link", name="Board", exact=True)).to_have_count(0)
            layout(page)
            names_seen = tab_order(page, 8)
            assert "Board" not in names_seen and "Shift" not in names_seen, names_seen
        menu = page.get_by_role("button", name="Menu", exact=True)
        click(menu)
        expect(menu).to_have_attribute("aria-expanded", "true")
        nav = page.get_by_role("navigation", name="Main", exact=True)
        expect(nav.get_by_role("link").first).to_be_focused()
        assert set(tab_order(page, 6)) <= {"Menu", "Board", "Shift"}
        page.keyboard.press("Escape")
        expect(menu).to_be_focused()
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_role("link", name="Board", exact=True)).to_have_count(0)
        click(menu)
        click(page.get_by_role("link", name="Board", exact=True))
        expect(page).to_have_url(re.compile(r"/board"))
        expect(page.get_by_role("button", name="Menu", exact=True)).to_have_attribute("aria-expanded", "false")
        page.set_viewport_size({"width": 768, "height": 1024})
        expect(page.get_by_role("button", name="Menu", exact=True)).to_have_count(0)
        expect(page.get_by_role("link", name="Shift", exact=True)).to_be_visible()


def test_maintenance_displaces(app_url: str, mail: Any) -> None:
    shift = sign_in(app_url, SHIFT_EMAIL)
    a, b, c = (active_renter(app_url, minutes=600) for _ in range(3))
    day = free_days(a.api, "convection-1")[0]
    first = body(book(a.api, "convection-1", day, "10:00", "11:00"), 201)["bookings"][0]
    body(act(a.api, first["id"], "confirm"), 200)
    second = body(book(b.api, "convection-1", day, "11:30", "12:00"), 201)["bookings"][0]
    third = body(book(c.api, "convection-1", day, "08:30", "09:00"), 201)["bookings"][0]
    body(act(c.api, third["id"], "confirm"), 200)
    reason = "probe gasket failure"
    maintenance = f"/api/stations/{CONV1_ID}/maintenance"
    data = body(shift.post(maintenance, json={"date": day.isoformat(), "start": "09:30", "end": "11:45", "reason": reason}), 201)
    block = data["block"]
    assert (block["station_id"], block["date"], block["start"], block["end"], block["reason"]) == ("convection-1", day.isoformat(), "09:30", "11:45", reason)
    assert sorted(map(str, data["displaced_booking_ids"])) == sorted([str(first["id"]), str(second["id"])])
    assert booking_of(a.api, first["id"])["status"] == "displaced" and booking_of(b.api, second["id"])["status"] == "displaced"
    assert booking_of(c.api, third["id"])["status"] == "confirmed"
    for renter, booking in ((a, first), (b, second)):
        led = ledger(renter.api, renter.id)
        assert led["balance_minutes"] == 600 and led["held_minutes"] == 0
        debit, credit = pair_of(led, renter.id, "displacement_credit")
        assert debit["minutes"] == booking["minutes_debited"] and credit["account"] == f"renter:{renter.id}:available"
        message = await_mail(mail, renter.email, f"Booking displaced: {CONV1} on {day.isoformat()}")
        assert reason in text(message[0]) and f"{hours(booking['minutes_debited'])} hours returned to your balance" in text(message[0])
    for renter in (a, b):
        assert len(mails_to(mail, renter.email, f"Booking displaced: {CONV1} on {day.isoformat()}", DUPLICATE_WINDOW_S)) == 1
    assert mails_to(mail, c.email, f"Booking displaced: {CONV1} on {day.isoformat()}") == []
    error(shift.post(maintenance, json={"date": day.isoformat(), "start": "11:00", "end": "12:00", "reason": "x"}), 409, "slot_conflict")
    error(shift.post(maintenance, json={"date": day.isoformat(), "start": "13:00", "end": "12:00", "reason": "x"}), 422, "validation")
    error(shift.post(maintenance, json={"date": day.isoformat(), "start": "13:00", "end": "14:00", "reason": ""}), 422, "validation")
    error(a.api.post(maintenance, json={"date": day.isoformat(), "start": "13:00", "end": "14:00", "reason": "x"}), 403, "forbidden")
    error(shift.post("/api/stations/oven-9/maintenance", json={"date": day.isoformat(), "start": "13:00", "end": "14:00", "reason": "x"}), 404, "not_found")
    busy = body(book(c.api, "convection-1", day, "14:00", "15:00"), 201)["bookings"][0]
    body(act(c.api, busy["id"], "confirm"), 200)
    body(shift.post(f"/api/bookings/{busy['id']}/check-in", json={"actual_start": "14:00"}), 200)
    error(shift.post(maintenance, json={"date": day.isoformat(), "start": "14:30", "end": "15:30", "reason": "x"}), 409, "station_in_use")
    assert booking_of(c.api, busy["id"])["status"] == "checked_in"
    assert [blk for blk in station_blocks(shift, day)["convection-1"] if blk["kind"] == "maintenance" and blk["start"] == "14:30"] == []
    body(shift.delete(f"/api/maintenance/{block['id']}"), 204)
    assert booking_of(a.api, first["id"])["status"] == "displaced"
    again = body(book(a.api, "convection-1", day, "10:00", "11:00"), 201)["bookings"][0]
    release_all(a.api, [again["id"]])


def test_wf_maintenance_displacement_in_place(browser: Browser, app_url: str, mail: Any) -> None:
    renter = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "convection-2")[0]
    booking = body(book(renter.api, "convection-2", day, "10:00", "11:00"), 201)["bookings"][0]
    body(act(renter.api, booking["id"], "confirm"), 200)
    with browser_page(browser, app_url, renter.email, renter.password) as board:
        open_board(board, app_url, day)
        ticket = board.get_by_role("button", name=f"Booking {CONV2} 10:00 to 11:00", exact=True)
        expect(ticket).to_be_visible()
        with browser_page(browser, app_url, SHIFT_EMAIL, path=f"/shift?date={day.isoformat()}") as page:
            click(page.get_by_role("button", name="Block station", exact=True))
            dialog = page.get_by_role("dialog", name="Block station", exact=True)
            choose(dialog.get_by_role("combobox", name="Station", exact=True), CONV2)
            fill(dialog.get_by_role("textbox", name="Date", exact=True), day.isoformat())
            fill(dialog.get_by_role("textbox", name="From", exact=True), "10:00")
            fill(dialog.get_by_role("textbox", name="Until", exact=True), "11:00")
            fill(dialog.get_by_role("textbox", name="Reason", exact=True), "probe fan repair")
            click(dialog.get_by_role("button", name="Save block", exact=True))
            displaced = 1
            expect(page.get_by_role("status", name="Shift status", exact=True)).to_have_text(f"Station blocked. {displaced} bookings displaced. Affected renters are being emailed.")
        advance(board, REFRESH_MS)
        expect(ticket).to_have_count(0)
        expect(booking_status(board)).to_have_text(f"Your booking on {CONV2} 10:00–11:00 was displaced by maintenance. 1.00 hours returned to your balance.")
        expect(balance_status(board)).to_contain_text(hours_re("10.00"))
        expect(maintenance_block(board, "10:00", "11:00")).to_be_visible()
    assert booking_of(renter.api, booking["id"])["status"] == "displaced"
    assert renter_view(renter.api, renter.id)["balance_minutes"] == 600
    await_mail(mail, renter.email, f"Booking displaced: {CONV2} on {day.isoformat()}")
    maintenance = [blk for blk in station_blocks(sign_in(app_url, SHIFT_EMAIL), day)["convection-2"] if blk["kind"] == "maintenance"]
    assert [(blk["start"], blk["end"]) for blk in maintenance] == [("10:00", "11:00")]


def test_wf_maintenance_station_in_use(browser: Browser, app_url: str, mail: Any) -> None:
    renter = active_renter(app_url, minutes=600)
    shift = sign_in(app_url, SHIFT_EMAIL)
    day = free_days(renter.api, "mixer-60")[0]
    booking = body(book(renter.api, "mixer-60", day, "10:00", "11:00"), 201)["bookings"][0]
    body(act(renter.api, booking["id"], "confirm"), 200)
    body(shift.post(f"/api/bookings/{booking['id']}/check-in", json={"actual_start": "10:00"}), 200)
    with browser_page(browser, app_url, SHIFT_EMAIL, path=f"/shift?date={day.isoformat()}") as page:
        click(page.get_by_role("button", name="Block station", exact=True))
        dialog = page.get_by_role("dialog", name="Block station", exact=True)
        choose(dialog.get_by_role("combobox", name="Station", exact=True), MIXER)
        fill(dialog.get_by_role("textbox", name="Date", exact=True), day.isoformat())
        fill(dialog.get_by_role("textbox", name="From", exact=True), "10:30")
        fill(dialog.get_by_role("textbox", name="Until", exact=True), "11:30")
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), "probe")
        click(dialog.get_by_role("button", name="Save block", exact=True))
        expect(page.get_by_role("status", name="Shift status", exact=True)).to_have_text("Someone is checked in on that station during that time.")
    assert booking_of(renter.api, booking["id"])["status"] == "checked_in"
    assert [b for b in station_blocks(shift, day)["mixer-60"] if b["kind"] == "maintenance"] == []
    assert mails_to(mail, renter.email, f"Booking displaced: {MIXER} on {day.isoformat()}", DUPLICATE_WINDOW_S) == []


def test_notification_outbox(browser: Browser, app_url: str, mail: Any) -> None:
    down = mail_down_url()
    renter = active_renter(app_url, minutes=600)
    api = sign_in(down, renter.email, renter.password)
    day = free_days(api, "prep-3")[0]
    hold = body(book(api, "prep-3", day, "10:00", "11:00"), 201)["bookings"][0]
    body(act(api, hold["id"], "confirm"), 200)
    subject = f"Booking confirmed: {PREP} on {day.isoformat()}"
    op = operator(down)

    def listed() -> list[dict[str, Any]]:
        return [n for n in body(op.get("/api/notifications"), 200)["notifications"] if n["to"] == renter.email and n["kind"] == "booking_confirmed"]

    first = listed()
    assert len(first) == 1 and first[0]["status"] in ("queued", "sent") and first[0]["subject"] == subject
    await_mail(mail, renter.email, subject)
    sent = poll(lambda: [n for n in listed() if n["status"] == "sent"], MAIL_WAIT_S, "notification marked sent")
    assert sent[0]["sent_at"] and sent[0]["attempts"] >= 1
    assert len(mails_to(mail, renter.email, subject, DUPLICATE_WINDOW_S)) == 1
    with browser_page(browser, app_url, OPERATOR_EMAIL, path="/operator") as page:
        row = page.get_by_role("table", name="Notifications", exact=True).get_by_role("row").filter(has_text=renter.email)
        expect(row).to_contain_text("Sent")


def test_lapsed_documents_block_bookings(app_url: str) -> None:
    op = operator(app_url)
    today = kitchen_today(op)
    fennel = seeded_renter(op, FENNEL)
    assert fennel["compliance"]["state"] == "lapsed" and date.fromisoformat(fennel["compliance"]["coi_expires_on"]) < today
    ines = sign_in(app_url, INES_EMAIL)
    day = free_days(ines, "prep-3")[0]
    error(book(ines, "prep-3", day, "10:00", "11:00"), 409, "compliance_lapsed")
    assert own_bookings(ines, day) == []
    edge = active_renter(app_url, minutes=600, coi_days=0)
    view = renter_view(edge.api, edge.id)
    assert view["compliance"]["coi_expires_on"] == today.isoformat() and view["compliance"]["state"] == "expiring"
    hold = body(book(edge.api, "prep-3", day, "10:00", "11:00"), 201)["bookings"][0]
    release_all(edge.api, [hold["id"]])
    applied = apply_renter(app_url)
    error(book(applied.api, "prep-3", day, "10:00", "11:00"), 409, "renter_not_active")


def test_compliance_scan_notices(app_url: str, mail: Any) -> None:
    op = operator(app_url)
    fennel = seeded_renter(op, FENNEL)
    assert fennel["status"] == "suspended"
    primary_notes = body(op.get("/api/notifications"), 200)["notifications"]
    ines_expired = [n for n in primary_notes if n["to"] == INES_EMAIL and n["kind"] == "document_expired"]
    assert len(ines_expired) == 1 and ines_expired[0]["status"] in ("queued", "sent"), ines_expired
    assert ines_expired[0]["subject"] == f"Your {KIND_LABEL['coi']} has expired"
    base = short_url()
    renter = active_renter(base, coi_days=EXPIRING_WINDOW_DAYS, card_days=EXPIRING_WINDOW_DAYS + 1)
    today = kitchen_today(renter.api)
    coi_subject = f"Your {KIND_LABEL['coi']} expires on {(today + timedelta(days=EXPIRING_WINDOW_DAYS)).isoformat()}"
    card_subject = f"Your {KIND_LABEL['food_handler_card']} expires on {(today + timedelta(days=EXPIRING_WINDOW_DAYS + 1)).isoformat()}"
    await_mail(mail, renter.email, coi_subject)
    assert len(mails_to(mail, renter.email, coi_subject, SCAN_WINDOW_S)) == 1
    assert mails_to(mail, renter.email, card_subject) == []
    view = renter_view(renter.api, renter.id)
    assert view["status"] == "active" and view["compliance"]["state"] == "expiring"
    notes = body(operator(base).get("/api/notifications"), 200)["notifications"]
    assert len([n for n in notes if n["to"] == renter.email and n["kind"] == "document_expiring"]) == 1


def test_wf_compliance_lapse_reinstatement(browser: Browser) -> None:
    base = short_url()
    op = operator(base)
    today = kitchen_today(op)
    fennel = seeded_renter(op, FENNEL)
    fid = str(fennel["id"])
    cois = [d for d in body(op.get(f"/api/renters/{fid}/documents"), 200)["documents"] if d["kind"] == "coi"]
    ines = sign_in(base, INES_EMAIL)
    day = free_days(ines, "mixer-60")[0]
    if len(cois) == 1:
        assert fennel["status"] == "suspended"
        error(book(ines, "mixer-60", day, "10:00", "11:00"), 409, "compliance_lapsed")
    else:
        assert fennel["status"] == "active" and any(c["status"] == "approved" and date.fromisoformat(c["expires_on"]) >= today for c in cois)
    expiry = (today + timedelta(days=FRESH_EXPIRY_DAYS)).isoformat()
    label = KIND_LABEL["coi"]
    with browser_page(browser, base, INES_EMAIL, path="/kitchen") as page:
        documents = page.get_by_role("region", name="Documents", exact=True)
        choose(documents.get_by_role("combobox", name="Document type", exact=True), label)
        fill(documents.get_by_role("textbox", name="Expiry date", exact=True), expiry)
        documents.get_by_label("Scan file", exact=True).set_input_files(files=[pdf_payload()])
        click(documents.get_by_role("button", name="Upload document", exact=True))
        expect(page.get_by_role("status", name="Upload status", exact=True)).to_have_text(f"{label} uploaded. It's waiting for review.")
        expect(documents).to_contain_text("Waiting for review")
    with browser_page(browser, base, OPERATOR_EMAIL, path="/operator") as page:
        click(page.get_by_role("button", name=f"Review {FENNEL}", exact=True))
        dialog = page.get_by_role("dialog", name=f"Review {FENNEL}", exact=True)
        click(dialog.get_by_role("button", name=f"Approve {label}", exact=True))
        expect(page.get_by_role("status", name="Operator status", exact=True)).to_have_text(f"{label} approved.")
    view = renter_view(op, fid)
    assert view["status"] == "active" and view["compliance"]["coi_expires_on"] == expiry and view["compliance"]["state"] != "lapsed"
    hold = body(book(ines, "mixer-60", day, "10:00", "11:00"), 201)["bookings"][0]
    release_all(ines, [hold["id"]])


def test_wf_compliance_lapse_server_clock(browser: Browser, app_url: str) -> None:
    op = operator(app_url)
    today = kitchen_today(op)
    current = active_renter(app_url)
    expiring = active_renter(app_url, coi_days=EXPIRING_PROBE_DAYS)
    cases = ((current.email, current.password, "Compliance: current"),
             (expiring.email, expiring.password, f"Compliance: expires {(today + timedelta(days=EXPIRING_PROBE_DAYS)).isoformat()}"),
             (INES_EMAIL, PASSWORD, "Compliance: lapsed"))
    for email, password, line in cases:
        with browser_page(browser, app_url, email, password, device_time=SKEWED_DEVICE_TIME) as page:
            expect(page).to_have_url(re.compile(rf"/board\?date={today.isoformat()}$"))
            expect(page.get_by_text(day_line(today), exact=True)).to_be_visible()
            expect(docket(page)).to_contain_text(line)
            if email == current.email:
                expect(page.get_by_role("img", name="Now", exact=True)).to_be_visible()
                click(page.get_by_role("button", name="Next day", exact=True))
                expect(page.get_by_role("img", name="Now", exact=True)).to_have_count(0)
                page.goto(app_url + "/kitchen")
                expect(page.get_by_role("region", name="Documents", exact=True)).to_contain_text("Approved")
    with browser_page(browser, app_url, OPERATOR_EMAIL, path="/operator", device_time=SKEWED_DEVICE_TIME) as page:
        click(page.get_by_role("button", name=f"Review {FENNEL}", exact=True))
        dialog = page.get_by_role("dialog", name=f"Review {FENNEL}", exact=True)
        expect(dialog).to_contain_text("Expired")
        expect(dialog.get_by_role("button", name=f"Approve {KIND_LABEL['coi']}", exact=True)).to_have_count(0)
    assert renter_view(op, current.id)["compliance"]["state"] == "current"
    assert renter_view(op, expiring.id)["compliance"]["state"] == "expiring"


def create_link(op: httpx.Client, label: str, seconds: int) -> dict[str, Any]:
    return body(op.post("/api/compliance-links", json={"label": label, "expires_in_seconds": seconds}), 201)["link"]


def test_compliance_link_lifecycle(app_url: str) -> None:
    op = operator(app_url)
    anon = client(app_url)
    tag, _ = names("link")
    link = create_link(op, f"Inspector {tag}", LINK_MIN_SECONDS)
    assert re.fullmatch(r"[A-Za-z0-9_-]{32,}", link["token"]) and link["url"] == f"/share/{link['token']}" and link["revoked_at"] is None
    assert abs((parse_instant(link["expires_at"]) - parse_instant(link["created_at"])).total_seconds() - LINK_MIN_SECONDS) <= CLOCK_SLACK_S
    body(anon.get(f"/api/share/{link['token']}"), 200)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        error(anon.request(method, f"/api/share/{link['token']}", json={}), 405, "read_only")
    error(anon.post(f"/api/share/{link['token']}/documents/{UNKNOWN_ID}", json={}), 405, "read_only")
    error(anon.post(f"/api/share/{UNKNOWN_ID}", json={}), 405, "read_only")
    body(anon.get(f"/api/share/{link['token']}"), 200)
    poll(lambda: anon.get(f"/api/share/{link['token']}").status_code == 404, LINK_MIN_SECONDS + MAIL_WAIT_S, "link expiry")
    assert server_now(op) >= parse_instant(link["expires_at"])
    revocable = create_link(op, f"Landlord {tag}", ONE_DAY_SECONDS)
    body(anon.get(f"/api/share/{revocable['token']}"), 200)
    revoked = body(op.post(f"/api/compliance-links/{revocable['id']}/revoke", json={}), 200)["link"]
    assert revoked["revoked_at"]
    error(anon.get(f"/api/share/{revocable['token']}"), 404, "not_found")
    error(op.post(f"/api/compliance-links/{revocable['id']}/revoke", json={}), 409, "already_revoked")
    error(op.post(f"/api/compliance-links/{revocable['id']}/regenerate", json={}), 409, "already_revoked")
    rotating = create_link(op, f"Auditor {tag}", ONE_DAY_SECONDS)
    fresh = body(op.post(f"/api/compliance-links/{rotating['id']}/regenerate", json={}), 200)["link"]
    assert fresh["token"] != rotating["token"] and fresh["url"] == f"/share/{fresh['token']}"
    assert abs((parse_instant(fresh["expires_at"]) - server_now(op)).total_seconds() - ONE_DAY_SECONDS) <= CLOCK_SLACK_S * 4
    error(anon.get(f"/api/share/{rotating['token']}"), 404, "not_found")
    body(anon.get(f"/api/share/{fresh['token']}"), 200)
    for bad in ({"label": "", "expires_in_seconds": ONE_DAY_SECONDS}, {"label": "x" * (LINK_LABEL_MAX + 1), "expires_in_seconds": ONE_DAY_SECONDS},
                {"label": "ok", "expires_in_seconds": LINK_MIN_SECONDS - 1}, {"label": "ok", "expires_in_seconds": LINK_MAX_SECONDS + 1}):
        error(op.post("/api/compliance-links", json=bad), 422, "validation")
    labels = [l["label"] for l in body(op.get("/api/compliance-links"), 200)["links"]]
    assert f"Auditor {tag}" in labels and "ok" not in labels
    body(op.post(f"/api/compliance-links/{fresh['id']}/revoke", json={}), 200)


def collect_keys(node: Any) -> set[str]:
    if isinstance(node, dict):
        return set(node) | set().union(*(collect_keys(v) for v in node.values()))
    if isinstance(node, list):
        return set().union(*(collect_keys(v) for v in node)) if node else set()
    return set()


def test_compliance_link_contents(app_url: str) -> None:
    op = operator(app_url)
    today = kitchen_today(op)
    renter = active_renter(app_url, minutes=600)
    docs = body(renter.api.get(f"/api/renters/{renter.id}/documents"), 200)["documents"]
    newer = body(upload(renter.api, renter.id, "coi", (today + timedelta(days=250)).isoformat()), 201)["document"]
    body(review(op, newer["id"]), 200)
    pending = body(upload(renter.api, renter.id, "coi", (today + timedelta(days=260)).isoformat()), 201)["document"]
    rejected = body(upload(renter.api, renter.id, "food_handler_card", (today + timedelta(days=260)).isoformat()), 201)["document"]
    body(review(op, rejected["id"], "reject"), 200)
    card = next(d for d in docs if d["kind"] == "food_handler_card")
    licence = next(d for d in docs if d["kind"] == "business_licence")
    applied = apply_renter(app_url)
    for kind in ("coi", "food_handler_card", "business_licence"):
        upload(applied.api, applied.id, kind, (today + timedelta(days=FRESH_EXPIRY_DAYS)).isoformat())
    gone = active_renter(app_url)
    body(op.post(f"/api/renters/{gone.id}/transitions", json={"to": "offboarded"}), 200)
    link = create_link(op, "Contents probe", ONE_DAY_SECONDS)
    response = client(app_url).get(f"/api/share/{link['token']}")
    data = body(response, 200)
    assert data["kitchen"] == {"name": KITCHEN_NAME, "address": KITCHEN_ADDRESS}
    ours = [r for r in data["renters"] if r["business_name"] == renter.business]
    assert len(ours) == 1
    listed = {d["kind"]: d for d in ours[0]["documents"]}
    assert len(ours[0]["documents"]) == 3
    assert str(listed["coi"]["id"]) == str(newer["id"]) and str(listed["food_handler_card"]["id"]) == str(card["id"])
    assert str(listed["business_licence"]["id"]) == str(licence["id"])
    for document in ours[0]["documents"]:
        assert document["label"] == KIND_LABEL[document["kind"]]
        assert document["file_url"] == f"/api/share/{link['token']}/documents/{document['id']}"
    shown = {str(d["id"]) for r in data["renters"] for d in r["documents"]}
    assert str(pending["id"]) not in shown and str(rejected["id"]) not in shown
    names_listed = [r["business_name"] for r in data["renters"]]
    assert applied.business not in names_listed and gone.business not in names_listed
    fennel = [r for r in data["renters"] if r["business_name"] == FENNEL]
    assert len(fennel) == 1 and "coi" not in {d["kind"] for d in fennel[0]["documents"]}
    for secret in (renter.email, renter.contact, renter.phone, INES_EMAIL, "Ines Marchetti"):
        assert secret not in response.text
    assert not collect_keys(data) & {"balance_minutes", "held_minutes", "email", "phone", "contact_name", "status", "entries"}
    body(op.post(f"/api/compliance-links/{link['id']}/revoke", json={}), 200)


def test_private_files_signed(app_url: str) -> None:
    op = operator(app_url)
    renter = active_renter(app_url)
    pending = body(upload(renter.api, renter.id, "coi", (kitchen_today(op) + timedelta(days=250)).isoformat()), 201)["document"]
    approved = next(d for d in body(renter.api.get(f"/api/renters/{renter.id}/documents"), 200)["documents"] if d["kind"] == "food_handler_card")
    response = renter.api.get(f"/api/documents/{approved['id']}/file")
    assert response.status_code == 302, response.text
    location = response.headers["location"]
    fetched = httpx.get(location, timeout=HTTP_TIMEOUT_S)
    assert fetched.status_code == 200 and fetched.content == PDF_BYTES
    bare = httpx.get(urlunparse(urlparse(location)._replace(query="")), timeout=HTTP_TIMEOUT_S)
    assert bare.status_code != 200 and bare.content != PDF_BYTES
    assert op.get(f"/api/documents/{approved['id']}/file").status_code == 302
    error(client(app_url).get(f"/api/documents/{approved['id']}/file"), 401, "unauthenticated")
    month = kitchen_today(op).strftime("%Y-%m")
    statement = body(renter.api.post(f"/api/renters/{renter.id}/statements", json={"month": month}), 201)["statement"]
    response = renter.api.get(f"/api/statements/{statement['id']}/file")
    assert response.status_code == 302
    assert httpx.get(response.headers["location"], timeout=HTTP_TIMEOUT_S).content.startswith(b"%PDF-")
    link = create_link(op, "Files probe", ONE_DAY_SECONDS)
    anon = client(app_url)
    shared = anon.get(f"/api/share/{link['token']}/documents/{approved['id']}")
    assert shared.status_code == 302 and httpx.get(shared.headers["location"], timeout=HTTP_TIMEOUT_S).content == PDF_BYTES
    error(anon.get(f"/api/share/{link['token']}/documents/{pending['id']}"), 404, "not_found")
    body(op.post(f"/api/compliance-links/{link['id']}/revoke", json={}), 200)
    error(anon.get(f"/api/share/{link['token']}/documents/{approved['id']}"), 404, "not_found")


def test_wf_compliance_links_inspector(browser: Browser, app_url: str) -> None:
    op = operator(app_url)
    renter = active_renter(app_url, card_days=FRESH_EXPIRY_DAYS + 10)
    coi_date = (kitchen_today(op) + timedelta(days=FRESH_EXPIRY_DAYS)).isoformat()
    tag, _ = names("inspector")
    label = f"Health inspector {tag}"
    origin = "{0.scheme}://{0.netloc}".format(urlparse(app_url))
    with browser_page(browser, app_url, OPERATOR_EMAIL, path="/operator") as page:
        page.context.grant_permissions(CLIPBOARD_PERMISSIONS, origin=origin)
        links = page.get_by_role("region", name="Compliance links", exact=True)
        status = page.get_by_role("status", name="Operator status", exact=True)
        fill(links.get_by_role("textbox", name="Link label", exact=True), label)
        choose(links.get_by_role("combobox", name="Expires after", exact=True), "1 day")
        click(links.get_by_role("button", name="Create link", exact=True))
        link = poll(lambda: next((l for l in body(op.get("/api/compliance-links"), 200)["links"] if l["label"] == label), None), UI_TIMEOUT_MS / 1000, "link record")
        assert link["expires_in_seconds"] == ONE_DAY_SECONDS
        expect(status).to_have_text(f"Link created. It works until {local_stamp(link['expires_at'])}.")
        expect(links).to_contain_text(f"Live until {local_stamp(link['expires_at'])}")
        click(links.get_by_role("button", name=f"Copy link {label}", exact=True))
        expect(links.get_by_text("Copied", exact=True)).to_be_visible()
        copied = page.evaluate(CLIPBOARD_READ_JS)
        assert copied.startswith("http") and copied.endswith(f"/share/{link['token']}"), copied
        with open_app(browser, copied) as inspector:
            expect(inspector.get_by_role("heading", name="Current compliance documents", exact=True)).to_be_visible()
            expect(inspector.get_by_text(KITCHEN_NAME).first).to_be_visible()
            expect(inspector.get_by_text(KITCHEN_ADDRESS).first).to_be_visible()
            expect(inspector.get_by_role("heading", name=renter.business, exact=True)).to_be_visible()
            expect(inspector.get_by_text(f"Expires {coi_date}").first).to_be_visible()
            scan = inspector.get_by_role("link", name=f"Open certificate of insurance for {renter.business}", exact=True)
            href = scan.get_attribute("href") or ""
            opened = inspector.request.get(urljoin(copied, href))
            assert opened.ok and opened.body() == PDF_BYTES
            click(links.get_by_role("button", name=f"Revoke {label}", exact=True))
            expect(status).to_have_text("Link revoked.")
            expect(links).to_contain_text("Revoked")
            inspector.reload()
            expect(inspector.get_by_role("heading", name=DEAD_LINK_HEADING, exact=True)).to_be_visible()
            expect(inspector.get_by_text(DEAD_LINK_BODY, exact=True)).to_be_visible()
            expect(inspector.get_by_role("heading", name=renter.business, exact=True)).to_have_count(0)
    error(client(app_url).get(f"/api/share/{link['token']}"), 404, "not_found")


def test_wf_compliance_links_regenerate(browser: Browser, app_url: str) -> None:
    op = operator(app_url)
    tag, _ = names("regen")
    label = f"Landlord {tag}"
    with browser_page(browser, app_url, OPERATOR_EMAIL, path="/operator") as page:
        links = page.get_by_role("region", name="Compliance links", exact=True)
        fill(links.get_by_role("textbox", name="Link label", exact=True), label)
        choose(links.get_by_role("combobox", name="Expires after", exact=True), "7 days")
        click(links.get_by_role("button", name="Create link", exact=True))
        old = poll(lambda: next((l for l in body(op.get("/api/compliance-links"), 200)["links"] if l["label"] == label), None), UI_TIMEOUT_MS / 1000, "link record")
        assert old["expires_in_seconds"] == SEVEN_DAY_SECONDS
        click(links.get_by_role("button", name=f"Regenerate {label}", exact=True))
        expect(page.get_by_role("status", name="Operator status", exact=True)).to_have_text("New link created. The old link no longer works.")
    new = next(l for l in body(op.get("/api/compliance-links"), 200)["links"] if l["label"] == label)
    assert new["token"] != old["token"]
    with open_app(browser, f"{app_url}/share/{old['token']}") as inspector:
        expect(inspector.get_by_role("heading", name=DEAD_LINK_HEADING, exact=True)).to_be_visible()
        inspector.goto(f"{app_url}/share/{new['token']}")
        expect(inspector.get_by_role("heading", name="Current compliance documents", exact=True)).to_be_visible()
    error(client(app_url).get(f"/api/share/{old['token']}"), 404, "not_found")
    body(client(app_url).get(f"/api/share/{new['token']}"), 200)
    body(op.post(f"/api/compliance-links/{new['id']}/revoke", json={}), 200)


def test_wf_statements_shelf_statement(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=600)
    op = operator(app_url)
    month = kitchen_today(op).strftime("%Y-%m")
    with browser_page(browser, app_url, renter.email, renter.password, path="/kitchen") as page:
        statements = page.get_by_role("region", name="Statements", exact=True)
        fill(statements.get_by_role("textbox", name="Statement month", exact=True), month)
        click(statements.get_by_role("button", name="Create statement", exact=True))
        expect(page.get_by_role("status", name="Statement status", exact=True)).to_have_text(f"Statement for {month} is ready.")
        download = statements.get_by_role("link", name=f"Download {month} statement", exact=True)
        expect(download).to_be_visible()
        fetched = page.request.get(urljoin(app_url + "/", download.get_attribute("href") or ""))
        assert fetched.ok and fetched.body().startswith(b"%PDF-")
    listed = body(renter.api.get(f"/api/renters/{renter.id}/statements"), 200)["statements"]
    assert [s["month"] for s in listed] == [month]
    keys = S3().keys(f"renters/{renter.id}/statements/")
    assert len(keys) == 1 and re.fullmatch(STATEMENT_KEY.format(rid=re.escape(renter.id), month=month), keys[0])
    assert S3().get(keys[0]).startswith(b"%PDF-")
    other = active_renter(app_url)
    statement_id = listed[0]["id"]
    for foreign, missing in (
        (other.api.get(f"/api/statements/{statement_id}/file"), other.api.get(f"/api/statements/{UNKNOWN_ID}/file")),
        (other.api.get(f"/api/renters/{renter.id}/statements"), other.api.get(f"/api/renters/{UNKNOWN_ID}/statements")),
        (other.api.post(f"/api/renters/{renter.id}/statements", json={"month": month}),
         other.api.post(f"/api/renters/{UNKNOWN_ID}/statements", json={"month": month})),
    ):
        assert foreign.status_code == missing.status_code == 404, (foreign.text, missing.text)
        assert foreign.json() == missing.json() == {"error": "not_found"}
        assert "Location" not in foreign.headers
    assert len(S3().keys(f"renters/{renter.id}/statements/")) == 1
    assert len(body(renter.api.get(f"/api/renters/{renter.id}/statements"), 200)["statements"]) == 1
    body(op.post(f"/api/renters/{renter.id}/statements", json={"month": month}), 201)
    assert len(body(renter.api.get(f"/api/renters/{renter.id}/statements"), 200)["statements"]) == 2
    future = (kitchen_today(op).replace(day=1) + timedelta(days=40)).strftime("%Y-%m")
    for bad in (future, "2026-13", "nope"):
        error(renter.api.post(f"/api/renters/{renter.id}/statements", json={"month": bad}), 422, "validation")
    assert len(S3().keys(f"renters/{renter.id}/statements/")) == 2


def test_shelf_subscription(app_url: str, killbill: Any) -> None:
    op = operator(app_url)
    applied = apply_renter(app_url)
    error(op.post(f"/api/renters/{applied.id}/shelf-subscription", json={"shelf_label": "A1"}), 409, "renter_not_active")
    renter = active_renter(app_url)
    error(op.post(f"/api/renters/{renter.id}/shelf-subscription", json={"shelf_label": ""}), 422, "validation")
    error(op.post(f"/api/renters/{renter.id}/shelf-subscription", json={"shelf_label": "x" * 41}), 422, "validation")
    error(op.delete(f"/api/renters/{renter.id}/shelf-subscription"), 409, "not_subscribed")
    down = operator(billing_down_url())
    error(down.post(f"/api/renters/{renter.id}/shelf-subscription", json={"shelf_label": PROBE_SHELF}), 503, "billing_unavailable")
    assert renter_view(op, renter.id)["shelf_subscription"] is None
    sub = body(op.post(f"/api/renters/{renter.id}/shelf-subscription", json={"shelf_label": PROBE_SHELF}), 201)["subscription"]
    assert (sub["state"], sub["billing_state"], sub["plan"], sub["external_key"]) == ("active", "ACTIVE", "walk-in-shelf-monthly", f"shelf-{renter.id}-1")
    account = killbill.account_by_key(f"renter-{renter.id}")
    remote = [s for s in killbill.subscriptions(account["accountId"]) if s.get("externalKey") == f"shelf-{renter.id}-1"]
    assert len(remote) == 1 and remote[0].get("state") == "ACTIVE" and remote[0].get("planName") == "walk-in-shelf-monthly"
    assert str(remote[0].get("subscriptionId")) == str(sub["killbill_subscription_id"])
    error(op.post(f"/api/renters/{renter.id}/shelf-subscription", json={"shelf_label": "Shelf 5"}), 409, "already_subscribed")
    assert renter_view(op, renter.id)["shelf_subscription"]["billing_state"] == "ACTIVE"
    started = time.monotonic()
    offline = renter_view(down, renter.id)["shelf_subscription"]
    assert time.monotonic() - started <= RENTER_READ_LIMIT_S + CLOCK_SLACK_S
    assert offline["billing_state"] == "unknown" and offline["shelf_label"] == PROBE_SHELF
    error(down.delete(f"/api/renters/{renter.id}/shelf-subscription"), 503, "billing_unavailable")
    ended = body(op.delete(f"/api/renters/{renter.id}/shelf-subscription"), 200)["subscription"]
    assert ended["state"] == "cancelled" and ended["billing_state"] == "CANCELLED"
    remote = [s for s in killbill.subscriptions(account["accountId"]) if s.get("externalKey") == f"shelf-{renter.id}-1"]
    assert remote[0].get("state") == "CANCELLED"
    assert renter_view(op, renter.id)["shelf_subscription"] is None
    error(op.delete(f"/api/renters/{renter.id}/shelf-subscription"), 409, "not_subscribed")
    second = body(op.post(f"/api/renters/{renter.id}/shelf-subscription", json={"shelf_label": "Shelf 6"}), 201)["subscription"]
    assert second["external_key"] == f"shelf-{renter.id}-2"
    body(op.delete(f"/api/renters/{renter.id}/shelf-subscription"), 200)


def test_wf_statements_shelf_operator_ui(browser: Browser, app_url: str, killbill: Any) -> None:
    renter = active_renter(app_url)
    tag, _ = names("shelf")
    label = f"Shelf {tag}"[:40]
    with browser_page(browser, app_url, OPERATOR_EMAIL, path="/operator") as page:
        click(page.get_by_role("button", name=f"Review {renter.business}", exact=True))
        dialog = page.get_by_role("dialog", name=f"Review {renter.business}", exact=True)
        status = page.get_by_role("status", name="Operator status", exact=True)
        expect(dialog).to_contain_text("Shelf: none")
        fill(dialog.get_by_role("textbox", name="Shelf label", exact=True), label)
        click(dialog.get_by_role("button", name="Start shelf subscription", exact=True))
        expect(status).to_have_text(f"Shelf subscription started for {renter.business}.")
        expect(dialog).to_contain_text(f"Shelf: {label} · billing active")
        click(dialog.get_by_role("button", name="End shelf subscription", exact=True))
        expect(status).to_have_text(f"Shelf subscription ended for {renter.business}.")
        expect(dialog).to_contain_text("Shelf: none")
    account = killbill.account_by_key(f"renter-{renter.id}")
    remote = [s for s in killbill.subscriptions(account["accountId"]) if s.get("externalKey") == f"shelf-{renter.id}-1"]
    assert len(remote) == 1 and remote[0].get("state") == "CANCELLED"


def test_wf_cross_cutting_health_during_outages(browser: Browser, app_url: str) -> None:
    for base in (app_url, billing_down_url(), mail_down_url(), short_url()):
        response = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert response.status_code == 200 and response.json() == {"status": "ok"}, (base, response.text)
        with browser_page(browser, base, path="/") as page:
            expect(page.get_by_role("form", name="Sign in", exact=True)).to_be_visible()
    assert urlparse(app_url).port in (None, 4173) or os.environ.get("APP_PUBLIC_PORT")


def test_server_boundary(app_url: str) -> None:
    op = operator(app_url)
    renter = active_renter(app_url)
    origin = "{0.scheme}://{0.netloc}".format(urlparse(app_url))
    payload = {"minutes": 60, "reason": "boundary"}
    error(op.post(f"/api/renters/{renter.id}/adjustments", json=payload, headers={"origin": CROSS_ORIGIN}), 403, "cross_origin")
    assert ledger(op, renter.id)["entries"] == []
    body(op.post(f"/api/renters/{renter.id}/adjustments", json=payload, headers={"origin": origin}), 201)

    def sized(total: int) -> bytes:
        skeleton = json.dumps({"email": "nobody@railside-probe.example", "password": "x", "pad": ""}, separators=(",", ":")).encode()
        return skeleton[:-2] + b"p" * (total - len(skeleton)) + b'"}'

    exact = client(app_url).post("/api/session", content=sized(JSON_LIMIT), headers={"content-type": "application/json"})
    assert len(sized(JSON_LIMIT)) == JSON_LIMIT
    error(exact, 401, "invalid_credentials")
    error(client(app_url).post("/api/session", content=sized(JSON_LIMIT + 1), headers={"content-type": "application/json"}), 413, "payload_too_large")
    for path in ("/package.json", "/package-lock.json", "/run.json", "/tsconfig.json", "/.env", "/%2e%2e/run.json", "/%2e%2e/package.json"):
        assert httpx.get(app_url + path).status_code == 404, path
    secrets = [v for k in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL", "KILLBILL_URL", "S3_ENDPOINT")
               if len(v := os.environ.get(k, "")) >= MIN_SECRET_LEN and not v.isalpha()]
    html = httpx.get(app_url + "/").text
    pending = [p for p in re.findall(r'(?:src|href)="(/[^"/][^"]*)"', html)]
    seen: set[str] = set()
    corpus = [html] + [renter.api.get(p).text for p in ("/api/me", "/api/stations", "/api/packs")]
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        seen.add(path)
        content = httpx.get(app_url + path).text
        corpus.append(content)
        pending.extend(p if p.startswith("/") else "/" + p for p in re.findall(r'["\'](/?assets/[^"\']+\.(?:js|css))["\']', content))
    for secret in secrets:
        assert all(secret not in chunk for chunk in corpus), "an environment secret reached the browser"


def test_wf_cross_cutting_reduced_motion(browser: Browser, app_url: str) -> None:
    renter = active_renter(app_url, minutes=600)
    day = free_days(renter.api, "convection-1")[0]
    with browser_page(browser, app_url, renter.email, renter.password, reduced=True) as page:
        open_board(page, app_url, day)
        focus_cell(page, CONV1, "10:00")
        for step in range(1, 5):
            page.keyboard.press("Shift+ArrowRight")
            end = f"10:{15 * step:02d}" if step < 4 else "11:00"
            draft = page.get_by_role("img", name=f"Draft ticket 10:00 to {end}", exact=True)
            expect(draft).to_contain_text(hours_re(hours(SLOT_MINUTES * step)))
            assert abs(box_of(draft)["height"] - STEP_PX * step) <= PX_TOLERANCE
            expect(announcer(page)).to_have_text(f"{CONV1}, 10:00 to {end}, {hours(SLOT_MINUTES * step)} hours, buffer until {(instant(day, end) + timedelta(minutes=30)).astimezone(KITCHEN_ZONE):%H:%M}.")
        page.keyboard.press("Enter")
        timer = docket(page).get_by_role("timer", name="Hold countdown", exact=True)
        expect(timer).to_have_text(re.compile(r"^\d+ min left$"))
        assert 1 <= int((timer.text_content() or "").split()[0]) <= HOLD_TTL_SECONDS // 60
    release_all(renter.api, [b["id"] for b in own_bookings(renter.api, day)])


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"} and all(isinstance(v, str) for v in manifest.values())
    assert manifest["_schema"] == "run-manifest-v1"


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    shipped = {package.name for package in shipped_packages()}
    missing = sorted(name for name in shipped if name not in notices)
    assert not missing, missing
    for asset in ("Archivo Black", "Public Sans", "Lucide"):
        assert asset in notices, asset


def test_if_licences_allowed() -> None:
    bad = []
    for package in shipped_packages():
        key, expression = f"{package.name}@{package.version}", package.licence
        tokens = [t for t in re.findall(r"[A-Za-z0-9.+-]+", expression) if t not in ("OR", "AND")]
        ok = all(t in ALLOWED_LICENCES for t in tokens) if " AND " in expression else any(t in ALLOWED_LICENCES for t in tokens)
        if not ok:
            bad.append((key, expression))
    assert not bad, bad


def test_if_no_extra_datastore() -> None:
    manifest = json.loads(Path("/app/package.json").read_text())
    declared = set(manifest.get("dependencies", {})) | set(manifest.get("devDependencies", {}))
    stores = {"redis", "ioredis", "sqlite3", "better-sqlite3", "@libsql/client", "lowdb", "nedb", "level", "leveldown", "mongodb", "mongoose", "lokijs", "keyv", "node-persist", "memcached"}
    assert not declared & stores, declared & stores
    files = [p for p in Path("/app").rglob("*") if "node_modules" not in p.parts and ".git" not in p.parts
             and (p.suffix in (".sqlite", ".sqlite3", ".db") or p.name == "dump.rdb")]
    assert not files, files


def test_if_service_config_untouched() -> None:
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.exists():
        return
    compose = re.compile(r"(^|/)(docker-)?compose[^/]*\.ya?ml$")
    hits: list[str] = []

    def walk(node: Any, tool: str) -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or tool)
            for key, value in node.items():
                if key in ("file_path", "path", "filename") and isinstance(value, str) and compose.search(value) and re.search(r"(?i)write|edit", name):
                    hits.append(value)
                walk(value, name)
        elif isinstance(node, list):
            for item in node:
                walk(item, tool)

    walk(json.loads(trajectory.read_text()), "")
    assert not hits, hits


def load_jsonc(path: Path) -> dict[str, Any]:
    raw = path.read_text()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        cleaned = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
        cleaned = re.sub(r'(?m)^((?:[^"\n]|"[^"\n]*")*?)//.*$', r"\1", cleaned)
        return json.loads(re.sub(r",(\s*[}\]])", r"\1", cleaned))


def test_if_typescript_strict() -> None:
    root = Path("/app/tsconfig.json")
    config = load_jsonc(root)
    refs = [r["path"] for r in config.get("references", []) if isinstance(r, dict) and r.get("path")]
    if refs and strict_of(root) is None:
        targets = [(root.parent / r) / "tsconfig.json" if (root.parent / r).is_dir() else tsconfig_path(root.parent / r) for r in refs]
        assert all(strict_of(target) is True for target in targets), targets
    else:
        assert strict_of(root) is True


def tsconfig_path(path: Path) -> Path:
    return path if path.suffix == ".json" else path.with_suffix(".json")


def strict_of(path: Path) -> bool | None:
    for _ in range(TSCONFIG_EXTENDS_DEPTH):
        config = load_jsonc(path)
        strict = config.get("compilerOptions", {}).get("strict")
        if strict is not None or not str(config.get("extends", "")).startswith("."):
            return strict
        path = tsconfig_path(path.parent / config["extends"])
    pytest.fail(f"tsconfig extends chain deeper than {TSCONFIG_EXTENDS_DEPTH} levels from {path}")


def test_if_lockfile_install() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    assert lock.get("lockfileVersion")
    install = json.loads(Path("/app/run.json").read_text())["install"]
    assert re.search(r"\bnpm (ci|clean-install|install|i)\b", install), install
