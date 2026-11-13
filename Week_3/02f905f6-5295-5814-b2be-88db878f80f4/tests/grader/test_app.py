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
import sys
import tempfile
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal, localcontext
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

import conftest
from conftest import (
    DEPLOYED_APP,
    advance,
    axe,
    check,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    motion,
    open_app,
    post_json,
    same_origin,
    seek_rects,
    select,
    session,
    shipped_packages,
    tap,
    unique,
)

_KIT_DIR = Path(conftest.__file__).resolve().parent


def _kit(name: str) -> Any:
    if hasattr(conftest, name):
        return getattr(conftest, name)
    for module in list(sys.modules.values()):
        where = getattr(module, "__file__", None)
        if where and Path(where).resolve().is_relative_to(_KIT_DIR) and hasattr(module, name):
            return getattr(module, name)
    raise ImportError(name)


KillBill = _kit("KillBill")
S3 = _kit("S3")
Mailpit = _kit("Mailpit")
mail_from_address = _kit("mail_from_address")
addresses = _kit("addresses")
text = _kit("text")

USERS: dict[str, dict[str, Any]] = {
    "owner": {"name": "Marguerite Okafor-Lind", "role": "owner", "email": "owner@brickfieldlane.example",
              "password": "kiln-owner-2026", "member_number": None},
    "tech": {"name": "Tobias Wren", "role": "tech", "email": "tech@brickfieldlane.example",
             "password": "kiln-tech-2026", "member_number": None},
    "priya": {"name": "Priya Halvorsen", "role": "member", "email": "priya@brickfieldlane.example",
              "password": "member-priya-2026", "member_number": "M104"},
    "dash": {"name": "Dashiell Moreau", "role": "member", "email": "dash@brickfieldlane.example",
             "password": "member-dash-2026", "member_number": "M117"},
}
START_SCREEN = {"member": "/intake", "tech": "/board", "owner": "/studio"}
COOKIE_NAME = "shelfmark_session"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax", "Path=/")
NAV_LINKS = {"member": {"Intake", "My pieces"}, "tech": {"Load board", "Counter", "Pickup shelf"},
             "owner": {"Studio", "Load board", "Counter", "Pickup shelf", "Rates"}}
FORBIDDEN_SCREEN = {"member": "/board", "tech": "/studio", "owner": "/intake"}

SEED_CLAYS = [("buff", "Brickfield Buff Stoneware", "10"), ("porcelain", "Lane Porcelain", "6"),
              ("red", "Clayhouse Red Earthenware", "02")]
SEED_KILNS = {"annie": ("Big Annie", 4, "9.0", 12096), "ned": ("Little Ned", 3, "6.0", 6048)}
SHELF_IN = 23
SEED_POSTS = sorted([(Decimal("11"), Decimal("0.5"), Decimal("1")), (Decimal("2.5"), Decimal("16.5"), Decimal("1")),
                     (Decimal("19.5"), Decimal("16.5"), Decimal("1"))])
SEED_PROFILES: dict[str, tuple[str, str, str, str, list[tuple[int, int, int]], int]] = {
    "annie-bisque-04": ("annie", "Bisque cone 04", "bisque", "04", [(186, 1000, 0), (315, 1945, 10)], 12),
    "annie-glaze-6": ("annie", "Glaze cone 6", "glaze", "6", [(186, 1000, 0), (250, 2000, 0), (116, 2232, 15)], 14),
    "ned-bisque-04": ("ned", "Bisque cone 04", "bisque", "04", [(186, 1000, 0), (315, 1945, 10)], 12),
    "ned-glaze-06": ("ned", "Glaze cone 06", "glaze", "06", [(186, 1000, 0), (276, 1828, 10)], 12),
}
FIRING_TIMES = {"annie-bisque-04": (8, 10), "annie-glaze-6": (11, 15), "ned-bisque-04": (8, 10),
                "ned-glaze-06": (8, 10)}
SEED_RATES = {"bisque_rate": "0.0300", "glaze_rate": "0.0400", "member_discount_percent": 10,
              "order_minimum_cents": 300, "effective_date": "2026-01-01"}
RATE_BODY = {"bisque_rate": "0.0300", "glaze_rate": "0.0400", "member_discount_percent": 10,
             "order_minimum_cents": 300}
TODAY_RATES = {"bisque_rate": "0.0500", "glaze_rate": "0.0600", "member_discount_percent": 20,
               "order_minimum_cents": 500}
DISCOUNT_MAX = 50
ORDER_MIN_MAX_CENTS = 10000

FEE_CASE_IDS = ["member_rectangle", "member_plate_cm", "guest_rectangle", "member_minimum"]

FEE_CASES = {
    "member_rectangle": ("priya", {"shape": "rectangular", "unit": "in", "length": "4", "width": "3.2", "height": "4.9",
                                   "plan": "bisque_and_glaze"}, "70.000", "4.41"),
    "member_plate_cm": ("priya", {"shape": "plate", "unit": "cm", "diameter": "25", "height": "2",
                                  "plan": "bisque_and_glaze"}, "150.000", "9.45"),
    "guest_rectangle": ("tech", {"shape": "rectangular", "unit": "in", "length": "3", "width": "4.5", "height": "5",
                                 "plan": "bisque_and_glaze"}, "67.500", "4.73"),
    "member_minimum": ("priya", {"shape": "rectangular", "unit": "in", "length": "2", "width": "2", "height": "2",
                                 "plan": "bisque_and_glaze"}, None, "3.00"),
}

FIELD_CASES: list[tuple[dict[str, Any], str, str]] = [
    ({"shape": None}, "shape", "Choose a shape"),
    ({"shape": "oval"}, "shape", "Choose a shape"),
    ({"unit": "mm"}, "unit", "Choose cm or in"),
    ({"plan": None}, "plan", "Choose a firing plan"),
    ({"length": "0"}, "length", "Enter a size above 0"),
    ({"width": ""}, "width", "Enter a size above 0"),
    ({"length": "abc"}, "length", "Enter a number with at most two decimals"),
    ({"length": "4.123"}, "length", "Enter a number with at most two decimals"),
    ({"length": "23.1"}, "length", "Too large for the shelf: 23 in at most"),
    ({"height": "8.1"}, "height", "Too tall for any kiln: 8.0 in at most"),
    ({"clay_id": "stoneware"}, "clay_id", "Choose a clay body"),
    ({"cone": None}, "cone", "Choose a glaze cone"),
    ({"cone": "10"}, "cone", "Choose a glaze cone"),
    ({"clay_id": "red"}, "cone", "Clay not rated for cone 6"),
    ({"photo_id": None}, "photo_id", "Add a photo of the piece"),
    ({"photo_id": "no-such-photo"}, "photo_id", "Add a photo of the piece"),
]

OUTAGE_ENV = {"photo": "APP_MINIO_DOWN_URL", "charge": "APP_KILLBILL_DOWN_URL", "receipt": "APP_MAILPIT_DOWN_URL"}
STEP_COPY = {
    "photo": "Intake stopped at the photo step: the photo could not be confirmed. Nothing was charged.",
    "charge": "Intake stopped at the charge step: billing is unreachable. Nothing was charged.",
    "receipt": "Intake stopped at the receipt step: email is unreachable. The charge was voided.",
}

JSON_LIMIT = 65536
PHOTO_LIMIT = 8000000
UNKNOWN_PIECE = "9999"
FOREIGN_ORIGIN = "http://elsewhere.example"

VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
PHONE = VIEWPORTS["phone"]
DESKTOP = VIEWPORTS["desktop"]
PHONE_BREAK = 600
TARGET_PX = 44

SHELF_CODE = "B3"
TOKEN_BITS = 128
REMINDER_DAYS = 14
LAPSE_DAYS = 21
NOTE_MAX = 500
DAMAGE_MIN_CENTS = 100
DAMAGE_MAX_CENTS = 20000
SHELF_CHARGE = "60.00"
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
FONT_LICENCE = "OFL-1.1"
OTHER_STORES = ("SQLite", "Redis")

FEE_MAX_MS = 1000
REFRESH_MS = 5000
OTHERS_MS = 6000
UNLOAD_ENABLE_MS = 6000
PANEL_MIN_MS = 200
PANEL_MAX_MS = 320
SETTLE_MIN_MS = 200
SETTLE_MAX_MS = 320
EXIT_MIN_MS = 200
EXIT_MAX_MS = 320
FILL_MIN_MS = 500
FILL_MAX_MS = 700
CAROUSEL_MIN_MS = 200
CAROUSEL_MAX_MS = 320
FILL_STEP_MS = 50
MOTION_WINDOW_MS = 1000
STEP_MS = 100
POLL_MS = 200
POLL_S = 0.5
WAIT_S = 30
HTTP_TIMEOUT_S = 30
MAIL_WAIT_S = 30
FIRING_WAIT_S = 120
LAPSE_WAIT_S = 120
COPY_WAIT_S = 300
COPY_STOP_S = 15
GUARD_ROUNDS = 20
TS_TOLERANCE_S = Decimal("0.1")

CHICAGO = ZoneInfo("America/Chicago")


def dec(value: Any) -> Decimal:
    return Decimal(str(value))


def cents(value: Any) -> int:
    return int((dec(value) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def money(amount_cents: int) -> str:
    return f"${amount_cents // 100}.{amount_cents % 100:02d}"


def pn(piece: dict[str, Any]) -> str:
    return str(piece["number"]).zfill(4)


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def short_url() -> str:
    return env_url("APP_SHORT_URL")


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def studio_label(value: str) -> str:
    at = instant(value).astimezone(CHICAGO)
    hour = at.hour % 12 or 12
    return f"{at:%a} {hour}:{at:%M} {'AM' if at.hour < 12 else 'PM'}"


def studio_date(value: str) -> str:
    return instant(value).astimezone(CHICAGO).date().isoformat()


def poll(fn: Callable[[], Any], pred: Callable[[Any], bool], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while True:
        last = fn()
        if pred(last):
            return last
        if time.monotonic() > deadline:
            raise AssertionError(f"{what} not reached within {seconds} s: {last!r}")
        threading.Event().wait(POLL_S)


def error_of(r: httpx.Response, status: int, code: str | None = None, message: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, f"{r.status_code} != {status}: {r.text[:500]}"
    body = r.json()
    assert isinstance(body.get("error"), str) and isinstance(body.get("message"), str), body
    if code is not None:
        assert body["error"] == code, body
    if message is not None:
        assert body["message"] == message, body
    if status == 422:
        assert isinstance(body.get("fields"), dict), body
    return body


class Api:
    def __init__(self, base: str, cookies: Any = None) -> None:
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, cookies=cookies)

    @staticmethod
    def _headers(key: str | None, headers: dict[str, str] | None) -> dict[str, str]:
        out = dict(headers or {})
        if key:
            out["Idempotency-Key"] = key
        return out

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.c.get(path, **kw)

    def post(self, path: str, body: Any = None, key: str | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
        return self.c.post(path, json={} if body is None else body, headers=self._headers(key, headers))

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.c.patch(path, json=body)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.c.put(path, json=body)

    def delete(self, path: str, headers: dict[str, str] | None = None) -> httpx.Response:
        return self.c.delete(path, headers=headers or {})

    def send(self, method: str, path: str, body: Any) -> httpx.Response:
        return self.c.request(method, path, json=body)

    def upload(self, data: bytes, ctype: str) -> httpx.Response:
        ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/heic": "heic"}.get(ctype, "txt")
        return self.c.post("/api/photos", files={"photo": (f"photo.{ext}", data, ctype)})

    def clone(self) -> "Api":
        return Api(self.base, cookies=httpx.Cookies(self.c.cookies))


def login(base: str, who: str) -> Api:
    api = Api(base)
    user = USERS[who]
    r = api.post("/api/session", {"email": user["email"], "password": user["password"]})
    assert r.status_code == 200, r.text
    return api


def png(width: int = 16, height: int = 16) -> bytes:
    raw = b"".join(b"\x00" + secrets.token_bytes(width * 3) for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def jpeg() -> bytes:
    note = secrets.token_bytes(32)
    return (b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            + b"\xff\xfe" + struct.pack(">H", len(note) + 2) + note + b"\xff\xd9")


def file_payload(data: bytes, ctype: str = "image/png", name: str = "piece.png") -> dict[str, Any]:
    return {"name": name, "mimeType": ctype, "buffer": data}


def upload_photo(api: Api, data: bytes | None = None, ctype: str = "image/png") -> str:
    r = api.upload(png() if data is None else data, ctype)
    assert r.status_code == 201, r.text
    return r.json()["photo_id"]


def size_keys(shape: str) -> tuple[str, ...]:
    return ("length", "width", "height") if shape == "rectangular" else ("diameter", "height")


def intake_body(photo: str, *, shape: str = "rectangular", unit: str = "in", sizes: tuple[str, ...] = ("2", "2", "2"),
                plan: str = "bisque_only", clay: str = "buff", cone: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"shape": shape, "unit": unit, "plan": plan, "clay_id": clay, "photo_id": photo,
                            "cone": None if plan == "bisque_only" else cone}
    body.update(dict(zip(size_keys(shape), sizes)))
    return body


def make_piece(base: str, who: str = "priya", *, shape: str = "rectangular", unit: str = "in",
               sizes: tuple[str, ...] = ("2", "2", "2"), plan: str = "bisque_only", clay: str = "buff",
               cone: str | None = None, photo: bytes | None = None) -> dict[str, Any]:
    api = login(base, who)
    data = png() if photo is None else photo
    photo_id = upload_photo(api, data)
    r = api.post("/api/intakes", intake_body(photo_id, shape=shape, unit=unit, sizes=sizes, plan=plan, clay=clay, cone=cone),
                 key=idempotency_key())
    assert r.status_code == 201, r.text
    return r.json() | {"_photo": data}


def make_dropoff(base: str, killbill: Any = None, *, shape: str = "rectangular", unit: str = "in",
                 sizes: tuple[str, ...] = ("2", "2", "2"), plan: str = "bisque_only", clay: str = "buff",
                 cone: str | None = None) -> dict[str, Any]:
    first, second = unique("guest")
    name, email = (second, first) if "@" in first else (first, second)
    tech = login(base, "tech")
    body = intake_body(upload_photo(tech), shape=shape, unit=unit, sizes=sizes, plan=plan, clay=clay, cone=cone)
    r = tech.post("/api/dropoffs", body | {"guest_name": name, "guest_email": email}, key=idempotency_key())
    assert r.status_code == 201, r.text
    return r.json() | {"guest_name": name, "guest_email": email}


def get_piece(api: Api, number: str) -> dict[str, Any]:
    r = api.get(f"/api/pieces/{number}")
    assert r.status_code == 200, r.text
    return r.json()


def current_rates(base: str) -> dict[str, Any]:
    r = login(base, "priya").get("/api/rates/current")
    assert r.status_code == 200, r.text
    return r.json()


def round_side(value: str, unit: str) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = 50
        v = Decimal(value)
        if unit == "cm":
            v = v / Decimal("2.54")
        return (v * 2).to_integral_value(rounding=ROUND_CEILING) / 2


def expected_quote(sizes: dict[str, str], rates: dict[str, Any], member: bool) -> dict[str, Any]:
    shape, unit, plan = sizes["shape"], sizes["unit"], sizes["plan"]
    sides = {k: round_side(sizes[k], unit) for k in size_keys(shape)}
    if shape == "plate":
        sides["height"] = max(sides["height"], Decimal("1.5"))
    if shape == "rectangular":
        cubic = sides["length"] * sides["width"] * sides["height"]
    else:
        cubic = sides["diameter"] * sides["diameter"] * sides["height"]
    bisque, glaze = dec(rates["bisque_rate"]), dec(rates["glaze_rate"])
    rate = {"bisque_only": bisque, "glaze_only": glaze, "bisque_and_glaze": bisque + glaze}[plan]
    discount = int(rates["member_discount_percent"]) if member else 0
    amount = (cubic * rate * (100 - discount) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    amount_cents = int(amount * 100)
    minimum = int(rates["order_minimum_cents"])
    return {"sides_in": {k: f"{v:.1f}" for k, v in sides.items()}, "cubic_inches": f"{cubic:.3f}",
            "rate_per_cubic_inch": f"{rate:.4f}", "discount_percent": discount, "order_minimum_cents": minimum,
            "minimum_applied": minimum > amount_cents, "fee_cents": max(amount_cents, minimum)}


def fee_sentence(quote: dict[str, Any]) -> str:
    fee = money(quote["fee_cents"])
    if quote["minimum_applied"]:
        return f"Fee {fee} (order minimum) for {quote['cubic_inches']} cubic inches"
    return f"Fee {fee} for {quote['cubic_inches']} cubic inches"


MEMBER_FEE = {"fee_cents": cents("4.41"), "minimum_applied": False, "cubic_inches": "70.000"}
MEMBER_FEE_COPY = fee_sentence(MEMBER_FEE)


def kb_account(killbill: Any, key: str) -> dict[str, Any] | None:
    return killbill.account(key) if "@" in key else killbill.account_by_key(key)


def kb_invoice_ids(killbill: Any, key: str) -> dict[str, dict[str, Any]]:
    account = kb_account(killbill, key)
    if not account:
        return {}
    response = killbill.client.get(f"/accounts/{account['accountId']}/invoices",
                                   params={"includeInvoiceComponents": "true", "includeVoidedInvoices": "true"})
    assert response.status_code == 200, response.text
    return {inv["invoiceId"]: inv for inv in response.json()}


def kb_items(killbill: Any, key: str, description: str, skip: Any = ()) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    account = kb_account(killbill, key)
    if not account:
        return []
    found = []
    for inv in killbill.invoices(account["accountId"]):
        if inv.get("status") == "VOID" or inv.get("invoiceId") in skip:
            continue
        for item in inv.get("items") or []:
            if item.get("description") == description:
                found.append((inv, item))
    return found


def kb_purchases(killbill: Any, key: str) -> list[dict[str, Any]]:
    account = kb_account(killbill, key)
    if not account:
        return []
    out = []
    for payment in killbill.payments(account["accountId"]):
        for tx in payment.get("transactions") or []:
            if tx.get("transactionType") == "PURCHASE" and tx.get("status") == "SUCCESS":
                out.append(tx)
    return out


def kb_owed(killbill: Any, key: str) -> int:
    account = kb_account(killbill, key)
    if not account:
        return 0
    if account.get("accountBalance") is not None:
        return cents(account["accountBalance"])
    return sum(cents(inv.get("balance") or 0) for inv in killbill.invoices(account["accountId"])
               if inv.get("status") != "VOID")


def mails(mail: Any, to: str, subject: str, count: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages(settle=0) if m.get("Subject") == subject and to in addresses(m.get("To"))]
        if len(found) >= count or time.monotonic() > deadline:
            return found
        threading.Event().wait(POLL_S)


def receipts_to(mail: Any, email: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages(settle=0)
            if str(m.get("Subject", "")).startswith("Intake receipt:") and email in addresses(m.get("To"))]


def first_heading(message: dict[str, Any]) -> str:
    html = message.get("HTML") or ""
    found = re.search(r"<h[1-6][^>]*>(.*?)</h[1-6]>", html, re.S | re.I)
    if found:
        return " ".join(re.sub(r"<[^>]+>", "", found.group(1)).split())
    for line in text(message).splitlines():
        line = line.strip().lstrip("#").strip()
        if line:
            return line
    return ""


def track_api(url: str) -> str:
    return "/api/track/" + urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]


def firing_of(api: Api, fid: Any) -> dict[str, Any]:
    r = api.get(f"/api/firings/{fid}")
    assert r.status_code == 200, r.text
    return r.json()


def kiln_of(api: Api, kiln_id: str) -> dict[str, Any]:
    return next(k for k in api.get("/api/kilns").json() if k["id"] == kiln_id)


def place(api: Api, fid: Any, number: str, layer: int, x: Any, y: Any, rotation: int = 0) -> httpx.Response:
    return api.post(f"/api/firings/{fid}/placements",
                    {"piece_number": number, "layer": layer, "x": x, "y": y, "rotation": rotation})


def unload(base: str, fid: Any, damage: list[dict[str, Any]] | None = None) -> httpx.Response:
    return login(base, "tech").post(f"/api/firings/{fid}/unload", {"pickup_shelf": SHELF_CODE, "damage": damage or []})


def wait_firing(api: Api, fid: Any, statuses: tuple[str, ...], seconds: float = FIRING_WAIT_S) -> dict[str, Any]:
    return poll(lambda: firing_of(api, fid), lambda f: f["status"] in statuses, seconds, f"firing {statuses}")


def drain(base: str, kiln_id: str) -> None:
    tech = login(base, "tech")
    fid = kiln_of(tech, kiln_id)["current_firing_id"]
    if not fid:
        return
    firing = firing_of(tech, fid)
    if firing["status"] == "building":
        if not any(layer["placements"] for layer in firing["layers"]):
            profile = firing["profile"]
            if profile["stage"] == "glaze":
                filler = make_piece(base, plan="glaze_only", clay="buff", cone=str(profile["cone"]))
            else:
                filler = make_piece(base)
            assert place(tech, fid, pn(filler), 1, 9.5, 9.5).status_code == 201
        assert tech.post(f"/api/firings/{fid}/start").status_code == 200
    if firing_of(tech, fid)["status"] != "unloaded":
        wait_firing(tech, fid, ("unloadable",))
        assert unload(base, fid).status_code == 200


def fresh_firing(base: str, kiln_id: str, profile_id: str) -> dict[str, Any]:
    drain(base, kiln_id)
    r = login(base, "tech").post("/api/firings", {"kiln_id": kiln_id, "profile_id": profile_id})
    assert r.status_code == 201, r.text
    return r.json()


def fire_to_unloadable(base: str, kiln_id: str, profile_id: str,
                       placements: list[tuple[str, int, float, float]]) -> dict[str, Any]:
    tech = login(base, "tech")
    fid = fresh_firing(base, kiln_id, profile_id)["id"]
    for number, layer, x, y in placements:
        r = place(tech, fid, number, layer, x, y)
        assert r.status_code == 201, r.text
    assert tech.post(f"/api/firings/{fid}/start").status_code == 200
    return wait_firing(tech, fid, ("unloadable",))


def fill_percent(cubics: list[Any], usable: Any) -> int:
    total = sum((dec(c) for c in cubics), Decimal(0))
    return int((total * 100 / dec(usable)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def firing_minutes(segments: list[tuple[int, int, int]]) -> Decimal:
    previous, hours = Decimal(70), Decimal(0)
    for rate, target, hold in segments:
        hours += abs(Decimal(target) - previous) / Decimal(rate) + Decimal(hold) / 60
        previous = Decimal(target)
    return hours * 60


@contextmanager
def ui(browser: Browser, base: str, who: str | None = None, path: str = "/", *, size: tuple[int, int] = DESKTOP,
       touch: bool = False, reduced: bool = False, clock_at: datetime | None = None) -> Iterator[Page]:
    with ExitStack() as stack:
        opened = open_app(browser, base.rstrip("/") + "/", reduced_motion="reduce" if reduced else "no-preference")
        if hasattr(opened, "__enter__"):
            page = stack.enter_context(opened)
        else:
            page = next(opened)
            stack.callback(opened.close)
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if touch:
            session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        if clock_at is not None:
            page.clock.set_system_time(clock_at)
        if who is not None:
            user = USERS[who]
            r = page.request.post(f"{base.rstrip('/')}/api/session",
                                  data={"email": user["email"], "password": user["password"]})
            assert r.status == 200, r.text()
        page.goto(base.rstrip("/") + path)
        yield page


def wait_for(page: Page, attempt: Callable[[], Any], seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            attempt()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, STEP_MS)


def shown(page: Page, locator: Locator) -> None:
    wait_for(page, lambda: expect(locator).to_be_visible(timeout=POLL_MS))


def see(page: Page, locator: Locator, expected: Any, contains: bool = False) -> None:
    if contains:
        wait_for(page, lambda: expect(locator).to_contain_text(expected, timeout=POLL_MS))
    else:
        wait_for(page, lambda: expect(locator).to_have_text(expected, timeout=POLL_MS))


def captured(page: Page, locator: Locator, pattern: str) -> re.Match[str]:
    compiled = re.compile(pattern)
    wait_for(page, lambda: expect(locator).to_have_text(compiled, timeout=POLL_MS))
    found = compiled.search(" ".join(locator.inner_text().split()))
    assert found, locator.inner_text()
    return found


def enabled(page: Page, locator: Locator) -> None:
    wait_for(page, lambda: expect(locator).to_be_enabled(timeout=POLL_MS))


def spin(page: Page, name: str) -> Locator:
    return page.get_by_role("spinbutton", name=name, exact=True)


def in_view(locator: Locator) -> Locator:
    locator.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
    return locator


def box(locator: Locator) -> dict[str, float]:
    found = locator.bounding_box()
    assert found is not None, locator
    return found


def overlaps(a: dict[str, float], b: dict[str, float]) -> bool:
    return (a["x"] < b["x"] + b["width"] - 1 and b["x"] < a["x"] + a["width"] - 1
            and a["y"] < b["y"] + b["height"] - 1 and b["y"] < a["y"] + a["height"] - 1)


def fill_intake(page: Page, *, shape: str = "Rectangular",
                sizes: tuple[tuple[str, str], ...] = (("Length", "4"), ("Width", "3.2"), ("Height", "4.9")),
                clay: str = "Brickfield Buff Stoneware", plan: str = "Bisque and glaze", cone: str | None = "Cone 6",
                photo: bytes | None = None) -> None:
    check(page.get_by_role("radiogroup", name="Shape").get_by_role("radio", name=shape, exact=True))
    for name, value in sizes:
        fill(spin(page, name), value)
    select(page.get_by_role("combobox", name="Clay body"), clay)
    select(page.get_by_role("combobox", name="Firing plan"), plan)
    if cone:
        select(page.get_by_role("combobox", name="Glaze cone"), cone)
    if photo is not None:
        page.get_by_label("Intake photo").set_input_files(file_payload(photo))
        see(page, page.get_by_role("status", name="Photo upload"), "Photo attached")


def divert_once(page: Page, glob: str, target_base: str, who: str) -> list[str | None]:
    target = login(target_base, who)
    page.context.add_cookies([{"name": "shelfmark_session", "value": target.c.cookies.get("shelfmark_session"),
                               "url": target_base}])
    keys: list[str | None] = []

    def handler(route: Any) -> None:
        request = route.request
        keys.append(request.headers.get("idempotency-key"))
        if len(keys) == 1:
            headers = {k: v for k, v in request.headers.items() if k.lower() not in ("origin", "cookie", "host", "referer")}
            route.fulfill(response=route.fetch(url=target_base + urlparse(request.url).path, headers=headers))
        else:
            route.continue_()

    page.route(glob, handler)
    return keys


def open_board(page: Page, base: str, kiln_name: str) -> None:
    page.goto(f"{base}/board")
    if page.viewport_size["width"] < PHONE_BREAK:
        select(page.get_by_role("combobox", name="Kiln", exact=True), kiln_name)
    else:
        click(page.get_by_role("navigation", name="Kilns").get_by_role("link", name=kiln_name, exact=True))
    shown(page, page.get_by_role("group", name=re.compile(r"^Shelf layer \d+$")).first)


def panel(page: Page) -> Locator:
    return page.get_by_role("region", name="Placement", exact=True)


def stub(page: Page, number: str) -> Locator:
    return page.get_by_role("list", name="Queued pieces").get_by_role("button", name=f"Pick Piece {number}", exact=True)


def placed(page: Page, number: str) -> Locator:
    return page.get_by_role("button", name=f"Placed Piece {number}", exact=True)


def shelf_news(page: Page) -> Locator:
    return page.get_by_role("status", name="Shelf announcements", exact=True)


def pick(page: Page, number: str) -> None:
    click(stub(page, number))
    shown(page, page.get_by_role("heading", name=f"Placing Piece {number}", exact=True))


def move_to(page: Page, x: Any, y: Any) -> None:
    for name, value in (("X (in)", x), ("Y (in)", y)):
        field = panel(page).get_by_role("spinbutton", name=name, exact=True)
        fill(field, str(value))
        field.press("Enter")


def press_place(page: Page) -> None:
    click(panel(page).get_by_role("button", name="Place", exact=True))


def placed_copy(number: str, layer: int, fill_value: int) -> str:
    return f"Placed Piece {number} on layer {layer}. Load {fill_value}% full."


def clay_copy(cone: str) -> str:
    return f"Clay not rated for cone {cone}"


def shelf_group(page: Page, layer: int) -> Locator:
    return page.get_by_role("group", name=f"Shelf layer {layer}", exact=True)


def layer_tab(page: Page, layer: int) -> Locator:
    return page.get_by_role("tab", name=f"Layer {layer}", exact=True)


def layer_of(layer: int, layers: int) -> str:
    return f"Layer {layer} of {layers}"


def firing_fill(base: str, firing: dict[str, Any], kiln_id: str) -> int:
    tech = login(base, "tech")
    numbers = [p["piece_number"] for layer in firing["layers"] for p in layer["placements"]]
    cubics = [get_piece(tech, str(n).zfill(4))["cubic_inches"] for n in numbers]
    return fill_percent(cubics, kiln_of(tech, kiln_id)["usable_cubic_inches"])


def placed_numbers(firing: dict[str, Any]) -> set[str]:
    return {str(p["piece_number"]).zfill(4) for layer in firing["layers"] for p in layer["placements"]}


def settled_firing(page: Page, api: Api, fid: Any, number: str, present: bool = True,
                   seconds: float = WAIT_S) -> dict[str, Any]:
    deadline = time.monotonic() + seconds
    while True:
        current = firing_of(api, fid)
        if (number in placed_numbers(current)) == present:
            return current
        if time.monotonic() > deadline:
            raise AssertionError(
                f"piece {number} never {'reached' if present else 'left'} the firing: {current}")
        advance(page, STEP_MS)


def settled_fill(page: Page, base: str, api: Api, fid: Any, number: str, kiln_id: str,
                 present: bool = True) -> int:
    return firing_fill(base, settled_firing(page, api, fid, number, present), kiln_id)


def settled_placement_x(page: Page, api: Api, number: str, value: Decimal,
                        seconds: float = WAIT_S) -> dict[str, Any]:
    deadline = time.monotonic() + seconds
    while True:
        spot = get_piece(api, number)["placement"]
        if spot is not None and dec(spot["x"]) == value:
            return spot
        if time.monotonic() > deadline:
            raise AssertionError(f"piece {number} never committed x {value}: {spot}")
        advance(page, STEP_MS)


def fill_numeral(page: Page) -> Locator:
    return page.get_by_text(re.compile(r"^Load \d+% full$")).first


def stamp(sample: dict[str, float]) -> float:
    if "dt" in sample:
        return float(sample["dt"]) * 1000
    return float(sample.get("t", sample.get("time", 0.0)))


def pose(sample: dict[str, float], with_opacity: bool = True) -> tuple[Any, ...]:
    return tuple(sorted((k, round(float(v), 1)) for k, v in sample.items()
                        if k not in ("t", "time", "dt") and (with_opacity or "opacity" not in k)))


def settled_at(path: list[dict[str, float]], with_opacity: bool = True) -> tuple[bool, float]:
    poses = [pose(s, with_opacity) for s in path]
    index = len(path) - 1
    while index > 0 and poses[index - 1] == poses[-1]:
        index -= 1
    return len(set(poses)) > 1, stamp(path[index]) - stamp(path[0])


def assert_motion(path: list[dict[str, float]], low: float, high: float, what: str) -> None:
    assert path, f"{what} reported no motion samples: its animation runs on a descendant, not the element itself"
    moved, at = settled_at(path)
    spacing = (stamp(path[-1]) - stamp(path[0])) / max(len(path) - 1, 1)
    assert moved, f"{what} did not move: {path}"
    assert low - spacing <= at <= high + spacing, f"{what} settled at {at} ms, outside {low}-{high} ms"


def assert_still(path: list[dict[str, float]], what: str) -> None:
    if not path:
        return
    moved, _ = settled_at(path, with_opacity=False)
    assert not moved, f"{what} moved under reduced motion: {path}"


def own_animations(locator: Locator) -> int:
    try:
        return int(locator.evaluate("e => e.getAnimations().length"))
    except Exception:
        return 0


def ancestor_handles(locator: Locator, levels: int) -> list[Any]:
    found: list[Any] = []
    if not levels:
        return found
    try:
        handle = locator.element_handle()
        for _ in range(levels):
            parent = handle.evaluate_handle("e => e.parentElement").as_element()
            if parent is None:
                break
            tag, role = parent.evaluate("e => [e.tagName.toLowerCase(), e.getAttribute('role') || '']")
            if tag in ("body", "main") or role == "main":
                break
            found.append(parent)
            handle = parent
    except Exception:
        return found
    return found


def ancestor_animations(locator: Locator, levels: int) -> int:
    try:
        return sum(int(p.evaluate("e => e.getAnimations().length")) for p in ancestor_handles(locator, levels))
    except Exception:
        return 0


def sample_motion(locator: Locator, duration_ms: float) -> list[dict[str, float]]:
    try:
        if not own_animations(locator):
            return []
        return motion(locator, duration_ms)
    except Exception:
        return []


def awaited_motion(page: Page, api: Api, fid: Any, number: str, candidates: dict[str, Locator],
                   ancestors: int = 0, seconds: float = WAIT_S) -> dict[str, list[dict[str, float]]]:
    deadline = time.monotonic() + seconds
    while not any(own_animations(node) or ancestor_animations(node, ancestors)
                  for node in candidates.values()):
        if time.monotonic() > deadline or number in placed_numbers(firing_of(api, fid)):
            break
        advance(page, STEP_MS)
    paths: dict[str, list[dict[str, float]]] = {}
    for name, node in candidates.items():
        for key, path in motion_candidates(node, MOTION_WINDOW_MS, ancestors).items():
            paths[f"{name} {key}"] = path
    return paths


def motion_fits(path: list[dict[str, float]], low: float, high: float) -> bool:
    if not path:
        return False
    moved, at = settled_at(path)
    spacing = (stamp(path[-1]) - stamp(path[0])) / max(len(path) - 1, 1)
    return moved and low - spacing <= at <= high + spacing


def assert_any_motion(paths: dict[str, list[dict[str, float]]], low: float, high: float, what: str) -> None:
    assert any(motion_fits(path, low, high) for path in paths.values()), (
        f"{what}: no candidate moved within {low}-{high} ms: "
        + "; ".join(f"{name}={path}" for name, path in paths.items()))


def motion_candidates(locator: Locator, duration_ms: float,
                      ancestors: int = 0) -> dict[str, list[dict[str, float]]]:
    paths = {"element": sample_motion(locator, duration_ms)}
    for index, node in enumerate(locator.locator("*").all()):
        paths[f"descendant {index}"] = sample_motion(node, duration_ms)
    for level, parent in enumerate(ancestor_handles(locator, ancestors)):
        paths[f"ancestor {level}"] = seek_rects(parent)
    return paths


def assert_subtree_motion(locator: Locator, low: float, high: float, what: str,
                          ancestors: int = 0) -> None:
    paths = motion_candidates(locator, MOTION_WINDOW_MS, ancestors)
    if any(paths.values()):
        assert_any_motion(paths, low, high, what)
        return
    assert_motion(motion(locator, MOTION_WINDOW_MS), low, high, what)


def assert_subtree_still(locator: Locator, what: str, ancestors: int = 0) -> None:
    paths = motion_candidates(locator, MOTION_WINDOW_MS, ancestors)
    if any(paths.values()):
        for name, path in paths.items():
            assert_still(path, f"{what} ({name})")
        return
    assert_still(motion(locator, MOTION_WINDOW_MS), what)


def count_fill(page: Page, final: int) -> tuple[list[int], int]:
    values: list[int] = []
    elapsed = 0
    while True:
        values.append(int(re.search(r"\d+", fill_numeral(page).inner_text()).group()))
        if values[-1] == final or elapsed > FILL_MAX_MS * 2:
            return values, elapsed
        advance(page, FILL_STEP_MS)
        elapsed += FILL_STEP_MS


def small_targets(page: Page) -> list[str]:
    exempt = [b.bounding_box() for b in page.get_by_role("button", name=re.compile(r"^Placed Piece ")).all()]
    small: list[str] = []
    for role in ("button", "link", "textbox", "combobox", "spinbutton", "tab"):
        for element in page.get_by_role(role).all():
            if not element.is_visible():
                continue
            found = element.bounding_box()
            if found is None or found["width"] <= 1 or found["height"] <= 1 or found in exempt:
                continue
            if found["width"] < TARGET_PX or found["height"] < TARGET_PX:
                small.append(f"{role} {element.inner_text()[:40]!r} {found['width']:.0f}x{found['height']:.0f}")
    return small


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def unreachable_database_url() -> str:
    raw = os.environ.get("DATABASE_URL", "postgres://shelfmark@127.0.0.1:9/shelfmark")
    parts = urlparse(raw)
    auth = parts.netloc.rsplit("@", 1)[0] + "@" if "@" in parts.netloc else ""
    return parts._replace(netloc=f"{auth}127.0.0.1:9").geturl()


def tail(log: Path) -> str:
    return log.read_text(errors="replace")[-3000:]


@contextmanager
def app_copy(extra: dict[str, str]) -> Iterator[tuple[str, Path, subprocess.Popen[bytes]]]:
    manifest = DEPLOYED_APP / "run.json"
    if not manifest.exists():
        manifest = Path("/app/run.json")
    serve = json.loads(manifest.read_text())["serve"]
    port = free_port()
    log = Path(tempfile.mkstemp(suffix=".log")[1])
    env = {**os.environ, **extra, "APP_PUBLIC_PORT": str(port)}
    with log.open("wb") as out:
        proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=out, stderr=subprocess.STDOUT,
                                start_new_session=True)
        try:
            yield f"http://127.0.0.1:{port}", log, proc
        finally:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=COPY_STOP_S)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def copy_health(url: str, proc: subprocess.Popen[bytes], log: Path) -> httpx.Response | None:
    if proc.poll() is not None:
        raise AssertionError(f"app copy exited:\n{tail(log)}")
    try:
        return httpx.get(f"{url}/api/health", timeout=HTTP_TIMEOUT_S)
    except httpx.TransportError:
        return None


def test_health_and_port(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    with app_copy({}) as (url, log, proc):
        r = poll(lambda: copy_health(url, proc, log), lambda x: x is not None and x.status_code == 200,
                 COPY_WAIT_S, "copy health")
        assert r.json() == {"status": "ok"}, tail(log)
    with app_copy({"DATABASE_URL": unreachable_database_url()}) as (url, log, proc):
        r = poll(lambda: copy_health(url, proc, log), lambda x: x is not None, COPY_WAIT_S, "copy answering")
        assert r.status_code == 503 and r.json() == {"status": "starting"}, tail(log)
        again = copy_health(url, proc, log)
        assert again is not None and again.status_code == 503, tail(log)


def test_sign_in_api_and_roles(app_url: str) -> None:
    for who, user in USERS.items():
        r = post_json(app_url, "/api/session", {"email": user["email"], "password": user["password"]})
        assert r.status_code == 200, r.text
        body = r.json()["user"]
        assert (body["name"], body["role"], body["member_number"]) == (user["name"], user["role"], user["member_number"])
        cookie_header = r.headers.get("set-cookie", "")
        assert COOKIE_NAME in cookie_header, cookie_header
        for flag in COOKIE_FLAGS:
            assert flag.lower() in cookie_header.lower(), (flag, cookie_header)
        me = httpx.get(f"{app_url}/api/me", cookies={"shelfmark_session": r.cookies["shelfmark_session"]})
        assert me.status_code == 200 and me.json()["user" if "user" in me.json() else "name"]
    error_of(post_json(app_url, "/api/session", {"email": USERS["priya"]["email"], "password": "wrong"}),
             401, "bad_credentials")
    member, tech, owner = login(app_url, "priya"), login(app_url, "tech"), login(app_url, "owner")
    firing_body = {"kiln_id": "annie", "profile_id": "annie-bisque-04"}
    for path in ("/api/kilns", "/api/queue", "/api/rates", "/api/studio/summary", "/api/damage-reports"):
        error_of(member.get(path), 403, "forbidden", "Your role can't do that.")
    error_of(member.post("/api/firings", firing_body), 403, "forbidden")
    error_of(member.post("/api/dropoffs", {}), 403, "forbidden")
    for path in ("/api/rates", "/api/studio/owed", "/api/studio/summary", "/api/damage-reports", "/api/me/balance"):
        error_of(tech.get(path), 403, "forbidden")
    error_of(tech.post("/api/rates", RATE_BODY | {"effective_date": "2099-12-31"}), 403, "forbidden")
    error_of(owner.get("/api/me/balance"), 403, "forbidden")
    for path in ("/api/kilns", "/api/queue"):
        assert tech.get(path).status_code == 200
    for path in ("/api/rates", "/api/studio/summary", "/api/kilns", "/api/damage-reports"):
        assert owner.get(path).status_code == 200
    assert member.get("/api/me/balance").status_code == 200
    fresh = Api(app_url)
    assert fresh.post("/api/session", {"email": USERS["dash"]["email"], "password": USERS["dash"]["password"]}).status_code == 200
    assert fresh.delete("/api/session").status_code == 204
    error_of(fresh.get("/api/me"), 401, "unauthenticated", "Sign in first.")


def test_wf_cross_cutting_sign_in(browser: Browser, app_url: str) -> None:
    for who in ("priya", "tech", "owner"):
        user = USERS[who]
        with ui(browser, app_url) as page:
            form = page.get_by_role("form", name="Sign in")
            fill(form.get_by_role("textbox", name="Email", exact=True), user["email"])
            fill(form.get_by_label("Password", exact=True), "not-the-password")
            click(form.get_by_role("button", name="Sign in", exact=True))
            see(page, page.get_by_role("alert"), "Email or password is wrong.")
            fill(form.get_by_label("Password", exact=True), user["password"])
            click(form.get_by_role("button", name="Sign in", exact=True))
            page.wait_for_url(re.compile(re.escape(START_SCREEN[user["role"]]) + r"$"))
            nav = page.get_by_role("navigation", name="Studio")
            shown(page, nav)
            names = {" ".join(link.inner_text().split()) for link in nav.get_by_role("link").all()}
            assert names == NAV_LINKS[user["role"]], names
            expect(page.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
            page.goto(app_url + FORBIDDEN_SCREEN[user["role"]])
            shown(page, page.get_by_text("Your role can't open this page."))
            page.goto(app_url + START_SCREEN[user["role"]])
            click(page.get_by_role("button", name="Sign out", exact=True))
            poll(lambda: page.request.get(f"{app_url}/api/me").status, lambda s: s == 401, WAIT_S, "signed out")


def test_member_isolation(app_url: str) -> None:
    piece = make_piece(app_url, "priya")
    number, photo = pn(piece), piece["intake_photo_id"]
    priya, dash = login(app_url, "priya"), login(app_url, "dash")
    assert get_piece(priya, number)["number"] == piece["number"]
    assert priya.get(f"/api/photos/{photo}").content == piece["_photo"]
    error_of(dash.get(f"/api/pieces/{number}"), 404, "not_found", "Not found.")
    error_of(dash.get(f"/api/photos/{photo}"), 404, "not_found")
    listed = dash.get("/api/pieces").json()
    assert number not in [pn(p) for p in listed]
    assert all(p["owner"]["member_number"] == "M117" for p in listed)


def test_error_shape_and_precedence(app_url: str) -> None:
    anon = Api(app_url)
    junk = "not-a-real-token"
    error_of(anon.post(f"/api/track/{junk}", {}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin",
             "Cross-origin request refused.")
    error_of(anon.delete(f"/api/track/{junk}"), 405, "method_not_allowed", "Method not allowed.")
    error_of(anon.c.post(f"/api/track/{junk}", content=b"x", headers={"Content-Type": "text/plain"}), 405,
             "method_not_allowed")
    error_of(anon.c.post("/api/intakes", content=b"{}", headers={"Content-Type": "text/plain"}), 415, "unsupported_type")
    error_of(anon.c.post("/api/intakes", content=b"{" + b" " * JSON_LIMIT + b"}",
                         headers={"Content-Type": "application/json"}), 413, "too_large")
    error_of(anon.get(f"/api/pieces/{UNKNOWN_PIECE}"), 401, "unauthenticated", "Sign in first.")
    error_of(anon.post("/api/dropoffs", {}), 401, "unauthenticated")
    member = login(app_url, "priya")
    error_of(member.post(f"/api/pieces/{UNKNOWN_PIECE}/collect"), 404, "not_found", "Not found.")
    error_of(member.post("/api/dropoffs", {}), 403, "forbidden", "Your role can't do that.")
    owner = login(app_url, "owner")
    date = new_rate_set(owner)[0]
    bad = error_of(owner.post("/api/rates", RATE_BODY | {"effective_date": date, "bisque_rate": "abc"}), 422)
    assert "bisque_rate" in bad["fields"]
    error_of(owner.post("/api/rates", RATE_BODY | {"effective_date": date}), 409, "rate_date_taken")


def padded_session_body(size: int) -> bytes:
    body = {"email": "nobody@brickfieldlane.example", "password": "x", "pad": ""}
    raw = json.dumps(body, separators=(",", ":")).encode()
    body["pad"] = "a" * (size - len(raw))
    out = json.dumps(body, separators=(",", ":")).encode()
    assert len(out) == size
    return out


def test_server_boundary(app_url: str) -> None:
    anon = Api(app_url)
    ctype = {"Content-Type": "application/json"}
    error_of(anon.c.post("/api/session", content=padded_session_body(JSON_LIMIT), headers=ctype), 401, "bad_credentials")
    error_of(anon.c.post("/api/session", content=padded_session_body(JSON_LIMIT + 1), headers=ctype), 413, "too_large")
    error_of(anon.c.post("/api/session", content=b"{}", headers={"Content-Type": "text/plain"}), 415, "unsupported_type")
    user = USERS["tech"]
    refused = anon.post("/api/session", {"email": user["email"], "password": user["password"]},
                        headers={"Origin": FOREIGN_ORIGIN})
    error_of(refused, 403, "cross_origin", "Cross-origin request refused.")
    accepted = Api(app_url).post("/api/session", {"email": user["email"], "password": user["password"]},
                                 headers={"Origin": app_url})
    assert accepted.status_code == 200

    member = login(app_url, "priya")
    edge = b"\x89PNG\r\n\x1a\n" + b"\0" * (PHOTO_LIMIT - 8)
    r = member.upload(edge, "image/png")
    assert r.status_code == 201 and int(r.json()["bytes"]) == PHOTO_LIMIT, r.text[:300]
    error_of(member.upload(edge + b"\0", "image/png"), 413, "too_large")
    error_of(member.upload(b"plain words", "text/plain"), 415, "unsupported_type")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    for name in ("APP_KILLBILL_DOWN_URL", "APP_MINIO_DOWN_URL", "APP_MAILPIT_DOWN_URL"):
        r = httpx.get(env_url(name) + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, name


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_wf_cross_cutting_targets(browser: Browser, app_url: str, viewport: str) -> None:
    screens = [(None, "/"), ("priya", "/intake"), ("priya", "/pieces"), ("tech", "/board"), ("tech", "/counter"),
               ("tech", "/pickup"), ("owner", "/studio"), ("owner", "/rates")]
    for who, path in screens:
        with ui(browser, app_url, who, path, size=VIEWPORTS[viewport]) as page:
            page.wait_for_load_state("networkidle")
            advance(page, STEP_MS)
            axe(page)
            assert not small_targets(page), (path, small_targets(page))


def test_seeded_studio(app_url: str) -> None:
    for who, user in USERS.items():
        body = post_json(app_url, "/api/session", {"email": user["email"], "password": user["password"]}).json()["user"]
        assert (body["name"], body["role"], body["member_number"]) == (user["name"], user["role"], user["member_number"])
    tech = login(app_url, "tech")
    clays = tech.get("/api/clays").json()
    assert sorted((c["id"], c["name"], str(c["max_cone"])) for c in clays) == sorted(SEED_CLAYS)
    kilns = tech.get("/api/kilns").json()
    assert {k["id"] for k in kilns} == set(SEED_KILNS)
    for kiln in kilns:
        name, layers, post, usable = SEED_KILNS[kiln["id"]]
        assert kiln["name"] == name and int(kiln["layers"]) == layers
        assert dec(kiln["post_height_in"]) == dec(post) and dec(kiln["usable_cubic_inches"]) == usable
        assert dec(kiln["shelf_diameter_in"]) == SHELF_IN
        assert sorted((dec(p["x"]), dec(p["y"]), dec(p["size_in"])) for p in kiln["posts"]) == SEED_POSTS
        profiles = {p["id"]: p for p in kiln["profiles"]}
        assert set(profiles) == {pid for pid, spec in SEED_PROFILES.items() if spec[0] == kiln["id"]}
        for pid, profile in profiles.items():
            _, pname, stage, cone, segments, cool = SEED_PROFILES[pid]
            assert (profile["name"], profile["stage"], str(profile["cone"])) == (pname, stage, cone)
            got = [(int(s["rate_f_per_hour"]), int(s["target_f"]), int(s["hold_minutes"])) for s in profile["segments"]]
            assert got == segments and dec(profile["cool_down_hours"]) == cool
            hours, minutes = FIRING_TIMES[pid]
            assert firing_minutes(segments) == hours * 60 + minutes
            assert round(dec(profile["firing_hours"]) * 60) == hours * 60 + minutes
    history = login(app_url, "owner").get("/api/rates").json()
    assert any(dec(r["bisque_rate"]) == dec(SEED_RATES["bisque_rate"]) and dec(r["glaze_rate"]) == dec(SEED_RATES["glaze_rate"])
               and int(r["member_discount_percent"]) == SEED_RATES["member_discount_percent"]
               and int(r["order_minimum_cents"]) == SEED_RATES["order_minimum_cents"]
               and r["effective_date"] == SEED_RATES["effective_date"] for r in history)


def test_live_fee_estimate(browser: Browser, app_url: str) -> None:
    rates = current_rates(app_url)
    with ui(browser, app_url, "priya", "/intake") as page:
        start_url = page.url
        estimate = page.get_by_role("status", name="Fee estimate")
        fee_region = page.get_by_role("region", name="Fee", exact=True)
        check(page.get_by_role("radiogroup", name="Shape").get_by_role("radio", name="Rectangular", exact=True))
        select(page.get_by_role("combobox", name="Firing plan"), "Bisque and glaze")
        fill(spin(page, "Length"), "4")
        fill(spin(page, "Width"), "3.2")
        advance(page, FEE_MAX_MS)
        see(page, estimate, "Fee appears when every size is filled in")
        with held(page, "**/api/quote") as gate:
            fill(spin(page, "Height"), "4.9")
            advance(page, FEE_MAX_MS)
            expect(estimate).to_have_text("Working out the fee…")
            gate.release()
        expect(estimate).to_have_text(MEMBER_FEE_COPY)
        sides = expected_quote(FEE_CASES["member_rectangle"][1], rates, True)["sides_in"]
        for part in [f"{sides[k]} in" for k in ("length", "width", "height")] + [money(MEMBER_FEE["fee_cents"])]:
            expect(fee_region).to_contain_text(part)
        units = page.get_by_role("radiogroup", name="Units")
        check(units.get_by_role("radio", name="cm", exact=True))
        for name, value in (("Length", "4"), ("Width", "3.2"), ("Height", "4.9")):
            expect(spin(page, name)).to_have_value(f"{dec(value) * Decimal('2.54'):.2f}")
        advance(page, FEE_MAX_MS)
        expect(estimate).to_have_text(MEMBER_FEE_COPY)
        check(units.get_by_role("radio", name="in", exact=True))
        for name, value in (("Length", "4"), ("Width", "3.2"), ("Height", "4.9")):
            cm = (dec(value) * Decimal("2.54")).quantize(Decimal("0.01"))
            expect(spin(page, name)).to_have_value(f"{cm / Decimal('2.54'):.2f}")
        fill(spin(page, "Height"), "5.1")
        advance(page, FEE_MAX_MS)
        quote = expected_quote({"shape": "rectangular", "unit": "in", "length": "4", "width": "3.2", "height": "5.1",
                                "plan": "bisque_and_glaze"}, rates, True)
        expect(estimate).to_have_text(fee_sentence(quote))
        assert page.url == start_url


@pytest.mark.parametrize("case", FEE_CASE_IDS, ids=FEE_CASE_IDS)
def test_fee_arithmetic(app_url: str, killbill: KillBill, case: str) -> None:
    who, sizes, cubic_literal, fee_literal = FEE_CASES[case]
    member = who != "tech"
    rates = current_rates(app_url)
    expected = expected_quote(sizes, rates, member)
    api = login(app_url, who)
    r = api.post("/api/quote", sizes)
    assert r.status_code == 200, r.text
    quote = r.json()
    assert quote["sides_in"] == expected["sides_in"] and quote["cubic_inches"] == expected["cubic_inches"]
    assert dec(quote["rate_per_cubic_inch"]) == dec(expected["rate_per_cubic_inch"])
    assert int(quote["discount_percent"]) == expected["discount_percent"]
    assert int(quote["order_minimum_cents"]) == expected["order_minimum_cents"]
    assert quote["minimum_applied"] is expected["minimum_applied"] and quote["fee_cents"] == expected["fee_cents"]
    assert quote["rate_set_id"] == rates["id"]
    if cubic_literal:
        assert quote["cubic_inches"] == cubic_literal
    if fee_literal:
        assert quote["fee_cents"] == cents(fee_literal)
    plan = sizes["plan"]
    kw = {"shape": sizes["shape"], "unit": sizes["unit"], "plan": plan, "cone": None if plan == "bisque_only" else "6",
          "sizes": tuple(sizes[k] for k in size_keys(sizes["shape"]))}
    if member:
        key = f"member-{USERS[who]['member_number']}"
        before = kb_invoice_ids(killbill, key)
        piece = make_piece(app_url, who, **kw)
    else:
        before = {}
        piece = make_dropoff(app_url, killbill, **kw)["piece"]
        key = f"guest-{pn(piece)}"
    assert piece["fee_cents"] == quote["fee_cents"] and piece["cubic_inches"] == quote["cubic_inches"]
    assert piece["sides_in"] == quote["sides_in"] and piece["rate_set_id"] == quote["rate_set_id"]
    charges = kb_items(killbill, key, f"Firing Piece {pn(piece)}", skip=before)
    assert len(charges) == 1 and cents(charges[0][1]["amount"]) == quote["fee_cents"]


def test_wf_member_intake_happy(browser: Browser, app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    data = png(48, 32)
    invoices_before = kb_invoice_ids(killbill, "member-M104")
    with ui(browser, app_url, "priya", "/intake") as page:
        shown(page, page.get_by_role("heading", name="Log a piece", exact=True))
        accept = page.get_by_role("button", name="Accept and charge", exact=True)
        expect(accept).to_be_disabled()
        fill_intake(page)
        estimate = page.get_by_role("status", name="Fee estimate")
        advance(page, FEE_MAX_MS)
        see(page, estimate, MEMBER_FEE_COPY)
        units = page.get_by_role("radiogroup", name="Units")
        check(units.get_by_role("radio", name="cm", exact=True))
        check(units.get_by_role("radio", name="in", exact=True))
        advance(page, FEE_MAX_MS)
        see(page, estimate, MEMBER_FEE_COPY)
        expect(accept).to_be_disabled()
        page.get_by_label("Intake photo").set_input_files(file_payload(data))
        see(page, page.get_by_role("status", name="Photo upload"), "Photo attached")
        enabled(page, accept)
        click(accept)
        number = captured(page, page.get_by_role("status", name="Intake result"),
                          r"^Piece (\d{4}) accepted\. Receipt sent to priya@brickfieldlane\.example\.$").group(1)
        page.goto(f"{app_url}/pieces")
        row = page.get_by_role("table", name="My pieces").get_by_role("row").filter(has_text=number)
        see(page, row, "$4.41", contains=True)
        see(page, row, "Waiting for kiln", contains=True)
    piece = get_piece(login(app_url, "priya"), number)
    assert piece["fee_cents"] == cents("4.41") and piece["status"] == "queued"
    assert piece["status_label"] == "Waiting for kiln"
    assert S3().get(f"photos/{piece['intake_photo_id']}") == data
    assert len(mails(mail, USERS["priya"]["email"], f"Intake receipt: Piece {number}")) == 1
    charges = kb_items(killbill, "member-M104", f"Firing Piece {number}", skip=invoices_before)
    assert len(charges) == 1 and cents(charges[0][1]["amount"]) == cents("4.41")


def test_photo_attached_only_once_stored(browser: Browser, app_url: str) -> None:
    member = login(app_url, "priya")
    for data, ctype in ((png(), "image/png"), (jpeg(), "image/jpeg")):
        r = member.upload(data, ctype)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["content_type"] == ctype and int(body["bytes"]) == len(data)
        digest = __import__("hashlib").sha256(data).digest()
        assert body["sha256"] in (digest.hex(), base64.b64encode(digest).decode()), body["sha256"]
        assert S3().get(f"photos/{body['photo_id']}") == data
        back = member.get(f"/api/photos/{body['photo_id']}")
        assert back.content == data and back.headers["content-type"].split(";")[0].strip() == ctype
    minio_down = env_url("APP_MINIO_DOWN_URL")
    error_of(login(minio_down, "priya").upload(png(), "image/png"), 503, "storage_unavailable")
    with ui(browser, app_url, "priya", "/intake") as page:
        fill_intake(page)
        accept = page.get_by_role("button", name="Accept and charge", exact=True)
        status = page.get_by_role("status", name="Photo upload")
        picker = page.get_by_label("Intake photo")
        picker.set_input_files(file_payload(b"plain words", "text/plain", "note.txt"))
        see(page, status, "Use a JPEG, PNG, WebP or HEIC photo")
        with held(page, "**/api/photos") as gate:
            picker.set_input_files(file_payload(png()))
            see(page, status, "Uploading photo…")
            expect(accept).to_be_disabled()
            gate.release()
        see(page, status, "Photo attached")
        enabled(page, accept)
    with ui(browser, minio_down, "priya", "/intake") as page:
        fill_intake(page)
        page.get_by_label("Intake photo").set_input_files(file_payload(png()))
        see(page, page.get_by_role("status", name="Photo upload"),
            "Photo not saved — storage is unreachable. Try again in a minute.")
        expect(page.get_by_role("button", name="Accept and charge", exact=True)).to_be_disabled()


def test_intake_receipt_email(app_url: str, mail: Mailpit) -> None:
    piece = make_piece(app_url, "priya", sizes=("4", "3.2", "4.9"), plan="bisque_and_glaze", cone="6")
    found = mails(mail, USERS["priya"]["email"], f"Intake receipt: Piece {pn(piece)}")
    assert len(found) == 1
    message = found[0]
    assert mail_from_address() in addresses(message.get("From"))
    body = text(message)
    for part in ("Fee $4.41", "70.000", "4.0", "3.5", "5.0", " in", "0.07"):
        assert part in body, part
    assert re.search(r"10\s?%", body)
    for other in (USERS["dash"]["name"], USERS["dash"]["email"]):
        assert other not in body


def test_intake_replay(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    member = login(app_url, "priya")
    invoices_before = kb_invoice_ids(killbill, "member-M104")
    photo = upload_photo(member)
    body = intake_body(photo, sizes=("4", "3.2", "4.9"), plan="bisque_and_glaze", cone="6")
    key = idempotency_key()
    first = member.post("/api/intakes", body, key=key)
    assert first.status_code == 201, first.text
    number = pn(first.json())
    again = member.post("/api/intakes", body, key=key)
    assert again.status_code == 201 and again.json() == first.json()
    assert again.headers.get("idempotent-replayed", "").lower() == "true"
    error_of(member.post("/api/intakes", body | {"height": "5"}, key=key), 409, "idempotency_conflict")
    assert [pn(p) for p in member.get("/api/pieces").json() if p["intake_photo_id"] == photo] == [number]
    assert len(kb_items(killbill, "member-M104", f"Firing Piece {number}", skip=invoices_before)) == 1
    assert len(mails(mail, USERS["priya"]["email"], f"Intake receipt: Piece {number}", count=2, seconds=15)) == 1


def test_wf_member_intake_phone(browser: Browser, app_url: str, killbill: KillBill) -> None:
    invoices_before = kb_invoice_ids(killbill, "member-M104")
    with ui(browser, app_url, "priya", "/intake", size=PHONE, touch=True) as page:
        layout(page)
        picker = page.get_by_label("Intake photo")
        assert "image" in (picker.get_attribute("accept") or "")
        assert picker.get_attribute("capture") == "environment"
        tap(in_view(page.get_by_role("radiogroup", name="Shape").get_by_role("radio", name="Rectangular", exact=True)))
        for name, value in (("Length", "4"), ("Width", "3.2"), ("Height", "4.9")):
            tap(in_view(spin(page, name)))
            fill(in_view(spin(page, name)), value)
        fields = [spin(page, "Length"), spin(page, "Width"), spin(page, "Height"),
                  page.get_by_role("combobox", name="Clay body"), page.get_by_role("combobox", name="Firing plan")]
        boxes = [box(f) for f in fields]
        for upper, lower in zip(boxes, boxes[1:]):
            assert lower["y"] >= upper["y"] + upper["height"] - 1, "fields are not a single column"
        select(in_view(page.get_by_role("combobox", name="Clay body")), "Brickfield Buff Stoneware")
        select(in_view(page.get_by_role("combobox", name="Firing plan")), "Bisque and glaze")
        select(in_view(page.get_by_role("combobox", name="Glaze cone")), "Cone 6")
        advance(page, FEE_MAX_MS)
        see(page, page.get_by_role("status", name="Fee estimate"), MEMBER_FEE_COPY)
        tap(in_view(spin(page, "Height")))
        fee = box(page.get_by_role("region", name="Fee", exact=True))
        assert fee["y"] >= 0 and fee["y"] + fee["height"] <= PHONE[1] + 1
        assert not overlaps(fee, box(spin(page, "Height")))
        picker.set_input_files(file_payload(png()))
        see(page, page.get_by_role("status", name="Photo upload"), "Photo attached")
        accept = page.get_by_role("button", name="Accept and charge", exact=True)
        enabled(page, accept)
        tap(in_view(accept))
        number = captured(page, page.get_by_role("status", name="Intake result"),
                          r"^Piece (\d{4}) accepted\. Receipt sent to priya@brickfieldlane\.example\.$").group(1)
        layout(page)
    assert get_piece(login(app_url, "priya"), number)["fee_cents"] == cents("4.41")
    assert len(kb_items(killbill, "member-M104", f"Firing Piece {number}", skip=invoices_before)) == 1


def test_intake_field_errors(app_url: str) -> None:
    member, dash, tech = login(app_url, "priya"), login(app_url, "dash"), login(app_url, "tech")
    photo = upload_photo(member)
    valid = intake_body(photo, sizes=("4", "3.2", "4.9"), plan="bisque_and_glaze", cone="6")
    for change, key, message in FIELD_CASES:
        body = {k: v for k, v in (valid | change).items() if not (k in change and change[k] is None and k != "cone")}
        if change.get("cone", "") is None:
            body["cone"] = None
        body = error_of(member.post("/api/intakes", body, key=idempotency_key()), 422)
        assert body["fields"].get(key) == message, (change, body)
    both = error_of(member.post("/api/intakes", {k: v for k, v in valid.items() if k not in ("shape", "plan")},
                                key=idempotency_key()), 422)
    assert {"shape", "plan"} <= set(both["fields"])
    error_of(member.post("/api/quote", {"shape": "rectangular", "unit": "in", "length": "0", "width": "1", "height": "1",
                                        "plan": "bisque_only"}), 422)
    assert member.post("/api/quote", {"shape": "rectangular", "unit": "in", "length": "23", "width": "23", "height": "8",
                                      "plan": "bisque_only"}).status_code == 200
    foreign = upload_photo(dash)
    body = error_of(member.post("/api/intakes", valid | {"photo_id": foreign}, key=idempotency_key()), 422)
    assert body["fields"]["photo_id"] == "Photo already used or not yours"
    assert member.post("/api/intakes", valid, key=idempotency_key()).status_code == 201
    body = error_of(member.post("/api/intakes", valid, key=idempotency_key()), 422)
    assert body["fields"]["photo_id"] == "Photo already used or not yours"
    guest = valid | {"photo_id": upload_photo(tech), "guest_name": " ", "guest_email": "not-an-email"}
    body = error_of(tech.post("/api/dropoffs", guest, key=idempotency_key()), 422)
    assert body["fields"]["guest_name"] == "Enter a name" and body["fields"]["guest_email"] == "Enter a valid email"


def test_wf_member_intake_invalid_recovery(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "priya", "/intake") as page:
        fill_intake(page, clay="Clayhouse Red Earthenware", cone="Cone 6", photo=png())
        accept = page.get_by_role("button", name="Accept and charge", exact=True)
        enabled(page, accept)
        click(accept)
        summary = page.get_by_role("alert").filter(has_text="Check these fields")
        shown(page, summary)
        cone_copy = clay_copy("6")
        link = summary.get_by_role("link", name=cone_copy)
        expect(page.get_by_text(cone_copy)).not_to_have_count(1)
        click(link)
        expect(page.get_by_role("combobox", name="Glaze cone")).to_be_focused()
        select(page.get_by_role("combobox", name="Glaze cone"), "Cone 06")
        enabled(page, accept)
        click(accept)
        number = captured(page, page.get_by_role("status", name="Intake result"),
                          r"^Piece (\d{4}) accepted\.").group(1)
    piece = get_piece(login(app_url, "priya"), number)
    assert piece["clay_id"] == "red" and str(piece["cone"]) == "06"


def test_intake_all_or_nothing(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    member = login(app_url, "priya")
    email = USERS["priya"]["email"]
    for step, env_name in OUTAGE_ENV.items():
        photo = upload_photo(member)
        body = intake_body(photo, sizes=("4", "3.2", "4.9"), plan="bisque_and_glaze", cone="6")
        key = idempotency_key()
        invoices_before = kb_invoice_ids(killbill, "member-M104")
        receipts_before = len(receipts_to(mail, email))
        r = login(env_url(env_name), "priya").post("/api/intakes", body, key=key)
        failed = error_of(r, 503, "intake_failed", STEP_COPY[step])
        assert failed["step"] == step
        assert not [p for p in member.get("/api/pieces").json() if p["intake_photo_id"] == photo]
        new = {k: v for k, v in kb_invoice_ids(killbill, "member-M104").items() if k not in invoices_before}
        if step == "receipt":
            assert new and all(inv["status"] == "VOID" for inv in new.values()), new
        else:
            assert not new, new
        assert len(receipts_to(mail, email)) == receipts_before
        retry = member.post("/api/intakes", body, key=key)
        assert retry.status_code == 201, retry.text
        assert retry.json()["intake_photo_id"] == photo


def test_wf_intake_outages_steps(browser: Browser, app_url: str) -> None:
    for step in ("charge", "receipt"):
        with ui(browser, env_url(OUTAGE_ENV[step]), "priya", "/intake") as page:
            fill_intake(page, photo=png())
            accept = page.get_by_role("button", name="Accept and charge", exact=True)
            enabled(page, accept)
            click(accept)
            see(page, page.get_by_role("status", name="Intake result"), STEP_COPY[step])
    with ui(browser, app_url, "priya", "/intake") as page:
        divert_once(page, "**/api/intakes", env_url(OUTAGE_ENV["photo"]), "priya")
        fill_intake(page, photo=png())
        accept = page.get_by_role("button", name="Accept and charge", exact=True)
        enabled(page, accept)
        click(accept)
        see(page, page.get_by_role("status", name="Intake result"), STEP_COPY["photo"])


def test_wf_intake_outages_retry(browser: Browser, app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    invoices_before = kb_invoice_ids(killbill, "member-M104")
    with ui(browser, app_url, "priya", "/intake") as page:
        keys = divert_once(page, "**/api/intakes", env_url("APP_KILLBILL_DOWN_URL"), "priya")
        fill_intake(page, photo=png())
        accept = page.get_by_role("button", name="Accept and charge", exact=True)
        result = page.get_by_role("status", name="Intake result")
        enabled(page, accept)
        click(accept)
        see(page, result, STEP_COPY["charge"])
        enabled(page, accept)
        click(accept)
        number = captured(page, result, r"^Piece (\d{4}) accepted\.").group(1)
    assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
    assert len(kb_items(killbill, "member-M104", f"Firing Piece {number}", skip=invoices_before)) == 1
    assert len(mails(mail, USERS["priya"]["email"], f"Intake receipt: Piece {number}", count=2, seconds=15)) == 1


def free_future_date(owner: Api) -> str:
    taken = {r["effective_date"] for r in owner.get("/api/rates").json()}
    while True:
        date = f"{2090 + secrets.randbelow(10)}-{1 + secrets.randbelow(12):02d}-{1 + secrets.randbelow(28):02d}"
        if date not in taken:
            return date


def new_rate_set(owner: Api, **override: Any) -> tuple[str, dict[str, Any]]:
    for _ in range(GUARD_ROUNDS):
        date = free_future_date(owner)
        r = owner.post("/api/rates", RATE_BODY | override | {"effective_date": date})
        if r.status_code == 201:
            return date, r.json()
        error_of(r, 409, "rate_date_taken")
    raise AssertionError("no free rate date")


def test_dated_rate_sets(app_url: str) -> None:
    owner = login(app_url, "owner")
    date, created = new_rate_set(owner)
    assert created["effective_date"] == date and dec(created["bisque_rate"]) == dec(RATE_BODY["bisque_rate"])
    history = owner.get("/api/rates").json()
    dates = [r["effective_date"] for r in history]
    assert date in dates and dates == sorted(dates, reverse=True)
    current = current_rates(app_url)
    assert current["id"] != created["id"] and current["effective_date"] < date
    quote = login(app_url, "priya").post("/api/quote", FEE_CASES["member_rectangle"][1]).json()
    assert quote["rate_set_id"] == current["id"]
    body = error_of(owner.post("/api/rates", RATE_BODY | {"effective_date": "2026-01-01"}), 422)
    assert body["fields"]["effective_date"] == "Choose today or a later date"
    error_of(owner.post("/api/rates", RATE_BODY | {"effective_date": date}), 409, "rate_date_taken")
    probe_date = free_future_date(owner)
    for field, value in (("bisque_rate", "0"), ("glaze_rate", "1.0001"), ("bisque_rate", "0.03001"),
                         ("member_discount_percent", DISCOUNT_MAX + 1), ("order_minimum_cents", ORDER_MIN_MAX_CENTS + 1)):
        body = error_of(owner.post("/api/rates", RATE_BODY | {field: value, "effective_date": probe_date}), 422)
        assert field in body["fields"]
    assert probe_date not in [r["effective_date"] for r in owner.get("/api/rates").json()]
    edge = owner.post("/api/rates", {"bisque_rate": "1.0000", "glaze_rate": "1.0000", "member_discount_percent": DISCOUNT_MAX,
                                     "order_minimum_cents": ORDER_MIN_MAX_CENTS, "effective_date": probe_date})
    assert edge.status_code == 201, edge.text


def test_wf_rates_and_fees_invalid_recovery(browser: Browser, app_url: str) -> None:
    owner = login(app_url, "owner")
    date = free_future_date(owner)
    with ui(browser, app_url, "owner", "/rates") as page:
        form = page.get_by_role("form", name="Firing rates")
        fill(form.get_by_role("textbox", name="Bisque rate ($ per in³)"), "0.0300")
        fill(form.get_by_role("textbox", name="Glaze rate ($ per in³)"), "0.0400")
        fill(form.get_by_role("spinbutton", name="Member discount (%)"), "10")
        fill(form.get_by_role("textbox", name="Order minimum ($)"), "3.00")
        fill(form.get_by_label("Effective date"), "2026-01-01")
        save = form.get_by_role("button", name="Save rates", exact=True)
        click(save)
        shown(page, page.get_by_text("Choose today or a later date").first)
        fill(form.get_by_label("Effective date"), date)
        click(save)
        result = page.get_by_role("status", name="Rates result")
        see(page, result, f"Rates saved. They apply to pieces accepted from {date}.")
        shown(page, page.get_by_role("table", name="Rate history").get_by_role("row").filter(has_text=date))
        click(save)
        see(page, result, f"Rates already set for {date}.")
    assert [r for r in owner.get("/api/rates").json() if r["effective_date"] == date]


def save_today_rates(owner: Api, today: str) -> httpx.Response:
    return owner.post("/api/rates", TODAY_RATES | {"effective_date": today})


def test_frozen_piece_fees(app_url: str) -> None:
    base = short_url()
    earlier = make_piece(base, "priya", sizes=("4", "3.2", "4.9"), plan="bisque_and_glaze", cone="6")
    today = studio_date(earlier["accepted_at"])
    r = save_today_rates(login(base, "owner"), today)
    assert r.status_code == 201 or error_of(r, 409, "rate_date_taken")
    current = current_rates(base)
    assert current["effective_date"] == today and dec(current["bisque_rate"]) == dec(TODAY_RATES["bisque_rate"])
    again = get_piece(login(base, "priya"), pn(earlier))
    for field in ("fee_cents", "sides_in", "cubic_inches", "rate_set_id"):
        assert again[field] == earlier[field], field
    later = make_piece(base, "priya", sizes=("4", "3.2", "4.9"), plan="bisque_and_glaze", cone="6")
    expected = expected_quote({"shape": "rectangular", "unit": "in", "length": "4", "width": "3.2", "height": "4.9",
                               "plan": "bisque_and_glaze"}, current, True)
    assert later["rate_set_id"] == current["id"] and later["fee_cents"] == expected["fee_cents"]
    if r.status_code == 201:
        assert earlier["rate_set_id"] != current["id"] and earlier["fee_cents"] != later["fee_cents"]


def test_wf_rates_and_fees_happy(browser: Browser, app_url: str) -> None:
    base = short_url()
    earlier = make_piece(base, "priya", sizes=("4", "3.2", "4.9"), plan="bisque_and_glaze", cone="6")
    today = studio_date(earlier["accepted_at"])
    with ui(browser, base, "owner", "/rates") as page:
        form = page.get_by_role("form", name="Firing rates")
        fill(form.get_by_role("textbox", name="Bisque rate ($ per in³)"), TODAY_RATES["bisque_rate"])
        fill(form.get_by_role("textbox", name="Glaze rate ($ per in³)"), TODAY_RATES["glaze_rate"])
        fill(form.get_by_role("spinbutton", name="Member discount (%)"), str(TODAY_RATES["member_discount_percent"]))
        fill(form.get_by_role("textbox", name="Order minimum ($)"), money(TODAY_RATES["order_minimum_cents"])[1:])
        fill(form.get_by_label("Effective date"), today)
        click(form.get_by_role("button", name="Save rates", exact=True))
        saved = f"Rates saved. They apply to pieces accepted from {today}."
        taken = f"Rates already set for {today}."
        see(page, page.get_by_role("status", name="Rates result"),
            re.compile(f"^({re.escape(saved)}|{re.escape(taken)})$"))
        shown(page, page.get_by_role("table", name="Rate history").get_by_role("row").filter(has_text=today))
    current = current_rates(base)
    assert current["effective_date"] == today and int(current["member_discount_percent"]) == TODAY_RATES["member_discount_percent"]
    quote = expected_quote({"shape": "rectangular", "unit": "in", "length": "4", "width": "3.2", "height": "4.9",
                            "plan": "bisque_and_glaze"}, current, True)
    with ui(browser, base, "priya", "/intake") as page:
        fill_intake(page)
        advance(page, FEE_MAX_MS)
        see(page, page.get_by_role("status", name="Fee estimate"), fee_sentence(quote))
        page.goto(f"{base}/pieces")
        row = page.get_by_role("table", name="My pieces").get_by_role("row").filter(has_text=pn(earlier))
        see(page, row, money(earlier["fee_cents"]), contains=True)
    assert get_piece(login(base, "priya"), pn(earlier))["fee_cents"] == earlier["fee_cents"]


def refusal(r: httpx.Response, reason: str, copy: str) -> None:
    body = error_of(r, 409, "placement_refused", copy)
    assert body["reason"] == reason


def test_footprint_geometry(app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    created = fresh_firing(base, "annie", "annie-bisque-04")
    fid = created["id"]
    a, b, c = (pn(make_piece(base, sizes=s)) for s in (("4", "4", "4"), ("2", "2", "2"), ("2", "2", "2")))
    d = pn(make_piece(base, sizes=("4", "2", "2")))
    e = pn(make_piece(base, shape="round", sizes=("4", "2")))
    refusal(place(tech, fid, a, 1, 0, 0), "edge", "Past shelf edge")
    after = get_piece(tech, a)
    assert after["status"] == "queued" and after["placement"] is None
    refusal(place(tech, fid, b, 1, 2.5, 16), "post", "Overlaps post")
    assert place(tech, fid, a, 1, 9.5, 9.5).status_code == 201
    refusal(place(tech, fid, b, 1, 10, 10), "overlap", f"Overlaps Piece {a}")
    assert place(tech, fid, b, 1, 13.5, 9.5).status_code == 201
    refusal(place(tech, fid, c, 1, 12.5, 9.5), "overlap", f"Overlaps Piece {min(a, b)}")
    assert place(tech, fid, c, 2, 12.5, 9.5).status_code == 201
    refusal(place(tech, fid, d, 1, 19, 9.5, 0), "edge", "Past shelf edge")
    assert place(tech, fid, d, 1, 19, 9.5, 90).status_code == 201
    assert place(tech, fid, e, 1, 9.5, 19).status_code == 201
    loose = pn(make_piece(base))
    for layer, x, rotation in ((1, 0.3, 0), (5, 1, 0), (1, 1, 45)):
        error_of(place(tech, fid, loose, layer, x, 11, rotation), 422)


def test_stage_clay_cone_height(app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    glaze = fresh_firing(base, "annie", "annie-glaze-6")["id"]
    refusal(place(tech, glaze, pn(make_piece(base)), 1, 9.5, 9.5), "stage", "Wrong stage: piece needs bisque firing")
    red = pn(make_piece(base, plan="glaze_only", clay="red", cone="06"))
    refusal(place(tech, glaze, red, 1, 9.5, 9.5), "clay", clay_copy("6"))
    cone = pn(make_piece(base, plan="glaze_only", cone="06"))
    refusal(place(tech, glaze, cone, 1, 9.5, 9.5), "cone", "Wrong cone: piece is cone 06")
    assert place(tech, glaze, pn(make_piece(base, plan="glaze_only", clay="porcelain", cone="6")), 1, 9.5, 9.5).status_code == 201
    bisque = fresh_firing(base, "ned", "ned-bisque-04")["id"]
    refusal(place(tech, bisque, pn(make_piece(base, sizes=("2", "2", "5.5"))), 1, 9.5, 9.5), "height", "Too tall for this layer")
    assert place(tech, bisque, pn(make_piece(base, sizes=("2", "2", "5"))), 1, 9.5, 9.5).status_code == 201
    assert place(tech, bisque, pn(make_piece(base, clay="red")), 2, 9.5, 9.5).status_code == 201


def test_wf_shelf_pack_happy(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    a = make_piece(base, sizes=("8", "8", "8"))
    b = make_piece(base, sizes=("6", "4", "5"))
    assert place(tech, fid, pn(a), 1, 7.5, 7.5).status_code == 201
    with ui(browser, base, "tech", "/board") as page:
        open_board(page, base, "Big Annie")
        shown(page, placed(page, pn(a)))
        pick(page, pn(b))
        expect(page.get_by_role("heading", name=f"Placing Piece {pn(b)}", exact=True)).to_be_focused()
        move_to(page, "7.5", "7.5")
        see(page, panel(page), f"Overlaps Piece {pn(a)}", contains=True)
        panel(page).get_by_role("button", name="Move right", exact=True).focus()
        for _ in range(16):
            page.keyboard.press("ArrowRight")
        see(page, panel(page), "Position clear", contains=True)
        page.keyboard.press("r")
        expect(spin(page, "Rotation (degrees)")).to_have_value("90")
        see(page, panel(page), "Position clear", contains=True)
        page.get_by_role("heading", name=f"Placing Piece {pn(b)}", exact=True).focus()
        page.keyboard.press("Enter")
        current = settled_firing(page, tech, fid, pn(b))
        expected_fill = firing_fill(base, current, "annie")
        see(page, shelf_news(page), placed_copy(pn(b), 1, expected_fill))
        wait_for(page, lambda: expect(stub(page, pn(b))).to_have_count(0, timeout=POLL_MS))
        see(page, fill_numeral(page), f"Load {expected_fill}% full")
    spot = get_piece(tech, pn(b))["placement"]
    assert (int(spot["layer"]), dec(spot["x"]), dec(spot["y"]), int(spot["rotation"])) == (1, Decimal("15.5"), Decimal("7.5"), 90)
    assert current["fill_percent"] == expected_fill


def test_placement_announcements(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    a, c = pn(make_piece(base, sizes=("4", "4", "4"))), pn(make_piece(base, sizes=("2", "2", "2")))
    with ui(browser, base, "tech", "/board") as page:
        open_board(page, base, "Big Annie")
        pick(page, a)
        move_to(page, "9.5", "9.5")
        press_place(page)
        first_fill = settled_fill(page, base, tech, fid, a, "annie")
        see(page, shelf_news(page), placed_copy(a, 1, first_fill))
        advance(page, REFRESH_MS * 2)
        expect(shelf_news(page)).to_have_text(placed_copy(a, 1, first_fill))
        click(placed(page, a))
        click(panel(page).get_by_role("button", name="Move right", exact=True))
        press_place(page)
        see(page, shelf_news(page), placed_copy(a, 1, first_fill))
        settled_placement_x(page, tech, a, Decimal("10"))
        assert place(tech, fid, c, 1, 15, 15).status_code == 201
        click(placed(page, a))
        move_to(page, "14.5", "14.5")
        press_place(page)
        see(page, shelf_news(page), f"Not placed: Overlaps Piece {c}.")
        advance(page, REFRESH_MS * 2)
        expect(shelf_news(page)).to_have_text(f"Not placed: Overlaps Piece {c}.")
        click(panel(page).get_by_role("button", name="Remove from shelf", exact=True))
        left = settled_fill(page, base, tech, fid, a, "annie", present=False)
        see(page, shelf_news(page), f"Removed Piece {a} from layer 1. Load {left}% full.")
    assert get_piece(tech, a)["status"] == "queued"


def test_wf_shelf_pack_server_down(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    a = pn(make_piece(base, sizes=("4", "4", "4")))
    with ui(browser, base, "tech", "/board") as page:
        open_board(page, base, "Big Annie")
        page.route("**/api/firings/*/placements**", lambda route: route.abort())
        pick(page, a)
        move_to(page, "9.5", "9.5")
        press_place(page)
        see(page, shelf_news(page), "Not saved — the studio server is unreachable.")
        assert get_piece(tech, a)["status"] == "queued"
        page.unroute("**/api/firings/*/placements**")
        press_place(page)
        see(page, shelf_news(page), placed_copy(a, 1, settled_fill(page, base, tech, fid, a, "annie")))
    assert get_piece(tech, a)["status"] == "loaded"


def test_placements_persist_with_history(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    a = pn(make_piece(base, sizes=("4", "2", "3")))
    assert place(tech, fid, a, 2, 9.5, 9.5, 90).status_code == 201
    assert tech.patch(f"/api/firings/{fid}/placements/{a}", {"x": 10}).status_code == 200
    spot = get_piece(tech, a)["placement"]
    assert (int(spot["layer"]), dec(spot["x"]), dec(spot["y"]), int(spot["rotation"])) == (2, Decimal("10"), Decimal("9.5"), 90)
    layer2 = next(l for l in firing_of(tech, fid)["layers"] if int(l["layer"]) == 2)
    stored = next(p for p in layer2["placements"] if str(p["piece_number"]).zfill(4) == a)
    assert (dec(stored["x"]), dec(stored["y"]), int(stored["rotation"])) == (Decimal("10"), Decimal("9.5"), 90)
    with ui(browser, base, "tech", "/board") as page:
        for _ in range(2):
            open_board(page, base, "Big Annie")
            expect(page.get_by_role("tablist", name="Layers")).to_be_visible()
            click(layer_tab(page, 2))
            shown(page, shelf_group(page, 2).get_by_role("button", name=f"Placed Piece {a}"))
            page.reload()
        open_board(page, base, "Big Annie")
        click(layer_tab(page, 2))
        click(placed(page, a))
        expect(spin(page, "X (in)")).to_have_value(re.compile(r"^10(\.0+)?$"))
        expect(spin(page, "Y (in)")).to_have_value(re.compile(r"^9\.50?$"))
        expect(spin(page, "Rotation (degrees)")).to_have_value("90")
    assert tech.delete(f"/api/firings/{fid}/placements/{a}").status_code == 200
    history = get_piece(tech, a)["history"]
    for action in ("placed", "moved", "removed"):
        assert any(action in h["action"].lower() and h["actor"] == USERS["tech"]["name"] for h in history), action


def concurrent(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    gate = threading.Barrier(len(calls))

    def run(call: Callable[[], httpx.Response]) -> httpx.Response:
        gate.wait()
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def test_one_winner_per_spot(app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    pieces = [pn(make_piece(base)) for _ in range(5)]
    results = concurrent([lambda n=n, api=tech.clone(): place(api, fid, n, 1, 9.5, 9.5) for n in pieces])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409, 409]
    for r in results:
        if r.status_code == 409:
            assert r.json()["error"] == "placement_refused" and r.json()["reason"] == "overlap"
    same = pn(make_piece(base))
    results = concurrent([lambda layer=layer, api=tech.clone(): place(api, fid, same, layer, 9.5, 9.5) for layer in (2, 3, 4)])
    assert sorted(r.status_code for r in results) == [201, 409, 409]
    assert all(r.json()["error"] == "piece_not_queued" for r in results if r.status_code == 409)
    layers = firing_of(tech, fid)["layers"]
    numbers = [str(p["piece_number"]).zfill(4) for l in layers for p in l["placements"]]
    assert numbers.count(same) == 1 and len([n for n in numbers if n in pieces]) == 1


def test_fill_and_layer_height(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    usable = kiln_of(tech, "annie")["usable_cubic_inches"]
    big = make_piece(base, sizes=("21", "9", "8"))
    small = make_piece(base, sizes=("4", "4", "3"))
    r = place(tech, fid, pn(big), 1, 1, 7)
    assert r.status_code == 201, r.text
    assert r.json()["fill_percent"] == fill_percent([big["cubic_inches"]], usable)
    assert dec(r.json()["layer_height_in"]) == dec(big["sides_in"]["height"]) + 1
    r = place(tech, fid, pn(small), 2, 9.5, 9.5)
    total = fill_percent([big["cubic_inches"], small["cubic_inches"]], usable)
    assert r.json()["fill_percent"] == total
    current = firing_of(tech, fid)
    assert current["fill_percent"] == total == firing_fill(base, current, "annie")
    heights = {int(l["layer"]): l["height_in"] for l in current["layers"]}
    assert dec(heights[1]) == dec(big["sides_in"]["height"]) + 1 and dec(heights[2]) == dec(small["sides_in"]["height"]) + 1
    with ui(browser, base, "tech", "/board") as page:
        open_board(page, base, "Big Annie")
        see(page, fill_numeral(page), f"Load {total}% full")
        for layer, height in ((1, heights[1]), (2, heights[2])):
            click(page.get_by_role("tab", name=f"Layer {layer}", exact=True))
            label = page.get_by_text(re.compile(r"^Layer height [\d.]+ in$")).first
            shown(page, label)
            assert dec(re.search(r"[\d.]+", label.inner_text()).group()) == dec(height)
        click(layer_tab(page, 3))
        shown(page, page.get_by_text("Layer empty", exact=True))


def test_move_and_remove_placed(app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    a, b = pn(make_piece(base, sizes=("4", "2", "2"))), pn(make_piece(base))
    assert place(tech, fid, a, 1, 9.5, 9.5).status_code == 201
    assert place(tech, fid, b, 1, 14, 9.5).status_code == 201
    assert tech.patch(f"/api/firings/{fid}/placements/{a}", {"rotation": 90}).status_code == 200
    assert int(get_piece(tech, a)["placement"]["rotation"]) == 90
    refusal(tech.patch(f"/api/firings/{fid}/placements/{a}", {"x": 13, "rotation": 0}), "overlap", f"Overlaps Piece {b}")
    assert dec(get_piece(tech, a)["placement"]["x"]) == Decimal("9.5")
    assert tech.patch(f"/api/firings/{fid}/placements/{a}", {"layer": 2}).status_code == 200
    assert int(get_piece(tech, a)["placement"]["layer"]) == 2
    assert tech.delete(f"/api/firings/{fid}/placements/{b}").status_code == 200
    removed = get_piece(tech, b)
    assert removed["status"] == "queued" and removed["placement"] is None
    assert b in [pn(p) for p in tech.get("/api/queue").json()]
    assert tech.post(f"/api/firings/{fid}/start").status_code == 200
    error_of(tech.patch(f"/api/firings/{fid}/placements/{a}", {"x": 10}), 409, "firing_locked")
    error_of(tech.delete(f"/api/firings/{fid}/placements/{a}"), 409, "firing_locked")
    error_of(place(tech, fid, b, 1, 9.5, 9.5), 409, "firing_locked")


def test_wf_board_views_keyboard(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    a, b = pn(make_piece(base, sizes=("4", "4", "4"))), pn(make_piece(base))
    with ui(browser, base, "tech", "/board") as page:
        open_board(page, base, "Big Annie")
        stub(page, a).focus()
        page.keyboard.press("Enter")
        heading = page.get_by_role("heading", name=f"Placing Piece {a}", exact=True)
        shown(page, heading)
        expect(heading).to_be_focused()
        page.keyboard.press("Escape")
        wait_for(page, lambda: expect(stub(page, a)).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Space")
        shown(page, heading)
        move_to(page, "9.5", "9.5")
        layer_tab(page, 1).focus()
        page.keyboard.press("ArrowRight")
        expect(spin(page, "X (in)")).to_have_value(re.compile(r"^10(\.0+)?$"))
        panel(page).get_by_role("button", name="Move left", exact=True).focus()
        page.keyboard.press("ArrowDown")
        expect(spin(page, "Y (in)")).to_have_value(re.compile(r"^10(\.0+)?$"))
        stub(page, b).focus()
        page.keyboard.press("r")
        expect(spin(page, "Rotation (degrees)")).to_have_value("90")
        heading.focus()
        page.keyboard.press("Enter")
        see(page, shelf_news(page), placed_copy(a, 1, settled_fill(page, base, tech, fid, a, "annie")))
        spot = get_piece(tech, a)["placement"]
        assert (dec(spot["x"]), dec(spot["y"]), int(spot["rotation"])) == (Decimal("10"), Decimal("10"), 90)
        placed(page, a).focus()
        page.keyboard.press("Enter")
        shown(page, heading)
        page.keyboard.press("Escape")
        wait_for(page, lambda: expect(placed(page, a)).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Enter")
        shown(page, heading)
        page.keyboard.press("Delete")
        see(page, shelf_news(page),
            f"Removed Piece {a} from layer 1. Load {settled_fill(page, base, tech, fid, a, 'annie', present=False)}% full.")
        shown(page, stub(page, a))
    assert get_piece(tech, a)["status"] == "queued"


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_board_breakpoints(browser: Browser, app_url: str, viewport: str) -> None:
    base = short_url()
    fresh_firing(base, "annie", "annie-bisque-04")
    a = pn(make_piece(base))
    size = VIEWPORTS[viewport]
    with ui(browser, base, "tech", "/board", size=size) as page:
        open_board(page, base, "Big Annie")
        layout(page)
        shelf = box(shelf_group(page, 1))
        tickets = box(page.get_by_role("list", name="Queued pieces"))
        if viewport == "desktop":
            rail = box(page.get_by_role("navigation", name="Kilns"))
            assert rail["x"] + rail["width"] <= shelf["x"] + 1 and shelf["x"] + shelf["width"] <= tickets["x"] + 1
            assert shelf["x"] >= 0 and shelf["y"] >= 0 and shelf["x"] + shelf["width"] <= size[0] and shelf["y"] + shelf["height"] <= size[1]
        elif viewport == "tablet":
            nav = page.get_by_role("navigation", name="Kilns")
            links = [box(l) for l in nav.get_by_role("link").all()]
            assert len({round(l["y"]) for l in links}) == 1
            assert box(nav)["y"] + box(nav)["height"] <= shelf["y"] + 1 and tickets["y"] >= shelf["y"] + shelf["height"] - 1
        else:
            expect(page.get_by_role("combobox", name="Kiln", exact=True)).to_be_visible()
            layers = SEED_KILNS["annie"][1]
            expect(page.get_by_text(layer_of(1, layers), exact=True)).to_be_visible()
            click(page.get_by_role("button", name="Next layer", exact=True))
            see(page, page.get_by_text(re.compile(rf"^Layer \d+ of {layers}$")).first, layer_of(2, layers))
            shown(page, shelf_group(page, 2))
            old = shelf_group(page, 1)
            assert old.count() == 0 or not old.is_visible() or not overlaps(box(old), {"x": 0, "y": 0, "width": size[0], "height": size[1]})
            assert tickets["y"] >= shelf["y"] + shelf["height"] - 1
            click(page.get_by_role("button", name="Previous layer", exact=True))
            shelf = box(shelf_group(page, 1))
        pick(page, a)
        placement = box(panel(page))
        assert not overlaps(placement, shelf)
        if viewport == "desktop":
            assert placement["x"] >= shelf["x"] + shelf["width"] - 1 or placement["x"] + placement["width"] <= shelf["x"] + 1
        else:
            assert placement["y"] >= shelf["y"] + shelf["height"] - 1
        layout(page)


def test_wf_board_views_refresh(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    a = pn(make_piece(base, sizes=("4", "4", "4")))
    with ui(browser, base, "tech", "/board") as page:
        open_board(page, base, "Big Annie")
        pick(page, a)
        x_before = spin(page, "X (in)").input_value()
        rotation = spin(page, "Rotation (degrees)")
        rotation.focus()
        page.keyboard.type("9")
        newcomer = pn(make_piece(base))
        waited = 0
        while True:
            advance(page, FEE_MAX_MS)
            waited += FEE_MAX_MS
            try:
                expect(stub(page, newcomer)).to_have_count(1, timeout=POLL_MS * 3)
                break
            except AssertionError:
                assert waited < OTHERS_MS, "new ticket did not appear within six seconds"
        expect(page.get_by_role("heading", name=f"Placing Piece {a}", exact=True)).to_be_visible()
        expect(rotation).to_be_focused()
        expect(rotation).to_have_value("9")
        expect(spin(page, "X (in)")).to_have_value(x_before)
        assert place(tech, fid, a, 1, 9.5, 9.5).status_code == 201
        waited = 0
        while True:
            advance(page, FEE_MAX_MS)
            waited += FEE_MAX_MS
            try:
                expect(panel(page)).to_contain_text(f"Piece {a} was placed elsewhere.", timeout=POLL_MS * 3)
                break
            except AssertionError:
                assert waited < OTHERS_MS
        expect(page.get_by_role("heading", name=f"Placing Piece {a}", exact=True)).to_be_visible()


def motion_sequence(page: Page, base: str, reduced: bool) -> None:
    tech = login(base, "tech")
    fid = fresh_firing(base, "annie", "annie-bisque-04")["id"]
    usable = kiln_of(tech, "annie")["usable_cubic_inches"]
    pieces = [make_piece(base), make_piece(base), make_piece(base, sizes=("21", "9", "8"))]
    p1, p2, p3 = (pn(p) for p in pieces)
    cubics = [p["cubic_inches"] for p in pieces]
    fills = [fill_percent(cubics[:n], usable) for n in (1, 2, 3)]
    open_board(page, base, "Big Annie")
    click(stub(page, p1))
    (assert_subtree_still(panel(page), "panel") if reduced
     else assert_subtree_motion(panel(page), PANEL_MIN_MS, PANEL_MAX_MS, "panel"))
    move_to(page, "9.5", "9.5")
    press_place(page)
    (assert_subtree_still(placed(page, p1), "settle") if reduced
     else assert_subtree_motion(placed(page, p1), SETTLE_MIN_MS, SETTLE_MAX_MS, "place settle"))
    expect(shelf_news(page)).to_have_text(placed_copy(p1, 1, fills[0]))
    pick(page, p2)
    move_to(page, "12", "9.5")
    below = box(stub(page, p3))
    press_place(page)
    if reduced:
        settled_firing(page, tech, fid, p2)
        wait_for(page, lambda: expect(stub(page, p2)).to_have_count(0, timeout=POLL_MS))
        assert_still(motion(stub(page, p3), MOTION_WINDOW_MS), "column close")
    else:
        paths = awaited_motion(page, tech, fid, p2,
                               {f"stub {p2}": stub(page, p2), f"stub {p3}": stub(page, p3)},
                               ancestors=3)
        if any(paths.values()):
            assert_any_motion(paths, EXIT_MIN_MS, EXIT_MAX_MS, "stub exit")
        else:
            assert_motion(motion(stub(page, p3), MOTION_WINDOW_MS), EXIT_MIN_MS, EXIT_MAX_MS, "stub exit")
        assert box(stub(page, p3))["y"] < below["y"]
    expect(shelf_news(page)).to_have_text(placed_copy(p2, 1, fills[1]))
    before = int(re.search(r"\d+", fill_numeral(page).inner_text()).group())
    click(layer_tab(page, 2))
    pick(page, p3)
    move_to(page, "1", "7")
    final = fills[2]
    page.get_by_role("heading", name=f"Placing Piece {p3}", exact=True).focus()
    page.keyboard.press("Enter")
    expect(shelf_news(page)).to_have_text(placed_copy(p3, 2, final))
    values, elapsed = count_fill(page, final)
    assert values[-1] == final
    if reduced:
        assert set(values) <= {values[0], final}, values
    else:
        assert values == sorted(values) and len(set(values)) > 2 and before <= values[0]
        assert FILL_MIN_MS // 2 <= elapsed <= FILL_MAX_MS + FILL_STEP_MS, (elapsed, values)


def carousel(page: Page, base: str, reduced: bool) -> None:
    open_board(page, base, "Big Annie")
    click(page.get_by_role("button", name="Next layer", exact=True))
    (assert_subtree_still(shelf_group(page, 2), "carousel", ancestors=3) if reduced
     else assert_subtree_motion(shelf_group(page, 2), CAROUSEL_MIN_MS, CAROUSEL_MAX_MS, "carousel",
                                ancestors=3))


def test_footprint_and_fill_motion(browser: Browser, app_url: str) -> None:
    base = short_url()
    with ui(browser, base, "tech", "/board") as page:
        motion_sequence(page, base, reduced=False)
    with ui(browser, base, "tech", "/board", size=PHONE, touch=True) as page:
        carousel(page, base, reduced=False)


def test_reduced_motion_stepper(browser: Browser, app_url: str) -> None:
    base = short_url()
    with ui(browser, base, "tech", "/board", reduced=True) as page:
        motion_sequence(page, base, reduced=True)
    with ui(browser, base, "tech", "/board", size=PHONE, touch=True, reduced=True) as page:
        carousel(page, base, reduced=True)


def test_firing_lifecycle(app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "ned", "ned-bisque-04")["id"]
    assert firing_of(tech, fid)["status_label"] == "Building load"
    error_of(tech.post(f"/api/firings/{fid}/start"), 409, "empty_load")
    error_of(unload(base, fid), 409, "invalid_transition")
    assert place(tech, fid, pn(make_piece(base)), 1, 9.5, 9.5).status_code == 201
    started = tech.post(f"/api/firings/{fid}/start")
    assert started.status_code == 200 and started.json()["status"] == "firing"
    error_of(tech.post(f"/api/firings/{fid}/start"), 409, "invalid_transition")
    error_of(tech.post("/api/firings", {"kiln_id": "ned", "profile_id": "ned-bisque-04"}), 409, "kiln_busy")
    early = error_of(unload(base, fid), 409, "kiln_not_cool", "Kiln still firing")
    assert early["cool_until_label"] == studio_label(early["cool_until"])
    cooling = wait_firing(tech, fid, ("cooling",))
    assert cooling["status_label"] == "Kiln still cooling"
    error_of(unload(base, fid), 409, "kiln_not_cool", "Kiln still cooling")
    ready = wait_firing(tech, fid, ("unloadable",))
    assert ready["status_label"] == "Ready to unload"
    results = concurrent([lambda api=tech.clone(): api.post(f"/api/firings/{fid}/unload",
                                                             {"pickup_shelf": SHELF_CODE, "damage": []}) for _ in range(3)])
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    assert all(r.json()["error"] == "invalid_transition" for r in results if r.status_code == 409)
    assert firing_of(tech, fid)["status_label"] == "Unloaded"
    error_of(unload(base, fid), 409, "invalid_transition")
    results = concurrent([lambda api=tech.clone(): api.post("/api/firings", {"kiln_id": "ned", "profile_id": "ned-bisque-04"})
                          for _ in range(4)])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    assert all(r.json()["error"] == "kiln_busy" for r in results if r.status_code == 409)


def test_wf_firing_cycle_refusals(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "ned", "ned-bisque-04")["id"]
    with ui(browser, base, "tech", "/board") as page:
        open_board(page, base, "Little Ned")
        result = page.get_by_role("status", name="Firing result")
        click(page.get_by_role("button", name="New firing", exact=True))
        dialog = page.get_by_role("dialog", name="New firing")
        select(dialog.get_by_role("combobox", name="Profile"), "Bisque cone 04")
        click(dialog.get_by_role("button", name="Create firing", exact=True))
        see(page, result, "This kiln already has a firing in progress.")
        if dialog.is_visible():
            page.keyboard.press("Escape")
        click(page.get_by_role("button", name="Start firing", exact=True))
        see(page, result, "Place at least one piece before starting.")
    assert firing_of(tech, fid)["status"] == "building" and kiln_of(tech, "ned")["current_firing_id"] == fid


def test_schedule_from_profile(app_url: str) -> None:
    base = short_url()
    tech, owner = login(base, "tech"), login(base, "owner")
    fid = fresh_firing(base, "ned", "ned-glaze-06")["id"]
    assert place(tech, fid, pn(make_piece(base, plan="glaze_only", clay="red", cone="06")), 1, 9.5, 9.5).status_code == 201
    started = tech.post(f"/api/firings/{fid}/start").json()
    snap = started["profile"]
    segments = [(int(s["rate_f_per_hour"]), int(s["target_f"]), int(s["hold_minutes"])) for s in snap["segments"]]
    assert segments == SEED_PROFILES["ned-glaze-06"][4]
    hours = firing_minutes(segments) / 60
    assert abs(dec(snap["firing_hours"]) - hours) * 60 < 1
    burn = (instant(started["firing_ends_at"]) - instant(started["started_at"])).total_seconds()
    cool = (instant(started["cool_until"]) - instant(started["firing_ends_at"])).total_seconds()
    assert abs(Decimal(str(burn)) / hours - Decimal(str(cool)) / dec(snap["cool_down_hours"])) < TS_TOLERANCE_S
    for field in ("started_at", "firing_ends_at", "cool_until"):
        assert started[f"{field}_label"] == studio_label(started[field])
    assert instant(started["server_now"])
    original = {"segments": [{"rate_f_per_hour": r, "target_f": t, "hold_minutes": h} for r, t, h in segments],
                "cool_down_hours": SEED_PROFILES["ned-glaze-06"][5]}
    path = "/api/kilns/ned/profiles/ned-glaze-06"
    try:
        edited = owner.put(path, original | {"cool_down_hours": 13})
        assert edited.status_code == 200 and abs(dec(edited.json()["firing_hours"]) - hours) * 60 < 1
        again = firing_of(tech, fid)
        assert dec(again["profile"]["cool_down_hours"]) == SEED_PROFILES["ned-glaze-06"][5]
        assert again["cool_until"] == started["cool_until"]
        too_many = {"segments": original["segments"] * 5, "cool_down_hours": 12}
        for bad in (too_many, original | {"cool_down_hours": 73}, {"segments": [{"rate_f_per_hour": 0, "target_f": 1000,
                                                                              "hold_minutes": 0}], "cool_down_hours": 12}):
            assert error_of(owner.put(path, bad), 422)["fields"]
    finally:
        owner.put(path, original)


def test_server_decides_unload(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    fid = fresh_firing(base, "ned", "ned-bisque-04")["id"]
    assert place(tech, fid, pn(make_piece(base)), 1, 9.5, 9.5).status_code == 201
    started = tech.post(f"/api/firings/{fid}/start").json()
    ahead = instant(started["cool_until"]) + timedelta(days=2)
    with ui(browser, base, "tech", "/board", clock_at=ahead) as page:
        open_board(page, base, "Little Ned")
        button = page.get_by_role("button", name="Unload", exact=True)
        status = page.get_by_role("status", name="Firing status")
        saw_cooling = False
        while True:
            current = firing_of(tech, fid)
            if current["status"] == "unloadable":
                break
            try:
                expect(button).to_have_attribute("aria-disabled", "true")
            except AssertionError:
                if firing_of(tech, fid)["status"] == "unloadable":
                    break
                raise
            if current["status"] == "cooling" and not saw_cooling:
                try:
                    see(page, status, "Kiln still cooling", contains=True)
                    expect(status).to_contain_text(f"Unload opens {started['cool_until_label']}")
                except AssertionError:
                    if firing_of(tech, fid)["status"] == "unloadable":
                        saw_cooling = True
                        break
                    raise
                saw_cooling = firing_of(tech, fid)["status"] == "cooling" or saw_cooling
            advance(page, FEE_MAX_MS)
            threading.Event().wait(POLL_S)
        assert saw_cooling
        waited = 0
        while True:
            advance(page, FEE_MAX_MS)
            waited += FEE_MAX_MS
            try:
                expect(button).not_to_have_attribute("aria-disabled", "true", timeout=POLL_MS * 3)
                break
            except AssertionError:
                assert waited < UNLOAD_ENABLE_MS, "Unload not enabled within six seconds"


def test_wf_firing_cycle_happy(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    drain(base, "annie")
    a = pn(make_piece(base, sizes=("4", "4", "4")))
    with ui(browser, base, "tech", "/board") as page:
        open_board(page, base, "Big Annie")
        result = page.get_by_role("status", name="Firing result")
        click(page.get_by_role("button", name="New firing", exact=True))
        dialog = page.get_by_role("dialog", name="New firing")
        select(dialog.get_by_role("combobox", name="Profile"), "Bisque cone 04")
        click(dialog.get_by_role("button", name="Create firing", exact=True))
        see(page, result, "Firing created with Bisque cone 04.")
        fid = kiln_of(tech, "annie")["current_firing_id"]
        pick(page, a)
        move_to(page, "9.5", "9.5")
        press_place(page)
        see(page, shelf_news(page), re.compile(rf"^Placed Piece {a} on layer 1\."))
        click(page.get_by_role("button", name="Start firing", exact=True))
        see(page, result, re.compile(r"^Firing started\. Unload opens .+\.$"))
        started = firing_of(tech, fid)
        expect(result).to_have_text(f"Firing started. Unload opens {started['cool_until_label']}.")
        status = page.get_by_role("status", name="Firing status")
        see(page, status, f"Firing ends {started['firing_ends_at_label']}", contains=True)
        expect(status).to_contain_text(f"Unload opens {started['cool_until_label']}")
        advance(page, REFRESH_MS * 2)
        expect(result).to_have_text(f"Firing started. Unload opens {started['cool_until_label']}.")
        wait_firing(tech, fid, ("unloadable",))
        button = page.get_by_role("button", name="Unload", exact=True)
        wait_for(page, lambda: expect(button).not_to_have_attribute("aria-disabled", "true", timeout=POLL_MS))
        click(button)
        dialog = page.get_by_role("dialog", name="Unload firing")
        fill(dialog.get_by_role("textbox", name="Pickup shelf"), SHELF_CODE)
        click(dialog.get_by_role("button", name="Confirm unload", exact=True))
        see(page, result, "Firing unloaded. Pickup notices are on their way.")
    assert firing_of(tech, fid)["status"] == "unloaded"
    piece = get_piece(tech, a)
    assert piece["status"] == "ready" and piece["pickup_shelf"] == SHELF_CODE


def test_ready_notice(app_url: str, mail: Mailpit) -> None:
    base = short_url()
    tech = login(base, "tech")
    done = pn(make_piece(base))
    glaze = pn(make_piece(base, plan="bisque_and_glaze", cone="6"))
    fired = fire_to_unloadable(base, "annie", "annie-bisque-04", [(done, 1, 9.5, 9.5), (glaze, 2, 9.5, 9.5)])
    assert unload(base, fired["id"]).status_code == 200
    ready = get_piece(tech, done)
    assert ready["status"] == "ready" and ready["status_label"] == "Ready on pickup shelf"
    assert ready["pickup_shelf"] == SHELF_CODE and ready["ready_at"] and ready["stage"] is None
    back = get_piece(tech, glaze)
    assert back["status"] == "queued" and back["stage"] == "glaze" and glaze in [pn(p) for p in tech.get("/api/queue").json()]
    found = mails(mail, USERS["priya"]["email"], f"Ready on pickup shelf: Piece {done}")
    assert len(found) == 1
    assert first_heading(found[0]) == "Your piece is ready on the pickup shelf"
    assert f"Pickup shelf {SHELF_CODE}" in text(found[0])
    assert not mails(mail, USERS["priya"]["email"], f"Ready on pickup shelf: Piece {glaze}", seconds=5)


def test_wf_pickup_reminder(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = short_url()
    tech = login(base, "tech")
    a = pn(make_piece(base))
    fired = fire_to_unloadable(base, "ned", "ned-bisque-04", [(a, 1, 9.5, 9.5)])
    assert unload(base, fired["id"]).status_code == 200
    before = get_piece(tech, a)["days_on_shelf"]
    with ui(browser, base, "tech", "/pickup") as page:
        row = page.get_by_role("table", name="Pickup shelf").get_by_role("row").filter(has_text=a)
        shown(page, row)
        expect(row).to_contain_text(SHELF_CODE)
        cells = [int(n) for n in re.findall(r"\b\d{1,2}\b", row.inner_text())]
        after = get_piece(tech, a)["days_on_shelf"]
        assert any(before <= n <= after for n in cells)
    subject = f"Still on the pickup shelf: Piece {a}"
    reminder = mails(mail, USERS["priya"]["email"], subject, seconds=LAPSE_WAIT_S)
    assert len(reminder) == 1 and (SHELF_CODE in text(reminder[0])
                                   or SHELF_CODE in (reminder[0].get("HTML") or ""))
    assert get_piece(tech, a)["days_on_shelf"] >= REMINDER_DAYS
    lapsed = poll(lambda: get_piece(tech, a), lambda p: p["status"] == "uncollected", LAPSE_WAIT_S, "lapse")
    assert lapsed["status_label"] == "Uncollected" and lapsed["days_on_shelf"] >= LAPSE_DAYS
    assert len(mails(mail, USERS["priya"]["email"], subject, count=2, seconds=15)) == 1


def test_wf_pickup_happy(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    a = pn(make_piece(base))
    fired = fire_to_unloadable(base, "annie", "annie-bisque-04", [(a, 1, 9.5, 9.5)])
    assert unload(base, fired["id"]).status_code == 200
    with ui(browser, base, "tech", "/pickup") as page:
        row = page.get_by_role("table", name="Pickup shelf").get_by_role("row").filter(has_text=a)
        shown(page, row)
        expect(row).to_contain_text(USERS["priya"]["name"])
        expect(row).to_contain_text(SHELF_CODE)
        click(page.get_by_role("button", name=f"Mark Piece {a} collected", exact=True))
        see(page, page.get_by_role("status", name="Pickup result"), f"Piece {a} marked collected.")
    assert get_piece(tech, a)["status"] == "collected"
    with ui(browser, base, "priya", "/pieces") as page:
        see(page, page.get_by_role("table", name="My pieces").get_by_role("row").filter(has_text=a), "Collected", contains=True)
    error_of(tech.post(f"/api/pieces/{a}/collect"), 409, "invalid_transition")


def test_guest_dropoff_intake(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    d = make_dropoff(app_url, killbill, sizes=("3", "4.5", "5"), plan="bisque_and_glaze", cone="6")
    piece, number = d["piece"], pn(d["piece"])
    assert piece["status"] == "awaiting_payment" and piece["status_label"] == "Awaiting payment"
    assert d["amount_due_cents"] == piece["fee_cents"] == cents("4.73") and d["payment_status"] == "owed"
    token = re.search(r"/track/([A-Za-z0-9_-]+)$", d["tracking_url"]).group(1)
    assert len(token) * 6 >= TOKEN_BITS
    assert number not in [pn(p) for p in login(app_url, "tech").get("/api/queue").json()]
    account = killbill.account_by_key(f"guest-{number}")
    assert account and account["name"] == d["guest_name"] and account["email"] == d["guest_email"]
    assert account["currency"] == "USD"
    charges = kb_items(killbill, f"guest-{number}", f"Firing Piece {number}")
    assert len(charges) == 1 and cents(charges[0][1]["amount"]) == cents("4.73")
    assert not kb_purchases(killbill, f"guest-{number}")
    found = mails(mail, d["guest_email"], f"Intake receipt: Piece {number}")
    assert len(found) == 1
    body = text(found[0])
    assert f"Amount due {money(d['amount_due_cents'])}" in body and f"Track your piece: {d['tracking_url']}" in body
    assert USERS["priya"]["name"] not in body and USERS["dash"]["name"] not in body
    tracked = httpx.get(app_url + track_api(d["tracking_url"]), timeout=HTTP_TIMEOUT_S)
    assert tracked.status_code == 200 and str(tracked.json()["piece_number"]).zfill(4) == number


def test_paid_only_when_billing_confirms(app_url: str, killbill: KillBill) -> None:
    d = make_dropoff(app_url, killbill)
    number, tech = pn(d["piece"]), login(app_url, "tech")
    key = d["guest_email"]
    down = login(env_url("APP_KILLBILL_DOWN_URL"), "tech")
    error_of(down.post(f"/api/dropoffs/{number}/payment", {}, key=idempotency_key()), 503, "billing_unavailable",
             "Payment not recorded — billing is unreachable. The piece stays Owed.")
    assert get_piece(tech, number)["status"] == "awaiting_payment" and not kb_purchases(killbill, key)
    assert number not in [pn(p) for p in tech.get("/api/queue").json()]
    keys = [idempotency_key() for _ in range(4)]
    results = concurrent([lambda k=k, api=tech.clone(): api.post(f"/api/dropoffs/{number}/payment", {}, key=k) for k in keys])
    assert all(r.status_code in (200, 409) for r in results) and any(r.status_code == 200 for r in results)
    purchases = kb_purchases(killbill, key)
    assert len(purchases) == 1 and cents(purchases[0]["amount"]) == d["amount_due_cents"]
    winner = next(k for k, r in zip(keys, results) if r.status_code == 200)
    body = next(r for r in results if r.status_code == 200).json()
    assert body["payment_status"] == "paid" and body["paid_cents"] == d["amount_due_cents"]
    replay = tech.post(f"/api/dropoffs/{number}/payment", {}, key=winner)
    assert replay.status_code == 200 and replay.headers.get("idempotent-replayed", "").lower() == "true"
    error_of(tech.post(f"/api/dropoffs/{number}/payment", {}, key=idempotency_key()), 409, "already_paid", "Already paid.")
    assert len(kb_purchases(killbill, key)) == 1
    piece = get_piece(tech, number)
    assert piece["status"] == "queued" and any("paid" in h["action"].lower() for h in piece["history"])
    assert number in [pn(p) for p in tech.get("/api/queue").json()]


def fill_counter(page: Page, name: str, email: str) -> None:
    form = page.get_by_role("form", name="Guest drop-off")
    fill(form.get_by_role("textbox", name="Guest name"), name)
    fill(form.get_by_role("textbox", name="Guest email"), email)
    fill_intake(page, sizes=(("Length", "3"), ("Width", "4.5"), ("Height", "5")), photo=png())


def test_wf_guest_dropoff_happy(browser: Browser, app_url: str, killbill: KillBill) -> None:
    first, second = unique("guest")
    name, email = (second, first) if "@" in first else (first, second)
    with ui(browser, app_url, "tech", "/counter") as page:
        fill_counter(page, name, email)
        log = page.get_by_role("button", name="Log drop-off", exact=True)
        enabled(page, log)
        click(log)
        number = captured(page, page.get_by_role("status", name="Drop-off result"),
                          rf"^Piece (\d{{4}}) logged for {re.escape(name)}\. Amount due \$4\.73\.$").group(1)
        card = page.get_by_role("article", name=f"Drop-off Piece {number}")
        see(page, card, f"Amount due {money(cents('4.73'))}", contains=True)
        expect(card).to_contain_text("Owed")
        pay = card.get_by_role("button", name="Take payment", exact=True)
        result = card.get_by_role("status", name="Payment result")
        with held(page, f"**/api/dropoffs/{number}/payment") as gate:
            click(pay)
            see(page, result, "Recording payment…")
            expect(pay).to_be_disabled()
            expect(card).to_contain_text("Owed")
            assert not kb_purchases(killbill, email)
            gate.release()
        see(page, result, f"Paid $4.73 — Piece {number} is in the queue.")
        expect(card).to_contain_text("Paid")
    purchases = kb_purchases(killbill, email)
    assert len(purchases) == 1 and cents(purchases[0]["amount"]) == cents("4.73")
    assert number in [pn(p) for p in login(app_url, "tech").get("/api/queue").json()]


def test_wf_guest_dropoff_billing_down(browser: Browser, app_url: str, killbill: KillBill) -> None:
    d = make_dropoff(app_url, killbill)
    number = pn(d["piece"])
    with ui(browser, env_url("APP_KILLBILL_DOWN_URL"), "tech", "/counter") as page:
        card = page.get_by_role("article", name=f"Drop-off Piece {number}")
        shown(page, card)
        click(card.get_by_role("button", name="Take payment", exact=True))
        see(page, card.get_by_role("status", name="Payment result"),
            "Payment not recorded — billing is unreachable. The piece stays Owed.")
        expect(card).to_contain_text("Owed")
        expect(card).not_to_contain_text("Paid")
    assert get_piece(login(app_url, "tech"), number)["status"] == "awaiting_payment"
    assert not kb_purchases(killbill, d["guest_email"])


def test_tracking_shows_one_piece(browser: Browser, app_url: str, killbill: KillBill) -> None:
    one, two = make_dropoff(app_url, killbill), make_dropoff(app_url, killbill)
    r = httpx.get(app_url + track_api(one["tracking_url"]), timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"piece_number", "status", "status_label", "pickup_shelf"}
    assert str(body["piece_number"]).zfill(4) == pn(one["piece"]) and body["status"] == "awaiting_payment"
    assert body["status_label"] == "Awaiting payment" and body["pickup_shelf"] is None
    for secret in (one["guest_name"], one["guest_email"], two["guest_name"], two["guest_email"], pn(two["piece"])):
        assert secret not in r.text
    with ui(browser, app_url, None, urlparse(one["tracking_url"]).path, size=PHONE, touch=True) as page:
        shown(page, page.get_by_role("heading", name=f"Piece {pn(one['piece'])}", exact=True))
        expect(page.get_by_text("Awaiting payment").first).to_be_visible()
        expect(page.get_by_role("navigation", name="Studio")).to_have_count(0)
        content = page.content()
        for secret in (one["guest_name"], one["guest_email"], two["guest_name"]):
            assert secret not in content


def test_revoke_and_replace_links(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    d = make_dropoff(app_url, killbill)
    number, owner = pn(d["piece"]), login(app_url, "owner")
    dead = "This tracking link is no longer active."
    error_of(login(app_url, "tech").post(f"/api/pieces/{number}/tracking-link/revoke"), 403, "forbidden")
    r = owner.post(f"/api/pieces/{number}/tracking-link/revoke")
    assert r.status_code == 200 and r.json() == {"tracking": "revoked"}
    error_of(httpx.get(app_url + track_api(d["tracking_url"])), 404, "not_found", dead)
    urls = []
    for _ in range(2):
        r = owner.post(f"/api/pieces/{number}/tracking-link")
        assert r.status_code == 201
        urls.append(r.json()["tracking_url"])
    error_of(httpx.get(app_url + track_api(urls[0])), 404, "not_found", dead)
    assert httpx.get(app_url + track_api(urls[1])).status_code == 200
    found = mails(mail, d["guest_email"], f"New tracking link for Piece {number}", count=2)
    assert len(found) == 2 and {u for u in urls if any(u in text(m) for m in found)} == set(urls)
    member_piece = pn(make_piece(app_url, "priya"))
    error_of(owner.post(f"/api/pieces/{member_piece}/tracking-link"), 409, "not_a_guest_piece")
    error_of(owner.post(f"/api/pieces/{member_piece}/tracking-link/revoke"), 409, "not_a_guest_piece")
    error_of(httpx.get(f"{app_url}/api/track/{secrets.token_urlsafe(16)}"), 404, "not_found", dead)


def test_tracking_read_only(app_url: str, killbill: KillBill) -> None:
    d = make_dropoff(app_url, killbill)
    path = track_api(d["tracking_url"])
    before = httpx.get(app_url + path).json()
    for api in (Api(app_url), login(app_url, "owner")):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            error_of(api.send(method, path, {"status": "collected"}), 405, "method_not_allowed", "Method not allowed.")
    assert httpx.get(app_url + path).json() == before
    assert get_piece(login(app_url, "tech"), pn(d["piece"]))["status"] == "awaiting_payment"


def test_wf_guest_tracking_happy(browser: Browser, app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    tech = login(app_url, "tech")
    d = make_dropoff(app_url, killbill)
    number = pn(d["piece"])
    receipt = mails(mail, d["guest_email"], f"Intake receipt: Piece {number}")
    assert receipt
    link = re.search(r"Track your piece: (\S+)", text(receipt[0])).group(1)
    path = urlparse(link).path
    with ui(browser, app_url, None, path, size=PHONE, touch=True) as page:
        shown(page, page.get_by_role("heading", name=f"Piece {number}", exact=True))
        shown(page, page.get_by_text("Awaiting payment").first)
        layout(page)
        assert tech.post(f"/api/dropoffs/{number}/payment", {}, key=idempotency_key()).status_code == 200
        assert len(kb_purchases(killbill, d["guest_email"])) == 1
        page.reload()
        shown(page, page.get_by_text("Waiting for kiln").first)
        expect(page.get_by_text("Awaiting payment")).to_have_count(0)
        tracked = httpx.get(app_url + "/api" + path, timeout=HTTP_TIMEOUT_S).json()
        assert tracked["status"] == "queued" and tracked["status_label"] == "Waiting for kiln"
        assert login(app_url, "owner").post(f"/api/pieces/{number}/tracking-link/revoke").status_code == 200
        page.reload()
        shown(page, page.get_by_text("This tracking link is no longer active.", exact=True))


def test_wf_guest_tracking_owner_links(browser: Browser, app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    d = make_dropoff(app_url, killbill)
    number = pn(d["piece"])
    with ui(browser, app_url, "owner", f"/pieces/{number}") as page:
        result = page.get_by_role("status", name="Tracking result")
        click(page.get_by_role("button", name="Revoke tracking link", exact=True))
        see(page, result, "Tracking link revoked.")
        click(page.get_by_role("button", name="New tracking link", exact=True))
        see(page, result, f"New tracking link created. An email to {d['guest_email']} is on its way.")
        page.goto(app_url + urlparse(d["tracking_url"]).path)
        shown(page, page.get_by_text("This tracking link is no longer active.", exact=True))
    found = mails(mail, d["guest_email"], f"New tracking link for Piece {number}")
    fresh = re.search(r"https?://\S+/track/[A-Za-z0-9_-]+", text(found[0])).group(0)
    assert httpx.get(app_url + track_api(fresh)).status_code == 200


def damaged_firing(base: str, photos: tuple[bytes, bytes]) -> tuple[list[dict[str, Any]], list[str]]:
    tech = login(base, "tech")
    pieces = [make_piece(base, photo=png(48, 32)), make_piece(base, photo=png(48, 32))]
    fired = fire_to_unloadable(base, "annie", "annie-bisque-04", [(pn(pieces[0]), 1, 9.5, 9.5), (pn(pieces[1]), 2, 9.5, 9.5)])
    unload_photos = [upload_photo(tech, photos[0], "image/png"), upload_photo(tech, photos[1], "image/png")]
    damage = [{"piece_number": pn(pieces[0]), "kind": "glaze_run", "photo_id": unload_photos[0], "note": "Glaze ran"},
              {"piece_number": pn(pieces[1]), "kind": "crack", "photo_id": unload_photos[1], "note": ""}]
    assert unload(base, fired["id"], damage).status_code == 200
    return pieces, unload_photos


def report_for(base: str, number: str) -> dict[str, Any]:
    return next(r for r in login(base, "owner").get("/api/damage-reports").json() if str(r["piece_number"]).zfill(4) == number)


def test_damage_reports_at_unload(app_url: str) -> None:
    base = short_url()
    tech = login(base, "tech")
    a, b = make_piece(base), make_piece(base)
    fired = fire_to_unloadable(base, "annie", "annie-bisque-04", [(pn(a), 1, 9.5, 9.5), (pn(b), 2, 9.5, 9.5)])
    photo = upload_photo(tech, jpeg(), "image/jpeg")
    outsider = pn(make_piece(base))
    entry = {"piece_number": pn(a), "kind": "glaze_run", "photo_id": photo, "note": "Glaze ran onto the shelf"}
    for bad in ([entry | {"piece_number": outsider}], [entry | {"kind": "chip"}],
                [entry | {"note": "x" * (NOTE_MAX + 1)}], [entry | {"photo_id": upload_photo(login(base, "priya"))}]):
        error_of(unload(base, fired["id"], bad), 422)
    for shelf in ("", "b3", "ABCDEFGHI"):
        error_of(tech.post(f"/api/firings/{fired['id']}/unload", {"pickup_shelf": shelf, "damage": []}), 422)
    assert firing_of(tech, fired["id"])["status"] == "unloadable"
    second = upload_photo(tech)
    assert unload(base, fired["id"], [entry, {"piece_number": pn(b), "kind": "crack", "photo_id": second, "note": ""}]).status_code == 200
    report = report_for(base, pn(a))
    assert (report["kind"], report["status"], report["unload_photo_id"]) == ("glaze_run", "reported", photo)
    assert report["intake_photo_id"] == a["intake_photo_id"] and report["account_name"] == USERS["priya"]["name"]
    assert report["reported_by"] == USERS["tech"]["name"]
    assert report_for(base, pn(b))["kind"] == "crack"
    assert any("damage" in h["action"].lower() for h in get_piece(tech, pn(a))["history"])


def test_evidence_served_as_uploaded(browser: Browser, app_url: str) -> None:
    base = short_url()
    tech, owner = login(base, "tech"), login(base, "owner")
    a = make_piece(base)
    fired = fire_to_unloadable(base, "annie", "annie-bisque-04", [(pn(a), 1, 9.5, 9.5)])
    evidence = jpeg()
    unload_photo = upload_photo(tech, evidence, "image/jpeg")
    assert unload(base, fired["id"], [{"piece_number": pn(a), "kind": "crack", "photo_id": unload_photo, "note": ""}]).status_code == 200
    for api, photo_id, data, ctype in ((owner, a["intake_photo_id"], a["_photo"], "image/png"),
                                       (login(base, "priya"), a["intake_photo_id"], a["_photo"], "image/png"),
                                       (owner, unload_photo, evidence, "image/jpeg")):
        r = api.get(f"/api/photos/{photo_id}")
        assert r.status_code == 200 and r.content == data
        assert r.headers["content-type"].split(";")[0].strip() == ctype and int(r.headers["content-length"]) == len(data)
        assert S3("-short").get(f"photos/{photo_id}") == data
    piece = make_piece(app_url, "priya")
    minio_down = env_url("APP_MINIO_DOWN_URL")
    error_of(login(minio_down, "priya").get(f"/api/photos/{piece['intake_photo_id']}"), 503, "storage_unavailable")
    with ui(browser, minio_down, "priya", f"/pieces/{pn(piece)}") as page:
        shown(page, page.get_by_text("Photo unavailable while storage is down.").first)


def test_damage_settlement(app_url: str, killbill: KillBill) -> None:
    base = short_url()
    owner = login(base, "owner")
    pieces, _ = damaged_firing(base, (png(), png()))
    first, second = report_for(base, pn(pieces[0])), report_for(base, pn(pieces[1]))
    confirm = f"/api/damage-reports/{first['id']}/confirm"
    for amount in (DAMAGE_MIN_CENTS - 1, DAMAGE_MAX_CENTS + 1):
        assert "amount_cents" in error_of(owner.post(confirm, {"amount_cents": amount}, key=idempotency_key()), 422)["fields"]
    error_of(login(base, "tech").post(confirm, {"amount_cents": cents(SHELF_CHARGE)}, key=idempotency_key()), 403, "forbidden")
    before = kb_owed(killbill, "member-M104")
    key = idempotency_key()
    r = owner.post(confirm, {"amount_cents": cents(SHELF_CHARGE)}, key=key)
    assert r.status_code == 200 and r.json()["status"] == "charged"
    replay = owner.post(confirm, {"amount_cents": cents(SHELF_CHARGE)}, key=key)
    assert replay.headers.get("idempotent-replayed", "").lower() == "true" and replay.json() == r.json()
    charges = kb_items(killbill, "member-M104", f"Shelf damage Piece {pn(pieces[0])}")
    assert len(charges) == 1 and cents(charges[0][1]["amount"]) == cents(SHELF_CHARGE)
    assert kb_owed(killbill, "member-M104") == before + cents(SHELF_CHARGE)
    error_of(owner.post(confirm, {"amount_cents": cents(SHELF_CHARGE)}, key=idempotency_key()), 409, "already_settled",
             "This report is already settled.")
    error_of(owner.post(confirm, {"amount_cents": 5}, key=idempotency_key()), 409, "already_settled")
    error_of(owner.post(f"/api/damage-reports/{first['id']}/waive"), 409, "already_settled")
    waived = owner.post(f"/api/damage-reports/{second['id']}/waive")
    assert waived.status_code == 200 and waived.json()["status"] == "waived"
    error_of(owner.post(f"/api/damage-reports/{second['id']}/confirm", {"amount_cents": cents(SHELF_CHARGE)},
                        key=idempotency_key()), 409, "already_settled")
    assert not kb_items(killbill, "member-M104", f"Shelf damage Piece {pn(pieces[1])}")


def image_bytes(locator: Locator) -> bytes:
    encoded = locator.evaluate(
        "async img => { const r = await fetch(img.currentSrc || img.src); const b = new Uint8Array(await r.arrayBuffer());"
        " let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); }")
    return base64.b64decode(encoded)


def test_wf_damage_dispute_charge(browser: Browser, app_url: str, killbill: KillBill) -> None:
    base = short_url()
    shelf_photo = png(48, 32)
    pieces, _ = damaged_firing(base, (shelf_photo, png()))
    number = pn(pieces[0])
    before = kb_owed(killbill, "member-M104")
    with ui(browser, base, "owner", "/studio") as page:
        click(page.get_by_role("region", name="Damage reports").get_by_role("button", name=f"Review Piece {number}", exact=True))
        dialog = page.get_by_role("dialog", name=f"Damage report for Piece {number}")
        intake = dialog.get_by_role("img", name=f"Intake photo of Piece {number}")
        evidence = dialog.get_by_role("img", name=f"Unload photo of Piece {number}")
        shown(page, intake)
        shown(page, evidence)
        left, right = box(intake), box(evidence)
        assert abs(left["y"] - right["y"]) <= 1 and abs(left["width"] - right["width"]) <= 1 and left["x"] < right["x"]
        assert image_bytes(intake) == pieces[0]["_photo"] and image_bytes(evidence) == shelf_photo
        fill(dialog.get_by_role("spinbutton", name="Shelf charge ($)"), SHELF_CHARGE)
        click(dialog.get_by_role("button", name="Confirm and charge", exact=True))
        see(page, dialog.get_by_role("status", name="Damage result"),
            f"Shelf charge of {money(cents(SHELF_CHARGE))} posted to {USERS['priya']['name']}.")
    assert report_for(base, number)["status"] == "charged"
    charges = kb_items(killbill, "member-M104", f"Shelf damage Piece {number}")
    assert len(charges) == 1 and cents(charges[0][1]["amount"]) == cents(SHELF_CHARGE)
    assert kb_owed(killbill, "member-M104") == before + cents(SHELF_CHARGE)


def test_wf_damage_dispute_waive(browser: Browser, app_url: str, killbill: KillBill) -> None:
    base = short_url()
    pieces, _ = damaged_firing(base, (png(), png()))
    number = pn(pieces[1])
    with ui(browser, base, "owner", "/studio", size=PHONE, touch=True) as page:
        click(page.get_by_role("button", name=f"Review Piece {number}", exact=True))
        dialog = page.get_by_role("dialog", name=f"Damage report for Piece {number}")
        intake = dialog.get_by_role("img", name=f"Intake photo of Piece {number}")
        shown(page, intake)
        evidence = dialog.get_by_role("img", name=f"Unload photo of Piece {number}")
        assert box(intake)["y"] + box(intake)["height"] <= box(evidence)["y"] + 1
        click(dialog.get_by_role("button", name="Waive", exact=True))
        see(page, dialog.get_by_role("status", name="Damage result"), f"Damage waived for Piece {number}.")
    assert report_for(base, number)["status"] == "waived"
    assert not kb_items(killbill, "member-M104", f"Shelf damage Piece {number}")


def test_studio_figures_recomputed(browser: Browser, app_url: str, killbill: KillBill) -> None:
    owner, tech = login(app_url, "owner"), login(app_url, "tech")
    d = make_dropoff(app_url, killbill)
    number = pn(d["piece"])
    owed = owner.get("/api/studio/owed").json()
    members = {a["member_number"]: a for a in owed["accounts"] if a["kind"] == "member"}
    for who in ("priya", "dash"):
        account = members[USERS[who]["member_number"]]
        assert account["owed_cents"] == kb_owed(killbill, f"member-{USERS[who]['member_number']}")
    guest = [a for a in owed["accounts"] if a["kind"] == "guest" and str(a["piece_number"]).zfill(4) == number]
    assert len(guest) == 1 and guest[0]["owed_cents"] == d["amount_due_cents"] and guest[0]["name"] == d["guest_name"]
    assert owed["total_owed_cents"] == sum(a["owed_cents"] for a in owed["accounts"])
    ready = len([p for p in tech.get("/api/pieces").json() if p["status"] == "ready"])
    summary = owner.get("/api/studio/summary").json()
    assert summary["awaiting_pickup"] == ready
    with ui(browser, app_url, "owner", "/studio") as page:
        row = page.get_by_role("table", name="Amounts owed").get_by_role("row").filter(has_text=USERS["priya"]["name"])
        see(page, row, money(members["M104"]["owed_cents"]), contains=True)
        see(page, page.get_by_role("region", name="Awaiting pickup"), str(ready), contains=True)
        expect(page.get_by_role("region", name="Kilns")).to_contain_text(re.compile(r"Load \d+% full|No load"))
    assert tech.post(f"/api/dropoffs/{number}/payment", {}, key=idempotency_key()).status_code == 200
    assert number not in [str(a["piece_number"]).zfill(4) for a in owner.get("/api/studio/owed").json()["accounts"]
                          if a["kind"] == "guest"]
    base = short_url()
    fid = fresh_firing(base, "ned", "ned-bisque-04")["id"]
    assert place(login(base, "tech"), fid, pn(make_piece(base, sizes=("4", "4", "4"))), 1, 9.5, 9.5).status_code == 201
    kiln = next(k for k in login(base, "owner").get("/api/studio/summary").json()["kilns"] if k["kiln_id"] == "ned")
    assert kiln["firing_id"] == fid and kiln["fill_percent"] == firing_fill(base, firing_of(login(base, "tech"), fid), "ned")


def test_member_counter_payment(app_url: str, killbill: KillBill) -> None:
    dash = USERS["dash"]["member_number"]
    account_key = f"member-{dash}"
    pay_path = f"/api/members/{dash}/payments"
    make_piece(app_url, "dash")
    owner = login(app_url, "owner")
    before = kb_owed(killbill, account_key)
    purchases = len(kb_purchases(killbill, account_key))
    assert before > 0
    down = login(env_url("APP_KILLBILL_DOWN_URL"), "owner")
    error_of(down.post(pay_path, {}, key=idempotency_key()), 503, "billing_unavailable",
             "Payment not recorded — billing is unreachable.")
    assert len(kb_purchases(killbill, account_key)) == purchases and kb_owed(killbill, account_key) == before
    error_of(login(app_url, "tech").post(pay_path, {}, key=idempotency_key()), 403, "forbidden")
    key = idempotency_key()
    r = owner.post(pay_path, {}, key=key)
    assert r.status_code == 200 and r.json() == {"paid_cents": before, "owed_cents": 0}
    made = kb_purchases(killbill, account_key)
    assert len(made) == purchases + 1 and cents(made[-1]["amount"]) == before
    assert kb_owed(killbill, account_key) == 0
    replay = owner.post(pay_path, {}, key=key)
    assert replay.headers.get("idempotent-replayed", "").lower() == "true"
    error_of(owner.post(pay_path, {}, key=idempotency_key()), 409, "nothing_owed", "Nothing is owed.")
    assert len(kb_purchases(killbill, account_key)) == purchases + 1


def test_wf_owner_ledger_billing_down(browser: Browser, app_url: str) -> None:
    down = env_url("APP_KILLBILL_DOWN_URL")
    error_of(login(down, "owner").get("/api/studio/owed"), 503, "billing_unavailable")
    assert login(down, "owner").get("/api/studio/summary").status_code == 200
    with ui(browser, down, "owner", "/studio") as page:
        see(page, page.get_by_role("alert").filter(has_text="Billing is down"),
            "Billing is down — we can't show what's owed right now.")
        owed = page.get_by_role("region", name="Amounts owed")
        expect(owed).not_to_contain_text("$")
        expect(page.get_by_role("region", name="Kilns")).to_contain_text(re.compile(r"Load \d+% full|No load"))
        expect(page.get_by_role("region", name="Awaiting pickup")).to_contain_text(re.compile(r"\d"))
    error_of(login(down, "priya").get("/api/me/balance"), 503, "billing_unavailable")
    with ui(browser, down, "priya", "/pieces") as page:
        see(page, page.get_by_role("region", name="My balance"), "Balance unavailable while billing is down.", contains=True)


def test_wf_owner_ledger_happy(browser: Browser, app_url: str, killbill: KillBill) -> None:
    make_piece(app_url, "priya")
    owed = kb_owed(killbill, "member-M104")
    with ui(browser, app_url, "owner", "/studio") as page:
        row = page.get_by_role("table", name="Amounts owed").get_by_role("row").filter(has_text=USERS["priya"]["name"])
        see(page, row, money(owed), contains=True)
        expect(page.get_by_role("region", name="Kilns")).to_be_visible()
        expect(page.get_by_role("region", name="Awaiting pickup")).to_contain_text(re.compile(r"\d"))
        result = page.get_by_role("status", name="Payment result")
        with held(page, f"**/api/members/{USERS['priya']['member_number']}/payments") as gate:
            click(page.get_by_role("button", name=f"Record payment from {USERS['priya']['name']}", exact=True))
            see(page, result, "Recording payment…")
            expect(row).to_contain_text(money(owed))
            gate.release()
        see(page, result, f"Recorded {money(owed)} from {USERS['priya']['name']}.")
        see(page, row, "$0.00", contains=True)
    assert kb_owed(killbill, "member-M104") == 0
    assert cents(kb_purchases(killbill, "member-M104")[-1]["amount"]) == owed


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in manifest.values())


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    for family in ("Fraunces", "IBM Plex"):
        assert family in notices


def test_if_licences() -> None:
    refused = []
    for p in shipped_packages():
        allowed = ALLOWLIST | ({FONT_LICENCE} if "font" in p.name.lower() else set())
        if not licence_allowed(p.licence, allowed):
            refused.append((p.name, p.licence))
    assert not refused, refused


def test_if_no_other_datastore() -> None:
    stores = [s.lower() for s in OTHER_STORES]
    names = [p.name.lower() for p in shipped_packages()]
    assert not [n for n in names if any(s in n for s in stores)], names
    files = [f for f in DEPLOYED_APP.rglob("*") if "node_modules" not in f.parts and f.is_file()
             and any(s in f.name.lower() for s in stores)]
    assert not files, files


def test_if_services_untouched(mail: Mailpit, killbill: KillBill) -> None:
    assert isinstance(S3().keys("photos/"), list)
    assert killbill.account_by_key("member-M104") is not None
    assert isinstance(mail.messages(settle=0), list)


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    foreign: list[str] = []
    for who, path in ((None, "/"), ("priya", "/intake"), ("tech", "/board"), ("owner", "/studio"), ("owner", "/rates")):
        with ui(browser, app_url, who, path) as page:
            page.on("request", lambda req: foreign.append(req.url)
                    if not req.url.startswith(("data:", "blob:")) and not same_origin(req.url, app_url) else None)
            page.reload()
            page.wait_for_load_state("networkidle")
    assert not foreign, foreign


def test_if_typescript_compiles() -> None:
    done = subprocess.run("npx --no-install tsc --noEmit", shell=True, cwd=DEPLOYED_APP, capture_output=True,
                          text=True, timeout=COPY_WAIT_S)
    assert done.returncode == 0, (done.stdout + done.stderr)[-3000:]
