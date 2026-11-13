from __future__ import annotations

import concurrent.futures
import json
import os
import re
import struct
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError, expect

from conftest import (
    S3,
    Postgres,
    DEPLOYED_APP,
    addresses,
    advance,
    axe as kit_axe,
    decode,
    difference,
    layout,
    licence_allowed,
    open_app,
    settle,
    shipped_packages,
    text,
    unique,
    until,
)
from conftest import click as mouse_press, fill as type_into, select as choose_option, tap as touch_press


APP = Path("/app")
HTTP_TIMEOUT = 40
POLL_S = 0.5
EXPECT_MS = 300
STEP_MS = 250
UI_WAIT_S = 30
LOAD_WAIT_MS = 8000
HOLD_TRIES = 3
KB_WAIT_S = 60
MAIL_WAIT_S = 60
TAB_LIMIT = 80
PAGE_LIMIT = 40
FRAME_MS = 34
CLOCK_SLACK_S = 3

DESKTOP = {"width": 1280, "height": 800}
LAPTOP = {"width": 1024, "height": 768}
TABLET = {"width": 768, "height": 1024}
MOBILE = {"width": 375, "height": 812}
VIEWPORTS = [MOBILE, TABLET, LAPTOP, DESKTOP]
WIDE_SWITCH = 1100
NARROW_SWITCH = 600

SHORT_MS = 160
MEDIUM_MS = 320
LONG_MS = 640
STRIP_PASS_MS = 64000
REFRESH_MS = 5000
DEBOUNCE_MS = 300
HEADER_SOLID_PX = 24
TARGET_PX = 44
REDUCED_GONE_MS = 100
MESSAGE_BODY_LIMIT = 5100000

FIRST_SLOT = "06:00"
SLOT_STEP_MIN = 20
SLOT_COUNT = 12
MEMBER_WINDOW_DAYS = 28
STAFF_WINDOW_DAYS = 400
DRAW_PAGE_SECONDS = 20
SHORT_WINDOW_S = 30
CLOSURE_WAIT_SHORT_S = 20
SESSION_SHORT_S = 20
ERASE_GRACE_S = 5
MESSAGE_LIMIT = 10
MESSAGE_MAX_CP = 2000
DOWNLOAD_LIMIT = 5
PAGE_SIZE = 25
JSON_LIMIT = 65536
SAVE_BODY_LIMIT = 11100000
RESULTS_FILE_LIMIT = 1000000
REPORT_LIMIT = 10000000
REPORT_OK = 9990000
ATTACHMENT_LIMIT = 5000000
SECTION_LIMIT = 20000
PACKET_MAX = 4
LIST_DAYS = 30
MEMBER_PERCENT = 85
MIN_AGE_YEARS = 18
AGE_BAND_EDGE = 40
LDL_CHANGE = date(2026, 7, 1)

OWNER = "maya.okafor@ocotillo.example"
PRIYA = "priya.shah@ocotillo.example"
THEO = "theo.lindqvist@ocotillo.example"
DANA = "dana.ruiz@ocotillo.example"
SAM = "sam.whitfield@ocotillo.example"
JORDAN = "jordan.pell@ocotillo.example"
ELENA = "elena.marsh@example.com"
STAFF_PASS = "desk-pass-2027"
MEMBER_PASS = "member-pass-2027"
MEMBER_NAME = "Ava Torres"
ADDRESS = {"line1": "200 Pearl St", "line2": "", "city": "Denver", "postalCode": "80203"}
PHONE = "+1 303 555 0100"
GATE = "Side gate."
FIRST_NAME = MEMBER_NAME.split()[0]
SHORT_NAME = f"{FIRST_NAME} {MEMBER_NAME.split()[1][0]}."
BAND_MARKER = "estradiol"
BAND_NAME = "Estradiol"
BAND_UNIT = "pg/mL"
BAND_VALUES = ["60", "120", "300"]
BAND_YOUNG = "30–400 (optimal 50–250)"
BAND_OLD = "10–350 (optimal 30–200)"
VD_NAME = "Vitamin D"
CORRECTED_VD = "44.0"
ZONULIN = "Zonulin"
CSV_TYPE = "text/csv; charset=utf-8"
TYPED_PLAN = "Keep typing through the refresh"
TYPED_DRAFT = "My draft text"
TYPED_SESSION = "Typed before the session ended"
TYPED_WAITING = "still typing"
ELEVENTH = "eleventh message"
OVER_LIMIT = "one too many"
SPOOFED = "other address"
BIG_BODY = "big"
BAD_ATTACHMENT_BODY = "see file"

PHLEB_EMAIL = {
    "Luis Carrillo": "luis.carrillo@visits.example",
    "Ivy Chen": "ivy.chen@visits.example",
    "Bree Halvorsen": "bree.halvorsen@visits.example",
    "Tomas Reyes": "tomas.reyes@visits.example",
    "Nia Brooks": "nia.brooks@visits.example",
    "Grace Whitaker": "grace.whitaker@visits.example",
    "Caleb Ford": "caleb.ford@visits.example",
}
PHLEB_STATES = {
    "Luis Carrillo": ["az", "co", "nm", "nv", "ut"],
    "Ivy Chen": ["co", "ut"],
    "Bree Halvorsen": ["ca", "id", "mt", "or", "wa", "wy"],
    "Tomas Reyes": ["ar", "ia", "ks", "la", "mn", "mo", "nd", "ne", "ok", "sd", "tx"],
    "Nia Brooks": ["al", "il", "in", "ky", "mi", "ms", "oh", "tn", "wi"],
    "Grace Whitaker": ["ct", "de", "ma", "md", "me", "nh", "nj", "ny", "pa", "vt"],
    "Caleb Ford": ["fl", "ga", "nc", "sc", "va", "wv"],
}
ZONES = {
    "newYork": ZoneInfo("America/New_York"),
    "chicago": ZoneInfo("America/Chicago"),
    "denver": ZoneInfo("America/Denver"),
    "phoenix": ZoneInfo("America/Phoenix"),
    "losAngeles": ZoneInfo("America/Los_Angeles"),
}
PHX = ZONES["phoenix"]
CATEGORY_IDS = ["metabolic", "heart", "hormones", "kidneyLiver", "nutrients", "inflammationBlood"]
CATEGORY_NAMES = ["Metabolic", "Heart", "Hormones", "Kidney and liver", "Nutrients", "Inflammation and blood"]
FLAG_LABEL = {"belowRange": "Below range", "inRange": "In range", "optimal": "Optimal", "aboveRange": "Above range"}
ING_TIME = {
    "vitaminD3": "morning", "vitaminD3Small": "morning", "magnesiumGlycinate": "evening", "omega3": "split",
    "methylB12": "morning", "ashwagandha": "evening", "vitaminK2": "morning", "zincPicolinate": "evening",
    "creatine": "split", "coq10": "morning", "glycine": "evening",
}
ING_PRICE = {
    "vitaminD3": 9, "vitaminD3Small": 6, "magnesiumGlycinate": 12, "omega3": 18, "methylB12": 15,
    "ashwagandha": 15, "vitaminK2": 11, "zincPicolinate": 8, "creatine": 6, "coq10": 22, "glycine": 5,
}
ING_NAME = {
    "vitaminD3": "Vitamin D3", "vitaminD3Small": "Vitamin D3 low dose", "magnesiumGlycinate": "Magnesium glycinate",
    "omega3": "Omega-3", "methylB12": "Methyl B12", "ashwagandha": "Ashwagandha", "vitaminK2": "Vitamin K2 (MK-7)",
    "zincPicolinate": "Zinc picolinate", "creatine": "Creatine monohydrate", "coq10": "CoQ10", "glycine": "Glycine",
}

SIGNIN_COPY = "That email and password don't match."
SESSION_ENDED_COPY = "Your session ended. Sign in again to keep going — what you typed is still here."
PAYMENTS_COPY = "Payments are unavailable right now. Nothing was charged."
REPORT_STORE_COPY = "The report store is unavailable right now. Nothing was saved."
VISIT_ENDED_COPY = "This visit page has ended."
NOT_FOUND_COPY = "We can't find that page."
WRONG_CHECK_COPY = "That kit code isn't valid. Check the last character."
WRONG_SHAPE_COPY = "Enter a kit code like KT-1000042-7."
TIME_COPY = "Choose a slot from the published times."
TOO_LARGE_COPY = "That request is too large."
CLOSING_COPY = "This account is closing."
EVENING_FULL = "The evening packet holds at most 4 capsules."
MORNING_FULL = "The morning packet holds at most 4 capsules."
CSV_HEADER = '"Collected date","Marker","Value","Unit","Flag","Range in force","Specialist note"'
VISIT_KEYS = {"memberName", "startsAt", "localDate", "localTime", "timeZone", "isDrawDay", "address",
              "gateNotes", "kitCodes", "state", "collectedAt", "endsAt"}
RECEIPT_KEYS = {"id", "number", "memberName", "paidAt", "paidDate", "amountCents", "currency"}
RECEIPT_VIEW_KEYS = RECEIPT_KEYS | {"invoiceId", "items", "practice"}
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
CAMEL_RE = re.compile(r"^[a-z][a-zA-Z0-9]*$")
TOKEN_RE = re.compile(r"/visit/([A-Za-z0-9_-]+)")
PLAN_A = {"nutrition": "Build meals around…", "movement": "- Walk 30 minutes daily",
          "sleep": "Lights out by 22:30.", "supplements": "Take the evening packet an hour before bed."}
PLAN_B = {"nutrition": "Build each meal around protein and vegetables.\n\n- Two portions of oily fish a week\n- Fibre at breakfast",
          "movement": "- Walk 30 minutes a day\n- Strength work twice a week",
          "sleep": "Lights out by 22:30 on weeknights.",
          "supplements": "Take the morning packet with breakfast and the evening packet an hour before bed."}
EXAMPLE_BLEND = [{"ingredient": "vitaminD3", "capsulesPerDay": 1}, {"ingredient": "magnesiumGlycinate", "capsulesPerDay": 2},
                 {"ingredient": "omega3", "capsulesPerDay": 2}, {"ingredient": "methylB12", "capsulesPerDay": 1},
                 {"ingredient": "ashwagandha", "capsulesPerDay": 1}]

ANIMS_JS = """
async (root) => {
  const anims = root.getAnimations({subtree: true});
  await Promise.all(anims.map(a => a.ready.catch(() => null)));
  return anims.map(a => {
    const t = a.effect && a.effect.target;
    const host = t && t.closest ? t.closest('[data-part]') : null;
    const timing = a.effect ? a.effect.getComputedTiming() : {};
    return {part: host ? host.getAttribute('data-part') : null, duration: Number(timing.duration) || 0,
            iterations: timing.iterations === Infinity ? -1 : timing.iterations, start: a.startTime, state: a.playState};
  });
}
"""
RECORD_JS = """() => {
  if (window.__anims) { window.__anims.length = 0; return; }
  window.__anims = [];
  const parts = (t) => { if (!t || !t.closest) return [];
    const h = t.closest('[data-part]'), svg = t.closest('svg');
    if (!h && svg && svg.querySelector('[data-part="trend"]')) return ['trend'];
    return h ? [h.getAttribute('data-part')] : [...t.querySelectorAll('[data-part]')].map(e => e.getAttribute('data-part')); };
  const keep = (t, a) => { if (!a.__seen) { a.__seen = true; window.__anims.push({a, parts: parts(t)}); } };
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); keep(this, a); return a; };
  for (const ev of ['transitionrun', 'animationstart']) document.addEventListener(ev, (e) => {
    for (const a of e.target.getAnimations()) keep(e.target, a); }, true);
}"""
READ_JS = """async () => { const out = [];
  for (const {a, parts} of window.__anims || []) { await a.ready.catch(() => null);
    out.push({parts, duration: a.effect ? Number(a.effect.getComputedTiming().duration) : 0, start: a.startTime}); }
  return out; }"""
INERT_JS = """(el) => { if (!el.isConnected) return true; for (let n = el; n; n = n.parentElement) {
  if (n.inert || n.hidden || n.getAttribute('aria-hidden') === 'true') return true;
  const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return true; } return false; }"""
HIDDEN_JS = "(el) => !el.isConnected || el.hidden || !el.checkVisibility({visibilityProperty: true})"
NO_RUNNING_JS = "() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity).length === 0"
RUNNING_IN_JS = "(el) => el.getAnimations({subtree: true}).filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity && a.effect.getComputedTiming().duration >= 1).length"
FIXED_BOTTOM_JS = """(els) => els.some(el => { let fixed = false;
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') { fixed = true; break; } }
  const r = el.getBoundingClientRect();
  return fixed && r.height > 0 && r.bottom <= innerHeight + 1 && r.top >= innerHeight / 2; })"""
IN_VIEW_JS = "(el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 0; }"
HAS_FOCUS_JS = "(el) => el === document.activeElement || el.contains(document.activeElement)"
IS_FOCUS_JS = "(el) => el === document.activeElement"
VISIBLE_TEXTS_JS = "(sel) => [...document.querySelectorAll(sel)].filter(e => e.checkVisibility({opacityProperty: true, visibilityProperty: true})).map(e => e.textContent.trim())"
PART_JS = "(root, part) => root.querySelector(`[data-part=\"${part}\"]`)"
PART_TEXTS_JS = "(root, part) => [...root.querySelectorAll(`[data-part=\"${part}\"]`)].filter(e => e.checkVisibility({opacityProperty: true, visibilityProperty: true})).map(e => e.textContent.trim())"
PART_ATTRS_JS = "(root, [part, name]) => [...root.querySelectorAll(`[data-part=\"${part}\"]`)].map(e => e.getAttribute(name))"


class Api:
    def __init__(self, base: str, cookies=None):
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, cookies=cookies)

    def get(self, path, **kw):
        return self.c.get(path, **kw)

    def post(self, path, body=None, **kw):
        return self.c.post(path, json={} if body is None else body, **kw)

    def patch(self, path, body, **kw):
        return self.c.patch(path, json=body, **kw)

    def put(self, path, body):
        return self.c.put(path, json=body)

    def delete(self, path):
        return self.c.delete(path)

    def upload(self, path, files, **kw):
        return self.c.post(path, files=files, **kw)

    def cookies(self):
        return {c.name: c.value for c in self.c.cookies.jar}


def env_url(name: str) -> str:
    url = os.environ.get(name)
    if not url:
        pytest.fail(f"{name} is not set; the verifier must expose that practice copy")
    return url.rstrip("/")


def ok(r: httpx.Response, status: int, what: str):
    assert r.status_code == status, f"{what}: expected {status}, got {r.status_code} {r.text[:600]}"
    return r.json() if r.content and r.headers.get("content-type", "").startswith("application/json") else None


def err(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text[:600]}"
    assert r.headers.get("content-type", "").startswith("application/json"), "error bodies are JSON (L388)"
    body = r.json()
    assert set(body) == {"error"}, f"error body has only the error key (L388): {body}"
    assert body["error"]["code"] == code, body
    assert isinstance(body["error"].get("message"), str), body
    if status != 422:
        assert "fields" not in body["error"], f"fields only for field errors (L388): {body}"
    if message is not None:
        assert body["error"]["message"] == message, body
    return body["error"]


def field_err(r: httpx.Response, field: str, message: str | None = None) -> None:
    e = err(r, 422, "invalid")
    fields = e.get("fields") or {}
    assert field in fields, f"422 names field {field}: {e}"
    if message is not None:
        assert fields[field] == message, e


def signin(base: str, email: str, password: str = STAFF_PASS) -> Api:
    api = Api(base)
    ok(api.post("/api/session", {"email": email, "password": password}), 200, f"sign in {email}")
    return api


def fresh_email(prefix: str) -> str:
    parts = unique(prefix)
    for p in parts:
        if "@" in p:
            return p
    tag = re.sub(r"[^a-z0-9]", "", "".join(parts).lower())
    return f"{tag}@example.com"


def poll(fn, seconds: float, what: str):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
        threading.Event().wait(POLL_S)
    pytest.fail(f"{what} (last seen: {last!r})")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> datetime:
    assert isinstance(s, str) and ISO_RE.match(s), f"instant is whole-second UTC with Z (L384): {s!r}"
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def fmt_date(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b} {d.year}"


def hhmm(dt: datetime, tz: str) -> str:
    return dt.astimezone(ZONES[tz]).strftime("%H:%M")


def ends_at_term(sub: dict, end: str) -> bool:
    billing = sub.get("billingEndDate")
    return bool(billing) and abs((date.fromisoformat(str(billing)[:10]) - date.fromisoformat(end)).days) <= 1


def local_today(tz: str) -> date:
    return datetime.now(ZONES[tz]).date()


def local_date(s: str, tz: str) -> date:
    return parse_iso(s).astimezone(ZONES[tz]).date()


def at_local(tz: str, d: date, clock: str) -> datetime:
    h, m = map(int, clock.split(":"))
    return datetime(d.year, d.month, d.day, h, m, tzinfo=ZONES[tz])


def round_up_minute(dt: datetime) -> datetime:
    base = dt.replace(second=0, microsecond=0)
    return base if base == dt else base + timedelta(minutes=1)


def retry_copies(template: str, before: datetime, after: datetime, retry_after: int, tz: str) -> set[str]:
    out = set()
    start = before.replace(microsecond=0) - timedelta(seconds=CLOCK_SLACK_S)
    span = int((after - before).total_seconds()) + 2 * CLOCK_SLACK_S + 1
    for k in range(span):
        out.add(template.format(hhmm(round_up_minute(start + timedelta(seconds=retry_after + k)), tz)))
    return out


def slot_times() -> list[str]:
    h, m = map(int, FIRST_SLOT.split(":"))
    start = h * 60 + m
    return [f"{(start + i * SLOT_STEP_MIN) // 60:02d}:{(start + i * SLOT_STEP_MIN) % 60:02d}" for i in range(SLOT_COUNT)]


def workday(d: date, step: int = 1) -> date:
    while d.weekday() == 6:
        d += timedelta(days=step)
    return d


def next_change(tz: str, start: date) -> date:
    z = ZONES[tz]
    d = start
    for _ in range(STAFF_WINDOW_DAYS):
        n = d + timedelta(days=1)
        if datetime(d.year, d.month, d.day, 12, tzinfo=z).utcoffset() != datetime(n.year, n.month, n.day, 12, tzinfo=z).utcoffset():
            return n
        d = n
    pytest.fail(f"no clock change in {tz} within the staff window")


def check_char(digits: str) -> str:
    r = 0
    for ch in digits:
        r = ((r + int(ch)) * 2) % 11
    v = (12 - r) % 11
    return "X" if v == 10 else str(v)


def new_kit() -> str:
    digits = f"{uuid.uuid4().int % 10 ** 7:07d}"
    return f"KT-{digits}-{check_char(digits)}"


def pdf_bytes(size: int | None = None) -> bytes:
    head = b"%PDF-1.4\n%" + uuid.uuid4().hex.encode() + b"\n"
    tail = b"\n%%EOF\n"
    if size is None:
        return head + tail
    return head + b"0" * (size - len(head) - len(tail)) + tail


def money(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def state_copy(served: bool, name: str) -> str:
    return f"Yes — we serve members in {name}." if served else f"Not yet — we can't serve members in {name}."


def walk_keys(value, path="") -> list[str]:
    bad = []
    if isinstance(value, dict):
        for k, v in value.items():
            if not CAMEL_RE.match(k):
                bad.append(f"{path}.{k}")
            if path.endswith("error") and k == "fields":
                continue
            bad += walk_keys(v, f"{path}.{k}")
            if isinstance(v, str) and k.endswith("At") and not ISO_RE.match(v):
                bad.append(f"{path}.{k}={v}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            bad += walk_keys(v, f"{path}[{i}]")
    return bad


class Member:
    def __init__(self, base, data, email, owner, api, tz, state):
        self.base, self.data, self.id, self.email = base, data, data["id"], email
        self.owner, self.api, self.tz, self.state = owner, api, tz, state
        self.name = data["name"]


def new_member(base: str, *, cadence: str | None = "sixMonths", state: str = "co", tz: str = "denver",
               born: str = "1987-03-02", sex: str = "female") -> Member:
    owner = signin(base, OWNER)
    email = fresh_email("member")
    body = {"name": MEMBER_NAME, "email": email, "password": MEMBER_PASS, "dateOfBirth": born, "sex": sex,
            "state": state, "timeZone": tz, "phone": PHONE, "address": ADDRESS, "gateNotes": GATE, "cadence": cadence}
    data = ok(owner.post("/api/members", body), 201, "POST /api/members")["member"]
    if cadence:
        poll(lambda: owner.get(f"/api/members/{data['id']}").json()["member"]["membership"]["state"] == "active" or None,
             KB_WAIT_S, "a member created with a cadence reaches Plus · Active once Kill Bill confirms (L572)")
    return Member(base, data, email, owner, signin(base, email, MEMBER_PASS), tz, state)


def signup(base: str, *, state: str = "co", tz: str = "denver"):
    api = Api(base)
    email = fresh_email("visitor")
    body = {"name": MEMBER_NAME, "email": email, "password": "long-enough-pass", "dateOfBirth": "1990-04-12",
            "sex": "female", "state": state, "timeZone": tz}
    member = ok(api.post("/api/accounts", body), 201, "POST /api/accounts")["member"]
    return api, member, email


def wait_active(api: Api) -> dict:
    return poll(lambda: (lambda m: m if m["state"] == "active" else None)(api.get("/api/me/membership").json()["membership"]),
                KB_WAIT_S, "membership becomes active once Kill Bill confirms (L572)")


def my_receipts(api: Api, n: int = 1) -> list[dict]:
    return poll(lambda: (lambda rs: rs if len(rs) >= n else None)(api.get("/api/me/receipts").json()["receipts"]),
                KB_WAIT_S * 2, "the paid first invoice gets a receipt (L725)")


def plus_signup(base: str):
    api, me, email = signup(base)
    ok(api.post("/api/me/membership", {"cadence": "yearly"}), 201, "join")
    wait_active(api)
    return api, me, my_receipts(api)[0]


def phlebotomists(api: Api) -> dict:
    return {p["name"]: p for p in ok(api.get("/api/phlebotomists"), 200, "GET /api/phlebotomists")["phlebotomists"]}


def free_slot(api: Api, member_id: str, phleb_ids: set, start: date, *, step: int = 1, days: int = 40, me: bool = False):
    d = start
    for _ in range(days):
        if d.weekday() != 6:
            path = f"/api/me/slots?date={d}" if me else f"/api/slots?memberId={member_id}&date={d}"
            for s in ok(api.get(path), 200, f"GET slots {d}")["slots"]:
                if s["phlebotomistId"] in phleb_ids and s["free"]:
                    return d, s
        d += timedelta(days=step)
    pytest.fail(f"GET /api/slots listed no free slot from {start}; expected free slots on the published grid")


def book(api: Api, m: Member, phleb_id: str, d: date, clock: str, **extra) -> httpx.Response:
    return api.post("/api/draws", {"memberId": m.id, "phlebotomistId": phleb_id, "date": d.isoformat(), "time": clock, **extra})


def past_draw(m: Member, start: date, phleb: str = "Luis Carrillo", collected: str = "23:30"):
    pid = phlebotomists(m.owner)[phleb]["id"]
    d, s = free_slot(m.owner, m.id, {pid}, workday(start, -1), step=-1)
    kit = new_kit()
    r = book(m.owner, m, pid, d, s["localTime"], collectedAt=iso(at_local(m.tz, d, collected)), kitCodes=[kit])
    draw = ok(r, 201, "record a past draw")["draw"]
    assert draw["state"] == "collected", draw
    return draw, kit, d


def store_report(api: Api, draw_id: str) -> bytes:
    pdf = pdf_bytes()
    ok(api.upload(f"/api/draws/{draw_id}/report", {"report": ("report.pdf", pdf, "application/pdf")}), 201, "POST report")
    return pdf


def released_draw(m: Member, start: date, results: list[tuple[str, str]], collected: str = "23:30"):
    draw, kit, d = past_draw(m, start, collected=collected)
    ok(m.owner.post(f"/api/draws/{draw['id']}/results", {"results": [{"marker": k, "value": v} for k, v in results]}),
       201, "POST results")
    store_report(m.owner, draw["id"])
    ok(m.owner.post(f"/api/draws/{draw['id']}/release"), 200, "release")
    return draw, d


def mail_tokens(mail, to: str) -> dict:
    out = {}
    for msg in mail.messages():
        if to in addresses(msg.get("To")):
            for t in TOKEN_RE.findall(text(msg)):
                out.setdefault(t, msg)
    return out


def token_for(base: str, mail, to: str, before: set, draw: dict):
    def look():
        for t, msg in mail_tokens(mail, to).items():
            if t in before:
                continue
            r = httpx.get(f"{base}/api/visits/{t}", timeout=HTTP_TIMEOUT)
            if r.status_code == 200 and r.json().get("startsAt") == draw["startsAt"]:
                return t, msg
        return None
    return poll(look, MAIL_WAIT_S, f"a visit page mail to {to} with a live /visit/<token> for {draw['startsAt']} (L619, L775)")


def book_today(m: Member, mail, names=("Luis Carrillo", "Ivy Chen")):
    ps = phlebotomists(m.owner)
    today = local_today(m.tz)
    befores = {n: set(mail_tokens(mail, PHLEB_EMAIL[n])) for n in names}
    by_id = {ps[n]["id"]: n for n in names if n in ps}
    slots = ok(m.owner.get(f"/api/slots?memberId={m.id}&date={today}"), 200, "today's staff slots")["slots"]
    for s in slots:
        if s["phlebotomistId"] in by_id and s["free"]:
            name = by_id[s["phlebotomistId"]]
            draw = ok(book(m.owner, m, s["phlebotomistId"], today, s["localTime"]), 201, "staff same-day booking")["draw"]
            token, msg = token_for(m.base, mail, PHLEB_EMAIL[name], befores[name], draw)
            return draw, token, name, msg
    pytest.fail("staff slot reads for today listed no free slot (L601: all 12 times are listed for today)")


def results_of(api: Api, member_id: str, path: str | None = None) -> dict:
    body = ok(api.get(path or f"/api/members/{member_id}/results"), 200, "GET results")
    return {mk["marker"]: mk for mk in body["markers"]}


def draw_entry(markers: dict, marker: str, draw_id: str):
    for d in markers.get(marker, {}).get("draws", []):
        if d["drawId"] == draw_id:
            return d
    return None


def send_message(api: Api, path: str, body: str, attachment=None, **kw) -> httpx.Response:
    files = {"body": (None, body)}
    if attachment is not None:
        files["attachment"] = attachment
    return api.upload(path, files, **kw)


def kb_account(killbill, member_id: str):
    return poll(lambda: killbill.account_by_key(member_id), KB_WAIT_S, f"Kill Bill account with external key {member_id} (L757)")


def band_member(base: str, extra: int):
    today = local_today("denver")
    birthday = today - timedelta(days=50)
    born = None
    for _ in range(7):
        try:
            born = birthday.replace(year=birthday.year - AGE_BAND_EDGE)
            break
        except ValueError:
            birthday -= timedelta(days=1)
    assert born, "a birth date 40 years before the chosen birthday"
    m = new_member(base, born=born.isoformat())
    draws = [released_draw(m, today - timedelta(days=60), [(BAND_MARKER, BAND_VALUES[0]), ("vitaminD", "22.5")])]
    for i in range(extra):
        draws.append(released_draw(m, today - timedelta(days=40 - 10 * i),
                                   [(BAND_MARKER, BAND_VALUES[1 + i]), ("vitaminD", "31.5")]))
    return m, draws


def pack(items: list[tuple[str, int]]):
    morning = evening = listed = 0
    for ing, n in items:
        if ING_TIME[ing] == "morning":
            morning += n
        elif ING_TIME[ing] == "evening":
            evening += n
        else:
            morning += (n + 1) // 2
            evening += n // 2
        listed += n * LIST_DAYS * ING_PRICE[ing]
    return morning, evening, listed, (listed * MEMBER_PERCENT + 50) // 100


def csv_cell(v: str) -> str:
    return '"' + v.replace('"', '""') + '"'


def results_csv(kit: str, other: str) -> bytes:
    rows = ["kitCode,marker,value,unit",
            f"{kit},Vit D, 25-OH,56.125,nmol/L",
            f"{kit},Zonulin,5,mg/dL",
            f"{kit},LDL-C,abc,mg/dL",
            f"{kit},Glucose fasting,5.5,mmol/L",
            f"{other},HDL-C,50,mg/dL",
            f"{kit},FERR,30,mmol/L",
            f"{kit},Insulin,69.45,pmol/L",
            f"{kit},thyrotropin,1.255,uIU/mL",
            f"{kit},x,1",
            ""]
    return ("\ufeff" + "\r\n".join(rows)).encode()


def make_jpeg() -> bytes:
    def seg(marker: int, payload: bytes) -> bytes:
        return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload
    tiff = bytearray(b"MM\x00\x2a\x00\x00\x00\x08")
    tiff += struct.pack(">H", 2)
    tiff += struct.pack(">HHI", 0x0112, 3, 1) + struct.pack(">HH", 6, 0)
    tiff += struct.pack(">HHII", 0x8825, 4, 1, 38)
    tiff += struct.pack(">I", 0)
    tiff += struct.pack(">H", 1) + struct.pack(">HHI", 0x0001, 2, 2) + b"N\x00\x00\x00" + struct.pack(">I", 0)
    exif = b"Exif\x00\x00" + bytes(tiff)
    xmp = b"http://ns.adobe.com/xap/1.0/\x00" + b'<x:xmpmeta xmlns:x="adobe:ns:meta/">secret-xmp</x:xmpmeta>'
    dqt = b"\x00" + bytes([1] * 64)
    sof = struct.pack(">BHHB", 8, 16, 8, 1) + b"\x01\x11\x00"
    dht_dc = b"\x00" + bytes([0, 2] + [0] * 14) + bytes([0, 7])
    dht_ac = b"\x10" + bytes([0, 1] + [0] * 14) + bytes([0])
    sos = b"\x01\x01\x00\x00\x3f\x00"
    return (b"\xff\xd8" + seg(0xE1, exif) + seg(0xE1, xmp) + seg(0xFE, b"secret-comment") + seg(0xDB, dqt)
            + seg(0xC0, sof) + seg(0xC4, dht_dc) + seg(0xC4, dht_ac) + seg(0xDA, sos) + bytes([0x00]) + b"\xff\xd9")


def image_size(data: bytes) -> tuple[int, int]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    if data[:3] == b"\xff\xd8\xff":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker == 0xFF:
                i += 1
                continue
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = struct.unpack(">H", data[i + 2:i + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            i += 2 + length
    pytest.fail("the staff copy of a photo is not a JPEG or PNG image")


@contextmanager
def screen(browser, base: str, path: str, api: Api | None = None, *, size=DESKTOP, reduced=False, clock_hours=0, record=False):
    with open_app(browser, base + "/api/health", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.clock.resume()
        page.set_viewport_size(size)
        if record:
            page.add_init_script(RECORDER)
        if api is not None:
            page.context.add_cookies([{"name": k, "value": v, "url": base} for k, v in api.cookies().items()])
        if clock_hours:
            page.clock.set_system_time(datetime.now(timezone.utc) + timedelta(hours=clock_hours))
        page.goto(base + path)
        yield page


def hold_clock(page) -> None:
    for attempt in range(HOLD_TRIES):
        try:
            page.clock.pause_at(page.evaluate("Date.now()") / 1000 + 1)
            return
        except PlaywrightError:
            if attempt == HOLD_TRIES - 1:
                raise


def loaded(page) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=LOAD_WAIT_MS)
    except PlaywrightError:
        pass


class ScriptsByEvaluate:

    def __init__(self, page) -> None:
        self.page = page

    def add_script_tag(self, path: str) -> None:
        self.page.evaluate(Path(path).read_text())

    def __getattr__(self, name: str):
        return getattr(self.page, name)


def axe(page) -> None:
    kit_axe(ScriptsByEvaluate(page))


def eventually(page, fn, what: str, seconds: float = UI_WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            fn()
            return
        except AssertionError as e:
            last = e
        advance(page, STEP_MS)
    pytest.fail(f"{what}: {last}")


def see(page, locator, txt: str | None = None) -> None:
    if txt is None:
        eventually(page, lambda: expect(locator).to_be_visible(timeout=EXPECT_MS), "expected the control to show")
    else:
        eventually(page, lambda: expect(locator).to_contain_text(txt, timeout=EXPECT_MS), f"expected {txt!r}")


def say(page, copy) -> None:
    see(page, page.get_by_role("status", name="Announcements", include_hidden=True), copy)


def h1(page):
    return page.get_by_role("heading", level=1)


def at_url(page, pattern: str) -> None:
    eventually(page, lambda: expect(page).to_have_url(re.compile(pattern), timeout=EXPECT_MS), f"address bar shows {pattern}")


def fixed_bottom(locator) -> bool:
    deadline = time.monotonic() + PRESS_WAIT_S
    while time.monotonic() < deadline:
        if locator.evaluate_all(FIXED_BOTTOM_JS):
            return True
        advance(locator.page, STEP_MS)
    return False


def tab_to(page, locator) -> None:
    expect(locator.first).to_be_attached(timeout=UI_WAIT_S * 1000)
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if locator.evaluate_all(FOCUS_IN_ANY_JS):
            return
    pytest.fail("Tab never reached the control; every action works by keyboard (P43)")


def focus_text(page) -> str:
    return page.evaluate("() => document.activeElement ? document.activeElement.textContent || '' : ''")


def focus_on(page, copy: str) -> None:
    def chk():
        assert copy in focus_text(page), f"focused element reads {focus_text(page)!r}"
    eventually(page, chk, f"focus moves to the message {copy!r} (L244)")


def focus_in(page, locator, what: str) -> None:
    def chk():
        assert locator.evaluate_all(FOCUS_IN_ANY_JS), what
    eventually(page, chk, what)


def gone(page, locator, what: str) -> None:
    until(page, NO_RUNNING_JS)
    eventually(page, lambda: expect(locator).to_have_count(0, timeout=EXPECT_MS), what)


def big_enough(locator) -> None:
    box = locator.bounding_box()
    assert box and box["width"] >= TARGET_PX - 0.5 and box["height"] >= TARGET_PX - 0.5, f"control is at least 44x44 at 375 (L265): {box}"


def squeezed(txt: str) -> str:
    return "".join(txt.split())


def labelled(label: str, amount: str) -> re.Pattern:
    return re.compile(re.escape(label) + r"\s*" + re.escape(amount))


def price_texts(page, part: str) -> list[str]:
    return [squeezed(t) for t in page.evaluate(VISIBLE_TEXTS_JS, f'[data-part="{part}"]')]


def price_is(page, price: str, per_month: str) -> None:
    def chk():
        settle(page.locator("body"))
        assert squeezed(price) in price_texts(page, "price"), price_texts(page, "price")
        assert squeezed(per_month) in price_texts(page, "per-month"), price_texts(page, "per-month")
    eventually(page, chk, f"plans page shows {price} and {per_month}")


def part_handle(page, root, part: str):
    found = []

    def chk():
        h = root.evaluate_handle(PART_JS, part).as_element()
        assert h is not None, f"no {part} part yet"
        found.append(h)
    eventually(page, chk, f"the {part} part shows (L195)")
    return found[-1]


def part_has(page, root, part: str, txt: str) -> None:
    def chk():
        texts = root.evaluate(PART_TEXTS_JS, part)
        assert any(squeezed(txt) in squeezed(t) for t in texts), texts
    eventually(page, chk, f"the {part} part reads {txt!r}")


def band(page, marker: str):
    region = page.get_by_role("region", name=marker, exact=True)
    stations = page.get_by_role("listbox", name=f"Draws for {marker}").get_by_role("option")
    return region, stations


def selected(page, stations, i: int) -> None:
    eventually(page, lambda: expect(stations.nth(i)).to_have_attribute("data-state", "selected", timeout=EXPECT_MS),
               f"station {i} is selected")


PRESS_WAIT_S = 8


STILL_JS = """(els) => ({now: Date.now(), box: els.map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
  moving: document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity)})"""
STILL_WAIT_S = 2
STILL_GAP_S = 0.04
STILL_READS = 2


def still(locator) -> None:
    deadline, last, same, clock = time.monotonic() + STILL_WAIT_S, None, 0, None
    try:
        while time.monotonic() < deadline and same < STILL_READS:
            read = locator.evaluate_all(STILL_JS)
            same = same + 1 if read["box"] == last and not read["moving"] else 0
            last = read["box"]
            if clock is not None and read["now"] != clock:
                advance(locator.page, FRAME_MS)
            clock = read["now"]
            threading.Event().wait(STILL_GAP_S)
    except PlaywrightError:
        pass


def uncovering(locator, act) -> None:
    try:
        still(locator)
        act()
    except AssertionError as e:
        if "obscured" in str(e):
            try:
                locator.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})", timeout=EXPECT_MS)
            except PlaywrightError:
                pass
        raise


def click(locator) -> None:
    eventually(locator.page, lambda: uncovering(locator, lambda: mouse_press(locator)), "the control takes a mouse press", PRESS_WAIT_S)


def tap(locator) -> None:
    eventually(locator.page, lambda: uncovering(locator, lambda: touch_press(locator)), "the control takes a tap", PRESS_WAIT_S)


def fill(locator, value: str) -> None:
    eventually(locator.page, lambda: uncovering(locator, lambda: type_into(locator, value)), "the field takes text", PRESS_WAIT_S)


def select(locator, choice: str) -> None:
    eventually(locator.page, lambda: uncovering(locator, lambda: choose_option(locator, choice)), f"the dropdown offers {choice!r}", PRESS_WAIT_S)


def heading(page, txt: str) -> None:
    eventually(page, lambda: expect(h1(page)).to_have_text(txt, timeout=EXPECT_MS), f"the level-one heading reads {txt!r}")


PICK_JS = """e => {
  e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  const at = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return null;
    const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return hit && (hit === el || el.contains(hit)) ? {x, y} : null;
  };
  const own = at(e);
  if (own) return own;
  const label = (e.labels && e.labels[0]) || e.closest('label');
  return label ? at(label) : null;
}"""


def pick(choice, touch: bool = False) -> None:
    page = choice.page
    expect(choice).to_be_attached()
    still(choice)
    point = {}

    def find() -> None:
        where = choice.evaluate(PICK_JS)
        assert where, "no hit target for the choice or its label yet"
        point.update(where)
    eventually(page, find, "a hit target for the choice or its label")
    (page.touchscreen.tap if touch else page.mouse.click)(point["x"], point["y"])
    eventually(page, lambda: expect(choice).to_be_checked(timeout=EXPECT_MS), "the choice is checked")


@contextmanager
def downloads(page):
    got: list = []

    def keep(download) -> None:
        got.append(download)
    page.on("download", keep)
    try:
        yield got
    finally:
        page.remove_listener("download", keep)


def focused_now(locator, frames: int = 3) -> None:
    for _ in range(frames + 1):
        if locator.evaluate_all(FOCUS_IN_ANY_JS):
            return
        advance(locator.page, FRAME_MS // 2)
    pytest.fail("SR2: focus did not return at once to the control that opened the panel (L263)")


def after_refresh(page) -> None:
    advance(page, REFRESH_MS)
    for _ in range(25):
        threading.Event().wait(0.08)
        advance(page, 40)


def finish_motion(page) -> None:
    page.evaluate("() => document.getAnimations().forEach(a => { try { if (Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); } catch (e) {} })")
    advance(page, 32)


def page_text(page) -> str:
    return page.evaluate("() => document.body.innerText")


def unknown_like(known: str) -> str:
    return str(uuid.uuid4()) if re.fullmatch(r"[0-9a-fA-F-]{36}", known) else known + "0"


RING_DIFF = 0.5
RING_BAND = 8
SR1_ROUNDS = 3
SR2_HOLD_MS = 1000
SR6_TABS = 12
TRAP_TABS = 12
SR1_TYPED = "2"
ALLOWED_MS = [SHORT_MS, MEDIUM_MS, LONG_MS, STRIP_PASS_MS]

RECORDER = """
(() => {
  if (window.__motionLog) return;
  const log = (window.__motionLog = []);
  const ms = (v) => { v = String(v).trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000; };
  const declared = (target, pseudo, kind, name) => {
    try {
      const s = getComputedStyle(target, pseudo || null);
      const names = (kind === 'transition' ? s.transitionProperty : s.animationName).split(',').map((x) => x.trim());
      const durations = (kind === 'transition' ? s.transitionDuration : s.animationDuration).split(',').map(ms);
      let i = names.lastIndexOf(name);
      if (i < 0 && kind === 'transition') i = names.lastIndexOf('all');
      return i < 0 ? 0 : durations[i % durations.length];
    } catch (e) { return 0; }
  };
  const note = (duration) => log.push({duration: Math.round((Number(duration) || 0) * 1000) / 1000});
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const anim = original.apply(this, args);
    let timing = {};
    try { timing = anim.effect.getTiming(); } catch (e) {}
    note(timing.duration);
    return anim;
  };
  document.addEventListener('transitionrun', (event) => note(declared(event.target, event.pseudoElement, 'transition', event.propertyName)), true);
  document.addEventListener('animationstart', (event) => note(declared(event.target, event.pseudoElement, 'animation', event.animationName)), true);
})();
"""

DURATIONS_JS = """(allowed) => {
  const ok = new Set(allowed); const bad = [];
  const ms = v => v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
  const check = (list, where) => { for (const v of String(list).split(',')) { const n = ms(v); if (Number.isNaN(n) || n < 1) continue; if (!ok.has(Math.round(n * 1000) / 1000)) bad.push(where + ': ' + v.trim()); } };
  const reduced = r => r.conditionText && /prefers-reduced-motion/.test(r.conditionText);
  const visit = rules => { for (const r of rules) { if (reduced(r)) continue; if (r.style) { for (const v of [r.style.transitionDuration, r.style.animationDuration]) { if (v && !v.includes('var(')) check(v, r.selectorText || '@'); } } if (r.cssRules) visit(r.cssRules); } };
  for (const s of document.styleSheets) { try { visit(s.cssRules); } catch (e) {} }
  for (const el of document.querySelectorAll('*')) { const cs = getComputedStyle(el); check(cs.transitionDuration, el.tagName); check(cs.animationDuration, el.tagName); }
  return bad;
}"""

SHOWN_JS = "d => d.checkVisibility({opacityProperty: true, visibilityProperty: true})"

ACTIVE_JS = """() => {
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  const label = e.getAttribute('aria-label') || (e.labels && e.labels[0] ? e.labels[0].textContent : '') || e.textContent || '';
  return [e.tagName, e.getAttribute('role') || '', e.getAttribute('type') || '', e.getAttribute('name') || '',
          label.replace(/\\s+/g, ' ').trim().slice(0, 80)].join('|');
}"""

SMALL_JS = """() => {
  const out = [], seen = new Set();
  const controls = 'a[href], button, input, select, textarea, [role=button], [role=link], [role=menuitem], ' +
    '[role=menuitemradio], [role=menuitemcheckbox], [role=combobox], [role=textbox], [role=searchbox], ' +
    '[role=checkbox], [role=radio], [role=switch], [role=spinbutton], [role=option]';
  for (const e of document.querySelectorAll(controls)) {
    if (e.closest('[inert], [aria-hidden="true"]') || e.matches('input[type=hidden]')) continue;
    if (!e.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    let target = e;
    const own = e.getBoundingClientRect();
    const hiddenFile = e.matches('input[type=file]') && (own.width <= 2 || own.height <= 2);
    if (hiddenFile || e.matches('input[type=radio], input[type=checkbox], [role=radio], [role=checkbox], [role=switch]')) {
      const label = (e.labels && e.labels[0]) || e.closest('label');
      if (label) target = label;
    }
    const r = target.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) continue;
    if (e.matches('a[href]')) {
      const p = e.closest('p');
      if (p && p.textContent.trim().length > e.textContent.trim().length + 1) continue;
    }
    if (seen.has(target)) continue;
    seen.add(target);
    if (r.width < 43.5 || r.height < 43.5) {
      const name = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('name') || e.getAttribute('type') || '').trim();
      out.push(e.tagName.toLowerCase() + ' "' + name.slice(0, 40) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  return out;
}"""

UNCOVERED3_JS = """() => {
  const e = document.activeElement;
  if (!e || e === document.body) return '';
  let el = e, r = el.getBoundingClientRect();
  if ((r.width < 3 || r.height < 3) && el.labels && el.labels.length) { el = el.labels[0]; r = el.getBoundingClientRect(); }
  if (r.width < 3 || r.height < 3) return '';
  const name = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('name') || e.tagName).trim().slice(0, 30);
  if (r.top < -0.5 || r.bottom > innerHeight + 0.5) return name + ': outside the viewport';
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
  for (const y of [r.top + 2, r.top + r.height / 2, r.bottom - 2]) {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return name + ': nothing at y=' + Math.round(y);
    const labels = e.labels ? [...e.labels] : [];
    if (!(el.contains(hit) || hit === el || labels.some((l) => l.contains(hit)))) {
      return name + ': covered at y=' + Math.round(y) + ' by ' + hit.tagName.toLowerCase();
    }
  }
  return '';
}"""

SCROLLS_JS = """() => [scrollY, ...[...document.querySelectorAll('*')]
  .filter((e) => e.scrollHeight > e.clientHeight + 1).map((e) => e.scrollTop)].join(',')"""

GONE_JS = """(name) => {
  const named = (d) => {
    const label = d.getAttribute('aria-label');
    if (label) return label.trim();
    return (d.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)
      .map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
  };
  return ![...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog')].some((d) => named(d) === name && (
    d.checkVisibility({opacityProperty: true, visibilityProperty: true}) ||
    (d.checkVisibility({visibilityProperty: true}) && !d.closest('[aria-hidden="true"], [inert]'))));
}"""


def settle_scroll(page) -> None:
    last = None
    for _ in range(10):
        now = page.evaluate(SCROLLS_JS)
        if now == last:
            return
        last = now
        threading.Event().wait(0.08)
        advance(page, 16)


def shown_one(locator):
    def any_shown() -> None:
        assert any(locator.nth(i).is_visible() for i in range(locator.count())), "no visible match yet"
    eventually(locator.page, any_shown, "the control shows")
    return next(locator.nth(i) for i in range(locator.count()) if locator.nth(i).is_visible())


def key_focus(page, target) -> None:
    target.focus()
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Tab")
    if not target.evaluate(HAS_FOCUS_JS):
        tab_to(page, target)


def ring_visible(page, target) -> bool:
    page.mouse.move(1, 1)
    key_focus(page, target)
    finish_motion(page)
    box = target.bounding_box()
    assert box, "the control has no box"
    view = page.viewport_size
    x0, y0 = max(0, box["x"] - RING_BAND), max(0, box["y"] - RING_BAND)
    clip = {"x": x0, "y": y0, "width": min(view["width"], box["x"] + box["width"] + RING_BAND) - x0,
            "height": min(view["height"], box["y"] + box["height"] + RING_BAND) - y0}
    shown = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    finish_motion(page)
    hidden = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    return difference(shown, hidden) > RING_DIFF


def assert_focus_trapped(page, box) -> None:
    for key in ("Tab", "Shift+Tab"):
        for _ in range(TRAP_TABS):
            page.keyboard.press(key)
            assert box.evaluate(HAS_FOCUS_JS), f"SR8: {key} left the open dialog (L269)"


def durations_ok(page, where: str) -> None:
    bad = page.evaluate(DURATIONS_JS, ALLOWED_MS)
    log = page.evaluate("() => (window.__motionLog || []).splice(0)")
    bad += [str(e["duration"]) for e in log if e["duration"] >= 1 and round(e["duration"]) not in ALLOWED_MS]
    assert bad == [], f"SR7: durations other than the published ones on {where} (L268, L285): {bad[:8]}"


def screen_rules(browser, base: str, path: str, who: Api | None = None, *, opener=None, dialog=None, trap: bool = True,
                 reopen: bool = True, typed=None, chosen=None, filled=None, keeps=None, change=None, appears=None,
                 ring=None, refresh: bool = True, size=DESKTOP, also=()) -> None:
    def panel(page):
        if isinstance(dialog, tuple):
            return page.get_by_role(dialog[0], name=dialog[1], exact=True)
        return page.get_by_role("dialog", name=dialog, exact=True)

    def ready(page) -> None:
        eventually(page, lambda: expect(h1(page)).to_be_visible(timeout=EXPECT_MS), f"{path} shows its level-one heading")
        loaded(page)
        finish_motion(page)

    with screen(browser, base, path, who, size=size, record=True) as page:
        ready(page)
        button = shown_one(page.get_by_role(opener[0], name=opener[1], exact=True)) if opener else None
        target = button if button is not None else (shown_one(page.get_by_role(ring[0], name=ring[1], exact=True)) if ring else None)
        if target is not None:
            assert ring_visible(page, target), f"SR8: no visible focus ring on the Tab-focused control of {path} (L269)"
        box = None
        if dialog:
            key_focus(page, button)
            page.keyboard.press("Enter")
            box = panel(page)
            see(page, box)
            if trap:
                focus_in(page, box, "SR8: focus moves inside the open dialog (L244)")
                assert_focus_trapped(page, box)
            finish_motion(page)
            threading.Event().wait(0.2)
            axe(page)
            page.keyboard.press("Escape")
            focused_now(button)
            if reopen:
                page.keyboard.press("Enter")
                see(page, box)
                threading.Event().wait(0.2)
                advance(page, SR2_HOLD_MS)
                finish_motion(page)
                assert box.count() == 1 and box.evaluate(SHOWN_JS), f"SR2: the {dialog} dialog reopened during its closing animation did not stay open (L263)"
                focus_in(page, box, "SR2: focus inside the reopened dialog (L244)")
            else:
                finish_motion(page)
                box = None
        if refresh:
            scope = box if box is not None else page
            field = choice = None
            if typed:
                field = scope.get_by_label(typed[1], exact=True) if typed[0] == "label" else scope.get_by_role(typed[0], name=typed[1], exact=True)
                field.focus()
                page.keyboard.press("End")
                page.keyboard.type(SR1_TYPED)
                kept = field.input_value()
            if chosen:
                choice = scope.get_by_role(chosen[0], name=chosen[1], exact=True)
                pick(choice)
            if filled:
                filled(box)
            if not typed and not chosen and box is None and target is not None:
                key_focus(page, target)
            reads = []

            def count(request) -> None:
                if "/api/" in request.url:
                    reads.append(request.url)
            page.on("request", count)
            before = page.evaluate(ACTIVE_JS)
            if change:
                assert not appears(page), "setup: the change is already on the screen"
                change()
            for _ in range(SR1_ROUNDS):
                after_refresh(page)
                if reads and (not change or appears(page)):
                    break
            page.remove_listener("request", count)
            assert reads, f"SR1: {path} read nothing from the server through the 5-second refresh (L262)"
            if change:
                assert appears(page), f"SR1: the 5-second refresh never showed the change on {path} (L262)"
            if box is not None:
                assert box.count() == 1 and box.is_visible(), f"SR1: the refresh closed the {dialog} dialog (L262)"
            if field is not None:
                assert field.input_value() == kept, "SR1: the refresh changed what was typed (L262)"
            if choice is not None:
                assert choice.is_checked(), "SR1: the refresh undid the unsaved choice (L262)"
            if keeps is not None:
                assert keeps(box), "SR1: the refresh lost what was chosen in the open dialog (L262)"
            assert page.evaluate(ACTIVE_JS) == before, f"SR1: the refresh moved focus on {path} (L262)"
        if box is not None:
            page.keyboard.press("Escape")
            focused_now(button)
            page.keyboard.press("Tab")
            assert not (box.count() and box.evaluate(HAS_FOCUS_JS)), "SR9: Tab reached a control of the closing panel (L270)"
            finish_motion(page)
            threading.Event().wait(0.2)
        axe(page)
        durations_ok(page, path)
    for extra in also:
        with screen(browser, base, path, who, size=extra) as page:
            ready(page)
            axe(page)
    with screen(browser, base, path, who, size=MOBILE, reduced=True) as page:
        ready(page)
        small = page.evaluate(SMALL_JS)
        assert small == [], f"SR4: controls under 44x44 CSS px at 375x812 on {path} (L265): {small[:8]}"
        axe(page)
        box = None
        if dialog:
            tap(shown_one(page.get_by_role(opener[0], name=opener[1], exact=True)))
            box = panel(page)
            see(page, box)
            finish_motion(page)
            small = page.evaluate(SMALL_JS)
            assert small == [], f"SR4: controls under 44x44 CSS px in the open {dialog} panel at 375x812 (L265): {small[:8]}"
            axe(page)
        covered = []
        for _ in range(SR6_TABS):
            page.keyboard.press("Tab")
            settle_scroll(page)
            if box is None or (box.count() and box.evaluate(HAS_FOCUS_JS)):
                problem = page.evaluate(UNCOVERED3_JS)
                if problem:
                    covered.append(problem)
        assert covered == [], f"SR6: focused controls not fully in view at 375x812 on {path} (L267): {covered[:6]}"
        if box is not None:
            page.keyboard.press("Escape")
            advance(page, REDUCED_GONE_MS)
            if isinstance(dialog, tuple):
                assert not box.is_visible(), f"SR3: the closed {dialog[1]} panel still shows {REDUCED_GONE_MS} ms after closing under reduced motion (L264)"
            else:
                assert page.evaluate(GONE_JS, dialog), f"SR3: the closed {dialog} dialog is still shown or in the accessibility tree {REDUCED_GONE_MS} ms after closing under reduced motion (L264)"


def oversized(limit: int = JSON_LIMIT) -> bytes:
    return b'{"pad":"' + b"a" * (limit + 1 - 10) + b'"}'


JSON_HEADERS = {"Content-Type": "application/json"}


def api_rules(base: str, path: str, actor: Api, *, method: str = "POST", limit: int = JSON_LIMIT, reads=()) -> None:
    err(httpx.request(method, base + path, content=oversized(limit), headers=JSON_HEADERS, timeout=HTTP_TIMEOUT), 413, "too_large", TOO_LARGE_COPY)
    err(httpx.request(method, base + path, content=b"{", headers=JSON_HEADERS, timeout=HTTP_TIMEOUT), 401, "not_signed_in")
    err(actor.c.request(method, path, content=b"{", headers=JSON_HEADERS), 403, "forbidden")
    for client, read in reads:
        body = ok(client.get(read), 200, read)
        assert walk_keys(body) == [], f"SR11: {read} breaks the API conventions (L383, L384): {walk_keys(body)}"


def set_cookie_rules(r: httpx.Response) -> None:
    cookies = r.headers.get_list("set-cookie")
    assert cookies, "sign-in sets the session cookie"
    for sc in cookies:
        parts = [p.strip().lower() for p in sc.split(";")]
        assert "HttpOnly".lower() in parts and "SameSite=Lax".lower() in parts and "Secure".lower() not in parts, sc
    jar = list(r.cookies.jar)
    assert jar, "the session cookie is accepted by a cookie jar"
    for jar_cookie in jar:
        assert jar_cookie.expires is None and jar_cookie.discard, f"a browser-session cookie with no lifetime (L955): {jar_cookie}"


def cookie_rules(base: str, email: str, password: str) -> None:
    r = httpx.post(base + "/api/session", json={"email": email, "password": password}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, r.text[:300]
    set_cookie_rules(r)


ACTION_WAIT_S = 6
PENDING_COPY = "Working on it."
FOCUS_IN_ANY_JS = "(els) => els.some(e => e === document.activeElement || e.contains(document.activeElement))"
DISABLED_JS = "e => !e.isConnected || e.disabled || e.getAttribute('aria-disabled') === 'true'"
IN_DIALOG_JS = "e.closest('dialog,[role=dialog],[role=alertdialog]')"
OPENER_FOCUS_JS = "(els) => els.some(e => !" + IN_DIALOG_JS + " && (e === document.activeElement || e.contains(document.activeElement)))"
OPENER_ENABLED_JS = "(els) => els.some(e => !" + IN_DIALOG_JS + " && !e.disabled && e.getAttribute('aria-disabled') !== 'true')"


def closed_focus(page, opener, what: str) -> None:
    def chk() -> None:
        here = opener.evaluate_all(OPENER_FOCUS_JS)
        if not opener.evaluate_all(OPENER_ENABLED_JS):
            here = here or h1(page).evaluate_all(FOCUS_IN_ANY_JS)
        assert here, f"focus is on {focus_text(page)[:60]!r}"
    eventually(page, chk, f"{what}: focus returns to the opener, or to the level-one heading when it is gone (L244)", ACTION_WAIT_S)


def pending_shown(page, url, button, press, methods=("POST", "PUT", "PATCH", "DELETE")) -> None:
    waiting = []

    def hold(route) -> None:
        if route.request.method in methods:
            waiting.append(route)
        else:
            route.fallback()
    page.route(url, hold)
    handle = button.element_handle()
    try:
        press()

        def chk() -> None:
            assert waiting, "the action's request has not been sent yet"
            expect(page.get_by_role("status", name="Announcements", include_hidden=True)).to_contain_text(PENDING_COPY, timeout=EXPECT_MS)
            assert handle.evaluate(DISABLED_JS), "the action's button stays enabled while its request runs"
        eventually(page, chk, "the action shows its pending state (L305)", ACTION_WAIT_S)
    finally:
        page.unroute(url, hold)
        for route in waiting:
            route.fallback()


def problems_rule(page, copy: str, field) -> None:
    region = page.get_by_role("region", name="Problems")
    link = region.get_by_role("link", name=copy)
    see(page, link)
    focus_in(page, region, "focus moves to the Problems region after a refused form (L245)")
    click(link)
    focus_in(page, field, "the Problems link moves focus to its field (L245)")


def test_sign_in_answers_alike(app_url):
    anon = Api(app_url)
    r1 = anon.post("/api/session", {"email": fresh_email("nobody"), "password": STAFF_PASS})
    r2 = anon.post("/api/session", {"email": DANA, "password": MEMBER_PASS})
    assert r1.status_code == r2.status_code == 401, (r1.status_code, r2.status_code)
    api = signin(app_url, DANA)
    assert api.get("/api/session").status_code == 200
    old = api.cookies()
    assert api.delete("/api/session").status_code < 300
    assert Api(app_url, cookies=old).get("/api/session").status_code == 401


def test_staff_management_lifecycle(app_url):
    owner = signin(app_url, OWNER)
    email = fresh_email("staff")
    r = owner.post("/api/staff", {"name": "Rae Kim", "email": email, "password": "starting-pass-1", "role": "coordinator"})
    assert r.status_code == 201, r.text[:300]
    sid = r.json()["staff"]["id"]
    assert sid in {s["id"] for s in ok(owner.get("/api/staff"), 200, "GET /api/staff")["staff"]}
    assert owner.get(f"/api/staff/{sid}").status_code == 200
    rae = signin(app_url, email, "starting-pass-1")
    assert rae.get("/api/ingredients").status_code == 403, "a coordinator has no blend catalog (L418)"
    assert owner.patch(f"/api/staff/{sid}", {"role": "specialist"}).status_code == 200
    assert rae.get("/api/ingredients").status_code == 200, "the new role applies from the next request (L750)"
    assert owner.delete(f"/api/staff/{sid}").status_code < 300
    assert Api(app_url).post("/api/session", {"email": email, "password": "starting-pass-1"}).status_code == 401
    assert sid not in {s["id"] for s in owner.get("/api/staff").json()["staff"]}
    for probe in (sid, unknown_like(sid)):
        assert owner.get(f"/api/staff/{probe}").status_code == 404
        assert owner.patch(f"/api/staff/{probe}", {"role": "coordinator"}).status_code == 404
        assert owner.delete(f"/api/staff/{probe}").status_code == 404


def test_staff_endpoints_refuse_other_roles(app_url):
    owner = signin(app_url, OWNER)
    sam = next(s for s in owner.get("/api/staff").json()["staff"] if s["email"] == SAM)
    email = fresh_email("staff")
    body = {"name": "Rae Kim", "email": email, "password": "starting-pass-1", "role": "coordinator"}
    for who, pw in ((PRIYA, STAFF_PASS), (DANA, STAFF_PASS), (JORDAN, STAFF_PASS), (ELENA, MEMBER_PASS)):
        api = signin(app_url, who, pw)
        assert api.get("/api/staff").status_code == 403
        assert api.post("/api/staff", body).status_code == 403
        assert api.get(f"/api/staff/{sam['id']}").status_code == 403
        assert api.patch(f"/api/staff/{sam['id']}", {"role": "specialist"}).status_code == 403
        assert api.delete(f"/api/staff/{sam['id']}").status_code == 403
    after = {s["email"]: s for s in owner.get("/api/staff").json()["staff"]}
    assert after[SAM]["role"] == "coordinator" and email not in after, "refused calls changed nothing"


def test_wf_practice_access_signin_each_role(browser, app_url):
    homes = [(ELENA, MEMBER_PASS, "/me"), (OWNER, STAFF_PASS, "/staff/members"), (PRIYA, STAFF_PASS, "/staff/results"),
             (DANA, STAFF_PASS, "/staff/calendar"), (JORDAN, STAFF_PASS, "/staff/receipts")]
    for email, pw, home in homes:
        with screen(browser, app_url, "/signin") as page:
            fill(page.get_by_role("textbox", name="Email"), email)
            fill(page.get_by_label("Password", exact=True), pw)
            click(page.get_by_role("button", name="Sign in", exact=True))
            at_url(page, re.escape(app_url + home) + r"$")
            assert page.request.get(app_url + "/api/session").status == 200
            click(page.get_by_role("button", name="Sign out"))
            poll(lambda: page.request.get(app_url + "/api/session").status == 401 or None, UI_WAIT_S,
                 "after Sign out GET /api/session answers 401 (L34)")


def test_wf_practice_access_refused_then_signed_in(browser, app_url):
    with screen(browser, app_url, "/signin") as page:
        answers = []

        def note(response) -> None:
            if response.request.method == "POST" and urlparse(response.url).path == "/api/session":
                answers.append(response.status)
        page.on("response", note)
        fill(page.get_by_role("textbox", name="Email"), fresh_email("nobody"))
        fill(page.get_by_label("Password", exact=True), STAFF_PASS)
        click(page.get_by_role("button", name="Sign in", exact=True))

        def answered() -> None:
            assert answers == [401], f"the refused sign-in has not answered yet: {answers}"
        eventually(page, answered, "the sign-in form sends POST /api/session and is refused")
        assert page.request.get(app_url + "/api/session").status == 401
        fill(page.get_by_role("textbox", name="Email"), DANA)
        fill(page.get_by_label("Password", exact=True), STAFF_PASS)
        click(page.get_by_role("button", name="Sign in", exact=True))
        at_url(page, re.escape(app_url + "/staff/calendar") + r"$")
        assert page.request.get(app_url + "/api/session").status == 200


def test_plan_prices(browser, app_url):
    plans = {p["id"]: p for p in ok(httpx.get(app_url + "/api/plans", timeout=HTTP_TIMEOUT), 200, "plans")["plans"]}
    assert plans["free"]["name"] == "Free" and plans["free"]["prices"] == []
    assert plans["plus"]["name"] == "Plus"
    prices = {p["cadence"]: p for p in plans["plus"]["prices"]}
    assert prices["sixMonths"] == {"cadence": "sixMonths", "months": 6, "amountCents": 74995, "perMonthCents": 12499}
    assert prices["yearly"] == {"cadence": "yearly", "months": 12, "amountCents": 127492, "perMonthCents": 10624}
    exact = (2 * Decimal("749.95") * Decimal("0.85")).quantize(Decimal("0.01"), ROUND_HALF_UP)
    assert int(exact * 100) == prices["yearly"]["amountCents"]
    with screen(browser, app_url, "/plans") as page:
        pick(page.get_by_role("radio", name="Yearly"))
        price_is(page, "$1,274.92 a year", "$106.24 a month")
        pick(page.get_by_role("radio", name="Every 6 months"))
        price_is(page, "$749.95 every 6 months", "$124.99 a month")


def test_state_check(app_url):
    states = ok(httpx.get(app_url + "/api/states", timeout=HTTP_TIMEOUT), 200, "states")["states"]
    assert len(states) == 50
    assert sum(1 for s in states if s["served"]) == 47
    assert {s["name"] for s in states if not s["served"]} == {"Alaska", "Hawaii", "Rhode Island"}
    assert all(re.fullmatch(r"[a-z]{2}", s["state"]) for s in states)
    co = ok(httpx.get(app_url + "/api/states/co", timeout=HTTP_TIMEOUT), 200, "co")
    assert co == {"state": "co", "name": "Colorado", "served": True, "message": state_copy(True, "Colorado")}
    ri = ok(httpx.get(app_url + "/api/states/ri", timeout=HTTP_TIMEOUT), 200, "ri")
    assert ri["served"] is False and ri["message"] == state_copy(False, "Rhode Island")
    ak = httpx.get(app_url + "/api/states/ak", timeout=HTTP_TIMEOUT).json()
    assert ak["message"] == state_copy(False, "Alaska")
    err(httpx.get(app_url + "/api/states/zz", timeout=HTTP_TIMEOUT), 404, "not_found")


def test_marker_catalog(browser, app_url):
    cats = ok(httpx.get(app_url + "/api/markers", timeout=HTTP_TIMEOUT), 200, "markers")["categories"]
    assert [c["id"] for c in cats] == CATEGORY_IDS and [c["name"] for c in cats] == CATEGORY_NAMES
    assert sum(len(c["markers"]) for c in cats) == 20
    vit = next(mk for c in cats for mk in c["markers"] if mk["id"] == "vitaminD")
    assert vit == {"id": "vitaminD", "name": "Vitamin D", "unit": "ng/mL", "decimals": 1}
    hit = httpx.get(app_url + "/api/markers", params={"q": "hemoglobin a-1c"}, timeout=HTTP_TIMEOUT).json()["categories"]
    assert [c["id"] for c in hit] == ["metabolic"] and "hba1c" in {mk["id"] for mk in hit[0]["markers"]}
    hit = httpx.get(app_url + "/api/markers", params={"q": "25(OH)"}, timeout=HTTP_TIMEOUT).json()["categories"]
    assert "vitaminD" in {mk["id"] for c in hit for mk in c["markers"]}
    with screen(browser, app_url, "/markers") as page:
        heading(page, "Marker catalog")
        for name in CATEGORY_NAMES:
            expect(page.get_by_role("button", name=name, exact=True)).to_have_attribute("aria-expanded", "false")
        heart = page.get_by_role("button", name="Heart", exact=True)
        click(heart)
        eventually(page, lambda: (expect(heart).to_have_attribute("aria-expanded", "true", timeout=EXPECT_MS),
                                  expect(page).to_have_url(re.compile(r"[?&]open=[^&]*heart"), timeout=EXPECT_MS)), "Heart opens")
        region = page.get_by_role("region", name="Heart", exact=True)
        see(page, region, "LDL")
        click(page.get_by_role("button", name="Nutrients", exact=True))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"open=[^&]*nutrients"), timeout=EXPECT_MS), "two open")
        handle = region.element_handle()
        click(heart)

        eventually(page, lambda: expect(heart).to_have_attribute("aria-expanded", "false", timeout=EXPECT_MS), "Heart starts closing")
        for _ in range(3):
            if handle.evaluate(INERT_JS):
                break
            advance(page, FRAME_MS // 2)
        assert handle.evaluate(INERT_JS), "a closing panel is inert from the moment it starts closing (L40, SR9)"
        until(page, NO_RUNNING_JS)
        eventually(page, lambda: expect(page.get_by_role("region", name="Heart", exact=True)).to_have_count(0, timeout=EXPECT_MS),
                   "closed panel leaves the accessibility tree")

        def hidden() -> None:
            assert handle.evaluate(HIDDEN_JS), "closed panel is hidden, not merely collapsed (SR9)"
        eventually(page, hidden, "the closed panel is hidden once its close ends (SR9)", PRESS_WAIT_S)
        page.go_back()
        eventually(page, lambda: expect(heart).to_have_attribute("aria-expanded", "true", timeout=EXPECT_MS), "Back reopens Heart")
        page.go_forward()
        eventually(page, lambda: expect(heart).to_have_attribute("aria-expanded", "false", timeout=EXPECT_MS), "Forward closes Heart")
        box = page.get_by_role("searchbox", name="Search markers")
        nutrients = page.get_by_role("region", name="Nutrients", exact=True)
        hold_clock(page)
        fill(box, "ferritin")
        assert "q=" not in page.url, "search waits for its pause before settling (L240)"
        advance(page, DEBOUNCE_MS)
        page.clock.resume()
        eventually(page, lambda: (expect(page).to_have_url(re.compile(r"[?&]q=ferritin"), timeout=EXPECT_MS),
                                  expect(nutrients).to_contain_text("Ferritin", timeout=EXPECT_MS),
                                  expect(nutrients).not_to_contain_text("Vitamin D", timeout=EXPECT_MS)), "search settles")
        page.go_back()
        eventually(page, lambda: (expect(page).not_to_have_url(re.compile(r"q=ferritin"), timeout=EXPECT_MS),
                                  expect(nutrients).to_contain_text("Vitamin D", timeout=EXPECT_MS)), "Back restores the search")
        first = []

        def hold_first(route) -> None:
            if first:
                route.fallback()
            else:
                first.append(route)
        page.route("**/api/markers*", hold_first)
        fill(box, "ldl")
        advance(page, DEBOUNCE_MS)
        fill(box, "ferritin")
        advance(page, DEBOUNCE_MS)
        eventually(page, lambda: (expect(nutrients).to_contain_text("Ferritin", timeout=EXPECT_MS),
                                  expect(page).to_have_url(re.compile(r"q=ferritin"), timeout=EXPECT_MS)), "the later search answers")
        for held_route in first:
            held_route.fallback()
        page.unroute("**/api/markers*", hold_first)
        after_refresh(page)
        eventually(page, lambda: (expect(nutrients).to_contain_text("Ferritin", timeout=EXPECT_MS),
                                  expect(page.get_by_role("searchbox", name="Search markers")).to_have_value("ferritin", timeout=EXPECT_MS),
                                  expect(page).to_have_url(re.compile(r"q=ferritin"), timeout=EXPECT_MS)), "an earlier answer arriving later is dropped (L240)")


def test_public_layouts_header_strip(browser, app_url):
    sizes = [(1280, 800), (1100, 800), (1099, 800), (1024, 768), (768, 1024), (600, 812), (599, 812), (375, 812)]
    with screen(browser, app_url, "/plans") as page:
        for w, h in sizes:
            page.set_viewport_size({"width": w, "height": h})
            page.reload()
            heading(page, "Plans")
            settle(page.locator("body"))
            pb = part_handle(page, page.locator("body"), "price").bounding_box()
            tb = page.get_by_role("table", name="Compare Free and Plus").bounding_box()
            fb = page.get_by_role("link", name="Create a free account").first.bounding_box()
            assert tb["y"] >= pb["y"] + pb["height"] - 1, f"comparison table below the plan cards at {w} (L152)"
            apart = fb["x"] + fb["width"] <= pb["x"] + 1 or pb["x"] + pb["width"] <= fb["x"] + 1
            assert apart == (w >= NARROW_SWITCH), f"Free and Plus cards are in two columns from 600 px, one below it, at {w} (L152)"
            layout(page)
        assert fixed_bottom(page.get_by_role("button", name="Join Plus")), "Join Plus bar fixed to the bottom at 375 (L152)"
        banner = page.get_by_role("banner")
        for y, state in ((0, "top"), (HEADER_SOLID_PX, "solid"), (HEADER_SOLID_PX - 1, "top"), (HEADER_SOLID_PX * 4, "solid"), (0, "top")):
            page.evaluate("(y) => window.scrollTo(0, y)", y)
            eventually(page, lambda: expect(banner).to_have_attribute("data-state", state, timeout=EXPECT_MS), f"header {state} at {y}px")
    with screen(browser, app_url, "/") as page:
        strip = page.get_by_role("region", name="Lab partners")
        for name in ("Saguaro Diagnostics", "Mesa Clinical Labs", "Copperline Pathology", "Bluebird Assay Partners",
                     "Red Rock Reference Lab", "Palo Verde Analytics"):
            expect(strip).to_contain_text(name)
        strip.scroll_into_view_if_needed()

        def loops(state):
            return [a for a in strip.evaluate(ANIMS_JS) if a["iterations"] == -1 and a["state"] == state]

        def paused():
            assert not loops("running"), "the strip still runs"

        def running():
            assert loops("running"), "the strip is paused"
        assert any(abs(a["duration"] - STRIP_PASS_MS) < 1 for a in loops("running")), "strip loops one pass every 64 s (L293)"
        box = strip.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        eventually(page, paused, "a mouse over the strip pauses it (L243)")
        page.mouse.move(1, 1)
        eventually(page, running, "the strip resumes when the pointer leaves (L243)")
        strip.focus()
        eventually(page, paused, "focus pauses the strip (L243)")
    with screen(browser, app_url, "/", reduced=True) as page:
        strip = page.get_by_role("region", name="Lab partners")
        running_now = [a for a in strip.evaluate(ANIMS_JS) if a["state"] == "running"]
        assert not running_now, f"under reduced motion the strip stops (L301): {running_now}"


def test_free_account_signup(app_url):
    api, member, email = signup(app_url)
    s = ok(api.get("/api/session"), 200, "session after sign-up")
    assert s["home"] == "/me" and s["user"]["role"] == "member"
    me = ok(api.get("/api/me"), 200, "GET /api/me")["member"]
    assert me["email"] == email and me["membership"]["state"] == "free" and me["state"] == "co" and me["timeZone"] == "denver"
    base = {"name": MEMBER_NAME, "email": fresh_email("visitor"), "password": "long-enough-pass", "dateOfBirth": "1990-04-12",
            "sex": "female", "state": "co", "timeZone": "denver"}
    field_err(Api(app_url).post("/api/accounts", dict(base, state="ak")), "state", state_copy(False, "Alaska"))
    field_err(Api(app_url).post("/api/accounts", dict(base, password="short")), "password", "Use at least 12 characters.")
    teen = (local_today("denver") - timedelta(days=(MIN_AGE_YEARS - 1) * 365)).isoformat()
    field_err(Api(app_url).post("/api/accounts", dict(base, dateOfBirth=teen)), "dateOfBirth", "Members must be 18 or older.")
    field_err(Api(app_url).post("/api/accounts", dict(base, timeZone="mars")), "timeZone", "Choose one of the options.")
    err(Api(app_url).post("/api/accounts", dict(base, email=email)), 409, "email_taken", "An account with this email already exists.")
    err(Api(app_url).post("/api/session", {"email": base["email"], "password": "long-enough-pass"}), 401, "sign_in_failed")


def test_wf_public_site_touch_journey(browser, app_url):
    with screen(browser, app_url, "/plans", size=MOBILE) as page:
        heading(page, "Plans")
        pick(page.get_by_role("radio", name="Yearly"), touch=True)
        price_is(page, "$1,274.92 a year", "$106.24 a month")
        pick(page.get_by_role("radio", name="Every 6 months"), touch=True)
        price_is(page, "$749.95 every 6 months", "$124.99 a month")
        assert fixed_bottom(page.get_by_role("button", name="Join Plus"))
        layout(page)
        axe(page)
        select(page.get_by_role("combobox", name="Your state"), "Colorado")
        tap(page.get_by_role("button", name="Check state"))
        say(page, state_copy(True, "Colorado"))
        page.goto(app_url + "/markers")
        heart = page.get_by_role("button", name="Heart", exact=True)
        big_enough(heart)
        tap(heart)
        eventually(page, lambda: expect(heart).to_have_attribute("aria-expanded", "true", timeout=EXPECT_MS), "Heart opens by tap")
        see(page, page.get_by_role("region", name="Heart", exact=True), "LDL")
        page.goto(app_url + "/join")
        heading(page, "Create your free account")
        email = fresh_email("visitor")
        fill(page.get_by_role("textbox", name="Full name"), MEMBER_NAME)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_label("Password", exact=True), "long-enough-pass")
        fill(page.get_by_role("textbox", name="Date of birth"), "1990-04-12")
        pick(page.get_by_role("radio", name="Female"), touch=True)
        select(page.get_by_role("combobox", name="Home state"), "Colorado")
        select(page.get_by_role("combobox", name="Local time"), "Denver time")
        axe(page)
        create = page.get_by_role("button", name="Create account")
        password = page.get_by_label("Password", exact=True)
        fill(password, "short")
        tap(create)
        problems_rule(page, "Use at least 12 characters.", password)
        fill(password, "long-enough-pass")
        pending_shown(page, "**/api/accounts", create, lambda: tap(create))
        at_url(page, re.escape(app_url + "/me") + r"$")
        see(page, h1(page), f"Welcome, {FIRST_NAME}")
        me = page.request.get(app_url + "/api/me").json()["member"]
        assert me["email"] == email and me["membership"]["state"] == "free"
    screen_rules(browser, app_url, "/plans", opener=("button", "Explore"), dialog=("navigation", "Explore"), trap=False, reopen=False, refresh=False)
    screen_rules(browser, app_url, "/markers", ring=("button", "Metabolic"), refresh=False)
    screen_rules(browser, app_url, "/", ring=("link", "See plans"), refresh=False)
    with screen(browser, app_url, "/markers", size=MOBILE, reduced=True) as page:
        heart = page.get_by_role("button", name="Heart", exact=True)
        tap(heart)
        region = page.get_by_role("region", name="Heart", exact=True)
        see(page, region, "LDL")
        tap(heart)
        advance(page, REDUCED_GONE_MS)
        expect(region).to_have_count(0)
    err(httpx.post(app_url + "/api/accounts", content=oversized(), headers=JSON_HEADERS, timeout=HTTP_TIMEOUT), 413, "too_large", TOO_LARGE_COPY)
    err(httpx.delete(app_url + "/api/plans", timeout=HTTP_TIMEOUT), 405, "method_not_allowed")
    joined = httpx.post(app_url + "/api/accounts", json={"name": MEMBER_NAME, "email": fresh_email("visitor"), "password": "long-enough-pass",
                                                         "dateOfBirth": "1990-04-12", "sex": "female", "state": "co", "timeZone": "denver"}, timeout=HTTP_TIMEOUT)
    assert joined.status_code == 201, joined.text[:300]
    set_cookie_rules(joined)
    assert walk_keys(joined.json()) == [], walk_keys(joined.json())


def test_wf_public_site_keyboard_journey(browser, app_url):
    with screen(browser, app_url, "/plans") as page:
        six = page.get_by_role("radio", name="Every 6 months")
        yearly = page.get_by_role("radio", name="Yearly")
        tab_to(page, page.get_by_role("radiogroup", name="Billing cadence"))
        start_checked = yearly.is_checked()
        page.evaluate(RECORD_JS)
        page.keyboard.press("ArrowRight" if not start_checked else "ArrowLeft")
        page.keyboard.press(" ")
        anims = []

        def rolled() -> None:
            anims[:] = [r for r in page.evaluate(READ_JS) if {"price", "per-month"} & set(r["parts"])]
            assert {"price", "per-month"} <= {p for r in anims for p in r["parts"]}, f"both lines roll (L292): {anims}"
        eventually(page, rolled, "the price and the per-month line roll (L292)")
        assert all(abs(a["duration"] - MEDIUM_MS) < 1 for a in anims), f"price roll is medium (L292): {anims}"
        starts = [a["start"] for a in anims if a["start"] is not None]
        assert starts and max(starts) - min(starts) <= FRAME_MS, f"both lines start in the same frame (L292): {anims}"
        if start_checked:
            price_is(page, "$749.95 every 6 months", "$124.99 a month")
            expect(six).to_be_checked()
        else:
            price_is(page, "$1,274.92 a year", "$106.24 a month")
            expect(yearly).to_be_checked()
        select(page.get_by_role("combobox", name="Your state"), "Alaska")
        page.get_by_role("button", name="Check state").focus()
        page.keyboard.press("Enter")
        say(page, state_copy(False, "Alaska"))
        page.goto(app_url + "/markers")
        meta = page.get_by_role("button", name="Metabolic", exact=True)
        tab_to(page, meta)
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(meta).to_have_attribute("aria-expanded", "true", timeout=EXPECT_MS), "Enter opens")
        see(page, page.get_by_role("region", name="Metabolic", exact=True), "HbA1c")
        page.keyboard.press(" ")
        eventually(page, lambda: expect(meta).to_have_attribute("aria-expanded", "false", timeout=EXPECT_MS), "Space closes")


def test_join_confirmed_by_killbill(app_url, killbill):
    api, me, email = signup(app_url)
    assert killbill.account_by_key(me["id"]) is None, "a Free member has no Kill Bill account (L564)"
    first = ok(api.post("/api/me/membership", {"cadence": "yearly"}), 201, "join")["membership"]
    assert first["state"] in ("active", "pending") and first["cadence"] == "yearly"
    membership = wait_active(api)
    acct = kb_account(killbill, me["id"])
    subs = killbill.subscriptions(acct["accountId"])
    assert len(subs) == 1, subs
    assert membership["renewalDate"] == str(subs[0]["chargedThroughDate"])[:10], (membership, subs)
    invoices = killbill.invoices(acct["accountId"])
    assert any(Decimal(str(i["amount"])) == Decimal("1274.92") and Decimal(str(i["balance"])) == 0 for i in invoices), invoices
    err(api.post("/api/me/membership", {"cadence": "yearly"}), 409, "already_plus", "You already have Plus.")
    assert len(killbill.subscriptions(acct["accountId"])) == 1


def test_join_request_key(app_url, killbill):
    api, me, _ = signup(app_url)
    key = f"join-{uuid.uuid4().hex}"
    raw = json.dumps({"cadence": "yearly"}).encode()
    hdr = {"Request-Key": key, "Content-Type": "application/json"}
    r1 = api.c.post("/api/me/membership", content=raw, headers=hdr)
    r2 = api.c.post("/api/me/membership", content=raw, headers=hdr)
    assert r1.status_code == 201, r1.text
    assert r2.status_code == r1.status_code and r2.json() == r1.json(), "replay answers the first response (L583)"
    wait_active(api)
    acct = kb_account(killbill, me["id"])
    assert len(killbill.subscriptions(acct["accountId"])) == 1, "one subscription for a replayed join"
    r3 = api.c.post("/api/me/membership", content=json.dumps({"cadence": "sixMonths"}).encode(), headers=hdr)
    err(r3, 409, "request_key_reused", "This request key was already used for a different request.")
    err(api.post("/api/me/membership", {"cadence": "yearly"}, headers={"Request-Key": key + "-other"}), 409, "already_plus")
    assert len(killbill.subscriptions(acct["accountId"])) == 1


def test_cadence_change_and_cancel(app_url, killbill):
    free_api, _, _ = signup(app_url)
    err(free_api.patch("/api/me/membership", {"cadence": "yearly"}), 409, "not_plus", "You don't have Plus.")
    err(free_api.post("/api/me/membership/cancel"), 409, "not_plus", "You don't have Plus.")
    api, me, _ = signup(app_url)
    ok(api.post("/api/me/membership", {"cadence": "yearly"}), 201, "join")
    membership = wait_active(api)
    acct = kb_account(killbill, me["id"])
    ctd = str(killbill.subscriptions(acct["accountId"])[0]["chargedThroughDate"])[:10]
    err(api.patch("/api/me/membership", {"cadence": "yearly"}), 409, "same_cadence", "You're already on that cadence.")
    changed = ok(api.patch("/api/me/membership", {"cadence": "sixMonths"}), 200, "cadence change")["membership"]
    assert changed["cadence"] == "yearly" and changed["pendingCadence"] == "sixMonths"
    assert changed["pendingFrom"] == ctd == membership["renewalDate"], (changed, ctd)
    assert killbill.subscriptions(acct["accountId"])[0].get("planName") == "plus-yearly", "plan switches only at the end of the term"
    cancelled = ok(api.post("/api/me/membership/cancel"), 200, "cancel")["membership"]
    assert cancelled["state"] == "cancelled" and cancelled["plusUntil"] == ctd
    sub = killbill.subscriptions(acct["accountId"])[0]
    assert ends_at_term(sub, ctd), f"end-of-term cancel in Kill Bill (L758): {sub}"
    err(api.post("/api/me/membership/cancel"), 409, "already_ending", "Plus is already set to end.")


def test_payments_outage(killbill):
    down = env_url("APP_KILLBILL_DOWN_URL")
    api, me, email = signup(down)
    err(api.post("/api/me/membership", {"cadence": "yearly"}), 503, "payments_unavailable", PAYMENTS_COPY)
    assert api.get("/api/me/membership").json()["membership"]["state"] == "free"
    assert killbill.account(email) is None
    owner = signin(down, OWNER)
    new_email = fresh_email("member")
    body = {"name": MEMBER_NAME, "email": new_email, "password": MEMBER_PASS, "dateOfBirth": "1987-03-02", "sex": "female",
            "state": "co", "timeZone": "denver", "phone": PHONE, "address": ADDRESS, "gateNotes": GATE, "cadence": "sixMonths"}
    err(owner.post("/api/members", body), 503, "payments_unavailable", PAYMENTS_COPY)
    assert new_email not in {m.get("email") for m in owner.get("/api/members").json()["members"]}
    assert killbill.account(new_email) is None
    elena = signin(down, ELENA, MEMBER_PASS)
    before = elena.get("/api/me").json()["member"]
    err(elena.patch("/api/me/membership", {"cadence": "yearly"}), 503, "payments_unavailable", PAYMENTS_COPY)
    err(elena.post("/api/me/membership/cancel"), 503, "payments_unavailable", PAYMENTS_COPY)
    err(elena.post("/api/me/closure"), 503, "payments_unavailable", PAYMENTS_COPY)
    after = elena.get("/api/me").json()["member"]
    assert after["accountState"] == "active" and after["membership"] == before["membership"]
    ok(api.post("/api/me/closure"), 200, "a Free member's closure needs no Kill Bill")
    err(owner.post(f"/api/members/{me['id']}/restore"), 503, "payments_unavailable", PAYMENTS_COPY)
    assert owner.get(f"/api/members/{me['id']}").json()["member"]["accountState"] == "closing"


def test_wf_memberships_join_change_cancel(browser, app_url, killbill):
    api, me, _ = signup(app_url)
    with screen(browser, app_url, "/me/membership", api, size=MOBILE, clock_hours=30) as page:
        heading(page, "Membership")
        body = page.locator("body")
        part_has(page, body, "membership-state", "Free")
        join = page.get_by_role("button", name="Join Plus")
        assert fixed_bottom(join)
        tap(join.first)
        dialog = page.get_by_role("dialog", name="Join Plus")
        see(page, dialog)
        axe(page)
        pick(dialog.get_by_role("radio", name="Yearly"), touch=True)
        tap(dialog.get_by_role("button", name="Confirm and join"))
        say(page, re.compile(re.escape("Welcome to Plus. Your membership is active.") + "|" +
                             re.escape("Your payment is being confirmed. Plus shows Active once it is.")))
        closed_focus(page, page.get_by_role("button", name="Join Plus"), "after Confirm and join")
        membership = wait_active(api)
        acct = kb_account(killbill, me["id"])
        assert membership["renewalDate"] == str(killbill.subscriptions(acct["accountId"])[0]["chargedThroughDate"])[:10]
        part_has(page, body, "membership-state", "Plus · Active")
        part_has(page, body, "membership-state", f"Renews {fmt_date(date.fromisoformat(membership['renewalDate']))}")
        tap(page.get_by_role("button", name="Change cadence").first)
        dialog = page.get_by_role("dialog", name="Change cadence")
        pick(dialog.get_by_role("radio", name="Every 6 months"), touch=True)
        confirm = dialog.get_by_role("button", name="Confirm change")
        pending_shown(page, "**/api/me/membership", confirm, lambda: tap(confirm))
        say(page, "Your cadence changes at your next renewal.")
        closed_focus(page, page.get_by_role("button", name="Change cadence"), "after Confirm change")
        m2 = api.get("/api/me/membership").json()["membership"]
        assert m2["pendingCadence"] == "sixMonths"
        part_has(page, body, "membership-state", f"Every 6 months from {fmt_date(date.fromisoformat(m2['pendingFrom']))}")
        tap(page.get_by_role("button", name="Cancel Plus"))
        dialog = page.get_by_role("dialog", name="Cancel Plus")
        tap(dialog.get_by_role("button", name="Yes, cancel Plus"))
        say(page, "Plus stays until the end of your paid period.")
        closed_focus(page, page.get_by_role("button", name="Cancel Plus", exact=True), "after Yes, cancel Plus")
        m3 = api.get("/api/me/membership").json()["membership"]
        assert m3["state"] == "cancelled"
        assert ends_at_term(killbill.subscriptions(acct["accountId"])[0], m3["plusUntil"])
        part_has(page, body, "membership-state", "Plus · Ending")
        part_has(page, body, "membership-state", f"Plus until {fmt_date(date.fromisoformat(m3['plusUntil']))}")
        layout(page)
        axe(page)
    other = new_member(app_url)
    screen_rules(browser, app_url, "/me/membership", other.api, opener=("button", "Change cadence"), dialog="Change cadence", chosen=("radio", "Yearly"),
                 change=lambda: ok(other.api.patch("/api/me/membership", {"cadence": "yearly"}), 200, "a cadence change behind the dialog"),
                 appears=lambda page: any("from" in t for t in page.evaluate(VISIBLE_TEXTS_JS, '[data-part="membership-state"]')))
    api_rules(app_url, "/api/me/membership", signin(app_url, DANA), reads=[(other.api, "/api/me"), (other.api, "/api/session")])
    cookie_rules(app_url, other.email, MEMBER_PASS)
    keyed, _, _ = signup(app_url)
    with screen(browser, app_url, "/me/membership", keyed) as page:
        tab_to(page, page.get_by_role("button", name="Join Plus").first)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Join Plus")
        see(page, dialog)
        focus_in(page, dialog, "opening moves focus into the dialog (L244)")
        dialog.get_by_role("radio", name="Yearly").focus()
        page.keyboard.press("Space")
        dialog.get_by_role("button", name="Confirm and join").focus()
        page.keyboard.press("Enter")
        wait_active(keyed)
        part_has(page, page.locator("body"), "membership-state", "Plus · Active")
        tab_to(page, page.get_by_role("button", name="Cancel Plus"))
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Cancel Plus")
        see(page, dialog)
        dialog.get_by_role("button", name="Yes, cancel Plus").focus()
        page.keyboard.press("Enter")
        say(page, "Plus stays until the end of your paid period.")


def test_wf_memberships_outage(browser):
    down = env_url("APP_KILLBILL_DOWN_URL")
    api, _, _ = signup(down)
    with screen(browser, down, "/me/membership", api, size=MOBILE) as page:
        tap(page.get_by_role("button", name="Join Plus").first)
        dialog = page.get_by_role("dialog", name="Join Plus")
        pick(dialog.get_by_role("radio", name="Yearly"), touch=True)
        tap(dialog.get_by_role("button", name="Confirm and join"))
        see(page, dialog, PAYMENTS_COPY)
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("radio", name="Yearly")).to_be_checked()
        focus_on(page, PAYMENTS_COPY)
        assert api.get("/api/me/membership").json()["membership"]["state"] == "free"


def test_slots_wall_time(app_url):
    m = new_member(app_url)
    ps = phlebotomists(m.owner)
    luis, ivy, bree = ps["Luis Carrillo"]["id"], ps["Ivy Chen"]["id"], ps["Bree Halvorsen"]["id"]
    change = next_change("denver", local_today("denver") + timedelta(days=2))
    sat, mon = change - timedelta(days=1), change + timedelta(days=1)
    phoenix_seven = []
    for d in (sat, mon):
        slots = ok(m.owner.get(f"/api/slots?memberId={m.id}&date={d}"), 200, "slots")["slots"]
        assert {s["phlebotomistId"] for s in slots} == {luis, ivy}, "only phlebotomists serving co are listed"
        mine = [s for s in slots if s["phlebotomistId"] == luis]
        assert [s["localTime"] for s in mine] == slot_times()
        for s in mine:
            assert s["startsAt"] == iso(at_local("denver", d, s["localTime"])), s
        phoenix_seven.append(parse_iso(next(s for s in mine if s["localTime"] == "07:00")["startsAt"]).astimezone(PHX).hour)
    assert phoenix_seven[0] != phoenix_seven[1], "the Phoenix time of a 07:00 Denver slot moves across the change (L589)"
    sunday = [s for s in m.owner.get(f"/api/slots?memberId={m.id}&date={change}").json()["slots"] if s["phlebotomistId"] == luis]
    assert sunday == [], "no slots on Sunday"
    field_err(book(m.owner, m, luis, change, "07:00"), "time", TIME_COPY)
    field_err(book(m.owner, m, luis, mon, "07:10"), "time", TIME_COPY)
    field_err(book(m.owner, m, bree, mon, "07:00"), "phlebotomistId", "This phlebotomist doesn't serve Colorado.")
    today = [s for s in m.owner.get(f"/api/slots?memberId={m.id}&date={local_today('denver')}").json()["slots"] if s["phlebotomistId"] == luis]
    assert [s["localTime"] for s in today] == slot_times(), "staff slot reads for today list all 12 times (L601)"


def test_one_booking_per_slot(app_url):
    m = new_member(app_url)
    ivy = phlebotomists(m.owner)["Ivy Chen"]["id"]
    d, s = free_slot(m.owner, m.id, {ivy}, workday(local_today("denver") + timedelta(days=45)))
    callers = [(OWNER, "Maya Okafor"), (DANA, "Dana Ruiz"), (SAM, "Sam Whitfield")] * 2
    clients = [(signin(app_url, e), n) for e, n in callers]
    with concurrent.futures.ThreadPoolExecutor(len(clients)) as pool:
        futures = [(pool.submit(book, c, m, ivy, d, s["localTime"]), n) for c, n in clients]
        results = [(f.result(), n) for f, n in futures]
    winners = [n for r, n in results if r.status_code == 201]
    assert len(winners) == 1, [(r.status_code, r.text[:200]) for r, _ in results]
    taken = parse_iso(s["startsAt"])
    nd, nxt = None, None
    day = d
    for _ in range(14):
        if day.weekday() != 6:
            for slot in m.owner.get(f"/api/slots?memberId={m.id}&date={day}").json()["slots"]:
                if slot["phlebotomistId"] == ivy and slot["free"] and parse_iso(slot["startsAt"]) > taken:
                    nd, nxt = day, slot
                    break
        if nxt:
            break
        day += timedelta(days=1)
    assert nxt, "a free slot follows the taken one"
    copy = f"That slot was just taken by {winners[0]}. The next free slot is {fmt_date(nd)}, {nxt['localTime']} Denver time."
    for r, _ in results:
        if r.status_code != 201:
            err(r, 409, "slot_taken", copy)
    booked = [x for x in m.owner.get(f"/api/draws?memberId={m.id}").json()["draws"] if x["startsAt"] == s["startsAt"]]
    assert len(booked) == 1


def test_who_can_have_a_draw(app_url):
    free = new_member(app_url, cadence=None)
    luis = phlebotomists(free.owner)["Luis Carrillo"]["id"]
    target = workday(local_today("denver") + timedelta(days=9))
    err(book(free.owner, free, luis, target, "07:00"), 409, "plus_required", "Draws are part of Plus.")
    m = new_member(app_url)
    far = workday(local_today("denver") + timedelta(days=STAFF_WINDOW_DAYS + 2))
    field_err(book(m.owner, m, luis, far, "07:00"), "date", "Choose a date within 400 days of today.")
    member_copy = "Choose a date from tomorrow up to 28 days ahead."
    field_err(m.api.post("/api/me/draws", {"phlebotomistId": luis, "date": str(local_today("denver")), "time": "07:00"}), "date", member_copy)
    late = workday(local_today("denver") + timedelta(days=MEMBER_WINDOW_DAYS + 1))
    field_err(m.api.post("/api/me/draws", {"phlebotomistId": luis, "date": str(late), "time": "07:00"}), "date", member_copy)
    past = workday(local_today("denver") - timedelta(days=12), -1)
    pd, ps = free_slot(m.owner, m.id, {luis}, past, step=-1)
    field_err(book(m.owner, m, luis, pd, ps["localTime"], kitCodes=[new_kit()]), "collectedAt", "Give the collected time for a past draw.")
    wrong_day = iso(at_local("denver", pd + timedelta(days=1), "10:00"))
    field_err(book(m.owner, m, luis, pd, ps["localTime"], collectedAt=wrong_day, kitCodes=[new_kit()]), "collectedAt",
              "Give the collected time for a past draw.")
    draw, _, _ = past_draw(m, past)
    assert draw["visitPage"]["state"] == "none" and draw["collectedAt"] is not None
    d, s = free_slot(m.api, m.id, {luis}, workday(local_today("denver") + timedelta(days=20)), me=True)
    mine = ok(m.api.post("/api/me/draws", {"phlebotomistId": luis, "date": str(d), "time": s["localTime"]}), 201, "member books")["draw"]
    assert mine["state"] == "booked" and "memberName" not in mine


def test_member_change_cutoff(app_url):
    m = new_member(app_url)
    luis = phlebotomists(m.owner)["Luis Carrillo"]["id"]
    today = local_today("denver")
    slots = m.owner.get(f"/api/slots?memberId={m.id}&date={today}").json()["slots"]
    s = next((x for x in slots if x["phlebotomistId"] == luis and x["free"]), None)
    assert s, "a free same-day staff slot"
    draw = ok(book(m.owner, m, luis, today, s["localTime"]), 201, "same-day booking")["draw"]
    assert draw["changesCloseAt"] == iso(at_local("denver", today - timedelta(days=1), "18:00"))
    copy = f"Changes closed at {fmt_date(today - timedelta(days=1))}, 18:00 Denver time. Message your care team to change this draw."
    nd, ns = free_slot(m.api, m.id, {luis}, workday(today + timedelta(days=3)), me=True)
    err(m.api.patch(f"/api/me/draws/{draw['id']}", {"date": str(nd), "time": ns["localTime"]}), 409, "changes_closed", copy)
    err(m.api.post(f"/api/me/draws/{draw['id']}/cancel"), 409, "changes_closed", copy)
    assert ok(m.owner.post(f"/api/draws/{draw['id']}/cancel"), 200, "staff are not bound")["draw"]["state"] == "cancelled"
    change = next_change("denver", today + timedelta(days=2))
    mon = change + timedelta(days=1)
    cd, cs = free_slot(m.owner, m.id, {luis}, mon)
    far = ok(book(m.owner, m, luis, cd, cs["localTime"]), 201, "draw after the change")["draw"]
    assert far["changesCloseAt"] == iso(at_local("denver", cd - timedelta(days=1), "18:00"))
    d, s2 = free_slot(m.api, m.id, {luis}, workday(today + timedelta(days=10)), me=True)
    mine = ok(m.api.post("/api/me/draws", {"phlebotomistId": luis, "date": str(d), "time": s2["localTime"]}), 201, "member books")["draw"]
    d2, s3 = free_slot(m.api, m.id, {luis}, workday(d + timedelta(days=1)), me=True)
    moved = ok(m.api.patch(f"/api/me/draws/{mine['id']}", {"date": str(d2), "time": s3["localTime"]}), 200, "member moves")["draw"]
    assert moved["localDate"] == str(d2) and moved["localTime"] == s3["localTime"]
    assert ok(m.api.post(f"/api/me/draws/{mine['id']}/cancel"), 200, "member cancels")["draw"]["state"] == "cancelled"
    err(m.api.post(f"/api/me/draws/{mine['id']}/cancel"), 409, "not_booked", "Only a booked draw can change.")


def test_wf_draw_visits_book_across_change(browser, app_url):
    m = new_member(app_url)
    dana = signin(app_url, DANA)
    luis = phlebotomists(dana)["Luis Carrillo"]["id"]
    change = next_change("denver", local_today("denver") + timedelta(days=2))
    d, s = free_slot(dana, m.id, {luis}, change + timedelta(days=1))
    t = s["localTime"]
    phx = hhmm(at_local("denver", d, t), "phoenix")
    with screen(browser, app_url, f"/staff/members/{m.id}", dana) as page:
        heading(page, MEMBER_NAME)
        opener = page.get_by_role("button", name="Book draw").first
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Book draw")
        see(page, dialog)
        select(dialog.get_by_role("combobox", name="Phlebotomist"), "Luis Carrillo")
        fill(dialog.get_by_role("textbox", name="Date"), d.isoformat())
        radio = dialog.get_by_role("radio", name=f"{t} Denver time")
        see(page, radio)
        pick(radio)
        axe(page)
        confirm = dialog.get_by_role("button", name="Book draw")
        confirm.focus()
        pending_shown(page, "**/api/draws", confirm, lambda: page.keyboard.press("Enter"))
        at_url(page, r"/staff/draws/[^/?#]+$")
        closed_focus(page, page.get_by_role("button", name="Book draw"), "after booking from the member record")
        say(page, f"Draw booked for {fmt_date(d)}, {phx} Phoenix time · {t} Denver time.")
        draw_id = urlparse(page.url).path.rsplit("/", 1)[-1]
        draw = ok(dana.get(f"/api/draws/{draw_id}"), 200, "booked draw")["draw"]
        assert draw["startsAt"] == iso(at_local("denver", d, t)) and draw["localTime"] == t and draw["memberId"] == m.id
        see(page, h1(page), f"Draw for {MEMBER_NAME} on {fmt_date(d)}")
        see(page, page.locator("body"), f"{fmt_date(d)}, {phx} Phoenix time · {t} Denver time")
        layout(page)
        axe(page)
        page.reload()
        see(page, h1(page), f"Draw for {MEMBER_NAME} on {fmt_date(d)}")
        see(page, page.locator("body"), f"{fmt_date(d)}, {phx} Phoenix time · {t} Denver time")
    sam = signin(app_url, SAM)
    d2, s2 = free_slot(sam, m.id, {luis}, workday(local_today("denver") + timedelta(days=33)))
    phx2 = hhmm(at_local("denver", d2, s2["localTime"]), "phoenix")
    screen_rules(browser, app_url, f"/staff/members/{m.id}", dana, opener=("button", "Book draw"), dialog="Book draw", typed=("textbox", "Date"),
                 change=lambda: ok(book(sam, m, luis, d2, s2["localTime"]), 201, "a draw booked elsewhere"),
                 appears=lambda page: f"{fmt_date(d2)}, {phx2} Phoenix time" in page_text(page))
    api_rules(app_url, "/api/draws", signin(app_url, JORDAN), reads=[(dana, f"/api/draws/{draw_id}"), (dana, "/api/session")])
    cookie_rules(app_url, DANA, STAFF_PASS)
    for width, control in ((WIDE_SWITCH, "Previous week"), (WIDE_SWITCH - 1, "Previous day"), (LAPTOP["width"], "Previous day")):
        with screen(browser, app_url, "/staff/calendar", dana, size={"width": width, "height": DESKTOP["height"]}) as page:
            see(page, page.get_by_role("button", name=control, exact=True))


def test_wf_draw_visits_slot_lost(browser, app_url):
    m = new_member(app_url)
    dana, sam = signin(app_url, DANA), signin(app_url, SAM)
    ivy = phlebotomists(dana)["Ivy Chen"]["id"]
    d, s = free_slot(dana, m.id, {ivy}, workday(local_today("denver") + timedelta(days=52)))
    with screen(browser, app_url, f"/staff/members/{m.id}", dana) as page:
        click(page.get_by_role("button", name="Book draw").first)
        dialog = page.get_by_role("dialog", name="Book draw")
        select(dialog.get_by_role("combobox", name="Phlebotomist"), "Ivy Chen")
        fill(dialog.get_by_role("textbox", name="Date"), d.isoformat())
        radio = dialog.get_by_role("radio", name=f"{s['localTime']} Denver time")
        see(page, radio)
        pick(radio)
        hold_clock(page)
        ok(book(sam, m, ivy, d, s["localTime"]), 201, "the other coordinator wins")
        after = [x for x in dana.get(f"/api/slots?memberId={m.id}&date={d}").json()["slots"] if x["phlebotomistId"] == ivy]
        nxt = next((x for x in after if x["free"] and parse_iso(x["startsAt"]) > parse_iso(s["startsAt"])), None)
        assert nxt, "a later free slot that day"
        click(dialog.get_by_role("button", name="Book draw"))
        say(page, f"That slot was just taken by Sam Whitfield. The next free slot is {fmt_date(d)}, {nxt['localTime']} Denver time.")
        expect(dialog).to_be_visible()
    mine = [x for x in dana.get(f"/api/draws?memberId={m.id}").json()["draws"] if x["state"] == "booked"]
    assert len(mine) == 1 and mine[0]["startsAt"] == s["startsAt"]


def test_wf_draw_visits_member_move_cancel(browser, app_url):
    m = new_member(app_url)
    luis = phlebotomists(m.owner)["Luis Carrillo"]["id"]
    d, s = free_slot(m.owner, m.id, {luis}, workday(local_today("denver") + timedelta(days=11)))
    draw = ok(book(m.owner, m, luis, d, s["localTime"]), 201, "staff booking")["draw"]
    nd, ns = free_slot(m.api, m.id, {luis}, workday(d + timedelta(days=1)), me=True)
    with screen(browser, app_url, f"/me/draws/{draw['id']}", m.api, size=MOBILE) as page:
        heading(page, f"Draw on {fmt_date(d)}")
        move = page.get_by_role("button", name="Move draw")
        assert fixed_bottom(move)
        tap(move.first)
        dialog = page.get_by_role("dialog", name="Move draw")
        fill(dialog.get_by_role("textbox", name="Date"), nd.isoformat())
        radio = dialog.get_by_role("radio", name=f"{ns['localTime']} Denver time")
        see(page, radio)
        pick(radio, touch=True)
        axe(page)
        tap(dialog.get_by_role("button", name="Move draw"))
        say(page, f"Draw moved to {fmt_date(nd)}, {ns['localTime']} Denver time.")
        closed_focus(page, page.get_by_role("button", name="Move draw"), "after moving the draw")
        moved = m.api.get("/api/me/draws").json()["draws"]
        assert any(x["id"] == draw["id"] and x["localDate"] == str(nd) and x["localTime"] == ns["localTime"] for x in moved)
        tap(page.get_by_role("button", name="Cancel draw"))
        tap(page.get_by_role("dialog", name="Cancel draw").get_by_role("button", name="Yes, cancel this draw"))
        say(page, "Draw cancelled.")
        closed_focus(page, page.get_by_role("button", name="Cancel draw"), "after cancelling the draw")
        layout(page)
    assert ok(m.owner.get(f"/api/draws/{draw['id']}"), 200, "draw")["draw"]["state"] == "cancelled"


def test_visit_page_lifetime(app_url, mail):
    m = new_member(app_url)
    ivy = phlebotomists(m.owner)["Ivy Chen"]["id"]
    to = PHLEB_EMAIL["Ivy Chen"]
    seen = set(mail_tokens(mail, to))
    d, s = free_slot(m.owner, m.id, {ivy}, workday(local_today("denver") + timedelta(days=15)))
    draw = ok(book(m.owner, m, ivy, d, s["localTime"]), 201, "book")["draw"]
    assert draw["visitPage"]["state"] == "live"
    t1, msg = token_for(app_url, mail, to, seen, draw)
    assert msg.get("Subject") == f"Visit page for {fmt_date(d)}"
    body = text(msg)
    for private in (ADDRESS["line1"], GATE, PHONE, m.email):
        assert private not in body, f"visit page mail carries no {private!r} (L775)"
    v = httpx.get(f"{app_url}/api/visits/{t1}", timeout=HTTP_TIMEOUT).json()
    nxt = d + timedelta(days=1)
    assert v["endsAt"] == iso(datetime(nxt.year, nxt.month, nxt.day, tzinfo=ZONES["denver"])), "ends at the next local midnight (L621)"
    seen.add(t1)
    assert ok(m.owner.post(f"/api/draws/{draw['id']}/visit-page"), 201, "new visit page")["visitPage"]["state"] == "live"
    t2, _ = token_for(app_url, mail, to, seen, draw)
    seen.add(t2)
    err(httpx.get(f"{app_url}/api/visits/{t1}", timeout=HTTP_TIMEOUT), 410, "visit_page_ended", VISIT_ENDED_COPY)
    assert ok(m.owner.delete(f"/api/draws/{draw['id']}/visit-page"), 200, "end")["visitPage"]["state"] == "ended"
    err(httpx.get(f"{app_url}/api/visits/{t2}", timeout=HTTP_TIMEOUT), 410, "visit_page_ended", VISIT_ENDED_COPY)
    ok(m.owner.post(f"/api/draws/{draw['id']}/visit-page"), 201, "another visit page")
    t3, _ = token_for(app_url, mail, to, seen, draw)
    seen.add(t3)
    nd, ns = free_slot(m.owner, m.id, {ivy}, workday(d + timedelta(days=1)))
    moved = ok(m.owner.patch(f"/api/draws/{draw['id']}", {"date": str(nd), "time": ns["localTime"]}), 200, "move")["draw"]
    t4, _ = token_for(app_url, mail, to, seen, moved)
    err(httpx.get(f"{app_url}/api/visits/{t3}", timeout=HTTP_TIMEOUT), 410, "visit_page_ended", VISIT_ENDED_COPY)
    ok(m.owner.post(f"/api/draws/{draw['id']}/cancel"), 200, "cancel")
    err(httpx.get(f"{app_url}/api/visits/{t4}", timeout=HTTP_TIMEOUT), 410, "visit_page_ended", VISIT_ENDED_COPY)
    err(m.owner.post(f"/api/draws/{draw['id']}/visit-page"), 409, "not_booked")
    err(httpx.get(f"{app_url}/api/visits/no-such-token", timeout=HTTP_TIMEOUT), 404, "not_found")


@pytest.mark.timeout(900)
def test_visit_page_ends_at_instant(mail):
    short = env_url("APP_SHORT_URL")
    m = new_member(short)
    ps = phlebotomists(m.owner)
    by_id = {ps[n]["id"]: n for n in ("Luis Carrillo", "Ivy Chen")}
    today = local_today("denver")
    slots = ok(m.owner.get(f"/api/slots?memberId={m.id}&date={today}"), 200, "today's staff slots")["slots"]
    s = next((x for x in slots if x["phlebotomistId"] in by_id and x["free"]), None)
    assert s, "staff slot reads for today list a free slot (L601)"
    to = PHLEB_EMAIL[by_id[s["phlebotomistId"]]]
    seen = set(mail_tokens(mail, to))
    sent = datetime.now(timezone.utc)
    draw = ok(book(m.owner, m, s["phlebotomistId"], today, s["localTime"]), 201, "staff same-day booking")["draw"]
    assert draw["visitPage"]["state"] == "live", draw
    ends = parse_iso(draw["visitPage"]["endsAt"])
    midnight = datetime(today.year, today.month, today.day, tzinfo=ZONES["denver"]) + timedelta(days=1)
    earliest = min(sent + timedelta(seconds=DRAW_PAGE_SECONDS - CLOCK_SLACK_S), midnight)
    latest = min(sent + timedelta(seconds=DRAW_PAGE_SECONDS + MAIL_WAIT_S), midnight)
    assert earliest <= ends <= latest + timedelta(seconds=CLOCK_SLACK_S), (draw["visitPage"], iso(sent))

    def mine():
        found = {t for t in set(mail_tokens(mail, to)) - seen
                 if httpx.get(f"{short}/api/visits/{t}", timeout=HTTP_TIMEOUT).status_code != 404}
        return found or None
    tokens = poll(mine, MAIL_WAIT_S, f"a visit page mail to {to} with a /visit/<token> address (L619, L775)")

    def ended():
        before = datetime.now(timezone.utc)
        answers = [httpx.get(f"{short}/api/visits/{t}", timeout=HTTP_TIMEOUT) for t in tokens]
        if any(r.status_code == 200 for r in answers):
            assert before < ends + timedelta(seconds=1), "a visit address still answers 200 after its end instant (L622)"
            return None
        for r in answers:
            err(r, 410, "visit_page_ended", VISIT_ENDED_COPY)
        assert datetime.now(timezone.utc) >= ends - timedelta(seconds=1), "the visit address ended before its end instant"
        return True
    poll(ended, DRAW_PAGE_SECONDS * 3 + MAIL_WAIT_S, "the visit page answers 410 once its end instant passes (L621)")
    assert ok(m.owner.get(f"/api/draws/{draw['id']}"), 200, "draw")["draw"]["visitPage"]["state"] == "ended"


def test_visit_page_fields(app_url, mail):
    m = new_member(app_url)
    draw, token, _, msg = book_today(m, mail)
    r = ok(httpx.get(f"{app_url}/api/visits/{token}", timeout=HTTP_TIMEOUT), 200, "today's visit page")
    assert set(r) == VISIT_KEYS, set(r) ^ VISIT_KEYS
    assert r["memberName"] == SHORT_NAME and r["isDrawDay"] is True and r["state"] == "booked"
    assert r["address"] == {"line1": ADDRESS["line1"], "line2": "", "city": "Denver", "state": "co", "postalCode": "80203"}
    assert r["gateNotes"] == GATE and r["localTime"] == draw["localTime"] and r["timeZone"] == "denver"
    raw = json.dumps(r)
    for private in (m.email, PHONE, "1987-03-02", m.id, MEMBER_NAME):
        assert private not in raw, f"visit page leaks {private!r} (L624)"
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    err(c.post(f"/api/visits/{token}/collect", json={}), 409, "kit_code_required")
    kit = new_kit()
    added = ok(c.post(f"/api/visits/{token}/kit-codes", json={"kitCode": kit}), 201, "kit code")
    assert set(added) == {"kitCodes"} and kit in added["kitCodes"]
    pressed = datetime.now(timezone.utc)
    done = ok(c.post(f"/api/visits/{token}/collect", json={}), 200, "collect")
    assert set(done) == {"state", "collectedAt"} and done["state"] == "collected"
    assert abs((parse_iso(done["collectedAt"]) - pressed).total_seconds()) < HTTP_TIMEOUT
    err(c.post(f"/api/visits/{token}/collect", json={}), 409, "already_collected", "This draw is already collected.")
    err(c.post(f"/api/visits/{token}/kit-codes", json={"kitCode": new_kit()}), 409, "already_collected")
    assert ok(m.owner.get(f"/api/draws/{draw['id']}"), 200, "draw")["draw"]["state"] == "collected"
    ivy = phlebotomists(m.owner)["Ivy Chen"]["id"]
    before = set(mail_tokens(mail, PHLEB_EMAIL["Ivy Chen"]))
    d, s = free_slot(m.owner, m.id, {ivy}, workday(local_today("denver") + timedelta(days=17)))
    later = ok(book(m.owner, m, ivy, d, s["localTime"]), 201, "future draw")["draw"]
    t2, _ = token_for(app_url, mail, PHLEB_EMAIL["Ivy Chen"], before, later)
    f = c.get(f"/api/visits/{t2}").json()
    assert set(f) == VISIT_KEYS and f["isDrawDay"] is False and f["address"] is None and f["gateNotes"] is None
    ok(c.post(f"/api/visits/{t2}/kit-codes", json={"kitCode": new_kit()}), 201, "kit code")
    err(c.post(f"/api/visits/{t2}/collect", json={}), 409, "not_draw_day")


def test_kit_codes(app_url, mail):
    m = new_member(app_url)
    draw, token, _, _ = book_today(m, mail)
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    digits = f"{uuid.uuid4().int % 10 ** 7:07d}"
    good = f"KT-{digits}-{check_char(digits)}"
    wrong = f"KT-{digits}-{'0' if check_char(digits) != '0' else '1'}"
    cases = [("kt1000046x", "KT-1000046-X"), ("KT 1000042 7", "KT-1000042-7"), (good.lower().replace("-", ""), good)]
    for given, shown in cases:
        r = ok(c.post(f"/api/visits/{token}/kit-codes", json={"kitCode": given}), 201, f"kit code {given}")
        assert shown in r["kitCodes"], r
    again = ok(c.post(f"/api/visits/{token}/kit-codes", json={"kitCode": "KT-1000046-X"}), 200, "duplicate kit code")
    assert sorted(again["kitCodes"]) == sorted(s for _, s in cases)
    for bad in ("KT-1000046-1", wrong):
        field_err(c.post(f"/api/visits/{token}/kit-codes", json={"kitCode": bad}), "kitCode", WRONG_CHECK_COPY)
    field_err(c.post(f"/api/visits/{token}/kit-codes", json={"kitCode": "KT-12345"}), "kitCode", WRONG_SHAPE_COPY)
    stored = ok(m.owner.get(f"/api/draws/{draw['id']}"), 200, "draw")["draw"]["kitCodes"]
    assert sorted(stored) == sorted(s for _, s in cases)
    luis = phlebotomists(m.owner)["Luis Carrillo"]["id"]
    pd, ps = free_slot(m.owner, m.id, {luis}, workday(local_today("denver") - timedelta(days=33), -1), step=-1)
    r = book(m.owner, m, luis, pd, ps["localTime"], collectedAt=iso(at_local("denver", pd, "23:30")), kitCodes=["KT-1000046-1"])
    e = err(r, 422, "invalid")
    assert any(k.startswith("kitCodes") and v == WRONG_CHECK_COPY for k, v in e["fields"].items()), e


def test_wf_visit_page_touch(browser, app_url, mail):
    m = new_member(app_url)
    draw, token, _, _ = book_today(m, mail)
    with screen(browser, app_url, f"/visit/{token}", size=MOBILE) as page:
        heading(page, f"Visit for {SHORT_NAME}")
        see(page, page.locator("body"), f"{draw['localTime']} Denver time")
        region = page.get_by_role("region", name="Address")
        see(page, region, ADDRESS["line1"])
        see(page, region, GATE)
        box = page.get_by_role("textbox", name="Kit code")
        add = page.get_by_role("button", name="Add kit code")
        mark = page.get_by_role("button", name="Mark collected")
        for control in (box, add, mark):
            big_enough(control)
        assert fixed_bottom(mark), "Mark collected sits in the fixed bottom bar (L159)"
        layout(page)
        axe(page)
        tap(mark.first)
        say(page, "Enter at least one kit code before marking collected.")
        fill(box, "KT-1000046-1")
        tap(add)
        say(page, WRONG_CHECK_COPY)
        problems_rule(page, WRONG_CHECK_COPY, box)
        good = new_kit()
        fill(box, good.lower().replace("-", ""))
        pending_shown(page, "**/kit-codes", add, lambda: tap(add))
        say(page, f"Kit code {good} added.")
        see(page, page.get_by_role("list", name="Kit codes"), good)
        second = new_kit()
        fill(box, second)
        box.press("Enter")
        see(page, page.get_by_role("list", name="Kit codes"), second)
        pending_shown(page, "**/collect", mark.first, lambda: tap(mark.first))
        done = poll(lambda: (lambda d: d if d["state"] == "collected" else None)(m.owner.get(f"/api/draws/{draw['id']}").json()["draw"]),
                    UI_WAIT_S, "Mark collected records the collection (L625)")
        assert set(done["kitCodes"]) == {good, second}
        say(page, f"Marked collected at {hhmm(parse_iso(done['collectedAt']), 'denver')} Denver time.")
    other = new_member(app_url)
    live_draw, live, _, _ = book_today(other, mail)
    kit = new_kit()
    page_api = f"{app_url}/api/visits/{live}"
    screen_rules(browser, app_url, f"/visit/{live}", ring=("textbox", "Kit code"), typed=("textbox", "Kit code"),
                 change=lambda: ok(httpx.post(page_api + "/kit-codes", json={"kitCode": kit}, timeout=HTTP_TIMEOUT), 201, "a kit code added elsewhere"),
                 appears=lambda page: kit in page_text(page))
    err(httpx.post(page_api + "/kit-codes", content=oversized(), headers=JSON_HEADERS, timeout=HTTP_TIMEOUT), 413, "too_large", TOO_LARGE_COPY)
    err(httpx.post(f"{app_url}/api/visits/no-such-token/kit-codes", content=b"{", headers=JSON_HEADERS, timeout=HTTP_TIMEOUT), 404, "not_found")
    shown = ok(httpx.get(page_api, timeout=HTTP_TIMEOUT), 200, "visit page")
    assert walk_keys(shown) == [], walk_keys(shown)
    typed_kit = new_kit()
    with screen(browser, app_url, f"/visit/{live}", size=MOBILE) as page:
        field = page.get_by_role("textbox", name="Kit code")
        tab_to(page, field)
        page.keyboard.type(typed_kit)
        page.keyboard.press("Enter")
        see(page, page.get_by_role("list", name="Kit codes"), typed_kit)
        tab_to(page, page.get_by_role("button", name="Mark collected").first)
        page.keyboard.press("Enter")
        poll(lambda: other.owner.get(f"/api/draws/{live_draw['id']}").json()["draw"]["state"] == "collected" or None,
             UI_WAIT_S, "Mark collected by keyboard records the collection (L625)")


def test_wf_visit_page_ended(browser, app_url, mail):
    m = new_member(app_url)
    draw, token, _, _ = book_today(m, mail)
    dana = signin(app_url, DANA)
    with screen(browser, app_url, f"/staff/draws/{draw['id']}", dana) as page:
        click(page.get_by_role("button", name="End visit page"))
        say(page, "Visit page ended.")
    err(httpx.get(f"{app_url}/api/visits/{token}", timeout=HTTP_TIMEOUT), 410, "visit_page_ended", VISIT_ENDED_COPY)
    with screen(browser, app_url, f"/visit/{token}", size=MOBILE) as page:
        see(page, h1(page), VISIT_ENDED_COPY)
        expect(page.get_by_role("button", name="Mark collected")).to_have_count(0)
        axe(page)
        page.goto(f"{app_url}/visit/no-such-token")
        see(page, h1(page), NOT_FOUND_COPY)


def test_results_preview_and_conversion(app_url):
    m = new_member(app_url)
    draw, kit, _ = past_draw(m, local_today("denver") - timedelta(days=25))
    coord = signin(app_url, DANA)
    f = results_csv(kit, new_kit())
    path = f"/api/draws/{draw['id']}"
    rows = {r["row"]: r for r in ok(coord.upload(path + "/results-file/preview", {"file": ("r.csv", f, "text/csv")}), 200, "preview")["rows"]}
    assert sorted(rows) == list(range(2, 11)), sorted(rows)
    want = {2: ("vitaminD", "22.5", "ng/mL"), 5: ("glucose", "99", "mg/dL"), 8: ("insulin", "10.0", "µIU/mL"), 9: ("tsh", "1.26", "mIU/L")}
    for n, (mk, val, unit) in want.items():
        r = rows[n]
        assert r["status"] == "matched" and r["kitCode"] == kit and r["marker"] == mk and r["value"] == val and r["unit"] == unit, r
    assert rows[2]["source"] == {"marker": "Vit D, 25-OH", "value": "56.125", "unit": "nmol/L"}
    assert rows[3]["status"] == "unknown" and rows[3]["reason"] == f'No marker matches "{ZONULIN}".', rows[3]
    refused = {4: "Value isn't a number.", 6: "Kit code isn't on this draw.", 7: "Unit isn't accepted for Ferritin.",
               10: "Row needs kitCode, marker, value and unit."}
    for n, reason in refused.items():
        assert rows[n]["status"] == "refused" and rows[n]["reason"] == reason, rows[n]
    assert draw_entry(results_of(coord, m.id), "vitaminD", draw["id"]) is None, "preview writes nothing"
    pdf = pdf_bytes()

    def files():
        return {"file": ("r.csv", f, "text/csv"), "report": ("report.pdf", pdf, "application/pdf")}
    saved = ok(coord.upload(path + "/results-file", files()), 201, "save")
    assert saved["saved"] == 4 and saved["draw"]["state"] == "ready"
    res = results_of(coord, m.id)
    for mk, val, _ in want.values():
        assert draw_entry(res, mk, draw["id"])["value"] == val
    again = ok(coord.upload(path + "/results-file", files()), 200, "save again")
    assert again["saved"] == 0
    assert results_of(coord, m.id) == res, "saving the same file twice changes nothing"
    clash = f"kitCode,marker,value,unit\n{kit},Vitamin D,60,nmol/L\n".encode()
    row = ok(coord.upload(path + "/results-file/preview", {"file": ("r.csv", clash, "text/csv")}), 200, "preview")["rows"][0]
    assert row["status"] == "refused" and row["reason"] == "Already saved with a different value; correct it on the result instead."
    field_err(coord.upload(path + "/results-file/preview", {"file": ("r.csv", b"kit,marker\n", "text/csv")}), "file",
              "The first row must be kitCode,marker,value,unit.")
    field_err(coord.upload(path + "/results-file/preview", {"file": ("r.csv", b"kitCode,marker,value,unit\n\xff\xfe\xfa,x,1,y\n", "text/csv")}),
              "file", "The results file must be UTF-8 text.")
    ivy = phlebotomists(coord)["Ivy Chen"]["id"]
    d, s = free_slot(coord, m.id, {ivy}, workday(local_today("denver") + timedelta(days=21)))
    booked = ok(book(coord, m, ivy, d, s["localTime"]), 201, "booked draw")["draw"]
    err(coord.upload(f"/api/draws/{booked['id']}/results-file/preview", {"file": ("r.csv", f, "text/csv")}), 409, "not_collected",
        "Results can be brought in for a collected draw.")


def test_report_file_checks(app_url):
    m = new_member(app_url)
    draw, _, _ = past_draw(m, local_today("denver") - timedelta(days=27))
    path = f"/api/draws/{draw['id']}/report"
    field_err(m.owner.upload(path, {"report": ("report.pdf", b"hello, not a pdf", "application/pdf")}), "report",
              "The report must be a PDF file.")
    big = pdf_bytes(REPORT_OK)
    ok(m.owner.upload(path, {"report": ("notes.txt", big, "text/plain")}), 201, "a 9,990,000-byte PDF named .txt is accepted")
    assert m.owner.get(path).content == big
    over = b"%PDF-" + b"0" * (REPORT_LIMIT + 1 - 5)
    for client in (m.owner, Api(app_url)):
        err(client.upload(path, {"report": ("report.pdf", over, "application/pdf")}), 413, "too_large",
            "The report must be at most 10,000,000 bytes.")
    pad = b"0" * (SAVE_BODY_LIMIT - REPORT_OK + 1)
    err(Api(app_url).upload(path, {"report": ("r.pdf", big, "application/pdf"), "pad": ("pad.bin", pad, "application/octet-stream")}),
        413, "too_large", TOO_LARGE_COPY)
    err(Api(app_url).upload(f"/api/draws/{draw['id']}/results-file/preview", {"file": ("r.csv", b"0" * (RESULTS_FILE_LIMIT + 1), "text/csv")}),
        413, "too_large", "The results file must be at most 1,000,000 bytes.")


def test_report_byte_for_byte(app_url):
    m = new_member(app_url)
    draw, _, _ = past_draw(m, local_today("denver") - timedelta(days=29))
    d = ok(m.owner.post(f"/api/draws/{draw['id']}/results", {"results": [{"marker": "vitaminD", "value": "22.5"}]}), 201, "results")["draw"]
    assert d["state"] == "collected", "results alone never make the draw Ready (L655)"
    key = f"members/{m.id}/draws/{draw['id']}/report.pdf"
    assert S3().keys(key) == []
    pdf = pdf_bytes()
    r = ok(m.owner.upload(f"/api/draws/{draw['id']}/report", {"report": ("report.pdf", pdf, "application/pdf")}), 201, "report")
    assert r["draw"]["state"] == "ready"
    assert S3().keys(key) == [key] and S3().get(key) == pdf
    dl = m.owner.get(f"/api/draws/{draw['id']}/report")
    assert dl.status_code == 200 and dl.headers["content-type"].startswith("application/pdf") and dl.content == pdf
    err(m.owner.upload(f"/api/draws/{draw['id']}/report", {"report": ("other.pdf", pdf_bytes(), "application/pdf")}), 409,
        "report_exists", "This draw already has a different report.")
    assert S3().get(key) == pdf


def test_report_store_outage():
    down = env_url("APP_MINIO_DOWN_URL")
    m = new_member(down)
    draw, kit, _ = past_draw(m, local_today("denver") - timedelta(days=24))
    f = f"kitCode,marker,value,unit\n{kit},Vitamin D,22.5,ng/mL\n".encode()
    err(m.owner.upload(f"/api/draws/{draw['id']}/results-file", {"file": ("r.csv", f, "text/csv"),
                                                                 "report": ("report.pdf", pdf_bytes(), "application/pdf")}),
        503, "report_store_unavailable", REPORT_STORE_COPY)
    err(m.owner.upload(f"/api/draws/{draw['id']}/report", {"report": ("report.pdf", pdf_bytes(), "application/pdf")}),
        503, "report_store_unavailable", REPORT_STORE_COPY)
    assert m.owner.get(f"/api/draws/{draw['id']}").json()["draw"]["state"] == "collected"
    assert draw_entry(results_of(m.owner, m.id), "vitaminD", draw["id"]) is None
    try:
        keys = S3("-storage").keys(f"members/{m.id}/")
    except Exception:
        keys = []
    assert keys == []


def test_releasing_results(app_url, mail):
    m = new_member(app_url)
    draw, _, _ = past_draw(m, local_today("denver") - timedelta(days=31))
    ok(m.owner.post(f"/api/draws/{draw['id']}/results", {"results": [{"marker": "vitaminD", "value": "22.5"}, {"marker": "ldl", "value": "118"}]}),
       201, "results")
    spec = signin(app_url, PRIYA)
    err(spec.post(f"/api/draws/{draw['id']}/release"), 409, "not_ready", "Results can be released once the report is stored.")
    store_report(m.owner, draw["id"])
    err(signin(app_url, DANA).post(f"/api/draws/{draw['id']}/release"), 403, "forbidden")
    assert draw_entry(results_of(m.api, m.id, "/api/me/results"), "vitaminD", draw["id"]) is None
    assert ok(spec.post(f"/api/draws/{draw['id']}/release"), 200, "release")["draw"]["state"] == "released"
    assert draw_entry(results_of(m.api, m.id, "/api/me/results"), "vitaminD", draw["id"])["value"] == "22.5"

    def notices():
        found = [x for x in mail.messages() if m.email in addresses(x.get("To")) and x.get("Subject") == "Your new results are ready"]
        return found or None
    found = poll(notices, MAIL_WAIT_S, "one results notice to the member (L776)")
    assert len(notices()) == 1, "release queues exactly one notice"
    body = text(found[0])
    assert "/me/results" in body
    for secret in ("Vitamin D", "LDL", "22.5", "118", *FLAG_LABEL.values()):
        assert secret not in body, f"results notice carries {secret!r} (L776)"


def test_wf_lab_results_intake(browser, app_url):
    m = new_member(app_url)
    draw, kit, _ = past_draw(m, local_today("denver") - timedelta(days=26))
    f = f"kitCode,marker,value,unit\n{kit},Vit D, 25-OH,56.125,nmol/L\n{kit},Glucose,90,mg/dL\n{kit},Zonulin,5,mg/dL\n{kit},LDL-C,abc,mg/dL\n".encode()
    pdf = pdf_bytes()
    dana = signin(app_url, DANA)
    with screen(browser, app_url, f"/staff/draws/{draw['id']}", dana) as page:
        opener = page.get_by_role("button", name="Bring in results")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Bring in results")
        see(page, dialog)
        dialog.get_by_label("Results file").set_input_files(files=[{"name": "r.csv", "mimeType": "text/csv", "buffer": f}])
        dialog.get_by_label("Report PDF").set_input_files(files=[{"name": "report.pdf", "mimeType": "application/pdf", "buffer": pdf}])
        dialog.get_by_role("button", name="Preview").focus()
        page.keyboard.press("Enter")
        matched, unknown, refused = 2, 1, 1
        say(page, f"{matched} matched, {unknown} unknown, {refused} refused. Nothing is saved yet.")
        see(page, dialog.get_by_role("table", name="Preview"), "Zonulin")
        axe(page)
        assert m.owner.get(f"/api/draws/{draw['id']}").json()["draw"]["state"] == "collected"
        saving = dialog.get_by_role("button", name="Save results")
        saving.focus()
        pending_shown(page, "**/results-file", saving, lambda: page.keyboard.press("Enter"))
        say(page, "Results saved and the report is stored.")
        closed_focus(page, page.get_by_role("button", name="Bring in results"), "after Save results")
        at_url(page, re.escape(f"/staff/draws/{draw['id']}") + r"$")
        assert m.owner.get(f"/api/draws/{draw['id']}").json()["draw"]["state"] == "ready"
        assert S3().get(f"members/{m.id}/draws/{draw['id']}/report.pdf") == pdf
        see(page, page.locator("body"), "Ready")
    other, kit2, _ = past_draw(m, local_today("denver") - timedelta(days=23))
    rows = f"kitCode,marker,value,unit\n{kit2},Vitamin D,22.5,ng/mL\n".encode()

    def choose_files(box) -> None:
        box.get_by_label("Results file").set_input_files(files=[{"name": "r.csv", "mimeType": "text/csv", "buffer": rows}])
    screen_rules(browser, app_url, f"/staff/draws/{other['id']}", dana, opener=("button", "Bring in results"), dialog="Bring in results",
                 filled=choose_files, keeps=lambda box: box.get_by_label("Results file").evaluate("e => e.files.length") == 1)
    api_rules(app_url, f"/api/draws/{other['id']}/results", signin(app_url, JORDAN), reads=[(dana, f"/api/draws/{other['id']}"), (dana, "/api/session")])
    cookie_rules(app_url, DANA, STAFF_PASS)


def test_wf_lab_results_store_outage(browser):
    down = env_url("APP_MINIO_DOWN_URL")
    m = new_member(down)
    draw, kit, _ = past_draw(m, local_today("denver") - timedelta(days=28))
    f = f"kitCode,marker,value,unit\n{kit},Vitamin D,22.5,ng/mL\n".encode()
    with screen(browser, down, f"/staff/draws/{draw['id']}", signin(down, DANA), size=MOBILE) as page:
        tap(page.get_by_role("button", name="Bring in results").first)
        dialog = page.get_by_role("dialog", name="Bring in results")
        dialog.get_by_label("Results file").set_input_files(files=[{"name": "r.csv", "mimeType": "text/csv", "buffer": f}])
        dialog.get_by_label("Report PDF").set_input_files(files=[{"name": "r.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()}])
        tap(dialog.get_by_role("button", name="Preview"))
        frame = dialog.get_by_role("region", name="Preview rows")
        see(page, frame)
        frame.focus()
        assert frame.evaluate(IS_FOCUS_JS), "the preview frame takes keyboard focus (SR5)"
        layout(page)
        axe(page)
        tap(dialog.get_by_role("button", name="Save results"))
        see(page, dialog, REPORT_STORE_COPY)
        focus_on(page, REPORT_STORE_COPY)
    assert m.owner.get(f"/api/draws/{draw['id']}").json()["draw"]["state"] == "collected"


def test_flags_from_range_table(app_url):
    collected = workday(local_today("denver") - timedelta(days=20), -1)
    born = None
    for _ in range(7):
        bday = collected + timedelta(days=1)
        try:
            born = bday.replace(year=bday.year - AGE_BAND_EDGE)
            break
        except ValueError:
            collected = workday(collected - timedelta(days=1), -1)
    assert born, "a birthday the day after the collected date"
    m = new_member(app_url, born=born.isoformat())
    luis = phlebotomists(m.owner)["Luis Carrillo"]["id"]
    slots = m.owner.get(f"/api/slots?memberId={m.id}&date={collected}").json()["slots"]
    s = next((x for x in slots if x["phlebotomistId"] == luis and x["free"]), None)
    assert s, f"a free slot on {collected}"
    at = at_local("denver", collected, "23:30")
    assert at.astimezone(timezone.utc).date() == bday, "the collected instant falls on the birthday in UTC"
    draw = ok(book(m.owner, m, luis, collected, s["localTime"], collectedAt=iso(at), kitCodes=[new_kit()]), 201, "past draw")["draw"]
    values = {"estradiol": ("20", "belowRange"), "vitaminD": ("22.5", "belowRange"), "hdl": ("100", "inRange"),
              "triglycerides": ("30", "optimal"), "apoB": ("100", "aboveRange"), "hba1c": ("3.9", "belowRange"),
              "glucose": ("99", "inRange"), "ferritin": ("40", "optimal")}
    ok(m.owner.post(f"/api/draws/{draw['id']}/results", {"results": [{"marker": k, "value": v} for k, (v, _) in values.items()]}),
       201, "results")
    res = results_of(m.owner, m.id)
    for marker, (value, flag) in values.items():
        e = draw_entry(res, marker, draw["id"])
        assert e and e["value"] == value and e["flag"] == flag, (marker, e)
        assert e["ageBand"] == "age18To39", f"age in whole years on the member-local collected date (L660): {e}"
    est = draw_entry(res, "estradiol", draw["id"])["range"]
    assert (est["low"], est["high"], est["optimalLow"], est["optimalHigh"]) == ("30", "400", "50", "250")
    hdl = draw_entry(res, "hdl", draw["id"])["range"]
    assert (hdl["low"], hdl["high"]) == ("50", "100"), "female HDL rows (L903)"


def test_range_changes_effective(mail):
    spare = env_url("APP_SPARE_URL")
    owner = signin(spare, OWNER)
    today = datetime.now(PHX).date()
    candidates = {
        "glucose": ("Fasting glucose", ("60", "110", "70", "95"), "105", ("70", "99", "75", "90")),
        "triglycerides": ("Triglycerides", ("20", "200", "20", "120"), "170", ("30", "149", "30", "99")),
        "apoB": ("ApoB", ("30", "130", "30", "100"), "115", ("40", "99", "40", "79")),
    }
    used = {(c["marker"], c["effectiveFrom"]) for c in ok(owner.get("/api/range-changes"), 200, "range changes")["changes"]}
    marker = next((k for k in candidates if (k, str(today)) not in used), None)
    if marker is None:
        pytest.fail("every candidate marker already changes today on the spare copy; expected a fresh copy per run")
    name, new, value, old = candidates[marker]
    rows = [{"sex": sex, "ageBand": band_id, "low": new[0], "high": new[1], "optimalLow": new[2], "optimalHigh": new[3]}
            for sex in ("female", "male") for band_id in ("age18To39", "age40To59", "age60Plus")]
    field_err(owner.post("/api/range-changes", {"marker": marker, "effectiveFrom": str(today - timedelta(days=1)), "ranges": rows}),
              "effectiveFrom", "Choose today or a later date.")
    field_err(owner.post("/api/range-changes", {"marker": marker, "effectiveFrom": str(today), "ranges": rows[:5]}),
              "ranges", "Give all six rows.")
    bad = [dict(rows[0], low=new[1], high=new[0])] + rows[1:]
    field_err(owner.post("/api/range-changes", {"marker": marker, "effectiveFrom": str(today), "ranges": bad}),
              "ranges.0", "Bounds must run low ≤ optimal low ≤ optimal high ≤ high.")
    err(signin(spare, PRIYA).post("/api/range-changes", {"marker": marker, "effectiveFrom": str(today), "ranges": rows}), 403, "forbidden")
    m = new_member(spare)
    old_draw, old_day = released_draw(m, today - timedelta(days=2), [(marker, value)], collected="10:00")
    change = ok(owner.post("/api/range-changes", {"marker": marker, "effectiveFrom": str(today), "ranges": rows}), 201, "range change")["change"]
    assert change["marker"] == marker and change["effectiveFrom"] == str(today)
    err(owner.post("/api/range-changes", {"marker": marker, "effectiveFrom": str(today), "ranges": rows}), 409,
        "ranges_already_change", f"Ranges for {name} already change on {fmt_date(today)}.")
    now_rows = ok(owner.get(f"/api/ranges?marker={marker}&on={today}"), 200, "ranges today")
    assert now_rows["effectiveFrom"] == str(today) and len(now_rows["ranges"]) == 6
    assert ok(owner.get(f"/api/ranges?marker={marker}&on={today - timedelta(days=1)}"), 200, "ranges")["effectiveFrom"] != str(today)
    draw, token, _, _ = book_today(m, mail)
    c = httpx.Client(base_url=spare, timeout=HTTP_TIMEOUT)
    ok(c.post(f"/api/visits/{token}/kit-codes", json={"kitCode": new_kit()}), 201, "kit code")
    collected = ok(c.post(f"/api/visits/{token}/collect", json={}), 200, "collect")
    ok(m.owner.post(f"/api/draws/{draw['id']}/results", {"results": [{"marker": marker, "value": value}]}), 201, "results")
    store_report(m.owner, draw["id"])
    ok(m.owner.post(f"/api/draws/{draw['id']}/release"), 200, "release")
    for res in (results_of(m.owner, m.id), results_of(m.api, m.id, "/api/me/results")):
        before, after = draw_entry(res, marker, old_draw["id"]), draw_entry(res, marker, draw["id"])
        assert before["flag"] == "aboveRange" and before["range"]["effectiveFrom"] != str(today), before
        assert (before["range"]["low"], before["range"]["high"]) == old[:2]
        assert after["flag"] == "inRange" and after["range"]["effectiveFrom"] == str(today), after
        assert (after["range"]["low"], after["range"]["high"], after["range"]["optimalLow"], after["range"]["optimalHigh"]) == new
    history = m.api.get("/api/me/results-history")
    assert history.status_code == 200, history.text[:600]
    lines = history.content.decode().split("\r\n")
    old_line = ",".join(csv_cell(v) for v in (str(old_day), name, value)) + ","
    new_day = local_date(collected["collectedAt"], "denver")
    assert any(ln.startswith(old_line) and csv_cell(f"{old[0]}–{old[1]} (optimal {old[2]}–{old[3]})") in ln for ln in lines), lines
    assert any(ln.startswith(",".join(csv_cell(v) for v in (str(new_day), name, value)))
               and csv_cell(f"{new[0]}–{new[1]} (optimal {new[2]}–{new[3]})") in ln for ln in lines), lines


def test_corrected_values(app_url):
    m = new_member(app_url)
    draw, _ = released_draw(m, local_today("denver") - timedelta(days=15), [("vitaminD", "22.5")])
    entry = draw_entry(results_of(m.api, m.id, "/api/me/results"), "vitaminD", draw["id"])
    rid = entry["resultId"]
    priya = signin(app_url, PRIYA)
    err(signin(app_url, DANA).patch(f"/api/results/{rid}", {"value": CORRECTED_VD}), 403, "forbidden")
    field_err(priya.patch(f"/api/results/{rid}", {"value": "abc"}), "value")
    fixed = ok(priya.patch(f"/api/results/{rid}", {"value": CORRECTED_VD, "note": "Re-read from the lab report."}), 200, "correction")["result"]
    assert fixed["value"] == CORRECTED_VD
    after = draw_entry(results_of(m.api, m.id, "/api/me/results"), "vitaminD", draw["id"])
    assert after["value"] == CORRECTED_VD and after["flag"] == "optimal" and after["range"] == entry["range"]
    assert after["correctedBy"] == "Priya Shah" and after["note"] == "Re-read from the lab report."
    parse_iso(after["correctedAt"])
    history = ok(priya.get(f"/api/results/{rid}/history"), 200, "history")["history"]
    earlier = next((h for h in history if h["value"] == "22.5"), None)
    assert earlier, f"the earlier value stays in the history (L675): {history}"
    assert earlier["by"], f"the history says who (L675): {earlier}"
    for h in history:
        parse_iso(h["at"])
    err(m.api.get(f"/api/results/{rid}/history"), 403, "forbidden")


def test_marker_band_motion(browser, app_url):
    m, draws = band_member(app_url, 1)
    with screen(browser, app_url, "/me/results", m.api) as page:
        region, st = band(page, BAND_NAME)
        eventually(page, lambda: expect(st).to_have_count(2, timeout=EXPECT_MS), "two Estradiol stations")
        selected(page, st, 1)
        handle = part_handle(page, region, "dot")
        page.evaluate(RECORD_JS)
        click(st.nth(0))
        selected(page, st, 0)
        rec = []

        def moved() -> None:
            rec[:] = page.evaluate(READ_JS)
            assert {"dot", "value", "zone"} <= {p for r in rec for p in r["parts"]}, rec
        eventually(page, moved, "the dot, the numerals and the differing zones all move (L294)")
        durations = {p: {round(r["duration"]) for r in rec if p in r["parts"]} for p in ("dot", "value", "zone")}
        assert MEDIUM_MS in durations["dot"], f"the dot slides for medium (L295): {rec}"
        assert MEDIUM_MS in durations["value"], f"the numerals roll for medium (L296): {rec}"
        assert LONG_MS in durations["zone"], f"differing zones glide for long (L297): {rec}"
        starts = [r["start"] for r in rec if {"dot", "value", "zone"} & set(r["parts"]) and r["start"] is not None]
        assert starts and max(starts) - min(starts) <= FRAME_MS, f"all start in the same frame (L294): {rec}"
        assert handle.evaluate("(el, r) => el.isConnected && r.querySelector('[data-part=\"dot\"]') === el", region.element_handle()), \
            "the same dot element is moved, never redrawn (L295)"
        page.evaluate(RECORD_JS)
        new_draw, _ = released_draw(m, local_today("denver") - timedelta(days=3), [(BAND_MARKER, BAND_VALUES[2])])

        def trend_drawn():
            expect(st).to_have_count(3, timeout=EXPECT_MS)
            rec2 = page.evaluate(READ_JS)
            assert any("trend" in r["parts"] and round(r["duration"]) == LONG_MS for r in rec2), rec2
        eventually(page, trend_drawn, "the newest trend segment draws itself for long within the refresh (L299)")
        expect(st.nth(0)).to_have_attribute("data-state", "selected")
        until(page, NO_RUNNING_JS)
        settle(region)
        part_has(page, region, "value", f"{BAND_VALUES[0]} {BAND_UNIT}")
        rb, db = region.bounding_box(), handle.bounding_box()
        rel = db["x"] + db["width"] / 2 - rb["x"]
    with screen(browser, app_url, "/me/results", m.api, reduced=True) as page:
        region, st = band(page, BAND_NAME)
        eventually(page, lambda: expect(st).to_have_count(3, timeout=EXPECT_MS), "three Estradiol stations")
        click(st.nth(0))
        expect(st.nth(0)).to_have_attribute("data-state", "selected", timeout=EXPECT_MS)
        assert region.evaluate(RUNNING_IN_JS) == 0, "under reduced motion the band changes at once (L301)"
        assert any(squeezed(f"{BAND_VALUES[0]} {BAND_UNIT}") in squeezed(t) for t in region.evaluate(PART_TEXTS_JS, "value")), \
            "under reduced motion the numerals show their end state at once (L301)"
        rb, db = region.bounding_box(), part_handle(page, region, "dot").bounding_box()
        assert abs(db["x"] + db["width"] / 2 - rb["x"] - rel) <= 1, "reduced motion leaves the same final dot position (L301)"


def test_draw_station_keyboard(browser, app_url):
    m, draws = band_member(app_url, 2)
    dates = [fmt_date(d) for _, d in draws]
    with screen(browser, app_url, "/me/results", m.api) as page:
        region, st = band(page, BAND_NAME)
        eventually(page, lambda: expect(st).to_have_count(3, timeout=EXPECT_MS), "three stations")
        for i, (draw, _) in enumerate(draws):
            expect(st.nth(i)).to_have_accessible_name(dates[i])
            expect(st.nth(i)).to_have_attribute("data-at", draw["collectedAt"])
        expect(st.nth(2)).to_have_attribute("data-state", "selected")
        expect(st.nth(0)).to_have_attribute("data-state", "earlier")
        lb = page.get_by_role("listbox", name=f"Draws for {BAND_NAME}")
        tab_to(page, lb)
        for key, want in (("ArrowLeft", 1), ("Home", 0), ("ArrowLeft", 0), ("ArrowRight", 1), ("End", 2), ("ArrowRight", 2)):
            page.keyboard.press(key)
            selected(page, st, want)
        expect(st.nth(1)).to_have_attribute("data-state", "earlier")
        page.keyboard.press("Tab")
        assert not lb.evaluate(HAS_FOCUS_JS), "the station row is a single Tab stop (L250)"
        page.keyboard.press("Shift+Tab")
        assert lb.evaluate(HAS_FOCUS_JS), "Shift+Tab returns to the selected station"
        page.keyboard.press("Enter")
        pop = page.get_by_role("dialog", name=f"Draw on {dates[2]}")
        see(page, pop)
        settle(pop)
        assert pop.evaluate(IN_VIEW_JS), "the popover sits fully inside the viewport at 1280 (L252)"
        threading.Event().wait(0.2)
        page.keyboard.press("Escape")
        gone(page, pop, "Escape closes the popover")
        focus_in(page, lb, "focus returns to the station (L252)")
    with screen(browser, app_url, "/me/results", m.api, size=MOBILE) as page:
        region, st = band(page, BAND_NAME)
        eventually(page, lambda: expect(st).to_have_count(3, timeout=EXPECT_MS), "three stations at 375")
        selected(page, st, 2)
        lb = page.get_by_role("listbox", name=f"Draws for {BAND_NAME}")
        tab_to(page, lb)
        for key, want in (("ArrowUp", 1), ("ArrowUp", 0), ("ArrowDown", 1)):
            page.keyboard.press(key)
            selected(page, st, want)
        page.keyboard.press("Enter")
        pop = page.get_by_role("dialog", name=f"Draw on {dates[1]}")
        see(page, pop)
        settle(pop)
        assert pop.evaluate(IN_VIEW_JS), "the popover sits fully inside the viewport at 375 (L252)"


def test_wf_marker_band_touch(browser, app_url):
    m, draws = band_member(app_url, 1)
    api_res = results_of(m.api, m.id, "/api/me/results")
    first = draw_entry(api_res, "vitaminD", draws[0][0]["id"])
    latest = draw_entry(api_res, "vitaminD", draws[1][0]["id"])
    with screen(browser, app_url, "/me/results", m.api, size=MOBILE, clock_hours=7) as page:
        heading(page, "Your results")
        region, st = band(page, "Vitamin D")
        eventually(page, lambda: expect(st).to_have_count(2, timeout=EXPECT_MS), "two stations")
        selected(page, st, 1)
        part_has(page, region, "value", f"{latest['value']} ng/mL")
        see(page, region, FLAG_LABEL[latest["flag"]])
        zones = set(region.evaluate(PART_ATTRS_JS, ["zone", "data-zone"]))
        assert {"below", "inRange", "optimal", "above"} <= zones, zones
        assert fixed_bottom(page.get_by_role("link", name="Message your care team"))
        tap(st.nth(0))
        selected(page, st, 0)
        part_has(page, region, "value", f"{first['value']} ng/mL")
        see(page, region, FLAG_LABEL[first["flag"]])
        tap(st.nth(0))
        pop = page.get_by_role("dialog", name=f"Draw on {fmt_date(draws[0][1])}")
        see(page, pop, f"{hhmm(parse_iso(first['collectedAt']), 'denver')} Denver time")
        see(page, pop, FLAG_LABEL[first["flag"]])
        settle(pop)
        assert pop.evaluate(IN_VIEW_JS), "popover uncut at 375 (L252)"
        layout(page)
        axe(page)
        tap(pop.get_by_role("button", name="Close"))
        gone(page, pop, "Close closes the popover")
        focus_in(page, page.get_by_role("listbox", name=f"Draws for {VD_NAME}"), "focus returns to the station")
        axe(page)


def test_wf_marker_band_correction(browser, app_url):
    m = new_member(app_url)
    draw, d = released_draw(m, local_today("denver") - timedelta(days=16), [("vitaminD", "22.5")])
    rid = draw_entry(results_of(m.api, m.id, "/api/me/results"), "vitaminD", draw["id"])["resultId"]
    priya = signin(app_url, PRIYA)
    with screen(browser, app_url, "/me/results", m.api) as page:
        region, _ = band(page, "Vitamin D")
        part_has(page, region, "value", "22.5 ng/mL")
        tab_to(page, page.get_by_role("listbox", name=f"Draws for {VD_NAME}"))
        page.keyboard.press("Enter")
        pop = page.get_by_role("dialog", name=f"Draw on {fmt_date(d)}")
        see(page, pop)
        ok(priya.patch(f"/api/results/{rid}", {"value": CORRECTED_VD, "note": "Re-read from the lab report."}), 200, "correction")
        after = draw_entry(results_of(m.api, m.id, "/api/me/results"), "vitaminD", draw["id"])
        copy = f"Priya Shah corrected Vitamin D at {hhmm(parse_iso(after['correctedAt']), 'denver')} Denver time. The band shows the corrected value."
        def corrected():
            assert any(squeezed(f"{CORRECTED_VD} ng/mL") in squeezed(t) for t in page.evaluate(VISIBLE_TEXTS_JS, '[data-part="value"]')), "value not corrected yet"
            expect(page.locator("body")).to_contain_text(copy, timeout=EXPECT_MS)
        eventually(page, corrected, "the correction reaches the open band within the 5-second refresh (L676)",
                   seconds=REFRESH_MS / 1000 * 4)
        expect(pop).to_be_visible()
        see(page, page.locator("body"), "Optimal")
    assert after["value"] == CORRECTED_VD and after["flag"] == "optimal"
    other = new_member(app_url)
    draw2, _ = released_draw(other, local_today("denver") - timedelta(days=17), [("vitaminD", "22.5"), ("ldl", "118")])
    rid2 = draw_entry(results_of(priya, other.id), "vitaminD", draw2["id"])["resultId"]
    theo = signin(app_url, THEO)
    screen_rules(browser, app_url, f"/staff/members/{other.id}/results", priya, opener=("button", "Correct value"), dialog="Correct value", typed=("textbox", "Note"),
                 change=lambda: ok(theo.patch(f"/api/results/{rid2}", {"value": "23.0"}), 200, "a correction made elsewhere"),
                 appears=lambda page: squeezed("23.0 ng/mL") in squeezed(page_text(page)))
    api_rules(app_url, f"/api/results/{rid2}", signin(app_url, DANA), method="PATCH", reads=[(other.api, "/api/me/results"), (other.api, "/api/session")])
    cookie_rules(app_url, other.email, MEMBER_PASS)
    with screen(browser, app_url, f"/staff/members/{other.id}/results", priya) as page:
        heading(page, f"Results for {other.name}")
        opener = page.get_by_role("region", name="LDL", exact=True).get_by_role("button", name="Correct value")
        click(opener)
        dialog = page.get_by_role("dialog", name="Correct value")
        see(page, dialog)
        fill(dialog.get_by_role("textbox", name="Value"), "119")
        saving = dialog.get_by_role("button", name="Save correction")
        pending_shown(page, "**/api/results/*", saving, lambda: click(saving))
        say(page, "LDL corrected.")
        closed_focus(page, opener, "after Save correction")


def test_published_plans(app_url):
    m = new_member(app_url)
    priya = signin(app_url, PRIYA)
    base = f"/api/members/{m.id}"
    assert ok(m.api.get("/api/me/plan"), 200, "me plan")["plan"] is None
    draft = ok(priya.post(base + "/plans", {"basedOnPlanId": None, "sections": PLAN_A}), 201, "draft")["plan"]
    assert draft["state"] == "draft" and draft["blend"] is None and draft["publishedAt"] is None
    assert m.api.get("/api/me/plan").json()["plan"] is None, "a member never sees a draft (L515)"
    blend_a = ok(priya.post(base + "/blends", {"items": EXAMPLE_BLEND}), 201, "blend a")["blend"]
    p1 = ok(priya.post(f"/api/longevity-plans/{draft['id']}/publish"), 200, "publish")["plan"]
    assert p1["state"] == "published" and p1["publishedBy"] == "Priya Shah" and p1["sections"] == PLAN_A
    parse_iso(p1["publishedAt"])
    assert p1["blend"]["id"] == blend_a["id"]
    blend_b = ok(priya.post(base + "/blends", {"items": [{"ingredient": "vitaminD3Small", "capsulesPerDay": 2}]}), 201, "blend b")["blend"]
    mine = m.api.get("/api/me/plan").json()["plan"]
    assert mine["id"] == p1["id"] and mine["blend"]["id"] == blend_b["id"], "the latest plan shows the current blend (L685)"
    d2 = ok(priya.post(base + "/plans", {"basedOnPlanId": p1["id"], "sections": PLAN_B}), 201, "draft 2")["plan"]
    assert m.api.get("/api/me/plan").json()["plan"]["id"] == p1["id"]
    p2 = ok(priya.post(f"/api/longevity-plans/{d2['id']}/publish"), 200, "publish 2")["plan"]
    assert p2["blend"]["id"] == blend_b["id"]
    blend_c = ok(priya.post(base + "/blends", {"items": [{"ingredient": "glycine", "capsulesPerDay": 1}]}), 201, "blend c")["blend"]
    s1 = ok(priya.get(f"/api/longevity-plans/{p1['id']}"), 200, "plan 1")["plan"]
    s2 = ok(priya.get(f"/api/longevity-plans/{p2['id']}"), 200, "plan 2")["plan"]
    assert s1["sections"] == PLAN_A and s1["blend"]["id"] == blend_a["id"] and s1["publishedAt"] == p1["publishedAt"]
    assert s2["sections"] == PLAN_B and s2["blend"]["id"] == blend_b["id"]
    mine = m.api.get("/api/me/plan").json()["plan"]
    assert mine["id"] == p2["id"] and mine["sections"] == PLAN_B and mine["blend"]["id"] == blend_c["id"]
    d3 = ok(priya.post(base + "/plans", {"basedOnPlanId": p2["id"], "sections": PLAN_A}), 201, "draft 3")["plan"]
    assert m.api.get("/api/me/plan").json()["plan"]["id"] == p2["id"]
    listed = [p["id"] for p in ok(priya.get(base + "/plans"), 200, "plans")["plans"]]
    assert listed == [d3["id"], p2["id"], p1["id"]], "staff plans newest first, drafts included (L515)"
    err(m.api.get(f"/api/longevity-plans/{p1['id']}"), 403, "forbidden")


def test_newer_plan_protection(app_url):
    m = new_member(app_url)
    priya, theo = signin(app_url, PRIYA), signin(app_url, THEO)
    base = f"/api/members/{m.id}/plans"
    a = ok(priya.post(base, {"basedOnPlanId": None, "sections": PLAN_A}), 201, "priya draft")["plan"]
    b = ok(theo.post(base, {"basedOnPlanId": None, "sections": PLAN_B}), 201, "theo draft")["plan"]
    pb = ok(theo.post(f"/api/longevity-plans/{b['id']}/publish"), 200, "theo publishes")["plan"]
    copy = (f"Theo Lindqvist published a newer plan at {hhmm(parse_iso(pb['publishedAt']), 'phoenix')} Phoenix time. "
            "Your changes are still here.")
    err(priya.put(f"/api/longevity-plans/{a['id']}", {"sections": PLAN_B}), 412, "stale", copy)
    err(priya.post(f"/api/longevity-plans/{a['id']}/publish"), 412, "stale", copy)
    err(priya.post(base, {"basedOnPlanId": None, "sections": PLAN_A}), 412, "stale", copy)
    assert ok(priya.get(f"/api/longevity-plans/{a['id']}"), 200, "draft a")["plan"]["sections"] == PLAN_A
    assert m.api.get("/api/me/plan").json()["plan"]["id"] == pb["id"]
    c = ok(priya.post(base, {"basedOnPlanId": pb["id"], "sections": PLAN_A}), 201, "fresh draft")["plan"]
    ok(priya.put(f"/api/longevity-plans/{c['id']}", {"sections": PLAN_B}), 200, "save draft")
    err(priya.put(f"/api/longevity-plans/{pb['id']}", {"sections": PLAN_A}), 409, "already_published", "This plan is already published.")
    err(priya.post(f"/api/longevity-plans/{pb['id']}/publish"), 409, "already_published", "This plan is already published.")
    long_text = dict(PLAN_A, nutrition="x" * (SECTION_LIMIT + 1))
    field_err(priya.post(base, {"basedOnPlanId": pb["id"], "sections": long_text}), "sections.nutrition",
              "Keep each section to 20,000 characters.")


def test_plan_dialog_keeps_state(browser, app_url):
    m = new_member(app_url)
    priya = signin(app_url, PRIYA)
    with screen(browser, app_url, f"/staff/members/{m.id}/plan", priya) as page:
        heading(page, f"Plan for {MEMBER_NAME}")
        opener = page.get_by_role("button", name="Edit plan").first
        click(opener)
        dialog = page.get_by_role("dialog", name="Edit plan")
        see(page, dialog)
        nutrition = dialog.get_by_role("textbox", name="Nutrition")
        fill(nutrition, TYPED_PLAN)
        for _ in range(3):
            advance(page, REFRESH_MS)
        expect(dialog).to_be_visible()
        expect(nutrition).to_have_value(TYPED_PLAN)
        assert nutrition.evaluate(IS_FOCUS_JS), "focus stays on the same control across the refresh (SR1)"
        page.keyboard.press("Escape")
        focused_now(opener)
        page.keyboard.press("Enter")
        advance(page, LONG_MS * 2)
        until(page, NO_RUNNING_JS)
        advance(page, LONG_MS * 2)
        expect(dialog).to_be_visible()
        assert not dialog.evaluate(INERT_JS), "the reopened dialog stays open for good (L253)"


def test_wf_longevity_plan_publish(browser, app_url):
    m = new_member(app_url)
    priya = signin(app_url, PRIYA)
    with screen(browser, app_url, f"/staff/members/{m.id}/plan", priya) as page:
        opener = page.get_by_role("button", name="Edit plan").first
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Edit plan")
        see(page, dialog)
        focus_in(page, dialog.get_by_role("textbox", name="Nutrition"), "opening moves focus to the first field (L244)")
        for name, key in (("Nutrition", "nutrition"), ("Movement", "movement"), ("Sleep", "sleep"), ("Supplements notes", "supplements")):
            fill(dialog.get_by_role("textbox", name=name), PLAN_A[key])
        axe(page)
        publishing = dialog.get_by_role("button", name="Publish plan")
        publishing.focus()
        pending_shown(page, re.compile(r"/api/(members/[^/]+/plans|longevity-plans/)"), publishing, lambda: page.keyboard.press("Enter"))
        say(page, "Plan published.")
        at_url(page, re.escape(f"/staff/members/{m.id}/plans/") + r"[^/?#]+$")
        closed_focus(page, page.get_by_role("button", name="Edit plan"), "after Publish plan")
        plan_id = urlparse(page.url).path.rsplit("/", 1)[-1]
        plan = ok(priya.get(f"/api/longevity-plans/{plan_id}"), 200, "published plan")["plan"]
        assert plan["state"] == "published" and plan["publishedBy"] == "Priya Shah" and plan["sections"] == PLAN_A
        see(page, h1(page), f"Plan published {fmt_date(local_date(plan['publishedAt'], 'phoenix'))}")
        page.reload()
        see(page, h1(page), f"Plan published {fmt_date(local_date(plan['publishedAt'], 'phoenix'))}")
    with screen(browser, app_url, "/me/plan", m.api) as page:
        heading(page, "Your longevity plan")
        see(page, page.locator("body"), f"Published {fmt_date(local_date(plan['publishedAt'], 'denver'))} by Priya Shah")
        see(page, page.locator("body"), "Lights out by 22:30.")
        see(page, page.get_by_role("listitem").filter(has_text="Walk 30 minutes daily"))
    other = new_member(app_url)
    theo = signin(app_url, THEO)

    def theo_publishes():
        draft = ok(theo.post(f"/api/members/{other.id}/plans", {"basedOnPlanId": None, "sections": PLAN_B}), 201, "a draft elsewhere")["plan"]
        ok(theo.post(f"/api/longevity-plans/{draft['id']}/publish"), 200, "published elsewhere")
    screen_rules(browser, app_url, f"/staff/members/{other.id}/plan", priya, opener=("button", "Edit plan"), dialog="Edit plan", typed=("textbox", "Nutrition"),
                 change=theo_publishes, appears=lambda page: PLAN_B["sleep"] in page_text(page) or "Theo Lindqvist" in page_text(page))
    api_rules(app_url, f"/api/members/{other.id}/plans", signin(app_url, DANA), reads=[(priya, f"/api/members/{other.id}/plans"), (priya, "/api/session")])
    cookie_rules(app_url, PRIYA, STAFF_PASS)


def test_wf_longevity_plan_stale(browser, app_url):
    m = new_member(app_url)
    priya, theo = signin(app_url, PRIYA), signin(app_url, THEO)
    with screen(browser, app_url, f"/staff/members/{m.id}/plan", priya, size=MOBILE) as page:
        tap(page.get_by_role("button", name="Edit plan").first)
        dialog = page.get_by_role("dialog", name="Edit plan")
        nutrition = dialog.get_by_role("textbox", name="Nutrition")
        fill(nutrition, TYPED_DRAFT)
        hold_clock(page)
        b = ok(theo.post(f"/api/members/{m.id}/plans", {"basedOnPlanId": None, "sections": PLAN_B}), 201, "theo draft")["plan"]
        pb = ok(theo.post(f"/api/longevity-plans/{b['id']}/publish"), 200, "theo publishes")["plan"]
        copy = (f"Theo Lindqvist published a newer plan at {hhmm(parse_iso(pb['publishedAt']), 'phoenix')} Phoenix time. "
                "Your changes are still here.")
        tap(dialog.get_by_role("button", name="Save draft"))
        see(page, dialog, copy)
        expect(dialog).to_be_visible()
        expect(nutrition).to_have_value(TYPED_DRAFT)
        focus_on(page, copy)
        layout(page)
        axe(page)
    plans = ok(priya.get(f"/api/members/{m.id}/plans"), 200, "plans")["plans"]
    assert [p["id"] for p in plans] == [pb["id"]], "the stale save wrote nothing"


def test_packet_packing(app_url):
    m = new_member(app_url)
    priya = signin(app_url, PRIYA)
    path = f"/api/members/{m.id}/blends"
    blend = ok(priya.post(path + "/preview", {"items": EXAMPLE_BLEND}), 200, "preview")["blend"]
    assert "id" not in blend and blend["morningCapsules"] == 3 and blend["eveningCapsules"] == 4
    omega = next(i for i in blend["items"] if i["ingredient"] == "omega3")
    assert (omega["morning"], omega["evening"]) == (1, 1)
    odd = ok(priya.post(path + "/preview", {"items": [{"ingredient": "omega3", "capsulesPerDay": 3},
                                                      {"ingredient": "creatine", "capsulesPerDay": 1}]}), 200, "split")["blend"]
    items = {i["ingredient"]: i for i in odd["items"]}
    assert (items["omega3"]["morning"], items["omega3"]["evening"]) == (2, 1)
    assert (items["creatine"]["morning"], items["creatine"]["evening"]) == (1, 0)
    assert odd["morningCapsules"] == 3 and odd["eveningCapsules"] == 1
    err(priya.post(path + "/preview", {"items": [{"ingredient": "magnesiumGlycinate", "capsulesPerDay": PACKET_MAX + 1}]}),
        422, "packet_full", EVENING_FULL)
    both = [{"ingredient": "vitaminD3", "capsulesPerDay": PACKET_MAX + 1}, {"ingredient": "glycine", "capsulesPerDay": PACKET_MAX + 1}]
    err(priya.post(path, {"items": both}), 422, "packet_full", MORNING_FULL)
    ok(priya.post(path + "/preview", {"items": [{"ingredient": "glycine", "capsulesPerDay": PACKET_MAX}]}), 200, "a full packet is allowed")
    for bad in (0, 1.5):
        field_err(priya.post(path + "/preview", {"items": [{"ingredient": "glycine", "capsulesPerDay": bad}]}),
                  "items.0.capsulesPerDay", "Use a whole number of capsules, 1 or more.")
    field_err(priya.post(path + "/preview", {"items": [{"ingredient": "glycine", "capsulesPerDay": 1}, {"ingredient": "glycine", "capsulesPerDay": 1}]}),
              "items.1.ingredient", "Each ingredient appears once.")
    field_err(priya.post(path + "/preview", {"items": [{"ingredient": "unobtainium", "capsulesPerDay": 1}]}),
              "items.0.ingredient", "Choose an ingredient from the catalog.")
    assert ok(priya.get(path), 200, "blends")["blends"] == [], "previews and refusals write nothing"
    saved = ok(priya.post(path, {"items": EXAMPLE_BLEND}), 201, "save")["blend"]
    assert saved["id"] and m.api.get("/api/me/blend").json()["blend"]["id"] == saved["id"]


def test_blend_prices(app_url):
    priya = signin(app_url, PRIYA)
    ings = {i["id"]: i for i in ok(priya.get("/api/ingredients"), 200, "ingredients")["ingredients"]}
    assert set(ings) == set(ING_PRICE)
    for k, v in ings.items():
        assert v["priceCentsPerCapsule"] == ING_PRICE[k] and v["time"] == ING_TIME[k] and v["name"] == ING_NAME[k]
    assert ings["vitaminD3"]["strength"] == {"amount": "5000", "unit": "IU", "mcg": "125"}
    m = new_member(app_url)
    path = f"/api/members/{m.id}/blends/preview"
    combos = [[(i["ingredient"], i["capsulesPerDay"]) for i in EXAMPLE_BLEND], [("vitaminK2", 1)],
              [("omega3", 3), ("creatine", 1), ("glycine", 2), ("coq10", 1)], [("zincPicolinate", 1), ("vitaminD3Small", 1)]]
    for combo in combos:
        morning, evening, listed, member = pack(combo)
        b = ok(priya.post(path, {"items": [{"ingredient": k, "capsulesPerDay": n} for k, n in combo]}), 200, f"preview {combo}")["blend"]
        assert (b["morningCapsules"], b["eveningCapsules"], b["listPriceCents"], b["memberPriceCents"]) == (morning, evening, listed, member), b
    example = ok(priya.post(path, {"items": EXAMPLE_BLEND}), 200, "example")["blend"]
    assert example["listPriceCents"] == 2970 and example["memberPriceCents"] == 2525, "half up, never the float $25.24 (L695)"


def test_blend_builder_layouts(browser, app_url):
    m = new_member(app_url)
    priya = signin(app_url, PRIYA)
    sizes = [(1280, 800, True), (WIDE_SWITCH, 800, True), (WIDE_SWITCH - 1, 800, False), (1024, 768, False), (768, 1024, False)]
    with screen(browser, app_url, f"/staff/members/{m.id}/blend", priya) as page:
        heading(page, f"Blend for {MEMBER_NAME}")
        for w, h, beside in sizes:
            page.set_viewport_size({"width": w, "height": h})
            page.reload()
            heading(page, f"Blend for {MEMBER_NAME}")
            settle(page.locator("body"))
            cat = page.get_by_role("region", name="Ingredient catalog").bounding_box()
            mor = page.get_by_role("region", name="Morning packet").bounding_box()
            eve = page.get_by_role("region", name="Evening packet").bounding_box()
            if beside:
                assert cat["x"] + cat["width"] <= mor["x"] + 1 and cat["y"] < mor["y"] + mor["height"], f"catalog left of packets at {w}"
                assert abs(mor["y"] - eve["y"]) < 1 and mor["x"] + mor["width"] <= eve["x"] + 1, f"packets side by side at {w}"
            else:
                assert cat["y"] + cat["height"] <= min(mor["y"], eve["y"]) + 1, f"catalog stacked above the packets at {w}"
            layout(page)
        page.set_viewport_size(MOBILE)
        page.reload()
        heading(page, f"Blend for {MEMBER_NAME}")
        settle(page.locator("body"))
        expect(page.get_by_role("region", name="Ingredient catalog")).to_have_count(0)
        mor = page.get_by_role("region", name="Morning packet").bounding_box()
        eve = page.get_by_role("region", name="Evening packet").bounding_box()
        assert eve["y"] >= mor["y"] + mor["height"] - 1, "packets stack at 375"
        tap(page.get_by_role("button", name="Ingredient catalog"))
        sheet = page.get_by_role("dialog", name="Ingredient catalog")
        see(page, sheet)
        see(page, sheet.get_by_role("button", name=f"Add {ING_NAME['vitaminD3']}", exact=True))
        layout(page)


def test_wf_supplement_blends_build(browser, app_url):
    m = new_member(app_url)
    priya = signin(app_url, PRIYA)
    with screen(browser, app_url, f"/staff/members/{m.id}/blend", priya) as page:
        catalog = page.get_by_role("region", name="Ingredient catalog")
        see(page, catalog, "5,000 IU (125 mcg)")
        for item in EXAMPLE_BLEND:
            name = ING_NAME[item["ingredient"]]
            add = catalog.get_by_role("button", name=f"Add {name}", exact=True)
            tab_to(page, add)
            page.keyboard.press("Enter")
            spin = page.get_by_role("spinbutton", name=f"Capsules a day, {name}", exact=True)
            see(page, spin)
            if item is EXAMPLE_BLEND[0]:
                am, pm, listed_one, member_one = pack([(item["ingredient"], 1)])
                see(page, page.get_by_role("region", name="Morning packet"), f"{am} of {PACKET_MAX} capsules")
                see(page, page.get_by_role("region", name="Evening packet"), f"{pm} of {PACKET_MAX} capsules")
                see(page, page.locator("body"), labelled("30-day list price", money(listed_one)))
                see(page, page.locator("body"), labelled("Member price", money(member_one)))
            if item["capsulesPerDay"] > 1:
                spin.focus()
                page.keyboard.press("ArrowUp")
                eventually(page, lambda: expect(spin).to_have_value(str(item["capsulesPerDay"]), timeout=EXPECT_MS), "arrow raises the dose")
        morning, evening, listed, member = pack([(i["ingredient"], i["capsulesPerDay"]) for i in EXAMPLE_BLEND])
        see(page, page.get_by_role("region", name="Morning packet"), f"{morning} of {PACKET_MAX} capsules")
        see(page, page.get_by_role("region", name="Evening packet"), f"{evening} of {PACKET_MAX} capsules")
        see(page, page.locator("body"), labelled("30-day list price", money(listed)))
        see(page, page.locator("body"), labelled("Member price", money(member)))
        axe(page)
        save = page.get_by_role("button", name="Save blend")
        save.focus()
        pending_shown(page, "**/api/members/*/blends", save, lambda: page.keyboard.press("Enter"))
        say(page, "Blend saved.")
        at_url(page, re.escape(f"/staff/members/{m.id}/blends/") + r"[^/?#]+$")
        blend_id = urlparse(page.url).path.rsplit("/", 1)[-1]
    newest = ok(priya.get(f"/api/members/{m.id}/blends"), 200, "blends")["blends"][0]
    assert newest["id"] == blend_id and newest["morningCapsules"] == 3 and newest["eveningCapsules"] == 4
    assert newest["listPriceCents"] == 2970 and newest["memberPriceCents"] == 2525
    assert m.api.get("/api/me/blend").json()["blend"]["id"] == blend_id
    screen_rules(browser, app_url, f"/staff/members/{m.id}/blend", priya, ring=("button", f"Add {ING_NAME['creatine']}"), refresh=True)
    screen_rules(browser, app_url, f"/staff/members/{m.id}/blend", priya, opener=("button", "Ingredient catalog"), dialog="Ingredient catalog",
                 refresh=False, size=MOBILE)
    api_rules(app_url, f"/api/members/{m.id}/blends", signin(app_url, DANA), reads=[(priya, f"/api/members/{m.id}/blends"), (priya, "/api/session")])
    cookie_rules(app_url, PRIYA, STAFF_PASS)


def test_wf_supplement_blends_full_packet(browser, app_url):
    m = new_member(app_url)
    priya = signin(app_url, PRIYA)
    with screen(browser, app_url, f"/staff/members/{m.id}/blend", priya, size=MOBILE) as page:
        opener = page.get_by_role("button", name="Ingredient catalog")
        tap(opener)
        sheet = page.get_by_role("dialog", name="Ingredient catalog")
        see(page, sheet)
        axe(page)
        tap(sheet.get_by_role("button", name=f"Add {ING_NAME['magnesiumGlycinate']}", exact=True))
        gone(page, sheet, "the sheet closes after Add (L254)")
        focus_in(page, opener, "focus returns to Ingredient catalog (L254)")
        spin = page.get_by_role("spinbutton", name=f"Capsules a day, {ING_NAME['magnesiumGlycinate']}", exact=True)
        fill(spin, str(PACKET_MAX + 1))
        problems = page.get_by_role("region", name="Problems")
        see(page, problems, EVENING_FULL)
        say(page, EVENING_FULL)
        assert spin.evaluate(IS_FOCUS_JS), "after an automatic preview focus stays on the spinbutton (L254)"
        save = page.get_by_role("button", name="Save blend")
        assert fixed_bottom(save)
        tap(save.first)
        focus_in(page, problems, "after Save blend focus moves to the Problems region (L254)")
        layout(page)
        axe(page)
    assert ok(priya.get(f"/api/members/{m.id}/blends"), 200, "blends")["blends"] == []


def test_message_limits(app_url):
    m = new_member(app_url)
    emoji = "🙂" * MESSAGE_MAX_CP
    msg = ok(send_message(m.api, "/api/me/messages", emoji), 201, "2,000 emoji")["message"]
    assert msg["body"] == emoji and msg["attachment"] is None and msg["from"]["role"] == "member"
    parse_iso(msg["sentAt"])
    field_err(send_message(m.api, "/api/me/messages", "a" * (MESSAGE_MAX_CP + 1)), "body", "Keep your message to 2,000 characters.")
    field_err(send_message(m.api, "/api/me/messages", ""), "body", "Write a message first.")
    field_err(send_message(m.api, "/api/me/messages", BAD_ATTACHMENT_BODY, ("scan.pdf", b"plain text pretending", "application/pdf")),
              "attachment", "Attach a PDF, JPEG or PNG file.")
    pdf = pdf_bytes()
    sent = ok(send_message(m.api, "/api/me/messages", "lab letter", ("letter.bin", pdf, "application/octet-stream")), 201, "pdf by content")
    att = sent["message"]["attachment"]
    assert att["kind"] == "pdf" and att["bytes"] == len(pdf)
    assert m.api.get(f"/api/attachments/{att['id']}").content == pdf
    over = b"%PDF-" + b"0" * (ATTACHMENT_LIMIT + 1 - 5)
    for client in (m.api, Api(app_url)):
        err(send_message(client, "/api/me/messages", BIG_BODY, ("big.pdf", over, "application/pdf")), 413, "too_large",
            "Attachments must be at most 5,000,000 bytes.")
    bodies = [x["body"] for x in m.api.get("/api/me/messages").json()["messages"]]
    assert BIG_BODY not in bodies and BAD_ATTACHMENT_BODY not in bodies


def test_photo_originals_and_staff_copies(app_url):
    m = new_member(app_url)
    photo = make_jpeg()
    sent = ok(send_message(m.api, "/api/me/messages", "photo of the rash", ("IMG_0001.jpg", photo, "image/jpeg")), 201, "photo")
    att = sent["message"]["attachment"]
    assert att["kind"] == "jpeg"
    base = f"members/{m.id}/attachments/{att['id']}"
    assert S3().get(f"{base}/original") == photo, "the original is kept byte for byte (L702)"
    clean = S3().get(f"{base}/clean")
    dana = signin(app_url, DANA)
    seen = dana.get(f"/api/attachments/{att['id']}")
    assert seen.status_code == 200 and seen.content == clean
    assert dana.get(f"/api/attachments/{att['id']}/original").content == photo
    assert image_size(photo) == (8, 16) and image_size(clean) == (16, 8), "orientation 6 is applied to the pixels (L702)"
    for marker in (b"Exif", b"secret-xmp", b"secret-comment", b"http://ns.adobe.com/xap"):
        assert marker not in clean, f"the staff copy keeps {marker!r} (L702)"
    other = new_member(app_url)
    err(other.api.get(f"/api/attachments/{att['id']}"), 404, "not_found")


@pytest.mark.timeout(900)
def test_message_rate_limit():
    short = env_url("APP_SHORT_URL")
    m = new_member(short)
    first = datetime.now(timezone.utc)
    for i in range(MESSAGE_LIMIT):
        ok(send_message(m.api, "/api/me/messages", f"note {i}"), 201, f"message {i + 1}")
    before = datetime.now(timezone.utc)
    r = send_message(m.api, "/api/me/messages", OVER_LIMIT)
    after = datetime.now(timezone.utc)
    e = err(r, 429, "rate_limited")
    ra = r.headers.get("Retry-After", "")
    assert ra.isdigit() and 1 <= int(ra) <= SHORT_WINDOW_S, f"Retry-After in whole seconds (L704): {ra!r}"
    assert e["message"] in retry_copies("Too many messages for now. You can send another at {} Denver time.", before, after, int(ra), "denver"), e
    spoof = send_message(m.api, "/api/me/messages", SPOOFED, headers={"X-Forwarded-For": "203.0.113.9"})
    err(spoof, 429, "rate_limited")
    other = new_member(short)
    ok(send_message(other.api, "/api/me/messages", "from the same network"), 201, "another member from the same address")
    bodies = [x["body"] for x in m.api.get("/api/me/messages").json()["messages"]]
    assert OVER_LIMIT not in bodies and SPOOFED not in bodies

    def accepted():
        res = send_message(m.api, "/api/me/messages", "after the window")
        if res.status_code == 201:
            return datetime.now(timezone.utc)
        err(res, 429, "rate_limited")
        return None
    at = poll(accepted, SHORT_WINDOW_S * 3, "a message is accepted once the oldest counted one leaves the window (L705)")
    assert (at - first).total_seconds() >= SHORT_WINDOW_S - CLOCK_SLACK_S, "refused attempts never extended or shortened the window"


def test_wf_care_messages_thread(browser, app_url):
    m = new_member(app_url)
    dana = signin(app_url, DANA)
    pdf = pdf_bytes()
    with screen(browser, app_url, "/me/messages", m.api) as page:
        heading(page, "Messages")
        box = page.get_by_role("textbox", name="Message")
        tab_to(page, box)
        page.keyboard.type("Hello 🙂")
        see(page, page.locator("body"), "7 of 2,000 characters")
        page.get_by_label("Attachment").set_input_files(files=[{"name": "letter.pdf", "mimeType": "application/pdf", "buffer": pdf}])
        sending = page.get_by_role("button", name="Send message")
        sending.focus()
        pending_shown(page, "**/api/me/messages", sending, lambda: page.keyboard.press("Enter"))
        say(page, "Message sent.")
        eventually(page, lambda: expect(box).to_have_value("", timeout=EXPECT_MS), "the box clears after a success (L255)")
        mine = m.api.get("/api/me/messages").json()["messages"]
        sent = next(x for x in mine if x["body"] == "Hello 🙂")
        assert sent["attachment"]["kind"] == "pdf"
        assert dana.get(f"/api/attachments/{sent['attachment']['id']}").content == pdf
        threads = ok(dana.get("/api/message-threads"), 200, "threads")["threads"]
        assert any(t["memberId"] == m.id and t["state"] == "open" for t in threads)
        box.focus()
        page.keyboard.type(TYPED_WAITING)
        ok(send_message(dana, f"/api/members/{m.id}/messages", "Thanks, we will call you."), 201, "staff reply")
        see(page, page.get_by_role("log", name="Messages"), "Thanks, we will call you.")
        assert box.evaluate(IS_FOCUS_JS), "the reply arrives without moving focus (L255)"
        expect(box).to_have_value(TYPED_WAITING)
        axe(page)
    other = new_member(app_url)
    reply = "We have your note."
    screen_rules(browser, app_url, "/me/messages", other.api, ring=("textbox", "Message"), typed=("textbox", "Message"),
                 change=lambda: ok(send_message(dana, f"/api/members/{other.id}/messages", reply), 201, "a reply sent elsewhere"),
                 appears=lambda page: reply in page_text(page))
    screen_rules(browser, app_url, "/me/messages", other.api, opener=("button", "Menu"), dialog="Menu", refresh=False, size=MOBILE)
    api_rules(app_url, "/api/me/messages", signin(app_url, DANA), limit=MESSAGE_BODY_LIMIT, reads=[(other.api, "/api/me/messages"), (other.api, "/api/session")])
    cookie_rules(app_url, other.email, MEMBER_PASS)


def test_wf_care_messages_rate_limit(browser):
    short = env_url("APP_SHORT_URL")
    m = new_member(short)
    for i in range(MESSAGE_LIMIT):
        ok(send_message(m.api, "/api/me/messages", f"note {i}"), 201, f"message {i + 1}")
    with screen(browser, short, "/me/messages", m.api, size=MOBILE) as page:
        send = page.get_by_role("button", name="Send message")
        assert fixed_bottom(send)
        fill(page.get_by_role("textbox", name="Message"), ELEVENTH)
        tap(send.first)
        say(page, re.compile(r"Too many messages for now\. You can send another at \d{2}:\d{2} Denver time\."))
        layout(page)
        axe(page)
    assert ELEVENTH not in [x["body"] for x in m.api.get("/api/me/messages").json()["messages"]]


def test_results_history_file(app_url):
    m, draws = band_member(app_url, 1)
    (d1, day1), (d2, day2) = draws
    res = results_of(m.owner, m.id)
    priya = signin(app_url, PRIYA)
    ok(priya.patch(f"/api/results/{draw_entry(res, BAND_MARKER, d1['id'])['resultId']}", {"value": "61", "note": '@see "lab"'}), 200, "note 1")
    ok(priya.patch(f"/api/results/{draw_entry(res, 'vitaminD', d2['id'])['resultId']}", {"value": "32.0", "note": "=1+1"}), 200, "note 2")
    hidden, _, _ = past_draw(m, local_today("denver") - timedelta(days=5))
    ok(m.owner.post(f"/api/draws/{hidden['id']}/results", {"results": [{"marker": "ldl", "value": "77"}]}), 201, "unreleased")
    r = m.api.get("/api/me/results-history")
    assert r.status_code == 200 and r.headers["content-type"].replace(" ", "").lower() == CSV_TYPE.replace(" ", "")
    assert r.headers["content-disposition"] == 'attachment; filename="ocotillo-results-history.csv"'
    raw = r.content
    assert not raw.startswith(b"\xef\xbb\xbf"), "no byte order mark (L709)"
    body = raw.decode("utf-8")
    assert "\n" not in body.replace("\r\n", ""), "CRLF line ends only (L709)"
    lines = [ln for ln in body.split("\r\n") if ln]
    want = [CSV_HEADER,
            ",".join(csv_cell(v) for v in (str(day1), BAND_NAME, "61", BAND_UNIT, "Optimal", BAND_YOUNG, "'" + '@see "lab"')),
            ",".join(csv_cell(v) for v in (str(day1), "Vitamin D", "22.5", "ng/mL", "Below range", "30.0–100.0 (optimal 40.0–60.0)", "")),
            ",".join(csv_cell(v) for v in (str(day2), BAND_NAME, BAND_VALUES[1], BAND_UNIT, "Optimal", BAND_OLD, "")),
            ",".join(csv_cell(v) for v in (str(day2), "Vitamin D", "32.0", "ng/mL", "In range", "30.0–100.0 (optimal 40.0–60.0)", "'=1+1"))]
    assert lines == want, lines
    for i in range(DOWNLOAD_LIMIT - 1):
        ok(m.api.get("/api/me/results-history"), 200, f"download {i + 2}")
    before = datetime.now(timezone.utc)
    sixth = m.api.get("/api/me/results-history")
    after = datetime.now(timezone.utc)
    e = err(sixth, 429, "rate_limited")
    ra = sixth.headers.get("Retry-After", "")
    assert ra.isdigit() and int(ra) >= 1
    assert e["message"] in retry_copies("Too many downloads for now. You can download again at {} Denver time.", before, after, int(ra), "denver"), e


def test_receipt_pages(app_url, killbill):
    api, me, receipt = plus_signup(app_url)
    view = ok(api.get(f"/api/receipts/{receipt['id']}"), 200, "receipt")["receipt"]
    assert set(view) == RECEIPT_VIEW_KEYS, set(view) ^ RECEIPT_VIEW_KEYS
    assert re.fullmatch(r"OLC-\d{6}", view["number"]) and view["memberName"] == MEMBER_NAME
    assert view["amountCents"] == 127492 and sum(i["amountCents"] for i in view["items"]) == view["amountCents"]
    assert view["paidDate"] == str(local_date(view["paidAt"], "phoenix")), "paid date in Phoenix time (L727)"
    assert view["practice"]["name"] == "Ocotillo Longevity Club" and view["practice"]["taxNumber"] == "86-4172093"
    assert "8820 E Desert Willow Way" in json.dumps(view["practice"], ensure_ascii=False)
    acct = kb_account(killbill, me["id"])
    invoices = {i["invoiceId"]: i for i in killbill.invoices(acct["accountId"])}
    inv = invoices[view["invoiceId"]]
    assert int(Decimal(str(inv["amount"])) * 100) == view["amountCents"] and Decimal(str(inv["balance"])) == 0
    paid = [i for i in invoices.values() if Decimal(str(i["amount"])) > 0 and Decimal(str(i["balance"])) == 0]
    mine = api.get("/api/me/receipts").json()["receipts"]
    assert len({r["id"] for r in mine}) == len(mine) == len(paid), "exactly one receipt per paid invoice (L725)"
    err(signin(app_url, DANA).get(f"/api/receipts/{receipt['id']}"), 403, "forbidden")
    ok(signin(app_url, JORDAN).get(f"/api/receipts/{receipt['id']}"), 200, "billing lead reads the receipt")
    other, _, _ = signup(app_url)
    err(other.get(f"/api/receipts/{receipt['id']}"), 404, "not_found")


@pytest.mark.timeout(1500)
def test_receipt_list(app_url):
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        made = list(pool.map(lambda _: plus_signup(app_url), range(PAGE_SIZE + 1)))
    ours = {r["number"]: r for _, _, r in made}
    month = max({r["paidDate"][:7] for r in ours.values()}, key=lambda mo: sum(r["paidDate"][:7] == mo for r in ours.values()))
    jordan = signin(app_url, JORDAN)
    field_err(jordan.get("/api/receipts", params={"month": "2026/11"}), "month", "Choose a month as YYYY-MM.")
    field_err(jordan.get("/api/receipts", params={"month": month, "cursor": "not-a-cursor"}), "cursor", "That page link is no longer valid.")
    err(signin(app_url, PRIYA).get("/api/receipts", params={"month": month}), 403, "forbidden")
    err(made[0][0].get("/api/receipts", params={"month": month}), 403, "forbidden")
    seen, cursor, late = [], None, None
    for page_no in range(PAGE_LIMIT):
        params = {"month": month} | ({"cursor": cursor} if cursor else {})
        body = ok(jordan.get("/api/receipts", params=params), 200, "receipt page")
        assert set(body) == {"receipts", "nextCursor"} and len(body["receipts"]) <= PAGE_SIZE
        for r in body["receipts"]:
            assert set(r) == RECEIPT_KEYS, set(r) ^ RECEIPT_KEYS
            assert r["paidDate"][:7] == month
        seen += body["receipts"]
        if page_no == 0:
            assert body["nextCursor"], "more than 25 receipts give a next page"
            _, _, late = plus_signup(app_url)
        cursor = body["nextCursor"]
        if not cursor:
            break
    numbers = [r["number"] for r in seen]
    assert numbers == sorted(numbers) and len(numbers) == len(set(numbers)), "stable order with no repeats (L729)"
    for n, r in ours.items():
        if r["paidDate"][:7] == month:
            assert numbers.count(n) == 1, f"{n} listed exactly once"
    if late["paidDate"][:7] == month:
        assert numbers.count(late["number"]) == 1, "a receipt recorded while paging appears after the cursor (L729)"
    raw = json.dumps(seen)
    for health in ("Vitamin D", "LDL", "ldl", "dateOfBirth", "1990-04-12", ADDRESS["line1"], "flag"):
        assert health not in raw, f"receipt list carries {health!r} (L539)"


def test_wf_records_and_receipts_member(browser, app_url):
    m, _ = band_member(app_url, 0)
    receipt = my_receipts(m.api)[0]
    with screen(browser, app_url, "/me/records", m.api, size=MOBILE) as page:
        heading(page, "Records and receipts")
        button = page.get_by_role("button", name="Download results history")
        assert fixed_bottom(button)
        with downloads(page) as got:
            tap(button.first)

            def arrived() -> None:
                assert got, "the results history download has not started (L364)"
            eventually(page, arrived, "the results history file downloads (L538)")
        data = Path(got[0].path()).read_bytes().decode("utf-8")
        assert data.startswith(CSV_HEADER) and ",".join(csv_cell(v) for v in (BAND_NAME, BAND_VALUES[0])) in data
        say(page, "Your results history is downloading.")
        frame = page.get_by_role("region", name="Receipts table")
        see(page, frame.get_by_role("table", name="Receipts"), receipt["number"])
        frame.focus()
        assert frame.evaluate(IS_FOCUS_JS), "the wide table's frame takes keyboard focus (SR5)"
        layout(page)
        axe(page)
        page.goto(f"{app_url}/receipts/{receipt['id']}")
        see(page, h1(page), f"Receipt {receipt['number']}")
        see(page, page.locator("body"), "86-4172093")
        see(page, page.locator("body"), money(receipt["amountCents"]))
        see(page, page.locator("body"), "Ocotillo Longevity Club")
        see(page, page.locator("body"), "8820 E Desert Willow Way")
        see(page, page.locator("body"), receipt["memberName"])
        see(page, page.locator("body"), fmt_date(date.fromisoformat(receipt["paidDate"])))
        see(page, page.locator("body"), "Paid")
        assert fixed_bottom(page.get_by_role("button", name="Print receipt"))
        page.reload()
        see(page, h1(page), f"Receipt {receipt['number']}")
        axe(page)
    screen_rules(browser, app_url, "/me/records", m.api, opener=("button", "Menu"), dialog="Menu", size=MOBILE, also=(DESKTOP,))
    screen_rules(browser, app_url, "/me/records", m.api, ring=("button", "Download results history"), refresh=False)
    err(httpx.post(app_url + "/api/receipts", content=oversized(), headers=JSON_HEADERS, timeout=HTTP_TIMEOUT), 405, "method_not_allowed")
    err(httpx.get(app_url + "/api/me/results-history", timeout=HTTP_TIMEOUT), 401, "not_signed_in")
    err(signin(app_url, PRIYA).get("/api/receipts", params={"month": "bad"}), 403, "forbidden")
    listed = ok(m.api.get("/api/me/receipts"), 200, "my receipts")
    assert walk_keys(listed) == [], walk_keys(listed)
    cookie_rules(app_url, m.email, MEMBER_PASS)


def test_wf_records_and_receipts_billing(browser, app_url):
    _, _, receipt = plus_signup(app_url)
    jordan = signin(app_url, JORDAN)
    with screen(browser, app_url, "/staff/receipts", jordan, size=MOBILE) as page:
        heading(page, "Receipts")
        fill(page.get_by_role("textbox", name="Month"), receipt["paidDate"][:7])
        page.get_by_role("textbox", name="Month").press("Enter")
        frame = page.get_by_role("region", name="Receipts table")
        see(page, frame)
        table = frame.get_by_role("table", name="Receipts")
        see(page, table)
        nxt = page.get_by_role("button", name="Next page")
        assert fixed_bottom(nxt)
        paid = date.fromisoformat(receipt["paidDate"])
        see(page, table, f"{paid:%b} {paid.year}")
        for _ in range(PAGE_LIMIT):
            if table.get_by_text(receipt["number"], exact=True).count():
                break
            shown = table.inner_text()
            eventually(page, lambda: expect(nxt.first).to_be_enabled(timeout=EXPECT_MS),
                       f"Next page is enabled while {receipt['number']} is still ahead (L729)")
            tap(nxt.first)

            def turned():
                assert table.inner_text() != shown, "the page has not changed yet"
            eventually(page, turned, "Next page shows the next receipts (L208)")
        see(page, table, receipt["number"])
        frame.focus()
        assert frame.evaluate(IS_FOCUS_JS)
        layout(page)
        axe(page)


def test_wf_records_and_receipts_download_limit(browser):
    short = env_url("APP_SHORT_URL")
    m = new_member(short)
    for i in range(DOWNLOAD_LIMIT):
        ok(m.api.get("/api/me/results-history"), 200, f"download {i + 1}")
    with screen(browser, short, "/me/records", m.api, size=MOBILE) as page:
        tap(page.get_by_role("button", name="Download results history").first)
        say(page, re.compile(r"Too many downloads for now\. You can download again at \d{2}:\d{2} Denver time\."))
        axe(page)
    err(m.api.get("/api/me/results-history"), 429, "rate_limited")


@pytest.mark.timeout(900)
def test_erasure_after_wait(killbill):
    short = env_url("APP_SHORT_URL")
    m = new_member(short)
    draw, _ = released_draw(m, local_today("denver") - timedelta(days=14), [("vitaminD", "22.5")])
    att = ok(send_message(m.api, "/api/me/messages", "a letter", ("a.pdf", pdf_bytes(), "application/pdf")), 201, "attachment")
    receipt = my_receipts(m.api)[0]
    store = S3("-short")
    assert f"members/{m.id}/draws/{draw['id']}/report.pdf" in store.keys(f"members/{m.id}/")
    assert f"members/{m.id}/attachments/{att['message']['attachment']['id']}/original" in store.keys(f"members/{m.id}/")
    acct = kb_account(killbill, m.id)
    cookie = m.api.cookies()
    asked = datetime.now(timezone.utc)
    closing = ok(m.api.post("/api/me/closure"), 200, "close")["member"]
    assert closing["accountState"] == "closing"
    assert abs((parse_iso(closing["erasesAt"]) - asked).total_seconds() - CLOSURE_WAIT_SHORT_S) <= CLOCK_SLACK_S
    err(m.api.patch("/api/me", {"phone": PHONE}), 409, "account_closing", CLOSING_COPY)
    assert killbill.subscriptions(acct["accountId"])[0].get("billingEndDate"), "closing cancels Plus at the end of term (L736)"
    states = []

    def erased():
        st = m.owner.get(f"/api/members/{m.id}").json()["member"]["accountState"]
        states.append(st)
        return st == "erased" or None
    poll(erased, (CLOSURE_WAIT_SHORT_S + ERASE_GRACE_S) * 4, "the member reaches Erased after the wait (L743)")
    assert set(states) <= {"closing", "erasing", "erased"}, states
    assert store.keys(f"members/{m.id}/") == [], "every MinIO object is deleted before Erased (L743)"
    view = m.owner.get(f"/api/members/{m.id}").json()["member"]
    assert view["name"] == "Erased member"
    for field in ("email", "phone", "dateOfBirth", "address", "gateNotes"):
        assert view[field] is None, (field, view)
    err(Api(short, cookies=cookie).get("/api/session"), 401, "session_ended")
    err(Api(short).post("/api/session", {"email": m.email, "password": MEMBER_PASS}), 401, "sign_in_failed", SIGNIN_COPY)
    err(m.owner.get(f"/api/draws?memberId={m.id}"), 404, "not_found")
    err(m.owner.get(f"/api/members/{m.id}/results"), 404, "not_found")
    kept = ok(m.owner.get(f"/api/receipts/{receipt['id']}"), 200, "receipt")["receipt"]
    assert kept["memberName"] == "Erased member" and kept["amountCents"] == receipt["amountCents"]
    kb = killbill.account_by_key(m.id)
    assert kb["name"] == "Erased member" and not kb.get("email"), kb
    pg = Postgres("_short")
    for table in pg.tables():
        quoted = ".".join('"' + part.replace('"', '""') + '"' for part in table.split("."))
        n = pg.rows(f"SELECT count(*) AS n FROM {quoted} AS x WHERE position('{m.email.lower()}' in lower(x::text)) > 0")[0]["n"]
        assert n == 0, f"table {table} still holds the erased member's email (L739)"
    err(m.owner.post(f"/api/members/{m.id}/restore"), 409, "erasure_started", "This account is already being erased.")


def test_restore_exact(app_url, killbill):
    m = new_member(app_url)
    released_draw(m, local_today("denver") - timedelta(days=18), [("vitaminD", "22.5")])
    priya = signin(app_url, PRIYA)
    ok(priya.post(f"/api/members/{m.id}/blends", {"items": EXAMPLE_BLEND}), 201, "blend")
    d = ok(priya.post(f"/api/members/{m.id}/plans", {"basedOnPlanId": None, "sections": PLAN_A}), 201, "draft")["plan"]
    ok(priya.post(f"/api/longevity-plans/{d['id']}/publish"), 200, "publish")
    ok(send_message(m.api, "/api/me/messages", "before closing"), 201, "message")

    def snapshot():
        member = m.owner.get(f"/api/members/{m.id}").json()["member"]
        return {"member": {k: v for k, v in member.items() if k not in ("accountState", "erasesAt")},
                "draws": m.owner.get(f"/api/draws?memberId={m.id}").json(),
                "results": m.owner.get(f"/api/members/{m.id}/results").json(),
                "plans": priya.get(f"/api/members/{m.id}/plans").json(),
                "blends": priya.get(f"/api/members/{m.id}/blends").json(),
                "messages": m.owner.get(f"/api/members/{m.id}/messages").json(),
                "me": m.api.get("/api/me/membership").json()}
    before = snapshot()
    acct = kb_account(killbill, m.id)
    ok(m.api.post("/api/me/closure"), 200, "close")
    err(m.api.post("/api/me/closure"), 409, "account_closing")
    err(send_message(m.api, "/api/me/messages", "while closing"), 409, "account_closing", CLOSING_COPY)
    err(signin(app_url, DANA).post(f"/api/members/{m.id}/restore"), 403, "forbidden")
    back = ok(m.owner.post(f"/api/members/{m.id}/restore"), 200, "restore")["member"]
    assert back["accountState"] == "active"
    assert snapshot() == before, "the account comes back exactly as it was (L737)"
    assert not killbill.subscriptions(acct["accountId"])[0].get("billingEndDate"), "the end-of-term cancel is undone in Kill Bill (L758)"
    err(m.owner.post(f"/api/members/{m.id}/restore"), 409, "not_closing", "This account isn't closing.")


def test_wf_closing_an_account_close_and_restore(browser, app_url):
    m = new_member(app_url)
    with screen(browser, app_url, "/me/account", m.api, size=MOBILE, clock_hours=6) as page:
        heading(page, "Your account")
        zip_code = page.get_by_role("textbox", name="ZIP code")
        fill(zip_code, "12")
        tap(page.get_by_role("button", name="Save profile").first)
        problems_rule(page, "Enter a 5-digit ZIP code.", zip_code)
        tap(page.get_by_role("button", name="Close account"))
        dialog = page.get_by_role("dialog", name="Close account")
        see(page, dialog)
        axe(page)
        closing = dialog.get_by_role("button", name="Yes, close my account")
        pending_shown(page, "**/api/me/closure", closing, lambda: tap(closing))
        member = poll(lambda: (lambda x: x if x["accountState"] == "closing" else None)(m.api.get("/api/me").json()["member"]),
                      UI_WAIT_S, "the closing request is recorded")
        erases = parse_iso(member["erasesAt"])
        copy = (f"Your account is closing. It will be erased at {fmt_date(erases.astimezone(ZONES['denver']).date())}, "
                f"{hhmm(erases, 'denver')} Denver time unless the practice brings it back.")
        at_url(page, re.escape("/me/account") + r"$")
        say(page, copy)
        closed_focus(page, page.get_by_role("button", name="Close account"), "after Yes, close my account")
        page.reload()
        see(page, page.locator("body"), copy)
        layout(page)
    with screen(browser, app_url, f"/staff/members/{m.id}", m.owner) as page:
        see(page, page.locator("body"), "Closing")
        restore = page.get_by_role("button", name="Bring back account")
        tab_to(page, restore)
        page.keyboard.press("Enter")
        say(page, f"{MEMBER_NAME}'s account is back.")
        see(page, page.locator("body"), "Active")
        axe(page)
    assert m.owner.get(f"/api/members/{m.id}").json()["member"]["accountState"] == "active"
    other = new_member(app_url)
    screen_rules(browser, app_url, "/me/account", other.api, opener=("button", "Change password"), dialog="Change password", typed=("label", "Current password"))
    api_rules(app_url, "/api/me/closure", signin(app_url, DANA), reads=[(other.api, "/api/me"), (other.api, "/api/session")])
    cookie_rules(app_url, other.email, MEMBER_PASS)


def test_wf_closing_an_account_keep(browser, app_url):
    m = new_member(app_url)
    with screen(browser, app_url, "/me/account", m.api) as page:
        opener = page.get_by_role("button", name="Close account")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Close account")
        see(page, dialog)
        focus_in(page, dialog, "opening moves focus into the dialog (L244)")
        for _ in range(TAB_LIMIT // 8):
            page.keyboard.press("Tab")
            assert dialog.evaluate(HAS_FOCUS_JS), "Tab stays inside the dialog (SR8)"
        page.keyboard.press("Escape")
        gone(page, dialog, "Escape closes the dialog")
        focus_in(page, opener, "focus returns to Close account (SR2)")
        page.keyboard.press("Enter")
        dialog.get_by_role("button", name="Keep my account").focus()
        page.keyboard.press("Enter")
        gone(page, dialog, "Keep my account closes the dialog")
    assert m.api.get("/api/me").json()["member"]["accountState"] == "active"


def layout_once_drawn(page) -> None:
    def walk() -> None:
        try:
            layout(page)
        except PlaywrightError as e:
            raise AssertionError(str(e)) from None
    eventually(page, walk, "every button stays inside the viewport", PRESS_WAIT_S)


@pytest.mark.timeout(2400)
def test_wf_cross_cutting_routes(browser, app_url):
    m = new_member(app_url)
    owner = m.owner
    public = [("/", "Ocotillo Longevity Club", ("link", "See plans")), ("/plans", "Plans", ("button", "Join Plus")),
              ("/markers", "Marker catalog", ("link", "See plans")), ("/join", "Create your free account", ("button", "Create account")),
              ("/signin", "Sign in", ("button", "Sign in"))]
    member = [("/me", f"Welcome, {FIRST_NAME}", ("link", "Book a draw")), ("/me/membership", "Membership", ("button", "Change cadence")),
              ("/me/draws", "Your draws", ("button", "Book a draw")), ("/me/results", "Your results", ("link", "Message your care team")),
              ("/me/plan", "Your longevity plan", ("link", "Message your care team")), ("/me/messages", "Messages", ("button", "Send message")),
              ("/me/records", "Records and receipts", ("button", "Download results history")), ("/me/account", "Your account", ("button", "Save profile"))]
    rec = f"/staff/members/{m.id}"
    staff = [("/staff/members", "Members", ("button", "Add member")), (rec, MEMBER_NAME, ("button", "Book draw")),
             (rec + "/results", f"Results for {MEMBER_NAME}", ("link", "Back to member")),
             (rec + "/plan", f"Plan for {MEMBER_NAME}", ("button", "Edit plan")),
             (rec + "/blend", f"Blend for {MEMBER_NAME}", ("button", "Save blend")),
             (rec + "/messages", f"Messages with {MEMBER_NAME}", ("button", "Send reply")),
             ("/staff/messages", "Care messages", None), ("/staff/calendar", "Draw calendar", ("button", "Book draw")),
             ("/staff/results", "Results to release", None), ("/staff/ranges", "Range table", ("button", "Change ranges")),
             ("/staff/receipts", "Receipts", ("button", "Next page")), ("/staff/team", "Team", ("button", "Add staff member"))]
    for api, routes in ((None, public), (m.api, member), (owner, staff)):
        with screen(browser, app_url, "/api/health", api) as page:
            for path, title, action in routes:
                page.goto(app_url + path)
                for size in VIEWPORTS:
                    page.set_viewport_size(size)
                    page.reload()
                    see(page, h1(page), title)
                    settle(page.locator("body"))
                    layout_once_drawn(page)
                    if size in (MOBILE, DESKTOP):
                        axe(page)
                    if size == MOBILE and action:
                        assert fixed_bottom(page.get_by_role(action[0], name=action[1], exact=True)), f"{path}: {action} fixed to the bottom (SR6)"
                    if size == MOBILE:
                        loaded(page)
                        small = page.evaluate(SMALL_JS)
                        assert small == [], f"SR4: controls under 44x44 CSS px at 375x812 on {path} (L265): {small[:8]}"
    with screen(browser, app_url, rec, owner) as page:
        see(page, h1(page), MEMBER_NAME)
        page.reload()
        see(page, h1(page), MEMBER_NAME)
    with screen(browser, app_url, "/api/health") as page:
        resp = page.goto(app_url + "/no-such-page")
        assert resp.status == 404
        see(page, h1(page), NOT_FOUND_COPY)
        expect(page.get_by_role("link", name="Go to the home page")).to_be_visible()
        axe(page)


def test_api_conventions(app_url):
    anon = Api(app_url)
    err(anon.get("/api/no-such-route"), 404, "not_found")
    r = anon.delete("/api/plans")
    err(r, 405, "method_not_allowed")
    assert "GET" in r.headers.get("Allow", ""), "405 carries an Allow header (L392)"
    big = b'{"pad":"' + b"a" * (JSON_LIMIT + 1 - 10) + b'"}'
    assert len(big) == JSON_LIMIT + 1
    err(anon.c.post("/api/members", content=big, headers={"Content-Type": "application/json"}), 413, "too_large", TOO_LARGE_COPY)
    edge = b'{"pad":"' + b"a" * (JSON_LIMIT - 10) + b'"}'
    assert len(edge) == JSON_LIMIT
    err(anon.c.post("/api/members", content=edge, headers={"Content-Type": "application/json"}), 401, "not_signed_in")
    err(anon.get("/api/me"), 401, "not_signed_in")
    owner = signin(app_url, OWNER)
    err(owner.c.post("/api/members", content=b"name=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    err(owner.c.post("/api/members", content=b"{not json", headers={"Content-Type": "application/json"}), 400, "bad_request")
    elena = signin(app_url, ELENA, MEMBER_PASS)
    err(elena.get("/api/members/no-such-member"), 404, "not_found")
    seeded = next(x for x in owner.get("/api/members").json()["members"] if x["name"] == "Marcus Bell")
    err(elena.get(f"/api/members/{seeded['id']}"), 403, "forbidden")
    err(signin(app_url, DANA).post("/api/draws", {"memberId": "no-such-member", "phlebotomistId": "x", "date": "2027-03-15", "time": "07:00"}),
        404, "not_found")
    a, b = new_member(app_url), new_member(app_url)
    luis = phlebotomists(a.owner)["Luis Carrillo"]["id"]
    d, s = free_slot(a.api, a.id, {luis}, workday(local_today("denver") + timedelta(days=22)), me=True)
    draw = ok(a.api.post("/api/me/draws", {"phlebotomistId": luis, "date": str(d), "time": s["localTime"]}), 201, "member books")["draw"]
    err(b.api.patch(f"/api/me/draws/{draw['id']}", {"date": str(d), "time": s["localTime"]}), 404, "not_found")
    err(b.api.post(f"/api/me/draws/{draw['id']}/cancel"), 404, "not_found")
    err(owner.post("/api/staff", {"name": "", "email": "x", "password": "y", "role": "owner"}), 422, "invalid")
    for body in (httpx.get(app_url + "/api/plans").json(), elena.get("/api/session").json(), elena.get("/api/me").json(),
                 elena.get("/api/me/results").json(), owner.get(f"/api/draws/{draw['id']}").json(), owner.get("/api/range-changes").json()):
        assert walk_keys(body) == [], walk_keys(body)
    r1 = anon.post("/api/session", {"email": fresh_email("nobody"), "password": STAFF_PASS})
    r2 = anon.post("/api/session", {"email": DANA, "password": MEMBER_PASS})
    err(r1, 401, "sign_in_failed", SIGNIN_COPY)
    err(r2, 401, "sign_in_failed", SIGNIN_COPY)
    assert r1.json() == r2.json(), "unknown email and wrong password answer identically (L434)"
    dana = signin(app_url, DANA)
    who = ok(dana.get("/api/session"), 200, "GET /api/session")
    assert who["user"]["name"] == "Dana Ruiz" and who["user"]["role"] == "coordinator" and who["home"] == "/staff/calendar"
    parse_iso(who["expiresAt"])
    ended = dana.cookies()
    assert dana.delete("/api/session").status_code == 204
    err(Api(app_url, cookies=ended).get("/api/session"), 401, "session_ended")
    email = fresh_email("staff")
    body = {"name": "Rae Kim", "email": email, "password": "starting-pass-1", "role": "coordinator"}
    staff = ok(owner.post("/api/staff", body), 201, "POST /api/staff")["staff"]
    assert set(staff) == {"id", "name", "email", "role"}, staff
    err(owner.post("/api/staff", body), 409, "email_taken", "An account with this email already exists.")
    me = next(s["id"] for s in owner.get("/api/staff").json()["staff"] if s["email"] == OWNER)
    err(owner.patch(f"/api/staff/{me}", {"role": "coordinator"}), 409, "owner_stays", "The practice owner stays the owner.")
    err(owner.delete(f"/api/staff/{me}"), 409, "owner_stays", "The practice owner stays the owner.")
    old = signin(app_url, email, "starting-pass-1").cookies()
    assert owner.delete(f"/api/staff/{staff['id']}").status_code == 204
    err(Api(app_url, cookies=old).get("/api/session"), 401, "session_ended")
    err(owner.get(f"/api/staff/{staff['id']}"), 404, "not_found")
    for who_email, pw in ((PRIYA, STAFF_PASS), (ELENA, MEMBER_PASS)):
        err(signin(app_url, who_email, pw).get(f"/api/staff/{unknown_like(staff['id'])}"), 404, "not_found")


def test_sessions(app_url):
    cookie_rules(app_url, DANA, STAFF_PASS)
    owner = signin(app_url, OWNER)
    email = fresh_email("staff")
    ok(owner.post("/api/staff", {"name": "Rae Kim", "email": email, "password": "starting-pass-1", "role": "coordinator"}), 201, "staff")
    a, b = signin(app_url, email, "starting-pass-1"), signin(app_url, email, "starting-pass-1")
    field_err(a.post("/api/me/password", {"currentPassword": "wrong-password-x", "newPassword": "a-new-long-pass"}),
              "currentPassword", "That password isn't right.")
    field_err(a.post("/api/me/password", {"currentPassword": "starting-pass-1", "newPassword": "short"}),
              "newPassword", "Use at least 12 characters.")
    ok(b.get("/api/session"), 200, "refused changes end nothing")
    assert a.post("/api/me/password", {"currentPassword": "starting-pass-1", "newPassword": "a-new-long-pass"}).status_code == 204
    err(b.get("/api/session"), 401, "session_ended")
    ok(a.get("/api/session"), 200, "this session stays")
    err(Api(app_url).post("/api/session", {"email": email, "password": "starting-pass-1"}), 401, "sign_in_failed")
    signin(app_url, email, "a-new-long-pass")


@pytest.mark.timeout(600)
def test_session_expiry():
    base = env_url("APP_SESSION_URL")
    started = datetime.now(timezone.utc)
    api = signin(base, DANA)
    s = ok(api.get("/api/session"), 200, "session")
    assert abs((parse_iso(s["expiresAt"]) - started).total_seconds() - SESSION_SHORT_S) <= CLOCK_SLACK_S

    def ended():
        r = api.get("/api/session")
        if r.status_code == 200:
            return None
        err(r, 401, "session_ended")
        return datetime.now(timezone.utc)
    at = poll(ended, SESSION_SHORT_S * 4, "the session ends after SESSION_SECONDS (L748)")
    assert (at - started).total_seconds() >= SESSION_SHORT_S - CLOCK_SLACK_S


def test_wf_cross_cutting_session_ended(browser, app_url):
    m = new_member(app_url)
    path = f"/staff/members/{m.id}/plan"
    with screen(browser, app_url, path, signin(app_url, PRIYA)) as page:
        click(page.get_by_role("button", name="Edit plan").first)
        dialog = page.get_by_role("dialog", name="Edit plan")
        nutrition = dialog.get_by_role("textbox", name="Nutrition")
        fill(nutrition, TYPED_SESSION)
        jar = {c["name"]: c["value"] for c in page.context.cookies()}
        assert Api(app_url, cookies=jar).delete("/api/session").status_code == 204
        click(dialog.get_by_role("button", name="Save draft"))
        say(page, SESSION_ENDED_COPY)
        expect(dialog).to_be_visible()
        expect(nutrition).to_have_value(TYPED_SESSION)
        click(dialog.get_by_role("link", name="Sign in again"))
        at_url(page, r"/signin")
        fill(page.get_by_role("textbox", name="Email"), PRIYA)
        fill(page.get_by_label("Password", exact=True), STAFF_PASS)
        click(page.get_by_role("button", name="Sign in", exact=True))
        at_url(page, re.escape(path) + r"$")
        dialog = page.get_by_role("dialog", name="Edit plan")
        see(page, dialog)
        eventually(page, lambda: expect(dialog.get_by_role("textbox", name="Nutrition")).to_have_value(
            TYPED_SESSION, timeout=EXPECT_MS), "the typed text is refilled (L256)")


def test_starting_data(app_url, killbill):
    owner = signin(app_url, OWNER)
    staff = {s["email"]: s for s in owner.get("/api/staff").json()["staff"]}
    for email, name, role in ((OWNER, "Maya Okafor", "owner"), (PRIYA, "Priya Shah", "specialist"), (THEO, "Theo Lindqvist", "specialist"),
                              (DANA, "Dana Ruiz", "coordinator"), (SAM, "Sam Whitfield", "coordinator"), (JORDAN, "Jordan Pell", "billingLead")):
        assert staff[email]["name"] == name and staff[email]["role"] == role
    ps = phlebotomists(owner)
    assert set(ps) == set(PHLEB_STATES) and all(sorted(ps[n]["states"]) == sorted(PHLEB_STATES[n]) for n in ps)
    ings = owner.get("/api/ingredients").json()["ingredients"]
    assert {i["id"]: i["priceCentsPerCapsule"] for i in ings} == ING_PRICE
    members = {x["email"]: x for x in owner.get("/api/members").json()["members"]}
    elena = members[ELENA]
    assert elena["name"] == "Elena Marsh" and elena["dateOfBirth"] == "1987-03-02" and elena["phone"] == "+1 303 555 0142"
    assert elena["address"] == {"line1": "1450 Larimer St", "line2": "Apt 6B", "city": "Denver", "postalCode": "80202"}
    assert elena["gateNotes"] == "Buzz 6B; the lobby door sticks." and elena["membership"]["cadence"] == "sixMonths"
    owen = members["owen.pryce@example.com"]
    assert owen["gateNotes"] is None and owen["membership"]["state"] == "free" and owen["timeZone"] == "phoenix"
    assert members["rosa.delgado@example.com"]["address"]["line2"] == ""
    res = results_of(owner, elena["id"])
    assert [d["flag"] for d in res["ldl"]["draws"]] == ["inRange", "inRange", "aboveRange"]
    assert [d["value"] for d in res["vitaminD"]["draws"]] == ["22.5", "31.5", "44.0"]
    assert res["vitaminD"]["draws"][2]["note"] == "Keep the morning D3 with breakfast."
    assert [d["value"] for d in res["hsCrp"]["draws"]] == ["1.40", "0.90", "0.60"]
    marcus = members["marcus.bell@example.com"]
    assert [d["value"] for d in results_of(owner, marcus["id"])["testosterone"]["draws"]] == ["520"]
    plans = signin(app_url, PRIYA).get(f"/api/members/{elena['id']}/plans").json()["plans"]
    assert len(plans) == 1 and plans[0]["publishedAt"] == "2026-09-21T16:30:00Z" and plans[0]["publishedBy"] == "Priya Shah"
    assert plans[0]["sections"] == PLAN_B
    blend = plans[0]["blend"]
    assert (blend["morningCapsules"], blend["eveningCapsules"], blend["listPriceCents"], blend["memberPriceCents"]) == (3, 4, 2970, 2525)
    msgs = [x["body"] for x in owner.get(f"/api/members/{elena['id']}/messages").json()["messages"]]
    assert msgs == ["Could we move my spring draw a little earlier?", "Yes — I'll offer you 06:20 next time."]
    changes = owner.get("/api/range-changes").json()["changes"]
    assert any(c["marker"] == "ldl" and c["effectiveFrom"] == "2026-07-01" and c["createdBy"] == "Maya Okafor" for c in changes)
    old_ldl = owner.get("/api/ranges", params={"marker": "ldl", "on": str(LDL_CHANGE - timedelta(days=1))}).json()
    assert old_ldl["effectiveFrom"] == "2020-01-01" and old_ldl["ranges"][0]["high"] == "129"
    for email, number, cents in ((ELENA, "OLC-000001", 74995), ("marcus.bell@example.com", "OLC-000002", 127492),
                                 ("rosa.delgado@example.com", "OLC-000003", 74995), ("hana.sato@example.com", "OLC-000004", 127492)):
        member_api = signin(app_url, email, MEMBER_PASS)
        poll(lambda: any(r["number"] == number and r["amountCents"] == cents for r in member_api.get("/api/me/receipts").json()["receipts"]) or None,
             KB_WAIT_S * 2, f"{email} holds the seeded receipt {number} (L816)")
    ids = {}
    for var in ("APP_SPARE_URL", "APP_SHORT_URL", "APP_SESSION_URL", "APP_MINIO_DOWN_URL", "APP_KILLBILL_DOWN_URL"):
        base = env_url(var)
        assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
        found = [x for x in signin(base, OWNER).get("/api/members").json()["members"] if x["email"] == ELENA]
        assert len(found) == 1, f"{var} holds the seeded member once"
        ids[var] = found[0]["id"]
    ids["main"] = elena["id"]
    assert len(set(ids.values())) == len(ids), f"ids are generated afresh in each copy (L386): {ids}"
    main_acct, spare_acct = kb_account(killbill, ids["main"]), kb_account(killbill, ids["APP_SPARE_URL"])
    assert main_acct["accountId"] != spare_acct["accountId"], "each copy keeps its own Kill Bill accounts"


SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "out", "coverage"}
TEST_DIRS = {"test", "tests", "__tests__", "fixtures", "e2e"}


def app_files(skip=SKIP_DIRS):
    for root, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in skip]
        for f in files:
            yield Path(root) / f


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"


def test_if_permissive_licences():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "Unlicense"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence or "", allowed)]
    assert not bad, f"non-permissive licences: {bad[:20]}"


def test_if_fonts_shipped():
    font_types = {".woff2", ".woff", ".ttf", ".otf"}
    everywhere = []
    for top in (APP, Path(DEPLOYED_APP)):
        if top.exists():
            for root, dirs, files_here in os.walk(top):
                dirs[:] = [d for d in dirs if d not in {"node_modules", ".git"}]
                everywhere += [Path(root) / n for n in files_here]
    fonts = [p for p in everywhere if p.suffix.lower() in font_types]
    declared = ""
    for p in everywhere:
        if p.name == "package.json":
            manifest = json.loads(p.read_text())
            declared += " ".join([*manifest.get("dependencies", {}), *manifest.get("devDependencies", {})]).lower() + " "
    names = [p.name.lower() for p in fonts]
    for font in ("Fraunces", "Figtree"):
        assert any(font.lower() in n for n in names) or font.lower() in declared, (font, names)
    licence = re.compile(r"sil open font licen[cs]e|(?<![a-z])ofl(?![a-z])", re.I)
    notices = [p for p in everywhere if p.suffix.lower() not in font_types and re.search(r"ofl|licen[cs]e|notices", p.name, re.I)]
    assert any(licence.search(p.read_text(errors="ignore")) for p in notices), f"the fonts ship with their SIL Open Font License notice (L985): {notices[:8]}"
    assert not any(n.startswith("inter") for n in names), names
    for sheet in [p for p in everywhere if p.suffix.lower() in {".css", ".html"}]:
        body = re.sub(r"/\*.*?\*/|<!--.*?-->", "", sheet.read_text(errors="ignore"), flags=re.S)
        assert not re.search(r"font-family\s*:[^;}]*(?<![A-Za-z])Inter(?![A-Za-z])", body), f"{sheet} declares the Inter font (L985)"
        assert not re.search(r"@font-face\s*\{[^}]*url\(\s*[\"']?(?:https?:)?//", body), f"{sheet} loads a font from another origin (L985)"
        assert not re.search(r"@import[^;]*(?:https?:)?//fonts\.|<link[^>]*href\s*=\s*[\"']?(?:https?:)?//fonts\.", body), f"{sheet} loads a font from another origin (L985)"


def test_if_only_postgres_and_minio():
    stores = [p for p in app_files({"node_modules", ".git"}) if p.suffix.lower() in {".sqlite", ".sqlite3", ".db", ".ldb"}]
    assert not stores, stores
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "mongodb", "mongoose", "lowdb", "nedb", "level",
              "leveldown", "pouchdb", "lokijs", "@libsql/client", "sql.js"}
    shipped = {p.name for p in shipped_packages()}
    assert not shipped & banned, shipped & banned


def test_if_no_credentials_in_source():
    secrets = []
    for name in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY"):
        v = os.environ.get(name, "")
        if len(v) >= 6 and not re.fullmatch(r"[a-z]+", v):
            secrets.append((name, v))
    hits = []
    for p in app_files():
        if p.name.startswith(".env") or p.stat().st_size > 2_000_000:
            continue
        try:
            body = p.read_text(errors="ignore")
        except OSError:
            continue
        hits += [(str(p), n) for n, v in secrets if v in body]
    assert not hits, hits


def test_if_typescript_source():
    js = [p for p in app_files() if p.suffix in {".js", ".jsx", ".mjs", ".cjs"}
          and ".config." not in p.name and not re.search(r"rc\.(c|m)?js$", p.name)]
    assert not js, js[:20]


def test_if_no_raster_images():
    raster = [p for p in app_files({"node_modules", ".git"} | TEST_DIRS)
              if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".tif", ".tiff"}]
    assert not raster, raster[:20]
