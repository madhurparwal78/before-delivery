from __future__ import annotations

import base64
import html
import csv
import io
import json
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
from contextlib import contextmanager
from datetime import date, datetime, time as dtime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

import conftest
from conftest import (
    S3,
    addresses,
    advance,
    animations,
    capture,
    changed,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    same_origin,
    select,
    session,
    state_styles,
    text,
    unique,
    until,
)


CENTRAL = ZoneInfo("America/Chicago")
PASSWORD = "Teamseat-demo-2026"
SESSION_COOKIE = "teamseat_session"
JSON_LIMIT = 65536
FORM_LIMIT = 5000000
KEY_MAX = 100
STREET_MAX = 200
CITY_MAX = 80
NOTES_MAX = 1000
DURATION_MAX = 480
MAX_DAYS_AHEAD = 365
DAY_START_H = 6
DAY_END_H = 22
LINK_TTL_S = 60
REFRESH_MS = 5000
SWEEP_MIN_MS = 400
SWEEP_MAX_MS = 600
COUNT_MAX_MS = 450
NOTICE_LATE_MIN = 2880
MIN_BILLABLE = 120
QUARTER = 15
FREE_MILES = 40
TAP_MIN_PX = 44
HOURLY_MAX = 1000000
MILEAGE_MAX = 1000
SEED_RATE_ASL = 8575
SEED_RATE_SPOKEN = 6550
SEED_MILEAGE = 70
EXAMPLE_TEAM_TOTAL = 35140
EXAMPLE_SPOKEN_AMOUNT = 14738
EXAMPLE_MINUTES = 47
EXAMPLE_MILES = (52, 30)
EXAMPLE_SPOKEN_MINUTES = 133
EXAMPLE_SPOKEN_BILLABLE = 135

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}

STATEMENT_HEADER = "number,date,kind,language,setting,seats,billable_minutes,mileage_cents,total_cents,invoice_id"
SEED_LANGUAGES = [("asl", "ASL"), ("es", "Spanish"), ("vi", "Vietnamese"), ("so", "Somali"), ("ar", "Arabic")]
LANG_NAMES = dict(SEED_LANGUAGES)
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}

DISPATCHER = "dana.whitcombe@northfold.example"
BILLING = "marguerite.ellison@northfold.example"
RVH_SCHED = "tomas.herrera@rvh.example"
RVH_SCHED2 = "alina.brooks@rvh.example"
RVH_ADMIN = "helen.marsh@rvh.example"
CPSD_SCHED = "grace.lindqvist@cpsd.example"
CPSD_ADMIN = "victor.ames@cpsd.example"
LFC_SCHED = "owen.pakulski@lfc.example"
ROSA = "rosa.mendez@interp.example"
SAMUEL = "samuel.okoye@interp.example"
JORDAN = "jordan.fairweather@interp.example"
LINH = "linh.tran@interp.example"
ABDI = "abdi.warsame@interp.example"
ASL_INTERPRETERS = (ROSA, SAMUEL, JORDAN)
INITIALS = {ROSA: "R.M.", SAMUEL: "S.O.", JORDAN: "J.F.", LINH: "L.T.", ABDI: "A.W."}
NAMES = {ROSA: "Rosa Mendez", SAMUEL: "Samuel Okoye", JORDAN: "Jordan Fairweather"}
RVH_SCHED_NAME = "Tomas Herrera"
RVH_SCHED_PHONE = "312-555-0141"
ORGS = {"RVH": "Riverbend Valley Hospital", "CPSD": "Cedar Prairie School District", "LFC": "Lakeview Family Clinic"}

OFFER_KEYS = {"number", "status", "language", "setting", "city", "start_at", "end_at", "duration_minutes", "seats"}
HOLDER_KEYS = OFFER_KEYS | {"street_address", "patient_initials", "medical_notes", "scheduler"}
ORG_KEYS = HOLDER_KEYS | {"cancellation", "billing"}
STAFF_KEYS = ORG_KEYS | {"org"}

PREVIEW_FEE = re.compile(
    r"Cancelling now gives (\d+) h (\d{2}) m of business-hour notice, under 48 business hours\. "
    r"A late-cancellation fee of (\$[\d,]+\.\d{2}) applies\."
)


HTTP_TIMEOUT_S = 60
MAIL_DEADLINE_S = 45
REAL_MS = 15000
POLL_MS = 250
STEP_MS = 250
UI_BUDGET_MS = 20000
REFRESH_WAIT_S = 30
PACE_S = 0.5
LINK_SLACK_S = 5
OUTAGE_DEADLINE_S = 90
NOTICE_SLACK_MIN = 1
INSTANT_MS = 1
NPM_TIMEOUT_S = 300
TAB_PRESSES = 40
OUTAGE_BUDGET_MS = OUTAGE_DEADLINE_S * 1000
COPY_BOOT_S = 180
COPY_RETRY_S = "2"
RELAY_CHUNK = 65536
LOG_TAIL = 4000
STOP_S = 20
DETECT_MS = 100
FINE_MS = 50
FIRST_CHANGE = 0.02
SETTLE_MS = 600
WARM_MARGIN = 50
STRIPE_MIN = 4
SEAM_DURATION = 480

FAR_FIRST_DAY = 21
FAR_LAST_DAY = 300
SLOT_HOURS = (7, 9, 11, 13, 15, 17, 19)
SOON_LEAD_MIN = 120
SOON_HORIZON_H = 40
RATE_STEP = 125
PATIENT = "QXZ"
FOREIGN_ORIGIN = "http://elsewhere.example"
FOREIGN_ZONE = "Asia/Tokyo"
MISSING_NUMBER = "A-9999999"
FRESH_PASSWORD = "Fresh-start-2026!"
FRESH_PHONE = "312-555-0188"

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 64 + b"\xff\xd9"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00" + b"\x00" * 32
PDF = b"%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
TEXT_AS_PDF = b"Signed verification form, honestly.\n"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML = b"<!doctype html><title>form</title><script>alert(1)</script>"

MOTION_PROBE = """() => {
  if (window.__motion) return;
  const seen = [];
  window.__motion = seen;
  const keep = (a) => { if (!seen.includes(a)) { seen.push(a); a.pause(); } };
  const sweep = () => { for (const a of document.getAnimations()) keep(a); };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); keep(a); return a; };
  for (const type of ["transitionrun", "transitionstart", "animationstart"]) {
    document.addEventListener(type, sweep, true);
  }
}"""
MOTION_RECORDED = """(root) => (window.__motion || []).some((a) => a.effect && a.effect.target
  && root.contains(a.effect.target) && a.effect.getComputedTiming().activeDuration > 0)"""
MOTION_DURATIONS = """(root) => (window.__motion || [])
  .filter((a) => a.effect && a.effect.target && root.contains(a.effect.target))
  .map((a) => a.effect.getComputedTiming().activeDuration)
  .filter((d) => Number.isFinite(d))"""
MOTION_SINCE = """(root, from) => (window.__motion || []).slice(from)
  .filter((a) => a.effect && a.effect.target && root.contains(a.effect.target))
  .map((a) => a.effect.getComputedTiming().activeDuration)
  .filter((d) => Number.isFinite(d))"""
MOTION_SEEK = """(root, p) => {
  for (const a of window.__motion || []) {
    const t = a.effect && a.effect.target;
    if (!t || !root.contains(t)) continue;
    const end = a.effect.getComputedTiming().endTime;
    if (!Number.isFinite(end)) continue;
    a.pause();
    a.currentTime = end * p;
  }
}"""
MOTION_FINISH = """() => {
  for (const a of window.__motion || []) {
    try { if (Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); } catch (e) {}
  }
}"""


def origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def at(base: str, path: str) -> str:
    return base.rstrip("/") + path


class Api:

    def __init__(self, base: str, email: str | None = None, password: str = PASSWORD):
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, headers={"Origin": origin(base)})
        self.user: dict[str, Any] | None = None
        if email:
            r = self.http.post("/api/session", json={"email": email, "password": password})
            assert r.status_code == 200, f"sign-in {email}: {r.status_code} {r.text}"
            self.user = r.json()["user"]

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.get(path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.http.post(path, json={} if body is None else body, **kw)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)

    @property
    def cookie(self) -> str:
        value = self.http.cookies.get(SESSION_COOKIE)
        assert value, "no session cookie"
        return value


def assert_error(r: httpx.Response, status: int, code: str, field: str | None = None) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url}: {r.status_code} {r.text}"
    body = r.json()
    assert set(body) == {"error"}, body
    err = body["error"]
    assert err["code"] == code, body
    assert isinstance(err["message"], str) and err["message"], body
    if status == 422:
        assert isinstance(err.get("fields"), dict) and err["fields"], body
        if field:
            assert field in err["fields"], body
    else:
        assert "fields" not in err, body
    return err


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], Any]) -> Any:
        barrier.wait()
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def poll(fetch: Callable[[], Any], done: Callable[[Any], bool], seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    pace = threading.Event()
    result = fetch()
    while not done(result) and time.monotonic() <= deadline:
        pace.wait(PACE_S)
        result = fetch()
    return result


def now_central() -> datetime:
    return datetime.now(CENTRAL)


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def central(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=CENTRAL)


def cday(dt: datetime) -> date:
    return dt.astimezone(CENTRAL).date()


def week_of(dt: datetime) -> date:
    d = cday(dt)
    return d - timedelta(days=d.weekday())


def stamp(dt: datetime) -> str:
    dt = dt.astimezone(CENTRAL)
    return f"{dt:%a} {dt.day} {dt:%b} {dt:%H:%M}"


def day_text(dt: datetime) -> str:
    dt = dt.astimezone(CENTRAL)
    return f"{dt:%a} {dt.day} {dt:%b}"


def span(start: datetime, end: datetime) -> str:
    return f"{stamp(start)}–{end.astimezone(CENTRAL):%H:%M}"


def clock_text(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}"


def clock_re(minutes: int) -> re.Pattern:
    return re.compile(rf"(?<!\d){re.escape(clock_text(minutes))}(?!\d)")


def words(minutes: int) -> str:
    return f"{minutes // 60} h {minutes % 60:02d} m"


def money(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def dollars_input(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def week_title(monday: date) -> str:
    return f"Week of {monday:%a} {monday.day} {monday:%b} {monday.year}"


def business_minutes(frm: datetime, to: datetime) -> int:
    seconds = 0.0
    cur = frm.astimezone(timezone.utc)
    end = to.astimezone(timezone.utc)
    while cur < end:
        local = cur.astimezone(CENTRAL)
        midnight = datetime.combine(local.date() + timedelta(days=1), dtime(0), tzinfo=CENTRAL).astimezone(timezone.utc)
        stop = min(midnight, end)
        if local.weekday() < 5:
            seconds += (stop - cur).total_seconds()
        cur = stop
    return int(seconds // 60)


def assert_notice(value: int, before: datetime, after: datetime, start: datetime) -> None:
    high = business_minutes(before, start)
    low = business_minutes(after, start)
    assert low - NOTICE_SLACK_MIN <= value <= high + NOTICE_SLACK_MIN, (value, low, high)


def tag(prefix: str) -> str:
    return unique(prefix)[0]


def busy(person: Api) -> list[tuple[datetime, datetime]]:
    r = person.get("/api/my-seats")
    assert r.status_code == 200, r.text
    return [(parse(a["start_at"]), parse(a["end_at"])) for a in r.json()["assignments"] if a["status"] != "cancelled"]


def free(start: datetime, minutes: int, ranges: list) -> bool:
    end = start + timedelta(minutes=minutes)
    return not any(start < e and s < end for s, e in ranges)


def far_slot(minutes: int, people: list[Api] | tuple = (), *, weekday: int | None = None,
             hours: tuple = SLOT_HOURS, avoid: list | tuple = ()) -> datetime:
    ranges = [r for p in people for r in busy(p)] + list(avoid)
    today = now_central().date()
    offsets = list(range(FAR_FIRST_DAY, FAR_LAST_DAY))
    random.shuffle(offsets)
    for offset in offsets:
        day = today + timedelta(days=offset)
        if weekday is not None and day.weekday() != weekday:
            continue
        for hour in random.sample(list(hours), len(hours)):
            start = central(day, hour)
            if start + timedelta(minutes=minutes) <= central(day, DAY_END_H) and free(start, minutes, ranges):
                return start
    raise AssertionError("no free far slot")


def slot_on(day: date, minutes: int, people: list[Api], avoid: list | tuple = ()) -> datetime:
    ranges = [r for p in people for r in busy(p)] + list(avoid)
    for hour in SLOT_HOURS:
        start = central(day, hour)
        if start + timedelta(minutes=minutes) <= central(day, DAY_END_H) and free(start, minutes, ranges):
            return start
    raise AssertionError(f"no free slot on {day}")


def soon_slot(minutes: int, people: list[Api] | tuple = ()) -> datetime:
    ranges = [r for p in people for r in busy(p)]
    t = (now_central() + timedelta(minutes=SOON_LEAD_MIN)).replace(second=0, microsecond=0)
    t += timedelta(minutes=(-t.minute) % QUARTER)
    stop = now_central() + timedelta(hours=SOON_HORIZON_H)
    while t < stop:
        day = t.date()
        if t < central(day, DAY_START_H):
            t = central(day, DAY_START_H)
            continue
        if t + timedelta(minutes=minutes) > central(day, DAY_END_H):
            t = central(day + timedelta(days=1), DAY_START_H)
            continue
        if free(t, minutes, ranges):
            return t
        t += timedelta(minutes=QUARTER)
    raise AssertionError("no free soon slot")


def body_for(start: datetime, *, language: str = "asl", minutes: int = 90, setting: str = "hospital") -> dict:
    mark = tag("tsv")
    return {
        "language": language,
        "setting": setting,
        "start_at": start.isoformat(),
        "duration_minutes": minutes,
        "street_address": f"417 Quillfeather Lane {mark}",
        "city": f"Brookhollow {mark}",
        "patient_initials": PATIENT,
        "medical_notes": f"Oncology follow-up {mark}",
    }


def secrets(body: dict) -> list[str]:
    return [body["street_address"], body["patient_initials"], body["medical_notes"]]


def create(sched: Api, start: datetime, **kw: Any) -> tuple[dict, dict]:
    body = body_for(start, **kw)
    r = sched.post("/api/assignments", body, headers={"Idempotency-Key": idempotency_key()})
    assert r.status_code == 201, r.text
    return r.json(), body


def seat_path(number: str, seat: int, action: str) -> str:
    return f"/api/assignments/{number}/seats/{seat}/{action}"


def view(api: Api, number: str) -> httpx.Response:
    return api.get(f"/api/assignments/{number}")


def search(api: Api, q: str) -> list[dict]:
    r = api.get("/api/assignments", params={"q": q})
    assert r.status_code == 200, r.text
    return r.json()["assignments"]


def seat_states(assignment: dict) -> dict[int, tuple[str, Any]]:
    return {s["seat"]: (s["status"], s.get("interpreter_initials")) for s in assignment["seats"]}


def scenario(app_url: str, *, free_for: tuple = (), claims: tuple = (), language: str = "asl", minutes: int = 90,
             scheduler: str = RVH_SCHED, soon: bool = False, release: bool = True,
             start: datetime | None = None) -> SimpleNamespace:
    people = {e: Api(app_url, e) for e in dict.fromkeys([*free_for, *(e for _, e in claims)])}
    if start is None:
        start = soon_slot(minutes, list(people.values())) if soon else far_slot(
            minutes, list(people.values()), avoid=booked(app_url, language))
    sched = Api(app_url, scheduler)
    disp = Api(app_url, DISPATCHER)
    created, body = create(sched, start, language=language, minutes=minutes)
    number = created["number"]
    if release or claims:
        r = disp.post(f"/api/assignments/{number}/release")
        assert r.status_code == 200, r.text
    for seat, email in claims:
        r = people[email].post(seat_path(number, seat, "claim"))
        assert r.status_code == 200, r.text
    return SimpleNamespace(sched=sched, disp=disp, people=people, number=number, body=body, start=start,
                           end=start + timedelta(minutes=minutes), minutes=minutes, language=language)


def booked(app_url: str, language: str) -> list[tuple[datetime, datetime]]:
    r = Api(app_url, DISPATCHER).get("/api/assignments")
    assert r.status_code == 200, r.text
    return [(parse(a["start_at"]), parse(a["end_at"])) for a in r.json()["assignments"]
            if a["language"] == language and a["status"] != "cancelled"]


def free_interpreter(app_url: str, candidates: tuple, slots: list[tuple[datetime, int]]) -> str:
    for email in candidates:
        ranges = busy(Api(app_url, email))
        if all(free(s, m, ranges) for s, m in slots):
            return email
    raise AssertionError("no interpreter free at the chosen times")


def verify(person: Api, number: str, seat: int, minutes: int = 60, miles: int = 0, content: bytes = JPEG,
           ctype: str = "image/jpeg", name: str = "form.jpg") -> httpx.Response:
    return person.http.post(
        seat_path(number, seat, "verification"),
        data={"actual_minutes": str(minutes), "round_trip_miles": str(miles)},
        files={"form": (name, content, ctype)},
    )


def uncovered(disp: Api, monday: date, code: str) -> int:
    r = disp.get("/api/coverage", params={"week": monday.isoformat()})
    assert r.status_code == 200, r.text
    return next(lang["uncovered_minutes"] for lang in r.json()["languages"] if lang["code"] == code)


def rate_entries(billing: Api, org: str) -> list[dict]:
    r = billing.get("/api/rate-cards", params={"org": org})
    assert r.status_code == 200, r.text
    return r.json()["entries"]


def rate_on(billing: Api, org: str, line: str, day: date) -> dict:
    found = [e for e in rate_entries(billing, org)
             if e["service_line"] == line and date.fromisoformat(e["effective_from"]) <= day]
    return max(found, key=lambda e: e["effective_from"])


def seat_cents(hourly: int, minutes: int) -> tuple[int, int]:
    billable = max(MIN_BILLABLE, -(-minutes // QUARTER) * QUARTER)
    return billable, (2 * hourly * billable + 60) // 120


def fresh_effective(billing: Api, org: str, line: str) -> date:
    today = now_central().date()
    taken = [date.fromisoformat(e["effective_from"]) for e in rate_entries(billing, org) if e["service_line"] == line]
    return max([today + timedelta(days=2), *(d + timedelta(days=1) for d in taken)])


def charges(billing: Api, number: str) -> dict:
    r = billing.get(f"/api/assignments/{number}/charges")
    assert r.status_code == 200, r.text
    return r.json()


def billing_of(api: Api, number: str) -> dict:
    r = view(api, number)
    assert r.status_code == 200, r.text
    return r.json()["billing"]


def mails(mail: Any, number: str, expected: int, subject_part: str = "") -> list[dict]:
    pattern = re.compile(rf"(?<![\w-]){re.escape(number)}(?!\d)")

    def fetch() -> list[dict]:
        return [m for m in mail.messages()
                if pattern.search(m.get("Subject", "")) and subject_part in m.get("Subject", "")]

    return poll(fetch, lambda found: len(found) >= expected, MAIL_DEADLINE_S)


def body_of(message: dict) -> str:
    plain = (message.get("Text") or "").replace("\r\n", "\n")
    markup = html.unescape(re.sub(r"<[^>]+>", " ", message.get("HTML") or ""))
    return plain + "\n" + re.sub(r"\s+", " ", markup).strip()


def recipients(found: list[dict]) -> list[str]:
    return sorted(a.lower() for m in found for a in addresses(m["To"]))


def assert_clean(message: dict, hidden: list[str]) -> None:
    body = message.get("Subject", "") + "\n" + body_of(message)
    for secret in hidden:
        assert secret not in body, f"{secret!r} leaked into {message.get('Subject')!r}"


@contextmanager
def screen(browser: Browser, base: str, email: str | None, path: str, *, size: dict = DESKTOP,
           reduced_motion: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, base, reduced_motion=reduced_motion) as page:
        page.set_viewport_size(size)
        if email:
            person = Api(base, email)
            page.context.add_cookies([{"name": SESSION_COOKIE, "value": person.cookie, "url": origin(base)}])
        page.goto(at(base, path))
        yield page


def eventually(page: Page, check: Callable[[], None], budget_ms: int = UI_BUDGET_MS,
               each: Callable[[], None] | None = None, step_ms: int = STEP_MS) -> int:
    spent = 0
    while spent < budget_ms:
        if each:
            each()
        try:
            check()
            return spent
        except AssertionError:
            pass
        advance(page, step_ms)
        spent += step_ms
    if each:
        each()
    check()
    return spent


def says(scope: Any, name: str, pattern: Any, timeout: int = REAL_MS) -> Any:
    region = scope.get_by_role("status", name=name, exact=True).filter(has_text=pattern).first
    expect(region).to_be_attached(timeout=timeout)
    return region


def open_week(page: Page, monday: date) -> Any:
    board = page.get_by_role("region", name="Coverage board", exact=True)
    heading = page.get_by_role("heading", name=re.compile(r"^Week of "))
    expect(heading).to_be_visible(timeout=REAL_MS)
    shown = datetime.strptime(heading.inner_text().strip()[len("Week of "):], "%a %d %b %Y").date()
    weeks = (monday - shown).days // 7
    control = page.get_by_role("button", name="Next week" if weeks > 0 else "Previous week", exact=True)
    step = 1 if weeks > 0 else -1
    for i in range(1, abs(weeks) + 1):
        click(control)
        expect(page.get_by_role("heading", name=week_title(shown + timedelta(days=7 * i * step)), exact=True)).to_be_visible(timeout=REAL_MS)
    expect(page.get_by_role("heading", name=week_title(monday), exact=True)).to_be_visible(timeout=REAL_MS)
    return board


def capsule_of(board: Any, number: str) -> Any:
    capsule = board.get_by_role("button", name=re.compile(rf"^{re.escape(number)}(?!\d)"))
    expect(capsule).to_be_visible(timeout=REAL_MS)
    return capsule


def lane(scope: Any, seat: int) -> Any:
    return scope.get_by_role("group", name=f"Seat {seat}", exact=True)


def numeral_of(page: Page, language: str) -> Any:
    return page.get_by_role("group", name=f"{language} uncovered", exact=True)


def halves(page: Page, target: Any) -> tuple[Any, Any]:
    box = target.bounding_box()
    sx, sy = page.evaluate("() => [window.scrollX, window.scrollY]")

    def shot(x0: float, x1: float) -> Any:
        clip = {"x": box["x"] + sx + box["width"] * x0, "y": box["y"] + sy,
                "width": box["width"] * (x1 - x0), "height": box["height"], "scale": 1}
        data = session(page).send("Page.captureScreenshot", {"format": "png", "clip": clip})
        return decode(base64.b64decode(data["data"]))

    return shot(0, 0.4), shot(0.6, 1)


def choose(box: Any, pattern: re.Pattern) -> None:
    inside = box.get_by_role("option", name=pattern)
    if inside.count():
        select(box, (inside.first.text_content() or "").strip())
        return
    click(box)
    listed = box.page.get_by_role("option", name=pattern)
    expect(listed.first).to_be_visible(timeout=REAL_MS)
    click(listed.first)


def date_entry(box: Any, day: date) -> str:
    if (box.get_attribute("type") or "").lower() != "date":
        hint = box.get_attribute("placeholder") or ""
        if "MM/DD/YYYY" in hint.upper():
            return f"{day:%m/%d/%Y}"
        if "DD/MM/YYYY" in hint.upper():
            return f"{day:%d/%m/%Y}"
        if re.match(r"[A-Z][a-z]{2} \d", hint):
            return f"{day:%a} {day.day} {day:%b} {day.year}"
    return day.isoformat()


def request_form(page: Page) -> Any:
    form = page.get_by_role("form", name="Request an interpreter", exact=True)
    expect(form).to_be_visible(timeout=REAL_MS)
    return form


def fill_request(page: Page, body: dict, start: datetime) -> Any:
    form = request_form(page)
    select(form.get_by_role("combobox", name="Language", exact=True), LANG_NAMES[body["language"]])
    choose(form.get_by_role("combobox", name="Setting", exact=True), re.compile(rf"^\s*{body['setting']}\b", re.I))
    day_box = form.get_by_role("textbox", name="Date", exact=True)
    fill(day_box, date_entry(day_box, cday(start)))
    fill(form.get_by_role("textbox", name="Start time", exact=True), f"{start.astimezone(CENTRAL):%H:%M}")
    fill(form.get_by_role("spinbutton", name="Duration (minutes)", exact=True), str(body["duration_minutes"]))
    fill(form.get_by_role("textbox", name="Street address", exact=True), body["street_address"])
    fill(form.get_by_role("textbox", name="City", exact=True), body["city"])
    fill(form.get_by_role("textbox", name="Patient initials", exact=True), body["patient_initials"])
    fill(form.get_by_role("textbox", name="Medical notes", exact=True), body["medical_notes"])
    return form


def request_row(page: Page, number: str) -> Any:
    table = page.get_by_role("table", name="Requests", exact=True)
    return table.get_by_role("row").filter(has=page.get_by_role("button", name=f"Open {number}", exact=True))


def open_row(page: Page, number: str) -> Any:
    button = page.get_by_role("table", name="Requests", exact=True).get_by_role("button", name=f"Open {number}", exact=True)
    expect(button).to_be_visible(timeout=REAL_MS)
    click(button)
    drawer = page.get_by_role("dialog", name=f"Assignment {number}", exact=True)
    expect(drawer).to_be_visible(timeout=REAL_MS)
    advance(page, SETTLE_MS)
    return drawer


def focus_order(page: Page, presses: int, targets: dict[str, Any]) -> dict[str, int]:
    reached: dict[str, int] = {}
    for index in range(presses):
        page.keyboard.press("Tab")
        for name, target in targets.items():
            if name not in reached and target.evaluate("(e) => e === document.activeElement"):
                reached[name] = index
    return reached


def contrast_audit(page: Page) -> None:
    page.add_script_tag(path=str(conftest.AXE))
    page.evaluate(
        """options => {
          const result={done:false,error:null,violations:[]};
          Object.defineProperty(window,'__CONTRAST_RESULT__',{value:()=>structuredClone(result),configurable:true});
          axe.run(document,options).then(value=>{
            result.violations=value.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));result.done=true;
          },error=>{result.error=String(error);result.done=true});
        }""",
        {"runOnly": {"type": "rule", "values": ["color-contrast"]}},
    )
    spent = 0
    while not (status := page.evaluate("window.__CONTRAST_RESULT__()"))["done"]:
        assert spent < UI_BUDGET_MS, "contrast audit did not settle under controlled time"
        advance(page, STEP_MS)
        spent += STEP_MS
    assert status["error"] is None, status["error"]
    assert not status["violations"], f"contrast violations: {status['violations']}"


def stripes(picture: Any) -> int:
    width, best = picture.width, 0
    for y in range(picture.height):
        row = picture.rgb[y * width * 3:(y + 1) * width * 3]
        warm = [row[i] - max(row[i + 1], row[i + 2]) > WARM_MARGIN for i in range(0, len(row), 3)]
        best = max(best, sum(1 for a, b in zip(warm, warm[1:]) if a != b))
    return best


def same_answer(a: httpx.Response, a_number: str, b: httpx.Response, b_number: str) -> bool:
    return a.status_code == b.status_code and a.text.replace(a_number, "<number>") == b.text.replace(b_number, "<number>")


def offer_card(page: Page, city: str) -> Any:
    return page.get_by_role("list", name="Open seats", exact=True).get_by_role("listitem").filter(has_text=city)


def claim_button(page: Page, number: str, seat: int) -> Any:
    return page.get_by_role("list", name="Open seats", exact=True).get_by_role(
        "button", name=f"Claim seat {seat} on {number}", exact=True)


CREATE_CASES = {
    "valid": (lambda b, s: None, None),
    "language": (lambda b, s: b.update(language="xx"), "language"),
    "setting": (lambda b, s: b.update(setting="office"), "setting"),
    "start-too-soon": (lambda b, s: b.update(start_at=(now_central() + timedelta(minutes=30)).isoformat()), "start_at"),
    "start-too-far": (lambda b, s: b.update(start_at=central(now_central().date() + timedelta(days=MAX_DAYS_AHEAD + 35), 9).isoformat()), "start_at"),
    "start-off-quarter": (lambda b, s: b.update(start_at=s.replace(minute=10).isoformat()), "start_at"),
    "start-not-a-time": (lambda b, s: b.update(start_at="next tuesday"), "start_at"),
    "start-before-06": (lambda b, s: b.update(start_at=s.replace(hour=5, minute=45).isoformat()), "start_at"),
    "end-after-22": (lambda b, s: b.update(start_at=s.replace(hour=21, minute=0).isoformat()), "start_at"),
    "duration-step": (lambda b, s: b.update(duration_minutes=100), "duration_minutes"),
    "duration-short": (lambda b, s: b.update(duration_minutes=QUARTER), "duration_minutes"),
    "duration-long": (lambda b, s: b.update(duration_minutes=DURATION_MAX + QUARTER), "duration_minutes"),
    "street-empty": (lambda b, s: b.update(street_address=""), "street_address"),
    "street-long": (lambda b, s: b.update(street_address="S" * (STREET_MAX + 1)), "street_address"),
    "city-empty": (lambda b, s: b.update(city=""), "city"),
    "city-long": (lambda b, s: b.update(city="C" * (CITY_MAX + 1)), "city"),
    "initials-lower": (lambda b, s: b.update(patient_initials="rm"), "patient_initials"),
    "initials-four": (lambda b, s: b.update(patient_initials="ABCD"), "patient_initials"),
    "notes-long": (lambda b, s: b.update(medical_notes="n" * (NOTES_MAX + 1)), "medical_notes"),
}


CREATE_IDS = ["valid", "language", "setting", "start-too-soon", "start-too-far", "start-off-quarter", "start-not-a-time",
              "start-before-06", "end-after-22", "duration-step", "duration-short", "duration-long", "street-empty",
              "street-long", "city-empty", "city-long", "initials-lower", "initials-four", "notes-long"]


@pytest.mark.parametrize("case", CREATE_IDS, ids=CREATE_IDS)
def test_create_validation(app_url, case):
    sched = Api(app_url, RVH_SCHED)
    start = far_slot(90)
    body = body_for(start)
    mutate, field = CREATE_CASES[case]
    mutate(body, start)
    city = body["city"] or tag("city")
    r = sched.post("/api/assignments", body, headers={"Idempotency-Key": idempotency_key()})
    if field is None:
        assert r.status_code == 201, r.text
        first = r.json()
        assert set(first) == ORG_KEYS
        assert first["status"] == "draft"
        assert re.fullmatch(r"A-\d+", first["number"]) and int(first["number"][2:]) >= 1001
        assert all(s["status"] == "open" for s in first["seats"])
        second, _ = create(sched, far_slot(90))
        assert int(second["number"][2:]) == int(first["number"][2:]) + 1
        assert [a["number"] for a in search(sched, body["city"])] == [first["number"]]
    else:
        assert_error(r, 422, "validation", field)
        if body["city"] and len(body["city"]) <= CITY_MAX:
            assert search(sched, city) == []


SEAT_CASES = {
    "asl-60": ("asl", 60, None, 1),
    "asl-75": ("asl", 75, None, 2),
    "es-120": ("es", 120, None, 1),
    "patch-90-to-60": ("asl", 90, 60, 1),
    "patch-60-to-90": ("asl", 60, 90, 2),
}


SEAT_IDS = ["asl-60", "asl-75", "es-120", "patch-90-to-60", "patch-60-to-90"]


@pytest.mark.parametrize("case", SEAT_IDS, ids=SEAT_IDS)
def test_seat_count(app_url, case):
    language, minutes, patched, seats = SEAT_CASES[case]
    sched = Api(app_url, RVH_SCHED)
    created, _ = create(sched, far_slot(max(minutes, patched or 0)), language=language, minutes=minutes)
    if patched is None:
        assert sorted(s["seat"] for s in created["seats"]) == list(range(1, seats + 1))
    else:
        assert len(created["seats"]) == (2 if minutes > 60 else 1)
        r = sched.patch(f"/api/assignments/{created['number']}", {"duration_minutes": patched})
        assert r.status_code == 200, r.text
        assert sorted(s["seat"] for s in r.json()["seats"]) == list(range(1, seats + 1))
    stored = view(sched, created["number"]).json()
    assert len(stored["seats"]) == seats


def test_idempotent_create(app_url):
    sched = Api(app_url, RVH_SCHED)
    other = Api(app_url, RVH_SCHED2)
    body = body_for(far_slot(90))
    key = idempotency_key()
    first = sched.post("/api/assignments", body, headers={"Idempotency-Key": key})
    assert first.status_code == 201, first.text
    replay = sched.post("/api/assignments", body, headers={"Idempotency-Key": key})
    assert replay.status_code == 201, replay.text
    assert replay.headers.get("Idempotent-Replay") == "true"
    assert replay.json() == first.json()
    assert_error(sched.post("/api/assignments", dict(body, city=body["city"] + "x"), headers={"Idempotency-Key": key}),
                 409, "idempotency_conflict")
    assert search(sched, body["city"] + "x") == []

    crowd = body_for(far_slot(90))
    crowd_key = idempotency_key()
    clients = [Api(app_url, RVH_SCHED) for _ in range(6)]
    results = together([lambda c=c: c.post("/api/assignments", crowd, headers={"Idempotency-Key": crowd_key}) for c in clients])
    assert all(r.status_code == 201 for r in results), [r.text for r in results]
    assert len({r.json()["number"] for r in results}) == 1
    assert len(search(sched, crowd["city"])) == 1

    theirs = other.post("/api/assignments", body, headers={"Idempotency-Key": key})
    assert theirs.status_code == 201, theirs.text
    assert theirs.json()["number"] != first.json()["number"]
    assert sorted(a["number"] for a in search(sched, body["city"])) == sorted([first.json()["number"], theirs.json()["number"]])

    for bad in (None, "", "k" * (KEY_MAX + 1), "cl\xe9".encode("latin-1")):
        attempt = body_for(far_slot(90))
        headers = {} if bad is None else {"Idempotency-Key": bad}
        assert_error(sched.http.post("/api/assignments", json=attempt, headers=headers), 400, "idempotency_key_required")
        assert search(sched, attempt["city"]) == []


def test_release_sends_offers(app_url, mail):
    s = scenario(app_url, release=False)
    r = s.disp.post(f"/api/assignments/{s.number}/release")
    assert r.status_code == 200, r.text
    assert r.json()["offers_sent"] == len(ASL_INTERPRETERS)
    assert set(r.json()["assignment"]) == STAFF_KEYS and r.json()["assignment"]["status"] == "released"
    assert view(s.disp, s.number).json()["status"] == "released"
    found = mails(mail, s.number, len(ASL_INTERPRETERS), "Open seat")
    assert recipients(found) == sorted(ASL_INTERPRETERS)
    for m in found:
        assert m["Subject"] == f"Open seat {s.number}: ASL, {stamp(s.start)}"
        assert mail_from_address() in addresses(m["From"])
        assert_clean(m, secrets(s.body) + [RVH_SCHED_PHONE])
    assert_error(s.disp.post(f"/api/assignments/{s.number}/release"), 409, "invalid_transition")
    assert len(mails(mail, s.number, len(ASL_INTERPRETERS) + 1, "Open seat")) == len(ASL_INTERPRETERS)


def test_view_projection(app_url):
    s = scenario(app_url, free_for=(ROSA,), release=False)
    jordan, rosa, abdi = Api(app_url, JORDAN), s.people[ROSA], Api(app_url, ABDI)
    assert_error(view(jordan, s.number), 404, "not_found")
    assert s.disp.post(f"/api/assignments/{s.number}/release").status_code == 200
    offer = next(a for a in jordan.get("/api/offers").json()["offers"] if a["number"] == s.number)
    assert set(offer) == OFFER_KEYS
    assert all(set(seat) == {"seat", "status"} for seat in offer["seats"])
    assert set(view(jordan, s.number).json()) == OFFER_KEYS
    claimed = rosa.post(seat_path(s.number, 1, "claim"))
    assert claimed.status_code == 200, claimed.text
    holder = claimed.json()
    assert set(holder) == HOLDER_KEYS
    assert all(set(seat) == {"seat", "status", "interpreter_initials"} for seat in holder["seats"])
    assert holder["street_address"] == s.body["street_address"] and holder["patient_initials"] == PATIENT
    assert holder["scheduler"] == {"name": RVH_SCHED_NAME, "phone": RVH_SCHED_PHONE}
    mine = next(a for a in rosa.get("/api/my-seats").json()["assignments"] if a["number"] == s.number)
    assert set(mine) == HOLDER_KEYS
    still = view(jordan, s.number).json()
    assert set(still) == OFFER_KEYS
    for secret in secrets(s.body) + [RVH_SCHED_PHONE]:
        assert secret not in json.dumps(still)
    assert_error(view(abdi, s.number), 404, "not_found")
    assert s.number not in [a["number"] for a in abdi.get("/api/offers").json()["offers"]]
    org = view(s.sched, s.number).json()
    assert set(org) == ORG_KEYS
    staff = view(s.disp, s.number).json()
    assert set(staff) == STAFF_KEYS
    assert staff["org"] == {"code": "RVH", "name": ORGS["RVH"]}
    first = next(seat for seat in staff["seats"] if seat["seat"] == 1)
    assert first["interpreter_name"] == NAMES[ROSA] and first["interpreter_initials"] == INITIALS[ROSA]


def test_one_holder_per_seat(app_url):
    s = scenario(app_url, free_for=ASL_INTERPRETERS)
    clients = [(e, Api(app_url, e)) for e in ASL_INTERPRETERS for _ in range(2)]
    results = together([lambda c=c: c.post(seat_path(s.number, 2, "claim")) for _, c in clients])
    winners = [clients[i][0] for i, r in enumerate(results) if r.status_code == 200]
    assert len(winners) == 1, [r.text for r in results]
    for r in results:
        if r.status_code != 200:
            assert_error(r, 409, "seat_taken")
    seats = seat_states(view(s.disp, s.number).json())
    assert seats[2] == ("held", INITIALS[winners[0]])
    assert seats[1] == ("open", None)


def test_claim_guards(app_url):
    rosa, samuel, jordan, abdi = (Api(app_url, e) for e in (ROSA, SAMUEL, JORDAN, ABDI))
    base = far_slot(150, [rosa])
    a = scenario(app_url, start=base, minutes=90)
    b = scenario(app_url, start=base + timedelta(minutes=30), minutes=60)
    c = scenario(app_url, start=base + timedelta(minutes=90), minutes=60)
    assert rosa.post(seat_path(a.number, 1, "claim")).status_code == 200
    assert_error(samuel.post(seat_path(a.number, 1, "claim")), 409, "seat_taken")
    assert_error(rosa.post(seat_path(a.number, 1, "claim")), 409, "seat_taken")
    assert_error(rosa.post(seat_path(a.number, 2, "claim")), 409, "already_holding")
    assert_error(rosa.post(seat_path(b.number, 1, "claim")), 409, "calendar_conflict")
    assert seat_states(view(a.disp, b.number).json())[1] == ("open", None)
    touching = rosa.post(seat_path(c.number, 1, "claim"))
    assert touching.status_code == 200, touching.text
    assert_error(rosa.post(seat_path(a.number, 3, "claim")), 404, "not_found")
    assert_error(view(abdi, a.number), 404, "not_found")
    assert_error(abdi.post(seat_path(a.number, 2, "claim")), 404, "not_found")
    assert a.number not in [o["number"] for o in abdi.get("/api/offers").json()["offers"]]

    d_start = far_slot(90, [jordan])
    d = scenario(app_url, start=d_start, minutes=90)
    j1, j2 = Api(app_url, JORDAN), Api(app_url, JORDAN)
    both = together([lambda: j1.post(seat_path(d.number, 1, "claim")), lambda: j2.post(seat_path(d.number, 2, "claim"))])
    assert sorted(r.status_code for r in both) == [200, 409], [r.text for r in both]
    assert_error(next(r for r in both if r.status_code == 409), 409, "already_holding")
    held_seats = [n for n, (st, _) in seat_states(view(d.disp, d.number).json()).items() if st == "held"]
    assert len(held_seats) == 1

    e_start = far_slot(90, [jordan], avoid=[(d_start, d_start + timedelta(minutes=90))])
    e1 = scenario(app_url, start=e_start, minutes=60)
    e2 = scenario(app_url, start=e_start + timedelta(minutes=30), minutes=60)
    race = together([lambda: j1.post(seat_path(e1.number, 1, "claim")), lambda: j2.post(seat_path(e2.number, 1, "claim"))])
    assert sorted(r.status_code for r in race) == [200, 409], [r.text for r in race]
    assert_error(next(r for r in race if r.status_code == 409), 409, "calendar_conflict")
    holds = [seat_states(view(d.disp, n).json())[1][0] for n in (e1.number, e2.number)]
    assert sorted(holds) == ["held", "open"]


def test_give_back(app_url):
    s = scenario(app_url, free_for=ASL_INTERPRETERS, claims=((1, ROSA), (2, SAMUEL)))
    rosa, samuel = s.people[ROSA], s.people[SAMUEL]
    jordan = s.people[JORDAN]
    assert view(s.disp, s.number).json()["status"] == "covered"
    assert_error(samuel.post(seat_path(s.number, 1, "give-back")), 403, "forbidden")
    r = samuel.post(seat_path(s.number, 2, "give-back"))
    assert r.status_code == 200, r.text
    assert set(r.json()) == OFFER_KEYS
    after = view(s.disp, s.number).json()
    assert after["status"] == "partially_covered"
    assert seat_states(after) == {1: ("held", INITIALS[ROSA]), 2: ("open", None)}
    assert rosa.post(seat_path(s.number, 1, "give-back")).status_code == 200
    after = view(s.disp, s.number).json()
    assert after["status"] == "released"
    assert all(st == "open" for st, _ in seat_states(after).values())
    assert_error(jordan.post(seat_path(s.number, 1, "give-back")), 403, "forbidden")
    assert rosa.post(seat_path(s.number, 1, "claim")).status_code == 200
    assert jordan.post(seat_path(s.number, 2, "claim")).status_code == 200
    assert verify(rosa, s.number, 1).status_code == 201
    assert_error(rosa.post(seat_path(s.number, 1, "give-back")), 409, "invalid_transition")
    assert seat_states(view(s.disp, s.number).json()) == {1: ("served", INITIALS[ROSA]), 2: ("held", INITIALS[JORDAN])}


def test_claim_emails(app_url, mail):
    s = scenario(app_url, free_for=ASL_INTERPRETERS)
    rosa, samuel, jordan = (s.people[e] for e in ASL_INTERPRETERS)
    assert rosa.post(seat_path(s.number, 1, "claim")).status_code == 200
    confirm = mails(mail, s.number, 1, "Seat 1 confirmed")
    assert len(confirm) == 1 and recipients(confirm) == [ROSA]
    assert confirm[0]["Subject"] == f"Seat 1 confirmed on {s.number}"
    body = body_of(confirm[0])
    for part in (s.body["street_address"], s.body["city"], span(s.start, s.end), RVH_SCHED_NAME, RVH_SCHED_PHONE):
        assert part in body
    assert_clean(confirm[0], [PATIENT, s.body["medical_notes"]])
    assert mails(mail, s.number, 0, "is fully covered") == []
    assert_error(jordan.post(seat_path(s.number, 1, "claim")), 409, "seat_taken")
    assert samuel.post(seat_path(s.number, 2, "claim")).status_code == 200
    covered = mails(mail, s.number, 1, "is fully covered")
    assert len(covered) == 1 and recipients(covered) == [RVH_SCHED]
    assert covered[0]["Subject"] == f"{s.number} is fully covered"
    assert INITIALS[ROSA] in body_of(covered[0]) and INITIALS[SAMUEL] in body_of(covered[0])
    assert_clean(covered[0], [PATIENT, s.body["medical_notes"]])
    assert samuel.post(seat_path(s.number, 2, "give-back")).status_code == 200
    assert jordan.post(seat_path(s.number, 2, "claim")).status_code == 200
    covered = mails(mail, s.number, 2, "is fully covered")
    assert len(covered) == 2
    assert recipients(mails(mail, s.number, 2, "Seat 2 confirmed")) == sorted([SAMUEL, JORDAN])
    assert not [m for m in mails(mail, s.number, 0, "confirmed") if JORDAN in recipients([m]) and "Seat 1" in m["Subject"]]


def test_uncovered_minutes(app_url):
    disp, sched = Api(app_url, DISPATCHER), Api(app_url, RVH_SCHED)
    rosa, samuel = Api(app_url, ROSA), Api(app_url, SAMUEL)
    start = far_slot(90, [rosa, samuel])
    week = week_of(start)
    r = disp.get("/api/coverage", params={"week": week.isoformat()})
    assert r.status_code == 200, r.text
    assert date.fromisoformat(r.json()["week_start"][:10]) == week
    assert [(lang["code"], lang["name"]) for lang in r.json()["languages"]] == SEED_LANGUAGES
    asl0, es0 = uncovered(disp, week, "asl"), uncovered(disp, week, "es")
    team, _ = create(sched, start, minutes=90)
    assert uncovered(disp, week, "asl") == asl0 + 90 * 2
    spoken, _ = create(sched, central(cday(start), DAY_START_H), language="es", minutes=45)
    assert uncovered(disp, week, "es") == es0 + 45
    assert disp.post(f"/api/assignments/{team['number']}/release").status_code == 200
    assert uncovered(disp, week, "asl") == asl0 + 90 * 2
    assert rosa.post(seat_path(team["number"], 1, "claim")).status_code == 200
    assert uncovered(disp, week, "asl") == asl0 + 90
    row = next(lang for lang in disp.get("/api/coverage", params={"week": week.isoformat()}).json()["languages"] if lang["code"] == "asl")
    listed = next(a for a in row["assignments"] if a["number"] == team["number"])
    assert listed["status"] == "partially_covered" and listed["org_code"] == "RVH"
    assert samuel.post(seat_path(team["number"], 2, "claim")).status_code == 200
    assert uncovered(disp, week, "asl") == asl0
    assert sched.post(f"/api/assignments/{spoken['number']}/cancel").status_code == 200
    assert uncovered(disp, week, "es") == es0
    assert_error(disp.get("/api/coverage", params={"week": (week + timedelta(days=1)).isoformat()}), 422, "validation", "week")


def test_hatch_seam_on_board(browser, app_url):
    s = scenario(app_url, free_for=(ROSA, SAMUEL), minutes=SEAM_DURATION)
    week = week_of(s.start)
    with screen(browser, app_url, DISPATCHER, "/board") as page:
        board = open_week(page, week)
        capsule = capsule_of(board, s.number)
        first, second = lane(capsule, 1), lane(capsule, 2)
        numeral = numeral_of(page, "ASL")
        expect(first).to_contain_text("open", timeout=REAL_MS)
        expect(second).to_contain_text("open")
        expect(capsule).to_have_accessible_name(re.compile(r"0 of 2 covered"))
        expect(capsule.get_by_role("img", name="All seats covered")).to_have_count(0)
        before = uncovered(s.disp, week, "asl")
        eventually(page, lambda: expect(numeral).to_have_text(clock_re(before), timeout=POLL_MS))

        page.evaluate(MOTION_PROBE)
        base_start, base_end = halves(page, first)
        assert s.people[ROSA].post(seat_path(s.number, 1, "claim")).status_code == 200
        after = uncovered(s.disp, week, "asl")
        assert after == before - s.minutes

        def begun() -> None:
            if first.evaluate(MOTION_RECORDED):
                return
            now_start, now_end = halves(page, first)
            assert max(difference(base_start, now_start), difference(base_end, now_end)) > FIRST_CHANGE, "no sweep yet"

        eventually(page, begun, budget_ms=REFRESH_WAIT_S * 1000, step_ms=DETECT_MS)
        expect(first).to_contain_text("open")
        expect(numeral).to_have_text(clock_re(before))
        if first.evaluate(MOTION_RECORDED):
            sweep = max(first.evaluate(MOTION_DURATIONS))
            assert SWEEP_MIN_MS <= sweep <= SWEEP_MAX_MS, sweep
            first.evaluate(MOTION_SEEK, 0.5)
            mid_start, mid_end = halves(page, first)
            first.evaluate(MOTION_SEEK, 1)
            _, end_end = halves(page, first)
        else:
            mid_start, mid_end = halves(page, first)
            previous, last_change, elapsed = decode(capture(first)), 0, 0
            while elapsed < SWEEP_MAX_MS * 2:
                advance(page, FINE_MS)
                elapsed += FINE_MS
                current = decode(capture(first))
                if difference(previous, current) > 0:
                    last_change = elapsed
                previous = current
            assert SWEEP_MIN_MS - DETECT_MS - FINE_MS <= last_change <= SWEEP_MAX_MS + FINE_MS, last_change
            _, end_end = halves(page, first)
        assert difference(base_start, mid_start) > difference(base_end, mid_end)
        changed(base_end, end_end)

        finish = lambda: page.evaluate(MOTION_FINISH)
        eventually(page, lambda: expect(first).to_contain_text(INITIALS[ROSA], timeout=POLL_MS), each=finish)
        spent = eventually(page, lambda: expect(numeral).to_have_text(clock_re(after), timeout=POLL_MS), each=finish)
        assert spent <= COUNT_MAX_MS + STEP_MS, spent
        expect(capsule).to_have_accessible_name(re.compile(r"1 of 2 covered"))
        expect(capsule.get_by_role("img", name="All seats covered")).to_have_count(0)

        assert s.people[SAMUEL].post(seat_path(s.number, 2, "claim")).status_code == 200
        eventually(page, lambda: expect(second).to_contain_text(INITIALS[SAMUEL], timeout=POLL_MS), each=finish)
        eventually(page, lambda: expect(capsule.get_by_role("img", name="All seats covered")).to_be_visible(timeout=POLL_MS), each=finish)
        expect(capsule).to_have_accessible_name(re.compile(r"2 of 2 covered"))
        final = uncovered(s.disp, week, "asl")
        eventually(page, lambda: expect(numeral).to_have_text(clock_re(final), timeout=POLL_MS), each=finish)


def test_reduced_motion_board(browser, app_url):
    s = scenario(app_url, free_for=(ROSA,), minutes=60)
    week = week_of(s.start)
    with screen(browser, app_url, DISPATCHER, "/board", reduced_motion="reduce") as page:
        board = open_week(page, week)
        capsule = capsule_of(board, s.number)
        seat = lane(capsule, 1)
        numeral = numeral_of(page, "ASL")
        expect(seat).to_contain_text("open", timeout=REAL_MS)
        expect(capsule).to_have_accessible_name(re.compile(r"0 of 1 covered"))
        page.evaluate(MOTION_PROBE)
        click(capsule)
        drawer = page.get_by_role("dialog", name=f"Assignment {s.number}", exact=True)
        expect(drawer).to_be_visible(timeout=REAL_MS)
        assert all(d < INSTANT_MS for d in drawer.evaluate(MOTION_DURATIONS))
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(drawer).to_be_hidden(timeout=POLL_MS))
        eventually(page, lambda: expect(capsule).to_be_focused(timeout=POLL_MS))
        mark = page.evaluate("() => (window.__motion || []).length")
        with held(page, "**/api/coverage*") as gate:
            assert s.people[ROSA].post(seat_path(s.number, 1, "claim")).status_code == 200
            advance(page, REFRESH_MS + STEP_MS)
            gate.release()
        after = uncovered(s.disp, week, "asl")
        eventually(page, lambda: expect(seat).to_contain_text(INITIALS[ROSA], timeout=POLL_MS))
        expect(numeral).to_have_text(clock_re(after))
        expect(capsule.get_by_role("img", name="All seats covered")).to_be_visible()
        expect(capsule).to_have_accessible_name(re.compile(r"1 of 1 covered"))
        says(page, "Board updates", f"ASL, {day_text(s.start)}: seat 1 covered by {INITIALS[ROSA]}, {words(after)} uncovered this week")
        assert all(d < INSTANT_MS for d in capsule.evaluate(MOTION_SINCE, mark) + numeral.evaluate(MOTION_SINCE, mark))


def test_not_colour_alone(browser, app_url):
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA),), minutes=SEAM_DURATION)
    with screen(browser, app_url, DISPATCHER, "/board") as page:
        board = open_week(page, week_of(s.start))
        capsule = capsule_of(board, s.number)
        covered_lane, open_lane = lane(capsule, 1), lane(capsule, 2)
        expect(covered_lane).to_contain_text(INITIALS[ROSA], timeout=REAL_MS)
        expect(covered_lane).not_to_contain_text("open")
        expect(open_lane).to_contain_text("open")
        expect(capsule).to_have_accessible_name(re.compile(r"1 of 2 covered"))
        expect(capsule.get_by_role("img", name="All seats covered")).to_have_count(0)
        hatched = decode(capture(open_lane))
        solid = decode(capture(covered_lane))
        assert stripes(hatched) >= STRIPE_MIN and stripes(solid) * 2 < stripes(hatched), (stripes(hatched), stripes(solid))


def test_business_minute_notice(app_url):
    billing = Api(app_url, BILLING)
    far_start = far_slot(60, weekday=4, hours=(21,))
    far = scenario(app_url, start=far_start, minutes=60, language="es")
    before = datetime.now(timezone.utc)
    r = far.sched.get(f"/api/assignments/{far.number}/cancellation-quote")
    after = datetime.now(timezone.utc)
    assert r.status_code == 200, r.text
    quote = r.json()
    assert_notice(quote["business_minutes_notice"], before, after, far_start)
    assert quote["fee_applies"] is False and quote["fee_cents"] == 0
    assert quote["business_minutes_notice"] >= NOTICE_LATE_MIN

    soon = scenario(app_url, soon=True, minutes=60, language="es")
    before = datetime.now(timezone.utc)
    q = soon.sched.get(f"/api/assignments/{soon.number}/cancellation-quote").json()
    after = datetime.now(timezone.utc)
    assert_notice(q["business_minutes_notice"], before, after, soon.start)
    assert q["business_minutes_notice"] < NOTICE_LATE_MIN
    rate = rate_on(billing, "RVH", "spoken", cday(soon.start))
    assert q["fee_applies"] is True
    assert q["fee_cents"] == seat_cents(rate["hourly_rate_cents"], MIN_BILLABLE)[1]
    assert view(soon.sched, soon.number).json()["cancellation"] is None

    draft = scenario(app_url, soon=True, minutes=60, language="es", release=False)
    dq = draft.sched.get(f"/api/assignments/{draft.number}/cancellation-quote").json()
    assert dq["fee_applies"] is False and dq["fee_cents"] == 0


def test_cancellation_decision_and_notices(app_url, mail):
    billing = Api(app_url, BILLING)
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA), (2, SAMUEL)), soon=True)
    rate = rate_on(billing, "RVH", "asl", cday(s.start))
    fee = 2 * seat_cents(rate["hourly_rate_cents"], MIN_BILLABLE)[1]
    before = datetime.now(timezone.utc)
    r = s.sched.post(f"/api/assignments/{s.number}/cancel")
    after = datetime.now(timezone.utc)
    assert r.status_code == 200, r.text
    done = r.json()
    assert set(done) == ORG_KEYS and done["status"] == "cancelled"
    decision = done["cancellation"]
    assert decision["fee_applies"] is True and decision["fee_cents"] == fee
    assert_notice(decision["business_minutes_notice"], before, after, s.start)
    assert view(s.sched, s.number).json()["cancellation"] == decision
    assert_error(s.sched.post(f"/api/assignments/{s.number}/cancel"), 409, "invalid_transition")
    notices = mails(mail, s.number, 3, "cancelled")
    assert recipients(notices) == sorted([RVH_SCHED, ROSA, SAMUEL])
    for m in notices:
        assert m["Subject"] == f"{s.number} cancelled — fee applies"
        assert f"A late-cancellation fee of {money(fee)} applies." in body_of(m)
        assert_clean(m, [PATIENT, s.body["medical_notes"]])
    assert len(mails(mail, s.number, 4, "cancelled")) == 3

    calm = scenario(app_url, free_for=(JORDAN,), claims=((1, JORDAN),), minutes=60)
    c = calm.sched.post(f"/api/assignments/{calm.number}/cancel").json()["cancellation"]
    assert c["fee_applies"] is False and c["fee_cents"] == 0
    calm_notices = mails(calm and mail, calm.number, 2, "cancelled")
    assert recipients(calm_notices) == sorted([RVH_SCHED, JORDAN])
    for m in calm_notices:
        assert m["Subject"] == f"{calm.number} cancelled — no fee"
        assert "No fee applies." in body_of(m)

    draft = scenario(app_url, soon=True, release=False, minutes=60)
    d = draft.sched.post(f"/api/assignments/{draft.number}/cancel").json()["cancellation"]
    assert d["fee_applies"] is False and d["fee_cents"] == 0
    assert recipients(mails(mail, draft.number, 1, "cancelled")) == [RVH_SCHED]


def test_change_time(app_url, mail):
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA), (2, SAMUEL)))
    new_start = far_slot(60, list(s.people.values()), avoid=[(s.start, s.end)])
    r = s.sched.patch(f"/api/assignments/{s.number}", {"start_at": new_start.isoformat(), "duration_minutes": 60})
    assert r.status_code == 200, r.text
    moved = view(s.disp, s.number).json()
    assert moved["status"] == "released" and parse(moved["start_at"]) == new_start
    assert seat_states(moved) == {1: ("open", None)}
    assert moved["cancellation"] is None
    notices = mails(mail, s.number, 3, "changed")
    assert recipients(notices) == sorted([RVH_SCHED, ROSA, SAMUEL])
    for m in notices:
        assert m["Subject"] == f"{s.number} changed — no fee"
        assert "No fee applies." in body_of(m)
        assert span(new_start, new_start + timedelta(minutes=60)) in body_of(m)
        assert_clean(m, [PATIENT, s.body["medical_notes"]])
    reoffers = [m for m in mails(mail, s.number, 6, "Open seat") if m["Subject"] == f"Open seat {s.number}: ASL, {stamp(new_start)}"]
    assert recipients(reoffers) == sorted(ASL_INTERPRETERS)

    late = scenario(app_url, free_for=(JORDAN,), claims=((1, JORDAN),), soon=True, minutes=60)
    shifted = (late.start + timedelta(days=1)).isoformat()
    assert_error(late.sched.patch(f"/api/assignments/{late.number}", {"start_at": shifted}), 409, "late_change")
    kept = view(late.disp, late.number).json()
    assert parse(kept["start_at"]) == late.start and seat_states(kept)[1] == ("held", INITIALS[JORDAN])
    edit = late.sched.patch(f"/api/assignments/{late.number}", {"city": late.body["city"] + " East"})
    assert edit.status_code == 200, edit.text
    assert seat_states(view(late.disp, late.number).json())[1] == ("held", INITIALS[JORDAN])
    assert mails(mail, late.number, 0, "changed") == []

    draft = scenario(app_url, release=False, minutes=60)
    later = far_slot(60, avoid=[(draft.start, draft.end)])
    assert draft.sched.patch(f"/api/assignments/{draft.number}", {"start_at": later.isoformat()}).status_code == 200
    assert view(draft.sched, draft.number).json()["status"] == "draft"
    assert mails(mail, draft.number, 0, "Open seat") == []


def test_upload_checks(app_url):
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA), (2, SAMUEL)))
    rosa, samuel = s.people[ROSA], s.people[SAMUEL]
    store = S3()
    prefix = f"verifications/{s.number}/"
    for content, ctype, name in ((TEXT_AS_PDF, "application/pdf", "form.pdf"), (JPEG, "image/png", "form.png"),
                                 (SVG, "image/svg+xml", "form.svg"), (HTML, "text/html", "form.html")):
        assert_error(verify(rosa, s.number, 1, content=content, ctype=ctype, name=name), 422, "validation", "form")
    assert_error(verify(rosa, s.number, 1, minutes=0), 422, "validation", "actual_minutes")
    assert_error(verify(rosa, s.number, 1, miles=MILEAGE_MAX + 1), 422, "validation", "round_trip_miles")
    big = JPEG[:4] + b"\x00" * (FORM_LIMIT + 1 - 4)
    try:
        oversized = verify(rosa, s.number, 1, content=big)
    except (httpx.WriteError, httpx.ReadError, httpx.RemoteProtocolError):
        oversized = None
    if oversized is not None:
        assert_error(oversized, 413, "payload_too_large")
    assert store.keys(prefix) == []
    assert seat_states(view(s.disp, s.number).json())[1][0] == "held"
    exact = JPEG[:4] + b"\x00" * (FORM_LIMIT - 4)
    ok = verify(rosa, s.number, 1, content=exact, name="../../etc/passwd.jpg")
    assert ok.status_code == 201, ok.text[:300]
    keys = store.keys(f"{prefix}seat-1/")
    assert len(keys) == 1 and keys[0].endswith(".jpg") and "passwd" not in keys[0]
    assert store.get(keys[0]) == exact
    assert verify(samuel, s.number, 2, content=PDF, ctype="application/pdf", name="form.pdf").status_code == 201
    pdf_keys = store.keys(f"{prefix}seat-2/")
    assert len(pdf_keys) == 1 and pdf_keys[0].endswith(".pdf") and store.get(pdf_keys[0]) == PDF


def test_private_form_links(app_url):
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA), (2, SAMUEL)))
    rosa = s.people[ROSA]
    assert verify(rosa, s.number, 1, content=PNG, ctype="image/png", name="form.png").status_code == 201
    link = seat_path(s.number, 1, "verification-link")
    issued = rosa.get(link)
    assert issued.status_code == 200, issued.text
    payload = issued.json()
    assert payload["expires_in_seconds"] == LINK_TTL_S and payload["url"].startswith("/files/")
    issued_at = time.monotonic()
    got = rosa.get(payload["url"])
    assert got.status_code == 200 and got.content == PNG
    assert got.headers["content-type"].startswith("image/png")
    assert got.headers["content-disposition"].lower().startswith("attachment")
    assert "no-store" in got.headers["cache-control"]
    tomas = Api(app_url, RVH_SCHED)
    assert tomas.get(payload["url"]).status_code == 404
    for email in (RVH_SCHED, RVH_SCHED2, RVH_ADMIN, DISPATCHER, BILLING):
        person = Api(app_url, email)
        own = person.get(link)
        assert own.status_code == 200, (email, own.text)
        assert person.get(own.json()["url"]).content == PNG
    for email in (CPSD_SCHED, CPSD_ADMIN, JORDAN):
        assert_error(Api(app_url, email).get(link), 404, "not_found")
    assert_error(s.disp.get(seat_path(s.number, 2, "verification-link")), 404, "not_found")
    status = poll(lambda: rosa.get(payload["url"]).status_code, lambda st: st == 404, LINK_TTL_S + LINK_SLACK_S)
    assert status == 404
    assert time.monotonic() - issued_at <= LINK_TTL_S + LINK_SLACK_S * 2


def test_served_and_verified(app_url):
    billing = Api(app_url, BILLING)
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA), (2, SAMUEL)))
    invoice = f"/api/assignments/{s.number}/invoice"
    assert_error(billing.post(invoice), 409, "not_billable")
    first = verify(s.people[ROSA], s.number, 1)
    assert first.status_code == 201, first.text
    assert set(first.json()) == HOLDER_KEYS and first.json()["status"] == "served"
    assert seat_states(first.json())[1][0] == "served"
    assert_error(billing.post(invoice), 409, "not_billable")
    assert_error(billing.get(f"/api/assignments/{s.number}/charges"), 409, "not_billable")
    assert_error(verify(s.people[ROSA], s.number, 1), 409, "already_verified")
    last = verify(s.people[SAMUEL], s.number, 2)
    assert last.status_code == 201 and last.json()["status"] == "verified"
    assert billing_of(billing, s.number)["status"] == "ready"
    partial = scenario(app_url, free_for=(JORDAN,), claims=((1, JORDAN),))
    assert_error(verify(partial.people[JORDAN], partial.number, 1), 409, "invalid_transition")
    assert billing_of(billing, partial.number)["status"] == "none"


def test_billable_amounts(app_url):
    billing = Api(app_url, BILLING)
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA), (2, SAMUEL)))
    for seat, email, miles in ((1, ROSA, EXAMPLE_MILES[0]), (2, SAMUEL, EXAMPLE_MILES[1])):
        assert verify(s.people[email], s.number, seat, EXAMPLE_MINUTES, miles).status_code == 201
    rate = rate_on(billing, "RVH", "asl", cday(s.start))
    hourly, per_mile = rate["hourly_rate_cents"], rate["mileage_cents_per_mile"]
    ch = charges(billing, s.number)
    assert ch["kind"] == "service" and ch["number"] == s.number
    assert ch["rate"]["effective_from"] == rate["effective_from"] and ch["rate"]["hourly_rate_cents"] == hourly
    lines = sorted(ch["lines"], key=lambda line: line["seat"])
    amount = seat_cents(hourly, EXAMPLE_MINUTES)[1]
    extra = EXAMPLE_MILES[0] - FREE_MILES
    assert [(l["actual_minutes"], l["billable_minutes"], l["amount_cents"]) for l in lines] == [(EXAMPLE_MINUTES, MIN_BILLABLE, amount)] * 2
    assert [(l["round_trip_miles"], l["billable_miles"], l["mileage_cents"]) for l in lines] == [
        (EXAMPLE_MILES[0], extra, extra * per_mile), (EXAMPLE_MILES[1], 0, 0)]
    assert ch["total_cents"] == 2 * amount + extra * per_mile
    if (hourly, per_mile) == (SEED_RATE_ASL, SEED_MILEAGE):
        assert ch["total_cents"] == EXAMPLE_TEAM_TOTAL
    assert billing_of(billing, s.number)["total_cents"] in (None, ch["total_cents"])

    spoken = scenario(app_url, free_for=(LINH,), claims=((1, LINH),), language="es", minutes=120)
    assert verify(spoken.people[LINH], spoken.number, 1, EXAMPLE_SPOKEN_MINUTES, FREE_MILES).status_code == 201
    srate = rate_on(billing, "RVH", "spoken", cday(spoken.start))["hourly_rate_cents"]
    sch = charges(billing, spoken.number)
    line = sch["lines"][0]
    assert line["billable_minutes"] == EXAMPLE_SPOKEN_BILLABLE
    assert line["amount_cents"] == seat_cents(srate, EXAMPLE_SPOKEN_MINUTES)[1]
    assert line["billable_miles"] == 0 and line["mileage_cents"] == 0
    if srate == SEED_RATE_SPOKEN:
        assert line["amount_cents"] == EXAMPLE_SPOKEN_AMOUNT
    queue = {i["number"]: i for i in billing.get("/api/billing/queue").json()["items"]}
    assert queue[s.number]["total_cents"] == ch["total_cents"]
    assert queue[spoken.number]["total_cents"] == sch["total_cents"]


def kb_charges(killbill, org: str, number: str) -> list[dict]:
    account = killbill.account_by_key(f"teamseat-{org}")
    if account is None:
        return []
    names = {f"{number} service", f"{number} late cancellation"}
    return [{**item, "invoiceId": item.get("invoiceId") or invoice.get("invoiceId")}
            for invoice in killbill.invoices(account["accountId"]) if invoice.get("status") != "VOID"
            for item in invoice.get("items") or []
            if item.get("itemType") == "EXTERNAL_CHARGE" and item.get("description") in names]


def assert_one_charge(killbill, org: str, number: str, total_cents: int, kind: str, invoice_id: str) -> None:
    found = kb_charges(killbill, org, number)
    assert len(found) == 1, f"expected exactly one Kill Bill charge for {number} on teamseat-{org}, found {len(found)}"
    item = found[0]
    want = f"{number} {'late cancellation' if kind == 'late_cancellation' else 'service'}"
    assert item["description"] == want, (item["description"], want)
    assert Decimal(str(item["amount"])) * 100 == total_cents, (item["amount"], total_cents)
    assert item.get("currency", "USD") == "USD", item.get("currency")
    assert item["invoiceId"] == invoice_id, (item["invoiceId"], invoice_id)


def test_one_invoice_item(app_url, killbill):
    billing = Api(app_url, BILLING)
    s = scenario(app_url, free_for=(JORDAN,), claims=((1, JORDAN),), minutes=60, scheduler=CPSD_SCHED)
    path = f"/api/assignments/{s.number}/invoice"
    assert_error(billing.post(path), 409, "not_billable")
    assert verify(s.people[JORDAN], s.number, 1).status_code == 201
    total = charges(billing, s.number)["total_cents"]
    first = billing.post(path)
    assert first.status_code == 201, first.text
    bill = first.json()["billing"]
    assert bill["status"] == "posted" and isinstance(bill["invoice_id"], str) and bill["invoice_id"]
    assert bill["total_cents"] == total
    repeats = together([lambda c=c: c.post(path) for c in [Api(app_url, BILLING) for _ in range(4)]])
    assert all(r.status_code == 200 and r.json()["billing"]["invoice_id"] == bill["invoice_id"] for r in repeats)
    stored = view(billing, s.number).json()
    assert stored["status"] == "invoiced" and stored["billing"] == bill
    item = next(i for i in billing.get("/api/billing/queue").json()["items"] if i["number"] == s.number)
    assert item["billing"]["status"] == "posted" and item["billing"]["invoice_id"] == bill["invoice_id"]
    account = killbill.account_by_key("teamseat-CPSD")
    assert account is not None and account["name"] == ORGS["CPSD"] and account["currency"] == "USD"
    assert_one_charge(killbill, "CPSD", s.number, total, "service", bill["invoice_id"])

    other = scenario(app_url, free_for=(JORDAN,), claims=((1, JORDAN),), minutes=60, scheduler=CPSD_SCHED)
    assert verify(other.people[JORDAN], other.number, 1).status_code == 201
    opath = f"/api/assignments/{other.number}/invoice"
    rush = together([lambda c=c: c.post(opath) for c in [Api(app_url, BILLING) for _ in range(4)]])
    assert all(r.status_code in (200, 201, 202) for r in rush), [r.text for r in rush]
    assert sum(r.status_code == 201 for r in rush) <= 1
    final = poll(lambda: billing_of(billing, other.number), lambda b: b["status"] == "posted", OUTAGE_DEADLINE_S)
    assert final["status"] == "posted"
    assert all(r.json()["billing"]["invoice_id"] == final["invoice_id"] for r in rush if r.json()["billing"]["status"] == "posted")
    assert_one_charge(killbill, "CPSD", other.number, final["total_cents"], "service", final["invoice_id"])


def test_late_cancellation_charges(app_url, killbill):
    billing = Api(app_url, BILLING)
    s = scenario(app_url, soon=True)
    fee = s.sched.post(f"/api/assignments/{s.number}/cancel").json()["cancellation"]["fee_cents"]
    rate = rate_on(billing, "RVH", "asl", cday(s.start))["hourly_rate_cents"]
    ch = charges(billing, s.number)
    assert ch["kind"] == "late_cancellation"
    assert sorted(l["seat"] for l in ch["lines"]) == [1, 2]
    for l in ch["lines"]:
        assert l["actual_minutes"] is None and l["billable_minutes"] == MIN_BILLABLE
        assert l["amount_cents"] == seat_cents(rate, MIN_BILLABLE)[1]
        assert l["billable_miles"] == 0 and l["mileage_cents"] == 0
    assert ch["total_cents"] == fee
    item = next(i for i in billing.get("/api/billing/queue").json()["items"] if i["number"] == s.number)
    assert item["kind"] == "late_cancellation" and item["billing"]["status"] == "ready"
    posted = billing.post(f"/api/assignments/{s.number}/invoice")
    assert posted.status_code == 201, posted.text
    assert posted.json()["billing"]["status"] == "posted" and posted.json()["billing"]["total_cents"] == fee
    assert_one_charge(killbill, "RVH", s.number, fee, "late_cancellation", posted.json()["billing"]["invoice_id"])
    assert view(billing, s.number).json()["status"] == "cancelled"
    free_cancel = scenario(app_url, minutes=60)
    assert free_cancel.sched.post(f"/api/assignments/{free_cancel.number}/cancel").json()["cancellation"]["fee_applies"] is False
    assert_error(billing.post(f"/api/assignments/{free_cancel.number}/invoice"), 409, "not_billable")
    assert_error(billing.get(f"/api/assignments/{free_cancel.number}/charges"), 409, "not_billable")


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Relay:

    def __init__(self, port: int, upstream: tuple[str, int]):
        self.port, self.upstream, self.sock = port, upstream, None

    def start(self) -> None:
        sock = socket.socket()
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", self.port))
        sock.listen()
        self.sock = sock
        threading.Thread(target=self._accept, args=(sock,), daemon=True).start()

    def _accept(self, sock: socket.socket) -> None:
        while True:
            try:
                conn, _ = sock.accept()
            except OSError:
                return
            try:
                up = socket.create_connection(self.upstream, timeout=HTTP_TIMEOUT_S)
                up.settimeout(None)
            except OSError:
                conn.close()
                continue
            for src, dst in ((conn, up), (up, conn)):
                threading.Thread(target=self._pump, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while True:
                data = src.recv(RELAY_CHUNK)
                if not data:
                    break
                dst.sendall(data)
        except OSError:
            pass
        finally:
            try:
                dst.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    def stop(self) -> None:
        if self.sock is None:
            return
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


@contextmanager
def killbill_copy() -> Iterator[SimpleNamespace]:
    upstream = urlsplit(os.environ["KILLBILL_URL"])
    relay = Relay(free_port(), (upstream.hostname, upstream.port or 80))
    port = free_port()
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), BILLING_RETRY_SECONDS=COPY_RETRY_S,
               KILLBILL_URL=f"{upstream.scheme}://127.0.0.1:{relay.port}{upstream.path}")
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=str(conftest.DEPLOYED_APP), env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    url = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-LOG_TAIL:]

    def health() -> int:
        assert proc.poll() is None, f"app copy exited {proc.returncode}:\n{tail()}"
        try:
            return httpx.get(at(url, "/api/health"), timeout=HTTP_TIMEOUT_S).status_code
        except httpx.HTTPError:
            return 0

    try:
        assert poll(health, lambda st: st == 200, COPY_BOOT_S) == 200, tail()
        yield SimpleNamespace(url=url, recover=relay.start, tail=tail)
    finally:
        relay.stop()
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=STOP_S)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        log.close()


def test_queued_while_killbill_down(app_url, killbill):
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    first = scenario(app_url, free_for=(LINH,), claims=((1, LINH),), language="es", minutes=60, scheduler=LFC_SCHED)
    assert verify(first.people[LINH], first.number, 1).status_code == 201
    r = Api(down, BILLING).post(f"/api/assignments/{first.number}/invoice")
    assert r.status_code == 202, r.text
    assert r.json()["billing"]["status"] == "queued" and r.json()["billing"]["invoice_id"] is None

    s = scenario(app_url, free_for=(LINH,), claims=((1, LINH),), language="es", minutes=60, scheduler=LFC_SCHED)
    assert verify(s.people[LINH], s.number, 1).status_code == 201
    path = f"/api/assignments/{s.number}/invoice"
    with killbill_copy() as copy:
        billing = Api(copy.url, BILLING)
        queued = billing.post(path)
        assert queued.status_code == 202, queued.text
        assert queued.json()["billing"]["status"] == "queued" and queued.json()["billing"]["invoice_id"] is None
        again = billing.post(path)
        assert again.status_code in (200, 202), again.text
        copy.recover()
        final = poll(lambda: billing_of(billing, s.number), lambda b: b["status"] == "posted", OUTAGE_DEADLINE_S)
        assert final["status"] == "posted" and final["invoice_id"], (final, copy.tail())
        repeat = billing.post(path)
        assert repeat.status_code == 200 and repeat.json()["billing"]["invoice_id"] == final["invoice_id"]
    assert billing_of(Api(app_url, BILLING), s.number) == final
    assert killbill.account_by_key("teamseat-LFC") is not None
    assert_one_charge(killbill, "LFC", s.number, final["total_cents"], "service", final["invoice_id"])


def test_dated_rate_cards(app_url):
    billing = Api(app_url, BILLING)
    org, line = "LFC", "spoken"
    eff = fresh_effective(billing, org, line)
    payload = {"org": org, "service_line": line, "effective_from": eff.isoformat(), "hourly_rate_cents": 7125, "mileage_cents_per_mile": 71}
    r = billing.post("/api/rate-cards", payload)
    assert r.status_code == 201, r.text
    assert {k: r.json()[k] for k in ("service_line", "effective_from", "hourly_rate_cents", "mileage_cents_per_mile")} == {
        k: payload[k] for k in ("service_line", "effective_from", "hourly_rate_cents", "mileage_cents_per_mile")}
    listed = rate_entries(billing, org)
    assert [e["effective_from"] for e in listed] == sorted(e["effective_from"] for e in listed)
    assert len([e for e in listed if e["service_line"] == line and e["effective_from"] == eff.isoformat()]) == 1
    assert_error(billing.post("/api/rate-cards", payload), 409, "duplicate_rate")
    today = now_central().date()
    spare = (eff + timedelta(days=1)).isoformat()
    bad = [({"effective_from": spare, "hourly_rate_cents": 0}, "hourly_rate_cents"),
           ({"effective_from": spare, "hourly_rate_cents": HOURLY_MAX + 1}, "hourly_rate_cents"),
           ({"effective_from": spare, "mileage_cents_per_mile": MILEAGE_MAX + 1}, "mileage_cents_per_mile")]
    for day in (today, today - timedelta(days=1)):
        combo = next(((o, l) for o in ORGS for l in ("asl", "spoken")
                      if not any(e["service_line"] == l and e["effective_from"] == day.isoformat() for e in rate_entries(billing, o))))
        bad.append(({"org": combo[0], "service_line": combo[1], "effective_from": day.isoformat()}, "effective_from"))
    for change, field in bad:
        attempt = dict(payload, **change)
        count = len(rate_entries(billing, attempt["org"]))
        assert_error(billing.post("/api/rate-cards", attempt), 422, "validation", field)
        assert len(rate_entries(billing, attempt["org"])) == count
    assert_error(billing.post("/api/rate-cards", dict(payload, org="ZZZ", effective_from=spare)), 404, "not_found")
    assert_error(billing.get("/api/rate-cards", params={"org": "ZZZ"}), 404, "not_found")
    assert Api(app_url, LFC_SCHED).post("/api/rate-cards", dict(payload, effective_from=spare)).status_code in (403, 404)


def test_rate_in_force(app_url):
    billing = Api(app_url, BILLING)
    org, line = "CPSD", "spoken"
    eff = fresh_effective(billing, org, line)
    old = rate_on(billing, org, line, eff - timedelta(days=1))
    new_cents = old["hourly_rate_cents"] + RATE_STEP
    r = billing.post("/api/rate-cards", {"org": org, "service_line": line, "effective_from": eff.isoformat(),
                                         "hourly_rate_cents": new_cents, "mileage_cents_per_mile": old["mileage_cents_per_mile"]})
    assert r.status_code == 201, r.text
    eve, morning = central(eff - timedelta(days=1), 21), central(eff, 9)
    who = free_interpreter(app_url, (LINH, ROSA), [(eve, 60), (morning, 60)])
    runs = [scenario(app_url, start=t, minutes=60, language="es", scheduler=CPSD_SCHED, claims=((1, who),)) for t in (eve, morning)]
    for run in runs:
        assert verify(run.people[who], run.number, 1).status_code == 201
    before, after = (charges(billing, run.number) for run in runs)
    assert before["rate"]["effective_from"] == old["effective_from"] and before["rate"]["hourly_rate_cents"] == old["hourly_rate_cents"]
    assert before["total_cents"] == seat_cents(old["hourly_rate_cents"], 60)[1]
    assert after["rate"]["effective_from"] == eff.isoformat() and after["rate"]["hourly_rate_cents"] == new_cents
    assert after["total_cents"] == seat_cents(new_cents, 60)[1]
    for run, ch in zip(runs, (before, after)):
        posted = billing.post(f"/api/assignments/{run.number}/invoice")
        assert posted.status_code == 201 and posted.json()["billing"]["total_cents"] == ch["total_cents"]


def test_organisation_scoping(app_url):
    s = scenario(app_url, release=False, minutes=60)
    for email in (CPSD_SCHED, CPSD_ADMIN):
        other = Api(app_url, email)
        theirs, missing = view(other, s.number), view(other, MISSING_NUMBER)
        assert_error(theirs, 404, "not_found")
        assert same_answer(theirs, s.number, missing, MISSING_NUMBER), (theirs.text, missing.text)
        assert s.number not in [a["number"] for a in search(other, s.number)]
        assert s.number not in [a["number"] for a in other.get("/api/assignments").json()["assignments"]]
    grace = Api(app_url, CPSD_SCHED)
    for call in (lambda n: grace.get(f"/api/assignments/{n}/cancellation-quote"),
                 lambda n: grace.post(f"/api/assignments/{n}/cancel"),
                 lambda n: grace.patch(f"/api/assignments/{n}", {"city": "Elsewhere"})):
        a, b = call(s.number), call(MISSING_NUMBER)
        assert_error(a, 404, "not_found")
        assert same_answer(a, s.number, b, MISSING_NUMBER), (a.text, b.text)
    assert view(s.sched, s.number).json()["status"] == "draft"
    for email in (RVH_SCHED2, RVH_ADMIN):
        assert [a["number"] for a in search(Api(app_url, email), s.number)] == [s.number]
    assert_error(view(Api(app_url, ABDI), s.number), 404, "not_found")


def posted_one(app_url: str, *, start: datetime, who: str, scheduler: str, minutes: int = 60, actual: int = 61,
               miles: int = 45) -> SimpleNamespace:
    run = scenario(app_url, start=start, minutes=minutes, scheduler=scheduler, claims=((1, who),))
    assert verify(run.people[who], run.number, 1, actual, miles).status_code == 201
    run.charges = charges(Api(app_url, BILLING), run.number)
    r = Api(app_url, BILLING).post(f"/api/assignments/{run.number}/invoice")
    assert r.status_code == 201, r.text
    run.billing = r.json()["billing"]
    return run


def test_monthly_statement(app_url):
    rosa, samuel, jordan = (Api(app_url, e) for e in ASL_INTERPRETERS)
    p_start = far_slot(60, [rosa])
    day = cday(p_start)
    p = posted_one(app_url, start=p_start, who=ROSA, scheduler=RVH_SCHED)
    q_start = slot_on(day, 60, [samuel])
    q = scenario(app_url, start=q_start, minutes=60, claims=((1, SAMUEL),))
    assert verify(q.people[SAMUEL], q.number, 1).status_code == 201
    r_run = posted_one(app_url, start=slot_on(day, 60, [jordan]), who=JORDAN, scheduler=CPSD_SCHED)
    month = f"{day:%Y-%m}"
    helen = Api(app_url, RVH_ADMIN)
    r = helen.get("/api/org/statement", params={"month": month})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.splitlines()
    assert lines[0] == STATEMENT_HEADER
    rows = list(csv.DictReader(io.StringIO(r.text)))
    numbers = [row["number"] for row in rows]
    assert p.number in numbers and q.number not in numbers and r_run.number not in numbers
    assert [row["date"] for row in rows] == sorted(row["date"] for row in rows)
    row = next(row for row in rows if row["number"] == p.number)
    ch = p.charges
    assert row["date"] == day.isoformat() and row["kind"] == "service" and row["language"] == "ASL"
    assert row["setting"].lower() == "hospital" and row["seats"] == "1"
    assert int(row["billable_minutes"]) == sum(l["billable_minutes"] for l in ch["lines"])
    assert int(row["mileage_cents"]) == sum(l["mileage_cents"] for l in ch["lines"])
    assert int(row["total_cents"]) == ch["total_cents"] == p.billing["total_cents"]
    assert row["invoice_id"] == p.billing["invoice_id"]
    for secret in secrets(p.body):
        assert secret not in r.text
    victor = Api(app_url, CPSD_ADMIN).get("/api/org/statement", params={"month": month})
    assert r_run.number in victor.text and p.number not in victor.text
    assert_error(helen.get("/api/org/statement", params={"month": "2026-13"}), 422, "validation", "month")


def test_health_and_manifest(app_url):
    r = httpx.get(at(app_url, "/api/health"), timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    page = httpx.get(at(app_url, "/"), timeout=HTTP_TIMEOUT_S)
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    assert Api(app_url, DISPATCHER).user["role"] == "dispatcher"


def test_session_and_roles(app_url):
    r = httpx.post(at(app_url, "/api/session"), json={"email": RVH_SCHED, "password": PASSWORD},
                   headers={"Origin": origin(app_url)}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    cookie = next(c for c in r.headers.get_list("set-cookie") if c.startswith(f"{SESSION_COOKIE}="))
    assert "httponly" in cookie.lower() and "samesite=lax" in cookie.lower()
    user = r.json()["user"]
    assert user["name"] == RVH_SCHED_NAME and user["role"] == "scheduler" and user["initials"] == "".join(part[0] + "." for part in RVH_SCHED_NAME.split())
    assert user["org"] == {"code": "RVH", "name": ORGS["RVH"]}
    tomas = Api(app_url, RVH_SCHED)
    assert tomas.get("/api/me").json() == {"user": tomas.user}
    assert Api(app_url, ROSA).user["org"] is None
    assert_error(httpx.post(at(app_url, "/api/session"), json={"email": RVH_SCHED, "password": "wrong-password"},
                            timeout=HTTP_TIMEOUT_S), 401, "invalid_credentials")
    assert_error(Api(app_url, ROSA).post("/api/assignments", body_for(far_slot(60)), headers={"Idempotency-Key": idempotency_key()}),
                 403, "forbidden")
    for person, path in ((tomas, "/api/coverage"), (tomas, "/api/billing/queue"), (Api(app_url, ROSA), "/api/org/schedulers"),
                         (Api(app_url, DISPATCHER), "/api/billing/queue"), (Api(app_url, BILLING), "/api/offers")):
        refused = person.get(path, params={"week": week_of(far_slot(60)).isoformat()})
        assert refused.status_code in (403, 404), (path, refused.status_code)
        assert refused.json()["error"]["code"] in ("forbidden", "not_found")
    assert tomas.delete("/api/session").status_code == 204
    assert_error(tomas.get("/api/me"), 401, "unauthenticated")


def _foreign(app_url: str) -> httpx.Response:
    return httpx.post(at(app_url, "/api/assignments"), content=b"x" * (JSON_LIMIT + 1),
                      headers={"Origin": FOREIGN_ORIGIN, "Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT_S)


def _too_big(app_url: str) -> httpx.Response:
    return httpx.post(at(app_url, "/api/assignments"), content=b"x" * (JSON_LIMIT + 1),
                      headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT_S)


def _wrong_type(app_url: str) -> httpx.Response:
    return httpx.post(at(app_url, "/api/assignments"), content=b"language=asl", headers={"Content-Type": "text/plain"},
                      timeout=HTTP_TIMEOUT_S)


def _no_session(app_url: str) -> httpx.Response:
    return httpx.post(at(app_url, "/api/assignments"), json={"language": "xx"}, timeout=HTTP_TIMEOUT_S)


def _invisible(app_url: str) -> httpx.Response:
    s = scenario(app_url, release=False, minutes=60)
    return Api(app_url, ABDI).post(f"/api/assignments/{s.number}/release")


def _role(app_url: str) -> httpx.Response:
    s = scenario(app_url, release=False, minutes=60)
    return Api(app_url, RVH_ADMIN).post(f"/api/assignments/{s.number}/release")


def _no_key(app_url: str) -> httpx.Response:
    return Api(app_url, RVH_SCHED).post("/api/assignments", {"language": "xx"})


def _state(app_url: str) -> httpx.Response:
    s = scenario(app_url, release=False, minutes=60)
    assert s.sched.post(f"/api/assignments/{s.number}/cancel").status_code == 200
    return s.sched.patch(f"/api/assignments/{s.number}", {"duration_minutes": 7})


def _validation(app_url: str) -> httpx.Response:
    s = scenario(app_url, release=False, minutes=60)
    return s.sched.patch(f"/api/assignments/{s.number}", {"duration_minutes": 7})


def _credentials(app_url: str) -> httpx.Response:
    return httpx.post(at(app_url, "/api/session"), json={"email": DISPATCHER, "password": "not-the-password"}, timeout=HTTP_TIMEOUT_S)


PRECEDENCE = {
    "foreign-origin": (_foreign, 403, "cross_origin"),
    "body-size": (_too_big, 413, "payload_too_large"),
    "content-type": (_wrong_type, 415, "unsupported_media_type"),
    "no-session": (_no_session, 401, "unauthenticated"),
    "invisible": (_invisible, 404, "not_found"),
    "role": (_role, 403, "forbidden"),
    "idempotency-key": (_no_key, 400, "idempotency_key_required"),
    "state-before-validation": (_state, 409, "invalid_transition"),
    "validation": (_validation, 422, "validation"),
    "credentials": (_credentials, 401, "invalid_credentials"),
}


PRECEDENCE_IDS = ["foreign-origin", "body-size", "content-type", "no-session", "invisible", "role", "idempotency-key",
                  "state-before-validation", "validation", "credentials"]


@pytest.mark.parametrize("case", PRECEDENCE_IDS, ids=PRECEDENCE_IDS)
def test_error_precedence(app_url, case):
    call, status, code = PRECEDENCE[case]
    assert_error(call(app_url), status, code, "duration_minutes" if status == 422 else None)


def test_server_boundary(app_url):
    good = {"email": DISPATCHER, "password": PASSWORD}
    r = httpx.post(at(app_url, "/api/session"), json=good, headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S)
    assert_error(r, 403, "cross_origin")
    assert not any(c.startswith(SESSION_COOKIE) for c in r.headers.get_list("set-cookie"))
    sched = Api(app_url, RVH_SCHED)
    body = body_for(far_slot(60), minutes=60)
    assert_error(sched.post("/api/assignments", body, headers={"Idempotency-Key": idempotency_key(), "Origin": FOREIGN_ORIGIN}),
                 403, "cross_origin")
    assert search(sched, body["city"]) == []
    plain = httpx.get(at(app_url, "/api/health"), headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S)
    assert not any(h.lower().startswith("access-control-") for h in plain.headers)

    def padded(size: int) -> bytes:
        doc = {"email": "nobody@northfold.example", "password": "x", "pad": ""}
        raw = json.dumps(doc, separators=(",", ":")).encode()
        doc["pad"] = "a" * (size - len(raw))
        data = json.dumps(doc, separators=(",", ":")).encode()
        assert len(data) == size
        return data

    exact = httpx.post(at(app_url, "/api/session"), content=padded(JSON_LIMIT), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
    assert exact.status_code != 413
    assert_error(httpx.post(at(app_url, "/api/session"), content=padded(JSON_LIMIT + 1), headers={"Content-Type": "application/json"},
                            timeout=HTTP_TIMEOUT_S), 413, "payload_too_large")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json",
                 "/node_modules/.package-lock.json", "/src/server.ts"):
        assert httpx.get(at(app_url, path), timeout=HTTP_TIMEOUT_S).status_code == 404, path
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    health = httpx.get(at(down, "/api/health"), timeout=HTTP_TIMEOUT_S)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert Api(down, BILLING).get("/api/billing/queue").status_code == 200


def test_central_time_on_screen(browser, app_url):
    start = far_slot(90, hours=(9,))
    body = body_for(start)
    with screen(browser, app_url, RVH_SCHED, "/requests") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": FOREIGN_ZONE})
        page.reload()
        expect(page.get_by_text("All times Central (Chicago)")).to_be_visible(timeout=REAL_MS)
        form = fill_request(page, body, start)
        click(form.get_by_role("button", name="Submit request", exact=True))
        done = says(page, "Request status", re.compile(r"Request A-\d+ submitted\."))
        number = re.search(r"A-\d+", done.inner_text()).group(0)
        expect(request_row(page, number)).to_contain_text(span(start, start + timedelta(minutes=90)), timeout=REAL_MS)
    stored = search(Api(app_url, RVH_SCHED), body["city"])[0]
    assert parse(stored["start_at"]) == start
    offset = start.utcoffset()
    hours = int(offset.total_seconds() // 3600)
    assert stored["start_at"].endswith(f"{hours:+03d}:00")


VIEWPORTS = {
    "375x812": PHONE,
    "768x1024": TABLET,
    "1280x800": DESKTOP,
}
SCREENS = ((None, "/"), (RVH_SCHED, "/requests"), (DISPATCHER, "/board"), (ROSA, "/offers"), (ROSA, "/my-seats"),
           (BILLING, "/billing"), (RVH_ADMIN, "/org"))


VIEWPORT_IDS = ["375x812", "768x1024", "1280x800"]


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_responsive_layouts(browser, app_url, viewport):
    size = VIEWPORTS[viewport]
    for email, path in SCREENS:
        with screen(browser, app_url, email, path, size=size) as page:
            landmark = page.get_by_role("form", name="Sign in", exact=True) if email is None else page.get_by_role("navigation", name="Main", exact=True)
            expect(landmark).to_be_visible(timeout=REAL_MS)
            layout(page)
            if path == "/board":
                tabs = page.get_by_role("tablist", name="Days", exact=True)
                if size["width"] < 1024:
                    expect(tabs).to_be_visible(timeout=REAL_MS)
                else:
                    expect(tabs).to_have_count(0)


def test_keyboard_and_focus(browser, app_url):
    s = scenario(app_url, release=False, minutes=60)
    week = week_of(s.start)
    with screen(browser, app_url, DISPATCHER, "/board") as page:
        open_week(page, week)
        order = focus_order(page, TAB_PRESSES, {
            "Board": page.get_by_role("navigation", name="Main", exact=True).get_by_role("link", name="Board", exact=True),
            "Previous week": page.get_by_role("button", name="Previous week", exact=True),
            "Next week": page.get_by_role("button", name="Next week", exact=True)})
        assert set(order) == {"Board", "Previous week", "Next week"}, order
        assert order["Board"] < order["Previous week"] < order["Next week"], order
        _, focused = state_styles(page.get_by_role("button", name="Next week", exact=True), "outline-style", "outline-offset", state="focus")
        assert focused["outline-style"] != "none" and float(focused["outline-offset"].rstrip("px") or 0) > 0
        capsule = capsule_of(page, s.number)
        capsule.focus()
        page.keyboard.press("Enter")
        drawer = page.get_by_role("dialog", name=f"Assignment {s.number}", exact=True)
        expect(drawer).to_be_visible(timeout=REAL_MS)
        eventually(page, lambda: expect(drawer.get_by_role("heading").first).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(drawer).to_be_hidden(timeout=POLL_MS))
        eventually(page, lambda: expect(capsule).to_be_focused(timeout=POLL_MS))
        page.set_viewport_size(TABLET)
        tabs = page.get_by_role("tablist", name="Days", exact=True).get_by_role("tab")
        expect(tabs).to_have_count(7, timeout=REAL_MS)
        tabs.first.focus()
        page.keyboard.press("End")
        expect(tabs.last).to_be_focused()
        page.keyboard.press("Home")
        expect(tabs.first).to_be_focused()
    with screen(browser, app_url, RVH_SCHED, "/requests") as page:
        row_button = page.get_by_role("button", name=f"Open {s.number}", exact=True)
        expect(row_button).to_be_visible(timeout=REAL_MS)
        row_button.focus()
        page.keyboard.press("Enter")
        drawer = page.get_by_role("dialog", name=f"Assignment {s.number}", exact=True)
        cancel = drawer.get_by_role("button", name="Cancel request", exact=True)
        cancel.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=f"Cancel {s.number}", exact=True)
        expect(dialog).to_be_visible(timeout=REAL_MS)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS))
        eventually(page, lambda: expect(cancel).to_be_focused(timeout=POLL_MS))
    assert view(s.sched, s.number).json()["cancellation"] is None


def test_contrast_and_targets(browser, app_url):
    scenario(app_url, free_for=(ROSA,), claims=((1, ROSA),))
    for email, path in SCREENS:
        with screen(browser, app_url, email, path) as page:
            expect(page.get_by_role("button").first).to_be_visible(timeout=REAL_MS)
            contrast_audit(page)
            page.get_by_role("region", name="Coverage board", exact=True).get_by_role(
                "button", name=re.compile(r"^A-\d+")).evaluate_all("(els) => els.forEach((e) => { e.__capsule = true; })")
            small = []
            for role in ("button", "link", "textbox", "combobox", "spinbutton", "searchbox", "tab"):
                items = page.get_by_role(role)
                for i in range(items.count()):
                    item = items.nth(i)
                    if not item.is_visible():
                        continue
                    label = item.inner_text().strip()
                    if role == "button" and item.evaluate("(e) => e.__capsule === true"):
                        continue
                    box = item.bounding_box()
                    if box and (box["width"] < TAP_MIN_PX or box["height"] < TAP_MIN_PX):
                        small.append((path, role, label, box))
            assert not small, small


def test_wf_request_intake_double_click(browser, app_url):
    start = far_slot(90)
    body = body_for(start)
    with screen(browser, app_url, RVH_SCHED, "/requests") as page:
        form = fill_request(page, body, start)
        form.get_by_role("button", name="Submit request", exact=True).dblclick()
        done = says(page, "Request status", re.compile(r"Request A-\d+ submitted\. Awaiting release by dispatch\."))
        number = re.search(r"A-\d+", done.inner_text()).group(0)
        expect(request_row(page, number)).to_contain_text("Awaiting release", timeout=REAL_MS)
    found = search(Api(app_url, RVH_SCHED), body["city"])
    assert [a["number"] for a in found] == [number]
    assert found[0]["status"] == "draft" and len(found[0]["seats"]) == 2 and parse(found[0]["start_at"]) == start
    grace = Api(app_url, CPSD_SCHED)
    assert search(grace, number) == []
    assert_error(view(grace, number), 404, "not_found")


def test_wf_request_intake_retry_after_timeout(browser, app_url):
    start = far_slot(90)
    body = body_for(start)
    lost = {"done": False}

    def drop_reply(route: Any) -> None:
        if route.request.method == "POST" and not lost["done"]:
            lost["done"] = True
            route.fetch()
            route.abort()
        else:
            route.continue_()

    with screen(browser, app_url, RVH_SCHED, "/requests") as page:
        page.route("**/api/assignments", drop_reply)
        form = fill_request(page, body, start)
        submit = form.get_by_role("button", name="Submit request", exact=True)
        click(submit)
        says(page, "Request status", "Couldn't reach Teamseat. Your request is safe to submit again.")
        expect(submit).to_be_enabled(timeout=REAL_MS)
        click(submit)
        done = says(page, "Request status", re.compile(r"Request A-\d+ submitted\. Awaiting release by dispatch\."))
        number = re.search(r"A-\d+", done.inner_text()).group(0)
    assert [a["number"] for a in search(Api(app_url, RVH_SCHED), body["city"])] == [number]


def test_wf_request_intake_invalid_recovery(browser, app_url):
    sched = Api(app_url, RVH_SCHED)
    start = far_slot(90)
    body = body_for(start)
    bad = dict(body, patient_initials="R")
    message = assert_error(sched.post("/api/assignments", bad, headers={"Idempotency-Key": idempotency_key()}),
                           422, "validation", "patient_initials")["fields"]["patient_initials"]
    with screen(browser, app_url, RVH_SCHED, "/requests") as page:
        form = fill_request(page, bad, start)
        click(form.get_by_role("button", name="Submit request", exact=True))
        says(page, "Request status", "Check the highlighted fields.")
        says(page, "Request status", message)
        initials = form.get_by_role("textbox", name="Patient initials", exact=True)
        expect(initials).to_have_accessible_description(re.compile(re.escape(message)), timeout=REAL_MS)
        assert search(sched, body["city"]) == []
        fill(initials, PATIENT)
        click(form.get_by_role("button", name="Submit request", exact=True))
        says(page, "Request status", re.compile(r"Request A-\d+ submitted\."))
    assert len(search(sched, body["city"])) == 1


def test_wf_dispatch_release_from_board(browser, app_url, mail):
    s = scenario(app_url, release=False)
    with screen(browser, app_url, DISPATCHER, "/board") as page:
        board = open_week(page, week_of(s.start))
        capsule = capsule_of(board, s.number)
        click(capsule)
        drawer = page.get_by_role("dialog", name=f"Assignment {s.number}", exact=True)
        expect(drawer).to_be_visible(timeout=REAL_MS)
        advance(page, SETTLE_MS)
        expect(drawer).to_contain_text("Awaiting release")
        expect(board).to_be_visible()
        click(drawer.get_by_role("button", name="Release to interpreters", exact=True))
        says(page, "Release status", f"Released. Offers going out to {len(ASL_INTERPRETERS)} qualified interpreters.")
        expect(drawer).to_contain_text(re.compile(r"Open(?![a-z])"))
        expect(lane(capsule, 1)).to_contain_text("open")
        expect(lane(capsule, 2)).to_contain_text("open")
        expect(page).to_have_url(re.compile(r"/board"))
    assert view(s.disp, s.number).json()["status"] == "released"
    assert set(view(Api(app_url, JORDAN), s.number).json()) == OFFER_KEYS
    offers = mails(mail, s.number, len(ASL_INTERPRETERS), "Open seat")
    assert recipients(offers) == sorted(ASL_INTERPRETERS)
    for m in offers:
        assert_clean(m, secrets(s.body) + [RVH_SCHED_PHONE])


def test_wf_dispatch_release_day_view(browser, app_url, mail):
    s = scenario(app_url, release=False, minutes=60)
    with screen(browser, app_url, DISPATCHER, "/board", size=TABLET) as page:
        board = open_week(page, week_of(s.start))
        tab = page.get_by_role("tablist", name="Days", exact=True).get_by_role("tab", name=f"{s.start:%a} {s.start.day}", exact=True)
        expect(tab).to_be_visible(timeout=REAL_MS)
        click(tab)
        capsule = capsule_of(board, s.number)
        click(capsule)
        drawer = page.get_by_role("dialog", name=f"Assignment {s.number}", exact=True)
        release = drawer.get_by_role("button", name="Release to interpreters", exact=True)
        expect(release).to_be_visible(timeout=REAL_MS)
        advance(page, SETTLE_MS)
        click(release)
        says(page, "Release status", f"Released. Offers going out to {len(ASL_INTERPRETERS)} qualified interpreters.")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(drawer).to_be_hidden(timeout=POLL_MS))
        expect(lane(capsule, 1)).to_contain_text("open")
        expect(page).to_have_url(re.compile(r"/board"))
    assert view(s.disp, s.number).json()["status"] == "released"
    assert recipients(mails(mail, s.number, len(ASL_INTERPRETERS), "Open seat")) == sorted(ASL_INTERPRETERS)


def test_wf_seat_claim_win(browser, app_url, mail):
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA),))
    with screen(browser, app_url, SAMUEL, "/offers") as page:
        button = claim_button(page, s.number, 2)
        expect(button).to_be_visible(timeout=REAL_MS)
        card = offer_card(page, s.body["city"])
        expect(card).to_contain_text("ASL")
        for secret in secrets(s.body) + [RVH_SCHED_PHONE]:
            expect(card).not_to_contain_text(secret)
        seat = lane(card, 2)
        with held(page, "**/claim") as gate:
            click(button)
            expect(button).to_be_disabled(timeout=REAL_MS)
            says(page, "Claim status", "Claiming…")
            expect(seat).to_contain_text("open")
            assert not [a for a in animations(seat) if float(a.get("duration") or 0) >= SWEEP_MIN_MS]
            gate.release()
        says(page, "Claim status", f"Seat 2 on {s.number} is yours. Details are in My seats.")
        click(page.get_by_role("navigation", name="Main", exact=True).get_by_role("link", name="My seats", exact=True))
        mine = page.get_by_role("list", name="My seats", exact=True)
        for part in secrets(s.body) + [RVH_SCHED_PHONE]:
            expect(mine).to_contain_text(part, timeout=REAL_MS)
    assert seat_states(view(s.disp, s.number).json())[2] == ("held", INITIALS[SAMUEL])
    confirm = mails(mail, s.number, 1, "Seat 2 confirmed")
    assert recipients(confirm) == [SAMUEL]
    assert_clean(confirm[0], [PATIENT, s.body["medical_notes"]])


def test_wf_seat_claim_lose_race(browser, app_url, mail):
    s = scenario(app_url, free_for=ASL_INTERPRETERS, claims=((1, ROSA),))
    with screen(browser, app_url, SAMUEL, "/offers") as one, screen(browser, app_url, JORDAN, "/offers") as two:
        pages = {SAMUEL: one, JORDAN: two}
        buttons = {e: claim_button(p, s.number, 2) for e, p in pages.items()}
        for b in buttons.values():
            expect(b).to_be_visible(timeout=REAL_MS)
        with held(one, "**/claim") as g1, held(two, "**/claim") as g2:
            for b in buttons.values():
                click(b)
            for p in pages.values():
                says(p, "Claim status", "Claiming…")
            g1.release()
            g2.release()
        outcome = {e: says(p, "Claim status", re.compile(r"is yours|Seat already taken")).inner_text() for e, p in pages.items()}
        winners = [e for e, t in outcome.items() if "is yours" in t]
        assert len(winners) == 1, outcome
        loser = next(e for e in pages if e not in winners)
        assert "Seat already taken" in outcome[loser]
    assert seat_states(view(s.disp, s.number).json())[2] == ("held", INITIALS[winners[0]])
    assert recipients(mails(mail, s.number, 1, "Seat 2 confirmed")) == [winners[0]]
    assert recipients(mails(mail, s.number, 1, "is fully covered")) == [RVH_SCHED]


def test_wf_seat_claim_give_back(browser, app_url):
    s = scenario(app_url, free_for=(ROSA,), claims=((1, ROSA),), minutes=60)
    with screen(browser, app_url, ROSA, "/my-seats") as page:
        button = page.get_by_role("list", name="My seats", exact=True).get_by_role("button", name=f"Give back seat 1 on {s.number}", exact=True)
        expect(button).to_be_visible(timeout=REAL_MS)
        click(button)
        says(page, "Claim status", f"Seat 1 on {s.number} given back.")
    after = view(s.disp, s.number).json()
    assert after["status"] == "released" and seat_states(after)[1] == ("open", None)


def test_wf_coverage_board_watch_gap_close(browser, app_url):
    s = scenario(app_url, free_for=(ROSA, SAMUEL))
    week = week_of(s.start)
    with screen(browser, app_url, DISPATCHER, "/board") as board_page:
        capsule = capsule_of(open_week(board_page, week), s.number)
        first = lane(capsule, 1)
        expect(first).to_contain_text("open", timeout=REAL_MS)
        with screen(browser, app_url, ROSA, "/offers") as offers:
            button = claim_button(offers, s.number, 1)
            expect(button).to_be_visible(timeout=REAL_MS)
            click(button)
            says(offers, "Claim status", f"Seat 1 on {s.number} is yours. Details are in My seats.")
        after = uncovered(s.disp, week, "asl")
        spent = eventually(board_page, lambda: expect(first).to_contain_text(INITIALS[ROSA], timeout=POLL_MS),
                           budget_ms=REFRESH_MS + SWEEP_MAX_MS + COUNT_MAX_MS + STEP_MS * 4)
        assert spent <= REFRESH_MS + SWEEP_MAX_MS + STEP_MS * 4, spent
        eventually(board_page, lambda: expect(numeral_of(board_page, "ASL")).to_have_text(clock_re(after), timeout=POLL_MS))
        expect(capsule).to_have_accessible_name(re.compile(r"1 of 2 covered"))
        expect(lane(capsule, 2)).to_contain_text("open")
        expect(capsule.get_by_role("img", name="All seats covered")).to_have_count(0)
        says(board_page, "Board updates", f"ASL, {day_text(s.start)}: seat 1 covered by {INITIALS[ROSA]}, {words(after)} uncovered this week")
        contrast_audit(board_page)
    assert seat_states(view(s.disp, s.number).json())[1] == ("held", INITIALS[ROSA])


def test_wf_coverage_board_last_seat_race(browser, app_url):
    s = scenario(app_url, free_for=ASL_INTERPRETERS, claims=((1, ROSA),))
    with screen(browser, app_url, DISPATCHER, "/board") as page:
        capsule = capsule_of(open_week(page, week_of(s.start)), s.number)
        expect(lane(capsule, 2)).to_contain_text("open", timeout=REAL_MS)
        rivals = [(e, s.people[e]) for e in (SAMUEL, JORDAN)]
        results = together([lambda p=p: p.post(seat_path(s.number, 2, "claim")) for _, p in rivals])
        assert sorted(r.status_code for r in results) == [200, 409]
        assert_error(next(r for r in results if r.status_code == 409), 409, "seat_taken")
        winner = next(e for (e, _), r in zip(rivals, results) if r.status_code == 200)
        eventually(page, lambda: expect(lane(capsule, 2)).to_contain_text(INITIALS[winner], timeout=POLL_MS))
        eventually(page, lambda: expect(capsule.get_by_role("img", name="All seats covered")).to_be_visible(timeout=POLL_MS))
        expect(capsule).to_have_accessible_name(re.compile(r"2 of 2 covered"))
    assert seat_states(view(s.disp, s.number).json())[2] == ("held", INITIALS[winner])


def test_wf_coverage_board_refresh_failure(browser, app_url):
    s = scenario(app_url, free_for=(ROSA,), minutes=60)
    with screen(browser, app_url, DISPATCHER, "/board") as page:
        capsule = capsule_of(open_week(page, week_of(s.start)), s.number)
        page.route("**/api/**", lambda route: route.abort())
        eventually(page, lambda: says(page, "Board updates", "Board not updating. Retrying…", timeout=POLL_MS), budget_ms=REFRESH_MS * 3)
        assert s.people[ROSA].post(seat_path(s.number, 1, "claim")).status_code == 200
        page.unroute("**/api/**")
        eventually(page, lambda: expect(lane(capsule, 1)).to_contain_text(INITIALS[ROSA], timeout=POLL_MS))
        expect(page.get_by_role("status", name="Board updates", exact=True).filter(has_text="Board not updating")).to_have_count(0)


def test_wf_change_and_cancel_late_fee(browser, app_url, mail):
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA), (2, SAMUEL)), soon=True)
    rate = rate_on(Api(app_url, BILLING), "RVH", "asl", cday(s.start))["hourly_rate_cents"]
    fee = 2 * seat_cents(rate, MIN_BILLABLE)[1]
    with screen(browser, app_url, RVH_SCHED, "/requests") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": FOREIGN_ZONE})
        page.reload()
        drawer = open_row(page, s.number)
        click(drawer.get_by_role("button", name="Cancel request", exact=True))
        dialog = page.get_by_role("dialog", name=f"Cancel {s.number}", exact=True)
        expect(dialog).to_be_visible(timeout=REAL_MS)
        advance(page, SETTLE_MS)
        before = datetime.now(timezone.utc)
        preview = says(page, "Cancellation status", PREVIEW_FEE)
        after = datetime.now(timezone.utc)
        m = PREVIEW_FEE.search(preview.inner_text())
        assert_notice(int(m.group(1)) * 60 + int(m.group(2)), before, after, s.start)
        assert m.group(3) == money(fee)
        expect(dialog.get_by_role("button", name="Confirm cancellation", exact=True)).to_be_enabled()
        click(dialog.get_by_role("button", name="Keep request", exact=True))
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS))
        assert view(s.sched, s.number).json()["cancellation"] is None
        click(drawer.get_by_role("button", name="Cancel request", exact=True))
        says(page, "Cancellation status", PREVIEW_FEE)
        advance(page, SETTLE_MS)
        confirm = dialog.get_by_role("button", name="Confirm cancellation", exact=True)
        expect(confirm).to_be_enabled(timeout=REAL_MS)
        click(confirm)
        says(page, "Cancellation status", f"Request {s.number} cancelled. Fee: {money(fee)}.")
        expect(drawer).to_contain_text("Cancelled", timeout=REAL_MS)
    decision = view(s.sched, s.number).json()["cancellation"]
    assert decision["fee_applies"] is True and decision["fee_cents"] == fee
    notices = mails(mail, s.number, 3, "cancelled")
    assert recipients(notices) == sorted([RVH_SCHED, ROSA, SAMUEL])
    for n in notices:
        assert_clean(n, [PATIENT, s.body["medical_notes"]])


def test_wf_change_and_cancel_move_time(browser, app_url, mail):
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA), (2, SAMUEL)))
    new_start = far_slot(90, list(s.people.values()), avoid=[(s.start, s.end)])
    with screen(browser, app_url, RVH_SCHED, "/requests") as page:
        drawer = open_row(page, s.number)
        click(drawer.get_by_role("button", name="Change time", exact=True))
        dialog = page.get_by_role("dialog", name=f"Change time for {s.number}", exact=True)
        expect(dialog).to_be_visible(timeout=REAL_MS)
        advance(page, SETTLE_MS)
        start_box = dialog.get_by_role("textbox", name="Start time", exact=True)
        expect(start_box).to_have_value(re.compile(re.escape(f"{s.start:%H:%M}")), timeout=REAL_MS)
        day_box = dialog.get_by_role("textbox", name="Date", exact=True)
        fill(day_box, date_entry(day_box, cday(new_start)))
        fill(start_box, f"{new_start:%H:%M}")
        fill(dialog.get_by_role("spinbutton", name="Duration (minutes)", exact=True), "90")
        click(dialog.get_by_role("button", name="Save new time", exact=True))
        says(page, "Change status", f"Request {s.number} moved. Seats reopened, no fee.")
    moved = view(s.disp, s.number).json()
    assert parse(moved["start_at"]) == new_start and moved["status"] == "released"
    assert all(st == "open" for st, _ in seat_states(moved).values())
    notices = mails(mail, s.number, 3, "changed")
    assert recipients(notices) == sorted([RVH_SCHED, ROSA, SAMUEL])
    for n in notices:
        assert "No fee applies." in body_of(n)
        assert_clean(n, [PATIENT, s.body["medical_notes"]])


def test_wf_change_and_cancel_late_change_refused(browser, app_url):
    s = scenario(app_url, soon=True, minutes=60)
    with screen(browser, app_url, RVH_SCHED, "/requests") as page:
        drawer = open_row(page, s.number)
        change = drawer.get_by_role("button", name="Change time", exact=True)
        if change.count() and change.is_enabled():
            click(change)
            dialog = page.get_by_role("dialog", name=f"Change time for {s.number}", exact=True)
            expect(dialog).to_be_visible(timeout=REAL_MS)
            advance(page, SETTLE_MS)
            day_box = dialog.get_by_role("textbox", name="Date", exact=True)
            fill(day_box, date_entry(day_box, cday(s.start) + timedelta(days=1)))
            click(dialog.get_by_role("button", name="Save new time", exact=True))
            says(page, "Change status", "Less than 48 business hours' notice. This request can only be cancelled now.")
            expect(dialog).to_be_visible()
    assert parse(view(s.sched, s.number).json()["start_at"]) == s.start


def test_wf_verification_upload(browser, app_url):
    s = scenario(app_url, free_for=(ROSA,), claims=((1, ROSA),), minutes=60)
    store = S3()
    prefix = f"verifications/{s.number}/seat-1/"
    with screen(browser, app_url, ROSA, "/my-seats") as page:
        mine = page.get_by_role("list", name="My seats", exact=True)
        verify_link = mine.get_by_role("link", name=f"Verify seat 1 on {s.number}", exact=True)
        expect(verify_link).to_be_visible(timeout=REAL_MS)
        click(verify_link)
        form = page.get_by_role("form", name=f"Verify seat 1 on {s.number}", exact=True)
        fill(form.get_by_role("spinbutton", name="Actual minutes", exact=True), "75")
        fill(form.get_by_role("spinbutton", name="Round-trip miles", exact=True), "52")
        upload = form.get_by_label("Signed verification form")
        upload.set_input_files({"name": "form.pdf", "mimeType": "application/pdf", "buffer": TEXT_AS_PDF})
        assert store.keys(prefix) == []
        click(form.get_by_role("button", name="Submit verification", exact=True))
        says(page, "Upload status", "Upload a PDF, JPEG or PNG file.")
        assert store.keys(prefix) == []
        upload.set_input_files({"name": "form.jpg", "mimeType": "image/jpeg", "buffer": JPEG})
        click(form.get_by_role("button", name="Submit verification", exact=True))
        says(page, "Upload status", "Verification for seat 1 received.")
        item = mine.get_by_role("listitem").filter(has_text=s.body["city"])
        expect(item).to_contain_text("Seat <n> verified".replace("<n>", "1"), timeout=REAL_MS)
        expect(item.get_by_role("link", name="View signed form", exact=True)).to_be_visible()
        expect(item.get_by_role("button", name=f"Give back seat 1 on {s.number}", exact=True)).to_have_count(0)
    keys = store.keys(prefix)
    assert len(keys) == 1 and keys[0].endswith(".jpg") and store.get(keys[0]) == JPEG
    assert view(s.disp, s.number).json()["status"] == "verified"


def test_wf_verification_private_link(browser, app_url):
    s = scenario(app_url, free_for=(ROSA,), claims=((1, ROSA),), minutes=60)
    assert verify(s.people[ROSA], s.number, 1, content=PNG, ctype="image/png", name="form.png").status_code == 201
    with screen(browser, app_url, ROSA, "/my-seats") as page:
        item = page.get_by_role("list", name="My seats", exact=True).get_by_role("listitem").filter(has_text=s.body["city"])
        link = item.get_by_role("link", name="View signed form", exact=True)
        expect(link).to_be_visible(timeout=REAL_MS)
        with page.expect_response(lambda r: "/verification-link" in r.url and s.number in r.url) as info:
            click(link)
        payload = info.value.json()
        assert payload["expires_in_seconds"] == LINK_TTL_S and payload["url"].startswith("/files/")
        fresh = page.request.get(at(app_url, seat_path(s.number, 1, "verification-link"))).json()
        assert fresh["url"].startswith("/files/"), fresh
        got = page.request.get(at(app_url, fresh["url"]))
        assert got.status == 200 and got.body() == PNG
        assert got.headers["content-disposition"].lower().startswith("attachment")
    grace = Api(app_url, CPSD_SCHED)
    assert_error(grace.get(seat_path(s.number, 1, "verification-link")), 404, "not_found")
    assert grace.get(payload["url"]).status_code == 404


def test_wf_invoicing_post_from_screen(browser, app_url, killbill):
    s = scenario(app_url, free_for=(ROSA, SAMUEL), claims=((1, ROSA), (2, SAMUEL)))
    for seat, email, miles in ((1, ROSA, EXAMPLE_MILES[0]), (2, SAMUEL, EXAMPLE_MILES[1])):
        assert verify(s.people[email], s.number, seat, EXAMPLE_MINUTES, miles).status_code == 201
    billing = Api(app_url, BILLING)
    total = charges(billing, s.number)["total_cents"]
    with screen(browser, app_url, BILLING, "/billing") as page:
        queue = page.get_by_role("table", name="Billing queue", exact=True)
        post = queue.get_by_role("button", name=f"Post invoice for {s.number}", exact=True)
        expect(post).to_be_visible(timeout=REAL_MS)
        row = queue.get_by_role("row").filter(has_text=re.compile(rf"{re.escape(s.number)}(?!\d)"))
        expect(row).to_contain_text(money(total))
        expect(row).to_contain_text("Ready")
        with held(page, "**/invoice") as gate:
            click(post)
            expect(post).to_be_disabled(timeout=REAL_MS)
            says(page, "Billing status", "Posting…")
            gate.release()
        done = says(page, "Billing status", re.compile(r"Posted to Kill Bill as invoice \S+\."))
        invoice_id = re.search(r"as invoice (\S+?)\.(?:\s|$)", done.inner_text()).group(1)
        expect(row).to_contain_text("Posted", timeout=REAL_MS)
        expect(row).to_contain_text(invoice_id)
    bill = billing_of(billing, s.number)
    assert bill == {"status": "posted", "invoice_id": invoice_id, "total_cents": total}
    account = killbill.account_by_key("teamseat-RVH")
    assert account is not None and account["name"] == ORGS["RVH"] and account["currency"] == "USD"
    assert_one_charge(killbill, "RVH", s.number, total, "service", invoice_id)


def test_wf_invoicing_queued_outage(browser, app_url, killbill):
    s = scenario(app_url, free_for=(LINH,), claims=((1, LINH),), language="es", minutes=60, scheduler=LFC_SCHED)
    assert verify(s.people[LINH], s.number, 1).status_code == 201
    with killbill_copy() as copy, screen(browser, copy.url, BILLING, "/billing") as page:
        queue = page.get_by_role("table", name="Billing queue", exact=True)
        post = queue.get_by_role("button", name=f"Post invoice for {s.number}", exact=True)
        expect(post).to_be_visible(timeout=REAL_MS)
        row = queue.get_by_role("row").filter(has_text=re.compile(rf"{re.escape(s.number)}(?!\d)"))
        click(post)
        says(page, "Billing status", "Queued. Kill Bill is unreachable, and this will post automatically when it returns.")
        copy.recover()
        eventually(page, lambda: expect(row).to_contain_text("Posted", timeout=POLL_MS), budget_ms=OUTAGE_BUDGET_MS)
        bill = billing_of(Api(copy.url, BILLING), s.number)
        assert bill["status"] == "posted" and bill["invoice_id"], copy.tail()
        expect(row).to_contain_text(bill["invoice_id"], timeout=REAL_MS)
    again = Api(app_url, BILLING).post(f"/api/assignments/{s.number}/invoice")
    assert again.status_code == 200 and again.json()["billing"]["invoice_id"] == bill["invoice_id"]
    assert killbill.account_by_key("teamseat-LFC") is not None
    assert_one_charge(killbill, "LFC", s.number, bill["total_cents"], "service", bill["invoice_id"])


def fill_rate(page: Page, org_name: str, line: str, eff: date, hourly: int, mileage: int) -> Any:
    code = next(c for c, n in ORGS.items() if n == org_name)
    choose(page.get_by_role("combobox", name="Organisation", exact=True), re.compile(rf"{re.escape(org_name)}|\b{code}\b"))
    form = page.get_by_role("form", name="Add rate", exact=True)
    choose(form.get_by_role("combobox", name="Service line", exact=True), re.compile(rf"^\s*{line}\b", re.I))
    eff_box = form.get_by_role("textbox", name="Effective from", exact=True)
    fill(eff_box, date_entry(eff_box, eff))
    fill(form.get_by_role("textbox", name="Hourly rate (dollars)", exact=True), dollars_input(hourly))
    fill(form.get_by_role("textbox", name="Mileage (cents per mile)", exact=True), str(mileage))
    click(form.get_by_role("button", name="Add rate", exact=True))
    return form


def test_wf_rate_cards_add_and_apply(browser, app_url):
    billing = Api(app_url, BILLING)
    org, line = "LFC", "asl"
    eff = fresh_effective(billing, org, line)
    old = rate_on(billing, org, line, eff - timedelta(days=1))
    new_cents = old["hourly_rate_cents"] + RATE_STEP
    with screen(browser, app_url, BILLING, "/billing") as page:
        fill_rate(page, ORGS[org], line, eff, new_cents, old["mileage_cents_per_mile"])
        says(page, "Rate status", f"Rate from {eff:%a} {eff.day} {eff:%b} {eff.year} saved.")
        fill_rate(page, ORGS[org], line, eff, new_cents, old["mileage_cents_per_mile"])
        says(page, "Rate status", "A rate already starts on that date.")
    added = [e for e in rate_entries(billing, org) if e["service_line"] == line and e["effective_from"] == eff.isoformat()]
    assert len(added) == 1 and added[0]["hourly_rate_cents"] == new_cents
    eve, morning = central(eff - timedelta(days=1), 21), central(eff, 9)
    who = free_interpreter(app_url, ASL_INTERPRETERS, [(eve, 60), (morning, 60)])
    totals = []
    for t, hourly in ((eve, old["hourly_rate_cents"]), (morning, new_cents)):
        run = scenario(app_url, start=t, minutes=60, scheduler=LFC_SCHED, claims=((1, who),))
        assert verify(run.people[who], run.number, 1).status_code == 201
        ch = charges(billing, run.number)
        assert ch["rate"]["hourly_rate_cents"] == hourly and ch["total_cents"] == seat_cents(hourly, 60)[1]
        posted = billing.post(f"/api/assignments/{run.number}/invoice")
        assert posted.status_code == 201 and posted.json()["billing"]["total_cents"] == ch["total_cents"]
        totals.append(ch["total_cents"])
    assert totals[0] != totals[1]


def test_wf_rate_cards_non_future_rejected(browser, app_url):
    billing = Api(app_url, BILLING)
    today = now_central().date()
    org, line = next((o, l) for o in ORGS for l in ("asl", "spoken")
                     if not any(e["service_line"] == l and e["effective_from"] == today.isoformat() for e in rate_entries(billing, o)))
    message = assert_error(billing.post("/api/rate-cards", {"org": org, "service_line": line, "effective_from": today.isoformat(),
                                                            "hourly_rate_cents": 7000, "mileage_cents_per_mile": 70}),
                           422, "validation", "effective_from")["fields"]["effective_from"]
    count = len(rate_entries(billing, org))
    with screen(browser, app_url, BILLING, "/billing") as page:
        form = fill_rate(page, ORGS[org], line, today, 7000, 70)
        expect(form.get_by_role("textbox", name="Effective from", exact=True)).to_have_accessible_description(
            re.compile(re.escape(message)), timeout=REAL_MS)
    assert len(rate_entries(billing, org)) == count


def test_wf_org_admin_manage_schedulers(browser, app_url):
    name, email = unique("sched")
    with screen(browser, app_url, RVH_ADMIN, "/org") as page:
        form = page.get_by_role("form", name="Add scheduler", exact=True)
        fill(form.get_by_role("textbox", name="Name", exact=True), name)
        fill(form.get_by_role("textbox", name="Email", exact=True), email)
        fill(form.get_by_role("textbox", name="Phone", exact=True), FRESH_PHONE)
        fill(form.get_by_role("textbox", name="Initial password", exact=True), FRESH_PASSWORD)
        click(form.get_by_role("button", name="Add scheduler", exact=True))
        says(page, "Scheduler status", f"{name} can now request interpreters.")
        table = page.get_by_role("table", name="Schedulers", exact=True)
        expect(table).to_contain_text(email, timeout=REAL_MS)
        newbie = Api(app_url, email, FRESH_PASSWORD)
        assert newbie.user["role"] == "scheduler" and newbie.user["org"]["code"] == "RVH"
        helen = Api(app_url, RVH_ADMIN)
        sid = next(x["id"] for x in helen.get("/api/org/schedulers").json()["schedulers"] if x["email"] == email)
        victor = Api(app_url, CPSD_ADMIN)
        assert_error(victor.delete(f"/api/org/schedulers/{sid}"), 404, "not_found")
        assert email not in [x["email"] for x in victor.get("/api/org/schedulers").json()["schedulers"]]
        click(table.get_by_role("button", name=f"Remove {name}", exact=True))
        says(page, "Scheduler status", f"{name} no longer has access.")
    assert_error(newbie.get("/api/me"), 401, "unauthenticated")
    assert_error(httpx.post(at(app_url, "/api/session"), json={"email": email, "password": FRESH_PASSWORD}, timeout=HTTP_TIMEOUT_S),
                 401, "invalid_credentials")
    assert email not in [x["email"] for x in Api(app_url, RVH_ADMIN).get("/api/org/schedulers").json()["schedulers"]]


def test_wf_org_admin_statement(browser, app_url):
    rosa = Api(app_url, ROSA)
    run = posted_one(app_url, start=far_slot(60, [rosa]), who=ROSA, scheduler=RVH_SCHED)
    month = f"{cday(run.start):%Y-%m}"
    with screen(browser, app_url, RVH_ADMIN, "/org") as page:
        form = page.get_by_role("form", name="Monthly statement", exact=True)
        fill(form.get_by_role("textbox", name="Month", exact=True), month)
        with page.expect_download() as info:
            click(form.get_by_role("button", name="Download statement", exact=True))
        content = Path(info.value.path()).read_text()
    assert content.splitlines()[0] == STATEMENT_HEADER
    row = next(r for r in csv.DictReader(io.StringIO(content)) if r["number"] == run.number)
    assert int(row["total_cents"]) == run.charges["total_cents"] == run.billing["total_cents"]
    assert row["invoice_id"] == run.billing["invoice_id"]


def test_wf_org_admin_email_taken(browser, app_url):
    name, _ = unique("dup")
    with screen(browser, app_url, RVH_ADMIN, "/org") as page:
        form = page.get_by_role("form", name="Add scheduler", exact=True)
        fill(form.get_by_role("textbox", name="Name", exact=True), name)
        fill(form.get_by_role("textbox", name="Email", exact=True), RVH_SCHED2)
        fill(form.get_by_role("textbox", name="Phone", exact=True), FRESH_PHONE)
        fill(form.get_by_role("textbox", name="Initial password", exact=True), FRESH_PASSWORD)
        click(form.get_by_role("button", name="Add scheduler", exact=True))
        says(page, "Scheduler status", "That email is already in use.")
    listed = Api(app_url, RVH_ADMIN).get("/api/org/schedulers").json()["schedulers"]
    assert [x["email"] for x in listed].count(RVH_SCHED2) == 1 and name not in [x["name"] for x in listed]


def test_wf_cross_cutting_sign_in(browser, app_url):
    with screen(browser, app_url, None, "/") as page:
        form = page.get_by_role("form", name="Sign in", exact=True)
        fill(form.get_by_role("textbox", name="Email", exact=True), DISPATCHER)
        fill(form.get_by_label("Password", exact=True), "not-the-password")
        click(form.get_by_role("button", name="Sign in", exact=True))
        says(page, "Sign-in status", "Email or password is wrong.")
        fill(form.get_by_label("Password", exact=True), PASSWORD)
        form.get_by_label("Password", exact=True).press("Enter")
        expect(page).to_have_url(re.compile(r"/board(?:[?#].*)?$"), timeout=REAL_MS)
        for shown in (page.get_by_text("All times Central (Chicago)"), page.get_by_text("Dana Whitcombe")):
            expect(shown.first).to_be_attached(timeout=REAL_MS)
            assert any(shown.nth(i).is_visible() for i in range(shown.count()))
        click(page.get_by_role("button", name="Sign out", exact=True))
        assert poll(lambda: page.request.get(at(app_url, "/api/me")).status, lambda st: st == 401, MAIL_DEADLINE_S) == 401
        page.goto(at(app_url, "/board"))
        expect(page.get_by_role("form", name="Sign in", exact=True)).to_be_visible(timeout=REAL_MS)


ROLE_LANDING = ((RVH_SCHED, "/requests", {"Requests"}), (RVH_ADMIN, "/requests", {"Requests", "Schedulers"}),
                (DISPATCHER, "/board", {"Board"}), (BILLING, "/billing", {"Billing"}), (ROSA, "/offers", {"Open seats", "My seats"}))
NAV_LINKS = ("Requests", "Board", "Open seats", "My seats", "Billing", "Schedulers")


def test_wf_cross_cutting_role_landing(browser, app_url):
    for email, landing, links in ROLE_LANDING:
        with screen(browser, app_url, None, "/") as page:
            form = page.get_by_role("form", name="Sign in", exact=True)
            fill(form.get_by_role("textbox", name="Email", exact=True), email)
            fill(form.get_by_label("Password", exact=True), PASSWORD)
            click(form.get_by_role("button", name="Sign in", exact=True))
            expect(page).to_have_url(re.compile(rf"{landing}(?:[?#].*)?$"), timeout=REAL_MS)
            nav = page.get_by_role("navigation", name="Main", exact=True)
            for link in NAV_LINKS:
                expect(nav.get_by_role("link", name=link, exact=True)).to_have_count(1 if link in links else 0)
            foreign = "/offers" if landing != "/offers" else "/billing"
            page.goto(at(app_url, foreign))
            expect(page).to_have_url(re.compile(rf"{landing}(?:[?#].*)?$"), timeout=REAL_MS)


def production_tree() -> dict[str, dict]:
    root = Path("/app") if Path("/app/node_modules").exists() else Path(getattr(conftest, "DEPLOYED_APP", "/app"))
    found: dict[str, dict] = {}
    for package in conftest.shipped_packages(root):
        if package.name not in found or (not found[package.name].get("license") and package.licence):
            found[package.name] = {"version": package.version, "license": package.licence}
    return found


def licence_ok(value: Any) -> bool:
    if isinstance(value, dict):
        value = value.get("type")
    if not isinstance(value, str):
        return False
    expr = value.strip().strip("()")
    if " OR " in expr:
        return any(licence_ok(part) for part in expr.split(" OR "))
    return all(part.strip().strip("()") in ALLOWED_LICENCES for part in expr.split(" AND "))


def test_if_run_manifest():
    data = json.loads(Path("/app/run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), key


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name in production_tree() if name not in notices]
    assert not missing, missing
    for font in ("Archivo", "Atkinson Hyperlegible"):
        assert font in notices, font


def test_if_licences_allowed():
    bad = {name: info.get("license") for name, info in production_tree().items() if not licence_ok(info.get("license"))}
    assert not bad, bad
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for font in ("Archivo", "Atkinson Hyperlegible"):
        lines = [l for l in notices.splitlines() if font in l]
        nearby = notices[notices.index(font): notices.index(font) + 400]
        names = ("OFL", "Open Font License")
        assert any(n in l for l in lines for n in names) or any(n in nearby for n in names), font


def test_if_no_extra_datastore():
    banned = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "level", "lowdb", "nedb", "@electric-sql/pglite",
              "lokijs", "pouchdb", "lmdb", "keyv"}
    manifest = json.loads(Path("/app/package.json").read_text())
    assert not banned & set(manifest.get("dependencies") or {})
    files = [p for p in Path("/app").rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not files, files


COMPOSE_NAME = re.compile(r"(?:docker-)?compose[\w.-]*\.ya?ml")


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-c", "safe.directory=*", *args], cwd="/app", capture_output=True,
                          timeout=NPM_TIMEOUT_S)


def test_if_compose_untouched():
    root = Path("/app")
    changed: list[str] = []
    if (root / ".git").exists():
        roots = _git("rev-list", "--max-parents=0", "HEAD").stdout.decode().split()
        if roots:
            base = roots[-1]
            shipped = [n for n in _git("ls-tree", "-r", "--name-only", base).stdout.decode().splitlines()
                       if COMPOSE_NAME.fullmatch(Path(n).name)]
            for name in shipped:
                original = _git("show", f"{base}:{name}").stdout
                current = root / name
                if not current.is_file() or current.read_bytes() != original:
                    changed.append(name)
    assert not changed, changed
    present = [p for p in root.rglob("*") if p.is_file() and COMPOSE_NAME.fullmatch(p.name) and "node_modules" not in p.parts]
    for p in present:
        assert p.read_text(errors="replace").strip(), p


def test_if_lockfile_used():
    lock = json.loads(Path("/app/package-lock.json").read_text())
    assert lock.get("lockfileVersion")
    install = json.loads(Path("/app/run.json").read_text())["install"]
    scripts = json.loads(Path("/app/package.json").read_text()).get("scripts") or {}
    named = re.search(r"\bnpm\s+(?:--?[\w-]+(?:[ =]\S+)?\s+)*run(?:-script)?\s+([\w:.-]+)", install)
    command = scripts.get(named.group(1), "") if named else install
    assert re.search(r"\bnpm\b(?:\s+--?[\w-]+(?:[ =]\S+)?)*\s+(ci|clean-install|install|i)\b", command), (install, command)


def test_if_same_origin_assets(browser, app_url):
    for email, path in ((None, "/"), (DISPATCHER, "/board")):
        with screen(browser, app_url, email, path) as page:
            seen: list[str] = []
            page.on("request", lambda r: seen.append(r.url) if r.resource_type in ("script", "stylesheet", "font") else None)
            page.reload()
            expect(page.get_by_role("button").first).to_be_visible(timeout=REAL_MS)
            foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
            assert not foreign, foreign
