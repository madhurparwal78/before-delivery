from __future__ import annotations

import base64
import calendar
import concurrent.futures
import contextlib
import datetime as dt
import email as email_lib
import html
import json
import os
import re
import shlex
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid
from pathlib import Path
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    advance,
    app_user_env,
    as_app_user,
    axe,
    held,
    layout,
    open_app,
    same_origin,
    select,
    session,
    settle,
    state_styles,
    tab_order,
    unique,
)

try:
    from conftest import Postgres
except ImportError:
    from postgres import Postgres
try:
    from conftest import Mailpit, addresses, text as mail_text
except ImportError:
    from mailpit import Mailpit, addresses, text as mail_text


UTC = dt.timezone.utc
STOCKHOLM = ZoneInfo("Europe/Stockholm")
LEAD = ("Sana Holm", "sana@example.com")
ASSOCIATE = ("Ole Berg", "ole@example.com")
PASSWORD = "deku-demo-pw-2026"
STUDIO_FROM = "hello@northpier.studio"
Q7_TOKEN = "seed-npq7ld4v-status-link"

BODY_LIMIT = 65536
NESTING_LIMIT = 32
CALL_MINUTES = 45
OPEN_HOUR = 9
CLOSE_HOUR = 17
QUARTER = 15
WINDOW_DAYS = 90
NAME_MAX = 80
COMPANY_MAX = 120
MESSAGE_MIN = 20
MESSAGE_MAX = 2000
NOTE_MAX = 1000
Q_MAX = 100
EMAIL_MAX = 254
FLOOD_LIMIT = 5
FLOOD_WINDOW = 3600
SIGNIN_LIMIT = 5
SIGNIN_WINDOW = 900
TOKEN_MIN = 22
SESSION_TOKEN_MIN = 32
KEY_MIN = 8
KEY_MAX = 64
REQUEST_BUDGET_S = 2
MAIL_DEADLINE_S = 10
RECHECK_MS = 15000
SEARCH_SETTLE_MS = 1000
MOTION_MS = 450
HERO_SWAP_MS = 3000
COOKIE_DELAY_MS = 1000
SEQUENCE_MS = 1000
TARGET_PX = 44
ICS_LINE_OCTETS = 75
CONSENT_MIN_DAYS = 364
CONSENT_MAX_DAYS = 366

VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
REFLOW_WIDTH = 320
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}

HTTP_TIMEOUT = 20
BOOT_DEADLINE_S = 180
POLL_STEP_S = 0.2
SLOT_HORIZON_DAYS = WINDOW_DAYS - 5
SLOW_RATE = 0.01
BROWSER_ZONE = "America/Los_Angeles"
MESSAGE = "We need a calm new website for our harbour ferries."
FOREIGN_ORIGIN = "http://evil.example"
FIRST_NAME = "Ada"
CONFIRM_HEADING = "Thanks, {first}. We have your inquiry."
UNKNOWN_API_PATH = "/api/no-such-thing"
LITERAL_FIRST_LINE = "Line one <b>bold</b> & more"
LITERAL_MESSAGE = LITERAL_FIRST_LINE + "\nLine two of our ferry brief."
FIRST_NOTE = "Lead first look."
LEAK_PATTERN = re.compile(r"Traceback|File \"|psycopg|sqlalchemy|asyncpg|SELECT |INSERT |/app/|\.py\b")

LABELS = {"new": "New", "in_review": "In review", "call_booked": "Call booked", "won": "Won", "declined": "Declined"}
LINES = {
    "new": "We have your inquiry and will look at it shortly.",
    "in_review": "We are reading through your project and may get in touch with questions.",
    "call_booked": "Your intro call is booked for {call} Stockholm time.",
    "won": "We are starting together. We will be in touch with next steps.",
    "declined": "We are not the right fit this time: {reason}. Thank you for thinking of us.",
}
REASONS = {"outside_services": "Outside our services", "timeline": "Timeline does not fit", "budget": "Budget does not fit", "fully_booked": "Fully booked"}
BUDGETS = {"under_25k": "Under 25k EUR", "25k_75k": "25k to 75k EUR", "75k_150k": "75k to 150k EUR", "over_150k": "Over 150k EUR"}
TIMELINES = {"asap": "As soon as possible", "within_3_months": "Within 3 months", "3_to_6_months": "In 3 to 6 months", "exploring": "Just exploring"}

TRANSITIONS = [
    ("start_review", {"new"}, "in_review", {"lead", "associate"}),
    ("book_call", {"in_review"}, "call_booked", {"lead", "associate"}),
    ("reschedule_call", {"call_booked"}, "call_booked", {"lead", "associate"}),
    ("mark_won", {"call_booked"}, "won", {"lead"}),
    ("decline", {"new", "in_review", "call_booked"}, "declined", {"lead"}),
    ("reopen", {"declined"}, "in_review", {"lead"}),
]
ACTIONS = [t[0] for t in TRANSITIONS]
BUTTONS = {"start_review": "Start review", "book_call": "Book call", "reschedule_call": "Reschedule call", "mark_won": "Mark won", "decline": "Decline", "reopen": "Reopen"}
LEAD_ONLY = ["mark_won", "decline", "reopen"]

M = {
    "too_large": (413, None, "Request body is too large."),
    "sign_in": (401, None, "Sign in to continue."),
    "not_found": (404, None, "Not found"),
    "method": (405, None, "Method not allowed"),
    "body": (400, None, "Invalid request body"),
    "key": (400, None, "Idempotency-Key must be 8 to 64 letters, digits, - or _."),
    "cross_origin": (403, None, "Cross-origin request refused."),
    "lead_only": (403, "action", "Only a studio lead can do this."),
    "signin_limit": (429, "email", "Too many sign-in attempts. Try again later."),
    "credentials": (401, "email", "Incorrect email or password."),
    "inquiry_key": (409, None, "This key was already used for a different inquiry."),
    "change_key": (409, None, "This key was already used for a different change."),
    "stale": (412, "version", "This inquiry changed since you opened it. Reload to see the latest."),
    "not_allowed": (409, "action", "This action is not allowed from the current status."),
    "not_held": (409, "action", "Mark won after the intro call has taken place."),
    "window_closed": (409, "action", "This inquiry can no longer be reopened."),
    "name_blank": (422, "name", "Name is required."),
    "name_long": (422, "name", "Name must be 80 characters or fewer."),
    "email": (422, "email", "Enter a valid email address."),
    "company_long": (422, "company", "Company must be 120 characters or fewer."),
    "services": (422, "services", "Choose at least one service."),
    "budget": (422, "budget", "Choose a budget."),
    "timeline": (422, "timeline", "Choose a timeline."),
    "message_short": (422, "message", "Tell us a little more: at least 20 characters."),
    "message_long": (422, "message", "Message must be 2000 characters or fewer."),
    "future": (422, "call_at", "Choose a call time in the future."),
    "within_90": (422, "call_at", "Choose a call time within the next 90 days."),
    "hours": (422, "call_at", "Calls are booked on weekdays between 09:00 and 17:00 Stockholm time."),
    "closed": (422, "call_at", "The studio is closed that day."),
    "quarter": (422, "call_at", "Choose a time on a quarter hour."),
    "reason": (422, "decline_reason", "Choose a reason."),
    "note_blank": (422, "body", "Note cannot be empty."),
    "note_long": (422, "body", "Note must be 1000 characters or fewer."),
    "tab": (422, "status", "Unknown tab."),
    "q_long": (422, "q", "Search must be 100 characters or fewer."),
    "overlap": (409, "call_at", "That time overlaps another booked call."),
    "flood": (429, "email", "Too many inquiries from this email. Try again in an hour."),
    "outage": (503, None, "The studio desk is unavailable. Try again shortly."),
}
UNSUPPORTED = "Remove the unsupported characters."

CASES = [
    ("maison-vey", "Maison Vey", "Luxury", "ink", ["Site of the Day", "Developer Award"]),
    ("halden-labs", "Halden Labs", "AI Technologies", "orange", []),
    ("kvarn-group", "Kvarn Group", "Business Solutions", "clay", []),
    ("ostra-health", "Ostra Health", "Health Tech", "violet", []),
    ("lumen-bio", "Lumen Bio", "Bio Tech", "lemon", []),
    ("sola-rooms", "Sola Rooms", "Hospitality", "sand", []),
    ("fjell-energy", "Fjell Energy", "Sustainability", "mist", []),
    ("lesestund", "Lesestund", "Education", "clay", []),
]
SEED = {
    "NP-H4RV2K": ("Elin Strand", "elin@example.com", "Brightwater Ferries", ["design", "development"], "75k_150k", "within_3_months", [None], 1),
    "NP-T9WQ3M": ("Jonas Lind", "jonas@example.com", "Kelp and Co", ["branding"], "25k_75k", "3_to_6_months", [None], 1),
    "NP-C6PZ8N": ("Aino Varga", "aino@example.com", "Northfield Clinics", ["strategy", "design"], "over_150k", "asap", [None, "start_review"], 2),
    "NP-M3XB7R": ("Rafael Costa", "rafael@example.com", "Tidewell Labs", ["design", "development"], "75k_150k", "within_3_months", [None, "start_review", "book_call"], 3),
    "NP-Q7LD4V": ("Mira Falk", "mira@example.com", "Larkspur Audio", ["design"], "25k_75k", "asap", [None, "start_review", "book_call"], 3),
    "NP-W8DK5T": ("Hanna Moe", "hanna@example.com", "Quayside Books", ["branding", "design"], "25k_75k", "3_to_6_months", [None, "start_review", "book_call", "mark_won"], 4),
    "NP-B2FJ9S": ("Lukas Weber", "lukas@example.com", "Harbor Garage", ["development"], "under_25k", "asap", [None, "decline"], 2),
}
SEED_SUBMITTED_DAYS = 6
REFERENCE = re.compile(r"^NP-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$")
URL_SAFE = re.compile(r"^[A-Za-z0-9_-]+$")
ZULU = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
CALL_ZULU = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
PUBLIC_KEYS = {"reference", "status", "call_at", "decline_reason", "company", "services", "budget", "timeline", "message", "created_at", "history"}
STUDIO_KEYS = {"id", "reference", "name", "email", "company", "services", "budget", "timeline", "message", "status", "call_at", "decline_reason", "version", "created_at", "updated_at"}

ABSENT = object()


class Raw(str):
    pass


def poll(check: Callable[[], Any], seconds: float, message: Any) -> Any:
    end = time.monotonic() + seconds
    while True:
        result = check()
        if result:
            return result
        if time.monotonic() > end:
            raise AssertionError(message() if callable(message) else message)
        threading.Event().wait(POLL_STEP_S)


def encode(body: Any) -> bytes:
    raws: dict[str, str] = {}

    def swap(value: Any) -> Any:
        if isinstance(value, Raw):
            marker = f"__raw_{len(raws)}__"
            raws[marker] = str(value)
            return marker
        if isinstance(value, dict):
            return {k: swap(v) for k, v in value.items() if v is not ABSENT}
        if isinstance(value, list):
            return [swap(v) for v in value]
        return value

    out = json.dumps(swap(body), ensure_ascii=False)
    for marker, raw in raws.items():
        out = out.replace(json.dumps(marker), raw)
    return out.encode("utf-8")


def auth(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def send(base: str, path: str, body: Any = None, token: str | None = None, key: str | None = None,
         raw: bytes | None = None, headers: dict[str, str] | None = None, method: str = "POST") -> httpx.Response:
    h = {"Content-Type": "application/json", **auth(token), **(headers or {})}
    if key is not None:
        h["Idempotency-Key"] = key
    content = raw if raw is not None else encode(body)
    return httpx.request(method, base + path, content=content, headers=h, timeout=HTTP_TIMEOUT)


def get(base: str, path: str, token: str | None = None, **params: Any) -> httpx.Response:
    return httpx.get(base + path, params=params or None, headers=auth(token), timeout=HTTP_TIMEOUT)


def refused(r: httpx.Response, kind: str) -> None:
    status, field, message = M[kind]
    assert r.status_code == status, (kind, r.status_code, r.text)
    assert r.json() == {"error": {"field": field, "message": message}}, r.text
    assert not LEAK_PATTERN.search(r.text), r.text


def refused_field(r: httpx.Response, status: int, field: str | None, message: str) -> None:
    assert r.status_code == status, (r.status_code, r.text)
    assert r.json() == {"error": {"field": field, "message": message}}, r.text
    assert not LEAK_PATTERN.search(r.text), r.text


def db(sql: str) -> list[dict]:
    return Postgres().rows(sql)


def lit(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def scalar(sql: str) -> int:
    return int(list(db(sql)[0].values())[0])


def outbox_count(iid: int) -> int:
    return scalar(f"SELECT count(*) AS n FROM outbox WHERE inquiry_id = {int(iid)}")


def events_count(iid: int) -> int:
    return scalar(f"SELECT count(*) AS n FROM status_events WHERE inquiry_id = {int(iid)}")


def stored_for(email: str) -> int:
    return scalar(f"SELECT count(*) AS n FROM inquiries WHERE lower(email) = {lit(email.lower())}")


def iso(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def zulu(moment: dt.datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def wall(local: dt.datetime) -> str:
    return local.strftime("%Y-%m-%dT%H:%M")


def call_label(moment: dt.datetime) -> str:
    local = moment.astimezone(STOCKHOLM)
    return f"{calendar.day_name[local.weekday()]} {local.day} {calendar.month_name[local.month]}, {local:%H:%M}"


def at(day: dt.date, hour: int, minute: int = 0, second: int = 0) -> dt.datetime:
    return dt.datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=STOCKHOLM)


def new_tag() -> str:
    return uuid.uuid4().hex[:10]


def visitor() -> str:
    return unique()[1]


def exact_ci(value: str) -> re.Pattern:
    return re.compile(r"^\s*" + re.escape(value) + r"\s*$", re.I)


def has_ci(value: str) -> re.Pattern:
    return re.compile(re.escape(value), re.I)


def page_text(markup: str) -> str:
    stripped = re.sub(r"<script.*?</script>|<style.*?</style>", " ", markup, flags=re.S | re.I)
    stripped = html.unescape(re.sub(r"<[^>]+>", "", stripped)).replace("\xa0", " ")
    return re.sub(r"\s+", " ", stripped)


def in_page(copy: str, markup: str) -> bool:
    return re.sub(r"\s+", "", copy) in re.sub(r"\s+", "", page_text(markup))


def easter(year: int) -> dt.date:
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return dt.date(year, month, day + 1)


def closure_days(year: int) -> set[dt.date]:
    sunday = easter(year)
    fixed = {dt.date(year, mo, d) for mo, d in [(1, 1), (1, 6), (5, 1), (6, 6), (12, 24), (12, 25), (12, 26), (12, 31)]}
    midsummer = next(dt.date(year, 6, d) for d in range(19, 26) if dt.date(year, 6, d).weekday() == 4)
    return fixed | {sunday - dt.timedelta(days=2), sunday + dt.timedelta(days=1), sunday + dt.timedelta(days=39), midsummer}


def studio_day(day: dt.date) -> bool:
    return day.weekday() < 5 and day not in closure_days(day.year)


def local_date(moment: dt.datetime) -> dt.date:
    return moment.astimezone(STOCKHOLM).date()


_tokens: dict[tuple[str, str], str] = {}


def sign_in(base: str, account: tuple[str, str] = LEAD) -> str:
    key = (base, account[1])
    if key not in _tokens:
        r = send(base, "/api/auth/login", {"email": account[1], "password": PASSWORD})
        assert r.status_code == 200, r.text
        _tokens[key] = r.json()["token"]
    return _tokens[key]


def inquiry_body(email: str, tag: str, **over: Any) -> dict:
    body = {"name": f"Ada {tag}", "email": email, "company": f"Co {tag}", "services": ["design", "development"],
            "budget": "25k_75k", "timeline": "within_3_months", "message": MESSAGE}
    body.update(over)
    return body


def find(base: str, reference: str) -> dict:
    lead = sign_in(base)
    rows = get(base, "/api/studio/inquiries", lead, status="all", q=reference).json()["inquiries"]
    row = next(r for r in rows if r["reference"] == reference)
    return detail(base, row["id"])


def detail(base: str, iid: int, token: str | None = None) -> dict:
    r = get(base, f"/api/studio/inquiries/{iid}", token or sign_in(base))
    assert r.status_code == 200, r.text
    return r.json()


def create(base: str, tag: str | None = None, email: str | None = None, key: str | None = None, **over: Any) -> dict:
    tag = tag or new_tag()
    email = email or visitor()
    body = inquiry_body(email, tag, **over)
    r = send(base, "/api/inquiries", body, key=key)
    assert r.status_code == 201, r.text
    out = r.json()
    return {**find(base, out["reference"]), "status_token": out["status_token"], "status_url": out["status_url"],
            "tag": tag, "address": email.lower(), "sent": body}


def act(base: str, token: str, iid: int, action: str, version: Any, key: str | None = None, **fields: Any) -> httpx.Response:
    return send(base, f"/api/studio/inquiries/{iid}/transition", {"action": action, "version": version, **fields}, token, key)


def ok(r: httpx.Response) -> dict:
    assert r.status_code == 200, r.text
    return r.json()


def review(base: str, inq: dict, token: str | None = None) -> dict:
    return {**inq, **ok(act(base, token or sign_in(base), inq["id"], "start_review", inq["version"]))}


def queue(base: str, token: str | None = None, **params: Any) -> httpx.Response:
    return get(base, "/api/studio/inquiries", token or sign_in(base), **params)


def busy(base: str) -> list[tuple[dt.datetime, dt.datetime]]:
    rows = ok(queue(base, status="call_booked"))["inquiries"]
    return [(iso(r["call_at"]), iso(r["call_at"]) + dt.timedelta(minutes=CALL_MINUTES)) for r in rows if r["call_at"]]


def free_start(base: str, now: dt.datetime, minutes: int = CALL_MINUTES, at_time: tuple[int, int] | None = None,
               after: dt.date | None = None, latest_start: tuple[int, int] | None = None) -> dt.datetime:
    taken = busy(base)
    first = after or (local_date(now) + dt.timedelta(days=2))
    limit = now + dt.timedelta(days=SLOT_HORIZON_DAYS)
    last_minute = CLOSE_HOUR * 60 - minutes
    if latest_start:
        last_minute = min(last_minute, latest_start[0] * 60 + latest_start[1])
    for offset in range(SLOT_HORIZON_DAYS):
        day = first + dt.timedelta(days=offset)
        if not studio_day(day):
            continue
        starts = [at_time[0] * 60 + at_time[1]] if at_time else range(OPEN_HOUR * 60, last_minute + 1, QUARTER)
        for minute in starts:
            local = at(day, minute // 60, minute % 60)
            begin = local.astimezone(UTC)
            end = begin + dt.timedelta(minutes=minutes)
            if end > limit:
                break
            if all(end <= b0 or begin >= b1 for b0, b1 in taken):
                return local
    raise AssertionError("no free studio slot inside the call window")


def book(base: str, inq: dict, token: str | None = None, local: dt.datetime | None = None) -> tuple[dict, dt.datetime]:
    token = token or sign_in(base)
    local = local or free_start(base, iso(inq["created_at"]))
    action = "reschedule_call" if inq["status"] == "call_booked" else "book_call"
    out = ok(act(base, token, inq["id"], action, inq["version"], call_at=wall(local)))
    return {**inq, **out}, local


def decline(base: str, inq: dict, reason: str = "budget") -> dict:
    return {**inq, **ok(act(base, sign_in(base), inq["id"], "decline", inq["version"], decline_reason=reason))}


def add_note(base: str, iid: int, body: str, account: tuple[str, str] = LEAD) -> httpx.Response:
    return send(base, f"/api/studio/inquiries/{iid}/notes", {"body": body}, sign_in(base, account))


def public(base: str, token: str) -> httpx.Response:
    return get(base, f"/api/inquiries/status/{token}")


def together(*calls: Callable[[], httpx.Response]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        return [f.result() for f in [pool.submit(run, c) for c in calls]]


def recipients(message: dict, field: str) -> list[str]:
    return [a.lower() for a in addresses(message.get(field))]


def mails_to(mail: Any, address: str, count: int, seconds: float = MAIL_DEADLINE_S) -> list[dict]:
    address = address.lower()

    def mine(settle: float) -> list[dict]:
        return [m for m in mail.messages(0, settle=settle) if address in recipients(m, "To")]

    poll(lambda: len(mine(0)) >= count, seconds, f"fewer than {count} emails reached {address}")
    found = mine(1.5)
    return sorted(found, key=mail_number)


def mail_number(message: dict) -> int:
    match = re.search(r"\.(\d+)@", message.get("MessageID") or "")
    return int(match.group(1)) if match else -1


def attachments(message: dict) -> list[dict]:
    return list(message.get("Attachments") or []) + list(message.get("Inline") or [])


def calendar_parts(message: dict) -> list[dict]:
    return [a for a in attachments(message) if str(a.get("ContentType", "")).lower().startswith("text/calendar")
            or str(a.get("FileName", "")).lower().endswith(".ics")]


def ics_texts(message: dict) -> list[str]:
    found: list[str] = []

    def from_mime(raw: str) -> None:
        for part in email_lib.message_from_string(raw).walk():
            if part.get_content_type() == "text/calendar":
                payload = part.get_payload(decode=True)
                if payload:
                    found.append(payload.decode("utf-8"))

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
        elif isinstance(value, (bytes, bytearray)):
            walk(value.decode("utf-8", "replace"))
        elif isinstance(value, str):
            if "BEGIN:VCALENDAR" in value:
                found.append(value)
            elif "Content-Type:" in value and "text/calendar" in value:
                from_mime(value)
            elif len(value) > 40 and re.fullmatch(r"[A-Za-z0-9+/=\s]+", value):
                with contextlib.suppress(ValueError):
                    decoded = base64.b64decode(value)
                    if b"BEGIN:VCALENDAR" in decoded:
                        found.append(decoded.decode("utf-8"))

    walk(message)
    if not found and message.get("ID"):
        from_mime(Mailpit().raw(message["ID"]))
    unique_texts: list[str] = []
    for item in found:
        if item not in unique_texts:
            unique_texts.append(item)
    return unique_texts


def ics_lines(raw: str) -> list[str]:
    assert "\n" not in raw.replace("\r\n", ""), "every ICS line must end in CRLF"
    physical = raw.split("\r\n")
    if physical and physical[-1] == "":
        physical.pop()
    for line in physical:
        assert len(line.encode("utf-8")) <= ICS_LINE_OCTETS, line
    logical: list[str] = []
    for line in physical:
        if line.startswith(" ") and logical:
            logical[-1] += line[1:]
        else:
            logical.append(line)
    return logical


def ics_stamp(moment: dt.datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def body_of(message: dict) -> str:
    out = mail_text(message).replace("\r\n", "\n")
    return out[:-1] if out.endswith("\n") else out


@contextlib.contextmanager
def plain(browser: Browser, url: str, **options: Any) -> Iterator[Page]:
    context = browser.new_context(**options)
    try:
        page = context.new_page()
        page.goto(url)
        yield page
    finally:
        context.close()


def consent(page: Page, base: str) -> None:
    page.context.add_cookies([{"name": "np_consent", "value": "rejected", "url": base}])
    if page.url.startswith(base):
        page.reload()


def ui_sign_in(page: Page, account: tuple[str, str], password: str = PASSWORD) -> None:
    page.get_by_role("textbox", name="Email", exact=True).fill(account[1])
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Sign in", exact=True).click()


@contextlib.contextmanager
def studio(browser: Browser, base: str, account: tuple[str, str], path: str = "/studio", **options: Any) -> Iterator[Page]:
    options.setdefault("viewport", DESKTOP)
    with plain(browser, f"{base}/studio/signin?next={urllib.parse.quote(path, safe='')}", **options) as page:
        ui_sign_in(page, account)
        target = urllib.parse.urlsplit(path).path
        page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == target)
        yield page


def tab(page: Page, label: str, count: int) -> Any:
    return page.get_by_role("tab", name=f"{label} {count}", exact=True)


def query_of(url: str) -> dict[str, list[str]]:
    return urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)


def shown(locator: Any) -> bool:
    return bool(locator.evaluate(
        """(el) => {
          const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
          let l = r.left, t = r.top, rr = r.right, b = r.bottom;
          for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.5) return false;
            if (n !== el && s.overflow !== 'visible') {
              const c = n.getBoundingClientRect();
              l = Math.max(l, c.left); t = Math.max(t, c.top); rr = Math.min(rr, c.right); b = Math.min(b, c.bottom);
            }
          }
          return rr - l > 0 && b - t > 0 && (rr - l) * (b - t) >= (r.width * r.height) / 2;
        }"""))


def timings(locator: Any) -> list[dict]:
    return locator.evaluate(
        """(el) => el.getAnimations({subtree: true}).map(a => {
             const t = a.effect.getComputedTiming();
             return {duration: Number(t.duration) || 0, delay: Number(t.delay) || 0, end: Number(t.endTime), iterations: t.iterations};
           })""")


def advance_until(page: Page, locator: Any, seconds: float = MAIL_DEADLINE_S) -> None:
    def step() -> bool:
        advance(page, 250)
        return locator.count() > 0 and locator.first.is_visible()
    poll(step, seconds, lambda: f"{locator} never appeared")


def gone(locator: Any) -> bool:
    if not locator.count() or not locator.first.is_visible() or not shown(locator.first):
        return True
    return bool(locator.first.evaluate("e => { const r = e.getBoundingClientRect(); "
                                       "return r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight; }"))


def slow_motion(page: Page) -> None:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})


def closed_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def app_copy(ready: int = 200, **env: str) -> Iterator[str]:
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    port = closed_port()
    url = f"http://127.0.0.1:{port}"
    log = tempfile.NamedTemporaryFile(prefix="northpier-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(as_app_user(serve), cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT,
                            env=app_user_env(APP_PUBLIC_PORT=str(port), APP_PUBLIC_URL=url, **env), start_new_session=True)

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-4000:]

    def up() -> bool:
        assert proc.poll() is None, f"app copy exited:\n{tail()}"
        try:
            return httpx.get(f"{url}/api/health", timeout=2).status_code == ready
        except httpx.HTTPError:
            return False

    try:
        poll(up, BOOT_DEADLINE_S, lambda: f"app copy never answered health {ready}:\n{tail()}")
        yield url
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(15)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)


def unreachable_database_url() -> str:
    url = app_user_env().get("DATABASE_URL") or os.environ["DATABASE_URL"]
    parts = urllib.parse.urlsplit(url)
    userinfo = parts.netloc.rsplit("@", 1)[0] + "@" if "@" in parts.netloc else ""
    return urllib.parse.urlunsplit((parts.scheme, f"{userinfo}127.0.0.1:{closed_port()}", parts.path, parts.query, parts.fragment))


def test_if_user_readme() -> None:
    readme = Path("/app/USER_README.md").read_text()
    lowered = readme.lower()
    for name, address in (LEAD, ASSOCIATE):
        assert address in lowered or name.lower() in lowered, address
    for role in ("lead", "associate"):
        assert role in lowered, role
    for value in (PASSWORD, f"/inquiry/{Q7_TOKEN}"):
        assert value in readme, value


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for name in ("install", "build", "serve"):
        assert isinstance(manifest[name], str), name
    assert manifest["install"].strip() and manifest["serve"].strip()


DEPENDENCY_TREE = """
import json, re, sys, importlib.metadata as md


def licence_text(name):
    texts = []
    for f in md.distribution(name).files or []:
        if re.search(r"(^|/)(LICEN[CS]E|COPYING)[^/]*$", str(f), re.I):
            try:
                texts.append(f.read_text()[:3000])
            except (OSError, UnicodeDecodeError):
                pass
    return " ".join(texts)[:12000]


seen, todo, out = set(), list(sys.argv[1:]), {}
while todo:
    name = todo.pop()
    key = re.sub(r"[-_.]+", "-", name).lower()
    if key in seen:
        continue
    seen.add(key)
    try:
        meta = md.metadata(name)
    except md.PackageNotFoundError:
        continue
    out[meta["Name"]] = {"version": meta["Version"], "license": meta.get("License") or "",
        "expr": meta.get("License-Expression") or "",
        "classifiers": [c for c in (meta.get_all("Classifier") or []) if c.startswith("License")],
        "files": licence_text(name)}
    for req in md.requires(name) or []:
        if "extra ==" in req:
            continue
        if ";" in req:
            try:
                from packaging.markers import Marker
                if not Marker(req.split(";", 1)[1]).evaluate():
                    continue
            except Exception:
                continue
        todo.append(re.match(r"[A-Za-z0-9._-]+", req).group(0))
print(json.dumps(out))
"""


def shipped_packages() -> dict[str, dict]:
    names = []
    for line in Path("/app/requirements.txt").read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line and not line.startswith("-"):
            names.append(re.match(r"[A-Za-z0-9._-]+", line).group(0))
    venvs = sorted(p.parent for p in DEPLOYED_APP.glob("*/pyvenv.cfg"))
    python = str(venvs[0] / "bin" / "python") if venvs else "python3"
    command = shlex.quote(python) + " -c " + shlex.quote(DEPENDENCY_TREE) + " " + " ".join(shlex.quote(n) for n in names)
    run = subprocess.run(as_app_user(command), cwd=DEPLOYED_APP, env=app_user_env(), capture_output=True, text=True,
                         timeout=120)
    assert run.returncode == 0, run.stderr[-2000:]
    packages = {name: info for name, info in json.loads(run.stdout.strip().splitlines()[-1]).items()
                if name.lower() not in ("pip", "setuptools", "wheel")}
    assert names and len(packages) >= len(names), (names, packages)
    return packages


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text().lower()
    flat = re.sub(r"[-_.]+", "-", notices)
    for name, info in shipped_packages().items():
        assert re.sub(r"[-_.]+", "-", name.lower()) in flat, name
        assert info["version"].lower() in notices, (name, info["version"])


LICENCE_SPELLINGS = (
    "mit", "bsd-2-clause", "bsd-3-clause", "bsd license", "bsd", "apache-2.0", "apache software license", "apache 2",
    "apache license 2.0", "apache license, version 2.0", "isc", "psf-2.0", "python software foundation",
    "mpl-2.0", "mozilla public license 2.0", "lgpl-3.0-or-later", "lgplv3+", "lgplv3",
    "gnu lesser general public license v3",
)
LICENCE_TEXTS = (
    "permission is hereby granted, free of charge", "redistribution and use in source and binary forms",
    "apache license", "permission to use, copy, modify, and/or distribute", "mozilla public license",
    "python software foundation license", "gnu lesser general public license",
)


def test_if_licence_allowlist() -> None:
    for name, info in shipped_packages().items():
        declared = " ".join([info["license"], info["expr"], *info["classifiers"]]).lower()
        text = re.sub(r"\s+", " ", info.get("files", "")).lower()
        assert any(spelling in declared for spelling in LICENCE_SPELLINGS) or \
            any(opening in text for opening in LICENCE_TEXTS), (name, declared, text[:200])


FORBIDDEN_STORES = ("redis", "pymongo", "celery", "kombu", "memcache", "sendgrid", "mailgun", "boto3", "pika", "elasticsearch")


def executed_commands() -> str:
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.exists():
        return ""
    steps = json.loads(trajectory.read_text(errors="replace")).get("steps") or []
    return "\n".join(str(value) for step in steps for call in step.get("tool_calls") or []
                     for value in (call.get("arguments") or {}).values() if isinstance(value, str)).lower()


def test_if_no_other_services() -> None:
    requirements = Path("/app/requirements.txt").read_text().lower()
    for name in FORBIDDEN_STORES:
        assert not re.search(rf"^\s*{name}", requirements, re.M), name
    procs = [c.read_text(errors="replace").strip().lower() for c in Path("/proc").glob("[0-9]*/comm") if c.is_file()]
    for daemon in ("redis-server", "mongod", "mysqld", "memcached", "rabbitmq-server", "mailhog"):
        assert daemon not in procs, daemon
    log = executed_commands()
    if log:
        assert not re.search(r"apt(-get)? install[^\n\"]*\b(postgresql(-\d+)?|redis-server|mailpit)(?![\w-])", log)
        assert not re.search(r"docker run[^\n\"]*(postgres|mailpit)", log)


def test_if_reserved_dirs() -> None:
    assert Path("/app/.browser_screenshots").is_dir()
    assert Path("/app/.downloads").is_dir()


def test_if_services_untouched(app_url: str) -> None:
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    assert "inquiries" in [t.rsplit(".", 1)[-1] for t in Postgres().tables()]
    log = executed_commands().upper()
    assert not re.search(r"ALTER (ROLE|USER)[^\n\"]*PASSWORD", log)


def test_wf_seeded_data_and_deployment_contract_health_and_pages(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    pages = {
        "/": "We craft digital products and brands",
        "/work/halden-labs": "Halden Labs",
        "/services": "Crafting meaningful connections between businesses and people.",
        "/contact": "Want to talk?",
        "/start": "Hi, tell us about your project.",
        "/privacy-policy": "We set one first-party cookie to remember your cookie choice for a year.",
        f"/inquiry/{Q7_TOKEN}": "NP-Q7LD4V",
    }
    for path, copy in pages.items():
        page = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert page.status_code == 200, path
        assert in_page(copy, page.text), path
    before = scalar("SELECT count(*) AS n FROM inquiries WHERE reference LIKE 'NP-%'")
    with app_copy() as copy:
        assert httpx.get(f"{copy}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
        assert len(get(copy, "/api/cases").json()) == len(CASES)
        assert public(copy, Q7_TOKEN).json()["reference"] == "NP-Q7LD4V"
    for reference in SEED:
        assert scalar(f"SELECT count(*) AS n FROM inquiries WHERE reference = {lit(reference)}") == 1
    for account in (LEAD, ASSOCIATE):
        assert scalar(f"SELECT count(*) AS n FROM studio_users WHERE email = {lit(account[1])}") == 1
    assert scalar("SELECT count(*) AS n FROM cases") == len(CASES)
    assert scalar("SELECT count(*) AS n FROM inquiries WHERE reference LIKE 'NP-%'") >= before
    with app_copy(ready=503, DATABASE_URL=unreachable_database_url()) as down:
        health = httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT)
        assert health.status_code == 503 and health.json() == {"status": "unavailable"}
        refused(get(down, "/api/cases"), "outage")
        landing = httpx.get(f"{down}/", timeout=HTTP_TIMEOUT)
        assert landing.status_code == 503
        assert in_page(M["outage"][2], landing.text)


def test_wf_seeded_data_and_deployment_contract_seed_records(app_url: str) -> None:
    users = {u["email"]: u for u in db("SELECT name, email, role, password_hash FROM studio_users")}
    assert users[LEAD[1]]["name"] == LEAD[0] and users[LEAD[1]]["role"] == "lead"
    assert users[ASSOCIATE[1]]["name"] == ASSOCIATE[0] and users[ASSOCIATE[1]]["role"] == "associate"
    slugs = {row["slug"]: row for row in db("SELECT slug, position FROM cases")}
    for position, (slug, *_rest) in enumerate(CASES, start=1):
        assert slugs[slug]["position"] == position
    lead = sign_in(app_url)
    for reference, (name, address, company, services, budget, timeline, steps, seed_version) in SEED.items():
        row = db(f"SELECT id, status_token FROM inquiries WHERE reference = {lit(reference)}")
        assert len(row) == 1, reference
        token = "seed-" + reference.lower().replace("-", "") + "-status-link"
        assert row[0]["status_token"] == token
        inq = detail(app_url, row[0]["id"], lead)
        assert (inq["name"], inq["email"], inq["company"], inq["services"], inq["budget"], inq["timeline"]) == \
            (name, address, company, services, budget, timeline)
        assert len(inq["message"].strip()) >= MESSAGE_MIN
        history = inq["history"]
        assert [h["action"] for h in history[: len(steps)]] == steps, reference
        assert all(h["actor_name"] == LEAD[0] for h in history[1: len(steps)]), reference
        assert inq["version"] == len(history)
        assert history[-1]["to_status"] == inq["status"]
        assert outbox_count(inq["id"]) == inq["version"] - seed_version, reference
        if reference == "NP-B2FJ9S":
            assert history[1]["decline_reason"] == "budget"
        assert public(app_url, token).status_code == 200


def after_from(today: dt.date, count: int) -> dt.date:
    day, seen = today, 0
    while seen < count:
        day += dt.timedelta(days=1)
        seen += studio_day(day)
    return day


def test_wf_seeded_data_and_deployment_contract_seeded_call_times(app_url: str) -> None:
    first = find(app_url, "NP-H4RV2K")
    start = iso(first["history"][0]["created_at"]) + dt.timedelta(days=SEED_SUBMITTED_DAYS)
    stored = {reference: find(app_url, reference) for reference in ("NP-M3XB7R", "NP-Q7LD4V", "NP-W8DK5T")}
    candidates = sorted({local_date(start + dt.timedelta(hours=h)) for h in (-1, 0, 1)}, key=lambda d: d != local_date(start))
    today = next((d for d in candidates if stored["NP-M3XB7R"]["call_at"] == zulu(at(after_from(d, 3), 14))), candidates[0])

    def after(count: int) -> dt.date:
        day, seen = today, 0
        while seen < count:
            day += dt.timedelta(days=1)
            seen += studio_day(day)
        return day

    def last_before(days: int) -> dt.date:
        day = today - dt.timedelta(days=days)
        while not studio_day(day):
            day -= dt.timedelta(days=1)
        return day

    expected = {
        "NP-M3XB7R": at(after(3), 14),
        "NP-Q7LD4V": at(last_before(2), 10),
        "NP-W8DK5T": at(last_before(14), 11),
    }
    for reference, local in expected.items():
        inq = stored[reference]
        assert CALL_ZULU.match(inq["call_at"]), inq["call_at"]
        assert inq["call_at"] == zulu(local), (reference, inq["call_at"], local.isoformat())
        booked = [h for h in inq["history"] if h["action"] == "book_call"][0]
        assert iso(booked["call_at"]) == local.astimezone(UTC)


def test_wf_seeded_data_and_deployment_contract_cases_api(app_url: str) -> None:
    listed = ok(get(app_url, "/api/cases"))
    assert [(c["slug"], c["client"], c["industry"], c["theme"], c["position"]) for c in listed] == \
        [(slug, client, industry, theme, i) for i, (slug, client, industry, theme, _a) in enumerate(CASES, start=1)]
    for index, (slug, client, industry, theme, awards) in enumerate(CASES):
        case = ok(get(app_url, f"/api/cases/{slug}"))
        assert (case["slug"], case["client"], case["industry"], case["theme"]) == (slug, client, industry, theme)
        assert case["awards"] == awards
        assert len(case["body"]) == 2 and all(isinstance(p, str) and p for p in case["body"])
        assert case["headline"] and case["testimonial"]["quote"] and case["testimonial"]["name"] and case["testimonial"]["role"]
        nxt = [CASES[(index + 1) % len(CASES)][0], CASES[(index + 2) % len(CASES)][0]]
        assert [m["slug"] for m in case["more"]] == nxt
    refused(get(app_url, "/api/cases/no-such-case"), "not_found")


def fill_composer(page: Page, name: str, address: str, message: str) -> None:
    page.get_by_role("textbox", name="Your name").fill(name)
    page.get_by_role("textbox", name="Email", exact=True).fill(address)
    page.get_by_role("textbox", name="Company").fill("Halden Visitor Co")
    select(page.get_by_role("combobox", name="Budget"), BUDGETS["25k_75k"])
    select(page.get_by_role("combobox", name="Timeline"), TIMELINES["within_3_months"])
    page.get_by_role("textbox", name="Tell us more").fill(message)


def test_wf_visitor_sends_inquiry_composer_journey(browser: Browser, app_url: str, mail: Any) -> None:
    tag, address = new_tag(), visitor()
    message = f"Hello from {tag} \U0001F44B\U0001F3FD\nWe need a new site for our lab."
    with open_app(browser, f"{app_url}/work/halden-labs") as page:
        consent(page, app_url)
        page.get_by_role("link", name="Start a project", exact=True).first.click()
        page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == "/start")
        card = page.get_by_role("button", name=re.compile(r"^I have a project"))
        card.click()
        expect(card).to_have_attribute("aria-pressed", "true")
        expect(page.get_by_role("checkbox", name="Design", exact=True)).to_be_checked()
        expect(page.get_by_role("checkbox", name="Development", exact=True)).to_be_checked()
        expect(page.get_by_role("checkbox", name="Strategy", exact=True)).not_to_be_checked()
        send_button = page.get_by_role("button", name="Send inquiry")
        expect(send_button).to_be_disabled()
        fill_composer(page, f"Ada {tag}", address, message)
        expect(page.get_by_text(f"{len(message)} / {MESSAGE_MAX}", exact=True)).to_be_visible()
        advance(page, SEARCH_SETTLE_MS)
        expect(send_button).to_be_enabled()
        send_button.click()
        expect(page.get_by_role("heading", name=CONFIRM_HEADING.format(first=FIRST_NAME))).to_be_visible()
        expect(page.get_by_role("status", name="Send status")).to_have_text(exact_ci("Inquiry sent."))
        reference = re.search(r"NP-[A-Z0-9]{6}", page.get_by_text(re.compile(r"Reference NP-")).first.text_content()).group(0)
        link = page.get_by_role("textbox", name="Status link").input_value()
        token = link.rsplit("/inquiry/", 1)[1]
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        page.get_by_role("button", name="Copy link").click()
        expect(page.get_by_role("status", name="Send status")).to_have_text(exact_ci("Link copied."))
        assert page.evaluate("() => navigator.clipboard.readText()") == link
        open_link = page.get_by_role("link", name="Open status page")
        if open_link.get_attribute("target") == "_blank":
            with page.expect_popup() as popup:
                open_link.click()
            status_view = popup.value
        else:
            open_link.click()
            status_view = page
        expect(status_view.get_by_role("heading", level=1, name=exact_ci("New"))).to_be_visible()
    rows = db(f"SELECT status, version, email, status_token FROM inquiries WHERE reference = {lit(reference)}")
    assert rows == [{"status": "new", "version": 1, "email": address.lower(), "status_token": token}]
    mails = mails_to(mail, address, 1)
    assert [m["Subject"] for m in mails] == [f"We have your inquiry {reference}"]


def test_wf_visitor_sends_inquiry_api_store(app_url: str, mail: Any) -> None:
    tag, address = new_tag(), visitor()
    local, domain = address.split("@")
    mixed = local[0].upper() + local[1:] + "@" + domain.upper()
    r = send(app_url, "/api/inquiries", inquiry_body(mixed, tag))
    assert r.status_code == 201, r.text
    out = r.json()
    assert set(out) == {"reference", "status", "status_token", "status_url"}
    assert REFERENCE.match(out["reference"]) and out["status"] == "new"
    assert len(out["status_token"]) >= TOKEN_MIN and URL_SAFE.match(out["status_token"])
    assert out["status_url"].endswith(f"/inquiry/{out['status_token']}") and out["status_url"].startswith("http")
    rows = db(f"SELECT id, status, version, email, status_token FROM inquiries WHERE reference = {lit(out['reference'])}")
    assert len(rows) == 1
    assert (rows[0]["status"], rows[0]["version"], rows[0]["email"], rows[0]["status_token"]) == \
        ("new", 1, address.lower(), out["status_token"])
    assert events_count(rows[0]["id"]) == 1 and outbox_count(rows[0]["id"]) == 1
    assert len(mails_to(mail, address, 1)) == 1


def test_wf_visitor_sends_inquiry_double_press(browser: Browser, app_url: str) -> None:
    tag, address = new_tag(), visitor()
    with open_app(browser, f"{app_url}/start") as page:
        consent(page, app_url)
        page.get_by_role("button", name=re.compile(r"^Explore an idea")).click()
        expect(page.get_by_role("checkbox", name="Strategy", exact=True)).to_be_checked()
        fill_composer(page, f"Ada {tag}", address, MESSAGE)
        send_button = page.get_by_role("button", name="Send inquiry")
        advance(page, SEARCH_SETTLE_MS)
        expect(send_button).to_be_enabled()
        with held(page, "**/api/inquiries*") as gate, held(page, "**/start") as form_gate:
            send_button.click()
            expect(page.get_by_role("status", name="Send status")).to_have_text(exact_ci("Sending your inquiry..."))
            expect(send_button).to_be_disabled()
            send_button.dispatch_event("click")
            gate.release()
            form_gate.release()
        expect(page.get_by_role("heading", name=CONFIRM_HEADING.format(first=FIRST_NAME))).to_be_visible()
    assert stored_for(address) == 1
    iid = db(f"SELECT id FROM inquiries WHERE lower(email) = {lit(address.lower())}")[0]["id"]
    assert outbox_count(iid) == 1


def test_wf_visitor_sends_inquiry_without_scripts(browser: Browser, app_url: str) -> None:
    tag, address = new_tag(), visitor()
    with plain(browser, f"{app_url}/start", java_script_enabled=False) as page:
        consent(page, app_url)
        page.reload()
        page.get_by_role("checkbox", name="Design", exact=True).check()
        fill_composer(page, f"Ada {tag}", address, "too short" + " " * 15)
        page.get_by_role("button", name="Send inquiry").click()
        expect(page.get_by_text(M["message_short"][2])).to_be_visible()
        expect(page.get_by_role("textbox", name="Your name")).to_have_value(f"Ada {tag}")
        assert stored_for(address) == 0
        page.get_by_role("textbox", name="Tell us more").fill(MESSAGE)
        if not page.get_by_role("checkbox", name="Design", exact=True).is_checked():
            page.get_by_role("checkbox", name="Design", exact=True).check()
        page.get_by_role("button", name="Send inquiry").click()
        expect(page.get_by_role("heading", name=CONFIRM_HEADING.format(first=FIRST_NAME))).to_be_visible()
        expect(page.get_by_text(re.compile(r"Reference NP-"))).to_be_visible()
    assert stored_for(address) == 1


VALIDATION = {
    "name_blank": ({"name": "   "}, "name_blank"),
    "name_too_long": ({"name": "N" * (NAME_MAX + 1)}, "name_long"),
    "name_80_emoji": ({"name": "\U0001F600" * NAME_MAX}, None),
    "email_malformed": ({"email": "ada.example.com"}, "email"),
    "email_two_at": ({"email": "ada@b@example.com"}, "email"),
    "email_dotless_domain": ({"email": "ada@example"}, "email"),
    "email_space": ({"email": "ada lind@example.com"}, "email"),
    "email_too_long": ({"email": "a" * EMAIL_MAX + "@example.com"}, "email"),
    "company_too_long": ({"company": "C" * (COMPANY_MAX + 1)}, "company_long"),
    "company_120": ({"company": "C" * COMPANY_MAX}, None),
    "services_empty": ({"services": []}, "services"),
    "services_unknown": ({"services": ["seo"]}, "services"),
    "budget_missing": ({"budget": ABSENT}, "budget"),
    "timeline_unknown": ({"timeline": "someday"}, "timeline"),
    "message_short_after_trim": ({"message": "   " + "m" * (MESSAGE_MIN - 1) + "   "}, "message_short"),
    "message_too_long": ({"message": "m" * (MESSAGE_MAX + 1)}, "message_long"),
    "message_2000_emoji": ({"message": "\U0001F600" * MESSAGE_MAX}, None),
    "message_crlf_counts_once": ({"message": "m" * (MESSAGE_MAX // 2) + "\r\n" + "m" * (MESSAGE_MAX // 2 - 1)}, None),
    "first_failing_field": ({"name": "", "email": "bad"}, "name_blank"),
    "body_not_json": ({"__raw__": b"{not json"}, "body"),
    "body_array": ({"__raw__": b"[]"}, "body"),
    "body_too_deep": ({"extra": Raw("[" * (NESTING_LIMIT + 8) + "]" * (NESTING_LIMIT + 8))}, "body"),
}


VALIDATION_IDS = [
    "name_blank", "name_too_long", "name_80_emoji", "email_malformed", "email_two_at", "email_dotless_domain",
    "email_space", "email_too_long", "company_too_long", "company_120", "services_empty", "services_unknown",
    "budget_missing", "timeline_unknown", "message_short_after_trim", "message_too_long", "message_2000_emoji",
    "message_crlf_counts_once", "first_failing_field", "body_not_json", "body_array", "body_too_deep",
]


@pytest.mark.parametrize("case", VALIDATION_IDS, ids=VALIDATION_IDS)
def test_wf_invalid_inquiry_and_flood_limit_rejected_validation(app_url: str, case: str) -> None:
    over, kind = VALIDATION[case]
    over = dict(over)
    tag, address = new_tag(), visitor()
    raw = over.pop("__raw__", None) if "__raw__" in over else None
    body = inquiry_body(address, tag)
    body.update(over)
    r = send(app_url, "/api/inquiries", body, raw=raw)
    matched = scalar(
        f"SELECT count(*) AS n FROM inquiries WHERE lower(email) = {lit(address.lower())} "
        f"OR strpos(name, {lit(tag)}) > 0 OR strpos(coalesce(company, ''), {lit(tag)}) > 0")
    sent = scalar(f"SELECT count(*) AS n FROM outbox WHERE lower(to_address) = {lit(address.lower())}")
    if kind is None:
        assert r.status_code == 201, r.text
        assert matched == 1 and sent == 1
    else:
        refused(r, kind)
        assert matched == 0 and sent == 0


def test_wf_invalid_inquiry_and_flood_limit_rejected_flood_limit(app_url: str, mail: Any) -> None:
    address = visitor()
    local, domain = address.split("@")
    spellings = [address, address.upper(), local.upper() + "@" + domain, address, local + "@" + domain.upper()]
    for spelling in spellings:
        assert send(app_url, "/api/inquiries", inquiry_body(spelling, new_tag())).status_code == 201
    r = send(app_url, "/api/inquiries", inquiry_body(address.upper(), new_tag()))
    refused(r, "flood")
    assert 1 <= int(r.headers["Retry-After"]) <= FLOOD_WINDOW
    assert stored_for(address) == FLOOD_LIMIT
    assert scalar(f"SELECT count(*) AS n FROM outbox WHERE lower(to_address) = {lit(address.lower())}") == FLOOD_LIMIT
    assert len(mails_to(mail, address, FLOOD_LIMIT)) == FLOOD_LIMIT


def test_wf_invalid_inquiry_and_flood_limit_rejected_composer_refusal(browser: Browser, app_url: str) -> None:
    tag, address = new_tag(), visitor()
    for _ in range(FLOOD_LIMIT):
        assert send(app_url, "/api/inquiries", inquiry_body(address, new_tag())).status_code == 201
    with open_app(browser, f"{app_url}/start") as page:
        consent(page, app_url)
        page.get_by_role("button", name=re.compile(r"^Refresh a brand")).click()
        expect(page.get_by_role("checkbox", name="Branding", exact=True)).to_be_checked()
        fill_composer(page, f"Ada {tag}", address, MESSAGE)
        advance(page, SEARCH_SETTLE_MS)
        page.get_by_role("button", name="Send inquiry").click()
        advance_until(page, page.get_by_text(M["flood"][2]))
        expect(page.get_by_role("textbox", name="Your name")).to_have_value(f"Ada {tag}")
        expect(page.get_by_role("textbox", name="Email", exact=True)).to_have_value(address)
        expect(page.get_by_role("textbox", name="Tell us more")).to_have_value(MESSAGE)
        expect(page.get_by_role("checkbox", name="Branding", exact=True)).to_be_checked()
    assert stored_for(address) == FLOOD_LIMIT


def test_wf_idempotent_inquiry_submission_replay(app_url: str, mail: Any) -> None:
    tag, address, key = new_tag(), visitor(), uuid.uuid4().hex
    body = inquiry_body(address, tag)
    first = send(app_url, "/api/inquiries", body, key=key)
    assert first.status_code == 201
    reordered = json.dumps(dict(reversed(list(body.items()))), indent=2).encode()
    for _ in range(FLOOD_LIMIT):
        replay = send(app_url, "/api/inquiries", raw=reordered, key=key)
        assert replay.status_code == 200 and replay.json() == first.json()
    refused(send(app_url, "/api/inquiries", {**body, "message": MESSAGE + " Also an app."}, key=key), "inquiry_key")
    for bad in ("short", "has space key", "k" * (KEY_MAX + 1), "bad!key#12"):
        refused(send(app_url, "/api/inquiries", inquiry_body(address, new_tag()), key=bad), "key")
    assert stored_for(address) == 1
    assert send(app_url, "/api/inquiries", inquiry_body(address, new_tag()), key="k" * KEY_MAX).status_code == 201
    assert send(app_url, "/api/inquiries", inquiry_body(address, new_tag()), key="k-_" + "9" * (KEY_MIN - 3)).status_code == 201
    for _ in range(FLOOD_LIMIT - 3):
        assert send(app_url, "/api/inquiries", inquiry_body(address, new_tag())).status_code == 201
    refused(send(app_url, "/api/inquiries", inquiry_body(address, new_tag())), "flood")
    assert stored_for(address) == FLOOD_LIMIT
    iid = find(app_url, first.json()["reference"])["id"]
    assert outbox_count(iid) == 1
    assert len([m for m in mails_to(mail, address, FLOOD_LIMIT) if first.json()["reference"] in m["Subject"]]) == 1


def test_wf_idempotent_inquiry_submission_simultaneous(app_url: str, mail: Any) -> None:
    address, key = visitor(), idempotency_key_value()
    body = inquiry_body(address, new_tag())
    results = together(lambda: send(app_url, "/api/inquiries", body, key=key),
                       lambda: send(app_url, "/api/inquiries", body, key=key))
    assert sorted(r.status_code for r in results) == [200, 201], [r.text for r in results]
    assert results[0].json() == results[1].json()
    assert stored_for(address) == 1
    assert len(mails_to(mail, address, 1)) == 1
    for _ in range(FLOOD_LIMIT - 1):
        assert send(app_url, "/api/inquiries", inquiry_body(address, new_tag())).status_code == 201
    refused(send(app_url, "/api/inquiries", inquiry_body(address, new_tag())), "flood")


def idempotency_key_value() -> str:
    from conftest import idempotency_key
    return idempotency_key()


def test_wf_idempotent_inquiry_submission_key_lifetime(app_url: str) -> None:
    ttl = 10
    address, key = visitor(), idempotency_key_value()
    body = inquiry_body(address, new_tag())
    with app_copy(NP_IDEMPOTENCY_TTL_SECONDS=str(ttl)) as copy:
        first = send(copy, "/api/inquiries", body, key=key)
        assert first.status_code == 201
        replay = send(copy, "/api/inquiries", body, key=key)
        assert replay.status_code == 200 and replay.json() == first.json()
        fresh = poll(lambda: (lambda r: r if r.status_code == 201 else None)(send(copy, "/api/inquiries", body, key=key)),
                     ttl + MAIL_DEADLINE_S, "key was never forgotten after its lifetime")
        assert fresh.json()["reference"] != first.json()["reference"]
    assert stored_for(address) == 2


def test_wf_unauthenticated_studio_endpoints_denied_sign_in(app_url: str) -> None:
    for account, role in ((LEAD, "lead"), (ASSOCIATE, "associate")):
        r = send(app_url, "/api/auth/login", {"email": account[1], "password": PASSWORD, "role": "lead"})
        assert r.status_code == 200, r.text
        out = r.json()
        assert len(out["token"]) >= SESSION_TOKEN_MIN and URL_SAFE.match(out["token"])
        assert {k: out["user"][k] for k in ("name", "email", "role")} == {"name": account[0], "email": account[1], "role": role}
        me = get(app_url, "/api/me", out["token"])
        assert me.status_code == 200 and me.json() == out["user"]
        assert scalar(f"SELECT count(*) AS n FROM sessions WHERE token_hash = {lit(out['token'])}") == 0
        logout = send(app_url, "/api/auth/logout", {}, out["token"])
        assert logout.status_code == 204
        refused(get(app_url, "/api/me", out["token"]), "sign_in")
    for row in db("SELECT password_hash FROM studio_users"):
        assert row["password_hash"] and PASSWORD not in row["password_hash"]
    wrong = send(app_url, "/api/auth/login", {"email": LEAD[1], "password": PASSWORD + "x"})
    unknown = send(app_url, "/api/auth/login", {"email": visitor(), "password": PASSWORD})
    refused(wrong, "credentials")
    assert wrong.content == unknown.content and wrong.status_code == unknown.status_code
    assert send(app_url, "/api/auth/login", {"email": LEAD[1], "password": PASSWORD}).status_code == 200


def test_wf_unauthenticated_studio_endpoints_denied_roles(app_url: str) -> None:
    for account, role in ((LEAD, "lead"), (ASSOCIATE, "associate")):
        forged = "associate" if role == "lead" else "lead"
        r = send(app_url, "/api/auth/login", {"email": account[1], "password": PASSWORD, "role": forged})
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        assert user["role"] == role and user["name"] == account[0]
        assert ok(get(app_url, "/api/me", r.json()["token"]))["role"] == role
    ole = sign_in(app_url, ASSOCIATE)
    inq = create(app_url)
    note = send(app_url, f"/api/studio/inquiries/{inq['id']}/notes", {"body": "Role check.", "role": "lead"}, ole)
    assert note.status_code == 201, note.text
    refused(act(app_url, ole, inq["id"], "decline", 1, decline_reason="budget", role="lead"), "lead_only")
    assert ok(get(app_url, "/api/me", ole))["role"] == "associate"
    assert db(f"SELECT role FROM studio_users WHERE email = {lit(ASSOCIATE[1])}") == [{"role": "associate"}]
    assert db(f"SELECT role FROM studio_users WHERE email = {lit(LEAD[1])}") == [{"role": "lead"}]


def test_wf_unauthenticated_studio_endpoints_denied_endpoints_refused(app_url: str) -> None:
    inq = create(app_url)
    ended = send(app_url, "/api/auth/login", {"email": LEAD[1], "password": PASSWORD}).json()["token"]
    assert send(app_url, "/api/auth/logout", {}, ended).status_code == 204
    for token in (None, "not-a-real-token", ended):
        refused(get(app_url, "/api/me", token), "sign_in")
        refused(get(app_url, "/api/studio/inquiries", token), "sign_in")
        refused(get(app_url, f"/api/studio/inquiries/{inq['id']}", token), "sign_in")
        refused(act(app_url, token or "", inq["id"], "start_review", 1) if token else
                send(app_url, f"/api/studio/inquiries/{inq['id']}/transition", {"action": "start_review", "version": 1}), "sign_in")
        refused(send(app_url, f"/api/studio/inquiries/{inq['id']}/notes", {"body": "hello"}, token), "sign_in")
    after = detail(app_url, inq["id"])
    assert after["version"] == 1 and after["status"] == "new" and after["notes"] == []


def test_wf_unauthenticated_studio_endpoints_denied_no_signup(app_url: str) -> None:
    probe = visitor()
    before = scalar("SELECT count(*) AS n FROM studio_users")
    for method in ("POST", "GET"):
        r = send(app_url, "/api/auth/signup", {"email": probe, "password": PASSWORD, "name": "Eve", "role": "lead"}, method=method)
        refused(r, "not_found")
    refused(send(app_url, "/api/auth/login", {"email": probe, "password": PASSWORD}), "credentials")
    assert scalar(f"SELECT count(*) AS n FROM studio_users WHERE email = {lit(probe.lower())}") == 0
    assert scalar("SELECT count(*) AS n FROM studio_users") == before


def test_wf_unauthenticated_studio_endpoints_denied_sign_in_page(browser: Browser, app_url: str) -> None:
    for path in ("/studio", "/studio/inquiries/1?status=new&q=abc"):
        r = httpx.get(app_url + path, follow_redirects=False, timeout=HTTP_TIMEOUT)
        assert r.is_redirect, path
        location = urllib.parse.urlsplit(r.headers["location"])
        assert location.path == "/studio/signin"
        assert urllib.parse.parse_qs(location.query)["next"] == [path]
    inq = create(app_url)
    allowed = f"/studio/inquiries/{inq['id']}?status=all"
    cases = [(None, "/studio"), (allowed, f"/studio/inquiries/{inq['id']}"),
             (FOREIGN_ORIGIN.removeprefix("http:") + "/studio", "/studio"),
             (FOREIGN_ORIGIN.replace("http:", "https:") + "/studio", "/studio"),
             ("/elsewhere", "/studio"), ("/studiox", "/studio")]
    context = browser.new_context(viewport=DESKTOP)
    try:
        page = context.new_page()
        page.goto(f"{app_url}/studio")
        page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == "/studio/signin")
        for nxt, landing in cases:
            url = f"{app_url}/studio/signin" + (f"?next={urllib.parse.quote(nxt, safe='')}" if nxt else "")
            page.goto(url)
            ui_sign_in(page, LEAD)
            page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == landing)
            assert urllib.parse.urlsplit(page.url).netloc == urllib.parse.urlsplit(app_url).netloc
            page.get_by_role("button", name="Sign out").click()
            page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == "/studio/signin")
    finally:
        context.close()


def test_wf_unauthenticated_studio_endpoints_denied_sign_in_limit(browser: Browser, app_url: str) -> None:
    stranger, other = visitor(), visitor()
    for _ in range(SIGNIN_LIMIT):
        refused(send(app_url, "/api/auth/login", {"email": stranger, "password": "wrong-pass"}), "credentials")
    locked = send(app_url, "/api/auth/login", {"email": stranger.upper(), "password": "wrong-pass"})
    refused(locked, "signin_limit")
    assert 1 <= int(locked.headers["Retry-After"]) <= SIGNIN_WINDOW
    refused(send(app_url, "/api/auth/login", {"email": other, "password": "wrong-pass"}), "credentials")
    window = 30
    with app_copy(NP_SIGNIN_WINDOW_SECONDS=str(window)) as copy:
        with plain(browser, f"{copy}/studio/signin", viewport=DESKTOP) as page:
            status = page.get_by_role("status", name="Sign-in status")
            for _ in range(SIGNIN_LIMIT):
                ui_sign_in(page, ASSOCIATE, "not-the-password")
                expect(status).to_have_text(has_ci(M["credentials"][2]))
            ui_sign_in(page, ASSOCIATE)
            expect(status).to_have_text(has_ci(M["signin_limit"][2]))
            assert urllib.parse.urlsplit(page.url).path == "/studio/signin"
        r = send(copy, "/api/auth/login", {"email": ASSOCIATE[1], "password": PASSWORD})
        refused(r, "signin_limit")
        assert 1 <= int(r.headers["Retry-After"]) <= window
        assert send(copy, "/api/auth/login", {"email": LEAD[1], "password": PASSWORD}).status_code == 200
        poll(lambda: send(copy, "/api/auth/login", {"email": ASSOCIATE[1], "password": PASSWORD}).status_code == 200,
             window + MAIL_DEADLINE_S, "the lockout never lifted after the sign-in window")
    assert send(app_url, "/api/auth/login", {"email": ASSOCIATE[1], "password": PASSWORD}).status_code == 200


def test_wf_associate_limited_to_their_actions_lead_only_refused(app_url: str) -> None:
    ole = sign_in(app_url, ASSOCIATE)
    inq = create(app_url)

    def unchanged(expect_version: int) -> None:
        now = detail(app_url, inq["id"])
        assert now["version"] == expect_version and events_count(inq["id"]) == expect_version
        assert outbox_count(inq["id"]) == expect_version

    for action in LEAD_ONLY:
        refused(act(app_url, ole, inq["id"], action, 1, decline_reason="budget"), "lead_only")
    unchanged(1)
    current = ok(act(app_url, ole, inq["id"], "start_review", 1))
    assert current["status"] == "in_review" and current["history"][-1]["actor_name"] == ASSOCIATE[0]
    current, _slot = book(app_url, {**inq, **current}, ole)
    current, _slot = book(app_url, current, ole, free_start(app_url, iso(inq["created_at"])))
    assert current["status"] == "call_booked" and current["version"] == 4
    assert current["history"][-1]["action"] == "reschedule_call" and current["history"][-1]["actor_name"] == ASSOCIATE[0]
    for action in LEAD_ONLY:
        refused(act(app_url, ole, inq["id"], action, 4, decline_reason="budget"), "lead_only")
    unchanged(4)
    declined = decline(app_url, current)
    refused(act(app_url, ole, inq["id"], "reopen", declined["version"]), "lead_only")
    unchanged(declined["version"])
    assert detail(app_url, inq["id"])["status"] == "declined"


def expected_actions(status: str, role: str) -> list[str]:
    return [a for a, frm, _to, who in TRANSITIONS if status in frm and role in who]


def action_buttons(page: Page) -> list[str]:
    found = []
    for action, label in BUTTONS.items():
        for button in page.get_by_role("button", name=label, exact=True).all():
            found.append((button.evaluate("e => [...document.querySelectorAll('*')].indexOf(e)"), action))
    return [action for _, action in sorted(found)]


def test_wf_associate_limited_to_their_actions_allowed_actions(browser: Browser, app_url: str) -> None:
    lead, ole = sign_in(app_url), sign_in(app_url, ASSOCIATE)
    inq = create(app_url)

    def check(iid: int, status: str) -> None:
        for token, role in ((lead, "lead"), (ole, "associate")):
            got = detail(app_url, iid, token)
            assert got["status"] == status
            assert got["allowed_actions"] == expected_actions(status, role), (status, role)

    check(inq["id"], "new")
    inq = review(app_url, inq)
    check(inq["id"], "in_review")
    inq, _slot = book(app_url, inq)
    check(inq["id"], "call_booked")
    for account, role in ((LEAD, "lead"), (ASSOCIATE, "associate")):
        with studio(browser, app_url, account, f"/studio/inquiries/{inq['id']}?status=call_booked") as page:
            expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["call_booked"]))).to_be_visible()
            poll(lambda: action_buttons(page) == expected_actions("call_booked", role), MAIL_DEADLINE_S,
                 lambda: (role, action_buttons(page)))
            for action in ACTIONS:
                if action not in expected_actions("call_booked", role):
                    expect(page.get_by_role("button", name=BUTTONS[action], exact=True)).to_have_count(0)
    won = find(app_url, "NP-W8DK5T")
    check(won["id"], "won")
    declined = decline(app_url, inq)
    check(declined["id"], "declined")


def test_wf_associate_limited_to_their_actions_associate_journey(browser: Browser, app_url: str, mail: Any) -> None:
    inq = create(app_url)
    secret = f"Internal note {inq['tag']}"
    assert add_note(app_url, inq["id"], secret).status_code == 201
    slot = free_start(app_url, iso(inq["created_at"]), at_time=(10, 0))
    lead_only = [BUTTONS[a] for a in LEAD_ONLY]
    with open_app(browser, f"{app_url}/inquiry/{inq['status_token']}") as status_page:
        expect(status_page.get_by_role("heading", level=1, name=exact_ci("New"))).to_be_visible()
        with studio(browser, app_url, ASSOCIATE, f"/studio?status=new&q={inq['tag']}") as page:

            def no_lead_buttons() -> None:
                for name in lead_only:
                    expect(page.get_by_role("button", name=name, exact=True)).to_have_count(0)

            page.get_by_role("list", name="Inquiries").get_by_role("link", name=re.compile("^" + inq["reference"])).click()
            page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == f"/studio/inquiries/{inq['id']}")
            no_lead_buttons()
            page.get_by_role("button", name="Start review", exact=True).click()
            expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["in_review"]))).to_be_visible()
            no_lead_buttons()
            page.get_by_role("button", name="Book call", exact=True).click()
            page.get_by_label("Call time").fill(wall(slot))
            page.get_by_role("group", name="Book call").get_by_role("button", name="Confirm").click()
            expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["call_booked"]))).to_be_visible()
            no_lead_buttons()
        stored = detail(app_url, inq["id"])
        assert stored["status"] == "call_booked" and stored["call_at"] == zulu(slot)
        assert stored["history"][-1]["actor_name"] == ASSOCIATE[0]
        advance(status_page, RECHECK_MS)
        advance_until(status_page, status_page.get_by_role("heading", level=1, name=exact_ci("Call booked")))
        expect(status_page.get_by_role("status", name="Inquiry status")).to_have_text(
            has_ci(LINES["call_booked"].format(call=call_label(slot))))
    booked = [m for m in mails_to(mail, inq["address"], 3) if m["Subject"].endswith("is now Call booked")]
    assert len(booked) == 1 and len(calendar_parts(booked[0])) == 1
    dump = json.dumps(booked[0], ensure_ascii=False)
    for private in (ASSOCIATE[0], ASSOCIATE[1], secret):
        assert private not in dump


def test_wf_associate_limited_to_their_actions_keyboard_booking(browser: Browser, app_url: str) -> None:
    inq = create(app_url)
    now = iso(inq["created_at"])
    first_day = local_date(now) + dt.timedelta(days=2)
    saturday = first_day + dt.timedelta(days=(5 - first_day.weekday()) % 7)
    closure = next((d for d in (first_day + dt.timedelta(days=i) for i in range(SLOT_HORIZON_DAYS))
                    if d.weekday() < 5 and not studio_day(d)), None)
    slot = free_start(app_url, now, at_time=(10, 0))
    lead_only = [BUTTONS[a] for a in LEAD_ONLY]
    with contextlib.closing(browser.new_context(viewport=DESKTOP, timezone_id=BROWSER_ZONE)) as context:
        try:
            page = context.new_page()
            page.goto(f"{app_url}/studio/signin")
            page.get_by_role("textbox", name="Email", exact=True).focus()
            page.keyboard.type(ASSOCIATE[1])
            page.get_by_label("Password", exact=True).focus()
            page.keyboard.type(PASSWORD)
            page.keyboard.press("Enter")
            page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == "/studio")
            page.goto(f"{app_url}/studio?status=new&q={inq['tag']}")
            expect(tab(page, "New", 1)).to_be_visible()
            expect(tab(page, "Call booked", 0)).to_be_visible()
            row = page.get_by_role("list", name="Inquiries").get_by_role("link", name=re.compile("^" + inq["reference"]))
            row.focus()
            page.keyboard.press("Enter")
            page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == f"/studio/inquiries/{inq['id']}")
            assert query_of(page.url).get("q") == [inq["tag"]]

            def no_lead_buttons() -> None:
                for name in lead_only:
                    expect(page.get_by_role("button", name=name, exact=True)).to_have_count(0)

            start = page.get_by_role("button", name="Start review", exact=True)
            expect(start).to_be_visible()
            no_lead_buttons()
            start.focus()
            page.keyboard.press("Enter")
            expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["in_review"]))).to_be_focused()
            expect(page.get_by_role("status", name="Action status")).to_have_text(exact_ci("Status changed to In review."))
            no_lead_buttons()
            opener = page.get_by_role("button", name="Book call", exact=True)
            opener.focus()
            page.keyboard.press("Enter")
            field = page.get_by_label("Call time")
            expect(field).to_be_focused()
            field.fill(wall(at(saturday, 10)))
            field.press("Enter")
            expect(field).to_have_attribute("aria-invalid", "true")
            expect(field).to_have_accessible_description(has_ci(M["hours"][2]))
            expect(field).to_be_focused()
            page.keyboard.press("Escape")
            poll(lambda: gone(page.get_by_role("group", name="Book call")), MAIL_DEADLINE_S, "the Book call panel stayed open")
            expect(opener).to_be_focused()
            page.keyboard.press("Enter")
            expect(field).to_be_focused()
            expect(field).to_have_value("")
            expect(field).not_to_have_attribute("aria-invalid", "true")
            if closure is not None:
                field.fill(wall(at(closure, 10)))
                field.press("Enter")
                expect(field).to_have_accessible_description(has_ci(M["closed"][2]))
                expect(field).to_have_attribute("aria-invalid", "true")
            assert detail(app_url, inq["id"])["status"] == "in_review"
            field.fill(wall(slot))
            field.press("Enter")
            expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["call_booked"]))).to_be_focused()
            poll(lambda: gone(page.get_by_role("group", name="Book call")), MAIL_DEADLINE_S, "the Book call panel stayed open")
            expect(page.get_by_role("status", name="Action status")).to_have_text(exact_ci("Status changed to Call booked."))
            expect(tab(page, "New", 0)).to_be_visible()
            expect(tab(page, "Call booked", 1)).to_be_visible()
            no_lead_buttons()
        finally:
            page.close()
    stored = detail(app_url, inq["id"])
    assert stored["status"] == "call_booked" and stored["call_at"] == zulu(slot)


def test_wf_pipeline_table_enforced_transitions(app_url: str) -> None:
    lead = sign_in(app_url)
    inq = create(app_url)
    path = ["start_review", "book_call", "reschedule_call", "decline", "reopen"]
    status = "new"
    for step in path:
        for action in ACTIONS + ["archive"]:
            if action in expected_actions(status, "lead"):
                continue
            before = (inq["version"], events_count(inq["id"]), outbox_count(inq["id"]))
            r = act(app_url, lead, inq["id"], action, inq["version"], call_at=wall(free_start(app_url, iso(inq["created_at"]))),
                    decline_reason="budget")
            refused(r, "not_allowed")
            assert (detail(app_url, inq["id"])["version"], events_count(inq["id"]), outbox_count(inq["id"])) == before
        fields: dict[str, Any] = {}
        if step in ("book_call", "reschedule_call"):
            fields["call_at"] = wall(free_start(app_url, iso(inq["created_at"])))
        if step == "decline":
            fields["decline_reason"] = "budget"
        out = ok(act(app_url, lead, inq["id"], step, inq["version"], **fields))
        target = next(t[2] for t in TRANSITIONS if t[0] == step)
        assert out["status"] == target and out["version"] == inq["version"] + 1
        assert len(out["history"]) == out["version"]
        last = out["history"][-1]
        assert (last["action"], last["from_status"], last["to_status"], last["actor_name"]) == (step, status, target, LEAD[0])
        inq, status = {**inq, **out}, target
    won = find(app_url, "NP-W8DK5T")
    for action in ACTIONS:
        refused(act(app_url, lead, won["id"], action, won["version"], decline_reason="budget"), "not_allowed")
    assert detail(app_url, won["id"])["version"] == won["version"]


def test_wf_pipeline_table_enforced_server_owned_fields(app_url: str) -> None:
    tag, address = new_tag(), visitor()
    forged = {"reference": "NP-AAAAAA", "status": "won", "status_token": f"seed-{tag}-status-link", "version": 7, "id": 1,
              "created_at": "2000-01-01T00:00:00Z", "role": "lead", "actor_name": "Ole Berg"}
    r = send(app_url, "/api/inquiries", {**inquiry_body(address, tag), **forged})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["reference"] != forged["reference"] and out["status"] == "new" and out["status_token"] != forged["status_token"]
    row = db(f"SELECT id, status, version, status_token, created_at FROM inquiries WHERE reference = {lit(out['reference'])}")[0]
    assert (row["status"], row["version"], row["status_token"]) == ("new", 1, out["status_token"])
    assert not str(row["created_at"]).startswith("2000")
    reviewed = ok(act(app_url, sign_in(app_url), row["id"], "start_review", 1, status="won", reference="NP-AAAAAA",
                      actor_name=ASSOCIATE[0], actor_id=2, created_at="2000-01-01T00:00:00Z", status_token="x" * TOKEN_MIN))
    assert reviewed["status"] == "in_review" and reviewed["reference"] == out["reference"] and reviewed["version"] == 2
    assert reviewed["history"][-1]["actor_name"] == LEAD[0]
    note = send(app_url, f"/api/studio/inquiries/{row['id']}/notes",
                {"body": "Checked the brief.", "author_name": ASSOCIATE[0], "author_id": 2, "id": 1}, sign_in(app_url))
    assert note.status_code == 201 and note.json()["author_name"] == LEAD[0]
    assert db(f"SELECT status_token, version FROM inquiries WHERE id = {int(row['id'])}") == \
        [{"status_token": out["status_token"], "version": 2}]


def test_wf_pipeline_table_enforced_refusal_order(browser: Browser, app_url: str) -> None:
    lead, ole = sign_in(app_url), sign_in(app_url, ASSOCIATE)
    inq = create(app_url)
    big = b"{" + b" " * (BODY_LIMIT + 10) + b"}"
    for path in (f"/api/inquiries/status/{inq['status_token']}", "/api/inquiries/status/no-such-token"):
        r = send(app_url, path, raw=big)
        refused(r, "method")
        assert r.headers["Allow"] == "GET, HEAD"
    page = send(app_url, "/inquiry/no-such-token", raw=big)
    assert page.status_code == 405 and page.headers["Allow"] == "GET, HEAD"
    refused(send(app_url, f"/api/studio/inquiries/{inq['id']}/transition", raw=b"{" + b" " * BODY_LIMIT + b"}"), "too_large")
    refused(get(app_url, "/api/studio/inquiries/999999999999"), "sign_in")
    for bad_id in ("999999999999", "abc", "99999999999999999999999999"):
        refused(send(app_url, f"/api/studio/inquiries/{bad_id}/transition", raw=b"not json", token=lead), "not_found")
    refused(get(app_url, UNKNOWN_API_PATH), "not_found")
    refused(send(app_url, f"/api/studio/inquiries/{inq['id']}/transition", raw=b"[1]", token=ole), "body")
    refused(act(app_url, ole, inq["id"], "decline", 1, key="bad key!", decline_reason="budget"), "key")
    refused(act(app_url, ole, inq["id"], "decline", 99, decline_reason="budget"), "lead_only")
    refused(act(app_url, lead, inq["id"], "mark_won", 99), "stale")
    refused(act(app_url, lead, inq["id"], "book_call", 1, call_at="garbage"), "not_allowed")
    assert detail(app_url, inq["id"])["version"] == 1
    address = visitor()
    for _ in range(FLOOD_LIMIT):
        assert send(app_url, "/api/inquiries", inquiry_body(address, new_tag())).status_code == 201
    refused(send(app_url, "/api/inquiries", inquiry_body(address, new_tag(), message="short")), "message_short")
    base = inquiry_body(visitor(), new_tag(), padding="")
    base["padding"] = "x" * (BODY_LIMIT - len(encode(base)))
    assert len(encode(base)) == BODY_LIMIT
    assert send(app_url, "/api/inquiries", base).status_code == 201
    base["padding"] += "x"
    refused(send(app_url, "/api/inquiries", base), "too_large")
    with studio(browser, app_url, LEAD) as signed_in:
        cookie = "; ".join(f"{c['name']}={c['value']}" for c in signed_in.context.cookies())
    notes_path = f"/api/studio/inquiries/{inq['id']}/notes"
    refused(send(app_url, notes_path, {"body": "From afar."}, headers={"Cookie": cookie, "Origin": FOREIGN_ORIGIN}), "cross_origin")
    assert detail(app_url, inq["id"])["notes"] == []
    assert send(app_url, notes_path, {"body": "From home."}, headers={"Cookie": cookie}).status_code == 201


WRONG = {
    "version_true": ("transition", "new", {"action": "start_review", "version": True}, "stale"),
    "version_fraction": ("transition", "new", {"action": "start_review", "version": 1.0}, "stale"),
    "version_exponent": ("transition", "new", {"action": "start_review", "version": Raw("1e0")}, "stale"),
    "version_string": ("transition", "new", {"action": "start_review", "version": "1"}, "stale"),
    "version_null": ("transition", "new", {"action": "start_review", "version": None}, "stale"),
    "version_absent": ("transition", "new", {"action": "start_review", "version": ABSENT}, "stale"),
    "action_number": ("transition", "new", {"action": 1}, "not_allowed"),
    "call_at_number": ("transition", "in_review", {"action": "book_call", "call_at": 202611021000}, "future"),
    "decline_reason_list": ("transition", "new", {"action": "decline", "decline_reason": ["budget"]}, "reason"),
    "name_number": ("inquiry", None, {"name": 7}, "name_blank"),
    "email_list": ("inquiry", None, {"email": ["ada@example.com"]}, "email"),
    "company_number": ("inquiry", None, {"company": 12}, "company_long"),
    "services_string": ("inquiry", None, {"services": "design"}, "services"),
    "services_number_item": ("inquiry", None, {"services": ["design", 3]}, "services"),
    "budget_number": ("inquiry", None, {"budget": 25}, "budget"),
    "timeline_bool": ("inquiry", None, {"timeline": True}, "timeline"),
    "message_number": ("inquiry", None, {"message": 123456789012345678901234567890}, "message_short"),
    "note_body_number": ("note", None, {"body": 5}, "note_blank"),
    "login_email_number": ("login", None, {"email": 1, "password": PASSWORD}, "credentials"),
    "login_password_absent": ("login", None, {"password": ABSENT}, "credentials"),
    "name_control": ("inquiry", None, {"name": "Ada\u0007 Lind"}, "name"),
    "name_line_feed": ("inquiry", None, {"name": "Ada Lind\n"}, "name"),
    "email_nul": ("inquiry", None, {"email": "ada\u0000@example.com"}, ("unsupported", "email")),
    "company_tab": ("inquiry", None, {"company": "Kelp\tCo"}, "company"),
    "message_escape": ("inquiry", None, {"message": MESSAGE + "\u001b"}, "message"),
    "message_delete": ("inquiry", None, {"message": MESSAGE + "\u007f"}, "message"),
    "message_unpaired_surrogate": ("inquiry", None, {"message": Raw(json.dumps(MESSAGE)[:-1] + "\\ud83d\"")}, "message"),
    "note_control": ("note", None, {"body": "Call them back\u0001"}, ("unsupported", "body")),
    "q_control": ("queue", None, {"q": "ab\u0001"}, "q"),
}


WRONG_IDS = [
    "version_true", "version_fraction", "version_exponent", "version_string", "version_null", "version_absent",
    "action_number", "call_at_number", "decline_reason_list", "name_number", "email_list", "company_number",
    "services_string", "services_number_item", "budget_number", "timeline_bool", "message_number",
    "note_body_number", "login_email_number", "login_password_absent", "name_control", "name_line_feed",
    "email_nul", "company_tab", "message_escape", "message_delete", "message_unpaired_surrogate",
    "note_control", "q_control",
]


@pytest.mark.parametrize("case", WRONG_IDS, ids=WRONG_IDS)
def test_wf_pipeline_table_enforced_wrong_types(app_url: str, case: str) -> None:
    kind, status, over, expected = WRONG[case]
    lead = sign_in(app_url)
    if kind == "inquiry":
        tag, address = new_tag(), visitor()
        r = send(app_url, "/api/inquiries", {**inquiry_body(address, tag), **over})
        count = scalar(f"SELECT count(*) AS n FROM inquiries WHERE lower(email) = {lit(address.lower())} "
                       f"OR strpos(coalesce(company, ''), {lit(tag)}) > 0")
        assert count == 0
    elif kind == "login":
        address = visitor()
        r = send(app_url, "/api/auth/login", {"email": address, "password": PASSWORD, **over})
        if case == "login_password_absent":
            for _ in range(SIGNIN_LIMIT):
                send(app_url, "/api/auth/login", {"email": address, "password": PASSWORD, **over})
            refused(send(app_url, "/api/auth/login", {"email": address, "password": "wrong-pass"}), "credentials")
    elif kind == "queue":
        r = queue(app_url, lead, **over)
    else:
        inq = create(app_url)
        if status == "in_review":
            inq = review(app_url, inq)
        before = (inq["version"], events_count(inq["id"]), outbox_count(inq["id"]))
        if kind == "note":
            r = send(app_url, f"/api/studio/inquiries/{inq['id']}/notes", over, lead)
        else:
            r = send(app_url, f"/api/studio/inquiries/{inq['id']}/transition", {"version": inq["version"], **over}, lead)
        after = detail(app_url, inq["id"])
        assert (after["version"], events_count(inq["id"]), outbox_count(inq["id"])) == before
        assert after["notes"] == []
    assert r.status_code < 500
    if isinstance(expected, tuple):
        refused_field(r, 422, expected[1], UNSUPPORTED)
    elif expected in M:
        refused(r, expected)
    else:
        refused_field(r, 422, expected, UNSUPPORTED)


def test_wf_studio_moves_inquiry_through_pipeline_lead_journey(browser: Browser, app_url: str) -> None:
    inq = create(app_url)
    with studio(browser, app_url, LEAD, f"/studio/inquiries/{inq['id']}?status=new&q={inq['tag']}") as page:
        expect(tab(page, "New", 1)).to_be_visible()
        expect(tab(page, "In review", 0)).to_be_visible()
        expect(page.get_by_role("list", name="History")).to_be_attached()
        history = page.get_by_role("list", name="History").get_by_role("listitem")
        shown_before = history.count()
        assert shown_before in (0, 1), shown_before
        page.get_by_role("button", name="Start review", exact=True).click()
        expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["in_review"]))).to_be_visible()
        expect(history).to_have_count(shown_before + 1)
        expect(history.last).to_contain_text(LEAD[0])
        expect(tab(page, "New", 0)).to_be_visible()
        expect(tab(page, "In review", 1)).to_be_visible()
        assert public(app_url, inq["status_token"]).json()["status"] == "in_review"
        q7 = find(app_url, "NP-Q7LD4V")
        page.goto(f"{app_url}/studio/inquiries/{q7['id']}?status=call_booked&q=NP-Q7LD4V")
        if q7["status"] == "call_booked":
            expect(tab(page, "Call booked", 1)).to_be_visible()
            expect(tab(page, "Won", 0)).to_be_visible()
            entries = page.get_by_role("list", name="History").get_by_role("listitem")
            accepted = (len(q7["history"]), len(q7["history"]) - 1)
            listed = poll(lambda: entries.count() if entries.count() in accepted else 0, MAIL_DEADLINE_S,
                          lambda: (entries.count(), accepted))
            page.get_by_role("button", name="Mark won", exact=True).click()
            expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["won"]))).to_be_visible()
            expect(entries).to_have_count(listed + 1)
            expect(entries.last).to_contain_text(LEAD[0])
            expect(tab(page, "Won", 1)).to_be_visible()
            expect(tab(page, "Call booked", 0)).to_be_visible()
        else:
            expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["won"]))).to_be_visible()
        expect(page.get_by_role("button", name="Mark won", exact=True)).to_have_count(0)
    assert db("SELECT status FROM inquiries WHERE reference = 'NP-Q7LD4V'") == [{"status": "won"}]
    with plain(browser, f"{app_url}/inquiry/{Q7_TOKEN}") as status_page:
        expect(status_page.get_by_role("heading", level=1, name=exact_ci("Won"))).to_be_visible()


def test_wf_studio_moves_inquiry_through_pipeline_emails(app_url: str, mail: Any) -> None:
    tag = new_tag()
    inq = create(app_url, tag=tag, name=f"  Ada {tag}  ")
    ole = sign_in(app_url, ASSOCIATE)
    secrets = [f"Lead note {tag}", f"Associate note {tag}"]
    assert add_note(app_url, inq["id"], secrets[0]).status_code == 201
    assert add_note(app_url, inq["id"], secrets[1], ASSOCIATE).status_code == 201
    key = idempotency_key_value()
    reviewed = ok(act(app_url, sign_in(app_url), inq["id"], "start_review", 1, key=key))
    assert act(app_url, sign_in(app_url), inq["id"], "start_review", 1, key=key).status_code == 200
    refused(act(app_url, sign_in(app_url), inq["id"], "start_review", 1), "stale")
    current, first_slot = book(app_url, {**inq, **reviewed}, ole)
    current, second_slot = book(app_url, current)
    current = decline(app_url, current, "timeline")
    current = {**current, **ok(act(app_url, sign_in(app_url), inq["id"], "reopen", current["version"]))}
    assert outbox_count(inq["id"]) == 6
    ref, url = inq["reference"], inq["status_url"]
    expected = [
        (f"We have your inquiry {ref}", f"Hi Ada {tag},\n\nWe have your inquiry {ref}.\n\nFollow your inquiry: {url}"),
        (f"Your inquiry {ref} is now In review", f"{LINES['in_review']}\n\nFollow your inquiry: {url}"),
        (f"Your inquiry {ref} is now Call booked", LINES["call_booked"].format(call=call_label(first_slot)) + f"\n\nFollow your inquiry: {url}"),
        (f"Your inquiry {ref} is now Call booked", LINES["call_booked"].format(call=call_label(second_slot)) + f"\n\nFollow your inquiry: {url}"),
        (f"Your inquiry {ref} is now Declined", LINES["declined"].format(reason=REASONS["timeline"]) + f"\n\nFollow your inquiry: {url}"),
        (f"Your inquiry {ref} is now In review", f"{LINES['in_review']}\n\nFollow your inquiry: {url}"),
    ]
    messages = mails_to(mail, inq["address"], len(expected))
    assert len(messages) == len(expected)

    for n, (message, (subject, body)) in enumerate(zip(messages, expected)):
        assert message["MessageID"].strip("<>") == f"{ref}.{n}@northpier.studio"
        assert addresses(message.get("From")) == [STUDIO_FROM]
        assert recipients(message, "To") == [inq["address"]]
        assert recipients(message, "Cc") == [] and recipients(message, "Bcc") == []
        assert set(recipients(message, "ReplyTo")) <= {STUDIO_FROM}
        assert message["Subject"] == subject
        assert body_of(message) == body


def test_wf_studio_moves_inquiry_through_pipeline_private_data(app_url: str, mail: Any) -> None:
    inq = create(app_url)
    ole = sign_in(app_url, ASSOCIATE)
    secrets = [f"Lead note {inq['tag']}", f"Associate note {inq['tag']}"]
    assert add_note(app_url, inq["id"], secrets[0]).status_code == 201
    assert add_note(app_url, inq["id"], secrets[1], ASSOCIATE).status_code == 201
    current = review(app_url, inq, ole)
    current, _slot = book(app_url, current, ole)
    decline(app_url, current, "budget")
    messages = mails_to(mail, inq["address"], 4)
    assert len(messages) == 4
    others = [r for r in SEED if r != inq["reference"]] + ["seed-np"]
    for message in messages:
        assert recipients(message, "To") == [inq["address"]]
        assert recipients(message, "Cc") == [] and recipients(message, "Bcc") == []
        dump = json.dumps(message, ensure_ascii=False)
        for private in [*secrets, LEAD[0], LEAD[1], ASSOCIATE[0], ASSOCIATE[1], "/studio/", *others]:
            assert private not in dump, (message["Subject"], private)


def test_wf_studio_moves_inquiry_through_pipeline_won_after_call(app_url: str) -> None:
    inq, _slot = book(app_url, review(app_url, create(app_url)))
    before = (inq["version"], events_count(inq["id"]), outbox_count(inq["id"]))
    refused(act(app_url, sign_in(app_url), inq["id"], "mark_won", inq["version"]), "not_held")
    after = detail(app_url, inq["id"])
    assert after["status"] == "call_booked"
    assert (after["version"], events_count(inq["id"]), outbox_count(inq["id"])) == before


def test_wf_studio_moves_inquiry_through_pipeline_inquiry_page(browser: Browser, app_url: str) -> None:
    inq = create(app_url)
    with studio(browser, app_url, LEAD, f"/studio?status=new&q={inq['tag']}") as page:
        rows = page.get_by_role("list", name="Inquiries")
        rows.get_by_role("link", name=re.compile("^" + inq["reference"])).click()
        page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == f"/studio/inquiries/{inq['id']}")
        crumb = page.get_by_role("navigation", name="Breadcrumb")
        expect(crumb).to_contain_text(inq["reference"])
        expect(crumb.get_by_role("link", name="Inquiries")).to_be_visible()
        expect(rows).to_be_visible()
        expect(page.get_by_text(f"Ada {inq['tag']}").first).to_be_visible()
        page.evaluate("() => { window.__northpierMark = 1; }")
        page.get_by_role("button", name="Start review", exact=True).click()
        expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["in_review"]))).to_be_visible()
        expect(page.get_by_role("status", name="Action status")).to_have_text(exact_ci("Status changed to In review."))
        expect(page.get_by_role("button", name="Start review", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="Book call", exact=True)).to_be_visible()
        expect(page.get_by_role("list", name="History")).to_contain_text(LEAD[0])
        expect(tab(page, "New", 0)).to_be_visible()
        expect(tab(page, "In review", 1)).to_be_visible()
        expect(rows.get_by_role("link", name=re.compile("^" + inq["reference"]))).to_have_count(0)
        assert page.evaluate("() => window.__northpierMark") == 1
        current = detail(app_url, inq["id"])
        moved = ok(act(app_url, sign_in(app_url), inq["id"], "decline", current["version"], decline_reason="fully_booked"))
        moved = ok(act(app_url, sign_in(app_url), inq["id"], "reopen", moved["version"]))
        opener = page.get_by_role("button", name="Book call", exact=True)
        opener.click()
        field = page.get_by_label("Call time")
        field.fill(wall(free_start(app_url, iso(inq["created_at"]))))
        page.get_by_role("group", name="Book call").get_by_role("button", name="Confirm").click()
        expect(page.get_by_role("alert")).to_have_text(has_ci(M["stale"][2]))
        expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["in_review"]))).to_be_visible()
        expect(opener).to_be_focused()
        assert detail(app_url, inq["id"])["version"] == moved["version"]
        page.set_viewport_size(TABLET)
        page.reload()
        expect(page.get_by_role("list", name="Inquiries")).to_be_hidden()
        expect(page.get_by_role("navigation", name="Breadcrumb")).to_be_visible()
        page.set_viewport_size(DESKTOP)
        page.get_by_role("navigation", name="Breadcrumb").get_by_role("link", name="Inquiries").click()
        page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path.rstrip("/") == "/studio")
        expect(page.get_by_role("tab", selected=True)).to_have_accessible_name(re.compile(r"^New\b"))
        expect(page.get_by_role("searchbox", name="Search name, company, email or reference")).to_have_value(inq["tag"])


def free_window(base: str, now: dt.datetime, minutes: int) -> dt.datetime:
    return free_start(base, now, minutes=minutes)


def test_wf_concurrent_transitions_one_winner_overlapping_bookings(app_url: str, mail: Any) -> None:
    a, b = review(app_url, create(app_url)), review(app_url, create(app_url))
    start = free_window(app_url, iso(a["created_at"]), CALL_MINUTES + 2 * QUARTER)
    lead, ole = sign_in(app_url), sign_in(app_url, ASSOCIATE)
    results = together(lambda: act(app_url, lead, a["id"], "book_call", a["version"], call_at=wall(start)),
                       lambda: act(app_url, ole, b["id"], "book_call", b["version"], call_at=wall(start + dt.timedelta(minutes=2 * QUARTER))))
    assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
    refused(next(r for r in results if r.status_code == 409), "overlap")
    booked = scalar(f"SELECT count(*) AS n FROM status_events WHERE action = 'book_call' AND inquiry_id IN ({a['id']}, {b['id']})")
    assert booked == 1
    assert outbox_count(a["id"]) + outbox_count(b["id"]) == 5
    winner = a if results[0].status_code == 200 else b
    subjects = [m["Subject"] for m in mails_to(mail, winner["address"], 3)]
    assert subjects.count(f"Your inquiry {winner['reference']} is now Call booked") == 1


def test_wf_concurrent_transitions_one_winner_stale_versions(app_url: str) -> None:
    lead = sign_in(app_url)
    inq = create(app_url)
    refused(act(app_url, lead, inq["id"], "start_review", 5), "stale")
    refused(act(app_url, lead, inq["id"], "start_review", ABSENT), "stale")
    results = together(*[lambda: act(app_url, lead, inq["id"], "start_review", 1) for _ in range(5)])
    assert sorted(r.status_code for r in results) == [200, 412, 412, 412, 412], [r.text for r in results]
    for r in results:
        if r.status_code == 412:
            refused(r, "stale")
    assert scalar(f"SELECT count(*) AS n FROM status_events WHERE inquiry_id = {inq['id']} AND action = 'start_review'") == 1
    assert detail(app_url, inq["id"])["version"] == 2 and outbox_count(inq["id"]) == 2


def test_wf_concurrent_transitions_one_winner_transition_keys(app_url: str) -> None:
    lead, ole = sign_in(app_url), sign_in(app_url, ASSOCIATE)
    inq = create(app_url)
    key = idempotency_key_value()
    first = act(app_url, lead, inq["id"], "start_review", 1, key=key)
    stored = ok(first)
    replay = send(app_url, f"/api/studio/inquiries/{inq['id']}/transition", raw=b'{ "version": 1, "action": "start_review" }',
                  token=lead, key=key)
    assert replay.status_code == 200 and replay.json() == stored
    booked, _slot = book(app_url, {**inq, **stored})
    later = act(app_url, lead, inq["id"], "start_review", 1, key=key)
    assert later.status_code == 200 and later.json() == stored
    assert events_count(inq["id"]) == 3 and outbox_count(inq["id"]) == 3
    refused(act(app_url, lead, inq["id"], "start_review", 2, key=key), "change_key")
    fresh = act(app_url, ole, inq["id"], "reschedule_call", booked["version"], key=key,
                call_at=wall(free_start(app_url, iso(inq["created_at"]))))
    assert fresh.status_code == 200 and fresh.json()["version"] == booked["version"] + 1
    other = create(app_url)
    shared = idempotency_key_value()
    results = together(*[lambda: act(app_url, lead, other["id"], "start_review", 1, key=shared) for _ in range(4)])
    assert [r.status_code for r in results] == [200] * 4, [r.text for r in results]
    assert all(r.json() == results[0].json() for r in results)
    assert events_count(other["id"]) == 2 and outbox_count(other["id"]) == 2


def test_wf_calendar_slots_and_one_booking_per_slot_call_time_checks(app_url: str) -> None:
    lead = sign_in(app_url)
    inq = review(app_url, create(app_url))
    now = iso(inq["created_at"])
    first = local_date(now) + dt.timedelta(days=2)
    day = next(first + dt.timedelta(days=i) for i in range(SLOT_HORIZON_DAYS) if studio_day(first + dt.timedelta(days=i)))
    saturday = first + dt.timedelta(days=(5 - first.weekday()) % 7)
    far = next(local_date(now) + dt.timedelta(days=i) for i in range(WINDOW_DAYS + 2, WINDOW_DAYS + 20)
               if studio_day(local_date(now) + dt.timedelta(days=i)))
    cases: list[tuple[Any, str]] = [
        (wall(at(local_date(now) - dt.timedelta(days=2), 10)), "future"),
        ("next tuesday", "future"),
        (ABSENT, "future"),
        (wall(at(far, 10)), "within_90"),
        (wall(at(saturday, 10)), "hours"),
        (wall(at(saturday, 10, 10)), "hours"),
        (wall(at(day, 8, 45)), "hours"),
        (wall(at(day, 16, 30)), "hours"),
        (wall(at(day, 17)), "hours"),
        (zulu(at(day, 16, 45)), "hours"),
    ]
    for value, kind in cases:
        refused(act(app_url, lead, inq["id"], "book_call", inq["version"], call_at=value), kind)
    assert detail(app_url, inq["id"])["version"] == inq["version"] and events_count(inq["id"]) == inq["version"]
    morning = free_start(app_url, now, at_time=(OPEN_HOUR, 0))
    booked = ok(act(app_url, lead, inq["id"], "book_call", inq["version"], call_at=zulu(morning)))
    assert booked["call_at"] == zulu(morning)
    latest = free_start(app_url, now, at_time=(CLOSE_HOUR - 1, QUARTER))
    booked = ok(act(app_url, lead, inq["id"], "reschedule_call", booked["version"], call_at=wall(latest)))
    assert booked["call_at"] == zulu(latest)


def test_wf_calendar_slots_and_one_booking_per_slot_quarter_hours(app_url: str) -> None:
    lead = sign_in(app_url)
    inq = review(app_url, create(app_url))
    slot = free_start(app_url, iso(inq["created_at"]), at_time=(10, 0))
    day = slot.date()
    for value in (wall(at(day, 10, 10)), at(day, 10, 0, 30).strftime("%Y-%m-%dT%H:%M:%S"), zulu(at(day, 11, 5))):
        refused(act(app_url, lead, inq["id"], "book_call", inq["version"], call_at=value), "quarter")
    assert detail(app_url, inq["id"])["version"] == inq["version"] and events_count(inq["id"]) == inq["version"]
    booked = ok(act(app_url, lead, inq["id"], "book_call", inq["version"], call_at=wall(slot)))
    assert booked["call_at"] == zulu(slot)


def test_wf_calendar_slots_and_one_booking_per_slot_closure_days(app_url: str) -> None:
    lead = sign_in(app_url)
    inq = review(app_url, create(app_url))
    now = iso(inq["created_at"])
    first = local_date(now) + dt.timedelta(days=2)
    def next_studio(day: dt.date) -> dt.date:
        day += dt.timedelta(days=1)
        while not studio_day(day):
            day += dt.timedelta(days=1)
        return day

    closures = [d for d in (first + dt.timedelta(days=i) for i in range(SLOT_HORIZON_DAYS))
                if d.weekday() < 5 and not studio_day(d)
                and at(next_studio(d), 10) + dt.timedelta(minutes=CALL_MINUTES) <= now + dt.timedelta(days=SLOT_HORIZON_DAYS)]
    assert closures, "no weekday closure day falls inside the call window"
    closure = closures[0]
    for value, kind in ((wall(at(closure, 10)), "closed"), (wall(at(closure, 10, 10)), "closed"),
                        (wall(at(closure, 8)), "hours")):
        refused(act(app_url, lead, inq["id"], "book_call", inq["version"], call_at=value), kind)
    assert detail(app_url, inq["id"])["version"] == inq["version"] and outbox_count(inq["id"]) == inq["version"]
    target = at(next_studio(closure), 10)
    taken = any(not (target.astimezone(UTC) + dt.timedelta(minutes=CALL_MINUTES) <= b0 or target.astimezone(UTC) >= b1)
                for b0, b1 in busy(app_url))
    r = act(app_url, lead, inq["id"], "book_call", inq["version"], call_at=wall(target))
    if taken:
        refused(r, "overlap")
    else:
        assert ok(r)["call_at"] == zulu(target)


def test_wf_calendar_slots_and_one_booking_per_slot_wall_clock_dst(app_url: str) -> None:
    lead = sign_in(app_url)
    inq = review(app_url, create(app_url))
    now = iso(inq["created_at"])
    slot = free_start(app_url, now, at_time=(10, 0))
    booked = ok(act(app_url, lead, inq["id"], "book_call", inq["version"], call_at=wall(slot)))
    assert booked["call_at"] == zulu(slot)
    later = free_start(app_url, now, at_time=(11, 0))
    shifted = later.astimezone(dt.timezone(dt.timedelta(hours=5))).isoformat()
    booked = ok(act(app_url, lead, inq["id"], "reschedule_call", booked["version"], call_at=shifted))
    assert booked["call_at"] == zulu(later)
    third = free_start(app_url, now, at_time=(14, 0))
    booked = ok(act(app_url, lead, inq["id"], "reschedule_call", booked["version"], call_at=third.strftime("%Y-%m-%dT%H:%M:%S")))
    assert booked["call_at"] == zulu(third)
    start = local_date(now) + dt.timedelta(days=1)
    change = next((start + dt.timedelta(days=i) for i in range(1, SLOT_HORIZON_DAYS - 10)
                   if at(start + dt.timedelta(days=i), 12).utcoffset() != at(start + dt.timedelta(days=i - 1), 12).utcoffset()), None)
    if change is not None:
        refused(act(app_url, lead, inq["id"], "reschedule_call", booked["version"], call_at=wall(at(change, 2, 30))), "hours")
        before = free_start(app_url, now, at_time=(10, 0), after=max(start + dt.timedelta(days=1), change - dt.timedelta(days=6)))
        if before.date() < change:
            booked = ok(act(app_url, lead, inq["id"], "reschedule_call", booked["version"], call_at=wall(before)))
            after = free_start(app_url, now, at_time=(10, 0), after=change + dt.timedelta(days=1))
            booked = ok(act(app_url, lead, inq["id"], "reschedule_call", booked["version"], call_at=wall(after)))
            assert booked["call_at"] == zulu(after)
            assert iso(booked["call_at"]).astimezone(STOCKHOLM).hour == 10
            assert at(before.date(), 10).utcoffset() != at(after.date(), 10).utcoffset()


def test_wf_calendar_slots_and_one_booking_per_slot_one_call_per_slot(app_url: str) -> None:
    lead = sign_in(app_url)
    a, b = review(app_url, create(app_url)), review(app_url, create(app_url))
    base = free_window(app_url, iso(a["created_at"]), 4 * CALL_MINUTES)

    def plus(minutes: int) -> str:
        return wall(base + dt.timedelta(minutes=minutes))

    a = {**a, **ok(act(app_url, lead, a["id"], "book_call", a["version"], call_at=plus(QUARTER)))}
    refused(act(app_url, lead, b["id"], "book_call", b["version"], call_at=plus(3 * QUARTER)), "overlap")
    assert detail(app_url, b["id"])["version"] == b["version"]
    b = {**b, **ok(act(app_url, lead, b["id"], "book_call", b["version"], call_at=plus(6 * QUARTER)))}
    a = {**a, **ok(act(app_url, lead, a["id"], "reschedule_call", a["version"], call_at=plus(2 * QUARTER)))}
    before = (a["version"], outbox_count(a["id"]))
    refused(act(app_url, lead, a["id"], "reschedule_call", a["version"], call_at=plus(4 * QUARTER)), "overlap")
    assert (detail(app_url, a["id"])["version"], outbox_count(a["id"])) == before
    a = {**a, **ok(act(app_url, lead, a["id"], "reschedule_call", a["version"], call_at=plus(3 * QUARTER)))}
    assert iso(a["call_at"]) + dt.timedelta(minutes=CALL_MINUTES) == iso(b["call_at"])


def test_wf_calendar_slots_and_one_booking_per_slot_panel_messages(browser: Browser, app_url: str) -> None:
    hours_hint = "Weekdays 09:00 to 17:00 Stockholm time, on the quarter hour. Calls last 45 minutes."
    closed_hint = "Closed on Swedish public holidays and the eves of Midsummer, Christmas and New Year."
    a, b = review(app_url, create(app_url)), review(app_url, create(app_url))
    start = free_window(app_url, iso(a["created_at"]), 2 * CALL_MINUTES)
    ok(act(app_url, sign_in(app_url), b["id"], "book_call", b["version"], call_at=wall(start)))
    saturday = local_date(start) + dt.timedelta(days=(5 - start.weekday()) % 7 or 7)
    with studio(browser, app_url, LEAD, f"/studio/inquiries/{a['id']}?status=in_review") as page:
        page.get_by_role("button", name="Book call", exact=True).click()
        panel = page.get_by_role("group", name="Book call")
        expect(panel).to_contain_text(hours_hint)
        expect(panel).to_contain_text(closed_hint)
        field = page.get_by_label("Call time")
        for value, kind in ((wall(start + dt.timedelta(minutes=5)), "quarter"), (wall(at(saturday, 10)), "hours"),
                            (wall(start + dt.timedelta(minutes=QUARTER)), "overlap")):
            field.fill(value)
            panel.get_by_role("button", name="Confirm").click()
            expect(field).to_have_accessible_description(has_ci(M[kind][2]))
            expect(panel.get_by_text(M[kind][2])).to_be_visible()
            expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["in_review"]))).to_be_visible()
            assert detail(app_url, a["id"])["version"] == a["version"]
        field.fill(wall(start + dt.timedelta(minutes=CALL_MINUTES)))
        panel.get_by_role("button", name="Confirm").click()
        expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["call_booked"]))).to_be_visible()
        page.get_by_role("button", name="Reschedule call", exact=True).click()
        again = page.get_by_role("group", name="Reschedule call")
        expect(again).to_contain_text(hours_hint)
        expect(again).to_contain_text(closed_hint)
        again.get_by_label("Call time").fill(wall(start + dt.timedelta(minutes=5)))
        again.get_by_role("button", name="Confirm").click()
        expect(again.get_by_label("Call time")).to_have_accessible_description(has_ci(M["quarter"][2]))
    assert detail(app_url, a["id"])["call_at"] == zulu(start + dt.timedelta(minutes=CALL_MINUTES))


def invitation(message: dict) -> dict[str, str]:
    parts = calendar_parts(message)
    assert len(parts) == 1 and parts[0].get("FileName") == "intro-call.ics", attachments(message)
    texts = ics_texts(message)
    assert len(texts) == 1, "the calendar invitation content must be readable"
    lines = ics_lines(texts[0])
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-1] == "END:VCALENDAR"
    assert "VERSION:2.0" in lines and "PRODID:-//Northpier Studio//Inquiry desk//EN" in lines
    begin, end = lines.index("BEGIN:VEVENT"), lines.index("END:VEVENT")
    assert lines.count("BEGIN:VEVENT") == 1
    props = {line.split(":", 1)[0].split(";", 1)[0]: line.split(":", 1)[1] for line in lines[begin + 1: end]}
    assert len(props) == end - begin - 1
    assert set(props) == {"UID", "SEQUENCE", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "ORGANIZER", "ATTENDEE", "STATUS"}
    method = next(line.split(":", 1)[1] for line in lines if line.startswith("METHOD:"))
    assert str(parts[0].get("ContentType", "")).lower().startswith("text/calendar")
    return {**props, "METHOD": method, "RAW": texts[0]}


def check_invitations(messages: list[dict], inq: dict, plan: list[Any], secret: str) -> None:
    assert len(messages) == len(plan)
    for message, step in zip(messages, plan):
        if step is None:
            assert calendar_parts(message) == [] and ics_texts(message) == [], message["Subject"]
            continue
        method, sequence, slot = step
        props = invitation(message)
        assert props["METHOD"] == method
        assert props["UID"] == f"{inq['reference']}@northpier.studio"
        assert props["SEQUENCE"] == str(sequence)
        assert props["DTSTART"] == ics_stamp(slot)
        assert props["DTEND"] == ics_stamp(slot + dt.timedelta(minutes=CALL_MINUTES))
        assert re.fullmatch(r"\d{8}T\d{6}Z", props["DTSTAMP"])
        assert props["SUMMARY"] == f"Northpier intro call {inq['reference']}"
        assert props["ORGANIZER"] == f"mailto:{STUDIO_FROM}"
        assert props["ATTENDEE"] == f"mailto:{inq['address']}"
        assert props["STATUS"] == ("CONFIRMED" if method == "REQUEST" else "CANCELLED")
        for private in (secret, LEAD[0], LEAD[1], ASSOCIATE[0]):
            assert private not in props["RAW"]


def test_wf_call_invitation_lifecycle_sequence(app_url: str, mail: Any) -> None:
    inq = review(app_url, create(app_url))
    secret = f"Budget note {inq['tag']}"
    assert add_note(app_url, inq["id"], secret).status_code == 201
    inq, first = book(app_url, inq)
    inq, second = book(app_url, inq)
    plan = [None, None, ("REQUEST", 0, first), ("REQUEST", 1, second)]
    check_invitations(mails_to(mail, inq["address"], len(plan)), inq, plan, secret)


def test_wf_call_invitation_lifecycle_cancellation(app_url: str, mail: Any) -> None:
    inq = review(app_url, create(app_url))
    secret = f"Budget note {inq['tag']}"
    assert add_note(app_url, inq["id"], secret).status_code == 201
    inq, first = book(app_url, inq)
    inq = decline(app_url, inq, "fully_booked")
    inq = {**inq, **ok(act(app_url, sign_in(app_url), inq["id"], "reopen", inq["version"]))}
    inq, second = book(app_url, inq)
    plan = [None, None, ("REQUEST", 0, first), ("CANCEL", 1, first), None, ("REQUEST", 2, second)]
    check_invitations(mails_to(mail, inq["address"], len(plan)), inq, plan, secret)


def test_wf_call_invitation_lifecycle_decline_frees_slot(browser: Browser, app_url: str) -> None:
    lead = sign_in(app_url)
    booked, slot = book(app_url, review(app_url, create(app_url)))
    refused(act(app_url, lead, booked["id"], "decline", booked["version"]), "reason")
    refused(act(app_url, lead, booked["id"], "decline", booked["version"], decline_reason="cheap"), "reason")
    assert detail(app_url, booked["id"])["version"] == booked["version"]
    declined = decline(app_url, booked, "budget")
    assert declined["status"] == "declined" and declined["decline_reason"] == "budget"
    read = public(app_url, booked["status_token"]).json()
    assert read["status"] == "declined" and read["decline_reason"] == "budget"
    with plain(browser, f"{app_url}/inquiry/{booked['status_token']}") as page:
        expect(page.get_by_role("status", name="Inquiry status")).to_have_text(
            has_ci(LINES["declined"].format(reason=REASONS["budget"])))
    assert decline(app_url, create(app_url), "outside_services")["status"] == "declined"
    assert decline(app_url, review(app_url, create(app_url)), "timeline")["status"] == "declined"
    c, d = review(app_url, create(app_url)), review(app_url, create(app_url))
    results = together(lambda: act(app_url, lead, c["id"], "book_call", c["version"], call_at=wall(slot)),
                       lambda: act(app_url, sign_in(app_url, ASSOCIATE), d["id"], "book_call", d["version"], call_at=wall(slot)))
    assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
    refused(next(r for r in results if r.status_code == 409), "overlap")


def test_wf_reopen_window_and_private_status_reopen_journey(browser: Browser, app_url: str) -> None:
    inq, _slot = book(app_url, review(app_url, create(app_url)))
    before = inq["version"]
    with studio(browser, app_url, LEAD, f"/studio/inquiries/{inq['id']}?status=call_booked") as page:
        page.get_by_role("button", name="Decline", exact=True).click()
        panel = page.get_by_role("group", name="Decline")
        select(panel.get_by_role("combobox", name="Reason"), REASONS["budget"])
        panel.get_by_role("button", name="Confirm decline").click()
        expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["declined"]))).to_be_visible()
        page.get_by_role("button", name="Reopen", exact=True).click()
        expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["in_review"]))).to_be_visible()
        assert detail(app_url, inq["id"])["version"] == before + 2
        with plain(browser, f"{app_url}/inquiry/{inq['status_token']}") as status_page:
            expect(status_page.get_by_role("heading", level=1, name=exact_ci("In review"))).to_be_visible()
            expect(status_page.get_by_role("list", name="History")).to_contain_text(
                re.compile(r"declin|" + re.escape(REASONS["budget"]), re.I))
        statuses = [h["status"] for h in public(app_url, inq["status_token"]).json()["history"]]
        assert statuses[-2:] == ["declined", "in_review"]
        page.get_by_role("button", name="Book call", exact=True).click()
        page.get_by_label("Call time").fill(wall(free_start(app_url, iso(inq["created_at"]))))
        page.get_by_role("group", name="Book call").get_by_role("button", name="Confirm").click()
        expect(page.get_by_role("heading", level=2, name=exact_ci(LABELS["call_booked"]))).to_be_visible()
    assert public(app_url, inq["status_token"]).json()["status"] == "call_booked"


def test_wf_reopen_window_and_private_status_reopen_api(app_url: str, mail: Any) -> None:
    inq, _slot = book(app_url, review(app_url, create(app_url)))
    declined = decline(app_url, inq, "budget")
    queued = outbox_count(inq["id"])
    reopened = ok(act(app_url, sign_in(app_url), inq["id"], "reopen", declined["version"]))
    assert reopened["status"] == "in_review" and reopened["call_at"] is None and reopened["decline_reason"] is None
    assert reopened["version"] == declined["version"] + 1
    assert [(h["action"], h["to_status"]) for h in reopened["history"]][-2:] == [("decline", "declined"), ("reopen", "in_review")]
    assert outbox_count(inq["id"]) == queued + 1
    subjects = [m["Subject"] for m in mails_to(mail, inq["address"], 5)]
    assert subjects[-1] == f"Your inquiry {inq['reference']} is now In review"


def test_wf_reopen_window_and_private_status_reopen_window(app_url: str) -> None:
    window = 5
    with app_copy(NP_REOPEN_WINDOW_SECONDS=str(window)) as copy:
        lead = sign_in(copy)
        inq = create(copy)
        declined = ok(act(copy, lead, inq["id"], "decline", inq["version"], decline_reason="budget"))
        reopened = ok(act(copy, lead, inq["id"], "reopen", declined["version"]))
        assert reopened["status"] == "in_review"
        declined = ok(act(copy, lead, inq["id"], "decline", reopened["version"], decline_reason="timeline"))
        decided = time.monotonic()
        poll(lambda: time.monotonic() - decided > window + 1, window + MAIL_DEADLINE_S, "window wait overran")
        before = (declined["version"], outbox_count(inq["id"]))
        refused(act(copy, lead, inq["id"], "reopen", declined["version"]), "window_closed")
        after = detail(copy, inq["id"])
        assert after["status"] == "declined" and (after["version"], outbox_count(inq["id"])) == before


def test_wf_reopen_window_and_private_status_private_status(app_url: str) -> None:
    inq = create(app_url)
    secret = f"Private note {inq['tag']}"
    assert add_note(app_url, inq["id"], secret, ASSOCIATE).status_code == 201
    review(app_url, inq, sign_in(app_url, ASSOCIATE))
    r = public(app_url, inq["status_token"])
    assert r.status_code == 200
    read = r.json()
    assert set(read) == PUBLIC_KEYS
    assert read["reference"] == inq["reference"] and read["status"] == "in_review"
    assert [set(h) for h in read["history"]] == [{"status", "created_at"}] * 2
    assert [h["status"] for h in read["history"]] == ["new", "in_review"]
    assert all(ZULU.match(h["created_at"]) for h in read["history"]) and ZULU.match(read["created_at"])
    for private in ("@", secret, LEAD[0], ASSOCIATE[0], inq["status_token"], f"Ada {inq['tag']}"):
        assert private not in r.text, private
    refused(public(app_url, "no-such-token"), "not_found")
    for path in ("/api/me", "/api/studio/inquiries", f"/api/studio/inquiries/{inq['id']}"):
        refused(get(app_url, path, inq["status_token"]), "sign_in")
    after = detail(app_url, inq["id"])
    assert after["version"] == 2 and after["status"] == "in_review"


def test_wf_reopen_window_and_private_status_read_only(app_url: str) -> None:
    inq = create(app_url)
    head = httpx.head(f"{app_url}/api/inquiries/status/{inq['status_token']}", timeout=HTTP_TIMEOUT)
    assert head.status_code == 200
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for path in (f"/api/inquiries/status/{inq['status_token']}", f"/inquiry/{inq['status_token']}"):
            res = send(app_url, path, {"status": "won", "action": "mark_won"}, method=method)
            assert res.status_code == 405 and res.headers["Allow"] == "GET, HEAD", (method, path)
            if path.startswith("/api/"):
                refused(res, "method")
    after = detail(app_url, inq["id"])
    assert (after["status"], after["version"], events_count(inq["id"]), outbox_count(inq["id"])) == ("new", 1, 1, 1)
    assert public(app_url, inq["status_token"]).json()["status"] == "new"


def test_wf_reopen_window_and_private_status_status_page(browser: Browser, app_url: str) -> None:
    inq = create(app_url, message=LITERAL_MESSAGE)
    with open_app(browser, f"{app_url}/inquiry/{inq['status_token']}") as page:
        consent(page, app_url)
        expect(page.get_by_text("Your inquiry", exact=True).first).to_be_attached()
        expect(page.get_by_text(inq["reference"]).first).to_be_visible()
        expect(page.get_by_role("heading", level=1, name=exact_ci("New"))).to_be_visible()
        expect(page.get_by_role("status", name="Inquiry status")).to_have_text(has_ci(LINES["new"]))
        message = page.get_by_text(LITERAL_FIRST_LINE)
        expect(message).to_be_visible()
        if LITERAL_MESSAGE not in message.first.inner_text():
            second = page.get_by_text(LITERAL_MESSAGE.split("\n", 1)[1]).first
            top, below = message.first.bounding_box(), second.bounding_box()
            assert below["y"] >= top["y"] + top["height"] - 1, (top, below)
        history = page.get_by_role("list", name="History").get_by_role("listitem")
        expect(history).to_have_count(1)
        page.evaluate("() => { window.__northpierMark = 1; }")
        review(app_url, inq)
        advance(page, RECHECK_MS)
        advance_until(page, page.get_by_role("heading", level=1, name=exact_ci("In review")))
        expect(page.get_by_role("status", name="Inquiry status")).to_have_text(has_ci(LINES["in_review"]))
        expect(history).to_have_count(2)
        expect(history.last).to_contain_text(re.compile(r"\d"))
        assert page.evaluate("() => window.__northpierMark") == 1


def past_second(stamp: str) -> None:
    poll(lambda: dt.datetime.now(UTC) - iso(stamp) >= dt.timedelta(seconds=1), MAIL_DEADLINE_S,
         f"the clock never moved a second past {stamp}")


def tagged(base: str, tag: str, count: int = 1, spaced: bool = False, **over: Any) -> list[dict]:
    made = []
    for _ in range(count):
        if spaced and made:
            past_second(made[-1]["created_at"])
        made.append(create(base, tag=tag, **over))
    return made


def refs(base: str, **params: Any) -> list[str]:
    return [r["reference"] for r in ok(queue(base, **params))["inquiries"]]


def test_wf_studio_queue_counts_order_search_queue_api(app_url: str) -> None:
    tag = new_tag()
    a, b, c = tagged(app_url, tag, 3, spaced=True)
    assert refs(app_url, q=tag) == [a["reference"], b["reference"], c["reference"]]
    assert refs(app_url, status="new", q=tag) == [a["reference"], b["reference"], c["reference"]]
    assert refs(app_url, status="all", q=tag) == [c["reference"], b["reference"], a["reference"]]
    body = ok(queue(app_url, status="all", q=tag))
    for row in body["inquiries"]:
        assert set(row) == STUDIO_KEYS - {"message"}
    for inq in (a, b, c):
        assert inq["status_token"] not in json.dumps(body)
    c = review(app_url, c)
    past_second(c["updated_at"])
    b = review(app_url, b)
    assert refs(app_url, status="in_review", q=tag) == [b["reference"], c["reference"]]
    later = free_start(app_url, iso(b["created_at"]), at_time=(15, 0))
    b, _slot = book(app_url, b, local=later)
    c, _slot = book(app_url, c, local=free_start(app_url, iso(c["created_at"]), latest_start=(12, 0)))
    order = sorted([b, c], key=lambda i: iso(i["call_at"]))
    assert refs(app_url, status="call_booked", q=tag) == [i["reference"] for i in order]
    past_second(decline(app_url, c)["updated_at"])
    decline(app_url, b)
    assert refs(app_url, status="declined", q=tag) == [b["reference"], c["reference"]]
    assert a["reference"] in refs(app_url, status="all", q=a["reference"][3:].lower())
    assert a["reference"] in refs(app_url, status="all", q=a["address"].split("@")[0])
    assert a["reference"] in refs(app_url, status="all", q=tag.upper())
    lit_tag = new_tag()
    pairs = [("%", "a"), ("_", "b"), ("\\", "z")]
    for special, plainchar in pairs:
        hit = create(app_url, tag=lit_tag + "h", company=f"{lit_tag}{special}x")
        miss = create(app_url, tag=lit_tag + "m", company=f"{lit_tag}{plainchar}x")
        found = refs(app_url, status="all", q=f"{lit_tag}{special}")
        assert hit["reference"] in found and miss["reference"] not in found, special
    assert queue(app_url, q="x" * Q_MAX).status_code == 200
    assert queue(app_url, q=" " + "x" * Q_MAX + " ").status_code == 200
    assert queue(app_url, q="\U0001F600" * Q_MAX).status_code == 200
    refused(queue(app_url, q="x" * (Q_MAX + 1)), "q_long")
    refused(queue(app_url, status="archived"), "tab")
    refused(queue(app_url, status="archived", q="x" * (Q_MAX + 1)), "tab")
    for nasty in ("%_" * (Q_MAX // 2), "\\" * Q_MAX, "a" * Q_MAX):
        began = time.monotonic()
        assert queue(app_url, status="all", q=nasty).status_code == 200
        assert time.monotonic() - began < REQUEST_BUDGET_S


def counts_hold(base: str, tag: str, expected: dict[str, int]) -> None:
    body = ok(queue(base, status="all", q=tag))
    counts = body["counts"]
    for status in LABELS:
        assert counts[status] == expected.get(status, 0), (status, counts)
        assert len(ok(queue(base, status=status, q=tag))["inquiries"]) == counts[status]
    assert counts["all"] == sum(counts[s] for s in LABELS) == len(body["inquiries"])


def test_wf_studio_queue_counts_order_search_counts_follow_search(app_url: str) -> None:
    tag = new_tag()
    a, _b = tagged(app_url, tag, 2)
    counts_hold(app_url, tag, {"new": 2})
    a = review(app_url, a)
    counts_hold(app_url, tag, {"new": 1, "in_review": 1})
    a, _slot = book(app_url, a)
    counts_hold(app_url, tag, {"new": 1, "call_booked": 1})
    a = decline(app_url, a)
    counts_hold(app_url, tag, {"new": 1, "declined": 1})
    ok(act(app_url, sign_in(app_url), a["id"], "reopen", a["version"]))
    counts_hold(app_url, tag, {"new": 1, "in_review": 1})
    create(app_url, tag=tag)
    counts_hold(app_url, tag, {"new": 2, "in_review": 1})


def test_wf_studio_queue_counts_order_search_notes(app_url: str) -> None:
    inq = create(app_url)
    first = add_note(app_url, inq["id"], FIRST_NOTE)
    assert first.status_code == 201
    assert set(first.json()) == {"id", "body", "author_name", "created_at"} and first.json()["author_name"] == LEAD[0]
    past_second(first.json()["created_at"])
    second = add_note(app_url, inq["id"], "\U0001F600" * NOTE_MAX, ASSOCIATE)
    assert second.status_code == 201 and second.json()["author_name"] == ASSOCIATE[0]
    half = NOTE_MAX // 2
    past_second(second.json()["created_at"])
    assert add_note(app_url, inq["id"], "n" * half + "\r\n" + "n" * (half - 1)).status_code == 201
    refused(add_note(app_url, inq["id"], "n" * (NOTE_MAX + 1)), "note_long")
    refused(add_note(app_url, inq["id"], "   "), "note_blank")
    after = detail(app_url, inq["id"])
    assert [n["author_name"] for n in after["notes"]] == [LEAD[0], ASSOCIATE[0], LEAD[0]]
    assert after["notes"][-1]["body"] == FIRST_NOTE
    assert (after["status"], after["version"], after["updated_at"]) == ("new", 1, inq["updated_at"])
    assert outbox_count(inq["id"]) == 1


def test_wf_studio_queue_counts_order_search_search_page(browser: Browser, app_url: str) -> None:
    tag = new_tag()
    first, second = tagged(app_url, tag, 2)
    with studio(browser, app_url, LEAD) as page:
        for label in LABELS.values():
            expect(page.get_by_role("tab", name=re.compile(rf"^{re.escape(label)} \d+$"))).to_be_visible()
        expect(page.get_by_role("tab", name=re.compile(r"^All \d+$"))).to_be_visible()
        page.get_by_role("searchbox", name="Search name, company, email or reference").press_sequentially(tag)
        rows = page.get_by_role("list", name="Inquiries").get_by_role("link")
        expect(rows).to_have_count(2, timeout=SEARCH_SETTLE_MS + REQUEST_BUDGET_S * 1000)
        for label, n in (("New", 2), ("In review", 0), ("Call booked", 0), ("Won", 0), ("Declined", 0), ("All", 2)):
            expect(tab(page, label, n)).to_be_visible()
        assert query_of(page.url).get("q") == [tag]
        row = rows.filter(has_text=first["reference"])
        expect(row).to_contain_text(f"Ada {tag}")
        expect(row).to_contain_text(f"Co {tag}")
        expect(row).to_contain_text(BUDGETS["25k_75k"])
        expect(row).to_contain_text(has_ci("New"))
        row.click()
        page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == f"/studio/inquiries/{first['id']}")
        assert query_of(page.url).get("q") == [tag]
        page.go_back()
        page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == "/studio")
        expect(page.get_by_role("searchbox", name="Search name, company, email or reference")).to_have_value(tag)
        expect(rows).to_have_count(2)
        tab(page, "Won", 0).click()
        page.wait_for_url(lambda u: query_of(u).get("status") == ["won"])
        assert query_of(page.url).get("q") == [tag]
        expect(page.get_by_text("Nothing here right now.")).to_be_visible()
        page.go_back()
        expect(tab(page, "New", 2)).to_have_attribute("aria-selected", "true")
        expect(rows).to_have_count(2)
        page.go_forward()
        expect(tab(page, "Won", 0)).to_have_attribute("aria-selected", "true")
        expect(page.get_by_text("Nothing here right now.")).to_be_visible()
    assert second["reference"] in refs(app_url, q=tag)


VISITOR_PAGES = ["/", "/work/maison-vey", "/services", "/contact", "/start", "/privacy-policy", f"/inquiry/{Q7_TOKEN}"]


def test_own_origin_only(browser: Browser, app_url: str) -> None:
    requests: list[str] = []
    context = browser.new_context(viewport=DESKTOP)
    try:
        page = context.new_page()
        page.on("request", lambda r: requests.append(r.url))
        for path in VISITOR_PAGES + ["/studio/signin", "/no-such-page"]:
            page.goto(app_url + path)
            page.wait_for_load_state("networkidle")
    finally:
        context.close()
    foreign = [u for u in requests if not u.startswith(("data:", "blob:", "about:")) and not same_origin(u, app_url)]
    assert foreign == []


def row_look(row: Any) -> list:
    return row.evaluate("""(el) => [el, ...el.querySelectorAll('*')].flatMap(n => [null, '::before', '::after'].map(p => {
        const s = getComputedStyle(n, p); return [s.opacity, s.color, s.filter, s.backgroundColor]; }))""")


def test_landing_page(browser: Browser, app_url: str) -> None:
    with plain(browser, app_url + "/", viewport=DESKTOP) as page:
        consent(page, app_url)
        page.reload()
        expect(page.get_by_role("link", name="Northpier Studio home")).to_be_visible()
        nav = page.get_by_role("navigation", name="Main")
        for name in ("Work", "Services", "Start a project", "Contact"):
            expect(nav.get_by_role("link", name=name, exact=True)).to_be_visible()
        expect(page.get_by_role("heading", level=1, name="Design & Technology")).to_be_visible()
        expect(page.get_by_text("from vision to launch").first).to_be_visible()
        work = page.get_by_role("list", name="Work").get_by_role("link")
        expect(work).to_have_count(len(CASES))
        for _slug, client, *_r in CASES:
            expect(page.get_by_role("list", name="Work").get_by_role("link", name=re.compile(re.escape(client)))).to_have_count(1)
        clients = page.get_by_role("list", name="Clients").get_by_role("listitem")
        expect(clients).to_have_count(len(CASES))
        for _slug, client, industry, *_r in CASES:
            expect(page.get_by_role("list", name="Clients")).to_contain_text(client)
            expect(page.get_by_role("list", name="Clients")).to_contain_text(industry)
        rest = row_look(clients.nth(1))
        clients.nth(0).hover()
        settle(page.get_by_role("list", name="Clients"))
        dimmed = row_look(clients.nth(1))
        assert dimmed != rest
        expect(page.get_by_text("We believe in well-crafted digital experiences built on strategic foundations, close collaboration and curious technology.")).to_be_visible()
        expect(page.get_by_text("Let's make something")).to_be_visible()
        expect(page.get_by_text("great together")).to_be_visible()
        mail_link = page.get_by_role("link", name=STUDIO_FROM).last
        assert mail_link.get_attribute("href") == f"mailto:{STUDIO_FROM}"
        expect(page.get_by_text(re.compile(r"\(c\) \d{4} northpier"))).to_be_visible()
        for label in ("Instagram", "X / Twitter", "LinkedIn"):
            expect(page.get_by_text(label, exact=True)).to_be_visible()
        for path, name in (("/services", "Services"), ("/contact", "Contact"), ("/start", "Start a project")):
            page.goto(app_url + path)
            current = page.get_by_role("navigation", name="Main").get_by_role("link", name=name, exact=True)
            expect(current).to_have_attribute("aria-current", "page")


def test_case_study_pages(browser: Browser, app_url: str) -> None:
    with plain(browser, app_url + "/", viewport=DESKTOP) as page:
        consent(page, app_url)
        for i, (slug, client, industry, _theme, awards) in enumerate(CASES):
            case = ok(get(app_url, f"/api/cases/{slug}"))
            page.goto(f"{app_url}/work/{slug}")
            expect(page.get_by_role("heading", level=1, name=exact_ci(client))).to_be_visible()
            expect(page.get_by_text("Industry", exact=True).first).to_be_attached()
            expect(page.get_by_text(industry, exact=True).first).to_be_visible()
            for award in awards:
                expect(page.get_by_text(award).first).to_be_visible()
            expect(page.get_by_text(case["testimonial"]["quote"]).first).to_be_visible()
            expect(page.get_by_text(f"{case['testimonial']['name']}, {case['testimonial']['role']}").first).to_be_visible()
            more = page.get_by_role("navigation", name="More work").get_by_role("link")
            expect(more).to_have_count(2)
            hrefs = {urllib.parse.urlsplit(urllib.parse.urljoin(page.url, link.get_attribute("href") or "")).path.rstrip("/")
                     for link in more.all()}
            assert hrefs == {f"/work/{CASES[(i + j) % len(CASES)][0]}" for j in (1, 2)}, (slug, hrefs)


def test_services_contact_privacy(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/services") as page:
        for copy in ("Since 2011", "Crafting meaningful connections between businesses and people.", "Strategy &", "Craft", "Approach",
                     "Find the opportunity and the plan to reach it.", "Identities that are clear, alive and easy to use.",
                     "Websites and products people enjoy coming back to.", "Fast, accessible builds with motion where it matters."):
            expect(page.get_by_text(copy).first).to_be_attached()
        expect(page.get_by_text(re.compile(r"(^|\s)Case\s*$"))).to_have_count(3)
        page.goto(app_url + "/privacy-policy")
        expect(page.get_by_role("heading", name=exact_ci("Privacy policy"))).to_be_visible()
        for paragraph in (
            "When you send an inquiry we store what you tell us: your name, email, company, the services you need, budget, timeline and message. We use it only to answer you and to run your project conversation.",
            "We email you when we receive your inquiry and each time its status changes. Your private status link shows only your own inquiry.",
            "We set one first-party cookie to remember your cookie choice for a year. We load no analytics and no third-party content.",
        ):
            expect(page.get_by_text(paragraph, exact=True)).to_be_visible()
        expect(page.get_by_text(re.compile(r"To see, correct or delete what we hold about you, write to"))).to_be_visible()
        page.goto(app_url + "/contact")
        expect(page.get_by_text("Want to talk?").first).to_be_visible()
        for line in ("Hamngatan 41", "111 47 Stockholm, Sweden", "Laugavegur 27", "101 Reykjavík, Iceland"):
            expect(page.get_by_text(line).first).to_be_visible()
        stockholm, reykjavik = page.get_by_role("status", name="Stockholm time"), page.get_by_role("status", name="Reykjavík time")
        moments = [
            ("2026-11-02T08:28:00Z", "God morgon, klockan är 09:29", "Góðan daginn, klukkan er 8:29 AM", "09:30", "8:30 AM"),
            ("2026-11-02T10:59:00Z", "God eftermiddag, klockan är 12:00", "Góðan daginn, klukkan er 11:00 AM", "12:01", "11:01 AM"),
            ("2026-11-02T16:59:00Z", "God kväll, klockan är 18:00", "Góðan dag, klukkan er 5:00 PM", "18:01", "5:01 PM"),
        ]
        for instant, swedish, icelandic, next_sv, next_is in moments:
            page.clock.set_system_time(iso(instant))
            page.reload()
            advance(page, 60500)
            expect(stockholm).to_have_text(has_ci(swedish))
            expect(reykjavik).to_have_text(has_ci(icelandic))
            advance(page, 60000)
            expect(stockholm).to_contain_text(next_sv)
            expect(reykjavik).to_contain_text(next_is)
    rendered = page_text(httpx.get(app_url + "/contact", timeout=HTTP_TIMEOUT).text)
    assert re.search(r"klockan är \d{2}:\d{2}", rendered) and re.search(r"klukkan er \d{1,2}:\d{2} (AM|PM)", rendered)


def test_not_found(browser: Browser, app_url: str) -> None:
    for path in ("/no-such-page", "/work/no-such-case", "/inquiry/no-such-token", "/run.json", "/requirements.txt",
                 "/USER_README.md", "/THIRD_PARTY_NOTICES.md", "/.env"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404, path
        assert in_page("Lost at sea", r.text) and in_page("This page does not exist or has moved.", r.text)
    refused(get(app_url, UNKNOWN_API_PATH), "not_found")
    with plain(browser, app_url + "/no-such-page") as page:
        expect(page.get_by_role("heading", level=1, name=exact_ci("Lost at sea"))).to_be_visible()
        assert page.get_by_role("link", name="Back to the studio").get_attribute("href") in ("/", app_url + "/")


def test_cookie_card(browser: Browser, app_url: str) -> None:
    for button, value in (("Accept", "accepted"), ("Reject", "rejected")):
        with open_app(browser, app_url + "/") as page:
            card = page.get_by_role("region", name="Cookie choice")
            advance(page, 2 * COOKIE_DELAY_MS)
            expect(card).to_be_visible()
            expect(card).to_contain_text("Hej! We use analytic cookies to measure our website activity.")
            expect(card.get_by_role("link", name="Privacy policy")).to_be_visible()
            card.get_by_role("button", name=button).click()
            advance(page, 2 * MOTION_MS)
            poll(lambda: gone(card), MAIL_DEADLINE_S, "the cookie card stayed after the choice")
            cookie = next(c for c in page.context.cookies() if c["name"] == "np_consent")
            assert cookie["value"] == value
            references = [time.time(), page.evaluate("() => Date.now()") / 1000]
            assert any(CONSENT_MIN_DAYS * 86400 <= cookie["expires"] - ref <= CONSENT_MAX_DAYS * 86400 for ref in references)
            for path in ("/", "/services"):
                page.goto(app_url + path)
                advance(page, 2 * COOKIE_DELAY_MS)
                assert gone(page.get_by_role("region", name="Cookie choice")), path


def test_accessibility(browser: Browser, app_url: str) -> None:
    with plain(browser, app_url + "/", viewport=DESKTOP) as page:
        consent(page, app_url)
        for path in VISITOR_PAGES + ["/studio/signin", "/no-such-page"]:
            page.goto(app_url + path)
            page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
            settle(page.locator("body"))
            axe(page)
            assert tab_order(page, 1)[0].casefold() == "Skip to content".casefold(), path
        page.goto(app_url + "/")
        link = page.get_by_role("navigation", name="Main").get_by_role("link", name="Services", exact=True)
        rest, focused = state_styles(link, "outline-style", "outline-width", "outline-color", "outline-offset",
                                     "box-shadow", state="focus")
        assert rest != focused
        page.goto(app_url + "/start")
        field = page.get_by_role("textbox", name="Your name")
        rest, focused = state_styles(field, "outline-style", "outline-width", "outline-color", "box-shadow",
                                     "border-color", state="focus")
        assert rest != focused
        for name in ("Send inquiry", "I have a project"):
            box = page.get_by_role("button", name=re.compile("^" + re.escape(name))).bounding_box()
            assert box["width"] >= TARGET_PX and box["height"] >= TARGET_PX, name
    with studio(browser, app_url, LEAD) as page:
        settle(page.locator("body"))
        axe(page)


def test_responsive_layout(browser: Browser, app_url: str) -> None:
    inq = create(app_url)
    widths = VIEWPORTS + [(REFLOW_WIDTH, PHONE["height"])]
    with studio(browser, app_url, LEAD) as page:
        consent(page, app_url)
        for width, height in widths:
            page.set_viewport_size({"width": width, "height": height})
            for path in VISITOR_PAGES + ["/studio/signin", "/studio", f"/studio/inquiries/{inq['id']}"]:
                page.goto(app_url + path)
                layout(page)
        page.set_viewport_size(PHONE)
        page.goto(app_url + "/")
        menu = page.get_by_role("button", name="Menu")
        menu.click()
        sheet = page.get_by_role("dialog", name="Menu")
        expect(sheet).to_be_visible()
        for name in ("Work", "Services", "Start a project", "Contact"):
            expect(sheet.get_by_role("link", name=name, exact=True)).to_be_visible()
        expect(sheet.get_by_role("link", name="Work", exact=True)).to_be_focused()
        for _ in range(6):
            page.keyboard.press("Tab")
            assert sheet.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        poll(lambda: gone(sheet), MAIL_DEADLINE_S, "the Menu sheet stayed open after Escape")
        expect(menu).to_be_focused()
        menu.click()
        sheet.get_by_role("button", name="Close").click()
        poll(lambda: gone(sheet), MAIL_DEADLINE_S, "the Menu sheet stayed open after Close")
        expect(menu).to_be_focused()


PHRASES = ("Intelligent products", "Brands with purpose", "Sites that move")


def current_phrases(page: Page) -> set[str]:
    return {p for p in PHRASES if any(shown(el) for el in page.get_by_text(p, exact=True).all())}


def test_motion(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.get_by_text("from vision to launch").first.scroll_into_view_if_needed()
        before = poll(lambda: advance(page, 50) or current_phrases(page), MAIL_DEADLINE_S, "no hero phrase shown")
        advance(page, HERO_SWAP_MS + MOTION_MS)
        poll(lambda: current_phrases(page) and current_phrases(page) != before, MAIL_DEADLINE_S, "hero line never swapped")
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        advance(page, 3 * HERO_SWAP_MS)
        assert current_phrases(page) == {PHRASES[0]}
    with open_app(browser, app_url + "/") as page:
        slow_motion(page)
        card = page.get_by_role("region", name="Cookie choice")
        advance(page, COOKIE_DELAY_MS - 2 * QUARTER * 10)
        assert gone(card), "the cookie card showed before its one-second delay"
        advance(page, 2 * QUARTER * 10)
        expect(card).to_be_visible()
        assert any(abs(t["duration"] - MOTION_MS) < 1 for t in timings(card)), timings(card)
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        card = page.get_by_role("region", name="Cookie choice")
        advance(page, COOKIE_DELAY_MS)
        expect(card).to_be_visible()
        assert all(t["duration"] < 1 for t in timings(card))
    with open_app(browser, app_url + "/no-such-page") as page:
        slow_motion(page)
        page.reload()
        slow_motion(page)
        heading = page.get_by_role("heading", level=1)
        advance(page, MOTION_MS)
        letters = [t for t in timings(heading) if abs(t["duration"] - MOTION_MS) < 1]
        assert len(letters) >= len("Lost at sea".replace(" ", "")), timings(heading)
    with open_app(browser, app_url + "/no-such-page", reduced_motion="reduce") as page:
        advance(page, SEQUENCE_MS)
        assert all(t["duration"] < 1 for t in timings(page.get_by_role("heading", level=1)))
    inq = create(app_url)
    with studio(browser, app_url, LEAD, f"/studio/inquiries/{inq['id']}?status=new&q={inq['tag']}") as page:
        expect(page.get_by_role("button", name="Start review", exact=True)).to_be_visible()
        settle(page.locator("body"))
        clicked_at = page.evaluate("() => document.timeline.currentTime")
        slow_motion(page)
        page.get_by_role("button", name="Start review", exact=True).click()
        poll(lambda: page.evaluate("(since) => document.getAnimations().some(a => a.startTime === null || a.startTime >= since)",
                                   clicked_at), MAIL_DEADLINE_S, "no motion followed Start review")
        running = page.evaluate(
            """(since) => document.getAnimations().filter(a => a.startTime === null || a.startTime >= since)
                 .map(a => { const t = a.effect.getComputedTiming();
                 return {end: Number(t.endTime), iterations: t.iterations}; })""", clicked_at)
        finite = [r for r in running if r["iterations"] != float("inf") and r["end"] == r["end"]]
        assert finite and max(r["end"] for r in finite) <= SEQUENCE_MS, running
