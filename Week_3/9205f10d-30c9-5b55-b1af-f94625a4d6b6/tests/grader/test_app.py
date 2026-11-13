from __future__ import annotations

import contextlib
import csv
import importlib
import io
import json
import os
import random
import re
import subprocess
import threading
from datetime import date, datetime, time as dtime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from time import monotonic
from typing import Any, Callable
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Page, expect

from conftest import (
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
    open_app,
    same_origin,
    select,
    session,
    settle,
    state_styles,
    style,
    tab_order,
    unique,
    until,
)


def _helper(name: str) -> Any:
    for module in ("conftest", "postgres", "killbill", "mailpit", "minio", "s3", "helpers"):
        with contextlib.suppress(ImportError):
            loaded = importlib.import_module(module)
            if hasattr(loaded, name):
                return getattr(loaded, name)
    raise ImportError(name)


Postgres = _helper("Postgres")
S3 = _helper("S3")
addresses = _helper("addresses")
text = _helper("text")
mail_from_address = _helper("mail_from_address")


PASSWORD = "relay-demo-2026"
AGENCY = ZoneInfo("America/New_York")
JSON_LIMIT = 65536
UPLOAD_BODY_LIMIT = 5250000
FILE_LIMIT = 5000000
DURATION_MIN = 30
DURATION_MAX = 480
CONSUMER_MAX = 120
ADDRESS_MAX = 200
CITY_MAX = 80
NOTES_MAX = 2000
ROTATION_MIN = 20
ROTATION_MAX = 30
REASON_MIN = 10
REASON_MAX = 500
SOLO_MAX_MINUTES = 60
ACTUAL_MAX = 720
KEY_MAX = 64
MIN_BILLABLE = 120
INCREMENT = 15
MINUTES_PER_HOUR = 60
LINK_SECONDS = 60
ROW_LEAD_PX = 200
GRID_COLUMNS = 12
PANE_COLUMNS_WIDE = 5
PANE_COLUMNS_MID = 8
REFRESH_MS = 10000
POST_WITHIN_S = 30
PANE_MAX_MS = 500
DIALOG_MAX_MS = 250
HOVER_MAX_MS = 250
INSTANT_MS = 1
CR1006_ACTUAL = 127
CR1006_AMOUNT = "388.13"
CR1006_BILLABLE = 135
CR1007_MINUTES = 45
CR1007_ACTUAL = 40
CR1007_AMOUNT = "220.00"
CUTOFF_SPRING = (datetime(2027, 3, 15, 9, 0), "2027-03-13T09:00:00-05:00")
CUTOFF_FALL = (datetime(2027, 11, 8, 9, 0), "2027-11-06T09:00:00-04:00")
SEEDED_EXPIRY = date(2030, 12, 31)

NOT_FOUND = {"error": {"code": "not_found", "message": "Not found."}}
COORDINATOR = "coord@crosshand.example"
BILLING = "billing@crosshand.example"
SCHEDULER = {"HPMC": "sched@harborpoint.example", "LKSU": "sched@lakemont.example", "ECCC": "sched@ellerycourt.example"}
ORG_NAME = {"HPMC": "Harbor Point Medical Center", "LKSU": "Lakemont State University", "ECCC": "Ellery County Circuit Court"}
RATE = {"HPMC": "97.50", "LKSU": "86.25", "ECCC": "110.00"}
SETTING_OF = {"HPMC": "medical", "LKSU": "education", "ECCC": "legal"}
SETTING_LABEL = {"medical": "Medical", "education": "Education", "legal": "Legal"}
INTERPRETERS = {
    "rosa": ("rosa@interpreters.example", "Rosa D."),
    "theo": ("theo@interpreters.example", "Theo M."),
    "kemi": ("kemi@interpreters.example", "Kemi A."),
    "wren": ("wren@interpreters.example", "Wren C."),
    "malik": ("malik@interpreters.example", "Malik O."),
    "ines": ("ines@interpreters.example", "Ines P."),
}
NIC_HOLDERS = ("rosa", "theo", "kemi", "ines")
ROSA_PRIVATE = ("(555) 010-0141", "North Halden", "58.00")
LABEL = {"draft": "Draft", "submitted": "Open seat", "half-staffed": "Half-staffed", "staffed": "Staffed",
         "completed": "Completed", "invoiced": "Invoiced", "cancelled_early": "Cancelled",
         "cancelled_late": "Cancelled (late fee)"}
CANCELLABLE = ("draft", "submitted", "half-staffed", "staffed")
CSV_HEADER = "reference,organisation,kind,billable_minutes,seats,hourly_rate,amount,billing_status,killbill_invoice_id,created_at"
EXTERNAL_CHARGE = "EXTERNAL_CHARGE"
CHARGE_DESCRIPTION = {"interpreting": "{reference} interpreting",
                      "late_cancellation": "{reference} late cancellation"}
STORAGE_COPY = "Certificate storage is unreachable. Nothing was saved or opened; try again in a few minutes."
SEAT_ITEM = "Seat {label}: {state}"
SEAT_COUNTER = "{confirmed}/{team}"
CLAIM_PENDING = "Claiming seat {label}…"
CLAIM_WON = "Seat {label} confirmed. Consumer details are now shown below."
CLAIM_TAKEN = "Seat taken: another interpreter confirmed seat {label} first."
CLAIM_CREDENTIAL = "Your {credential} credential isn't verified through this job's date."
CRED_VIEW = "View file for {name} {type}"
CRED_EXPIRY = "Expiry date for {name} {type}"
CRED_VERIFY = "Verify {name} {type}"
SESSION_COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax")

BASE_FIELDS = {"id", "reference", "setting", "required_credential", "starts_at", "ends_at", "duration_minutes",
               "city", "status", "team_size", "rotation_minutes", "seats"}
CLIENT_EXTRA = {"organisation", "free_cancel_until", "consumer_name", "location_address", "notes", "hourly_rate",
                "actual_minutes"}
STAFF_EXTRA = CLIENT_EXTRA | {"team_reason", "history"}
PRIVATE = {"consumer_name", "location_address", "notes"}
SEAT_FIELDS = {"id", "label", "status", "interpreter"}
STAFF_INTERPRETER = {"id", "display_name", "full_name", "email", "phone", "home_area", "pay_rate", "credentials"}
CLIENT_INTERPRETER = {"display_name", "credentials"}
HOLDER_INTERPRETER = {"display_name", "credentials", "phone"}
USER_FIELDS = {"id", "role", "display_name", "email", "organisation"}
QUOTE_FIELDS = {"kind", "fee", "free_cancel_until", "billable_minutes", "seats_charged", "hourly_rate"}
INVOICE_FIELDS = {"id", "request_reference", "organisation", "kind", "billable_minutes", "seats", "hourly_rate",
                  "amount", "billing_status", "killbill_invoice_id", "created_at"}
CREDENTIAL_FIELDS = {"id", "credential_type", "status", "expires_on", "uploaded_at", "file_name"}

KILLBILL_DOWN_ENV = "APP_KILLBILL_DOWN_URL"
MINIO_DOWN_ENV = "APP_MINIO_DOWN_URL"

PEOPLE = {
    "coordinator": ("coord@crosshand.example", "coordinator", "Priya Velasco", None),
    "billing": ("billing@crosshand.example", "billing_admin", "Morgan Reyes-Hall", None),
    "harbor": ("sched@harborpoint.example", "client_scheduler", "Jordan Baptiste", "HPMC"),
    "lakemont": ("sched@lakemont.example", "client_scheduler", "Avery Lindqvist", "LKSU"),
    "ellery": ("sched@ellerycourt.example", "client_scheduler", "Sam Whitfield", "ECCC"),
    "rosa": ("rosa@interpreters.example", "interpreter", "Rosa D.", None),
    "theo": ("theo@interpreters.example", "interpreter", "Theo M.", None),
    "kemi": ("kemi@interpreters.example", "interpreter", "Kemi A.", None),
    "wren": ("wren@interpreters.example", "interpreter", "Wren C.", None),
    "malik": ("malik@interpreters.example", "interpreter", "Malik O.", None),
    "ines": ("ines@interpreters.example", "interpreter", "Ines P.", None),
}
HOME = {"coordinator": "/board", "interpreter": "/open-seats", "client_scheduler": "/requests", "billing_admin": "/billing"}
NAV = {"coordinator": ("Week board", "Credentials"), "interpreter": ("Open seats", "My assignments", "Profile"),
       "client_scheduler": ("Requests", "New request", "Invoices"), "billing_admin": ("Billing", "Invoices")}
GRANTED = {"coordinator": ("/api/requests", "/api/credentials"),
           "billing_admin": ("/api/requests", "/api/invoices"),
           "client_scheduler": ("/api/requests", "/api/invoices"),
           "interpreter": ("/api/open-seats", "/api/assignments", "/api/me/credentials")}
DENIED = {"coordinator": ("/api/invoices", "/api/open-seats", "/api/me/credentials"),
          "billing_admin": ("/api/credentials", "/api/open-seats", "/api/assignments"),
          "client_scheduler": ("/api/credentials", "/api/open-seats", "/api/me/credentials"),
          "interpreter": ("/api/requests", "/api/invoices", "/api/credentials")}

VIEWPORTS = {
    "375x812": (375, 812),
    "768x1024": (768, 1024),
    "1280x800": (1280, 800),
}
DESKTOP = {"width": 1280, "height": 800}

CHARGE_CASE_IDS = ("cr1006-team", "cr1007-solo", "half-up")
CHARGE_CASES = {
    "cr1006-team": ("LKSU", 2, CR1006_ACTUAL, CR1006_AMOUNT),
    "cr1007-solo": ("ECCC", 1, CR1007_ACTUAL, CR1007_AMOUNT),
    "half-up": ("HPMC", 1, MIN_BILLABLE + 1, None),
}


HTTP_TIMEOUT_S = 60
UI_WAIT_S = 20
MAIL_WAIT_S = 45
POLL_S = 0.5
STEP_MS = 250
SHORT_MS = 400
POST_MARGIN_S = 25
TAB_LIMIT = 300
FILL_STEPS = 400
FILL_TICK_MS = 10
NPM_TIMEOUT_S = 300
SCAN_MAX_BYTES = 6000000
UI_TIMEOUT_MS = UI_WAIT_S * 1000


FAR_FIRST = date(2027, 1, 4)
FAR_SPAN_DAYS = 1400
SLOT_HOURS = (5, 9, 13, 17)
NEAR_LEAD_H = 26
NEAR_STEP_H = 2
NOW_PROBE_START = datetime(2030, 6, 3, 9, 0)
SKIPPED_START = "2027-03-14T02:30"
REPEATED_START = "2027-11-07T01:30"
CUTOFF_SKIPPED_START = datetime(2027, 3, 16, 2, 30)
CUTOFF_REPEATED_START = datetime(2027, 11, 9, 1, 30)
RENEWAL_FLOOR = date(2031, 1, 6)
RENEWAL_JITTER_DAYS = 28
LATE_EVENING = dtime(21, 0)
FOREIGN_ORIGIN = "http://elsewhere.example"
TRAVERSAL_NAME = "../../etc/evil.svg"
BROWSER_ZONE = "Asia/Tokyo"
NEVER_SERVED = ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json",
                "/src/server.ts", "/.git/config", "/node_modules/.package-lock.json")
PDF = b"%PDF-1.4\n"
PNG = b"\x89PNG\r\n\x1a\n"
JPEG = b"\xff\xd8\xff\xe0"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML = b"<!doctype html><script>alert(1)</script>"
ZIP = b"PK\x03\x04archive"
BANNED_STORES = ("sqlite3", "better-sqlite3", "sqlite", "sql.js", "redis", "ioredis", "lowdb", "nedb", "level",
                 "leveldown", "lmdb", "pouchdb", "lokijs", "node-persist", "pg-mem", "@electric-sql/pglite")
LOCAL_DB_SUFFIXES = (".sqlite", ".sqlite3", ".db")
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
FONTS = ("Archivo", "IBM Plex Sans", "IBM Plex Mono")

JSON_HEADERS = {"Content-Type": "application/json"}
CLAIM_GLOB = "**/api/seats/*/claim"
CLOSE_GLOB = "**/api/requests/*/close"
BROADCAST_GLOB = "**/api/requests/*/broadcast"

RECORDER = """() => {
  if (window.__motion) return;
  window.__motion = [];
  const keep = (a) => { if (!window.__motion.includes(a)) { window.__motion.push(a); a.pause(); } };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = animate.apply(this, args); keep(a); return a; };
  for (const type of ['transitionrun', 'animationstart']) {
    document.addEventListener(type, (e) => { for (const a of e.target.getAnimations()) keep(a); }, true);
  }
}"""
MOTION_REPORT = """(target) => (window.__motion || []).filter((a) => a.effect && a.effect.target &&
  (a.effect.target.contains(target) || target.contains(a.effect.target))).map((a) => {
  const timing = a.effect.getComputedTiming();
  const end = Number.isFinite(timing.endTime) ? timing.endTime : -1;
  const iterations = Number.isFinite(timing.iterations) ? timing.iterations : -1;
  a.currentTime = 0; const start = target.getBoundingClientRect().x;
  if (end >= 0) a.currentTime = end;
  const finish = target.getBoundingClientRect().x;
  return {end, iterations, start, finish};
})"""
RELEASE_MOTION = "() => { for (const a of window.__motion || []) { try { a.finish(); } catch (e) { a.play(); } } window.__motion = []; }"
LOOPING = "() => document.getAnimations().filter((a) => !Number.isFinite(a.effect.getComputedTiming().iterations)).length"
SLIDER_STATE = """(el) => ({
  value: Number(el.getAttribute('aria-valuenow') ?? el.value),
  min: Number(el.getAttribute('aria-valuemin') ?? el.min),
  max: Number(el.getAttribute('aria-valuemax') ?? el.max),
  text: el.getAttribute('aria-valuetext')
})"""
STRUCK = """(el) => { for (let n = el; n; n = n.parentElement) {
  if (getComputedStyle(n).textDecorationLine.includes('line-through')) return true;
  if (n.getAttribute('role') === 'button' || n.tagName === 'BUTTON' || n.tagName === 'TR') break; } return false; }"""

_RNG = random.SystemRandom()
_USED: set[tuple[date, int]] = set()
_NEAR: list[int] = []
_CLIENTS: dict[tuple[str, str], httpx.Client] = {}
_PAUSE = threading.Event()
CREATED: list[str] = []


def _cm(obj: Any) -> Any:
    if hasattr(obj, "__enter__"):
        return obj

    @contextlib.contextmanager
    def wrap() -> Any:
        yield from obj

    return wrap()


def app_page(browser: Any, base: str, path: str = "/signin", **options: Any) -> Any:
    return _cm(open_app(browser, f"{base}{path}", **options))


def hold(page: Page, glob: str) -> Any:
    return _cm(held(page, glob))


def tag() -> str:
    name, _ = unique("cr")
    return re.sub(r"[^A-Za-z0-9]", "", name)[-20:]


def login(base: str, email: str) -> httpx.Client:
    client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    r = client.post("/api/session", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return client


def api(base: str, email: str | None = None) -> httpx.Client:
    if email is None:
        return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    key = (base, email)
    if key not in _CLIENTS:
        _CLIENTS[key] = login(base, email)
    return _CLIENTS[key]


def poll(fetch: Callable[[], Any], ok: Callable[[Any], bool], seconds: float = UI_WAIT_S) -> Any:
    deadline = monotonic() + seconds
    while True:
        value = fetch()
        if ok(value):
            return value
        assert monotonic() < deadline, f"condition not met before deadline; last value: {str(value)[:1500]}"
        _PAUSE.wait(POLL_S)


def eventually(page: Page, check_fn: Callable[[], None], seconds: float = UI_WAIT_S, step_ms: float = STEP_MS) -> None:
    deadline = monotonic() + seconds
    while True:
        try:
            check_fn()
            return
        except AssertionError:
            if monotonic() > deadline:
                raise
            advance(page, step_ms)


def assert_error(r: httpx.Response, status_code: int, code: str) -> dict[str, Any]:
    assert r.status_code == status_code, f"expected {status_code} {code}, got {r.status_code}: {r.text[:800]}"
    payload = r.json()
    assert set(payload) == {"error"}, payload
    error = payload["error"]
    assert error["code"] == code, payload
    assert isinstance(error["message"], str) and error["message"], payload
    return error


def assert_not_found(r: httpx.Response) -> None:
    assert r.status_code == 404, r.text[:800]
    assert r.json() == NOT_FOUND


def padded_json(size: int) -> bytes:
    skeleton = '{"notes":""}'
    return (skeleton[:-2] + "x" * (size - len(skeleton)) + '"}').encode()


def clock(t: datetime) -> str:
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def mon_d(t: date | datetime) -> str:
    return f"{t:%b} {t.day}"


def weekday(t: date | datetime) -> str:
    return f"{t:%a}"


def long_date(d: date) -> str:
    return f"{d:%b} {d.day}, {d.year}"


def monday(t: datetime) -> date:
    return t.date() - timedelta(days=t.weekday())


def agency_iso(local: datetime) -> str:
    return local.replace(tzinfo=AGENCY, fold=0).isoformat()


def local_start(req: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(req["starts_at"]).astimezone(AGENCY).replace(tzinfo=None)


def cutoff_instant(start: datetime) -> datetime:
    local = datetime.combine(start.date() - timedelta(days=2), start.time())
    aware = local.replace(tzinfo=AGENCY, fold=0)
    if aware.astimezone(timezone.utc).astimezone(AGENCY).replace(tzinfo=None) != local:
        aware = local.replace(minute=0, tzinfo=AGENCY, fold=0).astimezone(timezone.utc).astimezone(AGENCY)
    return aware


def cutoff_text(instant: datetime) -> str:
    local = instant.astimezone(AGENCY)
    return f"{weekday(local)}, {mon_d(local)}, {clock(local)} {local.tzname()}"


def charge(minutes: int, rate: str, seats: int) -> tuple[int, str]:
    billable = max(MIN_BILLABLE, -(-minutes // INCREMENT) * INCREMENT)
    amount = (Decimal(billable) * Decimal(rate) * seats / MINUTES_PER_HOUR).quantize(Decimal("0.01"), ROUND_HALF_UP)
    return billable, f"{amount}"


def _clock_change(day: date) -> bool:
    first = datetime(day.year, day.month, day.day, tzinfo=AGENCY).utcoffset()
    last = datetime.combine(day, dtime(23, 59), tzinfo=AGENCY).utcoffset()
    return first != last


def far_start() -> datetime:
    while True:
        day = FAR_FIRST + timedelta(days=_RNG.randrange(FAR_SPAN_DAYS))
        hour = _RNG.choice(SLOT_HOURS)
        if (day, hour) in _USED or _clock_change(day):
            continue
        _USED.add((day, hour))
        return datetime(day.year, day.month, day.day, hour)


def server_now(base: str) -> datetime:
    draft = create(base, "HPMC", NOW_PROBE_START, SOLO_MAX_MINUTES)
    entries = read(base, draft["id"])["history"]
    return datetime.fromisoformat(next(h["at"] for h in entries if h["action"] == "created"))


def agency_today(base: str) -> date:
    return server_now(base).astimezone(AGENCY).date()


def near_start(base: str) -> datetime:
    now = server_now(base).astimezone(timezone.utc)
    step = len(_NEAR)
    _NEAR.append(step)
    instant = (now + timedelta(hours=NEAR_LEAD_H + NEAR_STEP_H * step)).replace(minute=0, second=0, microsecond=0)
    instant += timedelta(hours=1)
    local = instant.astimezone(AGENCY)
    if local.fold:
        local = (instant + timedelta(hours=1)).astimezone(AGENCY)
    return local.replace(tzinfo=None)


def request_body(org: str, start: datetime, minutes: int, **overrides: Any) -> dict[str, Any]:
    t = tag()
    body: dict[str, Any] = {"setting": SETTING_OF[org], "starts_at": start.strftime("%Y-%m-%dT%H:%M"),
                            "duration_minutes": minutes, "consumer_name": f"Consumer {t}",
                            "location_address": f"{t} Quay Street", "city": f"Town{t}",
                            "notes": f"Brief {t}"}
    body.update(overrides)
    return body


def create(base: str, org: str, start: datetime, minutes: int, **overrides: Any) -> dict[str, Any]:
    r = api(base, SCHEDULER[org]).post("/api/requests", json=request_body(org, start, minutes, **overrides))
    assert r.status_code == 201, r.text
    created = r.json()
    CREATED.append(created["id"])
    return created


def submit(base: str, org: str, req: dict[str, Any]) -> dict[str, Any]:
    r = api(base, SCHEDULER[org]).post(f"/api/requests/{req['id']}/submit", json={})
    assert r.status_code == 200, r.text
    return r.json()


def read(base: str, rid: str, email: str = COORDINATOR) -> dict[str, Any]:
    r = api(base, email).get(f"/api/requests/{rid}")
    assert r.status_code == 200, r.text
    return r.json()


def seat_of(req: dict[str, Any], label: str) -> dict[str, Any]:
    return next(s for s in req["seats"] if s["label"] == label)


def claim(base: str, who: str, seat_id: str) -> httpx.Response:
    return api(base, INTERPRETERS[who][0]).post(f"/api/seats/{seat_id}/claim", json={})


def open_job(base: str, org: str = "HPMC", minutes: int = MIN_BILLABLE, start: datetime | None = None,
             claims: tuple[tuple[str, str], ...] | list[tuple[str, str]] = (), **overrides: Any) -> dict[str, Any]:
    req = submit(base, org, create(base, org, start or far_start(), minutes, **overrides))
    for label, who in claims:
        r = claim(base, who, seat_of(req, label)["id"])
        assert r.status_code == 200, r.text
    return read(base, req["id"])


def staffing(base: str, rid: str, body: dict[str, Any]) -> httpx.Response:
    return api(base, COORDINATOR).patch(f"/api/requests/{rid}/staffing", json=body)


def complete(base: str, rid: str, minutes: int) -> dict[str, Any]:
    r = api(base, COORDINATOR).post(f"/api/requests/{rid}/complete", json={"actual_minutes": minutes})
    assert r.status_code == 200, r.text
    return r.json()


def close(base: str, rid: str, key: str | None = None, email: str = BILLING) -> httpx.Response:
    return api(base, email).post(f"/api/requests/{rid}/close", json={},
                                 headers={"Idempotency-Key": key or idempotency_key()})


def quote(base: str, rid: str, email: str) -> httpx.Response:
    return api(base, email).get(f"/api/requests/{rid}/cancellation-quote")


def cancel(base: str, rid: str, fee: str, email: str, key: str | None = None) -> httpx.Response:
    return api(base, email).post(f"/api/requests/{rid}/cancel", json={"expected_fee": fee},
                                 headers={"Idempotency-Key": key or idempotency_key()})


def history(base: str, rid: str, action: str) -> list[dict[str, Any]]:
    return [h for h in read(base, rid)["history"] if h["action"] == action]


def invoices(base: str, email: str, q: str) -> list[dict[str, Any]]:
    r = api(base, email).get("/api/invoices", params={"q": q})
    assert r.status_code == 200, r.text
    return r.json()["invoices"]


def invoice_for(base: str, ref: str, kind: str = "interpreting", email: str = BILLING) -> list[dict[str, Any]]:
    return [i for i in invoices(base, email, ref) if i["request_reference"] == ref and i["kind"] == kind]


def posted_invoice(base: str, ref: str, kind: str = "interpreting") -> dict[str, Any]:
    found = poll(lambda: invoice_for(base, ref, kind),
                 lambda rows: len(rows) == 1 and rows[0]["billing_status"] == "posted",
                 seconds=POST_WITHIN_S + POST_MARGIN_S)
    assert found[0]["killbill_invoice_id"]
    return found[0]


def solo_completed(base: str, org: str, minutes: int, actual: int, who: str, **overrides: Any) -> dict[str, Any]:
    req = open_job(base, org, minutes, claims=[("A", who)], **overrides)
    return complete(base, req["id"], actual)


def concurrent(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))
    results: dict[int, httpx.Response] = {}

    def go(index: int) -> None:
        barrier.wait()
        results[index] = calls[index]()

    threads = [threading.Thread(target=go, args=(i,)) for i in range(len(calls))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_TIMEOUT_S)
    assert len(results) == len(calls)
    return [results[i] for i in range(len(calls))]


def race(base: str, contenders: tuple[str, ...] | list[str], seat_id: str) -> dict[str, httpx.Response]:
    clients = {who: api(base, INTERPRETERS[who][0]) for who in contenders}
    calls = [lambda c=clients[who]: c.post(f"/api/seats/{seat_id}/claim", json={}) for who in contenders]
    return dict(zip(contenders, concurrent(calls)))


def subject(message: dict[str, Any]) -> str:
    return message.get("Subject") or ""


def recipients(message: dict[str, Any]) -> list[str]:
    return [a.lower() for a in addresses(message.get("To"))]


def mails_for(mail: Any, predicate: Callable[[dict[str, Any]], bool], count: int = 1,
              seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = monotonic() + seconds
    while True:
        found = [m for m in mail.messages() if predicate(m)]
        if len(found) >= count or monotonic() > deadline:
            return found


def by_subject(value: str) -> Callable[[dict[str, Any]], bool]:
    return lambda m: subject(m) == value


def assert_private_absent(message: dict[str, Any], req_or_body: dict[str, Any]) -> None:
    blob = subject(message) + "\n" + text(message)
    for field in ("consumer_name", "location_address", "notes"):
        value = req_or_body.get(field)
        if value:
            assert value not in blob, f"{field} leaked into email {subject(message)!r}"


def stored(*needles: tuple[str, ...]) -> list[str]:
    db = Postgres()
    hits: list[str] = []
    for table in db.tables():
        ident = ".".join('"' + part.replace('"', '""') + '"' for part in table.split("."))
        for row in db.rows(f"SELECT to_jsonb(t)::text AS r FROM {ident} t"):
            blob = row["r"] if isinstance(row["r"], str) else json.dumps(row["r"])
            if all(any(n in blob for n in alternatives) for alternatives in needles):
                hits.append(blob)
    return hits


def cents(amount: str) -> str:
    return str(int(Decimal(amount) * 100))


def assert_account(killbill: Any, org: str) -> None:
    account = poll(lambda: killbill.account_by_key(f"crosshand-{org}"), lambda a: a is not None,
                   seconds=POST_WITHIN_S + POST_MARGIN_S)
    assert account.get("name") == ORG_NAME[org], account
    assert account.get("currency") == "USD", account


def charge_items(killbill: Any, org: str, reference: str) -> list[dict[str, Any]]:
    account = killbill.account_by_key(f"crosshand-{org}")
    if not account:
        return []
    r = killbill.client.get(f"/accounts/{account['accountId']}/invoices",
                            params={"includeInvoiceComponents": "true"})
    assert r.status_code == 200, r.text
    return [item for inv in r.json() for item in (inv.get("items") or [])
            if item.get("itemType") == EXTERNAL_CHARGE
            and str(item.get("description") or "").startswith(reference)]


def assert_charge_item(killbill: Any, org: str, reference: str, amount: str, kind: str, invoice_id: str) -> None:
    found = poll(lambda: charge_items(killbill, org, reference), lambda items: len(items) == 1,
                 seconds=POST_WITHIN_S + POST_MARGIN_S)
    item = found[0]
    assert item["description"] == CHARGE_DESCRIPTION[kind].format(reference=reference), item
    assert Decimal(str(item["amount"])) == Decimal(amount), item
    assert item.get("currency") == "USD", item
    assert item.get("invoiceId") == invoice_id, item


def upload(base: str, who: str, ctype: str, content: bytes, filename: str = "certificate.pdf",
           mime: str = "application/pdf") -> httpx.Response:
    return api(base, INTERPRETERS[who][0]).post("/api/me/credentials", data={"credential_type": ctype},
                                                files={"file": (filename, content, mime)})


def my_credentials(base: str, who: str) -> list[dict[str, Any]]:
    r = api(base, INTERPRETERS[who][0]).get("/api/me/credentials")
    assert r.status_code == 200, r.text
    return r.json()["credentials"]


def review_list(base: str, review_status: str) -> list[dict[str, Any]]:
    r = api(base, COORDINATOR).get("/api/credentials", params={"status": review_status})
    assert r.status_code == 200, r.text
    return r.json()["credentials"]


def interpreter_id(base: str, credential_id: str) -> str:
    return next(c["interpreter"]["id"] for c in review_list(base, "all") if c["id"] == credential_id)


def interpreter_id_of(base: str, who: str) -> str:
    name = INTERPRETERS[who][1]
    return next(c["interpreter"]["id"] for c in review_list(base, "all") if c["interpreter"]["display_name"] == name)


def open_seat_ids(base: str, who: str) -> set[str]:
    r = api(base, INTERPRETERS[who][0]).get("/api/open-seats")
    assert r.status_code == 200, r.text
    return {s["seat_id"] for s in r.json()["open_seats"]}


def assignment_seat_ids(base: str, who: str) -> set[str]:
    r = api(base, INTERPRETERS[who][0]).get("/api/assignments")
    assert r.status_code == 200, r.text
    return {s["seat_id"] for s in r.json()["assignments"]}


def latest_expiry(base: str, who: str, ctype: str) -> date:
    dates = [date.fromisoformat(c["expires_on"]) for c in my_credentials(base, who)
             if c["credential_type"] == ctype and c["expires_on"]]
    return max(dates)


def renewal_expiry(base: str, who: str = "ines", ctype: str = "NIC") -> date:
    floor = max(latest_expiry(base, who, ctype) + timedelta(days=1), RENEWAL_FLOOR)
    return floor + timedelta(days=_RNG.randrange(1, RENEWAL_JITTER_DAYS))


def verify(base: str, credential_id: str, expires_on: str) -> httpx.Response:
    return api(base, COORDINATOR).post(f"/api/credentials/{credential_id}/verify", json={"expires_on": expires_on})


def sole_awaiting(base: str, who: str, ctype: str, keep: str) -> None:
    name = INTERPRETERS[who][1]
    for c in review_list(base, "uploaded"):
        if c["id"] != keep and c["credential_type"] == ctype and c["interpreter"]["display_name"] == name:
            assert verify(base, c["id"], RENEWAL_FLOOR.isoformat()).status_code == 200, c["id"]


def segments(start: datetime, length: int, rotation: int, labels: tuple[str, ...]) -> list[tuple[datetime, datetime, str]]:
    out = []
    for k in range(-(-length // rotation)):
        seg_start = start + timedelta(minutes=k * rotation)
        seg_end = start + timedelta(minutes=min((k + 1) * rotation, length))
        active = labels[0] if len(labels) == 1 else ("A" if k % 2 == 0 else "B")
        out.append((seg_start, seg_end, active))
    return out


def lane_names(start: datetime, length: int, rotation: int, label: str, who: dict[str, str]) -> list[str]:
    labels = tuple(sorted(who))
    return [f"{clock(s)} to {clock(e)}, {'active' if active == label else 'support'}, {who[label]}"
            for s, e, active in segments(start, length, rotation, labels)]


def readout(start: datetime, length: int, rotation: int, minute: int, who: dict[str, str]) -> str:
    segs = segments(start, length, rotation, tuple(sorted(who)))
    k = min(minute // rotation, len(segs) - 1)
    active = segs[k][2]
    head = f"{clock(start + timedelta(minutes=minute))} · Active: Seat {active}, {who[active]}"
    if len(who) == 1:
        return f"{head} · Support: none"
    support = "B" if active == "A" else "A"
    return f"{head} · Support: Seat {support}, {who[support]}"


def item_names(locator: Any) -> list[str]:
    snapshot = locator.aria_snapshot()
    return [n.replace('\\"', '"') for n in re.findall(r'- listitem "((?:[^"\\]|\\.)*)"', snapshot)]


def sign_in(page: Page, base: str, email: str) -> None:
    if "/signin" not in page.url:
        page.goto(f"{base}/signin")
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password", exact=True), PASSWORD)
    click(page.get_by_role("button", name="Sign in"))
    page.wait_for_url(lambda url: "/signin" not in url, timeout=UI_TIMEOUT_MS)


def board_url(base: str, start: datetime, job: str | None = None) -> str:
    url = f"{base}/board?week={monday(start).isoformat()}"
    return f"{url}&job={job}" if job else url


def board_row(page: Page, ref: str) -> Any:
    return page.get_by_role("button", name=re.compile(r"^" + re.escape(ref) + r", "))


def row_name(req: dict[str, Any], start: datetime, org: str, req_status: str, confirmed: int, team: int) -> str:
    return f"{req['reference']}, {clock(start)}, {ORG_NAME[org]}, {LABEL[req_status]}, {confirmed} of {team} seats"


def lane(page: Page, label: str) -> Any:
    return page.get_by_role("group", name="Rotation braid").get_by_role("list", name=f"Seat {label} lane")


def status(page: Page, name: str) -> Any:
    return page.get_by_role("status", name=name)


def job_pane(page: Page) -> Any:
    return page.get_by_role("region", name="Job detail")


def motion_report(locator: Any) -> list[dict[str, float]]:
    return locator.evaluate(MOTION_REPORT)


def durations_ms(value: str) -> list[float]:
    out = []
    for part in value.split(","):
        part = part.strip()
        out.append(float(part[:-2]) if part.endswith("ms") else float(part[:-1]) * 1000)
    return out


def fill_progress(page: Page, label: str, name: str) -> list[list[bool]]:
    observed: list[list[bool]] = []
    for _ in range(FILL_STEPS):
        flags = [n.endswith(f", {name}") for n in item_names(lane(page, label))]
        observed.append(flags)
        if flags and all(flags):
            return observed
        advance(page, FILL_TICK_MS)
    return observed


def csv_rows(payload: bytes) -> list[list[str]]:
    body = payload.decode("utf-8")
    assert body.startswith(CSV_HEADER + "\r\n"), body[:300]
    assert "\n" not in body.replace("\r\n", ""), "lines must end in CRLF"
    return list(csv.reader(io.StringIO(body, newline="")))


@pytest.fixture(autouse=True)
def _release_bookings(app_url: str) -> Any:
    first = len(CREATED)
    yield
    ids = CREATED[first:]
    del CREATED[first:]
    for rid in ids:
        with contextlib.suppress(Exception):
            current = api(app_url, COORDINATOR).get(f"/api/requests/{rid}")
            if current.status_code != 200 or current.json()["status"] not in CANCELLABLE:
                continue
            fee = quote(app_url, rid, COORDINATOR).json()["fee"]
            cancel(app_url, rid, fee, COORDINATOR)


def test_health_endpoint(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"status": "ok"}


@pytest.mark.parametrize("person", list(PEOPLE), ids=list(PEOPLE))
def test_seeded_sign_in(browser: Any, app_url: str, person: str) -> None:
    email, role, display, org = PEOPLE[person]
    client = api(app_url)
    assert_error(client.post("/api/session", json={"email": email, "password": PASSWORD + "x"}), 401,
                 "invalid_credentials")
    assert_error(client.get("/api/me"), 401, "unauthenticated")
    ok = client.post("/api/session", json={"email": email, "password": PASSWORD})
    assert ok.status_code == 200, ok.text
    cookie = " ".join(ok.headers.get_list("set-cookie")).lower()
    assert all(flag.lower() in cookie for flag in SESSION_COOKIE_FLAGS)
    user = ok.json()["user"]
    assert set(user) == USER_FIELDS
    assert (user["role"], user["display_name"], user["email"]) == (role, display, email)
    if org:
        assert user["organisation"]["code"] == org and user["organisation"]["name"] == ORG_NAME[org]
    else:
        assert user["organisation"] is None
    assert client.get("/api/me").json()["user"]["id"] == user["id"]
    for path in GRANTED[role]:
        assert client.get(path).status_code == 200, path
    for path in DENIED[role]:
        assert_error(client.get(path), 403, "forbidden")
    if role != "client_scheduler":
        assert_error(client.post("/api/requests", json={}), 403, "forbidden")
    assert client.delete("/api/session").status_code == 204
    assert_error(client.get("/api/me"), 401, "unauthenticated")

    home = HOME[role]
    with app_page(browser, app_url, home) as page:
        page.set_viewport_size(DESKTOP)
        page.wait_for_url(re.compile(r"/signin"), timeout=UI_TIMEOUT_MS)
        email_box = page.get_by_role("textbox", name="Email")
        password_box = page.get_by_label("Password", exact=True)
        fill(email_box, email)
        fill(password_box, PASSWORD + "x")
        click(page.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("alert", name="Sign-in error")).to_contain_text("Email or password is incorrect.")
        expect(email_box).to_have_value(email)
        expect(password_box).to_have_value(PASSWORD + "x")
        fill(password_box, PASSWORD)
        password_box.press("Enter")
        page.wait_for_url(re.compile(re.escape(home) + r"(\?|$)"), timeout=UI_TIMEOUT_MS)
        nav = page.get_by_role("navigation", name="Main")
        for link in NAV[role]:
            expect(nav.get_by_role("link", name=link, exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()
        expect(page.get_by_text(display, exact=True).first).to_be_visible()
        page.goto(f"{app_url}/")
        page.wait_for_url(re.compile(re.escape(home) + r"(\?|$)"), timeout=UI_TIMEOUT_MS)


def test_error_shape_and_precedence(app_url: str) -> None:
    anon = api(app_url)
    assert_error(anon.get("/api/requests"), 401, "unauthenticated")
    assert_error(anon.post("/api/requests", content=padded_json(JSON_LIMIT + 1), headers=JSON_HEADERS), 413,
                 "payload_too_large")
    missing = f"/api/requests/missing{tag()}"
    assert_error(anon.get(missing), 401, "unauthenticated")
    coordinator = api(app_url, COORDINATOR)
    assert_not_found(coordinator.get(missing))
    lakemont = api(app_url, SCHEDULER["LKSU"])
    assert_not_found(lakemont.patch(f"{missing}/staffing", json={"rotation_minutes": ROTATION_MIN}))
    draft = create(app_url, "HPMC", far_start(), SOLO_MAX_MINUTES)
    harbor = api(app_url, SCHEDULER["HPMC"])
    assert_error(harbor.patch(f"/api/requests/{draft['id']}/staffing", json={"rotation_minutes": 1}), 403,
                 "forbidden")
    assert_error(coordinator.patch(f"/api/requests/{draft['id']}/staffing", json={"rotation_minutes": 1}), 409,
                 "invalid_transition")
    assert_error(coordinator.post("/api/requests", json={}), 403, "forbidden")
    error = assert_error(harbor.post("/api/requests", json={}), 422, "validation")
    assert isinstance(error["fields"], dict) and error["fields"]
    assert all(isinstance(v, str) and v for v in error["fields"].values())
    assert_not_found(harbor.post(f"{missing}/submit", json={}))


def test_server_boundary(app_url: str) -> None:
    harbor = api(app_url, SCHEDULER["HPMC"])
    body = request_body("HPMC", far_start(), SOLO_MAX_MINUTES)
    r = harbor.post("/api/requests", json=body, headers={"Origin": FOREIGN_ORIGIN})
    assert_error(r, 403, "forbidden")
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
    r = harbor.get("/api/requests", headers={"Origin": FOREIGN_ORIGIN})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
    assert_error(harbor.post("/api/requests", content=json.dumps(body).encode(), headers={"Content-Type": "text/plain"}),
                 415, "unsupported_type")
    assert harbor.get("/api/requests", params={"q": body["consumer_name"]}).json()["requests"] == []
    assert_error(harbor.post("/api/requests", content=padded_json(JSON_LIMIT + 1), headers=JSON_HEADERS), 413,
                 "payload_too_large")
    assert_error(harbor.post("/api/requests", content=padded_json(JSON_LIMIT), headers=JSON_HEADERS), 422,
                 "validation")
    for path in NEVER_SERVED:
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT_S).status_code == 404, path
    for env in (KILLBILL_DOWN_ENV, MINIO_DOWN_ENV):
        base = os.environ[env]
        health = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S)
        assert health.status_code == 200 and health.json() == {"status": "ok"}
        assert api(base, COORDINATOR).get("/api/requests").status_code == 200


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_three_viewports(browser: Any, app_url: str, viewport: str) -> None:
    width, height = VIEWPORTS[viewport]
    start = far_start()
    req = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    screens = {
        COORDINATOR: [board_url(app_url, start), board_url(app_url, start, req["id"]), f"{app_url}/credentials"],
        INTERPRETERS["ines"][0]: [f"{app_url}/open-seats", f"{app_url}/assignments", f"{app_url}/profile",
                                  f"{app_url}/jobs/{req['id']}"],
        SCHEDULER["HPMC"]: [f"{app_url}/requests", f"{app_url}/requests/new", f"{app_url}/requests/{req['id']}",
                            f"{app_url}/invoices"],
        BILLING: [f"{app_url}/billing", f"{app_url}/invoices"],
    }
    for email, urls in screens.items():
        with app_page(browser, app_url) as page:
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_load_state("networkidle")
            layout(page)
            sign_in(page, app_url, email)
            menu = page.get_by_role("button", name="Menu")
            if width == VIEWPORTS["375x812"][0]:
                click(menu)
                expect(page.get_by_role("navigation", name="Main").get_by_role("link").first).to_be_visible()
            elif width == VIEWPORTS["1280x800"][0]:
                expect(menu).to_be_hidden()
            for url in urls:
                page.goto(url)
                page.wait_for_load_state("networkidle")
                layout(page)
            if email != COORDINATOR:
                continue
            page.goto(board_url(app_url, start))
            row = board_row(page, req["reference"])
            expect(row).to_have_count(1)
            row.scroll_into_view_if_needed()
            row_box = row.bounding_box()
            counter = SEAT_COUNTER.format(confirmed=0, team=2)
            for part in (row.get_by_text("Open seat", exact=True), row.get_by_text(counter, exact=True)):
                box = part.first.bounding_box()
                assert box and row_box
                assert box["x"] + box["width"] - row_box["x"] <= ROW_LEAD_PX
            page.goto(board_url(app_url, start, req["id"]))
            pane = job_pane(page)
            expect(pane).to_be_visible()
            settle(pane)
            settled = pane.bounding_box()
            column = width / GRID_COLUMNS
            if width == VIEWPORTS["1280x800"][0]:
                assert settled["x"] >= width - (PANE_COLUMNS_WIDE + 1) * column
                expect(page.get_by_role("region", name="Week board")).to_be_visible()
            elif width == VIEWPORTS["768x1024"][0]:
                assert width - (PANE_COLUMNS_MID + 1) * column <= settled["x"] <= width - (PANE_COLUMNS_MID - 1) * column
            else:
                assert settled["x"] <= column and settled["width"] >= width - column
                expect(pane.get_by_role("button", name="Close job detail")).to_be_visible()


def test_motion_timing_and_reduced_motion(browser: Any, app_url: str) -> None:
    start = far_start()
    req = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    draft = create(app_url, "HPMC", far_start(), SOLO_MAX_MINUTES)
    for mode in ("no-preference", "reduce"):
        limit_pane = PANE_MAX_MS if mode == "no-preference" else INSTANT_MS
        limit_dialog = DIALOG_MAX_MS if mode == "no-preference" else INSTANT_MS
        with app_page(browser, app_url, reduced_motion=mode) as page:
            page.set_viewport_size(DESKTOP)
            sign_in(page, app_url, COORDINATOR)
            page.goto(board_url(app_url, start))
            row = board_row(page, req["reference"])
            expect(row).to_be_visible()
            for value in durations_ms(style(row, "transition-duration")["transition-duration"]):
                assert value <= HOVER_MAX_MS
            page.evaluate(RECORDER)
            click(row)
            pane = job_pane(page)
            expect(pane).to_be_visible()
            if mode == "no-preference":
                until(page, "() => (window.__motion || []).length > 0")
            report = motion_report(pane)
            for item in report:
                assert 0 <= item["end"] <= limit_pane, report
                assert item["iterations"] >= 0, report
            if mode == "no-preference":
                assert any(item["start"] > item["finish"] for item in report), report
            for value in durations_ms(style(pane, "transition-duration")["transition-duration"]):
                assert value <= limit_pane
            page.evaluate(RELEASE_MOTION)
            assert page.evaluate(LOOPING) == 0

        with app_page(browser, app_url, reduced_motion=mode) as page:
            page.set_viewport_size(DESKTOP)
            sign_in(page, app_url, SCHEDULER["HPMC"])
            page.goto(f"{app_url}/requests/{draft['id']}")
            opener = page.get_by_role("button", name="Cancel booking")
            expect(opener).to_be_visible()
            page.evaluate(RECORDER)
            click(opener)
            dialog = page.get_by_role("dialog", name="Cancel booking")
            expect(dialog).to_be_visible()
            for item in motion_report(dialog):
                assert 0 <= item["end"] <= limit_dialog
            page.evaluate(RELEASE_MOTION)
            assert page.evaluate(LOOPING) == 0
    assert read(app_url, draft["id"])["status"] == "draft"


def test_wf_cross_cutting_keyboard_pane(browser: Any, app_url: str) -> None:
    start = far_start()
    req = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, COORDINATOR)
        page.goto(board_url(app_url, start))
        row = board_row(page, req["reference"])
        expect(row).to_be_visible()
        names = tab_order(page, TAB_LIMIT // 10)
        for control in ("Week board", "Previous week", "Next week", "Only jobs with an open seat"):
            assert control in names, names
        assert names.index("Previous week") < names.index("Next week"), names
        ring_props = ("outline-style", "outline-width", "outline-color", "box-shadow", "border-top-color",
                      "background-color")
        rest_style, focus_style = state_styles(row, *ring_props, state="focus")
        day = page.get_by_role("region", name=f"{weekday(start)} {mon_d(start)}")
        page.get_by_role("button", name="Previous week").focus()
        settle(day)
        at_rest = decode(capture(day))
        for _ in range(TAB_LIMIT):
            if row.evaluate("(el) => el === document.activeElement"):
                break
            page.keyboard.press("Tab")
        expect(row).to_be_focused()
        settle(day)
        if rest_style == focus_style:
            assert difference(at_rest, decode(capture(day))) > 0, "no visible focus ring on the focused row"
        page.keyboard.press("Enter")
        pane = job_pane(page)
        expect(pane).to_be_visible()
        expect(pane.get_by_role("heading", level=2, name=req["reference"])).to_be_focused()
        assert f"job={req['id']}" in page.url
        page.keyboard.press("Escape")
        advance(page, PANE_MAX_MS)
        expect(pane).to_be_hidden()
        expect(row).to_be_focused()
    assert read(app_url, req["id"])["status"] == "submitted"


def test_wf_cross_cutting_keyboard_dialog(browser: Any, app_url: str) -> None:
    draft = create(app_url, "HPMC", far_start(), SOLO_MAX_MINUTES)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, SCHEDULER["HPMC"])
        page.goto(f"{app_url}/requests/{draft['id']}")
        opener = page.get_by_role("button", name="Cancel booking")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Cancel booking")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("button", name="Keep booking")).to_be_focused()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        click(dialog.get_by_role("button", name="Keep booking"))
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
    assert read(app_url, draft["id"])["status"] == "draft"


def test_draft_requests(app_url: str) -> None:
    harbor = api(app_url, SCHEDULER["HPMC"])
    start = far_start()
    body = request_body("HPMC", start, DURATION_MIN)
    r = harbor.post("/api/requests", json=body)
    assert r.status_code == 201, r.text
    draft = r.json()
    CREATED.append(draft["id"])
    assert draft["status"] == "draft" and draft["seats"] == []
    assert draft["required_credential"] == "NIC" and draft["setting"] == "medical"
    assert draft["starts_at"] == agency_iso(start) and draft["duration_minutes"] == DURATION_MIN
    assert draft["organisation"]["code"] == "HPMC"
    assert (draft["consumer_name"], draft["location_address"], draft["city"], draft["notes"]) == \
        (body["consumer_name"], body["location_address"], body["city"], body["notes"])
    assert create(app_url, "LKSU", far_start(), SOLO_MAX_MINUTES)["required_credential"] == "EIPA"
    assert create(app_url, "ECCC", far_start(), SOLO_MAX_MINUTES)["required_credential"] == "SC:L"
    edge = request_body("HPMC", far_start(), DURATION_MAX)
    edge.pop("notes")
    edge["consumer_name"] = (edge["consumer_name"] + "x" * CONSUMER_MAX)[:CONSUMER_MAX]
    edge["location_address"] = "a" * ADDRESS_MAX
    edge["city"] = "c" * CITY_MAX
    r = harbor.post("/api/requests", json=edge)
    assert r.status_code == 201, r.text
    CREATED.append(r.json()["id"])
    long_notes = request_body("HPMC", far_start(), SOLO_MAX_MINUTES, notes="n" * NOTES_MAX)
    r = harbor.post("/api/requests", json=long_notes)
    assert r.status_code == 201, r.text
    CREATED.append(r.json()["id"])

    invalid = [
        ("setting", {"setting": "dental"}),
        ("starts_at", {"starts_at": "2020-01-06T09:00"}),
        ("starts_at", {"starts_at": "next Tuesday"}),
        ("duration_minutes", {"duration_minutes": DURATION_MIN - 1}),
        ("duration_minutes", {"duration_minutes": DURATION_MAX + 1}),
        ("consumer_name", {"consumer_name": ""}),
        ("consumer_name", {"consumer_name": "x" * (CONSUMER_MAX + 1)}),
        ("location_address", {"location_address": "a" * (ADDRESS_MAX + 1)}),
        ("city", {"city": "c" * (CITY_MAX + 1)}),
        ("notes", {"notes": "n" * (NOTES_MAX + 1)}),
        ("required_credential", {"required_credential": "ASL"}),
    ]
    for field, override in invalid:
        candidate = request_body("HPMC", far_start(), SOLO_MAX_MINUTES, **override)
        error = assert_error(harbor.post("/api/requests", json=candidate), 422, "validation")
        assert field in error["fields"], (field, error)
        if field != "consumer_name":
            assert harbor.get("/api/requests", params={"q": candidate["consumer_name"]}).json()["requests"] == []

    new_city = f"Town{tag()}"
    r = harbor.patch(f"/api/requests/{draft['id']}", json={"city": new_city, "duration_minutes": DURATION_MAX})
    assert r.status_code == 200, r.text
    assert (r.json()["city"], r.json()["duration_minutes"]) == (new_city, DURATION_MAX)
    error = assert_error(harbor.patch(f"/api/requests/{draft['id']}", json={"duration_minutes": DURATION_MAX + 1}),
                         422, "validation")
    assert "duration_minutes" in error["fields"]
    current = read(app_url, draft["id"], SCHEDULER["HPMC"])
    assert (current["city"], current["duration_minutes"], current["status"]) == (new_city, DURATION_MAX, "draft")
    submit(app_url, "HPMC", draft)
    assert_error(harbor.patch(f"/api/requests/{draft['id']}", json={"city": new_city}), 409, "invalid_transition")


def test_start_times_agency_zone(browser: Any, app_url: str) -> None:
    harbor = api(app_url, SCHEDULER["HPMC"])
    error = assert_error(harbor.post("/api/requests", json=request_body("HPMC", far_start(), SOLO_MAX_MINUTES,
                                                                         starts_at=SKIPPED_START)), 422, "validation")
    assert "starts_at" in error["fields"]
    repeated = request_body("HPMC", far_start(), SOLO_MAX_MINUTES, starts_at=REPEATED_START)
    r = harbor.post("/api/requests", json=repeated)
    assert r.status_code == 201, r.text
    CREATED.append(r.json()["id"])
    assert r.json()["starts_at"] == datetime.fromisoformat(REPEATED_START).replace(tzinfo=AGENCY, fold=0).isoformat()

    start = far_start().replace(hour=13, minute=30)
    body = request_body("HPMC", start, DURATION_MIN)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": BROWSER_ZONE})
        sign_in(page, app_url, SCHEDULER["HPMC"])
        page.goto(f"{app_url}/requests/new")
        posts: list[str] = []
        page.on("request", lambda rq: posts.append(rq.url) if rq.method == "POST" and "/api/requests" in rq.url else None)
        form = page.get_by_role("form", name="New request")
        date_box = form.get_by_role("textbox", name=re.compile(r"^Date"))
        time_box = form.get_by_role("textbox", name=re.compile(r"^Start time"))
        select(form.get_by_role("combobox", name="Setting"), "Medical")
        select(form.get_by_role("combobox", name="Required credential"), "NIC")
        fill(form.get_by_role("spinbutton", name="Duration (minutes)"), str(DURATION_MIN))
        fill(form.get_by_role("textbox", name="Deaf consumer name"), body["consumer_name"])
        fill(form.get_by_role("textbox", name="Street address"), body["location_address"])
        fill(form.get_by_role("textbox", name="City"), body["city"])
        fill(form.get_by_role("textbox", name="Notes for interpreters"), body["notes"])
        fill(date_box, start.strftime("%m/%d/%Y"))
        fill(time_box, f"{start.hour - 12:02d}:{start.minute:02d} pm")
        click(page.get_by_role("button", name="Save draft"))
        expect(page.get_by_text("Enter the date as YYYY-MM-DD.")).to_be_visible()
        expect(date_box).to_have_attribute("aria-invalid", "true")
        assert posts == []
        fill(date_box, start.strftime("%Y-%m-%d"))
        fill(time_box, f"{start.hour - 12}.{start.minute:02d}pm")
        click(page.get_by_role("button", name="Save draft"))
        expect(page.get_by_text("Enter the time like 9:00 AM.")).to_be_visible()
        expect(time_box).to_have_attribute("aria-invalid", "true")
        assert posts == []
        fill(time_box, f"{start.hour - 12:02d}:{start.minute:02d} pm")
        click(page.get_by_role("button", name="Save draft"))
        rows = poll(lambda: harbor.get("/api/requests", params={"q": body["consumer_name"]}).json()["requests"],
                    lambda found: len(found) == 1)
        saved = rows[0]
        CREATED.append(saved["id"])
        assert saved["status"] == "draft" and saved["starts_at"] == agency_iso(start)
        page.goto(f"{app_url}/requests/{saved['id']}/edit")
        edit = page.get_by_role("form", name="New request")
        expect(edit.get_by_role("textbox", name=re.compile(r"^Date"))).to_have_value(start.strftime("%Y-%m-%d"))
        expect(edit.get_by_role("textbox", name=re.compile(r"^Start time"))).to_have_value(clock(start))
        page.goto(f"{app_url}/requests/{saved['id']}")
        expect(page.get_by_text(re.compile(re.escape(clock(start)))).first).to_be_visible()


def test_submit_opens_seats(app_url: str) -> None:
    start = far_start()
    for minutes, labels in ((SOLO_MAX_MINUTES, ["A"]), (SOLO_MAX_MINUTES + 1, ["A", "B"]), (MIN_BILLABLE, ["A", "B"])):
        draft = create(app_url, "HPMC", start, minutes)
        assert draft["status"] == "draft"
        req = submit(app_url, "HPMC", draft)
        assert req["status"] == "submitted"
        assert req["team_size"] == len(labels)
        assert sorted(s["label"] for s in req["seats"]) == labels
        assert all(s["status"] == "open" and s["interpreter"] is None for s in req["seats"])
        assert req["rotation_minutes"] == ROTATION_MIN
        assert_error(api(app_url, SCHEDULER["HPMC"]).post(f"/api/requests/{req['id']}/submit", json={}), 409,
                     "invalid_transition")
        assert history(app_url, req["id"], "submitted")


def test_wf_request_intake_happy(browser: Any, app_url: str) -> None:
    start = far_start()
    body = request_body("HPMC", start, MIN_BILLABLE)
    harbor = api(app_url, SCHEDULER["HPMC"])
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, SCHEDULER["HPMC"])
        page.wait_for_url(re.compile(r"/requests(\?|$)"))
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="New request"))
        form = page.get_by_role("form", name="New request")
        select(form.get_by_role("combobox", name="Setting"), "Medical")
        fill(form.get_by_role("textbox", name=re.compile(r"^Date")), start.strftime("%Y-%m-%d"))
        fill(form.get_by_role("textbox", name=re.compile(r"^Start time")), clock(start))
        fill(form.get_by_role("spinbutton", name="Duration (minutes)"), str(MIN_BILLABLE))
        select(form.get_by_role("combobox", name="Required credential"), "NIC")
        fill(form.get_by_role("textbox", name="Deaf consumer name"), body["consumer_name"])
        fill(form.get_by_role("textbox", name="Street address"), body["location_address"])
        fill(form.get_by_role("textbox", name="City"), body["city"])
        fill(form.get_by_role("textbox", name="Notes for interpreters"), body["notes"])
        click(page.get_by_role("button", name="Save draft"))
        rows = poll(lambda: harbor.get("/api/requests", params={"q": body["consumer_name"]}).json()["requests"],
                    lambda found: len(found) == 1)
        draft = rows[0]
        CREATED.append(draft["id"])
        assert draft["status"] == "draft" and draft["starts_at"] == agency_iso(start)
        page.goto(f"{app_url}/requests/{draft['id']}")
        click(page.get_by_role("button", name="Submit request"))
        expect(status(page, "Request status")).to_contain_text("Request submitted. Seats are open for interpreters.")
        expect(page.get_by_role("heading", level=1, name=draft["reference"])).to_be_visible()
        expect(page.get_by_text("Open seat", exact=True).first).to_be_visible()
        seats = page.get_by_role("list", name="Seats")
        expect(seats.get_by_role("listitem", name=SEAT_ITEM.format(label="A", state="open"))).to_be_visible()
        expect(seats.get_by_role("listitem", name=SEAT_ITEM.format(label="B", state="open"))).to_be_visible()
        for label in ("A", "B"):
            names = item_names(lane(page, label))
            assert names and all(n.endswith(", open") for n in names)
        cutoff = re.escape(cutoff_text(cutoff_instant(start)))
        expect(page.get_by_text(re.compile(rf"Free cancellation (until|ended) {cutoff}"))).to_be_visible()
    final = read(app_url, draft["id"])
    assert final["status"] == "submitted"
    assert sorted(s["label"] for s in final["seats"]) == ["A", "B"]
    assert all(s["status"] == "open" for s in final["seats"])


def test_wf_request_intake_not_found(browser: Any, app_url: str) -> None:
    other = create(app_url, "HPMC", far_start(), SOLO_MAX_MINUTES)
    missing = f"missing{tag()}"
    lakemont = api(app_url, SCHEDULER["LKSU"])
    for rid in (other["id"], missing):
        assert_not_found(lakemont.get(f"/api/requests/{rid}"))
        assert_not_found(lakemont.patch(f"/api/requests/{rid}", json={"city": "Elsewhere"}))
    assert read(app_url, other["id"])["city"] == other["city"]
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, SCHEDULER["LKSU"])
        contents = []
        for rid in (other["id"], missing):
            page.goto(f"{app_url}/requests/{rid}")
            expect(page.get_by_role("heading", level=1, name="Request not found")).to_be_visible()
            expect(page.get_by_text("This request doesn't exist or isn't available to you.")).to_be_visible()
            assert other["consumer_name"] not in page.evaluate("document.body.innerText")
            contents.append(page.evaluate("document.body.innerText"))
        assert contents[0] == contents[1]


def test_team_size_and_rotation(app_url: str) -> None:
    start = far_start()
    team = open_job(app_url, "HPMC", SOLO_MAX_MINUTES + 1, start=start)
    rid = team["id"]
    error = assert_error(staffing(app_url, rid, {"team_size": 1}), 422, "validation")
    assert "team_reason" in error["fields"]
    for reason in ("r" * (REASON_MIN - 1), "r" * (REASON_MAX + 1)):
        assert "team_reason" in assert_error(staffing(app_url, rid, {"team_size": 1, "team_reason": reason}), 422,
                                             "validation")["fields"]
    assert "team_size" in assert_error(staffing(app_url, rid, {"team_size": 3}), 422, "validation")["fields"]
    assert read(app_url, rid)["team_size"] == 2
    reason = f"Consumer prefers one {tag()}"[:REASON_MAX].ljust(REASON_MIN, ".")
    r = staffing(app_url, rid, {"team_size": 1, "team_reason": reason})
    assert r.status_code == 200, r.text
    assert r.json()["team_size"] == 1 and [s["label"] for s in r.json()["seats"]] == ["A"]
    after = read(app_url, rid)
    assert after["team_reason"] == reason
    assert any(reason in (h["detail"] or "") for h in history(app_url, rid, "team_changed"))
    for bad in (ROTATION_MIN - 1, ROTATION_MAX + 1):
        assert "rotation_minutes" in assert_error(staffing(app_url, rid, {"rotation_minutes": bad}), 422,
                                                  "validation")["fields"]
    for good in (ROTATION_MAX, ROTATION_MIN):
        r = staffing(app_url, rid, {"rotation_minutes": good})
        assert r.status_code == 200 and r.json()["rotation_minutes"] == good
    assert history(app_url, rid, "rotation_changed")
    r = staffing(app_url, rid, {"team_size": 2})
    assert r.status_code == 200, r.text
    assert sorted(s["label"] for s in r.json()["seats"]) == ["A", "B"]

    solo = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start + timedelta(minutes=SOLO_MAX_MINUTES + 1))
    assert "team_reason" in assert_error(staffing(app_url, solo["id"], {"team_size": 2}), 422, "validation")["fields"]
    r = staffing(app_url, solo["id"], {"team_size": 2, "team_reason": reason})
    assert r.status_code == 200 and sorted(s["label"] for s in r.json()["seats"]) == ["A", "B"]

    third = open_job(app_url, "HPMC", SOLO_MAX_MINUTES + 1, claims=[("B", "rosa")],
                     start=start + timedelta(minutes=2 * SOLO_MAX_MINUTES + 1))
    r = staffing(app_url, third["id"], {"team_size": 1, "team_reason": reason})
    assert r.status_code == 200 and [s["label"] for s in r.json()["seats"]] == ["B"]
    r = staffing(app_url, third["id"], {"team_size": 2})
    seats = {s["label"]: s["status"] for s in r.json()["seats"]}
    assert seats == {"A": "open", "B": "confirmed"}

    draft = create(app_url, "HPMC", far_start(), SOLO_MAX_MINUTES)
    assert_error(staffing(app_url, draft["id"], {"rotation_minutes": ROTATION_MIN}), 409, "invalid_transition")
    assert_error(api(app_url, INTERPRETERS["theo"][0]).patch(f"/api/requests/{rid}/staffing",
                                                             json={"rotation_minutes": ROTATION_MIN}), 403, "forbidden")


def test_open_seat_broadcast(app_url: str, mail: Any) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    blocker = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start, claims=[("A", "theo")])
    assert_error(api(app_url, INTERPRETERS["rosa"][0]).post(f"/api/requests/{job['id']}/broadcast", json={}), 403,
                 "forbidden")
    r = api(app_url, COORDINATOR).post(f"/api/requests/{job['id']}/broadcast", json={})
    assert r.status_code == 200, r.text
    emailed = r.json()["emailed"]
    end = start + timedelta(minutes=MIN_BILLABLE)
    subj = f"Open seat: Medical, NIC, {mon_d(start)}, {clock(start)} to {clock(end)}, {job['city']}"
    expected = sorted(INTERPRETERS[k][0] for k in ("rosa", "kemi", "ines"))
    assert emailed == len(expected)
    found = mails_for(mail, by_subject(subj), count=emailed)
    assert sorted(a for m in found for a in recipients(m)) == expected
    for message in found:
        body = text(message)
        assert addresses(message.get("From")) == [mail_from_address()]
        for fact in ("Medical", "NIC", job["city"], clock(start), clock(end), "/open-seats"):
            assert fact in body, fact
        assert_private_absent(message, job)
    assert any(str(emailed) in (h["detail"] or "") for h in history(app_url, job["id"], "broadcast"))
    assert_error(api(app_url, COORDINATOR).post(f"/api/requests/{blocker['id']}/broadcast", json={}), 409,
                 "invalid_transition")
    assert not [m for m in mail.messages() if blocker["city"] in subject(m)]


def test_wf_staffing_setup_happy(browser: Any, app_url: str, mail: Any) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, COORDINATOR)
        page.goto(board_url(app_url, start))
        click(board_row(page, job["reference"]))
        pane = job_pane(page)
        expect(pane).to_be_visible()
        fill(pane.get_by_role("spinbutton", name="Rotation interval (minutes)"), str(ROTATION_MAX))
        click(pane.get_by_role("button", name="Save staffing"))
        expect(status(page, "Job status")).to_contain_text("Staffing saved.")
        poll(lambda: read(app_url, job["id"])["rotation_minutes"], lambda v: v == ROTATION_MAX)
        broadcast = pane.get_by_role("button", name="Broadcast open seats")
        with hold(page, BROADCAST_GLOB) as gate:
            click(broadcast)
            expect(status(page, "Job status")).to_contain_text("Sending open-seat emails…")
            expect(broadcast).to_be_disabled()
            gate.release()
        expect(status(page, "Job status")).to_contain_text(
            f"Open-seat email sent to {len(NIC_HOLDERS)} eligible interpreters.")
    end = start + timedelta(minutes=MIN_BILLABLE)
    subj = f"Open seat: Medical, NIC, {mon_d(start)}, {clock(start)} to {clock(end)}, {job['city']}"
    found = mails_for(mail, by_subject(subj), count=len(NIC_HOLDERS))
    assert sorted(a for m in found for a in recipients(m)) == sorted(INTERPRETERS[k][0] for k in NIC_HOLDERS)
    for message in found:
        assert_private_absent(message, job)
    assert history(app_url, job["id"], "broadcast")


def test_wf_staffing_setup_team_change(browser: Any, app_url: str) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    reason = f"Short session agreed {tag()}"
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, COORDINATOR)
        page.goto(board_url(app_url, start, job["id"]))
        pane = job_pane(page)
        expect(pane).to_be_visible()
        check(pane.get_by_role("radiogroup", name="Team size").get_by_role("radio", name="Solo"))
        reason_box = pane.get_by_role("textbox", name="Reason for team change")
        expect(reason_box).to_be_visible()
        click(pane.get_by_role("button", name="Save staffing"))
        expect(reason_box).to_have_attribute("aria-invalid", "true")
        assert read(app_url, job["id"])["team_size"] == 2
        fill(reason_box, reason)
        click(pane.get_by_role("button", name="Save staffing"))
        expect(status(page, "Job status")).to_contain_text("Staffing saved.")
        eventually(page, lambda: expect(pane.get_by_role("list", name="Seats").get_by_role("listitem")).to_have_count(
            1, timeout=SHORT_MS))
    final = read(app_url, job["id"])
    assert final["team_size"] == 1 and final["team_reason"] == reason
    assert [s["label"] for s in final["seats"]] == ["A"]


def test_wf_staffing_setup_no_eligible(browser: Any, app_url: str, mail: Any) -> None:
    start = far_start()
    job = open_job(app_url, "ECCC", MIN_BILLABLE, start=start)
    open_job(app_url, "ECCC", SOLO_MAX_MINUTES, start=start, claims=[("A", "kemi")])
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, COORDINATOR)
        page.goto(board_url(app_url, start, job["id"]))
        pane = job_pane(page)
        click(pane.get_by_role("button", name="Broadcast open seats"))
        expect(status(page, "Job status")).to_contain_text("No eligible interpreter is free for this job.")
    assert history(app_url, job["id"], "broadcast")
    assert not [m for m in mail.messages() if job["city"] in subject(m)]


def test_exactly_one_claim_wins(app_url: str, mail: Any) -> None:
    job = open_job(app_url, "HPMC", MIN_BILLABLE, claims=[("A", "rosa")])
    start = local_start(job)
    seat_b = seat_of(job, "B")["id"]
    contenders = ("theo", "kemi", "ines")
    results = race(app_url, contenders, seat_b)
    winners = [who for who, r in results.items() if r.status_code == 200]
    assert len(winners) == 1, {w: r.text for w, r in results.items()}
    winner = winners[0]
    losers = [who for who in contenders if who != winner]
    for who in losers:
        assert_error(results[who], 409, "seat_taken")
    final = read(app_url, job["id"])
    assert final["status"] == "staffed"
    assert seat_of(final, "B")["interpreter"]["email"] == INTERPRETERS[winner][0]
    assert len(history(app_url, job["id"], "claim_won")) == 2
    lost = history(app_url, job["id"], "claim_lost")
    assert len(lost) == len(losers) and all("seat_taken" in (h["detail"] or "") for h in lost)
    assert_error(claim(app_url, winner, seat_b), 409, "seat_taken")
    assert_not_found(api(app_url, INTERPRETERS[losers[0]][0]).get(f"/api/requests/{job['id']}"))
    assert_error(claim(app_url, losers[0], seat_b), 409, "seat_taken")
    assert len(history(app_url, job["id"], "claim_lost")) == len(losers) + 2
    assert seat_of(read(app_url, job["id"]), "B")["interpreter"]["email"] == INTERPRETERS[winner][0]
    subj = f"Seat B confirmed: {job['reference']}, {mon_d(start)}"
    found = mails_for(mail, by_subject(subj), count=2)
    assert sorted(a for m in found for a in recipients(m)) == sorted([INTERPRETERS["rosa"][0], INTERPRETERS[winner][0]])
    loser_mail = {INTERPRETERS[w][0] for w in losers}
    assert not [m for m in mail.messages() if job["reference"] in subject(m) and loser_mail & set(recipients(m))]


def test_staffing_emails(app_url: str, mail: Any) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    end = start + timedelta(minutes=MIN_BILLABLE)
    assert claim(app_url, "kemi", seat_of(job, "A")["id"]).status_code == 200
    first = mails_for(mail, by_subject(f"Seat A confirmed: {job['reference']}, {mon_d(start)}"))
    assert len(first) == 1 and recipients(first[0]) == [INTERPRETERS["kemi"][0]]
    body = text(first[0])
    for fact in ("Seat B is still open", job["city"], clock(start), clock(end)):
        assert fact in body, fact
    assert claim(app_url, "ines", seat_of(job, "B")["id"]).status_code == 200
    second = mails_for(mail, by_subject(f"Seat B confirmed: {job['reference']}, {mon_d(start)}"), count=2)
    by_recipient = {recipients(m)[0]: text(m) for m in second}
    assert sorted(by_recipient) == sorted([INTERPRETERS["kemi"][0], INTERPRETERS["ines"][0]])
    assert INTERPRETERS["kemi"][1] in by_recipient[INTERPRETERS["ines"][0]]
    assert INTERPRETERS["ines"][1] in by_recipient[INTERPRETERS["kemi"][0]]
    staffed = mails_for(mail, by_subject(f"Fully staffed: {job['reference']}, {mon_d(start)}"))
    assert len(staffed) == 1 and recipients(staffed[0]) == [SCHEDULER["HPMC"]]
    for fact in (INTERPRETERS["kemi"][1], INTERPRETERS["ines"][1], "NIC", "SC:L"):
        assert fact in text(staffed[0]), fact
    for message in first + second + staffed:
        assert addresses(message.get("From")) == [mail_from_address()]
        assert_private_absent(message, job)


def test_wf_seat_claim_happy(browser: Any, app_url: str, mail: Any) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa")])
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, INTERPRETERS["ines"][0])
        page.wait_for_url(re.compile(r"/open-seats"))
        click(page.get_by_role("list", name="Open seats").get_by_role("link", name=f"View job {job['reference']}"))
        pane = job_pane(page)
        expect(pane).to_be_visible()
        assert job["consumer_name"] not in page.evaluate("document.body.innerText")
        click(pane.get_by_role("button", name="Claim seat B"))
        expect(status(page, "Claim status")).to_contain_text(CLAIM_WON.format(label="B"))
        progress = fill_progress(page, "B", INTERPRETERS["ines"][1])
        assert progress[-1] and all(progress[-1])
        expect(pane.get_by_text(job["consumer_name"])).to_be_visible()
        expect(pane.get_by_text(job["notes"])).to_be_visible()
    final = read(app_url, job["id"])
    assert final["status"] == "staffed"
    assert seat_of(final, "B")["interpreter"]["email"] == INTERPRETERS["ines"][0]
    assert seat_of(final, "B")["id"] in assignment_seat_ids(app_url, "ines")
    found = mails_for(mail, by_subject(f"Seat B confirmed: {job['reference']}, {mon_d(start)}"), count=2)
    assert sorted(a for m in found for a in recipients(m)) == sorted([INTERPRETERS["ines"][0], INTERPRETERS["rosa"][0]])


def test_wf_seat_claim_race(browser: Any, app_url: str, mail: Any) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa")])
    pair = ("theo", "kemi")
    with app_page(browser, app_url) as p1, app_page(browser, app_url) as p2:
        pages = dict(zip(pair, (p1, p2)))
        for who, page in pages.items():
            page.set_viewport_size(DESKTOP)
            sign_in(page, app_url, INTERPRETERS[who][0])
            page.goto(f"{app_url}/jobs/{job['id']}")
            expect(job_pane(page).get_by_role("button", name="Claim seat B")).to_be_visible()
        with hold(p1, CLAIM_GLOB) as g1, hold(p2, CLAIM_GLOB) as g2:
            for page in pages.values():
                click(job_pane(page).get_by_role("button", name="Claim seat B"))
            for page in pages.values():
                expect(status(page, "Claim status")).to_contain_text(CLAIM_PENDING.format(label="B"))
                assert all(n.endswith(", open") for n in item_names(lane(page, "B")))
            g1.release()
            g2.release()
        won = CLAIM_WON.format(label="B")
        taken = CLAIM_TAKEN.format(label="B")
        outcome: dict[str, str] = {}
        for who, page in pages.items():
            region = status(page, "Claim status")
            expect(region).to_contain_text(re.compile(re.escape(won) + "|" + re.escape(taken)))
            outcome[who] = "won" if won in region.inner_text() else "taken"
        assert sorted(outcome.values()) == ["taken", "won"], outcome
        loser = next(w for w, o in outcome.items() if o == "taken")
        winner = next(w for w, o in outcome.items() if o == "won")
        page = pages[loser]
        pane = job_pane(page)
        expect(pane.get_by_role("list", name="Seats").get_by_role(
            "listitem", name=SEAT_ITEM.format(label="B", state="taken"))).to_be_visible()
        expect(pane.get_by_role("button", name="Claim seat B")).to_have_count(0)
        names = item_names(lane(page, "B"))
        assert names and all(n.endswith(", taken") for n in names)
        assert not any(INTERPRETERS[loser][1] in n for n in names)
        page.goto(f"{app_url}/jobs/{job['id']}")
        expect(page.get_by_role("heading", level=1, name="Request not found")).to_be_visible()
    final = read(app_url, job["id"])
    assert seat_of(final, "B")["interpreter"]["email"] == INTERPRETERS[winner][0]
    assert any("seat_taken" in (h["detail"] or "") for h in history(app_url, job["id"], "claim_lost"))
    found = mails_for(mail, by_subject(f"Seat B confirmed: {job['reference']}, {mon_d(start)}"), count=2)
    assert INTERPRETERS[loser][0] not in [a for m in found for a in recipients(m)]


def test_credential_valid_on_job_date(app_url: str) -> None:
    nic = open_job(app_url, "HPMC", SOLO_MAX_MINUTES)
    nic_seat = seat_of(nic, "A")["id"]
    assert nic_seat not in open_seat_ids(app_url, "wren")
    assert_error(claim(app_url, "wren", nic_seat), 409, "credential_invalid")
    assert any("credential_invalid" in (h["detail"] or "") for h in history(app_url, nic["id"], "claim_lost"))
    assert seat_of(read(app_url, nic["id"]), "A")["status"] == "open"
    edu = open_job(app_url, "LKSU", SOLO_MAX_MINUTES)
    edu_seat = seat_of(edu, "A")["id"]
    assert edu_seat not in open_seat_ids(app_url, "malik")
    assert_error(claim(app_url, "malik", edu_seat), 409, "credential_invalid")
    assert edu_seat in open_seat_ids(app_url, "wren")

    expiry = renewal_expiry(app_url)
    evening = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=datetime.combine(expiry, LATE_EVENING))
    next_day = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=datetime.combine(expiry + timedelta(days=1),
                                                                                  dtime(9, 0)))
    evening_seat = seat_of(evening, "A")["id"]
    next_seat = seat_of(next_day, "A")["id"]
    assert evening_seat not in open_seat_ids(app_url, "ines")
    assert_error(claim(app_url, "ines", evening_seat), 409, "credential_invalid")
    up = upload(app_url, "ines", "NIC", PDF + tag().encode())
    assert up.status_code == 201, up.text
    assert verify(app_url, up.json()["id"], expiry.isoformat()).status_code == 200
    seats = open_seat_ids(app_url, "ines")
    assert evening_seat in seats and next_seat not in seats
    assert claim(app_url, "ines", evening_seat).status_code == 200
    assert_error(claim(app_url, "ines", next_seat), 409, "credential_invalid")
    assert seat_of(read(app_url, next_day["id"]), "A")["status"] == "open"


def test_no_overlapping_seats(app_url: str) -> None:
    start = far_start()
    first = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa")])
    assert_error(claim(app_url, "rosa", seat_of(first, "B")["id"]), 409, "schedule_conflict")
    overlap = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start + timedelta(minutes=SOLO_MAX_MINUTES))
    overlap_seat = seat_of(overlap, "A")["id"]
    assert overlap_seat not in open_seat_ids(app_url, "rosa")
    assert_error(claim(app_url, "rosa", overlap_seat), 409, "schedule_conflict")
    assert any("schedule_conflict" in (h["detail"] or "") for h in history(app_url, overlap["id"], "claim_lost"))
    assert seat_of(read(app_url, overlap["id"]), "A")["status"] == "open"
    adjacent = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start + timedelta(minutes=MIN_BILLABLE))
    adjacent_seat = seat_of(adjacent, "A")["id"]
    assert adjacent_seat in open_seat_ids(app_url, "rosa")
    assert claim(app_url, "rosa", adjacent_seat).status_code == 200

    one = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start + timedelta(minutes=DURATION_MIN))
    two = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start + timedelta(minutes=SOLO_MAX_MINUTES))
    seats = [seat_of(one, "A")["id"], seat_of(two, "A")["id"]]
    clients = [login(app_url, INTERPRETERS["theo"][0]) for _ in seats]
    results = concurrent([lambda c=c, s=s: c.post(f"/api/seats/{s}/claim", json={}) for c, s in zip(clients, seats)])
    assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
    assert_error(next(r for r in results if r.status_code == 409), 409, "schedule_conflict")
    held_seats = assignment_seat_ids(app_url, "theo") & set(seats)
    assert len(held_seats) == 1


def test_wf_eligibility_expired_credential(browser: Any, app_url: str) -> None:
    job = open_job(app_url, "LKSU", SOLO_MAX_MINUTES)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, INTERPRETERS["malik"][0])
        expect(page.get_by_role("list", name="Open seats").get_by_role(
            "link", name=f"View job {job['reference']}")).to_have_count(0)
        page.goto(f"{app_url}/jobs/{job['id']}")
        click(job_pane(page).get_by_role("button", name="Claim seat A"))
        expect(status(page, "Claim status")).to_contain_text(CLAIM_CREDENTIAL.format(credential="EIPA"))
        assert all(n.endswith(", open") for n in item_names(lane(page, "A")))
    final = read(app_url, job["id"])
    assert seat_of(final, "A")["status"] == "open" and final["status"] == "submitted"
    assert any("credential_invalid" in (h["detail"] or "") for h in history(app_url, job["id"], "claim_lost"))


def test_wf_eligibility_overlap(browser: Any, app_url: str) -> None:
    start = far_start()
    open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start, claims=[("A", "rosa")])
    job = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start + timedelta(minutes=DURATION_MIN))
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, INTERPRETERS["rosa"][0])
        expect(page.get_by_role("list", name="Open seats").get_by_role(
            "link", name=f"View job {job['reference']}")).to_have_count(0)
        page.goto(f"{app_url}/jobs/{job['id']}")
        click(job_pane(page).get_by_role("button", name="Claim seat A"))
        expect(status(page, "Claim status")).to_contain_text("You already hold a seat that overlaps this job.")
    assert seat_of(read(app_url, job["id"]), "A")["status"] == "open"
    assert seat_of(job, "A")["id"] not in assignment_seat_ids(app_url, "rosa")


def test_staffing_status_from_seats(app_url: str) -> None:
    job = open_job(app_url, "HPMC", MIN_BILLABLE)
    rid = job["id"]
    assert job["status"] == "submitted"
    r = claim(app_url, "rosa", seat_of(job, "A")["id"])
    assert r.status_code == 200 and r.json()["request"]["status"] == "half-staffed"
    reason = f"Solo agreed with client {tag()}"
    r = staffing(app_url, rid, {"team_size": 1, "team_reason": reason})
    assert r.status_code == 200 and r.json()["status"] == "staffed"
    assert [(s["label"], s["status"]) for s in r.json()["seats"]] == [("A", "confirmed")]
    r = staffing(app_url, rid, {"team_size": 2})
    assert r.status_code == 200 and r.json()["status"] == "half-staffed"
    b = seat_of(r.json(), "B")
    assert b["status"] == "open"
    r = claim(app_url, "theo", b["id"])
    assert r.status_code == 200 and r.json()["request"]["status"] == "staffed"
    assert_error(staffing(app_url, rid, {"team_size": 1, "team_reason": reason}), 409, "invalid_transition")
    final = read(app_url, rid)
    assert final["status"] == "staffed" and len(final["seats"]) == 2
    solo = open_job(app_url, "HPMC", SOLO_MAX_MINUTES)
    assert claim(app_url, "kemi", seat_of(solo, "A")["id"]).json()["request"]["status"] == "staffed"


def test_fields_by_role(app_url: str) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa"), ("B", "kemi")])
    rid = job["id"]
    for email in (COORDINATOR, BILLING):
        req = read(app_url, rid, email)
        assert set(req) == BASE_FIELDS | STAFF_EXTRA
        for seat in req["seats"]:
            assert set(seat) == SEAT_FIELDS and set(seat["interpreter"]) == STAFF_INTERPRETER
        rosa = seat_of(req, "A")["interpreter"]
        assert (rosa["phone"], rosa["home_area"], rosa["pay_rate"]) == ROSA_PRIVATE
        assert rosa["credentials"] == ["NIC"]
        assert seat_of(req, "B")["interpreter"]["credentials"] == ["NIC", "SC:L"]
    client_r = api(app_url, SCHEDULER["HPMC"]).get(f"/api/requests/{rid}")
    client = client_r.json()
    assert set(client) == BASE_FIELDS | CLIENT_EXTRA
    for seat in client["seats"]:
        assert set(seat) == SEAT_FIELDS and set(seat["interpreter"]) == CLIENT_INTERPRETER
    assert seat_of(client, "A")["interpreter"] == {"display_name": "Rosa D.", "credentials": ["NIC"]}
    for value in ROSA_PRIVATE[:2] + (INTERPRETERS["rosa"][0],):
        assert value not in client_r.text
    listed = api(app_url, SCHEDULER["HPMC"]).get("/api/requests", params={"q": job["reference"]}).json()["requests"]
    assert [set(r) for r in listed if r["id"] == rid] == [BASE_FIELDS | CLIENT_EXTRA]
    holder_r = api(app_url, INTERPRETERS["rosa"][0]).get(f"/api/requests/{rid}")
    holder = holder_r.json()
    assert set(holder) == BASE_FIELDS | PRIVATE
    for seat in holder["seats"]:
        assert set(seat["interpreter"]) == HOLDER_INTERPRETER
    assert ROSA_PRIVATE[1] not in holder_r.text
    mine = [a for a in api(app_url, INTERPRETERS["rosa"][0]).get("/api/assignments").json()["assignments"]
            if a["request"]["id"] == rid]
    assert len(mine) == 1 and set(mine[0]["request"]) == BASE_FIELDS | PRIVATE

    half = open_job(app_url, "HPMC", MIN_BILLABLE, claims=[("A", "theo")])
    other_r = api(app_url, INTERPRETERS["ines"][0]).get(f"/api/requests/{half['id']}")
    other = other_r.json()
    assert set(other) == BASE_FIELDS
    assert seat_of(other, "A")["interpreter"] is None and seat_of(other, "A")["status"] == "confirmed"
    assert half["consumer_name"] not in other_r.text
    listing = [s for s in api(app_url, INTERPRETERS["ines"][0]).get("/api/open-seats").json()["open_seats"]
               if s["request"]["id"] == half["id"]]
    assert len(listing) == 1 and set(listing[0]["request"]) == BASE_FIELDS
    cdi = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, claims=[("A", "malik")], required_credential="CDI")
    assert seat_of(read(app_url, cdi["id"], SCHEDULER["HPMC"]), "A")["interpreter"]["credentials"] == ["CDI"]


def test_organisation_isolation(app_url: str) -> None:
    req = solo_completed(app_url, "HPMC", SOLO_MAX_MINUTES, SOLO_MAX_MINUTES, "theo")
    assert close(app_url, req["id"]).status_code == 200
    own = create(app_url, "LKSU", far_start(), SOLO_MAX_MINUTES)
    lakemont = api(app_url, SCHEDULER["LKSU"])
    for q in (req["reference"], req["consumer_name"]):
        assert req["id"] not in {r["id"] for r in lakemont.get("/api/requests", params={"q": q}).json()["requests"]}
    assert own["id"] in {r["id"] for r in lakemont.get("/api/requests", params={"q": own["reference"]}).json()["requests"]}
    missing = f"missing{tag()}"
    for rid in (req["id"], missing):
        assert_not_found(lakemont.get(f"/api/requests/{rid}"))
        assert_not_found(lakemont.get(f"/api/requests/{rid}/cancellation-quote"))
        assert_not_found(lakemont.post(f"/api/requests/{rid}/cancel", json={"expected_fee": "0.00"},
                                       headers={"Idempotency-Key": idempotency_key()}))
    assert invoices(app_url, SCHEDULER["LKSU"], req["reference"]) == []
    csv_r = lakemont.get("/api/invoices.csv", params={"q": req["reference"]})
    assert csv_r.status_code == 200 and req["reference"] not in csv_r.text
    assert len(invoice_for(app_url, req["reference"], email=SCHEDULER["HPMC"])) == 1
    assert_not_found(api(app_url, INTERPRETERS["ines"][0]).get(f"/api/requests/{req['id']}"))


def test_wf_staffing_visibility_client_view(browser: Any, app_url: str) -> None:
    job = open_job(app_url, "HPMC", MIN_BILLABLE, claims=[("A", "rosa"), ("B", "kemi")])
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, SCHEDULER["HPMC"])
        page.goto(f"{app_url}/requests/{job['id']}")
        seats = page.get_by_role("list", name="Seats")
        expect(seats.get_by_role("listitem", name=SEAT_ITEM.format(
            label="A", state=INTERPRETERS["rosa"][1]))).to_be_visible()
        expect(seats.get_by_role("listitem", name=SEAT_ITEM.format(
            label="B", state=INTERPRETERS["kemi"][1]))).to_be_visible()
        expect(page.get_by_text("Staffed", exact=True).first).to_be_visible()
        body = page.evaluate("document.documentElement.outerHTML")
        for value in ROSA_PRIVATE[:2] + (INTERPRETERS["rosa"][0], "Rosa Delgado-Finch"):
            assert value not in body
    client = read(app_url, job["id"], SCHEDULER["HPMC"])
    assert all(set(s["interpreter"]) == CLIENT_INTERPRETER for s in client["seats"])


def test_wf_staffing_visibility_lists(browser: Any, app_url: str) -> None:
    foreign = open_job(app_url, "HPMC", SOLO_MAX_MINUTES)
    own = open_job(app_url, "LKSU", SOLO_MAX_MINUTES)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, SCHEDULER["LKSU"])
        search = page.get_by_role("searchbox", name="Search requests")
        table = page.get_by_role("table", name="Requests")
        fill(search, foreign["reference"])
        search.press("Enter")
        expect(table.get_by_role("link", name=foreign["reference"], exact=True)).to_have_count(0)
        fill(search, own["reference"].lower())
        search.press("Enter")
        expect(table.get_by_role("link", name=own["reference"], exact=True)).to_be_visible()
    listed = api(app_url, SCHEDULER["LKSU"]).get("/api/requests", params={"q": foreign["reference"]}).json()["requests"]
    assert foreign["id"] not in {r["id"] for r in listed}


def test_wf_week_board_rows(browser: Any, app_url: str) -> None:
    start = far_start()
    first = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    second = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    later = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start + timedelta(minutes=SOLO_MAX_MINUTES),
                     claims=[("A", "theo")])
    later_start = start + timedelta(minutes=SOLO_MAX_MINUTES)
    week = monday(start)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, COORDINATOR)
        page.goto(board_url(app_url, start))
        board = page.get_by_role("region", name="Week board")
        expect(board.get_by_role("heading", level=1, name=f"Week of {mon_d(week)}")).to_be_visible()
        day_name = f"{weekday(start)} {mon_d(start)}"
        expect(page.get_by_role("navigation", name="Days").get_by_role("link", name=day_name)).to_be_visible()
        day = page.get_by_role("region", name=day_name)
        names = {
            first["id"]: row_name(first, start, "HPMC", "submitted", 0, 2),
            second["id"]: row_name(second, start, "HPMC", "submitted", 0, 2),
            later["id"]: row_name(later, later_start, "HPMC", "staffed", 1, 1),
        }
        for name in names.values():
            expect(day.get_by_role("button", name=name, exact=True)).to_have_count(1)
        order = [n for n in re.findall(r'- button "((?:[^"\\]|\\.)*)"', day.aria_snapshot()) if n in names.values()]
        assert order == [names[first["id"]], names[second["id"]], names[later["id"]]], order
        row = day.get_by_role("button", name=names[first["id"]], exact=True)
        expect(row).to_contain_text(clock(start))
        expect(row).to_contain_text(SEAT_COUNTER.format(confirmed=0, team=2))
        filter_box = page.get_by_role("checkbox", name="Only jobs with an open seat")
        check(filter_box)
        expect(day.get_by_role("button", name=names[later["id"]], exact=True)).to_be_hidden()
        expect(row).to_be_visible()
        click(filter_box)
        expect(day.get_by_role("button", name=names[later["id"]], exact=True)).to_be_visible()
        click(page.get_by_role("button", name="Next week"))
        expect(board.get_by_role("heading", level=1, name=f"Week of {mon_d(week + timedelta(days=7))}")).to_be_visible()
        assert f"week={(week + timedelta(days=7)).isoformat()}" in page.url
        click(page.get_by_role("button", name="Previous week"))
        expect(board.get_by_role("heading", level=1, name=f"Week of {mon_d(week)}")).to_be_visible()
        assert claim(app_url, "rosa", seat_of(first, "A")["id"]).status_code == 200
        updated = row_name(first, start, "HPMC", "half-staffed", 1, 2)
        eventually(page, lambda: expect(page.get_by_role("button", name=updated, exact=True)).to_have_count(
            1, timeout=SHORT_MS), seconds=UI_WAIT_S, step_ms=REFRESH_MS)
    assert read(app_url, first["id"])["status"] == "half-staffed"


def test_wf_week_board_status(browser: Any, app_url: str) -> None:
    start = far_start()
    open_one = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    half = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa")])
    full = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "theo"), ("B", "kemi")])
    expected = ((open_one, "submitted", "0/2"), (half, "half-staffed", "1/2"), (full, "staffed", "2/2"))
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, COORDINATOR)
        page.goto(board_url(app_url, start))
        for req, req_status, counter in expected:
            row = board_row(page, req["reference"])
            expect(row).to_have_count(1)
            expect(row.get_by_text(LABEL[req_status], exact=True)).to_be_visible()
            expect(row.get_by_text(counter, exact=True)).to_be_visible()
        axe(page)
    draft = create(app_url, "HPMC", far_start(), SOLO_MAX_MINUTES)
    assert cancel(app_url, draft["id"], "0.00", SCHEDULER["HPMC"]).status_code == 200
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, SCHEDULER["HPMC"])
        search = page.get_by_role("searchbox", name="Search requests")
        fill(search, draft["reference"])
        search.press("Enter")
        link = page.get_by_role("table", name="Requests").get_by_role("link", name=draft["reference"], exact=True)
        expect(link).to_be_visible()
        assert link.evaluate(STRUCK)
        expect(page.get_by_role("table", name="Requests").get_by_text("Cancelled", exact=True)).to_be_visible()


def test_wf_rotation_braid_segments(browser: Any, app_url: str) -> None:
    start = far_start()
    team = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa")])
    odd_start = far_start()
    odd_length = MIN_BILLABLE - ROTATION_MIN
    odd = open_job(app_url, "HPMC", odd_length, start=odd_start)
    assert staffing(app_url, odd["id"], {"rotation_minutes": ROTATION_MAX}).status_code == 200
    solo_start = far_start()
    solo = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=solo_start)
    team_who = {"A": "Rosa D.", "B": "open"}
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, COORDINATOR)
        page.goto(board_url(app_url, start, team["id"]))
        expect(job_pane(page)).to_be_visible()
        for label in ("A", "B"):
            expect(lane(page, label)).to_be_visible()
            assert item_names(lane(page, label)) == lane_names(start, MIN_BILLABLE, ROTATION_MIN, label, team_who)
        table = page.get_by_role("table", name="Rotation table")
        rows = table.get_by_role("row")
        segs = segments(start, MIN_BILLABLE, ROTATION_MIN, ("A", "B"))
        expect(rows).to_have_count(len(segs) + 1)
        for k, (s, e, active) in enumerate(segs):
            support = "B" if active == "A" else "A"
            for part in (clock(s), clock(e), f"Seat {active}, {team_who[active]}", f"Seat {support}, {team_who[support]}"):
                expect(rows.nth(k + 1)).to_contain_text(part)
        page.goto(board_url(app_url, odd_start, odd["id"]))
        expect(job_pane(page)).to_be_visible()
        odd_names = item_names(lane(page, "A"))
        assert odd_names == lane_names(odd_start, odd_length, ROTATION_MAX, "A", {"A": "open", "B": "open"})
        page.goto(board_url(app_url, solo_start, solo["id"]))
        expect(job_pane(page)).to_be_visible()
        expect(lane(page, "B")).to_have_count(0)
        assert item_names(lane(page, "A")) == lane_names(solo_start, SOLO_MAX_MINUTES, ROTATION_MIN, "A", {"A": "open"})
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, INTERPRETERS["ines"][0])
        page.goto(f"{app_url}/jobs/{team['id']}")
        expect(page.get_by_role("list", name="Seats").get_by_role(
            "listitem", name=SEAT_ITEM.format(label="A", state="taken"))).to_be_visible()
        assert item_names(lane(page, "A")) == lane_names(start, MIN_BILLABLE, ROTATION_MIN, "A",
                                                         {"A": "taken", "B": "open"})


def test_wf_rotation_braid_playhead(browser: Any, app_url: str) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa")])
    who = {"A": "Rosa D.", "B": "open"}
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, COORDINATOR)
        page.goto(board_url(app_url, start, job["id"]))
        pane = job_pane(page)
        slider = pane.get_by_role("slider", name="Playhead")
        out = status(page, "Rotation readout")
        state = slider.evaluate(SLIDER_STATE)
        assert (state["min"], state["max"]) == (0, MIN_BILLABLE)

        def at(minute: int) -> None:
            expected = readout(start, MIN_BILLABLE, ROTATION_MIN, minute, who)
            expect(out).to_have_text(expected)
            current = slider.evaluate(SLIDER_STATE)
            assert current["value"] == minute and current["text"] == expected, current

        slider.focus()
        steps = [("Home", 0), ("ArrowLeft", 0), ("ArrowRight", 1), ("ArrowUp", 2), ("ArrowDown", 1), ("ArrowLeft", 0),
                 ("Shift+ArrowRight", ROTATION_MIN), ("Shift+ArrowRight", 2 * ROTATION_MIN),
                 ("End", MIN_BILLABLE), ("ArrowRight", MIN_BILLABLE)]
        for key, minute in steps:
            page.keyboard.press(key)
            at(minute)
        for minute in range(MIN_BILLABLE - ROTATION_MIN, -1, -ROTATION_MIN):
            page.keyboard.press("Shift+ArrowLeft")
            at(minute)
        box = lane(page, "B").bounding_box()
        mid_y = box["y"] + box["height"] / 2
        page.mouse.click(box["x"] + box["width"] * 0.25, mid_y)
        early = slider.evaluate(SLIDER_STATE)
        page.mouse.click(box["x"] + box["width"] * 0.75, mid_y)
        late = slider.evaluate(SLIDER_STATE)
        assert 0 < early["value"] < late["value"] < MIN_BILLABLE, (early, late)
        expect(out).to_have_text(late["text"])
        page.mouse.move(box["x"] + box["width"] * 0.1, mid_y)
        page.mouse.down()
        values = []
        for fraction in (0.3, 0.5, 0.7, 0.9):
            page.mouse.move(box["x"] + box["width"] * fraction, mid_y)
            values.append(slider.evaluate(SLIDER_STATE)["value"])
        page.mouse.up()
        assert values == sorted(values) and values[0] < values[-1], values
        final = slider.evaluate(SLIDER_STATE)
        expect(out).to_have_text(final["text"])


def test_wf_rotation_braid_fill(browser: Any, app_url: str) -> None:
    job = open_job(app_url, "HPMC", MIN_BILLABLE, claims=[("A", "rosa")])
    contested = open_job(app_url, "HPMC", MIN_BILLABLE)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, INTERPRETERS["ines"][0])
        page.goto(f"{app_url}/jobs/{job['id']}")
        pane = job_pane(page)
        button = pane.get_by_role("button", name="Claim seat B")
        with hold(page, CLAIM_GLOB) as gate:
            click(button)
            expect(status(page, "Claim status")).to_contain_text(CLAIM_PENDING.format(label="B"))
            expect(button).to_be_disabled()
            advance(page, REFRESH_MS / 4)
            assert all(n.endswith(", open") for n in item_names(lane(page, "B")))
            gate.release()
        expect(status(page, "Claim status")).to_contain_text(CLAIM_WON.format(label="B"))
        progress = fill_progress(page, "B", INTERPRETERS["ines"][1])
        for flags in progress:
            assert flags == sorted(flags, reverse=True), progress
        assert progress[-1] and all(progress[-1])
    assert seat_of(read(app_url, job["id"]), "B")["status"] == "confirmed"

    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, INTERPRETERS["theo"][0])
        page.goto(f"{app_url}/jobs/{contested['id']}")
        pane = job_pane(page)
        expect(pane.get_by_role("button", name="Claim seat A")).to_be_visible()
        assert claim(app_url, "kemi", seat_of(contested, "A")["id"]).status_code == 200
        click(pane.get_by_role("button", name="Claim seat A"))
        expect(status(page, "Claim status")).to_contain_text(CLAIM_TAKEN.format(label="A"))
        names = item_names(lane(page, "A"))
        assert names and all(n.endswith(", taken") for n in names)
        assert not any(INTERPRETERS["theo"][1] in n for n in names)
        expect(pane.get_by_role("list", name="Seats").get_by_role(
            "listitem", name=SEAT_ITEM.format(label="A", state="taken"))).to_be_visible()
        expect(pane.get_by_role("button", name="Claim seat A")).to_have_count(0)
        expect(pane.get_by_role("button", name="Claim seat B")).to_be_visible()
    assert seat_of(read(app_url, contested["id"]), "A")["interpreter"]["email"] == INTERPRETERS["kemi"][0]


def test_wf_rotation_braid_reduced_motion(browser: Any, app_url: str) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa")])
    with app_page(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, INTERPRETERS["ines"][0])
        page.goto(f"{app_url}/jobs/{job['id']}")
        pane = job_pane(page)
        expect(pane.get_by_role("table", name="Rotation table").get_by_role("row")).to_have_count(
            len(segments(start, MIN_BILLABLE, ROTATION_MIN, ("A", "B"))) + 1)
        page.evaluate(RECORDER)
        click(pane.get_by_role("button", name="Claim seat B"))
        expect(status(page, "Claim status")).to_contain_text(CLAIM_WON.format(label="B"))
        progress = fill_progress(page, "B", INTERPRETERS["ines"][1])
        for flags in progress:
            assert all(flags) or not any(flags), progress
        assert progress[-1] and all(progress[-1])
        for item in motion_report(page.get_by_role("group", name="Rotation braid")):
            assert item["end"] <= INSTANT_MS
        page.evaluate(RELEASE_MOTION)
        who = {"A": "Rosa D.", "B": "Ines P."}
        slider = pane.get_by_role("slider", name="Playhead")
        slider.focus()
        page.keyboard.press("Home")
        page.keyboard.press("Shift+ArrowRight")
        expect(status(page, "Rotation readout")).to_have_text(readout(start, MIN_BILLABLE, ROTATION_MIN, ROTATION_MIN, who))
        page.keyboard.press("End")
        expect(status(page, "Rotation readout")).to_have_text(readout(start, MIN_BILLABLE, ROTATION_MIN, MIN_BILLABLE, who))
    assert seat_of(read(app_url, job["id"]), "B")["interpreter"]["email"] == INTERPRETERS["ines"][0]


def test_certificate_upload_limits(app_url: str) -> None:
    iid = interpreter_id_of(app_url, "wren")
    prefix = f"credentials/{iid}/"
    keys_before = set(S3().keys(prefix))
    count_before = len(my_credentials(app_url, "wren"))
    exact = upload(app_url, "wren", "CDI", PDF + b"0" * (FILE_LIMIT - len(PDF)))
    assert exact.status_code == 201, exact.text
    created = exact.json()
    assert set(created) == CREDENTIAL_FIELDS
    assert created["status"] == "uploaded" and created["expires_on"] is None
    assert_error(upload(app_url, "wren", "CDI", PDF + b"0" * (FILE_LIMIT + 1 - len(PDF))), 413, "payload_too_large")
    assert_error(upload(app_url, "wren", "CDI", PDF + b"0" * UPLOAD_BODY_LIMIT), 413, "payload_too_large")
    for content in (SVG, HTML, ZIP):
        assert_error(upload(app_url, "wren", "CDI", content, filename="certificate.pdf"), 415, "unsupported_type")
    assert_error(upload(app_url, "wren", "CDI", b""), 415, "unsupported_type")
    assert "credential_type" in assert_error(upload(app_url, "wren", "ASL", PDF + b"x"), 422, "validation")["fields"]
    png = upload(app_url, "wren", "CDI", PNG + b"pixels", filename=TRAVERSAL_NAME, mime="image/svg+xml")
    assert png.status_code == 201, png.text
    assert png.json()["file_name"] == TRAVERSAL_NAME.rsplit("/", 1)[-1]
    jpeg = upload(app_url, "wren", "CDI", JPEG + b"pixels", filename="photo.png", mime="image/png")
    assert jpeg.status_code == 201, jpeg.text
    keys_after = set(S3().keys(prefix))
    assert keys_after - keys_before == {f"{prefix}{created['id']}.pdf", f"{prefix}{png.json()['id']}.png",
                                        f"{prefix}{jpeg.json()['id']}.jpg"}
    assert len(my_credentials(app_url, "wren")) == count_before + 3


def test_private_certificate_files(app_url: str) -> None:
    marker = tag()
    content = PDF + marker.encode()
    r = upload(app_url, "wren", "CDI", content, filename=f"{marker}.pdf")
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    key = f"credentials/{interpreter_id(app_url, cid)}/{cid}.pdf"
    assert S3().get(key) == content
    assert marker not in key
    for email in (INTERPRETERS["wren"][0], BILLING, SCHEDULER["HPMC"]):
        denied = api(app_url, email).get(f"/api/credentials/{cid}/file")
        assert denied.status_code in (403, 404), denied.text
        assert denied.json()["error"]["code"] in ("forbidden", "not_found")
    link = api(app_url, COORDINATOR).get(f"/api/credentials/{cid}/file")
    assert link.status_code == 200, link.text
    payload = link.json()
    assert payload["expires_in_seconds"] == LINK_SECONDS
    assert httpx.get(payload["url"], timeout=HTTP_TIMEOUT_S).content == content
    bare = httpx.get(payload["url"].split("?")[0], timeout=HTTP_TIMEOUT_S)
    assert bare.status_code != 200 and bare.content != content
    for listing in (api(app_url, COORDINATOR).get("/api/credentials").text,
                    api(app_url, INTERPRETERS["wren"][0]).get("/api/me/credentials").text):
        assert payload["url"].split("?")[0] not in listing
    seeded = next(c for c in review_list(app_url, "verified")
                  if c["interpreter"]["display_name"] == "Rosa D." and c["expires_on"] == SEEDED_EXPIRY.isoformat())
    assert_not_found(api(app_url, COORDINATOR).get(f"/api/credentials/{seeded['id']}/file"))


def test_verification_and_expiry(app_url: str) -> None:
    today = agency_today(app_url)
    malik = [c for c in my_credentials(app_url, "malik") if c["credential_type"] == "EIPA"]
    assert any(c["status"] == "expired" and date.fromisoformat(c["expires_on"]) < today for c in malik)
    expired_ids = {c["id"] for c in review_list(app_url, "expired")}
    assert {c["id"] for c in malik if c["status"] == "expired"} <= expired_ids
    r = upload(app_url, "ines", "NIC", PDF + tag().encode())
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert cid in {c["id"] for c in review_list(app_url, "uploaded")}
    for bad in ((today - timedelta(days=1)).isoformat(), "2031-02-30"):
        assert "expires_on" in assert_error(verify(app_url, cid, bad), 422, "validation")["fields"]
    assert next(c for c in my_credentials(app_url, "ines") if c["id"] == cid)["status"] == "uploaded"
    ok = verify(app_url, cid, today.isoformat())
    assert ok.status_code == 200, ok.text
    assert (ok.json()["status"], ok.json()["expires_on"]) == ("verified", today.isoformat())
    assert cid not in {c["id"] for c in review_list(app_url, "uploaded")}
    assert cid in {c["id"] for c in review_list(app_url, "verified")}
    mine = next(c for c in my_credentials(app_url, "ines") if c["id"] == cid)
    assert (mine["status"], mine["expires_on"]) == ("verified", today.isoformat())
    assert_error(verify(app_url, cid, today.isoformat()), 409, "invalid_transition")


def test_storage_outage(app_url: str) -> None:
    down = os.environ[MINIO_DOWN_ENV]
    iid = interpreter_id_of(app_url, "wren")
    keys_before = set(S3().keys(f"credentials/{iid}/"))
    count_before = len(my_credentials(app_url, "wren"))
    assert_error(upload(down, "wren", "CDI", PDF + tag().encode()), 503, "storage_unavailable")
    assert len(my_credentials(app_url, "wren")) == count_before
    assert set(S3().keys(f"credentials/{iid}/")) == keys_before
    stored_one = upload(app_url, "wren", "CDI", PDF + tag().encode())
    assert stored_one.status_code == 201
    assert_error(api(down, COORDINATOR).get(f"/api/credentials/{stored_one.json()['id']}/file"), 503,
                 "storage_unavailable")
    assert api(down, COORDINATOR).get("/api/requests").status_code == 200
    draft = create(down, "HPMC", far_start(), SOLO_MAX_MINUTES)
    assert draft["status"] == "draft"
    assert api(down, INTERPRETERS["wren"][0]).get("/api/me/credentials").status_code == 200


def test_wf_credentials_renewal(browser: Any, app_url: str) -> None:
    expiry = renewal_expiry(app_url)
    job = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=datetime.combine(expiry, dtime(13, 0)))
    marker = tag()
    file_name = f"{marker}.pdf"
    content = PDF + marker.encode()
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, INTERPRETERS["ines"][0])
        page.goto(f"{app_url}/profile")
        form = page.get_by_role("form", name="Upload certificate")
        select(form.get_by_role("combobox", name="Credential type"), "NIC")
        page.get_by_label("Certificate file").set_input_files(
            {"name": file_name, "mimeType": "application/pdf", "buffer": content})
        click(form.get_by_role("button", name="Upload certificate"))
        expect(status(page, "Upload status")).to_contain_text("Certificate uploaded. A coordinator will verify it.")
        cred = poll(lambda: [c for c in my_credentials(app_url, "ines") if c["file_name"] == file_name],
                    lambda found: len(found) == 1)[0]
        assert cred["status"] == "uploaded"
        key = f"credentials/{interpreter_id(app_url, cred['id'])}/{cred['id']}.pdf"
        assert S3().get(key) == content
        sole_awaiting(app_url, "ines", "NIC", cred["id"])
        with app_page(browser, app_url) as coord:
            coord.set_viewport_size(DESKTOP)
            sign_in(coord, app_url, COORDINATOR)
            coord.goto(f"{app_url}/credentials")
            table = coord.get_by_role("table", name="Credentials awaiting review")
            row = table.get_by_role("row").filter(has=coord.get_by_role(
                "button", name=CRED_VERIFY.format(name=INTERPRETERS["ines"][1], type="NIC")))
            expect(row).to_have_count(1)
            with coord.expect_popup() as popup:
                click(row.get_by_role("button", name=CRED_VIEW.format(name=INTERPRETERS["ines"][1], type="NIC")))
            assert popup.value is not None
            link = api(app_url, COORDINATOR).get(f"/api/credentials/{cred['id']}/file")
            assert link.status_code == 200, link.text
            assert key in link.json()["url"]
            fill(row.get_by_role("textbox", name=CRED_EXPIRY.format(name=INTERPRETERS["ines"][1], type="NIC")),
                 expiry.isoformat())
            click(row.get_by_role("button", name=CRED_VERIFY.format(name=INTERPRETERS["ines"][1], type="NIC")))
            expect(status(coord, "Review status")).to_contain_text(
                f"Verified NIC for Ines P., valid through {long_date(expiry)}.")
            expect(table.get_by_role("row").filter(has=coord.get_by_role(
                "button", name=CRED_VERIFY.format(name=INTERPRETERS["ines"][1], type="NIC")))).to_have_count(0)
        page.goto(f"{app_url}/profile")
        expect(page.get_by_role("table", name="My credentials").get_by_text("Verified").first).to_be_visible()
        page.goto(f"{app_url}/open-seats")
        expect(page.get_by_role("list", name="Open seats").get_by_role(
            "link", name=f"View job {job['reference']}")).to_be_visible()
    verified = next(c for c in my_credentials(app_url, "ines") if c["id"] == cred["id"])
    assert (verified["status"], verified["expires_on"]) == ("verified", expiry.isoformat())
    assert seat_of(job, "A")["id"] in open_seat_ids(app_url, "ines")


def test_wf_credentials_storage_outage(browser: Any, app_url: str) -> None:
    down = os.environ[MINIO_DOWN_ENV]
    marker = tag()
    existing = upload(app_url, "wren", "CDI", PDF + marker.encode(), filename=f"{marker}.pdf")
    assert existing.status_code == 201
    iid = interpreter_id_of(app_url, "wren")
    keys_before = set(S3().keys(f"credentials/{iid}/"))
    count_before = len(my_credentials(app_url, "wren"))
    start = far_start()
    open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=start)
    sole_awaiting(app_url, "wren", "CDI", existing.json()["id"])
    with app_page(browser, down) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, down, INTERPRETERS["wren"][0])
        page.goto(f"{down}/profile")
        form = page.get_by_role("form", name="Upload certificate")
        select(form.get_by_role("combobox", name="Credential type"), "CDI")
        page.get_by_label("Certificate file").set_input_files(
            {"name": "renewal.pdf", "mimeType": "application/pdf", "buffer": PDF + tag().encode()})
        click(form.get_by_role("button", name="Upload certificate"))
        expect(status(page, "Upload status")).to_contain_text(STORAGE_COPY)
    with app_page(browser, down) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, down, COORDINATOR)
        page.goto(f"{down}/credentials")
        row = page.get_by_role("table", name="Credentials awaiting review").get_by_role("row").filter(
            has=page.get_by_role("button", name=CRED_VERIFY.format(name=INTERPRETERS["wren"][1], type="CDI")))
        expect(row).to_have_count(1)
        click(row.get_by_role("button", name=CRED_VIEW.format(name=INTERPRETERS["wren"][1], type="CDI")))
        expect(status(page, "Review status")).to_contain_text(STORAGE_COPY)
        page.goto(board_url(down, start))
        expect(page.get_by_role("region", name="Week board").get_by_role(
            "heading", level=1, name=f"Week of {mon_d(monday(start))}")).to_be_visible()
    assert len(my_credentials(app_url, "wren")) == count_before
    assert set(S3().keys(f"credentials/{iid}/")) == keys_before


def test_free_cancellation_cutoff(app_url: str) -> None:
    for start, expected in (CUTOFF_SPRING, CUTOFF_FALL):
        draft = create(app_url, "HPMC", start, SOLO_MAX_MINUTES)
        assert draft["free_cancel_until"] == expected
    for start in (CUTOFF_SKIPPED_START, CUTOFF_REPEATED_START):
        draft = create(app_url, "HPMC", start, SOLO_MAX_MINUTES)
        got = datetime.fromisoformat(draft["free_cancel_until"])
        want = cutoff_instant(start)
        assert got.astimezone(timezone.utc) == want.astimezone(timezone.utc) \
            and got.utcoffset() == want.utcoffset(), (draft["free_cancel_until"], want.isoformat())
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    q = quote(app_url, job["id"], SCHEDULER["HPMC"]).json()
    assert datetime.fromisoformat(q["free_cancel_until"]) == cutoff_instant(start)
    assert datetime.fromisoformat(job["free_cancel_until"]) == cutoff_instant(start)


def test_fee_shown_before_confirming(app_url: str) -> None:
    start = near_start(app_url)
    job = open_job(app_url, "HPMC", SOLO_MAX_MINUTES + DURATION_MIN, start=start,
                   claims=[("A", "ines"), ("B", "kemi")])
    billable, fee = charge(SOLO_MAX_MINUTES + DURATION_MIN, RATE["HPMC"], 2)
    for email in (SCHEDULER["HPMC"], COORDINATOR):
        r = quote(app_url, job["id"], email)
        assert r.status_code == 200, r.text
        q = r.json()
        assert set(q) == QUOTE_FIELDS
        assert (q["kind"], q["fee"], q["billable_minutes"], q["seats_charged"], q["hourly_rate"]) == \
            ("late", fee, billable, 2, RATE["HPMC"])
        assert datetime.fromisoformat(q["free_cancel_until"]) == cutoff_instant(start)
    r = cancel(app_url, job["id"], "0.00", SCHEDULER["HPMC"])
    assert_error(r, 409, "fee_changed")
    assert r.json()["error"]["quote"] == q
    after = read(app_url, job["id"])
    assert after["status"] == "staffed" and all(s["status"] == "confirmed" for s in after["seats"])
    assert invoice_for(app_url, job["reference"], "late_cancellation") == []
    far = open_job(app_url, "HPMC", MIN_BILLABLE)
    early = quote(app_url, far["id"], SCHEDULER["HPMC"]).json()
    assert (early["kind"], early["fee"]) == ("early", "0.00")
    missing = api(app_url, SCHEDULER["HPMC"]).post(f"/api/requests/{far['id']}/cancel", json={},
                                                   headers={"Idempotency-Key": idempotency_key()})
    assert "expected_fee" in assert_error(missing, 422, "validation")["fields"]
    assert_error(quote(app_url, far["id"], INTERPRETERS["rosa"][0]), 403, "forbidden")
    done = solo_completed(app_url, "HPMC", SOLO_MAX_MINUTES, SOLO_MAX_MINUTES, "theo")
    assert_error(quote(app_url, done["id"], SCHEDULER["HPMC"]), 409, "invalid_transition")


def test_cancellation_effects(app_url: str, mail: Any, killbill: Any) -> None:
    start = near_start(app_url)
    minutes = SOLO_MAX_MINUTES + DURATION_MIN
    job = open_job(app_url, "HPMC", minutes, start=start, claims=[("A", "ines"), ("B", "kemi")])
    seat_ids = {s["id"] for s in job["seats"]}
    billable, fee = charge(minutes, RATE["HPMC"], 2)
    r = cancel(app_url, job["id"], fee, SCHEDULER["HPMC"])
    assert r.status_code == 200, r.text
    assert r.json()["request"]["status"] == "cancelled_late"
    invoice = r.json()["invoice"]
    assert (invoice["kind"], invoice["amount"], invoice["billable_minutes"], invoice["seats"]) == \
        ("late_cancellation", fee, billable, 2)
    for who in ("ines", "kemi"):
        assert not seat_ids & assignment_seat_ids(app_url, who)
    assert any(fee in (h["detail"] or "") for h in history(app_url, job["id"], "cancelled"))
    posted = posted_invoice(app_url, job["reference"], "late_cancellation")
    assert posted["amount"] == fee
    assert_account(killbill, "HPMC")
    receipt = mails_for(mail, by_subject(f"Cancelled: {job['reference']}, fee ${fee}"))
    assert len(receipt) == 1 and recipients(receipt[0]) == [SCHEDULER["HPMC"]]
    assert fee in text(receipt[0]) and str(billable) in text(receipt[0])
    notices = mails_for(mail, by_subject(f"Assignment cancelled: {job['reference']}, {mon_d(start)}"), count=2)
    assert sorted(a for m in notices for a in recipients(m)) == sorted([INTERPRETERS["ines"][0], INTERPRETERS["kemi"][0]])
    for message in receipt + notices:
        assert_private_absent(message, job)
    assert_error(cancel(app_url, job["id"], fee, SCHEDULER["HPMC"]), 409, "invalid_transition")

    far = open_job(app_url, "HPMC", MIN_BILLABLE, claims=[("A", "rosa")])
    r = cancel(app_url, far["id"], "0.00", COORDINATOR)
    assert r.status_code == 200 and r.json()["request"]["status"] == "cancelled_early" and r.json()["invoice"] is None
    assert seat_of(far, "A")["id"] not in assignment_seat_ids(app_url, "rosa")
    assert invoice_for(app_url, far["reference"], "late_cancellation") == []
    assert len(mails_for(mail, by_subject(f"Cancelled: {far['reference']}, fee $0.00"))) == 1
    seatless = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, start=near_start(app_url))
    r = cancel(app_url, seatless["id"], "0.00", SCHEDULER["HPMC"])
    assert r.status_code == 200 and r.json()["request"]["status"] == "cancelled_late" and r.json()["invoice"] is None
    assert invoice_for(app_url, seatless["reference"], "late_cancellation") == []
    draft = create(app_url, "HPMC", far_start(), SOLO_MAX_MINUTES)
    assert cancel(app_url, draft["id"], "0.00", SCHEDULER["HPMC"]).json()["request"]["status"] == "cancelled_early"


def test_wf_cancellation_late_fee(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    start = near_start(app_url)
    minutes = SOLO_MAX_MINUTES + DURATION_MIN
    job = open_job(app_url, "HPMC", minutes, start=start, claims=[("A", "ines")])
    billable, one_fee = charge(minutes, RATE["HPMC"], 1)
    _, two_fee = charge(minutes, RATE["HPMC"], 2)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, SCHEDULER["HPMC"])
        page.goto(f"{app_url}/requests/{job['id']}")
        expect(page.get_by_text(f"Free cancellation ended {cutoff_text(cutoff_instant(start))}")).to_be_visible()
        click(page.get_by_role("button", name="Cancel booking"))
        dialog = page.get_by_role("dialog", name="Cancel booking")
        expect(dialog).to_contain_text(
            f"Late cancellation: ${one_fee} ({billable} minutes × 1 confirmed seats at ${RATE['HPMC']} per hour).")
        assert claim(app_url, "kemi", seat_of(job, "B")["id"]).status_code == 200
        click(dialog.get_by_role("button", name="Confirm cancellation"))
        expect(dialog).to_contain_text(
            f"The fee is now ${two_fee} because the free-cancellation window has closed. Review it and confirm again.")
        expect(dialog).to_contain_text(
            f"Late cancellation: ${two_fee} ({billable} minutes × 2 confirmed seats at ${RATE['HPMC']} per hour).")
        assert read(app_url, job["id"])["status"] == "staffed"
        click(dialog.get_by_role("button", name="Confirm cancellation"))
        expect(status(page, "Request status")).to_contain_text(
            f"{job['reference']} cancelled. Fee: ${two_fee}. A receipt is on its way by email.")
        expect(page.get_by_text("Cancelled (late fee)").first).to_be_visible()
    assert read(app_url, job["id"])["status"] == "cancelled_late"
    posted = posted_invoice(app_url, job["reference"], "late_cancellation")
    assert posted["amount"] == two_fee and posted["seats"] == 2
    assert_account(killbill, "HPMC")
    assert len(mails_for(mail, by_subject(f"Cancelled: {job['reference']}, fee ${two_fee}"))) == 1
    notices = mails_for(mail, by_subject(f"Assignment cancelled: {job['reference']}, {mon_d(start)}"), count=2)
    assert len(notices) == 2


def test_wf_cancellation_free(browser: Any, app_url: str, mail: Any) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa")])
    cutoff = cutoff_text(cutoff_instant(start))
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, SCHEDULER["HPMC"])
        page.goto(f"{app_url}/requests/{job['id']}")
        expect(page.get_by_text(f"Free cancellation until {cutoff}").first).to_be_visible()
        click(page.get_by_role("button", name="Cancel booking"))
        dialog = page.get_by_role("dialog", name="Cancel booking")
        expect(dialog).to_contain_text(f"Free cancellation until {cutoff}. Cancelling now costs $0.00.")
        click(dialog.get_by_role("button", name="Confirm cancellation"))
        expect(status(page, "Request status")).to_contain_text(
            f"{job['reference']} cancelled. Fee: $0.00. A receipt is on its way by email.")
    assert read(app_url, job["id"])["status"] == "cancelled_early"
    assert invoice_for(app_url, job["reference"], "late_cancellation") == []
    assert seat_of(job, "A")["id"] not in assignment_seat_ids(app_url, "rosa")
    assert len(mails_for(mail, by_subject(f"Cancelled: {job['reference']}, fee $0.00"))) == 1
    notice = mails_for(mail, by_subject(f"Assignment cancelled: {job['reference']}, {mon_d(start)}"))
    assert len(notice) == 1 and recipients(notice[0]) == [INTERPRETERS["rosa"][0]]


def test_completion_with_actual_minutes(app_url: str) -> None:
    half = open_job(app_url, "HPMC", MIN_BILLABLE, claims=[("A", "rosa")])
    for bad in (0, ACTUAL_MAX + 1, 12.5, "60"):
        assert "actual_minutes" in assert_error(api(app_url, COORDINATOR).post(
            f"/api/requests/{half['id']}/complete", json={"actual_minutes": bad}), 422, "validation")["fields"]
    assert read(app_url, half["id"])["status"] == "half-staffed"
    assert_error(api(app_url, BILLING).post(f"/api/requests/{half['id']}/complete", json={"actual_minutes": 1}),
                 403, "forbidden")
    done = complete(app_url, half["id"], CR1006_ACTUAL)
    assert (done["status"], done["actual_minutes"]) == ("completed", CR1006_ACTUAL)
    assert history(app_url, half["id"], "completed")
    assert_error(api(app_url, COORDINATOR).post(f"/api/requests/{half['id']}/complete",
                                                json={"actual_minutes": 1}), 409, "invalid_transition")
    staffed = open_job(app_url, "HPMC", SOLO_MAX_MINUTES, claims=[("A", "theo")])
    assert complete(app_url, staffed["id"], ACTUAL_MAX)["actual_minutes"] == ACTUAL_MAX
    submitted = open_job(app_url, "HPMC", SOLO_MAX_MINUTES)
    assert_error(api(app_url, COORDINATOR).post(f"/api/requests/{submitted['id']}/complete",
                                                json={"actual_minutes": 1}), 409, "invalid_transition")
    assert read(app_url, submitted["id"])["status"] == "submitted"


@pytest.mark.parametrize("case", list(CHARGE_CASE_IDS), ids=list(CHARGE_CASE_IDS))
def test_exact_charge_at_close(app_url: str, mail: Any, killbill: Any, case: str) -> None:
    org, seats, actual, published = CHARGE_CASES[case]
    billable, amount = charge(actual, RATE[org], seats)
    if published:
        assert amount == published
    if case == "cr1006-team":
        assert billable == CR1006_BILLABLE
    overrides = {"required_credential": "NIC"} if org == "LKSU" else {}
    team = [("A", "rosa"), ("B", "theo")] if seats == 2 else [("A", "kemi" if org == "ECCC" else "theo")]
    minutes = MIN_BILLABLE if seats == 2 else CR1007_MINUTES
    req = open_job(app_url, org, minutes, claims=team, **overrides)
    complete(app_url, req["id"], actual)
    r = close(app_url, req["id"])
    assert r.status_code == 200, r.text
    invoice = r.json()["invoice"]
    assert set(invoice) == INVOICE_FIELDS
    assert (invoice["amount"], invoice["billable_minutes"], invoice["seats"], invoice["hourly_rate"], invoice["kind"]) \
        == (amount, billable, seats, RATE[org], "interpreting")
    assert r.json()["request"]["status"] == "invoiced"
    posted = posted_invoice(app_url, req["reference"])
    assert posted["amount"] == amount
    assert stored((posted["killbill_invoice_id"],), (amount, cents(amount)))
    assert_account(killbill, org)
    assert_charge_item(killbill, org, req["reference"], amount, "interpreting", posted["killbill_invoice_id"])
    charges = mails_for(mail, by_subject(f"Charges for {req['reference']}: ${amount}"))
    assert len(charges) == 1 and recipients(charges[0]) == [SCHEDULER[org]]
    for fact in (amount, str(billable), RATE[org]):
        assert fact in text(charges[0]), fact
    assert_private_absent(charges[0], req)


def test_one_billing_item_per_charge(app_url: str, killbill: Any) -> None:
    first = solo_completed(app_url, "ECCC", CR1007_MINUTES, CR1007_ACTUAL, "kemi")
    second = solo_completed(app_url, "ECCC", CR1007_MINUTES, CR1007_ACTUAL + INCREMENT, "kemi")
    for req in (first, second):
        assert close(app_url, req["id"]).status_code == 200
    posted = [posted_invoice(app_url, req["reference"]) for req in (first, second)]
    ids = [p["killbill_invoice_id"] for p in posted]
    assert all(ids) and len(set(ids)) == 2
    for req, p in zip((first, second), posted):
        assert len(invoice_for(app_url, req["reference"])) == 1
        assert stored((p["killbill_invoice_id"],), (req["id"], req["reference"]))
        assert_charge_item(killbill, "ECCC", req["reference"], p["amount"], "interpreting", p["killbill_invoice_id"])
    assert_account(killbill, "ECCC")


def test_invoice_pending_and_recovery(app_url: str, killbill: Any) -> None:
    down = os.environ[KILLBILL_DOWN_ENV]
    req = solo_completed(app_url, "ECCC", CR1007_MINUTES, CR1007_ACTUAL, "kemi")
    key = idempotency_key()
    r = close(down, req["id"], key)
    assert r.status_code == 200, r.text
    invoice = r.json()["invoice"]
    assert (invoice["billing_status"], invoice["killbill_invoice_id"]) == ("pending", None)
    assert invoice["amount"] == CR1007_AMOUNT
    assert r.json()["request"]["status"] == "invoiced"
    replay = close(down, req["id"], key)
    assert replay.status_code == 200 and replay.json() == r.json()
    posted = posted_invoice(app_url, req["reference"])
    assert posted["id"] == invoice["id"] and posted["amount"] == CR1007_AMOUNT
    assert len(invoice_for(app_url, req["reference"])) == 1
    assert_account(killbill, "ECCC")
    assert_charge_item(killbill, "ECCC", req["reference"], CR1007_AMOUNT, "interpreting",
                       posted["killbill_invoice_id"])
    assert httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_idempotent_close_and_cancel(app_url: str, mail: Any) -> None:
    req = solo_completed(app_url, "ECCC", CR1007_MINUTES, CR1007_ACTUAL, "kemi")
    other = solo_completed(app_url, "ECCC", CR1007_MINUTES, CR1007_ACTUAL, "kemi")
    key = idempotency_key()
    first = close(app_url, req["id"], key)
    assert first.status_code == 200, first.text
    second = close(app_url, req["id"], key)
    assert second.status_code == 200 and second.json() == first.json()
    assert len(invoice_for(app_url, req["reference"])) == 1
    assert len(history(app_url, req["id"], "closed")) == 1
    subj = f"Charges for {req['reference']}: ${CR1007_AMOUNT}"
    assert len(mails_for(mail, by_subject(subj))) == 1
    assert len([m for m in mail.messages() if subject(m) == subj]) == 1
    assert_error(close(app_url, req["id"]), 409, "invalid_transition")
    assert_error(close(app_url, other["id"], key), 409, "idempotency_key_reused")
    billing = api(app_url, BILLING)
    assert "Idempotency-Key" in assert_error(billing.post(f"/api/requests/{other['id']}/close", json={}), 422,
                                             "validation")["fields"]
    assert "Idempotency-Key" in assert_error(close(app_url, other["id"], "k" * (KEY_MAX + 1)), 422,
                                             "validation")["fields"]
    assert read(app_url, other["id"])["status"] == "completed"
    assert invoice_for(app_url, other["reference"]) == []

    booking = open_job(app_url, "HPMC", MIN_BILLABLE, claims=[("A", "rosa")])
    ckey = idempotency_key()
    done = cancel(app_url, booking["id"], "0.00", SCHEDULER["HPMC"], ckey)
    assert done.status_code == 200, done.text
    again = cancel(app_url, booking["id"], "0.00", SCHEDULER["HPMC"], ckey)
    assert again.status_code == 200 and again.json() == done.json()
    assert_error(cancel(app_url, booking["id"], "1.00", SCHEDULER["HPMC"], ckey), 409, "idempotency_key_reused")
    assert len(history(app_url, booking["id"], "cancelled")) == 1
    receipt = f"Cancelled: {booking['reference']}, fee $0.00"
    assert len(mails_for(mail, by_subject(receipt))) == 1
    assert len([m for m in mail.messages() if subject(m) == receipt]) == 1


def test_invoice_list_search_export(app_url: str) -> None:
    req = solo_completed(app_url, "LKSU", CR1007_MINUTES, CR1007_ACTUAL, "rosa", required_credential="NIC")
    assert close(app_url, req["id"]).status_code == 200
    invoice = posted_invoice(app_url, req["reference"])
    assert set(invoice) == INVOICE_FIELDS
    assert invoice["organisation"]["code"] == "LKSU" and invoice["organisation"]["name"] == ORG_NAME["LKSU"]
    assert datetime.fromisoformat(invoice["created_at"]).utcoffset() is not None
    ref = req["reference"]
    for q in (ref.lower(), ref[3:], ref.upper()):
        assert invoice["id"] in {i["id"] for i in invoices(app_url, BILLING, q)}
        assert invoice["id"] in {i["id"] for i in invoices(app_url, SCHEDULER["LKSU"], q)}
    assert invoices(app_url, BILLING, f"zz{tag()}") == []
    assert_error(api(app_url, INTERPRETERS["rosa"][0]).get("/api/invoices.csv"), 403, "forbidden")
    r = api(app_url, BILLING).get("/api/invoices.csv", params={"q": ref})
    assert r.status_code == 200
    assert r.headers["content-type"].lower().replace(" ", "").startswith("text/csv;charset=utf-8")
    rows = csv_rows(r.content)
    assert ",".join(rows[0]) == CSV_HEADER
    listed = invoices(app_url, BILLING, ref)
    assert [row[0] for row in rows[1:]] == [i["request_reference"] for i in listed]
    mine = [row for row in rows[1:] if row[0] == ref]
    assert mine == [[ref, ORG_NAME["LKSU"], "interpreting", str(invoice["billable_minutes"]), str(invoice["seats"]),
                     invoice["hourly_rate"], invoice["amount"], "posted", invoice["killbill_invoice_id"],
                     invoice["created_at"]]]
    full = csv_rows(api(app_url, BILLING).get("/api/invoices.csv").content)
    assert [row[0] for row in full[1:]] == [i["request_reference"] for i in invoices(app_url, BILLING, "")]
    assert ref in {row[0] for row in csv_rows(api(app_url, SCHEDULER["LKSU"]).get("/api/invoices.csv").content)[1:]}


def test_wf_billing_close_happy(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start, claims=[("A", "rosa"), ("B", "theo")])
    billable, amount = charge(CR1006_ACTUAL, RATE["HPMC"], 2)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, COORDINATOR)
        page.goto(board_url(app_url, start))
        click(board_row(page, job["reference"]))
        pane = job_pane(page)
        fill(pane.get_by_role("spinbutton", name="Actual minutes"), str(CR1006_ACTUAL))
        click(pane.get_by_role("button", name="Mark completed"))
        expect(status(page, "Job status")).to_contain_text(
            f"{job['reference']} marked completed at {CR1006_ACTUAL} minutes.")
    done = read(app_url, job["id"])
    assert (done["status"], done["actual_minutes"]) == ("completed", CR1006_ACTUAL)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, BILLING)
        table = page.get_by_role("table", name="Ready to close")
        button = table.get_by_role("button", name=f"Close {job['reference']}")
        with hold(page, CLOSE_GLOB) as gate:
            click(button)
            expect(status(page, "Billing status")).to_contain_text(f"Closing {job['reference']}…")
            expect(button).to_be_disabled()
            gate.release()
        expect(status(page, "Billing status")).to_contain_text(f"{job['reference']} invoiced at ${amount}.")
        expect(table.get_by_role("button", name=f"Close {job['reference']}")).to_have_count(0)
    posted = posted_invoice(app_url, job["reference"])
    assert (posted["amount"], posted["billable_minutes"], posted["seats"]) == (amount, billable, 2)
    assert_account(killbill, "HPMC")
    assert len(mails_for(mail, by_subject(f"Charges for {job['reference']}: ${amount}"))) == 1


def test_wf_billing_close_outage(browser: Any, app_url: str, killbill: Any) -> None:
    down = os.environ[KILLBILL_DOWN_ENV]
    req = solo_completed(app_url, "ECCC", CR1007_MINUTES, CR1007_ACTUAL, "kemi")
    with app_page(browser, down) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, down, BILLING)
        click(page.get_by_role("table", name="Ready to close").get_by_role("button", name=f"Close {req['reference']}"))
        expect(status(page, "Billing status")).to_contain_text(
            f"{req['reference']} closed at ${CR1007_AMOUNT}. Invoice pending: it posts to billing automatically once "
            "the billing system responds.")
    assert read(app_url, req["id"])["status"] == "invoiced"
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, BILLING)
        page.goto(f"{app_url}/invoices")
        search = page.get_by_role("searchbox", name="Search invoices")
        fill(search, req["reference"])
        search.press("Enter")
        row = page.get_by_role("table", name="Invoices").get_by_role("row").filter(has_text=req["reference"])
        eventually(page, lambda: expect(row).to_contain_text("Posted", timeout=SHORT_MS),
                   seconds=POST_WITHIN_S + POST_MARGIN_S, step_ms=REFRESH_MS)
        posted = posted_invoice(app_url, req["reference"])
        expect(row).to_contain_text(posted["killbill_invoice_id"])
    assert len(invoice_for(app_url, req["reference"])) == 1
    assert_account(killbill, "ECCC")


def test_wf_invoices_happy(browser: Any, app_url: str) -> None:
    req = solo_completed(app_url, "LKSU", CR1007_MINUTES, CR1007_ACTUAL, "rosa", required_credential="NIC")
    _, amount = charge(CR1007_ACTUAL, RATE["LKSU"], 1)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, BILLING)
        page.wait_for_url(re.compile(r"/billing"))
        click(page.get_by_role("table", name="Ready to close").get_by_role("button", name=f"Close {req['reference']}"))
        expect(status(page, "Billing status")).to_contain_text(f"{req['reference']} invoiced at ${amount}.")
        posted = posted_invoice(app_url, req["reference"])
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Invoices"))
        search = page.get_by_role("searchbox", name="Search invoices")
        fill(search, req["reference"].lower())
        search.press("Enter")
        row = page.get_by_role("table", name="Invoices").get_by_role("row").filter(has_text=req["reference"])
        eventually(page, lambda: expect(row).to_contain_text("Posted", timeout=SHORT_MS), step_ms=REFRESH_MS)
        for part in (posted["killbill_invoice_id"], amount, "Interpreting", ORG_NAME["LKSU"]):
            expect(row).to_contain_text(part)
        href = page.get_by_role("link", name="Export CSV").get_attribute("href")
        export = page.request.get(urljoin(page.url, href))
        assert export.ok
        rows = csv_rows(export.body())
        mine = [r for r in rows[1:] if r[0] == req["reference"]]
        assert len(mine) == 1 and mine[0][6] == amount and mine[0][7] == "posted"
        assert mine[0][8] == posted["killbill_invoice_id"]
    assert read(app_url, req["id"])["status"] == "invoiced"


def test_wf_invoices_client_search(browser: Any, app_url: str) -> None:
    req = solo_completed(app_url, "HPMC", SOLO_MAX_MINUTES, SOLO_MAX_MINUTES, "theo")
    assert close(app_url, req["id"]).status_code == 200
    posted = posted_invoice(app_url, req["reference"])
    for email, visible in ((SCHEDULER["HPMC"], True), (SCHEDULER["ECCC"], False)):
        with app_page(browser, app_url) as page:
            page.set_viewport_size(DESKTOP)
            sign_in(page, app_url, email)
            page.goto(f"{app_url}/invoices")
            search = page.get_by_role("searchbox", name="Search invoices")
            fill(search, req["reference"][3:])
            search.press("Enter")
            rows = page.get_by_role("table", name="Invoices").get_by_role("row").filter(has_text=req["reference"])
            if visible:
                expect(rows).to_have_count(1)
                expect(rows).to_contain_text(posted["amount"])
            else:
                expect(rows).to_have_count(0)
    assert invoices(app_url, SCHEDULER["ECCC"], req["reference"]) == []


def _npm_roots() -> list[Path]:
    roots = []
    with contextlib.suppress(ImportError):
        roots.append(Path(str(_helper("DEPLOYED_APP"))))
    roots.append(Path("/app"))
    return roots


def _npm_tree() -> dict[str, Any]:
    roots = _npm_roots()
    installed = next((r for r in roots if (r / "node_modules").is_dir()), roots[-1])
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=installed,
                         capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
    assert out.stdout.strip(), out.stderr[-2000:]
    return json.loads(out.stdout)


def _shipped(tree: dict[str, Any]) -> dict[tuple[str, str], str]:
    found: dict[tuple[str, str], str] = {}

    def walk(deps: dict[str, Any]) -> None:
        for name, node in (deps or {}).items():
            version = node.get("version", "")
            licence = node.get("license")
            if isinstance(licence, dict):
                licence = licence.get("type")
            if not licence:
                candidates = [Path(node["path"])] if node.get("path") else []
                candidates += [root / "node_modules" / name for root in _npm_roots()]
                for folder in candidates:
                    with contextlib.suppress(OSError, ValueError):
                        licence = json.loads((folder / "package.json").read_text()).get("license")
                    if licence:
                        break
            found[(name, version)] = licence if isinstance(licence, str) else ""
            walk(node.get("dependencies", {}))

    walk(tree.get("dependencies", {}))
    return found


def _allowed(expression: str) -> bool:
    cleaned = expression.replace("(", " ").replace(")", " ")
    if " OR " in cleaned:
        return any(_allowed(part) for part in cleaned.split(" OR "))
    return all(part.strip() in LICENCES for part in cleaned.split(" AND "))


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert all(isinstance(v, str) for v in manifest.values())
    assert manifest["_schema"] == "run-manifest-v1"


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for (name, version), _ in _shipped(_npm_tree()).items():
        assert name in notices, name
        assert version in notices, f"{name}@{version}"
    for font in FONTS:
        assert font in notices, font


def test_if_licences() -> None:
    bad = {f"{n}@{v}": lic for (n, v), lic in _shipped(_npm_tree()).items() if not _allowed(lic)}
    assert not bad, bad
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert "OFL-1.1" in notices
    for font in FONTS:
        lines = [line for line in notices.splitlines() if font in line]
        assert any("OFL" in line for line in lines) or "OFL-1.1" in notices, font


def test_if_no_extra_datastore(app_url: str) -> None:
    names = {name for name, _ in _shipped(_npm_tree())}
    assert not names & set(BANNED_STORES), names & set(BANNED_STORES)
    marker = f"diskprobe{tag()}"
    assert upload(app_url, "wren", "CDI", PDF + marker.encode()).status_code == 201
    roots = {Path("/app")}
    with contextlib.suppress(ImportError):
        roots.add(Path(str(_helper("DEPLOYED_APP"))))
    for root in roots:
        for folder, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
            for file in files:
                path = Path(folder) / file
                assert not file.endswith(LOCAL_DB_SUFFIXES), path
                with contextlib.suppress(OSError):
                    if path.stat().st_size <= SCAN_MAX_BYTES:
                        assert marker.encode() not in path.read_bytes(), path


def test_if_service_configuration_unchanged(killbill: Any) -> None:
    assert mail_from_address() == "relay@crosshand.example"
    assert os.environ.get("MAIL_FROM", "Crosshand Relay <relay@crosshand.example>") == \
        "Crosshand Relay <relay@crosshand.example>"
    assert killbill.account_by_key(f"crosshand-missing{tag()}") is None
    assert isinstance(S3().keys("credentials/"), list)
    assert Postgres().tables()


def test_if_same_origin_assets(browser: Any, app_url: str) -> None:
    seen: list[str] = []
    start = far_start()
    job = open_job(app_url, "HPMC", MIN_BILLABLE, start=start)
    visits = {COORDINATOR: [board_url(app_url, start, job["id"]), f"{app_url}/credentials"],
              INTERPRETERS["ines"][0]: [f"{app_url}/open-seats", f"{app_url}/profile"],
              SCHEDULER["HPMC"]: [f"{app_url}/requests/new", f"{app_url}/requests/{job['id']}", f"{app_url}/invoices"],
              BILLING: [f"{app_url}/billing"]}
    for email, urls in visits.items():
        with app_page(browser, app_url) as page:
            page.on("request", lambda rq: seen.append(rq.url))
            page.set_viewport_size(DESKTOP)
            sign_in(page, app_url, email)
            for url in urls:
                page.goto(url)
                page.wait_for_load_state("networkidle")
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_lockfile() -> None:
    manifest = json.loads(Path("/app/package.json").read_text())
    lock = json.loads(Path("/app/package-lock.json").read_text())
    assert lock.get("name") == manifest.get("name")
    root = lock.get("packages", {}).get("", {})
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        assert (root.get(section) or {}) == (manifest.get(section) or {}), section
