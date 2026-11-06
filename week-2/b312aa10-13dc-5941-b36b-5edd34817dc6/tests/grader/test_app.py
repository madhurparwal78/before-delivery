from __future__ import annotations

import calendar
import csv
import io
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import unicodedata
import uuid
import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page

from conftest import (
    AXE, KillBill, Mailpit, Postgres, S3, addresses, advance, animations, click, fill, focused_name,
    held, idempotency_key, layout, mail_from_address, open_app, same_origin, seek_rects, select, serve_copy,
    style, tab_order, text, unique,
)

PASSWORD = "lineboard-demo"
COOKIE = "lineboard_session"
COOKIE_HTTPONLY = "HttpOnly"
COOKIE_SAMESITE = "SameSite=Lax"
OPS_N, LEAD_N = "ops@northside.example", "lead@northside.example"
ADA, KOFI = "ada@bellobakes.example", "kofi@smokestack.example"
RINA, NADIA = "rina@satopickle.example", "nadia@okorospice.example"
OPS_H, LEAD_H, OMAR = "ops@harbor.example", "lead@harbor.example", "omar@haddadhummus.example"
TZ_N, TZ_H = "America/New_York", "America/Chicago"
KITCHEN_N = "Northside Commissary"
N_STATIONS = ["stn_prep1", "stn_prep2", "stn_oven1", "stn_oven2", "stn_shelfA", "stn_shelfB"]
N_NAMES = {"stn_prep1": "Prep Station 1", "stn_prep2": "Prep Station 2", "stn_oven1": "Oven 1",
           "stn_oven2": "Oven 2", "stn_shelfA": "Walk-in Shelf A", "stn_shelfB": "Walk-in Shelf B",
           "stn_line1": "Line 1", "stn_ovenA": "Oven A", "stn_shelf1": "Walk-in Shelf 1"}
N_HOURLY = ["stn_prep1", "stn_prep2", "stn_oven1", "stn_oven2"]
H_HOURLY = ["stn_line1", "stn_ovenA"]
H_STATIONS = {"stn_line1", "stn_ovenA", "stn_shelf1"}
OVEN_STD, OVEN_PEAK = 3750, 5225
PREP_STD = 1875
SHELF_DAY = 640
ALLOW = {"mem_ada": 40, "mem_kofi": 20, "mem_rina": 8, "mem_nadia": 12, "mem_omar": 30}
DST_GAP_DATE = "2027-03-14"
OCCUPYING = {"held", "confirmed", "checked_in", "completed", "no_show"}
BOOKING_KEYS = {"id", "memberId", "businessName", "stationId", "stationName", "kind", "localDate", "localStart",
                "localEnd", "days", "start", "end", "status", "billingStatus", "hours", "peakHours", "chargeCents",
                "penaltyCents", "penaltyWaived", "conflict", "seriesId", "notes", "holdExpiresAt", "confirmedAt",
                "actions", "version"}
BOOKED_KEYS = {"id", "stationId", "localDate", "localStart", "localEnd", "days", "start", "end", "status"}
KITCHEN_KEYS = {"id", "name", "slug", "timeZone", "today", "currentMonth", "peakWindows", "requiredDocuments",
                "rulesVersion"}
DOC_KEYS = {"id", "memberId", "businessName", "type", "expiryDate", "status", "current", "fileName", "contentType",
            "sizeBytes", "uploadedAt", "approvedAt", "version"}
CSV_HEADER = ("booking_id,member_id,business_name,station,date,start,end,hours,peak_hours,shelf_days,status,"
              "charge,penalty,billing_status,hour_bank_balance,notes")
NUMERIC_COLS = ["hours", "peak_hours", "shelf_days", "charge", "penalty", "hour_bank_balance"]
NUMERIC_RE = re.compile(r"^-?\d+(\.\d+)?$")
FORBIDDEN_KEY_PARTS = ["password", "hash", "killbill", "accountid", "storagekey", "objectkey", "bucket", "sessionid"]
LEAK_LITERALS = ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "getaddrinfo", "AggregateError",
                 "127.0.0.1", "localhost", "node_modules", "SELECT ", "INSERT INTO", "UPDATE "]
LEAK_CI = ["postgres", "minio", "killbill", "kitchens/"]
LEAK_ENV = ["KILLBILL_URL", "S3_ENDPOINT", "S3_BUCKET", "DATABASE_URL", "SMTP_HOST", "KILLBILL_USERNAME",
            "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET", "S3_ACCESS_KEY_ID",
            "S3_SECRET_ACCESS_KEY"]
LEAK_MIN_LEN = 12
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}
FONTS = ["Archivo Black", "IBM Plex Sans"]
APP_DIR = "/app"
BODY_LIMIT = 100000
FILE_LIMIT = 5000000
MAX_FAILS = 5
SIGNIN_WINDOW = 900
REFRESH_MS = 15000
LINKS_REFRESH_MS = 10000
BANNER_MS = 1000
PICKER_DEBOUNCE_MS = 250
DROP_MS = 360
MIN_TARGET = 44
MIN_LANE = 56
MIN_FONT = 16
NAME_MAX, NOTES_MAX, REASON_MAX, TASK_MAX = 80, 500, 120, 120
RECOVERY_S = 30
LINK_MAX_DAYS = 30
SWITCH = 768
DESKTOP, TABLET, PHONE = (1280, 800), (768, 1024), (375, 812)
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
DOC_HEADERS = ["Business", "Type", "Status", "Version", "File", "Expires", "Actions"]
LINK_HEADERS = ["Email", "Expires", "Status", "Last opened", "Views", "Downloads"]
AREA = "Prep stations"

ERR = {
    "bad_request": "The request body is not valid JSON.",
    "idempotency_key_required": "Send an Idempotency-Key header of 8 to 128 letters, digits, hyphens or underscores.",
    "unauthenticated": "Sign in to continue.",
    "invalid_credentials": "Email or password is incorrect.",
    "forbidden": "Your role cannot do that.",
    "cross_origin": "Requests from other sites are refused.",
    "not_found": "That was not found.",
    "member_not_found": "That member was not found.",
    "read_only": "Inspector links are read-only.",
    "idempotency_key_reused": "This request was already used for something else. Reload and try again.",
    "billing_pending": "Some charges are still waiting for billing. Try again once they are recorded.",
    "link_expired": "This link has expired.",
    "link_revoked": "This link is no longer active.",
    "stale_move": "This block changed since you picked it up. The board now shows the latest version.",
    "stale_rules": "Kitchen rules changed since you opened Settings. The latest rules are shown.",
    "stale_doc": "This document changed since you opened Documents. The latest version is shown.",
    "payload_too_large": "This file is too large.",
    "unsupported_media_type": "Send JSON with Content-Type application/json.",
    "unsupported_file_type": "Upload a PDF, PNG or JPEG file.",
    "validation_failed": "Check the highlighted fields.",
    "billing_unavailable": "Billing is unavailable. The month stays open; try again when billing is back.",
    "storage_upload": "Document storage is unavailable. Your file was not saved; try again shortly.",
    "storage_download": "Document storage is unavailable. Try again shortly.",
    "role_screen": "That screen is not available for your role.",
    "invalid_link": "This link is not valid.",
}
FIELD = {
    "not_settable": "This field cannot be set.",
    "required": "This field is required.",
    "quarter": "Times must fall on the quarter hour.",
    "wrong_kind": "Move a block to a station of the same kind.",
    "repeat": "Repeat for 1 to 12 weeks.",
    "notes": "Notes can be at most 500 characters.",
    "business": "Business name must be 1 to 80 characters with no line breaks.",
    "rate": "Enter a rate from $0.01 to $1,000.00.",
    "future_rate": "Rate changes must start in the future.",
    "windows": "Peak windows need days and a start before the end, on the quarter hour.",
    "area": "Choose an area.",
    "task": "Describe the task in 1 to 120 characters.",
    "reason": "Give a reason in 1 to 120 characters.",
    "ppm": "Sanitizer strength is 0 to 400 ppm.",
    "initials": "Initials are 1 to 4 letters.",
    "link_expiry": "Choose an expiry in the future, at most 30 days away.",
    "month": "Use a month in the form YYYY-MM.",
    "date": "Use a date in the form YYYY-MM-DD.",
}
BILLING_BANNER = ("Billing is unavailable. Confirmed bookings are saved and marked Pending billing; charges are "
                  "recorded automatically when billing returns.")
STORAGE_BANNER = "Document storage is unavailable. Uploads and downloads are paused; monthly sanitation PDFs are queued."

HTTP_TIMEOUT = 60
POLL_S = 0.3
UI_WAIT = 30
STEP_MS = 100
KB_WAIT = 60
MAIL_WAIT = 30
BOOT_WAIT = 240
SLACK = 20
QUIET_S = 3
SHORT_TTL = 20
SHORT_GRACE = 60
SHORT_WINDOW = 60
NOBODY = object()


def short_url() -> str:
    return os.environ["APP_SHORT_URL"]


def kbdown_url() -> str:
    return os.environ["APP_KILLBILL_DOWN_URL"]


def outage_keys(store: S3, prefix: str) -> set[str]:
    try:
        return set(store.keys(prefix))
    except AssertionError as error:
        if "NoSuchBucket" in str(error):
            return set()
        raise


def s3down_url() -> str:
    return os.environ["APP_MINIO_DOWN_URL"]


def _tick() -> None:
    threading.Event().wait(POLL_S)


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    end = time.monotonic() + seconds
    while True:
        v = fn()
        if v:
            return v
        if time.monotonic() > end:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}")
        _tick()


def quiet(seconds: float = QUIET_S) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        _tick()


def d_add(d: str, n: int) -> str:
    return (dt.date.fromisoformat(d) + dt.timedelta(days=n)).isoformat()


def wd(d: str) -> int:
    return dt.date.fromisoformat(d).weekday()


def month_add(m: str, n: int) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    t = y * 12 + mo - 1 + n
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def month_name(m: str) -> str:
    return f"{calendar.month_name[int(m[5:7])]} {m[:4]}"


def heading_date(d: str) -> str:
    x = dt.date.fromisoformat(d)
    return f"{calendar.day_name[x.weekday()]} {x.day} {calendar.month_name[x.month]} {x.year}"


def money(c: int) -> str:
    return f"{'-' if c < 0 else ''}${abs(c) // 100:,}.{abs(c) % 100:02d}"


def dollars(c: int) -> str:
    return f"{'-' if c < 0 else ''}{abs(c) // 100}.{abs(c) % 100:02d}"


def hrs(h: float) -> str:
    return f"{float(h):.2f}".rstrip("0").rstrip(".")


def half_up(n: int, d: int) -> int:
    return (2 * n + d) // (2 * d)


def label(station: str, d: str, s: str | None = None, e: str | None = None, days: int | None = None) -> str:
    name = N_NAMES.get(station, station)
    if days is not None:
        return f"{name} {d} for {days} {'day' if days == 1 else 'days'}"
    return f"{name} {d} {s}–{e}"


def blabel(b: dict[str, Any]) -> str:
    if b["kind"] == "shelf":
        return label(b["stationId"], b["localDate"], days=b["days"])
    return label(b["stationId"], b["localDate"], b["localStart"], b["localEnd"])


def cents(x: Any) -> int:
    return int((Decimal(str(x)) * 100).to_integral_value())


def mins(t: str) -> int:
    return int(t[:2]) * 60 + int(t[3:])


def hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def path_of(url: str) -> str:
    return urlparse(url).path


def qs(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


def plain_day(d: str, tz: str = TZ_N) -> bool:
    z = ZoneInfo(tz)
    a = dt.datetime.fromisoformat(d + "T00:00").replace(tzinfo=z).utcoffset()
    b = dt.datetime.fromisoformat(d + "T23:00").replace(tzinfo=z).utcoffset()
    return a == b


class Api:
    def __init__(self, base: str, email: str | None = None, *, cookie: str | None = None):
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        if cookie:
            self.c.cookies.set(COOKIE, cookie)
        self.me: dict[str, Any] | None = None
        if email:
            r = self.signin(email)
            assert r.status_code == 200, f"sign-in {email}: {r.status_code} {r.text[:300]}"
            self.me = r.json()["user"]

    def signin(self, email: str, password: str = PASSWORD, **headers: str) -> httpx.Response:
        return self.c.post("/api/session", json={"email": email, "password": password}, headers=headers or None)

    def send(self, method: str, path: str, body: Any = NOBODY, key: str | None = None,
             headers: dict[str, str] | None = None, raw: bytes | str | None = None) -> httpx.Response:
        h = dict(headers or {})
        if key is not None:
            h["Idempotency-Key"] = key
        content = None
        if raw is not None:
            content = raw
            h.setdefault("Content-Type", "application/json")
        elif body is not NOBODY:
            content = json.dumps(body, ensure_ascii=False).encode()
            h.setdefault("Content-Type", "application/json")
        return self.c.request(method, path, content=content, headers=h)

    def get(self, p: str, **k: Any) -> httpx.Response:
        return self.send("GET", p, **k)

    def post(self, p: str, body: Any = NOBODY, **k: Any) -> httpx.Response:
        return self.send("POST", p, body, **k)

    def put(self, p: str, body: Any = NOBODY, **k: Any) -> httpx.Response:
        return self.send("PUT", p, body, **k)

    def patch(self, p: str, body: Any = NOBODY, **k: Any) -> httpx.Response:
        return self.send("PATCH", p, body, **k)

    def delete(self, p: str, **k: Any) -> httpx.Response:
        return self.send("DELETE", p, **k)

    @property
    def cookie(self) -> str:
        return self.c.cookies.get(COOKIE) or ""

    @property
    def mid(self) -> str:
        assert self.me
        return self.me["memberId"]

    def clone(self) -> "Api":
        return Api(self.base, cookie=self.cookie)

    def kitchen(self) -> dict[str, Any]:
        r = self.get("/api/kitchen")
        assert r.status_code == 200, r.text
        return r.json()

    @property
    def today(self) -> str:
        return self.kitchen()["today"]

    @property
    def month(self) -> str:
        return self.kitchen()["currentMonth"]

    def board(self, d: str | None = None) -> dict[str, Any]:
        r = self.get("/api/board" + (f"?date={d}" if d else ""))
        assert r.status_code == 200, r.text
        return r.json()

    def now(self) -> dt.datetime:
        return dt.datetime.fromisoformat(self.board()["now"])

    def name(self, mid: str) -> str:
        return self.get(f"/api/members/{mid}").json()["member"]["businessName"]


def together(fns: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(fns))

    def run(f: Callable[[], Any]) -> Any:
        barrier.wait()
        return f()

    with ThreadPoolExecutor(len(fns)) as ex:
        return list(ex.map(run, fns))


def err(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text[:400]}"
    b = r.json()
    assert b["error"] == code, b
    if message is not None:
        assert b["message"] == message, b
    return b


def hourly_free(b: dict[str, Any], st: str, s: str, e: str) -> bool:
    for x in b["blocks"]:
        if x["stationId"] == st and x.get("localStart") and x["status"] in OCCUPYING | {"booked"} \
                and x["localStart"] < e and x["localEnd"] > s:
            return False
    for w in b["outOfService"]:
        if w["stationId"] == st:
            ws = w["localStart"] if w["localDate"] == b["date"] else "00:00"
            we = w["localEnd"] if w["localDate"] == b["date"] else "24:00"
            if ws < e and we > s:
                return False
    return True


def find_slot(staff: Api, stations: list[str], times: list[tuple[str, str]], *, first: int = 3, last: int = 170,
              weekdays: tuple[int, ...] | None = None, month: str | None = None,
              avoid: tuple[str, ...] = (), plain: bool = False) -> tuple[str, str, str, str]:
    today = staff.today
    tz = staff.board(today)["timeZone"] if plain else TZ_N
    for n in range(first, last + 1):
        d = d_add(today, n)
        if (month and d[:7] != month) or (weekdays is not None and wd(d) not in weekdays) or d in avoid:
            continue
        if d == DST_GAP_DATE or (plain and not plain_day(d, tz)):
            continue
        b = staff.board(d)
        for st in stations:
            for s, e in times:
                if hourly_free(b, st, s, e):
                    return st, d, s, e
    raise AssertionError(f"no free slot on {stations} {times} from day {first} to {last}")


def find_day(staff: Api, need: list[tuple[str, str, str]], *, first: int = 20, plain: bool = True,
             weekdays: tuple[int, ...] = tuple(range(7))) -> str:
    for n in range(first, 170):
        d = d_add(staff.today, n)
        if d == DST_GAP_DATE or (plain and not plain_day(d)) or wd(d) not in weekdays:
            continue
        b = staff.board(d)
        if all(hourly_free(b, *x) for x in need):
            return d
    raise AssertionError(f"no day with {need} all free")


def shelf_left(staff: Api, st: str, d: str) -> int:
    b = staff.board(d)
    cap = next(s["capacity"] for s in b["stations"] if s["id"] == st)
    return cap - sum(1 for x in b["blocks"] if x["stationId"] == st and x["status"] in OCCUPYING)


def find_shelf(staff: Api, st: str, days: int, *, first: int = 3, need: int = 1, empty: bool = False) -> str:
    for n in range(first, 170):
        d = d_add(staff.today, n)
        lefts = [shelf_left(staff, st, d_add(d, i)) for i in range(days)]
        cap = next(s["capacity"] for s in staff.board(d)["stations"] if s["id"] == st)
        if all(x >= need for x in lefts) and (not empty or all(x == cap for x in lefts)):
            return d
    raise AssertionError("no free shelf days")


def slot_near(staff: Api, offsets: tuple[int, ...], length: int = 60) -> tuple[str, str, str, str]:
    b = staff.board()
    tz = ZoneInfo(b["timeZone"])
    now = dt.datetime.fromisoformat(b["now"]).astimezone(tz)
    q = now.replace(second=0, microsecond=0) - dt.timedelta(minutes=now.minute % 15)
    hourly = [s["id"] for s in b["stations"] if s["kind"] == "hourly"]
    for off in offsets:
        su = q.astimezone(dt.timezone.utc) + dt.timedelta(minutes=off)
        s_l, e_l = su.astimezone(tz), (su + dt.timedelta(minutes=length)).astimezone(tz)
        if s_l.date().isoformat() != b["date"]:
            continue
        s, e = s_l.strftime("%H:%M"), e_l.strftime("%H:%M")
        if e_l.date() > s_l.date():
            if e != "00:00":
                continue
            e = "24:00"
        if mins(e) - mins(s) != length:
            continue
        for st in hourly:
            if hourly_free(b, st, s, e):
                return st, b["date"], s, e
    raise AssertionError("no free hourly slot near the kitchen's now on this instance")


SOON = (15, 30, 45)
STARTED = (0, -15, -30, -45)
LATER = (180, 195, 210, 225)
NEAR = (30, 45) + STARTED
BOOK_AHEAD = 180
ACTION_BUTTONS = {"check_in": "Check in", "check_out": "Check out", "no_show": "Mark no-show",
                  "move": "Pick up to move", "cancel": "Cancel booking"}
ACTION_ORDER = ["check_in", "check_out", "no_show", "move", "cancel"]


def hold(api: Api, st: str, d: str, s: str | None = None, e: str | None = None, *, days: int | None = None,
         weeks: int | None = None, notes: str | None = None, key: str | None = None,
         extra: dict[str, Any] | None = None) -> httpx.Response:
    body: dict[str, Any] = {"stationId": st, "date": d}
    if days is None:
        body.update({"start": s, "end": e})
    else:
        body["days"] = days
    if weeks is not None:
        body["repeatWeeks"] = weeks
    if notes is not None:
        body["notes"] = notes
    body.update(extra or {})
    return api.post("/api/bookings", body, key=key or idempotency_key())


def confirm(api: Api, bid: str, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/bookings/{bid}/confirm", {}, key=key or idempotency_key())


def cancel(api: Api, bid: str, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/bookings/{bid}/cancel", {}, key=key or idempotency_key())


def move(api: Api, b: dict[str, Any], st: str, d: str, s: str, e: str, version: int | None = None) -> httpx.Response:
    return api.post(f"/api/bookings/{b['id']}/move", {"stationId": st, "date": d, "start": s, "end": e,
                                                     "version": b["version"] if version is None else version})


def get_booking(api: Api, bid: str) -> dict[str, Any]:
    r = api.get(f"/api/bookings/{bid}")
    assert r.status_code == 200, r.text
    return r.json()["booking"]


def book(api: Api, st: str, d: str, s: str | None = None, e: str | None = None, *, t: list, **kw: Any) -> dict:
    r = hold(api, st, d, s, e, **kw)
    assert r.status_code == 201, f"hold {st} {d} {s}-{e}: {r.status_code} {r.text[:300]}"
    for b in r.json()["bookings"]:
        t.append((b["id"], api))
    c = confirm(api, r.json()["bookings"][0]["id"])
    assert c.status_code in (200, 202), f"confirm: {c.status_code} {c.text[:300]}"
    return c.json()["bookings"][0]


def held_id(api: Api, r: httpx.Response, t: list) -> str:
    assert r.status_code == 201, r.text
    for b in r.json()["bookings"]:
        t.append((b["id"], api))
    return r.json()["bookings"][0]["id"]


@contextmanager
def tidy() -> Iterator[list]:
    ids: list[tuple[str, Api]] = []
    try:
        yield ids
    finally:
        for bid, owner in ids:
            with suppress(Exception):
                if get_booking(owner, bid)["status"] in ("held", "confirmed"):
                    cancel(owner, bid)


@contextmanager
def window(staff: Api, st: str, d: str, s: str, e: str, reason: str = "probe") -> Iterator[dict[str, Any]]:
    r = staff.post("/api/out-of-service", {"stationId": st, "date": d, "start": s, "end": e, "reason": reason})
    assert r.status_code == 201, r.text
    try:
        yield r.json()
    finally:
        with suppress(Exception):
            staff.delete(f"/api/out-of-service/{r.json()['window']['id']}")


def bank(api: Api, mid: str, month: str) -> dict[str, Any]:
    r = api.get(f"/api/members/{mid}/hour-bank?month={month}")
    assert r.status_code == 200, r.text
    return r.json()


def invoice(api: Api, mid: str, month: str) -> dict[str, Any]:
    r = api.get(f"/api/members/{mid}/invoices/{month}")
    assert r.status_code == 200, r.text
    return r.json()


def lines_for(inv: dict[str, Any], bid: str) -> list[dict[str, Any]]:
    return [x for x in inv["lines"] if x["bookingId"] == bid]


def wait_billed(api: Api, bid: str, seconds: float = KB_WAIT) -> dict[str, Any]:
    return poll(lambda: (b := get_booking(api, bid))["billingStatus"] == "billed" and b, seconds, f"{bid} billed")


def put_peaks(ops: Api, windows: list[dict[str, Any]]) -> httpx.Response:
    return ops.put("/api/kitchen/peak-windows", {"windows": windows, "rulesVersion": ops.kitchen()["rulesVersion"]})


def put_required(ops: Api, required: list[str]) -> httpx.Response:
    return ops.put("/api/kitchen/document-requirements",
                   {"required": required, "rulesVersion": ops.kitchen()["rulesVersion"]})


def instant(api: Api, delta: dt.timedelta) -> str:
    b = api.board()
    tz = ZoneInfo(b["timeZone"])
    return (dt.datetime.fromisoformat(b["now"]) + delta).astimezone(tz).replace(microsecond=0).isoformat()


def local_of(iso: str, tzname: str) -> tuple[str, str]:
    x = dt.datetime.fromisoformat(iso).astimezone(ZoneInfo(tzname))
    return x.date().isoformat(), x.strftime("%H:%M")


def export(api: Api, m: str) -> list[dict[str, str]]:
    r = api.get(f"/api/exports/usage.csv?month={m}")
    assert r.status_code == 200, r.text
    return list(csv.DictReader(io.StringIO(r.content.decode("utf-8"))))


def report(api: Api, m: str) -> dict[str, Any]:
    r = api.get(f"/api/reports/utilisation?month={m}")
    assert r.status_code == 200, r.text
    return r.json()


def station(api: Api, st: str) -> dict[str, Any]:
    return next(s for s in api.get("/api/stations").json()["stations"] if s["id"] == st)


def rate_body(rate: dict[str, Any], effective_from: str) -> dict[str, Any]:
    keys = ["offPeakHourlyCents", "peakHourlyCents"] if "offPeakHourlyCents" in rate else ["shelfDayCents"]
    return {**{k: rate[k] for k in keys}, "effectiveFrom": effective_from}


def rates_path(st: str) -> str:
    return f"/api/stations/{st}/rates"


def edit_rates(st: str) -> str:
    return f"Edit rates for {N_NAMES[st]}"


def same_rates(ops: Api, st: str, effective_from: str) -> httpx.Response:
    return ops.post(rates_path(st), rate_body(station(ops, st)["currentRate"], effective_from))


def member_path(mid: str, rest: str = "") -> str:
    return f"/api/members/{mid}{rest}"


def committed(inv: dict[str, Any]) -> bool:
    return str(inv.get("status") or "").lower() == KB_COMMITTED


def transition_msg(word: str) -> str:
    return f"That action is not available for a {word} block."


def oos_msg(station_name: str) -> str:
    return f"{station_name} is out of service then."


def starts(text_: str) -> "re.Pattern[str]":
    return re.compile("^" + re.escape(text_))


def href(loc: Any) -> str:
    return loc.get_attribute("href") or ""


def font_px(loc: Any) -> float:
    return float(style(loc, "font-size")["font-size"].rstrip("px"))


def mark_node(loc: Any) -> None:
    loc.evaluate("el => { el.__verifierMark = 1; }")


def node_marked(loc: Any) -> bool:
    return bool(loc.evaluate("el => el.__verifierMark === 1"))


def focus_in_main(page: Page) -> bool:
    return bool(page.evaluate("document.activeElement && (document.activeElement.tagName === 'MAIN' || "
                              "document.activeElement.getAttribute('role') === 'main')"))


def report_route(month: str) -> "re.Pattern[str]":
    return re.compile(r"/api/reports/utilisation\?month=" + re.escape(month))


KB_COMMITTED = "committed"
ADA_MID = "mem_ada"
KITCHEN_ID_N = "kit_northside"
NORTHSIDE_SLUG = "northside"
PEAK_QUOTE_CENTS = cents("89.75")
PEAK_CONFIRM_CENTS = cents("104.50")
CHARGE_OVEN_18_21 = cents("127.25")
SHELF_NEW_CENTS = cents("7.00")
NEW_STD, NEW_PEAK = 5000, 7000
NEW_OVEN2_STD, NEW_OVEN2_PEAK = 4500, 6000
PROBE_RATE = 100
RATE_TOO_HIGH = 100001
PAST_EFFECTIVE = "2020-01-01T00:00"
FAR_EFFECTIVE = "2031-02-03T04:07"
RATE_AT, RATE_TO = "02:15", "03:15"
TYPED_RATE = "41.00"
NO_SUCH_PATH = "/api/no-such-thing"
BAD_DATE_TEXT = "nope"
BAD_MONTH = "2026-13"
BAD_DATE = "2026-02-30"
BAD_JSON = "{bad json"
PRIVATE_NOTE = "secret dough recipe"
CONFLICT_REASON = "Thermostat fault"
TYPED_EMAIL = "second.inspec"
FORMULA_NOTE = "=SUM(A1:A9)"
CRLF = "\r\n"
SPACED_EMPTY = "{ }"
TOO_MANY_WEEKS = 13
INITIALS = "TL"
BAD_AREA = "Roof"
BAD_INITIALS = "ABCDE"
PPM_TOO_HIGH = 401
CAFE_DECOMPOSED = "Cafe\u0301"
CAFE = unicodedata.normalize("NFC", CAFE_DECOMPOSED)
CSP = "sandbox; default-src 'none'"
SAFE_NAME = re.compile(r"[A-Za-z0-9 ._-]{0,100}")
PROBE_FILE = "card.pdf"
PROBE_PNG_NAME = "card.png"
PAST_DATE = "2020-01-01"
BAD_TYPE = "passport"
HTML_BYTES = b"<html>x</html>"
SVG_NAME, SVG_TYPE = "x.svg", "image/svg+xml"
TRAVERSAL_NAME, HTML_TYPE = "../../evil<script>.html", "text/html"
SWITCH_WAIT = 180
S3DOWN = "-s3down"
S3DOWN_DB = "_s3down"
KBDOWN_DB, KBDOWN_BUCKET = "_kbdown", "-kbdown"
BOARD_GLOB = "**/api/board*"
CONFIRM_GLOB = "**/api/bookings/*/confirm"
CANCEL_GLOB = "**/api/bookings/*/cancel"
APPROVE_GLOB = "**/api/documents/*/approve"
CLOSE_GLOB = "**/api/months/*/close"
LINKS_GLOB = "**/api/inspector-links/*"
CONFIRM_RESPONSE = re.compile(r"/api/bookings/[^/]+/confirm")
PICKER_S_ROUTE = re.compile(r"/api/members\?q=s$")
INVITE_URL = re.compile(r"https?://\S+/inspect/[A-Za-z0-9_-]+")
BANNER_COUNTS = re.compile(r"(\d+) billing items waiting · \d+ storage items waiting")
NEXT_PROBES = ["/" * 2 + "evil.example", "/\\evil.example", "https://evil.example/board", "/%2F/evil.example", "/%252F%252Fevil.example", "/inspect/abc", "/board%0A"]


PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 17
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def upload(api: Api, dtype: str, expiry: str, data: bytes = PDF, name: str = "card.pdf",
           ctype: str = "application/pdf", extra: dict[str, str] | None = None) -> httpx.Response:
    fields = {"type": dtype, "expiryDate": expiry}
    fields.update(extra or {})
    return api.c.post("/api/documents", data=fields, files={"file": (name, data, ctype)})


def docs(api: Api, member: str | None = None) -> list[dict[str, Any]]:
    r = api.get("/api/documents" + (f"?memberId={member}" if member else ""))
    assert r.status_code == 200, r.text
    return r.json()["documents"]


def doc(api: Api, did: str) -> dict[str, Any]:
    r = api.get(f"/api/documents/{did}")
    assert r.status_code == 200, r.text
    return r.json()["document"]


def approve(ops: Api, d: dict[str, Any]) -> httpx.Response:
    return ops.post(f"/api/documents/{d['id']}/approve", {"version": d["version"]})


def uploaded(api: Api, ops: Api, dtype: str, expiry: str, *, approve_it: bool = False, name: str = "card.pdf") -> dict:
    r = upload(api, dtype, expiry, name=name)
    assert r.status_code == 201, r.text
    d = r.json()["document"]
    if approve_it:
        a = approve(ops, d)
        assert a.status_code == 200, a.text
        d = a.json()["document"]
    return d


def current_doc(api: Api, mid: str, dtype: str) -> dict[str, Any] | None:
    return next((d for d in docs(api, mid) if d["memberId"] == mid and d["type"] == dtype and d["current"]), None)


def rina_card_until(app_url: str, until: str) -> None:
    ops, rina = Api(app_url, OPS_N), Api(app_url, RINA)
    cur = current_doc(ops, "mem_rina", "food_handler_card")
    if not cur or cur["expiryDate"] < until:
        uploaded(rina, ops, "food_handler_card", until, approve_it=True)


def doc_key(kitchen: str, member: str, doc_id: str) -> str:
    return f"kitchens/{kitchen}/members/{member}/documents/{doc_id}"


def prefix(kitchen: str, member: str) -> str:
    return f"kitchens/{kitchen}/members/{member}/documents/"


def kb_items(kb: KillBill, member: str) -> list[dict[str, Any]]:
    acc = kb.account_by_key(member)
    if not acc:
        return []
    out = []
    for inv in kb.invoices(acc["accountId"]):
        for it in inv.get("items") or []:
            out.append({**it, "_invoice": inv})
    return out


def kb_wait(kb: KillBill, member: str, desc: str, n: int = 1, seconds: float = KB_WAIT) -> list[dict[str, Any]]:
    return poll(lambda: (m := [i for i in kb_items(kb, member) if i.get("description") == desc]) and len(m) >= n and m,
                seconds, f"Kill Bill item {desc!r}")


BOOKKEEPER_DOLLARS = 5.0


def kb_write(kb: KillBill, path: str, line: dict[str, Any]) -> None:
    r = kb.client.post(path, json=[line], headers={"X-Killbill-CreatedBy": "bookkeeper"})
    assert r.status_code in (200, 201), r.text


def kb_amount(inv: dict[str, Any]) -> int:
    return sum(cents(i["amount"]) for i in inv.get("items") or [] if i.get("itemType") != "CBA_ADJ")


def mail_ids(mail: Mailpit) -> set:
    return {m.get("ID") for m in mail.messages(0, settle=0)}


def new_mail(mail: Mailpit, before: set, pred: Callable[[dict], bool], n: int = 1,
             seconds: float = MAIL_WAIT) -> list[dict[str, Any]]:
    def found() -> list[dict[str, Any]]:
        return [m for m in mail.messages(0, settle=0.3) if m.get("ID") not in before and pred(m)]
    end = time.monotonic() + seconds
    got = found()
    while len(got) < n and time.monotonic() < end:
        got = found()
    return [m for m in mail.messages(0, settle=1.5) if m.get("ID") not in before and pred(m)]


def to(m: dict[str, Any]) -> list[str]:
    return [a.lower() for a in addresses(m.get("To"))]


def subj(m: dict[str, Any]) -> str:
    return m.get("Subject") or ""


def close_month(ops: Api, m: str, seconds: float = KB_WAIT) -> httpx.Response:
    end = time.monotonic() + seconds
    while True:
        r = ops.post(f"/api/months/{m}/close", {})
        if r.status_code == 409 and r.json().get("error") == "billing_pending" and time.monotonic() < end:
            _tick()
            continue
        return r


def month_open(ops: Api, m: str) -> bool:
    return invoice(ops, "mem_omar", m)["status"] == "open"


def harbor_open_slot(ops_h: Api, lead_h: Api, times: list[tuple[str, str]], *,
                     skip_current: bool = True) -> tuple[str, str, str, str]:
    for k in range(1 if skip_current else 0, 6):
        m = month_add(ops_h.month, k)
        if not month_open(ops_h, m):
            continue
        with suppress(AssertionError):
            return find_slot(lead_h, H_HOURLY, times, month=m, first=3)
    raise AssertionError("no open Harbor Street month with free time left on this deployment")


def earliest_open(ops: Api) -> str:
    m = ops.month
    for k in range(0, 24):
        if month_open(ops, month_add(m, k)):
            return month_add(m, k)
    raise AssertionError("no open month")


def harbor_closed_with_booking(ops_h: Api, lead_h: Api, omar: Api) -> str:
    for k in range(0, 6):
        m = month_add(ops_h.month, k)
        if not month_open(ops_h, m) and any(r["member_id"] == "mem_omar" and r["status"] != "adjustment"
                                            for r in export(ops_h, m)):
            return m
    st, d, s, e = harbor_open_slot(ops_h, lead_h, [("06:00", "07:00"), ("07:00", "08:00")])
    b = book(omar, st, d, s, e, t=[])
    wait_billed(omar, b["id"])
    r = close_month(ops_h, d[:7])
    assert r.status_code == 200, r.text
    return d[:7]


def make_link(ops: Api, email: str, delta: dt.timedelta = dt.timedelta(days=2)) -> tuple[dict[str, Any], str]:
    r = ops.post("/api/inspector-links", {"email": email, "expiresAt": instant(ops, delta)})
    assert r.status_code == 201, r.text
    link = r.json()["link"]
    return link, link["url"].rsplit("/", 1)[1]


def link_of(ops: Api, lid: str) -> dict[str, Any]:
    return next(x for x in ops.get("/api/inspector-links").json()["links"] if x["id"] == lid)


def inspect(base: str, path: str, method: str = "GET", **kw: Any) -> httpx.Response:
    return httpx.request(method, base.rstrip("/") + path, timeout=HTTP_TIMEOUT, **kw)


def service_status(api: Api) -> dict[str, Any]:
    r = api.get("/api/service-status")
    assert r.status_code == 200, r.text
    return r.json()


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Relay:

    def __init__(self, target_url: str):
        u = urlparse(target_url)
        self.target = (u.hostname, u.port or (443 if u.scheme == "https" else 80))
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.scheme = u.scheme or "http"
        self.alive = False

    @property
    def url(self) -> str:
        return f"{self.scheme}://127.0.0.1:{self.port}"

    def start(self) -> None:
        self.alive = True
        self.sock.listen(64)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while self.alive:
            try:
                c, _ = self.sock.accept()
            except OSError:
                return
            try:
                u = socket.create_connection(self.target)
            except OSError:
                c.close()
                continue
            for a, b in ((c, u), (u, c)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        with suppress(OSError):
            while data := a.recv(65536):
                b.sendall(data)
        with suppress(OSError):
            b.shutdown(socket.SHUT_WR)

    def stop(self) -> None:
        self.alive = False
        with suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()


@contextmanager
def app_copy(**overrides: str) -> Iterator[str]:
    port = free_port()
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = serve_copy(port, log, **overrides)
    base = f"http://127.0.0.1:{port}"

    def up() -> bool:
        if proc.poll() is not None:
            log.seek(0)
            raise AssertionError(f"copy exited {proc.returncode}: {log.read()[-3000:]}")
        with suppress(httpx.HTTPError):
            return httpx.get(base + "/api/health", timeout=5).status_code == 200
        return False
    try:
        poll(up, BOOT_WAIT, "copy health")
        yield base
    finally:
        with suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)


def outage_env(suffix_db: str, suffix_bucket: str) -> dict[str, str]:
    return {"DATABASE_URL": os.environ["DATABASE_URL"] + suffix_db, "S3_BUCKET": os.environ["S3_BUCKET"] + suffix_bucket}


def ui_wait(page: Page, cond: Callable[[], Any], what: str = "", seconds: float = UI_WAIT) -> None:
    end = time.monotonic() + seconds
    last: Exception | None = None
    while True:
        try:
            if cond():
                return
        except Exception as e:
            last = e
        if time.monotonic() > end:
            raise AssertionError(f"UI timed out waiting for {what}: {last}")
        advance(page, STEP_MS)


def shown(loc: Any) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def ann(page: Page) -> str:
    loc = page.get_by_role("status", name="Announcements")
    return loc.first.inner_text() if loc.count() else ""


def alerts(page: Page) -> str:
    return " ".join(a.inner_text() for a in page.get_by_role("alert").all())


def board_region(page: Page) -> Any:
    return page.get_by_role("region", name="Line board")


def blk(page: Page, lbl: str) -> Any:
    return board_region(page).get_by_role("button", name=re.compile("^" + re.escape(lbl) + ","))


def blk_with(page: Page, lbl: str, words: str) -> Any:
    return board_region(page).get_by_role("button", name=re.compile("^" + re.escape(lbl) + ",.*" + re.escape(words)))


def ticket(page: Page, lbl: str) -> Any:
    return page.get_by_role("region", name="Ticket rail").get_by_role("group", name=f"Ticket {lbl}", exact=True)


PEAK_TEXT_JS = """e => { const r = e.getBoundingClientRect(), lane = e.parentElement?.closest('[role=group]') || e.parentElement;
  const words = [];
  for (const n of [e, ...lane.querySelectorAll('*')]) {
    const b = n.getBoundingClientRect();
    if (n !== e && !e.contains(n) && (b.width > r.width + 2 || b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom)) continue;
    words.push(n.innerText || '');
    for (const ps of ['::before', '::after']) words.push(getComputedStyle(n, ps).content || '');
  }
  return words.join(' ').toLowerCase(); }"""


def peak_marked(page: Page, lbl: str) -> bool:
    return "peak" in blk(page, lbl).first.evaluate(PEAK_TEXT_JS)


def contrast_audit(page: Page) -> None:
    advance(page, 2000)
    page.evaluate("() => document.getAnimations().forEach(a => "
                  "{ if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); })")
    page.add_script_tag(path=str(AXE))
    page.evaluate("() => { window.__contrast = null; axe.run(document, {runOnly: {type: 'rule', values: ['color-contrast']}})"
                  ".then(v => { window.__contrast = v.violations.map(x => x.nodes.map(n => n.target)); },"
                  " e => { window.__contrast = String(e); }); }")
    for _ in range(625):
        got = page.evaluate("window.__contrast")
        if got is not None:
            assert got == [], f"contrast violations: {got}"
            return
        advance(page, 16)
    raise AssertionError("contrast audit did not settle under controlled time")


DROP_TARGET_JS = """e => { const r = e.getBoundingClientRect();
  const near = t => { const b = t.getBoundingClientRect();
    return !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom); };
  const all = document.getAnimations().filter(a => a.effect?.target instanceof Element
    && Number.isFinite(a.effect.getComputedTiming().endTime));
  const tiers = [a => a.effect.target === e, a => e.contains(a.effect.target), a => near(a.effect.target)];
  const anims = tiers.map(f => all.filter(f)).find(x => x.length);
  if (!anims) return null;
  const end = a => a.effect.getComputedTiming().endTime;
  return anims.reduce((x, y) => (end(y) > end(x) ? y : x)).effect.target; }"""


COPY_YS_JS = """w => [...document.querySelectorAll('body *')].filter(n => n.getClientRects().length
  && (n.innerText || '').split(/\\s+/).join(' ').trim() === w).map(n => { const r = n.getBoundingClientRect();
  return r.top + r.height / 2; })"""


def drop_path(page: Page, tk: Any, duration_ms: float) -> list[dict[str, float]]:
    for _ in range(3):
        target = tk.evaluate_handle(DROP_TARGET_JS).as_element()
        if target:
            return seek_rects(target)
        advance(page, 16)
    words = " ".join(tk.inner_text().split())
    path = []
    for i in range(12):
        if i:
            advance(page, round(duration_ms / 11))
        ys = page.evaluate(COPY_YS_JS, words)
        path.append({"t": duration_ms * i / 11, "y": max(ys) if ys else float("-inf")})
    return [path[0], max(path, key=lambda p: p["y"])]


def rail(page: Page) -> Any:
    return page.get_by_role("region", name="Ticket rail")


def hour_bank_text(page: Page) -> str:
    return page.get_by_role("group", name="Hour bank").first.inner_text()


def ui_signin(page: Page, base: str, email: str, path: str = "/board") -> None:
    if path_of(page.url) != "/":
        page.goto(base + "/")
    ui_wait(page, lambda: shown(page.get_by_label("Email", exact=True)), "sign-in form")
    fill(page.get_by_label("Email", exact=True), email)
    fill(page.get_by_label("Password", exact=True), PASSWORD)
    click(page.get_by_role("button", name="Sign in"))
    ui_wait(page, lambda: path_of(page.url) == path, f"landing on {path}")


@contextmanager
def ui(browser: Browser, base: str, email: str | None, path: str | None = "/board", *, size=DESKTOP,
       reduced: bool = False, touch: bool = False, clock: dt.datetime | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/", reduced_motion="reduce" if reduced else "no-preference",
                  touch=touch) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if clock is not None:
            page.clock.set_system_time(clock)
        if email:
            ui_signin(page, base, email)
        if path:
            page.goto(base + path)
        yield page


def has_pattern(loc: Any) -> bool:
    return loc.first.evaluate("""(el) => {
      const els = [el, ...el.querySelectorAll('*')];
      for (const e of els) {
        for (const pseudo of [null, '::before', '::after']) {
          const s = getComputedStyle(e, pseudo);
          if ([s.borderTopStyle, s.borderLeftStyle, s.outlineStyle].includes('dashed')) return true;
          if (s.backgroundImage && s.backgroundImage !== 'none') return true;
          if (s.maskImage && s.maskImage !== 'none') return true;
        }
        if (e.getAttribute && (e.getAttribute('stroke-dasharray') || e.tagName.toLowerCase() === 'pattern')) return true;
      }
      return false; }""")


def hit_testable(loc: Any) -> bool:
    return loc.evaluate("""(el) => { const r = el.getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!e && (e === el || el.contains(e)); }""")


def in_viewport(page: Page, loc: Any) -> bool:
    b = loc.bounding_box()
    v = page.viewport_size
    return b is not None and b["x"] >= -1 and b["y"] >= -1 and b["x"] + b["width"] <= v["width"] + 1 \
        and b["y"] + b["height"] <= v["height"] + 1


def real_anims(loc: Any) -> list[dict[str, Any]]:
    return [a for a in animations(loc) if float(a.get("duration") or 0) >= 20]


def ruler_x(page: Page, t: str) -> float:
    ruler = page.get_by_role("list", name="Hour ruler")
    if t == "24:00":
        b = ruler.get_by_role("listitem", name="23:00", exact=True).bounding_box()
        return b["x"] + b["width"]
    b = ruler.get_by_role("listitem", name=f"{t[:2]}:00", exact=True).bounding_box()
    return b["x"] + b["width"] * int(t[3:]) / 60


def tab_to(page: Page, name: str, presses: int = 60) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        if focused_name(page) == name:
            return
    raise AssertionError(f"Tab never reached {name!r}")


def test_session_roles(app_url: str) -> None:
    for email, role, member in [(OPS_N, "operator", None), (LEAD_N, "shift_lead", None), (ADA, "member", "mem_ada")]:
        a = Api(app_url)
        r = a.signin(email)
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {"user", "kitchen"}
        assert set(body["user"]) == {"id", "name", "email", "role", "memberId"}
        assert body["user"]["role"] == role and body["user"]["memberId"] == member
        assert body["kitchen"]["id"] == "kit_northside" and set(body["kitchen"]) == {"id", "name", "slug", "timeZone"}
        sc = [h for h in r.headers.get_list("set-cookie") if h.startswith(COOKIE + "=")]
        assert sc and COOKIE_HTTPONLY.lower() in sc[0].lower() and COOKIE_SAMESITE.lower() in sc[0].lower()
        assert len(a.cookie) >= 32
        assert a.get("/api/session").json() == body
    member, lead, ops = Api(app_url, ADA), Api(app_url, LEAD_N), Api(app_url, OPS_N)
    err(member.get("/api/reports/utilisation"), 403, "forbidden", ERR["forbidden"])
    err(lead.get("/api/reports/utilisation"), 403, "forbidden", ERR["forbidden"])
    err(member.get("/api/sanitation-entries"), 403, "forbidden")
    assert ops.get("/api/reports/utilisation").status_code == 200
    assert lead.get("/api/sanitation-entries").status_code == 200
    a, other = Api(app_url, ADA), Api(app_url, ADA)
    copy = Api(app_url, cookie=a.cookie)
    assert copy.get("/api/session").status_code == 200
    assert a.delete("/api/session").status_code == 204
    err(copy.get("/api/session"), 401, "unauthenticated", ERR["unauthenticated"])
    err(a.get("/api/session"), 401, "unauthenticated")
    assert other.get("/api/session").status_code == 200
    x = Api(app_url, ADA)
    old = x.cookie
    assert x.signin(ADA).status_code == 200 and x.cookie and x.cookie != old
    err(Api(app_url, cookie=old).get("/api/session"), 401, "unauthenticated")


def test_kitchen_scoped_ids(app_url: str) -> None:
    ada, lead_n, ops_n = Api(app_url, ADA), Api(app_url, LEAD_N), Api(app_url, OPS_N)
    jonah, lena, omar = Api(app_url, OPS_H), Api(app_url, LEAD_H), Api(app_url, OMAR)
    with tidy() as t:
        st, d, s, e = find_slot(lead_n, ["stn_prep2"], [("13:00", "14:00")], first=60)
        bid = held_id(ada, hold(ada, st, d, s, e), t)
        unknown = "bk_" + uuid.uuid4().hex
        nf = {"error": "not_found", "message": ERR["not_found"]}
        a, b = jonah.get(f"/api/bookings/{bid}"), jonah.get(f"/api/bookings/{unknown}")
        assert a.status_code == b.status_code == 404 and a.json() == b.json() == nf
        assert cancel(jonah, bid).json() == nf
        assert lena.post(f"/api/bookings/{bid}/check-in", {}).json() == nf
        seed = next(x for x in docs(ops_n) if x["memberId"] == "mem_ada")
        for p in ["/api/members/mem_ada", "/api/members/mem_ada/hour-bank", f"/api/documents/{seed['id']}",
                  f"/api/documents/{seed['id']}/file", f"/api/members/mem_ada/invoices/{d[:7]}"]:
            r = jonah.get(p)
            assert r.status_code == 404 and r.json() == nf, p
        assert jonah.post(rates_path("stn_oven1"),
                          {"offPeakHourlyCents": 100, "peakHourlyCents": 100, "effectiveFrom": "2030-01-01T00:00"}
                          ).json() == nf
        err(hold(omar, "stn_oven2", d, "10:00", "11:00"), 404, "not_found")
        err(lena.post("/api/out-of-service", {"stationId": "stn_oven1", "date": d, "start": "10:00", "end": "11:00",
                                              "reason": "probe"}), 404, "not_found")
        hb = jonah.board(d)
        assert {s["id"] for s in hb["stations"]} == H_STATIONS
        assert all(x["id"] != bid for x in hb["blocks"])
        assert all(m["id"] == "mem_omar" for m in jonah.get("/api/members").json()["members"])
        assert get_booking(ada, bid)["status"] == "held"


def test_own_bookings_only(app_url: str) -> None:
    ada, kofi, lead = Api(app_url, ADA), Api(app_url, KOFI), Api(app_url, LEAD_N)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("14:00", "15:00")], first=61)
        bid = held_id(ada, hold(ada, st, d, s, e), t)
        for resp in [kofi.get(f"/api/bookings/{bid}"), confirm(kofi, bid), cancel(kofi, bid),
                     kofi.get(member_path(ADA_MID, f"/invoices/{d[:7]}")), kofi.get(member_path(ADA_MID, "/hour-bank")),
                     kofi.get(member_path(ADA_MID))]:
            err(resp, 404, "not_found", ERR["not_found"])
        ada_doc = docs(ada)[0]
        err(kofi.get(f"/api/documents/{ada_doc['id']}"), 404, "not_found")
        err(kofi.get(f"/api/documents/{ada_doc['id']}/file"), 404, "not_found")
        assert all(x["memberId"] == "mem_kofi" for x in docs(kofi, "mem_ada"))
        own = kofi.get(f"/api/bookings?month={d[:7]}&memberId=mem_ada").json()["bookings"]
        assert all(x["memberId"] == "mem_kofi" for x in own)
        assert bid not in {x["id"] for x in own}
        assert get_booking(ada, bid)["status"] == "held"


MEMBER_CASES = {"lead_satopickle": (LEAD_N, "satopickle", []), "lead_sato": (LEAD_N, "sato", ["mem_rina"]),
                "ops_sat": (OPS_N, "sat", ["mem_rina"]), "ops_underscore": (OPS_N, "_", []),
                "ops_percent": (OPS_N, "%", []), "ops_email_domain": (OPS_N, "satopickle.example", []),
                "harbor_sato": (OPS_H, "sato", [])}


def test_member_picker_matching(app_url: str) -> None:
    for case, (email, q, want) in MEMBER_CASES.items():
        r = Api(app_url, email).get(f"/api/members?q={quote(q)}")
        assert r.status_code == 200, case
        got = r.json()["members"]
        assert [m["id"] for m in got] == want, case
        if email == LEAD_N:
            assert all("email" not in m for m in got)
    ops = Api(app_url, OPS_N)
    for q in ("Sato".upper(), "rina"):
        assert [m["id"] for m in ops.get(f"/api/members?q={quote(q)}").json()["members"]] == ["mem_rina"]
    allm = ops.get("/api/members").json()["members"]
    assert {"mem_ada", "mem_kofi", "mem_rina", "mem_nadia"} <= {m["id"] for m in allm}
    assert "mem_omar" not in {m["id"] for m in allm}
    err(Api(app_url, ADA).get(f"/api/members?q={quote('sat')}"), 403, "forbidden")


def _walk(obj: Any, out: list[tuple[str, Any]]) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append((k, obj))
            _walk(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _walk(v, out)


def test_member_record_shapes(app_url: str) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    full, slim = {"id", "name", "businessName", "email"}, {"id", "name", "businessName"}
    assert all(set(m) == full for m in ops.get("/api/members").json()["members"])
    assert all(set(m) == slim for m in lead.get("/api/members").json()["members"])
    assert set(ops.get(member_path("mem_rina")).json()["member"]) == full
    assert set(lead.get(member_path("mem_rina")).json()["member"]) == slim
    me = ada.get(member_path(ADA_MID)).json()["member"]
    assert set(me) == full and me["email"] == ADA
    p = ada.patch("/api/members/me", {"businessName": me["businessName"]})
    assert p.status_code == 200 and set(p.json()["member"]) == full
    m = ops.month
    bodies = [ops.get(x).json() for x in ["/api/session", "/api/kitchen", "/api/board", "/api/stations",
                                           f"/api/bookings?month={m}", "/api/documents", "/api/service-status",
                                           "/api/inspector-links", f"/api/reports/utilisation?month={m}",
                                           "/api/sanitation-entries", "/api/sanitation-reports",
                                           f"/api/members/mem_ada/invoices/{m}"]]
    bodies += [ada.get(x).json() for x in ["/api/board", "/api/members/mem_ada/hour-bank", "/api/documents",
                                           f"/api/members/mem_ada/invoices/{m}", f"/api/bookings?month={m}"]]
    bodies += [lead.get("/api/board").json(), err(ada.get("/api/reports/utilisation"), 403, "forbidden")]
    pairs: list[tuple[str, Any]] = []
    for b in bodies:
        _walk(b, pairs)
    for k, owner in pairs:
        assert not any(f in k.lower() for f in FORBIDDEN_KEY_PARTS), k
        if k == "allowanceHours":
            assert set(owner) == {"month", "allowanceHours", "usedHours", "balanceHours"}


def test_signin_throttle(app_url: str) -> None:
    def wrong(base: str, email: str) -> httpx.Response:
        return Api(base).signin(email, "wrong-" + uuid.uuid4().hex)
    _, unknown = unique("throttle")
    assert [wrong(app_url, unknown).status_code for _ in range(MAX_FAILS)] == [401] * MAX_FAILS
    r = wrong(app_url, unknown)
    b = err(r, 429, "rate_limited")
    ra = int(r.headers["Retry-After"])
    assert 0 < ra <= SIGNIN_WINDOW
    n = -(-ra // 60)
    assert b["message"] == f"Too many sign-in attempts. Try again in {n} {'minute' if n == 1 else 'minutes'}."
    _, other = unique("throttle-other")
    err(wrong(app_url, other), 401, "invalid_credentials", ERR["invalid_credentials"])
    _, burst = unique("throttle-burst")
    codes = together([lambda: wrong(app_url, burst) for _ in range(12)])
    assert sorted(c.status_code for c in codes) == [401] * MAX_FAILS + [429] * 7
    base = short_url()
    known = LEAD_H
    assert [wrong(base, known).status_code for _ in range(MAX_FAILS)] == [401] * MAX_FAILS
    r = Api(base).signin(known)
    k = err(r, 429, "rate_limited")
    assert set(k) == set(b) and "Retry-After" in r.headers and int(r.headers["Retry-After"]) <= SHORT_WINDOW
    assert set(err(wrong(base, unknown + "x"), 401, "invalid_credentials")) == {"error", "message"}
    poll(lambda: Api(base).signin(known).status_code == 200, SHORT_WINDOW + SLACK, "throttle window to pass")


XSITE = {"origin_other": {"Origin": "http://evil.example"}, "origin_null": {"Origin": "null"},
         "fetch_cross_site": {"Sec-Fetch-Site": "cross-site"}, "fetch_same_site": {"Sec-Fetch-Site": "same-site"},
         "referer_other": {"Referer": "http://evil.example/page"}}


def test_cross_site_refused(app_url: str) -> None:
    own = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    _, email = unique("xsite")
    seen: list[httpx.Response] = []
    for case, h in XSITE.items():
        r = Api(app_url).signin(email, "nope", **h)
        err(r, 403, "cross_origin", ERR["cross_origin"])
        seen.append(r)
    for ctype, data in [("text/plain", json.dumps({"email": email, "password": "nope"})),
                        ("application/x-www-form-urlencoded", f"email={quote(email)}&password=nope")]:
        r = httpx.post(app_url + "/api/session", content=data, headers={"Content-Type": ctype}, timeout=HTTP_TIMEOUT)
        seen.append(r)
        err(r, 415, "unsupported_media_type", ERR["unsupported_media_type"])
    r = httpx.post(app_url + "/api/session", files={"email": (None, email), "password": (None, "nope")},
                   timeout=HTTP_TIMEOUT)
    err(r, 415, "unsupported_media_type")
    codes = [Api(app_url).signin(email, "nope", Origin=own).status_code for _ in range(MAX_FAILS)]
    assert codes == [401] * MAX_FAILS
    err(Api(app_url).signin(email, "nope", **{"Sec-Fetch-Site": "same-origin"}), 429, "rate_limited")
    ada = Api(app_url, ADA)
    r = ada.delete("/api/session", headers={"Origin": "null"})
    err(r, 403, "cross_origin")
    seen.append(r)
    assert ada.get("/api/session").status_code == 200
    lead = Api(app_url, LEAD_N)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("15:00", "16:00")], first=62)
        key = idempotency_key()
        r = ada.post("/api/bookings", {"stationId": st, "date": d, "start": s, "end": e}, key=key,
                     headers={"Origin": "http://evil.example"})
        err(r, 403, "cross_origin")
        assert hourly_free(lead.board(d), st, s, e)
        r = hold(ada, st, d, s, e, key=key)
        assert r.status_code == 201
        t.append((r.json()["bookings"][0]["id"], ada))
    err(Api(app_url).post(NO_SUCH_PATH, {}, headers={"Origin": "http://evil.example"}), 403, "cross_origin")
    opt = httpx.request("OPTIONS", app_url + "/api/session", headers={"Origin": "http://evil.example",
                                                                       "Access-Control-Request-Method": "POST"},
                        timeout=HTTP_TIMEOUT)
    for r in seen + [opt, ada.get("/api/board", headers={"Origin": "http://evil.example"})]:
        assert not any(k.lower().startswith("access-control-allow") for k in r.headers), r.headers


def test_wf_sessions_and_tenancy_return_to_view(browser: Browser, app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    m = ops.month
    target = f"/invoices?month={m}&member=mem_rina"
    with ui(browser, app_url, None, None) as page:
        page.goto(app_url + target)
        ui_wait(page, lambda: path_of(page.url) == "/" and "next" in qs(page.url), "sign-in redirect")
        assert qs(page.url)["next"] == target
        fill(page.get_by_label("Email", exact=True), OPS_N)
        fill(page.get_by_label("Password", exact=True), "not-the-password")
        click(page.get_by_role("button", name="Sign in"))
        ui_wait(page, lambda: ERR["invalid_credentials"] in alerts(page), "invalid credentials alert")
        assert page.get_by_label("Password", exact=True).input_value() == ""
        assert focused_name(page) == "Email" and qs(page.url).get("next") == target
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        ui_wait(page, lambda: path_of(page.url) == "/invoices", "landing on the invoice")
        assert qs(page.url) == {"month": m, "member": "mem_rina"}
        ui_wait(page, lambda: shown(page.get_by_role("region", name="Invoice")), "invoice region")
        for bad in NEXT_PROBES + [f"/api/exports/usage.csv?month={m}"]:
            page.goto(app_url + "/?next=" + bad)
            ui_wait(page, lambda: path_of(page.url) == "/board", f"board for {bad}")
            assert alerts(page).strip() == "", bad
    with ui(browser, app_url, LEAD_N) as page:
        page.goto(app_url + "/reports")
        ui_wait(page, lambda: path_of(page.url) == "/board" and ERR["role_screen"] in alerts(page), "role refusal")
        page.go_back()
        ui_wait(page, lambda: path_of(page.url) != "/reports", "back never reopens /reports")
        assert path_of(page.url) != "/reports"
    assert ops.get("/api/session").status_code == 200


def test_wf_sessions_and_tenancy_phone_menu(browser: Browser, app_url: str) -> None:
    links = ["Line board", "Documents", "Sanitation"]
    with ui(browser, app_url, LEAD_N, "/board", size=PHONE) as page:
        menu = page.get_by_role("button", name="Menu")
        ui_wait(page, lambda: shown(menu), "Menu button")
        assert menu.get_attribute("aria-expanded") == "false" and menu.get_attribute("aria-controls")
        assert page.get_by_role("navigation", name="Main").count() == 0
        assert page.get_by_role("button", name="Sign out").count() == 0
        names = tab_order(page, 25)
        assert not set(names) & set(links + ["Sign out"]), names
        layout(page)
        click(menu)
        ui_wait(page, lambda: menu.get_attribute("aria-expanded") == "true", "menu open")
        nav = page.get_by_role("navigation", name="Main")
        assert [l.inner_text().strip() for l in nav.get_by_role("link").all()] == links
        assert shown(page.get_by_role("button", name="Sign out")) and focused_name(page) == "Line board"
        advance(page, REFRESH_MS + 1000)
        assert menu.get_attribute("aria-expanded") == "true" and focused_name(page) == "Line board"
        page.keyboard.press("Escape")
        ui_wait(page, lambda: menu.get_attribute("aria-expanded") == "false", "folded by Escape")
        assert focused_name(page) == "Menu"
        click(menu)
        ui_wait(page, lambda: menu.get_attribute("aria-expanded") == "true", "reopened")
        page.mouse.click(PHONE[0] / 2, PHONE[1] - 10)
        ui_wait(page, lambda: menu.get_attribute("aria-expanded") == "false", "folded by outside tap")
        click(menu)
        ui_wait(page, lambda: menu.get_attribute("aria-expanded") == "true", "open for a link")
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Sanitation"))
        ui_wait(page, lambda: path_of(page.url) == "/sanitation", "sanitation screen")
        ui_wait(page, lambda: page.get_by_role("button", name="Menu").get_attribute("aria-expanded") == "false", "folded")
        assert focus_in_main(page)
        page.set_viewport_size({"width": TABLET[0], "height": TABLET[1]})
        ui_wait(page, lambda: page.get_by_role("button", name="Menu").count() == 0 and
                shown(page.get_by_role("navigation", name="Main")), "header navigation")
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        ui_wait(page, lambda: page.get_by_role("button", name="Menu").get_attribute("aria-expanded") == "false", "refold")
    assert Api(app_url, LEAD_N).get("/api/sanitation-entries").status_code == 200


def test_wf_sessions_and_tenancy_member_picker(browser: Browser, app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    m = ops.month
    with ui(browser, app_url, OPS_N, f"/invoices?month={m}") as page:
        box = page.get_by_role("combobox", name="Member")
        ui_wait(page, lambda: shown(box), "member picker")
        assert box.get_attribute("aria-autocomplete") == "list"
        late: list[Any] = []
        page.route(PICKER_S_ROUTE, lambda route: late.append(route))
        box.click()
        page.keyboard.type("s")
        advance(page, PICKER_DEBOUNCE_MS + 50)
        ui_wait(page, lambda: len(late) == 1, "query for s held")
        assert box.get_attribute("aria-expanded") == "true"
        page.keyboard.type("at")
        advance(page, PICKER_DEBOUNCE_MS + 50)
        lb = page.get_by_role("listbox", name="Members")
        ui_wait(page, lambda: lb.get_by_role("option").count() == 1, "sat options")
        late[0].continue_()
        advance(page, 1000)
        opts = [o.inner_text().strip() for o in lb.get_by_role("option").all()]
        assert opts == ["Sato Pickle Co. · Rina Sato"], opts
        assert not box.get_attribute("aria-activedescendant")
        for o in lb.get_by_role("option").all():
            assert in_viewport(page, o) and hit_testable(o)
        before = page.url
        page.keyboard.press("ArrowDown")
        assert box.get_attribute("aria-activedescendant")
        page.keyboard.press("Enter")
        ui_wait(page, lambda: box.get_attribute("aria-expanded") == "false", "listbox closed")
        assert box.input_value() == "Sato Pickle Co. · Rina Sato" and page.url == before
        click(page.get_by_role("button", name="Show invoice"))
        ui_wait(page, lambda: qs(page.url).get("member") == "mem_rina", "address names Rina")
        assert qs(page.url)["month"] == m
    assert invoice(ops, "mem_rina", m)["memberId"] == "mem_rina"


def test_hold_lapses(app_url: str) -> None:
    base = short_url()
    lead, ada, kofi = Api(base, LEAD_N), Api(base, ADA), Api(base, KOFI)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("10:00", "11:00"), ("11:00", "12:00")], first=5)
        r = hold(ada, st, d, s, e)
        assert r.status_code == 201
        b = r.json()["bookings"][0]
        t.append((b["id"], ada))
        assert b["status"] == "held" and b["confirmedAt"] is None and b["actions"][:1] == ["confirm"]
        exp = dt.datetime.fromisoformat(b["holdExpiresAt"])
        gap = (exp - lead.now()).total_seconds()
        assert 0 < gap <= SHORT_TTL + 2
        err(hold(kofi, st, d, s, e), 409, "block_taken")
        assert any(x["id"] == b["id"] for x in ada.board(d)["blocks"])
        poll(lambda: get_booking(ada, b["id"])["status"] == "expired", SHORT_TTL + SLACK, "hold lapse")
        r2 = hold(kofi, st, d, s, e)
        assert r2.status_code == 201
        t.append((r2.json()["bookings"][0]["id"], kofi))


def test_confirm_hold(app_url: str, killbill: KillBill) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("15:00", "17:00")], first=8, weekdays=(0,))
        r = hold(ada, st, d, s, e)
        assert r.status_code == 201
        b = r.json()["bookings"][0]
        t.append((b["id"], ada))
        assert (b["chargeCents"], b["peakHours"]) == (PEAK_QUOTE_CENTS, 1)
        before = bank(ada, "mem_ada", d[:7])
        orig = ops.kitchen()["peakWindows"]
        try:
            weekend = [w for w in orig if "mon" not in w["days"]]
            assert put_peaks(ops, [{"days": ["mon", "tue", "wed", "thu", "fri"], "start": "15:00", "end": "19:00"}]
                             + weekend).status_code == 200
            c = confirm(ada, b["id"])
        finally:
            assert put_peaks(ops, orig).status_code == 200
        assert c.status_code in (200, 202)
        cb = c.json()["bookings"][0]
        assert cb["status"] == "confirmed" and (cb["chargeCents"], cb["peakHours"]) == (PEAK_CONFIRM_CENTS, 2)
        assert cb["confirmedAt"] and set(cb) == BOOKING_KEYS
        hb = c.json()["hourBank"]
        assert hb["month"] == d[:7] and hb["balanceHours"] == before["balanceHours"] - 2
        assert bank(ada, "mem_ada", d[:7])["usedHours"] == before["usedHours"] + 2
        if c.status_code == 202:
            assert cb["billingStatus"] == "pending_billing"
        wait_billed(ada, b["id"])
        it = kb_wait(killbill, "mem_ada", f"Booking {b['id']} {label(st, d, s, e)}")
        assert len(it) == 1 and cents(it[0]["amount"]) == PEAK_CONFIRM_CENTS


def test_idempotent_booking_requests(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    before = mail_ids(mail)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep1"], [("11:00", "12:00"), ("12:00", "13:00")], first=9)
        key = idempotency_key()
        raw1 = json.dumps({"stationId": st, "date": d, "start": s, "end": e})
        raw2 = '{ "end" : "%s",\n "start":"%s", "date": "%s",  "stationId":"%s" }' % (e, s, d, st)
        r1 = ada.post("/api/bookings", raw=raw1, key=key)
        assert r1.status_code == 201
        bid = r1.json()["bookings"][0]["id"]
        t.append((bid, ada))
        r2 = ada.post("/api/bookings", raw=raw2, key=key)
        assert r2.status_code == 201 and r2.content == r1.content
        mine = [x for x in ada.get(f"/api/bookings?month={d[:7]}").json()["bookings"]
                if x["stationId"] == st and x["localDate"] == d and x["localStart"] == s]
        assert len(mine) == 1
        err(ada.post("/api/bookings", {"stationId": st, "date": d, "start": s, "end": "23:00"}, key=key), 409,
            "idempotency_key_reused", ERR["idempotency_key_reused"])
        err(ada.post("/api/bookings", {"stationId": st, "date": d, "start": s, "end": e}), 400,
            "idempotency_key_required", ERR["idempotency_key_required"])
        err(ada.post("/api/bookings", {"stationId": st, "date": d, "start": s, "end": e}, key="short"), 400,
            "idempotency_key_required")
        ck = idempotency_key()
        clients = [ada.clone() for _ in range(5)]

        def fire(i: int, c: Api) -> httpx.Response:
            if i % 2:
                return c.c.post(f"/api/bookings/{bid}/confirm", headers={"Idempotency-Key": ck}, content=b"")
            return c.post(f"/api/bookings/{bid}/confirm", {}, key=ck)
        rs = together([lambda i=i, c=c: fire(i, c) for i, c in enumerate(clients)])
        assert len({(r.status_code, r.content) for r in rs}) == 1 and rs[0].status_code in (200, 202)
        again = ada.post(f"/api/bookings/{bid}/confirm", raw=" { } ", key=ck)
        assert again.content == rs[0].content
        lbl = label(st, d, s, e)
        got = new_mail(mail, before, lambda m: subj(m) == f"Booking confirmed: {lbl}")
        assert len(got) == 1
        assert len(kb_wait(killbill, "mem_ada", f"Booking {bid} {lbl}")) == 1


PRICING = {
    "oven2_weekday_18_21": ("stn_oven2", (0, 1, 2, 3, 4), "18:00", "21:00", None, 12725, 1, 3),
    "oven2_weekday_1830_2000": ("stn_oven2", (0, 1, 2, 3, 4), "18:30", "20:00", None, 6363, 0.5, 1.5),
    "prep1_monday_1545_1645": ("stn_prep1", (0,), "15:45", "16:45", None, 2426, 0.75, 1),
    "oven1_saturday_12_14": ("stn_oven1", (5,), "12:00", "14:00", None, 8975, 1, 2),
    "oven2_sunday_20_24": ("stn_oven2", (6,), "20:00", "24:00", None, 15000, 0, 4),
    "shelfA_three_days": ("stn_shelfA", None, None, None, 3, 1920, 0, 0),
}


@pytest.mark.parametrize("case", list(PRICING), ids=list(PRICING))
def test_block_pricing(app_url: str, case: str) -> None:
    st, days_ok, s, e, days, want, peak, hours = PRICING[case]
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        if days is None:
            st, d, s, e = find_slot(lead, [st], [(s, e)], first=10, weekdays=days_ok)
            b = book(ada, st, d, s, e, t=t)
        else:
            d = find_shelf(lead, st, days, first=10)
            b = book(ada, st, d, days=days, t=t)
        assert (b["chargeCents"], b["peakHours"], b["hours"]) == (want, peak, hours)
        if e == "24:00":
            assert b["localEnd"] == "24:00"
            end = dt.datetime.fromisoformat(b["end"]).astimezone(ZoneInfo(TZ_N))
            assert end.date().isoformat() == d_add(d, 1) and end.strftime("%H:%M:%S") == "00:00:00"


def test_hour_bank(app_url: str) -> None:
    ops, lead, ada, rina = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, RINA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("08:00", "11:00")], first=12, weekdays=(0, 1, 2, 3, 4))
        m = d[:7]
        before = bank(ada, "mem_ada", m)
        assert before["allowanceHours"] == ALLOW["mem_ada"]
        b = book(ada, st, d, s, e, t=t)
        hb = bank(ada, "mem_ada", m)
        assert hb["balanceHours"] == before["balanceHours"] - 3 == hb["allowanceHours"] - hb["usedHours"]
        assert ada.board(d)["hourBank"] == hb and invoice(ops, "mem_ada", m)["hourBank"] == hb
        row = next(r for r in export(ops, m) if r["booking_id"] == b["id"])
        assert float(row["hour_bank_balance"]) == hb["balanceHours"]
        found = None
        limit = d_add(ops.today, BOOK_AHEAD)
        for k in range(2, 6):
            a_month = month_add(ops.month, k)
            nxt = month_add(a_month, 1)
            if bank(rina, "mem_rina", a_month)["usedHours"] or bank(rina, "mem_rina", nxt)["usedHours"]:
                continue
            last = dt.date.fromisoformat(nxt + "-01") - dt.timedelta(days=1)
            for back in range(14, 21):
                start = (last - dt.timedelta(days=back)).isoformat()
                weeks = [d_add(start, 7 * i) for i in range(4)]
                if [w[:7] for w in weeks] == [a_month] * 3 + [nxt] and wd(start) < 5 and weeks[-1] <= limit and \
                        all(hourly_free(lead.board(w), "stn_prep2", "13:00", "16:00") for w in weeks):
                    found = (a_month, nxt, weeks)
                    break
            if found:
                break
        assert found, "no month pair with an unused Rina hour bank"
        a_month, nxt, weeks = found
        rina_card_until(app_url, weeks[-1])
        r = hold(rina, "stn_prep2", weeks[0], "13:00", "16:00", weeks=4)
        b2 = err(r, 422, "validation_failed")
        assert b2["errors"]["hours"] == f"That needs 9 hours; you have 8 left for {month_name(a_month)}."
        assert not [x for x in rina.get(f"/api/bookings?month={a_month}").json()["bookings"]
                    if x["localStart"] == "13:00" and x["stationId"] == "stn_prep2"]
        r = hold(rina, "stn_prep2", weeks[1], "13:00", "16:00", weeks=2)
        assert r.status_code == 201, r.text
        for x in r.json()["bookings"]:
            t.append((x["id"], rina))
        c = confirm(rina, r.json()["bookings"][0]["id"])
        assert c.status_code in (200, 202)
        assert bank(rina, "mem_rina", a_month)["balanceHours"] == 2 and bank(rina, "mem_rina", nxt)["balanceHours"] == 8


def test_confirmation_email(app_url: str, mail: Mailpit) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    before = mail_ids(mail)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("18:00", "21:00")], first=13, weekdays=(0, 1, 2, 3, 4))
        bid = held_id(ada, hold(ada, st, d, s, e), t)
        c = confirm(ada, bid)
        assert c.status_code in (200, 202)
        bal = c.json()["hourBank"]["balanceHours"]
        lbl = label(st, d, s, e)
        got = new_mail(mail, before, lambda m: subj(m) == f"Booking confirmed: {lbl}")
        assert len(got) == 1
        m = got[0]
        assert to(m) == [ADA] and not addresses(m.get("Cc")) and not addresses(m.get("Bcc"))
        assert addresses(m.get("From")) == [mail_from_address()]
        body = text(m)
        name = ada.name("mem_ada")
        for piece in [name, lbl, bid, f"Charge: {money(12725)} for your {month_name(d[:7])} statement",
                      f"{hrs(bal)} hours left in {month_name(d[:7])}"]:
            assert piece in body, piece
        assert "Kofi" not in body and "Smokestack" not in body


def test_wf_book_a_block_rail_drop(browser: Browser, app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    before = mail_ids(mail)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("18:00", "21:00")], first=14, weekdays=(0, 1, 2, 3, 4))
        lbl = label(st, d, s, e)
        start_bal = bank(ada, "mem_ada", d[:7])["balanceHours"]
        with ui(browser, app_url, ADA, f"/board?date={d}") as page:
            ui_wait(page, lambda: shown(page.get_by_role("button", name="New booking")), "board")
            click(page.get_by_role("button", name="New booking"))
            dlg = page.get_by_role("dialog", name="New booking")
            ui_wait(page, lambda: shown(dlg), "New booking")
            select(dlg.get_by_role("combobox", name="Station"), "Oven 2")
            fill(dlg.get_by_role("textbox", name="Date"), d)
            fill(dlg.get_by_role("textbox", name="Start"), s)
            fill(dlg.get_by_role("textbox", name="End"), e)
            click(dlg.get_by_role("button", name="Hold block"))
            ui_wait(page, lambda: shown(ticket(page, lbl)), "ticket on the rail")
            assert "Held until" in ticket(page, lbl).inner_text()
            bid = next(x["id"] for x in ada.get(f"/api/bookings?month={d[:7]}").json()["bookings"]
                       if x["stationId"] == st and x["localDate"] == d and x["localStart"] == s and x["status"] == "held")
            t.append((bid, ada))
            click(ticket(page, lbl).get_by_role("button", name="Confirm"))
            ui_wait(page, lambda: shown(blk_with(page, lbl, "Confirmed")), "block in lane")
            bal = bank(ada, "mem_ada", d[:7])["balanceHours"]
            assert bal == start_bal - 3
            ui_wait(page, lambda: f"{hrs(bal)} h left" in hour_bank_text(page), "hour bank figures")
            ui_wait(page, lambda: peak_marked(page, lbl), "peak band on the block")
            assert f"Oven 2, {s} to {e} booked, {hrs(bal)} hours left, 1 hour at peak" in ann(page)
        b = get_booking(ada, bid)
        assert b["status"] == "confirmed" and b["chargeCents"] == CHARGE_OVEN_18_21
        assert len(kb_wait(killbill, "mem_ada", f"Booking {bid} {lbl}")) == 1
        assert len(new_mail(mail, before, lambda m: subj(m) == f"Booking confirmed: {lbl}")) == 1


def test_wf_book_a_block_phone(browser: Browser, app_url: str, killbill: KillBill) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("18:00", "19:00")], first=15, weekdays=(0, 1, 2, 3, 4))
        lbl = label(st, d, s, e)
        with ui(browser, app_url, ADA, f"/board?date={d}", size=PHONE, reduced=True, touch=True) as page:
            ruler = page.get_by_role("list", name="Hour ruler")
            ui_wait(page, lambda: shown(ruler), "ruler")
            item = ruler.get_by_role("listitem", name="18:00", exact=True)
            item.scroll_into_view_if_needed()
            ib = item.bounding_box()
            lane = board_region(page).get_by_role("group", name="Oven 2", exact=True)
            lb = lane.bounding_box()
            page.touchscreen.tap(ib["x"] + 3, lb["y"] + lb["height"] / 2)
            dlg = page.get_by_role("dialog", name="New booking")
            ui_wait(page, lambda: shown(dlg), "New booking from a tap")
            assert dlg.get_by_role("textbox", name="Date").input_value() == d
            assert dlg.get_by_role("textbox", name="Start").input_value() == s
            assert dlg.get_by_role("textbox", name="End").input_value() == e
            click(dlg.get_by_role("button", name="Hold block"))
            ui_wait(page, lambda: shown(ticket(page, lbl)), "ticket in rail strip")
            bid = next(x["id"] for x in ada.get(f"/api/bookings?month={d[:7]}").json()["bookings"]
                       if x["stationId"] == st and x["localDate"] == d and x["localStart"] == s and x["status"] == "held")
            t.append((bid, ada))
            ui_wait(page, lambda: focused_name(page) == "Confirm", "Confirm focused")
            for n in ("Confirm", "Discard"):
                bb = ticket(page, lbl).get_by_role("button", name=n).bounding_box()
                assert bb["width"] >= MIN_TARGET - 0.5 and bb["height"] >= MIN_TARGET - 0.5
            assert shown(page.get_by_role("group", name="Hour bank"))
            layout(page)
            ticket(page, lbl).get_by_role("button", name="Confirm").tap()
            ui_wait(page, lambda: shown(blk(page, lbl)), "block lands")
            bal = bank(ada, "mem_ada", d[:7])["balanceHours"]
            ui_wait(page, lambda: f"{hrs(bal)} h left" in hour_bank_text(page), "server balance")
            word = "hour" if bal == 1 else "hours"
            assert f"Oven 2, {s} to {e} booked, {hrs(bal)} {word} left, 1 hour at peak" in ann(page)
            layout(page)
        assert get_booking(ada, bid)["status"] == "confirmed"
        kb_wait(killbill, "mem_ada", f"Booking {bid} {lbl}")


def test_one_winner(app_url: str, mail: Mailpit) -> None:
    lead, ops = Api(app_url, LEAD_N), Api(app_url, OPS_N)
    members = [Api(app_url, x) for x in (ADA, KOFI, RINA)]
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven1"], [("09:00", "10:00")], first=20)
        rs = together([lambda c=c: hold(c, st, d, s, e) for c in members * 2])
        wins = [r for r in rs if r.status_code == 201]
        assert len(wins) == 1, [r.status_code for r in rs]
        t.append((wins[0].json()["bookings"][0]["id"], members[rs.index(wins[0]) % 3]))
        for r in rs:
            if r.status_code != 201:
                b = err(r, 409, "block_taken", f"Oven 1 {s} block was taken.")
                assert b["taken"] == [{"stationId": st, "stationName": "Oven 1", "date": d, "start": s, "end": e}]
        assert sum(1 for x in lead.board(d)["blocks"] if x["stationId"] == st and x["localStart"] == s) == 1
        st2, d2, s2, e2 = find_slot(lead, ["stn_prep1"], [("19:00", "20:00")], first=30)
        weeks = [d2, d_add(d2, 7), d_add(d2, 14)]
        assert all(hourly_free(lead.board(w), st2, s2, e2) for w in weeks)
        ada, kofi = members[0], members[1]
        rs2, rk = together([lambda: hold(ada, st2, d2, s2, e2, weeks=3), lambda: hold(kofi, st2, weeks[1], s2, e2)])
        assert sorted([rs2.status_code, rk.status_code]) == [201, 409]
        for r, c in ((rs2, ada), (rk, kofi)):
            if r.status_code == 201:
                for x in r.json()["bookings"]:
                    t.append((x["id"], c))
        if rs2.status_code == 409:
            assert err(rs2, 409, "block_taken")["taken"][0]["date"] == weeks[1]
            for w in (weeks[0], weeks[2]):
                assert hourly_free(lead.board(w), st2, s2, e2)
        else:
            assert len(rs2.json()["bookings"]) == 3
        d3 = find_day(lead, [("stn_prep2", "06:00", "08:00"), ("stn_oven2", "06:00", "07:00")], first=40)
        a = book(ada, "stn_prep2", d3, "07:00", "08:00", t=t)
        b = book(kofi, "stn_oven2", d3, "06:00", "07:00", t=t)
        before = mail_ids(mail)
        r1, r2 = together([lambda: move(ops.clone(), a, "stn_prep2", d3, "06:00", "07:00"),
                           lambda: move(ops.clone(), b, "stn_prep2", d3, "06:00", "07:00")])
        assert sorted([r1.status_code, r2.status_code]) == [200, 409]
        loser = r1 if r1.status_code == 409 else r2
        lb = err(loser, 409, "block_taken")
        assert "current" in lb
        lost = a if loser is r1 else b
        assert get_booking(ops, lost["id"])["version"] == lost["version"]
        moved = new_mail(mail, before, lambda m: subj(m).startswith("Booking moved: "), n=1)
        assert len([m for m in moved if label("stn_prep2", d3, "06:00", "07:00") in subj(m)]) == 1


def test_hour_bank_concurrent(app_url: str, killbill: KillBill) -> None:
    lead, kofi = Api(app_url, LEAD_N), Api(app_url, KOFI)
    slots = [("stn_prep1", "06:00", "10:00"), ("stn_prep1", "10:00", "14:00"), ("stn_prep2", "06:00", "10:00"),
             ("stn_prep2", "10:00", "14:00"), ("stn_oven1", "06:00", "10:00"), ("stn_oven2", "06:00", "10:00")]
    with tidy() as t:
        found = None
        for k in range(1, 6):
            m = month_add(kofi.month, k)
            if bank(kofi, "mem_kofi", m)["usedHours"]:
                continue
            for n in range(3, 175):
                d = d_add(kofi.today, n)
                if d[:7] != m or d == DST_GAP_DATE:
                    continue
                if all(hourly_free(lead.board(d), st, s, e) for st, s, e in slots):
                    found = (m, d)
                    break
            if found:
                break
        assert found, "no month with Kofi's full allowance and six free blocks"
        m, d = found
        ids = [held_id(kofi, hold(kofi, st, d, s, e), t) for st, s, e in slots]
        rs = together([lambda i=i: confirm(kofi.clone(), i) for i in ids])
        codes = [r.status_code for r in rs]
        assert all(c < 500 for c in codes) and sum(c in (200, 202) for c in codes) == 5 and codes.count(422) == 1
        loser = ids[codes.index(422)]
        e422 = err(rs[codes.index(422)], 422, "validation_failed")
        assert e422["errors"]["hours"] == f"That needs 4 hours; you have 0 left for {month_name(m)}."
        assert get_booking(kofi, loser)["status"] == "held"
        hb = bank(kofi, "mem_kofi", m)
        assert (hb["usedHours"], hb["balanceHours"]) == (20, 0)
        for i in ids:
            if i != loser:
                kb_wait(killbill, "mem_kofi", f"Booking {i} {blabel(get_booking(kofi, i))}")
        assert not [x for x in kb_items(killbill, "mem_kofi") if (x.get("description") or "").startswith(f"Booking {loser}")]


def test_shelf_capacity(app_url: str) -> None:
    lead, ada, kofi, rina = (Api(app_url, x) for x in (LEAD_N, ADA, KOFI, RINA))
    with tidy() as t:
        d = find_shelf(lead, "stn_shelfB", 3, first=50, empty=True)
        rina_card_until(app_url, d_add(d, 2))
        held_id(ada, hold(ada, "stn_shelfB", d_add(d, 1), days=1), t)
        rk, rr = together([lambda: hold(kofi, "stn_shelfB", d_add(d, 1), days=1),
                           lambda: hold(rina, "stn_shelfB", d_add(d, 1), days=1)])
        assert sorted([rk.status_code, rr.status_code]) == [201, 409]
        win, win_api = (rk, kofi) if rk.status_code == 201 else (rr, rina)
        lose_api = rina if win_api is kofi else kofi
        wid = win.json()["bookings"][0]["id"]
        t.append((wid, win_api))
        b = err(rr if win_api is kofi else rk, 409, "block_taken", f"Walk-in Shelf B {d_add(d, 1)} was taken.")
        assert b["taken"] == [{"stationId": "stn_shelfB", "stationName": "Walk-in Shelf B", "date": d_add(d, 1),
                               "start": None, "end": None}]
        assert shelf_left(lead, "stn_shelfB", d_add(d, 1)) == 0
        three = err(hold(lose_api, "stn_shelfB", d, days=3), 409, "block_taken")
        assert [x["date"] for x in three["taken"]] == [d_add(d, 1)]
        assert cancel(win_api, wid).status_code == 200
        held_id(lose_api, hold(lose_api, "stn_shelfB", d_add(d, 1), days=1), t)
        assert shelf_left(lead, "stn_shelfB", d_add(d, 1)) == 0


def test_released_holds_gone(app_url: str) -> None:
    ops, lead, ada, kofi = (Api(app_url, x) for x in (OPS_N, LEAD_N, ADA, KOFI))
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("06:00", "08:00")], first=22)
        hk, dk = idempotency_key(), idempotency_key()
        r = hold(ada, st, d, s, e, key=hk)
        bid = r.json()["bookings"][0]["id"]
        rd = cancel(ada, bid, key=dk)
        assert rd.status_code == 200 and rd.json()["booking"]["status"] == "cancelled_free"
        kid = held_id(kofi, hold(kofi, st, d, s, e), t)
        replay = hold(ada, st, d, s, e, key=hk)
        assert replay.status_code == 201 and replay.content == r.content
        assert cancel(ada, bid, key=dk).content == rd.content
        on = [x for x in lead.board(d)["blocks"] if x["stationId"] == st and x["localStart"] == s]
        assert [x["id"] for x in on] == [kid]
        assert bid not in {x["id"] for x in kofi.board(d)["blocks"]}
        assert bid not in {x["id"] for x in ada.get(f"/api/bookings?month={d[:7]}").json()["bookings"]}
        assert bid not in {x["id"] for x in ops.get(f"/api/bookings?month={d[:7]}").json()["bookings"]}
        assert bid not in ops.get(f"/api/exports/usage.csv?month={d[:7]}").text
        assert not lines_for(invoice(ops, "mem_ada", d[:7]), bid)
        g = get_booking(lead, bid)
        assert g["status"] == "cancelled_free" and g["confirmedAt"] is None
    base = short_url()
    sl, sa, sk = Api(base, LEAD_N), Api(base, ADA), Api(base, KOFI)
    with tidy() as t:
        st, d, s, e = find_slot(sl, ["stn_oven2"], [("06:00", "08:00")], first=22)
        bid = held_id(sa, hold(sa, st, d, s, e), t)
        got: list[httpx.Response] = []
        poll(lambda: (r := hold(sk, st, d, s, e)).status_code == 201 and got.append(r) is None,
             SHORT_TTL + SLACK, "lapsed time freed")
        t.append((got[0].json()["bookings"][0]["id"], sk))
        assert bid in {x["id"] for x in sa.board(d)["blocks"] if x["status"] == "expired"}
        assert bid not in {x["id"] for x in sk.board(d)["blocks"]}
        assert bid not in {x["id"] for x in sa.get(f"/api/bookings?month={d[:7]}").json()["bookings"]}


def test_wf_last_block_race_oven_race(browser: Browser, app_url: str) -> None:
    lead = Api(app_url, LEAD_N)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("19:00", "21:00")], first=24)
        lbl = label(st, d, s, e)
        with ui(browser, app_url, ADA, f"/board?date={d}") as pa, ui(browser, app_url, KOFI, f"/board?date={d}") as pk:
            dialogs = []
            for p in (pa, pk):
                ui_wait(p, lambda p=p: shown(p.get_by_role("button", name="New booking")), "board")
                click(p.get_by_role("button", name="New booking"))
                dlg = p.get_by_role("dialog", name="New booking")
                ui_wait(p, lambda dlg=dlg: shown(dlg), "dialog")
                select(dlg.get_by_role("combobox", name="Station"), "Oven 2")
                fill(dlg.get_by_role("textbox", name="Date"), d)
                fill(dlg.get_by_role("textbox", name="Start"), s)
                fill(dlg.get_by_role("textbox", name="End"), e)
                fill(dlg.get_by_role("textbox", name="Notes"), "overnight proof")
                dialogs.append(dlg)
            click(dialogs[0].get_by_role("button", name="Hold block"))
            click(dialogs[1].get_by_role("button", name="Hold block"))
            taken = f"Oven 2 {s} block was taken."
            for p in (pa, pk):
                ui_wait(p, lambda p=p: shown(ticket(p, lbl)) or taken in alerts(p), "outcome")
            winners = [p for p in (pa, pk) if shown(ticket(p, lbl))]
            assert len(winners) == 1
            win = winners[0]
            lose, ldlg = (pk, dialogs[1]) if win is pa else (pa, dialogs[0])
            assert taken in alerts(lose) and shown(ldlg) and not shown(ticket(lose, lbl))
            advance(lose, REFRESH_MS + 1000)
            assert shown(ldlg) and taken in alerts(lose)
            assert ldlg.get_by_role("textbox", name="Notes").input_value() == "overnight proof"
            win_api = Api(app_url, ADA if win is pa else KOFI)
            bid = next(x["id"] for x in win_api.get(f"/api/bookings?month={d[:7]}").json()["bookings"]
                       if x["stationId"] == st and x["localDate"] == d and x["localStart"] == s)
            t.append((bid, win_api))
            click(ticket(win, lbl).get_by_role("button", name="Confirm"))
            ui_wait(win, lambda: get_booking(win_api, bid)["status"] == "confirmed", "winner confirmed")
        assert [x["status"] for x in lead.board(d)["blocks"] if x["stationId"] == st and x["localStart"] == s] == ["confirmed"]


def test_wf_last_block_race_late_board_read(browser: Browser, app_url: str) -> None:
    lead, kofi = Api(app_url, LEAD_N), Api(app_url, KOFI)
    slots = [("stn_prep1", "06:00", "10:00"), ("stn_prep1", "14:00", "18:00"), ("stn_prep2", "06:00", "10:00"),
             ("stn_prep2", "14:00", "18:00"), ("stn_oven1", "06:00", "10:00"), ("stn_oven2", "06:00", "10:00")]
    with tidy() as t:
        found = None
        for k in range(2, 6):
            m = month_add(kofi.month, k)
            if bank(kofi, "mem_kofi", m)["usedHours"]:
                continue
            for n in range(3, 175):
                d = d_add(kofi.today, n)
                if d[:7] == m and d != DST_GAP_DATE and all(hourly_free(lead.board(d), *x) for x in slots):
                    found = (m, d)
                    break
            if found:
                break
        assert found
        m, d = found
        for st, s, e in slots:
            held_id(kofi, hold(kofi, st, d, s, e), t)
        with ui(browser, app_url, KOFI, f"/board?date={d}") as page:
            lbls = [label(st, d, s, e) for st, s, e in slots]
            ui_wait(page, lambda: all(shown(ticket(page, x)) for x in lbls), "six tickets")
            stale: list[Any] = []
            page.route(BOARD_GLOB, lambda r: stale.append(r), times=1)
            ui_wait(page, lambda: len(stale) == 1, "a timed board read held")
            confirms: list[Any] = []
            page.route(CONFIRM_GLOB, lambda r: confirms.append(r))
            for x in lbls:
                click(ticket(page, x).get_by_role("button", name="Confirm"))
            ui_wait(page, lambda: len(confirms) == 6, "six confirms in flight")
            for r in reversed(confirms):
                r.continue_()
            msg = f"That needs 4 hours; you have 0 left for {month_name(m)}."
            ui_wait(page, lambda: msg in alerts(page), "hours alert")
            stale[0].continue_()
            advance(page, 2000)
            assert msg in alerts(page) and "0 h left" in hour_bank_text(page)
            advance(page, REFRESH_MS + 1000)
            assert msg in alerts(page) and "0 h left" in hour_bank_text(page)
            assert sum(shown(ticket(page, x)) for x in lbls) == 1
            assert sum(shown(blk_with(page, x, "Confirmed")) for x in lbls) == 5
        hb = bank(kofi, "mem_kofi", m)
        assert (hb["usedHours"], hb["balanceHours"]) == (20, 0)


def test_weekly_series(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    lead, ada, kofi = Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, KOFI)
    before = mail_ids(mail)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("16:00", "17:00")], first=70)
        weeks = [d_add(d, 7 * i) for i in range(3)]
        assert all(hourly_free(lead.board(w), st, s, e) for w in weeks)
        kid = held_id(kofi, hold(kofi, st, weeks[1], s, e), t)
        b = err(hold(ada, st, d, s, e, weeks=3), 409, "block_taken")
        assert [x["date"] for x in b["taken"]] == [weeks[1]]
        assert hourly_free(lead.board(weeks[0]), st, s, e) and hourly_free(lead.board(weeks[2]), st, s, e)
        assert cancel(kofi, kid).status_code == 200
        assert err(hold(ada, st, d, s, e, weeks=TOO_MANY_WEEKS), 422,
                   "validation_failed")["errors"]["repeatWeeks"] == FIELD["repeat"]
        r = hold(ada, st, d, s, e, weeks=3)
        assert r.status_code == 201
        bs = r.json()["bookings"]
        for x in bs:
            t.append((x["id"], ada))
        assert [x["localDate"] for x in bs] == weeks and len({x["seriesId"] for x in bs}) == 1 and bs[0]["seriesId"]
        c = confirm(ada, bs[1]["id"])
        assert c.status_code in (200, 202) and len(c.json()["bookings"]) == 3
        assert all(get_booking(ada, x["id"])["status"] == "confirmed" for x in bs)
        vers = {x["id"]: get_booking(ada, x["id"])["version"] for x in bs}
        assert cancel(ada, bs[0]["id"]).status_code == 200
        assert get_booking(ada, bs[0]["id"])["status"] == "cancelled_free"
        for x in bs[1:]:
            g = get_booking(ada, x["id"])
            assert g["status"] == "confirmed" and g["version"] == vers[x["id"]]
        cl = new_mail(mail, before, lambda m: subj(m).startswith("Booking cancelled: ") and to(m) == [ADA]
                      and any(label(st, w, s, e) in subj(m) for w in weeks))
        assert [subj(m) for m in cl] == [f"Booking cancelled: {label(st, weeks[0], s, e)}"]
        assert len(kb_wait(killbill, "mem_ada", f"Cancelled {bs[0]['id']}")) == 1
        assert not [i for i in kb_items(killbill, "mem_ada") if i.get("description") in
                    {f"Cancelled {bs[1]['id']}", f"Cancelled {bs[2]['id']}"}]


def test_dst_wall_clock(app_url: str) -> None:
    lead, ada, kofi = Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, KOFI)
    with tidy() as t:
        tue = d_add(DST_GAP_DATE, -5)
        r = hold(ada, "stn_prep2", tue, "05:00", "06:00", weeks=3)
        assert r.status_code == 201, r.text
        bs = r.json()["bookings"]
        for x in bs:
            t.append((x["id"], ada))
        tz = ZoneInfo(TZ_N)
        for x, w in zip(bs, [tue, d_add(tue, 7), d_add(tue, 14)]):
            assert x["localStart"] == "05:00" and x["hours"] == 1
            start = dt.datetime.fromisoformat(x["start"])
            assert start.utcoffset() == dt.datetime.fromisoformat(w + "T05:00").replace(tzinfo=tz).utcoffset()
            assert start.astimezone(tz).strftime("%H:%M") == "05:00"
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("20:00", "24:00")], first=26, weekdays=(6,))
        b = book(ada, st, d, s, e, t=t)
        assert b["localEnd"] == "24:00" and b["hours"] == 4 and b["peakHours"] == 0
        end = dt.datetime.fromisoformat(b["end"])
        assert end.astimezone(tz).date().isoformat() == d_add(d, 1) and end.astimezone(tz).strftime("%H:%M") == "00:00"
        if hourly_free(lead.board(d_add(d, 1)), st, "00:00", "01:00"):
            held_id(kofi, hold(kofi, st, d_add(d, 1), "00:00", "01:00"), t)
        assert err(hold(ada, st, d, "24:00", "24:00"), 422, "validation_failed")["errors"]["start"] == FIELD["quarter"]
        assert err(hold(ada, st, d, "22:00", "24:15"), 422, "validation_failed")["errors"]["end"] == FIELD["quarter"]
        gap = err(hold(ada, "stn_oven1", DST_GAP_DATE, "02:30", "04:00"), 422, "validation_failed")
        assert gap["errors"]["start"] == f"02:30 does not exist on {DST_GAP_DATE} in {TZ_N} (clocks go forward)."


def test_wf_recurring_prep_weekly_prep(browser: Browser, app_url: str, mail: Mailpit) -> None:
    lead, kofi = Api(app_url, LEAD_N), Api(app_url, KOFI)
    first = d_add(DST_GAP_DATE, -19)
    weeks = [d_add(first, 7 * i) for i in range(6)]
    before = mail_ids(mail)
    with tidy() as t:
        assert all(hourly_free(lead.board(w), "stn_prep1", "05:00", "09:00") for w in weeks)
        lbl0 = label("stn_prep1", first, "05:00", "09:00")
        with ui(browser, app_url, KOFI, f"/board?date={first}") as page:
            click(page.get_by_role("button", name="New booking"))
            dlg = page.get_by_role("dialog", name="New booking")
            ui_wait(page, lambda: shown(dlg), "dialog")
            select(dlg.get_by_role("combobox", name="Station"), "Prep Station 1")
            fill(dlg.get_by_role("textbox", name="Date"), first)
            fill(dlg.get_by_role("textbox", name="Start"), "05:00")
            fill(dlg.get_by_role("textbox", name="End"), "09:00")
            fill(dlg.get_by_role("spinbutton", name="Repeat weekly"), "6")
            click(dlg.get_by_role("button", name="Hold block"))
            ui_wait(page, lambda: shown(ticket(page, lbl0)), "series ticket")
            ids = [x["id"] for w in weeks for x in kofi.board(w)["blocks"]
                   if x.get("memberId") == "mem_kofi" and x["stationId"] == "stn_prep1" and x["localStart"] == "05:00"]
            for i in ids:
                t.append((i, kofi))
            assert len(ids) == 6
            click(ticket(page, lbl0).get_by_role("button", name="Confirm"))
            ui_wait(page, lambda: " and 5 more weeks" in ann(page), "series announcement")
            mid = weeks[3]
            page.goto(app_url + f"/board?date={mid}")
            ui_wait(page, lambda: shown(blk(page, label("stn_prep1", mid, "05:00", "09:00"))), "week after the change")
        for i in ids:
            g = get_booking(kofi, i)
            assert g["status"] == "confirmed" and (g["localStart"], g["localEnd"], g["hours"]) == ("05:00", "09:00", 4)
            assert g["chargeCents"] == 4 * PREP_STD
        assert len(new_mail(mail, before, lambda m: to(m) == [KOFI] and subj(m).startswith(f"Booking confirmed: {N_NAMES['stn_prep1']}")
                            and any(w in subj(m) for w in weeks), n=6)) == 6


def test_wf_recurring_prep_gap_refused(browser: Browser, app_url: str) -> None:
    kofi = Api(app_url, KOFI)
    with ui(browser, app_url, KOFI, f"/board?date={DST_GAP_DATE}") as page:
        click(page.get_by_role("button", name="New booking"))
        dlg = page.get_by_role("dialog", name="New booking")
        ui_wait(page, lambda: shown(dlg), "dialog")
        select(dlg.get_by_role("combobox", name="Station"), "Prep Station 1")
        fill(dlg.get_by_role("textbox", name="Date"), DST_GAP_DATE)
        fill(dlg.get_by_role("textbox", name="Start"), "02:30")
        fill(dlg.get_by_role("textbox", name="End"), "04:00")
        click(dlg.get_by_role("button", name="Hold block"))
        msg = f"02:30 does not exist on {DST_GAP_DATE} in {TZ_N} (clocks go forward)."
        ui_wait(page, lambda: msg in dlg.inner_text(), "field error")
        start = dlg.get_by_role("textbox", name="Start")
        assert start.get_attribute("aria-invalid") == "true" and focused_name(page) == "Start" and shown(dlg)
    assert not [x for x in kofi.board(DST_GAP_DATE)["blocks"] if x.get("memberId") == "mem_kofi" and x["localStart"] == "02:30"]


def _late_slot(lead: Api, stations: list[str]) -> tuple[str, str, str, str]:
    return find_slot(lead, stations, [("21:00", "22:00"), ("22:00", "23:00"), ("20:00", "21:00")], first=1, last=1)


def test_cancel_cutoff(app_url: str, killbill: KillBill) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep1"], [("06:00", "07:00")], first=3, last=4)
        b = book(ada, st, d, s, e, t=t)
        r = cancel(ada, b["id"])
        assert r.json()["booking"]["status"] == "cancelled_free" and r.json()["booking"]["penaltyCents"] == 0
        st2, d2, s2, e2 = _late_slot(lead, ["stn_prep1", "stn_prep2"])
        far = find_slot(lead, ["stn_prep2"], [("06:00", "07:00")], first=10)
        b2 = book(ada, *far, t=t)
        mv = move(lead, b2, st2, d2, s2, e2)
        assert mv.status_code == 200, mv.text
        late = cancel(ada, b2["id"]).json()["booking"]
        assert late["status"] == "cancelled_late" and late["penaltyCents"] == half_up(late["chargeCents"], 2)
        st3, d3, s3, e3 = _late_slot(lead, ["stn_oven1", "stn_oven2"])
        b3 = book(ada, st3, d3, s3, e3, t=t)
        back = find_slot(lead, ["stn_oven1"], [("06:00", "07:00")], first=12)
        mv = move(lead, b3, *back)
        assert mv.status_code == 200, mv.text
        free = cancel(ada, b3["id"]).json()["booking"]
        assert free["status"] == "cancelled_free" and free["penaltyCents"] == 0
        kb_wait(killbill, "mem_ada", f"Cancelled {b3['id']}")
        assert not [i for i in kb_items(killbill, "mem_ada") if i.get("description") == f"Late cancellation {b3['id']}"]


def _late_cancelled(ada: Api, lead: Api, t: list, stations: list[str] | None = None) -> tuple[dict, dict]:
    st, d, s, e = _late_slot(lead, stations or ["stn_oven1", "stn_oven2", "stn_prep1", "stn_prep2"])
    b = book(ada, st, d, s, e, t=t)
    r = cancel(ada, b["id"])
    assert r.status_code == 200 and r.json()["booking"]["status"] == "cancelled_late", r.text
    return b, r.json()["booking"]


def test_late_cancellation_penalty(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    before = mail_ids(mail)
    with tidy() as t:
        b, c = _late_cancelled(ada, lead, t)
        fee = half_up(b["chargeCents"], 2)
        assert c["penaltyCents"] == fee
        lf = kb_wait(killbill, "mem_ada", f"Late cancellation {b['id']}")
        cr = kb_wait(killbill, "mem_ada", f"Cancelled {b['id']}")
        assert len(lf) == len(cr) == 1 and cents(lf[0]["amount"]) == fee and cents(cr[0]["amount"]) == -b["chargeCents"]
        lbl = blabel(b)
        ms = new_mail(mail, before, lambda m: subj(m) == f"Booking cancelled: {lbl}")
        assert len(ms) == 1 and f"Late cancellation fee: {money(fee)}" in text(ms[0])
        mine = lines_for(invoice(ops, "mem_ada", b["localDate"][:7]), b["id"])
        assert [(x["kind"], x["amountCents"]) for x in mine] == [("booking", b["chargeCents"]), ("penalty", fee),
                                                                ("credit", -b["chargeCents"])]


def test_waiver_operator_only(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    before = mail_ids(mail)
    with tidy() as t:
        b, c = _late_cancelled(ada, lead, t)
        for who in (lead, ada):
            err(who.post(f"/api/bookings/{b['id']}/waive-penalty", {}, key=idempotency_key()), 403, "forbidden")
        assert get_booking(ops, b["id"])["penaltyWaived"] is False
        r = ops.post(f"/api/bookings/{b['id']}/waive-penalty", {}, key=idempotency_key())
        assert r.status_code == 200 and r.json()["creditMonth"] == b["localDate"][:7]
        assert r.json()["booking"]["penaltyWaived"] is True
        w = kb_wait(killbill, "mem_ada", f"Waived late cancellation {b['id']}")
        assert len(w) == 1 and cents(w[0]["amount"]) == -c["penaltyCents"]
        lbl = blabel(b)
        ms = new_mail(mail, before, lambda m: subj(m) == f"Late cancellation fee waived: {lbl}")
        assert len(ms) == 1
        assert f"Credit {money(c['penaltyCents'])} on your {month_name(b['localDate'][:7])} statement" in text(ms[0])
        x = err(ops.post(f"/api/bookings/{b['id']}/waive-penalty", {}, key=idempotency_key()), 409, "invalid_transition")
        assert x["from"] == "cancelled_late"


def test_paired_ledger(app_url: str, killbill: KillBill) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        m1 = month_add(ops.month, 2)
        st, d, s, e = find_slot(lead, ["stn_prep1"], [("07:00", "09:00")], month=m1, weekdays=(0, 1, 2, 3, 4))
        m2 = month_add(m1, 1)
        st2, d2, s2, e2 = find_slot(lead, ["stn_prep2"], [("07:00", "10:00")], month=m2, weekdays=(0, 1, 2, 3, 4))
        h1, h2 = bank(ada, "mem_ada", m1)["usedHours"], bank(ada, "mem_ada", m2)["usedHours"]
        b = book(ada, st, d, s, e, t=t)
        assert bank(ada, "mem_ada", m1)["usedHours"] == h1 + 2
        mv = move(ops, b, st2, d2, s2, e2)
        assert mv.status_code == 200, mv.text
        nb = mv.json()["booking"]
        assert mv.json()["hourBank"]["month"] == m2
        assert bank(ada, "mem_ada", m1)["usedHours"] == h1 and bank(ada, "mem_ada", m2)["usedHours"] == h2 + 3
        l1 = lines_for(invoice(ops, "mem_ada", m1), b["id"])
        assert [(x["kind"], x["amountCents"]) for x in l1] == [("booking", b["chargeCents"]), ("credit", -b["chargeCents"])]
        assert [(x["kind"], x["amountCents"]) for x in lines_for(invoice(ops, "mem_ada", m2), b["id"])] == \
            [("booking", nb["chargeCents"])]
        assert cents(kb_wait(killbill, "mem_ada", f"Moved {b['id']}")[0]["amount"]) == -b["chargeCents"]
        assert cents(kb_wait(killbill, "mem_ada", f"Booking {b['id']} {label(st2, d2, s2, e2)}")[0]["amount"]) == nb["chargeCents"]
        assert cancel(ada, b["id"]).json()["booking"]["status"] == "cancelled_free"
        assert bank(ada, "mem_ada", m2)["usedHours"] == h2
        assert sum(x["amountCents"] for x in lines_for(invoice(ops, "mem_ada", m2), b["id"])) == 0
        assert cents(kb_wait(killbill, "mem_ada", f"Cancelled {b['id']}")[0]["amount"]) == -nb["chargeCents"]


def test_retry_safe_cancel_waive(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    before = mail_ids(mail)
    with tidy() as t:
        st, d, s, e = _late_slot(lead, ["stn_oven1", "stn_oven2", "stn_prep1", "stn_prep2"])
        b = book(ada, st, d, s, e, t=t)
        err(ada.post(f"/api/bookings/{b['id']}/cancel", {}), 400, "idempotency_key_required")
        err(ops.post(f"/api/bookings/{b['id']}/waive-penalty", {}), 400, "idempotency_key_required")
        k1 = idempotency_key()
        rs = together([lambda: ada.clone().post(f"/api/bookings/{b['id']}/cancel", {}, key=k1),
                       lambda: ops.clone().post(f"/api/bookings/{b['id']}/cancel", {}, key=idempotency_key())])
        assert sorted(r.status_code for r in rs) == [200, 409]
        loser = next(r for r in rs if r.status_code == 409)
        assert err(loser, 409, "invalid_transition")["from"] == "cancelled_late"
        won = next(r for r in rs if r.status_code == 200)
        if won is rs[0]:
            assert ada.post(f"/api/bookings/{b['id']}/cancel", raw="", key=k1).content == won.content
        wk = idempotency_key()
        rw = together([lambda k=k: ops.clone().post(f"/api/bookings/{b['id']}/waive-penalty", {}, key=k)
                       for k in (wk, idempotency_key(), idempotency_key())])
        assert sorted(r.status_code for r in rw) == [200, 409, 409]
        if rw[0].status_code == 200:
            assert ops.post(f"/api/bookings/{b['id']}/waive-penalty", raw=SPACED_EMPTY, key=wk).content == rw[0].content
        lbl = label(st, d, s, e)
        for desc in (f"Late cancellation {b['id']}", f"Cancelled {b['id']}", f"Waived late cancellation {b['id']}"):
            assert len(kb_wait(killbill, "mem_ada", desc)) == 1
        assert len(new_mail(mail, before, lambda m: subj(m) == f"Booking cancelled: {lbl}")) == 1
        assert len(new_mail(mail, before, lambda m: subj(m) == f"Late cancellation fee waived: {lbl}")) == 1


def test_wf_cancellations_moved_cancel_waive(browser: Browser, app_url: str, killbill: KillBill) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        far_m = month_add(ops.month, 2)
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("10:00", "12:00")], month=far_m)
        bal0 = bank(ada, "mem_ada", far_m)["balanceHours"]
        b = book(ada, st, d, s, e, t=t)
        st2, d2, s2, e2 = find_slot(lead, ["stn_oven1"], [("20:00", "22:00"), ("21:00", "23:00")], first=1, last=1)
        mv = move(lead, b, st2, d2, s2, e2)
        assert mv.status_code == 200
        nb = mv.json()["booking"]
        lbl = label(st2, d2, s2, e2)
        fee = half_up(nb["chargeCents"], 2)
        with ui(browser, app_url, ADA, f"/bookings?month={d2[:7]}") as page:
            btn = page.get_by_role("button", name=f"Cancel {lbl}")
            ui_wait(page, lambda: shown(btn), "cancel button")
            click(btn)
            dlg = page.get_by_role("dialog", name="Cancel booking")
            ui_wait(page, lambda: f"Late cancellation fee: {money(fee)}" in dlg.inner_text(), "fee line")
            racing = threading.Thread(target=lambda: cancel(ops.clone(), b["id"]))
            racing.start()
            click(dlg.get_by_role("button", name="Confirm cancellation"))
            racing.join()
            ui_wait(page, lambda: get_booking(ada, b["id"])["status"] == "cancelled_late", "cancelled")
        with ui(browser, app_url, None, f"/invoices?month={d2[:7]}&member=mem_ada") as page:
            ui_wait(page, lambda: "next" in qs(page.url), "sign-in with next")
            fill(page.get_by_label("Email", exact=True), OPS_N)
            fill(page.get_by_label("Password", exact=True), "wrong-password")
            click(page.get_by_role("button", name="Sign in"))
            ui_wait(page, lambda: ERR["invalid_credentials"] in alerts(page), "refusal")
            fill(page.get_by_label("Password", exact=True), PASSWORD)
            click(page.get_by_role("button", name="Sign in"))
            ui_wait(page, lambda: path_of(page.url) == "/invoices", "invoice")
            waive = page.get_by_role("button", name=f"Waive fee for {lbl} ({b['id']})")
            ui_wait(page, lambda: shown(waive), "waive button")
            click(waive)
            ui_wait(page, lambda: f"Fee waived for {lbl}." in ann(page), "waived")
        assert get_booking(ops, b["id"])["penaltyWaived"] is True
        assert sum(x["amountCents"] for x in lines_for(invoice(ops, "mem_ada", far_m), b["id"])) == 0
        new = lines_for(invoice(ops, "mem_ada", d2[:7]), b["id"])
        assert sorted(x["amountCents"] for x in new) == sorted([nb["chargeCents"], fee, -nb["chargeCents"], -fee])
        assert bank(ada, "mem_ada", far_m)["balanceHours"] == bal0
        assert len(kb_wait(killbill, "mem_ada", f"Waived late cancellation {b['id']}")) == 1
        assert len(kb_wait(killbill, "mem_ada", f"Late cancellation {b['id']}")) == 1


def test_wf_cancellations_cancel_dialog(browser: Browser, app_url: str) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = _late_slot(lead, ["stn_prep2", "stn_prep1", "stn_oven2"])
        b = book(ada, st, d, s, e, t=t)
        fee = half_up(b["chargeCents"], 2)
        lbl = label(st, d, s, e)
        with ui(browser, app_url, ADA, f"/bookings?month={d[:7]}") as page:
            btn = page.get_by_role("button", name=f"Cancel {lbl}")
            ui_wait(page, lambda: shown(btn), "row")
            click(btn)
            dlg = page.get_by_role("dialog", name="Cancel booking")
            ui_wait(page, lambda: f"Late cancellation fee: {money(fee)}" in dlg.inner_text(), "fee line")
            click(dlg.get_by_role("button", name="Confirm cancellation"))
            ui_wait(page, lambda: f"Cancelled. Late cancellation fee: {money(fee)}." in ann(page), "announcement")
        g = get_booking(ada, b["id"])
        assert g["status"] == "cancelled_late" and g["penaltyCents"] == fee


def test_kitchen_time_board(browser: Browser, app_url: str) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    b0 = lead.board()
    now = dt.datetime.fromisoformat(b0["now"])
    assert b0["date"] == b0["today"] == now.astimezone(ZoneInfo(TZ_N)).date().isoformat() and b0["timeZone"] == TZ_N
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven1"], [("06:15", "08:45")], first=27, plain=True)
        bk = book(ada, st, d, s, e, t=t)
        assert local_of(bk["start"], TZ_N) == (d, s) and local_of(bk["end"], TZ_N) == (d, e)
        assert lead.board(d)["date"] == d
        with ui(browser, app_url, LEAD_N, "/board", clock=now + dt.timedelta(days=2)) as page:
            ui_wait(page, lambda: qs(page.url).get("date") == b0["today"], "address filled with the kitchen's today")
            assert heading_date(b0["today"]) in page.get_by_role("heading", level=1).first.inner_text()
            assert f"Kitchen time: {TZ_N}" in page.get_by_role("main").inner_text()
            page.goto(app_url + f"/board?date={d}")
            lbl = label(st, d, s, e)
            ui_wait(page, lambda: shown(blk(page, lbl)), "block in its lane")
            assert heading_date(d) in page.get_by_role("heading", level=1).first.inner_text()
            items = page.get_by_role("list", name="Hour ruler").get_by_role("listitem")
            assert [x.inner_text().strip() for x in items.all()] == [f"{h:02d}:00" for h in range(24)]
            blk(page, lbl).first.scroll_into_view_if_needed()
            bb = blk(page, lbl).first.bounding_box()
            assert abs(bb["x"] - ruler_x(page, s)) <= 1.5 and abs(bb["x"] + bb["width"] - ruler_x(page, e)) <= 1.5


def test_private_blocks(browser: Browser, app_url: str) -> None:
    lead, ada, kofi = Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, KOFI)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep1"], [("17:00", "18:00")], first=28)
        b = book(ada, st, d, s, e, notes=PRIVATE_NOTE, t=t)
        other = next(x for x in kofi.board(d)["blocks"] if x["id"] == b["id"])
        assert set(other) == BOOKED_KEYS and other["status"] == "booked"
        raw = kofi.get(f"/api/board?date={d}").text
        name = ada.name("mem_ada")
        assert PRIVATE_NOTE not in raw and ADA_MID not in raw and name not in raw
        full = next(x for x in lead.board(d)["blocks"] if x["id"] == b["id"])
        assert set(full) == BOOKING_KEYS and full["businessName"] == name and full["memberId"] == "mem_ada"
        lbl = label(st, d, s, e)
        with ui(browser, app_url, KOFI, f"/board?date={d}") as page:
            ui_wait(page, lambda: shown(board_region(page).get_by_role("button", name=f"{lbl}, Booked", exact=True)),
                    "booked block")
            assert name not in board_region(page).inner_text()


def test_wf_line_board_ops_open_today(browser: Browser, app_url: str) -> None:
    lead = Api(app_url, LEAD_N)
    today = lead.today
    with ui(browser, app_url, LEAD_N, None) as page:
        ui_wait(page, lambda: qs(page.url).get("date") == today, "today in the address")
        h1 = page.get_by_role("heading", level=1).first
        assert heading_date(today) in h1.inner_text()
        for st in N_STATIONS:
            assert shown(board_region(page).get_by_role("group", name=N_NAMES[st], exact=True)), st
        click(page.get_by_role("button", name="Next day"))
        ui_wait(page, lambda: qs(page.url).get("date") == d_add(today, 1) and heading_date(d_add(today, 1)) in h1.inner_text(),
                "next day")
        click(page.get_by_role("button", name="Previous day"))
        ui_wait(page, lambda: qs(page.url).get("date") == today and heading_date(today) in h1.inner_text(), "back to today")
        click(page.get_by_role("button", name="Next day"))
        click(page.get_by_role("button", name="Today"))
        ui_wait(page, lambda: qs(page.url).get("date") == today, "Today button")
    assert {s["id"] for s in lead.board(today)["stations"]} == set(N_STATIONS)


def test_state_machine(app_url: str) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep1"], [("12:00", "13:00")], first=29)
        r = hold(ada, st, d, s, e)
        bid = held_id(ada, r, t)
        v0 = r.json()["bookings"][0]["version"]
        assert r.json()["bookings"][0]["actions"] == ["confirm", "cancel"]
        c = confirm(ada, bid)
        b = c.json()["bookings"][0]
        assert b["version"] == v0 + 1
        assert get_booking(lead, bid)["actions"] == ["move"]
        assert get_booking(ops, bid)["actions"] == ["cancel", "move"]
        assert get_booking(ada, bid)["actions"] == ["cancel"]
        for who, path, action in [(lead, "check-in", "check_in"), (lead, "check-out", "check_out"),
                                  (lead, "no-show", "no_show"), (lead, "release", "release")]:
            x = err(who.post(f"/api/bookings/{bid}/{path}", {}), 409, "invalid_transition", transition_msg("Confirmed"))
            assert x["from"] == "confirmed" and x["action"] == action and x["current"] == get_booking(lead, bid)
        x = err(confirm(ada, bid), 409, "invalid_transition")
        assert x["from"] == "confirmed" and x["current"]["id"] == bid
        assert get_booking(ada, bid)["version"] == v0 + 1
        cc = cancel(ada, bid)
        assert cc.json()["booking"]["version"] == v0 + 2 and cc.json()["booking"]["actions"] == []
        x = err(cancel(ops, bid), 409, "invalid_transition", transition_msg("Cancelled"))
        assert x["from"] == "cancelled_free"
        err(ada.post(f"/api/bookings/{bid}/move", {"stationId": st, "date": d, "start": s, "end": e, "version": 1}),
            403, "forbidden")


def test_auto_no_show(app_url: str, killbill: KillBill) -> None:
    base = short_url()
    lead, ada = Api(base, LEAD_N), Api(base, ADA)
    with tidy() as t:
        st, d, s, e = slot_near(lead, STARTED)
        b = book(ada, st, d, s, e, t=t)
        g = get_booking(lead, b["id"])
        assert g["status"] == "confirmed" and g["actions"] == ["check_in", "no_show", "move"]
        poll(lambda: get_booking(lead, b["id"])["status"] == "no_show", SHORT_GRACE + SLACK, "automatic no-show")
        g = get_booking(lead, b["id"])
        assert g["actions"] == [] and g["chargeCents"] == b["chargeCents"]
        x = err(lead.post(f"/api/bookings/{b['id']}/check-in", {}), 409, "invalid_transition",
                "That action is not available for a No-show block.")
        assert x["from"] == "no_show"
        quiet()
        assert [i["description"] for i in kb_items(killbill, "mem_ada") if b["id"] in (i.get("description") or "")] == \
            [f"Booking {b['id']} {label(st, d, s, e)}"]


def test_wf_line_board_ops_run_the_line(browser: Browser, app_url: str) -> None:
    lead, ada, kofi = Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, KOFI)
    with tidy() as t:
        st1, d, s1, e1 = slot_near(lead, NEAR)
        a = book(ada, st1, d, s1, e1, t=t)
        st2, _, s2, e2 = slot_near(lead, STARTED)
        k = book(kofi, st2, d, s2, e2, t=t)
        la, lk = label(st1, d, s1, e1), label(st2, d, s2, e2)
        with ui(browser, app_url, LEAD_N, f"/board?date={d}") as page:
            ui_wait(page, lambda: shown(blk(page, la)) and shown(blk(page, lk)), "both blocks")
            click(blk(page, la).first)
            dlg = page.get_by_role("dialog", name="Block details")
            ui_wait(page, lambda: shown(dlg), "Block details")
            click(dlg.get_by_role("button", name="Check in"))
            ui_wait(page, lambda: shown(blk_with(page, la, "Checked in")), "checked in")
            assert get_booking(lead, a["id"])["status"] == "checked_in"
            assert f"Checked in {ada.name('mem_ada')}." in ann(page)
            click(blk(page, la).first)
            ui_wait(page, lambda: shown(dlg), "Block details again")
            click(dlg.get_by_role("button", name="Check out"))
            ui_wait(page, lambda: shown(blk_with(page, la, "Completed")), "completed")
            click(blk(page, lk).first)
            ui_wait(page, lambda: shown(dlg), "Block details for no-show")
            click(dlg.get_by_role("button", name="Mark no-show"))
            ui_wait(page, lambda: shown(blk_with(page, lk, "No-show")), "no-show")
            assert f"Marked {kofi.name('mem_kofi')} as no-show." in ann(page)
        assert get_booking(lead, a["id"])["status"] == "completed"
        assert get_booking(lead, k["id"])["status"] == "no_show"


def test_server_true_board(browser: Browser, app_url: str) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep1"], [("10:00", "11:00")], first=31)
        b = book(ada, st, d, s, e, t=t)
        lbl = label(st, d, s, e)
        with ui(browser, app_url, OPS_N, f"/board?date={d}") as page:
            ui_wait(page, lambda: shown(blk(page, lbl)), "block")
            click(blk(page, lbl).first)
            dlg = page.get_by_role("dialog", name="Block details")
            ui_wait(page, lambda: shown(dlg), "Block details")
            click(dlg.get_by_role("button", name="Cancel booking"))
            cdlg = page.get_by_role("dialog", name="Cancel booking")
            ui_wait(page, lambda: shown(cdlg), "Cancel booking")
            with held(page, CANCEL_GLOB) as gate:
                click(cdlg.get_by_role("button", name="Confirm cancellation"))
                ui_wait(page, lambda: shown(blk_with(page, lbl, "Saving…")), "pending marker")
                name = blk(page, lbl).first.get_attribute("aria-label") or blk(page, lbl).first.inner_text()
                assert "Confirmed" in name and "Cancelled" not in name
                assert cancel(ada, b["id"]).status_code == 200
                gate.release()
            ui_wait(page, lambda: blk(page, lbl).count() == 0, "block leaves its lane")
            ui_wait(page, lambda: transition_msg("Cancelled") in alerts(page), "alert")
        assert get_booking(ops, b["id"])["status"] == "cancelled_free"


def test_documents_at_check_in(app_url: str) -> None:
    base = app_url
    ops, lead, nadia = Api(base, OPS_N), Api(base, LEAD_N), Api(base, NADIA)
    with tidy() as t:
        try:
            assert put_required(ops, ["food_handler_card"]).status_code == 200
            if not current_doc(ops, "mem_nadia", "food_handler_card"):
                uploaded(nadia, ops, "food_handler_card", d_add(ops.today, 300), approve_it=True)
            st, d, s, e = slot_near(lead, NEAR)
            b = book(nadia, st, d, s, e, t=t)
            assert put_required(ops, ["insurance_certificate", "food_handler_card"]).status_code == 200
            ins = current_doc(ops, "mem_nadia", "insurance_certificate")
            assert ins and ins["status"] == "expired"
            v = get_booking(lead, b["id"])["version"]
            x = err(lead.post(f"/api/bookings/{b['id']}/check-in", {}), 422, "validation_failed")
            assert x["errors"]["documents"] == \
                f"The insurance certificate expired on {ins['expiryDate']}; check-in is refused."
            g = get_booking(lead, b["id"])
            assert g["status"] == "confirmed" and g["version"] == v
            assert next(y for y in lead.board(d)["blocks"] if y["id"] == b["id"])["status"] == "confirmed"
        finally:
            put_required(ops, ["insurance_certificate", "food_handler_card"])


def test_shared_tablet_handover(browser: Browser, app_url: str) -> None:
    lead, ada, omar = Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, OMAR)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("18:00", "19:00")], first=32)
        bid = held_id(ada, hold(ada, st, d, s, e), t)
        lbl = label(st, d, s, e)
        with ui(browser, app_url, ADA, f"/board?date={d}") as page:
            ui_wait(page, lambda: shown(ticket(page, lbl)), "Ada's ticket")
            cookie = next(c["value"] for c in page.context.cookies() if c["name"] == COOKIE)
            stash: list[Any] = []
            page.route(BOARD_GLOB, lambda route: stash.append((route, route.fetch())), times=1)
            ui_wait(page, lambda: len(stash) == 1, "a board read in flight")
            click(page.get_by_role("button", name="Sign out"))
            ui_wait(page, lambda: path_of(page.url) == "/" and not qs(page.url), "plain sign-in address")
            ui_signin(page, app_url, LEAD_N)
            with suppress(Exception):
                stash[0][0].fulfill(response=stash[0][1])
            advance(page, 2000)
            assert not shown(ticket(page, lbl)) and page.get_by_role("group", name="Hour bank").count() == 0
            page.go_back()
            advance(page, 2000)
            assert not shown(ticket(page, lbl)) and page.get_by_role("group", name="Hour bank").count() == 0
            err(Api(app_url, cookie=cookie).get("/api/board"), 401, "unauthenticated")
        assert get_booking(ada, bid)["status"] == "held"
    for r in [ada.get("/api/board"), lead.get("/api/kitchen"), Api(app_url).get("/api/session"),
              httpx.get(app_url + "/", timeout=HTTP_TIMEOUT), httpx.get(app_url + "/board", timeout=HTTP_TIMEOUT),
              httpx.get(app_url + "/inspect/abc", timeout=HTTP_TIMEOUT)]:
        assert "no-store" in (r.headers.get("cache-control") or ""), r.url
    calls = [(ada, ADA, "kit_northside"), (omar, OMAR, "kit_harbor")] * 20

    def who(api: Api, email: str, kitchen: str) -> bool:
        s1 = api.get("/api/session").json()
        b = api.get("/api/board").json()
        return s1["user"]["email"] == email and s1["kitchen"]["id"] == kitchen and \
            {x["id"] for x in b["stations"]} <= (H_STATIONS if kitchen == "kit_harbor" else set(N_STATIONS))
    assert all(together([lambda a=a, e=e, k=k: who(a.clone(), e, k) for a, e, k in calls]))


def test_board_time_from_server(browser: Browser, app_url: str) -> None:
    base = app_url
    lead, ada = Api(base, LEAD_N), Api(base, ADA)
    with tidy() as t:
        st1, d, s1, e1 = slot_near(lead, NEAR)
        a = book(ada, st1, d, s1, e1, t=t)
        try:
            st2, d2, s2, e2 = slot_near(lead, LATER)
        except AssertionError:
            st2, d2, s2, e2 = find_slot(lead, N_HOURLY, [("06:00", "07:00"), ("07:00", "08:00")], first=1, last=1)
        b = book(ada, st2, d2, s2, e2, t=t)
        bd = lead.board()
        assert abs((dt.datetime.fromisoformat(bd["now"]) - dt.datetime.now(dt.timezone.utc)).total_seconds()) < 120
        near_actions = next(x for x in bd["blocks"] if x["id"] == a["id"])["actions"]
        assert "check_in" in near_actions and "move" in near_actions
        assert get_booking(lead, b["id"])["actions"] == ["move"]
        want_near = [ACTION_BUTTONS[x] for x in ACTION_ORDER if x in near_actions] + ["Close"]
        fast = dt.datetime.fromisoformat(bd["now"]) + dt.timedelta(days=2)
        with ui(browser, base, LEAD_N, "/board", clock=fast) as page:
            ui_wait(page, lambda: qs(page.url).get("date") == bd["today"], "server today")
            la, lb = label(st1, d, s1, e1), label(st2, d2, s2, e2)
            ui_wait(page, lambda: shown(blk(page, la)), "near block")
            click(blk(page, la).first)
            dlg = page.get_by_role("dialog", name="Block details")
            ui_wait(page, lambda: shown(dlg), "dialog")
            names = [x.inner_text().strip() for x in dlg.get_by_role("button").all()]
            assert [n for n in names if n in ("Check in", "Check out", "Mark no-show", "Pick up to move",
                                              "Cancel booking", "Close")] == want_near
            click(dlg.get_by_role("button", name="Close"))
            if d2 != d:
                click(page.get_by_role("button", name="Next day"))
                ui_wait(page, lambda: qs(page.url).get("date") == d2, "far block's date")
            ui_wait(page, lambda: shown(blk(page, lb)), "far block")
            click(blk(page, lb).first)
            ui_wait(page, lambda: shown(dlg), "dialog for far block")
            names = [x.inner_text().strip() for x in dlg.get_by_role("button").all()]
            assert [n for n in names if n in ("Check in", "Check out", "Mark no-show", "Pick up to move",
                                              "Cancel booking", "Close")] == ["Pick up to move", "Close"]
            click(dlg.get_by_role("button", name="Close"))
            click(page.get_by_role("button", name="Next day"))
            click(page.get_by_role("button", name="Today"))
            ui_wait(page, lambda: qs(page.url).get("date") == bd["today"], "Today from the server")


def test_board_overlays(browser: Browser, app_url: str) -> None:
    lead, ada, kofi = Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, KOFI)
    with tidy() as t:
        d = find_day(lead, [("stn_oven2", "23:00", "24:00"), ("stn_oven1", "22:00", "23:00")], first=33)
        book(ada, "stn_oven2", d, "23:00", "24:00", t=t)
        book(kofi, "stn_oven1", d, "22:00", "23:00", t=t)
        lx, ly = label("stn_oven2", d, "23:00", "24:00"), label("stn_oven1", d, "22:00", "23:00")
        with ui(browser, app_url, LEAD_N, f"/board?date={d}", size=PHONE, touch=True) as page:
            ui_wait(page, lambda: shown(blk(page, lx)), "late block")
            page.get_by_role("list", name="Hour ruler").get_by_role("listitem", name="22:00", exact=True).scroll_into_view_if_needed()
            bx, by = blk(page, lx).first.bounding_box(), blk(page, ly).first.bounding_box()
            blk(page, lx).first.tap()
            dlg = page.get_by_role("dialog", name="Block details")
            ui_wait(page, lambda: shown(dlg), "Block details")
            assert in_viewport(page, dlg) and dlg.bounding_box()["width"] >= PHONE[0] - 2
            assert lx in dlg.inner_text()
            for btn in dlg.get_by_role("button").all():
                assert in_viewport(page, btn) and hit_testable(btn)
            page.touchscreen.tap(by["x"] + by["width"] / 2, by["y"] + by["height"] / 2)
            advance(page, 500)
            assert page.get_by_role("dialog").count() == 1 and lx in dlg.inner_text()
            click(dlg.get_by_role("button", name="Close"))
            ui_wait(page, lambda: page.get_by_role("dialog", name="Block details").count() == 0, "closed")
            after = blk(page, lx).first.bounding_box()
            assert abs(after["x"] - bx["x"]) <= 1 and abs(after["y"] - bx["y"]) <= 1
            assert focused_name(page).startswith(lx)
            layout(page)


def test_out_of_service_conflicts(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    lead, ada, kofi = Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, KOFI)
    before = mail_ids(mail)
    with tidy() as t:
        d = find_day(lead, [("stn_oven1", "17:00", "21:00")], first=34)
        a = book(ada, "stn_oven1", d, "17:00", "18:00", t=t)
        c = book(ada, "stn_oven1", d, "18:00", "19:00", t=t)
        kid = held_id(kofi, hold(kofi, "stn_oven1", d, "19:00", "20:00"), t)
        r = lead.post("/api/out-of-service", {"stationId": "stn_oven1", "date": d, "start": "17:00", "end": "21:00",
                                              "reason": "Oven 1 broke down"})
        assert r.status_code == 201, r.text
        w = r.json()
        try:
            assert set(w["conflicts"]) == {a["id"], c["id"]} and w["window"]["localStart"] == "17:00"
            assert get_booking(lead, a["id"])["conflict"] is True and get_booking(lead, kid)["status"] == "cancelled_free"
            assert "release" in get_booking(lead, a["id"])["actions"]
            x = err(hold(kofi, "stn_oven1", d, "20:00", "21:00"), 422, "validation_failed")
            assert x["errors"]["stationId"] == oos_msg(N_NAMES["stn_oven1"])
            assert err(confirm(kofi, kid), 409, "invalid_transition")["from"] == "cancelled_free"
            rr = lead.post(f"/api/bookings/{a['id']}/release", {})
            assert rr.status_code == 200 and rr.json()["booking"]["status"] == "cancelled_free"
            assert rr.json()["booking"]["penaltyCents"] == 0
            assert cents(kb_wait(killbill, "mem_ada", f"Cancelled {a['id']}")[0]["amount"]) == -a["chargeCents"]
            assert not [i for i in kb_items(killbill, "mem_ada") if i.get("description") == f"Late cancellation {a['id']}"]
            lbl = label("stn_oven1", d, "17:00", "18:00")
            ms = new_mail(mail, before, lambda m: subj(m) == f"Booking cancelled: {lbl}")
            assert len(ms) == 1 and "No cancellation fee" in text(ms[0])
            err(lead.post(f"/api/bookings/{a['id']}/release", {}), 409, "invalid_transition")
        finally:
            dr = lead.delete(f"/api/out-of-service/{w['window']['id']}")
        assert dr.status_code == 200 and c["id"] not in dr.json()["conflicts"]
        assert get_booking(lead, c["id"])["conflict"] is False


def test_moving_a_block(app_url: str, mail: Mailpit) -> None:
    ops, lead, ada, kofi = (Api(app_url, x) for x in (OPS_N, LEAD_N, ADA, KOFI))
    before = mail_ids(mail)
    with tidy() as t:
        d = find_day(lead, [("stn_oven1", "09:00", "11:00"), ("stn_oven2", "09:00", "10:00"),
                            ("stn_prep1", "09:00", "10:00"), ("stn_prep2", "09:00", "10:00")], first=35,
                     weekdays=(0, 1, 2, 3, 4))
        a = book(ada, "stn_oven1", d, "09:00", "10:00", t=t)
        k = book(kofi, "stn_oven1", d, "10:00", "11:00", t=t)
        r = move(lead, a, "stn_prep1", d, "09:00", "10:00")
        assert r.status_code == 200, r.text
        m = r.json()["booking"]
        assert (m["stationId"], m["version"], m["chargeCents"]) == ("stn_prep1", a["version"] + 1, PREP_STD)
        assert r.json()["hourBank"]["month"] == d[:7]
        x = err(move(lead, a, "stn_oven2", d, "09:00", "10:00"), 412, "stale_version", ERR["stale_move"])
        assert x["current"] == get_booking(lead, a["id"])
        x = err(move(lead, m, "stn_oven1", d, "10:00", "11:00"), 409, "block_taken")
        assert x["current"]["id"] == a["id"] and x["current"]["stationId"] == "stn_prep1"
        x = err(lead.post(f"/api/bookings/{a['id']}/move", {"stationId": "stn_shelfA", "date": d, "start": "09:00",
                                                           "end": "10:00", "version": m["version"]}), 422,
                "validation_failed")
        assert x["errors"] == {"stationId": FIELD["wrong_kind"]}
        r1, r2 = together([lambda: move(lead.clone(), m, "stn_oven2", d, "09:00", "10:00"),
                           lambda: move(ops.clone(), m, "stn_prep2", d, "09:00", "10:00")])
        assert sorted([r1.status_code, r2.status_code]) == [200, 412]
        assert get_booking(lead, a["id"])["version"] == m["version"] + 1
        assert get_booking(lead, k["id"])["version"] == k["version"]
        moved = new_mail(mail, before, lambda x: to(x) == [ADA] and subj(x).startswith("Booking moved: ")
                         and d in subj(x), n=2)
        assert len(moved) == 2


def test_keyboard_dialogs(browser: Browser, app_url: str) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("19:00", "20:00")], first=36)
        book(ada, st, d, s, e, t=t)
        lbl = label(st, d, s, e)
        with ui(browser, app_url, ADA, f"/board?date={d}") as page:
            ui_wait(page, lambda: shown(blk(page, lbl)), "block")
            tab_to(page, "New booking")
            page.keyboard.press("Enter")
            dlg = page.get_by_role("dialog", name="New booking")
            ui_wait(page, lambda: shown(dlg), "dialog")
            inside = {"Station", "Date", "Start", "End", "Days", "Repeat weekly", "Notes", "Hold block", "Close"}
            assert focused_name(page) == "Station"
            names = tab_order(page, 14)
            assert set(names) <= inside and "Close" in names and "Station" in names, names
            page.keyboard.press("Escape")
            ui_wait(page, lambda: dlg.count() == 0, "closed")
            assert focused_name(page) == "New booking"
            blk(page, lbl).first.focus()
            page.keyboard.press("Enter")
            det = page.get_by_role("dialog", name="Block details")
            ui_wait(page, lambda: shown(det), "Block details")
            names = tab_order(page, 6)
            assert set(names) <= {"Cancel booking", "Close"}, names
            page.keyboard.press("Escape")
            ui_wait(page, lambda: det.count() == 0, "details closed")
            assert focused_name(page).startswith(lbl)


def _keyboard_move_setup(lead: Api, ada: Api, kofi: Api, t: list) -> tuple[str, dict, dict]:
    d = find_day(lead, [("stn_oven1", "00:00", "02:00"), ("stn_oven2", "00:00", "02:00"),
                        ("stn_prep2", "00:00", "02:00")], first=37)
    x = book(ada, "stn_oven1", d, "00:00", "01:00", t=t)
    y = book(kofi, "stn_oven1", d, "01:00", "02:00", t=t)
    return d, x, y


def test_announced_keyboard_move(browser: Browser, app_url: str) -> None:
    lead, ada, kofi = Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, KOFI)
    with tidy() as t:
        d, x, y = _keyboard_move_setup(lead, ada, kofi, t)
        lx = label("stn_oven1", d, "00:00", "01:00")
        with window(lead, "stn_prep2", d, "00:00", "02:00", "Deep clean"):
            with ui(browser, app_url, LEAD_N, f"/board?date={d}") as page:
                ui_wait(page, lambda: shown(blk(page, lx)), "block")
                blk(page, lx).first.focus()
                page.keyboard.press("Enter")
                dlg = page.get_by_role("dialog", name="Block details")
                ui_wait(page, lambda: shown(dlg), "details")
                click(dlg.get_by_role("button", name="Pick up to move"))
                ui_wait(page, lambda: f"Picked up {lx}. Arrow keys move it, Enter places it, Escape puts it back." in ann(page),
                        "pick-up announcement")
                assert focused_name(page) == f"Moving to {lx}"
                assert shown(rail(page).get_by_role("group", name=f"Moving {lx}", exact=True))
                steps = [("ArrowLeft", f"{lx}. Edge of the board."),
                         ("ArrowRight", f"{label('stn_oven1', d, '00:15', '01:15')}. Occupied."),
                         ("Enter", f"{label('stn_oven1', d, '00:15', '01:15')} is not free. Choose free time."),
                         ("ArrowUp", f"{label('stn_prep2', d, '00:15', '01:15')}. Out of service."),
                         ("ArrowDown", f"{label('stn_oven1', d, '00:15', '01:15')}. Occupied."),
                         ("ArrowDown", f"{label('stn_oven2', d, '00:15', '01:15')}.")]
                for key, want in steps:
                    page.keyboard.press(key)
                    advance(page, 200)
                    assert ann(page).strip() == want, (key, ann(page))
                    assert page.get_by_role("dialog", name="Move block").count() == 0
                ghost = board_region(page).get_by_role("group", name=f"Moving to {label('stn_oven2', d, '00:15', '01:15')}")
                assert shown(ghost)
                page.keyboard.press("Escape")
                ui_wait(page, lambda: ann(page).strip() == f"Put back {lx}.", "put back")
                assert focused_name(page).startswith(lx)
                assert not shown(rail(page).get_by_role("group", name=f"Moving {lx}", exact=True))
            g = get_booking(lead, x["id"])
            assert (g["stationId"], g["localStart"], g["version"]) == ("stn_oven1", "00:00", x["version"])


def test_conflict_markers(browser: Browser, app_url: str) -> None:
    lead, ada, kofi, rina = (Api(app_url, x) for x in (LEAD_N, ADA, KOFI, RINA))
    with tidy() as t:
        d, x, y = _keyboard_move_setup(lead, ada, kofi, t)
        sd = find_shelf(lead, "stn_shelfB", 1, first=37, empty=True)
        rina_card_until(app_url, sd)
        held_id(ada, hold(ada, "stn_shelfB", sd, days=1), t)
        held_id(rina, hold(rina, "stn_shelfB", sd, days=1), t)
        lx = label("stn_oven1", d, "00:00", "01:00")
        with window(lead, "stn_oven1", d, "00:00", "01:00", "Element failed"):
            with ui(browser, app_url, LEAD_N, f"/board?date={d}") as page:
                cb = blk_with(page, lx, "Conflict")
                ui_wait(page, lambda: shown(cb), "conflict block")
                assert "Conflict" in cb.first.inner_text() and has_pattern(cb)
                assert shown(rail(page).get_by_role("group", name=f"Conflict {lx}", exact=True))
                ly = label("stn_oven1", d, "01:00", "02:00")
                blk(page, ly).first.focus()
                page.keyboard.press("Enter")
                dlg = page.get_by_role("dialog", name="Block details")
                ui_wait(page, lambda: shown(dlg), "details")
                click(dlg.get_by_role("button", name="Pick up to move"))
                ui_wait(page, lambda: focused_name(page) == f"Moving to {ly}", "ghost")
                page.keyboard.press("ArrowLeft")
                g = board_region(page).get_by_role("group", name=f"Moving to {label('stn_oven1', d, '00:45', '01:45')}")
                ui_wait(page, lambda: shown(g) and "Occupied" in g.first.inner_text(), "occupied ghost")
                assert has_pattern(g)
                page.keyboard.press("Escape")
                contrast_audit(page)
                page.goto(app_url + f"/board?date={sd}")
                cell = board_region(page).get_by_role("group", name=f"Walk-in Shelf B {sd}", exact=True)
                ui_wait(page, lambda: shown(cell) and "0 of 2 free" in cell.inner_text(), "full shelf cell")
                assert has_pattern(cell)
                contrast_audit(page)


def test_wf_conflict_resolution_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    before = mail_ids(mail)
    with tidy() as t:
        d = find_day(lead, [("stn_oven1", "14:00", "15:00"), ("stn_oven2", "14:00", "15:00")], first=38)
        b = book(ada, "stn_oven1", d, "14:00", "15:00", t=t)
        lx, l2 = label("stn_oven1", d, "14:00", "15:00"), label("stn_oven2", d, "14:00", "15:00")
        with window(lead, "stn_oven1", d, "14:00", "15:00", CONFLICT_REASON):
            with ui(browser, app_url, LEAD_N, f"/board?date={d}") as page:
                conflict = rail(page).get_by_role("group", name=f"Conflict {lx}", exact=True)
                ui_wait(page, lambda: shown(conflict), "conflict ticket")
                assert f"Conflict: {CONFLICT_REASON}" in conflict.inner_text()
                tab_to(page, "Move")
                page.keyboard.press("Enter")
                ui_wait(page, lambda: focused_name(page) == f"Moving to {lx}", "ghost focused")
                page.keyboard.press("ArrowDown")
                ui_wait(page, lambda: ann(page).strip() == f"{l2}.", "free step")
                page.keyboard.press("Enter")
                mdlg = page.get_by_role("dialog", name="Move block")
                ui_wait(page, lambda: shown(mdlg), "Move block")
                assert f"From {lx} to {l2}" in mdlg.inner_text() and focused_name(page) == "Confirm move"
                page.keyboard.press("Enter")
                ui_wait(page, lambda: f"Moved to {l2}." in ann(page), "moved")
                ui_wait(page, lambda: not shown(conflict), "conflict cleared")
                assert focused_name(page).startswith(l2)
            g = get_booking(lead, b["id"])
            assert g["stationId"] == "stn_oven2" and g["conflict"] is False
        assert len(new_mail(mail, before, lambda m: subj(m) == f"Booking moved: {l2}")) == 1


def test_wf_conflict_resolution_refused_move(browser: Browser, app_url: str) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        d = find_day(lead, [("stn_oven1", "14:00", "17:00"), ("stn_oven2", "14:00", "15:00")], first=39)
        b = book(ada, "stn_oven1", d, "14:00", "15:00", t=t)
        lx, l2 = label("stn_oven1", d, "14:00", "15:00"), label("stn_oven2", d, "14:00", "15:00")
        with window(lead, "stn_oven1", d, "14:00", "16:00", "Door seal"):
            with ui(browser, app_url, LEAD_N, f"/board?date={d}") as page:
                conflict = rail(page).get_by_role("group", name=f"Conflict {lx}", exact=True)
                ui_wait(page, lambda: shown(conflict), "conflict ticket")
                tab_to(page, "Move")
                page.keyboard.press("Enter")
                ui_wait(page, lambda: focused_name(page) == f"Moving to {lx}", "ghost")
                page.keyboard.press("Shift+ArrowRight")
                page.keyboard.press("Shift+ArrowRight")
                ui_wait(page, lambda: ann(page).strip() == f"{label('stn_oven1', d, '16:00', '17:00')}.", "free time")
                r = move(ops, get_booking(ops, b["id"]), "stn_oven2", d, "14:00", "15:00")
                assert r.status_code == 200, r.text
                page.keyboard.press("Enter")
                mdlg = page.get_by_role("dialog", name="Move block")
                ui_wait(page, lambda: shown(mdlg), "Move block")
                click(mdlg.get_by_role("button", name="Confirm move"))
                ui_wait(page, lambda: ERR["stale_move"] in alerts(page), "stale alert")
                ui_wait(page, lambda: shown(blk(page, l2)) and not shown(conflict), "redrawn at the operator's place")
        g = get_booking(lead, b["id"])
        assert (g["stationId"], g["localStart"], g["conflict"]) == ("stn_oven2", "14:00", False)


def _rate_moment(lead: Api, hhmm_: str, salt: int) -> str:
    for k in range(0, 60):
        d = d_add(lead.today, 100 + (salt + k) % 70)
        if plain_day(d) and wd(d) < 5:
            return d
    raise AssertionError("no plain weekday for a rate moment")


def test_effective_dated_rates(app_url: str) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    old = station(ops, "stn_oven1")["currentRate"]
    with tidy() as t:
        for salt in range(uuid.uuid4().int % 70, 140):
            d = _rate_moment(lead, "03:15", salt)
            if hourly_free(lead.board(d), "stn_oven1", "02:30", "04:15"):
                break
        r_at = hold(ada, "stn_oven1", d, "03:15", "04:15")
        a = held_id(ada, r_at, t)
        assert r_at.json()["bookings"][0]["chargeCents"] == old["offPeakHourlyCents"]
        b = held_id(ada, hold(ada, "stn_oven1", d, "02:15", "03:15"), t) \
            if hourly_free(lead.board(d), "stn_oven1", "02:15", "03:15") else None
        new = {"offPeakHourlyCents": NEW_STD, "peakHourlyCents": NEW_PEAK, "effectiveFrom": f"{d}T03:15"}
        r = ops.post(rates_path("stn_oven1"), new)
        assert r.status_code == 201, r.text
        assert ops.post(rates_path("stn_oven1"), rate_body(old, f"{d}T03:30")).status_code == 201
        vers = {v["effectiveFrom"]: v for v in station(ops, "stn_oven1")["rates"]}
        assert vers[f"{d}T03:15"]["status"] == "scheduled" and vers[f"{d}T03:15"]["offPeakHourlyCents"] == NEW_STD
        c = confirm(ada, a)
        assert c.status_code in (200, 202) and c.json()["bookings"][0]["chargeCents"] == NEW_STD
        if b:
            cb = confirm(ada, b)
            assert cb.json()["bookings"][0]["chargeCents"] == old["offPeakHourlyCents"]
        assert station(ops, "stn_oven1")["currentRate"]["offPeakHourlyCents"] == old["offPeakHourlyCents"]


def test_kitchen_rule_settings(app_url: str) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    k = ops.kitchen()
    for who in (lead, ada):
        err(who.put("/api/kitchen/peak-windows", {"windows": k["peakWindows"], "rulesVersion": k["rulesVersion"]}),
            403, "forbidden", ERR["forbidden"])
        err(who.put("/api/kitchen/document-requirements", {"required": k["requiredDocuments"],
                                                           "rulesVersion": k["rulesVersion"]}), 403, "forbidden")
        err(who.post(rates_path("stn_oven1"), {"offPeakHourlyCents": 1, "peakHourlyCents": 1,
                                                        "effectiveFrom": "2031-01-01T00:00"}), 403, "forbidden")
    assert ops.kitchen()["rulesVersion"] == k["rulesVersion"]
    r = ops.put("/api/kitchen/peak-windows", {"windows": k["peakWindows"], "rulesVersion": k["rulesVersion"]})
    assert r.status_code == 200 and r.json()["rulesVersion"] == k["rulesVersion"] + 1 and set(r.json()) == KITCHEN_KEYS
    x = err(ops.put("/api/kitchen/peak-windows", {"windows": [], "rulesVersion": k["rulesVersion"]}), 412,
            "stale_version", ERR["stale_rules"])
    assert x["current"] == ops.kitchen() and x["current"]["peakWindows"] == k["peakWindows"]
    x = err(ops.put("/api/kitchen/document-requirements", {"required": [], "rulesVersion": k["rulesVersion"]}), 412,
            "stale_version")
    assert x["current"]["requiredDocuments"] == k["requiredDocuments"]
    v = ops.kitchen()["rulesVersion"]
    rs = together([lambda: ops.clone().put("/api/kitchen/document-requirements",
                                           {"required": k["requiredDocuments"], "rulesVersion": v}) for _ in range(2)])
    assert sorted(r.status_code for r in rs) == [200, 412]
    assert ops.kitchen()["rulesVersion"] == v + 1


def test_wf_rate_change_settings(browser: Browser, app_url: str) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    old = station(ops, "stn_oven2")["currentRate"]
    d = _rate_moment(lead, "02:15", uuid.uuid4().int % 70)
    with tidy() as t:
        with ui(browser, app_url, OPS_N, "/settings") as page:
            btn = page.get_by_role("button", name=edit_rates("stn_oven2"))
            ui_wait(page, lambda: shown(btn), "stations table")
            click(btn)
            dlg = page.get_by_role("dialog", name="Station rates")
            ui_wait(page, lambda: shown(dlg), "Station rates")
            fill(dlg.get_by_role("textbox", name="Standard hourly rate"), dollars(NEW_OVEN2_STD))
            fill(dlg.get_by_role("textbox", name="Peak hourly rate"), dollars(NEW_OVEN2_PEAK))
            fill(dlg.get_by_role("textbox", name="Effective from"), f"{d} {RATE_AT}")
            click(dlg.get_by_role("button", name="Save rates"))
            ui_wait(page, lambda: f"New rates for {N_NAMES['stn_oven2']} start {d} {RATE_AT}." in ann(page), "saved")
            assert dlg.count() == 0 and focused_name(page) == edit_rates("stn_oven2")
        assert ops.post(rates_path("stn_oven2"), rate_body(old, f"{d}T02:30")).status_code == 201
        assert hourly_free(lead.board(d), "stn_oven2", RATE_AT, RATE_TO)
        r = hold(ada, "stn_oven2", d, RATE_AT, RATE_TO)
        held_id(ada, r, t)
        assert r.json()["bookings"][0]["chargeCents"] == NEW_OVEN2_STD
        slots = [("22:00", "23:00"), ("06:00", "07:00")]
        try:
            st, d2, s, e = find_slot(lead, ["stn_oven2"], slots, first=1, month=ops.month)
        except AssertionError:
            st, d2, s, e = find_slot(lead, ["stn_oven2"], slots, first=1, last=90)
        r2 = hold(ada, st, d2, s, e)
        held_id(ada, r2, t)
        assert r2.json()["bookings"][0]["chargeCents"] == old["offPeakHourlyCents"]


def _next_fallback(today: str) -> str:
    y = int(today[:4])
    for year in (y, y + 1):
        nov = dt.date(year, 11, 1)
        sun = nov + dt.timedelta(days=(6 - nov.weekday()) % 7)
        if sun.isoformat() > today:
            return sun.isoformat()
    raise AssertionError("no fall-back date")


def test_rates_on_the_instant(app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    x = err(same_rates(ops, "stn_oven2", f"{DST_GAP_DATE}T02:30"), 422, "validation_failed")
    assert x["errors"]["effectiveFrom"] == f"02:30 does not exist on {DST_GAP_DATE} in {TZ_N} (clocks go forward)."
    fb = _next_fallback(ops.today)
    r = same_rates(ops, "stn_prep2", f"{fb}T01:{uuid.uuid4().int % 60:02d}")
    if r.status_code == 201:
        v = next(v for v in r.json()["station"]["rates"] if v["effectiveFrom"].startswith(f"{fb}T01:"))
        assert v["effectiveAt"].endswith("-04:00")
    else:
        err(r, 409, "rate_version_exists")
    assert err(same_rates(ops, "stn_oven2", PAST_EFFECTIVE), 422,
               "validation_failed")["errors"]["effectiveFrom"] == FIELD["future_rate"]
    for bad in (0, RATE_TOO_HIGH):
        body = {"offPeakHourlyCents": bad, "peakHourlyCents": PROBE_RATE, "effectiveFrom": FAR_EFFECTIVE}
        assert err(ops.post(rates_path("stn_oven2"), body), 422, "validation_failed")["errors"][
            "offPeakHourlyCents"] == FIELD["rate"]
    d = d_add(ops.today, 120 + uuid.uuid4().int % 50)
    ef = f"{d}T04:{7 + uuid.uuid4().int % 7:02d}"
    rs = together([lambda: same_rates(ops.clone(), "stn_oven2", ef) for _ in range(5)])
    assert sorted(r.status_code for r in rs) == [201] + [409] * 4
    lost = next(r for r in rs if r.status_code == 409)
    err(lost, 409, "rate_version_exists", f"A rate change for Oven 2 already starts {d} {ef[11:]}.")
    assert sum(1 for v in station(ops, "stn_oven2")["rates"] if v["effectiveFrom"] == ef) == 1
    now = ops.now().astimezone(ZoneInfo(TZ_N))
    at = (now + dt.timedelta(seconds=90)).replace(second=0, microsecond=0)
    if at.minute % 15 == 0:
        at += dt.timedelta(minutes=1)
    ef2 = at.strftime("%Y-%m-%dT%H:%M")
    r = same_rates(ops, "stn_prep1", ef2)
    assert r.status_code == 201, r.text
    prev = r.json()["station"]["currentRate"]["effectiveFrom"]
    assert next(v for v in r.json()["station"]["rates"] if v["effectiveFrom"] == ef2)["status"] == "scheduled"
    poll(lambda: station(ops, "stn_prep1")["currentRate"]["effectiveFrom"] == ef2, SWITCH_WAIT, "version current")
    s = station(ops, "stn_prep1")
    st_of = {v["effectiveFrom"]: v["status"] for v in s["rates"]}
    assert st_of[ef2] == "current" and st_of[prev] == "past"
    assert sum(1 for v in s["rates"] if v["status"] == "current") == 1


def test_wf_rate_change_live_status(browser: Browser, app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    old = station(ops, "stn_shelfA")["currentRate"]
    now = ops.now().astimezone(ZoneInfo(TZ_N))
    at = (now + dt.timedelta(seconds=100)).replace(second=0, microsecond=0)
    if at.minute % 15 == 0:
        at += dt.timedelta(minutes=1)
    ef = at.strftime("%Y-%m-%dT%H:%M")
    shown_at = at.strftime("%Y-%m-%d %H:%M")
    with ui(browser, app_url, OPS_N, "/settings") as page:
        versions = page.get_by_role("table", name="Rate versions")
        ui_wait(page, lambda: shown(versions), "rate versions")
        r = ops.post(rates_path("stn_shelfA"), {"shelfDayCents": SHELF_NEW_CENTS, "effectiveFrom": ef})
        assert r.status_code == 201, r.text
        revert = (at + dt.timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M")
        assert ops.post(rates_path("stn_shelfA"), rate_body(old, revert)).status_code == 201
        row = versions.get_by_role("row").filter(has_text="Walk-in Shelf A").filter(has_text=shown_at)
        ui_wait(page, lambda: shown(row) and "Scheduled" in row.first.inner_text(), "scheduled row", seconds=60)
        windows = page.get_by_role("group", name="Peak windows")
        n_before = windows.get_by_role("button", name=starts("Remove window ")).count()
        click(windows.get_by_role("button", name="Add peak window"))
        click(page.get_by_role("button", name=edit_rates("stn_oven1")))
        dlg = page.get_by_role("dialog", name="Station rates")
        ui_wait(page, lambda: shown(dlg), "dialog")
        box = dlg.get_by_role("textbox", name="Standard hourly rate")
        fill(box, TYPED_RATE)
        box.focus()
        poll(lambda: station(ops, "stn_shelfA")["currentRate"]["effectiveFrom"] == ef, SWITCH_WAIT, "server current")
        ui_wait(page, lambda: "Current" in row.first.inner_text(), "row turns Current")
        old_row = versions.get_by_role("row").filter(has_text="Walk-in Shelf A").filter(
            has_text=old["effectiveFrom"].replace("T", " "))
        assert "Past" in old_row.first.inner_text()
        stations = page.get_by_role("table", name="Stations").get_by_role("row").filter(has_text="Walk-in Shelf A")
        assert "$7.00" in stations.first.inner_text()
        assert shown(dlg) and box.input_value() == TYPED_RATE and focused_name(page) == "Standard hourly rate"
        assert windows.get_by_role("button", name=starts("Remove window ")).count() == n_before + 1


EXTRA_KEYS = ["effectiveAt", "status", "stationId", "kind", "rates", "capacity", "currentRate"]


def test_exact_write_bodies(app_url: str) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    n = len(station(ops, "stn_oven1")["rates"])
    base = {"offPeakHourlyCents": 100, "peakHourlyCents": 100, "effectiveFrom": "2032-02-03T04:07"}
    for k in EXTRA_KEYS:
        x = err(ops.post(rates_path("stn_oven1"), {**base, k: "x"}), 422, "validation_failed")
        assert x["errors"][k] == FIELD["not_settable"]
    x = err(ops.post(rates_path("stn_shelfA"), {"shelfDayCents": PROBE_RATE, "offPeakHourlyCents": 1,
                                                        "effectiveFrom": "2032-02-03T04:07"}), 422, "validation_failed")
    assert x["errors"]["offPeakHourlyCents"] == FIELD["not_settable"]
    assert len(station(ops, "stn_oven1")["rates"]) == n
    name = ada.name("mem_ada")
    x = err(ada.patch("/api/members/me", {"businessName": "Renamed", "email": "x@y.example", "allowanceHours": 99}),
            422, "validation_failed")
    assert x["errors"]["email"] == x["errors"]["allowanceHours"] == FIELD["not_settable"]
    assert ada.name("mem_ada") == name and bank(ada, "mem_ada", ada.month)["allowanceHours"] == ALLOW["mem_ada"]
    st, d, s, e = find_slot(lead, ["stn_prep2"], [("20:00", "21:00")], first=40)
    x = err(hold(ada, st, d, s, e, extra={"memberId": "mem_kofi", "chargeCents": 1, "status": "confirmed",
                                          "actions": []}), 422, "validation_failed")
    assert all(x["errors"][k] == FIELD["not_settable"] for k in ("memberId", "chargeCents", "status", "actions"))
    x = err(hold(ada, st, d, days=1), 422, "validation_failed")
    assert x["errors"]["days"] == FIELD["not_settable"]
    x = err(ada.post("/api/bookings", {"stationId": st, "date": d, "start": s}, key=idempotency_key()), 422,
            "validation_failed")
    assert x["errors"]["end"] == FIELD["required"]
    assert hourly_free(lead.board(d), st, s, e)


def test_upload_checks(app_url: str) -> None:
    kofi = Api(app_url, KOFI)
    exp = d_add(kofi.today, 200)
    n0 = len(docs(kofi))
    err(upload(kofi, "food_handler_card", exp, SVG, PROBE_FILE, "application/pdf"), 415, "unsupported_file_type",
        ERR["unsupported_file_type"])
    err(upload(kofi, "food_handler_card", exp, HTML_BYTES, PROBE_PNG_NAME, "image/png"), 415, "unsupported_file_type")
    err(upload(kofi, "food_handler_card", exp, PDF + b"\0" * (FILE_LIMIT + 1 - len(PDF))), 413, "payload_too_large",
        ERR["payload_too_large"])
    x = err(upload(kofi, BAD_TYPE, exp), 422, "validation_failed")
    assert x["errors"]["type"] == "Choose insurance certificate or food-handler card."
    assert err(upload(kofi, "food_handler_card", PAST_DATE), 422, "validation_failed")["errors"]["expiryDate"] == \
        "Enter an expiry date of today or later."
    assert len(docs(kofi)) == n0
    r = upload(kofi, "insurance_certificate", exp, PNG, "scan.pdf", "application/pdf")
    assert r.status_code == 201 and r.json()["document"]["contentType"] == "image/png"
    assert r.json()["document"]["status"] == "submitted" and r.json()["document"]["version"] == 1
    r = upload(kofi, "insurance_certificate", exp, JPEG, "scan.jpg", "image/jpeg")
    assert r.status_code == 201 and r.json()["document"]["contentType"] == "image/jpeg"
    big = PDF + b"\0" * (FILE_LIMIT - len(PDF))
    r = upload(kofi, "food_handler_card", exp, big, "big.pdf")
    assert r.status_code == 201 and r.json()["document"]["sizeBytes"] == FILE_LIMIT
    assert set(r.json()["document"]) == DOC_KEYS
    assert len(docs(kofi)) == n0 + 3


def test_safe_document_delivery(app_url: str) -> None:
    kofi, ada, lead, ops = Api(app_url, KOFI), Api(app_url, ADA), Api(app_url, LEAD_N), Api(app_url, OPS_N)
    r = upload(kofi, "insurance_certificate", d_add(kofi.today, 200), PNG, TRAVERSAL_NAME, HTML_TYPE)
    assert r.status_code == 201
    did = r.json()["document"]["id"]
    for who in (kofi, lead, ops):
        f = who.get(f"/api/documents/{did}/file")
        assert f.status_code == 200 and f.content == PNG
        assert f.headers["content-type"].startswith("image/png")
        cd = f.headers["content-disposition"]
        assert cd.startswith("attachment") and "/" not in cd and "<" not in cd
        name = re.search(r'filename="([^"]*)"', cd).group(1)
        assert SAFE_NAME.fullmatch(name)
        assert f.headers["X-Content-Type-Options"] == "nosniff"
        assert f.headers["Content-Security-Policy"].replace(" ", "") == CSP.replace(" ", "")
    err(ada.get(f"/api/documents/{did}/file"), 404, "not_found")
    err(Api(app_url).get(f"/api/documents/{did}/file"), 401, "unauthenticated")


def test_document_approval_states(app_url: str) -> None:
    kofi, ops = Api(app_url, KOFI), Api(app_url, OPS_N)
    exp = d_add(kofi.today, 10)
    r1, r2 = together([lambda: upload(kofi.clone(), "food_handler_card", exp, name="a.pdf"),
                       lambda: upload(kofi.clone(), "food_handler_card", exp, name="b.pdf")])
    assert r1.status_code == r2.status_code == 201
    ids = {r1.json()["document"]["id"], r2.json()["document"]["id"]}
    now = {d["id"]: d for d in docs(ops, "mem_kofi") if d["id"] in ids}
    assert sorted(d["status"] for d in now.values()) == ["submitted", "superseded"]
    sup = next(d for d in now.values() if d["status"] == "superseded")
    sub = next(d for d in now.values() if d["status"] == "submitted")
    assert sup["version"] == 2 and sub["version"] == 1
    x = err(approve(ops, sup), 409, "document_superseded",
            f"A newer food-handler card from {kofi.name('mem_kofi')} is waiting. Approve that one instead.")
    assert x["supersededBy"] == sub["id"] and x["current"]["id"] == sup["id"]
    x = err(ops.post(f"/api/documents/{sub['id']}/approve", {"version": 7}), 412, "stale_version", ERR["stale_doc"])
    assert x["current"] == doc(ops, sub["id"])
    err(Api(app_url, LEAD_N).post(f"/api/documents/{sub['id']}/approve", {"version": 1}), 403, "forbidden")
    a = approve(ops, sub)
    assert a.status_code == 200
    ad = a.json()["document"]
    assert ad["status"] == "expiring" and ad["version"] == 2 and ad["approvedAt"] and ad["current"] is False
    err(approve(ops, ad), 409, "invalid_transition")
    later = uploaded(kofi, ops, "food_handler_card", d_add(kofi.today, 20), approve_it=True)
    assert later["status"] == "approved"
    seed = next(d for d in docs(ops) if d["memberId"] == "mem_nadia" and d["type"] == "insurance_certificate"
                and d["fileName"] == "seed-insurance-certificate.pdf")
    assert seed["status"] == "expired"


def test_bookings_limited_by_expiry(app_url: str) -> None:
    lead, rina, nadia = Api(app_url, LEAD_N), Api(app_url, RINA), Api(app_url, NADIA)
    card = current_doc(rina, "mem_rina", "food_handler_card")
    assert card
    E = card["expiryDate"]
    msg = f"Your food-handler card expires on {E}, before this block."
    with tidy() as t:
        if hourly_free(lead.board(E), "stn_prep1", "23:00", "24:00"):
            held_id(rina, hold(rina, "stn_prep1", E, "23:00", "24:00"), t)
        d, s, e = d_add(E, 1), "08:00", "09:00"
        x = err(hold(rina, "stn_prep2", d, s, e), 422, "validation_failed")
        assert x["errors"]["documents"] == msg
        if shelf_left(lead, "stn_shelfA", E) and shelf_left(lead, "stn_shelfA", d_add(E, -1)):
            held_id(rina, hold(rina, "stn_shelfA", d_add(E, -1), days=2), t)
        x = err(hold(rina, "stn_shelfA", d_add(E, -1), days=3), 422, "validation_failed")
        assert x["errors"]["documents"] == msg
        x = err(hold(rina, "stn_prep2", d_add(E, -6), "06:00", "07:00", weeks=2), 422, "validation_failed")
        assert x["errors"]["documents"] == msg
    x = err(hold(nadia, "stn_prep2", d_add(nadia.today, 41), "06:00", "07:00"), 422, "validation_failed")
    ins = current_doc(nadia, "mem_nadia", "insurance_certificate")
    assert x["errors"]["documents"] in {"Upload an approved food-handler card before booking.",
                                        f"Your insurance certificate expires on {ins['expiryDate']}, before this block."}


def test_expiry_notices(app_url: str, mail: Mailpit) -> None:
    base = kbdown_url()
    ops, nadia = Api(base, OPS_N), Api(base, NADIA)
    today = ops.today
    plan = [(2, "3-day"), (4, "14-day"), (14, "14-day"), (15, None), (3, None)]
    for days, kind in plan:
        before = mail_ids(mail)
        exp = d_add(today, days)
        d = uploaded(nadia, ops, "insurance_certificate", exp, approve_it=True)

        def mine(m: dict, exp: str = exp) -> bool:
            return to(m) == [NADIA] and subj(m).endswith(f"notice: your insurance certificate expires on {exp}")
        if kind:
            got = new_mail(mail, before, mine)
            assert [subj(m) for m in got] == [f"{kind} notice: your insurance certificate expires on {exp}"]
        else:
            quiet()
            assert not new_mail(mail, before, mine, n=0, seconds=1)
        if days == 15:
            assert d["status"] == "approved"


def test_record_and_object(app_url: str) -> None:
    kofi = Api(app_url, KOFI)
    s3 = S3()
    pre = prefix("kit_northside", "mem_kofi")
    body = PDF + uuid.uuid4().hex.encode()
    r = upload(kofi, "food_handler_card", d_add(kofi.today, 200), body, "unique.pdf")
    assert r.status_code == 201
    did = r.json()["document"]["id"]
    assert s3.get(doc_key("kit_northside", "mem_kofi", did)) == body
    keys = set(s3.keys(pre))
    for bad in [upload(kofi, "food_handler_card", d_add(kofi.today, 200), SVG, SVG_NAME, SVG_TYPE),
                upload(kofi, "nope", d_add(kofi.today, 200))]:
        assert bad.status_code in (415, 422)
    assert set(s3.keys(pre)) == keys == {pre + d["id"] for d in docs(kofi) if d["memberId"] == "mem_kofi"}
    down = Api(s3down_url(), KOFI)
    n = len(docs(down))
    downs3 = S3(S3DOWN)
    before = outage_keys(downs3, pre)
    err(upload(down, "food_handler_card", d_add(down.today, 200)), 503, "storage_unavailable", ERR["storage_upload"])
    assert len(docs(down)) == n and outage_keys(downs3, pre) == before


def test_seeded_documents(app_url: str, mail: Mailpit) -> None:
    ops, jonah = Api(app_url, OPS_N), Api(app_url, OPS_H)
    s3 = S3()

    def seeds() -> list[dict[str, Any]]:
        return [d for d in docs(ops) + docs(jonah) if d["fileName"].startswith("seed-")]
    got = seeds()
    assert len(got) == 9
    first = local_of(got[0]["uploadedAt"], TZ_N)[0]
    plan = {("mem_rina", "food_handler_card"): 40, ("mem_nadia", "insurance_certificate"): -1}
    members = {"mem_ada": "kit_northside", "mem_kofi": "kit_northside", "mem_rina": "kit_northside",
               "mem_nadia": "kit_northside", "mem_omar": "kit_harbor"}
    for d in got:
        assert d["version"] == 2 and d["contentType"] == "application/pdf" and d["uploadedAt"] == d["approvedAt"]
        assert d["fileName"] == f"seed-{d['type'].replace('_', '-')}.pdf"
        assert d["expiryDate"] == d_add(first, plan.get((d["memberId"], d["type"]), 365))
        obj = s3.get(doc_key(members[d["memberId"]], d["memberId"], d["id"]))
        assert obj.startswith(b"%PDF-") and len(obj) == d["sizeBytes"]
    assert next(d for d in got if d["memberId"] == "mem_nadia")["status"] == "expired"
    assert len([d for d in got if d["memberId"] == "mem_omar"]) == 2
    before = mail_ids(mail)
    snap = {d["id"]: (d["uploadedAt"], d["expiryDate"], d["sizeBytes"]) for d in got}
    with app_copy() as copy:
        assert Api(copy, OPS_N).get("/api/documents").status_code == 200
        quiet()
    again = seeds()
    assert {d["id"]: (d["uploadedAt"], d["expiryDate"], d["sizeBytes"]) for d in again} == snap
    assert not new_mail(mail, before, lambda m: "-day notice: " in subj(m), n=0, seconds=1)


def test_wf_member_documents_keep_current(browser: Browser, app_url: str) -> None:
    lead, rina = Api(app_url, LEAD_N), Api(app_url, RINA)
    E = current_doc(rina, "mem_rina", "food_handler_card")["expiryDate"]
    d = d_add(E, 1)
    assert err(hold(rina, "stn_prep2", d, "07:00", "08:00"), 422, "validation_failed")["errors"]["documents"]
    newexp = max(d_add(rina.today, 150), d_add(E, 1))
    fname = f"renewed-{uuid.uuid4().hex[:6]}.pdf"
    with ui(browser, app_url, RINA, "/documents") as page:
        ui_wait(page, lambda: shown(page.get_by_role("button", name="Upload")), "upload form")
        select(page.get_by_role("combobox", name="Document type"), "Food-handler card")
        fill(page.get_by_role("textbox", name="Expiry date"), newexp)
        page.get_by_label("File", exact=True).set_input_files(files=[{"name": fname, "mimeType": "application/pdf",
                                                                      "buffer": PDF}])
        click(page.get_by_role("button", name="Upload"))
        ui_wait(page, lambda: "Uploaded. Waiting for approval." in ann(page), "uploaded")
    biz = rina.name("mem_rina")
    with ui(browser, app_url, OPS_N, "/documents") as page:
        btn = page.get_by_role("button", name=f"Approve {biz} food-handler card")
        ui_wait(page, lambda: shown(btn), "approve button")
        click(btn)
        ui_wait(page, lambda: f"Approved {biz} food-handler card." in ann(page), "approved")
    cur = current_doc(rina, "mem_rina", "food_handler_card")
    assert cur["fileName"] == fname and cur["expiryDate"] == newexp
    with tidy() as t:
        offset = (dt.date.fromisoformat(d) - dt.date.fromisoformat(rina.today)).days
        st, dd, s, e = find_slot(lead, ["stn_prep2", "stn_prep1"], [("07:00", "08:00"), ("08:00", "09:00")],
                                 first=offset, last=offset)
        held_id(rina, hold(rina, st, dd, s, e), t)


def test_wf_member_documents_layout_switch(browser: Browser, app_url: str) -> None:
    ops, kofi = Api(app_url, OPS_N), Api(app_url, KOFI)
    fname = f"switch-{uuid.uuid4().hex[:6]}.pdf"
    d = uploaded(kofi, ops, "food_handler_card", d_add(kofi.today, 250), name=fname)
    name = f"Approve {kofi.name('mem_kofi')} food-handler card"
    with ui(browser, app_url, OPS_N, "/documents", size=(SWITCH, 1024)) as page:
        table = page.get_by_role("table", name="Documents")
        ui_wait(page, lambda: shown(table), "table layout")
        assert [h.inner_text().strip().lower() for h in table.get_by_role("columnheader").all()] == [x.lower() for x in DOC_HEADERS]
        btn = page.get_by_role("button", name=name)
        ui_wait(page, lambda: shown(btn), "approve")
        seen: list[str] = []
        page.on("request", lambda r: seen.append(urlparse(r.url).path))
        btn.focus()
        with held(page, APPROVE_GLOB) as gate:
            page.keyboard.press("Enter")
            ui_wait(page, lambda: btn.get_attribute("aria-busy") == "true", "busy")
            page.set_viewport_size({"width": SWITCH - 1, "height": 1024})
            lst = page.get_by_role("list", name="Documents")
            ui_wait(page, lambda: shown(lst) and not shown(table), "list layout")
            item = lst.get_by_role("listitem").filter(has_text=fname).first
            txt = item.inner_text()
            pos = [txt.lower().find(x.lower()) for x in DOC_HEADERS[:-1]]
            assert all(p >= 0 for p in pos) and pos == sorted(pos)
            b2 = page.get_by_role("button", name=name)
            assert b2.get_attribute("aria-busy") == "true" and b2.is_disabled() and focused_name(page) == name
            assert "/api/documents" not in seen
            layout(page)
            gate.release()
        poll(lambda: doc(ops, d["id"])["status"] == "approved", UI_WAIT, "approved")


def test_member_invoice(browser: Browser, app_url: str) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        b, c = _late_cancelled(ada, lead, t, ["stn_prep1", "stn_prep2"])
        m = b["localDate"][:7]
        wait_billed(ada, b["id"])
        poll(lambda: all(x["billingStatus"] == "billed" for x in lines_for(invoice(ops, "mem_ada", m), b["id"])),
             KB_WAIT, "lines billed")
        inv = invoice(ops, "mem_ada", m)
        assert set(inv) == {"memberId", "month", "status", "lines", "totalCents", "hourBank"} and inv["status"] == "open"
        assert inv["totalCents"] == sum(x["amountCents"] for x in inv["lines"])
        assert all(set(x) == {"kind", "bookingId", "description", "amountCents", "billingStatus"} for x in inv["lines"])
        mine = lines_for(inv, b["id"])
        assert [x["description"] for x in mine] == [f"Booking {b['id']} {blabel(b)}", f"Late cancellation {b['id']}",
                                                     f"Cancelled {b['id']}"]
        assert invoice(ada, "mem_ada", m) == inv
        with ui(browser, app_url, ADA, f"/invoices?month={m}") as page:
            reg = page.get_by_role("region", name="Invoice")
            ui_wait(page, lambda: f"Total {money(inv['totalCents'])}" in reg.inner_text(), "total")
            row = reg.get_by_role("row").filter(has_text=f"Late cancellation {b['id']}")
            assert "Billed" in row.first.inner_text() and "Invoice open" in reg.inner_text()


def test_month_close_kill_bill(app_url: str, killbill: KillBill) -> None:
    ops, lead, omar = Api(app_url, OPS_H), Api(app_url, LEAD_H), Api(app_url, OMAR)
    st, d, s, e = harbor_open_slot(ops, lead, [("06:00", "08:00")])
    m = d[:7]
    t: list = []
    a = book(omar, st, d, "06:00", "07:00", t=t)
    hid = held_id(omar, hold(omar, st, d, "07:00", "08:00"), t)
    wait_billed(omar, a["id"])
    rs = together([lambda: confirm(omar.clone(), hid)] + [lambda: ops.clone().post(f"/api/months/{m}/close", {})
                                                          for _ in range(3)])
    cr, closes = rs[0], rs[1:]
    codes = [(r.status_code, r.json().get("error")) for r in closes]
    oks = sum(1 for c in codes if c[0] == 200)
    assert all(c in {(200, None), (409, "month_closed"), (409, "billing_pending")} for c in codes), codes
    if oks == 0:
        r = close_month(ops, m)
        assert r.status_code == 200, r.text
        winner = r
    else:
        assert oks == 1
        winner = next(r for r in closes if r.status_code == 200)
    err(ops.post(f"/api/months/{m}/close", {}), 409, "month_closed", f"{month_name(m)} is closed.")
    inv = invoice(ops, "mem_omar", m)
    assert inv["status"] == "closed"
    assert winner.json()["month"] == m and {"memberId": "mem_omar", "totalCents": inv["totalCents"]} in winner.json()["invoices"]
    items = [i for i in kb_items(killbill, "mem_omar") if a["id"] in (i.get("description") or "")]
    invs = {i["_invoice"]["invoiceId"]: i["_invoice"] for i in items}
    assert len(invs) == 1
    kbinv = next(iter(invs.values()))
    assert committed(kbinv) and kb_amount(kbinv) == inv["totalCents"]
    if cr.status_code in (200, 202):
        assert lines_for(inv, hid) and any(hid in (i.get("description") or "") for i in kbinv["items"])
    else:
        err(cr, 409, "month_closed")
        assert not lines_for(inv, hid)
        assert not [i for i in kb_items(killbill, "mem_omar") if hid in (i.get("description") or "")]
    err(cancel(omar, a["id"]), 409, "month_closed")
    err(hold(omar, st, d, "09:00", "10:00"), 409, "month_closed")
    assert get_booking(ops, a["id"])["actions"] == []


def test_statement_emails(app_url: str, mail: Mailpit) -> None:
    ops, lead, omar = Api(app_url, OPS_H), Api(app_url, LEAD_H), Api(app_url, OMAR)
    st, d, s, e = harbor_open_slot(ops, lead, [("09:00", "11:00")])
    m = d[:7]
    t: list = []
    a = book(omar, st, d, "09:00", "10:00", t=t)
    b = book(omar, st, d, "10:00", "11:00", t=t)
    assert cancel(omar, b["id"]).status_code == 200
    for x in (a, b):
        wait_billed(omar, x["id"])
    before = mail_ids(mail)
    assert close_month(ops, m).status_code == 200
    name = omar.name("mem_omar")
    inv = invoice(ops, "mem_omar", m)
    got = new_mail(mail, before, lambda x: to(x) == [OMAR] and subj(x).startswith("Statement for "))
    assert len(got) == 1 and subj(got[0]) == f"Statement for {month_name(m)}: {name}"
    want = [f"Statement for {month_name(m)}", name, ""] + \
        [f"{x['description']} {money(x['amountCents'])}" for x in inv["lines"]] + ["", f"Total {money(inv['totalCents'])}"]
    body = text(got[0]).replace("\r\n", "\n").rstrip("\n")
    assert body == "\n".join(want)
    assert "Bello" not in body and "Smokestack" not in body
    before = mail_ids(mail)
    err(ops.post(f"/api/months/{m}/close", {}), 409, "month_closed")
    quiet()
    assert not new_mail(mail, before, lambda x: subj(x).startswith("Statement for "), n=0, seconds=1)


def test_billing_mismatch(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    ops, lead, omar = Api(app_url, OPS_H), Api(app_url, LEAD_H), Api(app_url, OMAR)
    st, d, s, e = harbor_open_slot(ops, lead, [("12:00", "13:00")])
    m = d[:7]
    a = book(omar, st, d, s, e, t=[])
    wait_billed(omar, a["id"])
    draft = next(i["_invoice"] for i in kb_items(killbill, "mem_omar") if a["id"] in (i.get("description") or ""))
    line = {"accountId": draft["accountId"], "invoiceId": draft["invoiceId"], "amount": BOOKKEEPER_DOLLARS,
            "currency": "USD", "description": "Bookkeeper charge", "startDate": f"{m}-01"}
    kb_write(killbill, f"/invoices/charges/{draft['accountId']}?autoCommit=false", line)
    before = mail_ids(mail)
    x = err(ops.post(f"/api/months/{m}/close", {}), 409, "billing_mismatch",
            f"Kill Bill's draft for {omar.name('mem_omar')} does not match Lineboard. The month stays open.")
    assert x["members"] == ["mem_omar"]
    assert month_open(ops, m)
    mine = [i for i in kb_items(killbill, "mem_omar") if a["id"] in (i.get("description") or "")]
    assert mine and all(not committed(i["_invoice"]) for i in mine)
    quiet()
    assert not new_mail(mail, before, lambda y: subj(y).startswith("Statement for "), n=0, seconds=1)
    kb_write(killbill, "/credits?autoCommit=false", {**line, "description": "Bookkeeper reversal"})
    r = poll(lambda: (r := close_month(ops, m)).status_code == 200 and r, KB_WAIT, "close after reversal")
    assert r.json()["month"] == m


def test_closed_month_frozen(app_url: str, killbill: KillBill) -> None:
    ops, lead, omar = Api(app_url, OPS_H), Api(app_url, LEAD_H), Api(app_url, OMAR)
    b, c = _late_cancelled(omar, lead, [], H_HOURLY)
    M = b["localDate"][:7]
    wait_billed(omar, b["id"])
    assert close_month(ops, M).status_code == 200
    paths = (f"/api/members/mem_omar/invoices/{M}", f"/api/reports/utilisation?month={M}",
             f"/api/exports/usage.csv?month={M}")
    snap = [ops.get(p).content for p in paths]
    adj = earliest_open(ops)
    r = ops.post(f"/api/bookings/{b['id']}/waive-penalty", {}, key=idempotency_key())
    assert r.status_code == 200 and r.json()["creditMonth"] == adj and r.json()["booking"]["penaltyWaived"] is True
    assert [ops.get(p).content for p in paths] == snap
    fee = c["penaltyCents"]
    it = kb_wait(killbill, "mem_omar", f"Adjustment: waived late cancellation {b['id']} ({month_name(M)})")
    assert len(it) == 1 and cents(it[0]["amount"]) == -fee
    line = [x for x in lines_for(invoice(ops, "mem_omar", adj), b["id"]) if x["kind"] == "credit"]
    assert [x["amountCents"] for x in line] == [-fee]
    rows = [x for x in export(ops, adj) if x["booking_id"] == b["id"]]
    assert len(rows) == 1
    row = rows[0]
    assert (row["status"], row["charge"], row["penalty"], row["hours"], row["start"], row["notes"]) == \
        ("adjustment", dollars(-fee), "0.00", "0", "", "")
    assert row["date"] == ops.today
    rep = report(ops, adj)
    assert rep["totals"]["adjustmentCents"] <= -fee
    tot = sum(cents(x["charge"]) + cents(x["penalty"]) for x in export(ops, adj))
    assert tot == rep["totals"]["revenueCents"] + rep["totals"]["adjustmentCents"] == invoice(ops, "mem_omar", adj)["totalCents"]


UNLISTED = [("PUT", "/api/months/{m}/close"), ("PATCH", "/api/months/{m}/close"), ("DELETE", "/api/months/{m}/close"),
            ("POST", "/api/months/{m}/reopen"), ("POST", "/api/reset"), ("POST", "/api/seed"),
            ("POST", "/api/test-clock"), ("GET", "/api/debug"), ("GET", "/api/admin"),
            ("DELETE", "/api/members/mem_omar/invoices/{m}"), ("PATCH", "/api/members/mem_omar/invoices/{m}")]


def test_only_published_api(app_url: str, killbill: KillBill) -> None:
    ops, lead, omar = Api(app_url, OPS_H), Api(app_url, LEAD_H), Api(app_url, OMAR)
    m = harbor_closed_with_booking(ops, lead, omar)
    paths = (f"/api/members/mem_omar/invoices/{m}", f"/api/reports/utilisation?month={m}",
             f"/api/exports/usage.csv?month={m}")
    snap = [ops.get(p).content for p in paths]
    kb = sorted((i["_invoice"]["invoiceId"], kb_amount(i["_invoice"])) for i in kb_items(killbill, "mem_omar")
                if committed(i["_invoice"]))
    for method, p in UNLISTED:
        r = ops.send(method, p.format(m=m), {} if method != "GET" else NOBODY)
        assert r.status_code == 404 and r.json() == {"error": "not_found", "message": ERR["not_found"]}, (method, p)
    err(Api(app_url).send("POST", f"/api/months/{m}/reopen", {}), 401, "unauthenticated")
    err(ops.send("POST", f"/api/months/{m}/reopen", {}, headers={"Origin": "http://evil.example"}), 403, "cross_origin")
    assert [ops.get(p).content for p in paths] == snap
    assert sorted((i["_invoice"]["invoiceId"], kb_amount(i["_invoice"])) for i in kb_items(killbill, "mem_omar")
                  if committed(i["_invoice"])) == kb


def test_wf_month_close_two_tabs(browser: Browser, app_url: str, mail: Mailpit) -> None:
    ops, lead, omar = Api(app_url, OPS_H), Api(app_url, LEAD_H), Api(app_url, OMAR)
    st, d, s, e = harbor_open_slot(ops, lead, [("15:00", "16:00")])
    m, mn = d[:7], month_name(d[:7])
    a = book(omar, st, d, s, e, t=[])
    wait_billed(omar, a["id"])
    before = mail_ids(mail)
    path = f"/invoices?month={m}&member=mem_omar"
    with ui(browser, app_url, OPS_H, path) as p1, ui(browser, app_url, OPS_H, path) as p2:
        for p in (p1, p2):
            ui_wait(p, lambda p=p: shown(p.get_by_role("button", name="Close month")), "close button")
        btn = p1.get_by_role("button", name="Close month")
        click(btn)
        dlg = p1.get_by_role("dialog", name="Close month")
        ui_wait(p1, lambda: shown(dlg), "dialog")
        assert f"Close {mn}? Bookings in this month can no longer change." in dlg.inner_text()
        with held(p1, CLOSE_GLOB) as gate:
            click(dlg.get_by_role("button", name=f"Close {mn}"))
            ui_wait(p1, lambda: f"Closing {mn}…" in ann(p1), "pending copy")
            assert btn.get_attribute("aria-busy") == "true" and btn.inner_text().strip() == "Close month"
            gate.release()
        ui_wait(p1, lambda: f"{mn} closed. {1} invoices committed." in ann(p1), "result copy")
        ui_wait(p1, lambda: "Invoice closed" in p1.get_by_role("region", name="Invoice").inner_text(), "closed")
        assert p1.get_by_role("button", name="Close month").count() == 0
        click(p2.get_by_role("button", name="Close month"))
        d2 = p2.get_by_role("dialog", name="Close month")
        ui_wait(p2, lambda: shown(d2), "second dialog")
        click(d2.get_by_role("button", name=f"Close {mn}"))
        ui_wait(p2, lambda: f"{mn} is closed." in alerts(p2), "month_closed alert")
        ui_wait(p2, lambda: "Invoice closed" in p2.get_by_role("region", name="Invoice").inner_text(), "redrawn")
        advance(p2, REFRESH_MS + 1000)
        assert "Invoice open" not in p2.get_by_role("region", name="Invoice").inner_text()
        assert p2.get_by_role("button", name="Close month").count() == 0
    assert invoice(ops, "mem_omar", m)["status"] == "closed"
    assert len(new_mail(mail, before, lambda x: to(x) == [OMAR] and subj(x).startswith(f"Statement for {mn}"))) == 1


def test_wf_month_close_invoice_refresh(browser: Browser, app_url: str) -> None:
    base = kbdown_url()
    lead, ada = Api(base, LEAD_N), Api(base, ADA)
    st, d, s, e = find_slot(lead, ["stn_prep1"], [("13:00", "14:00")], first=45)
    with tidy() as t:
        b = book(ada, st, d, s, e, t=t)
        assert b["billingStatus"] == "pending_billing"
        with ui(browser, base, OPS_N, f"/invoices?month={d[:7]}&member=mem_ada") as page:
            reg = page.get_by_role("region", name="Invoice")
            row = reg.get_by_role("row").filter(has_text=f"Booking {b['id']}")
            ui_wait(page, lambda: shown(row) and "Pending billing" in row.first.inner_text(), "pending line")
            click(page.get_by_role("button", name="Close month"))
            dlg = page.get_by_role("dialog", name="Close month")
            ui_wait(page, lambda: shown(dlg), "dialog")
            focus = focused_name(page)
            relay = Relay(os.environ["KILLBILL_URL"])
            try:
                with app_copy(KILLBILL_URL=relay.url, **outage_env(KBDOWN_DB, KBDOWN_BUCKET)):
                    relay.start()
                    wait_billed(ada, b["id"], RECOVERY_S + SLACK)
                    ui_wait(page, lambda: "Billed" in row.first.inner_text() and "Pending billing" not in
                            row.first.inner_text(), "line turns Billed")
                    assert shown(dlg) and focused_name(page) == focus
            finally:
                relay.stop()


def test_utilisation_totals(app_url: str) -> None:
    ops, lead, ada, jonah = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA), Api(app_url, OPS_H)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("18:00", "20:00")], first=46, weekdays=(0, 1, 2, 3, 4))
        m = d[:7]
        r0 = report(ops, m)
        b = book(ada, st, d, s, e, t=t)
        r1 = report(ops, m)
        assert [x["stationId"] for x in r1["stations"]] == N_STATIONS
        s0 = next(x for x in r0["stations"] if x["stationId"] == st)
        s1 = next(x for x in r1["stations"] if x["stationId"] == st)
        assert s1["bookedHours"] - s0["bookedHours"] == 2 and s1["peakHours"] - s0["peakHours"] == 1
        assert s1["revenueCents"] - s0["revenueCents"] == b["chargeCents"]
        for k in ("bookedHours", "peakHours", "shelfDays", "revenueCents"):
            assert r1["totals"][k] == sum(x[k] for x in r1["stations"])
        members = ["mem_ada", "mem_kofi", "mem_rina", "mem_nadia"]
        assert sum(invoice(ops, x, m)["totalCents"] for x in members) == \
            r1["totals"]["revenueCents"] + r1["totals"]["adjustmentCents"]
        hb = report(jonah, m)
        assert {x["stationId"] for x in hb["stations"]} == H_STATIONS
    err(Api(app_url, LEAD_N).get(f"/api/reports/utilisation?month={m}"), 403, "forbidden")


def test_usage_export(app_url: str) -> None:
    ops, lead, kofi = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, KOFI)
    old = kofi.name("mem_kofi")
    bad = f"-Smokestack {uuid.uuid4().hex[:5]}"
    try:
        assert kofi.patch("/api/members/me", {"businessName": bad}).status_code == 200
        with tidy() as t:
            st, d, s, e = find_slot(lead, ["stn_prep1"], [("15:00", "16:00")], first=47)
            b = book(kofi, st, d, s, e, notes=FORMULA_NOTE, t=t)
            m = d[:7]
            r = ops.get(f"/api/exports/usage.csv?month={m}")
            assert r.headers["content-type"].startswith("text/csv") and "charset=utf-8" in r.headers["content-type"].lower()
            assert r.headers["Content-Disposition"] == f'attachment; filename="lineboard-usage-{NORTHSIDE_SLUG}-{m}.csv"'
            raw = r.content.decode("utf-8")
            assert raw.split(CRLF)[0] == CSV_HEADER
            rows = list(csv.DictReader(io.StringIO(raw)))
            row = next(x for x in rows if x["booking_id"] == b["id"])
            assert row["business_name"] == "'" + bad and row["notes"] == "'" + FORMULA_NOTE
            assert (row["date"], row["start"], row["end"], row["charge"]) == (d, s, e, dollars(b["chargeCents"]))
            for x in rows:
                for col in NUMERIC_COLS:
                    assert NUMERIC_RE.match(x[col]), (col, x[col])
            rep = report(ops, m)
            assert sum(cents(x["charge"]) + cents(x["penalty"]) for x in rows) == \
                rep["totals"]["revenueCents"] + rep["totals"]["adjustmentCents"]
    finally:
        kofi.patch("/api/members/me", {"businessName": old})
    err(Api(app_url, LEAD_N).get(f"/api/exports/usage.csv?month={ops.month}"), 403, "forbidden")


def test_wf_usage_reporting_export(browser: Browser, app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    a = month_add(ops.month, 1)
    b = month_add(a, 1)
    with ui(browser, app_url, OPS_N, f"/reports?month={a}") as page:
        reg = page.get_by_role("region", name="Utilisation report")
        ui_wait(page, lambda: f"Utilisation for {month_name(a)}" in reg.inner_text(), "report A")
        box = page.get_by_role("textbox", name="Month")
        fill(box, b)
        box.press("Enter")
        ui_wait(page, lambda: qs(page.url).get("month") == b and f"Utilisation for {month_name(b)}" in reg.inner_text(),
                "report B")
        page.go_back()
        ui_wait(page, lambda: qs(page.url).get("month") == a and f"Utilisation for {month_name(a)}" in reg.inner_text(),
                "back to A")
        assert box.input_value() == a
        link = page.get_by_role("link", name="Export usage CSV")
        assert href(link).endswith(f"/api/exports/usage.csv?month={a}")
        rep = report(ops, a)
        assert f"Adjustments {money(rep['totals']['adjustmentCents'])}" in reg.inner_text()
        with page.expect_download() as dl:
            click(link)
        raw = Path(dl.value.path()).read_bytes().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(raw)))
    total = sum(cents(x["charge"]) + cents(x["penalty"]) for x in rows)
    assert total == rep["totals"]["revenueCents"] + rep["totals"]["adjustmentCents"] == \
        sum(invoice(ops, x, a)["totalCents"] for x in ("mem_ada", "mem_kofi", "mem_rina", "mem_nadia"))


def test_shareable_urls(browser: Browser, app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    m = ops.month
    with ui(browser, app_url, OPS_N, "/board") as page:
        ui_wait(page, lambda: "date" in qs(page.url), "board date")
        page.goto(app_url + "/reports")
        ui_wait(page, lambda: qs(page.url).get("month") == m, "month filled")
        page.go_back()
        ui_wait(page, lambda: path_of(page.url) == "/board", "replaced entry")
        nm = month_add(m, 1)
        page.goto(app_url + f"/reports?month={nm}")
        reg = page.get_by_role("region", name="Utilisation report")
        ui_wait(page, lambda: f"Utilisation for {month_name(nm)}" in reg.inner_text(), "report")
        page.reload()
        ui_wait(page, lambda: f"Utilisation for {month_name(nm)}" in reg.inner_text(), "after reload")
        page.goto(app_url + f"/bookings?month={BAD_MONTH}")
        ui_wait(page, lambda: FIELD["month"] in page.get_by_role("main").inner_text(), "month error")
        assert page.get_by_role("textbox", name="Month").input_value() == BAD_MONTH
        assert page.get_by_role("table", name="Bookings").count() == 0
        page.goto(app_url + f"/board?date={BAD_DATE}")
        ui_wait(page, lambda: FIELD["date"] in alerts(page), "date error")
        assert board_region(page).get_by_role("group").count() == 0
        page.goto(app_url + f"/invoices?month={m}&member=mem_omar")
        ui_wait(page, lambda: ERR["member_not_found"] in alerts(page), "member error")
        assert page.get_by_role("table", name="Invoice lines").count() == 0


def test_business_name_changes(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    ops, lead, ada = Api(app_url, OPS_N), Api(app_url, LEAD_N), Api(app_url, ADA)
    ops_h, lead_h, omar = Api(app_url, OPS_H), Api(app_url, LEAD_H), Api(app_url, OMAR)
    old_a, old_o = ada.name("mem_ada"), omar.name("mem_omar")
    tag = uuid.uuid4().hex[:5]
    new = f"Bello Bakés {tag} 🍞"
    closed = harbor_closed_with_booking(ops_h, lead_h, omar)
    snap = ops_h.get(f"/api/exports/usage.csv?month={closed}").content
    before = mail_ids(mail)
    try:
        err(ada.patch("/api/members/me", {"businessName": "Bello\u2028Bcc: x@evil.example"}), 422, "validation_failed")
        assert ada.name("mem_ada") == old_a
        r = ada.patch("/api/members/me", {"businessName": new})
        assert r.status_code == 200 and r.json()["member"]["businessName"] == new
        assert omar.patch("/api/members/me", {"businessName": f"Haddad {tag}"}).status_code == 200
        assert ops_h.get(f"/api/exports/usage.csv?month={closed}").content == snap
        with tidy() as t:
            st, d, s, e = find_slot(lead, ["stn_prep2"], [("11:00", "12:00")], first=48)
            b = book(ada, st, d, s, e, t=t)
            assert next(x for x in lead.board(d)["blocks"] if x["id"] == b["id"])["businessName"] == new
            assert [x["businessName"] for x in ops.get(f"/api/members?q={tag}").json()["members"]] == [new]
            assert next(x for x in export(ops, d[:7]) if x["booking_id"] == b["id"])["business_name"] == new
            got = new_mail(mail, before, lambda m: subj(m) == f"Booking confirmed: {label(st, d, s, e)}")
            assert len(got) == 1 and new in text(got[0])
            want = "".join("\ufffd" if ord(ch) > 0xFFFF else ch for ch in new)
            poll(lambda: (killbill.account_by_key("mem_ada") or {}).get("name") == want, RECOVERY_S + SLACK,
                 "Kill Bill account name")
    finally:
        ada.patch("/api/members/me", {"businessName": old_a})
        omar.patch("/api/members/me", {"businessName": old_o})


def test_text_code_points(app_url: str) -> None:
    nadia, lead = Api(app_url, NADIA), Api(app_url, LEAD_N)
    old = nadia.name("mem_nadia")
    try:
        assert nadia.patch("/api/members/me", {"businessName": "🍞" * NAME_MAX}).json()["member"]["businessName"] == "🍞" * NAME_MAX
        assert err(nadia.patch("/api/members/me", {"businessName": "🍞" * (NAME_MAX + 1)}), 422,
                   "validation_failed")["errors"]["businessName"] == FIELD["business"]
        dec = "e\u0301" * NAME_MAX
        got = nadia.patch("/api/members/me", {"businessName": dec}).json()["member"]["businessName"]
        assert got == unicodedata.normalize("NFC", dec) and len(got) == NAME_MAX
        assert nadia.patch("/api/members/me", {"businessName": CAFE_DECOMPOSED}).json()["member"]["businessName"] == CAFE
        for ch in ("\t", "\n", "\r", "\u0085", "\u2029", "\u007f"):
            err(nadia.patch("/api/members/me", {"businessName": f"Okoro{ch}Spice"}), 422, "validation_failed")
        assert nadia.name("mem_nadia") == CAFE
    finally:
        nadia.patch("/api/members/me", {"businessName": old})
    ada = Api(app_url, ADA)
    st, d, s, e = find_slot(lead, ["stn_prep1"], [("20:00", "21:00")], first=49)
    assert err(hold(ada, st, d, s, e, notes="🍞" * (NOTES_MAX + 1)), 422, "validation_failed")["errors"]["notes"] == FIELD["notes"]
    with tidy() as t:
        r = hold(ada, st, d, s, e, notes="🍞" * NOTES_MAX)
        held_id(ada, r, t)
        assert r.json()["bookings"][0]["notes"] == "🍞" * NOTES_MAX
    x = err(lead.post("/api/out-of-service", {"stationId": "stn_prep1", "date": d, "start": "05:00", "end": "09:00",
                                              "reason": "🍞" * (REASON_MAX + 1)}), 422, "validation_failed")
    assert x["errors"]["reason"] == FIELD["reason"]
    x = err(lead.post("/api/sanitation-entries", {"area": AREA, "task": "🍞" * (TASK_MAX + 1), "initials": INITIALS}),
            422, "validation_failed")
    assert x["errors"]["task"] == FIELD["task"]
    r = lead.post("/api/sanitation-entries", {"area": AREA, "task": "🍞" * TASK_MAX, "initials": INITIALS})
    assert r.status_code == 201 and r.json()["entry"]["task"] == "🍞" * TASK_MAX


def test_wf_usage_reporting_latest_view(browser: Browser, app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    a, b = month_add(ops.month, 2), month_add(ops.month, 3)
    late: list[Any] = []
    with ui(browser, app_url, OPS_N, None) as page:
        page.route(report_route(a), lambda r: late.append(r), times=1)
        page.goto(app_url + f"/reports?month={a}")
        ui_wait(page, lambda: len(late) == 1, "A held")
        reg = page.get_by_role("region", name="Utilisation report")
        assert reg.get_attribute("aria-busy") == "true"
        box = page.get_by_role("textbox", name="Month")
        fill(box, b)
        box.press("Enter")
        ui_wait(page, lambda: f"Utilisation for {month_name(b)}" in reg.inner_text(), "B drawn")
        late[0].continue_()
        advance(page, 2000)
        assert f"Utilisation for {month_name(b)}" in reg.inner_text() and month_name(a) not in reg.inner_text()
        assert href(page.get_by_role("link", name="Export usage CSV")).endswith(f"month={b}")
        page.go_back()
        ui_wait(page, lambda: f"Utilisation for {month_name(a)}" in reg.inner_text(), "A after Back")
        page.go_forward()
        ui_wait(page, lambda: f"Utilisation for {month_name(b)}" in reg.inner_text(), "B after Forward")
    assert report(ops, b)["month"] == b


def test_sanitation_log(app_url: str) -> None:
    lead, ops, ada = Api(app_url, LEAD_N), Api(app_url, OPS_N), Api(app_url, ADA)
    task = f"Wipe benches {uuid.uuid4().hex[:5]}"
    r = lead.post("/api/sanitation-entries", {"area": AREA, "task": task, "sanitizerPpm": 200, "initials": INITIALS})
    assert r.status_code == 201
    e = r.json()["entry"]
    assert set(e) == {"id", "area", "task", "sanitizerPpm", "initials", "notes", "loggedAt", "localDate", "localTime",
                      "loggedBy"}
    assert e["loggedBy"] == "Theo Lindqvist" and e["notes"] == "" and (e["localDate"], e["localTime"]) == local_of(e["loggedAt"], TZ_N)
    assert abs((dt.datetime.fromisoformat(e["loggedAt"]) - lead.now()).total_seconds()) < 120
    listed = ops.get("/api/sanitation-entries").json()["entries"]
    assert any(x["id"] == e["id"] for x in listed)
    assert [x["loggedAt"] for x in listed] == sorted([x["loggedAt"] for x in listed], reverse=True)
    for method in ("PUT", "PATCH", "DELETE"):
        err(ops.send(method, f"/api/sanitation-entries/{e['id']}", {} if method != "DELETE" else NOBODY), 404, "not_found")
    assert next(x for x in ops.get("/api/sanitation-entries").json()["entries"] if x["id"] == e["id"]) == e
    err(ada.post("/api/sanitation-entries", {"area": AREA, "task": task, "initials": INITIALS}), 403, "forbidden")
    for body, key, msg in [({"area": BAD_AREA, "task": task, "initials": INITIALS}, "area", FIELD["area"]),
                           ({"area": AREA, "task": task, "initials": BAD_INITIALS}, "initials", FIELD["initials"]),
                           ({"area": AREA, "task": task, "initials": INITIALS, "sanitizerPpm": PPM_TOO_HIGH},
                            "sanitizerPpm", FIELD["ppm"])]:
        assert err(lead.post("/api/sanitation-entries", body), 422, "validation_failed")["errors"][key] == msg


def test_sanitation_pdf(app_url: str) -> None:
    ops, lead = Api(app_url, OPS_N), Api(app_url, LEAD_N)
    m = ops.month
    r = ops.post("/api/sanitation-reports", {"month": m})
    assert r.status_code == 201 and r.json()["report"]["status"] == "stored" and r.json()["report"]["storedAt"]
    key = f"kitchens/{KITCHEN_ID_N}/sanitation/{m}.pdf"
    first = S3().get(key)
    assert first.startswith(b"%PDF-")
    lead.post("/api/sanitation-entries", {"area": AREA, "task": f"Mop {uuid.uuid4().hex}", "initials": "TL"})
    assert ops.post("/api/sanitation-reports", {"month": m}).status_code == 201
    second = S3().get(key)
    assert second.startswith(b"%PDF-") and second != first
    f = ops.get(f"/api/sanitation-reports/{m}/file")
    assert f.status_code == 200 and f.headers["content-type"].startswith("application/pdf") and f.content == second
    assert f.headers["content-disposition"].startswith("attachment")
    assert any(x["month"] == m and x["status"] == "stored" for x in lead.get("/api/sanitation-reports").json()["reports"])
    err(lead.post("/api/sanitation-reports", {"month": m}), 403, "forbidden")
    down = Api(s3down_url(), OPS_N)
    qm = f"20{10 + uuid.uuid4().int % 10}-{1 + uuid.uuid4().int % 12:02d}"
    q0 = service_status(down)["queued"]["storage"]
    r = down.post("/api/sanitation-reports", {"month": qm})
    assert r.status_code == 202 and r.json()["report"] == {"month": qm, "status": "queued", "storedAt": None}
    assert service_status(down)["queued"]["storage"] == q0 + 1
    assert down.post("/api/sanitation-reports", {"month": qm}).status_code == 202
    assert service_status(down)["queued"]["storage"] == q0 + 1


def test_inspector_links(app_url: str, mail: Mailpit) -> None:
    ops = Api(app_url, OPS_N)
    _, email = unique("inspector")
    before = mail_ids(mail)
    link, tok = make_link(ops, email)
    assert len(tok) >= 32 and link["status"] == "active" and link["views"] == 0
    assert inspect(app_url, f"/api/inspect/{tok}").status_code == 200
    rs = together([lambda: ops.clone().post(f"/api/inspector-links/{link['id']}/regenerate", {}) for _ in range(3)])
    assert all(r.status_code == 200 for r in rs)
    toks = [r.json()["link"]["url"].rsplit("/", 1)[1] for r in rs]
    assert len(set(toks)) == 3 and all(r.json()["link"]["id"] == link["id"] for r in rs)
    live = [x for x in toks if inspect(app_url, f"/api/inspect/{x}").status_code == 200]
    assert len(live) == 1
    for x in [tok] + [y for y in toks if y not in live]:
        err(inspect(app_url, f"/api/inspect/{x}"), 410, "link_revoked", ERR["link_revoked"])
    assert link_of(ops, link["id"])["views"] == 2
    r = ops.delete(f"/api/inspector-links/{link['id']}")
    assert r.status_code == 200 and r.json()["link"]["status"] == "revoked" and r.json()["link"]["views"] == 2
    err(inspect(app_url, f"/api/inspect/{live[0]}"), 410, "link_revoked")
    inv = new_mail(mail, before, lambda m: to(m) == [email.lower()] and subj(m) == f"Read-only kitchen records: {KITCHEN_N}", n=4)
    assert len(inv) == 4 and any(f"/inspect/{live[0]}" in text(m) for m in inv)
    assert err(ops.post("/api/inspector-links", {"email": email, "expiresAt": instant(ops, dt.timedelta(days=LINK_MAX_DAYS + 1))}),
               422, "validation_failed")["errors"]["expiresAt"] == FIELD["link_expiry"]
    err(ops.post("/api/inspector-links", {"email": email, "expiresAt": instant(ops, dt.timedelta(hours=-1))}), 422,
        "validation_failed")
    short, stok = make_link(ops, email, dt.timedelta(seconds=SHORT_TTL))
    assert inspect(app_url, f"/api/inspect/{stok}").status_code == 200
    poll(lambda: inspect(app_url, f"/api/inspect/{stok}").status_code == 410, SHORT_TTL + SLACK, "link expiry")
    err(inspect(app_url, f"/api/inspect/{stok}"), 410, "link_expired", ERR["link_expired"])
    assert link_of(ops, short["id"])["status"] == "expired"


def test_inspector_view(app_url: str) -> None:
    ops, kofi, jonah = Api(app_url, OPS_N), Api(app_url, KOFI), Api(app_url, OPS_H)
    sub = uploaded(kofi, ops, "insurance_certificate", d_add(ops.today, 300))
    _, email = unique("inspector")
    link, tok = make_link(ops, email)
    r = inspect(app_url, f"/api/inspect/{tok}")
    assert r.status_code == 200
    v = r.json()
    assert set(v) == {"kitchen", "expiresAt", "sanitationEntries", "sanitationReports", "certificates"}
    assert v["kitchen"] == {"name": KITCHEN_N, "timeZone": TZ_N}
    cert_ids = {c["documentId"] for c in v["certificates"]}
    current = {d["id"] for d in docs(ops) if d["current"]}
    assert cert_ids == current and sub["id"] not in cert_ids
    assert all(c["status"] in ("approved", "expiring", "expired") for c in v["certificates"])
    cutoff = d_add(ops.today, -90)
    assert all(e["localDate"] >= cutoff for e in v["sanitationEntries"])
    harbor_doc = docs(jonah)[0]["id"]
    resps = [r, inspect(app_url, f"/api/inspect/{tok}/documents/{harbor_doc}/file"),
             inspect(app_url, f"/api/inspect/{tok}/documents/{sub['id']}/file"),
             inspect(app_url, f"/inspect/{tok}")]
    assert resps[1].status_code == 404 and resps[2].status_code == 404
    f = inspect(app_url, f"/api/inspect/{tok}/documents/{next(iter(cert_ids))}/file")
    assert f.status_code == 200 and f.headers["content-disposition"].startswith("attachment")
    resps.append(f)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        x = inspect(app_url, f"/api/inspect/{tok}", method, json={})
        err(x, 405, "read_only", ERR["read_only"])
        resps.append(x)
    for x in resps:
        assert "no-store" in (x.headers.get("cache-control") or "") and x.headers.get("referrer-policy") == "no-referrer"
    err(Api(app_url, cookie=tok).get("/api/session"), 401, "unauthenticated")


def test_inspector_access_records(app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    m = ops.month
    assert ops.post("/api/sanitation-reports", {"month": m}).status_code == 201
    _, email = unique("inspector")
    link, tok = make_link(ops, email)
    rs = together([lambda: inspect(app_url, f"/api/inspect/{tok}") for _ in range(8)])
    assert all(r.status_code == 200 for r in rs)
    cert = rs[0].json()["certificates"][0]["documentId"]
    assert inspect(app_url, f"/api/inspect/{tok}/documents/{cert}/file").status_code == 200
    assert inspect(app_url, f"/api/inspect/{tok}/sanitation-reports/{m}/file").status_code == 200
    assert inspect(app_url, f"/api/inspect/{tok}/sanitation-reports/1999-01/file").status_code == 404
    inspect(app_url, f"/api/inspect/{tok}", "POST", json={})
    x = link_of(ops, link["id"])
    assert (x["views"], x["downloads"]) == (8, 2) and len(x["access"]) == 10
    assert x["lastAccessAt"] == x["access"][0]["at"]
    assert [a["action"] for a in x["access"][:2]] == ["report", "document"]
    assert x["access"][0]["target"] == m and x["access"][1]["target"] == cert
    err(Api(app_url, LEAD_N).get("/api/inspector-links"), 403, "forbidden")
    assert link["id"] not in {y["id"] for y in Api(app_url, OPS_H).get("/api/inspector-links").json()["links"]}
    r = ops.post(f"/api/inspector-links/{link['id']}/regenerate", {})
    assert r.json()["link"]["views"] == 8 and len(r.json()["link"]["access"]) == 10
    ops.delete(f"/api/inspector-links/{link['id']}")
    inspect(app_url, f"/api/inspect/{tok}")
    y = link_of(ops, link["id"])
    assert (y["views"], y["downloads"], y["status"]) == (8, 2, "revoked")


def test_wf_inspector_access_share(browser: Browser, app_url: str, mail: Mailpit) -> None:
    ops = Api(app_url, OPS_N)
    m = ops.month
    _, email = unique("inspector")
    exp_iso = instant(ops, dt.timedelta(days=3))
    ed, et = local_of(exp_iso, TZ_N)
    before = mail_ids(mail)
    with ui(browser, app_url, OPS_N, "/sanitation") as page:
        ui_wait(page, lambda: shown(page.get_by_role("button", name="Log entry")), "form")
        select(page.get_by_role("combobox", name="Area"), AREA)
        fill(page.get_by_role("textbox", name="Task"), "Sanitise prep benches")
        fill(page.get_by_role("spinbutton", name="Sanitizer ppm"), "200")
        fill(page.get_by_role("textbox", name="Initials"), "MV")
        click(page.get_by_role("button", name="Log entry"))
        ui_wait(page, lambda: "Logged." in ann(page), "logged")
        fill(page.get_by_role("textbox", name="Report month"), m)
        click(page.get_by_role("button", name="Generate monthly PDF"))
        ui_wait(page, lambda: f"Sanitation PDF for {month_name(m)} saved." in ann(page), "pdf saved")
        fill(page.get_by_role("textbox", name="Inspector email"), email)
        fill(page.get_by_role("textbox", name="Link expires"), f"{ed} {et}")
        click(page.get_by_role("button", name="Send link"))
        ui_wait(page, lambda: f"Link sent to {email}, active until {ed} {et}." in ann(page), "link sent")
        msg = new_mail(mail, before, lambda x: to(x) == [email.lower()])
        url = INVITE_URL.search(text(msg[0])).group(0)
        tok = url.rsplit("/", 1)[1]
        with ui(browser, app_url, None, f"/inspect/{tok}") as insp:
            certs = insp.get_by_role("table", name="Member certificates")
            ui_wait(insp, lambda: shown(certs), "inspector view")
            links = certs.get_by_role("link", name=starts("Download "))
            with insp.expect_download():
                click(links.first)
            row = page.get_by_role("table", name="Inspector links").get_by_role("row").filter(has_text=email)
            ui_wait(page, lambda: shown(row) and row.first.get_by_role("cell").nth(5).inner_text().strip() == "1",
                    "downloads counted")
            click(page.get_by_role("button", name=f"Revoke link for {email}"))
            ui_wait(page, lambda: "Link revoked." in ann(page) and "Revoked" in row.first.inner_text(), "revoked")
            click(links.nth(min(1, links.count() - 1)))
            ui_wait(insp, lambda: ERR["link_revoked"] in insp.inner_text("body"), "state copy")
            assert insp.get_by_role("table", name="Member certificates").count() == 0
    x = next(y for y in ops.get("/api/inspector-links").json()["links"] if y["email"] == email)
    assert x["status"] == "revoked" and x["views"] >= 1 and x["downloads"] == 1


def test_wf_inspector_access_wrong_clock(browser: Browser, app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    _, email = unique("inspector")
    link, tok = make_link(ops, email, dt.timedelta(days=1))
    ed, et = local_of(link["expiresAt"], TZ_N)
    fast = ops.now() + dt.timedelta(days=2)
    with ui(browser, app_url, None, f"/inspect/{tok}", clock=fast) as insp:
        ui_wait(insp, lambda: f"Read-only records for {KITCHEN_N}, available until {ed} {et}" in insp.inner_text("body"),
                "available-until line")
        assert shown(insp.get_by_role("heading", level=1, name=KITCHEN_N))
        assert shown(insp.get_by_role("table", name="Sanitation log"))
        with ui(browser, app_url, OPS_N, "/sanitation", clock=fast) as page:
            row = page.get_by_role("table", name="Inspector links").get_by_role("row").filter(has_text=email)
            ui_wait(page, lambda: shown(row) and "Active" in row.first.inner_text(), "Active row")
            assert f"{ed} {et}" in row.first.inner_text()
        assert ops.delete(f"/api/inspector-links/{link['id']}").status_code == 200
        url0 = insp.url
        click(insp.get_by_role("table", name="Member certificates").get_by_role("link", name=starts("Download ")).first)
        ui_wait(insp, lambda: ERR["link_revoked"] in insp.inner_text("body"), "revoked copy")
        assert insp.url == url0 and insp.get_by_role("table", name="Sanitation log").count() == 0


def test_wf_inspector_access_live_links(browser: Browser, app_url: str) -> None:
    ops = Api(app_url, OPS_N)
    _, email = unique("inspector")
    link, tok = make_link(ops, email)
    with ui(browser, app_url, OPS_N, "/sanitation") as page:
        table = page.get_by_role("table", name="Inspector links")
        row = table.get_by_role("row").filter(has_text=email)
        ui_wait(page, lambda: shown(row), "row")
        assert [h.inner_text().strip() for h in table.get_by_role("columnheader").all()][:6] == LINK_HEADERS
        box = page.get_by_role("textbox", name="Inspector email")
        box.click()
        page.keyboard.type(TYPED_EMAIL)
        for _ in range(2):
            assert inspect(app_url, f"/api/inspect/{tok}").status_code == 200
        advance(page, LINKS_REFRESH_MS + 500)
        ui_wait(page, lambda: row.first.get_by_role("cell").nth(4).inner_text().strip() == "2", "views redrawn")
        assert row.first.get_by_role("cell").nth(3).inner_text().strip() != "Never"
        assert box.input_value() == TYPED_EMAIL and focused_name(page) == "Inspector email"
        rev = page.get_by_role("button", name=f"Revoke link for {email}")
        with held(page, LINKS_GLOB) as gate:
            click(rev)
            advance(page, LINKS_REFRESH_MS + 500)
            assert rev.get_attribute("aria-busy") == "true" and "Active" in row.first.inner_text()
            gate.release()
        ui_wait(page, lambda: "Revoked" in row.first.inner_text(), "revoked")
        advance(page, LINKS_REFRESH_MS + 500)
        assert "Revoked" in row.first.inner_text() and "Active" not in row.first.get_by_role("cell").nth(2).inner_text()
    assert link_of(ops, link["id"])["status"] == "revoked"


def test_billing_outage(app_url: str, mail: Mailpit) -> None:
    base = kbdown_url()
    ops, lead, ada = Api(base, OPS_N), Api(base, LEAD_N), Api(base, ADA)
    s0 = service_status(ops)
    assert s0["billing"] == "down" and set(s0) == {"billing", "storage", "queued"}
    before = mail_ids(mail)
    with tidy() as t:
        d = find_day(lead, [("stn_prep1", "06:00", "07:00"), ("stn_prep2", "06:00", "07:00")], first=50)
        bid = held_id(ada, hold(ada, "stn_prep1", d, "06:00", "07:00"), t)
        q = service_status(ops)["queued"]["billing"]
        key = idempotency_key()
        c = confirm(ada, bid, key)
        assert c.status_code == 202 and c.json()["bookings"][0]["billingStatus"] == "pending_billing"
        assert service_status(ops)["queued"]["billing"] == q + 1
        assert confirm(ada, bid, key).content == c.content and service_status(ops)["queued"]["billing"] == q + 1
        mv = move(lead, c.json()["bookings"][0], "stn_prep2", d, "06:00", "07:00")
        assert mv.status_code == 200 and service_status(ops)["queued"]["billing"] == q + 3
        assert cancel(ada, bid).status_code == 200 and service_status(ops)["queued"]["billing"] == q + 4
        assert len(new_mail(mail, before, lambda m: subj(m) == f"Booking confirmed: {label('stn_prep1', d, '06:00', '07:00')}")) == 1
        assert all(x["billingStatus"] == "pending_billing" for x in lines_for(invoice(ops, "mem_ada", d[:7]), bid))
        err(ops.post(f"/api/months/{d[:7]}/close", {}), 409, "billing_pending", ERR["billing_pending"])
        err(ops.post(f"/api/months/{month_add(ops.month, -24)}/close", {}), 503, "billing_unavailable",
            ERR["billing_unavailable"])


def test_storage_outage(app_url: str) -> None:
    base = s3down_url()
    ops, kofi, lead = Api(base, OPS_N), Api(base, KOFI), Api(base, LEAD_N)
    assert service_status(ops)["storage"] == "down"
    n = len(docs(kofi))
    err(upload(kofi, "food_handler_card", d_add(kofi.today, 100)), 503, "storage_unavailable", ERR["storage_upload"])
    assert len(docs(kofi)) == n
    seed = docs(kofi)[0]
    err(kofi.get(f"/api/documents/{seed['id']}/file"), 503, "storage_unavailable", ERR["storage_download"])
    assert seed["status"] in ("approved", "expiring")
    _, email = unique("inspector")
    link, tok = make_link(ops, email)
    err(inspect(base, f"/api/inspect/{tok}/documents/{seed['id']}/file"), 503, "storage_unavailable",
        ERR["storage_download"])
    assert link_of(ops, link["id"])["downloads"] == 0
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("09:00", "10:00")], first=51)
        book(kofi, st, d, s, e, t=t)


def test_recovery_without_restart(app_url: str, killbill: KillBill) -> None:
    kb_env = outage_env(KBDOWN_DB, KBDOWN_BUCKET)
    ada_k = Api(kbdown_url(), ADA)
    lead_k = Api(kbdown_url(), LEAD_N)
    with tidy() as t:
        st, d, s, e = find_slot(lead_k, ["stn_oven1"], [("05:00", "06:00")], first=52)
        b = book(ada_k, st, d, s, e, t=t)
        assert b["billingStatus"] == "pending_billing"
        relay = Relay(os.environ["KILLBILL_URL"])
        try:
            with app_copy(KILLBILL_URL=relay.url, **kb_env) as copy:
                assert Api(copy, ADA).get("/api/session").status_code == 200
                relay.start()
                wait_billed(ada_k, b["id"], RECOVERY_S + SLACK)
                poll(lambda: service_status(Api(copy, OPS_N))["billing"] == "up", RECOVERY_S + SLACK, "billing up")
                kb_wait(killbill, "mem_ada", f"Booking {b['id']} {label(st, d, s, e)}")
        finally:
            relay.stop()
    s3_env = outage_env(S3DOWN_DB, S3DOWN)
    ops_s = Api(s3down_url(), OPS_N)
    qm = f"19{70 + uuid.uuid4().int % 29}-{1 + uuid.uuid4().int % 12:02d}"
    assert ops_s.post("/api/sanitation-reports", {"month": qm}).status_code == 202
    relay = Relay(os.environ["S3_ENDPOINT"])
    try:
        with app_copy(S3_ENDPOINT=relay.url, **s3_env) as copy:
            relay.start()
            poll(lambda: any(k.endswith(f"/sanitation/{qm}.pdf") for k in outage_keys(S3(S3DOWN), f"kitchens/{KITCHEN_ID_N}/sanitation/")),
                 RECOVERY_S + SLACK, "queued PDF stored")
            c = Api(copy, OPS_N)
            poll(lambda: service_status(c)["storage"] == "up" and service_status(c)["queued"]["storage"] == 0,
                 RECOVERY_S + SLACK, "storage up")
            seed = next(x for x in docs(c) if x["fileName"].startswith("seed-"))
            poll(lambda: c.get(f"/api/documents/{seed['id']}/file").status_code == 200, RECOVERY_S + SLACK, "seed object")
    finally:
        relay.stop()


def test_wf_service_outages_billing_banner(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = kbdown_url()
    lead, ada = Api(base, LEAD_N), Api(base, ADA)
    before = mail_ids(mail)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("07:00", "08:00")], first=53)
        held_id(ada, hold(ada, st, d, s, e), t)
        lbl = label(st, d, s, e)
        with ui(browser, base, ADA, f"/board?date={d}") as page:
            banner = page.get_by_role("region", name="Service status")
            ui_wait(page, lambda: shown(banner) and BILLING_BANNER in banner.inner_text(), "banner")
            n0 = int(BANNER_COUNTS.search(banner.inner_text()).group(1))
            mark_node(banner)
            with page.expect_response(CONFIRM_RESPONSE):
                click(ticket(page, lbl).get_by_role("button", name="Confirm"))
            t0 = time.monotonic()
            while f"{n0 + 1} billing items waiting" not in banner.inner_text():
                assert time.monotonic() - t0 < BANNER_MS / 1000 + 0.5, banner.inner_text()
                advance(page, 20)
            assert node_marked(banner)
            ui_wait(page, lambda: shown(blk_with(page, lbl, "Pending billing")), "pending block")
            assert "Billing is pending." in ann(page)
        assert len(new_mail(mail, before, lambda m: subj(m) == f"Booking confirmed: {lbl}")) == 1


def test_wf_service_outages_storage_upload(browser: Browser, app_url: str) -> None:
    base = s3down_url()
    rina = Api(base, RINA)
    n = len(docs(rina))
    with ui(browser, base, RINA, "/documents") as page:
        ui_wait(page, lambda: shown(page.get_by_role("region", name="Service status")), "banner")
        assert STORAGE_BANNER in page.get_by_role("region", name="Service status").inner_text()
        select(page.get_by_role("combobox", name="Document type"), "Food-handler card")
        fill(page.get_by_role("textbox", name="Expiry date"), d_add(rina.today, 90))
        page.get_by_label("File", exact=True).set_input_files(files=[{"name": PROBE_FILE, "mimeType": "application/pdf",
                                                                      "buffer": PDF}])
        click(page.get_by_role("button", name="Upload"))
        ui_wait(page, lambda: ERR["storage_upload"] in alerts(page), "storage alert")
    assert len(docs(rina)) == n


def _leaks(r: httpx.Response) -> list[str]:
    texts = [r.text] + [v for k, v in r.headers.items() if k.lower() not in ("set-cookie", "content-disposition")]
    env = []
    for name in LEAK_ENV:
        v = os.environ.get(name) or ""
        vals = [v] + ([urlparse(v).netloc.split("@")[-1]] if "://" in v else [])
        env += [x for x in vals if len(x) >= LEAK_MIN_LEN]
    found = []
    for t in texts:
        found += [x for x in LEAK_LITERALS + env if x in t]
        found += [x for x in LEAK_CI if x in t.lower()]
        if re.search(r"(?m)^    at ", t):
            found.append("stack frame")
    return found


def test_opaque_errors(app_url: str) -> None:
    ada = Api(app_url, ADA)
    k_ops, s_kofi, s_ops = Api(kbdown_url(), OPS_N), Api(s3down_url(), KOFI), Api(s3down_url(), OPS_N)
    seed = docs(s_kofi)[0]
    cases = [
        (ada.post("/api/bookings", raw=BAD_JSON, key=idempotency_key()), "bad_request"),
        (ada.post("/api/bookings", raw=json.dumps({"x": "y" * BODY_LIMIT}), key=idempotency_key()), "payload_too_large"),
        (ada.get(NO_SUCH_PATH), "not_found"),
        (Api(app_url).get("/api/board"), "unauthenticated"),
        (ada.get("/api/reports/utilisation"), "forbidden"),
        (ada.get(f"/api/board?date={BAD_DATE_TEXT}"), "validation_failed"),
        (k_ops.post(f"/api/months/{month_add(k_ops.month, -24)}/close", {}), "billing_unavailable"),
        (upload(s_kofi, "food_handler_card", d_add(s_kofi.today, 50)), "storage_unavailable"),
        (s_kofi.get(f"/api/documents/{seed['id']}/file"), "storage_unavailable"),
    ]
    copy = {"bad_request": ERR["bad_request"], "payload_too_large": ERR["payload_too_large"],
            "not_found": ERR["not_found"], "unauthenticated": ERR["unauthenticated"], "forbidden": ERR["forbidden"],
            "validation_failed": ERR["validation_failed"], "billing_unavailable": ERR["billing_unavailable"]}
    for r, code in cases:
        b = r.json()
        assert b["error"] == code, (code, r.text)
        if code in copy:
            assert b["message"] == copy[code]
        assert not _leaks(r), (code, _leaks(r))
    assert cases[7][0].json()["message"] == ERR["storage_upload"] and cases[8][0].json()["message"] == ERR["storage_download"]
    for api in (k_ops, s_ops):
        st = service_status(api)
        flat = json.dumps(st)
        assert not [x for x in LEAK_LITERALS if x in flat] and not [x for x in LEAK_CI if x in flat.lower()]


def test_run_manifest_and_health(app_url: str) -> None:
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    dead = f"http://127.0.0.1:{free_port()}"
    with app_copy(KILLBILL_URL=dead, S3_ENDPOINT=dead) as copy:
        h = httpx.get(copy + "/api/health", timeout=HTTP_TIMEOUT)
        assert h.status_code == 200 and h.json() == {"status": "ok"}
        assert Api(copy, ADA).get("/api/session").status_code == 200


SECRET_PATHS = ["/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/.env", "/src/server.ts",
                "/server.ts", "/src/index.ts", "/THIRD_PARTY_NOTICES.md", "/node_modules/.package-lock.json"]


def test_server_boundary(app_url: str) -> None:
    nadia = Api(app_url, NADIA)
    name = nadia.name("mem_nadia")
    head = '{"businessName":' + json.dumps(name, ensure_ascii=False)
    pad = BODY_LIMIT - len((head + "}").encode())
    r = nadia.patch("/api/members/me", raw=(head + " " * pad + "}").encode())
    assert r.status_code == 200
    err(nadia.patch("/api/members/me", raw=(head + " " * (pad + 1) + "}").encode()), 413, "payload_too_large")
    for r in [nadia.get("/api/board"), nadia.get(NO_SUCH_PATH), httpx.get(app_url + "/documents", timeout=HTTP_TIMEOUT)]:
        assert "no-store" in (r.headers.get("cache-control") or "")
    for p in SECRET_PATHS:
        assert httpx.get(app_url + p, timeout=HTTP_TIMEOUT).status_code == 404, p


def test_wf_cross_cutting_rail_drop(browser: Browser, app_url: str) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep1"], [("06:00", "08:00")], first=54, plain=True)
        held_id(ada, hold(ada, st, d, s, e), t)
        lbl = label(st, d, s, e)
        bal = bank(ada, "mem_ada", d[:7])["balanceHours"]
        with ui(browser, app_url, ADA, f"/board?date={d}") as page:
            tk = ticket(page, lbl)
            ui_wait(page, lambda: shown(tk), "ticket")
            with held(page, CONFIRM_GLOB) as gate:
                click(tk.get_by_role("button", name="Confirm"))
                path = drop_path(page, tk, DROP_MS)
                assert path and path[-1]["y"] > path[0]["y"], path
                ui_wait(page, lambda: f"{hrs(bal - 2)} h left" in hour_bank_text(page), "figures roll before the answer")
                gate.release()
            ui_wait(page, lambda: shown(blk_with(page, lbl, "Confirmed")), "landed")
            b = blk(page, lbl).first
            b.scroll_into_view_if_needed()
            bb = b.bounding_box()
            assert abs(bb["x"] - ruler_x(page, s)) <= 1 and abs(bb["x"] + bb["width"] - ruler_x(page, e)) <= 1
        assert bank(ada, "mem_ada", d[:7])["balanceHours"] == bal - 2


def test_wf_cross_cutting_reduced_motion(browser: Browser, app_url: str) -> None:
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep2"], [("06:00", "07:00")], first=55, weekdays=(0, 1, 2, 3, 4))
        held_id(ada, hold(ada, st, d, s, e), t)
        lbl = label(st, d, s, e)
        with ui(browser, app_url, ADA, f"/board?date={d}", reduced=True) as page:
            ui_wait(page, lambda: shown(ticket(page, lbl)), "ticket")
            click(ticket(page, lbl).get_by_role("button", name="Confirm"))
            ui_wait(page, lambda: shown(blk(page, lbl)) and not shown(ticket(page, lbl)), "instant drop")
            assert not real_anims(page.get_by_role("main"))
            bal = bank(ada, "mem_ada", d[:7])["balanceHours"]
            assert f"{N_NAMES['stn_prep2']}, {s} to {e} booked, {hrs(bal)} hours left" in ann(page)


@pytest.mark.parametrize("vp", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layouts(browser: Browser, app_url: str, vp: str) -> None:
    size = VIEWPORTS[vp]
    lead, ada = Api(app_url, LEAD_N), Api(app_url, ADA)
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_oven2"], [("10:00", "12:00")], first=56)
        book(ada, st, d, s, e, t=t)
        lbl = label(st, d, s, e)
        with ui(browser, app_url, ADA, f"/board?date={d}", size=size) as page:
            ui_wait(page, lambda: shown(blk(page, lbl)), "block")
            layout(page)
            b = blk(page, lbl).first
            assert font_px(b) >= MIN_FONT
            assert b.bounding_box()["height"] >= MIN_TARGET - 0.5
            assert shown(page.get_by_role("group", name="Hour bank"))
            if size == DESKTOP:
                assert board_region(page).get_by_role("group", name="Oven 2", exact=True).bounding_box()["height"] >= MIN_LANE - 0.5
            for path in ("/bookings", "/documents", "/invoices"):
                page.goto(app_url + path)
                ui_wait(page, lambda: shown(page.get_by_role("main")), path)
                layout(page)
        with ui(browser, app_url, OPS_N, "/reports", size=size) as page:
            for path in ("/reports", "/sanitation", "/settings", f"/invoices?month={lead.month}&member={ADA_MID}"):
                page.goto(app_url + path)
                ui_wait(page, lambda: shown(page.get_by_role("main")), path)
                layout(page)


def _shipped() -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    if shutil.which("npm"):
        with suppress(Exception):
            p = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json"], cwd=APP_DIR, capture_output=True,
                               text=True, timeout=HTTP_TIMEOUT * 2)

            def walk(deps: dict) -> None:
                for name, info in (deps or {}).items():
                    if info.get("version"):
                        out.append((name, info["version"], "node_modules/" + name))
                    walk(info.get("dependencies") or {})
            walk(json.loads(p.stdout or "{}").get("dependencies") or {})
    if out:
        return out
    lock = json.loads(Path(APP_DIR, "package-lock.json").read_text())
    for path, info in (lock.get("packages") or {}).items():
        if path and not info.get("dev") and not info.get("optional") and info.get("version"):
            out.append((info.get("name") or path.rsplit("node_modules/", 1)[-1], info["version"], path))
    return out


def _licence(path: str) -> str:
    lock = json.loads(Path(APP_DIR, "package-lock.json").read_text())
    lic = (lock.get("packages") or {}).get(path, {}).get("license")
    if not lic:
        pj = Path(APP_DIR, path, "package.json")
        if pj.exists():
            lic = json.loads(pj.read_text()).get("license")
    return lic if isinstance(lic, str) else (lic or {}).get("type", "") if isinstance(lic, dict) else ""


def test_if_run_manifest() -> None:
    m = json.loads(Path(APP_DIR, "run.json").read_text())
    assert set(m) == {"_schema", "install", "build", "serve"} and m["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) and v for v in m.values())


def test_if_notices() -> None:
    notes = Path(APP_DIR, "THIRD_PARTY_NOTICES.md").read_text()
    missing = [n for n, _, _ in _shipped() if n not in notes]
    assert not missing, missing
    assert all(f in notes for f in FONTS)


def test_if_licences() -> None:
    bad = []
    for name, _, path in _shipped():
        lic = _licence(path)
        alts = [x.strip("() ") for x in re.split(r"\s+(?:OR|AND)\s+", lic or "")]
        if not any(a in LICENCES for a in alts):
            bad.append((name, lic))
    assert not bad, bad
    notes = Path(APP_DIR, "THIRD_PARTY_NOTICES.md").read_text()
    for f in FONTS:
        near = notes[notes.find(f): notes.find(f) + 400]
        assert any(l in near for l in LICENCES), f


def test_if_state_in_services(app_url: str) -> None:
    ada = Api(app_url, ADA)
    lead = Api(app_url, LEAD_N)
    _, email = unique("ifstate")
    for _ in range(3):
        Api(app_url).signin(email, "nope")
    with tidy() as t:
        st, d, s, e = find_slot(lead, ["stn_prep1"], [("21:00", "22:00")], first=57)
        key = idempotency_key()
        r = hold(ada, st, d, s, e, key=key)
        held_id(ada, r, t)
        with app_copy() as copy:
            c = Api(copy, cookie=ada.cookie)
            assert c.get("/api/session").json()["user"]["email"] == ADA
            assert hold(c, st, d, s, e, key=key).content == r.content
            for _ in range(2):
                Api(copy).signin(email, "nope")
        err(Api(app_url).signin(email, "nope"), 429, "rate_limited")
    found = [p for p in Path(APP_DIR).rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db")
             and "node_modules" not in p.parts]
    assert not found, found


def test_if_services_untouched(killbill: KillBill, mail: Mailpit) -> None:
    acc = killbill.account_by_key("mem_ada")
    assert acc and acc.get("currency") == "USD"
    assert mail_from_address() == "no-reply@lineboard.example"
    mail.messages(0, settle=0)
    assert any(k.startswith(prefix("kit_northside", "mem_ada")) for k in S3().keys("kitchens/kit_northside/"))
    assert Postgres().tables()


def test_if_typescript() -> None:
    skip = {"node_modules", "dist", "build", "out", ".next", "coverage", "public", ".git"}
    files = [p for p in Path(APP_DIR).rglob("*") if p.is_file() and not skip & set(p.relative_to(APP_DIR).parts)]
    assert any(p.suffix in (".ts", ".tsx") for p in files)
    js = [p for p in files if p.suffix in (".js", ".jsx") and not re.search(r"\.config\.|^\.", p.name)]
    assert not js, js


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    urls: list[str] = []
    with ui(browser, app_url, None, None) as page:
        page.on("request", lambda r: urls.append(r.url))
        ui_signin(page, app_url, ADA)
        page.goto(app_url + "/invoices")
        ui_wait(page, lambda: shown(page.get_by_role("main")), "invoices")
    bad = [u for u in urls if not (u.startswith("data:") or u.startswith("blob:") or same_origin(u, app_url))]
    assert not bad, bad
