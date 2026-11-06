from __future__ import annotations

import contextlib
import csv
import html
import io
import json
import os
import random
import re
import select as select_io
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
from calendar import month_name
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    click,
    fill,
    held,
    idempotency_key,
    open_app,
    same_origin,
    select,
    settle,
    tap,
    text,
    unique,
)


UTC = timezone.utc
LONDON = ZoneInfo("Europe/London")
PASSWORD = "cover-demo-2026"
MAIL_DOMAIN = "hollinsvale.example"
JSON_LIMIT = 65_536
MULTIPART_LIMIT = 5_100_000
FIT_NOTE_LIMIT = 5_000_000
LINK_SECONDS = 60
KEY_MAX = 100
NAME_MAX = 60
REASON_MAX = 500
CLOCK_WINDOW_MIN = 30
LATE_GRACE_MIN = 10
MISSED_AFTER_H = 4
MAX_LEAVE_DAYS = 28
SICK_BACK_DAYS = 28
FIT_NOTE_DAYS = 7
MISSED_LIST_DAYS = 7
STRIP_CELLS = 21
PREVIEW_DAYS = 7
UPCOMING_DAYS = 14
ACCRUAL_RATE = Decimal("0.1207")
SECONDS_PER_HOUR = 3600
BAR_MS = 320
BAR_MIN_MS = BAR_MS // 2
BAR_MAX_MS = BAR_MS * 5 // 4
STAGGER_MS = 40
STAGGER_MIN_MS = STAGGER_MS // 2
STAGGER_MAX_MS = STAGGER_MS * 3 // 2
FADE_MS = 220
FADE_MIN_MS = FADE_MS // 2
MOTION_MIN_CHANGES = 3
QUEUE_REFRESH_MS = 5_000
TODAY_REFRESH_MS = 30_000
SHIFTS_REFRESH_MS = 60_000
CSV_HEADER = "home,unit,staff_number,display_name,role,shift_date,shift,rostered_start,rostered_end,clock_in,clock_out,worked_hours,late,correction_note"
LICENCES = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "PSF-2.0", "OFL-1.1"}

HTTP_TIMEOUT = 30
POLL_STEP_S = 0.5
OUTBOX_DEADLINE_S = 75
STORAGE_DEADLINE_S = 75
ESCALATION_DEADLINE_S = 120
COPY_BOOT_S = 180
LINK_EXPIRY_DEADLINE_S = 120
MOTION_STEP_MS = 10
MOTION_SPAN_MS = 1_600
SCAN_DAYS = 160
FOREIGN_ORIGIN = "http://evil.example"
FAR_ZONES = ("Pacific/Kiritimati", "Etc/GMT+12")
ESCALATION_PROBE_S = "5"
FAR_FUTURE = date(2090, 1, 1)
FAR_FUTURE_SPAN = 3650
REPLAYED = "Idempotent-Replayed"
CORS_PREFIX = "access-control-allow"
APOSTROPHE = "'"
COOKIE_ATTRS = ("HttpOnly", "SameSite=Lax", "Path=/")
PUNCHES_PATH = "/api/punches"
JUNK_RECORD = "no-such-record"
EDITED_NOTE = "Edited draft"
DECLINE_NOTE = "Short staffed"
CORRECTION_NOTE = "Confirmed with worker"
KEYBOARD_OVERRIDE = "Agency booked by phone"
FORMULA_NOTE = "=SUM(1)"
PLUS_NOTE = "+1 call"
QUEUE_DECLINE = "Inspection that week"
PHONE_FIX = "Confirmed by phone"
HR_FIX = "HR fixed it"
OVERRIDE_UI = "Agency nurse booked"
LEAVE_NOTE = "Family wedding"
FIT_NOTE_NAME = "fit-note.pdf"
BUSY_REASON = "Busy"
CANCEL_REASON = "Rota emergency"
OWN_CANCEL = "Mine"
HOURS_TOLERANCE = Decimal("0.01")
FRESH_LINK_DEADLINE_S = 5
ID_PROBE_MIN = 6
NOTICE_LOOKAHEAD = 4
DOWNLOAD_DEADLINE_S = 30
AA_TEXT_RATIO = 4.5
AA_LARGE_RATIO = 3
LARGE_TEXT_PX = 24
LARGE_BOLD_PX = 18.66

MESSAGES = {
    "not_signed_in": "Sign in to continue.",
    "invalid_credentials": "That email and password don't match.",
    "forbidden": "You don't have permission to do that.",
    "own_request": "You can't decide your own leave request.",
    "skill_required": "This cover shift needs a senior.",
    "cross_origin": "Cross-origin requests are refused.",
    "not_found": "Not found.",
    "method_not_allowed": "This record can't be changed.",
    "already_taken": "This shift has already been taken.",
    "cover_closed": "This cover shift is no longer open.",
    "no_open_gap": "That shift has no uncovered gap for this skill.",
    "no_rostered_shift": "You have no rostered shift to clock in to right now.",
    "already_clocked_in": "You're already clocked in.",
    "no_open_clock_in": "You're not clocked in.",
    "clock_out_window_closed": "Your shift ended more than 4 hours ago. Ask your manager to add your clock-out.",
    "not_late": "This clock-in wasn't late.",
    "overlapping_shift": "That overlaps another shift for this person.",
    "overlaps_existing_leave": "You already have leave or a request covering these dates.",
    "already_started": "This leave has already started. Ask HR to cancel it.",
    "fit_note_missing": "Upload a fit note before closing this sickness record.",
    "attendance_exists": "This shift already has attendance.",
    "has_attendance": "This shift has attendance and can't be removed.",
    "version_exists": "A version already starts on that date.",
    "period_closed": "This pay period is already closed.",
    "period_not_ended": "This pay period hasn't ended yet.",
    "idempotency_key_reused": "This Idempotency-Key was used for a different request.",
    "storage_pending": "Still storing this file. Try again in a minute.",
    "stale_version": "Someone changed this record. Reload and try again.",
    "too_large": "That's too large to send.",
    "unsupported_media_type": "Send JSON.",
    "unsupported_file": "Upload a PDF, JPEG or PNG of your fit note.",
    "version_required": "Send the record's version in If-Match.",
    "validation": "Check the highlighted fields.",
}
UNKNOWN_FIELD = "This field can't be set."


HOMES = {"larchfield": "Larchfield House", "brackenmoor": "Brackenmoor Lodge"}
UNITS = {
    "larchfield-rowan": ("larchfield", "Rowan"),
    "larchfield-willow": ("larchfield", "Willow"),
    "brackenmoor-heather": ("brackenmoor", "Heather"),
}
HOME_UNITS = {"larchfield": ("larchfield-rowan", "larchfield-willow"), "brackenmoor": ("brackenmoor-heather",)}
SHIFTS = ("early", "late", "night")
SHIFT_HOURS = {"early": (7, 15), "late": (15, 22), "night": (22, 8)}
CARE = {
    "HV-0101": ("Priya Raman", "larchfield-rowan", "early", "senior"),
    "HV-0102": ("Tom Achebe", "larchfield-rowan", "early", "carer"),
    "HV-0103": ("Grace Lindqvist", "larchfield-rowan", "early", "carer"),
    "HV-0104": ("Kwame Mensah", "larchfield-rowan", "early", "carer"),
    "HV-0105": ("Joanna Price", "larchfield-rowan", "late", "senior"),
    "HV-0106": ("Ellis Hart", "larchfield-rowan", "late", "carer"),
    "HV-0107": ("Marta Novak", "larchfield-rowan", "late", "carer"),
    "HV-0108": ("Sean Doyle", "larchfield-rowan", "late", "carer"),
    "HV-0109": ("Devika Shah", "larchfield-rowan", "night", "senior"),
    "HV-0110": ("Aoife Brennan", "larchfield-rowan", "night", "carer"),
    "HV-0111": ("Bilal Qureshi", "larchfield-rowan", "night", "carer"),
    "HV-0121": ("Hannah Cole", "larchfield-willow", "early", "senior"),
    "HV-0122": ("Luis Ortega", "larchfield-willow", "early", "carer"),
    "HV-0123": ("Nia Evans", "larchfield-willow", "early", "carer"),
    "HV-0124": ("Ruth Abbott", "larchfield-willow", "late", "senior"),
    "HV-0125": ("Callum Reid", "larchfield-willow", "late", "carer"),
    "HV-0126": ("Zofia Wright", "larchfield-willow", "late", "carer"),
    "HV-0127": ("Yusuf Adeyemi", "larchfield-willow", "night", "senior"),
    "HV-0128": ("Leah Morgan", "larchfield-willow", "night", "carer"),
    "HV-0211": ("Imogen Taylor", "brackenmoor-heather", "early", "senior"),
    "HV-0212": ("Rhys Jenkins", "brackenmoor-heather", "early", "carer"),
    "HV-0213": ("Amara Osei", "brackenmoor-heather", "early", "carer"),
    "HV-0214": ("Owen Pritchard", "brackenmoor-heather", "late", "senior"),
    "HV-0215": ("Sophie Barker", "brackenmoor-heather", "late", "carer"),
    "HV-0216": ("Kemi Adeleke", "brackenmoor-heather", "late", "carer"),
    "HV-0217": ("Tariq Hussain", "brackenmoor-heather", "night", "senior"),
    "HV-0218": ("Bethan Lloyd", "brackenmoor-heather", "night", "carer"),
}
BANK = {
    "HV-0901": ("Femi Adebayo", "senior", ("larchfield", "brackenmoor")),
    "HV-0902": ("Carys Pugh", "carer", ("larchfield",)),
    "HV-0903": ("Mateusz Zielinski", "carer", ("larchfield",)),
    "HV-0904": ("Holly Strand", "carer", ("brackenmoor",)),
}
MANAGERS = {
    "HV-0011": ("Fenella Marsh", "larchfield"),
    "HV-0012": ("Idris Penhale", "larchfield"),
    "HV-0021": ("Oluwaseun Fisher", "brackenmoor"),
    "HV-0022": ("Petra Lowe", "brackenmoor"),
}
HR_ID = "HV-0050"
FENELLA, IDRIS, OLUWASEUN = "HV-0011", "HV-0012", "HV-0021"
FEMI, CARYS, MATEUSZ, HOLLY = "HV-0901", "HV-0902", "HV-0903", "HV-0904"
SEED_NAMES = {**{k: v[0] for k, v in CARE.items()}, **{k: v[0] for k, v in BANK.items()},
              **{k: v[0] for k, v in MANAGERS.items()}, HR_ID: "Rosalind Okafor"}
SEED_SHIFT = {u: {s: {p for p, v in CARE.items() if v[1] == u and v[2] == s} for s in SHIFTS} for u in UNITS}
ACTIVE = ("submitted", "escalated", "cover_pending", "approved")
CW_ROTA_KEYS = {"assignment_id", "person", "date", "shift", "starts_at", "ends_at", "hours", "status", "is_you"}
COVER_BC_KEYS = {"id", "home", "unit", "date", "shift", "starts_at", "ends_at", "hours", "skill", "status"}


def email_of(sid: str) -> str:
    return SEED_NAMES[sid].lower().replace(" ", ".") + "@" + MAIL_DOMAIN


_NO = object()


class Api:

    def __init__(self, base: str, sid: str, cookies=None):
        self.base = base.rstrip("/")
        self.id = sid
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, cookies=cookies)
        if cookies is None:
            r = self.c.post("/api/session", json={"email": email_of(sid), "password": PASSWORD})
            assert r.status_code == 200, f"sign-in {sid}: {r.status_code} {r.text}"

    def fork(self) -> "Api":
        return Api(self.base, self.id, cookies=dict(self.c.cookies))

    def req(self, method, path, body=_NO, key=None, headers=None, params=None):
        h = dict(headers or {})
        if key is not None:
            h["Idempotency-Key"] = key
        kw = {} if body is _NO else {"json": body}
        return self.c.request(method, path, headers=h, params=params, **kw)

    def ok(self, method, path, body=_NO, status=None, **kw):
        r = self.req(method, path, body, **kw)
        good = r.status_code in (200, 201, 204) if status is None else r.status_code == status
        assert good, f"{method} {path}: {r.status_code} {r.text}"
        return r.json() if r.content else None

    def me(self):
        return self.ok("GET", "/api/me")


def err(r: httpx.Response, status: int, code: str, field: str | None = None) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text}"
    body = r.json()
    assert body["error"] == code, body
    assert isinstance(body.get("message"), str) and body["message"], body
    if code in MESSAGES:
        assert body["message"] == MESSAGES[code], body
    if field is not None:
        assert field in body.get("errors", {}), body
    return body


def hr_api(base) -> Api:
    return Api(base, HR_ID)


def together(*calls):
    barrier = threading.Barrier(len(calls))

    def run(fn):
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        futures = [pool.submit(run, fn) for fn in calls]
        return [f.result() for f in futures]


def poll(fn, seconds, what):
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        assert time.monotonic() < deadline, f"timed out waiting for {what}"
        threading.Event().wait(POLL_STEP_S)


def token() -> str:
    raw = re.sub(r"[^A-Za-z0-9]", "", "".join(unique("tallow")))
    return raw[-10:]


def inst(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def secs(a: str, b: str) -> float:
    return (inst(b).astimezone(UTC) - inst(a).astimezone(UTC)).total_seconds()


def hours2(seconds) -> str:
    return str((Decimal(str(seconds)) / SECONDS_PER_HOUR).quantize(Decimal("0.01"), ROUND_HALF_UP))


def worked4(seconds) -> Decimal:
    return (Decimal(str(seconds)) / SECONDS_PER_HOUR).quantize(Decimal("0.0001"), ROUND_HALF_UP)


def accrual(seconds) -> Decimal:
    return (Decimal(str(seconds)) * ACCRUAL_RATE / SECONDS_PER_HOUR).quantize(Decimal("0.0001"), ROUND_CEILING)


def hours_match(value, seconds) -> bool:
    return value is not None and abs(Decimal(str(value)) - Decimal(str(seconds)) / SECONDS_PER_HOUR) < HOURS_TOLERANCE


def shows_instant(value: str, dt: datetime) -> bool:
    nums = [int(x) for x in re.findall(r"\d+", value)]
    month = dt.month in nums or f"{dt:%b}".lower() in value.lower()
    clock = re.search(rf"(?<!\d)0?{dt.hour}:{dt.minute:02d}", value) is not None
    return month and clock and dt.year in nums and dt.day in nums


def bounds(d: date, shift: str) -> tuple[datetime, datetime]:
    a, b = SHIFT_HOURS[shift]
    end_day = d + timedelta(days=1) if shift == "night" else d
    return (datetime(d.year, d.month, d.day, a, tzinfo=LONDON),
            datetime(end_day.year, end_day.month, end_day.day, b, tzinfo=LONDON))


def london_iso(dt: datetime) -> str:
    return dt.astimezone(LONDON).isoformat()


def label(d: date, shift: str) -> str:
    return f"{d:%a} {d.day} {d:%b} {shift.capitalize()}"


def short_label(d: date, shift: str) -> str:
    return f"{d:%a} {shift.capitalize()}"


def long_date(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b} {d.year}"


def hhmm(s: str) -> str:
    return inst(s).astimezone(LONDON).strftime("%H:%M")


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def leave_year(d: date) -> int:
    return d.year if d.month >= 4 else d.year - 1


def month_of(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def month_title(period: str) -> str:
    y, m = period.split("-")
    return f"{month_name[int(m)]} {y}"


def server_now(api: Api) -> datetime:
    return parsedate_to_datetime(api.c.get("/api/health").headers["date"]).astimezone(UTC)


def today_of(hr: Api) -> date:
    return date.fromisoformat(hr.ok("GET", "/api/homes/larchfield/today")["date"])


def rota_entries(api: Api, unit: str, d0: date, d1: date, cache=None) -> list[dict]:
    out = []
    week = monday(d0)
    while week <= d1:
        key = (unit, week)
        if cache is not None and key in cache:
            entries = cache[key]
        else:
            entries = api.ok("GET", f"/api/units/{unit}/rota", params={"from": week.isoformat()})["entries"]
            if cache is not None:
                cache[key] = entries
        out += [e for e in entries if d0.isoformat() <= e["date"] <= d1.isoformat()]
        week += timedelta(days=7)
    return out


def is_clean(hr, unit, shift, d, cache) -> bool:
    entries = [e for e in rota_entries(hr, unit, d, d, cache) if e["shift"] == shift]
    on = {e["person"]["id"] for e in entries if e["status"] == "on"}
    return on == SEED_SHIFT[unit][shift] and len(entries) == len(on)


def busy(hr, people, d, cache) -> bool:
    for unit in UNITS:
        for e in rota_entries(hr, unit, d - timedelta(days=1), d, cache):
            if e["person"]["id"] in people:
                return True
    return False


def active_ranges(owner: Api):
    items = owner.ok("GET", "/api/me/leave-requests")["items"]
    return [(date.fromisoformat(i["start_date"]), date.fromisoformat(i["end_date"])) for i in items if i["status"] in ACTIVE]


def find_window(hr, owner, length, offset, *, unit=None, shift=None, free=(), limit=SCAN_DAYS, others=()):
    today = today_of(hr)
    blocked = active_ranges(owner) + [r for o in others for r in active_ranges(o)]
    cache: dict = {}
    for k in range(offset, offset + limit):
        s = today + timedelta(days=k)
        e = s + timedelta(days=length - 1)
        if leave_year(s) != leave_year(e) or any(s <= b and a <= e for a, b in blocked):
            continue
        good = True
        for i in range(length):
            d = s + timedelta(days=i)
            if (unit and not is_clean(hr, unit, shift, d, cache)) or (free and busy(hr, set(free), d, cache)):
                good = False
                break
        if good:
            return s, e
    pytest.fail(f"no free {length}-day window for {owner.id}")


def make_leave(api, s, e, kind="unpaid", submit=True, note=None) -> dict:
    body = {"type": kind, "start_date": s.isoformat(), "end_date": e.isoformat(), "submit": submit}
    if note is not None:
        body["note"] = note
    return api.ok("POST", "/api/leave-requests", body, status=201)


def finish(hr, owner, rid):
    with contextlib.suppress(Exception):
        status = owner.ok("GET", f"/api/leave-requests/{rid}")["status"]
        if status == "approved":
            hr.req("POST", f"/api/leave-requests/{rid}/cancel", {"reason": "Verifier clean-up"})
        elif status in ("draft", "submitted", "escalated", "cover_pending"):
            owner.req("POST", f"/api/leave-requests/{rid}/withdraw", {})


def remove_quietly(hr, assignment_id):
    with contextlib.suppress(Exception):
        hr.req("DELETE", f"/api/rota/assignments/{assignment_id}")


def preview(mgr, rid, frm=None) -> dict:
    params = {"from": frm.isoformat()} if frm else None
    return mgr.ok("GET", f"/api/leave-requests/{rid}/preview", params=params)


def shift_of(pv, d, shift):
    return next(s for s in pv["shifts"] if s["date"] == d.isoformat() and s["shift"] == shift)


def add_assignment(hr, pid, unit, d, shift):
    return hr.req("POST", "/api/rota/assignments", {"person_id": pid, "unit_id": unit, "date": d.isoformat(), "shift": shift})


def place_bank(hr, unit, d, shift, candidates) -> tuple[str, dict]:
    for pid in candidates:
        r = add_assignment(hr, pid, unit, d, shift)
        if r.status_code == 201:
            return pid, r.json()
    pytest.fail(f"no bank carer free for {unit} {d} {shift}")


def bank_slot(hr, pid, unit, first_day, shift, days=20) -> dict:
    for k in range(days):
        d = first_day + timedelta(days=k)
        if d.month != first_day.month:
            break
        r = add_assignment(hr, pid, unit, d, shift)
        if r.status_code == 201:
            return r.json()
    pytest.fail(f"no free day for {pid} in {month_of(first_day)}")


def attendance_on(hr, home, d) -> list[dict]:
    return hr.ok("GET", f"/api/homes/{home}/attendance", params={"date": d.isoformat()})["items"]


def past_assignment(hr, unit, days, shift=None, exclude=()) -> dict:
    now = server_now(hr)
    today = today_of(hr)
    home = UNITS[unit][0]
    for k in days:
        d = today - timedelta(days=k)
        taken = {a["assignment_id"] for a in attendance_on(hr, home, d)}
        for e in rota_entries(hr, unit, d, d):
            pid = e["person"]["id"]
            if e["assignment_id"] in taken or pid not in CARE or pid in exclude or (shift and e["shift"] != shift):
                continue
            if inst(e["ends_at"]) + timedelta(hours=MISSED_AFTER_H) < now:
                return e
    pytest.fail(f"no past assignment without attendance in {unit}")


def add_attendance(api, aid, clock_in, clock_out, reason):
    return api.req("POST", "/api/attendance", {"assignment_id": aid, "clock_in_at": clock_in, "clock_out_at": clock_out, "reason": reason})


def in_window(start, end, now) -> bool:
    return start - timedelta(minutes=CLOCK_WINDOW_MIN) <= now < end - timedelta(minutes=3)


def current_candidate(base, hr) -> tuple[Api, dict]:
    now = server_now(hr)
    today = today_of(hr)
    taken = set()
    for home, units in HOME_UNITS.items():
        for d in (today - timedelta(days=1), today):
            taken |= {a["assignment_id"] for a in attendance_on(hr, home, d)}
        for unit in units:
            for e in rota_entries(hr, unit, today - timedelta(days=1), today):
                pid = e["person"]["id"]
                if pid not in CARE or e["assignment_id"] in taken or not in_window(inst(e["starts_at"]), inst(e["ends_at"]), now):
                    continue
                worker = Api(base, pid)
                if worker.ok("GET", "/api/me/shifts")["open_attendance"] is None:
                    return worker, e
    for d in (today - timedelta(days=1), today):
        for shift in SHIFTS:
            if not in_window(*bounds(d, shift), now):
                continue
            for unit in UNITS:
                for pid in sorted(p for p, v in CARE.items() if v[1] == unit):
                    worker = Api(base, pid)
                    mine = worker.ok("GET", "/api/me/shifts")
                    if mine["open_attendance"] is not None or any(
                            a["assignment_id"] not in taken and in_window(inst(a["starts_at"]), inst(a["ends_at"]), now)
                            for a in mine["assignments"]):
                        continue
                    r = add_assignment(hr, pid, unit, d, shift)
                    if r.status_code == 201:
                        return worker, r.json()
    pytest.fail("no care worker can be rostered on the current shift")


def punch(api, kind, key=None):
    return api.req("POST", "/api/punches", {"kind": kind}, key=key or idempotency_key())


def no_open_code(api) -> str:
    missed = any(a["missed_clock_out"] for a in api.ok("GET", "/api/me/attendance")["items"])
    return "clock_out_window_closed" if missed else "no_open_clock_in"


def my_attendance(api, aid) -> list[dict]:
    return [a for a in api.ok("GET", "/api/me/attendance")["items"] if a["assignment_id"] == aid]


def audit_for(api, home, target_id) -> list[dict]:
    entries = [a for a in api.ok("GET", "/api/audit", params={"home": home})["items"] if a["target"]["id"] == target_id]
    for a in entries:
        assert all(a[k] is None or isinstance(a[k], dict) for k in ("before", "after")), a
    return entries


def report_sickness(api, start, reason="Feeling unwell") -> dict:
    return api.ok("POST", "/api/sickness", {"start_date": start.isoformat(), "reason": reason}, status=201)


def upload(api, sid, data, name, ctype="application/octet-stream"):
    return api.c.post(f"/api/sickness/{sid}/fit-note", files={"file": (name, data, ctype)})


def claim(api, cover_id, key=None):
    return api.req("POST", f"/api/cover-shifts/{cover_id}/claim", {}, key=key or idempotency_key())


def ledger(api) -> dict:
    return api.ok("GET", "/api/me/accrual")


def month_seconds(api, period) -> float:
    return sum(secs(a["clock_in_at"], a["clock_out_at"]) for a in api.ok("GET", "/api/me/attendance")["items"]
               if a["date"].startswith(period) and a["clock_out_at"] and not a["missed_clock_out"])


def unclosed_months(hr, today, count) -> list[str]:
    closed = {i["period"] for i in hr.ok("GET", "/api/pay-periods")["items"] if i["closed_at"]}
    y, m, out = today.year, today.month, []
    while len(out) < count:
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        period = f"{y:04d}-{m:02d}"
        if period not in closed:
            out.append(period)
    return out


def name_of(api) -> str:
    return api.me()["display_name"]


def rename(api, name):
    api.ok("PATCH", "/api/me", {"display_name": name})


def free_far_date(existing: set[str]) -> date:
    while True:
        d = FAR_FUTURE + timedelta(days=random.randrange(FAR_FUTURE_SPAN))
        if d.isoformat() not in existing:
            return d


def pdf_bytes(size=None) -> bytes:
    head, tail = b"%PDF-1.4\n", b"\n%%EOF\n"
    body = b"1 0 obj << >> endobj"
    data = head + body + tail
    if size is not None:
        data = head + body + b"0" * (size - len(head) - len(body) - len(tail)) + tail
    return data


PNG_BYTES = bytes.fromhex("89504e470d0a1a0a") + b"\x00\x00\x00\x0dIHDR" + b"\x00" * 17 + b"\x00\x00\x00\x00IEND\xaeB`\x82"
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 32 + b"\xff\xd9"
TRAVERSAL_NAME = '..\\..\\Kwame "fit" note – Siân.pdf'
KEPT_NAME = 'Kwame "fit" note – Siân.pdf'
KEPT_DISPOSITION = "attachment; filename=\"Kwame _fit_ note _ Si_n.pdf\"; filename*=UTF-8''Kwame%20%22fit%22%20note%20%E2%80%93%20Si%C3%A2n.pdf"


def mail_ids(mail) -> set:
    return {m.get("ID") for m in mail.messages()}


def mail_wait(mail, before, match, count=1, seconds=OUTBOX_DEADLINE_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages() if m.get("ID") not in before and match(m)]
        if len(found) >= count or time.monotonic() > deadline:
            return found


def rcpts(m) -> list[str]:
    return [a.lower() for k in ("To", "Cc", "Bcc") for a in addresses(m.get(k) or [])]


def body_of(m) -> str:
    plain = ""
    with contextlib.suppress(Exception):
        plain = text(m) or ""
    markup = m.get("HTML") or ""
    return plain + "\n" + html.unescape(re.sub(r"<[^>]+>", " ", markup))


@contextlib.contextmanager
def app_copy(**env):
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP,
                            env={**os.environ, **env, "APP_PUBLIC_PORT": str(port)},
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail():
        log.flush()
        return Path(log.name).read_text(errors="replace")[-4000:]

    try:
        deadline = time.monotonic() + COPY_BOOT_S
        while True:
            assert proc.poll() is None, f"app copy exited:\n{tail()}"
            with contextlib.suppress(httpx.HTTPError):
                if httpx.get(base + "/api/health", timeout=5).status_code == 200:
                    break
            assert time.monotonic() < deadline, f"app copy never became healthy:\n{tail()}"
            threading.Event().wait(POLL_STEP_S)
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(Exception):
            proc.wait(timeout=30)


@contextlib.contextmanager
def ui(browser, base, sid, path="/", *, size=(1280, 800), reduced_motion="no-preference"):
    base = base.rstrip("/")
    with open_app(browser, base + "/sign-in", reduced_motion=reduced_motion) as page:
        page.clock.resume()
        page.set_viewport_size({"width": size[0], "height": size[1]})
        fill(page.get_by_role("textbox", name="Email"), email_of(sid))
        fill(page.get_by_label("Password"), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        expect(page).not_to_have_url(re.compile(r"/sign-in"))
        page.goto(base + path)
        yield page


def queue_url(rid, home="larchfield", status="open", week=""):
    return f"/queue?home={home}&status={status}&week={week}&request={rid}"


def strip_cells(page):
    return page.get_by_role("group", name="Staffing strip").get_by_role("group")


def cell_name(s: dict, on: bool) -> str:
    d = date.fromisoformat(s["date"])
    floor = s["floor"]
    if on:
        n, short, senior_short = s["on_duty_if_approved"], s["shortfall"], s["senior_shortfall"]
    else:
        n = s["on_duty"]
        short = max(0, floor["min_staff"] - n)
        senior_short = max(0, floor["min_seniors"] - s["seniors_on_duty"])
    name = f"{label(d, s['shift'])}: {n} on duty, floor {floor['min_staff']}"
    if short:
        name += f", {short} below floor"
    if senior_short:
        name += ", no senior on shift"
    return name


def tab_to(page, locator, presses=60):
    for _ in range(presses):
        if locator.evaluate("el => el === document.activeElement || el.contains(document.activeElement)"):
            return
        page.keyboard.press("Tab")
    pytest.fail("could not reach the control with Tab")


def cell_active(locator) -> bool:
    return locator.evaluate("""el => { const a = document.activeElement; if (!a) return false;
      if (a === el) return true; const id = a.getAttribute('aria-activedescendant'); return !!id && el.id === id; }""")


def no_sideways_scroll(page):
    poll(lambda: page.evaluate("""() => { const y = window.scrollY; window.scrollTo(100000, y);
      const x = window.scrollX; window.scrollTo(0, y); return x === 0; }"""), HTTP_TIMEOUT, "no sideways scrolling")


def field_format(locator, value: datetime, with_time: bool) -> str:
    kind = (locator.get_attribute("type") or "text").lower()
    if kind == "date":
        return value.strftime("%Y-%m-%d")
    if kind == "datetime-local":
        return value.strftime("%Y-%m-%dT%H:%M")
    hint = (locator.get_attribute("placeholder") or "").upper()
    if "YYYY" in hint:
        out = hint.replace("YYYY", f"{value.year:04d}").replace("HH:MM", f"{value.hour:02d}:{value.minute:02d}").replace("HH", f"{value.hour:02d}")
        return out.replace("MM", f"{value.month:02d}").replace("DD", f"{value.day:02d}")
    return value.strftime("%Y-%m-%dT%H:%M" if with_time else "%Y-%m-%d")


def fill_date(locator, d: date):
    fill(locator, field_format(locator, datetime(d.year, d.month, d.day), False))


def fill_datetime(locator, dt: datetime):
    fill(locator, field_format(locator, dt.astimezone(LONDON), True))


def download_via(page, action):
    got = []
    page.on("download", lambda d: got.append(d))
    page.context.on("page", lambda p: p.on("download", lambda d: got.append(d)))
    action()

    def pump():
        with contextlib.suppress(Exception):
            page.evaluate("1")
        return got

    return poll(pump, DOWNLOAD_DEADLINE_S, "download")[0]


def open_rota_unit(page, base, unit_name, marker):
    table = page.get_by_role("table", name="Team rota")

    def showing():
        page.wait_for_load_state("networkidle")
        return table.count() == 1 and marker in (table.text_content() or "")

    page.goto(base.rstrip("/") + "/rota")
    expect(table).to_be_visible()
    if not showing():
        click(page.get_by_role("navigation", name="Homes and units").get_by_role("link", name=unit_name))
        poll(showing, HTTP_TIMEOUT, f"{unit_name} on Team rota")


def drag(page, source, target=None, at=None):
    if target is not None:
        target.scroll_into_view_if_needed()

    def mid(loc):
        b = loc.bounding_box()
        return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

    sx, sy = mid(source)
    tx, ty = mid(target) if target is not None else at
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx + 8, sy + 8, steps=4)
    page.mouse.move(tx, ty, steps=12)
    page.mouse.up()


SHOWN_TEXT = """el => {
  const out = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const node = walk.currentNode;
    let shown = !!node.parentElement && node.parentElement.getClientRects().length > 0;
    for (let q = node.parentElement; shown && q; q = q === el ? null : q.parentElement) {
      const s = getComputedStyle(q);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) shown = false;
    }
    if (shown) out.push(node.textContent);
  }
  return out.join(' ');
}"""


def pick_colleague(page, box, who):
    box.press_sequentially(who)
    options = page.get_by_role("option")
    matching = page.get_by_role("option", name=re.compile(re.escape(who)))
    dialog = page.get_by_role("dialog", name="Add to shift")
    datalist = """el => { const l = el.list; if (!l) return null;
      return Array.from(l.options).map(o => (o.label || '') + ' ' + (o.value || '') + ' ' + (o.textContent || '')); }"""
    kind = {}

    def narrowed():
        total = options.count()
        if total >= 1:
            kind["k"] = "options"
            return matching.count() == total
        listed = box.evaluate(datalist)
        if listed:
            kind["k"] = "datalist"
            return all(who in o for o in listed)
        kind["k"] = "text"
        return dialog.get_by_text(who).count() >= 1

    poll(narrowed, HTTP_TIMEOUT, f"the picker narrowed to {who}")
    if kind.get("k") == "datalist":
        return
    box.press("ArrowDown")
    box.press("Enter")


def oversized_multipart(base: str, path: str, cookie: str, total: int) -> httpx.Response:
    parts = urllib.parse.urlsplit(base)
    boundary = "tallowprobeboundary"
    head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.pdf\"\r\n"
            f"Content-Type: application/pdf\r\n\r\n").encode() + b"%PDF-"
    tail = f"\r\n--{boundary}--\r\n".encode()
    filler = total - len(head) - len(tail)
    request = (f"POST {path} HTTP/1.1\r\nHost: {parts.netloc}\r\nCookie: tallow_session={cookie}\r\n"
               f"Content-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {total}\r\n"
               f"Connection: close\r\n\r\n").encode()
    got = bytearray()
    sock = socket.create_connection((parts.hostname, parts.port or 80), timeout=HTTP_TIMEOUT)

    def drain() -> bool:
        try:
            while select_io.select([sock], [], [], 0)[0]:
                chunk = sock.recv(65536)
                if not chunk:
                    return True
                got.extend(chunk)
        except OSError:
            return True
        return False

    try:
        closed = False
        try:
            sock.sendall(request + head)
            block = b"0" * 65536
            remaining = filler
            while remaining > 0 and not got and not closed:
                n = min(remaining, len(block))
                sock.sendall(block[:n])
                remaining -= n
                closed = drain()
            if remaining <= 0 and not got and not closed:
                sock.sendall(tail)
        except OSError:
            closed = drain()
        while not closed:
            try:
                chunk = sock.recv(65536)
            except OSError:
                break
            if not chunk:
                break
            got.extend(chunk)
    finally:
        with contextlib.suppress(OSError):
            sock.close()
    assert got, "server closed the connection without answering the oversized upload"
    head_bytes, _, body = bytes(got).partition(b"\r\n\r\n")
    lines = head_bytes.decode("latin-1").split("\r\n")
    status = int(lines[0].split(" ", 2)[1])
    headers = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in lines[1:])}
    if "chunked" in headers.get("transfer-encoding", "").lower():
        out, rest = bytearray(), body
        while rest:
            size_line, _, rest = rest.partition(b"\r\n")
            size = int(size_line.split(b";")[0] or b"0", 16)
            if size == 0:
                break
            out.extend(rest[:size])
            rest = rest[size + 2:]
        body = bytes(out)
    elif "content-length" in headers:
        body = body[:int(headers["content-length"])]
    return httpx.Response(status, content=body, headers={"content-type": headers.get("content-type", "application/json")})


def labels_shown(cell) -> tuple:
    shown = cell.evaluate(SHOWN_TEXT)
    return tuple(sorted(set(re.findall(r"-(\d+) below floor", shown)))), "no senior on shift" in shown


def labels_expected(shortfall, senior_shortfall) -> tuple:
    return ((str(shortfall),) if shortfall else ()), bool(senior_shortfall)


CONTRAST_JS = """([normal, large, largePx, boldPx]) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const rgba = c => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])).concat([1]);
  const lum = c => { const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ground = el => { const layers = [];
    for (let q = el; q; q = q.parentElement) { const s = getComputedStyle(q);
      if (s.backgroundImage !== 'none') return null;
      const c = rgba(s.backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
    let base = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };
  const faded = el => { for (let q = el; q; q = q.parentElement) if (parseFloat(getComputedStyle(q).opacity) === 0) return true; return false; };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || faded(el)) continue;
    if (el.closest('[disabled], [aria-disabled="true"], [aria-hidden="true"]')) continue;
    const bg = ground(el); if (!bg) continue;
    const fg = over(rgba(s.color), bg);
    const a = lum(fg), b = lum(bg); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(s.fontSize), weight = parseInt(s.fontWeight, 10) || 400;
    const need = (size >= largePx || (size >= boldPx && weight >= 700)) ? large : normal;
    if (ratio + 0.005 < need) bad.push([el.textContent.trim().slice(0, 40), Math.round(ratio * 100) / 100]);
  }
  return bad;
}"""


def test_health_and_manifest(app_url):
    r = httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"status": "ok", "mail": "up", "storage": "up"}


def test_sessions(app_url):
    base = app_url.rstrip("/")
    r = httpx.post(base + "/api/session", json={"email": email_of("HV-0101"), "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert user["id"] == "HV-0101" and user["email"] == email_of("HV-0101") and user["role"] == "care_worker"
    cookie = next(h for h in r.headers.get_list("set-cookie") if h.startswith("tallow_session="))
    attrs = cookie.lower()
    assert all(a.lower() in attrs for a in COOKIE_ATTRS), cookie
    value = cookie.split(";")[0].split("=", 1)[1]
    client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, cookies={"tallow_session": value})
    assert client.get("/api/me").json()["id"] == "HV-0101"

    bad = httpx.post(base + "/api/session", json={"email": email_of("HV-0101"), "password": PASSWORD + "x"}, timeout=HTTP_TIMEOUT)
    err(bad, 401, "invalid_credentials")
    granted = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, cookies=dict(bad.cookies))
    err(granted.get("/api/me"), 401, "not_signed_in")

    err(httpx.get(base + "/api/me", timeout=HTTP_TIMEOUT), 401, "not_signed_in")
    junk = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, cookies={"tallow_session": "not-a-session"})
    err(junk.get("/api/me"), 401, "not_signed_in")
    assert client.delete("/api/session").status_code == 204
    err(httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, cookies={"tallow_session": value}).get("/api/me"), 401, "not_signed_in")


def test_error_shape_and_precedence(app_url):
    base = app_url.rstrip("/")
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    junk = "no-such-id-" + token()
    err(anon.post("/api/leave-requests", content=b"x" * (JSON_LIMIT + 1), headers={"Content-Type": "application/json"}), 413, "too_large")
    err(anon.post("/api/leave-requests", json={}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    err(anon.post("/api/leave-requests", content=b"{}", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    err(anon.get(f"/api/leave-requests/{junk}"), 401, "not_signed_in")

    cw = Api(base, "HV-0106")
    err(cw.req("POST", f"/api/leave-requests/{junk}/approve", {}), 404, "not_found")
    err(cw.req("POST", "/api/homes/larchfield/floors", {"min_staff": "lots"}), 403, "forbidden")

    hr = hr_api(base)
    e = past_assignment(hr, "larchfield-willow", range(2, 7))
    start, _ = inst(e["starts_at"]), inst(e["ends_at"])
    att = hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(start),
                                            "clock_out_at": None, "reason": "Precedence probe"}, status=201)
    err(hr.req("PATCH", f"/api/attendance/{att['id']}", {"clock_in_at": "junk", "clock_out_at": None, "reason": ""}), 428, "version_required")

    s, f = find_window(hr, cw, 1, 90)
    req = make_leave(cw, s, f)
    try:
        b = err(cw.req("PATCH", f"/api/leave-requests/{req['id']}", {"note": "x", "status": "approved"}), 409, "invalid_transition")
        assert b["status"] == "submitted"
        v = err(cw.req("POST", "/api/leave-requests", {"type": "holiday", "start_date": s.isoformat(), "end_date": f.isoformat()}), 422, "validation", "type")
        assert v["errors"]["type"] == "Choose annual, unpaid or compassionate leave."
        assert set(v) >= {"error", "message", "errors"}
    finally:
        finish(hr, cw, req["id"])


def test_server_boundary(app_url):
    base = app_url.rstrip("/")
    parts = urllib.parse.urlsplit(base)
    origin = f"{parts.scheme}://{parts.netloc}"
    cw = Api(base, "HV-0107")
    name0 = name_of(cw)
    r = cw.req("PATCH", "/api/me", {"display_name": "Cross origin probe"}, headers={"Origin": FOREIGN_ORIGIN})
    err(r, 403, "cross_origin")
    assert not any(h.lower().startswith(CORS_PREFIX) for h in r.headers)
    assert name_of(cw) == name0
    assert cw.req("PATCH", "/api/me", {"display_name": name0}, headers={"Origin": origin}).status_code == 200

    big = json.dumps({"display_name": "x" * JSON_LIMIT}).encode()
    err(cw.c.patch("/api/me", content=big, headers={"Content-Type": "application/json"}), 413, "too_large")
    prefix, suffix = b'{"display_name":"', b'"}'
    exact = prefix + b"x" * (JSON_LIMIT - len(prefix) - len(suffix)) + suffix
    assert len(exact) == JSON_LIMIT
    err(cw.c.patch("/api/me", content=exact, headers={"Content-Type": "application/json"}), 422, "validation", "display_name")
    err(cw.c.patch("/api/me", content=b'{"display_name":"x"}', headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    assert name_of(cw) == name0
    err(oversized_multipart(base, f"/api/sickness/{JUNK_RECORD}/fit-note", cw.c.cookies["tallow_session"],
                            MULTIPART_LIMIT + 1024), 413, "too_large")

    probe = httpx.get(base + "/api/health", headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT)
    assert not any(h.lower().startswith(CORS_PREFIX) for h in probe.headers)
    for path in ("/run.json", "/.env", "/.git/config", "/requirements.txt", "/package.json"):
        assert httpx.get(base + path, timeout=HTTP_TIMEOUT).status_code == 404, path
    for path in ("/sign-in", "/queue", "/today", "/leave/new"):
        page = httpx.get(base + path, timeout=HTTP_TIMEOUT)
        assert page.status_code == 200 and page.headers["content-type"].startswith("text/html"), path


def test_clock_in_window_and_refusals(app_url):
    hr = hr_api(app_url)
    worker, entry = current_candidate(app_url, hr)
    err(punch(worker, "out"), 409, no_open_code(worker))
    first = punch(worker, "in")
    assert first.status_code == 201, first.text
    body = first.json()
    att = body["attendance"]
    assert body["punch"]["kind"] == "in"
    assert att["assignment_id"] == entry["assignment_id"]
    assert inst(att["rostered_start"]) == inst(entry["starts_at"]) and inst(att["rostered_end"]) == inst(entry["ends_at"])
    assert inst(entry["starts_at"]) - timedelta(minutes=CLOCK_WINDOW_MIN) <= inst(att["clock_in_at"]) <= inst(entry["ends_at"])
    assert att["clock_out_at"] is None and att["worked_hours"] is None and att["missed_clock_out"] is False
    assert att["version"] == 1

    err(punch(worker, "in"), 409, "already_clocked_in")
    assert len(my_attendance(worker, entry["assignment_id"])) == 1
    err(worker.req("POST", "/api/punches", {"kind": "out"}), 422, "validation", "Idempotency-Key")
    err(punch(worker, "out", key="k" * (KEY_MAX + 1)), 422, "validation", "Idempotency-Key")
    err(punch(worker, "sideways"), 422, "validation", "kind")
    assert worker.ok("GET", "/api/me/shifts")["open_attendance"]["id"] == att["id"]

    out = punch(worker, "out")
    assert out.status_code == 201, out.text
    closed = out.json()["attendance"]
    assert closed["id"] == att["id"] and closed["clock_out_at"]
    assert hours_match(closed["worked_hours"], secs(closed["clock_in_at"], closed["clock_out_at"]))
    err(punch(worker, "out"), 409, no_open_code(worker))
    err(punch(worker, "in"), 409, "no_rostered_shift")
    assert len(my_attendance(worker, entry["assignment_id"])) == 1

    now = server_now(hr)
    for pid in BANK:
        carer = Api(app_url, pid)
        windows = [(inst(a["starts_at"]) - timedelta(minutes=CLOCK_WINDOW_MIN), inst(a["ends_at"]))
                   for a in carer.ok("GET", "/api/me/shifts")["assignments"]]
        if all(not (a <= now <= b) for a, b in windows):
            count = len(carer.ok("GET", "/api/me/attendance")["items"])
            err(punch(carer, "in"), 409, "no_rostered_shift")
            assert len(carer.ok("GET", "/api/me/attendance")["items"]) == count
            break
    else:
        pytest.fail("every bank carer holds a current shift")


def test_punch_idempotency(app_url):
    hr = hr_api(app_url)
    worker, entry = current_candidate(app_url, hr)
    key = idempotency_key()
    first = punch(worker, "in", key)
    assert first.status_code == 201, first.text
    assert REPLAYED not in first.headers
    again = punch(worker, "in", key)
    assert again.status_code == 201 and again.content == first.content
    assert again.headers.get(REPLAYED) == "true"
    clients = [worker.fork() for _ in range(4)]
    results = together(*[lambda c=c: punch(c, "in", key) for c in clients])
    for r in results:
        assert r.status_code == 201 and r.content == first.content and r.headers.get(REPLAYED) == "true"
    rows = my_attendance(worker, entry["assignment_id"])
    assert len(rows) == 1 and rows[0]["id"] == first.json()["attendance"]["id"]
    err(punch(worker, "out", key), 409, "idempotency_key_reused")
    shifts = worker.ok("GET", "/api/me/shifts")
    assert shifts["open_attendance"]["id"] == rows[0]["id"] and shifts["open_attendance"]["clock_out_at"] is None
    assert punch(worker, "out").status_code == 201


def test_late_flag_and_acknowledge(app_url):
    hr = hr_api(app_url)
    fenella = Api(app_url, FENELLA)
    on_time = past_assignment(hr, "larchfield-rowan", range(1, 7))
    late = past_assignment(hr, "larchfield-willow", range(1, 7))
    start = inst(on_time["starts_at"])
    assert start.astimezone(LONDON).hour == SHIFT_HOURS[on_time["shift"]][0]
    a = hr.ok("POST", "/api/attendance", {"assignment_id": on_time["assignment_id"],
                                          "clock_in_at": london_iso(start + timedelta(minutes=LATE_GRACE_MIN)),
                                          "clock_out_at": None, "reason": "Edge of grace"}, status=201)
    assert a["late"] is False
    err(fenella.req("POST", f"/api/attendance/{a['id']}/acknowledge", {}), 409, "not_late")
    b = hr.ok("POST", "/api/attendance", {"assignment_id": late["assignment_id"],
                                          "clock_in_at": london_iso(inst(late["starts_at"]) + timedelta(minutes=LATE_GRACE_MIN + 1)),
                                          "clock_out_at": None, "reason": "Past grace"}, status=201)
    assert b["late"] is True and b["late_acknowledged"] is False and b["version"] == 1
    today = fenella.ok("GET", "/api/homes/larchfield/today")
    assert b["id"] in {x["id"] for x in today["late_clock_ins"]}
    assert a["id"] not in {x["id"] for x in today["late_clock_ins"]}
    acked = fenella.ok("POST", f"/api/attendance/{b['id']}/acknowledge", {})
    assert acked["late_acknowledged"] is True and acked["version"] == 2
    assert b["id"] not in {x["id"] for x in fenella.ok("GET", "/api/homes/larchfield/today")["late_clock_ins"]}


def test_dst_hours(app_url):
    hr = hr_api(app_url)
    october, march = date(2026, 10, 24), date(2027, 3, 27)
    for night, expected in ((october, 11), (march, 9)):
        entries = [e for unit in UNITS for e in rota_entries(hr, unit, night, night) if e["shift"] == "night" and e["date"] == night.isoformat()]
        if not entries:
            entries = [place_bank(hr, "larchfield-rowan", night, "night", list(BANK))[1]]
        for e in entries:
            assert Decimal(e["hours"]) == expected, e
            assert secs(e["starts_at"], e["ends_at"]) == expected * SECONDS_PER_HOUR
            assert inst(e["starts_at"]).astimezone(LONDON).hour == SHIFT_HOURS["night"][0]
    candidate = None
    for home, units in HOME_UNITS.items():
        taken = {a["assignment_id"] for a in attendance_on(hr, home, october)}
        for unit in units:
            for e in rota_entries(hr, unit, october, october):
                if e["shift"] == "night" and e["date"] == october.isoformat() and e["assignment_id"] not in taken:
                    candidate = e
    if candidate is None:
        candidate = place_bank(hr, "larchfield-rowan", october, "night", list(BANK))[1]
    att = hr.ok("POST", "/api/attendance", {"assignment_id": candidate["assignment_id"],
                                            "clock_in_at": "2026-10-24T22:00:00+01:00",
                                            "clock_out_at": "2026-10-25T08:00:00+00:00",
                                            "reason": "Night across the clock change"}, status=201)
    assert hours_match(att["worked_hours"], 11 * SECONDS_PER_HOUR)
    assert secs(att["rostered_start"], att["rostered_end"]) == 11 * SECONDS_PER_HOUR


def test_missed_clock_out(app_url):
    hr = hr_api(app_url)
    excluded: set = set()
    while True:
        e = past_assignment(hr, "larchfield-rowan", range(1, 6), exclude=excluded)
        worker = Api(app_url, e["person"]["id"])
        if worker.ok("GET", "/api/me/shifts")["open_attendance"] is None:
            break
        excluded.add(worker.id)
    att = hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"])),
                                            "clock_out_at": None, "reason": "Forgot to clock out"}, status=201)
    assert att["missed_clock_out"] is True and att["worked_hours"] is None and att["version"] == 1
    assert worker.ok("GET", "/api/me/shifts")["open_attendance"] is None
    err(punch(worker, "out"), 409, "clock_out_window_closed")
    clock_in = punch(worker, "in")
    assert not (clock_in.status_code == 409 and clock_in.json()["error"] == "already_clocked_in")
    if clock_in.status_code == 201:
        assert punch(worker, "out").status_code == 201
    listed = hr.ok("GET", "/api/homes/larchfield/today")["missed_clock_outs"]
    assert att["id"] in {x["id"] for x in listed}
    assert [x["rostered_start"] for x in listed] == sorted((x["rostered_start"] for x in listed), key=inst)

    keep = hr.req("PATCH", f"/api/attendance/{att['id']}", {"clock_in_at": att["clock_in_at"], "clock_out_at": None, "reason": "Still unknown"},
                  headers={"If-Match": '"1"'})
    assert keep.status_code == 200, keep.text
    assert keep.json()["missed_clock_out"] is True and keep.json()["version"] == 2
    out_at = inst(e["ends_at"])
    fixed = hr.ok("PATCH", f"/api/attendance/{att['id']}", {"clock_in_at": att["clock_in_at"], "clock_out_at": london_iso(out_at),
                                                            "reason": CORRECTION_NOTE}, headers={"If-Match": '"2"'})
    assert fixed["missed_clock_out"] is False and fixed["version"] == 3
    assert hours_match(fixed["worked_hours"], secs(att["clock_in_at"], london_iso(out_at)))
    assert fixed["correction_note"] == CORRECTION_NOTE
    assert att["id"] not in {x["id"] for x in hr.ok("GET", "/api/homes/larchfield/today")["missed_clock_outs"]}


def test_concurrent_punches_one_attendance(app_url):
    hr = hr_api(app_url)
    worker, entry = current_candidate(app_url, hr)
    clients = [worker.fork() for _ in range(4)]
    ins = together(*[lambda c=c: punch(c, "in") for c in clients])
    assert sorted(r.status_code for r in ins) == [201, 409, 409, 409], [r.text for r in ins]
    for r in ins:
        if r.status_code == 409:
            err(r, 409, "already_clocked_in")
    rows = my_attendance(worker, entry["assignment_id"])
    assert len(rows) == 1 and rows[0]["version"] == 1
    outs = together(*[lambda c=c: punch(c, "out") for c in clients])
    assert sorted(r.status_code for r in outs) == [201, 409, 409, 409], [r.text for r in outs]
    code = no_open_code(worker)
    for r in outs:
        if r.status_code == 409:
            err(r, 409, code)
    winner = next(r for r in outs if r.status_code == 201).json()["attendance"]
    assert winner["version"] == 2 and hours_match(winner["worked_hours"], secs(winner["clock_in_at"], winner["clock_out_at"]))
    assert my_attendance(worker, entry["assignment_id"])[0]["version"] == 2

    e = past_assignment(hr, "larchfield-willow", range(1, 7))
    body = {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"])),
            "clock_out_at": london_iso(inst(e["ends_at"])), "reason": "Added from paper sheet"}
    adders = [hr.fork(), hr.fork(), Api(app_url, FENELLA), Api(app_url, IDRIS)]
    adds = together(*[lambda c=c: c.req("POST", "/api/attendance", body) for c in adders])
    assert sorted(r.status_code for r in adds) == [201, 409, 409, 409], [r.text for r in adds]
    for r in adds:
        if r.status_code == 409:
            err(r, 409, "attendance_exists")
    added = next(r for r in adds if r.status_code == 201).json()
    entries = audit_for(hr, "larchfield", added["id"])
    assert [a["action"] for a in entries] == ["attendance_added"]


def test_concurrent_corrections(app_url):
    hr = hr_api(app_url)
    e = past_assignment(hr, "brackenmoor-heather", range(1, 7))
    att = hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"])),
                                            "clock_out_at": None, "reason": "Missed"}, status=201)
    start = inst(e["starts_at"])
    editors = [hr.fork(), hr.fork(), Api(app_url, OLUWASEUN), Api(app_url, "HV-0022")]
    calls = [lambda c=c, i=i: c.req("PATCH", f"/api/attendance/{att['id']}",
                                    {"clock_in_at": att["clock_in_at"], "clock_out_at": london_iso(start + timedelta(hours=6 + i)),
                                     "reason": f"Correction {i}"}, headers={"If-Match": '"1"'})
             for i, c in enumerate(editors)]
    results = together(*calls)
    assert sorted(r.status_code for r in results) == [200, 412, 412, 412], [r.text for r in results]
    winner = next(r for r in results if r.status_code == 200).json()
    assert winner["version"] == 2
    for r in results:
        if r.status_code == 412:
            assert err(r, 412, "stale_version")["current"] == winner
    corrected = [a for a in audit_for(hr, "brackenmoor", att["id"]) if a["action"] == "attendance_corrected"]
    assert len(corrected) == 1 and corrected[0]["reason"] == winner["correction_note"]
    err(hr.req("PATCH", f"/api/attendance/{att['id']}", {"clock_in_at": att["clock_in_at"], "clock_out_at": None, "reason": "No version"}),
        428, "version_required")
    stale = hr.req("PATCH", f"/api/attendance/{att['id']}", {"clock_in_at": att["clock_in_at"], "clock_out_at": None, "reason": "Old"},
                   headers={"If-Match": '"1"'})
    assert err(stale, 412, "stale_version")["current"]["version"] == 2
    bad = hr.req("PATCH", f"/api/attendance/{att['id']}", {"clock_in_at": att["clock_in_at"], "clock_out_at": london_iso(start - timedelta(hours=1)),
                                                          "reason": "Backwards"}, headers={"If-Match": '"2"'})
    assert err(bad, 422, "validation", "clock_out_at")["errors"]["clock_out_at"] == "Clock out must be after clock in."


def test_audit_append_only(app_url):
    hr = hr_api(app_url)
    me = hr.me()
    e = past_assignment(hr, "larchfield-rowan", range(1, 7))
    reason = "Paper sheet " + token()
    att = hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"])),
                                            "clock_out_at": london_iso(inst(e["ends_at"])), "reason": reason}, status=201)
    entries = audit_for(hr, "larchfield", att["id"])
    assert len(entries) == 1
    entry = entries[0]
    assert entry["action"] == "attendance_added" and entry["reason"] == reason and entry["before"] is None
    assert entry["actor"] == {"id": HR_ID, "display_name": me["display_name"], "role": "hr_admin"}
    assert entry["target"] == {"type": "attendance", "id": att["id"]} and entry["home_id"] == "larchfield"
    assert entry["after"]["id"] == att["id"] and entry["after"]["clock_out_at"]
    for method in ("PUT", "PATCH", "DELETE"):
        for path in (f"/api/audit/{entry['id']}", "/api/audit"):
            body = _NO if method == "DELETE" else {"reason": "tampered"}
            err(hr.req(method, path, body), 405, "method_not_allowed")
    assert audit_for(hr, "larchfield", att["id"]) == [entry]
    err(Api(app_url, "HV-0101").req("GET", "/api/audit", params={"home": "larchfield"}), 403, "forbidden")
    err(Api(app_url, FENELLA).req("GET", "/api/audit", params={"home": "brackenmoor"}), 404, "not_found")


def test_leave_transitions(app_url):
    hr = hr_api(app_url)
    grace = Api(app_url, "HV-0103")
    fenella = Api(app_url, FENELLA)
    s, e = find_window(hr, grace, 2, 100)
    a = make_leave(grace, s, e, submit=False, note="First draft")
    try:
        assert a["status"] == "draft"
        edited = grace.ok("PATCH", f"/api/leave-requests/{a['id']}", {"note": EDITED_NOTE})
        assert edited["status"] == "draft" and edited["note"] == EDITED_NOTE
        sub = grace.ok("POST", f"/api/leave-requests/{a['id']}/submit", {})
        assert sub["status"] == "submitted"

        def refused(r, status_now):
            body = err(r, 409, "invalid_transition")
            assert body["status"] == status_now
            now = grace.ok("GET", f"/api/leave-requests/{a['id']}")
            assert now["status"] == status_now and now["note"] == EDITED_NOTE
            return body

        body = refused(grace.req("PATCH", f"/api/leave-requests/{a['id']}", {"note": "Late edit"}), "submitted")
        status_label, action = "Submitted", "edited"
        assert body["message"] == f"This request is {status_label} and can't be {action}."
        refused(grace.req("PATCH", f"/api/leave-requests/{a['id']}", {"note": "Late edit", "hours": "0.00"}), "submitted")
        refused(grace.req("POST", f"/api/leave-requests/{a['id']}/submit", {}), "submitted")
        refused(hr.req("POST", f"/api/leave-requests/{a['id']}/cancel", {"reason": "Not approved yet"}), "submitted")
        declined = fenella.ok("POST", f"/api/leave-requests/{a['id']}/decline", {"reason": DECLINE_NOTE})
        assert declined["status"] == "declined" and declined["decision_reason"] == DECLINE_NOTE
        refused(fenella.req("POST", f"/api/leave-requests/{a['id']}/approve", {"override_reason": "Changed mind"}), "declined")
        refused(grace.req("POST", f"/api/leave-requests/{a['id']}/withdraw", {}), "declined")
        refused(fenella.req("POST", f"/api/leave-requests/{a['id']}/covers", {"date": s.isoformat(), "shift": "early", "skill": "carer"}), "declined")

        b = make_leave(grace, s, e, submit=False)
        assert grace.ok("POST", f"/api/leave-requests/{b['id']}/withdraw", {})["status"] == "withdrawn"
        err(grace.req("POST", f"/api/leave-requests/{b['id']}/submit", {}), 409, "invalid_transition")
        assert grace.ok("GET", f"/api/leave-requests/{b['id']}")["status"] == "withdrawn"
        femi = Api(app_url, FEMI)
        err(femi.req("POST", "/api/leave-requests", {"type": "unpaid", "start_date": s.isoformat(), "end_date": e.isoformat()}), 403, "forbidden")
    finally:
        finish(hr, grace, a["id"])


def test_short_notice(app_url):
    hr = hr_api(app_url)
    luis = Api(app_url, "HV-0122")
    today = today_of(hr)
    versions = hr.ok("GET", "/api/homes/larchfield/leave-policy")["versions"]
    multiplier = max((v for v in versions if v["effective_from"] <= today.isoformat()), key=lambda v: v["effective_from"])["notice_multiplier"]
    length = 3
    ids = []
    try:
        for lead, short in ((multiplier * length, False), (multiplier * length - 1, True)):
            s = today + timedelta(days=lead)
            req = make_leave(luis, s, s + timedelta(days=length - 1))
            ids.append(req["id"])
            assert req["status"] == "submitted" and req["short_notice"] is short, (lead, req)
            assert luis.ok("GET", f"/api/leave-requests/{req['id']}")["short_notice"] is short
            luis.ok("POST", f"/api/leave-requests/{req['id']}/withdraw", {})
        past = luis.req("POST", "/api/leave-requests", {"type": "unpaid", "start_date": (today - timedelta(days=1)).isoformat(),
                                                        "end_date": today.isoformat()})
        assert err(past, 422, "validation", "start_date")["errors"]["start_date"] == "Leave can't start in the past."
    finally:
        for rid in ids:
            finish(hr, luis, rid)


def test_leave_hours_and_balance(app_url):
    hr = hr_api(app_url)
    bilal = Api(app_url, "HV-0111")
    s, e = find_window(hr, bilal, 3, 30, unit="larchfield-rowan", shift="night")
    mine = [x for x in rota_entries(hr, "larchfield-rowan", s, e) if x["person"]["id"] == "HV-0111"]
    expected = sum(Decimal(x["hours"]) for x in mine)
    req = make_leave(bilal, s, e)
    middle = next(x for x in mine if x["date"] == (s + timedelta(days=1)).isoformat())
    readded = None
    drafts = []
    try:
        assert Decimal(req["hours"]) == expected
        hr.ok("DELETE", f"/api/rota/assignments/{middle['assignment_id']}", status=204)
        assert Decimal(bilal.ok("GET", f"/api/leave-requests/{req['id']}")["hours"]) == expected
        bilal.ok("POST", f"/api/leave-requests/{req['id']}/withdraw", {})
        draft = make_leave(bilal, s, e, submit=False)
        drafts.append(draft["id"])
        assert Decimal(draft["hours"]) == expected - Decimal(middle["hours"])
        readded = hr.ok("POST", "/api/rota/assignments", {"person_id": "HV-0111", "unit_id": "larchfield-rowan",
                                                          "date": middle["date"], "shift": "night"}, status=201)
        again = bilal.ok("PATCH", f"/api/leave-requests/{draft['id']}", {"note": "Rota changed"})
        assert Decimal(again["hours"]) == expected
    finally:
        finish(hr, bilal, req["id"])
        for d in drafts:
            finish(hr, bilal, d)
        if readded is None:
            with contextlib.suppress(Exception):
                hr.req("POST", "/api/rota/assignments", {"person_id": "HV-0111", "unit_id": "larchfield-rowan", "date": middle["date"], "shift": "night"})

    kwame = None
    for pid in ("HV-0104", "HV-0107", "HV-0108", "HV-0125", "HV-0126"):
        candidate = Api(app_url, pid)
        sick = [(date.fromisoformat(x["start_date"]), date.fromisoformat(x["last_sick_date"]) if x["last_sick_date"] else None)
                for x in candidate.ok("GET", "/api/me/sickness")["items"]]
        s, e = find_window(hr, candidate, MAX_LEAVE_DAYS, 40)

        def sick_covered(day, sick=sick):
            return any(a <= day and (b is None or day <= b) for a, b in sick)

        cost = sum(Decimal(x["hours"]) for x in rota_entries(hr, CARE[pid][1], s, e)
                   if x["person"]["id"] == pid and not sick_covered(date.fromisoformat(x["date"])))
        remaining = Decimal(candidate.me()["holiday"]["remaining_hours"])
        if cost > remaining:
            kwame = candidate
            break
    assert kwame, "no care worker has a window costing more than the balance"
    before = {i["id"] for i in kwame.ok("GET", "/api/me/leave-requests")["items"]}
    r = kwame.req("POST", "/api/leave-requests", {"type": "annual", "start_date": s.isoformat(), "end_date": e.isoformat(), "submit": True})
    body = err(r, 422, "validation", "end_date")
    assert body["errors"]["end_date"] == f"This needs {cost:.2f} hours but you have {remaining:.2f} hours left."
    assert {i["id"] for i in kwame.ok("GET", "/api/me/leave-requests")["items"]} == before
    too_long = kwame.req("POST", "/api/leave-requests", {"type": "unpaid", "start_date": s.isoformat(),
                                                         "end_date": (s + timedelta(days=MAX_LEAVE_DAYS)).isoformat()})
    assert err(too_long, 422, "validation", "end_date")["errors"]["end_date"] == "Leave can be at most 28 days."
    backwards = kwame.req("POST", "/api/leave-requests", {"type": "unpaid", "start_date": s.isoformat(), "end_date": (s - timedelta(days=1)).isoformat()})
    assert err(backwards, 422, "validation", "end_date")["errors"]["end_date"] == "The last day can't be before the first day."
    march = date(leave_year(s) + 1, 3, 31)
    cross = kwame.req("POST", "/api/leave-requests", {"type": "unpaid", "start_date": march.isoformat(), "end_date": (march + timedelta(days=1)).isoformat()})
    assert err(cross, 422, "validation", "end_date")["errors"]["end_date"] == "Leave can't cross 31 March. Split it into two requests."


def test_withdraw_and_cancel(app_url):
    hr = hr_api(app_url)
    fenella = Api(app_url, FENELLA)
    idris = Api(app_url, IDRIS)
    today = today_of(hr)
    assert not any(a <= today <= b for a, b in active_ranges(fenella)), "Fenella already has leave today"
    started = make_leave(fenella, today, today, kind="annual")
    later = None
    try:
        assert Decimal(started["hours"]) == 0 and started["unit_id"] is None
        assert idris.ok("POST", f"/api/leave-requests/{started['id']}/approve", {})["status"] == "approved"
        err(fenella.req("POST", f"/api/leave-requests/{started['id']}/withdraw", {}), 409, "already_started")
        err(fenella.req("POST", f"/api/leave-requests/{started['id']}/cancel", {"reason": OWN_CANCEL}), 403, "forbidden")
        bad = hr.req("POST", f"/api/leave-requests/{started['id']}/cancel", {"reason": ""})
        assert err(bad, 422, "validation", "reason")["errors"]["reason"] == "Give a reason of 1 to 500 characters."
        assert fenella.ok("GET", f"/api/leave-requests/{started['id']}")["status"] == "approved"
        cancelled = hr.ok("POST", f"/api/leave-requests/{started['id']}/cancel", {"reason": CANCEL_REASON})
        assert cancelled["status"] == "cancelled" and cancelled["decision_reason"] == CANCEL_REASON
        audit = audit_for(hr, "larchfield", started["id"])
        assert [x["action"] for x in audit] == ["leave_cancelled"] and audit[0]["reason"] == CANCEL_REASON

        s, e = find_window(hr, fenella, 1, 20)
        later = make_leave(fenella, s, e)
        idris.ok("POST", f"/api/leave-requests/{later['id']}/approve", {})
        assert fenella.ok("POST", f"/api/leave-requests/{later['id']}/withdraw", {})["status"] == "withdrawn"
    finally:
        finish(hr, fenella, started["id"])
        if later:
            finish(hr, fenella, later["id"])


def test_own_records_only(app_url):
    hr = hr_api(app_url)
    priya = Api(app_url, "HV-0101")
    grace = Api(app_url, "HV-0103")
    today = today_of(hr)
    s, e = find_window(hr, priya, 1, 110)
    req = make_leave(priya, s, e, submit=False)
    try:
        err(grace.req("GET", f"/api/leave-requests/{req['id']}"), 404, "not_found")
        err(grace.req("POST", f"/api/leave-requests/{req['id']}/withdraw", {}), 404, "not_found")
        err(grace.req("PATCH", f"/api/leave-requests/{req['id']}", {"note": "mine now"}), 404, "not_found")
        err(Api(app_url, OLUWASEUN).req("GET", f"/api/leave-requests/{req['id']}"), 404, "not_found")
        assert priya.ok("GET", f"/api/leave-requests/{req['id']}")["note"] == req["note"]
    finally:
        finish(hr, priya, req["id"])
    start = today - timedelta(days=SICK_BACK_DAYS - 3)
    sick = report_sickness(priya, start, "Private reason " + token())
    try:
        assert upload(priya, sick["id"], pdf_bytes(), "note.pdf").status_code == 201
        err(grace.req("GET", f"/api/sickness/{sick['id']}"), 404, "not_found")
        err(grace.req("GET", f"/api/sickness/{sick['id']}/fit-note"), 404, "not_found")
        err(upload(grace, sick["id"], pdf_bytes(), "mine.pdf"), 404, "not_found")
        err(grace.req("POST", f"/api/sickness/{sick['id']}/return", {"last_sick_date": start.isoformat()}), 404, "not_found")
        assert sick["id"] not in {x["id"] for x in grace.ok("GET", "/api/me/sickness")["items"]}
        link = poll(lambda: (r := hr.req("GET", f"/api/sickness/{sick['id']}/fit-note")).status_code == 200 and r.json(),
                    STORAGE_DEADLINE_S, "fit-note link")
        assert link["expires_in_seconds"] == LINK_SECONDS
    finally:
        priya.req("POST", f"/api/sickness/{sick['id']}/return", {"last_sick_date": start.isoformat()})


def test_sick_days_return_holiday(app_url):
    hr = hr_api(app_url)
    today = today_of(hr)
    end = today + timedelta(days=2)
    pick = None
    for pid in ("HV-0102", "HV-0103", "HV-0104", "HV-0122", "HV-0123", "HV-0212", "HV-0213"):
        worker = Api(app_url, pid)
        sick_today = any(date.fromisoformat(x["start_date"]) <= today and (x["last_sick_date"] is None or date.fromisoformat(x["last_sick_date"]) >= today)
                         for x in worker.ok("GET", "/api/me/sickness")["items"])
        if not sick_today and not any(a <= end and today <= b for a, b in active_ranges(worker)):
            pick = worker
            break
    assert pick, "no contracted early worker free today"
    unit = CARE[pick.id][1]
    mine = [x for x in rota_entries(hr, unit, today, end) if x["person"]["id"] == pick.id]
    hours = sum(Decimal(x["hours"]) for x in mine)
    today_hours = sum(Decimal(x["hours"]) for x in mine if x["date"] == today.isoformat())

    def balance():
        a = pick.me()["holiday"]
        b = pick.ok("GET", "/api/me/shifts")["holiday"]
        assert a == b
        return Decimal(a["remaining_hours"])

    start_balance = balance()
    req = make_leave(pick, today, end, kind="annual")
    sick = None
    try:
        assert Decimal(req["hours"]) == hours and Decimal(req["sickness_hours"]) == 0
        assert balance() == start_balance - hours
        hr.ok("POST", f"/api/leave-requests/{req['id']}/approve", {"override_reason": "Agreed before the rota change"})
        assert balance() == start_balance - hours
        sick = report_sickness(pick, today)
        assert Decimal(pick.ok("GET", f"/api/leave-requests/{req['id']}")["sickness_hours"]) == hours
        assert balance() == start_balance
        kinds = {x["date"]: x.get("absence_kind") for x in rota_entries(hr, unit, today, end) if x["person"]["id"] == pick.id}
        assert set(kinds.values()) == {"sickness"}
        pick.ok("POST", f"/api/sickness/{sick['id']}/return", {"last_sick_date": today.isoformat()})
        assert Decimal(pick.ok("GET", f"/api/leave-requests/{req['id']}")["sickness_hours"]) == today_hours
        remaining = balance()
        assert remaining == start_balance - (hours - today_hours)
        cache: dict = {}
        for k in range(3, SCAN_DAYS):
            s = today + timedelta(days=k)
            for length in range(1, MAX_LEAVE_DAYS + 1):
                f = s + timedelta(days=length - 1)
                cost = sum(Decimal(x["hours"]) for x in rota_entries(hr, unit, s, f, cache) if x["person"]["id"] == pick.id)
                if cost > remaining and leave_year(s) == leave_year(f) and not any(s <= b and a <= f for a, b in active_ranges(pick)):
                    r = pick.req("POST", "/api/leave-requests", {"type": "annual", "start_date": s.isoformat(), "end_date": f.isoformat(), "submit": True})
                    assert err(r, 422, "validation", "end_date")["errors"]["end_date"] == f"This needs {cost:.2f} hours but you have {remaining:.2f} hours left."
                    return
        pytest.fail("no window costing more than the balance")
    finally:
        finish(hr, pick, req["id"])
        if sick:
            pick.req("POST", f"/api/sickness/{sick['id']}/return", {"last_sick_date": today.isoformat()})


MASS_CASES = ["leave_create", "me_patch", "sickness_report", "floor_version", "leave_policy", "submit", "decline"]


def test_published_fields_only(app_url):
    hr = hr_api(app_url)
    nia = Api(app_url, "HV-0123")
    fenella = Api(app_url, FENELLA)
    today = today_of(hr)
    s, e = find_window(hr, nia, 1, 130)

    def forged(r, keys):
        body = err(r, 422, "validation")
        for k in keys:
            assert body["errors"][k] == UNKNOWN_FIELD, body
        return body

    for case in MASS_CASES:
        if case == "leave_create":
            before = {i["id"] for i in nia.ok("GET", "/api/me/leave-requests")["items"]}
            keys = {"status": "approved", "hours": "0.00", "short_notice": False, "requester": HR_ID, "unit_id": "larchfield-rowan", "sickness_hours": "0.00"}
            forged(nia.req("POST", "/api/leave-requests", {"type": "unpaid", "start_date": s.isoformat(), "end_date": e.isoformat(), **keys}), keys)
            assert {i["id"] for i in nia.ok("GET", "/api/me/leave-requests")["items"]} == before
        elif case == "me_patch":
            me = nia.me()
            forged(nia.req("PATCH", "/api/me", {"display_name": "P", "role": "hr_admin"}), ["role"])
            after = nia.me()
            assert after["display_name"] == me["display_name"] and after["role"] == "care_worker"
        elif case == "sickness_report":
            before = {i["id"] for i in nia.ok("GET", "/api/me/sickness")["items"]}
            forged(nia.req("POST", "/api/sickness", {"start_date": today.isoformat(), "reason": "Cold", "status": "closed"}), ["status"])
            assert {i["id"] for i in nia.ok("GET", "/api/me/sickness")["items"]} == before
        elif case == "floor_version":
            existing = {v["effective_from"] for v in hr.ok("GET", "/api/homes/brackenmoor/floors")["versions"]}
            d = free_far_date(existing)
            forged(hr.req("POST", "/api/homes/brackenmoor/floors", {"unit_id": "brackenmoor-heather", "shift": "late", "min_staff": 3, "min_seniors": 1,
                                                                    "effective_from": d.isoformat(), "created_by": "HV-0101"}), ["created_by"])
            assert d.isoformat() not in {v["effective_from"] for v in hr.ok("GET", "/api/homes/brackenmoor/floors")["versions"]}
        elif case == "leave_policy":
            existing = {v["effective_from"] for v in hr.ok("GET", "/api/homes/brackenmoor/leave-policy")["versions"]}
            d = free_far_date(existing)
            forged(hr.req("POST", "/api/homes/brackenmoor/leave-policy", {"notice_multiplier": 2, "effective_from": d.isoformat(), "id": "forged"}), ["id"])
            assert d.isoformat() not in {v["effective_from"] for v in hr.ok("GET", "/api/homes/brackenmoor/leave-policy")["versions"]}
        elif case == "submit":
            draft = make_leave(nia, s, e, submit=False)
            try:
                forged(nia.req("POST", f"/api/leave-requests/{draft['id']}/submit", {"short_notice": False}), ["short_notice"])
                assert nia.ok("GET", f"/api/leave-requests/{draft['id']}")["status"] == "draft"
            finally:
                finish(hr, nia, draft["id"])
        elif case == "decline":
            req = make_leave(nia, s, e)
            try:
                forged(fenella.req("POST", f"/api/leave-requests/{req['id']}/decline", {"reason": "No", "status": "approved"}), ["status"])
                assert nia.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "submitted"
            finally:
                finish(hr, nia, req["id"])


def test_rota_projection_per_role(app_url):
    hr = hr_api(app_url)
    luis = Api(app_url, "HV-0122")
    nia = Api(app_url, "HV-0123")
    today = today_of(hr)
    s, e = find_window(hr, luis, 1, 25, unit="larchfield-willow", shift="early")
    req = make_leave(luis, s, e)
    sick = None
    try:
        hr.ok("POST", f"/api/leave-requests/{req['id']}/approve", {"override_reason": "Family event"})

        def row(api):
            return next(x for x in rota_entries(api, "larchfield-willow", s, s) if x["person"]["id"] == "HV-0122" and x["shift"] == "early")

        cw = row(nia)
        assert set(cw) == CW_ROTA_KEYS and set(cw["person"]) == {"id", "display_name"}
        assert cw["status"] == "away" and cw["is_you"] is False
        mgr = row(Api(app_url, FENELLA))
        assert set(mgr) == CW_ROTA_KEYS | {"absence_kind"} and mgr["absence_kind"] == "unpaid"
        sick = report_sickness(luis, today, "Migraine " + token())
        assert row(hr)["absence_kind"] == "sickness"
        whole = nia.ok("GET", "/api/units/larchfield-willow/rota", params={"from": monday(s).isoformat()})
        raw = json.dumps(whole)
        assert "absence_kind" not in raw and sick["reason"] not in raw and "remaining_hours" not in raw and MAIL_DOMAIN not in raw
        mine = [x for x in whole["entries"] if x["person"]["id"] == "HV-0123"]
        assert mine and all(x["is_you"] for x in mine)
        luis.ok("POST", f"/api/sickness/{sick['id']}/return", {"last_sick_date": today.isoformat()})
        sick = None
        assert row(hr)["absence_kind"] == "unpaid"
        other = next(x for x in rota_entries(hr, "larchfield-willow", s - timedelta(days=1), s - timedelta(days=1)) if x["person"]["id"] == "HV-0122")
        assert other["absence_kind"] is None or other["status"] == "away"
    finally:
        finish(hr, luis, req["id"])
        if sick:
            luis.req("POST", f"/api/sickness/{sick['id']}/return", {"last_sick_date": today.isoformat()})


def test_removed_assignment_gone(app_url):
    hr = hr_api(app_url)
    today = today_of(hr)

    worker, entry = current_candidate(app_url, hr)
    pid, unit, shift = worker.id, CARE[worker.id][1], entry["shift"]
    day = date.fromisoformat(entry["date"])
    viewer = Api(app_url, next(p for p in sorted(SEED_SHIFT[unit]["early"] | SEED_SHIFT[unit]["late"]) if p != pid))
    readded = None
    try:
        hr.ok("DELETE", f"/api/rota/assignments/{entry['assignment_id']}", status=204)
        assert entry["assignment_id"] not in {x["assignment_id"] for x in rota_entries(viewer, unit, day, day)}
        assert not any(x["shift"] == shift for x in rota_entries(hr, unit, day, day) if x["person"]["id"] == pid)
        assert entry["assignment_id"] not in {x["assignment_id"] for x in worker.ok("GET", "/api/me/shifts")["assignments"]}
        err(punch(worker, "in"), 409, "no_rostered_shift")
        err(hr.req("DELETE", f"/api/rota/assignments/{entry['assignment_id']}"), 404, "not_found")
        readded = hr.ok("POST", "/api/rota/assignments", {"person_id": pid, "unit_id": unit, "date": day.isoformat(), "shift": shift}, status=201)
        assert readded["assignment_id"] != entry["assignment_id"]
    finally:
        if readded is None:
            with contextlib.suppress(Exception):
                add_assignment(hr, pid, unit, day, shift)

    rowan = "larchfield-rowan"
    taken = {a["assignment_id"] for a in attendance_on(hr, "larchfield", today)}
    rows = [x for x in rota_entries(hr, rowan, today, today)
            if x["date"] == today.isoformat() and x["status"] == "on" and x["assignment_id"] not in taken]
    pick = None
    for sh in ("late", "early", "night"):
        free = [p for p in sorted(SEED_SHIFT[rowan][sh] - {pid}) if not any(a <= today <= b for a, b in active_ranges(Api(app_url, p)))]
        mine = {x["person"]["id"]: x for x in rows if x["shift"] == sh}
        target = next((p for p in free if p in mine), None)
        other = next((p for p in free if p != target), None)
        if target and other:
            pick = (Api(app_url, target), mine[target], Api(app_url, other))
            break
    assert pick, "no free Rowan shift today"
    tworker, tentry, colleague = pick
    tshift = tentry["shift"]
    col_req = make_leave(colleague, today, today)
    draft = None
    back = None

    def today_count():
        units = hr.ok("GET", "/api/homes/larchfield/today")["units"]
        return next(s["on_duty"] for u in units if u["unit_id"] == rowan for s in u["shifts"] if s["shift"] == tshift)

    try:
        before_today = today_count()
        before_preview = shift_of(preview(hr, col_req["id"]), today, tshift)["on_duty"]
        hr.ok("DELETE", f"/api/rota/assignments/{tentry['assignment_id']}", status=204)
        assert today_count() == before_today - 1
        assert shift_of(preview(hr, col_req["id"]), today, tshift)["on_duty"] == before_preview - 1
        draft = make_leave(tworker, today, today, submit=False)
        assert Decimal(draft["hours"]) == 0
        back = hr.ok("POST", "/api/rota/assignments", {"person_id": tworker.id, "unit_id": rowan, "date": today.isoformat(), "shift": tshift}, status=201)
        assert back["assignment_id"] != tentry["assignment_id"]
        assert today_count() == before_today
        assert Decimal(tworker.ok("PATCH", f"/api/leave-requests/{draft['id']}", {"note": "Rota fixed"})["hours"]) == Decimal(tentry["hours"])

        e = past_assignment(hr, "larchfield-willow", range(1, 7))
        hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"])),
                                          "clock_out_at": london_iso(inst(e["ends_at"])), "reason": "Worked"}, status=201)
        err(hr.req("DELETE", f"/api/rota/assignments/{e['assignment_id']}"), 409, "has_attendance")
        assert e["assignment_id"] in {x["assignment_id"] for x in rota_entries(hr, "larchfield-willow", date.fromisoformat(e["date"]), date.fromisoformat(e["date"]))}
        err(hr.req("POST", "/api/rota/assignments", {"person_id": FENELLA, "unit_id": rowan, "date": today.isoformat(), "shift": "late"}),
            422, "validation", "person_id")
    finally:
        finish(hr, colleague, col_req["id"])
        if draft:
            finish(hr, tworker, draft["id"])
        if back is None:
            with contextlib.suppress(Exception):
                add_assignment(hr, tworker.id, rowan, today, tshift)


def cover_request(app_url, hr, owner_id, offset, free=(), days=1):
    owner = Api(app_url, owner_id)
    unit, shift = CARE[owner_id][1], CARE[owner_id][2]
    s, e = find_window(hr, owner, days, offset, unit=unit, shift=shift, free=free)
    return owner, make_leave(owner, s, e), s, e, unit, shift


def test_removed_claim_cancels_cover(app_url):
    hr = hr_api(app_url)
    fenella = Api(app_url, FENELLA)
    owner, req, s, _, unit, shift = cover_request(app_url, hr, "HV-0102", 35, free=(CARYS, MATEUSZ))
    carys, mateusz = Api(app_url, CARYS), Api(app_url, MATEUSZ)
    try:
        cover = fenella.ok("POST", f"/api/leave-requests/{req['id']}/covers", {"date": s.isoformat(), "shift": shift, "skill": "carer"}, status=201)
        won = claim(carys, cover["id"])
        assert won.status_code == 200, won.text
        assignment = won.json()["assignment"]
        pv = preview(fenella, req["id"])
        assert pv["uncovered_breaches"] == 0
        fenella.ok("DELETE", f"/api/rota/assignments/{assignment['assignment_id']}", status=204)
        err(claim(mateusz, cover["id"]), 409, "cover_closed")
        assert cover["id"] not in {c["id"] for c in mateusz.ok("GET", "/api/cover-shifts")["items"]}
        assert assignment["assignment_id"] not in {x["assignment_id"] for x in rota_entries(hr, unit, s, s)}
        pv = preview(fenella, req["id"])
        cell = shift_of(pv, s, shift)
        assert cell["gaps"] and all(g["cover"] is None for g in cell["gaps"])
        assert pv["uncovered_breaches"] >= 1 and short_label(s, shift) in pv["breach_labels"]
        fresh = fenella.ok("POST", f"/api/leave-requests/{req['id']}/covers", {"date": s.isoformat(), "shift": shift, "skill": "carer"}, status=201)
        assert fresh["id"] != cover["id"] and fresh["status"] == "open"
    finally:
        finish(hr, owner, req["id"])


def test_rename_propagation(app_url, mail):
    hr = hr_api(app_url)
    grace, idris, tom = Api(app_url, "HV-0103"), Api(app_url, IDRIS), Api(app_url, "HV-0102")
    old_grace, old_idris = name_of(grace), name_of(idris)
    new_grace, new_idris = f"Grace {token()}", f"Idris {token()}"
    s, e = find_window(hr, grace, 1, 140)
    s2, e2 = find_window(hr, grace, 1, 145)
    live = make_leave(grace, s, e)
    decided = make_leave(grace, s2, e2) if s2 != s else None
    att_entry = past_assignment(hr, "larchfield-rowan", range(1, 20), exclude=set(CARE) - {"HV-0103"})
    att = idris.ok("POST", "/api/attendance", {"assignment_id": att_entry["assignment_id"], "clock_in_at": london_iso(inst(att_entry["starts_at"])),
                                               "clock_out_at": london_iso(inst(att_entry["ends_at"])), "reason": "Paper sheet"}, status=201)
    period = att_entry["date"][:7]
    old_export = hr.ok("POST", "/api/exports/timesheets", {"period": period, "home_ids": ["larchfield"]}, status=201)
    before = mail_ids(mail)
    try:
        if decided:
            idris.ok("POST", f"/api/leave-requests/{decided['id']}/decline", {"reason": "Busy week"})
            queued = mail_wait(mail, before, lambda m: email_of("HV-0103") in rcpts(m) and long_date(s2) in m.get("Subject", ""))
            assert queued
        rename(grace, new_grace)
        rename(idris, new_idris)
        d = date.fromisoformat(att_entry["date"])
        rota = [x for x in rota_entries(tom, "larchfield-rowan", today_of(hr), today_of(hr) + timedelta(days=6)) if x["person"]["id"] == "HV-0103"]
        assert rota and all(x["person"]["display_name"] == new_grace for x in rota)
        assert "HV-0103" in {p["id"] for p in Api(app_url, FENELLA).ok("GET", "/api/homes/larchfield/people", params={"q": new_grace})["items"]}
        assert "HV-0103" not in {p["id"] for p in Api(app_url, FENELLA).ok("GET", "/api/homes/larchfield/people", params={"q": old_grace})["items"]}
        items = Api(app_url, FENELLA).ok("GET", "/api/queue", params={"home": "larchfield", "status": "open", "week": iso_week(s)})["items"]
        assert next(i for i in items if i["id"] == live["id"])["requester"]["display_name"] == new_grace
        if decided:
            assert grace.ok("GET", f"/api/leave-requests/{decided['id']}")["decided_by"]["display_name"] == new_idris
        assert next(a for a in attendance_on(hr, "larchfield", d) if a["id"] == att["id"])["person"]["display_name"] == new_grace
        entry = next(a for a in audit_for(hr, "larchfield", att["id"]) if a["action"] == "attendance_added")
        assert entry["actor"]["display_name"] == old_idris and entry["after"]["person"]["display_name"] == old_grace

        def csv_for(export):
            url = poll(lambda: (r := hr.req("GET", f"/api/exports/{export['id']}/download")).status_code == 200 and r.json()["url"], STORAGE_DEADLINE_S, "export")
            return httpx.get(url, timeout=HTTP_TIMEOUT).content.decode("utf-8")

        old_rows = [r for r in csv.DictReader(io.StringIO(csv_for(old_export))) if r["staff_number"] == "HV-0103" and r["shift_date"] == att_entry["date"]]
        assert old_rows and all(r["display_name"] == old_grace for r in old_rows)
        new_export = hr.ok("POST", "/api/exports/timesheets", {"period": period, "home_ids": ["larchfield"]}, status=201)
        new_rows = [r for r in csv.DictReader(io.StringIO(csv_for(new_export))) if r["staff_number"] == "HV-0103" and r["shift_date"] == att_entry["date"]]
        assert new_rows and all(r["display_name"] == new_grace for r in new_rows)
        if decided:
            sent = mail_wait(mail, before, lambda m: email_of("HV-0103") in rcpts(m) and long_date(s2) in m.get("Subject", ""))
            assert sent and all(new_idris not in body_of(m) for m in sent)
    finally:
        rename(grace, old_grace)
        rename(idris, old_idris)
        finish(hr, grace, live["id"])
        if decided:
            finish(hr, grace, decided["id"])


def test_fit_note_required_and_return(app_url):
    hr = hr_api(app_url)
    amara = Api(app_url, "HV-0213")
    today = today_of(hr)
    long_start = today - timedelta(days=FIT_NOTE_DAYS + 1)
    rec = report_sickness(amara, long_start)
    got = amara.ok("GET", f"/api/sickness/{rec['id']}")
    assert got["status"] == "fit_note_required" and got["days"] == FIT_NOTE_DAYS + 2
    err(amara.req("POST", f"/api/sickness/{rec['id']}/return", {"last_sick_date": today.isoformat()}), 409, "fit_note_missing")
    still = amara.ok("GET", f"/api/sickness/{rec['id']}")
    assert still["status"] == "fit_note_required" and still["last_sick_date"] is None
    closed = amara.ok("POST", f"/api/sickness/{rec['id']}/return", {"last_sick_date": (long_start + timedelta(days=FIT_NOTE_DAYS - 1)).isoformat()})
    assert closed["status"] == "closed" and closed["days"] == FIT_NOTE_DAYS

    short = report_sickness(amara, today - timedelta(days=3))
    assert amara.ok("GET", f"/api/sickness/{short['id']}")["status"] == "reported"
    bad = amara.req("POST", f"/api/sickness/{short['id']}/return", {"last_sick_date": (today - timedelta(days=4)).isoformat()})
    assert err(bad, 422, "validation", "last_sick_date")["errors"]["last_sick_date"] == "The last day off sick must be between the first day and today."
    assert amara.ok("POST", f"/api/sickness/{short['id']}/return", {"last_sick_date": today.isoformat()})["status"] == "closed"
    err(amara.req("POST", f"/api/sickness/{short['id']}/return", {"last_sick_date": today.isoformat()}), 409, "invalid_transition")
    err(upload(amara, short["id"], pdf_bytes(), "late.pdf"), 409, "invalid_transition")

    evidenced = report_sickness(amara, today - timedelta(days=FIT_NOTE_DAYS + 3))
    assert upload(amara, evidenced["id"], pdf_bytes(), "note.pdf").json()["status"] == "evidenced"
    assert amara.ok("POST", f"/api/sickness/{evidenced['id']}/return", {"last_sick_date": today.isoformat()})["status"] == "closed"
    for bad_start in (today - timedelta(days=SICK_BACK_DAYS + 1), today + timedelta(days=1)):
        r = amara.req("POST", "/api/sickness", {"start_date": bad_start.isoformat(), "reason": "Cold"})
        assert err(r, 422, "validation", "start_date")["errors"]["start_date"] == "Sickness can start up to 28 days ago and not in the future."
    r = amara.req("POST", "/api/sickness", {"start_date": today.isoformat(), "reason": ""})
    assert err(r, 422, "validation", "reason")["errors"]["reason"] == "Give a reason of 1 to 500 characters."


UPLOAD_CASES = {
    "pdf": (pdf_bytes(), "note.pdf", "note.pdf", 201, "application/pdf", "pdf"),
    "png_named_pdf": (PNG_BYTES, "scan.pdf", "scan.pdf", 201, "image/png", "png"),
    "jpeg_named_png": (JPEG_BYTES, "photo.png", "photo.png", 201, "image/jpeg", "jpg"),
    "exact_limit": (pdf_bytes(FIT_NOTE_LIMIT), "big.pdf", "big.pdf", 201, "application/pdf", "pdf"),
    "over_limit": (pdf_bytes(FIT_NOTE_LIMIT + 1), "huge.pdf", None, 413, "too_large", None),
    "svg": (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "note.svg", None, 415, "unsupported_file", None),
    "html_named_pdf": (b"<html><body>%PDF-</body></html>", "note.pdf", None, 415, "unsupported_file", None),
    "pdf_without_eof": (b"%PDF-1.4\n1 0 obj << >> endobj\n", "cut.pdf", None, 415, "unsupported_file", None),
    "traversal_name": (pdf_bytes(), TRAVERSAL_NAME, KEPT_NAME, 201, "application/pdf", "pdf"),
}


UPLOAD_IDS = ["pdf", "png_named_pdf", "jpeg_named_png", "exact_limit", "over_limit", "svg", "html_named_pdf", "pdf_without_eof", "traversal_name"]


@pytest.mark.parametrize("case", UPLOAD_IDS, ids=UPLOAD_IDS)
def test_fit_note_upload_checks(app_url, case):
    data, name, kept, status, detected, ext = UPLOAD_CASES[case]
    hr = hr_api(app_url)
    rhys = Api(app_url, "HV-0212")
    start = today_of(hr) - timedelta(days=SICK_BACK_DAYS - 1)
    rec = report_sickness(rhys, start)
    store = S3()
    prefix = f"fit-notes/brackenmoor/{rec['id']}/"
    try:
        r = upload(rhys, rec["id"], data, name)
        if status == 201:
            assert r.status_code == 201, r.text
            body = r.json()
            assert body["status"] == "evidenced"
            assert body["fit_note"]["file_name"] == kept
            keys = poll(lambda: store.keys(prefix), STORAGE_DEADLINE_S, "stored fit note")
            assert len(keys) == 1
            assert re.fullmatch(rf"{re.escape(prefix)}[^/]+\.{ext}", keys[0]), keys
            last = keys[0].rsplit("/", 1)[1].lower()
            stem = kept.rsplit(".", 1)[0].lower()
            for word in re.split(r"\W+", stem):
                if len(word) > 3:
                    assert word not in last, (word, keys[0])
            assert store.get(keys[0]) == data
            link = rhys.ok("GET", f"/api/sickness/{rec['id']}/fit-note")["url"]
            assert httpx.get(link, timeout=HTTP_TIMEOUT).headers["content-type"] == detected
        else:
            err(r, status, detected)
            if detected == "unsupported_file":
                assert r.json()["errors"]["file"] == MESSAGES["unsupported_file"]
            assert rhys.ok("GET", f"/api/sickness/{rec['id']}")["fit_note"] is None
            assert store.keys(prefix) == []
    finally:
        rhys.req("POST", f"/api/sickness/{rec['id']}/return", {"last_sick_date": start.isoformat()})


def test_fit_note_signed_link(app_url):
    hr = hr_api(app_url)
    sophie = Api(app_url, "HV-0215")
    start = today_of(hr) - timedelta(days=SICK_BACK_DAYS - 2)
    rec = report_sickness(sophie, start, "Private " + token())
    other = report_sickness(sophie, start)
    data = pdf_bytes()
    store = S3()
    try:
        assert upload(sophie, rec["id"], data, TRAVERSAL_NAME).status_code == 201
        assert upload(sophie, other["id"], PNG_BYTES, "other.png").status_code == 201
        poll(lambda: store.keys(f"fit-notes/brackenmoor/{rec['id']}/") and store.keys(f"fit-notes/brackenmoor/{other['id']}/"), STORAGE_DEADLINE_S, "stored")
        first = sophie.ok("GET", f"/api/sickness/{rec['id']}/fit-note")
        issued = time.monotonic()
        assert first["expires_in_seconds"] == LINK_SECONDS
        poll(lambda: sophie.ok("GET", f"/api/sickness/{rec['id']}/fit-note")["url"] != first["url"], FRESH_LINK_DEADLINE_S, "a fresh link")
        got = httpx.get(first["url"], timeout=HTTP_TIMEOUT)
        assert got.status_code == 200 and got.content == data
        assert got.headers["content-type"] == "application/pdf"
        assert got.headers["content-disposition"] == KEPT_DISPOSITION
        assert hr.ok("GET", f"/api/sickness/{rec['id']}/fit-note")["expires_in_seconds"] == LINK_SECONDS
        mgr = Api(app_url, OLUWASEUN)
        seen = mgr.ok("GET", f"/api/sickness/{rec['id']}")
        assert "reason" not in seen and "fit_note" not in seen
        err(mgr.req("GET", f"/api/sickness/{rec['id']}/fit-note"), 403, "forbidden")
        colleague = Api(app_url, "HV-0216")
        err(colleague.req("GET", f"/api/sickness/{rec['id']}/fit-note"), 404, "not_found")
        err(colleague.req("GET", f"/api/sickness/{rec['id']}"), 404, "not_found")
        parts = urllib.parse.urlsplit(first["url"])
        other_key = store.keys(f"fit-notes/brackenmoor/{other['id']}/")[0]
        swapped = parts._replace(path=parts.path.split("fit-notes/")[0] + other_key).geturl()
        assert httpx.get(swapped, timeout=HTTP_TIMEOUT).status_code == 403
        query = urllib.parse.parse_qsl(parts.query)
        assert any(v == KEPT_DISPOSITION for _, v in query)
        changed = [(k, v[:-1] if v == KEPT_DISPOSITION else v) for k, v in query]
        assert httpx.get(parts._replace(query=urllib.parse.urlencode(changed)).geturl(), timeout=HTTP_TIMEOUT).status_code == 403
        poll(lambda: httpx.get(first["url"], timeout=HTTP_TIMEOUT).status_code == 403, LINK_EXPIRY_DEADLINE_S, "link expiry")
        assert time.monotonic() - issued >= LINK_SECONDS - 5
    finally:
        for r in (rec, other):
            sophie.req("POST", f"/api/sickness/{r['id']}/return", {"last_sick_date": start.isoformat()})


def test_queue_counts_per_home(app_url):
    hr = hr_api(app_url)
    imogen = Api(app_url, "HV-0211")
    fenella, olu = Api(app_url, FENELLA), Api(app_url, OLUWASEUN)
    s, e = find_window(hr, imogen, 1, 60)
    week = iso_week(s)

    def q(api, home, status="open", wk=week):
        return api.ok("GET", "/api/queue", params={"home": home, "status": status, "week": wk})

    hr0, fen0 = q(hr, "brackenmoor")["counts"], q(fenella, "larchfield")["counts"]
    draft = make_leave(imogen, s, e, submit=False)
    assert draft["id"] not in {i["id"] for i in q(hr, "brackenmoor")["items"]}
    assert q(hr, "brackenmoor")["counts"] == hr0
    finish(hr, imogen, draft["id"])
    req = make_leave(imogen, s, e)
    try:
        hr1 = q(hr, "brackenmoor")
        assert req["id"] in {i["id"] for i in hr1["items"]} and hr1["home_id"] == "brackenmoor"
        assert hr1["counts"]["submitted"] == hr0["submitted"] + 1
        assert req["id"] in {i["id"] for i in q(olu, "brackenmoor", "submitted")["items"]}
        assert req["id"] not in {i["id"] for i in q(olu, "brackenmoor", "approved")["items"]}
        assert q(olu, "brackenmoor", "approved")["counts"] == hr1["counts"]
        assert req["id"] not in {i["id"] for i in q(hr, "brackenmoor", wk=iso_week(s + timedelta(days=14)))["items"]}
        fen1 = q(fenella, "larchfield")
        assert req["id"] not in {i["id"] for i in fen1["items"]} and fen1["counts"] == fen0
        err(fenella.req("GET", "/api/queue", params={"home": "brackenmoor"}), 404, "not_found")
        assert err(hr.req("GET", "/api/queue", params={"home": "brackenmoor", "status": "bogus"}), 422, "validation", "status")["errors"]["status"] == "Choose a queue status."
    finally:
        finish(hr, imogen, req["id"])


def test_who_may_decide(app_url):
    hr = hr_api(app_url)
    tom, grace, fenella, idris = (Api(app_url, p) for p in ("HV-0102", "HV-0103", FENELLA, IDRIS))
    s, e = find_window(hr, tom, 1, 70)
    req = make_leave(tom, s, e)
    fs, fe = find_window(hr, fenella, 1, 75)
    own = make_leave(fenella, fs, fe)
    try:
        err(tom.req("POST", f"/api/leave-requests/{req['id']}/approve", {}), 403, "forbidden")
        err(grace.req("POST", f"/api/leave-requests/{req['id']}/approve", {}), 404, "not_found")
        err(Api(app_url, OLUWASEUN).req("POST", f"/api/leave-requests/{req['id']}/decline", {"reason": "No"}), 404, "not_found")
        for action, body in (("approve", {}), ("decline", {"reason": "No"}), ("covers", {"date": fs.isoformat(), "shift": "early", "skill": "carer"})):
            err(fenella.req("POST", f"/api/leave-requests/{own['id']}/{action}", body), 403, "own_request")
        assert fenella.ok("GET", f"/api/leave-requests/{own['id']}")["status"] == "submitted"
        assert idris.ok("POST", f"/api/leave-requests/{own['id']}/approve", {})["status"] == "approved"
        assert fenella.ok("POST", f"/api/leave-requests/{req['id']}/decline", {"reason": BUSY_REASON})["status"] == "declined"
    finally:
        finish(hr, tom, req["id"])
        finish(hr, fenella, own["id"])


def test_concurrent_approvals_hold_floor(app_url):
    hr = hr_api(app_url)
    tom, grace = Api(app_url, "HV-0102"), Api(app_url, "HV-0103")
    blocked = active_ranges(tom) + active_ranges(grace)
    cache: dict = {}
    today = today_of(hr)
    d = next(today + timedelta(days=k) for k in range(80, 80 + SCAN_DAYS)
             if not any(a <= today + timedelta(days=k) <= b for a, b in blocked)
             and is_clean(hr, "larchfield-rowan", "early", today + timedelta(days=k), cache)
             and not busy(hr, {CARYS, MATEUSZ}, today + timedelta(days=k), cache))
    _, extra = place_bank(hr, "larchfield-rowan", d, "early", [CARYS, MATEUSZ])
    a, b = make_leave(tom, d, d), make_leave(grace, d, d)
    try:
        assert preview(hr, a["id"])["approvable"] is True and preview(hr, b["id"])["approvable"] is True
        fen = Api(app_url, FENELLA)
        results = together(lambda: fen.req("POST", f"/api/leave-requests/{a['id']}/approve", {}),
                           lambda: hr.req("POST", f"/api/leave-requests/{b['id']}/approve", {}))
        assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
        loser = next(r for r in results if r.status_code == 409).json()
        assert loser["error"] == "floor_breach"
        breach = next(x for x in loser["breaches"] if x["date"] == d.isoformat() and x["shift"] == "early")
        assert breach["on_duty"] == breach["min_staff"] and breach["on_duty_if_approved"] == breach["min_staff"] - 1
        statuses = [tom.ok("GET", f"/api/leave-requests/{a['id']}")["status"], grace.ok("GET", f"/api/leave-requests/{b['id']}")["status"]]
        assert sorted(statuses) == ["approved", "submitted"]
    finally:
        finish(hr, tom, a["id"])
        finish(hr, grace, b["id"])
        remove_quietly(hr, extra["assignment_id"])


def test_queue_url_state(app_url, browser):
    hr = hr_api(app_url)
    tom, kwame = Api(app_url, "HV-0102"), Api(app_url, "HV-0104")
    s, e = find_window(hr, tom, 1, 85, others=(kwame,))
    a = make_leave(tom, s, e)
    b = make_leave(kwame, s, e)
    week = iso_week(s)

    def opt(name_api, req):
        return f"{name_of(name_api)}, Unpaid leave, {long_date(s)} to {long_date(e)}, Submitted"

    try:
        with ui(browser, app_url, FENELLA, queue_url(a["id"], status="submitted", week=week)) as page:
            box = page.get_by_role("listbox", name="Requests")
            expect(box.get_by_role("option", name=opt(tom, a), selected=True)).to_be_visible()
            click(box.get_by_role("option", name=opt(kwame, b)))
            expect(page).to_have_url(re.compile(rf"request={b['id']}"))
            expect(page.get_by_role("region", name="Request detail")).to_contain_text(name_of(kwame))
            page.go_back()
            expect(page).to_have_url(re.compile(rf"request={a['id']}"))
            expect(box.get_by_role("option", name=opt(tom, a), selected=True)).to_be_visible()
            page.go_forward()
            expect(page).to_have_url(re.compile(rf"request={b['id']}"))
            page.reload()
            expect(page.get_by_role("listbox", name="Requests").get_by_role("option", name=opt(kwame, b), selected=True)).to_be_visible()
            shared = page.url
            select(page.get_by_role("combobox", name="Status"), "Open")
            expect(page).to_have_url(re.compile(r"status=open"))
            page.go_back()
            expect(page).to_have_url(re.compile(r"status=submitted"))
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(shared).query, keep_blank_values=True)
            assert q["home"] == ["larchfield"] and q["week"] == [week] and q["request"] == [b["id"]]
        with ui(browser, app_url, FENELLA, shared.split(urllib.parse.urlsplit(shared).netloc, 1)[1]) as other:
            expect(other.get_by_role("listbox", name="Requests").get_by_role("option", name=opt(kwame, b), selected=True)).to_be_visible()
    finally:
        finish(hr, tom, a["id"])
        finish(hr, kwame, b["id"])


def test_queue_keyboard(app_url, browser):
    hr = hr_api(app_url)
    priya, owner2 = Api(app_url, "HV-0101"), Api(app_url, "HV-0103")
    s, e = find_window(hr, priya, 2, 95, unit="larchfield-rowan", shift="early")
    a = make_leave(priya, s, e)
    s2, e2 = find_window(hr, owner2, 1, 95)
    b = make_leave(owner2, s2, e2)
    try:
        with ui(browser, app_url, FENELLA, queue_url(a["id"])) as page:
            box = page.get_by_role("listbox", name="Requests")
            tab_to(page, box)
            page.keyboard.press("End")
            page.keyboard.press("Home")
            expect(box.get_by_role("option", selected=True)).to_have_count(1)
            target = f"{name_of(priya)}, Unpaid leave, {long_date(s)} to {long_date(e)}, Submitted"
            for _ in range(box.get_by_role("option").count()):
                if box.get_by_role("option", name=target, selected=True).count():
                    break
                page.keyboard.press("ArrowDown")
            expect(box.get_by_role("option", name=target, selected=True)).to_be_visible()
            expect(page).to_have_url(re.compile(rf"request={a['id']}"))
            preview_btn = page.get_by_role("button", name="Preview approval")
            tab_to(page, preview_btn)
            page.keyboard.press("Space")
            expect(page.get_by_role("button", name="Preview approval", pressed=True)).to_be_visible()
            strip = page.get_by_role("group", name="Staffing strip")
            tab_to(page, strip)
            cells = strip_cells(page)
            def active_cell():
                return next((i + 1 for i in range(STRIP_CELLS) if cell_active(cells.nth(i))), None)

            start_i = active_cell()
            if start_i is None:
                page.keyboard.press("ArrowRight")
                start_i = poll(active_cell, HTTP_TIMEOUT, "an arrow key activates a strip cell")
            start_i -= 1
            page.keyboard.press("ArrowRight")
            poll(lambda: cell_active(cells.nth(min(start_i + 1, STRIP_CELLS - 1))), HTTP_TIMEOUT, "focus on the next cell")
            slot = page.get_by_role("button", name=re.compile(rf"^Post cover for {re.escape(label(s, 'early'))} \((senior|carer)\)$", re.I))
            tab_to(page, slot)
            page.keyboard.press("Enter")
            expect(slot).to_contain_text("cover posted")
            poll(lambda: priya.ok("GET", f"/api/leave-requests/{a['id']}")["status"] == "cover_pending", QUEUE_REFRESH_MS / 1000, "cover_pending")
            override = page.get_by_role("button", name="Approve with override")
            tab_to(page, override)
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Approve with override")
            expect(dialog.get_by_role("textbox", name="Override reason")).to_be_focused()
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()
            expect(override).to_be_focused()
            page.keyboard.press("Enter")
            page.keyboard.type(KEYBOARD_OVERRIDE)
            tab_to(page, dialog.get_by_role("button", name="Confirm approval"))
            page.keyboard.press("Enter")
            poll(lambda: priya.ok("GET", f"/api/leave-requests/{a['id']}")["status"] == "approved", HTTP_TIMEOUT, "approval")
            page.goto(app_url.rstrip("/") + queue_url(b["id"]))
            decline = page.get_by_role("button", name="Decline")
            tab_to(page, decline)
            page.keyboard.press("Enter")
            d2 = page.get_by_role("dialog", name="Decline request")
            expect(d2.get_by_role("textbox", name="Reason")).to_be_focused()
            page.keyboard.type("Two away already")
            tab_to(page, d2.get_by_role("button", name="Confirm decline"))
            page.keyboard.press("Enter")
            poll(lambda: owner2.ok("GET", f"/api/leave-requests/{b['id']}")["status"] == "declined", HTTP_TIMEOUT, "decline")
        assert any(x["action"] == "floor_override" and x["reason"] == KEYBOARD_OVERRIDE for x in audit_for(hr, "larchfield", a["id"]))
    finally:
        finish(hr, priya, a["id"])
        finish(hr, owner2, b["id"])


def test_staffing_preview(app_url):
    hr = hr_api(app_url)
    fen = Api(app_url, FENELLA)
    priya, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0101", 45, free=(FEMI,), days=3)
    try:
        pv = preview(fen, req["id"])
        assert pv["request_id"] == req["id"] and pv["unit_id"] == unit
        assert pv["from"] == s.isoformat() and pv["to"] == (s + timedelta(days=PREVIEW_DAYS - 1)).isoformat()
        assert len(pv["shifts"]) == STRIP_CELLS
        assert [(x["date"], x["shift"]) for x in pv["shifts"]] == [((s + timedelta(days=i)).isoformat(), sh) for i in range(PREVIEW_DAYS) for sh in SHIFTS]
        req_days = {(s + timedelta(days=i)).isoformat() for i in range(3)}
        below = []
        below_affected = []
        for x in pv["shifts"]:
            d = date.fromisoformat(x["date"])
            assert x["label"] in (label(d, x["shift"]), short_label(d, x["shift"]))
            assert x["affected"] is (x["date"] in req_days and x["shift"] == shift)
            assert x["on_duty_if_approved"] == x["on_duty"] - int(x["affected"])
            assert x["seniors_if_approved"] == x["seniors_on_duty"] - int(x["affected"])
            assert x["shortfall"] == max(0, x["floor"]["min_staff"] - x["on_duty_if_approved"])
            assert x["senior_shortfall"] == max(0, x["floor"]["min_seniors"] - x["seniors_if_approved"])
            n = max(x["shortfall"], x["senior_shortfall"])
            assert [g["skill"] for g in x["gaps"]] == ["senior"] * x["senior_shortfall"] + ["carer"] * (n - x["senior_shortfall"])
            if x["affected"]:
                assert x["senior_shortfall"] >= 1 and x["shortfall"] >= 1
            if x["date"] in req_days and (x["shortfall"] or x["senior_shortfall"]):
                below.append(short_label(d, x["shift"]))
                if x["affected"]:
                    below_affected.append(short_label(d, x["shift"]))
        assert (pv["uncovered_breaches"], pv["breach_labels"]) in ((len(below), below), (len(below_affected), below_affected))
        assert pv["approvable"] is False
        assert pv["scale_max"] == max(max(x["on_duty"], x["floor"]["min_staff"] + 2) for x in pv["shifts"])
        err(fen.req("GET", f"/api/leave-requests/{req['id']}/preview", params={"from": (s - timedelta(days=1)).isoformat()}), 422, "validation", "from")
        cover = fen.ok("POST", f"/api/leave-requests/{req['id']}/covers", {"date": s.isoformat(), "shift": shift, "skill": "senior"}, status=201)
        pv2 = preview(fen, req["id"])
        cell = shift_of(pv2, s, shift)
        assert cell["gaps"][0]["cover"]["id"] == cover["id"] and cell["on_duty"] == shift_of(pv, s, shift)["on_duty"]
        assert pv2["uncovered_breaches"] == pv["uncovered_breaches"]
        assert claim(Api(app_url, FEMI), cover["id"]).status_code == 200
        pv3 = preview(fen, req["id"])
        after = shift_of(pv3, s, shift)
        assert after["on_duty"] == cell["on_duty"] + 1 and after["seniors_on_duty"] == cell["seniors_on_duty"] + 1
        assert pv3["uncovered_breaches"] == pv["uncovered_breaches"] - 1
    finally:
        finish(hr, priya, req["id"])
        for x in rota_entries(hr, unit, s, e):
            if x["person"]["id"] == FEMI:
                remove_quietly(hr, x["assignment_id"])

    fenella_owner = fen
    fs, fe = find_window(hr, fenella_owner, 1, 50)
    own = make_leave(fenella_owner, fs, fe)
    try:
        pv = preview(Api(app_url, IDRIS), own["id"])
        assert pv["unit_id"] is None and pv["shifts"] == [] and pv["scale_max"] == 0
        assert pv["uncovered_breaches"] == 0 and pv["breach_labels"] == [] and pv["approvable"] is True
        assert pv["to"] == (fs + timedelta(days=PREVIEW_DAYS - 1)).isoformat()
        err(Api(app_url, IDRIS).req("POST", f"/api/leave-requests/{own['id']}/covers", {"date": fs.isoformat(), "shift": "early", "skill": "carer"}), 409, "no_open_gap")
    finally:
        finish(hr, fenella_owner, own["id"])


def test_strip_matches_preview(app_url, browser):
    hr = hr_api(app_url)
    fen = Api(app_url, FENELLA)
    priya, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0101", 55, days=3)
    try:
        pv = preview(fen, req["id"])
        with ui(browser, app_url, FENELLA, queue_url(req["id"])) as page:
            cells = strip_cells(page)
            expect(cells).to_have_count(STRIP_CELLS)
            for i, x in enumerate(pv["shifts"]):
                expect(cells.nth(i)).to_have_accessible_name(cell_name(x, False))
            approve = page.get_by_role("button", name="Approve", exact=True)
            expect(approve).to_be_disabled()
            expect(approve).to_have_accessible_description("Cover every gap or approve with override")
            expect(page.get_by_role("button", name="Approve with override")).to_be_enabled()
            click(page.get_by_role("button", name="Preview approval"))
            n = pv["uncovered_breaches"]
            expect(page.get_by_role("status", name="Strip announcements")).to_have_text(
                f"Approving would leave {n} shift{'s' if n != 1 else ''} below floor: {', '.join(pv['breach_labels'])}")
            for i, x in enumerate(pv["shifts"]):
                cell = cells.nth(i)
                settle(cell)
                expect(cell).to_have_accessible_name(cell_name(x, True))
    finally:
        finish(hr, priya, req["id"])


def test_breach_labels_contrast(app_url, browser):
    hr = hr_api(app_url)
    priya, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0101", 58, days=2)
    try:
        pv = preview(hr, req["id"])
        assert any(x["shortfall"] or x["senior_shortfall"] for x in pv["shifts"])
        with ui(browser, app_url, FENELLA, queue_url(req["id"])) as page:
            cells = strip_cells(page)
            expect(cells).to_have_count(STRIP_CELLS)
            click(page.get_by_role("button", name="Preview approval"))
            for i, x in enumerate(pv["shifts"]):
                cell = cells.nth(i)
                settle(cell)
                want = labels_expected(x["shortfall"], x["senior_shortfall"])
                poll(lambda cell=cell, want=want: labels_shown(cell) == want, HTTP_TIMEOUT, f"breach labels of cell {i}")
            failures = page.evaluate(CONTRAST_JS, [AA_TEXT_RATIO, AA_LARGE_RATIO, LARGE_TEXT_PX, LARGE_BOLD_PX])
            assert not failures, failures
    finally:
        finish(hr, priya, req["id"])


TRACK = """els => { window.__track = els.map(c => [c, ...c.getElementsByTagName('*')]);
  window.__born = new Map(); window.__last = 0; }"""
SAMPLE = """elapsed => {
  for (const a of document.getAnimations()) {
    if (!__born.has(a)) {
      if (a.playState === 'finished' || a.playState === 'idle') continue;
      __born.set(a, [__last, a.currentTime || 0, a.playbackRate || 1]);
    }
    const [t0, c0, rate] = __born.get(a);
    a.pause(); a.currentTime = Math.max(0, c0 + rate * (elapsed - t0));
  }
  __last = elapsed;
  return __track.map(list => list.map(e => Math.round(e.getBoundingClientRect().height * 100) / 100));
}"""
RELEASE = """() => {
  for (const a of __born.keys()) { try { a.finish(); } catch (e) { a.cancel(); } }
  __born = new Map();
}"""


def record_motion(page, action):
    strip_cells(page).evaluate_all(TRACK)
    page.clock.pause_at(page.evaluate("Date.now()") + 1000)
    frames = []
    try:
        baseline = page.evaluate(SAMPLE, 0)
        action()
        for k in range(MOTION_SPAN_MS // MOTION_STEP_MS + 1):
            if k:
                page.clock.run_for(MOTION_STEP_MS)
            frames.append((k * MOTION_STEP_MS, page.evaluate(SAMPLE, k * MOTION_STEP_MS)))
    finally:
        page.evaluate(RELEASE)
        page.clock.resume()
    out = []
    for i in range(STRIP_CELLS):
        per = []
        for j, start in enumerate(baseline[i]):
            prev, times = start, []
            for t, f in frames:
                if f[i][j] != prev:
                    times.append(t)
                    prev = f[i][j]
            per.append((times, start, prev))
        out.append(per)
    return out


def bar_motion(per):
    moving = [m for m in per if len(m[0]) >= MOTION_MIN_CHANGES]
    if not moving:
        return None
    times, before, after = max(moving, key=lambda m: len(m[0]))
    return times[0], times[-1], before, after


def test_preview_motion(app_url, browser):
    hr = hr_api(app_url)
    priya, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0101", 65, days=3)
    try:
        affected = [i for i, x in enumerate(preview(hr, req["id"])["shifts"]) if x["affected"]]
        with ui(browser, app_url, FENELLA, queue_url(req["id"])) as page:
            failure = None
            for attempt in range(MOTION_ATTEMPTS):
                if attempt:
                    page.reload()
                try:
                    preview_motion_once(page, affected)
                    return
                except AssertionError as error:
                    failure = error
            raise failure
    finally:
        finish(hr, priya, req["id"])


MOTION_ATTEMPTS = 3


def preview_motion_once(page, affected):
    expect(strip_cells(page)).to_have_count(STRIP_CELLS)
    settle(page.get_by_role("group", name="Staffing strip"))
    button = page.get_by_role("button", name="Preview approval")
    on = record_motion(page, lambda: button.press("Space"))
    moves = {i: bar_motion(on[i]) for i in range(STRIP_CELLS)}
    assert {i for i, m in moves.items() if m} == set(affected), moves
    for i in affected:
        start, end, before, after = moves[i]
        assert after < before, (i, before, after)
        assert BAR_MIN_MS <= end - start + MOTION_STEP_MS <= BAR_MAX_MS + MOTION_STEP_MS, (i, moves[i])
    starts = [moves[i][0] for i in affected]
    for a, b in zip(starts, starts[1:]):
        assert STAGGER_MIN_MS <= b - a <= STAGGER_MAX_MS, starts
    settle(page.get_by_role("group", name="Staffing strip"))
    off = record_motion(page, lambda: button.press("Space"))
    back = {i: bar_motion(off[i]) for i in range(STRIP_CELLS)}
    assert {i for i, m in back.items() if m} == set(affected), back
    for i in affected:
        assert back[i][3] > back[i][2], (i, back[i])
    ostarts = [back[i][0] for i in affected]
    for a, b in zip(ostarts, ostarts[1:]):
        assert STAGGER_MIN_MS <= a - b <= STAGGER_MAX_MS, ostarts
    assert min(ostarts) >= FADE_MIN_MS, ostarts


def test_reduced_motion_preview(app_url, browser):
    hr = hr_api(app_url)
    priya, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0101", 75, days=2)
    try:
        pv = preview(hr, req["id"])
        with ui(browser, app_url, FENELLA, queue_url(req["id"]), reduced_motion="reduce") as page:
            cells = strip_cells(page)
            expect(cells).to_have_count(STRIP_CELLS)
            button = page.get_by_role("button", name="Preview approval")
            motion = record_motion(page, lambda: button.press("Space"))
            for i, per in enumerate(motion):
                assert all(len(times) < MOTION_MIN_CHANGES for times, _, _ in per), (i, per)
            affected = [i for i, x in enumerate(pv["shifts"]) if x["affected"]]
            snaps = [times[0] for i in affected for times, _, _ in motion[i] if times]
            assert snaps and max(snaps) - min(snaps) < STAGGER_MIN_MS, snaps
            for i, x in enumerate(pv["shifts"]):
                if x["affected"]:
                    expect(cells.nth(i)).to_contain_text(f"{x['on_duty']} → {x['on_duty_if_approved']}")
                else:
                    expect(cells.nth(i)).not_to_contain_text("→")
            button.press("Space")
            expect(page.get_by_role("group", name="Staffing strip")).not_to_contain_text("→")
    finally:
        finish(hr, priya, req["id"])


def test_cover_chip_drop(app_url, browser):
    hr = hr_api(app_url)
    tom, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0102", 105)
    try:
        with ui(browser, app_url, FENELLA, queue_url(req["id"])) as page:
            click(page.get_by_role("button", name="Preview approval"))
            chip = page.get_by_role("button", name="Cover", exact=True)
            slot = page.get_by_role("button", name=re.compile(rf"^Post cover for {re.escape(label(s, shift))} \(carer\)$", re.I))
            area = page.get_by_role("region", name="Request detail").bounding_box()
            drag(page, chip, at=(area["x"] + 5, area["y"] + 5))
            expect(chip).to_be_visible()
            assert tom.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "submitted"
            drag(page, chip, target=slot)
            expect(slot).to_contain_text("cover posted")
            expect(page.get_by_role("status", name="Queue status")).to_have_text(f"Cover posted for {label(s, shift)}. Eligible bank carers will be emailed.")
        assert tom.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "cover_pending"
        mine = [c for c in Api(app_url, CARYS).ok("GET", "/api/cover-shifts")["items"] if c["date"] == s.isoformat() and c["unit"]["id"] == unit]
        assert len(mine) == 1 and mine[0]["status"] == "open"
        err(Api(app_url, FENELLA).req("POST", f"/api/leave-requests/{req['id']}/covers", {"date": s.isoformat(), "shift": shift, "skill": "carer"}), 409, "no_open_gap")
    finally:
        finish(hr, tom, req["id"])


def test_override_approval(app_url, mail):
    hr = hr_api(app_url)
    fen = Api(app_url, FENELLA)
    kwame, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0104", 115)
    before = mail_ids(mail)
    try:
        body = err(fen.req("POST", f"/api/leave-requests/{req['id']}/approve", {}), 409, "floor_breach")
        assert "below floor" in body["message"]
        b = next(x for x in body["breaches"] if x["date"] == s.isoformat())
        assert b["on_duty"] == b["min_staff"] and b["on_duty_if_approved"] == b["min_staff"] - 1
        r = fen.req("POST", f"/api/leave-requests/{req['id']}/approve", {"override_reason": "x" * (REASON_MAX + 1)})
        assert err(r, 422, "validation", "override_reason")["errors"]["override_reason"] == "Give a reason of 1 to 500 characters."
        assert kwame.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "submitted"
        assert not mail_wait(mail, before, lambda m: email_of("HV-0104") in rcpts(m) and long_date(s) in m.get("Subject", ""), seconds=3)
        reason = "Agency confirmed " + token()
        assert fen.ok("POST", f"/api/leave-requests/{req['id']}/approve", {"override_reason": reason})["status"] == "approved"
        entry = next(x for x in audit_for(hr, "larchfield", req["id"]) if x["action"] == "floor_override")
        assert entry["reason"] == reason and entry["actor"]["id"] == FENELLA
        assert entry["before"]["status"] == "submitted" and entry["after"]["status"] == "approved"
        assert entry["after"]["breach_labels"] == [short_label(s, shift)]
    finally:
        finish(hr, kwame, req["id"])


def test_open_cover_visibility(app_url):
    hr = hr_api(app_url)
    fen = Api(app_url, FENELLA)
    priya, preq, ps, _, _, _ = cover_request(app_url, hr, "HV-0101", 125)
    tom, treq, ts, _, _, _ = cover_request(app_url, hr, "HV-0102", 125)
    try:
        senior = fen.ok("POST", f"/api/leave-requests/{preq['id']}/covers", {"date": ps.isoformat(), "shift": "early", "skill": "senior"}, status=201)
        carer = fen.ok("POST", f"/api/leave-requests/{treq['id']}/covers", {"date": ts.isoformat(), "shift": "early", "skill": "carer"}, status=201)

        def ids(pid):
            items = Api(app_url, pid).ok("GET", "/api/cover-shifts")["items"]
            for c in items:
                assert set(c) == COVER_BC_KEYS
            return {c["id"] for c in items}

        assert {senior["id"], carer["id"]} <= ids(FEMI)
        assert carer["id"] in ids(CARYS) and senior["id"] not in ids(CARYS)
        assert not {senior["id"], carer["id"]} & ids(HOLLY)
        err(claim(Api(app_url, HOLLY), carer["id"]), 404, "not_found")
        err(claim(Api(app_url, CARYS), senior["id"]), 403, "skill_required")
        assert senior["id"] in ids(FEMI)
    finally:
        finish(hr, priya, preq["id"])
        finish(hr, tom, treq["id"])


def test_cover_email(app_url, mail):
    hr = hr_api(app_url)
    fen = Api(app_url, FENELLA)
    note = "Private note " + token()
    tom = Api(app_url, "HV-0102")
    s, e = find_window(hr, tom, 1, 135, unit="larchfield-rowan", shift="early")
    req = make_leave(tom, s, e, note=note)
    before = mail_ids(mail)
    try:
        fen.ok("POST", f"/api/leave-requests/{req['id']}/covers", {"date": s.isoformat(), "shift": "early", "skill": "carer"}, status=201)
        subject = f"Cover shift at Larchfield House: {label(s, 'early')}"
        mail_wait(mail, before, lambda m: m.get("Subject") == subject, count=3)
        found = [m for m in mail.messages(settle=3) if m.get("ID") not in before and m.get("Subject") == subject]
        assert sorted(a for m in found for a in rcpts(m)) == sorted(email_of(p) for p in (FEMI, CARYS, MATEUSZ))
        for m in found:
            body = body_of(m)
            for part in ("Larchfield House", "Rowan", long_date(s), "07:00–15:00", "Carer", "/cover"):
                assert part in body, part
            secrets = [name_of(tom), "Unpaid leave", note] + ([req["id"]] if len(req["id"]) >= ID_PROBE_MIN else [])
            for secret in secrets:
                assert secret not in body and secret not in m.get("Subject", "")
    finally:
        finish(hr, tom, req["id"])


def test_one_claim_winner(app_url):
    hr = hr_api(app_url)
    fen = Api(app_url, FENELLA)
    tom, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0102", 140, free=(FEMI, CARYS, MATEUSZ))
    try:
        cover = fen.ok("POST", f"/api/leave-requests/{req['id']}/covers", {"date": s.isoformat(), "shift": shift, "skill": "carer"}, status=201)
        carers = [Api(app_url, p) for p in (FEMI, CARYS, MATEUSZ)]
        results = together(*[lambda c=c: claim(c, cover["id"]) for c in carers])
        assert sorted(r.status_code for r in results) == [200, 409, 409], [r.text for r in results]
        winner = carers[[r.status_code for r in results].index(200)]
        for r in results:
            if r.status_code == 409:
                err(r, 409, "already_taken")
        on_shift = {x["person"]["id"] for x in rota_entries(hr, unit, s, s) if x["shift"] == shift}
        assert winner.id in on_shift and not ({FEMI, CARYS, MATEUSZ} - {winner.id}) & on_shift
        err(claim(winner, cover["id"]), 409, "already_taken")
        assert sum(1 for x in rota_entries(hr, unit, s, s) if x["person"]["id"] == winner.id) == 1
    finally:
        finish(hr, tom, req["id"])
        for x in rota_entries(hr, unit, s, e):
            if x["person"]["id"] in BANK:
                remove_quietly(hr, x["assignment_id"])


def test_claim_idempotency(app_url):
    hr = hr_api(app_url)
    fen = Api(app_url, FENELLA)
    tom, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0102", 150, free=(FEMI, CARYS), days=2)
    try:
        a = fen.ok("POST", f"/api/leave-requests/{req['id']}/covers", {"date": s.isoformat(), "shift": shift, "skill": "carer"}, status=201)
        b = fen.ok("POST", f"/api/leave-requests/{req['id']}/covers", {"date": e.isoformat(), "shift": shift, "skill": "carer"}, status=201)
        femi, key = Api(app_url, FEMI), idempotency_key()
        first = claim(femi, a["id"], key)
        assert first.status_code == 200 and REPLAYED not in first.headers
        assert first.json()["cover"]["status"] == "claimed"
        for r in [claim(femi, a["id"], key)] + together(*[lambda c=c: claim(c, a["id"], key) for c in (femi.fork(), femi.fork(), femi.fork())]):
            assert r.status_code == 200 and r.content == first.content and r.headers.get(REPLAYED) == "true"
        assert sum(1 for x in rota_entries(hr, unit, s, s) if x["person"]["id"] == FEMI) == 1
        err(claim(femi, b["id"], key), 409, "idempotency_key_reused")
        err(femi.req("POST", f"/api/cover-shifts/{b['id']}/claim", {}), 422, "validation", "Idempotency-Key")
        err(claim(femi, b["id"], "k" * (KEY_MAX + 1)), 422, "validation", "Idempotency-Key")
        assert b["id"] in {c["id"] for c in Api(app_url, CARYS).ok("GET", "/api/cover-shifts")["items"]}
        hr.ok("DELETE", f"/api/rota/assignments/{first.json()['assignment']['assignment_id']}", status=204)
        replay = claim(femi, a["id"], key)
        assert replay.status_code == 200 and replay.content == first.content
        assert claim(Api(app_url, CARYS), b["id"], key).status_code == 200
    finally:
        finish(hr, tom, req["id"])
        for x in rota_entries(hr, unit, s, e):
            if x["person"]["id"] in BANK:
                remove_quietly(hr, x["assignment_id"])


def test_today_in_london(app_url):
    hr = hr_api(app_url)
    inside = past_assignment(hr, "larchfield-rowan", [MISSED_LIST_DAYS - 1])
    outside = past_assignment(hr, "larchfield-willow", [MISSED_LIST_DAYS])
    made = [hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"])),
                                               "clock_out_at": None, "reason": "Window probe"}, status=201) for e in (inside, outside)]
    for zone in FAR_ZONES:
        with app_copy(TZ=zone, SMTP_HOST="127.0.0.1", SMTP_PORT="9") as copy:
            chr_ = Api(copy, HR_ID)
            r = chr_.req("GET", "/api/homes/larchfield/today")
            assert r.status_code == 200, r.text
            london = parsedate_to_datetime(r.headers["date"]).astimezone(LONDON).date()
            today = date.fromisoformat(r.json()["date"])
            assert today == london, (zone, today, london)
            rota = Api(copy, "HV-0103").ok("GET", "/api/units/larchfield-rowan/rota")
            assert rota["from"] == monday(today).isoformat(), zone
            assert rota["to"] in ((monday(today) + timedelta(days=6)).isoformat(), (monday(today) + timedelta(days=7)).isoformat())
            listed = {x["id"] for x in chr_.ok("GET", "/api/homes/larchfield/today")["missed_clock_outs"]}
            assert made[0]["id"] in listed and made[1]["id"] not in listed, zone


def test_home_only_surfaces(app_url):
    hr = hr_api(app_url)
    fen = Api(app_url, FENELLA)

    def people(q):
        return {p["id"] for p in fen.ok("GET", "/api/homes/larchfield/people", params={"q": q})["items"]}

    assert "HV-0101" in people("Priya") and "HV-0101" in people("HV-0101")
    assert "HV-0211" not in people("Imogen") and HOLLY not in people("Holly")
    assert CARYS in people("Carys")
    err(fen.req("GET", "/api/homes/brackenmoor/people", params={"q": "Imogen"}), 404, "not_found")
    err(fen.req("GET", "/api/homes/brackenmoor/today"), 404, "not_found")
    err(fen.req("POST", "/api/rota/assignments", {"person_id": "HV-0212", "unit_id": "brackenmoor-heather",
                                                 "date": (today_of(hr) + timedelta(days=3)).isoformat(), "shift": "late"}), 404, "not_found")
    e = past_assignment(hr, "brackenmoor-heather", range(1, 6))
    late = hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"]) + timedelta(minutes=LATE_GRACE_MIN + 5)),
                                             "clock_out_at": None, "reason": "Late and missed"}, status=201)
    mine = fen.ok("GET", "/api/homes/larchfield/today")
    assert late["id"] not in {x["id"] for x in mine["late_clock_ins"] + mine["missed_clock_outs"]}
    assert {u["unit_id"] for u in mine["units"]} == set(HOME_UNITS["larchfield"])
    olu = Api(app_url, OLUWASEUN).ok("GET", "/api/homes/brackenmoor/today")
    assert late["id"] in {x["id"] for x in olu["late_clock_ins"]} and late["id"] in {x["id"] for x in olu["missed_clock_outs"]}
    assert mine["totals"]["on_duty"] == sum(s["on_duty"] for u in mine["units"] for s in u["shifts"])


def test_today_matches_preview(app_url):
    hr = hr_api(app_url)
    today = today_of(hr)
    owner = next(Api(app_url, p) for p in sorted(SEED_SHIFT["larchfield-rowan"]["late"])
                 if not any(a <= today <= b for a, b in active_ranges(Api(app_url, p))))
    req = make_leave(owner, today, today)
    sick_worker = Api(app_url, "HV-0108" if owner.id != "HV-0108" else "HV-0107")
    extra = None

    def check():
        t = hr.ok("GET", "/api/homes/larchfield/today")
        pv = preview(hr, req["id"])
        rowan = next(u for u in t["units"] if u["unit_id"] == "larchfield-rowan")
        for s in rowan["shifts"]:
            p = shift_of(pv, today, s["shift"])
            assert (s["on_duty"], s["seniors_on_duty"]) == (p["on_duty"], p["seniors_on_duty"]), s["shift"]
            assert s["shortfall"] == max(0, s["floor"]["min_staff"] - s["on_duty"])
            assert s["senior_shortfall"] == max(0, s["floor"]["min_seniors"] - s["seniors_on_duty"])
        flat = [s for u in t["units"] for s in u["shifts"]]
        assert t["totals"]["on_duty"] == sum(s["on_duty"] for s in flat)
        assert t["totals"]["seniors_on_duty"] == sum(s["seniors_on_duty"] for s in flat)
        assert t["totals"]["below_floor"] == sum(1 for s in flat if s["shortfall"] or s["senior_shortfall"])

    sick = None
    try:
        check()
        sick = report_sickness(sick_worker, today)
        check()
        sick_worker.ok("POST", f"/api/sickness/{sick['id']}/return", {"last_sick_date": today.isoformat()})
        sick = None
        check()
        _, extra = place_bank(hr, "larchfield-rowan", today, "late", [CARYS, MATEUSZ, FEMI])
        check()
        hr.ok("POST", f"/api/leave-requests/{req['id']}/approve", {"override_reason": "Agreed"})
        check()
        hr.ok("DELETE", f"/api/rota/assignments/{extra['assignment_id']}", status=204)
        extra = None
        check()
        hr.ok("POST", f"/api/leave-requests/{req['id']}/cancel", {"reason": "Needed after all"})
        check()
    finally:
        finish(hr, owner, req["id"])
        if extra:
            remove_quietly(hr, extra["assignment_id"])
        if sick:
            sick_worker.req("POST", f"/api/sickness/{sick['id']}/return", {"last_sick_date": today.isoformat()})


def test_effective_dated_floors_and_policy(app_url):
    hr = hr_api(app_url)
    tariq = Api(app_url, "HV-0217")
    today = today_of(hr)
    versions = hr.ok("GET", "/api/homes/brackenmoor/floors")["versions"]
    night = [v for v in versions if v["unit_id"] == "brackenmoor-heather" and v["shift"] == "night"]
    used = {v["effective_from"] for v in night}
    blocked = active_ranges(tariq)
    d = next(today + timedelta(days=k) for k in range(40, 40 + SCAN_DAYS)
             if (today + timedelta(days=k)).isoformat() not in used
             and leave_year(today + timedelta(days=k - 1)) == leave_year(today + timedelta(days=k))
             and not any(a <= today + timedelta(days=k) and today + timedelta(days=k - 1) <= b for a, b in blocked))

    def in_force(day, vs):
        return max((v for v in vs if v["effective_from"] <= day.isoformat()), key=lambda v: v["effective_from"])

    old = in_force(d - timedelta(days=1), night)
    new_min = min(old["min_staff"] + 1, 30)
    added = hr.ok("POST", "/api/homes/brackenmoor/floors", {"unit_id": "brackenmoor-heather", "shift": "night", "min_staff": new_min,
                                                           "min_seniors": 1, "effective_from": d.isoformat()}, status=201)
    assert added["effective_from"] == d.isoformat() and added["min_staff"] == new_min
    err(hr.req("POST", "/api/homes/brackenmoor/floors", {"unit_id": "brackenmoor-heather", "shift": "night", "min_staff": new_min,
                                                        "min_seniors": 1, "effective_from": d.isoformat()}), 409, "version_exists")
    entry = next(a for a in audit_for(hr, "brackenmoor", added["id"]) if a["action"] == "floor_version_added")
    assert entry["before"] is None and entry["reason"] is None and entry["target"]["type"] == "floor_version"
    all_night = [v for v in hr.ok("GET", "/api/homes/brackenmoor/floors")["versions"] if v["unit_id"] == "brackenmoor-heather" and v["shift"] == "night"]
    req = make_leave(tariq, d - timedelta(days=1), d)
    try:
        pv = preview(hr, req["id"])
        for x in pv["shifts"]:
            v = in_force(date.fromisoformat(x["date"]), all_night) if x["shift"] == "night" else None
            if v:
                assert x["floor"]["min_staff"] == v["min_staff"] and x["floor"]["effective_from"] == v["effective_from"]
        assert shift_of(pv, d - timedelta(days=1), "night")["floor"]["min_staff"] == old["min_staff"]
        assert shift_of(pv, d, "night")["floor"]["min_staff"] == new_min
    finally:
        finish(hr, tariq, req["id"])

    pol = hr.ok("GET", "/api/homes/brackenmoor/leave-policy")["versions"]
    m_now = in_force(today, pol)["notice_multiplier"]
    far = free_far_date({v["effective_from"] for v in pol})
    hr.ok("POST", "/api/homes/brackenmoor/leave-policy", {"notice_multiplier": 6, "effective_from": far.isoformat()}, status=201)
    assert far.isoformat() in {v["effective_from"] for v in hr.ok("GET", "/api/homes/brackenmoor/leave-policy")["versions"]}
    s = today + timedelta(days=m_now * 2)
    owen = next((w for w in (Api(app_url, p) for p in ("HV-0214", "HV-0215", "HV-0216", "HV-0212", "HV-0213"))
                 if not any(a <= s + timedelta(days=1) and s <= b for a, b in active_ranges(w))), None)
    assert owen, "no Heather worker free for the notice probe"
    r = make_leave(owen, s, s + timedelta(days=1))
    try:
        assert r["short_notice"] is False
    finally:
        finish(hr, owen, r["id"])
    for body, field in (({"notice_multiplier": 2, "effective_from": today.isoformat()}, "effective_from"),
                        ({"notice_multiplier": 7, "effective_from": free_far_date({v["effective_from"] for v in pol} | {far.isoformat()}).isoformat()},
                         "notice_multiplier")):
        err(hr.req("POST", "/api/homes/brackenmoor/leave-policy", body), 422, "validation", field)
    bad = hr.req("POST", "/api/homes/brackenmoor/floors", {"unit_id": "brackenmoor-heather", "shift": "late", "min_staff": 2, "min_seniors": 3,
                                                          "effective_from": free_far_date({v["effective_from"] for v in hr.ok("GET", "/api/homes/brackenmoor/floors")["versions"]}).isoformat()})
    assert err(bad, 422, "validation", "min_seniors")["errors"]["min_seniors"] == "Use a whole number no larger than the minimum staff."


def test_only_hr_edits_floors(app_url):
    hr = hr_api(app_url)
    used = {v["effective_from"] for kind in ("floors", "leave-policy") for v in hr.ok("GET", f"/api/homes/larchfield/{kind}")["versions"]}
    d = free_far_date(used)
    for sid in (FENELLA, "HV-0101"):
        api = Api(app_url, sid)
        err(api.req("POST", "/api/homes/larchfield/floors", {"unit_id": "larchfield-rowan", "shift": "night", "min_staff": 4,
                                                            "min_seniors": 1, "effective_from": d.isoformat()}), 403, "forbidden")
        err(api.req("POST", "/api/homes/larchfield/leave-policy", {"notice_multiplier": 3, "effective_from": d.isoformat()}), 403, "forbidden")
    assert d.isoformat() not in {v["effective_from"] for v in hr.ok("GET", "/api/homes/larchfield/floors")["versions"]}
    assert d.isoformat() not in {v["effective_from"] for v in hr.ok("GET", "/api/homes/larchfield/leave-policy")["versions"]}


def bank_attendance(hr, pid, period, hours_worked, unit=None, out=True, offset_trick=False):
    first = date.fromisoformat(period + "-01")
    unit = unit or ("brackenmoor-heather" if pid == HOLLY else "larchfield-rowan")
    e = bank_slot(hr, pid, unit, first, "early")
    start = inst(e["starts_at"])
    end = start + timedelta(seconds=hours_worked * SECONDS_PER_HOUR)
    clock_out = (end.astimezone(UTC).isoformat() if offset_trick else london_iso(end)) if out else None
    return hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(start),
                                             "clock_out_at": clock_out, "reason": "Bank shift"}, status=201)


def test_pay_period_close(app_url):
    hr = hr_api(app_url)
    today = today_of(hr)
    newer, older = unclosed_months(hr, today, 2)
    femi = Api(app_url, FEMI)
    att = bank_attendance(hr, FEMI, older, 10)
    results = together(lambda: hr.req("POST", f"/api/pay-periods/{older}/close", {}), lambda: hr.fork().req("POST", f"/api/pay-periods/{older}/close", {}))
    assert sorted(r.status_code for r in results) == [201, 409], [r.text for r in results]
    err(next(r for r in results if r.status_code == 409), 409, "period_closed")
    assert next(r for r in results if r.status_code == 201).json()["period"] == older
    for pid in BANK:
        api = Api(app_url, pid)
        period_entries = [x for x in ledger(api)["entries"] if x["period"] == older and x["kind"] == "period"]
        assert len(period_entries) == 1
        worked = month_seconds(api, older)
        assert period_entries[0]["worked_hours"] == f"{worked4(worked):.4f}"
        assert Decimal(period_entries[0]["accrued_hours"]) == accrual(worked)
    before = ledger(femi)["entries"]
    hr.ok("PATCH", f"/api/attendance/{att['id']}", {"clock_in_at": att["clock_in_at"],
                                                    "clock_out_at": london_iso(inst(att["clock_in_at"]) + timedelta(hours=11)),
                                                    "reason": "Stayed late"}, headers={"If-Match": f'"{att["version"]}"'})
    hr.ok("POST", f"/api/pay-periods/{newer}/close", {}, status=201)
    adjustments = [x for x in ledger(femi)["entries"] if x["kind"] == "adjustment" and x["period"] == older]
    assert len(adjustments) == 1
    seconds = month_seconds(femi, older)
    prior = [x for x in before if x["period"] == older]
    assert Decimal(adjustments[0]["worked_hours"]) == worked4(seconds) - sum(Decimal(x["worked_hours"]) for x in prior)
    assert Decimal(adjustments[0]["accrued_hours"]) == accrual(seconds) - sum(Decimal(x["accrued_hours"]) for x in prior)
    err(hr.req("POST", f"/api/pay-periods/{newer}/close", {}), 409, "period_closed")
    err(hr.req("POST", f"/api/pay-periods/{month_of(today)}/close", {}), 409, "period_not_ended")
    err(hr.req("POST", "/api/pay-periods/2026-13/close", {}), 422, "validation", "period")
    err(Api(app_url, FENELLA).req("POST", f"/api/pay-periods/{newer}/close", {}), 403, "forbidden")


def test_accrual_arithmetic(app_url):
    hr = hr_api(app_url)
    (period,) = unclosed_months(hr, today_of(hr), 1)
    plan = {FEMI: 11, CARYS: 10, MATEUSZ: 9, HOLLY: Decimal(1) / 3}
    for pid, h in plan.items():
        bank_attendance(hr, pid, period, float(h), offset_trick=(pid == FEMI))
    bank_attendance(hr, HOLLY, period, 2, out=False)
    hr.ok("POST", f"/api/pay-periods/{period}/close", {}, status=201)
    for pid in plan:
        api = Api(app_url, pid)
        entry = next(x for x in ledger(api)["entries"] if x["period"] == period and x["kind"] == "period")
        seconds = month_seconds(api, period)
        assert Decimal(entry["accrued_hours"]) == accrual(seconds), pid
        assert Decimal(entry["accrued_hours"]) >= Decimal(str(seconds)) * ACCRUAL_RATE / SECONDS_PER_HOUR
    femi = Api(app_url, FEMI)
    femi_att = [a for a in femi.ok("GET", "/api/me/attendance")["items"] if a["date"].startswith(period)]
    assert any(hours_match(a["worked_hours"], 11 * SECONDS_PER_HOUR) for a in femi_att)
    if month_seconds(femi, period) == 11 * SECONDS_PER_HOUR:
        assert next(x for x in ledger(femi)["entries"] if x["period"] == period)["accrued_hours"] == "1.3277"
    holly = Api(app_url, HOLLY)
    missed = [a for a in holly.ok("GET", "/api/me/attendance")["items"] if a["date"].startswith(period) and a["missed_clock_out"]]
    assert missed and all(a["worked_hours"] is None for a in missed)
    acc = ledger(femi)
    current = month_of(today_of(hr))
    assert acc["open_period"]["period"] == current
    assert Decimal(acc["open_period"]["pending_accrual_hours"]) == accrual(month_seconds(femi, current))
    assert Decimal(acc["ledger_total_hours"]) == sum(Decimal(x["accrued_hours"]) for x in acc["entries"])


def download_csv(hr, export_id):
    link = poll(lambda: (r := hr.req("GET", f"/api/exports/{export_id}/download")).status_code == 200 and r.json(), STORAGE_DEADLINE_S, "export link")
    return link, httpx.get(link["url"], timeout=HTTP_TIMEOUT)


def test_timesheet_csv(app_url):
    hr = hr_api(app_url)
    e1 = past_assignment(hr, "larchfield-willow", range(2, 20))
    period = e1["date"][:7]
    worker = Api(app_url, e1["person"]["id"])
    old = name_of(worker)
    evil = "@" + token()
    try:
        rename(worker, evil)
        closed = hr.ok("POST", "/api/attendance", {"assignment_id": e1["assignment_id"], "clock_in_at": london_iso(inst(e1["starts_at"]) + timedelta(minutes=LATE_GRACE_MIN + 5)),
                                                   "clock_out_at": london_iso(inst(e1["ends_at"])), "reason": FORMULA_NOTE}, status=201)
        same_month = [k for k in range(2, 40) if month_of(today_of(hr) - timedelta(days=k)) == period]
        e2 = past_assignment(hr, "larchfield-rowan", same_month)
        missed = hr.ok("POST", "/api/attendance", {"assignment_id": e2["assignment_id"], "clock_in_at": london_iso(inst(e2["starts_at"])),
                                                   "clock_out_at": None, "reason": PLUS_NOTE}, status=201)
        e3 = past_assignment(hr, "brackenmoor-heather", same_month)
        hr.ok("POST", "/api/attendance", {"assignment_id": e3["assignment_id"], "clock_in_at": london_iso(inst(e3["starts_at"])),
                                          "clock_out_at": london_iso(inst(e3["ends_at"])), "reason": "Other home"}, status=201)
        export = hr.ok("POST", "/api/exports/timesheets", {"period": period, "home_ids": ["larchfield"]}, status=201)
        assert export["period"] == period and export["home_ids"] == ["larchfield"]
        _, got = download_csv(hr, export["id"])
        raw = got.content.decode("utf-8")
        assert raw.split("\r\n")[0] == CSV_HEADER
        assert "\n" not in raw.replace("\r\n", "")
        rows = list(csv.DictReader(io.StringIO(raw, newline="")))
        assert export["row_count"] == len(rows)
        assert all(r["home"] == "Larchfield House" for r in rows)
        order = {"Early": 0, "Late": 1, "Night": 2}
        keys = [(r["home"], r["unit"], r["shift_date"], order[r["shift"]], r["staff_number"]) for r in rows]
        assert keys == sorted(keys)
        a = next(r for r in rows if r["staff_number"] == worker.id and r["shift_date"] == e1["date"])
        assert a["display_name"] == APOSTROPHE + evil and a["correction_note"] == APOSTROPHE + FORMULA_NOTE and a["role"] == "care_worker"
        assert a["unit"] == "Willow" and a["shift"] == e1["shift"].capitalize() and a["late"] == "yes"
        assert inst(a["rostered_start"]) == inst(e1["starts_at"]) and inst(a["clock_out"]) == inst(closed["clock_out_at"])
        assert a["worked_hours"] == hours2(secs(closed["clock_in_at"], closed["clock_out_at"]))
        m = next(r for r in rows if r["staff_number"] == e2["person"]["id"] and r["shift_date"] == e2["date"])
        assert m["clock_out"] == "" and m["worked_hours"] == "" and m["correction_note"] == APOSTROPHE + PLUS_NOTE and m["late"] == "no"
        assert inst(m["clock_in"]) == inst(missed["clock_in_at"])
        err(hr.req("POST", "/api/exports/timesheets", {"period": period, "home_ids": []}), 422, "validation", "home_ids")
        err(hr.req("POST", "/api/exports/timesheets", {"period": "September", "home_ids": ["larchfield"]}), 422, "validation", "period")
    finally:
        rename(worker, old)


def test_export_signed_download(app_url):
    hr = hr_api(app_url)
    period = month_of(today_of(hr) - timedelta(days=SICK_BACK_DAYS))
    export = hr.ok("POST", "/api/exports/timesheets", {"period": period, "home_ids": ["larchfield", "brackenmoor"]}, status=201)
    key = f"exports/timesheets/{period}/{export['id']}.csv"
    store = S3()
    poll(lambda: key in store.keys(f"exports/timesheets/{period}/"), STORAGE_DEADLINE_S, "stored export")
    link, got = download_csv(hr, export["id"])
    assert link["expires_in_seconds"] == LINK_SECONDS
    poll(lambda: hr.ok("GET", f"/api/exports/{export['id']}/download")["url"] != link["url"], FRESH_LINK_DEADLINE_S, "a fresh link")
    assert got.status_code == 200 and got.content == store.get(key)
    assert got.headers["content-type"] == "text/csv"
    name = f"timesheets-{period}.csv"
    assert got.headers["content-disposition"] == f"attachment; filename=\"{name}\"; filename*=UTF-8''{name}"
    assert export["id"] in {x["id"] for x in hr.ok("GET", "/api/exports")["items"]}
    err(Api(app_url, FENELLA).req("GET", f"/api/exports/{export['id']}/download"), 403, "forbidden")
    err(Api(app_url, "HV-0101").req("GET", f"/api/exports/{export['id']}/download"), 403, "forbidden")
    parts = urllib.parse.urlsplit(link["url"])
    second = hr.ok("POST", "/api/exports/timesheets", {"period": period, "home_ids": ["larchfield"]}, status=201)
    other = f"exports/timesheets/{period}/{second['id']}.csv"
    poll(lambda: other in store.keys(f"exports/timesheets/{period}/"), STORAGE_DEADLINE_S, "second stored export")
    assert httpx.get(parts._replace(path=parts.path.split("exports/")[0] + other).geturl(), timeout=HTTP_TIMEOUT).status_code == 403


def test_decision_emails(app_url, mail):
    hr = hr_api(app_url)
    fenella, idris = Api(app_url, FENELLA), Api(app_url, IDRIS)
    s, e = find_window(hr, fenella, 1, 30)
    a = make_leave(fenella, s, e, kind="annual")
    s2, e2 = find_window(hr, fenella, 1, (s - today_of(hr)).days + 1)
    b = make_leave(fenella, s2, e2, kind="compassionate")
    before = mail_ids(mail)
    me = email_of(FENELLA)
    try:
        idris.ok("POST", f"/api/leave-requests/{a['id']}/approve", {})
        hr.ok("POST", f"/api/leave-requests/{a['id']}/cancel", {"reason": "Inspection week"})
        idris.ok("POST", f"/api/leave-requests/{b['id']}/decline", {"reason": "Clashes with training"})
        want = {f"Leave approved: {long_date(s)} to {long_date(e)}": ("Annual leave", name_of(idris)),
                f"Approved leave cancelled: {long_date(s)} to {long_date(e)}": ("Annual leave", "Inspection week"),
                f"Leave declined: {long_date(s2)} to {long_date(e2)}": ("Compassionate leave", "Clashes with training")}
        mail_wait(mail, before, lambda m: m.get("Subject") in want, count=3)
        found = [m for m in mail.messages(settle=3) if m.get("ID") not in before and m.get("Subject") in want]
        assert sorted(m["Subject"] for m in found) == sorted(want)
        for m in found:
            assert addresses(m.get("To")) == [me] and rcpts(m) == [me]
            body = body_of(m)
            for part in want[m["Subject"]]:
                assert part in body
    finally:
        finish(hr, fenella, a["id"])
        finish(hr, fenella, b["id"])


def test_escalation_safe_headers(app_url, mail):
    hr = hr_api(app_url)
    priya, kwame = Api(app_url, "HV-0101"), Api(app_url, "HV-0104")
    old_p, old_k = name_of(priya), name_of(kwame)
    hostile, accented = "Priya\r\nBcc: spy@evil.example", "Siân Ó'Brien"
    ps, pe = find_window(hr, priya, 1, 20)
    ks, ke = find_window(hr, kwame, 1, 20)
    before = mail_ids(mail)
    reqs = []
    try:
        rename(priya, hostile)
        rename(kwame, accented)
        reqs = [(priya, make_leave(priya, ps, pe)), (kwame, make_leave(kwame, ks, ke))]
        draft_s, draft_e = find_window(hr, priya, 1, (ps - today_of(hr)).days + 2)
        draft = make_leave(priya, draft_s, draft_e, submit=False)
        reqs.append((priya, draft))
        with app_copy(ESCALATION_AFTER_SECONDS=ESCALATION_PROBE_S, SMTP_HOST="127.0.0.1", SMTP_PORT="9") as copy:
            down = Api(copy, FENELLA)
            poll(lambda: down.ok("GET", "/api/health")["mail"] == "down", ESCALATION_DEADLINE_S, "mail down on copy")
            for owner, r in reqs[:2]:
                poll(lambda r=r, owner=owner: owner.ok("GET", f"/api/leave-requests/{r['id']}")["status"] == "escalated", ESCALATION_DEADLINE_S, "escalation")
        assert priya.ok("GET", f"/api/leave-requests/{draft['id']}")["status"] == "draft"
        subjects = {f"Leave request awaiting decision: Priya Bcc: spy@evil.example, {long_date(ps)} to {long_date(pe)}",
                    f"Leave request awaiting decision: {accented}, {long_date(ks)} to {long_date(ke)}"}
        mail_wait(mail, before, lambda m: m.get("Subject") in subjects, count=2)
        found = [m for m in mail.messages(settle=3) if m.get("ID") not in before and m.get("Subject") in subjects]
        assert sorted(m["Subject"] for m in found) == sorted(subjects)
        for m in found:
            assert addresses(m.get("To")) == [email_of(FENELLA)] and rcpts(m) == [email_of(FENELLA)]
            assert "Rowan" in body_of(m)
        assert not any("spy@evil.example" in rcpts(m) for m in mail.messages() if m.get("ID") not in before)
        fen = Api(app_url, FENELLA)
        fen.ok("POST", f"/api/leave-requests/{reqs[1][1]['id']}/decline", {"reason": "Behind the queue"})
        assert mail_wait(mail, before, lambda m: m.get("Subject") == f"Leave declined: {long_date(ks)} to {long_date(ke)}")
    finally:
        rename(priya, old_p)
        rename(kwame, old_k)
        for owner, r in reqs:
            finish(hr, owner, r["id"])


def test_escalation_once(app_url, mail):
    hr = hr_api(app_url)
    joanna = Api(app_url, "HV-0105")
    who = name_of(joanna)
    s, e = find_window(hr, joanna, 1, 22)
    req = make_leave(joanna, s, e)
    s2, e2 = find_window(hr, joanna, 1, (s - today_of(hr)).days + 1)
    draft = make_leave(joanna, s2, e2, submit=False)
    s3, e3 = find_window(hr, joanna, 1, (s2 - today_of(hr)).days + 1)
    gone = make_leave(joanna, s3, e3)
    joanna.ok("POST", f"/api/leave-requests/{gone['id']}/withdraw", {})
    before = mail_ids(mail)
    today = today_of(hr)
    sick_reason = "Private reason " + token()
    sick = report_sickness(joanna, today, sick_reason)
    joanna.ok("POST", f"/api/sickness/{sick['id']}/return", {"last_sick_date": today.isoformat()})
    subject = f"Leave request awaiting decision: {who}, {long_date(s)} to {long_date(e)}"
    try:
        with app_copy(ESCALATION_AFTER_SECONDS=ESCALATION_PROBE_S, SMTP_HOST="127.0.0.1", SMTP_PORT="9"):
            poll(lambda: joanna.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "escalated", ESCALATION_DEADLINE_S, "escalation")
        mail_wait(mail, before, lambda m: m.get("Subject") == subject)
        found = [m for m in mail.messages(settle=3) if m.get("ID") not in before and m.get("Subject") == subject]
        assert len(found) == 1
        assert addresses(found[0].get("To")) == [email_of(FENELLA)] and rcpts(found[0]) == [email_of(FENELLA)]
        body = body_of(found[0])
        for part in (who, "Rowan", "Unpaid leave"):
            assert part in body, part
        assert long_date(s) in body or s.isoformat() in body
        for m in mail.messages():
            if m.get("ID") not in before:
                assert sick_reason not in body_of(m) and sick_reason not in m.get("Subject", "")
        assert joanna.ok("GET", f"/api/leave-requests/{draft['id']}")["status"] == "draft"
        assert joanna.ok("GET", f"/api/leave-requests/{gone['id']}")["status"] == "withdrawn"
        assert not any(long_date(s3) in m.get("Subject", "") and "awaiting decision" in m.get("Subject", "")
                       for m in mail.messages() if m.get("ID") not in before)
    finally:
        for r in (req, draft, gone):
            finish(hr, joanna, r["id"])


def test_mail_and_storage_outages(app_url, mail):
    mail_down, store_down = os.environ["APP_MAILPIT_DOWN_URL"], os.environ["APP_MINIO_DOWN_URL"]
    hr = hr_api(app_url)
    assert httpx.get(mail_down.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT).json()["mail"] == "down"
    assert httpx.get(store_down.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT).json()["storage"] == "down"
    fen_down = Api(mail_down, FENELLA)
    s, e = find_window(hr, fen_down, 1, 33)
    req = make_leave(fen_down, s, e)
    before = mail_ids(mail)
    try:
        assert Api(mail_down, IDRIS).ok("POST", f"/api/leave-requests/{req['id']}/approve", {})["status"] == "approved"
        found = mail_wait(mail, before, lambda m: m.get("Subject") == f"Leave approved: {long_date(s)} to {long_date(e)}")
        assert len(found) == 1 and addresses(found[0].get("To")) == [email_of(FENELLA)]
    finally:
        finish(hr, Api(app_url, FENELLA), req["id"])
    worker = Api(store_down, "HV-0216")
    start = today_of(hr) - timedelta(days=SICK_BACK_DAYS - 4)
    rec = report_sickness(worker, start)
    try:
        r = upload(worker, rec["id"], pdf_bytes(), "held.pdf")
        assert r.status_code == 201 and r.json()["fit_note"]["storage"] == "pending"
        err(worker.req("GET", f"/api/sickness/{rec['id']}/fit-note"), 409, "storage_pending")
        hr_down = Api(store_down, HR_ID)
        export = hr_down.ok("POST", "/api/exports/timesheets", {"period": month_of(start), "home_ids": ["brackenmoor"]}, status=201)
        assert export["storage"] == "pending"
        err(hr_down.req("GET", f"/api/exports/{export['id']}/download"), 409, "storage_pending")
        main = Api(app_url, "HV-0216")
        poll(lambda: main.ok("GET", f"/api/sickness/{rec['id']}")["fit_note"]["storage"] == "stored", STORAGE_DEADLINE_S, "held upload stored")
        assert S3().keys(f"fit-notes/brackenmoor/{rec['id']}/")
        assert httpx.get(main.ok("GET", f"/api/sickness/{rec['id']}/fit-note")["url"], timeout=HTTP_TIMEOUT).content == pdf_bytes()
        poll(lambda: next(x for x in hr.ok("GET", "/api/exports")["items"] if x["id"] == export["id"])["storage"] == "stored", STORAGE_DEADLINE_S, "held export")
    finally:
        worker.req("POST", f"/api/sickness/{rec['id']}/return", {"last_sick_date": start.isoformat()})


SIZES = [(375, 812), (768, 1024), (1280, 800)]
ROLE_SCREENS = {
    "HV-0102": ["/shifts", "/leave/new", "/leave", "/sickness", "/rota", "/profile"],
    FEMI: ["/shifts", "/cover", "/accrual"],
    FENELLA: ["/queue", "/today", "/floors", "/attendance", "/audit"],
    HR_ID: ["/pay-periods", "/exports", "/rota"],
}


def test_responsive_layouts(app_url, browser):
    for sid, paths in ROLE_SCREENS.items():
        with ui(browser, app_url, sid, paths[0]) as page:
            for w, h in SIZES:
                page.set_viewport_size({"width": w, "height": h})
                for path in paths:
                    page.goto(app_url.rstrip("/") + path)
                    page.wait_for_load_state("networkidle")
                    expect(page).not_to_have_url(re.compile(r"/sign-in"))
                    no_sideways_scroll(page)
                if sid == FENELLA:
                    page.goto(app_url.rstrip("/") + "/queue")
                    drawer = page.get_by_role("button", name="Homes and units")
                    if w == 375:
                        expect(drawer).to_be_visible()
                        click(drawer)
                    expect(page.get_by_role("navigation", name="Homes and units")).to_be_visible()


def test_wf_cross_cutting_sign_in(app_url, browser):
    with open_app(browser, app_url.rstrip("/") + "/sign-in") as page:
        page.clock.resume()
        expect(page.get_by_text("Sign in to Tallow Cover")).to_be_visible()
        fill(page.get_by_role("textbox", name="Email"), email_of("HV-0105"))
        fill(page.get_by_label("Password"), PASSWORD + "x")
        click(page.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("status", name="Sign-in status")).to_have_text(MESSAGES["invalid_credentials"])
        fill(page.get_by_label("Password"), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("navigation", name="Main")).to_be_visible()
        cookie = next(c for c in page.context.cookies() if c["name"] == "tallow_session")
        assert cookie["httpOnly"] is True
        assert page.request.get(app_url.rstrip("/") + "/api/me").json()["id"] == "HV-0105"
        click(page.get_by_role("button", name="Sign out"))
        poll(lambda: page.request.get(app_url.rstrip("/") + "/api/me").status == 401, HTTP_TIMEOUT, "signed out")


def test_wf_cross_cutting_same_origin_shell(app_url, browser):
    with ui(browser, app_url, FENELLA, "/today") as page:
        seen = []
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/queue", "/floors", "/audit", "/today"):
            page.goto(app_url.rstrip("/") + path)
            expect(page.get_by_role("navigation", name="Main")).to_be_visible()
            no_sideways_scroll(page)
        assert seen and all(same_origin(u, app_url) for u in seen if urllib.parse.urlsplit(u).netloc), seen


def test_wf_clock_in_out_happy(app_url, browser):
    hr = hr_api(app_url)
    worker, entry = current_candidate(app_url, hr)
    with ui(browser, app_url, worker.id, "/shifts", size=(375, 812)) as page:
        expect(page.get_by_role("list", name="Upcoming shifts")).to_be_visible()
        click(page.get_by_role("button", name="Clock in"))
        status = page.get_by_role("status", name="Clock status")
        expect(status).to_contain_text("Clocked in at")
        att = my_attendance(worker, entry["assignment_id"])[0]
        lead = f"Clocked in at {hhmm(att['clock_in_at'])}"
        expect(status).to_contain_text(lead)
        if not att["late"]:
            expect(status).to_have_text(f"{lead} for {label(date.fromisoformat(entry['date']), entry['shift'])}.")
        click(page.get_by_role("button", name="Clock out"))
        expect(status).to_contain_text("Clocked out at")
        done = my_attendance(worker, entry["assignment_id"])
        assert len(done) == 1 and done[0]["worked_hours"] is not None
        expect(status).to_have_text(re.compile(rf"^Clocked out at {hhmm(done[0]['clock_out_at'])}\. You worked \d+\.\d{{2}} hours\.$"))
        shown = re.search(r"You worked (\d+\.\d{2}) hours", status.inner_text()).group(1)
        assert hours_match(shown, secs(done[0]["clock_in_at"], done[0]["clock_out_at"]))
        expect(page.get_by_role("button", name="Clock in")).to_be_visible()


def test_wf_clock_in_out_two_devices(app_url, browser):
    hr = hr_api(app_url)
    worker, entry = current_candidate(app_url, hr)
    try:
        with ui(browser, app_url, worker.id, "/shifts", size=(768, 1024)) as tablet, ui(browser, app_url, worker.id, "/shifts", size=(375, 812)) as phone:
            expect(phone.get_by_role("button", name="Clock in")).to_be_visible()
            btn = tablet.get_by_role("button", name="Clock in")
            with held(tablet, f"**{PUNCHES_PATH}") as hold:
                btn.dblclick()
                expect(tablet.get_by_role("status", name="Clock status")).to_have_text("Clocking in…")
                hold.release()
            expect(tablet.get_by_role("button", name="Clock out")).to_be_visible()
            click(phone.get_by_role("button", name="Clock in"))
            expect(phone.get_by_role("status", name="Clock status")).to_have_text(MESSAGES["already_clocked_in"])
            phone.clock.fast_forward(SHIFTS_REFRESH_MS)
            expect(phone.get_by_role("button", name="Clock out")).to_be_visible()
        rows = my_attendance(worker, entry["assignment_id"])
        assert len(rows) == 1 and rows[0]["version"] == 1
    finally:
        punch(worker, "out")


def test_wf_leave_request_draft_submit(app_url, browser):
    hr = hr_api(app_url)
    priya = Api(app_url, "HV-0101")
    s, e = find_window(hr, priya, 3, 42)
    try:
        with ui(browser, app_url, "HV-0101", "/leave/new") as page:
            select(page.get_by_role("combobox", name="Leave type"), "Annual leave")
            fill_date(page.get_by_label("First day"), s)
            fill_date(page.get_by_label("Last day"), e)
            fill(page.get_by_role("textbox", name="Note"), LEAVE_NOTE)
            click(page.get_by_role("button", name="Save draft"))
            status = page.get_by_role("status", name="Leave status")
            expect(status).to_have_text("Draft saved.")
            click(page.get_by_role("button", name="Submit request"))
            expect(status).to_contain_text(f"Request sent to {HOMES['larchfield']}.")
            page.goto(app_url.rstrip("/") + "/leave")
            expect(page.get_by_role("list", name="My requests").get_by_role("link", name=f"Annual leave, {long_date(s)} to {long_date(e)}, Submitted")).to_be_visible()
        mine = [i for i in priya.ok("GET", "/api/me/leave-requests")["items"] if i["start_date"] == s.isoformat() and i["end_date"] == e.isoformat() and i["status"] in ("draft", "submitted")]
        assert [i["status"] for i in mine] == ["submitted"]
        assert mine[0]["note"] == LEAVE_NOTE and Decimal(mine[0]["hours"]) == sum(Decimal(x["hours"]) for x in rota_entries(hr, "larchfield-rowan", s, e) if x["person"]["id"] == "HV-0101")
    finally:
        for i in priya.ok("GET", "/api/me/leave-requests")["items"]:
            if i["start_date"] == s.isoformat():
                finish(hr, priya, i["id"])


def test_wf_leave_request_fix_and_withdraw(app_url, browser):
    hr = hr_api(app_url)
    ellis = Api(app_url, "HV-0106")
    s, e = find_window(hr, ellis, 2, 48)
    with ui(browser, app_url, "HV-0106", "/leave/new") as page:
        select(page.get_by_role("combobox", name="Leave type"), "Unpaid leave")
        fill_date(page.get_by_label("First day"), e)
        fill_date(page.get_by_label("Last day"), s)
        click(page.get_by_role("button", name="Submit request"))
        expect(page.get_by_text("The last day can't be before the first day.").first).to_be_visible()
        fill_date(page.get_by_label("First day"), s)
        fill_date(page.get_by_label("Last day"), e)
        click(page.get_by_role("button", name="Submit request"))
        expect(page.get_by_role("status", name="Leave status")).to_contain_text(f"Request sent to {HOMES['larchfield']}.")
        rid = next(i["id"] for i in ellis.ok("GET", "/api/me/leave-requests")["items"] if i["start_date"] == s.isoformat() and i["status"] == "submitted")
        page.goto(app_url.rstrip("/") + f"/leave/{rid}")
        click(page.get_by_role("button", name="Withdraw request"))
        expect(page.get_by_role("status", name="Leave status")).to_have_text("Request withdrawn.")
    assert ellis.ok("GET", f"/api/leave-requests/{rid}")["status"] == "withdrawn"


def test_wf_sickness_fit_note_happy(app_url, browser):
    hr = hr_api(app_url)
    owen = Api(app_url, "HV-0214")
    today = today_of(hr)
    start = today - timedelta(days=FIT_NOTE_DAYS + 2)
    before = {x["id"] for x in owen.ok("GET", "/api/me/sickness")["items"]}
    with ui(browser, app_url, "HV-0214", "/sickness") as page:
        fill_date(page.get_by_label("First day off sick"), start)
        fill(page.get_by_role("textbox", name="Reason"), "Chest infection")
        click(page.get_by_role("button", name="Report sickness"))
        expect(page.get_by_role("status", name="Sickness status")).to_have_text("Sickness reported. Please upload a fit note — you've been off more than 7 days.")
        rid = next(x["id"] for x in owen.ok("GET", "/api/me/sickness")["items"] if x["id"] not in before)
        page.goto(app_url.rstrip("/") + f"/sickness/{rid}")
        expect(page.get_by_text("Fit note required")).to_be_visible()
        page.get_by_label("Fit note file").set_input_files({"name": FIT_NOTE_NAME, "mimeType": "application/pdf", "buffer": pdf_bytes()})
        click(page.get_by_role("button", name="Upload fit note"))
        expect(page.get_by_role("status", name="Sickness status")).to_have_text("Fit note received. It is being stored securely.")
        expect(page.get_by_text("Evidenced")).to_be_visible()
        poll(lambda: owen.ok("GET", f"/api/sickness/{rid}")["fit_note"]["storage"] == "stored", STORAGE_DEADLINE_S, "stored")
        download = download_via(page, lambda: click(page.get_by_role("link", name="Open fit note")))
        assert download.suggested_filename == FIT_NOTE_NAME
        fill_date(page.get_by_label("Last day off sick"), today)
        click(page.get_by_role("button", name="I'm back at work"))
        expect(page.get_by_role("status", name="Sickness status")).to_have_text("Welcome back. Sickness record closed.")
    rec = owen.ok("GET", f"/api/sickness/{rid}")
    assert rec["status"] == "closed" and rec["last_sick_date"] == today.isoformat()
    assert S3().keys(f"fit-notes/brackenmoor/{rid}/")


def test_wf_sickness_fit_note_bad_file(app_url, browser):
    hr = hr_api(app_url)
    kemi = Api(app_url, "HV-0216")
    start = today_of(hr) - timedelta(days=FIT_NOTE_DAYS + 4)
    rec = report_sickness(kemi, start)
    try:
        with ui(browser, app_url, "HV-0216", f"/sickness/{rec['id']}") as page:
            page.get_by_label("Fit note file").set_input_files({"name": "note.svg", "mimeType": "image/svg+xml", "buffer": b"<svg xmlns='http://www.w3.org/2000/svg'/>"})
            click(page.get_by_role("button", name="Upload fit note"))
            expect(page.get_by_role("status", name="Sickness status")).to_contain_text(MESSAGES["unsupported_file"])
            assert kemi.ok("GET", f"/api/sickness/{rec['id']}")["status"] == "fit_note_required"
            assert S3().keys(f"fit-notes/brackenmoor/{rec['id']}/") == []
            page.get_by_label("Fit note file").set_input_files({"name": "photo.png", "mimeType": "image/png", "buffer": PNG_BYTES})
            click(page.get_by_role("button", name="Upload fit note"))
            expect(page.get_by_text("Evidenced")).to_be_visible()
        assert kemi.ok("GET", f"/api/sickness/{rec['id']}")["status"] == "evidenced"
    finally:
        kemi.req("POST", f"/api/sickness/{rec['id']}/return", {"last_sick_date": start.isoformat()})


def test_wf_team_rota_swap_rename(app_url, browser):
    hr = hr_api(app_url)
    tom = Api(app_url, "HV-0102")
    old = name_of(tom)
    new = f"Tomasz {token()}"
    tue = monday(today_of(hr)) + timedelta(days=8)
    early = next(x for x in rota_entries(hr, "larchfield-rowan", tue, tue) if x["person"]["id"] == "HV-0102" and x["shift"] == "early")
    try:
        with ui(browser, app_url, FENELLA, "/rota") as page:
            open_rota_unit(page, app_url, "Rowan", name_of(Api(app_url, "HV-0101")))
            click(page.get_by_role("button", name="Next week"))
            click(page.get_by_role("button", name=f"Remove {old} from {label(tue, 'early')}"))
            expect(page.get_by_role("status", name="Rota status")).to_have_text(f"{old} removed from {label(tue, 'early')}.")
            click(page.get_by_role("button", name=f"Add to {label(tue, 'late')}"))
            dialog = page.get_by_role("dialog", name="Add to shift")
            box = dialog.get_by_role("combobox", name="Colleague")
            pick_colleague(page, box, old)
            click(dialog.get_by_role("button", name="Add to shift"))
            expect(page.get_by_role("status", name="Rota status")).to_have_text(f"{old} added to {label(tue, 'late')}.")
        with ui(browser, app_url, "HV-0102", "/profile") as page:
            fill(page.get_by_role("textbox", name="Display name"), new)
            click(page.get_by_role("button", name="Save name"))
            expect(page.get_by_role("status", name="Profile status")).to_have_text("Name updated.")
        with ui(browser, app_url, "HV-0103", "/rota") as page:
            click(page.get_by_role("button", name="Next week"))
            table = page.get_by_role("table", name="Team rota")
            expect(table).to_contain_text(new)
            expect(table).not_to_contain_text(old)
        rows = [x for x in rota_entries(Api(app_url, "HV-0103"), "larchfield-rowan", tue, tue) if x["person"]["id"] == "HV-0102"]
        assert [(x["shift"], x["person"]["display_name"]) for x in rows] == [("late", new)]
    finally:
        rename(tom, old)
        for x in rota_entries(hr, "larchfield-rowan", tue, tue):
            if x["person"]["id"] == "HV-0102" and x["shift"] == "late":
                remove_quietly(hr, x["assignment_id"])
        if not any(x["person"]["id"] == "HV-0102" and x["shift"] == "early" for x in rota_entries(hr, "larchfield-rowan", tue, tue)):
            add_assignment(hr, "HV-0102", "larchfield-rowan", tue, "early")
        assert early


def test_wf_team_rota_away(app_url, browser):
    hr = hr_api(app_url)
    zofia = Api(app_url, "HV-0126")
    s, e = find_window(hr, zofia, 1, 8, unit="larchfield-willow", shift="late")
    req = make_leave(zofia, s, e)
    try:
        hr.ok("POST", f"/api/leave-requests/{req['id']}/approve", {"override_reason": "Agreed"})
        weeks = (monday(s) - monday(today_of(hr))).days // 7
        with ui(browser, app_url, "HV-0123", "/rota") as page:
            for _ in range(weeks):
                click(page.get_by_role("button", name="Next week"))
            table = page.get_by_role("table", name="Team rota")
            expect(table.get_by_role("cell").filter(has_text=name_of(zofia)).filter(has_text="away").first).to_be_visible()
            for word in ("Unpaid leave", "unpaid", "sickness", "remaining"):
                expect(table).not_to_contain_text(word)
        row = next(x for x in rota_entries(Api(app_url, "HV-0123"), "larchfield-willow", s, s) if x["person"]["id"] == "HV-0126")
        assert row["status"] == "away" and "absence_kind" not in row
    finally:
        finish(hr, zofia, req["id"])


def test_wf_approval_queue_decline(app_url, browser, mail):
    hr = hr_api(app_url)
    tom = Api(app_url, "HV-0102")
    s, e = find_window(hr, tom, 1, 57)
    req = make_leave(tom, s, e)
    before = mail_ids(mail)
    try:
        with ui(browser, app_url, FENELLA, "/queue") as page:
            filters = page.get_by_role("group", name="Queue filters")
            select(filters.get_by_role("combobox", name="Home"), "Larchfield House")
            select(filters.get_by_role("combobox", name="Status"), "Submitted")
            expect(page.get_by_role("region", name="Queue counts")).to_contain_text("Submitted")
            click(page.get_by_role("listbox", name="Requests").get_by_role("option", name=f"{name_of(tom)}, Unpaid leave, {long_date(s)} to {long_date(e)}, Submitted"))
            click(page.get_by_role("button", name="Decline"))
            dialog = page.get_by_role("dialog", name="Decline request")
            fill(dialog.get_by_role("textbox", name="Reason"), QUEUE_DECLINE)
            click(dialog.get_by_role("button", name="Confirm decline"))
            expect(page.get_by_role("status", name="Queue status")).to_have_text(f"Declined. {name_of(tom)} will be emailed the decision.")
        got = tom.ok("GET", f"/api/leave-requests/{req['id']}")
        assert got["status"] == "declined" and got["decision_reason"] == QUEUE_DECLINE
        assert mail_wait(mail, before, lambda m: m.get("Subject") == f"Leave declined: {long_date(s)} to {long_date(e)}" and email_of("HV-0102") in rcpts(m))
    finally:
        finish(hr, tom, req["id"])


def test_wf_approval_queue_approve(app_url, browser, mail):
    hr = hr_api(app_url)
    idris = Api(app_url, IDRIS)
    s, e = find_window(hr, idris, 1, 62)
    req = make_leave(idris, s, e)
    before = mail_ids(mail)
    try:
        with ui(browser, app_url, FENELLA, queue_url(req["id"])) as page:
            expect(page.get_by_role("group", name="Staffing strip")).to_contain_text(f"{name_of(idris)} isn't on a unit rota, so approving changes no shift.")
            expect(page.get_by_role("button", name="Preview approval")).to_be_disabled()
            click(page.get_by_role("button", name="Approve", exact=True))
            expect(page.get_by_role("status", name="Queue status")).to_have_text(f"Approved. {name_of(idris)} will be emailed the decision.")
        assert idris.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "approved"
        assert mail_wait(mail, before, lambda m: m.get("Subject") == f"Leave approved: {long_date(s)} to {long_date(e)}" and email_of(IDRIS) in rcpts(m))
    finally:
        finish(hr, idris, req["id"])


def test_wf_floor_drop_cover_and_approve(app_url, browser, mail):
    hr = hr_api(app_url)
    priya, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0101", 160, free=(FEMI,), days=3)
    before = mail_ids(mail)
    try:
        with ui(browser, app_url, FENELLA, queue_url(req["id"])) as page:
            click(page.get_by_role("button", name="Preview approval"))
            for i in range(3):
                d = s + timedelta(days=i)
                slot = page.get_by_role("button", name=re.compile(rf"^Post cover for {re.escape(label(d, shift))} \(senior\)$", re.I))
                tap(slot)
                expect(slot).to_contain_text("cover posted")
            assert priya.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "cover_pending"
            femi = Api(app_url, FEMI)
            for c in [c for c in femi.ok("GET", "/api/cover-shifts")["items"] if s.isoformat() <= c["date"] <= e.isoformat() and c["unit"]["id"] == unit]:
                assert claim(femi, c["id"]).status_code == 200
            pv = preview(hr, req["id"])
            cells = strip_cells(page)
            for i, x in enumerate(pv["shifts"]):
                expect(cells.nth(i)).to_have_accessible_name(cell_name(x, True), timeout=QUEUE_REFRESH_MS * 2)
            approve = page.get_by_role("button", name="Approve", exact=True)
            expect(approve).to_be_enabled()
            click(approve)
            expect(page.get_by_role("status", name="Queue status")).to_have_text(f"Approved. {name_of(priya)} will be emailed the decision.")
        assert priya.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "approved"
        assert mail_wait(mail, before, lambda m: m.get("Subject") == f"Leave approved: {long_date(s)} to {long_date(e)}")
    finally:
        finish(hr, priya, req["id"])
        for x in rota_entries(hr, unit, s, e):
            if x["person"]["id"] == FEMI:
                remove_quietly(hr, x["assignment_id"])


def test_wf_floor_drop_override(app_url, browser):
    hr = hr_api(app_url)
    kwame, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0104", 170)
    try:
        with ui(browser, app_url, FENELLA, queue_url(req["id"])) as page:
            expect(page.get_by_role("button", name="Approve", exact=True)).to_be_disabled()
            click(page.get_by_role("button", name="Approve with override"))
            dialog = page.get_by_role("dialog", name="Approve with override")
            expect(dialog).to_contain_text(short_label(s, shift))
            fill(dialog.get_by_role("textbox", name="Override reason"), OVERRIDE_UI)
            click(dialog.get_by_role("button", name="Confirm approval"))
            expect(page.get_by_role("status", name="Queue status")).to_have_text(f"Approved. {name_of(kwame)} will be emailed the decision.")
        assert kwame.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "approved"
        assert any(x["action"] == "floor_override" and x["reason"] == OVERRIDE_UI for x in audit_for(hr, "larchfield", req["id"]))
    finally:
        finish(hr, kwame, req["id"])


def test_wf_bank_cover_claim_happy(app_url, browser):
    hr = hr_api(app_url)
    tom, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0102", 3, free=(CARYS,))
    try:
        cover = Api(app_url, FENELLA).ok("POST", f"/api/leave-requests/{req['id']}/covers", {"date": s.isoformat(), "shift": shift, "skill": "carer"}, status=201)
        name = f"Claim {label(s, shift)} at Larchfield House"
        with ui(browser, app_url, CARYS, "/cover", size=(375, 812)) as page:
            click(page.get_by_role("list", name="Open cover shifts").get_by_role("button", name=name))
            expect(page.get_by_role("status", name="Cover status")).to_have_text(f"Shift claimed: {label(s, shift)} at Larchfield House.")
            expect(page.get_by_role("button", name=name)).to_have_count(0)
            if (s - today_of(hr)).days < UPCOMING_DAYS:
                page.goto(app_url.rstrip("/") + "/shifts")
                expect(page.get_by_role("list", name="Upcoming shifts")).to_contain_text(label(s, shift))
        assert CARYS in {x["person"]["id"] for x in rota_entries(hr, unit, s, s) if x["shift"] == shift}
        assert cover["id"] not in {c["id"] for c in Api(app_url, MATEUSZ).ok("GET", "/api/cover-shifts")["items"]}
    finally:
        finish(hr, tom, req["id"])
        for x in rota_entries(hr, unit, s, e):
            if x["person"]["id"] == CARYS:
                remove_quietly(hr, x["assignment_id"])


def test_wf_bank_cover_claim_taken(app_url, browser):
    hr = hr_api(app_url)
    tom, req, s, e, unit, shift = cover_request(app_url, hr, "HV-0102", 10, free=(CARYS, MATEUSZ))
    try:
        cover = Api(app_url, FENELLA).ok("POST", f"/api/leave-requests/{req['id']}/covers", {"date": s.isoformat(), "shift": shift, "skill": "carer"}, status=201)
        name = f"Claim {label(s, shift)} at Larchfield House"
        with ui(browser, app_url, MATEUSZ, "/cover") as page:
            button = page.get_by_role("button", name=name)
            expect(button).to_be_visible()
            with held(page, f"**/api/cover-shifts/{cover['id']}/claim") as hold:
                click(button)
                assert claim(Api(app_url, CARYS), cover["id"]).status_code == 200
                hold.release()
            expect(page.get_by_role("status", name="Cover status")).to_have_text(MESSAGES["already_taken"])
            expect(page.get_by_role("button", name=name)).to_have_count(0)
        assert MATEUSZ not in {x["person"]["id"] for x in rota_entries(hr, unit, s, s)}
    finally:
        finish(hr, tom, req["id"])
        for x in rota_entries(hr, unit, s, e):
            if x["person"]["id"] in BANK:
                remove_quietly(hr, x["assignment_id"])


def test_wf_home_today_acknowledge(app_url, browser):
    hr = hr_api(app_url)
    waiting = {x["person"]["id"] for x in Api(app_url, FENELLA).ok("GET", "/api/homes/larchfield/today")["late_clock_ins"]}
    e = past_assignment(hr, "larchfield-rowan", range(1, 6), exclude=waiting)
    att = hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"]) + timedelta(minutes=LATE_GRACE_MIN + 7)),
                                            "clock_out_at": london_iso(inst(e["ends_at"])), "reason": "Late arrival"}, status=201)
    who = att["person"]["display_name"]
    with ui(browser, app_url, FENELLA, "/today") as page:
        t = Api(app_url, FENELLA).ok("GET", "/api/homes/larchfield/today")
        expect(page.get_by_role("heading", name=f"Today, {long_date(date.fromisoformat(t['date']))}")).to_be_visible()
        expect(page.get_by_text(f"{t['totals']['on_duty']} on duty · {t['totals']['below_floor']} shifts below floor")).to_be_visible()
        expect(page.get_by_role("table", name="Staffing today")).to_contain_text("Rowan")
        click(page.get_by_role("list", name="Late clock-ins").get_by_role("button", name=f"Acknowledge {who}").first)
        expect(page.get_by_role("status", name="Today status")).to_have_text("Acknowledged.")
    got = next(a for a in attendance_on(hr, "larchfield", date.fromisoformat(e["date"])) if a["id"] == att["id"])
    assert got["late_acknowledged"] is True and got["version"] == 2


def test_wf_home_today_rota_add(app_url, browser):
    hr = hr_api(app_url)
    today = today_of(hr)
    free = [p for p in (CARYS, MATEUSZ) if not busy(hr, {p}, today, {})]
    assert free, "no free bank carer today"
    pid = free[0]
    who = name_of(Api(app_url, pid))

    def late_count():
        units = hr.ok("GET", "/api/homes/larchfield/today")["units"]
        return next(s["on_duty"] for u in units if u["unit_id"] == "larchfield-rowan" for s in u["shifts"] if s["shift"] == "late")

    base = late_count()
    try:
        with ui(browser, app_url, FENELLA, "/rota") as page:
            open_rota_unit(page, app_url, "Rowan", name_of(Api(app_url, "HV-0101")))
            click(page.get_by_role("button", name=f"Add to {label(today, 'late')}"))
            dialog = page.get_by_role("dialog", name="Add to shift")
            box = dialog.get_by_role("combobox", name="Colleague")
            pick_colleague(page, box, who)
            click(dialog.get_by_role("button", name="Add to shift"))
            expect(page.get_by_role("status", name="Rota status")).to_have_text(f"{who} added to {label(today, 'late')}.")
            assert late_count() == base + 1
            click(page.get_by_role("button", name=f"Remove {who} from {label(today, 'late')}"))
            expect(page.get_by_role("status", name="Rota status")).to_have_text(f"{who} removed from {label(today, 'late')}.")
        assert late_count() == base
    finally:
        for x in rota_entries(hr, "larchfield-rowan", today, today):
            if x["person"]["id"] == pid:
                remove_quietly(hr, x["assignment_id"])


def floor_form(page, name, needle):
    forms = page.get_by_role("form", name=name)
    return forms.first if forms.count() == 1 else forms.filter(has_text=needle).first


def test_wf_floors_policy_floor_version(app_url, browser):
    hr = hr_api(app_url)
    versions = hr.ok("GET", "/api/homes/larchfield/floors")["versions"]
    d = free_far_date({v["effective_from"] for v in versions})
    with ui(browser, app_url, HR_ID, "/floors") as page:
        form = floor_form(page, "New floor version", "Rowan")
        select(form.get_by_role("combobox", name="Unit"), "Rowan")
        select(form.get_by_role("combobox", name="Shift"), "Night")
        fill(form.get_by_role("spinbutton", name="Minimum staff"), "4")
        fill(form.get_by_role("spinbutton", name="Minimum seniors"), "1")
        fill_date(form.get_by_label("Effective from"), d)
        click(form.get_by_role("button", name="Save floor version"))
        expect(page.get_by_role("status", name="Admin status")).to_have_text(f"Floor version saved. It applies from {long_date(d)}.")
        expect(page.get_by_role("table", name="Floor versions")).to_be_visible()
    rows = [v for v in hr.ok("GET", "/api/homes/larchfield/floors")["versions"] if v["unit_id"] == "larchfield-rowan" and v["shift"] == "night"]
    assert any(v["effective_from"] == d.isoformat() and v["min_staff"] == 4 for v in rows)
    assert any(v["effective_from"] < d.isoformat() for v in rows)


def test_wf_floors_policy_leave_policy(app_url, browser):
    hr = hr_api(app_url)
    homes = ("larchfield", "brackenmoor")
    used = {v["effective_from"] for h in homes for v in hr.ok("GET", f"/api/homes/{h}/leave-policy")["versions"]}
    d = free_far_date(used)
    with ui(browser, app_url, HR_ID, "/floors") as page:
        form = page.get_by_role("form", name="New leave policy").first
        fill(form.get_by_role("spinbutton", name="Notice multiplier"), "3")
        fill_date(form.get_by_label("Effective from"), d)
        click(form.get_by_role("button", name="Save leave policy"))
        expect(page.get_by_role("status", name="Admin status")).to_have_text(f"Leave policy saved. It applies from {long_date(d)}.")
        expect(page.get_by_role("table", name="Leave policy versions")).to_be_visible()
    added = [v for h in homes for v in hr.ok("GET", f"/api/homes/{h}/leave-policy")["versions"] if v["effective_from"] == d.isoformat()]
    assert len(added) == 1 and added[0]["notice_multiplier"] == 3


def test_wf_attendance_corrections_missed(app_url, browser):
    hr = hr_api(app_url)
    e = past_assignment(hr, "larchfield-willow", range(1, 6))
    att = hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"])),
                                            "clock_out_at": None, "reason": "Missed"}, status=201)
    d = date.fromisoformat(e["date"])
    who, lbl = att["person"]["display_name"], label(d, e["shift"])
    end = inst(e["ends_at"]).astimezone(LONDON)
    with ui(browser, app_url, FENELLA, "/today") as page:
        click(page.get_by_role("list", name="Missed clock-outs").get_by_role("link", name=f"Correct {who} {lbl}"))
        expect(page).to_have_url(re.compile(rf"/attendance\?home=larchfield&date={d.isoformat()}"))
        click(page.get_by_role("button", name=f"Correct {who} {lbl}"))
        dialog = page.get_by_role("dialog", name="Correct attendance")
        fill_datetime(dialog.get_by_label("Clock out"), end)
        fill(dialog.get_by_role("textbox", name="Reason"), PHONE_FIX)
        click(dialog.get_by_role("button", name="Save correction"))
        expect(page.get_by_role("status", name="Admin status")).to_have_text("Attendance corrected.")
    got = next(a for a in attendance_on(hr, "larchfield", d) if a["id"] == att["id"])
    assert got["missed_clock_out"] is False and inst(got["clock_out_at"]) == inst(e["ends_at"]) and got["version"] == 2
    assert att["id"] not in {x["id"] for x in hr.ok("GET", "/api/homes/larchfield/today")["missed_clock_outs"]}
    assert any(x["action"] == "attendance_corrected" and x["reason"] == PHONE_FIX for x in audit_for(hr, "larchfield", att["id"]))


def test_wf_attendance_corrections_stale(app_url, browser):
    hr = hr_api(app_url)
    e = past_assignment(hr, "larchfield-rowan", range(1, 6))
    att = hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"])),
                                            "clock_out_at": None, "reason": "Missed"}, status=201)
    d = date.fromisoformat(e["date"])
    who, lbl = att["person"]["display_name"], label(d, e["shift"])
    with ui(browser, app_url, FENELLA, f"/attendance?home=larchfield&date={d.isoformat()}") as page:
        click(page.get_by_role("button", name=f"Correct {who} {lbl}"))
        dialog = page.get_by_role("dialog", name="Correct attendance")
        hr.ok("PATCH", f"/api/attendance/{att['id']}", {"clock_in_at": att["clock_in_at"], "clock_out_at": london_iso(inst(e["ends_at"])),
                                                        "reason": HR_FIX}, headers={"If-Match": '"1"'})
        fill_datetime(dialog.get_by_label("Clock out"), (inst(e["ends_at"]) + timedelta(hours=1)).astimezone(LONDON))
        fill(dialog.get_by_role("textbox", name="Reason"), "Manager guess")
        click(dialog.get_by_role("button", name="Save correction"))
        expect(page.get_by_role("status", name="Admin status")).to_have_text(MESSAGES["stale_version"])
        expect(dialog).to_be_visible()
        poll(lambda: shows_instant(dialog.get_by_label("Clock out").input_value(), inst(e["ends_at"]).astimezone(LONDON)),
             HTTP_TIMEOUT, "Clock out refilled from the current record")
    corrected = [x for x in audit_for(hr, "larchfield", att["id"]) if x["action"] == "attendance_corrected"]
    assert len(corrected) == 1 and corrected[0]["reason"] == HR_FIX


def test_wf_accrual_payperiod_pending(app_url, browser):
    hr = hr_api(app_url)
    today = today_of(hr)
    femi = Api(app_url, FEMI)
    days = ([today - timedelta(days=k) for k in range(1, 31) if (today - timedelta(days=k)).month == today.month]
            + [today + timedelta(days=k) for k in range(0, 31) if (today + timedelta(days=k)).month == today.month])
    e = next((r.json() for d in days for sh in ("early", "late")
              if (r := add_assignment(hr, FEMI, "larchfield-willow", d, sh)).status_code == 201), None)
    assert e, "no free Willow shift for Femi this month"
    day = date.fromisoformat(e["date"])
    before = ledger(femi)["open_period"]
    att = hr.ok("POST", "/api/attendance", {"assignment_id": e["assignment_id"], "clock_in_at": london_iso(inst(e["starts_at"])),
                                            "clock_out_at": None, "reason": "Forgot"}, status=201)
    if att["missed_clock_out"]:
        assert ledger(femi)["open_period"] == before
    with ui(browser, app_url, HR_ID, f"/attendance?home=larchfield&date={day.isoformat()}") as page:
        click(page.get_by_role("button", name=f"Correct {att['person']['display_name']} {label(day, e['shift'])}"))
        dialog = page.get_by_role("dialog", name="Correct attendance")
        fill_datetime(dialog.get_by_label("Clock out"), inst(e["ends_at"]).astimezone(LONDON))
        fill(dialog.get_by_role("textbox", name="Reason"), "Shift confirmed")
        click(dialog.get_by_role("button", name="Save correction"))
        expect(page.get_by_role("status", name="Admin status")).to_have_text("Attendance corrected.")
    after = ledger(femi)["open_period"]
    assert abs(Decimal(after["worked_hours"]) - Decimal(before["worked_hours"]) - Decimal(e["hours"])) < HOURS_TOLERANCE
    assert Decimal(after["pending_accrual_hours"]) == accrual(month_seconds(femi, after["period"]))
    with ui(browser, app_url, FEMI, "/accrual") as page:
        region = page.get_by_role("region", name="Holiday accrual")
        expect(region).to_contain_text(re.compile(r"Pending this period: \d+\.\d{4} hours from \d+\.\d{2} worked"))
        got = re.search(r"Pending this period: (\d+\.\d{4}) hours from (\d+\.\d{2}) worked", region.inner_text())
        assert Decimal(got.group(1)) == Decimal(after["pending_accrual_hours"])
        assert hours_match(got.group(2), Decimal(after["worked_hours"]) * SECONDS_PER_HOUR)


def test_wf_accrual_payperiod_close(app_url, browser):
    hr = hr_api(app_url)
    (period,) = unclosed_months(hr, today_of(hr), 1)
    bank_attendance(hr, FEMI, period, 10)
    with ui(browser, app_url, HR_ID, "/pay-periods") as page:
        click(page.get_by_role("button", name=f"Close {month_title(period)}"))
        expect(page.get_by_role("status", name="Admin status")).to_contain_text(f"{month_title(period)} closed.")
        expect(page.get_by_role("status", name="Admin status")).to_have_text(re.compile(rf"^{month_title(period)} closed\. \d+ ledger entries added\.$"))
    femi = Api(app_url, FEMI)
    entry = next(x for x in ledger(femi)["entries"] if x["period"] == period and x["kind"] == "period")
    assert Decimal(entry["accrued_hours"]) == accrual(month_seconds(femi, period))
    with ui(browser, app_url, FEMI, "/accrual") as page:
        expect(page.get_by_role("table", name="Accrual ledger")).to_contain_text(entry["accrued_hours"])


def test_wf_timesheet_export_download(app_url, browser):
    hr = hr_api(app_url)
    period = month_of(today_of(hr) - timedelta(days=SICK_BACK_DAYS))
    with ui(browser, app_url, HR_ID, "/exports") as page:
        form = page.get_by_role("form", name="Export timesheets")
        fill(form.get_by_label("Pay period"), period)
        homes = form.get_by_role("group", name="Homes")
        for box in homes.get_by_role("checkbox").all():
            box.uncheck()
        homes.get_by_role("checkbox", name="Larchfield House").check()
        click(form.get_by_role("button", name="Export timesheets"))
        expect(page.get_by_role("status", name="Admin status")).to_have_text(re.compile(r"^Timesheet export created: \d+ rows\.$"))
        export = max((x for x in hr.ok("GET", "/api/exports")["items"] if x["period"] == period), key=lambda x: x["created_at"])
        poll(lambda: next(x for x in hr.ok("GET", "/api/exports")["items"] if x["id"] == export["id"])["storage"] == "stored", STORAGE_DEADLINE_S, "stored")
        name = re.compile(rf"^Download ({re.escape(period)}|{re.escape(month_title(period))}) export$")
        download = download_via(page, lambda: click(page.get_by_role("list", name="Exports").get_by_role("button", name=name).first))
        assert download.suggested_filename == f"timesheets-{period}.csv"
        body = Path(download.path()).read_bytes().decode("utf-8")
        assert body.split("\r\n")[0] == CSV_HEADER
    assert export["home_ids"] == ["larchfield"]


def test_wf_timesheet_export_validation(app_url, browser):
    hr = hr_api(app_url)
    before = {x["id"] for x in hr.ok("GET", "/api/exports")["items"]}
    with ui(browser, app_url, HR_ID, "/exports") as page:
        form = page.get_by_role("form", name="Export timesheets")
        fill(form.get_by_label("Pay period"), month_of(today_of(hr) - timedelta(days=SICK_BACK_DAYS)))
        for box in form.get_by_role("group", name="Homes").get_by_role("checkbox").all():
            box.uncheck()
        button = form.get_by_role("button", name="Export timesheets")
        if button.is_enabled():
            click(button)
            expect(page.get_by_text("Choose at least one home.").first).to_be_visible()
    assert {x["id"] for x in hr.ok("GET", "/api/exports")["items"]} == before


def test_wf_notifications_outages_mail_down(app_url, browser, mail):
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    hr = hr_api(app_url)
    grace = Api(app_url, "HV-0103")
    s, e = find_window(hr, grace, 1, 154, unit="larchfield-rowan", shift="early")
    req = make_leave(grace, s, e)
    before = mail_ids(mail)
    try:
        with ui(browser, base, FENELLA, queue_url(req["id"])) as page:
            click(page.get_by_role("button", name="Approve with override"))
            dialog = page.get_by_role("dialog", name="Approve with override")
            fill(dialog.get_by_role("textbox", name="Override reason"), "Covered by agency")
            click(dialog.get_by_role("button", name="Confirm approval"))
            expect(page.get_by_role("status", name="Queue status")).to_have_text(f"Approved. {name_of(grace)} will be emailed the decision.")
        assert grace.ok("GET", f"/api/leave-requests/{req['id']}")["status"] == "approved"
        found = mail_wait(mail, before, lambda m: m.get("Subject") == f"Leave approved: {long_date(s)} to {long_date(e)}" and email_of("HV-0103") in rcpts(m))
        assert len(found) == 1
    finally:
        finish(hr, grace, req["id"])


def test_wf_notifications_outages_storage_down(app_url, browser):
    base = os.environ["APP_MINIO_DOWN_URL"]
    hr = hr_api(app_url)
    bethan = Api(app_url, "HV-0218")
    start = today_of(hr) - timedelta(days=SICK_BACK_DAYS - 5)
    rec = report_sickness(bethan, start)
    try:
        with ui(browser, base, "HV-0218", f"/sickness/{rec['id']}") as page:
            page.get_by_label("Fit note file").set_input_files({"name": "held.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()})
            click(page.get_by_role("button", name="Upload fit note"))
            expect(page.get_by_role("status", name="Sickness status")).to_have_text("Fit note received. It is being stored securely.")
        poll(lambda: bethan.ok("GET", f"/api/sickness/{rec['id']}")["fit_note"]["storage"] == "stored", STORAGE_DEADLINE_S, "stored")
        keys = S3().keys(f"fit-notes/brackenmoor/{rec['id']}/")
        assert len(keys) == 1 and S3().get(keys[0]) == pdf_bytes()
    finally:
        bethan.req("POST", f"/api/sickness/{rec['id']}/return", {"last_sick_date": start.isoformat()})


APP = Path("/app")


def python_requirements() -> list[str]:
    req = APP / "requirements.txt"
    if not req.exists():
        return []
    names = []
    for line in req.read_text().splitlines():
        line = line.split("#")[0].strip()
        if line and not line.startswith("-"):
            names.append(re.split(r"[<>=!~\[; ]", line, maxsplit=1)[0])
    return names


def npm_packages() -> dict:
    if not (APP / "package.json").exists():
        return {}
    found: dict = {}
    lock = APP / "package-lock.json"
    if lock.exists():
        for path, info in json.loads(lock.read_text()).get("packages", {}).items():
            if path and not info.get("dev") and not info.get("devOptional"):
                found[path.rsplit("node_modules/", 1)[-1]] = info.get("license")

    def walk(deps):
        for name, info in (deps or {}).items():
            if info.get("license") and not info.get("missing"):
                found[name] = info["license"]
            elif name not in found:
                found[name] = info.get("license")
            walk(info.get("dependencies"))

    for root in (Path(DEPLOYED_APP), APP):
        if (root / "node_modules").exists():
            out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=root, capture_output=True, text=True)
            walk(json.loads(out.stdout or "{}").get("dependencies"))
            break
    return found


def canon(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.lower())


def licence_ok(value) -> bool:
    if isinstance(value, dict):
        value = value.get("type", "")
    if isinstance(value, list):
        return any(licence_ok(v) for v in value)
    expr = str(value or "")
    ids = [t for t in re.findall(r"[A-Za-z0-9.+-]+", expr) if t.upper() not in ("OR", "AND", "WITH")]
    if not ids:
        return False
    allowed = [t in LICENCES for t in ids]
    return all(allowed) if " AND " in f" {expr.upper()} " else any(allowed)


LICENCE_NAMED = re.compile(r"\b(MIT|BSD|Apache|ISC|PSF|OFL)\b|Python Software Foundation|Open Font Licen[cs]e", re.I)


def near(lines: list[str], i: int) -> str:
    block = [lines[i]]
    for line in lines[i + 1:i + 1 + NOTICE_LOOKAHEAD]:
        if line.lstrip().startswith("#"):
            break
        block.append(line)
    return " ".join(block)


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(m[k], str) and m[k].strip()
    assert not (APP / ".venv").exists()


def test_if_notices_list_packages():
    notices = canon((APP / "THIRD_PARTY_NOTICES.md").read_text())
    for name in ["Fraunces", "IBM Plex Sans"] + python_requirements() + list(npm_packages()):
        assert canon(name) in notices, name


def test_if_licences_allowed():
    for name, lic in npm_packages().items():
        assert licence_ok(lic), (name, lic)
    lines = (APP / "THIRD_PARTY_NOTICES.md").read_text().splitlines()
    for name in python_requirements() + ["Fraunces", "IBM Plex Sans"]:
        hits = [i for i, l in enumerate(lines) if canon(name) in canon(l)]
        assert any(LICENCE_NAMED.search(near(lines, i)) for i in hits), name


def test_if_no_other_datastore():
    for p in APP.rglob("*"):
        if "node_modules" in p.parts or ".git" in p.parts:
            continue
        assert p.suffix not in (".db", ".sqlite", ".sqlite3"), p
    assert not {n.lower() for n in python_requirements()} & {"redis", "aiosqlite", "pysqlite3"}


def test_if_service_config_untouched():
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.is_file():
        return
    raw = trajectory.read_text(errors="replace")
    try:
        data = json.loads(raw)
    except ValueError:
        data = []
        for line in raw.splitlines():
            with contextlib.suppress(ValueError):
                data.append(json.loads(line))
    for command in commands_in(data, []):
        for pattern in CREDENTIAL_CHANGES:
            assert not re.search(pattern, command, re.I), command[:200]


CREDENTIAL_CHANGES = (r"ALTER\s+(ROLE|USER)\s+\S+.*\bPASSWORD\b", r"\bMC\s+ADMIN\s+USER\s+(ADD|REMOVE|DISABLE|PASSWORD)\b",
                      r"\bMC\s+ANONYMOUS\s+SET\s+(PUBLIC|DOWNLOAD|UPLOAD)\b")


def commands_in(node, out):
    if isinstance(node, str) and node.lstrip().startswith("{"):
        with contextlib.suppress(ValueError):
            commands_in(json.loads(node), out)
    elif isinstance(node, dict):
        for k, v in node.items():
            if k in ("command", "cmd") and isinstance(v, str):
                out.append(v)
            else:
                commands_in(v, out)
    elif isinstance(node, list):
        for v in node:
            commands_in(v, out)
    return out


def test_if_no_cdn():
    hosts = "|".join(re.escape(h) for h in ("fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com"))
    ref = re.compile(rf"""(?:src|href)\s*=\s*["']?(?:https?:)?//(?:{hosts})|url\(\s*["']?(?:https?:)?//(?:{hosts})|@import\s+(?:url\()?\s*["'](?:https?:)?//(?:{hosts})|(?:from|import\(|fetch\()\s*["'](?:https?:)?//(?:{hosts})""", re.I)
    for p in APP.rglob("*"):
        if (not p.is_file() or p.suffix.lower() not in SOURCE_SUFFIXES or {"node_modules", ".git", "vendor"} & set(p.parts)
                or p.name.endswith(".min.js") or p.stat().st_size > 2_000_000):
            continue
        assert not ref.search(p.read_text(errors="ignore")), p


SOURCE_SUFFIXES = {".py", ".html", ".htm", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".css", ".scss", ".vue", ".svelte", ".jinja", ".j2"}
