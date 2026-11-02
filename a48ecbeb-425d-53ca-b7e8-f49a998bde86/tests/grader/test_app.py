from __future__ import annotations

import calendar
import contextlib
import functools
import json
import math
import os
import re
import subprocess
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (advance, capture, center, changed, check, click, decode, difference, fill, held, idempotency_key,
                      layout, motion, open_app, same_origin, scene_frames, select, session, tab_order, unique)

try:
    from killbill import KillBill
except ImportError:
    from conftest import KillBill
try:
    from mailpit import Mailpit, addresses, mail_from_address
except ImportError:
    from conftest import Mailpit, addresses, mail_from_address
try:
    from mailpit import text as mail_text
except ImportError:
    from conftest import text as mail_text
try:
    from minio import S3
except ImportError:
    from conftest import S3
try:
    from pocketbase import PocketBase
except ImportError:
    from conftest import PocketBase
try:
    from postgres import Postgres
except ImportError:
    from conftest import Postgres


PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
WIDE = (1440, 900)
QUEUE_TABLE_MIN_PX = 1024
RAIL_MIN_PX = 380
RAIL_MAX_PX = 420
SHEET_MAX_FRACTION = 0.45
TOUCH_MIN_PX = 44
TURN_STEP_DEG = 45
SCROLL_TURN_DEG = 90
DRAG_TURN_DEG = 180
IDLE_TURN_MIN_S = 20
IDLE_TURN_MAX_S = 30
INPUT_PAUSE_S = 5
TURN_ANIM_MS = 333
SCENE_FADE_MS = 1000
MESSAGE_RISE_MS = 500
DRAWER_IN_MS = 250
DRAWER_OUT_MS = 200
LIFT_MAX_MS = 150
FLIGHT_MAX_MS = 500
FILL_MAX_MS = 200
RETURN_MAX_MS = 350
REDUCED_FADE_MAX_MS = 150
SLOW_PAY_MS = 20000
CRATE_SIZE = 12
DROP_LIMIT = 6
HOLD_DEFAULT_S = 900
EXPIRY_RELEASE_S = 2
STOCK_LIVE_S = 3
REVIEW_LIVE_S = 3
QUOTE_S = 1
QUEUE_LIVE_S = 15
BANNER_S = 10
CHANGE_CONFIRM_S = 10
REFUND_CONFIRM_S = 10
RENEWAL_NOTICE_S = 10
DUNNING_LATE_S = 5
UPCOMING_S = 60
MAIL_RETRY_S = 30
DUNNING_RETRY_DAYS = (1, 3, 7)
DUNNING_HOLD_DAY = 8
DUNNING_CANCEL_DAY = 14
SHORT_DAY_S = 3
QC_SHIPPING_PROBE = 1300
QC_THRESHOLD_PROBE = 5000
JSON_LIMIT = 64000
LICENCE_LIMIT = 5000000
EARTH_RADIUS_KM = 6371
TORONTO = ZoneInfo("America/Toronto")

HTTP_TIMEOUT_S = 60
EXPECT_MS = 5000
QUICK_MS = 250
UI_S = 20
UI_STEP_MS = 100
POLL_S = 0.25
SLACK_S = 5
ROUNDTRIP_S = 2
MAIL_S = 30
MAIL_SETTLE_S = 3
TAB_BUDGET = 150
TAB_PRESSES = 24
SCROLL_STEP_MS = 50
RACE_N = 8
TICKS_MS = 3000
NS_SHIPPING_PROBE = 1700
NS_THRESHOLD_PROBE = 6000
NS_SHIPPING_OVER = 10001
DROP_PRICE_PROBE = 400
DROP_PRICE_OVER = 2001
REFUND_PROBE_CENTS = 500
REFUND_MISMATCH_CENTS = 600
REFUND_RACE_CENTS = 1500
REFUND_UI_CENTS = 1000
REFUND_SMALL_CENTS = 100
FOREIGN_ORIGIN = "http://elsewhere.example"
PRIVATE_PATHS = ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts")
OTHER_TYPE = "text/plain"
SECRET_MIN_LEN = 8
API_WORDS = ("password",)
HALF_CARD = "4242 4242"
APPLICATION_SUFFIXES = {"png": " PNG", "exact": " Exact", "big": " Big", "text": " Text"}

expect.set_options(timeout=EXPECT_MS)

FLAVOURS = ("guava-lime", "yuzu-ginger", "passionfruit-basil", "cacao-orange")
NAMES = {"guava-lime": "Guava & Lime", "yuzu-ginger": "Yuzu Ginger", "passionfruit-basil": "Passionfruit Basil",
         "cacao-orange": "Cacao Orange"}
PROVINCES = {"AB": "Alberta", "BC": "British Columbia", "NS": "Nova Scotia", "ON": "Ontario", "QC": "Quebec"}
TAX_LINES = {"AB": [("GST", "5.000")], "BC": [("GST", "5.000"), ("PST", "7.000")], "NS": [("HST", "14.000")],
             "ON": [("HST", "13.000")], "QC": [("GST", "5.000"), ("QST", "9.975")]}
CITY = {"AB": "Calgary", "BC": "Vancouver", "NS": "Halifax", "ON": "Toronto", "QC": "Montreal"}
POSTAL = {"AB": "T2P 1J9", "BC": "V6B 1A1", "NS": "B3H 1A1",
          "ON": "M5V 2T6", "QC": "H2X 1Y4"}
DISCOVERY = (("guava-lime", 4), ("yuzu-ginger", 4), ("passionfruit-basil", 4))
STAFF = {"owner": ("owner@ceibo.test", "Ceibo-owner-2026"),
         "fulfilment": ("pack@ceibo.test", "Ceibo-pack-2026"),
         "support": ("help@ceibo.test", "Ceibo-help-2026")}
SHOPPER_PASSWORD = "Leaf-and-blossom-2026"

GOOD_CARD = {"number": "4242 4242 4242 4242", "expiry_month": 12, "expiry_year": 2028, "cvc": "123"}
DECLINE_CARD = dict(GOOD_CARD, number="4000 0000 0000 0002")
FIRST_ONLY_CARD = dict(GOOD_CARD, number="4000 0000 0000 0341")
CARD_EXPIRY_TEXT = "12/28"

STOCKISTS = [
    ("Epicerie Feuille Verte", 45.5231, -73.5817, "Montreal"),
    ("Marche du Fleuve", 46.8123, -71.2145, "Quebec City"),
    ("Canopy Grocer", 43.6532, -79.3832, "Toronto"),
    ("Riverbend Pantry", 45.4215, -75.6972, "Ottawa"),
    ("Orchard Row Market", 44.6488, -63.5752, "Halifax"),
    ("Night Sky Provisions", 51.0447, -114.0719, "Calgary"),
    ("Cedar & Salt", 49.2827, -123.1207, "Vancouver"),
]

SCENES = [
    ("Canopy", "Grown under the canopy",
     "Organic yerba mate, shade-grown and cold-brewed, then sparkled in small batches."),
    ("River", "Lightly sparkling, lightly sweet",
     "Every can carries about 80 mg of caffeine from mate leaves and 30 calories or fewer."),
    ("Orchard", "Build your crate", "Mix any 12 cans. Your crate holds them while you shop."),
    ("Night sky", "Every province, exact to the cent", "Tax, deposit and shipping are shown before you pay."),
]
FAQ = ["How does the can deposit work?", "When is my card charged for a subscription?",
       "How long are limited-drop cans held?", "Can I change my box before it ships?"]

COPY_FORBIDDEN = "Your role can't do that."
COPY_STORE_DOWN = "The shop can't update right now. Try again in a moment."
COPY_BILLING_PAUSED = "Payments are paused for a moment. Your crate is still held, so try again shortly."
COPY_CARD_RECOVERED = "Card updated. Your renewal is paid and your boxes are back on."
COPY_SETTINGS_SAVED = "Settings saved."
COPY_HOLD_ENDED = "Your hold ended and the cans went back on the shelf."
COPY_DUNNING_1 = "Your renewal payment didn't go through. Update your card to keep your boxes coming."

OUTAGES = {
    "killbill": ("APP_KILLBILL_DOWN_URL", "billing_unavailable",
                 "Billing is unreachable. Refunds and subscription changes are paused; packing continues."),
    "postgres": ("APP_POSTGRES_DOWN_URL", "store_unavailable",
                 "The orders database is unreachable. The queue can't load until it returns."),
    "pocketbase": ("APP_POCKETBASE_DOWN_URL", "accounts_unavailable",
                   "Accounts are unreachable. Staff already signed in can keep working."),
    "minio": ("APP_MINIO_DOWN_URL", "files_unavailable",
              "File storage is unreachable. Packing slips and invoices can't be opened until it returns."),
    "mailpit": ("APP_MAILPIT_DOWN_URL", "",
                "Email is delayed. Messages are queued and will send when it returns."),
}
OUTAGE_IDS = ["killbill", "postgres", "pocketbase", "minio", "mailpit"]

PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
TEXT_BYTES = b"plain text, not a licence file"

ACC_NAME_JS = """e => {
  const ids = e.getAttribute('aria-labelledby');
  if (ids) return ids.split(/\\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').replace(/\\s+/g, ' ').trim();
  return (e.getAttribute('aria-label') || e.getAttribute('alt') || e.getAttribute('title') || e.textContent || '').replace(/\\s+/g, ' ').trim();
}"""
OPACITY_JS = "e => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; }"
TOP_JS = "e => e.getBoundingClientRect().top + window.scrollY"
SCROLL_JS = "y => window.scrollTo({top: y, left: 0, behavior: 'instant'})"
FOCUSED_JS = "e => e === document.activeElement"
CONTAINS_FOCUS_JS = "e => e.contains(document.activeElement)"
RAIL_JS = ("(crate, total) => { let n = crate; while (n && !n.contains(total)) n = n.parentElement; const out = [];"
           " for (; n && n.nodeType === 1 && n.getBoundingClientRect().x >= innerWidth / 2 - 1; n = n.parentElement)"
           " out.push(n.getBoundingClientRect().width); return out; }")
METER_JS = """e => ({value: e.getAttribute('aria-valuenow') ?? (('value' in e) ? String(e.value) : null),
                    text: e.getAttribute('aria-valuetext') ?? e.textContent.replace(/\\s+/g, ' ').trim()})"""
COUNTER_JS = """e => {
  const copy = e.cloneNode(true);
  copy.querySelectorAll('[aria-hidden="true"]').forEach(n => n.remove());
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  return [clean(copy.textContent), clean(e.innerText), clean(e.getAttribute('aria-valuetext')), clean(e.getAttribute('aria-label'))];
}"""


def _assert_equal(actual: Any, wanted: Any) -> None:
    assert actual == wanted, (actual, wanted)


_tick = threading.Event()


def poll(fn: Callable[[], Any], pred: Callable[[Any], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        last = fn()
        if pred(last):
            return last
        if time.monotonic() > deadline:
            raise AssertionError(f"{what} not reached within {seconds} s: {str(last)[:600]}")
        _tick.wait(POLL_S)


@contextlib.contextmanager
def entered(obj: Any) -> Iterator[Any]:
    if hasattr(obj, "__enter__"):
        with obj as value:
            yield value
        return
    value = next(obj)
    try:
        yield value
    finally:
        with contextlib.suppress(StopIteration):
            next(obj)


def run_threads(n: int, fn: Callable[[int], Any]) -> list[Any]:
    barrier = threading.Barrier(n)

    def go(i: int) -> Any:
        barrier.wait()
        return fn(i)

    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(go, range(n)))


def dollars(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def money(cents: int) -> str:
    return f"${dollars(cents)}"


def phrase(remaining: int, province_name: str) -> str:
    if remaining == 0:
        return f"Free shipping unlocked in {province_name}."
    return f"{money(remaining)} to free shipping in {province_name}."


def rate_label(rate: str) -> str:
    return format(Decimal(rate).normalize(), "f")


def iso(ts: Any) -> datetime:
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))


def long_date(day: Any) -> str:
    d = date.fromisoformat(str(day)[:10])
    return f"{calendar.month_name[d.month]} {d.day}, {d.year}"


def long_datetime(ts: Any) -> str:
    local = iso(ts).astimezone(TORONTO)
    return f"{long_date(local.date().isoformat())} at {local:%H:%M}"


def add_months(day: Any, n: int) -> str:
    d = date.fromisoformat(str(day)[:10])
    month = d.month - 1 + n
    year, month = d.year + month // 12, month % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1])).isoformat()


def identity(prefix: str) -> tuple[str, str]:
    name, email = unique(prefix)
    return email, name


def instance(env: str) -> str:
    url = os.environ.get(env)
    assert url, f"{env} is not set"
    return url.rstrip("/")


def origin_of(url: str) -> str:
    u = httpx.URL(url)
    return f"{u.scheme}://{u.netloc.decode()}"


def cents(amount: Any) -> int:
    return int((Decimal(str(amount)) * 100).to_integral_value())


def _inflate(raw: bytes) -> bytes:
    try:
        return zlib.decompressobj().decompress(raw)
    except zlib.error:
        return raw


def _utf16(hexed: str) -> str:
    try:
        return bytes.fromhex(hexed).decode("utf-16-be")
    except ValueError:
        return ""


def _cmap(streams: list[bytes]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for s in streams:
        if b"begincmap" not in s:
            continue
        t = s.decode("latin-1")
        for block in re.findall(r"beginbfchar(.*?)endbfchar", t, re.S):
            for src, dst in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", block):
                mapping[src.upper()] = _utf16(dst)
        for block in re.findall(r"beginbfrange(.*?)endbfrange", t, re.S):
            for lo, hi, rest in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])", block):
                width, a, b = len(lo), int(lo, 16), int(hi, 16)
                if b - a > 65535:
                    continue
                if rest.startswith("["):
                    for i, d in enumerate(re.findall(r"<([0-9A-Fa-f]*)>", rest)):
                        mapping[f"{a + i:0{width}X}"] = _utf16(d)
                else:
                    base, dw = int(rest[1:-1] or "0", 16), len(rest) - 2
                    for i in range(b - a + 1):
                        mapping[f"{a + i:0{width}X}"] = _utf16(f"{base + i:0{dw}X}")
    return mapping


PDF_STRING = re.compile(rb"\((?:\\.|[^\\)])*\)|(?<!<)<[0-9A-Fa-f\s]+>(?!>)", re.S)
PDF_ESCAPES = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}


def _literal(s: bytes) -> bytes:
    out, i = bytearray(), 0
    while i < len(s):
        c = s[i]
        if c == 0x5C and i + 1 < len(s):
            n = s[i + 1]
            octal = re.match(rb"[0-7]{1,3}", s[i + 1:i + 4])
            if n in PDF_ESCAPES:
                out.append(PDF_ESCAPES[n])
                i += 2
            elif octal:
                out.append(int(octal.group(0), 8) & 0xFF)
                i += 1 + len(octal.group(0))
            elif n in (10, 13):
                i += 2
            else:
                out.append(n)
                i += 2
        else:
            out.append(c)
            i += 1
    return bytes(out)


def _decode(code: bytes, cmap: dict[str, str]) -> str:
    hexed = code.hex().upper()
    for width in (4, 2):
        if hexed and len(hexed) % width == 0:
            chunks = [hexed[i:i + width] for i in range(0, len(hexed), width)]
            if all(c in cmap for c in chunks):
                return "".join(cmap[c] for c in chunks)
    return code.decode("latin-1")


def pdf_text(payload: bytes, raw: bool = True) -> str:
    streams = [_inflate(m.group(1)) for m in re.finditer(rb"stream\r?\n(.*?)endstream", payload, re.S)]
    cmap = _cmap(streams)
    mapped: list[str] = []
    plain: list[str] = []
    for s in streams:
        if b"begincmap" in s:
            continue
        for m in PDF_STRING.finditer(s):
            tok = m.group(0)
            if tok.startswith(b"("):
                code = _literal(tok[1:-1])
            else:
                h = re.sub(rb"\s", b"", tok[1:-1])
                code = bytes.fromhex((h + b"0" * (len(h) % 2)).decode())
            mapped.append(_decode(code, cmap))
            plain.append(code.decode("latin-1"))
    texts = ["".join(mapped), " ".join(mapped), "".join(plain)]
    if raw:
        texts += [payload.decode("latin-1"), *(s.decode("latin-1") for s in streams)]
    with contextlib.suppress(Exception):
        import io
        import pypdf
        texts.append("\n".join(p.extract_text() or "" for p in pypdf.PdfReader(io.BytesIO(payload)).pages))
    return "\n".join(texts)


def has(blob: str, needle: str) -> bool:
    if needle in blob:
        return True
    return bool(re.search(r"[A-Za-z]", needle)) and re.sub(r"\s+", "", needle) in re.sub(r"\s+", "", blob)


class Api:
    def __init__(self, base: str, jar: dict[str, str] | None = None, email: str = "", user_id: str = "",
                 address_id: str = "", name: str = "", line1: str = "") -> None:
        self.base = base.rstrip("/")
        self.jar: dict[str, str] = dict(jar or {})
        self.email, self.user_id, self.address_id, self.name, self.line1 = email, user_id, address_id, name, line1
        self.http = httpx.Client(timeout=HTTP_TIMEOUT_S)

    def call(self, method: str, path: str, body: Any = None, key: str | None = None, data: Any = None,
             files: Any = None, **headers: str) -> httpx.Response:
        h = dict(headers)
        if self.jar:
            h["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.jar.items())
        if key is not None:
            h["Idempotency-Key"] = key
        kwargs: dict[str, Any] = {}
        if data is not None or files is not None:
            kwargs.update(data=data, files=files)
        elif body is not None:
            kwargs["json"] = body
        r = self.http.request(method, self.base + path, headers=h, **kwargs)
        for name, value in r.cookies.items():
            self.jar[name] = value
        self.http.cookies.clear()
        return r

    def ok(self, method: str, path: str, body: Any = None, status: int | None = None, key: str | None = None) -> Any:
        r = self.call(method, path, body, key=key)
        if status is None:
            assert 200 <= r.status_code < 300, (method, path, r.status_code, r.text[:600])
        else:
            assert r.status_code == status, (method, path, r.status_code, r.text[:600])
        return r.json() if r.content else {}

    def at(self, base: str) -> Api:
        return Api(base, self.jar, self.email, self.user_id, self.address_id, self.name, self.line1)


def error(r: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert r.status_code == status, (status, r.status_code, r.text[:600])
    body = r.json()
    assert body.get("error") == code and isinstance(body.get("message"), str), body
    return body


def address_body(province: str, name: str, line1: str, default: bool = True) -> dict[str, Any]:
    return {"name": name, "line1": line1, "city": CITY[province], "province": province,
            "postal_code": POSTAL[province], "is_default": default}


def customer(base: str, province: str = "ON") -> Api:
    email, name = identity("shopper")
    a = Api(base)
    r = a.call("POST", "/api/auth/sign-up", {"email": email, "password": SHOPPER_PASSWORD, "name": name[:80]})
    assert r.status_code == 201, r.text
    user = r.json()["user"]
    a.email, a.user_id, a.name = user["email"], user["id"], name[:80]
    line1 = f"1 Leaf Street {email.split('@')[0]}"
    addr = a.ok("POST", "/api/addresses", address_body(province, a.name, line1), 201)["address"]
    a.address_id, a.line1 = addr["id"], addr["line1"]
    return a


def staff(base: str, role: str) -> Api:
    email, password = STAFF[role]
    a = Api(base)
    a.ok("POST", "/api/auth/sign-in", {"email": email, "password": password})
    a.email = email
    return a


def add(a: Api, slug: str, quantity: int = 1) -> dict[str, Any]:
    return a.ok("POST", "/api/cart/items", {"flavour": slug, "quantity": quantity}, 201)


def reserve(a: Api, cans: Any) -> None:
    for slug, qty in cans:
        add(a, slug, qty)


def empty_crate(a: Api) -> None:
    r = a.call("GET", "/api/cart")
    if r.status_code != 200:
        return
    for i, slot in enumerate(r.json()["cart"]["slots"]):
        if slot:
            a.call("DELETE", f"/api/cart/items/{i}")


def checkout_body(a: Api, subscribe: bool = False, cadence: str | None = None,
                  card: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"address_id": a.address_id, "subscribe": subscribe, "cadence": cadence, "card": dict(card or GOOD_CARD)}


def buy(a: Api, cans: Any = DISCOVERY, card: dict[str, Any] | None = None) -> dict[str, Any]:
    reserve(a, cans)
    r = a.call("POST", "/api/checkout", checkout_body(a, card=card), key=idempotency_key())
    assert r.status_code == 201, r.text
    return r.json()


def subscriber(base: str, card: dict[str, Any] | None = None, cans: Any = DISCOVERY,
               cadence: str = "monthly") -> tuple[Api, dict[str, Any], str]:
    a = customer(base, "QC")
    reserve(a, cans)
    r = a.call("POST", "/api/checkout", checkout_body(a, True, cadence, card or GOOD_CARD), key=idempotency_key())
    assert r.status_code == 201, r.text
    body = r.json()
    return a, body["order"], body["subscription_id"]


def quote(base: str, province: str, cans: Any, subscribe: bool = False) -> dict[str, Any]:
    return Api(base).ok("POST", "/api/quote", {"province": province, "subscribe": subscribe,
                                              "cans": [{"flavour": s, "quantity": q} for s, q in cans]})


def flavours(base: str) -> dict[str, dict[str, Any]]:
    return {f["slug"]: f for f in Api(base).ok("GET", "/api/flavours")["flavours"]}


def stock(base: str) -> dict[str, dict[str, Any]]:
    return {f["flavour"]: f for f in staff(base, "fulfilment").ok("GET", "/api/staff/stock")["flavours"]}


def committed(base: str) -> int:
    s = stock(base)["cacao-orange"]
    return s["reserved"] + s["sold"]


@contextlib.contextmanager
def drop_settings(base: str) -> Iterator[Api]:
    owner = staff(base, "owner")
    original = owner.ok("GET", "/api/owner/settings")["drop"]
    try:
        yield owner
    finally:
        owner.ok("PUT", "/api/owner/drop", {"can_price_cents": original["can_price_cents"],
                                            "released": max(original["released"], committed(base))})


@contextlib.contextmanager
def province_settings(base: str, code: str) -> Iterator[tuple[Api, dict[str, Any]]]:
    owner = staff(base, "owner")
    original = next(p for p in owner.ok("GET", "/api/owner/settings")["provinces"] if p["code"] == code)
    try:
        yield owner, original
    finally:
        owner.ok("PUT", f"/api/owner/provinces/{code}", {
            "shipping_cents": original["shipping_cents"],
            "free_shipping_threshold_cents": original["free_shipping_threshold_cents"]})


def sub_of(a: Api, sid: str) -> dict[str, Any]:
    return a.ok("GET", f"/api/subscriptions/{sid}")["subscription"]


def request_change(a: Api, sid: str, body: dict[str, Any]) -> dict[str, Any]:
    r = a.call("POST", f"/api/subscriptions/{sid}/changes", body)
    assert r.status_code == 202, r.text
    change = r.json()["change"]
    assert change["status"] == "pending_provider", change
    return change


def wait_change(a: Api, sid: str, change_id: str) -> dict[str, Any]:
    return poll(lambda: a.ok("GET", f"/api/subscriptions/{sid}/changes/{change_id}")["change"],
                lambda c: c["status"] != "pending_provider", CHANGE_CONFIRM_S + SLACK_S, "change confirmation")


def applied(a: Api, sid: str, body: dict[str, Any]) -> dict[str, Any]:
    change = wait_change(a, sid, request_change(a, sid, body)["id"])
    assert change["status"] == "applied", change
    return change


def nearest(lat: float, lng: float) -> list[tuple[str, float]]:
    def km(b_lat: float, b_lng: float) -> float:
        p1, p2 = math.radians(lat), math.radians(b_lat)
        dp, dl = p2 - p1, math.radians(b_lng - lng)
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))
    ranked = sorted(((km(s_lat, s_lng), name) for name, s_lat, s_lng, _ in STOCKISTS))
    return [(name, d) for d, name in ranked[:5]]


def mine(mail: Mailpit, email: str, subject: str | None = None, settle: float = MAIL_SETTLE_S) -> list[dict[str, Any]]:
    found = []
    for m in mail.messages(0, settle):
        to = [x.lower() for x in addresses(m.get("To"))]
        if email.lower() in to and (subject is None or m.get("Subject") == subject):
            found.append(m)
    return found


def mails(mail: Mailpit, email: str, subject: str, seconds: float = MAIL_S) -> dict[str, Any]:
    poll(lambda: mine(mail, email, subject, settle=0), bool, seconds, f"email {subject!r}")
    got = mine(mail, email, subject)
    assert len(got) == 1, f"{len(got)} emails with subject {subject!r}"
    sender = [x.lower() for x in addresses(got[0].get("From"))]
    assert mail_from_address().lower() in sender, sender
    return got[0]


@functools.lru_cache(maxsize=None)
def db_name(suffix: str = "") -> str:
    return Postgres(suffix).rows("select current_database() as name")[0]["name"]


def kb_account(killbill: KillBill, a: Api) -> dict[str, Any] | None:
    return killbill.account_by_key(a.user_id) or killbill.account(a.email)


def kb_payments(killbill: KillBill, a: Api) -> list[dict[str, Any]]:
    acc = kb_account(killbill, a)
    return killbill.payments(acc["accountId"]) if acc else []


def succeeded(p: dict[str, Any], kind: str = "PURCHASE") -> int:
    return sum(cents(t.get("amount", 0)) for t in p.get("transactions", [])
               if t.get("transactionType") == kind and t.get("status") == "SUCCESS")


def order_payments(killbill: KillBill, a: Api, number: str, suffix: str = "") -> list[dict[str, Any]]:
    p = killbill.payment_by_key(f"{db_name(suffix)}/{number}")
    return [p] if p else []


def kb_sub(killbill: KillBill, a: Api, sid: str) -> dict[str, Any]:
    acc = kb_account(killbill, a)
    assert acc, "no Kill Bill account"
    return next(s for s in killbill.subscriptions(acc["accountId"]) if s.get("subscriptionId") == sid)


def kb_rest(method: str, path: str, params: dict[str, Any] | None = None) -> Any:
    headers = {"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"], "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
               "X-Killbill-CreatedBy": "verifier", "Accept": "application/json"}
    r = httpx.request(method, os.environ["KILLBILL_URL"].rstrip("/") + path, params=params, headers=headers,
                      auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]), timeout=HTTP_TIMEOUT_S)
    assert r.status_code < 300, (path, r.status_code, r.text[:300])
    return r.json() if r.content and "json" in r.headers.get("content-type", "") else None


def kb_raise_renewal(sid: str) -> None:
    sub = kb_rest("GET", f"/1.0/kb/subscriptions/{sid}") or {}
    renewal = str(sub.get("chargedThroughDate") or "")[:10]
    assert renewal and sub.get("accountId"), sub
    kb_rest("POST", "/1.0/kb/invoices", {"accountId": sub["accountId"], "targetDate": renewal})


def kb_blocks(killbill: KillBill, a: Api, kind: str = "SUBSCRIPTION") -> list[dict[str, Any]]:
    acc = kb_account(killbill, a)
    assert acc, "no Kill Bill account"
    return kb_rest("GET", f"/1.0/kb/accounts/{acc['accountId']}/block", {"blockingStateTypes": kind}) or []


def kb_events(sid: str) -> list[dict[str, Any]]:
    return (kb_rest("GET", f"/1.0/kb/subscriptions/{sid}") or {}).get("events", [])


class RealTime:

    def __init__(self, page: Page) -> None:
        self.page, self.last = page, time.monotonic()

    def step(self) -> None:
        now = time.monotonic()
        advance(self.page, max(1.0, (now - self.last) * 1000))
        self.last = now


class Still:

    def step(self) -> None:
        return None


def ui(page: Page, check_fn: Callable[[], None], seconds: float = UI_S, clock: Any = None) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            check_fn()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
        if clock is not None:
            clock.step()
        else:
            advance(page, UI_STEP_MS)


def seen(loc: Locator) -> Locator:
    for i in range(loc.count()):
        if loc.nth(i).is_visible():
            return loc.nth(i)
    return loc.first


def none_seen(loc: Locator) -> bool:
    return not any(loc.nth(i).is_visible() for i in range(loc.count()))


def present(page: Page, loc: Locator, seconds: float = UI_S, clock: Any = None) -> None:
    ui(page, lambda: expect(seen(loc)).to_be_visible(timeout=QUICK_MS), seconds, clock)


def shows(page: Page, loc: Locator, value: Any, seconds: float = UI_S, clock: Any = None) -> None:
    ui(page, lambda: expect(loc.first).to_have_text(value, timeout=QUICK_MS), seconds, clock)


def says(page: Page, loc: Locator, value: Any, seconds: float = UI_S, clock: Any = None) -> None:
    ui(page, lambda: expect(loc.first).to_contain_text(value, timeout=QUICK_MS), seconds, clock)


def named(page: Page, loc: Locator, name: str, seconds: float = UI_S, clock: Any = None) -> None:
    ui(page, lambda: expect(loc).to_have_accessible_name(name, timeout=QUICK_MS), seconds, clock)


def gone(page: Page, loc: Locator, seconds: float = UI_S) -> None:
    ui(page, lambda: expect(loc).to_have_count(0, timeout=QUICK_MS), seconds)


def name_of(loc: Locator) -> str:
    return loc.evaluate(ACC_NAME_JS)


@contextlib.contextmanager
def opened(browser: Browser, base: str, path: str, size: tuple[int, int], reduced: bool = False,
           no_webgl: bool = False) -> Iterator[Page]:
    with entered(open_app(browser, base.rstrip("/") + path, reduced_motion="reduce" if reduced else "no-preference",
                          no_webgl=no_webgl)) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        advance(page, UI_STEP_MS)
        yield page


SELECTED_JS = "(e, v) => [...e.selectedOptions].some(o => (o.label || o.text || '').trim() === v || o.value === v)"


def pick(page: Page, locator: Locator, *choices: str, settle: bool = True) -> None:
    for i, choice in enumerate(choices):
        try:
            select(locator, choice)
            return
        except AssertionError as error:
            if "is not selected" in str(error):
                if settle:
                    ui(page, lambda: _assert_equal(locator.evaluate(SELECTED_JS, choice), True),
                       seconds=QUOTE_S + ROUNDTRIP_S, clock=RealTime(page))
                return
            if "no option" not in str(error) or i == len(choices) - 1:
                raise


LABEL_POINT_JS = """e => {
  const at = t => { t.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
    const b = t.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2, hit = document.elementFromPoint(x, y);
    return hit === t || t.contains(hit) ? {x, y} : null; };
  if (at(e)) return null;
  const label = e.labels && e.labels[0];
  return label ? at(label) : null;
}"""


def choose(control: Locator) -> None:
    if control.is_checked():
        return
    point = control.evaluate(LABEL_POINT_JS)
    if point is None:
        check(control)
        return
    control.page.mouse.click(point["x"], point["y"])
    expect(control).to_be_checked()


def signed_in(page: Page, base: str) -> bool:
    r = page.request.get(base.rstrip("/") + "/api/me")
    try:
        return r.status == 200 and bool((r.json() or {}).get("user"))
    except ValueError:
        return False


def inject(page: Page, base: str, a: Api, path: str) -> None:
    page.context.add_cookies([{"name": k, "value": v, "url": base.rstrip("/") + "/"} for k, v in a.jar.items()])
    page.goto(base.rstrip("/") + path)
    advance(page, UI_STEP_MS)


def tab_to(page: Page, target: Locator, key: str = "Tab", presses: int = TAB_BUDGET) -> None:
    for _ in range(presses):
        if target.evaluate(FOCUSED_JS):
            return
        page.keyboard.press(key)
    raise AssertionError("the control could not be reached by keyboard")


def in_viewport(page: Page, loc: Locator) -> bool:
    box = loc.bounding_box()
    vp = page.viewport_size
    return bool(box and vp and box["x"] < vp["width"] and box["x"] + box["width"] > 0
                and box["y"] < vp["height"] and box["y"] + box["height"] > 0)


def scroll_to(page: Page, y: float) -> None:
    page.evaluate(SCROLL_JS, y)


def slots(page: Page) -> Locator:
    return page.get_by_role("list", name="Crate slots").get_by_role("listitem")


def counter(page: Page) -> Locator:
    return page.get_by_label("Cans in crate").first


def meter(page: Page) -> dict[str, Any]:
    return page.get_by_role("meter", name="Free shipping").first.evaluate(METER_JS)


def card(page: Page, slug: str) -> Locator:
    return page.get_by_role("list", name="Flavours").get_by_role("article").filter(
        has=page.get_by_role("heading", name=NAMES[slug], exact=True))


def show_card(page: Page, slug: str) -> Locator:
    c = card(page, slug)

    def ready() -> None:
        assert c.count() == 1 and c.first.is_visible(), f"{NAMES[slug]} card is not shown"

    try:
        ui(page, ready, seconds=ROUNDTRIP_S)
        return c
    except AssertionError:
        pass
    for label in ("Next flavours", "Previous flavours"):
        nav = page.get_by_role("button", name=label, exact=True)
        for _ in range(len(NAMES)):
            if not nav.count() or not nav.first.is_enabled():
                break
            click(nav.first)
            try:
                ui(page, ready, seconds=ROUNDTRIP_S, clock=RealTime(page))
                return c
            except AssertionError:
                continue
    return c


def flavours_listed(page: Page) -> set[str]:
    found = {slug for slug in FLAVOURS if card(page, slug).count()}
    for label in ("Next flavours", "Previous flavours"):
        nav = page.get_by_role("button", name=label, exact=True)
        for _ in range(len(NAMES)):
            if found == set(FLAVOURS) or not nav.count() or not nav.first.is_enabled():
                break
            click(nav.first)
            advance(page, UI_STEP_MS * 5)
            ui(page, lambda: None, seconds=0.5, clock=RealTime(page))
            found |= {slug for slug in FLAVOURS if card(page, slug).count()}
    return found


def left_text(n: int) -> re.Pattern[str]:
    return re.compile(rf"(^|\D){n} left")


def shows_left(c: Locator, n: int) -> None:
    expect(c.get_by_text(left_text(n)).first).to_be_visible(timeout=QUICK_MS)


SOLD_OUT = "sold out"
CRATE_FULL = "your crate is full"
DROP_FULL = "you can hold up to 6 cans of a limited drop"


def add_name(slug: str) -> str:
    return f"Add {NAMES[slug]}"


def fill_name(slug: str) -> str:
    return f"Fill crate with {NAMES[slug]}"


def remove_name(slug: str, k: int) -> str:
    return f"Remove {NAMES[slug]} from slot {k}"


def cart_name(n: int) -> str:
    return f"Cart ({n})"


def slot_name(k: int, slug: str | None = None, pending: bool = False) -> str:
    if slug is None:
        return f"Slot {k}: empty"
    if pending:
        return f"Slot {k}: {NAMES[slug]}, pending"
    return f"Slot {k}: {NAMES[slug]}"


def added_copy(slug: str, count: int, left: int, shipping: str, added: int | None = None) -> str:
    what = NAMES[slug] if added is None else f"{added} {NAMES[slug]}"
    return f"Added {what}. {count} of 12 cans in your crate. {left} left. {shipping}"


def removed_copy(slug: str, count: int, shipping: str) -> str:
    return f"Removed {NAMES[slug]}. {count} of 12 cans in your crate. {shipping}"


def refused_copy(slug: str, reason: str, count: int, left: int, shipping: str) -> str:
    return f"Couldn't add {NAMES[slug]}: {reason}. {count} of 12 cans in your crate. {left} left. {shipping}".rstrip()


def refund_copy(amount: int, confirmed: bool) -> str:
    if confirmed:
        return f"Refund of {money(amount)} confirmed."
    return f"Refund of {money(amount)} sent to billing. Waiting for confirmation."


def page_cart(page: Page, base: str) -> dict[str, Any]:
    return page.request.get(base.rstrip("/") + "/api/cart").json()["cart"]


def reach(page: Page, button: Locator) -> None:
    present(page, page.get_by_role("list", name="Flavours").or_(button))

    def hittable() -> None:
        assert button.count() and button.first.is_visible(), "the button is not shown"
        center(button)

    try:
        ui(page, hittable, seconds=ROUNDTRIP_S)
        return
    except AssertionError:
        pass
    for label in ("Next flavours", "Previous flavours"):
        nav = page.get_by_role("button", name=label, exact=True)
        for _ in range(len(NAMES)):
            if not nav.count() or not nav.first.is_enabled():
                break
            click(nav.first)
            try:
                ui(page, hittable, seconds=ROUNDTRIP_S, clock=RealTime(page))
                return
            except AssertionError:
                continue
    center(button)


def press(page: Page, button: Locator) -> None:
    reach(page, button)
    click(button)


def page_add(page: Page, base: str, slug: str, n: int) -> None:
    button = page.get_by_role("button", name=f"Add {NAMES[slug]}")
    reach(page, button)
    for _ in range(n):
        before = page_cart(page, base)["count"]
        press(page, button)
        ui(page, lambda: _assert_equal(page_cart(page, base)["count"], before + 1))
    count = page_cart(page, base)["count"]
    counter_shows(page, count)


def page_empty(page: Page, base: str) -> None:
    with contextlib.suppress(Exception):
        for i, slot in enumerate(page_cart(page, base)["slots"]):
            if slot:
                page.request.delete(f"{base.rstrip('/')}/api/cart/items/{i}")


def counter_shows(page: Page, n: int, seconds: float = UI_S, clock: Any = None) -> None:
    pattern = re.compile(rf"(^|\D){n:02d}/12(\D|$)")

    def check_value() -> None:
        got = counter(page).evaluate(COUNTER_JS)
        assert any(pattern.search(t) for t in got), got

    ui(page, check_value, seconds, clock)


def own_clock(path: list[dict[str, float]]) -> list[dict[str, float]]:
    if path and all("dt" in sample for sample in path):
        start = float(path[0]["dt"])
        return [{**sample, "t": (float(sample["dt"]) - start) * 1000} for sample in path]
    return path


def settle_ms(path: list[dict[str, float]], duration_ms: float) -> float:
    if len(path) < 2:
        return 0.0
    step = duration_ms / (len(path) - 1)
    final = path[-1]

    def stamp(i: int) -> float:
        return float(path[i].get("t", i * step)) - float(path[0].get("t", 0))

    def same(sample: dict[str, float]) -> bool:
        for key, value in final.items():
            if key == "t" or not isinstance(value, (int, float)):
                continue
            tolerance = 0.5 if abs(value) > 2 else 0.02
            if abs(float(sample.get(key, value)) - float(value)) > tolerance:
                return False
        return True

    for i in range(len(path) - 1, -1, -1):
        if not same(path[i]):
            return stamp(min(i + 1, len(path) - 1))
    return 0.0


def breakdown_rows(q: dict[str, Any]) -> list[tuple[str, str]]:
    rows = [("Subtotal", money(q["goods_cents"]))]
    if q["subscribe"]:
        rows.append(("Subscribe & save (10%)", "-" + money(q["discount_cents"])))
    rows.append(("Deposit", money(q["deposit_cents"])))
    rows.append(("Shipping", "Free" if q["shipping_cents"] == 0 else money(q["shipping_cents"])))
    for t in q["taxes"]:
        rows.append((f"{t['name']} ({rate_label(t['rate'])}%)", money(t["cents"])))
    rows.append(("Total", money(q["total_cents"])))
    return rows


def assert_rows(table: Locator, q: dict[str, Any]) -> None:
    for label, amount in breakdown_rows(q):
        pattern = re.compile(rf"^\s*{re.escape(label)}\s+{re.escape(amount)}\s*$")
        expect(table.get_by_role("row", name=pattern)).to_have_count(1, timeout=QUICK_MS)


CAN_NAME = re.compile(r"^(Guava & Lime|Yuzu Ginger|Passionfruit Basil|Cacao Orange) can, turned (\d{1,3}) degrees$")


def can(page: Page) -> Locator:
    return page.get_by_role("img", name=CAN_NAME).first


def can_state(page: Page) -> tuple[str, int]:
    label = name_of(can(page))
    m = CAN_NAME.match(label)
    assert m, label
    angle = int(m.group(2))
    assert 0 <= angle <= 359, angle
    return m.group(1), angle


def turned(a: int, b: int) -> int:
    d = (b - a) % 360
    return d - 360 if d > 180 else d


def test_wf_storefront_scenes_viewports(browser: Browser, app_url: str) -> None:
    for size in (PHONE, TABLET, DESKTOP, WIDE):
        for reduced in (False, True):
            with opened(browser, app_url, "/", size, reduced=reduced) as page:
                tops = []
                for name, heading, message in SCENES:
                    region = page.get_by_role("region", name=name)
                    present(page, region)
                    box = region.bounding_box()
                    assert box and box["height"] >= size[1] - 1, (name, size, box)
                    tops.append(region.evaluate(TOP_JS))
                    scroll_to(page, tops[-1])
                    msg = region.get_by_text(message, exact=True)
                    msg.scroll_into_view_if_needed()
                    if reduced:
                        ui(page, lambda: expect(msg).to_be_visible(timeout=QUICK_MS), clock=Still())
                    else:
                        advance(page, SCENE_FADE_MS + MESSAGE_RISE_MS)
                    expect(region.get_by_role("heading", name=heading)).to_have_count(1)
                    ui(page, lambda: _assert_equal(msg.evaluate(OPACITY_JS) >= 0.99, True),
                       clock=Still() if reduced else None)
                    assert in_viewport(page, msg), (name, size)
                assert tops == sorted(tops) and len(set(tops)) == 4, tops
                night = page.get_by_role("region", name="Night sky")
                for q in FAQ:
                    expect(night.get_by_role("button", name=q)).to_have_count(1)
                expect(page.get_by_role("region", name="Orchard").get_by_role("link", name="Build your crate")).to_have_count(1)
                scroll_to(page, tops[0])
                advance(page, UI_STEP_MS)
                canopy_msg = page.get_by_role("region", name="Canopy").get_by_text(SCENES[0][2], exact=True)
                if size[0] >= DESKTOP[0]:
                    can_box, msg_box = can(page).bounding_box(), canopy_msg.bounding_box()
                    assert can_box["x"] + can_box["width"] / 2 > size[0] / 2, "can pinned in the right half"
                    assert msg_box["x"] + msg_box["width"] / 2 < size[0] / 2, "message in the left half"
                elif size == PHONE:
                    can_box, msg_box = can(page).bounding_box(), canopy_msg.bounding_box()
                    assert can_box["y"] + can_box["height"] <= msg_box["y"] + 1, "can above the message"
                layout(page)


def test_wf_storefront_scenes_turntable(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/", DESKTOP, reduced=True) as page:
        present(page, can(page))
        flavour, a0 = can_state(page)
        assert flavour == "Guava & Lime"
        frames = scene_frames(can(page))
        assert any(f.get("draws") for f in frames), "the 3D can must render"
        assert decode(frames[0]["png"]).variance() > 0
        with pytest.raises(AssertionError):
            changed(decode(frames[0]["png"]), decode(frames[-1]["png"]))
        before_frame = decode(capture(can(page)))
        click(page.get_by_role("button", name="Turn can right"))
        advance(page, TURN_ANIM_MS)
        right = turned(a0, can_state(page)[1])
        assert abs(right) == TURN_STEP_DEG, right
        assert difference(before_frame, decode(capture(can(page)))) > 0, "the rendered can must turn with the button"
        click(page.get_by_role("button", name="Turn can left"))
        advance(page, TURN_ANIM_MS)
        assert can_state(page)[1] == a0
        can(page).focus()
        page.keyboard.press("ArrowRight")
        advance(page, TURN_ANIM_MS)
        assert turned(a0, can_state(page)[1]) == right
        page.keyboard.press("ArrowLeft")
        advance(page, TURN_ANIM_MS)
        assert can_state(page)[1] == a0
        box = can(page).bounding_box()
        y = box["y"] + box["height"] / 2
        page.mouse.move(box["x"] + 1, y)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] - 1, y, steps=12)
        page.mouse.up()
        advance(page, TURN_ANIM_MS)
        dragged = turned(a0, can_state(page)[1])
        assert abs(abs(dragged) - DRAG_TURN_DEG) <= TURN_STEP_DEG, dragged
        still = can_state(page)[1]
        scroll_to(page, page.get_by_role("region", name="River").evaluate(TOP_JS))
        advance(page, SCROLL_STEP_MS)
        assert can_state(page)[1] == still, "reduced motion: scroll does not turn the can"

    with opened(browser, app_url, "/", PHONE, reduced=True) as page:
        present(page, can(page))
        _, a = can_state(page)
        box = can(page).bounding_box()
        for label in ("Turn can left", "Turn can right"):
            b = page.get_by_role("button", name=label).bounding_box()
            assert b["y"] >= box["y"] + box["height"] - 1, f"{label} sits under the can on phones"
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        y = box["y"] + box["height"] / 2
        xs = [box["x"] + 1 + (box["width"] - 2) * i / 8 for i in range(9)]
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": xs[0], "y": y}]})
        for x in xs[1:]:
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        advance(page, TURN_ANIM_MS)
        swiped = turned(a, can_state(page)[1])
        assert abs(abs(swiped) - DRAG_TURN_DEG) <= TURN_STEP_DEG, swiped

    with opened(browser, app_url, "/", DESKTOP) as page:
        present(page, can(page))
        _, a = can_state(page)
        advance(page, IDLE_TURN_MAX_S * 1000 // 4)
        assert turned(a, can_state(page)[1]) != 0, "the idle can turns"
        click(page.get_by_role("button", name="Turn can right"))
        advance(page, TURN_ANIM_MS * 2)
        _, rest = can_state(page)
        advance(page, INPUT_PAUSE_S * 1000 - TURN_ANIM_MS * 3)
        assert can_state(page)[1] == rest, "no idle turn within 5 s of input"
        advance(page, IDLE_TURN_MAX_S * 1000 // 4 + TURN_ANIM_MS * 3)
        assert can_state(page)[1] != rest, "the idle turn resumes"

    with opened(browser, app_url, "/", DESKTOP) as page:
        present(page, can(page))
        canopy = page.get_by_role("region", name="Canopy").evaluate(TOP_JS)
        river = page.get_by_role("region", name="River").evaluate(TOP_JS)
        steps = [canopy + (river - canopy) * i / 4 for i in range(5)]
        tolerance = 360 * (SCROLL_STEP_MS * 10) / (IDLE_TURN_MIN_S * 1000) + 1
        scroll_to(page, steps[0])
        advance(page, SCROLL_STEP_MS)
        start = can_state(page)[1]
        forward = []
        for y in steps[1:]:
            scroll_to(page, y)
            advance(page, SCROLL_STEP_MS)
            forward.append(turned(start, can_state(page)[1]))
        assert abs(abs(forward[-1]) - SCROLL_TURN_DEG) <= tolerance, forward
        sign = 1 if forward[-1] > 0 else -1
        assert all(sign * (b - a) >= -tolerance for a, b in zip([0] + forward, forward)), forward
        assert can_state(page)[0] == "Yuzu Ginger"
        back = []
        for y in reversed(steps[:-1]):
            scroll_to(page, y)
            advance(page, SCROLL_STEP_MS)
            back.append(turned(start, can_state(page)[1]))
        assert all(sign * (a - b) >= -tolerance for a, b in zip([forward[-1]] + back, back)), back
        assert abs(back[-1]) <= tolerance, back
        assert can_state(page)[0] == "Guava & Lime"


def test_can_fallback(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/", DESKTOP, reduced=True, no_webgl=True) as page:
        present(page, can(page))
        flavour, a = can_state(page)
        assert flavour == "Guava & Lime"
        before = decode(capture(can(page)))
        assert before.variance() > 0, "the fallback draws the can"
        click(page.get_by_role("button", name="Turn can right"))
        advance(page, TURN_ANIM_MS)
        assert abs(turned(a, can_state(page)[1])) == TURN_STEP_DEG
        changed(before, decode(capture(can(page))))
        can(page).focus()
        page.keyboard.press("ArrowLeft")
        advance(page, TURN_ANIM_MS)
        assert can_state(page)[1] == a


def test_wf_storefront_scenes_closed_panels(browser: Browser, app_url: str) -> None:
    for size in (PHONE, TABLET, DESKTOP):
        with opened(browser, app_url, "/", size) as page:
            cart = page.get_by_role("dialog", name="Cart")
            expect(cart).to_have_count(0)
            names = tab_order(page, TAB_PRESSES)
            assert "Close cart" not in names and "Checkout" not in names, names
            layout(page)
            cart_btn = page.get_by_role("button", name=re.compile(r"^Cart \(\d+\)$")).first
            cart_btn.focus()
            page.keyboard.press("Enter")
            present(page, cart)
            advance(page, DRAWER_IN_MS * 2)
            assert in_viewport(page, cart)
            page.keyboard.press("Escape")
            advance(page, DRAWER_OUT_MS * 2)
            gone(page, cart)
            page.keyboard.press("Home")
            assert "Close cart" not in tab_order(page, TAB_PRESSES)
            first = page.get_by_role("button", name=FAQ[0])
            first.scroll_into_view_if_needed()
            expect(first).to_have_attribute("aria-expanded", "false")
            expect(page.get_by_role("region", name=FAQ[0])).to_have_count(0)
            click(first)
            present(page, page.get_by_role("region", name=FAQ[0]))
            expect(first).to_have_attribute("aria-expanded", "true")
            click(first)
            gone(page, page.get_by_role("region", name=FAQ[0]))
            first.focus()
            page.keyboard.press("ArrowDown")
            second = page.get_by_role("button", name=FAQ[1])
            expect(second).to_be_focused()
            page.keyboard.press("Enter")
            present(page, page.get_by_role("region", name=FAQ[1]))
            page.keyboard.press("Space")
            gone(page, page.get_by_role("region", name=FAQ[1]))
            page.keyboard.press("ArrowUp")
            expect(first).to_be_focused()
            if size == PHONE:
                menu = page.get_by_role("button", name="Menu")
                scroll_to(page, 0)
                expect(menu).to_have_attribute("aria-expanded", "false")
                nav_links = page.get_by_role("navigation", name="Main").get_by_role("link")
                expect(nav_links).to_have_count(0)
                menu.focus()
                page.keyboard.press("Enter")
                advance(page, DRAWER_IN_MS * 2)
                expect(menu).to_have_attribute("aria-expanded", "true")
                expect(nav_links.first).to_be_focused()
                for label in ("Shop", "Flavours", "Subscribe", "Stockists", "Account"):
                    expect(nav_links.filter(has_text=label)).to_have_count(1)
                page.keyboard.press("Escape")
                advance(page, DRAWER_IN_MS * 2)
                expect(menu).to_be_focused()
                expect(menu).to_have_attribute("aria-expanded", "false")
                gone(page, nav_links)
                layout(page)


def test_live_flavour_cards(browser: Browser, app_url: str) -> None:
    other = Api(app_url)
    with opened(browser, app_url, "/box", DESKTOP) as page:
        try:
            listing = page.get_by_role("list", name="Flavours")
            present(page, listing)
            assert flavours_listed(page) == set(FLAVOURS), "the Flavours list holds one card per flavour (L144, L220)"
            current = flavours(app_url)
            for slug in FLAVOURS:
                c = show_card(page, slug)
                expect(c).to_have_count(1)
                expect(c).to_contain_text(money(current[slug]["can_price_cents"]))
                ui(page, lambda: shows_left(c, flavours(app_url)[slug]["stock_left"]))
            add(other, "guava-lime")
            after = flavours(app_url)["guava-lime"]["stock_left"]
            assert after == current["guava-lime"]["stock_left"] - 1
            ui(page, lambda: shows_left(show_card(page, "guava-lime"), after),
               seconds=STOCK_LIVE_S + ROUNDTRIP_S, clock=RealTime(page))
            empty_crate(other)
            back = flavours(app_url)["guava-lime"]["stock_left"]
            ui(page, lambda: shows_left(show_card(page, "guava-lime"), back),
               seconds=STOCK_LIVE_S + ROUNDTRIP_S, clock=RealTime(page))
        finally:
            empty_crate(other)


def test_wf_crate_drop_add_sequence(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/box", DESKTOP) as page:
        try:
            s = slots(page)
            add_btn = page.get_by_role("button", name=add_name("guava-lime"))
            reach(page, add_btn)
            named(page, s.nth(0), slot_name(1))
            with entered(held(page, "**/api/cart/items")) as gate:
                press(page, add_btn)
                assert name_of(s.nth(0)) != slot_name(1, "guava-lime", True), "the can lifts and flies before it lands"
                advance(page, LIFT_MAX_MS + FLIGHT_MAX_MS)
                named(page, s.nth(0), slot_name(1, "guava-lime", True), clock=Still())
                counter_shows(page, 0, clock=Still())
                expect(add_btn).to_be_focused()
                gate.release()
            named(page, s.nth(0), slot_name(1, "guava-lime"), clock=Still())
            fill_path = own_clock(motion(s.nth(0), FILL_MAX_MS * 2))
            assert settle_ms(fill_path, FILL_MAX_MS * 2) <= FILL_MAX_MS + UI_STEP_MS, fill_path
            counter_shows(page, 1)
            q = quote(app_url, "ON", (("guava-lime", 1),))
            ui(page, lambda: _assert_equal(float(meter(page)["value"]), float(q["free_shipping"]["progress_percent"])))
            assert meter(page)["text"] == phrase(q["free_shipping"]["remaining_cents"], "Ontario")
            left = flavours(app_url)["guava-lime"]["stock_left"]
            ui(page, lambda: shows_left(show_card(page, "guava-lime"), left))
            press(page, page.get_by_role("button", name=add_name("yuzu-ginger")))
            named(page, s.nth(1), slot_name(2, "yuzu-ginger"))
            counter_shows(page, 2)
            expect(s.nth(0)).to_have_accessible_name(slot_name(1, "guava-lime"))
        finally:
            page_empty(page, app_url)


def test_wf_crate_drop_sold_out(browser: Browser, app_url: str) -> None:
    holder = Api(app_url)
    with drop_settings(app_url) as owner:
        try:
            owner.ok("PUT", "/api/owner/drop", {"released": committed(app_url) + 1})
            threshold = next(p for p in owner.ok("GET", "/api/owner/settings")["provinces"]
                             if p["code"] == "ON")["free_shipping_threshold_cents"]
            with opened(browser, app_url, "/", DESKTOP) as page:
                page.route("**/api/live", lambda route: route.abort())
                page.goto(app_url + "/box")
                try:
                    add_btn = page.get_by_role("button", name=add_name("cacao-orange"))
                    reach(page, add_btn)
                    add(holder, "cacao-orange")
                    ui(page, lambda: _assert_equal(bool(meter(page)["text"]), True))
                    before_meter = meter(page)
                    press(page, add_btn)
                    status = page.get_by_role("status", name="Crate updates")
                    shows(page, status, refused_copy("cacao-orange", SOLD_OUT, 0, 0, phrase(threshold, "Ontario")),
                          clock=RealTime(page))
                    advance(page, RETURN_MAX_MS * 2)
                    expect(slots(page).nth(0)).to_have_accessible_name(slot_name(1))
                    counter_shows(page, 0, clock=Still())
                    assert meter(page) == before_meter
                    expect(show_card(page, "cacao-orange").get_by_text("Sold out", exact=True)).to_be_visible()
                    assert page_cart(page, app_url)["count"] == 0
                finally:
                    page_empty(page, app_url)
        finally:
            empty_crate(holder)


def test_remove_can(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/box", DESKTOP) as page:
        try:
            for slug in ("guava-lime", "yuzu-ginger", "passionfruit-basil"):
                page_add(page, app_url, slug, 1)
            held_stock = flavours(app_url)["yuzu-ginger"]["stock_left"]
            click(page.get_by_role("button", name=remove_name("yuzu-ginger", 2)))
            s = slots(page)
            named(page, s.nth(1), slot_name(2))
            expect(s.nth(0)).to_have_accessible_name(slot_name(1, "guava-lime"))
            expect(s.nth(2)).to_have_accessible_name(slot_name(3, "passionfruit-basil"))
            counter_shows(page, 2)
            cart = page_cart(page, app_url)
            assert cart["slots"][1] is None and cart["slots"][0]["flavour"] == "guava-lime"
            assert cart["slots"][2]["flavour"] == "passionfruit-basil"
            assert flavours(app_url)["yuzu-ginger"]["stock_left"] == held_stock + 1
            q = quote(app_url, "ON", (("guava-lime", 1), ("passionfruit-basil", 1)))
            ui(page, lambda: _assert_equal(float(meter(page)["value"]), float(q["free_shipping"]["progress_percent"])))
        finally:
            page_empty(page, app_url)


def test_crate_announcements(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/box", DESKTOP) as page:
        try:
            status = page.get_by_role("status", name="Crate updates")
            add_btn = page.get_by_role("button", name=add_name("guava-lime"))
            reach(page, add_btn)
            press(page, add_btn)
            one = quote(app_url, "ON", (("guava-lime", 1),))["free_shipping"]["remaining_cents"]
            left = flavours(app_url)["guava-lime"]["stock_left"]
            shows(page, status, added_copy("guava-lime", 1, left, phrase(one, "Ontario")))
            threshold = next(p for p in staff(app_url, "owner").ok("GET", "/api/owner/settings")["provinces"]
                             if p["code"] == "ON")["free_shipping_threshold_cents"]
            click(page.get_by_role("button", name=remove_name("guava-lime", 1)))
            shows(page, status, removed_copy("guava-lime", 0, phrase(threshold, "Ontario")))
            press(page, page.get_by_role("button", name=fill_name("yuzu-ginger")))
            ui(page, lambda: _assert_equal(page_cart(page, app_url)["count"], CRATE_SIZE))
            full = quote(app_url, "ON", (("yuzu-ginger", CRATE_SIZE),))["free_shipping"]["remaining_cents"]
            yuzu = flavours(app_url)["yuzu-ginger"]["stock_left"]
            shows(page, status, added_copy("yuzu-ginger", CRATE_SIZE, yuzu, phrase(full, "Ontario"), added=CRATE_SIZE))
            press(page, add_btn)
            guava = flavours(app_url)["guava-lime"]["stock_left"]
            shows(page, status, refused_copy("guava-lime", CRATE_FULL, CRATE_SIZE, guava, phrase(full, "Ontario")))
            page_empty(page, app_url)
            page.reload()
            fill_drop = page.get_by_role("button", name=fill_name("cacao-orange"))
            press(page, fill_drop)
            cacao = flavours(app_url)["cacao-orange"]["stock_left"]
            shows(page, page.get_by_role("status", name="Crate updates"),
                  refused_copy("cacao-orange", DROP_FULL, 0, cacao, phrase(threshold, "Ontario")))
        finally:
            page_empty(page, app_url)


def box_layout(page: Page, size: tuple[int, int]) -> None:
    if size[0] < DESKTOP[0]:
        layout(page)
        return
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    carousel = page.get_by_role("list", name="Flavours").element_handle()
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if control.is_visible() and not control.evaluate("(e, list) => list.contains(e)", carousel):
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            box = control.bounding_box()
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= size[0] + 1, box


def test_crate_layout(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/box", PHONE) as page:
        for size in (PHONE, TABLET, DESKTOP, WIDE):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            scroll_to(page, 0)
            advance(page, UI_STEP_MS)
            grid = page.get_by_role("list", name="Crate slots")
            present(page, grid)
            s = slots(page)
            expect(s).to_have_count(CRATE_SIZE)
            boxes = [s.nth(i).bounding_box() for i in range(CRATE_SIZE)]
            xs = {round(b["x"]) for b in boxes}
            ys = {round(b["y"]) for b in boxes}
            assert sorted((len(xs), len(ys))) == [3, 4], (size, xs, ys)
            assert [i for i, _ in sorted(enumerate(boxes), key=lambda t: (round(t[1]["y"]), round(t[1]["x"])))] == list(range(CRATE_SIZE))
            gbox = grid.bounding_box()
            if size == PHONE:
                assert gbox["y"] + gbox["height"] <= size[1] + 1
                top = min(gbox["y"], counter(page).bounding_box()["y"])
                assert top >= size[1] * (1 - SHEET_MAX_FRACTION) - 1, "bottom sheet height"
                assert all(b["width"] >= TOUCH_MIN_PX and b["height"] >= TOUCH_MIN_PX for b in boxes)
                expect(page.get_by_role("region", name="Order total")).to_have_count(0)
                scroll_to(page, page.evaluate("() => document.documentElement.scrollHeight"))
                advance(page, UI_STEP_MS)
                assert abs(grid.bounding_box()["y"] - gbox["y"]) <= 1, "the sheet stays pinned"
                last = page.get_by_role("list", name="Flavours").get_by_role("article").last
                lb = last.bounding_box()
                assert lb["y"] + lb["height"] <= min(grid.bounding_box()["y"], counter(page).bounding_box()["y"]) + 1
                page.get_by_role("button", name=cart_name(0)).first.click()
                dialog = page.get_by_role("dialog", name="Cart")
                present(page, dialog)
                present(page, dialog.get_by_role("region", name="Order total"))
                page.keyboard.press("Escape")
                advance(page, DRAWER_OUT_MS * 2)
            else:
                crate = page.get_by_role("region", name="Crate")
                present(page, crate)
                cbox = crate.bounding_box()
                assert cbox["x"] >= size[0] / 2 - 1, "crate on the right"
                assert cbox["x"] + cbox["width"] <= size[0] + 1
                lst = page.get_by_role("list", name="Flavours").bounding_box()
                assert lst["x"] + lst["width"] <= cbox["x"] + 1, "flavours to the left of the crate"
                total = page.get_by_role("region", name="Order total")
                expect(total).to_have_count(1)
                tbox = total.bounding_box()
                assert tbox and tbox["x"] >= size[0] / 2 - 1 and tbox["x"] + tbox["width"] <= size[0] + 1, (
                    "order total in the crate panel on the right")
                if size[0] >= DESKTOP[0]:
                    widths = crate.evaluate(RAIL_JS, total.element_handle())
                    assert any(RAIL_MIN_PX - 1 <= w <= RAIL_MAX_PX + 1 for w in widths), ("rail width", widths)
                    for label in ("Previous flavours", "Next flavours"):
                        present(page, page.get_by_role("button", name=label))
                    scroll_to(page, size[1])
                    advance(page, UI_STEP_MS)
                    after = crate.bounding_box()
                    assert after and -1 <= after["y"] <= cbox["y"] + 1 and abs(after["x"] - cbox["x"]) <= 1, (
                        "the rail stays visible while the left side scrolls", cbox, after)
            box_layout(page, size)


def test_wf_crate_drop_reduced_motion(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/box", DESKTOP, reduced=True) as page:
        try:
            s = slots(page)
            add_btn = page.get_by_role("button", name=add_name("guava-lime"))
            reach(page, add_btn)
            with entered(held(page, "**/api/cart/items")) as gate:
                press(page, add_btn)
                named(page, s.nth(0), slot_name(1, "guava-lime", True), seconds=ROUNDTRIP_S, clock=Still())
                gate.release()
            named(page, s.nth(0), slot_name(1, "guava-lime"), clock=Still())
            fade = own_clock(motion(s.nth(0), REDUCED_FADE_MAX_MS * 2))
            assert settle_ms(fade, REDUCED_FADE_MAX_MS * 2) <= REDUCED_FADE_MAX_MS + UI_STEP_MS, fade
            counter_shows(page, 1, seconds=ROUNDTRIP_S, clock=Still())
            q = quote(app_url, "ON", (("guava-lime", 1),))
            ui(page, lambda: _assert_equal(float(meter(page)["value"]), float(q["free_shipping"]["progress_percent"])),
               seconds=ROUNDTRIP_S, clock=Still())
            left = flavours(app_url)["guava-lime"]["stock_left"]
            shows(page, page.get_by_role("status", name="Crate updates"),
                  added_copy("guava-lime", 1, left, phrase(q["free_shipping"]["remaining_cents"], "Ontario")))
        finally:
            page_empty(page, app_url)


def test_keyboard_crate_and_drawer(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/box", DESKTOP) as page:
        try:
            s = slots(page)
            add_btn = page.get_by_role("button", name=add_name("guava-lime"))
            reach(page, add_btn)
            tab_to(page, add_btn)
            page.keyboard.press("Enter")
            named(page, s.nth(0), slot_name(1, "guava-lime"))
            page.keyboard.press("Space")
            named(page, s.nth(1), slot_name(2, "guava-lime"))
            expect(add_btn).to_be_focused()
            tab_to(page, page.get_by_role("button", name=remove_name("guava-lime", 1)))
            page.keyboard.press("Delete")
            named(page, s.nth(0), slot_name(1))
            second = page.get_by_role("button", name=remove_name("guava-lime", 2))
            ui(page, lambda: expect(second).to_be_focused(timeout=QUICK_MS))
            page.keyboard.press("Backspace")
            named(page, s.nth(1), slot_name(2))
            first_add = page.get_by_role("list", name="Flavours").get_by_role("button", name=re.compile(r"^Add ")).first
            ui(page, lambda: expect(first_add).to_be_focused(timeout=QUICK_MS))
            page.keyboard.press("Enter")
            cart_btn = page.get_by_role("button", name=cart_name(1)).first
            present(page, cart_btn)
            tab_to(page, cart_btn, key="Shift+Tab")
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Cart")
            present(page, dialog)
            ui(page, lambda: expect(dialog.get_by_role("heading", name="Your cart")).to_be_focused(timeout=QUICK_MS))
            for key in ["Tab"] * TAB_PRESSES + ["Shift+Tab"] * TAB_PRESSES:
                page.keyboard.press(key)
                assert dialog.evaluate(CONTAINS_FOCUS_JS), f"focus escaped the cart drawer after {key}"
            page.keyboard.press("Escape")
            advance(page, DRAWER_OUT_MS * 2)
            ui(page, lambda: expect(cart_btn).to_be_focused(timeout=QUICK_MS))
            gone(page, dialog)
            page.keyboard.press("Enter")
            present(page, dialog)
            advance(page, DRAWER_IN_MS * 2)
            page.keyboard.press("Escape")
            advance(page, DRAWER_OUT_MS // 2)
            cart_btn.focus()
            page.keyboard.press("Enter")
            advance(page, (DRAWER_OUT_MS + DRAWER_IN_MS) * 2)
            present(page, dialog)
            assert in_viewport(page, dialog), "pressing Cart during the close animation keeps the drawer open"
            close = dialog.get_by_role("button", name="Close cart")
            tab_to(page, close)
            page.keyboard.press("Enter")
            advance(page, DRAWER_OUT_MS * 2)
            gone(page, dialog)
        finally:
            page_empty(page, app_url)


def test_quote_validation(app_url: str) -> None:
    api = Api(app_url)
    for code, lines in TAX_LINES.items():
        q = quote(app_url, code, (("passionfruit-basil", 2), ("guava-lime", 1)))
        assert q["province"] == code and q["subscribe"] is False
        assert [l["flavour"] for l in q["lines"]] == ["guava-lime", "passionfruit-basil"]
        assert [(t["name"], t["rate"]) for t in q["taxes"]] == lines
        for key in ("goods_cents", "discount_cents", "discounted_goods_cents", "shipping_cents", "deposit_cents", "total_cents"):
            assert isinstance(q[key], int), key
        assert set(q["free_shipping"]) >= {"threshold_cents", "remaining_cents", "progress_percent"}
    body = lambda **kw: dict({"province": "ON", "subscribe": False, "cans": [{"flavour": "guava-lime", "quantity": 1}]}, **kw)
    err = error(api.call("POST", "/api/quote", body(province="YT")), 422, "validation")
    assert err["fields"]["province"] == "We don't ship to that province yet."
    assert "cans" in error(api.call("POST", "/api/quote", body(cans=[{"flavour": "mango", "quantity": 1}])), 422, "validation")["fields"]
    assert "cans" in error(api.call("POST", "/api/quote", body(cans=[{"flavour": "guava-lime", "quantity": 0}])), 422, "validation")["fields"]
    over = [{"flavour": "guava-lime", "quantity": 7}, {"flavour": "yuzu-ginger", "quantity": 6}]
    assert "cans" in error(api.call("POST", "/api/quote", body(cans=over)), 422, "validation")["fields"]
    err = error(api.call("POST", "/api/quote", body(subscribe=True, cans=[{"flavour": "cacao-orange", "quantity": 1}])), 422, "validation")
    assert err["fields"]["subscribe"] == "Limited drops can't be added to a subscription."


EXAMPLES = {
    "qc-subscribe": ("QC", True, DISCOVERY, {"goods_cents": 3996, "discount_cents": 400, "discounted_goods_cents": 3596,
                                             "shipping_cents": 0, "deposit_cents": 120, "total_cents": 4255},
                     [("GST", 180), ("QST", 359)], [134, 133, 133]),
    "ab-subscribe": ("AB", True, DISCOVERY, {"discounted_goods_cents": 3596, "shipping_cents": 1495,
                                             "deposit_cents": 120, "total_cents": 5466},
                     [("GST", 255)], [134, 133, 133]),
    "on-one-off": ("ON", False, (("guava-lime", 6), ("cacao-orange", 6)),
                   {"goods_cents": 4248, "shipping_cents": 0, "deposit_cents": 0, "total_cents": 4800},
                   [("HST", 552)], [0, 0]),
    "bc-one-off": ("BC", False, (("yuzu-ginger", 12),),
                   {"goods_cents": 3996, "shipping_cents": 1495, "deposit_cents": 120, "total_cents": 6270},
                   [("GST", 275), ("PST", 384)], [0]),
}


EXAMPLE_IDS = ["qc-subscribe", "ab-subscribe", "on-one-off", "bc-one-off"]


@pytest.mark.parametrize("case", EXAMPLE_IDS, ids=EXAMPLE_IDS)
def test_quote_worked_examples(app_url: str, case: str) -> None:
    province, subscribe, cans, figures, taxes, split = EXAMPLES[case]
    q = quote(app_url, province, cans, subscribe)
    for key, value in figures.items():
        assert q[key] == value, (key, q[key], value)
    assert [(t["name"], t["cents"]) for t in q["taxes"]] == taxes
    assert [l["discount_cents"] for l in q["lines"]] == split
    assert sum(l["goods_cents"] for l in q["lines"]) == q["goods_cents"]
    assert q["total_cents"] == q["discounted_goods_cents"] + q["shipping_cents"] + q["deposit_cents"] + sum(t["cents"] for t in q["taxes"])


def test_free_shipping_threshold(browser: Browser, app_url: str) -> None:
    price = flavours(app_url)["guava-lime"]["can_price_cents"]
    ten = (("guava-lime", 10),)
    goods = 10 * price
    with province_settings(app_url, "NS") as (owner, original):
        rate = original["shipping_cents"]
        owner.ok("PUT", "/api/owner/provinces/NS", {"shipping_cents": rate, "free_shipping_threshold_cents": goods})
        q = quote(app_url, "NS", ten)
        assert q["shipping_cents"] == 0
        assert q["free_shipping"] == {"threshold_cents": goods, "remaining_cents": 0, "progress_percent": 100}
        owner.ok("PUT", "/api/owner/provinces/NS", {"shipping_cents": rate, "free_shipping_threshold_cents": goods + 1})
        q = quote(app_url, "NS", ten)
        assert q["shipping_cents"] == rate
        assert q["free_shipping"]["remaining_cents"] == 1
        assert q["free_shipping"]["progress_percent"] == goods * 100 // (goods + 1)
        empty = quote(app_url, "NS", ())
        assert empty["shipping_cents"] == 0 and empty["free_shipping"]["remaining_cents"] == goods + 1
        sub = quote(app_url, "NS", (("guava-lime", 12),), True)
        owner.ok("PUT", "/api/owner/provinces/NS", {"shipping_cents": rate,
                                                    "free_shipping_threshold_cents": sub["discounted_goods_cents"] + 1})
        sub = quote(app_url, "NS", (("guava-lime", 12),), True)
        assert sub["goods_cents"] > sub["free_shipping"]["threshold_cents"] and sub["shipping_cents"] == rate
        owner.ok("PUT", "/api/owner/provinces/NS", {"shipping_cents": rate, "free_shipping_threshold_cents": 0})
        assert quote(app_url, "NS", ten)["free_shipping"]["progress_percent"] == 100
        owner.ok("PUT", "/api/owner/provinces/NS", {"shipping_cents": rate, "free_shipping_threshold_cents": goods + 1})
        with opened(browser, app_url, "/box", DESKTOP) as page:
            try:
                assert page.request.post(app_url + "/api/cart/items", data={"flavour": "guava-lime", "quantity": 10}).status == 201
                assert page.request.patch(app_url + "/api/cart", data={"province": "NS"}).status == 200
                page.reload()
                ui(page, lambda: _assert_equal(meter(page)["text"], phrase(1, "Nova Scotia")))
                assert float(meter(page)["value"]) == float(goods * 100 // (goods + 1))
            finally:
                page_empty(page, app_url)


def test_wf_live_totals_quebec(browser: Browser, app_url: str) -> None:
    with province_settings(app_url, "QC") as (owner, _), opened(browser, app_url, "/box", DESKTOP) as page:
        try:
            owner.ok("PUT", "/api/owner/provinces/QC", {"shipping_cents": QC_SHIPPING_PROBE,
                                                        "free_shipping_threshold_cents": QC_THRESHOLD_PROBE})
            page.reload()
            switch = page.get_by_role("switch", name="Subscribe and save 10%")
            present(page, switch)
            expect(switch).to_be_disabled()
            present(page, page.get_by_text("Subscriptions come as 12 of one flavour or 4 of each."))
            for slug, n in DISCOVERY:
                page_add(page, app_url, slug, n)
            url = page.url
            table = page.get_by_role("region", name="Order total").get_by_role("table", name="Price breakdown")
            totals = page.get_by_role("status", name="Total updates")
            pick(page, page.get_by_role("combobox", name="Province"), "Quebec")
            one_off = quote(app_url, "QC", DISCOVERY)
            ui(page, lambda: assert_rows(table, one_off), seconds=QUOTE_S + ROUNDTRIP_S, clock=RealTime(page))
            shows(page, totals, f"Total {money(one_off['total_cents'])} with shipping to Quebec.")
            expect(switch).to_be_enabled()
            choose(switch)
            subscribed = quote(app_url, "QC", DISCOVERY, True)
            assert one_off["shipping_cents"] == subscribed["shipping_cents"] == QC_SHIPPING_PROBE
            ui(page, lambda: assert_rows(table, subscribed), seconds=QUOTE_S + ROUNDTRIP_S, clock=RealTime(page))
            shows(page, totals, f"Total {money(subscribed['total_cents'])} with shipping to {PROVINCES['QC']}.")
            group = page.get_by_role("radiogroup", name="Deliver every")
            present(page, group)
            for label in ("Month", "Two months"):
                expect(group.get_by_role("radio", name=label, exact=True)).to_have_count(1)
            assert page.url == url, "totals update without navigation"
            cart = page_cart(page, app_url)
            assert cart["province"] == "QC" and cart["subscribe"] is True
        finally:
            page_empty(page, app_url)


def test_wf_live_totals_outage(browser: Browser) -> None:
    base = instance("APP_POSTGRES_DOWN_URL")
    with opened(browser, base, "/box", DESKTOP) as page:
        province = page.get_by_role("combobox", name="Province")
        present(page, province)
        pick(page, province, "Quebec", settle=False)
        shows(page, page.get_by_role("status", name="Total updates"),
              "Totals can't be calculated right now. Try again in a moment.", clock=RealTime(page))


def test_reservation_holds(app_url: str) -> None:
    a = Api(app_url)
    with drop_settings(app_url) as owner:
        try:
            owner.ok("PUT", "/api/owner/drop", {"released": committed(app_url) + DROP_LIMIT})
            assert a.ok("GET", "/api/cart")["cart"]["hold"]["status"] == "none"
            assert "ceibo_cart" in a.jar
            first = add(a, "cacao-orange", DROP_LIMIT)
            cart = first["cart"]
            assert first["added"] == {"flavour": "cacao-orange", "slots": list(range(DROP_LIMIT))}
            assert cart["hold"]["status"] == "active" and cart["count"] == DROP_LIMIT
            expires = cart["hold"]["expires_at"]
            window = (iso(expires) - iso(cart["server_time"])).total_seconds()
            assert HOLD_DEFAULT_S - SLACK_S <= window <= HOLD_DEFAULT_S, window
            body = error(a.call("POST", "/api/cart/items", {"flavour": "cacao-orange", "quantity": 1}), 409, "hold_limit")
            assert body["limit"] == "drop" and isinstance(body["stock_left"], int)
            body = error(a.call("POST", "/api/cart/items", {"flavour": "guava-lime", "quantity": 7}), 409, "hold_limit")
            assert body["limit"] == "crate"
            later = add(a, "guava-lime", DROP_LIMIT)
            assert later["cart"]["hold"]["expires_at"] == expires, "later adds never extend the hold"
            body = error(a.call("POST", "/api/cart/items", {"flavour": "cacao-orange", "quantity": 1}), 409, "hold_limit")
            assert body["limit"] == "crate", "the 12-can limit is checked first"
            a.ok("DELETE", "/api/cart/items/1")
            a.ok("DELETE", "/api/cart/items/4")
            again = add(a, "yuzu-ginger", 2)
            assert again["added"]["slots"] == [1, 4]
            assert again["cart"]["hold"]["expires_at"] == expires
            a.ok("DELETE", "/api/cart/items/1")
            error(a.call("DELETE", "/api/cart/items/1"), 404, "not_found")
            empty_crate(a)
            assert a.ok("GET", "/api/cart")["cart"]["hold"]["status"] == "none"
            b = Api(app_url)
            owner.ok("PUT", "/api/owner/drop", {"released": committed(app_url) + 1})
            body = error(b.call("POST", "/api/cart/items", {"flavour": "cacao-orange", "quantity": 7}), 409, "hold_limit")
            assert body["limit"] == "drop", "limits are checked before stock"
            body = error(b.call("POST", "/api/cart/items", {"flavour": "cacao-orange", "quantity": 2}), 409, "sold_out")
            assert body["stock_left"] == 1
            assert b.ok("GET", "/api/cart")["cart"]["count"] == 0, "a refused multi-add takes nothing"
        finally:
            empty_crate(a)


def test_wf_limited_drop_race(browser: Browser, app_url: str) -> None:
    with drop_settings(app_url) as owner:
        owner.ok("PUT", "/api/owner/drop", {"released": committed(app_url) + 1})
        with opened(browser, app_url, "/box", DESKTOP) as one, opened(browser, app_url, "/box", DESKTOP) as two:
            try:
                b1 = one.get_by_role("button", name=add_name("cacao-orange"))
                b2 = two.get_by_role("button", name=add_name("cacao-orange"))
                reach(one, b1)
                reach(two, b2)
                with entered(held(one, "**/api/cart/items")) as gate_one, entered(held(two, "**/api/cart/items")) as gate_two:
                    press(one, b1)
                    press(two, b2)
                    gate_one.release()
                    gate_two.release()
                ui(one, lambda: _assert_equal(page_cart(one, app_url)["count"] + page_cart(two, app_url)["count"], 1))
                winner, loser = (one, two) if page_cart(one, app_url)["count"] == 1 else (two, one)
                named(winner, slots(winner).nth(0), slot_name(1, "cacao-orange"), clock=RealTime(winner))
                ui(loser, lambda: expect(loser.get_by_role("status", name="Crate updates")).to_contain_text(
                    refused_copy("cacao-orange", SOLD_OUT, 0, 0, ""), timeout=QUICK_MS),
                   clock=RealTime(loser))
                expect(slots(loser).nth(0)).to_have_accessible_name(slot_name(1))
                expect(show_card(loser, "cacao-orange").get_by_text("Sold out", exact=True)).to_be_visible()
            finally:
                page_empty(one, app_url)
                page_empty(two, app_url)
        racers = [Api(app_url) for _ in range(RACE_N)]
        try:
            owner.ok("PUT", "/api/owner/drop", {"released": committed(app_url) + 1})
            results = run_threads(RACE_N, lambda i: racers[i].call("POST", "/api/cart/items", {"flavour": "cacao-orange", "quantity": 1}))
            assert sorted(r.status_code for r in results) == [201] + [409] * (RACE_N - 1), [r.text[:120] for r in results]
            for r in results:
                if r.status_code == 409:
                    assert error(r, 409, "sold_out")["stock_left"] == 0
            s = stock(app_url)["cacao-orange"]
            assert s["reserved"] + s["sold"] <= s["released"] and s["available"] == 0, s
        finally:
            for r in racers:
                empty_crate(r)
        pairs = [Api(app_url) for _ in range(4)]
        try:
            owner.ok("PUT", "/api/owner/drop", {"released": committed(app_url) + 3})
            results = run_threads(4, lambda i: pairs[i].call("POST", "/api/cart/items", {"flavour": "cacao-orange", "quantity": 2}))
            assert sorted(r.status_code for r in results) == [201, 409, 409, 409], [r.text[:120] for r in results]
            s = stock(app_url)["cacao-orange"]
            assert s["reserved"] + s["sold"] <= s["released"] and s["available"] == 1, s
        finally:
            for r in pairs:
                empty_crate(r)


def test_hold_expiry(app_url: str, killbill: KillBill) -> None:
    short = instance("APP_SHORT_URL")
    a = customer(short)
    pack = staff(short, "fulfilment")
    before = stock(short)["guava-lime"]["reserved"]
    started = time.monotonic()
    cart = add(a, "guava-lime", CRATE_SIZE)["cart"]
    window = (iso(cart["hold"]["expires_at"]) - iso(cart["server_time"])).total_seconds()
    assert cart["hold"]["status"] == "active" and window > 0
    assert stock(short)["guava-lime"]["reserved"] == before + CRATE_SIZE
    poll(lambda: pack.ok("GET", "/api/staff/stock")["flavours"],
         lambda fl: next(f for f in fl if f["flavour"] == "guava-lime")["reserved"] == before,
         window + EXPIRY_RELEASE_S + SLACK_S, "server-side release")
    assert time.monotonic() - started >= window - 1, "the hold must not end early"
    after = a.ok("GET", "/api/cart")["cart"]
    assert after["hold"]["status"] == "expired" and after["count"] == 0 and all(s is None for s in after["slots"])
    error(a.call("POST", "/api/checkout", checkout_body(a), key=idempotency_key()), 409, "hold_expired")
    assert not [p for p in kb_payments(killbill, a) if succeeded(p)]


def test_wf_limited_drop_countdown(browser: Browser, app_url: str) -> None:
    other = Api(app_url)
    with opened(browser, app_url, "/box", DESKTOP) as page:
        try:
            try:
                ui(page, lambda: _assert_equal(any(c["name"] == "ceibo_cart" for c in page.context.cookies()), True),
                   seconds=ROUNDTRIP_S * 3)
            except AssertionError:
                page_cart(page, app_url)
            assert page.request.post(app_url + "/api/cart/items", data={"flavour": "guava-lime", "quantity": 2}).status == 201
            page.reload()
            cart_btn = page.get_by_role("button", name=cart_name(2)).first
            present(page, cart_btn)
            click(cart_btn)
            dialog = page.get_by_role("dialog", name="Cart")
            present(page, dialog)
            close = dialog.get_by_role("button", name="Close cart")
            close.focus()
            timer = dialog.get_by_role("timer", name="Hold time left")
            first = timer.inner_text()
            assert re.fullmatch(r"\d{2}:\d{2}", first), first
            advance(page, TICKS_MS)
            assert timer.inner_text() < first
            add(other, "yuzu-ginger")
            target = flavours(app_url)["yuzu-ginger"]["stock_left"]
            clock = RealTime(page)
            end = time.monotonic() + STOCK_LIVE_S + ROUNDTRIP_S
            while time.monotonic() < end:
                clock.step()
                expect(dialog).to_be_visible()
                expect(close).to_be_focused()
            page.keyboard.press("Escape")
            advance(page, DRAWER_OUT_MS * 2)
            ui(page, lambda: shows_left(show_card(page, "yuzu-ginger"), target))
        finally:
            empty_crate(other)
            page_empty(page, app_url)

    short = instance("APP_SHORT_URL")
    a = customer(short)
    with opened(browser, short, "/", DESKTOP) as page:
        inject(page, short, a, "/box")
        started = time.monotonic()
        r = page.request.post(short + "/api/cart/items", data={"flavour": "guava-lime", "quantity": CRATE_SIZE})
        assert r.status == 201
        cart = r.json()["cart"]
        window = (iso(cart["hold"]["expires_at"]) - iso(cart["server_time"])).total_seconds()
        page.goto(short + "/checkout")
        present(page, page.get_by_role("heading", name="Step 1 of 3: Address"))
        choose(page.get_by_role("radiogroup", name="Ship to").get_by_role("radio").first)
        click(page.get_by_role("button", name="Continue"))
        present(page, page.get_by_role("heading", name="Step 2 of 3: Review"))
        click(page.get_by_role("button", name="Continue"))
        step3 = page.get_by_role("heading", name="Step 3 of 3: Payment")
        present(page, step3)
        number = page.get_by_role("textbox", name="Card number")
        fill(number, HALF_CARD)
        number.focus()
        timer = page.get_by_role("timer", name="Hold time left")
        advance(page, (window + 2) * 1000)
        ui(page, lambda: expect(timer).to_have_text(re.compile(r"^\d{2}:\d{2}$"), timeout=QUICK_MS), clock=Still())
        if window - (time.monotonic() - started) > 1:
            assert none_seen(page.get_by_text(COPY_HOLD_ENDED)), "the expired state shows only once the server reports it"
            expect(step3).to_be_visible()
            expect(number).to_have_value(re.compile("^" + HALF_CARD.replace(" ", " ?") + "$"))
            expect(number).to_be_focused()
        present(page, page.get_by_text(COPY_HOLD_ENDED), seconds=window + EXPIRY_RELEASE_S + SLACK_S, clock=RealTime(page))
        present(page, page.get_by_role("link", name="Back to your crate"))
        expect(page.get_by_role("button", name=re.compile(r"^Pay \$"))).to_have_count(0)
        assert page_cart(page, short)["hold"]["status"] == "expired", "read with the crate's own ceibo_cart (L567)"


def ledger_ok(f: dict[str, Any]) -> None:
    assert f["on_hand"] == f["received"] - f["sold"] + f["returned"], f
    if f["flavour"] == "cacao-orange":
        assert isinstance(f["released"], int)
        assert f["available"] == min(f["on_hand"] - f["reserved"], f["released"] - f["reserved"] - f["sold"]), f
        assert f["reserved"] + f["sold"] <= f["released"], f
    else:
        assert f["released"] is None and f["available"] == f["on_hand"] - f["reserved"], f


def test_stock_ledger(browser: Browser, app_url: str) -> None:
    before = stock(app_url)
    for f in before.values():
        ledger_ok(f)
    visitor = Api(app_url)
    try:
        add(visitor, "guava-lime")
        mid = stock(app_url)["guava-lime"]
        ledger_ok(mid)
        assert mid["reserved"] == before["guava-lime"]["reserved"] + 1
        assert mid["available"] == before["guava-lime"]["available"] - 1 and mid["on_hand"] == before["guava-lime"]["on_hand"]
        assert flavours(app_url)["guava-lime"]["stock_left"] == mid["available"]
    finally:
        empty_crate(visitor)
    buy(customer(app_url))
    after = stock(app_url)
    for slug, n in DISCOVERY:
        ledger_ok(after[slug])
        assert after[slug]["sold"] == before[slug]["sold"] + n
        assert after[slug]["reserved"] == before[slug]["reserved"]
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, staff(app_url, "fulfilment"), "/office/stock")
        table = page.get_by_role("table", name="Stock")
        present(page, table)
        for col in ("Flavour", "Received", "Sold", "Returned", "On hand", "Reserved", "Available", "Released"):
            expect(table.get_by_role("columnheader", name=col, exact=True)).to_have_count(1)
        now = stock(app_url)["guava-lime"]
        row = table.get_by_role("row").filter(has_text="Guava & Lime")
        for key in ("received", "sold", "returned", "on_hand", "reserved", "available"):
            expect(row.get_by_role("cell", name=str(now[key]), exact=True).first).to_be_visible()


def test_accounts_and_addresses(app_url: str) -> None:
    email, name = identity("account")
    a = Api(app_url)
    error(a.call("POST", "/api/auth/sign-up", {"email": email, "password": "short-pw1", "name": name[:80]}), 422, "validation")
    r = a.call("POST", "/api/auth/sign-up", {"email": email, "password": SHOPPER_PASSWORD, "name": name[:80]})
    assert r.status_code == 201 and r.json()["user"]["role"] == "customer" and "ceibo_session" in a.jar
    error(Api(app_url).call("POST", "/api/auth/sign-up", {"email": email, "password": SHOPPER_PASSWORD, "name": name[:80]}), 409, "email_taken")
    error(Api(app_url).call("POST", "/api/auth/sign-in", {"email": email, "password": SHOPPER_PASSWORD + "x"}), 401, "invalid_credentials")
    fresh = Api(app_url)
    assert fresh.ok("POST", "/api/auth/sign-in", {"email": email, "password": SHOPPER_PASSWORD})["user"]["email"] == email
    assert fresh.ok("GET", "/api/me")["user"]["email"] == email
    error(Api(app_url).call("GET", "/api/me"), 401, "unauthenticated")
    users = [u for u in PocketBase().records("users") if str(u.get("email", "")).lower() == email.lower()]
    assert len(users) == 1 and users[0].get("role") == "customer" and users[0].get("name") == name[:80]
    first = a.ok("POST", "/api/addresses", dict(address_body("QC", name[:80], "48 rue des Ceibos"), postal_code="h2x1y4"), 201)["address"]
    assert first["postal_code"] == "H2X 1Y4" and first["is_default"] is True
    error(a.call("POST", "/api/addresses", dict(address_body("ON", name[:80], "77 Canopy Lane"), postal_code="H2X 1Y4")), 422, "validation")
    second = a.ok("POST", "/api/addresses", address_body("ON", name[:80], "77 Canopy Lane"), 201)["address"]
    listed = {x["id"]: x for x in a.ok("GET", "/api/addresses")["addresses"]}
    assert listed[second["id"]]["is_default"] is True and listed[first["id"]]["is_default"] is False
    a.ok("PATCH", f"/api/addresses/{first['id']}", {"is_default": True})
    listed = {x["id"]: x for x in a.ok("GET", "/api/addresses")["addresses"]}
    assert [i for i, x in listed.items() if x["is_default"]] == [first["id"]]
    stored = [x for x in PocketBase().records("addresses") if x.get("user") == users[0]["id"]]
    assert len(stored) == 2 and [x["id"] for x in stored if x.get("is_default")] == [first["id"]]
    assert {x.get("postal_code") for x in stored} == {"H2X 1Y4", "M5V 2T6"}


def test_checkout_idempotency(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    a = customer(app_url)
    reserve(a, DISCOVERY)
    body = checkout_body(a)
    missing = error(a.call("POST", "/api/checkout", body), 422, "validation")
    assert "idempotency_key" in missing["fields"]
    key = idempotency_key()
    first = a.call("POST", "/api/checkout", body, key=key)
    assert first.status_code == 201, first.text
    replay = a.call("POST", "/api/checkout", body, key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    error(a.call("POST", "/api/checkout", dict(body, card=dict(GOOD_CARD, cvc="321")), key=key), 409, "idempotency_mismatch")
    number = first.json()["order"]["number"]
    assert len([p for p in kb_payments(killbill, a) if succeeded(p)]) == 1
    assert [o["number"] for o in a.ok("GET", "/api/orders")["orders"]] == [number]
    mails(mail, a.email, f"Your Ceibo order {number} is confirmed")

    b = customer(app_url)
    reserve(b, DISCOVERY)
    declined_key = idempotency_key()
    d1 = a_call = b.call("POST", "/api/checkout", checkout_body(b, card=DECLINE_CARD), key=declined_key)
    error(d1, 402, "card_declined")
    d2 = b.call("POST", "/api/checkout", checkout_body(b, card=DECLINE_CARD), key=declined_key)
    assert d2.status_code == 402 and d2.json() == a_call.json()
    assert not [p for p in kb_payments(killbill, b) if succeeded(p)]
    ok = b.call("POST", "/api/checkout", checkout_body(b), key=idempotency_key())
    assert ok.status_code == 201, ok.text

    c = customer(app_url)
    reserve(c, DISCOVERY)
    shared = idempotency_key()
    results = run_threads(2, lambda i: c.at(app_url).call("POST", "/api/checkout", checkout_body(c), key=shared))
    assert [r.status_code for r in results] == [201, 201], [r.text[:200] for r in results]
    assert results[0].json()["order"]["number"] == results[1].json()["order"]["number"]
    assert len([p for p in kb_payments(killbill, c) if succeeded(p)]) == 1


def test_paid_order_record_set(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    a = customer(app_url)
    order = buy(a)["order"]
    number = order["number"]
    assert re.fullmatch(r"CB-\d{6}", number) and order["status"] == "paid"
    pays = order_payments(killbill, a, number)
    assert len(pays) == 1 and succeeded(pays[0]) == order["total_cents"]
    assert len([p for p in kb_payments(killbill, a) if succeeded(p)]) == 1
    acc = kb_account(killbill, a)
    assert acc["externalKey"] == a.user_id and acc["currency"] == "CAD"
    keys = sorted(S3().keys(f"orders/{number}/"))
    assert keys == [f"orders/{number}/invoice.pdf", f"orders/{number}/packing-slip.pdf"]
    for k in keys:
        assert S3().get(k).startswith(b"%PDF")
    msg = mails(mail, a.email, f"Your Ceibo order {number} is confirmed")
    body = mail_text(msg)
    assert f"/api/orders/{number}/invoice.pdf" in body and money(order["total_cents"]) in body
    assert order["thank_you_url"] == f"/orders/{number}/thanks" and order["invoice_url"] == f"/api/orders/{number}/invoice.pdf"


def test_wf_checkout_pay_once(browser: Browser, app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    a = customer(app_url, "QC")
    total = quote(app_url, "QC", (("yuzu-ginger", 12),))["total_cents"]
    with opened(browser, app_url, "/sign-in", DESKTOP) as page:
        fill(page.get_by_role("textbox", name="Email"), a.email)
        fill(page.get_by_label("Password", exact=True), SHOPPER_PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        ui(page, lambda: _assert_equal(signed_in(page, app_url), True))
        page.goto(app_url + "/box")
        fill_btn = page.get_by_role("button", name=fill_name("yuzu-ginger"))
        reach(page, fill_btn)
        press(page, fill_btn)
        cart_btn = page.get_by_role("button", name=cart_name(CRATE_SIZE)).first
        present(page, cart_btn)
        click(cart_btn)
        dialog = page.get_by_role("dialog", name="Cart")
        present(page, dialog)
        click(dialog.get_by_role("link", name="Checkout"))
        ui(page, lambda: _assert_equal(httpx.URL(page.url).path, "/checkout"))
        present(page, page.get_by_role("heading", name="Step 1 of 3: Address"))
        choose(page.get_by_role("radiogroup", name="Ship to").get_by_role("radio").first)
        click(page.get_by_role("button", name="Continue"))
        present(page, page.get_by_role("heading", name="Step 2 of 3: Review"))
        expect(page.get_by_role("region", name="Order summary").get_by_role("table", name="Price breakdown")).to_be_visible()
        click(page.get_by_role("button", name="Continue"))
        present(page, page.get_by_role("heading", name="Step 3 of 3: Payment"))
        fill(page.get_by_role("textbox", name="Card number"), GOOD_CARD["number"])
        fill(page.get_by_role("textbox", name="Expiry (MM/YY)"), CARD_EXPIRY_TEXT)
        fill(page.get_by_role("textbox", name="Security code"), GOOD_CARD["cvc"])
        pay = page.get_by_role("button", name=f"Pay {money(total)}")
        present(page, pay)
        status = page.get_by_role("status", name="Checkout status")
        with entered(held(page, "**/api/checkout")) as gate:
            click(pay)
            present(page, page.get_by_role("button", name="Paying..."))
            shows(page, status, "Processing payment. Keep this page open.", clock=Still())
            advance(page, SLOW_PAY_MS)
            shows(page, status, "This is taking longer than usual. Press Pay again; you won't be charged twice.")
            expect(pay).to_be_enabled()
            click(pay)
            gate.release()
        ui(page, lambda: _assert_equal(bool(re.fullmatch(r"/orders/CB-\d{6}/thanks", httpx.URL(page.url).path)), True),
           clock=RealTime(page))
        number = httpx.URL(page.url).path.split("/")[2]
        heading = page.get_by_role("heading", name=f"Order {number} is confirmed")
        present(page, heading)
        present(page, page.get_by_text(f"A receipt is on its way to {a.email}."))
        expect(page.get_by_role("link", name="Download invoice (PDF)")).to_be_visible()
        thanks = page.url
        page.reload()
        present(page, heading)
    pays = order_payments(killbill, a, number)
    assert len(pays) == 1 and succeeded(pays[0]) == total
    assert len([p for p in kb_payments(killbill, a) if succeeded(p)]) == 1
    assert sorted(S3().keys(f"orders/{number}/")) == [f"orders/{number}/invoice.pdf", f"orders/{number}/packing-slip.pdf"]
    mails(mail, a.email, f"Your Ceibo order {number} is confirmed")
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, customer(app_url), httpx.URL(thanks).path)
        present(page, page.get_by_role("heading", name="We couldn't find that page."))
        expect(page.get_by_role("heading", name=f"Order {number} is confirmed")).to_have_count(0)


def test_wf_checkout_keyboard(browser: Browser, app_url: str, killbill: KillBill) -> None:
    a = customer(app_url)
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, a, "/box")
        fill_btn = page.get_by_role("button", name=fill_name("guava-lime"))
        reach(page, fill_btn)
        tab_to(page, fill_btn)
        page.keyboard.press("Enter")
        counter_shows(page, CRATE_SIZE)
        cart_btn = page.get_by_role("button", name=cart_name(CRATE_SIZE)).first
        tab_to(page, cart_btn, key="Shift+Tab")
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Cart")
        present(page, dialog)
        tab_to(page, dialog.get_by_role("link", name="Checkout"))
        page.keyboard.press("Enter")
        present(page, page.get_by_role("heading", name="Step 1 of 3: Address"))
        radio = page.get_by_role("radiogroup", name="Ship to").get_by_role("radio").first
        tab_to(page, radio)
        page.keyboard.press("Space")
        tab_to(page, page.get_by_role("button", name="Continue"))
        page.keyboard.press("Enter")
        step2 = page.get_by_role("heading", name="Step 2 of 3: Review")
        ui(page, lambda: expect(step2).to_be_focused(timeout=QUICK_MS))
        tab_to(page, page.get_by_role("button", name="Continue"))
        page.keyboard.press("Enter")
        step3 = page.get_by_role("heading", name="Step 3 of 3: Payment")
        ui(page, lambda: expect(step3).to_be_focused(timeout=QUICK_MS))
        number = page.get_by_role("textbox", name="Card number")
        expiry = page.get_by_role("textbox", name="Expiry (MM/YY)")
        cvc = page.get_by_role("textbox", name="Security code")
        for field, value in ((number, "1234 5678"), (expiry, "13/20"), (cvc, "12")):
            tab_to(page, field)
            page.keyboard.type(value)
        tab_to(page, page.get_by_role("button", name=re.compile(r"^Pay \$\d+\.\d{2}$")))
        page.keyboard.press("Enter")
        summary = page.get_by_role("alert", name="Fix these fields")
        present(page, summary)
        ui(page, lambda: _assert_equal(summary.evaluate(CONTAINS_FOCUS_JS), True))
        for msg in ("Enter a valid card number.", "Enter a future expiry date as MM/YY.", "Enter the 3-digit security code."):
            expect(summary.get_by_role("link", name=msg)).to_have_count(1)
        link = summary.get_by_role("link", name="Enter a valid card number.")
        tab_to(page, link)
        page.keyboard.press("Enter")
        ui(page, lambda: expect(number).to_be_focused(timeout=QUICK_MS))
        for field, value in ((number, GOOD_CARD["number"]), (expiry, CARD_EXPIRY_TEXT), (cvc, GOOD_CARD["cvc"])):
            tab_to(page, field)
            page.keyboard.press("Control+A")
            page.keyboard.type(value)
        page.keyboard.press("Enter")
        ui(page, lambda: _assert_equal(bool(re.fullmatch(r"/orders/CB-\d{6}/thanks", httpx.URL(page.url).path)), True),
           clock=RealTime(page))
        placed = httpx.URL(page.url).path.split("/")[2]
    assert len(order_payments(killbill, a, placed)) == 1


def test_private_data(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    a = customer(app_url)
    other = customer(app_url)
    reserve(a, DISCOVERY)
    key = idempotency_key()
    r = a.call("POST", "/api/checkout", checkout_body(a), key=key)
    assert r.status_code == 201, r.text
    number = r.json()["order"]["number"]
    msg = mails(mail, a.email, f"Your Ceibo order {number} is confirmed")
    body = mail_text(msg) + json.dumps(msg)
    invoice = pdf_text(S3().get(f"orders/{number}/invoice.pdf"))
    slip = pdf_text(S3().get(f"orders/{number}/packing-slip.pdf"))
    pay = order_payments(killbill, a, number)[0]
    digits = GOOD_CARD["number"]
    secrets = [digits[:9], digits.replace(" ", "")[:10], key, kb_account(killbill, a)["accountId"], pay["paymentId"],
               a.jar["ceibo_session"], other.line1, "77 Canopy Lane"]
    assert has(slip, number) and has(slip, a.name), "the packing slip's text could not be read"
    for label, blob in (("email", body), ("invoice", invoice), ("packing slip", slip)):
        for secret in secrets:
            assert not has(blob, secret), f"{label} leaks {secret[:12]}"
    assert GOOD_CARD["number"][-4:] not in mail_text(msg)


def test_order_history(app_url: str) -> None:
    a = customer(app_url)
    first = buy(a)["order"]["number"]
    second = buy(a)["order"]["number"]
    assert [o["number"] for o in a.ok("GET", "/api/orders")["orders"]] == [second, first]
    assert a.ok("GET", f"/api/orders/{first}")["order"]["number"] == first
    r = a.call("GET", f"/api/orders/{first}/invoice.pdf")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf")
    assert r.content == S3().get(f"orders/{first}/invoice.pdf")
    b = customer(app_url)
    error(b.call("GET", f"/api/orders/{first}"), 404, "not_found")
    error(b.call("GET", f"/api/orders/{first}/invoice.pdf"), 404, "not_found")
    assert first not in json.dumps(b.ok("GET", "/api/orders"))
    error(Api(app_url).call("GET", "/api/orders"), 401, "unauthenticated")
    assert staff(app_url, "fulfilment").call("GET", f"/api/orders/{first}/invoice.pdf").status_code == 200


def test_subscribe_and_save(app_url: str, killbill: KillBill) -> None:
    a, order, sid = subscriber(app_url)
    assert order["status"] == "paid" and order["subscription_id"] == sid
    assert order["discount_cents"] == 400 and order["total_cents"] == 4255
    acc = kb_account(killbill, a)
    assert acc["externalKey"] == a.user_id and acc["currency"] == "CAD"
    kb = kb_sub(killbill, a, sid)
    assert kb["planName"] == "ceibo-discovery-monthly" and kb["state"] == "ACTIVE"
    assert succeeded(order_payments(killbill, a, order["number"])[0]) == 4255
    sub = sub_of(a, sid)
    assert sub["plan"] == "ceibo-discovery-monthly" and sub["plan_label"] == "Discovery box" and sub["cadence"] == "monthly"
    b, _, bsid = subscriber(app_url, cans=(("yuzu-ginger", 12),), cadence="bimonthly")
    assert kb_sub(killbill, b, bsid)["planName"] == "ceibo-yuzu-ginger-bimonthly"
    c = customer(app_url, "QC")
    try:
        reserve(c, (("guava-lime", 6), ("yuzu-ginger", 6)))
        error(c.call("PATCH", "/api/cart", {"subscribe": True}), 409, "not_subscribable")
        error(c.call("POST", "/api/checkout", checkout_body(c, True, "monthly"), key=idempotency_key()), 409, "not_subscribable")
        acc_c = kb_account(killbill, c)
        assert not acc_c or not killbill.subscriptions(acc_c["accountId"])
    finally:
        empty_crate(c)
    d = Api(app_url)
    try:
        add(d, "guava-lime", 12)
        assert d.ok("PATCH", "/api/cart", {"subscribe": True})["cart"]["subscribe"] is True
        assert d.ok("DELETE", "/api/cart/items/0")["cart"]["subscribe"] is False
    finally:
        empty_crate(d)


def test_subscription_mirrors_killbill(browser: Browser, app_url: str, killbill: KillBill) -> None:
    a, _, sid = subscriber(app_url)
    sub = sub_of(a, sid)
    kb = kb_sub(killbill, a, sid)
    assert sub["state"] == "active" and kb["state"] == "ACTIVE"
    assert sub["next_renewal_date"] == str(kb["chargedThroughDate"])[:10]
    assert sub["billing_end_date"] is None and sub["card"] == {"brand": sub["card"]["brand"], "last4": GOOD_CARD["number"][-4:]}
    change = request_change(a, sid, {"kind": "skip"})
    pending = sub_of(a, sid)
    if pending["pending_change"] is not None:
        assert pending["pending_change"]["id"] == change["id"], pending
        if pending["skip"] is not None:
            blocks = [b for b in kb_blocks(killbill, a) if b.get("blockedId") == sid and b.get("service") == "ceibo"]
            assert any(b["stateName"] == "CEIBO_SKIPPED" for b in blocks), (pending, blocks)
    wait_change(a, sid, change["id"])
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, a, f"/account/subscriptions/{sid}")
        present(page, page.get_by_role("heading", name="Your auto-delivery"))
        present(page, page.get_by_text(long_date(sub["next_renewal_date"])))
        present(page, page.get_by_text("Discovery box"))
    down = instance("APP_KILLBILL_DOWN_URL")
    error(a.at(down).call("GET", f"/api/subscriptions/{sid}"), 503, "billing_unavailable")
    with opened(browser, down, "/", DESKTOP) as page:
        inject(page, down, a, f"/account/subscriptions/{sid}")
        present(page, page.get_by_text("Billing is unreachable, so changes are paused. Your subscription hasn't changed."))
        assert none_seen(page.get_by_text(long_date(sub["next_renewal_date"]))), "billing down shows no renewal date"


def test_pause_resume(app_url: str, killbill: KillBill) -> None:
    a, _, sid = subscriber(app_url)
    renewal = sub_of(a, sid)["next_renewal_date"]
    for cycles in (0, 4):
        error(a.call("POST", f"/api/subscriptions/{sid}/changes", {"kind": "pause", "cycles": cycles}), 422, "validation")
    change = request_change(a, sid, {"kind": "pause", "cycles": 2})
    assert change["effective_date"] == renewal
    error(a.call("POST", f"/api/subscriptions/{sid}/changes", {"kind": "skip"}), 409, "change_pending")
    assert wait_change(a, sid, change["id"])["status"] == "applied"
    sub = sub_of(a, sid)
    assert sub["pause"] == {"from": renewal, "resumes_on": add_months(renewal, 2)}
    assert sub["last_change"]["id"] == change["id"] and sub["pending_change"] is None
    blocks = [b for b in kb_blocks(killbill, a) if b.get("blockedId") == sid and b.get("service") == "ceibo"]
    assert any(b["stateName"] == "CEIBO_PAUSED" and str(b["effectiveDate"])[:10] == renewal for b in blocks), blocks
    assert any(b["stateName"] == "CEIBO_ACTIVE" and str(b["effectiveDate"])[:10] == add_months(renewal, 2) for b in blocks), blocks
    error(a.call("POST", f"/api/subscriptions/{sid}/changes", {"kind": "pause", "cycles": 1}), 409, "illegal_change")
    error(a.call("POST", f"/api/subscriptions/{sid}/changes", {"kind": "skip"}), 409, "illegal_change")
    applied(a, sid, {"kind": "resume"})
    assert sub_of(a, sid)["pause"] is None
    blocks = [b for b in kb_blocks(killbill, a) if b.get("blockedId") == sid and b.get("service") == "ceibo"]
    assert any(b["stateName"] == "CEIBO_ACTIVE" and str(b["effectiveDate"])[:10] <= renewal for b in blocks), blocks
    error(a.call("POST", f"/api/subscriptions/{sid}/changes", {"kind": "resume"}), 409, "illegal_change")


def test_skip_swap(app_url: str, killbill: KillBill) -> None:
    a, _, sid = subscriber(app_url)
    renewal = sub_of(a, sid)["next_renewal_date"]
    applied(a, sid, {"kind": "skip"})
    assert sub_of(a, sid)["skip"] == {"date": renewal}
    blocks = [b for b in kb_blocks(killbill, a) if b.get("blockedId") == sid and b.get("service") == "ceibo"]
    assert any(b["stateName"] == "CEIBO_SKIPPED" and str(b["effectiveDate"])[:10] == renewal for b in blocks), blocks
    assert any(b["stateName"] == "CEIBO_ACTIVE" and str(b["effectiveDate"])[:10] == add_months(renewal, 1) for b in blocks), blocks
    error(a.call("POST", f"/api/subscriptions/{sid}/changes", {"kind": "skip"}), 409, "illegal_change")
    path = f"/api/subscriptions/{sid}/changes"
    err = error(a.call("POST", path, {"kind": "swap", "plan": "ceibo-yuzu-ginger-bimonthly"}), 422, "validation")
    assert err["fields"]["plan"] == "Pick a box with the same delivery rhythm."
    err = error(a.call("POST", path, {"kind": "swap", "plan": "ceibo-mango-monthly"}), 422, "validation")
    assert err["fields"]["plan"] == "Pick one of the listed boxes."
    error(a.call("POST", path, {"kind": "swap", "plan": "ceibo-discovery-monthly"}), 409, "illegal_change")
    change = applied(a, sid, {"kind": "swap", "plan": "ceibo-yuzu-ginger-monthly"})
    assert change["effective_date"] == renewal
    events = kb_events(sid)
    assert any(e.get("eventType") == "CHANGE" and e.get("plan") == "ceibo-yuzu-ginger-monthly"
               and str(e.get("effectiveDate"))[:10] == renewal for e in events), events


def test_wf_subscription_changes_cancel(browser: Browser, app_url: str, killbill: KillBill) -> None:
    a, _, sid = subscriber(app_url)
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, a, f"/account/subscriptions/{sid}/cancel")
        click(page.get_by_role("button", name="Cancel at end of term"))
        ui(page, lambda: _assert_equal(httpx.URL(page.url).path, f"/account/subscriptions/{sid}"))
        sub = poll(lambda: sub_of(a, sid), lambda s: s["state"] == "cancel_pending", CHANGE_CONFIRM_S + SLACK_S, "cancel applied")
        kb = kb_sub(killbill, a, sid)
        charged = str(kb["chargedThroughDate"])[:10]
        assert sub["billing_end_date"] == charged == str(kb["billingEndDate"])[:10] == sub["next_renewal_date"]
        page.reload()
        present(page, page.get_by_text(f"Ends on {long_date(charged)}").first, clock=RealTime(page))
    error(a.call("POST", f"/api/subscriptions/{sid}/changes", {"kind": "skip"}), 409, "illegal_change")
    error(a.call("PUT", f"/api/subscriptions/{sid}/card", GOOD_CARD), 409, "illegal_change")


def test_wf_subscription_changes_pending(browser: Browser, app_url: str, killbill: KillBill) -> None:
    a, _, sid = subscriber(app_url)
    home = f"/account/subscriptions/{sid}"
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, a, home)
        skip = page.get_by_role("button", name="Skip next box")
        present(page, skip)
        status = page.get_by_role("status", name="Subscription status")
        with entered(held(page, f"**/api/subscriptions/{sid}/changes/*")) as polls:
            with page.expect_response(lambda r: r.url.endswith(f"/api/subscriptions/{sid}/changes")
                                      and r.request.method == "POST") as posted:
                click(skip)
            change = posted.value.json()["change"]
            assert posted.value.status == 202 and change["status"] == "pending_provider", change
            badge = page.get_by_text(re.compile(r"^(Pending confirmation|Applied)$")).first
            present(page, badge, clock=Still())
            if badge.inner_text().strip() == "Pending confirmation":
                says(page, status, "Saved. Waiting for billing to confirm.", clock=Still())
                expect(skip).to_be_disabled()
            else:
                confirmed = a.ok("GET", f"/api/subscriptions/{sid}/changes/{change['id']}")["change"]
                assert confirmed["status"] == "applied", "Applied shown before billing confirmed the change"
            polls.release()
        present(page, page.get_by_text("Applied", exact=True), seconds=CHANGE_CONFIRM_S + SLACK_S, clock=RealTime(page))
        says(page, status, "Billing confirmed your change.", clock=RealTime(page))
    assert sub_of(a, sid)["skip"] is not None
    assert any(b["stateName"] == "CEIBO_SKIPPED" for b in kb_blocks(killbill, a) if b.get("blockedId") == sid)


def test_change_cutoff(browser: Browser) -> None:
    short = instance("APP_SHORT_URL")
    a, _, sid = subscriber(short)
    sub = sub_of(a, sid)
    after_next = add_months(sub["next_renewal_date"], 1)
    assert sub["changes_apply_to"] == after_next
    with opened(browser, short, "/", DESKTOP) as page:
        inject(page, short, a, f"/account/subscriptions/{sid}")
        present(page, page.get_by_text(f"Changes made now apply to the box after next, on {long_date(after_next)}."))
    change = applied(a, sid, {"kind": "skip"})
    assert change["effective_date"] == after_next
    assert sub_of(a, sid)["skip"] == {"date": after_next}


def test_wf_subscription_changes_landing(browser: Browser, app_url: str, killbill: KillBill) -> None:
    a, _, sid = subscriber(app_url)
    home = f"/account/subscriptions/{sid}"
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, a, home)
        click(page.get_by_role("button", name="Skip next box"))
        present(page, page.get_by_text(re.compile(r"^(Pending confirmation|Applied)$")).first)
        poll(lambda: sub_of(a, sid), lambda s: s["skip"] and not s["pending_change"], CHANGE_CONFIRM_S + SLACK_S, "skip")
        page.reload()
        click(page.get_by_role("link", name="Swap flavours"))
        ui(page, lambda: _assert_equal(httpx.URL(page.url).path, f"{home}/swap"))
        choose(page.get_by_role("radiogroup", name="Choose your box").get_by_role("radio", name="Yuzu Ginger box").first)
        click(page.get_by_role("button", name="Save swap"))
        ui(page, lambda: _assert_equal(httpx.URL(page.url).path, home))
        present(page, page.get_by_text(re.compile(r"^(Pending confirmation|Applied)$")).first)
        poll(lambda: sub_of(a, sid), lambda s: s["last_change"]["kind"] == "swap" and s["last_change"]["status"] == "applied",
             CHANGE_CONFIRM_S + SLACK_S, "swap")
        page.reload()
        click(page.get_by_role("link", name="Update card"))
        ui(page, lambda: _assert_equal(httpx.URL(page.url).path, f"{home}/card"))
        fill(page.get_by_role("textbox", name="Card number"), GOOD_CARD["number"])
        fill(page.get_by_role("textbox", name="Expiry (MM/YY)"), CARD_EXPIRY_TEXT)
        fill(page.get_by_role("textbox", name="Security code"), GOOD_CARD["cvc"])
        click(page.get_by_role("button", name="Save card"))
        ui(page, lambda: _assert_equal(httpx.URL(page.url).path, home))
        says(page, page.get_by_role("status", name="Subscription status"), "Card updated.")
        present(page, page.get_by_text("Applied", exact=True))
        assert sub_of(a, sid)["last_change"]["kind"] == "swap"
        click(page.get_by_role("link", name="Cancel subscription"))
        ui(page, lambda: _assert_equal(httpx.URL(page.url).path, f"{home}/cancel"))
        click(page.get_by_role("button", name="Cancel at end of term"))
        ui(page, lambda: _assert_equal(httpx.URL(page.url).path, home))
        present(page, page.get_by_text(re.compile(r"^(Pending confirmation|Applied)$")).first)
    sub = poll(lambda: sub_of(a, sid), lambda s: s["state"] == "cancel_pending", CHANGE_CONFIRM_S + SLACK_S, "cancel")
    assert str(kb_sub(killbill, a, sid)["billingEndDate"])[:10] == sub["billing_end_date"]


def test_subscription_emails(app_url: str, mail: Mailpit) -> None:
    a, _, sid = subscriber(app_url)
    change = request_change(a, sid, {"kind": "pause", "cycles": 1})
    if a.ok("GET", f"/api/subscriptions/{sid}/changes/{change['id']}")["change"]["status"] == "pending_provider":
        assert not mine(mail, a.email, "Your Ceibo subscription is paused", settle=0)
    assert wait_change(a, sid, change["id"])["status"] == "applied"
    mails(mail, a.email, "Your Ceibo subscription is paused")
    applied(a, sid, {"kind": "resume"})
    applied(a, sid, {"kind": "skip"})
    mails(mail, a.email, "Your next Ceibo box is skipped")
    applied(a, sid, {"kind": "swap", "plan": "ceibo-yuzu-ginger-monthly"})
    swapped_label = "Yuzu Ginger box"
    mails(mail, a.email, f"Your Ceibo box is now {swapped_label}")
    applied(a, sid, {"kind": "cancel"})
    end = sub_of(a, sid)["billing_end_date"]
    mails(mail, a.email, f"Your Ceibo subscription will end on {long_date(end)}")
    short = instance("APP_SHORT_URL")
    b, _, bsid = subscriber(short)
    renewal = sub_of(b, bsid)["next_renewal_date"]
    mails(mail, b.email, f"Your next Ceibo box renews on {long_date(renewal)}", seconds=UPCOMING_S + SLACK_S)


def into_dunning(base: str) -> tuple[Api, str, dict[str, Any]]:
    a, _, sid = subscriber(base, FIRST_ONLY_CARD)
    kb_raise_renewal(sid)
    sub = poll(lambda: sub_of(a, sid), lambda s: s["state"] == "past_due", RENEWAL_NOTICE_S + SLACK_S * 3, "past_due")
    return a, sid, sub


def day_length(dunning: dict[str, Any]) -> float:
    measured = (iso(dunning["next_retry_at"]) - iso(dunning["failed_at"])).total_seconds()
    assert any(abs(measured - d * SHORT_DAY_S) <= 1 for d in DUNNING_RETRY_DAYS), f"retry {measured} s after failure"
    return float(SHORT_DAY_S)


def test_renewal_charging(killbill: KillBill, mail: Mailpit) -> None:
    short = instance("APP_SHORT_URL")
    good, first, sid = subscriber(short)
    bad, _, bad_sid = subscriber(short, FIRST_ONLY_CARD)
    renewal = sub_of(good, sid)["next_renewal_date"]
    kb_raise_renewal(sid)
    kb_raise_renewal(bad_sid)
    renewals = poll(lambda: [o for o in good.ok("GET", "/api/orders")["orders"]
                             if o["subscription_id"] == sid and o["number"] != first["number"] and o["status"] == "paid"],
                    bool, RENEWAL_NOTICE_S + SLACK_S * 3, "paid renewal order")
    assert len(renewals) == 1
    order = renewals[0]
    assert order["total_cents"] == first["total_cents"]
    pays = order_payments(killbill, good, order["number"], "_short")
    assert len(pays) == 1 and succeeded(pays[0]) == order["total_cents"]
    assert sorted(S3("-short").keys(f"orders/{order['number']}/")) == [
        f"orders/{order['number']}/invoice.pdf", f"orders/{order['number']}/packing-slip.pdf"]
    mails(mail, good.email, f"Your Ceibo box renewed: order {order['number']}")
    assert sub_of(good, sid)["next_renewal_date"] > renewal
    failed = poll(lambda: sub_of(bad, bad_sid), lambda s: s["state"] == "past_due", RENEWAL_NOTICE_S + SLACK_S * 3, "past_due")
    assert failed["dunning"] and failed["dunning"]["shipments_held"] is False
    mails(mail, bad.email, "Your Ceibo renewal didn't go through")
    assert len([p for p in kb_payments(killbill, bad) if succeeded(p)]) == 1, "a declined renewal records no payment"
    paid = [o for o in bad.ok("GET", "/api/orders")["orders"] if o["status"] == "paid"]
    assert len(paid) == 1, "a declined renewal makes no paid order (an unpaid renewal order may exist, L1000)"


def test_wf_dunning_schedule(browser: Browser, killbill: KillBill, mail: Mailpit) -> None:
    short = instance("APP_SHORT_URL")
    a, sid, sub = into_dunning(short)
    d = sub["dunning"]
    day = day_length(d)
    failed = iso(d["failed_at"])
    assert day > 0
    assert abs((iso(d["cancels_at"]) - failed).total_seconds() - DUNNING_CANCEL_DAY * day) <= 1
    held_sub = poll(lambda: sub_of(a, sid), lambda s: bool(s["dunning"] and s["dunning"]["shipments_held"]),
                    DUNNING_HOLD_DAY * day + DUNNING_LATE_S + SLACK_S, "shipments held")
    assert held_sub["state"] == "past_due"
    overdue = [b for b in kb_blocks(killbill, a, "ACCOUNT") if b.get("stateName") == "CEIBO_OVERDUE"]
    assert overdue and overdue[0].get("service") == "ceibo-dunning", overdue
    final = poll(lambda: sub_of(a, sid), lambda s: s["state"] == "cancelled",
                 DUNNING_CANCEL_DAY * day + DUNNING_LATE_S + SLACK_S, "cancelled")
    assert final["dunning"] is None or final["dunning"].get("cancels_at")
    with opened(browser, short, "/", DESKTOP) as page:
        inject(page, short, a, f"/account/subscriptions/{sid}")
        present(page, page.get_by_text(re.compile(r"\bCancelled\b")))
        present(page, page.get_by_text("This subscription ended because payment couldn't be taken."))
        expect(page.get_by_text(re.compile(r"\bCancelled\b")).first).to_contain_text("Cancelled")
    expected = (["Your Ceibo renewal didn't go through"]
                + [f"Ceibo payment retry {r} of 3 didn't go through" for r in (1, 2, 3)]
                + ["Your Ceibo deliveries are on hold", "Your Ceibo subscription has been cancelled"])
    mine_now = [m for m in mine(mail, a.email, settle=MAIL_SETTLE_S) if m.get("Subject") in expected]
    listed = mail.client.get("/api/v1/messages", params={"limit": 200}).json()["messages"]
    received = {item["ID"]: item.get("Created") for item in listed}
    got = sorted(mine_now, key=lambda m: str(received.get(m.get("ID")) or ""))
    assert [m["Subject"] for m in got] == expected, [m.get("Subject") for m in got]
    for step_day, msg in zip(DUNNING_RETRY_DAYS + (DUNNING_HOLD_DAY, DUNNING_CANCEL_DAY), got[1:]):
        at = received.get(msg.get("ID"))
        assert at, f"no receive time for {msg.get('Subject')!r}"
        assert iso(str(at)) >= failed + timedelta(seconds=step_day * day - 1), (step_day, at)
    assert str(kb_sub(killbill, a, sid)["state"]).lower() == "cancelled"


def test_wf_dunning_banner(browser: Browser) -> None:
    short = instance("APP_SHORT_URL")
    a, sid, sub = into_dunning(short)
    with opened(browser, short, "/", DESKTOP) as page:
        inject(page, short, a, f"/account/subscriptions/{sid}")
        banner = page.get_by_role("alert").filter(has_text="Update your card")
        present(page, banner)
        expect(banner.first).to_have_text(COPY_DUNNING_1)
        day = day_length(sub["dunning"])
        held_sub = poll(lambda: sub_of(a, sid), lambda s: bool(s["dunning"] and s["dunning"]["shipments_held"]),
                        DUNNING_HOLD_DAY * day + DUNNING_LATE_S + SLACK_S, "shipments held")
        page.reload()
        held_copy = (f"Your deliveries are on hold because we couldn't take payment. Update your card before "
                     f"{long_datetime(held_sub['dunning']['cancels_at'])} to restart them.")
        present(page, page.get_by_role("alert").filter(has_text="Your deliveries are on hold"))
        expect(page.get_by_role("alert").filter(has_text="Your deliveries are on hold").first).to_have_text(held_copy)
        expect(page.get_by_role("alert").filter(has_text=COPY_DUNNING_1)).to_have_count(0)


def test_wf_dunning_card_recovery(browser: Browser, killbill: KillBill, mail: Mailpit) -> None:
    short = instance("APP_SHORT_URL")
    a, sid, sub = into_dunning(short)
    day = day_length(sub["dunning"])
    error(a.call("PUT", f"/api/subscriptions/{sid}/card", DECLINE_CARD), 402, "card_declined")
    assert sub_of(a, sid)["state"] == "past_due"
    poll(lambda: sub_of(a, sid)["dunning"], lambda d: bool(d and d["shipments_held"]),
         DUNNING_HOLD_DAY * day + DUNNING_LATE_S + SLACK_S, "shipments held")
    paid_before = len([p for p in kb_payments(killbill, a) if succeeded(p)])
    with opened(browser, short, "/", DESKTOP) as page:
        inject(page, short, a, f"/account/subscriptions/{sid}/card")
        fill(page.get_by_role("textbox", name="Card number"), GOOD_CARD["number"])
        fill(page.get_by_role("textbox", name="Expiry (MM/YY)"), CARD_EXPIRY_TEXT)
        fill(page.get_by_role("textbox", name="Security code"), GOOD_CARD["cvc"])
        click(page.get_by_role("button", name="Save card"))
        ui(page, lambda: _assert_equal(httpx.URL(page.url).path, f"/account/subscriptions/{sid}"))
        says(page, page.get_by_role("status", name="Subscription status"), COPY_CARD_RECOVERED)
        expect(page.get_by_role("alert").filter(has_text="Update your card")).to_have_count(0)
    recovered = sub_of(a, sid)
    assert recovered["state"] == "active" and recovered["dunning"] is None
    assert len([p for p in kb_payments(killbill, a) if succeeded(p)]) == paid_before + 1
    assert any(b.get("stateName") == "CEIBO_CLEAR" for b in kb_blocks(killbill, a, "ACCOUNT"))
    renewal = a.ok("GET", "/api/orders")["orders"][0]
    assert renewal["status"] == "paid" and renewal["subscription_id"] == sid
    mails(mail, a.email, f"Your Ceibo box renewed: order {renewal['number']}")
    assert not mine(mail, a.email, "Your Ceibo subscription has been cancelled",
                    settle=(DUNNING_CANCEL_DAY - DUNNING_HOLD_DAY) * day)


def test_fulfilment_transitions(app_url: str) -> None:
    pack = staff(app_url, "fulfilment")
    o1 = buy(customer(app_url))["order"]["number"]
    o2 = buy(customer(app_url))["order"]["number"]
    queue = [o["number"] for o in pack.ok("GET", "/api/staff/queue")["orders"]]
    assert o1 in queue and o2 in queue and queue.index(o1) < queue.index(o2)
    path = f"/api/staff/orders/{o1}/transitions"
    err = error(pack.call("POST", path, {"to": "packed"}), 409, "illegal_transition")
    assert err["message"] == f"Order {o1} can't move to packed from here."
    for to in ("picking", "packed", "shipped"):
        assert pack.ok("POST", path, {"to": to})["order"]["status"] == to
    err = error(pack.call("POST", path, {"to": "picking"}), 409, "illegal_transition")
    assert err["message"] == f"Order {o1} can't move to picking from here."
    assert o1 not in [o["number"] for o in pack.ok("GET", "/api/staff/queue")["orders"]]


def test_packing_slips(app_url: str, killbill: KillBill) -> None:
    a = customer(app_url)
    other = customer(app_url)
    number = buy(a)["order"]["number"]
    keys = [k for k in S3().keys(f"orders/{number}/") if k.endswith("packing-slip.pdf")]
    assert keys == [f"orders/{number}/packing-slip.pdf"]
    path = f"/api/staff/orders/{number}/packing-slip.pdf"
    r = staff(app_url, "fulfilment").call("GET", path)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf")
    assert r.content == S3().get(keys[0])
    slip = pdf_text(r.content)
    assert has(slip, number) and has(slip, a.name) and has(slip, a.line1), "the packing slip shows the order and ship-to"
    shown = pdf_text(r.content, raw=False)
    last4, digits = GOOD_CARD["number"][-4:], GOOD_CARD["number"].replace(" ", "")
    assert not re.search(rf"(?<![0-9A-Za-z]){last4}(?![0-9A-Za-z])", shown), "packing slip leaks the card's last four"
    assert digits not in re.sub(r"\s+", "", shown), "packing slip leaks the card number"
    for hidden in (other.line1, "77 Canopy Lane", a.jar["ceibo_session"], kb_account(killbill, a)["accountId"]):
        assert not has(slip, hidden), f"packing slip leaks {hidden[:12]}"
    assert error(a.call("GET", path), 403, "forbidden")["message"] == COPY_FORBIDDEN
    error(Api(app_url).call("GET", path), 401, "unauthenticated")


def test_queue_layout_switch(browser: Browser, app_url: str) -> None:
    number = buy(customer(app_url))["order"]["number"]
    pack = staff(app_url, "fulfilment")
    with opened(browser, app_url, "/", TABLET) as page:
        inject(page, app_url, pack, "/office/queue")
        for width, height in (TABLET, (QUEUE_TABLE_MIN_PX - 1, DESKTOP[1]), (QUEUE_TABLE_MIN_PX, DESKTOP[1]), DESKTOP):
            page.set_viewport_size({"width": width, "height": height})
            advance(page, UI_STEP_MS)
            present(page, page.get_by_role("heading", name="Paid orders"))
            if width < QUEUE_TABLE_MIN_PX:
                present(page, page.get_by_role("article", name=f"Order {number}"))
                expect(page.get_by_role("table", name="Paid orders")).to_have_count(0)
            else:
                table = page.get_by_role("table", name="Paid orders")
                present(page, table)
                for col in ("Order", "Placed", "Province", "Cans", "Status", "Actions"):
                    expect(table.get_by_role("columnheader", name=col, exact=True)).to_have_count(1)
                expect(page.get_by_role("article", name=f"Order {number}")).to_have_count(0)
            layout(page)


@pytest.mark.parametrize("service", OUTAGE_IDS, ids=OUTAGE_IDS)
def test_wf_fulfilment_outage_banner(browser: Browser, app_url: str, service: str) -> None:
    env, _, copy = OUTAGES[service]
    base = instance(env)
    with opened(browser, base, "/", DESKTOP) as page:
        if service == "postgres":
            page.goto(base + "/office/queue")
        else:
            inject(page, base, staff(app_url, "owner"), "/office/queue")
        banner = page.get_by_role("alert").filter(has_text=copy)
        present(page, banner, seconds=BANNER_S + SLACK_S, clock=RealTime(page))
        expect(banner.first).to_have_text(copy)
        for other, (_, _, other_copy) in OUTAGES.items():
            if other != service:
                expect(page.get_by_role("alert").filter(has_text=other_copy)).to_have_count(0)
        if service == "postgres":
            assert "/sign-in" not in page.url
            expect(page.get_by_role("navigation", name="Back office").get_by_role("link")).to_have_count(0)


def test_role_limited_actions(app_url: str, killbill: KillBill) -> None:
    a = customer(app_url)
    number = buy(a)["order"]["number"]
    pack, help_, owner = staff(app_url, "fulfilment"), staff(app_url, "support"), staff(app_url, "owner")
    refund_body = {"amount_cents": 100, "reason": "Dented can"}
    denied = [
        (a, "GET", "/api/staff/queue", None, None),
        (a, "GET", "/api/staff/stock", None, None),
        (a, "GET", "/api/owner/settings", None, None),
        (pack, "POST", f"/api/staff/orders/{number}/refunds", refund_body, idempotency_key()),
        (pack, "POST", f"/api/staff/orders/{number}/resend-receipt", None, None),
        (pack, "GET", "/api/owner/dashboard", None, None),
        (help_, "POST", f"/api/staff/orders/{number}/transitions", {"to": "picking"}, None),
        (help_, "GET", "/api/owner/settings", None, None),
        (owner, "GET", "/api/orders", None, None),
    ]
    for who, method, path, body, key in denied:
        assert error(who.call(method, path, body, key=key), 403, "forbidden")["message"] == COPY_FORBIDDEN, path
    error(pack.call("POST", "/api/staff/orders/CB-000000/refunds", refund_body, key=idempotency_key()), 404, "not_found")
    error(Api(app_url).call("GET", "/api/staff/queue"), 401, "unauthenticated")
    detail = pack.ok("GET", f"/api/staff/orders/{number}")["order"]
    assert detail["status"] == "paid" and detail["refunded_cents"] == 0 and detail["refunds"] == []
    assert all(succeeded(p, "REFUND") == 0 for p in order_payments(killbill, a, number))
    for to in ("picking", "packed"):
        assert pack.ok("POST", f"/api/staff/orders/{number}/transitions", {"to": to})["order"]["status"] == to


def test_wf_fulfilment_queue(browser: Browser, app_url: str) -> None:
    pack = staff(app_url, "fulfilment")
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, pack, "/office/queue")
        present(page, page.get_by_role("table", name="Paid orders"))
        number = buy(customer(app_url))["order"]["number"]
        row = page.get_by_role("table", name="Paid orders").get_by_role("row").filter(has_text=number)
        present(page, row, seconds=QUEUE_LIVE_S + SLACK_S, clock=RealTime(page))
        link = page.get_by_role("link", name=f"Packing slip for {number}")
        present(page, link)
        slip = page.request.get(str(httpx.URL(app_url + "/").join(link.get_attribute("href") or "")))
        assert slip.status == 200 and slip.body() == S3().get(f"orders/{number}/packing-slip.pdf")
        status = page.get_by_role("status", name="Queue status")
        for button, label in (("Start picking", "picking"), ("Mark packed", "packed"), ("Mark shipped", "shipped")):
            click(row.get_by_role("button", name=button))
            shows(page, status, f"Order {number} marked {label}.")
    assert pack.ok("GET", f"/api/staff/orders/{number}")["order"]["status"] == "shipped"


def refund(who: Api, number: str, amount: int, key: str | None = None) -> httpx.Response:
    return who.call("POST", f"/api/staff/orders/{number}/refunds", {"amount_cents": amount, "reason": "Dented can"},
                    key=key or idempotency_key())


def refund_applied(who: Api, number: str, refund_id: str) -> dict[str, Any]:
    return poll(lambda: who.ok("GET", f"/api/staff/orders/{number}")["order"],
                lambda o: any(r["id"] == refund_id and r["status"] != "pending_provider" for r in o["refunds"]),
                REFUND_CONFIRM_S + SLACK_S, "refund confirmation")


def test_partial_refund_split(app_url: str, killbill: KillBill) -> None:
    a, order, _ = subscriber(app_url)
    number = order["number"]
    assert order["total_cents"] == 4255
    help_ = staff(app_url, "support")
    r = refund(help_, number, 1000)
    assert r.status_code == 202, r.text
    split = r.json()["refund"]["split"]
    assert [l["goods_cents"] for l in split["lines"]] == [282, 282, 282]
    assert [l["deposit_cents"] for l in split["lines"]] == [10, 9, 9]
    assert split["shipping_cents"] == 0
    assert [(t["name"], t["cents"]) for t in split["taxes"]] == [("GST", 42), ("QST", 84)]
    refund_applied(help_, number, r.json()["refund"]["id"])
    results = run_threads(3, lambda i: refund(help_, number, REFUND_RACE_CENTS))
    assert sorted(x.status_code for x in results) == [202, 202, 422], [x.text[:200] for x in results]
    left = help_.ok("GET", f"/api/staff/orders/{number}")["order"]["refundable_cents"]
    assert left == 4255 - 1000 - 2 * REFUND_RACE_CENTS
    err = error(refund(help_, number, left + 1), 422, "validation")
    assert err["fields"]["amount_cents"] == f"Only {money(left)} is left to refund on this order."
    assert sum(succeeded(p, "REFUND") for p in order_payments(killbill, a, number)) <= 1000 + 2 * REFUND_RACE_CENTS


def test_provider_confirmed_refunds(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    a = customer(app_url)
    number = buy(a)["order"]["number"]
    help_ = staff(app_url, "support")
    key = idempotency_key()
    r = refund(help_, number, REFUND_PROBE_CENTS, key)
    assert r.status_code == 202
    body = r.json()
    assert body["refund"]["status"] == "pending_provider"
    assert body["order"]["refunded_cents"] == 0 and body["order"]["refund_status"] == "none"
    again = refund(help_, number, REFUND_PROBE_CENTS, key)
    assert again.status_code == 202 and again.json()["refund"]["id"] == body["refund"]["id"]
    error(refund(help_, number, REFUND_MISMATCH_CENTS, key), 409, "idempotency_mismatch")
    o = refund_applied(help_, number, body["refund"]["id"])
    assert o["refunded_cents"] == REFUND_PROBE_CENTS and o["refund_status"] == "partially_refunded"
    assert sum(succeeded(p, "REFUND") for p in order_payments(killbill, a, number)) == REFUND_PROBE_CENTS
    mails(mail, a.email, f"Refund of {money(REFUND_PROBE_CENTS)} for order {number}")


def test_wf_refunds_partial(browser: Browser, app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    a = customer(app_url)
    number = buy(a)["order"]["number"]
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, staff(app_url, "support"), "/office/search")
        box = page.get_by_role("searchbox", name="Find an order or subscription")
        fill(box, a.email.upper())
        page.keyboard.press("Enter")
        present(page, page.get_by_text(number))
        page.goto(f"{app_url}/office/orders/{number}")
        click(page.get_by_role("button", name="Refund", exact=True))
        dialog = page.get_by_role("dialog", name=f"Refund order {number}")
        present(page, dialog)
        fill(dialog.get_by_role("textbox", name="Amount"), dollars(REFUND_UI_CENTS))
        fill(dialog.get_by_role("textbox", name="Reason"), "Dented can")
        click(dialog.get_by_role("button", name="Issue refund"))
        status = page.get_by_role("status", name="Refund status")
        either = re.compile("^(" + re.escape(refund_copy(REFUND_UI_CENTS, False)) + "|"
                            + re.escape(refund_copy(REFUND_UI_CENTS, True)) + ")$")
        shows(page, status, either)
        shows(page, status, refund_copy(REFUND_UI_CENTS, True), seconds=REFUND_CONFIRM_S + SLACK_S, clock=RealTime(page))
    assert sum(succeeded(p, "REFUND") for p in order_payments(killbill, a, number)) == REFUND_UI_CENTS
    mails(mail, a.email, f"Refund of {money(REFUND_UI_CENTS)} for order {number}")


def test_wf_refunds_full(browser: Browser, app_url: str, killbill: KillBill) -> None:
    a = customer(app_url)
    order = buy(a, (("passionfruit-basil", 12),))["order"]
    number, total = order["number"], order["total_cents"]
    before = stock(app_url)["passionfruit-basil"]["returned"]
    pack = staff(app_url, "fulfilment")
    assert error(refund(pack, number, total), 403, "forbidden")["message"] == COPY_FORBIDDEN
    untouched = pack.ok("GET", f"/api/staff/orders/{number}")["order"]
    assert untouched["refund_status"] == "none" and untouched["refunds"] == []
    assert all(succeeded(p, "REFUND") == 0 for p in order_payments(killbill, a, number))
    assert stock(app_url)["passionfruit-basil"]["returned"] == before
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, staff(app_url, "owner"), f"/office/orders/{number}")
        click(page.get_by_role("button", name="Refund", exact=True))
        dialog = page.get_by_role("dialog", name=f"Refund order {number}")
        present(page, dialog)
        click(dialog.get_by_role("button", name="Refund everything left"))
        expect(dialog.get_by_role("textbox", name="Amount")).to_have_value(re.compile(r"^\$?" + re.escape(dollars(total)) + "$"))
        fill(dialog.get_by_role("textbox", name="Reason"), "Dented can")
        click(dialog.get_by_role("button", name="Issue refund"))
        shows(page, page.get_by_role("status", name="Refund status"), refund_copy(total, True),
              seconds=REFUND_CONFIRM_S + SLACK_S, clock=RealTime(page))
    o = staff(app_url, "support").ok("GET", f"/api/staff/orders/{number}")["order"]
    assert o["status"] == "refunded" and o["refund_status"] == "refunded" and o["refundable_cents"] == 0
    assert sum(succeeded(p, "REFUND") for p in order_payments(killbill, a, number)) == total
    assert stock(app_url)["passionfruit-basil"]["returned"] - before == CRATE_SIZE
    error(refund(staff(app_url, "support"), number, 1), 409, "not_refundable")
    shipped = buy(customer(app_url), (("passionfruit-basil", 12),))["order"]
    for to in ("picking", "packed", "shipped"):
        staff(app_url, "fulfilment").ok("POST", f"/api/staff/orders/{shipped['number']}/transitions", {"to": to})
    mid = stock(app_url)["passionfruit-basil"]["returned"]
    r = refund(staff(app_url, "support"), shipped["number"], shipped["total_cents"])
    assert r.status_code == 202, r.text
    o = refund_applied(staff(app_url, "support"), shipped["number"], r.json()["refund"]["id"])
    assert o["status"] == "refunded"
    assert stock(app_url)["passionfruit-basil"]["returned"] == mid


def test_prices_and_thresholds(app_url: str) -> None:
    with province_settings(app_url, "NS") as (owner, _):
        owner.ok("PUT", "/api/owner/provinces/NS", {"shipping_cents": NS_SHIPPING_PROBE,
                                                    "free_shipping_threshold_cents": NS_THRESHOLD_PROBE})
        q = quote(app_url, "NS", (("guava-lime", 10),))
        assert q["shipping_cents"] == NS_SHIPPING_PROBE and q["free_shipping"]["threshold_cents"] == NS_THRESHOLD_PROBE
        assert q["free_shipping"]["remaining_cents"] == NS_THRESHOLD_PROBE - q["discounted_goods_cents"]
        error(owner.call("PUT", "/api/owner/provinces/NS", {"shipping_cents": NS_SHIPPING_OVER,
                                                            "free_shipping_threshold_cents": NS_THRESHOLD_PROBE}),
              422, "validation")
    with drop_settings(app_url) as owner:
        owner.ok("PUT", "/api/owner/drop", {"can_price_cents": DROP_PRICE_PROBE})
        q = quote(app_url, "ON", (("cacao-orange", 1),))
        assert q["lines"][0]["unit_price_cents"] == DROP_PRICE_PROBE
        assert flavours(app_url)["cacao-orange"]["can_price_cents"] == DROP_PRICE_PROBE
        error(owner.call("PUT", "/api/owner/drop", {"can_price_cents": DROP_PRICE_OVER}), 422, "validation")


def test_drop_release_quantity(app_url: str) -> None:
    holder = Api(app_url)
    with drop_settings(app_url) as owner:
        try:
            owner.ok("PUT", "/api/owner/drop", {"released": committed(app_url) + 1})
            add(holder, "cacao-orange")
            done = committed(app_url)
            body = error(owner.call("PUT", "/api/owner/drop", {"released": done - 1}), 409, "below_committed")
            assert body["committed"] == done
            received = stock(app_url)["cacao-orange"]["received"]
            assert "released" in error(owner.call("PUT", "/api/owner/drop", {"released": received + 1}), 422, "validation")["fields"]
            assert owner.ok("PUT", "/api/owner/drop", {"released": done})["drop"]["released"] == done
            error(Api(app_url).call("POST", "/api/cart/items", {"flavour": "cacao-orange", "quantity": 1}), 409, "sold_out")
            racers = [Api(app_url) for _ in range(3)]
            try:
                owner.ok("PUT", "/api/owner/drop", {"released": committed(app_url) + 2})
                floor = committed(app_url)
                lowering = owner.at(app_url)

                def act(i: int) -> httpx.Response:
                    if i == 3:
                        return lowering.call("PUT", "/api/owner/drop", {"released": floor})
                    return racers[i].call("POST", "/api/cart/items", {"flavour": "cacao-orange", "quantity": 1})

                results = run_threads(4, act)
                assert all(r.status_code in (201, 409) for r in results[:3]), [r.text[:120] for r in results]
                assert sum(r.status_code == 201 for r in results[:3]) <= 2
                assert results[3].status_code in (200, 409), results[3].text
                s = stock(app_url)["cacao-orange"]
                assert s["reserved"] + s["sold"] <= s["released"], s
            finally:
                for r in racers:
                    empty_crate(r)
        finally:
            empty_crate(holder)


def test_owner_dashboard(browser: Browser, app_url: str) -> None:
    owner = staff(app_url, "owner")
    before = owner.ok("GET", "/api/owner/dashboard")
    assert before["services"] == {k: "up" for k in ("killbill", "postgres", "pocketbase", "minio", "mailpit")}
    assert set(before["dunning"]) >= {"entered", "recovered", "cancelled", "in_progress"}
    number = buy(customer(app_url))["order"]["number"]
    r = refund(staff(app_url, "support"), number, REFUND_SMALL_CENTS)
    refund_applied(owner, number, r.json()["refund"]["id"])
    after = owner.ok("GET", "/api/owner/dashboard")["refunds"]
    assert after["count"] - before["refunds"]["count"] == 1
    assert after["total_cents"] - before["refunds"]["total_cents"] == REFUND_SMALL_CENTS
    with opened(browser, app_url, "/", DESKTOP) as page:
        inject(page, app_url, owner, "/office/dashboard")
        for name in ("Dunning recovery", "Refunds"):
            present(page, page.get_by_role("region", name=name))
        services = page.get_by_role("list", name="Services")
        for label in ("Kill Bill", "Postgres", "PocketBase", "MinIO", "Mailpit"):
            expect(services.get_by_role("listitem").filter(has_text=f"{label}: Up")).to_have_count(1)
    down = instance("APP_KILLBILL_DOWN_URL")
    assert owner.at(down).ok("GET", "/api/owner/dashboard")["services"]["killbill"] == "down"
    with opened(browser, down, "/", DESKTOP) as page:
        inject(page, down, owner, "/office/dashboard")
        billing_label = "Kill Bill"
        present(page, page.get_by_role("list", name="Services").get_by_role("listitem").filter(
            has_text=f"{billing_label}: Down"))


def test_reviews(browser: Browser, app_url: str) -> None:
    buyer = customer(app_url)
    buy(buyer, (("guava-lime", 12),))
    token = identity("review")[0].split("@")[0]
    review_body = f"Bright guava and a clean finish {token}"
    path = "/api/flavours/guava-lime/reviews"
    error(buyer.call("POST", path, {"rating": 5, "body": "too short"}), 422, "validation")
    error(customer(app_url).call("POST", path, {"rating": 5, "body": review_body}), 403, "not_a_buyer")
    error(buyer.call("POST", "/api/flavours/cacao-orange/reviews", {"rating": 5, "body": review_body}), 403, "not_a_buyer")
    created = buyer.ok("POST", path, {"rating": 5, "body": review_body}, 201)["review"]
    assert created["status"] == "pending"
    error(buyer.call("POST", path, {"rating": 4, "body": review_body}), 409, "already_reviewed")
    stored = [r for r in PocketBase().records("reviews") if r.get("body") == review_body]
    assert len(stored) == 1 and stored[0]["status"] == "pending"
    assert review_body not in json.dumps(Api(app_url).ok("GET", path))
    owner = staff(app_url, "owner")
    assert created["id"] in [r["id"] for r in owner.ok("GET", "/api/owner/reviews?status=pending")["reviews"]]
    with opened(browser, app_url, "/flavours/guava-lime", DESKTOP) as page:
        reviews = page.get_by_role("list", name="Reviews")
        present(page, page.get_by_role("heading", name=NAMES["guava-lime"], exact=True))
        expect(reviews.get_by_text(review_body)).to_have_count(0)
        owner.ok("POST", f"/api/owner/reviews/{created['id']}/decision", {"decision": "approved"})
        present(page, reviews.get_by_text(review_body), seconds=REVIEW_LIVE_S + ROUNDTRIP_S, clock=RealTime(page))
    error(owner.call("POST", f"/api/owner/reviews/{created['id']}/decision", {"decision": "rejected"}), 409, "already_decided")
    listed = [r for r in Api(app_url).ok("GET", path)["reviews"] if r["body"] == review_body]
    assert len(listed) == 1 and listed[0]["rating"] == 5


def test_wf_owner_settings_threshold(browser: Browser, app_url: str) -> None:
    with province_settings(app_url, "ON") as (owner, original):
        raised = original["free_shipping_threshold_cents"] + 500
        with opened(browser, app_url, "/", DESKTOP) as page:
            inject(page, app_url, owner, "/office/settings")
            settings_url = page.url
            fill(page.get_by_role("textbox", name=f"{PROVINCES['ON']} free-shipping threshold"), dollars(raised))
            click(page.get_by_role("button", name="Save settings"))
            shows(page, page.get_by_role("status", name="Settings status"), COPY_SETTINGS_SAVED)
            assert page.url == settings_url, "settings save in place"
        q = quote(app_url, "ON", (("guava-lime", CRATE_SIZE - 1),))
        assert q["free_shipping"]["threshold_cents"] == raised
        with opened(browser, app_url, "/box", DESKTOP) as page:
            try:
                page_add(page, app_url, "guava-lime", CRATE_SIZE - 1)
                page.reload()
                ui(page, lambda: _assert_equal(meter(page)["text"], phrase(q["free_shipping"]["remaining_cents"], "Ontario")))
            finally:
                page_empty(page, app_url)


def test_wf_owner_settings_release_below(browser: Browser, app_url: str) -> None:
    holder = Api(app_url)
    with drop_settings(app_url) as owner:
        try:
            owner.ok("PUT", "/api/owner/drop", {"released": committed(app_url) + 1})
            add(holder, "cacao-orange")
            done = committed(app_url)
            before = owner.ok("GET", "/api/owner/settings")["drop"]["released"]
            with opened(browser, app_url, "/", DESKTOP) as page:
                inject(page, app_url, owner, "/office/settings")
                fill(page.get_by_role("spinbutton", name="Cacao Orange released"), str(done - 1))
                click(page.get_by_role("button", name="Save settings"))
                shows(page, page.get_by_role("status", name="Settings status"),
                      f"{done} cans are already held or sold, so the release can't go below that.")
            assert owner.ok("GET", "/api/owner/settings")["drop"]["released"] == before
        finally:
            empty_crate(holder)


def apply(base: str, business: str, email: str, payload: bytes, filename: str = "licence.pdf",
          mime: str = "application/pdf") -> httpx.Response:
    return Api(base).call("POST", "/api/retailer-applications",
                          data={"business_name": business, "contact_name": "Ana Silva", "email": email, "province": "QC"},
                          files={"licence": (filename, payload, mime)})


def test_retailer_application(app_url: str) -> None:
    owner = staff(app_url, "owner")
    email, name = identity("cafe")
    business = f"Cafe {name}"[:110]
    r = apply(app_url, business, email, PDF_BYTES)
    assert r.status_code == 201, r.text
    app = r.json()["application"]
    assert app["status"] == "submitted" and app["business_name"] == business
    assert S3().keys(f"licences/{app['id']}/") == [f"licences/{app['id']}/licence.pdf"]
    assert S3().get(f"licences/{app['id']}/licence.pdf") == PDF_BYTES
    assert Api(app_url).ok("GET", f"/api/retailer-applications/{app['id']}")["application"]["status"] == "submitted"
    png = apply(app_url, business + APPLICATION_SUFFIXES["png"], email, PNG_BYTES).json()["application"]
    assert S3().keys(f"licences/{png['id']}/") == [f"licences/{png['id']}/licence.png"]
    exact = PDF_BYTES + b"\0" * (LICENCE_LIMIT - len(PDF_BYTES))
    assert apply(app_url, business + APPLICATION_SUFFIXES["exact"], email, exact).status_code == 201
    rejected = {business + APPLICATION_SUFFIXES["big"]: (exact + b"\0", 413, "too_large"),
                business + APPLICATION_SUFFIXES["text"]: (TEXT_BYTES, 415, "unsupported_type")}
    for label, (payload, status, code) in rejected.items():
        error(apply(app_url, label, email, payload), status, code)
    assert "business_name" in error(apply(app_url, "A", email, PDF_BYTES), 422, "validation")["fields"]
    listed = {x["business_name"] for x in owner.ok("GET", "/api/owner/applications?status=submitted")["applications"]}
    assert business in listed and not set(rejected) & listed


def test_application_review(app_url: str, mail: Mailpit) -> None:
    owner = staff(app_url, "owner")
    email, name = identity("cafe")
    first = apply(app_url, f"Cafe {name}"[:110], email, PDF_BYTES).json()["application"]
    second_email, second_name = identity("cafe")
    second = apply(app_url, f"Cafe {second_name}"[:110], second_email, PDF_BYTES).json()["application"]
    lic = owner.call("GET", f"/api/owner/applications/{first['id']}/licence")
    assert lic.status_code == 200 and lic.content == PDF_BYTES
    error(customer(app_url).call("GET", f"/api/owner/applications/{first['id']}/licence"), 403, "forbidden")
    decided = owner.ok("POST", f"/api/owner/applications/{first['id']}/decision", {"decision": "approved"})
    assert decided["application"]["status"] == "approved"
    error(owner.call("POST", f"/api/owner/applications/{first['id']}/decision", {"decision": "declined"}), 409, "already_decided")
    owner.ok("POST", f"/api/owner/applications/{second['id']}/decision", {"decision": "declined"})
    mails(mail, email, "Your Ceibo stockist application was approved")
    mails(mail, second_email, "Your Ceibo stockist application was declined")
    assert not mine(mail, email, "Your Ceibo stockist application was declined")
    assert Api(app_url).ok("GET", f"/api/retailer-applications/{first['id']}")["application"]["status"] == "approved"


def test_wf_retailers_apply(browser: Browser, app_url: str) -> None:
    email, name = identity("cafe")
    business = f"Cafe {name}"[:110]
    with opened(browser, app_url, "/stockists/apply", DESKTOP) as page:
        fill(page.get_by_role("textbox", name="Business name"), business)
        fill(page.get_by_role("textbox", name="Contact name"), "Ana Silva")
        fill(page.get_by_role("textbox", name="Email"), email)
        pick(page, page.get_by_role("combobox", name="Province"), "Quebec", "QC")
        page.get_by_label("Business licence (PDF, PNG or JPEG)").set_input_files(
            files=[{"name": "licence.pdf", "mimeType": "application/pdf", "buffer": PDF_BYTES}])
        click(page.get_by_role("button", name="Submit application"))
        ui(page, lambda: _assert_equal(bool(re.fullmatch(r"/stockists/applications/[^/]+", httpx.URL(page.url).path)), True),
           clock=RealTime(page))
        app_id = httpx.URL(page.url).path.rsplit("/", 1)[1]
        present(page, page.get_by_role("heading", name="Application received"))
        present(page, page.get_by_text(business))
        present(page, page.get_by_text(re.compile(r"\bSubmitted\b")))
        page.reload()
        present(page, page.get_by_role("heading", name="Application received"))
    assert S3().get(f"licences/{app_id}/licence.pdf") == PDF_BYTES
    assert Api(app_url).ok("GET", f"/api/retailer-applications/{app_id}")["application"]["business_name"] == business


def test_wf_retailers_stockists(browser: Browser, app_url: str) -> None:
    for _, lat, lng, _ in (STOCKISTS[2], STOCKISTS[3]):
        got = Api(app_url).ok("GET", f"/api/stockists?lat={lat}&lng={lng}")["stockists"]
        want = nearest(lat, lng)
        assert [s["name"] for s in got] == [n for n, _ in want]
        for s, (_, d) in zip(got, want):
            assert abs(s["distance_km"] - round(d, 1)) <= 0.1
    error(Api(app_url).call("GET", "/api/stockists?lat=91&lng=0"), 422, "validation")
    all_stockists = Api(app_url).ok("GET", "/api/stockists")["stockists"]
    assert [s["name"] for s in all_stockists] == sorted(s[0] for s in STOCKISTS)
    assert all(s["distance_km"] is None for s in all_stockists)
    with opened(browser, app_url, "/stockists", DESKTOP) as page:
        select(page.get_by_role("combobox", name="Near"), "Toronto")
        shown = len(nearest(STOCKISTS[2][1], STOCKISTS[2][2]))
        shows(page, page.get_by_role("status", name="Stockist results"),
              f"Showing {shown} stockists nearest {STOCKISTS[2][3]}.")
        items = page.get_by_role("list", name="Stockists").get_by_role("listitem")
        expect(items).to_have_count(5)
        expect(items.first).to_contain_text("Canopy Grocer")
        for i in range(5):
            assert re.search(r"\d+\.\d km", items.nth(i).inner_text())
        assert len({round(items.nth(i).bounding_box()["x"]) for i in range(5)}) == 2
        page.context.grant_permissions(["geolocation"], origin=origin_of(app_url))
        page.context.set_geolocation({"latitude": STOCKISTS[3][1], "longitude": STOCKISTS[3][2]})
        click(page.get_by_role("button", name="Use my location"))
        place = "your location"
        shows(page, page.get_by_role("status", name="Stockist results"), f"Showing {shown} stockists nearest {place}.")
        expect(items.first).to_contain_text("Riverbend Pantry")
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        advance(page, UI_STEP_MS)
        assert len({round(items.nth(i).bounding_box()["x"]) for i in range(5)}) == 1


def test_wf_cross_cutting_health(app_url: str) -> None:
    for base in [app_url] + [instance(env) for env, _, _ in OUTAGES.values()] + [instance("APP_SHORT_URL")]:
        r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, (base, r.text)
        assert r.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize("service", OUTAGE_IDS, ids=OUTAGE_IDS)
def test_service_outages(app_url: str, killbill: KillBill, mail: Mailpit, service: str) -> None:
    env, _, _ = OUTAGES[service]
    base = instance(env)
    ok_quote = {"province": "ON", "subscribe": False, "cans": [{"flavour": "guava-lime", "quantity": 1}]}
    if service == "postgres":
        assert error(Api(base).call("POST", "/api/quote", ok_quote), 503, "store_unavailable")["message"] == COPY_STORE_DOWN
        error(Api(base).call("GET", "/api/me"), 503, "store_unavailable")
        error(Api(base).call("POST", "/api/cart/items", {"flavour": "guava-lime", "quantity": 1}), 503, "store_unavailable")
        assert Api(base).ok("GET", "/api/staff/status")["services"]["postgres"] == "down"
        return
    if service == "pocketbase":
        a = customer(app_url)
        error(Api(base).call("POST", "/api/auth/sign-in", {"email": a.email, "password": SHOPPER_PASSWORD}), 503, "accounts_unavailable")
        b = a.at(base)
        assert b.ok("GET", "/api/me")["user"]["email"] == a.email
        error(b.call("GET", "/api/addresses"), 503, "accounts_unavailable")
        Api(base).ok("POST", "/api/quote", ok_quote)
        try:
            add(b, "guava-lime")
        finally:
            empty_crate(b)
        return
    a = customer(base)
    Api(base).ok("POST", "/api/quote", ok_quote)
    staff(app_url, "fulfilment").at(base).ok("GET", "/api/staff/queue")
    if service == "mailpit":
        number = buy(a)["order"]["number"]
        mails(mail, a.email, f"Your Ceibo order {number} is confirmed", seconds=MAIL_RETRY_S + SLACK_S)
        return
    reserve(a, DISCOVERY)
    key = idempotency_key()
    body = checkout_body(a)
    try:
        r = a.call("POST", "/api/checkout", body, key=key)
        if service == "killbill":
            assert error(r, 503, "billing_unavailable")["message"] == COPY_BILLING_PAUSED
            assert a.ok("GET", "/api/cart")["cart"]["hold"]["status"] == "active"
            assert not [p for p in kb_payments(killbill, a) if succeeded(p)]
            retry = a.at(app_url).call("POST", "/api/checkout", body, key=key)
            assert retry.status_code == 201, "a 503 must not be stored"
            return
        error(r, 503, "files_unavailable")
        assert not [p for p in kb_payments(killbill, a) if succeeded(p)]
        paid = customer(app_url)
        number = buy(paid)["order"]["number"]
        error(paid.at(base).call("GET", f"/api/orders/{number}/invoice.pdf"), 503, "files_unavailable")
        email, name = identity("cafe")
        error(apply(base, f"Cafe {name}"[:110], email, PDF_BYTES), 503, "files_unavailable")
        listed = staff(app_url, "owner").ok("GET", "/api/owner/applications?status=submitted")["applications"]
        assert f"Cafe {name}"[:110] not in {x["business_name"] for x in listed}
    finally:
        empty_crate(a)


def test_wf_cross_cutting_boundary(app_url: str) -> None:
    url = app_url.rstrip("/") + "/api/quote"
    body = {"province": "ON", "subscribe": False, "cans": [{"flavour": "guava-lime", "quantity": 1}], "note": ""}
    base_len = len(json.dumps(body, separators=(",", ":")).encode())
    exact = json.dumps(dict(body, note="x" * (JSON_LIMIT - base_len)), separators=(",", ":")).encode()
    assert len(exact) == JSON_LIMIT
    over = exact[:-2] + b"x" + exact[-2:]
    json_h = {"Content-Type": "application/json"}
    with httpx.Client(timeout=HTTP_TIMEOUT_S, follow_redirects=True) as h:
        error(h.post(url, content=over, headers=dict(json_h, Origin=FOREIGN_ORIGIN)), 403, "cross_origin")
        same = h.post(url, json=body, headers={"Origin": origin_of(app_url)})
        assert same.status_code in (200, 422), same.text
        assert h.post(url, content=exact, headers=json_h).status_code != 413
        error(h.post(url, content=over, headers=json_h), 413, "too_large")
        error(h.post(url, content=b"province=ON", headers={"Content-Type": OTHER_TYPE}), 415, "unsupported_type")
        for path in PRIVATE_PATHS:
            assert h.get(app_url.rstrip("/") + path).status_code == 404, path
        secrets = [os.environ.get(k, "") for k in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "POCKETBASE_ADMIN_PASSWORD",
                                                   "S3_SECRET_ACCESS_KEY", "DATABASE_URL")]
        secrets = [s for s in secrets if len(s) >= SECRET_MIN_LEN and s.lower() not in API_WORDS]
        for page_path in ("/", "/box", "/checkout", "/office/queue"):
            html = h.get(app_url.rstrip("/") + page_path).text
            assets = [html] + [h.get(str(httpx.URL(app_url + "/").join(src))).text
                               for src in re.findall(r'src="(/[^"]+\.js)"', html)]
            for blob in assets:
                for s in secrets:
                    assert s not in blob, f"a credential value is served on {page_path}"


APP = Path("/app")
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".svelte-kit", ".output"}
ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0"}


def source_files() -> Iterator[Path]:
    for root, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            yield Path(root) / f


@functools.lru_cache(maxsize=1)
def shipped() -> list[tuple[str, str, Any]]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=APP, capture_output=True, text=True)
    tree = json.loads(out.stdout or "{}")
    found: dict[str, tuple[str, str, Any]] = {}

    def walk(deps: dict[str, Any]) -> None:
        for name, info in (deps or {}).items():
            if not info.get("version"):
                continue
            lic = info.get("license")
            if lic is None and info.get("path"):
                manifest = Path(info["path"]) / "package.json"
                if manifest.exists():
                    lic = json.loads(manifest.read_text()).get("license")
            found[f"{name}@{info['version']}"] = (name, info["version"], lic)
            walk(info.get("dependencies", {}))

    walk(tree.get("dependencies", {}))
    return list(found.values())


def licence_ok(lic: Any) -> bool:
    if isinstance(lic, dict):
        lic = lic.get("type")
    if not isinstance(lic, str):
        return False
    expr = lic.replace("(", " ").replace(")", " ")
    return any(all(part.strip() in ALLOWED for part in alt.split(" AND ")) for alt in expr.split(" OR "))


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({name for name, _, _ in shipped() if name not in notices})
    assert not missing, missing
    for font in ("Fraunces", "Atkinson Hyperlegible", "Lucide"):
        assert font in notices, font
    assert "IBM Plex Mono" in notices or "JetBrains Mono" in notices


def test_if_licences_allowed() -> None:
    bad = [(n, v, l) for n, v, l in shipped() if not licence_ok(l)]
    assert not bad, bad
    assert "OFL-1.1" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore() -> None:
    files = [p for p in source_files() if p.suffix in (".sqlite", ".sqlite3", ".db")]
    assert not files, files
    banned = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "lowdb", "nedb", "lmdb"}
    assert not banned & {name for name, _, _ in shipped()}


def test_if_service_config_unchanged() -> None:
    published = {"DATABASE_URL", "POCKETBASE_URL", "POCKETBASE_ADMIN_EMAIL", "POCKETBASE_ADMIN_PASSWORD", "S3_ENDPOINT", "S3_REGION",
                 "S3_BUCKET", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "KILLBILL_URL", "KILLBILL_USERNAME",
                 "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET", "SMTP_HOST", "SMTP_PORT", "MAILPIT_URL", "MAIL_FROM"}
    for env_file in APP.glob(".env*"):
        for line in env_file.read_text().splitlines():
            key, sep, value = line.partition("=")
            key = key.strip()
            if sep and key in published and key in os.environ:
                assert value.strip().strip('"').strip("'") == os.environ[key], f"{env_file.name}: {key} changed"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    urls: list[str] = []
    with opened(browser, app_url, "/", DESKTOP) as page:
        page.on("request", lambda req: urls.append(req.url))
        for path in ("/", "/box", "/sign-in", "/stockists"):
            page.goto(app_url + path)
            advance(page, UI_STEP_MS * 10)
    foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, origin_of(app_url))]
    assert not foreign, foreign


def test_if_no_model_files() -> None:
    found = [p for p in source_files() if p.suffix.lower() in (".glb", ".gltf", ".obj", ".fbx")]
    assert not found, found


def test_if_typescript_source() -> None:
    files = list(source_files())
    assert any(p.suffix in (".ts", ".tsx") for p in files)
    stray = [p for p in files if p.suffix in (".js", ".mjs", ".cjs", ".jsx")
             and "config" not in p.name and not p.name.startswith(".")]
    assert not stray, stray
