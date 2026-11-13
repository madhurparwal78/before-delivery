from __future__ import annotations

import base64
import json
import os
import re
import secrets
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fractions import Fraction
from math import floor
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qsl, quote, urlsplit

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Page, expect

from conftest import (
    S3,
    Postgres,
    advance,
    capture,
    check,
    click,
    come_to_rest,
    fill,
    focused_name,
    held,
    idempotency_key,
    layout,
    open_app,
    same_origin,
    select,
    serve_copy,
    session,
    tab_order,
    tap,
)

HTTP_TIMEOUT_S = 30
REAL_WAIT_S = 30
BOOT_WAIT_S = 240
COPY_POLL_S = 0.5
STEP_MS = 100
LONG_STEP_MS = 500
KERF_WATCH_S = 3
FRAME_TOLERANCE_MS = 20
MIN_ANIMATION_MS = 20
HALF_PX = 0.5
MOTION_STEP_MS = 20
MOTION_WATCH_MS = 1600
MOTION_SETTLE_MS = 2000
PIXEL_DELTA = 40
KERF_MIN_SHARE = 8
MIN_MASK_PX = 20
OFFCUT_INSET_PX = 3
WHOLE_WIDTH = 10**6
EASED_SHARE = 0.5
STARTED = 0.02
NEAR_FULL = 0.95
SETTLED = 0.05
DIMMED = 0.98

ONE_SECOND_MS = 1000
TWO_SECONDS_MS = 2000
BANNER_MS = 15000
EXPIRED_LABEL_MS = 15000
OTHER_VIEWER_MS = 10000
STOCK_REFRESH_MS = 10000
UNTOUCHED_GRACE_S = 5
KERF_LINE_MS = (100, 150)
OFFCUT_FADE_MS = (200, 300)
FIGURES_MS = (300, 400)
RATE_WINDOW_BEFORE_S = 60
RATE_WINDOW_AFTER_DAYS = 365

BOARD_FOOT_DIVISOR = 2_359_737_216
DEPOSIT_CENTS = 2500
DEFAULT_HOLD_SECONDS = 172800
KERF_ALLOWANCE_MM = 4
MIN_OFFCUT_MM = 300
SNAP_MM = 10
SHIFT_STEPS = 10
UNDO_DEPTH = 50
MAX_PIECES = 20
MAX_DEFECTS = 50
LABEL_MAX = 40
LENGTH_RANGE = (300, 12_000)
WIDTH_RANGE = (20, 600)
THICKNESS_RANGE = (10, 400)
FILTER_MAX = 12_000
JSON_LIMIT = 65_536
PHOTO_LIMIT = 5_000_000
PIXEL_LIMIT = 40_000_000
MAX_PHOTOS = 8
THUMB_EDGE = 320
FIRST_TAG = 11
SEED_CREATED = "2026-01-01T00:00:00Z"
CLEAR_SEED_TAG = "KW-0005"
TAGGED_TAG = "KW-0008"
GRADED_TAG = "KW-0009"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax")
OTHER_DATASTORES = ("SQLite", "Redis")
VERDICT_NO_OFFCUT = "cuts fit clear of defects, no offcut"
VERDICT_NEEDS_FIXING = "cuts fit clear of defects, layout needs fixing"

PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
VIEWPORTS = {"375": [375, 812], "768": [768, 1024], "1280": [1280, 800]}
RAIL_SHARE = (Fraction(1, 6), Fraction(2, 5))

OWNER = ("owner@kerfwell.test", "rack-owner-2026")
HAND = ("hand@kerfwell.test", "rack-hand-2026")
INES = ("ines@makers.test", "rack-maker-2026")
JOEL = ("joel@makers.test", "rack-maker-2026")
RUTH = ("ruth@makers.test", "rack-maker-2026")
NAME = {"owner@kerfwell.test": "Dana Whitlock", "hand@kerfwell.test": "Teo Varga", "ines@makers.test": "Ines Albrecht", "joel@makers.test": "Joel Mbeki", "ruth@makers.test": "Ruth Calloway"}
SPECIES = ["Black walnut", "Chestnut", "Douglas fir", "Heart pine", "White oak"]
GRADES = ["Select", "Character", "Rustic"]
LOTS = {"LOT-01": "Hollis Road dairy barn", "LOT-02": "Pell Street shoe factory", "LOT-03": "Marsh Lane farmhouse"}
OPEN_STATUSES = ["tagged", "graded", "available", "held"]
TALLY = {"Select": 1, "Character": 2, "Rustic": 3}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}

SUMMARY_KEYS = {"tag", "species", "grade", "status", "lot", "length_mm", "width_mm", "thickness_mm", "volume_mm3", "board_feet", "rate_cents", "price_cents", "longest_clear_mm", "defects", "parent_tag"}
BOARD_KEYS = SUMMARY_KEYS | {"photos", "my_hold"}
PHOTO_KEYS = {"id", "url", "thumb_url", "width", "height"}
LINEAGE_KEYS = {"tag", "status", "parent_tag", "grade", "length_mm", "width_mm", "thickness_mm", "volume_mm3", "board_feet", "rate_cents", "price_cents", "longest_clear_mm", "created_at", "children"}
FIT_KEYS = {"board", "pieces", "clear_count", "cuts_mm", "take_mm", "sale", "offcut_mm", "clear_offcut_mm", "board_feet", "price_cents", "verdict"}
HOLD_KEYS = {"id", "board", "status", "release_reason", "pieces", "cuts_mm", "take_mm", "sale", "offcut_mm", "price_cents", "deposit_cents", "created_at", "held_at", "expires_at", "killbill_payment_id"}
SALE_KEYS = {"ticket", "invoice", "board", "sale", "sold_mm", "offcut", "price_cents", "deposit_cents", "amount_cents", "killbill_payment_id", "pdf_url"}
TICKET_KEYS = {"id", "status", "board", "maker", "pieces", "cuts_mm", "take_mm", "sale", "offcut", "pdf_key", "created_at", "events"}
INVOICE_KEYS = {"id", "ticket", "board", "price_cents", "deposit_cents", "amount_cents", "lines", "status", "paid_at", "killbill_payment_id"}

CARD = "4242 4242 4242 4242"
DECLINED_CARD = "4000 0000 0000 0002"
FOREIGN_ORIGIN = "http://evil.example"
FOREIGN_RELATIVE = FOREIGN_ORIGIN.removeprefix("http:") + "/x"
DEFAULT_SIZE = (2000, 200, 40)
PIECE_A = {"label": "Shelf A", "length_mm": 600, "width_mm": 100, "start_mm": 0}
EX_TAG = "KW-0001"
EX_PIECES = [{"label": "Shelf A", "length_mm": 600, "width_mm": 100, "start_mm": 0}, {"label": "Shelf B", "length_mm": 800, "width_mm": 100, "start_mm": 650}]
EX_CUTS = [600, 650, 1450]
EX_TAKE = 1450
EX_BOARD_FEET = "3.74"
EX_PRICE = 4110
EX_OFFCUT = 986
EX_CLEAR_OFFCUT = 480
EX_VERDICT = "2 of 2 cuts fit clear of defects, offcut 986 mm"
EX_AMOUNT = 1610
EX_LINES = [1761, 2349]
KW1_SIZE = (2440, 190, 32)
KW1_DEFECTS = [{"kind": "nail hole", "start_mm": 610, "end_mm": 640}, {"kind": "check", "start_mm": 1500, "end_mm": 1720}, {"kind": "nail hole", "start_mm": 2200, "end_mm": 2230}]
V1_INCH_EXAMPLE = ("23.625", 600)

COPY = {
    "billing_banner": "Billing is offline. You can browse and plan cuts, but holds and purchases are paused.",
    "storage_banner": "Photo storage is offline. Tag boards now and add photos when it's back.",
    "held_ok": "Board held. Deposit paid.",
    "waiting": "Waiting for billing to confirm your deposit",
    "conflict_heading": "Already held by another maker",
    "conflict_text": "Someone held this board a moment before you. Your card was not charged.",
    "released_ok": "Hold released. Deposit refunded.",
    "expired": "Hold expired. The deposit was kept.",
    "hold_offline": "Billing is offline. Your card was not charged.",
    "pay_offline": "Billing is offline. Your hold is safe and nothing was charged.",
    "cancel_offline": "Billing is offline. Your hold is unchanged.",
    "paused_line": "Paused while billing is offline.",
    "holds_paused": "Holds paused",
    "invalid_card": "Enter a valid card number.",
    "add_piece": "Add a piece to see the take and price.",
    "fit_failed": "Fit check failed. Try again.",
    "not_found_heading": "Not on this rack",
    "not_found_text": "Check the link, or go back to the rack.",
    "photos_not_saved": "Photos were not saved.",
    "saved": "Saved.",
    "not_saved": "Not saved.",
    "rate_saved": "Rate saved",
    "no_match": "No boards match these filters",
    "one_board": "1 board on the rack",
}

BOUNDARY_CASES = ["cross-origin", "bad-json", "content-type", "json-limit", "photo-limit", "unauthenticated", "not-found-before-forbidden", "never-served", "no-cors"]
DIALOG_CASES = ["hold", "filters", "defect-kind", "re-measure"]
SIGN_IN_CASES = ["sign-in-to-hold", "ended-session", "foreign-next"]
MOTION_CASES = ["motion", "reduced"]
SERVICE_CASES = ["billing", "storage"]
OUTAGE_ACTION_CASES = ["hold", "pay", "cancel"]


def _release(route: Any) -> None:
    try:
        route.continue_()
    except PlaywrightError:
        pass

def money(cents: int) -> str:
    return f"{cents // 100:,}.{cents % 100:02d}"


def half_up(value: Fraction) -> int:
    return floor(value + Fraction(1, 2))


def board_feet(volume: int) -> str:
    hundredths = half_up(Fraction(volume * 1000 * 100, BOARD_FOOT_DIVISOR))
    return f"{hundredths // 100}.{hundredths % 100:02d}"


def price_cents(thickness: int, width: int, take: int, rate: int) -> int:
    return half_up(Fraction(thickness * width * take * rate * 1000, BOARD_FOOT_DIVISOR))


def invoice_lines(price: int, lengths: list[int]) -> list[int]:
    total = sum(lengths)
    base = [price * length // total for length in lengths]
    rems = [price * length % total for length in lengths]
    order = sorted(range(len(lengths)), key=lambda i: (-rems[i], i))
    for i in order[: price - sum(base)]:
        base[i] += 1
    return base


def inches(mm: int) -> str:
    sixteenths = half_up(Fraction(mm * 16) / Fraction("25.4"))
    if sixteenths == 0:
        return "0 in"
    whole, rem = divmod(sixteenths, 16)
    parts = [str(whole)] if whole else []
    if rem:
        frac = Fraction(rem, 16)
        parts.append(f"{frac.numerator}/{frac.denominator}")
    return " ".join(parts) + " in"


def mm_from_in(value: str) -> int:
    return half_up(Fraction(value) * Fraction("25.4"))


def length_text(mm: int, unit: str = "mm") -> str:
    return f"{mm} mm" if unit == "mm" else inches(mm)


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def when(value: str) -> str:
    d = parse_ts(value)
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}, {d.hour:02d}:{d.minute:02d} UTC"


def count_copy(n: int) -> str:
    if n == 0:
        return COPY["no_match"]
    if n == 1:
        return COPY["one_board"]
    return f"{n} boards on the rack"


def chip_name(label: str, length: int, start: int, over: bool = False, unit: str = "mm") -> str:
    name = f"{label}, {length_text(length, unit)} at {length_text(start, unit)}"
    return name + (", over defect" if over else "")


def piece(label: str, length: int, start: int, width: int = 100) -> dict[str, Any]:
    return {"label": label, "length_mm": length, "width_mm": width, "start_mm": start}


def tag_number(tag: str) -> int:
    match = re.fullmatch(r"KW-(\d{4})", tag)
    assert match, tag
    return int(match.group(1))


def outage_url(name: str) -> str:
    url = os.environ.get(name)
    assert url, f"{name} is not set for the verifier"
    return url.rstrip("/")


def api(base: str, who: tuple[str, str] | None = None) -> httpx.Client:
    client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    if who:
        r = client.post("/api/session", json={"email": who[0], "password": who[1]})
        assert r.status_code == 200, r.text
    return client


def api_error(r: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text}"
    body = r.json()
    assert body.get("error") == code, body
    assert isinstance(body.get("message"), str), body
    return body


def field_error(r: httpx.Response, field: str) -> None:
    body = api_error(r, 422, "validation")
    assert field in body.get("fields", {}), body


def tag_board(hand: httpx.Client, *, species: str = "Black walnut", lot: str = "LOT-03", length: int = DEFAULT_SIZE[0], width: int = DEFAULT_SIZE[1], thickness: int = DEFAULT_SIZE[2], defects: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    r = hand.post("/api/boards", json={"lot": lot, "species": species, "length_mm": length, "width_mm": width, "thickness_mm": thickness, "defects": defects or []})
    assert r.status_code == 201, r.text
    return r.json()["board"]


def listed_board(base: str, *, grade: str = "Select", list_it: bool = True, **kw: Any) -> dict[str, Any]:
    hand, owner = api(base, HAND), api(base, OWNER)
    board = tag_board(hand, **kw)
    tag = board["tag"]
    r = owner.post(f"/api/boards/{tag}/grade", json={"grade": grade})
    assert r.status_code == 200, r.text
    if list_it:
        r = owner.post(f"/api/boards/{tag}/list", json={})
        assert r.status_code == 200, r.text
    return owner.get(f"/api/boards/{tag}").json()["board"]


def place_hold(maker: httpx.Client, tag: str, pieces: list[dict[str, Any]] | None = None, key: str | None = None, card: str = CARD) -> httpx.Response:
    return maker.post("/api/holds", json={"board": tag, "pieces": pieces or [PIECE_A], "card_number": card}, headers={"Idempotency-Key": key or idempotency_key()})


def held_hold(base: str, who: tuple[str, str] = INES, pieces: list[dict[str, Any]] | None = None, **board_kw: Any) -> tuple[dict[str, Any], dict[str, Any], httpx.Client]:
    board = listed_board(base, **board_kw)
    maker = api(base, who)
    r = place_hold(maker, board["tag"], pieces)
    assert r.status_code == 201, r.text
    return board, r.json()["hold"], maker


def purchase(maker: httpx.Client, hold_id: str, key: str | None = None) -> httpx.Response:
    return maker.post(f"/api/holds/{hold_id}/purchase", json={}, headers={"Idempotency-Key": key or idempotency_key()})


def make_sale(base: str, who: tuple[str, str] = INES, pieces: list[dict[str, Any]] | None = None, **board_kw: Any) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], httpx.Client]:
    board, hold, maker = held_hold(base, who, pieces, **board_kw)
    r = purchase(maker, hold["id"])
    assert r.status_code == 201, r.text
    return board, hold, r.json()["sale"], maker


def finish_ticket(base: str, ticket: str, measured: int | None = None) -> dict[str, Any]:
    hand = api(base, HAND)
    r = hand.post(f"/api/tickets/{ticket}/start", json={})
    assert r.status_code == 200, r.text
    t = r.json()["ticket"]
    body = {} if t["offcut"] is None else {"offcut_mm": measured if measured is not None else t["offcut"]["planned_mm"]}
    r = hand.post(f"/api/tickets/{ticket}/done", json=body)
    assert r.status_code == 200, r.text
    return r.json()["ticket"]


def api_fit(base: str, tag: str, pieces: list[dict[str, Any]]) -> dict[str, Any]:
    r = httpx.post(f"{base}/api/boards/{tag}/fit", json={"pieces": pieces}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    return r.json()


def rate_in_force(base: str, species: str, grade: str) -> int:
    rates = httpx.get(f"{base}/api/rates", timeout=HTTP_TIMEOUT_S).json()["rates"]
    return next(r["rate_cents"] for r in rates if r["species"] == species and r["grade"] == grade)


def ledger(owner: httpx.Client, account: str) -> list[dict[str, Any]]:
    r = owner.get("/api/ledger", params={"account": account})
    assert r.status_code == 200, r.text
    return r.json()["movements"]


def entries(movement: dict[str, Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    for e in movement["entries"]:
        out[e["account"]] = out.get(e["account"], 0) + e["volume_mm3"]
    return out


def balance(owner: httpx.Client, account: str) -> int:
    return sum(entries(m).get(account, 0) for m in ledger(owner, account))


def race(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def server_clock(owner: httpx.Client, species: str = "Douglas fir", grade: str = "Select") -> tuple[datetime, float]:
    rate = next(r for r in owner.get("/api/rates").json()["rates"] if r["species"] == species and r["grade"] == grade)
    t0 = time.monotonic()
    r = owner.put("/api/rates", json={"species": species, "grade": grade, "rate_cents": rate["rate_cents"]})
    t1 = time.monotonic()
    assert r.status_code == 200, r.text
    return parse_ts(r.json()["rate"]["effective_at"]), (t0 + t1) / 2


def wait_server_time(base: str, clock: tuple[datetime, float], target: datetime) -> None:
    server_then, local_then = clock
    local_target = local_then + (target - server_then).total_seconds()
    assert local_target - time.monotonic() < REAL_WAIT_S * 2, "target too far away"
    while time.monotonic() < local_target:
        httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S)


def wait_for(fn: Callable[[], bool], seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    while not fn():
        assert time.monotonic() < deadline, f"timed out waiting for {what}"


def wait_service(base: str, service: str, state: str, seconds: float = BANNER_MS / 1000) -> None:
    wait_for(lambda: httpx.get(f"{base}/api/services", timeout=HTTP_TIMEOUT_S).json().get(service) == state, seconds, f"{service} {state}")


def kb_payments(killbill: Any, email: str) -> list[dict[str, Any]]:
    account = killbill.account_by_key(email)
    return killbill.payments(account["accountId"]) if account else []


def txns(payment: dict[str, Any], kind: str, status: str = "SUCCESS") -> list[dict[str, Any]]:
    return [t for t in payment.get("transactions") or [] if t.get("transactionType") == kind and t.get("status") == status]


def dollars(cents: int) -> Decimal:
    return Decimal(cents) / 100


def kb_payment(killbill: Any, email: str, payment_id: str) -> dict[str, Any]:
    found = [p for p in kb_payments(killbill, email) if p["paymentId"] == payment_id]
    assert found, f"no Kill Bill payment {payment_id} on {email}'s account"
    return found[0]


def yard_id_of(killbill: Any, email: str, hold: dict[str, Any]) -> str:
    key = kb_payment(killbill, email, hold["killbill_payment_id"])["paymentExternalKey"]
    match = re.fullmatch(r"hold-([0-9a-f]{12})-" + re.escape(hold["id"]), key)
    assert match, key
    return match.group(1)


def success_ids(killbill: Any, emails: list[str], kind: str = "PURCHASE") -> set[str]:
    return {p["paymentId"] for e in emails for p in kb_payments(killbill, e) if txns(p, kind)}


def png_bytes(width: int, height: int, total: int | None = None) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    row = bytes((x * 7) % 256 for x in range(width * 3))
    raw = b"".join(b"\x00" + row for _ in range(height))
    head = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    tail = chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    if total is None:
        return head + tail
    pad = total - len(head) - len(tail) - 12
    return head + chunk(b"tEXt", b"pad\x00" + b"p" * (pad - 4)) + tail


def png_gray(width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    comp = zlib.compressobj(9)
    row = b"\x00" * (width + 1)
    data = b"".join(comp.compress(row) for _ in range(height)) + comp.flush()
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)) + chunk(b"IDAT", data) + chunk(b"IEND", b"")


def png_size(data: bytes) -> tuple[int, int]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", data[16:24])


def png_chunks(data: bytes) -> list[bytes]:
    out, i = [], 8
    while i < len(data):
        length = struct.unpack(">I", data[i : i + 4])[0]
        out.append(data[i + 4 : i + 8])
        i += 12 + length
    return out


JPEG_JS = """([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#0000ff'; g.fillRect(w / 2, 0, w / 2, h); return c.toDataURL('image/jpeg', 0.95).split(',')[1]; }"""
PIXELS_JS = """async ([b64, mime]) => { const img = new Image(); img.src = 'data:' + mime + ';base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data); return {w: img.naturalWidth, h: img.naturalHeight, top: at(c.width >> 1, c.height >> 2), bottom: at(c.width >> 1, (3 * c.height) >> 2)}; }"""


def jpeg_bytes(browser: Browser, width: int, height: int, orientation: int | None = None) -> bytes:
    ctx = browser.new_context()
    try:
        raw = base64.b64decode(ctx.new_page().evaluate(JPEG_JS, [width, height]))
    finally:
        ctx.close()
    if orientation is None:
        return raw
    tiff = b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", 1) + struct.pack("<HHIHH", 0x0112, 3, 1, orientation, 0) + struct.pack("<I", 0)
    payload = b"Exif\x00\x00" + tiff
    return raw[:2] + b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload + raw[2:]


def jpeg_size(data: bytes) -> tuple[int, int]:
    assert data[:3] == b"\xff\xd8\xff"
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01, 0xFF) or 0xD0 <= marker <= 0xD7:
            i += 2 if marker != 0xFF else 1
            continue
        seg = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", data[i + 5 : i + 9])
            return w, h
        i += 2 + seg
    raise AssertionError("no SOF marker")


def pixels(browser: Browser, data: bytes, mime: str) -> dict[str, Any]:
    ctx = browser.new_context()
    try:
        return ctx.new_page().evaluate(PIXELS_JS, [base64.b64encode(data).decode(), mime])
    finally:
        ctx.close()


def is_red(rgba: list[int]) -> bool:
    return rgba[0] > 180 and rgba[2] < 90


def is_blue(rgba: list[int]) -> bool:
    return rgba[2] > 180 and rgba[0] < 90


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def endpoint(url: str) -> tuple[str, int]:
    u = urlsplit(url)
    return u.hostname or "127.0.0.1", u.port or (443 if u.scheme == "https" else 80)


class Relay:

    def __init__(self, url: str) -> None:
        self.target = endpoint(url)
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()

    def start(self) -> None:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.listener = s
        threading.Thread(target=self._serve, args=(s,), daemon=True).start()

    def _serve(self, s: socket.socket) -> None:
        while True:
            try:
                client, _ = s.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.conns += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
        except OSError:
            pass
        finally:
            with suppress(OSError):
                dst.shutdown(socket.SHUT_WR)

    def stop(self) -> None:
        s, self.listener = self.listener, None
        if s is not None:
            with suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)
            s.close()
        with self.lock:
            conns, self.conns = self.conns, []
        for c in conns:
            with suppress(OSError):
                c.shutdown(socket.SHUT_RDWR)
            with suppress(OSError):
                c.close()


def log_tail(log: Any) -> str:
    log.flush()
    return Path(log.name).read_text(errors="replace")[-4000:]


@contextmanager
def app_copy(**overrides: str) -> Iterator[str]:
    port = free_port()
    log = tempfile.NamedTemporaryFile("w+", prefix="kerfwell-copy-", suffix=".log", delete=False)
    proc = serve_copy(port, log, **overrides)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + BOOT_WAIT_S
        while True:
            with suppress(httpx.HTTPError):
                if httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200:
                    break
            with suppress(subprocess.TimeoutExpired):
                proc.wait(timeout=COPY_POLL_S)
            if proc.poll() is not None:
                pytest.fail(f"served copy exited early:\n{log_tail(log)}")
            assert time.monotonic() < deadline, f"served copy never answered health:\n{log_tail(log)}"
        yield base
    finally:
        with suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=HTTP_TIMEOUT_S)
        log.close()


@contextmanager
def relayed_copy(service: str, start_up: bool = True) -> Iterator[tuple[str, Relay]]:
    env_name = "KILLBILL_URL" if service == "billing" else "S3_ENDPOINT"
    relay = Relay(os.environ[env_name])
    if start_up:
        relay.start()
    try:
        with app_copy(**{env_name: f"http://127.0.0.1:{relay.port}"}) as base:
            yield base, relay
    finally:
        relay.stop()


@contextmanager
def app_page(browser: Browser, url: str, size: tuple[int, int] | list[int] = DESKTOP, **options: Any) -> Iterator[Page]:
    with open_app(browser, url, **options) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        yield page


def eventually(page: Page, fn: Callable[[int], None], page_ms: int = ONE_SECOND_MS, step_ms: int = STEP_MS, real_s: float = REAL_WAIT_S) -> None:
    deadline = time.monotonic() + real_s
    spent = 0
    while True:
        try:
            fn(step_ms)
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            if spent < page_ms:
                step = min(step_ms, page_ms - spent)
                advance(page, step)
                spent += step


def shows(page: Page, locator: Any, text: str, page_ms: int = ONE_SECOND_MS, step_ms: int = STEP_MS) -> None:
    eventually(page, lambda t: expect(locator).to_contain_text(text, ignore_case=True, timeout=t), page_ms, step_ms)


def sign_in_page(page: Page, base: str, who: tuple[str, str]) -> None:
    r = page.request.post(f"{base}/api/session", data={"email": who[0], "password": who[1]})
    assert r.status == 200, r.text()


def ui_sign_in(page: Page, base: str, who: tuple[str, str], next_path: str | None = None) -> None:
    if next_path is not None:
        page.goto(f"{base}/sign-in?next={quote(next_path, safe='')}")
    elif urlsplit(page.url).path != "/sign-in":
        page.goto(f"{base}/sign-in")
    fill(page.get_by_role("textbox", name="Email"), who[0])
    fill(page.get_by_label("Password"), who[1])
    click(page.get_by_role("button", name="Sign in", exact=True))
    page.wait_for_url(lambda u: urlsplit(u).path != "/sign-in", timeout=REAL_WAIT_S * 1000)


def wait_board(page: Page, tag: str) -> None:
    expect(page.get_by_role("heading", level=1, name=tag)).to_be_visible(timeout=REAL_WAIT_S * 1000)


def goto_board(page: Page, base: str, tag: str) -> None:
    page.goto(f"{base}/boards/{tag}")
    wait_board(page, tag)


def chip(page: Page, name: str) -> Any:
    return page.get_by_role("group", name="Cut list").get_by_role("button", name=name, exact=True)


def expect_chip(page: Page, name: str, page_ms: int = ONE_SECOND_MS) -> Any:
    loc = chip(page, name)
    eventually(page, lambda t: expect(loc).to_have_count(1, timeout=t), page_ms)
    return loc


def add_piece(page: Page, label: str, length: Any, width: Any) -> None:
    fill(page.get_by_role("textbox", name="Piece label"), label)
    fill(page.get_by_role("textbox", name="Piece length"), str(length))
    fill(page.get_by_role("textbox", name="Piece width"), str(width))
    click(page.get_by_role("button", name="Add piece", exact=True))


def fit_and_hear(page: Page, verdict: str) -> None:
    click(page.get_by_role("button", name="Fit check", exact=True))
    shows(page, page.get_by_role("status", name="Fit result"), verdict)


def layout_ready_to_hold(page: Page, base: str, tag: str, pieces: list[dict[str, Any]]) -> None:
    for p in pieces:
        add_piece(page, p["label"], p["length_mm"], p["width_mm"])
        expect_chip(page, chip_name(p["label"], p["length_mm"], p["start_mm"]))
    fit_and_hear(page, api_fit(base, tag, pieces)["verdict"])
    hold_button = page.get_by_role("button", name="Hold board", exact=True)
    eventually(page, lambda t: expect(hold_button).to_be_enabled(timeout=t))


def body_text(page: Page) -> str:
    return page.evaluate("document.body.innerText")


SEEK_JS = """() => { const s = {v: 0, made: new Map(), smil: new Map()}; window.__step = (ms) => { s.v += ms; for (const a of document.getAnimations()) { if (!s.made.has(a)) s.made.set(a, s.v - ms); const t = s.v - s.made.get(a); const end = a.effect ? a.effect.getComputedTiming().endTime : 0; if (t >= end) { a.finish(); } else { a.pause(); a.currentTime = t; } } for (const g of Array.from(document.getElementsByTagName('svg'))) { if (typeof g.pauseAnimations !== 'function') continue; if (!s.smil.has(g)) { g.pauseAnimations(); s.smil.set(g, g.getCurrentTime() * 1000 - (s.v - ms)); } g.setCurrentTime((s.smil.get(g) + s.v) / 1000); } }; }"""
ANALYSE_JS = """async ({imgs, delta, cols, colRef, masks}) => { const data = []; for (const b of imgs) { const im = new Image(); im.src = 'data:image/png;base64,' + b; await im.decode(); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext('2d'); g.drawImage(im, 0, 0); data.push({w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data}); } const diff = (A, B, x, y) => { const i = (y * A.w + x) * 4; return Math.max(Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]), Math.abs(A.d[i + 2] - B.d[i + 2])); }; const R = data[colRef]; const columns = data.map((F) => cols.map((xs) => { let n = 0; for (let y = 0; y < F.h; y++) if (xs.some((x) => x >= 0 && x < F.w && diff(F, R, x, y) > delta)) n++; return n; })); const regions = masks.map((m) => { const A = data[m.a], B = data[m.b], Ref = data[m.ref]; const pts = []; for (let y = 0; y < A.h; y++) for (let x = Math.max(0, m.x0); x < Math.min(A.w, m.x1); x++) if (diff(A, B, x, y) > delta) pts.push([x, y]); return {n: pts.length, series: data.map((F) => pts.length ? pts.reduce((s, [x, y]) => s + diff(F, Ref, x, y), 0) / pts.length : 0)}; }); return {w: data.map((d) => d.w), h: data.map((d) => d.h), columns, regions}; }"""


def analyse(browser: Browser, shots: list[bytes], cols: list[list[int]], col_ref: int, masks: list[dict[str, int]]) -> dict[str, Any]:
    ctx = browser.new_context()
    try:
        return ctx.new_page().evaluate(ANALYSE_JS, {"imgs": [base64.b64encode(s).decode() for s in shots], "delta": PIXEL_DELTA, "cols": cols, "colRef": col_ref, "masks": masks})
    finally:
        ctx.close()


def ramp(norms: list[float], start_ok: Callable[[float], bool], end_ok: Callable[[float], bool]) -> tuple[int, int]:
    begin = max((i for i, v in enumerate(norms) if start_ok(v)), default=-1)
    end = next((i for i in range(begin + 1, len(norms)) if end_ok(norms[i])), None)
    assert end is not None, norms
    return (begin + 1) * MOTION_STEP_MS, (end + 1) * MOTION_STEP_MS


def svg_items(svg: Any, attr: str) -> list[dict[str, Any]]:
    return svg.evaluate(
        """(svg, attr) => { const r = svg.getBoundingClientRect(); const out = []; const walk = (n) => { for (const c of n.children) { if (c.hasAttribute(attr)) { const b = c.getBoundingClientRect(); out.push({value: c.getAttribute(attr), x: b.left - r.left, w: b.width, cx: b.left + b.width / 2 - r.left, opacity: Number(getComputedStyle(c).opacity)}); } walk(c); } }; walk(svg); return out; }""",
        attr,
    )


def near(actual: float, expected: float, tol: float = HALF_PX) -> bool:
    return abs(actual - expected) <= tol


TOP_AT_CENTER_JS = """(el) => { el.scrollIntoView({block: 'center', inline: 'center'}); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (!t) return false; if (t === el || el.contains(t)) return true; return !!(el.labels && Array.from(el.labels).some((l) => l === t || l.contains(t))); }"""
CARD_JS = """(link) => { const boardLinks = (n) => Array.from(n.getElementsByTagName('a')).filter((a) => (a.getAttribute('href') || '').startsWith('/boards/')).length; let card = link; while (card.parentElement && boardLinks(card.parentElement) === 1) card = card.parentElement; return card; }"""
BUTTON_IN_JS = """([root, name]) => Array.from(root.getElementsByTagName('button')).find((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === name) || null"""


def hold_card(page: Page, tag: str) -> Any:
    return page.get_by_role("link", name=tag, exact=True).first.evaluate_handle(CARD_JS).as_element()


def card_text(page: Page, tag: str) -> str:
    return hold_card(page, tag).evaluate("(c) => c.innerText")


def card_button(page: Page, tag: str, name: str) -> Any:
    return page.evaluate_handle(BUTTON_IN_JS, [hold_card(page, tag), name]).as_element()


def card_shows(page: Page, tag: str, text: str, page_ms: int = ONE_SECOND_MS, step_ms: int = STEP_MS, present: bool = True) -> None:
    def probe(_: int) -> None:
        try:
            found = text.lower() in card_text(page, tag).lower()
        except Exception as exc:
            raise AssertionError(str(exc)) from exc
        assert found == present, f"{text!r} {'missing from' if present else 'still in'} card {tag}"

    eventually(page, probe, page_ms, step_ms)


def strip_point(svg: Any, mm: float) -> tuple[float, float]:
    svg.scroll_into_view_if_needed()
    scale = float(svg.get_attribute("data-scale"))
    box = svg.bounding_box()
    return box["x"] + mm * scale, box["y"] + box["height"] / 2


def mouse_drag(page: Page, x0: float, y: float, x1: float) -> None:
    page.mouse.move(x0, y)
    page.mouse.down()
    page.mouse.move(x1, y, steps=6)
    page.mouse.up()


def touch_drag(page: Page, x0: float, y: float, x1: float) -> None:
    cdp = session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y}]})
    for i in range(1, 7):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * i / 6, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def open_yard(page: Page, base: str) -> None:
    page.goto(f"{base}/yard")
    expect(page.get_by_role("button", name="Tag board", exact=True)).to_be_visible(timeout=REAL_WAIT_S * 1000)


def defect_sheet(page: Page) -> Any:
    return page.get_by_role("dialog", name="Defect kind")


def mark_zone(page: Page, start_mm: int, end_mm: int, kind: str, touch: bool = False) -> None:
    strip = page.get_by_role("img", name="Intake strip")
    x0, y = strip_point(strip, start_mm)
    x1, _ = strip_point(strip, end_mm)
    (touch_drag if touch else mouse_drag)(page, x0, y, x1)
    sheet = defect_sheet(page)
    eventually(page, lambda t: expect(sheet).to_be_visible(timeout=t))
    button = sheet.get_by_role("button", name=kind, exact=True)
    tap(button) if touch else click(button)


def stock_cells(page: Page, header: str) -> list[str]:
    row = page.get_by_role("table", name="Stock on hand").get_by_role("row").filter(has_text=header).first
    return [c.strip() for c in row.get_by_role("cell").all_inner_texts()][-5:]


def stock_expected(row: dict[str, Any]) -> list[str]:
    return [str(row["open_boards"]), str(row["on_rack"]), str(row["held"]), str(row["volume_mm3"]), row["board_feet"]]


def test_wf_cross_cutting_health(app_url):
    for base in (app_url, outage_url("APP_KILLBILL_DOWN_URL"), outage_url("APP_MINIO_DOWN_URL")):
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, (base, r.text)
    with app_copy() as copy:
        r = httpx.get(f"{copy}/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}


def table_counts() -> dict[str, int]:
    pg = Postgres()
    out = {}
    for name in pg.tables():
        if "." not in name:
            continue
        schema, table = name.split(".", 1)
        out[name] = pg.rows(f'SELECT count(*) AS n FROM "{schema}"."{table}"')[0]["n"]
    return out


def test_wf_cross_cutting_seed(app_url):
    short = outage_url("APP_SHORT_URL")
    owner = api(short, OWNER)
    board = owner.get(f"/api/boards/{GRADED_TAG}").json()["board"]
    assert (board["status"], board["species"], board["grade"], board["lot"]["id"]) == ("graded", "Douglas fir", "Character", "LOT-02")
    assert (board["length_mm"], board["width_mm"], board["thickness_mm"]) == (3000, 185, 45)
    lots = {l["id"]: l["name"] for l in httpx.get(f"{short}/api/lots", timeout=HTTP_TIMEOUT_S).json()["lots"]}
    assert all(lots.get(k) == v for k, v in LOTS.items()), lots
    rates = httpx.get(f"{short}/api/rates", timeout=HTTP_TIMEOUT_S).json()["rates"]
    assert len(rates) == 15
    kw1 = httpx.get(f"{short}/api/boards/KW-0001", timeout=HTTP_TIMEOUT_S).json()["board"]
    assert (kw1["length_mm"], kw1["width_mm"], kw1["thickness_mm"]) == KW1_SIZE
    for who in (HAND, INES, JOEL, RUTH):
        api(short, who)
    before = table_counts()
    assert before, "observer sees no tables"
    with app_copy() as copy:
        after = table_counts()
        assert after == before, {k: (before.get(k), after.get(k)) for k in set(before) | set(after) if before.get(k) != after.get(k)}
        assert api(copy, OWNER).get(f"/api/boards/{GRADED_TAG}").json()["board"]["status"] == "graded"


@pytest.mark.parametrize("case", BOUNDARY_CASES, ids=BOUNDARY_CASES)
def test_server_boundary(app_url, case):
    anon = api(app_url)
    if case == "cross-origin":
        api_error(anon.post("/api/boards", json={}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
        api_error(api(app_url, OWNER).put("/api/rates", json={}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    elif case == "bad-json":
        api_error(anon.post("/api/boards", content=b"{", headers={"Content-Type": "application/json"}), 400, "bad_json")
    elif case == "content-type":
        api_error(anon.post("/api/session", content=b"email=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    elif case == "json-limit":
        def body(size: int) -> bytes:
            stem = b'{"email":"nobody@kerfwell.test","password":"'
            return stem + b"x" * (size - len(stem) - 2) + b'"}'
        api_error(anon.post("/api/session", content=body(JSON_LIMIT), headers={"Content-Type": "application/json"}), 401, "invalid_credentials")
        api_error(anon.post("/api/session", content=body(JSON_LIMIT + 1), headers={"Content-Type": "application/json"}), 413, "too_large")
    elif case == "photo-limit":
        hand = api(app_url, HAND)
        tag = tag_board(hand)["tag"]
        ok = hand.post(f"/api/boards/{tag}/photos", content=png_bytes(32, 32, PHOTO_LIMIT), headers={"Content-Type": "image/png"})
        assert ok.status_code == 201, ok.text
        api_error(anon.post(f"/api/boards/{tag}/photos", content=png_bytes(32, 32, PHOTO_LIMIT + 1), headers={"Content-Type": "image/png"}), 413, "too_large")
    elif case == "unauthenticated":
        api_error(anon.get("/api/stock"), 401, "unauthenticated")
        api_error(anon.post("/api/holds", json={}), 401, "unauthenticated")
    elif case == "not-found-before-forbidden":
        _, hold, _ = held_hold(app_url)
        hand = api(app_url, HAND)
        api_error(hand.post("/api/holds/H-9999/cancel", json={}), 404, "not_found")
        api_error(hand.post(f"/api/holds/{hold['id']}/cancel", json={}), 403, "forbidden")
        api_error(anon.get("/api/no-such-route"), 404, "not_found")
    elif case == "never-served":
        for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/node_modules/.package-lock.json", "/src/server.ts", "/THIRD_PARTY_NOTICES.md"):
            r = anon.get(path)
            assert r.status_code == 404, (path, r.status_code)
    elif case == "no-cors":
        r = anon.get("/api/health", headers={"Origin": FOREIGN_ORIGIN})
        assert not any(h.lower().startswith("access-control-") for h in r.headers), dict(r.headers)


def test_sign_in_and_roles(app_url):
    anon = api(app_url)
    api_error(anon.post("/api/session", json={"email": INES[0], "password": "wrong"}), 401, "invalid_credentials")
    api_error(anon.get("/api/session"), 401, "unauthenticated")
    raw = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    r = raw.post("/api/session", json={"email": INES[0], "password": INES[1]})
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "maker" and r.json()["user"]["name"] == NAME[INES[0]]
    cookie = next(c for c in r.headers.get_list("set-cookie") if c.startswith("kerfwell_session="))
    assert all(flag.lower() in cookie.lower() for flag in COOKIE_FLAGS)
    value = raw.cookies.get("kerfwell_session")
    assert set(raw.get("/api/session").json()["user"]) == {"id", "name", "email", "role"}
    assert raw.delete("/api/session").status_code == 204
    replay = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, cookies={"kerfwell_session": value})
    api_error(replay.get("/api/session"), 401, "unauthenticated")
    for who, role in ((OWNER, "owner"), (HAND, "hand")):
        assert api(app_url, who).get("/api/session").json()["user"]["role"] == role
    maker, hand, owner = api(app_url, INES), api(app_url, HAND), api(app_url, OWNER)
    api_error(maker.post("/api/boards", json={}), 403, "forbidden")
    api_error(hand.post(f"/api/boards/{GRADED_TAG}/grade", json={"grade": "Select"}), 403, "forbidden")
    api_error(hand.get("/api/ledger"), 403, "forbidden")
    api_error(maker.get("/api/stock"), 403, "forbidden")
    api_error(maker.get(f"/api/boards/{EX_TAG}/lineage"), 403, "forbidden")
    api_error(owner.post("/api/holds", json={"board": "KW-0001", "pieces": [PIECE_A], "card_number": CARD}, headers={"Idempotency-Key": idempotency_key()}), 403, "forbidden")
    api_error(hand.get("/api/holds"), 403, "forbidden")
    api_error(hand.get("/api/invoices"), 403, "forbidden")
    _, _, sale, _ = make_sale(app_url)
    hold_id = next(h["id"] for h in maker.get("/api/holds").json()["holds"] if h["board"] == sale["board"])
    api_error(hand.get("/api/holds/H-9999"), 404, "not_found")
    api_error(hand.get(f"/api/holds/{hold_id}"), 403, "forbidden")
    api_error(hand.get("/api/invoices/INV-9999"), 404, "not_found")
    api_error(hand.get(f"/api/invoices/{sale['invoice']}"), 403, "forbidden")
    assert owner.get(f"/api/holds/{hold_id}").status_code == 200
    assert hand.get(f"/api/tickets/{sale['ticket']}").status_code == 200


def test_maker_records_private(browser, app_url):
    _, hold, sale, ines = make_sale(app_url)
    joel, hand, owner = api(app_url, JOEL), api(app_url, HAND), api(app_url, OWNER)
    pairs = [(f"/api/holds/{hold['id']}", "/api/holds/H-9999"), (f"/api/invoices/{sale['invoice']}", "/api/invoices/INV-9999"), (f"/api/tickets/{sale['ticket']}", "/api/tickets/CT-9999"), (f"/api/tickets/{sale['ticket']}/pdf", "/api/tickets/CT-9999/pdf")]
    for real, missing in pairs:
        a, b = joel.get(real), joel.get(missing)
        assert a.status_code == b.status_code == 404, (real, a.text)
        assert a.json()["error"] == b.json()["error"] == "not_found" and set(a.json()) == set(b.json())
        assert ines.get(real).status_code == 200
    assert hold["id"] not in {h["id"] for h in joel.get("/api/holds").json()["holds"]}
    assert sale["ticket"] not in {t["id"] for t in joel.get("/api/tickets").json()["tickets"]}
    assert hand.get(f"/api/tickets/{sale['ticket']}/pdf").status_code == 200
    assert owner.get(f"/api/holds/{hold['id']}").status_code == 200 and owner.get(f"/api/invoices/{sale['invoice']}").status_code == 200
    with app_page(browser, app_url) as page:
        sign_in_page(page, app_url, JOEL)
        texts = []
        for path in (f"/tickets/{sale['ticket']}", "/tickets/CT-9999"):
            page.goto(app_url + path)
            expect(page.get_by_role("heading", level=1, name=COPY["not_found_heading"])).to_be_visible(timeout=REAL_WAIT_S * 1000)
            expect(page.get_by_role("main").or_(page.locator("body")).first).to_contain_text(COPY["not_found_text"])
            expect(page.get_by_role("link", name="Back to the rack")).to_be_visible()
            texts.append(page.get_by_role("heading", level=1).inner_text())
        assert texts[0] == texts[1]


def test_wf_account_lists(browser, app_url):
    _, active, _ = held_hold(app_url)
    _, bought, sale, ines = make_sale(app_url, pieces=EX_PIECES, length=KW1_SIZE[0], width=KW1_SIZE[1], thickness=KW1_SIZE[2], species="White oak", grade="Character", lot="LOT-01", defects=KW1_DEFECTS)
    invoice = ines.get(f"/api/invoices/{sale['invoice']}").json()["invoice"]
    with app_page(browser, app_url) as page:
        page.goto(f"{app_url}/sign-in")
        ui_sign_in(page, app_url, INES)
        page.goto(f"{app_url}/account")
        for heading in ("Holds", "Cut tickets", "Invoices"):
            expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible(timeout=REAL_WAIT_S * 1000)
        link = page.get_by_role("link", name=active["board"], exact=True).first
        expect(link).to_have_attribute("href", re.compile(f"/boards/{re.escape(active['board'])}$"))
        card_shows(page, active["board"], "Held")
        card_shows(page, active["board"], f"Held until {when(active['expires_at'])}")
        assert card_button(page, active["board"], "Pay and cut") and card_button(page, active["board"], "Cancel hold")
        card_shows(page, bought["board"], "Bought")
        ticket_link = page.get_by_role("link", name=sale["ticket"], exact=True)
        expect(ticket_link).to_have_attribute("href", re.compile(f"/tickets/{sale['ticket']}$"))
        lines = page.get_by_role("list", name=f"Lines on {sale['invoice']}")
        items = lines.get_by_role("listitem")
        expect(items).to_have_count(2)
        expect(items.nth(0)).to_contain_text(f"Shelf A ${money(EX_LINES[0])}")
        expect(items.nth(1)).to_contain_text(f"Shelf B ${money(EX_LINES[1])}")
        text = body_text(page)
        for cents in (EX_PRICE, DEPOSIT_CENTS, EX_AMOUNT):
            assert money(cents) in text
        assert sale["invoice"] in text and "Paid" in text
    assert invoice["price_cents"] == EX_PRICE and [l["amount_cents"] for l in invoice["lines"]] == EX_LINES


def test_wf_account_skewed_clock(browser, app_url):
    _, hold, _ = held_hold(app_url)
    real_now = parse_ts(hold["held_at"])
    for skew in (timedelta(days=3), -timedelta(days=3)):
        with app_page(browser, app_url) as page:
            sign_in_page(page, app_url, INES)
            page.clock.set_system_time(real_now + skew)
            page.goto(f"{app_url}/account")
            card_shows(page, hold["board"], f"Held until {when(hold['expires_at'])}", page_ms=TWO_SECONDS_MS)
            for name in ("Pay and cut", "Cancel hold"):
                btn = card_button(page, hold["board"], name)
                assert btn and btn.is_enabled() and btn.get_attribute("aria-disabled") != "true"
    short = outage_url("APP_SHORT_URL")
    clock = server_clock(api(short, OWNER))
    _, short_hold, _ = held_hold(short)
    with app_page(browser, short) as page:
        sign_in_page(page, short, INES)
        page.clock.set_system_time(parse_ts(short_hold["held_at"]) - timedelta(days=3))
        page.goto(f"{short}/account")
        page.evaluate("window.__kerfwellProbe = 1")
        wait_server_time(short, clock, parse_ts(short_hold["expires_at"]) + timedelta(seconds=UNTOUCHED_GRACE_S))
        card_shows(page, short_hold["board"], COPY["expired"], page_ms=EXPIRED_LABEL_MS, step_ms=LONG_STEP_MS)
        card_shows(page, short_hold["board"], "Expired")
        assert card_button(page, short_hold["board"], "Pay and cut") is None
        assert card_button(page, short_hold["board"], "Cancel hold") is None
        assert page.evaluate("window.__kerfwellProbe") == 1
    r = api(short, INES).get(f"/api/holds/{short_hold['id']}").json()["hold"]
    assert (r["status"], r["release_reason"]) == ("released", "expired")


def test_holder_privacy(app_url):
    board, hold, ines = held_hold(app_url)
    tag = board["tag"]
    secrets_ = [hold["id"], INES[0], hold["expires_at"], hold["killbill_payment_id"]]
    own = ines.get(f"/api/boards/{tag}").json()["board"]
    assert own["my_hold"]["id"] == hold["id"] and set(own["my_hold"]) == HOLD_KEYS
    for client in (api(app_url), api(app_url, JOEL), api(app_url, HAND), api(app_url, OWNER)):
        r = client.get(f"/api/boards/{tag}")
        b = r.json()["board"]
        assert set(b) == BOARD_KEYS and b["my_hold"] is None and b["status"] == "held"
        assert not any(s in r.text for s in secrets_), r.text
        listing = client.get("/api/boards", params={"lot": board["lot"]["id"]})
        assert all(set(x) == SUMMARY_KEYS for x in listing.json()["boards"])
        assert not any(s in listing.text for s in secrets_)
    lineage = api(app_url, HAND).get(f"/api/boards/{tag}/lineage")
    assert not any(s in lineage.text for s in secrets_)
    owner_view = api(app_url, OWNER).get("/api/holds").json()["holds"]
    mine = next(h for h in owner_view if h["id"] == hold["id"])
    assert mine["maker"] == {"name": NAME[INES[0]]}
    assert INES[0] not in json.dumps(owner_view)
    assert "maker" not in ines.get(f"/api/holds/{hold['id']}").json()["hold"]


def test_board_intake(app_url):
    hand, owner = api(app_url, HAND), api(app_url, OWNER)
    length = LENGTH_RANGE[0] + 1000 + secrets.randbelow(5000)
    width, thickness = 333, 33
    good = {"lot": "LOT-02", "species": "Heart pine", "length_mm": length, "width_mm": width, "thickness_mm": thickness, "defects": [{"kind": "check", "start_mm": 0, "end_mm": 120}]}
    bad = [
        ({"length_mm": LENGTH_RANGE[0] - 1}, "length_mm"), ({"length_mm": LENGTH_RANGE[1] + 1}, "length_mm"),
        ({"width_mm": WIDTH_RANGE[0] - 1}, "width_mm"), ({"width_mm": WIDTH_RANGE[1] + 1}, "width_mm"),
        ({"thickness_mm": THICKNESS_RANGE[0] - 1}, "thickness_mm"), ({"thickness_mm": THICKNESS_RANGE[1] + 1}, "thickness_mm"),
        ({"species": "Teak"}, "species"),
        ({"defects": [{"kind": "knot", "start_mm": 10, "end_mm": 20}]}, "defects.0"),
        ({"defects": [{"kind": "check", "start_mm": 0, "end_mm": 10}, {"kind": "check", "start_mm": 50, "end_mm": 50}]}, "defects.1"),
        ({"defects": [{"kind": "check", "start_mm": 10, "end_mm": length + 1}]}, "defects.0"),
        ({"defects": [{"kind": "check", "start_mm": i, "end_mm": i + 1} for i in range(MAX_DEFECTS + 1)]}, "defects"),
    ]
    for change, field in bad:
        field_error(hand.post("/api/boards", json={**good, **change}), field)
    api_error(hand.post("/api/boards", json={**good, "lot": "LOT-99"}), 404, "not_found")
    tagged = owner.get("/api/boards", params={"status": "tagged"}).json()["boards"]
    assert not [b for b in tagged if (b["length_mm"], b["width_mm"], b["thickness_mm"]) == (length, width, thickness)]
    r = hand.post("/api/boards", json=good)
    assert r.status_code == 201, r.text
    b = r.json()["board"]
    assert b["status"] == "tagged" and b["grade"] is None and tag_number(b["tag"]) >= FIRST_TAG
    assert (b["length_mm"], b["width_mm"], b["thickness_mm"]) == (length, width, thickness)
    assert b["defects"] == good["defects"] and b["volume_mm3"] == length * width * thickness
    moves = ledger(owner, f"board:{b['tag']}")
    assert len(moves) == 1 and moves[0]["kind"] == "intake" and moves[0]["ticket"] is None
    assert moves[0]["by"] == {"name": NAME[HAND[0]]}
    assert entries(moves[0]) == {"intake": -b["volume_mm3"], f"board:{b['tag']}": b["volume_mm3"]}
    edge = hand.post("/api/boards", json={**good, "length_mm": LENGTH_RANGE[0], "width_mm": WIDTH_RANGE[1], "thickness_mm": THICKNESS_RANGE[0], "defects": []})
    assert edge.status_code == 201, edge.text


def test_board_photos(browser, app_url):
    hand, owner = api(app_url, HAND), api(app_url, OWNER)
    tag = tag_board(hand)["tag"]
    body = png_bytes(64, 48)
    r = hand.post(f"/api/boards/{tag}/photos", content=body, headers={"Content-Type": "image/png"})
    assert r.status_code == 201, r.text
    photo = r.json()["photo"]
    pid = photo["id"]
    assert re.fullmatch(r"PH-\d{4}", pid)
    assert (photo["url"], photo["thumb_url"]) == (f"/api/photos/{pid}", f"/api/photos/{pid}/thumb")
    prefix = f"photos/{tag}/{pid}/"
    assert photo["key"] == prefix + "original.png"
    s3 = S3()
    assert set(s3.keys(prefix)) == {prefix + "original.png", prefix + "display.png", prefix + "thumb.png"}
    assert s3.get(prefix + "original.png") == body
    for client in (hand, owner):
        o = client.get(f"/api/photos/{pid}/original")
        assert o.status_code == 200 and o.content == body
        assert o.headers["content-type"].startswith("image/png") and o.headers.get("x-content-type-options") == "nosniff"
    api_error(api(app_url, INES).get(f"/api/photos/{pid}/original"), 404, "not_found")
    owner.post(f"/api/boards/{tag}/grade", json={"grade": "Select"})
    owner.post(f"/api/boards/{tag}/list", json={})
    display = httpx.get(f"{app_url}/api/photos/{pid}", timeout=HTTP_TIMEOUT_S)
    assert display.status_code == 200 and display.content == s3.get(prefix + "display.png")
    assert display.headers.get("x-content-type-options") == "nosniff" and png_size(display.content) == (64, 48)
    thumb = httpx.get(f"{app_url}/api/photos/{pid}/thumb", timeout=HTTP_TIMEOUT_S)
    assert thumb.status_code == 200 and thumb.content == s3.get(prefix + "thumb.png")
    board = owner.get(f"/api/boards/{tag}").json()["board"]
    assert [set(p) for p in board["photos"]] == [PHOTO_KEYS] and board["photos"][0]["width"] == 64
    with app_page(browser, f"{app_url}/boards/{tag}") as page:
        img = page.get_by_role("img", name=f"Photo 1 of {tag}")
        expect(img).to_be_visible(timeout=REAL_WAIT_S * 1000)
        wait_for(lambda: img.evaluate("(i) => i.complete && i.naturalWidth") == 64, REAL_WAIT_S, "photo decoded")
    for i in range(MAX_PHOTOS - 1):
        assert hand.post(f"/api/boards/{tag}/photos", content=png_bytes(8, 8), headers={"Content-Type": "image/png"}).status_code == 201
    field_error(hand.post(f"/api/boards/{tag}/photos", content=png_bytes(8, 8), headers={"Content-Type": "image/png"}), "photo")
    other = tag_board(hand)["tag"]
    field_error(hand.post(f"/api/boards/{other}/photos", content=b"\x89PNG\r\n\x1a\n" + b"garbage", headers={"Content-Type": "image/png"}), "photo")
    field_error(hand.post(f"/api/boards/{other}/photos", content=png_gray(PIXEL_LIMIT // 1000 + 1, 1000), headers={"Content-Type": "image/png"}), "photo")
    assert hand.post(f"/api/boards/{other}/photos", content=png_gray(PIXEL_LIMIT // 1000, 1000), headers={"Content-Type": "image/png"}).status_code == 201


def test_upright_photos(browser, app_url):
    hand = api(app_url, HAND)
    tag = tag_board(hand)["tag"]
    body = jpeg_bytes(browser, 400, 200, orientation=6)
    r = hand.post(f"/api/boards/{tag}/photos", content=body, headers={"Content-Type": "image/jpeg"})
    assert r.status_code == 201, r.text
    photo = r.json()["photo"]
    assert (photo["width"], photo["height"]) == (200, 400)
    prefix = f"photos/{tag}/{photo['id']}/"
    s3 = S3()
    display, thumb = s3.get(prefix + "display.jpg"), s3.get(prefix + "thumb.jpg")
    assert s3.get(prefix + "original.jpg") == body and b"Exif\x00\x00" in body
    assert jpeg_size(display) == (200, 400) and b"Exif\x00\x00" not in display
    assert jpeg_size(thumb) == (200 * THUMB_EDGE // 400, THUMB_EDGE) and b"Exif\x00\x00" not in thumb
    seen = pixels(browser, display, "image/jpeg")
    assert is_red(seen["top"]) and is_blue(seen["bottom"]), seen
    assert hand.get(f"/api/photos/{photo['id']}/original").content == body
    api_error(api(app_url, INES).get(f"/api/photos/{photo['id']}/original"), 404, "not_found")


def test_wf_intake_touch_defects(browser, app_url):
    with app_page(browser, app_url, PHONE, touch=True) as page:
        sign_in_page(page, app_url, HAND)
        open_yard(page, app_url)
        fill(page.get_by_role("textbox", name="Length (mm)"), "2000")
        mark_zone(page, 610, 640, "Nail hole", touch=True)
        mark_zone(page, 1720, 1500, "Check", touch=True)
        zones = page.get_by_role("list", name="Defect zones")
        shows(page, zones, "nail hole 610–640 mm")
        shows(page, zones, "check 1500–1720 mm")
        strip = page.get_by_role("img", name="Intake strip")
        scale = float(strip.get_attribute("data-scale"))
        found = sorted(svg_items(strip, "data-defect"), key=lambda z: z["x"])
        assert [z["value"] for z in found] == ["nail hole", "check"]
        for z, (a, b) in zip(found, ((610, 640), (1500, 1720))):
            assert near(z["x"], a * scale) and near(z["w"], (b - a) * scale), (z, scale)


def test_wf_intake_phone_tag(browser, app_url):
    photo = jpeg_bytes(browser, 400, 200, orientation=6)
    with app_page(browser, app_url, PHONE, touch=True) as page:
        page.goto(f"{app_url}/sign-in")
        ui_sign_in(page, app_url, HAND)
        open_yard(page, app_url)
        select(page.get_by_role("combobox", name="Lot"), LOTS["LOT-01"])
        select(page.get_by_role("combobox", name="Species"), "White oak")
        fill(page.get_by_role("textbox", name="Length (mm)"), "2440")
        fill(page.get_by_role("textbox", name="Width (mm)"), "190")
        fill(page.get_by_role("textbox", name="Thickness (mm)"), "32")
        mark_zone(page, 610, 640, "Nail hole", touch=True)
        mark_zone(page, 1500, 1720, "Check", touch=True)
        page.get_by_label("Board photos").set_input_files(files=[{"name": "side.jpg", "mimeType": "image/jpeg", "buffer": photo}])
        tap(page.get_by_role("button", name="Tag board", exact=True))
        status = page.get_by_role("status", name="Intake status")
        shows(page, status, "Tagged KW-")
        text = status.inner_text()
        assert COPY["photos_not_saved"] not in text
        tag = re.search(r"Tagged (KW-\d{4})\.", text).group(1)
    board = api(app_url, HAND).get(f"/api/boards/{tag}").json()["board"]
    assert board["status"] == "tagged" and (board["length_mm"], board["width_mm"], board["thickness_mm"]) == KW1_SIZE
    assert {(d["kind"], d["start_mm"], d["end_mm"]) for d in board["defects"]} == {("nail hole", 610, 640), ("check", 1500, 1720)}
    assert len(board["photos"]) == 1 and board["photos"][0]["height"] > board["photos"][0]["width"]
    assert len(S3().keys(f"photos/{tag}/")) == 3
    with app_page(browser, app_url) as page:
        sign_in_page(page, app_url, OWNER)
        page.goto(f"{app_url}/owner")
        expect(page.get_by_role("combobox", name=f"Grade for {tag}")).to_be_visible(timeout=REAL_WAIT_S * 1000)
        thumb = page.get_by_role("img", name=f"Thumbnail of {tag}")
        expect(thumb).to_be_visible()
        wait_for(lambda: thumb.evaluate("(i) => i.complete && i.naturalHeight > i.naturalWidth"), REAL_WAIT_S, "upright thumbnail")


def test_wf_intake_bad_photo(browser, app_url):
    hand = api(app_url, HAND)
    tag = tag_board(hand)["tag"]
    jpeg_sig, png_sig = b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n"
    cases = [("image/png", jpeg_sig + b"\x00" * 64), ("image/jpeg", png_bytes(8, 8)), ("image/jpeg", b"GIF89a" + b"\x00" * 64), ("image/png", png_sig[:4] + b"\x00" * 64)]
    for mime, body in cases:
        api_error(hand.post(f"/api/boards/{tag}/photos", content=body, headers={"Content-Type": mime}), 415, "unsupported_media_type")
    assert S3().keys(f"photos/{tag}/") == []
    assert hand.get(f"/api/boards/{tag}").json()["board"]["photos"] == []
    with app_page(browser, app_url) as page:
        sign_in_page(page, app_url, HAND)
        open_yard(page, app_url)
        select(page.get_by_role("combobox", name="Lot"), LOTS["LOT-02"])
        select(page.get_by_role("combobox", name="Species"), "Douglas fir")
        fill(page.get_by_role("textbox", name="Length (mm)"), "1500")
        fill(page.get_by_role("textbox", name="Width (mm)"), "150")
        fill(page.get_by_role("textbox", name="Thickness (mm)"), "30")
        page.get_by_label("Board photos").set_input_files(files=[{"name": "board.jpg", "mimeType": "image/jpeg", "buffer": b"not really a jpeg"}])
        click(page.get_by_role("button", name="Tag board", exact=True))
        status = page.get_by_role("status", name="Intake status")
        shows(page, status, COPY["photos_not_saved"])
        new_tag = re.search(r"Tagged (KW-\d{4})\.", status.inner_text()).group(1)
    assert hand.get(f"/api/boards/{new_tag}").json()["board"]["status"] == "tagged"
    assert S3().keys(f"photos/{new_tag}/") == []


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_wf_intake_overlays(browser, app_url, viewport):
    w, h = VIEWPORTS[viewport]
    base = outage_url("APP_MINIO_DOWN_URL")
    with app_page(browser, base, (w, h)) as page:
        sign_in_page(page, base, HAND)
        open_yard(page, base)
        shows(page, page.get_by_role("status", name="Service notice"), COPY["storage_banner"], page_ms=BANNER_MS, step_ms=LONG_STEP_MS)
        fill(page.get_by_role("textbox", name="Length (mm)"), "2000")
        strip = page.get_by_role("img", name="Intake strip")
        x0, y = strip_point(strip, 600)
        x1, _ = strip_point(strip, 900)
        mouse_drag(page, x0, y, x1)
        sheet = defect_sheet(page)
        eventually(page, lambda t: expect(sheet).to_be_visible(timeout=t))
        advance(page, ONE_SECOND_MS)
        box = sheet.bounding_box()
        assert box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= w + HALF_PX and box["y"] + box["height"] <= h + HALF_PX, box
        if w == PHONE[0]:
            assert box["y"] + box["height"] >= h - 1
        for kind in ("Nail hole", "Check", "Bolt hole"):
            assert sheet.get_by_role("button", name=kind, exact=True).evaluate(TOP_AT_CENTER_JS), kind
        click(sheet.get_by_role("button", name="Nail hole", exact=True))
        advance(page, ONE_SECOND_MS)
        for loc in (page.get_by_role("button", name="Tag board", exact=True), strip, page.get_by_role("button", name="Sign out", exact=True)):
            assert loc.evaluate(TOP_AT_CENTER_JS)
    if w == PHONE[0]:
        rack_base = outage_url("APP_KILLBILL_DOWN_URL")
        with app_page(browser, rack_base, (w, h)) as page:
            shows(page, page.get_by_role("status", name="Service notice"), COPY["billing_banner"], page_ms=BANNER_MS, step_ms=LONG_STEP_MS)
            click(page.get_by_role("button", name="Filters", exact=True))
            dialog = page.get_by_role("dialog", name="Filters")
            eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
            advance(page, ONE_SECOND_MS)
            box = dialog.bounding_box()
            assert box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= w + HALF_PX and box["y"] + box["height"] <= h + HALF_PX
            for loc in (dialog.get_by_role("checkbox", name="Select"), dialog.get_by_role("textbox", name="Minimum clear run (mm)"), dialog.get_by_role("combobox", name="Salvage lot"), dialog.get_by_role("button", name="Done")):
                assert loc.evaluate(TOP_AT_CENTER_JS)


def test_grading_and_listing(app_url):
    hand, owner = api(app_url, HAND), api(app_url, OWNER)
    tag = tag_board(hand)["tag"]
    api_error(owner.post(f"/api/boards/{tag}/list", json={}), 409, "board_state")
    field_error(owner.post(f"/api/boards/{tag}/grade", json={"grade": "Premium"}), "grade")
    r = owner.post(f"/api/boards/{tag}/grade", json={"grade": "Select"})
    assert r.status_code == 200 and r.json()["board"]["status"] == "graded" and r.json()["changed"] == [tag]
    r = owner.post(f"/api/boards/{tag}/grade", json={"grade": "Character"})
    assert r.json()["board"]["grade"] == "Character"
    r = owner.post(f"/api/boards/{tag}/list", json={})
    assert r.status_code == 200 and r.json()["board"]["status"] == "available"
    api_error(owner.post(f"/api/boards/{tag}/grade", json={"grade": "Select"}), 409, "board_state")
    api_error(owner.post(f"/api/boards/{tag}/list", json={}), 409, "board_state")
    assert httpx.get(f"{app_url}/api/boards/{tag}", timeout=HTTP_TIMEOUT_S).json()["board"]["status"] == "available"
    board, _, sale, _ = make_sale(app_url)
    parent, offcut = board["tag"], sale["offcut"]["tag"]
    api_error(hand.post(f"/api/boards/{parent}/photos", content=png_bytes(8, 8), headers={"Content-Type": "image/png"}), 409, "board_state")
    api_error(owner.post(f"/api/boards/{parent}/list", json={}), 409, "board_state")
    api_error(owner.post(f"/api/boards/{offcut}/list", json={}), 409, "offcut_not_cut")
    assert owner.get(f"/api/boards/{offcut}").json()["board"]["status"] == "graded"
    finish_ticket(app_url, sale["ticket"])
    r = owner.post(f"/api/boards/{offcut}/list", json={})
    assert r.status_code == 200 and r.json()["board"]["status"] == "available" and r.json()["board"]["parent_tag"] == parent


def test_price_by_grade(app_url):
    owner = api(app_url, OWNER)
    species, grade = "Heart pine", "Rustic"
    size = (2000, 210, 45)
    board = listed_board(app_url, species=species, grade=grade, lot="LOT-02", length=size[0], width=size[1], thickness=size[2])
    tag = board["tag"]
    rate = rate_in_force(app_url, species, grade)
    assert board["rate_cents"] == rate and board["price_cents"] == price_cents(size[2], size[1], size[0], rate)
    assert board["board_feet"] == board_feet(size[0] * size[1] * size[2])
    pieces = [piece("Shelf A", 1000, 0)]
    fit = api_fit(app_url, tag, pieces)
    assert fit["price_cents"] == price_cents(size[2], size[1], 1000, rate)
    r = place_hold(api(app_url, INES), tag, pieces)
    assert r.status_code == 201
    hold = r.json()["hold"]
    assert hold["price_cents"] == fit["price_cents"]
    new_rate = rate + 50
    assert owner.put("/api/rates", json={"species": species, "grade": grade, "rate_cents": new_rate}).status_code == 200
    after = owner.get(f"/api/boards/{tag}").json()["board"]
    assert after["rate_cents"] == new_rate and after["price_cents"] == price_cents(size[2], size[1], size[0], new_rate)
    assert api(app_url, INES).get(f"/api/holds/{hold['id']}").json()["hold"]["price_cents"] == hold["price_cents"]
    node = owner.get(f"/api/boards/{tag}/lineage").json()["root"]
    assert node["rate_cents"] == new_rate


def test_stock_ledger(app_url):
    owner = api(app_url, OWNER)
    tag_board(api(app_url, HAND), species="Chestnut")
    moves = owner.get("/api/ledger").json()["movements"]
    balances: dict[str, int] = {}
    for m in moves:
        assert sum(e["volume_mm3"] for e in m["entries"]) == 0, m
        if m["by"] is None:
            assert m["kind"] == "intake", m
        for acct, v in entries(m).items():
            balances[acct] = balances.get(acct, 0) + v
    boards = owner.get("/api/boards", params=[("status", s) for s in OPEN_STATUSES]).json()["boards"]
    stock = {row["species"]: row for row in owner.get("/api/stock").json()["species"]}
    for sp in SPECIES:
        mine = [b for b in boards if b["species"] == sp]
        for b in mine:
            assert balances.get(f"board:{b['tag']}") == b["thickness_mm"] * b["width_mm"] * b["length_mm"], b["tag"]
        assert stock[sp]["volume_mm3"] == sum(balances[f"board:{b['tag']}"] for b in mine)


def test_wf_grading_grade_and_list(browser, app_url):
    hand = api(app_url, HAND)
    tag = tag_board(hand, species="Douglas fir", lot="LOT-02")["tag"]
    with app_page(browser, app_url) as page:
        page.goto(f"{app_url}/sign-in")
        ui_sign_in(page, app_url, OWNER)
        page.goto(f"{app_url}/owner")
        select(page.get_by_role("combobox", name=f"Grade for {tag}"), "Character")
        click(page.get_by_role("button", name=f"Save grade for {tag}"))
        status = page.get_by_role("status", name="Rate status")
        shows(page, status, COPY["saved"])
        click(page.get_by_role("button", name=f"List {tag} on the rack"))
        shows(page, status, COPY["saved"])

        def row_matches(t: int) -> None:
            row = next(r for r in api(app_url, OWNER).get("/api/stock").json()["species"] if r["species"] == "Douglas fir")
            assert stock_cells(page, "Douglas fir") == stock_expected(row)

        eventually(page, row_matches, STOCK_REFRESH_MS, LONG_STEP_MS)
        page.goto(f"{app_url}/?species=Douglas+fir")
        item = page.get_by_role("list", name="Rack").get_by_role("listitem").filter(has=page.get_by_role("link", name=tag, exact=True))
        board = api(app_url, OWNER).get(f"/api/boards/{tag}").json()["board"]
        shows(page, item, f"${money(board['price_cents'])}", page_ms=TWO_SECONDS_MS)
    assert board["status"] == "available" and board["grade"] == "Character"
    assert board["price_cents"] == price_cents(DEFAULT_SIZE[2], DEFAULT_SIZE[1], DEFAULT_SIZE[0], rate_in_force(app_url, "Douglas fir", "Character"))


def test_wf_grading_scheduled_rate(browser, app_url):
    owner = api(app_url, OWNER)
    species, grade = "Chestnut", "Character"
    old = rate_in_force(app_url, species, grade)
    clock = server_clock(owner, species, grade)
    now = clock[0]
    size = (2000, 250, 28)
    board = listed_board(app_url, species=species, grade=grade, length=size[0], width=size[1], thickness=size[2])
    for bad in ((now - timedelta(seconds=RATE_WINDOW_BEFORE_S + 1)).isoformat(), (now + timedelta(days=RATE_WINDOW_AFTER_DAYS + 1)).isoformat(), "2026-12-01T10:00:00"):
        field_error(owner.put("/api/rates", json={"species": species, "grade": grade, "rate_cents": old + 1, "effective_at": bad}), "effective_at")
    new = old + 100
    at = now + timedelta(seconds=25)
    r = owner.put("/api/rates", json={"species": species, "grade": grade, "rate_cents": new, "effective_at": at.isoformat().replace("+00:00", "Z")})
    assert r.status_code == 200, r.text
    rates = httpx.get(f"{app_url}/api/rates", timeout=HTTP_TIMEOUT_S).json()
    assert any(v["species"] == species and v["grade"] == grade and v["rate_cents"] == new for v in rates["scheduled"])
    assert rate_in_force(app_url, species, grade) == old
    assert owner.get(f"/api/boards/{board['tag']}").json()["board"]["price_cents"] == price_cents(size[2], size[1], size[0], old)
    assert api_fit(app_url, board["tag"], [piece("Shelf A", 500, 0)])["price_cents"] == price_cents(size[2], size[1], 500, old)
    wait_server_time(app_url, clock, at + timedelta(seconds=1))
    assert rate_in_force(app_url, species, grade) == new
    assert owner.get(f"/api/boards/{board['tag']}").json()["board"]["price_cents"] == price_cents(size[2], size[1], size[0], new)
    assert api_fit(app_url, board["tag"], [piece("Shelf A", 500, 0)])["price_cents"] == price_cents(size[2], size[1], 500, new)
    tomorrow = (server_clock(owner)[0] + timedelta(days=1)).replace(second=0, microsecond=0)
    ui_rate = new + 100
    with app_page(browser, app_url) as page:
        sign_in_page(page, app_url, OWNER)
        page.goto(f"{app_url}/owner")
        fill(page.get_by_role("textbox", name=f"Effective from for {species} {grade}"), "tomorrow")
        field = page.get_by_role("textbox", name=f"Rate for {species} {grade}")
        fill(field, str(ui_rate))
        field.press("Enter")
        shows(page, page.get_by_role("status", name="Rate status"), COPY["not_saved"])
        fill(page.get_by_role("textbox", name=f"Effective from for {species} {grade}"), tomorrow.strftime("%Y-%m-%d %H:%M"))
        fill(field, str(ui_rate))
        field.press("Enter")
        shows(page, page.get_by_role("status", name="Rate status"), COPY["rate_saved"])
        shows(page, page.get_by_role("list", name="Scheduled rates"), f"{species} {grade} {ui_rate} ¢/bd ft from {when(tomorrow.isoformat())}")
        eventually(page, lambda t: expect(field).to_have_value(str(new), timeout=t))
    assert any(v["rate_cents"] == ui_rate and parse_ts(v["effective_at"]) == tomorrow for v in httpx.get(f"{app_url}/api/rates", timeout=HTTP_TIMEOUT_S).json()["scheduled"])


def test_wf_grading_stock(browser, app_url):
    owner = api(app_url, OWNER)
    first = tag_board(api(app_url, HAND))["tag"]
    clients = [api(app_url, HAND) for _ in range(3)] + [api(app_url, OWNER) for _ in range(3)]
    results = race([lambda c=c: c.post("/api/boards", json={"lot": "LOT-01", "species": "White oak", "length_mm": 1000, "width_mm": 100, "thickness_mm": 20, "defects": []}) for c in clients])
    tags = [r.json()["board"]["tag"] for r in results if r.status_code == 201]
    assert len(tags) == len(clients) and len(set(tags)) == len(tags)
    assert all(tag_number(t) > tag_number(first) for t in tags)
    stock = owner.get("/api/stock").json()
    assert [r["species"] for r in stock["species"]] == SPECIES
    boards = owner.get("/api/boards", params=[("status", s) for s in OPEN_STATUSES]).json()["boards"]
    for row in stock["species"]:
        mine = [b for b in boards if b["species"] == row["species"]]
        assert row["open_boards"] == len(mine)
        assert row["on_rack"] == sum(b["status"] == "available" for b in mine)
        assert row["held"] == sum(b["status"] == "held" for b in mine)
        assert row["volume_mm3"] == sum(b["volume_mm3"] for b in mine) and row["board_feet"] == board_feet(row["volume_mm3"])
    t = stock["totals"]
    for key in ("open_boards", "on_rack", "held", "volume_mm3"):
        assert t[key] == sum(r[key] for r in stock["species"])
    assert t["board_feet"] == board_feet(t["volume_mm3"])
    with app_page(browser, app_url) as page:
        sign_in_page(page, app_url, OWNER)
        page.goto(f"{app_url}/owner")

        def totals_match(_: int) -> None:
            assert stock_cells(page, "All species") == stock_expected(owner.get("/api/stock").json()["totals"])

        eventually(page, totals_match, ONE_SECOND_MS)
        tag_board(api(app_url, HAND), species="Chestnut")
        eventually(page, totals_match, STOCK_REFRESH_MS, LONG_STEP_MS)
        graded = listed_board(app_url, list_it=False)["tag"]
        page.reload()
        eventually(page, totals_match)
        click(page.get_by_role("button", name=f"List {graded} on the rack"))
        eventually(page, totals_match, ONE_SECOND_MS)


def test_rack_to_scale(browser, app_url):
    with app_page(browser, app_url) as page:
        rack = page.get_by_role("list", name="Rack")
        expect(rack.get_by_role("listitem").first).to_be_visible(timeout=REAL_WAIT_S * 1000)
        listed = httpx.get(f"{app_url}/api/boards", timeout=HTTP_TIMEOUT_S).json()
        eventually(page, lambda t: expect(rack.get_by_role("listitem")).to_have_count(listed["count"], timeout=t), TWO_SECONDS_MS)
        scales = {float(rack.get_by_role("img", name=f"Board {b['tag']}").get_attribute("data-scale")) for b in listed["boards"]}
        assert len(scales) == 1, scales
        scale = scales.pop()
        for tag, grade, defects, dims in (("KW-0001", "Character", KW1_DEFECTS, "2440"), ("KW-0002", "Select", [{"kind": "check", "start_mm": 0, "end_mm": 120}, {"kind": "bolt hole", "start_mm": 1340, "end_mm": 1380}], "2100"), ("KW-0007", "Rustic", None, "3660")):
            item = rack.get_by_role("listitem").filter(has=page.get_by_role("link", name=tag, exact=True))
            strip = item.get_by_role("img", name=f"Board {tag}")
            tally = svg_items(strip, "data-tally")
            assert [int(x["value"]) for x in tally] == [TALLY[grade]], tally
            if defects:
                zones = sorted(svg_items(strip, "data-defect"), key=lambda z: z["x"])
                assert [z["value"] for z in zones] == [d["kind"] for d in defects]
                for z, d in zip(zones, defects):
                    assert near(z["x"], d["start_mm"] * scale) and near(z["w"], (d["end_mm"] - d["start_mm"]) * scale), (tag, z)
            text = item.inner_text()
            assert dims in text and "mm" in text


def test_live_rack_filters(browser, app_url):
    with app_page(browser, app_url) as page:
        count = page.get_by_role("status", name="Rack count")
        rack = page.get_by_role("list", name="Rack")
        expect(rack).to_be_visible(timeout=REAL_WAIT_S * 1000)
        page.evaluate("window.__kerfwellProbe = 1")
        check(page.get_by_role("group", name="Species").get_by_role("checkbox", name="Black walnut"))
        n = httpx.get(f"{app_url}/api/boards", params={"species": "Black walnut"}, timeout=HTTP_TIMEOUT_S).json()["count"]
        shows(page, count, count_copy(n))
        eventually(page, lambda t: expect(rack.get_by_role("listitem")).to_have_count(n, timeout=t))
        fill(page.get_by_role("textbox", name="Minimum length (mm)"), "2000")
        n2 = httpx.get(f"{app_url}/api/boards", params={"species": "Black walnut", "min_length_mm": 2000}, timeout=HTTP_TIMEOUT_S).json()["count"]
        shows(page, count, count_copy(n2))
        eventually(page, lambda t: expect(rack.get_by_role("listitem")).to_have_count(n2, timeout=t))
        assert page.evaluate("window.__kerfwellProbe") == 1


def test_wf_rack_find_board(browser, app_url):
    with app_page(browser, app_url, TABLET) as page:
        sign_in_page(page, app_url, JOEL)
        page.goto(app_url + "/")
        check(page.get_by_role("group", name="Species").get_by_role("checkbox", name="Douglas fir"))
        fill(page.get_by_role("textbox", name="Minimum clear run (mm)"), "1500")
        listed = httpx.get(f"{app_url}/api/boards", params={"species": "Douglas fir", "min_clear_mm": 1500}, timeout=HTTP_TIMEOUT_S).json()
        assert "KW-0004" in [b["tag"] for b in listed["boards"]]
        assert all(b["longest_clear_mm"] >= 1500 for b in listed["boards"])
        shows(page, page.get_by_role("status", name="Rack count"), count_copy(listed["count"]))
        click(page.get_by_role("list", name="Rack").get_by_role("link", name="KW-0004", exact=True))
        page.wait_for_url(re.compile(r"/boards/KW-0004$"))
        wait_board(page, "KW-0004")


def test_wf_rack_url_state(browser, app_url):
    with app_page(browser, app_url) as page:
        expect(page.get_by_role("list", name="Rack")).to_be_visible(timeout=REAL_WAIT_S * 1000)
        history = page.evaluate("history.length")
        check(page.get_by_role("group", name="Species").get_by_role("checkbox", name="Black walnut"))
        check(page.get_by_role("group", name="Grade").get_by_role("checkbox", name="Select"))
        fill(page.get_by_role("textbox", name="Minimum length (mm)"), "1000")
        fill(page.get_by_role("textbox", name="Minimum clear run (mm)"), "500")
        select(page.get_by_role("combobox", name="Salvage lot"), LOTS["LOT-03"])
        want = [("species", "Black walnut"), ("grade", "Select"), ("min_length_mm", "1000"), ("min_clear_mm", "500"), ("lot", "LOT-03")]
        eventually(page, lambda t: (_ for _ in ()).throw(AssertionError(page.url)) if parse_qsl(urlsplit(page.url).query) != want else None)
        assert page.evaluate("history.length") == history
        n = httpx.get(f"{app_url}/api/boards", params=want, timeout=HTTP_TIMEOUT_S).json()
        shows(page, page.get_by_role("status", name="Rack count"), count_copy(n["count"]))
        shared = page.url
    with app_page(browser, shared) as page:
        expect(page.get_by_role("group", name="Species").get_by_role("checkbox", name="Black walnut")).to_be_checked(timeout=REAL_WAIT_S * 1000)
        expect(page.get_by_role("group", name="Grade").get_by_role("checkbox", name="Select")).to_be_checked()
        expect(page.get_by_role("textbox", name="Minimum length (mm)")).to_have_value("1000")
        expect(page.get_by_role("textbox", name="Minimum clear run (mm)")).to_have_value("500")
        shows(page, page.get_by_role("status", name="Rack count"), count_copy(n["count"]))
        links = page.get_by_role("list", name="Rack").get_by_role("listitem").get_by_role("link", name=re.compile(r"^KW-\d+$"))
        eventually(page, lambda t: expect(links).to_have_count(n["count"], timeout=t))
    with app_page(browser, f"{app_url}/?min_length_mm={FILTER_MAX + 1}&species=Teak&grade=Select") as page:
        expect(page.get_by_role("group", name="Grade").get_by_role("checkbox", name="Select")).to_be_checked(timeout=REAL_WAIT_S * 1000)
        expect(page.get_by_role("textbox", name="Minimum length (mm)")).to_have_value("")

        def dropped(_: int) -> None:
            keys = [k for k, _v in parse_qsl(urlsplit(page.url).query)]
            assert keys == ["grade"], page.url

        eventually(page, dropped)


def test_wf_rack_latest_wins(browser, app_url):
    with app_page(browser, app_url) as page:
        count = page.get_by_role("status", name="Rack count")
        expect(page.get_by_role("list", name="Rack")).to_be_visible(timeout=REAL_WAIT_S * 1000)
        advance(page, ONE_SECOND_MS)
        held_routes: list[Any] = []

        def on_boards(route: Any) -> None:
            if not held_routes:
                held_routes.append(route)
                return
            _release(route)

        page.route(re.compile(r"/api/boards(\?|$)"), on_boards)
        box = page.get_by_role("textbox", name="Minimum length (mm)")
        fill(box, "3")
        advance(page, ONE_SECOND_MS)
        fill(box, "3000")
        advance(page, ONE_SECOND_MS)
        for route in list(held_routes):
            if dict(parse_qsl(urlsplit(route.request.url).query)).get("min_length_mm") == "3000":
                held_routes.remove(route)
                _release(route)
        n = httpx.get(f"{app_url}/api/boards", params={"min_length_mm": 3000}, timeout=HTTP_TIMEOUT_S).json()["count"]
        stale_n = httpx.get(f"{app_url}/api/boards", params={"min_length_mm": 3}, timeout=HTTP_TIMEOUT_S).json()["count"]
        assert n != stale_n
        shows(page, count, count_copy(n))
        for route in held_routes:
            _release(route)
            route.request.response()
        advance(page, ONE_SECOND_MS)
        expect(count).to_contain_text(count_copy(n), ignore_case=True)
        expect(page.get_by_role("list", name="Rack").get_by_role("listitem")).to_have_count(n)


def test_wf_rack_closed_sheet(browser, app_url):
    names = {"Select", "Character", "Rustic", "Minimum length (mm)", "Minimum clear run (mm)", "Salvage lot", "Done", *SPECIES}
    with app_page(browser, app_url, PHONE) as page:
        expect(page.get_by_role("button", name="Filters", exact=True)).to_be_visible(timeout=REAL_WAIT_S * 1000)
        expect(page.get_by_role("checkbox", name="Select")).to_have_count(0)
        expect(page.get_by_role("textbox", name="Minimum clear run (mm)")).to_have_count(0)
        assert not names & set(tab_order(page, 40))
        click(page.get_by_role("button", name="Filters", exact=True))
        dialog = page.get_by_role("dialog", name="Filters")
        eventually(page, lambda t: expect(dialog.get_by_role("checkbox", name="Select")).to_be_visible(timeout=t))
        click(dialog.get_by_role("button", name="Done"))
        eventually(page, lambda t: expect(page.get_by_role("checkbox", name="Select")).to_have_count(0, timeout=t))
        layout(page)
        assert not names & set(tab_order(page, 40))
    for size in (TABLET, DESKTOP):
        with app_page(browser, app_url, size) as page:
            rack = page.get_by_role("list", name="Rack")
            expect(rack).to_be_visible(timeout=REAL_WAIT_S * 1000)
            expect(page.get_by_role("button", name="Filters", exact=True)).to_have_count(0)
            expect(page.get_by_role("dialog", name="Filters")).to_have_count(0)
            expect(page.get_by_role("group", name="Grade").get_by_role("checkbox", name="Select")).to_be_visible()
            expect(page.get_by_role("textbox", name="Minimum clear run (mm)")).to_be_visible()
            layout(page)
            gb, rb = page.get_by_role("group", name="Species").bounding_box(), rack.bounding_box()
            if size == DESKTOP:
                assert gb["x"] + gb["width"] <= rb["x"] + 1 and RAIL_SHARE[0] * size[0] <= rb["x"] <= RAIL_SHARE[1] * size[0]
            else:
                assert gb["y"] + gb["height"] <= rb["y"] + 1


def test_elevation_geometry(browser, app_url):
    defects = [{"kind": "check", "start_mm": 1500, "end_mm": 1550}]
    board = listed_board(app_url, defects=defects)
    tag = board["tag"]
    pieces = [piece("Shelf A", 600, 0), piece("Shelf B", 800, 610)]
    fit = api_fit(app_url, tag, pieces)
    with app_page(browser, f"{app_url}/boards/{tag}", reduced_motion="reduce") as page:
        wait_board(page, tag)
        layout_ready_to_hold_free = [add_piece(page, p["label"], p["length_mm"], p["width_mm"]) or expect_chip(page, chip_name(p["label"], p["length_mm"], p["start_mm"])) for p in pieces]
        assert len(layout_ready_to_hold_free) == 2
        svg = page.get_by_role("img", name=f"Board elevation {tag}")
        scale = float(svg.get_attribute("data-scale"))
        width = svg.bounding_box()["width"]
        assert near(scale * board["length_mm"], width, 1)
        got = {int(x["value"]): x for x in svg_items(svg, "data-piece")}
        for i, p in enumerate(pieces):
            assert near(got[i]["x"], p["start_mm"] * scale) and near(got[i]["w"], p["length_mm"] * scale), got[i]
        zone = svg_items(svg, "data-defect")[0]
        assert zone["value"] == "check" and near(zone["x"], 1500 * scale)
        fit_and_hear(page, fit["verdict"])
        eventually(page, lambda t: expect(page.get_by_role("status", name="Fit result")).to_contain_text(fit["verdict"], timeout=t))
        kerfs = svg_items(svg, "data-kerf")
        assert sorted(int(float(k["value"])) for k in kerfs) == fit["cuts_mm"]
        for k in kerfs:
            assert abs(k["cx"] - float(k["value"]) * scale) <= max(HALF_PX, k["w"] / 2 + HALF_PX), k
        off = svg_items(svg, "data-offcut")
        assert len(off) == 1
        right = off[0]["x"] + off[0]["w"]
        assert near(right, board["length_mm"] * scale)
        assert (fit["take_mm"] + Fraction("3.2")) * Fraction(scale) - HALF_PX <= off[0]["x"] <= (fit["take_mm"] + KERF_ALLOWANCE_MM) * scale + HALF_PX


def test_chips_pointer_and_touch(browser, app_url):
    board = listed_board(app_url, defects=[{"kind": "nail hole", "start_mm": 1000, "end_mm": 1030}])
    tag = board["tag"]
    dashed_js = "(el) => [el, ...el.querySelectorAll('*')].some((e) => { const s = getComputedStyle(e); return [s.borderTopStyle, s.outlineStyle].includes('dashed') || (s.strokeDasharray && s.strokeDasharray !== 'none'); })"
    for touch in (False, True):
        with app_page(browser, f"{app_url}/boards/{tag}", PHONE if touch else DESKTOP, touch=touch) as page:
            wait_board(page, tag)
            add_piece(page, "Shelf A", 300, 100)
            expect_chip(page, chip_name("Shelf A", 300, 0))
            svg = page.get_by_role("img", name=f"Board elevation {tag}")
            svg.scroll_into_view_if_needed()
            scale = float(svg.get_attribute("data-scale"))
            box = svg.bounding_box()
            scroll = page.evaluate("window.scrollY")
            x0, y = box["x"] + 150 * scale, box["y"] + box["height"] / 2
            target = 803 if not touch else 800
            (touch_drag if touch else mouse_drag)(page, x0, y, x0 + target * scale)
            over = expect_chip(page, chip_name("Shelf A", 300, 800, over=True))
            expect(over).to_contain_text("over defect")
            assert over.evaluate(dashed_js) or svg.evaluate("(s) => { const p = Array.from(s.querySelectorAll('[data-piece]'))[0]; return !!p && [p, ...p.querySelectorAll('*')].some((e) => { const c = getComputedStyle(e); return (c.strokeDasharray && c.strokeDasharray !== 'none') || c.outlineStyle === 'dashed'; }); }")
            if touch:
                assert page.evaluate("window.scrollY") == scroll
            assert api_fit(app_url, tag, [piece("Shelf A", 300, 800)])["pieces"][0]["status"] == "over defect"


def test_wf_kerf_fit_keyboard(browser, app_url):
    tag = listed_board(app_url, length=3000)["tag"]
    with app_page(browser, f"{app_url}/boards/{tag}", reduced_motion="reduce") as page:
        wait_board(page, tag)
        add_piece(page, "Shelf A", 1445, 100)
        a = expect_chip(page, chip_name("Shelf A", 1445, 0))
        add_piece(page, "Shelf B", 300, 100)
        b_name = chip_name("Shelf B", 300, 1455)
        b = expect_chip(page, b_name)
        a.focus()
        page.keyboard.press("Tab")
        assert focused_name(page) == b_name
        page.keyboard.press("Enter")
        expect(b).to_have_attribute("aria-pressed", "true")
        expect(a).to_have_attribute("aria-pressed", "false")
        page.keyboard.press("Shift+ArrowRight")
        expect_chip(page, chip_name("Shelf B", 300, 1455 + 95))
        page.keyboard.press("ArrowRight")
        expect_chip(page, chip_name("Shelf B", 300, 1560))
        page.keyboard.press("ArrowLeft")
        expect_chip(page, chip_name("Shelf B", 300, 1550))
        page.keyboard.press("r")
        rotated = expect_chip(page, chip_name("Shelf B", 100, 1550))
        fit_result = page.get_by_role("status", name="Fit result")
        page.keyboard.press("f")
        shows(page, fit_result, api_fit(app_url, tag, [piece("Shelf A", 1445, 0), piece("Shelf B", 100, 1550, 300)])["verdict"])
        page.keyboard.press("Escape")
        expect(rotated).to_have_attribute("aria-pressed", "false")
        rotated.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("r")
        expect_chip(page, chip_name("Shelf B", 300, 1550))
        page.get_by_role("button", name="Add piece", exact=True).focus()
        page.keyboard.press("f")
        shows(page, fit_result, api_fit(app_url, tag, [piece("Shelf A", 1445, 0), piece("Shelf B", 300, 1550)])["verdict"])
        a = chip(page, chip_name("Shelf A", 1445, 0))
        a.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowLeft")
        expect_chip(page, chip_name("Shelf A", 1445, 0))
        page.keyboard.press("Escape")
        add_piece(page, "Shelf C", 200, 100)
        c = expect_chip(page, chip_name("Shelf C", 200, 1860))
        c.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("Delete")
        eventually(page, lambda t: expect(c).to_have_count(0, timeout=t))
        assert focused_name(page) == chip_name("Shelf B", 300, 1550)
        a.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("Backspace")
        assert focused_name(page) == chip_name("Shelf B", 300, 1550)
        page.keyboard.press("Enter")
        page.keyboard.press("Delete")
        eventually(page, lambda t: expect(page.get_by_role("group", name="Cut list").get_by_role("button")).to_have_count(0, timeout=t))
        assert focused_name(page) == "Piece label"


def test_wf_kerf_fit_live_totals(browser, app_url):
    tag = listed_board(app_url, length=3000)["tag"]
    with app_page(browser, f"{app_url}/boards/{tag}") as page:
        wait_board(page, tag)
        totals = page.get_by_role("status", name="Layout totals")
        shows(page, totals, COPY["add_piece"])
        fit_result = page.get_by_role("status", name="Fit result")
        before = fit_result.inner_text()
        add_piece(page, "Shelf A", 600, 100)
        f1 = api_fit(app_url, tag, [piece("Shelf A", 600, 0)])
        for text in (f"Take {f1['take_mm']} mm", f"Board feet {f1['board_feet']} bd ft", f"Price ${money(f1['price_cents'])}", f"Clear offcut {f1['clear_offcut_mm']} mm"):
            shows(page, totals, text)
        stale: list[Any] = []

        def on_fit(route: Any) -> None:
            if route.request.method == "POST" and not stale:
                stale.append(route)
                return
            _release(route)

        page.route(re.compile(r"/api/boards/[^/]+/fit$"), on_fit)
        c = chip(page, chip_name("Shelf A", 600, 0))
        c.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("Shift+ArrowRight")
        advance(page, ONE_SECOND_MS)
        page.keyboard.press("ArrowRight")
        latest = api_fit(app_url, tag, [piece("Shelf A", 600, 110)])
        older = api_fit(app_url, tag, [piece("Shelf A", 600, 100)])
        for route in list(stale):
            if route.request.post_data_json["pieces"][0]["start_mm"] == 110:
                stale.remove(route)
                _release(route)
        shows(page, totals, f"Take {latest['take_mm']} mm")
        shows(page, totals, f"Price ${money(latest['price_cents'])}")
        for route in stale:
            _release(route)
            route.request.response()
        advance(page, ONE_SECOND_MS)
        expect(totals).to_contain_text(f"Take {latest['take_mm']} mm")
        expect(totals).not_to_contain_text(f"Take {older['take_mm']} mm")
        assert fit_result.inner_text() == before


def test_fit_check_endpoint(browser, app_url):
    ex = api_fit(app_url, EX_TAG, EX_PIECES)
    assert set(ex) == FIT_KEYS
    assert [p["status"] for p in ex["pieces"]] == ["clear", "clear"] and ex["clear_count"] == 2
    assert ex["cuts_mm"] == EX_CUTS and ex["take_mm"] == EX_TAKE and ex["sale"] == "cut"
    assert (ex["offcut_mm"], ex["clear_offcut_mm"], ex["board_feet"], ex["price_cents"]) == (EX_OFFCUT, EX_CLEAR_OFFCUT, EX_BOARD_FEET, EX_PRICE)
    assert ex["verdict"] == EX_VERDICT
    rate = httpx.get(f"{app_url}/api/boards/{EX_TAG}", timeout=HTTP_TIMEOUT_S).json()["board"]["rate_cents"]
    whole = api_fit(app_url, EX_TAG, [piece("Shelf A", KW1_SIZE[0] - KERF_ALLOWANCE_MM - MIN_OFFCUT_MM + 1, 0, 150)])
    assert whole["sale"] == "whole" and whole["take_mm"] == KW1_SIZE[0] and whole["offcut_mm"] is None and whole["clear_offcut_mm"] is None
    assert whole["price_cents"] == price_cents(KW1_SIZE[2], KW1_SIZE[1], KW1_SIZE[0], rate)
    assert whole["clear_count"] == 0 and whole["verdict"] == f"{whole['clear_count']} of {len(whole['pieces'])} {VERDICT_NO_OFFCUT}"
    gap = api_fit(app_url, EX_TAG, [piece("Shelf A", 600, 0), piece("Shelf B", 500, 610)])
    assert [p["status"] for p in gap["pieces"]] == ["clear", "over defect"] and gap["cuts_mm"] == [600, 1110]
    tight = api_fit(app_url, EX_TAG, [piece("Shelf A", 600, 0), piece("Shelf B", 500, 609)])
    assert [p["status"] for p in tight["pieces"]] == ["overlap", "overlap"]
    assert all(tight[k] is None for k in ("take_mm", "sale", "offcut_mm", "clear_offcut_mm", "board_feet", "price_cents"))
    assert tight["clear_count"] == 0 and tight["verdict"] == f"{tight['clear_count']} of {len(tight['pieces'])} {VERDICT_NEEDS_FIXING}"
    assert api_fit(app_url, EX_TAG, [piece("Shelf A", 600, 2000)])["pieces"][0]["status"] == "off board"
    assert api_fit(app_url, EX_TAG, [piece("Shelf A", 600, 0, KW1_SIZE[1] + 1)])["pieces"][0]["status"] == "too wide"
    post = lambda body: httpx.post(f"{app_url}/api/boards/{EX_TAG}/fit", json=body, timeout=HTTP_TIMEOUT_S)
    field_error(post({"pieces": []}), "pieces")
    field_error(post({"pieces": [piece(f"P{i}", 10, i * 20) for i in range(MAX_PIECES + 1)]}), "pieces")
    field_error(post({"pieces": [piece("x" * (LABEL_MAX + 1), 10, 0)]}), "pieces.0")
    field_error(post({"pieces": [piece("Shelf A", 10, 0), piece("Shelf B", 0, 100)]}), "pieces.1")
    api_error(httpx.post(f"{app_url}/api/boards/{TAGGED_TAG}/fit", json={"pieces": [PIECE_A]}, timeout=HTTP_TIMEOUT_S), 404, "not_found")
    with app_page(browser, f"{app_url}/boards/{EX_TAG}") as page:
        wait_board(page, EX_TAG)
        add_piece(page, "Shelf A", 600, 100)
        expect_chip(page, chip_name("Shelf A", 600, 0))
        advance(page, ONE_SECOND_MS)
        with held(page, "**/api/boards/*/fit") as gate:
            click(page.get_by_role("button", name="Fit check", exact=True))
            eventually(page, lambda t: expect(page.get_by_role("button", name="Checking fit")).to_be_visible(timeout=t))
            gate.release()
        shows(page, page.get_by_role("status", name="Fit result"), api_fit(app_url, EX_TAG, [PIECE_A])["verdict"])
        page.route(re.compile(r"/api/boards/[^/]+/fit$"), lambda route: route.fulfill(status=500, body="{}"))
        click(page.get_by_role("button", name="Fit check", exact=True))
        shows(page, page.get_by_role("status", name="Fit result"), COPY["fit_failed"])


def test_imperial_display(browser, app_url):
    _, _, sale, _ = make_sale(app_url)
    with app_page(browser, f"{app_url}/boards/{EX_TAG}") as page:
        wait_board(page, EX_TAG)
        sent: list[dict[str, Any]] = []
        page.on("request", lambda r: sent.append(r.post_data_json) if r.method == "POST" and r.url.endswith("/fit") else None)
        expect(page.get_by_role("radio", name="Millimetres")).to_be_checked()
        check(page.get_by_role("radio", name="Inches"))
        shows(page, page.locator("body"), inches(KW1_SIZE[0]))
        add_piece(page, "Shelf A", V1_INCH_EXAMPLE[0], "4")
        c = expect_chip(page, chip_name("Shelf A", V1_INCH_EXAMPLE[1], 0, unit="in"))
        shows(page, page.get_by_role("status", name="Layout totals"), f"Take {inches(V1_INCH_EXAMPLE[1])}")
        assert sent and sent[-1]["pieces"][0]["length_mm"] == V1_INCH_EXAMPLE[1] and sent[-1]["pieces"][0]["width_mm"] == mm_from_in("4")
        c.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowRight")
        expect_chip(page, chip_name("Shelf A", V1_INCH_EXAMPLE[1], 13, over=True, unit="in"))
        fit_and_hear(page, api_fit(app_url, EX_TAG, [piece("Shelf A", 600, 13, mm_from_in("4"))])["verdict"])
        page.reload()
        expect(page.get_by_role("radio", name="Inches")).to_be_checked(timeout=REAL_WAIT_S * 1000)
        page.goto(app_url + "/")
        item = page.get_by_role("list", name="Rack").get_by_role("listitem").filter(has=page.get_by_role("link", name=EX_TAG, exact=True))
        shows(page, item, f"{inches(KW1_SIZE[0])}")
        sign_in_page(page, app_url, HAND)
        page.goto(f"{app_url}/tickets/{sale['ticket']}")
        shows(page, page.locator("body"), inches(PIECE_A["length_mm"]), page_ms=TWO_SECONDS_MS)


def test_wf_kerf_fit_lay_out(browser, app_url):
    pieces = [piece("Shelf A", 600, 0, 150), piece("Shelf B", 800, 650, 150), piece("Shelf C", 400, 1720, 150)]
    fit = api_fit(app_url, EX_TAG, pieces)
    assert fit["clear_count"] == 3 and fit["sale"] == "cut"
    with app_page(browser, f"{app_url}/boards/{EX_TAG}") as page:
        sign_in_page(page, app_url, JOEL)
        page.reload()
        wait_board(page, EX_TAG)
        add_piece(page, "Shelf A", 600, 150)
        add_piece(page, "Shelf B", 800, 150)
        b = expect_chip(page, chip_name("Shelf B", 800, 610, over=True))
        b.focus()
        page.keyboard.press("Enter")
        for _ in range(4):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Escape")
        expect_chip(page, chip_name("Shelf B", 800, 650))
        add_piece(page, "Shelf C", 400, 150)
        c = expect_chip(page, chip_name("Shelf C", 400, 1460, over=True))
        c.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Shift+ArrowRight")
        for _ in range(6):
            page.keyboard.press("ArrowRight")
        expect_chip(page, chip_name("Shelf C", 400, 1720))
        fit_and_hear(page, fit["verdict"])
        svg = page.get_by_role("img", name=f"Board elevation {EX_TAG}")
        eventually(page, lambda t: (_ for _ in ()).throw(AssertionError("kerf")) if len(svg_items(svg, "data-kerf")) != len(fit["cuts_mm"]) else None, TWO_SECONDS_MS)
        assert len(svg_items(svg, "data-offcut")) == 1
        shows(page, page.get_by_role("status", name="Layout totals"), f"Price ${money(fit['price_cents'])}")
    assert api_fit(app_url, EX_TAG, pieces)["price_cents"] == fit["price_cents"]


def test_wf_kerf_fit_layout_file(browser, app_url):
    tag = listed_board(app_url, length=3000)["tag"]
    maker = api(app_url, INES)
    api_error(maker.get(f"/api/boards/{tag}/layout.kerf"), 404, "not_found")
    api_error(api(app_url, OWNER).get(f"/api/boards/{tag}/layout.kerf"), 403, "forbidden")
    upload = {"pieces": [{"start_mm": 700, "width_mm": 100, "label": "Étagère", "length_mm": 500, "grain": "rift"}, {"label": "Shelf A", "length_mm": 600, "width_mm": 100, "start_mm": 0}], "note": "barn", "unit": "mm", "board": tag, "version": 2, "format": "kerf"}
    r = maker.post(f"/api/boards/{tag}/layout", json=upload)
    assert r.status_code == 200, r.text
    stored = r.json()["layout"]
    assert list(stored) == ["format", "version", "board", "unit", "pieces", "note"]
    assert [list(p) for p in stored["pieces"]] == [["label", "length_mm", "width_mm", "start_mm"], ["label", "length_mm", "width_mm", "start_mm", "grain"]]
    assert [p["start_mm"] for p in stored["pieces"]] == [0, 700]
    e1 = maker.get(f"/api/boards/{tag}/layout.kerf")
    assert e1.status_code == 200 and e1.headers["content-type"].startswith("application/json")
    assert e1.headers["content-disposition"] == f'attachment; filename="{tag}.kerf"'
    assert e1.content == json.dumps(stored, separators=(",", ":"), ensure_ascii=False).encode() and not e1.content.endswith(b"\n")
    assert maker.post(f"/api/boards/{tag}/layout", content=e1.content, headers={"Content-Type": "application/json"}).status_code == 200
    assert maker.get(f"/api/boards/{tag}/layout.kerf").content == e1.content
    with app_page(browser, f"{app_url}/boards/{tag}") as page:
        sign_in_page(page, app_url, JOEL)
        page.reload()
        wait_board(page, tag)
        add_piece(page, "Shelf A", 600, 100)
        add_piece(page, "Shelf B", 400, 100)
        expect_chip(page, chip_name("Shelf B", 400, 610))
        with page.expect_download() as info:
            click(page.get_by_role("button", name="Export layout"))
        download = info.value
        assert download.suggested_filename == f"{tag}.kerf"
        data = Path(download.path()).read_bytes()
        shows(page, page.get_by_role("status", name="Layout file status"), f"Layout exported as {tag}.kerf.")
        assert data == api(app_url, JOEL).get(f"/api/boards/{tag}/layout.kerf").content
        assert [(p["label"], p["start_mm"]) for p in json.loads(data)["pieces"]] == [("Shelf A", 0), ("Shelf B", 610)]
        with page.expect_file_chooser() as chooser:
            click(page.get_by_role("button", name="Import layout"))
        chooser.value.set_files(files=[{"name": f"{tag}.kerf", "mimeType": "application/json", "buffer": e1.content}])
        shows(page, page.get_by_role("status", name="Layout file status"), "Imported 2 pieces from the layout file.")
        expect_chip(page, chip_name("Étagère", 500, 700))
        expect(chip(page, chip_name("Shelf B", 400, 610))).to_have_count(0)


def test_layout_file_versions(app_url):
    tag = listed_board(app_url, length=3000)["tag"]
    maker = api(app_url, INES)
    grain, note = "quartered", "from v1"
    v1 = {"format": "kerf", "version": 1, "board": tag, "unit": "in", "cuts": [{"name": "Shelf A", "len": float(V1_INCH_EXAMPLE[0]), "w": 4, "at": 0, "grain": grain}, {"name": "Shelf B", "len": 2.5, "w": 4, "at": 30}], "note": note}
    r = maker.post(f"/api/boards/{tag}/layout", json=v1)
    assert r.status_code == 200, r.text
    out = r.json()["layout"]
    assert (out["format"], out["version"], out["board"], out["unit"]) == ("kerf", 2, tag, "mm")
    assert out["pieces"][0] == {"label": "Shelf A", "length_mm": V1_INCH_EXAMPLE[1], "width_mm": mm_from_in("4"), "start_mm": 0, "grain": grain}
    assert out["pieces"][1] == {"label": "Shelf B", "length_mm": mm_from_in("2.5"), "width_mm": mm_from_in("4"), "start_mm": mm_from_in("30")}
    assert out["note"] == note
    exported = maker.get(f"/api/boards/{tag}/layout.kerf").content
    parsed = json.loads(exported)
    assert parsed["note"] == note and parsed["pieces"][0]["grain"] == grain
    good = {"format": "kerf", "version": 2, "board": tag, "unit": "mm", "pieces": [PIECE_A]}
    post = lambda body: maker.post(f"/api/boards/{tag}/layout", json=body)
    api_error(post({**good, "version": 3}), 422, "unsupported_version")
    api_error(post({**good, "board": "KW-0001"}), 422, "wrong_board")
    field_error(post({**good, "format": "csv", "version": 3}), "format")
    api_error(post({**good, "version": 3, "board": "KW-0001"}), 422, "unsupported_version")
    field_error(post({**good, "version": "2"}), "version")
    field_error(post({k: v for k, v in good.items() if k != "board"}), "board")
    api_error(post({**good, "board": "KW-0001", "unit": "in"}), 422, "wrong_board")
    field_error(post({**good, "unit": "in"}), "unit")
    field_error(post({**good, "pieces": [piece("Shelf A", 0, 0)]}), "pieces.0")
    assert maker.get(f"/api/boards/{tag}/layout.kerf").content == exported


def test_undo_redo(browser, app_url):
    tag = listed_board(app_url, length=3000)["tag"]
    with app_page(browser, f"{app_url}/boards/{tag}", reduced_motion="reduce") as page:
        wait_board(page, tag)
        undo, redo = page.get_by_role("button", name="Undo", exact=True), page.get_by_role("button", name="Redo", exact=True)
        expect(undo).to_be_disabled()
        expect(redo).to_be_disabled()
        totals = page.get_by_role("status", name="Layout totals")
        add_piece(page, "Shelf A", 500, 100)
        add_piece(page, "Shelf B", 300, 100)
        b = expect_chip(page, chip_name("Shelf B", 300, 510))
        b.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowRight")
        expect_chip(page, chip_name("Shelf B", 300, 520))
        page.keyboard.press("Control+z")
        expect_chip(page, chip_name("Shelf B", 300, 510))
        shows(page, totals, "Take 810 mm")
        click(redo)
        expect_chip(page, chip_name("Shelf B", 300, 520))
        shows(page, totals, "Take 820 mm")
        chip(page, chip_name("Shelf B", 300, 520)).focus()
        for _ in range(5):
            page.keyboard.down("ArrowRight")
        page.keyboard.up("ArrowRight")
        expect_chip(page, chip_name("Shelf B", 300, 570))
        page.keyboard.press("Control+z")
        expect_chip(page, chip_name("Shelf B", 300, 520))
        page.keyboard.press("Control+Shift+Z")
        expect_chip(page, chip_name("Shelf B", 300, 570))
        page.keyboard.press("Control+z")
        svg = page.get_by_role("img", name=f"Board elevation {tag}")
        scale = float(svg.get_attribute("data-scale"))
        box = svg.bounding_box()
        x0 = box["x"] + (520 + 150) * scale
        mouse_drag(page, x0, box["y"] + box["height"] / 2, x0 + 100 * scale)
        expect_chip(page, chip_name("Shelf B", 300, 620))
        click(undo)
        expect_chip(page, chip_name("Shelf B", 300, 520))
        field = page.get_by_role("textbox", name="Piece label")
        fill(field, "x")
        field.press("Control+z")
        expect_chip(page, chip_name("Shelf B", 300, 520))
        chip(page, chip_name("Shelf B", 300, 520)).focus()
        page.keyboard.press("Enter")
        for _ in range(UNDO_DEPTH + 1):
            page.keyboard.press("ArrowRight")
        expect_chip(page, chip_name("Shelf B", 300, 520 + (UNDO_DEPTH + 1) * SNAP_MM))
        undo.focus()
        for _ in range(UNDO_DEPTH):
            page.keyboard.press("Enter")
        expect_chip(page, chip_name("Shelf B", 300, 530))
        expect(undo).to_be_disabled()
        assert focused_name(page) == "Redo"
        shows(page, totals, "Take 830 mm")


@pytest.mark.parametrize("mode", MOTION_CASES, ids=MOTION_CASES)
def test_kerf_motion(browser, app_url, mode):
    tag = listed_board(app_url, length=3000)["tag"]
    pieces = [piece("Shelf A", 500, 0), piece("Shelf B", 500, 600)]
    fit = api_fit(app_url, tag, pieces)
    rec_js = """([elev, totals]) => { window.__rec = []; const seen = new Set(); const classify = (t) => { if (!t || !t.closest) return null; const k = t.closest('[data-kerf]'); if (k) return {kind: 'kerf', pos: parseFloat(k.getAttribute('data-kerf'))}; if (t.closest('[data-offcut]')) return {kind: 'offcut'}; if (totals.contains(t)) return {kind: 'figures'}; return null; }; window.__scan = () => { for (const a of document.getAnimations()) { if (seen.has(a)) continue; seen.add(a); const e = a.effect; if (!e) continue; const c = classify(e.target); if (!c) continue; const tm = e.getComputedTiming(); window.__rec.push({...c, begin: (a.startTime ?? document.timeline.currentTime) + (tm.delay || 0), duration: Number(tm.duration) || 0}); } }; const orig = Element.prototype.animate; Element.prototype.animate = function (...args) { const a = orig.apply(this, args); window.__scan(); return a; }; for (const ev of ['animationstart', 'transitionrun', 'transitionstart']) document.addEventListener(ev, () => window.__scan(), true); }"""
    with app_page(browser, f"{app_url}/boards/{tag}", reduced_motion="reduce" if mode == "reduced" else "no-preference") as page:
        wait_board(page, tag)
        for p in pieces:
            add_piece(page, p["label"], p["length_mm"], p["width_mm"])
        expect_chip(page, chip_name("Shelf B", 500, 510))
        c = chip(page, chip_name("Shelf B", 500, 510))
        c.focus()
        page.keyboard.press("Enter")
        for _ in range(9):
            page.keyboard.press("ArrowRight")
        expect_chip(page, chip_name("Shelf B", 500, 600))
        totals = page.get_by_role("status", name="Layout totals")
        shows(page, totals, f"Take {fit['take_mm']} mm")
        svg = page.get_by_role("img", name=f"Board elevation {tag}")
        svg.scroll_into_view_if_needed()
        scale = float(svg.get_attribute("data-scale"))
        page.evaluate(SEEK_JS)
        before = capture(svg)
        with held(page, "**/api/boards/*/fit") as gate:
            click(page.get_by_role("button", name="Fit check", exact=True))
            come_to_rest(totals)
            held_totals = capture(totals)
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/fit")):
                gate.release()
        page.evaluate("window.__step(0)")
        svg_shots, total_shots = [before, capture(svg)], [held_totals, capture(totals)]
        for _ in range(MOTION_WATCH_MS // MOTION_STEP_MS):
            advance(page, MOTION_STEP_MS)
            page.evaluate("(ms) => window.__step(ms)", MOTION_STEP_MS)
            svg_shots.append(capture(svg))
            total_shots.append(capture(totals))
        advance(page, MOTION_SETTLE_MS)
        page.evaluate("(ms) => window.__step(ms)", MOTION_SETTLE_MS)
        svg_shots.append(capture(svg))
        total_shots.append(capture(totals))
        kerfs = svg_items(svg, "data-kerf")
        assert sorted(int(float(k["value"])) for k in kerfs) == fit["cuts_mm"]
        assert len(svg_items(svg, "data-offcut")) == 1
    final = len(svg_shots) - 1
    frames = list(range(2, final))
    cuts = sorted(fit["cuts_mm"])
    cols = [sorted({floor(c * scale), floor(c * scale + 1)}) for c in cuts]
    off_x0 = floor((fit["take_mm"] + KERF_ALLOWANCE_MM) * scale) + OFFCUT_INSET_PX
    ref = 0 if mode == "reduced" else 1
    s = analyse(browser, svg_shots, cols, ref, [{"a": final, "b": ref, "ref": ref, "x0": off_x0, "x1": WHOLE_WIDTH}])
    t = analyse(browser, total_shots, [], 0, [{"a": 0, "b": final, "ref": final, "x0": 0, "x1": WHOLE_WIDTH}])
    assert len(set(s["w"])) == 1 and len(set(t["w"])) == 1, (s["w"], t["w"])
    height = s["h"][0]
    counts = s["columns"]
    full = [counts[final][k] for k in range(len(cuts))]
    assert all(n >= height / KERF_MIN_SHARE for n in full), (full, height)
    off, fig = s["regions"][0], t["regions"][0]
    assert off["n"] >= MIN_MASK_PX, off["n"]
    off_full = off["series"][final]
    first = frames[0]
    if mode == "reduced":
        for k in range(len(cuts)):
            assert counts[first][k] >= NEAR_FULL * full[k], (cuts[k], counts[first][k], full[k])
        assert off["series"][first] >= NEAR_FULL * off_full, off["series"][: first + 1]
        if fig["n"] >= MIN_MASK_PX:
            assert fig["series"][first] <= SETTLED * fig["series"][0], fig["series"][: first + 1]
        return
    S = MOTION_STEP_MS
    lines = []
    for k in range(len(cuts)):
        norms = [counts[i][k] / full[k] for i in frames]
        begin, end = ramp(norms, lambda v: v <= STARTED, lambda v: v >= NEAR_FULL)
        assert KERF_LINE_MS[0] * EASED_SHARE <= end - begin <= KERF_LINE_MS[1] + 2 * S, (cuts[k], begin, end, norms)
        lines.append((begin, end))
    for (b0, e0), (b1, e1) in zip(lines, lines[1:]):
        assert b1 >= e0 - 2 * S, lines
    off_norms = [off["series"][i] / off_full for i in frames]
    off_begin, off_end = ramp(off_norms, lambda v: v <= STARTED, lambda v: v >= NEAR_FULL)
    assert OFFCUT_FADE_MS[0] * EASED_SHARE <= off_end - off_begin <= OFFCUT_FADE_MS[1] + 2 * S, (off_begin, off_end, off_norms)
    assert off_begin >= lines[-1][1] - 2 * S, (lines, off_begin)
    assert fig["n"] >= MIN_MASK_PX, "figures were not dimmed while the fit was pending"
    fig_norms = [fig["series"][i] / fig["series"][0] for i in frames]
    fig_begin, fig_end = ramp(fig_norms, lambda v: v >= DIMMED, lambda v: v <= SETTLED)
    assert FIGURES_MS[0] * EASED_SHARE <= fig_end - fig_begin <= FIGURES_MS[1] + 2 * S, (fig_begin, fig_end, fig_norms)
    assert fig_begin >= off_end - 2 * S, (off_end, fig_begin)


def test_deposit_hold(app_url, killbill):
    board, hold, ines = held_hold(app_url)
    assert set(hold) == HOLD_KEYS and hold["status"] == "held" and hold["release_reason"] is None
    assert re.fullmatch(r"H-\d{4}", hold["id"]) and hold["deposit_cents"] == DEPOSIT_CENTS
    assert (parse_ts(hold["expires_at"]) - parse_ts(hold["held_at"])).total_seconds() == DEFAULT_HOLD_SECONDS
    payment = kb_payment(killbill, INES[0], hold["killbill_payment_id"])
    yard_id_of(killbill, INES[0], hold)
    purchases = txns(payment, "PURCHASE")
    assert len(purchases) == 1 and Decimal(str(purchases[0]["amount"])) == dollars(DEPOSIT_CENTS)
    assert httpx.get(f"{app_url}/api/boards/{board['tag']}", timeout=HTTP_TIMEOUT_S).json()["board"]["status"] == "held"
    assert any(h["id"] == hold["id"] and h["status"] == "held" for h in ines.get("/api/holds").json()["holds"])


def test_declined_card(app_url, killbill):
    board = listed_board(app_url)
    ines = api(app_url, INES)
    before = {p["paymentId"] for p in kb_payments(killbill, INES[0])}
    api_error(place_hold(ines, board["tag"], card=DECLINED_CARD), 402, "card_declined")
    assert {p["paymentId"] for p in kb_payments(killbill, INES[0])} == before
    assert httpx.get(f"{app_url}/api/boards/{board['tag']}", timeout=HTTP_TIMEOUT_S).json()["board"]["status"] == "available"
    mine = [h for h in ines.get("/api/holds").json()["holds"] if h["board"] == board["tag"]]
    assert [(h["status"], h["release_reason"]) for h in mine] == [("released", "payment-failed")]


def test_one_hold_per_board(app_url, killbill):
    board = listed_board(app_url)
    makers = [INES, JOEL]
    emails = [m[0] for m in makers]
    before = success_ids(killbill, emails)
    clients = [api(app_url, m) for m in makers for _ in range(3)]
    results = race([lambda c=c: place_hold(c, board["tag"]) for c in clients])
    winners = [r for r in results if r.status_code == 201]
    assert len(winners) == 1, [r.status_code for r in results]
    for r in results:
        if r.status_code != 201:
            api_error(r, 409, "already_held")
    new = success_ids(killbill, emails) - before
    assert new == {winners[0].json()["hold"]["killbill_payment_id"]}


def test_wf_hold_race(browser, app_url, killbill):
    board = listed_board(app_url)
    tag = board["tag"]
    with app_page(browser, f"{app_url}/boards/{tag}") as page:
        sign_in_page(page, app_url, JOEL)
        page.reload()
        wait_board(page, tag)
        layout_ready_to_hold(page, app_url, tag, [PIECE_A])
        click(page.get_by_role("button", name="Hold board", exact=True))
        dialog = page.get_by_role("dialog", name="Hold this board")
        eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
        fill(dialog.get_by_role("textbox", name="Card number"), CARD)
        assert place_hold(api(app_url, INES), tag).status_code == 201
        before = success_ids(killbill, [JOEL[0]])
        click(dialog.get_by_role("button", name="Pay deposit and hold"))
        eventually(page, lambda t: expect(dialog.get_by_role("heading", name=COPY["conflict_heading"])).to_be_visible(timeout=t))
        expect(dialog).to_contain_text(COPY["conflict_text"])
        expect(dialog.get_by_role("button", name="Pay deposit and hold")).to_have_count(0)
    assert success_ids(killbill, [JOEL[0]]) == before
    assert not [h for h in api(app_url, JOEL).get("/api/holds").json()["holds"] if h["board"] == tag]


def test_hold_purchase_replay(app_url, killbill):
    board = listed_board(app_url)
    tag = board["tag"]
    key = idempotency_key()
    body = {"board": tag, "pieces": [PIECE_A], "card_number": CARD}
    clients = [api(app_url, INES) for _ in range(3)]
    results = race([lambda c=c: c.post("/api/holds", json=body, headers={"Idempotency-Key": key}) for c in clients])
    assert [r.status_code for r in results] == [201] * 3 and len({r.text for r in results}) == 1
    ines = clients[0]
    hold = results[0].json()["hold"]
    again = ines.post("/api/holds", json=body, headers={"Idempotency-Key": key})
    assert again.status_code == 201 and again.json() == results[0].json()
    holds = [p for p in kb_payments(killbill, INES[0]) if p["paymentExternalKey"].startswith("hold-") and p["paymentExternalKey"].endswith("-" + hold["id"])]
    assert len(holds) == 1 and len(txns(holds[0], "PURCHASE")) == 1
    api_error(ines.post("/api/holds", json={**body, "pieces": [piece("Shelf A", 600, 10)]}, headers={"Idempotency-Key": key}), 409, "idempotency_conflict")
    api_error(purchase(ines, hold["id"], key), 409, "idempotency_conflict")
    fresh = {**body, "board": listed_board(app_url)["tag"]}
    field_error(ines.post("/api/holds", json=fresh), "idempotency_key")
    field_error(ines.post("/api/holds", json=fresh, headers={"Idempotency-Key": "bad key!"}), "idempotency_key")
    field_error(ines.post(f"/api/holds/{hold['id']}/purchase", json={}), "idempotency_key")
    pkey = idempotency_key()
    buys = race([lambda c=c: purchase(c, hold["id"], pkey) for c in clients])
    assert [r.status_code for r in buys] == [201] * 3 and len({r.text for r in buys}) == 1
    sale = buys[0].json()["sale"]
    assert purchase(ines, hold["id"], pkey).json() == buys[0].json()
    yard = yard_id_of(killbill, INES[0], hold)
    sales = [p for p in kb_payments(killbill, INES[0]) if p["paymentExternalKey"] == f"sale-{yard}-{sale['ticket']}"]
    assert len(sales) == 1 and len(txns(sales[0], "PURCHASE")) == 1
    _, other, _ = held_hold(app_url)
    api_error(purchase(ines, other["id"], pkey), 409, "idempotency_conflict")
    replay = ines.post("/api/holds", json=body, headers={"Idempotency-Key": key})
    assert replay.status_code == 201 and replay.json() == results[0].json()
    third = listed_board(app_url)["tag"]
    dkey = idempotency_key()
    before = {p["paymentId"] for p in kb_payments(killbill, INES[0])}
    first = place_hold(ines, third, key=dkey, card=DECLINED_CARD)
    api_error(first, 402, "card_declined")
    second = place_hold(ines, third, key=dkey, card=DECLINED_CARD)
    assert second.status_code == 402 and second.json() == first.json()
    assert {p["paymentId"] for p in kb_payments(killbill, INES[0])} == before
    assert len([h for h in ines.get("/api/holds").json()["holds"] if h["board"] == third]) == 1


@pytest.mark.parametrize("case", DIALOG_CASES, ids=DIALOG_CASES)
def test_dialogs_by_keyboard(browser, app_url, case):
    inside = "(d) => d.contains(document.activeElement)"

    def trap(page: Page, dialog: Any) -> None:
        eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
        assert dialog.evaluate(inside)
        for key in ["Tab"] * 5 + ["Shift+Tab"] * 5:
            page.keyboard.press(key)
            assert dialog.evaluate(inside), key

    def closes(page: Page, name: str, opener: str) -> None:
        page.keyboard.press("Escape")
        eventually(page, lambda t: expect(page.get_by_role("dialog", name=name)).to_have_count(0, timeout=t))
        assert focused_name(page) == opener

    if case == "hold":
        tag = listed_board(app_url)["tag"]
        with app_page(browser, f"{app_url}/boards/{tag}") as page:
            sign_in_page(page, app_url, JOEL)
            page.reload()
            wait_board(page, tag)
            layout_ready_to_hold(page, app_url, tag, [PIECE_A])
            click(page.get_by_role("button", name="Hold board", exact=True))
            dialog = page.get_by_role("dialog", name="Hold this board")
            trap(page, dialog)
            closes(page, "Hold this board", "Hold board")
            page.keyboard.press("Enter")
            eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
            assert focused_name(page) == "Card number"
            page.keyboard.type(CARD)
            for _ in range(3):
                if focused_name(page) == "Pay deposit and hold":
                    break
                page.keyboard.press("Tab")
            assert focused_name(page) == "Pay deposit and hold"
            page.keyboard.press("Enter")
            shows(page, page.get_by_role("status", name="Hold status"), COPY["held_ok"])
        assert api(app_url, OWNER).get(f"/api/boards/{tag}").json()["board"]["status"] == "held"
    elif case == "filters":
        with app_page(browser, app_url, PHONE) as page:
            click(page.get_by_role("button", name="Filters", exact=True))
            trap(page, page.get_by_role("dialog", name="Filters"))
            closes(page, "Filters", "Filters")
    elif case == "defect-kind":
        with app_page(browser, app_url) as page:
            sign_in_page(page, app_url, HAND)
            open_yard(page, app_url)
            fill(page.get_by_role("textbox", name="Length (mm)"), "2000")
            strip = page.get_by_role("img", name="Intake strip")
            x0, y = strip_point(strip, 600)
            x1, _ = strip_point(strip, 800)
            mouse_drag(page, x0, y, x1)
            trap(page, defect_sheet(page))
            closes(page, "Defect kind", "Intake strip")
            expect(page.get_by_role("list", name="Defect zones").get_by_role("listitem")).to_have_count(0)
    else:
        _, _, sale, _ = make_sale(app_url)
        ticket = sale["ticket"]
        assert api(app_url, HAND).post(f"/api/tickets/{ticket}/start", json={}).status_code == 200
        with app_page(browser, app_url) as page:
            sign_in_page(page, app_url, HAND)
            open_yard(page, app_url)
            click(page.get_by_role("button", name=f"Mark {ticket} done"))
            dialog = page.get_by_role("dialog", name="Re-measure offcut")
            trap(page, dialog)
            page.get_by_role("textbox", name="Measured offcut (mm)").focus()
            closes(page, "Re-measure offcut", f"Mark {ticket} done")


def test_wf_hold_board(browser, app_url, killbill):
    tag = listed_board(app_url)["tag"]
    with app_page(browser, app_url) as page:
        page.goto(f"{app_url}/sign-in")
        ui_sign_in(page, app_url, INES)
        goto_board(page, app_url, tag)
        layout_ready_to_hold(page, app_url, tag, [PIECE_A])
        click(page.get_by_role("button", name="Hold board", exact=True))
        dialog = page.get_by_role("dialog", name="Hold this board")
        eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
        fill(dialog.get_by_role("textbox", name="Card number"), "1234")
        click(dialog.get_by_role("button", name="Pay deposit and hold"))
        shows(page, dialog, COPY["invalid_card"])
        fill(dialog.get_by_role("textbox", name="Card number"), CARD)
        click(dialog.get_by_role("button", name="Pay deposit and hold"))
        shows(page, page.get_by_role("status", name="Hold status"), COPY["held_ok"])
        hold = next(h for h in api(app_url, INES).get("/api/holds").json()["holds"] if h["board"] == tag)
        shows(page, page.locator("body"), f"Held until {when(hold['expires_at'])}")
        page.goto(f"{app_url}/account")
        expect(page.get_by_role("link", name=tag, exact=True).first).to_be_visible(timeout=REAL_WAIT_S * 1000)
        card_shows(page, tag, "Held")
    payment = kb_payment(killbill, INES[0], hold["killbill_payment_id"])
    assert txns(payment, "PURCHASE") and hold["status"] == "held"


@pytest.mark.parametrize("case", SIGN_IN_CASES, ids=SIGN_IN_CASES)
def test_wf_hold_sign_in_return(browser, app_url, case):
    if case == "foreign-next":
        for nxt, want in ((FOREIGN_RELATIVE, "/"), (FOREIGN_ORIGIN + "/x", "/"), ("/account", "/account")):
            with app_page(browser, app_url) as page:
                ui_sign_in(page, app_url, INES, nxt)
                page.wait_for_url(lambda u: urlsplit(u).path == want, timeout=REAL_WAIT_S * 1000)
                assert same_origin(page.url, app_url)
        return
    tag = listed_board(app_url)["tag"]
    verdict = api_fit(app_url, tag, [PIECE_A])["verdict"]
    with app_page(browser, f"{app_url}/boards/{tag}") as page:
        if case == "ended-session":
            sign_in_page(page, app_url, INES)
            page.reload()
            wait_board(page, tag)
            layout_ready_to_hold(page, app_url, tag, [PIECE_A])
            assert page.request.delete(f"{app_url}/api/session").status == 204
            click(page.get_by_role("button", name="Hold board", exact=True))
        else:
            wait_board(page, tag)
            add_piece(page, "Shelf A", 600, 100)
            expect_chip(page, chip_name("Shelf A", 600, 0))
            fit_and_hear(page, verdict)
            click(page.get_by_role("link", name="Sign in to hold"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/sign-in", timeout=REAL_WAIT_S * 1000)
        assert dict(parse_qsl(urlsplit(page.url).query)).get("next") == f"/boards/{tag}"
        ui_sign_in(page, app_url, INES)
        page.wait_for_url(lambda u: urlsplit(u).path == f"/boards/{tag}", timeout=REAL_WAIT_S * 1000)
        expect_chip(page, chip_name("Shelf A", 600, 0), page_ms=TWO_SECONDS_MS)
        shows(page, page.get_by_role("status", name="Fit result"), verdict, page_ms=TWO_SECONDS_MS)
        dialog = page.get_by_role("dialog", name="Hold this board")
        eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t), TWO_SECONDS_MS)
        card = dialog.get_by_role("textbox", name="Card number")
        expect(card).to_have_value("")
        assert focused_name(page) == "Card number"


def test_billing_account_once(app_url, killbill):
    tags = [listed_board(app_url)["tag"] for _ in range(4)]
    clients = [api(app_url, RUTH) for _ in tags]
    results = race([lambda c=c, t=t: place_hold(c, t) for c, t in zip(clients, tags)])
    assert [r.status_code for r in results] == [201] * len(tags), [r.text for r in results]
    account = killbill.account_by_key(RUTH[0])
    assert account and killbill.account(RUTH[0])["accountId"] == account["accountId"]
    ids = {p["paymentId"] for p in killbill.payments(account["accountId"])}
    assert {r.json()["hold"]["killbill_payment_id"] for r in results} <= ids
    assert killbill.default_plugin(account["accountId"]) == "__EXTERNAL_PAYMENT__"


def test_wf_hold_double_press(browser, app_url, killbill):
    for mode in ("click", "enter"):
        tag = listed_board(app_url)["tag"]
        with app_page(browser, f"{app_url}/boards/{tag}") as page:
            sign_in_page(page, app_url, JOEL)
            page.reload()
            wait_board(page, tag)
            layout_ready_to_hold(page, app_url, tag, [PIECE_A])
            sent: list[Any] = []
            page.on("request", lambda r: sent.append(r) if r.method == "POST" and urlsplit(r.url).path == "/api/holds" else None)
            click(page.get_by_role("button", name="Hold board", exact=True))
            dialog = page.get_by_role("dialog", name="Hold this board")
            eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
            fill(dialog.get_by_role("textbox", name="Card number"), CARD)
            pay = dialog.get_by_role("button", name="Pay deposit and hold")
            if mode == "click":
                pay.dblclick()
            else:
                pay.focus()
                page.keyboard.press("Enter")
                page.keyboard.press("Enter")
            shows(page, page.get_by_role("status", name="Hold status"), COPY["held_ok"])
            advance(page, ONE_SECOND_MS)
            assert len(sent) == 1 and sent[0].headers.get("idempotency-key")
        holds = [h for h in api(app_url, JOEL).get("/api/holds").json()["holds"] if h["board"] == tag]
        assert len(holds) == 1
        assert [p for p in kb_payments(killbill, JOEL[0]) if p["paymentExternalKey"].endswith("-" + holds[0]["id"])].__len__() == 1


def test_cancel_with_refund(app_url, killbill):
    board, hold, ines = held_hold(app_url)
    r = ines.post(f"/api/holds/{hold['id']}/cancel", json={})
    assert r.status_code == 200, r.text
    assert (r.json()["hold"]["status"], r.json()["hold"]["release_reason"]) == ("released", "cancelled")
    refunds = txns(kb_payment(killbill, INES[0], hold["killbill_payment_id"]), "REFUND")
    assert len(refunds) == 1 and Decimal(str(refunds[0]["amount"])) == dollars(DEPOSIT_CENTS)
    assert httpx.get(f"{app_url}/api/boards/{board['tag']}", timeout=HTTP_TIMEOUT_S).json()["board"]["status"] == "available"


def test_hold_expiry_untouched(app_url, killbill):
    short = outage_url("APP_SHORT_URL")
    board, hold, ines = held_hold(short)
    assert parse_ts(hold["expires_at"]) > parse_ts(hold["held_at"])
    clock = server_clock(api(short, OWNER))
    wait_server_time(short, clock, parse_ts(hold["expires_at"]) + timedelta(seconds=UNTOUCHED_GRACE_S))
    h = ines.get(f"/api/holds/{hold['id']}").json()["hold"]
    assert (h["status"], h["release_reason"]) == ("released", "expired")
    assert httpx.get(f"{short}/api/boards/{board['tag']}", timeout=HTTP_TIMEOUT_S).json()["board"]["status"] == "available"
    assert ines.get(f"/api/boards/{board['tag']}").json()["board"]["my_hold"] is None
    payment = kb_payment(killbill, INES[0], hold["killbill_payment_id"])
    assert txns(payment, "PURCHASE") and not txns(payment, "REFUND")


def test_wf_release_expiry_at_action(app_url, killbill):
    short = outage_url("APP_SHORT_URL")
    clock = server_clock(api(short, OWNER))
    board, hold, ines = held_hold(short)
    wait_server_time(short, clock, parse_ts(hold["expires_at"]) + timedelta(milliseconds=500))
    api_error(ines.post(f"/api/holds/{hold['id']}/cancel", json={}), 409, "hold_not_active")
    assert not txns(kb_payment(killbill, INES[0], hold["killbill_payment_id"]), "REFUND")
    assert place_hold(api(short, JOEL), board["tag"]).status_code == 201
    board2, hold2, joel = held_hold(short, JOEL)
    before = {p["paymentId"] for p in kb_payments(killbill, JOEL[0])}
    tickets_before = S3("-short").keys("tickets/")
    wait_server_time(short, clock, parse_ts(hold2["expires_at"]) + timedelta(milliseconds=500))
    api_error(purchase(joel, hold2["id"]), 409, "hold_not_active")
    assert {p["paymentId"] for p in kb_payments(killbill, JOEL[0])} == before
    assert S3("-short").keys("tickets/") == tickets_before
    board3, hold3, _ = held_hold(short)
    wait_server_time(short, clock, parse_ts(hold3["expires_at"]) + timedelta(milliseconds=500))
    assert place_hold(api(short, JOEL), board3["tag"]).status_code == 201
    _, active, _ = held_hold(app_url)
    clients = [api(app_url, INES) for _ in range(4)]
    results = race([lambda c=c: c.post(f"/api/holds/{active['id']}/cancel", json={}) for c in clients])
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409]
    for r in results:
        if r.status_code == 409:
            api_error(r, 409, "hold_not_active")
    assert len(txns(kb_payment(killbill, INES[0], active["killbill_payment_id"]), "REFUND")) == 1


def test_wf_release_cancel(browser, app_url, killbill):
    board, hold, _ = held_hold(app_url)
    tag = board["tag"]
    with app_page(browser, app_url) as page:
        page.goto(f"{app_url}/sign-in")
        ui_sign_in(page, app_url, INES)
        page.goto(f"{app_url}/account")
        expect(page.get_by_role("link", name=tag, exact=True).first).to_be_visible(timeout=REAL_WAIT_S * 1000)
        card_button(page, tag, "Cancel hold").click()
        shows(page, page.get_by_role("status", name="Hold status"), COPY["released_ok"])
        page.goto(f"{app_url}/?lot={board['lot']['id']}")
        item = page.get_by_role("list", name="Rack").get_by_role("listitem").filter(has=page.get_by_role("link", name=tag, exact=True))
        eventually(page, lambda t: expect(item).to_have_count(1, timeout=t), TWO_SECONDS_MS)
        assert not re.search(r"\bheld\b", item.inner_text(), re.I)
    assert txns(kb_payment(killbill, INES[0], hold["killbill_payment_id"]), "REFUND")
    assert httpx.get(f"{app_url}/api/boards/{tag}", timeout=HTTP_TIMEOUT_S).json()["board"]["status"] == "available"


def test_cancel_in_place(browser, app_url):
    board, hold, _ = held_hold(app_url)
    tag = board["tag"]
    with app_page(browser, f"{app_url}/boards/{tag}") as viewer, app_page(browser, app_url) as holder:
        sign_in_page(viewer, app_url, JOEL)
        viewer.reload()
        wait_board(viewer, tag)
        add_piece(viewer, "Shelf A", 600, 100)
        expect_chip(viewer, chip_name("Shelf A", 600, 0))
        fit_and_hear(viewer, api_fit(app_url, tag, [PIECE_A])["verdict"])
        verdict = viewer.get_by_role("status", name="Fit result").inner_text()
        assert re.search(r"\bheld\b", body_text(viewer), re.I) and "Held until" not in body_text(viewer)
        sign_in_page(holder, app_url, INES)
        holder.goto(f"{app_url}/account")
        expect(holder.get_by_role("link", name=tag, exact=True).first).to_be_visible(timeout=REAL_WAIT_S * 1000)
        card_button(holder, tag, "Cancel hold").click()
        card_shows(holder, tag, "Released", ONE_SECOND_MS)
        card_shows(holder, tag, "Held until", ONE_SECOND_MS, present=False)
        assert card_button(holder, tag, "Pay and cut") is None and card_button(holder, tag, "Cancel hold") is None
        assert focused_name(holder) == tag
        advance(holder, OTHER_VIEWER_MS)
        expect(holder.get_by_role("status", name="Hold status")).to_contain_text(COPY["released_ok"])
        eventually(viewer, lambda t: (_ for _ in ()).throw(AssertionError("still held")) if re.search(r"\bheld\b", body_text(viewer), re.I) else None, OTHER_VIEWER_MS, LONG_STEP_MS)
        assert "available" in body_text(viewer).lower()
        expect_chip(viewer, chip_name("Shelf A", 600, 0))
        assert viewer.get_by_role("status", name="Fit result").inner_text() == verdict
    r = place_hold(api(app_url, INES), tag)
    assert r.status_code == 201
    with app_page(browser, f"{app_url}/boards/{tag}") as page:
        sign_in_page(page, app_url, INES)
        page.reload()
        wait_board(page, tag)
        expect_chip(page, chip_name("Shelf A", 600, 0), TWO_SECONDS_MS)
        click(page.get_by_role("button", name="Cancel hold"))
        hold_board = page.get_by_role("button", name="Hold board", exact=True)
        eventually(page, lambda t: expect(hold_board).to_be_visible(timeout=t))
        assert "available" in body_text(page).lower()
        assert focused_name(page) == "Hold board"


def test_wf_purchase_rollback(app_url, killbill):
    board, hold, ines = held_hold(app_url)
    yard = yard_id_of(killbill, INES[0], hold)
    tickets = {t["id"] for t in ines.get("/api/tickets").json()["tickets"]}
    objects = set(S3().keys("tickets/"))
    sale_keys = lambda: {p["paymentExternalKey"] for p in kb_payments(killbill, INES[0]) if p["paymentExternalKey"].startswith(f"sale-{yard}-")}
    sales_before = sale_keys()
    key = idempotency_key()
    api_error(purchase(api(outage_url("APP_MINIO_DOWN_URL"), INES), hold["id"], key), 503, "storage_unavailable")
    api_error(purchase(api(outage_url("APP_KILLBILL_DOWN_URL"), INES), hold["id"], key), 503, "billing_unavailable")
    assert sale_keys() == sales_before
    assert set(S3().keys("tickets/")) == objects
    assert {t["id"] for t in ines.get("/api/tickets").json()["tickets"]} == tickets
    assert ines.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "held"
    assert httpx.get(f"{app_url}/api/boards/{board['tag']}", timeout=HTTP_TIMEOUT_S).json()["board"]["status"] == "held"
    r = purchase(ines, hold["id"], key)
    assert r.status_code == 201, r.text
    sale = r.json()["sale"]
    assert f"tickets/{sale['ticket']}.pdf" in S3().keys("tickets/")
    assert f"sale-{yard}-{sale['ticket']}" in sale_keys()


def test_purchase_amount(app_url, killbill):
    board, hold, sale, ines = make_sale(app_url, pieces=EX_PIECES, length=KW1_SIZE[0], width=KW1_SIZE[1], thickness=KW1_SIZE[2], species="White oak", grade="Character", lot="LOT-01", defects=KW1_DEFECTS)
    assert set(sale) == SALE_KEYS
    assert (sale["price_cents"], sale["deposit_cents"], sale["amount_cents"], sale["sale"]) == (EX_PRICE, DEPOSIT_CENTS, EX_AMOUNT, "cut")
    yard = yard_id_of(killbill, INES[0], hold)
    payment = killbill.payment_by_key(f"sale-{yard}-{sale['ticket']}")
    assert payment and payment["paymentId"] == sale["killbill_payment_id"]
    buys = txns(payment, "PURCHASE")
    assert len(buys) == 1 and Decimal(str(buys[0]["amount"])) == dollars(EX_AMOUNT)
    invoice = ines.get(f"/api/invoices/{sale['invoice']}").json()["invoice"]
    assert set(invoice) == INVOICE_KEYS and re.fullmatch(r"INV-\d{4}", invoice["id"])
    assert (invoice["status"], invoice["price_cents"], invoice["deposit_cents"], invoice["amount_cents"]) == ("paid", EX_PRICE, DEPOSIT_CENTS, EX_AMOUNT)
    assert invoice["lines"] == [{"label": "Shelf A", "length_mm": 600, "amount_cents": EX_LINES[0]}, {"label": "Shelf B", "length_mm": 800, "amount_cents": EX_LINES[1]}]
    assert invoice["killbill_payment_id"] == payment["paymentId"]


def test_split_ledger(app_url):
    owner = api(app_url, OWNER)
    board, _, sale, _ = make_sale(app_url, pieces=EX_PIECES, length=KW1_SIZE[0], width=KW1_SIZE[1], thickness=KW1_SIZE[2], species="White oak", grade="Character", lot="LOT-01", defects=KW1_DEFECTS)
    parent, t, w = board["tag"], KW1_SIZE[2], KW1_SIZE[1]
    offcut = sale["offcut"]["tag"]
    split = [m for m in ledger(owner, f"board:{parent}") if m["kind"] == "split"]
    assert len(split) == 1 and split[0]["ticket"] == sale["ticket"] and split[0]["by"] == {"name": NAME[INES[0]]}
    assert entries(split[0]) == {f"board:{parent}": -board["volume_mm3"], f"sold:{sale['ticket']}": t * w * EX_TAKE, f"board:{offcut}": t * w * EX_OFFCUT, "kerf": t * w * KERF_ALLOWANCE_MM}
    assert balance(owner, f"board:{parent}") == 0
    p = owner.get(f"/api/boards/{parent}").json()["board"]
    assert p["status"] == "cut" and p["price_cents"] is None
    o = owner.get(f"/api/boards/{offcut}").json()["board"]
    assert (o["status"], o["parent_tag"], o["length_mm"], o["width_mm"], o["thickness_mm"], o["species"], o["grade"], o["lot"]["id"]) == ("graded", parent, EX_OFFCUT, w, t, "White oak", "Character", "LOT-01")
    shift = EX_TAKE + KERF_ALLOWANCE_MM
    assert o["defects"] == [{"kind": d["kind"], "start_mm": d["start_mm"] - shift, "end_mm": d["end_mm"] - shift} for d in KW1_DEFECTS if d["start_mm"] >= shift]
    whole_board, _, whole, _ = make_sale(app_url, pieces=[piece("Shelf A", 800, 0)], length=1000)
    assert whole["sale"] == "whole" and whole["offcut"] is None
    moves = [m for m in ledger(owner, f"board:{whole_board['tag']}") if m["kind"] == "whole-sale"]
    assert len(moves) == 1 and entries(moves[0]) == {f"board:{whole_board['tag']}": -whole_board["volume_mm3"], f"sold:{whole['ticket']}": whole_board["volume_mm3"]}
    assert owner.get(f"/api/boards/{whole_board['tag']}").json()["board"]["status"] == "sold-whole"


def test_wf_purchase_buy(browser, app_url, killbill):
    board, hold, ines = held_hold(app_url)
    tag = board["tag"]
    with app_page(browser, app_url) as page:
        page.goto(f"{app_url}/sign-in")
        ui_sign_in(page, app_url, INES)
        goto_board(page, app_url, tag)
        expect_chip(page, chip_name("Shelf A", 600, 0), TWO_SECONDS_MS)
        click(page.get_by_role("button", name="Pay and cut"))
        status = page.get_by_role("status", name="Hold status")
        shows(page, status, "Paid. Cut ticket CT-")
        ticket = re.search(r"Paid\. Cut ticket (CT-\d{4}) is with the saw\.", status.inner_text()).group(1)
        invoice = next(i for i in ines.get("/api/invoices").json()["invoices"] if i["ticket"] == ticket)
        page.goto(f"{app_url}/account")
        expect(page.get_by_role("link", name=ticket, exact=True)).to_be_visible(timeout=REAL_WAIT_S * 1000)
        expect(page.get_by_role("list", name=f"Lines on {invoice['id']}")).to_contain_text(f"Shelf A ${money(invoice['lines'][0]['amount_cents'])}")
    yard = yard_id_of(killbill, INES[0], hold)
    payment = killbill.payment_by_key(f"sale-{yard}-{ticket}")
    assert payment and txns(payment, "PURCHASE") and invoice["amount_cents"] == hold["price_cents"] - DEPOSIT_CENTS


def test_invoice_lines(browser, app_url):
    rate = rate_in_force(app_url, "Black walnut", "Select")
    take = 1520
    width = next(w for w in range(150, 200) if price_cents(40, w, take, rate) % 3 and price_cents(40, w, take, rate) > DEPOSIT_CENTS)
    pieces = [piece("Shelf A", 500, 0), piece("Shelf B", 500, 510), piece("Shelf C", 500, 1020)]
    _, hold, sale, ines = make_sale(app_url, pieces=pieces, width=width)
    invoice = ines.get(f"/api/invoices/{sale['invoice']}").json()["invoice"]
    expected = invoice_lines(hold["price_cents"], [500, 500, 500])
    assert [l["amount_cents"] for l in invoice["lines"]] == expected and sum(expected) == hold["price_cents"]
    assert expected[0] >= expected[1] >= expected[2] and expected[0] > expected[2]
    with app_page(browser, f"{app_url}/account") as page:
        sign_in_page(page, app_url, INES)
        page.reload()
        items = page.get_by_role("list", name=f"Lines on {sale['invoice']}").get_by_role("listitem")
        expect(items).to_have_count(3, timeout=REAL_WAIT_S * 1000)
        for i, p in enumerate(pieces):
            expect(items.nth(i)).to_contain_text(f"{p['label']} ${money(expected[i])}")


def test_stored_ticket_pdf(app_url):
    _, _, sale, ines = make_sale(app_url)
    stored = S3().get(f"tickets/{sale['ticket']}.pdf")
    assert stored.startswith(b"%PDF")
    for client in (ines, api(app_url, HAND), api(app_url, OWNER), ines):
        r = client.get(f"/api/tickets/{sale['ticket']}/pdf")
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf") and r.content == stored
    t = api(app_url, HAND).get(f"/api/tickets/{sale['ticket']}").json()["ticket"]
    assert t["pdf_key"] == f"tickets/{sale['ticket']}.pdf"


def pdf_texts(data: bytes) -> list[bytes]:
    out = [data]
    for m in re.finditer(rb"stream\r?\n", data):
        end = data.find(b"endstream", m.end())
        with suppress(zlib.error):
            out.append(zlib.decompress(data[m.end() : end]))
    return out


def test_ticket_pdf_private(app_url, killbill):
    _, hold, sale, _ = make_sale(app_url)
    yard = yard_id_of(killbill, INES[0], hold)
    account = killbill.account_by_key(INES[0])["accountId"]
    banned = [INES[0], CARD.replace(" ", ""), CARD, hold["killbill_payment_id"], sale["killbill_payment_id"], account, yard, f"hold-{yard}-{hold['id']}", f"sale-{yard}-{sale['ticket']}"]
    for chunk in pdf_texts(S3().get(f"tickets/{sale['ticket']}.pdf")):
        for value in banned:
            for encoded in (value.encode(), value.encode("utf-16-be"), value.encode().hex().upper().encode(), value.encode().hex().encode()):
                assert encoded not in chunk, value
        assert b"@" not in re.sub(rb"[^\x20-\x7e]", b"", chunk) or INES[0].split("@")[1].encode() not in chunk


def test_saw_progression(app_url):
    defects = [{"kind": "check", "start_mm": 1980, "end_mm": 2000}]
    board, _, sale, _ = make_sale(app_url, defects=defects)
    hand, owner = api(app_url, HAND), api(app_url, OWNER)
    ticket = sale["ticket"]
    planned = sale["offcut"]["length_mm"]
    api_error(hand.post(f"/api/tickets/{ticket}/done", json={"offcut_mm": planned}), 409, "ticket_state")
    r = hand.post(f"/api/tickets/{ticket}/start", json={})
    assert r.status_code == 200 and r.json()["ticket"]["status"] == "at-saw"
    api_error(hand.post(f"/api/tickets/{ticket}/start", json={}), 409, "ticket_state")
    for bad in ({"offcut_mm": 0}, {"offcut_mm": planned + 1}, {}):
        field_error(hand.post(f"/api/tickets/{ticket}/done", json=bad), "offcut_mm")
    measured = planned - 6
    r = hand.post(f"/api/tickets/{ticket}/done", json={"offcut_mm": measured})
    assert r.status_code == 200
    t = r.json()["ticket"]
    assert set(t) == TICKET_KEYS and t["status"] == "done" and t["offcut"] == {"tag": sale["offcut"]["tag"], "planned_mm": planned, "measured_mm": measured}
    off = owner.get(f"/api/boards/{sale['offcut']['tag']}").json()["board"]
    start = DEFAULT_SIZE[0] - planned
    assert off["length_mm"] == measured and off["defects"] == [{"kind": "check", "start_mm": 1980 - start, "end_mm": measured}]
    trims = [m for m in ledger(owner, f"board:{off['tag']}") if m["kind"] == "trim"]
    vol = DEFAULT_SIZE[1] * DEFAULT_SIZE[2] * 6
    assert len(trims) == 1 and trims[0]["ticket"] == ticket and entries(trims[0]) == {f"board:{off['tag']}": -vol, "kerf": vol}
    assert balance(owner, f"board:{off['tag']}") == DEFAULT_SIZE[1] * DEFAULT_SIZE[2] * measured
    api_error(hand.post(f"/api/tickets/{ticket}/done", json={"offcut_mm": measured}), 409, "ticket_state")
    _, _, whole, _ = make_sale(app_url, pieces=[piece("Shelf A", 800, 0)], length=1000)
    assert hand.post(f"/api/tickets/{whole['ticket']}/start", json={}).status_code == 200
    field_error(hand.post(f"/api/tickets/{whole['ticket']}/done", json={"offcut_mm": 5}), "offcut_mm")
    assert hand.post(f"/api/tickets/{whole['ticket']}/done", json={}).json()["ticket"]["status"] == "done"


def test_one_winner_at_saw(app_url):
    board, _, sale, _ = make_sale(app_url)
    ticket, planned = sale["ticket"], sale["offcut"]["length_mm"]
    clients = [api(app_url, HAND) for _ in range(3)] + [api(app_url, OWNER) for _ in range(3)]
    starts = race([lambda c=c: c.post(f"/api/tickets/{ticket}/start", json={}) for c in clients])
    assert sorted(r.status_code for r in starts) == [200] + [409] * 5
    for r in starts:
        if r.status_code == 409:
            api_error(r, 409, "ticket_state")
    values = [planned - i for i in range(1, 7)]
    dones = race([lambda c=c, v=v: c.post(f"/api/tickets/{ticket}/done", json={"offcut_mm": v}) for c, v in zip(clients, values)])
    wins = [(r, v) for r, v in zip(dones, values) if r.status_code == 200]
    assert len(wins) == 1
    for r in dones:
        if r.status_code != 200:
            api_error(r, 409, "ticket_state")
    t = api(app_url, OWNER).get(f"/api/tickets/{ticket}").json()["ticket"]
    assert t["offcut"]["measured_mm"] == wins[0][1]
    assert [e["kind"] for e in t["events"]] == ["issued", "started", "done"]
    trims = [m for m in ledger(api(app_url, OWNER), f"board:{sale['offcut']['tag']}") if m["kind"] == "trim"]
    assert len(trims) == 1 and entries(trims[0])["kerf"] == DEFAULT_SIZE[1] * DEFAULT_SIZE[2] * (planned - wins[0][1])


def test_wf_saw_work_ticket(browser, app_url):
    _, _, sale, _ = make_sale(app_url)
    ticket, offcut = sale["ticket"], sale["offcut"]["tag"]
    measured = sale["offcut"]["length_mm"] - 4
    with app_page(browser, app_url) as page:
        page.goto(f"{app_url}/sign-in")
        ui_sign_in(page, app_url, HAND)
        open_yard(page, app_url)
        status = page.get_by_role("status", name="Saw status")
        click(page.get_by_role("button", name=f"Start cut {ticket}"))
        shows(page, status, f"Ticket {ticket} is at the saw.")
        click(page.get_by_role("button", name=f"Mark {ticket} done"))
        dialog = page.get_by_role("dialog", name="Re-measure offcut")
        eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
        fill(dialog.get_by_role("textbox", name="Measured offcut (mm)"), str(measured))
        click(dialog.get_by_role("button", name="Save"))
        shows(page, status, f"Ticket {ticket} done. Offcut {offcut} is {measured} mm.")
    with app_page(browser, app_url) as page:
        sign_in_page(page, app_url, OWNER)
        page.goto(f"{app_url}/owner")
        click(page.get_by_role("button", name=f"List {offcut} on the rack"))
        shows(page, page.get_by_role("status", name="Rate status"), COPY["saved"])
    board = httpx.get(f"{app_url}/api/boards/{offcut}", timeout=HTTP_TIMEOUT_S).json()["board"]
    assert board["status"] == "available" and board["length_mm"] == measured
    assert api(app_url, HAND).get(f"/api/tickets/{ticket}").json()["ticket"]["status"] == "done"


def test_wf_saw_conflict_copy(browser, app_url):
    _, _, sale, _ = make_sale(app_url)
    ticket, planned = sale["ticket"], sale["offcut"]["length_mm"]
    owner = api(app_url, OWNER)
    with app_page(browser, app_url) as page:
        sign_in_page(page, app_url, HAND)
        open_yard(page, app_url)
        start = page.get_by_role("button", name=f"Start cut {ticket}")
        expect(start).to_be_visible(timeout=REAL_WAIT_S * 1000)
        assert owner.post(f"/api/tickets/{ticket}/start", json={}).status_code == 200
        click(start)
        status = page.get_by_role("status", name="Saw status")
        shows(page, status, f"Ticket {ticket} was already started by {NAME[OWNER[0]]}.")
        done = page.get_by_role("button", name=f"Mark {ticket} done")
        eventually(page, lambda t: expect(done).to_be_visible(timeout=t))
        assert owner.post(f"/api/tickets/{ticket}/done", json={"offcut_mm": planned - 2}).status_code == 200
        click(done)
        dialog = page.get_by_role("dialog", name="Re-measure offcut")
        eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
        fill(dialog.get_by_role("textbox", name="Measured offcut (mm)"), str(planned))
        click(dialog.get_by_role("button", name="Save"))
        shows(page, status, f"Ticket {ticket} was already marked done by {NAME[OWNER[0]]}.")
        t = owner.get(f"/api/tickets/{ticket}").json()["ticket"]
        assert [(e["kind"], e["by"]["name"]) for e in t["events"]] == [("issued", NAME[INES[0]]), ("started", NAME[OWNER[0]]), ("done", NAME[OWNER[0]])]
        assert t["offcut"]["measured_mm"] == planned - 2
        page.goto(f"{app_url}/tickets/{ticket}")
        rows = page.get_by_role("list", name="Ticket history").get_by_role("listitem")
        expect(rows).to_have_count(3, timeout=REAL_WAIT_S * 1000)
        for i, (kind, e) in enumerate(zip(("Issued", "Started", "Done"), t["events"])):
            expect(rows.nth(i)).to_contain_text(f"{kind} by {e['by']['name']}, {when(e['at'])}")
        expect(page.get_by_role("link", name="Ticket PDF")).to_be_visible()
    moves = ledger(owner, f"board:{sale['offcut']['tag']}")
    assert {m["kind"]: m["by"]["name"] for m in moves} == {"split": NAME[INES[0]], "trim": NAME[OWNER[0]]}


def lineage_setup(base: str) -> dict[str, Any]:
    board, _, sale, _ = make_sale(base, length=3000)
    finish_ticket(base, sale["ticket"])
    owner = api(base, OWNER)
    offcut = sale["offcut"]["tag"]
    assert owner.post(f"/api/boards/{offcut}/list", json={}).status_code == 200
    intake = tag_board(api(base, HAND))["tag"]
    r = owner.put(f"/api/boards/{intake}/parent", json={"parent_tag": board["tag"]})
    assert r.status_code == 200, r.text
    return {"parent": board["tag"], "offcut": offcut, "intake": intake, "sale": sale}


def test_board_lineage(app_url):
    s = lineage_setup(app_url)
    _, sale2 = None, purchase(*(lambda h: (api(app_url, JOEL), h))(place_hold(api(app_url, JOEL), s["offcut"]).json()["hold"]["id"])).json()["sale"]
    grand = sale2["offcut"]["tag"]
    hand = api(app_url, HAND)
    tree = hand.get(f"/api/boards/{s['offcut']}/lineage").json()
    assert tree["board"] == s["offcut"]
    root = tree["root"]
    assert set(root) == LINEAGE_KEYS and root["tag"] == s["parent"] and root["parent_tag"] is None
    assert [c["tag"] for c in root["children"]] == [s["offcut"]]
    mid = root["children"][0]
    assert mid["parent_tag"] == s["parent"] and [c["tag"] for c in mid["children"]] == [grand] and mid["children"][0]["children"] == []
    full = hand.get(f"/api/boards/{s['parent']}/lineage").json()["root"]
    assert [c["tag"] for c in full["children"]] == [s["offcut"], s["intake"]]
    assert [c["tag"] for c in full["children"][0]["children"]] == [grand]
    created = [parse_ts(c["created_at"]) for c in full["children"]]
    assert created == sorted(created)
    seed = hand.get(f"/api/boards/{CLEAR_SEED_TAG}/lineage").json()["root"]
    assert parse_ts(seed["created_at"]) == parse_ts(SEED_CREATED) and seed["children"] == []


def test_lineage_remeasure(app_url):
    s = lineage_setup(app_url)
    owner, ines = api(app_url, OWNER), api(app_url, INES)
    invoice_before = ines.get(f"/api/invoices/{s['sale']['invoice']}").json()
    ticket_before = owner.get(f"/api/tickets/{s['sale']['ticket']}").json()
    before = {t: owner.get(f"/api/boards/{t}").json()["board"] for t in (s["parent"], s["offcut"], s["intake"])}
    r = owner.put(f"/api/boards/{s['parent']}/dimensions", json={"width_mm": 150, "thickness_mm": 30})
    assert r.status_code == 200, r.text
    assert r.json()["changed"] == [s["offcut"], s["intake"]]
    for tag in (s["offcut"], s["intake"]):
        b = owner.get(f"/api/boards/{tag}").json()["board"]
        assert (b["width_mm"], b["thickness_mm"], b["length_mm"]) == (150, 30, before[tag]["length_mm"])
        assert b["volume_mm3"] == 150 * 30 * b["length_mm"] == balance(owner, f"board:{tag}")
    p = owner.get(f"/api/boards/{s['parent']}").json()["board"]
    assert (p["width_mm"], p["thickness_mm"]) == (before[s["parent"]]["width_mm"], before[s["parent"]]["thickness_mm"])
    adj = [m for m in ledger(owner, f"board:{s['offcut']}") if m["kind"] == "adjustment"]
    assert len(adj) == 1 and adj[0]["by"] == {"name": NAME[OWNER[0]]} and adj[0]["ticket"] is None
    e = entries(adj[0])
    deltas = {t: 150 * 30 * before[t]["length_mm"] - before[t]["volume_mm3"] for t in (s["offcut"], s["intake"])}
    assert e == {f"board:{s['offcut']}": deltas[s["offcut"]], f"board:{s['intake']}": deltas[s["intake"]], "adjustment": -sum(deltas.values())}
    assert ines.get(f"/api/invoices/{s['sale']['invoice']}").json() == invoice_before
    assert owner.get(f"/api/tickets/{s['sale']['ticket']}").json() == ticket_before
    api_error(owner.put(f"/api/boards/{s['parent']}/dimensions", json={"width_mm": 150, "thickness_mm": 30, "length_mm": 2000}), 409, "board_state")
    r = owner.put(f"/api/boards/{s['offcut']}/dimensions", json={"width_mm": 150, "thickness_mm": 30, "length_mm": 2000})
    assert r.status_code == 200 and r.json()["changed"] == [s["offcut"]] and r.json()["board"]["length_mm"] == 2000


def test_lineage_refusals(app_url):
    s = lineage_setup(app_url)
    owner = api(app_url, OWNER)
    hold = place_hold(api(app_url, JOEL), s["offcut"]).json()["hold"]
    adj_before = len(ledger(owner, f"board:{s['intake']}"))
    api_error(owner.put(f"/api/boards/{s['parent']}/dimensions", json={"width_mm": 150, "thickness_mm": 30}), 409, "board_state")
    assert owner.get(f"/api/boards/{s['intake']}").json()["board"]["width_mm"] == DEFAULT_SIZE[1]
    assert len(ledger(owner, f"board:{s['intake']}")) == adj_before
    api(app_url, JOEL).post(f"/api/holds/{hold['id']}/cancel", json={})
    board2, _, sale2, _ = make_sale(app_url)
    api_error(owner.put(f"/api/boards/{board2['tag']}/dimensions", json={"width_mm": 150, "thickness_mm": 30}), 409, "offcut_not_cut")
    api_error(owner.post(f"/api/boards/{board2['tag']}/grade", json={"grade": "Rustic"}), 409, "offcut_not_cut")
    off = owner.get(f"/api/boards/{sale2['offcut']['tag']}").json()["board"]
    assert (off["width_mm"], off["grade"]) == (DEFAULT_SIZE[1], "Select")
    whole_board, _, _, _ = make_sale(app_url, pieces=[piece("Shelf A", 800, 0)], length=1000)
    api_error(owner.put(f"/api/boards/{whole_board['tag']}/dimensions", json={"width_mm": 150, "thickness_mm": 30}), 409, "board_state")


def test_lineage_regrade_and_reparent(app_url):
    s = lineage_setup(app_url)
    owner = api(app_url, OWNER)
    moves_before = len(ledger(owner, f"board:{s['offcut']}"))
    r = owner.post(f"/api/boards/{s['parent']}/grade", json={"grade": "Rustic"})
    assert r.status_code == 200 and r.json()["changed"] == [s["offcut"]]
    off = owner.get(f"/api/boards/{s['offcut']}").json()["board"]
    assert off["grade"] == "Rustic" and off["status"] == "available"
    assert off["price_cents"] == price_cents(off["thickness_mm"], off["width_mm"], off["length_mm"], rate_in_force(app_url, "Black walnut", "Rustic"))
    assert owner.get(f"/api/boards/{s['parent']}").json()["board"]["grade"] == "Select"
    assert owner.get(f"/api/boards/{s['intake']}").json()["board"]["grade"] is None
    assert len(ledger(owner, f"board:{s['offcut']}")) == moves_before
    root = tag_board(api(app_url, HAND))["tag"]
    api_error(owner.put(f"/api/boards/{root}/parent", json={"parent_tag": root}), 409, "lineage_cycle")
    api_error(owner.put(f"/api/boards/{s['parent']}/parent", json={"parent_tag": s["intake"]}), 409, "lineage_cycle")
    api_error(owner.put(f"/api/boards/{s['offcut']}/parent", json={"parent_tag": s["parent"]}), 409, "board_state")
    field_error(owner.put(f"/api/boards/{s['intake']}/parent", json={"parent_tag": "KW-0009"}), "parent_tag")
    r = owner.put(f"/api/boards/{s['intake']}/parent", json={"parent_tag": None})
    assert r.status_code == 200 and r.json()["board"]["parent_tag"] is None
    assert [c["tag"] for c in owner.get(f"/api/boards/{s['parent']}/lineage").json()["root"]["children"]] == [s["offcut"]]


def test_lineage_concurrent(app_url):
    s = lineage_setup(app_url)
    widths = [150, 160, 170, 180]
    results = race([lambda w=w: api(app_url, OWNER).put(f"/api/boards/{s['parent']}/dimensions", json={"width_mm": w, "thickness_mm": 30}) for w in widths])
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    owner = api(app_url, OWNER)
    boards = [owner.get(f"/api/boards/{t}").json()["board"] for t in (s["offcut"], s["intake"])]
    assert boards[0]["width_mm"] == boards[1]["width_mm"] and boards[0]["width_mm"] in widths
    for b in boards:
        assert balance(owner, f"board:{b['tag']}") == b["thickness_mm"] * b["width_mm"] * b["length_mm"]


def test_wf_outages_billing(browser, app_url, killbill):
    down = outage_url("APP_KILLBILL_DOWN_URL")
    assert httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
    wait_service(down, "billing", "down")
    board = listed_board(app_url)
    assert httpx.get(f"{down}/api/boards/{board['tag']}", timeout=HTTP_TIMEOUT_S).status_code == 200
    assert api_fit(down, board["tag"], [PIECE_A])["verdict"]
    maker = api(down, INES)
    api_error(place_hold(maker, board["tag"]), 503, "billing_unavailable")
    assert httpx.get(f"{app_url}/api/boards/{board['tag']}", timeout=HTTP_TIMEOUT_S).json()["board"]["status"] == "available"
    _, hold, _ = held_hold(app_url)
    api_error(maker.post(f"/api/holds/{hold['id']}/cancel", json={}), 503, "billing_unavailable")
    api_error(purchase(maker, hold["id"]), 503, "billing_unavailable")
    h = api(app_url, INES).get(f"/api/holds/{hold['id']}").json()["hold"]
    assert h["status"] == "held"
    assert not txns(kb_payment(killbill, INES[0], hold["killbill_payment_id"]), "REFUND")
    with app_page(browser, f"{down}/boards/{board['tag']}") as page:
        sign_in_page(page, down, JOEL)
        page.reload()
        wait_board(page, board["tag"])
        shows(page, page.get_by_role("status", name="Service notice"), COPY["billing_banner"], BANNER_MS, LONG_STEP_MS)
        add_piece(page, "Shelf A", 600, 100)
        fit_and_hear(page, api_fit(app_url, board["tag"], [PIECE_A])["verdict"])
        paused = page.get_by_role("button", name=COPY["holds_paused"])
        expect(paused).to_be_visible()
        expect(paused).to_be_disabled()


def test_wf_outages_storage(browser, app_url):
    down = outage_url("APP_MINIO_DOWN_URL")
    wait_service(down, "storage", "down")
    hand = api(down, HAND)
    tag = tag_board(hand)["tag"]
    api_error(hand.post(f"/api/boards/{tag}/photos", content=png_bytes(8, 8), headers={"Content-Type": "image/png"}), 503, "storage_unavailable")
    main_hand = api(app_url, HAND)
    other = tag_board(main_hand)["tag"]
    pid = main_hand.post(f"/api/boards/{other}/photos", content=png_bytes(8, 8), headers={"Content-Type": "image/png"}).json()["photo"]["id"]
    api_error(hand.get(f"/api/photos/{pid}"), 503, "storage_unavailable")
    api_error(hand.get(f"/api/photos/{pid}/original"), 503, "storage_unavailable")
    _, _, sale, _ = make_sale(app_url)
    api_error(hand.get(f"/api/tickets/{sale['ticket']}/pdf"), 503, "storage_unavailable")
    with app_page(browser, down) as page:
        sign_in_page(page, down, HAND)
        open_yard(page, down)
        shows(page, page.get_by_role("status", name="Service notice"), COPY["storage_banner"], BANNER_MS, LONG_STEP_MS)
        select(page.get_by_role("combobox", name="Lot"), LOTS["LOT-02"])
        select(page.get_by_role("combobox", name="Species"), "Heart pine")
        fill(page.get_by_role("textbox", name="Length (mm)"), "1800")
        fill(page.get_by_role("textbox", name="Width (mm)"), "140")
        fill(page.get_by_role("textbox", name="Thickness (mm)"), "38")
        page.get_by_label("Board photos").set_input_files(files=[{"name": "p.png", "mimeType": "image/png", "buffer": png_bytes(16, 16)}])
        click(page.get_by_role("button", name="Tag board", exact=True))
        status = page.get_by_role("status", name="Intake status")
        shows(page, status, COPY["photos_not_saved"])
        new_tag = re.search(r"Tagged (KW-\d{4})\.", status.inner_text()).group(1)
    assert main_hand.get(f"/api/boards/{new_tag}").json()["board"]["status"] == "tagged"


@pytest.mark.parametrize("service", SERVICE_CASES, ids=SERVICE_CASES)
def test_wf_outages_recovery(browser, app_url, killbill, service):
    with relayed_copy(service, start_up=False) as (base, relay):
        wait_service(base, service, "down")
        if service == "billing":
            board = listed_board(app_url)
            api_error(place_hold(api(base, JOEL), board["tag"]), 503, "billing_unavailable")
            url, banner, who = f"{base}/boards/{board['tag']}", COPY["billing_banner"], JOEL
        else:
            tag = tag_board(api(base, HAND))["tag"]
            api_error(api(base, HAND).post(f"/api/boards/{tag}/photos", content=png_bytes(8, 8), headers={"Content-Type": "image/png"}), 503, "storage_unavailable")
            url, banner, who = f"{base}/yard", COPY["storage_banner"], HAND
        with app_page(browser, base) as page:
            sign_in_page(page, base, who)
            page.goto(url)
            notice = page.get_by_role("status", name="Service notice")
            shows(page, notice, banner, BANNER_MS, LONG_STEP_MS)
            relay.start()
            wait_service(base, service, "up")
            eventually(page, lambda t: expect(notice).not_to_contain_text(banner, timeout=t), BANNER_MS, LONG_STEP_MS)
        if service == "billing":
            r = place_hold(api(base, JOEL), board["tag"])
            assert r.status_code == 201, r.text
            assert txns(kb_payment(killbill, JOEL[0], r.json()["hold"]["killbill_payment_id"]), "PURCHASE")
        else:
            r = api(base, HAND).post(f"/api/boards/{tag}/photos", content=png_bytes(8, 8), headers={"Content-Type": "image/png"})
            assert r.status_code == 201, r.text
            assert len(S3().keys(f"photos/{tag}/")) == 3
        relay.stop()
        wait_service(base, service, "down")
        relay.start()
        wait_service(base, service, "up")


def test_wf_outages_open_work(browser, app_url):
    tag = listed_board(app_url)["tag"]
    with relayed_copy("billing") as (base, relay):
        wait_service(base, "billing", "up")
        with app_page(browser, f"{base}/boards/{tag}") as page:
            sign_in_page(page, base, INES)
            page.reload()
            wait_board(page, tag)
            layout_ready_to_hold(page, base, tag, [PIECE_A])
            verdict = page.get_by_role("status", name="Fit result").inner_text()
            totals = page.get_by_role("status", name="Layout totals").inner_text()
            click(page.get_by_role("button", name="Hold board", exact=True))
            dialog = page.get_by_role("dialog", name="Hold this board")
            eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
            card = dialog.get_by_role("textbox", name="Card number")
            fill(card, CARD)
            card.focus()
            relay.stop()
            wait_service(base, "billing", "down")
            notice = page.get_by_role("status", name="Service notice")
            shows(page, notice, COPY["billing_banner"], BANNER_MS, LONG_STEP_MS)
            expect(dialog).to_be_visible()
            expect(card).to_have_value(CARD)
            assert focused_name(page) == "Card number"
            expect(dialog.get_by_role("button", name=COPY["holds_paused"])).to_be_disabled()
            assert page.get_by_role("status", name="Fit result").inner_text() == verdict
            assert page.get_by_role("status", name="Layout totals").inner_text() == totals
            expect(chip(page, chip_name("Shelf A", 600, 0))).to_have_count(1)
            relay.start()
            wait_service(base, "billing", "up")
            eventually(page, lambda t: expect(notice).not_to_contain_text(COPY["billing_banner"], timeout=t), BANNER_MS, LONG_STEP_MS)
            eventually(page, lambda t: expect(dialog.get_by_role("button", name="Pay deposit and hold")).to_be_enabled(timeout=t))
            expect(card).to_have_value(CARD)
            assert focused_name(page) == "Card number"


@pytest.mark.parametrize("case", OUTAGE_ACTION_CASES, ids=OUTAGE_ACTION_CASES)
def test_honest_billing_failure(browser, app_url, killbill, case):
    with relayed_copy("billing") as (base, relay):
        wait_service(base, "billing", "up")
        if case == "hold":
            tag = listed_board(app_url)["tag"]
            keys: list[str] = []
            with app_page(browser, f"{base}/boards/{tag}") as page:
                sign_in_page(page, base, INES)
                page.reload()
                wait_board(page, tag)
                layout_ready_to_hold(page, base, tag, [PIECE_A])
                page.on("request", lambda r: keys.append(r.headers.get("idempotency-key")) if r.method == "POST" and urlsplit(r.url).path == "/api/holds" else None)
                click(page.get_by_role("button", name="Hold board", exact=True))
                dialog = page.get_by_role("dialog", name="Hold this board")
                eventually(page, lambda t: expect(dialog).to_be_visible(timeout=t))
                card = dialog.get_by_role("textbox", name="Card number")
                fill(card, CARD)
                relay.stop()
                status = page.get_by_role("status", name="Hold status")
                with held(page, "**/api/holds") as gate:
                    click(dialog.get_by_role("button", name="Pay deposit and hold"))
                    shows(page, status, COPY["waiting"])
                    expect(dialog).to_be_visible()
                    assert "Held until" not in body_text(page)
                    gate.release()
                shows(page, status, COPY["hold_offline"])
                expect(dialog).to_be_visible()
                expect(card).to_have_value(CARD)
                assert focused_name(page) == "Card number"
                expect(dialog.get_by_role("button", name=COPY["holds_paused"])).to_be_disabled()
                shows(page, page.get_by_role("status", name="Service notice"), COPY["billing_banner"], TWO_SECONDS_MS, STEP_MS)
                assert "available" in body_text(page).lower()
                relay.start()
                pay = dialog.get_by_role("button", name="Pay deposit and hold")
                eventually(page, lambda t: expect(pay).to_be_enabled(timeout=t), BANNER_MS, LONG_STEP_MS)
                click(pay)
                shows(page, status, COPY["held_ok"])
            assert len(keys) == 2 and keys[0] == keys[1]
            return
        board, hold, _ = held_hold(base)
        tag = board["tag"]
        with app_page(browser, f"{base}/account") as page:
            sign_in_page(page, base, INES)
            page.reload()
            expect(page.get_by_role("link", name=tag, exact=True).first).to_be_visible(timeout=REAL_WAIT_S * 1000)
            relay.stop()
            card_button(page, tag, "Pay and cut" if case == "pay" else "Cancel hold").click()
            shows(page, page.get_by_role("status", name="Hold status"), COPY["pay_offline"] if case == "pay" else COPY["cancel_offline"])
            card_shows(page, tag, f"Held until {when(hold['expires_at'])}")
            card_shows(page, tag, COPY["paused_line"], TWO_SECONDS_MS)
            assert "Released" not in card_text(page, tag) and "Paid" not in card_text(page, tag)
            for name in ("Pay and cut", "Cancel hold"):
                assert card_button(page, tag, name).get_attribute("aria-disabled") == "true"
            shows(page, page.get_by_role("status", name="Service notice"), COPY["billing_banner"], TWO_SECONDS_MS, STEP_MS)
    h = api(app_url, INES).get(f"/api/holds/{hold['id']}").json()["hold"]
    assert h["status"] == "held"
    assert not txns(kb_payment(killbill, INES[0], hold["killbill_payment_id"]), "REFUND")


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layouts(browser, app_url, viewport):
    w, h = VIEWPORTS[viewport]
    _, _, sale, _ = make_sale(app_url)
    with app_page(browser, app_url, (w, h)) as page:
        sign_in_page(page, app_url, HAND)
        page.goto(app_url + "/")
        rack = page.get_by_role("list", name="Rack")
        item = rack.get_by_role("listitem").filter(has=page.get_by_role("link", name=EX_TAG, exact=True))
        expect(item).to_be_visible(timeout=REAL_WAIT_S * 1000)
        layout(page)
        sb = item.get_by_role("img", name=f"Board {EX_TAG}").bounding_box()
        lb = item.get_by_role("link", name=EX_TAG, exact=True).bounding_box()
        filters = page.get_by_role("button", name="Filters", exact=True)
        if w == PHONE[0]:
            assert sb["x"] <= 1 and sb["x"] + sb["width"] >= w - 1 and lb["y"] >= sb["y"] + sb["height"] - 1
            expect(filters).to_be_visible()
        else:
            expect(filters).to_have_count(0)
            assert sb["x"] > 1 and lb["x"] >= sb["x"] + sb["width"] - 1
            gb, rb = page.get_by_role("group", name="Species").bounding_box(), rack.bounding_box()
            if w == DESKTOP[0]:
                assert gb["x"] + gb["width"] <= rb["x"] + 1 and RAIL_SHARE[0] * w <= rb["x"] <= RAIL_SHARE[1] * w
            else:
                assert gb["y"] + gb["height"] <= rb["y"] + 1
        goto_board(page, app_url, EX_TAG)
        layout(page)
        eb = page.get_by_role("img", name=f"Board elevation {EX_TAG}").bounding_box()
        label = page.get_by_role("textbox", name="Piece label").bounding_box()
        totals = page.get_by_role("status", name="Layout totals").bounding_box()
        if w == PHONE[0]:
            assert eb["x"] <= 1 and eb["x"] + eb["width"] >= w - 1
        else:
            assert eb["x"] > 1 and eb["x"] + eb["width"] < w - 1
        if w == DESKTOP[0]:
            assert label["x"] + label["width"] <= totals["x"] + 1
        else:
            assert totals["y"] >= label["y"] + label["height"] - 1
        open_yard(page, app_url)
        layout(page)
        tag_h = page.get_by_role("heading", name="Tag a board").bounding_box()
        saw_h = page.get_by_role("heading", name="Saw queue").bounding_box()
        if w == DESKTOP[0]:
            assert saw_h["x"] >= w / 2 and abs(saw_h["y"] - tag_h["y"]) < tag_h["height"] / 2
        else:
            tb = page.get_by_role("button", name="Tag board", exact=True).bounding_box()
            assert saw_h["y"] >= tb["y"] + tb["height"] - 1
        if w == PHONE[0]:
            st = page.get_by_role("img", name="Intake strip").bounding_box()
            assert st["x"] <= 1 and st["x"] + st["width"] >= w - 1
            lf, wf = page.get_by_role("textbox", name="Length (mm)").bounding_box(), page.get_by_role("textbox", name="Width (mm)").bounding_box()
            assert wf["y"] >= lf["y"] + lf["height"] - 1
        page.goto(f"{app_url}/tickets/{sale['ticket']}")
        expect(page.get_by_role("list", name="Ticket history")).to_be_visible(timeout=REAL_WAIT_S * 1000)
        layout(page)
        tables = page.get_by_role("table").filter(has_text="Shelf A")
        if w == PHONE[0]:
            expect(tables).to_have_count(0)
        else:
            expect(tables.first).to_be_visible()


APP_DIR = Path("/app")


def shipped_packages() -> list[dict[str, Any]]:
    deployed = Path(os.environ.get("DEPLOYED_APP", str(APP_DIR)))
    cwd = deployed if (deployed / "node_modules").is_dir() else APP_DIR
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd, capture_output=True, text=True, timeout=HTTP_TIMEOUT_S * 4)
    tree = json.loads(out.stdout or "{}")
    found: dict[str, dict[str, Any]] = {}

    def walk(node: dict[str, Any]) -> None:
        for name, child in (node.get("dependencies") or {}).items():
            if child.get("version") and f"{name}@{child['version']}" not in found:
                found[f"{name}@{child['version']}"] = {"name": name, **child}
                walk(child)

    walk(tree)
    return list(found.values())


def licence_ok(value: Any) -> bool:
    if isinstance(value, dict):
        value = value.get("type")
    if isinstance(value, list):
        return all(licence_ok(v) for v in value)
    if not isinstance(value, str):
        return False
    expr = value.replace("(", " ").replace(")", " ")
    return any(all(part.strip() in LICENCES for part in alt.split(" AND ")) for alt in expr.split(" OR "))


def test_if_run_manifest():
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_third_party_notices():
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({p["name"] for p in shipped_packages() if p["name"] not in notices})
    assert not missing, missing
    for font in ("Barlow", "Plex"):
        assert font.lower() in notices.lower(), font


def test_if_licences():
    bad = []
    for p in shipped_packages():
        lic = p.get("license")
        if lic is None and p.get("path"):
            with suppress(OSError, ValueError):
                lic = json.loads((Path(p["path"]) / "package.json").read_text()).get("license")
        if not licence_ok(lic):
            bad.append((p["name"], lic))
    assert not bad, bad
    assert "OFL" in (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_other_datastore():
    names = [p["name"] for p in shipped_packages()]
    assert not [n for n in names if any(store.lower() in n.lower() for store in OTHER_DATASTORES)], names
    suffixes = (".sqlite", ".sqlite3", ".db")
    stray = [p for p in APP_DIR.rglob("*") if "node_modules" not in p.parts and p.suffix in suffixes]
    assert not stray, stray


def test_if_same_origin_assets(browser, app_url):
    with app_page(browser, app_url) as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", f"/boards/{EX_TAG}", "/sign-in"):
            page.goto(app_url + path)
            page.wait_for_load_state("networkidle")
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
        assert not foreign, foreign


def test_if_lockfile():
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    pkg = json.loads((APP_DIR / "package.json").read_text())
    assert lock.get("lockfileVersion") and lock.get("name") == pkg.get("name")
    assert re.search(r"\bnpm\s+(ci|install|i)\b", json.loads((APP_DIR / "run.json").read_text())["install"])


def test_if_provided_config_intact(killbill):
    assert killbill.account_by_key("nobody-" + secrets.token_hex(4) + "@kerfwell.test") is None
    assert isinstance(S3().keys("photos/"), list)
    assert Postgres().rows("SELECT 1 AS one") == [{"one": 1}]
