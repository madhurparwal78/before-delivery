from __future__ import annotations

import concurrent.futures as cf
import hashlib
import io
import json
import os
import random
import re
import socket
import threading
import time
import uuid
import zipfile
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    KillBill,
    Mailpit,
    Postgres,
    S3,
    addresses,
    advance,
    animations,
    axe,
    check,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    text,
)

AGENCY_TZ_NAME = "America/Chicago"
AGENCY_TZ = ZoneInfo(AGENCY_TZ_NAME)
AGENCY_NAME = "Tandem Hands Collective"
PASSWORD = "relayline-demo-2026"
SOLO_THRESHOLD = 60
COORD = "dana.okafor@tandemhands.example"
BILLING = "morgan.ellis@tandemhands.example"
ORGS = {
    "riverbend": ("lena.torres@riverbend.example", "Lena Torres", "Riverbend Regional Hospital"),
    "maple-valley": ("sam.whitfield@maplevalley.example", "Sam Whitfield", "Maple Valley School District"),
    "harlan-court": ("ruth.adeyemi@harlancourt.example", "Ruth Adeyemi", "Harlan County Court"),
}
CONTRACTS = {
    "riverbend": (9000, 1000, 67, 20),
    "maple-valley": (7850, 500, 70, 30),
    "harlan-court": (10500, 1500, 0, 15),
}
INTERPRETERS = {
    "jordan-reyes": ("Jordan Reyes", "JR", "jordan.reyes@interpreters.example", "+1 555 010 0141", "Fairbrook", [("NIC", "2028-06-30")], 5500),
    "avery-chen": ("Avery Chen", "AC", "avery.chen@interpreters.example", "+1 555 010 0142", "Linden Park", [("NIC", "2027-12-31"), ("EIPA", "2027-08-31")], 5200),
    "casey-morgan": ("Casey Morgan", "CM", "casey.morgan@interpreters.example", "+1 555 010 0143", "Oak Hollow", [("BEI", "2028-03-31")], 5000),
    "riley-brooks": ("Riley Brooks", "RB", "riley.brooks@interpreters.example", "+1 555 010 0144", "Westmere", [("NIC", "2028-12-31"), ("SC:L", "2028-12-31")], 6500),
    "taylor-nguyen": ("Taylor Nguyen", "TN", "taylor.nguyen@interpreters.example", "+1 555 010 0145", "Fairbrook", [("NIC", "2026-01-31"), ("EIPA", "2027-05-31")], 4800),
    "quinn-halvorsen": ("Quinn Halvorsen", "QH", "quinn.halvorsen@interpreters.example", "+1 555 010 0146", "Cedar Bluff", [("NIC", "2029-01-31"), ("SC:L", "2029-01-31")], 6200),
    "sasha-lindqvist": ("Sasha Lindqvist", "SL", "sasha.lindqvist@interpreters.example", "+1 555 010 0147", "Granite Falls", [("SC:L", "2028-09-30")], 6300),
}
SEED_RATE_FROM = "2026-01-01"
MINIMUM_MINUTES = 120
INCREMENT_MINUTES = 15
BP_DENOMINATOR = 10_000
MINUTES_PER_HOUR = 60
REF_RE = re.compile(r"^BK-\d+$")
LINE_RE = re.compile(r"^LN-\d+$")
TITLE_MAX = 120
NOTES_MAX = 1_000
LOCATION_MAX = 200
PERSON_NAME_MAX = 80
Q_MAX = 80
KEY_MAX = 100
DURATION_MIN = 30
DURATION_MAX = 480
MIN_START_LEAD = 15
WORKED_MAX = 720
MILEAGE_MAX = 500
HOURLY_MAX = 100_000
SURCHARGE_MAX = 10_000
MILEAGE_RATE_MAX = 1_000
UPLOAD_LIMIT = 10_000_000
MAX_FILES = 10
DISPLAY_NAME_MAX = 120
JSON_LIMIT = 65_536
MULTIPART_LIMIT = 10_100_000
REFRESH_MS = 10_000
DEBOUNCE_MS = 300
DIALOG_WIDTH = 480
COMPACT_MAX = 767
MEDIUM_MIN = 768
MEDIUM_MAX = 1199
WIDE_MIN = 1200
GRID_COLUMNS = 12
LIST_COLUMNS = 4
LIST_DAYS = 13
COLLAPSE_GAP_MS = 30
ABANDONED_DOWNLOADS = 60
FULL_DOWNLOAD_S = 5
API_CALL_S = 1
NEW_RATE_CENTS = 9_000
EXAMPLE_RIVERBEND_LINE = 80_406
EXAMPLE_RIVERBEND_TIME = 79_200
EXAMPLE_RIVERBEND_MILEAGE = 1_206
EXAMPLE_MAPLE_LINE = 17_663
EXAMPLE_LATE_LINE = 39_600
EXAMPLE_NEW_RATE_LINE = 20_250
POOL_END = date(2027, 8, 31)
TAYLOR_EIPA_END = date(2027, 5, 31)
RILEY_NIC_END = date(2028, 12, 31)
DST_DAYS = {date(2027, 3, 14), date(2027, 11, 7)}
WIDE = (1280, 800)
MEDIUM = (768, 1024)
PHONE = (375, 812)
ACCEPTED_TYPES = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}
FONTS = ["Archivo", "IBM Plex Sans", "IBM Plex Mono"]
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
STATUS_LABELS = {
    "submitted": "Submitted", "open": "Open call", "partially_covered": "Partly covered", "covered": "Covered",
    "in_progress": "In progress", "completed": "Completed", "cancelled": "Cancelled", "cancelled_late": "Cancelled (late)",
}

FIELD = {
    "org_id": "Choose a client organisation.",
    "setting": "Choose medical, educational, legal or workplace.",
    "title": "Enter a title of up to 120 characters.",
    "location": "Enter where the interpreter should go.",
    "onsite_contact_name": "Name the person who meets the interpreter.",
    "onsite_contact_phone": "Enter a phone number for the on-site contact.",
    "consumer_name": "Enter the Deaf consumer's name.",
    "duration_minutes": "Length must be 30 to 480 minutes in 15-minute steps.",
    "requester_notes": "Notes can be up to 1,000 characters.",
    "interpreter_id": "Choose an interpreter.",
    "seat": "Choose a seat this booking has.",
    "q": "Search text can be up to 80 characters.",
    "worked_minutes": "Worked minutes must be a whole number from 1 to 720.",
    "mileage_miles": "Mileage must be a whole number from 0 to 500.",
    "quoted_charge_cents": "Confirm the quoted charge.",
    "idempotency_key": "Idempotency-Key must be 1 to 100 visible ASCII characters.",
    "hourly_rate_cents": "Enter an hourly rate from $0.01 to $1,000.00.",
    "team_surcharge_bp": "Enter a surcharge from 0 to 100 percent.",
    "mileage_cents_per_mile": "Enter a mileage rate from 0 to 1,000 cents.",
    "week_start": "Choose a Monday that is not in the future.",
    "range": "Choose a range of at most 31 days.",
}
START_FORMAT = "Enter a start date and time."
START_SKIPPED = "That time doesn't exist in agency time on that date."
START_SOON = "Start must be at least 15 minutes from now."
FILE_REQUIRED = "Choose a file to upload."
FILE_FULL = "A booking can hold up to 10 files."
EFFECTIVE_FUTURE = "Choose a date after today."
EFFECTIVE_DUP = "A rate already starts on that date."

COPY_BAD_LOGIN = "Email or password is wrong."
COPY_NETWORK = "Relayline could not reach the server. Your last action may not have saved; refresh to check."
COPY_SEAT_FILLED = "Already filled — another interpreter took this seat."
COPY_CONFLICT = "That interpreter already has an assignment at this time."
COPY_QUOTE_CHANGED = "The cancellation window just changed. Review the new charge."
COPY_STORAGE_UPLOAD = "File storage is unavailable. Try the upload again shortly."
COPY_BILLING_DOWN = "Billing is unreachable. Nothing was closed; try again shortly."
COPY_PENDING_SYNC = "Some lines are still waiting to sync with billing. Try again shortly."
COPY_BILLING_UNREADABLE = "Billing amounts are unavailable right now."
COPY_SESSION_ENDED = "Your session has ended. Sign in again to finish this action."
COPY_QUOTE_PENDING = "Checking the cancellation window…"
COPY_ASSIGNING = "Assigning…"
COPY_CLAIMING = "Claiming seat…"
COPY_BUSY = "Busy at this time"
SUBJ_ASSIGNED = "Assignment confirmed"
SUBJ_COVERED = "Booking covered"
SUBJ_CANCELLED = "Booking cancelled"
MAIL_FROM = "Relayline <dispatch@tandemhands.example>"

HTTP_TIMEOUT_S = 60
UI_WAIT_S = 25
SYNC_DEADLINE_S = 150
MAIL_DEADLINE_S = 75
SLOT_ATTEMPTS = 12
COLLECT_S = 2.0
SUBPIXEL = 1.5
FAR_DAYS = 7
NEAR_MIN_DAYS = 3
FIRST_HOUR = 6
LAST_HOUR = 18
QUARTERS = (0, 15, 30, 45)
WRONG_CLOCK_HOURS = 5
FOREIGN_ORIGIN = "http://evil.example"
BROWSER_TZ = "Asia/Tokyo"
RATE_PROBE_FROM = date(2028, 1, 10)
FAR_RATE_YEARS = (2030, 2040)
PAST_WEEK_YEARS = (2001, 2024)
ROW_NAME_RE = re.compile(r"^\d\d:\d\d BK-\d+ ")

RNG = random.Random()


class Api:

    def __init__(self, base: str, email: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.client = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, follow_redirects=False)
        self.email = email
        if email:
            r = self.sign_in(email)
            assert r.status_code == 200, f"POST /api/session for {email} answered {r.status_code} {r.text[:300]}"

    def sign_in(self, email: str, password: str = PASSWORD) -> httpx.Response:
        return self.client.post("/api/session", json={"email": email, "password": password})

    def get(self, path: str, **headers: str) -> httpx.Response:
        return self.client.get(path, headers=headers)

    def post(self, path: str, body: Any = None, key: str | None = None, **headers: str) -> httpx.Response:
        h: dict[str, Any] = dict(headers)
        if key is not None:
            h["Idempotency-Key"] = key.encode("utf-8")
        if body is None:
            return self.client.post(path, headers=h)
        h["Content-Type"] = "application/json; charset=utf-8"
        return self.client.post(path, content=json.dumps(body).encode("utf-8"), headers=h)

    def raw(self, method: str, path: str, data: bytes, ctype: str, **headers: str) -> httpx.Response:
        return self.client.request(method, path, content=data, headers={"Content-Type": ctype, **headers})

    def upload(self, booking_id: Any, filename: str, data: bytes, ctype: str = "application/octet-stream") -> httpx.Response:
        body, boundary = multipart(filename, data, ctype)
        return self.raw("POST", f"/api/bookings/{booking_id}/materials", body, f"multipart/form-data; boundary={boundary}")

    def cookie_header(self) -> str:
        return "; ".join(f"{c.name}={c.value}" for c in self.client.cookies.jar)


def multipart(filename: str, data: bytes, ctype: str) -> tuple[bytes, str]:
    boundary = "rl" + uuid.uuid4().hex
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="').encode() + filename.encode("utf-8") + f'"\r\nContent-Type: {ctype}\r\n\r\n'.encode()
    return head + data + f"\r\n--{boundary}--\r\n".encode(), boundary


def assert_error(r: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text[:400]}"
    body = r.json()
    assert body.get("error") == code, f"expected error {code}, got {body}"
    assert isinstance(body.get("message"), str) and body["message"].strip(), f"error body lacks a message: {body}"
    return body


def assert_field(r: httpx.Response, field: str, message: str) -> None:
    body = assert_error(r, 422, "validation")
    fields = body.get("fields") or {}
    assert fields.get(field) == message, f"fields.{field} should read {message!r}; got {fields}"


def agency(api: Api) -> dict[str, Any]:
    r = api.get("/api/agency")
    assert r.status_code == 200, f"GET /api/agency answered {r.status_code}"
    return r.json()


def today_of(ag: dict[str, Any]) -> date:
    return date.fromisoformat(ag["today"])


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def local(iso: str) -> datetime:
    return datetime.fromisoformat(iso).astimezone(AGENCY_TZ)


def hhmm(iso: str) -> str:
    return local(iso).strftime("%H:%M")


def ymd(iso: str) -> str:
    return local(iso).date().isoformat()


def dollars(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def cents_of(amount: Any) -> int:
    return int((Decimal(str(amount)) * 100).to_integral_value())


def line_math(rate: int, surcharge_bp: int, mileage_rate: int, basis: int, count: int, miles: int) -> tuple[int, int, int]:
    billable = max(MINIMUM_MINUTES, -(-basis // INCREMENT_MINUTES) * INCREMENT_MINUTES)
    num = rate * billable * count * (BP_DENOMINATOR + (surcharge_bp if count == 2 else 0))
    den = MINUTES_PER_HOUR * BP_DENOMINATOR
    time_amount = (2 * num + den) // (2 * den)
    return billable, time_amount, time_amount + miles * mileage_rate


def pool_day(ag: dict[str, Any], last: date = POOL_END) -> date:
    first = today_of(ag) + timedelta(days=FAR_DAYS)
    for _ in range(SLOT_ATTEMPTS * 4):
        d = first + timedelta(days=RNG.randint(0, (last - first).days))
        if d not in DST_DAYS:
            return d
    pytest.fail("could not pick a booking day in the shared pool")


def near_day(ag: dict[str, Any]) -> date:
    return today_of(ag) + timedelta(days=RNG.randint(NEAR_MIN_DAYS, LIST_DAYS))


def slot_start(d: date) -> str:
    return f"{d.isoformat()}T{RNG.randint(FIRST_HOUR, LAST_HOUR):02d}:{RNG.choice(QUARTERS):02d}"


def booking_body(org: str, setting: str, duration: int, start: str, **over: Any) -> dict[str, Any]:
    tag = uuid.uuid4().hex[:8]
    body = {
        "org_id": org, "setting": setting, "title": f"Session {tag}", "location": "Main entrance, Building C",
        "onsite_contact_name": "Front desk", "onsite_contact_phone": "+1 555 010 0199",
        "consumer_name": f"Consumer {tag}", "start": start, "duration_minutes": duration, "requester_notes": "",
    }
    body.update(over)
    return body


def create(api: Api, body: dict[str, Any], key: str | None = None) -> dict[str, Any]:
    r = api.post("/api/bookings", body, key=key)
    assert r.status_code == 201, f"POST /api/bookings answered {r.status_code} {r.text[:400]}"
    return r.json()


def choices(coord: Api, booking_id: Any, q: str | None = None) -> dict[str, dict[str, Any]]:
    path = f"/api/interpreters?booking_id={booking_id}" + (f"&q={q}" if q is not None else "")
    r = coord.get(path)
    assert r.status_code == 200, f"GET {path} answered {r.status_code}"
    return {c["id"]: c for c in r.json()["interpreters"]}


def free_booking(coord: Api, org: str, setting: str, duration: int, need: list[str], *, day: date | None = None,
                 start: str | None = None, last: date = POOL_END, **over: Any) -> dict[str, Any]:
    ag = agency(coord)
    for _ in range(SLOT_ATTEMPTS):
        d = day or pool_day(ag, last)
        b = create(coord, booking_body(org, setting, duration, start or slot_start(d), **over))
        if not need:
            return b
        found = choices(coord, b["id"])
        if all(found[i]["qualified"] is True and found[i]["busy"] is False for i in need):
            return b
        if start:
            break
    pytest.fail(f"no slot where {need} are qualified and free for a {setting} booking")


def assign(coord: Api, b: dict[str, Any], iid: str, seat: int) -> dict[str, Any]:
    r = coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": iid, "seat": seat})
    assert r.status_code == 200, f"assign {iid} to seat {seat} of {b['ref']} answered {r.status_code} {r.text[:300]}"
    return r.json()


def complete(coord: Api, b: dict[str, Any], worked: int, miles: int, key: str | None = None) -> dict[str, Any]:
    r = coord.post(f"/api/bookings/{b['id']}/check-in")
    assert r.status_code == 200, f"check-in answered {r.status_code} {r.text[:300]}"
    r = coord.post(f"/api/bookings/{b['id']}/complete", {"worked_minutes": worked, "mileage_miles": miles}, key=key)
    assert r.status_code == 200, f"complete answered {r.status_code} {r.text[:300]}"
    return r.json()


def get_booking(api: Api, b: dict[str, Any]) -> dict[str, Any]:
    r = api.get(f"/api/bookings/{b['id']}")
    assert r.status_code == 200, f"GET booking {b['ref']} answered {r.status_code}"
    return r.json()


def audit(coord: Api, b: dict[str, Any]) -> list[dict[str, Any]]:
    r = coord.get(f"/api/bookings/{b['id']}/audit")
    assert r.status_code == 200, f"audit answered {r.status_code}"
    return r.json()["entries"]


def quote(api: Api, b: dict[str, Any]) -> dict[str, Any]:
    r = api.get(f"/api/bookings/{b['id']}/cancellation-quote")
    assert r.status_code == 200, f"quote answered {r.status_code} {r.text[:300]}"
    return r.json()


def cancel(api: Api, b: dict[str, Any]) -> dict[str, Any]:
    q = quote(api, b)
    r = api.post(f"/api/bookings/{b['id']}/cancel", {"quoted_charge_cents": q["charge_cents"]})
    assert r.status_code == 200, f"cancel answered {r.status_code} {r.text[:300]}"
    return r.json()


def statement(api: Api, org: str, monday: date) -> httpx.Response:
    return api.get(f"/api/billing/weeks/{org}/{monday.isoformat()}")


def close_week(api: Api, org: str, monday: Any) -> httpx.Response:
    return api.post(f"/api/billing/weeks/{org}/{monday}/close")


def wait_synced(bm: Api, org: str, line_ref: str, deadline_s: float = SYNC_DEADLINE_S) -> tuple[dict[str, Any], dict[str, Any]]:
    monday = monday_of(today_of(agency(bm)))
    end = time.monotonic() + deadline_s
    last: Any = None
    while time.monotonic() < end:
        r = statement(bm, org, monday)
        if r.status_code == 200:
            st = r.json()
            last = [ln for ln in st["lines"] if ln["line_ref"] == line_ref]
            if last and last[0]["sync_status"] == "synced":
                return last[0], st
    pytest.fail(f"line {line_ref} never reached sync_status synced in the {org} statement of {monday}; last {last}")


def kb_items(killbill: KillBill, org: str) -> list[dict[str, Any]]:
    acct = killbill.account_by_key(org)
    if not acct:
        return []
    items: list[dict[str, Any]] = []
    for inv in killbill.invoices(acct["accountId"]):
        items.extend(inv.get("items") or [])
    return items


def kb_charges(killbill: KillBill, org: str, line_ref: str) -> list[dict[str, Any]]:
    return [i for i in kb_items(killbill, org) if str(i.get("description") or "").startswith(line_ref + " ")]


def kb_current_cents(killbill: KillBill, org: str, item: dict[str, Any]) -> int:
    total = cents_of(item["amount"])
    for other in kb_items(killbill, org):
        if other.get("linkedInvoiceItemId") == item.get("invoiceItemId"):
            total += cents_of(other["amount"])
    return total


def subject(kind: str, b: dict[str, Any]) -> str:
    return f"{kind}: {b['ref']} on {ymd(b['start'])} at {hhmm(b['start'])}"


def mails(mail: Mailpit, subj: str, to: str, expected: int, deadline_s: float = MAIL_DEADLINE_S) -> list[dict[str, Any]]:
    def matching() -> list[dict[str, Any]]:
        return [m for m in mail.messages() if m.get("Subject") == subj and to in addresses(m.get("To"))]
    end = time.monotonic() + deadline_s
    found = matching()
    while len(found) < expected and time.monotonic() < end:
        found = matching()
    return matching()


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(f: Callable[[], Any]) -> Any:
        barrier.wait(timeout=HTTP_TIMEOUT_S)
        return f()
    with cf.ThreadPoolExecutor(len(calls)) as ex:
        return list(ex.map(run, calls))


def pdf_bytes(size: int = 2048) -> bytes:
    return b"%PDF-1.7\n" + os.urandom(max(0, size - 9))


def zip_bytes(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in entries:
            z.writestr(name, content)
    return buf.getvalue()


def legal_pair(coord: Api, **over: Any) -> dict[str, Any]:
    return free_booking(coord, "harlan-court", "legal", 60, ["riley-brooks", "sasha-lindqvist", "quinn-halvorsen"], **over)


def wait_ui(page: Page, pred: Callable[[], bool], what: str, seconds: float = UI_WAIT_S, step_ms: float = 50) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            if pred():
                return
        except Exception:
            pass
        advance(page, step_ms)
    pytest.fail(f"timed out waiting for {what}")


def choose_setting(field: Any, setting: str) -> None:
    try:
        select(field, setting)
    except Exception:
        select(field, setting.capitalize())


def txt(loc: Any) -> str:
    return loc.first.inner_text(timeout=2000) if loc.count() else ""


def action_status(page: Page) -> Any:
    return page.get_by_role("status", name="Action status")


def action_error(page: Page) -> Any:
    return page.get_by_role("alert", name="Action error")


def is_focused(loc: Any) -> bool:
    return bool(loc.count()) and bool(loc.first.evaluate("e => e === document.activeElement"))


def row(scope: Any, ref: str) -> Any:
    return scope.get_by_role("button", name=re.compile(r"^\d\d:\d\d " + re.escape(ref) + " "))


def heading(page: Page, b: dict[str, Any]) -> Any:
    return page.get_by_role("heading", level=2, name=f"{b['ref']} · {b['title']}")


def weave(page: Page) -> Any:
    return page.get_by_role("img", name="Rotation weave")


def entries(page: Page) -> list[dict[str, str]]:
    return weave(page).locator("[data-turn-index]").evaluate_all("els => els.map(e => ({...e.dataset}))")


def ui_sign_in(page: Page, email: str, password: str = PASSWORD) -> None:
    form = page.get_by_role("form", name="Sign in")
    wait_ui(page, lambda: form.count() == 1, 'form "Sign in"')
    fill(form.get_by_role("textbox", name="Email"), email)
    fill(form.get_by_label("Password"), password)
    click(form.get_by_role("button", name="Sign in", exact=True))
    wait_ui(page, lambda: page.get_by_role("button", name="Sign out").count() == 1, f"the home screen for {email}")


@contextmanager
def signed_in(browser: Browser, base: str, email: str, *, path: str | None = None, size: tuple[int, int] = WIDE,
              reduced: str = "no-preference", tz: str | None = None, clock_at: datetime | None = None) -> Iterator[Page]:
    root = base.rstrip("/")
    with open_app(browser, root + "/", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if tz:
            session(page).send("Emulation.setTimezoneOverride", {"timezoneId": tz})
        if clock_at is not None:
            page.clock.pause_at(clock_at)
        ui_sign_in(page, email)
        if path:
            page.goto(root + path)
            wait_ui(page, lambda: page.get_by_role("button", name="Sign out").count() == 1, f"{path} after navigation")
        yield page


def board_path(b: dict[str, Any]) -> str:
    return f"/?date={ymd(b['start'])}&booking={b['id']}"


RECORDER_JS = """() => {
  if (window.__weaveRec) { window.__weaveRec.length = 0; return; }
  const rec = [];
  window.__weaveRec = rec;
  const note = (el, t) => {
    if (!(el instanceof Element)) return;
    const entry = el.closest('[data-turn-index]');
    if (entry && entry.closest('[data-mode]')) {
      const r = entry.getBoundingClientRect();
      rec.push({what: 'entry', index: entry.getAttribute('data-turn-index'), kind: entry.getAttribute('data-kind'),
                holder: entry.getAttribute('data-holder'), left: r.left, t});
      return;
    }
    const st = el.closest('[role="status"]');
    if (st && !el.closest('[data-mode]') && st.getAttribute('aria-label') !== 'Action status') rec.push({what: 'status', t});
  };
  document.addEventListener('animationstart', e => note(e.target, document.timeline.currentTime), true);
  document.addEventListener('transitionstart', e => note(e.target, document.timeline.currentTime), true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const a = original.apply(this, args);
    const el = this;
    const delay = (a.effect && a.effect.getTiming && Number(a.effect.getTiming().delay)) || 0;
    a.ready.then(() => note(el, (a.startTime == null ? document.timeline.currentTime : a.startTime) + delay)).catch(() => {});
    return a;
  };
}"""


def collect(page: Page, seconds: float = COLLECT_S) -> list[dict[str, Any]]:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        advance(page, 50)
    return page.evaluate("() => (window.__weaveRec || []).slice()")


def test_wf_request_intake_happy(browser: Browser, app_url: str) -> None:
    lena = Api(app_url, ORGS["riverbend"][0])
    ag = agency(lena)
    d = near_day(ag)
    title = ("Tư vấn tim mạch 🦻 " * 12)[:TITLE_MAX]
    notes = "Agenda attached, consumer prefers ASL 🦻 thank you"
    consumer = "Nguyễn Thị Hồng"
    length = SOLO_THRESHOLD * 3 + 45
    with signed_in(browser, app_url, ORGS["riverbend"][0], tz=BROWSER_TZ) as page:
        click(page.get_by_role("region", name="Bookings").get_by_role("button", name="New request"))
        dlg = page.get_by_role("dialog", name="New request")
        wait_ui(page, lambda: dlg.count() == 1, 'dialog "New request"')
        choose_setting(dlg.get_by_label("Setting"), "medical")
        t = dlg.get_by_label("Title")
        fill(t, title + "x")
        expect(t).to_have_accessible_description(f"{TITLE_MAX + 1} of {TITLE_MAX} characters")
        fill(t, title)
        expect(t).to_have_accessible_description(f"{TITLE_MAX} of {TITLE_MAX} characters")
        fill(dlg.get_by_label("Location"), "Cardiology, 3rd floor")
        fill(dlg.get_by_label("On-site contact name"), "Ward clerk")
        fill(dlg.get_by_label("On-site contact phone"), "+1 555 010 0199")
        fill(dlg.get_by_label("Deaf consumer name"), consumer)
        fill(dlg.get_by_label("Start date"), d.isoformat())
        fill(dlg.get_by_label("Start time"), "09:00")
        fill(dlg.get_by_label("Length (minutes)"), str(length))
        n = dlg.get_by_label("Notes for the agency")
        fill(n, notes)
        expect(n).to_have_accessible_description(f"{len(notes):,} of {NOTES_MAX:,} characters")
        click(dlg.get_by_role("button", name="Submit request"))
        wait_ui(page, lambda: re.search(r"Request (BK-\d+) submitted\.", txt(action_status(page))) is not None, "Request <ref> submitted.")
        ref = re.search(r"Request (BK-\d+) submitted\.", txt(action_status(page))).group(1)
        wait_ui(page, lambda: dlg.count() == 0, "New request to close")
        assert is_focused(page.get_by_role("region", name="Bookings").get_by_role("button", name="New request")), "focus should return to New request"
        r = page.get_by_role("region", name="Bookings").get_by_role("button", name=f"09:00 {ref} {title}, Uncovered", exact=True)
        wait_ui(page, lambda: r.count() == 1, f"row 09:15 {ref} … Uncovered in agency time")
        assert r.get_attribute("data-coverage") == "uncovered"
    listed = lena.get(f"/api/bookings?from={d}&to={d}").json()["bookings"]
    mine = [b for b in listed if b["ref"] == ref]
    assert len(mine) == 1, f"exactly one booking {ref}"
    b = mine[0]
    assert (b["title"], b["requester_notes"], b["consumer_name"]) == (title, notes, consumer), "text must read back exactly"
    assert ymd(b["start"]) == d.isoformat() and hhmm(b["start"]) == "09:00"
    assert b["status"] == "submitted" and b["seat_count"] == 2, "a booking longer than the solo threshold needs two seats"


def test_wf_request_intake_session_resume(browser: Browser, app_url: str) -> None:
    lena = Api(app_url, ORGS["riverbend"][0])
    d = near_day(agency(lena))
    title = f"Resume {uuid.uuid4().hex[:8]} ✓"
    posts: list[Any] = []
    with signed_in(browser, app_url, ORGS["riverbend"][0]) as page:
        page.on("request", lambda req: posts.append(req) if req.method == "POST" and urlparse(req.url).path == "/api/bookings" else None)
        click(page.get_by_role("region", name="Bookings").get_by_role("button", name="New request"))
        dlg = page.get_by_role("dialog", name="New request")
        wait_ui(page, lambda: dlg.count() == 1, "New request")
        choose_setting(dlg.get_by_label("Setting"), "medical")
        fill(dlg.get_by_label("Title"), title)
        fill(dlg.get_by_label("Location"), "Clinic B")
        fill(dlg.get_by_label("On-site contact name"), "Ward clerk")
        fill(dlg.get_by_label("On-site contact phone"), "+1 555 010 0199")
        fill(dlg.get_by_label("Deaf consumer name"), "Trần Văn Bảo")
        fill(dlg.get_by_label("Start date"), d.isoformat())
        fill(dlg.get_by_label("Start time"), "10:00")
        fill(dlg.get_by_label("Length (minutes)"), "90")
        resp = page.request.delete(app_url.rstrip("/") + "/api/session")
        assert resp.status in (204, 200), "sign-out in the other tab"
        advance(page, REFRESH_MS)
        advance(page, REFRESH_MS)
        assert page.get_by_role("dialog", name="Sign in to continue").count() == 0, "a refresh answered unauthenticated must open nothing"
        assert txt(action_error(page)) == "" and txt(action_status(page)) == "", "refresh must not write live regions"
        assert dlg.get_by_label("Title").input_value() == title
        click(dlg.get_by_role("button", name="Submit request"))
        sic = page.get_by_role("dialog", name="Sign in to continue")
        wait_ui(page, lambda: sic.count() == 1, 'dialog "Sign in to continue"')
        assert COPY_SESSION_ENDED in txt(sic) and ORGS["riverbend"][0] in txt(sic)
        assert is_focused(sic.get_by_label("Password")), "focus starts on Password"
        fill(sic.get_by_label("Password"), "not-the-password")
        click(sic.get_by_role("button", name="Sign in and continue"))
        wait_ui(page, lambda: txt(action_error(page)) == COPY_BAD_LOGIN, "invalid_credentials copy")
        assert sic.count() == 1 and sic.get_by_label("Password").input_value() == ""
        beneath = page.get_by_role("dialog", name="New request", include_hidden=True)
        assert beneath.get_by_label("Title").input_value() == title, "draft beneath must stay intact"
        fill(sic.get_by_label("Password"), PASSWORD)
        click(sic.get_by_role("button", name="Sign in and continue"))
        wait_ui(page, lambda: re.search(r"Request BK-\d+ submitted\.", txt(action_status(page))) is not None, "the resumed request to succeed")
        assert sic.count() == 0 and dlg.count() == 0
    assert len(posts) == 2, f"POST /api/bookings must be sent exactly twice (first 401, then resent once); saw {len(posts)}"
    assert posts[0].post_data_buffer == posts[1].post_data_buffer, "resent body must be byte-identical"
    assert posts[0].headers.get("idempotency-key") == posts[1].headers.get("idempotency-key"), "resent with the same Idempotency-Key"
    found = [b for b in lena.get(f"/api/bookings?from={d}&to={d}").json()["bookings"] if b["title"] == title]
    assert len(found) == 1, "exactly one booking for the resumed draft"


def test_wf_request_intake_lost_response(browser: Browser, app_url: str) -> None:
    lena = Api(app_url, ORGS["riverbend"][0])
    coord = Api(app_url, COORD)
    d = near_day(agency(lena))
    title = f"Flaky {uuid.uuid4().hex[:8]}"
    first: list[dict[str, Any]] = []
    posts: list[Any] = []
    with signed_in(browser, app_url, ORGS["riverbend"][0]) as page:
        def lose_first(route: Any) -> None:
            if route.request.method == "POST" and not first:
                resp = route.fetch()
                first.append(resp.json())
                route.abort("failed")
                return
            route.continue_()
        page.route("**/api/bookings", lose_first)
        page.on("request", lambda req: posts.append(req) if req.method == "POST" and urlparse(req.url).path == "/api/bookings" else None)
        click(page.get_by_role("region", name="Bookings").get_by_role("button", name="New request"))
        dlg = page.get_by_role("dialog", name="New request")
        wait_ui(page, lambda: dlg.count() == 1, "New request")
        choose_setting(dlg.get_by_label("Setting"), "medical")
        fill(dlg.get_by_label("Title"), title)
        fill(dlg.get_by_label("Location"), "Clinic C")
        fill(dlg.get_by_label("On-site contact name"), "Ward clerk")
        fill(dlg.get_by_label("On-site contact phone"), "+1 555 010 0199")
        fill(dlg.get_by_label("Deaf consumer name"), "Lê Minh")
        fill(dlg.get_by_label("Start date"), d.isoformat())
        fill(dlg.get_by_label("Start time"), "11:00")
        fill(dlg.get_by_label("Length (minutes)"), "60")
        submit = dlg.get_by_role("button", name="Submit request")
        click(submit)
        wait_ui(page, lambda: txt(action_error(page)) == COPY_NETWORK, "network-failure copy")
        assert dlg.count() == 1 and dlg.get_by_label("Title").input_value() == title
        assert is_focused(submit), "focus stays on Submit request"
        click(submit)
        wait_ui(page, lambda: dlg.count() == 0, "dialog to close after the replay")
        assert f"Request {first[0]['ref']} submitted." == txt(action_status(page))
    assert len(posts) == 2 and posts[0].post_data_buffer == posts[1].post_data_buffer
    k = posts[0].headers.get("idempotency-key")
    assert k and k == posts[1].headers.get("idempotency-key"), "one Idempotency-Key for the unchanged draft"
    found = [b for b in lena.get(f"/api/bookings?from={d}&to={d}").json()["bookings"] if b["title"] == title]
    assert len(found) == 1 and found[0]["id"] == first[0]["id"], "the retry must replay the stored booking"
    assert [e["action"] for e in audit(coord, found[0])] == ["submitted"]


def test_booking_intake(app_url: str) -> None:
    lena = Api(app_url, ORGS["riverbend"][0])
    ruth = Api(app_url, ORGS["harlan-court"][0])
    coord = Api(app_url, COORD)
    ag = agency(lena)
    d = pool_day(ag)
    start = f"{d}T09:00"
    k = uuid.uuid4().hex
    a_body = booking_body("maple-valley", "medical", SOLO_THRESHOLD, start)
    a = create(lena, a_body, key=k)
    assert REF_RE.match(a["ref"]) and a["status"] == "submitted" and a["seat_count"] == 1, "a length equal to the threshold stays solo"
    assert a["org_name"] == ORGS["riverbend"][2], "a requester's org_id is ignored"
    assert lena.post("/api/bookings", a_body, key=k).status_code == 201
    assert_field(lena.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, start, title="")), "title", FIELD["title"])
    b = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD + INCREMENT_MINUTES, start))
    assert int(b["ref"][3:]) == int(a["ref"][3:]) + 1, "refused and replayed requests never use up a reference"
    assert b["seat_count"] == 2, "longer than the threshold needs two seats"
    legal = create(ruth, booking_body("harlan-court", "legal", DURATION_MIN, start))
    assert legal["seat_count"] == 2, "legal bookings get two seats"
    c = create(coord, booking_body("maple-valley", "educational", SOLO_THRESHOLD, start))
    assert c["org_name"] == ORGS["maple-valley"][2] and c["status"] == "submitted"
    no_org = booking_body("maple-valley", "medical", SOLO_THRESHOLD, start)
    del no_org["org_id"]
    assert_field(coord.post("/api/bookings", no_org), "org_id", FIELD["org_id"])
    bad = {
        "setting": ({"setting": "dance"}, FIELD["setting"]),
        "location": ({"location": ""}, FIELD["location"]),
        "onsite_contact_name": ({"onsite_contact_name": "   "}, FIELD["onsite_contact_name"]),
        "onsite_contact_phone": ({"onsite_contact_phone": "call reception"}, FIELD["onsite_contact_phone"]),
        "consumer_name": ({"consumer_name": ""}, FIELD["consumer_name"]),
        "duration_minutes": ({"duration_minutes": DURATION_MAX + INCREMENT_MINUTES}, FIELD["duration_minutes"]),
        "start": ({"start": f"{d} 09:00"}, START_FORMAT),
    }
    for field, (over, message) in bad.items():
        assert_field(lena.post("/api/bookings", {**booking_body("riverbend", "medical", SOLO_THRESHOLD, start), **over}), field, message)
    for duration in (DURATION_MIN - INCREMENT_MINUTES, DURATION_MIN + 5):
        assert_field(lena.post("/api/bookings", booking_body("riverbend", "medical", duration, start)), "duration_minutes", FIELD["duration_minutes"])
    assert lena.post("/api/bookings", booking_body("riverbend", "medical", DURATION_MAX, start)).status_code == 201
    far = lena.get(f"/api/bookings?from={d}&to={d + timedelta(days=32)}")
    body = assert_error(far, 422, "validation")
    assert FIELD["range"] in (body.get("fields") or {}).values()


def test_visibility(app_url: str) -> None:
    lena = Api(app_url, ORGS["riverbend"][0])
    sam = Api(app_url, ORGS["maple-valley"][0])
    coord = Api(app_url, COORD)
    jordan = Api(app_url, INTERPRETERS["jordan-reyes"][2])
    sasha = Api(app_url, INTERPRETERS["sasha-lindqvist"][2])
    ag = agency(lena)
    d = pool_day(ag)
    secret = f"Consumer {uuid.uuid4().hex[:8]}"
    b = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T13:00", consumer_name=secret))
    fname = f"{uuid.uuid4().hex}.pdf"
    m = lena.upload(b["id"], fname, pdf_bytes())
    assert m.status_code == 201
    for path in (f"/api/bookings/{b['id']}", f"/api/bookings/{b['id']}/cancellation-quote"):
        r = sam.get(path)
        assert_error(r, 404, "not_found")
        assert secret not in r.text and fname not in r.text
    assert_error(sam.post(f"/api/bookings/{b['id']}/cancel", {"quoted_charge_cents": 0}), 404, "not_found")
    assert all(x["ref"] != b["ref"] for x in sam.get(f"/api/bookings?from={d}&to={d}").json()["bookings"])
    assert all(x["org_name"] == ORGS["riverbend"][2] for x in lena.get(f"/api/bookings?from={d}&to={d}").json()["bookings"])
    assert_error(statement(sam, "riverbend", monday_of(today_of(ag))), 404, "not_found")
    assert_error(jordan.get(f"/api/bookings/{b['id']}"), 404, "not_found")
    assert coord.post(f"/api/bookings/{b['id']}/open-call").status_code == 200
    offered = jordan.get(f"/api/bookings/{b['id']}")
    assert offered.status_code == 200 and offered.json()["materials"] == [], "an offered non-holder sees no file list"
    assert_error(sasha.get(f"/api/bookings/{b['id']}"), 404, "not_found")
    assert_error(sasha.post(f"/api/bookings/{b['id']}/seats/1/release"), 404, "not_found")
    other = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["jordan-reyes"])
    assign(coord, other, "jordan-reyes", 1)
    mid = m.json()["id"]
    assert_error(jordan.post(f"/api/bookings/{other['id']}/materials/{mid}/link"), 404, "not_found")


def test_text_limits(app_url: str) -> None:
    lena = Api(app_url, ORGS["riverbend"][0])
    coord = Api(app_url, COORD)
    d = pool_day(agency(lena))
    start = f"{d}T14:00"
    accepted = {
        "title": "🦻" * TITLE_MAX,
        "requester_notes": "é" * NOTES_MAX,
        "location": "🦻" * LOCATION_MAX,
        "consumer_name": "ễ" * PERSON_NAME_MAX,
        "onsite_contact_name": "Ñ" * PERSON_NAME_MAX,
    }
    for field, value in accepted.items():
        b = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD, start, **{field: value}))
        assert get_booking(lena, b)[field] == value, f"{field} at its limit must be stored exactly"
        assert_field(lena.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, start, **{field: value + value[0]})), field, FIELD[field])
    decomposed = "e\u0301" * (TITLE_MAX // 2)
    b = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD, start, title=decomposed))
    assert get_booking(lena, b)["title"] == decomposed, "decomposed text is never normalised"
    padded = "  Spaced title  "
    b = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD, start, title=padded))
    assert get_booking(lena, b)["title"] == padded, "text is never trimmed"
    assert_field(lena.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, start, title="   ")), "title", FIELD["title"])
    assert coord.client.get("/api/interpreters", params={"q": "a" * Q_MAX}).status_code == 200
    assert_field(coord.client.get("/api/interpreters", params={"q": "a" * (Q_MAX + 1)}), "q", FIELD["q"])


def test_agency_time(app_url: str) -> None:
    coord = Api(app_url, COORD)
    ag = agency(coord)
    assert ag["time_zone"] == AGENCY_TZ_NAME and ag["name"] == AGENCY_NAME and ag["solo_threshold_minutes"] == SOLO_THRESHOLD
    assert_field(coord.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, "2027-03-14T02:30")), "start", START_SKIPPED)
    rep = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, "2027-11-07T01:30"))
    assert datetime.fromisoformat(rep["start"]) == datetime.fromisoformat("2027-11-07T01:30:00-05:00")
    assert datetime.fromisoformat(rep["start"]).utcoffset() == timedelta(hours=-5)
    long = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD * 3, "2027-03-14T00:30"))
    assert datetime.fromisoformat(long["end"]) == datetime.fromisoformat("2027-03-14T04:30:00-05:00")
    assert datetime.fromisoformat(long["end"]).utcoffset() == timedelta(hours=-5)
    d = pool_day(ag)
    assert coord.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T09:00:00")).status_code == 201
    assert_field(coord.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T09:00:30")), "start", START_FORMAT)
    assert_field(coord.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T09:00-05:00")), "start", START_FORMAT)
    soon = (local(ag["now"]) + timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M")
    assert_field(coord.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, soon)), "start", START_SOON)
    late = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T23:30"))
    assert any(x["ref"] == late["ref"] for x in coord.get(f"/api/bookings?from={d}&to={d}").json()["bookings"])
    nxt = d + timedelta(days=1)
    assert all(x["ref"] != late["ref"] for x in coord.get(f"/api/bookings?from={nxt}&to={nxt}").json()["bookings"])


def test_wf_triage_and_open_call_happy(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    d = pool_day(agency(coord))
    b = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, slot_start(d)))
    with signed_in(browser, app_url, COORD, path=f"/?date={d}") as page:
        board = page.get_by_role("region", name="Coverage board")
        r = row(board, b["ref"])
        wait_ui(page, lambda: r.count() == 1, f"row {b['ref']} on the board")
        assert r.get_attribute("data-coverage") == "uncovered"
        assert "Uncovered" in (r.evaluate("e => e.getAttribute('aria-label') || e.innerText") or "") or "Uncovered" in txt(r)
        click(r)
        wait_ui(page, lambda: heading(page, b).count() == 1 and r.get_attribute("aria-current") == "true", "the selected detail")
        assert weave(page).get_attribute("data-mode") == "solo"
        click(page.get_by_role("button", name="Make team booking"))
        wait_ui(page, lambda: txt(action_status(page)) == f"{b['ref']} now needs a team of two.", "Make team success copy")
        wait_ui(page, lambda: weave(page).get_attribute("data-mode") == "team", "weave in team mode")
        click(page.get_by_role("button", name="Post open call"))
        wait_ui(page, lambda: txt(action_status(page)) == f"Open call posted for {b['ref']}.", "Post open call success copy")
        api_b = get_booking(coord, b)
        assert api_b["status"] == "open" and api_b["seat_count"] == 2 and api_b["open_call_status"] == "open"
        closes = api_b["open_call_closes_at"]
        line = f"Open call closes {ymd(closes)} {hhmm(closes)}"
        wait_ui(page, lambda: line in txt(page.get_by_role("region", name="Seats")), line)
        wait_ui(page, lambda: STATUS_LABELS["open"] in txt(row(board, b["ref"])), "row to read Open call")


def test_wf_triage_and_open_call_stale_refresh(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    d = pool_day(agency(coord))
    b = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, slot_start(d)))
    stash: list[tuple[Any, Any]] = []
    stall = {"on": False}

    def hold_reads(route: Any) -> None:
        path = urlparse(route.request.url).path
        if stall["on"] and route.request.method == "GET" and re.fullmatch(r"/api/bookings(/[^/]+)?", path):
            stash.append((route, route.fetch()))
            return
        route.continue_()
    with signed_in(browser, app_url, COORD, path=board_path(b)) as page:
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail of the selected booking")
        page.route("**/api/bookings**", hold_reads)
        for button, copy, check_state in (
            ("Make team booking", f"{b['ref']} now needs a team of two.", lambda: weave(page).get_attribute("data-mode") == "team"),
            ("Post open call", f"Open call posted for {b['ref']}.", lambda: STATUS_LABELS["open"] in txt(row(page.get_by_role("region", name="Coverage board"), b["ref"]))),
        ):
            stall["on"] = True
            stash.clear()
            advance(page, REFRESH_MS)
            wait_ui(page, lambda: len(stash) > 0, "a periodic refetch to be in flight")
            stall["on"] = False
            click(page.get_by_role("button", name=button))
            wait_ui(page, lambda: txt(action_status(page)) == copy and check_state(), f"{button} result")
            for route, resp in stash:
                route.fulfill(response=resp)
            stash.clear()
            for _ in range(10):
                advance(page, 100)
                assert check_state(), f"a stale refetch undid {button}"
                assert txt(action_status(page)) == copy, f"a stale refetch cleared the {button} announcement"
        advance(page, REFRESH_MS)
        assert weave(page).get_attribute("data-mode") == "team"
        assert STATUS_LABELS["submitted"] not in txt(row(page.get_by_role("region", name="Coverage board"), b["ref"]))
        assert "Open call closes" in txt(page.get_by_role("region", name="Seats"))
    assert get_booking(coord, b)["status"] == "open"


def test_wf_triage_and_open_call_url(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    ag = agency(coord)
    d = pool_day(ag)
    prev = d - timedelta(days=1)
    b = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, slot_start(d)))
    with signed_in(browser, app_url, COORD, path=f"/?date={prev}") as page:
        board = page.get_by_role("region", name="Coverage board")
        h0 = page.evaluate("history.length")
        click(page.get_by_role("button", name="Next day"))
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("date") == [d.isoformat()], "date in the URL")
        assert "booking" not in parse_qs(urlparse(page.url).query)
        assert page.evaluate("history.length") == h0 + 1
        r = row(board, b["ref"])
        wait_ui(page, lambda: r.count() == 1, "the booking row on its day")
        click(r)
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("booking") == [str(b["id"])], "booking in the URL")
        assert page.evaluate("history.length") == h0 + 1, "selecting rewrites the entry in place"
        url = page.url
        advance(page, REFRESH_MS)
        advance(page, REFRESH_MS)
        assert page.url == url, "the periodic refresh never changes the address"
        page.reload()
        wait_ui(page, lambda: row(board, b["ref"]).get_attribute("aria-current") == "true" and heading(page, b).count() == 1, "selection restored after reload")
        assert page.get_by_label("Board date").input_value() == d.isoformat()
        page.go_back()
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("date") == [prev.isoformat()], "Back to the previous day")
        assert "booking" not in parse_qs(urlparse(page.url).query)
        wait_ui(page, lambda: board.get_by_role("button", name=ROW_NAME_RE).filter(has=page.locator("[aria-current='true']")).count() == 0 and page.get_by_label("Board date").input_value() == prev.isoformat(), "previous day with nothing selected")
        assert is_focused(page.get_by_label("Board date"))
        page.go_forward()
        wait_ui(page, lambda: row(board, b["ref"]).get_attribute("aria-current") == "true", "Forward restores day and selection")
        assert parse_qs(urlparse(page.url).query).get("booking") == [str(b["id"])]
        page.goto(app_url.rstrip("/") + "/?date=not-a-date")
        h1 = page.evaluate("history.length")
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("date") == [ag["today"]], "malformed date replaced by today")
        assert page.evaluate("history.length") == h1 and txt(action_error(page)) == ""


def test_coverage_states(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    ag = agency(coord)
    for _ in range(SLOT_ATTEMPTS):
        d = pool_day(ag)
        un = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T07:00"))
        part = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["casey-morgan"], day=d, start=f"{d}T09:00")
        cov = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T13:00"))
        c = choices(coord, cov["id"])
        if not c["jordan-reyes"]["busy"]:
            break
    else:
        pytest.fail("no free day for the coverage-state rows")
    assign(coord, part, "casey-morgan", 1)
    assign(coord, cov, "jordan-reyes", 1)
    with signed_in(browser, app_url, COORD, path=f"/?date={d}") as page:
        board = page.get_by_role("region", name="Coverage board")
        expected = {un["ref"]: ("uncovered", "Uncovered"), part["ref"]: ("partly_covered", "Partly covered"), cov["ref"]: ("covered", "Covered")}
        for ref, (attr, label) in expected.items():
            r = board.get_by_role("button", name=re.compile(r"^\d\d:\d\d " + re.escape(ref) + r" .*, " + re.escape(label) + "$"))
            wait_ui(page, lambda: r.count() == 1, f"row {ref} labelled {label}")
            assert r.get_attribute("data-coverage") == attr
            assert label in txt(r), "the state label is visible text, not colour alone"
        axe(page)
        click(row(board, part["ref"]))
        wait_ui(page, lambda: heading(page, part).count() == 1, "partly covered detail")
        gaps = [e for e in entries(page) if e.get("kind") == "gap"]
        assert gaps and all(e.get("holder", "") == "" for e in gaps)
        assert "relief needed" in txt(weave(page))
        click(row(board, un["ref"]))
        wait_ui(page, lambda: heading(page, un).count() == 1, "uncovered detail")
        assert "uncovered" in txt(weave(page))


def test_team_and_open_call(app_url: str) -> None:
    coord = Api(app_url, COORD)
    lena = Api(app_url, ORGS["riverbend"][0])
    jordan = Api(app_url, INTERPRETERS["jordan-reyes"][2])
    sasha = Api(app_url, INTERPRETERS["sasha-lindqvist"][2])
    ag = agency(coord)
    lead = ag["open_call_lead_minutes"]
    b = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, slot_start(pool_day(ag))))
    assert_error(lena.post(f"/api/bookings/{b['id']}/team"), 403, "forbidden")
    t = coord.post(f"/api/bookings/{b['id']}/team")
    assert t.status_code == 200 and t.json()["seat_count"] == 2 and t.json()["rotation"]["mode"] == "team"
    assert_error(coord.post(f"/api/bookings/{b['id']}/team"), 409, "already_team")
    o = coord.post(f"/api/bookings/{b['id']}/open-call")
    assert o.status_code == 200
    ob = o.json()
    assert ob["status"] == "open" and ob["open_call_status"] == "open"
    assert datetime.fromisoformat(ob["open_call_closes_at"]) == datetime.fromisoformat(ob["start"]) - timedelta(minutes=lead)
    assert assert_error(coord.post(f"/api/bookings/{b['id']}/open-call"), 409, "invalid_transition")["status"] == "open"
    assert any(x["ref"] == b["ref"] for x in jordan.get("/api/open-calls").json()["bookings"])
    assert all(x["ref"] != b["ref"] for x in sasha.get("/api/open-calls").json()["bookings"])
    assert_error(jordan.post(f"/api/bookings/{b['id']}/team"), 403, "forbidden")
    solo_open = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, slot_start(pool_day(ag))))
    assert coord.post(f"/api/bookings/{solo_open['id']}/open-call").status_code == 200
    assert coord.post(f"/api/bookings/{solo_open['id']}/team").json()["seat_count"] == 2, "an open booking can still become a team"
    dst = create(coord, booking_body("harlan-court", "legal", SOLO_THRESHOLD, "2027-03-14T12:00"))
    dst_open = coord.post(f"/api/bookings/{dst['id']}/open-call").json()
    expected = datetime.fromisoformat("2027-03-14T12:00:00-05:00") - timedelta(minutes=lead)
    assert datetime.fromisoformat(dst_open["open_call_closes_at"]) == expected
    assert datetime.fromisoformat(dst_open["open_call_closes_at"]).utcoffset() == expected.astimezone(AGENCY_TZ).utcoffset()
    soon = (local(ag["now"]) + timedelta(minutes=MIN_START_LEAD * 2)).strftime("%Y-%m-%dT%H:%M")
    near = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, soon))
    assert_error(coord.post(f"/api/bookings/{near['id']}/open-call"), 409, "open_call_closed")
    assert get_booking(coord, near)["status"] == "submitted"
    cov = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["casey-morgan"])
    assign(coord, cov, "casey-morgan", 1)
    assert assert_error(coord.post(f"/api/bookings/{cov['id']}/open-call"), 409, "invalid_transition")["status"] == "covered"


@pytest.mark.timeout(2400)
def test_open_call_server_timed(browser: Browser) -> None:
    short = os.environ["APP_SHORT_URL"]
    coord = Api(short, COORD)
    jordan = Api(short, INTERPRETERS["jordan-reyes"][2])
    ag = agency(coord)
    lead = ag["open_call_lead_minutes"]
    now = local(ag["now"])
    start = (now + timedelta(minutes=MIN_START_LEAD + 2)).replace(second=0, microsecond=0)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["jordan-reyes"], start=start.strftime("%Y-%m-%dT%H:%M"))
    posted = coord.post(f"/api/bookings/{b['id']}/open-call").json()
    closes = posted["open_call_closes_at"]
    assert datetime.fromisoformat(closes) == datetime.fromisoformat(posted["start"]) - timedelta(minutes=lead)
    line = f"Open call closes {ymd(closes)} {hhmm(closes)}"
    wrong = datetime.fromisoformat(closes).astimezone(timezone.utc) + timedelta(hours=WRONG_CLOCK_HOURS)
    with signed_in(browser, short, INTERPRETERS["jordan-reyes"][2], clock_at=wrong) as page:
        calls = page.get_by_role("region", name="Open calls")
        claim = calls.get_by_role("button", name=f"Claim seat on {b['ref']}")
        wait_ui(page, lambda: claim.count() == 1, "the open call offered despite a browser clock past its close")
        click(row(calls, b["ref"]))
        seats = page.get_by_role("region", name="Seats")
        wait_ui(page, lambda: line in txt(seats), line)
        assert seats.get_by_role("button", name="Claim seat", exact=True).count() == 1
        end = time.monotonic() + (datetime.fromisoformat(closes) - datetime.fromisoformat(ag["now"])).total_seconds() + 180
        while time.monotonic() < end:
            if datetime.fromisoformat(agency(coord)["now"]) >= datetime.fromisoformat(closes):
                break
        else:
            pytest.fail("the short-timer server clock never reached open_call_closes_at")
        advance(page, REFRESH_MS)
        wait_ui(page, lambda: claim.count() == 0, "the claim to leave Open calls within one refresh", step_ms=5)
        assert seats.get_by_role("button", name="Claim seat", exact=True).count() == 0
    assert_error(jordan.post(f"/api/bookings/{b['id']}/claim"), 409, "open_call_closed")
    assert get_booking(coord, b)["open_call_status"] == "closed"
    assert all(x["ref"] != b["ref"] for x in jordan.get("/api/open-calls").json()["bookings"])
    with signed_in(browser, short, COORD, path=board_path(b)) as page:
        wait_ui(page, lambda: "Open call closed — assign directly" in txt(page.get_by_role("region", name="Seats")), "the coordinator's closed line")


def test_wf_open_call_claim_race(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["jordan-reyes", "avery-chen", "casey-morgan"])
    coord.post(f"/api/bookings/{b['id']}/open-call")
    jordan = Api(app_url, INTERPRETERS["jordan-reyes"][2])
    assert jordan.post(f"/api/bookings/{b['id']}/claim").status_code == 200
    with signed_in(browser, app_url, INTERPRETERS["avery-chen"][2]) as pa, signed_in(browser, app_url, INTERPRETERS["casey-morgan"][2]) as pc:
        for p in (pa, pc):
            btn = p.get_by_role("region", name="Open calls").get_by_role("button", name=f"Claim seat on {b['ref']}")
            wait_ui(p, lambda: btn.count() == 1, "the open call row")
        with held(pa, "**/api/bookings/*/claim") as ha, held(pc, "**/api/bookings/*/claim") as hc:
            click(pa.get_by_role("button", name=f"Claim seat on {b['ref']}"))
            click(pc.get_by_role("button", name=f"Claim seat on {b['ref']}"))
            ha.release()
            hc.release()
        final = get_booking(coord, b)
        winner_id = next(iid for iid, v in INTERPRETERS.items() if final["seats"][1]["holder"] and final["seats"][1]["holder"]["name"] == v[0])
        win, lose = (pa, pc) if winner_id == "avery-chen" else (pc, pa)
        wait_ui(win, lambda: txt(action_status(win)) == f"You hold seat 2 on {b['ref']}.", "winner success copy")
        mine = row(win.get_by_role("region", name="My assignments"), b["ref"])
        wait_ui(win, lambda: mine.get_attribute("aria-current") == "true", "claimed row selected under My assignments")
        assert row(win.get_by_role("region", name="Open calls"), b["ref"]).count() == 0
        wait_ui(win, lambda: "100% covered" in txt(win.get_by_role("status", name="Coverage")), "coverage figure at 100%")
        wait_ui(lose, lambda: txt(action_error(lose)) == COPY_SEAT_FILLED, "loser's already-filled alert")
        wait_ui(lose, lambda: row(lose.get_by_role("region", name="Open calls"), b["ref"]).count() == 0, "row leaves the loser's Open calls")
    assert final["status"] == "covered" and sum(1 for s in final["seats"] if s["holder"]) == 2
    with signed_in(browser, app_url, ORGS["riverbend"][0], path=f"/bookings/{b['id']}") as page:
        region = page.get_by_role("region", name="Interpreters")
        wait_ui(page, lambda: region.get_by_role("article").count() == 2, "two interpreter cards")
        card = region.get_by_role("article", name="Jordan Reyes")
        assert "JR" in txt(card) and "NIC" in txt(card)
        for iid in ("jordan-reyes", winner_id):
            _, _, email, phone, home, _, _ = INTERPRETERS[iid]
            assert email not in txt(region) and phone not in txt(region) and home not in txt(region)


def test_claim_race_api(app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["jordan-reyes", "avery-chen", "casey-morgan", "riley-brooks", "quinn-halvorsen"])
    coord.post(f"/api/bookings/{b['id']}/open-call")
    assert Api(app_url, INTERPRETERS["jordan-reyes"][2]).post(f"/api/bookings/{b['id']}/claim").status_code == 200
    racers = [Api(app_url, INTERPRETERS[i][2]) for i in ("avery-chen", "casey-morgan", "quinn-halvorsen")]
    calls: list[Callable[[], Any]] = [lambda a=a: a.post(f"/api/bookings/{b['id']}/claim") for a in racers]
    calls.append(lambda: coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "riley-brooks", "seat": 2}))
    results = together(calls)
    wins = [r for r in results if r.status_code == 200]
    assert len(wins) == 1, f"exactly one fill must win; got {[r.status_code for r in results]}"
    for r in results:
        if r.status_code != 200:
            assert_error(r, 409, "seat_filled")
    final = get_booking(coord, b)
    held_seats = [s for s in final["seats"] if s["holder"]]
    assert final["status"] == "covered" and len(held_seats) == 2 == final["seat_count"]
    assert len({s["holder"]["id"] for s in held_seats}) == 2
    assert sum(1 for t in final["rotation"]["turns"] if t["kind"] == "turn" and t["seat"] not in (1, 2)) == 0
    assert sum(1 for e in audit(coord, b) if e["action"] == "seat_filled") == 2


def test_role_cards(app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["jordan-reyes", "avery-chen"])
    coord.post(f"/api/bookings/{b['id']}/open-call")
    assign(coord, b, "jordan-reyes", 1)
    assign(coord, b, "avery-chen", 2)
    base = {"id", "ref", "org_name", "setting", "title", "location", "onsite_contact_name", "onsite_contact_phone", "consumer_name", "start", "end",
            "duration_minutes", "status", "seat_count", "open_call_status", "open_call_closes_at", "coverage", "seats", "rotation", "materials"}
    staff = base | {"org_id", "requester_name", "requester_notes", "charge", "created_at"}
    shapes = {
        COORD: (staff, {"id", "name", "initials", "credentials", "phone", "email", "home_city", "pay_rate_cents"}),
        BILLING: (staff, {"id", "name", "initials", "credentials"}),
        ORGS["riverbend"][0]: (base | {"requester_name", "requester_notes", "charge"}, {"name", "initials", "credentials"}),
        INTERPRETERS["jordan-reyes"][2]: (base, {"name", "initials", "credentials", "is_me"}),
    }
    for email, (bkeys, hkeys) in shapes.items():
        api = Api(app_url, email)
        got = get_booking(api, b)
        listed = [x for x in api.get(f"/api/bookings?from={ymd(b['start'])}&to={ymd(b['start'])}").json()["bookings"] if x["id"] == b["id"]]
        for data in [got] + listed:
            assert set(data) == bkeys, f"{email} booking keys {sorted(set(data) ^ bkeys)} differ"
            assert set(data["coverage"]) == {"state", "covered_minutes", "percent"}
            assert set(data["rotation"]) == {"mode", "interval_minutes", "threshold_minutes", "coverage_text", "turns"}
            for seat in data["seats"]:
                assert set(seat) == {"seat", "holder"} and set(seat["holder"]) == hkeys, f"{email} holder keys {seat['holder']}"
        if email != COORD:
            for iid in ("jordan-reyes", "avery-chen"):
                _, _, iemail, phone, home, _, pay = INTERPRETERS[iid]
                for secret in (iemail, phone, home):
                    assert secret not in json.dumps(got, ensure_ascii=False)
                assert all(isinstance(c, str) for s in got["seats"] for c in s["holder"]["credentials"])
    cards = {s["seat"]: s["holder"] for s in get_booking(coord, b)["seats"]}
    name, initials, iemail, phone, home, creds, pay = INTERPRETERS["jordan-reyes"]
    assert cards[1] == {"id": "jordan-reyes", "name": name, "initials": initials, "credentials": [{"code": c, "expires_on": e} for c, e in creds],
                        "phone": phone, "email": iemail, "home_city": home, "pay_rate_cents": pay}
    mine = {s["seat"]: s["holder"] for s in get_booking(Api(app_url, INTERPRETERS["jordan-reyes"][2]), b)["seats"]}
    assert mine[1]["is_me"] is True and mine[2]["is_me"] is False
    assert get_booking(Api(app_url, ORGS["riverbend"][0]), b)["seats"][1]["holder"] == {"name": "Avery Chen", "initials": "AC", "credentials": ["NIC", "EIPA"]}


def test_seat_filling(app_url: str) -> None:
    coord = Api(app_url, COORD)
    ag = agency(coord)
    for _ in range(SLOT_ATTEMPTS):
        d = pool_day(ag, TAYLOR_EIPA_END)
        b = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD * 2, f"{d}T12:00"))
        clash = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T12:30"))
        touch = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T11:00"))
        free = choices(coord, b["id"])
        if all(not free[i]["busy"] for i in ("jordan-reyes", "avery-chen", "casey-morgan", "riley-brooks")):
            break
    else:
        pytest.fail("no free day for the seat-filling checks")
    assign(coord, clash, "casey-morgan", 1)
    assign(coord, touch, "avery-chen", 1)
    coord.post(f"/api/bookings/{b['id']}/open-call")
    jordan = Api(app_url, INTERPRETERS["jordan-reyes"][2])
    c = jordan.post(f"/api/bookings/{b['id']}/claim")
    assert c.status_code == 200 and c.json()["seats"][0]["holder"]["name"] == "Jordan Reyes" and c.json()["status"] == "partially_covered"
    assert_error(jordan.post(f"/api/bookings/{b['id']}/claim"), 409, "already_holding")
    assert_error(coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "jordan-reyes", "seat": 1}), 409, "already_holding")
    assert_error(coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "riley-brooks", "seat": 1}), 409, "seat_filled")
    assert_error(coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "sasha-lindqvist", "seat": 2}), 409, "not_qualified")
    assert_error(coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "taylor-nguyen", "seat": 2}), 409, "not_qualified")
    assert_error(coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "casey-morgan", "seat": 2}), 409, "schedule_conflict")
    assert_error(Api(app_url, INTERPRETERS["casey-morgan"][2]).post(f"/api/bookings/{b['id']}/claim"), 409, "schedule_conflict")
    assert_error(Api(app_url, INTERPRETERS["sasha-lindqvist"][2]).post(f"/api/bookings/{b['id']}/claim"), 404, "not_found")
    assert_field(coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "avery-chen"}), "seat", FIELD["seat"])
    assert_field(coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "avery-chen", "seat": 3}), "seat", FIELD["seat"])
    assert_field(coord.post(f"/api/bookings/{b['id']}/assign", {"seat": 2}), "interpreter_id", FIELD["interpreter_id"])
    assert_error(coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "no-such-interpreter", "seat": 2}), 404, "not_found")
    assert get_booking(coord, b)["seats"][1]["holder"] is None, "refusals change nothing"
    full = assign(coord, b, "avery-chen", 2)
    assert full["status"] == "covered", "touching spans do not overlap"
    assert_error(Api(app_url, INTERPRETERS["riley-brooks"][2]).post(f"/api/bookings/{b['id']}/claim"), 409, "seat_filled")
    edu = create(coord, booking_body("maple-valley", "educational", SOLO_THRESHOLD, f"{d}T16:00"))
    if not choices(coord, edu["id"])["taylor-nguyen"]["busy"]:
        assert assign(coord, edu, "taylor-nguyen", 1)["status"] == "covered", "an unexpired EIPA qualifies for educational"


def test_wf_open_call_claim_refusal(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    a = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["jordan-reyes"])
    coord.post(f"/api/bookings/{a['id']}/open-call")
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["jordan-reyes", "avery-chen", "casey-morgan"])
    coord.post(f"/api/bookings/{b['id']}/open-call")
    assign(coord, b, "avery-chen", 1)
    stash: list[tuple[Any, Any]] = []
    stall = {"on": False}

    def hold_lists(route: Any) -> None:
        if stall["on"] and route.request.method == "GET":
            stash.append((route, route.fetch()))
            return
        route.continue_()
    with signed_in(browser, app_url, INTERPRETERS["jordan-reyes"][2]) as page:
        calls = page.get_by_role("region", name="Open calls")
        mine = page.get_by_role("region", name="My assignments")
        wait_ui(page, lambda: row(calls, a["ref"]).count() == 1 and row(calls, b["ref"]).count() == 1, "both open calls listed")
        page.route("**/api/open-calls**", hold_lists)
        stall["on"] = True
        advance(page, REFRESH_MS)
        wait_ui(page, lambda: len(stash) > 0, "an Open calls refetch in flight")
        stall["on"] = False
        with held(page, "**/api/bookings/*/claim") as h:
            click(calls.get_by_role("button", name=f"Claim seat on {a['ref']}"))
            pending = calls.get_by_role("button", name=COPY_CLAIMING)
            wait_ui(page, lambda: pending.count() == 1, "Claim seat pending label")
            assert pending.first.is_disabled() and row(mine, a["ref"]).count() == 0 and row(calls, a["ref"]).count() == 1
            h.release()
        wait_ui(page, lambda: row(mine, a["ref"]).get_attribute("aria-current") == "true", "claimed row under My assignments")
        assert is_focused(heading(page, a)), "focus moves to the detail heading"
        for route, resp in stash:
            route.fulfill(response=resp)
        for _ in range(5):
            advance(page, 100)
            assert row(calls, a["ref"]).count() == 0, "a stale refetch put the claimed row back"
        assert Api(app_url, INTERPRETERS["casey-morgan"][2]).post(f"/api/bookings/{b['id']}/claim").status_code == 200
        click(calls.get_by_role("button", name=f"Claim seat on {b['ref']}"))
        wait_ui(page, lambda: txt(action_error(page)) == COPY_SEAT_FILLED and row(calls, b["ref"]).count() == 0, "refusal copy and the row gone")
        inside = calls.evaluate("r => r === document.activeElement || r.contains(document.activeElement)")
        assert inside, "focus lands on a neighbouring Open calls row or the region"
        page.evaluate("() => { window.__focusAfterRefusal = document.activeElement; }")
        for _ in range(2):
            advance(page, REFRESH_MS)
            assert txt(action_error(page)) == COPY_SEAT_FILLED
            assert page.evaluate("() => window.__focusAfterRefusal === document.activeElement"), "a refresh moved focus"
            assert row(calls, a["ref"]).count() == 0
    holders = {s["holder"]["id"] for s in get_booking(coord, a)["seats"] if s["holder"]}
    assert holders == {"jordan-reyes"}


def test_wf_coordinator_assign_court(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = legal_pair(coord)
    interval = CONTRACTS["harlan-court"][3]
    with signed_in(browser, app_url, COORD, path=board_path(b)) as page:
        wait_ui(page, lambda: heading(page, b).count() == 1, "court booking detail")
        click(page.get_by_role("button", name="Assign seat 1"))
        dlg = page.get_by_role("dialog", name="Assign interpreter")
        wait_ui(page, lambda: dlg.get_by_role("radio").count() >= 1, "Assign interpreter results")
        search = dlg.get_by_role("searchbox", name="Find interpreter")
        assert search.input_value() == "" and all(not dlg.get_by_role("radio").nth(i).is_checked() for i in range(dlg.get_by_role("radio").count()))
        fill(search, "ri")
        advance(page, DEBOUNCE_MS)
        wait_ui(page, lambda: dlg.get_by_role("radio").count() == 1 and dlg.get_by_role("radio", name="Riley Brooks").count() == 1, "only Riley Brooks for 'ri'")
        check(dlg.get_by_role("radio", name="Riley Brooks"))
        click(dlg.get_by_role("button", name="Assign", exact=True))
        wait_ui(page, lambda: txt(action_status(page)) == f"Riley Brooks holds seat 1 on {b['ref']}.", "seat 1 success copy")
        wait_ui(page, lambda: dlg.count() == 0, "dialog closes")
        assert is_focused(page.get_by_role("heading", name="Seats", level=3))
        click(page.get_by_role("button", name="Assign seat 2"))
        wait_ui(page, lambda: dlg.get_by_role("radio", name="Sasha Lindqvist").count() == 1, "Sasha listed")
        assert dlg.get_by_role("radio", name="Riley Brooks").is_disabled(), "the holder of the other seat is disabled"
        check(dlg.get_by_role("radio", name="Sasha Lindqvist"))
        click(dlg.get_by_role("button", name="Assign", exact=True))
        wait_ui(page, lambda: txt(action_status(page)) == f"Sasha Lindqvist holds seat 2 on {b['ref']}.", "seat 2 success copy")
        n = -(-b["duration_minutes"] // interval)
        wait_ui(page, lambda: weave(page).get_attribute("data-mode") == "team" and len(entries(page)) == n, "alternating turns drawn")
        holders = [e["holder"] for e in sorted(entries(page), key=lambda e: int(e["turnIndex"]))]
        assert holders == [("RB" if i % 2 == 0 else "SL") for i in range(n)]
    final = get_booking(coord, b)
    assert final["status"] == "covered" and [s["holder"]["id"] for s in final["seats"]] == ["riley-brooks", "sasha-lindqvist"]
    with signed_in(browser, app_url, ORGS["harlan-court"][0], path=f"/bookings/{b['id']}") as page:
        region = page.get_by_role("region", name="Interpreters")
        wait_ui(page, lambda: region.get_by_role("article").count() == 2, "two cards")
        card = region.get_by_role("article", name="Riley Brooks")
        assert "RB" in txt(card) and "SC:L" in txt(card)
        for iid in ("riley-brooks", "sasha-lindqvist"):
            _, _, email, phone, home, _, _ = INTERPRETERS[iid]
            assert email not in txt(region) and phone not in txt(region) and home not in txt(region)


def test_wf_coordinator_assign_conflict(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = legal_pair(coord)
    assign(coord, b, "riley-brooks", 1)
    root = app_url.rstrip("/")
    with open_app(browser, root + "/") as page:
        page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
        for loc in (action_status(page), action_error(page)):
            assert loc.count() == 1 and txt(loc) == "", "live regions present and empty at first load"
        ui_sign_in(page, COORD)
        page.goto(root + board_path(b))
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail")
        click(page.get_by_role("button", name="Assign seat 2"))
        dlg = page.get_by_role("dialog", name="Assign interpreter")
        quinn = dlg.get_by_role("radio", name="Quinn Halvorsen")
        wait_ui(page, lambda: quinn.count() == 1 and quinn.is_enabled(), "Quinn enabled")
        check(quinn)
        other = create(coord, booking_body("harlan-court", "legal", b["duration_minutes"], f"{ymd(b['start'])}T{hhmm(b['start'])}"))
        assign(coord, other, "quinn-halvorsen", 1)
        with held(page, "**/api/bookings/*/assign") as h:
            click(dlg.get_by_role("button", name="Assign", exact=True))
            wait_ui(page, lambda: txt(action_status(page)) == COPY_ASSIGNING, "Assigning… announced")
            pending = dlg.get_by_role("button", name=COPY_ASSIGNING)
            assert pending.count() == 1 and pending.is_disabled()
            h.release()
        wait_ui(page, lambda: txt(action_error(page)) == COPY_CONFLICT, "schedule_conflict alert")
        wait_ui(page, lambda: quinn.count() == 0 or quinn.is_disabled(), "Quinn disabled after refetch")
        assert dlg.count() == 1 and txt(action_status(page)) == ""
        if quinn.count():
            assert COPY_BUSY in txt(dlg) and not quinn.is_checked()
        radios = dlg.get_by_role("radio")
        first = next(radios.nth(i) for i in range(radios.count()) if radios.nth(i).is_enabled())
        assert is_focused(first), "focus moves to the first enabled radio"
        check(dlg.get_by_role("radio", name="Sasha Lindqvist"))
        click(dlg.get_by_role("button", name="Assign", exact=True))
        wait_ui(page, lambda: txt(action_status(page)) == f"Sasha Lindqvist holds seat 2 on {b['ref']}.", "success after conflict")
    assert get_booking(coord, b)["seats"][1]["holder"]["id"] == "sasha-lindqvist"


def test_wf_coordinator_assign_search(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = legal_pair(coord)
    stale: list[tuple[Any, Any]] = []

    def hold_r(route: Any) -> None:
        q = parse_qs(urlparse(route.request.url).query).get("q", [""])[0]
        if q == "r" and not stale:
            stale.append((route, route.fetch()))
            return
        route.continue_()
    with signed_in(browser, app_url, COORD, path=board_path(b)) as page:
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail")
        page.route("**/api/interpreters**", hold_r)
        click(page.get_by_role("button", name="Assign seat 1"))
        dlg = page.get_by_role("dialog", name="Assign interpreter")
        search = dlg.get_by_role("searchbox", name="Find interpreter")
        wait_ui(page, lambda: dlg.get_by_role("radio").count() >= 1, "initial results")
        fill(search, "r")
        advance(page, DEBOUNCE_MS)
        wait_ui(page, lambda: len(stale) == 1, "the 'r' search in flight")
        fill(search, "ri")
        advance(page, DEBOUNCE_MS)
        wait_ui(page, lambda: dlg.get_by_role("radio").count() == 1 and dlg.get_by_role("radio", name="Riley Brooks").count() == 1, "'ri' results")
        route, resp = stale[0]
        route.fulfill(response=resp)
        for _ in range(10):
            advance(page, 100)
            assert dlg.get_by_role("radio", name="Quinn Halvorsen").count() == 0, "a stale answer repainted the list"
        assign_btn = dlg.get_by_role("button", name="Assign", exact=True)
        assert assign_btn.is_disabled()
        check(dlg.get_by_role("radio", name="Riley Brooks"))
        assert assign_btn.is_enabled()
        fill(search, "riz")
        advance(page, DEBOUNCE_MS)
        wait_ui(page, lambda: 'No interpreter matches "riz".' in txt(dlg), "no-match line")
        assert dlg.get_by_role("radio").count() == 0 and assign_btn.is_disabled()
        fill(search, "ri")
        advance(page, DEBOUNCE_MS)
        wait_ui(page, lambda: dlg.get_by_role("radio", name="Riley Brooks").count() == 1, "Riley back")
        assert not dlg.get_by_role("radio", name="Riley Brooks").is_checked() and assign_btn.is_disabled()
        fill(search, "a" * (Q_MAX + 1))
        advance(page, DEBOUNCE_MS)
        wait_ui(page, lambda: FIELD["q"] in txt(dlg) and dlg.get_by_role("radio").count() == 0, "q field message")
    assert all(s["holder"] is None for s in get_booking(coord, b)["seats"])


def test_assignment_emails(app_url: str, mail: Mailpit) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["jordan-reyes", "avery-chen", "casey-morgan"])
    assign(coord, b, "jordan-reyes", 1)
    assign(coord, b, "avery-chen", 2)
    assert_error(coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "casey-morgan", "seat": 2}), 409, "seat_filled")
    lena = ORGS["riverbend"][0]
    for iid in ("jordan-reyes", "avery-chen"):
        got = mails(mail, subject(SUBJ_ASSIGNED, b), INTERPRETERS[iid][2], 1)
        assert len(got) == 1, f"{iid} must get exactly one assignment confirmation"
        assert mail_from_address() in addresses(got[0].get("From"))
    assert len(mails(mail, subject(SUBJ_COVERED, b), lena, 1)) == 1
    assert len(mails(mail, subject(SUBJ_ASSIGNED, b), INTERPRETERS["casey-morgan"][2], 0)) == 0, "a refused assignment sends nothing"
    assert coord.post(f"/api/bookings/{b['id']}/seats/2/release").status_code == 200
    assign(coord, b, "casey-morgan", 2)
    assert len(mails(mail, subject(SUBJ_ASSIGNED, b), INTERPRETERS["casey-morgan"][2], 1)) == 1
    assert len(mails(mail, subject(SUBJ_COVERED, b), lena, 2)) == 2, "covered again sends a second coverage confirmation"
    down = Api(os.environ["APP_MAILPIT_DOWN_URL"], COORD)
    c = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["riley-brooks"])
    r = down.post(f"/api/bookings/{c['id']}/assign", {"interpreter_id": "riley-brooks", "seat": 1})
    assert r.status_code == 200, "assignment succeeds while mail is down"
    assert len(mails(mail, subject(SUBJ_ASSIGNED, c), INTERPRETERS["riley-brooks"][2], 1)) == 1, "queued mail goes out later, once"
    assert len(mails(mail, subject(SUBJ_COVERED, c), lena, 1)) == 1


def test_email_privacy(app_url: str, mail: Mailpit) -> None:
    coord = Api(app_url, COORD)
    secret = f"Private note {uuid.uuid4().hex[:8]}"
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["jordan-reyes", "avery-chen"], requester_notes=secret)
    assign(coord, b, "jordan-reyes", 1)
    assign(coord, b, "avery-chen", 2)
    lena = ORGS["riverbend"][0]
    for iid in ("jordan-reyes", "avery-chen"):
        got = mails(mail, subject(SUBJ_ASSIGNED, b), INTERPRETERS[iid][2], 1)
        assert got, f"{iid} confirmation"
        body = text(got[0])
        assert b["ref"] in body or b["ref"] in got[0].get("Subject", "")
        for forbidden in (secret, lena, "$", dollars(CONTRACTS["riverbend"][0])):
            assert forbidden not in body, f"interpreter copy leaked {forbidden!r}"
    got = mails(mail, subject(SUBJ_COVERED, b), lena, 1)
    assert got
    body = text(got[0])
    for iid in ("jordan-reyes", "avery-chen"):
        _, _, email, phone, home, _, pay = INTERPRETERS[iid]
        for forbidden in (email, phone, home, dollars(pay), f"{pay:,}"):
            assert forbidden not in body, f"requester copy leaked {forbidden!r}"


def covered_team(coord: Api, minutes: int = SOLO_THRESHOLD + 30, extra: list[str] | None = None, **over: Any) -> dict[str, Any]:
    b = free_booking(coord, "riverbend", "medical", minutes, ["jordan-reyes", "avery-chen"] + (extra or []), **over)
    assign(coord, b, "jordan-reyes", 1)
    assign(coord, b, "avery-chen", 2)
    return get_booking(coord, b)


def test_wf_withdraw_and_recover_refill(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = covered_team(coord, extra=["casey-morgan", "riley-brooks"])
    with signed_in(browser, app_url, COORD, path=board_path(b)) as page:
        board = page.get_by_role("region", name="Coverage board")
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail")
        before = txt(page.get_by_role("status", name="Coverage"))
        assert Api(app_url, INTERPRETERS["jordan-reyes"][2]).post(f"/api/bookings/{b['id']}/seats/1/release").status_code == 200
        advance(page, REFRESH_MS)
        wait_ui(page, lambda: "Partly covered" in txt(row(board, b["ref"])) or row(board, b["ref"]).get_attribute("data-coverage") == "partly_covered", "row to read Partly covered", step_ms=10)
        wait_ui(page, lambda: txt(page.get_by_role("status", name="Coverage")) != before, "lower coverage figure")
        assert any(e["kind"] == "gap" for e in entries(page))
        click(page.get_by_role("button", name="Assign seat 1"))
        dlg = page.get_by_role("dialog", name="Assign interpreter")
        wait_ui(page, lambda: dlg.get_by_role("radio").count() >= 2, "replacement choices")
        page.keyboard.press("ArrowDown")
        names = [v[0] for v in INTERPRETERS.values()]
        chosen = [n for n in names if dlg.get_by_role("radio", name=n, exact=True).count() and dlg.get_by_role("radio", name=n, exact=True).is_checked()]
        assert len(chosen) == 1, "arrow keys choose one radio"
        page.evaluate("() => { window.__assignFocus = document.activeElement; }")
        advance(page, REFRESH_MS)
        assert dlg.count() == 1 and dlg.get_by_role("radio", name=chosen[0], exact=True).is_checked()
        assert page.evaluate("() => window.__assignFocus === document.activeElement"), "refresh moved focus"
        click(dlg.get_by_role("button", name="Assign", exact=True))
        wait_ui(page, lambda: txt(action_status(page)) == f"{chosen[0]} holds seat 1 on {b['ref']}.", "refill success")
        wait_ui(page, lambda: row(board, b["ref"]).get_attribute("data-coverage") == "covered", "row back to Covered")
    final = get_booking(coord, b)
    assert final["status"] == "covered" and final["seats"][0]["holder"]["name"] == chosen[0]


def test_wf_withdraw_and_recover_phone(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = covered_team(coord)
    with signed_in(browser, app_url, INTERPRETERS["jordan-reyes"][2], size=PHONE) as page:
        mine = page.get_by_role("region", name="My assignments")
        wait_ui(page, lambda: row(mine, b["ref"]).count() == 1, "booking under My assignments")
        assert page.get_by_role("region", name="Assignment detail").count() == 0
        tap(row(mine, b["ref"]))
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail pane")
        assert page.get_by_role("region", name="My assignments").count() == 0 and page.get_by_role("region", name="Open calls").count() == 0
        assert page.get_by_role("button", name="Back to list").count() == 1
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        for name in tab_order(page, 20):
            assert not ROW_NAME_RE.match(name or "") and not (name or "").startswith("Claim seat on"), f"Tab reached the hidden list: {name}"
        layout(page)
        tap(page.get_by_role("region", name="Seats").get_by_role("button", name="Withdraw"))
        dlg = page.get_by_role("dialog", name="Withdraw from assignment")
        wait_ui(page, lambda: dlg.count() == 1, "Withdraw sheet")
        settle(dlg)
        box = dlg.bounding_box()
        assert [round(box[k]) for k in ("x", "y", "width", "height")] == [0, 0, PHONE[0], PHONE[1]], f"sheet must fill the screen: {box}"
        assert f"You will stop holding seat 1 on {b['ref']} and lose access to its prep materials." in txt(dlg)
        keep, confirm = dlg.get_by_role("button", name="Keep seat"), dlg.get_by_role("button", name="Confirm withdrawal")
        assert is_focused(keep)
        page.keyboard.press("Tab")
        assert is_focused(confirm)
        page.keyboard.press("Tab")
        assert is_focused(keep)
        page.keyboard.press("Shift+Tab")
        assert is_focused(confirm)
        tap(confirm)
        wait_ui(page, lambda: dlg.count() == 0 and page.get_by_role("region", name="Assignment detail").count() == 0, "list pane back")
        calls = page.get_by_role("region", name="Open calls")
        first_call = calls.get_by_role("button", name=ROW_NAME_RE)
        first_mine = page.get_by_role("region", name="My assignments").get_by_role("button", name=ROW_NAME_RE)
        target = first_call.first if first_call.count() else (first_mine.first if first_mine.count() else calls)
        wait_ui(page, lambda: is_focused(target), "focus on the first list row")
        layout(page)
    assert get_booking(coord, b)["seats"][0]["holder"] is None


def test_wf_withdraw_and_recover_release(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = covered_team(coord, minutes=SOLO_THRESHOLD * 2)
    native: list[str] = []
    with signed_in(browser, app_url, COORD, path=board_path(b), size=MEDIUM) as page:
        page.on("dialog", lambda d: (native.append(d.type), d.dismiss()))
        wait_ui(page, lambda: heading(page, b).count() == 1 and len(entries(page)) > 2, "covered team weave")
        departing = [e for e in weave(page).locator("[data-turn-index]").evaluate_all(
            "els => els.map(e => ({holder: e.dataset.holder, left: e.getBoundingClientRect().left}))") if e["holder"] == "JR"]
        opener = page.get_by_role("button", name="Release seat 1")
        click(opener)
        dlg = page.get_by_role("dialog", name="Release seat 1")
        wait_ui(page, lambda: dlg.count() == 1, "Release seat 1 dialog")
        settle(dlg)
        box = dlg.bounding_box()
        assert round(box["width"]) == DIALOG_WIDTH and abs(box["x"] + box["width"] / 2 - MEDIUM[0] / 2) <= SUBPIXEL
        assert f"Jordan Reyes will stop holding seat 1 on {b['ref']} and lose access to its prep materials." in txt(dlg)
        keep, confirm = dlg.get_by_role("button", name="Keep holder"), dlg.get_by_role("button", name="Confirm release")
        assert is_focused(keep)
        page.keyboard.press("Tab")
        assert is_focused(confirm)
        page.keyboard.press("Tab")
        assert is_focused(keep)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: dlg.count() == 0 and is_focused(opener), "Escape returns focus to Release seat 1")
        tap(opener)
        wait_ui(page, lambda: dlg.count() == 1, "dialog reopened by tap")
        page.evaluate(RECORDER_JS)
        tap(dlg.get_by_role("button", name="Confirm release"))
        records = collect(page)
        wait_ui(page, lambda: dlg.count() == 0 and is_focused(page.get_by_role("heading", name="Seats", level=3)), "focus on Seats heading")
        begins: dict[float, float] = {}
        for r in records:
            for d in departing:
                if r["what"] == "entry" and abs(r["left"] - d["left"]) <= SUBPIXEL:
                    begins[d["left"]] = min(begins.get(d["left"], r["t"]), r["t"])
        order = [begins[k] for k in sorted(begins, reverse=True)]
        assert len(order) >= 2, f"departing turns must animate their collapse; saw {records[:10]}"
        assert all(later - earlier >= COLLAPSE_GAP_MS for earlier, later in zip(order, order[1:])), f"collapse must run right to left ≥30 ms apart: {order}"
    assert native == [], "no native confirm, alert or prompt"
    c = covered_team(coord, minutes=SOLO_THRESHOLD * 2)
    final_text = None
    with signed_in(browser, app_url, COORD, path=board_path(c), reduced="reduce") as page:
        wait_ui(page, lambda: heading(page, c).count() == 1, "detail")
        cov = page.get_by_role("status", name="Coverage")
        before = txt(cov)
        click(page.get_by_role("button", name="Release seat 1"))
        click(page.get_by_role("dialog", name="Release seat 1").get_by_role("button", name="Confirm release"))
        end = time.monotonic() + UI_WAIT_S
        while time.monotonic() < end:
            now_text = txt(cov)
            if now_text != before:
                assert animations(weave(page)) == [] and animations(cov) == [], "reduced motion: no weave animation on the first changed frame"
                final_text = now_text
                break
        assert final_text == get_booking(coord, c)["rotation"]["coverage_text"], "coverage shows its final text at once"


def test_refresh_keeps_state(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = legal_pair(coord)
    with signed_in(browser, app_url, COORD, path=board_path(b)) as page:
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail")
        url = page.url
        click(page.get_by_role("button", name="Assign seat 1"))
        dlg = page.get_by_role("dialog", name="Assign interpreter")
        search = dlg.get_by_role("searchbox", name="Find interpreter")
        wait_ui(page, lambda: dlg.get_by_role("radio").count() >= 1, "choices")
        assign_status = dlg.get_by_role("status", name="Assign status")
        assert assign_status.count() == 1 and txt(assign_status) == ""
        fill(search, "a")
        advance(page, DEBOUNCE_MS)
        quinn = dlg.get_by_role("radio", name="Quinn Halvorsen")
        wait_ui(page, lambda: quinn.count() == 1, "Quinn listed")
        check(quinn)
        quinn.focus()
        regions = (txt(action_status(page)), txt(action_error(page)))
        advance(page, REFRESH_MS)
        advance(page, REFRESH_MS)
        assert dlg.count() == 1 and quinn.is_checked() and search.input_value() == "a" and is_focused(quinn)
        assert (txt(action_status(page)), txt(action_error(page))) == regions and page.url == url
        assign(coord, b, "sasha-lindqvist", 1)
        advance(page, REFRESH_MS)
        wait_ui(page, lambda: txt(assign_status) == "Seat 1 was just filled. Close this dialog to see the update.", "seat-filled notice", step_ms=10)
        assert dlg.count() == 1 and quinn.is_checked() and (txt(action_status(page)), txt(action_error(page))) == regions
        click(dlg.get_by_role("button", name="Assign", exact=True))
        wait_ui(page, lambda: txt(action_error(page)) == COPY_SEAT_FILLED, "seat_filled announced")
        click(dlg.get_by_role("button", name="Close"))
        click(page.get_by_role("region", name="Coverage board").get_by_role("button", name="New request"))
        nr = page.get_by_role("dialog", name="New request")
        wait_ui(page, lambda: nr.count() == 1, "New request")
        draft = uuid.uuid4().hex
        fill(nr.get_by_label("Title"), draft)
        advance(page, REFRESH_MS)
        assert nr.count() == 1 and nr.get_by_label("Title").input_value() == draft
    assert get_booking(coord, b)["seats"][0]["holder"]["id"] == "sasha-lindqvist"


def test_seat_release(app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["jordan-reyes", "avery-chen"])
    coord.post(f"/api/bookings/{b['id']}/open-call")
    assign(coord, b, "jordan-reyes", 1)
    assign(coord, b, "avery-chen", 2)
    lena = Api(app_url, ORGS["riverbend"][0])
    mid = lena.upload(b["id"], "brief.pdf", pdf_bytes()).json()["id"]
    jordan = Api(app_url, INTERPRETERS["jordan-reyes"][2])
    link = jordan.post(f"/api/bookings/{b['id']}/materials/{mid}/link").json()["url"]
    assert jordan.get(link).status_code == 200
    assert_error(lena.post(f"/api/bookings/{b['id']}/seats/1/release"), 403, "forbidden")
    assert_error(jordan.post(f"/api/bookings/{b['id']}/seats/2/release"), 403, "forbidden")
    r = jordan.post(f"/api/bookings/{b['id']}/seats/1/release")
    assert r.status_code == 200 and r.json()["seats"][0]["holder"] is None and r.json()["status"] == "partially_covered"
    assert_error(jordan.get(link), 403, "access_ended")
    assert any(x["ref"] == b["ref"] for x in jordan.get("/api/open-calls").json()["bookings"]), "released seat is offered again"
    assert assert_error(coord.post(f"/api/bookings/{b['id']}/seats/1/release"), 409, "invalid_transition")["status"] == "partially_covered"
    r = coord.post(f"/api/bookings/{b['id']}/seats/2/release")
    assert r.status_code == 200 and r.json()["status"] == "open"
    rel = [e for e in audit(coord, b) if e["action"] == "seat_released"]
    assert [(e["from_status"], e["to_status"], e["seat"], e["interpreter_name"]) for e in rel] == [
        ("covered", "partially_covered", 1, "Jordan Reyes"), ("partially_covered", "open", 2, "Avery Chen")]


def test_rotation_plan(app_url: str) -> None:
    coord = Api(app_url, COORD)
    day = "2027-03-14"
    for x in coord.get(f"/api/bookings?from={day}&to={day}").json()["bookings"]:
        if x["status"] in ("submitted", "open", "partially_covered", "covered") and any(s["holder"] for s in x["seats"]):
            cancel(coord, x)
    court = free_booking(coord, "harlan-court", "legal", MINIMUM_MINUTES, ["riley-brooks", "sasha-lindqvist"], start="2027-03-14T01:00")
    assign(coord, court, "riley-brooks", 1)
    rot = assign(coord, court, "sasha-lindqvist", 2)
    assert datetime.fromisoformat(rot["end"]) == datetime.fromisoformat("2027-03-14T04:00:00-05:00")
    turns = rot["rotation"]["turns"]
    assert len(turns) == 8 and rot["rotation"]["mode"] == "team"
    assert (hhmm(turns[3]["start"]), hhmm(turns[3]["end"]), hhmm(turns[4]["start"]), hhmm(turns[4]["end"])) == ("01:45", "03:00", "03:00", "03:15")
    assert not any(hhmm(t["start"]).startswith("02:") or hhmm(t["end"]).startswith("02:") for t in turns)
    assert rot["rotation"]["coverage_text"] == "Team · 8 turns · 100% covered"
    d_min = SOLO_THRESHOLD * 3 + 30
    interval = CONTRACTS["riverbend"][3]
    b = free_booking(coord, "riverbend", "medical", d_min, ["jordan-reyes", "avery-chen"])
    none = get_booking(coord, b)["rotation"]
    assert [(t["kind"], t["label"]) for t in none["turns"]] == [("gap", "uncovered")]
    assert none["coverage_text"] == f"Team · 0 of {d_min} min · 0% covered"
    one = assign(coord, b, "jordan-reyes", 1)
    t0, gap = one["rotation"]["turns"]
    s = datetime.fromisoformat(one["start"])
    assert t0["kind"] == "turn" and t0["holder_initials"] == "JR" and t0["label"] is None and t0["seat"] == 1
    assert datetime.fromisoformat(t0["end"]) == s + timedelta(minutes=SOLO_THRESHOLD)
    assert gap == {**gap, "kind": "gap", "label": "relief needed", "seat": None, "holder_name": None, "holder_initials": None}
    pct = SOLO_THRESHOLD * 100 // d_min
    assert one["rotation"]["coverage_text"] == f"Team · {SOLO_THRESHOLD} of {d_min} min · {pct}% covered"
    assert one["coverage"] == {"state": "partly_covered", "covered_minutes": SOLO_THRESHOLD, "percent": pct}
    full = assign(coord, b, "avery-chen", 2)["rotation"]["turns"]
    assert len(full) == -(-d_min // interval)
    for i, t in enumerate(full):
        assert t["index"] == i and datetime.fromisoformat(t["start"]) == s + timedelta(minutes=i * interval)
        assert datetime.fromisoformat(t["end"]) == min(s + timedelta(minutes=(i + 1) * interval), s + timedelta(minutes=d_min))
        assert t["holder_initials"] == ("JR" if i % 2 == 0 else "AC")
    solo = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["casey-morgan"])
    sr = assign(coord, solo, "casey-morgan", 1)["rotation"]
    assert sr["mode"] == "solo" and len(sr["turns"]) == 1 and sr["coverage_text"] == f"Solo · {SOLO_THRESHOLD} of {SOLO_THRESHOLD} min · 100% covered"


def test_weave_on_screen(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = covered_team(coord)
    p = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["casey-morgan"], day=local(b["start"]).date())
    assign(coord, p, "casey-morgan", 1)
    with signed_in(browser, app_url, COORD, path=board_path(b), tz=BROWSER_TZ) as page:
        for bk in (b, get_booking(coord, p)):
            click(row(page.get_by_role("region", name="Coverage board"), bk["ref"]))
            wait_ui(page, lambda: heading(page, bk).count() == 1, "detail")
            plan = get_booking(coord, bk)["rotation"]
            wait_ui(page, lambda: len(entries(page)) == len(plan["turns"]), "weave entries")
            assert weave(page).get_attribute("data-mode") == plan["mode"]
            drawn = sorted(entries(page), key=lambda e: int(e["turnIndex"]))
            n_turns = sum(1 for t in plan["turns"] if t["kind"] == "turn")
            expected_items, k = [], 0
            for e, t in zip(drawn, plan["turns"]):
                assert (int(e["turnIndex"]), e["kind"], e.get("holder", ""), e["start"], e["end"]) == (
                    t["index"], t["kind"], t["holder_initials"] or "", hhmm(t["start"]), hhmm(t["end"]))
                if t["kind"] == "turn":
                    k += 1
                    expected_items.append(f"Turn {k} of {n_turns}: {t['holder_name']}, {hhmm(t['start'])}–{hhmm(t['end'])}")
                else:
                    expected_items.append(f"Gap: {t['label']}, {hhmm(t['start'])}–{hhmm(t['end'])}")
            items = [s.strip() for s in page.get_by_role("list", name="Rotation plan").get_by_role("listitem").all_inner_texts()]
            assert items == expected_items
            assert txt(page.get_by_role("status", name="Coverage")).strip() == plan["coverage_text"]


def test_weave_motion(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["jordan-reyes", "avery-chen"])
    with signed_in(browser, app_url, COORD, path=board_path(b)) as page:
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail")
        page.evaluate(RECORDER_JS)
        click(page.get_by_role("button", name="Make team booking"))
        wait_ui(page, lambda: weave(page).get_attribute("data-mode") == "team", "team mode")
        recs = [r for r in collect(page) if r["what"] == "entry"]
        assert {r["index"] for r in recs} == {"0"}, f"Make team plays exactly one entry; saw {recs}"
        assign(coord, b, "jordan-reyes", 1)
        assign(coord, b, "avery-chen", 2)
        n = len(get_booking(coord, b)["rotation"]["turns"])
        page.evaluate(RECORDER_JS)
        advance(page, REFRESH_MS)
        wait_ui(page, lambda: len(entries(page)) == n, "alternating plan drawn", step_ms=10)
        recs = collect(page)
        groups: dict[str, tuple[float, float]] = {}
        for r in recs:
            if r["what"] == "entry":
                left, t = groups.get(r["index"], (r["left"], r["t"]))
                groups[r["index"]] = (left, min(t, r["t"]))
        starts = [t for _, t in sorted(groups.values())]
        assert len(starts) == n and all(a < c for a, c in zip(starts, starts[1:])), f"entries must enter left to right: {starts}"
        assert any(r["what"] == "status" for r in recs), "the coverage figure counts with an animation"
        page.evaluate(RECORDER_JS)
        advance(page, REFRESH_MS)
        advance(page, REFRESH_MS)
        assert collect(page) == [], "an unchanged plan replays no motion"
        r = row(page.get_by_role("region", name="Coverage board"), b["ref"])
        rest, hover = state_styles(r, "border-bottom-width", "border-bottom-color", "box-shadow", state="hover")
        assert rest != hover, "row rule thickens on hover"
        btn = page.get_by_role("button", name="Previous day")
        rest, hover = state_styles(btn, "background-color", "color", "filter", "box-shadow", state="hover")
        assert rest != hover, "buttons darken on hover"


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["jordan-reyes", "avery-chen"])
    with signed_in(browser, app_url, COORD, path=board_path(b), reduced="reduce") as page:
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail")
        cov = page.get_by_role("status", name="Coverage")
        click(page.get_by_role("button", name="Make team booking"))
        wait_ui(page, lambda: weave(page).get_attribute("data-mode") == "team", "team mode", step_ms=5)
        assert animations(weave(page)) == [] and txt(cov).strip() == f"Team · 0 of {SOLO_THRESHOLD} min · 0% covered"
        assign(coord, b, "jordan-reyes", 1)
        final = assign(coord, b, "avery-chen", 2)["rotation"]
        advance(page, REFRESH_MS)
        wait_ui(page, lambda: len(entries(page)) == len(final["turns"]), "final plan", step_ms=5)
        assert animations(weave(page)) == [] and animations(cov) == []
        assert txt(cov).strip() == final["coverage_text"]
        assert page.get_by_role("list", name="Rotation plan").get_by_role("listitem").count() == len(final["turns"])


def test_wf_prep_materials_download(browser: Browser, app_url: str, tmp_path: Path) -> None:
    coord = Api(app_url, COORD)
    b = legal_pair(coord)
    assign(coord, b, "riley-brooks", 1)
    name = "Danh sách 🦻.pdf"
    data = pdf_bytes(40_000)
    with signed_in(browser, app_url, ORGS["harlan-court"][0], path=f"/bookings/{b['id']}") as page:
        prep = page.get_by_role("region", name="Prep materials")
        wait_ui(page, lambda: prep.count() == 1, "Prep materials")
        prep.get_by_label("Attach prep material").set_input_files({"name": name, "mimeType": "application/pdf", "buffer": data})
        click(prep.get_by_role("button", name="Upload"))
        wait_ui(page, lambda: txt(action_status(page)) == f"{name} attached.", "upload success copy")
        assert name in txt(prep)
    mats = get_booking(coord, b)["materials"]
    assert len(mats) == 1 and mats[0]["sha256"] == hashlib.sha256(data).hexdigest()
    keys = S3().keys(f"prep/{b['id']}/")
    assert len(keys) == 1 and S3().get(keys[0]) == data
    with signed_in(browser, app_url, INTERPRETERS["riley-brooks"][2], path=f"/bookings/{b['id']}") as page:
        btn = page.get_by_role("region", name="Prep materials").get_by_role("button", name=f"Download {name}")
        wait_ui(page, lambda: btn.count() == 1, "Download button")
        with page.expect_download() as info:
            click(btn)
        dl = info.value
        assert dl.suggested_filename == name
        target = tmp_path / "dl.bin"
        dl.save_as(str(target))
        assert target.read_bytes() == data


def test_upload_checks(app_url: str) -> None:
    coord = Api(app_url, COORD)
    ruth = Api(app_url, ORGS["harlan-court"][0])
    sam = Api(app_url, ORGS["maple-valley"][0])
    b = create(coord, booking_body("harlan-court", "legal", SOLO_THRESHOLD, slot_start(pool_day(agency(coord)))))
    good = [
        ("agenda.pdf", pdf_bytes(), "application/pdf"),
        ("photo.pdf", b"\x89PNG\r\n\x1a\n" + os.urandom(500), "image/png"),
        ("scan.png", b"\xff\xd8\xff\xe0" + os.urandom(500), "image/jpeg"),
        ("slides.pdf", zip_bytes([("word/document.xml", b"<w/>"), ("[Content_Types].xml", os.urandom(20))]), ACCEPTED_TYPES[3]),
        ("deck.docx", zip_bytes([("ppt/presentation.xml", b"<p/>"), ("[Content_Types].xml", os.urandom(20))]), ACCEPTED_TYPES[4]),
        ("big.pdf", pdf_bytes(UPLOAD_LIMIT), "application/pdf"),
    ]
    for name, data, ctype in good:
        r = ruth.upload(b["id"], name, data, "application/pdf")
        assert r.status_code == 201, f"{name} answered {r.status_code} {r.text[:200]}"
        m = r.json()
        assert m["content_type"] == ctype and m["size_bytes"] == len(data) and m["sha256"] == hashlib.sha256(data).hexdigest()
    bad = [
        ("logo.png", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        ("page.pdf", b"<!doctype html><html><script>alert(1)</script></html>"),
        ("x.docx", zip_bytes([("word/document.xml", b"<w/>"), ("word/../../evil.xml", b"x")])),
        ("y.docx", zip_bytes([("readme.txt", b"x")])),
        ("z.pdf", b"MZ" + os.urandom(200)),
    ]
    for name, data in bad:
        assert_error(ruth.upload(b["id"], name, data, "application/pdf"), 415, "unsupported_type")
    body = assert_error(ruth.upload(b["id"], "empty.pdf", b"", "application/pdf"), 422, "validation")
    assert str(body["fields"]["file"]).startswith(FILE_REQUIRED)
    assert_error(ruth.upload(b["id"], "huge.pdf", pdf_bytes(UPLOAD_LIMIT + 1), "application/pdf"), 413, "payload_too_large")
    assert_error(sam.upload(b["id"], "a.pdf", pdf_bytes()), 404, "not_found")
    keys = S3().keys(f"prep/{b['id']}/")
    assert len(keys) == len(good), "refused uploads leave no object"
    for k in keys:
        assert re.fullmatch(rf"prep/{re.escape(str(b['id']))}/[0-9a-f]{{32}}", k), f"unexpected key {k}"
    ag = agency(ruth)
    assert ag["upload_limit_bytes"] == UPLOAD_LIMIT and ag["max_files_per_booking"] == MAX_FILES and ag["accepted_types"] == ACCEPTED_TYPES
    c = create(coord, booking_body("harlan-court", "legal", SOLO_THRESHOLD, slot_start(pool_day(ag))))
    cancel(coord, c)
    assert_error(ruth.upload(c["id"], "late.pdf", pdf_bytes()), 409, "invalid_transition")


@pytest.mark.timeout(1200)
def test_prep_access(app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD * 2, ["jordan-reyes", "avery-chen"])
    assign(coord, b, "jordan-reyes", 1)
    assign(coord, b, "avery-chen", 2)
    lena = Api(app_url, ORGS["riverbend"][0])
    data = pdf_bytes()
    mid = lena.upload(b["id"], "a.pdf", data).json()["id"]
    jordan = Api(app_url, INTERPRETERS["jordan-reyes"][2])
    r = jordan.post(f"/api/bookings/{b['id']}/materials/{mid}/link")
    assert r.status_code == 201 and r.json()["url"].startswith("/api/prep/") and r.json()["expires_at"]
    url = r.json()["url"]
    assert jordan.get(url).content == data
    assert_error(Api(app_url, INTERPRETERS["avery-chen"][2]).get(url), 404, "not_found")
    assert_error(lena.post(f"/api/bookings/{b['id']}/materials/{mid}/link"), 403, "forbidden")
    assert_error(coord.post(f"/api/bookings/{b['id']}/materials/{mid}/link"), 403, "forbidden")
    cancel(coord, b)
    assert_error(jordan.get(url), 403, "access_ended")
    assert_error(jordan.post(f"/api/bookings/{b['id']}/materials/{mid}/link"), 403, "access_ended")
    short = os.environ["APP_SHORT_URL"]
    sc = Api(short, COORD)
    sag = agency(sc)
    start = (local(sag["now"]) + timedelta(minutes=MIN_START_LEAD * 2)).strftime("%Y-%m-%dT%H:%M")
    s = free_booking(sc, "harlan-court", "legal", SOLO_THRESHOLD, ["riley-brooks", "quinn-halvorsen"], start=start)
    assign(sc, s, "riley-brooks", 1)
    assign(sc, s, "quinn-halvorsen", 2)
    smid = Api(short, ORGS["harlan-court"][0]).upload(s["id"], "w.pdf", data).json()["id"]
    riley = Api(short, INTERPRETERS["riley-brooks"][2])
    old = riley.post(f"/api/bookings/{s['id']}/materials/{smid}/link").json()["url"]
    assert riley.get(old).status_code == 200
    end = time.monotonic() + sag["prep_link_ttl_seconds"] * 4 + 10
    while time.monotonic() < end and riley.get(old).status_code == 200:
        pass
    assert_error(riley.get(old), 410, "link_expired")
    complete(sc, s, SOLO_THRESHOLD, 0)
    fresh = riley.post(f"/api/bookings/{s['id']}/materials/{smid}/link")
    assert fresh.status_code == 201 and riley.get(fresh.json()["url"]).content == data, "access lasts through the grace period"
    end = time.monotonic() + sag["prep_access_grace_minutes"] * 60 * 2 + 30
    while time.monotonic() < end and riley.post(f"/api/bookings/{s['id']}/materials/{smid}/link").status_code == 201:
        pass
    assert_error(riley.post(f"/api/bookings/{s['id']}/materials/{smid}/link"), 403, "access_ended")
    assert_error(riley.get(old), 403, "access_ended")


def test_concurrent_uploads(app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = legal_pair(coord)
    assign(coord, b, "riley-brooks", 1)
    ruth = Api(app_url, ORGS["harlan-court"][0])
    for i in range(MAX_FILES - 1):
        assert ruth.upload(b["id"], f"part {i}.pdf", pdf_bytes()).status_code == 201
    names = ["Danh sách nhân chứng.pdf", "Témoins v2.pdf", "Witnesses 🦻.pdf"]
    racers = [Api(app_url, ORGS["harlan-court"][0]) for _ in names]
    results = together([lambda a=a, n=n: a.upload(b["id"], n, pdf_bytes()) for a, n in zip(racers, names)])
    assert sorted(r.status_code for r in results) == [201, 422, 422]
    for r in results:
        if r.status_code == 422:
            assert_field(r, "file", FILE_FULL)
    mats = get_booking(coord, b)["materials"]
    keys = S3().keys(f"prep/{b['id']}/")
    assert len(mats) == MAX_FILES == len(keys)
    assert sorted(hashlib.sha256(S3().get(k)).hexdigest() for k in keys) == sorted(m["sha256"] for m in mats)
    down = os.environ["APP_MINIO_DOWN_URL"]
    rd = Api(down, ORGS["harlan-court"][0])
    assert_field(rd.upload(b["id"], "eleventh.pdf", pdf_bytes()), "file", FILE_FULL)
    assert_error(rd.upload(b["id"], "x.svg", b"<svg/>"), 415, "unsupported_type")
    riley = Api(down, INTERPRETERS["riley-brooks"][2])
    assert len(get_booking(riley, b)["materials"]) == MAX_FILES
    link = riley.post(f"/api/bookings/{b['id']}/materials/{mats[0]['id']}/link")
    assert link.status_code == 201
    assert_error(riley.get(link.json()["url"]), 503, "storage_unavailable")
    assert Api(down, COORD).post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "quinn-halvorsen", "seat": 2}).status_code == 200


def test_wf_prep_materials_storage_outage(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = create(coord, booking_body("harlan-court", "legal", SOLO_THRESHOLD, slot_start(pool_day(agency(coord)))))
    Api(app_url, ORGS["harlan-court"][0]).upload(b["id"], "first.pdf", pdf_bytes())
    with signed_in(browser, os.environ["APP_MINIO_DOWN_URL"], ORGS["harlan-court"][0], path=f"/bookings/{b['id']}") as page:
        prep = page.get_by_role("region", name="Prep materials")
        wait_ui(page, lambda: prep.count() == 1, "Prep materials")
        second = f"{uuid.uuid4().hex}.pdf"
        prep.get_by_label("Attach prep material").set_input_files({"name": second, "mimeType": "application/pdf", "buffer": pdf_bytes()})
        click(prep.get_by_role("button", name="Upload"))
        wait_ui(page, lambda: txt(action_error(page)) == COPY_STORAGE_UPLOAD, "storage outage copy")
        assert second not in txt(prep)
    assert [m["name"] for m in get_booking(coord, b)["materials"]] == ["first.pdf"]
    assert len(S3().keys(f"prep/{b['id']}/")) == 1


def test_stored_as_submitted(app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = legal_pair(coord)
    assign(coord, b, "riley-brooks", 1)
    ruth = Api(app_url, ORGS["harlan-court"][0])
    riley = Api(app_url, INTERPRETERS["riley-brooks"][2])
    cases = [
        ("Danh sách 🦻.pdf", "Danh sách 🦻.pdf"),
        ("Danh sa\u0301ch.pdf", "Danh sa\u0301ch.pdf"),
        ("court/exhibits/list v2.pdf", "list v2.pdf"),
        ("wit\x01ness.pdf", "witness.pdf"),
        ("é" * (DISPLAY_NAME_MAX + 5), "é" * DISPLAY_NAME_MAX),
        ("\x01", "file"),
    ]
    keep = set("!#$&+-.^_`|~")
    for raw, expected in cases:
        data = pdf_bytes()
        m = ruth.upload(b["id"], raw, data)
        assert m.status_code == 201, f"{raw!r} answered {m.status_code}"
        mat = m.json()
        assert mat["name"] == expected and mat["sha256"] == hashlib.sha256(data).hexdigest()
        link = riley.post(f"/api/bookings/{b['id']}/materials/{mat['id']}/link").json()["url"]
        r = riley.get(link)
        assert r.status_code == 200 and r.content == data
        assert r.headers["content-type"].startswith("application/pdf") and r.headers["content-length"] == str(len(data))
        assert r.headers["x-content-type-options"] == "nosniff"
        fallback = "".join("_" if not (" " <= c <= "~") or c in '"\\' else c for c in expected)
        encoded = "".join(chr(x) if chr(x).isascii() and (chr(x).isalnum() or chr(x) in keep) else f"%{x:02X}" for x in expected.encode("utf-8"))
        cd = r.headers["content-disposition"]
        assert cd.startswith("attachment") and f'filename="{fallback}"' in cd and f"filename*=UTF-8''{encoded}" in cd, cd
    first = riley.get(riley.post(f"/api/bookings/{b['id']}/materials/{get_booking(coord, b)['materials'][0]['id']}/link").json()["url"])
    assert 'filename="Danh s_ch _.pdf"' in first.headers["content-disposition"]
    assert "filename*=UTF-8''Danh%20s%C3%A1ch%20%F0%9F%A6%BB.pdf" in first.headers["content-disposition"]
    shas = sorted(m["sha256"] for m in get_booking(coord, b)["materials"])
    assert sorted(hashlib.sha256(S3().get(k)).hexdigest() for k in S3().keys(f"prep/{b['id']}/")) == shas


@pytest.mark.timeout(1200)
def test_abandoned_transfers(app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = legal_pair(coord)
    assign(coord, b, "riley-brooks", 1)
    ruth = Api(app_url, ORGS["harlan-court"][0])
    data = pdf_bytes(UPLOAD_LIMIT)
    mid = ruth.upload(b["id"], "deck.pdf", data).json()["id"]
    riley = Api(app_url, INTERPRETERS["riley-brooks"][2])
    url = riley.post(f"/api/bookings/{b['id']}/materials/{mid}/link").json()["url"]
    for _ in range(ABANDONED_DOWNLOADS):
        with riley.client.stream("GET", url) as r:
            assert r.status_code == 200
            next(r.iter_raw())
    pg = Postgres()
    end = time.monotonic() + 30
    while time.monotonic() < end:
        n = pg.rows("select count(*) as n from pg_stat_activity where datname = current_database() and usename <> current_user and state in ('active', 'idle in transaction')")[0]["n"]
        if n == 0:
            break
    else:
        pytest.fail("an app database session stayed active or idle in transaction after abandoned downloads")
    t0 = time.monotonic()
    full = riley.get(url)
    assert full.content == data and time.monotonic() - t0 < FULL_DOWNLOAD_S
    t0 = time.monotonic()
    assert riley.get("/api/agency").status_code == 200 and time.monotonic() - t0 < API_CALL_S
    u = urlparse(ruth.base)
    for _ in range(3):
        head, boundary = multipart("cut.pdf", b"", "application/pdf")
        preamble = head[: -len(f"\r\n--{boundary}--\r\n")]
        total = len(preamble) + UPLOAD_LIMIT + len(f"\r\n--{boundary}--\r\n")
        req = (f"POST /api/bookings/{b['id']}/materials HTTP/1.1\r\nHost: {u.netloc}\r\nCookie: {ruth.cookie_header()}\r\n"
               f"Content-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {total}\r\n\r\n").encode() + preamble + pdf_bytes(UPLOAD_LIMIT // 2)
        with socket.create_connection((u.hostname, u.port or 80), timeout=HTTP_TIMEOUT_S) as s:
            s.sendall(req)
            s.shutdown(socket.SHUT_RDWR)
    end = time.monotonic() + 15
    while time.monotonic() < end and len(S3().keys(f"prep/{b['id']}/")) != 1:
        pass
    assert len(get_booking(coord, b)["materials"]) == 1 and len(S3().keys(f"prep/{b['id']}/")) == 1
    for i in range(MAX_FILES - 1):
        assert ruth.upload(b["id"], f"more {i}.pdf", pdf_bytes()).status_code == 201, "cut-off uploads used a file slot"


def tomorrow_booking(coord: Api, org: str, setting: str, minutes: int, need: list[str]) -> dict[str, Any]:
    return free_booking(coord, org, setting, minutes, need, day=today_of(agency(coord)) + timedelta(days=1))


def cutoff_text(iso: str) -> str:
    c = local(iso)
    return f"{WEEKDAYS[c.weekday()]} {c.date()} {c.strftime('%H:%M')}"


def test_wf_requester_cancel_keyboard(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = tomorrow_booking(coord, "maple-valley", "educational", SOLO_THRESHOLD + 30, ["riley-brooks", "quinn-halvorsen"])
    assign(coord, b, "riley-brooks", 1)
    rate, bp, mrate, _ = CONTRACTS["maple-valley"]
    one = line_math(rate, bp, mrate, b["duration_minutes"], 1, 0)[2]
    two = line_math(rate, bp, mrate, b["duration_minutes"], 2, 0)[2]
    with signed_in(browser, app_url, ORGS["maple-valley"][0], path=f"/bookings/{b['id']}", tz=BROWSER_TZ) as page:
        opener = page.get_by_role("button", name="Cancel booking")
        wait_ui(page, lambda: opener.count() == 1, "Cancel booking")
        opener.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Cancel booking")
        wait_ui(page, lambda: dlg.count() == 1 and is_focused(dlg.get_by_role("button", name="Keep booking")), "focus on Keep booking")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: dlg.count() == 0 and is_focused(opener), "Escape returns to Cancel booking")
        page.keyboard.press("Enter")
        q = dlg.get_by_role("status", name="Cancellation quote")
        confirm = dlg.get_by_role("button", name="Confirm cancellation")
        wait_ui(page, lambda: confirm.count() == 1 and confirm.is_enabled(), "quote arrives")
        assert f"Charge: {dollars(one)}." in txt(q)
        keep = dlg.get_by_role("button", name="Keep booking")
        assert is_focused(keep)
        page.keyboard.press("Tab")
        assert is_focused(confirm)
        page.keyboard.press("Tab")
        assert is_focused(q)
        page.keyboard.press("Shift+Tab")
        assert is_focused(confirm)
        assign(coord, b, "quinn-halvorsen", 2)
        page.keyboard.press("Enter")
        wait_ui(page, lambda: txt(action_error(page)) == COPY_QUOTE_CHANGED, "quote_changed copy")
        newc = dlg.get_by_role("button", name="Confirm new charge")
        wait_ui(page, lambda: newc.count() == 1 and is_focused(q), "focus on the new quote")
        assert f"Charge: {dollars(two)}." in txt(q)
        assert get_booking(coord, b)["status"] == "covered"
        page.keyboard.press("Tab")
        page.keyboard.press("Tab")
        assert is_focused(newc)
        page.keyboard.press("Enter")
        wait_ui(page, lambda: txt(action_status(page)) == f"{b['ref']} cancelled. Late charge {dollars(two)} recorded.", "late success copy")
        wait_ui(page, lambda: dlg.count() == 0 and is_focused(heading(page, b)), "focus on the detail heading")
    final = get_booking(coord, b)
    assert final["status"] == "cancelled_late" and final["charge"]["amount_cents"] == two


def test_wf_requester_cancel_reopen(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = tomorrow_booking(coord, "maple-valley", "educational", SOLO_THRESHOLD + 30, ["riley-brooks", "quinn-halvorsen"])
    assign(coord, b, "riley-brooks", 1)
    rate, bp, mrate, _ = CONTRACTS["maple-valley"]
    one = line_math(rate, bp, mrate, b["duration_minutes"], 1, 0)[2]
    two = line_math(rate, bp, mrate, b["duration_minutes"], 2, 0)[2]
    stale: list[tuple[Any, Any]] = []

    def hold_first(route: Any) -> None:
        if not stale:
            stale.append((route, route.fetch()))
            return
        route.continue_()
    with signed_in(browser, app_url, ORGS["maple-valley"][0], path=f"/bookings/{b['id']}") as page:
        page.route("**/cancellation-quote", hold_first)
        opener = page.get_by_role("button", name="Cancel booking")
        wait_ui(page, lambda: opener.count() == 1, "Cancel booking")
        click(opener)
        dlg = page.get_by_role("dialog", name="Cancel booking")
        wait_ui(page, lambda: len(stale) == 1 and dlg.get_by_role("button", name=COPY_QUOTE_PENDING).count() == 1, "pending quote")
        assert dlg.get_by_role("button", name=COPY_QUOTE_PENDING).is_disabled()
        page.keyboard.press("Escape")
        assign(coord, b, "quinn-halvorsen", 2)
        click(opener)
        confirm = dlg.get_by_role("button", name="Confirm cancellation")
        wait_ui(page, lambda: confirm.count() == 1 and confirm.is_enabled(), "fresh quote")
        route, resp = stale[0]
        route.fulfill(response=resp)
        for _ in range(20):
            advance(page, 100)
        settle(dlg)
        assert dlg.count() == 1 and dlg.evaluate("d => getComputedStyle(d).opacity") == "1", "the old fade hid the reopened dialog"
        q = dlg.get_by_role("status", name="Cancellation quote")
        assert f"Charge: {dollars(two)}." in txt(q) and dollars(one) not in txt(q)
        assert is_focused(dlg.get_by_role("button", name="Keep booking"))
        advance(page, REFRESH_MS)
        assert f"Charge: {dollars(two)}." in txt(q) and confirm.count() == 1 and is_focused(dlg.get_by_role("button", name="Keep booking"))
        click(confirm)
        wait_ui(page, lambda: txt(action_status(page)) == f"{b['ref']} cancelled. Late charge {dollars(two)} recorded.", "confirmed without quote_changed")
    assert get_booking(coord, b)["charge"]["amount_cents"] == two


def test_wf_requester_cancel_layout(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = create(coord, booking_body("maple-valley", "educational", SOLO_THRESHOLD, slot_start(near_day(agency(coord)))))
    sizes = [(PHONE[0], PHONE[1]), (COMPACT_MAX, PHONE[1]), (MEDIUM_MIN, MEDIUM[1]), (MEDIUM_MAX, MEDIUM[1]), (WIDE_MIN, WIDE[1]), WIDE]
    with signed_in(browser, app_url, ORGS["maple-valley"][0]) as page:
        for w, h in sizes:
            page.set_viewport_size({"width": w, "height": h})
            page.goto(app_url.rstrip("/") + "/")
            lst = page.get_by_role("region", name="Bookings")
            wait_ui(page, lambda: row(lst, b["ref"]).count() == 1, f"list at {w}px")
            click(row(lst, b["ref"]))
            detail = page.get_by_role("region", name="Assignment detail")
            wait_ui(page, lambda: heading(page, b).count() == 1, f"detail at {w}px")
            layout(page)
            if w <= COMPACT_MAX:
                assert page.get_by_role("region", name="Bookings").count() == 0 and page.get_by_role("button", name="Back to list").count() == 1
            else:
                lb, db = lst.bounding_box(), detail.bounding_box()
                if w <= MEDIUM_MAX:
                    assert abs(lb["width"] - w) <= w / GRID_COLUMNS and db["y"] >= lb["y"] + lb["height"] - SUBPIXEL
                else:
                    assert lb["x"] < db["x"] and abs(lb["width"] / (lb["width"] + db["width"]) - LIST_COLUMNS / GRID_COLUMNS) < 1 / GRID_COLUMNS
            click(page.get_by_role("button", name="Cancel booking"))
            dlg = page.get_by_role("dialog", name="Cancel booking")
            wait_ui(page, lambda: dlg.count() == 1, "dialog")
            settle(dlg)
            box = dlg.bounding_box()
            if w <= COMPACT_MAX:
                assert [round(box[k]) for k in ("x", "y", "width", "height")] == [0, 0, w, h], f"{w}px dialog {box}"
            else:
                assert round(box["width"]) == DIALOG_WIDTH and abs(box["x"] + box["width"] / 2 - w / 2) <= SUBPIXEL, f"{w}px dialog {box}"
            page.keyboard.press("Escape")
            wait_ui(page, lambda: dlg.count() == 0, "dialog closed")
    assert get_booking(coord, b)["status"] == "submitted"


def test_wf_requester_cancel_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    coord = Api(app_url, COORD)
    b = create(coord, booking_body("maple-valley", "educational", SOLO_THRESHOLD, slot_start(pool_day(agency(coord)))))
    q = quote(coord, b)
    with signed_in(browser, app_url, ORGS["maple-valley"][0], path=f"/bookings/{b['id']}", tz=BROWSER_TZ) as page:
        click(page.get_by_role("button", name="Cancel booking"))
        dlg = page.get_by_role("dialog", name="Cancel booking")
        confirm = dlg.get_by_role("button", name="Confirm cancellation")
        wait_ui(page, lambda: confirm.count() == 1 and confirm.is_enabled(), "quote")
        expected = f"Cancelling now is on time. No charge. Free cancellation ended or ends {cutoff_text(q['cutoff'])}."
        assert expected in txt(dlg.get_by_role("status", name="Cancellation quote"))
        click(confirm)
        wait_ui(page, lambda: txt(action_status(page)) == f"{b['ref']} cancelled.", "cancel success")
        wait_ui(page, lambda: STATUS_LABELS["cancelled"] in txt(page.get_by_role("region", name="Assignment detail")), "Cancelled label")
        assert page.get_by_role("button", name="Cancel booking").count() == 0
    assert get_booking(coord, b)["status"] == "cancelled"
    got = mails(mail, subject(SUBJ_CANCELLED, b), ORGS["maple-valley"][0], 1)
    assert len(got) == 1 and "No cancellation charge." in text(got[0])


def test_late_window(app_url: str) -> None:
    coord = Api(app_url, COORD)
    keys = {"late", "cutoff", "interpreter_count", "billable_minutes", "charge_cents"}
    for start, cutoff in (("2027-11-08T09:00", "2027-11-04T09:00:00-05:00"), ("2027-03-15T09:00", "2027-03-11T09:00:00-06:00")):
        q = quote(coord, create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, start)))
        assert set(q) == keys and datetime.fromisoformat(q["cutoff"]) == datetime.fromisoformat(cutoff)
        assert datetime.fromisoformat(q["cutoff"]).utcoffset() == datetime.fromisoformat(cutoff).utcoffset() and q["late"] is False
    ag = agency(coord)
    d = pool_day(ag)
    sat = d + timedelta(days=(5 - d.weekday()) % 7)
    mon = d + timedelta(days=(0 - d.weekday()) % 7)
    for day in (sat, mon):
        q = quote(coord, create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{day}T09:00")))
        c = local(q["cutoff"])
        assert c.weekday() == 3 and c.strftime("%H:%M") == "09:00" and (day - c.date()).days in (2, 4), f"{day} cutoff {c}"
    t = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{today_of(ag) + timedelta(days=1)}T09:00"))
    q = quote(coord, t)
    assert q["late"] is True and q["interpreter_count"] == 0 and q["charge_cents"] == 0


def test_quoted_cancellation(app_url: str) -> None:
    coord = Api(app_url, COORD)
    lena = Api(app_url, ORGS["riverbend"][0])
    far = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD, slot_start(pool_day(agency(lena)))))
    assert_field(lena.post(f"/api/bookings/{far['id']}/cancel", {}), "quoted_charge_cents", FIELD["quoted_charge_cents"])
    assert_field(lena.post(f"/api/bookings/{far['id']}/cancel", {"quoted_charge_cents": -1}), "quoted_charge_cents", FIELD["quoted_charge_cents"])
    done = cancel(lena, far)
    assert done["status"] == "cancelled" and done["charge"] is None
    assert assert_error(lena.post(f"/api/bookings/{far['id']}/cancel", {"quoted_charge_cents": 0}), 409, "invalid_transition")["status"] == "cancelled"
    assert_error(lena.get(f"/api/bookings/{far['id']}/cancellation-quote"), 409, "invalid_transition")
    noseat = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{today_of(agency(lena)) + timedelta(days=1)}T16:45"))
    assert cancel(lena, noseat)["status"] == "cancelled"
    b = tomorrow_booking(coord, "riverbend", "medical", SOLO_THRESHOLD + 30, ["jordan-reyes", "avery-chen"])
    assign(coord, b, "jordan-reyes", 1)
    rate, bp, mrate, _ = CONTRACTS["riverbend"]
    q1 = quote(lena, b)
    assert q1["late"] is True and q1["interpreter_count"] == 1 and q1["billable_minutes"] == MINIMUM_MINUTES
    assert q1["charge_cents"] == line_math(rate, bp, mrate, b["duration_minutes"], 1, 0)[2]
    assign(coord, b, "avery-chen", 2)
    body = assert_error(lena.post(f"/api/bookings/{b['id']}/cancel", {"quoted_charge_cents": q1["charge_cents"]}), 409, "quote_changed")
    assert body["quote"]["charge_cents"] == EXAMPLE_LATE_LINE and body["quote"]["interpreter_count"] == 2
    assert get_booking(lena, b)["status"] == "covered" and get_booking(lena, b)["charge"] is None
    r = lena.post(f"/api/bookings/{b['id']}/cancel", {"quoted_charge_cents": EXAMPLE_LATE_LINE})
    assert r.status_code == 200 and r.json()["status"] == "cancelled_late"
    ch = r.json()["charge"]
    assert ch["kind"] == "late_cancellation" and ch["amount_cents"] == EXAMPLE_LATE_LINE and LINE_RE.match(ch["line_ref"])


def test_cancellation_notices(app_url: str, mail: Mailpit) -> None:
    coord = Api(app_url, COORD)
    b = tomorrow_booking(coord, "riverbend", "medical", SOLO_THRESHOLD + 30, ["jordan-reyes", "avery-chen"])
    assign(coord, b, "jordan-reyes", 1)
    assign(coord, b, "avery-chen", 2)
    cancel(coord, b)
    coord.post(f"/api/bookings/{b['id']}/cancel", {"quoted_charge_cents": 0})
    req = mails(mail, subject(SUBJ_CANCELLED, b), ORGS["riverbend"][0], 1)
    assert len(req) == 1 and f"Late cancellation charge: {dollars(EXAMPLE_LATE_LINE)}" in text(req[0])
    for iid in ("jordan-reyes", "avery-chen"):
        got = mails(mail, subject(SUBJ_CANCELLED, b), INTERPRETERS[iid][2], 1)
        assert len(got) == 1 and "This was a late cancellation." in text(got[0]) and "$" not in text(got[0])
    c = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["casey-morgan"])
    assign(coord, c, "casey-morgan", 1)
    cancel(coord, c)
    got = mails(mail, subject(SUBJ_CANCELLED, c), ORGS["riverbend"][0], 1)
    assert len(got) == 1 and "No cancellation charge." in text(got[0])
    assert len(mails(mail, subject(SUBJ_CANCELLED, c), INTERPRETERS["casey-morgan"][2], 1)) == 1


def test_wf_complete_and_bill_happy(browser: Browser, app_url: str, killbill: KillBill) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["casey-morgan"])
    assign(coord, b, "casey-morgan", 1)
    miles = 12
    rate, bp, mrate, _ = CONTRACTS["riverbend"]
    amount = line_math(rate, bp, mrate, SOLO_THRESHOLD, 1, miles)[2]
    with signed_in(browser, app_url, COORD, path=board_path(b)) as page:
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail")
        click(page.get_by_role("button", name="Check in"))
        wait_ui(page, lambda: txt(action_status(page)) == f"{b['ref']} is in progress.", "check-in copy")
        click(page.get_by_role("button", name="Mark complete"))
        dlg = page.get_by_role("dialog", name="Complete assignment")
        wait_ui(page, lambda: dlg.count() == 1, "Complete assignment")
        assert dlg.get_by_label("Worked minutes").input_value() == str(SOLO_THRESHOLD) and dlg.get_by_label("Mileage (miles)").input_value() == "0"
        fill(dlg.get_by_label("Mileage (miles)"), str(miles))
        click(dlg.get_by_role("button", name="Record completion"))
        wait_ui(page, lambda: re.fullmatch(rf"{re.escape(b['ref'])} completed\. Invoice line (LN-\d+) recorded\.", txt(action_status(page))) is not None, "completion copy")
        line_ref = re.search(r"(LN-\d+)", txt(action_status(page))).group(1)
        billing = page.get_by_role("region", name="Billing")
        wait_ui(page, lambda: line_ref in txt(billing) and dollars(amount) in txt(billing), "line and amount in Billing")
        end = time.monotonic() + SYNC_DEADLINE_S
        while time.monotonic() < end and "Synced" not in txt(billing):
            advance(page, REFRESH_MS)
        assert "Synced" in txt(billing), "Billing panel never showed Synced"
    charges = kb_charges(killbill, "riverbend", line_ref)
    assert len(charges) == 1 and cents_of(charges[0]["amount"]) == amount


def test_wf_complete_and_bill_lost_response(browser: Browser, app_url: str, killbill: KillBill) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["casey-morgan"])
    assign(coord, b, "casey-morgan", 1)
    coord.post(f"/api/bookings/{b['id']}/check-in")
    first: list[dict[str, Any]] = []
    posts: list[Any] = []

    def lose(route: Any) -> None:
        if not first:
            resp = route.fetch()
            first.append(resp.json())
            route.abort("failed")
            return
        route.continue_()
    with signed_in(browser, app_url, COORD, path=board_path(b)) as page:
        page.route("**/api/bookings/*/complete", lose)
        page.on("request", lambda r: posts.append(r) if r.method == "POST" and r.url.endswith("/complete") else None)
        wait_ui(page, lambda: heading(page, b).count() == 1, "detail")
        click(page.get_by_role("button", name="Mark complete"))
        dlg = page.get_by_role("dialog", name="Complete assignment")
        rec = dlg.get_by_role("button", name="Record completion")
        click(rec)
        wait_ui(page, lambda: txt(action_error(page)) == COPY_NETWORK, "network-failure copy")
        assert dlg.count() == 1 and is_focused(rec)
        click(rec)
        line_ref = first[0]["charge"]["line_ref"]
        wait_ui(page, lambda: txt(action_status(page)) == f"{b['ref']} completed. Invoice line {line_ref} recorded.", "replayed success names the line")
    assert len(posts) == 2 and posts[0].post_data_buffer == posts[1].post_data_buffer
    assert posts[0].headers.get("idempotency-key") and posts[0].headers.get("idempotency-key") == posts[1].headers.get("idempotency-key")
    assert [e["action"] for e in audit(coord, b)].count("completed") == 1
    wait_synced(Api(app_url, BILLING), "riverbend", line_ref)
    assert len(kb_charges(killbill, "riverbend", line_ref)) == 1


def test_line_arithmetic(app_url: str) -> None:
    coord = Api(app_url, COORD)
    bm = Api(app_url, BILLING)
    keys = {"line_ref", "booking_id", "booking_ref", "org_id", "kind", "assignment_date", "rate_effective_from", "hourly_rate_cents", "team_surcharge_bp",
            "basis_minutes", "billable_minutes", "interpreter_count", "time_amount_cents", "mileage_miles", "mileage_cents_per_mile", "mileage_amount_cents",
            "amount_cents", "billing_amount_cents", "billing_week", "sync_status", "created_at"}
    team = covered_team(coord, minutes=SOLO_THRESHOLD * 3 + 30)
    ln = complete(coord, team, SOLO_THRESHOLD * 3 + 50, 18)["charge"]
    assert ln["amount_cents"] == EXAMPLE_RIVERBEND_LINE
    line, _ = wait_synced(bm, "riverbend", ln["line_ref"])
    assert set(line) == keys
    assert (line["basis_minutes"], line["billable_minutes"], line["interpreter_count"], line["time_amount_cents"], line["mileage_amount_cents"],
            line["hourly_rate_cents"], line["team_surcharge_bp"], line["mileage_cents_per_mile"], line["rate_effective_from"], line["kind"],
            line["assignment_date"], line["booking_ref"], line["org_id"]) == (
        SOLO_THRESHOLD * 3 + 50, SOLO_THRESHOLD * 4, 2, EXAMPLE_RIVERBEND_TIME, EXAMPLE_RIVERBEND_MILEAGE, CONTRACTS["riverbend"][0],
        CONTRACTS["riverbend"][1], CONTRACTS["riverbend"][2], SEED_RATE_FROM, "completed", ymd(team["start"]), team["ref"], "riverbend")
    rate, bp, mrate, _ = CONTRACTS["maple-valley"]
    for worked, expected_billable in ((MINIMUM_MINUTES + INCREMENT_MINUTES, MINIMUM_MINUTES + INCREMENT_MINUTES), (DURATION_MIN, MINIMUM_MINUTES), (MINIMUM_MINUTES + 1, MINIMUM_MINUTES + INCREMENT_MINUTES)):
        b = free_booking(coord, "maple-valley", "educational", SOLO_THRESHOLD, ["riley-brooks"])
        assign(coord, b, "riley-brooks", 1)
        ch = complete(coord, b, worked, 0)["charge"]
        billable, time_amount, total = line_math(rate, bp, mrate, max(worked, SOLO_THRESHOLD), 1, 0)
        assert billable == expected_billable and ch["amount_cents"] == total
        if worked == MINIMUM_MINUTES + INCREMENT_MINUTES:
            assert total == EXAMPLE_MAPLE_LINE
        line, _ = wait_synced(bm, "maple-valley", ch["line_ref"])
        assert line["billable_minutes"] == billable and line["time_amount_cents"] == time_amount and line["team_surcharge_bp"] == bp


def test_killbill_charge_once(app_url: str, killbill: KillBill) -> None:
    coord = Api(app_url, COORD)
    bm = Api(app_url, BILLING)
    b = free_booking(coord, "maple-valley", "educational", SOLO_THRESHOLD, ["quinn-halvorsen"])
    assign(coord, b, "quinn-halvorsen", 1)
    coord.post(f"/api/bookings/{b['id']}/check-in")
    k = idem = uuid.uuid4().hex
    r1 = coord.post(f"/api/bookings/{b['id']}/complete", {"worked_minutes": SOLO_THRESHOLD, "mileage_miles": 4}, key=k)
    r2 = coord.post(f"/api/bookings/{b['id']}/complete", {"worked_minutes": SOLO_THRESHOLD, "mileage_miles": 4}, key=idem)
    assert r1.status_code == r2.status_code == 200 and r1.json() == r2.json()
    assert_error(coord.post(f"/api/bookings/{b['id']}/complete", {"worked_minutes": SOLO_THRESHOLD, "mileage_miles": 4}), 409, "invalid_transition")
    ch = r1.json()["charge"]
    line, _ = wait_synced(bm, "maple-valley", ch["line_ref"])
    items = kb_charges(killbill, "maple-valley", ch["line_ref"])
    assert len(items) == 1 and str(items[0]["description"]).startswith(f"{ch['line_ref']} {b['ref']}") and "completed" in items[0]["description"]
    assert cents_of(items[0]["amount"]) == ch["amount_cents"] == line["billing_amount_cents"]
    acct = killbill.account_by_key("maple-valley")
    assert acct["currency"] == "USD" and acct["name"] == ORGS["maple-valley"][2]
    late = tomorrow_booking(coord, "maple-valley", "educational", SOLO_THRESHOLD, ["riley-brooks"])
    assign(coord, late, "riley-brooks", 1)
    lc = cancel(coord, late)["charge"]
    wait_synced(bm, "maple-valley", lc["line_ref"])
    li = kb_charges(killbill, "maple-valley", lc["line_ref"])
    assert len(li) == 1 and "late cancellation" in li[0]["description"] and cents_of(li[0]["amount"]) == lc["amount_cents"]


def test_billing_down(app_url: str, killbill: KillBill) -> None:
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    coord = Api(app_url, COORD)
    dc = Api(down, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["casey-morgan"])
    assign(coord, b, "casey-morgan", 1)
    ch = complete(dc, b, SOLO_THRESHOLD, 0)["charge"]
    assert ch["sync_status"] == "pending_sync"
    late = tomorrow_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["jordan-reyes"])
    assign(coord, late, "jordan-reyes", 1)
    lc = cancel(dc, late)
    assert lc["status"] == "cancelled_late" and lc["charge"]["sync_status"] == "pending_sync"
    db = Api(down, BILLING)
    monday = monday_of(today_of(agency(db)))
    st = statement(db, "riverbend", monday)
    assert st.status_code == 200
    body = st.json()
    assert body["billing_reachable"] is False and body["billing_total_cents"] is None
    assert all(ln["billing_amount_cents"] is None for ln in body["lines"])
    closed = close_week(db, "riverbend", monday)
    assert closed.status_code in (409, 503) and closed.json()["error"] in ("pending_sync", "billing_unavailable")
    bm = Api(app_url, BILLING)
    for ref in (ch["line_ref"], lc["charge"]["line_ref"]):
        wait_synced(bm, "riverbend", ref)
        assert len(kb_charges(killbill, "riverbend", ref)) == 1


def test_transitions(app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["casey-morgan"])
    assert assert_error(coord.post(f"/api/bookings/{b['id']}/check-in"), 409, "invalid_transition")["status"] == "submitted"
    assign(coord, b, "casey-morgan", 1)
    assert_error(Api(app_url, INTERPRETERS["casey-morgan"][2]).post(f"/api/bookings/{b['id']}/check-in"), 403, "forbidden")
    assert assert_error(coord.post(f"/api/bookings/{b['id']}/complete", {"worked_minutes": SOLO_THRESHOLD, "mileage_miles": 0}), 409, "invalid_transition")["status"] == "covered"
    r = coord.post(f"/api/bookings/{b['id']}/check-in")
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    for path, body in ((f"/api/bookings/{b['id']}/check-in", None), (f"/api/bookings/{b['id']}/seats/1/release", None),
                       (f"/api/bookings/{b['id']}/cancel", {"quoted_charge_cents": 0}), (f"/api/bookings/{b['id']}/team", None)):
        assert assert_error(coord.post(path, body), 409, "invalid_transition")["status"] == "in_progress", path
    for body, field in (({"worked_minutes": 0, "mileage_miles": 0}, "worked_minutes"), ({"worked_minutes": WORKED_MAX + 1, "mileage_miles": 0}, "worked_minutes"),
                        ({"worked_minutes": "sixty", "mileage_miles": 0}, "worked_minutes"), ({"worked_minutes": SOLO_THRESHOLD, "mileage_miles": MILEAGE_MAX + 1}, "mileage_miles"),
                        ({"worked_minutes": SOLO_THRESHOLD, "mileage_miles": -1}, "mileage_miles")):
        assert_field(coord.post(f"/api/bookings/{b['id']}/complete", body), field, FIELD[field])
    r = coord.post(f"/api/bookings/{b['id']}/complete", {"worked_minutes": WORKED_MAX, "mileage_miles": MILEAGE_MAX})
    assert r.status_code == 200 and r.json()["status"] == "completed" and r.json()["charge"]["kind"] == "completed"
    assert assert_error(coord.post(f"/api/bookings/{b['id']}/open-call"), 409, "invalid_transition")["status"] == "completed"


def test_audit_trail(app_url: str) -> None:
    coord = Api(app_url, COORD)
    lena = Api(app_url, ORGS["riverbend"][0])
    ag = agency(coord)
    for _ in range(SLOT_ATTEMPTS):
        k = uuid.uuid4().hex
        body = booking_body("riverbend", "medical", SOLO_THRESHOLD, slot_start(pool_day(ag)))
        b = create(lena, body, key=k)
        c = choices(coord, b["id"])
        if all(not c[i]["busy"] for i in ("jordan-reyes", "avery-chen", "casey-morgan")):
            break
    else:
        pytest.fail("no free slot for the audit lifecycle")
    assert lena.post("/api/bookings", body, key=k).status_code == 201
    coord.post(f"/api/bookings/{b['id']}/team")
    coord.post(f"/api/bookings/{b['id']}/open-call")
    Api(app_url, INTERPRETERS["jordan-reyes"][2]).post(f"/api/bookings/{b['id']}/claim")
    assign(coord, b, "avery-chen", 2)
    coord.post(f"/api/bookings/{b['id']}/assign", {"interpreter_id": "casey-morgan", "seat": 2})
    Api(app_url, INTERPRETERS["avery-chen"][2]).post(f"/api/bookings/{b['id']}/seats/2/release")
    assign(coord, b, "casey-morgan", 2)
    complete(coord, b, SOLO_THRESHOLD, 0)
    coord.post(f"/api/bookings/{b['id']}/complete", {"worked_minutes": SOLO_THRESHOLD, "mileage_miles": 0})
    got = audit(coord, b)
    assert all(set(e) == {"at", "actor_name", "action", "from_status", "to_status", "seat", "interpreter_name"} for e in got)
    assert [(e["action"], e["from_status"], e["to_status"], e["seat"], e["interpreter_name"], e["actor_name"]) for e in got] == [
        ("submitted", None, "submitted", None, None, "Lena Torres"),
        ("made_team", "submitted", "submitted", None, None, "Dana Okafor"),
        ("open_call_published", "submitted", "open", None, None, "Dana Okafor"),
        ("seat_filled", "open", "partially_covered", 1, "Jordan Reyes", "Jordan Reyes"),
        ("seat_filled", "partially_covered", "covered", 2, "Avery Chen", "Dana Okafor"),
        ("seat_released", "covered", "partially_covered", 2, "Avery Chen", "Avery Chen"),
        ("seat_filled", "partially_covered", "covered", 2, "Casey Morgan", "Dana Okafor"),
        ("checked_in", "covered", "in_progress", None, None, "Dana Okafor"),
        ("completed", "in_progress", "completed", None, None, "Dana Okafor"),
    ]
    assert Api(app_url, BILLING).get(f"/api/bookings/{b['id']}/audit").status_code == 200
    assert_error(lena.get(f"/api/bookings/{b['id']}/audit"), 403, "forbidden")


def test_rate_by_assignment_date(app_url: str) -> None:
    coord = Api(app_url, COORD)
    bm = Api(app_url, BILLING)
    contract = next(c for c in bm.get("/api/contracts").json()["contracts"] if c["org_id"] == "maple-valley")
    latest = max(date.fromisoformat(r["effective_from"]) for r in contract["rates"])
    d = max(RATE_PROBE_FROM, latest + timedelta(days=2))
    _, bp, mrate, _ = CONTRACTS["maple-valley"]
    for _ in range(SLOT_ATTEMPTS):
        r = bm.post(f"/api/contracts/{contract['id']}/rates", {"effective_from": d.isoformat(), "hourly_rate_cents": NEW_RATE_CENTS, "team_surcharge_bp": bp, "mileage_cents_per_mile": mrate})
        if r.status_code == 201:
            break
        d = date.fromisoformat(r.json()["earliest_allowed"]) if r.json().get("error") == "rate_would_reprice" else d + timedelta(days=1)
    else:
        pytest.fail("could not add a future Maple Valley rate")
    assert d <= RILEY_NIC_END, "rate date drifted past the interpreters' credentials"
    prev = max((x for x in contract["rates"] if date.fromisoformat(x["effective_from"]) <= d - timedelta(days=1)), key=lambda x: x["effective_from"])
    eve = free_booking(coord, "maple-valley", "educational", SOLO_THRESHOLD, ["riley-brooks"], start=f"{d - timedelta(days=1)}T23:30")
    morn = free_booking(coord, "maple-valley", "educational", SOLO_THRESHOLD, ["quinn-halvorsen"], start=f"{d}T00:15")
    assign(coord, eve, "riley-brooks", 1)
    assign(coord, morn, "quinn-halvorsen", 1)
    worked = MINIMUM_MINUTES + INCREMENT_MINUTES
    e = complete(coord, eve, worked, 0)["charge"]
    m = complete(coord, morn, worked, 0)["charge"]
    assert e["amount_cents"] == line_math(prev["hourly_rate_cents"], prev["team_surcharge_bp"], prev["mileage_cents_per_mile"], worked, 1, 0)[2]
    if prev["effective_from"] == SEED_RATE_FROM:
        assert e["amount_cents"] == EXAMPLE_MAPLE_LINE
    assert m["amount_cents"] == EXAMPLE_NEW_RATE_LINE
    le, _ = wait_synced(bm, "maple-valley", e["line_ref"])
    lm, _ = wait_synced(bm, "maple-valley", m["line_ref"])
    assert (le["assignment_date"], le["rate_effective_from"]) == ((d - timedelta(days=1)).isoformat(), prev["effective_from"])
    assert (lm["assignment_date"], lm["rate_effective_from"], lm["hourly_rate_cents"]) == (d.isoformat(), d.isoformat(), NEW_RATE_CENTS)


def far_rate_date() -> date:
    return date(RNG.randint(*FAR_RATE_YEARS), RNG.randint(1, 12), RNG.randint(1, 28))


def test_wf_weekly_close_happy(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    bm = Api(app_url, BILLING)
    b = legal_pair(coord)
    assign(coord, b, "riley-brooks", 1)
    assign(coord, b, "sasha-lindqvist", 2)
    ch = complete(coord, b, SOLO_THRESHOLD, 0)["charge"]
    _, st = wait_synced(bm, "harlan-court", ch["line_ref"])
    monday = st["week_start"]
    end = time.monotonic() + SYNC_DEADLINE_S
    while time.monotonic() < end and st["billing_total_cents"] is None:
        st = statement(bm, "harlan-court", date.fromisoformat(monday)).json()
    total = st["relayline_total_cents"]
    assert st["billing_total_cents"] == total
    rate_day = far_rate_date()
    with signed_in(browser, app_url, BILLING) as page:
        select(page.get_by_role("combobox", name="Client"), ORGS["harlan-court"][2])
        fill(page.get_by_label("Week starting"), monday)
        click(page.get_by_role("button", name="Show week"))
        table = page.get_by_role("table", name="Invoice lines")
        line_row = table.get_by_role("row").filter(has_text=ch["line_ref"])
        wait_ui(page, lambda: line_row.count() == 1 and "Synced" in txt(line_row), "line row Synced")
        assert txt(line_row).count(dollars(ch["amount_cents"])) >= 2, "Amount and Billing amount both shown"
        click(line_row.get_by_text(ch["line_ref"]))
        wait_ui(page, lambda: ch["line_ref"] in txt(page.get_by_role("region", name="Line breakdown")), "line breakdown")
        assert f"Relayline {dollars(total)} · billing {dollars(total)}" in txt(page.get_by_role("region", name="Week totals"))
        click(page.get_by_role("button", name="Close week"))
        wait_ui(page, lambda: txt(action_status(page)) == f"Week of {monday} closed for {ORGS['harlan-court'][2]}. Relayline {dollars(total)} matches billing {dollars(total)}.", "close success copy")
        rates = page.get_by_role("region", name="Contract rates")
        form = rates.get_by_role("form", name="Add rate")
        fill(form.get_by_label("Effective from"), rate_day.isoformat())
        fill(form.get_by_label("Hourly rate (dollars)"), "110.00")
        fill(form.get_by_label("Team surcharge (percent)"), "15")
        fill(form.get_by_label("Mileage rate (cents per mile)"), "5")
        click(form.get_by_role("button", name="Add rate"))
        wait_ui(page, lambda: txt(action_status(page)) == f"New rate takes effect {rate_day}.", "rate success copy")
        assert rate_day.isoformat() in txt(rates)
    closed = statement(bm, "harlan-court", date.fromisoformat(monday)).json()
    assert closed["status"] == "closed" and closed["relayline_total_cents"] == closed["billing_total_cents"] == total and closed["closed_at"]
    contract = next(c for c in bm.get("/api/contracts").json()["contracts"] if c["org_id"] == "harlan-court")
    assert {"effective_from": rate_day.isoformat(), "hourly_rate_cents": 11000, "team_surcharge_bp": 1500, "mileage_cents_per_mile": 5} in contract["rates"]


def test_wf_weekly_close_outage(browser: Browser, app_url: str) -> None:
    monday = monday_of(today_of(agency(Api(app_url, BILLING)))).isoformat()
    with signed_in(browser, os.environ["APP_KILLBILL_DOWN_URL"], BILLING) as page:
        select(page.get_by_role("combobox", name="Client"), ORGS["riverbend"][2])
        fill(page.get_by_label("Week starting"), monday)
        click(page.get_by_role("button", name="Show week"))
        totals = page.get_by_role("region", name="Week totals")
        wait_ui(page, lambda: "billing not yet confirmed" in txt(totals) and COPY_BILLING_UNREADABLE in txt(totals), "unreachable totals")
        click(page.get_by_role("button", name="Close week"))
        wait_ui(page, lambda: txt(action_error(page)) in (COPY_BILLING_DOWN, COPY_PENDING_SYNC), "close refused")
    assert statement(Api(app_url, BILLING), "riverbend", date.fromisoformat(monday)).json()["status"] == "open"


def test_weekly_statement(app_url: str) -> None:
    coord = Api(app_url, COORD)
    bm = Api(app_url, BILLING)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["casey-morgan"])
    assign(coord, b, "casey-morgan", 1)
    ch = complete(coord, b, SOLO_THRESHOLD, 0)["charge"]
    _, st = wait_synced(bm, "riverbend", ch["line_ref"])
    assert set(st) == {"org_id", "org_name", "week_start", "status", "lines", "relayline_total_cents", "billing_total_cents", "billing_reachable", "closed_at"}
    assert st["status"] == "open" and st["closed_at"] is None and st["billing_reachable"] is True
    assert st["relayline_total_cents"] == sum(ln["amount_cents"] for ln in st["lines"])
    if st["billing_total_cents"] is not None:
        assert st["billing_total_cents"] == sum(ln["billing_amount_cents"] for ln in st["lines"])
    monday = date.fromisoformat(st["week_start"])
    assert statement(Api(app_url, ORGS["riverbend"][0]), "riverbend", monday).status_code == 200
    assert_error(statement(Api(app_url, ORGS["maple-valley"][0]), "riverbend", monday), 404, "not_found")
    assert_error(statement(coord, "riverbend", monday), 403, "forbidden")
    assert_field(statement(bm, "riverbend", monday + timedelta(days=1)), "week_start", FIELD["week_start"])
    assert_field(statement(bm, "riverbend", monday + timedelta(days=7)), "week_start", FIELD["week_start"])
    past = monday_of(date(RNG.randint(*PAST_WEEK_YEARS), RNG.randint(1, 12), RNG.randint(1, 28)))
    assert_error(close_week(Api(app_url, ORGS["riverbend"][0]), "riverbend", past), 403, "forbidden")
    r = close_week(bm, "riverbend", past)
    assert r.status_code == 200
    closed = r.json()
    assert closed["status"] == "closed" and closed["relayline_total_cents"] == 0 == closed["billing_total_cents"] and closed["closed_at"]
    assert_error(close_week(bm, "riverbend", past), 409, "week_closed")


def test_contract_rates(app_url: str) -> None:
    coord = Api(app_url, COORD)
    bm = Api(app_url, BILLING)
    contract = next(c for c in bm.get("/api/contracts").json()["contracts"] if c["org_id"] == "harlan-court")
    assert (contract["minimum_minutes"], contract["increment_minutes"], contract["rotation_interval_minutes"]) == (MINIMUM_MINUTES, INCREMENT_MINUTES, CONTRACTS["harlan-court"][3])
    path = f"/api/contracts/{contract['id']}/rates"

    def rate(day: date, **over: int) -> dict[str, Any]:
        base = {"effective_from": day.isoformat(), "hourly_rate_cents": HOURLY_MAX, "team_surcharge_bp": SURCHARGE_MAX, "mileage_cents_per_mile": MILEAGE_RATE_MAX}
        base.update(over)
        return base
    today = today_of(agency(bm))
    b = legal_pair(coord)
    assign(coord, b, "riley-brooks", 1)
    assign(coord, b, "sasha-lindqvist", 2)
    ch = complete(coord, b, SOLO_THRESHOLD, 0)["charge"]
    x = local(b["start"]).date()
    assert_field(bm.post(path, rate(today)), "effective_from", EFFECTIVE_FUTURE)
    for field, value in (("hourly_rate_cents", 0), ("hourly_rate_cents", HOURLY_MAX + 1), ("team_surcharge_bp", SURCHARGE_MAX + 1), ("mileage_cents_per_mile", MILEAGE_RATE_MAX + 1)):
        assert_field(bm.post(path, rate(x, **{field: value})), field, FIELD[field])
    body = assert_error(bm.post(path, rate(x)), 409, "rate_would_reprice")
    assert date.fromisoformat(body["earliest_allowed"]) > max(x, today)
    assert_error(coord.post(path, rate(far_rate_date())), 403, "forbidden")
    f = far_rate_date()
    r = bm.post(path, rate(f))
    assert r.status_code == 201 and any(rt["effective_from"] == f.isoformat() for rt in r.json()["rates"])
    assert_field(bm.post(path, rate(f)), "effective_from", EFFECTIVE_DUP)
    assert get_booking(coord, b)["charge"]["amount_cents"] == ch["amount_cents"], "existing lines never change"


def test_billing_from_killbill(app_url: str, killbill: KillBill) -> None:
    coord = Api(app_url, COORD)
    bm = Api(app_url, BILLING)
    b = free_booking(coord, "maple-valley", "educational", SOLO_THRESHOLD, ["riley-brooks"])
    assign(coord, b, "riley-brooks", 1)
    ch = complete(coord, b, SOLO_THRESHOLD, 7)["charge"]
    line, st = wait_synced(bm, "maple-valley", ch["line_ref"])
    items = kb_charges(killbill, "maple-valley", ch["line_ref"])
    assert len(items) == 1, "a synced line is backed by a Kill Bill item"
    assert line["billing_amount_cents"] == kb_current_cents(killbill, "maple-valley", items[0])
    sync_label_differs = line["billing_amount_cents"] != line["amount_cents"]
    assert sync_label_differs is (kb_current_cents(killbill, "maple-valley", items[0]) != ch["amount_cents"])
    if st["billing_total_cents"] is not None:
        assert st["billing_total_cents"] == sum(ln["billing_amount_cents"] for ln in st["lines"])
    down = Api(os.environ["APP_KILLBILL_DOWN_URL"], BILLING)
    dst = statement(down, "maple-valley", date.fromisoformat(st["week_start"])).json()
    mine = [ln for ln in dst["lines"] if ln["line_ref"] == ch["line_ref"]]
    assert dst["billing_reachable"] is False and dst["billing_total_cents"] is None and mine and mine[0]["billing_amount_cents"] is None
    r = close_week(down, "maple-valley", st["week_start"])
    assert r.status_code in (409, 503) and r.json()["error"] in ("pending_sync", "billing_unavailable")


ADJUST_CENTS = 100
COPY_TOTAL_MISMATCH = "Relayline and billing totals differ. Nothing was closed."


def adjust_in_killbill(killbill: KillBill, org: str, item: dict[str, Any], cents: int) -> None:
    acct = killbill.account_by_key(org)
    assert acct, f"Kill Bill has no account for {org}"
    r = httpx.post(
        f"{os.environ['KILLBILL_URL'].rstrip('/')}/1.0/kb/invoices/{item['invoiceId']}",
        json={"accountId": acct["accountId"], "invoiceItemId": item["invoiceItemId"], "amount": f"{cents / 100:.2f}", "currency": "USD"},
        auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
        headers={"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"], "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
                 "X-Killbill-CreatedBy": "verifier"},
        timeout=HTTP_TIMEOUT_S)
    assert r.status_code < 300, f"Kill Bill adjustment answered {r.status_code} {r.text[:300]}"


def test_billing_adjustment_differs(browser: Browser, app_url: str, killbill: KillBill) -> None:
    coord = Api(app_url, COORD)
    bm = Api(app_url, BILLING)
    b = free_booking(coord, "maple-valley", "educational", SOLO_THRESHOLD, ["riley-brooks"])
    assign(coord, b, "riley-brooks", 1)
    ch = complete(coord, b, SOLO_THRESHOLD, 0)["charge"]
    wait_synced(bm, "maple-valley", ch["line_ref"])
    items = kb_charges(killbill, "maple-valley", ch["line_ref"])
    assert len(items) == 1
    adjust_in_killbill(killbill, "maple-valley", items[0], ADJUST_CENTS)
    expected = kb_current_cents(killbill, "maple-valley", items[0])
    assert expected != ch["amount_cents"], "the Kill Bill adjustment must change the item's current amount"
    monday = monday_of(today_of(agency(bm)))
    end = time.monotonic() + SYNC_DEADLINE_S
    st: dict[str, Any] = {}
    while time.monotonic() < end:
        st = statement(bm, "maple-valley", monday).json()
        mine = [ln for ln in st["lines"] if ln["line_ref"] == ch["line_ref"]]
        if mine and mine[0]["billing_amount_cents"] == expected and all(ln["sync_status"] == "synced" for ln in st["lines"]):
            break
    else:
        pytest.fail(f"statement never showed billing_amount_cents {expected} with every line synced; last {st}")
    assert mine[0]["amount_cents"] == ch["amount_cents"] != mine[0]["billing_amount_cents"]
    relayline = sum(ln["amount_cents"] for ln in st["lines"])
    billing = sum(ln["billing_amount_cents"] for ln in st["lines"])
    assert st["relayline_total_cents"] == relayline and st["billing_total_cents"] == billing and relayline != billing
    r = close_week(bm, "maple-valley", monday)
    body = assert_error(r, 409, "total_mismatch")
    assert (body["relayline_total_cents"], body["billing_total_cents"]) == (relayline, billing)
    assert statement(bm, "maple-valley", monday).json()["status"] == "open"
    with signed_in(browser, app_url, BILLING) as page:
        select(page.get_by_role("combobox", name="Client"), ORGS["maple-valley"][2])
        fill(page.get_by_label("Week starting"), monday.isoformat())
        click(page.get_by_role("button", name="Show week"))
        table = page.get_by_role("table", name="Invoice lines")
        line_row = table.get_by_role("row").filter(has_text=ch["line_ref"])
        wait_ui(page, lambda: line_row.count() == 1 and "Differs" in txt(line_row), "Differs beside the adjusted line")
        assert dollars(expected) in txt(line_row) and dollars(ch["amount_cents"]) in txt(line_row)
        click(page.get_by_role("button", name="Close week"))
        wait_ui(page, lambda: txt(action_error(page)) == COPY_TOTAL_MISMATCH, "total_mismatch copy")
        assert f"Relayline {dollars(relayline)} · billing {dollars(billing)}" in txt(page.get_by_role("region", name="Week totals"))
    assert statement(bm, "maple-valley", monday).json()["status"] == "open"


def test_seeded_sign_in_and_roles(browser: Browser, app_url: str) -> None:
    people = {COORD: ("Dana Okafor", "coordinator", None), BILLING: ("Morgan Ellis", "billing_manager", None)}
    people.update({v[0]: (v[1], "requester", k) for k, v in ORGS.items()})
    people.update({v[2]: (v[0], "interpreter", None) for v in INTERPRETERS.values()})
    for email, (name, role, org) in people.items():
        api = Api(app_url)
        r = api.sign_in(email)
        assert r.status_code == 200
        u = r.json()["user"]
        assert (u["name"], u["email"], u["role"], u["org_id"]) == (name, email, role, org)
        assert api.get("/api/me").json()["role"] == role
    assert_error(Api(app_url).sign_in(COORD, "wrong-password"), 401, "invalid_credentials")
    assert_error(Api(app_url).get("/api/me"), 401, "unauthenticated")
    lena = Api(app_url, ORGS["riverbend"][0])
    b = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD, slot_start(pool_day(agency(lena)))))
    assert_error(lena.post(f"/api/bookings/{b['id']}/team"), 403, "forbidden")
    assert_error(lena.get("/api/interpreters"), 403, "forbidden")
    assert_error(Api(app_url, BILLING).post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, b["start"][:16])), 403, "forbidden")
    assert_error(Api(app_url, INTERPRETERS["jordan-reyes"][2]).post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, b["start"][:16])), 403, "forbidden")
    assert_error(Api(app_url, BILLING).post(f"/api/bookings/{b['id']}/open-call"), 403, "forbidden")
    homes = {COORD: ("region", "Coverage board"), INTERPRETERS["jordan-reyes"][2]: ("region", "Open calls"),
             ORGS["riverbend"][0]: ("region", "Bookings"), BILLING: ("combobox", "Client")}
    for email, (role, label) in homes.items():
        with signed_in(browser, app_url, email) as page:
            wait_ui(page, lambda: page.get_by_role(role, name=label).count() == 1, f"{label} home")
            assert f"Signed in as {people[email][0]}" in txt(page.get_by_role("navigation", name="Main")) or f"Signed in as {people[email][0]}" in page.inner_text("body")
            assert f"Times in {AGENCY_TZ_NAME}" in page.inner_text("body")
            click(page.get_by_role("button", name="Sign out"))
            wait_ui(page, lambda: page.get_by_role("form", name="Sign in").count() == 1, "back to Sign in")


def test_idempotency(app_url: str, mail: Mailpit) -> None:
    lena = Api(app_url, ORGS["riverbend"][0])
    coord = Api(app_url, COORD)
    d = pool_day(agency(lena))
    body = booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T08:00")
    for bad in ("", "k" * (KEY_MAX + 1), "has space", "clé"):
        r = lena.post("/api/bookings", {**body, "title": f"bad {uuid.uuid4().hex[:6]}"}, key=bad)
        b = assert_error(r, 422, "validation")
        assert b["fields"] == {"idempotency_key": FIELD["idempotency_key"]}
    assert all(not x["title"].startswith("bad ") for x in lena.get(f"/api/bookings?from={d}&to={d}").json()["bookings"])
    k = "k" * KEY_MAX
    first = lena.post("/api/bookings", body, key=k)
    again = lena.post("/api/bookings", body, key=k)
    assert first.status_code == again.status_code == 201 and first.json() == again.json()
    assert_error(lena.post("/api/bookings", {**body, "title": "changed"}, key=k), 422, "idempotency_key_reused")
    assert_error(lena.post(f"/api/bookings/{first.json()['id']}/team", None, key=k), 422, "idempotency_key_reused")
    sam_r = Api(app_url, ORGS["maple-valley"][0]).post("/api/bookings", body, key=k)
    assert sam_r.status_code == 201 and sam_r.json()["id"] != first.json()["id"], "keys are scoped to the user"
    k2 = uuid.uuid4().hex
    assert_error(Api(app_url).post("/api/bookings", body, key=k2), 401, "unauthenticated")
    assert lena.post("/api/bookings", {**body, "title": f"after {k2[:6]}"}, key=k2).status_code == 201
    k3 = uuid.uuid4().hex
    title = f"race {k3[:6]}"
    results = together([lambda: lena.post("/api/bookings", {**body, "title": title}, key=k3) for _ in range(5)])
    oks = [r for r in results if r.status_code == 201]
    for r in results:
        if r.status_code != 201:
            assert_error(r, 409, "idempotency_in_progress")
    assert oks and len({r.json()["id"] for r in oks}) == 1
    assert len([x for x in lena.get(f"/api/bookings?from={d}&to={d}").json()["bookings"] if x["title"] == title]) == 1
    assert lena.get("/api/me", **{"Idempotency-Key": ""}).status_code == 200
    c = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T15:00"))
    cancel(lena, c)
    assert_error(lena.post(f"/api/bookings/{c['id']}/cancel", {"quoted_charge_cents": 0}), 409, "invalid_transition")
    assert [e["action"] for e in audit(coord, c)].count("cancelled") == 1
    assert len(mails(mail, subject(SUBJ_CANCELLED, c), ORGS["riverbend"][0], 1)) == 1


def test_health(app_url: str) -> None:
    r = httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    home = httpx.get(app_url.rstrip("/") + "/", timeout=HTTP_TIMEOUT_S)
    assert home.status_code == 200 and home.text.strip()


def test_server_boundary(app_url: str) -> None:
    root = app_url.rstrip("/")
    anon = Api(app_url)
    r = anon.post("/api/session", {"email": COORD, "password": PASSWORD}, Origin=FOREIGN_ORIGIN)
    assert_error(r, 403, "cross_origin")
    assert anon.get("/api/me").status_code == 401, "a cross-origin write must not sign anyone in"
    lena = Api(app_url, ORGS["riverbend"][0])
    d = pool_day(agency(lena))
    title = f"xo {uuid.uuid4().hex[:6]}"
    assert_error(lena.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T09:00", title=title), Origin=FOREIGN_ORIGIN), 403, "cross_origin")
    assert all(x["title"] != title for x in lena.get(f"/api/bookings?from={d}&to={d}").json()["bookings"])
    assert lena.post("/api/bookings", booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T09:00"), Origin=root).status_code == 201

    def sized(n: int) -> bytes:
        skeleton = json.dumps({"email": "nobody@tandemhands.example", "password": "x", "pad": ""}, separators=(",", ":")).encode()
        return skeleton[:-2] + b"a" * (n - len(skeleton)) + b'"}'
    at = anon.raw("POST", "/api/session", sized(JSON_LIMIT), "application/json")
    assert at.status_code != 413 and at.json().get("error") != "payload_too_large"
    assert_error(anon.raw("POST", "/api/session", sized(JSON_LIMIT + 1), "application/json"), 413, "payload_too_large")
    ruth = Api(app_url, ORGS["harlan-court"][0])
    b = create(ruth, booking_body("harlan-court", "legal", SOLO_THRESHOLD, f"{d}T10:00"))
    head, boundary = multipart("big.pdf", b"", "application/pdf")
    filler = MULTIPART_LIMIT + 1 - len(head)
    body = head[: -len(f"\r\n--{boundary}--\r\n")] + b"%PDF-" + b"0" * (filler - 5) + f"\r\n--{boundary}--\r\n".encode()
    assert_error(ruth.raw("POST", f"/api/bookings/{b['id']}/materials", body, f"multipart/form-data; boundary={boundary}"), 413, "payload_too_large")
    for path in ("/package.json", "/package-lock.json", "/run.json", "/.env", "/.git/config", "/tsconfig.json", "/src/server.ts", "/server/index.ts"):
        assert httpx.get(root + path, timeout=HTTP_TIMEOUT_S).status_code == 404, f"{path} must answer 404"
    assert httpx.get(root + "/api/health", headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S).status_code == 200
    html = httpx.get(root + "/", timeout=HTTP_TIMEOUT_S).text
    assets = set(re.findall(r'(?:src|href)="(/(?!/)[^"]+)"', html))
    served = html
    for a in assets:
        resp = httpx.get(root + a, timeout=HTTP_TIMEOUT_S)
        served += resp.text if resp.status_code == 200 else ""
        if a.endswith(".js") or a.endswith(".css"):
            assert httpx.get(root + a + ".map", timeout=HTTP_TIMEOUT_S).status_code == 404, f"source map for {a} served"
    for name in ("DATABASE_URL", "KILLBILL_URL", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT"):
        value = os.environ.get(name, "")
        if len(value) >= 12:
            assert value not in served, f"{name} value reached the browser bundle"


def test_error_precedence(app_url: str) -> None:
    anon = Api(app_url)
    lena = Api(app_url, ORGS["riverbend"][0])
    coord = Api(app_url, COORD)
    d = pool_day(agency(lena))
    big = b'{"pad":"' + b"a" * JSON_LIMIT + b'"}'
    assert_error(anon.post("/api/bookings", {}, Origin=FOREIGN_ORIGIN), 403, "cross_origin")
    assert_error(anon.raw("POST", "/api/bookings", big, "application/json", Origin=FOREIGN_ORIGIN), 403, "cross_origin")
    assert_error(anon.raw("POST", "/api/bookings", big, "application/json"), 413, "payload_too_large")
    assert_error(anon.post("/api/bookings", {}, key=""), 401, "unauthenticated")
    sam_b = create(Api(app_url, ORGS["maple-valley"][0]), booking_body("maple-valley", "educational", SOLO_THRESHOLD, f"{d}T09:00"))
    assert assert_error(lena.post(f"/api/bookings/{sam_b['id']}/team", None, key=""), 422, "validation")["fields"] == {"idempotency_key": FIELD["idempotency_key"]}
    r = assert_error(lena.post(f"/api/bookings/{sam_b['id']}/team"), 404, "not_found")
    assert set(r) == {"error", "message"}
    own = create(lena, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T09:00"))
    assert set(assert_error(lena.post(f"/api/bookings/{own['id']}/team"), 403, "forbidden")) == {"error", "message"}
    held_b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["jordan-reyes"])
    assign(coord, held_b, "jordan-reyes", 1)
    assert_error(Api(app_url, INTERPRETERS["jordan-reyes"][2]).post(f"/api/bookings/{held_b['id']}/assign", {}), 403, "forbidden")
    cancel(lena, own)
    assert_field(lena.post(f"/api/bookings/{own['id']}/cancel", {}), "quoted_charge_cents", FIELD["quoted_charge_cents"])
    body = assert_error(lena.post(f"/api/bookings/{own['id']}/cancel", {"quoted_charge_cents": 0}), 409, "invalid_transition")
    assert set(body) == {"error", "message", "status"} and body["status"] == "cancelled"


def test_responsive_layout(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    b = free_booking(coord, "riverbend", "medical", SOLO_THRESHOLD, ["casey-morgan"])
    assign(coord, b, "casey-morgan", 1)
    monday = monday_of(today_of(agency(coord))).isoformat()
    for email in (COORD, INTERPRETERS["casey-morgan"][2], ORGS["riverbend"][0], BILLING):
        with signed_in(browser, app_url, email) as page:
            for size in (PHONE, MEDIUM, WIDE):
                page.set_viewport_size({"width": size[0], "height": size[1]})
                page.goto(app_url.rstrip("/") + (board_path(b) if email == COORD else "/"))
                wait_ui(page, lambda: page.get_by_role("button", name="Sign out").count() == 1, "home")
                if email == COORD:
                    wait_ui(page, lambda: heading(page, b).count() == 1, "coordinator detail")
                if email == BILLING:
                    select(page.get_by_role("combobox", name="Client"), ORGS["riverbend"][2])
                    fill(page.get_by_label("Week starting"), monday)
                    click(page.get_by_role("button", name="Show week"))
                    wait_ui(page, lambda: page.get_by_role("table", name="Invoice lines").count() == 1, "invoice table")
                layout(page)


def test_keyboard_and_focus(browser: Browser, app_url: str) -> None:
    coord = Api(app_url, COORD)
    d = pool_day(agency(coord))
    b = create(coord, booking_body("riverbend", "medical", SOLO_THRESHOLD, f"{d}T09:00"))
    with signed_in(browser, app_url, COORD, path=f"/?date={d}") as page:
        board = page.get_by_role("region", name="Coverage board")
        r = row(board, b["ref"])
        wait_ui(page, lambda: r.count() == 1, "row")
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        names = tab_order(page, 30)
        pos = {n: i for i, n in reversed(list(enumerate(names)))}
        row_pos = next(i for i, n in enumerate(names) if (n or "").startswith(f"09:00 {b['ref']}") or ROW_NAME_RE.match(n or ""))
        assert pos["Sign out"] < pos["Previous day"] < pos["Next day"] < pos["New request"] < row_pos, names
        rest, focus = state_styles(board.get_by_role("button", name="New request"), "outline-style", "outline-width", "outline-offset", state="focus")
        assert focus["outline-style"] != "none" and float(focus["outline-width"].rstrip("px")) > 0 and float(focus["outline-offset"].rstrip("px")) > 0
        r.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: is_focused(heading(page, b)), "Enter on a row focuses the detail heading")
        opener = board.get_by_role("button", name="New request")
        opener.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="New request")
        wait_ui(page, lambda: dlg.count() == 1 and is_focused(dlg.get_by_label("Organisation")), "focus on the first field")
        for _ in range(25):
            page.keyboard.press("Tab")
            assert dlg.evaluate("d => d.contains(document.activeElement)"), "Tab escaped the dialog"
        for _ in range(5):
            page.keyboard.press("Shift+Tab")
            assert dlg.evaluate("d => d.contains(document.activeElement)"), "Shift+Tab escaped the dialog"
        page.keyboard.press("Escape")
        wait_ui(page, lambda: dlg.count() == 0 and is_focused(opener), "Escape returns to New request")


def test_if_run_manifest() -> None:
    m = json.loads(Path("/app/run.json").read_text())
    assert m.get("_schema") == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(m.get(k), str) and m[k].strip()


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    for font in FONTS:
        assert font in notices, f"{font} missing from notices"


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad[:20]}"


def test_if_postgres_only() -> None:
    assert Postgres().tables(), "no tables in Postgres"
    forbidden = {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level", "lmdb", "pouchdb", "@libsql/client"}
    assert not [p.name for p in shipped_packages() if p.name in forbidden]
    root = Path(DEPLOYED_APP)
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [x for x in dirnames if x not in ("node_modules", ".git")]
        for f in files:
            assert not f.endswith((".sqlite", ".sqlite3", ".db")), f"datastore file {Path(dirpath) / f}"


def test_if_lockfile() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    pinned = lock.get("packages", {})
    for p in shipped_packages():
        entries_for = [v for k, v in pinned.items() if k.endswith("node_modules/" + p.name)]
        assert entries_for, f"{p.name} not pinned in package-lock.json"
        version = getattr(p, "version", None)
        if version:
            assert any(e.get("version") == version for e in entries_for), f"{p.name}@{version} not pinned"


def test_if_compose_untouched() -> None:
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    traj = json.loads(path.read_text())
    compose = re.compile(r"(docker-)?compose[\w.-]*\.ya?ml")
    hits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            target = str(node.get("file_path") or node.get("path") or "")
            if compose.search(target) and any(k in node for k in ("content", "new_string", "old_string", "edits")):
                hits.append(target)
            cmd = node.get("command")
            if isinstance(cmd, str) and compose.search(cmd) and re.search(r"(sed -i|>\s*\S*compose|tee\s|\bmv\b|\brm\b)", cmd):
                hits.append(cmd[:200])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(traj)
    assert not hits, f"compose configuration was modified: {hits[:5]}"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    seen: list[str] = []
    with open_app(browser, app_url.rstrip("/") + "/") as page:
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        ui_sign_in(page, COORD)
        advance(page, REFRESH_MS)
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, f"cross-origin loads: {foreign[:10]}"
