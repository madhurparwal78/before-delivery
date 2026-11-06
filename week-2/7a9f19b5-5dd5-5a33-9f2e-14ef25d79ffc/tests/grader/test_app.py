from __future__ import annotations

import importlib
import json
import math
import os
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
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    DEPLOYED_APP,
    advance,
    animations,
    capture,
    center,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    scene_frames,
    select,
    shipped_packages,
    state_styles,
    style,
    tab_order,
    unique,
)

UI_WAIT_S = 30
HTTP_TIMEOUT_S = 30
POLL_MS = 100
PHASE_STEP_MS = 20
POLL_S = 0.25
QUICK_MS = 2000
MAIL_WAIT_S = 30
NO_MAIL_WAIT_S = 12
BOOT_WAIT_S = 240
TAB_LIMIT = 80
TAB_SWEEP = 40
TRAP_PRESSES = 12
KB_WAIT_S = 30
IDLE_SAMPLE_MS = 10000
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
PASSWORD = "Probe-password-2026"
CARD_EXPIRY = "12/39"
PAST_EXPIRY = "01/20"
CARD_CVC = "123"
DELIVERY = {"name": "Probe Buyer", "address": "1 Probe Street", "city": "Christchurch", "postcode": "8011"}
FOREIGN_ORIGIN = "http://cross-origin.invalid"
UNKNOWN_CODE = "ZZZ-ZZ-1-1"

SESSION_COOKIE = "lf_session"
ADMIN_EMAIL, ADMIN_PASSWORD = "admin@southerly-light.test", "Lightfall-admin-2026"
APPROVE_CARD = "4242 4242 4242 4242"
DECLINE_CARD = "4000 0000 0000 0002"
MAIL_FROM_ADDRESS = "lightfall@southerly-light.test"
KDL_DEFAULT = "KDL-WH-36-3000"
KDL_WH_24 = "KDL-WH-24-3000"
KDL_BR_24_4000 = "KDL-BR-24-4000"
KDL_BK_24 = "KDL-BK-24-3000"
TTS_BK_36 = "TTS-BK-36-3000"
TTS_PICK = "TTS-BK-15-4000"
HSC_PICK = "HSC-WH-36-4000"
COMPARE_MAX = 4
HSC_CH = "HSC-CH-24-3000"
RGD = "RGD-SN-36-3000"
SEED_SLUGS = ["kauri-downlight", "totara-track-spot", "pohutukawa-pendant", "harbour-surface-cylinder", "rimu-gimbal-downlight"]
PRODUCT_NAMES = ["Kauri Downlight", "Tōtara Track Spot", "Pōhutukawa Pendant", "Harbour Surface Cylinder", "Rimu Gimbal Downlight"]
FAMILY_LINKS = ["Downlights", "Track spots", "Pendants", "Surface mounted"]
KDL_WH_36_RETAIL = 8900
KDL_WH_36_TRADE = 6400
KDL_24_RETAIL = 9500
KDL_24_TRADE = 6800
KDL_BR_24_RETAIL = 11500
TTS_36_RETAIL = 14900
TTS_15_RETAIL = 15800
PHP_BZ_RETAIL = 34500
PHP_BZ_TRADE = 24150
PHP_BZ_GST = 3623
PHP_BZ_TOTAL = 27773
HSC_24_RETAIL = 13100
HSC_CH_PRICE = 7900
RGD_CLEARANCE = 5900
RGD_REGULAR = 11900
CANDELA = {"KDL-WH-24-3000": 6550, "KDL-WH-24-4000": 6840, "KDL-BK-24-3000": 6550, "KDL-BK-24-2700": 6260, "KDL-WH-36-3000": 2930, "TTS-BK-36-3000": 3900, "TTS-BK-15-3000": 22300, "TTS-BK-24-3000": 8740, "HSC-WH-24-3000": 5100}
EXAMPLE_POOL_MM = 1148
EXAMPLE_OWN_LUX = 898
EXAMPLE_PAIR_LUX = 1753
EXAMPLE_PAIR_GAP_MM = 500
DEFAULT_CEILING_MM = 2700
DEFAULT_ROOM_WIDTH_MM, DEFAULT_ROOM_DEPTH_MM = 6000, 4500
CEILING_MIN_MM, CEILING_MAX_MM = 2400, 4000
ROOM_MIN_MM, ROOM_MAX_MM = 2000, 20000
CENTRE_DROP = (3000, 2300)
NUDGE_MM = 100
SHIFT_NUDGE_MM = 500
SLIDER_STEP_MM = 100
PRESENCE_JOIN_S = 3
PRESENCE_LEAVE_S = 30
LIVE_SYNC_S = 3
PB_RESUME_S = 15
PDF_READY_S = 10
STORAGE_RETRY_S = 10
UNREACHABLE_S = 10
HEALTH_PROBE_MAX_S = 2
DEBOUNCE_MS = 250
COUNT_FINAL_MS = 500
SEQUENCE_MAX_MS = 1500
IDLE_TURN_MIN_S, IDLE_TURN_MAX_S = 30, 40
IDLE_RESUME_MS = 3000
DIAL_RECHECK_MS = 60000
JSON_LIMIT = 100000
COVER_LIMIT = 5000000
COMMENT_MAX = 2000
MESSAGE_MAX = 1000
PO_MAX = 40
MAX_RECIPIENTS = 10
CUBE_VERTEX_BYTES = 36 * 3 * 4
DIAL_DATE = (2027, 1, 15)
DIAL_EDGES = [(10, 59, "morning", "day"), (16, 59, "day", "evening"), (20, 59, "evening", "night"), (4, 59, "night", "morning")]
INVOICE_DATE, DUE_DATE = "2027-01-15", "2027-02-20"
OVERDUE_DATE = "2027-02-21"
PHASES = ["cone", "pool", "tint", "count", "settled"]
ORDER_KEY_RE = re.compile(r"LF-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}")
VARIANT_KEYS = {"code", "finish", "finish_name", "beam_deg", "cct_k", "lumens", "candela", "retail_price_cents", "was_price_cents", "clearance", "stock_on_hand"}
TRADE_VARIANT_KEYS = VARIANT_KEYS | {"trade_price_cents"}
PRODUCT_KEYS = {"slug", "name", "family", "description", "watts", "cri", "ip_rating", "default_variant", "variants"}
COMPARE_KEYS = {"product_slug", "product_name", "watts", "cri", "ip_rating", "pool_diameter_mm_at_2700", "centre_lux_at_2700"}
USER_KEYS = {"id", "email", "name", "role", "trade_status", "dial_mode"}
ORDER_KEYS = {"order_key", "status", "display_status", "payment_method", "price_tier", "lines", "subtotal_cents", "gst_cents", "total_cents", "captured_cents", "refunded_cents", "refunds", "card_last4", "purchase_order", "invoice", "created_at"}
PROJECT_KEYS = {"id", "name", "client_name", "owner_id", "is_owner", "ceiling_height_mm", "room_width_mm", "room_depth_mm", "cover", "lines", "placements", "collaborators", "live"}
PLACEMENT_KEYS = {"id", "variant_code", "ordinal", "x_mm", "y_mm", "beam_deg", "cct_k", "candela", "pool_diameter_mm", "own_lux", "centre_lux"}
LICENCE_ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
FONT_NAMES = ["Instrument Serif", "Inter Tight", "JetBrains Mono"]

CATALOGUE_CASES = [
    ({}, SEED_SLUGS),
    ({"q": ""}, SEED_SLUGS),
    ({"q": "downlight"}, ["kauri-downlight", "rimu-gimbal-downlight"]),
    ({"q": "  DOWNLIGHT  "}, ["kauri-downlight", "rimu-gimbal-downlight"]),
    ({"q": "kdl-bk-24"}, ["kauri-downlight"]),
    ({"q": "concrete"}, ["harbour-surface-cylinder"]),
    ({"finish": "BK"}, ["kauri-downlight", "totara-track-spot", "harbour-surface-cylinder"]),
    ({"beam": "15"}, ["totara-track-spot"]),
    ({"cct": "2700"}, ["kauri-downlight", "totara-track-spot", "pohutukawa-pendant"]),
    ({"family": "pendants"}, ["pohutukawa-pendant"]),
    ({"family": "clearance"}, ["harbour-surface-cylinder", "rimu-gimbal-downlight"]),
    ({"clearance": "true"}, ["harbour-surface-cylinder", "rimu-gimbal-downlight"]),
    ({"finish": "BK,BR", "cct": "4000"}, ["kauri-downlight", "totara-track-spot", "harbour-surface-cylinder"]),
    ({"finish": "CH", "beam": "36"}, []),
    ({"finish": "CH", "beam": "24"}, ["harbour-surface-cylinder"]),
    ({"q": "downlight", "beam": "60"}, ["kauri-downlight"]),
    ({"finish": "ZZ"}, []),
]


def provider(name: str) -> Any:
    for module in ("conftest", "mailpit", "minio", "pocketbase", "postgres", "killbill", "clients", "providers"):
        try:
            found = importlib.import_module(module)
        except ImportError:
            continue
        if hasattr(found, name):
            return getattr(found, name)
    raise AssertionError(f"kit helper {name} is not importable")


def storage() -> Any:
    return provider("S3")()


def pocketbase() -> Any:
    return provider("PocketBase")()


def mail_body(message: dict[str, Any]) -> str:
    return provider("text")(message)


def base_of(url: str) -> str:
    return url.rstrip("/")


def outage(env_name: str) -> str:
    url = os.environ.get(env_name, "")
    assert url, f"{env_name} is not set for the verifier"
    return base_of(url)


def fresh(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    return (first, second) if "@" in second else (second, first)


def half_up(value: float) -> int:
    return math.floor(value + 0.5)


def gst(subtotal: int) -> int:
    return (subtotal * 15 + 50) // 100


def money(cents: int) -> str:
    return f"{cents // 100:,}.{cents % 100:02d}"


def dollars(cents: int) -> str:
    return "$" + money(cents)


def variant_announcement(product: str, finish: str, beam: int, cct: int, lumens: int, price: int) -> str:
    return f"{product}, {finish}, {beam}° beam, {cct}K: {lumens} lumens, {dollars(price)} + GST."


def beam_of(code: str) -> int:
    return int(code.split("-")[2])


def pool_mm(ceiling: int, beam: int) -> int:
    return half_up(2 * ceiling * math.tan(math.radians(beam / 2)))


def own_lux(candela: int, ceiling: int) -> int:
    return half_up(candela / (ceiling / 1000) ** 2)


def centre_lux(target: tuple[str, int, int], spots: list[tuple[str, int, int]], ceiling: int) -> int:
    total = 0.0
    for code, x, y in spots:
        d = math.hypot(x - target[1], y - target[2])
        if d <= ceiling * math.tan(math.radians(beam_of(code) / 2)):
            total += CANDELA[code] * math.cos(math.atan(d / ceiling)) ** 3 / (ceiling / 1000) ** 2
    return half_up(total)


def poll(check_fn: Callable[[], Any], seconds: float = KB_WAIT_S) -> Any:
    return eventually(None, check_fn, seconds)


def eventually(page: Page | None, check_fn: Callable[[], Any], seconds: float = UI_WAIT_S, step: float = POLL_MS) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        try:
            return check_fn()
        except (AssertionError, PlaywrightError, httpx.HTTPError, StopIteration, KeyError):
            if time.monotonic() > deadline:
                raise
        if page is not None:
            advance(page, step)
        else:
            threading.Event().wait(POLL_S)


@dataclass
class Account:
    base: str
    http: httpx.Client
    user: dict[str, Any]
    email: str
    name: str
    business: str = ""


def http(base: str) -> httpx.Client:
    return httpx.Client(base_url=base_of(base), timeout=HTTP_TIMEOUT_S)


def sign_in(base: str, email: str, password: str) -> httpx.Client:
    client = http(base)
    reply = client.post("/api/auth/signin", json={"email": email, "password": password})
    assert reply.status_code == 200, reply.text
    return client


def admin_http(base: str) -> httpx.Client:
    return sign_in(base, ADMIN_EMAIL, ADMIN_PASSWORD)


def admin_account(base: str) -> Account:
    client = admin_http(base)
    return Account(base, client, client.get("/api/me").json()["user"], ADMIN_EMAIL, "Ana Whitlow")


def sign_up(base: str, prefix: str, trade: dict[str, str] | None = None) -> Account:
    name, email = fresh(prefix)
    client = http(base)
    body: dict[str, Any] = {"email": email, "password": PASSWORD, "name": name, "account_type": "trade" if trade else "retail"}
    if trade:
        body["trade"] = trade
    reply = client.post("/api/auth/signup", json=body)
    assert reply.status_code == 201, reply.text
    return Account(base, client, reply.json()["user"], email, name, (trade or {}).get("business_name", ""))


def retail(base: str, prefix: str = "retail") -> Account:
    return sign_up(base, prefix)


def nzbn() -> str:
    return "94" + f"{uuid.uuid4().int % 10**11:011d}"


def applicant(base: str, prefix: str = "applicant", occupation: str = "wholesaler") -> Account:
    business = f"{prefix} {uuid.uuid4().hex[:8]} Ltd"
    return sign_up(base, prefix, {"business_name": business, "nzbn": nzbn(), "occupation": occupation})


def application_of(base: str, email: str, status: str) -> dict[str, Any]:
    reply = admin_http(base).get("/api/admin/trade-applications", params={"status": status})
    assert reply.status_code == 200, reply.text
    return next(a for a in reply.json()["applications"] if a["applicant_email"] == email)


def decide(base: str, account: Account, verdict: str, reason: str | None = None) -> httpx.Response:
    app_id = application_of(base, account.email, "submitted")["id"]
    path = f"/api/admin/trade-applications/{app_id}/{verdict}"
    client = admin_http(base)
    return client.post(path, json={"reason": reason}) if verdict == "decline" else client.post(path)


def relogin(account: Account) -> Account:
    account.http = sign_in(account.base, account.email, PASSWORD)
    account.user = account.http.get("/api/me").json()["user"]
    return account


def approved_trade(base: str, prefix: str = "trade") -> Account:
    account = applicant(base, prefix)
    reply = decide(base, account, "approve")
    assert reply.status_code == 200, reply.text
    return relogin(account)


def add_line(account: Account, code: str, quantity: int) -> dict[str, Any]:
    reply = account.http.post("/api/cart/lines", json={"variant_code": code, "quantity": quantity})
    assert reply.status_code == 200, reply.text
    return reply.json()["order"]


def checkout_body(number: str = APPROVE_CARD) -> dict[str, Any]:
    return {"card": {"number": number, "expiry": CARD_EXPIRY, "cvc": CARD_CVC, "name": DELIVERY["name"]}, "delivery": dict(DELIVERY)}


def pay(account: Account, order_key: str, number: str = APPROVE_CARD, key: str | None = None, body: dict[str, Any] | None = None) -> httpx.Response:
    return account.http.post(f"/api/orders/{order_key}/authorise", json=body or checkout_body(number), headers={"Idempotency-Key": key or idempotency_key()})


def card_order(base: str, code: str = KDL_DEFAULT, quantity: int = 1) -> tuple[Account, dict[str, Any]]:
    buyer = retail(base, "buyer")
    order = add_line(buyer, code, quantity)
    reply = pay(buyer, order["order_key"])
    assert reply.status_code == 200, reply.text
    return buyer, reply.json()["order"]


def dispatch(base: str, order_key: str) -> httpx.Response:
    return admin_http(base).post(f"/api/admin/orders/{order_key}/dispatch")


def captured_order(base: str) -> tuple[Account, dict[str, Any]]:
    buyer, order = card_order(base)
    reply = dispatch(base, order["order_key"])
    assert reply.status_code == 200, reply.text
    return buyer, reply.json()["order"]


def place_on_account(account: Account, order_key: str, purchase_order: str | None = None, key: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"delivery": dict(DELIVERY)}
    if purchase_order is not None:
        body["purchase_order"] = purchase_order
    return account.http.post(f"/api/orders/{order_key}/place-on-account", json=body, headers={"Idempotency-Key": key or idempotency_key()})


def account_order(base: str, lines: list[tuple[str, int]], purchase_order: str | None = None) -> tuple[Account, dict[str, Any]]:
    buyer = approved_trade(base, "account")
    order: dict[str, Any] = {}
    for code, quantity in lines:
        order = add_line(buyer, code, quantity)
    reply = place_on_account(buyer, order["order_key"], purchase_order)
    assert reply.status_code == 200, reply.text
    return buyer, reply.json()["order"]


def order_of(account: Account, order_key: str) -> dict[str, Any]:
    reply = account.http.get(f"/api/orders/{order_key}")
    assert reply.status_code == 200, reply.text
    return reply.json()["order"]


def create_project(account: Account, **fields: Any) -> dict[str, Any]:
    body = {"name": fields.pop("name", f"Project {uuid.uuid4().hex[:8]}"), **fields}
    reply = account.http.post("/api/projects", json=body)
    assert reply.status_code == 201, reply.text
    return reply.json()["project"]


def add_project_line(account: Account, project_id: Any, code: str, quantity: int) -> dict[str, Any]:
    reply = account.http.post(f"/api/projects/{project_id}/lines", json={"variant_code": code, "quantity": quantity})
    assert reply.status_code == 200, reply.text
    return reply.json()["project"]


def place(account: Account, project_id: Any, code: str, x: Any, y: Any) -> httpx.Response:
    return account.http.post(f"/api/projects/{project_id}/placements", json={"variant_code": code, "x_mm": x, "y_mm": y})


def project_of(account: Account, project_id: Any) -> dict[str, Any]:
    reply = account.http.get(f"/api/projects/{project_id}")
    assert reply.status_code == 200, reply.text
    return reply.json()["project"]


def invite(owner: Account, project_id: Any, email: str) -> httpx.Response:
    return owner.http.post(f"/api/projects/{project_id}/collaborators", json={"email": email})


def stock_item(base: str, code: str) -> dict[str, Any]:
    reply = admin_http(base).get("/api/admin/stock")
    assert reply.status_code == 200, reply.text
    return next(i for i in reply.json()["items"] if i["variant_code"] == code)


def set_stock(base: str, code: str, target: int) -> None:
    delta = target - stock_item(base, code)["stock_on_hand"]
    if delta:
        reply = admin_http(base).patch(f"/api/admin/variants/{code}", json={"stock_adjust": delta, "note": "verifier reset"})
        assert reply.status_code == 200, reply.text


def variant_of(base: str, slug: str, code: str, client: httpx.Client | None = None) -> dict[str, Any]:
    reply = (client or http(base)).get(f"/api/products/{slug}")
    assert reply.status_code == 200, reply.text
    return next(v for v in reply.json()["product"]["variants"] if v["code"] == code)


def png_bytes(padding: int = 0) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    image = b"\x89PNG\r\n\x1a\n" + header + chunk(b"IDAT", zlib.compress(b"\x00\xff\xb0\x00")) + chunk(b"IEND", b"")
    return image + b"\x00" * max(0, padding - len(image))


def records(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from records(item)
    elif isinstance(value, list):
        for item in value:
            yield from records(item)


def transactions(record: Any, kind: str) -> list[dict[str, Any]]:
    return [d for d in records(record) if kind in d.values()]


def amount_in(record: dict[str, Any], cents: int) -> bool:
    return any(isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v * 100 - cents) < 0.5 for v in record.values())


def kb_account(killbill: Any, user: dict[str, Any]) -> dict[str, Any] | None:
    return killbill.account_by_key(f"lf-user-{user['id']}")


def kb_account_id(account: dict[str, Any]) -> str:
    return next(v for v in account.values() if isinstance(v, str) and UUID_RE.fullmatch(v))


def kb_invoices(killbill: Any, user: dict[str, Any]) -> list[dict[str, Any]]:
    account = kb_account(killbill, user)
    return [] if account is None else killbill.invoices(kb_account_id(account))


def kb_invoice(killbill: Any, user: dict[str, Any], invoice_id: str) -> list[dict[str, Any]]:
    return [inv for inv in kb_invoices(killbill, user) if invoice_id in inv.values()]


def serial(message: Any) -> str:
    return json.dumps(message, ensure_ascii=False)


def inbox(mail: Any, needle: str, count: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages() if needle.lower() in serial(m).lower()]
        if len(found) >= count or time.monotonic() > deadline:
            return found


def pdf_text(data: bytes) -> str:
    streams = []
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        raw = match.group(1)
        try:
            streams.append(zlib.decompress(raw))
        except zlib.error:
            streams.append(raw)
    cmap: dict[bytes, str] = {}
    for stream in streams:
        for block in re.findall(rb"beginbfchar(.*?)endbfchar", stream, re.S):
            for src, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
                cmap[src.lower()] = bytes.fromhex(dst.decode()).decode("utf-16-be", "ignore")
        for block in re.findall(rb"beginbfrange(.*?)endbfrange", stream, re.S):
            for low, high, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
                start = int(dst, 16)
                for offset, code in enumerate(range(int(low, 16), int(high, 16) + 1)):
                    target = (start + offset).to_bytes(max(2, len(dst) // 2), "big")
                    cmap[f"{code:0{len(low)}x}".encode()] = target.decode("utf-16-be", "ignore")
    widths = sorted({len(k) for k in cmap}, reverse=True)

    def from_hex(digits: bytes) -> str:
        for width in widths:
            parts = [digits[i:i + width] for i in range(0, len(digits), width)]
            if len(digits) % width == 0 and all(p in cmap for p in parts):
                return "".join(cmap[p] for p in parts)
        return bytes.fromhex(digits.decode()).decode("latin-1")

    def from_literal(raw: bytes) -> str:
        raw = re.sub(rb"\\([0-7]{1,3})", lambda m: bytes([int(m.group(1), 8) & 0xFF]), raw)
        raw = re.sub(rb"\\(.)", rb"\1", raw)
        return from_hex(raw.hex().encode()) if widths else raw.decode("latin-1")

    out = []
    for stream in streams:
        for chunk in re.findall(rb"BT(.*?)ET", stream, re.S):
            pieces = []
            for literal, digits in re.findall(rb"\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>", chunk):
                pieces.append(from_hex(re.sub(rb"\s", b"", digits).lower()) if digits else from_literal(literal))
            out.append("".join(pieces))
    return "\n".join(out)


DESKTOP = (1280, 800)
PHONE = (375, 812)


@contextmanager
def ui(browser: Browser, base: str, path: str, account: Account | None = None, size: tuple[int, int] = DESKTOP, **options: Any) -> Iterator[Page]:
    base = base_of(base)
    with open_app(browser, base + "/api/health", **options) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if account is not None:
            page.context.add_cookies([{"name": SESSION_COOKIE, "value": account.http.cookies[SESSION_COOKIE], "url": base}])
        page.goto(base + path)
        yield page


def shown(locator: Locator) -> str:
    return locator.first.inner_text(timeout=QUICK_MS).strip() if locator.count() else ""


def wait_text(page: Page, locator: Locator, expected: str, seconds: float = UI_WAIT_S) -> None:
    def probe() -> None:
        actual = shown(locator)
        assert actual == expected, f"{actual!r} != {expected!r}"

    eventually(page, probe, seconds)


def wait_count(page: Page, locator: Locator, count: int, seconds: float = UI_WAIT_S) -> None:
    def probe() -> None:
        assert locator.count() == count, f"{locator} count {locator.count()} != {count}"

    eventually(page, probe, seconds)


def wait_true(page: Page | None, predicate: Callable[[], bool], message: str, seconds: float = UI_WAIT_S) -> None:
    def probe() -> None:
        assert predicate(), message

    eventually(page, probe, seconds)


def body_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def focused(locator: Locator) -> bool:
    return bool(locator.count()) and locator.evaluate_all("(els) => els.includes(document.activeElement)")


def holds_focus(container: Locator) -> bool:
    return container.evaluate("(el) => el.contains(document.activeElement)")


def tab_to(page: Page, name: str, limit: int = TAB_LIMIT, forbid: tuple[str, ...] = ()) -> None:
    for _ in range(limit):
        current = tab_order(page, 1)[0]
        assert current not in forbid, f"Tab reached {current!r} before {name!r}"
        if current == name:
            return
    raise AssertionError(f"Tab never reached {name!r}")


def mark(page: Page) -> None:
    page.evaluate("() => { window.lightfallProbe = true; }")


def marked(page: Page) -> bool:
    return page.evaluate("() => window.lightfallProbe === true")


def light(page: Page) -> tuple[str, str]:
    return tuple(page.evaluate("() => [document.documentElement.dataset.light, document.documentElement.dataset.lightMode]"))


def ground(page: Page) -> str:
    return page.evaluate("() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor].join(' ')")


def fill_delivery(page: Page) -> None:
    form = page.get_by_role("form", name="Checkout")
    for label, value in (("Full name", DELIVERY["name"]), ("Address", DELIVERY["address"]), ("City", DELIVERY["city"]), ("Postcode", DELIVERY["postcode"])):
        fill(form.get_by_role("textbox", name=label, exact=True), value)


def fill_card(page: Page, number: str = APPROVE_CARD) -> None:
    form = page.get_by_role("form", name="Checkout")
    for label, value in (("Card number", number), ("Expiry (MM/YY)", CARD_EXPIRY), ("Security code", CARD_CVC), ("Name on card", DELIVERY["name"])):
        fill(form.get_by_role("textbox", name=label, exact=True), value)


def outside_newsletter(page: Page, role: str, name: str) -> Locator:
    newsletter = page.get_by_role("region", name="Newsletter")
    candidates = page.get_by_role(role, name=name, exact=True)

    def find() -> Locator:
        for index in range(candidates.count()):
            candidate = candidates.nth(index)
            if not newsletter.count() or not newsletter.first.evaluate("(region, el) => region.contains(el)", candidate.element_handle(timeout=QUICK_MS)):
                return candidate
        raise AssertionError(f"no {role} {name!r} outside the newsletter")

    return eventually(page, find)


def payment_alert(page: Page, heading: str) -> Locator:
    return page.get_by_role("alert").filter(has=page.get_by_role("heading", name=heading, level=2))


def order_key_in(page: Page) -> str:
    match = re.search(r"/orders/([^/?#]+)", page.url)
    assert match, page.url
    return match.group(1)


def fitting_button(page: Page, code: str, ordinal: int, x: int, y: int) -> Locator:
    return page.get_by_role("button", name=f"{code} #{ordinal} at {x} mm, {y} mm", exact=True)


def pool_rows(page: Page) -> list[list[int]]:
    table = page.get_by_role("table", name="Light pools")
    rows = []
    for row in table.get_by_role("row").all():
        if row.get_by_role("columnheader").count():
            continue
        cells = [c.strip() for c in row.inner_text().split("\t")]
        rows.append([int(re.findall(r"\d+", c)[0]) for c in cells[1:6]])
    return sorted(rows)


def admin_row(page: Page, table: str, needle: str) -> Locator:
    return page.get_by_role("table", name=table).get_by_role("row").filter(has_text=needle)


def product_radio(page: Page, group: str, name: str) -> Locator:
    return page.get_by_role("radiogroup", name=group).get_by_role("radio", name=name, exact=True)


def set_local_time(page: Page, hour: int, minute: int) -> None:
    utc_ms = datetime(*DIAL_DATE, hour, minute, tzinfo=timezone.utc).timestamp() * 1000
    offset = page.evaluate("(ms) => new Date(ms).getTimezoneOffset()", utc_ms)
    page.clock.set_system_time(datetime.fromtimestamp((utc_ms + offset * 60000) / 1000, tz=timezone.utc))


def upload_cover(page: Page, payload: dict[str, Any]) -> None:
    try:
        with page.expect_file_chooser(timeout=QUICK_MS) as chooser:
            click(page.get_by_role("button", name="Upload cover"))
        chooser.value.set_files(payload)
    except PlaywrightError:
        page.get_by_label("Cover image").set_input_files(payload)


class Relay:

    def __init__(self, upstream: str) -> None:
        parts = urlsplit(upstream)
        self.target = (parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen()
        self.url = urlunsplit((parts.scheme, f"127.0.0.1:{self.server.getsockname()[1]}", parts.path, parts.query, ""))
        self.open = False
        self.lock = threading.Lock()
        self.pipes: list[socket.socket] = []
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            if not self.open:
                client.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
            except OSError:
                client.close()
                continue
            upstream.settimeout(None)
            with self.lock:
                self.pipes += [client, upstream]
            for source, sink in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(source, sink), daemon=True).start()

    @staticmethod
    def _pipe(source: socket.socket, sink: socket.socket) -> None:
        try:
            while chunk := source.recv(65536):
                sink.sendall(chunk)
        except OSError:
            pass
        finally:
            for end in (source, sink):
                try:
                    end.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def up(self) -> None:
        self.open = True

    def down(self) -> None:
        self.open = False
        with self.lock:
            pipes, self.pipes = self.pipes, []
        for end in pipes:
            try:
                end.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            end.close()

    def stop(self) -> None:
        self.down()
        try:
            self.server.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.server.close()


def log_tail(path: Path) -> str:
    return path.read_text(errors="replace")[-4000:]


@contextmanager
def app_copy(**overrides: str) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base, **overrides}
    log = Path(tempfile.mkstemp(suffix=".log")[1])
    with log.open("wb") as sink:
        proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=sink, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        deadline = time.monotonic() + BOOT_WAIT_S
        while True:
            try:
                if httpx.get(base + "/api/health", timeout=HEALTH_PROBE_MAX_S).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            assert time.monotonic() < deadline, f"app copy never answered health: {log_tail(log)}"
            try:
                proc.wait(timeout=POLL_S)
                raise AssertionError(f"app copy exited with {proc.returncode}: {log_tail(log)}")
            except subprocess.TimeoutExpired:
                pass
        yield base
        assert proc.poll() is None, f"app copy exited during the test: {log_tail(log)}"
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)


def service_env(name: str) -> str:
    value = os.environ.get(name, "")
    assert value, f"{name} is not set for the verifier"
    return value


@contextmanager
def clock_copy(today: str) -> Iterator[str]:
    with app_copy(LIGHTFALL_TODAY=today) as base:
        yield base


def view_as(base: str, buyer: Account) -> Account:
    return Account(base, sign_in(base, buyer.email, PASSWORD), buyer.user, buyer.email, buyer.name)


def test_catalogue_query(app_url):
    client = http(app_url)
    for params, slugs in CATALOGUE_CASES:
        reply = client.get("/api/catalogue", params=params)
        assert reply.status_code == 200, reply.text
        products = reply.json()["products"]
        assert [p["slug"] for p in products] == slugs, params
    kauri = next(p for p in client.get("/api/catalogue", params={"finish": "BK"}).json()["products"] if p["slug"] == "kauri-downlight")
    assert KDL_DEFAULT in {v["code"] for v in kauri["variants"]}


def test_catalogue_search_filters_in_place(browser, app_url):
    with ui(browser, app_url, "/catalogue") as page:
        count = page.get_by_role("status", name="Results count")
        wait_text(page, count, "5 fittings")
        mark(page)
        start_url = page.url
        fill(page.get_by_role("searchbox", name="Search fittings"), "downlight")
        advance(page, DEBOUNCE_MS)
        wait_text(page, count, "2 fittings")
        for name in PRODUCT_NAMES:
            expected = 1 if name in ("Kauri Downlight", "Rimu Gimbal Downlight") else 0
            wait_count(page, page.get_by_role("article", name=name, exact=True), expected)
        assert page.url != start_url and "downlight" in page.url
        fill(page.get_by_role("searchbox", name="Search fittings"), "")
        advance(page, DEBOUNCE_MS)
        wait_text(page, count, "5 fittings")
        filters = page.get_by_role("region", name="Filters")
        black = filters.get_by_role("group", name="Finish").get_by_role("checkbox", name="Matte Black", exact=True)
        check(black)
        wait_text(page, count, "3 fittings")
        for name in PRODUCT_NAMES:
            expected = 1 if name in ("Kauri Downlight", "Tōtara Track Spot", "Harbour Surface Cylinder") else 0
            wait_count(page, page.get_by_role("article", name=name, exact=True), expected)
        click(black)
        wait_text(page, count, "5 fittings")
        check(filters.get_by_role("group", name="Beam").get_by_role("checkbox", name="15°", exact=True))
        wait_text(page, count, "1 fitting")
        click(filters.get_by_role("group", name="Beam").get_by_role("checkbox", name="15°", exact=True))
        check(filters.get_by_role("checkbox", name="Clearance only", exact=True))
        wait_text(page, count, "2 fittings")
        wait_true(page, lambda: dollars(HSC_CH_PRICE) in shown(page.get_by_role("article", name="Harbour Surface Cylinder", exact=True)), "clearance card shows HSC-CH price")
        wait_true(page, lambda: dollars(RGD_CLEARANCE) in shown(page.get_by_role("article", name="Rimu Gimbal Downlight", exact=True)), "RGD clearance price")
        assert marked(page), "filtering reloaded the page"


ROLE_IDS = ["visitor", "retail", "pending_trade", "declined_trade", "approved_trade", "admin"]


def caller(base: str, role: str) -> httpx.Client:
    if role == "visitor":
        return http(base)
    if role == "retail":
        return retail(base).http
    if role == "pending_trade":
        return applicant(base).http
    if role == "declined_trade":
        account = applicant(base)
        assert decide(base, account, "decline", "Probe reason").status_code == 200
        return relogin(account).http
    if role == "approved_trade":
        return approved_trade(base).http
    return admin_http(base)


@pytest.mark.parametrize("role", ROLE_IDS, ids=ROLE_IDS)
def test_price_fields_by_role(app_url, role):
    client = caller(app_url, role)
    trade = role in ("approved_trade", "admin")
    keys = TRADE_VARIANT_KEYS if trade else VARIANT_KEYS
    replies = [client.get("/api/catalogue"), client.get("/api/catalogue", params={"q": "kauri"}), client.get(f"/api/products/{SEED_SLUGS[0]}"), client.get(f"/api/products/{SEED_SLUGS[4]}")]
    products = []
    for reply in replies:
        assert reply.status_code == 200, reply.text
        body = reply.json()
        products += body.get("products", []) + ([body["product"]] if "product" in body else [])
        if not trade:
            assert "trade_price_cents" not in reply.text
    for product in products:
        assert set(product) == PRODUCT_KEYS
        for v in product["variants"]:
            assert set(v) == keys, v
    compare = client.get("/api/compare", params={"codes": f"{KDL_DEFAULT},{RGD}"})
    assert compare.status_code == 200, compare.text
    for item in compare.json()["items"]:
        assert set(item) == COMPARE_KEYS | keys
    if not trade:
        assert "trade_price_cents" not in compare.text
    kdl = variant_of(app_url, "kauri-downlight", KDL_DEFAULT, client)
    assert (kdl["retail_price_cents"], kdl["was_price_cents"], kdl["clearance"], kdl["stock_on_hand"]) == (KDL_WH_36_RETAIL, None, False, None)
    rgd = variant_of(app_url, "rimu-gimbal-downlight", RGD, client)
    assert (rgd["retail_price_cents"], rgd["was_price_cents"], rgd["clearance"]) == (RGD_CLEARANCE, RGD_REGULAR, True)
    assert isinstance(rgd["stock_on_hand"], int)
    if trade:
        assert kdl["trade_price_cents"] == KDL_WH_36_TRADE and rgd["trade_price_cents"] == RGD_CLEARANCE


def test_compare_api(app_url):
    codes = ["TTS-BK-15-3000", "KDL-BK-24-3000", KDL_DEFAULT, "HSC-WH-24-3000"]
    reply = http(app_url).get("/api/compare", params={"codes": ",".join(codes)})
    assert reply.status_code == 200, reply.text
    items = reply.json()["items"]
    assert [i["code"] for i in items] == codes
    for item in items:
        assert item["pool_diameter_mm_at_2700"] == pool_mm(DEFAULT_CEILING_MM, beam_of(item["code"]))
        assert item["centre_lux_at_2700"] == own_lux(CANDELA[item["code"]], DEFAULT_CEILING_MM)
    assert items[1]["pool_diameter_mm_at_2700"] == EXAMPLE_POOL_MM and items[1]["centre_lux_at_2700"] == EXAMPLE_OWN_LUX
    assert items[0]["product_slug"] == "totara-track-spot" and items[0]["product_name"] == "Tōtara Track Spot"
    five = http(app_url).get("/api/compare", params={"codes": ",".join(codes + [RGD])})
    assert five.status_code == 422 and five.json()["errors"]["codes"] == "too_many"
    unknown = http(app_url).get("/api/compare", params={"codes": "ZZZ-ZZ-1-1"})
    assert unknown.status_code == 404 and unknown.json() == {"error": "unknown_variant"}


def test_favourites_api(app_url):
    shopper = retail(app_url, "fav")
    assert shopper.http.put(f"/api/favourites/{KDL_DEFAULT}").json() == {"saved": True}
    assert shopper.http.put(f"/api/favourites/{KDL_DEFAULT}").status_code == 200
    other_device = sign_in(app_url, shopper.email, PASSWORD)
    items = other_device.get("/api/favourites").json()["items"]
    assert [i["code"] for i in items] == [KDL_DEFAULT]
    assert items[0]["product_slug"] == "kauri-downlight" and items[0]["product_name"] == "Kauri Downlight"
    assert "trade_price_cents" not in items[0]
    assert shopper.http.put(f"/api/favourites/{UNKNOWN_CODE}").status_code == 404
    assert http(app_url).put(f"/api/favourites/{KDL_DEFAULT}").json() == {"error": "unauthenticated"}
    assert other_device.delete(f"/api/favourites/{KDL_DEFAULT}").status_code == 204
    assert sign_in(app_url, shopper.email, PASSWORD).get("/api/favourites").json()["items"] == []


VIEWPORT_IDS = ["375x812", "768x1024", "1280x800"]


def size_of(case: str) -> tuple[int, int]:
    width, height = case.split("x")
    return int(width), int(height)


def assert_trapped(page: Page, dialog: Locator) -> None:
    for key in ["Tab"] * TRAP_PRESSES + ["Shift+Tab"] * TRAP_PRESSES:
        page.keyboard.press(key)
        assert holds_focus(dialog), f"{key} left the open dialog"


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_closed_panels_unavailable(browser, app_url, viewport):
    width, height = size_of(viewport)
    hidden = set(FAMILY_LINKS) | {"Show results", "Open comparison"}
    with ui(browser, app_url, "/catalogue", size=(width, height)) as page:
        wait_count(page, page.get_by_role("searchbox", name="Search fittings"), 1)
        layout(page)
        assert not hidden & set(tab_order(page, TAB_SWEEP))
        assert page.get_by_role("region", name="Compare tray").count() == 0
        if width >= 768:
            opener = page.get_by_role("button", name="Catalogue", exact=True)
            assert opener.get_attribute("aria-expanded") == "false"
            assert page.get_by_role("region", name="Catalogue menu").count() == 0
            opener.focus()
            page.keyboard.press("Enter")
            menu = page.get_by_role("region", name="Catalogue menu")
            wait_count(page, menu.get_by_role("link", name="Downlights", exact=True), 1)
            assert opener.get_attribute("aria-expanded") == "true"
            page.keyboard.press("Escape")
            wait_count(page, page.get_by_role("region", name="Catalogue menu"), 0)
            wait_true(page, lambda: focused(opener), "focus returns to Catalogue")
            page.keyboard.press("ArrowDown")
            wait_true(page, lambda: focused(page.get_by_role("link", name="Downlights", exact=True)), "Down Arrow focuses the first link")
            page.keyboard.press("Escape")
            wait_count(page, page.get_by_role("region", name="Catalogue menu"), 0)
        else:
            assert page.get_by_role("dialog", name="Menu").count() == 0
            opener = page.get_by_role("button", name="Menu", exact=True)
            click(opener)
            dialog = page.get_by_role("dialog", name="Menu")
            wait_count(page, dialog.get_by_role("link", name="Downlights", exact=True), 1)
            wait_true(page, lambda: holds_focus(dialog), "focus moves into the menu")
            assert_trapped(page, dialog)
            page.keyboard.press("Escape")
            wait_count(page, page.get_by_role("dialog", name="Menu"), 0)
            wait_true(page, lambda: focused(opener), "focus returns to Menu")
        if width < 1280:
            assert page.get_by_role("dialog", name="Filters").count() == 0
            opener = page.get_by_role("button", name="Filters", exact=True)
            click(opener)
            sheet = page.get_by_role("dialog", name="Filters")
            wait_count(page, sheet.get_by_role("button", name="Show results"), 1)
            wait_true(page, lambda: holds_focus(sheet), "focus moves into the sheet")
            assert_trapped(page, sheet)
            page.keyboard.press("Escape")
            wait_count(page, page.get_by_role("dialog", name="Filters"), 0)
            wait_true(page, lambda: focused(opener), "focus returns to Filters")
        else:
            assert page.get_by_role("region", name="Filters").count() == 1
        tray_count = 0
        toggle = page.get_by_role("button", name=f"Compare ({tray_count})")
        click(toggle)
        wait_count(page, page.get_by_role("region", name="Compare tray"), 1)
        click(page.get_by_role("button", name=f"Compare ({tray_count})"))
        wait_count(page, page.get_by_role("region", name="Compare tray"), 0)
        layout(page)
        assert not hidden & set(tab_order(page, TAB_SWEEP))


def test_wf_retail_browse_happy(browser, app_url):
    shopper = retail(app_url, "browse")
    with ui(browser, app_url, "/catalogue", account=shopper) as page:
        count = page.get_by_role("status", name="Results count")
        fill(page.get_by_role("searchbox", name="Search fittings"), "downlight")
        advance(page, DEBOUNCE_MS)
        wait_text(page, count, "2 fittings")
        fill(page.get_by_role("searchbox", name="Search fittings"), "")
        advance(page, DEBOUNCE_MS)
        wait_text(page, count, "5 fittings")
        check(page.get_by_role("region", name="Filters").get_by_role("checkbox", name="Matte Black", exact=True))
        wait_text(page, count, "3 fittings")
        chosen = ("Kauri Downlight", "Tōtara Track Spot", "Harbour Surface Cylinder")
        for name in chosen:
            click(page.get_by_role("button", name=f"Compare {name}", exact=True))
        wait_count(page, page.get_by_role("button", name=f"Compare ({len(chosen)})"), 1)
        click(page.get_by_role("button", name=f"Compare ({len(chosen)})"))
        click(page.get_by_role("region", name="Compare tray").get_by_role("link", name="Open comparison"))
        table = page.get_by_role("table", name="Comparison")
        wait_count(page, table, 1)
        for code in (KDL_DEFAULT, "TTS-BK-24-3000", "HSC-WH-24-3000"):
            wait_true(page, lambda code=code: code in shown(table), f"{code} in comparison")
        assert str(pool_mm(DEFAULT_CEILING_MM, 36)) in shown(table)
        assert str(own_lux(CANDELA["TTS-BK-24-3000"], DEFAULT_CEILING_MM)) in shown(table)
        page.goto(base_of(app_url) + "/catalogue")
        save = page.get_by_role("button", name=f"Save {PRODUCT_NAMES[0]}", exact=True)
        click(save)
        wait_true(page, lambda: save.get_attribute("aria-pressed") == "true", "save pressed")
        click(page.get_by_role("article", name="Kauri Downlight", exact=True).get_by_role("link", name="Kauri Downlight"))
        wait_count(page, page.get_by_role("heading", name="Kauri Downlight", level=1), 1)
        click(product_radio(page, "Beam angle", "24°"))
        wait_text(page, page.get_by_role("status", name="Product updates"), variant_announcement(PRODUCT_NAMES[0], "Matte White", 24, 3000, 900, KDL_24_RETAIL))
    saved = sign_in(app_url, shopper.email, PASSWORD).get("/api/favourites").json()["items"]
    assert [i["product_slug"] for i in saved] == ["kauri-downlight"]


def test_wf_retail_browse_tray_full(browser, app_url):
    with ui(browser, app_url, "/catalogue") as page:
        for name in PRODUCT_NAMES:
            click(page.get_by_role("button", name=f"Compare {name}", exact=True))
        wait_true(page, lambda: "You can compare up to four fittings." in body_text(page), "full-tray copy")
        assert page.get_by_role("button", name=f"Compare ({COMPARE_MAX})").count() == 1
        assert page.get_by_role("button", name=f"Compare {PRODUCT_NAMES[4]}", exact=True).get_attribute("aria-pressed") != "true"
        page.goto(base_of(app_url) + "/products/kauri-downlight")
        wait_count(page, page.get_by_role("button", name=f"Compare ({COMPARE_MAX})"), 1)
        click(page.get_by_role("button", name=f"Compare ({COMPARE_MAX})"))
        tray = page.get_by_role("region", name="Compare tray")
        wait_count(page, tray.get_by_role("button", name=f"Remove {PRODUCT_NAMES[0]} from comparison"), 1)
        click(tray.get_by_role("link", name="Open comparison"))
        table = page.get_by_role("table", name="Comparison")
        wait_true(page, lambda: all(c in shown(table) for c in (KDL_DEFAULT, "TTS-BK-24-3000", "PHP-BR-60-2700", "HSC-WH-24-3000")), "four in comparison")
        assert RGD not in shown(table)
    five = http(app_url).get("/api/compare", params={"codes": ",".join([KDL_DEFAULT, "TTS-BK-24-3000", "PHP-BR-60-2700", "HSC-WH-24-3000", RGD])})
    assert five.status_code == 422 and five.json()["errors"]["codes"] == "too_many"


def test_wf_retail_browse_favourites(browser, app_url):
    with ui(browser, app_url, "/products/kauri-downlight") as page:
        click(page.get_by_role("button", name="Save to favourites"))
        wait_text(page, page.get_by_role("status", name="Product updates"), "Sign in to save favourites.")
    shopper = retail(app_url, "favui")
    with ui(browser, app_url, "/products/kauri-downlight", account=shopper) as page:
        status = page.get_by_role("status", name="Product updates")
        click(page.get_by_role("button", name="Save to favourites"))
        wait_text(page, status, "Saved to favourites.")
        poll(lambda: [i["code"] for i in sign_in(app_url, shopper.email, PASSWORD).get("/api/favourites").json()["items"]] == [KDL_DEFAULT] or (_ for _ in ()).throw(AssertionError("not saved")))
        page.goto(base_of(app_url) + "/favourites")
        wait_count(page, page.get_by_role("article", name="Kauri Downlight", exact=True), 1)
        page.goto(base_of(app_url) + "/products/kauri-downlight")
        click(page.get_by_role("button", name="Save to favourites"))
        wait_text(page, page.get_by_role("status", name="Product updates"), "Removed from favourites.")
    assert sign_in(app_url, shopper.email, PASSWORD).get("/api/favourites").json()["items"] == []


def test_cart_gst_totals(browser, app_url):
    trade = approved_trade(app_url, "carttrade")
    order = add_line(trade, "PHP-BZ-60-2700", 1)
    assert set(order) == ORDER_KEYS and ORDER_KEY_RE.fullmatch(order["order_key"])
    assert (order["price_tier"], order["subtotal_cents"], order["gst_cents"], order["total_cents"]) == ("trade", PHP_BZ_TRADE, PHP_BZ_GST, PHP_BZ_TOTAL)
    assert order["lines"][0]["unit_price_cents"] == PHP_BZ_TRADE and order["lines"][0]["line_total_cents"] == PHP_BZ_TRADE
    pending = applicant(app_url, "cartpending")
    first = add_line(pending, "PHP-BZ-60-2700", 1)
    assert (first["price_tier"], first["subtotal_cents"], first["gst_cents"], first["total_cents"]) == ("retail", PHP_BZ_RETAIL, gst(PHP_BZ_RETAIL), PHP_BZ_RETAIL + gst(PHP_BZ_RETAIL))
    assert decide(app_url, pending, "approve").status_code == 200
    repriced = relogin(pending).http.get("/api/cart").json()["order"]
    assert repriced["order_key"] == first["order_key"] and repriced["price_tier"] == "trade" and repriced["total_cents"] == PHP_BZ_TOTAL
    buyer = retail(app_url, "cartretail")
    add_line(buyer, KDL_DEFAULT, 2)
    three = buyer.http.patch(f"/api/cart/lines/{KDL_DEFAULT}", json={"quantity": 3}).json()["order"]
    assert (three["subtotal_cents"], three["gst_cents"], three["total_cents"]) == (3 * KDL_WH_36_RETAIL, gst(3 * KDL_WH_36_RETAIL), 3 * KDL_WH_36_RETAIL + gst(3 * KDL_WH_36_RETAIL))
    emptied = buyer.http.patch(f"/api/cart/lines/{KDL_DEFAULT}", json={"quantity": 0}).json()["order"]
    assert emptied["lines"] == [] and emptied["subtotal_cents"] == 0
    assert buyer.http.post("/api/cart/lines", json={"variant_code": KDL_DEFAULT, "quantity": 1000}).status_code == 422
    assert buyer.http.post("/api/cart/lines", json={"variant_code": "ZZZ-ZZ-1-1", "quantity": 1}).status_code == 404
    with ui(browser, app_url, "/cart", account=trade) as page:
        table = page.get_by_role("table", name="Cart")
        wait_true(page, lambda: "PHP-BZ-60-2700" in shown(table) and dollars(PHP_BZ_TRADE) in shown(table), "cart line")
        cart_code = "PHP-BZ-60-2700"
        assert page.get_by_role("spinbutton", name=f"Quantity for {cart_code}").count() == 1
        text_now = body_text(page)
        for part in ("Subtotal (excl. GST)", dollars(PHP_BZ_TRADE), dollars(PHP_BZ_GST), "Total (incl. GST)", dollars(PHP_BZ_TOTAL)):
            assert part in text_now, part
        assert text_now.count("GST (15%)") == 1


def test_card_authorisation_in_killbill(app_url, killbill):
    buyer = retail(app_url, "card")
    order = add_line(buyer, KDL_DEFAULT, 1)
    key = order["order_key"]
    total = KDL_WH_36_RETAIL + gst(KDL_WH_36_RETAIL)
    for field, card_number, card_changes in (("postcode", APPROVE_CARD, {}), ("number", "4242 4242 4242 4241", {}), ("expiry", APPROVE_CARD, {"expiry": PAST_EXPIRY}), ("cvc", APPROVE_CARD, {"cvc": "12"})):
        body = checkout_body(card_number)
        body["card"].update(card_changes)
        if field == "postcode":
            body["delivery"]["postcode"] = "801"
        reply = pay(buyer, key, body=body)
        assert reply.status_code == 422 and field in reply.json()["errors"], reply.text
    assert killbill.payment_by_key(key) is None
    reply = pay(buyer, key)
    assert reply.status_code == 200, reply.text
    paid = reply.json()["order"]
    assert set(paid) == ORDER_KEYS
    assert (paid["status"], paid["display_status"], paid["payment_method"], paid["card_last4"], paid["total_cents"]) == ("authorised", "Authorised", "card", "4242", total)
    account = kb_account(killbill, buyer.user)
    assert account is not None and "NZD" in account.values()
    payment = killbill.payment_by_key(key)
    assert payment is not None and kb_account_id(account) in payment.values()
    assert killbill.default_plugin(kb_account_id(account)) is not None
    auths = transactions(payment, "AUTHORIZE")
    assert len(auths) == 1 and f"{key}-auth" in auths[0].values() and amount_in(auths[0], total)
    assert key in [o["order_key"] for o in buyer.http.get("/api/orders").json()["orders"]]
    assert retail(app_url, "nosy").http.get(f"/api/orders/{key}").status_code == 404
    assert buyer.http.get("/api/cart").json()["order"]["order_key"] != key


def test_authorise_idempotency(app_url, killbill):
    buyer = retail(app_url, "idem")
    key = add_line(buyer, KDL_DEFAULT, 1)["order_key"]
    assert buyer.http.post(f"/api/orders/{key}/authorise", json=checkout_body()).json() == {"error": "idempotency_key_required"}
    request_key = idempotency_key()
    with ThreadPoolExecutor(2) as pool:
        replies = list(pool.map(lambda _: pay(buyer, key, key=request_key), range(2)))
    codes = sorted(r.status_code for r in replies)
    assert 200 in codes and all(r.status_code == 200 or r.json() == {"error": "request_in_progress"} for r in replies), codes
    first = next(r for r in replies if r.status_code == 200)
    replay = pay(buyer, key, key=request_key)
    assert replay.status_code == 200 and replay.json() == first.json()
    other = checkout_body()
    other["delivery"]["city"] = "Ōtautahi"
    assert pay(buyer, key, key=request_key, body=other).json() == {"error": "idempotency_conflict"}
    again = pay(buyer, key)
    assert again.status_code == 409 and again.json() == {"error": "invalid_state", "status": "authorised"}
    assert len(transactions(killbill.payment_by_key(key), "AUTHORIZE")) == 1
    declined = retail(app_url, "idemdecline")
    dkey = add_line(declined, KDL_DEFAULT, 1)["order_key"]
    decline_key = idempotency_key()
    first_decline = pay(declined, dkey, DECLINE_CARD, key=decline_key)
    assert first_decline.status_code == 402
    second_decline = pay(declined, dkey, DECLINE_CARD, key=decline_key)
    assert second_decline.status_code == 402 and second_decline.json() == first_decline.json()
    assert killbill.payment_by_key(dkey) is None


def test_declined_card_recovers(app_url, killbill):
    buyer = retail(app_url, "decline")
    key = add_line(buyer, KDL_DEFAULT, 1)["order_key"]
    reply = pay(buyer, key, DECLINE_CARD)
    assert reply.status_code == 402 and reply.json()["error"] == "card_declined"
    assert (reply.json()["order"]["status"], reply.json()["order"]["display_status"]) == ("declined", "Declined")
    assert killbill.payment_by_key(key) is None
    cart = buyer.http.get("/api/cart").json()["order"]
    assert cart["order_key"] == key and cart["status"] == "declined"
    assert buyer.http.patch(f"/api/cart/lines/{KDL_DEFAULT}", json={"quantity": 2}).status_code == 200
    ok = pay(buyer, key)
    assert ok.status_code == 200 and ok.json()["order"]["status"] == "authorised"
    total = 2 * KDL_WH_36_RETAIL + gst(2 * KDL_WH_36_RETAIL)
    auths = transactions(killbill.payment_by_key(key), "AUTHORIZE")
    assert len(auths) == 1 and amount_in(auths[0], total)


def test_payment_outage_recoverable(killbill):
    base = outage("APP_KILLBILL_DOWN_URL")
    buyer = retail(base, "kbdown")
    key = add_line(buyer, KDL_DEFAULT, 1)["order_key"]
    for _ in range(2):
        reply = pay(buyer, key)
        assert reply.status_code == 503 and reply.json()["error"] == "payment_unavailable", reply.text
        assert (reply.json()["order"]["status"], reply.json()["order"]["display_status"]) == ("gateway_unavailable", "Payment pending")
    cart = buyer.http.get("/api/cart").json()["order"]
    assert cart["order_key"] == key and cart["status"] == "gateway_unavailable"
    assert killbill.payment_by_key(key) is None


def test_order_confirmation_email(app_url, mail):
    buyer = retail(app_url, "receipt")
    add_line(buyer, KDL_DEFAULT, 2)
    order = add_line(buyer, "TTS-BK-36-3000", 1)
    key = order["order_key"]
    request_key = idempotency_key()
    assert pay(buyer, key, key=request_key).status_code == 200
    assert pay(buyer, key, key=request_key).status_code == 200
    subtotal = 2 * KDL_WH_36_RETAIL + TTS_36_RETAIL
    messages = inbox(mail, f"Your Lightfall order {key}")
    assert len(messages) == 1
    assert buyer.email in serial(messages[0]) and MAIL_FROM_ADDRESS in serial(messages[0])
    body = mail_body(messages[0])
    for part in (f"{KDL_DEFAULT} x 2", dollars(2 * KDL_WH_36_RETAIL), "TTS-BK-36-3000 x 1", dollars(TTS_36_RETAIL), "Subtotal (excl. GST)", dollars(subtotal), "GST (15%)", dollars(gst(subtotal)), "Total (incl. GST)", dollars(subtotal + gst(subtotal))):
        assert part in body, part
    po = f"PO-{uuid.uuid4().hex[:8]}"
    trade, placed = account_order(app_url, [("PHP-BZ-60-2700", 1)], po)
    account_mail = inbox(mail, f"Your Lightfall order {placed['order_key']}")
    assert len(account_mail) == 1 and trade.email in serial(account_mail[0])
    body = mail_body(account_mail[0])
    for part in (po, "PHP-BZ-60-2700 x 1", dollars(PHP_BZ_TRADE), dollars(PHP_BZ_GST), dollars(PHP_BZ_TOTAL)):
        assert part in body, part


def test_keyboard_only_checkout(browser, app_url, killbill):
    buyer = retail(app_url, "keys")
    add_line(buyer, KDL_DEFAULT, 1)
    total = KDL_WH_36_RETAIL + gst(KDL_WH_36_RETAIL)
    fields = [("Full name", DELIVERY["name"]), ("Address", DELIVERY["address"]), ("City", DELIVERY["city"]), ("Postcode", DELIVERY["postcode"]), ("Card number", APPROVE_CARD), ("Expiry (MM/YY)", CARD_EXPIRY), ("Security code", CARD_CVC), ("Name on card", DELIVERY["name"])]
    names = [n for n, _ in fields] + [f"Pay {dollars(total)}"]
    with ui(browser, app_url, "/cart", account=buyer) as page:
        wait_count(page, page.get_by_role("link", name="Checkout"), 1)
        tab_to(page, "Checkout")
        page.keyboard.press("Enter")
        wait_true(page, lambda: urlsplit(page.url).path == "/checkout", "keyboard reached checkout")
        wait_count(page, page.get_by_role("form", name="Checkout"), 1)
        for index, (label, value) in enumerate(fields):
            tab_to(page, label, forbid=tuple(names[index + 1:]))
            page.keyboard.type(value)
        tab_to(page, names[-1], forbid=tuple(names[:-1]))
        for target in (page.get_by_role("textbox", name="Full name", exact=True), page.get_by_role("button", name=names[-1])):
            rest, focus = state_styles(target, "outline-style", "outline-width", "outline-color", "box-shadow", state="focus")
            assert rest != focus, "no visible focus indicator"
        page.get_by_role("button", name=names[-1]).focus()
        page.keyboard.press("Enter")
        wait_count(page, page.get_by_role("heading", name="Order confirmed", level=1), 1)
        key = order_key_in(page)
    assert len(transactions(killbill.payment_by_key(key), "AUTHORIZE")) == 1


def test_wf_retail_checkout_happy(browser, app_url, killbill, mail):
    buyer = retail(app_url, "journey")
    subtotal = 2 * KDL_24_RETAIL
    total = subtotal + gst(subtotal)
    with ui(browser, app_url, "/products/kauri-downlight", account=buyer) as page:
        click(product_radio(page, "Beam angle", "24°"))
        fill(page.get_by_role("region", name="Specification").get_by_role("spinbutton", name="Quantity"), "2")
        click(page.get_by_role("button", name="Add to cart", exact=True))
        wait_text(page, page.get_by_role("status", name="Product updates"), f"Added 2 to cart. Cart total {dollars(subtotal)} + GST.")
        page.goto(base_of(app_url) + "/checkout")
        fill_delivery(page)
        fill_card(page, DECLINE_CARD)
        click(page.get_by_role("button", name=f"Pay {dollars(total)}"))
        declined = payment_alert(page, "Card declined")
        wait_count(page, declined, 1)
        assert declined.get_by_text("Your bank declined this card. No money has been taken. Try another card or contact your bank.", exact=True).count() == 1
        key = buyer.http.get("/api/cart").json()["order"]["order_key"]
        assert killbill.payment_by_key(key) is None
        fill(page.get_by_role("form", name="Checkout").get_by_role("textbox", name="Card number", exact=True), APPROVE_CARD)
        click(page.get_by_role("button", name=f"Pay {dollars(total)}"))
        wait_count(page, page.get_by_role("heading", name="Order confirmed", level=1), 1)
        assert order_key_in(page) == key
        wait_true(page, lambda: f"Order {key} is confirmed. A receipt is on its way to {buyer.email}." in body_text(page), "confirmation body")
    auths = transactions(killbill.payment_by_key(key), "AUTHORIZE")
    assert len(auths) == 1 and amount_in(auths[0], total)
    receipt = inbox(mail, f"Your Lightfall order {key}")
    assert len(receipt) == 1
    body = mail_body(receipt[0])
    assert f"{KDL_WH_24} x {2}" in body and "GST (15%)" in body and dollars(gst(subtotal)) in body and dollars(total) in body


def test_wf_retail_checkout_outage(browser, killbill):
    base = outage("APP_KILLBILL_DOWN_URL")
    buyer = retail(base, "kbdownui")
    key = add_line(buyer, KDL_DEFAULT, 1)["order_key"]
    pay_name = f"Pay {dollars(KDL_WH_36_RETAIL + gst(KDL_WH_36_RETAIL))}"
    body = "We couldn't reach our payment service. Your order is saved and you will only be charged once. Try again in a few minutes."
    with ui(browser, base, "/checkout", account=buyer) as page:
        fill_delivery(page)
        fill_card(page)
        for _ in range(2):
            click(page.get_by_role("button", name=pay_name))
            alert = payment_alert(page, "Payment service unavailable")
            wait_count(page, alert, 1)
            assert alert.get_by_text(body, exact=True).count() == 1
            wait_true(page, lambda: page.get_by_role("button", name=pay_name).is_enabled(), "Pay is available again")
    assert buyer.http.get("/api/cart").json()["order"]["status"] == "gateway_unavailable"
    assert killbill.payment_by_key(key) is None


def test_wf_retail_checkout_double_pay(browser, app_url, killbill):
    buyer = retail(app_url, "dbl")
    key = add_line(buyer, KDL_DEFAULT, 1)["order_key"]
    pay_name = f"Pay {dollars(KDL_WH_36_RETAIL + gst(KDL_WH_36_RETAIL))}"
    with ui(browser, app_url, "/checkout", account=buyer) as page:
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if r.url.endswith("/authorise") else None)
        fill_delivery(page)
        fill_card(page)
        with held(page, "**/api/orders/*/authorise") as gate:
            x, y = center(page.get_by_role("button", name=pay_name))
            page.mouse.dblclick(x, y)
            pending = page.get_by_role("button", name="Authorising payment")
            wait_count(page, pending, 1)
            assert pending.is_disabled()
            page.mouse.dblclick(x, y)
            gate.release()
        wait_count(page, page.get_by_role("heading", name="Order confirmed", level=1), 1)
        assert len(sent) == 1, sent
    assert len(transactions(killbill.payment_by_key(key), "AUTHORIZE")) == 1


def test_clearance_price_and_stock(browser, app_url):
    set_stock(app_url, RGD, 2)
    strike = "(el) => { for (let n = el; n; n = n.parentElement) { if (getComputedStyle(n).textDecorationLine.includes('line-through')) return true; } return false; }"
    with ui(browser, app_url, "/catalogue?family=clearance") as page:
        card = page.get_by_role("article", name="Rimu Gimbal Downlight", exact=True)
        wait_true(page, lambda: all(p in shown(card) for p in ("Only 2 left", f"{dollars(RGD_CLEARANCE)} + GST", dollars(RGD_REGULAR))), "clearance card")
        assert card.get_by_text(dollars(RGD_REGULAR)).first.evaluate(strike)
        wait_true(page, lambda: dollars(HSC_CH_PRICE) in shown(page.get_by_role("article", name="Harbour Surface Cylinder", exact=True)), "HSC-CH clearance price")
        page.goto(base_of(app_url) + "/catalogue")
        harbour = page.get_by_role("article", name="Harbour Surface Cylinder", exact=True)
        wait_true(page, lambda: f"{dollars(HSC_24_RETAIL)} + GST" in shown(harbour), "regular HSC price")
        assert "left" not in shown(harbour) and "Sold out" not in shown(harbour)
        page.goto(base_of(app_url) + "/products/rimu-gimbal-downlight")
        wait_true(page, lambda: "Only 2 left" in body_text(page), "product page stock")
    with ui(browser, app_url, "/admin", account=admin_account(app_url)) as page:
        click(page.get_by_role("tab", name="Stock"))
        row = admin_row(page, "Clearance stock", RGD)
        wait_true(page, lambda: [c.strip() for c in shown(row).split("\t")][3] == "2", "admin On hand")
    assert stock_item(app_url, RGD)["stock_on_hand"] == 2 and variant_of(app_url, "rimu-gimbal-downlight", RGD)["stock_on_hand"] == 2


def test_no_overselling(app_url, killbill):
    for units in (1, 2):
        set_stock(app_url, HSC_CH, units)
        buyers = [retail(app_url, "rush") for _ in range(units + 2)]
        keys = [add_line(b, HSC_CH, 1)["order_key"] for b in buyers]
        with ThreadPoolExecutor(len(buyers)) as pool:
            replies = list(pool.map(lambda pair: pay(*pair), zip(buyers, keys)))
        assert [r.status_code for r in replies].count(200) == units
        for key, reply in zip(keys, replies):
            if reply.status_code == 200:
                assert len(transactions(killbill.payment_by_key(key), "AUTHORIZE")) == 1
            else:
                assert reply.status_code == 409 and reply.json()["error"] == "insufficient_stock", reply.text
                assert killbill.payment_by_key(key) is None
        item = stock_item(app_url, HSC_CH)
        assert item["stock_on_hand"] == 0 and sum(m["delta"] for m in item["movements"]) == 0
        late = retail(app_url, "late").http.post("/api/cart/lines", json={"variant_code": HSC_CH, "quantity": 1})
        assert late.status_code == 409 and late.json() == {"error": "insufficient_stock", "available": 0}


def test_stock_movements(app_url):
    set_stock(app_url, RGD, 3)
    winner = retail(app_url, "mvsale")
    key = add_line(winner, RGD, 1)["order_key"]
    request_key = idempotency_key()
    assert pay(winner, key, key=request_key).status_code == 200
    assert pay(winner, key, key=request_key).status_code == 200
    loser = retail(app_url, "mvdecline")
    dkey = add_line(loser, RGD, 1)["order_key"]
    assert pay(loser, dkey, DECLINE_CARD).status_code == 402
    note = f"Recount {uuid.uuid4().hex[:6]}"
    adjusted = admin_http(app_url).patch(f"/api/admin/variants/{RGD}", json={"stock_adjust": 2, "note": note})
    assert adjusted.status_code == 200 and adjusted.json()["item"]["stock_on_hand"] == 4
    below = admin_http(app_url).patch(f"/api/admin/variants/{RGD}", json={"stock_adjust": -5, "note": note})
    assert below.status_code == 409 and below.json() == {"error": "stock_below_zero"}
    item = stock_item(app_url, RGD)
    sales = [m for m in item["movements"] if m["order_key"] == key]
    assert [(m["reason"], m["delta"]) for m in sales] == [("sale", -1)]
    assert sorted((m["reason"], m["delta"]) for m in item["movements"] if m["order_key"] == dkey) == [("release", 1), ("sale", -1)]
    assert any(m["reason"] == "adjust" and m["note"] == note and m["delta"] == 2 for m in item["movements"])
    assert any(m["reason"] == "seed" for m in item["movements"])
    assert sum(m["delta"] for m in item["movements"]) == item["stock_on_hand"] == 4
    assert variant_of(app_url, "rimu-gimbal-downlight", RGD)["stock_on_hand"] == 4
    down = outage("APP_KILLBILL_DOWN_URL")
    buyer = retail(down, "mvoutage")
    okey = add_line(buyer, RGD, 1)["order_key"]
    assert pay(buyer, okey).status_code == 503
    out = stock_item(down, RGD)
    assert sorted((m["reason"], m["delta"]) for m in out["movements"] if m["order_key"] == okey) == [("release", 1), ("sale", -1)]
    assert sum(m["delta"] for m in out["movements"]) == out["stock_on_hand"]


def test_wf_clearance_stock_last_unit(browser, app_url, killbill):
    set_stock(app_url, HSC_CH, 1)
    buyers = [retail(app_url, "lastunit") for _ in range(2)]
    keys = [add_line(b, HSC_CH, 1)["order_key"] for b in buyers]
    pay_name = f"Pay {dollars(HSC_CH_PRICE + gst(HSC_CH_PRICE))}"
    with ui(browser, app_url, "/checkout", account=buyers[0]) as first, ui(browser, app_url, "/checkout", account=buyers[1]) as second:
        for page in (first, second):
            fill_delivery(page)
            fill_card(page)
        click(first.get_by_role("button", name=pay_name))
        click(second.get_by_role("button", name=pay_name))
        outcomes = []
        for page in (first, second):
            def settled(page: Page = page) -> bool:
                if page.get_by_role("heading", name="Order confirmed", level=1).count():
                    return True
                alert = payment_alert(page, "Sold out while you were checking out")
                assert alert.count() == 1, "no outcome yet"
                assert alert.get_by_text(f"Someone else bought the last units of {PRODUCT_NAMES[3]}. Your card has not been charged.", exact=True).count() == 1
                return False
            outcomes.append(eventually(page, settled))
    assert sorted(outcomes) == [False, True]
    for key, won in zip(keys, outcomes):
        payment = killbill.payment_by_key(key)
        assert (payment is None) == (not won)
    with ui(browser, app_url, "/catalogue?family=clearance") as page:
        wait_true(page, lambda: "Sold out" in shown(page.get_by_role("article", name="Harbour Surface Cylinder", exact=True)), "card sold out")
        page.goto(base_of(app_url) + f"/products/harbour-surface-cylinder?variant={HSC_CH}")
        wait_true(page, lambda: "Sold out" in body_text(page), "product page sold out")
    with ui(browser, app_url, "/admin", account=admin_account(app_url)) as page:
        click(page.get_by_role("tab", name="Stock"))
        row = admin_row(page, "Clearance stock", HSC_CH)
        wait_true(page, lambda: [c.strip() for c in shown(row).split("\t")][3] == "0", "admin shows 0")
    assert stock_item(app_url, HSC_CH)["stock_on_hand"] == 0


def test_wf_clearance_stock_cart_limit(browser, app_url):
    set_stock(app_url, RGD, 2)
    shopper = retail(app_url, "cartlimit")
    with ui(browser, app_url, "/products/rimu-gimbal-downlight", account=shopper) as page:
        quantity = page.get_by_role("region", name="Specification").get_by_role("spinbutton", name="Quantity")
        status = page.get_by_role("status", name="Product updates")
        fill(quantity, "3")
        click(page.get_by_role("button", name="Add to cart", exact=True))
        wait_text(page, status, "Only 2 left.")
        assert shopper.http.get("/api/cart").json()["order"]["lines"] == []
        fill(quantity, "2")
        click(page.get_by_role("button", name="Add to cart", exact=True))
        wait_text(page, status, f"Added 2 to cart. Cart total {dollars(2 * RGD_CLEARANCE)} + GST.")
    lines = shopper.http.get("/api/cart").json()["order"]["lines"]
    assert [(l["variant_code"], l["quantity"]) for l in lines] == [(RGD, 2)]


def test_accounts_and_sign_in(app_url):
    name, email = fresh("signup")
    client = http(app_url)
    reply = client.post("/api/auth/signup", json={"email": email, "password": PASSWORD, "name": name, "account_type": "retail"})
    assert reply.status_code == 201, reply.text
    user = reply.json()["user"]
    assert set(user) == USER_KEYS and (user["email"], user["role"], user["trade_status"], user["dial_mode"]) == (email, "retail", None, "auto")
    cookie = reply.headers.get("set-cookie", "").lower()
    assert SESSION_COOKIE in cookie and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie
    assert client.get("/api/me").json()["user"]["id"] == user["id"]
    dup = http(app_url).post("/api/auth/signup", json={"email": email, "password": PASSWORD, "name": name, "account_type": "retail"})
    assert dup.status_code == 409 and dup.json() == {"error": "email_taken"}
    _, other = fresh("short")
    short = http(app_url).post("/api/auth/signup", json={"email": other, "password": "short-pw1", "name": name, "account_type": "retail"})
    assert short.status_code == 422 and short.json()["errors"]["password"] == "too_short"
    no_trade = http(app_url).post("/api/auth/signup", json={"email": other, "password": PASSWORD, "name": name, "account_type": "trade"})
    assert no_trade.status_code == 422 and "trade" in no_trade.json()["errors"]
    assert client.post("/api/auth/signout").status_code == 204
    assert client.get("/api/me").json() == {"error": "unauthenticated"}
    wrong = http(app_url).post("/api/auth/signin", json={"email": email, "password": PASSWORD + "x"})
    assert wrong.status_code == 401 and wrong.json() == {"error": "invalid_credentials"}
    assert sign_in(app_url, email, PASSWORD).get("/api/me").json()["user"]["id"] == user["id"]


def test_sign_in_form(browser, app_url):
    account = retail(app_url, "signinui")
    with ui(browser, app_url, "/catalogue") as page:
        click(page.get_by_role("link", name="Sign in", exact=True))
        wait_true(page, lambda: urlsplit(page.url).path == "/signin", "Sign in link opens /signin")
        fill(outside_newsletter(page, "textbox", "Email"), account.email)
        fill(page.get_by_role("textbox", name="Password", exact=True), PASSWORD + "x")
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait_true(page, lambda: "Email or password is incorrect." in shown(page.get_by_role("alert")), "sign-in error")
        fill(page.get_by_role("textbox", name="Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait_count(page, page.get_by_role("button", name="Sign out"), 1)


def test_trade_application_pending(browser, app_url):
    _, email = fresh("badnzbn")
    for bad in ("942904123456", "9329041234567", "94290412345ab"):
        reply = http(app_url).post("/api/auth/signup", json={"email": email, "password": PASSWORD, "name": "Probe", "account_type": "trade", "trade": {"business_name": "Probe Ltd", "nzbn": bad, "occupation": "electrician"}})
        assert reply.status_code == 422 and reply.json()["errors"]["nzbn"] == "invalid", reply.text
    assert http(app_url).post("/api/auth/signin", json={"email": email, "password": PASSWORD}).status_code == 401
    account = applicant(app_url, "pending", "lighting_designer")
    assert account.user["trade_status"] == "submitted"
    application = application_of(app_url, account.email, "submitted")
    assert (application["business_name"], application["occupation"], application["status"]) == (account.business, "lighting_designer", "submitted")
    assert re.fullmatch(r"94\d{11}", application["nzbn"])
    with ui(browser, app_url, "/account", account=account) as page:
        wait_text(page, page.get_by_role("status", name="Trade application"), "Your trade application is with our team. You'll see trade prices once it's approved.")
        page.goto(base_of(app_url) + "/products/kauri-downlight")
        wait_true(page, lambda: dollars(KDL_WH_36_RETAIL) in shown(page.get_by_role("region", name="Light readout")), "retail price")
        assert "Trade $" not in body_text(page) and page.get_by_role("link", name="Projects").count() == 0


def test_admin_only_decisions(app_url, mail):
    account = applicant(app_url, "decider")
    app_id = application_of(app_url, account.email, "submitted")["id"]
    path = f"/api/admin/trade-applications/{app_id}"
    assert http(app_url).post(path + "/approve").json() == {"error": "unauthenticated"}
    for client in (retail(app_url).http, approved_trade(app_url).http, account.http):
        assert client.post(path + "/approve").json() == {"error": "forbidden"}
        assert client.post(path + "/decline", json={"reason": "x"}).json() == {"error": "forbidden"}
        assert client.post("/api/admin/trade-applications/999999999/approve").status_code == 403
    assert inbox(mail, account.email, seconds=NO_MAIL_WAIT_S) == []
    assert admin_http(app_url).post(path + "/decline", json={"reason": ""}).status_code == 422
    approved = admin_http(app_url).post(path + "/approve")
    assert approved.status_code == 200 and approved.json()["application"]["status"] == "approved"
    for verdict, body in (("approve", None), ("decline", {"reason": "Too late"})):
        again = admin_http(app_url).post(f"{path}/{verdict}", json=body) if body else admin_http(app_url).post(f"{path}/{verdict}")
        assert again.status_code == 409 and again.json() == {"error": "invalid_state", "status": "approved"}
    assert relogin(account).user["trade_status"] == "approved"


def test_decision_emails(app_url, mail):
    approved = applicant(app_url, "yes")
    assert decide(app_url, approved, "approve").status_code == 200
    message = inbox(mail, approved.email)
    assert len(message) == 1 and "Your Lightfall trade account is approved" in serial(message[0])
    declined = applicant(app_url, "no")
    reason = f"NZBN not found {uuid.uuid4().hex[:6]}"
    assert decide(app_url, declined, "decline", reason).status_code == 200
    message = inbox(mail, declined.email)
    assert len(message) == 1 and "About your Lightfall trade application" in serial(message[0]) and reason in mail_body(message[0])
    assert relogin(declined).user["trade_status"] == "declined"


def test_wf_trade_onboarding_happy(browser, app_url, mail):
    name, email = fresh("wholesaler")
    business = f"Wholesale {uuid.uuid4().hex[:6]}"
    with ui(browser, app_url, "/signup") as page:
        fill(page.get_by_role("textbox", name="Name", exact=True), name)
        fill(outside_newsletter(page, "textbox", "Email"), email)
        fill(page.get_by_role("textbox", name="Password", exact=True), PASSWORD)
        click(page.get_by_role("radiogroup", name="Account type").get_by_role("radio", name="Trade"))
        fill(page.get_by_role("textbox", name="Business name"), business)
        fill(page.get_by_role("textbox", name="NZBN"), nzbn())
        select(outside_newsletter(page, "combobox", "Occupation"), "Wholesaler")
        click(page.get_by_role("button", name="Create account"))
        wait_true(page, lambda: urlsplit(page.url).path == "/account", "goes to /account")
        wait_text(page, page.get_by_role("status", name="Trade application"), "Your trade application is with our team. You'll see trade prices once it's approved.")
        page.goto(base_of(app_url) + "/products/kauri-downlight")
        wait_true(page, lambda: dollars(KDL_WH_36_RETAIL) in shown(page.get_by_role("region", name="Light readout")), "retail price")
        assert "Trade $" not in body_text(page)
        pending_client = http(app_url)
        pending_client.cookies.set(SESSION_COOKIE, next(c["value"] for c in page.context.cookies() if c["name"] == SESSION_COOKIE))
        assert "trade_price_cents" not in pending_client.get("/api/catalogue").text
        assert application_of(app_url, email, "submitted")["occupation"] == "wholesaler"
        with ui(browser, app_url, "/admin", account=admin_account(app_url)) as staff:
            click(staff.get_by_role("tab", name="Applications"))
            click(staff.get_by_role("button", name=f"Approve {business}"))
            wait_text(staff, staff.get_by_role("status", name="Admin updates"), f"Approved {business}.")
        message = inbox(mail, email)
        assert len(message) == 1 and "Your Lightfall trade account is approved" in serial(message[0])
        click(page.get_by_role("button", name="Sign out"))
        page.goto(base_of(app_url) + "/signin")
        fill(outside_newsletter(page, "textbox", "Email"), email)
        fill(page.get_by_role("textbox", name="Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait_count(page, page.get_by_role("button", name="Sign out"), 1)
        page.goto(base_of(app_url) + "/products/kauri-downlight")
        wait_true(page, lambda: f"Trade {dollars(KDL_WH_36_TRADE)} + GST" in body_text(page) and f"RRP {dollars(KDL_WH_36_RETAIL)} + GST" in body_text(page), "trade price lines")
        wait_count(page, page.get_by_role("link", name="Projects"), 1)
    assert application_of(app_url, email, "approved")["status"] == "approved"
    assert "trade_price_cents" in sign_in(app_url, email, PASSWORD).get("/api/catalogue").text


def test_wf_trade_onboarding_decline(browser, app_url, mail):
    account = applicant(app_url, "declineui")
    reason = f"Business not trading {uuid.uuid4().hex[:6]}"
    with ui(browser, app_url, "/admin", account=admin_account(app_url)) as staff:
        click(staff.get_by_role("tab", name="Applications"))
        click(staff.get_by_role("button", name=f"Decline {account.business}"))
        dialog = staff.get_by_role("dialog", name="Decline application")
        fill(dialog.get_by_role("textbox", name="Reason"), reason)
        click(dialog.get_by_role("button", name="Decline", exact=True))
        wait_text(staff, staff.get_by_role("status", name="Admin updates"), f"Declined {account.business}.")
    message = inbox(mail, account.email)
    assert len(message) == 1 and reason in mail_body(message[0])
    assert application_of(app_url, account.email, "declined")["decline_reason"] == reason
    with ui(browser, app_url, "/account", account=relogin(account)) as page:
        wait_text(page, page.get_by_role("status", name="Trade application"), "Your trade application was declined. You can still shop at retail prices.")


def test_wf_trade_onboarding_invalid_nzbn(browser, app_url):
    name, email = fresh("nzbnfix")
    with ui(browser, app_url, "/signup") as page:
        fill(page.get_by_role("textbox", name="Name", exact=True), name)
        fill(outside_newsletter(page, "textbox", "Email"), email)
        fill(page.get_by_role("textbox", name="Password", exact=True), PASSWORD)
        click(page.get_by_role("radiogroup", name="Account type").get_by_role("radio", name="Trade"))
        fill(page.get_by_role("textbox", name="Business name"), f"Fix {uuid.uuid4().hex[:6]}")
        fill(page.get_by_role("textbox", name="NZBN"), "9312345678901")
        select(outside_newsletter(page, "combobox", "Occupation"), "Electrician")
        click(page.get_by_role("button", name="Create account"))
        wait_true(page, lambda: "Enter a 13-digit NZBN starting with 94." in body_text(page), "NZBN error")
        fill(page.get_by_role("textbox", name="NZBN"), nzbn())
        click(page.get_by_role("button", name="Create account"))
        wait_true(page, lambda: urlsplit(page.url).path == "/account", "goes to /account")
    assert application_of(app_url, email, "submitted")["occupation"] == "electrician"


def test_variant_picker_live(browser, app_url):
    status_of = lambda finish, beam, cct, lumens, price: f"Kauri Downlight, {finish}, {beam}° beam, {cct}K: {lumens} lumens, {dollars(price)} + GST."
    with ui(browser, app_url, "/products/kauri-downlight") as page:
        canvas = page.get_by_role("img", name=f"{PRODUCT_NAMES[0]} 3D model")
        readout = page.get_by_role("region", name="Light readout")
        status = page.get_by_role("status", name="Product updates")
        wait_true(page, lambda: canvas.get_attribute("data-beam") == "36", "default beam")
        mark(page)
        click(product_radio(page, "Beam angle", "24°"))
        page.wait_for_load_state("networkidle")
        advance(page, COUNT_FINAL_MS)
        text_now = shown(readout)
        for part in (dollars(KDL_24_RETAIL), "900", str(EXAMPLE_POOL_MM), str(EXAMPLE_OWN_LUX)):
            assert part in text_now, part
        assert canvas.get_attribute("data-beam") == "24" and f"variant={KDL_WH_24}" in page.url
        wait_text(page, status, status_of("Matte White", 24, 3000, 900, KDL_24_RETAIL))
        click(product_radio(page, "Colour temperature", "4000K"))
        wait_true(page, lambda: canvas.get_attribute("data-cct") == "4000", "cct attribute")
        wait_text(page, status, status_of("Matte White", 24, 4000, 940, KDL_24_RETAIL))
        lux_4000 = str(own_lux(CANDELA["KDL-WH-24-4000"], DEFAULT_CEILING_MM))
        wait_true(page, lambda: lux_4000 in shown(readout), "4000K readout settles")
        click(product_radio(page, "Finish", "Brushed Brass"))
        wait_text(page, status, status_of("Brushed Brass", 24, 4000, 940, KDL_BR_24_RETAIL))
        assert f"variant={KDL_BR_24_4000}" in page.url and marked(page)
        page.goto(base_of(app_url) + "/products/harbour-surface-cylinder")
        click(product_radio(page, "Finish", "Charcoal"))
        wait_true(page, lambda: product_radio(page, "Beam angle", "36°").is_disabled() and product_radio(page, "Colour temperature", "4000K").is_disabled(), "missing combinations disabled")
    with ui(browser, app_url, "/products/kauri-downlight", reduced_motion="reduce") as page:
        canvas = page.get_by_role("img", name=f"{PRODUCT_NAMES[0]} 3D model")
        wait_true(page, lambda: canvas.get_attribute("data-cct") == "3000", "loaded")
        advance(page, COUNT_FINAL_MS)
        before = decode(capture(canvas))
        click(product_radio(page, "Colour temperature", "2700K"))
        wait_true(page, lambda: canvas.get_attribute("data-cct") == "2700", "re-lit attribute")
        advance(page, COUNT_FINAL_MS)
        assert difference(before, decode(capture(canvas))) > 0, "the model did not re-light"


LAYOUT_IDS = ["1280x800", "768x1024", "375x812"]


@pytest.mark.parametrize("viewport", LAYOUT_IDS, ids=LAYOUT_IDS)
def test_spec_panel_layouts(browser, app_url, viewport):
    width, height = size_of(viewport)
    with ui(browser, app_url, "/products/kauri-downlight", size=(width, height)) as page:
        canvas = page.get_by_role("img", name=f"{PRODUCT_NAMES[0]} 3D model")
        spec = page.get_by_role("region", name="Specification")
        wait_count(page, spec, 1)
        c, s = canvas.bounding_box(), spec.bounding_box()
        if width == 1280:
            assert round(s["x"]) >= round(c["x"] + c["width"]) and s["y"] < c["y"] + c["height"]
            assert c["y"] < height and s["y"] < height
        else:
            assert round(s["y"]) >= round(c["y"] + c["height"])
        if width == 375:
            bar = page.get_by_role("region", name="Quick add")
            assert style(bar, "position")["position"] == "fixed"
            box = bar.bounding_box()
            assert round(box["y"] + box["height"]) <= height and box["y"] >= height / 2
            assert bar.get_by_role("button", name="Add to cart", exact=True).count() == 1
            assert page.get_by_role("button", name="Add to cart", exact=True).count() == 1
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            advance(page, POLL_MS)
            assert round(bar.bounding_box()["y"]) == round(box["y"])
        layout(page)


def test_fitting_viewer(browser, app_url):
    def yaw(canvas: Locator) -> int:
        return int(canvas.get_attribute("data-yaw"))

    def turned(a: int, b: int) -> int:
        delta = (b - a) % 360
        return min(delta, 360 - delta)

    with ui(browser, app_url, "/products/totara-track-spot") as page:
        canvas = page.get_by_role("img", name=f"{PRODUCT_NAMES[1]} 3D model")
        frames = scene_frames(canvas)
        assert all(f["draws"] > 0 for f in frames) and frames[-1]["uploaded"] > CUBE_VERTEX_BYTES
        assert not any(f["models"] for f in frames)
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) > 0
        assert canvas.get_attribute("data-idle") == "on"
        start = yaw(canvas)
        advance(page, IDLE_SAMPLE_MS)
        seconds = IDLE_SAMPLE_MS / 1000
        assert 360 * seconds / IDLE_TURN_MAX_S - 1 <= turned(start, yaw(canvas)) <= 360 * seconds / IDLE_TURN_MIN_S + 1
        box = canvas.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 4, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 3 / 4, box["y"] + box["height"] / 2, steps=8)
        page.mouse.up()
        advance(page, POLL_MS)
        released = yaw(canvas)
        advance(page, IDLE_RESUME_MS / 2)
        assert yaw(canvas) == released, "idle turning resumed before three seconds"
        advance(page, IDLE_RESUME_MS)
        assert yaw(canvas) != released, "idle turning never resumed"
    with ui(browser, app_url, "/products/totara-track-spot", reduced_motion="reduce") as page:
        canvas = page.get_by_role("img", name=f"{PRODUCT_NAMES[1]} 3D model")
        wait_true(page, lambda: canvas.get_attribute("data-idle") == "off", "idle off under reduced motion")
        still = yaw(canvas)
        advance(page, IDLE_SAMPLE_MS)
        assert yaw(canvas) == still
        before = decode(capture(canvas))
        box = canvas.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 4, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 3 / 4, box["y"] + box["height"] / 2, steps=8)
        page.mouse.up()
        advance(page, POLL_MS)
        assert abs(turned(still, yaw(canvas)) - 90) <= 1
        assert difference(before, decode(capture(canvas))) > 0, "the drag did not turn the model"


def test_spec_drawers(browser, app_url):
    for motion_mode in ("no-preference", "reduce"):
        with ui(browser, app_url, "/products/kauri-downlight", reduced_motion=motion_mode) as page:
            downloads = page.get_by_role("button", name="Downloads")
            wait_count(page, downloads, 1)
            assert page.get_by_role("button", name="Photometrics").get_attribute("aria-expanded") == "true"
            assert page.get_by_role("button", name="Dimensions").get_attribute("aria-expanded") == "false"
            assert downloads.get_attribute("aria-expanded") == "false"
            link = page.get_by_role("link", name="Spec sheet (PDF)")
            assert link.count() == 0 and "Spec sheet (PDF)" not in tab_order(page, TAB_SWEEP)
            downloads.focus()
            page.keyboard.press("Enter")
            if motion_mode == "reduce":
                assert link.count() == 1 and link.is_visible()
                assert animations(page.get_by_role("region", name="Specification")) == []
            else:
                wait_count(page, link, 1)
            assert downloads.get_attribute("aria-expanded") == "true"
            downloads.focus()
            page.keyboard.press("Space")
            wait_count(page, page.get_by_role("link", name="Spec sheet (PDF)"), 0)
            assert downloads.get_attribute("aria-expanded") == "false"
            click(page.get_by_role("button", name="Dimensions"))
            wait_true(page, lambda: page.get_by_role("button", name="Dimensions").get_attribute("aria-expanded") == "true", "Dimensions opens")


def test_spec_sheet_pdf(browser, app_url):
    code = "TTS-WH-15-2700"
    first = httpx.get(base_of(app_url) + f"/api/variants/{code}/spec-sheet", timeout=HTTP_TIMEOUT_S)
    assert first.status_code == 200 and first.headers["content-type"].startswith("application/pdf") and first.content.startswith(b"%PDF")
    text_now = pdf_text(first.content)
    assert code in text_now or "Tōtara Track Spot" in text_now
    key = f"spec-sheets/{code}.pdf"
    bucket = storage()
    assert key in bucket.keys("spec-sheets/") and bucket.get(key) == first.content
    assert httpx.get(base_of(app_url) + f"/api/variants/{code}/spec-sheet", timeout=HTTP_TIMEOUT_S).content == first.content
    assert httpx.get(base_of(app_url) + "/api/variants/ZZZ-ZZ-1-1/spec-sheet", timeout=HTTP_TIMEOUT_S).status_code == 404
    down = outage("APP_MINIO_DOWN_URL")
    reply = httpx.get(down + f"/api/variants/{code}/spec-sheet", timeout=HTTP_TIMEOUT_S)
    assert reply.status_code == 503 and reply.json() == {"error": "storage_unavailable"}
    with ui(browser, down, "/products/kauri-downlight") as page:
        link = page.get_by_role("link", name="Spec sheet (PDF)")
        click(page.get_by_role("button", name="Downloads"))
        wait_true(page, lambda: link.count() == 1 and link.is_visible(), "Downloads drawer opens")
        eventually(page, lambda: center(link))
        click(link)
        wait_text(page, page.get_by_role("status", name="Product updates"), "Spec sheet unavailable right now. Try again shortly.")


def test_wf_product_page_pick_and_add(browser, app_url):
    shopper = retail(app_url, "pick")
    with ui(browser, app_url, "/products/totara-track-spot", account=shopper) as page:
        click(product_radio(page, "Beam angle", "15°"))
        click(product_radio(page, "Colour temperature", "4000K"))
        wait_true(page, lambda: f"variant={TTS_PICK}" in page.url, "variant in URL")
        fill(page.get_by_role("region", name="Specification").get_by_role("spinbutton", name="Quantity"), "3")
        click(page.get_by_role("button", name="Add to cart", exact=True))
        wait_text(page, page.get_by_role("status", name="Product updates"), f"Added 3 to cart. Cart total {dollars(3 * TTS_15_RETAIL)} + GST.")
    lines = shopper.http.get("/api/cart").json()["order"]["lines"]
    assert [(l["variant_code"], l["quantity"], l["line_total_cents"]) for l in lines] == [(TTS_PICK, 3, 3 * TTS_15_RETAIL)]


def test_wf_product_page_spec_sheet(browser, app_url):
    with ui(browser, app_url, "/products/harbour-surface-cylinder") as page:
        click(product_radio(page, "Beam angle", "36°"))
        click(product_radio(page, "Colour temperature", "4000K"))
        wait_true(page, lambda: f"variant={HSC_PICK}" in page.url, "variant chosen")
        link = page.get_by_role("link", name="Spec sheet (PDF)")
        click(page.get_by_role("button", name="Downloads"))
        wait_true(page, lambda: link.count() == 1 and link.is_visible(), "Downloads drawer opens")
        eventually(page, lambda: center(link))
        with page.expect_download() as download:
            click(link)
        data = Path(download.value.path()).read_bytes()
    assert data.startswith(b"%PDF")
    assert storage().get(f"spec-sheets/{HSC_PICK}.pdf") == data


def test_projects_with_quantities(app_url):
    owner = approved_trade(app_url, "proj")
    made = create_project(owner, client_name="Probe Client", ceiling_height_mm=CEILING_MAX_MM, room_width_mm=ROOM_MAX_MM, room_depth_mm=ROOM_MIN_MM)
    assert set(made) == PROJECT_KEYS and made["is_owner"] is True and made["owner_id"] == owner.user["id"]
    assert (made["ceiling_height_mm"], made["room_width_mm"], made["room_depth_mm"], made["cover"], made["lines"], made["placements"]) == (CEILING_MAX_MM, ROOM_MAX_MM, ROOM_MIN_MM, None, [], [])
    plain = create_project(owner)
    assert (plain["ceiling_height_mm"], plain["room_width_mm"], plain["room_depth_mm"]) == (DEFAULT_CEILING_MM, DEFAULT_ROOM_WIDTH_MM, DEFAULT_ROOM_DEPTH_MM)
    for field, value in (("ceiling_height_mm", CEILING_MIN_MM - 1), ("ceiling_height_mm", CEILING_MAX_MM + 1), ("room_width_mm", ROOM_MIN_MM - 1), ("room_depth_mm", ROOM_MAX_MM + 1)):
        reply = owner.http.post("/api/projects", json={"name": "Out of range", field: value})
        assert reply.status_code == 422 and field in reply.json()["errors"]
    add_project_line(owner, made["id"], "KDL-BK-24-3000", 3)
    lines = add_project_line(owner, made["id"], "KDL-BK-24-3000", 2)["lines"]
    assert [(l["variant_code"], l["quantity"], l["placed"]) for l in lines] == [("KDL-BK-24-3000", 5, 0)]
    unknown = owner.http.post(f"/api/projects/{made['id']}/lines", json={"variant_code": "ZZZ-ZZ-1-1", "quantity": 1})
    assert unknown.status_code == 404 and unknown.json() == {"error": "unknown_variant"}
    listed = next(p for p in owner.http.get("/api/projects").json()["projects"] if p["id"] == made["id"])
    assert set(listed) == PROJECT_KEYS - {"placements"}
    for other in (retail(app_url).http, applicant(app_url).http):
        assert other.post("/api/projects", json={"name": "Nope"}).json() == {"error": "trade_account_required"}
        assert other.get("/api/projects").status_code == 403
    assert http(app_url).post("/api/projects", json={"name": "Nope"}).status_code == 401
    assert approved_trade(app_url, "outsider").http.get(f"/api/projects/{made['id']}").status_code == 404


def test_project_cover_image(app_url):
    owner = approved_trade(app_url, "cover")
    project_id = create_project(owner)["id"]
    bucket = storage()
    prefix = f"covers/{project_id}/"
    wrong = owner.http.post(f"/api/projects/{project_id}/cover", files={"image": ("notes.txt", b"plain words", "text/plain")})
    assert wrong.status_code == 422 and wrong.json()["errors"]["image"] == "unsupported_type"
    big = owner.http.post(f"/api/projects/{project_id}/cover", files={"image": ("big.png", png_bytes(COVER_LIMIT + 1), "image/png")})
    assert big.status_code == 413 and big.json() == {"error": "payload_too_large"}
    assert bucket.keys(prefix) == []
    image = png_bytes()
    reply = owner.http.post(f"/api/projects/{project_id}/cover", files={"image": ("cover.png", image, "image/png")})
    assert reply.status_code == 201 and reply.json()["cover"]["status"] == "ready"
    stored = [k for k in bucket.keys(prefix) if k.endswith(".png")]
    assert len(stored) == 1 and bucket.get(stored[0]) == image
    assert owner.http.get(f"/api/projects/{project_id}/cover").content == image
    assert project_of(owner, project_id)["cover"]["status"] == "ready"
    edge = owner.http.post(f"/api/projects/{project_id}/cover", files={"image": ("edge.png", png_bytes(COVER_LIMIT), "image/png")})
    assert edge.status_code == 201
    assert approved_trade(app_url, "coverspy").http.post(f"/api/projects/{project_id}/cover", files={"image": ("c.png", image, "image/png")}).status_code == 404
    down = outage("APP_MINIO_DOWN_URL")
    outage_owner = approved_trade(down, "coverdown")
    down_id = create_project(outage_owner)["id"]
    failed = outage_owner.http.post(f"/api/projects/{down_id}/cover", files={"image": ("cover.png", image, "image/png")})
    assert failed.status_code == 503 and failed.json() == {"error": "storage_unavailable"}
    assert project_of(outage_owner, down_id)["cover"] is None


def test_wf_projects_happy(browser, app_url):
    buyer = approved_trade(app_url, "specify")
    project_name = f"Kitchen {uuid.uuid4().hex[:6]}"
    with ui(browser, app_url, "/projects", account=buyer) as page:
        click(page.get_by_role("button", name="New project"))
        dialog = page.get_by_role("dialog", name="New project")
        fill(dialog.get_by_role("textbox", name="Project name"), project_name)
        fill(dialog.get_by_role("textbox", name="Client"), "Probe Client")
        fill(dialog.get_by_role("spinbutton", name="Ceiling height (mm)"), str(DEFAULT_CEILING_MM))
        click(dialog.get_by_role("button", name="Create project"))
        wait_text(page, page.get_by_role("status", name="Project updates"), "Project created.")
        page.goto(base_of(app_url) + "/products/kauri-downlight")
        mark(page)
        click(product_radio(page, "Finish", "Matte Black"))
        click(product_radio(page, "Beam angle", "24°"))
        click(product_radio(page, "Colour temperature", "2700K"))
        wait_text(page, page.get_by_role("status", name="Product updates"), variant_announcement(PRODUCT_NAMES[0], "Matte Black", 24, 2700, 860, KDL_24_TRADE))
        assert marked(page)
        click(page.get_by_role("region", name="Specification").get_by_role("button", name="Add to project"))
        dialog = page.get_by_role("dialog", name="Add to project")
        select(dialog.get_by_role("combobox", name="Project"), project_name)
        fill(dialog.get_by_role("spinbutton", name="Quantity"), "6")
        click(dialog.get_by_role("button", name="Add", exact=True))
        line_code = "KDL-BK-24-2700"
        wait_text(page, page.get_by_role("status", name="Project updates"), f"Added {6} × {line_code} to {project_name}.")
        project_id = next(p["id"] for p in buyer.http.get("/api/projects").json()["projects"] if p["name"] == project_name)
        page.goto(base_of(app_url) + f"/projects/{project_id}")
        slider = page.get_by_role("slider", name="Ceiling height")
        wait_count(page, slider, 1)
        slider.focus()
        for _ in range((3000 - DEFAULT_CEILING_MM) // SLIDER_STEP_MM):
            page.keyboard.press("ArrowRight")
        wait_true(page, lambda: slider.get_attribute("aria-valuetext") == "3.0 m", "slider reads 3.0 m")
    def saved() -> None:
        project = project_of(buyer, project_id)
        assert project["ceiling_height_mm"] == 3000 and [(l["variant_code"], l["quantity"]) for l in project["lines"]] == [("KDL-BK-24-2700", 6)]
    poll(saved)


def test_wf_projects_invalid_ceiling(browser, app_url):
    buyer = approved_trade(app_url, "ceiling")
    project_name = f"Loft {uuid.uuid4().hex[:6]}"
    with ui(browser, app_url, "/projects", account=buyer) as page:
        click(page.get_by_role("button", name="New project"))
        dialog = page.get_by_role("dialog", name="New project")
        fill(dialog.get_by_role("textbox", name="Project name"), project_name)
        fill(dialog.get_by_role("spinbutton", name="Ceiling height (mm)"), str(CEILING_MIN_MM - 1))
        click(dialog.get_by_role("button", name="Create project"))
        wait_true(page, lambda: "Ceiling height must be between 2400 and 4000 mm." in body_text(page), "ceiling error")
        assert not [p for p in buyer.http.get("/api/projects").json()["projects"] if p["name"] == project_name]
        fill(dialog.get_by_role("spinbutton", name="Ceiling height (mm)"), str(CEILING_MIN_MM))
        click(dialog.get_by_role("button", name="Create project"))
        wait_text(page, page.get_by_role("status", name="Project updates"), "Project created.")
    made = [p for p in buyer.http.get("/api/projects").json()["projects"] if p["name"] == project_name]
    assert len(made) == 1 and made[0]["ceiling_height_mm"] == CEILING_MIN_MM


def test_wf_projects_cover(browser, app_url):
    buyer = approved_trade(app_url, "coverui")
    project_id = create_project(buyer)["id"]
    with ui(browser, app_url, f"/projects/{project_id}", account=buyer) as page:
        status = page.get_by_role("status", name="Project updates")
        upload_cover(page, {"name": "notes.txt", "mimeType": "text/plain", "buffer": b"plain words"})
        wait_text(page, status, "Choose a JPEG, PNG or WebP image up to 5,000,000 bytes.")
        upload_cover(page, {"name": "cover.png", "mimeType": "image/png", "buffer": png_bytes()})
        wait_text(page, status, "Cover ready.")
        wait_count(page, page.get_by_role("img", name="Project cover"), 1)
    assert [k for k in storage().keys(f"covers/{project_id}/") if k.endswith(".png")]


def test_light_pool_geometry(app_url):
    owner = approved_trade(app_url, "geo")
    project_id = create_project(owner)["id"]
    add_project_line(owner, project_id, "KDL-BK-24-3000", 4)
    add_project_line(owner, project_id, "TTS-BK-15-3000", 1)
    spots = [("KDL-BK-24-3000", 1000, 1000), ("KDL-BK-24-3000", 1000 + EXAMPLE_PAIR_GAP_MM, 1000), ("KDL-BK-24-3000", 1000, 3000), ("KDL-BK-24-3000", 1574, 3000), ("TTS-BK-15-3000", 5000, 4000)]
    for code, x, y in spots:
        reply = place(owner, project_id, code, x, y)
        assert reply.status_code == 201, reply.text
        assert set(reply.json()["placement"]) == PLACEMENT_KEYS
    for ceiling in (DEFAULT_CEILING_MM, 3000):
        if ceiling != DEFAULT_CEILING_MM:
            assert owner.http.patch(f"/api/projects/{project_id}", json={"ceiling_height_mm": ceiling}).status_code == 200
        placements = project_of(owner, project_id)["placements"]
        for p in placements:
            spot = (p["variant_code"], p["x_mm"], p["y_mm"])
            assert (p["candela"], p["beam_deg"], p["cct_k"]) == (CANDELA[spot[0]], beam_of(spot[0]), int(spot[0].split("-")[3]))
            assert p["pool_diameter_mm"] == pool_mm(ceiling, beam_of(spot[0]))
            assert p["own_lux"] == own_lux(CANDELA[spot[0]], ceiling)
            assert p["centre_lux"] == centre_lux(spot, spots, ceiling), spot
        if ceiling == DEFAULT_CEILING_MM:
            pair = [p for p in placements if p["y_mm"] == 1000]
            assert all((p["pool_diameter_mm"], p["own_lux"], p["centre_lux"]) == (EXAMPLE_POOL_MM, EXAMPLE_OWN_LUX, EXAMPLE_PAIR_LUX) for p in pair)
            assert all(p["centre_lux"] == EXAMPLE_OWN_LUX for p in placements if p["y_mm"] == 3000)


def test_room_placements(app_url):
    owner = approved_trade(app_url, "room")
    project_id = create_project(owner)["id"]
    code = "TTS-BK-36-3000"
    add_project_line(owner, project_id, code, 2)
    for x, y, field in ((DEFAULT_ROOM_WIDTH_MM + 1, 0, "x_mm"), (0, -1, "y_mm"), (1.5, 0, "x_mm"), (0, DEFAULT_ROOM_DEPTH_MM + 1, "y_mm")):
        reply = place(owner, project_id, code, x, y)
        assert reply.status_code == 422 and field in reply.json()["errors"], reply.text
    first = place(owner, project_id, code, 0, 0).json()["placement"]
    second = place(owner, project_id, code, DEFAULT_ROOM_WIDTH_MM, DEFAULT_ROOM_DEPTH_MM).json()["placement"]
    assert (first["ordinal"], second["ordinal"]) == (1, 2)
    extra = place(owner, project_id, code, 100, 100)
    assert extra.status_code == 409 and extra.json() == {"error": "placement_exceeds_quantity"}
    lowered = owner.http.patch(f"/api/projects/{project_id}/lines/{code}", json={"quantity": 1})
    assert lowered.status_code == 409 and lowered.json() == {"error": "placement_exceeds_quantity"}
    shrink = owner.http.patch(f"/api/projects/{project_id}", json={"room_width_mm": DEFAULT_ROOM_WIDTH_MM - SLIDER_STEP_MM})
    assert shrink.status_code == 409 and shrink.json() == {"error": "placements_outside_room"}
    assert project_of(owner, project_id)["room_width_mm"] == DEFAULT_ROOM_WIDTH_MM
    moved = owner.http.patch(f"/api/projects/{project_id}/placements/{first['id']}", json={"x_mm": 1200, "y_mm": 800})
    assert moved.status_code == 200 and (moved.json()["placement"]["x_mm"], moved.json()["placement"]["y_mm"]) == (1200, 800)
    assert owner.http.patch(f"/api/projects/{project_id}/placements/{first['id']}", json={"x_mm": -1, "y_mm": 0}).status_code == 422
    assert owner.http.delete(f"/api/projects/{project_id}/placements/{first['id']}").status_code == 204
    assert owner.http.delete(f"/api/projects/{project_id}/placements/{first['id']}").status_code == 404
    third = place(owner, project_id, code, 300, 300).json()["placement"]
    assert third["ordinal"] == 3
    lines = project_of(owner, project_id)["lines"]
    assert [(l["variant_code"], l["quantity"], l["placed"]) for l in lines] == [(code, 2, 2)]
    outsider = approved_trade(app_url, "roomspy")
    assert outsider.http.get(f"/api/projects/{project_id}").status_code == 404
    assert place(outsider, project_id, code, 0, 0).status_code == 404


def test_pool_placement_sequence(browser, app_url):
    recorder = "(el) => { window.lightfallPhases = [[el.dataset.phase, performance.now()]]; new MutationObserver(() => window.lightfallPhases.push([el.dataset.phase, performance.now()])).observe(el, {attributes: true, attributeFilter: ['data-phase']}); }"
    for motion_mode in ("no-preference", "reduce"):
        owner = approved_trade(app_url, "phase")
        project_id = create_project(owner)["id"]
        add_project_line(owner, project_id, "KDL-BK-24-3000", 1)
        with ui(browser, app_url, f"/projects/{project_id}", account=owner, reduced_motion=motion_mode) as page:
            room = page.get_by_role("region", name="Light-pool room")
            wait_count(page, page.get_by_role("button", name=f"Place {KDL_BK_24}"), 1)
            room.evaluate(recorder)
            click(page.get_by_role("button", name=f"Place {KDL_BK_24}"))
            button = fitting_button(page, "KDL-BK-24-3000", 1, *CENTRE_DROP)
            if motion_mode == "reduce":
                wait_count(page, button, 1)
                advance(page, POLL_MS)
                log = page.evaluate("() => window.lightfallPhases")
                assert {p for p, _ in log[1:]} <= {"settled"} and room.get_attribute("data-phase") == "settled", log
                continue

            def complete() -> list[list[Any]]:
                log = page.evaluate("() => window.lightfallPhases")
                phases = [p for p, _ in log]
                assert "cone" in phases and "settled" in phases[phases.index("cone"):], phases
                return log

            log = eventually(page, complete, step=PHASE_STEP_MS)
            sequence: list[str] = []
            times: dict[str, float] = {}
            for phase, stamp in log:
                if not sequence or sequence[-1] != phase:
                    sequence.append(phase)
                    times.setdefault(phase, stamp)
            start = sequence.index("cone")
            assert sequence[start:start + len(PHASES)] == PHASES, sequence
            assert times["settled"] - times["cone"] <= SEQUENCE_MAX_MS


def test_keyboard_placement(browser, app_url):
    owner = approved_trade(app_url, "keyroom")
    project_id = create_project(owner)["id"]
    code = "TTS-BK-36-3000"
    add_project_line(owner, project_id, code, 2)
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as page:
        room = page.get_by_role("region", name="Light-pool room")
        status = page.get_by_role("status", name="Room updates")
        canvas = page.get_by_role("img", name="Room 3D view")
        wait_count(page, page.get_by_role("button", name=f"Place {code}"), 2)
        tab_to(page, f"Place {code}")
        page.keyboard.press("Enter")
        x, y = CENTRE_DROP
        wait_true(page, lambda: focused(fitting_button(page, code, 1, x, y)), "focus moves to the new fitting")
        wait_text(page, status, f"{code} placed at {x} mm, {y} mm. Pool {pool_mm(DEFAULT_CEILING_MM, 36)} mm, {own_lux(CANDELA[code], DEFAULT_CEILING_MM)} lux.")
        page.get_by_role("slider", name="Ceiling height").focus()
        rest, focus = state_styles(fitting_button(page, code, 1, x, y), "outline-style", "outline-width", "outline-color", "box-shadow", state="focus")
        assert rest != focus
        assert focused(fitting_button(page, code, 1, x, y))
        for key, dx, dy in (("ArrowRight", NUDGE_MM, 0), ("Shift+ArrowDown", 0, SHIFT_NUDGE_MM), ("ArrowUp", 0, -NUDGE_MM), ("ArrowLeft", -NUDGE_MM, 0)):
            page.keyboard.press(key)
            x, y = x + dx, y + dy
            wait_true(page, lambda: focused(fitting_button(page, code, 1, x, y)), f"{key} moved the fitting")
        wait_text(page, status, f"{code} moved to {x} mm, {y} mm.")
        for _ in range(7):
            page.keyboard.press("Shift+ArrowRight")
        x = DEFAULT_ROOM_WIDTH_MM
        wait_true(page, lambda: focused(fitting_button(page, code, 1, x, y)), "movement stops at the edge")
        poll(lambda: [(p["x_mm"], p["y_mm"]) for p in project_of(owner, project_id)["placements"]] == [(x, y)] or (_ for _ in ()).throw(AssertionError("not saved")))
        page.keyboard.press("Escape")
        assert focused(page.get_by_role("slider", name="Ceiling height"))
        fitting_button(page, code, 1, x, y).focus()
        page.keyboard.press("Delete")
        wait_text(page, status, f"{code} removed.")
        wait_true(page, lambda: focused(page.get_by_role("button", name=f"Place {code}")), "focus returns to Place")
        poll(lambda: project_of(owner, project_id)["placements"] == [] or (_ for _ in ()).throw(AssertionError("not removed")))
        page.keyboard.press("Enter")
        wait_count(page, fitting_button(page, code, 2, *CENTRE_DROP), 1)
        fitting_button(page, code, 2, *CENTRE_DROP).focus()
        left = False
        for _ in range(TRAP_PRESSES):
            page.keyboard.press("Tab")
            assert not focused(canvas), "the canvas took focus"
            if not holds_focus(room):
                left = True
                break
        assert left, "Tab never left the room"


def test_light_pools_table_mirrors(browser, app_url):
    owner = approved_trade(app_url, "table")
    project_id = create_project(owner)["id"]
    code = "KDL-BK-24-3000"
    add_project_line(owner, project_id, code, 2)
    assert place(owner, project_id, code, 1000, 1000).status_code == 201
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as page:
        wait_true(page, lambda: pool_rows(page) == [[1000, 1000, 24, EXAMPLE_POOL_MM, EXAMPLE_OWN_LUX]], "first row")
        click(page.get_by_role("button", name=f"Place {code}"))
        second = fitting_button(page, code, 2, *CENTRE_DROP)
        wait_true(page, lambda: focused(second), "second fitting focused")
        wait_true(page, lambda: [1000, 1000, 24, EXAMPLE_POOL_MM, EXAMPLE_OWN_LUX] in pool_rows(page) and [*CENTRE_DROP, 24, EXAMPLE_POOL_MM, EXAMPLE_OWN_LUX] in pool_rows(page), "two rows")
        for key in ["Shift+ArrowLeft"] * 3 + ["Shift+ArrowUp"] * 2 + ["ArrowUp"] * 3:
            page.keyboard.press(key)
        wait_true(page, lambda: pool_rows(page) == [[1000, 1000, 24, EXAMPLE_POOL_MM, EXAMPLE_PAIR_LUX], [1500, 1000, 24, EXAMPLE_POOL_MM, EXAMPLE_PAIR_LUX]], "summed lux")
        poll(lambda: sorted(p["centre_lux"] for p in project_of(owner, project_id)["placements"]) == [EXAMPLE_PAIR_LUX] * 2 or (_ for _ in ()).throw(AssertionError("server disagrees")))
        page.keyboard.press("Escape")
        for _ in range((3000 - DEFAULT_CEILING_MM) // SLIDER_STEP_MM):
            page.keyboard.press("ArrowRight")
        spots = [(code, 1000, 1000), (code, 1500, 1000)]
        lux = centre_lux(spots[0], spots, 3000)
        wait_true(page, lambda: pool_rows(page) == [[1000, 1000, 24, pool_mm(3000, 24), lux], [1500, 1000, 24, pool_mm(3000, 24), lux]], "rows follow the ceiling")
    def server() -> None:
        project = project_of(owner, project_id)
        assert project["ceiling_height_mm"] == 3000
        assert sorted((p["pool_diameter_mm"], p["centre_lux"]) for p in project["placements"]) == [(pool_mm(3000, 24), lux)] * 2
    poll(server)


def test_wf_light_pool_room_happy(browser, app_url):
    owner = approved_trade(app_url, "roomjourney")
    project_id = create_project(owner)["id"]
    code = "KDL-BK-24-3000"
    add_project_line(owner, project_id, code, 3)
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as page:
        wait_count(page, page.get_by_role("button", name=f"Place {code}"), 3)
        for ordinal in (1, 2, 3):
            click(page.get_by_role("button", name=f"Place {code}").first)
            wait_count(page, fitting_button(page, code, ordinal, *CENTRE_DROP), 1)
        fitting_button(page, code, 1, *CENTRE_DROP).focus()
        page.keyboard.press("Shift+ArrowLeft")
        page.keyboard.press("Shift+ArrowLeft")
        fitting_button(page, code, 3, *CENTRE_DROP).focus()
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Shift+ArrowRight")
        fitting_button(page, code, 2, *CENTRE_DROP).focus()
        page.keyboard.press("Delete")
        expected = [[2000, CENTRE_DROP[1], 24, EXAMPLE_POOL_MM, EXAMPLE_OWN_LUX], [4000, CENTRE_DROP[1], 24, EXAMPLE_POOL_MM, EXAMPLE_OWN_LUX]]
        wait_true(page, lambda: pool_rows(page) == expected, "table after edits")
        poll(lambda: sorted((p["ordinal"], p["x_mm"]) for p in project_of(owner, project_id)["placements"]) == [(1, 2000), (3, 4000)] or (_ for _ in ()).throw(AssertionError("not saved")))
        page.reload()
        wait_count(page, fitting_button(page, code, 1, 2000, CENTRE_DROP[1]), 1)
        wait_count(page, fitting_button(page, code, 3, 4000, CENTRE_DROP[1]), 1)
        assert pool_rows(page) == expected


def test_wf_light_pool_room_no_webgl(browser, app_url):
    owner = approved_trade(app_url, "plan")
    project_id = create_project(owner)["id"]
    add_project_line(owner, project_id, "TTS-BK-36-3000", 1)
    with ui(browser, app_url, f"/projects/{project_id}", account=owner, no_webgl=True) as page:
        wait_count(page, page.get_by_role("img", name="Room plan"), 1)
        assert page.get_by_role("img", name="Room 3D view").count() == 0
        page.get_by_role("button", name=f"Place {TTS_BK_36}").focus()
        page.keyboard.press("Enter")
        wait_count(page, fitting_button(page, "TTS-BK-36-3000", 1, *CENTRE_DROP), 1)
        wait_true(page, lambda: len(pool_rows(page)) == 1, "table row")
    assert [(p["x_mm"], p["y_mm"]) for p in project_of(owner, project_id)["placements"]] == [CENTRE_DROP]


def test_wf_light_pool_room_full_quantity(browser, app_url):
    owner = approved_trade(app_url, "full")
    project_id = create_project(owner)["id"]
    code = "TTS-BK-36-3000"
    add_project_line(owner, project_id, code, 1)
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as page:
        click(page.get_by_role("button", name=f"Place {code}"))
        wait_count(page, fitting_button(page, code, 1, *CENTRE_DROP), 1)
        wait_count(page, page.get_by_role("list", name="Unplaced fittings").get_by_role("button", name=f"Place {code}"), 0)
    assert place(owner, project_id, code, 0, 0).json() == {"error": "placement_exceeds_quantity"}
    assert owner.http.patch(f"/api/projects/{project_id}/lines/{code}", json={"quantity": 0}).json() == {"error": "placement_exceeds_quantity"}
    assert len(project_of(owner, project_id)["placements"]) == 1


def test_project_collaborators(app_url):
    owner, collab = approved_trade(app_url, "owner"), approved_trade(app_url, "collab")
    project_id = create_project(owner)["id"]
    add_project_line(owner, project_id, "KDL-BK-24-3000", 2)
    assert collab.http.get(f"/api/projects/{project_id}").status_code == 404
    for refused in (retail(app_url).email, applicant(app_url).email):
        reply = invite(owner, project_id, refused)
        assert reply.status_code == 422 and reply.json()["errors"]["email"] == "not_a_trade_account"
    added = invite(owner, project_id, collab.email)
    assert added.status_code == 201 and added.json()["collaborator"] == {"user_id": collab.user["id"], "name": collab.name, "email": collab.email}
    seen = project_of(collab, project_id)
    assert seen["is_owner"] is False and collab.user["id"] in [c["user_id"] for c in seen["collaborators"]]
    assert place(collab, project_id, "KDL-BK-24-3000", 500, 500).status_code == 201
    assert collab.http.post(f"/api/projects/{project_id}/comments", json={"body": "From the collaborator"}).status_code == 201
    third = approved_trade(app_url, "third")
    assert invite(collab, project_id, third.email).json() == {"error": "owner_only"}
    assert collab.http.post(f"/api/projects/{project_id}/shares", json={"recipients": [third.email], "price_display": "none"}).json() == {"error": "owner_only"}
    assert third.http.get(f"/api/projects/{project_id}").status_code == 404
    assert third.http.post(f"/api/projects/{project_id}/comments", json={"body": "x"}).status_code == 404
    assert owner.http.delete(f"/api/projects/{project_id}/collaborators/{collab.user['id']}").status_code == 204
    assert collab.http.get(f"/api/projects/{project_id}").status_code == 404


def test_live_presence_and_comments(browser, app_url):
    owner, collab = approved_trade(app_url, "liveown"), approved_trade(app_url, "livecol")
    project_id = create_project(owner)["id"]
    assert invite(owner, project_id, collab.email).status_code == 201
    body = f"Check the pool by the bench {uuid.uuid4().hex[:6]}"
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as mine:
        wait_count(mine, mine.get_by_role("list", name="Viewing now"), 1)
        with ui(browser, app_url, f"/projects/{project_id}", account=collab) as theirs:
            wait_count(mine, mine.get_by_role("list", name="Viewing now").get_by_role("img", name=collab.name, exact=True), 1, PRESENCE_JOIN_S)
            wait_count(theirs, theirs.get_by_role("list", name="Viewing now").get_by_role("img", name=owner.name, exact=True), 1, PRESENCE_JOIN_S)
            box = theirs.get_by_role("region", name="Comments").get_by_role("textbox", name="Add a comment")
            fill(box, body)
            box.focus()
            theirs.keyboard.press("Enter")
            assert "\n" in box.input_value()
            fill(box, body)
            click(theirs.get_by_role("button", name="Post comment"))
            wait_text(theirs, theirs.get_by_role("status", name="Project updates"), "Comment posted.")
            wait_true(mine, lambda: body in shown(mine.get_by_role("list", name="Comment thread")), "comment reached the owner", LIVE_SYNC_S)
            fill(box, "x" * (COMMENT_MAX + 1))
            click(theirs.get_by_role("button", name="Post comment"))
            wait_text(theirs, theirs.get_by_role("status", name="Project updates"), "Comments can be up to 2,000 characters.")
            poll(lambda: any(str(r.get("project_id")) == str(project_id) for r in pocketbase().records("lf_presence")) or (_ for _ in ()).throw(AssertionError("no presence record while both view")))
        wait_count(mine, mine.get_by_role("list", name="Viewing now").get_by_role("img", name=collab.name, exact=True), 0, PRESENCE_LEAVE_S)
    comments = owner.http.get(f"/api/projects/{project_id}/comments").json()["comments"]
    assert [(c["author_name"], c["body"]) for c in comments] == [(collab.name, body)]
    assert any(r.get("body") == body for r in pocketbase().records("lf_comments") if str(r.get("project_id")) == str(project_id))


def test_live_placement_sync(browser, app_url):
    owner, collab = approved_trade(app_url, "syncown"), approved_trade(app_url, "synccol")
    project_id = create_project(owner)["id"]
    code = "KDL-BK-24-3000"
    add_project_line(owner, project_id, code, 1)
    assert invite(owner, project_id, collab.email).status_code == 201
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as page:
        wait_count(page, page.get_by_role("button", name=f"Place {code}"), 1)
        made = place(collab, project_id, code, 1000, 1000).json()["placement"]
        wait_count(page, fitting_button(page, code, 1, 1000, 1000), 1, LIVE_SYNC_S)
        assert collab.http.patch(f"/api/projects/{project_id}/placements/{made['id']}", json={"x_mm": 1200, "y_mm": 1000}).status_code == 200
        wait_count(page, fitting_button(page, code, 1, 1200, 1000), 1, LIVE_SYNC_S)
        wait_true(page, lambda: pool_rows(page) == [[1200, 1000, 24, EXAMPLE_POOL_MM, EXAMPLE_OWN_LUX]], "table follows", LIVE_SYNC_S)
        assert collab.http.delete(f"/api/projects/{project_id}/placements/{made['id']}").status_code == 204
        wait_count(page, fitting_button(page, code, 1, 1200, 1000), 0, LIVE_SYNC_S)
    synced = [r for r in pocketbase().records("lf_placements") if str(r.get("project_id")) == str(project_id)]
    assert len(synced) >= 3 and {str(r.get("placement_id")) for r in synced} == {str(made["id"])}


def test_collaboration_outage(app_url):
    base = outage("APP_POCKETBASE_DOWN_URL")
    owner = approved_trade(base, "pbdown")
    project_id = create_project(owner)["id"]
    add_project_line(owner, project_id, "KDL-BK-24-3000", 1)
    reply = place(owner, project_id, "KDL-BK-24-3000", 1000, 1000)
    assert reply.status_code == 201 and reply.json()["live"] is False
    project = project_of(owner, project_id)
    assert project["live"] is False and len(project["placements"]) == 1
    assert owner.http.post(f"/api/projects/{project_id}/comments", json={"body": "hello"}).json() == {"error": "collaboration_unavailable"}
    assert owner.http.get(f"/api/projects/{project_id}/comments").status_code == 503


def test_collaboration_recovery(browser):
    relay = Relay(service_env("POCKETBASE_URL"))
    try:
        with app_copy(POCKETBASE_URL=relay.url) as base:
            owner = approved_trade(base, "pbback")
            project_id = create_project(owner)["id"]
            add_project_line(owner, project_id, "KDL-BK-24-3000", 2)
            assert place(owner, project_id, "KDL-BK-24-3000", 1000, 1000).json()["live"] is False
            with ui(browser, base, f"/projects/{project_id}", account=owner) as page:
                live = page.get_by_role("status", name="Live collaboration")
                wait_text(page, live, "Live collaboration paused. Your changes are saved and will sync when it reconnects.")
                relay.up()
                body = f"Back online {uuid.uuid4().hex[:6]}"
                poll(lambda: owner.http.post(f"/api/projects/{project_id}/comments", json={"body": body}).status_code == 201 or (_ for _ in ()).throw(AssertionError("comments still refused")), PB_RESUME_S)
                wait_text(page, live, "Live collaboration is back.", PB_RESUME_S)
            assert place(owner, project_id, "KDL-BK-24-3000", 2000, 1000).json()["live"] is True
            assert any(r.get("body") == body for r in pocketbase().records("lf_comments"))
    finally:
        relay.stop()


def test_wf_collaboration_happy(browser, app_url):
    owner, collab = approved_trade(app_url, "wfown"), approved_trade(app_url, "wfcol")
    project_id = create_project(owner)["id"]
    body = f"Lower the pendant {uuid.uuid4().hex[:6]}"
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as mine:
        fill(mine.get_by_role("textbox", name="Collaborator email"), collab.email)
        click(mine.get_by_role("button", name="Invite"))
        wait_text(mine, mine.get_by_role("status", name="Project updates"), f"{collab.name} can now work on this project.")
        assert collab.user["id"] in [c["user_id"] for c in project_of(owner, project_id)["collaborators"]]
        with ui(browser, app_url, f"/projects/{project_id}", account=collab) as theirs:
            wait_count(mine, mine.get_by_role("list", name="Viewing now").get_by_role("img", name=collab.name, exact=True), 1, PRESENCE_JOIN_S)
            fill(mine.get_by_role("textbox", name="Add a comment"), body)
            click(mine.get_by_role("button", name="Post comment"))
            wait_true(theirs, lambda: body in shown(theirs.get_by_role("list", name="Comment thread")), "comment reached the collaborator", LIVE_SYNC_S)
    assert any(r.get("body") == body for r in pocketbase().records("lf_comments") if str(r.get("project_id")) == str(project_id))


def test_wf_collaboration_outage(browser):
    base = outage("APP_POCKETBASE_DOWN_URL")
    owner = approved_trade(base, "pbui")
    project_id = create_project(owner)["id"]
    add_project_line(owner, project_id, "TTS-BK-36-3000", 1)
    with ui(browser, base, f"/projects/{project_id}", account=owner) as page:
        wait_text(page, page.get_by_role("status", name="Live collaboration"), "Live collaboration paused. Your changes are saved and will sync when it reconnects.")
        fill(page.get_by_role("textbox", name="Add a comment"), "Anyone there?")
        click(page.get_by_role("button", name="Post comment"))
        wait_text(page, page.get_by_role("status", name="Project updates"), "Comments are unavailable while live collaboration is paused.")
        click(page.get_by_role("button", name=f"Place {TTS_BK_36}"))
        wait_count(page, fitting_button(page, TTS_BK_36, 1, *CENTRE_DROP), 1)
    poll(lambda: len(project_of(owner, project_id)["placements"]) == 1 or (_ for _ in ()).throw(AssertionError("not saved")))


def test_wf_collaboration_invite_refused(browser, app_url):
    owner = approved_trade(app_url, "refuse")
    project_id = create_project(owner)["id"]
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as page:
        fill(page.get_by_role("textbox", name="Collaborator email"), retail(app_url).email)
        click(page.get_by_role("button", name="Invite"))
        wait_text(page, page.get_by_role("status", name="Project updates"), "That email is not an approved trade account.")
    assert project_of(owner, project_id)["collaborators"] == []


def share_quote(owner: Account, project_id: Any, recipients: list[str], display: str, message: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"recipients": recipients, "price_display": display}
    if message is not None:
        body["message"] = message
    return owner.http.post(f"/api/projects/{project_id}/shares", json=body)


def share_status(owner: Account, project_id: Any, share_id: Any) -> str:
    return next(s for s in owner.http.get(f"/api/projects/{project_id}/shares").json()["shares"] if s["id"] == share_id)["pdf_status"]


def test_quote_shares_by_email(app_url, mail):
    owner = approved_trade(app_url, "sharer")
    project = create_project(owner)
    add_project_line(owner, project["id"], "PHP-BZ-60-2700", 1)
    recipients = [fresh("client")[1] for _ in range(2)]
    message = f"Revised layout {uuid.uuid4().hex[:6]}"
    rejected = [fresh("nobody")[1] for _ in range(MAX_RECIPIENTS + 1)]
    for bad in ({"recipients": rejected, "price_display": "trade"}, {"recipients": [], "price_display": "trade"}, {"recipients": ["not-an-email"], "price_display": "trade"}, {"recipients": recipients[:1], "price_display": "trade", "message": "x" * (MESSAGE_MAX + 1)}):
        assert owner.http.post(f"/api/projects/{project['id']}/shares", json=bad).status_code == 422
    created = time.monotonic()
    reply = share_quote(owner, project["id"], recipients, "trade", message)
    assert reply.status_code == 201, reply.text
    share = reply.json()["share"]
    assert share["pdf_status"] == "pending" and share["price_display"] == "trade" and sorted(share["recipients"]) == sorted(recipients)
    poll(lambda: share_status(owner, project["id"], share["id"]) == "ready" or (_ for _ in ()).throw(AssertionError("not ready")), PDF_READY_S)
    assert time.monotonic() - created <= PDF_READY_S + HTTP_TIMEOUT_S
    key = f"quotes/{project['id']}/{share['id']}.pdf"
    stored = storage().get(key)
    pdf = owner.http.get(f"/api/shares/{share['id']}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf") and pdf.content == stored
    for recipient in recipients:
        messages = inbox(mail, recipient)
        assert len(messages) == 1
        assert f"{owner.name} shared a Lightfall quote: {project['name']}" in serial(messages[0])
        assert f"lightfall-quote-{share['id']}.pdf" in serial(messages[0]) and message in mail_body(messages[0])
    assert inbox(mail, rejected[0], seconds=NO_MAIL_WAIT_S) == []


def test_price_display_in_shared_copies(app_url, mail):
    owner = approved_trade(app_url, "display")
    project = create_project(owner)
    add_project_line(owner, project["id"], "PHP-BZ-60-2700", 1)
    trade_figures = [money(PHP_BZ_TRADE), money(PHP_BZ_GST), money(PHP_BZ_TOTAL)]
    retail_figures = [money(PHP_BZ_RETAIL), money(gst(PHP_BZ_RETAIL)), money(PHP_BZ_RETAIL + gst(PHP_BZ_RETAIL))]
    copies: dict[str, tuple[str, str]] = {}
    for display in ("trade", "retail", "none"):
        recipient = fresh(f"view{display}")[1]
        share = share_quote(owner, project["id"], [recipient], display).json()["share"]
        poll(lambda: share_status(owner, project["id"], share["id"]) == "ready" or (_ for _ in ()).throw(AssertionError("not ready")), PDF_READY_S)
        messages = inbox(mail, recipient)
        assert len(messages) == 1
        copies[display] = (mail_body(messages[0]), pdf_text(owner.http.get(f"/api/shares/{share['id']}/pdf").content))
    for email_text, pdf in (copies["trade"],):
        assert all(f in email_text for f in trade_figures) and money(PHP_BZ_TOTAL) in pdf, "trade copy lacks trade figures"
    for copy in copies["retail"]:
        assert money(PHP_BZ_RETAIL + gst(PHP_BZ_RETAIL)) in copy
        assert not any(f in copy for f in trade_figures)
    for copy in copies["none"]:
        assert "$" not in copy and "GST" not in copy and "PHP-BZ-60-2700" in copy
        assert not any(f in copy for f in trade_figures + retail_figures)


def test_quote_pdf_waits_for_storage(browser, mail):
    base = outage("APP_MINIO_DOWN_URL")
    owner = approved_trade(base, "s3wait")
    project_id = create_project(owner)["id"]
    add_project_line(owner, project_id, "KDL-BK-24-3000", 1)
    recipient = fresh("waiting")[1]
    share = share_quote(owner, project_id, [recipient], "none").json()["share"]
    poll(lambda: share_status(owner, project_id, share["id"]) == "waiting_for_storage" or (_ for _ in ()).throw(AssertionError("not waiting")), UNREACHABLE_S + STORAGE_RETRY_S)
    assert owner.http.get(f"/api/shares/{share['id']}/pdf").json() == {"error": "pdf_not_ready"}
    with ui(browser, base, f"/projects/{project_id}", account=owner) as page:
        wait_true(page, lambda: "Waiting for file storage" in shown(page.get_by_role("table", name="Quote shares")), "share shows waiting")
    assert inbox(mail, recipient, seconds=STORAGE_RETRY_S * 2) == []
    assert share_status(owner, project_id, share["id"]) == "waiting_for_storage"
    assert f"quotes/{project_id}/{share['id']}.pdf" not in storage().keys(f"quotes/{project_id}/")


def test_quote_pdf_recovers(mail):
    relay = Relay(service_env("S3_ENDPOINT"))
    try:
        with app_copy(S3_ENDPOINT=relay.url, DATABASE_URL=service_env("DATABASE_URL") + "_minio_down") as base:
            owner = approved_trade(base, "s3back")
            project_id = create_project(owner)["id"]
            add_project_line(owner, project_id, "KDL-BK-24-3000", 1)
            recipient = fresh("recovered")[1]
            share = share_quote(owner, project_id, [recipient], "trade").json()["share"]
            poll(lambda: share_status(owner, project_id, share["id"]) == "waiting_for_storage" or (_ for _ in ()).throw(AssertionError("not waiting")), UNREACHABLE_S + STORAGE_RETRY_S)
            assert inbox(mail, recipient, seconds=NO_MAIL_WAIT_S) == []
            relay.up()
            poll(lambda: share_status(owner, project_id, share["id"]) == "ready" or (_ for _ in ()).throw(AssertionError("never finished")), STORAGE_RETRY_S + PDF_READY_S + UNREACHABLE_S)
            assert storage().get(f"quotes/{project_id}/{share['id']}.pdf").startswith(b"%PDF")
            assert len(inbox(mail, recipient)) == 1
    finally:
        relay.stop()


def test_wf_quote_share_happy(browser, app_url, mail):
    owner = approved_trade(app_url, "journey6")
    project_id = create_project(owner)["id"]
    add_project_line(owner, project_id, "PHP-BZ-60-2700", 1)
    clients = [fresh("client")[1] for _ in range(2)]
    wholesaler = fresh("wholesale")[1]
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as page:
        for recipients, display, count in ((clients, "No prices", 2), ([wholesaler], "Trade prices", 1)):
            click(page.get_by_role("button", name="Share quote"))
            dialog = page.get_by_role("dialog", name="Share quote")
            fill(dialog.get_by_role("textbox", name="Recipients"), ", ".join(recipients))
            click(dialog.get_by_role("radiogroup", name="Price display").get_by_role("radio", name=display))
            fill(dialog.get_by_role("textbox", name="Message"), "Quote attached")
            click(dialog.get_by_role("button", name="Send quote"))
            wait_text(page, page.get_by_role("status", name="Project updates"), f"Quote queued for {count} recipients. Emails go out as soon as the PDF is ready.")
        table = page.get_by_role("table", name="Quote shares")
        wait_true(page, lambda: shown(table).count("Ready") == 2, "both shares Ready", PDF_READY_S + UI_WAIT_S)
    shares = owner.http.get(f"/api/projects/{project_id}/shares").json()["shares"]
    assert sorted(s["price_display"] for s in shares) == ["none", "trade"] and all(s["pdf_status"] == "ready" for s in shares)
    for client in clients:
        messages = inbox(mail, client)
        assert len(messages) == 1 and "$" not in mail_body(messages[0])
    trade_mail = inbox(mail, wholesaler)
    assert len(trade_mail) == 1
    assert all(dollars(f) in mail_body(trade_mail[0]) for f in (PHP_BZ_TRADE, PHP_BZ_GST, PHP_BZ_TOTAL))


def test_wf_quote_share_invalid_recipients(browser, app_url, mail):
    owner = approved_trade(app_url, "toomany")
    project_id = create_project(owner)["id"]
    recipients = [fresh("crowd")[1] for _ in range(MAX_RECIPIENTS + 1)]
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as page:
        click(page.get_by_role("button", name="Share quote"))
        dialog = page.get_by_role("dialog", name="Share quote")
        fill(dialog.get_by_role("textbox", name="Recipients"), ", ".join(recipients))
        click(dialog.get_by_role("radiogroup", name="Price display").get_by_role("radio", name="No prices"))
        click(dialog.get_by_role("button", name="Send quote"))
        wait_text(page, page.get_by_role("status", name="Project updates"), "Add between 1 and 10 valid email addresses.")
    assert owner.http.get(f"/api/projects/{project_id}/shares").json()["shares"] == []
    assert inbox(mail, recipients[0], seconds=NO_MAIL_WAIT_S) == []


def test_wf_quote_share_storage_outage(browser, mail):
    base = outage("APP_MINIO_DOWN_URL")
    owner = approved_trade(base, "s3ui")
    project_id = create_project(owner)["id"]
    add_project_line(owner, project_id, "KDL-BK-24-3000", 1)
    recipient = fresh("stalled")[1]
    with ui(browser, base, f"/projects/{project_id}", account=owner) as page:
        click(page.get_by_role("button", name="Share quote"))
        dialog = page.get_by_role("dialog", name="Share quote")
        fill(dialog.get_by_role("textbox", name="Recipients"), recipient)
        click(dialog.get_by_role("radiogroup", name="Price display").get_by_role("radio", name="Retail prices"))
        click(dialog.get_by_role("button", name="Send quote"))
        wait_true(page, lambda: "Waiting for file storage" in shown(page.get_by_role("table", name="Quote shares")), "waiting shown", UNREACHABLE_S + STORAGE_RETRY_S + UI_WAIT_S)
    assert [s["pdf_status"] for s in owner.http.get(f"/api/projects/{project_id}/shares").json()["shares"]] == ["waiting_for_storage"]
    assert inbox(mail, recipient, seconds=NO_MAIL_WAIT_S) == []


def test_dispatch_captures_card_payment(app_url, killbill):
    buyer, order = card_order(app_url)
    key = order["order_key"]
    for client in (buyer.http, approved_trade(app_url, "nodispatch").http):
        assert client.post(f"/api/admin/orders/{key}/dispatch").json() == {"error": "forbidden"}
    assert transactions(killbill.payment_by_key(key), "CAPTURE") == []
    assert order_of(buyer, key)["status"] == "authorised"
    with ThreadPoolExecutor(2) as pool:
        replies = list(pool.map(lambda _: dispatch(app_url, key), range(2)))
    assert 200 in [r.status_code for r in replies] and all(r.status_code in (200, 409) for r in replies)
    done = order_of(buyer, key)
    assert (done["status"], done["display_status"], done["captured_cents"]) == ("captured", "Paid", order["total_cents"])
    captures = transactions(killbill.payment_by_key(key), "CAPTURE")
    assert len(captures) == 1 and f"{key}-capture" in captures[0].values() and amount_in(captures[0], order["total_cents"])
    again = dispatch(app_url, key)
    assert again.status_code == 409 and again.json() == {"error": "invalid_state", "status": "captured"}
    open_cart = add_line(retail(app_url, "notpaid"), KDL_DEFAULT, 1)
    assert dispatch(app_url, open_cart["order_key"]).json() == {"error": "invalid_state", "status": "cart"}
    assert len(transactions(killbill.payment_by_key(key), "CAPTURE")) == 1


def test_paid_only_after_capture(browser, killbill):
    relay = Relay(service_env("KILLBILL_URL"))
    relay.up()
    try:
        with app_copy(KILLBILL_URL=relay.url) as base:
            buyer, order = card_order(base)
            key = order["order_key"]
            relay.down()
            with ui(browser, base, "/admin", account=admin_account(base)) as page:
                click(page.get_by_role("tab", name="Orders"))
                row = admin_row(page, "Orders", key)
                wait_true(page, lambda: "Authorised" in shown(row), "row Authorised")
                status = page.get_by_role("status", name="Admin updates")
                click(page.get_by_role("button", name=f"Dispatch {key}"))
                wait_text(page, status, f"Kill Bill is unavailable. Order {key} is unchanged; try again shortly.", UNREACHABLE_S + UI_WAIT_S)
                assert "Authorised" in shown(row) and "Paid" not in shown(row)
                assert order_of(buyer, key)["status"] == "authorised"
                assert transactions(killbill.payment_by_key(key), "CAPTURE") == []
                relay.up()
                click(page.get_by_role("button", name=f"Dispatch {key}"))
                wait_text(page, status, f"Payment captured. Order {key} is Paid.")
                wait_true(page, lambda: "Paid" in shown(row), "row Paid")
            assert len(transactions(killbill.payment_by_key(key), "CAPTURE")) == 1
    finally:
        relay.stop()


def refund(base: str, order_key: str, amount: int, key: str | None = None, reason: str = "Probe refund") -> httpx.Response:
    return admin_http(base).post(f"/api/admin/orders/{order_key}/refunds", json={"amount_cents": amount, "reason": reason}, headers={"Idempotency-Key": key or idempotency_key()})


def test_partial_refunds(app_url, killbill):
    buyer, order = captured_order(app_url)
    key, total = order["order_key"], order["total_cents"]
    assert admin_http(app_url).post(f"/api/admin/orders/{key}/refunds", json={"amount_cents": 1, "reason": "x"}).json() == {"error": "idempotency_key_required"}
    request_key = idempotency_key()
    first = refund(app_url, key, 5000, request_key)
    assert first.status_code == 201, first.text
    assert (first.json()["order"]["status"], first.json()["order"]["display_status"], first.json()["order"]["refunded_cents"]) == ("partially_refunded", "Partly refunded", 5000)
    replay = refund(app_url, key, 5000, request_key)
    assert replay.status_code == 201 and replay.json()["refund"]["id"] == first.json()["refund"]["id"]
    assert refund(app_url, key, 4000, request_key).json() == {"error": "idempotency_conflict"}
    over = refund(app_url, key, total - 5000 + 1)
    assert over.status_code == 422 and over.json()["errors"]["amount_cents"] == "exceeds_refundable"
    refunds = transactions(killbill.payment_by_key(key), "REFUND")
    assert len(refunds) == 1 and f"{key}-refund-1" in refunds[0].values() and amount_in(refunds[0], 5000)
    rest = refund(app_url, key, total - 5000)
    assert rest.status_code == 201 and (rest.json()["order"]["status"], rest.json()["order"]["display_status"]) == ("refunded", "Refunded")
    refunds = transactions(killbill.payment_by_key(key), "REFUND")
    assert len(refunds) == 2 and any(f"{key}-refund-2" in r.values() and amount_in(r, total - 5000) for r in refunds)
    assert refund(app_url, key, 1).json() == {"error": "invalid_state", "status": "refunded"}
    _, authorised = card_order(app_url)
    assert refund(app_url, authorised["order_key"], 1).json() == {"error": "invalid_state", "status": "authorised"}
    racer, raced = captured_order(app_url)
    with ThreadPoolExecutor(2) as pool:
        codes = sorted(r.status_code for r in pool.map(lambda _: refund(app_url, raced["order_key"], 6000), range(2)))
    assert codes == [201, 422]
    assert order_of(racer, raced["order_key"])["refunded_cents"] == 6000
    assert len(transactions(killbill.payment_by_key(raced["order_key"]), "REFUND")) == 1


ADMIN_CALLS = [("POST", "/api/admin/orders/{key}/dispatch", None), ("POST", "/api/admin/orders/{key}/refunds", {"amount_cents": 1, "reason": "x"}), ("POST", "/api/admin/orders/{key}/record-payment", {"amount_cents": 1}), ("PATCH", f"/api/admin/variants/{RGD}", {"stock_adjust": -1, "note": "x"}), ("GET", "/api/admin/health", None), ("GET", "/api/admin/stock", None), ("GET", "/api/admin/orders", None)]


def test_admin_only_money_actions(app_url, killbill):
    buyer, order = card_order(app_url)
    stock_before = variant_of(app_url, "rimu-gimbal-downlight", RGD)["stock_on_hand"]
    callers = [(buyer.http, {"error": "forbidden"}), (approved_trade(app_url, "notadmin").http, {"error": "forbidden"}), (http(app_url), {"error": "unauthenticated"})]
    for client, expected in callers:
        for method, path, body in ADMIN_CALLS:
            for order_key in (order["order_key"], "LF-ZZZZZZZZ"):
                reply = client.request(method, path.format(key=order_key), json=body)
                assert reply.json() == expected, (method, path, reply.status_code)
    assert order_of(buyer, order["order_key"])["status"] == "authorised"
    assert transactions(killbill.payment_by_key(order["order_key"]), "CAPTURE") == []
    assert variant_of(app_url, "rimu-gimbal-downlight", RGD)["stock_on_hand"] == stock_before


def test_wf_admin_dispatch_card(browser, app_url, killbill):
    _, order = card_order(app_url)
    key = order["order_key"]
    with ui(browser, app_url, "/admin", account=admin_account(app_url)) as page:
        click(page.get_by_role("tab", name="Orders"))
        row = admin_row(page, "Orders", key)
        wait_true(page, lambda: "Authorised" in shown(row), "Authorised row")
        with held(page, "**/api/admin/orders/*/dispatch") as gate:
            click(page.get_by_role("button", name=f"Dispatch {key}"))
            wait_true(page, lambda: "Capturing" in shown(row), "Capturing while pending")
            gate.release()
        wait_text(page, page.get_by_role("status", name="Admin updates"), f"Payment captured. Order {key} is Paid.")
        wait_true(page, lambda: "Paid" in shown(row), "Paid row")
    assert len(transactions(killbill.payment_by_key(key), "CAPTURE")) == 1


def test_wf_admin_dispatch_account(browser, app_url, killbill):
    buyer, order = account_order(app_url, [("PHP-BZ-60-2700", 1)])
    key = order["order_key"]
    with ui(browser, app_url, "/admin", account=admin_account(app_url)) as page:
        click(page.get_by_role("tab", name="Orders"))
        click(page.get_by_role("button", name=f"Dispatch {key}"))
        status = page.get_by_role("status", name="Admin updates")
        wait_true(page, lambda: shown(status).startswith("Invoice ") and shown(status).endswith(f" raised for {key}."), "invoice copy")
        invoice = order_of(buyer, key)["invoice"]
        assert shown(status) == f"Invoice {invoice['invoice_number']} raised for {key}."
        wait_true(page, lambda: "Invoiced" in shown(admin_row(page, "Orders", key)), "Invoiced row")
    items = [d for inv in kb_invoice(killbill, buyer.user, invoice["kb_invoice_id"]) for d in records(inv) if "GST 15%" in d.values()]
    assert len(items) == 1 and amount_in(items[0], PHP_BZ_GST)


def test_wf_admin_refunds_partial_then_full(browser, app_url, killbill):
    _, order = captured_order(app_url)
    key, total = order["order_key"], order["total_cents"]
    with ui(browser, app_url, "/admin", account=admin_account(app_url)) as page:
        click(page.get_by_role("tab", name="Orders"))
        row = admin_row(page, "Orders", key)
        for amount, label in ((5000, "Partly refunded"), (total - 5000, "Refunded")):
            click(page.get_by_role("button", name=f"Refund {key}"))
            dialog = page.get_by_role("dialog", name="Refund")
            fill(dialog.get_by_role("textbox", name="Amount (NZD)"), money(amount))
            fill(dialog.get_by_role("textbox", name="Reason"), "Probe refund")
            click(dialog.get_by_role("button", name="Issue refund"))
            wait_text(page, page.get_by_role("status", name="Admin updates"), f"Refunded {dollars(amount)} on {key}.")
            wait_true(page, lambda label=label: label in shown(row), f"row {label}")
    refunds = transactions(killbill.payment_by_key(key), "REFUND")
    assert len(refunds) == 2 and any(amount_in(r, 5000) for r in refunds) and any(amount_in(r, total - 5000) for r in refunds)


def test_wf_admin_refunds_over_refund(browser, app_url, killbill):
    buyer, order = captured_order(app_url)
    key, total = order["order_key"], order["total_cents"]
    with ui(browser, app_url, "/admin", account=admin_account(app_url)) as page:
        click(page.get_by_role("tab", name="Orders"))
        click(page.get_by_role("button", name=f"Refund {key}"))
        dialog = page.get_by_role("dialog", name="Refund")
        fill(dialog.get_by_role("textbox", name="Amount (NZD)"), money(total + 1))
        fill(dialog.get_by_role("textbox", name="Reason"), "Probe refund")
        click(dialog.get_by_role("button", name="Issue refund"))
        wait_true(page, lambda: f"More than the {dollars(total)} still refundable." in body_text(page), "over-refund error")
    assert transactions(killbill.payment_by_key(key), "REFUND") == []
    assert order_of(buyer, key)["refunded_cents"] == 0


def test_order_on_monthly_account(app_url, killbill):
    buyer = approved_trade(app_url, "monthly")
    key = add_line(buyer, "PHP-BZ-60-2700", 1)["order_key"]
    assert buyer.http.post(f"/api/orders/{key}/place-on-account", json={"delivery": DELIVERY}).json() == {"error": "idempotency_key_required"}
    long_po = place_on_account(buyer, key, "P" * (PO_MAX + 1))
    assert long_po.status_code == 422 and "purchase_order" in long_po.json()["errors"]
    po = "P" * PO_MAX
    request_key = idempotency_key()
    reply = place_on_account(buyer, key, po, request_key)
    assert reply.status_code == 200, reply.text
    placed = reply.json()["order"]
    assert (placed["status"], placed["display_status"], placed["payment_method"], placed["price_tier"], placed["purchase_order"]) == ("placed", "Placed", "account", "trade", po)
    assert (placed["subtotal_cents"], placed["gst_cents"], placed["total_cents"], placed["invoice"]) == (PHP_BZ_TRADE, PHP_BZ_GST, PHP_BZ_TOTAL, None)
    assert place_on_account(buyer, key, po, request_key).json() == reply.json()
    next_cart = buyer.http.get("/api/cart").json()["order"]
    assert next_cart["order_key"] != key
    assert place_on_account(buyer, next_cart["order_key"]).json() == {"error": "empty_cart"}
    assert killbill.payment_by_key(key) is None
    for other in (retail(app_url, "notrade"), applicant(app_url, "stillpending")):
        cart_key = add_line(other, KDL_DEFAULT, 1)["order_key"]
        assert place_on_account(other, cart_key).json() == {"error": "trade_account_required"}


def test_gst_itemised_trade_invoice(app_url, killbill):
    buyer, order = account_order(app_url, [("PHP-BZ-60-2700", 1), ("KDL-BK-24-3000", 2)])
    subtotal = PHP_BZ_TRADE + 2 * KDL_24_TRADE
    assert (order["subtotal_cents"], order["gst_cents"], order["total_cents"]) == (subtotal, gst(subtotal), subtotal + gst(subtotal))
    reply = dispatch(app_url, order["order_key"])
    assert reply.status_code == 200, reply.text
    invoiced = reply.json()["order"]
    assert (invoiced["status"], invoiced["display_status"]) == ("invoiced", "Invoiced") and invoiced["invoice"]["invoice_number"]
    invoices = kb_invoice(killbill, buyer.user, invoiced["invoice"]["kb_invoice_id"])
    assert len(invoices) == 1
    items = list(records(invoices[0]))
    for description, cents in (("PHP-BZ-60-2700 x 1", PHP_BZ_TRADE), ("KDL-BK-24-3000 x 2", 2 * KDL_24_TRADE), ("GST 15%", gst(subtotal))):
        matching = [d for d in items if description in d.values()]
        assert len(matching) == 1 and amount_in(matching[0], cents), description
    assert amount_in(invoices[0], subtotal + gst(subtotal))
    again = dispatch(app_url, order["order_key"])
    assert again.json() == {"error": "invalid_state", "status": "invoiced"}
    assert order_of(buyer, order["order_key"])["invoice"]["kb_invoice_id"] == invoiced["invoice"]["kb_invoice_id"]


def test_due_date_and_overdue(app_url, killbill):
    buyer, order = account_order(app_url, [("PHP-BZ-60-2700", 1)])
    key = order["order_key"]
    with clock_copy(INVOICE_DATE) as invoice_base:
        reply = dispatch(invoice_base, key)
        assert reply.status_code == 200, reply.text
        invoice = reply.json()["order"]["invoice"]
        assert (invoice["invoice_date"], invoice["due_date"]) == (INVOICE_DATE, DUE_DATE)
    assert kb_invoice(killbill, buyer.user, invoice["kb_invoice_id"])
    with clock_copy(DUE_DATE) as due_base:
        on_due = order_of(view_as(due_base, buyer), key)
        assert (on_due["status"], on_due["display_status"]) == ("invoiced", "Invoiced")
    with clock_copy(OVERDUE_DATE) as overdue_base:
        late = order_of(view_as(overdue_base, buyer), key)
        assert (late["status"], late["display_status"]) == ("overdue", "Overdue")
        listed = next(o for o in admin_http(overdue_base).get("/api/admin/orders").json()["orders"] if o["order_key"] == key)
        assert listed["display_status"] == "Overdue" and listed["customer_email"] == buyer.email
        paid = admin_http(overdue_base).post(f"/api/admin/orders/{key}/record-payment", json={"amount_cents": order["total_cents"]})
        assert paid.status_code == 200 and paid.json()["order"]["status"] == "paid"
        card_buyer = retail(overdue_base, "expiry")
        cart_key = add_line(card_buyer, KDL_DEFAULT, 1)["order_key"]
        body = checkout_body()
        body["card"]["expiry"] = "01/27"
        expired = pay(card_buyer, cart_key, body=body)
        assert expired.status_code == 422 and "expiry" in expired.json()["errors"]
    assert killbill.payment_by_key(f"{key}-payment") is not None


def test_recording_trade_payments(app_url, killbill):
    buyer, order = account_order(app_url, [("PHP-BZ-60-2700", 1)])
    key = order["order_key"]
    early = admin_http(app_url).post(f"/api/admin/orders/{key}/record-payment", json={"amount_cents": PHP_BZ_TOTAL})
    assert early.json() == {"error": "invalid_state", "status": "placed"}
    assert dispatch(app_url, key).status_code == 200
    wrong = admin_http(app_url).post(f"/api/admin/orders/{key}/record-payment", json={"amount_cents": PHP_BZ_TOTAL - 1})
    assert wrong.status_code == 422 and wrong.json()["errors"]["amount_cents"] == "must_equal_balance"
    assert killbill.payment_by_key(f"{key}-payment") is None
    paid = admin_http(app_url).post(f"/api/admin/orders/{key}/record-payment", json={"amount_cents": PHP_BZ_TOTAL})
    assert paid.status_code == 200 and (paid.json()["order"]["status"], paid.json()["order"]["display_status"]) == ("paid", "Paid")
    payment = killbill.payment_by_key(f"{key}-payment")
    assert payment is not None and any(amount_in(d, PHP_BZ_TOTAL) for d in records(payment))
    assert admin_http(app_url).post(f"/api/admin/orders/{key}/record-payment", json={"amount_cents": PHP_BZ_TOTAL}).json() == {"error": "invalid_state", "status": "paid"}
    assert order_of(buyer, key)["display_status"] == "Paid"


def test_killbill_recovery_without_restart(killbill):
    relay = Relay(service_env("KILLBILL_URL"))
    try:
        with app_copy(KILLBILL_URL=relay.url) as base:
            buyer = retail(base, "kbback")
            key = add_line(buyer, KDL_DEFAULT, 1)["order_key"]
            down = pay(buyer, key)
            assert down.status_code == 503 and down.json()["order"]["status"] == "gateway_unavailable"
            relay.up()
            assert pay(buyer, key).json()["order"]["status"] == "authorised"
            steps = [
                (lambda: dispatch(base, key), lambda r: r.json()["order"]["status"] == "captured"),
                (lambda: refund(base, key, 1000), lambda r: r.json()["order"]["refunded_cents"] == 1000),
            ]
            trade, placed = None, None
            for attempt, succeeded in steps:
                relay.down()
                failed = attempt()
                assert failed.status_code == 503 and failed.json()["error"] == "payment_unavailable"
                relay.up()
                assert succeeded(attempt())
            relay.down()
            trade = approved_trade(base, "kbinvoice")
            add_line(trade, "PHP-BZ-60-2700", 1)
            placed = place_on_account(trade, trade.http.get("/api/cart").json()["order"]["order_key"])
            assert placed.status_code == 200, "placing on account needs no Kill Bill"
            account_key = placed.json()["order"]["order_key"]
            for attempt, status in ((lambda: dispatch(base, account_key), "invoiced"), (lambda: admin_http(base).post(f"/api/admin/orders/{account_key}/record-payment", json={"amount_cents": PHP_BZ_TOTAL}), "paid")):
                relay.down()
                failed = attempt()
                assert failed.status_code == 503 and failed.json()["error"] == "payment_unavailable"
                relay.up()
                assert attempt().json()["order"]["status"] == status
        assert len(transactions(killbill.payment_by_key(key), "AUTHORIZE")) == 1
        assert len(transactions(killbill.payment_by_key(key), "CAPTURE")) == 1
        assert len(transactions(killbill.payment_by_key(key), "REFUND")) == 1
        assert killbill.payment_by_key(f"{account_key}-payment") is not None
    finally:
        relay.stop()


def test_wf_trade_account_happy(browser, app_url, killbill, mail):
    buyer = approved_trade(app_url, "journey7")
    add_line(buyer, "PHP-BZ-60-2700", 1)
    po = f"PO-{uuid.uuid4().hex[:8]}"
    with ui(browser, app_url, "/checkout", account=buyer) as page:
        click(page.get_by_role("radiogroup", name="Payment method").get_by_role("radio", name="Monthly account"))
        wait_count(page, page.get_by_role("textbox", name="Card number", exact=True), 0)
        fill_delivery(page)
        fill(page.get_by_role("textbox", name="Purchase order (optional)"), po)
        click(page.get_by_role("button", name="Place order on account"))
        wait_count(page, page.get_by_role("heading", name="Order placed", level=1), 1)
        key = order_key_in(page)
        wait_true(page, lambda: f"Order {key} is on your monthly account. A confirmation is on its way to {buyer.email}." in body_text(page), "placed copy")
        order = order_of(buyer, key)
        assert (order["status"], order["purchase_order"], order["total_cents"]) == ("placed", po, PHP_BZ_TOTAL)
        message = inbox(mail, f"Your Lightfall order {key}")
        assert len(message) == 1 and po in mail_body(message[0]) and dollars(PHP_BZ_TOTAL) in mail_body(message[0])
        assert dispatch(app_url, key).status_code == 200
        invoice = order_of(buyer, key)["invoice"]
        page.goto(base_of(app_url) + f"/orders/{key}")
        wait_true(page, lambda: invoice["invoice_number"] in body_text(page), "invoice number on order page")
    assert [d for inv in kb_invoice(killbill, buyer.user, invoice["kb_invoice_id"]) for d in records(inv) if "GST 15%" in d.values()]


def test_wf_trade_account_record_payment(browser, app_url, killbill):
    buyer, order = account_order(app_url, [("PHP-BZ-60-2700", 1)])
    key = order["order_key"]
    assert dispatch(app_url, key).status_code == 200
    with ui(browser, app_url, "/admin", account=admin_account(app_url)) as page:
        click(page.get_by_role("tab", name="Orders"))
        status = page.get_by_role("status", name="Admin updates")
        for amount, copy in ((PHP_BZ_TOTAL - 1, "The amount must equal the invoice total."), (PHP_BZ_TOTAL, f"Payment recorded. Order {key} is Paid.")):
            if not page.get_by_role("dialog", name="Record payment").count():
                click(page.get_by_role("button", name=f"Record payment {key}"))
            field = page.get_by_role("dialog", name="Record payment").get_by_role("textbox", name="Amount received (NZD)")
            if amount != PHP_BZ_TOTAL:
                assert field.input_value() == ""
            fill(field, money(amount))
            click(page.get_by_role("dialog", name="Record payment").get_by_role("button", name="Record"))
            wait_text(page, status, copy)
        wait_true(page, lambda: "Paid" in shown(admin_row(page, "Orders", key)), "Paid row")
    assert killbill.payment_by_key(f"{key}-payment") is not None
    assert order_of(buyer, key)["status"] == "paid"


def test_wf_trade_account_overdue(browser, app_url):
    buyer, order = account_order(app_url, [("KDL-BK-24-3000", 1)])
    key = order["order_key"]
    with clock_copy(INVOICE_DATE) as invoice_base:
        assert dispatch(invoice_base, key).status_code == 200
    for today, label in ((DUE_DATE, "Invoiced"), (OVERDUE_DATE, "Overdue")):
        with clock_copy(today) as base:
            viewer = view_as(base, buyer)
            with ui(browser, base, f"/orders/{key}", account=viewer) as page:
                wait_true(page, lambda label=label: label in body_text(page), f"order page reads {label}")
            assert order_of(viewer, key)["display_status"] == label


def confirm_token(message: dict[str, Any]) -> str:
    match = re.search(r"/newsletter/confirm\?token=([^\s\"'<>&]+)", mail_body(message))
    assert match, "no confirmation link"
    return match.group(1)


def test_newsletter_with_consent(app_url, mail):
    _, email = fresh("news")
    for body, field in (({"email": email, "occupation": "architect", "consent": False}, "consent"), ({"email": email, "occupation": "architect"}, "consent"), ({"email": "not-an-email", "occupation": "architect", "consent": True}, "email")):
        reply = post_json(app_url, "/api/newsletter", body)
        assert reply.status_code == 422 and field in reply.json()["errors"]
        if field == "consent":
            assert reply.json()["errors"]["consent"] == "required"
    assert inbox(mail, email, seconds=NO_MAIL_WAIT_S) == []
    reply = post_json(app_url, "/api/newsletter", {"email": email, "occupation": "architect", "consent": True})
    assert reply.status_code == 202 and reply.json() == {"status": "pending_confirmation"}
    messages = inbox(mail, email)
    assert len(messages) == 1 and "Confirm your Lightfall newsletter" in serial(messages[0]) and "architect" in mail_body(messages[0]).lower()
    token = confirm_token(messages[0])
    confirmed = httpx.get(base_of(app_url) + "/api/newsletter/confirm", params={"token": token}, timeout=HTTP_TIMEOUT_S)
    assert confirmed.status_code == 200 and confirmed.json() == {"status": "confirmed", "email": email, "occupation": "architect"}
    assert httpx.get(base_of(app_url) + "/api/newsletter/confirm", params={"token": token}, timeout=HTTP_TIMEOUT_S).json() == confirmed.json()
    unknown = httpx.get(base_of(app_url) + "/api/newsletter/confirm", params={"token": uuid.uuid4().hex}, timeout=HTTP_TIMEOUT_S)
    assert unknown.status_code == 404 and unknown.json() == {"error": "unknown_token"}
    assert post_json(app_url, "/api/newsletter", {"email": email, "occupation": "trade", "consent": True}).status_code == 202
    again = inbox(mail, email, count=2)
    tokens = {confirm_token(m) for m in again}
    assert len(again) == 2 and len(tokens) == 2
    second = (tokens - {token}).pop()
    assert httpx.get(base_of(app_url) + "/api/newsletter/confirm", params={"token": second}, timeout=HTTP_TIMEOUT_S).json()["occupation"] == "trade"


def test_wf_newsletter_happy(browser, app_url, mail):
    _, email = fresh("newsui")
    with ui(browser, app_url, "/") as page:
        form = page.get_by_role("region", name="Newsletter")
        fill(form.get_by_role("textbox", name="Email"), email)
        select(form.get_by_role("combobox", name="Occupation"), "Architect")
        check(form.get_by_role("checkbox", name="Send me the Lightfall newsletter"))
        click(form.get_by_role("button", name="Subscribe"))
        wait_text(page, page.get_by_role("status", name="Newsletter status"), f"Check your inbox. We've sent a confirmation link to {email}.")
        messages = inbox(mail, email)
        assert len(messages) == 1
        token = confirm_token(messages[0])
        page.goto(base_of(app_url) + f"/newsletter/confirm?token={token}")
        wait_count(page, page.get_by_role("heading", name="You're subscribed", level=1), 1)
    assert httpx.get(base_of(app_url) + "/api/newsletter/confirm", params={"token": token}, timeout=HTTP_TIMEOUT_S).json()["status"] == "confirmed"


def test_wf_newsletter_no_consent(browser, app_url, mail):
    _, email = fresh("noconsent")
    with ui(browser, app_url, "/") as page:
        form = page.get_by_role("region", name="Newsletter")
        fill(form.get_by_role("textbox", name="Email"), email)
        select(form.get_by_role("combobox", name="Occupation"), "Other")
        click(form.get_by_role("button", name="Subscribe"))
        wait_text(page, page.get_by_role("status", name="Newsletter status"), "Tick the box to agree to the newsletter.")
    assert inbox(mail, email, seconds=NO_MAIL_WAIT_S) == []


def test_wf_newsletter_invalid_token(browser, app_url):
    token = uuid.uuid4().hex
    with ui(browser, app_url, f"/newsletter/confirm?token={token}") as page:
        wait_count(page, page.get_by_role("heading", name="That confirmation link isn't valid.", level=1), 1)
    assert httpx.get(base_of(app_url) + "/api/newsletter/confirm", params={"token": token}, timeout=HTTP_TIMEOUT_S).status_code == 404


def test_health_on_published_port(app_url):
    reply = httpx.get(base_of(app_url) + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert reply.status_code == 200 and reply.json() == {"status": "ok"}
    assert httpx.get(base_of(app_url) + "/", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_wf_cross_cutting_manifest_boot(browser):
    with app_copy() as base:
        assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
        assert [p["slug"] for p in http(base).get("/api/catalogue").json()["products"]] == SEED_SLUGS
        with ui(browser, base, "/catalogue") as page:
            wait_text(page, page.get_by_role("status", name="Results count"), f"{len(SEED_SLUGS)} fittings")


INSTANCE_IDS = ["primary", "killbill-down", "minio-down", "pocketbase-down"]
INSTANCES = {"primary": (None, None), "killbill-down": ("APP_KILLBILL_DOWN_URL", "killbill"), "minio-down": ("APP_MINIO_DOWN_URL", "minio"), "pocketbase-down": ("APP_POCKETBASE_DOWN_URL", "pocketbase")}
HEALTH_ROWS = {"postgres": "Postgres", "killbill": "Kill Bill", "mailpit": "Mailpit", "minio": "MinIO", "pocketbase": "PocketBase"}


@pytest.mark.parametrize("instance", INSTANCE_IDS, ids=INSTANCE_IDS)
def test_degraded_boot_and_health(browser, app_url, instance):
    env_name, missing = INSTANCES[instance]
    base = outage(env_name) if env_name else base_of(app_url)
    assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
    assert [p["slug"] for p in http(base).get("/api/catalogue").json()["products"]] == SEED_SLUGS
    started = time.monotonic()
    services = admin_http(base).get("/api/admin/health").json()["services"]
    assert time.monotonic() - started <= HEALTH_PROBE_MAX_S * len(HEALTH_ROWS) + HTTP_TIMEOUT_S
    assert services == {name: ("down" if name == missing else "up") for name in HEALTH_ROWS}
    shopper = retail(base, "degradedcart")
    cart = add_line(shopper, "PHP-BZ-60-2700", 1)
    assert (cart["subtotal_cents"], cart["gst_cents"], cart["total_cents"]) == (PHP_BZ_RETAIL, gst(PHP_BZ_RETAIL), PHP_BZ_RETAIL + gst(PHP_BZ_RETAIL))
    if missing is None:
        _, order = card_order(base)
        assert order["status"] == "authorised"
    if missing in ("killbill", "minio"):
        owner = approved_trade(base, "degraded")
        project_id = create_project(owner)["id"]
        add_project_line(owner, project_id, "KDL-BK-24-3000", 1)
        assert place(owner, project_id, "KDL-BK-24-3000", 0, 0).status_code == 201
    with ui(browser, base, "/admin", account=admin_account(base)) as page:
        click(page.get_by_role("tab", name="Health"))
        table = page.get_by_role("table", name="Service health")
        for name, label in HEALTH_ROWS.items():
            row = table.get_by_role("row").filter(has_text=label)
            wait_true(page, lambda row=row, name=name: ("Down" if name == missing else "Up") in shown(row), f"{label} row")


def test_server_boundary(app_url):
    base = base_of(app_url)
    origin = "{0.scheme}://{0.netloc}".format(urlsplit(base))
    _, email = fresh("boundary")
    body = {"email": email, "occupation": "other", "consent": True}
    assert post_json(base, "/api/newsletter", body, Origin=FOREIGN_ORIGIN).json() == {"error": "cross_origin"}
    assert post_json(base, "/api/newsletter", body, Origin=origin).status_code == 202
    padded = json.dumps({**body, "message": ""})
    exact = padded.replace('"message": ""', '"message": "' + "x" * (JSON_LIMIT - len(padded)) + '"')
    assert len(exact.encode()) == JSON_LIMIT
    headers = {"Content-Type": "application/json"}
    assert httpx.post(base + "/api/newsletter", content=exact, headers=headers, timeout=HTTP_TIMEOUT_S).status_code != 413
    over = httpx.post(base + "/api/newsletter", content=exact + " ", headers={**headers, "Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S)
    assert over.status_code == 413 and over.json() == {"error": "payload_too_large"}
    wrong_type = httpx.post(base + "/api/newsletter", content=json.dumps(body), headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT_S)
    assert wrong_type.status_code == 415 and wrong_type.json() == {"error": "unsupported_media_type"}
    broken = httpx.post(base + "/api/newsletter", content="{not json", headers=headers, timeout=HTTP_TIMEOUT_S)
    assert broken.status_code == 400 and broken.json() == {"error": "invalid_json"}
    missing = httpx.get(base + f"/api/{uuid.uuid4().hex}", timeout=HTTP_TIMEOUT_S)
    assert missing.status_code == 404 and missing.json() == {"error": "not_found"}
    for path in ("/run.json", "/THIRD_PARTY_NOTICES.md"):
        assert httpx.get(base + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    home = httpx.get(base + "/", timeout=HTTP_TIMEOUT_S).text
    assets = [home] + [httpx.get(base + src if src.startswith("/") else src, timeout=HTTP_TIMEOUT_S).text for src in re.findall(r'src="([^"]+\.js)"', home) if same_origin(base + src if src.startswith("/") else src, base)]
    for src in re.findall(r'src="(/[^"]+\.js)"', home):
        assert httpx.get(base + src + ".map", timeout=HTTP_TIMEOUT_S).status_code == 404
    secrets = [os.environ.get(n, "") for n in ("DATABASE_URL", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY", "POCKETBASE_ADMIN_PASSWORD", "KILLBILL_URL", "POCKETBASE_URL")]
    for secret in (s for s in secrets if len(s) >= 8):
        assert not any(secret in asset for asset in assets), "a credential or service URL reached the browser"


def test_lighting_dial(browser, app_url):
    for hour, minute, before, after in DIAL_EDGES:
        with ui(browser, app_url, "/") as page:
            set_local_time(page, hour, minute)
            page.reload()
            wait_true(page, lambda before=before: light(page) == (before, "auto"), f"auto {before}")
            advance(page, DIAL_RECHECK_MS)
            wait_true(page, lambda after=after: light(page) == (after, "auto"), f"auto {after}")
    shopper = retail(app_url, "dial")
    with ui(browser, app_url, "/catalogue", account=shopper) as page:
        dial = page.get_by_role("radiogroup", name="Lighting")
        click(dial.get_by_role("radio", name="Day"))
        wait_true(page, lambda: light(page) == ("day", "day"), "day chosen")
        day_ground = ground(page)
        click(dial.get_by_role("radio", name="Night"))
        wait_true(page, lambda: light(page) == ("night", "night"), "night chosen")
        assert ground(page) != day_ground
        dial.get_by_role("radio", name="Night").focus()
        page.keyboard.press("ArrowRight")
        wait_true(page, lambda: light(page) == ("gallery", "gallery"), "arrow selects Gallery")
        poll(lambda: shopper.http.get("/api/me").json()["user"]["dial_mode"] == "gallery" or (_ for _ in ()).throw(AssertionError("not saved")))
        first = dial.bounding_box()
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        advance(page, POLL_MS)
        assert dial.bounding_box() == first
        assert first["x"] + first["width"] <= DESKTOP[0] / 2 and first["y"] >= DESKTOP[1] / 2
    relogin(shopper)
    with ui(browser, app_url, "/", account=shopper) as page:
        wait_true(page, lambda: light(page) == ("gallery", "gallery"), "choice applied on next load")
    assert shopper.http.put("/api/me/dial", json={"mode": "dusk"}).status_code == 422
    with ui(browser, app_url, "/") as page:
        click(page.get_by_role("radiogroup", name="Lighting").get_by_role("radio", name="Evening"))
        page.reload()
        wait_true(page, lambda: light(page) == ("evening", "evening"), "browser keeps the choice")
    with ui(browser, app_url, "/products/kauri-downlight", size=PHONE) as page:
        dial_box = page.get_by_role("radiogroup", name="Lighting").bounding_box()
        add_box = page.get_by_role("region", name="Quick add").get_by_role("button", name="Add to cart").bounding_box()
        overlaps = dial_box["x"] < add_box["x"] + add_box["width"] and add_box["x"] < dial_box["x"] + dial_box["width"] and dial_box["y"] < add_box["y"] + add_box["height"] and add_box["y"] < dial_box["y"] + dial_box["height"]
        assert not overlaps, "the dial covers the quick-add button"


def test_wf_cross_cutting_dial(browser, app_url):
    shopper = retail(app_url, "dialwf")
    with ui(browser, app_url, "/", account=shopper) as page:
        dial = page.get_by_role("radiogroup", name="Lighting")
        dial.get_by_role("radio", name="Auto").focus()
        page.keyboard.press("ArrowRight")
        wait_true(page, lambda: light(page) == ("morning", "morning"), "Morning chosen")
        poll(lambda: shopper.http.get("/api/me").json()["user"]["dial_mode"] == "morning" or (_ for _ in ()).throw(AssertionError("not saved")))
        page.reload()
        wait_true(page, lambda: light(page) == ("morning", "morning"), "Morning after reload")


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_responsive_and_reduced_motion(browser, app_url, viewport):
    size = size_of(viewport)
    base = base_of(app_url)
    shopper, order = card_order(base)
    add_line(shopper, KDL_DEFAULT, 1)
    trade = approved_trade(base, "screens")
    project_id = create_project(trade)["id"]
    add_project_line(trade, project_id, "KDL-BK-24-3000", 1)
    landmarks = lambda page: page.get_by_role("navigation", name="Main")
    plan = [
        (None, ["/", "/catalogue", "/compare", "/products/kauri-downlight", "/signin", "/signup", "/newsletter/confirm?token=probe"]),
        (shopper, ["/favourites", "/cart", "/checkout", f"/orders/{order['order_key']}"]),
        (trade, ["/projects", f"/projects/{project_id}"]),
        (admin_account(base), ["/admin"]),
    ]
    for account, paths in plan:
        with ui(browser, base, paths[0], account=account, size=size) as page:
            for path in paths:
                page.goto(base + path)
                wait_count(page, landmarks(page), 1)
                eventually(page, lambda: layout(page))
    with ui(browser, base, "/catalogue", size=size, reduced_motion="reduce") as page:
        if size[0] == 1280:
            page.get_by_role("button", name="Catalogue", exact=True).focus()
            page.keyboard.press("Enter")
            panel = page.get_by_role("region", name="Catalogue menu")
        else:
            click(page.get_by_role("button", name="Filters", exact=True))
            panel = page.get_by_role("dialog", name="Filters")
        wait_count(page, panel, 1)
        assert animations(panel) == []
    with ui(browser, base, "/products/kauri-downlight", size=size, no_webgl=True) as page:
        wait_count(page, page.get_by_role("img", name=f"{PRODUCT_NAMES[0]} drawing"), 1)
        assert page.get_by_role("img", name=f"{PRODUCT_NAMES[0]} 3D model").count() == 0
        page.context.add_cookies([{"name": SESSION_COOKIE, "value": trade.http.cookies[SESSION_COOKIE], "url": base}])
        page.goto(base + f"/projects/{project_id}")
        wait_count(page, page.get_by_role("img", name="Room plan"), 1)
        assert page.get_by_role("img", name="Room 3D view").count() == 0


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    assert all(font in notices for font in FONT_NAMES)


def test_if_licences():
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCE_ALLOWLIST)]
    assert not refused, refused
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text().lower()
    assert "Open Font License".lower() in notices


def test_if_no_extra_datastore():
    names = [p.name.lower() for p in shipped_packages()]
    banned = [word.lower() for word in ("SQLite", "Redis")]
    assert not [n for n in names if any(b in n for b in banned)]


def test_if_same_origin_assets(browser, app_url):
    base = base_of(app_url)
    with ui(browser, base, "/") as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/", "/catalogue", "/products/kauri-downlight"):
            page.goto(base + path)
            page.wait_for_load_state("networkidle")
        foreign = [u for u in seen if urlsplit(u).scheme in ("http", "https", "ws", "wss") and not same_origin(u, base)]
        assert not foreign, foreign


BUILD_DIRS = {"dist", "build", "out", ".next", ".vite", "coverage"}


def test_if_typescript_source():
    root = Path("/app")
    assert any(root.rglob("*.ts")), "no TypeScript source"
    offenders = []
    for path in root.rglob("*"):
        parts = path.relative_to(root).parts
        if "node_modules" in parts or set(parts[:-1]) & BUILD_DIRS or not path.is_file() or path.suffix not in (".js", ".mjs", ".cjs", ".jsx"):
            continue
        if ".config." in path.name or path.name.startswith("."):
            continue
        offenders.append(str(path))
    assert not offenders, offenders


WRITE_TOOLS = {"write", "edit", "multiedit", "notebookedit", "str_replace_editor", "write_file", "edit_file", "create_file"}
PROTECTED_CONFIG = re.compile(r"(^|/)((docker-)?compose(\.[\w-]+)?\.ya?ml|\.devcontainer/.*)$")


def written_paths(trajectory: Any) -> set[str]:
    paths: set[str] = set()
    for call in records(trajectory):
        tool = next((v for k, v in call.items() if k in ("name", "tool", "tool_name") and isinstance(v, str)), "")
        if tool.lower() not in WRITE_TOOLS:
            continue
        for key in ("input", "arguments", "args", "parameters"):
            arguments = call.get(key)
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except ValueError:
                    continue
            for inner in records(arguments):
                for field in ("file_path", "path", "notebook_path"):
                    if isinstance(inner.get(field), str):
                        paths.add(inner[field])
    return paths


def test_if_service_config_untouched():
    log = Path("/logs/agent/trajectory.json")
    trajectory = json.loads(log.read_text()) if log.is_file() else []
    touched = sorted(p for p in written_paths(trajectory) if PROTECTED_CONFIG.search(p))
    assert not touched, touched


def test_if_models_built_in_code(browser, app_url):
    for slug, name in zip(SEED_SLUGS, PRODUCT_NAMES):
        with ui(browser, app_url, f"/products/{slug}") as page:
            frames = scene_frames(page.get_by_role("img", name=f"{name} 3D model"), steps=2)
            assert not any(f["models"] for f in frames) and frames[-1]["uploaded"] > CUBE_VERTEX_BYTES, slug
    owner = approved_trade(app_url, "models")
    project_id = create_project(owner)["id"]
    with ui(browser, app_url, f"/projects/{project_id}", account=owner) as page:
        frames = scene_frames(page.get_by_role("img", name="Room 3D view"), steps=2)
        assert not any(f["models"] for f in frames)
