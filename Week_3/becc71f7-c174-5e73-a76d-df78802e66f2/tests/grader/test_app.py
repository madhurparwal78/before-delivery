from __future__ import annotations

import base64
import csv
import io
import json
import os
import re
import struct
import threading
import unicodedata
import uuid
import xml.etree.ElementTree as ET
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from time import monotonic
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    Postgres,
    S3,
    addresses,
    advance,
    axe as conftest_axe,
    click,
    fill,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    select,
    shipped_packages,
    tab_order,
    tap,
    text,
    unique,
)


BRUSSELS = ZoneInfo("Europe/Brussels")
OWNER = ("margaux@atelier-ourlet.example", "ourlet-owner-2027")
NOOR = ("noor@atelier-ourlet.example", "ourlet-noor-2027")
JULES = ("jules@atelier-ourlet.example", "ourlet-jules-2027")
INES = ("ines@atelier-ourlet.example", "ourlet-ines-2027")
HOME_ROUTES = {"owner": "/staff/consignors", "assistant": "/staff/pieces", "bookkeeper": "/staff/sales-book"}
SHOP_ADDRESS = "Rue de l'Ourlet 12, 1000 Brussels"
SHOP_NAME = "Atelier Ourlet SRL"
SHOP_IBAN = "BE68539007547034"
VALID_IBAN = "BE68 5390 0754 7034"
INVALID_IBAN = "BE68 5390 0754 7035"
OTHER_VALID_IBANS = ["BE35 3101 2345 6737", "BE94 7350 0123 4514", "BE21 0012 3456 7803"]
TAG_RE = re.compile(r"^HG-\d{7}-\d$")
INSTANT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
REFRESH_MS = 5000
SEARCH_PAUSE_MS = 300
HOLD_SECONDS = 7200
SHORT_SECONDS = 20
SHORT_WINDOW_SECONDS = 30
PHOTO_FILE_LIMIT = 5_000_000
PHOTO_BODY_LIMIT = 6_000_000
JSON_LIMIT = 65_536
SHEET_LIMIT = 2_000_000
MAX_PHOTOS = 6
LONGEST_SIDE = 1600
SHARE_THRESHOLD_CENTS = 30_000
CHOICE_DAYS = 14
REFUND_DAYS = 14
SOLD_PAGE_DAYS = 30
RAIL_BACK_DAYS = 85
SHELF_DAYS = 14
SLOT_MINUTES = 20
SLOT_RANGE_DAYS = 224
FIRST_SLOT = (10, 0)
LAST_SLOT = (17, 40)
DOWNLOADS_PER_WINDOW = 5
MOTION_DURATIONS = {160, 320, 640}
TAG_SWING_MS = 640
PRICE_SLIDE_MS = 320
REDUCED_GONE_MS = 100
PAUSE_LEAD_SECONDS = 0.25
PAUSE_TRIES = 3
MIDNIGHT_MARGIN_MINUTES = 5
FRAME_MS = 16
TOUCH_MIN = 44
SIZES = {"375x812": (375, 812), "768x1024": (768, 1024), "1024x768": (1024, 768), "1280x800": (1280, 800)}
AXE_SIZES = ("375x812", "1280x800")
PAIN_NS = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"
IMPORT_HEADER = "item_no,consignor_name,consignor_email,consignor_phone,consignor_iban,category,brand,description,size,condition,asking_price,intake_date"
BOOK_HEADER = '"Sale date","Tag code","Description","Sale price","Consignor share","Commission","VAT"'
HELD_BACK_REASON = "No valid IBAN on file — held back until the next run."
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

HTTP_TIMEOUT = 30
WAIT_SECONDS = 45
POLL_SECONDS = 0.25
UI_TIMEOUT_MS = 15_000
SETTLE_MS = 700
TAB_PRESSES = 40
MAIL_SETTLE = 1.5
APP = Path("/app")
UNKNOWN_API = "/api/no-such-"
UNKNOWN_SCREEN = "/no-such-screen-"
PNG_TYPE = "image/png"
JPEG_TYPE = "image/jpeg"
PLAIN_TYPE = "text/plain"
JPEG_APP1 = 0xE1
JPEG_COM = 0xFE
PREVIEW_COPY = "Preview ready: <n> matched, <n> new, <n> refused, <n> already brought over."
SAVED_COPY = "Saved: <n> pieces and <n> new consignors brought over."

expect.set_options(timeout=UI_TIMEOUT_MS)

_pause = threading.Event()


def tok() -> str:
    return uuid.uuid4().hex[:10]


def fresh(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    if "@" in first:
        return second, first
    return first, second


def poll(check: Callable[[], Any], what: str, seconds: float = WAIT_SECONDS) -> Any:
    deadline = monotonic() + seconds
    while True:
        value = check()
        if value:
            return value
        assert monotonic() < deadline, f"timed out waiting for {what}"
        _pause.wait(POLL_SECONDS)


def outage_url(name: str) -> str:
    url = os.environ.get(name)
    assert url, f"{name} is not set"
    return url.rstrip("/")


def client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_TIMEOUT)


def sign_in(base: str, who: tuple[str, str]) -> httpx.Client:
    c = client(base)
    r = c.post("/api/session", json={"email": who[0], "password": who[1]})
    assert r.status_code == 200, r.text
    return c


def server_now(base: str) -> datetime:
    r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    return parsedate_to_datetime(r.headers["date"]).astimezone(timezone.utc)


def today(base: str) -> date:
    return server_now(base).astimezone(BRUSSELS).date()


def z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_z(value: str) -> datetime:
    assert INSTANT_RE.match(value), value
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def local(value: str) -> datetime:
    return parse_z(value).astimezone(BRUSSELS)


def midnight(d: date) -> str:
    return z(datetime(d.year, d.month, d.day, tzinfo=BRUSSELS))


def brussels_at(d: date, hour: int, minute: int) -> str:
    return z(datetime(d.year, d.month, d.day, hour, minute, tzinfo=BRUSSELS))


def money(cents: int) -> str:
    return f"€{cents // 100:,}.{cents % 100:02d}"


def fill_n(template: str, *counts: int) -> str:
    for n in counts:
        template = template.replace("<n>", str(n), 1)
    return template


def euros(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def date_re(d: date) -> str:
    return rf"{WEEKDAYS[d.weekday()]} 0?{d.day} {MONTH_ABBR[d.month - 1]} {d.year}"


def time_re(dt: datetime) -> str:
    return rf"0?{dt.hour}:{dt.minute:02d}"


def datetime_re(instant: str) -> str:
    dt = local(instant)
    return date_re(dt.date()) + ", " + time_re(dt)


def month_label(month: str) -> str:
    year, mm = month.split("-")
    return f"{MONTH_NAMES[int(mm) - 1]} {year}"


def month_of(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def months_back(d: date, k: int) -> str:
    index = d.year * 12 + d.month - 1 - k
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def half_up_markdown(asking: int, percent: int) -> int:
    return (asking * (100 - percent) * 2 + 100) // 200


def split(price: int) -> tuple[int, int, int]:
    percent = 60 if price <= SHARE_THRESHOLD_CENTS else 70
    share = (price * percent * 2 + 100) // 200
    commission = price - share
    vat = (commission * 21 * 2 + 121) // 242
    return share, commission, vat


def luhn_digit(seven: str) -> int:
    total = 0
    for i, ch in enumerate(reversed(seven)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - total % 10) % 10


def assert_tag(code: str) -> None:
    assert TAG_RE.match(code), code
    assert luhn_digit(code[3:10]) == int(code[-1]), code


SEPA_MAP = {"Ł": "L", "ł": "l", "Ø": "O", "ø": "o", "Æ": "AE", "æ": "ae", "ß": "ss", "Œ": "OE", "œ": "oe", "Đ": "D", "đ": "d", "Þ": "TH", "þ": "th"}
SEPA_KEEP = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-?:().,'+ ")


def sepa_name(name: str) -> str:
    name = "".join(SEPA_MAP.get(c, c) for c in name)
    name = "".join(c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c))
    name = "".join(c if c in SEPA_KEEP else " " for c in name)
    return re.sub(" +", " ", name).strip()[:70]


def walk(obj: Any) -> Iterator[tuple[str | None, Any]]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k, v
            yield from walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield None, v
            yield from walk(v)


def assert_instants(obj: Any) -> None:
    for _, v in walk(obj):
        if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}T", v):
            assert INSTANT_RE.match(v), f"instant not whole-second Z: {v}"


def assert_camel(obj: Any) -> None:
    for k, _ in walk(obj):
        if k is not None:
            assert re.match(r"^[a-z][a-zA-Z0-9]*$", k), f"key not camelCase: {k}"


def assert_error(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, (r.status_code, r.text[:500])
    assert r.headers.get("content-type", "").startswith("application/json"), r.headers.get("content-type")
    body = r.json()
    assert set(body) == {"error"}, body
    err = body["error"]
    assert err["code"] == code, err
    assert isinstance(err["message"], str)
    if status == 422:
        assert isinstance(err.get("fields"), dict) and err["fields"], err
    else:
        assert "fields" not in err, err
    return err


def new_consignor(desk: httpx.Client, *, name: str | None = None, iban: str | None = VALID_IBAN, phone: str | None = None) -> dict:
    _, email = fresh("consignor")
    body: dict[str, Any] = {"name": name or f"Consignor {tok()}", "email": email}
    if iban is not None:
        body["iban"] = iban
    if phone is not None:
        body["phone"] = phone
    r = desk.post("/api/consignors", json=body)
    assert r.status_code == 201, r.text
    return r.json()["consignor"]


def new_piece(desk: httpx.Client, consignor_id: str, *, intake: date, asking: int = 4990, brand: str | None = None,
              description: str | None = None, category: str = "coats", size: str = "m", condition: str = "very_good") -> dict:
    body = {
        "consignorId": consignor_id, "category": category, "brand": brand or f"Maison {tok()}",
        "description": description or f"Wool wrap coat {tok()}", "size": size, "condition": condition,
        "askingPriceCents": asking, "intakeDate": intake.isoformat(),
    }
    r = desk.post("/api/pieces", json=body)
    assert r.status_code == 201, r.text
    return r.json()["piece"]


def sell(desk: httpx.Client, piece_id: str, payment: str = "card", sold_at: str | None = None) -> dict:
    body: dict[str, Any] = {"pieceId": piece_id, "payment": payment}
    if sold_at:
        body["soldAt"] = sold_at
    r = desk.post("/api/sales", json=body)
    assert r.status_code == 201, r.text
    return r.json()["sale"]


def public_hold(base: str, piece_id: str, name: str, email: str) -> httpx.Response:
    return client(base).post(f"/api/pieces/{piece_id}/holds", json={"name": name, "email": email})


def ladders(owner: httpx.Client) -> list[dict]:
    r = owner.get("/api/ladders")
    assert r.status_code == 200, r.text
    return r.json()["ladders"]


def ladder_on(all_ladders: list[dict], d: date) -> dict:
    eligible = [lad for lad in all_ladders if date.fromisoformat(lad["effectiveOn"]) <= d]
    return max(eligible, key=lambda lad: lad["effectiveOn"])


def ladder_by_id(all_ladders: list[dict], ladder_id: str) -> dict:
    return next(lad for lad in all_ladders if lad["id"] == ladder_id)


def price_on_day(ladder: dict, asking: int, n: int) -> int:
    if n < ladder["firstMarkdownDay"]:
        return asking
    if n < ladder["secondMarkdownDay"]:
        return half_up_markdown(asking, ladder["firstMarkdownPercent"])
    return half_up_markdown(asking, ladder["secondMarkdownPercent"])


def station_ats(ladder: dict, intake: date) -> list[str]:
    return [midnight(intake)] + [midnight(intake + timedelta(days=ladder[k])) for k in ("firstMarkdownDay", "secondMarkdownDay", "periodEndDay")]


def station_labels(ladder: dict) -> list[str]:
    return ["Full price", f"{ladder['firstMarkdownPercent']}% off", f"{ladder['secondMarkdownPercent']}% off", "Period ends"]


def current_index(ladder: dict, n: int) -> int:
    days = [0, ladder["firstMarkdownDay"], ladder["secondMarkdownDay"], ladder["periodEndDay"]]
    return max(i for i, d in enumerate(days) if n >= d)


def new_member(owner: httpx.Client, role: str) -> tuple[str, str, str]:
    label, email = fresh("member")
    password = f"start-{tok()}"
    r = owner.post("/api/members", json={"name": f"Member {tok()}", "email": email, "password": password, "role": role})
    assert r.status_code == 201, r.text
    return email, password, r.json()["member"]["id"]


def mails_to(mail: Any, address: str, count: int = 1, seconds: float = WAIT_SECONDS) -> list[dict]:
    def found() -> list[dict]:
        return [m for m in mail.messages(expected=0, settle=0.5) if address.lower() in [a.lower() for a in addresses(m.get("To"))]]

    deadline = monotonic() + seconds
    while True:
        hits = found()
        if len(hits) >= count or monotonic() > deadline:
            break
    extra = [m for m in mail.messages(expected=0, settle=MAIL_SETTLE) if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
    return extra


def no_mail_to(mail: Any, address: str) -> None:
    hits = [m for m in mail.messages(expected=0, settle=MAIL_SETTLE) if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
    assert hits == [], f"unexpected mail to {address}"


def link_path(message: dict, prefix: str) -> str:
    found = re.search(re.escape(prefix) + r"[A-Za-z0-9_\-.~%]+", text(message))
    assert found, f"no {prefix} address in mail"
    return found.group(0)


def portal_token(desk: httpx.Client, mail: Any, consignor: dict, count: int = 1) -> str:
    r = desk.post(f"/api/consignors/{consignor['id']}/portal-link")
    assert r.status_code == 201, r.text
    msgs = mails_to(mail, consignor["email"], count)
    assert len(msgs) >= count
    tokens = [link_path(m, "/c/").rsplit("/", 1)[1] for m in msgs]
    base = str(desk.base_url).rstrip("/")
    live = [token for token in tokens if httpx.get(f"{base}/api/portal/{token}", timeout=HTTP_TIMEOUT).status_code == 200]
    return (live or tokens)[0]


def fresh_iban() -> str:
    account = int(tok(), 16) % 10**10
    bban = f"{account:010d}{account % 97 or 97:02d}"
    return f"BE{98 - int(bban + '111400') % 97:02d}{bban}"


def png(width: int = 4, height: int = 4, total: int | None = None) -> bytes:
    raw = b"".join(b"\x00" + b"".join(bytes([(x * 37) % 256, (y * 53) % 256, 120]) for x in range(width)) for y in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    head = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw))
    tail = chunk(b"IEND", b"")
    if total is None:
        return head + tail
    pad = total - len(head) - len(tail) - 12
    assert pad >= 0
    return head + chunk(b"prVt", b"\x00" * pad) + tail


GIF_1PX = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"


def upload_photo(desk: httpx.Client, piece_id: str, data: bytes, name: str = "photo.png", kind: str = PNG_TYPE) -> httpx.Response:
    return desk.post(f"/api/pieces/{piece_id}/photos", files={"photo": (name, data, kind)})


def jpeg_segments(data: bytes) -> list[tuple[int, bytes]]:
    assert data[:2] == b"\xff\xd8", "not a JPEG"
    out, i = [], 2
    while i < len(data):
        assert data[i] == 0xFF
        marker = data[i + 1]
        if marker == 0xDA:
            out.append((marker, b""))
            break
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        out.append((marker, data[i + 4:i + 2 + length]))
        i += 2 + length
    return out


def jpeg_size(data: bytes) -> tuple[int, int]:
    for marker, payload in jpeg_segments(data):
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            height, width = struct.unpack(">HH", payload[1:5])
            return width, height
    raise AssertionError("no frame header")


def payout_months(d: date) -> list[str]:
    reach = month_of(d - timedelta(days=RAIL_BACK_DAYS))
    return [m for m in (months_back(d, k) for k in range(1, 4)) if m >= reach]


def payout_stage(app_url: str, count: int = 1, quiet: bool = False) -> tuple[str, httpx.Client, httpx.Client, list[str], Any]:
    for base, suffix in ((app_url.rstrip("/"), ""), (outage_url("APP_SPARE_URL"), "-spare"), (outage_url("APP_SHORT_URL"), "-short")):
        owner = sign_in(base, OWNER)
        runs = {run["month"] for run in owner.get("/api/payout-runs").json()["runs"]}
        free = [m for m in payout_months(today(base)) if m not in runs]
        if quiet:
            free = [m for m in reversed(free) if not owner.get("/api/sales", params={"month": m}).json()["lines"]]
        if len(free) >= count:
            return base, owner, sign_in(base, NOOR), free[:count], S3(suffix)
    raise AssertionError(f"no copy has {count} ended months without a run left")


def sale_in_month(desk: httpx.Client, consignor_id: str, month: str, asking: int = 4990, **piece: Any) -> tuple[dict, dict]:
    year, mm = map(int, month.split("-"))
    intake = max(date(year, mm, 2), today(str(desk.base_url)) - timedelta(days=RAIL_BACK_DAYS))
    assert month_of(intake) == month, f"a piece on the rail cannot have a sale in {month}"
    p = new_piece(desk, consignor_id, intake=intake, asking=asking, **piece)
    s = sell(desk, p["id"], sold_at=brussels_at(intake, 12, 0))
    return p, s


def first_monday(base: str) -> date:
    r = client(base).get("/api/appointment-slots")
    assert r.status_code == 200, r.text
    return date.fromisoformat(r.json()["weekStart"])


def week_slots(base: str, week: date) -> list[dict]:
    r = client(base).get("/api/appointment-slots", params={"week": week.isoformat()})
    assert r.status_code == 200, r.text
    return r.json()["slots"]


def slot_pair(base: str, offsets: range) -> tuple[date, dict, dict]:
    monday = first_monday(base)
    for k in offsets:
        week = monday + timedelta(days=7 * k)
        slots = week_slots(base, week)
        for a, b in zip(slots, slots[1:]):
            if a["free"] and b["free"] and b["startsAt"] == a["endsAt"]:
                return week, a, b
    raise AssertionError("no pair of free slots in this test's weeks")


def book(base: str, starts_at: str, email: str, name: str = "Amélie Kint") -> httpx.Response:
    return client(base).post("/api/appointments", json={"startsAt": starts_at, "name": name, "email": email})


def import_row(item: str, name: str, email: str, brand: str, *, iban: str = "", intake: date, description: str = "Wool wrap coat",
               category: str = "Coats", size: str = "M", condition: str = "Very good", price: str = "49.90") -> list[str]:
    return [item, name, email, "", iban, category, brand, description, size, condition, price, intake.isoformat()]


def sheet(rows: list[list[str]]) -> bytes:
    out = io.StringIO()
    out.write(IMPORT_HEADER + "\r\n")
    writer = csv.writer(out, lineterminator="\r\n")
    for row in rows:
        writer.writerow(row)
    return out.getvalue().encode()


def database_mentions(pg: Postgres, needle: str) -> list[str]:
    hits = []
    for table in pg.tables():
        name = ".".join('"' + part.replace('"', '""') + '"' for part in table.split("."))
        rows = pg.rows(f"SELECT count(*) AS n FROM {name} AS t WHERE t::text ILIKE '%{needle}%'")
        if rows and int(rows[0]["n"]) > 0:
            hits.append(table)
    return hits


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
  const inOverlay = (target, property) => {
    if (!target || !target.closest || /color|shadow|outline/.test(property || '')) return false;
    return !!(target.closest('[role=dialog], dialog, [popover], [role=menu]') ||
      (target.closest('nav, [role=navigation]') && !target.closest('a, button, summary')));
  };
  const note = (target, duration, loops, property) => log.push({
    inTag: !!(target && target.closest && target.closest('[data-tag]')),
    onDialog: !!(target && target.matches && target.matches('[role=dialog], dialog')),
    inOverlay: inOverlay(target, property),
    duration: Math.round((Number(duration) || 0) * 1000) / 1000,
    loops: !!loops,
  });
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const anim = original.apply(this, args);
    let timing = {};
    try { timing = anim.effect.getTiming(); } catch (e) {}
    note(this, timing.duration, timing.iterations === Infinity);
    return anim;
  };
  document.addEventListener('transitionrun', (event) => {
    note(event.target, declared(event.target, event.pseudoElement, 'transition', event.propertyName), false, event.propertyName);
  }, true);
  document.addEventListener('animationstart', (event) => {
    let loops = false;
    try {
      const s = getComputedStyle(event.target, event.pseudoElement || null);
      const names = s.animationName.split(',').map((x) => x.trim());
      const counts = s.animationIterationCount.split(',').map((x) => x.trim());
      const i = Math.max(0, names.lastIndexOf(event.animationName));
      loops = counts[i % counts.length] === 'infinite';
    } catch (e) {}
    note(event.target, declared(event.target, event.pseudoElement, 'animation', event.animationName), loops);
  }, true);
})();
"""

UNCOVERED_JS = """() => {
  const focused = document.activeElement;
  if (!focused || focused === document.body) return 'nothing focused';
  let el = focused;
  let box = el.getBoundingClientRect();
  if ((box.width < 2 || box.height < 2) && el.labels && el.labels.length) { el = el.labels[0]; box = el.getBoundingClientRect(); }
  if (box.top < 0 || box.bottom > innerHeight) return 'outside the viewport';
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  if (!hit) return 'nothing at its centre';
  const labels = focused.labels ? [...focused.labels] : [];
  if (el.contains(hit) || hit.contains(focused) || labels.some((l) => l.contains(hit))) return '';
  return 'covered by ' + hit.tagName;
}"""


@contextmanager
def browse(browser: Browser, url: str, size: tuple[int, int] = SIZES["1280x800"], **options: Any) -> Iterator[Page]:
    with open_app(browser, url, **options) as page:
        page.clock.resume()
        page.set_viewport_size({"width": size[0], "height": size[1]})
        yield page


def pause_clock(page: Page) -> None:
    for attempt in range(PAUSE_TRIES):
        try:
            page.clock.pause_at(page.evaluate("Date.now()") / 1000 + PAUSE_LEAD_SECONDS)
            return
        except PlaywrightError:
            if attempt == PAUSE_TRIES - 1:
                raise


@contextmanager
def no_refresh(page: Page) -> Iterator[None]:
    pause_clock(page)
    try:
        yield
    finally:
        page.clock.resume()


def axe(page: Page) -> None:
    conftest_axe(ScriptsByEvaluate(page))


class ScriptsByEvaluate:

    def __init__(self, page: Page) -> None:
        self.page = page

    def add_script_tag(self, path: str) -> None:
        self.page.evaluate(Path(path).read_text())

    def __getattr__(self, name: str) -> Any:
        return getattr(self.page, name)


def path_re(base: str, pattern: str) -> re.Pattern:
    return re.compile("^" + re.escape(base.rstrip("/")) + pattern + r"(?:\?.*)?$")


def ui_sign_in(page: Page, base: str, who: tuple[str, str]) -> None:
    page.goto(base.rstrip("/") + "/sign-in")
    page.get_by_role("textbox", name="Email").fill(who[0])
    page.get_by_label("Password", exact=True).fill(who[1])
    click(page.get_by_role("button", name="Sign in"))


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements")


def exact(copy: str) -> re.Pattern:
    return re.compile("^" + copy + "$")


def card(page: Page, description: str) -> Locator:
    return page.get_by_role("list", name="Pieces").get_by_role("listitem").filter(
        has=page.get_by_role("link", name=description, exact=True))


def card_behind_modal(page: Page, description: str) -> Locator:
    return page.get_by_role("list", name="Pieces", include_hidden=True).get_by_role("listitem", include_hidden=True).filter(
        has=page.get_by_role("link", name=description, exact=True, include_hidden=True))


def type_into(page: Page, locator: Locator, value: str) -> None:
    locator.focus()
    page.keyboard.type(value)


def tab_to(page: Page, target: Locator, presses: int = TAB_PRESSES) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        if target.evaluate("e => e === document.activeElement"):
            return
    raise AssertionError("Tab never reached the control")


def assert_focus_trapped(page: Page, dialog: Locator, presses: int = 12) -> None:
    for key in ("Tab", "Shift+Tab"):
        for _ in range(presses):
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the dialog"


def assert_closed(page: Page, locator: Locator, names: list[str]) -> None:
    for i in range(locator.count()):
        assert not locator.nth(i).is_visible(), "a closed sheet or menu is still visible"
    walked = tab_order(page, TAB_PRESSES)
    for name in names:
        assert name not in walked, f"{name} is focusable while closed"


def assert_closes(page: Page, locator: Locator, names: list[str]) -> None:
    eventually(page, lambda: not any(locator.nth(i).is_visible() for i in range(locator.count())), "the closed sheet to leave the screen")
    assert_closed(page, locator, names)


def assert_uncovered(page: Page) -> None:
    problem = page.evaluate(UNCOVERED_JS)
    assert problem == "", f"focused control: {problem}"


def assert_bottom_bar(page: Page, locator: Locator) -> None:
    box = locator.bounding_box()
    assert box, "main action has no box"
    assert box["width"] >= TOUCH_MIN and box["height"] >= TOUCH_MIN, box
    height = page.viewport_size["height"]
    assert box["y"] >= height / 2 and box["y"] + box["height"] <= height, box
    page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
    after = locator.bounding_box()
    page.evaluate("() => window.scrollTo(0, 0)")
    assert after and after["y"] == box["y"], "main action is not fixed to the bottom"


def assert_in_viewport(page: Page, locator: Locator) -> None:
    box = locator.bounding_box()
    vw, vh = page.viewport_size["width"], page.viewport_size["height"]
    assert box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= vw and box["y"] + box["height"] <= vh, box


def stations_toolbar(page: Page) -> Locator:
    return page.get_by_role("toolbar", name="Markdown stations")


def assert_stations_match(page: Page, stations: list[dict]) -> None:
    buttons = stations_toolbar(page).get_by_role("button")
    expect(buttons).to_have_count(4)
    for i, st in enumerate(stations):
        expect(buttons.nth(i)).to_have_attribute("data-station", st["station"])
        expect(buttons.nth(i)).to_have_attribute("data-state", st["state"])
        expect(buttons.nth(i)).to_have_attribute("data-at", st["at"])
        expect(buttons.nth(i)).to_have_accessible_name(re.compile("^" + re.escape(st["label"]) + ", " + date_re(local(st["at"]).date()) + "$"))


@contextmanager
def reads_working(page: Page, scope: Any, url_glob: str, only: str | None = None) -> Iterator[None]:
    waiting: list = []

    def hold(route: Any) -> None:
        if only and route.request.method != only:
            route.fallback()
        else:
            waiting.append(route)

    page.route(url_glob, hold)
    try:
        yield
        expect(scope.get_by_role("button", name="Working…")).to_be_disabled()
    finally:
        page.unroute(url_glob, hold)
        while waiting:
            waiting.pop(0).fallback()


def motion_log(page: Page) -> list[dict]:
    return page.evaluate("() => (window.__motionLog || []).splice(0)")


def assert_no_replay(page: Page, what: str) -> list[dict]:
    log = motion_log(page)
    replays = [e for e in log if e["onDialog"]]
    assert replays == [], f"SR1: the refresh replayed the animation of the open {what}: {replays[:4]}"
    return log


TAG_JS = """(root, attribute) => {
  const tag = root.querySelector('[data-tag]');
  const el = tag && attribute ? tag.querySelector('[' + attribute + ']') : tag;
  return el ? el.textContent.trim() : null;
}"""


def tag_text(scope: Page | Locator, attribute: str = "") -> str | None:
    if isinstance(scope, Page):
        return scope.evaluate("a => (" + TAG_JS + ")(document, a)", attribute)
    return scope.evaluate(TAG_JS, attribute)


def tag_count(page: Page) -> int:
    return page.evaluate("() => document.querySelectorAll('[data-tag]').length")


def expect_tag(scope: Page | Locator, attribute: str, expected: str) -> None:
    page = scope if isinstance(scope, Page) else scope.page
    eventually(page, lambda: tag_text(scope, attribute) == expected, f"tag {attribute} to read {expected}")


def outside_staff_nav(page: Page, locator: Locator) -> Locator | None:
    nav = page.get_by_role("navigation", name="Staff")
    for i in range(locator.count()):
        item = locator.nth(i)
        handle = item.element_handle()
        if not any(nav.nth(j).evaluate("(n, e) => n.contains(e)", handle) for j in range(nav.count())):
            return item
    return None


def two_columns_count(page: Page) -> int:
    items = page.get_by_role("list", name="Pieces").get_by_role("listitem")
    n = min(items.count(), 6)
    return len({round(items.nth(i).bounding_box()["x"]) for i in range(n)})


STATUSES = ("on_rail", "on_hold", "sold", "returns_shelf", "donation_box", "returned", "archived")


def eventually(page: Page, check: Callable[[], Any], what: str, seconds: float = UI_TIMEOUT_MS / 1000, step_ms: int = 48) -> Any:
    deadline = monotonic() + seconds
    while True:
        try:
            value = check()
        except AssertionError:
            value = None
        if value:
            return value
        assert monotonic() < deadline, f"timed out waiting for {what}"
        advance(page, step_ms)
        _pause.wait(POLL_SECONDS / 10)


def focused(locator: Locator, seconds: float = UI_TIMEOUT_MS / 1000) -> None:
    eventually(locator.page, lambda: locator.evaluate_all("els => els.includes(document.activeElement)"),
               "focus on the published target", seconds, step_ms=16)


def focused_now(locator: Locator, frames: int = 3) -> None:
    for _ in range(frames + 1):
        if locator.evaluate_all("els => els.includes(document.activeElement)"):
            return
        advance(locator.page, 16)
    raise AssertionError("SR2: focus did not return at once to the control that opened the dialog")


def after_refresh(page: Page) -> None:
    advance(page, REFRESH_MS)
    for _ in range(25):
        _pause.wait(POLL_SECONDS / 6)
        advance(page, 40)


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


def pick(choice: Locator, touch: bool = False) -> None:
    page = choice.page
    expect(choice).to_be_attached()
    point = eventually(page, lambda: choice.evaluate(PICK_JS), "a hit target for the choice or its label")
    (page.touchscreen.tap if touch else page.mouse.click)(point["x"], point["y"])
    eventually(page, choice.is_checked, "the choice to be checked")


@contextmanager
def downloads(page: Page) -> Iterator[list]:
    got: list = []

    def keep(download: Any) -> None:
        got.append(download)

    page.on("download", keep)
    try:
        yield got
    finally:
        page.remove_listener("download", keep)


def all_pieces(c: httpx.Client, q: str = "") -> list[dict]:
    found: dict[str, dict] = {}
    for status in STATUSES:
        params = {"status": status, **({"q": q} if q else {})}
        r = c.get("/api/pieces", params=params)
        assert r.status_code == 200, r.text
        for p in r.json()["pieces"]:
            found[p["id"]] = p
    return list(found.values())


RING_DIFF = 0.5
RING_BAND = 8
SR1_ROUNDS = 3
SR2_HOLD_MS = 1000
SR6_TABS = 12
SR1_TYPED = " Lieve"

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
    '[role=checkbox], [role=radio], [role=switch]';
  for (const e of document.querySelectorAll(controls)) {
    if (e.closest('[inert], [aria-hidden="true"]') || e.matches('input[type=hidden]')) continue;
    if (!e.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    let target = e;
    const own = e.getBoundingClientRect();
    if (e.matches('input[type=radio], input[type=checkbox], [role=radio], [role=checkbox], [role=switch]') ||
        (e.matches('input[type=file]') && (own.width <= 2 || own.height <= 2))) {
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


def finish_motion(page: Page) -> None:
    page.evaluate("() => document.getAnimations().forEach(a => { try { if (Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); } catch (e) {} })")
    advance(page, 32)


def settle_scroll(page: Page) -> None:
    last = None
    for _ in range(10):
        now = page.evaluate(SCROLLS_JS)
        if now == last:
            return
        last = now
        _pause.wait(POLL_SECONDS / 6)
        advance(page, 16)


def shown_one(locator: Locator) -> Locator:
    eventually(locator.page, lambda: any(locator.nth(i).is_visible() for i in range(locator.count())), "a visible control")
    return next(locator.nth(i) for i in range(locator.count()) if locator.nth(i).is_visible())


def key_focus(page: Page, target: Locator) -> None:
    target.focus()
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Tab")
    if not target.evaluate("e => e === document.activeElement"):
        tab_to(page, target)


def ring_visible(page: Page, target: Locator) -> bool:
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


def page_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def table_has(page: Page, needle: str) -> bool:
    return page.evaluate("n => [...document.querySelectorAll('table')].some(t => t.innerText.includes(n))", needle)


def card_has(page: Page, needle: str, word: str) -> bool:
    return page.evaluate("([n, w]) => [...document.querySelectorAll('li, [role=listitem]')].some(e => e.innerText.includes(n) && e.innerText.includes(w))", [needle, word])


def slot_taken(page: Page, instant: str) -> bool:
    dt = local(instant)
    day = f"{WEEKDAYS[dt.weekday()]} {{}} {MONTH_ABBR[dt.month - 1]} {dt.year}, {dt.hour:02d}:{dt.minute:02d}"
    labels = [day.format(dt.day), day.format(f"{dt.day:02d}")]
    return page.evaluate("""labels => ![...document.querySelectorAll('button')].some(b => {
      const name = (b.getAttribute('aria-label') || b.innerText || '').replace(/\\s+/g, ' ').trim();
      return labels.includes(name) && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; })""", labels)


def screen_rules(browser: Browser, base: str, path: str, *, who: tuple[str, str] | None = None,
                 opener: tuple[str, str] | None = None, dialog: str | None = None,
                 open_dialog: Callable[[Page], None] | None = None, ring: tuple[str, str] | None = None,
                 prepare: Callable[[Page], None] | None = None, typed: tuple[str, str] | None = None,
                 chosen: tuple[str, str] | None = None, within: tuple[str, str] | None = None,
                 change: Callable[[], Any] | None = None, appears: Callable[[Page], bool] | None = None,
                 desktop: str = "1280x800", also: tuple[str, ...] = ()) -> None:
    start = base + ("/sign-in" if who else path)

    def arrive(page: Page) -> None:
        if who:
            ui_sign_in(page, base, who)
            expect(page).not_to_have_url(path_re(base, "/sign-in"))
        page.goto(base + path)
        page.wait_for_load_state("networkidle")
        if prepare:
            prepare(page)
            page.wait_for_load_state("networkidle")

    with browse(browser, start, size=SIZES[desktop]) as page:
        page.add_init_script(RECORDER)
        arrive(page)
        button = shown_one(page.get_by_role(opener[0], name=opener[1], exact=True)) if opener else None
        ring_target = button or (shown_one(page.get_by_role(ring[0], name=ring[1], exact=True)) if ring else None)
        if ring_target is not None:
            assert ring_visible(page, ring_target), f"SR8: no visible focus ring on the Tab-focused control of {path}"
        motion_log(page)
        box = None
        if dialog:
            if button is not None:
                key_focus(page, button)
                page.keyboard.press("Enter")
            else:
                open_dialog(page)
            box = page.get_by_role("dialog", name=dialog, exact=True)
            expect(box).to_be_visible()
            eventually(page, lambda: box.evaluate("d => d.contains(document.activeElement)"), "SR8: focus inside the open dialog")
            assert_focus_trapped(page, box)
            finish_motion(page)
            _pause.wait(SETTLE_MS / 1000)
            axe(page)
            if button is not None:
                page.keyboard.press("Escape")
                focused_now(button)
                page.keyboard.press("Enter")
                expect(box).to_be_visible()
                _pause.wait(SETTLE_MS / 1000)
                advance(page, SR2_HOLD_MS)
                finish_motion(page)
                assert box.count() == 1 and box.evaluate(SHOWN_JS), f"SR2: the {dialog} dialog reopened during its closing animation did not stay open"
                eventually(page, lambda: box.evaluate("d => d.contains(document.activeElement)"), "SR2: focus inside the reopened dialog")
        scope = box if box is not None else (page.get_by_role(within[0], name=within[1], exact=True) if within else page)
        seen: list[dict] = []
        if change:
            field = choice = None
            if typed:
                field = scope.get_by_role(typed[0], name=typed[1], exact=True)
                field.focus()
                page.keyboard.press("End")
                page.keyboard.type(SR1_TYPED)
                kept = field.input_value()
            if chosen:
                choice = scope.get_by_role(chosen[0], name=chosen[1], exact=True)
                pick(choice)
            before = page.evaluate(ACTIVE_JS)
            assert not appears(page), "setup: the change is already on the screen"
            finish_motion(page)
            seen += motion_log(page)
            change()
            for _ in range(SR1_ROUNDS):
                after_refresh(page)
                if appears(page):
                    break
            assert appears(page), f"SR1: the 5-second refresh never showed the change on {path}"
            if box is not None:
                assert box.count() == 1 and box.is_visible(), f"SR1: the refresh closed the {dialog} dialog"
                seen += assert_no_replay(page, f"{dialog} dialog")
            if field is not None:
                assert field.input_value() == kept, "SR1: the refresh changed what was typed"
            if choice is not None:
                assert choice.is_checked(), "SR1: the refresh undid the unsaved choice"
            assert page.evaluate(ACTIVE_JS) == before, "SR1: the refresh moved focus"
        if box is not None:
            page.keyboard.press("Escape")
            if button is not None:
                focused(button)
            finish_motion(page)
            _pause.wait(SETTLE_MS / 1000)
        axe(page)
        bad = [e for e in seen + motion_log(page) if e["loops"] or (e["duration"] >= 1 and round(e["duration"]) not in MOTION_DURATIONS)]
        assert bad == [], f"SR7: motion that is not 160, 320 or 640 ms, or that loops, on {path}: {bad[:6]}"
    for size in also:
        with browse(browser, start, size=SIZES[size]) as page:
            arrive(page)
            finish_motion(page)
            axe(page)
    with browse(browser, start, size=SIZES["375x812"], reduced_motion="reduce") as page:
        arrive(page)
        finish_motion(page)
        small = page.evaluate(SMALL_JS)
        assert small == [], f"SR4: controls under 44x44 CSS px at 375x812 on {path}: {small[:8]}"
        axe(page)
        box = None
        if dialog:
            if opener:
                tap(shown_one(page.get_by_role(opener[0], name=opener[1], exact=True)))
            else:
                open_dialog(page)
            box = page.get_by_role("dialog", name=dialog, exact=True)
            expect(box).to_be_visible()
            finish_motion(page)
            small = page.evaluate(SMALL_JS)
            assert small == [], f"SR4: controls under 44x44 CSS px in the open {dialog} dialog at 375x812: {small[:8]}"
            axe(page)
        covered = []
        for _ in range(SR6_TABS):
            page.keyboard.press("Tab")
            settle_scroll(page)
            if box is None or box.evaluate("d => d.contains(document.activeElement)"):
                problem = page.evaluate(UNCOVERED3_JS)
                if problem:
                    covered.append(problem)
        assert covered == [], f"SR6: focused controls not fully in view at 375x812 on {path}: {covered[:6]}"
        if box is not None:
            page.keyboard.press("Escape")
            advance(page, REDUCED_GONE_MS)
            assert page.evaluate(GONE_JS, dialog), f"SR3: the closed {dialog} dialog is still shown or in the accessibility tree {REDUCED_GONE_MS} ms after closing under reduced motion"


def test_sign_in_no_enumeration(app_url: str) -> None:
    c = client(app_url)
    wrong = c.post("/api/session", json={"email": NOOR[0], "password": NOOR[1] + "x"})
    _, nobody = fresh("nobody")
    stranger = c.post("/api/session", json={"email": nobody, "password": NOOR[1]})
    assert wrong.status_code == 401 and stranger.status_code == 401, (wrong.status_code, stranger.status_code)
    assert c.get("/api/session").status_code == 401
    ok = c.post("/api/session", json={"email": NOOR[0], "password": NOOR[1]})
    assert ok.status_code == 200, ok.text
    cookie = "; ".join(f"{name}={value}" for name, value in c.cookies.items())
    assert c.get("/api/session").status_code == 200
    assert c.delete("/api/session").status_code == 204
    assert c.get("/api/session").status_code == 401
    assert client(app_url).get("/api/session", headers={"Cookie": cookie}).status_code == 401


def test_members_owner_only(app_url: str) -> None:
    owner = sign_in(app_url, OWNER)
    email, password, member_id = new_member(owner, "assistant")
    assert member_id in [m["id"] for m in owner.get("/api/members").json()["members"]]
    for lower in (sign_in(app_url, NOOR), sign_in(app_url, INES)):
        assert lower.get("/api/members").status_code == 403
        body = {"name": "Lieve", "email": fresh("x")[1], "password": "start-here-4821", "role": "assistant"}
        assert lower.post("/api/members", json=body).status_code == 403
        assert lower.patch(f"/api/members/{member_id}", json={"role": "bookkeeper"}).status_code == 403
        assert lower.delete(f"/api/members/{member_id}").status_code == 403
    member = sign_in(app_url, (email, password))
    assert member.get("/api/pieces").status_code == 200
    assert owner.patch(f"/api/members/{member_id}", json={"role": "bookkeeper"}).status_code == 200
    assert member.get("/api/pieces").status_code == 403
    assert member.get("/api/payout-runs").status_code == 200
    assert owner.delete(f"/api/members/{member_id}").status_code == 204
    assert client(app_url).post("/api/session", json={"email": email, "password": password}).status_code == 401
    assert member_id not in [m["id"] for m in owner.get("/api/members").json()["members"]]
    for missing in (member_id, str(uuid.uuid4())):
        assert owner.get(f"/api/members/{missing}").status_code == 404
        assert owner.patch(f"/api/members/{missing}", json={"role": "assistant"}).status_code == 404
        assert owner.delete(f"/api/members/{missing}").status_code == 404


def test_wf_shop_access_sign_in_each_role(browser: Browser, app_url: str) -> None:
    for who, role in ((OWNER, "owner"), (NOOR, "assistant"), (INES, "bookkeeper")):
        with browse(browser, app_url + "/sign-in") as page:
            ui_sign_in(page, app_url, who)
            expect(page).to_have_url(path_re(app_url, re.escape(HOME_ROUTES[role])))
            assert page.request.get(app_url + "/api/session").status == 200
            page.reload()
            expect(page).to_have_url(path_re(app_url, re.escape(HOME_ROUTES[role])))
            click(shown_one(page.get_by_role("button", name="Sign out")))
            poll(lambda: page.request.get(app_url + "/api/session").status == 401, "session to end after Sign out")


def test_wf_shop_access_refusals(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, (INES[0], INES[1] + "x"))
        expect(page.get_by_role("button", name="Sign in")).to_be_enabled()
        assert page.request.get(app_url + "/api/session").status == 401
        expect(page).to_have_url(path_re(app_url, "/sign-in"))
        ui_sign_in(page, app_url, INES)
        expect(page).to_have_url(path_re(app_url, re.escape(HOME_ROUTES["bookkeeper"])))
        assert page.request.get(app_url + "/api/members").status == 403


def test_rail_filters_in_address(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    t = today(app_url)
    brand = f"Brand {tok()}"
    first_word, second_word = tok(), tok()
    first = new_piece(desk, c["id"], intake=t - timedelta(days=1), brand=brand, description=f"Wool {first_word} coat")
    second = new_piece(desk, c["id"], intake=t - timedelta(days=1), brand=brand, description=f"Wool {second_word} coat")
    with browse(browser, app_url + "/") as page:
        history = lambda: page.evaluate("() => history.length")
        query = lambda: parse_qs(urlparse(page.url).query)
        start = history()
        pick(page.get_by_role("radiogroup", name="Category").get_by_role("radio", name="Coats"))
        expect(page).to_have_url(re.compile(r"[?&]category=coats"))
        assert history() == start + 1
        size_m = page.get_by_role("group", name="Size").get_by_role("button", name="M", exact=True)
        click(size_m)
        expect(page).to_have_url(re.compile(r"[?&]size=m(&|$)"))
        expect(size_m).to_have_attribute("aria-pressed", "true")
        assert history() == start + 2
        select(page.get_by_role("combobox", name="Brand"), brand)
        poll(lambda: query().get("brand") == [brand], "brand in the address")
        assert history() == start + 3
        pick(page.get_by_role("radiogroup", name="Price").get_by_role("radio", name="Under €50"))
        expect(page).to_have_url(re.compile(r"[?&]price=under-50"))
        assert history() == start + 4
        expect(card(page, first["description"])).to_be_visible()
        expect(card(page, second["description"])).to_be_visible()

        page.go_back()
        poll(lambda: "price" not in query(), "Back to drop the price band")
        expect(page.get_by_role("radio", name="Any price")).to_be_checked()
        page.go_back()
        poll(lambda: "brand" not in query(), "Back to drop the brand")
        page.go_forward()
        poll(lambda: query().get("brand") == [brand], "Forward to restore the brand")
        page.go_forward()
        poll(lambda: query().get("price") == ["under-50"], "Forward to restore the price band")
        expect(page.get_by_role("radio", name="Under €50")).to_be_checked()
        expect(card(page, first["description"])).to_be_visible()

        stalled: list[Any] = []

        def stall_first(route: Any) -> None:
            if f"q={first_word}" in route.request.url:
                stalled.append(route)
            else:
                route.fallback()

        page.route("**/api/rail*", stall_first)
        before_search = history()
        search = page.get_by_role("searchbox", name="Search the rail")
        pause_clock(page)
        search.fill(first_word)
        advance(page, SEARCH_PAUSE_MS - 1)
        assert "q" not in query() and not stalled
        eventually(page, lambda: stalled, "the first search request", step_ms=FRAME_MS)
        search.fill(second_word)
        eventually(page, lambda: "q=" + second_word in page.url, "the second search in the address", step_ms=FRAME_MS)
        page.clock.resume()
        expect(card(page, second["description"])).to_be_visible()
        expect(card(page, first["description"])).to_have_count(0)
        stalled[0].fallback()
        advance(page, SEARCH_PAUSE_MS)
        expect(card(page, second["description"])).to_be_visible()
        expect(card(page, first["description"])).to_have_count(0)
        assert query().get("q") == [second_word]
        assert history() == before_search + 2
        page.unroute("**/api/rail*")


def test_rail_layouts(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    word = tok()
    t = today(app_url)
    for i in range(6):
        new_piece(desk, c["id"], intake=t - timedelta(days=1), description=f"Layout {word} {i}")
    expected = {"1280x800": 3, "1024x768": 2, "768x1024": 2, "375x812": 1}
    for label, columns in expected.items():
        size = SIZES[label]
        with browse(browser, f"{app_url}/?q={word}", size=size, reduced_motion="reduce") as page:
            expect(page.get_by_role("list", name="Pieces").get_by_role("listitem")).to_have_count(6)
            assert two_columns_count(page) == columns, label
            layout(page)
            if columns == 3:
                search = page.get_by_role("searchbox", name="Search the rail")
                expect(search).to_be_visible()
                first_card = page.get_by_role("list", name="Pieces").get_by_role("listitem").first
                assert search.bounding_box()["x"] < first_card.bounding_box()["x"]
                categories = page.get_by_role("button", name="Categories")
                click(categories)
                menu = page.get_by_role("navigation", name="Categories")
                expect(menu.get_by_role("link", name="Coats")).to_be_visible()
                _pause.wait(SETTLE_MS / 1000)
                page.keyboard.press("Escape")
                focused(categories)
                advance(page, REDUCED_GONE_MS)
                assert_closed(page, page.get_by_role("navigation", name="Categories"), [])
                continue
            assert_closed(page, page.get_by_role("dialog", name="Filters"), ["Search the rail", "Close filters"])
            opener = page.get_by_role("button", name="Filters")
            click(opener)
            sheet = page.get_by_role("dialog", name="Filters")
            expect(sheet.get_by_role("searchbox", name="Search the rail")).to_be_visible()
            box = sheet.bounding_box()
            if columns == 2:
                assert box["x"] + box["width"] / 2 > size[0] / 2, "side sheet is not on the right"
            else:
                assert box["y"] + box["height"] / 2 > size[1] / 2, "bottom sheet is not at the bottom"
            click(sheet.get_by_role("button", name="Close filters"))
            focused(opener)
            advance(page, REDUCED_GONE_MS)
            assert_closed(page, page.get_by_role("dialog", name="Filters"), ["Search the rail", "Close filters"])
            if columns == 1:
                menu_button = page.get_by_role("button", name="Menu")
                click(menu_button)
                menu = page.get_by_role("dialog", name="Menu")
                expect(menu.get_by_role("link", name="Book an intake slot")).to_be_visible()
                eventually(page, lambda: menu.evaluate("d => d.contains(document.activeElement)"), "focus inside the Menu sheet")
                page.keyboard.press("Escape")
                focused(menu_button)
                advance(page, REDUCED_GONE_MS)
                assert_closed(page, page.get_by_role("dialog", name="Menu"), [])


def test_rail_sold_and_held_in_place(browser: Browser, app_url: str, mail: Any) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    t = today(app_url)
    word = tok()
    to_hold = new_piece(desk, c["id"], intake=t - timedelta(days=1), description=f"Linen {word} coat one")
    to_sell = new_piece(desk, c["id"], intake=t - timedelta(days=1), description=f"Linen {word} coat two")
    with browse(browser, f"{app_url}/?q={word}", size=SIZES["1024x768"]) as page:
        held_card, sold_card = card(page, to_hold["description"]), card(page, to_sell["description"])
        expect(held_card).to_be_visible()
        expect(held_card).not_to_contain_text("On hold")
        expect(sold_card).not_to_contain_text("Sold")
        page.evaluate("() => { window.__sameDocument = true; }")
        click(page.get_by_role("button", name="Filters"))
        sheet = page.get_by_role("dialog", name="Filters")
        expect(sheet.get_by_role("searchbox", name="Search the rail")).to_have_value(word)
        _, shopper = fresh("shopper")
        assert public_hold(app_url, to_hold["id"], "Camille", shopper).status_code == 201
        sell(desk, to_sell["id"])
        after_refresh(page)
        expect(card_behind_modal(page, to_hold["description"])).to_contain_text("On hold")
        expect(card_behind_modal(page, to_sell["description"])).to_contain_text("Sold")
        expect(sheet).to_be_visible()
        expect(sheet.get_by_role("searchbox", name="Search the rail")).to_have_value(word)
        assert page.evaluate("() => window.__sameDocument === true"), "the rail reloaded"

    public = client(app_url)
    inside = new_piece(desk, c["id"], intake=t - timedelta(days=45))
    past = new_piece(desk, c["id"], intake=t - timedelta(days=45))
    sale_inside = sell(desk, inside["id"], sold_at=brussels_at(t - timedelta(days=SOLD_PAGE_DAYS - 1), 12, 0))
    sell(desk, past["id"], sold_at=brussels_at(t - timedelta(days=SOLD_PAGE_DAYS), 12, 0))
    r = public.get(f"/api/public/pieces/{inside['id']}")
    assert r.status_code == 200, r.text
    assert r.json()["piece"]["status"] == "sold" and r.json()["piece"]["soldAt"] == sale_inside["soldAt"]
    assert_error(public.get(f"/api/public/pieces/{past['id']}"), 410, "piece_gone")


def test_wf_public_rail_touch(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    t = today(app_url)
    word = tok()
    for i, size in enumerate(("m", "m", "s")):
        new_piece(desk, c["id"], intake=t - timedelta(days=1), size=size, description=f"Touch {word} {i}")
    expected_n = len(client(app_url).get("/api/rail", params={"q": word, "size": "m"}).json()["pieces"])
    with browse(browser, f"{app_url}/?q={word}", size=SIZES["375x812"]) as page:
        layout(page)
        axe(page)
        opener = page.get_by_role("button", name="Filters")
        assert_bottom_bar(page, opener)
        tap(opener)
        sheet = page.get_by_role("dialog", name="Filters")
        expect(sheet).to_be_visible()
        advance(page, SETTLE_MS)
        axe(page)
        tap(sheet.get_by_role("group", name="Size").get_by_role("button", name="M", exact=True))
        expect(page).to_have_url(re.compile(r"[?&]size=m(&|$)"))
        show = sheet.get_by_role("button", name=f"Show {expected_n} pieces")
        expect(show).to_be_visible()
        tap(show)
        focused(opener)
        advance(page, SETTLE_MS)
        assert_closes(page, page.get_by_role("dialog", name="Filters"), ["Close filters", f"Show {expected_n} pieces"])
        expect(page.get_by_role("list", name="Pieces").get_by_role("listitem")).to_have_count(expected_n)
        layout(page)
        axe(page)
    shown = new_piece(desk, c["id"], intake=t - timedelta(days=1), description=f"Screen {word} coat")
    assert_error(client(app_url).put("/api/rail", params={"category": "hats"}), 405, "method_not_allowed")
    assert_instants(client(app_url).get("/api/rail", params={"q": word}).json())
    screen_rules(browser, app_url, f"/?q={word}", opener=("button", "Filters"), dialog="Filters", desktop="1024x768",
                 also=("1280x800",), change=lambda: sell(desk, shown["id"]),
                 appears=lambda page: card_has(page, shown["description"], "Sold"))


def test_wf_public_rail_keyboard(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    t = today(app_url)
    word = tok()
    piece = new_piece(desk, c["id"], intake=t - timedelta(days=1), description=f"Keyboard {word} coat")
    gone = new_piece(desk, c["id"], intake=t - timedelta(days=45))
    sell(desk, gone["id"], sold_at=brussels_at(t - timedelta(days=SOLD_PAGE_DAYS + 1), 12, 0))
    with browse(browser, app_url + "/") as page:
        search = page.get_by_role("searchbox", name="Search the rail")
        tab_to(page, search)
        page.keyboard.type(word)
        advance(page, SEARCH_PAUSE_MS)
        expect(card(page, piece["description"])).to_be_visible()
        all_radio = page.get_by_role("radiogroup", name="Category").get_by_role("radio", name="All")
        tab_to(page, all_radio) if not all_radio.is_checked() else tab_to(page, all_radio)
        page.keyboard.press("ArrowDown")
        expect(page.get_by_role("radio", name="Coats")).to_be_checked()
        expect(page).to_have_url(re.compile(r"[?&]category=coats"))
        expect(card(page, piece["description"])).to_be_visible()
        size_m = page.get_by_role("group", name="Size").get_by_role("button", name="M", exact=True)
        tab_to(page, size_m)
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"[?&]size=m(&|$)"))
        page.keyboard.press("Enter")
        expect(size_m).not_to_have_attribute("aria-pressed", "true")
        page.goto(f"{app_url}/pieces/{gone['id']}")
        expect(page.get_by_role("heading", name="This piece has left the rail.")).to_be_visible()
        response = page.goto(f"{app_url}{UNKNOWN_SCREEN}{tok()}")
        assert response is not None and response.status == 404
        expect(page.get_by_role("heading", name="We couldn't find that page.")).to_be_visible()
    rail = client(app_url).get("/api/rail", params={"q": word})
    assert rail.status_code == 200
    assert_camel(rail.json())
    assert_instants(rail.json())
    assert_error(client(app_url).get("/api/rail", params={"category": "hats"}), 422, "validation_failed")
    assert client(app_url).get("/api/rail", params={"brand": f"none {tok()}"}).json()["pieces"] == []


def test_tag_codes(app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    t = today(app_url)
    one = new_piece(desk, c["id"], intake=t)
    two = new_piece(desk, c["id"], intake=t)
    for p in (one, two):
        assert_tag(p["tagCode"])
    assert int(two["tagCode"][3:10]) > int(one["tagCode"][3:10]) > 1000053
    raw = one["tagCode"].replace("-", "").lower()
    found = desk.get("/api/pieces/lookup", params={"tag": raw})
    assert found.status_code == 200 and found.json()["piece"]["id"] == one["id"] and found.json()["piece"]["tagCode"] == one["tagCode"]
    seed = desk.get("/api/pieces/lookup", params={"tag": "hg10000420"})
    assert seed.status_code == 200 and seed.json()["piece"]["tagCode"] == "HG-1000042-0"
    err = assert_error(desk.get("/api/pieces/lookup", params={"tag": "HG-1000042-1"}), 422, "validation_failed")
    assert err["fields"]["tag"] == "This tag code's check digit doesn't match."
    digits = "9999990"
    unknown = f"HG-{digits}-{luhn_digit(digits)}"
    assert_error(desk.get("/api/pieces/lookup", params={"tag": unknown}), 404, "not_found")


def test_photo_checks(app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url))
    pid = piece["id"]
    disguised = upload_photo(desk, pid, png(), name="notes.txt", kind=PLAIN_TYPE)
    assert disguised.status_code == 201, disguised.text
    assert disguised.json()["photo"]["contentType"] != PLAIN_TYPE
    for data, name, kind in ((b"not an image at all", "photo.jpg", JPEG_TYPE), (GIF_1PX, "photo.png", PNG_TYPE),
                             (b"\x89PNG\r\n\x1a\n" + b"garbage" * 20, "photo.png", PNG_TYPE)):
        err = assert_error(upload_photo(desk, pid, data, name, kind), 422, "validation_failed")
        assert err["fields"]["photo"] == "Use a JPEG, PNG or WebP photo."
    at_limit = png(total=PHOTO_FILE_LIMIT)
    assert len(at_limit) == PHOTO_FILE_LIMIT
    accepted = upload_photo(desk, pid, at_limit)
    assert accepted.status_code == 201, accepted.text
    keys_before = S3().keys(f"pieces/{pid}/")
    over = png(total=PHOTO_FILE_LIMIT + 1)
    assert_error(upload_photo(desk, pid, over), 413, "payload_too_large")
    assert S3().keys(f"pieces/{pid}/") == keys_before
    anonymous = client(app_url)
    in_limit_body = anonymous.post(f"/api/pieces/{pid}/photos", files={"photo": ("big.png", over, PNG_TYPE)})
    expected_code = {401: "unauthenticated", 413: "payload_too_large"}.get(in_limit_body.status_code)
    assert expected_code, in_limit_body.text
    assert_error(in_limit_body, in_limit_body.status_code, expected_code)
    big_body = anonymous.post(f"/api/pieces/{pid}/photos", content=b"x" * (PHOTO_BODY_LIMIT + 1),
                              headers={"Content-Type": "multipart/form-data; boundary=probe"})
    assert_error(big_body, 413, "payload_too_large")
    for _ in range(MAX_PHOTOS - 2):
        assert upload_photo(desk, pid, png()).status_code == 201
    err = assert_error(upload_photo(desk, pid, png()), 409, "photo_limit")
    assert err["message"] == "A piece can have at most 6 photos."


def test_photo_originals_and_public_copies(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url + "/") as page:
        b64 = page.evaluate("""() => new Promise((resolve) => {
          const c = document.createElement('canvas'); c.width = 2000; c.height = 1000;
          const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 2000, 1000);
          grad.addColorStop(0, '#c33'); grad.addColorStop(1, '#33c'); g.fillStyle = grad; g.fillRect(0, 0, 2000, 1000);
          c.toBlob((b) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(b); }, 'image/jpeg', 0.9);
        })""")
    base_jpeg = base64.b64decode(b64)
    marker = f"PRIVATE-{tok()}".encode()
    tiff = b"MM\x00\x2a" + struct.pack(">I", 8) + struct.pack(">H", 1) + struct.pack(">HHI", 0x0112, 3, 1) + struct.pack(">HH", 6, 0) + struct.pack(">I", 0)
    exif = b"Exif\x00\x00" + tiff
    xmp = b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta><gps>" + marker + b"</gps></x:xmpmeta>"
    seg = lambda m, p: b"\xff" + bytes([m]) + struct.pack(">H", len(p) + 2) + p
    original = base_jpeg[:2] + seg(JPEG_APP1, exif) + seg(JPEG_APP1, xmp) + seg(JPEG_COM, b"comment " + marker) + base_jpeg[2:]

    desk = sign_in(app_url, NOOR)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url))
    r = upload_photo(desk, piece["id"], original, name="camera.jpg", kind=JPEG_TYPE)
    assert r.status_code == 201, r.text
    photo = r.json()["photo"]
    assert_instants(photo)
    prefix = f"pieces/{piece['id']}/photos/{photo['id']}/"
    assert S3().get(prefix + "original") == original
    public_copy = S3().get(prefix + "public")
    assert public_copy[:2] == b"\xff\xd8", "public copy is not in the original's format"
    assert marker not in public_copy
    markers = [m for m, payload in jpeg_segments(public_copy)]
    assert JPEG_COM not in markers, "comment kept"
    assert not any(m == JPEG_APP1 for m, _ in jpeg_segments(public_copy)), "EXIF or XMP kept"
    width, height = jpeg_size(public_copy)
    assert max(width, height) <= LONGEST_SIDE and height > width, (width, height)
    served = client(app_url).get(f"/api/photos/{photo['id']}")
    assert served.status_code == 200 and served.content == public_copy
    got = owner.get(f"/api/photos/{photo['id']}/original")
    assert got.status_code == 200 and got.content == original and got.headers["content-type"].startswith(JPEG_TYPE)
    assert_error(desk.get(f"/api/photos/{photo['id']}/original"), 403, "forbidden")
    assert client(app_url).get(f"/api/photos/{photo['id']}/original").status_code == 401

    down = outage_url("APP_STORAGE_DOWN_URL")
    desk_down = sign_in(down, NOOR)
    c_down = new_consignor(desk_down)
    p_down = new_piece(desk_down, c_down["id"], intake=today(down))
    err = assert_error(upload_photo(desk_down, p_down["id"], png()), 503, "storage_unavailable")
    assert err["message"] == "Photos can't be saved right now. Nothing was stored — try again in a moment."
    assert desk_down.get(f"/api/pieces/{p_down['id']}").json()["piece"]["photos"] == []


def test_markdown_stations_composite(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(desk)
    t = today(app_url)
    all_ladders = ladders(owner)
    intake = t - timedelta(days=ladder_on(all_ladders, t)["firstMarkdownDay"] + 5)
    piece = new_piece(desk, c["id"], intake=intake)
    ladder = ladder_by_id(all_ladders, piece["ladderId"])
    stations = client(app_url).get(f"/api/public/pieces/{piece['id']}").json()["piece"]["stations"]
    assert [s["station"] for s in stations] == ["full_price", "off_25", "off_50", "period_ends"]
    assert [s["at"] for s in stations] == station_ats(ladder, intake)
    assert [s["label"] for s in stations] == station_labels(ladder)
    ci = current_index(ladder, (t - intake).days)
    assert [s["state"] for s in stations] == ["done"] * ci + ["current"] + ["next"] * (3 - ci)
    labels = station_labels(ladder)
    for size in ("1280x800", "375x812"):
        with browse(browser, f"{app_url}/pieces/{piece['id']}", size=SIZES[size], reduced_motion="reduce") as page:
            assert_stations_match(page, stations)
            buttons = stations_toolbar(page).get_by_role("button")
            for i, label in enumerate(labels):
                expect(buttons.nth(i)).to_have_accessible_name(re.compile("^" + re.escape(label) + ", " + date_re(local(stations[i]["at"]).date()) + "$"))
            walked = tab_order(page, TAB_PRESSES)
            hits = {n for n in walked if any(n.startswith(label + ", ") for label in labels)}
            assert len(hits) == 1 and next(iter(hits)).startswith(labels[ci] + ", "), hits
            tab_to(page, buttons.nth(ci))
            page.keyboard.press("Tab")
            assert not stations_toolbar(page).evaluate("t => t.contains(document.activeElement)"), "toolbar has several Tab stops"
            page.keyboard.press("Shift+Tab")
            focused(buttons.nth(ci))
            page.keyboard.press("ArrowRight")
            focused(buttons.nth(ci + 1))
            page.keyboard.press("End")
            focused(buttons.nth(3))
            page.keyboard.press("Home")
            focused(buttons.nth(0))
            if size == "375x812":
                page.keyboard.press("ArrowDown")
                focused(buttons.nth(1))
                page.keyboard.press("ArrowUp")
                focused(buttons.nth(0))
            page.keyboard.press("ArrowRight")
            page.keyboard.press("Enter")
            popover = page.get_by_role("dialog", name=labels[1], exact=True)
            expect(popover).to_be_visible()
            expect(popover).to_contain_text(money(stations[1]["priceCents"]))
            assert_in_viewport(page, popover)
            _pause.wait(SETTLE_MS / 1000)
            page.keyboard.press("Escape")
            focused(buttons.nth(1))
            advance(page, REDUCED_GONE_MS)
            expect(page.get_by_role("dialog", name=labels[1], exact=True)).to_have_count(0)
            page.keyboard.press("End")
            page.keyboard.press("Enter")
            last = page.get_by_role("dialog", name="Period ends", exact=True)
            assert_in_viewport(page, last)
            click(last.get_by_role("button", name="Close"))
            focused(buttons.nth(3))


def test_price_edit_and_tag_swing(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(desk)
    word = tok()
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1), description=f"Swing {word} coat")
    ladder = ladder_by_id(ladders(owner), piece["ladderId"])
    with browse(browser, f"{app_url}/pieces/{piece['id']}") as page, \
            browse(browser, f"{app_url}/?q={word}", reduced_motion="reduce") as rail:
        for p in (page, rail):
            p.add_init_script(RECORDER)
            p.reload()
        rail_card = card(rail, piece["description"])
        expect(rail_card).to_be_visible()
        expect_tag(page, "data-price", money(4990))
        expect_tag(rail_card, "data-price", money(4990))
        advance(page, SETTLE_MS)
        assert not [e for e in motion_log(page) if e["inTag"] and e["duration"] > 0], "the tag moved on first load"
        motion_log(rail)

        assert_error(desk.patch(f"/api/pieces/{piece['id']}", json={"askingPriceCents": 4500}), 403, "forbidden")
        assert_error(owner.patch(f"/api/pieces/{piece['id']}", json={"askingPriceCents": 99}), 422, "validation_failed")
        r = owner.patch(f"/api/pieces/{piece['id']}", json={"askingPriceCents": 4500}, headers={"If-Match": f'"{piece["version"]}"'})
        assert r.status_code == 200, r.text
        edited = r.json()["piece"]
        assert edited["version"] != piece["version"]
        assert edited["askingPriceCents"] == 4500 and edited["currentPriceCents"] == 4500 and edited["previousPriceCents"] == 4990
        prices = [s["priceCents"] for s in edited["stations"]]
        assert prices[:3] == [4500, half_up_markdown(4500, ladder["firstMarkdownPercent"]), half_up_markdown(4500, ladder["secondMarkdownPercent"])]
        assert_error(owner.patch(f"/api/pieces/{piece['id']}", json={"askingPriceCents": 4400}, headers={"If-Match": f'"{piece["version"]}"'}), 412, "stale_edit")

        after_refresh(page)
        expect_tag(page, "data-price", money(4500))
        expect_tag(page, "data-old-price", money(4990))
        advance(page, SETTLE_MS)
        tag_motion = [e["duration"] for e in motion_log(page) if e["inTag"]]
        assert TAG_SWING_MS in tag_motion and PRICE_SLIDE_MS in tag_motion, tag_motion

        after_refresh(rail)
        expect_tag(rail_card, "data-price", money(4500))
        expect_tag(rail_card, "data-old-price", money(4990))
        advance(rail, REDUCED_GONE_MS)
        reduced = [e["duration"] for e in motion_log(rail) if e["inTag"]]
        assert all(d < REDUCED_GONE_MS for d in reduced), reduced
    sell(desk, piece["id"])
    assert_error(owner.patch(f"/api/pieces/{piece['id']}", json={"askingPriceCents": 4000}), 409, "not_for_sale")


def test_wf_intake_and_tags_keyboard(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    t = today(app_url)
    brand, description = f"Maison {tok()}", f"Wool wrap coat {tok()}"
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, NOOR)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
        opener = page.get_by_role("button", name="New piece")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New piece")
        expect(dialog).to_be_visible()
        consignor_box = dialog.get_by_role("combobox", name="Consignor")
        focused(consignor_box)
        assert_focus_trapped(page, dialog)
        select(consignor_box, c["name"])
        select(dialog.get_by_role("combobox", name="Category"), "Coats")
        type_into(page, dialog.get_by_role("textbox", name="Brand"), brand)
        type_into(page, dialog.get_by_role("textbox", name="Description"), description)
        select(dialog.get_by_role("combobox", name="Size"), "M")
        radio = dialog.get_by_role("radio", name="Very good")
        radio.focus()
        page.keyboard.press("Space")
        expect(radio).to_be_checked()
        type_into(page, dialog.get_by_role("textbox", name="Asking price"), "49.90")
        fill(dialog.get_by_role("textbox", name="Intake date"), t.isoformat())
        save = dialog.get_by_role("button", name="Save piece")
        save.focus()
        page.keyboard.press("Enter")
        expect(page).to_have_url(path_re(app_url, r"/staff/pieces/[0-9a-f-]{36}"))
        pid = urlparse(page.url).path.rsplit("/", 1)[1]
        heading = page.get_by_role("heading", level=1)
        expect(heading).to_have_text(TAG_RE)
        focused(heading)
        tag = heading.inner_text().strip()
        assert_tag(tag)
        expect(announcements(page)).to_have_text(f"Piece {tag} saved.")
        piece = desk.get(f"/api/pieces/{pid}").json()["piece"]
        assert piece["tagCode"] == tag and piece["brand"] == brand and piece["description"] == description
        assert piece["askingPriceCents"] == 4990 and piece["intakeDate"] == t.isoformat() and piece["consignor"]["id"] == c["id"]
        assert piece["category"] == "coats" and piece["size"] == "m" and piece["condition"] == "very_good"
        assert_instants(piece)
        expect_tag(page, "data-price", money(4990))
        expect(stations_toolbar(page).get_by_role("button")).to_have_count(4)
        for i in range(2):
            page.get_by_label("Photo", exact=True).set_input_files(files=[{"name": f"intake-{i}.png", "mimeType": PNG_TYPE, "buffer": png(8 + i, 8)}])
            expect(announcements(page)).to_have_text("Photo saved.")
            poll(lambda: len(desk.get(f"/api/pieces/{pid}").json()["piece"]["photos"]) == i + 1, "photo record")
        keys = S3().keys(f"pieces/{pid}/photos/")
        assert len([k for k in keys if k.endswith("/original")]) == 2 and len([k for k in keys if k.endswith("/public")]) == 2
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_have_text(tag)
    malformed = client(app_url).post("/api/pieces", content=b"{bad", headers={"Content-Type": "application/json"})
    assert_error(malformed, 401, "unauthenticated")
    assert_instants(desk.get(f"/api/pieces/{pid}").json())
    owner = sign_in(app_url, OWNER)
    priced = new_piece(desk, c["id"], intake=t - timedelta(days=1), asking=4400)
    screen_rules(browser, app_url, f"/staff/pieces/{priced['id']}", who=OWNER, opener=("button", "Change price"), dialog="Change price",
                 typed=("textbox", "Asking price"),
                 change=lambda: owner.patch(f"/api/pieces/{priced['id']}", json={"askingPriceCents": 3300}),
                 appears=lambda page: tag_text(page, "data-price") == money(3300))


def test_wf_intake_and_tags_problems(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    brand = f"Problem {tok()}"
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, NOOR)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
        page.get_by_role("button", name="New piece").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New piece")
        select(dialog.get_by_role("combobox", name="Consignor"), c["name"])
        select(dialog.get_by_role("combobox", name="Category"), "Coats")
        type_into(page, dialog.get_by_role("textbox", name="Brand"), brand)
        type_into(page, dialog.get_by_role("textbox", name="Description"), "Wool wrap coat")
        select(dialog.get_by_role("combobox", name="Size"), "M")
        pick(dialog.get_by_role("radio", name="Good", exact=True))
        type_into(page, dialog.get_by_role("textbox", name="Asking price"), "0.50")
        fill(dialog.get_by_role("textbox", name="Intake date"), today(app_url).isoformat())
        dialog.get_by_role("button", name="Save piece").focus()
        page.keyboard.press("Enter")
        problems = page.get_by_role("region", name="Problems")
        expect(problems).to_contain_text("There's a problem")
        expect(problems).to_contain_text("Enter a price from €1.00 to €10,000.00.")
        assert problems.evaluate("r => r.contains(document.activeElement) || r === document.activeElement")
        problems.get_by_role("link", name="Enter a price from €1.00 to €10,000.00.").focus()
        page.keyboard.press("Enter")
        focused(dialog.get_by_role("textbox", name="Asking price"))
        expect(dialog.get_by_role("textbox", name="Brand")).to_have_value(brand)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
    assert [p for p in all_pieces(desk, brand) if p["brand"] == brand] == []


def test_wf_intake_and_tags_storage_down(browser: Browser) -> None:
    down = outage_url("APP_STORAGE_DOWN_URL")
    desk = sign_in(down, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(down))
    copy = "Photos can't be saved right now. Nothing was stored — try again in a moment."
    with browse(browser, down + "/sign-in") as page:
        ui_sign_in(page, down, NOOR)
        expect(page).to_have_url(path_re(down, "/staff/pieces"))
        page.goto(f"{down}/staff/pieces/{piece['id']}")
        page.get_by_label("Photo", exact=True).set_input_files(files=[{"name": "down.png", "mimeType": PNG_TYPE, "buffer": png()}])
        expect(announcements(page)).to_have_text(copy)
        after_refresh(page)
        expect(announcements(page)).to_have_text(copy)
    assert desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["photos"] == []


def test_wf_intake_and_tags_touch(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url + "/sign-in", size=SIZES["375x812"], reduced_motion="reduce") as page:
        ui_sign_in(page, app_url, NOOR)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
        opener = page.get_by_role("button", name="New piece")
        assert_bottom_bar(page, opener)
        layout(page)
        tap(opener)
        dialog = page.get_by_role("dialog", name="New piece")
        expect(dialog).to_be_visible()
        for name in ("Brand", "Description", "Asking price"):
            tap(dialog.get_by_role("textbox", name=name))
            assert_uncovered(page)
        axe(page)
        tap(dialog.get_by_role("button", name="Cancel"))
        focused(opener)
        advance(page, REDUCED_GONE_MS)
        assert_closed(page, page.get_by_role("dialog", name="New piece"), ["Save piece"])
        layout(page)
        axe(page)


PRICE_CASES = {"4990": (4990, 3743), "1990": (1990, 1493)}


@pytest.mark.parametrize("case", list(PRICE_CASES), ids=list(PRICE_CASES))
def test_markdown_prices_half_up(app_url: str, case: str) -> None:
    asking, at_25 = PRICE_CASES[case]
    desk = sign_in(app_url, NOOR)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(desk)
    t = today(app_url)
    all_ladders = ladders(owner)
    intake = t - timedelta(days=ladder_on(all_ladders, t)["firstMarkdownDay"] + 5)
    piece = new_piece(desk, c["id"], intake=intake, asking=asking)
    ladder = ladder_by_id(all_ladders, piece["ladderId"])
    first, second = ladder["firstMarkdownPercent"], ladder["secondMarkdownPercent"]
    prices = [s["priceCents"] for s in piece["stations"]]
    assert prices[:3] == [asking, half_up_markdown(asking, first), half_up_markdown(asking, second)]
    assert piece["currentPriceCents"] == price_on_day(ladder, asking, (t - intake).days)
    if first == 25:
        assert prices[1] == at_25
    rail = client(app_url).get(f"/api/public/pieces/{piece['id']}").json()["piece"]
    assert rail["currentPriceCents"] == piece["currentPriceCents"]


def test_brussels_days(app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(desk)
    all_ladders = ladders(owner)
    now = today(app_url)
    sundays = [date(y, 3, 31) - timedelta(days=(date(y, 3, 31).weekday() - 6) % 7) for y in (now.year - 1, now.year)]
    fixed = max(s for s in sundays if s - timedelta(days=30) <= now) - timedelta(days=30)
    piece = new_piece(desk, c["id"], intake=fixed)
    ladder = ladder_by_id(all_ladders, piece["ladderId"])
    assert ladder["id"] == ladder_on(all_ladders, fixed)["id"]
    ats = [s["at"] for s in piece["stations"]]
    assert ats == station_ats(ladder, fixed)
    assert parse_z(ats[1]).astimezone(BRUSSELS).date() == fixed + timedelta(days=ladder["firstMarkdownDay"])
    if fixed == date(2026, 2, 27) and (ladder["firstMarkdownDay"], ladder["secondMarkdownDay"], ladder["periodEndDay"]) == (30, 60, 90):
        assert ats[1:] == ["2026-03-28T23:00:00Z", "2026-04-27T22:00:00Z", "2026-05-27T22:00:00Z"]
    t = today(app_url)
    autumn = date(t.year if t.month > 10 or (t.month == 10 and t.day > 25) else t.year - 1, 9, 26)
    piece2 = new_piece(desk, c["id"], intake=autumn)
    ladder2 = ladder_by_id(all_ladders, piece2["ladderId"])
    assert [s["at"] for s in piece2["stations"]] == station_ats(ladder2, autumn)
    for at in ats + [s["at"] for s in piece2["stations"]]:
        assert local(at).hour == 0 and local(at).minute == 0


def test_ladder_changes_by_date(app_url: str) -> None:
    spare = outage_url("APP_SPARE_URL")
    owner = sign_in(spare, OWNER)
    desk = sign_in(spare, NOOR)
    t = today(spare)
    body = {"effectiveOn": t.isoformat(), "firstMarkdownPercent": 30, "firstMarkdownDay": 21, "secondMarkdownPercent": 60, "secondMarkdownDay": 45, "periodEndDay": 75}
    existed = any(lad["effectiveOn"] == t.isoformat() for lad in ladders(owner))
    r = owner.post("/api/ladders", json=body)
    if existed:
        assert_error(r, 409, "ladder_date_taken")
    else:
        assert r.status_code == 201, r.text
        assert {k: r.json()["ladder"][k] for k in body} == body
    err = assert_error(owner.post("/api/ladders", json=body), 409, "ladder_date_taken")
    assert re.match("^A ladder change already takes effect on " + date_re(t) + r"\.$", err["message"]), err["message"]
    assert_error(desk.post("/api/ladders", json=body), 403, "forbidden")
    for bad in ({"effectiveOn": (t - timedelta(days=1)).isoformat()}, {"effectiveOn": (t + timedelta(days=366)).isoformat()},
                {"firstMarkdownPercent": 60}, {"periodEndDay": 14}):
        assert_error(owner.post("/api/ladders", json={**body, **bad}), 422, "validation_failed")
    all_ladders = ladders(owner)
    todays = [lad for lad in all_ladders if lad["effectiveOn"] == t.isoformat()]
    assert len(todays) == 1
    new_ladder = todays[0]
    old_ladder = ladder_on(all_ladders, t - timedelta(days=1))
    c = new_consignor(desk)
    newer = new_piece(desk, c["id"], intake=t)
    older = new_piece(desk, c["id"], intake=t - timedelta(days=1))
    assert newer["ladderId"] == new_ladder["id"] and older["ladderId"] == old_ladder["id"]
    assert [s["at"] for s in newer["stations"]] == station_ats(new_ladder, t)
    assert [s["label"] for s in newer["stations"]] == station_labels(new_ladder)
    assert [s["at"] for s in older["stations"]] == station_ats(old_ladder, t - timedelta(days=1))
    for p, lad, intake in ((newer, new_ladder, t), (older, old_ladder, t - timedelta(days=1))):
        public = client(spare).get(f"/api/public/pieces/{p['id']}").json()["piece"]
        assert [s["at"] for s in public["stations"]] == station_ats(lad, intake)
        assert [s["label"] for s in public["stations"]] == station_labels(lad)
    sale = sell(desk, older["id"])
    assert sale["priceCents"] == price_on_day(old_ladder, 4990, 1)


def test_prices_from_server_clock(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(desk)
    t = today(app_url)
    first_day = ladder_on(ladders(owner), t - timedelta(days=40))["firstMarkdownDay"]
    ahead = new_piece(desk, c["id"], intake=t - timedelta(days=first_day - 1))
    behind = new_piece(desk, c["id"], intake=t - timedelta(days=first_day))
    now = server_now(app_url)
    shift = timedelta(hours=26)
    for piece, offset in ((ahead, shift), (behind, -shift)):
        api = client(app_url).get(f"/api/public/pieces/{piece['id']}").json()["piece"]
        with browse(browser, f"{app_url}/pieces/{piece['id']}") as page:
            page.clock.set_system_time(now + offset)
            page.reload()
            assert_stations_match(page, api["stations"])
            expect_tag(page, "data-price", money(api["currentPriceCents"]))
    staff_api = desk.get(f"/api/pieces/{ahead['id']}").json()["piece"]
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, NOOR)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
        page.clock.set_system_time(now + shift)
        page.goto(f"{app_url}/staff/pieces/{ahead['id']}")
        assert_stations_match(page, staff_api["stations"])
        expect_tag(page, "data-price", money(staff_api["currentPriceCents"]))


def test_wf_markdown_ladder_keyboard(browser: Browser) -> None:
    spare = outage_url("APP_SPARE_URL")
    owner = sign_in(spare, OWNER)
    t = today(spare)
    taken = {lad["effectiveOn"] for lad in ladders(owner)}
    when = next(t + timedelta(days=k) for k in range(300, 366) if (t + timedelta(days=k)).isoformat() not in taken)
    values = [("First markdown percent", "30"), ("First markdown day", "21"), ("Second markdown percent", "60"), ("Second markdown day", "45"), ("Period end day", "75")]
    with browse(browser, spare + "/sign-in") as page:
        ui_sign_in(page, spare, OWNER)
        expect(page).to_have_url(path_re(spare, "/staff/consignors"))
        page.goto(spare + "/staff/ladder")
        opener = page.get_by_role("button", name="Change ladder")

        def fill_dialog() -> Locator:
            opener.focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Change ladder")
            first_field = dialog.get_by_role("textbox", name="Takes effect on")
            focused(first_field)
            fill(first_field, when.isoformat())
            for name, value in values:
                field = dialog.get_by_role("textbox", name=name)
                field.focus()
                page.keyboard.press("Control+A")
                page.keyboard.type(value)
            dialog.get_by_role("button", name="Save ladder").focus()
            with reads_working(page, dialog, "**/api/ladders", only="POST"):
                page.keyboard.press("Enter")
            return dialog

        fill_dialog()
        expect(announcements(page)).to_have_text(exact(r"Ladder saved\. It applies to pieces taken in from " + date_re(when) + r"\."))
        focused(opener)
        assert len([lad for lad in ladders(owner) if lad["effectiveOn"] == when.isoformat()]) == 1
        dialog = fill_dialog()
        copy = r"A ladder change already takes effect on " + date_re(when) + r"\."
        expect(announcements(page)).to_have_text(exact(copy))
        expect(dialog).to_be_visible()
        expect(page.get_by_role("region", name="Problems")).to_contain_text(re.compile(copy))
        expect(dialog.get_by_role("textbox", name="First markdown percent")).to_have_value("30")
        expect(dialog.get_by_role("textbox", name="Period end day")).to_have_value("75")
    assert len([lad for lad in ladders(owner) if lad["effectiveOn"] == when.isoformat()]) == 1
    assert_error(sign_in(spare, NOOR).post("/api/ladders", json={"effectiveOn": "nope"}), 403, "forbidden")
    assert_instants(owner.get("/api/ladders").json())
    used = {lad["effectiveOn"] for lad in ladders(owner)}
    later = next(t + timedelta(days=k) for k in range(200, 300) if (t + timedelta(days=k)).isoformat() not in used)
    ladder_body = {"effectiveOn": later.isoformat(), "firstMarkdownPercent": 30, "firstMarkdownDay": 21, "secondMarkdownPercent": 60, "secondMarkdownDay": 45, "periodEndDay": 75}

    def add_later() -> None:
        r = owner.post("/api/ladders", json=ladder_body)
        assert r.status_code == 201, r.text

    screen_rules(browser, spare, "/staff/ladder", who=OWNER, opener=("button", "Change ladder"), dialog="Change ladder",
                 change=add_later, appears=lambda page: re.search(date_re(later), page_text(page)) is not None)


def test_wf_markdown_ladder_touch(browser: Browser) -> None:
    spare = outage_url("APP_SPARE_URL")
    with browse(browser, spare + "/sign-in", size=SIZES["375x812"], reduced_motion="reduce") as page:
        ui_sign_in(page, spare, OWNER)
        expect(page).to_have_url(path_re(spare, "/staff/consignors"))
        page.goto(spare + "/staff/ladder")
        expect(page.get_by_role("table", name="Ladders")).to_be_attached()
        opener = page.get_by_role("button", name="Change ladder")
        assert_bottom_bar(page, opener)
        layout(page)
        axe(page)
        tap(opener)
        dialog = page.get_by_role("dialog", name="Change ladder")
        for name in ("Takes effect on", "Second markdown day", "Period end day"):
            tap(dialog.get_by_role("textbox", name=name))
            assert_uncovered(page)
        axe(page)
        page.keyboard.press("Escape")
        focused(opener)
        advance(page, REDUCED_GONE_MS)
        assert_closed(page, page.get_by_role("dialog", name="Change ladder"), ["Save ladder"])


def test_one_hold_per_piece(app_url: str, mail: Any) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    emails = [fresh("shopper")[1] for _ in range(5)]
    barrier = threading.Barrier(len(emails))

    def attempt(email: str) -> httpx.Response:
        with client(app_url) as c2:
            barrier.wait()
            return c2.post(f"/api/pieces/{piece['id']}/holds", json={"name": "Camille", "email": email})

    with ThreadPoolExecutor(len(emails)) as pool:
        results = list(pool.map(attempt, emails))
    winners = [r for r in results if r.status_code == 201]
    assert len(winners) == 1, [r.status_code for r in results]
    hold = winners[0].json()["hold"]
    end = local(hold["endsAt"])
    for r in results:
        if r is winners[0]:
            continue
        err = assert_error(r, 409, "hold_taken")
        assert re.match(r"^Someone else is holding this piece until " + time_re(end) + r"\.$", err["message"]), err["message"]
    winner_email = emails[results.index(winners[0])]
    assert len(mails_to(mail, winner_email)) == 1
    for email in emails:
        if email != winner_email:
            no_mail_to(mail, email)
    holds = [h for h in desk.get("/api/holds").json()["holds"] if h["pieceId"] == piece["id"]]
    assert len(holds) == 1 and holds[0]["id"] == hold["id"]


def test_hold_end_and_hold_page(app_url: str, mail: Any) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    _, shopper = fresh("shopper")
    r = public_hold(app_url, piece["id"], "Camille", shopper)
    assert r.status_code == 201, r.text
    hold = r.json()["hold"]
    assert_instants(hold)
    assert (parse_z(hold["endsAt"]) - parse_z(hold["startsAt"])).total_seconds() == HOLD_SECONDS

    short = outage_url("APP_SHORT_URL")
    sdesk = sign_in(short, NOOR)
    sc = new_consignor(sdesk)
    sp = new_piece(sdesk, sc["id"], intake=today(short) - timedelta(days=1))
    name, email = f"Shopper {tok()}", fresh("shopper")[1]
    r = public_hold(short, sp["id"], name, email)
    assert r.status_code == 201, r.text
    short_hold = r.json()["hold"]
    assert (parse_z(short_hold["endsAt"]) - parse_z(short_hold["startsAt"])).total_seconds() == SHORT_SECONDS
    token = link_path(mails_to(mail, email)[0], "/h/").rsplit("/", 1)[1]
    page = client(short).get(f"/api/holds/by-token/{token}")
    assert page.status_code == 200, page.text
    body = page.json()["hold"]
    assert body["shopAddress"] == SHOP_ADDRESS and body["endsAt"] == short_hold["endsAt"]
    assert 0 <= body["secondsLeft"] <= SHORT_SECONDS
    assert body["piece"]["tagCode"] == sp["tagCode"] and body["piece"]["description"] == sp["description"]
    assert name not in page.text and email not in page.text and sc["name"] not in page.text
    assert_instants(page.json())
    end = parse_z(short_hold["endsAt"])
    poll(lambda: server_now(short) >= end, "the hold's end instant", seconds=SHORT_SECONDS + 15)
    assert_error(client(short).post(f"/api/holds/by-token/{token}/release"), 409, "hold_ended")
    assert_error(sdesk.post(f"/api/holds/{short_hold['id']}/release"), 409, "hold_ended")
    assert client(short).get(f"/api/public/pieces/{sp['id']}").json()["piece"]["status"] == "on_rail"
    second_email = fresh("shopper")[1]
    again = public_hold(short, sp["id"], "Camille", second_email)
    assert again.status_code == 201, again.text
    token2 = link_path(mails_to(mail, second_email)[0], "/h/").rsplit("/", 1)[1]
    let_go = client(short).post(f"/api/holds/by-token/{token2}/release")
    assert let_go.status_code == 200 and let_go.json()["hold"]["status"] == "released"
    assert client(short).get(f"/api/public/pieces/{sp['id']}").json()["piece"]["status"] == "on_rail"
    assert_error(client(short).post(f"/api/holds/by-token/{token2}/release"), 409, "hold_ended")


def test_hold_mail(app_url: str, mail: Any) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    name, email = f"Shopper {tok()}", fresh("shopper")[1]
    r = public_hold(app_url, piece["id"], name, email)
    assert r.status_code == 201, r.text
    hold = r.json()["hold"]
    msgs = mails_to(mail, email)
    assert len(msgs) == 1
    msg = msgs[0]
    body = text(msg)
    assert re.match(r"^Your hold at Atelier Ourlet until " + time_re(local(hold["endsAt"])) + "$", msg["Subject"]), msg["Subject"]
    assert mail_from_address() in addresses(msg.get("From"))
    for part in (piece["tagCode"], piece["description"], piece["brand"], money(piece["currentPriceCents"]), SHOP_ADDRESS):
        assert part in body, part
    assert re.search(datetime_re(hold["endsAt"]), body)
    path = link_path(msg, "/h/")
    assert client(app_url).get("/api/holds/by-token/" + path.rsplit("/", 1)[1]).status_code == 200
    assert name not in body and c["name"] not in body and c["email"] not in body

    down = outage_url("APP_MAIL_DOWN_URL")
    ddesk = sign_in(down, NOOR)
    dc = new_consignor(ddesk)
    dp = new_piece(ddesk, dc["id"], intake=today(down) - timedelta(days=1))
    for _ in range(2):
        err = assert_error(public_hold(down, dp["id"], "Camille", fresh("shopper")[1]), 503, "mail_unavailable")
        assert err["message"] == "We can't send your confirmation right now. Nothing was saved — try again in a moment."
    assert ddesk.get(f"/api/pieces/{dp['id']}").json()["piece"]["status"] == "on_rail"
    assert [h for h in ddesk.get("/api/holds").json()["holds"] if h["pieceId"] == dp["id"]] == []


def test_release_dialog_survives_close(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    r = desk.post(f"/api/pieces/{piece['id']}/holds", json={"name": "Camille", "email": fresh("shopper")[1]})
    assert r.status_code == 201, r.text
    hold_id = r.json()["hold"]["id"]
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, NOOR)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
        page.goto(f"{app_url}/staff/holds/{hold_id}")
        expect(page.get_by_role("heading", level=1)).to_have_text(f"Hold {piece['tagCode']}")
        release = page.get_by_role("button", name="Release", exact=True)
        click(release)
        dialog = page.get_by_role("dialog", name="Release hold")
        expect(dialog.get_by_role("button", name="Keep hold")).to_be_visible()
        click(dialog.get_by_role("button", name="Keep hold"))
        focused_now(release)
        click(release)
        advance(page, SETTLE_MS)
        expect(dialog).to_be_visible()
        expect(dialog).to_have_css("opacity", "1")
        after_refresh(page)
        expect(dialog).to_be_visible()
        expect(dialog).to_have_css("opacity", "1")
        assert_in_viewport(page, dialog.get_by_role("button", name="Release hold"))
        click(dialog.get_by_role("button", name="Release hold"))
        expect(announcements(page)).to_have_text("Hold released.")
        focused(page.get_by_role("heading", level=1))
    assert desk.get(f"/api/holds/{hold_id}").json()["hold"]["status"] == "released"


def test_wf_shopper_holds_public_hold(browser: Browser, app_url: str, mail: Any) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    _, email = fresh("shopper")
    with browse(browser, f"{app_url}/pieces/{piece['id']}") as page:
        opener = page.get_by_role("button", name="Hold this piece")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Hold this piece")
        focused(dialog.get_by_role("textbox", name="Your name"))
        page.keyboard.type("Camille")
        dialog.get_by_role("textbox", name="Email").focus()
        page.keyboard.type(email)
        dialog.get_by_role("button", name="Hold piece").focus()
        page.keyboard.press("Enter")
        poll(lambda: [h for h in desk.get("/api/holds").json()["holds"] if h["pieceId"] == piece["id"]], "the hold record")
        hold = next(h for h in desk.get("/api/holds").json()["holds"] if h["pieceId"] == piece["id"])
        expect(announcements(page)).to_have_text(exact(r"Held for you until " + time_re(local(hold["endsAt"])) + r"\. The details are on their way by mail\."))
        focused(opener)
        expect(page).to_have_url(path_re(app_url, f"/pieces/{piece['id']}"))
        assert hold["shopperEmail"] == email
    path = link_path(mails_to(mail, email)[0], "/h/")
    with browse(browser, app_url + path, size=SIZES["375x812"]) as page:
        expect(page.get_by_text(re.compile(r"Held until " + datetime_re(hold["endsAt"])))).to_be_visible()
        expect(page.get_by_text(re.compile(r"\d+ minutes left"))).to_be_visible()
        expect(page.get_by_text(SHOP_ADDRESS).first).to_be_visible()
        poll(lambda: tag_count(page) >= 1, "the hold page's tag", seconds=UI_TIMEOUT_MS / 1000)
        let_go = page.get_by_role("button", name="Let the hold go")
        assert_bottom_bar(page, let_go)
        layout(page)
        axe(page)
        tap(let_go)
        expect(announcements(page)).to_have_text("Hold released.")
    assert client(app_url).get(f"/api/holds/by-token/{path.rsplit('/', 1)[1]}").json()["hold"]["status"] == "released"
    assert desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["status"] == "on_rail"
    owner = sign_in(app_url, OWNER)
    target = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1), asking=8800)
    unknown = str(uuid.uuid4())
    assert_error(client(app_url).post(f"/api/pieces/{unknown}/holds", json={"name": "", "email": "x"}), 404, "not_found")
    assert_instants(client(app_url).get(f"/api/public/pieces/{target['id']}").json())
    screen_rules(browser, app_url, f"/pieces/{target['id']}", opener=("button", "Hold this piece"), dialog="Hold this piece",
                 typed=("textbox", "Your name"),
                 change=lambda: owner.patch(f"/api/pieces/{target['id']}", json={"askingPriceCents": 7700}),
                 appears=lambda page: tag_text(page, "data-price") == money(7700))


def test_wf_shopper_holds_lost_hold(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    with browse(browser, f"{app_url}/pieces/{piece['id']}") as page:
        click(page.get_by_role("button", name="Hold this piece"))
        dialog = page.get_by_role("dialog", name="Hold this piece")
        dialog.get_by_role("textbox", name="Your name").fill("Camille")
        dialog.get_by_role("textbox", name="Email").fill(fresh("shopper")[1])
        with no_refresh(page):
            winner = public_hold(app_url, piece["id"], "Noa", fresh("shopper")[1])
            assert winner.status_code == 201
            click(dialog.get_by_role("button", name="Hold piece"))
        copy = r"Someone else is holding this piece until " + time_re(local(winner.json()["hold"]["endsAt"])) + r"\."
        expect(announcements(page)).to_have_text(exact(copy))
        expect(page.get_by_role("region", name="Problems")).to_contain_text(re.compile(copy))
        after_refresh(page)
        expect(announcements(page)).to_have_text(exact(copy))
        expect(dialog.get_by_role("textbox", name="Your name")).to_have_value("Camille")
    holds = [h for h in desk.get("/api/holds").json()["holds"] if h["pieceId"] == piece["id"]]
    assert [h["id"] for h in holds] == [winner.json()["hold"]["id"]]


def test_wf_shopper_holds_short_timers(browser: Browser, mail: Any) -> None:
    short = outage_url("APP_SHORT_URL")
    desk = sign_in(short, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(short) - timedelta(days=1))
    _, email = fresh("shopper")
    r = public_hold(short, piece["id"], "Camille", email)
    assert r.status_code == 201
    hold = r.json()["hold"]
    path = link_path(mails_to(mail, email)[0], "/h/")
    with browse(browser, short + path, size=SIZES["375x812"]) as page:
        page.clock.set_system_time(server_now(short) + timedelta(hours=5))
        page.reload()
        expect(page.get_by_text(re.compile(r"Held until " + datetime_re(hold["endsAt"])))).to_be_visible()
        expect(page.get_by_text(re.compile(r"(^|\D)0 minutes left"))).to_be_visible()
        poll(lambda: client(short).get(f"/api/public/pieces/{piece['id']}").json()["piece"]["status"] == "on_rail",
             "the short hold to end", seconds=SHORT_SECONDS + 15)
        after_refresh(page)
        shown_one(page.get_by_text("This hold has ended."))


def test_wf_shopper_holds_mail_down(browser: Browser) -> None:
    down = outage_url("APP_MAIL_DOWN_URL")
    desk = sign_in(down, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(down) - timedelta(days=1))
    copy = "We can't send your confirmation right now. Nothing was saved — try again in a moment."
    with browse(browser, f"{down}/pieces/{piece['id']}") as page:
        click(page.get_by_role("button", name="Hold this piece"))
        dialog = page.get_by_role("dialog", name="Hold this piece")
        dialog.get_by_role("textbox", name="Your name").fill("Camille")
        dialog.get_by_role("textbox", name="Email").fill(fresh("shopper")[1])
        click(dialog.get_by_role("button", name="Hold piece"))
        expect(announcements(page)).to_have_text(copy)
        expect(dialog).to_be_visible()
    assert desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["status"] == "on_rail"


def test_till_request_key(app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    key = idempotency_key()
    body = {"pieceId": piece["id"], "payment": "card"}
    first = desk.post("/api/sales", json=body, headers={"Request-Key": key})
    assert first.status_code == 201, first.text
    replay = desk.post("/api/sales", json=body, headers={"Request-Key": key})
    assert replay.status_code == 201 and replay.json() == first.json()
    assert_error(desk.post("/api/sales", json={**body, "payment": "cash"}, headers={"Request-Key": key}), 409, "request_key_reused")
    assert_error(desk.post("/api/sales", json=body, headers={"Request-Key": idempotency_key()}), 409, "already_sold")
    month = month_of(local(first.json()["sale"]["soldAt"]).date())
    lines = [line for line in owner.get("/api/sales", params={"month": month}).json()["lines"] if line["tagCode"] == piece["tagCode"]]
    assert len(lines) == 1


SHARE_CASES = {"31245": 31245, "2243": 2243, "30000": 30000, "30001": 30001}


@pytest.mark.parametrize("case", list(SHARE_CASES), ids=list(SHARE_CASES))
def test_shares_commission_vat(app_url: str, case: str) -> None:
    price = SHARE_CASES[case]
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1), asking=price)
    sale = sell(desk, piece["id"])
    share, commission, vat = split(price)
    assert (sale["priceCents"], sale["consignorShareCents"], sale["commissionCents"], sale["vatCents"]) == (price, share, commission, vat)
    if price == 31245:
        assert (share, commission, vat) == (21872, 9373, 1627)
    if price == 2243:
        assert (share, commission, vat) == (1346, 897, 156)
    again = desk.get(f"/api/sales/{sale['id']}").json()["sale"]
    assert again["consignorShareCents"] == share and again["vatCents"] == vat
    assert_instants(again)


def test_already_sold(app_url: str) -> None:
    noor = sign_in(app_url, NOOR)
    jules = sign_in(app_url, JULES)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(noor)
    piece = new_piece(noor, c["id"], intake=today(app_url) - timedelta(days=1))
    sale = sell(noor, piece["id"])
    assert sale["soldBy"]["name"] == "Noor"
    err = assert_error(jules.post("/api/sales", json={"pieceId": piece["id"], "payment": "cash"}), 409, "already_sold")
    assert re.match(r"^Sold by Noor at " + time_re(local(sale["soldAt"])) + r"\. Nothing was charged\.$", err["message"]), err["message"]
    month = month_of(local(sale["soldAt"]).date())
    lines = [line for line in owner.get("/api/sales", params={"month": month}).json()["lines"] if line["tagCode"] == piece["tagCode"]]
    assert len(lines) == 1 and lines[0]["saleId"] == sale["id"]


def test_refunds_and_earlier_sales(app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(desk)
    t = today(app_url)
    intake = t - timedelta(days=50)
    piece = new_piece(desk, c["id"], intake=intake)
    ladder = ladder_by_id(ladders(owner), piece["ladderId"])
    assert owner.patch(f"/api/pieces/{piece['id']}", json={"askingPriceCents": 6000}).status_code == 200
    sale_day = t - timedelta(days=REFUND_DAYS)
    sale = sell(desk, piece["id"], payment="cash", sold_at=brussels_at(sale_day, 12, 0))
    assert sale["soldAt"] == brussels_at(sale_day, 12, 0)
    assert sale["priceCents"] == price_on_day(ladder, 4990, (sale_day - intake).days)
    assert sale["refundableUntil"] == z(datetime(t.year, t.month, t.day, 23, 59, 59, tzinfo=BRUSSELS))
    refunded = desk.post(f"/api/sales/{sale['id']}/refund")
    assert refunded.status_code == 200, refunded.text
    assert INSTANT_RE.match(refunded.json()["sale"]["refundedAt"])
    back = desk.get(f"/api/pieces/{piece['id']}").json()["piece"]
    assert back["status"] == "on_rail" and back["currentPriceCents"] == price_on_day(ladder, 6000, (t - intake).days)
    assert_error(desk.post(f"/api/sales/{sale['id']}/refund"), 409, "already_refunded")

    late_piece = new_piece(desk, c["id"], intake=intake)
    late = sell(desk, late_piece["id"], sold_at=brussels_at(t - timedelta(days=REFUND_DAYS + 1), 12, 0))
    err = assert_error(desk.post(f"/api/sales/{late['id']}/refund"), 409, "refund_window_closed")
    assert err["message"] == "This sale can no longer be refunded."
    future = new_piece(desk, c["id"], intake=intake)
    for when in (z(server_now(app_url) + timedelta(hours=2)), brussels_at(intake - timedelta(days=1), 12, 0)):
        err = assert_error(desk.post("/api/sales", json={"pieceId": future["id"], "payment": "card", "soldAt": when}), 422, "validation_failed")
        assert "soldAt" in err["fields"]
    assert desk.get(f"/api/pieces/{future['id']}").json()["piece"]["status"] == "on_rail"


def test_wf_till_keyboard(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    keys: list[str | None] = []
    with browse(browser, app_url + "/sign-in") as page:
        page.on("request", lambda r: keys.append(r.headers.get("request-key")) if r.method == "POST" and urlparse(r.url).path == "/api/sales" else None)
        ui_sign_in(page, app_url, NOOR)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
        page.goto(app_url + "/staff/till")
        field = page.get_by_role("textbox", name="Tag code")
        field.focus()
        page.keyboard.type(piece["tagCode"].replace("-", "").lower())
        page.keyboard.press("Enter")
        expect(page.get_by_text(piece["tagCode"]).first).to_be_visible()
        expect_tag(page, "data-price", money(piece["currentPriceCents"]))
        sell_button = page.get_by_role("button", name="Sell", exact=True)
        tab_to(page, sell_button)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Sell piece")
        expect(dialog).to_be_visible()
        assert_focus_trapped(page, dialog)
        card_radio = dialog.get_by_role("radio", name="Card")
        dialog.get_by_role("radiogroup", name="Payment").get_by_role("radio").first.focus()
        for _ in range(3):
            if card_radio.is_checked():
                break
            page.keyboard.press("ArrowRight")
        expect(card_radio).to_be_checked()
        complete = dialog.get_by_role("button", name="Complete sale")
        tab_to(page, complete, presses=6)
        with held(page, "**/api/sales") as pending:
            page.keyboard.press("Enter")
            working = dialog.get_by_role("button", name="Working…")
            expect(working).to_be_disabled()
            pending.release()
        expect(page).to_have_url(path_re(app_url, r"/staff/sales/[0-9a-f-]{36}"))
        sale_id = urlparse(page.url).path.rsplit("/", 1)[1]
        heading = page.get_by_role("heading", level=1)
        expect(heading).to_have_text(f"Sale {piece['tagCode']}")
        focused(heading)
        expect(announcements(page)).to_have_text(f"Sold {piece['tagCode']} for {money(piece['currentPriceCents'])}.")
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_have_text(f"Sale {piece['tagCode']}")
    assert keys and all(k and 1 <= len(k) <= 100 for k in keys), keys
    sale = desk.get(f"/api/sales/{sale_id}").json()["sale"]
    assert sale["pieceId"] == piece["id"] and sale["payment"] == "card" and sale["priceCents"] == piece["currentPriceCents"]
    assert sale["soldBy"]["name"] == "Noor"
    owner = sign_in(app_url, OWNER)
    at_till = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1), asking=6600)
    assert_error(desk.post("/api/sales", content=b"{bad", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    assert_instants(desk.get(f"/api/sales/{sale_id}").json())

    def find(page: Page) -> None:
        page.get_by_role("textbox", name="Tag code").fill(at_till["tagCode"])
        page.keyboard.press("Enter")
        expect_tag(page, "data-price", money(desk.get(f"/api/pieces/{at_till['id']}").json()["piece"]["currentPriceCents"]))

    screen_rules(browser, app_url, "/staff/till", who=NOOR, opener=("button", "Sell"), dialog="Sell piece", prepare=find,
                 chosen=("radio", "Cash"),
                 change=lambda: owner.patch(f"/api/pieces/{at_till['id']}", json={"askingPriceCents": 5500}),
                 appears=lambda page: tag_text(page, "data-price") == money(5500))


def test_wf_till_already_sold(browser: Browser, app_url: str) -> None:
    noor = sign_in(app_url, NOOR)
    jules = sign_in(app_url, JULES)
    owner = sign_in(app_url, OWNER)
    c = new_consignor(noor)
    piece = new_piece(noor, c["id"], intake=today(app_url) - timedelta(days=1))
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, NOOR)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
        page.goto(app_url + "/staff/till")
        page.get_by_role("textbox", name="Tag code").fill(piece["tagCode"])
        click(page.get_by_role("button", name="Find piece"))
        click(page.get_by_role("button", name="Sell", exact=True))
        dialog = page.get_by_role("dialog", name="Sell piece")
        pick(dialog.get_by_role("radio", name="Cash"))
        with no_refresh(page):
            first = sell(jules, piece["id"])
            click(dialog.get_by_role("button", name="Complete sale"))
        copy = r"Sold by Jules at " + time_re(local(first["soldAt"])) + r"\. Nothing was charged\."
        expect(announcements(page)).to_have_text(exact(copy))
        expect(dialog).to_be_visible()
        expect(page.get_by_role("region", name="Problems")).to_contain_text(re.compile(copy))
        expect(dialog.get_by_role("radio", name="Cash")).to_be_checked()
    month = month_of(local(first["soldAt"]).date())
    assert len([x for x in owner.get("/api/sales", params={"month": month}).json()["lines"] if x["tagCode"] == piece["tagCode"]]) == 1


def test_wf_till_touch(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    with browse(browser, app_url + "/sign-in", size=SIZES["375x812"], reduced_motion="reduce") as page:
        ui_sign_in(page, app_url, NOOR)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
        page.goto(f"{app_url}/staff/pieces/{piece['id']}")
        sell_button = page.get_by_role("button", name="Sell", exact=True)
        assert_bottom_bar(page, sell_button)
        layout(page)
        tap(sell_button)
        dialog = page.get_by_role("dialog", name="Sell piece")
        pick(dialog.get_by_role("radio", name="Card"), touch=True)
        assert_uncovered(page)
        axe(page)
        tap(dialog.get_by_role("button", name="Cancel"))
        advance(page, REDUCED_GONE_MS)
        assert_closed(page, page.get_by_role("dialog", name="Sell piece"), ["Complete sale"])
        tap(sell_button)
        pick(dialog.get_by_role("radio", name="Cash"), touch=True)
        tap(dialog.get_by_role("button", name="Complete sale"))
        expect(page).to_have_url(path_re(app_url, r"/staff/sales/[0-9a-f-]{36}"))
        layout(page)
    assert desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["status"] == "sold"


def run_file(owner: httpx.Client, month: str) -> tuple[bytes, ET.Element]:
    r = owner.get(f"/api/payout-runs/{month}/file")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml"), r.text[:300]
    return r.content, ET.fromstring(r.content)


_shared_run: dict[str, Any] = {}


def shared_run(app_url: str, mail: Any) -> dict[str, Any]:
    if not _shared_run:
        _, owner, desk, months, store = payout_stage(app_url)
        month = months[0]
        u = tok()
        zoe = new_consignor(desk, name=f"Zoë & Łukasz Ørsted-Hæk {u}", iban=OTHER_VALID_IBANS[0])
        sego = new_consignor(desk, name=f"Ségolène D’Hondt {u}", iban=OTHER_VALID_IBANS[1].lower())
        nobody = new_consignor(desk, name=f"Held Back {u}", iban=None)
        made = {c["id"]: sale_in_month(desk, c["id"], month, asking) for c, asking in ((zoe, 31245), (sego, 2243), (nobody, 5500))}
        r = owner.post("/api/payout-runs", json={"month": month})
        assert r.status_code == 201, r.text
        statements = {c["id"]: mails_to(mail, c["email"]) for c in (zoe, sego, nobody)}
        _shared_run.update(owner=owner, store=store, month=month, u=u, zoe=zoe, sego=sego, nobody=nobody, made=made, statements=statements, run=r.json()["run"])
    return _shared_run


def test_bank_transfer_file(app_url: str, mail: Any) -> None:
    assert sepa_name("Zoë & Łukasz Ørsted-Hæk") == "Zoe Lukasz Orsted-Haek"
    assert sepa_name("Ségolène D’Hondt") == "Segolene D Hondt"
    shared = shared_run(app_url, mail)
    owner, month, u, zoe, sego, nobody, run = (shared[k] for k in ("owner", "month", "u", "zoe", "sego", "nobody", "run"))
    sales = {cid: made[1] for cid, made in shared["made"].items()}
    assert_instants(run)
    assert run["status"] == "ready" and run["msgId"] == f"PAYOUT-{month}" and run["startedBy"]["name"] == "Margaux"
    stored = shared["store"].get(f"payouts/PAYOUT-{month}.xml")
    content, root = run_file(owner, month)
    assert content == stored
    mine = {p["consignorId"]: p for p in run["payouts"] if p["consignorId"] in sales}
    assert mine[zoe["id"]]["status"] == "paid" and mine[zoe["id"]]["amountCents"] == sales[zoe["id"]]["consignorShareCents"]
    assert mine[sego["id"]]["status"] == "paid"
    assert mine[nobody["id"]]["status"] == "held_back" and mine[nobody["id"]]["reason"] == HELD_BACK_REASON
    ordered = sorted(run["payouts"], key=lambda p: (sepa_name(p["consignorName"]), p["consignorId"]))
    assert [p["id"] for p in ordered] == [f"PO-{month}-{i:03d}" for i in range(1, len(ordered) + 1)]
    ns = {"p": PAIN_NS}
    assert root.tag == f"{{{PAIN_NS}}}Document"
    grp = root.find("p:CstmrCdtTrfInitn/p:GrpHdr", ns)
    paid = [p for p in ordered if p["status"] == "paid"]
    total = sum(p["amountCents"] for p in paid)
    assert grp.findtext("p:MsgId", namespaces=ns) == f"PAYOUT-{month}"
    assert INSTANT_RE.match(grp.findtext("p:CreDtTm", namespaces=ns))
    assert grp.findtext("p:NbOfTxs", namespaces=ns) == str(len(paid)) and grp.findtext("p:CtrlSum", namespaces=ns) == euros(total)
    assert grp.findtext("p:InitgPty/p:Nm", namespaces=ns) == SHOP_NAME
    assert run["controlSumCents"] == total
    info = root.findall("p:CstmrCdtTrfInitn/p:PmtInf", ns)
    assert len(info) == 1
    pmt = info[0]
    for path, want in (("p:PmtInfId", f"PAYOUT-{month}"), ("p:PmtMtd", "TRF"), ("p:NbOfTxs", str(len(paid))), ("p:CtrlSum", euros(total)),
                       ("p:PmtTpInf/p:SvcLvl/p:Cd", "SEPA"), ("p:ReqdExctnDt", local(run["startedAt"]).date().isoformat()),
                       ("p:Dbtr/p:Nm", SHOP_NAME), ("p:DbtrAcct/p:Id/p:IBAN", SHOP_IBAN), ("p:DbtrAgt/p:FinInstnId/p:Othr/p:Id", "NOTPROVIDED"), ("p:ChrgBr", "SLEV")):
        assert pmt.findtext(path, namespaces=ns) == want, path
    txs = pmt.findall("p:CdtTrfTxInf", ns)
    assert [tx.findtext("p:PmtId/p:EndToEndId", namespaces=ns) for tx in txs] == [p["id"] for p in paid]
    by_id = {tx.findtext("p:PmtId/p:EndToEndId", namespaces=ns): tx for tx in txs}
    for c, iban in ((zoe, OTHER_VALID_IBANS[0]), (sego, OTHER_VALID_IBANS[1])):
        tx = by_id[mine[c["id"]]["id"]]
        amount = tx.find("p:Amt/p:InstdAmt", ns)
        assert amount.get("Ccy") == "EUR" and amount.text == euros(mine[c["id"]]["amountCents"])
        assert tx.findtext("p:Cdtr/p:Nm", namespaces=ns) == sepa_name(c["name"])
        assert tx.findtext("p:CdtrAcct/p:Id/p:IBAN", namespaces=ns) == iban.replace(" ", "").upper()
        assert tx.findtext("p:RmtInf/p:Ustrd", namespaces=ns) == f"Consignment payout {month_label(month)}"
    assert tx_names_ok(txs, ns, u)
    assert mine[nobody["id"]]["id"] not in by_id


def tx_names_ok(txs: list[ET.Element], ns: dict, u: str) -> bool:
    names = [tx.findtext("p:Cdtr/p:Nm", namespaces=ns) for tx in txs if u in (tx.findtext("p:Cdtr/p:Nm", namespaces=ns) or "")]
    return names and all(set(n) <= SEPA_KEEP and len(n) <= 70 for n in names)


def test_one_payout_run_per_month(app_url: str, mail: Any) -> None:
    base, first, desk, months, store = payout_stage(app_url)
    owners = [first, sign_in(base, OWNER)]
    t = today(base)
    month = months[0]
    c = new_consignor(desk, iban=OTHER_VALID_IBANS[2])
    sale_in_month(desk, c["id"], month)
    barrier = threading.Barrier(2)

    def start(o: httpx.Client) -> httpx.Response:
        barrier.wait()
        return o.post("/api/payout-runs", json={"month": month})

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(start, owners))
    assert sorted(r.status_code for r in results) == [200, 201], [r.text for r in results]
    runs = [r.json()["run"] for r in results]
    assert runs[0]["startedAt"] == runs[1]["startedAt"] and all(run["startedBy"]["name"] == "Margaux" for run in runs)
    third = owners[0].post("/api/payout-runs", json={"month": month})
    assert third.status_code == 200 and third.json()["run"]["startedAt"] == runs[0]["startedAt"]
    statements = [m for m in mails_to(mail, c["email"]) if month_label(month) in m["Subject"]]
    assert len(statements) == 1
    assert store.keys(f"payouts/PAYOUT-{month}.xml") == [f"payouts/PAYOUT-{month}.xml"]
    assert_error(owners[0].post("/api/payout-runs", json={"month": month_of(t)}), 409, "month_not_ended")
    assert_error(owners[0].post("/api/payout-runs", json={"month": "2026-13"}), 422, "validation_failed")
    _, quiet_owner, quiet_desk, quiet_months, _ = payout_stage(app_url, quiet=True)
    empty = quiet_months[0]
    lonely = new_consignor(quiet_desk, iban=None)
    sale_in_month(quiet_desk, lonely["id"], empty)
    err = assert_error(quiet_owner.post("/api/payout-runs", json={"month": empty}), 409, "nothing_due")
    assert err["message"] == f"There is nothing to pay for {month_label(empty)}."
    assert_error(quiet_owner.get(f"/api/payout-runs/{empty}"), 404, "not_found")
    no_mail_to(mail, lonely["email"])


def test_payout_run_all_or_nothing(app_url: str, mail: Any) -> None:
    shared = shared_run(app_url, mail)
    assert shared["run"]["status"] == "ready"
    assert shared["store"].keys(f"payouts/PAYOUT-{shared['month']}.xml"), "Ready before MinIO held the file"
    assert INSTANT_RE.match(shared["run"]["readyAt"])
    copies = (("APP_STORAGE_DOWN_URL", "storage_unavailable", "The payout run didn't start: the bank file can't be stored right now. Nothing was paid or sent."),
              ("APP_MAIL_DOWN_URL", "mail_unavailable", "The payout run didn't start: statements can't be sent by mail right now. Nothing was paid or sent."))
    for env, code, copy in copies:
        base = outage_url(env)
        o, d = sign_in(base, OWNER), sign_in(base, NOOR)
        m = months_back(today(base), 1)
        dc = new_consignor(d)
        sale_in_month(d, dc["id"], m)
        for _ in range(2):
            assert assert_error(o.post("/api/payout-runs", json={"month": m}), 503, code)["message"] == copy
        assert_error(o.get(f"/api/payout-runs/{m}"), 404, "not_found")
        assert m not in [run["month"] for run in o.get("/api/payout-runs").json()["runs"]]
        no_mail_to(mail, dc["email"])
        if env == "APP_MAIL_DOWN_URL":
            assert S3("-mail").keys(f"payouts/PAYOUT-{m}.xml") == []


def test_monthly_statements(app_url: str, mail: Any) -> None:
    shared = shared_run(app_url, mail)
    month, made = shared["month"], shared["made"]
    a, b, h = shared["zoe"], shared["sego"], shared["nobody"]
    for c, iban in ((a, OTHER_VALID_IBANS[0]), (b, OTHER_VALID_IBANS[1]), (h, None)):
        msgs = [m for m in shared["statements"][c["id"]] if m["Subject"] == f"Your Atelier Ourlet statement for {month_label(month)}"]
        assert len(msgs) == 1
        body = text(msgs[0])
        piece, sale = made[c["id"]]
        assert piece["tagCode"] in body and piece["description"] in body and money(sale["consignorShareCents"]) in body
        if iban:
            assert f"Paid to the account ending {iban[-4:]}" in body
            assert iban.replace(" ", "") not in body.replace(" ", "")
        else:
            assert HELD_BACK_REASON in body
        for other in (a, b, h):
            if other is not c:
                assert other["name"] not in body and made[other["id"]][0]["tagCode"] not in body
        assert money(sale["commissionCents"]) not in body or sale["commissionCents"] == sale["consignorShareCents"]


def test_wf_payout_runs_keyboard(browser: Browser, app_url: str, mail: Any) -> None:
    base, owner, desk, (month, raced), store = payout_stage(app_url, 2)
    paid = new_consignor(desk)
    held_back = new_consignor(desk, iban=None)
    sale_in_month(desk, paid["id"], month)
    sale_in_month(desk, held_back["id"], month)
    sale_in_month(desk, new_consignor(desk)["id"], raced)
    with browse(browser, base + "/sign-in") as page:
        ui_sign_in(page, base, OWNER)
        expect(page).to_have_url(path_re(base, "/staff/consignors"))
        page.goto(base + "/staff/payouts")

        def start(which: str, before_press: Callable[[], None] | None = None) -> None:
            opener = page.get_by_role("button", name="Start payout run")
            opener.focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Start payout run")
            box = dialog.get_by_role("combobox", name="Month")
            focused(box)
            select(box, month_label(which))
            dialog.get_by_role("button", name="Start run").focus()
            with reads_working(page, dialog, "**/api/payout-runs", only="POST"):
                if before_press:
                    with no_refresh(page):
                        before_press()
                        page.keyboard.press("Enter")
                else:
                    page.keyboard.press("Enter")

        start(month)
        expect(page).to_have_url(path_re(base, f"/staff/payouts/{month}"))
        heading = page.get_by_role("heading", level=1)
        expect(heading).to_have_text(f"Payout run {month_label(month)}")
        focused(heading)
        expect(announcements(page)).to_have_text(f"Payout run for {month_label(month)} is ready.")
        expect(page.get_by_text("Ready", exact=True).first).to_be_visible()
        expect(page.get_by_role("table", name="Payouts")).to_contain_text(HELD_BACK_REASON)
        href = page.get_by_role("link", name="Download bank file").get_attribute("href")
        assert page.request.get(urljoin(page.url, href)).body() == store.get(f"payouts/PAYOUT-{month}.xml")
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_have_text(f"Payout run {month_label(month)}")
        page.goto(base + "/staff/payouts")
        other: dict[str, Any] = {}

        def race() -> None:
            r = owner.post("/api/payout-runs", json={"month": raced})
            assert r.status_code == 201, r.text
            other.update(r.json()["run"])

        start(raced, race)
        expect(announcements(page)).to_have_text(exact(r"This payout run was already started by Margaux at " + datetime_re(other["startedAt"]) + r"\."))
    assert len([m for m in mails_to(mail, paid["email"]) if month_label(month) in m["Subject"]]) == 1
    assert_error(sign_in(base, INES).post("/api/payout-runs", json={"month": "bad"}), 403, "forbidden")
    assert_instants(owner.get("/api/payout-runs").json())
    screen_base, screen_owner, screen_desk, screen_months, _ = payout_stage(app_url)
    behind = screen_months[0]
    sale_in_month(screen_desk, new_consignor(screen_desk)["id"], behind)

    def start_behind() -> None:
        r = screen_owner.post("/api/payout-runs", json={"month": behind})
        assert r.status_code == 201, r.text

    screen_rules(browser, screen_base, "/staff/payouts", who=OWNER, opener=("button", "Start payout run"), dialog="Start payout run",
                 change=start_behind, appears=lambda page: table_has(page, month_label(behind)))


def test_wf_payout_runs_outages(browser: Browser) -> None:
    for env, copy in (("APP_STORAGE_DOWN_URL", "The payout run didn't start: the bank file can't be stored right now. Nothing was paid or sent."),
                      ("APP_MAIL_DOWN_URL", "The payout run didn't start: statements can't be sent by mail right now. Nothing was paid or sent.")):
        base = outage_url(env)
        owner, desk = sign_in(base, OWNER), sign_in(base, NOOR)
        month = months_back(today(base), 1)
        sale_in_month(desk, new_consignor(desk)["id"], month)
        with browse(browser, base + "/sign-in") as page:
            ui_sign_in(page, base, OWNER)
            expect(page).to_have_url(path_re(base, "/staff/consignors"))
            page.goto(base + "/staff/payouts")
            click(page.get_by_role("button", name="Start payout run"))
            dialog = page.get_by_role("dialog", name="Start payout run")
            select(dialog.get_by_role("combobox", name="Month"), month_label(month))
            click(dialog.get_by_role("button", name="Start run"))
            expect(announcements(page)).to_have_text(copy)
            after_refresh(page)
            expect(announcements(page)).to_have_text(copy)
        assert_error(owner.get(f"/api/payout-runs/{month}"), 404, "not_found")


def test_consignor_page_only_own(app_url: str, mail: Any) -> None:
    desk = sign_in(app_url, NOOR)
    t = today(app_url)
    a = new_consignor(desk, iban=OTHER_VALID_IBANS[0])
    b = new_consignor(desk)
    mine = new_piece(desk, a["id"], intake=t - timedelta(days=80))
    sold = new_piece(desk, a["id"], intake=t - timedelta(days=5), asking=31245)
    theirs = new_piece(desk, b["id"], intake=t - timedelta(days=80))
    shopper_name, shopper_email = f"Shopper {tok()}", fresh("shopper")[1]
    assert public_hold(app_url, mine["id"], shopper_name, shopper_email).status_code == 201
    sale = sell(desk, sold["id"])
    token = portal_token(desk, mail, a)
    r = client(app_url).get(f"/api/portal/{token}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert_camel(body)
    assert_instants(body)
    assert body["consignor"]["name"] == a["name"] and body["consignor"]["ibanLast4"] == OTHER_VALID_IBANS[0][-4:] and body["consignor"]["ibanValid"] is True
    assert {p["id"] for p in body["pieces"]} == {mine["id"], sold["id"]}
    sold_row = next(p for p in body["pieces"] if p["id"] == sold["id"])
    assert sold_row["shareCents"] == sale["consignorShareCents"] and sold_row["currentPriceCents"] is None and sold_row["previousPriceCents"] is None
    assert all(s["priceCents"] is None for s in sold_row["stations"])
    month = month_of(local(sale["soldAt"]).date())
    assert {"month": month, "shareCents": sale["consignorShareCents"]} in body["earnings"]
    keys = {k for k, _ in walk(body) if k}
    assert not keys & {"commissionCents", "vatCents", "salePriceCents", "shopperName", "shopperEmail", "iban"}
    for leak in (shopper_name, shopper_email, b["name"], b["email"], theirs["id"], OTHER_VALID_IBANS[0].replace(" ", "")):
        assert leak not in r.text, leak
    numbers = [v for _, v in walk(body) if isinstance(v, int) and not isinstance(v, bool)]
    assert sale["commissionCents"] not in numbers and sale["vatCents"] not in numbers, numbers
    assert_error(client(app_url).get(f"/api/portal/{token}/pieces/{theirs['id']}"), 404, "not_found")
    one = client(app_url).get(f"/api/portal/{token}/pieces/{mine['id']}")
    assert one.status_code == 200 and shopper_email not in one.text
    mixed = {"choices": [{"pieceId": mine["id"], "choice": "return"}, {"pieceId": theirs["id"], "choice": "donate"}]}
    assert_error(client(app_url).put(f"/api/portal/{token}/choices", json=mixed), 404, "not_found")
    assert desk.get(f"/api/pieces/{mine['id']}").json()["piece"]["choice"] is None
    assert desk.get(f"/api/pieces/{theirs['id']}").json()["piece"]["choice"] is None


def test_consignor_page_address(mail: Any) -> None:
    short = outage_url("APP_SHORT_URL")
    desk, owner = sign_in(short, NOOR), sign_in(short, OWNER)
    c = new_consignor(desk)
    sent = desk.post(f"/api/consignors/{c['id']}/portal-link")
    assert sent.status_code == 201
    ends = parse_z(sent.json()["pageEndsAt"])
    assert abs((ends - server_now(short)).total_seconds() - SHORT_SECONDS) <= 2
    msgs = mails_to(mail, c["email"])
    assert msgs[0]["Subject"] == "Your Atelier Ourlet consignor page"
    first = link_path(msgs[0], "/c/").rsplit("/", 1)[1]
    assert client(short).get(f"/api/portal/{first}").status_code == 200
    second = portal_token(desk, mail, c, count=2)
    assert second != first
    assert_error(client(short).get(f"/api/portal/{first}"), 410, "page_ended")
    assert client(short).get(f"/api/portal/{second}").status_code == 200
    assert_error(desk.delete(f"/api/consignors/{c['id']}/portal-link"), 403, "forbidden")
    assert owner.delete(f"/api/consignors/{c['id']}/portal-link").status_code == 204
    assert_error(client(short).get(f"/api/portal/{second}"), 410, "page_ended")
    third = portal_token(desk, mail, c, count=3)
    assert client(short).get(f"/api/portal/{third}").status_code == 200
    poll(lambda: client(short).get(f"/api/portal/{third}").status_code == 410, "the page to expire", seconds=SHORT_SECONDS + 15)
    assert_error(client(short).put(f"/api/portal/{third}/choices", json={"choices": []}), 410, "page_ended")
    assert_error(client(short).get(f"/api/portal/{tok()}"), 404, "not_found")


def test_return_or_donate_window(app_url: str, mail: Any) -> None:
    desk, owner = sign_in(app_url, NOOR), sign_in(app_url, OWNER)
    t = today(app_url)
    all_ladders = ladders(owner)
    end = ladder_on(all_ladders, t - timedelta(days=80))["periodEndDay"]
    c = new_consignor(desk)
    opened = new_piece(desk, c["id"], intake=t - timedelta(days=end - CHOICE_DAYS))
    closed = new_piece(desk, c["id"], intake=t - timedelta(days=end - CHOICE_DAYS - 1))
    sold = new_piece(desk, c["id"], intake=t - timedelta(days=end - CHOICE_DAYS))
    sell(desk, sold["id"])
    lad = ladder_by_id(all_ladders, opened["ladderId"])
    intake = date.fromisoformat(opened["intakeDate"])
    assert opened["choiceOpensAt"] == midnight(intake + timedelta(days=lad["periodEndDay"] - CHOICE_DAYS))
    assert opened["choiceClosesAt"] == midnight(intake + timedelta(days=lad["periodEndDay"]))
    token = portal_token(desk, mail, c)
    put = lambda body: client(app_url).put(f"/api/portal/{token}/choices", json={"choices": body})
    for other in (closed, sold):
        err = assert_error(put([{"pieceId": opened["id"], "choice": "return"}, {"pieceId": other["id"], "choice": "return"}]), 409, "choice_closed")
        assert err["message"] == f"The choice for {other['tagCode']} is closed."
    assert desk.get(f"/api/pieces/{opened['id']}").json()["piece"]["choice"] is None
    assert_error(put([{"pieceId": opened["id"], "choice": "maybe"}]), 422, "validation_failed")
    ok = put([{"pieceId": opened["id"], "choice": "return"}])
    assert ok.status_code == 200 and next(p for p in ok.json()["pieces"] if p["id"] == opened["id"])["choice"] == "return"
    assert put([{"pieceId": opened["id"], "choice": "donate"}]).status_code == 200
    assert desk.get(f"/api/pieces/{opened['id']}").json()["piece"]["choice"] == "donate"


def test_wf_consignor_page_touch(browser: Browser, app_url: str, mail: Any) -> None:
    desk = sign_in(app_url, NOOR)
    t = today(app_url)
    c = new_consignor(desk, iban=OTHER_VALID_IBANS[1])
    piece = new_piece(desk, c["id"], intake=t - timedelta(days=80))
    sold = new_piece(desk, c["id"], intake=t - timedelta(days=10))
    sale = sell(desk, sold["id"])
    token = portal_token(desk, mail, c)
    with browse(browser, f"{app_url}/c/{token}", size=SIZES["375x812"]) as page:
        expect(page.get_by_text(f"Paid to the account ending {OTHER_VALID_IBANS[1][-4:]}")).to_be_visible()
        expect(page.get_by_role("table", name="Earnings by month")).to_contain_text(money(sale["consignorShareCents"]))
        expect(page.get_by_text(money(sale["consignorShareCents"])).first).to_be_visible()
        poll(lambda: tag_count(page) == 1, "exactly one tag, on the unsold piece", seconds=UI_TIMEOUT_MS / 1000)
        save = page.get_by_role("button", name="Save choices")
        assert_bottom_bar(page, save)
        group = page.get_by_role("radiogroup", name=f"{piece['tagCode']}: at the end of its period")
        pick(group.get_by_role("radio", name="Return to me"), touch=True)
        assert_uncovered(page)
        expect(group.get_by_role("radio", name="Return to me")).to_be_checked()
        layout(page)
        axe(page)
        with reads_working(page, page, "**/api/portal/*/choices"):
            tap(save)
        expect(announcements(page)).to_have_text("Choices saved.")
        focused(save)
    assert desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["choice"] == "return"
    owner = sign_in(app_url, OWNER)
    junk = tok()
    assert_error(client(app_url).put(f"/api/portal/{junk}/choices", content=b"{bad", headers={"Content-Type": "application/json"}), 404, "not_found")
    assert_instants(client(app_url).get(f"/api/portal/{token}").json())

    changed = money(price_on_day(ladder_by_id(ladders(owner), piece["ladderId"]), 2600, 80))
    screen_rules(browser, app_url, f"/c/{token}", ring=("button", "Save choices"), chosen=("radio", "Donate"),
                 within=("radiogroup", f"{piece['tagCode']}: at the end of its period"),
                 change=lambda: owner.patch(f"/api/pieces/{piece['id']}", json={"askingPriceCents": 2600}),
                 appears=lambda page: changed in page_text(page))


def test_wf_consignor_page_keyboard_clock(browser: Browser, app_url: str, mail: Any) -> None:
    desk, owner = sign_in(app_url, NOOR), sign_in(app_url, OWNER)
    c = new_consignor(desk)
    now = server_now(app_url).astimezone(BRUSSELS)
    last_day = (now + timedelta(minutes=MIDNIGHT_MARGIN_MINUTES)).date()
    all_ladders = ladders(owner)
    end = next(lad["periodEndDay"] for lad in all_ladders if ladder_on(all_ladders, last_day - timedelta(days=lad["periodEndDay"] - 1)) is lad)
    piece = new_piece(desk, c["id"], intake=last_day - timedelta(days=end - 1))
    token = portal_token(desk, mail, c)
    api = client(app_url).get(f"/api/portal/{token}/pieces/{piece['id']}").json()["piece"]
    with browse(browser, f"{app_url}/c/{token}", reduced_motion="reduce") as page:
        page.add_init_script(RECORDER)
        page.clock.set_system_time(server_now(app_url) + timedelta(hours=26))
        page.reload()
        station = next(s["label"] for s in api["stations"] if s["station"] == api["station"]).lower()
        eventually(page, lambda: station in page_text(page).lower(), "the piece's station on the consignor page")
        expect_tag(page, "data-price", money(api["currentPriceCents"]))
        choice = page.get_by_role("radiogroup", name=f"{piece['tagCode']}: at the end of its period")
        expect(choice).to_have_count(1)
        donate = choice.get_by_role("radio", name="Donate")
        tab_to(page, page.get_by_role("radio", name="Return to me"))
        page.keyboard.press("ArrowDown")
        expect(donate).to_be_checked()
        save = page.get_by_role("button", name="Save choices")
        tab_to(page, save)
        page.keyboard.press("Enter")
        expect(announcements(page)).to_have_text("Choices saved.")
        motion_log(page)
        assert owner.patch(f"/api/pieces/{piece['id']}", json={"askingPriceCents": 4000}).status_code == 200
        new_price = client(app_url).get(f"/api/portal/{token}/pieces/{piece['id']}").json()["piece"]["currentPriceCents"]
        after_refresh(page)
        expect_tag(page, "data-price", money(new_price))
        advance(page, REDUCED_GONE_MS)
        assert all(e["duration"] < REDUCED_GONE_MS for e in motion_log(page) if e["inTag"])
    assert desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["choice"] == "donate"


def test_wf_consignor_page_ended(browser: Browser, mail: Any) -> None:
    short = outage_url("APP_SHORT_URL")
    desk = sign_in(short, NOOR)
    c = new_consignor(desk)
    token = portal_token(desk, mail, c)
    poll(lambda: client(short).get(f"/api/portal/{token}").status_code == 410, "the page to expire", seconds=SHORT_SECONDS + 15)
    with browse(browser, f"{short}/c/{token}", size=SIZES["375x812"]) as page:
        expect(page.get_by_role("heading", name="This page has ended. Ask the shop for a new link.")).to_be_visible()


def assert_slot(slot: dict) -> None:
    start, end = local(slot["startsAt"]), local(slot["endsAt"])
    assert start.weekday() in (1, 2, 3, 4, 5), slot
    assert FIRST_SLOT <= (start.hour, start.minute) <= LAST_SLOT and start.minute % SLOT_MINUTES == 0, slot
    assert (parse_z(slot["endsAt"]) - parse_z(slot["startsAt"])).total_seconds() == SLOT_MINUTES * 60 and end.date() == start.date()


def test_slots_in_brussels_time(app_url: str) -> None:
    pub = client(app_url)
    t = today(app_url)
    tomorrow = t + timedelta(days=1)
    first = pub.get("/api/appointment-slots").json()
    assert date.fromisoformat(first["weekStart"]) == tomorrow - timedelta(days=tomorrow.weekday())
    assert first["previousWeek"] is None and first["nextWeek"] == (date.fromisoformat(first["weekStart"]) + timedelta(days=7)).isoformat()
    for s in first["slots"]:
        assert_slot(s)
        assert parse_z(s["startsAt"]) >= parse_z(midnight(tomorrow))
    assert_instants(first)
    range_end = tomorrow + timedelta(days=SLOT_RANGE_DAYS)
    changes = []
    for year in (t.year, t.year + 1):
        for month_no in (3, 10):
            last = date(year, month_no, 31)
            sunday = last - timedelta(days=(last.weekday() - 6) % 7)
            if sunday - timedelta(days=1) >= tomorrow and sunday + timedelta(days=2) < range_end:
                changes.append(sunday)
    assert changes, "no clock change inside the bookable range"
    for sunday in changes:
        saturday, tuesday = sunday - timedelta(days=1), sunday + timedelta(days=2)
        expected = {saturday: brussels_at(saturday, *FIRST_SLOT), tuesday: brussels_at(tuesday, *FIRST_SLOT)}
        assert parse_z(expected[saturday]).hour != parse_z(expected[tuesday]).hour
        if sunday == date(2027, 3, 28):
            assert (expected[saturday], expected[tuesday]) == ("2027-03-27T09:00:00Z", "2027-03-30T08:00:00Z")
        for monday, day in ((sunday - timedelta(days=6), saturday), (sunday + timedelta(days=1), tuesday)):
            slots = week_slots(app_url, monday)
            assert expected[day] in [s["startsAt"] for s in slots], day
            per_day: dict[date, int] = {}
            for s in slots:
                assert_slot(s)
                per_day[local(s["startsAt"]).date()] = per_day.get(local(s["startsAt"]).date(), 0) + 1
            assert {d.weekday() for d in per_day} <= {1, 2, 3, 4, 5} and set(per_day.values()) == {24}
    assert "week" in assert_error(pub.get("/api/appointment-slots", params={"week": (date(2027, 3, 29) + timedelta(days=1)).isoformat()}), 422, "validation_failed")["fields"]
    week, last = date.fromisoformat(first["weekStart"]), None
    for _ in range(40):
        data = pub.get("/api/appointment-slots", params={"week": week.isoformat()}).json()
        last = data
        if data["nextWeek"] is None:
            break
        week = date.fromisoformat(data["nextWeek"])
    assert last and last["nextWeek"] is None
    limit = parse_z(midnight(tomorrow + timedelta(days=SLOT_RANGE_DAYS)))
    assert all(parse_z(s["startsAt"]) < limit for s in last["slots"])
    assert_error(pub.get("/api/appointment-slots", params={"week": (week + timedelta(days=7)).isoformat()}), 422, "validation_failed")
    err = assert_error(book(app_url, brussels_at(date(2027, 3, 30), 10, 10), fresh("booker")[1]), 422, "validation_failed")
    assert "startsAt" in err["fields"]


def test_one_booking_per_slot(app_url: str, mail: Any) -> None:
    week, slot, following = slot_pair(app_url, range(10, 13))
    emails = [fresh("booker")[1] for _ in range(4)]
    barrier = threading.Barrier(len(emails))

    def attempt(email: str) -> httpx.Response:
        barrier.wait()
        return book(app_url, slot["startsAt"], email)

    with ThreadPoolExecutor(len(emails)) as pool:
        results = list(pool.map(attempt, emails))
    assert [r.status_code for r in results].count(201) == 1, [r.text for r in results]
    for r in results:
        if r.status_code != 201:
            err = assert_error(r, 409, "slot_taken")
            assert re.match(r"^That slot was just taken\. The next free slot is " + datetime_re(following["startsAt"]) + r"\.$", err["message"]), err["message"]
    assert not next(s for s in week_slots(app_url, week) if s["startsAt"] == slot["startsAt"])["free"]
    winner = emails[[r.status_code for r in results].index(201)]
    assert len(mails_to(mail, winner)) == 1
    for e in emails:
        if e != winner:
            no_mail_to(mail, e)


def test_booking_limit(mail: Any) -> None:
    short = outage_url("APP_SHORT_URL")
    _, email = fresh("booker")
    monday = first_monday(short)
    free = [s for k in range(2, 6) for s in week_slots(short, monday + timedelta(days=7 * k)) if s["free"]]
    for i, variant in enumerate((email, email.upper(), email[:1].upper() + email[1:])):
        assert book(short, free[i]["startsAt"], variant).status_code == 201
    over = book(short, free[3]["startsAt"], email)
    assert_error(over, 429, "rate_limited")
    assert 1 <= int(over.headers["Retry-After"]) <= SHORT_WINDOW_SECONDS
    assert_error(book(short, "2027-03-30T08:10:00Z", email.upper()), 429, "rate_limited")
    cancel = link_path(mails_to(mail, email, 3)[0], "/appointments/cancel/").rsplit("/", 1)[1]
    assert client(short).post(f"/api/appointments/by-token/{cancel}/cancel").status_code == 200
    assert book(short, free[3]["startsAt"], email).status_code == 429
    assert next(s for s in week_slots(short, date.fromisoformat(local(free[3]["startsAt"]).date().isoformat()) - timedelta(days=local(free[3]["startsAt"]).weekday())) if s["startsAt"] == free[3]["startsAt"])["free"]
    assert book(short, free[4]["startsAt"], fresh("booker")[1]).status_code == 201
    poll(lambda: book(short, free[3]["startsAt"], email).status_code == 201, "the window to pass", seconds=SHORT_WINDOW_SECONDS + 15)


def test_booking_confirmation(app_url: str, mail: Any) -> None:
    _, slot, _ = slot_pair(app_url, range(14, 17))
    _, email = fresh("booker")
    r = book(app_url, slot["startsAt"], email)
    assert r.status_code == 201 and r.json()["appointment"]["startsAt"] == slot["startsAt"]
    msgs = mails_to(mail, email)
    assert len(msgs) == 1
    assert re.match("^Your intake appointment on " + datetime_re(slot["startsAt"]) + "$", msgs[0]["Subject"])
    body = text(msgs[0])
    assert re.search(datetime_re(slot["startsAt"]), body) and SHOP_ADDRESS in body
    token = link_path(msgs[0], "/appointments/cancel/").rsplit("/", 1)[1]
    assert client(app_url).get(f"/api/appointments/by-token/{token}").json()["appointment"]["startsAt"] == slot["startsAt"]
    done = client(app_url).post(f"/api/appointments/by-token/{token}/cancel")
    assert done.status_code == 200 and done.json()["appointment"]["status"] == "cancelled"
    assert_error(client(app_url).post(f"/api/appointments/by-token/{token}/cancel"), 409, "already_cancelled")
    monday = local(slot["startsAt"]).date() - timedelta(days=local(slot["startsAt"]).weekday())
    assert next(s for s in week_slots(app_url, monday) if s["startsAt"] == slot["startsAt"])["free"]
    down = outage_url("APP_MAIL_DOWN_URL")
    _, dslot, _ = slot_pair(down, range(14, 17))
    _, demail = fresh("booker")
    err = assert_error(book(down, dslot["startsAt"], demail), 503, "mail_unavailable")
    assert err["message"] == "We can't send your confirmation right now. Nothing was saved — try again in a moment."
    dmonday = local(dslot["startsAt"]).date() - timedelta(days=local(dslot["startsAt"]).weekday())
    assert next(s for s in week_slots(down, dmonday) if s["startsAt"] == dslot["startsAt"])["free"]


def appointment_flow(page: Page, slot: dict, email: str, use_tap: bool, pending: bool = False,
                     lost_to: Callable[[], None] | None = None) -> Locator:
    press = tap if use_tap else click
    press(page.get_by_role("button", name=re.compile("^" + datetime_re(slot["startsAt"]) + "$")))
    press(page.get_by_role("button", name="Book slot"))
    dialog = page.get_by_role("dialog", name="Book slot")
    dialog.get_by_role("textbox", name="Your name").fill("Amélie Kint")
    dialog.get_by_role("textbox", name="Email").fill(email)
    if pending:
        with reads_working(page, dialog, "**/api/appointments"):
            press(dialog.get_by_role("button", name="Confirm booking"))
    elif lost_to:
        with no_refresh(page):
            lost_to()
            press(dialog.get_by_role("button", name="Confirm booking"))
    else:
        press(dialog.get_by_role("button", name="Confirm booking"))
    return dialog


def test_wf_intake_appointments_touch(browser: Browser, app_url: str, mail: Any) -> None:
    week, slot, _ = slot_pair(app_url, range(18, 21))
    _, email = fresh("booker")
    with browse(browser, f"{app_url}/appointments?week={week.isoformat()}", size=SIZES["375x812"]) as page:
        heading = page.get_by_role("heading", name=re.compile("^Week of " + date_re(week) + "$"))
        expect(heading).to_be_visible()
        expect(page.get_by_role("group", name=re.compile("^" + date_re(week + timedelta(days=1)) + "$"))).to_be_visible()
        layout(page)
        axe(page)
        appointment_flow(page, slot, email, use_tap=True, pending=True)
        expect(announcements(page)).to_have_text(exact(r"Booked for " + datetime_re(slot["startsAt"]) + r"\. The confirmation is on its way by mail\."))
        focused(heading)
        click(page.get_by_role("button", name="Next week"))
        expect(page).to_have_url(re.compile(r"week=" + (week + timedelta(days=7)).isoformat()))
    assert not next(s for s in week_slots(app_url, week) if s["startsAt"] == slot["startsAt"])["free"]
    assert len(mails_to(mail, email)) == 1
    oversized = client(app_url).post("/api/appointments", content=b"x" * (JSON_LIMIT + 1), headers={"Content-Type": "text/plain"})
    assert_error(oversized, 413, "payload_too_large")
    assert_instants(client(app_url).get("/api/appointment-slots").json())
    sr_week, sr_slot, sr_next = slot_pair(app_url, range(26, 29))

    def choose_slot(page: Page) -> None:
        click(page.get_by_role("button", name=re.compile("^" + datetime_re(sr_slot["startsAt"]) + "$")))

    screen_rules(browser, app_url, f"/appointments?week={sr_week.isoformat()}", opener=("button", "Book slot"), dialog="Book slot",
                 prepare=choose_slot, typed=("textbox", "Your name"),
                 change=lambda: book(app_url, sr_next["startsAt"], fresh("booker")[1]),
                 appears=lambda page: slot_taken(page, sr_next["startsAt"]))


def test_wf_intake_appointments_slot_taken(browser: Browser, app_url: str) -> None:
    week, slot, following = slot_pair(app_url, range(22, 25))
    with browse(browser, f"{app_url}/appointments?week={week.isoformat()}") as page:
        expect(page.get_by_role("heading", name=re.compile("^Week of "))).to_be_visible()

        def taken() -> None:
            assert book(app_url, slot["startsAt"], fresh("booker")[1]).status_code == 201

        appointment_flow(page, slot, fresh("booker")[1], use_tap=False, lost_to=taken)
        expect(announcements(page)).to_have_text(exact(r"That slot was just taken\. The next free slot is " + datetime_re(following["startsAt"]) + r"\."))


def test_wf_intake_appointments_mail_down(browser: Browser) -> None:
    down = outage_url("APP_MAIL_DOWN_URL")
    week, slot, _ = slot_pair(down, range(18, 21))
    with browse(browser, f"{down}/appointments?week={week.isoformat()}") as page:
        appointment_flow(page, slot, fresh("booker")[1], use_tap=False)
        expect(announcements(page)).to_have_text("We can't send your confirmation right now. Nothing was saved — try again in a moment.")
    assert next(s for s in week_slots(down, week) if s["startsAt"] == slot["startsAt"])["free"]


def test_spreadsheet_matching(app_url: str) -> None:
    owner, desk = sign_in(app_url, OWNER), sign_in(app_url, NOOR)
    t = today(app_url)
    u = tok()
    existing = new_consignor(desk)
    new_name, new_email = f"Amélie Kint {u}", fresh("import")[1]
    brand = f"Import {u}"
    rows = [
        import_row(f"{u}-1", "Someone Else", existing["email"].upper(), brand, intake=t - timedelta(days=10)),
        import_row(f"{u}-2", new_name, new_email, brand, intake=t - timedelta(days=10)),
        import_row(f"{u}-3", f"AMELIE-KINT  {u.upper()}", "", brand, intake=t - timedelta(days=10)),
        import_row(f"{u}-4", f"Other {u}", fresh("import")[1], "", intake=t - timedelta(days=10)),
        import_row(f"{u}-2", new_name, new_email, brand, intake=t - timedelta(days=10)),
        import_row(f"{u}-5", f"Third {u}", fresh("import")[1], brand, iban=INVALID_IBAN, intake=t - timedelta(days=10)),
        import_row(f"{u}-6", f"Short {u}", fresh("import")[1], brand, intake=t - timedelta(days=10))[:11],
        import_row(f"{u}-7", f"Fourth {u}", "not-an-email", brand, intake=t - timedelta(days=10)),
    ]
    r = owner.post("/api/imports/preview", content=sheet(rows), headers={"Content-Type": "text/csv"})
    assert r.status_code == 200, r.text
    result = r.json()
    by_row = {x["row"]: x for x in result["rows"]}
    assert [by_row[i]["status"] for i in range(2, 10)] == ["matched", "new", "matched", "refused", "refused", "refused", "refused", "refused"]
    assert by_row[2]["itemNo"] == f"{u}-1"
    reasons = {5: "Missing brand.", 6: "Item number appears twice in this file.", 7: "IBAN doesn't pass its check.",
               8: "This row has 11 fields; the header has 12.", 9: "Email address isn't valid."}
    for row, reason in reasons.items():
        assert by_row[row]["reason"] == reason
    assert result["counts"] == {"matched": 2, "new": 1, "refused": 5, "already": 0}
    assert new_email not in [c["email"] for c in desk.get("/api/consignors").json()["consignors"]]
    assert [p for p in all_pieces(desk, brand) if p["brand"] == brand] == []
    bad = owner.post("/api/imports/preview", content=b"item,name\r\n1,x\r\n", headers={"Content-Type": "text/csv"})
    assert "file" in assert_error(bad, 422, "validation_failed")["fields"]


def test_spreadsheet_saved_twice(app_url: str) -> None:
    owner, desk = sign_in(app_url, OWNER), sign_in(app_url, NOOR)
    t = today(app_url)
    u = tok()
    brand, email = f"Twice {u}", fresh("import")[1]
    dates = [t - timedelta(days=400), t - timedelta(days=10)]
    data = sheet([import_row(f"{u}-{i}", f"Twice Person {u}", email, brand, intake=d) for i, d in enumerate(dates)])
    post = lambda: owner.post("/api/imports", content=data, headers={"Content-Type": "text/csv"})
    first = post()
    assert first.status_code == 200 and first.json()["piecesCreated"] == 2 and first.json()["consignorsCreated"] == 1, first.text
    second = post()
    assert second.status_code == 200 and second.json()["piecesCreated"] == 0 and second.json()["consignorsCreated"] == 0
    pieces = [p for p in all_pieces(desk, brand) if p["brand"] == brand]
    assert len(pieces) == 2 and sorted(p["intakeDate"] for p in pieces) == sorted(d.isoformat() for d in dates)
    all_ladders = ladders(owner)
    for p in pieces:
        assert_tag(p["tagCode"])
        assert p["ladderId"] == ladder_on(all_ladders, date.fromisoformat(p["intakeDate"]))["id"]
    assert len([c for c in desk.get("/api/consignors").json()["consignors"] if c["email"] == email]) == 1
    preview = owner.post("/api/imports/preview", content=data, headers={"Content-Type": "text/csv"}).json()
    assert preview["counts"]["already"] == 2 and {x["status"] for x in preview["rows"]} == {"already"}


def test_wf_old_spreadsheet_keyboard(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    t = today(app_url)
    u = tok()
    existing = new_consignor(desk)
    brand = f"Sheet {u}"
    data = sheet([import_row(f"{u}-1", existing["name"], existing["email"], brand, intake=t - timedelta(days=5)),
                  import_row(f"{u}-2", f"Brand New {u}", fresh("import")[1], brand, intake=t - timedelta(days=5))])
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, OWNER)
        expect(page).to_have_url(path_re(app_url, "/staff/consignors"))
        page.goto(app_url + "/staff/import")
        page.get_by_label("Spreadsheet file", exact=True).set_input_files(files=[{"name": "old.csv", "mimeType": "text/csv", "buffer": data}])
        dialog = page.get_by_role("dialog", name="Preview import")
        expect(dialog.get_by_role("table", name="Rows")).to_be_visible()
        expect(announcements(page)).to_have_text(fill_n(PREVIEW_COPY, 1, 1, 0, 0))
        assert [p for p in all_pieces(desk, brand) if p["brand"] == brand] == []
        tab_to(page, dialog.get_by_role("button", name="Save"), presses=10)
        with reads_working(page, dialog, "**/api/imports"):
            page.keyboard.press("Enter")
        expect(announcements(page)).to_have_text(fill_n(SAVED_COPY, 2, 1))
        focused(page.get_by_role("button", name="Choose file"))
    assert len([p for p in all_pieces(desk, brand) if p["brand"] == brand]) == 2
    oversized = client(app_url).post("/api/imports/preview", content=b"x" * (SHEET_LIMIT + 1), headers={"Content-Type": "text/csv"})
    assert_error(oversized, 413, "payload_too_large")
    screen_data = sheet([import_row(f"{u}-9", f"Screen Person {u}", fresh("import")[1], f"Screen {u}", intake=t - timedelta(days=5))])

    def open_preview(page: Page) -> None:
        page.get_by_label("Spreadsheet file", exact=True).set_input_files(files=[{"name": "old.csv", "mimeType": "text/csv", "buffer": screen_data}])

    screen_rules(browser, app_url, "/staff/import", who=OWNER, dialog="Preview import", open_dialog=open_preview,
                 ring=("button", "Choose file"))


def test_wf_old_spreadsheet_touch(browser: Browser, app_url: str) -> None:
    u = tok()
    data = sheet([import_row(f"{u}-1", f"Wide Row Person {u}", fresh("import")[1], f"Wide {u}", intake=today(app_url) - timedelta(days=5))])
    with browse(browser, app_url + "/sign-in", size=SIZES["375x812"]) as page:
        ui_sign_in(page, app_url, OWNER)
        expect(page).to_have_url(path_re(app_url, "/staff/consignors"))
        page.goto(app_url + "/staff/import")
        assert_bottom_bar(page, page.get_by_role("button", name="Choose file"))
        page.get_by_label("Spreadsheet file", exact=True).set_input_files(files=[{"name": "old.csv", "mimeType": "text/csv", "buffer": data}])
        frame = page.get_by_role("region", name="Rows table")
        expect(frame).to_be_visible()
        frame.focus()
        focused(frame)
        assert frame.evaluate("e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)"), "the rows frame does not scroll sideways"
        layout(page)
        advance(page, SETTLE_MS)
        axe(page)
        tap(page.get_by_role("dialog", name="Preview import").get_by_role("button", name="Cancel"))
        advance(page, SETTLE_MS)
        assert_closes(page, page.get_by_role("dialog", name="Preview import"), ["Save"])


def test_sales_book_file(app_url: str) -> None:
    owner, desk = sign_in(app_url, OWNER), sign_in(app_url, NOOR)
    email, password, _ = new_member(owner, "bookkeeper")
    books = sign_in(app_url, (email, password))
    c = new_consignor(desk)
    u = tok()
    t = today(app_url)
    risky = [f"=SUM(A1) {u}", f"+cmd {u}", f"-1 {u}", f"@at {u}", f"\tTab {u}"]
    sales = [sell(desk, new_piece(desk, c["id"], intake=t - timedelta(days=1), description=d, asking=1990 + i)["id"]) for i, d in enumerate(risky)]
    refunded = sell(desk, new_piece(desk, c["id"], intake=t - timedelta(days=1), description=f"Refunded {u}")["id"])
    assert desk.post(f"/api/sales/{refunded['id']}/refund").status_code == 200
    month = month_of(local(sales[0]["soldAt"]).date())
    r = books.get("/api/sales-book", params={"month": month})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].lower().replace(" ", "") == "text/csv; charset=utf-8".replace(" ", "")
    disposition = r.headers["content-disposition"]
    assert disposition.startswith("attachment") and f"sales-book-{month}.csv" in disposition
    raw = r.content
    assert not raw.startswith(b"\xef\xbb\xbf") and raw.endswith(b"\r\n")
    lines = raw.decode("utf-8").split("\r\n")[:-1]
    assert lines[0] == BOOK_HEADER
    assert all(re.match(r'^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$', line) for line in lines), "a field is not quoted"
    records = list(csv.reader(io.StringIO(raw.decode("utf-8"), newline="")))
    body, total = records[1:-1], records[-1]
    assert total[:3] == ["Total", "", ""]
    for col in range(3, 7):
        assert Decimal(total[col]) == sum(Decimal(row[col]) for row in body)
    for sale, desc in zip(sales, risky):
        row = next(x for x in body if x[1] == sale["tagCode"])
        assert row[0] == local(sale["soldAt"]).strftime("%Y-%m-%d %H:%M")
        stored = desk.get(f"/api/pieces/{sale['pieceId']}").json()["piece"]["description"]
        assert stored.strip() == desc.strip()
        assert row[2] == ("'" + stored if stored[:1] in ("=", "+", "-", "@", "\t", "\r") else stored)
        assert row[3:] == [euros(sale["priceCents"]), euros(sale["consignorShareCents"]), euros(sale["commissionCents"]), euros(sale["vatCents"])]
    assert refunded["tagCode"] not in raw.decode("utf-8")
    assert [row[0] for row in body] == sorted(row[0] for row in body)


def test_bookkeeper_access_and_limit(app_url: str) -> None:
    owner, desk = sign_in(app_url, OWNER), sign_in(app_url, NOOR)
    email, password, _ = new_member(owner, "bookkeeper")
    books = sign_in(app_url, (email, password))
    month = month_of(today(app_url))
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url))
    assert books.get("/api/sales", params={"month": month}).status_code == 200
    assert books.get("/api/payout-runs").status_code == 200
    for method, path, body in (("POST", "/api/pieces", {"consignorId": c["id"]}), ("POST", "/api/sales", {"pieceId": piece["id"], "payment": "card"}),
                               ("PATCH", f"/api/consignors/{c['id']}", {"name": "x"}), ("POST", "/api/consignors", {"name": "x"}),
                               ("POST", "/api/payout-runs", {"month": "2026-03"}), ("POST", f"/api/pieces/{piece['id']}/archive", {})):
        assert_error(books.request(method, path, json=body), 403, "forbidden")
    assert desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["status"] == "on_rail"
    for _ in range(DOWNLOADS_PER_WINDOW):
        assert books.get("/api/sales-book", params={"month": month}).status_code == 200
    over = books.get("/api/sales-book", params={"month": month})
    err = assert_error(over, 429, "rate_limited")
    assert err["message"] == "You've downloaded the sales book 5 times in a short while. Try again in a moment."
    assert int(over.headers["Retry-After"]) >= 1
    assert_error(books.get("/api/sales-book", params={"month": "bad"}), 429, "rate_limited")
    other_email, other_password, _ = new_member(owner, "bookkeeper")
    assert sign_in(app_url, (other_email, other_password)).get("/api/sales-book", params={"month": month}).status_code == 200
    assert books.delete("/api/session").status_code == 204


def test_wf_sales_book_keyboard(browser: Browser, app_url: str) -> None:
    owner, desk = sign_in(app_url, OWNER), sign_in(app_url, NOOR)
    email, password, _ = new_member(owner, "bookkeeper")
    c = new_consignor(desk)
    sale = sell(desk, new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))["id"])
    month = month_of(local(sale["soldAt"]).date())
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, (email, password))
        expect(page).to_have_url(path_re(app_url, "/staff/sales-book"))
        select(page.get_by_role("combobox", name="Month"), month_label(month))
        expect(page.get_by_role("table", name="Sales book")).to_contain_text(sale["tagCode"])
        opener = page.get_by_role("button", name="Download sales book")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Download sales book")
        expect(dialog).to_be_visible()
        assert_focus_trapped(page, dialog, presses=4)
        dialog.get_by_role("button", name="Download").focus()
        with downloads(page) as got:
            with reads_working(page, dialog, "**/api/sales-book*"):
                page.keyboard.press("Enter")
            eventually(page, lambda: got, "the sales book download")
        download = got[0]
        assert download.suggested_filename == f"sales-book-{month}.csv"
        assert sale["tagCode"] in Path(download.path()).read_text("utf-8")
        expect(announcements(page)).to_have_text(f"Sales book for {month_label(month)} downloaded.")
        focused(opener)
    assert_error(client(app_url).get("/api/sales-book", params={"month": "bad"}), 401, "unauthenticated")
    assert_instants(owner.get("/api/sales", params={"month": month}).json())
    behind = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    screen_rules(browser, app_url, f"/staff/sales-book?month={month}", who=(email, password), opener=("button", "Download sales book"),
                 dialog="Download sales book", change=lambda: sell(desk, behind["id"]),
                 appears=lambda page: table_has(page, behind["tagCode"]))


def test_wf_sales_book_limit_and_touch(browser: Browser) -> None:
    short = outage_url("APP_SHORT_URL")
    owner = sign_in(short, OWNER)
    email, password, _ = new_member(owner, "bookkeeper")
    books = sign_in(short, (email, password))
    month = month_of(today(short))
    with browse(browser, short + "/sign-in", size=SIZES["375x812"]) as page:
        ui_sign_in(page, short, (email, password))
        expect(page).to_have_url(path_re(short, "/staff/sales-book"))
        frame = page.get_by_role("region", name="Sales book table")
        frame.focus()
        focused(frame)
        layout(page)
        axe(page)
        opener = page.get_by_role("button", name="Download sales book")
        assert_bottom_bar(page, opener)
        for _ in range(DOWNLOADS_PER_WINDOW):
            assert books.get("/api/sales-book", params={"month": month}).status_code == 200
        tap(opener)
        tap(page.get_by_role("dialog", name="Download sales book").get_by_role("button", name="Download"))
        expect(announcements(page)).to_have_text("You've downloaded the sales book 5 times in a short while. Try again in a moment.")


def test_period_end_shelves(app_url: str) -> None:
    owner, desk = sign_in(app_url, OWNER), sign_in(app_url, NOOR)
    t = today(app_url)
    end = ladder_on(ladders(owner), t - timedelta(days=90))["periodEndDay"]
    c = new_consignor(desk)
    brand = f"Shelf {tok()}"
    ended = new_piece(desk, c["id"], intake=t - timedelta(days=end), brand=brand)
    last_day = new_piece(desk, c["id"], intake=t - timedelta(days=end - 1), brand=brand)
    assert ended["status"] == "donation_box" and ended["station"] == "period_ends"
    assert last_day["status"] == "on_rail"
    assert [p["id"] for p in client(app_url).get("/api/rail", params={"q": brand}).json()["pieces"]] == [last_day["id"]]
    assert_error(desk.post(f"/api/pieces/{ended['id']}/collected"), 409, "not_on_returns_shelf")
    assert_error(public_hold(app_url, ended["id"], "Camille", fresh("shopper")[1]), 409, "not_for_sale")
    for code, choice_return in (("HG-1000047-9", True), ("HG-1000048-7", False)):
        p = desk.get("/api/pieces/lookup", params={"tag": code}).json()["piece"]
        day = (t - date.fromisoformat(p["intakeDate"])).days
        lad = ladder_by_id(ladders(owner), p["ladderId"])
        if choice_return and day < lad["periodEndDay"] + SHELF_DAYS:
            assert p["status"] in ("returns_shelf", "returned")
        else:
            assert p["status"] == "donation_box"
    spare = outage_url("APP_SPARE_URL")
    sdesk = sign_in(spare, NOOR)
    shelf = sdesk.get("/api/pieces/lookup", params={"tag": "HG-1000047-9"}).json()["piece"]
    if shelf["status"] == "returns_shelf":
        r = sdesk.post(f"/api/pieces/{shelf['id']}/collected")
        assert r.status_code == 200 and r.json()["piece"]["status"] == "returned"
    again = sdesk.get(f"/api/pieces/{shelf['id']}").json()["piece"]
    if again["status"] == "returned":
        assert INSTANT_RE.match(again["collectedAt"])
        assert_error(sdesk.post(f"/api/pieces/{shelf['id']}/collected"), 409, "not_on_returns_shelf")


def test_consignor_erasure(app_url: str, mail: Any) -> None:
    owner, desk = sign_in(app_url, OWNER), sign_in(app_url, NOOR)
    t = today(app_url)
    u = tok()
    phone = f"+32 470 {int(u[:6], 16) % 1000000:06d}"
    iban = fresh_iban()
    c = new_consignor(desk, name=f"Erase Target {u}", phone=phone, iban=iban)
    unsold = new_piece(desk, c["id"], intake=t - timedelta(days=5))
    sold = new_piece(desk, c["id"], intake=t - timedelta(days=5))
    held_piece = new_piece(desk, c["id"], intake=t - timedelta(days=5))
    for p in (unsold, sold):
        assert upload_photo(desk, p["id"], png()).status_code == 201
    sale = sell(desk, sold["id"])
    hold = public_hold(app_url, held_piece["id"], "Camille", fresh("shopper")[1]).json()["hold"]
    token = portal_token(desk, mail, c)
    pg = Postgres()
    assert database_mentions(pg, c["email"]), "observer cannot see the consignor at all"
    assert_error(desk.post(f"/api/consignors/{c['id']}/erase"), 403, "forbidden")
    r = owner.post(f"/api/consignors/{c['id']}/erase")
    assert r.status_code == 202 and r.json()["consignor"]["status"] in ("erasing", "erased")
    assert r.json()["consignor"]["name"] == "Erased consignor"
    poll(lambda: desk.get(f"/api/consignors/{c['id']}").json()["consignor"]["status"] == "erased", "erasure to finish")
    after = desk.get(f"/api/consignors/{c['id']}")
    erased = after.json()["consignor"]
    assert erased["name"] == "Erased consignor" and erased["email"] is None and erased["phone"] is None and erased["iban"] is None
    spaced_iban = " ".join(iban[i:i + 4] for i in range(0, len(iban), 4))
    for needle in (c["email"], c["name"], phone, iban, spaced_iban):
        assert needle not in after.text
        assert database_mentions(pg, needle) == [], needle
    assert S3().keys(f"pieces/{unsold['id']}/") == []
    assert S3().keys(f"pieces/{sold['id']}/photos/")
    assert desk.get(f"/api/pieces/{unsold['id']}").json()["piece"]["status"] == "archived"
    assert desk.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "released"
    assert_error(client(app_url).get(f"/api/portal/{token}"), 410, "page_ended")
    assert desk.get(f"/api/sales/{sale['id']}").json()["sale"]["consignorName"] == "Erased consignor"
    month = month_of(local(sale["soldAt"]).date())
    line = next(x for x in owner.get("/api/sales", params={"month": month}).json()["lines"] if x["saleId"] == sale["id"])
    assert line["consignorName"] == "Erased consignor"
    assert_error(owner.post(f"/api/consignors/{c['id']}/erase"), 409, "already_erased")
    assert_error(desk.patch(f"/api/consignors/{c['id']}", json={"name": "Back"}), 409, "consignor_erased")
    assert_error(owner.post(f"/api/pieces/{unsold['id']}/restore"), 409, "consignor_erased")
    assert_error(desk.post("/api/pieces", json={"consignorId": c["id"], "category": "coats", "brand": "Maison Arlo", "description": "Wool wrap coat, camel",
                                                 "size": "m", "condition": "very_good", "askingPriceCents": 4990, "intakeDate": t.isoformat()}), 404, "not_found")


def test_archive_and_bring_back(app_url: str, mail: Any) -> None:
    owner, desk = sign_in(app_url, OWNER), sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=80))
    assert upload_photo(desk, piece["id"], png()).status_code == 201
    assert owner.patch(f"/api/pieces/{piece['id']}", json={"askingPriceCents": 4500}).status_code == 200
    token = portal_token(desk, mail, c)
    assert client(app_url).put(f"/api/portal/{token}/choices", json={"choices": [{"pieceId": piece["id"], "choice": "return"}]}).status_code == 200
    before = desk.get(f"/api/pieces/{piece['id']}").json()["piece"]
    keys = S3().keys(f"pieces/{piece['id']}/")
    assert_error(desk.post(f"/api/pieces/{piece['id']}/archive"), 403, "forbidden")
    assert_error(owner.post(f"/api/pieces/{piece['id']}/restore"), 409, "not_archived")
    archived = owner.post(f"/api/pieces/{piece['id']}/archive")
    assert archived.status_code == 200 and archived.json()["piece"]["status"] == "archived"
    assert INSTANT_RE.match(archived.json()["piece"]["archivedAt"])
    assert_error(owner.post(f"/api/pieces/{piece['id']}/archive"), 409, "cannot_archive")
    assert_error(client(app_url).get(f"/api/public/pieces/{piece['id']}"), 404, "not_found")
    restored = owner.post(f"/api/pieces/{piece['id']}/restore")
    assert restored.status_code == 200
    after = restored.json()["piece"]
    for key in ("tagCode", "ladderId", "askingPriceCents", "intakeDate", "choice", "stations", "currentPriceCents", "previousPriceCents", "collectedAt"):
        assert after[key] == before[key], key
    assert [p["id"] for p in after["photos"]] == [p["id"] for p in before["photos"]]
    assert after["status"] == "on_rail" and S3().keys(f"pieces/{piece['id']}/") == keys
    held_one = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    assert public_hold(app_url, held_one["id"], "Camille", fresh("shopper")[1]).status_code == 201
    assert_error(owner.post(f"/api/pieces/{held_one['id']}/archive"), 409, "cannot_archive")


def test_wf_period_end_and_erasure_keyboard(browser: Browser, app_url: str) -> None:
    owner, desk = sign_in(app_url, OWNER), sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=3))
    assert upload_photo(desk, piece["id"], png()).status_code == 201
    route = f"/staff/consignors/{c['id']}"
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, OWNER)
        expect(page).to_have_url(path_re(app_url, "/staff/consignors"))
        page.goto(app_url + route)
        expect(page.get_by_role("heading", level=1)).to_have_text(c["name"])
        opener = page.get_by_role("button", name="Erase consignor")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Erase consignor")
        assert_focus_trapped(page, dialog, presses=4)
        dialog.get_by_role("button", name="Erase", exact=True).focus()
        page.keyboard.press("Enter")
        heading = page.get_by_role("heading", level=1)
        expect(heading).to_have_text("Erased consignor")
        focused(heading)
        expect(announcements(page)).to_have_text(re.compile(r"^(Consignor erased\.|Erasing photos — this consignor shows Erased once every photo is gone\.)$"))
        expect(page).to_have_url(path_re(app_url, re.escape(route)))
        status = page.get_by_text("Erased", exact=True)

        def shows_erased() -> bool:
            if status.count() > 0:
                return True
            after_refresh(page)
            return False

        poll(shows_erased, "the Erased status on screen")
        assert S3().keys(f"pieces/{piece['id']}/") == [], "Erased shown while MinIO still holds a photo"
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_have_text("Erased consignor")
    assert owner.get(f"/api/consignors/{c['id']}").json()["consignor"]["status"] == "erased"
    unknown = str(uuid.uuid4())
    assert_error(desk.post(f"/api/consignors/{unknown}/erase"), 404, "not_found")
    assert_instants(owner.get("/api/consignors").json())
    renamed = new_consignor(desk)
    behind = f"Screen Consignor {tok()}"

    def rename() -> None:
        r = desk.patch(f"/api/consignors/{renamed['id']}", json={"name": behind})
        assert r.status_code == 200, r.text

    screen_rules(browser, app_url, f"/staff/consignors/{renamed['id']}", who=OWNER, opener=("button", "Edit consignor"),
                 dialog="Edit consignor", typed=("textbox", "Phone"), change=rename,
                 appears=lambda page: behind in page.evaluate("() => [...document.querySelectorAll('h1')].map(h => h.innerText.trim())"))


def test_wf_period_end_and_erasure_storage_down(browser: Browser) -> None:
    down = outage_url("APP_STORAGE_DOWN_URL")
    owner, desk = sign_in(down, OWNER), sign_in(down, NOOR)
    c = new_consignor(desk)
    with browse(browser, down + "/sign-in") as page:
        ui_sign_in(page, down, OWNER)
        expect(page).to_have_url(path_re(down, "/staff/consignors"))
        page.goto(f"{down}/staff/consignors/{c['id']}")
        click(page.get_by_role("button", name="Erase consignor"))
        click(page.get_by_role("dialog", name="Erase consignor").get_by_role("button", name="Erase", exact=True))
        copy = "Erasing photos — this consignor shows Erased once every photo is gone."
        expect(announcements(page)).to_have_text(copy)
        expect(page.get_by_text("Erasing", exact=True)).to_be_visible()
        after_refresh(page)
        expect(announcements(page)).to_have_text(copy)
        expect(page.get_by_text("Erased", exact=True)).to_have_count(0)
    assert owner.get(f"/api/consignors/{c['id']}").json()["consignor"]["status"] == "erasing"


def test_wf_period_end_and_erasure_archive(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=40))
    route = f"/staff/pieces/{piece['id']}"
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, OWNER)
        expect(page).to_have_url(path_re(app_url, "/staff/consignors"))
        page.clock.set_system_time(server_now(app_url) + timedelta(hours=26))
        page.goto(app_url + route)
        assert_stations_match(page, desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["stations"])
        page.get_by_role("button", name="Archive", exact=True).focus()
        page.keyboard.press("Enter")
        page.get_by_role("dialog", name="Archive piece").get_by_role("button", name="Archive piece").focus()
        page.keyboard.press("Enter")
        expect(announcements(page)).to_have_text("Piece archived.")
        focused(page.get_by_role("heading", level=1))
        expect(page.get_by_role("heading", level=1)).to_have_text(piece["tagCode"])
        expect(page).to_have_url(path_re(app_url, re.escape(route)))
        assert desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["status"] == "archived"
        page.reload()
        page.get_by_role("button", name="Bring back").focus()
        page.keyboard.press("Enter")
        expect(announcements(page)).to_have_text("Piece brought back.")
        expect(page).to_have_url(path_re(app_url, re.escape(route)))
    assert desk.get(f"/api/pieces/{piece['id']}").json()["piece"]["status"] == "on_rail"


SEED_PIECES = {
    "HG-1000042-0": ("Zoë Ørsted-Hæk", 4990, 35), "HG-1000043-8": ("Ségolène D’Hondt", 1990, 3), "HG-1000044-6": ("Maarten De Smet", 12000, 65),
    "HG-1000045-3": ("Zoë Ørsted-Hæk", 31245, 20), "HG-1000046-1": ("Lotte Janssens", 3900, 80), "HG-1000047-9": ("Ségolène D’Hondt", 4500, 92),
    "HG-1000048-7": ("Maarten De Smet", 6500, 95), "HG-1000049-5": ("Zoë Ørsted-Hæk", 5500, 50), "HG-1000050-3": ("Ségolène D’Hondt", 2990, 45),
    "HG-1000051-1": ("Maarten De Smet", 3500, 10), "HG-1000052-9": ("Lotte Janssens", 8900, 31), "HG-1000053-7": ("Zoë Ørsted-Hæk", 7500, 200),
}
SEED_SALES = {"HG-1000045-3": (10, "14:05", "Noor", 31245, 21872, 9373, 1627), "HG-1000050-3": (12, "11:30", "Noor", 2243, 1346, 897, 156),
              "HG-1000049-5": (40, "16:20", "Jules", 5500, 3300, 2200, 382)}
SEED_PRICES_AT_START = {"HG-1000042-0": 3743, "HG-1000044-6": 6000, "HG-1000046-1": 1950, "HG-1000052-9": 6675}


def test_starting_data(app_url: str) -> None:
    base = outage_url("APP_SESSION_URL")
    owner = sign_in(base, OWNER)
    members = owner.get("/api/members").json()["members"]
    assert sorted((m["name"], m["email"], m["role"]) for m in members) == sorted(
        [("Margaux", OWNER[0], "owner"), ("Noor", NOOR[0], "assistant"), ("Jules", JULES[0], "assistant"), ("Ines", INES[0], "bookkeeper")])
    consignors = owner.get("/api/consignors").json()["consignors"]
    assert sorted((c["name"], c["iban"], c["ibanValid"]) for c in consignors) == sorted([
        ("Zoë Ørsted-Hæk", "BE21001234567803", True), ("Ségolène D’Hondt", "BE35310123456737", True),
        ("Maarten De Smet", "BE94735001234514", True), ("Lotte Janssens", "BE68539007547035", False)])
    lads = ladders(owner)
    assert [(lad["effectiveOn"], lad["firstMarkdownPercent"], lad["firstMarkdownDay"], lad["secondMarkdownPercent"], lad["secondMarkdownDay"], lad["periodEndDay"]) for lad in lads] == [("2024-01-01", 25, 30, 50, 60, 90)]
    pieces = {p["tagCode"]: p for p in all_pieces(owner)}
    assert set(pieces) == set(SEED_PIECES)
    start = date.fromisoformat(pieces["HG-1000042-0"]["intakeDate"]) + timedelta(days=35)
    t = today(base)
    for code, (name, asking, back) in SEED_PIECES.items():
        p = pieces[code]
        assert p["consignor"]["name"] == name and p["askingPriceCents"] == asking and p["intakeDate"] == (start - timedelta(days=back)).isoformat()
        assert p["photos"] == []
    assert pieces["HG-1000053-7"]["status"] == "archived"
    for code in SEED_SALES:
        assert pieces[code]["status"] == "sold"
    if t == start:
        for code, cents in SEED_PRICES_AT_START.items():
            assert pieces[code]["currentPriceCents"] == cents, code
        assert pieces["HG-1000047-9"]["status"] == "returns_shelf" and pieces["HG-1000048-7"]["status"] == "donation_box"
    for code, (back, hhmm, by, price, share, commission, vat) in SEED_SALES.items():
        day = start - timedelta(days=back)
        line = next(x for x in owner.get("/api/sales", params={"month": month_of(day)}).json()["lines"] if x["tagCode"] == code)
        assert local(line["soldAt"]).strftime("%Y-%m-%d %H:%M") == f"{day.isoformat()} {hhmm}"
        assert (line["priceCents"], line["consignorShareCents"], line["commissionCents"], line["vatCents"]) == (price, share, commission, vat)
        assert owner.get(f"/api/sales/{line['saleId']}").json()["sale"]["soldBy"]["name"] == by
    assert owner.get("/api/holds").json()["holds"] == [] and owner.get("/api/appointments").json()["appointments"] == []
    assert owner.get("/api/payout-runs").json()["runs"] == []
    spare = outage_url("APP_SPARE_URL")
    sdesk = sign_in(spare, NOOR)
    mine = new_consignor(sdesk)
    piece = new_piece(sdesk, mine["id"], intake=today(spare))
    photo = upload_photo(sdesk, piece["id"], png()).json()["photo"]
    assert S3("-spare").keys(f"pieces/{piece['id']}/photos/{photo['id']}/")
    assert S3().keys(f"pieces/{piece['id']}/") == []
    assert mine["email"] not in [c["email"] for c in sign_in(app_url, NOOR).get("/api/consignors").json()["consignors"]]


def test_api_conventions(app_url: str) -> None:
    anon = client(app_url)
    owner = sign_in(app_url, OWNER)
    health = anon.get("/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert_error(anon.get(f"{UNKNOWN_API}{tok()}"), 404, "not_found")
    wrong = anon.delete("/api/health")
    assert_error(wrong, 405, "method_not_allowed")
    assert "GET" in wrong.headers["Allow"]
    assert_error(owner.post("/api/consignors", content=json.dumps({"name": "x"}), headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    assert_error(owner.post("/api/consignors", content=b"{not json", headers={"Content-Type": "application/json"}), 400, "malformed_json")
    pad = lambda n: json.dumps({"email": "a@b.be", "password": "x", "pad": ""}).encode()[:-2] + b"x" * (n - len(json.dumps({"email": "a@b.be", "password": "x", "pad": ""}).encode())) + b'"}'
    assert_error(anon.post("/api/session", content=pad(JSON_LIMIT + 1), headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    at_limit = pad(JSON_LIMIT)
    assert len(at_limit) == JSON_LIMIT
    assert_error(anon.post("/api/session", content=at_limit, headers={"Content-Type": "application/json"}), 401, "invalid_credentials")
    page = anon.get(f"{UNKNOWN_SCREEN}{tok()}")
    assert page.status_code == 404
    for path in ("/api/consignors", "/api/pieces", "/api/members", "/api/ladders", "/api/holds"):
        body = owner.get(path).json()
        assert_camel(body)
        assert_instants(body)
    err = assert_error(owner.post("/api/consignors", json={"name": "", "email": "nope"}), 422, "validation_failed")
    assert err["fields"]["name"] == "Enter a name." and err["fields"]["email"] == "Enter an email address like name@example.be."
    err = assert_error(owner.post("/api/consignors", json={"name": "x", "email": fresh("c")[1], "iban": INVALID_IBAN}), 422, "validation_failed")
    assert err["fields"]["iban"] == "Enter a valid IBAN, for example BE68 5390 0754 7034."


def test_error_ladder_two_rules(app_url: str) -> None:
    anon, desk, books = client(app_url), sign_in(app_url, NOOR), sign_in(app_url, INES)
    c = new_consignor(desk)
    probe = str(uuid.uuid4())
    junk = tok()
    cases = [
        (anon, "PUT", "/api/rail?category=hats", {}, 405, "method_not_allowed"),
        (anon, "POST", "/api/pieces", {"content": b"{bad", "headers": {"Content-Type": "application/json"}}, 401, "unauthenticated"),
        (desk, "POST", "/api/ladders", {"json": {"effectiveOn": "nope"}}, 403, "forbidden"),
        (anon, "POST", f"/api/pieces/{probe}/holds", {"json": {"name": "", "email": "x"}}, 404, "not_found"),
        (desk, "POST", "/api/sales", {"content": b"{bad", "headers": {"Content-Type": "text/plain"}}, 415, "unsupported_media_type"),
        (books, "POST", "/api/payout-runs", {"json": {"month": "bad"}}, 403, "forbidden"),
        (anon, "PUT", f"/api/portal/{junk}/choices", {"content": b"{bad", "headers": {"Content-Type": "application/json"}}, 404, "not_found"),
        (anon, "POST", "/api/appointments", {"content": b"x" * (JSON_LIMIT + 1), "headers": {"Content-Type": "text/plain"}}, 413, "payload_too_large"),
        (anon, "POST", "/api/imports/preview", {"content": b"x" * (SHEET_LIMIT + 1), "headers": {"Content-Type": "text/csv"}}, 413, "payload_too_large"),
        (anon, "GET", "/api/sales-book?month=bad", {}, 401, "unauthenticated"),
        (desk, "POST", f"/api/consignors/{probe}/erase", {}, 404, "not_found"),
        (desk, "POST", "/api/pieces", {"json": {"consignorId": probe, "askingPriceCents": 1}}, 404, "not_found"),
        (desk, "POST", "/api/sales", {"json": {"pieceId": probe, "payment": "cheque"}}, 404, "not_found"),
        (books, "POST", "/api/pieces", {"content": b"x", "headers": {"Content-Type": "text/plain"}}, 403, "forbidden"),
        (desk, "POST", "/api/pieces", {"json": {"consignorId": c["id"], "askingPriceCents": 99}}, 422, "validation_failed"),
    ]
    for who, method, path, kwargs, status, code in cases:
        r = who.request(method, path, **kwargs)
        assert_error(r, status, code)
        if status == 405:
            assert "GET" in r.headers["Allow"]


def test_landing_routes(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    c = new_consignor(desk)
    piece = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    other = new_piece(desk, c["id"], intake=today(app_url) - timedelta(days=1))
    sale = sell(desk, other["id"])
    _, shopper = fresh("shopper")
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, NOOR)
        expect(page).to_have_url(path_re(app_url, "/staff/pieces"))
        page.goto(f"{app_url}/staff/pieces/{piece['id']}")
        click(page.get_by_role("button", name="Place hold"))
        dialog = page.get_by_role("dialog", name="Place hold")
        dialog.get_by_role("textbox", name="Shopper name").fill("Camille")
        dialog.get_by_role("textbox", name="Shopper email").fill(shopper)
        click(dialog.get_by_role("button", name="Hold piece"))
        expect(page).to_have_url(path_re(app_url, r"/staff/holds/[0-9a-f-]{36}"))
        hold_id = urlparse(page.url).path.rsplit("/", 1)[1]
        heading = page.get_by_role("heading", level=1)
        expect(heading).to_have_text(f"Hold {piece['tagCode']}")
        focused(heading)
        hold = desk.get(f"/api/holds/{hold_id}").json()["hold"]
        assert hold["shopperEmail"] == shopper and hold["pieceId"] == piece["id"]
        expect(announcements(page)).to_have_text(exact(r"Hold placed until " + time_re(local(hold["endsAt"])) + r"\."))
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_have_text(f"Hold {piece['tagCode']}")
    with browse(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, INES)
        expect(page).to_have_url(path_re(app_url, "/staff/sales-book"))
        page.goto(f"{app_url}/staff/sales/{sale['id']}")
        expect(page.get_by_role("heading", level=1)).to_have_text(f"Sale {other['tagCode']}")
        page.goto(f"{app_url}/staff/pieces")
        expect(page.get_by_role("heading", name="We couldn't find that page.")).to_be_visible()


def test_session_ended_mid_form(browser: Browser, app_url: str) -> None:
    session = client(app_url)
    signed = session.post("/api/session", json={"email": NOOR[0], "password": NOOR[1]})
    assert signed.status_code == 200 and signed.json()["homeRoute"] == HOME_ROUTES["assistant"]
    parts = [p.strip() for p in signed.headers["set-cookie"].split(";")]
    assert parts[0].partition("=")[0] == "ourlet_session", parts
    attrs = {k.strip().lower(): v.strip() for k, _, v in (p.partition("=") for p in parts[1:])}
    assert "HttpOnly".lower() in attrs and attrs.get("SameSite".lower(), "").lower() == "Lax".lower() and attrs.get("path") == "/", attrs
    assert "Max-Age".lower() not in attrs and "Expires".lower() not in attrs, attrs
    value = session.cookies.get("ourlet_session")
    assert session.delete("/api/session").status_code == 204
    assert_error(client(app_url).get("/api/session", headers={"Cookie": f"ourlet_session={value}"}), 401, "session_ended")
    assert_error(client(app_url).get("/api/session"), 401, "unauthenticated")
    wrong = client(app_url).post("/api/session", json={"email": NOOR[0], "password": NOOR[1] + "x"})
    _, nobody = fresh("nobody")
    stranger = client(app_url).post("/api/session", json={"email": nobody, "password": NOOR[1]})
    assert assert_error(wrong, 401, "invalid_credentials") == assert_error(stranger, 401, "invalid_credentials")
    base = outage_url("APP_SESSION_URL")
    name, email = f"Typed {tok()}", fresh("consignor")[1]
    with browse(browser, base + "/sign-in") as page:
        ui_sign_in(page, base, NOOR)
        expect(page).to_have_url(path_re(base, "/staff/pieces"))
        page.goto(base + "/staff/consignors")
        click(page.get_by_role("button", name="New consignor"))
        dialog = page.get_by_role("dialog", name="New consignor")
        dialog.get_by_role("textbox", name="Name").fill(name)
        dialog.get_by_role("textbox", name="Email").fill(email)
        poll(lambda: page.request.get(base + "/api/session").status == 401, "the short session to end", seconds=SHORT_SECONDS + 15)
        click(dialog.get_by_role("button", name="Save consignor"))
        expect(announcements(page)).to_contain_text("Your session ended. Sign in again to keep going — what you typed is still here.")
        expect(dialog.get_by_role("textbox", name="Name")).to_have_value(name)
        click(announcements(page).get_by_role("link", name="Sign in again"))
        expect(page).to_have_url(path_re(base, "/sign-in"))
        page.get_by_role("textbox", name="Email").fill(NOOR[0])
        page.get_by_label("Password", exact=True).fill(NOOR[1])
        click(page.get_by_role("button", name="Sign in"))
        expect(page).to_have_url(path_re(base, "/staff/consignors"))
        reopened = page.get_by_role("dialog", name="New consignor")
        expect(reopened.get_by_role("textbox", name="Name")).to_have_value(name)
        expect(reopened.get_by_role("textbox", name="Email")).to_have_value(email)


def test_screens_layout_and_access(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    piece = new_piece(desk, new_consignor(desk)["id"], intake=today(app_url) - timedelta(days=1))
    screens = [
        ("/", ("button", "Filters"), "Filters"), (f"/pieces/{piece['id']}", ("button", "Hold this piece"), "Hold this piece"),
        ("/appointments", None, None), ("/staff/consignors", ("button", "New consignor"), "New consignor"),
        ("/staff/pieces", ("button", "New piece"), "New piece"), (f"/staff/pieces/{piece['id']}", ("button", "Sell"), "Sell piece"),
        ("/staff/till", None, None), ("/staff/holds", ("link", "Till"), None), ("/staff/appointments", ("link", "Public appointment page"), None),
        ("/staff/ladder", ("button", "Change ladder"), "Change ladder"), ("/staff/payouts", ("button", "Start payout run"), "Start payout run"),
        ("/staff/import", ("button", "Choose file"), None), ("/staff/sales-book", ("button", "Download sales book"), "Download sales book"),
        ("/staff/members", ("button", "Add member"), "Add member"),
    ]
    with browse(browser, app_url + "/sign-in", reduced_motion="reduce") as page:
        layout(page)
        axe(page)
        ui_sign_in(page, app_url, OWNER)
        expect(page).to_have_url(path_re(app_url, "/staff/consignors"))
        for path, action, dialog_name in screens:
            for label, size in SIZES.items():
                page.set_viewport_size({"width": size[0], "height": size[1]})
                page.goto(app_url + path)
                page.wait_for_load_state("networkidle")
                layout(page)
                if label not in AXE_SIZES:
                    continue
                main = outside_staff_nav(page, page.get_by_role(action[0], name=action[1], exact=True)) if action else None
                axe(page)
                if main is None or not main.is_visible():
                    continue
                if label == "375x812":
                    assert_bottom_bar(page, main)
                else:
                    assert ring_visible(page, main), f"no visible focus ring on {action[1]}"
                if dialog_name:
                    click(main)
                    expect(page.get_by_role("dialog", name=dialog_name)).to_be_visible()
                    layout(page)
                    axe(page)
                    page.keyboard.press("Escape")
                    focused(main)
                    advance(page, REDUCED_GONE_MS)
                    assert_closed(page, page.get_by_role("dialog", name=dialog_name), [])


def test_motion_system(browser: Browser, app_url: str) -> None:
    desk = sign_in(app_url, NOOR)
    piece = new_piece(desk, new_consignor(desk)["id"], intake=today(app_url) - timedelta(days=1))
    with browse(browser, app_url + "/", size=SIZES["1024x768"]) as page:
        page.add_init_script(RECORDER)
        page.reload()
        seen: list[dict] = []
        for opener, name in ((("button", "Filters"), "Filters"), (("button", "Categories"), None)):
            button = page.get_by_role(opener[0], name=opener[1])
            click(button)
            advance(page, SETTLE_MS)
            if name:
                eventually(page, lambda: page.get_by_role("dialog", name=name).evaluate("d => d.contains(document.activeElement)"), "focus inside the sheet")
                finish_motion(page)
                seen += motion_log(page)
                after_refresh(page)
                seen += assert_no_replay(page, f"{name} sheet")
            page.keyboard.press("Escape")
            advance(page, SETTLE_MS)
        page.goto(f"{app_url}/pieces/{piece['id']}")
        click(page.get_by_role("button", name="Hold this piece"))
        advance(page, SETTLE_MS)
        page.keyboard.press("Escape")
        advance(page, SETTLE_MS)
        log = seen + motion_log(page)
        assert log, "no motion recorded at all"
        assert not [e for e in log if e["loops"]], "a loop runs"
        assert {round(e["duration"]) for e in log if e["duration"] >= 1} <= MOTION_DURATIONS, log
    with browse(browser, app_url + "/", size=SIZES["1024x768"], reduced_motion="reduce") as page:
        page.add_init_script(RECORDER)
        page.reload()
        opener = page.get_by_role("button", name="Filters")
        click(opener)
        sheet = page.get_by_role("dialog", name="Filters")
        expect(sheet).to_be_visible()
        eventually(page, lambda: sheet.evaluate("d => d.contains(document.activeElement)"), "focus inside the Filters sheet")
        page.keyboard.press("Escape")
        advance(page, REDUCED_GONE_MS)
        expect(page.get_by_role("dialog", name="Filters")).to_have_count(0)
        click(page.get_by_role("button", name="Categories"))
        menu = page.get_by_role("navigation", name="Categories")
        expect(menu).to_be_visible()
        _pause.wait(SETTLE_MS / 1000)
        page.keyboard.press("Escape")
        advance(page, REDUCED_GONE_MS)
        assert not menu.count() or not menu.first.is_visible(), "SR3: the closed Categories menu is still shown under reduced motion"
        moving = [e for e in motion_log(page) if (e["inOverlay"] or e["inTag"]) and e["duration"] >= REDUCED_GONE_MS]
        assert moving == [], f"SR3: a sheet or menu still moves under reduced motion: {moving[:4]}"


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", ".svelte-kit", "out", "coverage"}


def app_files() -> Iterator[Path]:
    for path in APP.rglob("*"):
        if path.is_file() and not SKIP_DIRS & set(path.relative_to(APP).parts):
            yield path


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == [], missing


def test_if_permissive_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert bad == [], bad


def test_if_fonts_and_icons() -> None:
    squash = lambda s: re.sub(r"[\s_\-]+", "", s.lower())
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    paths = [p for p in APP.rglob("*") if ".git" not in p.parts]
    declared = set()
    for manifest in (p for p in paths if p.name == "package.json" and "node_modules" not in p.parts):
        data = json.loads(manifest.read_text())
        declared |= set(data.get("dependencies", {})) | set(data.get("devDependencies", {}))
    for name in ("Familjen Grotesk", "Hanken Grotesk"):
        slug = squash(name)
        assert slug in squash(notices) or any(slug in squash(str(p.relative_to(APP))) for p in paths) or any(slug in squash(d) for d in declared), name
    ofl_re = re.compile(r"open font license|\bOFL\b", re.IGNORECASE)
    ofl_files = [p for p in paths if p.is_file() and (re.match(r"(?i)^ofl", p.name) or (
        re.match(r"(?i)^licen[cs]e", p.name) and any(squash(f) in squash(str(p.relative_to(APP))) for f in ("Familjen Grotesk", "Hanken Grotesk"))))]
    assert ofl_re.search(notices) or any(ofl_re.search(p.read_text("utf-8", errors="ignore")) for p in ofl_files), "no SIL OFL notice"
    names = {p.name for p in shipped_packages()}
    lucide = "Lucide".lower()
    assert not [n for n in names if re.search(r"(^|/)inter(-|$)", n) or n.endswith("/inter")], names
    stray_icons = [n for n in names if re.search(r"(?<!fav)icons($|[^a-z])|(^|[/@-])icon($|[^a-z])|^@iconify/", n.lower()) and lucide not in n.lower()]
    assert stray_icons == [], stray_icons


def test_if_no_credentials() -> None:
    secrets = [os.environ.get("S3_SECRET_ACCESS_KEY", ""), os.environ.get("S3_ACCESS_KEY_ID", ""), urlparse(os.environ.get("DATABASE_URL", "")).password or ""]
    secrets = [s for s in secrets if len(s) >= 6]
    assert secrets, "no credential values in the verifier environment"
    leaks = []
    for path in app_files():
        if path.stat().st_size > 2_000_000:
            continue
        data = path.read_bytes()
        leaks += [str(path) for s in secrets if s.encode() in data]
    assert leaks == [], leaks


def test_if_no_other_datastore() -> None:
    forbidden = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "level", "lowdb", "nedb", "@libsql/client", "pg-mem", "lokijs", "lmdb", "@electric-sql/pglite"}
    assert not {p.name for p in shipped_packages()} & forbidden
    assert [str(p) for p in app_files() if p.suffix.lower() in {".sqlite", ".sqlite3", ".db", ".rdb", ".ldb"}] == []


def test_if_typescript_source() -> None:
    files = list(app_files())
    assert [p for p in files if p.suffix in {".ts", ".tsx"}]
    stray = [str(p) for p in files if p.suffix in {".js", ".jsx"} and p.parent != APP and "public" not in p.relative_to(APP).parts]
    assert stray == [], stray
