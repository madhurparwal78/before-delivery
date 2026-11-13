from __future__ import annotations

import base64
import hashlib
import http.client
import json
import math
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, Route, TimeoutError as PlaywrightTimeout, expect

from conftest import (
    DEPLOYED_APP,
    Postgres,
    S3,
    addresses,
    capture,
    changed,
    decode,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    pdf_pages,
    pdf_text,
    same_origin,
    select,
    shipped_packages,
    tab_order,
    tap,
    text,
    unique,
)


HTTP_TIMEOUT = 30.0
UI_MS = 15000
UI_SLACK_MS = 1000
TIMER_SLACK_MS = 250
UPLOAD_MS = 30000
CANCEL_MS = 2000
POLL_S = 0.2
MAIL_S = 40
RECORD_S = 90
BOOT_S = 90
PAST_WINDOW_S = 45
LEAD_DAYS = 10
PASSWORD = "Hollow-Verifier-2026"
JUNK = "not-a-real-token"
WRONG_CLOCK_FUTURE = "2031-03-03T03:03:00Z"
WRONG_CLOCK_PAST = "2019-02-02T02:02:00Z"
FAR_TZ = "Asia/Tokyo"
NODE_MODULES = "node_modules"
HOSTILE_NEXT = "/" * 2 + "evil.example/requests"
FOREIGN_ORIGIN = "https://evil.example"
HUGE_ID = "99999999999999999999999999"
UNKNOWN_ID = "9223372036854775807"
STALE_TAG = '"stale"'
NOPE_FIELD = "nope"
UNKNOWN_ROUTE = "/api/nowhere"
UNKNOWN_PAGE = "/nowhere"
YEAR_TOO_EARLY = 1999
YEAR_TOO_LATE = 2101
SCROLL_LOW = 300
SCROLL_MID = 600
SCROLL_HIGH = 900
S_KEY = "s"

KEPT_AMOUNT = "12,34"
LOGGED_MINOR = 777
LOGGED_NOTE = "Noted"
REPLAY_DESC = "Replay me"
FLIGHT_DESC = "In flight"
REPLAY_MINOR = 321
REUSED_MINOR = 322
FLIGHT_MINOR = 11
DECLINE_REASON = "Not that week"
PARTIAL_DESC = "Partial"
PARTIAL_NOTE = "Keep"
ODD_MINOR = 1001
EDITED_MINOR = 1003
AGREED_QUARTER = {"planning": 2500, "other": 7500}
AGREED_UNEVEN = {"planning": 1234, "other": 8766}
TIE_MINOR = 8001
TYPED_EXPIRES = "01/01/2030 08:30"
HOL_ONE, HOL_TWO, BRK_ONE = "Hol One", "Hol Two", "Brk One"
HOL_ALPHA, HOL_BETA, HOL_GAMMA, JUNE_BREAK = "Hol Alpha", "Hol Beta", "Hol Gamma", "June break"
HOL_A, HOL_B, BRK, VAC = "Hol A", "Hol B", "Brk", "Vac"
RULE_NAMES = ("Rule 0", "Rule 1", "Rule 2")
HIDDEN_RULE = "Hidden check"
EARLY_TYPED, EARLY_MINOR = "10,00", 1000
LATEST_TYPED, LATEST_MINOR = "25,01", 2501
AGREED_LOW, AGREED_HIGH, AGREED_HIGH_BP = "50", "70", 7000
PRESS_TYPED, PRESS_MINOR = "1 234", 1234
RECOVERY_TIME = "18:30"
RECOVERY_SHARE = "55,5"
RECOVERY_SPLIT = {"planning": 5550, "other": 4450}
EXPIRY_TIME = "08:15"
PDF_MINOR = 12345
NOTICE_MINOR = 98765
MID_RUN_NIGHTS = 12
LONG_PATTERN = "OOOOOOOOOOOOP"

LIVE_MS = 3000
COUNTER_MS = 250
STICKER_MS = 500
QUOTE_MS = 1300
TONIGHT_MS = 60000
SWEEP_PX = 1200
TARGET_PX = 44
LOG_PAGE = 10
JSON_LIMIT = 65536
RECEIPT_LIMIT = 5242880
ANSWER_DEFAULT_S = 172800
ANSWER_SHORT_S = 20
MAX_AMOUNT = 100000000000
BP = 10000
FAILURES = 5
WINDOW_S = 60
STREAM_ABORTS = 200
EXTRA_SESSIONS = 5
OBJECT_SETTLE_S = 5
SWEEP_S = 5
RUN_LIMIT = 9

REPLAYED = "Idempotent-Replayed"
CORS_PREFIX = "access-control-"
SWAP, COST = "swap.", "cost."
SWAP_DRAFTED, SWAP_DELETED, SWAP_SENT = SWAP + "drafted", SWAP + "deleted", SWAP + "sent"
SWAP_ACCEPTED, SWAP_DECLINED, SWAP_WITHDRAWN = SWAP + "accepted", SWAP + "declined", SWAP + "withdrawn"
SWAP_REMINDED, SWAP_LAPSED = SWAP + "reminded", SWAP + "lapsed"
COST_DRAFTED, COST_DELETED, COST_ACCEPTED = COST + "drafted", COST + "deleted", COST + "accepted"
COST_REMINDED, COST_LAPSED, COST_SETTLED = COST + "reminded", COST + "lapsed", COST + "settled"

ST_JOHNS = "America/St_Johns"
LORD_HOWE = "Australia/Lord_Howe"
PAGO_PAGO = "Pacific/Pago_Pago"
NEW_YORK = "America/New_York"
FAR_EAST = "Pacific/Kiritimati"

MOBILE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
VIEWPORTS = (MOBILE, TABLET, DESKTOP)
ROTATION = "PPPPPPPOOOOOOO"
PLAN_SPLIT = {"planning": 6000, "other": 4000}
HALF_SPLIT = {"planning": 5000, "other": 5000}
CEDAR_SPLIT = {"planning": 3333, "other": 6667}
AMENDED_SPLIT = {"planning": 5500, "other": 4500}
TIE_SPLIT_BP = {"planning": 5050, "other": 4950}
CELL_CEDAR = "33/67"
CELL_HALF = "50/50"
CELL_TIE = "51/49"
CELL_PLAN = "60/40"

STALE = "This changed while you were looking. It now shows the latest version."
DEAD_HEADING = "This link no longer works."
SENT_COPY = "Request sent. An email notice is on its way."
OVERLAP_COPY = "Those nights are already in another request."
MOVED_COPY = "Those nights changed when the plan was amended. This request can't be accepted."
GIVER_COPY = "Every night in a swap must be with the parent giving it."
PASSED_COPY = "The first night's handover has already passed."
SPLIT_COPY = "The two shares must add up to 100%."
REAL_DATE = "Enter a real date as DD/MM/YYYY."
MAIL_DOWN = "Email is down. Notices are queued and go out when it is back."
STORAGE_SAVE = "Couldn't reach storage – nothing was saved. Try again."
RUN_COPY = f"That swap would keep the child with one parent for more than {RUN_LIMIT} nights in a row."
STATUS_REQUESTED = "Year record requested."
STATUS_RENDERING = "Rendering the year record..."
STATUS_STORED = "Year record stored. Download is ready."
STATUS_FAILED = "The year record couldn't be made. Try again."
PDF_DOWN = "The PDF service is down. Your record is waiting and will retry."
KIND_WORDS = {"swap": "Swap", "holiday": "Holiday", "school_break": "School break", "vacation": "Vacation", "base": "Base rotation"}
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

PNG = bytes.fromhex("89504e470d0a1a0a") + b"verifier receipt \x00\xff bytes"
JPEG = bytes.fromhex("ffd8ff") + b"verifier jpeg bytes"
PDF = b"%PDF-" + b"verifier pdf bytes"

SEEDS = {
    "maple": {"hid": "9007199254740993", "name": "Maple & Fern", "zone": ST_JOHNS, "currency": "CAD",
              "planning": ("Robin Okafor", "robin@maple-fern.test", "Hollow-Robin-2026"),
              "other": ("Sam Lindqvist", "sam@maple-fern.test", "Hollow-Sam-2026")},
    "birch": {"hid": "9007199254740995", "name": "Birch Lane", "zone": LORD_HOWE, "currency": "KWD",
              "planning": ("Kai Moreno", "kai@birch-lane.test", "Hollow-Kai-2026"),
              "other": ("Ari Moreno", "ari@birch-lane.test", "Hollow-Ari-2026")},
    "cedar": {"hid": "9007199254740997", "name": "Cedar Court", "zone": PAGO_PAGO, "currency": "JPY",
              "planning": ("Noor Haddad", "noor@cedar-court.test", "Hollow-Noor-2026"),
              "other": ("Tove Aalto", "tove@cedar-court.test", "Hollow-Tove-2026")},
}

expect.set_options(timeout=UI_MS)


def outage(name: str) -> str:
    return os.environ[name].rstrip("/")


def eventually(check: Callable[[], Any], seconds: float, contract: str) -> Any:
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        pause.wait(POLL_S)
    pytest.fail(f"Expected within {seconds}s: {contract}")


def race(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], Any]) -> Any:
        barrier.wait(HTTP_TIMEOUT)
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return [f.result() for f in [pool.submit(run, c) for c in calls]]


def person(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    return (b, a) if "@" in a else (a, b)


def origin_of(base: str) -> str:
    parts = urlsplit(base)
    return f"{parts.scheme}://{parts.netloc}"


def d(value: str) -> date:
    return date.fromisoformat(value)


def iv(first: date, nights: int) -> str:
    return f"{first}/{first + timedelta(days=nights)}"


def fmt_day(day: date) -> str:
    return f"{WEEKDAYS[day.weekday()]} {day.day} {MONTHS[day.month - 1]} {day.year}"


def ui_date(day: date) -> str:
    return f"{day.day:02d}/{day.month:02d}/{day.year}"


def parse_day(words: str) -> date:
    _, dd, mon, yyyy = words.split(" ")
    return date(int(yyyy), MONTHS.index(mon) + 1, int(dd))


def local(day: date | str, hhmm: str, zone: str) -> datetime:
    day = d(day) if isinstance(day, str) else day
    hh, mm = hhmm.split(":")
    zoned = datetime(day.year, day.month, day.day, int(hh), int(mm), tzinfo=ZoneInfo(zone), fold=0)
    return zoned.astimezone(timezone.utc).astimezone(ZoneInfo(zone))


def rfc(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds")


def when(instant: str, zone: str) -> str:
    moment = datetime.fromisoformat(instant)
    return f"{moment:%H:%M} on {fmt_day(moment.date())} ({zone})"


def money(minor: int, exponent: int, code: str) -> str:
    sign = "\u2212" if minor < 0 else ""
    whole, fraction = divmod(abs(minor), 10 ** exponent)
    digits = f"{whole:,}".replace(",", "\u202f")
    decimals = "," + str(fraction).zfill(exponent) if exponent else ""
    return f"{sign}{digits}{decimals} {code}"


def hamilton(amount: int, split: dict[str, int], payer: str) -> dict[str, int]:
    other = "other" if payer == "planning" else "planning"
    shares = {role_: amount * split[role_] // BP for role_ in split}
    left = amount - sum(shares.values())
    fractions = {role_: amount * split[role_] % BP for role_ in split}
    order = [payer, other] if fractions[payer] >= fractions[other] else [other, payer]
    for role_ in order[:left]:
        shares[role_] += 1
    return shares


def easter(year: int) -> date:
    a, b, c = year % 19, year // 100, year % 100
    e, g = b // 4, b % 4
    f = (b + 8) // 25
    h = (19 * a + b - e - (b - f + 1) // 3 + 15) % 30
    i, k = c // 4, c % 4
    m = (32 + 2 * g + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month, day = divmod(h + m - 7 * n + 114, 31)
    return date(year, month, day + 1)


def transitions(zone: str, year: int) -> tuple[date, date]:
    tz = ZoneInfo(zone)
    gap = fold = None
    day = date(year, 1, 1)
    while day.year == year:
        before = datetime(day.year, day.month, day.day, tzinfo=tz).utcoffset()
        after = (datetime(day.year, day.month, day.day, tzinfo=tz) + timedelta(days=1)).utcoffset()
        if after > before:
            gap = day
        if after < before:
            fold = day
        day += timedelta(days=1)
    assert gap and fold, f"{zone} has clock changes in {year}"
    return gap, fold


UNSET: Any = object()


class Api:
    def __init__(self, base: str, token: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.token = token

    def at(self, base: str) -> "Api":
        return Api(base, self.token)

    def call(self, method: str, path: str, body: Any = UNSET, *, raw: bytes | None = None, key: Any = UNSET,
             etag: str | None = None, none_match: str | None = None, headers: dict[str, str] | None = None,
             params: dict[str, Any] | None = None, origin: Any = UNSET, bearer: bool = True) -> httpx.Response:
        head: dict[str, str] = {}
        if method not in ("GET", "HEAD") and origin is UNSET:
            head["Origin"] = origin_of(self.base)
        elif isinstance(origin, str):
            head["Origin"] = origin
        if bearer and self.token:
            head["Authorization"] = f"Bearer {self.token}"
        if etag:
            head["If-Match"] = etag
        if none_match:
            head["If-None-Match"] = none_match
        content = raw
        if raw is None and body is not UNSET:
            content = json.dumps(body, ensure_ascii=False).encode()
            head["Content-Type"] = "application/json"
        elif raw is None and method == "POST":
            content = b"{}"
            head["Content-Type"] = "application/json"
        if method == "POST" and key is UNSET:
            key = idempotency_key()
        if key is not UNSET and key is not None:
            head["Idempotency-Key"] = key
        head.update(headers or {})
        return httpx.request(method, self.base + path, content=content, headers=head, params=params,
                             timeout=HTTP_TIMEOUT, follow_redirects=False)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, body: Any = UNSET, **kw: Any) -> httpx.Response:
        return self.call("POST", path, body, **kw)

    def put(self, path: str, body: Any = UNSET, **kw: Any) -> httpx.Response:
        return self.call("PUT", path, body, **kw)

    def patch(self, path: str, body: Any = UNSET, **kw: Any) -> httpx.Response:
        return self.call("PATCH", path, body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("DELETE", path, **kw)


def want(r: httpx.Response, *status: int) -> httpx.Response:
    assert r.status_code in status, f"{r.request.method} {r.request.url}: expected {status}, got {r.status_code} {r.text[:400]}"
    return r


def problem(r: httpx.Response, status: int, code: str, field: str | None = None, message: str | None = None) -> dict:
    want(r, status)
    assert r.headers.get("content-type", "").startswith("application/problem+json"), r.headers.get("content-type")
    body = r.json()
    assert body["code"] == code, body
    assert body["status"] == status and body["type"] == f"urn:twohouse:problem:{code}", body
    assert isinstance(body["title"], str)
    if message is not None:
        errors = body.get("errors", {})
        if field is not None:
            assert errors.get(field) == message, body
        else:
            assert message in errors.values(), body
    return body


def strong(r: httpx.Response) -> str:
    tag = r.headers.get("etag", "")
    assert re.fullmatch(r'"[^"]+"', tag), f"expected a strong quoted ETag, got {tag!r}"
    return tag


def list_all(api: Api, path: str, **params: Any) -> list[dict]:
    items: list[dict] = []
    query = {"limit": 100, **params}
    for _ in range(200):
        page_ = want(api.get(path, params=query), 200).json()
        items += page_["items"]
        if page_["next"] is None:
            return items
        query["after"] = page_["next"]
    pytest.fail(f"GET {path} kept returning next; expected null at the end of the list")


@dataclass
class Home:
    base: str
    hid: str
    name: str
    planning: Api
    other: Api
    planning_name: str
    other_name: str
    planning_email: str
    other_email: str
    planning_password: str
    other_password: str
    zone: str
    currency: str

    def at(self, suffix: str = "") -> str:
        return f"/api/households/{self.hid}{suffix}"

    @property
    def names(self) -> dict[str, str]:
        return {"planning": self.planning_name, "other": self.other_name}

    def me(self) -> dict:
        return want(self.planning.get("/api/me"), 200).json()

    def today(self) -> date:
        return d(self.me()["household"]["today"])

    def doc(self, year: int) -> dict:
        return want(self.planning.get(self.at(f"/years/{year}")), 200).json()

    def night(self, day: date) -> dict:
        return next(x for x in self.doc(day.year)["days"] if x["date"] == str(day))

    def log(self) -> list[dict]:
        return list_all(self.planning, self.at("/log"))

    def log_count(self, kind: str) -> int:
        return sum(1 for e in self.log() if e["type"] == kind)


def token_of(base: str, email: str, password: str) -> str:
    return want(Api(base).post("/api/session", {"email": email, "password": password}), 200, 201).json()["token"]


def seed_home(base: str, key: str) -> Home:
    seed = SEEDS[key]
    pn, pe, pp = seed["planning"]
    on, oe, op = seed["other"]
    return Home(base.rstrip("/"), seed["hid"], seed["name"], Api(base, token_of(base, pe, pp)), Api(base, token_of(base, oe, op)),
                pn, on, pe, oe, pp, op, seed["zone"], seed["currency"])


def start_body(name: str, currency: str, pn: str, pe: str, on: str, oe: str, password: str = PASSWORD) -> dict:
    return {"householdName": name, "currency": currency, "yourName": pn, "email": pe, "password": password,
            "otherParentName": on, "otherParentEmail": oe}


def version(start: str, zone: str = ST_JOHNS, time_: str = "17:00", pattern: str = ROTATION, anchor: str | None = None,
            split: dict[str, int] | None = None, max_run: int | None = None, rules: list[dict] | None = None) -> dict:
    return {"effectiveFrom": start, "exchangeZone": zone, "firstExchangeAt": rfc(local(start, time_, zone)),
            "base": {"pattern": pattern, "anchor": anchor or start},
            "splitBp": split or PLAN_SPLIT, "maxConsecutiveNights": max_run, "rules": rules or []}


def holiday(rule_id: str, name: str, date_: dict, odd: str, even: str, offset: int = 0, nights: int = 1) -> dict:
    return {"id": rule_id, "kind": "holiday", "name": name, "date": date_, "startOffset": offset, "nights": nights,
            "oddYears": odd, "evenYears": even}


def school_break(rule_id: str, name: str, nights: str, split: str = "halves", first: str = "planning") -> dict:
    return {"id": rule_id, "kind": "school_break", "name": name, "nights": nights, "split": split, "firstHalfOddYears": first}


def vacation(rule_id: str, name: str, parent: str, nights: str, zone: str | None = None, time_: str = "10:00") -> dict:
    rule = {"id": rule_id, "kind": "vacation", "name": name, "parent": parent, "nights": nights}
    if zone:
        rule |= {"exchangeZone": zone, "firstExchangeAt": rfc(local(nights.split("/")[0], time_, zone))}
    return rule


def save_draft(home: Home, body: dict) -> httpx.Response:
    return want(home.planning.put(home.at("/plan/draft"), body, none_match="*"), 200, 201)


def adopt(home: Home, body: dict) -> dict:
    draft = save_draft(home, body)
    return want(home.planning.post(home.at("/plan/draft/adopt"), etag=strong(draft)), 200).json()


def bare_version(stored: dict) -> dict:
    return {k: v for k, v in stored.items() if k not in ("id", "number", "status")}


def adopted_body(home: Home) -> dict:
    versions = want(home.planning.get(home.at("/plan")), 200).json()["versions"]
    return bare_version(next(v for v in versions if v["status"] == "adopted"))


def amendment(home: Home, effective: date, **changes: Any) -> dict:
    body = adopted_body(home)
    body["effectiveFrom"] = str(effective)
    hhmm = datetime.fromisoformat(body["firstExchangeAt"]).strftime("%H:%M")
    body["firstExchangeAt"] = rfc(local(effective, hhmm, body["exchangeZone"]))
    body.update(changes)
    return body


def inbox(mail: Any, email: str, subject: str | None = None) -> list[dict]:
    return [m for m in mail.messages(settle=0)
            if email.lower() in [a.lower() for a in addresses(m["To"])] and (subject is None or m["Subject"] == subject)]


def token_mails(mail: Any, email: str) -> list[str]:
    found = []
    for message in inbox(mail, email):
        match = re.search(r"/join/([A-Za-z0-9_\-.~%]+)", text(message))
        if match:
            found.append(match.group(1))
    return found


def await_mail(mail: Any, email: str, subject: str, count: int = 1, seconds: float = MAIL_S) -> list[dict]:
    def found() -> list[dict] | None:
        messages = inbox(mail, email, subject)
        return messages if len(messages) >= count else None

    return eventually(found, seconds, f"{count} mail(s) '{subject}' to {email} in Mailpit")


def mail_count(messages: list[dict], email: str, subject: str) -> int:
    return sum(1 for m in messages if m["Subject"] == subject and email.lower() in [a.lower() for a in addresses(m["To"])])


def invite_token(home: Home, mail: Any, seen: set[str]) -> str:
    want(home.planning.post(home.at("/invite")), 202)

    def fresh() -> str | None:
        return next((t for t in token_mails(mail, home.other_email) if t not in seen), None)

    token = eventually(fresh, MAIL_S, f"a new join link mailed to {home.other_email}")
    seen.add(token)
    return token


def join(home: Home, mail: Any) -> None:
    seen: set[str] = set()
    for _ in range(6):
        token = invite_token(home, mail, seen)
        r = Api(home.base).post("/api/join", {"token": token, "password": PASSWORD})
        if r.status_code in (200, 201):
            home.other = Api(home.base, r.json()["token"])
            return
    pytest.fail("POST /api/join kept refusing the newest emailed link")


def make_home(base: str, mail: Any = None, *, currency: str = "CAD", zone: str = ST_JOHNS,
              plan: dict | Callable[[int], dict] | None = None, adopted: bool = True, joined: bool = True) -> Home:
    base = base.rstrip("/")
    tag = person("house")[0]
    pn, pe = person("planning")
    on, oe = person("other")
    name = f"H {tag}"[:80]
    r = want(Api(base).post("/api/households", start_body(name, currency, pn, pe, on, oe)), 201).json()
    home = Home(base, r["householdId"], name, Api(base, r["token"]), Api(base), pn, on, pe, oe, PASSWORD, PASSWORD, zone, currency)
    if adopted:
        year = home.today().year
        body = plan(year) if callable(plan) else plan
        adopt(home, body or version(f"{year - 1}-01-01", zone=zone))
    if joined:
        join(home, mail)
    return home


def claimed_nights(home: Home) -> set[date]:
    taken: set[date] = set()
    for state in ("sent", "accepted"):
        for swap in list_all(home.planning, home.at("/swaps"), state=state):
            for interval in (swap["nights"], swap["makeupNights"]):
                if interval:
                    first, end = map(d, interval.split("/"))
                    while first < end:
                        taken.add(first)
                        first += timedelta(days=1)
    return taken


def free_run(home: Home, owner: str, nights: int, after: date | None = None) -> date:
    today = home.today()
    start = after or today + timedelta(days=LEAD_DAYS)
    taken = claimed_nights(home)
    days = [x for year in (start.year, start.year + 1) for x in home.doc(year)["days"]]
    run: list[date] = []
    for day in days:
        this = d(day["date"])
        if this >= start and day["owner"] == owner and this not in taken and (not run or run[-1] + timedelta(days=1) == this):
            run.append(this)
            if len(run) == nights:
                return run[0]
        else:
            run = []
    pytest.fail(f"no free run of {nights} nights with {owner}; the plan's year documents should hold one")


def make_swap(home: Home, by: Api, first: date, nights: int, to: str = "other", makeup: str | None = None, note: str | None = None) -> httpx.Response:
    return want(by.post(home.at("/swaps"), {"nights": iv(first, nights), "makeupNights": makeup, "toParent": to, "note": note}), 201)


def send_swap(home: Home, by: Api, first: date, nights: int, to: str = "other", makeup: str | None = None) -> tuple[dict, str]:
    made = make_swap(home, by, first, nights, to, makeup)
    sent = want(by.post(home.at(f"/swaps/{made.json()['id']}/send"), etag=strong(made)), 200)
    return sent.json(), strong(sent)


def cost_body(home: Home, description: str, amount: int = 1000, day: date | None = None, hhmm: str = "12:00",
              category: str = "other", note: str | None = None) -> dict:
    return {"description": description, "category": category, "amountMinor": amount,
            "incurredAt": rfc(local(day or home.today(), hhmm, home.zone)), "note": note}


def make_cost(home: Home, by: Api, description: str | None = None, **kw: Any) -> httpx.Response:
    return want(by.post(home.at("/costs"), cost_body(home, description or person("cost")[0], **kw)), 201)


def send_cost(home: Home, by: Api, **kw: Any) -> tuple[dict, str]:
    made = make_cost(home, by, **kw)
    sent = want(by.post(home.at(f"/costs/{made.json()['id']}/send"), etag=strong(made)), 200)
    return sent.json(), strong(sent)


def upload(home: Home, by: Api, cost_id: str, tag: str, data: bytes = PNG, name: str = "receipt.png", **kw: Any) -> httpx.Response:
    return by.post(home.at(f"/costs/{cost_id}/receipts"), raw=data, etag=tag, params={"filename": name}, **kw)


def server_now(home: Home) -> datetime:
    link = want(home.planning.post(home.at("/share-links"), {"label": person("clock")[0], "expiresAt": rfc(local(home.today() + timedelta(days=5), "12:00", home.zone))}), 201).json()
    return datetime.fromisoformat(link["createdAt"])


def active_sessions() -> int:
    return Postgres().rows("SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() "
                           "AND usename <> current_user AND state IN ('active', 'idle in transaction')")[0]["n"]


class Stream:

    def __init__(self, base: str, token: str, hid: str, last: int | None = None) -> None:
        parts = urlsplit(base)
        self.events: list[dict[str, str]] = []
        self.comments = 0
        self.status = 0
        self.content_type = ""
        self.opened = threading.Event()
        self.closed = threading.Event()
        self.conn = http.client.HTTPConnection(parts.hostname, parts.port, timeout=None)
        self.conn.connect()
        self.sock = self.conn.sock
        head = {"Authorization": f"Bearer {token}", "Accept": "text/event-stream"}
        if last is not None:
            head["Last-Event-ID"] = str(last)
        self.path = f"/api/households/{hid}/events"
        self.head = head
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        try:
            self.conn.request("GET", self.path, headers=self.head)
            response = self.conn.getresponse()
            self.status = response.status
            self.content_type = response.getheader("content-type", "")
            self.opened.set()
            current: dict[str, str] = {}
            for line in iter(response.readline, b""):
                line_text = line.decode().rstrip("\r\n")
                if not line_text:
                    if current:
                        self.events.append(current)
                    current = {}
                elif line_text.startswith(":"):
                    self.comments += 1
                else:
                    name, _, value = line_text.partition(":")
                    current[name] = value.removeprefix(" ")
        except (OSError, ValueError, http.client.HTTPException):
            return
        finally:
            self.opened.set()
            self.closed.set()

    def ids(self) -> list[int]:
        return [int(e["id"]) for e in self.events]

    def close(self) -> None:
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


def open_and_abort(base: str, token: str, hid: str) -> None:
    parts = urlsplit(base)
    with socket.create_connection((parts.hostname, parts.port), timeout=HTTP_TIMEOUT) as sock:
        sock.sendall((f"GET /api/households/{hid}/events HTTP/1.1\r\nHost: {parts.netloc}\r\n"
                      f"Authorization: Bearer {token}\r\nAccept: text/event-stream\r\n\r\n").encode())
        sock.recv(1)


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.port = 0
        self.socks: list[socket.socket] = []
        self.listener: socket.socket | None = None

    def start(self) -> None:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", self.port))
        listener.listen(64)
        self.port = listener.getsockname()[1]
        self.listener = listener
        threading.Thread(target=self._accept, args=(listener,), daemon=True).start()

    def _accept(self, listener: socket.socket) -> None:
        try:
            while self.listener is listener:
                near, _ = listener.accept()
                far = socket.create_connection(self.target)
                self.socks += [near, far]
                threading.Thread(target=self._pump, args=(near, far), daemon=True).start()
                threading.Thread(target=self._pump, args=(far, near), daemon=True).start()
        except OSError:
            return

    @staticmethod
    def _pump(source: socket.socket, sink: socket.socket) -> None:
        try:
            while data := source.recv(65536):
                sink.sendall(data)
        except OSError:
            return

    def stop(self) -> None:
        if self.listener:
            listener, self.listener = self.listener, None
            try:
                listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            listener.close()
        for sock in self.socks:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()
        self.socks = []


@contextmanager
def app_copy(**env: str) -> Iterator[Any]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    base = f"http://localhost:{port}"
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                            env={**os.environ, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base, **env})

    def healthy() -> bool:
        assert proc.poll() is None, f"app copy exited: {Path(log.name).read_text()[-2000:]}"
        try:
            return httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT).status_code == 200
        except httpx.HTTPError:
            return False

    eventually(healthy, BOOT_S, "GET /api/health answering 200 on a started copy")
    try:
        yield type("Copy", (), {"base": base, "proc": proc})
    finally:
        try:
            os.killpg(proc.pid, 9)
        except ProcessLookupError:
            pass
        proc.wait(HTTP_TIMEOUT)


@contextmanager
def screen(browser: Browser, base: str, path: str = "/", *, size: tuple[int, int] = DESKTOP, touch: bool = False, reduced: bool = False,
           tz: str | None = None, clock: str | None = None, login: tuple[str, str] | None = None, block_stream: bool = False) -> Iterator[Page]:
    base = base.rstrip("/")
    options: dict[str, Any] = {"viewport": {"width": size[0], "height": size[1]}, "reduced_motion": "reduce" if reduced else "no-preference"}
    if touch:
        options |= {"has_touch": True, "is_mobile": True}
    if tz:
        options["timezone_id"] = tz
    context = browser.new_context(**options)
    page = context.new_page()
    try:
        if clock:
            page.clock.set_fixed_time(clock)
        if block_stream:
            page.route("**/events*", lambda route: route.abort())
        if login:
            sign_in(page, base, login[0], login[1], path)
        else:
            page.goto(base + path)
        yield page
    finally:
        context.close()


def role(page: Any, kind: str, name: str) -> Any:
    return page.get_by_role(kind, name=name, exact=True)


def activity(page: Page) -> Any:
    return role(page, "status", "Activity")


def sign_in(page: Page, base: str, email: str, password: str, path: str | None = None) -> None:
    target = "/" if not path or path == "/" else "/?next=" + quote(path, safe="")
    page.goto(base.rstrip("/") + target)
    fill(role(page, "textbox", "Email"), email)
    fill(page.get_by_label("Password", exact=True), password)
    role(page, "button", "Sign in").click()
    if path and path != "/":
        expect(page).to_have_url(re.compile(re.escape(path) + "$"))
    else:
        expect(page).to_have_url(re.compile(r"/calendar$"))


def press(page: Page, locator: Any, key: str = "Enter") -> None:
    locator.focus()
    page.keyboard.press(key)


def pump(page: Page, ready: Callable[[], Any], contract: str, seconds: float = 15) -> Any:
    def check() -> Any:
        page.evaluate("0")
        return ready()
    return eventually(check, seconds, contract)


def hold(page: Page, glob: str, match: Callable[[Any], bool] = lambda request: True) -> list[Route]:
    held: list[Route] = []

    def handler(route: Route) -> None:
        if match(route.request):
            held.append(route)
        else:
            route.fallback()

    page.route(glob, handler)
    return held


def release_late(page: Page, route: Route) -> None:
    finished: list[Any] = []
    page.on("requestfinished", lambda request: finished.append(request) if request == route.request else None)
    page.on("requestfailed", lambda request: finished.append(request) if request == route.request else None)
    try:
        route.fallback()
    except Exception:
        return
    pump(page, lambda: finished, "the older request finishing", seconds=10)
    page.evaluate("0")


def stage(page: Page, year: int) -> Any:
    return role(page, "region", f"Year {year}")


def jump(page: Page, s: int) -> int:
    return page.evaluate("""s => new Promise(done => {
        scrollTo({top: s, behavior: 'instant'});
        requestAnimationFrame(() => requestAnimationFrame(() => done(Math.round(scrollY))));
    })""", s)


def index_at(s: int, n: int) -> int:
    return min(n - 1, s * n // SWEEP_PX)


def first_scroll(index: int, n: int) -> int:
    return math.ceil(index * SWEEP_PX / n)


def through(days: list[dict], index: int) -> dict[str, int]:
    owners = [x["owner"] for x in days[: index + 1]]
    return {"planning": owners.count("planning"), "other": owners.count("other")}


def override_runs(days: list[dict]) -> list[tuple[int, str]]:
    runs = []
    previous = None
    for i, day in enumerate(days):
        key = (day["ruleId"], day["beats"]) if day["beats"] else None
        if key and key != previous:
            runs.append((i, f"{day['ruleName']} beats {day['beats']}"))
        previous = key
    return runs


def check_stage(page: Page, doc: dict, names: dict[str, str], s: int) -> None:
    days = doc["days"]
    index = index_at(s, len(days))
    day = days[index]
    region = stage(page, doc["year"])
    expect(region).to_have_attribute("data-day", day["date"])
    expected_field = "split" if s == 0 or day["owner"] is None else day["owner"]
    expect(region).to_have_attribute("data-field", expected_field)
    counts = through(days, index)
    for who in ("planning", "other"):
        expect(role(page, "status", f"Nights with {names[who]}")).to_have_text(str(counts[who]))
    for first, label in override_runs(days):
        sticker = page.get_by_role("img", name=label, exact=True)
        expect(sticker).to_have_count(1 if first <= index else 0)


def answer_text(day: dict, names: dict[str, str]) -> str:
    words = fmt_day(d(day["date"]))
    if day["owner"] is None:
        return f"{words}: no plan"
    line = f"{words}: {names[day['owner']]} \u2014 {day['ruleName']} ({KIND_WORDS[day['kind']]})"
    return line + (f", beats {day['beats']}" if day["beats"] else "")


def day_cell(page: Page, day: date) -> Any:
    return role(page, "region", "Calendar").get_by_role("gridcell", name=re.compile("^" + re.escape(fmt_day(day)) + ", "))


def month_grid(page: Page, year: int, month: int) -> Any:
    return role(page, "region", "Calendar").get_by_role("grid", name=re.compile(rf"^{MONTHS[month - 1]}[a-z]* {year}$"))


def focus_day(page: Page, day: date) -> Any:
    calendar = role(page, "region", "Calendar")
    expect(calendar.get_by_role("grid")).to_be_visible()
    shown = next(((y, m) for y in (day.year, day.year - 1, day.year + 1) for m in range(1, 13) if month_grid(page, y, m).count()), None)
    assert shown, "the grid's name reads <Month YYYY> near the day being looked for"
    steps = (day.year - shown[0]) * 12 + day.month - shown[1]
    index = shown[0] * 12 + shown[1] - 1
    for _ in range(abs(steps)):
        role(calendar, "button", "Next month" if steps > 0 else "Previous month").click()
        index += 1 if steps > 0 else -1
        expect(month_grid(page, index // 12, index % 12 + 1)).to_have_count(1)
    cell = day_cell(page, day)
    expect(cell).to_have_count(1)
    cell.focus()
    if not cell.evaluate("e => e.contains(document.activeElement)"):
        cell.click()
    return cell


def active_text(page: Page) -> str:
    return page.evaluate("""() => {
        const a = document.activeElement;
        const id = a && a.getAttribute('aria-activedescendant');
        const n = id ? document.getElementById(id) : a;
        return n ? (n.textContent || '') : '';
    }""")


def tab_into(page: Page, region: Any) -> None:
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    for _ in range(60):
        page.keyboard.press("Tab")
        if region.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"):
            return
    pytest.fail("Tab never reached the Rule order listbox; L208 gives it one Tab stop")


def select_rule(page: Page, listbox: Any, count: int, index: int) -> None:
    tab_into(page, listbox)
    for _ in range(count):
        page.keyboard.press("ArrowUp")
    for _ in range(index):
        page.keyboard.press("ArrowDown")


def draft_of(home: Home) -> dict:
    versions = want(home.planning.get(home.at("/plan")), 200).json()["versions"]
    return next(v for v in versions if v["status"] == "draft")


def holiday_order(home: Home) -> list[str]:
    return [x["name"] for x in draft_of(home)["rules"] if x["kind"] == "holiday"]


def watch_draft_writes(page: Page) -> list[tuple[str | None, str | None]]:
    exchanges: list[tuple[str | None, str | None]] = []

    def watch(response: Any) -> None:
        if response.request.method == "PUT" and response.url.endswith("/plan/draft"):
            exchanges.append((response.request.headers.get("if-match"), response.headers.get("etag")))

    page.on("response", watch)
    return exchanges


def current_draft_tag(exchanges: list[tuple[str | None, str | None]]) -> str:
    sent = {request_tag for request_tag, _ in exchanges}
    return next(tag for _, tag in reversed(exchanges) if tag and tag not in sent)


def rotate_holidays_on_next_write(page: Page, home: Home, tag: str) -> None:
    body = bare_version(draft_of(home))
    places = [i for i, rule in enumerate(body["rules"]) if rule["kind"] == "holiday"]
    moved = [body["rules"][i] for i in places]
    for place, rule in zip(places, moved[1:] + moved[:1]):
        body["rules"][place] = rule
    once = {"done": False}

    def interfere(route: Route) -> None:
        if route.request.method == "PUT" and not once["done"]:
            once["done"] = True
            want(home.planning.put(home.at("/plan/draft"), body, etag=tag), 200)
        route.fallback()

    page.route("**/plan/draft", interfere)


def type_number(page: Page, locator: Any, value: str) -> None:
    locator.focus()
    page.keyboard.press("Control+A")
    page.keyboard.type(value)


def ledger_row(page: Page, description: str) -> Any:
    return role(page, "table", "Cost ledger").get_by_role("row").filter(has_text=description)


def fill_cost(page: Page, description: str, amount: str, day: date) -> Any:
    role(page, "button", "Log a cost").click()
    dialog = role(page, "dialog", "Log a cost")
    fill(role(dialog, "textbox", "Description"), description)
    select(role(dialog, "combobox", "Category"), "Other")
    fill(role(dialog, "textbox", "Amount"), amount)
    fill(role(dialog, "textbox", "Date"), ui_date(day))
    return dialog


def attach(page: Page, row: Any, name: str, data: bytes) -> None:
    with page.expect_file_chooser() as chooser:
        role(row, "button", "Attach receipt").click()
    chooser.value.set_files({"name": name, "mimeType": "application/octet-stream", "buffer": data})


def field_error(scope: Any, copy: str) -> Any:
    return scope.get_by_text(copy, exact=True).first


def record_final(api: Api, home: Home, rid: str, *states: str) -> dict:
    def check() -> dict | None:
        body = want(api.get(home.at(f"/records/{rid}")), 200).json()
        return body if body["state"] in states else None
    return eventually(check, RECORD_S, f"record {rid} reaching {states}")


def pending_status() -> Any:
    return re.compile("^(" + "|".join(re.escape(x) for x in (STATUS_REQUESTED, STATUS_RENDERING, STATUS_STORED, PDF_DOWN, STATUS_FAILED)) + ")$")


def edge_plan(year: int, max_run: int = RUN_LIMIT) -> dict:
    return version(f"{year - 1}-01-01", anchor=f"{year + 1}-01-01", max_run=max_run)


def test_start_household(app_url):
    api = Api(app_url)
    pn, pe = person("start")
    on, oe = person("startother")
    name = person("household")[0]
    problem(api.post("/api/households", start_body(name, "XXQ", pn, pe, on, oe)), 422, "validation_failed", "currency", "Choose an ISO 4217 currency code.")
    problem(api.post("/api/households", start_body(name, "CAD", pn, pe, on, oe, password="short")), 422, "validation_failed", "password", "Use 12 to 128 characters.")
    problem(api.post("/api/households", start_body(name, "CAD", pn, pe, on, pe.upper())), 422, "validation_failed", None, "The other parent needs their own email.")
    problem(api.post("/api/households", start_body("", "CAD", pn, pe, on, oe)), 422, "validation_failed", "householdName", "Use 1 to 80 characters.")
    made = want(api.post("/api/households", start_body(name, "CAD", pn, pe, on, oe)), 201).json()
    assert isinstance(made["householdId"], str) and made["householdId"].isdigit()
    assert isinstance(made["userId"], str) and made["role"] == "planning" and made["token"]
    me = want(Api(app_url, made["token"]).get("/api/me"), 200).json()
    assert me["role"] == "planning" and me["name"] == pn
    assert me["household"]["id"] == made["householdId"] and me["household"]["name"] == name
    assert me["household"]["planningName"] == pn and me["household"]["otherName"] == on
    assert me["household"]["otherJoined"] is False and me["household"]["currency"] == "CAD" and me["household"]["currencyExponent"] == 2
    second = person("taken")
    problem(api.post("/api/households", start_body(name, "CAD", second[0], pe.upper(), on, second[1])), 409, "email_taken")
    log = list_all(Api(app_url, made["token"]), f"/api/households/{made['householdId']}/log")
    assert [e["type"] for e in log] == ["household.created"]


def test_sessions(app_url):
    peer = outage("APP_PEER_URL")
    for seed in SEEDS.values():
        for who in ("planning", "other"):
            name, email, password = seed[who]
            made = want(Api(app_url).post("/api/session", {"email": email.upper(), "password": password}), 200, 201).json()
            assert made["role"] == who and made["token"]
            assert email not in made["token"]
            me = want(Api(app_url, made["token"]).get("/api/me"), 200).json()
            assert me["name"] == name and me["household"]["id"] == seed["hid"]
    _, email, password = SEEDS["maple"]["other"]
    token = token_of(app_url, email, password)
    want(Api(peer, token).get("/api/me"), 200)
    assert want(Api(peer, token).delete("/api/session"), 204).content == b""
    problem(Api(app_url, token).get("/api/me"), 401, "unauthenticated")
    problem(Api(peer, token).get("/api/me"), 401, "unauthenticated")
    problem(Api(app_url).get("/api/me"), 401, "unauthenticated")
    problem(Api(app_url, JUNK).get(f"/api/households/{SEEDS['maple']['hid']}/log"), 401, "unauthenticated")


def test_sign_in_limit(app_url):
    peer = outage("APP_PEER_URL")
    pn, pe = person("locked")
    on, oe = person("lockedother")
    want(Api(app_url).post("/api/households", start_body(person("h")[0], "CAD", pn, pe, on, oe)), 201)
    wrong = {"email": pe, "password": "wrong-password-value"}
    for attempt in range(FAILURES):
        target = app_url if attempt % 2 else peer
        problem(Api(target).post("/api/session", wrong), 401, "invalid_credentials")
    for target in (app_url, peer):
        problem(Api(target).post("/api/session", {"email": pe.upper(), "password": PASSWORD}), 429, "too_many_attempts")
    answer = Api(peer).post("/api/session", {"email": pe, "password": PASSWORD})
    retry = int(answer.headers["retry-after"])
    assert 1 <= retry <= WINDOW_S
    unknown = person("nobody")[1]
    for attempt in range(FAILURES - 1):
        problem(Api(peer if attempt % 2 else app_url).post("/api/session", {"email": unknown, "password": PASSWORD}), 401, "invalid_credentials")
    want(Api(app_url).post("/api/session", {"email": person("free")[1], "password": PASSWORD}), 401)
    eventually(lambda: Api(app_url).post("/api/session", {"email": pe, "password": PASSWORD}).status_code in (200, 201),
               WINDOW_S + retry, "the right password working once the sliding window has passed")


def test_invite_links(app_url, mail):
    home = make_home(app_url, mail, joined=False)
    seen: set[str] = set()
    first = invite_token(home, mail, seen)
    subject = f"You're invited to {home.name} on Twohouse"
    message = await_mail(mail, home.other_email, subject)[0]
    body = text(message)
    assert f"{home.name}: open Twohouse to see the details." in body
    assert home.planning_email not in body and home.planning_name not in body
    info = want(Api(app_url).get(f"/api/join/{first}"), 200).json()
    assert info == {"householdName": home.name, "otherParentName": home.other_name}
    second = invite_token(home, mail, seen)
    problem(Api(app_url).get(f"/api/join/{first}"), 404, "not_found")
    want(Api(app_url).get(f"/api/join/{second}"), 200)
    problem(Api(app_url).post("/api/join", {"token": first, "password": PASSWORD}), 404, "not_found")
    want(Api(app_url).post("/api/join", {"token": second, "password": PASSWORD}), 200, 201)
    problem(home.planning.post(home.at("/invite")), 409, "already_joined")
    other = Api(app_url, token_of(app_url, home.other_email, PASSWORD))
    problem(other.post(home.at("/invite")), 403, "planning_parent_only")
    short = make_home(outage("APP_SHORT_URL"), mail, joined=False)
    expiring = invite_token(short, mail, set())
    eventually(lambda: Api(short.base).get(f"/api/join/{expiring}").status_code == 404, 20,
               "a join link dead after INVITE_TTL_SECONDS on the short-window copy")
    problem(Api(short.base).post("/api/join", {"token": expiring, "password": PASSWORD}), 404, "not_found")


def test_join_by_invite(browser, app_url, mail):
    home = make_home(app_url, mail, joined=False)
    token = invite_token(home, mail, set())
    with screen(browser, app_url, f"/join/{token}") as page:
        expect(role(page, "heading", f"Join {home.name}")).to_be_visible()
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        role(page, "button", "Join household").click()
        expect(page).to_have_url(re.compile(r"/calendar$"))
        page.reload()
        expect(page).to_have_url(re.compile(r"/calendar$"))
        expect(role(page, "navigation", "Household")).to_be_visible()
    with screen(browser, app_url, f"/join/{token}") as page:
        expect(role(page, "heading", DEAD_HEADING)).to_be_visible()
        expect(page.get_by_label("Password", exact=True)).to_have_count(0)
    assert want(home.planning.get("/api/me"), 200).json()["household"]["otherJoined"] is True
    racing = make_home(app_url, mail, joined=False)
    newest = invite_token(racing, mail, set())
    answers = race(lambda: Api(app_url).post("/api/join", {"token": newest, "password": PASSWORD}),
                   lambda: Api(outage("APP_PEER_URL")).post("/api/join", {"token": newest, "password": PASSWORD}))
    assert sorted(a.status_code in (200, 201) for a in answers) == [False, True], [a.text for a in answers]
    assert racing.log_count("household.joined") == 1
    short = make_home(outage("APP_SHORT_URL"), mail, joined=False)
    expiring = invite_token(short, mail, set())
    eventually(lambda: Api(short.base).get(f"/api/join/{expiring}").status_code == 404, 20, "an expired link answering 404")
    with screen(browser, short.base, f"/join/{expiring}") as page:
        expect(role(page, "heading", DEAD_HEADING)).to_be_visible()


def test_wf_onboarding_landing(browser, app_url, mail):
    peer = outage("APP_PEER_URL")
    name = person("onboard")[0]
    pn, pe = person("onplanning")
    on, oe = person("onother")
    locked_email = person("onlocked")[1]
    with screen(browser, app_url, "/start") as page:
        expect(role(page, "heading", "Start a household")).to_be_visible()
        fill(role(page, "textbox", "Household name"), name)
        fill(role(page, "textbox", "Currency"), "CAD")
        fill(role(page, "textbox", "Your name"), pn)
        fill(role(page, "textbox", "Your email"), pe)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        fill(role(page, "textbox", "Other parent's name"), on)
        fill(role(page, "textbox", "Other parent's email"), pe.upper())
        role(page, "button", "Create household").click()
        expect(field_error(page, "The other parent needs their own email.")).to_be_visible()
        expect(page).to_have_url(re.compile(r"/start$"))
        fill(role(page, "textbox", "Other parent's email"), oe)
        role(page, "button", "Create household").click()
        expect(page).to_have_url(re.compile(r"/plan$"))
        expect(role(page, "textbox", "Rule name")).to_be_focused()
        expect(activity(page)).to_have_text("Household created. Enter your plan.")
        page.reload()
        expect(page).to_have_url(re.compile(r"/plan$"))
        expect(role(page, "region", "Rule editor")).to_be_visible()
        role(page, "button", "Save draft").click()
        expect(activity(page)).to_have_text("Draft saved.")
        role(page, "button", "Adopt plan").click()
        expect(activity(page)).to_have_text("Plan adopted. The calendar now uses it.")

        api = Api(app_url, token_of(app_url, pe, PASSWORD))
        me = want(api.get("/api/me"), 200).json()
        home = Home(app_url.rstrip("/"), me["household"]["id"], name, api, Api(app_url), pn, on, pe, oe, PASSWORD, PASSWORD, me["household"]["zone"], "CAD")
        versions = want(api.get(home.at("/plan")), 200).json()["versions"]
        assert [(v["number"], v["status"], v["base"]["pattern"]) for v in versions] == [(1, "adopted", "PO")]

        for attempt in range(FAILURES):
            problem(Api(peer if attempt % 2 else app_url).post("/api/session", {"email": locked_email, "password": PASSWORD}), 401, "invalid_credentials")
        with screen(browser, app_url, "/") as signin:
            expect(role(signin, "heading", "Two houses. One plan.")).to_be_visible()
            fill(role(signin, "textbox", "Email"), locked_email)
            fill(signin.get_by_label("Password", exact=True), PASSWORD)
            role(signin, "button", "Sign in").click()
            expect(signin.get_by_text(re.compile(r"^Too many tries\. Try again in \d+ seconds\.$")).first).to_be_visible()

        seen: set[str] = set()
        replaced = invite_token(home, mail, seen)
        with screen(browser, app_url, f"/join/{replaced}") as held_open:
            expect(role(held_open, "button", "Join household")).to_be_visible()
            newest = invite_token(home, mail, seen)
            fill(held_open.get_by_label("Password", exact=True), PASSWORD)
            role(held_open, "button", "Join household").click()
            expect(role(held_open, "heading", DEAD_HEADING)).to_be_visible()
        with screen(browser, app_url, f"/join/{newest}") as one, screen(browser, peer, f"/join/{newest}") as two:
            fill(one.get_by_label("Password", exact=True), PASSWORD)
            fill(two.get_by_label("Password", exact=True), PASSWORD)
            role(one, "button", "Join household").click()
            role(two, "button", "Join household").click()

            def settled() -> bool:
                return all(p.url.endswith("/calendar") or role(p, "heading", DEAD_HEADING).count() for p in (one, two))

            eventually(settled, 15, "both racing join screens reaching the Calendar or the dead-link page")
            assert sorted(p.url.endswith("/calendar") for p in (one, two)) == [False, True]
        assert home.log_count("household.joined") == 1

        home.other = Api(app_url, token_of(app_url, oe, PASSWORD))
        send_swap(home, home.planning, free_run(home, "planning", 1), 1)
        message = await_mail(mail, oe, f"Swap request in {name}")[0]
        link = re.search(r"https?://\S+", text(message)).group(0)
        assert urlsplit(link).path == "/requests"
        assert f"{name}: open Twohouse to see the details." in text(message)
        with screen(browser, app_url, "/requests") as signed_out:
            expect(signed_out).to_have_url(re.compile(r"/\?next=%2Frequests$"))
            fill(role(signed_out, "textbox", "Email"), oe)
            fill(signed_out.get_by_label("Password", exact=True), PASSWORD)
            role(signed_out, "button", "Sign in").click()
            expect(signed_out).to_have_url(re.compile(r"/requests$"))
            expect(role(signed_out, "list", "Waiting for you").get_by_role("listitem")).to_have_count(1)
        with screen(browser, app_url, "/?next=" + quote(HOSTILE_NEXT, safe="")) as hostile:
            fill(role(hostile, "textbox", "Email"), oe)
            fill(hostile.get_by_label("Password", exact=True), PASSWORD)
            role(hostile, "button", "Sign in").click()
            expect(hostile).to_have_url(re.compile(r"/calendar$"))
            assert same_origin(hostile.url, origin_of(app_url))
            year = home.today().year
            hostile.goto(f"{app_url.rstrip('/')}/calendar?year={year}")
            digest = strong(want(api.get(home.at(f"/years/{year}")), 200)).strip('"')
            expect(role(hostile, "region", "Calendar")).to_contain_text(f"Year digest {digest}")
            page.goto(f"{app_url.rstrip('/')}/calendar?year={year}")
            expect(role(page, "region", "Calendar")).to_contain_text(f"Year digest {digest}")


def test_wf_onboarding_session_routes(browser, app_url):
    home = make_home(app_url, adopted=False, joined=False)
    with screen(browser, app_url, "/calendar") as page:
        expect(page).to_have_url(re.compile(r"/\?next=%2Fcalendar$"))
        fill(role(page, "textbox", "Email"), home.planning_email)
        fill(page.get_by_label("Password", exact=True), "wrong-password-value")
        role(page, "button", "Sign in").click()
        expect(page.get_by_text("That email and password don't match.", exact=True).first).to_be_visible()
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        role(page, "button", "Sign in").click()
        expect(page).to_have_url(re.compile(r"/calendar$"))
        for public in ("/", "/start"):
            page.goto(app_url.rstrip("/") + public)
            expect(page).to_have_url(re.compile(r"/calendar$"))
        role(page, "button", "Sign out").click()
        expect(page).to_have_url(re.compile(r"/$"))
        expect(role(page, "button", "Sign in")).to_be_visible()
        page.goto(app_url.rstrip("/") + "/records?x=1")
        expect(page).to_have_url(re.compile(r"/\?next=%2Frecords%3Fx%3D1$"))


NEXT_IDS = ["requests", "plan_query", "missing", "protocol_relative", "backslash", "absolute", "script", "share", "api", "unknown"]
NEXT_CASES = {
    "requests": ("/requests", "/requests"),
    "plan_query": ("/plan?from=mail", "/plan?from=mail"),
    "missing": (None, "/calendar"),
    "protocol_relative": (HOSTILE_NEXT, "/calendar"),
    "backslash": ("/\\evil.example/requests", "/calendar"),
    "absolute": ("https://evil.example/requests", "/calendar"),
    "script": ("javascript:alert(1)", "/calendar"),
    "share": ("/share/abc", "/calendar"),
    "api": ("/api/me", "/calendar"),
    "unknown": ("/nowhere", "/calendar"),
}


@pytest.mark.parametrize("case", NEXT_IDS, ids=NEXT_IDS)
def test_return_path(browser, app_url, case):
    value, landing = NEXT_CASES[case]
    _, email, password = SEEDS["maple"]["other"]
    path = "/" if value is None else "/?next=" + quote(value, safe="")
    with screen(browser, app_url, path) as page:
        fill(role(page, "textbox", "Email"), email)
        fill(page.get_by_label("Password", exact=True), password)
        role(page, "button", "Sign in").click()
        expect(page).to_have_url(re.compile(re.escape(landing) + "$"))
        assert same_origin(page.url, origin_of(app_url))
        page.reload()
        expect(page).to_have_url(re.compile(re.escape(landing) + "$"))


def test_expired_session_keeps_entries(browser, app_url, mail):
    home = make_home(app_url, mail)
    description = person("kept")[0]
    tokens: list[str] = []

    def note_token(req: Any) -> None:
        if "authorization" in req.headers:
            tokens.append(req.headers["authorization"].split(" ")[1])

    with screen(browser, app_url, "/costs", login=(home.planning_email, PASSWORD)) as page:
        page.on("request", note_token)
        page.reload()
        fill_cost(page, description, KEPT_AMOUNT, home.today())
        pump(page, lambda: tokens, "the page calling the API with its bearer token")
        want(Api(app_url, tokens[-1]).delete("/api/session"), 204)
        expect(page).to_have_url(re.compile(r"/\?next=%2Fcosts$"))
        fill(role(page, "textbox", "Email"), home.planning_email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        role(page, "button", "Sign in").click()
        expect(page).to_have_url(re.compile(r"/costs$"))
        dialog = role(page, "dialog", "Log a cost")
        expect(role(dialog, "textbox", "Description")).to_have_value(description)
        expect(role(dialog, "textbox", "Amount")).to_have_value(KEPT_AMOUNT)
        expect(role(dialog, "textbox", "Description")).to_be_focused()
        expect(activity(page)).to_have_text("You were signed out. Your entries are still here. Check them and send again.")
        assert home.log_count(COST_DRAFTED) == 0
        role(dialog, "button", "Cancel").click()

    first = free_run(home, "planning", 2)
    tokens.clear()
    with screen(browser, app_url, f"/calendar?year={first.year}", login=(home.planning_email, PASSWORD)) as page:
        page.on("request", note_token)
        page.reload()
        role(page, "button", "Request a swap").click()
        dialog = role(page, "dialog", "Request a swap")
        fill(role(dialog, "textbox", "First night"), ui_date(first))
        pump(page, lambda: tokens, "the page calling the API with its bearer token")
        want(Api(app_url, tokens[-1]).delete("/api/session"), 204)
        expect(page).to_have_url(re.compile(r"/\?next="))
        fill(role(page, "textbox", "Email"), home.other_email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        role(page, "button", "Sign in").click()
        expect(page).to_have_url(re.compile(r"/calendar"))
        expect(role(page, "dialog", "Request a swap")).to_have_count(0)
        assert home.log_count(SWAP_DRAFTED) == 0


def test_bearer_only(app_url):
    _, email, password = SEEDS["maple"]["other"]
    hid = SEEDS["maple"]["hid"]
    answer = want(Api(app_url).post("/api/session", {"email": email, "password": password}), 200, 201)
    assert not answer.cookies, "L296 Cookies are neither set nor accepted"
    token = answer.json()["token"]
    jar = {"Cookie": f"token={token}; session={token}; Authorization={token}"}
    anonymous = Api(app_url)
    for path in ("/api/me", f"/api/households/{hid}/events", f"/api/households/{hid}/log"):
        problem(anonymous.get(path, headers=jar), 401, "unauthenticated")
    problem(anonymous.get(f"/api/households/{hid}/events", params={"token": token, "access_token": token}), 401, "unauthenticated")
    stream = Stream(app_url, token, hid)
    try:
        assert stream.opened.wait(HTTP_TIMEOUT)
        assert stream.status == 200 and stream.content_type.startswith("text/event-stream")
    finally:
        stream.close()


SHAPE = {
    "effectiveFrom": "2026-01-01", "exchangeZone": ST_JOHNS, "firstExchangeAt": "2026-01-01T17:00:00-03:30",
    "base": {"pattern": "PPOOPPPPPOOOOO", "anchor": "2026-01-05"}, "splitBp": {"planning": 6000, "other": 4000}, "maxConsecutiveNights": None,
    "rules": [
        {"id": "easter", "kind": "holiday", "name": "Easter", "date": {"type": "easter"}, "startOffset": -2, "nights": 3, "oddYears": "planning", "evenYears": "other"},
        {"id": "thanksgiving", "kind": "holiday", "name": "Thanksgiving", "date": {"type": "nth_weekday", "month": 11, "weekday": 4, "n": 4}, "startOffset": -1, "nights": 4, "oddYears": "planning", "evenYears": "other"},
        {"id": "xmas-eve", "kind": "holiday", "name": "Christmas Eve", "date": {"type": "fixed", "month": 12, "day": 24}, "startOffset": 0, "nights": 1, "oddYears": "other", "evenYears": "planning"},
        {"id": "spring-2027", "kind": "school_break", "name": "Spring break", "nights": "2027-03-20/2027-03-28", "split": "halves", "firstHalfOddYears": "planning"},
        {"id": "summer-2027", "kind": "vacation", "name": "Summer in Boston", "parent": "other", "nights": "2027-07-10/2027-07-24", "exchangeZone": NEW_YORK, "firstExchangeAt": "2027-07-10T10:00:00-04:00"},
    ],
}

PLAN_CASES = {
    "valid_shape": (None, None, None, None),
    "written_in_utc": (["firstExchangeAt"], "2026-01-01T20:30:00Z", None, None),
    "zone": (["exchangeZone"], "Mars/Olympus", "exchangeZone", "Choose a time zone from the list."),
    "seconds": (["firstExchangeAt"], "2026-01-01T17:00:30-03:30", "firstExchangeAt", "The exchange must be on the minute."),
    "fractional": (["firstExchangeAt"], "2026-01-01T17:00:00.5-03:30", "firstExchangeAt", "Enter an RFC 3339 instant with an offset and no fractional seconds."),
    "wrong_date": (["firstExchangeAt"], "2026-01-02T17:00:00-03:30", "firstExchangeAt", "The first exchange must fall on the effective date."),
    "pattern": (["base", "pattern"], "PPX", "base.pattern", "Use 1 to 28 letters P and O."),
    "split": (["splitBp"], {"planning": 6000, "other": 3000}, "splitBp", "The two shares must add up to 100%."),
    "run_limit": (["maxConsecutiveNights"], 1, "maxConsecutiveNights", "Use 2 to 60 nights."),
    "leap_day": (["rules", 2, "date"], {"type": "fixed", "month": 2, "day": 29}, "rules[2].date.day", "Enter a date that exists every year."),
    "duplicate_name": (["rules", 1, "name"], "Easter", None, "Each rule needs its own name."),
    "reserved_id": (["rules", 0, "id"], "base", None, "Each rule needs its own name."),
    "start_offset": (["rules", 0, "startOffset"], 8, "rules[0].startOffset", "This value is out of range."),
    "holiday_nights": (["rules", 0, "nights"], 15, "rules[0].nights", "This value is out of range."),
    "break_nights": (["rules", 3, "nights"], "2027-01-01/2027-05-02", "rules[3].nights", "This value is out of range."),
    "vacation_nights": (["rules", 4, "nights"], "2027-07-10/2027-08-22", "rules[4].nights", "This value is out of range."),
}


@pytest.mark.parametrize("case", list(PLAN_CASES), ids=list(PLAN_CASES))
def test_plan_rule_model(app_url, case):
    home = make_home(app_url, adopted=False, joined=False)
    path, value, error_path, message = PLAN_CASES[case]
    body = json.loads(json.dumps(SHAPE))
    if path:
        target: Any = body
        for step in path[:-1]:
            target = target[step]
        target[path[-1]] = value
    answer = home.planning.put(home.at("/plan/draft"), body, none_match="*")
    if message:
        problem(answer, 422, "validation_failed", error_path, message)
        assert want(home.planning.get(home.at("/plan")), 200).json()["versions"] == []
        assert home.log_count("plan.draft_saved") == 0
        return
    made = want(answer, 200, 201).json()
    strong(answer)
    assert made["status"] == "draft" and made["number"] >= 1 and isinstance(made["id"], str)
    assert made["firstExchangeAt"] == SHAPE["firstExchangeAt"]
    for key in ("effectiveFrom", "exchangeZone", "base", "splitBp", "maxConsecutiveNights", "rules"):
        assert made[key] == SHAPE[key]


def test_rule_order_list(browser, app_url):
    year = 2030
    rules = [holiday("one", HOL_ONE, {"type": "fixed", "month": 5, "day": 1}, "planning", "other"),
             holiday("two", HOL_TWO, {"type": "fixed", "month": 5, "day": 2}, "planning", "other"),
             school_break("brk", BRK_ONE, f"{year}-06-01/{year}-06-05")]
    home = make_home(app_url, adopted=False, joined=False)
    save_draft(home, version(f"{year}-01-01", rules=rules))
    puts: list[Any] = []
    with screen(browser, app_url, "/plan", login=(home.planning_email, PASSWORD)) as page:
        page.on("request", lambda req: puts.append(req) if req.method == "PUT" and req.url.endswith("/plan/draft") else None)
        listbox = role(page, "listbox", "Rule order")
        expect(role(listbox, "group", "Holidays").or_(listbox.get_by_text("Holidays", exact=True)).first).to_be_visible()
        expect(listbox.get_by_role("option")).to_have_count(3)
        select_rule(page, listbox, 3, 1)
        page.keyboard.press("Alt+ArrowDown")
        expect(activity(page)).to_have_text("A rule moves only within its own kind.")
        assert holiday_order(home) == [HOL_ONE, HOL_TWO]
        assert puts == []
        page.keyboard.press("Alt+ArrowUp")
        pump(page, lambda: holiday_order(home) == [HOL_TWO, HOL_ONE], "Alt+Up saving the holiday's new order", seconds=10)
        assert puts[0].headers.get("if-match"), "each move is a conditional write"
        expect(listbox.get_by_role("option").first).to_contain_text(HOL_TWO)
        assert HOL_TWO in active_text(page)
        before = len(puts)
        role(page, "button", "Move down").click()
        pump(page, lambda: holiday_order(home) == [HOL_ONE, HOL_TWO], "the Move down button saving the order", seconds=10)
        assert len(puts) == before + 1
        page.reload()
        expect(role(page, "listbox", "Rule order").get_by_role("option").first).to_contain_text(HOL_ONE)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        names = tab_order(page, 14)
        stops = [n for n in names if n and (HOL_ONE in n or HOL_TWO in n or BRK_ONE in n or n == "Rule order")]
        assert len(stops) == 1, f"L208 the listbox has one Tab stop: {names}"


def test_live_plan_preview(browser, app_url):
    home = make_home(app_url, adopted=False, joined=False)
    year = home.today().year
    days = (date(year + 1, 1, 1) - date(year, 1, 1)).days
    save_draft(home, version(f"{year}-01-01", pattern="PPPO"))
    problem(home.planning.post(home.at("/plan/preview"), version(f"{year}-01-01"), params={"year": YEAR_TOO_EARLY}), 422, "validation_failed", "year", "Choose a year from 2000 to 2100.")
    planning_nights = sum(1 for i in range(days) if "PPPO"[i % 4] == "P")
    with screen(browser, app_url, "/plan", login=(home.planning_email, PASSWORD)) as page:
        preview = role(page, "status", "Plan preview")
        expect(preview).to_have_text(f"{home.planning_name}: {planning_nights} nights, {home.other_name}: {days - planning_nights} nights in {year}")
        page.evaluate("window.__stayed = true")
        fill(role(page, "textbox", "Base pattern"), "O")
        expect(preview).to_have_text(f"{home.planning_name}: 0 nights, {home.other_name}: {days} nights in {year}", timeout=QUOTE_MS + UI_SLACK_MS)
        assert page.evaluate("window.__stayed === true"), "the preview must update with no reload"
        assert draft_of(home)["base"]["pattern"] == "PPPO", "a preview saves nothing"


def test_wf_plan_rules_keyboard(browser, app_url, mail):
    year = 2031
    home = make_home(app_url, mail, adopted=False)
    rules = [holiday("first", HOL_ALPHA, {"type": "fixed", "month": 5, "day": 1}, "planning", "other"),
             holiday("second", HOL_BETA, {"type": "fixed", "month": 5, "day": 2}, "planning", "other"),
             school_break("june", JUNE_BREAK, f"{year}-06-01/{year}-06-15", split="whole", first="other")]
    save_draft(home, version(f"{year}-01-01", pattern="P", rules=rules))
    with screen(browser, app_url, "/plan", login=(home.planning_email, PASSWORD)) as page:
        exchanges = watch_draft_writes(page)
        opened = home.log_count("plan.draft_saved")
        editor = role(page, "region", "Rule editor")
        role(editor, "textbox", "Rule name").focus()
        page.keyboard.type(HOL_GAMMA)
        select(role(editor, "combobox", "Kind"), "Holiday")
        select(role(editor, "combobox", "Date type"), "Fixed date")
        type_number(page, role(editor, "spinbutton", "Month"), "2")
        type_number(page, role(editor, "spinbutton", "Day of month"), "29")
        type_number(page, role(editor, "spinbutton", "Start offset (days)"), "0")
        type_number(page, role(editor, "spinbutton", "Nights"), "1")
        select(role(editor, "combobox", "Odd years"), home.other_name)
        select(role(editor, "combobox", "Even years"), home.planning_name)
        press(page, role(editor, "button", "Add rule"))
        gamma_listed = role(page, "listbox", "Rule order").get_by_role("option", name=re.compile(HOL_GAMMA))
        if gamma_listed.count():
            press(page, role(page, "button", "Save draft"))
        expect(field_error(page, "Enter a date that exists every year.")).to_be_visible()
        assert holiday_order(home) == [HOL_ALPHA, HOL_BETA]
        if gamma_listed.count():
            gamma_listed.first.click()
        type_number(page, role(editor, "spinbutton", "Month"), "6")
        type_number(page, role(editor, "spinbutton", "Day of month"), "10")
        if gamma_listed.count():
            press(page, role(editor, "button", "Save rule"))
        else:
            press(page, role(editor, "button", "Add rule"))
        press(page, role(page, "button", "Save draft"))
        expect(activity(page)).to_have_text("Draft saved.")
        stored = next(x for x in draft_of(home)["rules"] if x["name"] == HOL_GAMMA)
        assert stored["date"] == {"type": "fixed", "month": 6, "day": 10}
        assert (stored["startOffset"], stored["nights"], stored["oddYears"], stored["evenYears"]) == (0, 1, "other", "planning")
        assert not {"parent", "split", "firstHalfOddYears", "exchangeZone"} & set(stored)

        saved = home.log_count("plan.draft_saved")
        writes = len(exchanges)
        listbox = role(page, "listbox", "Rule order")
        select_rule(page, listbox, 4, 2)
        page.keyboard.press("Alt+ArrowUp")
        page.keyboard.press("Alt+ArrowUp")
        pump(page, lambda: len(exchanges) >= writes + 2, "two PUTs for two quick moves", seconds=10)
        assert holiday_order(home) == [HOL_GAMMA, HOL_ALPHA, HOL_BETA]
        assert home.log_count("plan.draft_saved") == saved + 2

        pump(page, lambda: sum(1 for _, tag in exchanges if tag) >= home.log_count("plan.draft_saved") - opened, "the reply of every saved draft")
        rotate_holidays_on_next_write(page, home, current_draft_tag(exchanges))
        page.keyboard.press("Alt+ArrowDown")
        expect(activity(page)).to_have_text(STALE)
        server_order = holiday_order(home)
        assert server_order == [HOL_ALPHA, HOL_BETA, HOL_GAMMA]
        options = listbox.get_by_role("option")
        for i, rule_name in enumerate(server_order):
            expect(options.nth(i)).to_contain_text(rule_name)
        assert HOL_GAMMA in active_text(page)
        page.unroute("**/plan/draft")
        press(page, role(page, "button", "Adopt plan"))
        expect(activity(page)).to_have_text("Plan adopted. The calendar now uses it.")
    target = date(year, 6, 10)
    night = home.night(target)
    assert (night["ruleName"], night["kind"], night["beats"], night["owner"]) == (HOL_GAMMA, "holiday", JUNE_BREAK, "other")
    with screen(browser, app_url, f"/calendar?year={year}", login=(home.other_email, PASSWORD)) as page:
        expect(stage(page, year)).to_be_visible()
        focus_day(page, target - timedelta(days=1))
        page.keyboard.press("ArrowRight")
        expect(role(page, "status", "Day answer")).to_have_text(f"{fmt_day(target)}: {home.other_name} \u2014 {HOL_GAMMA} (Holiday), beats {JUNE_BREAK}")
        cell = role(role(page, "region", "Calendar"), "gridcell", f"{fmt_day(target)}, {home.other_name}")
        expect(cell).to_have_count(1)


def test_wf_plan_rules_recovery(browser, app_url):
    home = make_home(app_url, adopted=False, joined=False)
    year = home.today().year
    save_draft(home, version(f"{year}-01-01"))
    with screen(browser, app_url, "/plan", login=(home.planning_email, PASSWORD)) as page:
        share = role(page, "textbox", f"Cost share for {home.planning_name} (%)")
        expect(share).to_be_visible()
        fill(role(page, "textbox", "Base anchor"), "31/02/2030")
        role(page, "button", "Save draft").click()
        expect(field_error(page, REAL_DATE)).to_be_visible()
        fill(role(page, "textbox", "Base anchor"), ui_date(date(year, 1, 4)))
        fill(role(page, "textbox", "Exchange time"), "25:61")
        role(page, "button", "Save draft").click()
        expect(field_error(page, "Enter a time as HH:MM.")).to_be_visible()
        fill(role(page, "textbox", "Exchange time"), RECOVERY_TIME)
        fill(share, "55.5")
        role(page, "button", "Save draft").click()
        expect(field_error(page, "Enter a share from 0 to 100 with at most two decimals, using a comma.")).to_be_visible()
        assert home.log_count("plan.draft_saved") == 1
        fill(share, RECOVERY_SHARE)
        role(page, "button", "Save draft").click()
        expect(activity(page)).to_have_text("Draft saved.")
    saved = draft_of(home)
    assert saved["splitBp"] == RECOVERY_SPLIT
    assert saved["base"]["anchor"] == str(date(year, 1, 4))
    assert saved["firstExchangeAt"] == rfc(local(saved["effectiveFrom"], RECOVERY_TIME, ST_JOHNS))


def test_ordered_rule_moves(browser, app_url):
    year = 2032
    rules = [holiday(f"r{i}", RULE_NAMES[i], {"type": "fixed", "month": 3, "day": i + 1}, "planning", "other") for i in range(3)]
    home = make_home(app_url, adopted=False, joined=False)
    save_draft(home, version(f"{year}-01-01", rules=rules))
    with screen(browser, app_url, "/plan", login=(home.planning_email, PASSWORD)) as page:
        exchanges = watch_draft_writes(page)
        listbox = role(page, "listbox", "Rule order")
        expect(listbox.get_by_role("option")).to_have_count(3)
        select_rule(page, listbox, 3, 0)
        page.keyboard.press("Alt+ArrowDown")
        page.keyboard.press("Alt+ArrowDown")
        pump(page, lambda: len(exchanges) >= 2, "two PUTs for two quick moves")
        assert holiday_order(home) == [RULE_NAMES[1], RULE_NAMES[2], RULE_NAMES[0]]
        first, second = exchanges[:2]
        assert first[1] == second[0] or second[1] == first[0], "the second move must use the ETag of the first reply"

        rotate_holidays_on_next_write(page, home, current_draft_tag(exchanges))
        page.keyboard.press("Alt+ArrowUp")
        expect(activity(page)).to_have_text(STALE)
        options = listbox.get_by_role("option")
        assert holiday_order(home) == [RULE_NAMES[2], RULE_NAMES[0], RULE_NAMES[1]]
        for i, name in enumerate(holiday_order(home)):
            expect(options.nth(i)).to_contain_text(name)
        assert RULE_NAMES[0] in active_text(page)


def test_hidden_rule_fields(browser, app_url):
    home = make_home(app_url, adopted=False, joined=False)
    save_draft(home, version(f"{home.today().year}-01-01"))
    with screen(browser, app_url, "/plan", login=(home.planning_email, PASSWORD)) as page:
        editor = role(page, "region", "Rule editor")
        fill(role(editor, "textbox", "Rule name"), HIDDEN_RULE)
        select(role(editor, "combobox", "Kind"), "Holiday")
        select(role(editor, "combobox", "Date type"), "Fixed date")
        fill(role(editor, "spinbutton", "Month"), "5")
        fill(role(editor, "spinbutton", "Day of month"), "9")
        expect(role(editor, "spinbutton", "Weekday")).to_have_count(0)
        expect(role(editor, "textbox", "First night")).to_have_count(0)
        select(role(editor, "combobox", "Date type"), "Easter")
        expect(role(editor, "spinbutton", "Month")).to_have_count(0)
        expect(role(editor, "spinbutton", "Day of month")).to_have_count(0)
        role(editor, "textbox", "Rule name").focus()
        names = tab_order(page, 14)
        assert "Month" not in names and "Day of month" not in names and "First night" not in names and "Parent" not in names, names
        fill(role(editor, "spinbutton", "Start offset (days)"), "0")
        fill(role(editor, "spinbutton", "Nights"), "1")
        select(role(editor, "combobox", "Odd years"), home.planning_name)
        select(role(editor, "combobox", "Even years"), home.other_name)
        role(editor, "button", "Add rule").click()
        role(page, "button", "Save draft").click()
        expect(activity(page)).to_have_text("Draft saved.")
        rule = next(x for x in draft_of(home)["rules"] if x["name"] == HIDDEN_RULE)
        assert rule["date"] == {"type": "easter"}
        select(role(editor, "combobox", "Kind"), "Vacation")
        expect(role(editor, "combobox", "Odd years")).to_have_count(0)
        expect(role(editor, "combobox", "Date type")).to_have_count(0)
        expect(role(editor, "textbox", "First night")).to_be_visible()
        expect(role(editor, "combobox", "Parent")).to_be_visible()
        select(role(editor, "combobox", "Kind"), "School break")
        expect(role(editor, "combobox", "Parent")).to_have_count(0)
        expect(role(editor, "combobox", "Split")).to_be_visible()


def test_wall_clock_handovers(app_url):
    year = 2030
    home = make_home(app_url, adopted=False, joined=False)
    body = version(f"{year}-01-01", pattern="PO")
    body["firstExchangeAt"] = local(f"{year}-01-01", "17:00", ST_JOHNS).astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    adopt(home, body)
    doc = home.doc(year)
    offsets = set()
    for day in doc["days"][1:]:
        moment = datetime.fromisoformat(day["exchangeAt"])
        assert day["exchangeZone"] == ST_JOHNS
        assert moment.strftime("%H:%M") == "17:00", day
        assert moment.date() == d(day["date"]), day
        assert moment.utcoffset() == local(day["date"], "17:00", ST_JOHNS).utcoffset(), day
        offsets.add(moment.utcoffset())
    assert len(offsets) == 2, "handovers must follow the zone's clock change"
    single = make_home(app_url, adopted=False, joined=False)
    adopt(single, version(f"{year}-01-01", pattern="P"))
    assert all(x["exchangeAt"] is None for x in single.doc(year)["days"][1:]), "a night with the same owner has no handover"


def test_derived_precedence(app_url):
    maple = seed_home(app_url, "maple")
    nights = {x["date"]: x for x in maple.doc(2027)["days"]}
    assert (nights["2027-03-26"]["ruleId"], nights["2027-03-26"]["owner"], nights["2027-03-26"]["beats"]) == ("easter", "planning", "Spring break")
    assert (nights["2027-03-24"]["ruleId"], nights["2027-03-24"]["kind"], nights["2027-03-24"]["beats"]) == ("spring-2027", "school_break", None)
    assert (nights["2027-07-10"]["ruleId"], nights["2027-07-10"]["kind"], nights["2027-07-10"]["owner"]) == ("summer-2027", "vacation", "other")
    swapped = {x["date"]: x for x in maple.doc(2026)["days"]}["2026-06-12"]
    assert (swapped["ruleId"], swapped["kind"], swapped["ruleName"], swapped["owner"]) == ("swap:9007199254741031", "swap", "Swap", "other")
    year = 2030
    home = make_home(app_url, adopted=False, joined=False)
    rules = [holiday("hol-a", HOL_A, {"type": "fixed", "month": 7, "day": 10}, "other", "planning"),
             holiday("hol-b", HOL_B, {"type": "fixed", "month": 7, "day": 10}, "planning", "other"),
             school_break("brk", BRK, f"{year}-07-08/{year}-07-13", split="whole", first="planning"),
             vacation("vac", VAC, "planning", f"{year}-07-06/{year}-07-15")]
    adopt(home, version(f"{year}-01-01", pattern="O", rules=rules))
    own = {x["date"]: x for x in home.doc(year)["days"]}
    assert (own[f"{year}-07-10"]["ruleId"], own[f"{year}-07-10"]["owner"], own[f"{year}-07-10"]["beats"]) == ("hol-a", "planning", HOL_B)
    assert (own[f"{year}-07-09"]["ruleId"], own[f"{year}-07-09"]["owner"], own[f"{year}-07-09"]["beats"]) == ("brk", "other", VAC)
    assert (own[f"{year}-07-07"]["ruleId"], own[f"{year}-07-07"]["owner"], own[f"{year}-07-07"]["beats"]) == ("vac", "planning", None)
    assert (own[f"{year}-07-20"]["ruleId"], own[f"{year}-07-20"]["ruleName"], own[f"{year}-07-20"]["kind"]) == ("base", "Base rotation", "base")


def test_holiday_and_break_dates(app_url):
    maple = seed_home(app_url, "maple")
    seeded = {x["date"]: x for x in maple.doc(2026)["days"]}
    assert seeded["2026-11-25"]["ruleId"] == "thanksgiving" and seeded["2026-11-28"]["ruleId"] == "thanksgiving"
    assert seeded["2026-11-28"]["owner"] == "other" and seeded["2026-11-24"]["ruleId"] != "thanksgiving"
    assert (seeded["2026-12-24"]["ruleId"], seeded["2026-12-24"]["owner"], seeded["2026-12-24"]["beats"]) == ("xmas-eve", "planning", "Winter break")
    assert (seeded["2026-12-25"]["ruleId"], seeded["2026-12-25"]["owner"], seeded["2026-12-25"]["beats"]) == ("xmas-day", "other", "Winter break")
    assert (seeded["2026-12-19"]["owner"], seeded["2026-12-26"]["owner"], seeded["2026-12-27"]["owner"]) == ("other", "other", "planning")
    spring = {x["date"]: x for x in maple.doc(2027)["days"]}
    assert (spring["2027-03-23"]["owner"], spring["2027-03-24"]["owner"]) == ("planning", "other")

    start = 2030
    rules = [holiday("east", "East", {"type": "easter"}, "other", "other", offset=-2, nights=3),
             holiday("fifth", "Fifth", {"type": "nth_weekday", "month": 2, "weekday": 7, "n": 5}, "other", "other"),
             holiday("last", "Last", {"type": "nth_weekday", "month": 8, "weekday": 1, "n": -1}, "other", "other"),
             holiday("cross", "Cross", {"type": "fixed", "month": 12, "day": 31}, "other", "planning", nights=3)]
    home = make_home(app_url, adopted=False, joined=False)
    adopt(home, version(f"{start}-01-01", pattern="P", rules=rules))
    for year in range(start, start + 6):
        doc = {x["date"]: x for x in home.doc(year)["days"]}
        sunday = easter(year)
        covered = sorted(k for k, v in doc.items() if v["ruleId"] == "east")
        assert covered == [str(sunday - timedelta(days=2)), str(sunday - timedelta(days=1)), str(sunday)], year
        august = [date(year, 8, n) for n in range(1, 32)]
        last = max(x for x in august if x.isoweekday() == 1)
        assert doc[str(last)]["ruleId"] == "last" and doc[str(last - timedelta(days=7))]["ruleId"] != "last"
        fifth = [k for k, v in doc.items() if v["ruleId"] == "fifth"]
        sundays = [date(year, 2, n) for n in range(1, 30 if (year % 4 == 0) else 29) if date(year, 2, n).isoweekday() == 7]
        assert fifth == ([str(sundays[4])] if len(sundays) == 5 else []), year
        anchor_owner = "other" if year % 2 else "planning"
        assert (doc[f"{year}-12-31"]["ruleId"], doc[f"{year}-12-31"]["owner"]) == ("cross", anchor_owner)
        following = {x["date"]: x for x in home.doc(year + 1)["days"]}
        assert (following[f"{year + 1}-01-02"]["ruleId"], following[f"{year + 1}-01-02"]["owner"]) == ("cross", anchor_owner)
        assert following[f"{year + 1}-01-03"]["ruleId"] != "cross"


def test_exchange_instants(app_url):
    year = 2030
    for zone, gap_time, fold_time in ((LORD_HOWE, "02:15", "01:45"), (ST_JOHNS, "02:30", "01:30")):
        gap, fold = transitions(zone, year)
        for moment, hhmm in ((gap, gap_time), (fold, fold_time)):
            home = make_home(app_url, adopted=False, joined=False, zone=zone)
            adopt(home, version(f"{year}-01-01", zone=zone, time_=hhmm, pattern="PO"))
            night = home.night(moment)
            expected = local(moment, hhmm, zone)
            assert night["exchangeAt"] == rfc(expected), (zone, moment, night)
            assert night["exchangeZone"] == zone
            assert not night["exchangeAt"].endswith("Z") and "." not in night["exchangeAt"]
    home = make_home(app_url, adopted=False, joined=False)
    trip = vacation("trip", "Trip", "other", f"{year}-07-10/{year}-07-24", zone=NEW_YORK)
    adopt(home, version(f"{year}-01-01", pattern="P", rules=[trip]))
    arrive, leave = home.night(date(year, 7, 10)), home.night(date(year, 7, 24))
    assert (arrive["exchangeAt"], arrive["exchangeZone"]) == (rfc(local(f"{year}-07-10", "10:00", NEW_YORK)), NEW_YORK)
    assert (leave["exchangeAt"], leave["exchangeZone"]) == (rfc(local(f"{year}-07-24", "10:00", NEW_YORK)), NEW_YORK)
    assert home.night(date(year, 7, 11))["exchangeAt"] is None


def test_one_derived_year(browser, app_url):
    maple = seed_home(app_url, "maple")
    path = maple.at("/years/2027")
    answer = want(maple.other.get(path), 200)
    raw = answer.content
    digest = hashlib.sha256(raw).hexdigest()
    assert answer.headers["etag"] == f'"{digest}"'
    parsed = json.loads(raw)
    assert raw == json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    assert want(maple.other.at(outage("APP_PEER_URL")).get(path), 200).content == raw
    assert want(maple.other.get(path, none_match=answer.headers["etag"]), 304).content == b""
    assert parsed["householdId"] == maple.hid and parsed["year"] == 2027 and len(parsed["days"]) == 365
    assert [x["date"] for x in parsed["days"]] == sorted(x["date"] for x in parsed["days"])
    assert set(parsed["days"][0]) == {"date", "owner", "ruleId", "kind", "ruleName", "beats", "exchangeAt", "exchangeZone"}
    owners = [x["owner"] for x in parsed["days"]]
    assert parsed["nights"] == {"planning": owners.count("planning"), "other": owners.count("other")}
    problem(maple.other.get(maple.at(f"/years/{YEAR_TOO_EARLY}")), 404, "not_found")
    problem(maple.other.get(maple.at(f"/years/{YEAR_TOO_LATE}")), 404, "not_found")
    with screen(browser, app_url, "/calendar?year=2027", login=(maple.other_email, maple.other_password)) as page:
        expect(role(page, "region", "Calendar")).to_contain_text(f"Year digest {digest}")


def test_month_grid(browser, app_url):
    maple = seed_home(app_url, "maple")
    days = {x["date"]: x for x in maple.doc(2027)["days"]}
    with screen(browser, app_url, "/calendar?year=2027", login=(maple.other_email, maple.other_password)) as page:
        answer = role(page, "status", "Day answer")
        focus_day(page, date(2027, 1, 13))

        def after(key: str, expected: date) -> None:
            page.keyboard.press(key)
            expect(answer).to_have_text(answer_text(days[str(expected)], maple.names))

        after("ArrowRight", date(2027, 1, 14))
        after("ArrowDown", date(2027, 1, 21))
        after("ArrowLeft", date(2027, 1, 20))
        after("ArrowUp", date(2027, 1, 13))
        page.keyboard.press("Home")
        expect(answer).not_to_contain_text(fmt_day(date(2027, 1, 13)))
        start = parse_day(answer.inner_text().split(":")[0])
        page.keyboard.press("End")
        expect(answer).not_to_contain_text(fmt_day(start))
        end = parse_day(answer.inner_text().split(":")[0])
        assert (end - start).days == 6 and start <= date(2027, 1, 13) <= end
        focus_day(page, date(2027, 1, 31))
        after("PageDown", date(2027, 2, 28))
        after("PageUp", date(2027, 1, 28))
        focus_day(page, date(2027, 1, 31))
        after("ArrowRight", date(2027, 2, 1))
        expect(day_cell(page, date(2027, 2, 1))).to_have_count(1)
        cell_name = f"{fmt_day(date(2027, 3, 26))}, {maple.planning_name}"
        focus_day(page, date(2027, 3, 26))
        expect(role(page, "region", "Calendar").get_by_role("gridcell", name=cell_name, exact=True)).to_have_count(1)
        focus_day(page, date(2027, 12, 31))
        page.keyboard.press("ArrowRight")
        expect(stage(page, 2028)).to_be_visible()
        next_year = {x["date"]: x for x in maple.doc(2028)["days"]}
        expect(answer).to_have_text(answer_text(next_year["2028-01-01"], maple.names))
        grid = role(page, "region", "Calendar").get_by_role("grid")
        assert grid.evaluate("g => g.querySelectorAll('[tabindex=\"0\"]').length") == 1


def test_field_swap_scroll(browser, app_url):
    maple = seed_home(app_url, "maple")
    doc = maple.doc(2027)
    n = len(doc["days"])
    login = (maple.other_email, maple.other_password)
    for size in VIEWPORTS:
        with screen(browser, app_url, "/calendar?year=2027", size=size, login=login) as page:
            region = stage(page, 2027)
            expect(region).to_have_attribute("data-field", "split")
            room = page.evaluate("document.documentElement.scrollHeight - innerHeight")
            assert room >= SWEEP_PX, "the document must be tall enough to reach 1200"
            for s in (0, SCROLL_LOW, SCROLL_MID, SWEEP_PX, SCROLL_MID, SCROLL_LOW, 0):
                assert jump(page, s) == s
                check_stage(page, doc, maple.names, s)
                assert abs(region.bounding_box()["y"]) <= 1, f"stage top at s={s}"
            box = region.bounding_box()
            assert abs(box["height"] - size[1]) <= 2 and abs(box["width"] - size[0]) <= 20
            if room > SWEEP_PX + 50:
                jump(page, SWEEP_PX + 50)
                assert region.bounding_box()["y"] < 0, "after 1200 the stage scrolls away"
            jump(page, room)
            tonight, calendar, summary = (role(page, "region", x).bounding_box() for x in ("Tonight", "Calendar", "Requests summary"))
            if size == MOBILE:
                assert abs(tonight["x"] - calendar["x"]) <= 2 and abs(calendar["x"] - summary["x"]) <= 2
                assert tonight["y"] < calendar["y"] < summary["y"]
            elif size == TABLET:
                assert calendar["y"] < tonight["y"] and abs(tonight["y"] - summary["y"]) <= 2
                assert tonight["x"] < summary["x"] and abs(tonight["width"] - summary["width"]) <= 4
                assert calendar["width"] > tonight["width"] * 1.5
            else:
                assert tonight["y"] < summary["y"] and abs(tonight["x"] - summary["x"]) <= 2
                assert calendar["x"] + calendar["width"] <= tonight["x"] + 2
                assert calendar["width"] > tonight["width"] * 1.5
    handover = next(i for i in range(1, n) if doc["days"][i]["owner"] != doc["days"][i - 1]["owner"] and i > 30)
    with screen(browser, app_url, "/calendar?year=2027", login=login) as page:
        region = stage(page, 2027)
        jump(page, first_scroll(handover - 1, n))
        expect(region).to_have_attribute("data-field", doc["days"][handover - 1]["owner"])
        before = decode(capture(region))
        jump(page, first_scroll(handover, n))
        expect(region).to_have_attribute("data-field", doc["days"][handover]["owner"])
        changed(before, decode(capture(region)))
    home = make_home(app_url, adopted=False, joined=False)
    year = 2030
    adopt(home, version(f"{year}-07-01", pattern="P"))
    with screen(browser, app_url, f"/calendar?year={year}", login=(home.planning_email, PASSWORD)) as page:
        region = stage(page, year)
        jump(page, 100)
        expect(region).to_have_attribute("data-field", "split")
        expect(region.locator(f'[data-date="{year}-01-02"]')).to_have_attribute("data-owner", "none")
        expect(region.locator(f'[data-date="{year}-07-02"]')).to_have_attribute("data-owner", "planning")


def test_night_counters(browser, app_url):
    maple = seed_home(app_url, "maple")
    doc = maple.doc(2027)
    days = doc["days"]
    with screen(browser, app_url, "/calendar?year=2027", login=(maple.other_email, maple.other_password)) as page:
        counter = role(page, "status", f"Nights with {maple.planning_name}")
        expect(counter).to_have_text(str(through(days, 0)["planning"]))
        handle = counter.element_handle()
        script = """([el, s, target]) => new Promise(done => {
            const seen = [el.textContent.trim()];
            const start = performance.now();
            const tick = () => {
                const now = el.textContent.trim();
                if (now !== seen[seen.length - 1]) seen.push(now);
                if (now === target) return done({ms: performance.now() - start, seen});
                if (performance.now() - start > 5000) return done({ms: Infinity, seen});
                requestAnimationFrame(tick);
            };
            scrollTo({top: s, behavior: 'instant'});
            requestAnimationFrame(tick);
        })"""
        up = through(days, index_at(SCROLL_HIGH, len(days)))["planning"]
        forward = page.evaluate(script, [handle, SCROLL_HIGH, str(up)])
        assert forward["ms"] <= COUNTER_MS + TIMER_SLACK_MS, forward
        values = [int(x) for x in forward["seen"]]
        assert values == sorted(values) and len(values) >= 3, f"expected a steady climb through in-between values: {values}"
        down = through(days, index_at(SCROLL_LOW, len(days)))["planning"]
        backward = page.evaluate(script, [handle, SCROLL_LOW, str(down)])
        assert backward["ms"] <= COUNTER_MS + TIMER_SLACK_MS, backward
        values = [int(x) for x in backward["seen"]]
        assert values == sorted(values, reverse=True), f"counters go down without overshoot: {values}"
        expect(role(page, "status", f"Nights with {maple.other_name}")).to_have_text(str(through(days, index_at(SCROLL_LOW, len(days)))["other"]))


TILT_SCRIPT = """e => {
    for (const n of [e, ...e.querySelectorAll('*')]) {
        const cs = getComputedStyle(n);
        if (cs.rotate && cs.rotate !== 'none') return parseFloat(cs.rotate);
        if (cs.transform && cs.transform !== 'none') {
            const v = cs.transform.slice(cs.transform.indexOf('(') + 1, -1).split(',').map(Number);
            const a = Math.atan2(v[1], v[0]) * 180 / Math.PI;
            if (Math.abs(a) > 0.01) return a;
        }
    }
    return 0;
}"""


def test_override_stickers(browser, app_url):
    maple = seed_home(app_url, "maple")
    doc = maple.doc(2027)
    n = len(doc["days"])
    runs = override_runs(doc["days"])
    assert len(runs) >= 2
    for size in VIEWPORTS:
        with screen(browser, app_url, "/calendar?year=2027", size=size, login=(maple.other_email, maple.other_password)) as page:
            expect(stage(page, 2027)).to_be_visible()
            for first, label in runs:
                sticker = page.get_by_role("img", name=label, exact=True)
                position = first_scroll(first, n)
                jump(page, position - 1)
                expect(sticker).to_have_count(0)
                jump(page, position)
                expect(sticker).to_have_count(1)
                timings = sticker.evaluate("e => e.getAnimations({subtree: true}).map(a => a.effect.getComputedTiming().endTime)")
                assert all(t < STICKER_MS for t in timings), timings
                expect(sticker).to_have_attribute("data-state", "resting", timeout=STICKER_MS + UI_SLACK_MS)
            angles = [page.get_by_role("img", name=label, exact=True).evaluate(TILT_SCRIPT) for _, label in runs]
            assert all(2 <= abs(a) <= 6 for a in angles), angles
            assert all(a * b < 0 for a, b in zip(angles, angles[1:])), f"tilts alternate left and right: {angles}"
            controls = [role(page, "slider", "Year strip"), role(page, "textbox", "Day"),
                        role(page, "status", f"Nights with {maple.planning_name}"), role(page, "status", f"Nights with {maple.other_name}")]
            boxes = [page.get_by_role("img", name=label, exact=True).bounding_box() for _, label in runs]
            others = [c.bounding_box() for c in controls]

            def overlap(a: dict, b: dict) -> bool:
                return a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]

            for i, box in enumerate(boxes):
                assert not any(overlap(box, other) for other in boxes[i + 1:]), f"stickers overlap at {size}"
                assert not any(overlap(box, other) for other in others), f"sticker over a stage control at {size}"
            jump(page, first_scroll(runs[0][0], n) - 1)
            for _, label in runs:
                expect(page.get_by_role("img", name=label, exact=True)).to_have_count(0)


def test_reduced_motion_year(browser, app_url):
    maple = seed_home(app_url, "maple")
    doc = maple.doc(2027)
    with screen(browser, app_url, "/calendar?year=2027", reduced=True, login=(maple.other_email, maple.other_password)) as page:
        region = stage(page, 2027)
        expect(region).to_have_attribute("data-field", "split")
        for who in ("planning", "other"):
            expect(role(page, "status", f"Nights with {maple.names[who]}")).to_have_text(str(doc["nights"][who]))
        for _, label in override_runs(doc["days"]):
            expect(page.get_by_role("img", name=label, exact=True)).to_have_attribute("data-state", "resting")
        assert page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length") == 0
        jump(page, SCROLL_MID)
        expect(region).to_have_attribute("data-field", "split")
        assert page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length") == 0
        answer = role(page, "status", "Day answer")
        box = role(page, "textbox", "Day")
        chosen = date(2027, 3, 26)
        fill(box, ui_date(chosen))
        box.press("Enter")
        expect(answer).to_have_text(answer_text(next(x for x in doc["days"] if x["date"] == str(chosen)), maple.names))
        slider = role(page, "slider", "Year strip")
        jump(page, 0)
        slider.focus()
        start = int(slider.get_attribute("aria-valuenow"))
        page.keyboard.press("ArrowRight")
        expect(slider).to_have_attribute("aria-valuenow", str(start + 1))
        expect(answer).to_have_text(answer_text(doc["days"][start + 1], maple.names))
        assert page.evaluate("scrollY") == 0, "under reduced motion the page does not scroll"


def test_tonight_card(browser, app_url, mail):
    home = make_home(app_url, mail)
    tonight = want(home.other.get(home.at("/tonight")), 200).json()
    today = home.today()
    assert tonight["date"] == str(today)
    night = home.night(today)
    assert (tonight["owner"], tonight["ruleName"]) == (night["owner"], night["ruleName"])
    following = tonight["nextHandover"]
    assert following["from"] in ("planning", "other") and following["to"] != following["from"]
    assert following["zone"] == ST_JOHNS
    reads: list[str] = []
    with screen(browser, app_url, "/calendar", login=(home.other_email, PASSWORD)) as page:
        card = role(page, "region", "Tonight")
        expect(card).to_contain_text(f"Tonight: {home.names[tonight['owner']]}")
        expect(card).to_contain_text(f"Next handover: {when(following['at'], following['zone'])}, {home.names[following['from']]} to {home.names[following['to']]}")
        page.on("request", lambda req: reads.append(req.url) if req.url.endswith("/tonight") else None)
        make_cost(home, home.planning)
        pump(page, lambda: reads, "GET /tonight after a stream entry", seconds=(LIVE_MS + UI_SLACK_MS) / 1000)
    with screen(browser, app_url, "/") as page:
        page.clock.install()
        sign_in(page, app_url, home.other_email, PASSWORD)
        expect(role(page, "region", "Tonight")).to_contain_text("Tonight:")
        reads.clear()
        page.on("request", lambda req: reads.append(req.url) if req.url.endswith("/tonight") else None)
        page.clock.run_for(TONIGHT_MS)
        pump(page, lambda: reads, "GET /tonight within a 60 second page-clock advance", seconds=10)
    still = make_home(app_url, joined=False, plan=lambda year: version(f"{year - 1}-01-01", pattern="P"))
    assert want(still.planning.get(still.at("/tonight")), 200).json()["nextHandover"] is None
    with screen(browser, app_url, "/calendar", login=(still.planning_email, PASSWORD)) as page:
        expect(role(page, "region", "Tonight")).to_contain_text("No handover in the next 60 days.")


def test_stage_any_arrival(browser, app_url):
    maple = seed_home(app_url, "maple")
    doc = maple.doc(2027)
    days = doc["days"]
    n = len(days)
    runs = override_runs(days)
    with screen(browser, app_url, "/calendar?year=2027", login=(maple.other_email, maple.other_password)) as page:
        region = stage(page, 2027)
        expect(region).to_be_visible()
        jump(page, SCROLL_HIGH)
        check_stage(page, doc, maple.names, SCROLL_HIGH)
        page.reload()
        expect(region).to_be_visible()
        s = page.evaluate("Math.round(scrollY)")
        check_stage(page, doc, maple.names, s)
        for first, label in runs:
            if first <= index_at(s, n):
                expect(page.get_by_role("img", name=label, exact=True)).to_have_attribute("data-state", "resting")
        page.goto(app_url.rstrip("/") + "/requests")
        expect(role(page, "list", "Sent by you")).to_be_attached()
        page.go_back()
        expect(region).to_be_visible()
        check_stage(page, doc, maple.names, page.evaluate("Math.round(scrollY)"))
        jump(page, 0)
        jump(page, SWEEP_PX)
        for _, label in runs:
            expect(page.get_by_role("img", name=label, exact=True)).to_have_count(1)
        jump(page, 0)
        for _, label in runs:
            expect(page.get_by_role("img", name=label, exact=True)).to_have_count(0)
        jump(page, SCROLL_MID)
        day = days[index_at(SCROLL_MID, n)]
        expect(region).to_have_attribute("data-field", day["owner"])
        page.emulate_media(reduced_motion="reduce")
        expect(region).to_have_attribute("data-field", "split")
        for who in ("planning", "other"):
            expect(role(page, "status", f"Nights with {maple.names[who]}")).to_have_text(str(doc["nights"][who]))
        assert page.evaluate("Math.round(scrollY)") == SCROLL_MID
        page.emulate_media(reduced_motion="no-preference")
        check_stage(page, doc, maple.names, SCROLL_MID)


def test_wf_year_strip_phone(browser, app_url, mail):

    def phone_plan(now: int) -> dict:
        rules = [school_break(f"brk-{y}", f"Break {y}", f"{y}-03-10/{y}-03-20") for y in (now, now + 1)]
        rules.insert(0, holiday("mid", "Mid March", {"type": "fixed", "month": 3, "day": 15}, "planning", "other"))
        return version(f"{now - 1}-01-01", zone=LORD_HOWE, time_="02:15", anchor=str(transitions(LORD_HOWE, now)[0]), rules=rules)

    home = make_home(app_url, mail, zone=LORD_HOWE, plan=phone_plan)
    now_year = home.today().year
    gap = transitions(LORD_HOWE, now_year)[0]
    first = free_run(home, "planning", 2)
    year = first.year
    doc = home.doc(year)
    n = len(doc["days"])
    names = home.names
    link = want(home.planning.post(home.at("/share-links"), {"label": person("school")[0], "expiresAt": rfc(local(home.today() + timedelta(days=30), "12:00", LORD_HOWE))}), 201).json()
    gap_day = home.night(gap)
    assert gap_day["exchangeAt"] == rfc(local(gap, "02:15", LORD_HOWE))
    with screen(browser, app_url, f"{urlsplit(link['url']).path}?year={now_year}", size=MOBILE, touch=True, clock=WRONG_CLOCK_FUTURE) as school:
        moment = datetime.fromisoformat(gap_day["exchangeAt"])
        item = f"{fmt_day(gap)} {moment:%H:%M} ({LORD_HOWE}): {names[home.night(gap - timedelta(days=1))['owner']]} to {names[gap_day['owner']]}"
        expect(role(school, "list", "Handovers")).to_contain_text(item)
    with screen(browser, app_url, f"/calendar?year={year}", size=MOBILE, touch=True, clock=WRONG_CLOCK_FUTURE, login=(home.other_email, PASSWORD)) as page:
        tonight = want(home.other.get(home.at("/tonight")), 200).json()
        expect(role(page, "region", "Tonight")).to_contain_text(f"Tonight: {names[tonight['owner']]}")
        slider = role(page, "slider", "Year strip")
        assert slider.bounding_box()["height"] >= TARGET_PX
        expect(slider).to_have_attribute("aria-valuemax", str(n - 1))
        tap(slider)
        region = stage(page, year)
        expect(slider).to_be_focused()
        expect(slider).not_to_have_attribute("aria-valuenow", "0")
        index = int(slider.get_attribute("aria-valuenow"))
        chosen = doc["days"][index]
        expect(slider).to_have_attribute("aria-valuetext", fmt_day(d(chosen["date"])))
        expect(region).to_have_attribute("data-day", chosen["date"])
        expect(role(page, "status", "Day answer")).to_have_text(answer_text(chosen, names))
        eventually(lambda: abs(page.evaluate("scrollY") - first_scroll(index, n)) <= 1, 5, "a tap jumping the page to the day's smallest scroll position")
        box = role(page, "textbox", "Day")
        fill(box, f"01/06/{year + 2}")
        box.press("Enter")
        expect(role(page, "status", "Day answer")).to_have_text(f"Choose a day in {year}.")
        for s in (SCROLL_LOW, SCROLL_MID, SCROLL_HIGH, SCROLL_MID, SCROLL_LOW):
            jump(page, s)
            check_stage(page, doc, names, s)
        target = first_scroll((first - date(year, 1, 1)).days, n)
        jump(page, target)
        bar = region.locator(f'[data-date="{first}"]')
        expect(bar).to_have_attribute("data-owner", "planning")
        expect(region).to_have_attribute("data-field", "planning")
        swap, tag = send_swap(home, home.planning, first, 2)
        want(home.other.post(home.at(f"/swaps/{swap['id']}/accept"), etag=tag), 200)
        expect(bar).to_have_attribute("data-owner", "other", timeout=LIVE_MS + UI_SLACK_MS)
        expect(region).to_have_attribute("data-field", "other", timeout=LIVE_MS + UI_SLACK_MS)
        assert abs(page.evaluate("scrollY") - target) <= 1, "a live swap must not move the scroll"
        fresh = home.doc(year)
        check_stage(page, fresh, names, target)
        page.emulate_media(reduced_motion="reduce")
        expect(region).to_have_attribute("data-field", "split")
        for who in ("planning", "other"):
            expect(role(page, "status", f"Nights with {names[who]}")).to_have_text(str(fresh["nights"][who]))
        slider.focus()
        current = int(slider.get_attribute("aria-valuenow"))
        page.keyboard.press("ArrowRight")
        expect(slider).to_have_attribute("aria-valuenow", str(current + 1))
        expect(role(page, "status", "Day answer")).to_have_text(answer_text(fresh["days"][current + 1], names))
        assert abs(page.evaluate("scrollY") - target) <= 1


def test_wf_year_strip_day_box(browser, app_url):
    home = make_home(app_url, adopted=False, joined=False)
    with screen(browser, app_url, "/calendar", login=(home.planning_email, PASSWORD)) as page:
        expect(page.get_by_text("No plan yet.", exact=True).first).to_be_visible()
    year = 2030
    adopt(home, version(f"{year}-07-01", pattern="P"))
    with screen(browser, app_url, f"/calendar?year={year}", size=MOBILE, touch=True, login=(home.planning_email, PASSWORD)) as page:
        box = role(page, "textbox", "Day")
        answer = role(page, "status", "Day answer")
        fill(box, "31/02/2030")
        box.press("Enter")
        expect(page.get_by_text(REAL_DATE, exact=True).first).to_be_visible()
        fill(box, ui_date(date(year, 3, 1)))
        box.press("Enter")
        expect(answer).to_have_text(f"{fmt_day(date(year, 3, 1))}: no plan")
        fill(box, ui_date(date(year, 8, 1)))
        box.press("Enter")
        expect(answer).to_have_text(f"{fmt_day(date(year, 8, 1))}: {home.planning_name} \u2014 Base rotation (Base rotation)")


def test_swap_lifecycle(app_url, mail):
    bare = make_home(app_url, adopted=True, joined=False)
    problem(bare.planning.post(bare.at("/swaps"), {"nights": iv(bare.today() + timedelta(days=30), 1), "makeupNights": None, "toParent": "other", "note": None}), 409, "other_parent_not_joined")
    planless = make_home(app_url, mail, adopted=False)
    problem(planless.planning.post(planless.at("/swaps"), {"nights": iv(planless.today() + timedelta(days=30), 1), "makeupNights": None, "toParent": "other", "note": None}), 409, "no_adopted_plan")
    home = make_home(app_url, mail)
    first = free_run(home, "planning", 2)
    made = make_swap(home, home.planning, first, 1, note="private note")
    sid, tag = made.json()["id"], strong(made)
    assert made.json()["state"] == "draft" and made.json()["createdBy"] == "planning"
    problem(home.planning.post(home.at(f"/swaps/{sid}/accept"), etag=tag), 403, "not_your_answer")
    problem(home.planning.post(home.at(f"/swaps/{sid}/withdraw"), etag=tag), 409, "invalid_transition")
    problem(home.other.post(home.at(f"/swaps/{sid}/accept"), etag=tag), 409, "invalid_transition")
    problem(home.other.post(home.at(f"/swaps/{sid}/send"), etag=tag), 403, "not_your_request")
    problem(home.other.delete(home.at(f"/swaps/{sid}"), etag=tag), 403, "not_your_request")
    problem(home.planning.post(home.at(f"/swaps/{sid}/send")), 428, "precondition_required")
    sent = want(home.planning.post(home.at(f"/swaps/{sid}/send"), etag=tag), 200)
    assert sent.json()["state"] == "sent" and sent.json()["sentAt"]
    tag = strong(sent)
    problem(home.planning.delete(home.at(f"/swaps/{sid}"), etag=tag), 409, "invalid_transition")
    problem(home.planning.post(home.at(f"/swaps/{sid}/send"), etag=tag), 409, "invalid_transition")
    problem(home.planning.post(home.at(f"/swaps/{sid}/accept"), etag=tag), 403, "not_your_answer")
    problem(home.other.post(home.at(f"/swaps/{sid}/withdraw"), etag=tag), 403, "not_your_request")
    for verb in ("lapse", "settle"):
        problem(home.planning.post(home.at(f"/swaps/{sid}/{verb}"), etag=tag), 409, "invalid_transition")
    problem(home.other.post(home.at(f"/swaps/{sid}/decline"), {"reason": ""}, etag=tag), 422, "validation_failed", "reason", "Give a reason in 1 to 200 characters.")
    declined = want(home.other.post(home.at(f"/swaps/{sid}/decline"), {"reason": DECLINE_REASON}, etag=tag), 200)
    assert declined.json()["state"] == "declined" and declined.json()["declineReason"] == DECLINE_REASON and declined.json()["answeredAt"]
    problem(home.other.post(home.at(f"/swaps/{sid}/accept"), etag=strong(declined)), 409, "invalid_transition")
    second = make_swap(home, home.planning, first + timedelta(days=1), 1)
    assert want(home.planning.delete(home.at(f"/swaps/{second.json()['id']}"), etag=strong(second)), 204).content == b""
    problem(home.planning.get(home.at(f"/swaps/{second.json()['id']}")), 404, "not_found")
    assert home.log_count(SWAP_DELETED) == 1 and home.log_count(SWAP_DECLINED) == 1
    accepted, tag = send_swap(home, home.planning, first + timedelta(days=1), 1)
    done = want(home.other.post(home.at(f"/swaps/{accepted['id']}/accept"), etag=tag), 200)
    assert done.json()["state"] == "accepted"
    problem(home.planning.post(home.at(f"/swaps/{accepted['id']}/withdraw"), etag=strong(done)), 409, "invalid_transition")


def test_swap_nights(app_url, mail):
    home = make_home(app_url, mail)
    today = home.today()
    mine = free_run(home, "planning", 2)
    theirs = free_run(home, "other", 1)
    body = {"makeupNights": None, "note": None}
    problem(home.planning.post(home.at("/swaps"), {**body, "nights": iv(theirs, 1), "toParent": "other"}), 422, "validation_failed", "nights", GIVER_COPY)
    problem(home.planning.post(home.at("/swaps"), {**body, "nights": iv(mine, 1), "toParent": "planning"}), 422, "validation_failed", "nights", GIVER_COPY)
    solid = make_home(app_url, mail, plan=lambda year: version(f"{year - 1}-01-01", pattern="P"))
    far = solid.today() + timedelta(days=LEAD_DAYS)
    problem(solid.planning.post(solid.at("/swaps"), {**body, "nights": iv(far, 29), "toParent": "other"}), 422, "validation_failed", "nights", "Enter a first and last night, at most 28 nights.")
    problem(solid.planning.post(solid.at("/swaps"), {**body, "nights": f"{far}/{far}", "toParent": "other"}), 422, "validation_failed", "nights", "Enter a first and last night, at most 28 nights.")
    days = {x["date"]: x for year in (today.year - 1, today.year) for x in home.doc(year)["days"]}
    back = next(today - timedelta(days=i) for i in range(2, 16) if days[str(today - timedelta(days=i))]["owner"] == "planning")
    past = home.planning.post(home.at("/swaps"), {**body, "nights": iv(back, 1), "toParent": "other"})
    if past.status_code == 201:
        past = home.planning.post(home.at(f"/swaps/{past.json()['id']}/send"), etag=strong(past))
    problem(past, 422, "validation_failed", "nights", PASSED_COPY)
    assert home.log_count(SWAP_SENT) == 0
    end = mine + timedelta(days=1)
    before_end = home.night(end)
    swap, tag = send_swap(home, home.planning, mine, 1)
    want(home.other.post(home.at(f"/swaps/{swap['id']}/accept"), etag=tag), 200)
    moved = home.night(mine)
    assert (moved["owner"], moved["ruleId"], moved["kind"], moved["ruleName"]) == ("other", f"swap:{swap['id']}", "swap", "Swap")
    after_end = home.night(end)
    assert (after_end["owner"], after_end["ruleId"], after_end["kind"]) == (before_end["owner"], before_end["ruleId"], before_end["kind"]), "the interval's end date is outside the swap"


def test_conditional_writes(app_url, mail):
    home = make_home(app_url, mail)
    effective = home.today() + timedelta(days=40)
    body = amendment(home, effective)
    draft = save_draft(home, body)
    tag = strong(draft)
    problem(home.planning.put(home.at("/plan/draft"), body, none_match="*"), 412, "precondition_failed")
    problem(home.planning.put(home.at("/plan/draft"), body), 428, "precondition_required")
    problem(home.planning.delete(home.at("/plan/draft")), 428, "precondition_required")
    saved = race(lambda: home.planning.put(home.at("/plan/draft"), {**body, "maxConsecutiveNights": 30}, etag=tag),
                 lambda: home.planning.at(outage("APP_PEER_URL")).put(home.at("/plan/draft"), {**body, "maxConsecutiveNights": 40}, etag=tag))
    assert sorted(a.status_code for a in saved) == [200, 412], [a.text for a in saved]
    problem(next(a for a in saved if a.status_code == 412), 412, "precondition_failed")
    assert strong(next(a for a in saved if a.status_code == 200)) != tag
    made = make_cost(home, home.planning)
    cid, tag = made.json()["id"], strong(made)
    problem(home.planning.patch(home.at(f"/costs/{cid}"), {"description": "No tag"}), 428, "precondition_required")
    answers = race(lambda: home.planning.patch(home.at(f"/costs/{cid}"), {"description": "Writer one"}, etag=tag),
                   lambda: home.planning.at(outage("APP_PEER_URL")).patch(home.at(f"/costs/{cid}"), {"description": "Writer two"}, etag=tag))
    assert sorted(a.status_code for a in answers) == [200, 412], [a.text for a in answers]
    winner = next(a for a in answers if a.status_code == 200)
    assert want(home.planning.get(home.at(f"/costs/{cid}")), 200).json()["description"] == winner.json()["description"]
    assert home.log_count("cost.edited") == 1
    swap = make_swap(home, home.planning, free_run(home, "planning", 1), 1)
    problem(home.planning.post(home.at(f"/swaps/{swap.json()['id']}/send"), etag=STALE_TAG), 412, "precondition_failed")
    assert want(home.planning.get(home.at(f"/swaps/{swap.json()['id']}")), 200).headers["etag"] == strong(swap)


def test_idempotent_requests(app_url, mail):
    home = make_home(app_url, mail)
    key = idempotency_key()
    body = cost_body(home, REPLAY_DESC, amount=REPLAY_MINOR)
    first = want(home.planning.post(home.at("/costs"), body, key=key), 201)
    assert REPLAYED not in first.headers
    again = want(home.planning.at(outage("APP_PEER_URL")).post(home.at("/costs"), body, key=key), 201)
    assert again.headers[REPLAYED] == "true" and again.json() == first.json()
    assert sum(1 for c in list_all(home.planning, home.at("/costs")) if c["description"] == REPLAY_DESC) == 1
    assert home.log_count(COST_DRAFTED) == 1
    problem(home.planning.post(home.at("/costs"), {**body, "amountMinor": REUSED_MINOR}, key=key), 409, "idempotency_key_reused")
    for bad in ("has space", "x" * 65):
        problem(home.planning.post(home.at("/costs"), body, key=bad), 422, "validation_failed")
    assert home.log_count(COST_DRAFTED) == 1
    other = want(home.other.post(home.at("/costs"), body, key=key), 201)
    assert other.json()["id"] != first.json()["id"] and other.json()["paidBy"] == "other"
    refused_key = idempotency_key()
    bad_body = {**body, "amountMinor": 0}
    refused = problem(home.planning.post(home.at("/costs"), bad_body, key=refused_key), 422, "validation_failed")
    replay = home.planning.post(home.at("/costs"), bad_body, key=refused_key)
    assert problem(replay, 422, "validation_failed") == refused and replay.headers[REPLAYED] == "true"
    flight = idempotency_key()
    body2 = cost_body(home, FLIGHT_DESC, amount=FLIGHT_MINOR)
    parallel = race(*[lambda: home.planning.post(home.at("/costs"), body2, key=flight) for _ in range(4)])
    assert {a.status_code for a in parallel} == {201} and len({a.json()["id"] for a in parallel}) == 1
    assert sum(1 for c in list_all(home.planning, home.at("/costs")) if c["description"] == FLIGHT_DESC) == 1


def test_swap_by_keyboard(browser, app_url):
    maple = seed_home(app_url, "maple")
    with screen(browser, app_url, "/calendar?year=2027", login=(maple.other_email, maple.other_password)) as page:
        opener = role(page, "button", "Previous month")
        press(page, opener, S_KEY)
        dialog = role(page, "dialog", "Request a swap")
        expect(role(dialog, "textbox", "First night")).to_be_focused()
        for key in ["Tab"] * 12 + ["Shift+Tab"] * 12:
            page.keyboard.press(key)
            assert dialog.evaluate("e => e.contains(document.activeElement)"), f"{key} left the dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        day_box = role(page, "textbox", "Day")
        press(page, day_box, S_KEY)
        expect(dialog).to_have_count(0)
        expect(day_box).to_have_value(S_KEY)
        fill(day_box, "")
        preset = date(2027, 5, 12)
        focus_day(page, preset)
        page.keyboard.press("Enter")
        expect(role(dialog, "textbox", "First night")).to_have_value(ui_date(preset))
        role(dialog, "button", "Cancel").click()
        expect(dialog).to_have_count(0)


def test_wf_swaps_journey(browser, app_url, mail):
    home = make_home(app_url, mail, zone=PAGO_PAGO, plan=lambda year: version(f"{year - 1}-01-01", zone=PAGO_PAGO, time_="09:00"))
    first = free_run(home, "planning", 2)
    last = first + timedelta(days=1)
    with screen(browser, app_url, f"/calendar?year={first.year}", login=(home.planning_email, PASSWORD)) as page, \
            screen(browser, app_url, "/requests", login=(home.other_email, PASSWORD)) as other:
        press(page, role(page, "button", "Request a swap"))
        dialog = role(page, "dialog", "Request a swap")
        page.keyboard.type(ui_date(first))
        role(dialog, "textbox", "Last night").focus()
        page.keyboard.type(ui_date(last))
        press(page, dialog.get_by_role("radio", name=home.planning_name), "Space")
        press(page, role(dialog, "button", "Send request"))
        expect(dialog.get_by_role("alert")).to_contain_text(GIVER_COPY)
        assert home.log_count(SWAP_SENT) == 0
        press(page, dialog.get_by_role("radio", name=home.other_name), "Space")
        press(page, role(dialog, "button", "Send request"))
        expect(activity(page)).to_have_text(SENT_COPY)
        swaps = [s for s in list_all(home.planning, home.at("/swaps")) if s["state"] == "sent"]
        assert [s["nights"] for s in swaps] == [iv(first, 2)] and swaps[0]["toParent"] == "other"
        item = role(other, "list", "Waiting for you").get_by_role("listitem").first
        expect(item).to_contain_text(f"{fmt_day(first)} until {fmt_day(last)}", timeout=LIVE_MS + UI_SLACK_MS)
        expect(item).to_contain_text("Waiting for an answer")
        press(other, role(item, "button", "Accept"))
        expect(activity(other)).to_have_text("Swap accepted. The calendar now shows it.")
        assert want(home.planning.get(home.at(f"/swaps/{swaps[0]['id']}")), 200).json()["state"] == "accepted"
        bar = stage(page, first.year).locator(f'[data-date="{first}"]')
        expect(bar).to_have_attribute("data-owner", "other", timeout=LIVE_MS + UI_SLACK_MS)
        other.goto(f"{home.base}/calendar?year={first.year}")
        expect(stage(other, first.year).locator(f'[data-date="{last}"]')).to_have_attribute("data-owner", "other")
    assert home.night(first)["ruleId"] == f"swap:{swaps[0]['id']}"


def test_wf_swaps_withdraw_race(browser, app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail)
    swap, _ = send_swap(home, home.planning, free_run(home, "planning", 1), 1)
    with screen(browser, app_url, "/requests", login=(home.planning_email, PASSWORD)) as creator, \
            screen(browser, peer, "/requests", login=(home.other_email, PASSWORD)) as answerer:
        withdraws = hold(creator, "**/withdraw")
        accepts = hold(answerer, "**/accept")
        role(role(creator, "list", "Sent by you").get_by_role("listitem").first, "button", "Withdraw").click()
        role(role(answerer, "list", "Waiting for you").get_by_role("listitem").first, "button", "Accept").click()
        pump(creator, lambda: withdraws, "the Withdraw request reaching the network")
        pump(answerer, lambda: accepts, "the Accept request reaching the network")
        withdraws[0].fallback()
        accepts[0].fallback()

        def decided() -> str | None:
            creator.evaluate("0")
            answerer.evaluate("0")
            state = want(home.planning.get(home.at(f"/swaps/{swap['id']}")), 200).json()["state"]
            return None if state == "sent" else state

        final = eventually(decided, 15, "one of the racing answers winning")
        assert final in ("withdrawn", "accepted")
        winner, loser, copy = (creator, answerer, "Request withdrawn.") if final == "withdrawn" else (answerer, creator, "Swap accepted. The calendar now shows it.")
        expect(activity(winner)).to_have_text(copy)
        expect(activity(loser)).to_have_text(STALE)
    assert home.log_count(SWAP_WITHDRAWN) + home.log_count(SWAP_ACCEPTED) == 1


def test_focus_and_announcements(browser, app_url, mail):
    home = make_home(app_url, mail)
    first = free_run(home, "planning", 2)
    send_swap(home, home.planning, first, 1)
    send_swap(home, home.planning, first + timedelta(days=1), 1)
    for size in (DESKTOP, MOBILE):
        with screen(browser, app_url, "/requests", size=size, login=(home.planning_email, PASSWORD)) as page:
            nav = role(page, "navigation", "Household")
            expect(nav).to_be_visible()
            bar = nav.bounding_box()
            for _ in range(20):
                page.keyboard.press("Tab")
                covered = page.evaluate("""() => { const a = document.activeElement; if (!a || a === document.body) return false;
                    const r = a.getBoundingClientRect();
                    const x = r.left + r.width / 2, y = r.top + r.height / 2;
                    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
                    const hit = document.elementFromPoint(x, y);
                    return !(hit && a.contains(hit)); }""")
                assert not covered, f"focus hidden under a fixed bar at {size}"
    with screen(browser, app_url, "/requests", login=(home.planning_email, PASSWORD)) as page:
        region = activity(page)
        region.evaluate("e => { window.__writes = 0; new MutationObserver(() => window.__writes++).observe(e, {childList: true, characterData: true, subtree: true}); }")
        withdraw = role(page, "list", "Sent by you").get_by_role("button", name="Withdraw", exact=True)
        expect(withdraw).to_have_count(2)
        press(page, withdraw.first)
        expect(region).to_have_text("Request withdrawn.")
        expect(withdraw).to_have_count(1)
        focused = eventually(lambda: page.evaluate("(document.activeElement.getAttribute('role') || document.activeElement.tagName).toLowerCase()") in ("listitem", "li"),
                             5, "focus moving to the request's list item")
        assert focused
        writes = page.evaluate("window.__writes")
        press(page, withdraw.first)
        pump(page, lambda: page.evaluate("window.__writes") > writes, "the same outcome written to the Activity region again")
        expect(region).to_have_text("Request withdrawn.")
        assert page.evaluate("document.activeElement !== document.body")
        reads: list[str] = []
        page.on("request", lambda req: reads.append(req.url) if req.method == "GET" and "/api/" in req.url else None)
        make_cost(home, home.other)
        pump(page, lambda: reads, "the screen re-reading after a later stream entry", seconds=(LIVE_MS + UI_SLACK_MS) / 1000)
        page.evaluate("0")
        expect(region).to_have_text("Request withdrawn.")


def test_dates_and_ranges(browser, app_url, mail):
    for zone, tz, hhmm in ((PAGO_PAGO, FAR_EAST, "09:00"), (LORD_HOWE, PAGO_PAGO, "18:00")):
        home = make_home(app_url, mail, zone=zone, plan=lambda year, z=zone, t=hhmm: version(f"{year - 1}-01-01", zone=z, time_=t))
        first = free_run(home, "planning", 2)
        makeup = free_run(home, "other", 2, after=first + timedelta(days=2))
        with screen(browser, app_url, f"/calendar?year={first.year}", tz=tz, login=(home.planning_email, PASSWORD)) as page:
            role(page, "button", "Request a swap").click()
            dialog = role(page, "dialog", "Request a swap")
            fill(role(dialog, "textbox", "First night"), "31/02/2030")
            fill(role(dialog, "textbox", "Last night"), ui_date(first + timedelta(days=1)))
            dialog.get_by_role("radio", name=home.other_name).check()
            role(dialog, "button", "Send request").click()
            expect(field_error(dialog, REAL_DATE)).to_be_visible()
            fill(role(dialog, "textbox", "First night"), ui_date(first))
            fill(role(dialog, "textbox", "Make-up first night"), ui_date(makeup))
            fill(role(dialog, "textbox", "Make-up last night"), ui_date(makeup + timedelta(days=1)))
            role(dialog, "button", "Send request").click()
            expect(activity(page)).to_have_text(SENT_COPY)
            swap = list_all(home.planning, home.at("/swaps"), state="sent")[0]
            assert (swap["nights"], swap["makeupNights"]) == (iv(first, 2), iv(makeup, 2))
            page.goto(f"{home.base}/requests")
            item = role(page, "list", "Sent by you").get_by_role("listitem").first
            expect(item).to_contain_text(f"{fmt_day(first)} until {fmt_day(first + timedelta(days=1))}")
            expect(item).to_contain_text(f"Make-up {fmt_day(makeup)} until {fmt_day(makeup + timedelta(days=1))}")
            expect(item).to_contain_text(f"Answer by {when(swap['answerBy'], swap['answerZone'])}")


def test_overlapping_swaps(app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail)
    first = free_run(home, "planning", 2)
    drafts = [make_swap(home, api, first, 2) for api in (home.planning, home.other, home.planning, home.other)]
    calls = [(lambda api=api, r=r: api.post(home.at(f"/swaps/{r.json()['id']}/send"), etag=strong(r)))
             for api, r in zip((home.planning, home.other.at(peer), home.planning.at(peer), home.other), drafts)]
    answers = race(*calls)
    assert sorted(a.status_code for a in answers) == [200, 409, 409, 409], [a.text for a in answers]
    winner = next(a for a in answers if a.status_code == 200).json()["id"]
    for answer in answers:
        if answer.status_code == 409:
            assert problem(answer, 409, "swap_overlaps")["conflictingRequestId"] == winner
    assert home.log_count(SWAP_SENT) == 1
    assert sorted(s["state"] for s in list_all(home.planning, home.at("/swaps"))) == ["draft", "draft", "draft", "sent"]
    mine = free_run(home, "planning", 1)
    theirs = free_run(home, "other", 1)
    held, _ = send_swap(home, home.planning, mine, 1, makeup=iv(theirs, 1))
    rival = make_swap(home, home.other, theirs, 1, to="planning")
    assert problem(home.other.post(home.at(f"/swaps/{rival.json()['id']}/send"), etag=strong(rival)), 409, "swap_overlaps")["conflictingRequestId"] == held["id"]


def test_live_stream(app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail)
    stream = Stream(app_url, home.other.token, home.hid)
    resumed = None
    try:
        assert stream.opened.wait(HTTP_TIMEOUT) and stream.status == 200
        backlog = [e["seq"] for e in home.log()]
        eventually(lambda: stream.ids() == backlog, 5, "the stream replaying the log on connect")
        made = make_cost(home, home.planning.at(peer))
        eventually(lambda: len(stream.events) > len(backlog), LIVE_MS / 1000, "a peer commit reaching the stream")
        event = stream.events[-1]
        data = json.loads(event["data"])
        assert event["event"] == COST_DRAFTED == data["type"] and int(event["id"]) == data["seq"]
        assert data["subjectId"] == made.json()["id"] and data["actor"] == "planning"
        middle = stream.ids()[-1] - 2
        resumed = Stream(peer, home.other.token, home.hid, last=middle)
        expected = [e["seq"] for e in home.log() if e["seq"] > middle]
        eventually(lambda: resumed.ids() == expected, 5, "a resumed stream sending exactly the later entries")
        make_cost(home, home.other)
        eventually(lambda: len(resumed.ids()) == len(expected) + 1, LIVE_MS / 1000, "a new entry on the resumed stream")
        assert resumed.ids() == sorted(set(resumed.ids()))
        eventually(lambda: stream.comments >= 1, 20, "a stream comment at least every 15 seconds")
    finally:
        stream.close()
        if resumed:
            resumed.close()


def test_streams_end(app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail)
    token = token_of(app_url, home.other_email, PASSWORD)
    stream = Stream(app_url, token, home.hid)
    assert stream.opened.wait(HTTP_TIMEOUT) and stream.status == 200
    want(Api(peer, token).delete("/api/session"), 204)
    assert stream.closed.wait(LIVE_MS / 1000 + 1), "the stream must close when its session ends on another process"
    baseline = active_sessions()
    with ThreadPoolExecutor(20) as pool:
        list(pool.map(lambda _: open_and_abort(app_url, home.planning.token, home.hid), range(STREAM_ABORTS)))
    for _ in range(10):
        partial = Stream(app_url, home.planning.token, home.hid)
        eventually(lambda: partial.events, 5, "a stream's first entry")
        partial.close()
    eventually(lambda: active_sessions() <= baseline + EXTRA_SESSIONS, 5 + 5, "app sessions back near baseline after aborted streams")
    started = time.monotonic()
    want(Api(app_url).get("/api/health"), 200)
    assert time.monotonic() - started <= 1 + UI_SLACK_MS / 1000


def test_wf_swap_race_ui(browser, app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail)
    first = free_run(home, "planning", 2)
    make_swap(home, home.planning, first, 2)
    make_swap(home, home.other, first, 2)
    with screen(browser, app_url, "/requests", login=(home.planning_email, PASSWORD)) as one, \
            screen(browser, peer, "/requests", login=(home.other_email, PASSWORD)) as two:
        holds = [hold(one, "**/send"), hold(two, "**/send")]
        for page_ in (one, two):
            role(role(page_, "list", "Sent by you").get_by_role("listitem").first, "button", "Send").click()
        pump(one, lambda: holds[0], "one parent's Send on the network")
        pump(two, lambda: holds[1], "the other parent's Send on the network")
        holds[0][0].fallback()
        holds[1][0].fallback()
        pump(one, lambda: home.log_count(SWAP_SENT) == 1, "exactly one send committing")
        states = {s["createdBy"]: s for s in list_all(home.planning, home.at("/swaps"))}
        win_role = next(r for r, s in states.items() if s["state"] == "sent")
        winner, loser = (one, two) if win_role == "planning" else (two, one)
        expect(activity(winner)).to_have_text(SENT_COPY)
        expect(activity(loser)).to_have_text(OVERLAP_COPY)
        expect(role(loser, "list", "Waiting for you").get_by_role("listitem").first).to_contain_text(fmt_day(first), timeout=LIVE_MS + UI_SLACK_MS)
    assert home.log_count(SWAP_SENT) == 1
    loser_role = "other" if win_role == "planning" else "planning"
    loser_api = home.other if loser_role == "other" else home.planning
    draft = want(loser_api.get(home.at(f"/swaps/{states[loser_role]['id']}")), 200)
    key = idempotency_key()
    refused = loser_api.post(home.at(f"/swaps/{draft.json()['id']}/send"), etag=strong(draft), key=key)
    first_body = problem(refused, 409, "swap_overlaps")
    replay = loser_api.at(peer).post(home.at(f"/swaps/{draft.json()['id']}/send"), etag=strong(draft), key=key)
    assert problem(replay, 409, "swap_overlaps") == first_body and replay.headers[REPLAYED] == "true"
    key2 = idempotency_key()
    bad = {"nights": iv(first, 29), "makeupNights": None, "toParent": "other", "note": None}
    problem(loser_api.post(home.at("/swaps"), bad, key=key2), 422, "validation_failed")
    problem(loser_api.post(home.at("/swaps"), {**bad, "note": "changed"}, key=key2), 409, "idempotency_key_reused")


def test_wf_swap_race_stream(browser, app_url, mail):
    home = make_home(app_url, mail)
    baseline = active_sessions()
    with screen(browser, app_url, "/requests", login=(home.other_email, PASSWORD)) as page:
        expect(role(page, "navigation", "Household")).to_be_visible()
        page.context.set_offline(True)
        expect(page.get_by_text("Live updates paused. Reconnecting...", exact=True).first).to_be_visible()
        send_swap(home, home.planning, free_run(home, "planning", 1), 1)
        page.context.set_offline(False)
        items = role(page, "list", "Waiting for you").get_by_role("listitem")
        expect(items).to_have_count(1)
        expect(page.get_by_text("Live updates paused. Reconnecting...", exact=True)).to_have_count(0)
    eventually(lambda: active_sessions() <= baseline + EXTRA_SESSIONS, 5, "the closed tab's stream releasing its database work")
    want(Api(app_url).get("/api/health"), 200)


def test_answer_window(app_url, mail):
    home = make_home(app_url, mail)
    cost, _ = send_cost(home, home.planning)
    span = datetime.fromisoformat(cost["answerBy"]) - datetime.fromisoformat(cost["sentAt"])
    assert span.total_seconds() == ANSWER_DEFAULT_S and cost["answerZone"] == ST_JOHNS
    soon = free_run(home, "planning", 1, after=home.today() + timedelta(days=1))
    swap, _ = send_swap(home, home.planning, soon, 1)
    assert datetime.fromisoformat(swap["answerBy"]) <= local(soon, "17:00", ST_JOHNS)
    short = make_home(outage("APP_SHORT_URL"), mail)
    sent, tag = send_cost(short, short.planning)
    span = datetime.fromisoformat(sent["answerBy"]) - datetime.fromisoformat(sent["sentAt"])
    assert span.total_seconds() == ANSWER_SHORT_S
    path = short.at(f"/costs/{sent['id']}")
    eventually(lambda: short.planning.get(path).json()["state"] == "lapsed", PAST_WINDOW_S, "a read reporting lapsed after answerBy")
    for api, verb, body in ((short.other, "accept", {}), (short.other, "decline", {"reason": "Too late"}), (short.planning, "withdraw", {})):
        problem(api.post(f"{path}/{verb}", body, etag=tag), 409, "request_lapsed")


def test_sweeps_act_once(app_url, mail):
    short, peer = outage("APP_SHORT_URL"), outage("APP_SHORT_PEER_URL")
    home = make_home(short, mail)
    swap_first = free_run(home, "planning", 1)
    swap, _ = send_swap(home, home.planning.at(peer), swap_first, 1)
    cost, _ = send_cost(home, home.planning)
    assert swap["answerBy"] and cost["answerBy"]
    eventually(lambda: home.log_count(SWAP_LAPSED) == 1 and home.log_count(COST_LAPSED) == 1, PAST_WINDOW_S, "both requests lapsing once")
    log = home.log()
    for kind in (SWAP_REMINDED, COST_REMINDED, SWAP_LAPSED, COST_LAPSED):
        entries = [e for e in log if e["type"] == kind]
        assert len(entries) == 1 and entries[0]["actor"] == "system", (kind, entries)
    lapse = next(e for e in log if e["type"] == COST_LAPSED)
    late = datetime.fromisoformat(lapse["at"]) - datetime.fromisoformat(cost["answerBy"])
    assert 0 <= late.total_seconds() <= SWEEP_S + 1
    reminder, lapsed = f"Answer needed in {home.name}", f"A request lapsed in {home.name}"
    await_mail(mail, home.other_email, reminder, 2)
    for email in (home.planning_email, home.other_email):
        await_mail(mail, email, lapsed, 2)
    settled = mail.messages(settle=1.5)
    assert mail_count(settled, home.other_email, reminder) == 2 and mail_count(settled, home.planning_email, reminder) == 0
    assert mail_count(settled, home.planning_email, lapsed) == 2 and mail_count(settled, home.other_email, lapsed) == 2
    final = home.log()
    assert [e["seq"] for e in final] == list(range(1, len(final) + 1))


def test_device_clock(browser, app_url, mail):
    home = make_home(app_url, mail)
    for clock in (WRONG_CLOCK_FUTURE, WRONG_CLOCK_PAST):
        cost, _ = send_cost(home, home.planning)
        with screen(browser, app_url, "/requests", tz=FAR_TZ, clock=clock, login=(home.other_email, PASSWORD)) as page:
            item = role(page, "list", "Waiting for you").get_by_role("listitem").filter(has_text="Answer by").first
            expect(item).to_contain_text("Waiting for an answer")
            expect(item).to_contain_text(f"Answer by {when(cost['answerBy'], cost['answerZone'])}")
            role(item, "button", "Accept").click()
            expect(activity(page)).to_have_text("Reimbursement accepted.")
        assert want(home.other.get(home.at(f"/costs/{cost['id']}")), 200).json()["state"] == "accepted"


def test_wf_answer_window_lapse(browser, app_url, mail):
    short, peer = outage("APP_SHORT_URL"), outage("APP_SHORT_PEER_URL")
    home = make_home(short, mail)
    with screen(browser, peer, "/requests", clock=WRONG_CLOCK_PAST, block_stream=True, login=(home.other_email, PASSWORD)) as page:
        cost, tag = send_cost(home, home.planning)
        page.reload()
        item = role(page, "list", "Waiting for you").get_by_role("listitem").first
        deadline = when(cost["answerBy"], cost["answerZone"])
        expect(item).to_contain_text(f"Answer by {deadline}")
        role(item, "button", "Decline").click()
        dialog = role(page, "dialog", "Decline request")
        role(dialog, "button", "Decline").click()
        expect(field_error(dialog, "Give a reason in 1 to 200 characters.")).to_be_visible()
        role(dialog, "button", "Cancel").click()
        path = home.at(f"/costs/{cost['id']}")
        eventually(lambda: home.planning.get(path).json()["state"] == "lapsed", PAST_WINDOW_S, "the request lapsing on the server clock")
        accept = role(item, "button", "Accept")
        copy = f"This request lapsed at {deadline}."
        if accept.count():
            accept.click()
            expect(activity(page)).to_have_text(copy)
        else:
            expect(page.get_by_text(copy, exact=False).first).to_be_visible()
    problem(home.other.post(f"{path}/accept", etag=tag), 409, "request_lapsed")
    lapsed, reminder = f"A request lapsed in {home.name}", f"Answer needed in {home.name}"
    for email in (home.planning_email, home.other_email):
        await_mail(mail, email, lapsed)
    await_mail(mail, home.other_email, reminder)
    settled = mail.messages(settle=1.5)
    for email, subject in ((home.planning_email, lapsed), (home.other_email, lapsed), (home.other_email, reminder)):
        assert mail_count(settled, email, subject) == 1
    assert home.log_count(COST_LAPSED) == 1 and home.log_count(COST_ACCEPTED) == 0


def test_wf_answer_window_screens(browser, app_url, mail):
    short, peer = outage("APP_SHORT_URL"), outage("APP_SHORT_PEER_URL")
    home = make_home(short, mail)
    with screen(browser, short, "/requests", login=(home.planning_email, PASSWORD)) as one, \
            screen(browser, peer, "/requests", login=(home.other_email, PASSWORD)) as two:
        swap, tag = send_swap(home, home.planning, free_run(home, "planning", 1), 1)
        copy = f"This request lapsed at {when(swap['answerBy'], swap['answerZone'])}."
        for page_ in (one, two):
            expect(page_.get_by_text("Lapsed", exact=False).first).to_be_visible(timeout=PAST_WINDOW_S * 1000)
            expect(page_.get_by_text(copy, exact=False).first).to_be_visible()
    problem(home.other.post(home.at(f"/swaps/{swap['id']}/accept"), etag=tag), 409, "request_lapsed")
    assert home.log_count(SWAP_LAPSED) == 1


COST_CASES = {
    "zero": ("amountMinor", "0", "Enter the amount as whole minor units from 1 to 100000000000."),
    "too_big": ("amountMinor", "100000000001", "Enter the amount as whole minor units from 1 to 100000000000."),
    "exponent": ("amountMinor", "1e3", "Enter the amount as whole minor units from 1 to 100000000000."),
    "decimal": ("amountMinor", "1000.0", "Enter the amount as whole minor units from 1 to 100000000000."),
    "minus_zero": ("amountMinor", "-0", "Enter the amount as whole minor units from 1 to 100000000000."),
    "string": ("amountMinor", '"1000"', "Enter the amount as whole minor units from 1 to 100000000000."),
    "empty_description": ("description", '""', "Use 1 to 500 characters."),
    "category": ("category", '"toys"', None),
    "no_offset": ("incurredAt", '"2026-11-01T12:00:00"', "Enter an RFC 3339 instant with an offset and no fractional seconds."),
    "too_early": ("incurredAt", '"2000-01-05T12:00:00+11:00"', "Choose a date from the plan start to one year ahead."),
    "valid": (None, None, None),
}


@pytest.mark.parametrize("case", list(COST_CASES), ids=list(COST_CASES))
def test_log_cost(app_url, case):
    home = seed_home(app_url, "birch")
    field, literal, message = COST_CASES[case]
    description = person("logged")[0]
    body = cost_body(home, description, amount=LOGGED_MINOR, category="child_care", note=LOGGED_NOTE)
    if field is None:
        made = want(home.other.post(home.at("/costs"), body), 201).json()
        assert (made["description"], made["category"], made["amountMinor"], made["paidBy"], made["state"], made["note"]) == (description, "child_care", LOGGED_MINOR, "other", "draft", LOGGED_NOTE)
        assert sum(made["shares"].values()) == LOGGED_MINOR and made["custodyDay"] and made["versionId"]
        return
    payload = json.dumps({**body, field: "@@"}).replace('"@@"', literal).encode()
    refused = home.other.post(home.at("/costs"), raw=payload, headers={"Content-Type": "application/json"})
    problem(refused, 422, "validation_failed", field, message)
    assert not [c for c in list_all(home.other, home.at("/costs")) if c["description"] == description]


def test_largest_remainder(app_url):
    cedar, birch = seed_home(app_url, "cedar"), seed_home(app_url, "birch")
    when_ = rfc(local(cedar.today(), "12:00", PAGO_PAGO))
    for amount in (1, 2, 3, 7, ODD_MINOR, 123456, MAX_AMOUNT):
        quote_ = want(cedar.planning.post(cedar.at("/costs/quote"), {"amountMinor": amount, "incurredAt": when_}), 200).json()
        assert quote_["shares"] == hamilton(amount, CEDAR_SPLIT, "planning"), amount
        assert quote_["splitBp"] == CEDAR_SPLIT
    at = rfc(local(birch.today(), "12:00", LORD_HOWE))
    high, low = TIE_MINOR // 2 + 1, TIE_MINOR // 2
    assert want(birch.planning.post(birch.at("/costs/quote"), {"amountMinor": TIE_MINOR, "incurredAt": at}), 200).json()["shares"] == {"planning": high, "other": low}
    assert want(birch.other.post(birch.at("/costs/quote"), {"amountMinor": TIE_MINOR, "incurredAt": at}), 200).json()["shares"] == {"planning": low, "other": high}
    made = make_cost(cedar, cedar.planning, amount=ODD_MINOR)
    patched = want(cedar.other.patch(cedar.at(f"/costs/{made.json()['id']}"), {"agreedSplitBp": AGREED_UNEVEN}, etag=strong(made)), 200)
    expected = hamilton(ODD_MINOR, AGREED_UNEVEN, "planning")
    assert patched.json()["shares"] == expected and patched.json()["splitBp"] == AGREED_UNEVEN and patched.json()["owedMinor"] == expected["other"]


def test_live_cost_quote(browser, app_url):
    home = seed_home(app_url, "birch")

    def words(planning: int, other: int) -> str:
        return f"{home.planning_name} pays {money(planning, 3, 'KWD')}, {home.other_name} pays {money(other, 3, 'KWD')}"

    with screen(browser, app_url, "/costs", login=(home.planning_email, home.planning_password)) as page:
        dialog = fill_cost(page, person("quote")[0], "8,000", home.today())
        expect(role(dialog, "textbox", "Time")).to_have_value("12:00")
        split = role(dialog, "status", "Cost split")
        page.evaluate("window.__stayed = true")
        expect(split).to_have_text(words(4000, 4000), timeout=QUOTE_MS + UI_SLACK_MS)
        fill(role(dialog, "textbox", "Amount"), "0,003")
        expect(split).to_have_text(words(2, 1), timeout=QUOTE_MS + UI_SLACK_MS)
        reply = {"splitBp": HALF_SPLIT, "shares": {"planning": 1, "other": 2}, "versionId": "1", "custodyDay": str(home.today())}
        page.route("**/costs/quote", lambda route: route.fulfill(status=200, json=reply))
        fill(role(dialog, "textbox", "Time"), "13:00")
        expect(split).to_have_text(words(1, 2), timeout=QUOTE_MS + UI_SLACK_MS)
        assert page.evaluate("window.__stayed === true")


def test_cost_lifecycle(app_url, mail):
    home = make_home(app_url, mail)
    cost, tag = send_cost(home, home.planning, amount=500)
    path = home.at(f"/costs/{cost['id']}")
    problem(home.planning.post(f"{path}/accept", etag=tag), 403, "not_your_answer")
    problem(home.other.post(f"{path}/withdraw", etag=tag), 403, "not_your_request")
    problem(home.planning.post(f"{path}/settle", etag=tag), 409, "invalid_transition")
    problem(home.planning.post(f"{path}/lapse", etag=tag), 409, "invalid_transition")
    done = want(home.other.post(f"{path}/accept", etag=tag), 200)
    assert done.json()["state"] == "accepted" and done.json()["answeredAt"]
    problem(home.other.post(f"{path}/settle", etag=strong(done)), 403, "not_your_request")
    settled = want(home.planning.post(f"{path}/settle", etag=strong(done)), 200)
    assert settled.json()["state"] == "settled"
    problem(home.planning.post(f"{path}/settle", etag=strong(settled)), 409, "invalid_transition")
    declined, tag = send_cost(home, home.planning)
    assert want(home.other.post(home.at(f"/costs/{declined['id']}/decline"), {"reason": "No"}, etag=tag), 200).json()["state"] == "declined"
    pulled, tag = send_cost(home, home.other)
    assert want(home.other.post(home.at(f"/costs/{pulled['id']}/withdraw"), etag=tag), 200).json()["state"] == "withdrawn"
    draft = make_cost(home, home.planning)
    problem(home.other.delete(home.at(f"/costs/{draft.json()['id']}"), etag=strong(draft)), 403, "not_your_request")
    want(home.planning.delete(home.at(f"/costs/{draft.json()['id']}"), etag=strong(draft)), 204)
    problem(home.planning.get(home.at(f"/costs/{draft.json()['id']}")), 404, "not_found")
    assert home.log_count(COST_SETTLED) == 1 and home.log_count(COST_DELETED) == 1


def test_wf_costs_journey(browser, app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail)
    description = person("journey")[0]
    with screen(browser, app_url, "/costs", login=(home.other_email, PASSWORD)) as other, \
            screen(browser, peer, "/costs", login=(home.planning_email, PASSWORD)) as planning:
        held = hold(other, "**/costs/quote", lambda req: (req.post_data_json or {}).get("amountMinor") == EARLY_MINOR)
        dialog = fill_cost(other, description, EARLY_TYPED, home.today())
        pump(other, lambda: held, "a quote request for the first amount")
        fill(role(dialog, "textbox", "Amount"), LATEST_TYPED)
        latest = hamilton(LATEST_MINOR, PLAN_SPLIT, "other")
        words = f"{home.planning_name} pays {money(latest['planning'], 2, 'CAD')}, {home.other_name} pays {money(latest['other'], 2, 'CAD')}"
        split = role(dialog, "status", "Cost split")
        expect(split).to_have_text(words)
        release_late(other, held[0])
        expect(split).to_have_text(words)
        fill(role(dialog, "textbox", "Amount"), "1,234")
        role(dialog, "button", "Send request").click()
        expect(field_error(dialog, "Enter the amount using a decimal comma, with at most 2 decimal places.")).to_be_visible()
        assert home.log_count(COST_DRAFTED) == 0
        fill(role(dialog, "textbox", "Amount"), LATEST_TYPED)
        role(dialog, "button", "Send request").click()
        expect(activity(other)).to_have_text(SENT_COPY)
        cost = next(c for c in list_all(home.other, home.at("/costs")) if c["description"] == description)
        assert (cost["amountMinor"], cost["state"]) == (LATEST_MINOR, "sent")
        stale_tag = strong(want(home.other.get(home.at(f"/costs/{cost['id']}")), 200))
        share = f"Agreed share for {home.planning_name} (%)"
        patches = [hold(p, "**/costs/*", lambda req: req.method == "PATCH") for p in (other, planning)]
        for page_, value in ((other, AGREED_LOW), (planning, AGREED_HIGH)):
            row = ledger_row(page_, description)
            expect(row).to_be_visible()
            role(row, "button", "Edit split").click()
            box = role(page_, "dialog", "Edit split")
            fill(role(box, "textbox", share), value)
            role(box, "button", "Save split").click()
        pump(other, lambda: patches[0], "one parent's split PATCH")
        pump(planning, lambda: patches[1], "the other parent's split PATCH")
        patches[0][0].fallback()
        patches[1][0].fallback()
        pump(other, lambda: home.log_count("cost.edited") == 1, "one split edit committing")
        current = want(home.other.get(home.at(f"/costs/{cost['id']}")), 200)
        win_planning = current.json()["agreedSplitBp"]["planning"] == AGREED_HIGH_BP
        winner, loser = (planning, other) if win_planning else (other, planning)
        expect(activity(winner)).to_have_text("Split saved.")
        expect(activity(loser)).to_have_text(STALE)
        if role(loser, "dialog", "Edit split").count():
            role(role(loser, "dialog", "Edit split"), "button", "Cancel").click()
        problem(home.planning.post(home.at(f"/costs/{cost['id']}/accept"), etag=stale_tag), 412, "precondition_failed")
        planning.reload()
        role(ledger_row(planning, description), "button", "Accept").click()
        expect(activity(planning)).to_have_text("Reimbursement accepted.")
        problem(home.planning.post(home.at(f"/costs/{cost['id']}/accept"), etag=strong(current)), 412, "precondition_failed")
        accepted = want(home.other.get(home.at(f"/costs/{cost['id']}")), 200)
        problem(home.planning.post(home.at(f"/costs/{cost['id']}/settle"), etag=strong(accepted)), 403, "not_your_request")
        owed = accepted.json()["owedMinor"]
        assert accepted.json()["shares"] == hamilton(LATEST_MINOR, accepted.json()["agreedSplitBp"], "other")
        line = f"{home.planning_name} owes {home.other_name} {money(owed, 2, 'CAD')}"
        expect(role(other, "region", "Balance")).to_contain_text(line, timeout=LIVE_MS + UI_SLACK_MS)
        expect(role(planning, "region", "Balance")).to_contain_text(f"Your balance: {money(-owed, 2, 'CAD')}", timeout=LIVE_MS + UI_SLACK_MS)
        role(ledger_row(other, description), "button", "Settle").click()
        expect(activity(other)).to_have_text("Marked as settled.")
        for page_ in (other, planning):
            expect(ledger_row(page_, description)).to_contain_text("Settled", timeout=LIVE_MS + UI_SLACK_MS)
            expect(role(page_, "region", "Balance")).to_contain_text("All square.", timeout=LIVE_MS + UI_SLACK_MS)
    statement = want(home.planning.get(home.at("/statement")), 200)
    assert want(home.other.at(peer).post(home.at("/statement/rebuild")), 200).content == statement.content
    body = statement.json()
    assert body["balance"] is None and body["years"][0]["amountMinor"] == LATEST_MINOR and body["years"][0]["costs"] == 1


def test_wf_costs_one_press(browser, app_url):
    home = seed_home(app_url, "cedar")
    description = person("press")[0]
    with screen(browser, app_url, "/costs", login=(home.planning_email, home.planning_password)) as page:
        held = hold(page, "**/costs", lambda req: req.method == "POST")
        dialog = fill_cost(page, description, PRESS_TYPED, home.today())
        save = role(dialog, "button", "Save draft")
        save.focus()
        page.keyboard.press("Enter")
        pump(page, lambda: held, "the Save draft request on the network")
        pending = page.evaluate("document.activeElement.getAttribute('aria-disabled')")
        assert pending == "true", "a pending control reports aria-disabled and keeps focus"
        page.keyboard.press("Enter")
        held[0].fallback()
        expect(ledger_row(page, description)).to_be_visible()
    found = [c for c in list_all(home.planning, home.at("/costs")) if c["description"] == description]
    assert len(found) == 1 and found[0]["amountMinor"] == PRESS_MINOR
    assert len(held) == 1


def test_latest_quote_wins(browser, app_url):
    home = make_home(app_url, adopted=False, joined=False)
    year = home.today().year
    days = (date(year + 1, 1, 1) - date(year, 1, 1)).days
    save_draft(home, version(f"{year}-01-01"))
    with screen(browser, app_url, "/plan", login=(home.planning_email, PASSWORD)) as page:
        preview = role(page, "status", "Plan preview")
        expect(preview).to_contain_text("nights")
        held = hold(page, "**/plan/preview*", lambda req: (req.post_data_json or {}).get("base", {}).get("pattern") == "P")
        fill(role(page, "textbox", "Base pattern"), "P")
        pump(page, lambda: held, "a preview request for the older edit")
        fill(role(page, "textbox", "Base pattern"), "O")
        words = f"{home.planning_name}: 0 nights, {home.other_name}: {days} nights in {year}"
        expect(preview).to_have_text(words)
        release_late(page, held[0])
        expect(preview).to_have_text(words)
    birch = seed_home(app_url, "birch")
    with screen(browser, app_url, "/costs", login=(birch.other_email, birch.other_password)) as page:
        held = hold(page, "**/costs/quote", lambda req: (req.post_data_json or {}).get("amountMinor") == 2000)
        dialog = fill_cost(page, person("late")[0], "2,000", birch.today())
        pump(page, lambda: held, "a quote request for the older amount")
        fill(role(dialog, "textbox", "Amount"), "2.5")
        copy = "Enter the amount using a decimal comma, with at most 3 decimal places."
        split = role(dialog, "status", "Cost split")
        expect(split).to_have_text(copy)
        release_late(page, held[0])
        expect(split).to_have_text(copy)


def test_statement_projection(app_url, mail):
    maple = seed_home(app_url, "maple")
    seeded = want(maple.planning.get(maple.at("/statement")), 200)
    assert seeded.headers["etag"] == f'"{hashlib.sha256(seeded.content).hexdigest()}"'
    a, b = hamilton(4999, PLAN_SPLIT, "planning"), hamilton(12501, PLAN_SPLIT, "other")
    parsed = seeded.json()
    assert seeded.content == json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    assert parsed["balance"] == {"owedBy": "planning", "owedTo": "other", "minor": b["planning"]}
    assert parsed["years"] == [{"year": 2026, "costs": 2, "amountMinor": 4999 + 12501, "shares": {"planning": a["planning"] + b["planning"], "other": a["other"] + b["other"]}}]
    home = make_home(app_url, mail)
    assert want(home.planning.get(home.at("/statement")), 200).json()["balance"] is None
    cost, tag = send_cost(home, home.planning, amount=EARLY_MINOR)
    assert want(home.planning.get(home.at("/statement")), 200).json()["years"] == []
    accepted = want(home.other.post(home.at(f"/costs/{cost['id']}/accept"), etag=tag), 200)
    moved = want(home.planning.get(home.at("/statement")), 200)
    owed = hamilton(EARLY_MINOR, PLAN_SPLIT, "planning")["other"]
    assert moved.json()["balance"] == {"owedBy": "other", "owedTo": "planning", "minor": owed}
    before = len(home.log())
    for base in (app_url, outage("APP_PEER_URL")):
        assert want(home.other.at(base).post(home.at("/statement/rebuild")), 200).content == moved.content
    assert len(home.log()) == before
    want(home.planning.post(home.at(f"/costs/{cost['id']}/settle"), etag=strong(accepted)), 200)
    final = want(home.planning.get(home.at("/statement")), 200).json()
    assert final["balance"] is None and final["years"][0]["amountMinor"] == EARLY_MINOR


def test_custody_day(app_url, mail):
    home = make_home(app_url, mail)
    day = home.today() - timedelta(days=1)

    def quote_at(hhmm: str) -> str:
        return want(home.planning.post(home.at("/costs/quote"), {"amountMinor": 100, "incurredAt": rfc(local(day, hhmm, ST_JOHNS))}), 200).json()["custodyDay"]

    assert quote_at("16:59") == str(day - timedelta(days=1)) and quote_at("17:00") == str(day)
    year = home.today().year
    cost, tag = send_cost(home, home.planning, amount=900, day=date(year, 1, 1), hhmm="16:00")
    assert cost["custodyDay"] == f"{year - 1}-12-31"
    want(home.other.post(home.at(f"/costs/{cost['id']}/accept"), etag=tag), 200)
    assert [y["year"] for y in want(home.planning.get(home.at("/statement")), 200).json()["years"]] == [year - 1]


MONEY_CASES = {
    "cad": {"seed": "maple", "exp": 2, "row": "Swim lessons term", "row_minor": 12501, "typed": "1\u202f234,56", "minor": 123456, "bad": ["12,345", "12.50", "-5", "5 CAD"],
            "owes": ("Robin Okafor", "Sam Lindqvist", 7501)},
    "kwd": {"seed": "birch", "exp": 3, "row": "Piano lessons", "row_minor": 8000, "typed": "8,000", "minor": 8000, "bad": ["1,2345", "8.000"],
            "owes": ("Ari Moreno", "Kai Moreno", 4000)},
    "jpy": {"seed": "cedar", "exp": 0, "row": "Uniforms", "row_minor": 123456, "typed": "123 456", "minor": 123456, "bad": ["1,5", "1.5"],
            "owes": ("Tove Aalto", "Noor Haddad", 82308)},
}


@pytest.mark.parametrize("case", list(MONEY_CASES), ids=list(MONEY_CASES))
def test_money_by_currency(browser, app_url, case):
    spec = MONEY_CASES[case]
    home = seed_home(app_url, spec["seed"])
    code, exp = home.currency, spec["exp"]
    assert home.me()["household"]["currencyExponent"] == exp
    description = person("money")[0]
    with screen(browser, app_url, "/costs", login=(home.planning_email, home.planning_password)) as page:
        expect(ledger_row(page, spec["row"])).to_contain_text(money(spec["row_minor"], exp, code))
        owing, owed, minor = spec["owes"]
        expect(role(page, "region", "Balance")).to_contain_text(f"{owing} owes {owed} {money(minor, exp, code)}")
        dialog = fill_cost(page, description, spec["bad"][0], home.today())
        copy = f"Enter the amount using a decimal comma, with at most {exp} decimal places."
        for bad in spec["bad"]:
            fill(role(dialog, "textbox", "Amount"), bad)
            role(dialog, "button", "Save draft").click()
            expect(field_error(dialog, copy)).to_be_visible()
        fill(role(dialog, "textbox", "Amount"), spec["typed"])
        role(dialog, "button", "Save draft").click()
        expect(ledger_row(page, description)).to_contain_text(money(spec["minor"], exp, code))
    stored = next(c for c in list_all(home.planning, home.at("/costs")) if c["description"] == description)
    assert stored["amountMinor"] == spec["minor"] and isinstance(stored["amountMinor"], int)


def test_split_percentages(browser, app_url):
    cedar = seed_home(app_url, "cedar")
    with screen(browser, app_url, "/costs", login=(cedar.planning_email, cedar.planning_password)) as page:
        expect(ledger_row(page, "Uniforms")).to_contain_text(CELL_CEDAR)
    home = seed_home(app_url, "birch")
    made = make_cost(home, home.planning)
    description = made.json()["description"]
    with screen(browser, app_url, "/costs", login=(home.planning_email, home.planning_password)) as page:
        row = ledger_row(page, description)
        expect(row).to_contain_text(CELL_HALF)
        role(row, "button", "Edit split").click()
        dialog = role(page, "dialog", "Edit split")
        box = role(dialog, "textbox", f"Agreed share for {home.planning_name} (%)")
        for bad in ("101", "50.5", "50,555"):
            fill(box, bad)
            role(dialog, "button", "Save split").click()
            expect(field_error(dialog, "Enter a share from 0 to 100 with at most two decimals, using a comma.")).to_be_visible()
        fill(box, "50,5")
        role(dialog, "button", "Save split").click()
        expect(activity(page)).to_have_text("Split saved.")
        expect(row).to_contain_text(CELL_TIE)
    stored = want(home.planning.get(home.at(f"/costs/{made.json()['id']}")), 200).json()
    assert stored["agreedSplitBp"] == TIE_SPLIT_BP


def test_exact_numbers(app_url):
    home = seed_home(app_url, "birch")
    assert home.me()["household"]["id"] == "9007199254740995"
    seeded = want(home.planning.get(home.at("/costs/9007199254741012")), 200).json()
    assert seeded["id"] == "9007199254741012"
    made = make_cost(home, home.planning, amount=MAX_AMOUNT).json()
    assert made["amountMinor"] == MAX_AMOUNT and type(made["amountMinor"]) is int
    assert sum(made["shares"].values()) == MAX_AMOUNT and isinstance(made["id"], str) and made["id"].isdigit()
    for bad in ("abc", HUGE_ID, UNKNOWN_ID, "-1"):
        problem(home.planning.get(home.at(f"/costs/{bad}")), 404, "not_found")
    problem(home.planning.get(f"/api/households/{HUGE_ID}/log"), 404, "not_found")


def test_partial_cost_edits(browser, app_url, mail):
    home = make_home(app_url, mail)
    made = make_cost(home, home.planning, description=PARTIAL_DESC, amount=ODD_MINOR, note=PARTIAL_NOTE)
    path = home.at(f"/costs/{made.json()['id']}")
    edited = want(home.planning.patch(path, {"amountMinor": EDITED_MINOR}, etag=strong(made)), 200)
    assert (edited.json()["description"], edited.json()["note"], edited.json()["amountMinor"]) == (PARTIAL_DESC, PARTIAL_NOTE, EDITED_MINOR)
    assert strong(edited) != strong(made) and edited.json()["shares"] == hamilton(EDITED_MINOR, PLAN_SPLIT, "planning")
    problem(home.planning.patch(path, {"description": None}, etag=strong(edited)), 422, "validation_failed", "description", "Use 1 to 500 characters.")
    problem(home.other.patch(path, {"description": "Theirs"}, etag=strong(edited)), 403, "not_your_request")
    problem(home.other.patch(path, {"agreedSplitBp": {"planning": 1, "other": 1}}, etag=strong(edited)), 422, "validation_failed", "agreedSplitBp", SPLIT_COPY)
    split = want(home.other.patch(path, {"agreedSplitBp": AGREED_QUARTER}, etag=strong(edited)), 200)
    assert split.json()["shares"] == hamilton(EDITED_MINOR, AGREED_QUARTER, "planning") and strong(split) != strong(edited)
    assert home.log_count("cost.edited") == 2
    bodies: list[dict] = []
    with screen(browser, app_url, "/costs", login=(home.planning_email, PASSWORD)) as page:
        page.on("request", lambda req: bodies.append(req.post_data_json) if req.method == "PATCH" else None)
        row = ledger_row(page, PARTIAL_DESC)
        role(row, "button", "Edit split").click()
        role(role(page, "dialog", "Edit split"), "button", "Use plan split").click()
        pump(page, lambda: bodies, "the Use plan split PATCH")
        assert bodies[-1] == {"agreedSplitBp": None}
        expect(row).to_contain_text(CELL_PLAN)
        role(row, "button", "Edit draft").click()
        dialog = role(page, "dialog", "Log a cost")
        expect(role(dialog, "textbox", "Note")).to_have_value(PARTIAL_NOTE)
        fill(role(dialog, "textbox", "Note"), "")
        role(dialog, "button", "Save draft").click()
        pump(page, lambda: len(bodies) == 2, "the Edit draft PATCH")
        assert bodies[-1] == {"note": None}, "Save draft sends only changed fields, and an emptied box sends null"
        pump(page, lambda: want(home.planning.get(path), 200).json()["note"] is None, "the Edit draft PATCH committing")
    stored = want(home.planning.get(path), 200).json()
    assert stored["note"] is None and stored["agreedSplitBp"] is None and stored["splitBp"] == PLAN_SPLIT
    sent = want(home.planning.post(f"{path}/send", etag=strong(want(home.planning.get(path), 200))), 200)
    problem(home.planning.patch(path, {"description": "Late"}, etag=strong(sent)), 409, "invalid_transition")


def receipt_prefix(home: Home) -> str:
    return f"households/{home.hid}/receipts/"


def test_byte_exact_receipts(app_url, mail):
    home = make_home(app_url, mail)
    made = make_cost(home, home.planning)
    r = want(upload(home, home.planning, made.json()["id"], strong(made)), 201).json()
    assert r["contentType"] == "image/png" and r["bytes"] == len(PNG) and r["sha256"] == hashlib.sha256(PNG).hexdigest() and r["storedAt"]
    assert S3().get(f"{receipt_prefix(home)}{r['id']}") == PNG
    down = want(home.other.get(home.at(f"/costs/{made.json()['id']}/receipts/{r['id']}")), 200)
    assert down.content == PNG and home.log_count("receipt.stored") == 1
    assert [x["id"] for x in want(home.planning.get(home.at(f"/costs/{made.json()['id']}")), 200).json()["receipts"]] == [r["id"]]


def test_receipt_storage_outage(app_url, mail):
    down = outage("APP_MINIO_DOWN_URL")
    home = make_home(app_url, mail)
    made = make_cost(home, home.planning)
    key = idempotency_key()
    problem(upload(home, home.planning.at(down), made.json()["id"], strong(made), key=key), 503, "storage_unavailable")
    assert S3().keys(receipt_prefix(home)) == [] and home.log_count("receipt.stored") == 0
    current = want(home.planning.get(home.at(f"/costs/{made.json()['id']}")), 200)
    assert strong(current) == strong(made) and current.json()["receipts"] == []
    done = want(upload(home, home.planning, made.json()["id"], strong(made), key=key), 201)
    assert REPLAYED not in done.headers
    assert S3().keys(receipt_prefix(home)) == [f"{receipt_prefix(home)}{done.json()['id']}"]


def test_wf_receipts_journey(browser, app_url, mail):
    down = outage("APP_MINIO_DOWN_URL")
    home = make_home(app_url, mail)
    description = person("receipted")[0]
    made = make_cost(home, home.planning, description=description)
    cid, tag = made.json()["id"], strong(made)
    name = "reçu été.png"
    with screen(browser, down, "/costs", login=(home.planning_email, PASSWORD)) as page:
        attach(page, ledger_row(page, description), name, PNG)
        expect(activity(page)).to_have_text(STORAGE_SAVE)
        expect(role(page, "button", "Try again")).to_be_visible()
    assert S3().keys(receipt_prefix(home)) == []
    problem(upload(home, home.planning, cid, tag, data=b"not a receipt"), 422, "validation_failed", "receipt", "The file isn't a JPEG, PNG or PDF.")
    key = idempotency_key()
    problem(upload(home, home.planning.at(down), cid, tag, name=name, key=key), 503, "storage_unavailable")
    stored = want(upload(home, home.planning, cid, tag, name=name, key=key), 201).json()
    assert len(S3().keys(receipt_prefix(home))) == 1
    with screen(browser, app_url, "/costs", login=(home.other_email, PASSWORD)) as page:
        with page.expect_download() as download:
            role(ledger_row(page, description), "link", "Receipt 1").click()
        assert Path(download.value.path()).read_bytes() == PNG
        assert download.value.suggested_filename == name
    birch = seed_home(app_url, "birch")
    problem(birch.planning.get(birch.at(f"/costs/{cid}/receipts/{stored['id']}")), 404, "not_found")
    problem(birch.planning.get(home.at(f"/costs/{cid}/receipts/{stored['id']}")), 404, "not_found")
    current = strong(want(home.planning.get(home.at(f"/costs/{cid}")), 200))
    entries = len(home.log())
    with screen(browser, down, "/costs", login=(home.planning_email, PASSWORD)) as page:
        role(ledger_row(page, description), "button", "Delete draft").click()
        expect(activity(page)).to_have_text("Couldn't reach storage – nothing was deleted. Try again.")
    assert len(S3().keys(receipt_prefix(home))) == 1 and len(home.log()) == entries
    assert strong(want(home.planning.get(home.at(f"/costs/{cid}")), 200)) == current
    with screen(browser, app_url, "/costs", login=(home.planning_email, PASSWORD)) as page:
        role(ledger_row(page, description), "button", "Delete draft").click()
        expect(activity(page)).to_have_text("Draft deleted.")
    assert S3().keys(receipt_prefix(home)) == []
    problem(home.other.get(home.at(f"/costs/{cid}/receipts/{stored['id']}")), 404, "not_found")


def test_wf_receipts_file_limits(browser, app_url, mail):
    home = make_home(app_url, mail)
    description = person("bigfile")[0]
    make_cost(home, home.planning, description=description)
    posts: list[str] = []
    exact = PNG + b"x" * (RECEIPT_LIMIT - len(PNG))
    with screen(browser, app_url, "/costs", login=(home.planning_email, PASSWORD)) as page:
        page.on("request", lambda req: posts.append(req.url) if req.method == "POST" and "/receipts" in req.url else None)
        attach(page, ledger_row(page, description), "big.png", exact + b"x")
        expect(page.get_by_text("Receipts can be up to 5 MiB.", exact=True).first).to_be_visible()
        assert posts == []
        attach(page, ledger_row(page, description), "big.png", exact)
        expect(activity(page)).to_have_text("Receipt stored.", timeout=UPLOAD_MS)
    keys = S3().keys(receipt_prefix(home))
    assert len(keys) == 1 and S3().get(keys[0]) == exact


def test_delete_draft_receipts(app_url, mail):
    down = outage("APP_MINIO_DOWN_URL")
    home = make_home(app_url, mail)
    made = make_cost(home, home.planning)
    cid = made.json()["id"]
    receipt = want(upload(home, home.planning, cid, strong(made)), 201)
    tag = strong(want(home.planning.get(home.at(f"/costs/{cid}")), 200))
    problem(home.planning.at(down).delete(home.at(f"/costs/{cid}"), etag=tag), 503, "storage_unavailable")
    assert home.log_count(COST_DELETED) == 0 and len(S3().keys(receipt_prefix(home))) == 1
    assert strong(want(home.planning.get(home.at(f"/costs/{cid}")), 200)) == tag
    want(home.planning.delete(home.at(f"/costs/{cid}"), etag=tag), 204)
    assert S3().keys(receipt_prefix(home)) == [] and home.log_count(COST_DELETED) == 1
    problem(home.planning.get(home.at(f"/costs/{cid}/receipts/{receipt.json()['id']}")), 404, "not_found")
    problem(home.planning.get(home.at(f"/costs/{cid}")), 404, "not_found")
    kept = make_cost(home, home.planning)
    want(upload(home, home.planning, kept.json()["id"], strong(kept)), 201)
    tag = strong(want(home.planning.get(home.at(f"/costs/{kept.json()['id']}")), 200))
    sent = want(home.planning.post(home.at(f"/costs/{kept.json()['id']}/send"), etag=tag), 200)
    problem(home.planning.delete(home.at(f"/costs/{kept.json()['id']}"), etag=strong(sent)), 409, "invalid_transition")
    assert len(S3().keys(receipt_prefix(home))) == 1


def test_lost_upload_races(app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail)
    made = make_cost(home, home.planning)
    cid, tag = made.json()["id"], strong(made)
    calls = [(lambda api=(home.planning if i % 2 else home.planning.at(peer)): upload(home, api, cid, tag)) for i in range(8)]
    answers = race(*calls)
    assert sorted(a.status_code for a in answers) == [201] + [412] * 7, [a.status_code for a in answers]
    for answer in answers:
        if answer.status_code == 412:
            problem(answer, 412, "precondition_failed")
    winner = next(a for a in answers if a.status_code == 201).json()["id"]
    eventually(lambda: S3().keys(receipt_prefix(home)) == [f"{receipt_prefix(home)}{winner}"], OBJECT_SETTLE_S, "exactly one receipt object per row")
    assert home.log_count("receipt.stored") == 1


def test_receipt_file_contract(app_url, mail):
    home = make_home(app_url, mail)
    made = make_cost(home, home.planning)
    cid = made.json()["id"]

    def tag() -> str:
        return strong(want(home.planning.get(home.at(f"/costs/{cid}")), 200))

    for data, kind in ((JPEG, "image/jpeg"), (PDF, "application/pdf"), (PNG, "image/png")):
        answer = want(upload(home, home.planning, cid, tag(), data=data, name="misleading.txt", headers={"Content-Type": "text/plain"}), 201).json()
        assert answer["contentType"] == kind
    problem(upload(home, home.planning, cid, tag(), data=b"GIF89a junk", name="a.png", headers={"Content-Type": "image/png"}), 422, "validation_failed", "receipt", "The file isn't a JPEG, PNG or PDF.")
    problem(upload(home, home.planning, cid, tag(), data=PDF, name=""), 422, "validation_failed")
    problem(upload(home, home.planning, cid, tag(), data=PNG + b"x" * (RECEIPT_LIMIT + 1 - len(PNG))), 413, "payload_too_large")
    exact = want(upload(home, home.planning, cid, tag(), data=PNG + b"x" * (RECEIPT_LIMIT - len(PNG))), 201).json()
    assert exact["bytes"] == RECEIPT_LIMIT
    name = "été.pdf"
    last = want(upload(home, home.planning, cid, tag(), data=PDF, name=name), 201).json()
    problem(upload(home, home.planning, cid, tag(), data=PDF), 409, "receipt_limit")
    path = home.at(f"/costs/{cid}/receipts/{last['id']}")
    down = want(home.other.get(path), 200)
    assert down.headers["etag"] == f'"{hashlib.sha256(PDF).hexdigest()}"' and down.headers["content-type"].startswith("application/pdf")
    disposition = down.headers["content-disposition"]
    assert disposition.startswith("attachment") and disposition.isascii()
    assert re.search(r'(^|[;\s])filename="?[^";]+', disposition), disposition
    encoded = re.search(r"filename\*=[^']*''([^;\s]+)", disposition)
    assert encoded and unquote(encoded.group(1)) == name, disposition
    want(home.other.get(path, none_match=down.headers["etag"]), 304)


def test_effective_dated_amendments(app_url, mail):
    home = make_home(app_url, mail)
    today = home.today()
    old_sent, _ = send_cost(home, home.planning, amount=EARLY_MINOR)
    effective = today + timedelta(days=30)
    earlier = home.night(effective - timedelta(days=1))
    draft = save_draft(home, amendment(home, today, splitBp=AMENDED_SPLIT, base={"pattern": "O", "anchor": str(today)}))
    problem(home.planning.post(home.at("/plan/draft/adopt"), etag=strong(draft)), 422, "validation_failed", None, "An amendment must start after today.")
    changed_ = want(home.planning.put(home.at("/plan/draft"), amendment(home, effective, splitBp=AMENDED_SPLIT, base={"pattern": "O", "anchor": str(effective)}), etag=strong(draft)), 200)
    adopted = want(home.planning.post(home.at("/plan/draft/adopt"), etag=strong(changed_)), 200).json()
    assert adopted["number"] == 2 and adopted["status"] == "adopted"
    assert home.night(effective - timedelta(days=1)) == earlier
    assert home.night(effective)["owner"] == "other" and home.night(effective + timedelta(days=1))["owner"] == "other"
    kept = want(home.planning.get(home.at(f"/costs/{old_sent['id']}")), 200).json()
    assert kept["versionId"] == old_sent["versionId"] and kept["splitBp"] == PLAN_SPLIT
    later = want(home.planning.post(home.at("/costs/quote"), {"amountMinor": 100, "incurredAt": rfc(local(effective + timedelta(days=1), "18:00", ST_JOHNS))}), 200).json()
    assert later["versionId"] == adopted["id"] and later["splitBp"] == AMENDED_SPLIT
    assert [v["number"] for v in want(home.other.get(home.at("/plan")), 200).json()["versions"]] == [2, 1]


def test_today_plan_zone(app_url):
    east = make_home(app_url, zone=FAR_EAST, joined=False, plan=version("2026-01-01", zone=FAR_EAST))
    cedar = seed_home(app_url, "cedar")
    instant = server_now(east)
    east_today, west_today = east.today(), cedar.today()
    assert east_today == instant.astimezone(ZoneInfo(FAR_EAST)).date() and east_today > west_today
    assert west_today == instant.astimezone(ZoneInfo(PAGO_PAGO)).date()
    assert want(east.planning.get(east.at("/tonight")), 200).json()["date"] == str(east_today)
    draft = save_draft(east, amendment(east, east_today))
    problem(east.planning.post(east.at("/plan/draft/adopt"), etag=strong(draft)), 422, "validation_failed", None, "An amendment must start after today.")
    moved = want(east.planning.put(east.at("/plan/draft"), amendment(east, east_today + timedelta(days=1)), etag=strong(draft)), 200)
    want(east.planning.post(east.at("/plan/draft/adopt"), etag=strong(moved)), 200)
    limit = west_today + timedelta(days=366)
    want(cedar.planning.post(cedar.at("/costs"), cost_body(cedar, person("edge")[0], day=limit)), 201)
    problem(cedar.planning.post(cedar.at("/costs"), cost_body(cedar, person("edge")[0], day=limit + timedelta(days=1))), 422, "validation_failed", "incurredAt", "Choose a date from the plan start to one year ahead.")


def test_accept_rechecks_nights(app_url, mail):
    home = make_home(app_url, mail)
    first = free_run(home, "planning", 1)
    swap, tag = send_swap(home, home.planning, first, 1)
    adopt(home, amendment(home, first, base={"pattern": "O", "anchor": str(first)}))
    entries = len(home.log())
    problem(home.other.post(home.at(f"/swaps/{swap['id']}/accept"), etag=tag), 409, "swap_nights_changed")
    assert want(home.other.get(home.at(f"/swaps/{swap['id']}")), 200).json()["state"] == "sent" and len(home.log()) == entries
    assert home.night(first)["ruleId"] == "base"


def test_drafts_move(app_url, mail):
    home = make_home(app_url, mail)
    effective = home.today() + timedelta(days=30)
    moved = make_cost(home, home.planning, amount=ODD_MINOR, day=effective, hhmm="18:00")
    morning = make_cost(home, home.planning, amount=ODD_MINOR, day=effective, hhmm="09:00")
    adopted = adopt(home, amendment(home, effective, splitBp=AMENDED_SPLIT))
    after = want(home.planning.get(home.at(f"/costs/{moved.json()['id']}")), 200)
    assert after.json()["versionId"] == adopted["id"] and after.json()["shares"] == hamilton(ODD_MINOR, AMENDED_SPLIT, "planning")
    assert strong(after) != strong(moved)
    problem(home.planning.patch(home.at(f"/costs/{moved.json()['id']}"), {"description": "Old tag"}, etag=strong(moved)), 412, "precondition_failed")
    same = want(home.planning.get(home.at(f"/costs/{morning.json()['id']}")), 200)
    assert same.json()["versionId"] == morning.json()["versionId"] and same.json()["shares"] == morning.json()["shares"] and strong(same) == strong(morning)
    assert home.log_count("cost.edited") == 0 and home.log_count("plan.adopted") == 2


def test_wf_amendments_journey(browser, app_url, mail):
    home = make_home(app_url, mail)
    today = home.today()
    blocked = today + timedelta(days=20)
    effective = today + timedelta(days=40)
    sent, _ = send_cost(home, home.planning, amount=EARLY_MINOR, day=blocked, hhmm="18:00")
    moves = make_cost(home, home.planning, amount=ODD_MINOR, day=effective, hhmm="18:00")
    morning = make_cost(home, home.planning, amount=ODD_MINOR, day=effective, hhmm="09:00")
    with screen(browser, app_url, "/plan", login=(home.planning_email, PASSWORD)) as page:
        share = role(page, "textbox", f"Cost share for {home.planning_name} (%)")
        expect(share).to_be_visible()
        fill(role(page, "textbox", "Effective from"), ui_date(today))
        fill(share, "55")
        role(page, "button", "Save draft").click()
        expect(activity(page)).to_have_text("Draft saved.")
        role(page, "button", "Adopt plan").click()
        expect(field_error(page, "An amendment must start after today.")).to_be_visible()
        fill(role(page, "textbox", "Effective from"), ui_date(blocked))
        role(page, "button", "Save draft").click()
        expect(activity(page)).to_have_text("Draft saved.")
        role(page, "button", "Adopt plan").click()
        expect(activity(page)).to_have_text("Costs are already sent on or after that date. Choose a later date.")
        fill(role(page, "textbox", "Effective from"), ui_date(effective))
        role(page, "button", "Save draft").click()
        expect(activity(page)).to_have_text("Draft saved.")
        role(page, "button", "Adopt plan").click()
        expect(activity(page)).to_have_text(f"Amendment recorded. It applies from {fmt_day(effective)}.")
    await_mail(mail, home.other_email, f"Plan amendment recorded in {home.name}")
    assert want(home.planning.get(home.at(f"/costs/{moves.json()['id']}")), 200).json()["shares"] == hamilton(ODD_MINOR, AMENDED_SPLIT, "planning")
    kept = want(home.planning.get(home.at(f"/costs/{morning.json()['id']}")), 200).json()
    assert kept["splitBp"] == PLAN_SPLIT and kept["custodyDay"] == str(effective - timedelta(days=1))
    paths = [home.at(f"/years/{effective.year}"), home.at(f"/costs/{sent['id']}"), home.at(f"/costs/{moves.json()['id']}"), home.at("/plan")]
    before = [want(home.other.get(p), 200).content for p in paths]
    for _ in range(2):
        with app_copy() as copy:
            assert [want(home.other.at(copy.base).get(p), 200).content for p in paths] == before


def test_wf_amendments_accept_race(browser, app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail)
    for _ in range(3):
        first = free_run(home, "planning", 1)
        swap, tag = send_swap(home, home.planning, first, 1)
        draft = save_draft(home, amendment(home, first, base={"pattern": "O", "anchor": str(first)}))
        accept, adoption = race(lambda: home.other.at(peer).post(home.at(f"/swaps/{swap['id']}/accept"), etag=tag),
                                lambda: home.planning.post(home.at("/plan/draft/adopt"), etag=strong(draft)))
        want(adoption, 200)
        if accept.status_code == 200:
            log = home.log()
            accepted_seq = next(e["seq"] for e in log if e["type"] == SWAP_ACCEPTED and e["subjectId"] == swap["id"])
            assert accepted_seq < [e["seq"] for e in log if e["type"] == "plan.adopted"][-1]
        else:
            problem(accept, 409, "swap_nights_changed")
            assert want(home.other.get(home.at(f"/swaps/{swap['id']}")), 200).json()["state"] == "sent"
        restart = first + timedelta(days=1)
        adopt(home, amendment(home, restart, base={"pattern": ROTATION, "anchor": str(restart)}))
    first = free_run(home, "planning", 1)
    swap, _ = send_swap(home, home.planning, first, 1)
    with screen(browser, peer, "/requests", block_stream=True, login=(home.other_email, PASSWORD)) as page:
        item = role(page, "list", "Waiting for you").get_by_role("listitem").filter(has_text=fmt_day(first))
        expect(item).to_be_visible()
        adopt(home, amendment(home, first, base={"pattern": "O", "anchor": str(first)}))
        role(item, "button", "Accept").click()
        expect(activity(page)).to_have_text(MOVED_COPY)
    assert want(home.other.get(home.at(f"/swaps/{swap['id']}")), 200).json()["state"] == "sent"


def test_year_record_job(app_url, mail):
    home = make_home(app_url, mail)
    year = home.today().year
    digest = strong(want(home.planning.get(home.at(f"/years/{year}")), 200)).strip('"')
    problem(home.planning.post(home.at("/records"), {"year": YEAR_TOO_EARLY}), 422, "validation_failed", "year", "Choose a year from 2000 to 2100.")
    one, two = race(lambda: home.planning.post(home.at("/records"), {"year": year}), lambda: home.other.post(home.at("/records"), {"year": year}))
    winner = one if one.status_code == 202 else two
    want(winner, 202)
    record = winner.json()
    rid = record["id"]
    assert record["yearDigest"] == digest and record["state"] in ("requested", "rendering")
    loser = two if winner is one else one
    if loser.status_code == 409:
        assert problem(loser, 409, "record_in_progress")["recordId"] == rid
    key = f"households/{home.hid}/records/{rid}.pdf"
    steps = [0]

    def watch() -> dict | None:
        body = want(home.planning.get(home.at(f"/records/{rid}")), 200).json()
        assert body["stepsDone"] >= steps[-1], "stepsDone never decreases"
        steps.append(body["stepsDone"])
        if body["state"] != "stored":
            answer = home.planning.get(home.at(f"/records/{rid}/pdf"))
            if want(home.planning.get(home.at(f"/records/{rid}")), 200).json()["state"] != "stored":
                problem(answer, 409, "record_not_stored")
            return None
        return body

    final = eventually(watch, RECORD_S, "the year record reaching stored")
    data = S3().get(key)
    assert final["sha256"] == hashlib.sha256(data).hexdigest() and final["bytes"] == len(data) and final["stepsDone"] == 3
    assert final["yearDigest"] == digest and final["storedAt"]
    assert sum(1 for e in home.log() if e["type"] == "record.stored" and e["subjectId"] == rid) == 1
    problem(home.planning.post(home.at(f"/records/{rid}/cancel")), 409, "invalid_transition")
    problem(home.planning.post(home.at(f"/records/{rid}/retry")), 409, "invalid_transition")
    next_year = want(home.planning.post(home.at("/records"), {"year": year + 1}), 202).json()
    cancelled = home.planning.post(home.at(f"/records/{next_year['id']}/cancel"))
    if cancelled.status_code == 200:
        assert cancelled.json()["state"] == "cancelled"
        key = f"households/{home.hid}/records/{next_year['id']}.pdf"
        eventually(lambda: key not in S3().keys(f"households/{home.hid}/records/"), 5 + 5, "a cancelled record leaving no object")
    else:
        problem(cancelled, 409, "invalid_transition")


def test_year_record_pdf(app_url, mail):
    home = make_home(app_url, mail)
    first = free_run(home, "planning", 2)
    makeup = free_run(home, "other", 2, after=first + timedelta(days=2))
    swap, tag = send_swap(home, home.planning, first, 2, makeup=iv(makeup, 2))
    want(home.other.post(home.at(f"/swaps/{swap['id']}/accept"), etag=tag), 200)
    secret, description = person("secretnote")[0], person("paid")[0]
    cost, tag = send_cost(home, home.planning, description=description, amount=PDF_MINOR, day=first, hhmm="18:00", note=secret)
    accepted = want(home.other.post(home.at(f"/costs/{cost['id']}/accept"), etag=tag), 200).json()
    year = first.year
    doc = want(home.planning.get(home.at(f"/years/{year}")), 200)
    digest = strong(doc).strip('"')
    record = want(home.planning.post(home.at("/records"), {"year": year}), 202).json()
    final = record_final(home.planning, home, record["id"], "stored", "failed")
    assert final["state"] == "stored", final
    data = want(home.other.get(home.at(f"/records/{record['id']}/pdf")), 200)
    assert data.headers["content-type"].startswith("application/pdf")
    assert data.content == S3().get(f"households/{home.hid}/records/{record['id']}.pdf")
    assert pdf_pages(data.content) >= 1
    flat = re.sub(r"\s+", "", pdf_text(data.content))
    nights = doc.json()["nights"]
    shares = accepted["shares"]
    lines = [f"Twohouse year record {year}", home.name, f"Year digest {digest}",
             f"Nights: {home.planning_name} {nights['planning']}, {home.other_name} {nights['other']}",
             f"Swap {fmt_day(first)} to {fmt_day(first + timedelta(days=1))} with {home.other_name}",
             f"Make-up {fmt_day(makeup)} to {fmt_day(makeup + timedelta(days=1))} with {home.planning_name}",
             f"{fmt_day(d(accepted['custodyDay']))} {description} {money(PDF_MINOR, 2, 'CAD')} paid by {home.planning_name}: {home.planning_name} {money(shares['planning'], 2, 'CAD')}, {home.other_name} {money(shares['other'], 2, 'CAD')}"]
    for line in lines:
        assert re.sub(r"\s+", "", line) in flat, f"missing PDF line: {line}"
    assert secret not in flat


def test_polling_keeps_work(browser, app_url, mail):
    home = make_home(app_url, mail)
    year = home.today().year
    label = person("typed")[0]
    with screen(browser, app_url, "/records", login=(home.planning_email, PASSWORD)) as page:
        reads: list[str] = []
        page.on("request", lambda req: reads.append(req.url) if req.method == "GET" and req.url.split("?")[0].endswith("/records") else None)
        chooser = role(page, "combobox", "Year")
        select(chooser, str(year))
        handle = chooser.element_handle()
        role(page, "button", "Make year record").click()
        status = role(page, "status", "Record status")
        expect(status).to_have_text(pending_status())
        fill(role(page, "textbox", "Expires"), TYPED_EXPIRES)
        box = role(page, "textbox", "Label")
        box.focus()
        page.keyboard.type(label)
        page.keyboard.press("ArrowLeft")
        caret = box.evaluate("e => e.selectionStart")
        make_cost(home, home.other)
        expect(status).to_have_text(STATUS_STORED, timeout=RECORD_S * 1000)
        assert reads, "Records re-reads the records while one is in progress"
        expect(box).to_be_focused()
        expect(box).to_have_value(label)
        assert box.evaluate("e => e.selectionStart") == caret
        expect(role(page, "textbox", "Expires")).to_have_value(TYPED_EXPIRES)
        assert handle.evaluate("e => e.isConnected && e.selectedOptions[0].text") == str(year), "the Year control is never remounted"


DEAD_ADDRESS = "http://127.0.0.1:9"
STORAGE_DOWN = "Storage is down. Your record is waiting and will retry."
FAILED_WITHIN_S = 40


def fresh_database() -> str:
    url = urlsplit(os.environ["DATABASE_URL"])
    name = "twohouse_rec_" + os.urandom(4).hex()
    admin = urlunsplit((url.scheme, url.netloc, "/postgres", "", ""))
    made = subprocess.run(["psql", admin, "-v", "ON_ERROR_STOP=1", "-c", f"CREATE DATABASE {name}"],
                          capture_output=True, text=True, timeout=HTTP_TIMEOUT)
    assert made.returncode == 0, f"could not create a private database for the outage copy: {made.stderr}"
    return urlunsplit((url.scheme, url.netloc, f"/{name}", url.query, ""))


@contextmanager
def outage_copy(**env: str) -> Iterator[Any]:
    with app_copy(DATABASE_URL=fresh_database(), **env) as copy:
        yield copy


def wait_failed(home: Home, rid: str) -> tuple[dict, set[tuple[str, Any]]]:
    seen: set[tuple[str, Any]] = set()
    steps = [0]

    def check() -> dict | None:
        body = want(home.planning.get(home.at(f"/records/{rid}")), 200).json()
        assert body["state"] != "stored", f"a record with an unreachable service was reported stored: {body}"
        assert body["stepsDone"] >= steps[-1]
        steps.append(body["stepsDone"])
        seen.add((body["state"], body["waitingOn"]))
        return body if body["state"] == "failed" else None

    return eventually(check, FAILED_WITHIN_S, "the record reaching failed"), seen


def test_wf_year_record_outage(browser, mail):
    with outage_copy(GOTENBERG_URL=DEAD_ADDRESS) as copy:
        home = make_home(copy.base, mail)
        year = home.today().year
        before_keys = set(S3().keys("households/"))
        label = person("label")[0]
        with screen(browser, copy.base, "/records", login=(home.planning_email, PASSWORD)) as page:
            status = role(page, "status", "Record status")
            expect(status).to_have_text("No year records yet.")
            select(role(page, "combobox", "Year"), str(year))
            role(page, "button", "Make year record").click()
            expect(status).to_have_text(pending_status())
            rid = list_all(home.planning, home.at("/records"))[0]["id"]
            problem_body = problem(home.planning.post(home.at("/records"), {"year": year}), 409, "record_in_progress")
            assert problem_body["recordId"] == rid
            box = role(page, "textbox", "Label")
            box.focus()
            page.keyboard.type(label)
            expect(role(page, "region", "Year records").get_by_text(PDF_DOWN, exact=True).first).to_be_visible(timeout=FAILED_WITHIN_S * 1000)
            expect(box).to_have_value(label)
            expect(box).to_be_focused()
            final, seen = wait_failed(home, rid)
            assert ("requested", "renderer") in seen, seen
            assert final["failure"] == "renderer_unavailable" and final["attempts"] == 3 and final["waitingOn"] is not None or final["failure"] == "renderer_unavailable"
            assert final["attempts"] == 3 and final["state"] == "failed"
            assert set(S3().keys("households/")) - before_keys == set()
            expect(status).to_have_text(STATUS_FAILED)
            expect(role(page, "region", "Year records").get_by_role("button", name="Try again")).to_be_visible()
            expect(box).to_have_value(label)
            retried = want(home.planning.post(home.at(f"/records/{rid}/retry")), 202).json()
            assert retried["state"] == "requested" and retried["attempts"] == 0 and retried["stepsDone"] == final["stepsDone"]
            again, _ = wait_failed(home, rid)
            assert again["failure"] == "renderer_unavailable" and again["attempts"] == 3
            select(role(page, "combobox", "Year"), str(year + 1))
            role(page, "button", "Make year record").click()
            item = role(page, "list", "Year record list").get_by_role("listitem").filter(has_text=str(year + 1))
            expect(item).to_be_visible()
            role(item, "button", "Cancel record").click()
            expect(status).to_have_text("Year record cancelled.")
        cancelled = next(r for r in list_all(home.planning, home.at("/records")) if r["year"] == year + 1)
        assert cancelled["state"] == "cancelled"


def test_wf_year_record_storage_outage(browser, mail):
    with outage_copy(S3_ENDPOINT=DEAD_ADDRESS) as copy:
        home = make_home(copy.base, mail)
        year = home.today().year
        before_keys = set(S3().keys("households/"))
        with screen(browser, copy.base, "/records", login=(home.planning_email, PASSWORD)) as page:
            status = role(page, "status", "Record status")
            select(role(page, "combobox", "Year"), str(year))
            role(page, "button", "Make year record").click()
            expect(status).to_have_text(pending_status())
            rid = list_all(home.planning, home.at("/records"))[0]["id"]
            expect(role(page, "region", "Year records").get_by_text(STORAGE_DOWN, exact=True).first).to_be_visible(timeout=FAILED_WITHIN_S * 1000)
            final, seen = wait_failed(home, rid)
            assert ("requested", "storage") in seen, seen
            assert final["failure"] == "storage_unavailable" and final["attempts"] == 3
            assert final["stepsDone"] < 3 and final["storedAt"] is None
            problem(home.planning.get(home.at(f"/records/{rid}/pdf")), 409, "record_not_stored")
            assert set(S3().keys("households/")) - before_keys == set()
            expect(status).to_have_text(STATUS_FAILED)


def test_wf_year_record_working(browser, app_url, mail):
    home = make_home(app_url, mail)
    year = home.today().year + 1
    digest = strong(want(home.planning.get(home.at(f"/years/{year}")), 200)).strip('"')
    with screen(browser, app_url, "/records", login=(home.other_email, PASSWORD)) as page:
        with screen(browser, app_url, "/records", login=(home.planning_email, PASSWORD)) as planning:
            select(role(planning, "combobox", "Year"), str(year))
            role(planning, "button", "Make year record").click()
            expect(role(planning, "status", "Record status")).to_have_text(pending_status())
        record = list_all(home.other, home.at("/records"))[0]
        assert record["yearDigest"] == digest
        adopt(home, amendment(home, date(year, 6, 1), base={"pattern": "O", "anchor": f"{year}-06-01"}))
        assert strong(want(home.planning.get(home.at(f"/years/{year}")), 200)).strip('"') != digest
        expect(role(page, "status", "Record status")).to_have_text(STATUS_STORED, timeout=RECORD_S * 1000)
        final = want(home.other.get(home.at(f"/records/{record['id']}")), 200).json()
        assert (final["state"], final["yearDigest"]) == ("stored", digest)
        item = role(page, "list", "Year record list").get_by_role("listitem").first
        with page.expect_download() as download:
            role(item, "link", "Download PDF").click()
        data = Path(download.value.path()).read_bytes()
        assert data == S3().get(f"households/{home.hid}/records/{record['id']}.pdf")
        assert digest in re.sub(r"\s+", "", pdf_text(data))
    for email in (home.planning_email, home.other_email):
        await_mail(mail, email, f"Year record ready in {home.name}")
    with app_copy() as copy:
        stopped = want(home.planning.at(copy.base).post(home.at("/records"), {"year": year - 1}), 202).json()
        os.killpg(copy.proc.pid, 9)
    finished = record_final(home.planning, home, stopped["id"], "stored")
    assert finished["stepsDone"] == 3
    key = f"households/{home.hid}/records/{stopped['id']}.pdf"
    assert S3().keys(key) == [key]


def new_link(home: Home, days: int = 30, label: str | None = None) -> dict:
    return want(home.planning.post(home.at("/share-links"), {"label": label or person("link")[0], "expiresAt": rfc(local(home.today() + timedelta(days=days), "12:00", home.zone))}), 201).json()


def share_token(link: dict) -> str:
    return urlsplit(link["url"]).path.rsplit("/", 1)[1]


def test_read_only_share_links(app_url, mail):
    home = make_home(app_url, mail)
    link = new_link(home)
    token = share_token(link)
    assert link["url"] == f"{app_url.rstrip('/')}/share/{token}" and len(base64.urlsafe_b64decode(token + "=")) == 32
    anon = Api(app_url)
    live = want(anon.get(f"/api/share/{token}"), 200)
    assert live.headers["cache-control"] == "no-store"
    want(anon.call("HEAD", f"/api/share/{token}"), 200)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        refused = anon.call(method, f"/api/share/{token}", origin=None, key=None)
        problem(refused, 405, "read_only")
        assert refused.headers["allow"] == "GET, HEAD"
    unknown = want(anon.get(f"/api/share/{JUNK}"), 404)
    problem(unknown, 404, "not_found")
    problem(home.other.post(home.at("/share-links"), {"label": "No", "expiresAt": link["expiresAt"]}), 403, "planning_parent_only")
    problem(home.other.post(home.at(f"/share-links/{link['id']}/regenerate")), 403, "planning_parent_only")
    problem(home.other.delete(home.at(f"/share-links/{link['id']}")), 403, "planning_parent_only")
    now = server_now(home)
    for bad in (now - timedelta(minutes=1), now + timedelta(days=91)):
        problem(home.planning.post(home.at("/share-links"), {"label": "Bad", "expiresAt": rfc(bad)}), 422, "validation_failed", "expiresAt", "Choose a time in the next 90 days.")
    fresh = want(home.planning.post(home.at(f"/share-links/{link['id']}/regenerate")), 200).json()
    assert fresh["url"] != link["url"]
    dead = anon.get(f"/api/share/{token}")
    assert dead.status_code == 404 and dead.content == unknown.content
    assert anon.get(f"/api/share/{token}", params={"year": YEAR_TOO_EARLY}).content == unknown.content
    want(anon.get(f"/api/share/{share_token(fresh)}"), 200)
    want(home.planning.delete(home.at(f"/share-links/{link['id']}")), 200, 204)
    assert anon.get(f"/api/share/{share_token(fresh)}").content == unknown.content
    assert home.log_count("share_link.revoked") == 1 and home.log_count("share_link.regenerated") == 1


def test_share_contents(browser, app_url, mail):
    home = make_home(app_url, mail)
    secret_desc, secret_note = person("hiddencost")[0], person("hiddennote")[0]
    make_cost(home, home.planning, description=secret_desc, note=secret_note)
    first = free_run(home, "planning", 1)
    want(home.planning.post(home.at("/swaps"), {"nights": iv(first, 1), "makeupNights": None, "toParent": "other", "note": secret_note}), 201)
    link = new_link(home)
    year = home.today().year
    answer = want(Api(app_url).get(f"/api/share/{share_token(link)}", params={"year": year}), 200)
    body = answer.json()
    assert set(body) == {"householdName", "year", "yearDigest", "handovers"}
    doc = want(home.planning.get(home.at(f"/years/{year}")), 200)
    assert body["yearDigest"] == hashlib.sha256(doc.content).hexdigest()
    days = doc.json()["days"]
    expected = [x for x in days if x["exchangeAt"]]
    assert [h["date"] for h in body["handovers"]] == [x["date"] for x in expected]
    for row, day in zip(body["handovers"], expected):
        assert row["exchangeAt"] == day["exchangeAt"] and row["zone"] == day["exchangeZone"] and row["to"] == home.names[day["owner"]]
    assert secret_desc not in answer.text and secret_note not in answer.text
    problem(Api(app_url).get(f"/api/share/{share_token(link)}", params={"year": YEAR_TOO_EARLY}), 422, "validation_failed", "year", "Choose a year from 2000 to 2100.")
    with screen(browser, app_url, f"/share/{share_token(link)}?year={year}") as page:
        expect(role(page, "heading", f"{home.name}: handovers in {year}")).to_be_visible()
        expect(page.get_by_text(f"Year digest {body['yearDigest']}", exact=True).first).to_be_visible()
        row = body["handovers"][0]
        moment = datetime.fromisoformat(row["exchangeAt"])
        expect(role(page, "list", "Handovers")).to_contain_text(f"{fmt_day(d(row['date']))} {moment:%H:%M} ({row['zone']}): {row['from']} to {row['to']}")
        content = page.content()
        assert secret_desc not in content and secret_note not in content


def test_share_year_in_url(browser, app_url, mail):
    home = make_home(app_url, mail)
    token = share_token(new_link(home))
    year = home.today().year
    with screen(browser, app_url, "/") as page:
        for bad in ("", "?year=abc", f"?year={YEAR_TOO_EARLY}"):
            page.goto(f"{app_url.rstrip('/')}/start")
            length = page.evaluate("history.length")
            page.goto(f"{app_url.rstrip('/')}/share/{token}{bad}")
            expect(page).to_have_url(re.compile(rf"\?year={year}$"))
            expect(role(page, "heading", f"{home.name}: handovers in {year}")).to_be_visible()
            assert page.evaluate("history.length") == length + 1, "the replacement adds no history entry"
        role(page, "link", "Next year").click()
        expect(page).to_have_url(re.compile(rf"\?year={year + 1}$"))
        expect(role(page, "heading", f"{home.name}: handovers in {year + 1}")).to_be_visible()
        page.go_back()
        expect(role(page, "heading", f"{home.name}: handovers in {year}")).to_be_visible()
        page.go_forward()
        expect(role(page, "heading", f"{home.name}: handovers in {year + 1}")).to_be_visible()
        role(page, "link", "Previous year").click()
        expect(page).to_have_url(re.compile(rf"\?year={year}$"))
        page.goto(f"{app_url.rstrip('/')}/share/{token}?year=2000")
        expect(role(page, "link", "Next year")).to_be_visible()
        expect(role(page, "link", "Previous year")).to_have_count(0)
        page.goto(f"{app_url.rstrip('/')}/share/{token}?year=2100")
        expect(role(page, "link", "Previous year")).to_be_visible()
        expect(role(page, "link", "Next year")).to_have_count(0)


def test_share_rereads(browser, app_url, mail):
    home = make_home(app_url, mail)
    link = new_link(home)
    token = share_token(link)
    year = home.today().year
    reads: list[str] = []
    with screen(browser, app_url, f"/share/{token}?year={year}") as page:
        page.on("request", lambda req: reads.append(req.url) if f"/api/share/{token}" in req.url else None)
        expect(role(page, "list", "Handovers")).to_be_visible()
        role(page, "link", "Next year").click()
        expect(role(page, "heading", f"{home.name}: handovers in {year + 1}")).to_be_visible()
        assert len(reads) >= 1
        want(home.planning.delete(home.at(f"/share-links/{link['id']}")), 200, 204)
        page.go_back()
        expect(role(page, "heading", DEAD_HEADING)).to_be_visible()
        expect(role(page, "list", "Handovers")).to_have_count(0)
    east = timezone(timedelta(hours=14))
    expiry = (server_now(home) + timedelta(seconds=10)).astimezone(east)
    timed = want(home.planning.post(home.at("/share-links"), {"label": person("timed")[0], "expiresAt": rfc(expiry)}), 201).json()
    token = share_token(timed)
    with screen(browser, app_url, f"/share/{token}?year={year}", clock=WRONG_CLOCK_PAST) as page:
        expect(role(page, "list", "Handovers")).to_be_visible()
        eventually(lambda: Api(app_url).get(f"/api/share/{token}").status_code == 404, 30, "the link dying at its expiry on the server clock")
        role(page, "link", "Next year").click()
        expect(role(page, "heading", DEAD_HEADING)).to_be_visible()


def test_wf_share_links_journey(browser, app_url, mail):
    home = make_home(app_url, mail)
    year = home.today().year
    label = person("school")[0]
    expires = home.today() + timedelta(days=10)
    with screen(browser, app_url, "/records", login=(home.planning_email, PASSWORD)) as page, \
            screen(browser, app_url, "/records", login=(home.other_email, PASSWORD)) as other:
        region = role(page, "region", "Share links")
        fill(role(region, "textbox", "Label"), label)
        fill(role(region, "textbox", "Expires"), f"{ui_date(expires)} {EXPIRY_TIME}")
        role(region, "button", "Create share link").click()
        expect(activity(page)).to_have_text("Link created. Anyone with it can see handover times only.")
        link = list_all(home.planning, home.at("/share-links"))[0]
        assert datetime.fromisoformat(link["expiresAt"]) == local(expires, EXPIRY_TIME, ST_JOHNS)
        problem(home.other.post(home.at("/share-links"), {"label": "No", "expiresAt": link["expiresAt"]}), 403, "planning_parent_only")
        token = share_token(link)
        with screen(browser, app_url, f"/share/{token}") as school:
            expect(school).to_have_url(re.compile(rf"/share/{re.escape(token)}\?year={year}$"))
            doc = want(home.planning.get(home.at(f"/years/{year}")), 200)
            expect(school.get_by_text(f"Year digest {hashlib.sha256(doc.content).hexdigest()}", exact=True).first).to_be_visible()
            role(school, "link", "Next year").click()
            expect(role(school, "heading", f"{home.name}: handovers in {year + 1}")).to_be_visible()
            school.go_back()
            expect(role(school, "heading", f"{home.name}: handovers in {year}")).to_be_visible()
            problem(Api(app_url).post(f"/api/share/{token}", {}), 405, "read_only")
            role(region, "button", "Regenerate").click()
            expect(activity(page)).to_have_text("New link made. The old link no longer works.")
            school.reload()
            expect(role(school, "heading", DEAD_HEADING)).to_be_visible()
        fresh = list_all(home.planning, home.at("/share-links"))[0]
        assert fresh["url"] != link["url"]
        reads: list[str] = []
        other.on("request", lambda req: reads.append(req.url) if req.url.split("?")[0].endswith("/share-links") else None)
        role(region, "button", "Revoke").click()
        expect(activity(page)).to_have_text("Link revoked.")
        pump(other, lambda: reads, "the other parent's screen re-reading share links", seconds=(LIVE_MS + UI_SLACK_MS) / 1000)
        problem(Api(app_url).get(f"/api/share/{share_token(fresh)}"), 404, "not_found")


def test_wf_share_links_expiry(browser, app_url, mail):
    home = make_home(app_url, mail)
    year = home.today().year
    live = new_link(home)
    with screen(browser, app_url, f"/share/{share_token(live)}?year={year}", clock=WRONG_CLOCK_FUTURE) as page:
        expect(role(page, "list", "Handovers")).to_be_visible()
    moment = server_now(home) + timedelta(seconds=6)
    short = want(home.planning.post(home.at("/share-links"), {"label": person("s")[0], "expiresAt": rfc(moment)}), 201).json()
    token = share_token(short)
    eventually(lambda: Api(app_url).get(f"/api/share/{token}").status_code == 404, 30, "the link dead at its expiry")
    with screen(browser, app_url, f"/share/{token}?year={year}", clock=WRONG_CLOCK_PAST) as page:
        expect(role(page, "heading", DEAD_HEADING)).to_be_visible()
        expect(role(page, "list", "Handovers")).to_have_count(0)


def test_transactional_notices(app_url, mail):
    home = make_home(app_url, mail)
    secret = person("privatenote")[0]
    cost, tag = send_cost(home, home.planning, amount=NOTICE_MINOR, note=secret)
    message = await_mail(mail, home.other_email, f"Reimbursement request in {home.name}")[0]
    body = text(message)
    assert f"{home.name}: open Twohouse to see the details." in body and urlsplit(re.search(r"https?://\S+", body).group(0)).path == "/requests"
    assert secret not in body and str(NOTICE_MINOR) not in body and money(NOTICE_MINOR, 2, "CAD") not in body and home.planning_email not in body
    want(home.other.post(home.at(f"/costs/{cost['id']}/accept"), etag=tag), 200)
    await_mail(mail, home.planning_email, f"Your request was accepted in {home.name}")
    swap, tag = send_swap(home, home.planning, free_run(home, "planning", 1), 1)
    await_mail(mail, home.other_email, f"Swap request in {home.name}")
    want(home.other.post(home.at(f"/swaps/{swap['id']}/decline"), {"reason": "Busy"}, etag=tag), 200)
    await_mail(mail, home.planning_email, f"Your request was declined in {home.name}")
    notices = want(home.planning.get(home.at("/notices")), 200).json()
    assert notices["mail"] == "ok"
    sent = next(n for n in list_all(home.planning, home.at("/notices")) if n["subject"] == f"Reimbursement request in {home.name}")
    assert sent["kind"] == "request_sent" and sent["to"].lower() == home.other_email.lower()
    eventually(lambda: next(n for n in list_all(home.planning, home.at("/notices")) if n["id"] == sent["id"])["status"] == "sent", MAIL_S, "the notice marked sent")
    assert f"{sent['id']}@twohouse.local" in json.dumps(message)
    isolated = seed_home(outage("APP_MAIL_DOWN_ISOLATED_URL"), "cedar")
    before = {n["id"] for n in list_all(isolated.planning, isolated.at("/notices"))}
    send_cost(isolated, isolated.planning)

    def queued() -> dict | None:
        fresh = [n for n in list_all(isolated.planning, isolated.at("/notices")) if n["id"] not in before]
        return fresh[0] if fresh and fresh[0]["attempts"] >= 1 else None

    stuck = eventually(queued, MAIL_S, "a queued notice with a failed attempt while mail is down")
    assert stuck["status"] == "queued" and stuck["sentAt"] is None
    assert want(isolated.planning.get(isolated.at("/notices")), 200).json()["mail"] == "degraded"


def test_record_log(app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail)
    base = len(home.log())
    calls = [(lambda i=i: (home.planning if i % 2 else home.other.at(peer)).post(home.at("/costs"), cost_body(home, f"Log {i}"))) for i in range(10)]
    assert {a.status_code for a in race(*calls)} == {201}
    log = home.log()
    assert [e["seq"] for e in log] == list(range(1, len(log) + 1)) and len(log) == base + 10
    assert log[0]["type"] == "household.created" and log[0]["actor"] == "planning" and log[0]["at"]
    assert {e["actor"] for e in log[base:]} == {"planning", "other"}
    key = idempotency_key()
    body = cost_body(home, "Log once")
    want(home.planning.post(home.at("/costs"), body, key=key), 201)
    count = len(home.log())
    want(home.planning.post(home.at("/costs"), body, key=key), 201)
    problem(home.planning.post(home.at("/costs"), {**body, "amountMinor": 0}), 422, "validation_failed")
    problem(home.planning.post(home.at("/swaps"), {"nights": "bad", "makeupNights": None, "toParent": "other", "note": None}), 422, "validation_failed")
    assert len(home.log()) == count


def test_bounded_lists(app_url, mail):
    home = make_home(app_url, mail)
    for suffix in ("/swaps", "/costs", "/records", "/share-links", "/notices", "/log"):
        for bad in ("0", "101", "abc", "1.5", "1e1"):
            problem(home.planning.get(home.at(suffix), params={"limit": bad}), 422, "validation_failed", "limit", "Use a limit from 1 to 100.")
        problem(home.planning.get(home.at(suffix), params={"after": "!!junk!!"}), 422, "validation_failed", "after", "This cursor is not valid.")
        assert want(home.planning.get(home.at(suffix), params={"limit": 100}), 200).json()["next"] is None
    problem(home.planning.get(home.at("/log"), params={"after": "-1"}), 422, "validation_failed", "after", "This cursor is not valid.")
    problem(home.planning.get(home.at("/costs"), params={"state": "paid"}), 422, "validation_failed", "state")
    for _ in range(6):
        make_cost(home, home.planning)
    ids: list[str] = []
    query: dict[str, Any] = {"limit": 2}
    for _ in range(20):
        page_ = want(home.planning.get(home.at("/costs"), params=query), 200).json()
        ids += [c["id"] for c in page_["items"]]
        assert len(page_["items"]) <= 2
        if page_["next"] is None:
            break
        query["after"] = page_["next"]
        make_cost(home, home.other)
    else:
        pytest.fail("GET /costs kept returning next; expected null once the pages reached the end")
    assert len(ids) == len(set(ids)) and len(ids) >= 6
    seqs: list[int] = []
    after = 0
    for _ in range(50):
        page_ = want(home.planning.get(home.at("/log"), params={"after": after, "limit": 3}), 200).json()
        seqs += [e["seq"] for e in page_["items"]]
        if page_["next"] is None:
            break
        after = int(page_["next"])
        if len(seqs) < 9:
            make_cost(home, home.planning)
    else:
        pytest.fail("GET /log kept returning next; expected null once the pages reached the end")
    assert seqs == list(range(1, len(seqs) + 1))


def test_superseded_notices(app_url, mail):
    isolated = outage("APP_MAIL_DOWN_ISOLATED_URL")
    home = make_home(isolated, zone=ST_JOHNS, joined=False)
    first = want(home.planning.post(home.at("/invite")), 202).json()["noticeId"]
    second = want(home.planning.post(home.at("/invite")), 202).json()["noticeId"]
    notices = {n["id"]: n for n in list_all(home.planning, home.at("/notices"))}
    assert notices[first]["status"] == "superseded" and notices[second]["status"] == "queued"
    assert inbox(mail, home.other_email) == []
    cedar = seed_home(outage("APP_SHORT_MAILDOWN_URL"), "cedar")
    known = {n["id"] for n in list_all(cedar.planning, cedar.at("/notices"))}
    cost, tag = send_cost(cedar, cedar.planning)

    def reminder() -> dict | None:
        return next((n for n in list_all(cedar.planning, cedar.at("/notices")) if n["id"] not in known and n["kind"] == "reminder"), None)

    queued = eventually(reminder, ANSWER_SHORT_S - 2, "the reminder queued at its stored moment")
    assert queued["status"] == "queued"
    want(cedar.planning.post(cedar.at(f"/costs/{cost['id']}/withdraw"), etag=tag), 200)
    now = next(n for n in list_all(cedar.planning, cedar.at("/notices")) if n["id"] == queued["id"])
    assert now["status"] == "superseded" and now["sentAt"] is None


def test_wf_notices_isolated(browser, mail):
    base = outage("APP_MAIL_DOWN_ISOLATED_URL")
    home = seed_home(base, "maple")
    first = free_run(home, "planning", 2)
    with screen(browser, base, f"/calendar?year={first.year}", login=(home.planning_email, home.planning_password)) as page:
        role(page, "button", "Request a swap").click()
        dialog = role(page, "dialog", "Request a swap")
        fill(role(dialog, "textbox", "First night"), ui_date(first))
        fill(role(dialog, "textbox", "Last night"), ui_date(first))
        dialog.get_by_role("radio", name=home.other_name).check()
        role(dialog, "button", "Send request").click()
        expect(activity(page)).to_have_text(SENT_COPY)
        rival = make_swap(home, home.other, first, 1)
        entries = len(home.log())
        problem(home.other.post(home.at(f"/swaps/{rival.json()['id']}/send"), etag=strong(rival)), 409, "swap_overlaps")
        assert len(home.log()) == entries
        page.goto(f"{base}/records")
        table = role(page, "table", "Notices")
        expect(table).to_contain_text("Waiting to send")
        expect(page.get_by_text(MAIL_DOWN, exact=True).first).to_be_visible()
    fresh = make_home(base, joined=False)
    want(fresh.planning.post(fresh.at("/invite")), 202)
    want(fresh.planning.post(fresh.at("/invite")), 202)
    with screen(browser, base, "/records", login=(fresh.planning_email, PASSWORD)) as page:
        table = role(page, "table", "Notices")
        expect(table).to_contain_text("Replaced")
        expect(table).to_contain_text("Waiting to send")
    assert inbox(mail, fresh.other_email) == []


def test_wf_notices_shared(browser, app_url, mail):
    down = outage("APP_MAIL_DOWN_URL")
    home = make_home(app_url, mail)
    record = want(home.planning.at(down).post(home.at("/records"), {"year": home.today().year}), 202).json()
    record_final(home.planning, home, record["id"], "stored")
    subject = f"Year record ready in {home.name}"
    for email in (home.planning_email, home.other_email):
        await_mail(mail, email, subject)
    settled = mail.messages(settle=1.5)
    for email in (home.planning_email, home.other_email):
        assert mail_count(settled, email, subject) == 1
    for _ in range(14):
        make_cost(home, home.planning)
    with screen(browser, app_url, "/records", login=(home.other_email, PASSWORD)) as page:
        entries = role(page, "list", "Log entries").get_by_role("listitem")
        expect(entries).to_have_count(LOG_PAGE)
        more = role(page, "button", "Load more")
        for _ in range(5):
            if not more.count():
                break
            before = entries.count()
            more.click()
            expect(entries).not_to_have_count(before)
        total = len(home.log())
        expect(entries).to_have_count(total)
        make_cost(home, home.planning)
        expect(entries).to_have_count(total + 1, timeout=LIVE_MS + UI_SLACK_MS)
        texts = entries.all_inner_texts()
        seqs = [int(re.search(r"\d+", t).group(0)) for t in texts]
        assert seqs == list(range(1, total + 2)), seqs


def june_block(home: Home, year: int) -> date:
    days = {x["date"]: x["owner"] for x in home.doc(year)["days"]}
    return next(date(year, 6, n) for n in range(1, 30)
                if days[str(date(year, 6, n))] == "other" and days[str(date(year, 6, n) - timedelta(days=1))] == "planning")


def test_makeup_nights(app_url, mail):
    home = make_home(app_url, mail, plan=lambda now: edge_plan(now + 1, max_run=60))
    year = home.today().year + 1
    give, back = date(year, 12, 18), date(year + 1, 1, 8)
    body = {"nights": iv(give, 2), "toParent": "other", "note": None}
    field = "makeupNights"
    cases = ((iv(back, 3), "Make-up nights must match the number of nights swapped."),
             (iv(give + timedelta(days=1), 2), "Make-up nights can't overlap the nights swapped."),
             (iv(give + timedelta(days=371), 2), "Take make-up nights within one year."),
             (iv(give + timedelta(days=2), 2), "Every make-up night must be with the parent receiving the swap."))
    for makeup, message in cases:
        problem(home.planning.post(home.at("/swaps"), {**body, "makeupNights": makeup}), 422, "validation_failed", field, message)
    swap, tag = send_swap(home, home.planning, give, 2, makeup=iv(back, 2))
    assert swap["makeupNights"] == iv(back, 2) and home.night(give)["owner"] == "planning" and home.night(back)["owner"] == "other"
    done = want(home.other.post(home.at(f"/swaps/{swap['id']}/accept"), etag=tag), 200)
    assert done.json()["state"] == "accepted"
    for day, owner in ((give, "other"), (give + timedelta(days=1), "other"), (back, "planning"), (back + timedelta(days=1), "planning")):
        night = home.night(day)
        assert (night["owner"], night["ruleId"]) == (owner, f"swap:{swap['id']}"), day


def test_run_limit(app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail, plan=lambda now: edge_plan(now + 1))
    year = home.today().year + 1
    made = make_swap(home, home.planning, date(year + 1, 1, 1), 3)
    problem(home.planning.post(home.at(f"/swaps/{made.json()['id']}/send"), etag=strong(made)), 422, "validation_failed", "nights", RUN_COPY)
    fine = make_swap(home, home.planning, date(year + 1, 1, 1), 2)
    want(home.planning.post(home.at(f"/swaps/{fine.json()['id']}/send"), etag=strong(fine)), 200)
    natural = make_home(app_url, mail, plan=lambda now: version(f"{now - 1}-01-01", pattern=LONG_PATTERN, max_run=2))
    middle = free_run(natural, "other", MID_RUN_NIGHTS) + timedelta(days=MID_RUN_NIGHTS // 2)
    alone, alone_tag = send_swap(natural, natural.other, middle, 1, to="planning")
    want(natural.planning.post(natural.at(f"/swaps/{alone['id']}/accept"), etag=alone_tag), 200)
    block = june_block(home, year)
    late, tag_late = send_swap(home, home.planning, block + timedelta(days=7), 2)
    early, tag_early = send_swap(home, home.planning, block - timedelta(days=2), 2)
    answers = race(lambda: home.other.post(home.at(f"/swaps/{late['id']}/accept"), etag=tag_late),
                   lambda: home.other.at(peer).post(home.at(f"/swaps/{early['id']}/accept"), etag=tag_early))
    assert sorted(a.status_code for a in answers) == [200, 409], [a.text for a in answers]
    problem(next(a for a in answers if a.status_code == 409), 409, "swap_run_too_long")
    assert home.log_count(SWAP_ACCEPTED) == 1


def test_wf_makeup_nights_keyboard(browser, app_url, mail):
    home = make_home(app_url, mail, plan=lambda now: edge_plan(now + 1))
    year = home.today().year + 1
    give, back = date(year, 12, 18), date(year + 1, 1, 8)
    before = want(home.planning.get(home.at(f"/years/{year}")), 200).headers["etag"], want(home.planning.get(home.at(f"/years/{year + 1}")), 200).headers["etag"]

    with screen(browser, app_url, f"/calendar?year={year}", login=(home.planning_email, PASSWORD)) as page:
        def typed(label: str, value: str) -> None:
            role(dialog, "textbox", label).focus()
            page.keyboard.press("Control+A")
            page.keyboard.press("Delete")
            if value:
                page.keyboard.type(value)

        press(page, role(page, "button", "Previous month"), S_KEY)
        dialog = role(page, "dialog", "Request a swap")
        typed("First night", ui_date(give))
        typed("Last night", ui_date(give + timedelta(days=1)))
        typed("Make-up first night", ui_date(back))
        typed("Make-up last night", ui_date(back + timedelta(days=2)))
        press(page, dialog.get_by_role("radio", name=home.other_name), "Space")
        press(page, role(dialog, "button", "Send request"))
        expect(dialog.get_by_role("alert")).to_contain_text("Make-up nights must match the number of nights swapped.")
        typed("First night", ui_date(date(year + 1, 1, 1)))
        typed("Last night", ui_date(date(year + 1, 1, 3)))
        typed("Make-up first night", "")
        typed("Make-up last night", "")
        press(page, role(dialog, "button", "Send request"))
        expect(dialog.get_by_role("alert")).to_contain_text(RUN_COPY)
        assert home.log_count(SWAP_SENT) == 0
        typed("First night", ui_date(give))
        typed("Last night", ui_date(give + timedelta(days=1)))
        typed("Make-up first night", ui_date(back))
        typed("Make-up last night", ui_date(back + timedelta(days=1)))
        press(page, role(dialog, "button", "Send request"))
        expect(activity(page)).to_have_text(SENT_COPY)
    with screen(browser, app_url, "/requests", login=(home.other_email, PASSWORD)) as page:
        item = role(page, "list", "Waiting for you").get_by_role("listitem").first
        expect(item).to_contain_text(f"Make-up {fmt_day(back)} until {fmt_day(back + timedelta(days=1))}")
        press(page, role(item, "button", "Accept"))
        expect(activity(page)).to_have_text("Swap accepted. The calendar now shows it.")
    after = want(home.planning.get(home.at(f"/years/{year}")), 200).headers["etag"], want(home.planning.get(home.at(f"/years/{year + 1}")), 200).headers["etag"]
    assert after[0] != before[0] and after[1] != before[1]
    assert home.night(give)["owner"] == "other" and home.night(back)["owner"] == "planning"
    record = want(home.planning.post(home.at("/records"), {"year": year}), 202).json()
    assert record_final(home.planning, home, record["id"], "stored", "failed")["state"] == "stored"
    flat = re.sub(r"\s+", "", pdf_text(want(home.planning.get(home.at(f"/records/{record['id']}/pdf")), 200).content))
    for line in (f"Swap {fmt_day(give)} to {fmt_day(give + timedelta(days=1))} with {home.other_name}",
                 f"Make-up {fmt_day(back)} to {fmt_day(back + timedelta(days=1))} with {home.planning_name}"):
        assert re.sub(r"\s+", "", line) in flat, line


def test_wf_makeup_nights_amendment(browser, app_url, mail):
    peer = outage("APP_PEER_URL")
    home = make_home(app_url, mail, plan=lambda now: edge_plan(now + 1))
    year = home.today().year + 1
    block = june_block(home, year)
    late, _ = send_swap(home, home.planning, block + timedelta(days=7), 2)
    send_swap(home, home.planning, block - timedelta(days=2), 2)
    with screen(browser, app_url, "/requests", login=(home.other_email, PASSWORD)) as one, \
            screen(browser, peer, "/requests", login=(home.other_email, PASSWORD)) as two:
        holds = [hold(one, "**/accept"), hold(two, "**/accept")]
        role(role(one, "list", "Waiting for you").get_by_role("listitem").filter(has_text=fmt_day(block + timedelta(days=7))), "button", "Accept").click()
        role(role(two, "list", "Waiting for you").get_by_role("listitem").filter(has_text=fmt_day(block - timedelta(days=2))), "button", "Accept").click()
        pump(one, lambda: holds[0], "the first Accept on the network")
        pump(two, lambda: holds[1], "the second Accept on the network")
        holds[0][0].fallback()
        holds[1][0].fallback()
        pump(one, lambda: home.log_count(SWAP_ACCEPTED) == 1, "exactly one accept committing")
        state = want(home.other.get(home.at(f"/swaps/{late['id']}")), 200).json()["state"]
        loser = two if state == "accepted" else one
        expect(activity(loser)).to_have_text(RUN_COPY)
    days = {x["date"]: x["owner"] for x in home.doc(year)["days"]}

    def pair(owner: str, start: date) -> date:
        return next(start + timedelta(days=i) for i in range(28)
                    if days[str(start + timedelta(days=i))] == owner and days[str(start + timedelta(days=i + 1))] == owner)

    give = pair("planning", date(year, 9, 1))
    back = pair("other", give + timedelta(days=1))
    swap, tag = send_swap(home, home.planning, give, 2, makeup=iv(back, 2))
    with screen(browser, app_url, "/requests", block_stream=True, login=(home.other_email, PASSWORD)) as page:
        item = role(page, "list", "Waiting for you").get_by_role("listitem").filter(has_text=fmt_day(give))
        expect(item).to_be_visible()
        adopt(home, amendment(home, back + timedelta(days=1), base={"pattern": "P", "anchor": str(back + timedelta(days=1))}))
        assert home.night(give)["owner"] == "planning" and home.night(back + timedelta(days=1))["owner"] == "planning"
        role(item, "button", "Accept").click()
        expect(activity(page)).to_have_text(MOVED_COPY)
    problem(home.other.post(home.at(f"/swaps/{swap['id']}/accept"), etag=tag), 409, "swap_nights_changed")
    assert want(home.other.get(home.at(f"/swaps/{swap['id']}")), 200).json()["state"] == "sent"


def test_wf_cross_cutting_problems(browser, app_url, mail):
    maple = seed_home(app_url, "maple")
    api, anon = maple.other, Api(app_url)
    costs = maple.at("/costs")
    foreign = f"/api/households/{SEEDS['birch']['hid']}/costs"
    problem(anon.get(UNKNOWN_ROUTE), 404, "not_found")
    json_head = {"Content-Type": "application/json"}
    problem(anon.post("/api/session", raw=b"{" + b" " * JSON_LIMIT, headers={"Content-Type": "text/plain"}), 413, "payload_too_large")
    problem(anon.post("/api/session", raw=b"{}", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    problem(anon.post("/api/session", raw=b"{", headers=json_head), 400, "malformed_json")
    problem(anon.post("/api/session", raw=b'{"email":"a","email":"b"}', headers=json_head), 400, "malformed_json")
    problem(anon.post(f"/api/share/{JUNK}", origin=None, key=None), 405, "read_only")
    problem(anon.post(costs, {}, origin=None), 403, "origin_mismatch")
    problem(anon.post(costs, {}), 401, "unauthenticated")
    problem(api.post(costs, []), 422, "validation_failed")
    problem(api.post(costs, {NOPE_FIELD: 1}), 422, "validation_failed", NOPE_FIELD, "This field is not accepted.")
    problem(api.post(foreign, {NOPE_FIELD: 1}), 422, "validation_failed", NOPE_FIELD, "This field is not accepted.")
    problem(api.post(foreign, {"description": "x"}), 404, "not_found")
    drafted = make_home(app_url, mail)
    save_draft(drafted, amendment(drafted, drafted.today() + timedelta(days=40)))
    problem(drafted.other.post(drafted.at("/plan/draft/adopt")), 403, "planning_parent_only")
    problem(drafted.planning.post(drafted.at("/plan/draft/adopt")), 428, "precondition_required")
    with screen(browser, app_url, UNKNOWN_PAGE) as page:
        expect(role(page, "heading", "We couldn't find that page.")).to_be_visible()
    assert httpx.get(f"{app_url.rstrip('/')}{UNKNOWN_PAGE}", timeout=HTTP_TIMEOUT).status_code == 404


def test_household_isolation(app_url):
    maple, birch = seed_home(app_url, "maple"), seed_home(app_url, "birch")
    intruder = birch.planning
    for suffix in ("", "/plan", "/years/2027", "/tonight", "/swaps", "/swaps/9007199254741031", "/costs", "/costs/9007199254741021",
                   "/statement", "/records", "/share-links", "/notices", "/log", "/events"):
        problem(intruder.get(maple.at(suffix)), 404, "not_found")
    entries = len(maple.log())
    problem(intruder.post(maple.at("/invite")), 404, "not_found")
    problem(intruder.post(maple.at("/costs"), cost_body(birch, "Intruder")), 404, "not_found")
    problem(intruder.post(maple.at("/records"), {"year": 2027}), 404, "not_found")
    problem(intruder.post(maple.at("/statement/rebuild")), 404, "not_found")
    problem(intruder.delete(maple.at("/costs/9007199254741021"), etag=STALE_TAG), 404, "not_found")
    problem(intruder.get(birch.at("/costs/9007199254741021")), 404, "not_found")
    problem(intruder.get(birch.at("/swaps/9007199254741031")), 404, "not_found")
    assert len(maple.log()) == entries


HYGIENE_CASES = {
    "c0": ("description", "bad\u0001text", "Remove hidden or control characters."),
    "c1": ("description", "bad\u0085text", "Remove hidden or control characters."),
    "zero_width": ("description", "bad\u200btext", "Remove hidden or control characters."),
    "bidi": ("description", "bad\u202etext", "Remove hidden or control characters."),
    "bom": ("description", "bad\ufefftext", "Remove hidden or control characters."),
    "final_line_feed": ("description", "ends\n", "Remove hidden or control characters."),
    "too_many_graphemes": ("description", "e\u0301" * 501, "Use 1 to 500 characters."),
    "inner_line_feed": ("description", "two\nlines", None),
    "grapheme_limit": ("description", "e\u0301" * 500, None),
    "flag_limit": ("description", "\U0001F1EB\U0001F1F7" * 500, None),
    "builtin_value": ("description", "constructor", None),
    "untrimmed": ("description", "  spaced  ", None),
}


HYGIENE_IDS = ["c0", "c1", "zero_width", "bidi", "bom", "final_line_feed", "too_many_graphemes", "inner_line_feed", "grapheme_limit", "flag_limit", "builtin_value", "untrimmed"]


@pytest.mark.parametrize("case", HYGIENE_IDS, ids=HYGIENE_IDS)
def test_input_hygiene(app_url, case):
    home = seed_home(app_url, "birch")
    field, value, message = HYGIENE_CASES[case]
    body = cost_body(home, "x")
    body[field] = value
    answer = home.other.post(home.at("/costs"), body)
    if message:
        problem(answer, 422, "validation_failed", field, message)
    else:
        assert want(answer, 201).json()[field] == unicodedata.normalize("NFC", value)
    problem(home.other.post(home.at("/costs"), raw=b'{"__proto__":{"x":1}}', headers={"Content-Type": "application/json"}), 422, "validation_failed", "__proto__", "This field is not accepted.")


def test_server_boundary(app_url):
    api = Api(app_url)
    body = {"email": person("boundary")[1], "password": PASSWORD}
    problem(api.post("/api/session", body, origin=None), 403, "origin_mismatch")
    refused = api.post("/api/session", body, origin=FOREIGN_ORIGIN)
    problem(refused, 403, "origin_mismatch")
    assert not [h for h in refused.headers if h.lower().startswith(CORS_PREFIX)]
    payload = json.dumps(body).encode()
    exact = payload + b" " * (JSON_LIMIT - len(payload))
    problem(api.post("/api/session", raw=exact, headers={"Content-Type": "application/json"}), 401, "invalid_credentials")
    problem(api.post("/api/session", raw=exact + b" ", headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    for path in ("/run.json", "/package.json", "/.env", "/src/server.ts", "/server.js.map"):
        answer = httpx.get(app_url.rstrip("/") + path, timeout=HTTP_TIMEOUT)
        assert answer.status_code == 404, path
        assert "run-manifest-v1" not in answer.text
    home_page = httpx.get(app_url.rstrip("/") + "/", timeout=HTTP_TIMEOUT)
    assets = set(re.findall(r'(?:src|href)="(/[^"]+)"', home_page.text))
    served = home_page.text + "".join(httpx.get(app_url.rstrip("/") + a, timeout=HTTP_TIMEOUT).text for a in assets)
    for name in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID"):
        secret = os.environ.get(name)
        if secret:
            assert secret not in served, f"{name} value reached the browser"


def test_wf_cross_cutting_layouts(browser, app_url, mail):
    home = make_home(app_url, mail)
    send_swap(home, home.planning, free_run(home, "planning", 1), 1)
    send_swap(home, home.other, free_run(home, "planning", 1), 1)
    make_cost(home, home.planning)
    links = ["Calendar", "Plan", "Requests", "Costs", "Records"]
    for size in VIEWPORTS:
        wide = size == DESKTOP
        with screen(browser, app_url, "/", size=size) as page:
            layout(page)
            page.goto(f"{app_url.rstrip('/')}/start")
            layout(page)
            sign_in(page, app_url, home.planning_email, PASSWORD)
            for path in ("/calendar", "/plan", "/requests", "/costs", "/records"):
                page.goto(app_url.rstrip("/") + path)
                nav = role(page, "navigation", "Household")
                expect(nav).to_be_visible()
                layout(page)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                boxes = [nav.get_by_role("link", name=name).first.bounding_box() for name in links]
                assert [b["x"] for b in boxes] == sorted(b["x"] for b in boxes)
                assert all(b["height"] >= TARGET_PX for b in boxes)
                bar = nav.bounding_box()
                if size == MOBILE:
                    assert abs(bar["y"] + bar["height"] - size[1]) <= 2
                    assert max(b["width"] for b in boxes) - min(b["width"] for b in boxes) <= 2
                else:
                    assert bar["y"] <= 2
            page.goto(f"{app_url.rstrip('/')}/plan")
            order = role(page, "listbox", "Rule order")
            expect(order).to_be_attached()
            rule_box, editor, preview, versions = (order.bounding_box(), role(page, "region", "Rule editor").bounding_box(),
                                                   role(page, "status", "Plan preview").bounding_box(), role(page, "list", "Versions").bounding_box())
            if size == MOBILE:
                assert rule_box["y"] < editor["y"] < preview["y"] < versions["y"]
            elif size == TABLET:
                assert rule_box["x"] < editor["x"] and rule_box["y"] < editor["y"] + editor["height"] and editor["y"] < rule_box["y"] + rule_box["height"]
                assert editor["y"] < preview["y"] < versions["y"]
            else:
                assert rule_box["x"] < editor["x"] < preview["x"] and preview["y"] < versions["y"]
            page.goto(f"{app_url.rstrip('/')}/requests")
            waiting, sent = role(page, "list", "Waiting for you"), role(page, "list", "Sent by you")
            expect(waiting.get_by_role("listitem").first).to_be_visible()
            expect(sent.get_by_role("listitem").first).to_be_visible()
            w, s = waiting.bounding_box(), sent.bounding_box()
            if wide:
                assert w["x"] < s["x"] and abs(w["width"] - s["width"]) <= 4
            else:
                assert w["y"] < s["y"]
            page.goto(f"{app_url.rstrip('/')}/records")
            boxes = {n: role(page, "region", n).bounding_box() for n in ("Year records", "Share links", "Notices", "Record log")}
            if wide:
                assert boxes["Year records"]["y"] < boxes["Share links"]["y"] and boxes["Notices"]["y"] < boxes["Record log"]["y"]
                assert boxes["Year records"]["x"] < boxes["Notices"]["x"]
            else:
                ys = [boxes[n]["y"] for n in ("Year records", "Share links", "Notices", "Record log")]
                assert ys == sorted(ys)
            page.goto(f"{app_url.rstrip('/')}/costs")
            table = role(page, "table", "Cost ledger")
            expect(table).to_be_visible()
            balance, button, ledger = role(page, "region", "Balance").bounding_box(), role(page, "button", "Log a cost").bounding_box(), table.bounding_box()
            if size == MOBILE:
                assert button["y"] < ledger["y"] < balance["y"]
            elif size == TABLET:
                assert balance["y"] < button["y"] < ledger["y"]
                overflow = table.evaluate("""t => { for (let n = t; n && n !== document.body; n = n.parentElement) {
                    const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; }""")
                assert overflow, "the ledger sits in its own sideways scroller at 768"
                page.evaluate("scrollTo(0, 200)")
                assert role(page, "navigation", "Household").bounding_box()["y"] <= 2
            else:
                assert ledger["x"] < balance["x"] and button["y"] < balance["y"] and ledger["width"] > balance["width"] * 1.5
            layout(page)


def test_names_and_labels(browser, app_url, mail):
    home = make_home(app_url, mail)
    with screen(browser, app_url, "/costs", login=(home.planning_email, PASSWORD)) as page:
        description = person("names")[0]
        dialog = fill_cost(page, description, EARLY_TYPED, home.today())
        select(role(dialog, "combobox", "Category"), "Childcare")
        role(dialog, "button", "Send request").click()
        expect(activity(page)).to_have_text(SENT_COPY)
        row = ledger_row(page, description)
        expect(row).to_contain_text("Waiting for an answer")
        assert "sent" not in re.findall(r"\w+", row.inner_text().replace(description, "")), "the screen shows the interface's word for the state"
    cost = next(c for c in list_all(home.planning, home.at("/costs")) if c["description"] == description)
    assert (cost["category"], cost["state"]) == ("child_care", "sent")
    camel = re.compile(r"^[a-z][a-zA-Z0-9]*$")

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, inner in value.items():
                assert camel.match(key), key
                walk(inner)
        elif isinstance(value, list):
            for inner in value:
                walk(inner)

    walk(cost)
    walk(home.me())
    walk(home.doc(home.today().year)["days"][:2])
    walk(want(home.planning.get(home.at("/tonight")), 200).json())


def test_wf_cross_cutting_database_recovery(browser, app_url):
    url = urlsplit(os.environ["DATABASE_URL"])
    relay = Relay(url.hostname, url.port or 5432)
    relay.start()
    login = url.netloc.rsplit("@", 1)[0] + "@" if "@" in url.netloc else ""
    routed = urlunsplit((url.scheme, f"{login}127.0.0.1:{relay.port}", url.path, url.query, url.fragment))
    _, email, password = SEEDS["maple"]["other"]
    try:
        with app_copy(DATABASE_URL=routed) as copy:
            api = Api(copy.base, token_of(copy.base, email, password))
            want(api.get("/api/me"), 200)
            with screen(browser, copy.base, "/requests", login=(email, password)) as page:
                expect(role(page, "navigation", "Household")).to_be_visible()
                relay.stop()
                eventually(lambda: api.get("/api/me").status_code == 503, 15, "503 once the database connection is cut")
                problem(api.get("/api/me"), 503, "database_unavailable")
                assert copy.proc.poll() is None, "the process stays up"
                page.reload()
                expect(page.get_by_text("Couldn't reach the household data – try again", exact=True).first).to_be_visible()
                relay.start()
                eventually(lambda: api.get("/api/me").status_code == 200, 30, "the next request succeeding after recovery with no restart")
                assert copy.proc.poll() is None
    finally:
        relay.stop()


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"} and manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) and v for v in manifest.values())


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notices, package.name
    assert "Dela Gothic One" in notices and "DM Sans" in notices


def test_if_licences():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
    for package in shipped_packages():
        permitted = allowed | {"OFL-1.1"} if "font" in package.name.lower() else allowed
        assert licence_allowed(package.licence, permitted), (package.name, package.licence)


def test_if_datastores():
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "mongodb", "mysql", "mysql2", "lmdb", "level", "nedb"}
    assert not banned & {p.name for p in shipped_packages()}
    root = Path(DEPLOYED_APP)
    found = [p for pattern in ("*.db", "*.sqlite", "*.sqlite3") for p in root.rglob(pattern) if NODE_MODULES not in p.parts]
    assert not found, found


def test_if_typescript_strict():
    config = Path("/app/tsconfig.json").read_text()
    assert re.search(r'"strict"\s*:\s*true', config)
    assert [p for p in Path("/app").rglob("*.ts") if NODE_MODULES not in p.parts and not p.name.endswith(".d.ts")]


def test_if_self_hosted(browser, app_url):
    requests: list[str] = []
    with screen(browser, app_url, "/") as page:
        page.on("request", lambda req: requests.append(req.url))
        page.reload()
        _, email, password = SEEDS["maple"]["other"]
        sign_in(page, app_url, email, password)
        expect(role(page, "navigation", "Household")).to_be_visible()
    foreign = [u for u in requests if u.startswith("http") and not same_origin(u, origin_of(app_url))]
    assert requests and not foreign, foreign


def test_if_seed_at_serve(app_url):
    isolated = seed_home(outage("APP_MAIL_DOWN_ISOLATED_URL"), "maple")
    assert [e["type"] for e in isolated.log()[:3]] == ["household.created", "household.joined", "plan.adopted"]
    primary = seed_home(app_url, "maple")
    assert primary.log_count("household.created") == 1
    with app_copy():
        assert primary.log_count("household.created") == 1
