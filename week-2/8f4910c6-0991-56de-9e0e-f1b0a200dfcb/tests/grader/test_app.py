from __future__ import annotations

import contextlib
import csv
import hashlib
import io
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    KillBill,
    Mailpit,
    addresses,
    axe,
    held,
    layout,
    same_origin,
    select,
    tab_order,
    tap as kit_tap,
    text,
    unique,
)


PASSWORD = "Rungboard-2027"
NEW_PASSWORD = "Fresh-Rungboard-2027"
WRONG_PASSWORD = "Not-the-password-27"

DIRECTOR = "director@vesperrowe.example"
PRIYA = "priya.shah@vesperrowe.example"
JONAH = "jonah.ellis@vesperrowe.example"
ROSA = "rosa.delgado@vesperrowe.example"
THEO = "theo.marchand@vesperrowe.example"
INES = "ines-okoro@talent.vesperrowe.example"
CALLUM = "callum-reid@talent.vesperrowe.example"
PRIYA_NAME = "Priya Shah"
JONAH_NAME = "Jonah Ellis"
ROSA_NAME = "Rosa Delgado"
THEO_NAME = "Theo Marchand"

HOMES = {
    DIRECTOR: "/workspace/overview",
    PRIYA: "/workspace/board",
    ROSA: "/workspace/licences",
    THEO: "/workspace/applications",
    INES: "/workspace/me",
}

TORONTO_DESK = "toronto-desk@vesperrowe.example"
ZONES = {"toronto": "America/Toronto", "vancouver": "America/Vancouver"}
CITIES = {"toronto": "Toronto", "vancouver": "Vancouver"}
PUBLISHED_CLOSURES = {
    "toronto": {
        "2026-01-01", "2026-02-16", "2026-04-03", "2026-05-18", "2026-07-01", "2026-08-03", "2026-09-07",
        "2026-10-12", "2026-12-25", "2026-12-28", "2027-01-01", "2027-02-15", "2027-03-26", "2027-05-24",
        "2027-07-01", "2027-08-02", "2027-09-06", "2027-10-11", "2027-12-27", "2027-12-28",
    },
    "vancouver": {
        "2026-01-01", "2026-02-16", "2026-04-03", "2026-05-18", "2026-07-01", "2026-08-03", "2026-09-07",
        "2026-09-30", "2026-10-12", "2026-11-11", "2026-12-25", "2027-01-01", "2027-02-15", "2027-03-26",
        "2027-05-24", "2027-07-01", "2027-08-02", "2027-09-06", "2027-09-30", "2027-10-11", "2027-11-11",
        "2027-12-27",
    },
}

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}
VIEWPORT_CASES = ["phone", "tablet", "desktop"]

SHORT_MS = 140
MIDDLE_MS = 300
LONG_MS = 560
DURATIONS = (SHORT_MS, MIDDLE_MS, LONG_MS)
STRIP_DAYS = 14
PAGE_SIZE = 6
CAST_LIMIT = 5
APPLICATION_LIMIT = 3
RATE_WINDOW_SECONDS = 60
SWEEP_SECONDS = 10
JSON_LIMIT = 1_000_000
APP_PHOTO_LIMIT = 8_000_000
PORTFOLIO_LIMIT = 12_000_000
ROSTER_LIMIT = 2_000_000
BIO_LIMIT = 600
MAX_SIDE = 2400
FEED_TOKEN_MIN = 32
ICS_LINE_OCTETS = 75
OVERTIME_MAX = 600
LAST_JOB_DAY = date(2027, 12, 31)
EXPIRING_WINDOW_DAYS = 30
WEEK = 7

IMPORT_HEADER = "Email,First Name,Last Name,Date of Birth,Office,Division,Height,Chest,Waist,Hips,Instagram,TikTok,YouTube"
CSV_COLUMNS = ["Date", "Type", "Reference", "Client", "Description", "Amount (CAD)", "Balance (CAD)"]
FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")
ERASED = "Erased talent"

SEED_CARD = {
    "women": {"fullDayCents": 250000, "halfDayCents": 150000, "overtimeQuarterHourCents": 9400},
    "men": {"fullDayCents": 220000, "halfDayCents": 130000, "overtimeQuarterHourCents": 8300},
    "creators": {"fullDayCents": 180000, "halfDayCents": 110000, "overtimeQuarterHourCents": 6800},
    "new_faces": {"fullDayCents": 120000, "halfDayCents": 75000, "overtimeQuarterHourCents": 4500},
}
SEED_USAGE = {"digital": 60000, "print": 80000, "out_of_home": 120000, "broadcast": 200000}
TERRITORY_PCT = {"canada": 100, "north_america": 150, "worldwide": 250}
TERM_PCT = {3: 50, 6: 75, 12: 100}
MEDIA_NAMES = {"digital": "Digital", "print": "Print", "out_of_home": "Out of home", "broadcast": "Broadcast"}
TERRITORY_NAMES = {"canada": "Canada", "north_america": "North America", "worldwide": "Worldwide"}
TAX_LINES = {"toronto": [("HST 13%", 13)], "vancouver": [("GST 5%", 5), ("PST 7%", 7)]}
SERVICE_PERCENT = 20
EXAMPLE_FEES = 355_100
EXAMPLE_SERVICE = 71_020
EXAMPLE_HST = 55_396
EXAMPLE_TOTAL = 481_516

BOARD_OF_DIVISION = {"Women": "women", "Men": "men", "Creators": "creators", "New Faces": "new_faces"}

HTTP_TIMEOUT = 60
POLL_SECONDS = 0.25
MAIL_SETTLE = 1
MAIL_DEADLINE = 45
QUIET_SECONDS = 13
SLACK_SECONDS = 5
BOOT_SECONDS = 240
TAB_LIMIT = 80
SHORT_TTL = "6"
SESSION_TTL = "10"
LATE_CARD_FROM = date(2027, 12, 1)
GENERIC_DAY = date(2027, 9, 15)
SECOND_DAY = date(2027, 9, 16)

expect.set_options(timeout=15_000)

BAD_EMAIL = "not-an-email"
INJECTED_HEADER = "X-Injected"
UNKNOWN_OPTION = "unknown-option"
TYPED_ADVANCE = "12.00"
STATEMENT_ADVANCE = "125.50"
NOTE_PROBE = "Travel"
SECOND_TITLE = "Second try"
KEPT_TITLE = "Kept title"
KEYBOARD_NOTE = "Keyboard note"
UNSAVED_NOTE = "Unsaved note"
BAD_HEADER_CSV = b"Email,Name\r\nx@example.test,X\r\n"
FORBIDDEN_PROCESSES = ("redis-server", "sqlite")
SUBPIXEL = 0.5
MIN_TARGET_PX = 44
UI_WAIT = 15
SETTLE_MS = 500
STREAM_MS = 5000

CHIPS_JS = """(root) => [...root.querySelectorAll('[data-rank]')].map((c) => ({
  rank: c.getAttribute('data-rank'), state: c.getAttribute('data-state'),
  text: (c.innerText || c.textContent || '').replace(/\\s+/g, ' ').trim() }))"""


def required_copy(label: str) -> str:
    return f"Enter {label.lower()}."


def image_width(data: bytes) -> int:
    from PIL import Image

    return Image.open(io.BytesIO(data)).size[0]


def expect_chip(scope: Any, company: str, **want: str) -> None:
    def match() -> bool:
        found = [c for c in scope.evaluate(CHIPS_JS) if company in c["text"]]
        return bool(found) and all(found[0][k] == v for k, v in want.items())

    eventually(match, UI_WAIT, f"chip for {company} never showed {want}")

MOTION_JS = r"""
(() => {
  if (window.__motion) return;
  window.__motion = [];
  const seen = new WeakSet();
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const parts = (s, comma) => {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth === 0 && (comma ? ch === ',' : /\s/.test(ch))) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const len = (v, size) => {
    let total = 0;
    for (const [, sign, num, unit] of v.matchAll(/([+-]?)\s*(\d*\.?\d+(?:e[+-]?\d+)?)(px|%)?/gi))
      total += (sign === '-' ? -1 : 1) * parseFloat(num) * (unit === '%' ? size / 100 : 1);
    return total;
  };
  const edges = (el) => {
    const r = el.getBoundingClientRect(), clip = (getComputedStyle(el).clipPath || 'none').trim();
    const tall = el.offsetHeight || r.height, sy = tall ? r.height / tall : 1;
    const shape = /^(inset|polygon)\((.*)\)$/.exec(clip);
    if (!shape) return { top: r.top, bottom: r.bottom };
    if (shape[1] === 'inset') {
      const v = parts(shape[2].split(/\sround\s/)[0], false);
      const top = Math.min(r.top + len(v[0], tall) * sy, r.bottom);
      return { top, bottom: Math.max(r.bottom - len(v.length > 2 ? v[2] : v[0], tall) * sy, top) };
    }
    const ys = parts(shape[2], true).map((p) => parts(p, false)).filter((p) => p.length === 2)
      .map((p) => r.top + len(p[1], tall) * sy);
    return ys.length ? { top: Math.min(...ys), bottom: Math.max(...ys) } : { top: r.top, bottom: r.bottom };
  };
  const declared = (a) => {
    const el = a.effect && a.effect.target;
    if (!a.transitionProperty || !el) return null;
    const s = getComputedStyle(el, a.effect.pseudoElement || null);
    const props = s.transitionProperty.split(',').map((p) => p.trim());
    const times = s.transitionDuration.split(',').map((d) => parseFloat(d) * (/ms$/.test(d.trim()) ? 1 : 1000));
    const name = a.transitionProperty, side = name.replace(/^border-(top|right|bottom|left)-/, 'border-');
    let k = -1;
    props.forEach((p, j) => { if (p === 'all' || p === name || p === side || name.startsWith(p + '-')
      || (p === 'inset' && ['top', 'right', 'bottom', 'left'].includes(name))) k = j; });
    return k < 0 ? Math.max(...times) : times[k % times.length];
  };
  const record = (a) => {
    if (!a || seen.has(a)) return;
    seen.add(a);
    const effect = a.effect;
    if (!effect || !effect.getTiming) return;
    const timing = effect.getTiming();
    const computed = effect.getComputedTiming();
    const target = effect.target || null;
    let start = null, end = null, vstart = null, vend = null;
    try {
      if (target && Number.isFinite(computed.endTime) && computed.endTime > 0) {
        const prev = a.currentTime;
        a.currentTime = 0; start = box(target); vstart = edges(target);
        a.currentTime = Math.max(0, computed.endTime - 0.5); end = box(target); vend = edges(target);
        a.currentTime = prev === null ? 0 : prev;
      }
    } catch (e) { start = null; end = null; vstart = null; vend = null; }
    window.__motion.push({
      duration: declared(a) ?? (Number(timing.duration) || 0),
      iterations: timing.iterations === Infinity ? -1 : Number(timing.iterations),
      start, end, vstart, vend,
      chip: !!(target && target.closest && target.closest('[data-rank]')),
    });
  };
  const scan = () => { for (const a of document.getAnimations()) record(a); };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); record(a); return a; };
  document.addEventListener('transitionrun', scan, true);
  document.addEventListener('animationstart', scan, true);
})();
"""

SETTLE_JS = r"""
(() => {
  if (window.__settle) return;
  const s = window.__settle = { open: new Map(), last: performance.now(), next: 0 };
  const begin = () => { const id = ++s.next; s.open.set(id, performance.now()); s.last = performance.now(); return id; };
  const end = (id) => { s.open.delete(id); s.last = performance.now(); };
  const fetch0 = window.fetch;
  window.fetch = function (...args) {
    const id = begin();
    try { return fetch0.apply(window, args).finally(() => end(id)); } catch (e) { end(id); throw e; }
  };
  const send0 = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const id = begin();
    this.addEventListener('loadend', () => end(id), { once: true });
    try { return send0.apply(this, args); } catch (e) { end(id); throw e; }
  };
  new MutationObserver(() => { s.last = performance.now(); })
    .observe(document, { subtree: true, childList: true, characterData: true });
})();
"""

SETTLED_JS = """([quiet, stream]) => {
  const s = window.__settle, now = performance.now();
  return !!s && document.readyState === 'complete' && now - s.last >= quiet
    && ![...s.open.values()].some((t) => now - t < stream);
}"""

REST_JS = """([quiet, stream]) => {
  const s = window.__settle, now = performance.now();
  const moving = document.getAnimations().some((a) => a.playState === 'running'
    && Number.isFinite(a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : Infinity));
  return !!s && document.readyState === 'complete' && now - s.last >= quiet && !moving
    && ![...s.open.values()].some((t) => now - t < stream);
}"""


def ns(prefix: str) -> tuple[str, str]:
    name, email = unique(prefix)
    token = re.sub(r"[^A-Za-z0-9]", "", name)[-12:] or uuid.uuid4().hex[:12]
    if "@" not in email:
        email = f"{token.lower()}@example.test"
    return token, email


def fresh_ip() -> str:
    n = uuid.uuid4().int
    return f"10.{n % 250 + 1}.{(n >> 8) % 250 + 1}.{(n >> 16) % 250 + 1}"


def eventually(fn: Callable[[], Any], seconds: float, message: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        result = fn()
        if result:
            return result
        assert time.monotonic() < deadline, message
        threading.Event().wait(POLL_SECONDS)


def settled(page: Page, what: str) -> None:
    eventually(lambda: page.evaluate(SETTLED_JS, [SETTLE_MS, STREAM_MS]), UI_WAIT, f"{what} never settled")


def at_rest(page: Page, what: str) -> None:
    eventually(lambda: page.evaluate(REST_JS, [SETTLE_MS, STREAM_MS]), UI_WAIT, f"{what} never came to rest")


def http(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)


def sign_in(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    c = http(base)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, f"sign-in {email}: {r.status_code} {r.text[:300]}"
    return c


def ok(r: httpx.Response, status: int) -> Any:
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:600]}"
    return r.json() if r.content else None


def err(r: httpx.Response, status: int, error: str) -> dict[str, Any]:
    body = ok(r, status)
    assert body["error"] == error, body
    return body


def server_now(base: str) -> datetime:
    r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
    if "date" not in r.headers:
        return datetime.now(timezone.utc)
    return parsedate_to_datetime(r.headers["date"]).astimezone(timezone.utc)


def office_today(base: str, office: str) -> date:
    return server_now(base).astimezone(ZoneInfo(ZONES[office])).date()


def parse_z(value: str) -> datetime:
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value), value
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def isoz(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fmt_date(d: date) -> str:
    return f"{d.strftime('%a')} {d.day} {d.strftime('%b')} {d.year}"


def day_label(d: date) -> str:
    return f"{d.strftime('%a')} {d.day} {d.strftime('%b')}"


def fmt_time(moment: datetime, office: str) -> str:
    local = moment.astimezone(ZoneInfo(ZONES[office]))
    return f"{fmt_date(local.date())}, {local.strftime('%H:%M')} {CITIES[office]} time"


def fmt_month(d: date) -> str:
    return f"{d.strftime('%B')} {d.year}"


def day_pattern(iso: str) -> str:
    d = date.fromisoformat(iso)
    mon = d.strftime("%b")
    return rf"\b{d.day} {mon}|\b{mon}[a-z]*\.? {d.day}\b|\b{iso}\b"


def money(cents: int) -> str:
    return f"CAD {cents // 100:,}.{cents % 100:02d}"


def plain_amount(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}{abs(cents) // 100}.{abs(cents) % 100:02d}"


def half_up(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


def compact(n: int) -> str:
    for size, suffix in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
        if n >= size:
            tenths = n * 10 // size
            whole, frac = divmod(tenths, 10)
            return f"{whole}{suffix}" if frac == 0 else f"{whole}.{frac}{suffix}"
    return str(n)


def cm_to_in(cm: int) -> int:
    return half_up(cm * 100, 254)


def in_to_cm(inches: int) -> int:
    return half_up(inches * 254, 100)


def ft_in(cm: int) -> str:
    inches = cm_to_in(cm)
    return f"{inches // 12} ft {inches % 12} in"


def add_months(d: date, months: int) -> date:
    index = d.year * 12 + d.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    last = (nxt - timedelta(days=1)).day
    return date(year, month, min(d.day, last))


def office_closures(base: str, office: str) -> set[str]:
    offices = ok(http(base).get("/api/offices"), 200)["offices"]
    return set(next(o for o in offices if o["id"] == office)["closures"])


def business(d: date, closures: set[str]) -> bool:
    return d.weekday() < 5 and d.isoformat() not in closures


def auto_release(day: date, office: str, closures: set[str]) -> datetime:
    prev = day - timedelta(days=1)
    while not business(prev, closures):
        prev -= timedelta(days=1)
    return datetime(prev.year, prev.month, prev.day, 12, 0, tzinfo=ZoneInfo(ZONES[office])).astimezone(timezone.utc)


def month_end_job_day(base: str, office: str) -> date | None:
    last = add_months(office_today(base, office).replace(day=1), 1) - timedelta(days=1)
    if auto_release(last, office, office_closures(base, office)) > server_now(base) + timedelta(minutes=5):
        return last
    return None


def page_text(page: Page) -> str:
    return " ".join(page.evaluate("() => document.body.innerText").split())


def norm(value: str) -> str:
    return " ".join(value.split())


def mail_to(address: str, subject: str | None = None) -> Callable[[dict[str, Any]], bool]:
    def match(m: dict[str, Any]) -> bool:
        if address.lower() not in {a.lower() for a in addresses(m.get("To"))}:
            return False
        return subject is None or m.get("Subject") == subject
    return match


def await_mail(mail: Mailpit, pred: Callable[[dict[str, Any]], bool], count: int = 1) -> list[dict[str, Any]]:
    deadline = time.monotonic() + MAIL_DEADLINE
    while True:
        found = [m for m in mail.messages(settle=MAIL_SETTLE) if pred(m)]
        if len(found) >= count:
            return found
        assert time.monotonic() < deadline, f"expected {count} matching message(s), saw {len(found)}"


def exactly_mail(mail: Mailpit, pred: Callable[[dict[str, Any]], bool], count: int = 1) -> list[dict[str, Any]]:
    await_mail(mail, pred, count)
    found = [m for m in mail.messages(settle=QUIET_SECONDS) if pred(m)]
    assert len(found) == count, f"expected exactly {count} message(s), saw {len(found)}"
    return found


def no_mail(mail: Mailpit, pred: Callable[[dict[str, Any]], bool]) -> None:
    found = [m for m in mail.messages(settle=QUIET_SECONDS) if pred(m)]
    assert found == [], [m.get("Subject") for m in found]


def link_token(body: str, prefix: str) -> str:
    m = re.search(re.escape(prefix) + r"([A-Za-z0-9_\-.~%]+)", body)
    assert m, f"no {prefix} link in mail"
    return m.group(1)


def attachment_names(message: dict[str, Any]) -> list[str]:
    return [a.get("FileName", "") for a in message.get("Attachments") or []]


def import_rows(rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(IMPORT_HEADER.split(","))
    w.writerows(rows)
    return buf.getvalue().encode()


def import_csv(director: httpx.Client, content: bytes) -> httpx.Response:
    return director.post("/api/roster/imports", files={"file": ("roster.csv", content, "text/csv")})


def new_talent(director: httpx.Client, office: str = "Toronto", division: str = "Women") -> dict[str, Any]:
    token, email = ns("talent")
    body = {"displayName": f"Quinn Zed{token}", "email": email, "office": office.lower(),
            "board": BOARD_OF_DIVISION[division], "measurements": {"height": {"value": 175, "unit": "cm"}}}
    return ok(director.post("/api/talent", json=body), 201)


def seeded_talent(staff: httpx.Client, slug: str) -> dict[str, Any]:
    talent = ok(staff.get("/api/talent"), 200)["talent"]
    return next(t for t in talent if t["slug"] == slug)


def member_by_email(director: httpx.Client, email: str) -> dict[str, Any] | None:
    members = ok(director.get("/api/members"), 200)["members"]
    return next((m for m in members if m["email"].lower() == email.lower()), None)


def new_client(staff: httpx.Client, tz: str = "America/Toronto", company: str | None = None) -> dict[str, Any]:
    token, email = ns("client")
    body = {"company": company or f"Client {token}", "contactName": f"Contact {token}", "contactEmail": email, "timeZone": tz}
    return ok(staff.post("/api/clients", json=body), 201)


def invite_and_accept(base: str, director: httpx.Client, mail: Mailpit, role: str, office: str = "toronto",
                      talent_id: str | None = None) -> tuple[httpx.Client, dict[str, Any]]:
    token, email = ns("member")
    body: dict[str, Any] = {"email": email, "name": f"Member {token}", "role": role, "office": office}
    if talent_id:
        body["talentId"] = talent_id
    ok(director.post("/api/invitations", json=body), 202)
    message = await_mail(mail, mail_to(email, "You're invited to Rungboard"))[0]
    invite = link_token(text(message), "/invite/")
    c = http(base)
    accepted = ok(c.post(f"/api/invitations/{invite}/accept", json={"password": NEW_PASSWORD}), 200)
    return c, accepted["member"]


def place(staff: httpx.Client, talent_id: str, client_id: str, day: date, *, key: str | None = None,
          job: str = "Spring lookbook", note: str = "Two looks, studio", hold: str | None = None) -> httpx.Response:
    body = {"talentId": talent_id, "clientId": client_id, "date": day.isoformat(), "jobTitle": job, "note": note,
            "holdUntilLocal": hold}
    return staff.post("/api/options", json=body, headers={"Idempotency-Key": key or uuid.uuid4().hex})


def placed(staff: httpx.Client, talent_id: str, client_id: str, day: date, **kw: Any) -> dict[str, Any]:
    return ok(place(staff, talent_id, client_id, day, **kw), 201)["option"]


def get_option(staff: httpx.Client, option_id: str) -> dict[str, Any]:
    return ok(staff.get(f"/api/options/{option_id}"), 200)["option"]


def confirm(staff: httpx.Client, rows: list[dict[str, Any]]) -> httpx.Response:
    return staff.post("/api/bookings", json={"options": rows})


def confirm_row(option_id: str, day_type: str = "full_day", overtime: int = 0,
                usage: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"optionId": option_id, "dayType": day_type, "overtimeMinutes": overtime, "usage": usage or []}


def book(staff: httpx.Client, director: httpx.Client, talent: dict[str, Any], client: dict[str, Any], day: date,
         **kw: Any) -> dict[str, Any]:
    option = placed(staff, talent["id"], client["id"], day)
    return ok(confirm(staff, [confirm_row(option["id"], **kw)]), 201)["booking"]


def ladder_day(staff: httpx.Client, talent_id: str, day: date) -> dict[str, Any]:
    body = ok(staff.get(f"/api/talent/{talent_id}/ladder", params={"from": day.isoformat(), "days": 1}), 200)
    return next(d for d in body["days"] if d["date"] == day.isoformat())


def new_package(staff: httpx.Client, talent_ids: list[str]) -> dict[str, Any]:
    token, email = ns("casting")
    body = {"title": f"Package {token}", "recipientName": f"Casting {token}", "recipientEmail": email, "talentIds": talent_ids}
    return ok(staff.post("/api/packages", json=body), 201)["package"]


def package_token(package: dict[str, Any]) -> str:
    m = re.fullmatch(r"/p/([^/]+)", urlparse(package["url"]).path)
    assert m, package["url"]
    return m.group(1)


def public_list(base: str, board: str, *, office: str | None = None, q: str | None = None, sort: str = "name",
                page: int = 1) -> dict[str, Any]:
    params: dict[str, Any] = {"board": board, "sort": sort, "page": page}
    if office:
        params["office"] = office
    if q is not None:
        params["q"] = q
    return ok(http(base).get("/api/public/talent", params=params), 200)


def board_slugs(base: str, board: str) -> list[str]:
    first = public_list(base, board)
    slugs = [t["slug"] for t in first["talent"]]
    for number in range(2, first["totalPages"] + 1):
        slugs += [t["slug"] for t in public_list(base, board, page=number)["talent"]]
    return slugs


def board_count(base: str, board: str) -> int:
    boards = ok(http(base).get("/api/public/boards"), 200)["boards"]
    return next(b["count"] for b in boards if b["board"] == board)


def strip_days(base: str, office: str, count: int) -> tuple[date, list[date]]:
    now = server_now(base)
    today = now.astimezone(ZoneInfo(ZONES[office])).date()
    closures = office_closures(base, office)
    picks = []
    for i in range(3, STRIP_DAYS):
        d = today + timedelta(days=i)
        if business(d, closures) and auto_release(d, office, closures) > now + timedelta(hours=2):
            picks.append(d)
    assert len(picks) >= count, "not enough open days in the 14-day strip"
    return today, picks[:count]


def ledger(staff: httpx.Client, talent_id: str) -> dict[str, Any]:
    return ok(staff.get(f"/api/talent/{talent_id}/ledger"), 200)


def talent_entries(movement: dict[str, Any], talent_id: str) -> int:
    return sum(e["amountCents"] for e in movement["entries"] if e["account"] == f"talent:{talent_id}")


def price(rows: list[dict[str, Any]], card: dict[str, Any], usage_base: dict[str, int], office: str) -> dict[str, Any]:
    lines: list[tuple[str, str, str | None, int]] = []
    fees: list[int] = []
    for row in rows:
        name, tid = row["name"], row["talentId"]
        rates = card[row["board"]]
        own: list[tuple[str, str, str | None, int]] = []
        if row["dayType"] == "full_day":
            own.append(("day_rate", f"Day rate: {name}", tid, rates["fullDayCents"]))
        else:
            own.append(("half_day_rate", f"Half-day rate: {name}", tid, rates["halfDayCents"]))
        quarters = -(-row["overtime"] // 15)
        own.append(("overtime", f"Overtime: {name}, {quarters} quarter hours", tid, quarters * rates["overtimeQuarterHourCents"]))
        for u in row["usage"]:
            amount = half_up(usage_base[u["media"]] * TERRITORY_PCT[u["territory"]] * TERM_PCT[u["termMonths"]], 10000)
            label = f"Usage: {name}, {MEDIA_NAMES[u['media']]}, {TERRITORY_NAMES[u['territory']]}, {u['termMonths']} months"
            own.append(("usage", label, tid, amount))
        own = [line for line in own if line[3] != 0]
        lines += own
        fees.append(sum(line[3] for line in own))
    total_fees = sum(fees)
    service = half_up(total_fees * SERVICE_PERCENT, 100)
    floors = [service * f // total_fees for f in fees]
    remainders = [service * f % total_fees for f in fees]
    leftover = service - sum(floors)
    for index in sorted(range(len(fees)), key=lambda i: (-remainders[i], i))[:leftover]:
        floors[index] += 1
    taxes = [(label, half_up((total_fees + service) * pct, 100)) for label, pct in TAX_LINES[office]]
    lines.append(("service_fee", f"Agency service fee {SERVICE_PERCENT}%", None, service))
    lines += [("tax", label, None, amount) for label, amount in taxes]
    return {
        "lines": sorted(lines, key=repr),
        "talent": {row["talentId"]: (fees[i], floors[i]) for i, row in enumerate(rows)},
        "talentFeesCents": total_fees,
        "serviceFeeCents": service,
        "taxCents": sum(a for _, a in taxes),
        "totalCents": total_fees + service + sum(a for _, a in taxes),
    }


def booking_lines(booking: dict[str, Any]) -> list[tuple[str, str, str | None, int]]:
    return sorted(((l["kind"], l["label"], l["talentId"], l["amountCents"]) for l in booking["lines"]), key=repr)


def kb_invoice(killbill: KillBill, invoice_id: str) -> dict[str, Any]:
    r = killbill.client.get(f"/invoices/{invoice_id}", params={"withItems": "true", "withChildrenItems": "false",
                                                               "audit": "NONE"})
    assert r.status_code == 200, f"Kill Bill invoice {invoice_id}: {r.status_code} {r.text[:300]}"
    return r.json()


def kb_items(invoice: dict[str, Any]) -> list[tuple[str, int]]:
    return sorted((item.get("description") or "", int(Decimal(str(item["amount"])) * 100))
                  for item in invoice.get("items") or [])


def assert_priced(booking: dict[str, Any], expected: dict[str, Any]) -> None:
    assert booking_lines(booking) == expected["lines"]
    for key in ("talentFeesCents", "serviceFeeCents", "taxCents", "totalCents"):
        assert booking[key] == expected[key], (key, booking[key], expected[key])
    shares = {t["talentId"]: (t["talentFeesCents"], t["serviceFeeShareCents"]) for t in booking["talent"]}
    assert shares == expected["talent"]
    assert sum(s for _, s in shares.values()) == booking["serviceFeeCents"]


def card_body(name: str, effective: date, fees: dict[str, tuple[int, int, int]], usage: dict[str, int]) -> dict[str, Any]:
    return {
        "name": name,
        "effectiveFrom": effective.isoformat(),
        "boards": {b: {"fullDayCents": f, "halfDayCents": h, "overtimeQuarterHourCents": q} for b, (f, h, q) in fees.items()},
        "usageBaseCents": usage,
    }


def late_card_window(director: httpx.Client, base: str) -> tuple[date, date, list[dict[str, Any]]]:
    cards = ok(director.get("/api/rate-cards"), 200)["rateCards"]
    latest = max(date.fromisoformat(c["effectiveFrom"]) for c in cards)
    effective = max(latest + timedelta(days=1), LATE_CARD_FROM)
    closures = office_closures(base, "toronto")
    day = effective
    while not business(day, closures):
        day += timedelta(days=1)
    assert day <= LAST_JOB_DAY, "no job day left for a new rate card"
    return effective, day, cards


def jpeg(width: int = 40, height: int = 20, *, orientation: int | None = None, gps: bool = False) -> bytes:
    from PIL import Image

    img = Image.new("RGB", (width, height), (150, 40, 50))
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if gps:
        exif[0x8825] = {1: "N", 2: (43.0, 39.0, 0.0), 3: "W", 4: (79.0, 23.0, 0.0)}
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()


def png(width: int = 30, height: int = 30) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (width, height), (20, 90, 60)).save(buf, "PNG")
    return buf.getvalue()


def padded_jpeg(size: int) -> bytes:
    base = jpeg(64, 64)
    need = size - len(base)
    segments = []
    while need > 0:
        take = min(need, 65537)
        if 0 < need - take < 4:
            take -= 4
        data_len = take - 4
        segments.append(b"\xff\xfe" + (data_len + 2).to_bytes(2, "big") + b"\x00" * data_len)
        need -= take
    out = base[:2] + b"".join(segments) + base[2:]
    assert len(out) == size
    return out


SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def assert_clean_rotated(data: bytes, width: int, height: int) -> None:
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    assert img.format == "JPEG"
    exif = img.getexif()
    assert not exif.get_ifd(0x8825), "location data was not removed"
    assert exif.get(0x0112) in (None, 1), "orientation was not applied"
    assert img.size == (width, height), img.size


def tagged_photo() -> bytes:
    from PIL import Image

    data = jpeg(40, 20, orientation=6, gps=True)
    assert Image.open(io.BytesIO(data)).getexif().get_ifd(0x8825), "fixture lacks location data"
    return data


def upload_photo(staff: httpx.Client, talent_id: str, data: bytes | None = None, name: str = "photo.jpg",
                 ctype: str = "image/jpeg") -> httpx.Response:
    return staff.post(f"/api/talent/{talent_id}/photos", files={"file": (name, data or jpeg(), ctype)})


SLOTS = ["front", "profile", "full_length", "smile"]


def new_draft(base: str, office: str = "toronto", ip: str | None = None) -> tuple[str, str]:
    r = httpx.post(f"{base}/api/applications", json={"office": office},
                   headers={"X-Forwarded-For": ip or fresh_ip()}, timeout=HTTP_TIMEOUT)
    body = ok(r, 201)
    assert body["status"] == "draft"
    return body["id"], body["token"]


def full_application(base: str, dob: date, *, guardian: bool = True) -> dict[str, Any]:
    app_id, token = new_draft(base)
    tok, email = ns("applicant")
    _, guardian_email = ns("guardian")
    first, last = "Ava", f"Rowe{tok}"
    patch: dict[str, Any] = {"firstName": first, "lastName": last, "email": email, "dateOfBirth": dob.isoformat(),
                             "office": "toronto", "height": {"value": 171, "unit": "cm"}, "instagramFollowers": 1200,
                             "bio": "Runner and painter."}
    if guardian:
        patch |= {"guardianName": f"Guardian {tok}", "guardianEmail": guardian_email}
    headers = {"X-Application-Token": token}
    draft = ok(httpx.patch(f"{base}/api/applications/{app_id}", json=patch, headers=headers, timeout=HTTP_TIMEOUT), 200)
    for slot in SLOTS:
        ok(httpx.put(f"{base}/api/applications/{app_id}/photos/{slot}", headers=headers,
                     files={"file": (f"{slot}.jpg", jpeg(30, 40), "image/jpeg")}, timeout=HTTP_TIMEOUT), 200)
    return {"id": app_id, "token": token, "first": first, "last": last, "email": email,
            "guardianEmail": guardian_email, "minor": draft["minor"]}


def submit(base: str, application: dict[str, Any]) -> httpx.Response:
    return httpx.post(f"{base}/api/applications/{application['id']}/submit", json={},
                      headers={"X-Application-Token": application["token"]}, timeout=HTTP_TIMEOUT)


def eighteen_years_before(d: date) -> date:
    try:
        return d.replace(year=d.year - 18)
    except ValueError:
        return date(d.year - 18, 2, 28)


@contextlib.contextmanager
def ui(browser: Browser, base: str, *, viewport: dict[str, int] | None = None, touch: bool = False,
       reduced: str = "no-preference", member: httpx.Client | None = None, motion: bool = False,
       ip: str | None = None) -> Iterator[Page]:
    ctx = browser.new_context(base_url=base, viewport=viewport or DESKTOP, has_touch=touch, is_mobile=touch,
                              reduced_motion=reduced, accept_downloads=True)
    try:
        if motion:
            ctx.add_init_script(MOTION_JS)
        if ip:
            ctx.set_extra_http_headers({"X-Forwarded-For": ip})
        if member is not None:
            ctx.add_cookies([{"name": "rb_session", "value": member.cookies["rb_session"], "url": base}])
        yield ctx.new_page()
    finally:
        ctx.close()


def sign_in_ui(page: Page, email: str, password: str = PASSWORD) -> None:
    page.goto("/sign-in")
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Sign in").click()
    if password == PASSWORD:
        expect(page).not_to_have_url(re.compile(r"/sign-in(?:[?#]|$)"))


def kb_press(locator: Any, key: str = "Enter") -> None:
    locator.focus()
    locator.press(key)


def kb_type(locator: Any, value: str) -> None:
    locator.fill("")
    locator.focus()
    if locator.evaluate("(e) => ['date', 'datetime-local', 'month', 'time', 'week'].includes(e.type)"):
        locator.fill(value)
        return
    locator.press_sequentially(value)


def motions(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("() => window.__motion.splice(0)")


def settle_all(page: Page) -> None:
    page.evaluate("() => document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} })")


def aa_audit(page: Page) -> None:
    settle_all(page)
    axe(page)


def choose(radio: Any) -> None:
    if not radio.is_checked():
        radio.focus()
        radio.press(" ")
    if not radio.is_checked():
        radio.evaluate("(e) => (e.labels && e.labels[0] ? e.labels[0] : e).click()")
    expect(radio).to_be_checked()


TAP_FRAGMENT_JS = """(e) => {
  if (e.getClientRects().length < 2) return null;
  e.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
  for (const r of e.getClientRects()) {
    const p = [r.x + r.width / 2, r.y + r.height / 2];
    const hit = document.elementFromPoint(p[0], p[1]);
    if (hit && (hit === e || e.contains(hit))) return p;
  }
  return null;
}"""


def tap(locator: Any) -> None:
    def attempt() -> bool:
        settle_all(locator.page)
        try:
            kit_tap(locator)
        except AssertionError:
            point = locator.evaluate(TAP_FRAGMENT_JS) if locator.count() == 1 else None
            if not point:
                return False
            locator.page.touchscreen.tap(point[0], point[1])
        return True

    eventually(attempt, UI_WAIT, "control never became tappable")


TAP_POINT_JS = """(e) => {
  e.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
  const middle = (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
  const owns = (el, p) => { const hit = document.elementFromPoint(p[0], p[1]); return !!hit && (hit === el || el.contains(hit)); };
  if (owns(e, middle(e))) return middle(e);
  const label = (e.labels && e.labels[0]) || e.closest('label');
  return label && owns(label, middle(label)) ? middle(label) : null;
}"""


def tap_radio(radio: Any) -> None:
    def attempt() -> bool:
        settle_all(radio.page)
        point = radio.evaluate(TAP_POINT_JS)
        if point:
            radio.page.touchscreen.tap(point[0], point[1])
        return radio.is_checked()

    eventually(attempt, UI_WAIT, "radio never took a tap")


def shown_box(page: Page, name: str) -> Any:
    return next(e for e in page.get_by_role("textbox", name=name).all() if e.is_visible())


def shown_fields(page: Page, texts: dict[str, str], radios: dict[str, str]) -> tuple[list[str], list[str]]:
    def found() -> tuple[list[str], list[str]] | None:
        boxes = [n for n in texts if any(e.is_visible() for e in page.get_by_role("textbox", name=n).all())]
        groups = [g for g in radios if any(e.is_visible() for e in page.get_by_role("radiogroup", name=g).all())]
        return (boxes, groups) if boxes or groups else None

    return eventually(found, UI_WAIT, f"the step shows none of {[*texts, *radios]}")


def fill_shown(page: Page, texts: dict[str, str], radios: dict[str, str], pick: Callable[[Any], None],
               shown: tuple[list[str], list[str]] | None = None) -> list[str]:
    boxes, groups = shown or shown_fields(page, texts, radios)
    for name in boxes:
        shown_box(page, name).fill(texts.pop(name))
    for group in groups:
        pick(page.get_by_role("radiogroup", name=group).get_by_role("radio", name=radios.pop(group)))
    return boxes


def next_step(page: Page, press: Callable[[Any], None]) -> None:
    before = page.url
    press(page.get_by_role("button", name="Next"))
    expect(page).not_to_have_url(before)


def displacement(m: dict[str, Any]) -> tuple[float, float]:
    if not m["start"] or not m["end"]:
        return 0.0, 0.0
    return m["end"]["x"] - m["start"]["x"], m["end"]["y"] - m["start"]["y"]


def edge_moves(m: dict[str, Any], vh: float) -> list[float]:
    if not (m["start"] and m["end"] and m.get("vstart") and m.get("vend")) or max(m["start"]["h"], m["end"]["h"]) < vh / 2:
        return []
    moves = (m["vend"]["top"] - m["vstart"]["top"], m["vend"]["bottom"] - m["vstart"]["bottom"])
    return [d for d in moves if abs(d) >= vh / 2]


def heading_once(heading: Any) -> str:
    found = re.match(r'- heading "((?:[^"\\]|\\.)*)"', heading.aria_snapshot())
    name = norm(json.loads(f'"{found.group(1)}"')) if found else ""
    assert name and not re.fullmatch(r"(.+?)\s*\1", name), f"heading name is empty or repeats: {name!r}"
    return name


def assert_published_durations(records: list[dict[str, Any]]) -> None:
    for m in records:
        assert m["iterations"] != -1, "decorative loop found"
        if m["duration"] > 0:
            assert any(abs(m["duration"] - d) <= 1 for d in DURATIONS), f"unpublished duration {m['duration']}"


def focused_heading_level(page: Page) -> int | None:
    return page.evaluate("""() => { const e = document.activeElement; if (!e) return null;
        const m = /^H([1-6])$/.exec(e.tagName); if (m) return +m[1];
        if (e.getAttribute('role') === 'heading') return +(e.getAttribute('aria-level') || 2); return null; }""")


def focused_text(page: Page) -> str:
    return norm(page.evaluate("() => (document.activeElement && document.activeElement.innerText) || ''"))


def contains_focus(locator: Any) -> bool:
    return bool(locator.evaluate("(el) => el.contains(document.activeElement)"))


def tab_into(page: Page, container: Any) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if contains_focus(container):
            return
    raise AssertionError("Tab never reached the container")


def board_page(page: Page, talent: dict[str, Any]) -> Any:
    page.goto(f"/workspace/board?office={talent['office']}&talent={talent['slug']}")
    grid = page.get_by_role("grid", name=f"Availability for {talent['displayName']}")
    expect(grid).to_be_visible()
    return grid


def day_button(grid: Any, d: date) -> Any:
    return grid.get_by_role("button", name=re.compile(rf"^{re.escape(day_label(d))}( |$)"))


def day_dialog(page: Page, talent: dict[str, Any], d: date) -> Any:
    return page.get_by_role("dialog", name=f"{talent['displayName']}, {fmt_date(d)}")


def keyboard_to_day(page: Page, grid: Any, today: date, d: date) -> Any:
    tab_into(page, grid)
    page.keyboard.press("Home")
    for _ in range((d - today).days):
        page.keyboard.press("ArrowRight")
    target = day_button(grid, d)
    expect(target).to_be_focused()
    return target


def query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(url).query, keep_blank_values=True).items()}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@contextlib.contextmanager
def app_copy(**overrides: str) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    url = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_bytes()[-3000:].decode(errors="replace")

    def healthy() -> bool:
        assert proc.poll() is None, f"app copy exited:\n{tail()}"
        try:
            return httpx.get(f"{url}/api/health", timeout=5).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        eventually(healthy, BOOT_SECONDS, f"app copy never became healthy:\n{tail()}")
        yield url
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


def outage(env: str) -> str:
    url = os.environ.get(env)
    assert url, f"{env} is not set"
    return url.rstrip("/")


@pytest.fixture
def s3() -> S3:
    return S3()


def test_wf_workspace_access_sign_in(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url) as page:
        sign_in_ui(page, PRIYA, WRONG_PASSWORD)
        expect(page.get_by_role("status", name="Account announcements")).to_contain_text(
            "That email and password do not match.")
        expect(page).to_have_url(re.compile(r"/sign-in"))
    for email, home in HOMES.items():
        with ui(browser, app_url) as page:
            sign_in_ui(page, email)
            expect(page).to_have_url(re.compile(re.escape(home) + r"(\?|$)"))
            expect(page.get_by_role("navigation", name="Workspace")).to_be_visible()
    with ui(browser, app_url) as page:
        sign_in_ui(page, PRIYA)
        expect(page).to_have_url(re.compile(r"/workspace/board"))
        page.get_by_role("button", name="Sign out").click()
        expect(page).to_have_url(re.compile(r"/sign-in"))
        assert page.request.get("/api/me").status == 401


def test_wf_workspace_access_invitation(browser: Browser, app_url: str, mail: Mailpit) -> None:
    token, email = ns("invitee")
    name = f"Ari {token}"
    with ui(browser, app_url) as page:
        sign_in_ui(page, DIRECTOR)
        expect(page).to_have_url(re.compile(r"/workspace/overview"))
        page.goto("/workspace/members")
        page.get_by_role("button", name="Invite member").click()
        dialog = page.get_by_role("dialog", name="Invite member")
        dialog.get_by_role("textbox", name="Name").fill(name)
        dialog.get_by_role("textbox", name="Email").fill(email)
        select(dialog.get_by_role("combobox", name="Role"), "Booker")
        choose(dialog.get_by_role("radio", name="Toronto"))
        dialog.get_by_role("button", name="Send invitation").click()
        expect(page.get_by_role("status", name="Account announcements")).to_contain_text(
            "If that address has no account yet, an invitation is on its way.")
    message = exactly_mail(mail, mail_to(email, "You're invited to Rungboard"))[0]
    invite = link_token(text(message), "/invite/")
    with ui(browser, app_url) as page:
        page.goto(f"/invite/{invite}")
        page.get_by_label("New password", exact=True).fill(NEW_PASSWORD)
        page.get_by_role("button", name="Set password").click()
        expect(page).to_have_url(re.compile(r"/workspace/board"))
        me = page.request.get("/api/me")
        assert me.status == 200
        assert me.json()["email"].lower() == email.lower() and me.json()["role"] == "booker"
    director = sign_in(app_url, DIRECTOR)
    member = member_by_email(director, email)
    assert member and member["role"] == "booker" and member["office"] == "toronto" and member["name"] == name


def test_account_replies_identical(app_url: str, mail: Mailpit) -> None:
    director = sign_in(app_url, DIRECTOR)
    _, member = invite_and_accept(app_url, director, mail, "booker")
    _, unknown = ns("nobody")
    anon = http(app_url)
    known_reset = anon.post("/api/password-resets", json={"email": member["email"]})
    unknown_reset = anon.post("/api/password-resets", json={"email": unknown})
    assert known_reset.status_code == unknown_reset.status_code == 202
    assert known_reset.json() == unknown_reset.json() == {
        "message": "If that address has an account, a reset link is on its way."}
    reset_mail = exactly_mail(mail, mail_to(member["email"], "Reset your Rungboard password"))[0]
    no_mail(mail, mail_to(unknown))
    reset = link_token(text(reset_mail), "/reset/")
    used = ok(anon.post(f"/api/password-resets/{reset}", json={"password": NEW_PASSWORD + "x"}), 200)
    assert used["home"] == "/workspace/board"
    err(anon.post(f"/api/password-resets/{reset}", json={"password": NEW_PASSWORD + "y"}), 410, "link_used")

    _, fresh = ns("newcomer")
    existing = director.post("/api/invitations", json={"email": member["email"], "name": "Again", "role": "booker",
                                                       "office": "toronto"})
    new = director.post("/api/invitations", json={"email": fresh, "name": "Newcomer", "role": "booker",
                                                  "office": "toronto"})
    assert existing.status_code == new.status_code == 202
    assert existing.json() == new.json() == {
        "message": "If that address has no account yet, an invitation is on its way."}
    exactly_mail(mail, mail_to(fresh, "You're invited to Rungboard"))
    exactly_mail(mail, mail_to(member["email"], "You're invited to Rungboard"), count=1)

    wrong = anon.post("/api/session", json={"email": member["email"], "password": WRONG_PASSWORD})
    missing = anon.post("/api/session", json={"email": unknown, "password": WRONG_PASSWORD})
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json() == {"error": "invalid_credentials"}


def test_talent_own_member_only(app_url: str) -> None:
    ines = sign_in(app_url, INES)
    director = sign_in(app_url, DIRECTOR)
    me = ok(ines.get("/api/me"), 200)
    own = ok(ines.get(f"/api/members/{me['id']}"), 200)
    assert own["email"] == INES and own["talentId"]
    unknown = ines.get("/api/members/unknown-member-id")
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}
    for other in (CALLUM, PRIYA, DIRECTOR):
        target = member_by_email(director, other)
        assert target
        r = ines.get(f"/api/members/{target['id']}")
        assert (r.status_code, r.json()) == (unknown.status_code, unknown.json())
        assert other not in r.text


ROLE_CASES = ["booker", "accounts_lead", "scout", "talent"]


@pytest.mark.parametrize("role", ROLE_CASES, ids=ROLE_CASES)
def test_director_only_staff_changes(app_url: str, mail: Mailpit, role: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    actor = sign_in(app_url, {"booker": PRIYA, "accounts_lead": ROSA, "scout": THEO, "talent": INES}[role])
    target_client, target = invite_and_accept(app_url, director, mail, "booker")
    subject_id = ok(actor.get("/api/me"), 200)["id"] if role == "talent" else target["id"]
    _, invitee = ns("refused")
    err(actor.post("/api/invitations", json={"email": invitee, "name": "Refused", "role": "booker", "office": "toronto"}),
        403, "forbidden")
    err(actor.patch(f"/api/members/{subject_id}", json={"role": "agency_director"}), 403, "forbidden")
    err(actor.delete(f"/api/members/{subject_id}"), 403, "forbidden")
    no_mail(mail, mail_to(invitee))
    assert ok(director.get(f"/api/members/{target['id']}"), 200)["role"] == "booker"
    if role == "talent":
        assert ok(director.get(f"/api/members/{subject_id}"), 200)["role"] == "talent"

    changed = ok(director.patch(f"/api/members/{target['id']}", json={"role": "agency_director"}), 200)
    assert changed["role"] == "agency_director"
    _, promoted = ns("promoted")
    ok(target_client.post("/api/invitations", json={"email": promoted, "name": "Promoted", "role": "booker",
                                                    "office": "toronto"}), 202)
    own = ok(director.get("/api/me"), 200)
    err(director.patch(f"/api/members/{own['id']}", json={"role": "booker"}), 409, "own_membership")
    err(director.delete(f"/api/members/{own['id']}"), 409, "own_membership")
    assert director.delete(f"/api/members/{target['id']}").status_code == 204
    err(director.get(f"/api/members/{target['id']}"), 404, "not_found")


def test_wf_public_roster_browse(browser: Browser, app_url: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    while public_list(app_url, "women", office="toronto")["total"] <= PAGE_SIZE:
        new_talent(director)
    heights = public_list(app_url, "women", sort="height")["talent"]
    for a, b in zip(heights, heights[1:]):
        assert (a["measurements"]["heightCm"], b["displayName"]) >= (b["measurements"]["heightCm"], a["displayName"]) or \
            a["measurements"]["heightCm"] > b["measurements"]["heightCm"]

    def expect_cards(page: Page, office: str | None, sort: str, number: int, unit_cm: bool, q: str | None = None) -> None:
        listing = public_list(app_url, "women", office=office, sort=sort, page=number, q=q)
        expect(page.get_by_role("article")).to_have_count(len(listing["talent"]))
        for card in listing["talent"]:
            article = page.get_by_role("article", name=card["displayName"])
            cm = card["measurements"]["heightCm"]
            expect(article).to_contain_text(f"{cm} cm" if unit_cm else ft_in(cm))

    with ui(browser, app_url) as page:
        page.add_init_script(SETTLE_JS)
        page.goto("/boards")
        expect(page.get_by_role("navigation", name="Boards")).to_be_visible()
        aa_audit(page)
        page.get_by_role("navigation", name="Boards").get_by_role("link", name="Women").click()
        expect(page).to_have_url(re.compile(r"/boards/women\?"))
        assert query(page.url) == {"office": "all", "q": "", "sort": "name", "unit": "cm", "page": "1"}
        expect(page.get_by_role("article").first).to_be_visible()
        aa_audit(page)
        at_rest(page, "the Women board")
        states: list[dict[str, str]] = [query(page.url)]
        choose(page.get_by_role("radiogroup", name="Office").get_by_role("radio", name="Toronto"))
        expect(page).to_have_url(re.compile(r"office=toronto", re.I))
        at_rest(page, "the Toronto board")
        states.append(query(page.url))
        select(page.get_by_role("combobox", name="Sort by"), "Height")
        expect(page).to_have_url(re.compile(r"sort=height"))
        at_rest(page, "the board sorted by height")
        states.append(query(page.url))
        choose(page.get_by_role("radiogroup", name="Units").get_by_role("radio", name="ft and in"))
        expect(page).not_to_have_url(re.compile(r"unit=cm"))
        at_rest(page, "the board in feet and inches")
        states.append(query(page.url))
        page.get_by_role("navigation", name="Pages").get_by_role("link", name="Next page").click()
        expect(page).to_have_url(re.compile(r"page=2"))
        states.append(query(page.url))
        expect_cards(page, "toronto", "height", 2, unit_cm=False)
        at_rest(page, "page 2")
        page.get_by_role("searchbox", name="Search talent").fill("Okoro")
        page.get_by_role("searchbox", name="Search talent").press("Enter")
        expect(page).to_have_url(re.compile(r"q=Okoro"))
        assert query(page.url)["page"] == "1"
        states.append(query(page.url))
        expect_cards(page, "toronto", "height", 1, unit_cm=False, q="Okoro")
        for state in reversed(states[:-1]):
            page.go_back()
            expect(page).to_have_url(re.compile(rf"page={state['page']}"))
            assert query(page.url) == state
            office = None if state["office"] == "all" else "toronto"
            expect(page.get_by_role("radio", name="Toronto")).to_be_checked(checked=office is not None)
            expect_cards(page, office, state["sort"], int(state["page"]), unit_cm=state["unit"] == "cm")
        for state in states[1:]:
            page.go_forward()
            expect(page).to_have_url(re.compile(rf"sort={state['sort']}"))
            assert query(page.url) == state


def test_wf_public_roster_phone_filters(browser: Browser, app_url: str) -> None:
    vancouver = public_list(app_url, "women", office="vancouver")["total"]
    with ui(browser, app_url, viewport=PHONE, touch=True) as page:
        page.goto("/boards/women")
        tap(page.get_by_role("button", name="Filters"))
        sheet = page.get_by_role("dialog", name="Filters")
        expect(sheet).to_be_visible()
        aa_audit(page)
        tap_radio(sheet.get_by_role("radio", name="Vancouver"))
        show = sheet.get_by_role("button", name=f"Show {vancouver} talent")
        expect(show).to_be_visible()
        box = show.bounding_box()
        assert box and box["y"] + box["height"] <= PHONE["height"] + SUBPIXEL
        tap(show)
        expect(sheet).to_be_hidden()
        expect(page).to_have_url(re.compile(r"office=vancouver", re.I))
        expect(page.get_by_role("article")).to_have_count(min(vancouver, PAGE_SIZE))
        layout(page)


CARD_KEYS = {"slug", "displayName", "office", "board", "measurements", "reach", "coverPhotoUrl"}
MEASURE_KEYS = {"heightCm", "chestCm", "waistCm", "hipsCm"}
REACH_KEYS = {"instagram", "tiktok", "youtube", "total"}
PHOTO_KEYS = {"photoId", "url", "width", "height"}
PRIVATE_SEED = ["41 Wychwood Avenue", "Prefers morning call times", "2001-05-14", "ines-okoro@talent.vesperrowe.example",
                "Morgan Sinclair", "morgan.sinclair@guardian.example", "+1 416 555 0190", "2010-03-02"]


def assert_card(card: dict[str, Any]) -> None:
    assert set(card) == CARD_KEYS, set(card) ^ CARD_KEYS
    assert set(card["measurements"]) == MEASURE_KEYS
    assert set(card["reach"]) == REACH_KEYS


def test_public_fields_exact(browser: Browser, app_url: str) -> None:
    anon = http(app_url)
    boards = ok(anon.get("/api/public/boards"), 200)["boards"]
    assert {b["title"] for b in boards} == {"Women", "Men", "Creators", "New Faces"}
    for b in boards:
        assert set(b) == {"board", "title", "count", "coverPhotoUrl"}
        listing = public_list(app_url, b["board"])
        for card in listing["talent"]:
            assert_card(card)
    for slug in ("ines-okoro", "ava-sinclair"):
        r = anon.get(f"/api/public/talent/{slug}")
        profile = ok(r, 200)
        assert set(profile) == CARD_KEYS | {"portfolio"}
        assert_card({k: v for k, v in profile.items() if k != "portfolio"})
        assert profile["portfolio"] and all(set(p) == PHOTO_KEYS for p in profile["portfolio"])
        for secret in PRIVATE_SEED:
            assert secret not in r.text
    with ui(browser, app_url) as page:
        page.goto("/talent/ines-okoro")
        expect(page.get_by_role("article", name="Ines Okoro")).to_be_visible()
        html = page.content()
        for secret in PRIVATE_SEED:
            assert secret not in html


GONE_CASES = ["withdrawn", "erased"]


@pytest.mark.parametrize("action", GONE_CASES, ids=GONE_CASES)
def test_withdrawn_talent_gone(browser: Browser, app_url: str, action: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    name, slug = talent["displayName"], talent["slug"]
    anon = http(app_url)
    assert slug in [t["slug"] for t in public_list(app_url, "women", q=name)["talent"]]
    ok(anon.get(f"/api/public/talent/{slug}"), 200)
    before = board_count(app_url, "women")
    ok(director.post(f"/api/talent/{talent['id']}/{'withdraw' if action == 'withdrawn' else 'erase'}", json={}), 200)
    err(anon.get(f"/api/public/talent/{slug}"), 410, "gone")
    assert public_list(app_url, "women", q=name)["total"] == 0
    assert slug not in board_slugs(app_url, "women")
    assert board_count(app_url, "women") == before - 1
    with ui(browser, app_url) as page:
        response = page.goto(f"/talent/{slug}")
        expect(page.get_by_role("heading", name="No longer represented")).to_be_visible()
        expect(page.get_by_text("This talent is no longer represented by Vesper & Rowe Talent.").first).to_be_visible()
        assert response is not None and response.status == 410


REACH_SEED = {
    "ines-okoro": ("Ines Okoro", [374650, 125350, 0]),
    "amara-lindqvist": ("Amara Lindqvist", [999999, 0, 0]),
    "sofia-reyes-park": ("Sofia Reyes-Park", [999, 0, 0]),
    "nadia-belhaj": ("Nadia Belhaj", [1000000, 0, 0]),
    "talia-brandt": ("Talia Brandt", [151999, 48001, 0]),
    "riley-chen": ("Riley Chen", [2450000, 1830500, 412000]),
}


def test_reach_compact(browser: Browser, app_url: str) -> None:
    assert compact(374650) == "374.6K" and compact(999999) == "999.9K" and compact(1000000) == "1M"
    with ui(browser, app_url) as page:
        for slug, (name, counts) in REACH_SEED.items():
            profile = ok(http(app_url).get(f"/api/public/talent/{slug}"), 200)
            assert profile["reach"] == {"instagram": counts[0], "tiktok": counts[1], "youtube": counts[2],
                                        "total": sum(counts)}
            page.goto(f"/talent/{slug}")
            article = page.get_by_role("article", name=name)
            for value in [c for c in counts if c] + [sum(counts)]:
                expect(article).to_contain_text(compact(value))
        page.goto("/boards/women?office=all&q=Talia&sort=name&unit=cm&page=1")
        expect(page.get_by_role("article", name="Talia Brandt")).to_contain_text(compact(151999 + 48001))


def test_route_transitions_and_preview(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, motion=True) as page:
        page.goto("/boards/women")
        expect(page.get_by_role("heading", level=1)).to_be_visible()
        settle_all(page)
        motions(page)
        page.get_by_role("link", name="Boards", exact=True).click()
        expect(page).to_have_url(re.compile(r"/boards(\?|$)"))
        h1 = page.get_by_role("heading", level=1)
        expect(h1).to_have_count(1)
        expect(h1).to_be_focused()
        heading = heading_once(h1)
        expect(page).to_have_title(f"{heading} — Vesper & Rowe Talent")
        forward: list[dict[str, Any]] = []

        def revealed() -> bool:
            forward.extend(motions(page))
            return any(abs(m["duration"] - LONG_MS) <= 1 for m in forward)

        eventually(revealed, UI_WAIT, "heading reveal missing")
        assert_published_durations(forward)
        vh = DESKTOP["height"]
        sweeps = [d for m in forward for d in edge_moves(m, vh)]
        assert sweeps and all(d < 0 for d in sweeps), "cover did not sweep upward"
        assert any(abs(m["duration"] - MIDDLE_MS) <= 1 for m in forward)
        page.go_back()
        expect(page).to_have_url(re.compile(r"/boards/women"))
        h1 = page.get_by_role("heading", level=1)
        expect(h1).to_be_focused()
        expect(page).to_have_title(f"{heading_once(h1)} — Vesper & Rowe Talent")
        back = motions(page)
        assert_published_durations(back)
        reverse = [d for m in back for d in edge_moves(m, vh)]
        assert reverse and all(d > 0 for d in reverse), "cover did not reverse on Back"

        page.goto("/boards")
        rows = page.get_by_role("link", name=re.compile(r"^Women"))
        row = max(rows.all(), key=lambda l: (l.bounding_box() or {"height": 0})["height"])
        box = row.bounding_box()
        assert box
        snapshot = """() => [...document.querySelectorAll('body *')].map((el, i) => { const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect(); return {i, pos: cs.position, x: r.x, y: r.y,
            vis: cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.01 && r.width * r.height > 2500};
            }).filter(e => (e.pos === 'fixed' || e.pos === 'absolute') && e.vis)"""
        y = box["y"] + box["height"] / 2
        p1, p2 = (box["x"] + 40, y), (box["x"] + 200, y)
        page.mouse.move(*p1)
        settle_all(page)
        first = {e["i"]: e for e in page.evaluate(snapshot)}
        page.mouse.move(*p2)
        settle_all(page)
        second = {e["i"]: e for e in page.evaluate(snapshot)}
        followers = [i for i, e in second.items() if i in first and abs(e["x"] - first[i]["x"] - (p2[0] - p1[0])) <= 2
                     and abs(e["y"] - first[i]["y"]) <= 2 and e["x"] > p2[0] and e["y"] > p2[1]]
        assert followers, "no cover preview followed the mouse below and right of it"
        page.mouse.move(2, DESKTOP["height"] - 2)
        settle_all(page)
        before = {e["i"] for e in page.evaluate(snapshot)}
        page.evaluate("""([x, y]) => { const el = document.elementFromPoint(x, y);
            for (const type of ['pointerover', 'pointerenter', 'pointermove']) el.dispatchEvent(new PointerEvent(type,
              {pointerType: 'touch', clientX: x, clientY: y, bubbles: true})); }""", list(p1))
        settle_all(page)
        after = [e for e in page.evaluate(snapshot) if e["i"] not in before and e["x"] > p1[0] and e["y"] > p1[1]]
        assert after == [], "a touch pointer showed the preview"


def add_on_profile(page: Page, slug: str, name: str) -> None:
    page.goto(f"/talent/{slug}")
    page.get_by_role("article", name=name).get_by_role("button", name="Add to tray").click()
    expect(page.get_by_role("article", name=name).get_by_role("button", name="Remove from tray")).to_be_visible()


def test_cast_tray_count(browser: Browser, app_url: str) -> None:
    talent = [("ines-okoro", "Ines Okoro"), ("callum-reid", "Callum Reid"), ("riley-chen", "Riley Chen")]
    with ui(browser, app_url, motion=True) as page:
        announcements = page.get_by_role("status", name="Tray announcements")
        for n, (slug, name) in enumerate(talent, start=1):
            page.goto(f"/talent/{slug}")
            settle_all(page)
            motions(page)
            page.get_by_role("article", name=name).get_by_role("button", name="Add to tray").click()
            expect(announcements).to_have_text(f"Added {name} to your tray. {n} in tray.")
            expect(page.get_by_role("link", name=f"Tray {n}", exact=True)).to_be_visible()
            added: list[dict[str, Any]] = []

            def flew() -> bool:
                added.extend(motions(page))
                return any(abs(m["duration"] - MIDDLE_MS) <= 1 for m in added)

            eventually(flew, UI_WAIT, "no fly or roll in the middle duration")
            assert_published_durations(added)
        total = len(talent)
        ines, callum, riley = (name for _, name in talent)
        page.get_by_role("article", name=riley).get_by_role("button", name="Remove from tray").click()
        expect(announcements).to_have_text(f"Removed {riley}. {total - 1} in tray.")
        expect(page.get_by_role("link", name=f"Tray {total - 1}", exact=True)).to_be_visible()
        page.get_by_role("article", name=riley).get_by_role("button", name="Add to tray").click()
        expect(page.get_by_role("link", name=f"Tray {total}", exact=True)).to_be_visible()
        page.goto("/tray")
        tray = page.get_by_role("list", name="Tray")
        expect(tray.get_by_role("listitem")).to_have_count(total)
        down = tray.get_by_role("listitem", name=ines).get_by_role("button", name="Down")
        down.click()
        position = 2
        expect(announcements).to_have_text(f"Moved {ines} to position {position} of {total}.")
        expect(tray.get_by_role("listitem", name=ines).get_by_role("button", name="Down")).to_be_focused()
        expect(tray.get_by_role("listitem").first).to_have_accessible_name(callum)
        tray.get_by_role("listitem", name=callum).get_by_role("button", name="Remove").click()
        expect(tray.get_by_role("listitem", name=ines).get_by_role("button", name="Remove")).to_be_focused()
        expect(page.get_by_role("link", name=f"Tray {total - 1}", exact=True)).to_be_visible()
        page.reload()
        expect(page.get_by_role("list", name="Tray").get_by_role("listitem")).to_have_count(total - 1)
        expect(page.get_by_role("link", name=f"Tray {total - 1}", exact=True)).to_be_visible()
        expect(page.get_by_role("list", name="Tray").get_by_role("listitem").first).to_have_accessible_name(ines)


def expect_step_heading(page: Page, step: int) -> None:
    expect(page).to_have_url(re.compile(rf"step={step}\b"))
    eventually(lambda: focused_heading_level(page) == 2, SLACK_SECONDS, f"step {step} heading not focused")


def test_wf_cast_requests_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    token, email = ns("brand")
    company = f"Harbourline {token}"
    with ui(browser, app_url, ip=fresh_ip()) as page:
        for slug, name in (("ines-okoro", "Ines Okoro"), ("callum-reid", "Callum Reid"), ("riley-chen", "Riley Chen")):
            page.goto(f"/talent/{slug}")
            kb_press(page.get_by_role("article", name=name).get_by_role("button", name="Add to tray"))
            expect(page.get_by_role("article", name=name).get_by_role("button", name="Remove from tray")).to_be_visible()
        page.goto("/tray")
        kb_press(page.get_by_role("button", name="Start cast request"))
        expect(page).to_have_url(re.compile(r"step=1\b"))
        eventually(lambda: focused_heading_level(page) in (1, 2), SLACK_SECONDS, "step 1 heading not focused")
        kb_press(page.get_by_role("button", name="Next"))
        expect_step_heading(page, 2)
        kb_type(page.get_by_role("textbox", name="Your name"), "Sam Arsenault")
        kb_type(page.get_by_role("textbox", name="Company"), company)
        kb_type(page.get_by_role("textbox", name="Email"), "not-an-email")
        kb_press(page.get_by_role("radiogroup", name="Office").get_by_role("radio", name="Toronto"), " ")
        kb_press(page.get_by_role("button", name="Next"))
        problem = page.get_by_role("region", name="Problems").get_by_role("link",
                                                                        name="Enter an email address like name@example.com.")
        expect(problem).to_be_visible()
        expect(page).to_have_url(re.compile(r"step=2\b"))
        aa_audit(page)
        kb_press(problem)
        expect(page.get_by_role("textbox", name="Email")).to_be_focused()
        kb_type(page.get_by_role("textbox", name="Email"), email)
        kb_press(page.get_by_role("button", name="Next"))
        expect_step_heading(page, 3)
        kb_type(page.get_by_role("textbox", name="Shoot date"), "2027-04-20")
        kb_type(page.get_by_role("textbox", name="Brief"), "Two-day outdoor campaign")
        kb_press(page.get_by_role("button", name="Back"))
        expect_step_heading(page, 2)
        kb_press(page.get_by_role("button", name="Next"))
        expect_step_heading(page, 3)
        kb_press(page.get_by_role("button", name="Next"))
        expect_step_heading(page, 4)
        aa_audit(page)
        kb_press(page.get_by_role("button", name="Send cast request"))
        eventually(lambda: focused_heading_level(page) is not None, SLACK_SECONDS, "confirmation heading not focused")
        expect(page.get_by_text(re.compile(r"Cast request \S+ sent\. A booker in Toronto will reply by email\.")).first
               ).to_be_visible()
    exactly_mail(mail, mail_to(TORONTO_DESK, f"Cast request from {company}: 3 talent"))


def test_wf_cast_requests_leave_and_reload(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, ip=fresh_ip()) as page:
        add_on_profile(page, "ines-okoro", "Ines Okoro")
        page.goto("/cast-request?step=1")
        kb_press(page.get_by_role("button", name="Next"))
        expect_step_heading(page, 2)
        kb_type(page.get_by_role("textbox", name="Your name"), "Sam Arsenault")
        expect(page.get_by_role("textbox", name="Your name")).to_have_value("Sam Arsenault")
        page.reload()
        expect(page.get_by_role("textbox", name="Your name")).to_have_value("Sam Arsenault")
        boards = page.get_by_role("link", name="Boards", exact=True)
        kb_press(boards)
        leave = page.get_by_role("alertdialog", name="Leave the cast request?")
        expect(leave).to_be_visible()
        expect(leave).to_contain_text("Your cast request has not been sent. Your draft stays saved on this device.")
        expect(leave.get_by_role("button", name="Stay on the form")).to_be_focused()
        aa_audit(page)
        assert set(tab_order(page, 4)) <= {"Stay on the form", "Leave"}
        page.keyboard.press("Escape")
        expect(leave).to_be_hidden()
        expect(page).to_have_url(re.compile(r"/cast-request"))
        expect(boards).to_be_focused()
        kb_press(boards)
        kb_press(page.get_by_role("alertdialog", name="Leave the cast request?").get_by_role("button", name="Leave"))
        expect(page).to_have_url(re.compile(r"/boards"))
        page.goto("/cast-request?step=2")
        expect(page.get_by_role("textbox", name="Your name")).to_have_value("Sam Arsenault")


def cast_body(company: str, *, email: str = "sam@northbound.example", name: str = "Sam Arsenault",
              slugs: tuple[str, ...] = ("ines-okoro",)) -> dict[str, Any]:
    return {"name": name, "company": company, "email": email, "office": "toronto", "shootDate": "2027-04-20",
            "brief": "Two-day outdoor campaign", "talentSlugs": list(slugs)}


def cast_post(base: str, body: Any, ip: str, key: str | None, ctype: str = "application/json") -> httpx.Response:
    headers = {"X-Forwarded-For": ip, "Content-Type": ctype}
    if key:
        headers["Idempotency-Key"] = key
    content = body if isinstance(body, (bytes, str)) else json.dumps(body)
    return httpx.post(f"{base}/api/cast-requests", content=content, headers=headers, timeout=HTTP_TIMEOUT)


def test_cast_request_once(app_url: str, mail: Mailpit) -> None:
    token, _ = ns("double")
    company = f"Double {token}"
    body = cast_body(company)
    ip, key = fresh_ip(), uuid.uuid4().hex
    with ThreadPoolExecutor(2) as pool:
        first, second = pool.map(lambda _: cast_post(app_url, body, ip, key), range(2))
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert re.fullmatch(r"CR-\d+", first.json()["reference"])
    replay = cast_post(app_url, body, ip, key)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replayed") == "true"
    err(cast_post(app_url, cast_body(company, email="not-an-email"), ip, key), 409, "idempotency_key_reused")
    exactly_mail(mail, mail_to(TORONTO_DESK, f"Cast request from {company}: 1 talent"))
    other = fresh_ip()
    err(cast_post(app_url, json.dumps(body), other, None, ctype="text/plain"), 415, "unsupported_media_type")
    err(cast_post(app_url, body, other, None), 400, "idempotency_key_required")
    err(cast_post(app_url, "{not json", other, uuid.uuid4().hex), 400, "bad_json")
    no_mail(mail, lambda m: company in (m.get("Subject") or "") and m.get("Subject") !=
            f"Cast request from {company}: 1 talent")


def test_cast_request_rate_limit(app_url: str) -> None:
    ip = fresh_ip()
    for _ in range(CAST_LIMIT):
        assert cast_post(app_url, {}, ip, uuid.uuid4().hex).status_code != 429
    limited = cast_post(app_url, {}, ip, uuid.uuid4().hex)
    body = err(limited, 429, "rate_limited")
    assert isinstance(body["retryAfterSeconds"], int) and 1 <= body["retryAfterSeconds"] <= RATE_WINDOW_SECONDS
    assert limited.headers["Retry-After"] == str(body["retryAfterSeconds"])
    err(cast_post(app_url, "x", ip, None, ctype="text/plain"), 429, "rate_limited")
    assert cast_post(app_url, {}, fresh_ip(), uuid.uuid4().hex).status_code != 429
    checker = fresh_ip()
    for _ in range(CAST_LIMIT * 2):
        r = httpx.post(f"{app_url}/api/cast-requests/checks", json={"step": 2, "draft": {"name": "Sam Arsenault"}},
                       headers={"X-Forwarded-For": checker}, timeout=HTTP_TIMEOUT)
        assert r.status_code in (200, 422)
    assert cast_post(app_url, {}, checker, uuid.uuid4().hex).status_code != 429


def test_cast_request_header_safe(app_url: str, mail: Mailpit) -> None:
    token, _ = ns("inject")
    _, injected = ns("injected")
    company = f"Safe {token}\r\n{INJECTED_HEADER}: yes"
    name = f"Sam\r\nBcc: {injected}"
    r = cast_post(app_url, cast_body(company, name=name), fresh_ip(), uuid.uuid4().hex)
    ok(r, 201)
    expected = f"Cast request from Safe {token} {INJECTED_HEADER}: yes: 1 talent"
    found = exactly_mail(mail, lambda m: TORONTO_DESK in addresses(m.get("To")) and
                         norm(m.get("Subject") or "") == expected)
    message = found[0]
    assert "\r" not in message["Subject"] and "\n" not in message["Subject"]
    for field in ("To", "Cc", "Bcc"):
        assert injected.lower() not in [a.lower() for a in addresses(message.get(field))]
    headers = message.get("Headers") or {}
    assert INJECTED_HEADER not in headers
    no_mail(mail, mail_to(injected))


def test_concurrent_placements_gapless(app_url: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    clients = [new_client(director) for _ in range(5)]
    barrier = threading.Barrier(5)

    def go(client: dict[str, Any]) -> httpx.Response:
        booker = sign_in(app_url, PRIYA)
        barrier.wait()
        return place(booker, talent["id"], client["id"], GENERIC_DAY)

    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(go, clients))
    wins = [r.json()["option"] for r in results if r.status_code == 201]
    losses = [r for r in results if r.status_code != 201]
    assert sorted(o["rank"] for o in wins) == [1, 2, 3]
    assert len(losses) == 2 and all(r.status_code == 409 and r.json()["error"] == "ladder_full" for r in losses)
    day = ladder_day(director, talent["id"], GENERIC_DAY)
    assert sorted(o["rank"] for o in day["options"] if o["state"] in ("placed", "challenged")) == [1, 2, 3]
    assert day["dayState"] == "held"


def test_placement_replay(app_url: str) -> None:
    priya = sign_in(app_url, PRIYA)
    director = sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    a, b = new_client(director), new_client(director)
    first = placed(priya, talent["id"], a["id"], GENERIC_DAY)
    key = uuid.uuid4().hex
    original = place(priya, talent["id"], b["id"], GENERIC_DAY, key=key)
    assert ok(original, 201)["option"]["rank"] == 2
    ok(priya.post(f"/api/options/{first['id']}/release", json={}), 200)
    replay = place(priya, talent["id"], b["id"], GENERIC_DAY, key=key)
    assert replay.status_code == 201 and replay.json() == original.json()
    assert replay.json()["option"]["rank"] == 2
    assert replay.headers.get("Idempotent-Replayed") == "true"
    err(place(priya, talent["id"], b["id"], SECOND_DAY, key=key), 409, "idempotency_key_reused")
    r = priya.post("/api/options", json={"talentId": talent["id"], "clientId": b["id"], "date": SECOND_DAY.isoformat(),
                                         "jobTitle": "x", "note": "", "holdUntilLocal": None})
    err(r, 400, "idempotency_key_required")
    live = [o for o in ladder_day(priya, talent["id"], GENERIC_DAY)["options"] if o["state"] in ("placed", "challenged")]
    assert [(o["clientId"], o["rank"]) for o in live] == [(b["id"], 1)]
    assert ladder_day(priya, talent["id"], SECOND_DAY)["options"] == []


def test_release_challenge_confirm(app_url: str) -> None:
    priya, jonah = sign_in(app_url, PRIYA), sign_in(app_url, JONAH)
    rosa, director = sign_in(app_url, ROSA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    a, b, c, d = (new_client(director) for _ in range(4))
    oa = placed(priya, talent["id"], a["id"], GENERIC_DAY)
    ob = placed(jonah, talent["id"], b["id"], GENERIC_DAY)
    oc = placed(jonah, talent["id"], c["id"], GENERIC_DAY)
    released = ok(priya.post(f"/api/options/{oa['id']}/release", json={}), 200)
    assert released["option"]["state"] == "released" and released["option"]["rank"] is None
    assert released["option"]["releaseReason"] == "manual"
    assert {o["id"]: o["rank"] for o in released["ladder"]} == {ob["id"]: 1, oc["id"]: 2}
    again = err(priya.post(f"/api/options/{oa['id']}/release", json={}), 409, "option_released")
    parse_z(again["releasedAt"])
    err(rosa.post(f"/api/options/{oa['id']}/release", json={}), 403, "forbidden")
    err(priya.post(f"/api/options/{oa['id']}/release", content="{}", headers={"Content-Type": "text/plain"}),
        415, "unsupported_media_type")
    err(jonah.post(f"/api/options/{ob['id']}/challenge", json={}), 409, "not_second")
    challenged = ok(jonah.post(f"/api/options/{oc['id']}/challenge", json={}), 200)
    first = next(o for o in challenged["ladder"] if o["id"] == ob["id"])
    assert first["state"] == "challenged" and parse_z(first["challengeDeadline"])
    err(jonah.post(f"/api/options/{oc['id']}/challenge", json={}), 409, "already_challenged")
    err(confirm(priya, [confirm_row(oc["id"])]), 409, "not_first")
    booking = ok(confirm(priya, [confirm_row(ob["id"])]), 201)["booking"]
    assert booking["state"] == "confirmed"
    assert get_option(priya, ob["id"])["state"] == "confirmed"
    rest = get_option(priya, oc["id"])
    assert rest["state"] == "released" and rest["releaseReason"] == "day_booked" and rest["rank"] is None
    day = ladder_day(priya, talent["id"], GENERIC_DAY)
    assert day["dayState"] == "booked" and day["bookingId"] == booking["id"]
    err(place(priya, talent["id"], d["id"], GENERIC_DAY), 409, "day_booked")
    first2 = placed(priya, talent["id"], b["id"], SECOND_DAY)
    err(place(jonah, talent["id"], b["id"], SECOND_DAY), 409, "client_already_holds")
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda who: confirm(who, [confirm_row(first2["id"])]), [priya, jonah]))
    statuses = sorted(r.status_code for r in results)
    assert statuses == [201, 409]
    winner = next(r for r in results if r.status_code == 201)
    winner_name = PRIYA_NAME if results[0].status_code == 201 else JONAH_NAME
    loser = next(r for r in results if r.status_code == 409).json()
    assert loser["error"] == "already_booked" and loser["bookedBy"] == winner_name
    assert loser["bookingId"] == winner.json()["booking"]["id"]
    parse_z(loser["bookedAt"])


def test_option_ladder_chips(browser: Browser, app_url: str) -> None:
    priya, jonah, director = sign_in(app_url, PRIYA), sign_in(app_url, JONAH), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    today, (d1, d2) = strip_days(app_url, "toronto", 2)
    a, b, c, e = (new_client(director) for _ in range(4))
    placed(priya, talent["id"], a["id"], d1)
    placed(jonah, talent["id"], b["id"], d1)
    placed(priya, talent["id"], c["id"], d2)
    placed(jonah, talent["id"], e["id"], d2)
    challenger = next(o for o in ladder_day(priya, talent["id"], d1)["options"] if o["rank"] == 2)
    ok(jonah.post(f"/api/options/{challenger['id']}/challenge", json={}), 200)
    with ui(browser, app_url, member=priya, motion=True) as page:
        grid = board_page(page, talent)
        button = day_button(grid, d1)
        expect(button).to_have_accessible_name(re.compile(
            rf"^{re.escape(day_label(d1))} 1st (?:.+ )?{re.escape(a['company'])}(?: .+)? 2nd {re.escape(b['company'])}$"))
        expect(button).to_have_attribute("data-day-state", "held")
        expect_chip(grid, a["company"], rank="1", state="challenged")
        expect(grid).to_contain_text("Challenged")
        expect_chip(grid, b["company"], rank="2", state="option")
        button.click()
        dialog = day_dialog(page, talent, d1)
        settle_all(page)
        motions(page)
        dialog.get_by_role("button", name="Release").first.click()
        expect(page.get_by_role("status", name="Board announcements")).to_have_text(
            f"Released {a['company']}'s option. {b['company']} now holds 1st.")
        expect(button).to_have_accessible_name(f"{day_label(d1)} 1st {b['company']}")
        expect_chip(grid, b["company"], rank="1", state="option")
        recorded: list[dict[str, Any]] = []

        def slid_and_rolled() -> bool:
            recorded.extend(motions(page))
            slid = any(m["chip"] and abs(m["duration"] - MIDDLE_MS) <= 1 and displacement(m)[1] < -1 for m in recorded)
            rolled = any(m["chip"] and abs(m["duration"] - LONG_MS) <= 1 for m in recorded)
            return slid and rolled

        eventually(slid_and_rolled, UI_WAIT, "no chip slid up its rung and then rolled its numeral")
        assert_published_durations(recorded)
        ok(confirm(priya, [confirm_row(challenger["id"])]), 201)
        page.reload()
        grid = page.get_by_role("grid", name=f"Availability for {talent['displayName']}")
        booked = day_button(grid, d1)
        expect(booked).to_have_attribute("data-day-state", "booked")
        expect(booked).to_have_accessible_name(f"{day_label(d1)} Booked {b['company']}")
    with ui(browser, app_url, member=priya, motion=True, reduced="reduce") as page:
        grid = board_page(page, talent)
        day_button(grid, d2).click()
        dialog = day_dialog(page, talent, d2)
        settle_all(page)
        motions(page)
        dialog.get_by_role("button", name="Release").first.click()
        expect(page.get_by_role("status", name="Board announcements")).to_have_text(
            f"Released {c['company']}'s option. {e['company']} now holds 1st.")
        expect_chip(grid, e["company"], rank="1", state="option")
        expect(day_button(grid, d2)).to_have_accessible_name(f"{day_label(d2)} 1st {e['company']}")
        for m in motions(page):
            dx, dy = displacement(m)
            assert abs(dx) <= 1 and abs(dy) <= 1, "a chip moved under reduced motion"
            assert m["duration"] <= SHORT_MS + 1


def test_wf_option_holds_keyboard(browser: Browser, app_url: str) -> None:
    director, jonah = sign_in(app_url, DIRECTOR), sign_in(app_url, JONAH)
    talent = new_talent(director)
    today, (d,) = strip_days(app_url, "toronto", 1)
    a, b = new_client(director), new_client(director)
    with ui(browser, app_url) as page:
        sign_in_ui(page, PRIYA)
        expect(page).to_have_url(re.compile(r"/workspace/board"))
        grid = board_page(page, talent)
        aa_audit(page)
        tab_into(page, grid)
        page.keyboard.press("Home")
        expect(day_button(grid, today)).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(day_button(grid, today + timedelta(days=WEEK))).to_be_focused()
        page.keyboard.press("ArrowUp")
        expect(day_button(grid, today)).to_be_focused()
        page.keyboard.press("End")
        expect(day_button(grid, today + timedelta(days=STRIP_DAYS - 1))).to_be_focused()
        page.keyboard.press("Home")
        for _ in range((d - today).days):
            page.keyboard.press("ArrowRight")
        target = day_button(grid, d)
        expect(target).to_be_focused()
        page.keyboard.press("Enter")
        dialog = day_dialog(page, talent, d)
        expect(dialog).to_be_visible()
        aa_audit(page)
        kb_type(dialog.get_by_role("textbox", name="Client"), a["company"])
        kb_type(dialog.get_by_role("textbox", name="Job title"), "Spring lookbook")
        kb_press(dialog.get_by_role("button", name="Place option"))
        status = page.get_by_role("status", name="Board announcements")
        expect(status).to_have_text(f"Placed 1st option for {a['company']} on {fmt_date(d)}.")
        expect(dialog).to_be_hidden()
        expect(target).to_be_focused()
        live = ladder_day(director, talent["id"], d)["options"]
        assert [(o["clientId"], o["rank"]) for o in live] == [(a["id"], 1)]

        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        kb_type(dialog.get_by_role("textbox", name="Client"), a["company"])
        kb_type(dialog.get_by_role("textbox", name="Job title"), SECOND_TITLE)
        kb_press(dialog.get_by_role("button", name="Place option"))
        refusal = f"{a['company']} already holds an option on this day."
        expect(dialog).to_contain_text(refusal)
        expect(dialog.get_by_role("textbox", name="Job title")).to_have_value(SECOND_TITLE)
        eventually(lambda: contains_focus(dialog) and refusal in focused_text(page), SLACK_SECONDS,
                   "focus did not move to the refusal")
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(target).to_be_focused()

        placed(jonah, talent["id"], b["id"], d)
        grid = board_page(page, talent)
        target = keyboard_to_day(page, grid, today, d)
        page.keyboard.press("Enter")
        kb_press(dialog.get_by_role("button", name="Release").first)
        expect(page.get_by_role("status", name="Board announcements")).to_have_text(
            f"Released {a['company']}'s option. {b['company']} now holds 1st.")
        expect(dialog).to_be_hidden()
        expect(target).to_be_focused()
    live = [o for o in ladder_day(director, talent["id"], d)["options"] if o["state"] == "placed"]
    assert [(o["clientId"], o["rank"]) for o in live] == [(b["id"], 1)]


def test_wf_option_holds_phone(browser: Browser, app_url: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    priya = sign_in(app_url, PRIYA)
    talent = new_talent(director)
    _, (d,) = strip_days(app_url, "toronto", 1)
    a = new_client(director)
    with ui(browser, app_url, viewport=PHONE, touch=True, member=priya) as page:
        grid = board_page(page, talent)
        layout(page)
        aa_audit(page)
        tap(day_button(grid, d))
        sheet = day_dialog(page, talent, d)
        expect(sheet).to_be_visible()
        aa_audit(page)
        sheet.get_by_role("textbox", name="Client").fill(a["company"])
        sheet.get_by_role("textbox", name="Job title").fill("Phone lookbook")
        action = sheet.get_by_role("button", name="Place option")
        box = action.bounding_box()
        assert box and box["y"] >= 0 and box["y"] + box["height"] <= PHONE["height"] + SUBPIXEL
        tap(action)
        expect(page.get_by_role("status", name="Board announcements")).to_have_text(
            f"Placed 1st option for {a['company']} on {fmt_date(d)}.")
        held = ladder_day(director, talent["id"], d)["options"]
        assert [o["rank"] for o in held] == [1]
        tap(day_button(grid, d))
        tap(sheet.get_by_role("button", name="Release").first)
        expect(page.get_by_role("status", name="Board announcements")).to_have_text(
            f"Released {a['company']}'s option.")
    assert get_option(director, held[0]["id"])["state"] == "released"
    assert not [o for o in ladder_day(director, talent["id"], d)["options"] if o["state"] in ("placed", "challenged")]


def test_wf_option_holds_session_ended(browser: Browser, app_url: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    _, (d,) = strip_days(app_url, "toronto", 1)
    a = new_client(director)
    priya = sign_in(app_url, PRIYA)
    with ui(browser, app_url, member=priya) as page:
        grid = board_page(page, talent)
        day_button(grid, d).click()
        dialog = day_dialog(page, talent, d)
        dialog.get_by_role("textbox", name="Client").fill(a["company"])
        dialog.get_by_role("textbox", name="Job title").fill(KEPT_TITLE)
        assert priya.delete("/api/session").status_code == 204
        dialog.get_by_role("button", name="Place option").click()
        expect(page.get_by_text("Your session ended. Your draft is kept; sign in again to finish.").first).to_be_visible()
        again = page.get_by_role("link", name="Sign in again")
        expect(again).to_be_visible()
        href = again.get_attribute("href") or ""
        assert urlparse(href).path == "/sign-in", href
        assert query(href).get("return", "").startswith("/workspace/board"), href
        again.click()
        page.get_by_role("textbox", name="Email").fill(PRIYA)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        expect(page).to_have_url(re.compile(r"/workspace/board"))
        dialog = day_dialog(page, talent, d)
        expect(dialog.get_by_role("textbox", name="Job title")).to_have_value(KEPT_TITLE)
        expect(dialog.get_by_role("textbox", name="Client")).to_have_value(a["company"])
        expect(page.get_by_role("status", name="Board announcements")).to_contain_text("Your draft was restored.")
    assert ladder_day(director, talent["id"], d)["options"] == []


RELEASE_CASES = ["toronto_mon", "toronto_after_dst", "vancouver_mon", "closure_skip", "director_closure", "sweep_release"]
RELEASE_EXAMPLES = {
    "toronto_mon": ("Toronto", date(2027, 3, 15), "2027-03-12T17:00:00Z"),
    "toronto_after_dst": ("Toronto", date(2027, 3, 16), "2027-03-15T16:00:00Z"),
    "vancouver_mon": ("Vancouver", date(2027, 3, 15), "2027-03-12T20:00:00Z"),
}
CLOSURE_SCAN_FROM = date(2027, 7, 5)


@pytest.mark.parametrize("case", RELEASE_CASES, ids=RELEASE_CASES)
def test_auto_release_instant(app_url: str, case: str) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    client = new_client(director)
    if case in RELEASE_EXAMPLES:
        office, day, expected = RELEASE_EXAMPLES[case]
        talent = new_talent(director, office=office)
        option = placed(priya, talent["id"], client["id"], day)
        assert option["autoReleaseAt"] == expected and option["releaseAt"] == expected
        return
    if case == "closure_skip":
        for office, day in (("Toronto", date(2027, 3, 29)), ("Vancouver", date(2027, 10, 1)), ("Toronto", date(2027, 10, 1))):
            talent = new_talent(director, office=office)
            option = placed(priya, talent["id"], client["id"], day)
            key = office.lower()
            assert option["autoReleaseAt"] == isoz(auto_release(day, key, PUBLISHED_CLOSURES[key]))
        return
    if case == "director_closure":
        closures = office_closures(app_url, "vancouver")
        d = CLOSURE_SCAN_FROM
        while not (business(d, closures) and business(d + timedelta(days=1), closures)):
            d += timedelta(days=1)
        job = d + timedelta(days=1)
        talent = new_talent(director, office="Vancouver")
        option = placed(priya, talent["id"], client["id"], job)
        assert option["autoReleaseAt"] == isoz(auto_release(job, "vancouver", closures))
        office = "vancouver"
        closures_path = f"/api/offices/{office}/closures"
        added = ok(director.post(closures_path, json={"date": d.isoformat()}), 201)
        assert d.isoformat() in added["closures"]
        moved = get_option(priya, option["id"])
        assert moved["autoReleaseAt"] == isoz(auto_release(job, office, closures | {d.isoformat()}))
        assert moved["autoReleaseAt"] != option["autoReleaseAt"]
        assert director.post(closures_path, json={"date": d.isoformat()}).status_code == 422
        assert director.post(closures_path, json={"date": "2028-01-04"}).status_code == 422
        return
    talent = new_talent(director)
    now = server_now(app_url)
    hold_at = (now + timedelta(seconds=20)).astimezone(ZoneInfo(ZONES["toronto"]))
    first = placed(priya, talent["id"], client["id"], GENERIC_DAY, hold=hold_at.strftime("%Y-%m-%dT%H:%M:%S"))
    second = placed(priya, talent["id"], new_client(director)["id"], GENERIC_DAY)
    release_at = parse_z(first["releaseAt"])
    assert first["holdUntil"] == first["releaseAt"] == isoz(hold_at)
    budget = (release_at - now).total_seconds() + SWEEP_SECONDS + SLACK_SECONDS
    eventually(lambda: get_option(priya, first["id"])["state"] == "expired", budget, "hold not released in time")
    assert server_now(app_url) <= release_at + timedelta(seconds=SWEEP_SECONDS + SLACK_SECONDS)
    expired = get_option(priya, first["id"])
    assert expired["releaseReason"] == "hold_expired" and expired["rank"] is None
    assert get_option(priya, second["id"])["rank"] == 1


HOLD_CASES = ["spring_gap", "autumn_first", "not_future", "not_before_release", "precedence"]


@pytest.mark.parametrize("case", HOLD_CASES, ids=HOLD_CASES)
def test_hold_until_rules(app_url: str, case: str) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    talent = new_talent(director)
    client = new_client(director)
    if case == "autumn_first":
        option = placed(priya, talent["id"], client["id"], date(2027, 11, 9))
        r = ok(priya.patch(f"/api/options/{option['id']}", json={"version": option["version"],
                                                                 "holdUntilLocal": "2027-11-07T01:30"}), 200)["option"]
        assert r["holdUntil"] == "2027-11-07T05:30:00Z" and r["releaseAt"] == "2027-11-07T05:30:00Z"
        assert r["version"] > option["version"]
        return
    option = placed(priya, talent["id"], client["id"], date(2027, 3, 16))

    def patch(value: str, version: int | None = None) -> httpx.Response:
        return priya.patch(f"/api/options/{option['id']}", json={"version": version or option["version"],
                                                                 "holdUntilLocal": value})

    def errors(r: httpx.Response) -> list[str]:
        body = err(r, 422, "validation")
        return list(body["errors"].values())

    if case == "spring_gap":
        gap_copy = f"That time does not exist in {CITIES['toronto']}: clocks skip that hour."
        assert gap_copy in errors(patch("2027-03-14T02:30"))
    elif case == "not_future":
        past = (server_now(app_url) - timedelta(days=1)).astimezone(ZoneInfo(ZONES["toronto"]))
        assert "Choose a time in the future." in errors(patch(past.strftime("%Y-%m-%dT%H:%M")))
    elif case == "not_before_release":
        copy = f"Choose a time before the automatic release at {fmt_time(parse_z('2027-03-15T16:00:00Z'), 'toronto')}."
        assert copy in errors(patch("2027-03-15T12:00"))
    else:
        ok(patch("2027-03-11T15:00"), 200)
        stale = err(patch("2027-03-14T02:30", version=option["version"]), 412, "stale_version")
        assert stale["savedBy"] == PRIYA_NAME
        ok(priya.post(f"/api/options/{option['id']}/release", json={}), 200)
        fresh = get_option(priya, option["id"])
        err(patch("2027-03-14T02:30", version=fresh["version"]), 409, "option_released")
        return
    after = get_option(priya, option["id"])
    assert after["holdUntil"] is None and after["version"] == option["version"]


def test_challenge_deadline(app_url: str, mail: Mailpit) -> None:
    director, priya, jonah = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA), sign_in(app_url, JONAH)
    talent = new_talent(director)
    a, b = new_client(director), new_client(director)
    first = placed(priya, talent["id"], a["id"], GENERIC_DAY)
    second = placed(jonah, talent["id"], b["id"], GENERIC_DAY)
    with app_copy(OPTION_CHALLENGE_SECONDS=SHORT_TTL) as short:
        jonah_short, priya_short = sign_in(short, JONAH), sign_in(short, PRIYA)
        before = server_now(short)
        ladder = ok(jonah_short.post(f"/api/options/{second['id']}/challenge", json={}), 200)["ladder"]
        after = server_now(short)
        deadline = parse_z(next(o for o in ladder if o["id"] == first["id"])["challengeDeadline"])
        ttl = int(SHORT_TTL)
        assert before + timedelta(seconds=ttl - 1) <= deadline <= after + timedelta(seconds=ttl + 1)
        eventually(lambda: server_now(app_url) >= deadline, ttl + SLACK_SECONDS, "deadline never passed")
        late = priya_short.post(f"/api/options/{first['id']}/release", json={})
        assert late.status_code == 409 and late.json()["error"] in ("challenge_expired", "option_released")
        late_confirm = confirm(priya_short, [confirm_row(first["id"])])
        assert late_confirm.status_code == 409 and late_confirm.json()["error"] in ("challenge_expired", "option_released")
        eventually(lambda: get_option(priya, first["id"])["state"] == "released",
                   SWEEP_SECONDS + SLACK_SECONDS, "sweep did not release the challenged 1st")
        assert get_option(priya, first["id"])["releaseReason"] == "challenge_timeout"
        assert get_option(priya, second["id"])["rank"] == 1
        subject = f"Option update: {talent['displayName']} on {fmt_date(GENERIC_DAY)}"
        to_a = exactly_mail(mail, mail_to(a["contactEmail"], subject))[0]
        to_b = exactly_mail(mail, mail_to(b["contactEmail"], subject))[0]
    assert "Your 1st option was released." in text(to_a) and b["company"] not in text(to_a)
    assert "Your option is now 1st." in text(to_b) and a["company"] not in text(to_b)


def ics_events(raw: bytes) -> tuple[str, dict[str, dict[str, str]]]:
    body = raw.decode("utf-8")
    assert not body.startswith("\ufeff")
    assert body.endswith("\r\n") and "\n" not in body.replace("\r\n", "")
    for line in body.split("\r\n"):
        assert len(line.encode()) <= ICS_LINE_OCTETS, line
    unfolded = re.sub(r"\r\n[ \t]", "", body)
    events: dict[str, dict[str, str]] = {}
    for block in re.findall(r"BEGIN:VEVENT\r\n(.*?)END:VEVENT", unfolded, re.S):
        props = {}
        for line in block.split("\r\n"):
            if ":" in line:
                head, value = line.split(":", 1)
                props[head] = value
        events[props["UID"]] = props
    return unfolded, events


def ics_unescape(value: str) -> str:
    return re.sub(r"\\([\\;,nN])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), value)


def test_calendar_feed(app_url: str, mail: Mailpit) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    talent = new_talent(director)
    member, _ = invite_and_accept(app_url, director, mail, "talent", talent_id=talent["id"])
    url = ok(member.get("/api/me/calendar-feed"), 200)["url"]
    path = urlparse(url).path
    assert re.fullmatch(rf"/feeds/[A-Za-z0-9_-]{{{FEED_TOKEN_MIN},}}\.ics", path)
    a, b = new_client(director), new_client(director)
    job = f"Autumn campaign; studio, two looks and a long description for folding {talent['slug']}"
    oa = placed(priya, talent["id"], a["id"], GENERIC_DAY, job=job)
    ob = placed(priya, talent["id"], b["id"], GENERIC_DAY, job=job)

    def feed() -> dict[str, dict[str, str]]:
        r = httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
        assert "charset=utf-8" in r.headers["content-type"].lower()
        whole, events = ics_events(r.content)
        assert f"X-WR-CALNAME:{talent['displayName']} — Rungboard" in whole
        return events

    def event(events: dict[str, dict[str, str]], option_id: str) -> dict[str, str]:
        e = events[f"option-{option_id}@rungboard.vesperrowe.example"]
        assert e["DTSTART;VALUE=DATE"] == GENERIC_DAY.strftime("%Y%m%d")
        assert e["DTEND;VALUE=DATE"] == (GENERIC_DAY + timedelta(days=1)).strftime("%Y%m%d")
        return e

    def summary(option: dict[str, Any], ordinal: str, company: str) -> str:
        return f"{ordinal} option: {job} for {company}, releases {fmt_time(parse_z(option['releaseAt']), 'toronto')}"

    events = feed()
    ea, eb = event(events, oa["id"]), event(events, ob["id"])
    assert (ea["STATUS"], ea["SEQUENCE"], ics_unescape(ea["SUMMARY"])) == ("TENTATIVE", "0", summary(oa, "1st", a["company"]))
    assert (eb["STATUS"], eb["SEQUENCE"], ics_unescape(eb["SUMMARY"])) == ("TENTATIVE", "0", summary(ob, "2nd", b["company"]))
    assert "\\;" in ea["SUMMARY"] and "\\," in ea["SUMMARY"]
    ok(priya.post(f"/api/options/{oa['id']}/release", json={}), 200)
    events = feed()
    ea, eb = event(events, oa["id"]), event(events, ob["id"])
    assert ea["STATUS"] == "CANCELLED" and ics_unescape(ea["SUMMARY"]) == summary(oa, "1st", a["company"])
    assert int(ea["SEQUENCE"]) >= 1
    assert eb["SEQUENCE"] == "1" and ics_unescape(eb["SUMMARY"]) == summary(ob, "1st", b["company"])
    ok(confirm(priya, [confirm_row(ob["id"])]), 201)
    eb = event(feed(), ob["id"])
    assert eb["STATUS"] == "CONFIRMED" and ics_unescape(eb["SUMMARY"]) == f"Booked: {job} for {b['company']}"
    assert eb["SEQUENCE"] == "2"
    new_url = ok(member.post("/api/me/calendar-feed", json={}), 201)["url"]
    new_path = urlparse(new_url).path
    assert new_path != path
    assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.get(f"{app_url}{new_path}", timeout=HTTP_TIMEOUT).status_code == 200


FEE_CASES = ["toronto_example", "vancouver_two_taxes", "group_split"]
SPLIT_FEES = {"women": (100002, 60001, 1001), "men": (100002, 60001, 1001), "creators": (100001, 60001, 1001),
              "new_faces": (90001, 50001, 1001)}
SPLIT_USAGE = {"digital": 60001, "print": 80001, "out_of_home": 120001, "broadcast": 200001}


@pytest.mark.parametrize("case", FEE_CASES, ids=FEE_CASES)
def test_booking_fees_exact(app_url: str, killbill: KillBill, case: str) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    client = new_client(director)
    if case == "toronto_example":
        talent = new_talent(director)
        option = placed(priya, talent["id"], client["id"], GENERIC_DAY)
        usage = [{"media": "digital", "territory": "north_america", "termMonths": 6}]
        assert confirm(priya, [confirm_row(option["id"], overtime=OVERTIME_MAX + 1)]).status_code == 422
        assert get_option(priya, option["id"])["rank"] == 1
        booking = ok(confirm(priya, [confirm_row(option["id"], overtime=50, usage=usage)]), 201)["booking"]
        rows = [{"talentId": talent["id"], "name": talent["displayName"], "board": "women", "dayType": "full_day",
                 "overtime": 50, "usage": usage}]
        expected = price(rows, SEED_CARD, SEED_USAGE, "toronto")
        assert (expected["talentFeesCents"], expected["serviceFeeCents"], expected["totalCents"]) == \
            (EXAMPLE_FEES, EXAMPLE_SERVICE, EXAMPLE_TOTAL)
        assert expected["taxCents"] == EXAMPLE_HST
    elif case == "vancouver_two_taxes":
        talent = new_talent(director, office="Vancouver", division="Men")
        option = placed(priya, talent["id"], client["id"], GENERIC_DAY)
        usage = [{"media": "print", "territory": "worldwide", "termMonths": 3}]
        booking = ok(confirm(priya, [confirm_row(option["id"], day_type="half_day", overtime=1, usage=usage)]), 201)["booking"]
        rows = [{"talentId": talent["id"], "name": talent["displayName"], "board": "men", "dayType": "half_day",
                 "overtime": 1, "usage": usage}]
        expected = price(rows, SEED_CARD, SEED_USAGE, "vancouver")
        assert [l["label"] for l in booking["lines"] if l["kind"] == "tax"].count("GST 5%") == 1
    else:
        effective, day, _ = late_card_window(director, app_url)
        token, _ = ns("card")
        card = ok(director.post("/api/rate-cards", json=card_body(f"Split {token}", effective, SPLIT_FEES, SPLIT_USAGE)), 201)
        talents = [new_talent(director, division=d) for d in ("Women", "Men", "Creators")]
        options = [placed(priya, t["id"], client["id"], day) for t in talents]
        booking = ok(confirm(priya, [confirm_row(o["id"]) for o in options]), 201)["booking"]
        assert booking["rateCard"]["id"] == card["id"]
        cards = {b: {"fullDayCents": f, "halfDayCents": h, "overtimeQuarterHourCents": q} for b, (f, h, q) in SPLIT_FEES.items()}
        rows = [{"talentId": t["id"], "name": t["displayName"], "board": t["board"], "dayType": "full_day",
                 "overtime": 0, "usage": []} for t in talents]
        expected = price(rows, cards, SPLIT_USAGE, "toronto")
        shares = [expected["talent"][t["id"]][1] for t in talents]
        assert shares[0] > shares[2], "fixture must exercise the leftover-cent rule"
    assert_priced(booking, expected)
    assert [l for l in booking["lines"] if l["kind"] == "service_fee"][0]["talentId"] is None
    account = killbill.account_by_key(f"rungboard-client-{client['slug']}")
    assert account and account.get("currency") == "CAD" and account.get("name") == client["company"]


def test_confirm_all_or_nothing(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    talent = new_talent(director)
    client = new_client(director)
    option = placed(priya, talent["id"], client["id"], GENERIC_DAY, job="Harbour shoot")
    booking = ok(confirm(priya, [confirm_row(option["id"])]), 201)["booking"]
    message = exactly_mail(mail, mail_to(client["contactEmail"], f"Booking confirmed: Harbour shoot on {fmt_date(GENERIC_DAY)}"))[0]
    assert f"booking-{booking['reference']}.ics" in attachment_names(message)
    movement = next(m for m in ledger(director, talent["id"])["movements"] if m["bookingId"] == booking["id"])
    assert movement["kind"] == "booking" and sum(e["amountCents"] for e in movement["entries"]) == 0
    account = killbill.account_by_key(f"rungboard-client-{client['slug']}")
    invoice = kb_invoice(killbill, booking["killbillInvoiceId"])
    assert account and invoice["accountId"] == account["accountId"] and invoice["status"] == "DRAFT", invoice
    assert kb_items(invoice) == sorted((line["label"], line["amountCents"]) for line in booking["lines"])

    down = outage("APP_KILLBILL_DOWN_URL")
    talent2 = new_talent(director)
    client2, other = new_client(director), new_client(director)
    first = placed(priya, talent2["id"], client2["id"], GENERIC_DAY, job="Outage shoot")
    second = placed(priya, talent2["id"], other["id"], GENERIC_DAY)
    priya_down = sign_in(down, PRIYA)
    err(confirm(priya_down, [confirm_row(second["id"])]), 409, "not_first")
    err(confirm(priya_down, [confirm_row(first["id"])]), 503, "billing_unavailable")
    after = get_option(priya, first["id"])
    assert after["state"] == "placed" and after["rank"] == 1
    assert ladder_day(priya, talent2["id"], GENERIC_DAY)["bookingId"] is None
    month = GENERIC_DAY.strftime("%Y-%m")
    assert all(b["clientId"] != client2["id"] for b in ok(priya.get("/api/bookings", params={"office": "toronto", "month": month}), 200)["bookings"])
    assert ledger(director, talent2["id"])["movements"] == []
    assert killbill.account_by_key(f"rungboard-client-{client2['slug']}") is None
    no_mail(mail, mail_to(client2["contactEmail"]))
    ok(priya.post(f"/api/options/{second['id']}/release", json={}), 200)
    err(priya.post("/api/bookings", content=json.dumps({"options": [confirm_row(second["id"])]}),
                   headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")


def test_rate_card_effective_dated(browser: Browser, app_url: str, mail: Mailpit) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    effective, new_day, cards = late_card_window(director, app_url)
    closures = office_closures(app_url, "toronto")
    old_day = effective - timedelta(days=1)
    while not business(old_day, closures):
        old_day -= timedelta(days=1)
    old_card = max((c for c in cards if date.fromisoformat(c["effectiveFrom"]) <= old_day),
                   key=lambda c: c["effectiveFrom"])
    token, _ = ns("card")
    new_fees = {b: (v["fullDayCents"] + 7, v["halfDayCents"] + 7, v["overtimeQuarterHourCents"] + 7)
                for b, v in old_card["boards"].items()}
    new_card = ok(director.post("/api/rate-cards", json=card_body(f"Later {token}", effective, new_fees,
                                                                  old_card["usageBaseCents"])), 201)
    talent = new_talent(director)
    client = new_client(director)
    old = book(priya, director, talent, client, old_day)
    new = book(priya, director, talent, client, new_day)
    assert old["rateCard"]["id"] == old_card["id"] and new["rateCard"]["id"] == new_card["id"]
    old_rate = old_card["boards"]["women"]["fullDayCents"]
    assert next(l for l in old["lines"] if l["kind"] == "day_rate")["amountCents"] == old_rate
    assert next(l for l in new["lines"] if l["kind"] == "day_rate")["amountCents"] == new_fees["women"][0]
    message = exactly_mail(mail, mail_to(client["contactEmail"], f"Booking confirmed: Spring lookbook on {fmt_date(old_day)}"))[0]
    assert old_card["name"] in text(message) and money(old_rate) in text(message)
    statement = ok(director.get(f"/api/talent/{talent['id']}/statements/{old_day.strftime('%Y-%m')}"), 200)
    assert any(l["amountCents"] == old["talentFeesCents"] for l in statement["lines"])
    with ui(browser, app_url, member=priya) as page:
        page.goto(f"/workspace/bookings/{old['id']}")
        expect(page.get_by_text(f"Day rate: {talent['displayName']}").first).to_be_visible()
        assert old_card["name"] in page_text(page) and money(old_rate) in page_text(page)


def test_confirmation_email_private(app_url: str, mail: Mailpit) -> None:
    director, priya, jonah = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA), sign_in(app_url, JONAH)
    ines, ava = seeded_talent(director, "ines-okoro"), seeded_talent(director, "ava-sinclair")
    closures = office_closures(app_url, "toronto")
    open_days: set[str] | None = None
    for t in (ines, ava):
        days: set[str] = set()
        start = date(2027, 5, 3)
        while start < date(2027, 11, 30):
            body = ok(director.get(f"/api/talent/{t['id']}/ladder", params={"from": start.isoformat(), "days": STRIP_DAYS}), 200)
            days |= {d["date"] for d in body["days"] if d["dayState"] == "open" and not d["options"]}
            start += timedelta(days=STRIP_DAYS)
        open_days = days if open_days is None else open_days & days
    day = min(date.fromisoformat(d) for d in open_days if business(date.fromisoformat(d), closures))
    client, rival = new_client(director), new_client(director)
    oi = placed(priya, ines["id"], client["id"], day, job="Private shoot")
    oa = placed(priya, ava["id"], client["id"], day, job="Private shoot")
    placed(jonah, ines["id"], rival["id"], day)
    booking = ok(confirm(priya, [confirm_row(oi["id"]), confirm_row(oa["id"])]), 201)["booking"]
    message = exactly_mail(mail, mail_to(client["contactEmail"], f"Booking confirmed: Private shoot on {fmt_date(day)}"))[0]
    body = text(message)
    assert f"booking-{booking['reference']}.ics" in attachment_names(message)
    for line in booking["lines"]:
        assert line["label"] in body and money(line["amountCents"]) in body
    for secret in PRIVATE_SEED + [rival["company"], ava.get("phone") or "", ines.get("phone") or ""]:
        if secret:
            assert secret not in body, secret


def confirm_by_keyboard(page: Page, talent: dict[str, Any], today: date, d: date) -> Any:
    grid = board_page(page, talent)
    keyboard_to_day(page, grid, today, d)
    page.keyboard.press("Enter")
    kb_press(day_dialog(page, talent, d).get_by_role("button", name="Confirm", exact=True))
    dialog = page.get_by_role("dialog", name="Confirm booking")
    kb_press(dialog.get_by_role("radiogroup", name="Day type").get_by_role("radio", name="Full day"), " ")
    kb_type(dialog.get_by_role("textbox", name="Overtime minutes"), "50")
    kb_press(dialog.get_by_role("button", name="Add usage"))
    select(dialog.get_by_role("combobox", name="Media"), "Digital")
    select(dialog.get_by_role("combobox", name="Territory"), "North America")
    select(dialog.get_by_role("combobox", name="Term"), "6 months")
    return dialog


def test_wf_bookings_and_fees_confirm_issue(browser: Browser, app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    director, jonah = sign_in(app_url, DIRECTOR), sign_in(app_url, JONAH)
    talent = new_talent(director)
    today, (d,) = strip_days(app_url, "toronto", 1)
    a, b = new_client(director), new_client(director)
    oa = placed(sign_in(app_url, PRIYA), talent["id"], a["id"], d, job="Coastline")
    ob = placed(jonah, talent["id"], b["id"], d)
    ok(jonah.post(f"/api/options/{ob['id']}/challenge", json={}), 200)
    with ui(browser, app_url) as page:
        sign_in_ui(page, PRIYA)
        expect(page).to_have_url(re.compile(r"/workspace/board"))
        dialog = confirm_by_keyboard(page, talent, today, d)
        aa_audit(page)
        with held(page, "**/api/bookings") as gate:
            kb_press(dialog.get_by_role("button", name="Confirm booking", exact=True))
            expect(dialog.get_by_role("button", name="Confirming booking…")).to_be_disabled()
            gate.release()
        view = page.get_by_role("link", name=re.compile(r"^View booking "))
        expect(view).to_be_focused()
        expect(page.get_by_role("status", name="Board announcements")).to_have_text(
            f"Booked {talent['displayName']} for {a['company']} on {fmt_date(d)}. The confirmation email is on its way.")
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/workspace/bookings/"))
        expect(page.get_by_text(f"Day rate: {talent['displayName']}").first).to_be_visible()
        aa_audit(page)
        booking_id = urlparse(page.url).path.rsplit("/", 1)[1]
        booking = ok(director.get(f"/api/bookings/{booking_id}"), 200)["booking"]
        assert booking["totalCents"] == EXAMPLE_TOTAL
        shown = page_text(page)
        for line in booking["lines"]:
            assert line["label"] in shown and money(line["amountCents"]) in shown
    assert get_option(director, oa["id"])["state"] == "confirmed"
    exactly_mail(mail, mail_to(a["contactEmail"], f"Booking confirmed: Coastline on {fmt_date(d)}"))
    subject = f"Option update: {talent['displayName']} on {fmt_date(d)}"
    assert "Your 1st option is confirmed." in text(exactly_mail(mail, mail_to(a["contactEmail"], subject))[0])
    assert "This day is now booked." in text(exactly_mail(mail, mail_to(b["contactEmail"], subject))[0])
    with ui(browser, app_url) as page:
        sign_in_ui(page, ROSA)
        page.goto(f"/workspace/bookings/{booking_id}")
        with held(page, "**/api/bookings/*/issue") as gate:
            page.get_by_role("button", name="Issue invoice").click()
            expect(page.get_by_role("button", name="Issuing invoice…")).to_be_disabled()
            gate.release()
        expect(page.get_by_text("Invoiced", exact=True)).to_be_focused()
        expect(page.get_by_role("status", name="Booking announcements")).to_have_text("Invoice issued in billing.")
    issued = ok(director.get(f"/api/bookings/{booking_id}"), 200)["booking"]
    assert issued["state"] == "invoiced" and issued["issuedBy"] == ROSA_NAME
    again = err(sign_in(app_url, ROSA).post(f"/api/bookings/{booking_id}/issue", json={}), 409, "already_invoiced")
    assert again["issuedBy"] == ROSA_NAME
    account = killbill.account_by_key(f"rungboard-client-{a['slug']}")
    invoice = kb_invoice(killbill, issued["killbillInvoiceId"])
    assert account and invoice["accountId"] == account["accountId"] and invoice["status"] == "COMMITTED", invoice
    assert kb_items(invoice) == sorted((line["label"], line["amountCents"]) for line in issued["lines"])


def test_wf_bookings_and_fees_refused(browser: Browser, app_url: str) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    talent = new_talent(director)
    today, (d,) = strip_days(app_url, "toronto", 1)
    option = placed(priya, talent["id"], new_client(director)["id"], d)
    with ui(browser, app_url, member=priya) as page:
        page.route("**/api/bookings", lambda route: route.fulfill(status=409, content_type="application/json",
                                                                  body=json.dumps({"error": "not_first"})))
        dialog = confirm_by_keyboard(page, talent, today, d)
        kb_press(dialog.get_by_role("button", name="Confirm booking", exact=True))
        copy = "Only the 1st option can be confirmed."
        expect(dialog).to_contain_text(copy)
        expect(dialog.get_by_role("textbox", name="Overtime minutes")).to_have_value("50")
        eventually(lambda: contains_focus(dialog) and copy in focused_text(page), SLACK_SECONDS, "focus not on refusal")
    after = get_option(priya, option["id"])
    assert after["state"] == "placed" and after["rank"] == 1


def test_wf_bookings_and_fees_billing_outage(browser: Browser, app_url: str) -> None:
    down = outage("APP_KILLBILL_DOWN_URL")
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    talent = new_talent(director)
    today, (d,) = strip_days(app_url, "toronto", 1)
    option = placed(priya, talent["id"], new_client(director)["id"], d)
    with ui(browser, down) as page:
        sign_in_ui(page, PRIYA)
        expect(page).to_have_url(re.compile(r"/workspace/board"))
        dialog = confirm_by_keyboard(page, talent, today, d)
        kb_press(dialog.get_by_role("button", name="Confirm booking", exact=True))
        expect(dialog).to_contain_text(
            "Billing is unreachable, so nothing was booked. The option is still 1st. Try again in a few minutes.")
    assert get_option(priya, option["id"])["rank"] == 1
    assert ladder_day(priya, talent["id"], d)["bookingId"] is None


def new_licence(staff: httpx.Client, client: dict[str, Any], talent: dict[str, Any], first_use: date,
                term: int, fee: int = 45000) -> dict[str, Any]:
    body = {"clientId": client["id"], "talentId": talent["id"], "media": "digital", "territory": "canada",
            "firstUseDate": first_use.isoformat(), "termMonths": term, "monthlyFeeCents": fee}
    return ok(staff.post("/api/licences", json=body), 201)["licence"]


def test_licence_terms(app_url: str, mail: Mailpit) -> None:
    rosa, director = sign_in(app_url, ROSA), sign_in(app_url, DIRECTOR)
    zone = "America/Halifax"
    client = new_client(director, tz=zone)
    talent = new_talent(director)
    one = new_licence(rosa, client, talent, date(2027, 1, 31), 1)
    two = new_licence(rosa, client, talent, date(2027, 1, 31), 2)
    assert one["endsOn"] == "2027-02-28" and two["endsOn"] == "2027-03-31"
    assert one["endsAt"] == isoz(datetime(2027, 3, 1, tzinfo=ZoneInfo(zone)))
    today = server_now(app_url).astimezone(ZoneInfo(zone)).date()
    with app_copy():
        cases = {
            "expiring": add_months(today + timedelta(days=10), -1),
            "expired": add_months(today, -3),
            "active": today,
        }
        made = {}
        for status, first_use in cases.items():
            term = 12 if status == "active" else 1
            lic = new_licence(rosa, client, talent, first_use, term)
            ends = add_months(first_use, term)
            assert lic["endsOn"] == ends.isoformat()
            assert lic["endsAt"] == isoz(datetime.combine(ends + timedelta(days=1), datetime.min.time(), ZoneInfo(zone)))
            expected = "expired" if ends < today else "expiring" if (ends - today).days < EXPIRING_WINDOW_DAYS else "active"
            assert lic["status"] == expected == status
            made[status] = lic
        listing = ok(rosa.get("/api/licences"), 200)
        for status in ("active", "expiring", "expired"):
            assert listing["counts"][status] == sum(1 for l in listing["licences"] if l["status"] == status)
        only = ok(rosa.get("/api/licences", params={"status": "expiring"}), 200)["licences"]
        assert made["expiring"]["id"] in {l["id"] for l in only} and made["active"]["id"] not in {l["id"] for l in only}
        end = date.fromisoformat(made["expiring"]["endsOn"])
        exactly_mail(mail, mail_to(client["contactEmail"], f"Usage licence ending {fmt_date(end)}: {talent['displayName']}"))
    no_mail(mail, mail_to(client["contactEmail"],
                          f"Usage licence ending {fmt_date(date.fromisoformat(made['active']['endsOn']))}: {talent['displayName']}"))


def extend(staff: httpx.Client, licence_id: str, months: int, version: int, key: str | None) -> httpx.Response:
    headers = {"Idempotency-Key": key} if key else {}
    return staff.post(f"/api/licences/{licence_id}/extensions", json={"months": months, "version": version}, headers=headers)


def test_licence_extension(app_url: str, killbill: KillBill) -> None:
    rosa, director = sign_in(app_url, ROSA), sign_in(app_url, DIRECTOR)
    client, talent = new_client(director), new_talent(director)
    start = office_today(app_url, "toronto")
    lic = new_licence(rosa, client, talent, start, 12)
    key = uuid.uuid4().hex
    first = extend(rosa, lic["id"], 3, lic["version"], key)
    body = ok(first, 201)
    assert body["licence"]["endsOn"] == add_months(start, 15).isoformat()
    assert body["extension"]["amountCents"] == 45000 * 3 and body["extension"]["killbillInvoiceId"]
    assert body["extension"]["extendedBy"] == ROSA_NAME and body["licence"]["version"] > lic["version"]
    replay = extend(rosa, lic["id"], 3, lic["version"], key)
    assert replay.status_code == 201 and replay.json() == body and replay.headers.get("Idempotent-Replayed") == "true"
    assert ok(rosa.get(f"/api/licences/{lic['id']}"), 200)["licence"]["endsOn"] == add_months(start, 15).isoformat()
    err(extend(rosa, lic["id"], 4, lic["version"], key), 409, "idempotency_key_reused")
    stale = err(extend(rosa, lic["id"], 2, lic["version"], uuid.uuid4().hex), 412, "stale_version")
    assert stale["savedBy"] == ROSA_NAME
    parse_z(stale["savedAt"])
    err(extend(rosa, lic["id"], 0, lic["version"], uuid.uuid4().hex), 412, "stale_version")
    err(extend(rosa, lic["id"], 2, body["licence"]["version"], None), 400, "idempotency_key_required")
    err(rosa.post(f"/api/licences/{lic['id']}/extensions", content="{}", headers={"Content-Type": "text/plain"}),
        415, "unsupported_media_type")
    current = ok(rosa.get(f"/api/licences/{lic['id']}"), 200)["licence"]
    err(extend(sign_in(outage("APP_KILLBILL_DOWN_URL"), ROSA), lic["id"], 1, current["version"], uuid.uuid4().hex),
        503, "billing_unavailable")
    after = ok(rosa.get(f"/api/licences/{lic['id']}"), 200)["licence"]
    assert (after["version"], after["endsOn"]) == (current["version"], current["endsOn"])
    account = killbill.account_by_key(f"rungboard-client-{client['slug']}")
    invoice = kb_invoice(killbill, body["extension"]["killbillInvoiceId"])
    assert account and invoice["accountId"] == account["accountId"] and invoice["status"] == "COMMITTED", invoice
    renewal = f"Usage licence renewal: {talent['displayName']}, {MEDIA_NAMES['digital']}, {TERRITORY_NAMES['canada']}, 3 months"
    assert kb_items(invoice) == [(renewal, 45000 * 3)]


def phone_extend(page: Page, company: str, months: str, audit: bool = False) -> Any:
    card = page.get_by_role("list", name="Licences").get_by_role("article").filter(has_text=company)
    expect(card).to_be_visible()
    inside = card.get_by_role("button", name="Extend", exact=True)
    if inside.count():
        tap(inside)
    else:
        tap(card)
        tap(page.get_by_role("button", name="Extend", exact=True))
    dialog = page.get_by_role("dialog", name="Extend licence")
    if audit:
        expect(dialog).to_be_visible()
        aa_audit(page)
    dialog.get_by_role("textbox", name="Months").fill(months)
    tap(dialog.get_by_role("button", name="Extend licence"))
    return card


def test_wf_usage_licences_phone(browser: Browser, app_url: str) -> None:
    rosa, director = sign_in(app_url, ROSA), sign_in(app_url, DIRECTOR)
    client, talent = new_client(director), new_talent(director)
    start = office_today(app_url, "toronto")
    lic = new_licence(rosa, client, talent, start, 12)
    with ui(browser, app_url, viewport=PHONE, touch=True) as page:
        sign_in_ui(page, ROSA)
        expect(page).to_have_url(re.compile(r"/workspace/licences"))
        card = page.get_by_role("list", name="Licences").get_by_role("article").filter(has_text=client["company"])
        expect(card).to_contain_text(fmt_date(date.fromisoformat(lic["endsOn"])))
        layout(page)
        aa_audit(page)
        phone_extend(page, client["company"], "3", audit=True)
        new_end = add_months(start, 15)
        status = page.get_by_role("status", name="Licence announcements")
        expect(status).to_have_text(f"Extended {talent['displayName']}'s licence by 3 months to {fmt_date(new_end)}.")
        eventually(lambda: fmt_date(new_end) in focused_text(page), SLACK_SECONDS, "focus not on the end date")
        current = ok(rosa.get(f"/api/licences/{lic['id']}"), 200)["licence"]
        assert current["endsOn"] == new_end.isoformat()
        meanwhile = ok(extend(rosa, lic["id"], 1, current["version"], uuid.uuid4().hex), 201)
        phone_extend(page, client["company"], "2")
        at = fmt_time(parse_z(meanwhile["extension"]["extendedAt"]), "toronto")
        expect(status).to_have_text(f"{ROSA_NAME} extended this licence at {at}. Check the new end date before extending again.")
    assert ok(rosa.get(f"/api/licences/{lic['id']}"), 200)["licence"]["endsOn"] == add_months(start, 16).isoformat()


def test_wf_usage_licences_billing_outage(browser: Browser, app_url: str) -> None:
    down = outage("APP_KILLBILL_DOWN_URL")
    rosa, director = sign_in(app_url, ROSA), sign_in(app_url, DIRECTOR)
    client, talent = new_client(director), new_talent(director)
    lic = new_licence(rosa, client, talent, office_today(app_url, "toronto"), 12)
    with ui(browser, down, viewport=PHONE, touch=True) as page:
        sign_in_ui(page, ROSA)
        page.goto("/workspace/licences")
        phone_extend(page, client["company"], "3")
        expect(page.get_by_role("status", name="Licence announcements")).to_have_text(
            "Billing is unreachable, so nothing was saved. Try again in a few minutes.")
    after = ok(rosa.get(f"/api/licences/{lic['id']}"), 200)["licence"]
    assert (after["version"], after["endsOn"]) == (lic["version"], lic["endsOn"])


def advance(staff: httpx.Client, talent_id: str, cents: int, note: str = "Travel to Vancouver shoot") -> dict[str, Any]:
    return ok(staff.post(f"/api/talent/{talent_id}/advances", json={"amountCents": cents, "note": note}), 201)["movement"]


def test_paired_ledger(app_url: str) -> None:
    rosa, priya, director = sign_in(app_url, ROSA), sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director, division="New Faces")
    client = new_client(director)
    older = advance(rosa, talent["id"], 50000)
    newer = advance(rosa, talent["id"], 40000)
    assert sorted((e["account"], e["amountCents"]) for e in older["entries"]) == \
        sorted([(f"talent:{talent['id']}", -50000), ("agency_cash", 50000)])
    same_month = month_end_job_day(app_url, "toronto")
    job_day = same_month or GENERIC_DAY
    booking = book(priya, director, talent, client, job_day, day_type="half_day")
    fees = SEED_CARD["new_faces"]["halfDayCents"]
    movement = next(m for m in ledger(rosa, talent["id"])["movements"] if m["bookingId"] == booking["id"])
    accounts = {e["account"]: e["amountCents"] for e in movement["entries"]}
    assert accounts[f"talent:{talent['id']}"] == fees and accounts["agency_fees"] == booking["serviceFeeCents"]
    assert accounts["tax_payable"] == booking["taxCents"] and accounts[f"client:{client['id']}"] == -booking["totalCents"]

    def check() -> dict[str, Any]:
        book_ = ledger(rosa, talent["id"])
        for m in book_["movements"]:
            assert sum(e["amountCents"] for e in m["entries"]) == 0
        assert book_["balanceCents"] == sum(talent_entries(m, talent["id"]) for m in book_["movements"])
        return book_

    assert check()["balanceCents"] == fees - 90000
    months = sorted({office_today(app_url, "toronto").strftime("%Y-%m"), job_day.strftime("%Y-%m")})
    recouped = {older["id"]: (50000, 0), newer["id"]: (fees - 50000, 90000 - fees)}
    unrecouped = {older["id"]: (0, 50000), newer["id"]: (0, 40000)}

    def listed(month: str) -> dict[str, tuple[int, int]]:
        rows = ok(rosa.get(f"/api/talent/{talent['id']}/statements/{month}"), 200)["advances"]
        return {a["movementId"]: (a["recoupedCents"], a["outstandingCents"]) for a in rows if a["movementId"] in recouped}

    first, last = listed(months[0]), listed(months[-1])
    if same_month:
        assert first == recouped
    else:
        assert first in (recouped, unrecouped) and last in (recouped, {})
    reversal = ok(rosa.post(f"/api/ledger/movements/{newer['id']}/reversal", json={"reason": "Advance keyed twice"}), 201)["movement"]
    assert reversal["kind"] == "reversal" and reversal["reversalOf"] == newer["id"]
    assert sorted((e["account"], e["amountCents"]) for e in reversal["entries"]) == \
        sorted((e["account"], -e["amountCents"]) for e in newer["entries"])
    original = next(m for m in check()["movements"] if m["id"] == newer["id"])
    assert original["reversedBy"] and original["entries"] == newer["entries"]
    assert check()["balanceCents"] == fees - 50000
    again = err(rosa.post(f"/api/ledger/movements/{newer['id']}/reversal", json={"reason": "again"}), 409, "already_reversed")
    assert again["reversedBy"] == ROSA_NAME
    err(priya.post(f"/api/ledger/movements/{newer['id']}/reversal", json={"reason": "x"}), 403, "forbidden")
    err(rosa.post(f"/api/ledger/movements/{newer['id']}/reversal", content="{}", headers={"Content-Type": "text/plain"}),
        415, "unsupported_media_type")
    err(rosa.post(f"/api/ledger/movements/{movement['id']}/reversal", json={"reason": "early"}), 409, "not_invoiced")
    ok(rosa.post(f"/api/bookings/{booking['id']}/issue", json={}), 200)
    err(sign_in(outage("APP_KILLBILL_DOWN_URL"), ROSA).post(f"/api/ledger/movements/{movement['id']}/reversal",
                                                            json={"reason": "wrong job"}), 503, "billing_unavailable")
    assert len(check()["movements"]) == 4
    ok(rosa.post(f"/api/ledger/movements/{movement['id']}/reversal", json={"reason": "wrong job"}), 201)
    assert ok(rosa.get(f"/api/bookings/{booking['id']}"), 200)["booking"]["state"] == "corrected"
    assert check()["balanceCents"] == -50000


def test_monthly_statements(app_url: str, mail: Mailpit) -> None:
    rosa, priya, director = sign_in(app_url, ROSA), sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    member, _ = invite_and_accept(app_url, director, mail, "talent", talent_id=talent["id"])
    adv = advance(rosa, talent["id"], 50000)
    booking = book(priya, director, talent, new_client(director), date(2027, 9, 30))
    now_month = office_today(app_url, "toronto").strftime("%Y-%m")

    def statement(month: str) -> dict[str, Any]:
        s = ok(rosa.get(f"/api/talent/{talent['id']}/statements/{month}"), 200)
        running = s["openingBalanceCents"]
        for line in s["lines"]:
            running += line["amountCents"]
            assert line["balanceCents"] == running
        assert s["totals"]["netCents"] == sum(l["amountCents"] for l in s["lines"])
        assert s["closingBalanceCents"] == s["openingBalanceCents"] + s["totals"]["netCents"]
        return s

    sept = statement("2027-09")
    assert [l["amountCents"] for l in sept["lines"]] == [booking["talentFeesCents"]]
    assert sept["openingBalanceCents"] == -50000
    assert statement("2027-10")["lines"] == []
    ok(rosa.post(f"/api/ledger/movements/{adv['id']}/reversal", json={"reason": "Advance keyed twice"}), 201)
    current = statement(now_month)
    assert sorted(l["kind"] for l in current["lines"]) == ["advance", "reversal"]
    assert current["totals"]["netCents"] == 0
    assert statement("2027-09")["closingBalanceCents"] == booking["talentFeesCents"]
    ok(member.get(f"/api/talent/{talent['id']}/statements/{now_month}"), 200)
    ines = seeded_talent(director, "ines-okoro")
    other = member.get(f"/api/talent/{ines['id']}/statements/{now_month}")
    unknown = member.get(f"/api/talent/unknown-talent-id/statements/{now_month}")
    assert (other.status_code, other.json()) == (unknown.status_code, unknown.json()) == (404, {"error": "not_found"})
    assert member.get(f"/api/talent/{ines['id']}/ledger").status_code == 404


def test_statement_csv(app_url: str, s3: S3) -> None:
    rosa, priya, director = sign_in(app_url, ROSA), sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    token, _ = ns("formula")
    company = f'=HYPERLINK("http://x","{token}")'
    client = new_client(director, company=company)
    booking = book(priya, director, talent, client, GENERIC_DAY)
    month = GENERIC_DAY.strftime("%Y-%m")
    r = rosa.get(f"/api/talent/{talent['id']}/statements/{month}.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"] == f'attachment; filename="statement-{talent["slug"]}-{month}.csv"'
    raw = r.content
    assert not raw.startswith(b"\xef\xbb\xbf") and raw.endswith(b"\r\n")
    lines = raw.decode().split("\r\n")[:-1]
    field = r'"(?:[^"]|"")*"'
    assert all(re.fullmatch(rf"{field}(,{field})*", line) for line in lines)
    rows = list(csv.reader(io.StringIO(raw.decode(), newline="")))
    assert rows[0] == CSV_COLUMNS
    for row in rows[1:]:
        for cell in row[2:5]:
            assert not cell.startswith(FORMULA_TRIGGERS), cell
        assert re.fullmatch(r"-?\d+\.\d{2}", row[5]) and re.fullmatch(r"-?\d+\.\d{2}", row[6])
    line = next(row for row in rows[1:] if row[1] == "Booking")
    assert line[3] == "'" + company and line[5] == plain_amount(booking["talentFeesCents"])
    assert s3.get(f"statements/{talent['id']}/{month}.csv") == raw
    adv = advance(rosa, talent["id"], 50000, note=f"+SUM(1) {token}")
    now_month = office_today(app_url, "toronto").strftime("%Y-%m")
    rows = list(csv.reader(io.StringIO(rosa.get(f"/api/talent/{talent['id']}/statements/{now_month}.csv").text, newline="")))
    adv_row = next(row for row in rows[1:] if row[1] == "Advance")
    assert adv_row[5] == "-500.00" and adv_row[2].lstrip("'") == adv["reference"]
    assert all(not c.startswith(FORMULA_TRIGGERS) for c in adv_row[2:5])
    err(sign_in(outage("APP_MINIO_DOWN_URL"), ROSA).get(f"/api/talent/{talent['id']}/statements/{month}.csv"),
        503, "storage_unavailable")


def test_wf_talent_statements_keyboard(browser: Browser, app_url: str, s3: S3) -> None:
    rosa, director = sign_in(app_url, ROSA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    today = office_today(app_url, "toronto")
    month = today.strftime("%Y-%m")
    with ui(browser, app_url, member=rosa) as page:
        page.goto(f"/workspace/statements/{talent['id']}/{month}")
        expect(page.get_by_role("region", name="Statement lines")).to_be_visible()
        aa_audit(page)
        kb_press(page.get_by_role("button", name="Record advance"))
        dialog = page.get_by_role("dialog", name="Record advance")
        kb_type(dialog.get_by_role("textbox", name="Note"), NOTE_PROBE)
        kb_press(dialog.get_by_role("button", name="Save advance"))
        problem = dialog.get_by_role("region", name="Problems").get_by_role("link", name=required_copy("Amount"))
        expect(problem).to_be_visible()
        expect(dialog.get_by_role("textbox", name="Note")).to_have_value(NOTE_PROBE)
        aa_audit(page)
        kb_press(problem)
        expect(dialog.get_by_role("textbox", name="Amount")).to_be_focused()
        advance_cents = int(STATEMENT_ADVANCE.replace(".", ""))
        kb_type(dialog.get_by_role("textbox", name="Amount"), STATEMENT_ADVANCE)
        kb_press(dialog.get_by_role("button", name="Save advance"))
        expect(dialog).to_be_hidden()
        status = page.get_by_role("status", name="Statement announcements")
        expect(status).to_have_text(f"Recorded an advance of {money(advance_cents)} for {talent['displayName']}.")
        table = page.get_by_role("table", name="Statement")
        eventually(lambda: contains_focus(table), SLACK_SECONDS, "focus not on the new row")
        movement = next(m for m in ledger(rosa, talent["id"])["movements"] if m["kind"] == "advance")
        assert talent_entries(movement, talent["id"]) == -advance_cents
        row = table.get_by_role("row").filter(has_text=movement["reference"])
        kb_press(row.get_by_role("button", name="Reverse"))
        reverse = page.get_by_role("dialog", name="Reverse entry")
        kb_type(reverse.get_by_role("textbox", name="Reason"), "Keyed twice")
        kb_press(reverse.get_by_role("button", name="Reverse entry"))
        expect(reverse).to_be_hidden()
        expect(status).to_have_text(f"Reversed {movement['reference']}. The balance is now {money(0)}.")
        eventually(lambda: contains_focus(table), SLACK_SECONDS, "focus not on the reversal row")
        export = page.get_by_role("button", name="Export CSV")
        with page.expect_download() as download:
            kb_press(export)
        assert download.value.suggested_filename == f"statement-{talent['slug']}-{month}.csv"
        expect(status).to_have_text(f"Statement for {fmt_month(today)} downloaded.")
        expect(export).to_be_focused()
    assert ledger(rosa, talent["id"])["balanceCents"] == 0
    assert s3.get(f"statements/{talent['id']}/{month}.csv")


def pinned_first_column(page: Page, region: Any, table: Any) -> None:
    layout(page)
    first = table.get_by_role("row").nth(1).get_by_role("cell").or_(table.get_by_role("row").nth(1).get_by_role("rowheader")).first
    before = first.bounding_box()
    region.evaluate("(r) => { r.scrollLeft = r.scrollWidth; }")
    after = first.bounding_box()
    assert before and after and abs(before["x"] - after["x"]) <= 1, "first column scrolled away"
    layout(page)


def test_wf_talent_statements_phone(browser: Browser, app_url: str) -> None:
    rosa, director = sign_in(app_url, ROSA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    advance(rosa, talent["id"], 50000)
    month = office_today(app_url, "toronto").strftime("%Y-%m")
    with ui(browser, app_url, viewport=PHONE, touch=True, member=rosa) as page:
        page.goto(f"/workspace/statements/{talent['id']}/{month}")
        region = page.get_by_role("region", name="Statement lines")
        pinned_first_column(page, region, region.get_by_role("table", name="Statement"))
        aa_audit(page)


PROFILE_KEYS = CARD_KEYS | {"portfolio"}


def test_package_link_lifecycle(app_url: str, mail: Mailpit) -> None:
    priya, director = sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    package = new_package(priya, [talent["id"]])
    message = exactly_mail(mail, mail_to(package["recipientEmail"], f"Casting package: {package['title']}"))[0]
    token = link_token(text(message), "/p/")
    assert token == package_token(package)
    anon = http(app_url)
    ok(anon.get(f"/api/p/{token}"), 200)
    decided = ok(anon.put(f"/api/p/{token}/decisions/{talent['slug']}", json={"decision": "shortlisted"}), 200)
    assert decided == {"slug": talent["slug"], "decision": "shortlisted", "shortlistedCount": 1}
    for method, path in (("POST", f"/api/p/{token}"), ("DELETE", f"/api/p/{token}"),
                         ("POST", f"/api/p/{token}/decisions/{talent['slug']}")):
        r = anon.request(method, path, json={})
        err(r, 405, "method_not_allowed")
        assert r.headers.get("Allow")
    ok(priya.post(f"/api/packages/{package['id']}/revoke", json={}), 200)
    err(anon.get(f"/api/p/{token}"), 410, "link_revoked")
    err(anon.put(f"/api/p/{token}/decisions/{talent['slug']}", json={"decision": "passed"}), 410, "link_revoked")
    err(anon.put(f"/api/p/{token}/decisions/{talent['slug']}", content="x", headers={"Content-Type": "text/plain"}),
        410, "link_revoked")
    err(anon.post(f"/api/p/{token}", json={}), 405, "method_not_allowed")
    err(priya.post(f"/api/packages/{package['id']}/revoke", json={}), 409, "already_revoked")
    fresh = ok(priya.post(f"/api/packages/{package['id']}/regenerate", json={}), 200)["package"]
    assert fresh["state"] == "active"
    replaced = ok(anon.get(f"/api/p/{token}"), 410)
    assert replaced["error"] in ("link_replaced", "link_revoked"), replaced
    view = ok(anon.get(f"/api/p/{package_token(fresh)}"), 200)
    assert view["talent"][0]["decision"] == "shortlisted"
    with app_copy(PACKAGE_LINK_TTL_SECONDS=SHORT_TTL) as short:
        short_pkg = new_package(sign_in(short, PRIYA), [talent["id"]])
        assert (parse_z(short_pkg["expiresAt"]) - parse_z(short_pkg["issuedAt"])).total_seconds() == int(SHORT_TTL)
        short_token = package_token(short_pkg)
        reader = http(short)
        ok(reader.get(f"/api/p/{short_token}"), 200)
        eventually(lambda: reader.get(f"/api/p/{short_token}").status_code == 410, int(SHORT_TTL) + SLACK_SECONDS,
                   "package link never expired")
        err(reader.get(f"/api/p/{short_token}"), 410, "link_expired")


def test_package_published_fields(app_url: str) -> None:
    priya, director = sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    keep, leave = new_talent(director), new_talent(director)
    token = package_token(new_package(priya, [keep["id"], leave["id"]]))
    anon = http(app_url)
    ok(anon.put(f"/api/p/{token}/decisions/{leave['slug']}", json={"decision": "shortlisted"}), 200)
    view = ok(anon.get(f"/api/p/{token}"), 200)
    assert set(view) == {"title", "expiresAt", "shortlistedCount", "talent"}
    for t in view["talent"]:
        assert set(t) == PROFILE_KEYS | {"decision"}
    assert view["shortlistedCount"] == 1
    ok(director.post(f"/api/talent/{leave['id']}/withdraw", json={}), 200)
    view = ok(anon.get(f"/api/p/{token}"), 200)
    assert [t["slug"] for t in view["talent"]] == [keep["slug"]] and view["shortlistedCount"] == 0
    err(anon.put(f"/api/p/{token}/decisions/{leave['slug']}", json={"decision": "passed"}), 404, "not_found")


def test_package_zip(app_url: str, s3: S3) -> None:
    priya, director = sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    ok(upload_photo(priya, talent["id"], tagged_photo()), 201)
    ok(upload_photo(priya, talent["id"]), 201)
    package = new_package(priya, [talent["id"]])
    token = package_token(package)
    r = httpx.get(f"{app_url}/api/p/{token}/photos.zip", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/zip")
    archive = zipfile.ZipFile(io.BytesIO(r.content))
    names = archive.namelist()
    assert all(".." not in n and not n.startswith("/") for n in names)
    photos = sorted(n for n in names if n != "manifest.json")
    assert photos == [f"{talent['slug']}/01.jpg", f"{talent['slug']}/02.jpg"]
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["package"] == package["title"]
    parse_z(manifest["generatedAt"])
    assert sorted(f["name"] for f in manifest["files"]) == photos
    for f in manifest["files"]:
        data = archive.read(f["name"])
        assert f["bytes"] == len(data) and f["sha256"] == hashlib.sha256(data).hexdigest()
    assert_clean_rotated(archive.read(f"{talent['slug']}/01.jpg"), 20, 40)
    assert f"packages/{package['id']}/photos.zip" in s3.keys(f"packages/{package['id']}/")
    err(httpx.get(f"{outage('APP_MINIO_DOWN_URL')}/api/p/{token}/photos.zip", timeout=HTTP_TIMEOUT),
        503, "storage_unavailable")


def test_wf_casting_packages_phone(browser: Browser, app_url: str) -> None:
    priya, director = sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    talents = [new_talent(director) for _ in range(4)]
    package = new_package(priya, [t["id"] for t in talents])
    with ui(browser, app_url, viewport=PHONE, touch=True) as page:
        page.goto(f"/p/{package_token(package)}")
        expect(page.get_by_role("article", name=talents[0]["displayName"])).to_be_visible()
        aa_audit(page)
        choices = ["Shortlist", "Shortlist", "Pass"]
        for t, choice in zip(talents, choices):
            card = page.get_by_role("article", name=t["displayName"])
            tap(card.get_by_role("button", name=choice))
            expect(card.get_by_role("button", name=choice, pressed=True)).to_be_visible()
        expect(page.get_by_role("status").filter(has_text=f"{choices.count('Shortlist')} shortlisted").first).to_be_visible()
        expect(page.get_by_role("status", name="Package announcements")).to_have_text(f"Passed on {talents[2]['displayName']}.")
        with page.expect_download():
            tap(page.get_by_role("button", name="Download photos"))
        expect(page.get_by_role("status", name="Package announcements")).to_have_text("Your download has started.")
        layout(page)

        def saved() -> list[str]:
            staff = ok(priya.get(f"/api/packages/{package['id']}"), 200)
            decisions = {t["talentId"]: t["decision"] for t in staff.get("package", staff)["talent"]}
            return [decisions[t["id"]] for t in talents]

        eventually(lambda: saved() == ["shortlisted", "shortlisted", "passed", "undecided"], SLACK_SECONDS,
                   "choices not saved")
    ok(priya.post(f"/api/packages/{package['id']}/regenerate", json={}), 200)
    with ui(browser, app_url, viewport=PHONE, touch=True) as page:
        page.goto(f"/p/{package_token(package)}")
        expect(page.get_by_role("heading", name="This package link no longer opens")).to_be_visible()
        expect(page.get_by_text("Ask your Vesper & Rowe booker for a new link.").first).to_be_visible()


def test_wf_casting_packages_rollback(browser: Browser, app_url: str) -> None:
    priya, director = sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    t1, t2 = new_talent(director), new_talent(director)
    package = new_package(priya, [t1["id"], t2["id"]])
    with ui(browser, app_url, viewport=PHONE, touch=True) as page:
        page.goto(f"/p/{package_token(package)}")
        announce = page.get_by_role("status", name="Package announcements")
        expect(page.get_by_role("article", name=t2["displayName"])).to_be_visible()
        ok(director.post(f"/api/talent/{t2['id']}/withdraw", json={}), 200)
        tap(page.get_by_role("article", name=t2["displayName"]).get_by_role("button", name="Shortlist"))
        expect(announce).to_have_text(f"{t2['displayName']} is no longer in this package.")
        card = page.get_by_role("article", name=t1["displayName"])
        with held(page, "**/api/p/*/decisions/*") as gate:
            tap(card.get_by_role("button", name="Shortlist"))
            expect(card.get_by_role("button", name="Shortlist", pressed=True)).to_be_visible()
            ok(priya.post(f"/api/packages/{package['id']}/revoke", json={}), 200)
            gate.release()
        expect(announce).to_have_text(f"This package link was revoked, so your choice for {t1['displayName']} was not saved.")
        expect(card.get_by_role("button", name="Shortlist", pressed=False)).to_be_visible()
        expect(page.get_by_role("status").filter(has_text=f"{0} shortlisted").first).to_be_visible()
    with app_copy(PACKAGE_LINK_TTL_SECONDS=SHORT_TTL) as short:
        short_pkg = new_package(sign_in(short, PRIYA), [t1["id"]])
        token = package_token(short_pkg)
        with ui(browser, short, viewport=PHONE, touch=True) as page:
            page.goto(f"/p/{token}")
            card = page.get_by_role("article", name=t1["displayName"])
            expect(card).to_be_visible()
            eventually(lambda: httpx.get(f"{short}/api/p/{token}").status_code == 410, int(SHORT_TTL) + SLACK_SECONDS,
                       "link never expired")
            tap(card.get_by_role("button", name="Pass"))
            expect(page.get_by_role("status", name="Package announcements")).to_have_text(
                f"This package link has expired, so your choice for {t1['displayName']} was not saved.")
            expect(card.get_by_role("button", name="Pass", pressed=False)).to_be_visible()


FAMILY = "\U0001F468\u200D\U0001F469\u200D\U0001F467\u200D\U0001F466"
FLAG = "\U0001F1E8\U0001F1E6"
ACCENT = "e\u0301"


def test_application_limits(browser: Browser, app_url: str) -> None:
    app_id, token = new_draft(app_url)
    headers = {"X-Application-Token": token}

    def patch(bio: str) -> httpx.Response:
        return httpx.patch(f"{app_url}/api/applications/{app_id}", json={"bio": bio}, headers=headers, timeout=HTTP_TIMEOUT)

    def put(data: bytes, name: str = "front.jpg", ctype: str = "image/jpeg", tok: str = token) -> httpx.Response:
        return httpx.put(f"{app_url}/api/applications/{app_id}/photos/front", headers={"X-Application-Token": tok},
                         files={"file": (name, data, ctype)}, timeout=HTTP_TIMEOUT)

    full = (FAMILY + FLAG + ACCENT) * (BIO_LIMIT // 3)
    ok(patch(full), 200)
    over = err(patch(full + "a"), 422, "validation")
    assert f"Your bio is {BIO_LIMIT + 1} characters; the limit is 600." in over["errors"].values()
    edge_photo = padded_jpeg(APP_PHOTO_LIMIT)
    edge = ok(put(edge_photo), 200)
    assert edge["slot"] == "front" and edge["width"] == image_width(edge_photo)
    assert err(put(padded_jpeg(APP_PHOTO_LIMIT + 1)), 413, "too_large")["limitBytes"] == APP_PHOTO_LIMIT
    assert err(put(SVG + b" " * APP_PHOTO_LIMIT), 413, "too_large")["limitBytes"] == APP_PHOTO_LIMIT
    svg = err(put(SVG), 422, "validation")
    assert svg["errors"]["file"] == "That file is not a JPEG, PNG or WebP photo."
    assert ok(put(png(), name="photo.txt", ctype="text/plain"), 200)["width"] == image_width(png())
    err(put(padded_jpeg(APP_PHOTO_LIMIT + 1), tok="wrong-token"), 404, "not_found")
    with ui(browser, app_url, ip=fresh_ip()) as page:
        page.goto("/apply")
        bio = page.get_by_role("textbox", name="Bio")
        fill_shown(page, {"First name": "Ava", "Last name": "Rowe", "Email": ns("apply")[1], "Date of birth": "1999-04-03",
                          "Height": "171", "Instagram followers": "1200"}, {"Office": "Toronto", "Height unit": "cm"},
                   choose)
        if not bio.is_visible():
            next_step(page, lambda button: button.click())
        expect(bio).to_be_visible()
        assert bio.get_attribute("maxlength") is None
        graphemes = [FAMILY, FAMILY, FAMILY, FLAG]
        bio.fill("".join(graphemes))
        expect(page.get_by_text(f"{len(graphemes)} of {BIO_LIMIT}").first).to_be_visible()


def test_application_rate_limit(app_url: str) -> None:
    ip = fresh_ip()
    for _ in range(APPLICATION_LIMIT):
        new_draft(app_url, ip=ip)
    r = httpx.post(f"{app_url}/api/applications", json={"office": "toronto"}, headers={"X-Forwarded-For": ip},
                   timeout=HTTP_TIMEOUT)
    body = err(r, 429, "rate_limited")
    assert 1 <= body["retryAfterSeconds"] <= RATE_WINDOW_SECONDS and r.headers["Retry-After"] == str(body["retryAfterSeconds"])
    new_draft(app_url, ip=fresh_ip())


def test_minor_consent(app_url: str, mail: Mailpit) -> None:
    scout = sign_in(app_url, THEO)
    adult_dob = eighteen_years_before(office_today(app_url, "toronto"))
    adult = full_application(app_url, adult_dob, guardian=False)
    assert adult["minor"] is False
    assert ok(submit(app_url, adult), 200) == {"status": "submitted", "minor": False}
    err(submit(app_url, adult), 409, "already_submitted")
    minor_dob = adult_dob + timedelta(days=1)
    missing = full_application(app_url, minor_dob, guardian=False)
    assert missing["minor"] is True and submit(app_url, missing).status_code == 422
    minor = full_application(app_url, minor_dob)
    assert ok(submit(app_url, minor), 200) == {"status": "awaiting_guardian", "minor": True}
    message = exactly_mail(mail, mail_to(minor["guardianEmail"],
                                         f"Consent needed for {minor['first']}'s application to Vesper & Rowe"))[0]
    consent = link_token(text(message), "/consent/")
    no_mail(mail, mail_to(adult["email"], f"Consent needed for {adult['first']}'s application to Vesper & Rowe"))
    anon = http(app_url)
    view = ok(anon.get(f"/api/consents/{consent}"), 200)
    assert view["applicantFirstName"] == minor["first"] and view["office"] == "toronto"
    err(scout.post(f"/api/applications/{minor['id']}/decision", json={"decision": "approve"}), 409, "awaiting_guardian")
    assert ok(anon.post(f"/api/consents/{consent}", json={"decision": "approve"}), 200) == {"decision": "approve"}
    err(anon.post(f"/api/consents/{consent}", json={"decision": "decline"}), 410, "link_used")
    err(anon.get(f"/api/consents/{consent}"), 410, "link_used")
    err(scout.post(f"/api/applications/{minor['id']}/sign", json={}), 409, "not_approved")
    ok(scout.post(f"/api/applications/{minor['id']}/decision", json={"decision": "approve"}), 200)
    again = err(scout.post(f"/api/applications/{minor['id']}/decision", json={"decision": "decline"}), 409, "already_decided")
    assert again["decidedBy"] == THEO_NAME
    signed = ok(scout.post(f"/api/applications/{minor['id']}/sign", json={}), 201)["talent"]
    assert signed["board"] == "new_faces" and signed["state"] == "active" and len(signed["portfolio"]) >= len(SLOTS)
    with app_copy(CONSENT_LINK_TTL_SECONDS=SHORT_TTL) as short:
        late = full_application(short, minor_dob)
        ok(submit(short, late), 200)
        token = link_token(text(await_mail(mail, mail_to(late["guardianEmail"]))[0]), "/consent/")
        reader = http(short)
        eventually(lambda: reader.get(f"/api/consents/{token}").status_code == 410, int(SHORT_TTL) + SLACK_SECONDS,
                   "consent link never expired")
        err(reader.post(f"/api/consents/{token}", json={"decision": "approve"}), 410, "link_expired")


def test_wf_new_faces_phone(browser: Browser, app_url: str, mail: Mailpit) -> None:
    tok, email = ns("face")
    _, guardian = ns("guardian")
    dob = eighteen_years_before(office_today(app_url, "toronto")) + timedelta(days=1)
    with ui(browser, app_url, viewport=PHONE, touch=True, ip=fresh_ip()) as page:
        page.goto("/apply")
        first = "Ava"
        typed = {"First name": first, "Last name": f"Rowe{tok}", "Email": BAD_EMAIL, "Date of birth": dob.isoformat(),
                 "Height": "171", "Instagram followers": "1200", "Bio": "Runner and painter."}
        texts, radios = dict(typed), {"Office": "Toronto", "Height unit": "cm"}
        fill_shown(page, texts, radios, tap_radio)
        tap(page.get_by_role("button", name="Next"))
        problem = page.get_by_role("region", name="Problems").get_by_role("link", name="Enter an email address like name@example.com.")
        expect(problem).to_be_visible()
        aa_audit(page)
        tap(problem)
        expect(page.get_by_role("textbox", name="Email")).to_be_focused()
        page.get_by_role("textbox", name="Email").fill(email)
        next_step(page, tap)
        expect(page.get_by_role("status", name="Application announcements")).to_have_text("Step saved.")
        shown = shown_fields(page, texts, radios)
        aa_audit(page)
        here = fill_shown(page, texts, radios, tap_radio, shown)
        assert here and not texts and not radios, f"the first two steps never showed {[*texts, *radios]}"
        shown_box(page, here[-1]).focus()
        field = page.evaluate("() => document.activeElement.getBoundingClientRect().bottom")
        bar = page.get_by_role("button", name="Next").bounding_box()
        assert bar and field <= bar["y"] + SUBPIXEL, "sticky bar covers the focused field"
        tap(page.get_by_role("button", name="Next"))
        expect(page.get_by_label("Front photo")).to_be_attached()
        page.reload()
        expect(page.get_by_label("Front photo")).to_be_attached()
        tap(page.get_by_role("button", name="Back"))
        expect(page.get_by_role("textbox", name=here[0])).to_have_value(typed[here[0]])
        tap(page.get_by_role("button", name="Next"))
        for label in ("Front photo", "Profile photo", "Full-length photo", "Smiling photo"):
            page.get_by_label(label).set_input_files({"name": "p.jpg", "mimeType": "image/jpeg", "buffer": jpeg(30, 40)})
            expect(page.get_by_role("status", name="Application announcements")).to_contain_text(f"{label} added.")
        aa_audit(page)
        tap(page.get_by_role("button", name="Next"))
        expect(page.get_by_role("textbox", name="Guardian name")).to_be_visible()
        aa_audit(page)
        page.get_by_role("textbox", name="Guardian name").fill(f"Guardian {tok}")
        page.get_by_role("textbox", name="Guardian email").fill(guardian)
        tap(page.get_by_role("button", name="Next"))
        expect(page.get_by_role("button", name="Send application")).to_be_visible()
        aa_audit(page)
        tap(page.get_by_role("button", name="Send application"))
        expect(page.get_by_role("status", name="Application announcements")).to_have_text(
            "Application sent. We have emailed your guardian for consent and will review it once they approve.")
    exactly_mail(mail, mail_to(guardian, f"Consent needed for {first}'s application to Vesper & Rowe"))


def test_wf_new_faces_consent_and_sign(browser: Browser, app_url: str, mail: Mailpit) -> None:
    dob = eighteen_years_before(office_today(app_url, "toronto")) + timedelta(days=1)
    app = full_application(app_url, dob)
    ok(submit(app_url, app), 200)
    token = link_token(text(await_mail(mail, mail_to(app["guardianEmail"]))[0]), "/consent/")
    applicant = f"{app['first']} {app['last']}"
    with ui(browser, app_url, viewport=PHONE, touch=True) as page:
        page.goto(f"/consent/{token}")
        expect(page.get_by_text(app["first"]).first).to_be_visible()
        tap(page.get_by_role("button", name="Approve application"))
        expect(page.get_by_text(f"Thank you. You approved {app['first']}'s application.").first).to_be_visible()
        page.reload()
        expect(page.get_by_role("heading", name="This consent link no longer works")).to_be_visible()
    with ui(browser, app_url, viewport=PHONE, touch=True) as page:
        sign_in_ui(page, THEO)
        expect(page).to_have_url(re.compile(r"/workspace/applications"))
        card = page.get_by_role("article", name=applicant)
        expect(card).to_contain_text("Minor")
        tap(card.get_by_role("button", name="Approve"))
        expect(page.get_by_text(f"Approved {applicant}'s application.").first).to_be_visible()
        tap(page.get_by_role("article", name=applicant).get_by_role("button", name="Sign"))
        expect(page.get_by_text(f"Signed {applicant} to the New Faces board.").first).to_be_visible()
    found = public_list(app_url, "new_faces", q=app["last"])["talent"]
    assert len(found) == 1 and found[0]["board"] == "new_faces"


def test_measurements_units(browser: Browser, app_url: str) -> None:
    priya, director = sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    body = {"version": talent["version"], "measurements": {"height": {"value": "5 ft 10 in", "unit": "ft_in"},
                                                           "waist": {"value": 61, "unit": "cm"}}}
    saved = ok(priya.patch(f"/api/talent/{talent['id']}", json=body), 200)
    assert saved["measurements"]["heightCm"] == in_to_cm(70) and saved["measurements"]["waistCm"] == 61
    stale = err(priya.patch(f"/api/talent/{talent['id']}", json=body), 412, "stale_version")
    assert stale["savedBy"] == PRIYA_NAME
    with ui(browser, app_url) as page:
        for slug, name, height, chest in (("sofia-reyes-park", "Sofia Reyes-Park", 173, 83),
                                          ("amara-lindqvist", "Amara Lindqvist", 175, 81),
                                          ("ines-okoro", "Ines Okoro", 178, 84),
                                          (talent["slug"], talent["displayName"], in_to_cm(70), None)):
            page.goto(f"/talent/{slug}")
            article = page.get_by_role("article", name=name)
            expect(article).to_contain_text(f"{height} cm")
            expect(article).to_contain_text(ft_in(height))
            if chest:
                expect(article).to_contain_text(f"{chest} cm")
                expect(article).to_contain_text(f"{cm_to_in(chest)} in")


def test_portfolio_photos_clean(app_url: str, s3: S3) -> None:
    priya, director = sign_in(app_url, PRIYA), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    photo = ok(upload_photo(priya, talent["id"], tagged_photo()), 201)
    assert (photo["width"], photo["height"]) == (20, 40)
    served = httpx.get(f"{app_url}{urlparse(photo['url']).path}", timeout=HTTP_TIMEOUT)
    assert served.status_code == 200 and served.headers["content-type"].startswith("image/jpeg")
    assert_clean_rotated(served.content, 20, 40)
    assert_clean_rotated(s3.get(f"portfolio/{talent['id']}/{photo['photoId']}.jpg"), 20, 40)
    wide = ok(upload_photo(priya, talent["id"], jpeg(3000, 100)), 201)
    assert max(wide["width"], wide["height"]) <= MAX_SIDE
    assert ok(upload_photo(priya, talent["id"], png(), name="x.jpg"), 201)["width"] == 30
    bad = err(upload_photo(priya, talent["id"], SVG, name="evil.jpg"), 422, "validation")
    assert bad["errors"]["file"] == "That file is not a JPEG, PNG or WebP photo."
    assert err(upload_photo(priya, talent["id"], padded_jpeg(PORTFOLIO_LIMIT + 1)), 413, "too_large")["limitBytes"] == PORTFOLIO_LIMIT
    before = ok(priya.get(f"/api/talent/{talent['id']}"), 200)
    err(upload_photo(sign_in(outage("APP_MINIO_DOWN_URL"), PRIYA), talent["id"]), 503, "storage_unavailable")
    after = ok(priya.get(f"/api/talent/{talent['id']}"), 200)
    assert after["portfolioVersion"] == before["portfolioVersion"] and len(after["portfolio"]) == len(before["portfolio"])


def test_portfolio_reorder(app_url: str) -> None:
    priya, jonah, scout, director = (sign_in(app_url, e) for e in (PRIYA, JONAH, THEO, DIRECTOR))
    talent = new_talent(director)
    for _ in range(3):
        ok(upload_photo(priya, talent["id"]), 201)
    current = ok(priya.get(f"/api/talent/{talent['id']}"), 200)
    ids = [p["photoId"] for p in current["portfolio"]]
    version = current["portfolioVersion"]
    saved = ok(priya.put(f"/api/talent/{talent['id']}/photos/order", json={"portfolioVersion": version,
                                                                          "photoIds": ids[::-1]}), 200)
    assert saved["photoIds"] == ids[::-1] and saved["portfolioVersion"] > version
    assert [p["photoId"] for p in ok(priya.get(f"/api/talent/{talent['id']}"), 200)["portfolio"]] == ids[::-1]
    public = ok(http(app_url).get(f"/api/public/talent/{talent['slug']}"), 200)
    assert [p["photoId"] for p in public["portfolio"]] == ids[::-1]
    stale = err(jonah.put(f"/api/talent/{talent['id']}/photos/order", json={"portfolioVersion": version, "photoIds": ids}),
                412, "stale_version")
    assert stale["savedBy"] == PRIYA_NAME
    parse_z(stale["savedAt"])
    err(jonah.put(f"/api/talent/{talent['id']}/photos/order", json={"portfolioVersion": version, "photoIds": ids[:2]}),
        412, "stale_version")
    err(scout.put(f"/api/talent/{talent['id']}/photos/order", json={"portfolioVersion": version, "photoIds": ids}),
        403, "forbidden")
    assert priya.put(f"/api/talent/{talent['id']}/photos/order",
                     json={"portfolioVersion": saved["portfolioVersion"], "photoIds": ids[:2]}).status_code == 422
    assert [p["photoId"] for p in ok(priya.get(f"/api/talent/{talent['id']}"), 200)["portfolio"]] == ids[::-1]


def test_wf_talent_profiles_keyboard(browser: Browser, app_url: str) -> None:
    priya, jonah, director = sign_in(app_url, PRIYA), sign_in(app_url, JONAH), sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    for _ in range(3):
        ok(upload_photo(priya, talent["id"]), 201)
    with ui(browser, app_url, member=priya) as page:
        page.goto(f"/workspace/talent/{talent['id']}")
        form = page.get_by_role("form", name="Profile")
        expect(form).to_be_visible()
        aa_audit(page)
        kb_type(form.get_by_role("textbox", name="Office note"), KEYBOARD_NOTE)
        save = form.get_by_role("button", name="Save profile")
        kb_press(save)
        status = page.get_by_role("status", name="Profile announcements")
        expect(status).to_have_text("Profile saved.")
        expect(save).to_be_focused()
        assert ok(priya.get(f"/api/talent/{talent['id']}"), 200)["officeNote"] == KEYBOARD_NOTE
        portfolio = page.get_by_role("list", name="Portfolio")
        photos = len(ok(priya.get(f"/api/talent/{talent['id']}"), 200)["portfolio"])

        def item(p: int) -> Any:
            return portfolio.get_by_role("listitem", name=f"Photo {p} of {photos}")

        first_id = ok(priya.get(f"/api/talent/{talent['id']}"), 200)["portfolio"][0]["photoId"]
        kb_press(item(1).get_by_role("button", name="Move later"))
        expect(status).to_have_text(f"Moved photo to position {2} of {photos}.")
        expect(item(2).get_by_role("button", name="Move later")).to_be_focused()
        eventually(lambda: ok(priya.get(f"/api/talent/{talent['id']}"), 200)["portfolio"][1]["photoId"] == first_id,
                   SLACK_SECONDS, "reorder not saved")
        kb_press(item(1).get_by_role("button", name="Open"))
        lightbox = page.get_by_role("dialog", name="Portfolio")
        expect(lightbox).to_contain_text(f"{1} of {photos}")
        aa_audit(page)
        page.keyboard.press("ArrowRight")
        expect(lightbox).to_contain_text(f"{2} of {photos}")
        page.keyboard.press("Escape")
        expect(lightbox).to_be_hidden()
        expect(item(2).get_by_role("button", name="Open")).to_be_focused()
        current = ok(jonah.get(f"/api/talent/{talent['id']}"), 200)
        order = [p["photoId"] for p in current["portfolio"]][::-1]
        moved = ok(jonah.put(f"/api/talent/{talent['id']}/photos/order",
                             json={"portfolioVersion": current["portfolioVersion"], "photoIds": order}), 200)
        kb_press(item(1).get_by_role("button", name="Move later"))
        stale = err(jonah.put(f"/api/talent/{talent['id']}/photos/order",
                              json={"portfolioVersion": current["portfolioVersion"], "photoIds": order}),
                    412, "stale_version")
        at = fmt_time(parse_z(stale["savedAt"]), "toronto")
        expect(status).to_have_text(f"{JONAH_NAME} saved a newer order at {at}. The previous order is back.")
        server = ok(priya.get(f"/api/talent/{talent['id']}"), 200)
        assert [p["photoId"] for p in server["portfolio"]] == moved["photoIds"]


def test_wf_talent_profiles_session_ended(browser: Browser, app_url: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    priya = sign_in(app_url, PRIYA)
    with ui(browser, app_url, member=priya) as page:
        page.goto(f"/workspace/talent/{talent['id']}")
        form = page.get_by_role("form", name="Profile")
        form.get_by_role("textbox", name="Office note").fill(UNSAVED_NOTE)
        assert priya.delete("/api/session").status_code == 204
        form.get_by_role("button", name="Save profile").click()
        status = page.get_by_role("status", name="Profile announcements")
        expect(status).to_have_text("Your session ended. Your draft is kept; sign in again to finish.")
        page.get_by_role("link", name="Sign in again").click()
        page.get_by_role("textbox", name="Email").fill(PRIYA)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        expect(page).to_have_url(re.compile(rf"/workspace/talent/{re.escape(talent['id'])}"))
        expect(page.get_by_role("form", name="Profile").get_by_role("textbox", name="Office note")).to_have_value(UNSAVED_NOTE)
        expect(page.get_by_role("status", name="Profile announcements")).to_contain_text("Your draft was restored.")
    assert ok(director.get(f"/api/talent/{talent['id']}"), 200)["officeNote"] != UNSAVED_NOTE


def test_roster_import(app_url: str) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    t, e1 = ns("import")
    emails = [ns("imp")[1] for _ in range(8)]
    rows = [
        [e1, "Ana", f"Lee{t}", "", "Toronto", "Women", "5'9\"", "", "", "", "1,200", "", ""],
        [f"  {e1.upper()} ", "Ana", f"Lee{t}", "", "TOR", "Women", "180 cm", "34\"", "", "", "", "", ""],
        ["", "Bo Ray", f"Kim{t}", "1999-04-03", "VAN", "Digital", "69 in", "86 cm", "", "", "", "", ""],
        ["", "bo  ray", f"KIM{t}".upper(), "1999-04-03", "Vancouver", "Creators", "1.75 m", "", "", "", "", "", ""],
        ["", "No", "Identity", "", "Toronto", "Women", "175", "", "", "", "", "", ""],
        [emails[0], "Un", "Office", "", "Montreal", "Women", "175", "", "", "", "", "", ""],
        [emails[1], "Un", "Division", "", "Toronto", "Kids", "175", "", "", "", "", "", ""],
        [emails[2], "Bad", "Height", "", "Toronto", "Women", "tall", "", "", "", "", "", ""],
        [emails[3], "Bad", "Date", "31/31/1999", "Toronto", "Women", "175", "", "", "", "", "", ""],
        [emails[4], "Cy", f"Ng{t}", "", "Vancouver", "New Faces", "175", "86", "", "", "", "", ""],
        [emails[5], "Di", f"Po{t}", "", "Toronto", "Men", "5 ft 9 in", "34 in", "61", "89 cm", "", "", ""],
        [emails[6], "Ed", f"Qu{t}", "", "Toronto", "Women", "5' 9\"", "", "", "", "", "", ""],
    ]
    content = import_rows(rows)
    report = ok(import_csv(director, content), 200)
    assert report["counts"] == {"created": 5, "merged": 1, "unchanged": 1, "orphan": 5}
    by_row = {r["row"]: r for r in report["rows"]}
    outcomes = {2: "created", 3: "merged", 4: "created", 5: "unchanged", 6: "orphan", 7: "orphan", 8: "orphan",
                9: "orphan", 10: "orphan", 11: "created", 12: "created", 13: "created"}
    assert {n: by_row[n]["outcome"] for n in outcomes} == outcomes
    assert [by_row[n]["reason"] for n in range(6, 11)] == ["no_identity", "unknown_office", "unknown_division",
                                                           "bad_height", "bad_date"]
    assert by_row[3]["talentId"] == by_row[2]["talentId"] and "chestCm" in by_row[3]["filled"]
    assert by_row[5]["talentId"] == by_row[4]["talentId"]
    ana = ok(director.get(f"/api/talent/{by_row[2]['talentId']}"), 200)
    assert ana["measurements"]["heightCm"] == in_to_cm(69) and ana["measurements"]["chestCm"] == in_to_cm(34)
    assert ana["reach"]["instagram"] == 1200
    bo = ok(director.get(f"/api/talent/{by_row[4]['talentId']}"), 200)
    assert (bo["board"], bo["office"], bo["measurements"]["heightCm"]) == ("creators", "vancouver", in_to_cm(69))
    for n in (11, 12, 13):
        assert ok(director.get(f"/api/talent/{by_row[n]['talentId']}"), 200)["measurements"]["heightCm"] == in_to_cm(69)
    versions = {n: ok(director.get(f"/api/talent/{by_row[n]['talentId']}"), 200)["version"] for n in (2, 4, 11, 12, 13)}
    again = ok(import_csv(director, content), 200)
    assert again["counts"] == {"created": 0, "merged": 0, "unchanged": 7, "orphan": 5}
    for n, v in versions.items():
        assert ok(director.get(f"/api/talent/{by_row[n]['talentId']}"), 200)["version"] == v
    bad = b"Email,Name\r\nx@example.test,X\r\n"
    assert err(import_csv(director, bad), 422, "validation")["errors"]["file"] == \
        "The header row does not match the roster export format."
    err(import_csv(priya, bad), 403, "forbidden")
    big = bad + b" " * (ROSTER_LIMIT + 1 - len(bad))
    assert err(import_csv(director, big), 413, "too_large")["limitBytes"] == ROSTER_LIMIT


def test_withdraw_restore(app_url: str, mail: Mailpit) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    other, talent = new_talent(director), new_talent(director)
    member, _ = invite_and_accept(app_url, director, mail, "talent", talent_id=talent["id"])
    feed = urlparse(ok(member.get("/api/me/calendar-feed"), 200)["url"]).path
    token = package_token(new_package(priya, [other["id"], talent["id"]]))
    anon = http(app_url)
    ok(anon.put(f"/api/p/{token}/decisions/{talent['slug']}", json={"decision": "shortlisted"}), 200)
    place_before = board_slugs(app_url, "women").index(talent["slug"])

    def export() -> httpx.Response:
        return director.get("/api/roster/export.csv")

    first = export()
    header = next(csv.reader(io.StringIO(first.text)), [])
    assert first.status_code == 200 and header == IMPORT_HEADER.split(",") and talent["email"] in first.text
    ok(director.post(f"/api/talent/{talent['id']}/withdraw", json={}), 200)
    assert [t["slug"] for t in ok(anon.get(f"/api/p/{token}"), 200)["talent"]] == [other["slug"]]
    assert anon.get(feed).status_code == 404
    assert talent["email"] not in export().text
    err(director.post(f"/api/talent/{talent['id']}/withdraw", json={}), 409, "already_withdrawn")
    err(priya.post(f"/api/talent/{talent['id']}/restore", json={}), 403, "forbidden")
    restored = ok(director.post(f"/api/talent/{talent['id']}/restore", json={}), 200)
    assert restored["state"] == "active"
    err(director.post(f"/api/talent/{talent['id']}/restore", json={}), 409, "not_withdrawn")
    view = ok(anon.get(f"/api/p/{token}"), 200)
    assert [(t["slug"], t["decision"]) for t in view["talent"]] == [(other["slug"], "undecided"), (talent["slug"], "shortlisted")]
    assert view["shortlistedCount"] == 1
    assert anon.get(feed).status_code == 200
    assert board_slugs(app_url, "women").index(talent["slug"]) == place_before
    assert talent["email"] in export().text


def test_erasure(app_url: str, mail: Mailpit, s3: S3) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    talent = new_talent(director)
    _, member = invite_and_accept(app_url, director, mail, "talent", talent_id=talent["id"])
    photo = ok(upload_photo(priya, talent["id"]), 201)
    booking = book(priya, director, talent, new_client(director), GENERIC_DAY)
    token = package_token(new_package(priya, [talent["id"]]))
    balance = ledger(director, talent["id"])["balanceCents"]
    erased = ok(director.post(f"/api/talent/{talent['id']}/erase", json={}), 200)
    assert erased["state"] == "erased" and erased["displayName"] == ERASED
    for key in ("email", "phone", "homeAddress", "dateOfBirth", "guardian"):
        assert erased[key] in (None, ""), key
    assert not erased["officeNote"]
    assert s3.keys(f"portfolio/{talent['id']}/") == []
    assert httpx.get(f"{app_url}{urlparse(photo['url']).path}", timeout=HTTP_TIMEOUT).status_code == 404
    assert ok(http(app_url).get(f"/api/p/{token}"), 200)["talent"] == []
    kept = ok(director.get(f"/api/bookings/{booking['id']}"), 200)["booking"]
    assert kept["talent"][0]["displayName"] == ERASED and kept["talentFeesCents"] == booking["talentFeesCents"]
    assert kept["totalCents"] == booking["totalCents"]
    for line in kept["lines"]:
        assert talent["displayName"] not in line["label"]
        if line["talentId"]:
            assert ERASED in line["label"]
    assert ledger(director, talent["id"])["balanceCents"] == balance
    statement = ok(director.get(f"/api/talent/{talent['id']}/statements/{GENERIC_DAY.strftime('%Y-%m')}"), 200)
    assert statement["displayName"] == ERASED
    err(http(app_url).post("/api/session", json={"email": member["email"], "password": NEW_PASSWORD}), 401, "invalid_credentials")
    for action in ("erase", "restore", "withdraw"):
        err(director.post(f"/api/talent/{talent['id']}/{action}", json={}), 409, "erased")


def test_wf_roster_records_import(browser: Browser, app_url: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    t, email = ns("dialog")
    good = import_rows([[email, "Fay", f"Ox{t}", "", "Toronto", "Women", "175 cm", "", "", "", "", "", ""]])
    with ui(browser, app_url, member=director) as page:
        page.goto("/workspace/roster")
        for content, created in ((good, 1), (good, 0)):
            kb_press(page.get_by_role("button", name="Import roster"))
            dialog = page.get_by_role("dialog", name="Import roster")
            if created:
                dialog.get_by_label("Roster CSV").set_input_files({"name": "old.csv", "mimeType": "text/csv",
                                                                    "buffer": BAD_HEADER_CSV})
                kb_press(dialog.get_by_role("button", name="Import"))
                expect(dialog).to_contain_text("The header row does not match the roster export format.")
                expect(dialog.get_by_role("region", name="Problems").get_by_role(
                    "link", name="The header row does not match the roster export format.")).to_be_visible()
                aa_audit(page)
            dialog.get_by_label("Roster CSV").set_input_files({"name": "roster.csv", "mimeType": "text/csv", "buffer": content})
            kb_press(dialog.get_by_role("button", name="Import"))
            expect(dialog).to_be_hidden()
            expect(page.get_by_role("heading", name="Import report")).to_be_focused()
            expect(page.get_by_role("status", name="Roster announcements")).to_have_text(
                f"Import finished: {created} created, 0 merged, {1 - created} unchanged, 0 orphans.")
        expect(page.get_by_role("region", name="Import report").get_by_role("table", name="Import report")).to_be_visible()
    matches = [x for x in ok(director.get("/api/talent"), 200)["talent"] if (x.get("email") or "").lower() == email.lower()]
    assert len(matches) == 1


def test_wf_roster_records_phone_report(browser: Browser, app_url: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    t, email = ns("phone")
    content = import_rows([[email, "Gil", f"Pi{t}", "", "Toronto", "Men", "180 cm", "", "", "", "", "", ""]])
    with ui(browser, app_url, viewport=PHONE, touch=True, member=director) as page:
        page.goto("/workspace/roster")
        tap(page.get_by_role("button", name="Import roster"))
        dialog = page.get_by_role("dialog", name="Import roster")
        dialog.get_by_label("Roster CSV").set_input_files({"name": "r.csv", "mimeType": "text/csv", "buffer": content})
        tap(dialog.get_by_role("button", name="Import"))
        region = page.get_by_role("region", name="Import report")
        expect(region).to_be_visible()
        pinned_first_column(page, region, region.get_by_role("table", name="Import report"))


def test_wf_roster_records_withdraw_restore(browser: Browser, app_url: str) -> None:
    director = sign_in(app_url, DIRECTOR)
    talent = new_talent(director)
    name = talent["displayName"]
    with ui(browser, app_url, member=director) as page:
        page.goto("/workspace/roster")
        status = page.get_by_role("status", name="Roster announcements")

        def row() -> Any:
            rows = page.get_by_role("row")
            return rows.filter(has_text=talent["slug"]).or_(rows.filter(has_text=name)).first

        row().get_by_role("button", name="Withdraw").click()
        expect(status).to_have_text(f"Withdrew {name}. They no longer appear on boards, packages or feeds.")
        assert ok(director.get(f"/api/talent/{talent['id']}"), 200)["state"] == "withdrawn"
        row().get_by_role("button", name="Restore").click()
        expect(status).to_have_text(f"Restored {name} to their boards, packages and feed.")
        assert ok(director.get(f"/api/talent/{talent['id']}"), 200)["state"] == "active"
        row().get_by_role("button", name="Erase").click()
        confirm_box = page.get_by_role("alertdialog", name=f"Erase {name}?")
        confirm_box.get_by_role("button", name="Keep").click()
        assert ok(director.get(f"/api/talent/{talent['id']}"), 200)["state"] == "active"
        row().get_by_role("button", name="Erase").click()
        page.get_by_role("alertdialog", name=f"Erase {name}?").get_by_role("button", name="Erase").click()
        expect(status).to_have_text(f"Erased {name}'s personal data. Booking amounts are kept under Erased talent.")
        eventually(lambda: "erased" in focused_text(page).lower(), SLACK_SECONDS, "focus not on the state text")
    assert ok(director.get(f"/api/talent/{talent['id']}"), 200)["state"] == "erased"


def test_health_and_start_up(app_url: str, mail: Mailpit) -> None:
    assert ok(http(app_url).get("/api/health"), 200) == {"status": "ok"}
    with contextlib.ExitStack() as stack:
        with ThreadPoolExecutor(2) as pool:
            copies = list(pool.map(lambda _: stack.enter_context(app_copy()), range(2)))
        for url in copies:
            assert ok(http(url).get("/api/health"), 200) == {"status": "ok"}
        director = sign_in(copies[0], DIRECTOR)
        members = ok(director.get("/api/members"), 200)["members"]
        assert sum(1 for m in members if m["email"] == DIRECTOR) == 1
        assert sum(1 for t in ok(director.get("/api/talent"), 200)["talent"] if t["slug"] == "ines-okoro") == 1
        assert sum(1 for c in ok(director.get("/api/clients"), 200)["clients"] if c["slug"] == "northbound") == 1
        assert sum(1 for c in ok(director.get("/api/rate-cards"), 200)["rateCards"] if c["name"] == "2026 standard") == 1
        _, member = invite_and_accept(copies[1], director, mail, "scout")
        ok(http(copies[1]).post("/api/password-resets", json={"email": member["email"]}), 202)
        exactly_mail(mail, mail_to(member["email"], "Reset your Rungboard password"))
        exactly_mail(mail, mail_to(member["email"], "You're invited to Rungboard"))


def test_error_ladder(app_url: str) -> None:
    anon, booker, scout = http(app_url), sign_in(app_url, PRIYA), sign_in(app_url, THEO)
    err(anon.get("/api/does-not-exist"), 404, "not_found")
    r = anon.put("/api/health", json={})
    err(r, 405, "method_not_allowed")
    assert "GET" in r.headers["Allow"]
    err(anon.post("/api/options", content="x", headers={"Content-Type": "text/plain"}), 401, "unauthenticated")
    err(anon.get(f"/api/options/{UNKNOWN_OPTION}"), 401, "unauthenticated")
    err(booker.get(f"/api/options/{UNKNOWN_OPTION}"), 404, "not_found")
    err(scout.post(f"/api/options/{UNKNOWN_OPTION}/release", json={}), 404, "not_found")
    err(scout.post("/api/options", content="{bad", headers={"Content-Type": "application/json"}), 403, "forbidden")
    err(booker.post("/api/clients", content="{}", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    err(booker.post("/api/clients", content="{bad", headers={"Content-Type": "application/json"}), 400, "bad_json")
    t, email = ns("limit")
    body = json.dumps({"company": f"Limit {t}", "contactName": "Dana Wu", "contactEmail": email, "timeZone": "America/Vancouver"})
    exact = body[:-1] + " " * (JSON_LIMIT - len(body.encode())) + "}"
    assert len(exact.encode()) == JSON_LIMIT
    ok(booker.post("/api/clients", content=exact, headers={"Content-Type": "application/json; charset=utf-8"}), 201)
    over = exact[:-1] + " }"
    assert err(booker.post("/api/clients", content=over, headers={"Content-Type": "application/json"}), 413,
               "too_large")["limitBytes"] == JSON_LIMIT
    err(booker.post("/api/clients", content=over, headers={"Content-Type": "text/plain"}), 413, "too_large")
    v = err(booker.post("/api/clients", json={"company": "Zone", "contactName": "Dana Wu", "contactEmail": email,
                                              "timeZone": "Mars/Base"}), 422, "validation")
    assert isinstance(v["errors"], dict)


CAMEL = re.compile(r"^[a-z][a-zA-Z0-9]*$")
SNAKE = re.compile(r"^[a-z][a-z0-9_]*$")


def check_conventions(value: Any, key: str = "") -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            assert CAMEL.fullmatch(k), f"key {k}"
            check_conventions(v, k)
    elif isinstance(value, list):
        for item in value:
            check_conventions(item, key)
    elif key.endswith("Cents"):
        assert isinstance(value, int), key
    elif key.endswith("At") and value is not None:
        parse_z(value)
    elif key in ("state", "kind", "dayType", "releaseReason") and value is not None:
        assert SNAKE.fullmatch(value), (key, value)


def test_published_formats(app_url: str, mail: Mailpit) -> None:
    director, priya = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA)
    talent, client = new_talent(director), new_client(director)
    option = placed(priya, talent["id"], client["id"], GENERIC_DAY, job="Format check")
    check_conventions(option)
    booking = ok(confirm(priya, [confirm_row(option["id"], overtime=50)]), 201)["booking"]
    check_conventions(booking)
    check_conventions(ledger(director, talent["id"]))
    assert re.fullmatch(r"[A-Z]+-\d{4}-\d{4}", booking["reference"])
    message = exactly_mail(mail, mail_to(client["contactEmail"], f"Booking confirmed: Format check on {fmt_date(GENERIC_DAY)}"))[0]
    assert money(booking["totalCents"]) in text(message)
    assert re.search(r"CAD \d{1,3}(,\d{3})*\.\d{2}", text(message))


@pytest.mark.parametrize("viewport", VIEWPORT_CASES, ids=VIEWPORT_CASES)
def test_three_viewports_accessible(browser: Browser, app_url: str, mail: Mailpit, viewport: str) -> None:
    size = VIEWPORTS[viewport]
    phone = viewport == "phone"

    def audit(page: Page) -> None:
        layout(page)
        aa_audit(page)
        for button in page.get_by_role("button").all():
            if button.is_visible():
                box = button.bounding_box()
                floor = MIN_TARGET_PX - SUBPIXEL
                assert box and box["width"] >= floor and box["height"] >= floor, norm(button.inner_text())

    def screen(page: Page, path: str, ready: Any, quiet: bool = False) -> None:
        page.goto(path)
        eventually(lambda: any(el.is_visible() for el in ready.all()), UI_WAIT, f"{path} never showed {ready}")
        if quiet:
            settled(page, path)
        audit(page)

    def opened(page: Page, dialog: Any) -> None:
        expect(dialog).to_be_visible()
        audit(page)

    director, priya, rosa = sign_in(app_url, DIRECTOR), sign_in(app_url, PRIYA), sign_in(app_url, ROSA)
    talent = new_talent(director)
    for _ in range(2):
        ok(upload_photo(priya, talent["id"]), 201)
    gone = new_talent(director)
    ok(director.post(f"/api/talent/{gone['id']}/withdraw", json={}), 200)
    _, (d,) = strip_days(app_url, "toronto", 1)
    client = new_client(director)
    placed(priya, talent["id"], client["id"], d)
    booking = book(priya, director, new_talent(director), client, GENERIC_DAY)
    new_licence(rosa, client, talent, office_today(app_url, "toronto"), 12)
    adv = advance(rosa, talent["id"], 50000)
    month = office_today(app_url, "toronto").strftime("%Y-%m")
    package = new_package(priya, [talent["id"]])
    dead = new_package(priya, [talent["id"]])
    ok(priya.post(f"/api/packages/{dead['id']}/revoke", json={}), 200)
    adult = full_application(app_url, date(1999, 4, 3), guardian=False)
    ok(submit(app_url, adult), 200)
    minor = full_application(app_url, eighteen_years_before(office_today(app_url, "toronto")) + timedelta(days=1))
    ok(submit(app_url, minor), 200)
    consent = link_token(text(await_mail(mail, mail_to(minor["guardianEmail"]))[0]), "/consent/")
    _, invitee = ns("a11y")
    ok(director.post("/api/invitations", json={"email": invitee, "name": "Audit Invitee", "role": "booker",
                                               "office": "toronto"}), 202)
    invite = link_token(text(await_mail(mail, mail_to(invitee, "You're invited to Rungboard"))[0]), "/invite/")
    _, scout = invite_and_accept(app_url, director, mail, "scout")
    ok(http(app_url).post("/api/password-resets", json={"email": scout["email"]}), 202)
    reset = link_token(text(await_mail(mail, mail_to(scout["email"], "Reset your Rungboard password"))[0]), "/reset/")
    roster_csv = import_rows([[ns("a11yrow")[1], "Hal", f"Audit{ns('x')[0]}", "", "Toronto", "Women", "175 cm",
                               "", "", "", "", "", ""]])

    with ui(browser, app_url, viewport=size, touch=phone, ip=fresh_ip()) as page:
        h1 = page.get_by_role("heading", level=1)
        for path in ("/boards", "/boards/women", f"/talent/{talent['slug']}", "/sign-in",
                     "/forgot-password"):
            screen(page, path, h1)
        screen(page, f"/talent/{gone['slug']}", page.get_by_role("heading", name="No longer represented"))
        screen(page, f"/p/{package_token(package)}", page.get_by_role("article", name=talent["displayName"]))
        screen(page, f"/p/{package_token(dead)}", page.get_by_role("heading", name="This package link no longer opens"))
        screen(page, f"/consent/{consent}", page.get_by_role("button", name="Approve application"))
        ok(http(app_url).post(f"/api/consents/{consent}", json={"decision": "approve"}), 200)
        screen(page, f"/consent/{consent}", page.get_by_role("heading", name="This consent link no longer works"))
        screen(page, f"/reset/{reset}", page.get_by_role("button", name="Set password"))
        screen(page, f"/invite/{invite}", page.get_by_role("button", name="Set password"))

    with ui(browser, app_url, viewport=size, touch=phone, ip=fresh_ip()) as page:
        def press(locator: Any) -> None:
            if phone:
                tap(locator)
            else:
                locator.click()

        tok, email = ns("a11yapply")
        _, guardian = ns("a11yguardian")
        minor_dob = eighteen_years_before(office_today(app_url, "toronto")) + timedelta(days=1)
        announce = page.get_by_role("status", name="Application announcements")
        page.goto("/apply")
        expect(page.get_by_role("textbox", name="First name")).to_be_visible()
        audit(page)
        texts = {"First name": "Ava", "Last name": f"Audit{tok}", "Email": email, "Date of birth": minor_dob.isoformat(),
                 "Height": "171", "Instagram followers": "1200", "Bio": "Runner and painter."}
        radios = {"Office": "Toronto", "Height unit": "cm"}
        fill_shown(page, texts, radios, tap_radio if phone else choose)
        next_step(page, press)
        expect(announce).to_have_text("Step saved.")
        shown = shown_fields(page, texts, radios)
        audit(page)
        fill_shown(page, texts, radios, tap_radio if phone else choose, shown)
        assert not texts and not radios, f"the first two steps never showed {[*texts, *radios]}"
        press(page.get_by_role("button", name="Next"))
        expect(page.get_by_label("Front photo")).to_be_attached()
        audit(page)
        for label in ("Front photo", "Profile photo", "Full-length photo", "Smiling photo"):
            page.get_by_label(label).set_input_files({"name": "p.jpg", "mimeType": "image/jpeg", "buffer": jpeg(30, 40)})
            expect(announce).to_contain_text(f"{label} added.")
        audit(page)
        press(page.get_by_role("button", name="Next"))
        expect(page.get_by_role("textbox", name="Guardian name")).to_be_visible()
        audit(page)
        page.get_by_role("textbox", name="Guardian name").fill(f"Guardian {tok}")
        page.get_by_role("textbox", name="Guardian email").fill(guardian)
        press(page.get_by_role("button", name="Next"))
        expect(page.get_by_role("button", name="Send application")).to_be_visible()
        audit(page)

    with ui(browser, app_url, viewport=size, touch=phone, ip=fresh_ip()) as page:
        if phone:
            page.goto("/boards/women")
            page.get_by_role("button", name="Filters").click()
            opened(page, page.get_by_role("dialog", name="Filters"))
        add_on_profile(page, "ines-okoro", "Ines Okoro")
        screen(page, "/tray", page.get_by_role("list", name="Tray"))
        page.get_by_role("button", name="Start cast request").click()
        expect(page).to_have_url(re.compile(r"step=1\b"))
        audit(page)
        page.get_by_role("button", name="Next").click()
        expect(page).to_have_url(re.compile(r"step=2\b"))
        audit(page)
        page.get_by_role("textbox", name="Your name").fill("Sam Arsenault")
        page.get_by_role("textbox", name="Company").fill("Northbound Outfitters")
        page.get_by_role("textbox", name="Email").fill("sam@northbound.example")
        choose(page.get_by_role("radiogroup", name="Office").get_by_role("radio", name="Toronto"))
        page.get_by_role("button", name="Next").click()
        expect(page).to_have_url(re.compile(r"step=3\b"))
        audit(page)
        page.get_by_role("textbox", name="Shoot date").fill("2027-04-20")
        page.get_by_role("textbox", name="Brief").fill("Two-day outdoor campaign")
        page.get_by_role("button", name="Next").click()
        expect(page).to_have_url(re.compile(r"step=4\b"))
        audit(page)
        page.get_by_role("link", name="Boards", exact=True).click()
        leave = page.get_by_role("alertdialog", name="Leave the cast request?")
        opened(page, leave)
        leave.get_by_role("button", name="Stay on the form").click()

    with ui(browser, app_url, viewport=size, touch=phone, member=director) as page:
        page.add_init_script(SETTLE_JS)
        own = {
            f"/workspace/bookings/{booking['id']}": page.get_by_role("button", name="Issue invoice"),
            "/workspace/licences": page.get_by_role("button", name="Record licence"),
            f"/workspace/statements/{talent['id']}/{month}": page.get_by_role("region", name="Statement lines"),
            "/workspace/packages": page.get_by_role("button", name="New package"),
            "/workspace/applications": page.get_by_role("article", name=f"{adult['first']} {adult['last']}"),
            f"/workspace/applications/{adult['id']}": page.get_by_role("button", name="Approve"),
            f"/workspace/talent/{talent['id']}": page.get_by_role("form", name="Profile"),
            "/workspace/roster": page.get_by_role("button", name="Import roster"),
            "/workspace/members": page.get_by_role("button", name="Invite member"),
        }
        fees = [re.escape(c["name"]) for c in ok(director.get("/api/rate-cards"), 200)["rateCards"] if c.get("name")]
        closed = [day_pattern(d) for d in sorted(set().union(*PUBLISHED_CLOSURES.values()))]
        data = {
            "/workspace/overview": page.get_by_text(
                re.compile(r"(?<![a-z])(held|holds?|this month|due|active|expiring|expired)(?![a-z])", re.I)),
            "/workspace/bookings": page.get_by_role("table", name="Bookings"),
            "/workspace/rate-cards": page.get_by_text(re.compile("|".join([*fees, r"CAD \d"]))),
            "/workspace/offices": page.get_by_text(re.compile("|".join(closed))),
        }
        for path in ("/workspace/overview", "/workspace/bookings", f"/workspace/bookings/{booking['id']}",
                     "/workspace/licences", f"/workspace/statements/{talent['id']}/{month}", "/workspace/packages",
                     "/workspace/applications", f"/workspace/applications/{adult['id']}",
                     f"/workspace/talent/{talent['id']}", "/workspace/roster", "/workspace/members",
                     "/workspace/rate-cards", "/workspace/offices"):
            screen(page, path, own[path] if path in own else data[path], quiet=path in data)
        grid = board_page(page, talent)
        audit(page)
        day_button(grid, d).click()
        day = day_dialog(page, talent, d)
        opened(page, day)
        day.get_by_role("button", name="Confirm", exact=True).click()
        opened(page, page.get_by_role("dialog", name="Confirm booking"))

        screen(page, "/workspace/members", own["/workspace/members"])
        page.get_by_role("button", name="Invite member").click()
        opened(page, page.get_by_role("dialog", name="Invite member"))

        screen(page, "/workspace/licences", own["/workspace/licences"])
        page.get_by_role("button", name="Record licence").click()
        opened(page, page.get_by_role("dialog").first)
        page.goto("/workspace/licences")
        listing = page.get_by_role("table", name="Licences").or_(page.get_by_role("list", name="Licences"))
        entry = listing.get_by_role("row").or_(listing.get_by_role("article")).filter(has_text=client["company"]).first
        expect(entry).to_be_visible()
        inside = entry.get_by_role("button", name="Extend", exact=True)
        if inside.count():
            inside.click()
        else:
            entry.click()
            page.get_by_role("button", name="Extend", exact=True).click()
        opened(page, page.get_by_role("dialog", name="Extend licence"))

        statement = f"/workspace/statements/{talent['id']}/{month}"
        screen(page, statement, page.get_by_role("region", name="Statement lines"))
        page.get_by_role("button", name="Record advance").click()
        opened(page, page.get_by_role("dialog", name="Record advance"))
        screen(page, statement, page.get_by_role("region", name="Statement lines"))
        page.get_by_role("table", name="Statement").get_by_role("row").filter(
            has_text=adv["reference"]).get_by_role("button", name="Reverse").click()
        opened(page, page.get_by_role("dialog", name="Reverse entry"))

        screen(page, "/workspace/packages", own["/workspace/packages"])
        page.get_by_role("button", name="New package").click()
        opened(page, page.get_by_role("dialog", name="New package"))

        screen(page, f"/workspace/talent/{talent['id']}", page.get_by_role("form", name="Profile"))
        page.get_by_role("list", name="Portfolio").get_by_role("listitem").first.get_by_role("button", name="Open").click()
        opened(page, page.get_by_role("dialog", name="Portfolio"))

        screen(page, "/workspace/roster", own["/workspace/roster"])
        rows = page.get_by_role("row")
        rows.filter(has_text=talent["slug"]).or_(rows.filter(has_text=talent["displayName"])).first.get_by_role(
            "button", name="Erase").click()
        erase = page.get_by_role("alertdialog", name=f"Erase {talent['displayName']}?")
        opened(page, erase)
        erase.get_by_role("button", name="Keep").click()
        page.get_by_role("button", name="Import roster").click()
        importer = page.get_by_role("dialog", name="Import roster")
        opened(page, importer)
        importer.get_by_label("Roster CSV").set_input_files({"name": "r.csv", "mimeType": "text/csv",
                                                             "buffer": roster_csv})
        importer.get_by_role("button", name="Import").click()
        expect(page.get_by_role("region", name="Import report")).to_be_visible()
        audit(page)

    ines = sign_in(app_url, INES)
    ines_id = ok(ines.get("/api/me"), 200)["talentId"]
    with ui(browser, app_url, viewport=size, touch=phone, member=ines) as page:
        screen(page, "/workspace/me", page.get_by_role("button", name="Regenerate feed link"))
        screen(page, f"/workspace/statements/{ines_id}/{month}", page.get_by_role("region", name="Statement lines"))


def test_forms_problems_summary(browser: Browser, app_url: str) -> None:
    no_native = """() => [...document.querySelectorAll('form')].every(f => f.noValidate ||
        ![...f.elements].some(e => e.required || e.pattern || e.getAttribute('min') || e.getAttribute('maxlength')))"""
    with ui(browser, app_url) as page:
        page.goto("/forgot-password")
        page.get_by_role("button", name="Send reset link").click()
        problems = page.get_by_role("region", name="Problems")
        expect(problems.get_by_role("heading", name="There is a problem")).to_be_visible()
        problems.get_by_role("link", name=required_copy("Email")).click()
        expect(page.get_by_role("textbox", name="Email")).to_be_focused()
        expect(page.get_by_text(required_copy("Email"))).to_have_count(2)
        assert page.evaluate(no_native)
    with ui(browser, app_url, member=sign_in(app_url, DIRECTOR)) as page:
        page.goto("/workspace/members")
        page.get_by_role("button", name="Invite member").click()
        dialog = page.get_by_role("dialog", name="Invite member")
        invalid = ["Name", "Email"]
        select(dialog.get_by_role("combobox", name="Role"), "Booker")
        choose(dialog.get_by_role("radio", name="Toronto"))
        dialog.get_by_role("textbox", name="Email").fill(BAD_EMAIL)
        dialog.get_by_role("button", name="Send invitation").click()
        problems = dialog.get_by_role("region", name="Problems")
        expect(problems.get_by_role("heading", name=f"There are {len(invalid)} problems")).to_be_visible()
        expect(page.get_by_role("status", name="Account announcements")).to_have_text(f"Please fix {len(invalid)} problems.")
        expect(dialog.get_by_role("textbox", name="Email")).to_have_value(BAD_EMAIL)
        problems.get_by_role("link", name=required_copy("Name")).click()
        expect(dialog.get_by_role("textbox", name="Name")).to_be_focused()
        problems.get_by_role("link", name="Enter an email address like name@example.com.").click()
        expect(dialog.get_by_role("textbox", name="Email")).to_be_focused()
        assert page.evaluate(no_native)


def test_motion_system(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, motion=True) as page:
        page.goto("/talent/ines-okoro")
        page.get_by_role("article", name="Ines Okoro").get_by_role("button", name="Add to tray").click()
        page.get_by_role("link", name="Boards", exact=True).click()
        expect(page.get_by_role("heading", level=1)).to_be_focused()
        recorded = motions(page)
        assert recorded
        assert_published_durations(recorded)
        page.goto("/boards/women")
        for button in page.get_by_role("button").all():
            label = norm(button.inner_text())
            if button.is_visible() and label:
                expect(button).to_have_accessible_name(label)
        for link in page.get_by_role("navigation", name="Boards").get_by_role("link").all():
            expect(link).to_have_accessible_name(norm(link.inner_text()))
    with ui(browser, app_url, motion=True, reduced="reduce") as page:
        page.goto("/talent/ines-okoro")
        page.get_by_role("article", name="Ines Okoro").get_by_role("button", name="Add to tray").click()
        tray_count = 1
        expect(page.get_by_role("link", name=f"Tray {tray_count}", exact=True)).to_be_visible()
        page.get_by_role("link", name="Boards", exact=True).click()
        expect(page.get_by_role("heading", level=1)).to_be_focused()
        for m in motions(page):
            dx, dy = displacement(m)
            assert abs(dx) <= 1 and abs(dy) <= 1 and m["duration"] <= SHORT_MS + 1, m


def test_ended_sessions(browser: Browser, app_url: str, mail: Mailpit) -> None:
    director = sign_in(app_url, DIRECTOR)
    first, second = sign_in(app_url, PRIYA), http(app_url)
    second.cookies.set("rb_session", first.cookies["rb_session"])
    assert second.delete("/api/session").status_code == 204
    err(first.get("/api/me"), 401, "session_ended")
    talent = new_talent(director)
    month = office_today(app_url, "toronto").strftime("%Y-%m")
    with app_copy(SESSION_TTL_SECONDS=SESSION_TTL) as short:
        started = time.monotonic()
        api = sign_in(short, ROSA)
        ok(api.get("/api/me"), 200)
        carried = {"Cookie": f"rb_session={api.cookies['rb_session']}"}

        def me() -> httpx.Response:
            return httpx.get(f"{short}/api/me", headers=carried, timeout=HTTP_TIMEOUT)

        eventually(lambda: me().status_code == 401, int(SESSION_TTL) + SLACK_SECONDS, "session never ended")
        assert time.monotonic() - started >= int(SESSION_TTL) - 1
        err(me(), 401, "session_ended")
        with ui(browser, short) as page:
            sign_in_ui(page, ROSA)
            expect(page).to_have_url(re.compile(r"/workspace/licences"))
            kept = [{k: c[k] for k in ("name", "value", "domain", "path", "httpOnly", "secure", "sameSite")}
                    for c in page.context.cookies() if c["name"] == "rb_session"]
            path = f"/workspace/statements/{talent['id']}/{month}"
            page.goto(path)
            page.get_by_role("button", name="Record advance").click()
            dialog = page.get_by_role("dialog", name="Record advance")
            dialog.get_by_role("textbox", name="Amount").fill(TYPED_ADVANCE)
            eventually(lambda: page.request.get("/api/me").status == 401, int(SESSION_TTL) + SLACK_SECONDS, "UI session never ended")
            if kept:
                page.context.add_cookies(kept)
            dialog.get_by_role("button", name="Save advance").click()
            expect(page.get_by_role("status", name="Statement announcements")).to_have_text(
                "Your session ended. Your draft is kept; sign in again to finish.")
            page.get_by_role("link", name="Sign in again").click()
            expect(page).to_have_url(re.compile(r"/sign-in\?return="))
            page.get_by_role("textbox", name="Email").fill(ROSA)
            page.get_by_label("Password", exact=True).fill(PASSWORD)
            page.get_by_role("button", name="Sign in").click()
            expect(page).to_have_url(re.compile(re.escape(path)))
            expect(page.get_by_role("dialog", name="Record advance").get_by_role("textbox", name="Amount")).to_have_value(TYPED_ADVANCE)
            expect(page.get_by_role("status", name="Statement announcements")).to_contain_text("Your draft was restored.")
    assert ledger(director, talent["id"])["movements"] == []
    booker, member = invite_and_accept(app_url, director, mail, "booker")
    today, (d,) = strip_days(app_url, "toronto", 1)
    with ui(browser, app_url, member=booker) as page:
        grid = board_page(page, talent)
        day_button(grid, d).click()
        dialog = day_dialog(page, talent, d)
        dialog.get_by_role("textbox", name="Client").fill(new_client(director)["company"])
        dialog.get_by_role("textbox", name="Job title").fill("Removed mid-dialog")
        assert director.delete(f"/api/members/{member['id']}").status_code == 204
        dialog.get_by_role("button", name="Place option").click()
        expect(page.get_by_role("status", name="Board announcements")).to_have_text(
            "Your access to Rungboard was removed. Nothing more can be saved.")
    err(booker.get("/api/me"), 401, "access_removed")
    assert ladder_day(director, talent["id"], d)["options"] == []


APP_DIR = Path("/app")
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def shipped_packages() -> list[dict[str, str]]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=DEPLOYED_APP, capture_output=True,
                         text=True, timeout=300)
    tree = json.loads(out.stdout)
    found: dict[tuple[str, str], dict[str, str]] = {}

    def walk(deps: dict[str, Any]) -> None:
        for name, info in (deps or {}).items():
            licence = info.get("license")
            if isinstance(licence, dict):
                licence = licence.get("type")
            if not licence and info.get("path"):
                with contextlib.suppress(OSError, ValueError):
                    licence = json.loads((Path(info["path"]) / "package.json").read_text()).get("license")
            if info.get("version"):
                found[(name, info["version"])] = {"name": name, "version": info["version"], "license": licence or ""}
            walk(info.get("dependencies", {}))

    walk(tree.get("dependencies", {}))
    return list(found.values())


def licence_ok(expression: str) -> bool:
    expression = expression.replace("(", " ").replace(")", " ")
    return any(all(part.strip() in ALLOWED_LICENCES for part in choice.split(" AND ")) for choice in expression.split(" OR "))


def test_if_run_manifest() -> None:
    data = json.loads((APP_DIR / "run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert all(isinstance(v, str) and v for v in data.values()) and data["_schema"] == "run-manifest-v1"


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    for pkg in shipped_packages():
        assert pkg["name"] in notices and pkg["version"] in notices and pkg["license"] in notices, pkg


def test_if_licence_allowlist() -> None:
    bad = [p for p in shipped_packages() if not licence_ok(p["license"])]
    assert bad == []


def running_commands() -> str:
    names = []
    for comm in Path("/proc").glob("[0-9]*/comm"):
        with contextlib.suppress(OSError):
            names.append(comm.read_text().strip())
    return "\n".join(names)


def test_if_no_extra_datastore() -> None:
    names = {p["name"] for p in shipped_packages()}
    assert not names & {"sqlite3", "better-sqlite3", "redis", "ioredis", "@redis/client", "lowdb", "nedb", "lokijs", "level"}
    procs = running_commands()
    assert [p for p in FORBIDDEN_PROCESSES if p in procs] == []
    stray = [p for p in Path(DEPLOYED_APP).rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db")
             and "node_modules" not in p.parts]
    assert stray == []


def test_if_fonts_bundled(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url) as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/boards", "/talent/ines-okoro", "/sign-in"):
            page.goto(path)
            page.wait_for_load_state("networkidle")
        families = page.evaluate("() => document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))")
    assert all(same_origin(u, app_url) for u in seen if u.startswith("http")), [u for u in seen if not same_origin(u, app_url)]
    joined = " ".join(families)
    assert "Fraunces" in joined and "Hanken Grotesk" in joined


def test_if_service_config_unchanged() -> None:
    found: list[str] = []
    for folder, dirs, files in os.walk(APP_DIR):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        found += [os.path.relpath(os.path.join(folder, name), APP_DIR) for name in files if name != ".env.example"
                  and re.fullmatch(r"(docker-)?compose.*\.ya?ml|\.env(\..*)?", name)]
    assert found == []


def test_if_lockfile() -> None:
    pkg = json.loads((APP_DIR / "package.json").read_text())
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    root = lock["packages"][""]
    assert root.get("dependencies", {}) == pkg.get("dependencies", {})
    assert root.get("devDependencies", {}) == pkg.get("devDependencies", {})
