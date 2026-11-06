from __future__ import annotations

import json
import math
import os
import random
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    addresses,
    advance,
    axe,
    check,
    click,
    fill,
    layout,
    mail_from_address,
    open_app,
    same_origin,
    select,
    tap,
    text,
    unique,
)

_kit_click, _kit_fill, _kit_select, _kit_tap, _kit_check = click, fill, select, tap, check
LEAVING = ("control is obscured", "strict mode violation")


def settled(page, act) -> None:
    finish_motion(page)
    try:
        act()
    except (AssertionError, PlaywrightError) as error:
        if not any(sign in str(error) for sign in LEAVING):
            raise
        advance(page, SETTLE_MS)
        finish_motion(page)
        act()


def click(locator) -> None:
    settled(locator.page, lambda: _kit_click(locator))


def fill(locator, value: str) -> None:
    settled(locator.page, lambda: _kit_fill(locator, value))


def select(locator, choice: str) -> None:
    settled(locator.page, lambda: _kit_select(locator, choice))


def tap(locator) -> None:
    settled(locator.page, lambda: _kit_tap(locator))


def check(locator) -> None:
    settled(locator.page, lambda: _kit_check(locator))


PASSWORD = "Sunlit-Tide-2027"
AS = "adriatic-sunline"
SL = "saronic-lightwater"
AS_NAME = "Adriatic Sunline Charters"
SL_NAME = "Saronic Lightwater Yachts"
MIRA = "mira.kovac@adriatic-sunline.example"
LUKA = "luka.babic@adriatic-sunline.example"
ANA = "ana.peric@adriatic-sunline.example"
IVO = "ivo.matic@adriatic-sunline.example"
NINA = "nina.horvat@adriatic-sunline.example"
ELENI = "eleni.papadaki@saronic-lightwater.example"
NIKOS = "nikos.vlachos@saronic-lightwater.example"
HOMES = {MIRA: "fleet", LUKA: "holds", ANA: "charters", IVO: "today", NINA: "today"}
HOME_HEADINGS = {"fleet": "Fleet", "holds": "Holds", "charters": "Charters", "today": "Today"}

WIDE = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
NARROW = (TABLET, PHONE)
ZONES = {"split": ZoneInfo("Europe/Zagreb"), "lavrio": ZoneInfo("Europe/Athens")}
BASE_NAMES = {"split": "Split", "lavrio": "Lavrio"}
WEEKS_IN_WINDOW = 26
HOLD_SWEEP_S = 10
REFRESH_MS = 10000
DURATIONS_MS = {180, 360, 720}
ROLL_MS = 180
BAND_MS = 360
RIBBON_MS = 720
RESERVE_PCT = 20
SPEED_MIN = 4.0
SPEED_MAX = 12.0
SPEED_STEP = 0.5
SPEED_PAGE = 2.0
NEW_LEG_KN = 6.0
EARTH_NM = 3440.065
MAX_LEGS = 12
MAX_WORK_RUN_H = 14
SPLIT_REST_LONG_H = 6
DAY_H = 24
ERASE_WITHIN_S = 10
LOG_LIMIT = 2000000
PHOTO_LIMIT = 5000000
ENVELOPE = 100000
JSON_LIMIT = 100000
PAGE_CAP = 50
NAME_MAX = 80
ALLOWANCE = Decimal("0.30")
VAT = {"split": 13, "lavrio": 12}
SLOT_MIN = 30
SHORE_KW = 22
BROKER_HOLDS_PER_WINDOW = 5

RULE_TEXT = {
    "max_gap_14h": "no more than 14 hours between rest periods",
    "min_rest_24h": "at least 10 hours of rest in any 24 hours",
    "min_rest_168h": "at least 77 hours of rest in any 7 days",
    "rest_periods_24h": "rest in no more than two periods, one of at least 6 hours",
}

SIGN_IN_REFUSED = "The email or password isn't right."
SESSION_ENDED = "Your session has ended. Sign in again — what you typed is kept."
ACCESS_REMOVED = "Your access to this workspace was removed. Ask your fleet director if this is a mistake."
HOLD_RELEASED = "Hold released."
INVOICING_OUTAGE = "Invoicing is unavailable right now — no charter was recorded and no mail was sent. Try again in a few minutes."
STORAGE_OUTAGE = "Uploads are unavailable right now — nothing was saved. Try again in a few minutes."
GONE_HEADING = "This yacht isn't available"
GONE_BODY = "It's been withdrawn from charter. Browse the fleet for yachts that are sailing."
ENDED_HEADING = "This link has ended"
ENDED_BODY = "Links from Tidewright stop working after a set time or when a new one is sent. Ask your charter contact for a new link."
NOT_FOUND_HEADING = "We couldn't find that page"
GAP_ERROR = "That time doesn't exist here — the clocks go forward an hour."


HTTP_TIMEOUT = 120
UI_WAIT_S = 20
STEP_MS = 100
SETTLE_MS = 1000
EXIT_PROBE_MS = 100
TAB_PROBE = 15
POLL_S = 0.25
SLACK_S = 5
MAIL_WAIT_S = 30
TIMER_WAIT_S = 90
PX = 2
DEVICE_SKEW = timedelta(hours=72)
WHEEL_DELTA = 120
UNKNOWN_API = "/api/no-such-endpoint"
BAD_EMAIL = "not-an-email"
BAD_LENGTH = "18.291"
LATER_CHARGE = 9
LOW_TYPED = "27000.50"
HIGH_TYPED = "45000"
NIGHTS_RANGE = (1, 14)
QUANTITY_RANGE = (1, 100000)

_PAUSE = threading.Event()


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def short_url() -> str:
    return env_url("APP_SHORT_URL")


def kb_down_url() -> str:
    return env_url("APP_KILLBILL_DOWN_URL")


def s3_down_url() -> str:
    return env_url("APP_MINIO_DOWN_URL")


def fresh_url() -> str:
    return env_url("APP_SHORT_SESSION_URL")


def http(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)


def signin(base: str, email: str) -> httpx.Client:
    c = http(base)
    r = c.post("/api/session", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, f"sign-in {email}: {r.status_code} {r.text}"
    return c


def ok(r: httpx.Response, status: int = 200):
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:600]}"
    return r.json() if r.content else None


def err(r: httpx.Response, status: int) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:600]}"
    return r.json()


def fresh(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    email = b if "@" in b else a
    return uuid.uuid4().hex[:10], email.lower()


def poll(fn, seconds: float, what: str):
    end = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        assert time.monotonic() < end, f"timed out after {seconds}s waiting for {what}"
        _PAUSE.wait(POLL_S)


def stored_anywhere(pg: Postgres, needle: str) -> list[str]:
    assert re.fullmatch(r"[A-Za-z0-9@._\-]+", needle)
    sql = (
        "SELECT t.table_schema || '.' || t.table_name AS name FROM information_schema.tables t "
        "WHERE t.table_type = 'BASE TABLE' AND t.table_schema NOT IN ('pg_catalog', 'information_schema') "
        "AND strpos(query_to_xml(format('select * from %I.%I', t.table_schema, t.table_name), true, false, '')::text, "
        f"'{needle}') > 0"
    )
    return [row["name"] for row in pg.rows(sql)]


def as_date(x) -> date:
    return date.fromisoformat(x) if isinstance(x, str) else x


def instant(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def day_text(x) -> str:
    x = as_date(x)
    return f"{x:%a} {x.day} {x:%b} {x.year}"


def time_text(s: str, base: str = "split") -> str:
    t = instant(s).astimezone(ZONES[base])
    return f"{day_text(t.date())}, {t:%H:%M} {BASE_NAMES[base]} time"


def tab_text(x) -> str:
    x = as_date(x)
    return f"{x:%a} {x.day} {x:%b}"


def money(code: str, minor: int) -> str:
    return f"{code} {minor // 100:,}.{minor % 100:02d}"


def whole_number(lo: int, hi: int) -> str:
    return f"Enter a whole number from {lo} to {hi}."


def half_up(v, q: str = "1") -> Decimal:
    return Decimal(str(v)).quantize(Decimal(q), rounding=ROUND_HALF_UP)


def figure(metres) -> str:
    m = Decimal(str(metres))
    inches = int(half_up(m / Decimal("0.0254")))
    return f"{half_up(m, '0.1')} m – {inches // 12} ft {inches % 12} in"


def season_of(week_start) -> str:
    month = as_date(week_start).month
    if month in (7, 8):
        return "high"
    if month in (5, 6, 9):
        return "shoulder"
    return "low"


def haversine(a: dict, b: dict) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a["latitude"], a["longitude"], b["latitude"], b["longitude"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_NM * math.asin(math.sqrt(h))


def plan(yacht: dict, places: dict, start_id: str, legs: list[dict], start_pct: int, departs: datetime) -> list[dict]:
    battery = float(yacht["batteryKwh"])
    charge = start_pct / 100 * battery
    at, here, out = departs, start_id, []
    for leg in legs:
        speed = float(leg["speedKn"])
        dist = haversine(places[here], places[leg["toAnchorageId"]])
        hours = dist / speed
        draw = float(yacht["dragKwPerKnCubed"]) * speed ** 3 + float(yacht["hotelKw"]) - float(yacht["solarKw"])
        charge = min(max(charge - draw * hours, 0.0), battery)
        pct = math.floor(round(charge / battery * 100, 6))
        arrives = at + timedelta(seconds=round(hours * 3600))
        out.append({
            "from": here, "to": leg["toAnchorageId"], "dist": dist, "departsAt": iso(at), "arrivesAt": iso(arrives),
            "pct": pct, "reserve": "ok" if pct >= RESERVE_PCT else "below_reserve",
            "base": places[leg["toAnchorageId"]]["base"],
        })
        at, here = arrives, leg["toAnchorageId"]
    return out


def priced(yacht: dict, base: str, week_start: str, rate: Decimal) -> tuple[list[int], list[int]]:
    fee = int(yacht["rates"][f"{season_of(week_start)}Minor"])
    eur = [fee, int(half_up(Decimal(fee) * ALLOWANCE)), int(half_up(Decimal(fee) * VAT[base] / 100))]
    return eur, [int(half_up(Decimal(e) * rate)) for e in eur]


def nightly(tariffs: list[dict], night: date, length) -> tuple[int, int]:
    rate = max((t for t in tariffs if as_date(t["effectiveDate"]) <= night), key=lambda t: t["effectiveDate"])
    return int(rate["ratePerMetreMinor"]), int(half_up(Decimal(str(length)) * int(rate["ratePerMetreMinor"])))


def week_list(cli, ws, slug) -> list[dict]:
    return ok(cli.get(f"/api/w/{ws}/yachts/{slug}/weeks"))["weeks"]


def free_week(cli, ws, slug) -> dict:
    free = [w for w in week_list(cli, ws, slug) if w["status"] == "free"]
    assert free, f"no free week left on {slug}"
    return random.SystemRandom().choice(free)


def place(cli, ws, slug, week_start, client_name, queue=False) -> httpx.Response:
    return cli.post(f"/api/w/{ws}/holds", json={"yachtSlug": slug, "weekStart": week_start, "clientName": client_name, "queue": queue})


def get_hold(cli, ws, hold_id) -> dict:
    return ok(cli.get(f"/api/w/{ws}/holds/{hold_id}"))["hold"]


def get_yacht(cli, ws, slug) -> dict:
    return ok(cli.get(f"/api/w/{ws}/yachts/{slug}"))["yacht"]


def marina_map(cli, ws) -> dict:
    return {m["id"]: m for m in ok(cli.get(f"/api/w/{ws}/marinas"))["marinas"]}


def split_today(cli, ws) -> date:
    return as_date(marina_map(cli, ws)["split-marina"]["today"])


def table_in_force(cli, ws, on: date) -> dict:
    tables = ok(cli.get(f"/api/w/{ws}/exchange-tables"))["exchangeTables"]
    return max((t for t in tables if as_date(t["effectiveDate"]) <= on), key=lambda t: t["effectiveDate"])


def places(cli, ws) -> dict:
    return {a["id"]: a for a in ok(cli.get(f"/api/w/{ws}/anchorages"))["anchorages"]}


def direct_charter(cli, ws, slug, month, currency, client_name, email) -> dict:
    rnd = random.SystemRandom()
    for _ in range(40):
        first = date(rnd.randrange(2040, 2900), month, 1)
        sat = first + timedelta(days=(5 - first.weekday()) % 7)
        r = cli.post(f"/api/w/{ws}/charters", json={
            "yachtSlug": slug, "weekStart": sat.isoformat(), "clientName": client_name, "clientEmail": email, "currency": currency})
        if r.status_code == 409:
            continue
        return ok(r, 201)["charter"]
    raise AssertionError("no free far-future Saturday found")


def send_manifest_page(cli, ws, charter_id, lead, email) -> tuple[dict, str]:
    page = ok(cli.post(f"/api/w/{ws}/charters/{charter_id}/manifest-page",
                       json={"leadGuestName": lead, "leadGuestEmail": email}), 201)["page"]
    return page, page["path"].rsplit("/", 1)[1]


def add_guest(base, token, name) -> dict:
    return ok(httpx.post(f"{base}/api/manifest/{token}/guests", json={"fullName": name}, timeout=HTTP_TIMEOUT), 201)["guest"]


def upload_photo(base, token, guest_id, filename, ctype, data) -> httpx.Response:
    return httpx.post(f"{base}/api/manifest/{token}/guests/{guest_id}/photo",
                      files={"photo": (filename, data, ctype)}, timeout=HTTP_TIMEOUT)


def issue_broker_page(cli, ws, broker_id) -> tuple[dict, str]:
    page = ok(cli.post(f"/api/w/{ws}/brokers/{broker_id}/page", json={}), 201)["page"]
    return page, page["path"].rsplit("/", 1)[1]


def rota_get(cli, ws, slug, week) -> dict:
    return ok(cli.get(f"/api/w/{ws}/yachts/{slug}/rota", params={"weekStart": week}))


def rota_put(cli, ws, slug, week, version, work) -> httpx.Response:
    return cli.put(f"/api/w/{ws}/yachts/{slug}/rota", params={"weekStart": week}, json={"version": version, "work": work})


def multipart(parts) -> tuple[bytes, str]:
    boundary = "tw" + uuid.uuid4().hex
    out = b""
    for name, filename, ctype, data in parts:
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
        if filename:
            head += f'; filename="{filename}"'
        head += "\r\n"
        if ctype:
            head += f"Content-Type: {ctype}\r\n"
        out += head.encode() + b"\r\n" + data + b"\r\n"
    return out + f"--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def post_log(cli, ws, slug, filename, data, extra=()) -> httpx.Response:
    body, ctype = multipart([("log", filename, "application/x-ndjson", data), *extra])
    return cli.post(f"/api/w/{ws}/yachts/{slug}/energy-logs", content=body, headers={"content-type": ctype})


def log_line(at, charge, solar, pack, **extra) -> bytes:
    return json.dumps({"at": at, "chargePct": charge, "solarWh": solar, "packKw": pack, **extra}).encode()


def log_day() -> date:
    rnd = random.SystemRandom()
    return date(rnd.randrange(2035, 2900), 7, rnd.randrange(1, 28))


def mails_to(mail, address: str) -> list[dict]:
    return [m for m in mail.messages() if address.lower() in [a.lower() for a in addresses(m.get("To"))]]


def await_mail(mail, address: str, before: set | None = None, count: int = 1) -> list[dict]:
    before = before or set()
    return poll(lambda: (lambda found: found if len(found) >= count else None)(
        [m for m in mails_to(mail, address) if m.get("ID") not in before]), MAIL_WAIT_S, f"mail to {address}")


def exif_jpeg(width=16, height=8, orientation=6) -> bytes:

    def seg(marker: int, payload: bytes) -> bytes:
        return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload

    tiff = b"MM\x00\x2a" + struct.pack(">I", 8) + struct.pack(">H", 2)
    tiff += struct.pack(">HHIHH", 0x0112, 3, 1, orientation, 0)
    tiff += struct.pack(">HHII", 0x8825, 4, 1, 38) + struct.pack(">I", 0)
    tiff += struct.pack(">H", 1) + struct.pack(">HHI", 0x0001, 2, 2) + b"N\x00\x00\x00" + struct.pack(">I", 0)
    table = bytes([1, 1] + [0] * 14) + b"\x00\x01"
    blocks = (width // 8) * (height // 8)
    bits = "00" * blocks
    bits = bits.ljust(-(-len(bits) // 8) * 8, "1")
    scan = int(bits, 2).to_bytes(len(bits) // 8, "big")
    return (b"\xff\xd8" + seg(0xE1, b"Exif\x00\x00" + tiff) + seg(0xDB, b"\x00" + bytes([1] * 64))
            + seg(0xC0, struct.pack(">BHHB", 8, height, width, 1) + b"\x01\x11\x00")
            + seg(0xC4, b"\x00" + table + b"\x10" + table)
            + seg(0xDA, b"\x01\x01\x00\x00\x3f\x00") + scan + b"\xff\xd9")


def jpeg_facts(data: bytes) -> dict:
    assert data[:2] == b"\xff\xd8", "stored photo is not a JPEG"
    facts = {"size": None, "orientation": None, "gps": False}
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            break
        marker = data[i + 1]
        if marker in (0xD9, 0xDA):
            break
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        body = data[i + 4:i + 2 + length]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3):
            h, w = struct.unpack(">HH", body[1:5])
            facts["size"] = (w, h)
        if marker == 0xE1 and body.startswith(b"Exif\x00\x00"):
            t = body[6:]
            e = ">" if t[:2] == b"MM" else "<"
            off = struct.unpack(e + "I", t[4:8])[0]
            for k in range(struct.unpack(e + "H", t[off:off + 2])[0]):
                tag, typ = struct.unpack(e + "HH", t[off + 2 + 12 * k:off + 6 + 12 * k])
                if tag == 0x0112:
                    facts["orientation"] = struct.unpack(e + "H", t[off + 10 + 12 * k:off + 12 + 12 * k])[0]
                if tag == 0x8825:
                    facts["gps"] = True
        i += 2 + length
    return facts


def png_image(w=3, h=2) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\x80\x40\x20" * w for _ in range(h))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def role(scope, kind: str, name: str):
    return scope.get_by_role(kind, name=name, exact=True)


def adopt(page, cli: httpx.Client, base: str) -> None:
    page.context.add_cookies([{"name": c.name, "value": c.value, "url": base, "httpOnly": True, "sameSite": "Strict"}
                              for c in cli.cookies.jar])


@contextmanager
def staff(browser, base, email, path, viewport=WIDE, reduced_motion="no-preference", device_time=None):
    cli = signin(base, email)
    with open_app(browser, f"{base}/sign-in", reduced_motion=reduced_motion) as page:
        page.set_viewport_size(viewport)
        adopt(page, cli, base)
        if device_time is not None:
            page.clock.set_system_time(device_time)
        page.goto(base + path)
        advance(page, SETTLE_MS)
        yield page, cli


@contextmanager
def visitor(browser, url, viewport=WIDE, reduced_motion="no-preference", device_time=None):
    with open_app(browser, url, reduced_motion=reduced_motion) as page:
        page.set_viewport_size(viewport)
        if device_time is not None:
            page.clock.set_system_time(device_time)
        if device_time is not None or viewport != WIDE:
            page.reload()
        advance(page, SETTLE_MS)
        yield page


def resize(page, size) -> None:
    page.set_viewport_size(size)
    page.reload()
    advance(page, SETTLE_MS)


def shown(page, loc, seconds: float = UI_WAIT_S) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if loc.count() and loc.first.is_visible():
            return
        advance(page, STEP_MS)
    expect(loc.first).to_be_visible(timeout=100)


def says(page, message: str) -> None:
    shown(page, page.get_by_text(message, exact=True))
    region = role(page, "status", "Announcements")
    end = time.monotonic() + UI_WAIT_S
    while message not in (region.text_content() or "") and time.monotonic() < end:
        advance(page, STEP_MS)
    expect(region).to_contain_text(message, timeout=100)


def lands(page, pattern: str, seconds: float = UI_WAIT_S) -> re.Match:
    end = time.monotonic() + seconds
    while not re.search(pattern, urlparse(page.url).path):
        assert time.monotonic() < end, f"address never matched {pattern}: {page.url}"
        advance(page, STEP_MS)
    return re.search(pattern, urlparse(page.url).path)


def h1(page, heading: str) -> None:
    shown(page, page.get_by_role("heading", level=1, name=heading, exact=True))
    expect(page.get_by_role("heading", level=1)).to_have_count(1)


def inside(container) -> bool:
    return container.evaluate("(d) => d.contains(document.activeElement)")


def finish_motion(page) -> None:
    page.evaluate("""() => document.getAnimations().forEach(a => {
        if (a.effect && a.effect.getComputedTiming().iterations !== Infinity) { try { a.finish(); } catch (e) {} }
    })""")


TAP_MIN = 44
TAPS_JS = """(least) => [...document.querySelectorAll('a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=slider], [role=gridcell], [role=option], [role=menuitem]')]
  .filter((e) => !e.closest('[inert], [aria-hidden=true], [hidden]') && !e.matches(':disabled, [aria-disabled=true]')
                 && getComputedStyle(e).visibility !== 'hidden' && (e.type || '') !== 'hidden')
  .map((e) => {
    let r = e.getBoundingClientRect();
    const label = e.labels && e.labels[0];
    if (label && ['radio', 'checkbox', 'file'].includes(e.type)) {
      const l = label.getBoundingClientRect();
      if (l.width * l.height > r.width * r.height) r = l;
    }
    return {e, r};
  })
  .filter(({r}) => r.width > 1 && r.height > 1 && r.right + scrollX > 0 && r.bottom + scrollY > 0)
  .filter(({r}) => r.width < least || r.height < least)
  .map(({e, r}) => `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.textContent || e.value || '').trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`)"""


def tappable(page) -> None:
    small = page.evaluate(TAPS_JS, TAP_MIN - PX)
    assert not small, f"tap targets under {TAP_MIN}x{TAP_MIN} px at {page.viewport_size['width']} px wide: {small[:8]}"


def refused_in(page, dialog, *actions: str) -> None:
    expect(dialog).to_be_visible()
    buttons = [role(dialog, "button", name) for name in actions]
    end = time.monotonic() + UI_WAIT_S
    while not any(b.count() == 1 and b.evaluate("e => e === document.activeElement") for b in buttons):
        assert time.monotonic() < end, f"focus did not move to {' or '.join(actions)} after the refusal"
        advance(page, STEP_MS)


def trapped(page, dialog, first) -> None:
    finish_motion(page)
    expect(first).to_be_focused()
    page.keyboard.press("Shift+Tab")
    assert inside(dialog), "Shift+Tab left the dialog"
    page.keyboard.press("Tab")
    expect(first).to_be_focused()
    for _ in range(TAB_PROBE):
        page.keyboard.press("Tab")
        assert inside(dialog), "Tab left the dialog"


def closes_to(page, dialog, opener) -> None:
    page.keyboard.press("Escape")
    advance(page, SETTLE_MS)
    finish_motion(page)
    expect(dialog).to_have_count(0)
    expect(opener).to_be_focused()


def reopens(page, dialog, opener) -> None:
    held = opener.element_handle()
    click(opener)
    advance(page, SETTLE_MS)
    expect(dialog).to_be_visible()
    page.keyboard.press("Escape")
    advance(page, EXIT_PROBE_MS)
    held.focus()
    page.keyboard.press("Enter")
    advance(page, SETTLE_MS * 2)
    finish_motion(page)
    expect(dialog).to_have_count(1)
    expect(dialog).to_be_visible()


def pick(radio) -> None:
    point = radio.evaluate("""(e) => {
        e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
        const hit = (el) => { const r = el.getBoundingClientRect(); const p = {x: r.x + r.width / 2, y: r.y + r.height / 2};
            const h = document.elementFromPoint(p.x, p.y); return h && (h === el || el.contains(h)) ? p : null; };
        if (hit(e)) return {self: true};
        const label = (e.labels && e.labels[0]) || e.closest('label');
        return label ? hit(label) : null;
    }""")
    assert point, "neither the radio nor its label can be pressed"
    if point.get("self"):
        check(radio)
        return
    radio.page.mouse.click(point["x"], point["y"])
    expect(radio).to_be_checked()


def box(loc) -> dict:
    b = loc.bounding_box()
    assert b is not None, "element has no box"
    return b


def unscroll(loc) -> None:
    loc.evaluate("""(e) => {
        for (let p = e.parentElement; p; p = p.parentElement) {
            if (p.scrollWidth > p.clientWidth + 1) p.scrollTo({left: 0, behavior: 'instant'});
        }
        e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
    }""")


def scrolls_sideways(loc) -> bool:
    return loc.evaluate("""(e) => {
        const wide = (p) => /(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth + 1;
        for (let p = e; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
            if (wide(p)) return true;
        }
        return [...e.querySelectorAll('*')].some((c) => wide(c) && c.querySelector('[role=gridcell], td'));
    }""")


def is_strip(items) -> None:
    boxes = [box(items.nth(i)) for i in range(items.count())]
    assert len(boxes) >= 2
    for a, b in zip(boxes, boxes[1:]):
        assert abs(a["y"] - b["y"]) <= PX and b["x"] > a["x"], "cards are not one horizontal strip"


def is_column(items) -> None:
    boxes = [box(items.nth(i)) for i in range(items.count())]
    assert len(boxes) >= 2
    for a, b in zip(boxes, boxes[1:]):
        assert abs(a["x"] - b["x"]) <= PX and b["y"] >= a["y"] + a["height"] - PX, "cards are not stacked in one column"


def now_value(loc) -> float:
    v = loc.get_attribute("aria-valuenow")
    return float(v if v is not None else loc.input_value())


POSITION_JS = """(e) => {
  const num = (name, fallback) => { const v = e.getAttribute(name); return v === null || v.trim() === '' ? fallback : Number(v); };
  if (e.hasAttribute('aria-valuenow')) {
    const low = num('aria-valuemin', 0), high = num('aria-valuemax', 100);
    return high > low ? (num('aria-valuenow', 0) - low) / (high - low) * 100 : null;
  }
  if (e.tagName === 'PROGRESS' && e.hasAttribute('value')) return e.max > 0 ? e.value / e.max * 100 : null;
  return null;
}"""


def position(bar) -> int | None:
    if bar.count() != 1:
        return None
    raw = bar.evaluate(POSITION_JS)
    return None if raw is None else int(half_up(raw))


def at_position(page, bar, expected: int) -> None:
    end = time.monotonic() + UI_WAIT_S
    while position(bar) != expected:
        assert time.monotonic() < end, f"hairline position {position(bar)} != {expected}"
        advance(page, STEP_MS)


MOTION_JS = """(mode) => {
  if (mode.start) { window.__twScopes = mode.scopes || []; window.__twSeen = new Set(document.getAnimations()); window.__twGot = []; return []; }
  const ms = (v) => { v = v.trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000; };
  const nth = (list, i) => { const parts = list.split(','); return parts[i % parts.length]; };
  const out = [];
  for (const a of document.getAnimations()) {
    if (mode.fresh) { if (window.__twSeen.has(a)) continue; window.__twSeen.add(a); }
    else if (a.playState !== 'running') continue;
    const fx = a.effect, t = fx && fx.target;
    if (!t) continue;
    const cs = getComputedStyle(t, fx.pseudoElement || null);
    let d = Number(fx.getTiming().duration) || 0, props = [];
    if (typeof a.transitionProperty === 'string') {
      props = [a.transitionProperty];
      const names = cs.transitionProperty.split(',').map(s => s.trim());
      let i = names.indexOf(a.transitionProperty);
      if (i < 0) i = names.indexOf('all');
      if (i >= 0) d = ms(nth(cs.transitionDuration, i));
    } else {
      props = [...new Set(fx.getKeyframes().flatMap(k => Object.keys(k)))]
        .filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k));
      if (typeof a.animationName === 'string') {
        const i = cs.animationName.split(',').map(s => s.trim()).indexOf(a.animationName);
        if (i >= 0) d = ms(nth(cs.animationDuration, i));
      }
    }
    out.push({d, loop: fx.getComputedTiming().iterations === Infinity, props,
              scoped: (window.__twScopes || []).some(s => s && s.contains(t))});
  }
  if (mode.fresh) { window.__twGot.push(...out); return window.__twGot; }
  return out;
}"""
COLOUR_PROPS = {"color", "backgroundcolor", "bordercolor", "bordertopcolor", "borderrightcolor", "borderbottomcolor",
                "borderleftcolor", "outlinecolor", "outline", "boxshadow", "fill", "stroke", "textdecorationcolor",
                "caretcolor", "accentcolor", "stopcolor", "floodcolor", "background"}


def moving(record: dict) -> bool:
    return any(p.replace("-", "").lower() not in COLOUR_PROPS for p in record["props"]) or not record["props"]


def motions_after(page, action, scopes=(), frames: int = 20) -> list[dict]:
    page.evaluate(MOTION_JS, {"start": True, "scopes": [s.element_handle() for s in scopes]})
    action()
    for _ in range(frames):
        page.evaluate(MOTION_JS, {"fresh": True})
        advance(page, 16)
    return page.evaluate(MOTION_JS, {"fresh": True})


def declared_running(page) -> list[dict]:
    return page.evaluate(MOTION_JS, {})


def running(page) -> list[dict]:
    return page.evaluate("""() => document.getAnimations().filter(a => a.playState === 'running')
      .map(a => { const t = a.effect.getComputedTiming(); return {d: t.duration, loop: t.iterations === Infinity}; })""")


def test_sign_in_no_enumeration(app_url):
    anon = http(app_url)
    _, ghost = fresh("ghost")
    wrong = anon.post("/api/session", json={"email": MIRA, "password": "Not-The-Password-9"})
    unknown = anon.post("/api/session", json={"email": ghost, "password": PASSWORD})
    assert wrong.status_code == 401 and unknown.status_code == 401
    assert wrong.content == unknown.content
    assert wrong.json() == {"error": "invalid_credentials"}
    assert anon.get("/api/session").status_code == 401

    cli = http(app_url)
    body = ok(cli.post("/api/session", json={"email": MIRA, "password": PASSWORD}))
    assert body["member"]["name"] == "Mira Kovac" and body["member"]["role"] == "fleet_director"
    assert body["member"]["workspaceSlug"] == AS
    saved = dict(cli.cookies)
    assert ok(cli.get("/api/session"))["member"]["name"] == "Mira Kovac"
    assert cli.delete("/api/session").status_code == 204
    after = httpx.get(f"{app_url}/api/session", cookies=saved, timeout=HTTP_TIMEOUT)
    assert after.status_code == 401


def test_members_crud(app_url):
    mira = signin(app_url, MIRA)
    listed = ok(mira.get(f"/api/w/{AS}/members"))["members"]
    assert {m["email"] for m in listed} >= {MIRA, LUKA, ANA, IVO, NINA}
    assert next(m for m in listed if m["email"] == NINA)["role"] == "crew_member"

    tag, email = fresh("crew")
    name = f"Karla {tag}"
    created = ok(mira.post(f"/api/w/{AS}/members", json={
        "name": name, "email": email, "password": "Starting-Pass-01", "role": "crew_member", "yachtSlug": "sunwake"}), 201)["member"]
    assert created["name"] == name and created["email"] == email
    assert created["role"] == "crew_member" and created["yachtSlug"] == "sunwake"
    assert any(m["id"] == created["id"] for m in ok(mira.get(f"/api/w/{AS}/members"))["members"])
    assert ok(http(app_url).post("/api/session", json={"email": email, "password": "Starting-Pass-01"}))["member"]["name"] == name

    changed = ok(mira.patch(f"/api/w/{AS}/members/{created['id']}", json={"role": "charter_manager"}))["member"]
    assert changed["role"] == "charter_manager"
    assert next(m for m in ok(mira.get(f"/api/w/{AS}/members"))["members"] if m["id"] == created["id"])["role"] == "charter_manager"

    assert mira.delete(f"/api/w/{AS}/members/{created['id']}").status_code == 204
    assert all(m["id"] != created["id"] for m in ok(mira.get(f"/api/w/{AS}/members"))["members"])


def unknown_like(sample: str) -> str:
    if re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", sample):
        return str(uuid.uuid4())
    if sample.isdigit():
        return str(10 ** (len(sample) + 6) + int(uuid.uuid4().hex[:6], 16))
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    tail = "".join(alphabet[b % 36] for b in uuid.uuid4().bytes * 4)[: max(len(sample) - 1, 8)]
    return (sample[0] if sample[:1].isalpha() else "") + tail


def test_members_sealed_per_workspace(app_url):
    eleni = signin(app_url, ELENI)
    nikos = next(m for m in ok(eleni.get(f"/api/w/{SL}/members"))["members"] if m["email"] == NIKOS)
    mira = signin(app_url, MIRA)
    known = {str(m["id"]) for m in ok(mira.get(f"/api/w/{AS}/members"))["members"]} | {str(nikos["id"])}
    junk = unknown_like(str(nikos["id"]))
    assert junk not in known
    for verb, kwargs in (("patch", {"json": {"role": "captain"}}), ("delete", {})):
        other = getattr(mira, verb)(f"/api/w/{AS}/members/{nikos['id']}", **kwargs)
        missing = getattr(mira, verb)(f"/api/w/{AS}/members/{junk}", **kwargs)
        assert other.status_code == 404 and missing.status_code == 404
        assert other.json() == missing.json() == {"error": "not_found"}
    still = next(m for m in ok(eleni.get(f"/api/w/{SL}/members"))["members"] if m["id"] == nikos["id"])
    assert still["role"] == "charter_manager"


def test_member_endpoints_refuse_roles(app_url):
    mira = signin(app_url, MIRA)
    me = next(m for m in ok(mira.get(f"/api/w/{AS}/members"))["members"] if m["email"] == MIRA)
    for who in (LUKA, ANA, IVO, NINA):
        cli = signin(app_url, who)
        tag, email = fresh("refused")
        assert err(cli.get(f"/api/w/{AS}/members"), 403) == {"error": "forbidden"}
        assert err(cli.post(f"/api/w/{AS}/members", json={"name": f"N {tag}", "email": email, "password": "Starting-Pass-01", "role": "captain"}), 403) == {"error": "forbidden"}
        assert err(cli.patch(f"/api/w/{AS}/members/{me['id']}", json={"role": "captain"}), 403) == {"error": "forbidden"}
        assert err(cli.delete(f"/api/w/{AS}/members/{me['id']}"), 403) == {"error": "forbidden"}
        after = ok(mira.get(f"/api/w/{AS}/members"))["members"]
        assert all(m["email"] != email for m in after)
        assert next(m for m in after if m["id"] == me["id"])["role"] == "fleet_director"


def test_wf_workspace_access_sign_in(browser, app_url):
    with visitor(browser, f"{app_url}/sign-in") as page:
        fill(role(page, "textbox", "Email"), LUKA)
        fill(role(page, "textbox", "Password"), PASSWORD)
        click(role(page, "button", "Sign in"))

        def signed_in():
            cookies = {c["name"]: c["value"] for c in page.context.cookies()}
            r = httpx.get(f"{app_url}/api/session", cookies=cookies, timeout=HTTP_TIMEOUT)
            return r.status_code == 200 and r.json()["member"]["name"] == "Luka Babic"

        poll(signed_in, UI_WAIT_S, "the form sign-in to start a session")


def test_wf_workspace_access_sign_out(browser, app_url):
    with staff(browser, app_url, ANA, f"/w/{AS}/charters") as (page, _):
        cookies = {c["name"]: c["value"] for c in page.context.cookies()}
        assert httpx.get(f"{app_url}/api/session", cookies=cookies, timeout=HTTP_TIMEOUT).status_code == 200
        out = role(page, "button", "Sign out")
        shown(page, out)
        click(out)
        poll(lambda: httpx.get(f"{app_url}/api/session", cookies=cookies, timeout=HTTP_TIMEOUT).status_code == 401,
             UI_WAIT_S, "sign-out to end the session")


def public_fleet(base, ws, **params) -> list[dict]:
    return ok(httpx.get(f"{base}/api/public/fleets/{ws}", params=params, timeout=HTTP_TIMEOUT))["yachts"]


def card_names(page) -> list[str]:
    return [t.strip() for t in role(page, "list", "Yachts").get_by_role("listitem").get_by_role("link").all_inner_texts()]


def await_cards(page, expected: list[str]) -> None:
    end = time.monotonic() + UI_WAIT_S
    while card_names(page) != expected:
        assert time.monotonic() < end, f"fleet list {card_names(page)} != {expected}"
        advance(page, STEP_MS)


def moved(page, before: str) -> str:
    end = time.monotonic() + UI_WAIT_S
    while (now := page.evaluate("location.href")) == before:
        assert time.monotonic() < end, f"the address stayed {before}"
        advance(page, STEP_MS)
    return now


def test_wf_public_fleet_strip(browser, app_url):
    fleet = public_fleet(app_url, AS)
    names = [y["name"] for y in fleet]
    assert names == sorted(names)
    n = len(names)
    step = int(half_up(Decimal(100) / (n - 1)))
    with visitor(browser, f"{app_url}/fleet/{AS}") as page:
        h1(page, f"{AS_NAME} fleet")
        expect(role(page, "img", "Solar-electric fleet")).to_be_visible()
        await_cards(page, names)
        items = role(page, "list", "Yachts").get_by_role("listitem")
        is_strip(items)
        bar = role(page, "progressbar", "Fleet position")
        at_position(page, bar, 0)
        role(items.first, "link", names[0]).focus()
        page.keyboard.press("ArrowRight")
        advance(page, SETTLE_MS)
        at_position(page, bar, step)
        page.keyboard.press("ArrowLeft")
        advance(page, SETTLE_MS)
        at_position(page, bar, 0)
        c = box(role(page, "list", "Yachts"))
        page.mouse.move(c["x"] + c["width"] / 2, c["y"] + c["height"] / 2)
        page.mouse.wheel(0, WHEEL_DELTA)
        advance(page, EXIT_PROBE_MS)
        page.mouse.wheel(0, WHEEL_DELTA)
        advance(page, SETTLE_MS)
        at_position(page, bar, step)
        page.mouse.wheel(0, WHEEL_DELTA)
        advance(page, SETTLE_MS)
        at_position(page, bar, int(half_up(Decimal(200) / (n - 1))) if n > 2 else 100)
        layout(page)
        for size in NARROW:
            resize(page, size)
            await_cards(page, names)
            is_column(items)
            expect(role(page, "progressbar", "Fleet position")).to_have_count(0)
            layout(page)
            if size is PHONE:
                tappable(page)
        click(role(page, "link", "Sunwake"))
        lands(page, rf"^/fleet/{AS}/sunwake$")
        h1(page, "Sunwake")


def test_wf_public_fleet_filters(browser, app_url):
    fleet = public_fleet(app_url, AS)
    with visitor(browser, f"{app_url}/fleet/{AS}") as page:
        await_cards(page, [y["name"] for y in fleet])
        opener = role(page, "button", "Filters")
        dialog = role(page, "dialog", "Filters")
        expect(dialog).to_have_count(0)
        click(opener)
        advance(page, SETTLE_MS)
        trapped(page, dialog, role(dialog, "combobox", "Base"))
        closes_to(page, dialog, opener)
        reopens(page, dialog, opener)
        select(role(dialog, "combobox", "Base"), "Lavrio")
        advance(page, SETTLE_MS)
        click(role(dialog, "button", "Show yachts"))
        advance(page, SETTLE_MS)
        expect(dialog).to_have_count(0)
        await_cards(page, [y["name"] for y in fleet if y["base"] == "lavrio"])
        click(opener)
        advance(page, SETTLE_MS)
        click(role(dialog, "button", "Clear filters"))
        advance(page, SETTLE_MS)
        click(role(dialog, "button", "Show yachts"))
        advance(page, SETTLE_MS)
        expect(dialog).to_have_count(0)
        await_cards(page, [y["name"] for y in fleet])
        click(role(page, "link", "Kelp Lantern"))
        lands(page, rf"^/fleet/{AS}/kelp-lantern$")
        h1(page, "Kelp Lantern")


def test_wf_public_fleet_reduced_motion(browser, app_url):
    with visitor(browser, f"{app_url}/fleet/{AS}") as page:
        badge = role(page, "img", "Solar-electric fleet")
        expect(badge).to_be_visible()
        assert badge.evaluate("(e) => e.getAnimations({subtree: true}).filter(a => a.playState === 'running').length") > 0
    with visitor(browser, f"{app_url}/fleet/{AS}", reduced_motion="reduce") as page:
        badge = role(page, "img", "Solar-electric fleet")
        expect(badge).to_be_visible()
        assert badge.evaluate("(e) => e.getAnimations({subtree: true}).filter(a => a.playState === 'running').length") == 0
        assert [a for a in running(page) if a["loop"]] == []
        items = role(page, "list", "Yachts").get_by_role("listitem")
        items.first.get_by_role("link").focus()
        page.keyboard.press("ArrowRight")
        advance(page, STEP_MS)
        n = len(public_fleet(app_url, AS))
        at_position(page, role(page, "progressbar", "Fleet position"), int(half_up(Decimal(100) / (n - 1))))


def test_fleet_filters_history(browser, app_url):
    fleet = public_fleet(app_url, AS)
    split = [y["name"] for y in fleet if y["base"] == "split"]
    six = [y["name"] for y in fleet if y["base"] == "split" and y["cabins"] >= 6]
    assert err(httpx.get(f"{app_url}/api/public/fleets/{AS}", params={"cabins": "nine"}, timeout=HTTP_TIMEOUT), 422)["errors"]
    with visitor(browser, f"{app_url}/fleet/{AS}") as page:
        await_cards(page, [y["name"] for y in fleet])
        start_len, url0 = page.evaluate("history.length"), page.url
        click(role(page, "button", "Filters"))
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Filters")
        select(role(dialog, "combobox", "Base"), "Split")
        url1 = moved(page, url0)
        assert page.evaluate("history.length") == start_len + 1
        select(role(dialog, "combobox", "Cabins"), "6")
        url2 = moved(page, url1)
        assert page.evaluate("history.length") == start_len + 2
        click(role(dialog, "button", "Show yachts"))
        advance(page, SETTLE_MS)
        expect(dialog).to_have_count(0)
        await_cards(page, six)
        page.go_back()
        advance(page, SETTLE_MS)
        assert page.url == url1
        await_cards(page, split)
        page.go_back()
        advance(page, SETTLE_MS)
        await_cards(page, [y["name"] for y in fleet])
        page.go_forward()
        advance(page, SETTLE_MS)
        await_cards(page, split)
        page.go_forward()
        advance(page, SETTLE_MS)
        await_cards(page, six)
        length = page.evaluate("history.length")
        fill(role(page, "searchbox", "Search yachts"), "Halcyon Drift")
        advance(page, SETTLE_MS)
        await_cards(page, ["Halcyon Drift"])
        assert page.evaluate("history.length") == length
        page.goto(url2)
        advance(page, SETTLE_MS)
        await_cards(page, six)


def test_public_yacht_page(browser, app_url):
    luka = signin(app_url, LUKA)
    sunwake = ok(httpx.get(f"{app_url}/api/public/fleets/{AS}/yachts/sunwake", timeout=HTTP_TIMEOUT))
    weeks = sunwake["weeks"]
    assert len(weeks) == WEEKS_IN_WINDOW
    today = split_today(luka, AS)
    assert as_date(weeks[0]["weekStart"]) > today and as_date(weeks[0]["weekStart"]) - today <= timedelta(days=7)
    for a, b in zip(weeks, weeks[1:]):
        assert as_date(b["weekStart"]) - as_date(a["weekStart"]) == timedelta(days=7)
    for w in weeks:
        assert as_date(w["weekStart"]).weekday() == 5
        assert as_date(w["weekEnd"]) - as_date(w["weekStart"]) == timedelta(days=7)
        assert w["season"] == season_of(w["weekStart"]) and w["status"] in ("free", "held", "booked")
        assert w["weeklyRateMinor"] == sunwake["rates"][f"{w['season']}Minor"] and w["currency"] == "EUR"
    week = free_week(luka, AS, "sunwake")
    tag, _ = fresh("pub")
    ok(place(luka, AS, "sunwake", week["weekStart"], f"Client {tag}"), 201)
    after = ok(httpx.get(f"{app_url}/api/public/fleets/{AS}/yachts/sunwake", timeout=HTTP_TIMEOUT))["weeks"]
    assert next(w for w in after if w["weekStart"] == week["weekStart"])["status"] == "held"
    with visitor(browser, f"{app_url}/fleet/{AS}/sunwake") as page:
        h1(page, "Sunwake")
        expect(role(page, "img", "Sunwake hull drawing")).to_be_visible()
        body = page.locator("body")
        expect(body).to_contain_text("18.3 m – 60 ft 0 in")
        expect(body).to_contain_text(figure(sunwake["beamM"]))
        expect(body).to_contain_text(figure(sunwake["draftM"]))
        items = role(page, "list", "Weeks").get_by_role("listitem")
        expect(items).to_have_count(WEEKS_IN_WINDOW)
        held = items.filter(has_text=f"Week of {day_text(week['weekStart'])}")
        expect(held).to_contain_text("Held")
        expect(held).to_contain_text(money("EUR", week["weeklyRateMinor"]))
        is_strip(items)
        resize(page, PHONE)
        shown(page, items)
        is_column(items)
    with visitor(browser, f"{app_url}/fleet/{AS}/halcyon-drift") as page:
        expect(page.locator("body")).to_contain_text("24.4 m – 80 ft 1 in")


def test_withdrawn_yacht_gone(browser, app_url):
    eleni = signin(app_url, ELENI)
    nikos = signin(app_url, NIKOS)
    if get_yacht(eleni, SL, "brightwater")["status"] == "withdrawn":
        ok(eleni.post(f"/api/w/{SL}/yachts/brightwater/return-to-sale"))
    week = free_week(nikos, SL, "brightwater")
    page_path = f"/fleet/{SL}/brightwater"
    try:
        assert ok(eleni.post(f"/api/w/{SL}/yachts/brightwater/withdraw"))["yacht"]["status"] == "withdrawn"
        assert err(eleni.post(f"/api/w/{SL}/yachts/brightwater/withdraw"), 409) == {"error": "already_withdrawn"}
        assert httpx.get(app_url + page_path, timeout=HTTP_TIMEOUT).status_code == 410
        assert err(httpx.get(f"{app_url}/api/public/fleets/{SL}/yachts/brightwater", timeout=HTTP_TIMEOUT), 410) == {"error": "yacht_withdrawn"}
        assert "brightwater" not in [y["slug"] for y in public_fleet(app_url, SL)]
        assert public_fleet(app_url, SL, q="Brightwater") == []
        sitemap = httpx.get(f"{app_url}/sitemap.xml", timeout=HTTP_TIMEOUT).text
        assert page_path not in sitemap and f"/fleet/{SL}" in sitemap
        tag, _ = fresh("gone")
        assert err(place(nikos, SL, "brightwater", week["weekStart"], f"Client {tag}"), 410) == {"error": "yacht_withdrawn"}
        with visitor(browser, app_url + page_path) as page:
            h1(page, GONE_HEADING)
            expect(page.get_by_text(GONE_BODY, exact=True).first).to_be_visible()
            expect(page.get_by_role("link").first).to_be_visible()
        with visitor(browser, f"{app_url}/fleet/{SL}") as page:
            h1(page, f"{SL_NAME} fleet")
            shown(page, role(page, "list", "Yachts").get_by_role("listitem"))
            expect(role(page, "link", "Brightwater")).to_have_count(0)
        assert get_yacht(eleni, SL, "brightwater")["status"] == "withdrawn"
    finally:
        eleni.post(f"/api/w/{SL}/yachts/brightwater/return-to-sale")
    assert get_yacht(eleni, SL, "brightwater")["status"] == "on_sale"
    assert err(eleni.post(f"/api/w/{SL}/yachts/brightwater/return-to-sale"), 409) == {"error": "already_on_sale"}
    assert httpx.get(app_url + page_path, timeout=HTTP_TIMEOUT).status_code == 200
    assert "brightwater" in [y["slug"] for y in public_fleet(app_url, SL)]
    assert page_path in httpx.get(f"{app_url}/sitemap.xml", timeout=HTTP_TIMEOUT).text


def test_last_free_week_goes_to_one(app_url):
    luka, mira = signin(app_url, LUKA), signin(app_url, MIRA)
    week = free_week(luka, AS, "halcyon-drift")
    tag, _ = fresh("race")
    gate = threading.Barrier(2)

    def go(cli, who):
        gate.wait()
        return who, place(cli, AS, "halcyon-drift", week["weekStart"], f"{who} {tag}")

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda a: go(*a), [(luka, "Luka Babic"), (mira, "Mira Kovac")]))
    assert sorted(r.status_code for _, r in results) == [201, 409]
    (win_who, win), (_, lose) = sorted(results, key=lambda x: x[1].status_code)
    hold = win.json()["hold"]
    assert hold["status"] == "live" and hold["placedBy"] == {"kind": "member", "name": win_who}
    refusal = lose.json()
    assert refusal["error"] == "week_taken" and refusal["takenBy"] == win_who and refusal["takenAt"] == hold["liveSince"]
    w = next(x for x in week_list(luka, AS, "halcyon-drift") if x["weekStart"] == week["weekStart"])
    assert w["status"] == "held" and w["liveHoldId"] == hold["id"]
    mine = [h for h in ok(luka.get(f"/api/w/{AS}/holds", params={"yachtSlug": "halcyon-drift", "weekStart": week["weekStart"]}))["holds"]
            if h["clientName"].endswith(tag)]
    assert [h["id"] for h in mine] == [hold["id"]]


def test_hold_lapse_and_line(app_url):
    base = short_url()
    luka, mira = signin(base, LUKA), signin(base, MIRA)
    week = free_week(luka, AS, "sunwake")
    tag, email = fresh("lapse")
    a = ok(place(luka, AS, "sunwake", week["weekStart"], f"A {tag}"), 201)["hold"]
    assert a["status"] == "live" and a["position"] is None
    b = ok(place(mira, AS, "sunwake", week["weekStart"], f"B {tag}", queue=True), 201)["hold"]
    assert b["status"] == "waiting" and b["position"] == 1 and b["lapsesAt"] is None and b["liveSince"] is None
    c = ok(place(mira, AS, "sunwake", week["weekStart"], f"C {tag}", queue=True), 201)["hold"]
    assert c["position"] == 2
    taken = err(place(mira, AS, "sunwake", week["weekStart"], f"D {tag}"), 409)
    assert taken == {"error": "week_taken", "takenBy": "Luka Babic", "takenAt": a["liveSince"]}
    span = instant(a["lapsesAt"]) - instant(a["liveSince"])
    assert span > timedelta(0)
    poll(lambda: get_hold(luka, AS, a["id"])["status"] == "lapsed", span.total_seconds() + HOLD_SWEEP_S + TIMER_WAIT_S, "hold to lapse")
    assert err(luka.post(f"/api/w/{AS}/holds/{a['id']}/release"), 409) == {"error": "hold_lapsed", "lapsedAt": a["lapsesAt"]}
    late = err(luka.post(f"/api/w/{AS}/holds/{a['id']}/deposit", json={"clientEmail": email, "currency": "EUR"}), 409)
    assert late["error"] == "hold_lapsed"
    moved = poll(lambda: (lambda h: h if h["status"] == "live" else None)(get_hold(luka, AS, b["id"])),
                 HOLD_SWEEP_S + TIMER_WAIT_S, "next hold to move up")
    gap = instant(moved["liveSince"]) - instant(a["lapsesAt"])
    assert timedelta(0) <= gap <= timedelta(seconds=HOLD_SWEEP_S)
    assert instant(moved["lapsesAt"]) - instant(moved["liveSince"]) == span
    waiting = get_hold(luka, AS, c["id"])
    assert waiting["status"] == "waiting" and waiting["position"] == 1
    assert ok(mira.post(f"/api/w/{AS}/holds/{b['id']}/release"))["hold"]["status"] == "released"
    up = get_hold(luka, AS, c["id"])
    assert up["status"] in ("live", "lapsed") and up["position"] is None and up["liveSince"] is not None
    again = err(mira.post(f"/api/w/{AS}/holds/{b['id']}/release"), 409)
    assert again == {"error": "hold_not_live", "status": "released"}


def test_hold_screen_server_status(browser, app_url):
    luka, mira = signin(app_url, LUKA), signin(app_url, MIRA)
    week = free_week(luka, AS, "kelp-lantern")
    tag, _ = fresh("clock")
    live = ok(place(luka, AS, "kelp-lantern", week["weekStart"], f"Live {tag}"), 201)["hold"]
    wait = ok(place(mira, AS, "kelp-lantern", week["weekStart"], f"Wait {tag}", queue=True), 201)["hold"]
    ahead = instant(live["lapsesAt"]) + DEVICE_SKEW
    with staff(browser, app_url, LUKA, f"/w/{AS}/holds/{live['id']}", device_time=ahead) as (page, _):
        h1(page, f"Hold for Live {tag}")
        shown(page, page.get_by_text("Live", exact=True))
        expect(page.locator("body")).to_contain_text(time_text(live["lapsesAt"], "split"))
        expect(role(page, "button", "Record deposit")).to_be_enabled()
        expect(role(page, "button", "Release hold")).to_be_enabled()
        page.goto(f"{app_url}/w/{AS}/holds")
        advance(page, SETTLE_MS)
        table = role(page, "table", "Holds")
        live_row = table.get_by_role("row").filter(has_text=f"Live {tag}")
        shown(page, live_row)
        expect(live_row).to_contain_text(time_text(live["lapsesAt"], "split"))
        expect(live_row).to_contain_text("Live")
        wait_row = table.get_by_role("row").filter(has_text=f"Wait {tag}")
        expect(wait_row).to_contain_text(f"Waiting, {wait['position']} in line")
        expect(wait_row).to_contain_text("—")
        page.goto(f"{app_url}/w/{AS}/holds/{wait['id']}")
        advance(page, SETTLE_MS)
        shown(page, page.get_by_text(f"Waiting, {wait['position']} in line", exact=True))
        expect(role(page, "button", "Record deposit")).to_be_disabled()
        expect(role(page, "button", "Release hold")).to_be_enabled()

    base = short_url()
    sluka = signin(base, LUKA)
    sweek = free_week(sluka, AS, "kelp-lantern")
    gone = ok(place(sluka, AS, "kelp-lantern", sweek["weekStart"], f"Gone {tag}"), 201)["hold"]
    poll(lambda: get_hold(sluka, AS, gone["id"])["status"] == "lapsed", TIMER_WAIT_S, "hold to lapse")
    behind = instant(gone["liveSince"]) - DEVICE_SKEW
    with staff(browser, base, LUKA, f"/w/{AS}/holds/{gone['id']}", device_time=behind) as (page, _):
        h1(page, f"Hold for Gone {tag}")
        shown(page, page.get_by_text("Lapsed", exact=True))
        expect(role(page, "button", "Record deposit")).to_be_disabled()
        expect(role(page, "button", "Release hold")).to_be_disabled()


def test_wf_charter_holds_place(browser, app_url):
    luka = signin(app_url, LUKA)
    week = free_week(luka, AS, "kelp-lantern")
    tag, _ = fresh("ui-hold")
    client = f"Harriet {tag}"
    with staff(browser, app_url, LUKA, f"/w/{AS}/yachts/kelp-lantern") as (page, _):
        h1(page, "Kelp Lantern")
        opener = role(page, "button", f"Hold week of {day_text(week['weekStart'])}")
        shown(page, opener)
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Place hold")
        trapped(page, dialog, role(dialog, "textbox", "Client name"))
        closes_to(page, dialog, opener)
        click(opener)
        advance(page, SETTLE_MS)
        fill(role(dialog, "textbox", "Client name"), client)
        click(role(dialog, "button", "Place hold"))
        hold_id = lands(page, rf"^/w/{AS}/holds/([^/]+)$").group(1)
        h1(page, f"Hold for {client}")
        page.reload()
        advance(page, SETTLE_MS)
        h1(page, f"Hold for {client}")
    hold = get_hold(luka, AS, hold_id)
    assert hold["clientName"] == client and hold["status"] == "live" and hold["weekStart"] == week["weekStart"]
    assert hold["placedBy"] == {"kind": "member", "name": "Luka Babic"}


def test_wf_charter_holds_release(browser, app_url):
    luka = signin(app_url, LUKA)
    week = free_week(luka, AS, "halcyon-drift")
    tag, _ = fresh("release")
    hold = ok(place(luka, AS, "halcyon-drift", week["weekStart"], f"Rel {tag}"), 201)["hold"]
    with staff(browser, app_url, LUKA, f"/w/{AS}/holds/{hold['id']}") as (page, _):
        h1(page, f"Hold for Rel {tag}")
        opener = role(page, "button", "Release hold")
        shown(page, opener)
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Release hold")
        trapped(page, dialog, role(dialog, "button", "Keep hold"))
        click(role(dialog, "button", "Release hold"))
        says(page, HOLD_RELEASED)
        for _ in range(2):
            advance(page, REFRESH_MS)
        expect(page.get_by_text(HOLD_RELEASED, exact=True).first).to_be_visible()
        shown(page, page.get_by_text("Released", exact=True))
    assert get_hold(luka, AS, hold["id"])["status"] == "released"


def test_wf_charter_holds_week_taken(browser, app_url):
    luka, mira = signin(app_url, LUKA), signin(app_url, MIRA)
    week = free_week(luka, AS, "sunwake")
    tag, _ = fresh("taken")
    with staff(browser, app_url, LUKA, f"/w/{AS}/yachts/sunwake") as (page, _):
        opener = role(page, "button", f"Hold week of {day_text(week['weekStart'])}")
        shown(page, opener)
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Place hold")
        fill(role(dialog, "textbox", "Client name"), f"Lost {tag}")
        winner = ok(place(mira, AS, "sunwake", week["weekStart"], f"Won {tag}"), 201)["hold"]
        click(role(dialog, "button", "Place hold"))
        says(page, f"Too late — Mira Kovac took this week at {time_text(winner['liveSince'])}.")
        expect(dialog).to_be_visible()
        expect(role(dialog, "textbox", "Client name")).to_have_value(f"Lost {tag}")
        refused_in(page, dialog, "Place hold", "Join the line")
    holds = ok(luka.get(f"/api/w/{AS}/holds", params={"yachtSlug": "sunwake", "weekStart": week["weekStart"]}))["holds"]
    assert all(h["clientName"] != f"Lost {tag}" for h in holds)


def leg_cards(page):
    return role(page, "list", "Legs").get_by_role("listitem")


def assert_legs_on_screen(page, expected: list[dict], names: dict) -> None:
    cards = leg_cards(page)
    expect(cards).to_have_count(len(expected))
    for i, leg in enumerate(expected):
        card = cards.nth(i)
        expect(card).to_have_attribute("data-arrival-charge", str(leg["pct"]))
        expect(card).to_have_attribute("data-reserve", leg["reserve"])
        expect(card).to_contain_text(f"Arrives with {leg['pct']}%")
        expect(card).to_contain_text(f"Leg {i + 1}: {names[leg['from']]} to {names[leg['to']]}")
    expect(role(page, "img", "Charge ribbon")).to_have_attribute("data-min-charge", str(min(x["pct"] for x in expected)))


def announcement(n: int, name: str, pct: int) -> str:
    tail = " — below reserve." if pct < RESERVE_PCT else "."
    return f"Leg {n} to {name}: arrives with {pct}%{tail}"


def test_passage_energy_rule(browser, app_url):
    ivo = signin(app_url, IVO)
    yacht = get_yacht(ivo, AS, "sunwake")
    where = places(ivo, AS)
    names = {k: v["name"] for k, v in where.items()}
    tag, _ = fresh("energy")
    legs = [{"toAnchorageId": "hvar-stari-grad", "speedKn": 6.0}, {"toAnchorageId": "vis-town", "speedKn": 7.5},
            {"toAnchorageId": "split-base", "speedKn": SPEED_MAX}]
    body = {"yachtSlug": "sunwake", "name": f"Loop {tag}", "startAnchorageId": "split-base", "departureDate": "2027-07-03",
            "departureTime": "09:00", "startChargePct": 100, "legs": legs}
    passage = ok(ivo.post(f"/api/w/{AS}/passages", json=body), 201)["passage"]
    departs = datetime(2027, 7, 3, 9, 0, tzinfo=ZONES["split"])
    expected = plan(yacht, where, "split-base", legs, 100, departs)
    assert passage["departsAt"] == iso(departs) and passage["status"] == "draft"
    for leg, exp in zip(passage["legs"], expected):
        assert leg["fromAnchorageId"] == exp["from"] and leg["toAnchorageId"] == exp["to"]
        assert Decimal(str(leg["distanceNm"])) == half_up(repr(exp["dist"]), "0.01")
        assert leg["departsAt"] == exp["departsAt"] and leg["arrivesAt"] == exp["arrivesAt"]
        assert leg["arrivalChargePct"] == exp["pct"] and leg["reserve"] == exp["reserve"] and leg["arrivalBase"] == "split"
    assert passage["minChargePct"] == min(e["pct"] for e in expected)
    below = [l for l, e in zip(passage["legs"], expected) if e["reserve"] == "below_reserve"]
    assert below, "reference expects a below-reserve leg"
    with staff(browser, app_url, IVO, f"/w/{AS}/passages/{passage['id']}") as (page, _):
        h1(page, f"Loop {tag}")
        shown(page, leg_cards(page))
        assert_legs_on_screen(page, expected, names)
        for i, exp in enumerate(expected):
            card = leg_cards(page).nth(i)
            expect(card).to_contain_text(f"{half_up(repr(exp['dist']), '0.1')} nm")
            expect(card).to_contain_text(time_text(exp["arrivesAt"], "split"))
            if exp["reserve"] == "below_reserve":
                expect(card).to_contain_text("Below reserve")
        expect(role(page, "button", "Send to crew")).to_be_disabled()
    refused = err(ivo.post(f"/api/w/{AS}/passages/{passage['id']}/send"), 409)
    assert refused == {"error": "below_reserve", "legIndex": below[0]["index"]}
    bad = dict(body)
    bad.pop("yachtSlug")
    bad["legs"] = [{"toAnchorageId": "hvar-stari-grad", "speedKn": 6.25}]
    assert err(ivo.put(f"/api/w/{AS}/passages/{passage['id']}", json=bad), 422)["errors"]["legs.0.speedKn"] == "Choose a speed from 4.0 to 12.0 kn in 0.5 kn steps."
    bad["legs"] = [{"toAnchorageId": "split-base", "speedKn": 6.0}]
    assert err(ivo.put(f"/api/w/{AS}/passages/{passage['id']}", json=bad), 422)["errors"]["legs.0.toAnchorageId"] == "Choose a different anchorage."
    bad["legs"] = [{"toAnchorageId": a, "speedKn": 6.0} for a in ["hvar-stari-grad", "vis-town"] * 7][: MAX_LEGS + 1]
    assert err(ivo.put(f"/api/w/{AS}/passages/{passage['id']}", json=bad), 422)["errors"]["legs"] == "Use at most 12 legs."
    slow = [dict(legs[0]), dict(legs[1]), {"toAnchorageId": "split-base", "speedKn": SPEED_MIN}]
    fixed = dict(body)
    fixed.pop("yachtSlug")
    fixed["legs"] = slow
    saved = ok(ivo.put(f"/api/w/{AS}/passages/{passage['id']}", json=fixed))["passage"]
    ref = plan(yacht, where, "split-base", slow, 100, departs)
    assert [l["arrivalChargePct"] for l in saved["legs"]] == [e["pct"] for e in ref]
    if all(e["reserve"] == "ok" for e in ref):
        assert ok(ivo.post(f"/api/w/{AS}/passages/{passage['id']}/send"))["passage"]["status"] == "sent"
        assert ok(ivo.put(f"/api/w/{AS}/passages/{passage['id']}", json=fixed))["passage"]["status"] == "draft"
    fixed["legs"] = []
    empty = ok(ivo.put(f"/api/w/{AS}/passages/{passage['id']}", json=fixed))["passage"]
    assert empty["minChargePct"] is None
    assert err(ivo.post(f"/api/w/{AS}/passages/{passage['id']}/send"), 409) == {"error": "no_legs"}


def test_departure_clock_changes(browser, app_url):
    ivo = signin(app_url, IVO)
    tag, _ = fresh("dst")

    def create(slug, start, to, day, at):
        return ivo.post(f"/api/w/{AS}/passages", json={"yachtSlug": slug, "name": f"DST {tag}", "startAnchorageId": start,
                                                     "departureDate": day, "departureTime": at, "startChargePct": 100,
                                                     "legs": [{"toAnchorageId": to, "speedKn": 6.0}]})

    spring = date(2027, 3, 28)
    autumn = date(2027, 10, 31)
    assert err(create("sunwake", "split-base", "hvar-stari-grad", spring.isoformat(), "02:30"), 422)["errors"]["departureTime"] == GAP_ERROR
    assert err(create("kelp-lantern", "lavrio-base", "kea-vourkari", spring.isoformat(), "03:30"), 422)["errors"]["departureTime"] == GAP_ERROR
    lav = ok(create("kelp-lantern", "lavrio-base", "kea-vourkari", spring.isoformat(), "02:30"), 201)["passage"]
    assert lav["departsAt"] == iso(datetime(2027, 3, 28, 2, 30, tzinfo=ZONES["lavrio"]))
    first = ok(create("sunwake", "split-base", "hvar-stari-grad", autumn.isoformat(), "02:30"), 201)["passage"]
    assert first["departsAt"] == iso(datetime(2027, 10, 31, 2, 30, fold=0, tzinfo=ZONES["split"]))
    lfirst = ok(create("kelp-lantern", "lavrio-base", "kea-vourkari", autumn.isoformat(), "03:30"), 201)["passage"]
    assert lfirst["departsAt"] == iso(datetime(2027, 10, 31, 3, 30, fold=0, tzinfo=ZONES["lavrio"]))
    assert lfirst["legs"][0]["arrivalBase"] == "lavrio"
    with staff(browser, app_url, IVO, f"/w/{AS}/passages/{lfirst['id']}") as (page, _):
        shown(page, leg_cards(page))
        expect(leg_cards(page).first).to_contain_text(time_text(lfirst["legs"][0]["arrivesAt"], "lavrio"))
        page.goto(f"{app_url}/w/{AS}/passages/{first['id']}")
        advance(page, SETTLE_MS)
        shown(page, leg_cards(page))
        expect(leg_cards(page).first).to_contain_text(time_text(first["legs"][0]["arrivesAt"], "split"))


def two_leg_passage(ivo, tag, start_pct=100) -> dict:
    return ok(ivo.post(f"/api/w/{AS}/passages", json={
        "yachtSlug": "sunwake", "name": f"Keys {tag}", "startAnchorageId": "split-base", "departureDate": "2027-07-03",
        "departureTime": "09:00", "startChargePct": start_pct,
        "legs": [{"toAnchorageId": "hvar-stari-grad", "speedKn": NEW_LEG_KN}, {"toAnchorageId": "vis-town", "speedKn": NEW_LEG_KN}]}), 201)["passage"]


def test_planner_keyboard(browser, app_url):
    ivo = signin(app_url, IVO)
    yacht = get_yacht(ivo, AS, "sunwake")
    where = places(ivo, AS)
    names = {k: v["name"] for k, v in where.items()}
    tag, _ = fresh("keys")
    passage = two_leg_passage(ivo, tag)
    departs = datetime(2027, 7, 3, 9, 0, tzinfo=ZONES["split"])
    with staff(browser, app_url, IVO, f"/w/{AS}/passages/{passage['id']}") as (page, _):
        one, two = role(page, "slider", "Leg 1 speed"), role(page, "slider", "Leg 2 speed")
        shown(page, one)
        one.focus()
        speed = NEW_LEG_KN
        for key, change in (("ArrowRight", SPEED_STEP), ("ArrowUp", SPEED_STEP), ("ArrowLeft", -SPEED_STEP),
                            ("ArrowDown", -SPEED_STEP), ("PageUp", SPEED_PAGE), ("PageDown", -SPEED_PAGE),
                            ("Home", None), ("ArrowDown", -SPEED_STEP), ("End", None), ("PageUp", SPEED_PAGE)):
            page.keyboard.press(key)
            advance(page, STEP_MS)
            if key == "Home":
                speed = SPEED_MIN
            elif key == "End":
                speed = SPEED_MAX
            else:
                speed = min(max(speed + change, SPEED_MIN), SPEED_MAX)
            assert now_value(one) == speed, f"{key}: {now_value(one)} != {speed}"
            expect(one).to_have_attribute("aria-valuetext", f"{speed:.1f} kn")
            ref = plan(yacht, where, "split-base", [{"toAnchorageId": "hvar-stari-grad", "speedKn": speed},
                                                    {"toAnchorageId": "vis-town", "speedKn": NEW_LEG_KN}], 100, departs)
            assert_legs_on_screen(page, ref, names)
            expect(role(page, "status", "Passage updates")).to_contain_text(announcement(1, names["hvar-stari-grad"], ref[0]["pct"]))
        page.keyboard.press("]")
        advance(page, STEP_MS)
        expect(two).to_be_focused()
        role(page, "button", "Remove leg 2").focus()
        page.keyboard.press("[")
        advance(page, STEP_MS)
        expect(one).to_be_focused()
        role(page, "button", "Remove leg 1").focus()
        page.keyboard.press("]")
        advance(page, STEP_MS)
        expect(two).to_be_focused()
        bar = role(page, "progressbar", "Legs position")
        strip = box(role(page, "list", "Legs"))
        page.mouse.move(strip["x"] + strip["width"] / 2, strip["y"] + strip["height"] / 2)
        page.keyboard.press("[")
        advance(page, SETTLE_MS)
        at_position(page, bar, 0)
        page.mouse.wheel(0, WHEEL_DELTA)
        advance(page, SETTLE_MS)
        at_position(page, bar, 100)
        page.mouse.wheel(0, -WHEEL_DELTA)
        advance(page, SETTLE_MS)
        at_position(page, bar, 0)


def crossing_start(yacht, where) -> int:
    departs = datetime(2027, 7, 3, 9, 0, tzinfo=ZONES["split"])
    for start in range(100, 0, -1):
        lo = plan(yacht, where, "split-base", [{"toAnchorageId": "hvar-stari-grad", "speedKn": NEW_LEG_KN}], start, departs)[0]["pct"]
        hi = plan(yacht, where, "split-base", [{"toAnchorageId": "hvar-stari-grad", "speedKn": NEW_LEG_KN + SPEED_STEP}], start, departs)[0]["pct"]
        if lo >= RESERVE_PCT > hi:
            return start
    raise AssertionError("no starting charge crosses the reserve on one step")


def test_charge_ribbon_motion(browser, app_url):
    ivo = signin(app_url, IVO)
    yacht = get_yacht(ivo, AS, "sunwake")
    where = places(ivo, AS)
    start = crossing_start(yacht, where)
    tag, _ = fresh("motion")
    passage = ok(ivo.post(f"/api/w/{AS}/passages", json={
        "yachtSlug": "sunwake", "name": f"Motion {tag}", "startAnchorageId": "split-base", "departureDate": "2027-07-03",
        "departureTime": "09:00", "startChargePct": start, "legs": [{"toAnchorageId": "hvar-stari-grad", "speedKn": NEW_LEG_KN}]}), 201)["passage"]
    for reduced in ("no-preference", "reduce"):
        with staff(browser, app_url, IVO, f"/w/{AS}/passages/{passage['id']}", reduced_motion=reduced) as (page, _):
            slider = role(page, "slider", "Leg 1 speed")
            shown(page, slider)
            advance(page, SETTLE_MS * 2)
            card = leg_cards(page).first
            expect(card).to_have_attribute("data-reserve", "ok")
            slider.focus()
            scopes = (role(page, "list", "Legs"), role(page, "img", "Charge ribbon"))
            started = motions_after(page, lambda: page.keyboard.press("ArrowRight"), scopes)
            ours = [a for a in started if a["scoped"] and not a["loop"] and a["d"] >= 1]
            durations = {round(a["d"]) for a in ours}
            if reduced == "reduce":
                assert not [a for a in ours if moving(a)], f"motion under reduced motion: {ours}"
                expect(card).to_have_attribute("data-reserve", "below_reserve")
                expect(card).to_contain_text("Below reserve")
            else:
                assert {ROLL_MS, BAND_MS, RIBBON_MS} <= durations, f"durations started together: {durations}"
                assert {round(a["d"]) for a in started if not a["loop"] and a["d"] >= 1} <= DURATIONS_MS, started
                advance(page, SETTLE_MS)
                expect(card).to_have_attribute("data-reserve", "below_reserve")
                page.keyboard.press("ArrowLeft")
                advance(page, SETTLE_MS)
                expect(card).to_have_attribute("data-reserve", "ok")


def test_wf_passage_planner_happy(browser, app_url):
    ivo, nina = signin(app_url, IVO), signin(app_url, NINA)
    yacht = get_yacht(ivo, AS, "sunwake")
    where = places(ivo, AS)
    tag, _ = fresh("happy")
    departs = datetime(2027, 7, 3, 9, 0, tzinfo=ZONES["split"])
    with staff(browser, app_url, IVO, f"/w/{AS}/passages/new") as (page, _):
        h1(page, "New passage")
        select(role(page, "combobox", "Yacht"), "Sunwake")
        fill(role(page, "textbox", "Passage name"), f"Happy {tag}")
        fill(role(page, "textbox", "Departure date"), "2027-07-03")
        fill(role(page, "textbox", "Departure time"), "09:00")
        click(role(page, "button", "Create passage"))
        pid = lands(page, rf"^/w/{AS}/passages/(?!new$)([^/]+)$").group(1)
        says(page, "Passage created.")
        opener = role(page, "button", "Add leg")
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Add leg")
        trapped(page, dialog, role(dialog, "combobox", "Arrive at"))
        select(role(dialog, "combobox", "Arrive at"), where["hvar-stari-grad"]["name"])
        click(role(dialog, "button", "Add leg"))
        slider = role(page, "slider", "Leg 1 speed")
        shown(page, slider)
        assert now_value(slider) == NEW_LEG_KN
        slider.focus()
        page.keyboard.press("ArrowRight")
        advance(page, STEP_MS)
        ref = plan(yacht, where, "split-base", [{"toAnchorageId": "hvar-stari-grad", "speedKn": NEW_LEG_KN + SPEED_STEP}], 100, departs)
        expect(role(page, "status", "Passage updates")).to_contain_text(announcement(1, where["hvar-stari-grad"]["name"], ref[0]["pct"]))
        expect(leg_cards(page).first).to_have_attribute("data-arrival-charge", str(ref[0]["pct"]))
        click(role(page, "button", "Save passage"))
        says(page, "Passage saved.")
        send = role(page, "button", "Send to crew")
        expect(send).to_be_enabled()
        click(send)
        says(page, "Passage sent to crew.")
    saved = ok(ivo.get(f"/api/w/{AS}/passages/{pid}"))["passage"]
    assert saved["status"] == "sent" and saved["legs"][0]["speedKn"] == NEW_LEG_KN + SPEED_STEP
    assert saved["legs"][0]["arrivalChargePct"] == ref[0]["pct"]
    assert ok(nina.get(f"/api/w/{AS}/passages/{pid}"))["passage"]["status"] == "sent"
    with staff(browser, app_url, NINA, f"/w/{AS}/passages/{pid}") as (page, _):
        h1(page, f"Happy {tag}")
        shown(page, leg_cards(page))
        expect(page.get_by_role("slider")).to_have_count(0)
        expect(role(page, "button", "Send to crew")).to_have_count(0)
        expect(role(page, "button", "Add leg")).to_have_count(0)


def test_wf_passage_planner_below_reserve(browser, app_url):
    ivo = signin(app_url, IVO)
    yacht = get_yacht(ivo, AS, "sunwake")
    where = places(ivo, AS)
    tag, _ = fresh("reserve")
    departs = datetime(2027, 7, 3, 9, 0, tzinfo=ZONES["split"])
    passage = ok(ivo.post(f"/api/w/{AS}/passages", json={
        "yachtSlug": "sunwake", "name": f"Reserve {tag}", "startAnchorageId": "split-base", "departureDate": "2027-07-03",
        "departureTime": "09:00", "startChargePct": 100, "legs": [{"toAnchorageId": "hvar-stari-grad", "speedKn": NEW_LEG_KN}]}), 201)["passage"]
    fast = plan(yacht, where, "split-base", [{"toAnchorageId": "hvar-stari-grad", "speedKn": SPEED_MAX}], 100, departs)[0]
    slow = plan(yacht, where, "split-base", [{"toAnchorageId": "hvar-stari-grad", "speedKn": SPEED_MIN}], 100, departs)[0]
    assert fast["reserve"] == "below_reserve" and slow["reserve"] == "ok"
    with staff(browser, app_url, IVO, f"/w/{AS}/passages/{passage['id']}") as (page, _):
        slider = role(page, "slider", "Leg 1 speed")
        shown(page, slider)
        slider.focus()
        page.keyboard.press("End")
        advance(page, STEP_MS)
        card = leg_cards(page).first
        expect(card).to_have_attribute("data-reserve", "below_reserve")
        expect(card).to_contain_text("Below reserve")
        expect(role(page, "status", "Passage updates")).to_contain_text(announcement(1, where["hvar-stari-grad"]["name"], fast["pct"]))
        expect(role(page, "button", "Send to crew")).to_be_disabled()
        click(role(page, "button", "Save passage"))
        says(page, "Passage saved.")
        assert err(ivo.post(f"/api/w/{AS}/passages/{passage['id']}/send"), 409)["error"] == "below_reserve"
        slider.focus()
        page.keyboard.press("Home")
        advance(page, STEP_MS)
        expect(card).to_have_attribute("data-reserve", "ok")
        expect(role(page, "status", "Passage updates")).to_contain_text(announcement(1, where["hvar-stari-grad"]["name"], slow["pct"]))
        click(role(page, "button", "Save passage"))
        says(page, "Passage saved.")
        click(role(page, "button", "Send to crew"))
        says(page, "Passage sent to crew.")
    assert ok(ivo.get(f"/api/w/{AS}/passages/{passage['id']}"))["passage"]["status"] == "sent"


def test_wf_passage_planner_phone(browser, app_url):
    ivo = signin(app_url, IVO)
    tag, _ = fresh("phone")
    passage = two_leg_passage(ivo, tag)
    with staff(browser, app_url, IVO, f"/w/{AS}/passages/{passage['id']}", viewport=PHONE) as (page, _):
        shown(page, leg_cards(page))
        is_column(leg_cards(page))
        assert box(role(page, "img", "Charge ribbon"))["y"] < box(leg_cards(page).first)["y"]
        expect(role(page, "progressbar", "Legs position")).to_have_count(0)
        expect(page.get_by_role("slider")).to_have_count(0)
        opener = role(page, "button", "Set speeds")
        dialog = role(page, "dialog", "Leg speeds")
        expect(dialog).to_have_count(0)
        click(opener)
        advance(page, SETTLE_MS)
        one, two = role(dialog, "slider", "Leg 1 speed"), role(dialog, "slider", "Leg 2 speed")
        trapped(page, dialog, one)
        one.focus()
        save = role(dialog, "button", "Save passage")
        assert box(one)["y"] + box(one)["height"] <= box(save)["y"] + PX
        page.keyboard.press("]")
        advance(page, SETTLE_MS)
        expect(two).to_be_focused()
        assert box(two)["y"] + box(two)["height"] <= box(save)["y"] + PX
        page.keyboard.press("ArrowRight")
        advance(page, STEP_MS)
        assert now_value(two) == NEW_LEG_KN + SPEED_STEP
        closes_to(page, dialog, opener)
        reopens(page, dialog, opener)
        click(role(dialog, "button", "Save passage"))
        says(page, "Passage saved.")
        layout(page)
    saved = ok(ivo.get(f"/api/w/{AS}/passages/{passage['id']}"))["passage"]
    assert saved["legs"][1]["speedKn"] == NEW_LEG_KN + SPEED_STEP


def week_slots(rota: dict) -> list[dict]:
    return sorted(rota["slots"], key=lambda s: s["startsAt"])


def test_rest_rules(app_url):
    ivo = signin(app_url, IVO)
    week = "2027-06-05"
    rota = rota_get(ivo, AS, "halcyon-drift", week)
    slots = week_slots(rota)
    first = rota["crew"][0]
    run = MAX_WORK_RUN_H * 2 + 2
    refused = err(rota_put(ivo, AS, "halcyon-drift", week, rota["version"], {first["id"]: [s["startsAt"] for s in slots[:run]]}), 422)
    assert refused == {"error": "rest_rule", "crewId": first["id"], "crewName": first["name"], "rule": "max_gap_14h",
                       "windowStart": slots[0]["startsAt"], "windowEnd": slots[run]["startsAt"]}
    outside = iso(instant(slots[0]["startsAt"]) - timedelta(minutes=SLOT_MIN))
    assert err(rota_put(ivo, AS, "halcyon-drift", week, rota["version"], {first["id"]: [outside]}), 422)["errors"]["work"] == "Use slot start times inside this week."
    stranger = rota_get(ivo, AS, "sunwake", week)["crew"][0]["id"]
    assert err(rota_put(ivo, AS, "halcyon-drift", week, rota["version"], {stranger: []}), 404) == {"error": "not_found"}
    lawful = [s["startsAt"] for s in slots[16:24]]
    saved = ok(rota_put(ivo, AS, "halcyon-drift", week, rota["version"], {rota["crew"][1]["id"]: lawful}))
    assert saved["version"] == rota["version"] + 1 and sorted(saved["work"][rota["crew"][1]["id"]]) == lawful
    assert err(ivo.get(f"/api/w/{AS}/yachts/halcyon-drift/rota", params={"weekStart": "2027-06-06"}), 422)["errors"]

    spring_week = "2027-03-27"
    rota = rota_get(ivo, AS, "sunwake", spring_week)
    sunday = [s for s in week_slots(rota) if s["date"] == "2027-03-28"]
    assert len(sunday) == 46
    block = sunday[: MAX_WORK_RUN_H * 2]
    start = instant(block[0]["startsAt"])
    crew0 = rota["crew"][0]
    refused = err(rota_put(ivo, AS, "sunwake", spring_week, rota["version"], {crew0["id"]: [s["startsAt"] for s in block]}), 422)
    window = start - timedelta(hours=SPLIT_REST_LONG_H - 0.5)
    assert refused == {"error": "rest_rule", "crewId": crew0["id"], "crewName": crew0["name"], "rule": "rest_periods_24h",
                       "windowStart": iso(window), "windowEnd": iso(window + timedelta(hours=DAY_H))}

    autumn_week = (date(2027, 10, 31) - timedelta(days=1)).isoformat()
    rota = rota_get(ivo, AS, "sunwake", autumn_week)
    sunday = [s for s in week_slots(rota) if s["date"] == "2027-10-31"]
    assert len(sunday) == 50
    assert any(s["label"].endswith("(repeat)") for s in sunday)
    block = sunday[: MAX_WORK_RUN_H * 2 + 1]
    end = instant(block[0]["startsAt"]) + timedelta(minutes=SLOT_MIN * len(block))
    refused = err(rota_put(ivo, AS, "sunwake", autumn_week, rota["version"], {crew0["id"]: [s["startsAt"] for s in block]}), 422)
    assert refused == {"error": "rest_rule", "crewId": crew0["id"], "crewName": crew0["name"], "rule": "max_gap_14h",
                       "windowStart": block[0]["startsAt"], "windowEnd": iso(end)}


def test_stale_rota_save(app_url):
    ivo = signin(app_url, IVO)
    week = "2027-06-12"
    rota = rota_get(ivo, AS, "kelp-lantern", week)
    slots = week_slots(rota)
    crew0 = rota["crew"][0]["id"]
    lawful = [s["startsAt"] for s in slots[16:24]]
    saved = ok(rota_put(ivo, AS, "kelp-lantern", week, rota["version"], {crew0: lawful}))
    assert saved["version"] == rota["version"] + 1 and saved["savedBy"] == "Ivo Matic" and saved["base"] == "lavrio"
    stale = err(rota_put(ivo, AS, "kelp-lantern", week, rota["version"], {crew0: []}), 412)
    assert stale == {"error": "stale_rota", "savedBy": "Ivo Matic", "savedAt": saved["savedAt"]}
    breaking = [s["startsAt"] for s in slots[: MAX_WORK_RUN_H * 2 + 2]]
    assert err(rota_put(ivo, AS, "kelp-lantern", week, rota["version"], {crew0: breaking}), 412)["error"] == "stale_rota"
    now = rota_get(ivo, AS, "kelp-lantern", week)
    assert now["version"] == saved["version"] and sorted(now["work"][crew0]) == lawful
    assert ok(rota_put(ivo, AS, "kelp-lantern", week, saved["version"], {crew0: []}))["version"] == saved["version"] + 1


def test_rota_visibility(app_url):
    ivo, nina = signin(app_url, IVO), signin(app_url, NINA)
    week = "2027-07-03"
    assert ok(nina.get(f"/api/w/{AS}/yachts/sunwake/rota", params={"weekStart": week}))["yachtSlug"] == "sunwake"
    assert err(nina.get(f"/api/w/{AS}/yachts/halcyon-drift/rota", params={"weekStart": week}), 404) == {"error": "not_found"}
    assert err(rota_put(nina, AS, "sunwake", week, 0, {}), 403) == {"error": "forbidden"}
    tag, _ = fresh("vis")

    def make(slug, start, to, send):
        p = ok(ivo.post(f"/api/w/{AS}/passages", json={
            "yachtSlug": slug, "name": f"Vis {tag}", "startAnchorageId": start, "departureDate": week, "departureTime": "09:00",
            "startChargePct": 100, "legs": [{"toAnchorageId": to, "speedKn": SPEED_MIN}]}), 201)["passage"]
        if send:
            ok(ivo.post(f"/api/w/{AS}/passages/{p['id']}/send"))
        return p["id"]

    draft = make("sunwake", "split-base", "solta-maslinica", False)
    sent = make("sunwake", "split-base", "solta-maslinica", True)
    other = make("halcyon-drift", "split-base", "solta-maslinica", True)
    assert err(nina.get(f"/api/w/{AS}/passages/{draft}"), 404) == {"error": "not_found"}
    assert ok(nina.get(f"/api/w/{AS}/passages/{sent}"))["passage"]["status"] == "sent"
    assert err(nina.get(f"/api/w/{AS}/passages/{other}"), 404) == {"error": "not_found"}
    assert err(nina.get(f"/api/w/{AS}/passages", params={"yachtSlug": "halcyon-drift"}), 404) == {"error": "not_found"}
    ids = [p["id"] for p in ok(nina.get(f"/api/w/{AS}/passages", params={"yachtSlug": "sunwake"}))["passages"]]
    assert sent in ids and draft not in ids and other not in ids


def grid_texts(grid) -> list[str]:
    return [t.strip() for t in grid.get_by_role("gridcell").all_inner_texts()]


def changed_cells(before, after) -> list[int]:
    return [i for i, (a, b) in enumerate(zip(before, after)) if a != b]


def enter_grid(page, grid, day_tab) -> None:
    click(day_tab)
    advance(page, SETTLE_MS)
    day_tab.focus()
    for _ in range(TAB_PROBE):
        page.keyboard.press("Tab")
        if inside(grid):
            return
    raise AssertionError("Tab never reached the rota grid")


def space(page, grid) -> list[int]:
    before = grid_texts(grid)
    page.keyboard.press("Space")
    advance(page, STEP_MS)
    return changed_cells(before, grid_texts(grid))


def test_rota_grid_keyboard_touch(browser, app_url):
    week = "2027-06-19"
    path = f"/w/{AS}/yachts/halcyon-drift/rota?week={week}"
    with staff(browser, app_url, IVO, path) as (page, cli):
        rota = rota_get(cli, AS, "halcyon-drift", week)
        rows = len(rota["crew"])
        h1(page, "Halcyon Drift rota")
        grid = role(page, "grid", "Rota")
        enter_grid(page, grid, role(page, "tab", tab_text(week)))
        per_row = len(grid_texts(grid)) // rows
        assert per_row == len([s for s in rota["slots"] if s["date"] == week])
        page.keyboard.press("Tab")
        assert not inside(grid), "grid holds more than one Tab stop"
        page.keyboard.press("Shift+Tab")
        assert inside(grid)
        page.keyboard.press("Home")
        hit = space(page, grid)
        assert len(hit) == 1 and hit[0] % per_row == 0
        r = hit[0] // per_row
        page.keyboard.press("ArrowRight")
        assert space(page, grid) == [r * per_row + 1]
        page.keyboard.press("End")
        assert space(page, grid) == [r * per_row + per_row - 1]
        down = 1 if r < rows - 1 else -1
        page.keyboard.press("ArrowDown" if down == 1 else "ArrowUp")
        assert space(page, grid) == [(r + down) * per_row + per_row - 1]
        page.keyboard.press("Shift+ArrowLeft")
        advance(page, STEP_MS)
        expect(grid.get_by_role("gridcell", selected=True)).to_have_count(2)
        page.keyboard.press("Space")
        advance(page, STEP_MS)
        texts = grid_texts(grid)
        row = (r + down) * per_row
        assert texts[row + per_row - 1] == texts[row + per_row - 2]
        page.keyboard.press("Shift+ArrowUp" if down == 1 else "Shift+ArrowDown")
        advance(page, STEP_MS)
        expect(grid.get_by_role("gridcell", selected=True)).to_have_count(4)
        page.set_viewport_size(PHONE)
        advance(page, SETTLE_MS)
        cell = grid.get_by_role("gridcell").nth(2)
        before = cell.inner_text().strip()
        unscroll(cell)
        tap(cell)
        advance(page, STEP_MS)
        assert cell.inner_text().strip() in ("W", "R") and cell.inner_text().strip() != before


def test_wf_crew_rota_save(browser, app_url):
    week = "2027-06-26"
    mira = signin(app_url, MIRA)
    rota = rota_get(mira, AS, "kelp-lantern", week)
    ok(rota_put(mira, AS, "kelp-lantern", week, rota["version"], {}))
    with staff(browser, app_url, IVO, f"/w/{AS}/yachts/kelp-lantern/rota?week={week}") as (page, cli):
        grid = role(page, "grid", "Rota")
        enter_grid(page, grid, role(page, "tab", tab_text(week)))
        per_row = len(grid_texts(grid)) // len(rota["crew"])
        page.keyboard.press("Home")
        hit = space(page, grid)
        r = hit[0] // per_row
        for _ in range(7):
            page.keyboard.press("ArrowRight")
            space(page, grid)
        assert grid_texts(grid)[r * per_row:r * per_row + 8] == ["W"] * 8
        click(role(page, "button", "Save rota"))
        says(page, "Rota saved.")
        name = rota["crew"][r]["name"]
    saved = rota_get(mira, AS, "kelp-lantern", week)
    crew_id = next(c["id"] for c in saved["crew"] if c["name"] == name)
    assert sorted(saved["work"][crew_id]) == [s["startsAt"] for s in week_slots(saved)[:8]]
    assert saved["savedBy"] == "Ivo Matic"


def test_wf_crew_rota_refused(browser, app_url):
    week = "2027-07-03"
    mira = signin(app_url, MIRA)
    rota = rota_get(mira, AS, "halcyon-drift", week)
    v1 = ok(rota_put(mira, AS, "halcyon-drift", week, rota["version"], {}))["version"]
    run = MAX_WORK_RUN_H * 2 + 1
    with staff(browser, app_url, IVO, f"/w/{AS}/yachts/halcyon-drift/rota?week={week}") as (page, _):
        grid = role(page, "grid", "Rota")
        enter_grid(page, grid, role(page, "tab", tab_text(week)))
        per_row = len(grid_texts(grid)) // len(rota["crew"])
        page.keyboard.press("Home")
        r = space(page, grid)[0] // per_row
        for _ in range(run - 1):
            page.keyboard.press("ArrowRight")
            space(page, grid)
        typed = grid_texts(grid)
        name = rota["crew"][r]["name"]
        slots = week_slots(rota)
        click(role(page, "button", "Save rota"))
        says(page, f"{name} breaks the rest rules: {RULE_TEXT['max_gap_14h']}, from {time_text(slots[0]['startsAt'])} to {time_text(slots[run]['startsAt'])}.")
        assert grid_texts(grid) == typed
        newer = ok(rota_put(mira, AS, "halcyon-drift", week, v1, {}))
        click(role(page, "button", "Save rota"))
        says(page, f"Mira Kovac saved this rota at {time_text(newer['savedAt'])}. Your changes are still here — check them and save again.")
        assert grid_texts(grid) == typed
    stored = rota_get(mira, AS, "halcyon-drift", week)
    assert stored["version"] == newer["version"] and not any(stored["work"].values())


def test_wf_crew_rota_phone(browser, app_url):
    week = "2027-07-10"
    for size in NARROW:
        with staff(browser, app_url, IVO, f"/w/{AS}/yachts/sunwake/rota?week={week}", viewport=size) as (page, _):
            grid = role(page, "grid", "Rota")
            shown(page, grid)
            layout(page)
            if size is PHONE:
                tappable(page)
            assert scrolls_sideways(grid), "rota grid does not scroll sideways inside its own frame"
            enter_grid(page, grid, role(page, "tab", tab_text(week)))
            page.keyboard.press("Home")
            space(page, grid)
            opener = role(page, "link", "Next week")
            click(opener)
            advance(page, SETTLE_MS)
            dialog = role(page, "dialog", "Discard changes")
            trapped(page, dialog, role(dialog, "button", "Keep editing"))
            closes_to(page, dialog, opener)
            click(opener)
            advance(page, SETTLE_MS)
            click(role(dialog, "button", "Discard changes"))
            nxt = (as_date(week) + timedelta(days=7)).isoformat()
            end = time.monotonic() + UI_WAIT_S
            while parse_qs(urlparse(page.url).query).get("week") != [nxt]:
                assert time.monotonic() < end, page.url
                advance(page, STEP_MS)


def available_arrival(cli, ws, marina, slug, code, nights) -> str:
    today = as_date(marina_map(cli, ws)[marina]["today"])
    rnd = random.SystemRandom()
    for _ in range(40):
        arrival = (today + timedelta(days=rnd.randrange(400, 6000))).isoformat()
        berths = ok(cli.get(f"/api/w/{ws}/marinas/{marina}/berths", params={"yachtSlug": slug, "arrivalDate": arrival, "nights": nights}))["berths"]
        if next(b for b in berths if b["code"] == code)["available"]:
            return arrival
    raise AssertionError("no free nights found")


def book_berth(cli, ws, slug, marina, code, arrival, nights) -> httpx.Response:
    return cli.post(f"/api/w/{ws}/berth-bookings", json={"yachtSlug": slug, "marinaId": marina, "berthCode": code, "arrivalDate": arrival, "nights": nights})


def test_berth_fit(app_url):
    ivo = signin(app_url, IVO)
    arrival = available_arrival(ivo, AS, "split-marina", "sunwake", "A4", 2)
    berths = {b["code"]: b for b in ok(ivo.get(f"/api/w/{AS}/marinas/split-marina/berths", params={"yachtSlug": "sunwake", "arrivalDate": arrival, "nights": 2}))["berths"]}
    assert {c: b["fits"] for c, b in berths.items()} == {"A1": False, "A2": True, "A3": True, "A4": True, "A5": False, "A6": False}
    lav = {b["code"]: b["fits"] for b in ok(ivo.get(f"/api/w/{AS}/marinas/lavrio-marina/berths", params={"yachtSlug": "kelp-lantern", "arrivalDate": arrival, "nights": 1}))["berths"]}
    assert lav == {"B1": True, "B2": True, "B3": True, "B4": True}
    assert err(book_berth(ivo, AS, "sunwake", "split-marina", "A5", arrival, 2), 409) == {"error": "does_not_fit"}
    tariffs = marina_map(ivo, AS)["split-marina"]["tariffs"]
    booking = ok(book_berth(ivo, AS, "sunwake", "split-marina", "A4", arrival, 2), 201)["booking"]
    for i, night in enumerate(booking["nights"]):
        day = as_date(arrival) + timedelta(days=i)
        rate, fee = nightly(tariffs, day, "18.29")
        assert night["date"] == day.isoformat() and night["feeMinor"] == fee
        if rate == 450:
            assert money("EUR", fee) == "EUR 82.31"
    assert booking["totalMinor"] == sum(n["feeMinor"] for n in booking["nights"])
    assert booking["departureDate"] == (as_date(arrival) + timedelta(days=2)).isoformat()
    after = {b["code"]: b for b in ok(ivo.get(f"/api/w/{AS}/marinas/split-marina/berths", params={"yachtSlug": "sunwake", "arrivalDate": arrival, "nights": 2}))["berths"]}
    assert after["A4"]["available"] is False and after["A5"]["available"] is True
    assert err(book_berth(ivo, AS, "sunwake", "split-marina", "A4", (as_date(arrival) + timedelta(days=1)).isoformat(), 1), 409) == {"error": "berth_taken"}
    assert err(book_berth(ivo, AS, "sunwake", "split-marina", "A2", arrival, NIGHTS_RANGE[1] + 1), 422)["errors"]["nights"] == whole_number(*NIGHTS_RANGE)
    today = as_date(marina_map(ivo, AS)["split-marina"]["today"])
    assert err(book_berth(ivo, AS, "sunwake", "split-marina", "A2", (today - timedelta(days=1)).isoformat(), 1), 422)["errors"]["arrivalDate"] == "Choose today or a later date."


def test_tariff_by_night(browser, app_url):
    ivo, ana = signin(app_url, IVO), signin(app_url, ANA)
    marina = marina_map(ivo, AS)["lavrio-marina"]
    rnd = random.SystemRandom()
    taken = {t["effectiveDate"] for t in marina["tariffs"]}
    for _ in range(40):
        eff = as_date(marina["today"]) + timedelta(days=rnd.randrange(400, 6000))
        prev = (eff - timedelta(days=1)).isoformat()
        rows = {b["code"]: b for b in ok(ivo.get(f"/api/w/{AS}/marinas/lavrio-marina/berths", params={"yachtSlug": "kelp-lantern", "arrivalDate": prev, "nights": 2}))["berths"]}
        if eff.isoformat() not in taken and rows["B1"]["available"] and rows["B2"]["available"]:
            break
    booking = ok(book_berth(ivo, AS, "kelp-lantern", "lavrio-marina", "B1", prev, 2), 201)["booking"]
    old_rate, old_fee = nightly(marina["tariffs"], eff, "16.15")
    assert [n["feeMinor"] for n in booking["nights"]] == [nightly(marina["tariffs"], eff - timedelta(days=1), "16.15")[1], old_fee]
    new_rate = 777
    assert err(ivo.post(f"/api/w/{AS}/marinas/lavrio-marina/tariffs", json={"effectiveDate": eff.isoformat(), "ratePerMetreMinor": new_rate}), 403) == {"error": "forbidden"}
    assert err(ana.post(f"/api/w/{AS}/marinas/lavrio-marina/tariffs", json={"effectiveDate": marina["today"], "ratePerMetreMinor": new_rate}), 422)["errors"]["effectiveDate"] == "Choose a date after today."
    tariff = ok(ana.post(f"/api/w/{AS}/marinas/lavrio-marina/tariffs", json={"effectiveDate": eff.isoformat(), "ratePerMetreMinor": new_rate}), 201)["tariff"]
    assert tariff["effectiveDate"] == eff.isoformat() and tariff["ratePerMetreMinor"] == new_rate
    assert err(ana.post(f"/api/w/{AS}/marinas/lavrio-marina/tariffs", json={"effectiveDate": eff.isoformat(), "ratePerMetreMinor": new_rate}), 409) == {"error": "date_exists"}
    kept = ok(ivo.get(f"/api/w/{AS}/berth-bookings/{booking['id']}"))["booking"]
    assert kept["nights"] == booking["nights"] and kept["totalMinor"] == booking["totalMinor"]
    quote = next(b for b in ok(ivo.get(f"/api/w/{AS}/marinas/lavrio-marina/berths", params={"yachtSlug": "kelp-lantern", "arrivalDate": prev, "nights": 2}))["berths"] if b["code"] == "B2")
    assert [n["ratePerMetreMinor"] for n in quote["nights"]] == [booking["nights"][0]["ratePerMetreMinor"], new_rate]
    assert quote["nights"][1]["feeMinor"] == int(half_up(Decimal("16.15") * new_rate))
    with staff(browser, app_url, IVO, f"/w/{AS}/berth-bookings/{booking['id']}") as (page, _):
        h1(page, "Berth B1, Lavrio Marina")
        nights = role(page, "table", "Nights")
        for n in booking["nights"]:
            expect(nights).to_contain_text(money("EUR", n["feeMinor"]))
        expect(nights).not_to_contain_text(money("EUR", quote["nights"][1]["feeMinor"]))


def open_slots(cli, ws, pontoon, need: int) -> tuple[str, list[dict]]:
    today = as_date(marina_map(cli, ws)["split-marina"]["today"])
    rnd = random.SystemRandom()
    for _ in range(40):
        day = (today + timedelta(days=rnd.randrange(400, 6000))).isoformat()
        board = ok(cli.get(f"/api/w/{ws}/marinas/split-marina/pontoons/{pontoon}/slots", params={"date": day}))
        free = [s for s in board["slots"] if s["status"] == "open" and s["bookedKw"] == 0]
        if len(free) >= need:
            return day, free
    raise AssertionError("no empty slots")


def book_slot(cli, ws, slug, pontoon, start) -> httpx.Response:
    return cli.post(f"/api/w/{ws}/shore-power-bookings", json={"yachtSlug": slug, "marinaId": "split-marina", "pontoonCode": pontoon, "slotStart": start})


def test_shore_power_slots(app_url):
    ivo, mira = signin(app_url, IVO), signin(app_url, MIRA)
    day, free = open_slots(ivo, AS, "D", 1)
    slot = free[0]
    assert instant(slot["endsAt"]) - instant(slot["startsAt"]) == timedelta(minutes=SLOT_MIN)
    gate = threading.Barrier(2)

    def go(args):
        cli, who, slug, yname = args
        gate.wait()
        return who, yname, book_slot(cli, AS, slug, "D", slot["startsAt"])

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(go, [(ivo, "Ivo Matic", "sunwake", "Sunwake"), (mira, "Mira Kovac", "halcyon-drift", "Halcyon Drift")]))
    assert sorted(r.status_code for _, _, r in results) == [201, 409]
    (who, yname, win), (_, _, lose) = sorted(results, key=lambda x: x[2].status_code)
    booking = win.json()["booking"]
    assert booking["kw"] == SHORE_KW
    assert lose.json() == {"error": "slot_taken", "takenBy": f"{who} for {yname}", "takenAt": booking["bookedAt"]}
    board = ok(ivo.get(f"/api/w/{AS}/marinas/split-marina/pontoons/D/slots", params={"date": day}))
    row = next(s for s in board["slots"] if s["startsAt"] == slot["startsAt"])
    assert row["status"] == "full" and row["bookedKw"] == SHORE_KW and len(row["bookings"]) == 1

    day2, free2 = open_slots(ivo, AS, "C", 1)
    start = free2[0]["startsAt"]
    first = ok(book_slot(ivo, AS, "sunwake", "C", start), 201)["booking"]
    assert err(book_slot(ivo, AS, "sunwake", "C", start), 409) == {"error": "already_booked"}
    _PAUSE.wait(1.1)
    second = ok(book_slot(mira, AS, "halcyon-drift", "C", start), 201)["booking"]
    assert instant(second["bookedAt"]) >= instant(first["bookedAt"])
    assert err(book_slot(ivo, AS, "kelp-lantern", "C", start), 409) == {"error": "slot_taken", "takenBy": "Mira Kovac for Halcyon Drift", "takenAt": second["bookedAt"]}
    row = next(s for s in ok(ivo.get(f"/api/w/{AS}/marinas/split-marina/pontoons/C/slots", params={"date": day2}))["slots"] if s["startsAt"] == start)
    assert row["status"] == "full"
    today = marina_map(ivo, AS)["split-marina"]["today"]
    past = ok(ivo.get(f"/api/w/{AS}/marinas/split-marina/pontoons/C/slots", params={"date": today}))["slots"][0]
    assert past["status"] == "past"
    assert err(book_slot(ivo, AS, "sunwake", "C", past["startsAt"]), 409) == {"error": "slot_past"}
    odd = iso(instant(free2[-1]["startsAt"]) + timedelta(minutes=SLOT_MIN // 2))
    assert "Choose a slot that starts on the hour or half hour." in err(book_slot(ivo, AS, "sunwake", "C", odd), 422)["errors"].values()


def test_wf_berths_book(browser, app_url):
    ivo = signin(app_url, IVO)
    arrival = available_arrival(ivo, AS, "split-marina", "sunwake", "A4", 2)
    for size in (TABLET, PHONE):
        with staff(browser, app_url, IVO, f"/w/{AS}/berths", viewport=size) as (page, _):
            h1(page, "Berths")
            select(role(page, "combobox", "Yacht"), "Sunwake")
            select(role(page, "combobox", "Marina"), "Split Marina")
            fill(role(page, "textbox", "Arrival date"), arrival)
            fill(role(page, "spinbutton", "Nights"), "2")
            click(role(page, "button", "Search berths"))
            results = role(page, "list", "Berths")
            a4 = results.get_by_role("listitem").filter(has_text="Berth A4")
            shown(page, a4)
            expect(a4).to_contain_text("Fits")
            expect(a4).to_contain_text("Available")
            expect(a4).to_contain_text(figure("18.29"))
            expect(results.get_by_role("listitem").filter(has_text="Berth A5")).to_contain_text("Doesn't fit")
            expect(role(page, "button", "Book berth A5")).to_have_count(0)
            assert box(results)["y"] >= box(role(page, "button", "Search berths"))["y"]
            layout(page)
            if size is PHONE:
                opener = role(page, "button", "Book berth A4")
                click(opener)
                advance(page, SETTLE_MS)
                dialog = role(page, "dialog", "Book berth")
                expect(role(dialog, "table", "Nights")).to_be_visible()
                trapped(page, dialog, role(dialog, "button", "Book berth"))
                closes_to(page, dialog, opener)
                click(opener)
                advance(page, SETTLE_MS)
                click(role(dialog, "button", "Book berth"))
                bid = lands(page, rf"^/w/{AS}/berth-bookings/([^/]+)$").group(1)
                h1(page, "Berth A4, Split Marina")
                says(page, f"Berth A4 booked from {day_text(arrival)}.")
    code = "A2"
    taken = available_arrival(ivo, AS, "split-marina", "sunwake", code, 2)
    with staff(browser, app_url, IVO, f"/w/{AS}/berths", viewport=TABLET) as (page, _):
        select(role(page, "combobox", "Yacht"), "Sunwake")
        select(role(page, "combobox", "Marina"), "Split Marina")
        fill(role(page, "textbox", "Arrival date"), taken)
        fill(role(page, "spinbutton", "Nights"), "2")
        click(role(page, "button", "Search berths"))
        opener = role(page, "button", f"Book berth {code}")
        shown(page, opener)
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Book berth")
        ok(book_berth(signin(app_url, MIRA), AS, "sunwake", "split-marina", code, taken, 1), 201)
        click(role(dialog, "button", "Book berth"))
        shown(page, dialog.get_by_text(f"Berth {code} is already booked for one of those nights.", exact=True))
        refused_in(page, dialog, "Book berth")
    booking = ok(ivo.get(f"/api/w/{AS}/berth-bookings/{bid}"))["booking"]
    assert booking["berthCode"] == "A4" and booking["arrivalDate"] == arrival and len(booking["nights"]) == 2


def test_wf_berths_shore_power(browser, app_url):
    ivo, mira = signin(app_url, IVO), signin(app_url, MIRA)
    day, free = open_slots(ivo, AS, "D", 2)
    first, second = free[0], free[1]
    label = lambda s: instant(s["startsAt"]).astimezone(ZONES["split"]).strftime("%H:%M")
    skew = instant(first["startsAt"]) + DEVICE_SKEW
    with staff(browser, app_url, IVO, f"/w/{AS}/shore-power", device_time=skew) as (page, _):
        h1(page, "Shore power")
        expect(role(page, "textbox", "Date")).to_have_value(marina_map(ivo, AS)["split-marina"]["today"])
        select(role(page, "combobox", "Marina"), "Split Marina")
        select(role(page, "combobox", "Pontoon"), "D")
        fill(role(page, "textbox", "Date"), day)
        page.keyboard.press("Enter")
        btn = role(page, "button", f"Book {label(first)} slot")
        shown(page, btn)
        end_label = instant(first["endsAt"]).astimezone(ZONES["split"]).strftime("%H:%M")
        item = role(page, "list", "Slots").get_by_role("listitem").filter(has_text=f"{label(first)}–{end_label}")
        expect(item).to_contain_text("Open")
        expect(btn).to_be_enabled()
        click(btn)
        says(page, f"Shore power booked for {time_text(first['startsAt'])}.")
        later = role(page, "button", f"Book {label(second)} slot")
        shown(page, later)
        expect(later).to_be_enabled()
        taken = ok(book_slot(mira, AS, "sunwake", "D", second["startsAt"]), 201)["booking"]
        click(later)
        says(page, f"Too late — Mira Kovac for Sunwake took this slot at {time_text(taken['bookedAt'])}.")
    rows = {s["startsAt"]: s for s in ok(ivo.get(f"/api/w/{AS}/marinas/split-marina/pontoons/D/slots", params={"date": day}))["slots"]}
    assert [b["yachtSlug"] for b in rows[first["startsAt"]]["bookings"]] == ["halcyon-drift"]
    assert [b["yachtSlug"] for b in rows[second["startsAt"]]["bookings"]] == ["sunwake"]


def test_charter_pricing(app_url):
    luka = signin(app_url, LUKA)
    today = split_today(luka, AS)
    table = table_in_force(luka, AS, today)
    tag, email = fresh("price")
    cases = (("sunwake", "split", 7, "GBP"), ("kelp-lantern", "lavrio", 8, "USD"), ("halcyon-drift", "split", 7, "EUR"))
    for slug, base, month, cur in cases:
        yacht = get_yacht(luka, AS, slug)
        ch = direct_charter(luka, AS, slug, month, cur, f"P {tag}", email)
        rate = Decimal("1") if cur == "EUR" else Decimal(table["rates"][cur])
        assert Decimal(ch["rate"]) == rate and ch["currency"] == cur and ch["season"] == "high"
        if cur != "EUR":
            assert ch["exchangeTableId"] == table["id"]
        eur, amount = priced(yacht, base, ch["weekStart"], rate)
        assert [l["kind"] for l in ch["lines"]] == ["charter_fee", "provisioning_allowance", "vat"]
        assert [l["eurMinor"] for l in ch["lines"]] == eur and [l["amountMinor"] for l in ch["lines"]] == amount
        assert ch["totalEurMinor"] == sum(eur) and ch["totalMinor"] == sum(amount)
        assert ch["invoiceStatus"] == "not_invoiced" and ch["killbillInvoiceId"] is None
        if slug == "sunwake":
            assert [money("EUR", e) for e in eur] == ["EUR 32,900.00", "EUR 9,870.00", "EUR 4,277.00"]
            if rate == Decimal("0.8450"):
                assert [money("GBP", a) for a in amount] == ["GBP 27,800.50", "GBP 8,340.15", "GBP 3,614.07"]
                assert money("GBP", sum(amount)) == "GBP 39,754.72"
    week = free_week(luka, AS, "halcyon-drift")
    hold = ok(place(luka, AS, "halcyon-drift", week["weekStart"], f"Q {tag}"), 201)["hold"]
    q = ok(luka.get(f"/api/w/{AS}/holds/{hold['id']}/quote", params={"currency": "EUR"}))["quote"]
    assert Decimal(q["rate"]) == 1 and [l["amountMinor"] for l in q["lines"]] == [l["eurMinor"] for l in q["lines"]]
    assert [l["eurMinor"] for l in q["lines"]] == priced(get_yacht(luka, AS, "halcyon-drift"), "split", week["weekStart"], Decimal(1))[0]
    usd = ok(signin(app_url, ANA).get(f"/api/w/{AS}/holds/{hold['id']}/quote", params={"currency": "USD"}))["quote"]
    assert Decimal(usd["rate"]) == Decimal(table["rates"]["USD"]) and usd["totalMinor"] == sum(l["amountMinor"] for l in usd["lines"])
    assert err(luka.get(f"/api/w/{AS}/holds/{hold['id']}/quote", params={"currency": "JPY"}), 422)["errors"]["currency"] == "Choose one of the listed options."
    assert err(signin(app_url, IVO).get(f"/api/w/{AS}/holds/{hold['id']}/quote", params={"currency": "EUR"}), 403) == {"error": "forbidden"}


def deposit_pair(cli, hold_id, email, currency):
    gate = threading.Barrier(2)

    def go(_):
        gate.wait()
        return cli.post(f"/api/w/{AS}/holds/{hold_id}/deposit", json={"clientEmail": email, "currency": currency})

    with ThreadPoolExecutor(2) as pool:
        return list(pool.map(go, range(2)))


def test_deposit_atomic_and_once(app_url, killbill, mail):
    luka = signin(app_url, LUKA)
    week = free_week(luka, AS, "halcyon-drift")
    tag, email = fresh("deposit")
    client = f"Owen {tag}"
    hold = ok(place(luka, AS, "halcyon-drift", week["weekStart"], client), 201)["hold"]
    results = deposit_pair(http_session_clone(luka, app_url), hold["id"], email, "GBP")
    assert sorted(r.status_code for r in results) == [201, 409]
    charter = next(r for r in results if r.status_code == 201).json()["charter"]
    assert next(r for r in results if r.status_code == 409).json()["error"] == "hold_not_live"
    assert charter["invoiceStatus"] == "invoiced" and charter["killbillInvoiceId"] and charter["invoicedAt"]
    assert charter["depositDate"] == split_today(luka, AS).isoformat()
    account = killbill.account_by_key(f"tidewright-{charter['id']}")
    assert account and account["currency"] == "GBP" and account["email"].lower() == email
    assert killbill.account(email)["accountId"] == account["accountId"]
    invoices = killbill.invoices(account["accountId"])
    assert len(invoices) == 1 and invoices[0]["invoiceId"] == charter["killbillInvoiceId"]
    assert sorted(Decimal(str(i["amount"])) for i in invoices[0]["items"]) == sorted(Decimal(l["amountMinor"]) / 100 for l in charter["lines"])
    msgs = await_mail(mail, email)
    assert len(mails_to(mail, email)) == 1
    m = msgs[0]
    assert m.get("Subject") == f"Charter confirmed: Halcyon Drift, week of {day_text(week['weekStart'])}"
    assert mail_from_address().lower() in [a.lower() for a in addresses(m.get("From"))]
    body = text(m)
    for l in charter["lines"]:
        assert money("GBP", l["amountMinor"]) in body
    assert money("GBP", charter["totalMinor"]) in body and charter["killbillInvoiceId"] in body and client in body
    assert get_hold(luka, AS, hold["id"])["status"] == "charter"
    assert next(w for w in week_list(luka, AS, "halcyon-drift") if w["weekStart"] == week["weekStart"])["status"] == "booked"
    assert err(luka.post(f"/api/w/{AS}/holds/{hold['id']}/deposit", json={"clientEmail": email, "currency": "GBP"}), 409)["error"] == "hold_not_live"
    assert len(killbill.invoices(account["accountId"])) == 1 and len(mails_to(mail, email)) == 1


def http_session_clone(cli: httpx.Client, base: str) -> httpx.Client:
    c = http(base)
    c.cookies.update(cli.cookies)
    return c


def test_invoicing_outage(killbill, mail):
    base = kb_down_url()
    assert ok(httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)) == {"status": "ok"}
    luka = signin(base, LUKA)
    week = free_week(luka, AS, "sunwake")
    tag, email = fresh("kbdown")
    hold = ok(place(luka, AS, "sunwake", week["weekStart"], f"K {tag}"), 201)["hold"]
    ok(luka.get(f"/api/w/{AS}/holds/{hold['id']}/quote", params={"currency": "GBP"}))
    for _ in range(2):
        assert err(luka.post(f"/api/w/{AS}/holds/{hold['id']}/deposit", json={"clientEmail": email, "currency": "GBP"}), 503) == {"error": "billing_unavailable"}
    h = get_hold(luka, AS, hold["id"])
    assert h["status"] == "live" and h["charterId"] is None
    assert all(c["holdId"] != hold["id"] for c in ok(luka.get(f"/api/w/{AS}/charters"))["charters"])
    assert next(w for w in week_list(luka, AS, "sunwake") if w["weekStart"] == week["weekStart"])["status"] == "held"
    assert killbill.account(email) is None
    assert mails_to(mail, email) == []
    assert stored_anywhere(Postgres("_kbdown"), email) == []
    for path in (f"/api/w/{AS}/yachts", f"/api/w/{AS}/holds", f"/api/w/{AS}/marinas", f"/api/w/{AS}/brokers"):
        ok(luka.get(path))
    assert direct_charter(luka, AS, "sunwake", 7, "EUR", f"D {tag}", email)["invoiceStatus"] == "not_invoiced"


def test_exchange_table_effective(browser, app_url, killbill, mail):
    luka, ana = signin(app_url, LUKA), signin(app_url, ANA)
    today = split_today(luka, AS)
    table = table_in_force(luka, AS, today)
    tag, email = fresh("fx")
    week = free_week(luka, AS, "kelp-lantern")
    hold = ok(place(luka, AS, "kelp-lantern", week["weekStart"], f"Fx {tag}"), 201)["hold"]
    charter = ok(luka.post(f"/api/w/{AS}/holds/{hold['id']}/deposit", json={"clientEmail": email, "currency": "USD"}), 201)["charter"]
    assert charter["exchangeTableId"] == table["id"] and Decimal(charter["rate"]) == Decimal(table["rates"]["USD"])
    rates = {"GBP": "0.9123", "USD": "1.2345"}
    taken = {t["effectiveDate"] for t in ok(ana.get(f"/api/w/{AS}/exchange-tables"))["exchangeTables"]}
    rnd = random.SystemRandom()
    eff = next(x for x in ((today + timedelta(days=rnd.randrange(400, 6000))).isoformat() for _ in range(40)) if x not in taken)
    assert err(luka.post(f"/api/w/{AS}/exchange-tables", json={"effectiveDate": eff, "rates": rates}), 403) == {"error": "forbidden"}
    assert err(ana.post(f"/api/w/{AS}/exchange-tables", json={"effectiveDate": today.isoformat(), "rates": rates}), 422)["errors"]["effectiveDate"] == "Choose a date after today."
    assert err(ana.post(f"/api/w/{AS}/exchange-tables", json={"effectiveDate": eff, "rates": {"GBP": "0.1234567", "USD": "1.1"}}), 422)["errors"]["rates.GBP"] == "Enter a rate above 0 with at most six decimals."
    added = ok(ana.post(f"/api/w/{AS}/exchange-tables", json={"effectiveDate": eff, "rates": rates}), 201)["exchangeTable"]
    assert added["effectiveDate"] == eff
    assert err(ana.post(f"/api/w/{AS}/exchange-tables", json={"effectiveDate": eff, "rates": rates}), 409) == {"error": "date_exists"}
    again = ok(luka.get(f"/api/w/{AS}/charters/{charter['id']}"))["charter"]
    for key in ("rate", "lines", "totalMinor", "totalEurMinor", "exchangeTableId", "killbillInvoiceId"):
        assert again[key] == charter[key]
    account = killbill.account_by_key(f"tidewright-{charter['id']}")
    inv = killbill.invoices(account["accountId"])
    assert len(inv) == 1 and sum(Decimal(str(i["amount"])) for i in inv[0]["items"]) == Decimal(charter["totalMinor"]) / 100
    msgs = await_mail(mail, email)
    assert len(msgs) == 1 and money("USD", charter["totalMinor"]) in text(msgs[0])
    week2 = free_week(luka, AS, "kelp-lantern")
    h2 = ok(place(luka, AS, "kelp-lantern", week2["weekStart"], f"Fx2 {tag}"), 201)["hold"]
    assert ok(luka.get(f"/api/w/{AS}/holds/{h2['id']}/quote", params={"currency": "USD"}))["quote"]["exchangeTableId"] == table["id"]
    with staff(browser, app_url, LUKA, f"/w/{AS}/charters/{charter['id']}") as (page, _):
        expect(role(page, "table", "Charter lines")).to_contain_text(money("USD", charter["totalMinor"]))


def test_wf_charter_invoicing_deposit(browser, app_url, killbill, mail):
    luka = signin(app_url, LUKA)
    week = free_week(luka, AS, "sunwake")
    tag, email = fresh("ui-dep")
    client = f"Dep {tag}"
    hold = ok(place(luka, AS, "sunwake", week["weekStart"], client), 201)["hold"]
    quote = ok(luka.get(f"/api/w/{AS}/holds/{hold['id']}/quote", params={"currency": "GBP"}))["quote"]
    with staff(browser, app_url, LUKA, f"/w/{AS}/holds/{hold['id']}") as (page, _):
        opener = role(page, "button", "Record deposit")
        shown(page, opener)
        expect(opener).to_be_enabled()
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Record deposit")
        trapped(page, dialog, role(dialog, "textbox", "Client email"))
        fill(role(dialog, "textbox", "Client email"), email)
        pick(role(dialog, "radio", "GBP"))
        advance(page, SETTLE_MS)
        expect(role(dialog, "table", "Price")).to_contain_text(money("GBP", quote["totalMinor"]))
        role(dialog, "button", "Record deposit").dblclick()
        cid = lands(page, rf"^/w/{AS}/charters/([^/]+)$").group(1)
        h1(page, f"Charter for {client}")
        says(page, f"Deposit recorded. Charter invoiced and confirmation sent to {email}.")
        shown(page, page.get_by_text(re.compile(r"(?<!Not )\bInvoiced\b")))
        lines = role(page, "table", "Charter lines")
        for label in ("Charter fee", "Provisioning allowance (30%)", "VAT 13% on charter fee", "Total"):
            expect(lines).to_contain_text(label)
        for l in quote["lines"]:
            expect(lines).to_contain_text(money("GBP", l["amountMinor"]))
            expect(lines).to_contain_text(money("EUR", l["eurMinor"]))
    charter = ok(luka.get(f"/api/w/{AS}/charters/{cid}"))["charter"]
    account = killbill.account_by_key(f"tidewright-{cid}")
    assert len(killbill.invoices(account["accountId"])) == 1 and charter["invoiceStatus"] == "invoiced"
    await_mail(mail, email)
    assert len(mails_to(mail, email)) == 1
    with staff(browser, app_url, ANA, f"/w/{AS}/charters") as (page, _):
        row = role(page, "table", "Charters").get_by_role("row").filter(has_text=client)
        shown(page, row)
        expect(row).to_contain_text("Invoiced")


def test_wf_charter_invoicing_refused(browser, app_url):
    luka = signin(app_url, LUKA)
    week = free_week(luka, AS, "halcyon-drift")
    tag, _ = fresh("bad-dep")
    hold = ok(place(luka, AS, "halcyon-drift", week["weekStart"], f"Bad {tag}"), 201)["hold"]
    with staff(browser, app_url, LUKA, f"/w/{AS}/holds/{hold['id']}") as (page, _):
        click(role(page, "button", "Record deposit"))
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Record deposit")
        field = role(dialog, "textbox", "Client email")
        fill(field, BAD_EMAIL)
        click(role(dialog, "button", "Record deposit"))
        shown(page, dialog.get_by_text("Enter an email address like name@example.com.", exact=True))
        expect(dialog).to_be_visible()
        expect(field).to_have_value(BAD_EMAIL)
        expect(field).to_be_focused()
    assert get_hold(luka, AS, hold["id"])["status"] == "live"


def test_wf_charter_invoicing_outage(browser):
    base = kb_down_url()
    luka = signin(base, LUKA)
    week = free_week(luka, AS, "kelp-lantern")
    tag, email = fresh("kb-ui")
    hold = ok(place(luka, AS, "kelp-lantern", week["weekStart"], f"Out {tag}"), 201)["hold"]
    with staff(browser, base, LUKA, f"/w/{AS}/holds/{hold['id']}") as (page, _):
        click(role(page, "button", "Record deposit"))
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Record deposit")
        fill(role(dialog, "textbox", "Client email"), email)
        click(role(dialog, "button", "Record deposit"))
        says(page, INVOICING_OUTAGE)
        for _ in range(2):
            advance(page, REFRESH_MS)
        expect(page.get_by_text(INVOICING_OUTAGE, exact=True).first).to_be_visible()
        expect(role(dialog, "textbox", "Client email")).to_have_value(email)
        page.goto(f"{base}/w/{AS}/charters")
        advance(page, SETTLE_MS)
        h1(page, "Charters")
    assert get_hold(luka, AS, hold["id"])["status"] == "live"


def test_wf_charter_invoicing_phone(browser, app_url):
    luka = signin(app_url, LUKA)
    tag, email = fresh("col")
    ch = direct_charter(luka, AS, "sunwake", 8, "EUR", f"Col {tag}", email)
    for size in NARROW:
        with staff(browser, app_url, LUKA, f"/w/{AS}/charters/{ch['id']}", viewport=size) as (page, _):
            h1(page, f"Charter for Col {tag}")
            lines, guests = role(page, "table", "Charter lines"), role(page, "table", "Guests")
            shown(page, lines)
            shown(page, guests)
            assert box(guests)["y"] >= box(lines)["y"] + box(lines)["height"] - PX
            expect(page.get_by_text(re.compile(r"\bNot invoiced\b")).first).to_be_visible()
            layout(page)


def photo_keys(s3: S3, charter_id: str, guest_id: str) -> list[str]:
    return [k for k in s3.keys(f"passport-photos/{charter_id}/") if k.rsplit("/", 1)[1].split(".")[0] == guest_id]


def test_manifest_page_lifetime(browser):
    base = short_url()
    luka, ivo = signin(base, LUKA), signin(base, IVO)
    tag, email = fresh("mlife")
    ch = direct_charter(luka, AS, "sunwake", 8, "EUR", f"L {tag}", email)
    p1, t1 = send_manifest_page(luka, AS, ch["id"], f"L {tag}", email)
    assert p1["status"] == "live" and ok(httpx.get(f"{base}/api/manifest/{t1}", timeout=HTTP_TIMEOUT))["status"] == "live"
    span = instant(p1["endsAt"]) - instant(p1["issuedAt"])
    p2, t2 = send_manifest_page(luka, AS, ch["id"], f"L {tag}", email)
    assert err(httpx.get(f"{base}/api/manifest/{t1}", timeout=HTTP_TIMEOUT), 410) == {"error": "page_ended"}
    assert httpx.get(f"{base}/m/{t1}", timeout=HTTP_TIMEOUT).status_code == 410
    assert instant(p2["endsAt"]) - instant(p2["issuedAt"]) == span
    assert ok(luka.post(f"/api/w/{AS}/charters/{ch['id']}/manifest-page/end"))["page"]["status"] == "ended"
    assert err(httpx.get(f"{base}/api/manifest/{t2}", timeout=HTTP_TIMEOUT), 410) == {"error": "page_ended"}
    assert err(luka.post(f"/api/w/{AS}/charters/{ch['id']}/manifest-page/end"), 409) == {"error": "page_not_live"}
    p3, t3 = send_manifest_page(luka, AS, ch["id"], f"L {tag}", email)
    poll(lambda: httpx.get(f"{base}/api/manifest/{t3}", timeout=HTTP_TIMEOUT).status_code == 410, span.total_seconds() + TIMER_WAIT_S, "page timer")
    assert ok(luka.get(f"/api/w/{AS}/charters/{ch['id']}/manifest"))["page"]["status"] == "ended"
    _, t4 = send_manifest_page(luka, AS, ch["id"], f"L {tag}", email)
    ok(ivo.post(f"/api/w/{AS}/charters/{ch['id']}/close"))
    assert err(httpx.get(f"{base}/api/manifest/{t4}", timeout=HTTP_TIMEOUT), 410) == {"error": "page_ended"}
    with visitor(browser, f"{base}/m/{t1}", device_time=instant(p1["issuedAt"])) as page:
        h1(page, ENDED_HEADING)
        expect(page.get_by_text(ENDED_BODY, exact=True).first).to_be_visible()


def test_passport_photo_checks(app_url):
    luka, ivo = signin(app_url, LUKA), signin(app_url, IVO)
    tag, email = fresh("photo")
    ch = direct_charter(luka, AS, "sunwake", 8, "EUR", f"Ph {tag}", email)
    _, token = send_manifest_page(luka, AS, ch["id"], f"Ph {tag}", email)
    g1, g2, g3 = (add_guest(app_url, token, f"{n} {tag}") for n in ("One", "Two", "Three"))
    s3 = S3()
    saved = ok(upload_photo(app_url, token, g1["id"], "passport.jpg", "image/jpeg", exif_jpeg()), 201)["guest"]
    assert saved["photoOnFile"] is True
    keys = photo_keys(s3, ch["id"], g1["id"])
    assert len(keys) == 1 and keys[0] == f"passport-photos/{ch['id']}/{g1['id']}.jpg"
    stored = s3.get(keys[0])
    facts = jpeg_facts(stored)
    assert facts["size"] == (8, 16) and facts["gps"] is False and facts["orientation"] in (None, 1)
    served = ivo.get(f"/api/w/{AS}/charters/{ch['id']}/manifest/guests/{g1['id']}/photo")
    assert served.status_code == 200 and served.headers["content-type"].startswith("image/jpeg") and served.content == stored
    junk = b"not an image " * 10
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    for name, ctype, data in (("p.jpg", "image/jpeg", junk), ("p.png", "image/png", svg)):
        assert err(upload_photo(app_url, token, g2["id"], name, ctype, data), 422)["errors"]["photo"] == "Choose a JPEG or PNG photo."
    assert photo_keys(s3, ch["id"], g2["id"]) == []
    big = err(upload_photo(app_url, token, g3["id"], "big.jpg", "image/jpeg", exif_jpeg() + b"\x00" * (PHOTO_LIMIT + 1)), 413)
    assert big == {"error": "too_large", "limitBytes": PHOTO_LIMIT}
    assert photo_keys(s3, ch["id"], g3["id"]) == []
    guests = {g["id"]: g for g in ok(httpx.get(f"{app_url}/api/manifest/{token}", timeout=HTTP_TIMEOUT))["guests"]}
    assert guests[g2["id"]]["photoOnFile"] is False and guests[g3["id"]]["photoOnFile"] is False
    ok(upload_photo(app_url, token, g2["id"], "p.png", "image/png", png_image()), 201)
    assert photo_keys(s3, ch["id"], g2["id"]) == [f"passport-photos/{ch['id']}/{g2['id']}.png"]


def filled_manifest(base, luka, tag, email):
    ch = direct_charter(luka, AS, "sunwake", 8, "EUR", f"Mf {tag}", email)
    _, token = send_manifest_page(luka, AS, ch["id"], f"Mf {tag}", email)
    guest = add_guest(base, token, f"Guest {tag}")
    number = "X" + uuid.uuid4().hex.upper()[:10]
    ok(httpx.put(f"{base}/api/manifest/{token}/guests", json={"guests": [{
        "id": guest["id"], "fullName": f"Guest {tag}", "nationality": "HR", "dateOfBirth": "1984-05-12", "passportNumber": number}]}, timeout=HTTP_TIMEOUT))
    ok(upload_photo(base, token, guest["id"], "p.png", "image/png", png_image()), 201)
    return ch, token, guest, number


def test_passport_data_reach(browser, app_url, mail):
    luka = signin(app_url, LUKA)
    tag, email = fresh("reach")
    ch, token, guest, number = filled_manifest(app_url, luka, tag, email)
    url = f"/api/w/{AS}/charters/{ch['id']}/manifest"
    for who in (IVO, MIRA):
        body = signin(app_url, who).get(url).text
        assert number in body and "1984-05-12" in body and "HR" in body
        assert signin(app_url, who).get(f"{url}/guests/{guest['id']}/photo").status_code == 200
    mgr = ok(luka.get(url))
    assert all(set(g) == {"id", "fullName"} for g in mgr["guests"]) and number not in json.dumps(mgr)
    assert luka.get(f"{url}/guests/{guest['id']}/photo").status_code != 200
    for who in (ANA, NINA):
        cli = signin(app_url, who)
        assert err(cli.get(url), 403) == {"error": "forbidden"}
        assert err(cli.get(f"{url}/guests/{guest['id']}/photo"), 403) == {"error": "forbidden"}
    public = ok(httpx.get(f"{app_url}/api/manifest/{token}", timeout=HTTP_TIMEOUT))
    assert all(set(g) == {"id", "fullName", "nationality", "passportOnFile", "dateOfBirthOnFile", "photoOnFile"} for g in public["guests"])
    assert number not in json.dumps(public) and "1984-05-12" not in json.dumps(public)
    keep = ok(httpx.put(f"{app_url}/api/manifest/{token}/guests", json={"guests": [{"id": guest["id"], "fullName": f"Guest {tag}", "nationality": "HR", "dateOfBirth": "", "passportNumber": ""}]}, timeout=HTTP_TIMEOUT))
    assert number not in json.dumps(keep) and number in signin(app_url, IVO).get(url).text
    bad = err(httpx.put(f"{app_url}/api/manifest/{token}/guests", json={"guests": [{"id": guest["id"], "fullName": f"Guest {tag}", "nationality": "HR", "dateOfBirth": "2999-01-01", "passportNumber": "ab"}]}, timeout=HTTP_TIMEOUT), 422)
    assert bad["errors"]["guests.0.passportNumber"] == "Enter 5 to 20 capital letters or digits."
    assert bad["errors"]["guests.0.dateOfBirth"] == "Enter a date of birth in the past."
    for m in await_mail(mail, email):
        assert number not in text(m) and "1984-05-12" not in text(m)
    with staff(browser, app_url, IVO, f"/w/{AS}/charters/{ch['id']}") as (page, _):
        guests = role(page, "table", "Guests")
        shown(page, guests.get_by_text(number))
        expect(role(guests, "link", f"Photo of Guest {tag}")).to_be_visible()
    with staff(browser, app_url, LUKA, f"/w/{AS}/charters/{ch['id']}") as (page, _):
        guests = role(page, "table", "Guests")
        shown(page, guests.get_by_text(f"Guest {tag}"))
        expect(page.locator("body")).not_to_contain_text(number)


def test_erasure_after_close(app_url):
    base = short_url()
    luka, ivo = signin(base, LUKA), signin(base, IVO)
    tag, email = fresh("erase")
    ch, token, guest, number = filled_manifest(base, luka, tag, email)
    s3, pg = S3("-short"), Postgres("_short")
    assert photo_keys(s3, ch["id"], guest["id"]) and stored_anywhere(pg, number)
    closed = ok(ivo.post(f"/api/w/{AS}/charters/{ch['id']}/close"))["charter"]
    assert closed["status"] == "closed" and instant(closed["erasesAt"]) > instant(closed["closedAt"])
    assert err(ivo.post(f"/api/w/{AS}/charters/{ch['id']}/close"), 409) == {"error": "charter_closed"}
    assert err(luka.post(f"/api/w/{AS}/charters/{ch['id']}/manifest-page", json={"leadGuestName": "X", "leadGuestEmail": email}), 409) == {"error": "charter_closed"}
    wait = (instant(closed["erasesAt"]) - instant(closed["closedAt"])).total_seconds() + ERASE_WITHIN_S + SLACK_S
    url = f"/api/w/{AS}/charters/{ch['id']}/manifest"
    poll(lambda: number not in ivo.get(url).text and not photo_keys(s3, ch["id"], guest["id"]), wait, "passport erasure")
    body = ivo.get(url).text
    assert f"Guest {tag}" in body and "1984-05-12" not in body
    left = next(g for g in json.loads(body)["guests"] if g["id"] == guest["id"])
    assert left["fullName"] == f"Guest {tag}"
    assert not left.get("nationality") and not left.get("passportNumber") and not left.get("dateOfBirth")
    assert stored_anywhere(pg, number) == []


def test_wf_guest_manifest_happy(browser, app_url, mail):
    luka = signin(app_url, LUKA)
    tag, email = fresh("mf-ui")
    ch = direct_charter(luka, AS, "sunwake", 8, "EUR", f"Lead {tag}", email)
    before = {m.get("ID") for m in mails_to(mail, email)}
    with staff(browser, app_url, LUKA, f"/w/{AS}/charters/{ch['id']}") as (page, _):
        click(role(page, "button", "Send manifest page"))
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Send manifest page")
        trapped(page, dialog, role(dialog, "textbox", "Lead guest name"))
        fill(role(dialog, "textbox", "Lead guest name"), f"Lead {tag}")
        fill(role(dialog, "textbox", "Lead guest email"), email)
        click(role(dialog, "button", "Send manifest page"))
        says(page, f"Manifest page sent to {email}.")
        ends = ok(luka.get(f"/api/w/{AS}/charters/{ch['id']}/manifest"))["page"]["endsAt"]
        shown(page, page.get_by_text(f"Manifest page live until {time_text(ends)}"))
    m = await_mail(mail, email, before)[0]
    assert m.get("Subject") == f"Guest manifest for Sunwake, week of {day_text(ch['weekStart'])}"
    assert f"This link works until {time_text(ends)}." in text(m)
    token = re.search(r"/m/([A-Za-z0-9_\-]+)", text(m)).group(1)
    number = "X" + uuid.uuid4().hex.upper()[:10]
    name = f"Guest {tag}"
    with visitor(browser, f"{app_url}/m/{token}") as page:
        h1(page, "Guest manifest for Sunwake")
        click(role(page, "button", "Add guest"))
        advance(page, SETTLE_MS)
        sheet = role(page, "dialog", "Add guest")
        expect(role(sheet, "textbox", "Full name")).to_be_focused()
        fill(role(sheet, "textbox", "Full name"), name)
        click(role(sheet, "button", "Add guest"))
        says(page, f"{name} added.")
        group = role(page, "group", "Guest 1")
        shown(page, group)
        select(role(group, "combobox", "Nationality"), "Croatia")
        fill(role(group, "textbox", "Date of birth"), "1984-05-12")
        fill(role(group, "textbox", "Passport number"), number)
        click(role(page, "button", "Save manifest"))
        says(page, "Manifest saved.")
        page.get_by_label(f"Passport photo for {name}").set_input_files({"name": "p.png", "mimeType": "image/png", "buffer": png_image()})
        says(page, f"Passport photo saved for {name}.")
        page.reload()
        advance(page, SETTLE_MS)
        shown(page, page.get_by_text("Passport details on file"))
        shown(page, page.get_by_text("Photo on file"))
        expect(page.locator("body")).not_to_contain_text(number)
    with staff(browser, app_url, IVO, f"/w/{AS}/charters/{ch['id']}") as (page, cli):
        guests = role(page, "table", "Guests")
        shown(page, guests.get_by_text(number))
        expect(role(guests, "link", f"Photo of {name}")).to_be_visible()
        assert number in cli.get(f"/api/w/{AS}/charters/{ch['id']}/manifest").text
    assert S3().keys(f"passport-photos/{ch['id']}/")


def test_wf_guest_manifest_phone(browser, app_url):
    luka = signin(app_url, LUKA)
    tag, email = fresh("mf-ph")
    ch = direct_charter(luka, AS, "sunwake", 8, "EUR", f"Ph {tag}", email)
    _, token = send_manifest_page(luka, AS, ch["id"], f"Ph {tag}", email)
    for n in range(3):
        add_guest(app_url, token, f"G{n} {tag}")
    for size in NARROW:
        with visitor(browser, f"{app_url}/m/{token}", viewport=size) as page:
            expect(role(page, "dialog", "Add guest")).to_have_count(0)
            save = role(page, "button", "Save manifest")
            shown(page, save)
            top = box(save)["y"]
            assert top + box(save)["height"] <= size["height"] + PX
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            advance(page, SETTLE_MS)
            assert abs(box(save)["y"] - top) <= PX
            field = role(role(page, "group", "Guest 2"), "textbox", "Passport number")
            field.focus()
            advance(page, SETTLE_MS)
            assert box(field)["y"] + box(field)["height"] <= box(save)["y"] + PX
            click(role(page, "button", "Add guest"))
            advance(page, SETTLE_MS)
            expect(role(page, "dialog", "Add guest")).to_be_visible()
            layout(page)


def test_wf_guest_manifest_ended(browser, app_url):
    luka = signin(app_url, LUKA)
    tag, email = fresh("mf-end")
    ch = direct_charter(luka, AS, "sunwake", 8, "EUR", f"End {tag}", email)
    issued, token = send_manifest_page(luka, AS, ch["id"], f"End {tag}", email)
    with staff(browser, app_url, LUKA, f"/w/{AS}/charters/{ch['id']}") as (page, _):
        opener = role(page, "button", "End manifest page")
        shown(page, opener)
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "End manifest page")
        trapped(page, dialog, role(dialog, "button", "Keep page"))
        click(role(dialog, "button", "End page"))
        says(page, "Page ended.")
        shown(page, page.get_by_text("Manifest page ended"))
    assert ok(luka.get(f"/api/w/{AS}/charters/{ch['id']}/manifest"))["page"]["status"] == "ended"
    assert httpx.get(f"{app_url}/m/{token}", timeout=HTTP_TIMEOUT).status_code == 410
    with visitor(browser, f"{app_url}/m/{token}", device_time=instant(issued["issuedAt"])) as page:
        h1(page, ENDED_HEADING)
        expect(page.get_by_text(ENDED_BODY, exact=True).first).to_be_visible()


def sample_log(day: date) -> bytes:
    lines = [
        log_line(f"{day}T06:00:00Z", 80, 1200, 3.2, note="kept"),
        b"",
        log_line(f"{day}T12:00:00Z", 55, 3400, -2),
        b'{ "at" : "%sT18:00:00Z", "chargePct" : 61, "solarWh" : 800, "packKw" : 1 }' % str(day).encode(),
        log_line(f"{day}T22:30:00Z", 60, 0, 0.5),
    ]
    return b"\n".join(lines)


def energy_days(cli, slug) -> dict:
    return {x["date"]: x for x in ok(cli.get(f"/api/w/{AS}/yachts/{slug}/energy-days"))["days"]}


def test_log_kept_as_uploaded(app_url):
    ivo = signin(app_url, IVO)
    day = log_day()
    data = sample_log(day)
    name = f"log-{uuid.uuid4().hex}.jsonl"
    log = ok(post_log(ivo, AS, "sunwake", name, data), 201)["log"]
    assert log["objectKey"] == f"energy-logs/sunwake/{log['id']}.jsonl" and log["sizeBytes"] == len(data) and log["dayCount"] == 2
    s3 = S3()
    assert s3.get(log["objectKey"]) == data
    assert [k for k in s3.keys("energy-logs/sunwake/") if log["id"] in k] == [log["objectKey"]]
    days = energy_days(ivo, "sunwake")
    first = days[day.isoformat()]
    assert (first["startChargePct"], first["endChargePct"], first["lowestChargePct"]) == (80, 61, 55)
    assert Decimal(str(first["solarKwh"])) == Decimal("5.4")
    nxt = days[(day + timedelta(days=1)).isoformat()]
    assert nxt["startChargePct"] == nxt["endChargePct"] == 60
    later = log_line(f"{day}T09:00:00Z", LATER_CHARGE, 100, 1)
    ok(post_log(ivo, AS, "sunwake", f"later-{name}", later), 201)
    assert energy_days(ivo, "sunwake")[day.isoformat()]["startChargePct"] == LATER_CHARGE
    assert s3.get(log["objectKey"]) == data
    before = set(s3.keys("energy-logs/sunwake/"))
    bad = log_line(f"{day}T06:00:00Z", 80, 1, 1) + b"\n\nnot json"
    bad_line = bad.split(b"\n").index(b"not json") + 1
    assert err(post_log(ivo, AS, "sunwake", f"bad-{name}", bad), 422)["errors"]["log"] == f"Line {bad_line} isn't a valid log entry."
    assert err(post_log(ivo, AS, "sunwake", f"empty-{name}", b"\n\n"), 422)["errors"]["log"] == "The log has no entries."
    assert set(s3.keys("energy-logs/sunwake/")) == before
    assert all(l["fileName"] not in (f"bad-{name}", f"empty-{name}") for l in ok(ivo.get(f"/api/w/{AS}/yachts/sunwake/energy-logs"))["logs"])
    assert err(post_log(signin(app_url, NINA), AS, "sunwake", name, data), 403) == {"error": "forbidden"}


def test_log_upload_limits(app_url):
    ivo = signin(app_url, IVO)
    line = log_line(f"{log_day()}T06:00:00Z", 50, 0, 1)
    exact = line + b"\n" * (LOG_LIMIT - len(line))
    path = f"/api/w/{AS}/yachts/sunwake/energy-logs"
    assert ok(post_log(ivo, AS, "sunwake", "exact.jsonl", exact), 201)["log"]["sizeBytes"] == LOG_LIMIT
    over = err(post_log(ivo, AS, "sunwake", "over.jsonl", exact + b"\n"), 413)
    assert over == {"error": "too_large", "limitBytes": LOG_LIMIT}
    base, _ = multipart([("log", "env.jsonl", "application/x-ndjson", exact), ("note", None, None, b"")])
    pad = LOG_LIMIT + ENVELOPE - len(base)
    assert pad > 0
    body, ctype = multipart([("log", "env.jsonl", "application/x-ndjson", exact), ("note", None, None, b"a" * pad)])
    body = body.replace(body[:2 + len("tw") + 32], body[:2 + len("tw") + 32])
    assert len(body) == LOG_LIMIT + ENVELOPE
    assert ivo.post(path, content=body, headers={"content-type": ctype}).status_code == 201
    small = line + b"\n"
    body, ctype = multipart([("log", "s.jsonl", "application/x-ndjson", small), ("note", None, None, b"a" * (LOG_LIMIT + ENVELOPE))])
    assert err(ivo.post(path, content=body, headers={"content-type": ctype}), 413)["error"] == "too_large"
    assert err(ivo.post(path, json={"log": "x"}), 415) == {"error": "unsupported_media_type"}
    wrong = ivo.put(path, content=b"")
    assert wrong.status_code == 405 and wrong.json() == {"error": "method_not_allowed"}
    assert {"GET", "POST"} <= {m.strip() for m in wrong.headers["allow"].split(",")}
    assert err(ivo.get(f"{path}/debug"), 404) == {"error": "not_found"}


def test_storage_outage(app_url):
    base = s3_down_url()
    assert ok(httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)) == {"status": "ok"}
    ivo, luka = signin(base, IVO), signin(base, LUKA)
    for path in (f"/api/w/{AS}/yachts", f"/api/w/{AS}/passages", f"/api/w/{AS}/yachts/sunwake/stores", f"/api/w/{AS}/marinas"):
        ok(ivo.get(path))
    day = log_day()
    name = f"down-{uuid.uuid4().hex}.jsonl"
    for _ in range(2):
        assert err(post_log(ivo, AS, "sunwake", name, sample_log(day)), 503) == {"error": "storage_unavailable"}
    assert all(l["fileName"] != name for l in ok(ivo.get(f"/api/w/{AS}/yachts/sunwake/energy-logs"))["logs"])
    assert day.isoformat() not in energy_days(ivo, "sunwake")
    assert stored_anywhere(Postgres("_s3down"), name) == []
    tag, email = fresh("s3down")
    ch = direct_charter(luka, AS, "sunwake", 8, "EUR", f"S {tag}", email)
    _, token = send_manifest_page(luka, AS, ch["id"], f"S {tag}", email)
    g = add_guest(base, token, f"G {tag}")
    for _ in range(2):
        assert err(upload_photo(base, token, g["id"], "p.png", "image/png", png_image()), 503) == {"error": "storage_unavailable"}
    assert ok(httpx.get(f"{base}/api/manifest/{token}", timeout=HTTP_TIMEOUT))["guests"][0]["photoOnFile"] is False


BOOT_WAIT_S = 240
KILL_WAIT_S = 30
RELAY_CHUNK = 65536


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@contextmanager
def tcp_relay(listen_port: int, target_host: str, target_port: int):
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", listen_port))
    srv.listen(64)

    def pipe(a, b):
        try:
            while True:
                chunk = a.recv(RELAY_CHUNK)
                if not chunk:
                    break
                b.sendall(chunk)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                s.close()

    def serve():
        while True:
            try:
                client, _ = srv.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection((target_host, target_port))
            except OSError:
                client.close()
                continue
            threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
            threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()

    threading.Thread(target=serve, daemon=True).start()
    try:
        yield
    finally:
        try:
            srv.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        srv.close()


@contextmanager
def app_copy(env: dict, base: str):
    run = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(run["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)

    def tail() -> str:
        return Path(log.name).read_bytes()[-4000:].decode(errors="replace")

    def healthy():
        assert proc.poll() is None, f"app copy exited with {proc.returncode}:\n{tail()}"
        try:
            return httpx.get(f"{base}/api/health", timeout=5).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        poll(healthy, BOOT_WAIT_S, "the extra app copy to serve")
        yield tail
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=KILL_WAIT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        log.close()


def test_storage_recovers_without_restart():
    target = urlparse(os.environ["S3_ENDPOINT"])
    target_port = target.port or (443 if target.scheme == "https" else 80)
    relay_port, app_port = free_port(), free_port()
    base = f"http://127.0.0.1:{app_port}"
    env = {**os.environ,
           "S3_ENDPOINT": f"{target.scheme}://127.0.0.1:{relay_port}",
           "DATABASE_URL": os.environ["DATABASE_URL"] + "_s3down",
           "S3_BUCKET": os.environ["S3_BUCKET"] + "-s3down",
           "APP_PUBLIC_PORT": str(app_port), "APP_PUBLIC_URL": base}
    with app_copy(env, base) as tail:
        ivo, luka = signin(base, IVO), signin(base, LUKA)
        failed = f"before-{uuid.uuid4().hex}.jsonl"
        assert err(post_log(ivo, AS, "sunwake", failed, sample_log(log_day())), 503) == {"error": "storage_unavailable"}
        tag, email = fresh("recover")
        ch = direct_charter(luka, AS, "sunwake", 8, "EUR", f"R {tag}", email)
        _, token = send_manifest_page(luka, AS, ch["id"], f"R {tag}", email)
        g = add_guest(base, token, f"G {tag}")
        assert err(upload_photo(base, token, g["id"], "p.png", "image/png", png_image()), 503) == {"error": "storage_unavailable"}
        with tcp_relay(relay_port, target.hostname, target_port):
            data = sample_log(log_day())
            name = f"after-{uuid.uuid4().hex}.jsonl"
            r = post_log(ivo, AS, "sunwake", name, data)
            assert r.status_code == 201, f"{r.status_code} {r.text[:300]}\n{tail()}"
            log = r.json()["log"]
            s3 = S3("-s3down")
            assert s3.get(log["objectKey"]) == data
            logs = ok(ivo.get(f"/api/w/{AS}/yachts/sunwake/energy-logs"))["logs"]
            assert failed not in [l["fileName"] for l in logs] and name in [l["fileName"] for l in logs]
            assert set(s3.keys("energy-logs/sunwake/")) == {f"energy-logs/sunwake/{l['id']}.jsonl" for l in logs}
            assert ok(upload_photo(base, token, g["id"], "p.png", "image/png", png_image()), 201)["guest"]["photoOnFile"] is True
            assert photo_keys(s3, ch["id"], g["id"]) == [f"passport-photos/{ch['id']}/{g['id']}.png"]


def test_wf_energy_logbook_upload(browser, app_url):
    day = log_day()
    data = sample_log(day)
    name = f"ui-{uuid.uuid4().hex}.jsonl"
    with staff(browser, app_url, IVO, f"/w/{AS}/yachts/sunwake/energy") as (page, cli):
        h1(page, "Sunwake energy")
        opener = role(page, "button", "Upload daily log")
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Upload daily log")
        trapped(page, dialog, page.get_by_label("Log file"))
        closes_to(page, dialog, opener)
        click(opener)
        advance(page, SETTLE_MS)
        page.get_by_label("Log file").set_input_files({"name": name, "mimeType": "application/x-ndjson", "buffer": data})
        click(role(dialog, "button", "Upload log"))
        says(page, "Log uploaded — 2 days charted.")
        expect(role(page, "img", "Charge and solar by day")).to_be_visible()
        row = role(page, "table", "Energy by day").get_by_role("row").filter(has_text=day_text(day))
        shown(page, row)
        for value in ("80%", "61%", "55%", "5.4"):
            expect(row).to_contain_text(value)
        expect(role(page, "table", "Uploaded logs")).to_contain_text(name)
        log = next(l for l in ok(cli.get(f"/api/w/{AS}/yachts/sunwake/energy-logs"))["logs"] if l["fileName"] == name)
    assert S3().get(log["objectKey"]) == data


def test_wf_energy_logbook_layout(browser, app_url):
    with staff(browser, app_url, IVO, f"/w/{AS}/yachts/sunwake/energy") as (page, _):
        chart, days, logs = role(page, "img", "Charge and solar by day"), role(page, "table", "Energy by day"), role(page, "table", "Uploaded logs")
        shown(page, logs)
        assert box(logs)["x"] >= box(chart)["x"] + box(chart)["width"] - PX
        for size in NARROW:
            resize(page, size)
            shown(page, logs)
            assert box(chart)["y"] < box(days)["y"] < box(logs)["y"]
            layout(page)


def test_wf_energy_logbook_outage(browser):
    base = s3_down_url()
    with staff(browser, base, IVO, f"/w/{AS}/yachts/sunwake/energy") as (page, cli):
        click(role(page, "button", "Upload daily log"))
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Upload daily log")
        name = f"out-{uuid.uuid4().hex}.jsonl"
        page.get_by_label("Log file").set_input_files({"name": name, "mimeType": "application/x-ndjson", "buffer": sample_log(log_day())})
        click(role(dialog, "button", "Upload log"))
        says(page, STORAGE_OUTAGE)
        advance(page, REFRESH_MS)
        expect(page.get_by_text(STORAGE_OUTAGE, exact=True).first).to_be_visible()
        assert all(l["fileName"] != name for l in ok(cli.get(f"/api/w/{AS}/yachts/sunwake/energy-logs"))["logs"])


def new_item(cli, slug, name, unit="bottles", category="drinks") -> dict:
    return ok(cli.post(f"/api/w/{AS}/yachts/{slug}/stores", json={"name": name, "unit": unit, "category": category}), 201)["item"]


def move(cli, slug, item_id, kind, qty) -> httpx.Response:
    return cli.post(f"/api/w/{AS}/yachts/{slug}/stores/{item_id}/movements", json={"kind": kind, "quantity": qty})


def test_on_hand_counts(app_url):
    nina = signin(app_url, NINA)
    tag, _ = fresh("stock")
    item = new_item(nina, "sunwake", f"Water {tag}")
    assert (item["receivedQty"], item["onHandQty"]) == (0, 0)
    for kind, qty, hand in (("received", 10, 10), ("used", 3, 7), ("spoiled", 2, 5)):
        got = ok(move(nina, "sunwake", item["id"], kind, qty), 201)["item"]
        assert got["onHandQty"] == hand == got["receivedQty"] - got["usedQty"] - got["spoiledQty"]
    assert err(move(nina, "sunwake", item["id"], "used", 6), 409) == {"error": "insufficient_stock", "onHandQty": 5}
    gate = threading.Barrier(5)

    def go(_):
        gate.wait()
        return http_session_clone(nina, app_url).post(f"/api/w/{AS}/yachts/sunwake/stores/{item['id']}/movements", json={"kind": "used", "quantity": 2})

    with ThreadPoolExecutor(5) as pool:
        codes = sorted(r.status_code for r in pool.map(go, range(5)))
    assert codes == [201, 201, 409, 409, 409]
    final = ok(nina.get(f"/api/w/{AS}/yachts/sunwake/stores/{item['id']}"))["item"]
    assert final["onHandQty"] == 1 and final["usedQty"] == 7 and final["onHandQty"] == final["receivedQty"] - final["usedQty"] - final["spoiledQty"]
    assert err(move(nina, "sunwake", item["id"], "used", 0), 422)["errors"]["quantity"] == whole_number(*QUANTITY_RANGE)
    assert err(move(nina, "sunwake", item["id"], "lost", 1), 422)["errors"]["kind"] == "Choose one of the listed options."
    assert err(nina.post(f"/api/w/{AS}/yachts/sunwake/stores", json={"name": f"WATER {tag}", "unit": "bottles", "category": "drinks"}), 409) == {"error": "item_exists"}
    assert nina.delete(f"/api/w/{AS}/yachts/sunwake/stores/{item['id']}").status_code == 204
    assert err(nina.get(f"/api/w/{AS}/yachts/sunwake/stores/{item['id']}"), 404) == {"error": "not_found"}


def page_all(cli, slug, q, limit) -> list[str]:
    seen, cursor = [], None
    while True:
        params = {"q": q, "limit": limit, **({"cursor": cursor} if cursor else {})}
        body = ok(cli.get(f"/api/w/{AS}/yachts/{slug}/stores", params=params))
        seen += [i["id"] for i in body["items"]]
        cursor = body["nextCursor"]
        if not cursor:
            return seen


def test_stores_paging(browser, app_url):
    ivo, nina = signin(app_url, IVO), signin(app_url, NINA)
    tag, _ = fresh("page")
    prefix = f"Pg{tag}"
    items = [new_item(ivo, "sunwake", f"{prefix} {n:03d}") for n in range(PAGE_CAP + 1)]
    first = ok(ivo.get(f"/api/w/{AS}/yachts/sunwake/stores", params={"q": prefix, "limit": 1000}))
    assert len(first["items"]) == PAGE_CAP and first["nextCursor"]
    names = [i["name"] for i in first["items"]]
    assert names == sorted(names, key=str.lower)
    assert sorted(page_all(ivo, "sunwake", prefix.lower(), PAGE_CAP)) == sorted(i["id"] for i in items)
    body = ok(ivo.get(f"/api/w/{AS}/yachts/sunwake/stores", params={"q": prefix, "limit": 10}))
    seen = [i["id"] for i in body["items"]]
    ivo.delete(f"/api/w/{AS}/yachts/sunwake/stores/{seen[0]}")
    ivo.delete(f"/api/w/{AS}/yachts/sunwake/stores/{items[30]['id']}")
    new_item(ivo, "sunwake", f"{prefix} 000a")
    new_item(ivo, "sunwake", f"{prefix} 999")
    cursor = body["nextCursor"]
    while cursor:
        body = ok(ivo.get(f"/api/w/{AS}/yachts/sunwake/stores", params={"q": prefix, "limit": 10, "cursor": cursor}))
        seen += [i["id"] for i in body["items"]]
        cursor = body["nextCursor"]
    assert len(seen) == len(set(seen))
    lasting = {i["id"] for i in items} - {items[30]["id"]}
    assert lasting <= set(seen)
    assert err(ivo.get(f"/api/w/{AS}/yachts/sunwake/stores", params={"cursor": "not-a-cursor"}), 422)["errors"]["cursor"] == "This cursor isn't valid."
    assert err(nina.get(f"/api/w/{AS}/yachts/halcyon-drift/stores"), 404) == {"error": "not_found"}
    early, late = f"{prefix} 001", f"{prefix} 002"
    with staff(browser, app_url, IVO, f"/w/{AS}/yachts/sunwake/stores") as (page, _):
        held_routes = []

        def handler(route):
            q = parse_qs(urlparse(route.request.url).query).get("q", [""])[0]
            held_routes.append(route) if q == early else route.continue_()

        page.route("**/api/w/*/yachts/sunwake/stores*", handler)
        box_ = role(page, "searchbox", "Search stores")
        fill(box_, early)
        advance(page, SETTLE_MS)
        fill(box_, late)
        listing = role(page, "list", "Stores")
        shown(page, role(listing, "link", late))
        for r in held_routes:
            r.continue_()
        advance(page, SETTLE_MS)
        expect(role(listing, "link", late)).to_be_visible()
        expect(role(listing, "link", early)).to_have_count(0)


def test_wf_ships_stores_add_and_log(browser, app_url):
    tag, _ = fresh("ui-store")
    name = f"Fizz {tag}"
    with staff(browser, app_url, NINA, f"/w/{AS}/today") as (page, cli):
        h1(page, "Today")
        click(role(role(page, "list", "Your yachts"), "link", "Stores"))
        lands(page, rf"^/w/{AS}/yachts/sunwake/stores$")
        h1(page, "Sunwake stores")
        opener = role(page, "button", "Add item")
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Add item")
        trapped(page, dialog, role(dialog, "textbox", "Item name"))
        fill(role(dialog, "textbox", "Item name"), name)
        fill(role(dialog, "textbox", "Unit"), "bottles")
        select(role(dialog, "combobox", "Category"), "Drinks")
        click(role(dialog, "button", "Add item"))
        item_id = lands(page, rf"^/w/{AS}/yachts/sunwake/stores/([^/]+)$").group(1)
        h1(page, name)
        says(page, f"{name} added.")
        log = role(page, "button", "Log movement")
        sheet = role(page, "dialog", "Log movement")
        expect(sheet).to_have_count(0)
        click(log)
        advance(page, SETTLE_MS)
        trapped(page, sheet, role(sheet, "radio", "Received"))
        closes_to(page, sheet, log)
        reopens(page, sheet, log)
        fill(role(sheet, "textbox", "Quantity"), "12")
        click(role(sheet, "button", "Log movement"))
        says(page, "Logged 12 bottles received — 12 bottles on hand.")
        click(log)
        advance(page, SETTLE_MS)
        pick(role(sheet, "radio", "Used"))
        fill(role(sheet, "textbox", "Quantity"), "5")
        click(role(sheet, "button", "Log movement"))
        says(page, "Logged 5 bottles used — 7 bottles on hand.")
        page.goto(f"{app_url}/w/{AS}/yachts/sunwake/stores")
        advance(page, SETTLE_MS)
        click(role(page, "button", f"Log movement for {name}"))
        advance(page, SETTLE_MS)
        pick(role(sheet, "radio", "Spoiled"))
        fill(role(sheet, "textbox", "Quantity"), "2")
        click(role(sheet, "button", "Log movement"))
        message = "Logged 2 bottles spoiled — 5 bottles on hand."
        says(page, message)
        fill(role(page, "searchbox", "Search stores"), name)
        advance(page, SETTLE_MS)
        expect(page.get_by_text(message, exact=True).first).to_be_visible()
        expect(role(page, "list", "Stores")).to_contain_text(message.split(" — ")[1].rstrip("."))
        item = ok(cli.get(f"/api/w/{AS}/yachts/sunwake/stores/{item_id}"))["item"]
    assert (item["receivedQty"], item["usedQty"], item["spoiledQty"], item["onHandQty"]) == (12, 5, 2, 5)


def test_wf_ships_stores_insufficient(browser, app_url):
    nina = signin(app_url, NINA)
    tag, _ = fresh("short")
    item = new_item(nina, "sunwake", f"Lime {tag}", unit="kg", category="provisions")
    ok(move(nina, "sunwake", item["id"], "received", 5), 201)
    with staff(browser, app_url, NINA, f"/w/{AS}/yachts/sunwake/stores/{item['id']}") as (page, _):
        click(role(page, "button", "Log movement"))
        advance(page, SETTLE_MS)
        sheet = role(page, "dialog", "Log movement")
        pick(role(sheet, "radio", "Used"))
        fill(role(sheet, "textbox", "Quantity"), "99")
        click(role(sheet, "button", "Log movement"))
        says(page, "Only 5 kg on hand — you can't log more than that.")
        expect(sheet).to_be_visible()
        expect(role(sheet, "textbox", "Quantity")).to_have_value("99")
    assert ok(nina.get(f"/api/w/{AS}/yachts/sunwake/stores/{item['id']}"))["item"]["onHandQty"] == 5


def test_wf_ships_stores_phone(browser, app_url):
    nina = signin(app_url, NINA)
    tag, _ = fresh("ph-store")
    name = f"Soap {tag}"
    new_item(nina, "sunwake", name, category="cleaning")
    with staff(browser, app_url, NINA, f"/w/{AS}/yachts/sunwake/stores", viewport=PHONE) as (page, _):
        fill(role(page, "searchbox", "Search stores"), name)
        opener = role(page, "button", f"Log movement for {name}")
        shown(page, opener)
        layout(page)
        tappable(page)
        sheet = role(page, "dialog", "Log movement")
        expect(sheet).to_have_count(0)
        click(opener)
        advance(page, SETTLE_MS)
        trapped(page, sheet, role(sheet, "radio", "Received"))
        layout(page)


def broker_post(base, token, body) -> httpx.Response:
    return httpx.post(f"{base}/api/broker/{token}/holds", json=body, timeout=HTTP_TIMEOUT)


def test_broker_rate_limit():
    base = short_url()
    luka = signin(base, LUKA)
    _, token = issue_broker_page(luka, AS, "bluewake")
    for _ in range(BROKER_HOLDS_PER_WINDOW):
        r = httpx.post(f"{base}/api/broker/{token}/holds", content=b"{", headers={"content-type": "application/json"}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 400
    sixth = broker_post(base, token, {"yachtSlug": "sunwake", "weekStart": "2027-07-10", "clientName": "Theo", "queue": False})
    body = err(sixth, 429)
    assert body["error"] == "rate_limited" and isinstance(body["retryAfterSeconds"], int) and body["retryAfterSeconds"] >= 1
    assert sixth.headers["retry-after"] == str(body["retryAfterSeconds"])
    junk = uuid.uuid4().hex + uuid.uuid4().hex
    for _ in range(BROKER_HOLDS_PER_WINDOW):
        assert broker_post(base, junk, {}).status_code == 404
    assert err(broker_post(base, junk, {}), 429)["error"] == "rate_limited"
    _, ended = issue_broker_page(luka, AS, "cetina")
    ok(luka.post(f"/api/w/{AS}/brokers/cetina/page/end"))
    for _ in range(BROKER_HOLDS_PER_WINDOW):
        assert broker_post(base, ended, {}).status_code == 410
    assert broker_post(base, ended, {}).status_code == 429


def test_broker_page_lifetime(browser):
    base = short_url()
    luka = signin(base, LUKA)
    p1, t1 = issue_broker_page(luka, AS, "bluewake")
    assert ok(httpx.get(f"{base}/api/broker/{t1}", timeout=HTTP_TIMEOUT))["status"] == "live"
    span = instant(p1["endsAt"]) - instant(p1["issuedAt"])
    p2, t2 = issue_broker_page(luka, AS, "bluewake")
    assert err(httpx.get(f"{base}/api/broker/{t1}", timeout=HTTP_TIMEOUT), 410) == {"error": "page_ended"}
    assert httpx.get(f"{base}/b/{t1}", timeout=HTTP_TIMEOUT).status_code == 410
    assert instant(p2["endsAt"]) - instant(p2["issuedAt"]) == span
    assert ok(luka.post(f"/api/w/{AS}/brokers/bluewake/page/end"))["page"]["status"] == "ended"
    assert err(httpx.get(f"{base}/api/broker/{t2}", timeout=HTTP_TIMEOUT), 410) == {"error": "page_ended"}
    assert err(luka.post(f"/api/w/{AS}/brokers/bluewake/page/end"), 409) == {"error": "page_not_live"}
    _, t3 = issue_broker_page(luka, AS, "bluewake")
    poll(lambda: httpx.get(f"{base}/api/broker/{t3}", timeout=HTTP_TIMEOUT).status_code == 410, span.total_seconds() + TIMER_WAIT_S, "broker page timer")
    page_state = next(b for b in ok(luka.get(f"/api/w/{AS}/brokers"))["brokers"] if b["id"] == "bluewake")["page"]
    assert page_state["status"] == "ended"
    with visitor(browser, f"{base}/b/{t3}", device_time=instant(p1["issuedAt"])) as page:
        h1(page, ENDED_HEADING)
        expect(page.get_by_text(ENDED_BODY, exact=True).first).to_be_visible()


def test_broker_page_fields(browser, app_url, mail):
    luka = signin(app_url, LUKA)
    before = {m.get("ID") for m in mails_to(mail, "charters@cetina-partners.example")}
    _, blue = issue_broker_page(luka, AS, "bluewake")
    _, cet = issue_broker_page(luka, AS, "cetina")
    tag, _ = fresh("brk")
    view = ok(httpx.get(f"{app_url}/api/broker/{cet}", timeout=HTTP_TIMEOUT))
    free = [(y["slug"], w["weekStart"]) for y in view["yachts"] for w in y["weeks"] if w["status"] == "free"]
    rnd = random.SystemRandom()
    (s1, w1), (s2, w2) = rnd.sample(free, 2)
    other = ok(broker_post(app_url, blue, {"yachtSlug": s1, "weekStart": w1, "clientName": f"Blue {tag}", "queue": False}), 201)["hold"]
    mine = ok(broker_post(app_url, cet, {"yachtSlug": s2, "weekStart": w2, "clientName": f"Cet {tag}", "queue": False}), 201)["hold"]
    assert set(mine) == {"id", "yachtSlug", "weekStart", "clientName", "status", "position", "lapsesAt"}
    view = ok(httpx.get(f"{app_url}/api/broker/{cet}", timeout=HTTP_TIMEOUT))
    assert set(view) == {"broker", "company", "status", "endsAt", "yachts", "holds"}
    assert view["broker"] == {"name": "Cetina Yacht Partners"} and view["company"] == {"name": AS_NAME}
    for y in view["yachts"]:
        assert set(y) == {"slug", "name", "base", "cabins", "lengthM", "weeks"}
        assert all(set(w) == {"weekStart", "weekEnd", "status", "weeklyRateMinor", "currency"} for w in y["weeks"])
    assert all(set(h) == {"id", "yachtSlug", "weekStart", "clientName", "status", "position", "lapsesAt"} for h in view["holds"])
    names = [h["clientName"] for h in view["holds"]]
    assert f"Cet {tag}" in names and f"Blue {tag}" not in names
    raw = json.dumps(view)
    for leak in ("Commission", "Hana Ostrova", "adriatic-sunline.example", "Petra Juric", "Tomislav Rados", "bluewake-brokers.example"):
        assert leak not in raw
    assert err(httpx.post(f"{app_url}/api/broker/{cet}/holds/{other['id']}/release", timeout=HTTP_TIMEOUT), 404) == {"error": "not_found"}
    assert ok(httpx.post(f"{app_url}/api/broker/{cet}/holds/{mine['id']}/release", timeout=HTTP_TIMEOUT))["hold"]["status"] == "released"
    m = next(x for x in await_mail(mail, "charters@cetina-partners.example", before) if cet in text(x))
    assert m.get("Subject") == f"Your {AS_NAME} broker page"
    assert "This link works until " in text(m)
    for leak in ("Commission", "adriatic-sunline.example", "Hana Ostrova"):
        assert leak not in text(m)
    with visitor(browser, f"{app_url}/b/{cet}") as page:
        h1(page, "Availability for Cetina Yacht Partners")
        shown(page, role(page, "table", "Your holds"))
        body = page.locator("body")
        for leak in (f"Blue {tag}", "Commission", "adriatic-sunline.example", "Petra Juric"):
            expect(body).not_to_contain_text(leak)


def test_wf_broker_pages_issue_and_hold(browser, app_url, mail):
    address = "desk@bluewake-brokers.example"
    before = {m.get("ID") for m in mails_to(mail, address)}
    with staff(browser, app_url, LUKA, f"/w/{AS}/brokers") as (page, luka):
        h1(page, "Brokers")
        click(role(page, "button", "Issue broker page for Bluewake Brokers"))
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Issue broker page")
        expect(dialog).to_contain_text("Any earlier page for this broker ends at once.")
        trapped(page, dialog, role(dialog, "button", "Cancel"))
        click(role(dialog, "button", "Issue page"))
        says(page, f"Broker page sent to {address}.")
        ends = next(b for b in ok(luka.get(f"/api/w/{AS}/brokers"))["brokers"] if b["id"] == "bluewake")["page"]["endsAt"]
        expect(role(page, "table", "Brokers").get_by_role("row").filter(has_text="Bluewake Brokers")).to_contain_text(f"Live until {time_text(ends)}")
    m = await_mail(mail, address, before)[0]
    assert m.get("Subject") == f"Your {AS_NAME} broker page"
    token = re.search(r"/b/([A-Za-z0-9_\-]+)", text(m)).group(1)
    view = ok(httpx.get(f"{app_url}/api/broker/{token}", timeout=HTTP_TIMEOUT))
    kelp = next(y for y in view["yachts"] if y["slug"] == "kelp-lantern")
    week = random.SystemRandom().choice([w for w in kelp["weeks"] if w["status"] == "free"])
    tag, _ = fresh("bh")
    client = f"Theo {tag}"
    with visitor(browser, f"{app_url}/b/{token}") as page:
        h1(page, "Availability for Bluewake Brokers")
        opener = role(page, "button", f"Hold Kelp Lantern, week of {day_text(week['weekStart'])}")
        shown(page, opener)
        click(opener)
        advance(page, SETTLE_MS)
        sheet = role(page, "dialog", "Hold for a client")
        trapped(page, sheet, role(sheet, "textbox", "Client name"))
        closes_to(page, sheet, opener)
        click(opener)
        advance(page, SETTLE_MS)
        fill(role(sheet, "textbox", "Client name"), client)
        click(role(sheet, "button", "Place hold"))
        shown(page, role(page, "table", "Your holds").get_by_text(client))
    luka = signin(app_url, LUKA)
    hold = next(h for h in ok(luka.get(f"/api/w/{AS}/holds", params={"yachtSlug": "kelp-lantern", "weekStart": week["weekStart"]}))["holds"] if h["clientName"] == client)
    assert hold["placedBy"] == {"kind": "broker", "name": "Bluewake Brokers"} and hold["status"] == "live"
    with staff(browser, app_url, LUKA, f"/w/{AS}/holds") as (page, _):
        row = role(page, "table", "Holds").get_by_role("row").filter(has_text=client)
        shown(page, row)
        expect(row).to_contain_text("Bluewake Brokers")


def test_wf_broker_pages_layout(browser, app_url):
    _, token = issue_broker_page(signin(app_url, LUKA), AS, "cetina")
    with visitor(browser, f"{app_url}/b/{token}") as page:
        weeks = role(page, "list", "Weeks for Sunwake").get_by_role("listitem")
        shown(page, weeks)
        is_strip(weeks)
        for size in NARROW:
            resize(page, size)
            shown(page, weeks)
            is_column(weeks)
            layout(page)


def test_wf_broker_pages_ended(browser, app_url):
    luka = signin(app_url, LUKA)
    issued, token = issue_broker_page(luka, AS, "cetina")
    with staff(browser, app_url, LUKA, f"/w/{AS}/brokers") as (page, _):
        opener = role(page, "button", "End broker page for Cetina Yacht Partners")
        shown(page, opener)
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "End broker page")
        trapped(page, dialog, role(dialog, "button", "Keep page"))
        click(role(dialog, "button", "End page"))
        says(page, "Page ended.")
        expect(role(page, "table", "Brokers").get_by_role("row").filter(has_text="Cetina Yacht Partners")).to_contain_text("Ended")
    assert httpx.get(f"{app_url}/b/{token}", timeout=HTTP_TIMEOUT).status_code == 410
    with visitor(browser, f"{app_url}/b/{token}", device_time=instant(issued["issuedAt"])) as page:
        h1(page, ENDED_HEADING)
        expect(page.get_by_text(ENDED_BODY, exact=True).first).to_be_visible()

PROFILE_KEYS = ("name", "cabins", "lengthM", "beamM", "draftM", "rates")


@contextmanager
def restored(cli, ws, slug):
    original = get_yacht(cli, ws, slug)
    try:
        yield original
    finally:
        cli.patch(f"/api/w/{ws}/yachts/{slug}", json={k: original[k] for k in PROFILE_KEYS})
        if original["status"] == "on_sale" and get_yacht(cli, ws, slug)["status"] == "withdrawn":
            cli.post(f"/api/w/{ws}/yachts/{slug}/return-to-sale")


def test_metric_imperial(browser, app_url):
    eleni = signin(app_url, ELENI)
    with restored(eleni, SL, "salt-ember"):
        y = ok(eleni.patch(f"/api/w/{SL}/yachts/salt-ember", json={"beamM": 3.65}))["yacht"]
        assert y["beamM"] == 3.65
        with visitor(browser, f"{app_url}/fleet/{SL}/salt-ember") as page:
            expect(page.locator("body")).to_contain_text("3.7 m – 12 ft 0 in")
            expect(page.locator("body")).to_contain_text(figure(y["lengthM"]))
        with staff(browser, app_url, ELENI, f"/w/{SL}/yachts/salt-ember/profile") as (page, _):
            shown(page, page.get_by_text("3.7 m – 12 ft 0 in"))
    with visitor(browser, f"{app_url}/fleet/{AS}/sunwake") as page:
        expect(page.locator("body")).to_contain_text("18.3 m – 60 ft 0 in")


def test_profile_form_errors(browser, app_url):
    eleni = signin(app_url, ELENI)
    with restored(eleni, SL, "salt-ember") as original:
        bad = err(eleni.patch(f"/api/w/{SL}/yachts/salt-ember", json={"name": "", "cabins": 9, "lengthM": float(BAD_LENGTH)}), 422)["errors"]
        assert bad == {"name": "This field is required.", "cabins": "Enter a whole number from 2 to 6.", "lengthM": "Use at most two decimals."}
        with staff(browser, app_url, ELENI, f"/w/{SL}/yachts/salt-ember/profile") as (page, _):
            h1(page, "Salt Ember profile")
            fill(role(page, "textbox", "Name"), "")
            fill(role(page, "spinbutton", "Cabins"), "9")
            fill(role(page, "textbox", "Length (m)"), BAD_LENGTH)
            click(role(page, "button", "Save profile"))
            problems = role(page, "region", "Problems")
            shown(page, problems)
            expect(role(problems, "heading", "Problems")).to_be_visible()
            for label, message, field in (("Name", "This field is required.", role(page, "textbox", "Name")),
                                          ("Cabins", "Enter a whole number from 2 to 6.", role(page, "spinbutton", "Cabins")),
                                          ("Length (m)", "Use at most two decimals.", role(page, "textbox", "Length (m)"))):
                link = role(problems, "link", f"{label}: {message}")
                expect(link).to_be_visible()
                click(link)
                advance(page, STEP_MS)
                expect(field).to_be_focused()
                expect(page.get_by_text(message, exact=True).first).to_be_visible()
            expect(role(page, "spinbutton", "Cabins")).to_have_value("9")
            expect(role(page, "textbox", "Length (m)")).to_have_value(BAD_LENGTH)
        now = get_yacht(eleni, SL, "salt-ember")
        assert all(now[k] == original[k] for k in PROFILE_KEYS)


def test_wf_yacht_profiles_edit(browser, app_url):
    eleni = signin(app_url, ELENI)
    with restored(eleni, SL, "salt-ember"):
        with staff(browser, app_url, ELENI, f"/w/{SL}/yachts/salt-ember/profile") as (page, _):
            h1(page, "Salt Ember profile")
            name, withdraw = role(page, "textbox", "Name"), role(page, "button", "Withdraw yacht")
            shown(page, withdraw)
            assert box(name)["x"] + box(name)["width"] <= box(withdraw)["x"] + PX
            fill(role(page, "spinbutton", "Cabins"), "6")
            fill(role(page, "textbox", "Length (m)"), "21.4")
            fill(role(page, "textbox", "Beam (m)"), "10.45")
            fill(role(page, "textbox", "Draft (m)"), "1.7")
            fill(role(page, "textbox", "Low season weekly rate (EUR)"), LOW_TYPED)
            fill(role(page, "textbox", "High season weekly rate (EUR)"), HIGH_TYPED)
            click(role(page, "button", "Save profile"))
            says(page, "Profile saved.")
            expect(page.locator("body")).to_contain_text(figure("21.4"))
        y = get_yacht(eleni, SL, "salt-ember")
        assert (y["cabins"], y["lengthM"], y["beamM"], y["draftM"]) == (6, 21.4, 10.45, 1.7)
        assert y["rates"]["lowMinor"] == int(Decimal(LOW_TYPED) * 100)
        assert y["rates"]["highMinor"] == int(Decimal(HIGH_TYPED) * 100)


def test_wf_yacht_profiles_withdraw(browser, app_url):
    eleni = signin(app_url, ELENI)
    with restored(eleni, SL, "salt-ember"):
        with staff(browser, app_url, ELENI, f"/w/{SL}/yachts/salt-ember/profile") as (page, _):
            opener = role(page, "button", "Withdraw yacht")
            shown(page, opener)
            click(opener)
            advance(page, SETTLE_MS)
            dialog = role(page, "dialog", "Withdraw yacht")
            trapped(page, dialog, role(dialog, "button", "Cancel"))
            closes_to(page, dialog, opener)
            reopens(page, dialog, opener)
            click(role(dialog, "button", "Withdraw yacht"))
            says(page, "Salt Ember withdrawn from sale.")
            assert httpx.get(f"{app_url}/fleet/{SL}/salt-ember", timeout=HTTP_TIMEOUT).status_code == 410
            back = role(page, "button", "Put back on sale")
            shown(page, back)
            click(back)
            advance(page, SETTLE_MS)
            dialog = role(page, "dialog", "Put back on sale")
            trapped(page, dialog, role(dialog, "button", "Cancel"))
            closes_to(page, dialog, back)
            reopens(page, dialog, back)
            click(role(dialog, "button", "Put back on sale"))
            says(page, "Salt Ember is back on sale.")
        assert get_yacht(eleni, SL, "salt-ember")["status"] == "on_sale"
        assert httpx.get(f"{app_url}/fleet/{SL}/salt-ember", timeout=HTTP_TIMEOUT).status_code == 200


def test_wf_yacht_profiles_phone(browser, app_url):
    with staff(browser, app_url, ELENI, f"/w/{SL}/fleet", viewport=PHONE) as (page, _):
        h1(page, "Fleet")
        shown(page, role(page, "list", "Yachts").get_by_role("listitem").filter(has_text="Salt Ember"))
        tappable(page)
    for size in NARROW:
        with staff(browser, app_url, ELENI, f"/w/{SL}/yachts/salt-ember/profile", viewport=size) as (page, _):
            name, withdraw = role(page, "textbox", "Name"), role(page, "button", "Withdraw yacht")
            shown(page, withdraw)
            assert box(withdraw)["y"] > box(name)["y"]
            save = role(page, "button", "Save profile")
            for label in ("High season weekly rate (EUR)", "Draft (m)"):
                field = role(page, "textbox", label)
                field.focus()
                advance(page, SETTLE_MS)
                assert box(field)["y"] + box(field)["height"] <= box(save)["y"] + PX
            layout(page)


def test_wf_cross_cutting_sign_in_landing(browser, app_url):
    cookie = http(app_url).post("/api/session", json={"email": MIRA, "password": PASSWORD}).headers.get("set-cookie", "")
    flags = {part.strip().lower() for part in cookie.split(";")}
    assert {"httponly", "samesite=strict"} <= flags, cookie
    with visitor(browser, f"{app_url}/sign-in") as page:
        h1(page, "Sign in to Tidewright")
        fill(role(page, "textbox", "Email"), LUKA)
        fill(role(page, "textbox", "Password"), "Not-The-Password-9")
        click(role(page, "button", "Sign in"))
        says(page, SIGN_IN_REFUSED)
        expect(page).to_have_url(re.compile(r"/sign-in"))
    for email, home in HOMES.items():
        with visitor(browser, f"{app_url}/sign-in") as page:
            fill(role(page, "textbox", "Email"), email)
            fill(role(page, "textbox", "Password"), PASSWORD)
            click(role(page, "button", "Sign in"))
            lands(page, rf"^/w/{AS}/{home}$")
            h1(page, HOME_HEADINGS[home])


def test_wf_cross_cutting_session_ended(browser, app_url):
    original = get_yacht(signin(app_url, MIRA), AS, "kelp-lantern")
    typed = f"Kelp {uuid.uuid4().hex[:6]}"
    with staff(browser, app_url, MIRA, f"/w/{AS}/yachts/kelp-lantern/profile") as (page, cli):
        fill(role(page, "textbox", "Name"), typed)
        cookies = {c["name"]: c["value"] for c in page.context.cookies()}
        assert httpx.delete(f"{app_url}/api/session", cookies=cookies, timeout=HTTP_TIMEOUT).status_code == 204
        click(role(page, "button", "Save profile"))
        says(page, SESSION_ENDED)
        expect(role(page, "textbox", "Name")).to_have_value(typed)
        click(role(page, "link", "Sign in again"))
        lands(page, r"^/sign-in$")
        fill(role(page, "textbox", "Email"), MIRA)
        fill(role(page, "textbox", "Password"), PASSWORD)
        click(role(page, "button", "Sign in"))
        lands(page, rf"^/w/{AS}/yachts/kelp-lantern/profile$")
        shown(page, role(page, "textbox", "Name"))
        expect(role(page, "textbox", "Name")).to_have_value(typed)
    assert get_yacht(signin(app_url, MIRA), AS, "kelp-lantern")["name"] == original["name"]

    mira = signin(app_url, MIRA)
    tag, email = fresh("removed")
    member = ok(mira.post(f"/api/w/{AS}/members", json={"name": f"Temp {tag}", "email": email, "password": "Starting-Pass-01", "role": "charter_manager"}), 201)["member"]
    week = free_week(mira, AS, "sunwake")
    cli = http(app_url)
    ok(cli.post("/api/session", json={"email": email, "password": "Starting-Pass-01"}))
    with open_app(browser, f"{app_url}/sign-in") as page:
        adopt(page, cli, app_url)
        page.goto(f"{app_url}/w/{AS}/yachts/sunwake")
        advance(page, SETTLE_MS)
        opener = role(page, "button", f"Hold week of {day_text(week['weekStart'])}")
        shown(page, opener)
        click(opener)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Place hold")
        fill(role(dialog, "textbox", "Client name"), f"Kept {tag}")
        assert mira.delete(f"/api/w/{AS}/members/{member['id']}").status_code == 204
        click(role(dialog, "button", "Place hold"))
        says(page, ACCESS_REMOVED)
        expect(role(dialog, "textbox", "Client name")).to_have_value(f"Kept {tag}")

    base = fresh_url()
    timed = signin(base, ANA)
    jar = dict(timed.cookies)

    def still(path):
        return httpx.get(base + path, cookies=jar, timeout=HTTP_TIMEOUT)

    poll(lambda: still("/api/session").status_code == 401, TIMER_WAIT_S, "SESSION_SECONDS to end the session")
    assert still("/api/session").json() == {"error": "session_ended"}


def test_error_ladder(app_url):
    anon = http(app_url)
    assert err(anon.get(UNKNOWN_API), 404) == {"error": "not_found"}
    wrong = anon.put("/api/session")
    assert wrong.status_code == 405 and wrong.json() == {"error": "method_not_allowed"}
    assert {"GET", "POST", "DELETE"} <= {m.strip() for m in wrong.headers["allow"].split(",")}
    health = anon.post("/api/health")
    assert health.status_code == 405 and "GET" in health.headers["allow"]
    for path in ("/.env", "/package.json", "/package-lock.json", "/src/server.ts", f"/fleet/{AS}/no-such-yacht"):
        assert anon.get(path).status_code == 404, path
    assert err(anon.get(f"/api/w/{AS}/holds/no-such-hold"), 401) == {"error": "unauthenticated"}
    ivo = signin(app_url, IVO)
    assert err(ivo.get(f"/api/w/{SL}/members"), 404) == {"error": "not_found"}
    assert err(ivo.post(f"/api/w/{AS}/holds", content=b"{", headers={"content-type": "application/json"}), 403) == {"error": "forbidden"}
    luka = signin(app_url, LUKA)
    big = b'{"clientName":"' + b"a" * JSON_LIMIT + b'"}'
    assert err(luka.post(f"/api/w/{AS}/holds", content=big, headers={"content-type": "text/plain"}), 413) == {"error": "too_large", "limitBytes": JSON_LIMIT}
    assert err(luka.post(f"/api/w/{AS}/holds", content=b"{}", headers={"content-type": "text/plain"}), 415) == {"error": "unsupported_media_type"}
    assert err(luka.post(f"/api/w/{AS}/holds", content=b"{", headers={"content-type": "application/json; charset=utf-8"}), 400) == {"error": "invalid_json"}
    assert err(luka.post(f"/api/w/{AS}/holds", json={"yachtSlug": "no-such-yacht", "weekStart": "x", "clientName": "", "queue": False}), 404) == {"error": "not_found"}
    week = free_week(luka, AS, "sunwake")
    sunday = (as_date(week["weekStart"]) + timedelta(days=1)).isoformat()
    errors = err(place(luka, AS, "sunwake", sunday, ""), 422)["errors"]
    assert errors == {"weekStart": "Choose a Saturday after today.", "clientName": "This field is required."}
    errors = err(place(luka, AS, "sunwake", sunday, "a" * (NAME_MAX + 1)), 422)["errors"]
    assert errors["clientName"] == f"Use at most {NAME_MAX} characters."
    errors = err(place(luka, AS, "sunwake", sunday, "⛵" * NAME_MAX), 422)["errors"]
    assert set(errors) == {"weekStart"}


SEED_MEMBERS = {
    AS: {("Mira Kovac", MIRA, "fleet_director", None), ("Luka Babic", LUKA, "charter_manager", None),
         ("Ana Peric", ANA, "finance_lead", None), ("Ivo Matic", IVO, "captain", None),
         ("Nina Horvat", NINA, "crew_member", "sunwake")},
    SL: {("Eleni Papadaki", ELENI, "fleet_director", None), ("Nikos Vlachos", NIKOS, "charter_manager", None),
         ("Sofia Andreou", "sofia.andreou@saronic-lightwater.example", "finance_lead", None),
         ("Yannis Karras", "yannis.karras@saronic-lightwater.example", "captain", None),
         ("Dimitra Lekka", "dimitra.lekka@saronic-lightwater.example", "crew_member", "meltemi-glow")},
}
SEED_YACHTS = {
    "sunwake": ("Sunwake", "split", 4, 18.29, 9.04, 1.55, 280, 3.0, 9.0, 0.110, 1890000, 2450000, 3290000, ["Ivo Matic", "Nina Horvat", "Petra Juric"]),
    "halcyon-drift": ("Halcyon Drift", "split", 6, 24.40, 11.20, 1.80, 420, 4.5, 14.0, 0.160, 3150000, 3980000, 5200000, ["Tomislav Rados", "Marta Vukovic", "Dario Simic"]),
    "kelp-lantern": ("Kelp Lantern", "lavrio", 4, 16.15, 8.65, 1.35, 240, 2.5, 8.0, 0.095, 1450000, 1890000, 2490000, ["Stavros Mela", "Irini Daskalou", "Marko Lisac"]),
    "meltemi-glow": ("Meltemi Glow", "lavrio", 5, 19.65, 9.85, 1.60, 300, 3.2, 10.0, 0.120, 2100000, 2750000, 3600000, ["Yannis Karras", "Dimitra Lekka", "Thanos Ritsos"]),
    "brightwater": ("Brightwater", "split", 3, 14.95, 7.95, 1.20, 200, 2.0, 7.0, 0.080, 1245000, 1590000, 2150000, ["Josip Bilic", "Lea Grgic", "Pavlos Zervas"]),
    "salt-ember": ("Salt Ember", "split", 5, 21.35, 10.40, 1.65, 360, 4.0, 12.0, 0.140, 2600000, 3300000, 4450000, ["Kresimir Tadic", "Vesna Bozic", "Andreas Mavros"]),
}
SEED_ANCHORAGES = [
    ("split-base", "Split Marina", "split", 43.5040, 16.4290), ("solta-maslinica", "Maslinica, Solta", "split", 43.3985, 16.2060),
    ("hvar-stari-grad", "Stari Grad, Hvar", "split", 43.1855, 16.5960), ("pakleni-palmizana", "Palmizana, Pakleni Islands", "split", 43.1620, 16.3940),
    ("vis-town", "Vis Town", "split", 43.0615, 16.1855), ("brac-bol", "Bol, Brac", "split", 43.2600, 16.6550),
    ("lavrio-base", "Lavrio Marina", "lavrio", 37.7150, 24.0580), ("kea-vourkari", "Vourkari, Kea", "lavrio", 37.6670, 24.3230),
    ("kythnos-kolona", "Kolona, Kythnos", "lavrio", 37.4300, 24.3950), ("poros-town", "Poros Town", "lavrio", 37.4985, 23.4555),
    ("aegina-port", "Aegina Port", "lavrio", 37.7465, 23.4275), ("sounio-bay", "Sounio Bay", "lavrio", 37.6520, 24.0250),
]
SEED_BERTHS = {
    "split-marina": [("A1", 15.00, 8.00, 3.00), ("A2", 20.00, 10.00, 3.50), ("A3", 25.00, 12.00, 4.00), ("A4", 18.29, 9.04, 1.85), ("A5", 18.29, 9.04, 1.84), ("A6", 14.95, 7.95, 1.50)],
    "lavrio-marina": [("B1", 17.00, 9.00, 3.00), ("B2", 22.00, 11.00, 3.20), ("B3", 16.15, 8.65, 1.65), ("B4", 19.65, 9.85, 1.90)],
}
SEED_PONTOONS = {"split-marina": [("C", 44), ("D", 22)], "lavrio-marina": [("P", 22)]}
SEED_TARIFFS = {"split-marina": [("2026-01-01", 450), ("2028-04-01", 520)], "lavrio-marina": [("2026-01-01", 380), ("2028-04-01", 430)]}
SEED_STORES = [("Still water", "bottles", "drinks", 48, 12, 0, 36), ("Olive oil", "litres", "provisions", 10, 3, 0, 7),
               ("Lemons", "kg", "provisions", 8, 2, 1, 5), ("Deck cleaner", "bottles", "cleaning", 6, 1, 0, 5)]
SEED_BROKERS = {
    AS: {("bluewake", "Bluewake Brokers", "Hana Ostrova", "desk@bluewake-brokers.example", "Commission 10%, pays within 14 days"),
         ("cetina", "Cetina Yacht Partners", "Rafael Oyelaran", "charters@cetina-partners.example", "Commission 12%, prefers July weeks")},
    SL: {("aegean-keel", "Aegean Keel Agency", "Clio Varga", "hello@aegean-keel.example", "Commission 10%, Greek clients only"),
         ("northstar", "Northstar Charter Desk", "Bram Ellery", "desk@northstar-charter.example", "Commission 11%, invoices quarterly")},
}


def test_seed_state():
    base = fresh_url()
    s3 = S3("-session")
    assert s3.keys("") == []
    for ws, director, captain in ((AS, MIRA, IVO), (SL, ELENI, "yannis.karras@saronic-lightwater.example")):
        boss, cap, mgr = signin(base, director), signin(base, captain), signin(base, LUKA if ws == AS else NIKOS)
        assert {(m["name"], m["email"], m["role"], m["yachtSlug"]) for m in ok(boss.get(f"/api/w/{ws}/members"))["members"]} == SEED_MEMBERS[ws]
        yachts = ok(boss.get(f"/api/w/{ws}/yachts"))["yachts"]
        for y in yachts:
            s = SEED_YACHTS[y["slug"]]
            got = (y["name"], y["base"], y["cabins"], y["lengthM"], y["beamM"], y["draftM"], y["batteryKwh"], y["hotelKw"], y["solarKw"],
                   y["dragKwPerKnCubed"], y["rates"]["lowMinor"], y["rates"]["shoulderMinor"], y["rates"]["highMinor"], [c["name"] for c in y["crew"]])
            assert got == s and y["status"] == "on_sale" and y["shorePowerKw"] == SHORE_KW
            assert all(w["status"] == "free" for w in week_list(boss, ws, y["slug"]))
            items = ok(cap.get(f"/api/w/{ws}/yachts/{y['slug']}/stores"))["items"]
            assert sorted((i["name"], i["unit"], i["category"], i["receivedQty"], i["usedQty"], i["spoiledQty"], i["onHandQty"]) for i in items) == sorted(SEED_STORES)
            assert ok(cap.get(f"/api/w/{ws}/yachts/{y['slug']}/energy-logs"))["logs"] == []
        assert sorted(y["slug"] for y in yachts) == sorted(k for k, v in SEED_YACHTS.items() if (ws == AS) == (k in ("sunwake", "halcyon-drift", "kelp-lantern")))
        assert ok(mgr.get(f"/api/w/{ws}/holds"))["holds"] == []
        assert ok(mgr.get(f"/api/w/{ws}/charters"))["charters"] == []
        assert ok(cap.get(f"/api/w/{ws}/passages"))["passages"] == []
        brokers = ok(mgr.get(f"/api/w/{ws}/brokers"))["brokers"]
        assert {(b["id"], b["name"], b["contactName"], b["email"], b["notes"]) for b in brokers} == SEED_BROKERS[ws]
        assert all(b["page"]["status"] == "none" for b in brokers)
        assert [(a["id"], a["name"], a["base"], a["latitude"], a["longitude"]) for a in ok(cap.get(f"/api/w/{ws}/anchorages"))["anchorages"]] == SEED_ANCHORAGES
        ms = marina_map(cap, ws)
        assert set(ms) == {"split-marina", "lavrio-marina"}
        for mid, m in ms.items():
            assert [(b["code"], b["lengthM"], b["widthM"], b["depthM"]) for b in sorted(m["berths"], key=lambda b: b["code"])] == SEED_BERTHS[mid]
            assert [(p["code"], p["limitKw"]) for p in sorted(m["pontoons"], key=lambda p: p["code"])] == SEED_PONTOONS[mid]
            assert sorted((t["effectiveDate"], t["ratePerMetreMinor"]) for t in m["tariffs"]) == SEED_TARIFFS[mid]
        tables = sorted(ok(cap.get(f"/api/w/{ws}/exchange-tables"))["exchangeTables"], key=lambda t: t["effectiveDate"])
        assert [(t["effectiveDate"], Decimal(t["rates"]["GBP"]), Decimal(t["rates"]["USD"])) for t in tables] == [
            ("2026-01-01", Decimal("0.8450"), Decimal("1.0820")), ("2028-04-01", Decimal("0.8700"), Decimal("1.1500"))]
        assert rota_get(cap, ws, yachts[0]["slug"], "2027-07-03")["version"] == 0


STAFF_SCREENS = [
    ("today", "Today"), ("fleet", "Fleet"), ("yachts/sunwake", "Sunwake"), ("yachts/sunwake/profile", "Sunwake profile"),
    ("holds", "Holds"), ("charters", "Charters"), ("passages", "Passages"), ("passages/new", "New passage"),
    ("yachts/sunwake/rota?week=2027-07-03", "Sunwake rota"), ("berths", "Berths"), ("shore-power", "Shore power"),
    ("yachts/sunwake/stores", "Sunwake stores"), ("yachts/sunwake/energy", "Sunwake energy"), ("brokers", "Brokers"),
    ("tariffs", "Tariffs and exchange tables"),
]
PUBLIC_SCREENS = [("/sign-in", "Sign in to Tidewright"), (f"/fleet/{AS}", f"{AS_NAME} fleet"), (f"/fleet/{AS}/sunwake", "Sunwake"),
                  ("/no-such-page", NOT_FOUND_HEADING)]


STRIP_LISTS = ("Weeks", "Legs", "Yachts")


def strip_layout(page) -> None:
    for name in STRIP_LISTS:
        role(page, "list", name).get_by_role("button").evaluate_all("els => els.forEach(e => e.setAttribute('data-tw-strip', ''))")
    width = page.viewport_size["width"]
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if control.is_visible() and control.get_attribute("data-tw-strip") is None:
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            b = control.bounding_box()
            assert b and b["x"] >= -1 and b["x"] + b["width"] <= width + 1, control.inner_text()[:60]


def test_published_layouts(browser, app_url):
    for size in (WIDE, TABLET, PHONE):
        with visitor(browser, app_url + "/sign-in", viewport=size) as page:
            for path, heading in PUBLIC_SCREENS:
                page.goto(app_url + path)
                advance(page, SETTLE_MS)
                h1(page, heading)
                strip_layout(page)
        with staff(browser, app_url, MIRA, f"/w/{AS}/today", viewport=size) as (page, _):
            for path, heading in STAFF_SCREENS:
                page.goto(f"{app_url}/w/{AS}/{path}")
                advance(page, SETTLE_MS)
                h1(page, heading)
                strip_layout(page)
                nav, menu = role(page, "navigation", "Workspace"), role(page, "button", "Menu")
                if size is WIDE:
                    expect(nav).to_be_visible()
                    expect(menu).to_have_count(0)
                else:
                    expect(nav).to_have_count(0)
                    expect(menu).to_be_visible()


def test_dialogs_and_shortcuts(browser, app_url):
    with staff(browser, app_url, LUKA, f"/w/{AS}/holds", viewport=PHONE) as (page, _):
        opener, dialog = role(page, "button", "Menu"), role(page, "dialog", "Menu")
        expect(dialog).to_have_count(0)
        click(opener)
        advance(page, SETTLE_MS)
        trapped(page, dialog, dialog.get_by_role("link").first)
        expect(role(dialog, "link", "Holds")).to_be_visible()
        expect(role(dialog, "link", "Passages")).to_have_count(0)
        closes_to(page, dialog, opener)
        reopens(page, dialog, opener)
    with visitor(browser, f"{app_url}/fleet/{AS}") as page:
        search = role(page, "searchbox", "Search yachts")
        search.focus()
        page.keyboard.press("ArrowRight")
        advance(page, SETTLE_MS)
        at_position(page, role(page, "progressbar", "Fleet position"), 0)
        expect(search).to_be_focused()
    ivo = signin(app_url, IVO)
    tag, _ = fresh("typing")
    passage = two_leg_passage(ivo, tag)
    with staff(browser, app_url, IVO, f"/w/{AS}/passages/{passage['id']}") as (page, _):
        name = role(page, "textbox", "Passage name")
        shown(page, name)
        name.focus()
        page.keyboard.press("End")
        page.keyboard.type("]")
        advance(page, STEP_MS)
        expect(name).to_be_focused()
        expect(name).to_have_value(f"Keys {tag}]")


def test_motion_system(browser, app_url):
    with visitor(browser, f"{app_url}/fleet/{AS}") as page:
        anims = declared_running(page)
        assert {round(a["d"]) for a in anims if a["d"] >= 1} <= DURATIONS_MS, anims
        loops = [a for a in anims if a["loop"]]
        assert loops and all(round(a["d"]) == RIBBON_MS for a in loops)
    with visitor(browser, f"{app_url}/fleet/{AS}", reduced_motion="reduce") as page:
        assert [a for a in running(page) if a["loop"]] == []
        assert role(page, "heading", f"{AS_NAME} fleet").evaluate("(e) => e.getAnimations().filter(a => a.playState === 'running').length") == 0
    with staff(browser, app_url, IVO, f"/w/{AS}/yachts/sunwake/rota?week=2027-07-17") as (page, _):
        grid = role(page, "grid", "Rota")
        click(role(page, "tab", tab_text("2027-07-17")))
        advance(page, SETTLE_MS)
        cell = grid.get_by_role("gridcell").nth(3)
        before = cell.inner_text().strip()
        tap(cell)
        advance(page, STEP_MS)
        assert cell.inner_text().strip() != before


def test_accessibility(browser, app_url):
    for size in (WIDE, TABLET, PHONE):
        with visitor(browser, f"{app_url}/fleet/{AS}", viewport=size) as page:
            for path, _ in PUBLIC_SCREENS:
                page.goto(app_url + path)
                advance(page, SETTLE_MS)
                finish_motion(page)
                axe(page)
            page.goto(f"{app_url}/fleet/{AS}")
            advance(page, SETTLE_MS)
            click(role(page, "button", "Filters"))
            advance(page, SETTLE_MS)
            finish_motion(page)
            axe(page)
        with staff(browser, app_url, MIRA, f"/w/{AS}/today", viewport=size) as (page, _):
            for path, _ in STAFF_SCREENS:
                page.goto(f"{app_url}/w/{AS}/{path}")
                advance(page, SETTLE_MS)
                finish_motion(page)
                axe(page)
            for path, button in (("tariffs", "Add tariff"), ("tariffs", "Add exchange table"), ("yachts/sunwake/stores", "Add item"),
                                 ("yachts/sunwake/energy", "Upload daily log"), ("yachts/sunwake/profile", "Withdraw yacht")):
                page.goto(f"{app_url}/w/{AS}/{path}")
                advance(page, SETTLE_MS)
                click(role(page, "button", button))
                advance(page, SETTLE_MS)
                finish_motion(page)
                axe(page)
            if size is not WIDE:
                page.goto(f"{app_url}/w/{AS}/today")
                advance(page, SETTLE_MS)
                finish_motion(page)
                click(role(page, "button", "Menu"))
                advance(page, SETTLE_MS)
                finish_motion(page)
                axe(page)


APP = Path("/app")
ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}
FONTS = ("Newsreader", "Inter", "IBM Plex Mono")
HEADING = re.compile(r"^ {0,3}#{1,6}\s")
ITEM = re.compile(r"^\s*([-*+|]|\d+[.)])\s")


def font_notice(lines: list[str], font: str) -> str:
    named = re.compile(r"(?i)(?<![\w-])" + r"[\s_-]*".join(map(re.escape, font.split())) + r"(?![\w-])")
    out = []
    for i, line in enumerate(lines):
        if not named.search(line):
            continue
        out.append(line)
        if HEADING.match(line):
            for nxt in lines[i + 1:]:
                if HEADING.match(nxt):
                    break
                out.append(nxt)
            continue
        out.append(next((h for h in reversed(lines[:i]) if HEADING.match(h)), ""))
        indent = len(line) - len(line.lstrip())
        for nxt in lines[i + 1:]:
            if not nxt.strip() or HEADING.match(nxt) or (len(nxt) - len(nxt.lstrip()) <= indent and ITEM.match(nxt)):
                break
            out.append(nxt)
    return " ".join(out)


def npm_tree() -> list[tuple[str, str, str]]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=DEPLOYED_APP, capture_output=True, text=True, timeout=600)
    tree, found = json.loads(out.stdout or "{}"), {}

    def walk(deps):
        for name, info in (deps or {}).items():
            if info.get("version") and not info.get("missing"):
                lic = info.get("license")
                if lic is None and info.get("path"):
                    pkg = Path(info["path"]) / "package.json"
                    lic = json.loads(pkg.read_text()).get("license") if pkg.exists() else None
                found[(name, info["version"])] = lic["type"] if isinstance(lic, dict) else str(lic)
            walk(info.get("dependencies"))

    walk(tree.get("dependencies"))
    return [(n, v, l) for (n, v), l in found.items()]


def test_if_run_manifest():
    run = json.loads((APP / "run.json").read_text())
    assert run["_schema"] == "run-manifest-v1"
    assert all(isinstance(run[k], str) and run[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [n for n, _, _ in npm_tree() if n not in notices]
    assert missing == [], missing
    assert all(f in notices for f in FONTS)


def test_if_licences():
    def allowed(expr: str) -> bool:
        return any(part.strip("() ") in ALLOWED for part in re.split(r"\s+OR\s+", expr or ""))

    bad = [(n, v, l) for n, v, l in npm_tree() if not allowed(l)]
    assert bad == [], bad
    lines = (APP / "THIRD_PARTY_NOTICES.md").read_text().splitlines()
    for font in FONTS:
        near = font_notice(lines, font)
        assert any(re.search(rf"(?<![\w.-]){re.escape(x)}(?![\w-])", near) for x in ALLOWED) or re.search(
            r"(?i)\bopen font licen[cs]e\b|\bOFL\b", near), font


def test_if_no_other_datastore():
    found = []
    for p in APP.rglob("*"):
        if "node_modules" in p.parts or ".git" in p.parts or not p.is_file():
            continue
        if p.suffix in (".sqlite", ".sqlite3", ".db") or p.open("rb").read(16) == b"SQLite format 3\x00":
            found.append(str(p))
    assert found == []


def test_if_lockfile():
    install = json.loads((APP / "run.json").read_text())["install"]
    locks = [APP / n for n in ("package-lock.json", "pnpm-lock.yaml", "yarn.lock") if (APP / n).exists()]
    assert locks, "no lockfile at /app"
    lock = locks[0]
    assert lock.stat().st_size > 0
    if lock.name == "package-lock.json":
        json.loads(lock.read_text())
        assert "npm ci" in install
    else:
        assert lock.name.split("-")[0].split(".")[0] in install


def test_if_same_origin(browser, app_url):
    seen = []
    with visitor(browser, f"{app_url}/fleet/{AS}") as page:
        page.on("request", lambda r: seen.append(r.url))
        for path in (f"/fleet/{AS}", f"/fleet/{AS}/sunwake", "/sign-in"):
            page.goto(app_url + path)
            advance(page, SETTLE_MS)
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert foreign == []


def test_if_no_credentials_in_source():
    secrets = []
    for name in ("DATABASE_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET"):
        v = os.environ.get(name, "")
        if len(v) >= 8 and not v.isalpha():
            secrets.append(v)
    hits = []
    for p in APP.rglob("*"):
        if any(x in p.parts for x in ("node_modules", ".git")) or not p.is_file() or p.stat().st_size > 2000000:
            continue
        body = p.read_text(errors="ignore")
        hits += [str(p) for s in secrets if s in body]
    assert hits == []


def test_if_no_debug_routes(app_url):
    for path in ("/api/test", "/api/debug", "/api/seed", "/api/reset", f"/api/w/{AS}/reset", "/api/__test__/reset"):
        for verb in ("get", "post"):
            assert getattr(httpx, verb)(app_url + path, timeout=HTTP_TIMEOUT).status_code == 404, path
